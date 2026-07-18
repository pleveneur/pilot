use notify::{Config, EventKind, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use pulldown_cmark::Parser;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

mod help;
mod rpc_manager;
mod tailscale;
mod web_auth;
mod web_audit;
mod web_rate;
mod web_server;

// ── État global de l'application ──

struct TerminalState {
    running: Arc<AtomicBool>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Option<Box<dyn std::io::Write + Send>>,
}

struct AppState {
    project_path: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
    watch_state: Mutex<Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>>,
    terminals: Mutex<HashMap<String, TerminalState>>,
    rpc_state: Mutex<Option<rpc_manager::RpcSession>>,
    /// Canal de fan-out des événements RPC vers les WebSockets distants (décision 13.3).
    event_tx: tokio::sync::broadcast::Sender<Value>,
    /// Authentification distante partagée (sessions en mémoire). Permet au desktop
    /// (kick remote, badge) et au serveur web de partager la même map de sessions.
    auth: Arc<web_auth::WebAuth>,
    /// Garde-fous distants (rate limiting login/prompt, nombre max de WS par token).
    /// Partagé entre le desktop (kick remote) et le serveur web ; survit aux reload.
    guard: Arc<web_rate::WebGuard>,
    /// Journal d'audit distant (actions sensibles web) — ring buffer en mémoire.
    audit: Arc<web_audit::WebAudit>,
    /// Signal d'arrêt du serveur web distant : `Some(sender)` tant qu'un serveur tourne.
    /// Permet le rechargement à chaud (panneau Paramètres) sans relancer l'app.
    web_shutdown: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    theme: String,
    default_command: String,
    #[serde(default)]
    recent_projects: Vec<String>,
    // Conservé pour rétrocompatibilité (migration auto)
    #[serde(default)]
    last_project: Option<String>,
    auto_load_last_project: bool,
    auto_run_command: bool,
    integrated_terminal: bool,
    rpc_agent_enabled: bool,
    #[serde(default)]
    rpc_pi_path: String,
    #[serde(default)]
    rpc_no_session: bool,
    #[serde(default)]
    rpc_session_dir: String,
    // Quality-gate interne (Évolution 7) : skill embarqué par Pilot, activable
    // depuis l'onglet agent. Persistance + rechargement au démarrage de Pilot.
    #[serde(default)]
    quality_gate_enabled: bool,
    #[serde(default = "default_true")]
    show_thinking: bool,
    #[serde(default)]
    show_tools: bool,
    #[serde(default)]
    pdf_md_model: String,
    #[serde(default = "default_sidebar_width")]
    sidebar_width: u32,
    #[serde(default)]
    auto_save: bool,
    #[serde(default = "default_auto_save_delay")]
    auto_save_delay: u32,
    #[serde(default)]
    favorites: Vec<String>,
    #[serde(default)]
    word_wrap: bool,
    // Mode Orchestration
    #[serde(default)]
    orchestration_enabled: bool,
    #[serde(default)]
    orchestrator_provider: String,
    #[serde(default)]
    orchestrator_model_id: String,
    #[serde(default)]
    coder_provider: String,
    #[serde(default)]
    coder_model_id: String,
    #[serde(default = "default_orchestration_idle_timeout")]
    orchestration_idle_timeout_ms: u32,
    #[serde(default = "default_orchestration_revision_interval")]
    orchestration_revision_interval: u32,
    // Granularité des tâches (fine, medium, large)
    #[serde(default = "default_orchestration_granularity")]
    orchestration_granularity: String,
    // Taille du batch (0 = désactivé, 3, 5, 10)
    #[serde(default)]
    orchestration_batch_size: u32,
    // Confirmer chaque bascule de modèle (plus lent mais plus sûr)
    #[serde(default)]
    orchestration_confirm_model_switch: bool,
    // Fenêtre de contexte du codeur en tokens (0 = auto/désactivé)
    #[serde(default)]
    coder_context_window: u32,
    // ── Mode remote (serveur web distant) ──
    #[serde(default)]
    web_enabled: bool,
    #[serde(default = "default_web_port")]
    web_port: u32,
    #[serde(default = "default_web_bind")]
    web_bind: String,
    #[serde(default)]
    web_password_hash: String,
    #[serde(default = "default_web_token_ttl")]
    web_token_ttl_hours: u32,
    #[serde(default)]
    web_readonly: bool,
    #[serde(default)]
    web_browse_roots: Vec<String>,
    #[serde(default)]
    web_keep_alive: bool,
    // Automatisation Tailscale Serve (spec_web_remote.md §14) : si activé, Pilot
    // configure automatiquement Tailscale Serve (HTTPS 443 → 127.0.0.1:web_port)
    // et resync au changement de port. Opt-in, exige web_bind == 127.0.0.1.
    #[serde(default)]
    web_tailscale_serve: bool,
    // Modèle utilisé par l'onglet « ❓ Aide » (spec_help.md). Format "provider/modelId"
    // (issu de get_available_models_list). Vide = aucun modèle (l'aide refusera
    // de répondre tant qu'un modèle n'est pas sélectionné dans l'UI d'aide).
    #[serde(default)]
    help_model: String,
}

fn default_true() -> bool { true }
fn default_sidebar_width() -> u32 { 280 }
fn default_auto_save_delay() -> u32 { 3000 }
fn default_orchestration_idle_timeout() -> u32 { 120000 }
fn default_orchestration_revision_interval() -> u32 { 5 }
fn default_orchestration_granularity() -> String { "fine".to_string() }
fn default_coder_context_window() -> u32 { 0 }
fn default_web_port() -> u32 { 8787 }
fn default_web_bind() -> String { "127.0.0.1".to_string() }
fn default_web_token_ttl() -> u32 { 168 }

impl AppConfig {
    /// Migre l'ancien format last_project vers recent_projects
    fn migrate(&mut self) {
        if let Some(ref lp) = self.last_project {
            if !self.recent_projects.contains(lp) {
                self.recent_projects.insert(0, lp.clone());
            }
            self.last_project = None;
        }
        // Limite à 10
        self.recent_projects.truncate(10);
    }

    /// Ajoute un projet dans les récents (en tête, dédoublonné, max 10)
    fn add_recent(&mut self, path: &str) {
        self.recent_projects.retain(|p| p != path);
        self.recent_projects.insert(0, path.to_string());
        self.recent_projects.truncate(10);
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            default_command: String::new(),
            recent_projects: Vec::new(),
            last_project: None,
            auto_load_last_project: false,
            auto_run_command: false,
            integrated_terminal: false,
            rpc_agent_enabled: false,
            rpc_pi_path: String::new(),
            rpc_no_session: false,
            rpc_session_dir: String::new(),
            quality_gate_enabled: false,
            show_thinking: true,
            show_tools: false,
            pdf_md_model: String::new(),
            sidebar_width: 280,
            auto_save: false,
            auto_save_delay: 3000,
            favorites: Vec::new(),
            word_wrap: false,
            orchestration_enabled: false,
            orchestrator_provider: String::new(),
            orchestrator_model_id: String::new(),
            coder_provider: String::new(),
            coder_model_id: String::new(),
            orchestration_idle_timeout_ms: default_orchestration_idle_timeout(),
            orchestration_revision_interval: default_orchestration_revision_interval(),
            orchestration_granularity: default_orchestration_granularity(),
            orchestration_batch_size: 0,
            orchestration_confirm_model_switch: false,
            coder_context_window: default_coder_context_window(),
            web_enabled: false,
            web_port: default_web_port(),
            web_bind: default_web_bind(),
            web_password_hash: String::new(),
            web_token_ttl_hours: default_web_token_ttl(),
            web_readonly: false,
            web_browse_roots: Vec::new(),
            web_keep_alive: false,
            web_tailscale_serve: false,
            help_model: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileNode>,
}

// ── Persistance configuration ──

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin config: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier config: {}", e))?;
    Ok(dir.join("config.json"))
}

fn load_config_disk(app: &AppHandle) -> AppConfig {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    match fs::read_to_string(&path) {
        Ok(content) => {
            let mut cfg: AppConfig = serde_json::from_str(&content).unwrap_or_default();
            cfg.migrate();
            cfg
        }
        Err(_) => AppConfig::default(),
    }
}

fn save_config_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("Erreur sérialisation: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Erreur écriture config: {}", e))
}

// ── Construction de l'arborescence ──

