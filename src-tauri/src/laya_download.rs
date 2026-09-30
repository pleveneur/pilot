//! Téléchargement du modèle Laya — **lanceur** du téléchargeur autonome
//! (`laya-fetch.mjs`, dossier voisin, déjà prouvé par 13 cas : Pilot ne
//! réimplémente rien, il l'exécute et suit son avancement).
//!
//! Patrons repris tels quels du dépôt :
//! - **sortie en direct** : `terminal.rs` (lecture par un thread dédié, événement
//!   poussé vers l'interface) ;
//! - **attente + code de sortie sans deadlock** : `code_check.rs::run_command_timed`
//!   (stdout/stderr drainés dans des threads parallèles, `try_wait`) ;
//! - **progression d'une longue tâche** : `context_engine.rs` / `code_graph.rs`
//!   (`app.emit(...)`), écoutée côté JS par `settings.js` ;
//! - **trace et arrêt d'un processus enfant** : `plface::{write_pid_file,
//!   read_pid_file, kill_process, clear_pid_file}` (déjà utilisés par `laya.rs`).
//!
//! La progression **ne demande aucun ajout dans `laya-fetch.mjs`** : le
//! téléchargeur écrit déjà chaque fichier dans `<nom>.part` (c'est son fichier de
//! reprise). Pilot lit la taille des `.part` toutes les 400 ms et la compare aux
//! tailles du manifeste.
//!
//! Garde unique : deux téléchargements simultanés sont impossibles
//! (`DOWNLOADING`, un seul état partagé). Interrompre **ne supprime jamais les
//! `.part`** : le prochain essai reprend où il s'était arrêté.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::laya_model::{self, FetchReason, ManifestFile};

/// Trace du téléchargeur lancé par Pilot (dossier de données de l'application).
pub(crate) const FETCH_PID_FILE_NAME: &str = "laya-fetch.pid";
/// Nombre maximal de lignes de journal conservées (borné, jamais une fuite).
const LOG_TAIL_MAX: usize = 400;
/// Intervalle d'émission de la progression.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(400);

/// Garde unique : vrai pendant un téléchargement.
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
/// Demande d'interruption (une annulation distingue un échec d'un arrêt voulu).
static CANCELLED: AtomicBool = AtomicBool::new(false);
/// Dernier état connu de la progression (lu par `laya_model_state`).
static STATE: Mutex<Option<SharedState>> = Mutex::new(None);

#[derive(Debug, Clone, Default)]
struct SharedState {
    running: bool,
    current: Option<String>,
    done: usize,
    total: usize,
    bytes: u64,
    bytes_total: u64,
    percent: Option<u32>,
    reason: Option<FetchReason>,
    progress_events: u64,
    log: Vec<String>,
}

/// Issue d'une demande de lancement de téléchargement (renvoyée à l'interface).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DownloadStart {
    Started,
    AlreadyRunning,
}

/// État d'un fichier du modèle, tel que rendu à l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelFileState {
    pub name: String,
    pub size: u64,
    pub ok: bool,
}

/// État du modèle, tel que rendu à l'interface (commande `laya_model_state`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelState {
    /// Dossier effectif (absolu dès que le service est configuré).
    pub dir: String,
    /// Les fichiers du modèle sont-ils tous présents et à la bonne taille ?
    pub present: bool,
    pub files: Vec<ModelFileState>,
    pub downloading: bool,
    pub percent: Option<u32>,
    /// Raison du dernier téléchargement non réussi (`null` si le modèle est prêt).
    pub reason: Option<FetchReason>,
}

/// Vrai si un téléchargement est en cours (garde unique).
pub(crate) fn is_downloading() -> bool {
    DOWNLOADING.load(Ordering::SeqCst)
}

fn set_state<F: FnOnce(&mut SharedState)>(update: F) {
    if let Ok(mut slot) = STATE.lock() {
        let state = slot.get_or_insert_with(SharedState::default);
        update(state);
    }
}

/// Les fichiers du modèle sont-ils tous présents et à la bonne taille ? Un
/// `.part` n'est **jamais** traité comme un fichier final valide.
pub(crate) fn model_dir_has_all(dir: &Path, files: &[ManifestFile]) -> bool {
    if files.is_empty() {
        return false;
    }
    files.iter().all(|f| {
        std::fs::metadata(dir.join(&f.name))
            .map(|m| m.is_file() && f.size.map_or(true, |expected| m.len() == expected))
            .unwrap_or(false)
    })
}

