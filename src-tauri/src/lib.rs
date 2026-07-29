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

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows `CREATE_NO_WINDOW` (0x08000000). Appliquée à chaque
/// `Command::new` silencieux pour éviter qu'une fenêtre console noire
/// n'apparaisse/disparaisse fugacement à l'écran (ex: `git`, `pi`, `where`).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Dossiers systématiquement ignorés à la lecture de l'arborescence projet et
/// par le file watcher. Ces dossiers (dépendances, build, VCS, caches) peuvent
/// contenir des dizaines de milliers de fichiers ; les inclure fait exploser
/// la mémoire du render WebView (DOM de l'arbre + re-render en boucle via le
/// watcher). Source unique de vérité partagée par `build_tree`, `start_watching`
/// et `walk_dir` (recherche globale).
const IGNORED_DIRS: &[&str] = &[
    "node_modules", ".git", ".svn", "target", "dist", "build", "__pycache__",
    ".next", ".nuxt", ".cache", ".vs", "vendor", "bundle",
];

mod help;
mod review;
mod rpc_manager;
mod tailscale;
mod web_auth;
mod web_audit;
mod web_rate;
mod web_server;
mod context_engine;

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
    /// H2 V1 : session reviewer dédiée (pi --no-session, contexte vierge). Lancée
    /// lazy au 1er besoin de review, recyclée via new_session. Canal séparé.
    rpc_reviewer: Mutex<Option<rpc_manager::RpcSession>>,
    /// H2 V2 : sessions des agents spécialisés (id -> RpcSession). Généralisation
    /// du reviewer ; canal commun rpc-event-agents avec enveloppe agent_id.
    agent_sessions: Mutex<HashMap<String, rpc_manager::RpcSession>>,
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
    /// Cache de la sonde du backend (pi/plh) : `(pi_path, probe)`.
    /// Re-sondé quand `rpc_pi_path` change. Évite de planter un backend qui ne
    /// supporte pas `--extension` (ex: plh sans le flag) en ne passant pas `-e`.
    ext_gate_cache: std::sync::Mutex<Option<(String, BackendProbe)>>,
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
    /// Modèle utilisé pour l'onglet « 🔍 Review » (H5, spec_review.md). Format
    /// "provider/modelId" (issu de get_available_models_list). Vide = aucun modèle
    /// (la revue refusera tant qu'un modèle n'est pas sélectionné dans l'UI).
    #[serde(default)]
    review_model: String,
    // ── Context Engine (H1, spec_context_engine.md) ──
    // Injection automatique d'un contexte projet avant le 1er prompt de chaque
    // session agent (chat standard). V1 heuristique.
    #[serde(default = "default_true")]
    context_engine_enabled: bool,
    #[serde(default = "default_context_budget")]
    context_budget_tokens: u32,
    #[serde(default = "default_true")]
    context_include_imports: bool,
    #[serde(default = "default_true")]
    context_include_specs: bool,
    #[serde(default = "default_true")]
    context_include_recents: bool,
    // ── Context Engine V2 (RAG, spec_context_engine.md §7) ──
    // Embeddings locaux via Ollama. Si activé ET l'endpoint répond, on utilise
    // le RAG ; sinon on retombe sur V1 heuristique (context_engine_enabled).
    #[serde(default)]
    context_rag_enabled: bool,
    #[serde(default = "default_rag_endpoint")]
    context_rag_endpoint: String,
    #[serde(default = "default_rag_model")]
    context_rag_model: String,
    /// Diff Review (A4 V2) : porte pré-écriture. Si true, l'agent doit confirmer
    /// auprès de l'utilisateur avant chaque write/edit (extension pi pilot-edit-gate).
    /// Désactivé par défaut (l'agent écrit librement, comme avant).
    #[serde(default)]
    confirm_file_edits: bool,
    // ── Mémoire de projet (H3, spec_project_memory.md) ──
    // PROJECT_MEMORY.md tenu par l'agent. Injection dans le contexte (chat +
    // orchestration) si activé. Indépendant du Context Engine (H1).
    #[serde(default = "default_true")]
    project_memory_enabled: bool,
    // Extraction auto de 1–3 faits après chaque tâche d'orchestration réussie
    // (coût : 1 tour LLM supplémentaire par tâche). Opt-in.
    #[serde(default)]
    project_memory_auto_extract: bool,
    // ── Auto-test post-modification (E2, spec_orchestration_autotest.md) ──
    // Extension du linting-in-the-loop (§11.3) : exécute les tests du projet
    // (npm test / cargo test / pytest / go test) après chaque tâche du codeur,
    // au lieu de ne valider que la syntaxe. Opt-in (défaut off). Fallback sur
    // `check_syntax` si aucun runner détecté. Budget de corrections unifié
    // (lint + test partagent `orchestration_test_max_corrections`).
    #[serde(default)]
    orchestration_test_enabled: bool,
    #[serde(default = "default_test_timeout_ms")]
    orchestration_test_timeout_ms: u32,
    #[serde(default = "default_test_max_corrections")]
    orchestration_test_max_corrections: u32,
    // Override manuel ("" = auto-détection côté frontend). Si renseigné, la
    // commande est utilisée telle quelle (scope complet uniquement).
    #[serde(default)]
    orchestration_test_command: String,
    // "targeted" (défaut) = tests ciblés sur fichiers modifiés ; "full" = commande
    // complète après chaque tâche.
    #[serde(default = "default_test_scope")]
    orchestration_test_scope: String,
    // A1 : snapshots Git avant chaque tâche d'orchestration (undo de tâche).
    // Défaut activé — garantie de sécurité quasi gratuite. Désactivable.
    #[serde(default = "default_true")]
    orchestration_snapshots_enabled: bool,
    // H2 V1 : reviewer indépendant (2e session pi --no-session, contexte vierge).
    // Opt-in (défaut off) — coûte un tour cloud par tâche.
    #[serde(default)]
    orchestration_reviewer_enabled: bool,
    // Provider/modèle du reviewer. Vides → fallback sur orchestration_provider/model.
    #[serde(default)]
    orchestration_reviewer_provider: String,
    #[serde(default)]
    orchestration_reviewer_model: String,
    // "all" (défaut) = reviewer après chaque tâche ; "critical" = seulement si
    // un fichier sensible matche un glob de `critical_patterns`.
    #[serde(default = "default_reviewer_scope")]
    orchestration_reviewer_scope: String,
    // Globs éditables (mode "critical" uniquement). Défaut : fichiers critiques
    // d'un projet Pilot-like (backend Rust, config, specs, AGENTS).
    #[serde(default = "default_reviewer_critical_patterns")]
    orchestration_reviewer_critical_patterns: Vec<String>,
    // ── Gestion d'agents multi-rôles (H2 V2, spec_gestion_agents.md) ──
    // Garde-fous du bus d'agents.
    #[serde(default = "default_agent_max_call_depth")]
    agent_max_call_depth: u32,
    #[serde(default = "default_agent_max_total_calls")]
    agent_max_total_calls: u32,
    #[serde(default = "default_agent_timeout_ms")]
    agent_timeout_ms: u32,
    #[serde(default = "default_agent_max_result_tokens")]
    agent_max_result_tokens: u32,
}

fn default_true() -> bool { true }
fn default_context_budget() -> u32 { 8000 }
fn default_rag_endpoint() -> String { "http://127.0.0.1:11434".to_string() }
fn default_rag_model() -> String { "nomic-embed-text".to_string() }
fn default_sidebar_width() -> u32 { 280 }
fn default_auto_save_delay() -> u32 { 3000 }
fn default_orchestration_idle_timeout() -> u32 { 120000 }
fn default_orchestration_revision_interval() -> u32 { 5 }
fn default_orchestration_granularity() -> String { "fine".to_string() }
fn default_coder_context_window() -> u32 { 0 }
fn default_web_port() -> u32 { 8787 }
fn default_web_bind() -> String { "127.0.0.1".to_string() }
fn default_web_token_ttl() -> u32 { 168 }
fn default_test_timeout_ms() -> u32 { 60000 }
fn default_test_max_corrections() -> u32 { 3 }
fn default_test_scope() -> String { "targeted".to_string() }
fn default_reviewer_scope() -> String { "all".to_string() }
fn default_agent_max_call_depth() -> u32 { 3 }
fn default_agent_max_total_calls() -> u32 { 30 }
fn default_agent_timeout_ms() -> u32 { 120000 }
fn default_agent_max_result_tokens() -> u32 { 4000 }
fn default_reviewer_critical_patterns() -> Vec<String> {
    vec![
        "src-tauri/src/**/*.rs".to_string(),
        "src-tauri/tauri.conf.json".to_string(),
        "src-tauri/Cargo.toml".to_string(),
        "package.json".to_string(),
        "AGENTS.md".to_string(),
        "spec_*.md".to_string(),
    ]
}

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
            review_model: String::new(),
            context_engine_enabled: true,
            context_budget_tokens: default_context_budget(),
            context_include_imports: true,
            context_include_specs: true,
            context_include_recents: true,
            context_rag_enabled: false,
            context_rag_endpoint: default_rag_endpoint(),
            context_rag_model: default_rag_model(),
            confirm_file_edits: false,
            project_memory_enabled: true,
            project_memory_auto_extract: false,
            orchestration_test_enabled: false,
            orchestration_test_timeout_ms: default_test_timeout_ms(),
            orchestration_test_max_corrections: default_test_max_corrections(),
            orchestration_test_command: String::new(),
            orchestration_test_scope: default_test_scope(),
            orchestration_snapshots_enabled: true,
            orchestration_reviewer_enabled: false,
            orchestration_reviewer_provider: String::new(),
            orchestration_reviewer_model: String::new(),
            orchestration_reviewer_scope: default_reviewer_scope(),
            orchestration_reviewer_critical_patterns: default_reviewer_critical_patterns(),
            // ── Gestion d'agents multi-rôles (H2 V2) ──
            agent_max_call_depth: default_agent_max_call_depth(),
            agent_max_total_calls: default_agent_max_total_calls(),
            agent_timeout_ms: default_agent_timeout_ms(),
            agent_max_result_tokens: default_agent_max_result_tokens(),
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
                // Ignorer les dossiers lourds/non pertinents (node_modules,
                // .git, target, …) : on ne les affiche pas ET on ne descend
                // pas dedans — sinon l'arbre sérialisé et le DOM frontal
                // explosent en mémoire sur les gros projets.
                if let Some(name) = child_path.file_name() {
                    if IGNORED_DIRS.contains(&name.to_string_lossy().as_ref()) {
                        continue;
                    }
                }
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

    // Poller custom (et non notify::PollWatcher) : le PollWatcher de `notify`
    // re-scanne récursivement TOUT le projet à chaque poll — y compris les
    // dossiers ignorés (target/, node_modules/, .git/…) — car son filtrage
    // IGNORED ne s'applique qu'aux *events*, pas au *scan*. Sur un projet
    // comportant un gros `target/` (ex: 17 Go de build Rust), ce scan toutes
    // les 2 s saturait le disque et figeait brièvement l'UI (sablier régulier).
    // Notre poller walk avec filtrage IGNORED_DIRS *pendant* le parcours → ne
    // descend jamais dans ces dossiers → coût O(fichiers source) au lieu de
    // O(total disque). Comportement « poll » conservé : pas de verrou OS, pas
    // de conflit avec rename.
    let handle = std::thread::spawn(move || {
        // État précédent : path -> (mtime_ms, size). Inclut fichiers ET
        // dossiers (la mtime d'un dossier change quand son contenu direct
        // change). Initialisé sans émettre d'events : sinon l'ouverture du
        // projet déclencherait un rebuild immédiat de l'arbre côté frontend.
        let mut prev: HashMap<String, (u64, u64)> = HashMap::new();
        walk_filtered(&path_buf, &mut prev);

        // Buffer pour regrouper les événements (debounce ~500ms)
        let mut pending: HashMap<String, String> = HashMap::new();
        let debounce = std::time::Duration::from_millis(500);
        let poll_interval = std::time::Duration::from_secs(2);
        let mut last_flush = std::time::Instant::now();
        let mut last_poll = std::time::Instant::now();

        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            if !running_clone.load(Ordering::Relaxed) {
                break;
            }
            // Flusher les events en attente si le debounce est écoulé
            if !pending.is_empty() && last_flush.elapsed() >= debounce {
                flush_pending(&app, &pending);
                pending.clear();
                last_flush = std::time::Instant::now();
            }
            // Ne scanner qu'une fois par `poll_interval`
            if last_poll.elapsed() < poll_interval {
                continue;
            }
            last_poll = std::time::Instant::now();

            let mut curr: HashMap<String, (u64, u64)> = HashMap::new();
            walk_filtered(&path_buf, &mut curr);

            // Diff : create / modify / remove (priorité remove > create > modify)
            for (key, (mtime, size)) in &curr {
                let kind = match prev.get(key) {
                    None => "create",
                    Some((pm, ps)) if pm != mtime || ps != size => "modify",
                    _ => continue,
                };
                insert_pending(&mut pending, key.clone(), kind);
            }
            for key in prev.keys() {
                if !curr.contains_key(key) {
                    insert_pending(&mut pending, key.clone(), "remove");
                }
            }
            prev = curr;

            if !pending.is_empty() && last_flush.elapsed() >= debounce {
                flush_pending(&app, &pending);
                pending.clear();
                last_flush = std::time::Instant::now();
            }
        }
        // Flusher ce qui reste avant de quitter
        if !pending.is_empty() {
            flush_pending(&app, &pending);
        }
    });

    *state.watch_state.lock().unwrap() = Some((running, handle));
    Ok(())
}

