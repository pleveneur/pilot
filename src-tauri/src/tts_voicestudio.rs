// tts_voicestudio.rs — Voix IMITÉE de l'utilisateur (service local VoiceStudio).
//
// DEUXIÈME moteur de la lecture à voix haute, à côté de la voix française locale
// (Piper, `tts_local.rs`). Il ne REMPLACE rien : la voix Piper reste la voix par
// défaut et le repli. Ce module ne fait qu'une chose : demander un WAV au service
// **déjà installé et déjà lancé** par l'utilisateur sur son ordinateur
// (`http://127.0.0.1:3900`), et le rendre à la fenêtre.
//
// Ce que ce module ne fait JAMAIS (décisions du propriétaire) :
//   - aucun moteur téléchargé ni embarqué : le service est un AUTRE programme, que
//     Pilot ne lance pas, n'installe pas et ne configure pas ;
//   - aucune voix clonée, aucun apprentissage : la voix imitée est déjà
//     enregistrée côté service — Pilot ne fait que la DEMANDER ;
//   - aucun fichier audio écrit sur le disque : le WAV vit en mémoire et part en
//     base64 vers la fenêtre (seul le journal texte reçoit une ligne) ;
//   - aucun flux (streaming), aucune API temps réel : une requête = un morceau
//     de texte = un WAV complet ;
//   - aucun autre appel réseau : uniquement 127.0.0.1, aucun secret, aucune clé.
//
// Robuste par construction : service absent, lent ou en erreur → une erreur
// EXPLICITE (jamais une exception muette, jamais un silence) et c'est l'appelant
// (la fenêtre) qui décide du repli — repli automatique sur Piper, puis sur la
// voix du système. Un service qui répond « 200 » avec une autre voix que celle
// demandée est un piège connu : la voix demandée est donc VÉRIFIÉE avant l'appel
// (`voice_error`), pour qu'une voix inconnue soit une erreur visible et jamais un
// remplacement silencieux.

use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;

use crate::tts_local::{append_log, local_voice_root};

/// Adresse du service local de voix imitée (jamais une autre : boucle locale).
pub const BASE_URL: &str = "http://127.0.0.1:3900";
/// Santé du service (le chemin `/v1/health` renvoie 404 sur ce service).
pub const HEALTH_PATH: &str = "/health";
/// Liste des voix enregistrées côté service (identifiant + nom lisible).
pub const PROFILES_PATH: &str = "/profiles";
/// Synthèse (compatible OpenAI `/v1/audio/speech`).
pub const SPEECH_PATH: &str = "/v1/audio/speech";
/// Modèle demandé au service (alias de son moteur actif).
pub const MODEL: &str = "tts-1";
/// Format demandé : WAV 24 kHz mono, que la fenêtre sait jouer directement.
pub const RESPONSE_FORMAT: &str = "wav";
/// Voix « par défaut » du service (aucune voix imitée choisie).
pub const DEFAULT_VOICE: &str = "default";
/// Plafond de caractères accepté par le service pour un morceau.
pub const MAX_INPUT_CHARS: usize = 4096;
/// Délai de connexion : un service éteint doit être constaté VITE.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Délai global d'une requête : un premier appel à froid charge le modèle
/// (≈ 6 s mesurées) — marge large, mais jamais d'attente infinie.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Texte du préchauffage : court, neutre, jamais lu à l'utilisateur.
pub const PREWARM_TEXT: &str = "Bonjour.";

/// Une voix imitée proposée par le service (profil enregistré côté serveur).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VoiceStudioProfile {
    /// Identifiant stable du profil (c'est lui que la fenêtre mémorise).
    pub id: String,
    /// Nom lisible donné par l'utilisateur dans VoiceStudio.
    pub name: String,
}

/// État du service de voix imitée, tel qu'affiché par les Paramètres.
///
/// Rien n'est inventé : `reachable`, `profiles` et `voice_known` viennent de
/// réponses réelles du service. Une panne n'est jamais une exception : elle donne
/// `reachable = false` et une phrase claire.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VoiceStudioStatus {
    /// Vrai si le service répond sur la boucle locale.
    pub reachable: bool,
    /// Version annoncée par le service (`0.5.7`), vide si inconnue.
    pub version: String,
    /// Périphérique de calcul annoncé (`cuda (…)`), vide si inconnu.
    pub device: String,
    /// Voix imitées disponibles, dans l'ordre du service.
    pub profiles: Vec<VoiceStudioProfile>,
    /// Voix demandée (`""` = voix par défaut du service).
    pub voice: String,
    /// Vrai si la voix demandée existe réellement côté service.
    pub voice_known: bool,
    /// Phrase unique expliquant la situation et ce qui se passe en cas d'absence.
    pub hint: String,
    /// Adresse interrogée (affichée à l'utilisateur : elle reste locale).
    pub base_url: String,
}

