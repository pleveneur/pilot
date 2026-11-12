// asr_whisper.rs — L'OREILLE INTÉGRÉE : le moteur de dictée DANS Pilot.
//
// Module FRÈRE de `asr_voicestudio.rs` (le service de voix local, port distinct),
// calqué sur lui : mêmes commandes asynchrones déportées (`spawn_blocking`),
// même journal (le journal de la voix locale, préfixé), même évènement au même
// format (`started` / `partial` / `final` + `final_kind = "summary"` / `error` /
// `ended`), mêmes raisons d'indisponibilité en français.
//
// ── CE QUI CHANGE, ET CE QUI NE CHANGE PAS ──────────────────────────────────
// CHANGE : la transcription ne sort plus de l'ordinateur. Elle est faite ici par
// le modèle Whisper (bibliothèque `whisper-rs`, feature Cargo `whisper`), sur un
// fichier de modèle présent sur le disque. Aucun port réseau n'est ouvert,
// aucun programme externe n'est lancé, aucune fenêtre ne s'ouvre.
// NE CHANGE PAS : le service de voix local reste intact (`asr_voicestudio.rs`
// n'est pas modifié), la synthèse vocale reste intacte (`tts_local.rs`,
// `tts_voicestudio.rs`), le mode Vocal garde une seule forme de session, et le
// micro reste UNIQUE : ce module ne capture AUCUN son. Il reçoit des morceaux
// PCM déjà captés par la fenêtre (robinet de `vocal-mic.js`).
//
// ── LA FEATURE `whisper` EST OPTIONNELLE, ET C'EST VOULU ────────────────────
// `whisper-rs` dépend de `whisper-rs-sys`, qui exige `libclang` (bindgen) pour
// se compiler. Une machine sans LLVM ne peut donc PAS construire cette feature.
// Le build PAR DÉFAUT n'active pas la feature : Pilot compile et fonctionne
// exactement comme avant, et l'écran reçoit la raison `moteur-non-compile` —
// une phrase française qui dit que le moteur intégré n'est pas compilé dans
// cette version, et que la dictée repart ailleurs (jamais un silence).
//
// ── AUCUN TÉLÉCHARGEMENT ICI ───────────────────────────────────────────────
// Ce module ne télécharge RIEN : il CONSTATE la présence du fichier de modèle
// (`modele-absent` / `modele-illisible` sinon). Le téléchargement vit dans son
// propre module frère (`asr_whisper_download.rs`) et n'est déclenché que par un
// geste de l'utilisateur.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::tts_local;

/// L'unique évènement de dictée du moteur intégré (même format que celui du
/// service de voix local, canal distinct pour que deux oreilles ne se mélangent
/// jamais).
pub const EVENT_TRANSCRIPT: &str = "asr-whisper-transcript";
/// Identifiant du moteur, tel que l'écran le reçoit (stable, jamais traduit).
pub const ENGINE_ID: &str = "whisper";
/// Sous-dossier du modèle, DANS le dossier de la voix locale (à côté des voix).
pub const DICTATION_SUBDIR: &str = "dictee";
/// Identifiant du modèle employé (le fichier et sa taille sont vérifiés).
pub const MODEL_ID: &str = "whisper-large-v3-turbo-q8_0";
/// Nom lisible du modèle, affiché tel quel par l'écran.
pub const MODEL_LABEL: &str = "Whisper large-v3-turbo (q8_0, multilingue)";
/// Nom du fichier de modèle attendu sur le disque.
pub const MODEL_FILE: &str = "ggml-large-v3-turbo-q8_0.bin";
/// Taille exacte du fichier de modèle (874 188 075 o, ≈ 874 Mo). Un fichier de
/// taille fausse est un fichier INCOMPLET : il n'est jamais déclaré installé.
pub const MODEL_BYTES: u64 = 874_188_075;
/// Taux du son accepté par le pont (PCM 16 bits mono, même contrat que le pair).
pub const SAMPLE_RATE: u32 = 16_000;
/// Préfixe des lignes de journal de ce module (le journal est partagé).
pub const LOG_PREFIX: &str = "[dictée intégrée]";

/// Le moteur est-il COMPILÉ dans ce binaire ? (`moteur-non-compile` sinon.)
pub const ENGINE_COMPILED: bool = cfg!(feature = "whisper");

