// tts_local_download.rs — Téléchargement DES MODÈLES de voix française locale
// (Piper), et RIEN d'autre.
//
// Contraintes tenues ici, une seule fois :
//   - **aucun téléchargement sans geste** : ce module n'expose qu'une commande,
//     `tts_local_download`, appelée par le bouton « Télécharger » des Paramètres.
//     Rien ne se déclenche au démarrage, à l'ouverture des Paramètres, ni à la
//     lecture d'une réponse ;
//   - **aucun réseau à la lecture** : le module de synthèse (`tts_local.rs`) ne
//     dépend pas de celui-ci — la lecture d'un modèle déjà présent ne touche
//     jamais le réseau ;
//   - **un seul téléchargement à la fois** (`DOWNLOADING`, une seule garde) ;
//   - **arrêt possible** (`CANCELLED`) : l'utilisateur peut renoncer, l'état le
//     dit et une ligne est écrite dans le journal de la voix locale ;
//   - **aucun fichier supprimé** : un modèle déjà présent n'est jamais réécrit,
//     et un téléchargement interrompu ne supprime rien — le fichier temporaire
//     `.part` reste sur place (le prochain essai le réutilise) et le modèle
//     final n'est publié que complet (renommage du `.part` vérifié) ;
//   - **erreur visible, jamais bloquante** : toute panne (réseau, taille
//     inattendue, disque) rend un message clair à l'interface et laisse la
//     lecture retomber sur la voix du système.
//
// Patrons repris du dépôt : `laya_download.rs` (garde unique + état partagé +
// événement de progression écouté par `settings.js`) et `context_engine.rs`
// (`reqwest::blocking` dans une tâche de fond).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::tts_local::{self, LocalVoice};

/// Racine du dépôt officiel des modèles Piper (fichiers `resolve/main`).
pub const VOICES_BASE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
/// Suffixe du fichier temporaire d'un téléchargement non terminé.
pub const PART_SUFFIX: &str = ".part";
/// Événement de progression écouté par les Paramètres.
pub const PROGRESS_EVENT: &str = "tts-local-download-progress";
/// Taille maximale d'un fichier accepté (garde-fou : un modèle pèse ≈ 63 Mo).
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Fréquence maximale d'émission de la progression (jamais à chaque octet).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// Vrai pendant un téléchargement (garde unique : un seul à la fois).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
/// Demande d'arrêt (distingue un arrêt voulu d'une panne).
static CANCELLED: AtomicBool = AtomicBool::new(false);
/// Dernier état connu, lisible par l'interface (réouverture des Paramètres).
static STATE: Mutex<Option<DownloadState>> = Mutex::new(None);

/// État d'un téléchargement, tel que rendu à l'interface.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DownloadState {
    /// Modèle concerné (`fr_FR-<voix>-<qualité>`).
    pub model: String,
    /// Un téléchargement tourne-t-il encore ?
    pub running: bool,
    /// Octets déjà reçus (fichier final + temporaire).
    pub bytes: u64,
    /// Octets attendus au total.
    pub bytes_total: u64,
    /// Avancement en pourcentage (0-100), `null` si inconnu.
    pub percent: Option<u32>,
    /// Issue : `null` tant que rien n'est terminé, puis `done` / `cancelled` /
    /// `failed`.
    pub outcome: Option<String>,
    /// Message lisible (raison de l'échec, confirmation d'arrêt…).
    pub message: String,
}

impl DownloadState {
    fn idle() -> Self {
        DownloadState {
            model: String::new(),
            running: false,
            bytes: 0,
            bytes_total: 0,
            percent: None,
            outcome: None,
            message: String::new(),
        }
    }
}

/// Vrai si un téléchargement est en cours (lu par l'état du moteur local).
pub fn is_downloading() -> bool {
    DOWNLOADING.load(Ordering::SeqCst)
}

/// Pourcentage borné (0-100), `None` si le total est inconnu.
pub fn percent_of(bytes: u64, total: u64) -> Option<u32> {
    if total == 0 {
        return None;
    }
    Some(((bytes.min(total) * 100) / total) as u32)
}

