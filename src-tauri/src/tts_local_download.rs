// tts_local_download.rs — Installation de la voix française locale (Piper) en
// UN SEUL GESTE : le moteur de lecture + les deux voix françaises (une femme,
// un homme), puis téléchargement d'un modèle de voix isolé si besoin.
//
// Contraintes tenues ici, une seule fois :
//   - **aucun téléchargement sans geste** : ce module n'expose qu'une commande,
//     `tts_local_download`, appelée par le bouton « Installer la voix locale »
//     des Paramètres. Rien ne se déclenche au démarrage, à l'ouverture des
//     Paramètres, ni à la lecture d'une réponse ;
//   - **aucun réseau à la lecture** : le module de synthèse (`tts_local.rs`) ne
//     dépend pas de celui-ci — la lecture d'un modèle déjà présent ne touche
//     jamais le réseau ;
//   - **un seul téléchargement à la fois** (`DOWNLOADING`, une seule garde) ;
//   - **arrêt possible** (`CANCELLED`) : l'utilisateur peut renoncer, l'état le
//     dit et une ligne est écrite dans le journal de la voix locale ;
//   - **aucun fichier supprimé** : un fichier déjà complet n'est jamais réécrit,
//     l'archive du moteur reste en place, et un téléchargement interrompu ne
//     supprime rien — le fichier temporaire `.part` reste sur place (le prochain
//     essai le réutilise, `Range`) et le fichier final n'est publié que complet ;
//   - **un fichier tronqué n'est jamais « installé »** : la présence d'un
//     fichier final de taille fausse le fait traiter comme manquant, et il est
//     **complété** (jamais supprimé) au lieu d'être cru bon ;
//   - **erreur visible, jamais bloquante** : toute panne (réseau, taille
//     inattendue, disque) rend un message clair à l'interface et laisse la
//     lecture retomber sur la voix du système ;
//   - **moteur Windows seulement** : sur macOS et Linux, Pilot n'installe pas le
//     moteur (il ne le fournit pas) — les voix se téléchargent, le message le
//     dit, et la lecture reste sur la voix du système.
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
/// Archive officielle du MOTEUR de lecture (Windows) : elle contient le dossier
/// `piper/` (binaire, DLL, données eSpeak) attendu tel quel par
/// `tts_local::piper_dir`.
pub const ENGINE_ARCHIVE_URL: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
/// Nom de l'archive une fois sur le disque (elle RESTE en place : rien n'est
/// supprimé après décompression).
pub const ENGINE_ARCHIVE_FILE: &str = "piper_windows_amd64.zip";
/// Taille exacte de l'archive du moteur (octets) : 22 477 236 o (21,4 Mo).
pub const ENGINE_ARCHIVE_BYTES: u64 = 22_477_236;
/// Taille du moteur une fois décompressé (octets) : 38 846 222 o (≈ 37 Mo).
/// Valeur **documentaire** (annoncée dans `spec_read_aloud.md` et le rapport
/// d'installation) : elle n'entre dans aucun calcul, donc pas de code mort ici.
#[allow(dead_code)]
pub const ENGINE_UNPACKED_BYTES: u64 = 38_846_222;
/// Sous-dossier où l'archive du moteur est déposée (rien n'est supprimé).
pub const DOWNLOADS_SUBDIR: &str = "telechargements";
/// Identifiant de l'étape « moteur » dans un plan d'installation.
pub const ENGINE_STEP: &str = "engine";
/// Voix installées par le geste unique : une voix de femme ET une voix d'homme,
/// en qualité moyenne (décision du propriétaire : ni voix de qualité légère, ni
/// autre langue).
pub const BUNDLE_MODELS: &[&str] = &["fr_FR-siwis-medium", "fr_FR-tom-medium"];
/// Suffixe du fichier temporaire d'un téléchargement non terminé.
pub const PART_SUFFIX: &str = ".part";
/// Événement de progression écouté par les Paramètres.
pub const PROGRESS_EVENT: &str = "tts-local-download-progress";
/// Taille maximale d'un fichier accepté (garde-fou : un modèle pèse ≈ 63 Mo).
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Fréquence maximale d'émission de la progression (jamais à chaque octet).
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
/// Délai d'un téléchargement : large, pour ne pas couper une ligne lente (une
/// installation complète pèse ≈ 142 Mo).
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(1800);