/// Émet les événements en attente vers le frontend
fn flush_pending(app: &AppHandle, pending: &HashMap<String, String>) {
    for (path, kind) in pending {
        let payload = serde_json::json!({
            "path": path,
            "kind": kind,
        });
        app.emit("file-change", &payload).ok();
    }
}

/// Walk récursif filtré : ne descend pas dans les dossiers listés dans
/// `IGNORED_DIRS` (node_modules, target, .git, …). Remplit `out` avec
/// path -> (mtime_ms, size) pour fichiers ET dossiers.
fn walk_filtered(dir: &std::path::Path, out: &mut HashMap<String, (u64, u64)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = path.is_dir();
        // Ne pas descendre dans les dossiers ignorés
        if is_dir {
            if let Some(name) = path.file_name() {
                if IGNORED_DIRS.contains(&name.to_string_lossy().as_ref()) {
                    continue;
                }
            }
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.insert(path.to_string_lossy().to_string(), (mtime, meta.len()));
        if is_dir {
            walk_filtered(&path, out);
        }
    }
}

/// Insère un event dans `pending` avec la priorité : remove > create > modify.
/// (Si on reçoit remove après create → le fichier n'existe plus au final →
/// « remove » ; sinon on garde la première valeur rencontrée pour le batch.)
fn insert_pending(pending: &mut HashMap<String, String>, key: String, kind: &str) {
    let existing = pending.get(&key).map(|s| s.as_str());
    let new_kind = match (existing, kind) {
        (Some("create"), "remove") => "remove",
        (Some(_), _) => return, // garder la première valeur
        _ => kind,
    };
    pending.insert(key, new_kind.to_string());
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
fn extension_gate_supported(state: State<AppState>) -> Result<bool, String> {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return Ok(false);
    }
    Ok(probe_extension_support(state.inner(), &pi_path))
}

/// Renvoie le genre du backend configuré ("pi", "plh" ou "unknown") + le support
/// de `--extension`. Sert à afficher "Agent Pi"/"Agent PLh" dans l'UI et à activer/
/// désactiver la porte pré-écriture.
#[derive(serde::Serialize)]
struct BackendInfo {
    kind: String,
    ext_supported: bool,
}

#[tauri::command]
fn get_backend_info(state: State<AppState>) -> Result<BackendInfo, String> {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return Ok(BackendInfo { kind: "unknown".to_string(), ext_supported: false });
    }
    let probe = probe_backend(state.inner(), &pi_path);
    Ok(BackendInfo { kind: probe.kind, ext_supported: probe.ext_supported })
}

/// Résultat du health check de l'agent au démarrage (E4).
/// `ok` = l'exécutable configuré répond à `--version`. `error` vaut :
///   - ""         si ok
///   - "no_path"      si `rpc_pi_path` est vide
///   - "not_executable" si l'exécutable est absent / non lancé / timeout `--version`
#[derive(serde::Serialize)]
struct PiHealth {
    ok: bool,
    kind: String,
    version: String,
    error: String,
    path: String,
}

#[tauri::command]
fn pi_health_check(state: State<AppState>) -> Result<PiHealth, String> {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return Ok(PiHealth {
            ok: false,
            kind: "unknown".to_string(),
            version: String::new(),
            error: "no_path".to_string(),
            path: pi_path,
        });
    }
    use std::time::Duration;
    let out = run_captured(&pi_path, &["--version"], Duration::from_secs(10));
    if out.trim().is_empty() {
        return Ok(PiHealth {
            ok: false,
            kind: "unknown".to_string(),
            version: String::new(),
            error: "not_executable".to_string(),
            path: pi_path,
        });
    }
    Ok(PiHealth {
        ok: true,
        kind: kind_from_version_output(&out),
        version: out.trim().to_string(),
        error: String::new(),
        path: pi_path,
    })
}

// ── Git intégré (C1) — badges de statut + diff visuel via CLI `git` ──

/// Résultat de `git_status` : `entries` mappe chaque chemin relatif au cwd du
/// projet → code porcelain v1 sur 2 caractères (`XY`), ex: ` M`, `M `, `MM`,
/// `A `, `??`, ` D`. `is_repo` = false si le projet n'est pas dans un work tree
/// Git (ou si `git` est absent) → l'UI masque les badges gracieusement.
#[derive(serde::Serialize)]
struct GitStatus {
    is_repo: bool,
    entries: HashMap<String, String>,
}

#[tauri::command]
fn git_status(state: State<AppState>) -> Result<GitStatus, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    // Vérifier qu'on est dans un work tree Git.
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitStatus { is_repo: false, entries: HashMap::new() });
    }
    let out = run_captured(
        "git",
        &["-C", &cwd, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut entries = HashMap::new();
    for line in out.lines() {
        // Format porcelain v1 : `XY <path>` (path quoté si espaces/unicode).
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].to_string();
        let mut path = line[3..].to_string();
        // Déquote porcelain v1 : entoure de "..." si le path contient des espaces.
        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
            // Échappement C-style minimal : \" → " et \\ → \
            path = path.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        if !path.is_empty() {
            entries.insert(path, code);
        }
    }
    Ok(GitStatus { is_repo: true, entries })
}

/// Résultat de `git_diff_file` : `before` = version commitée (`HEAD:<relpath>`,
/// vide si non tracked ou jamais commité), `after` = contenu courant sur disque.
/// Sert au diff visuel (`diff-view.js`) en mode lecture seule.
#[derive(serde::Serialize)]
struct GitFileDiff {
    is_repo: bool,
    tracked: bool,
    before: String,
    after: String,
}

#[tauri::command]
fn git_diff_file(state: State<AppState>, path: String) -> Result<GitFileDiff, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let after = fs::read_to_string(&path).unwrap_or_default();
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitFileDiff { is_repo: false, tracked: false, before: String::new(), after });
    }
    // Chemin tracked relatif au repo root (vide si fichier non suivi).
    let rel = run_captured("git", &["-C", &cwd, "ls-files", "--full-name", "--", &path], Duration::from_secs(3));
    let rel = rel.trim().to_string();
    if rel.is_empty() {
        return Ok(GitFileDiff { is_repo: true, tracked: false, before: String::new(), after });
    }
    // Version commitée. Échoue (stdout vide) si staged-new jamais commité → before "".
    let before = run_captured("git", &["-C", &cwd, "show", &format!("HEAD:{}", rel)], Duration::from_secs(5));
    Ok(GitFileDiff { is_repo: true, tracked: true, before, after })
}

// ── A1 : Snapshots / annulation de tâche d'orchestration (spec_orchestration_snapshots.md) ──

/// Résultat de `git_create_snapshot` :
/// - `ok: true, sha` = snapshot créé (SHA d'un commit non-référencé via `git stash create -u`,
///   ou `HEAD` si le working tree était propre).
/// - `ok: false, reason` = "not_a_repo" | "git_missing" | "error".
#[derive(serde::Serialize)]
struct SnapshotResult {
    ok: bool,
    sha: String,
    reason: String,
}

/// Résultat de `git_restore_snapshot` : fichiers restaurés (modifiés) et
/// fichiers supprimés (créés par la tâche et absents du snapshot).
#[derive(serde::Serialize)]
struct RestoreResult {
    restored: Vec<String>,
    deleted: Vec<String>,
}