pub(crate) fn build_tree(path: &std::path::Path) -> Result<FileNode, String> {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let is_dir = path.is_dir();
    let mut children = Vec::new();

    if is_dir {
        let entries = fs::read_dir(path).map_err(|e| format!("Erreur lecture dossier: {}", e))?;
        let mut dirs = Vec::new();
        let mut files = Vec::new();

        for entry in entries {
            let entry = entry.map_err(|e| format!("Erreur entrée: {}", e))?;
            let child_path = entry.path();
            if child_path.is_dir() {
                dirs.push(child_path);
            } else {
                files.push(child_path);
            }
        }

        // Tri : dossiers d'abord, puis fichiers, par ordre alphabétique
        dirs.sort_by_key(|p| {
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
        });
        files.sort_by_key(|p| {
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
        });

        for child_path in dirs.into_iter().chain(files) {
            children.push(build_tree(&child_path)?);
        }
    }

    Ok(FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        children,
    })
}

// ── File Watcher ──

fn start_watching(app: &AppHandle, path: &str, state: &State<AppState>) -> Result<(), String> {
    let app = app.clone();
    let path_buf = PathBuf::from(path);
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    let (tx, rx) = std::sync::mpsc::channel();

    // PollWatcher : ne pose pas de verrous OS sur les dossiers → pas de conflit avec rename
    let poll_config = Config::default()
        .with_poll_interval(std::time::Duration::from_secs(2));

    let mut watcher = notify::PollWatcher::new(
        move |res| {
            if let Ok(event) = res {
                tx.send(event).ok();
            }
        },
        poll_config,
    )
    .map_err(|e| format!("Erreur création watcher: {}", e))?;

    watcher
        .watch(&path_buf, RecursiveMode::Recursive)
        .map_err(|e| format!("Erreur surveillance: {}", e))?;

    let handle = std::thread::spawn(move || {
        // Buffer pour regrouper les événements (debounce ~500ms)
        let mut pending: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let debounce = std::time::Duration::from_millis(500);
        let mut last_flush = std::time::Instant::now();

        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(event) => {
                    if !running_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    let kind = match event.kind {
                        EventKind::Create(_) => "create",
                        EventKind::Modify(_) => "modify",
                        EventKind::Remove(_) => "remove",
                        _ => continue,
                    };
                    // Priorité : remove > create > modify (pour le même fichier)
                    for p in event.paths {
                        let key = p.to_string_lossy().to_string();
                        let existing = pending.get(&key);
                        let new_kind = match (existing.map(|s| s.as_str()), kind) {
                            // Si on reçoit remove après create → supprimer
                            (Some("create"), "remove") => "remove",
                            // Garder la première valeur sinon
                            (Some(_), _) => continue,
                            _ => kind,
                        };
                        pending.insert(key, new_kind.to_string());
                    }

                    // Flusher si le debounce est écoulé
                    if last_flush.elapsed() >= debounce {
                        flush_pending(&app, &pending);
                        pending.clear();
                        last_flush = std::time::Instant::now();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !running_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    // Flusher les événements en attente après le timeout
                    if !pending.is_empty() && last_flush.elapsed() >= debounce {
                        flush_pending(&app, &pending);
                        pending.clear();
                        last_flush = std::time::Instant::now();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        // Flusher ce qui reste avant de quitter
        if !pending.is_empty() {
            flush_pending(&app, &pending);
        }
        drop(watcher);
    });

    *state.watch_state.lock().unwrap() = Some((running, handle));
    Ok(())
}

/// Émet les événements en attente vers le frontend
fn flush_pending(app: &AppHandle, pending: &std::collections::HashMap<String, String>) {
    for (path, kind) in pending {
        let payload = serde_json::json!({
            "path": path,
            "kind": kind,
        });
        app.emit("file-change", &payload).ok();
    }
}

fn stop_watcher(state: &State<AppState>) {
    let mut watch = state.watch_state.lock().unwrap();
    if let Some((running, handle)) = watch.take() {
        running.store(false, Ordering::Relaxed);
        drop(watch); // libérer le lock avant de join
        handle.join().ok();
    }
}

// ── Commandes Tauri ──

/// Cycle de changement de projet partagé (desktop + web).
/// (1) stoppe le watcher, (2) met à jour project_path + recent_projects,
/// (3) relance le watcher sur le nouveau dossier, (4) émet `project_changed`.
/// NB : le redémarrage de `pi --mode rpc` sur le nouveau cwd n'est PAS géré ici —
/// il revient au frontend desktop (qui écoute `project_changed`) et au web (qui
/// s'appuie sur l'instance partagée). Voir spec_web_remote.md §14 (reste à faire).
/// Retourne l'arborescence du nouveau projet.
pub(crate) fn open_project_shared(app: &AppHandle, path: &str) -> Result<FileNode, String> {
    let state = app.state::<AppState>();
    let folder = PathBuf::from(path);

    // Arrêter l'ancien watcher proprement
    stop_watcher(&state);

    // Démarrer le nouveau watcher
    start_watching(app, path, &state)?;

    // Stocker le chemin du projet (section critique courte)
    *state.project_path.lock().unwrap() = Some(path.to_string());

    // Persister dans les projets récents (section critique courte)
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent(path);
        save_config_disk(app, &config)?;
    }

    // Émettre l'événement project_changed (pour cohérence bidirectionnelle)
    let payload = serde_json::json!({ "path": path });
    app.emit("project_changed", &payload).ok();

    // build_tree est l'opération longue → on la fait HORS des locks
    build_tree(&folder)
}

#[tauri::command]
fn open_project_path(app: AppHandle, path: String) -> Result<FileNode, String> {
    open_project_shared(&app, &path)
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

#[derive(serde::Serialize)]
struct FileInfo {
    encoding: String,
    eol: String,
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Détection de l'encodage (BOM)
    let encoding = if bytes.starts_with(b"\xef\xbb\xbf") {
        "UTF-8 BOM"
    } else if bytes.starts_with(b"\xff\xfe") {
        "UTF-16 LE"
    } else if bytes.starts_with(b"\xfe\xff") {
        "UTF-16 BE"
    } else {
        "UTF-8"
    };

    // Détection de la fin de ligne
    let mut crlf_count = 0usize;
    let mut lf_count = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                crlf_count += 1;
                i += 2;
                continue;
            }
        } else if bytes[i] == b'\n' {
            lf_count += 1;
        }
        i += 1;
    }

    let eol = if crlf_count == 0 && lf_count == 0 {
        "—" // Fichier binaire ou vide
    } else if crlf_count > lf_count {
        "CRLF"
    } else if lf_count > 0 {
        "LF"
    } else {
        "—"
    };

    Ok(FileInfo { encoding: encoding.to_string(), eol: eol.to_string() })
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Erreur écriture: {}", e))
}

#[tauri::command]
fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| format!("Erreur écriture: {}", e))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Renvoie la date de dernière modification d'un fichier (mtime) en millisecondes
/// depuis l'epoch UNIX. Utilisé par le Mode Orchestration pour détecter qu'un
/// fichier a été créé/modifié par le codeur après une tâche.
#[tauri::command]
fn file_mtime(path: String) -> Result<f64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Erreur metadata: {}", e))?;
    let mtime = meta.modified().map_err(|e| format!("Erreur mtime: {}", e))?;
    let dur = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Erreur epoch: {}", e))?;
    Ok(dur.as_secs_f64() * 1000.0)
}

#[tauri::command]
fn open_terminal(state: State<AppState>, run_default: bool) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let project_path = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    let config = state.config.lock().unwrap();
    let command = if run_default && !config.default_command.is_empty() {
        Some(config.default_command.clone())
    } else {
        None
    };

    open_system_terminal(&project_path, command.as_deref())
}