/// Vrai pendant un téléchargement (garde unique : un seul à la fois).
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
/// Demande d'arrêt (distingue un arrêt voulu d'une panne).
static CANCELLED: AtomicBool = AtomicBool::new(false);
/// Dernier état connu, lisible par l'interface (réouverture des Paramètres).
static STATE: Mutex<Option<DownloadState>> = Mutex::new(None);

/// État d'un téléchargement, tel que rendu à l'interface.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DownloadState {
    /// Modèle concerné (`fr_FR-<voix>-<qualité>`) — celui qui a été demandé.
    pub model: String,
    /// Un téléchargement tourne-t-il encore ?
    pub running: bool,
    /// Octets déjà reçus pour TOUTE l'installation.
    pub bytes: u64,
    /// Octets attendus pour toute l'installation.
    pub bytes_total: u64,
    /// Avancement global en pourcentage (0-100), `null` si inconnu.
    pub percent: Option<u32>,
    /// Étape en cours (`engine` ou le nom du modèle) — vide si aucune.
    pub step: String,
    /// Libellé lisible de l'étape en cours (« le moteur de lecture », …).
    pub step_label: String,
    /// Numéro de l'étape en cours (1 = première).
    pub step_index: u32,
    /// Nombre total d'étapes de l'installation.
    pub step_count: u32,
    /// Octets déjà reçus pour l'étape en cours.
    pub step_bytes: u64,
    /// Octets attendus pour l'étape en cours.
    pub step_bytes_total: u64,
    /// Avancement de l'étape en cours (0-100), `null` si inconnu.
    pub step_percent: Option<u32>,
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
            step: String::new(),
            step_label: String::new(),
            step_index: 0,
            step_count: 0,
            step_bytes: 0,
            step_bytes_total: 0,
            step_percent: None,
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

/// Libellé lisible d'une étape d'installation (jamais un identifiant technique).
pub fn step_label(step: &str) -> String {
    if step == ENGINE_STEP {
        return "le moteur de lecture".to_string();
    }
    let voice = tts_local::voice_for(Some(step));
    format!(
        "la {}, modèle {}",
        tts_local::gender_label(voice.gender),
        voice.model
    )
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
        (format!("{}.onnx.json", voice.model), voice.config_bytes),
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

/// Chemin de l'archive du moteur (elle reste en place après décompression).
pub fn engine_archive_path(root: &Path) -> PathBuf {
    root.join(DOWNLOADS_SUBDIR).join(ENGINE_ARCHIVE_FILE)
}

/// Fichiers d'un modèle encore à récupérer (absents **ou de taille fausse**) :
/// ce que le téléchargement doit réparer. Un fichier de taille exacte n'est
/// JAMAIS retéléchargé ni réécrit.
pub fn missing_files(root: &Path, voice: &LocalVoice) -> Vec<(String, u64)> {
    download_files(voice)
        .into_iter()
        .filter(|(file, expected)| !tts_local::file_complete(&target_path(root, file), *expected))
        .collect()
}

/// Une étape du geste unique : le moteur, puis chaque voix manquante.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanStep {
    /// `engine` ou le nom du modèle.
    pub id: String,
    /// Fichiers à récupérer (nom, taille exacte attendue).
    pub files: Vec<(String, u64)>,
    /// Vrai pour l'étape du moteur (une archive à décompresser).
    pub engine: bool,
    /// Octets attendus pour cette étape.
    pub bytes: u64,
}

/// Plan du geste unique : tout ce qu'il reste à installer, dans l'ordre.
///
/// Ordre : le **moteur** d'abord (sans lui rien ne se lit), puis les voix — la
/// voix de femme, puis la voix d'homme. Un moteur déjà présent (même celui d'une
/// autre version de Pilot) n'est **jamais** retéléchargé ni écrasé.
#[derive(Debug, Clone, PartialEq)]
pub struct BundlePlan {
    /// Vrai si Pilot sait installer le moteur sur CE système.
    pub engine_supported: bool,
    /// Étapes à exécuter (liste vide si tout est déjà en place).
    pub steps: Vec<PlanStep>,
}