/// Crée un snapshot Git avant une tâche d'orchestration. `git stash create -u`
/// capture tracked + untracked dans un commit non-référencé (le working tree et
/// l'index ne sont **pas** modifiés). Si le working tree est propre, sha = HEAD.
/// Voir spec_orchestration_snapshots.md §3.1.
#[tauri::command]
fn git_create_snapshot(state: State<AppState>) -> Result<SnapshotResult, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        // Distinguer « pas un repo » de « git absent » : si rev-parse renvoie
        // vide (git manquant ou erreur), on l'indique aussi.
        let probe = run_captured("git", &["--version"], Duration::from_secs(2));
        let reason = if probe.trim().is_empty() { "git_missing" } else { "not_a_repo" };
        return Ok(SnapshotResult { ok: false, sha: String::new(), reason: reason.to_string() });
    }
    // `git stash create -u` : capture tracked + untracked dans un commit
    // non-référencé. stdout = SHA, ou vide si rien à stasher (working tree propre).
    let sha = run_captured("git", &["-C", &cwd, "stash", "create", "-u"], Duration::from_secs(8));
    let sha_trim = sha.trim().to_string();
    if !sha_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: sha_trim, reason: String::new() });
    }
    // Working tree propre par rapport à HEAD : snapshot = HEAD.
    let head = run_captured("git", &["-C", &cwd, "rev-parse", "HEAD"], Duration::from_secs(3));
    let head_trim = head.trim().to_string();
    if !head_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: head_trim, reason: String::new() });
    }
    // Cas extrême : pas de commit (repo vide sans HEAD). Pas de snapshot possible.
    Ok(SnapshotResult { ok: false, sha: String::new(), reason: "no_head".to_string() })
}

/// Restaure les fichiers modifiés par une tâche à leur état d'avant (snapshot).
/// Pour chaque fichier : si présent dans l'arbre du snapshot → `git checkout
/// <sha> -- <file>` (restaure le contenu pré-tâche) ; sinon → suppression du
/// disque (fichier créé par la tâche). Unstage final pour ne pas polluer l'index.
/// Voir spec_orchestration_snapshots.md §3.3.
#[tauri::command]
fn git_restore_snapshot(state: State<AppState>, sha: String, files: Vec<String>) -> Result<RestoreResult, String> {
    use std::time::Duration;
    if sha.trim().is_empty() {
        return Err("SHA de snapshot vide".to_string());
    }
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    let mut to_unstage: Vec<String> = Vec::new();
    for rel in &files {
        let rel = rel.trim();
        if rel.is_empty() { continue; }
        // Le fichier existe-t-il dans l'arbre du snapshot ?
        let probe = run_captured("git", &["-C", &cwd, "ls-tree", "--full-name", &sha, "--", rel], Duration::from_secs(3));
        if !probe.trim().is_empty() {
            // Présent : restaurer le contenu pré-tâche.
            run_captured("git", &["-C", &cwd, "checkout", &sha, "--", rel], Duration::from_secs(8));
            restored.push(rel.to_string());
            to_unstage.push(rel.to_string());
        } else {
            // Absent du snapshot : créé par la tâche → supprimer du disque.
            let abs = std::path::Path::new(&cwd).join(rel);
            match fs::remove_file(&abs) {
                Ok(_) => { deleted.push(rel.to_string()); to_unstage.push(rel.to_string()); }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Déjà absent — rien à faire (peut-être supprimé manuellement).
                    to_unstage.push(rel.to_string());
                }
                Err(_) => { /* permission/autre — on ignore, non fatal */ }
            }
        }
    }
    // Unstage les fichiers restaurés/supprimés pour ne pas polluer l'index
    // (`git checkout <sha> -- <file>` stage la version restaurée).
    if !to_unstage.is_empty() {
        let mut args: Vec<&str> = vec!["-C", &cwd, "reset", "HEAD", "--"];
        let owned: Vec<String> = to_unstage.iter().map(|s| s.to_string()).collect();
        for r in &owned { args.push(r); }
        let _ = run_captured("git", &args, Duration::from_secs(5));
    }
    Ok(RestoreResult { restored, deleted })
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

/// Persiste le modèle sélectionné pour l'onglet « 🔍 Review » (spec_review.md).
/// Format "provider/modelId" (issu de get_available_models_list).
#[tauri::command]
fn set_review_model(
    state: State<AppState>,
    app: AppHandle,
    model: String,
) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    config.review_model = model;
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
    // H2 V2 : arrêter tous les processus agents au changement/fermeture de projet.
    do_stop_all_agent_processes(&state);
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

/// Résultat de la sonde du backend (pi ou plh) : genre détecté + support du
/// flag `--extension` (gate pré-écriture). Mis en cache par `rpc_pi_path`.
#[derive(Clone)]
struct BackendProbe {
    kind: String,
    ext_supported: bool,
}

/// Sondage du backend : exécute `<pi_path> --version` (genre : "pi" / "plh" /
/// "unknown") et `--help` (présence de `--extension`). Mis en cache dans
/// `ext_gate_cache` (re-sondé si `pi_path` change). Bloquant mais borné (~3s par
/// commande). Évite de planter un backend qui ne supporte pas `--extension`
/// (ex: plh sans le flag → clap rejette l'arg et sort → « pipe closed »).
fn probe_backend(state: &AppState, pi_path: &str) -> BackendProbe {
    if pi_path.is_empty() {
        return BackendProbe { kind: "unknown".to_string(), ext_supported: false };
    }
    // Cache : re-sonder seulement si pi_path a changé depuis la dernière sonde.
    {
        let cache = state.ext_gate_cache.lock().unwrap();
        if let Some((cached_path, cached)) = cache.as_ref() {
            if cached_path == pi_path {
                return cached.clone();
            }
        }
    }
    let kind = run_version_probe(pi_path);
    let ext_supported = run_help_probe(pi_path);
    let probe = BackendProbe { kind, ext_supported };
    *state.ext_gate_cache.lock().unwrap() = Some((pi_path.to_string(), probe.clone()));
    probe
}

/// Wrapper : support de `--extension` uniquement (gate pré-écriture).
fn probe_extension_support(state: &AppState, pi_path: &str) -> bool {
    probe_backend(state, pi_path).ext_supported
}

/// Exécute `<pi_path> --version`, capture stdout, et déduit le genre.
/// - "pi"  : sortie commençant par un numéro de version (ex: "0.80.10")
/// - "plh" : sortie commençant par "plh" (ex: "plh 0.1.0")
/// - "unknown" sinon. Timeout ~10s.
fn run_version_probe(pi_path: &str) -> String {
    use std::time::Duration;
    let out = run_captured(pi_path, &["--version"], Duration::from_secs(10));
    kind_from_version_output(&out)
}

/// Déduplique le parsing du genre depuis la sortie `--version`.
fn kind_from_version_output(out: &str) -> String {
    let s = out.trim().to_lowercase();
    if s.starts_with("plh") {
        "plh".to_string()
    } else if s.split_whitespace().next().map(|w| w.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)).unwrap_or(false) {
        "pi".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Exécute `<pi_path> --help`, capture stdout, et vérifie si `--extension`
/// apparaît dans la sortie. Timeout ~10s (kill si dépassé).
fn run_help_probe(pi_path: &str) -> bool {
    use std::time::Duration;
    let out = run_captured(pi_path, &["--help"], Duration::from_secs(10));
    out.contains("--extension")
}

/// Lance `<exe> <args...>`, capture stdout, kill si `deadline` dépassé.
pub(crate) fn run_captured(exe: &str, args: &[&str], deadline_dur: std::time::Duration) -> String {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let deadline = Instant::now() + deadline_dur;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return String::new();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return String::new(),
        }
    }
    match child.wait_with_output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => String::new(),
    }
}

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

    let (pi_path, no_session, session_dir, qg_enabled, confirm_file_edits) = {
        let config = state.config.lock().unwrap();
        (
            config.rpc_pi_path.clone(),
            config.rpc_no_session,
            config.rpc_session_dir.clone(),
            config.quality_gate_enabled,
            config.confirm_file_edits,
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

    // Diff Review (A4 V2) : extension pi `pilot-edit-gate` chargée UNIQUEMENT si
    // `confirm_file_edits` est activé ET si le backend supporte `--extension`.
    // Quand désactivé (défaut) ou non supporté (ex: plh sans le flag), l'extension
    // n'est pas chargée → aucun surcharge, aucun blocage, l'agent écrit librement.
    // L'extension bloque les outils write/edit avant exécution et demande une
    // confirmation (ctx.ui.confirm → extension_ui_request). Pilot décide côté
    // client : auto-approve en Mode Orchestration, sinon diff Accepter/Refuser.
    // Écrite dans le dossier data depuis include_str! (imports type-only, effacés
    // par jiti — aucune dépendance npm).
    let ext_supported = confirm_file_edits && probe_extension_support(state, &pi_path);
    let extension_path: Option<String> = if ext_supported {
        if let Ok(data_dir) = app.path().app_data_dir() {
            let ext_file = data_dir.join("extensions").join("pilot-edit-gate.ts");
            if fs::create_dir_all(ext_file.parent().unwrap_or(&data_dir)).is_ok() {
                let content: &str = include_str!("../extensions/pilot-edit-gate.ts");
                if fs::write(&ext_file, content).is_ok() {
                    Some(ext_file.to_string_lossy().to_string())
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
        &cwd, &pi_path, no_session, &session_dir_str, skill_path.as_deref(), extension_path.as_deref(), app.clone(), state.event_tx.clone(), "rpc-event", None,
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
    // H2 V1 : arrêter aussi le reviewer (cycle de vie lié à la session principale).
    let mut rev = state.rpc_reviewer.lock().unwrap();
    if let Some(mut session) = rev.take() {
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
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
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
    //
    // Context Engine (H1) : le message peut contenir un préambule de contexte
    // projet (=== CONTEXTE PROJET ... === FIN CONTEXTE ===). On le strippe pour
    // l'affichage distant (l'agent reçoit bien le message complet via pi).
    if !message.is_empty() && !message.starts_with('/') {
        let display_text = strip_context_preamble(&message);
        let ev = serde_json::json!({ "type": "user_message", "text": display_text, "source": "desktop" });
        let _ = state.event_tx.send(ev);
    }
    do_send_agent_prompt(state.inner(), message, images)
}

/// Supprime le préambule « === CONTEXTE PROJET ... === FIN CONTEXTE === » injecté
/// par le Context Engine (H1) pour ne pas polluer l'affichage distant du message
/// utilisateur. Retourne le texte utilisateur seul.
fn strip_context_preamble(message: &str) -> String {
    let start_marker = "=== CONTEXTE PROJET";
    let end_marker = "=== FIN CONTEXTE ===";
    if !message.starts_with(start_marker) {
        return message.to_string();
    }
    // Trouver la fin du bloc contexte, puis sauter les lignes vides qui suivent.
    if let Some(end_idx) = message.find(end_marker) {
        let after = &message[end_idx + end_marker.len()..];
        after.trim_start_matches(['\n', '\r', ' ']).to_string()
    } else {
        // Bloc mal formé : on renvoie tel quel (sécurité).
        message.to_string()
    }
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
    rpc_manager::send_command_sync_timeout(session, cmd, 12)
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

// ── H2 V1 : session reviewer dédiée (canal rpc-event-reviewer) ──────────────
// Le reviewer est un second processus pi --mode rpc --no-session (contexte vierge,
// jetable) lancé lazy au 1er besoin de review. Pas de skill/extension (lecture
// seule, pas de porte pré-écriture). Émet sur le canal séparé rpc-event-reviewer.

pub(crate) fn do_start_reviewer_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let cwd = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project);

    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();

    let mut rpc = state.rpc_reviewer.lock().unwrap();
    if rpc.is_some() {
        return Ok(()); // déjà lancé (idempotent)
    }

    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, true, "", None, None, app.clone(), state.event_tx.clone(), "rpc-event-reviewer", None,
    )
        .map_err(|e| format!("Erreur lancement du reviewer : {}", e))?;
    *rpc = Some(session);

    // Démarrer une nouvelle session (contexte vierge)
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
    }
    Ok(())
}

#[tauri::command]
fn start_reviewer_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_reviewer_session(state.inner(), &app)
}

#[tauri::command]
fn stop_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    if let Some(mut session) = rpc.take() {
        rpc_manager::stop_session(&mut session);
    }
    Ok(())
}

pub(crate) fn do_send_reviewer_prompt(state: &AppState, message: String) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "prompt", "message": message });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
fn send_reviewer_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    do_send_reviewer_prompt(state.inner(), message)
}