/// Raisons d'indisponibilité, stables et lisibles par l'écran.
pub const REASON_AVAILABLE: &str = "disponible";
pub const REASON_NOT_COMPILED: &str = "moteur-non-compile";
pub const REASON_MODEL_MISSING: &str = "modele-absent";
pub const REASON_MODEL_UNREADABLE: &str = "modele-illisible";
pub const REASON_BUSY: &str = "moteur-occupe";

/// Longueur maximale gardée en mémoire pour une dictée (10 min à 16 kHz) : une
/// session oubliée ne peut pas faire grossir la mémoire sans fin.
pub const MAX_SAMPLES: usize = SAMPLE_RATE as usize * 600;
/// Taille maximale d'un morceau accepté (100 ms = 3 200 o ; marge large).
pub const MAX_CHUNK_BYTES: usize = 64 * 1024;

/// État du moteur intégré, tel que l'écran le reçoit.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AsrWhisperStatus {
    /// Le moteur peut-il servir MAINTENANT ?
    pub available: bool,
    /// Raison stable (`disponible`, `moteur-non-compile`, `modele-absent`,
    /// `modele-illisible`, `moteur-occupe`).
    pub reason: String,
    /// Phrase française qui dit la situation réelle et quoi faire.
    pub hint: String,
    /// Identifiant du moteur (`whisper`).
    pub engine: String,
    /// Identifiant du modèle employé.
    pub model_id: String,
    /// Nom lisible du modèle.
    pub model_label: String,
    /// Le fichier de modèle est-il présent ET complet ?
    pub model_installed: bool,
    /// Octets du fichier de modèle sur le disque (0 s'il est absent).
    pub model_bytes: u64,
    /// Octets attendus pour le fichier de modèle.
    pub model_bytes_expected: u64,
    /// Taux du son à envoyer par la fenêtre.
    pub sample_rate: u32,
    /// Le moteur est-il compilé dans ce binaire ?
    pub compiled: bool,
    /// Dossier où le modèle est attendu (écrit en clair : l'utilisateur doit
    /// pouvoir le retrouver lui-même).
    pub model_dir: String,
}

/// Session ouverte, telle que la fenêtre la reçoit.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperSession {
    /// Identifiant de la session (la fenêtre le renvoie à chaque morceau).
    pub session_id: String,
    /// Taux attendu du son (16 kHz).
    pub sample_rate: u32,
    /// Identifiant du modèle RÉELLEMENT employé (jamais choisi par l'écran).
    pub model_id: String,
    /// Nom lisible du modèle employé.
    pub model_label: String,
    /// Identifiant du moteur (`whisper`).
    pub engine: String,
}

/// Évènement de dictée. Mêmes champs que ceux du service de voix local : la
/// fenêtre n'a qu'UN gestionnaire, donc aucune branche de plus chez elle.
#[derive(Debug, Clone, Serialize)]
struct TranscriptEvent {
    kind: String,
    session_id: String,
    engine: String,
    text: String,
    final_kind: String,
    message: String,
}

/// Le son d'UNE dictée en cours (jamais deux à la fois).
struct Capture {
    id: String,
    pcm: Vec<f32>,
}

/// La dictée en cours. UNE seule : le moteur Whisper est lourd (874 Mo de
/// modèle), deux transcriptions simultanées n'auraient aucun sens.
static CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);

/// Compteur de sessions (identifiants uniques, jamais réutilisés).
static NEXT_SESSION: Mutex<u64> = Mutex::new(0);

// ── Emplacements ───────────────────────────────────────────────────────────

/// Dossier du modèle de dictée (`<app_data_dir>/voix-locale/dictee`), c'est-à-dire
/// à côté des voix locales, dans le dossier de données de l'application.
pub fn model_dir(app: &AppHandle) -> Option<PathBuf> {
    tts_local::local_voice_root(app).map(|racine| racine.join(DICTATION_SUBDIR))
}

/// Chemin du fichier de modèle attendu.
pub fn model_path(app: &AppHandle) -> Option<PathBuf> {
    model_dir(app).map(|dir| dir.join(MODEL_FILE))
}

/// Vrai si le fichier de modèle est présent ET fait exactement la taille
/// attendue (un fichier tronqué n'est jamais « installé »).
pub fn model_installed(path: &Path) -> bool {
    tts_local::file_complete(path, MODEL_BYTES)
}

/// Taille du fichier présent (0 s'il est absent).
pub fn model_len(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|meta| if meta.is_file() { meta.len() } else { 0 })
        .unwrap_or(0)
}