impl BundlePlan {
    /// Octets attendus pour toute l'installation.
    pub fn bytes_total(&self) -> u64 {
        self.steps.iter().map(|step| step.bytes).sum()
    }
}

/// Construit le plan d'installation (lecture seule : aucun fichier touché).
pub fn plan_bundle(root: &Path, engine_root: &Path) -> BundlePlan {
    let engine_supported = tts_local::engine_install_supported();
    let mut steps: Vec<PlanStep> = Vec::new();
    if !tts_local::piper_exe(engine_root).is_file() && engine_supported {
        steps.push(PlanStep {
            id: ENGINE_STEP.to_string(),
            files: vec![(ENGINE_ARCHIVE_FILE.to_string(), ENGINE_ARCHIVE_BYTES)],
            engine: true,
            bytes: ENGINE_ARCHIVE_BYTES,
        });
    }
    for model in BUNDLE_MODELS {
        let voice = tts_local::voice_for(Some(model));
        let files = missing_files(root, voice);
        if files.is_empty() {
            continue;
        }
        let bytes = files.iter().map(|(_, size)| *size).sum();
        steps.push(PlanStep {
            id: voice.model.to_string(),
            files,
            engine: false,
            bytes,
        });
    }
    BundlePlan {
        engine_supported,
        steps,
    }
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

/// Taille d'un fichier s'il existe (0 sinon).
fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|meta| if meta.is_file() { meta.len() } else { 0 })
        .unwrap_or(0)
}

/// Télécharge UN fichier vers son chemin final.
///
/// Règles : un fichier de taille exacte n'est jamais réécrit ; écriture dans
/// `<fichier>.part`, reprise si le serveur l'accepte (`Range`), vérification de
/// la taille, puis renommage. Un fichier FINAL de taille fausse (tronqué) est
/// **complété sur place**, jamais supprimé. Un arrêt laisse le `.part` en place :
/// rien n'est supprimé.
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
    if tts_local::file_complete(target, expected) {
        // Déjà complet : on n'y touche pas.
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("dossier inaccessible : {e}"))?;
    }
    let part = part_path(target);
    let part_len = file_len(&part);
    let target_len = file_len(target);
    // Point de reprise : le `.part` d'un essai précédent d'abord ; à défaut, un
    // fichier final TRONQUÉ est complété sur place (aucun octet déjà reçu n'est
    // jeté, aucun fichier n'est supprimé).
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
    let start = if resuming { already } else { 0 };
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true);
    if resuming {
        options.append(true);
    } else {
        options.truncate(true);
    }
    // Reprise ignorée par le serveur : le fichier repart de zéro — il est
    // tronqué (réécrit), jamais supprimé.
    let mut file = options
        .open(&dest)
        .map_err(|e| format!("écriture impossible : {e}"))?;
    let mut received = start;
    let mut buffer = vec![0u8; 64 * 1024];
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

/// Décompresse l'archive du moteur dans `<root>/`.
///
/// L'archive officielle contient le dossier `piper/` attendu tel quel par
/// `tts_local::piper_dir` (binaire, DLL, données eSpeak). Un fichier déjà présent
/// à la MÊME taille n'est pas réécrit ; rien n'est supprimé.
pub fn unpack_engine(archive: &Path, root: &Path) -> Result<u32, String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("archive illisible : {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("archive invalide : {e}"))?;
    let mut written = 0u32;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("archive illisible : {e}"))?;
        // `enclosed_name` refuse tout chemin qui sortirait du dossier cible
        // (aucune écriture hors du dossier de la voix locale).
        let Some(relative) = entry.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let out = root.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).ok();
            continue;
        }
        let size = entry.size();
        let existing = file_len(&out);
        if existing > 0 && existing == size {
            // Déjà décompressé à l'identique : on ne réécrit pas.
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("dossier inaccessible : {e}"))?;
        }
        let mut target = std::fs::File::create(&out).map_err(|e| format!("écriture impossible : {e}"))?;
        std::io::copy(&mut entry, &mut target).map_err(|e| format!("écriture impossible : {e}"))?;
        target.flush().ok();
        written += 1;
    }
    Ok(written)
}