/// Corps JSON d'une demande de synthèse — **construit ici, une seule fois**.
///
/// UTF-8 explicite : `serde_json` écrit le texte tel quel (`é` reste `é`, deux
/// octets), jamais un échappement `\u00e9` ni une conversion de page de code. Le
/// service refuse un corps qui n'est pas de l'UTF-8 (`400 There was an error
/// parsing the body`) : c'est donc le corps entier qui est envoyé tel quel, encodé
/// une seule fois, par `post_speech`.
pub fn speech_body(text: &str, voice: &str) -> String {
    let voice = if voice.trim().is_empty() {
        DEFAULT_VOICE
    } else {
        voice.trim()
    };
    serde_json::json!({
        "model": MODEL,
        "voice": voice,
        "input": text,
        "response_format": RESPONSE_FORMAT,
    })
    .to_string()
}

/// Vrai si les octets sont bien un WAV (en-tête `RIFF….WAVE`).
///
/// Un service qui répond « 200 » avec du vide ou du JSON n'a pas produit de son :
/// on refuse plutôt que de jouer du silence.
pub fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() > 44 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE"
}

/// Lit la liste des voix imitées dans la réponse du service.
///
/// Tolérant par nécessité : la racine peut être un tableau ou un objet portant
/// `profiles` / `voices` / `data`. Chaque profil garde son `id` (jamais le nom :
/// un nom peut être partagé par deux profils, et le service répond alors 409) et
/// son nom lisible quand il y en a un.
pub fn parse_profiles(json: &str) -> Vec<VoiceStudioProfile> {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let list = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(map) => ["profiles", "voices", "data", "items"]
            .iter()
            .find_map(|key| map.get(*key).and_then(|v| v.as_array()).cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut profiles: Vec<VoiceStudioProfile> = Vec::new();
    for item in list {
        let id = ["id", "voice_id", "profile_id"]
            .iter()
            .find_map(|key| item.get(*key).and_then(|v| v.as_str()))
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let name = ["name", "display_name", "title"]
            .iter()
            .find_map(|key| item.get(*key).and_then(|v| v.as_str()))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| id.clone());
        // Un même identifiant n'apparaît qu'une fois (aucune ligne en double).
        if profiles.iter().any(|p| p.id == id) {
            continue;
        }
        profiles.push(VoiceStudioProfile { id, name });
    }
    profiles
}

/// Vrai si la voix demandée existe réellement côté service.
///
/// `""` et `default` sont toujours valides (voix par défaut du service). L'appel
/// se fait par IDENTIFIANT ; le nom est accepté en plus, sans tenir compte de la
/// casse, parce que c'est ce que l'utilisateur voit.
pub fn voice_known(voice: &str, profiles: &[VoiceStudioProfile]) -> bool {
    let wanted = voice.trim();
    if wanted.is_empty() || wanted == DEFAULT_VOICE {
        return true;
    }
    let lower = wanted.to_lowercase();
    profiles.iter().any(|profile| {
        profile.id == wanted || profile.name.to_lowercase() == lower
    })
}

/// Message d'erreur EXPLICITE quand la voix demandée n'existe pas, sinon `None`.
///
/// C'est le piège du service : une voix inconnue renvoie **200** avec la voix par
/// défaut, sans le dire. Sans cette vérification, Pilot ferait écouter une autre
/// voix que celle choisie en annonçant la bonne.
pub fn voice_error(voice: &str, profiles: &[VoiceStudioProfile]) -> Option<String> {
    if voice_known(voice, profiles) {
        return None;
    }
    let known: Vec<String> = profiles.iter().map(|p| p.name.clone()).collect();
    let noms = if known.is_empty() {
        "aucune voix imitée n'est enregistrée dans VoiceStudio".to_string()
    } else {
        format!("voix connues : {}", known.join(", "))
    };
    Some(format!(
        "la voix « {} » n'existe pas dans VoiceStudio ({})",
        voice.trim(),
        noms
    ))
}