fn measure(dir: &Path, files: &[ManifestFile]) -> (u64, usize, Option<u32>) {
    let mut bytes: u64 = 0;
    let mut done = 0usize;
    for f in files {
        let final_size = std::fs::metadata(dir.join(&f.name))
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.len());
        let complete = final_size.map_or(false, |size| f.size.map_or(true, |exp| exp == size));
        if complete {
            done += 1;
            bytes += final_size.unwrap_or(0);
        } else {
            let part = dir.join(format!("{}.part", f.name));
            bytes += std::fs::metadata(&part)
                .ok()
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .unwrap_or(0);
        }
    }
    let total: u64 = files.iter().filter_map(|f| f.size).sum();
    (bytes, done, laya_model::percent(bytes, total))
}

fn publish_progress(app: Option<&AppHandle>, dir: &Path, files: &[ManifestFile]) {
    let (bytes, done, percent) = measure(dir, files);
    let bytes_total: u64 = files.iter().filter_map(|f| f.size).sum();
    let current = files
        .iter()
        .find(|f| {
            !std::fs::metadata(dir.join(&f.name))
                .map(|m| m.is_file())
                .unwrap_or(false)
        })
        .map(|f| f.name.clone());
    set_state(|st| {
        st.running = true;
        st.current = current.clone();
        st.done = done;
        st.total = files.len();
        st.bytes = bytes;
        st.bytes_total = bytes_total;
        st.percent = percent;
        st.progress_events += 1;
    });
    if let Some(app) = app {
        let _ = app.emit(
            "laya-download-progress",
            serde_json::json!({
                "file": current,
                "done": done,
                "total": files.len(),
                "bytes": bytes,
                "bytesTotal": bytes_total,
                "percent": percent,
            }),
        );
    }
}

fn read_stream<R: std::io::Read + Send + 'static>(reader: Option<R>, app: Option<AppHandle>) {
    let Some(reader) = reader else { return };
    for line in BufReader::new(reader).lines().map_while(Result::ok) {
        let line = line.trim_end().to_string();
        if line.is_empty() {
            continue;
        }
        set_state(|st| {
            if st.log.len() >= LOG_TAIL_MAX {
                st.log.remove(0);
            }
            st.log.push(line.clone());
        });
        if let Some(app) = app.as_ref() {
            let _ = app.emit("laya-download-log", serde_json::json!({ "line": line }));
        }
    }
}

fn acquire() -> bool {
    DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

fn release() {
    DOWNLOADING.store(false, Ordering::SeqCst);
}

fn begin(files: &[ManifestFile]) {
    set_state(|st| {
        *st = SharedState {
            running: true,
            total: files.len(),
            bytes_total: files.iter().filter_map(|f| f.size).sum(),
            ..SharedState::default()
        };
    });
}

fn finish(reason: FetchReason) {
    set_state(|st| {
        st.running = false;
        st.current = None;
        st.reason = Some(reason);
    });
}

/// Cœur non pur : vérifie le TÉLÉCHARGEUR puis l'adresse, lance
/// `<interpréteur> <laya-fetch.mjs> <manifeste> <dossier> [--base <adresse>]`,
/// draine la sortie, publie la progression, attend la fin et traduit le code de
/// sortie.
///
/// Ordre voulu : l'absence du TÉLÉCHARGEUR est vérifiée EN PREMIER. Sans lui,
/// rien n'est possible, et c'est la cause réelle — pas l'absence d'adresse, qui
/// n'est alors qu'une conséquence. (Un paquet livré sans le service Laya n'a ni
/// l'un ni l'autre : annoncer « adresse manquante » ferait chercher une cause
/// qui n'existe pas.)
///
/// `node` : interpréteur effectif (`None` = `node` du système). La même règle de
/// priorité que le service (réglé à la main → embarqué → système) est appliquée
/// par l'appelant : une version livrée sans Node.js installé télécharge donc son
/// modèle quand même ; un service externe garde son comportement d'avant.
fn run(
    app: Option<&AppHandle>,
    fetch: &Path,
    manifest: &Path,
    model_dir: &Path,
    base_url: &str,
    node: Option<&str>,
    pid_path: Option<&Path>,
) -> FetchReason {
    let meta = laya_model::read_manifest(manifest);
    begin(&meta.files);

    // 1. Téléchargeur : sans lui, rien ne peut démarrer — cause RÉELLE.
    if !fetch.is_file() {
        return FetchReason::FetchMissing;
    }
    // 2. Adresse : le réglage explicite gagne, sinon celle du manifeste. Tant
    // qu'aucune adresse n'est renseignée, on ne lance RIEN et l'état est clair
    // (« adresse non renseignée »), jamais un plantage.
    let effective = laya_model::effective_base_url(base_url, meta.base_url.as_deref());
    if laya_model::is_placeholder_base(&effective) {
        return FetchReason::AddressMissing;
    }

    let node_exe = node
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| crate::laya::node_exe_name().to_string());
    let mut cmd = Command::new(&node_exe);
    cmd.arg(fetch).arg(manifest).arg(model_dir);
    if !base_url.trim().is_empty() {
        cmd.arg("--base").arg(base_url.trim());
    }
    if let Some(dir) = fetch.parent() {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(_) => return FetchReason::NodeMissing,
    };
    if let Some(path) = pid_path {
        crate::plface::write_pid_file(
            path,
            child.id(),
            &crate::laya::process_name_for(Some(&node_exe)),
        );
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_app = app.cloned();
    let err_app = app.cloned();
    let out_thread = std::thread::spawn(move || read_stream(stdout, out_app));
    let err_thread = std::thread::spawn(move || read_stream(stderr, err_app));

    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                publish_progress(app, model_dir, &meta.files);
                std::thread::sleep(PROGRESS_INTERVAL);
            }
            Err(_) => break,
        }
    }
    let code = child.wait().ok().and_then(|status| status.code());
    let _ = out_thread.join();
    let _ = err_thread.join();
    publish_progress(app, model_dir, &meta.files);

    if let Some(path) = pid_path {
        crate::plface::clear_pid_file(path);
    }

    if CANCELLED.load(Ordering::SeqCst) {
        return FetchReason::Cancelled;
    }
    match code {
        Some(code) => laya_model::fetch_exit_reason(code),
        None => FetchReason::Unknown,
    }
}