/// Nom du modèle découpé en `(voix, qualité)`, ou `None` si le nom ne suit pas la
/// forme `fr_FR-<voix>-<qualité>` (aucune invention d'URL dans ce cas).
pub fn model_parts(model: &str) -> Option<(String, String)> {
    let model = model.trim();
    let rest = model.strip_prefix("fr_FR-")?;
    let (name, quality) = rest.rsplit_once('-')?;
    if name.is_empty() || quality.is_empty() {
        return None;
    }
    // Un nom de voix ne contient ni espace ni séparateur de chemin.
    if name.contains('/') || name.contains('\\') || name.contains(' ') || name.contains('.') {
        return None;
    }
    Some((name.to_string(), quality.to_string()))
}

/// URL officielle d'un fichier du modèle, ou `None` si le nom est inexploitable.
pub fn file_url(model: &str, file: &str) -> Option<String> {
    let (name, quality) = model_parts(model)?;
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return None;
    }
    Some(format!(
        "{}/fr/fr_FR/{}/{}/{}",
        VOICES_BASE_URL, name, quality, file
    ))
}

/// Les deux fichiers d'un modèle, avec leur taille exacte attendue.
pub fn download_files(voice: &LocalVoice) -> Vec<(String, u64)> {
    vec![
        (format!("{}.onnx", voice.model), voice.onnx_bytes),
        (
            format!("{}.onnx.json", voice.model),
            voice.config_bytes,
        ),
    ]
}

/// Chemin final d'un fichier de modèle (dans le dossier des voix).
pub fn target_path(root: &Path, file: &str) -> PathBuf {
    root.join(tts_local::VOICES_SUBDIR).join(file)
}

/// Chemin du fichier temporaire d'un téléchargement en cours.
pub fn part_path(target: &Path) -> PathBuf {
    PathBuf::from(format!("{}{}", target.display(), PART_SUFFIX))
}

/// Fichiers encore manquants (absents ou vides) : ce que le téléchargement doit
/// récupérer. Un fichier présent n'est JAMAIS retéléchargé ni réécrit.
pub fn missing_files(root: &Path, voice: &LocalVoice) -> Vec<(String, u64)> {
    download_files(voice)
        .into_iter()
        .filter(|(file, _)| {
            std::fs::metadata(target_path(root, file))
                .map(|m| !m.is_file() || m.len() == 0)
                .unwrap_or(true)
        })
        .collect()
}

fn set_state(update: impl FnOnce(&mut DownloadState)) {
    if let Ok(mut slot) = STATE.lock() {
        let state = slot.get_or_insert_with(DownloadState::idle);
        update(state);
    }
}