/// État final « tout est en place », avec le message qui dit exactement quoi.
fn finish_ok(
    root: &Path,
    engine_root: &Path,
    model: &str,
    bytes: u64,
    total: u64,
) -> DownloadState {
    let all_voices_ok = BUNDLE_MODELS.iter().all(|name| {
        tts_local::status_for_dir_with_engine(root, engine_root, Some(name)).installed
    });
    let chosen = tts_local::status_for_dir_with_engine(root, engine_root, Some(model));
    let message = if all_voices_ok {
        tts_local::append_log(
            root,
            "installation terminée : moteur et deux voix françaises en place (lecture hors ligne)",
        );
        "Installation terminée : le moteur de lecture et les deux voix françaises (une femme et un \
         homme) sont en place — la lecture se fait désormais hors ligne, sans réseau."
            .to_string()
    } else if !tts_local::engine_install_supported() {
        tts_local::append_log(
            root,
            "voix françaises installées mais moteur absent : Pilot ne fournit pas de moteur pour ce \
             système (repli sur la voix du système)",
        );
        "Les deux voix françaises sont installées, mais la voix locale n'est pas encore utilisable : \
         Pilot ne fournit pas le moteur de lecture pour ce système. La lecture utilise la voix du \
         système en attendant."
            .to_string()
    } else if !chosen.installed {
        tts_local::append_log(
            root,
            &format!(
                "installation terminée mais le modèle demandé {} n'est pas installé (le geste \
                 installe la voix de femme et la voix d'homme en qualité moyenne)",
                model
            ),
        );
        format!(
            "Installation terminée : la voix de femme et la voix d'homme sont en place, mais le \
             modèle demandé ({}) n'est pas installé — il n'est pas inclus dans ce geste. La lecture \
             utilise la voix du système avec ce choix.",
            model
        )
    } else {
        tts_local::append_log(
            root,
            "installation terminée, mais un fichier manque encore après vérification",
        );
        "Installation terminée, mais la voix locale n'est pas encore utilisable (un fichier manque). \
         Cliquez sur « Vérifier à nouveau » ; la lecture utilise la voix du système."
            .to_string()
    };
    DownloadState {
        model: model.to_string(),
        running: false,
        bytes,
        bytes_total: total,
        percent: Some(100),
        step: String::new(),
        step_label: String::new(),
        step_index: 0,
        step_count: 0,
        step_bytes: 0,
        step_bytes_total: 0,
        step_percent: None,
        outcome: Some("done".to_string()),
        message,
    }
}

/// Construit l'état d'échec (et journalise la raison, une seule fois).
fn failure_state(root: &Path, model: &str, reason: String, done_bytes: u64, total: u64) -> DownloadState {
    tts_local::append_log(
        root,
        &format!(
            "installation de la voix locale impossible : {} — la lecture utilise la voix du système",
            reason
        ),
    );
    DownloadState {
        model: model.to_string(),
        running: false,
        bytes: done_bytes,
        bytes_total: total,
        percent: percent_of(done_bytes, total),
        step: String::new(),
        step_label: String::new(),
        step_index: 0,
        step_count: 0,
        step_bytes: 0,
        step_bytes_total: 0,
        step_percent: None,
        outcome: Some("failed".to_string()),
        message: format!(
            "Installation impossible : {}. La lecture continue avec la voix du système (le \
             téléchargement reprendra là où il s'est arrêté).",
            reason
        ),
    }
}