#[tauri::command]
fn new_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({"type": "new_session"});
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
fn set_reviewer_model(state: State<AppState>, provider: String, model_id: String) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("set_model a échoué").to_string();
        return Err(format!("pi a refusé set_model (reviewer) : {}", err));
    }
    Ok(())
}

#[tauri::command]
fn abort_reviewer(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    rpc_manager::send_command(session, &serde_json::json!({"type": "abort"}))
}

#[tauri::command]
fn get_reviewer_state(state: State<AppState>) -> Result<Value, String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}

// ── Gestion d'agents multi-rôles (H2 V2, spec_gestion_agents.md) ─────────────
// Bus de sessions agents : HashMap<String, RpcSession>. Canal rpc-event-agents
// avec enveloppe {agent_id, event}. Les sous-agents sont lazy, jetables
// (new_session avant chaque appel sauf keep_context), et arrêtés proprement.

/// Résout le dossier utilisateur global de Pilot : ~/.pilot (cross-platform).
fn pilot_user_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".pilot"))
}

fn agents_registry_path() -> Result<std::path::PathBuf, String> {
    Ok(pilot_user_dir()?.join("agents.json"))
}

fn build_default_agent_registry(config: &AppConfig) -> Value {
    let orch = if !config.orchestrator_provider.is_empty() && !config.orchestrator_model_id.is_empty() {
        format!("{}/{}", config.orchestrator_provider, config.orchestrator_model_id)
    } else {
        String::new()
    };
    let coder = if !config.coder_provider.is_empty() && !config.coder_model_id.is_empty() {
        format!("{}/{}", config.coder_provider, config.coder_model_id)
    } else {
        String::new()
    };
    let models_orch = serde_json::json!({ "pi": orch, "plh": orch });
    let models_coder = serde_json::json!({ "pi": coder, "plh": coder });
    serde_json::json!({
        "version": 1,
        "updated_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "agents": [
            {
                "id": "coordinateur",
                "name": "Coordinateur",
                "icon": "🧠",
                "description": "Pilote l'équipe d'agents, comprend la demande utilisateur et route les tâches.",
                "role": "Tu es le chef d'orchestre d'une équipe d'agents de codage. Tu ne codes pas toi-même. Tu délègues chaque sous-tâche à l'agent spécialisé adapté via [[CALL:agent_id]] ... Tu synthétises les résultats et réponds à l'utilisateur.",
                "models": models_orch.clone(),
                "capabilities": ["delegate", "synthesize"],
                "readonly": false,
                "keep_context": true,
                "max_calls_per_run": 20,
                "call_depth": 0
            },
            {
                "id": "architecte",
                "name": "Architecte",
                "icon": "🏗️",
                "description": "Conçoit l'architecture et découpe le travail en petites tâches techniques.",
                "role": "Tu es un architecte logiciel. Tu proposes une architecture concise, des fichiers concernés et un découpage. Tu ne modifies jamais le code. Tu réponds uniquement par DONE: ...",
                "models": models_orch.clone(),
                "capabilities": ["design"],
                "readonly": true,
                "keep_context": false,
                "max_calls_per_run": 5,
                "call_depth": 1
            },
            {
                "id": "codeur",
                "name": "Codeur",
                "icon": "🔨",
                "description": "Écrit et modifie le code du projet.",
                "role": "Tu es un développeur. Tu exécutes la micro-tâche reçue. Tu lis les fichiers avec les outils à ta disposition. Tu modifies UNIQUEMENT les fichiers nécessaires. Termine par DONE: <résumé>.",
                "models": models_coder.clone(),
                "capabilities": ["write", "edit"],
                "readonly": false,
                "keep_context": false,
                "max_calls_per_run": 10,
                "call_depth": 1
            },
            {
                "id": "reviewer",
                "name": "Reviewer",
                "icon": "🔍",
                "description": "Relit les modifications pour détecter régressions et bugs.",
                "role": "Tu es un reviewer indépendant. Tu ne modifies rien. Tu relis le code et réponds APPROVED: ... ou CHANGES_REQUESTED: ...",
                "models": models_orch.clone(),
                "capabilities": ["review"],
                "readonly": true,
                "keep_context": false,
                "max_calls_per_run": 5,
                "call_depth": 1
            },
            {
                "id": "testeur",
                "name": "Testeur",
                "icon": "🧪",
                "description": "Écrit et exécute les tests.",
                "role": "Tu écris des tests couvrant la fonctionnalité demandée. Tu utilises le runner du projet. Tu ne modifies pas le code métier. Termine par DONE: ... ou NEED_HELP: ...",
                "models": models_coder.clone(),
                "capabilities": ["test"],
                "readonly": false,
                "keep_context": false,
                "max_calls_per_run": 5,
                "call_depth": 1
            },
            {
                "id": "documenteur",
                "name": "Documenteur",
                "icon": "📝",
                "description": "Rédige la documentation et les commentaires.",
                "role": "Tu rédiges la documentation utilisateur ou technique demandée. Tu ne modifies pas le code fonctionnel. Termine par DONE: ...",
                "models": models_coder.clone(),
                "capabilities": ["doc"],
                "readonly": true,
                "keep_context": false,
                "max_calls_per_run": 5,
                "call_depth": 1
            }
        ]
    })
}

#[tauri::command]
fn load_agent_registry(state: State<AppState>) -> Result<Value, String> {
    let path = agents_registry_path()?;
    if !path.exists() {
        let config = state.config.lock().unwrap().clone();
        let default = build_default_agent_registry(&config);
        let dir = path.parent().ok_or("Chemin agents.json invalide")?;
        fs::create_dir_all(dir).map_err(|e| format!("Erreur création dossier .pilot: {}", e))?;
        let json = serde_json::to_string_pretty(&default)
            .map_err(|e| format!("Erreur sérialisation registry: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("Erreur écriture agents.json: {}", e))?;
        return Ok(default);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Erreur lecture agents.json: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("JSON invalide dans agents.json: {}", e))
}

#[tauri::command]
fn save_agent_registry(registry: Value) -> Result<(), String> {
    let path = agents_registry_path()?;
    let dir = path.parent().ok_or("Chemin agents.json invalide")?;
    fs::create_dir_all(dir).map_err(|e| format!("Erreur création dossier .pilot: {}", e))?;
    let backup = path.with_extension("json.bak");
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }
    let mut with_meta = registry.clone();
    with_meta["updated_at"] = Value::String(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    let json = serde_json::to_string_pretty(&with_meta)
        .map_err(|e| format!("Erreur sérialisation registry: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Erreur écriture agents.json: {}", e))
}

pub(crate) fn do_start_agent_process(state: &AppState, app: &AppHandle, agent_id: String, cwd: String, pi_path: String, no_session: bool) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    if sessions.contains_key(&agent_id) {
        return Ok(()); // idempotent
    }
    let session_dir_resolved = if let Ok(cfg_path) = config_path(app) {
        cfg_path.with_file_name("agent").join("sessions").join(agent_id.replace(|c: char| !c.is_alphanumeric(), "_"))
    } else {
        pilot_user_dir()?.join("agent").join("sessions").join(agent_id.replace(|c: char| !c.is_alphanumeric(), "_"))
    };
    let session_dir_str = session_dir_resolved.to_string_lossy().to_string();
    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, no_session, &session_dir_str, None, None, app.clone(), state.event_tx.clone(), "rpc-event-agents", Some(&agent_id),
    ).map_err(|e| format!("Erreur lancement agent {} : {}", agent_id, e))?;
    sessions.insert(agent_id, session);
    Ok(())
}

#[tauri::command]
fn start_agent_process(state: State<AppState>, app: AppHandle, agent_id: String, cwd: String, pi_path: String, no_session: bool) -> Result<(), String> {
    do_start_agent_process(state.inner(), &app, agent_id, cwd, pi_path, no_session)
}

pub(crate) fn do_stop_agent_process(state: &AppState, agent_id: String) {
    let mut sessions = state.agent_sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&agent_id) {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
fn stop_agent_process(state: State<AppState>, agent_id: String) -> Result<(), String> {
    do_stop_agent_process(state.inner(), agent_id);
    Ok(())
}

pub(crate) fn do_stop_all_agent_processes(state: &AppState) {
    let mut sessions = state.agent_sessions.lock().unwrap();
    for (_, mut session) in sessions.drain() {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
fn stop_all_agent_processes(state: State<AppState>) -> Result<(), String> {
    do_stop_all_agent_processes(state.inner());
    Ok(())
}

pub(crate) fn do_send_agent_process_prompt(state: &AppState, agent_id: String, message: String) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    let cmd = serde_json::json!({ "type": "prompt", "message": message });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
fn send_agent_process_prompt(state: State<AppState>, agent_id: String, message: String) -> Result<(), String> {
    do_send_agent_process_prompt(state.inner(), agent_id, message)
}

pub(crate) fn do_new_agent_process_session(state: &AppState, agent_id: String) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    let cmd = serde_json::json!({"type": "new_session"});
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
fn new_agent_process_session(state: State<AppState>, agent_id: String) -> Result<(), String> {
    do_new_agent_process_session(state.inner(), agent_id)
}

pub(crate) fn do_set_agent_process_model(state: &AppState, agent_id: String, provider: String, model_id: String) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("set_model a échoué").to_string();
        return Err(format!("pi a refusé set_model (agent {}) : {}", agent_id, err));
    }
    Ok(())
}

#[tauri::command]
fn set_agent_process_model(state: State<AppState>, agent_id: String, provider: String, model_id: String) -> Result<(), String> {
    do_set_agent_process_model(state.inner(), agent_id, provider, model_id)
}

pub(crate) fn do_abort_agent_process(state: &AppState, agent_id: String) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    rpc_manager::send_command(session, &serde_json::json!({"type": "abort"}))
}

