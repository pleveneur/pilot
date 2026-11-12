// asr_whisper_download.rs — Installation du modèle de dictée du MOTEUR INTÉGRÉ,
// uniquement sur un GESTE de l'utilisateur.
//
// Ce module est le frère de `tts_local_download.rs` (voix française locale) et
// reprend ses règles une par une, sans en changer aucune :
//   - **aucun téléchargement sans geste** : une seule commande d'installation,
//     `asr_whisper_download`, appelée par un bouton des Paramètres. Rien ne se
//     déclenche au démarrage, à la sonde de l'état, ni à la dictée ;
//   - **aucun réseau ailleurs** : la dictée elle-même ne touche jamais le réseau
//     (`asr_whisper.rs` ne contient aucun appel HTTP) ;
//   - **un seul téléchargement à la fois** (`DOWNLOADING`, une seule garde) ;
//   - **arrêt possible** (`CANCELLED`) : l'état le dit, une ligne est écrite
//     dans le journal existant, et RIEN n'est supprimé ;
//   - **aucun fichier supprimé** : un fichier de taille exacte n'est jamais
//     réécrit, un téléchargement interrompu laisse son `.part` en place et le
//     prochain essai reprend là où il s'est arrêté (`Range`) ;
//   - **un fichier tronqué n'est jamais « installé »** : il est COMPLÉTÉ sur
//     place, jamais remplacé ni supprimé ;
//   - **erreur visible, jamais bloquante** : toute panne rend un message clair
//     à l'interface et la dictée repart sur l'autre oreille (jamais un silence).
//
// Aucune adresse n'est écrite ailleurs que dans ce module, et aucune adresse
// n'est lue par l'écran : la fenêtre ne parle qu'aux commandes de l'application.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::asr_whisper;
use crate::tts_local;

/// Dépôt officiel des modèles Whisper au format ggml (`resolve/main`).
pub const MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
/// Suffixe du fichier temporaire d'un téléchargement non terminé (le même que
/// celui de la voix locale : une seule convention dans le dépôt).
pub const PART_SUFFIX: &str = ".part";
/// Évènement de progression écouté par les Paramètres.
pub const PROGRESS_EVENT: &str = "asr-whisper-download-progress";
/// Plafond de sécurité (le modèle pèse ≈ 874 Mo : 1,5 Gio laisse la marge).
const MAX_FILE_BYTES: u64 = 1536 * 1024 * 1024;
/// Fréquence maximale d'émission de la progression (jamais à chaque octet).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
/// Délai du téléchargement : large, pour ne pas couper une ligne lente.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(3600);

/// Vrai pendant un téléchargement (garde unique : un seul à la fois).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
/// Demande d'arrêt (distingue un arrêt voulu d'une panne).
static CANCELLED: AtomicBool = AtomicBool::new(false);
/// Dernier état connu, relisible par l'interface (réouverture des Paramètres).
static STATE: Mutex<Option<DownloadState>> = Mutex::new(None);

/// État du téléchargement du modèle, tel que rendu à l'interface.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DownloadState {
    /// Un téléchargement tourne-t-il encore ?
    pub running: bool,
    /// Octets déjà reçus.
    pub bytes: u64,
    /// Octets attendus.
    pub bytes_total: u64,
    /// Avancement en pourcentage (0-100), `null` si inconnu.
    pub percent: Option<u32>,
    /// Identifiant du modèle concerné.
    pub model: String,
    /// Nom lisible du modèle concerné.
    pub model_label: String,
    /// Fichier attendu sur le disque (écrit en clair).
    pub path: String,
    /// Issue : `null` tant que rien n'est terminé, puis `ok` / `cancelled` /
    /// `error`.
    pub outcome: Option<String>,
    /// Message lisible (raison de l'échec, confirmation d'arrêt…).
    pub message: String,
}

impl DownloadState {
    /// État « rien en cours », qui décrit le modèle attendu.
    pub fn idle() -> Self {
        DownloadState {
            running: false,
            bytes: 0,
            bytes_total: asr_whisper::MODEL_BYTES,
            percent: None,
            model: asr_whisper::MODEL_ID.to_string(),
            model_label: asr_whisper::MODEL_LABEL.to_string(),
            path: String::new(),
            outcome: None,
            message: String::new(),
        }
    }
}

fn set_state(state: DownloadState) {
    if let Ok(mut slot) = STATE.lock() {
        *slot = Some(state);
    }
}

fn current_state() -> DownloadState {
    STATE
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_else(DownloadState::idle)
}

fn publish(app: Option<&AppHandle>, state: &DownloadState) {
    if let Some(app) = app {
        let _ = app.emit(PROGRESS_EVENT, state.clone());
    }
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|meta| if meta.is_file() { meta.len() } else { 0 })
        .unwrap_or(0)
}

/// Chemin du fichier temporaire d'un fichier final.
pub fn part_path(target: &Path) -> PathBuf {
    let mut nom = target.as_os_str().to_os_string();
    nom.push(PART_SUFFIX);
    PathBuf::from(nom)
}