/// Exécute le plan d'installation (moteur puis voix) et rend l'état final.
///
/// La garde `DOWNLOADING` est **déjà tenue** par l'appelant ; cette fonction la
/// relâche en sortant (quel que soit le chemin).
fn download_bundle(
    app: Option<&AppHandle>,
    root: &Path,
    engine_root: &Path,
    model: &str,
) -> DownloadState {
    let plan = plan_bundle(root, engine_root);
    let total = plan.bytes_total();
    let count = plan.steps.len() as u32;
    set_state(|state| {
        *state = DownloadState {
            model: model.to_string(),
            running: true,
            bytes: 0,
            bytes_total: total,
            percent: Some(0),
            step_count: count,
            ..DownloadState::idle()
        };
    });
    let snapshot = current_state();
    publish(app, &snapshot);

    if plan.steps.is_empty() {
        // Tout est déjà en place : rien n'est retéléchargé ni écrasé.
        let mut state = finish_ok(root, engine_root, model, 0, 0);
        state.message = "La voix locale est déjà installée : rien n'a été téléchargé.".to_string();
        set_state(|s| *s = state.clone());
        publish(app, &state);
        DOWNLOADING.store(false, Ordering::SeqCst);
        return state;
    }

    let client = match reqwest::blocking::Client::builder()
        .timeout(TRANSFER_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            let state = failure_state(root, model, format!("client HTTP indisponible : {e}"), 0, total);
            set_state(|s| *s = state.clone());
            publish(app, &state);
            DOWNLOADING.store(false, Ordering::SeqCst);
            return state;
        }
    };

    let mut done_bytes = 0u64;
    let mut failure: Option<String> = None;
    let mut cancelled = false;
    let mut engine_root_after = engine_root.to_path_buf();
    for (index, step) in plan.steps.iter().enumerate() {
        let step_total = step.bytes;
        let label = step_label(&step.id);
        let step_index = index as u32 + 1;
        set_state(|state| {
            state.step = step.id.clone();
            state.step_label = label.clone();
            state.step_index = step_index;
            state.step_count = count;
            state.step_bytes = 0;
            state.step_bytes_total = step_total;
            state.step_percent = percent_of(0, step_total);
        });
        publish(app, &current_state());

        for (file, expected) in &step.files {
            let url = if step.engine {
                ENGINE_ARCHIVE_URL.to_string()
            } else {
                match file_url(&step.id, file) {
                    Some(url) => url,
                    None => {
                        failure = Some(format!("adresse de téléchargement inconnue pour {file}"));
                        break;
                    }
                }
            };
            let target = if step.engine {
                engine_archive_path(root)
            } else {
                target_path(root, file)
            };
            let offset = done_bytes;
            let result = fetch_one(
                &client,
                &url,
                &target,
                *expected,
                |received, _file_total| {
                    let bytes = offset + received;
                    let percent = percent_of(bytes, total);
                    let step_percent = percent_of(received, step_total);
                    set_state(|state| {
                        state.bytes = bytes;
                        state.percent = percent;
                        state.step_bytes = received;
                        state.step_percent = step_percent;
                    });
                    let snapshot = current_state();
                    publish(app, &snapshot);
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
                    failure = Some(if step.engine {
                        format!("le moteur de lecture : {reason}")
                    } else {
                        format!("{file} : {reason}")
                    });
                    break;
                }
            }
        }
        if cancelled || failure.is_some() {
            break;
        }
        // Étape du moteur : décompression, puis vérification RÉELLE du binaire.
        if step.engine {
            if let Err(reason) = unpack_engine(&engine_archive_path(root), root) {
                failure = Some(format!("le moteur de lecture : {reason}"));
                break;
            }
            if !tts_local::piper_exe(root).is_file() {
                failure = Some(
                    "le moteur de lecture : le programme attendu n'est pas dans l'archive".to_string(),
                );
                break;
            }
            engine_root_after = root.to_path_buf();
        }
    }

    let state = if cancelled {
        tts_local::append_log(
            root,
            "installation de la voix locale interrompue sur demande (rien n'a été supprimé)",
        );
        DownloadState {
            model: model.to_string(),
            running: false,
            bytes: done_bytes,
            bytes_total: total,
            percent: percent_of(done_bytes, total),
            outcome: Some("cancelled".to_string()),
            message: "Installation arrêtée : rien n'a été supprimé, et le téléchargement reprendra \
                      là où il s'est arrêté. La lecture utilise la voix du système."
                .to_string(),
            ..DownloadState::idle()
        }
    } else if let Some(reason) = failure {
        failure_state(root, model, reason, done_bytes, total)
    } else {
        // Vérification finale sur disque (aucune confiance dans les compteurs).
        finish_ok(root, &engine_root_after, model, done_bytes, total)
    };
    set_state(|s| *s = state.clone());
    publish(app, &state);
    DOWNLOADING.store(false, Ordering::SeqCst);
    state
}