/// Télécharge **en bloquant l'appelant** (thread de démarrage de Pilot) et rend
/// la raison. `AlreadyRunning` si un autre téléchargement est déjà en cours.
pub(crate) fn download_blocking(
    app: Option<&AppHandle>,
    fetch: &Path,
    manifest: &Path,
    model_dir: &Path,
    base_url: &str,
    node: Option<&str>,
    pid_path: Option<&Path>,
) -> FetchReason {
    if !acquire() {
        return FetchReason::AlreadyRunning;
    }
    CANCELLED.store(false, Ordering::SeqCst);
    let reason = run(app, fetch, manifest, model_dir, base_url, node, pid_path);
    finish(reason);
    release();
    reason
}

/// Lance le téléchargement en tâche de fond (bouton « Télécharger maintenant ») :
/// l'interface n'attend jamais. `AlreadyRunning` si un autre est déjà en cours.
#[allow(clippy::too_many_arguments)]
pub(crate) fn start_background(
    app: AppHandle,
    fetch: PathBuf,
    manifest: PathBuf,
    model_dir: PathBuf,
    base_url: String,
    node: Option<String>,
    pid_path: Option<PathBuf>,
) -> DownloadStart {
    if !acquire() {
        return DownloadStart::AlreadyRunning;
    }
    CANCELLED.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let reason = run(
            Some(&app),
            &fetch,
            &manifest,
            &model_dir,
            &base_url,
            node.as_deref(),
            pid_path.as_deref(),
        );
        finish(reason);
        release();
    });
    DownloadStart::Started
}

/// Interrompt le téléchargement en cours : arrête **le seul** processus tracé
/// (`laya-fetch.pid`) et **conserve les `.part`** (le prochain essai reprend).
/// Renvoie `false` si aucun téléchargement n'était en cours.
pub(crate) fn cancel(pid_path: &Path) -> bool {
    if !is_downloading() {
        return false;
    }
    CANCELLED.store(true, Ordering::SeqCst);
    let stopped = match crate::plface::read_pid_file(pid_path) {
        Some((pid, name)) => crate::plface::kill_process(pid, &name),
        None => true,
    };
    crate::plface::clear_pid_file(pid_path);
    stopped
}