#[cfg(target_os = "windows")]
fn open_system_terminal(path: &str, command: Option<&str>) -> Result<(), String> {
    if let Some(cmd) = command {
        std::process::Command::new("cmd.exe")
            .args(["/c", "start", "cmd.exe", "/k", cmd])
            .current_dir(path)
            .spawn()
            .map_err(|e| format!("Erreur terminal: {}", e))?;
    } else {
        std::process::Command::new("cmd.exe")
            .args(["/c", "start", "cmd.exe"])
            .current_dir(path)
            .spawn()
            .map_err(|e| format!("Erreur terminal: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_system_terminal(path: &str, command: Option<&str>) -> Result<(), String> {
    if let Some(cmd) = command {
        let safe_path = path.replace('\'', "'\\''");
        let script = format!(
            "tell application \"Terminal\"\n  activate\n  do script \"cd '{}' && {}\"\nend tell",
            safe_path, cmd
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Erreur terminal: {}", e))?;
    } else {
        std::process::Command::new("open")
            .args(["-a", "Terminal", path])
            .spawn()
            .map_err(|e| format!("Erreur terminal: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_system_terminal(path: &str, command: Option<&str>) -> Result<(), String> {
    if let Some(cmd) = command {
        std::process::Command::new("sh")
            .args(["-c", &format!("cd '{}' && {}; exec $SHELL", path, cmd)])
            .spawn()
            .map_err(|e| format!("Erreur terminal: {}", e))?;
    } else {
        let terminals: &[(&str, &[&str])] = &[
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
            ("xfce4-terminal", &["--working-directory"]),
            ("x-terminal-emulator", &["--working-directory"]),
        ];
        for (term, args) in terminals {
            let mut cmd = std::process::Command::new(term);
            for arg in *args {
                cmd.arg(arg);
            }
            cmd.arg(path);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err("Aucun terminal trouvé".to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_config(state: State<AppState>, app: AppHandle) -> Result<AppConfig, String> {
    let mut config = state.config.lock().unwrap();
    // Chargement paresseux : si le config est encore le défaut, tenter de charger du disque
    let default = AppConfig::default();
    if config.theme == default.theme
        && config.default_command == default.default_command
        && config.recent_projects.is_empty()
        && config.last_project == default.last_project
        && config.auto_load_last_project == default.auto_load_last_project
        && config.auto_run_command == default.auto_run_command
        && config.integrated_terminal == default.integrated_terminal
        && config.rpc_agent_enabled == default.rpc_agent_enabled
        && config.show_thinking == default.show_thinking
        && config.show_tools == default.show_tools
    && config.pdf_md_model == default.pdf_md_model
    {
        let mut disk = load_config_disk(&app);
        disk.migrate();
        *config = disk;
    }
    Ok(config.clone())
}

#[tauri::command]
fn save_config(
    state: State<AppState>,
    app: AppHandle,
    config: AppConfig,
) -> Result<(), String> {
    // Écrire sur le disque d'abord (opération lente), puis mettre à jour l'état
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn add_favorite(state: State<AppState>, app: AppHandle, path: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    if !config.favorites.contains(&path) {
        config.favorites.push(path);
        save_config_disk(&app, &config)?;
        *state.config.lock().unwrap() = config;
    }
    Ok(())
}

#[tauri::command]
fn remove_favorite(state: State<AppState>, app: AppHandle, path: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    config.favorites.retain(|f| f != &path);
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn set_sidebar_width(
    state: State<AppState>,
    app: AppHandle,
    width: u32,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    config.sidebar_width = width;
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

/// Persiste le modèle sélectionné pour l'onglet « ❓ Aide » (spec_help.md).
/// Format "provider/modelId" (issu de get_available_models_list).
#[tauri::command]
fn set_help_model(
    state: State<AppState>,
    app: AppHandle,
    model: String,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    config.help_model = model;
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
fn refresh_tree(state: State<AppState>) -> Result<FileNode, String> {
    // Copier le chemin hors du lock pour ne pas bloquer pendant build_tree
    let path = {
        let project = state.project_path.lock().unwrap();
        project
            .as_ref()
            .ok_or("Aucun projet ouvert")?
            .clone()
    };
    build_tree(&PathBuf::from(path))
}

#[tauri::command]
fn open_in_browser(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Erreur ouverture navigateur: {}", e))
}

#[tauri::command]
fn open_explorer(state: State<AppState>) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let path = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Erreur explorateur: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Erreur ouverture: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Erreur ouverture: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        return Err(format!("Le dossier '{}' existe déjà.", path));
    }
    fs::create_dir_all(&path).map_err(|e| format!("Erreur création dossier: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_file_or_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Le chemin '{}' n'existe pas.", path));
    }
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Erreur suppression dossier: {}", e))?;
    } else {
        fs::remove_file(&path).map_err(|e| format!("Erreur suppression fichier: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    // Créer le fichier vide (sans écraser s'il existe déjà)
    if std::path::Path::new(&path).exists() {
        return Err(format!("Le fichier '{}' existe déjà.", path));
    }
    // Créer aussi les dossiers parents si nécessaire
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Erreur création dossier parent: {}", e))?;
    }
    fs::File::create(&path).map_err(|e| format!("Erreur création fichier: {}", e))?;
    Ok(())
}

#[tauri::command]
fn set_window_title(app: AppHandle, title: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&title);
    }
}

#[tauri::command]
fn get_recent_projects(state: State<AppState>, app: AppHandle) -> Result<Vec<String>, String> {
    let mut config = state.config.lock().unwrap().clone();
    let before = config.recent_projects.len();
    config.recent_projects.retain(|p| std::path::Path::new(p).exists());
    // Si on a retiré des projets inexistants, sauvegarder la config nettoyée
    if config.recent_projects.len() < before {
        save_config_disk(&app, &config)?;
        *state.config.lock().unwrap() = config.clone();
    }
    Ok(config.recent_projects.clone())
}

#[tauri::command]
fn close_project(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    stop_watcher(&state);
    // Arrêter la session RPC si active
    {
        let mut rpc = state.rpc_state.lock().unwrap();
        if let Some(mut session) = rpc.take() {
            rpc_manager::stop_session(&mut session);
        }
    }
    *state.project_path.lock().unwrap() = None;
    // Réinitialiser le titre de la fenêtre
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title("Pilot");
    }
    Ok(())
}

// ── Copie d'image dans le projet (drag & drop / Ctrl+V) ──

#[tauri::command]
fn copy_image_to_project(
    state: State<AppState>,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    // Copier le chemin du projet hors du lock (section critique courte)
    let project_path = {
        let project = state.project_path.lock().unwrap();
        project
            .as_ref()
            .ok_or("Aucun projet ouvert")?
            .clone()
    };

    // Faire les opérations disque hors du lock
    let images_dir = PathBuf::from(&project_path).join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Erreur création dossier images: {}", e))?;

    let dest_name = unique_image_name(&images_dir, &file_name);
    let dest_path = images_dir.join(&dest_name);

    fs::write(&dest_path, &data)
        .map_err(|e| format!("Erreur écriture image: {}", e))?;

    let relative = format!("images/{}", dest_name);
    Ok(relative)
}

/// Génère un nom de fichier unique basé sur le nom original
fn unique_image_name(dir: &PathBuf, original: &str) -> String {
    let path = std::path::Path::new(original);
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    // Nettoyer le nom : ne garder que alphanumérique, - et _
    let safe_stem: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();

    // Si le stem est vide, utiliser "image"
    let safe_stem = if safe_stem.is_empty() { "image".to_string() } else { safe_stem };

    let ext_dot = if ext.is_empty() { "png".to_string() } else { ext };

    let mut name = format!("{}.{}", safe_stem, ext_dot);
    let mut counter = 1;

    while dir.join(&name).exists() {
        name = format!("{}_{}.{}", safe_stem, counter, ext_dot);
        counter += 1;
    }

    name
}

// ── Point d'entrée ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ── Agent RPC (pi --mode rpc) ──

pub(crate) fn do_start_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let cwd = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    let mut rpc = state.rpc_state.lock().unwrap();
    if rpc.is_some() {
        return Err("Une session agent est déjà active".to_string());
    }

    let (pi_path, no_session, session_dir, qg_enabled) = {
        let config = state.config.lock().unwrap();
        (
            config.rpc_pi_path.clone(),
            config.rpc_no_session,
            config.rpc_session_dir.clone(),
            config.quality_gate_enabled,
        )
    };

    // Construire le répertoire de session avec le sous-dossier projet
    let session_dir_resolved = if session_dir.is_empty() {
        resolve_agent_home(&pi_path)?.join("agent").join("sessions")
            .join(project_to_session_folder(&cwd))
    } else {
        std::path::PathBuf::from(&session_dir)
            .join(project_to_session_folder(&cwd))
    };
    let session_dir_str = session_dir_resolved.to_string_lossy().to_string();

    // Quality-gate interne (Évolution 7) : si activé, écrire le SKILL.md embarqué
    // par Pilot dans le dossier data, puis le passer à pi via --skill.
    let skill_path: Option<String> = if qg_enabled {
        if let Ok(data_dir) = app.path().app_data_dir() {
            let skill_file = data_dir.join("skills").join("quality-gate").join("SKILL.md");
            if fs::create_dir_all(skill_file.parent().unwrap_or(&data_dir)).is_ok() {
                let content: &str = include_str!("../skills/quality-gate/SKILL.md");
                if fs::write(&skill_file, content).is_ok() {
                    Some(skill_file.to_string_lossy().to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, no_session, &session_dir_str, skill_path.as_deref(), app.clone(), state.event_tx.clone(),
    )
        .map_err(|e| {
            if pi_path.is_empty() {
                format!("{}. Installez pi (https://pi.dev) ou configurez le chemin dans les paramètres.", e)
            } else {
                format!("{}. Vérifiez le chemin dans les paramètres (Gestion RPC).", e)
            }
        })?;
    *rpc = Some(session);

    // Démarrer une nouvelle session
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
    }

    Ok(())
}

#[tauri::command]
fn start_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_agent_session(state.inner(), &app)
}

/// Arrête l'agent pi en cours (s'il existe) et libère la session. Idempotent : no-op
/// si aucune session n'est active.
pub(crate) fn do_stop_agent_session(state: &AppState) {
    let mut rpc = state.rpc_state.lock().unwrap();
    if let Some(mut session) = rpc.take() {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
fn stop_agent_session(state: State<AppState>) -> Result<(), String> {
    do_stop_agent_session(state.inner());
    Ok(())
}

#[tauri::command]
fn send_rpc_command(state: State<AppState>, command: Value) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    rpc_manager::send_command(session, &command)
}

pub(crate) fn do_get_agent_state(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync(session, cmd)
}

#[tauri::command]
fn get_agent_state(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_state(state.inner())
}

#[tauri::command]
fn get_session_stats(state: State<AppState>) -> Result<Value, String> {
    do_get_session_stats(state.inner())
}

pub(crate) fn do_get_session_stats(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_session_stats" });
    rpc_manager::send_command_sync(session, cmd)
}

/// Résout le répertoire home du programme RPC (pi, plh, ...) à partir du chemin
/// de l'exécutable configuré. Convention : ~/.<stem> où <stem> est le nom de
/// l'exécutable sans extension (plh.exe → ~/.plh, pi → ~/.pi). Si pi_path est
/// vide, utilise "pi" par défaut. Permet à Pilot de fonctionner avec n'importe
/// quel programme compatible pi en RPC sans chemin en dur.
fn resolve_agent_home(pi_path: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let stem = if pi_path.is_empty() {
        "pi".to_string()
    } else {
        std::path::Path::new(pi_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "pi".to_string())
    };
    Ok(std::path::PathBuf::from(&home).join(format!(".{}", stem)))
}

#[tauri::command]
fn model_supports_images(provider: String, model_id: String, state: State<AppState>) -> Result<bool, String> {
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let models_path = resolve_agent_home(&pi_path)?.join("agent").join("models.json");
    let json_str = std::fs::read_to_string(&models_path)
        .map_err(|e| format!("Lecture models.json: {}", e))?;
    let config: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    if let Some(models) = config["providers"][&provider]["models"].as_array() {
        for m in models {
            if m["id"].as_str() == Some(&model_id) {
                if let Some(input) = m["input"].as_array() {
                    return Ok(input.iter().any(|v| v.as_str() == Some("image")));
                }
                return Ok(false);
            }
        }
    }
    Ok(false)
}

pub(crate) fn do_send_agent_prompt(
    state: &AppState,
    message: String,
    images: Option<Vec<Value>>,
) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let mut cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    if let Some(ref imgs) = images {
        if !imgs.is_empty() {
            cmd["images"] = Value::Array(imgs.clone());
        }
    }
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
fn send_agent_prompt(
    state: State<AppState>,
    message: String,
    images: Option<Vec<Value>>,
) -> Result<(), String> {
    // Notifier les clients distants (WebSocket) du message utilisateur tapé sur
    // le desktop : pi n'émet pas d'event "user message" en streaming, donc sans
    // cela le remote ne verrait pas les prompts desktop dans la conversation (on
    // exclut les commandes slash, non affichées). Le desktop l'affiche déjà
    // localement (appendUserMessage avant l'invoke) et n'écoute pas le canal de
    // broadcast → pas de doublon côté desktop.
    if !message.is_empty() && !message.starts_with('/') {
        let ev = serde_json::json!({ "type": "user_message", "text": message, "source": "desktop" });
        let _ = state.event_tx.send(ev);
    }
    do_send_agent_prompt(state.inner(), message, images)
}

/// Envoie un prompt de complétion inline à l'agent.
/// La réponse sera routée vers le module inline-complete du frontend
/// via le flag global `window._pilotInlineComplete.isRequesting()`.
#[tauri::command]
fn send_inline_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    rpc_manager::send_command(session, &cmd)
}

pub(crate) fn do_abort_agent(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "abort" });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
fn abort_agent(state: State<AppState>) -> Result<(), String> {
    do_abort_agent(state.inner())
}

pub(crate) fn do_new_agent_session(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "new_session" });
    // SYNCHRONE : on attend que pi ait terminé le new_session avant de retourner.
    // new_session réinitialise le modèle au modèle par défaut de pi — si on ne l'attend
    // pas, un set_model suivant peut être appliqué AVANT le reset, puis annulé par le
    // new_session traité tardivement (bascule orchestrateur/codeur perdu).
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
fn new_agent_session(state: State<AppState>) -> Result<(), String> {
    do_new_agent_session(state.inner())
}

pub(crate) fn do_get_agent_messages(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_messages" });
    rpc_manager::send_command_sync(session, cmd)
}

#[tauri::command]
fn get_agent_messages(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_messages(state.inner())
}

pub(crate) fn do_set_agent_model(
    state: &AppState,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "set_model",
        "provider": provider,
        "modelId": model_id
    });
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    // Vérifier le champ success de la réponse pi : un set_model qui échoue
    // (provider/modèle introuvable) répond {success: false, error: "..."}.
    // Sans cette vérification, l'échec passait inaperçu et le modèle restait le
    // modèle par défaut (ex: llama-cpp), ce qui donnait l'illusion d'une bascule
    // réussie alors que les prompts partaient sur le mauvais modèle.
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("set_model a échoué (réponse sans succès)")
            .to_string();
        return Err(format!(
            "pi a refusé set_model(provider='{}', modelId='{}') : {}",
            provider, model_id, err
        ));
    }
    Ok(())
}

#[tauri::command]
fn set_agent_model(
    state: State<AppState>,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    do_set_agent_model(state.inner(), provider, model_id)
}

pub(crate) fn do_list_agent_models(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({"type": "get_available_models"});
    rpc_manager::send_command_sync(session, cmd)
}

#[tauri::command]
fn list_agent_models(state: State<AppState>) -> Result<Value, String> {
    do_list_agent_models(state.inner())
}

#[tauri::command]
fn list_agent_commands(state: State<AppState>) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({"type": "get_commands"});
    rpc_manager::send_command_sync(session, cmd)
}

/// Extrait (host, port) d'une URL http(s)://host[:port]/...
/// Version légère (pas de dépendance `url`) : suffisante pour les baseUrl LLM.
fn parse_host_port(url: &str) -> Result<(String, u16), String> {
    let no_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let authority = no_scheme.split('/').next().unwrap_or("");
    if authority.is_empty() {
        return Err(format!("URL sans hôte : {}", url));
    }
    // Gérer le cas IPv6 [::1]:port
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host = rest[..end].to_string();
            let after = &rest[end + 1..];
            let port = after
                .strip_prefix(':')
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(443);
            return Ok((host, port));
        }
        return Err("IPv6 mal formée".to_string());
    }
    match authority.rsplit_once(':') {
        Some((h, p)) => {
            let port = p.parse::<u16>().unwrap_or(80);
            Ok((h.to_string(), port))
        }
        None => {
            let port = if url.starts_with("https://") { 443 } else { 80 };
            Ok((authority.to_string(), port))
        }
    }
}

/// Teste la reachabilité TCP d'un endpoint de modèle (LLM) avec un timeout court.
/// Utilisé au démarrage de l'onglet agent pour détecter un serveur local éteint
/// (ex: llama-cpp sur localhost:4567) avant qu'un prompt n'échoue en silence.
/// Retourne { reachable, latencyMs?, error? } — n'échoue jamais (erreur → reachable=false).
#[tauri::command]
async fn check_model_reachable(url: String) -> Result<Value, String> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let (host, port) = match parse_host_port(&url) {
        Ok(v) => v,
        Err(e) => {
            return Ok(serde_json::json!({
                "reachable": false,
                "latencyMs": null,
                "error": e
            }));
        }
    };
    // Normaliser localhost et 0.0.0.0 en 127.0.0.1 avant la connexion TCP.
    // Sur Windows, "localhost" se résout en ::1 (IPv6) en premier ; si le serveur
    // n'écoute qu'en IPv4 (cas fréquent de llama-cpp/ollama), la connexion IPv6
    // timeout → faux négatif « serveur injoignable » alors qu'il fonctionne.
    // 0.0.0.0 n'est pas une adresse de connexion valide → utiliser 127.0.0.1.
    let connect_host = if host == "localhost" || host == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };

    let start = std::time::Instant::now();
    let res = timeout(
        Duration::from_millis(1500),
        TcpStream::connect((connect_host.as_str(), port)),
    )
    .await;
    match res {
        Ok(Ok(_stream)) => Ok(serde_json::json!({
            "reachable": true,
            "latencyMs": start.elapsed().as_millis() as u64,
            "error": null
        })),
        Ok(Err(e)) => Ok(serde_json::json!({
            "reachable": false,
            "latencyMs": start.elapsed().as_millis() as u64,
            "error": e.to_string()
        })),
        Err(_) => Ok(serde_json::json!({
            "reachable": false,
            "latencyMs": start.elapsed().as_millis() as u64,
            "error": "timeout (1.5s)".to_string()
        })),
    }
}

#[tauri::command]
fn execute_agent_bash(state: State<AppState>, command: String) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "bash",
        "command": command
    });
    rpc_manager::send_command_sync(session, cmd)
}