/// Avancement en pourcentage, borné à 100 (jamais un pourcentage faux).
pub fn percent_of(received: u64, total: u64) -> Option<u32> {
    if total == 0 {
        return None;
    }
    let brut = (received as u128 * 100) / total as u128;
    Some(brut.min(100) as u32)
}

/// Télécharge LE fichier de modèle vers son chemin final.
///
/// Règles (identiques à la voix locale) : un fichier de taille exacte n'est
/// jamais réécrit ; écriture dans `<fichier>.part`, reprise si le serveur
/// l'accepte (`Range`), vérification de la taille, puis renommage. Un fichier
/// final de taille fausse est **complété sur place**, jamais supprimé. Un arrêt
/// laisse le `.part` en place : rien n'est supprimé.
fn fetch_model<F, C>(
    client: &reqwest::blocking::Client,
    url: &str,
    target: &Path,
    expected: u64,
    mut on_progress: F,
    mut cancelled: C,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
    C: FnMut() -> bool,
{
    if tts_local::file_complete(target, expected) {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("dossier inaccessible : {e}"))?;
    }
    let part = part_path(target);
    let part_len = file_len(&part);
    let target_len = file_len(target);
    let incomplete = |len: u64| len > 0 && (expected == 0 || len < expected);
    let (dest, already) = if incomplete(part_len) {
        (part, part_len)
    } else if incomplete(target_len) {
        (target.to_path_buf(), target_len)
    } else {
        (part, 0)
    };
    let mut request = client.get(url);
    if already > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={}-", already));
    }
    let mut response = request
        .send()
        .map_err(|e| format!("connexion impossible : {e}"))?;
    let status = response.status();
    let resuming = status == reqwest::StatusCode::PARTIAL_CONTENT && already > 0;
    if !status.is_success() {
        return Err(format!("le serveur a répondu {status}"));
    }
    let announced = response.content_length().unwrap_or(expected);
    let total = if resuming { announced + already } else { announced };
    if total > MAX_FILE_BYTES || expected > MAX_FILE_BYTES {
        return Err(format!("fichier trop volumineux ({total} octets)"));
    }
    let start = if resuming { already } else { 0 };
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true);
    if resuming {
        options.append(true);
    } else {
        options.truncate(true);
    }
    let mut file = options
        .open(&dest)
        .map_err(|e| format!("écriture impossible : {e}"))?;
    let mut received = start;
    let mut buffer = vec![0u8; 128 * 1024];
    let mut last = Instant::now() - PROGRESS_INTERVAL;
    loop {
        if cancelled() {
            // On garde le fichier en place : rien n'est supprimé.
            return Err("cancelled".to_string());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("lecture interrompue : {e}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("écriture impossible : {e}"))?;
        received += read as u64;
        if received > MAX_FILE_BYTES {
            return Err("fichier trop volumineux".to_string());
        }
        if last.elapsed() >= PROGRESS_INTERVAL {
            last = Instant::now();
            on_progress(received, total.max(expected));
        }
    }
    file.flush().ok();
    drop(file);
    on_progress(received, total.max(expected));
    if expected > 0 && received != expected {
        return Err(format!(
            "fichier incomplet : {received} octets reçus sur {expected} attendus"
        ));
    }
    if dest != target {
        std::fs::rename(&dest, target).map_err(|e| format!("publication impossible : {e}"))?;
    }
    Ok(())
}

/// Le travail complet du téléchargement (appelé hors du thread principal).
fn run_download(app: &AppHandle) -> DownloadState {
    let Some(cible) = asr_whisper::model_path(app) else {
        let mut etat = DownloadState::idle();
        etat.outcome = Some("error".to_string());
        etat.message = "Le dossier de données de Pilot est introuvable : le modèle ne peut pas être \
                        installé."
            .to_string();
        return etat;
    };
    let mut etat = DownloadState::idle();
    etat.path = cible.to_string_lossy().to_string();
    etat.bytes = file_len(&cible);
    etat.percent = percent_of(etat.bytes, etat.bytes_total);
    DOWNLOADING.store(true, Ordering::SeqCst);
    CANCELLED.store(false, Ordering::SeqCst);
    set_state(etat.clone());
    publish(Some(app), &etat);

    let client = reqwest::blocking::Client::builder()
        .timeout(TRANSFER_TIMEOUT)
        .build();
    let client = match client {
        Ok(client) => client,
        Err(e) => {
            DOWNLOADING.store(false, Ordering::SeqCst);
            let mut fin = etat;
            fin.outcome = Some("error".to_string());
            fin.message = format!("Le téléchargement n'a pas pu démarrer ({e}).");
            set_state(fin.clone());
            publish(Some(app), &fin);
            return fin;
        }
    };
    let url = format!("{}/{}", MODEL_BASE_URL, asr_whisper::MODEL_FILE);
    let mut progression = DownloadState {
        running: true,
        ..etat.clone()
    };
    let resultat = fetch_model(
        &client,
        &url,
        &cible,
        asr_whisper::MODEL_BYTES,
        |recus, total| {
            progression.bytes = recus;
            progression.bytes_total = total.max(asr_whisper::MODEL_BYTES);
            progression.percent = percent_of(progression.bytes, progression.bytes_total);
            set_state(progression.clone());
            publish(Some(app), &progression);
        },
        || CANCELLED.load(Ordering::SeqCst),
    );
    DOWNLOADING.store(false, Ordering::SeqCst);
    let recus = file_len(&cible).max(progression.bytes);
    let mut fin = DownloadState {
        running: false,
        bytes: recus,
        bytes_total: asr_whisper::MODEL_BYTES,
        percent: percent_of(recus, asr_whisper::MODEL_BYTES),
        ..etat
    };
    match resultat {
        Ok(()) => {
            fin.outcome = Some("ok".to_string());
            fin.message = "Le modèle de dictée est installé : le moteur intégré peut servir.".to_string();
            asr_whisper::log(app, "modèle de dictée installé (transcription sur cet ordinateur)");
        }
        Err(refus) if refus == "cancelled" => {
            fin.outcome = Some("cancelled".to_string());
            fin.message = "Téléchargement arrêté. Ce qui a déjà été reçu reste en place : reprendre \
                           continuera là où cela s'est arrêté."
                .to_string();
            asr_whisper::log(app, "téléchargement du modèle arrêté par l'utilisateur (rien supprimé)");
        }
        Err(panne) => {
            fin.outcome = Some("error".to_string());
            fin.message = format!(
                "Le téléchargement du modèle de dictée a échoué ({panne}). Ce qui a déjà été reçu \
                 reste en place."
            );
            asr_whisper::log(app, &format!("téléchargement du modèle en échec : {panne}"));
        }
    }
    set_state(fin.clone());
    publish(Some(app), &fin);
    fin
}

/// Installe le modèle de dictée du moteur intégré (geste de l'utilisateur).
/// Un seul téléchargement à la fois : une demande pendant un téléchargement en
/// cours est REFUSÉE en clair (jamais de second transfert concurrent).
#[tauri::command]
pub async fn asr_whisper_download(app: AppHandle) -> Result<DownloadState, String> {
    // `swap` rend l'état d'AVANT : vrai = un transfert tient déjà la garde, et
    // on n'y touche pas (c'est lui qui la libèrera à la fin).
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        let mut etat = current_state();
        etat.message = "Un téléchargement est déjà en cours : attendez la fin ou arrêtez-le."
            .to_string();
        return Ok(etat);
    }
    let poignee = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_download(&poignee))
        .await
        .map_err(|e| format!("le téléchargement a échoué ({e})"))
}