/// Dossiers de CETTE instance : (dossier des modèles, dossier du moteur).
fn roots_for(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    use tauri::Manager;
    let data = app.path().app_data_dir().ok()?;
    let root = data.join(tts_local::LOCAL_VOICE_DIR);
    let product = tts_local::product_identifier(&app.config().identifier);
    // Le moteur peut déjà être installé pour une AUTRE version de Pilot du même
    // ordinateur : il est alors réutilisé (aucune copie, aucun téléchargement).
    let (engine_root, _shared) = tts_local::resolve_engine_root(&root, &product);
    Some((root, engine_root))
}

/// Point d'entrée unique : **un seul geste** installe le moteur et les deux voix
/// françaises ; `model` ne sert qu'à désigner la voix demandée (état et message).
///
/// Appelé **uniquement** par le bouton « Installer la voix locale » des
/// Paramètres : aucun autre chemin ne déclenche un téléchargement.
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
            message: "Une installation est déjà en cours.".to_string(),
            ..current_state()
        });
    }
    CANCELLED.store(false, Ordering::SeqCst);
    let Some((root, engine_root)) = roots_for(&app) else {
        DOWNLOADING.store(false, Ordering::SeqCst);
        return Ok(DownloadState {
            model: voice.model.to_string(),
            running: false,
            outcome: Some("failed".to_string()),
            message: "Dossier de données de Pilot introuvable : installation impossible.".to_string(),
            ..DownloadState::idle()
        });
    };
    let handle = app.clone();
    let wanted = voice.model.to_string();
    let state = tauri::async_runtime::spawn_blocking(move || {
        download_bundle(Some(&handle), &root, &engine_root, &wanted)
    })
    .await
    .map_err(|e| format!("installation interrompue : {e}"))?;
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
            "Aucune installation en cours.".to_string()
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

    /// Écrit un fichier de la taille EXACTE attendue, sans écrire les octets.
    fn write_sized(path: &Path, len: u64) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let file = std::fs::File::create(path).unwrap();
        file.set_len(len).unwrap();
    }

    /// Pose un modèle COMPLET (binaire + configuration, tailles exactes).
    fn write_voice(root: &Path, model: &str) {
        let voice = tts_local::voice_for(Some(model));
        write_sized(&target_path(root, &format!("{}.onnx", voice.model)), voice.onnx_bytes);
        write_sized(
            &target_path(root, &format!("{}.onnx.json", voice.model)),
            voice.config_bytes,
        );
    }

    /// Pose le moteur (binaire présent = moteur installé).
    fn write_engine(root: &Path) {
        let exe = tts_local::piper_exe(root);
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(exe, b"fake").unwrap();
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
        // Le modèle COMPLET est déposé : il ne doit plus être téléchargé.
        let target = target_path(&root, &format!("{}.onnx", voice.model));
        write_sized(&target, voice.onnx_bytes);
        let missing = missing_files(&root, voice);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].0, format!("{}.onnx.json", voice.model));
        // Un fichier de taille fausse (tronqué) compte comme manquant : il sera
        // réparé, jamais considéré comme installé.
        write_sized(&target, voice.onnx_bytes - 1);
        assert_eq!(missing_files(&root, voice).len(), 2);
        // Un fichier vide aussi, et il n'est pas supprimé (seulement complété).
        std::fs::write(&target, b"").unwrap();
        assert_eq!(missing_files(&root, voice).len(), 2);
        assert!(target.exists(), "aucun fichier n'est supprimé");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn le_plan_installe_le_moteur_puis_la_femme_puis_l_homme() {
        let root = temp_root("plan");
        // Rien du tout : moteur d'abord, puis la voix de femme, puis l'homme.
        let plan = plan_bundle(&root, &root);
        let attendu: Vec<&str> = if tts_local::engine_install_supported() {
            vec![ENGINE_STEP, "fr_FR-siwis-medium", "fr_FR-tom-medium"]
        } else {
            vec!["fr_FR-siwis-medium", "fr_FR-tom-medium"]
        };
        let ids: Vec<&str> = plan.steps.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, attendu);
        // Les tailles annoncées sont celles du catalogue (aucune estimation).
        let total = plan.bytes_total();
        let voix: u64 = ["fr_FR-siwis-medium", "fr_FR-tom-medium"]
            .iter()
            .map(|model| {
                let voice = tts_local::voice_for(Some(*model));
                voice.onnx_bytes + voice.config_bytes
            })
            .sum();
        let moteur = if tts_local::engine_install_supported() {
            ENGINE_ARCHIVE_BYTES
        } else {
            0
        };
        assert_eq!(total, voix + moteur);
        // Le libellé de l'étape du moteur est humain, jamais un identifiant.
        assert_eq!(step_label(ENGINE_STEP), "le moteur de lecture");
        assert!(step_label("fr_FR-tom-medium").contains("voix d'homme"));

        // Moteur présent : il n'est JAMAIS dans le plan (ni retéléchargé ni écrasé).
        write_engine(&root);
        let plan = plan_bundle(&root, &root);
        assert!(plan.steps.iter().all(|s| !s.engine));
        assert_eq!(plan.steps.len(), 2);

        // Tout installé : plus rien à faire (aucun téléchargement).
        write_voice(&root, "fr_FR-siwis-medium");
        write_voice(&root, "fr_FR-tom-medium");
        assert!(plan_bundle(&root, &root).steps.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn le_moteur_d_une_autre_version_evite_le_telechargement() {
        let parent = temp_root("partage-moteur");
        let own = parent.join("com.pilot.editor.dev").join(tts_local::LOCAL_VOICE_DIR);
        let other = parent.join("com.pilot.editor").join(tts_local::LOCAL_VOICE_DIR);
        std::fs::create_dir_all(&own).unwrap();
        write_engine(&other);
        let plan = plan_bundle(&own, &other);
        assert!(
            plan.steps.iter().all(|s| !s.engine),
            "un moteur déjà installé n'est pas retéléchargé"
        );
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn l_archive_du_moteur_est_rangee_et_jamais_supprimee() {
        let root = temp_root("archive");
        let archive = engine_archive_path(&root);
        assert!(archive.ends_with(ENGINE_ARCHIVE_FILE));
        assert!(archive.parent().unwrap().ends_with(DOWNLOADS_SUBDIR));
        // Une archive absente ou de taille fausse n'est pas « complète » : elle
        // est reprise, jamais supprimée.
        assert!(!tts_local::file_complete(&archive, ENGINE_ARCHIVE_BYTES));
        write_sized(&archive, ENGINE_ARCHIVE_BYTES);
        assert!(tts_local::file_complete(&archive, ENGINE_ARCHIVE_BYTES));
        // Aucune suppression dans ce module (garantie vérifiée en lecture de source
        // par `catalogue-voix-locales.test.js` côté JS).
        assert!(archive.exists());
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
        assert_eq!(state.step_count, 0);
        // Un état d'arrêt dit clairement que rien n'est installé.
        let cancelled = DownloadState {
            outcome: Some("cancelled".to_string()),
            message: "Installation arrêtée.".to_string(),
            ..DownloadState::idle()
        };
        assert!(!cancelled.running);
        assert_eq!(cancelled.outcome.as_deref(), Some("cancelled"));
    }

    #[test]
    fn l_etat_porte_l_etape_en_cours_et_ses_octets() {
        // L'interface affiche la progression de l'étape (le moteur compris) et
        // pas seulement un pourcentage global.
        let state = DownloadState {
            running: true,
            bytes: 3_000_000,
            bytes_total: 149_199_402,
            percent: Some(2),
            step: ENGINE_STEP.to_string(),
            step_label: step_label(ENGINE_STEP),
            step_index: 1,
            step_count: 3,
            step_bytes: 3_000_000,
            step_bytes_total: ENGINE_ARCHIVE_BYTES,
            step_percent: Some(13),
            ..DownloadState::idle()
        };
        let encoded = serde_json::to_string(&state).unwrap();
        for key in [
            "step",
            "step_label",
            "step_index",
            "step_count",
            "step_bytes",
            "step_bytes_total",
            "step_percent",
        ] {
            assert!(encoded.contains(&format!("\"{key}\"")), "champ {key} manquant");
        }
        assert!(encoded.contains("le moteur de lecture"));
    }
}