/// Écrit une ligne dans le journal EXISTANT de la voix locale (aucun second
/// journal n'est créé). Jamais d'exception.
pub fn log(app: &AppHandle, message: &str) {
    if let Some(racine) = tts_local::local_voice_root(app) {
        tts_local::append_log(&racine, &format!("{LOG_PREFIX} {message}"));
    }
}

// ── Phrases (une par panne, jamais un code brut) ───────────────────────────

/// Phrase française qui dit la situation réelle et quoi faire, pour une raison
/// donnée. Ne nomme JAMAIS un code : l'écran affiche cette phrase telle quelle.
pub fn human_reason(reason: &str) -> &'static str {
    match reason {
        REASON_AVAILABLE => {
            "Le moteur de dictée intégré est prêt : la transcription se fait sur cet ordinateur."
        }
        REASON_NOT_COMPILED => {
            "Le moteur de dictée intégré n'est pas compilé dans cette version de Pilot : la dictée \
             repart sur l'autre oreille (le service de voix local, ou la dictée du navigateur)."
        }
        REASON_MODEL_MISSING => {
            "Le modèle de dictée du moteur intégré n'est pas installé sur cet ordinateur : il se \
             télécharge sur votre demande, depuis les Paramètres. Rien n'est téléchargé sans ce \
             geste."
        }
        REASON_MODEL_UNREADABLE => {
            "Le fichier du modèle de dictée est incomplet ou illisible : il ne peut pas servir en \
             l'état. Le téléchargement reprend là où il s'est arrêté, sans rien supprimer."
        }
        REASON_BUSY => {
            "Le moteur de dictée intégré travaille déjà sur une autre dictée : attendez la fin de \
             la première."
        }
        _ => {
            "Le moteur de dictée intégré n'est pas disponible sur cet ordinateur : la dictée repart \
             sur l'autre oreille."
        }
    }
}