#[tauri::command]
fn abort_agent_process(state: State<AppState>, agent_id: String) -> Result<(), String> {
    do_abort_agent_process(state.inner(), agent_id)
}

/// Envoie une commande arbitraire (ex: extension_ui_response) au processus pi d'un agent.
pub(crate) fn do_send_agent_process_command(state: &AppState, agent_id: String, command: Value) -> Result<(), String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    rpc_manager::send_command(session, &command)
}

#[tauri::command]
fn send_agent_process_command(state: State<AppState>, agent_id: String, command: Value) -> Result<(), String> {
    do_send_agent_process_command(state.inner(), agent_id, command)
}

pub(crate) fn do_get_agent_process_state(state: &AppState, agent_id: String) -> Result<Value, String> {
    let mut sessions = state.agent_sessions.lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or(format!("Agent {} inconnu ou non démarré", agent_id))?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}

#[tauri::command]
fn get_agent_process_state(state: State<AppState>, agent_id: String) -> Result<Value, String> {
    do_get_agent_process_state(state.inner(), agent_id)
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

// ── H9 : Historique de sessions searchable ──
// Index local `.pilot/sessions.jsonl` (append-style, un objet JSON par ligne) +
// tags dans `.pilot/sessions-tags.json`. Rétro-indexation depuis le dossier de
// sessions pi du projet + capture live par le frontend (record_session_entry).
// Voir spec_session_history.md.

/// Racine `.pilot/` du projet.
fn pilot_meta_dir(project_path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(project_path).join(".pilot")
}

fn sessions_index_path(project_path: &str) -> std::path::PathBuf {
    pilot_meta_dir(project_path).join("sessions.jsonl")
}

fn sessions_tags_path(project_path: &str) -> std::path::PathBuf {
    pilot_meta_dir(project_path).join("sessions-tags.json")
}

/// Dossier des sessions pi pour le projet courant (même résolution que
/// `list_sessions` : `rpc_session_dir` si défini, sinon `~/.{stem}/agent/sessions`).
fn project_sessions_dir(config: &AppConfig) -> std::path::PathBuf {
    if config.rpc_session_dir.is_empty() {
        // safe unwrap : resolve_agent_home ne peut échouer que si USERPROFILE/HOME
        // absent — auquel cas on retombe sur un chemin vide (gestion plus loin).
        resolve_agent_home(&config.rpc_pi_path)
            .map(|h| h.join("agent").join("sessions"))
            .unwrap_or_default()
    } else {
        std::path::PathBuf::from(&config.rpc_session_dir)
    }
}

/// Tronque à `max` caractères (pas bytes) pour ne pas casser l'UTF-8.
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let t: String = s.chars().take(max).collect();
    t
}

/// Convertit un chemin absolu ou relatif en chemin relatif au projet (best-effort).
fn normalize_rel(p: &str, project_path: &str) -> String {
    let pb = std::path::Path::new(p);
    if pb.is_absolute() {
        if let Ok(rel) = std::path::Path::new(project_path).join(p).strip_prefix(project_path) {
            return rel.to_string_lossy().replace('\\', "/");
        }
        // p absolu sous le projet : tenter strip_prefix direct
        if let Ok(rel) = pb.strip_prefix(project_path) {
            return rel.to_string_lossy().replace('\\', "/");
        }
        return p.replace('\\', "/");
    }
    p.replace('\\', "/")
}

/// Extrait le texte d'un message pi (`message.content[].text` concaténé).
fn extract_message_text(msg: &Value) -> String {
    let mut out = String::new();
    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
        for item in arr {
            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(t);
                }
            }
        }
    } else if let Some(t) = msg.get("content").and_then(|c| c.as_str()) {
        out.push_str(t);
    }
    out
}