pub(crate) fn do_compact_agent_context(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "compact" });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
fn compact_agent_context(state: State<AppState>) -> Result<(), String> {
    do_compact_agent_context(state.inner())
}

// ── Mode remote : commandes desktop de pilotage de l'accès distant ──

/// Définit (ou change) le mot de passe d'accès distant. Hash argon2 puis persistance.
/// Mot de passe vide = désactivation du serveur (efface le hash) + révocation sessions.
#[tauri::command]
fn set_web_password(state: State<AppState>, app: AppHandle, password: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    if password.is_empty() {
        config.web_password_hash.clear();
    } else {
        config.web_password_hash = web_auth::WebAuth::hash_password(&password)?;
    }
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    // Invalide toutes les sessions existantes (décision 6.3) + purge les compteurs
    // de rate limiting par token (les tokens n'ont plus de sens).
    state.auth.revoke_all();
    state.guard.reset_all();
    state.audit.record("", "", "set_password", if password.is_empty() { "mot de passe effacé" } else { "mot de passe modifié" }, true);
    Ok(())
}

/// Déconnecte immédiatement tous les clients web connectés (kick remote).
#[tauri::command]
fn web_kick_remote(state: State<AppState>) -> Result<(), String> {
    state.auth.revoke_all();
    state.guard.reset_all();
    state.audit.record("", "", "kick", "sessions révoquées", true);
    Ok(())
}