/// Phrase unique de l'état affiché (jamais une ligne vide, jamais d'invention).
pub fn status_hint(reachable: bool, voice_known: bool, voice: &str, profile_count: usize) -> String {
    if !reachable {
        return format!(
            "Le service de voix imitée ne répond pas sur {}. La lecture se rabat \
             automatiquement sur la voix locale (Piper), puis sur la voix du système : \
             vous n'avez rien à faire.",
            BASE_URL
        );
    }
    if profile_count == 0 {
        return format!(
            "Le service de voix imitée répond sur {}, mais aucune voix imitée n'y est \
             enregistrée : enregistrez votre voix dans VoiceStudio pour la choisir ici.",
            BASE_URL
        );
    }
    if !voice_known {
        return format!(
            "La voix « {} » n'existe plus dans VoiceStudio : choisissez-en une autre dans \
             la liste (la lecture se rabat sur la voix locale en attendant).",
            voice.trim()
        );
    }
    format!(
        "Le service de voix imitée répond sur {} ({} voix imitée(s)). Le son est fabriqué \
         sur cet ordinateur ; la voix locale (Piper) reste le repli automatique.",
        BASE_URL, profile_count
    )
}

// ── Appels au service (boucle locale uniquement) ────────────────────────────

/// Client HTTP du service local : délais bornés, aucune redirection suivie.
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("client HTTP indisponible : {}", e))
}

/// Lit `/health` : (version, périphérique). Erreur claire si le service est éteint.
fn fetch_health(http: &reqwest::blocking::Client) -> Result<(String, String), String> {
    let url = format!("{}{}", BASE_URL, HEALTH_PATH);
    let response = http
        .get(&url)
        .send()
        .map_err(|e| format!("service injoignable ({})", e))?;
    if !response.status().is_success() {
        return Err(format!("service en erreur (HTTP {})", response.status().as_u16()));
    }
    let body = response.text().unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let device = value
        .get("device")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Ok((version, device))
}

/// Lit la liste des voix imitées enregistrées côté service.
fn fetch_profiles(http: &reqwest::blocking::Client) -> Result<Vec<VoiceStudioProfile>, String> {
    let url = format!("{}{}", BASE_URL, PROFILES_PATH);
    let response = http
        .get(&url)
        .send()
        .map_err(|e| format!("service injoignable ({})", e))?;
    if !response.status().is_success() {
        return Err(format!("service en erreur (HTTP {})", response.status().as_u16()));
    }
    let body = response.text().unwrap_or_default();
    Ok(parse_profiles(&body))
}

/// Demande un WAV au service. Le corps part en **UTF-8** (`body.as_bytes()`), la
/// voix est vérifiée AVANT l'appel, et un corps qui n'est pas un WAV est refusé.
fn post_speech(
    http: &reqwest::blocking::Client,
    voice: &str,
    text: &str,
) -> Result<Vec<u8>, String> {
    let url = format!("{}{}", BASE_URL, SPEECH_PATH);
    let body = speech_body(text, voice);
    let response = http
        .post(&url)
        .header(reqwest::header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(body.into_bytes())
        .send()
        .map_err(|e| format!("service injoignable ({})", e))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().unwrap_or_default();
        let detail = detail.trim();
        let detail = if detail.len() > 200 {
            format!("{}…", &detail[..200])
        } else {
            detail.to_string()
        };
        return Err(if detail.is_empty() {
            format!("le service a refusé la demande (HTTP {})", status.as_u16())
        } else {
            format!("le service a refusé la demande (HTTP {}) : {}", status.as_u16(), detail)
        });
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("réponse illisible du service ({})", e))?
        .to_vec();
    if !is_wav(&bytes) {
        return Err("le service n'a pas renvoyé de son (réponse vide ou inattendue)".to_string());
    }
    Ok(bytes)
}

/// État complet du service (santé + voix) — jamais d'exception, une panne devient
/// un état lisible.
pub fn probe(voice: &str) -> VoiceStudioStatus {
    let wanted = voice.trim().to_string();
    let hint_down = |voice: &str| VoiceStudioStatus {
        reachable: false,
        version: String::new(),
        device: String::new(),
        profiles: Vec::new(),
        voice: voice.to_string(),
        voice_known: false,
        hint: status_hint(false, false, voice, 0),
        base_url: BASE_URL.to_string(),
    };
    let http = match client() {
        Ok(http) => http,
        Err(_) => return hint_down(&wanted),
    };
    let (version, device) = match fetch_health(&http) {
        Ok(found) => found,
        Err(_) => return hint_down(&wanted),
    };
    let profiles = fetch_profiles(&http).unwrap_or_default();
    let known = voice_known(&wanted, &profiles);
    VoiceStudioStatus {
        reachable: true,
        version,
        device,
        hint: status_hint(true, known, &wanted, profiles.len()),
        profiles,
        voice: wanted,
        voice_known: known,
        base_url: BASE_URL.to_string(),
    }
}