/// Compose l'état du modèle (lecture seule) : présence des fichiers, avancement
/// du téléchargement en cours, raison du dernier échec. Aucune écriture.
pub(crate) fn model_state(dir: &Path, files: &[ManifestFile]) -> ModelState {
    let mut states = Vec::with_capacity(files.len());
    for f in files {
        let meta = std::fs::metadata(dir.join(&f.name))
            .ok()
            .filter(|m| m.is_file());
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let ok = meta.map_or(false, |m| f.size.map_or(true, |exp| exp == m.len()));
        states.push(ModelFileState {
            name: f.name.clone(),
            size,
            ok,
        });
    }
    let present = !states.is_empty() && states.iter().all(|s| s.ok);
    let running = STATE
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|st| (st.running, st.percent, st.reason)))
        .unwrap_or((false, None, None));
    ModelState {
        dir: dir.to_string_lossy().to_string(),
        present,
        files: states,
        downloading: running.0,
        percent: if running.0 { running.1 } else { None },
        reason: if present { None } else { running.2 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node_available() -> bool {
        Command::new("node")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pilot-laya-download-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&root).expect("dossier temporaire");
        root
    }

    fn write_fake_fetch(root: &Path, body: &str) -> PathBuf {
        let path = root.join("laya-fetch.mjs");
        std::fs::write(&path, body).expect("faux téléchargeur");
        path
    }

    fn write_manifest(root: &Path, base: &str) -> PathBuf {
        let path = root.join("model-manifest.json");
        let json = format!(
            r#"{{"baseUrl":"{base}","files":[{{"name":"encoder.onnx","size":1024,"sha256":null}}]}}"#
        );
        std::fs::write(&path, json).expect("manifeste de test");
        path
    }

    /// Faux téléchargeur : écrit le `.part`, deux lignes de journal, patiente,
    /// renomme en fichier final, sortie 0. Aucun octet réel, aucun réseau.
    const FAKE_OK: &str = r#"import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[3];
mkdirSync(dir, { recursive: true });
const part = join(dir, "encoder.onnx.part");
writeFileSync(part, Buffer.alloc(1024, 7));
console.log("Source      : faux");
console.log("Fichiers    : 1 au total, 1 à télécharger");
await new Promise((r) => setTimeout(r, 1200));
renameSync(part, join(dir, "encoder.onnx"));
console.log("  ok   encoder.onnx");
process.exitCode = 0;
"#;

    /// Faux téléchargeur : échec d'intégrité (code 4), pas de fichier final.
    const FAKE_INTEGRITY: &str = r#"import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[3];
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "encoder.onnx.part"), "incomplet");
console.error("ECHEC (code de sortie 4) - controle d'integrite echoue");
process.exitCode = 4;
"#;

    /// Faux téléchargeur : lent (laisse le temps d'observer puis d'interrompre).
    const FAKE_SLOW: &str = r#"import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[3];
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "encoder.onnx.part"), "morceau");
console.log("telechargement lent");
await new Promise((r) => setTimeout(r, 5000));
"#;

    /// Chaîne RÉELLE sans réseau et sans le vrai modèle : faux téléchargeur,
    /// fichiers factices, dossier temporaire. Sauté si `node` est absent.
    #[test]
    fn real_download_orchestration_without_network_or_real_model() {
        if !node_available() {
            eprintln!("SAUTÉ : `node` absent de la machine");
            return;
        }
        let base = "https://exemple.invalid/ml";

        // --- 1. Succès : fichier final présent, progression émise, trace effacée.
        {
            let root = temp_root("ok");
            let fetch = write_fake_fetch(&root, FAKE_OK);
            let manifest = write_manifest(&root, "https://exemple.invalid/ml");
            let model_dir = root.join("model-ml");
            let pid = root.join(FETCH_PID_FILE_NAME);
            let meta = laya_model::read_manifest(&manifest);
            let reason = download_blocking(None, &fetch, &manifest, &model_dir, base, None, Some(&pid));
            assert_eq!(reason, FetchReason::Ok, "sortie 0 attendue");
            assert!(model_dir_has_all(&model_dir, &meta.files), "fichier final présent");
            assert!(progress_events() >= 1, "au moins un point de progression");
            assert_eq!(crate::plface::read_pid_file(&pid), None, "trace effacée en fin de course");
            assert!(!is_downloading());
            let state = model_state(&model_dir, &meta.files);
            assert!(state.present && state.reason.is_none(), "{state:?}");
            let _ = std::fs::remove_dir_all(&root);
        }

        // --- 2. Échec d'intégrité (code 4) : aucun fichier final.
        {
            let root = temp_root("ko4");
            let fetch = write_fake_fetch(&root, FAKE_INTEGRITY);
            let manifest = write_manifest(&root, "https://exemple.invalid/ml");
            let model_dir = root.join("model-ml");
            let reason = download_blocking(None, &fetch, &manifest, &model_dir, base, None, None);
            assert_eq!(reason, FetchReason::IntegrityFailed);
            assert!(!model_dir.join("encoder.onnx").exists(), "aucun fichier final");
            let meta = laya_model::read_manifest(&manifest);
            assert!(!model_dir_has_all(&model_dir, &meta.files));
            let _ = std::fs::remove_dir_all(&root);
        }

        // --- 3. Annulation : le `.part` est CONSERVÉ (preuve de reprise possible).
        {
            let root = temp_root("cancel");
            let fetch = write_fake_fetch(&root, FAKE_SLOW);
            let manifest = write_manifest(&root, "https://exemple.invalid/ml");
            let model_dir = root.join("model-ml");
            let pid = root.join(FETCH_PID_FILE_NAME);
            let (f, m, d, p) = (fetch.clone(), manifest.clone(), model_dir.clone(), pid.clone());
            let handle =
                std::thread::spawn(move || download_blocking(None, &f, &m, &d, base, None, Some(&p)));
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            loop {
                if crate::plface::read_pid_file(&pid).is_some()
                    && model_dir.join("encoder.onnx.part").exists()
                {
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    panic!("le faux téléchargeur n'a jamais démarré");
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            assert!(cancel(&pid), "annulation acceptée");
            let reason = handle.join().expect("thread de téléchargement");
            assert_eq!(reason, FetchReason::Cancelled);
            assert!(
                model_dir.join("encoder.onnx.part").exists(),
                "le .part doit rester pour la reprise"
            );
            assert!(!model_dir.join("encoder.onnx").exists());
            let _ = std::fs::remove_dir_all(&root);
        }

        // --- 4. Deux lancements simultanés : un seul processus, jamais deux.
        {
            let root = temp_root("single");
            let fetch = write_fake_fetch(&root, FAKE_SLOW);
            let manifest = write_manifest(&root, "https://exemple.invalid/ml");
            let model_dir = root.join("model-ml");
            let pid = root.join(FETCH_PID_FILE_NAME);
            let (f, m, d, p) = (fetch.clone(), manifest.clone(), model_dir.clone(), pid.clone());
            let handle =
                std::thread::spawn(move || download_blocking(None, &f, &m, &d, base, None, Some(&p)));
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            while !is_downloading() {
                if std::time::Instant::now() >= deadline {
                    panic!("le premier téléchargement n'a jamais démarré");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let second = download_blocking(None, &fetch, &manifest, &model_dir, base, None, None);
            assert_eq!(second, FetchReason::AlreadyRunning, "jamais deux à la fois");
            let _ = cancel(&pid);
            let _ = handle.join();
            let _ = std::fs::remove_dir_all(&root);
        }

        // --- 5. Adresse non renseignée : rien n'est lancé, état clair.
        {
            let root = temp_root("nobase");
            let fetch = write_fake_fetch(&root, FAKE_OK);
            let manifest = write_manifest(&root, "A_CHOISIR");
            let reason =
                download_blocking(None, &fetch, &manifest, &root.join("model-ml"), "", None, None);
            assert_eq!(reason, FetchReason::AddressMissing);
            assert!(!root.join("model-ml").exists(), "aucun dossier créé sans adresse");
            let _ = std::fs::remove_dir_all(&root);
        }

        // --- 6. Téléchargeur absent + adresse vide : la cause RÉELLE est le
        // téléchargeur (paquet sans Laya), jamais « adresse manquante ».
        {
            let root = temp_root("nofetch");
            let fetch = root.join("laya-fetch.mjs"); // volontairement absent
            let manifest = write_manifest(&root, "A_CHOISIR");
            let reason =
                download_blocking(None, &fetch, &manifest, &root.join("model-ml"), "", None, None);
            assert_eq!(reason, FetchReason::FetchMissing);
            let _ = std::fs::remove_dir_all(&root);
        }
    }

    #[test]
    fn model_state_reports_missing_files_without_final_file() {
        let root = temp_root("state");
        let dir = root.join("model-ml");
        std::fs::create_dir_all(&dir).expect("dossier");
        let files = vec![ManifestFile {
            name: "encoder.onnx".to_string(),
            size: Some(1024),
            sha256: None,
        }];
        // Un `.part` n'est JAMAIS un fichier final valide.
        std::fs::write(dir.join("encoder.onnx.part"), vec![0u8; 1024]).expect("part");
        let state = model_state(&dir, &files);
        assert!(!state.present);
        assert!(!state.files[0].ok);
        assert_eq!(state.files[0].size, 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(test)]
    fn progress_events() -> u64 {
        STATE
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|st| st.progress_events))
            .unwrap_or(0)
    }
}
