// asr_voicestudio.rs — Oreille LOCALE de la dictée (service local VoiceStudio).
//
// FRÈRE de `tts_voicestudio.rs`, jamais son remplaçant : lui DEMANDE une voix,
// celui-ci REÇOIT une parole. Le service est un AUTRE programme, déjà installé
// et déjà lancé par l'utilisateur sur son ordinateur ; Pilot ne l'installe pas,
// ne le lance pas, ne le configure pas et ne télécharge aucun modèle.
//
// ÉTAPE 1 = pont machine seulement (`spec_voice_input.md`) : ce module sait
// dire si la transcription locale est possible (et POURQUOI elle ne l'est pas),
// ouvrir une dictée, recevoir des morceaux de son, rendre le texte au fur et à
// mesure puis le texte final, et refermer proprement — y compris en pleine
// dictée. L'écran de dictée n'est PAS encore branché dessus : rien ici ne
// prétend donc que le son a cessé de partir vers un service en ligne.
//
// Ce que ce module ne fait JAMAIS (décisions du propriétaire) :
//   - aucun modèle téléchargé : le modèle français est CHOISI parmi ceux DÉJÀ
//     installés, et un modèle absent est une erreur dite, jamais un
//     téléchargement déclenché en douce ;
//   - aucune confiance dans le modèle par défaut du service : le modèle est
//     IMPOSÉ dans l'adresse de la session (`?model=…`), sinon le service
//     choisirait le plus petit modèle pour nous ;
//   - aucun fichier audio écrit sur le disque : le son vit en mémoire, le
//     journal texte reçoit au plus une ligne ;
//   - aucun autre appel réseau : uniquement 127.0.0.1, aucun secret, aucune clé ;
//   - aucune fenêtre qui parle au service : la fenêtre ne s'adresse qu'à ces
//     commandes (même porte unique que la voix imitée).
//
// Robuste par construction : service absent, service muet, modèle absent, dictée
// non prête, session interrompue → un état ou un évènement LISIBLE (jamais une
// exception muette, jamais un silence), et c'est l'appelant qui décide du repli.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::tts_local::{append_log, local_voice_root};
use crate::tts_voicestudio::{BASE_URL, CONNECT_TIMEOUT, HEALTH_PATH};

/// Session de dictée en flux (protocole `voicestudio.speech.v1`).
pub const STREAM_PATH: &str = "/v1/audio/transcriptions/stream";
/// Modèles de dictée installés côté service (identifiant, langues, installé).
pub const MODELS_PATH: &str = "/dictation/models";
/// Préparation de la dictée (modèle chargé, prêt à écouter).
pub const READINESS_PATH: &str = "/dictation/readiness";
/// État d'acceptation de la licence d'un modèle (le service REFUSE un modèle
/// installé dont la licence n'a pas été acceptée par l'utilisateur).
pub const LICENCE_PATH: &str = "/models/licenses/acceptance/";
/// Évènement poussé vers la fenêtre : un morceau de texte, un état, une panne.
pub const EVENT_TRANSCRIPT: &str = "asr-voicestudio-transcript";
/// Fréquence du son envoyé : 16 kHz mono, 16 bits signés (PCM brut).
pub const SAMPLE_RATE: u32 = 16_000;
/// Modèle français PRÉFÉRÉ : le meilleur modèle européen installé sur ce poste
/// (25 langues dont le français, hors ligne). Il est essayé EN PREMIER, jamais
/// le modèle par défaut du service ; s'il est refusé par le service (licence non
/// acceptée, chargement impossible), le suivant est pris EXPLICITEMENT et le
/// refus est dit — Pilot n'accepte aucune licence à la place de l'utilisateur.
pub const MODEL_FRENCH: &str = "sherpa-parakeet-tdt-v3";
/// Fin de flux : le service rend alors le texte final de la session.
pub const END_FRAME: &str = "{\"type\":\"input_audio.end\"}";
/// Délai d'une sonde (santé, modèles, préparation) : un service éteint se
/// constate VITE, jamais après une attente qui fige l'écran.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// Délai d'attente du texte final après la fin du flux.
pub const FINAL_TIMEOUT: Duration = Duration::from_secs(20);
/// Délai d'ouverture d'une session (chargement du modèle compris).
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
/// Taille maximale d'un morceau envoyé par la fenêtre (100 ms à 16 kHz mono
/// 16 bits = 3 200 octets ; on plafonne à ~0,5 s). Au-delà, le service reçoit
/// des morceaux trop gros pour rendre du texte vite.
pub const MAX_CHUNK_BYTES: usize = 16_384;

/// Codes STABLES (pour l'application) ; les phrases lisibles sont dans `hint`.
pub const REASON_OK: &str = "disponible";
pub const REASON_ABSENT: &str = "service-absent";
pub const REASON_MUTE: &str = "service-muet";
pub const REASON_NO_FRENCH_MODEL: &str = "aucun-modele-francais";
pub const REASON_NOT_READY: &str = "dictee-non-prete";

/// Un modèle de dictée tel que le service le décrit (rien n'est inventé).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DictationModel {
    pub id: String,
    /// Référence du dépôt du modèle chez son éditeur : c'est SOUS CETTE FORME que
    /// le service parle des licences (`/models/licenses/acceptance/<repo_id>`).
    #[serde(default)]
    pub repo_id: String,
    pub label: String,
    pub languages: String,
    pub installed: bool,
    pub recommended: bool,
    pub tag: String,
}

/// Réponse à la seule question de l'étape 1 : « peut-on transcrire ici, et sinon
/// pourquoi ? ». `reason` est un code stable, `hint` une phrase pour l'humain.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AsrStatus {
    pub available: bool,
    pub reason: String,
    pub hint: String,
    pub model_id: String,
    pub model_label: String,
    pub models: Vec<DictationModel>,
    pub base_url: String,
    pub sample_rate: u32,
}

/// Ce que la fenêtre reçoit à l'ouverture d'une dictée locale.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AsrSession {
    pub session_id: String,
    pub model_id: String,
    pub model_label: String,
    pub sample_rate: u32,
    pub stream_url: String,
}

/// Un morceau de transcription (ou un état, ou une panne) poussé à la fenêtre.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct TranscriptEvent {
    pub session_id: String,
    /// `started` | `status` | `partial` | `final` | `error` | `ended`
    pub kind: String,
    pub text: String,
    /// `utterance` (morceau de phrase) ou `summary` (texte final, qui fait foi).
    pub final_kind: String,
    pub engine: String,
    pub stage: String,
    pub message: String,
    /// Millisecondes depuis l'ouverture de la session (mesure réelle, côté app).
    pub elapsed_ms: u64,
}

// ---------------------------------------------------------------------------
// Décisions pures (aucun réseau, aucun DOM) — testables sans service
// ---------------------------------------------------------------------------

fn empty_status() -> AsrStatus {
    AsrStatus {
        available: false,
        reason: String::new(),
        hint: String::new(),
        model_id: String::new(),
        model_label: String::new(),
        models: Vec::new(),
        base_url: BASE_URL.to_string(),
        sample_rate: SAMPLE_RATE,
    }
}

fn unavailable(reason: &str, hint: String, models: Vec<DictationModel>) -> AsrStatus {
    AsrStatus {
        reason: reason.to_string(),
        hint,
        models,
        ..empty_status()
    }
}

/// Phrase d'explication quand la transcription locale n'est pas possible.
/// Toujours les mêmes mots, jamais un code d'erreur brut.
pub fn down_hint(reason: &str) -> String {
    match reason {
        REASON_MUTE => "La transcription locale n'est pas disponible : le logiciel de voix \
                        (VoiceStudio) ne répond pas. Vous pouvez dicter autrement, ou écrire."
            .to_string(),
        REASON_NO_FRENCH_MODEL => "La transcription locale n'est pas disponible : le logiciel de \
                                   voix n'a aucun modèle de dictée qui sache le français. Pilot \
                                   n'en télécharge aucun — dictez autrement, ou écrivez."
            .to_string(),
        REASON_NOT_READY => "La transcription locale n'est pas disponible : la dictée n'est pas \
                             prête dans le logiciel de voix. Dictez autrement, ou écrivez."
            .to_string(),
        _ => "La transcription locale n'est pas disponible : le logiciel de voix (VoiceStudio) \
              n'est pas ouvert. Vous pouvez dicter autrement, ou écrire."
            .to_string(),
    }
}