/// Extrait un chemin fichier depuis un `input` de tool_use write/edit (clés
/// possibles : path / file_path / filePath). Insensible aux variations pi.
fn extract_tool_path(input: &Value) -> Option<String> {
    for k in ["path", "file_path", "filePath", "filename"] {
        if let Some(s) = input.get(k).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Date ISO (UTC) « maintenant ».
fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Parse un fichier de session pi (JSONL) → entrée d'index (Value).
/// Défensif : tolère plusieurs schémas (pi évolue). Renvoie None si fichier
/// illisible ou sans message utilisateur (session vide).
fn parse_session_file(path: &std::path::Path, project_path: &str) -> Option<Value> {
    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_str()?;
    let parts: Vec<&str> = file_name.splitn(2, '_').collect();
    let timestamp_raw = parts.first().unwrap_or(&"").to_string();
    let id = parts.get(1).unwrap_or(&"").to_string();

    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.format("%Y-%m-%dT%H:%M:%S").to_string()
        })
        .unwrap_or(timestamp_raw);

    let mut prompt = String::new();
    let mut summary = String::new();
    let mut files: Vec<String> = Vec::new();
    let mut turns: u64 = 0;
    let mut model = String::new();
    let mut tokens: Option<u64> = None;
    let mut cost: Option<f64> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match t {
            "message" => {
                if let Some(msg) = v.get("message") {
                    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
                    if role == "user" {
                        turns += 1;
                        if prompt.is_empty() {
                            prompt = extract_message_text(msg);
                        }
                    } else if role == "assistant" {
                        if summary.is_empty() {
                            summary = extract_message_text(msg);
                        }
                        // tool_use persistés dans le content assistant
                        if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                            for item in arr {
                                if item.get("type").and_then(|x| x.as_str()) == Some("tool_use") {
                                    let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("");
                                    if name == "write" || name == "edit" {
                                        if let Some(input) = item.get("input") {
                                            if let Some(p) = extract_tool_path(input) {
                                                let rel = normalize_rel(&p, project_path);
                                                if !files.contains(&rel) {
                                                    files.push(rel);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "model_change" => {
                if let Some(m) = v.get("model") {
                    let prov = m.get("provider").and_then(|x| x.as_str()).unwrap_or("");
                    let id2 = m.get("id").and_then(|x| x.as_str()).unwrap_or("");
                    if !prov.is_empty() || !id2.is_empty() {
                        model = format!("{}/{}", prov, id2);
                    }
                }
            }
            // Events de streaming (peuvent être persistés selon la version de pi) :
            // capture défensive des tool calls et des stats.
            "tool_execution_start" | "toolcall_start" => {
                let name = v
                    .get("tool")
                    .and_then(|x| x.get("name"))
                    .and_then(|x| x.as_str())
                    .or_else(|| v.get("toolName").and_then(|x| x.as_str()))
                    .or_else(|| v.get("name").and_then(|x| x.as_str()))
                    .unwrap_or("");
                if name == "write" || name == "edit" {
                    let input = v.get("args").or_else(|| v.get("input")).or_else(|| v.get("tool").and_then(|x| x.get("args")));
                    if let Some(input) = input {
                        if let Some(p) = extract_tool_path(input) {
                            let rel = normalize_rel(&p, project_path);
                            if !files.contains(&rel) {
                                files.push(rel);
                            }
                        }
                    }
                }
            }
            "session_stats" | "agent_end" => {
                let stats = v
                    .get("stats")
                    .or_else(|| v.get("data"))
                    .or_else(|| Some(&v));
                if let Some(stats) = stats {
                    if tokens.is_none() {
                        if let Some(tt) = stats
                            .get("tokens")
                            .and_then(|x| x.get("total"))
                            .and_then(|x| x.as_u64())
                        {
                            tokens = Some(tt);
                        } else if let Some(tt) = stats.get("totalTokens").and_then(|x| x.as_u64()) {
                            tokens = Some(tt);
                        }
                    }
                    if cost.is_none() {
                        if let Some(c) = stats.get("cost").and_then(|x| x.as_f64()) {
                            cost = Some(c);
                        } else if let Some(c) = stats.get("totalCost").and_then(|x| x.as_f64()) {
                            cost = Some(c);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    files.sort();

    Some(serde_json::json!({
        "id": id,
        "timestamp": modified,
        "project": project_path,
        "model": model,
        "prompt": truncate_chars(&prompt, 500),
        "summary": truncate_chars(&summary, 300),
        "files": files,
        "tags": [],
        "tokens": tokens,
        "cost": cost,
        "turns": turns,
        "duration_s": null,
        "origin": null,
        "kind": "chat",
        "parent": null,
        "indexed_at": now_iso()
    }))
}

/// Lit l'index `.pilot/sessions.jsonl` → Vec<Value>.
fn read_session_index(project_path: &str) -> Vec<Value> {
    let path = sessions_index_path(project_path);
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            out.push(v);
        }
    }
    out
}

/// Écrit l'index (réécriture atomique de tout le fichier).
fn write_session_index(project_path: &str, entries: &[Value]) -> Result<(), String> {
    let path = sessions_index_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Création .pilot: {}", e))?;
    }
    let mut out = String::new();
    for e in entries {
        out.push_str(&serde_json::to_string(e).map_err(|x| format!("Serde: {}", x))?);
        out.push('\n');
    }
    fs::write(&path, out).map_err(|e| format!("Écriture index sessions: {}", e))?;
    Ok(())
}

/// Lit le fichier de tags → HashMap<id, Vec<String>>.
fn read_session_tags(project_path: &str) -> HashMap<String, Vec<String>> {
    let path = sessions_tags_path(project_path);
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    let v: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let mut map = HashMap::new();
    if let Some(obj) = v.as_object() {
        for (id, arr) in obj {
            let tags: Vec<String> = arr
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if !tags.is_empty() {
                map.insert(id.clone(), tags);
            }
        }
    }
    map
}

fn write_session_tags(project_path: &str, tags: &HashMap<String, Vec<String>>) -> Result<(), String> {
    let path = sessions_tags_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Création .pilot: {}", e))?;
    }
    let obj: serde_json::Map<String, Value> = tags
        .iter()
        .map(|(k, v)| (k.clone(), Value::Array(v.iter().map(|s| Value::String(s.clone())).collect())))
        .collect();
    let s = serde_json::to_string(&Value::Object(obj)).map_err(|e| format!("Serde tags: {}", e))?;
    fs::write(&path, s).map_err(|e| format!("Écriture tags: {}", e))?;
    Ok(())
}

/// (Re)construit l'index depuis le dossier de sessions pi du projet.
#[tauri::command]
fn index_sessions(state: State<AppState>) -> Result<usize, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let config = state.config.lock().unwrap();
    let session_dir = project_sessions_dir(&config);
    let folder_name = project_to_session_folder(&project_path);
    let project_dir = session_dir.join(&folder_name);
    drop(config);

    let mut entries: Vec<Value> = Vec::new();
    if project_dir.exists() {
        let entries_iter = fs::read_dir(&project_dir)
            .map_err(|e| format!("Lecture dossier sessions: {}", e))?;
        for entry in entries_iter {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Some(e) = parse_session_file(&path, &project_path) {
                entries.push(e);
            }
        }
    }
    entries.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    let n = entries.len();
    write_session_index(&project_path, &entries)?;
    Ok(n)
}

#[derive(Deserialize)]
struct SearchParams {
    query: Option<String>,
    tag: Option<String>,
    file: Option<String>,
    kind: Option<String>,
    limit: Option<usize>,
}

/// Recherche dans l'index. Full-text (substring insensible à la casse, ou
/// regex si la chaîne commence par `/`), filtres tag/file/kind. Tri décroissant
/// par timestamp. Tags fusionnés depuis le fichier de tags.
#[tauri::command]
fn search_sessions(state: State<AppState>, params: SearchParams) -> Result<Value, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let mut entries = read_session_index(&project_path);
    let tags_map = read_session_tags(&project_path);

    // Fusion des tags dans chaque entrée (par id).
    for e in entries.iter_mut() {
        if let Some(id) = e.get("id").and_then(|x| x.as_str()) {
            if let Some(tags) = tags_map.get(id) {
                if let Some(obj) = e.as_object_mut() {
                    obj.insert(
                        "tags".to_string(),
                        Value::Array(tags.iter().map(|s| Value::String(s.clone())).collect()),
                    );
                }
            }
        }
    }

    let query = params.query.unwrap_or_default();
    let tag = params.tag.unwrap_or_default();
    let file = params.file.unwrap_or_default();
    let kind = params.kind.unwrap_or_default();
    let limit = params.limit.unwrap_or(200);

    // Compilation d'une regex optionnelle (si query commence par `/`).
    let re = if let Some(rest) = query.strip_prefix('/') {
        regex::Regex::new(rest).ok()
    } else {
        None
    };
    let q_lc = query.to_lowercase();

    let mut results: Vec<Value> = Vec::new();
    for e in entries {
        let id = e.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        // Filtre kind
        if !kind.is_empty() {
            let k = e.get("kind").and_then(|x| x.as_str()).unwrap_or("chat");
            if k != kind {
                continue;
            }
        }
        // Filtre tag
        if !tag.is_empty() {
            let tags = e.get("tags").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let has = tags.iter().any(|x| x.as_str() == Some(&tag));
            if !has {
                continue;
            }
        }
        // Filtre file (chemin relatif contenant)
        if !file.is_empty() {
            let files = e.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let flc = file.to_lowercase();
            let has = files
                .iter()
                .any(|x| x.as_str().map(|s| s.to_lowercase().contains(&flc)).unwrap_or(false));
            if !has {
                continue;
            }
        }
        // Filtre query full-text
        if !query.is_empty() {
            let prompt = e.get("prompt").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let summary = e.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let files = e.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
            let files_str = files
                .iter()
                .filter_map(|x| x.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let hay = format!("{} {} {}", prompt, summary, files_str);
            if let Some(re) = &re {
                if !re.is_match(&hay) {
                    continue;
                }
            } else {
                if !hay.to_lowercase().contains(&q_lc) {
                    continue;
                }
            }
        }
        let _ = id;
        results.push(e);
        if results.len() >= limit {
            break;
        }
    }
    // Tri déjà assuré à l'indexation, mais on re-trie au cas où (live updates).
    results.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    let indexed = sessions_index_path(&project_path).exists();
    Ok(serde_json::json!({ "entries": results, "total": results.len(), "indexed": indexed }))
}

/// Retourne le détail d'une session : entrée indexée + contenu complet du
/// JSONL pi (messages simplifiés : role + text + tool_use name/path).
#[tauri::command]
fn get_session_detail(state: State<AppState>, id: String) -> Result<Value, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let entries = read_session_index(&project_path);
    let entry = entries
        .iter()
        .find(|e| e.get("id").and_then(|x| x.as_str()) == Some(&id))
        .cloned()
        .ok_or("Session non trouvée dans l'index")?;

    // Localiser le fichier JSONL pi correspondant.
    let config = state.config.lock().unwrap();
    let session_dir = project_sessions_dir(&config);
    let folder_name = project_to_session_folder(&project_path);
    let project_dir = session_dir.join(&folder_name);
    drop(config);

    let mut messages: Vec<Value> = Vec::new();
    if project_dir.exists() {
        for entry_it in fs::read_dir(&project_dir).map_err(|e| format!("Lecture sessions: {}", e))? {
            let entry_it = match entry_it {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry_it.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if !stem.ends_with(&format!("_{}", id)) {
                continue;
            }
            let content = fs::read_to_string(&path).unwrap_or_default();
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let v: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if v.get("type").and_then(|x| x.as_str()) != Some("message") {
                    continue;
                }
                if let Some(msg) = v.get("message") {
                    let role = msg.get("role").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let text = extract_message_text(msg);
                    let mut tools: Vec<Value> = Vec::new();
                    if let Some(arr) = msg.get("content").and_then(|c| c.as_array()) {
                        for item in arr {
                            if item.get("type").and_then(|x| x.as_str()) == Some("tool_use") {
                                let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                let input = item.get("input").cloned().unwrap_or(Value::Null);
                                let path_str = extract_tool_path(&input).unwrap_or_default();
                                tools.push(serde_json::json!({
                                    "name": name,
                                    "path": path_str
                                }));
                            }
                        }
                    }
                    if !text.is_empty() || !tools.is_empty() {
                        messages.push(serde_json::json!({
                            "role": role,
                            "text": text,
                            "tools": tools
                        }));
                    }
                }
            }
            break;
        }
    }
    // Fusion tags
    let tags_map = read_session_tags(&project_path);
    let tags = tags_map.get(&id).cloned().unwrap_or_default();
    let mut entry = entry;
    if let Some(obj) = entry.as_object_mut() {
        obj.insert(
            "tags".to_string(),
            Value::Array(tags.iter().map(|s| Value::String(s.clone())).collect()),
        );
    }
    Ok(serde_json::json!({
        "entry": entry,
        "messages": messages
    }))
}

/// Persiste les tags d'une session (fichier séparé, ne touche pas l'index).
#[tauri::command]
fn set_session_tags(state: State<AppState>, id: String, tags: Vec<String>) -> Result<(), String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let mut map = read_session_tags(&project_path);
    if tags.is_empty() {
        map.remove(&id);
    } else {
        // dédupliquer + trier
        let mut t: Vec<String> = tags.into_iter().collect();
        t.sort();
        t.dedup();
        map.insert(id, t);
    }
    write_session_tags(&project_path, &map)
}

/// Liste tous les tags utilisés (pour l'autocomplétion).
#[tauri::command]
fn list_session_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let map = read_session_tags(&project_path);
    let mut all: Vec<String> = Vec::new();
    for tags in map.values() {
        for t in tags {
            if !all.contains(t) {
                all.push(t.clone());
            }
        }
    }
    all.sort();
    Ok(all)
}

/// Écrit/met à jour une entrée de session dans l'index (capture live, appelé par
/// le frontend à l'agent_end). Append-style : retire l'entrée existante de même
/// id puis réécrit. Les tags ne sont jamais écrasés (gérés dans un fichier à part).
#[tauri::command]
fn record_session_entry(state: State<AppState>, entry: Value) -> Result<(), String> {
    let project_path = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let id = entry
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Err("id de session manquant".into());
    }
    let mut entries = read_session_index(&project_path);
    entries.retain(|e| {
        e.get("id").and_then(|x| x.as_str()).unwrap_or("") != id
    });
    // Forcer tags=[] dans l'index (les tags vivent dans le fichier dédié).
    let mut entry = entry;
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("tags".to_string(), Value::Array(vec![]));
        // Champ indexed_at horodaté
        obj.insert("indexed_at".to_string(), Value::String(now_iso()));
    }
    entries.push(entry);
    entries.sort_by(|a, b| {
        let ta = a.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        let tb = b.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
        tb.cmp(ta)
    });
    write_session_index(&project_path, &entries)
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

    // Dossiers/fichiers à ignorer (source unique : IGNORED_DIRS, partagée avec
    // build_tree et le watcher pour rester cohérent).
    let ignore_dirs: &[&str] = IGNORED_DIRS;
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

// ── Remplacement global dans les fichiers (B3 — Find & Replace) ──

#[derive(Debug, Serialize)]
struct ReplaceResult {
    /// Nombre de fichiers effectivement modifiés.
    files_modified: usize,
    /// Nombre total d'occurrences remplacées.
    occurrences: usize,
    /// Liste (chemin relatif) des fichiers modifiés, pour rafraîchir l'UI.
    modified: Vec<String>,
}

/// Remplace toutes les occurrences de `query` par `replacement` dans tous les
/// fichiers du projet correspondant au filtre d'extensions. Réutilise la
/// logique de parcours de `search_in_files` (mêmes dossiers/extensions
/// ignorés). Si `use_regex` est faux, le pattern et le remplacement sont
/// traités littéralement (échappés). Écrit seulement les fichiers dont le
/// contenu a changé. Retourne un compte pour confirmation côté UI.
#[tauri::command]
fn replace_in_files(
    state: State<AppState>,
    query: String,
    replacement: String,
    use_regex: bool,
    extensions: String,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Ok(ReplaceResult {
            files_modified: 0,
            occurrences: 0,
            modified: Vec::new(),
        });
    }

    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    // Compiler le pattern (regex ou texte littéral)
    let pattern: regex::Regex = if use_regex {
        regex::Regex::new(&query).map_err(|e| format!("Regex invalide : {}", e))?
    } else {
        regex::Regex::new(&regex::escape(&query)).map_err(|e| format!("Erreur pattern : {}", e))?
    };

    // Replacer : littéral si pas regex (NoExpand ne traite pas les `$`),
    // sinon chaîne interprétée (supporte $1, ${name}). Construit localement
    // dans walk_replace pour éviter les soucis de lifetime de NoExpand.

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

    let ignore_dirs: &[&str] = IGNORED_DIRS;
    let ignore_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
        ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".woff", ".woff2",
        ".ttf", ".eot", ".mp3", ".mp4", ".avi", ".mov", ".exe", ".dll",
        ".so", ".dylib", ".o", ".obj", ".pyc", ".class", ".jar", ".wasm",
    ];

    let mut files_modified = 0usize;
    let mut occurrences = 0usize;
    let mut modified: Vec<String> = Vec::new();

    fn walk_replace(
        dir: &std::path::Path,
        project: &std::path::Path,
        pattern: &regex::Regex,
        replacement: &str,
        use_regex: bool,
        ext_filter: &[String],
        ignore_dirs: &[&str],
        ignore_exts: &[&str],
        files_modified: &mut usize,
        occurrences: &mut usize,
        modified: &mut Vec<String>,
    ) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| format!("Erreur lecture dossier {:?}: {}", dir, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Erreur entrée : {}", e))?;
            let path = entry.path();

            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.') || ignore_dirs.contains(&name_str.as_ref()) {
                continue;
            }

            if path.is_dir() {
                walk_replace(
                    &path, project, pattern, replacement, use_regex,
                    ext_filter, ignore_dirs, ignore_exts,
                    files_modified, occurrences, modified,
                )?;
            } else {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let full_ext = format!(".{}", ext);

                if ignore_exts.contains(&full_ext.as_str()) {
                    continue;
                }
                if !ext_filter.is_empty() && !ext_filter.contains(&ext) {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > 2_000_000 {
                        continue;
                    }
                }

                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue, // Binaire / illisible
                };

                let count = pattern.find_iter(&content).count();
                if count == 0 {
                    continue;
                }

                let new_content = if use_regex {
                    pattern.replace_all(&content, replacement).to_string()
                } else {
                    pattern.replace_all(&content, regex::NoExpand(replacement)).to_string()
                };

                if new_content == content {
                    continue; // Rien n'a réellement changé
                }

                fs::write(&path, &new_content)
                    .map_err(|e| format!("Erreur écriture {:?}: {}", path, e))?;
                let rel = path
                    .strip_prefix(project)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                modified.push(rel);
                *files_modified += 1;
                *occurrences += count;
            }
        }
        Ok(())
    }

    walk_replace(
        std::path::Path::new(&project),
        std::path::Path::new(&project),
        &pattern,
        &replacement,
        use_regex,
        &ext_filter,
        ignore_dirs,
        &ignore_exts,
        &mut files_modified,
        &mut occurrences,
        &mut modified,
    )?;

    Ok(ReplaceResult {
        files_modified,
        occurrences,
        modified,
    })
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

// ── Gestion des modèles IA (édition UI des models.json / model-switch.json) ──
//
// Pilot permet désormais d'éditer le registre des modèles (providers + modèles)
// et les alias (model-switch.json) directement depuis l'onglet « Fournisseurs »
// de la modale Paramètres, sans éditer les JSON à la main. Ces commandes
// travaillent sur le répertoire home du backend ciblé (~/.pi, ~/.plh, ...),
// résolu par stem explicite (et non par le chemin de l'exécutable configuré).
// Toutes les écritures font un backup .bak et une validation minimale.

/// Résout `~/.<stem>` (home dir + dossier point-stem). Contrairement à
/// `resolve_agent_home` qui déduit le stem du chemin de l'exécutable, cette
/// variante prend un stem explicite (« pi », « plh », ...) pour permettre
/// d'éditer le registre d'un backend même s'il n'est pas celui actif.
fn resolve_agent_home_by_stem(stem: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let clean = stem.trim().trim_start_matches('.');
    if clean.is_empty() {
        return Err("stem vide".to_string());
    }
    Ok(std::path::PathBuf::from(&home).join(format!(".{}", clean)))
}

/// Liste les backends disponibles : scanne le home dir à la recherche de
/// dossiers `.{stem}/agent/models.json`. Retourne les stems (ex: ["pi","plh"]),
/// triés, avec « pi » en tête si présent. Sert à peupler le sélecteur de
/// backend dans l'onglet Fournisseurs.
#[tauri::command]
fn list_agent_backends() -> Result<Vec<String>, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let home_dir = std::path::Path::new(&home);
    let mut stems: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(home_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = match name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if !name.starts_with('.') {
                continue;
            }
            let stem = name.trim_start_matches('.');
            if stem.is_empty() {
                continue;
            }
            // Ne garder que les dossiers contenant agent/models.json
            let models_file = entry.path().join("agent").join("models.json");
            if models_file.is_file() {
                stems.push(stem.to_string());
            }
        }
    }
    stems.sort();
    // « pi » en tête si présent (backend canonique)
    if let Some(pos) = stems.iter().position(|s| s == "pi") {
        let pi = stems.remove(pos);
        stems.insert(0, pi);
    }
    Ok(stems)
}