/// Sonde l'état du moteur intégré (aucun chemin réseau, aucun téléchargement).
pub fn status_for(app: &AppHandle) -> AsrWhisperStatus {
    let chemin = model_path(app);
    let installe = chemin.as_deref().map(model_installed).unwrap_or(false);
    let octets = chemin.as_deref().map(model_len).unwrap_or(0);
    let occupe = CAPTURE.lock().map(|slot| slot.is_some()).unwrap_or(false);
    let raison = if !ENGINE_COMPILED {
        REASON_NOT_COMPILED
    } else if !installe {
        if octets > 0 {
            REASON_MODEL_UNREADABLE
        } else {
            REASON_MODEL_MISSING
        }
    } else if occupe {
        REASON_BUSY
    } else {
        REASON_AVAILABLE
    };
    AsrWhisperStatus {
        available: raison == REASON_AVAILABLE,
        reason: raison.to_string(),
        hint: human_reason(raison).to_string(),
        engine: ENGINE_ID.to_string(),
        model_id: MODEL_ID.to_string(),
        model_label: MODEL_LABEL.to_string(),
        model_installed: installe,
        model_bytes: octets,
        model_bytes_expected: MODEL_BYTES,
        sample_rate: SAMPLE_RATE,
        compiled: ENGINE_COMPILED,
        model_dir: chemin
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

// ── Le pont : sons reçus, texte rendu ──────────────────────────────────────

fn emit_event(app: &AppHandle, event: TranscriptEvent) {
    let _ = app.emit(EVENT_TRANSCRIPT, event);
}

fn started(app: &AppHandle, session: &str) {
    emit_event(
        app,
        TranscriptEvent {
            kind: "started".to_string(),
            session_id: session.to_string(),
            engine: ENGINE_ID.to_string(),
            text: String::new(),
            final_kind: String::new(),
            message: String::new(),
        },
    );
}

/// Un morceau de son est-il acceptable ? Le motif du refus est rendu en clair.
pub fn chunk_problem(chunk: &[u8]) -> Option<String> {
    if chunk.is_empty() {
        return Some("le morceau de son reçu est vide".to_string());
    }
    if chunk.len() > MAX_CHUNK_BYTES {
        return Some(format!(
            "le morceau de son est trop gros ({} octets pour {} au plus)",
            chunk.len(),
            MAX_CHUNK_BYTES
        ));
    }
    if chunk.len() % 2 != 0 {
        return Some("le morceau de son n'est pas aligné sur 16 bits".to_string());
    }
    None
}

/// PCM 16 bits petit-boutiste signé -> échantillons flottants (ce qu'attend
/// Whisper). Aucune conversion de taux : la fenêtre envoie déjà du 16 kHz.
pub fn pcm16_to_f32(chunk: &[u8]) -> Vec<f32> {
    chunk
        .chunks_exact(2)
        .map(|paire| i16::from_le_bytes([paire[0], paire[1]]) as f32 / 32768.0)
        .collect()
}

/// Transcrit un son complet. `Err` porte une phrase française, jamais un code.
///
/// Sans la feature `whisper`, le moteur n'existe pas : la fonction le DIT (elle
/// ne fait pas semblant de transcrire et ne rend jamais un texte vide en
/// silence).
#[cfg(feature = "whisper")]
fn transcrire(chemin: &Path, pcm: &[f32]) -> Result<String, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    if pcm.is_empty() {
        return Ok(String::new());
    }
    let contexte = WhisperContext::new_with_params(
        chemin.to_string_lossy().as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("le modèle de dictée n'a pas pu être chargé ({e})"))?;
    let mut etat = contexte
        .create_state()
        .map_err(|e| format!("le moteur de dictée n'a pas pu démarrer ({e})"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(4) as i32)
        .unwrap_or(4);
    params.set_n_threads(threads);
    // La dictée est en français ; le modèle reste multilingue.
    params.set_language(Some("fr"));
    params.set_translate(false);
    params.set_no_timestamps(true);
    params.set_single_segment(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    etat.full(params, pcm)
        .map_err(|e| format!("la transcription a échoué ({e})"))?;
    let nombre = etat.full_n_segments();
    let mut texte = String::new();
    for index in 0..nombre {
        if let Some(segment) = etat.get_segment(index) {
            if let Ok(morceau) = segment.to_str_lossy() {
                texte.push_str(morceau.as_ref());
            }
        }
    }
    Ok(texte.trim().to_string())
}

/// Sans la feature `whisper`, le moteur n'est pas dans le binaire : c'est DIT.
#[cfg(not(feature = "whisper"))]
fn transcrire(_chemin: &Path, _pcm: &[f32]) -> Result<String, String> {
    Err(human_reason(REASON_NOT_COMPILED).to_string())
}

/// Identifiant de session neuf (monotone, jamais réutilisé).
fn next_session_id() -> String {
    let mut slot = match NEXT_SESSION.lock() {
        Ok(slot) => slot,
        Err(empoisonne) => empoisonne.into_inner(),
    };
    *slot += 1;
    format!("whisper-{}", *slot)
}

fn session_problem(session_id: &str) -> Option<String> {
    match CAPTURE.lock() {
        Ok(slot) => match slot.as_ref() {
            None => Some("aucune session de dictée intégrée n'est ouverte".to_string()),
            Some(capture) if capture.id != session_id => {
                Some("cette session de dictée intégrée n'est plus la session courante".to_string())
            }
            Some(_) => None,
        },
        Err(_) => Some("l'état de la dictée intégrée est illisible".to_string()),
    }
}

/// Prend le son accumulé et referme la session (une seule fois).
fn take_capture(session_id: &str) -> Option<Vec<f32>> {
    let mut slot = match CAPTURE.lock() {
        Ok(slot) => slot,
        Err(empoisonne) => empoisonne.into_inner(),
    };
    match slot.take() {
        Some(capture) if capture.id == session_id => Some(capture.pcm),
        Some(capture) => {
            // Ce n'était pas la session demandée : on la remet en place.
            *slot = Some(capture);
            None
        }
        None => None,
    }
}

// ── Commandes Tauri (toutes asynchrones, jamais sur le thread principal) ────

/// Sonde du moteur intégré. Aucun accès réseau, aucun téléchargement.
#[tauri::command]
pub async fn asr_whisper_status(app: AppHandle) -> Result<AsrWhisperStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status_for(&app))
        .await
        .map_err(|e| format!("la sonde du moteur de dictée a échoué ({e})"))
}

/// Ouvre une session de dictée. Une seule à la fois : une session vivante est
/// REFUSÉE (jamais refermée en silence, jamais son son jeté).
#[tauri::command]
pub async fn asr_whisper_start(app: AppHandle) -> Result<WhisperSession, String> {
    let statut = status_for(&app);
    if !statut.available {
        let phrase = human_reason(&statut.reason).to_string();
        log(&app, &format!("ouverture refusée : {} ({})", statut.reason, phrase));
        return Err(phrase);
    }
    let id = next_session_id();
    {
        let mut slot = CAPTURE
            .lock()
            .map_err(|_| "l'état de la dictée intégrée est illisible".to_string())?;
        *slot = Some(Capture {
            id: id.clone(),
            pcm: Vec::new(),
        });
    }
    log(&app, &format!("dictée intégrée ouverte ({MODEL_ID})"));
    started(&app, &id);
    Ok(WhisperSession {
        session_id: id,
        sample_rate: SAMPLE_RATE,
        model_id: MODEL_ID.to_string(),
        model_label: MODEL_LABEL.to_string(),
        engine: ENGINE_ID.to_string(),
    })
}

/// Reçoit un morceau de son (PCM 16 bits mono 16 kHz). Ne bloque jamais : il
/// n'y a qu'un ajout en mémoire, aucun appel réseau, aucune transcription ici.
#[tauri::command]
pub async fn asr_whisper_send(
    _app: AppHandle,
    session_id: String,
    chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(refus) = chunk_problem(&chunk) {
        return Err(refus);
    }
    if let Some(refus) = session_problem(&session_id) {
        return Err(refus);
    }
    let echantillons = pcm16_to_f32(&chunk);
    let mut slot = CAPTURE
        .lock()
        .map_err(|_| "l'état de la dictée intégrée est illisible".to_string())?;
    if let Some(capture) = slot.as_mut() {
        if capture.id != session_id {
            return Err("cette session de dictée intégrée n'est plus la session courante".to_string());
        }
        if capture.pcm.len() + echantillons.len() > MAX_SAMPLES {
            return Err(
                "la dictée intégrée est trop longue : arrêtez-la et recommencez une phrase"
                    .to_string(),
            );
        }
        capture.pcm.extend_from_slice(&echantillons);
    }
    Ok(())
}

/// Arrête la session demandée et TRANSCRIT le son reçu. Le travail lourd est
/// déporté (`spawn_blocking`) : l'interface ne gèle jamais. Le texte arrive par
/// l'évènement `final` (`final_kind = "summary"`), puis la fin par `ended` —
/// exactement l'ordre attendu par l'écran.
#[tauri::command]
pub async fn asr_whisper_stop(app: AppHandle, session_id: String) -> Result<(), String> {
    if let Some(refus) = session_problem(&session_id) {
        return Err(refus);
    }
    let pcm = take_capture(&session_id).unwrap_or_default();
    let chemin = model_path(&app);
    let id = session_id.clone();
    let resultat = tauri::async_runtime::spawn_blocking(move || match chemin {
        Some(chemin) => transcrire(&chemin, &pcm),
        None => Err("le dossier du modèle de dictée est introuvable".to_string()),
    })
    .await;
    let texte = match resultat {
        Ok(Ok(texte)) => texte,
        Ok(Err(phrase)) => {
            log(&app, &format!("transcription en échec : {phrase}"));
            emit_event(
                &app,
                TranscriptEvent {
                    kind: "error".to_string(),
                    session_id: id.clone(),
                    engine: ENGINE_ID.to_string(),
                    text: String::new(),
                    final_kind: String::new(),
                    message: phrase,
                },
            );
            emit_event(
                &app,
                TranscriptEvent {
                    kind: "ended".to_string(),
                    session_id: id,
                    engine: ENGINE_ID.to_string(),
                    text: String::new(),
                    final_kind: String::new(),
                    message: String::new(),
                },
            );
            return Ok(());
        }
        Err(_) => {
            let phrase =
                "la transcription sur cet ordinateur s'est interrompue".to_string();
            emit_event(
                &app,
                TranscriptEvent {
                    kind: "error".to_string(),
                    session_id: id.clone(),
                    engine: ENGINE_ID.to_string(),
                    text: String::new(),
                    final_kind: String::new(),
                    message: phrase,
                },
            );
            emit_event(
                &app,
                TranscriptEvent {
                    kind: "ended".to_string(),
                    session_id: id,
                    engine: ENGINE_ID.to_string(),
                    text: String::new(),
                    final_kind: String::new(),
                    message: String::new(),
                },
            );
            return Ok(());
        }
    };
    log(
        &app,
        &format!("transcription terminée ({} caractères)", texte.chars().count()),
    );
    emit_event(
        &app,
        TranscriptEvent {
            kind: "final".to_string(),
            session_id: id.clone(),
            engine: ENGINE_ID.to_string(),
            text: texte,
            final_kind: "summary".to_string(),
            message: String::new(),
        },
    );
    emit_event(
        &app,
        TranscriptEvent {
            kind: "ended".to_string(),
            session_id: id,
            engine: ENGINE_ID.to_string(),
            text: String::new(),
            final_kind: String::new(),
            message: String::new(),
        },
    );
    Ok(())
}

/// Abandonne la session demandée : le son reçu est jeté, rien n'est transcrit,
/// aucun texte n'est inventé. Ne lève jamais : abandonner une session déjà
/// fermée n'est pas une erreur.
#[tauri::command]
pub async fn asr_whisper_cancel(app: AppHandle, session_id: String) -> Result<(), String> {
    let mut jete = false;
    if let Ok(mut slot) = CAPTURE.lock() {
        let correspond = slot.as_ref().map(|c| c.id == session_id).unwrap_or(false);
        if correspond {
            *slot = None;
            jete = true;
        }
    }
    if jete {
        log(&app, "dictée intégrée abandonnée (aucun texte gardé)");
    }
    Ok(())
}

/// Les dernières lignes du journal (même journal que la voix locale), pour que
/// l'écran puisse montrer ce qui s'est réellement passé en cas de doute.
#[tauri::command]
pub async fn asr_whisper_log(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match tts_local::local_voice_root(&app) {
        Some(racine) => {
            let chemin = tts_local::log_path(&racine);
            std::fs::read_to_string(chemin).unwrap_or_default()
        }
        None => String::new(),
    })
    .await
    .map_err(|e| format!("le journal du moteur de dictée est illisible ({e})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_morceau_vide_ou_mal_aligne_est_refuse_en_clair() {
        assert!(chunk_problem(&[]).is_some());
        assert!(chunk_problem(&[1, 2, 3]).is_some());
        assert!(chunk_problem(&vec![0u8; MAX_CHUNK_BYTES + 2]).is_some());
        assert_eq!(chunk_problem(&vec![0u8; 3200]), None);
    }

    #[test]
    fn le_son_16_bits_est_converti_sans_perdre_le_signe() {
        let octets = vec![0x00, 0x40, 0x00, 0xC0, 0x00, 0x00];
        let flottants = pcm16_to_f32(&octets);
        assert_eq!(flottants.len(), 3);
        assert!((flottants[0] - 0.5).abs() < 1e-6);
        assert!((flottants[1] + 0.5).abs() < 1e-6);
        assert_eq!(flottants[2], 0.0);
    }

    #[test]
    fn chaque_raison_a_une_phrase_francaise_et_aucun_code_brut() {
        for raison in [
            REASON_AVAILABLE,
            REASON_NOT_COMPILED,
            REASON_MODEL_MISSING,
            REASON_MODEL_UNREADABLE,
            REASON_BUSY,
            "raison-du-futur",
        ] {
            let phrase = human_reason(raison);
            assert!(!phrase.is_empty(), "raison muette : {raison}");
            assert!(!phrase.contains(raison), "code brut dans la phrase : {raison}");
            assert!(phrase.contains(' '), "phrase illisible : {raison}");
        }
    }

    #[test]
    fn sans_la_feature_le_moteur_le_dit_au_lieu_de_se_taire() {
        let _ = ENGINE_COMPILED;
        if !cfg!(feature = "whisper") {
            let erreur = transcrire(Path::new("inexistant.bin"), &[0.0, 0.0]);
            assert!(erreur.is_err());
            assert!(erreur.unwrap_err().contains("n'est pas compilé"));
        }
    }

    #[test]
    fn une_session_neuve_a_un_identifiant_unique() {
        let a = next_session_id();
        let b = next_session_id();
        assert_ne!(a, b);
        assert!(a.starts_with("whisper-"));
    }

    #[test]
    fn la_taille_du_modele_est_celle_du_fichier_q8_0() {
        // Valeur mesurée sur le dépôt officiel (874 188 075 o) : si elle change,
        // un fichier valide serait déclaré incomplet — et donc jamais employé.
        assert_eq!(MODEL_BYTES, 874_188_075);
        assert!(MODEL_FILE.ends_with(".bin"));
    }
}