/// Vrai si les langues annoncées par un modèle incluent le français. On ne
/// devine pas : un modèle qui ne dit rien de ses langues n'est PAS retenu.
pub fn model_speaks_french(model: &DictationModel) -> bool {
    let languages = model.languages.to_lowercase();
    if languages.trim().is_empty() {
        return false;
    }
    // Les libellés RÉELS du service : « 25 European languages », « 90+ languages
    // (auto-detect) », « English », « Chinese + English ».
    const HINTS: [&str; 8] = [
        "french",
        "français",
        "francais",
        "european",
        "européen",
        "multilingual",
        "90+",
        "100+",
    ];
    if HINTS.iter().any(|hint| languages.contains(hint)) {
        return true;
    }
    // Un modèle qui liste des codes (« en, fr, de ») : le code seul compte, pas
    // une suite de lettres au hasard à l'intérieur d'un autre mot.
    languages
        .split(|c: char| !c.is_alphanumeric())
        .any(|token| token == "fr")
}

/// Adresse d'état de licence d'un modèle. Aucune référence de dépôt n'est
/// inventée : elle vient de la liste du service (`repo_id`).
pub fn licence_path(repo_id: &str) -> String {
    format!("{}{}", LICENCE_PATH, repo_id.trim().trim_start_matches('/'))
}

/// Ce que dit le service sur la licence d'un modèle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Licence {
    /// Utilisable (licence acceptée, ou aucune acceptation requise).
    Accepted,
    /// Refusée : l'utilisateur doit l'accepter LUI-MÊME dans le logiciel de voix.
    Refused,
    /// Illisible ou incompris : on ne condamne pas un modèle sur un doute (la
    /// session dira la vérité ; le refus y est traité comme une panne dite).
    Unknown,
}

/// Lit l'état d'acceptation renvoyé par le service. Une réponse illisible n'est
/// PAS un refus : elle est `Unknown`, et rien n'est bloqué sur un doute.
pub fn licence_state(json: &str) -> Licence {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(value) => value,
        Err(_) => return Licence::Unknown,
    };
    match value.get("accepted").and_then(|v| v.as_bool()) {
        Some(true) => Licence::Accepted,
        // `accepted: false` est explicite : le service refusera ce modèle.
        Some(false) => Licence::Refused,
        None => Licence::Unknown,
    }
}

/// Phrase qui dit POURQUOI le meilleur modèle ne peut pas servir, et à qui il
/// appartient de le débloquer. Pilot n'accepte aucune licence : c'est un acte de
/// l'utilisateur, dans le logiciel de voix.
pub fn licence_sentence(model: &DictationModel) -> String {
    format!(
        "le modèle « {} » attend l'acceptation de sa licence dans le logiciel de voix : \
         c'est à vous de l'accepter dans son catalogue des modèles (Pilot n'accepte \
         aucune licence à votre place)",
        model.label
    )
}

/// Modèles à essayer, DANS L'ORDRE, pour transcrire du français.
///
/// 1. un modèle DEMANDÉ (par l'application ou par l'utilisateur) : lui seul —
///    on ne substitue jamais en silence un modèle à celui qui a été nommé ;
/// 2. sinon le modèle français préféré, s'il est installé ;
/// 3. puis les autres modèles installés qui savent le français, les modèles
///    recommandés par le service d'abord.
///
/// Le service peut REFUSER un modèle pourtant installé (licence non acceptée,
/// chargement impossible) : c'est pourquoi une LISTE est rendue et non un seul
/// choix. Un modèle absent de la liste n'est jamais téléchargé.
pub fn pick_candidates(
    models: &[DictationModel],
    requested: Option<&str>,
) -> Result<Vec<DictationModel>, String> {
    if let Some(wanted) = requested.map(str::trim).filter(|id| !id.is_empty()) {
        return match models.iter().find(|model| model.id == wanted) {
            Some(model) if model.installed => Ok(vec![model.clone()]),
            Some(model) => Err(format!(
                "le modèle « {} » n'est pas installé dans le logiciel de voix (Pilot ne \
                 télécharge aucun modèle)",
                model.label
            )),
            None => Err(format!(
                "le modèle « {} » est inconnu du logiciel de voix",
                wanted
            )),
        };
    }
    let installed: Vec<DictationModel> = models
        .iter()
        .filter(|model| model.installed && model_speaks_french(model))
        .cloned()
        .collect();
    let mut ordered: Vec<DictationModel> = Vec::with_capacity(installed.len());
    if let Some(preferred) = installed.iter().find(|model| model.id == MODEL_FRENCH) {
        ordered.push(preferred.clone());
    }
    // Les recommandés du service d'abord, puis l'ordre de la liste.
    for wanted_recommended in [true, false] {
        for model in &installed {
            if model.id == MODEL_FRENCH {
                continue;
            }
            if model.recommended == wanted_recommended {
                ordered.push(model.clone());
            }
        }
    }
    if ordered.is_empty() {
        return Err("aucun modèle de dictée installé ne sait le français".to_string());
    }
    Ok(ordered)
}

/// Choix par défaut (aucun modèle imposé par l'appelant).
pub fn choose_model(models: &[DictationModel]) -> Result<DictationModel, String> {
    pick_candidates(models, None).map(|candidates| candidates[0].clone())
}

/// Lit la liste des modèles. Une réponse illisible donne une liste vide (donc
/// « aucun modèle français »), jamais une exception.
pub fn parse_models(json: &str) -> Vec<DictationModel> {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let items = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(map) => ["models", "data", "items"]
            .iter()
            .find_map(|key| map.get(*key).and_then(|list| list.as_array()).cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    items
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return None;
            }
            let text = |key: &str| {
                item.get(key)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string()
            };
            Some(DictationModel {
                id: id.to_string(),
                repo_id: text("repo_id"),
                label: {
                    let label = text("label");
                    if label.is_empty() {
                        id.to_string()
                    } else {
                        label
                    }
                },
                languages: {
                    let languages = text("languages");
                    if languages.is_empty() {
                        text("language")
                    } else {
                        languages
                    }
                },
                installed: item
                    .get("installed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                recommended: item
                    .get("recommended")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                tag: text("tag"),
            })
        })
        .collect()
}