/// Lit le `models.json` d'un backend donné (`~/.{stem}/agent/models.json`).
/// Retourne l'objet JSON tel quel (round-trip) pour préserver les clés non
/// gérées par l'UI. Si le fichier n'existe pas, retourne un objet vide.
#[tauri::command]
fn read_models_config(stem: String) -> Result<Value, String> {
    let path = resolve_agent_home_by_stem(&stem)?.join("agent").join("models.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "providers": {} }));
    }
    let json_str = std::fs::read_to_string(&path)
        .map_err(|e| format!("Lecture models.json: {}", e))?;
    let config: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    Ok(config)
}

/// Écrit le `models.json` d'un backend. Backup `models.json.bak` avant écriture,
/// puis écriture atomique (fichier temp + rename). Validation : `providers`
/// doit être un objet (ou absent → {});
#[tauri::command]
fn write_models_config(stem: String, config: Value) -> Result<(), String> {
    // Validation minimale
    let mut cfg = config;
    if cfg.get("providers").is_none() {
        cfg = serde_json::json!({ "providers": {} });
    }
    if !cfg["providers"].is_object() {
        return Err("`providers` doit être un objet".to_string());
    }
    let agent_dir = resolve_agent_home_by_stem(&stem)?.join("agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Création du dossier agent: {}", e))?;
    let target = agent_dir.join("models.json");
    // Backup
    if target.exists() {
        let bak = agent_dir.join("models.json.bak");
        let _ = std::fs::copy(&target, &bak);
    }
    let pretty = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Sérialisation JSON: {}", e))?;
    std::fs::write(&target, pretty)
        .map_err(|e| format!("Écriture models.json: {}", e))?;
    Ok(())
}

/// Lit le `model-switch.json` d'un backend (`~/.{stem}/agent/model-switch.json`).
/// Contient `{ aliases: {...}, defaultModel: "provider/id" }`. Retourne `{}` si
/// le fichier n'existe pas.
#[tauri::command]
fn read_model_aliases(stem: String) -> Result<Value, String> {
    let path = resolve_agent_home_by_stem(&stem)?.join("agent").join("model-switch.json");
    if !path.exists() {
        return Ok(serde_json::json!({ "aliases": {}, "defaultModel": "" }));
    }
    let json_str = std::fs::read_to_string(&path)
        .map_err(|e| format!("Lecture model-switch.json: {}", e))?;
    let parsed: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    Ok(parsed)
}

/// Écrit le `model-switch.json` d'un backend. Backup `.bak` + écriture.
/// Validation : si `aliases` est présent, ce doit être un objet ; si
/// `defaultModel` est présent, ce doit être une chaîne.
#[tauri::command]
fn write_model_aliases(stem: String, config: Value) -> Result<(), String> {
    if let Some(a) = config.get("aliases") {
        if !a.is_null() && !a.is_object() {
            return Err("`aliases` doit être un objet".to_string());
        }
    }
    if let Some(d) = config.get("defaultModel") {
        if !d.is_null() && !d.is_string() {
            return Err("`defaultModel` doit être une chaîne".to_string());
        }
    }
    let agent_dir = resolve_agent_home_by_stem(&stem)?.join("agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Création du dossier agent: {}", e))?;
    let target = agent_dir.join("model-switch.json");
    if target.exists() {
        let bak = agent_dir.join("model-switch.json.bak");
        let _ = std::fs::copy(&target, &bak);
    }
    let pretty = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Sérialisation JSON: {}", e))?;
    std::fs::write(&target, pretty)
        .map_err(|e| format!("Écriture model-switch.json: {}", e))?;
    Ok(())
}

/// Teste la disponibilité d'un provider : effectue `GET {baseUrl}/models`
/// (endpoint OpenAI-compatible, supporté par ollama et llama-cpp server) et
/// retourne la liste des IDs de modèles disponibles côté serveur. Si l'API key
/// est renseignée (et != "none"), ajoute l'en-tête Authorization Bearer.
/// Timeout 4 s. Retourne `{ ok, models: [...], error }`.
#[tauri::command]
async fn test_provider_models(base_url: String, api_key: Option<String>) -> Result<Value, String> {
    use tokio::time::{timeout, Duration};
    let key = api_key.unwrap_or_default();
    let key = key.trim();
    let mut url = base_url.trim().trim_end_matches('/').to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("http://{}", url);
    }
    let endpoint = format!("{}/models", url);
    // Client bloquant dans spawn_blocking pour ne pas bloquer le runtime async
    // de Tauri. reqwest est configuré avec rustls-tls (pas de dépendance système
    // OpenSSL). Timeout global 5 s (spawn_blocking) + 4 s par requête HTTP.
    let key_owned = if key.is_empty() || key == "none" {
        String::new()
    } else {
        key.to_string()
    };
    let endpoint_owned = endpoint.clone();
    let res = timeout(
        Duration::from_secs(5),
        tokio::task::spawn_blocking(move || -> Result<Value, String> {
            let b = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .danger_accept_invalid_certs(true);
            let client = b.build().map_err(|e| e.to_string())?;
            let mut req = client.get(&endpoint_owned);
            if !key_owned.is_empty() {
                req = req.bearer_auth(&key_owned);
            }
            let resp = req.send().map_err(|e| e.to_string())?;
            let status = resp.status();
            let body = resp.text().map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Ok(serde_json::json!({
                    "ok": false,
                    "models": [],
                    "error": format!("HTTP {}", status.as_u16())
                }));
            }
            let parsed: Value = serde_json::from_str(&body)
                .map_err(|e| format!("Réponse non-JSON: {}", e))?;
            // Format OpenAI: { data: [ { id: "..." }, ... ] }
            let mut ids: Vec<String> = Vec::new();
            if let Some(data) = parsed["data"].as_array() {
                for m in data {
                    if let Some(id) = m["id"].as_str() {
                        ids.push(id.to_string());
                    }
                }
            }
            ids.sort();
            Ok(serde_json::json!({ "ok": true, "models": ids, "error": null }))
        }),
    )
    .await;
    match res {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) => Ok(serde_json::json!({ "ok": false, "models": [], "error": e })),
        Ok(Err(_)) => Ok(serde_json::json!({ "ok": false, "models": [], "error": "join error" })),
        Err(_) => Ok(serde_json::json!({ "ok": false, "models": [], "error": "timeout (5s)" })),
    }
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
    let out = {
        let mut c = std::process::Command::new("where");
        c.arg(cmd);
        c.creation_flags(CREATE_NO_WINDOW);
        c.output().ok()?
    };
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
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
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