/// Synthèse complète d'un morceau : vérifie la voix, demande le WAV, encode.
pub fn synthesize_base64(voice: &str, text: &str) -> Result<String, String> {
    let payload = text.trim();
    if payload.is_empty() {
        return Err("texte vide : rien à synthétiser".to_string());
    }
    if payload.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "morceau trop long ({} caractères pour un plafond de {}) : découpez le texte",
            payload.chars().count(),
            MAX_INPUT_CHARS
        ));
    }
    let http = client()?;
    // La voix est vérifiée AVANT l'appel : une voix inconnue est une erreur
    // visible, jamais un remplacement silencieux par la voix par défaut.
    let wanted = voice.trim();
    if !wanted.is_empty() && wanted != DEFAULT_VOICE {
        let profiles = fetch_profiles(&http)?;
        if let Some(reason) = voice_error(wanted, &profiles) {
            return Err(reason);
        }
    }
    let bytes = post_speech(&http, voice, payload)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ── Commandes Tauri ─────────────────────────────────────────────────────────

/// État du service de voix imitée (santé + voix enregistrées).
///
/// Commande **async** : elle interroge un autre programme → hors du thread de la
/// fenêtre, jamais un gel de l'interface.
#[tauri::command]
pub async fn tts_voicestudio_status(voice: Option<String>) -> VoiceStudioStatus {
    let wanted = voice.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || probe(&wanted))
        .await
        .unwrap_or_else(|_| probe(""))
}

/// Synthétise un morceau avec la voix imitée choisie (WAV en base64).
///
/// Commande **async** déportée dans `spawn_blocking` : la requête peut durer
/// (chargement du modèle à froid ≈ 6 s) et ne doit JAMAIS bloquer la fenêtre.
/// Aucun fichier écrit : le WAV vit en mémoire.
#[tauri::command]
pub async fn tts_voicestudio_synthesize(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
) -> Result<String, String> {
    let wanted = voice.unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(move || synthesize_base64(&wanted, &text))
        .await
        .map_err(|e| format!("Erreur interne (join) tts_voicestudio_synthesize: {}", e))?;
    if let Err(ref reason) = result {
        log_with_app(&app, &format!("Aucun son imité — {} (repli sur la voix locale)", reason));
    }
    result
}

/// Préchauffe le service : une synthèse courte, dont le son n'est pas joué.
///
/// Sert au PREMIER appel (chargement du modèle ≈ 6 s) déclenché par un GESTE
/// (choix de la voix dans les Paramètres) : la première phrase lue ensuite ne
/// porte plus cette attente. Non bloquant côté fenêtre (commande async).
#[tauri::command]
pub async fn tts_voicestudio_warmup(voice: Option<String>) -> Result<String, String> {
    let wanted = voice.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let http = client()?;
        let bytes = post_speech(&http, &wanted, PREWARM_TEXT)?;
        Ok(format!("préchauffage terminé ({} octets de son préparés)", bytes.len()))
    })
    .await
    .map_err(|e| format!("Erreur interne (join) tts_voicestudio_warmup: {}", e))?
}

/// Ajoute une ligne au journal (repli décidé côté fenêtre).
///
/// Une seule destination pour cette fonctionnalité, comme pour la voix locale :
/// `voix-locale.log`. Jamais d'exception.
#[tauri::command]
pub fn tts_voicestudio_log(app: tauri::AppHandle, message: String) {
    log_with_app(&app, &message);
}