fn describe_missing(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => text.trim().to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(describe_missing)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

/// Ce qui empêche la dictée d'être prête, en clair — `None` = prête.
pub fn readiness_reason(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    if value
        .get("ready")
        .and_then(|ready| ready.as_bool())
        .unwrap_or(true)
    {
        return None;
    }
    let missing = value
        .get("missing")
        .map(describe_missing)
        .unwrap_or_default();
    let missing = missing.trim();
    Some(if missing.is_empty() {
        "la dictée n'est pas prête dans le logiciel de voix".to_string()
    } else {
        format!(
            "la dictée n'est pas prête dans le logiciel de voix ({})",
            missing
        )
    })
}

/// État complet, construit à partir de ce que le service a RÉELLEMENT répondu.
/// Ordre des raisons : service absent ou muet, puis aucun modèle français, puis
/// dictée non prête — on dit la PREMIÈRE chose qui bloque.
pub fn build_status(
    reachable: bool,
    down_reason: &str,
    models_json: &str,
    readiness_json: &str,
) -> AsrStatus {
    let models = parse_models(models_json);
    if !reachable {
        return unavailable(down_reason, down_hint(down_reason), models);
    }
    let chosen = match choose_model(&models) {
        Ok(chosen) => chosen,
        Err(reason) => {
            let hint = format!(
                "La transcription locale n'est pas disponible : {}. Pilot ne télécharge aucun \
                 modèle — dictez autrement, ou écrivez.",
                reason
            );
            return unavailable(REASON_NO_FRENCH_MODEL, hint, models);
        }
    };
    if let Some(ready_why) = readiness_reason(readiness_json) {
        let hint = format!(
            "La transcription locale n'est pas disponible : {}. Dictez autrement, ou écrivez.",
            ready_why
        );
        return unavailable(REASON_NOT_READY, hint, models);
    }
    AsrStatus {
        available: true,
        reason: REASON_OK.to_string(),
        hint: format!(
            "La transcription locale est disponible : la parole est transcrite sur cet ordinateur \
             par le logiciel de voix ({}), sans passer par un service en ligne.",
            chosen.label
        ),
        model_id: chosen.id.clone(),
        model_label: chosen.label.clone(),
        models,
        ..empty_status()
    }
}

/// Vrai si ce que la fenêtre envoie a une taille acceptable. Un morceau trop
/// gros est refusé AVANT le réseau (le service, lui, attend des trames courtes).
pub fn chunk_problem(chunk: &[u8]) -> Option<String> {
    if chunk.is_empty() {
        return Some("morceau de son vide".to_string());
    }
    if chunk.len() > MAX_CHUNK_BYTES {
        return Some(format!(
            "morceau de son trop gros ({} octets, plafond {})",
            chunk.len(),
            MAX_CHUNK_BYTES
        ));
    }
    None
}

/// Encode un identifiant de modèle pour l'adresse (aucune surprise si un jour un
/// identifiant contient autre chose que des minuscules et des tirets).
fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        let safe = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if safe {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// Adresse de la session : boucle locale, modèle IMPOSÉ, PCM brut 16 kHz.
/// Le modèle n'est jamais laissé au choix du service.
pub fn stream_url(model: &str) -> String {
    stream_url_at(BASE_URL, model)
}

/// Même adresse de flux, pour une base DONNÉE (les preuves s'en servent pour
/// éprouver une panne RÉELLE de connexion sans toucher au service de l'utilisateur).
pub fn stream_url_at(base_url: &str, model: &str) -> String {
    let base = if let Some(rest) = base_url.strip_prefix("http://") {
        format!("ws://{}", rest)
    } else if let Some(rest) = base_url.strip_prefix("https://") {
        format!("wss://{}", rest)
    } else {
        base_url.to_string()
    };
    format!(
        "{}{}?model={}&pcm=1&sr={}",
        base,
        STREAM_PATH,
        encode_query(model),
        SAMPLE_RATE
    )
}

/// Phrase lisible pour une panne signalée par le service.
pub fn human_error(service_kind: &str, detail: &str) -> String {
    let detail = detail.trim();
    let with_detail = |base: &str| {
        if detail.is_empty() {
            base.to_string()
        } else {
            format!("{} ({})", base, detail)
        }
    };
    match service_kind.trim() {
        "asr_model_missing" => with_detail(
            "le logiciel de voix n'a pas installé le modèle de dictée demandé",
        ),
        "load" => with_detail("le modèle de dictée n'a pas pu être chargé"),
        "model_licence_required" => with_detail(
            "le modèle de dictée attend une acceptation de licence dans le logiciel de voix",
        ),
        "" => with_detail("le logiciel de voix a signalé une erreur"),
        other => with_detail(&format!(
            "le logiciel de voix a signalé une erreur ({})",
            other
        )),
    }
}

/// Ce que l'avancement du modèle veut dire, en clair.
pub fn stage_message(stage: &str) -> String {
    match stage.trim() {
        "loading" => "le logiciel de voix charge le modèle de dictée".to_string(),
        "downloading" => "le logiciel de voix prépare le modèle de dictée".to_string(),
        "ready" => "le modèle de dictée est prêt".to_string(),
        other if other.is_empty() => "le logiciel de voix se prépare".to_string(),
        other => format!("le logiciel de voix se prépare ({})", other),
    }
}

/// Lit une trame du service. `None` = trame sans intérêt (rien à peindre), ce
/// qui n'est jamais une erreur : le protocole envoie des accusés techniques.
pub fn parse_event(raw: &str) -> Option<TranscriptEvent> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let message_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let text = value
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let mut event = TranscriptEvent::default();
    match message_type.as_str() {
        "session.started" => {
            event.kind = "started".to_string();
            let engine = value
                .get("engine")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            event.engine = engine.to_string();
        }
        "status" => {
            event.kind = "status".to_string();
            event.stage = value
                .get("stage")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            event.message = stage_message(&event.stage);
        }
        "partial" => {
            if text.is_empty() {
                return None;
            }
            event.kind = "partial".to_string();
            event.text = text;
        }
        "final" => {
            event.kind = "final".to_string();
            event.final_kind = value
                .get("final_kind")
                .and_then(|v| v.as_str())
                .unwrap_or("summary")
                .trim()
                .to_lowercase();
            event.engine = value
                .get("engine")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            // Un final `utterance` vide n'apprend rien ; un final `summary` vide
            // dit au contraire « aucune parole reconnue » et doit être rendu.
            if text.is_empty() && event.final_kind != "summary" {
                return None;
            }
            event.text = text;
        }
        "error" => {
            event.kind = "error".to_string();
            let detail = value
                .get("message")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("detail").and_then(|v| v.as_str()))
                .unwrap_or("");
            let service_kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            event.message = human_error(service_kind, detail);
        }
        other => {
            event.kind = "other".to_string();
            event.message = other.to_string();
        }
    }
    Some(event)
}

// ---------------------------------------------------------------------------
// Réseau : la SEULE porte vers le service (côté machine)
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("client HTTP indisponible ({})", error))
}

fn fetch_text(http: &reqwest::blocking::Client, path: &str) -> Result<String, String> {
    fetch_text_at(http, BASE_URL, path)
}

/// Même lecture, sur une base DONNÉE (une preuve peut éprouver une base fermée).
fn fetch_text_at(
    http: &reqwest::blocking::Client,
    base_url: &str,
    path: &str,
) -> Result<String, String> {
    let url = format!("{}{}", base_url, path);
    let response = http
        .get(&url)
        .send()
        .map_err(|error| format!("service injoignable ({})", error))?;
    if !response.status().is_success() {
        return Err(format!(
            "service en erreur (HTTP {})",
            response.status().as_u16()
        ));
    }
    Ok(response.text().unwrap_or_default())
}

/// Sonde RÉELLE : santé, modèles installés, préparation. Jamais d'exception —
/// une panne devient un état lisible.
pub fn probe_blocking() -> AsrStatus {
    probe_base(BASE_URL)
}

/// Sonde la MÊME voie (santé, modèles, préparation) sur une base donnée.
pub fn probe_base(base_url: &str) -> AsrStatus {
    let http = match http_client() {
        Ok(http) => http,
        Err(_) => return unavailable(REASON_ABSENT, down_hint(REASON_ABSENT), Vec::new()),
    };
    let health = http.get(format!("{}{}", base_url, HEALTH_PATH)).send();
    let down_reason = match health {
        Ok(response) if response.status().is_success() => "",
        Ok(_) => REASON_MUTE,
        Err(error) if error.is_timeout() => REASON_MUTE,
        Err(_) => REASON_ABSENT,
    };
    if !down_reason.is_empty() {
        return unavailable(down_reason, down_hint(down_reason), Vec::new());
    }
    // Le service répond : la liste des modèles est la seule chose qui décide de
    // la suite. Si elle ne répond plus, c'est que le service est devenu muet.
    let models_json = match fetch_text_at(&http, base_url, MODELS_PATH) {
        Ok(body) => body,
        Err(_) => return unavailable(REASON_MUTE, down_hint(REASON_MUTE), Vec::new()),
    };
    // La préparation n'est qu'une information : une réponse illisible ne
    // fabrique pas une panne.
    let readiness_json = fetch_text_at(&http, base_url, READINESS_PATH).unwrap_or_default();
    build_status(true, "", &models_json, &readiness_json)
}

/// Modèles à essayer, décidés à partir de la liste RÉELLE du service et de
/// l'état RÉEL de leurs licences.
///
/// Le service refuse un modèle installé dont la licence n'a pas été acceptée :
/// le lui faire dire par une session ouverte serait un échec à chaque dictée et
/// une panne peu compréhensible. On le lui DEMANDE avant, et on l'explique.
/// Aucune licence n'est acceptée ici : c'est un acte de l'utilisateur.
pub fn resolve_models_blocking(
    requested: Option<&str>,
) -> Result<Vec<DictationModel>, String> {
    let http = http_client()?;
    let models_json = fetch_text(&http, MODELS_PATH)?;
    let candidates = pick_candidates(&parse_models(&models_json), requested)?;
    let mut usable = Vec::with_capacity(candidates.len());
    let mut blocked: Vec<String> = Vec::new();
    for model in candidates {
        // Sans référence de dépôt, aucune question n'est possible : on essaie
        // (le service tranche, et sa réponse est déjà une phrase lisible).
        if model.repo_id.trim().is_empty() {
            usable.push(model);
            continue;
        }
        let state = fetch_text(&http, &licence_path(&model.repo_id))
            .map(|json| licence_state(&json))
            .unwrap_or(Licence::Unknown);
        match state {
            Licence::Refused => blocked.push(licence_sentence(&model)),
            Licence::Accepted | Licence::Unknown => usable.push(model),
        }
    }
    if usable.is_empty() {
        // Aucun modèle français utilisable : la raison nomme le verrou EXACT.
        return Err(match blocked.len() {
            0 => "aucun modèle de dictée installé ne sait le français".to_string(),
            1 => blocked.remove(0),
            _ => format!(
                "aucun modèle de dictée utilisable ; {} ; {}",
                blocked[0], blocked[1]
            ),
        });
    }
    Ok(usable)
}

/// Premier modèle à essayer (le préféré quand rien n'est demandé). Utile à
/// l'étape 2 ; gardé ici pour que « premier candidat » ne soit jamais recalculé
/// ailleurs.
#[allow(dead_code)]
pub fn resolve_model_blocking(requested: Option<&str>) -> Result<DictationModel, String> {
    resolve_models_blocking(requested).map(|candidates| candidates[0].clone())
}

fn down_sentence(reason: &str) -> String {
    format!(
        "La transcription locale n'est pas disponible : {}.",
        reason
    )
}

// ---------------------------------------------------------------------------
// Session : un seul propriétaire à la fois
// ---------------------------------------------------------------------------

enum SessionInput {
    Audio(Vec<u8>),
    End,
    Cancel,
}

struct ActiveSession {
    session_id: String,
    tx: UnboundedSender<SessionInput>,
}