/// Nombre de sessions distantes actuellement actives (badge « client distant connecté »).
#[tauri::command]
fn web_active_count(state: State<AppState>) -> Result<usize, String> {
    Ok(state.auth.active_count())
}

/// Indique si un mot de passe distant est défini (sans le révéler).
#[tauri::command]
fn web_has_password(state: State<AppState>) -> bool {
    !state.config.lock().unwrap().web_password_hash.is_empty()
}

/// Nombre d'entrées du journal d'audit distant (badge sur le bouton « Journal »).
#[tauri::command]
fn web_audit_count(state: State<AppState>) -> usize {
    state.audit.len()
}

/// Renvoie les `n` dernières entrées du journal d'audit distant (plus ancienne
/// d'abord, plus récente en dernier). Pour le panneau de supervision desktop.
#[tauri::command]
fn web_audit_log(state: State<AppState>, n: Option<usize>) -> Vec<web_audit::AuditEntry> {
    state.audit.recent(n.unwrap_or(200))
}

/// Vide le journal d'audit distant.
#[tauri::command]
fn web_audit_clear(state: State<AppState>) -> () {
    state.audit.clear();
}

/// État consolidé du serveur web distant (badge + diagnostics) : activation,
/// présence d'un mot de passe, nombre de clients connectés, et `running` (un
/// serveur est réellement en écoute — déduit de `web_shutdown.is_some()`).
#[derive(serde::Serialize)]
struct WebStatus {
    enabled: bool,
    has_password: bool,
    active_count: usize,
    running: bool,
    bind: String,
    port: u32,
}

#[tauri::command]
fn web_status(state: State<AppState>) -> WebStatus {
    let cfg = state.config.lock().unwrap().clone();
    WebStatus {
        enabled: cfg.web_enabled,
        has_password: !cfg.web_password_hash.is_empty(),
        active_count: state.auth.active_count(),
        running: state.web_shutdown.lock().unwrap().is_some(),
        bind: cfg.web_bind.clone(),
        port: cfg.web_port,
    }
}

/// Recharge à chaud le serveur web distant : arrête l'instance en cours (si elle
/// existe) puis la relance selon la config actuelle. À appeler depuis le panneau
/// Paramètres après un changement de `web_enabled` / `web_bind` / `web_port`.
/// `web_readonly`, `web_browse_roots` et `web_token_ttl_hours` sont lus à la volée
/// par les handlers et ne nécessitent pas de reload.
#[tauri::command]
fn reload_web_server(app: AppHandle) -> Result<(), String> {
    web_server::restart_web_server(&app);
    // Synchroniser l'icône système (tray) avec l'état d'activation du serveur web.
    // Le tray permet de cacher/montrer la fenêtre et d'accéder à « Quitter » quand
    // le keep-alive maintient le process vivant après fermeture de la fenêtre.
    sync_tray(&app);
    Ok(())
}

#[tauri::command]
fn convert_pdf_to_md_ai(state: State<AppState>, text: String) -> Result<String, String> {
    let config = state.config.lock().unwrap();
    let pdf_md_model = config.pdf_md_model.clone();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);

    // Parser le modèle au format "provider/modelId"
    let parts: Vec<&str> = pdf_md_model.splitn(2, '/').collect();
    let provider = parts[0].to_string();
    let model_id = if parts.len() > 1 { parts[1].to_string() } else { String::new() };

    let project_path = state.project_path.lock().unwrap();
    let cwd = project_path.as_ref().ok_or("Aucun projet ouvert")?.clone();
    drop(project_path);

    // Construire le prompt
    let prompt = format!(
        "Reformate le texte suivant en Markdown structuré et propre. \
        Conserve tout le contenu mais améliore la structure : titres, listes, paragraphes. \
        Réponds UNIQUEMENT avec le Markdown, sans explication ni commentaires.\n\n{}",
        text
    );

    rpc_manager::convert_text_with_pi(&cwd, &pi_path, &provider, &model_id, &prompt)
}

#[tauri::command]
fn list_sessions(state: State<AppState>) -> Result<Value, String> {
    let project_path = state.project_path.lock().unwrap();
    let project_path = project_path.as_ref().ok_or("Aucun projet ouvert")?;

    let config = state.config.lock().unwrap();
    let session_dir = if config.rpc_session_dir.is_empty() {
        // Repertoire par defaut : ~/.{stem}/agent/sessions (pi, plh, ...)
        resolve_agent_home(&config.rpc_pi_path)?.join("agent").join("sessions")
    } else {
        std::path::PathBuf::from(&config.rpc_session_dir)
    };

    // Calculer le nom du dossier projet
    let folder_name = project_to_session_folder(project_path);
    let project_dir = session_dir.join(&folder_name);

    if !project_dir.exists() {
        return Ok(serde_json::json!([]));
    }

    let mut sessions = Vec::new();
    let entries = std::fs::read_dir(&project_dir)
        .map_err(|e| format!("Erreur lecture dossier sessions: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Erreur entrée: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let file_name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        // Format: YYYY-MM-DDTHH-MM-SS-SSSZ_UUID
        let parts: Vec<&str> = file_name.splitn(2, '_').collect();
        let timestamp = parts.first().unwrap_or(&"").to_string();
        let session_id = parts.get(1).unwrap_or(&"").to_string();

        // Taille du fichier
        let meta = std::fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);

        // Date de modification du fichier (mtime)
        let modified = meta
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%Y-%m-%dT%H:%M:%S").to_string()
            })
            .unwrap_or(timestamp);

        // Lire le fichier en entier pour extraire l'aperçu
        let content = std::fs::read_to_string(&path).unwrap_or_default();

        // Extraire le premier message utilisateur comme aperçu
        let preview = content
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .find(|v| {
                v.get("type").and_then(|t| t.as_str()) == Some("message")
                    && v.get("message").and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("user")
            })
            .and_then(|v| {
                v.get("message")?.get("content")?.as_array()?.first()?.get("text")?.as_str().map(|s| s.to_string())
            })
            .unwrap_or_default();
        let preview = if preview.len() > 120 {
            // Découper à 120 caractères (pas bytes) pour éviter de casser un caractère UTF-8
            let chars: Vec<char> = preview.chars().collect();
            let truncated: String = chars.iter().take(120).collect();
            format!("{}…", truncated)
        } else {
            preview
        };

        sessions.push(serde_json::json!({
            "id": session_id,
            "timestamp": modified,
            "file": path.to_string_lossy().to_string(),
            "size": size,
            "preview": preview
        }));
    }

    // Trier par date décroissante
    sessions.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        tb.cmp(ta)
    });

    Ok(serde_json::json!(sessions))
}

/// Convertit un chemin de projet en nom de dossier de sessions
fn project_to_session_folder(path: &str) -> String {
    let clean: String = path
        .chars()
        .map(|c| match c {
            ':' | '\\' | '/' => '-',
            _ => c,
        })
        .collect();
    format!("--{}--", clean)
}