/// État courant du dernier téléchargement (réouverture des Paramètres).
pub fn current_state() -> DownloadState {
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

/// Télécharge UN fichier vers son chemin final.
///
/// Règles : jamais d'écrasement d'un fichier final existant, écriture dans
/// `<fichier>.part`, reprise si le serveur l'accepte (`Range`), vérification de la
/// taille, puis renommage. Un arrêt laisse le `.part` en place : rien n'est
/// supprimé.
fn fetch_one<F, C>(
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
    if let Ok(meta) = std::fs::metadata(target) {
        if meta.is_file() && meta.len() > 0 {
            // Déjà présent : on n'y touche pas.
            return Ok(());
        }
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("dossier inaccessible : {e}"))?;
    }
    let part = part_path(target);
    // Reprise : on complète un `.part` existant quand le serveur l'accepte.
    let already: u64 = std::fs::metadata(&part)
        .map(|m| if m.is_file() { m.len() } else { 0 })
        .unwrap_or(0);
    let mut request = client.get(url);
    if already > 0 && expected > already {
        request = request.header(reqwest::header::RANGE, format!("bytes={}-", already));
    }
    let mut response = request
        .send()
        .map_err(|e| format!("connexion impossible : {e}"))?;
    let status = response.status();
    // 206 = reprise acceptée ; 200 = le serveur renvoie tout depuis le début.
    let resuming = status == reqwest::StatusCode::PARTIAL_CONTENT && already > 0;
    if !status.is_success() {
        return Err(format!("le serveur a répondu {status}"));
    }
    let announced = response.content_length().unwrap_or(expected);
    let total = if resuming { announced + already } else { announced };
    if total > MAX_FILE_BYTES || expected > MAX_FILE_BYTES {
        return Err(format!("fichier trop volumineux ({total} octets)"));
    }
    let mut start = if resuming { already } else { 0 };
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true);
    if resuming {
        options.append(true);
    } else {
        options.truncate(true);
        start = 0;
    }
    // Un `.part` de reprise ignorée repart de zéro : on le tronque, on ne le
    // supprime toujours pas.
    let mut file = options
        .open(&part)
        .map_err(|e| format!("écriture impossible : {e}"))?;
    let mut received = start;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut last = Instant::now() - PROGRESS_INTERVAL;
    loop {
        if cancelled() {
            // On garde le `.part` : rien n'est supprimé.
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
    std::fs::rename(&part, target).map_err(|e| format!("publication impossible : {e}"))?;
    Ok(())
}

/// Télécharge les fichiers manquants d'une voix. Rend l'état final.
///
/// La garde `DOWNLOADING` est **déjà tenue** par l'appelant ; cette fonction la
/// relâche en sortant (quel que soit le chemin).
fn download_voice(app: Option<&AppHandle>, root: &Path, voice: &LocalVoice) -> DownloadState {
    let files = missing_files(root, voice);
    let total: u64 = files.iter().map(|(_, size)| *size).sum();
    set_state(|state| {
        *state = DownloadState {
            model: voice.model.to_string(),
            running: true,
            bytes: 0,
            bytes_total: total,
            percent: Some(0),
            outcome: None,
            message: String::new(),
        };
    });
    let snapshot = current_state();
    publish(app, &snapshot);

    if files.is_empty() {
        let state = DownloadState {
            model: voice.model.to_string(),
            running: false,
            bytes: 0,
            bytes_total: 0,
            percent: Some(100),
            outcome: Some("done".to_string()),
            message: format!("Le modèle {} est déjà installé.", voice.model),
        };
        set_state(|s| *s = state.clone());
        publish(app, &state);
        DOWNLOADING.store(false, Ordering::SeqCst);
        return state;
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
    {
        Ok(client) => client,
        Err(e) => return finish_with_error(app, root, voice, format!("client HTTP indisponible : {e}")),
    };

    let mut done_bytes = 0u64;
    let mut failure: Option<String> = None;
    let mut cancelled = false;
    for (file, expected) in &files {
        let Some(url) = file_url(voice.model, file) else {
            failure = Some(format!("adresse de téléchargement inconnue pour {file}"));
            break;
        };
        let target = target_path(root, file);
        let base = done_bytes;
        let result = fetch_one(
            &client,
            &url,
            &target,
            *expected,
            |received, file_total| {
                let bytes = base + received;
                let percent = percent_of(bytes, total);
                set_state(|state| {
                    state.bytes = bytes;
                    state.percent = percent;
                });
                let snapshot = current_state();
                publish(app, &snapshot);
                let _ = file_total;
            },
            || CANCELLED.load(Ordering::SeqCst),
        );
        match result {
            Ok(()) => done_bytes += *expected,
            Err(reason) if reason == "cancelled" => {
                cancelled = true;
                break;
            }
            Err(reason) => {
                failure = Some(format!("{file} : {reason}"));
                break;
            }
        }
    }

    let state = if cancelled {
        let log_line = format!(
            "téléchargement du modèle {} interrompu sur demande (rien n'a été supprimé)",
            voice.model
        );
        tts_local::append_log(root, &log_line);
        DownloadState {
            model: voice.model.to_string(),
            running: false,
            bytes: done_bytes,
            bytes_total: total,
            percent: percent_of(done_bytes, total),
            outcome: Some("cancelled".to_string()),
            message: "Téléchargement arrêté. Le modèle n'est pas installé ; \
                      la lecture continue avec la voix du système."
                .to_string(),
        }
    } else if let Some(reason) = failure {
        finish_state_with_error(root, voice, reason)
    } else {
        // Vérification finale sur disque (aucune confiance dans les compteurs).
        let status = tts_local::status_for_dir(root, Some(voice.model));
        if status.model_present {
            DownloadState {
                model: voice.model.to_string(),
                running: false,
                bytes: total,
                bytes_total: total,
                percent: Some(100),
                outcome: Some("done".to_string()),
                message: format!(
                    "Le modèle {} est installé : la lecture se fait désormais hors ligne.",
                    voice.model
                ),
            }
        } else {
            finish_state_with_error(root, voice, "fichiers incomplets après téléchargement".to_string())
        }
    };
    set_state(|s| *s = state.clone());
    publish(app, &state);
    DOWNLOADING.store(false, Ordering::SeqCst);
    state
}

/// Construit l'état d'échec (et journalise la raison, une seule fois).
fn finish_state_with_error(root: &Path, voice: &LocalVoice, reason: String) -> DownloadState {
    let line = format!(
        "téléchargement du modèle {} impossible : {} — la lecture utilise la voix du système",
        voice.model, reason
    );
    tts_local::append_log(root, &line);
    DownloadState {
        model: voice.model.to_string(),
        running: false,
        bytes: 0,
        bytes_total: 0,
        percent: None,
        outcome: Some("failed".to_string()),
        message: format!(
            "Téléchargement du modèle {} impossible : {}. La lecture continue avec la voix du système.",
            voice.model, reason
        ),
    }
}

fn finish_with_error(
    app: Option<&AppHandle>,
    root: &Path,
    voice: &LocalVoice,
    reason: String,
) -> DownloadState {
    let previous = current_state();
    let mut state = finish_state_with_error(root, voice, reason);
    state.bytes = previous.bytes;
    state.bytes_total = previous.bytes_total;
    set_state(|s| *s = state.clone());
    publish(app, &state);
    DOWNLOADING.store(false, Ordering::SeqCst);
    state
}

/// Racine du dossier de la voix locale.
fn local_voice_root(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(tts_local::LOCAL_VOICE_DIR))
}

/// Point d'entrée unique : télécharge la voix demandée (ou la voix par défaut).
///
/// Appelé **uniquement** par le bouton « Télécharger » des Paramètres : aucun
/// autre chemin ne déclenche un téléchargement.
#[tauri::command]
pub async fn tts_local_download(
    app: AppHandle,
    model: Option<String>,
) -> Result<DownloadState, String> {
    let voice = tts_local::voice_for(model.as_deref());
    // Garde unique : un seul téléchargement à la fois.
    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(DownloadState {
            running: true,
            message: "Un téléchargement est déjà en cours.".to_string(),
            ..current_state()
        });
    }
    CANCELLED.store(false, Ordering::SeqCst);
    let Some(root) = local_voice_root(&app) else {
        DOWNLOADING.store(false, Ordering::SeqCst);
        return Ok(DownloadState {
            model: voice.model.to_string(),
            running: false,
            bytes: 0,
            bytes_total: 0,
            percent: None,
            outcome: Some("failed".to_string()),
            message: "Dossier de données de Pilot introuvable : téléchargement impossible."
                .to_string(),
        });
    };
    let handle = app.clone();
    let state = tauri::async_runtime::spawn_blocking(move || {
        download_voice(Some(&handle), &root, voice)
    })
    .await
    .map_err(|e| format!("téléchargement interrompu : {e}"))?;
    Ok(state)
}