/// Sessions ouvertes par la fenêtre (état Tauri). Une seule dictée à la fois :
/// en ouvrir une nouvelle referme proprement la précédente.
#[derive(Default)]
pub struct AsrSessions {
    active: Arc<Mutex<Option<ActiveSession>>>,
}

fn session_sender(
    state: &AsrSessions,
    session_id: &str,
) -> Result<UnboundedSender<SessionInput>, String> {
    let guard = state
        .active
        .lock()
        .map_err(|_| "l'état de la dictée locale est illisible".to_string())?;
    match guard.as_ref() {
        Some(active) if active.session_id == session_id => Ok(active.tx.clone()),
        Some(_) => Err("cette session de dictée locale n'est plus la session courante".to_string()),
        None => Err("aucune session de dictée locale n'est ouverte".to_string()),
    }
}

type LocalSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Résultat d'une tentative d'ouverture, pour UN modèle nommé.
enum Handshake {
    /// Session ouverte : le service écoute (moteur effectivement retenu).
    Ready(LocalSocket, String),
    /// Le service a REFUSÉ ce modèle (licence non acceptée, chargement
    /// impossible, modèle manquant) : un autre modèle peut être essayé.
    Refused(String),
    /// Le service est muet ou injoignable : inutile d'essayer un autre modèle.
    Unreachable(String),
}

/// Ouvre UNE session pour UN modèle imposé, et attend que le service dise
/// « c'est parti » (ou qu'il refuse). Aucun son n'est envoyé à ce stade.
async fn open_session(model: &str) -> Handshake {
    open_session_at(BASE_URL, model).await
}

/// Même ouverture, sur une base DONNÉE : c'est par là que la preuve éprouve un
/// service ARRÊTÉ (refus de connexion réel) sans toucher à son application.
async fn open_session_at(base_url: &str, model: &str) -> Handshake {
    let url = stream_url_at(base_url, model);
    let mut socket = match tokio::time::timeout(CONNECT_TIMEOUT, connect_async(url.as_str())).await {
        Ok(Ok((socket, _response))) => socket,
        Ok(Err(_)) => {
            return Handshake::Unreachable("le logiciel de voix n'a pas ouvert de session".to_string())
        }
        Err(_) => {
            return Handshake::Unreachable("le logiciel de voix ne répond pas".to_string())
        }
    };
    let deadline = tokio::time::Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        let incoming = match tokio::time::timeout(left, socket.next()).await {
            // Le service n'a rien dit : inutile d'attendre davantage.
            Err(_) => {
                return Handshake::Unreachable(
                    "le logiciel de voix n'a pas répondu à l'ouverture de la dictée".to_string(),
                )
            }
            Ok(None) => {
                return Handshake::Unreachable(
                    "le logiciel de voix a refermé la session avant de l'ouvrir".to_string(),
                )
            }
            Ok(Some(Err(_))) => {
                return Handshake::Unreachable(
                    "la session de dictée locale s'est interrompue".to_string(),
                )
            }
            Ok(Some(Ok(message))) => message,
        };
        match incoming {
            Message::Text(text) => {
                let event = match parse_event(&text) {
                    Some(event) => event,
                    None => continue,
                };
                match event.kind.as_str() {
                    "started" => return Handshake::Ready(socket, event.engine),
                    "error" => return Handshake::Refused(event.message),
                    // `status` : le modèle se charge, on attend la suite.
                    _ => continue,
                }
            }
            Message::Close(_) => {
                return Handshake::Unreachable(
                    "le logiciel de voix a refermé la session avant de l'ouvrir".to_string(),
                )
            }
            _ => continue,
        }
    }
}

fn emit_event(app: &tauri::AppHandle, session_id: &str, event: TranscriptEvent) {
    use tauri::Emitter;
    let mut event = event;
    event.session_id = session_id.to_string();
    // La fenêtre peut être fermée : un évènement sans preneur n'est pas une panne.
    let _ = app.emit(EVENT_TRANSCRIPT, &event);
}

fn emit_error(app: &tauri::AppHandle, session_id: &str, message: &str, started: std::time::Instant) {
    emit_event(
        app,
        session_id,
        TranscriptEvent {
            kind: "error".to_string(),
            message: message.to_string(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            ..TranscriptEvent::default()
        },
    );
}

fn emit_ended(app: &tauri::AppHandle, session_id: &str, started: std::time::Instant) {
    emit_event(
        app,
        session_id,
        TranscriptEvent {
            kind: "ended".to_string(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            ..TranscriptEvent::default()
        },
    );
}

/// Conduit UNE session : écrit le son vers le service, rend chaque trame lue à la
/// fenêtre, se referme sur le texte final (ou sur une panne dite).
async fn run_session(
    app: tauri::AppHandle,
    session_id: String,
    socket: LocalSocket,
    mut rx: UnboundedReceiver<SessionInput>,
) {
    let started = std::time::Instant::now();
    let (mut sink, mut stream) = socket.split();
    let mut deadline: Option<tokio::time::Instant> = None;
    loop {
        let timeout_at = deadline.unwrap_or_else(tokio::time::Instant::now);
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(mut event) = parse_event(&text) {
                            event.elapsed_ms = started.elapsed().as_millis() as u64;
                            let summary = event.kind == "final" && event.final_kind == "summary";
                            if event.kind == "error" {
                                let message = event.message.clone();
                                emit_event(&app, &session_id, event);
                                log_with_app(&app, &format!("service : {}", message));
                                break;
                            }
                            emit_event(&app, &session_id, event);
                            if summary {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        // Le service a refermé sans rendre son texte final : ce
                        // n'est pas un silence, c'est une panne à dire.
                        if deadline.is_some() {
                            emit_error(
                                &app,
                                &session_id,
                                "le logiciel de voix a refermé la session sans rendre le texte final",
                                started,
                            );
                            log_with_app(&app, "session refermée sans texte final");
                        }
                        break;
                    }
                    Some(Err(error)) => {
                        emit_error(
                            &app,
                            &session_id,
                            "la session de dictée locale s'est interrompue",
                            started,
                        );
                        log_with_app(&app, &format!("flux interrompu — {}", error));
                        break;
                    }
                    _ => {}
                }
            }
            input = rx.recv() => {
                match input {
                    Some(SessionInput::Audio(bytes)) => {
                        if bytes.is_empty() {
                            continue;
                        }
                        if sink.send(Message::Binary(bytes)).await.is_err() {
                            emit_error(
                                &app,
                                &session_id,
                                "la session de dictée locale s'est interrompue",
                                started,
                            );
                            break;
                        }
                    }
                    Some(SessionInput::End) => {
                        let _ = sink.send(Message::Text(END_FRAME.to_string())).await;
                        // Fin de flux SANS fermer la socket : le service doit
                        // garder le conduit ouvert pour rendre son texte final
                        // (se refermer soi-même perdrait le texte, la fenêtre
                        // n'aurait que des partiels).
                        // Le texte final arrive après la fin du flux : on attend,
                        // mais jamais indéfiniment.
                        deadline = Some(tokio::time::Instant::now() + FINAL_TIMEOUT);
                    }
                    Some(SessionInput::Cancel) | None => break,
                }
            }
            _ = tokio::time::sleep_until(timeout_at), if deadline.is_some() => {
                emit_error(
                    &app,
                    &session_id,
                    "le logiciel de voix ne répond plus : le texte final n'est pas arrivé",
                    started,
                );
                log_with_app(&app, "texte final absent (délai dépassé)");
                break;
            }
        }
    }
    let _ = sink.close().await;
    emit_ended(&app, &session_id, started);
}

/// Écrit une ligne dans le journal de la voix locale (même fichier que le frère).
fn log_with_app(app: &tauri::AppHandle, message: &str) {
    let text = String::from(message).trim().to_string();
    if text.is_empty() {
        return;
    }
    if let Some(root) = local_voice_root(app) {
        append_log(&root, &format!("[oreille locale] {}", text));
    }
}

// ---------------------------------------------------------------------------
// Commandes Tauri — toutes `pub async fn` : rien ne s'exécute sur le thread
// principal (règle anti-gel du projet), et aucune fenêtre ne joint le service.
// ---------------------------------------------------------------------------

/// « Peut-on transcrire ici, et sinon pourquoi ? » — jamais un code brut.
#[tauri::command]
pub async fn asr_voicestudio_status() -> AsrStatus {
    tauri::async_runtime::spawn_blocking(probe_blocking)
        .await
        .unwrap_or_else(|_| unavailable(REASON_ABSENT, down_hint(REASON_ABSENT), Vec::new()))
}

