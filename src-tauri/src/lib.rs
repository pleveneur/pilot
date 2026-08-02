use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
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
mod agents_md;
mod rpc_manager;
mod tailscale;
mod web_auth;
mod web_audit;
mod web_rate;
mod web_server;
mod context_engine;
mod git;
mod terminal;
mod files;
mod models_config;
mod pdf;
mod search;
mod code_check;
mod plan;
mod session_history;
mod tabs;
mod web_commands;
mod agents;

// ── État global de l'application ──

struct AppState {
    project_path: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
    watch_state: Mutex<Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>>,
    terminals: Mutex<HashMap<String, terminal::TerminalState>>,
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
fn default_agent_timeout_ms() -> u32 { 300000 }
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
    agents::do_stop_all_agent_processes(&state);
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
            .join(session_history::project_to_session_folder(&cwd))
    } else {
        std::path::PathBuf::from(&session_dir)
            .join(session_history::project_to_session_folder(&cwd))
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

    // Extensions pi : pilot-edit-gate (porte pré-écriture A4 V2) et pilot-context
    // (injection contexte/mémoire dans le system prompt — spec_context_engine /
    // spec_project_memory). `--extension` accepte plusieurs valeurs. Écrites dans
    // le dossier data depuis include_str! (imports type-only, effacés par jiti —
    // aucune dépendance npm).
    // - pilot-edit-gate : chargée UNIQUEMENT si `confirm_file_edits` est activé ET
    //   si le backend supporte `--extension`. Quand désactivé (défaut) ou non
    //   supporté (ex: plh sans le flag), elle n'est pas chargée → aucun surcharge,
    //   aucun blocage, l'agent écrit librement.
    // - pilot-context : chargée dès que `--extension` est supporté (indépendante
    //   de confirm_file_edits). No-op si Pilot n'écrit pas de fichier de handoff.
    let ext_supported = probe_extension_support(state, &pi_path);
    let mut extensions: Vec<String> = Vec::new();
    if ext_supported {
        if let Ok(data_dir) = app.path().app_data_dir() {
            let dir = data_dir.join("extensions");
            if fs::create_dir_all(&dir).is_ok() {
                if confirm_file_edits {
                    let ext_file = dir.join("pilot-edit-gate.ts");
                    if fs::write(&ext_file, include_str!("../extensions/pilot-edit-gate.ts")).is_ok() {
                        extensions.push(ext_file.to_string_lossy().to_string());
                    }
                }
                let ctx_file = dir.join("pilot-context.ts");
                if fs::write(&ctx_file, include_str!("../extensions/pilot-context.ts")).is_ok() {
                    extensions.push(ctx_file.to_string_lossy().to_string());
                }
            }
        }
    }

    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, no_session, &session_dir_str, skill_path.as_deref(), extensions, app.clone(), state.event_tx.clone(), "rpc-event", None,
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
        &cwd, &pi_path, true, "", None, Vec::new(), app.clone(), state.event_tx.clone(), "rpc-event-reviewer", None,
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


// ── Gestion des modèles IA (édition UI des models.json / model-switch.json) ──
//
// Pilot permet désormais d'éditer le registre des modèles (providers + modèles)
// et les alias (model-switch.json) directement depuis l'onglet « Fournisseurs »
// de la modale Paramètres, sans éditer les JSON à la main. Ces commandes
// travaillent sur le répertoire home du backend ciblé (~/.pi, ~/.plh, ...),
// résolu par stem explicite (et non par le chemin de l'exécutable configuré).
// Toutes les écritures font un backup .bak et une validation minimale.









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
            files::read_file_content,
            files::get_file_info,
            files::read_file_binary,
            files::write_file_content,
            files::write_file_binary,
            files::write_context_handoff,
            files::file_exists,
            files::file_mtime,
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
            files::open_in_browser,
            pdf::export_pdf,
            rename_file_or_dir,
            copy_image_to_project,
            terminal::spawn_terminal,
            terminal::write_to_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            start_agent_session,
            stop_agent_session,
            send_rpc_command,
            get_agent_state,
            get_session_stats,
            model_supports_images,
            send_agent_prompt,
            abort_agent,
            new_agent_session,
            session_history::resume_agent_session,
            get_agent_messages,
            set_agent_model,
            list_agent_models,
            list_agent_commands,
            agents::check_model_reachable,
            agents::execute_agent_bash,
            agents::compact_agent_context,
            session_history::list_sessions,
            send_inline_prompt,
            agents::convert_pdf_to_md_ai,
            tabs::save_tab_session,
            tabs::load_tab_session,
            search::search_in_files,
            code_check::lint_file,
            search::replace_in_files,
            agents::get_available_models_list,
            models_config::read_models_config,
            models_config::write_models_config,
            models_config::read_model_aliases,
            models_config::write_model_aliases,
            models_config::list_agent_backends,
            models_config::test_provider_models,
            set_help_model,
            set_review_model,
            add_favorite,
            remove_favorite,
            plan::save_plan,
            plan::load_plan,
            plan::delete_plan,
            code_check::check_syntax,
            code_check::run_project_tests,
            extension_gate_supported,
            get_backend_info,
            pi_health_check,
            git::git_status,
            git::git_diff_file,
            git::git_create_snapshot,
            git::git_restore_snapshot,
            start_reviewer_session,
            stop_reviewer_session,
            send_reviewer_prompt,
            new_reviewer_session,
            set_reviewer_model,
            abort_reviewer,
            get_reviewer_state,
            // ── Gestion d'agents multi-rôles (H2 V2) ──
            agents::load_agent_registry,
            agents::save_agent_registry,
            agents::reset_agent_registry,
            agents::start_agent_process,
            agents::stop_agent_process,
            agents::stop_all_agent_processes,
            agents::send_agent_process_prompt,
            agents::new_agent_process_session,
            agents::set_agent_process_model,
            agents::abort_agent_process,
            agents::send_agent_process_command,
            agents::get_agent_process_state,
            web_commands::set_web_password,
            web_commands::web_kick_remote,
            web_commands::web_active_count,
            web_commands::web_has_password,
            web_commands::web_status,
            web_commands::web_audit_log,
            web_commands::web_audit_clear,
            web_commands::web_audit_count,
            web_commands::reload_web_server,
            help::get_handbook,
            help::ask_help,
            review::ask_review,
            agents_md::generate_agents_md,
            tailscale::tailscale_status,
            tailscale::tailscale_enable_serve,
            tailscale::tailscale_disable_serve,
            tailscale::tailscale_serve_qrcode,
            context_engine::context_rag_probe,
            context_engine::context_index_status,
            context_engine::build_context_index,
            context_engine::query_context_index,
            context_engine::context_index_clear,
            session_history::index_sessions,
            session_history::search_sessions,
            session_history::get_session_detail,
            session_history::set_session_tags,
            session_history::list_session_tags,
            session_history::record_session_entry,
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
                    agents::do_stop_all_agent_processes(&state);
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

// ── Export Markdown → HTML (pour impression PDF) ──


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