#[tauri::command]
fn resume_agent_session(state: State<AppState>, session_file: String) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "switch_session",
        "sessionPath": session_file
    });
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

// ── Persistance des onglets ──

fn session_filename(project_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project_path.hash(&mut hasher);
    format!("{:016x}.json", hasher.finish())
}

#[tauri::command]
fn save_tab_session(app: AppHandle, project_path: String, data: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin config: {}", e))?;
    let sessions_dir = dir.join("sessions");
    fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("Erreur création dossier sessions: {}", e))?;
    let path = sessions_dir.join(session_filename(&project_path));
    fs::write(&path, data).map_err(|e| format!("Erreur écriture session: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_tab_session(app: AppHandle, project_path: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin config: {}", e))?;
    let path = dir.join("sessions").join(session_filename(&project_path));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Erreur lecture session: {}", e))
}

// ── Recherche globale dans les fichiers ──

#[derive(Debug, Serialize, Clone)]
struct SearchResult {
    path: String,
    line: usize,
    col: usize,
    text: String,
}

#[tauri::command]
fn search_in_files(
    state: State<AppState>,
    query: String,
    use_regex: bool,
    extensions: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    // Compiler le pattern (regex ou texte littéral)
    let pattern: regex::Regex = if use_regex {
        regex::Regex::new(&query)
            .map_err(|e| format!("Regex invalide : {}", e))?
    } else {
        // Échapper les caractères spéciaux regex pour une recherche littérale
        let escaped = regex::escape(&query);
        regex::Regex::new(&escaped)
            .map_err(|e| format!("Erreur pattern : {}", e))?
    };

    // Filtre d'extensions
    let ext_filter: Vec<String> = if extensions.is_empty() {
        vec![]
    } else {
        extensions
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    };

    // Dossiers/fichiers à ignorer
    let ignore_dirs = [
        "node_modules", ".git", ".svn", "target", "dist", "build", "__pycache__",
        ".next", ".nuxt", ".cache", ".vs", "vendor", "bundle",
    ];
    let ignore_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
        ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".woff", ".woff2",
        ".ttf", ".eot", ".mp3", ".mp4", ".avi", ".mov", ".exe", ".dll",
        ".so", ".dylib", ".o", ".obj", ".pyc", ".class", ".jar", ".wasm",
    ];

    let max = max_results.unwrap_or(500);
    let mut results = Vec::new();

    fn walk_dir(
        dir: &std::path::Path,
        pattern: &regex::Regex,
        ext_filter: &[String],
        ignore_dirs: &[&str],
        ignore_exts: &[&str],
        max: usize,
        results: &mut Vec<SearchResult>,
    ) -> Result<(), String> {
        if results.len() >= max {
            return Ok(());
        }
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Erreur lecture dossier {:?}: {}", dir, e))?;
        for entry in entries {
            if results.len() >= max {
                return Ok(());
            }
            let entry = entry.map_err(|e| format!("Erreur entrée : {}", e))?;
            let path = entry.path();

            // Ignorer les dossiers cachés et les dossiers listés
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.') || ignore_dirs.contains(&name_str.as_ref()) {
                continue;
            }

            if path.is_dir() {
                walk_dir(&path, pattern, ext_filter, ignore_dirs, ignore_exts, max, results)?;
            } else {
                // Filtre par extension
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let full_ext = format!(".{}", ext);

                // Ignorer les fichiers binaires
                if ignore_exts.contains(&full_ext.as_str()) {
                    continue;
                }

                // Filtre d'extensions si spécifié
                if !ext_filter.is_empty() && !ext_filter.contains(&ext) {
                    continue;
                }

                // Taille max : 2 Mo (ignorer les gros fichiers)
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > 2_000_000 {
                        continue;
                    }
                }

                // Lire et chercher
                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue, // Fichier binaire ou illisible
                };

                let path_str = path.to_string_lossy().to_string();
                for (line_num, line) in content.lines().enumerate() {
                    if results.len() >= max {
                        return Ok(());
                    }
                    for mat in pattern.find_iter(line) {
                        results.push(SearchResult {
                            path: path_str.clone(),
                            line: line_num + 1,
                            col: mat.start() + 1,
                            text: line.to_string(),
                        });
                    }
                }
            }
        }
        Ok(())
    }

    walk_dir(
        std::path::Path::new(&project),
        &pattern,
        &ext_filter,
        &ignore_dirs,
        &ignore_exts,
        max,
        &mut results,
    )?;

    Ok(results)
}

/// Liste tous les modèles disponibles depuis ~/.pi/agent/models.json
/// Retourne un tableau de chaînes "provider/modelId" trié alphabétiquement.
#[tauri::command]
fn get_available_models_list(state: State<AppState>) -> Result<Vec<String>, String> {
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let models_path = resolve_agent_home(&pi_path)?.join("agent").join("models.json");
    let json_str = std::fs::read_to_string(&models_path)
        .map_err(|e| format!("Lecture models.json: {}", e))?;
    let config: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;

    let mut result = Vec::new();
    if let Some(providers) = config["providers"].as_object() {
        for (provider_name, provider_config) in providers {
            if let Some(models) = provider_config["models"].as_array() {
                for m in models {
                    if let Some(id) = m["id"].as_str() {
                        result.push(format!("{}/{}", provider_name, id));
                    }
                }
            }
        }
    }
    result.sort();
    Ok(result)
}

// ── Vérification syntaxique (Mode Orchestration V2 — linting-in-the-loop) ──

#[derive(Debug, Serialize)]
struct SyntaxCheckResult {
    ok: bool,
    had_checker: bool,
    output: String,
}

/// Vérifie la syntaxe des fichiers modifiés par le codeur. Lance un outil local
/// adapté à l'extension : eslint pour JS/TS, python -m py_compile pour Python,
/// cargo check pour Rust. Si aucun vérificateur n'est disponible, la vérification
/// est silencieusement passée (had_checker=false) pour ne pas bloquer la tâche.
#[tauri::command]
fn check_syntax(paths: Vec<String>, project_path: String) -> Result<SyntaxCheckResult, String> {
    if paths.is_empty() {
        return Ok(SyntaxCheckResult {
            ok: true,
            had_checker: false,
            output: "Aucun fichier à vérifier".to_string(),
        });
    }

    let project = std::path::Path::new(&project_path);
    let mut all_ok = true;
    let mut outputs: Vec<String> = Vec::new();
    let mut had_checker = false;
    let mut rust_dirs: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();

    for path in &paths {
        let p = std::path::Path::new(path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let rel = p
            .strip_prefix(project)
            .unwrap_or(p)
            .to_string_lossy()
            .to_string();

        match ext {
            "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs" => {
                let eslint_local = project.join("node_modules").join(".bin").join(if cfg!(target_os = "windows") { "eslint.cmd" } else { "eslint" });
                let (cmd, args): (String, Vec<String>) = if eslint_local.exists() {
                    (eslint_local.to_string_lossy().to_string(), vec![path.clone()])
                } else if which("npx").is_some() {
                    ("npx".to_string(), vec!["--no-install".to_string(), "eslint".to_string(), path.clone()])
                } else {
                    outputs.push(format!(
                        "[{}] Aucun linter JS/TS disponible (eslint local ou npx introuvable)",
                        rel
                    ));
                    continue;
                };
                if let Some((ok, output)) = run_command(&cmd, &args, Some(&project_path)) {
                    had_checker = true;
                    all_ok = all_ok && ok;
                    outputs.push(format!("[{}] {}", rel, output));
                }
            }
            "py" => {
                let out = run_python_command("python", "-m", "py_compile", path, &project_path)
                    .or_else(|| run_python_command("python3", "-m", "py_compile", path, &project_path));
                if let Some((ok, output)) = out {
                    had_checker = true;
                    all_ok = all_ok && ok;
                    outputs.push(format!("[{}] {}", rel, output));
                } else {
                    outputs.push(format!("[{}] python/python3 introuvable", rel));
                }
            }
            "rs" => {
                // Trouver le Cargo.toml parent le plus proche
                let mut dir = p.parent();
                let mut found = None;
                while let Some(d) = dir {
                    if d.join("Cargo.toml").exists() {
                        found = Some(d.to_path_buf());
                        break;
                    }
                    dir = d.parent();
                }
                if let Some(dir) = found {
                    rust_dirs.insert(dir);
                } else {
                    outputs.push(format!("[{}] Aucun Cargo.toml trouvé pour cargo check", rel));
                }
            }
            _ => {
                outputs.push(format!(
                    "[{}] Extension non supportée par le linter intégré",
                    rel
                ));
            }
        }
    }

    // cargo check une seule fois par crate Rust concerné
    for dir in rust_dirs {
        let dir_str = dir.to_string_lossy().to_string();
        let label = dir.file_name().and_then(|f| f.to_str()).unwrap_or("rust");
        if let Some((ok, output)) = run_command("cargo", &["check"], Some(&dir_str)) {
            had_checker = true;
            all_ok = all_ok && ok;
            outputs.push(format!("[{}] {}", label, output));
        } else {
            outputs.push(format!("[{}] cargo introuvable", label));
        }
    }

    Ok(SyntaxCheckResult {
        ok: all_ok,
        had_checker,
        output: outputs.join("\n---\n"),
    })
}

fn run_python_command(binary: &str, arg1: &str, arg2: &str, file: &str, cwd: &str) -> Option<(bool, String)> {
    if which(binary).is_none() {
        return None;
    }
    run_command(binary, &[arg1, arg2, file], Some(cwd))
}

fn which(cmd: &str) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    let out = std::process::Command::new("where").arg(cmd).output().ok()?;
    #[cfg(not(target_os = "windows"))]
    let out = std::process::Command::new("which").arg(cmd).output().ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout);
        s.lines().next().map(|l| std::path::PathBuf::from(l.trim()))
    } else {
        None
    }
}