/// Ouvre une dictée locale. Refus explicite si le service est injoignable, s'il
/// n'a aucun modèle français, ou si aucun modèle français n'a pu être ouvert par
/// le service (licence non acceptée, chargement impossible).
#[tauri::command]
pub async fn asr_voicestudio_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AsrSessions>,
    model: Option<String>,
) -> Result<AsrSession, String> {
    let requested = model.unwrap_or_default();
    let candidates = tauri::async_runtime::spawn_blocking(move || {
        resolve_models_blocking(Some(requested.as_str())).map_err(|reason| down_sentence(&reason))
    })
    .await
    .map_err(|error| format!("Erreur interne (asr_voicestudio_start) : {}", error))??;

    // Chaque modèle français est ESSAYÉ (le service peut en refuser un pourtant
    // installé — licence non acceptée). Le refus est dit, jamais contourné en
    // silence, et aucune licence n'est acceptée à la place de l'utilisateur.
    let mut refused: Option<String> = None;
    let mut opened: Option<(DictationModel, LocalSocket, String)> = None;
    for candidate in &candidates {
        match open_session(&candidate.id).await {
            Handshake::Ready(socket, engine) => {
                opened = Some((candidate.clone(), socket, engine));
                break;
            }
            Handshake::Refused(message) => {
                log_with_app(
                    &app,
                    &format!("modèle « {} » refusé par le service — {}", candidate.label, message),
                );
                refused = Some(message);
            }
            Handshake::Unreachable(message) => {
                log_with_app(&app, &format!("session impossible — {}", message));
                return Err(down_sentence(&message));
            }
        }
    }
    let (picked, socket, engine) = match opened {
        Some(opened) => opened,
        None => {
            return Err(down_sentence(&refused.unwrap_or_else(|| {
                "le logiciel de voix n'a ouvert aucune session de dictée".to_string()
            })))
        }
    };
    let url = stream_url(&picked.id);

    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    // Une seule dictée à la fois : la précédente est refermée, jamais laissée
    // ouverte en arrière-plan (deux micros ouverts = deux textes mélangés).
    if let Some(previous) = state.active.lock().ok().and_then(|mut slot| slot.take()) {
        let _ = previous.tx.send(SessionInput::Cancel);
        log_with_app(&app, "session précédente refermée");
    }
    if let Ok(mut slot) = state.active.lock() {
        *slot = Some(ActiveSession {
            session_id: session_id.clone(),
            tx,
        });
    }

    let task_app = app.clone();
    let task_slot = state.active.clone();
    let task_id = session_id.clone();
    let task_engine = engine.clone();
    tauri::async_runtime::spawn(async move {
        // Le premier évènement dit QUELLE session est ouverte (le service a pu
        // retenir un autre modèle que le préféré, il faut le dire).
        emit_event(
            &task_app,
            &task_id,
            TranscriptEvent {
                kind: "started".to_string(),
                engine: task_engine,
                ..TranscriptEvent::default()
            },
        );
        run_session(task_app, task_id.clone(), socket, rx).await;
        if let Ok(mut slot) = task_slot.lock() {
            let finished = slot
                .as_ref()
                .map(|active| active.session_id == task_id)
                .unwrap_or(false);
            if finished {
                *slot = None;
            }
        }
    });

    log_with_app(&app, &format!("dictée locale ouverte ({})", picked.label));
    Ok(AsrSession {
        session_id,
        model_id: picked.id.clone(),
        model_label: picked.label.clone(),
        sample_rate: SAMPLE_RATE,
        stream_url: url,
    })
}

/// Reçoit un morceau de son (PCM 16 kHz mono 16 bits). Jamais bloquant : le
/// morceau part dans la session et la commande rend la main aussitôt.
#[tauri::command]
pub async fn asr_voicestudio_send(
    state: tauri::State<'_, AsrSessions>,
    session_id: String,
    chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(problem) = chunk_problem(&chunk) {
        return Err(problem);
    }
    let tx = session_sender(&state, &session_id)?;
    tx.send(SessionInput::Audio(chunk))
        .map_err(|_| "la session de dictée locale est terminée".to_string())
}

/// Ferme la dictée proprement : le service rend son texte final, qui arrive par
/// l'évènement `final` (kind `summary`).
#[tauri::command]
pub async fn asr_voicestudio_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, AsrSessions>,
    session_id: String,
) -> Result<(), String> {
    let tx = session_sender(&state, &session_id)?;
    tx.send(SessionInput::End)
        .map_err(|_| "la session de dictée locale est terminée".to_string())?;
    log_with_app(&app, "dictée locale refermée (attente du texte final)");
    Ok(())
}

/// Interrompt la dictée sur-le-champ (fermeture de l'écran, changement de mode,
/// panne côté fenêtre) : rien n'est gardé, rien n'est écrit, aucun texte n'est
/// promis.
#[tauri::command]
pub async fn asr_voicestudio_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, AsrSessions>,
    session_id: String,
) -> Result<(), String> {
    let guard = state
        .active
        .lock()
        .map_err(|_| "l'état de la dictée locale est illisible".to_string())?;
    let sender = match guard.as_ref() {
        Some(active) if active.session_id == session_id => Some(active.tx.clone()),
        _ => None,
    };
    drop(guard);
    match sender {
        Some(tx) => {
            let _ = tx.send(SessionInput::Cancel);
            log_with_app(&app, "dictée locale interrompue");
            Ok(())
        }
        // Interrompre une session déjà finie n'est pas une erreur : c'est le cas
        // normal d'un écran qui se ferme après le texte final.
        None => Ok(()),
    }
}