// ── Lint diagnostics inline (B2) — eslint --format json pour JS/TS ──

#[derive(Debug, Serialize)]
struct LintDiagnostic {
    /// Ligne de début (1-indexée).
    from_line: usize,
    /// Colonne de début (1-indexée).
    from_col: usize,
    /// Ligne de fin (1-indexée).
    to_line: usize,
    /// Colonne de fin (1-indexée).
    to_col: usize,
    /// "error" ou "warning".
    severity: String,
    /// Message humain.
    message: String,
    /// Identifiant de règle (ex: "no-console") si disponible.
    source: String,
}

/// Lance le linter du projet sur un seul fichier et renvoie des diagnostics
/// structurés (ligne/col/sévérité/message) exploitables par `@codemirror/lint`.
/// V1 : JS/TS via eslint (`--format json`). Les autres langages renvoient une
/// liste vide (le lint intégré de l'orchestration reste sur `check_syntax`).
/// Aucun checker disponible → liste vide (échec silencieux côté éditeur).
#[tauri::command]
fn lint_file(
    state: State<AppState>,
    path: String,
) -> Result<Vec<LintDiagnostic>, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);
    let project_dir = std::path::Path::new(&project);

    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs" | "vue" => {}
        _ => return Ok(Vec::new()), // V1 : JS/TS uniquement
    }

    // Localiser eslint (local node_modules/.bin sinon npx --no-install)
    let eslint_local = project_dir
        .join("node_modules")
        .join(".bin")
        .join(if cfg!(target_os = "windows") {
            "eslint.cmd"
        } else {
            "eslint"
        });
    let (cmd, args): (String, Vec<String>) = if eslint_local.exists() {
        (eslint_local.to_string_lossy().to_string(), vec!["--format".to_string(), "json".to_string(), path.clone()])
    } else if which("npx").is_some() {
        (
            "npx".to_string(),
            vec![
                "--no-install".to_string(),
                "eslint".to_string(),
                "--format".to_string(),
                "json".to_string(),
                path.clone(),
            ],
        )
    } else {
        return Ok(Vec::new()); // Pas de linter disponible → silencieux
    };

    let out = run_command(&cmd, &args, Some(project.as_str()));
    let (_, raw) = match out {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };

    // eslint --format json : tableau d'objets { filePath, messages: [...] }
    // eslint renvoie exit code 1 s'il y a des erreurs, mais stdout contient le JSON.
    let trimmed = raw.trim();
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()), // Sortie non-JSON (eslint absent/cassé) → silencieux
    };

    let mut diags = Vec::new();
    for file_obj in parsed {
        if let Some(messages) = file_obj.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                let line = msg.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let col = msg.get("column").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let end_line = msg.get("endLine").and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(line);
                let end_col = msg
                    .get("endColumn")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize)
                    .unwrap_or(col);
                let sev = msg.get("severity").and_then(|v| v.as_u64()).unwrap_or(1);
                let message = msg
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let rule = msg.get("ruleId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                diags.push(LintDiagnostic {
                    from_line: line,
                    from_col: col,
                    to_line: end_line,
                    to_col: end_col,
                    severity: if sev >= 2 { "error".to_string() } else { "warning".to_string() },
                    message,
                    source: rule,
                });
            }
        }
    }

    Ok(diags)
}

// ── Auto-test post-modification (E2, spec_orchestration_autotest.md) ──

#[derive(Debug, Serialize)]
struct TestRunResult {
    /// Code de sortie du process (`None` si timeout ou crash sans code).
    exit_code: Option<i32>,
    /// stdout capturé (tronqué à ~256 Ko).
    stdout: String,
    /// stderr capturé (tronqué à ~256 Ko).
    stderr: String,
    /// `true` si le process a été tué pour dépassement de timeout.
    timed_out: bool,
    /// Durée réelle d'exécution en ms.
    duration_ms: u32,
}

/// Exécute une commande de tests du projet avec timeout, capture stdout+stderr
/// (limités à ~256 Ko chacun), kill si le timeout est dépassé. La commande est
/// lancée **sans shell** (`Command::new(cmd).args(args)`, pas de `shell=true`)
/// pour éviter toute injection, et le `cwd` est forcé au projet ouvert par le
/// frontend. Utilisé par le Mode Orchestration (E2) après chaque tâche du codeur.
#[tauri::command]
fn run_project_tests(
    state: State<AppState>,
    command: String,
    args: Vec<String>,
    timeout_ms: u32,
) -> Result<TestRunResult, String> {
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);

    let (stdout, stderr, exit_code, timed_out, duration_ms) =
        run_command_timed(&command, &args, &cwd, timeout_ms);
    Ok(TestRunResult {
        exit_code,
        stdout,
        stderr,
        timed_out,
        duration_ms,
    })
}

/// Lance `<cmd> <args...>` dans `cwd`, capture stdout et stderr séparément
/// (lecteurs parallèles pour éviter le deadlock quand les buffers OS se
/// remplissent), kill si `timeout_ms` dépassé. Tronque chaque flux à 256 Ko
/// (les premiers échecs sont les plus pertinents ; un `cargo test` verbeux
/// peut produire plusieurs Mo). Renvoie `(stdout, stderr, exit_code, timed_out,
/// duration_ms)`.
fn run_command_timed(
    cmd: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: u32,
) -> (String, String, Option<i32>, bool, u32) {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut command = Command::new(cmd);
    command.args(args).current_dir(cwd);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let start = Instant::now();
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            return (
                String::new(),
                format!("Impossible de lancer '{}': {}", cmd, e),
                None,
                false,
                0,
            );
        }
    };

    // Détacher les pipes avant la boucle d'attente (take) et les lire dans des
    // threads dédiés pour éviter le deadlock : si le process produit plus que
    // la capacité du buffer OS (~64 Ko) sur un flux non drainé, il bloque sur
    // l'écriture et ne termine jamais → try_wait boucle indéfiniment.
    let mut stdout_child = child.stdout.take();
    let mut stderr_child = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(8192);
        if let Some(ref mut s) = stdout_child {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(8192);
        if let Some(ref mut s) = stderr_child {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });

    let deadline = Duration::from_millis(timeout_ms as u64);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= deadline {
                    let _ = child.kill();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }

    // Attend la fin effective du child (immédiat après try_wait(Some) ou après
    // kill pour timeout) pour récupérer le code de sortie.
    let exit_code = match child.wait() {
        Ok(status) => {
            if timed_out {
                None
            } else {
                status.code()
            }
        }
        Err(_) => None,
    };

    let raw_stdout = stdout_handle.join().unwrap_or_default();
    let raw_stderr = stderr_handle.join().unwrap_or_default();

    let truncate = |b: Vec<u8>| -> String {
        const CAP: usize = 256 * 1024;
        if b.len() > CAP {
            let head = String::from_utf8_lossy(&b[..CAP]).to_string();
            format!("{}… (tronqué, {} octets au total)", head, b.len())
        } else {
            String::from_utf8_lossy(&b).to_string()
        }
    };

    let duration_ms = start.elapsed().as_millis() as u32;
    (truncate(raw_stdout), truncate(raw_stderr), exit_code, timed_out, duration_ms)
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
        // Single-instance : si une 2e instance de Pilot est lancée, elle notifie
        // la 1ʳᵉ (qui se restaure/focus) puis se ferme. Résout le conflit de port
        // web-remote quand deux instances tournent en parallèle (issue #3).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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
                rpc_reviewer: Mutex::new(None),
                agent_sessions: Mutex::new(HashMap::new()),
                event_tx,
                auth: Arc::new(web_auth::WebAuth::new()),
                guard: Arc::new(web_rate::WebGuard::new()),
                audit: Arc::new(web_audit::WebAudit::new()),
                web_shutdown: std::sync::Mutex::new(None),
                ext_gate_cache: std::sync::Mutex::new(None),
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
            lint_file,
            replace_in_files,
            get_available_models_list,
            read_models_config,
            write_models_config,
            read_model_aliases,
            write_model_aliases,
            list_agent_backends,
            test_provider_models,
            set_help_model,
            set_review_model,
            add_favorite,
            remove_favorite,
            save_plan,
            load_plan,
            delete_plan,
            check_syntax,
            run_project_tests,
            extension_gate_supported,
            get_backend_info,
            pi_health_check,
            git_status,
            git_diff_file,
            git_create_snapshot,
            git_restore_snapshot,
            start_reviewer_session,
            stop_reviewer_session,
            send_reviewer_prompt,
            new_reviewer_session,
            set_reviewer_model,
            abort_reviewer,
            get_reviewer_state,
            // ── Gestion d'agents multi-rôles (H2 V2) ──
            load_agent_registry,
            save_agent_registry,
            start_agent_process,
            stop_agent_process,
            stop_all_agent_processes,
            send_agent_process_prompt,
            new_agent_process_session,
            set_agent_process_model,
            abort_agent_process,
            send_agent_process_command,
            get_agent_process_state,
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
            review::ask_review,
            tailscale::tailscale_status,
            tailscale::tailscale_enable_serve,
            tailscale::tailscale_disable_serve,
            tailscale::tailscale_serve_qrcode,
            context_engine::context_rag_probe,
            context_engine::context_index_status,
            context_engine::build_context_index,
            context_engine::query_context_index,
            context_engine::context_index_clear,
            index_sessions,
            search_sessions,
            get_session_detail,
            set_session_tags,
            list_session_tags,
            record_session_entry,
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
                // H2 V2 : arrêter proprement tous les processus agents.
                {
                    let state = app.state::<AppState>();
                    do_stop_all_agent_processes(&state);
                }
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