/// Demande l'arrêt du téléchargement en cours (sans effet s'il n'y en a pas).
#[tauri::command]
pub fn tts_local_cancel_download() -> DownloadState {
    CANCELLED.store(true, Ordering::SeqCst);
    let state = current_state();
    DownloadState {
        message: if state.running {
            "Arrêt demandé…".to_string()
        } else {
            "Aucun téléchargement en cours.".to_string()
        },
        ..state
    }
}

/// État du dernier téléchargement (relu à l'ouverture des Paramètres).
#[tauri::command]
pub fn tts_local_download_state() -> DownloadState {
    let mut state = current_state();
    state.running = is_downloading();
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts_local::{LocalVoice, VOICES};

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pilot-voix-dl-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn le_nom_du_modele_se_decoupe_et_les_urls_sont_exactes() {
        assert_eq!(
            model_parts("fr_FR-tom-medium"),
            Some(("tom".to_string(), "medium".to_string()))
        );
        assert_eq!(
            model_parts("fr_FR-siwis-medium"),
            Some(("siwis".to_string(), "medium".to_string()))
        );
        assert_eq!(model_parts("tom-medium"), None);
        assert_eq!(model_parts("fr_FR-tom"), None);
        assert_eq!(model_parts("fr_FR-a/b-medium"), None);
        assert_eq!(model_parts("fr_FR-../medium"), None);
        let url = file_url("fr_FR-tom-medium", "fr_FR-tom-medium.onnx").unwrap();
        assert_eq!(
            url,
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx"
        );
        assert!(file_url("fr_FR-tom-medium", "fr_FR-tom-medium.onnx.json")
            .unwrap()
            .ends_with("tom/medium/fr_FR-tom-medium.onnx.json"));
        // Aucun chemin traversant accepté.
        assert_eq!(file_url("fr_FR-tom-medium", "../secret.onnx"), None);
    }

    #[test]
    fn chaque_voix_proposee_a_une_url_et_deux_fichiers() {
        for voice in VOICES {
            let files = download_files(voice);
            assert_eq!(files.len(), 2, "{} : .onnx + .onnx.json", voice.model);
            for (file, size) in &files {
                assert!(*size > 1_000);
                assert!(
                    file_url(voice.model, file).is_some(),
                    "{} : URL manquante pour {file}",
                    voice.model
                );
            }
        }
    }

    #[test]
    fn un_fichier_present_n_est_jamais_retelescope_ni_reecrit() {
        let root = temp_root("present");
        let voice: &LocalVoice = &VOICES[0];
        // Rien sur disque : les deux fichiers manquent.
        assert_eq!(missing_files(&root, voice).len(), 2);
        // Le modèle est déposé : il ne doit plus être téléchargé.
        let target = target_path(&root, &format!("{}.onnx", voice.model));
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"deja-la").unwrap();
        let missing = missing_files(&root, voice);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].0, format!("{}.onnx.json", voice.model));
        // Un fichier vide compte comme manquant (téléchargement interrompu avant
        // la publication) ; il n'est pas supprimé, seulement complété.
        std::fs::write(&target, b"").unwrap();
        assert_eq!(missing_files(&root, voice).len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn le_fichier_temporaire_ne_touche_pas_au_fichier_final() {
        let root = temp_root("part");
        let target = target_path(&root, "fr_FR-tom-medium.onnx");
        let part = part_path(&target);
        assert!(part.display().to_string().ends_with("fr_FR-tom-medium.onnx.part"));
        assert_ne!(part, target);
        assert_eq!(percent_of(0, 63_511_038), Some(0));
        assert_eq!(percent_of(63_511_038, 63_511_038), Some(100));
        assert_eq!(percent_of(999, 100), Some(100));
        assert_eq!(percent_of(10, 0), None);
    }

    #[test]
    fn un_dossier_absent_ne_fait_pas_echouer_la_verification() {
        let root = temp_root("absent");
        let voice = &VOICES[0];
        // Aucun fichier : tout est « manquant », sans panique ni création.
        assert_eq!(missing_files(&root, voice).len(), 2);
        assert!(!root.join(tts_local::VOICES_SUBDIR).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn l_etat_par_defaut_est_inactif() {
        let state = DownloadState::idle();
        assert!(!state.running);
        assert_eq!(state.outcome, None);
        assert_eq!(state.percent, None);
        // Un état d'arrêt dit clairement que rien n'est installé.
        let cancelled = DownloadState {
            outcome: Some("cancelled".to_string()),
            message: "Téléchargement arrêté.".to_string(),
            ..DownloadState::idle()
        };
        assert!(!cancelled.running);
        assert_eq!(cancelled.outcome.as_deref(), Some("cancelled"));
    }
}