fn run_command(cmd: impl AsRef<std::ffi::OsStr>, args: &[impl AsRef<std::ffi::OsStr>], cwd: Option<&str>) -> Option<(bool, String)> {
    let mut command = std::process::Command::new(cmd);
    command.args(args);
    if let Some(c) = cwd {
        command.current_dir(c);
    }
    let output = command.output().ok()?;
    let ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stdout.is_empty() {
        stderr
    } else if stderr.is_empty() {
        stdout
    } else {
        format!("{}\n{}", stdout, stderr)
    };
    Some((ok, combined))
}

// ── Persistance du plan d'orchestration ──

/// Sauvegarde le plan d'orchestration dans le projet
#[tauri::command]
fn save_plan(state: State<AppState>, plan_json: String) -> Result<(), String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_dir = std::path::PathBuf::from(&project).join(".pilot");
    fs::create_dir_all(&plan_dir)
        .map_err(|e| format!("Erreur création dossier .pilot : {}", e))?;

    let plan_path = plan_dir.join("plan.json");
    fs::write(&plan_path, &plan_json)
        .map_err(|e| format!("Erreur écriture plan : {}", e))?;

    Ok(())
}

/// Charge le plan d'orchestration du projet
#[tauri::command]
fn load_plan(state: State<AppState>) -> Result<String, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_path = std::path::PathBuf::from(&project).join(".pilot").join("plan.json");
    if !plan_path.exists() {
        return Ok(String::new()); // Pas de plan existant
    }

    fs::read_to_string(&plan_path)
        .map_err(|e| format!("Erreur lecture plan : {}", e))
}

/// Supprime le plan d'orchestration du projet
#[tauri::command]
fn delete_plan(state: State<AppState>) -> Result<(), String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_path = std::path::PathBuf::from(&project).join(".pilot").join("plan.json");
    if plan_path.exists() {
        fs::remove_file(&plan_path)
            .map_err(|e| format!("Erreur suppression plan : {}", e))?;
    }

    Ok(())
}

use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

/// Identifiant stable de l'icône système (permet de la retrouver / retirer).
const TRAY_ID: &str = "pilot-tray";

/// Crée l'icône système (tray) si elle n'existe pas déjà. Menu :
/// - « Afficher Pilot » : remonte et focalise la fenêtre principale.
/// - « Quitter Pilot » : termine réellement le process (le seul moyen de quitter
///   quand le keep-alive intercepte la fermeture de la fenêtre).
/// Un double-clic sur l'icône remonte aussi la fenêtre.
fn ensure_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let show_item = MenuItem::with_id(app, "tray-show", "Afficher Pilot", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray-quit", "Quitter Pilot", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Pilot — accès distant actif")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Retire l'icône système si elle existe.
fn remove_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// Synchronise la présence du tray avec l'état `web_enabled` : crée l'icône si le
/// serveur web est activé, la retire sinon. Appelée au setup et à chaque reload.
fn sync_tray(app: &AppHandle) {
    let enabled = app.state::<AppState>().config.lock().unwrap().web_enabled;
    if enabled {
        let _ = ensure_tray(app);
    } else {
        remove_tray(app);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let config = load_config_disk(&handle);
            let state: State<'_, AppState> = app.state();
            *state.config.lock().unwrap() = config;
            // Audit distant persistant : charger l'historique disque (web_audit.jsonl)
            // dans le ring buffer et activer l'append-only JSONL. À faire avant
            // start_if_enabled pour ne perdre aucune entrée dès la première requête.
            if let Ok(cfg_path) = config_path(&handle) {
                state.audit.set_file(cfg_path.with_file_name("web_audit.jsonl"));
            }
            // Démarrer le serveur web distant (mode remote) si activé.
            // start_if_enabled crée son propre thread dédié et enregistre le signal
            // d'arrêt dans AppState.web_shutdown (pour le rechargement à chaud).
            web_server::start_if_enabled(handle.clone());
            sync_tray(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep-alive : si le serveur web distant est activé ET le keep-alive
            // coché, la fermeture de la fenêtre la cache au lieu de quitter le
            // process — ainsi le serveur web et la session pi restent actifs en
            // arrière-plan. Le process se termine via le menu « Quitter » du tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state: State<AppState> = window.app_handle().state();
                let cfg = state.config.lock().unwrap().clone();
                if cfg.web_keep_alive && cfg.web_enabled {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    // Demande de confirmation avant de quitter : on empêche la
                    // fermeture par défaut (synchrone) puis on affiche un dialogue
                    // OK/Annuler. Si l'utilisateur confirme, on détruit la fenêtre
                    // via `destroy()` (qui ne réémet pas CloseRequested → pas de boucle).
                    api.prevent_close();
                    let win = window.clone();
                    window
                        .app_handle()
                        .dialog()
                        .message("Êtes-vous sûr de vouloir quitter Pilot ?")
                        .title("Quitter Pilot")
                        .buttons(MessageDialogButtons::OkCancel)
                        .show(move |confirmed| {
                            if confirmed {
                                let _ = win.destroy();
                            }
                        });
                }
            }
        })
        .manage({
            let (event_tx, _) = tokio::sync::broadcast::channel(256);
            AppState {
                project_path: Mutex::new(None),
                config: Mutex::new(AppConfig::default()),
                watch_state: Mutex::new(None),
                terminals: Mutex::new(HashMap::new()),
                rpc_state: Mutex::new(None),
                event_tx,
                auth: Arc::new(web_auth::WebAuth::new()),
                guard: Arc::new(web_rate::WebGuard::new()),
                audit: Arc::new(web_audit::WebAudit::new()),
                web_shutdown: std::sync::Mutex::new(None),
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_project_path,
            read_file_content,
            get_file_info,
            read_file_binary,
            write_file_content,
            write_file_binary,
            file_exists,
            file_mtime,
            open_terminal,
            get_config,
            save_config,
            set_sidebar_width,
            set_window_title,
            get_recent_projects,
            close_project,
            refresh_tree,
            create_file,
            create_folder,
            delete_file_or_dir,
            open_explorer,
            open_in_browser,
            export_pdf,
            rename_file_or_dir,
            copy_image_to_project,
            spawn_terminal,
            write_to_terminal,
            resize_terminal,
            kill_terminal,
            start_agent_session,
            stop_agent_session,
            send_rpc_command,
            get_agent_state,
            get_session_stats,
            model_supports_images,
            send_agent_prompt,
            abort_agent,
            new_agent_session,
            resume_agent_session,
            get_agent_messages,
            set_agent_model,
            list_agent_models,
            list_agent_commands,
            check_model_reachable,
            execute_agent_bash,
            compact_agent_context,
            list_sessions,
            send_inline_prompt,
            convert_pdf_to_md_ai,
            save_tab_session,
            load_tab_session,
            search_in_files,
            get_available_models_list,
            set_help_model,
            add_favorite,
            remove_favorite,
            save_plan,
            load_plan,
            delete_plan,
            check_syntax,
            set_web_password,
            web_kick_remote,
            web_active_count,
            web_has_password,
            web_status,
            web_audit_log,
            web_audit_clear,
            web_audit_count,
            reload_web_server,
            help::get_handbook,
            help::ask_help,
            tailscale::tailscale_status,
            tailscale::tailscale_enable_serve,
            tailscale::tailscale_disable_serve,
            tailscale::tailscale_serve_qrcode,
        ])
        .build(tauri::generate_context!())
        .expect("Erreur au lancement de Pilot")
        .run(|app, event| {
            // Arrêt propre du serveur web à la fermeture de l'app : on signale le
            // shutdown oneshot pour que `axum::serve` termine et ferme le listener
            // (sinon le socket LISTENING reste « fantôme » attaché à l'IP Tailscale,
            // empêchant la prochaine instance de binder le même port — symptôme
            // typique en mode dev où l'ancienne instance est tuée brutalement).
            if let RunEvent::ExitRequested { .. } = event {
                let tx_opt = {
                    let state = app.state::<AppState>();
                    let mut guard = state.web_shutdown.lock().unwrap();
                    guard.take()
                };
                if let Some(tx) = tx_opt {
                    let _ = tx.send(());
                    // Laisser le thread web fermer le listener et libérer le port
                    // avant que le process ne se termine.
                    std::thread::sleep(std::time::Duration::from_millis(400));
                }
            }
        });
}