/// Écrit dans le journal en utilisant le dossier de données de CETTE instance.
fn log_with_app(app: &tauri::AppHandle, message: &str) {
    let text = String::from(message).trim().to_string();
    if text.is_empty() {
        return;
    }
    if let Some(root) = local_voice_root(app) {
        append_log(&root, &format!("[voix imitée] {}", text));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_corps_envoye_est_de_l_utf8_avec_les_accents() {
        // Défaut corrigé d'avance : un corps écrit dans une autre page de code
        // fait répondre 400 au service (« error parsing the body »).
        let body = speech_body("Déjà vu, où ça ? L'été.", "abc123");
        let octets = body.as_bytes();
        assert_eq!(std::str::from_utf8(octets).expect("UTF-8 valide"), body);
        // Les accents sont bien écrits tels quels (deux octets pour « é »).
        assert!(octets.windows(2).any(|w| w == "é".as_bytes()));
        assert!(!body.contains("\\u00e9"), "aucun échappement d'accent dans le corps");
        // Et les quatre champs attendus par le service sont là.
        assert!(body.contains("\"model\":\"tts-1\""));
        assert!(body.contains("\"voice\":\"abc123\""));
        assert!(body.contains("\"response_format\":\"wav\""));
    }

    #[test]
    fn une_voix_vide_demande_la_voix_par_defaut_du_service() {
        assert!(speech_body("Bonjour.", "").contains("\"voice\":\"default\""));
        assert!(speech_body("Bonjour.", "   ").contains("\"voice\":\"default\""));
    }

    #[test]
    fn seuls_les_vrais_wav_sont_acceptes() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&[0u8; 4]); // taille annoncée du fichier
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&[0u8; 32]);
        assert!(is_wav(&wav));
        // Réponse vide, JSON, ou en-tête incomplet : pas de son.
        assert!(!is_wav(&[]));
        assert!(!is_wav(b"{\"detail\":\"erreur\"}"));
        assert!(!is_wav(b"RIFF"));
    }

    #[test]
    fn les_voix_enregistrees_sont_lues_par_identifiant_et_par_nom() {
        let json = r#"[{"id":"a772c1b0","name":"Lucie","kind":"clone"}]"#;
        let profiles = parse_profiles(json);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "a772c1b0");
        assert_eq!(profiles[0].name, "Lucie");
        // Racine objet (autre version du service) : même lecture.
        assert_eq!(parse_profiles(r#"{"profiles":[{"id":"x","name":"Y"}]}"#).len(), 1);
        // Réponse illisible : liste vide, jamais une exception.
        assert!(parse_profiles("pas du json").is_empty());
        // Une voix par identifiant OU par nom (casse ignorée), la valeur par
        // défaut toujours acceptée.
        assert!(voice_known("a772c1b0", &profiles));
        assert!(voice_known("lucie", &profiles));
        assert!(voice_known("", &profiles));
        assert!(voice_known("default", &profiles));
    }

    #[test]
    fn une_voix_inconnue_est_une_erreur_visible_jamais_un_remplacement_muet() {
        // Le service répond « 200 » et joue sa voix par défaut : sans cette
        // vérification, Pilot annoncerait la bonne voix et en ferait entendre une
        // autre.
        let profiles = parse_profiles(r#"[{"id":"a772c1b0","name":"Lucie"}]"#);
        assert!(voice_error("a772c1b0", &profiles).is_none());
        let erreur = voice_error("voix-disparue", &profiles).expect("doit être signalée");
        assert!(erreur.contains("voix-disparue"));
        assert!(erreur.contains("Lucie"), "les voix connues sont nommées : {}", erreur);
        // Aucune voix enregistrée : l'erreur le dit aussi.
        let vide = voice_error("x", &[]).expect("doit être signalée");
        assert!(vide.contains("aucune voix imitée"), "{}", vide);
    }

    #[test]
    fn l_etat_annonce_toujours_quoi_faire_et_quel_repli() {
        // Service absent ou injoignable : la phrase nomme le repli, jamais un vide.
        let down = status_hint(false, false, "", 0);
        assert!(down.contains("ne répond pas"));
        assert!(down.contains("Piper"), "le repli est nommé : {}", down);
        assert_eq!(BASE_URL, "http://127.0.0.1:3900");
        // Service présent mais voix disparue : l'état le dit, et propose d'en choisir
        // une autre.
        let hint = status_hint(true, false, "Lucie", 1);
        assert!(hint.contains("n'existe plus"));
        // Service présent, aucune voix enregistrée : on ne promet rien.
        let hint = status_hint(true, true, "", 0);
        assert!(hint.contains("aucune voix imitée"));
        // Cas normal : le repli est rappelé.
        let hint = status_hint(true, true, "a772c1b0", 1);
        assert!(hint.contains("Piper"));
    }

    #[test]
    fn un_morceau_trop_long_est_refuse_avec_un_message_clair() {
        let trop_long = "a".repeat(MAX_INPUT_CHARS + 1);
        let erreur = synthesize_base64("default", &trop_long).expect_err("doit être refusé");
        assert!(erreur.contains("trop long"));
        // Texte vide : jamais une requête pour rien.
        assert!(synthesize_base64("default", "   ").is_err());
    }
}