/// Arrête le téléchargement en cours. Ne supprime RIEN : ce qui a été reçu
/// reste sur le disque et le prochain essai reprend.
#[tauri::command]
pub async fn asr_whisper_cancel_download() -> Result<DownloadState, String> {
    if !DOWNLOADING.load(Ordering::SeqCst) {
        return Ok(current_state());
    }
    CANCELLED.store(true, Ordering::SeqCst);
    Ok(current_state())
}

/// Dernier état connu du téléchargement (relu à l'ouverture des Paramètres).
#[tauri::command]
pub async fn asr_whisper_download_state() -> Result<DownloadState, String> {
    Ok(current_state())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_pourcentage_est_borne_et_jamais_invente() {
        assert_eq!(percent_of(0, 100), Some(0));
        assert_eq!(percent_of(50, 100), Some(50));
        assert_eq!(percent_of(200, 100), Some(100));
        assert_eq!(percent_of(10, 0), None);
    }

    #[test]
    fn le_fichier_temporaire_est_voisin_du_fichier_final() {
        let final_path = Path::new("C:/donnees/dictee/ggml.bin");
        let part = part_path(final_path);
        assert_eq!(part, Path::new("C:/donnees/dictee/ggml.bin.part"));
        // Le fichier final n'est jamais désigné par le chemin temporaire.
        assert_ne!(part, final_path);
    }

    #[test]
    fn l_etat_au_repos_designe_le_modele_attendu_et_ne_pretend_rien() {
        let etat = DownloadState::idle();
        assert!(!etat.running);
        assert_eq!(etat.outcome, None);
        assert_eq!(etat.bytes_total, asr_whisper::MODEL_BYTES);
        assert!(etat.message.is_empty());
        assert_eq!(etat.model, asr_whisper::MODEL_ID);
    }

    #[test]
    fn l_adresse_du_modele_est_celle_du_depot_officiel() {
        // Garde-fou documentaire : le nom du fichier et la racine employée sont
        // ceux mesurés (874 188 075 o), jamais une variante approximative.
        assert!(MODEL_BASE_URL.ends_with("ggerganov/whisper.cpp/resolve/main"));
        assert_eq!(asr_whisper::MODEL_FILE, "ggml-large-v3-turbo-q8_0.bin");
    }
}