// ── Terminal intégré (PTY) ──

#[tauri::command]
fn spawn_terminal(
    state: State<AppState>,
    app: AppHandle,
    terminal_id: String,
    run_default: bool,
) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let project_path = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    let config = state.config.lock().unwrap();

    // Déterminer le shell et les arguments
    let (shell, args): (String, Vec<String>) = get_shell_info(&project_path);

    // Commande à exécuter automatiquement
    let auto_cmd = if run_default && !config.default_command.is_empty() {
        Some(config.default_command.clone())
    } else {
        None
    };

    // Créer le PTY
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Erreur création PTY: {}", e))?;

    // Construire la commande
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&args);
    cmd.cwd(&project_path);

    // Si une commande auto est spécifiée, on la passe différemment selon l'OS
    if let Some(ref auto) = auto_cmd {
        #[cfg(target_os = "windows")]
        {
            cmd.args(&["/k", auto]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            // On utilise l'option -c pour bash/zsh
            let shell_cmd = format!("{}; exec $SHELL", auto);
            // On remplace les args par -c et la commande
            cmd.args(&["-c", &shell_cmd]);
        }
    }

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Erreur spawn shell: {}", e))?;

    let master = pty_pair.master;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("Erreur clone reader: {}", e))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Erreur take writer: {}", e))?;

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let app_clone = app.clone();
    let id_clone = terminal_id.clone();

    // Thread de lecture : streamer la sortie du PTY vers le frontend
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if !running_clone.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data: Vec<u8> = buf[..n].to_vec();
                    let payload = serde_json::json!({
                        "id": id_clone,
                        "data": data,
                    });
                    app_clone.emit("terminal-output", &payload).ok();
                }
                Err(_) => break,
            }
        }
    });
    // Le handle est volontairement détaché : le thread s'arrête
    // quand le writer est droppé et que le read retourne EOF/erreur.
    drop(handle);

    let term_state = TerminalState {
        running,
        master,
        child,
        writer: Some(writer),
    };

    state.terminals.lock().unwrap().insert(terminal_id, term_state);

    Ok(())
}

#[tauri::command]
fn write_to_terminal(
    state: State<AppState>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get_mut(&terminal_id)
        .ok_or("Terminal introuvable")?;

    use std::io::Write;
    if let Some(ref mut writer) = term.writer {
        writer
            .write_all(&data)
            .map_err(|e| format!("Erreur écriture terminal: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Erreur flush terminal: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn resize_terminal(
    state: State<AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get(&terminal_id)
        .ok_or("Terminal introuvable")?;

    term.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Erreur redimensionnement terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
fn kill_terminal(
    state: State<AppState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    if let Some(mut term) = terminals.remove(&terminal_id) {
        term.running.store(false, Ordering::Relaxed);

        // Dropper le writer envoie EOF au slave → le read retournera 0/erreur
        term.writer.take();

        // Tuer le processus enfant (force la fermeture des pipes)
        term.child.kill().ok();

        // Le thread de lecture se termine naturellement quand le pipe est fermé.
        // On ne join pas pour éviter un deadlock si le read() est bloquant.
        // Le JoinHandle est détaché, le thread finira seul.
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    ("cmd.exe".to_string(), vec![])
}

#[cfg(target_os = "macos")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    (shell, vec![])
}

#[cfg(target_os = "linux")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    (shell, vec![])
}

// ── Export Markdown → HTML (pour impression PDF) ──

#[tauri::command]
fn export_pdf(source_path: String) -> Result<String, String> {
    let md = fs::read_to_string(&source_path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Génération HTML via pulldown-cmark
    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, Parser::new_ext(&md, pulldown_cmark::Options::all()));

    // Document HTML complet avec le même CSS que la prévisualisation
    let full_html = format!(
        r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1e1e1e;
    background: #ffffff;
    padding: 30px 40px;
    max-width: 900px;
    margin: 0 auto;
  }}
  h1 {{ font-size: 1.8em; margin: 0.8em 0 0.4em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }}
  h2 {{ font-size: 1.5em; margin: 0.8em 0 0.4em; }}
  h3 {{ font-size: 1.3em; margin: 0.7em 0 0.3em; }}
  h4, h5, h6 {{ font-size: 1.1em; margin: 0.6em 0 0.3em; }}
  p {{ margin: 0.5em 0; }}
  a {{ color: #007acc; text-decoration: none; }}
  ul, ol {{ padding-left: 2em; margin: 0.5em 0; }}
  li {{ margin: 0.2em 0; }}
  blockquote {{
    margin: 0.8em 0;
    padding: 0.5em 1em;
    border-left: 4px solid #ccc;
    background: #f9f9f9;
  }}
  code {{
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 0.9em;
    background: #f5f5f5;
    padding: 2px 5px;
    border-radius: 3px;
  }}
  pre {{
    background: #f5f5f5;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.8em 0;
    line-height: 1.5;
  }}
  pre code {{ background: none; padding: 0; font-size: 0.85em; }}
  table {{ border-collapse: collapse; margin: 0.8em 0; width: 100%; }}
  th, td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; }}
  th {{ background: #f5f5f5; font-weight: bold; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 1em 0; }}
  img {{
    max-width: 100%;
    margin: 1em 0;
    display: block;
  }}
  @media print {{
    body {{ padding: 20px 30px; }}
    @page {{ margin: 15mm; }}
    img {{ page-break-inside: avoid; max-height: 95vh; }}
    h1, h2, h3, h4 {{ page-break-after: avoid; }}
    p {{ orphans: 3; widows: 3; }}
  }}
</style>
</head>
<body>
{}
</body>
</html>"#, html_output);

    Ok(full_html)
}

// ── Renommer un fichier ou un dossier ──

#[tauri::command]
async fn rename_file_or_dir(
    state: State<'_, AppState>,
    app: AppHandle,
    source_path: String,
    new_name: String,
) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let parent = source.parent().ok_or("Chemin invalide")?;
    let dest = parent.join(&new_name);

    if dest.exists() {
        return Err("Un fichier/dossier porte déjà ce nom".to_string());
    }

    // Pause du watcher le temps du renommage
    stop_watcher(&state);

    let result = if source.is_dir() {
        // Sur Windows, renommer un dossier non vide peut échouer si un fichier
        // enfant a été récemment accédé (cache FS, antivirus, indexation).
        // Stratégie : créer le nouveau dossier, déplacer chaque enfant, supprimer l'ancien.
        rename_dir_fallback(source, &dest)
    } else {
        std::fs::rename(source, &dest).map_err(|e| format!("Erreur renommage: {}", e))
    };

    // Redémarrer le watcher
    let project = state.project_path.lock().unwrap();
    if let Some(ref proj_path) = *project {
        start_watching(&app, proj_path, &state)?;
    }

    result?;
    Ok(dest.to_string_lossy().to_string())
}

fn rename_dir_fallback(source: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    // Tenter le rename direct d'abord (marche pour les dossiers vides)
    if std::fs::rename(source, dest).is_ok() {
        return Ok(());
    }

    // Fallback : créer la destination, déplacer le contenu, supprimer la source
    std::fs::create_dir(dest).map_err(|e| format!("Erreur création dossier cible: {}", e))?;

    let entries = std::fs::read_dir(source).map_err(|e| format!("Erreur lecture dossier source: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Erreur entrée: {}", e))?;
        let child_source = entry.path();
        let child_name = entry.file_name();
        let child_dest = dest.join(&child_name);

        if child_source.is_dir() {
            rename_dir_fallback(&child_source, &child_dest)?;
        } else {
            // Pour les fichiers, tenter rename, sinon copier+supprimer
            if std::fs::rename(&child_source, &child_dest).is_err() {
                std::fs::copy(&child_source, &child_dest)
                    .map_err(|e| format!("Erreur copie: {}", e))?;
                std::fs::remove_file(&child_source)
                    .map_err(|e| format!("Erreur suppression: {}", e))?;
            }
        }
    }

    std::fs::remove_dir(source).map_err(|e| format!("Erreur suppression dossier source: {}", e))?;
    Ok(())
}