/// Journal de l'oreille locale (même fichier texte que la voix imitée), déporté
/// du thread principal comme le reste.
#[tauri::command]
pub async fn asr_voicestudio_log(app: tauri::AppHandle, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || log_with_app(&app, &message))
        .await
        .map_err(|error| format!("Erreur interne (asr_voicestudio_log) : {}", error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, languages: &str, installed: bool) -> DictationModel {
        DictationModel {
            id: id.to_string(),
            repo_id: format!("exemple/{}", id),
            label: id.to_uppercase(),
            languages: languages.to_string(),
            installed,
            recommended: false,
            tag: String::new(),
        }
    }

    fn models_json() -> String {
        // Libellés ET références de dépôt copiés de la RÉPONSE RÉELLE du service
        // (`/dictation/models`).
        serde_json::json!({
            "models": [
                { "id": "sherpa-whisper-tiny", "repo_id": "csukuangfj/sherpa-onnx-whisper-tiny", "label": "Whisper tiny", "languages": "90+ languages (auto-detect)", "installed": true, "recommended": true, "tag": "offline" },
                { "id": "sherpa-parakeet-tdt-v3", "repo_id": "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "label": "Parakeet TDT v3", "languages": "25 European languages", "installed": true, "recommended": false, "tag": "offline" },
                { "id": "sherpa-zipformer-en-20m", "repo_id": "csukuangfj/sherpa-onnx-zipformer-en-20m", "label": "Zipformer EN", "languages": "English", "installed": false, "tag": "streaming" },
                { "id": "sherpa-paraformer-bilingual-zh-en", "label": "Paraformer", "languages": "Chinese + English", "installed": false, "tag": "streaming" }
            ]
        })
        .to_string()
    }

    #[test]
    fn la_liste_des_modeles_est_lue_sans_inventer() {
        let models = parse_models(&models_json());
        assert_eq!(models.len(), 4);
        assert_eq!(models[0].id, "sherpa-whisper-tiny");
        assert!(models[0].installed);
        assert!(models[0].recommended);
        assert_eq!(models[0].tag, "offline");
        assert!(!models[2].installed);
        // Une réponse illisible ne produit pas d'exception, juste aucune liste.
        assert!(parse_models("pas du json").is_empty());
        assert!(parse_models("{\"models\":\"non\"}").is_empty());
    }

    #[test]
    fn le_modele_francais_est_impose_et_jamais_celui_du_service() {
        let models = parse_models(&models_json());
        // Le service, lui, a `sherpa-whisper-tiny` par défaut : on ne le suit pas.
        let chosen = choose_model(&models).expect("un modèle français est installé");
        assert_eq!(chosen.id, MODEL_FRENCH);
        // Et le modèle choisi est bien dans l'adresse : le service ne décide pas.
        assert!(stream_url(&chosen.id).contains(&format!("model={}", MODEL_FRENCH)));
    }

    #[test]
    fn aucun_modele_francais_installe_est_une_raison_dite() {
        let models = parse_models(&models_json());
        // Le modèle français existe dans la liste mais n'est pas installé : on ne
        // le télécharge pas, on le dit.
        let mut without_installed_french = models.clone();
        for model in without_installed_french.iter_mut() {
            if model.id == MODEL_FRENCH || model.id == "sherpa-whisper-tiny" {
                model.installed = false;
            }
        }
        let reason = choose_model(&without_installed_french).unwrap_err();
        assert!(reason.contains("aucun modèle"));
        assert!(!reason.contains("télécharg"));
    }

    #[test]
    fn un_modele_demande_absent_est_refuse_sans_telechargement() {
        let models = parse_models(&models_json());
        let refused = pick_candidates(&models, Some("sherpa-zipformer-en-20m")).unwrap_err();
        assert!(refused.contains("n'est pas installé"));
        assert!(refused.contains("Pilot ne télécharge aucun modèle"));
        // Modèle inconnu du service : dit aussi, sans exception.
        let unknown = pick_candidates(&models, Some("modele-fantome")).unwrap_err();
        assert!(unknown.contains("inconnu"));
        // Un modèle imposé VALIDÉ passe tel quel (le français n'est pas exigé de
        // force quand l'appelant sait ce qu'il veut), et LUI SEUL : on ne
        // substitue jamais un autre modèle à celui qui a été nommé.
        let named = pick_candidates(&models, Some("sherpa-whisper-tiny")).unwrap();
        assert_eq!(named.len(), 1);
        assert_eq!(named[0].id, "sherpa-whisper-tiny");
        // Demande vide = choix par défaut, jamais une erreur.
        assert_eq!(pick_candidates(&models, Some("  ")).unwrap()[0].id, MODEL_FRENCH);
        assert_eq!(pick_candidates(&models, None).unwrap()[0].id, MODEL_FRENCH);
    }

    #[test]
    fn la_licence_d_un_modele_est_lue_et_dite_avant_d_ouvrir_une_session() {
        // Réponses RÉELLES du service (2026-11-14) pour les deux modèles installés.
        let parakeet = "{\"repo_id\":\"csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8\",\"category\":\"unknown\",\"required\":true,\"accepted\":false,\"state\":\"not_accepted\"}";
        let whisper = "{\"repo_id\":\"csukuangfj/sherpa-onnx-whisper-tiny\",\"category\":\"unknown\",\"required\":true,\"accepted\":true,\"state\":\"accepted\"}";
        assert_eq!(licence_state(parakeet), Licence::Refused);
        assert_eq!(licence_state(whisper), Licence::Accepted);
        // Une réponse illisible n'est PAS un refus : on ne condamne pas sur un doute.
        assert_eq!(licence_state(""), Licence::Unknown);
        assert_eq!(licence_state("pas du json"), Licence::Unknown);
        assert_eq!(licence_state("{\"state\":\"accepted\"}"), Licence::Unknown);
        // L'adresse de la question vient de la liste du service, jamais d'un dur.
        assert_eq!(
            licence_path("csukuangfj/sherpa-onnx-whisper-tiny"),
            "/models/licenses/acceptance/csukuangfj/sherpa-onnx-whisper-tiny"
        );
        assert_eq!(licence_path("/deja-bon/x"), "/models/licenses/acceptance/deja-bon/x");
    }

    #[test]
    fn une_licence_non_acceptee_ne_l_est_jamais_a_la_place_de_l_utilisateur() {
        // La phrase dit le VERROU et À QUI il appartient. Aucune commande du
        // module n'écrit une acceptation : on ne fait que la lire.
        let sentence = licence_sentence(&model(MODEL_FRENCH, "25 European languages", true));
        assert!(sentence.contains("attend l'acceptation de sa licence"), "{}", sentence);
        assert!(sentence.contains("c'est à vous"));
        assert!(sentence.contains("Pilot n'accepte"));
        // Aucune requête d'acceptation n'est écrite dans ce module : le code de
        // PRODUCTION ne sait que LIRE l'état (`GET`), donc il ne peut pas
        // accepter une licence à votre place (`include_str!` = source réel).
        let code = include_str!("asr_voicestudio.rs");
        let production = code.split("#[cfg(test)]").next().unwrap_or("");
        assert!(production.contains(".get("), "la licence est lue par un GET");
        assert!(!production.contains(".post("), "aucune acceptation envoyée");
    }

    #[test]
    fn un_modele_refuse_par_le_service_laisse_essayer_le_suivant() {
        // Cas RÉEL du 2026-11-14 : le modèle préféré est installé mais le service
        // le refuse (licence non acceptée). La liste doit donc continuer, et le
        // repli doit être un modèle QUI SAIT LE FRANÇAIS, jamais n'importe lequel.
        let models = parse_models(&models_json());
        let candidates = pick_candidates(&models, None).unwrap();
        assert!(candidates.len() >= 2, "il doit rester un repli après le préféré");
        assert_eq!(candidates[0].id, MODEL_FRENCH);
        assert_ne!(candidates[1].id, MODEL_FRENCH);
        for candidate in &candidates {
            assert!(candidate.installed, "{} n'est pas installé", candidate.id);
            assert!(
                model_speaks_french(candidate),
                "{} ne sait pas le français",
                candidate.id
            );
        }
        // Aucun doublon : chaque modèle est essayé une seule fois.
        let mut ids: Vec<&str> = candidates.iter().map(|model| model.id.as_str()).collect();
        ids.sort_unstable();
        let total = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), total);
    }

    #[test]
    fn un_modele_impose_ne_se_replie_pas_tout_seul() {
        // Un modèle NOMMÉ par l'application ne doit pas être remplacé en silence :
        // s'il est refusé, la panne est dite à l'appelant (une seule tentative).
        let models = parse_models(&models_json());
        let named = pick_candidates(&models, Some(MODEL_FRENCH)).unwrap();
        assert_eq!(named.len(), 1);
        assert_eq!(named[0].id, MODEL_FRENCH);
    }

    #[test]
    fn un_modele_qui_ne_dit_rien_de_ses_langues_n_est_pas_retenu() {
        assert!(model_speaks_french(&model("a", "25 European languages", true)));
        assert!(model_speaks_french(&model("b", "90+ languages (auto-detect)", true)));
        assert!(model_speaks_french(&model("c", "en, fr, de", true)));
        assert!(model_speaks_french(&model("d", "French", true)));
        assert!(!model_speaks_french(&model("e", "English", true)));
        assert!(!model_speaks_french(&model("f", "Chinese + English", true)));
        assert!(!model_speaks_french(&model("g", "", true)));
        assert!(!model_speaks_french(&model("h", "Afrikaans", true)));
    }

    #[test]
    fn un_service_absent_est_dit_en_une_phrase_et_un_code_stable() {
        let status = build_status(false, REASON_ABSENT, "", "");
        assert!(!status.available);
        assert_eq!(status.reason, REASON_ABSENT);
        assert!(status.hint.contains("n'est pas ouvert"));
        assert!(status.hint.contains("dicter autrement"));
        // Aucun code technique ne fuit dans la phrase.
        assert!(!status.hint.contains("HTTP"));
        assert!(!status.hint.contains("reqwest"));
    }

    #[test]
    fn un_service_muet_est_dit_autrement_qu_un_service_absent() {
        let muet = build_status(false, REASON_MUTE, "", "");
        let absent = build_status(false, REASON_ABSENT, "", "");
        assert_eq!(muet.reason, REASON_MUTE);
        assert!(muet.hint.contains("ne répond pas"));
        assert_ne!(muet.hint, absent.hint);
    }

    #[test]
    fn sans_modele_francais_la_raison_nomme_le_probleme_et_pas_un_telechargement() {
        let status = build_status(true, "", "{\"models\":[]}", "{\"ready\":true}");
        assert!(!status.available);
        assert_eq!(status.reason, REASON_NO_FRENCH_MODEL);
        assert!(status.hint.contains("aucun modèle de dictée installé ne sait le français"));
    }

    #[test]
    fn dictee_non_prete_est_dite_et_empeche_l_ouverture() {
        let status = build_status(
            true,
            "",
            &models_json(),
            "{\"ready\":false,\"missing\":\"microphone\"}",
        );
        assert!(!status.available);
        assert_eq!(status.reason, REASON_NOT_READY);
        assert!(status.hint.contains("microphone"));
    }

    #[test]
    fn quand_tout_est_la_le_statut_est_disponible_et_nomme_le_modele() {
        let status = build_status(true, "", &models_json(), "{\"ready\":true,\"missing\":null}");
        assert!(status.available);
        assert_eq!(status.reason, REASON_OK);
        assert_eq!(status.model_id, MODEL_FRENCH);
        assert_eq!(status.sample_rate, SAMPLE_RATE);
        assert!(status.hint.contains("sur cet ordinateur"));
        // La phrase ne promet PAS que le son ne sort plus de la machine : l'étape
        // 1 ne branche pas encore l'écran, donc rien ne serait vrai.
        assert!(!status.hint.contains("ne quitte plus"));
    }

    #[test]
    fn une_preparation_illisible_ne_fabrique_pas_une_panne() {
        assert_eq!(readiness_reason(""), None);
        assert_eq!(readiness_reason("pas du json"), None);
        assert_eq!(readiness_reason("{\"ready\":true}"), None);
        assert!(readiness_reason("{\"ready\":false}").is_some());
    }

    #[test]
    fn l_adresse_du_flux_reste_locale_et_impose_le_modele() {
        let url = stream_url("sherpa-parakeet-tdt-v3");
        let expected = format!(
            "{}{}?model=sherpa-parakeet-tdt-v3&pcm=1&sr=16000",
            BASE_URL.replacen("http://", "ws://", 1),
            STREAM_PATH
        );
        assert_eq!(url, expected);
        assert!(url.starts_with("ws://"));
        assert!(!url.contains("http://"));
        assert!(!url.contains("https://"));
        // Le modèle n'est jamais laissé au choix du service.
        assert!(url.contains("model="));
    }

    #[test]
    fn un_identifiant_de_modele_est_encode_pour_ne_casser_l_adresse() {
        assert_eq!(encode_query("sherpa-parakeet-tdt-v3"), "sherpa-parakeet-tdt-v3");
        assert_eq!(encode_query("a b&c"), "a%20b%26c");
    }

    #[test]
    fn les_trames_du_service_sont_lues_sans_exception() {
        let partial = parse_event("{\"type\":\"partial\",\"text\":\"bonjour tout\"}").unwrap();
        assert_eq!(partial.kind, "partial");
        assert_eq!(partial.text, "bonjour tout");

        // Un partiel vide n'apprend rien : rien à peindre, et ce n'est pas une erreur.
        assert!(parse_event("{\"type\":\"partial\",\"text\":\"  \"}").is_none());
        assert!(parse_event("pas du json").is_none());
        assert!(parse_event("").is_none());

        let utterance = parse_event(
            "{\"type\":\"final\",\"text\":\"Bonjour.\",\"final_kind\":\"utterance\",\"engine\":\"parakeet\"}",
        )
        .unwrap();
        assert_eq!(utterance.kind, "final");
        assert_eq!(utterance.final_kind, "utterance");
        assert_eq!(utterance.engine, "parakeet");

        let summary = parse_event(
            "{\"type\":\"final\",\"text\":\"Bonjour tout le monde.\",\"final_kind\":\"summary\"}",
        )
        .unwrap();
        assert_eq!(summary.final_kind, "summary");
        assert_eq!(summary.text, "Bonjour tout le monde.");

        // Un final vide SANS `final_kind` est le texte qui fait foi : on le rend.
        let empty_summary = parse_event("{\"type\":\"final\",\"text\":\"\"}").unwrap();
        assert_eq!(empty_summary.kind, "final");
        assert_eq!(empty_summary.final_kind, "summary");
        assert_eq!(empty_summary.text, "");
        // Un final `utterance` vide, lui, n'apprend rien.
        assert!(parse_event("{\"type\":\"final\",\"text\":\"\",\"final_kind\":\"utterance\"}").is_none());

        let started = parse_event("{\"type\":\"session.started\",\"engine\":\"sherpa\"}").unwrap();
        assert_eq!(started.kind, "started");

        let status = parse_event("{\"type\":\"status\",\"stage\":\"loading\"}").unwrap();
        assert_eq!(status.kind, "status");
        assert_eq!(status.stage, "loading");
        assert!(status.message.contains("charge le modèle"));
    }

    #[test]
    fn une_panne_du_service_devient_une_phrase_francaise() {
        let error = parse_event(
            "{\"type\":\"error\",\"message\":\"boom\",\"kind\":\"asr_model_missing\"}",
        )
        .unwrap();
        assert_eq!(error.kind, "error");
        assert!(error.message.contains("n'a pas installé le modèle"));
        assert!(error.message.contains("boom"));

        let load = human_error("load", "");
        assert!(load.contains("n'a pas pu être chargé"));
        assert!(!load.contains("()"));

        let unknown = human_error("weird", "détail");
        assert!(unknown.contains("weird"));
        assert!(unknown.contains("détail"));
        let empty = human_error("", "");
        assert_eq!(empty, "le logiciel de voix a signalé une erreur");
    }

    #[test]
    fn un_morceau_de_son_vide_ou_trop_gros_est_refuse_avant_le_reseau() {
        assert!(chunk_problem(&[]).is_some());
        assert!(chunk_problem(&vec![0u8; 3200]).is_none());
        assert!(chunk_problem(&vec![0u8; MAX_CHUNK_BYTES + 1]).is_some());
        // Un morceau de 100 ms à 16 kHz mono 16 bits tient largement.
        assert!(chunk_problem(&vec![0u8; 3200 * 4]).is_none());
    }

    // -- Utilitaires de la preuve réelle (aucun réseau ici) -------------------

    /// Décode un WAV 16 bits et le ramène en PCM mono 16 kHz — la seule forme que
    /// le service accepte en `?pcm=1&sr=16000`. Sert à la preuve de bout en bout.
    fn wav_to_pcm16_mono_16k(bytes: &[u8]) -> Option<Vec<u8>> {
        if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return None;
        }
        let mut channels = 1u16;
        let mut sample_rate = 16_000u32;
        let mut bits = 16u16;
        let mut data: Option<&[u8]> = None;
        let mut offset = 12;
        while offset + 8 <= bytes.len() {
            let id = &bytes[offset..offset + 4];
            let size = u32::from_le_bytes([
                bytes[offset + 4],
                bytes[offset + 5],
                bytes[offset + 6],
                bytes[offset + 7],
            ]) as usize;
            let body_start = offset + 8;
            let body_end = body_start.saturating_add(size).min(bytes.len());
            match id {
                b"fmt " if size >= 16 => {
                    channels = u16::from_le_bytes([bytes[body_start + 2], bytes[body_start + 3]]);
                    sample_rate = u32::from_le_bytes([
                        bytes[body_start + 4],
                        bytes[body_start + 5],
                        bytes[body_start + 6],
                        bytes[body_start + 7],
                    ]);
                    bits = u16::from_le_bytes([bytes[body_start + 14], bytes[body_start + 15]]);
                }
                b"data" => data = Some(&bytes[body_start..body_end]),
                _ => {}
            }
            offset = body_start + size + (size % 2);
        }
        let data = data?;
        if bits != 16 || channels == 0 || sample_rate == 0 {
            return None;
        }
        let frames: Vec<i16> = data
            .chunks_exact(2 * channels as usize)
            .map(|frame| {
                let mut sum = 0i32;
                for channel in 0..channels as usize {
                    let low = frame[2 * channel];
                    let high = frame[2 * channel + 1];
                    sum += i16::from_le_bytes([low, high]) as i32;
                }
                (sum / channels as i32) as i16
            })
            .collect();
        if frames.is_empty() {
            return None;
        }
        let target = SAMPLE_RATE as f64;
        let source = sample_rate as f64;
        let out_len = ((frames.len() as f64) * target / source).floor() as usize;
        let mut out = Vec::with_capacity(out_len * 2);
        for index in 0..out_len {
            let position = index as f64 * source / target;
            let left = position.floor() as usize;
            let right = (left + 1).min(frames.len() - 1);
            let ratio = position - left as f64;
            let value = frames[left] as f64 * (1.0 - ratio) + frames[right] as f64 * ratio;
            out.extend_from_slice(&(value as i16).to_le_bytes());
        }
        Some(out)
    }

    #[test]
    fn un_wav_est_ramene_en_pcm_16k_mono() {
        // WAV 24 kHz mono 16 bits synthétique : 2400 échantillons = 100 ms.
        let samples: Vec<i16> = (0..2400).map(|i| ((i as f32).sin() * 8000.0) as i16).collect();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36u32 + samples.len() as u32 * 2).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&24_000u32.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples.len() as u32 * 2).to_le_bytes());
        for sample in &samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let pcm = wav_to_pcm16_mono_16k(&bytes).expect("WAV lisible");
        // 100 ms à 16 kHz = 1600 échantillons = 3200 octets.
        assert_eq!(pcm.len(), 3200);
        // Le son n'est pas devenu du silence.
        assert!(pcm.chunks_exact(2).any(|pair| pair != [0, 0]));
        // Ce qui n'est pas un WAV est refusé, sans exception.
        assert!(wav_to_pcm16_mono_16k(b"pas un wav").is_none());
    }

    // -- Preuve RÉELLE (service local requis) --------------------------------
    //
    // Ignorée par défaut : sans VoiceStudio lancé, elle ne prouverait rien.
    //   cargo test --manifest-path src-tauri/Cargo.toml --lib oreille_locale --
    //        --ignored --nocapture
    //
    // Elle synthétise une phrase française avec le service (voix par défaut),
    // envoie ce son dans la session de dictée EXACTEMENT comme le fera la fenêtre
    // (PCM 16 kHz, morceaux de 100 ms), et affiche les mesures : premier partiel,
    // texte final, texte reconnu.
    #[tokio::test]
    #[ignore]
    async fn preuve_reelle_une_phrase_francaise_transcrite_par_le_service_local() {
        let started = std::time::Instant::now();
        let wav = tokio::task::spawn_blocking(|| {
            let http = http_client()?;
            let body = crate::tts_voicestudio::speech_body(
                "Bonjour, ceci est un essai de dictée locale avec des accents : \
                 où, déjà, être, ça, très, français.",
                "",
            );
            let response = http
                .post(format!(
                    "{}{}",
                    BASE_URL,
                    crate::tts_voicestudio::SPEECH_PATH
                ))
                .header(
                    reqwest::header::CONTENT_TYPE,
                    "application/json; charset=utf-8",
                )
                .body(body.into_bytes())
                .send()
                .map_err(|error| format!("service injoignable ({})", error))?;
            if !response.status().is_success() {
                return Err::<Vec<u8>, String>(format!("HTTP {}", response.status().as_u16()));
            }
            let bytes = response.bytes().map_err(|error| error.to_string())?.to_vec();
            if !crate::tts_voicestudio::is_wav(&bytes) {
                return Err("le service n'a pas renvoyé de son".to_string());
            }
            Ok(bytes)
        })
        .await
        .expect("thread")
        .expect("le service local doit produire un WAV");
        println!("\n[preuve] WAV de {} octets obtenu en {} ms", wav.len(), started.elapsed().as_millis());

        let pcm = wav_to_pcm16_mono_16k(&wav).expect("WAV convertible en PCM 16 kHz");
        println!(
            "[preuve] PCM 16 kHz : {} octets = {} ms de son",
            pcm.len(),
            pcm.len() * 1000 / (SAMPLE_RATE as usize * 2)
        );

        // Les modèles sont choisis et ESSAYÉS par les MÊMES fonctions que la
        // commande : la preuve montre aussi quel modèle le service accepte
        // réellement (il peut en refuser un pourtant installé).
        let candidates = tokio::task::spawn_blocking(|| resolve_models_blocking(None))
            .await
            .expect("thread")
            .expect("un modèle français doit être installé");
        println!(
            "[preuve] modèles français à essayer : {}",
            candidates
                .iter()
                .map(|model| format!("{} ({})", model.id, model.label))
                .collect::<Vec<_>>()
                .join(" → ")
        );

        let mut opened: Option<(DictationModel, LocalSocket, String)> = None;
        for candidate in &candidates {
            let attempt_started = std::time::Instant::now();
            match open_session(&candidate.id).await {
                Handshake::Ready(socket, engine) => {
                    println!(
                        "[preuve] session ouverte avec {} en {} ms (moteur : {})",
                        candidate.id,
                        attempt_started.elapsed().as_millis(),
                        engine
                    );
                    opened = Some((candidate.clone(), socket, engine));
                    break;
                }
                Handshake::Refused(message) => println!(
                    "[preuve] {} REFUSÉ par le service après {} ms : {}",
                    candidate.id,
                    attempt_started.elapsed().as_millis(),
                    message
                ),
                Handshake::Unreachable(message) => panic!("service injoignable : {}", message),
            }
        }
        let (_model, socket, _engine) = opened.expect("le service doit accepter un modèle français");
        let (mut sink, mut stream) = socket.split();
        let connect_ms = started.elapsed().as_millis();

        // Envoi « en temps réel » : un morceau de 100 ms toutes les 100 ms, comme
        // le fera la fenêtre, puis 700 ms de silence pour laisser le service
        // refermer la dernière phrase.
        let chunk = SAMPLE_RATE as usize / 10 * 2;
        let mut first_partial: Option<u128> = None;
        let mut partials: Vec<String> = Vec::new();
        let mut final_text = String::new();
        let mut final_ms: Option<u128> = None;
        let mut ended = false;

        let send_task = async {
            for piece in pcm.chunks(chunk) {
                let _ = sink.send(Message::Binary(piece.to_vec())).await;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            // Silence de fin (700 ms), puis fin de flux.
            for _ in 0..7 {
                let _ = sink
                    .send(Message::Binary(vec![0u8; chunk]))
                    .await;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            let _ = sink.send(Message::Text(END_FRAME.to_string())).await;
            // La socket n'est PAS refermée ici : le service rend son texte final
            // sur le conduit encore ouvert, puis le referme lui-même.
        };

        let read_task = async {
            while let Some(incoming) = stream.next().await {
                match incoming {
                    Ok(Message::Text(text)) => {
                        if let Some(event) = parse_event(&text) {
                            match event.kind.as_str() {
                                "partial" => {
                                    if first_partial.is_none() {
                                        first_partial = Some(started.elapsed().as_millis());
                                    }
                                    partials.push(event.text.clone());
                                    println!(
                                        "[preuve] partiel à {} ms : « {} »",
                                        started.elapsed().as_millis(),
                                        event.text
                                    );
                                }
                                "final" => {
                                    println!(
                                        "[preuve] final ({}) à {} ms : « {} »",
                                        event.final_kind,
                                        started.elapsed().as_millis(),
                                        event.text
                                    );
                                    if event.final_kind == "summary" {
                                        final_text = event.text.clone();
                                        final_ms = Some(started.elapsed().as_millis());
                                        ended = true;
                                    }
                                }
                                "error" => println!("[preuve] erreur du service : {}", event.message),
                                other => println!("[preuve] {} : {}", other, event.message),
                            }
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
                if ended {
                    break;
                }
            }
        };

        // Le silence de fin dure ~700 ms : la lecture est bornée par un délai dur.
        let _ = tokio::time::timeout(Duration::from_secs(90), async {
            tokio::join!(send_task, read_task);
        })
        .await;

        println!(
            "\n[preuve] session ouverte à {} ms ; premier partiel {} ; texte final {}",
            connect_ms,
            first_partial
                .map(|ms| format!("{} ms", ms))
                .unwrap_or_else(|| "AUCUN".to_string()),
            final_ms
                .map(|ms| format!("{} ms", ms))
                .unwrap_or_else(|| "AUCUN".to_string()),
        );
        println!("[preuve] partiels : {} ; texte final : « {} »", partials.len(), final_text);

        assert!(
            !final_text.trim().is_empty(),
            "le service doit rendre un texte final non vide"
        );
        let said = final_text.to_lowercase();
        assert!(
            said.contains("bonjour"),
            "le texte reconnu doit au moins contenir « bonjour », obtenu : {}",
            final_text
        );
        // Mesure réelle : le texte doit arriver AVANT la fin de la preuve.
        assert!(final_ms.is_some(), "le texte final doit être mesuré");
        println!(
            "[preuve] durée totale mesurée : {} ms\n",
            started.elapsed().as_millis()
        );
    }

    /// Base d'un service ARRÊTÉ : le MÊME conduit, sur un port où personne
    /// n'écoute (aucune adresse recopiée, le port est pris à `BASE_URL`).
    fn closed_base() -> String {
        let mut parts: Vec<&str> = BASE_URL.rsplitn(2, ':').collect();
        let host = parts.pop().unwrap_or_default();
        format!("{}:1", host)
    }

    /// PREUVE RÉELLE n° 2 — le service ne répond PLUS.
    ///
    /// Le service de l'utilisateur n'est pas tué (c'est SON application) : la
    /// MÊME voie de connexion est éprouvée vers un port fermé, ce qui produit un
    /// vrai refus de connexion, pas une simulation.
    #[test]
    #[ignore = "preuve réelle : demande un port fermé (aucun service)"]
    fn preuve_reelle_service_arrete_dit_pourquoi_en_une_phrase() {
        let closed = closed_base();
        println!("\n[preuve] base éprouvée : {} (aucun service n'écoute)", closed);

        let started = std::time::Instant::now();
        let status = probe_base(&closed);
        let ms = started.elapsed().as_millis();
        println!(
            "[preuve] sonde : disponible={} raison={} en {} ms\n[preuve] phrase : {}",
            status.available, status.reason, ms, status.hint
        );
        assert!(!status.available, "un service arrêté n'est pas disponible");
        assert!(
            status.reason == REASON_ABSENT || status.reason == REASON_MUTE,
            "raison inattendue : {}",
            status.reason
        );
        assert!(status.hint.contains("logiciel de voix"), "{}", status.hint);
        // Un service arrêté se constate VITE : pas d'attente qui fige l'écran.
        assert!(ms < 3_000, "constat trop lent : {} ms", ms);

        // Et l'ouverture d'une session échoue en UNE phrase, jamais en panique.
        let opened = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(open_session_at(&closed, MODEL_FRENCH));
        match opened {
            Handshake::Refused(message) => {
                println!("[preuve] session refusée : {}", message);
                assert!(!message.trim().is_empty());
            }
            Handshake::Unreachable(message) => {
                println!("[preuve] session impossible : {}", message);
                let sentence = down_sentence(&message);
                assert!(sentence.starts_with("La transcription locale n'est pas disponible"));
                assert!(!sentence.contains("panic"));
            }
            Handshake::Ready(..) => panic!("aucun service n'écoute sur {} !", closed),
        }
    }
}
