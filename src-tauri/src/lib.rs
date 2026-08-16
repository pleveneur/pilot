use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

// Réexports des helpers partagés extraits dans les modules (autres modules
// les importent depuis `crate::`).
pub(crate) use rpc::{kind_from_version_output, probe_backend, probe_extension_support, resolve_agent_home, run_captured, BackendProbe};
// Réexports RPC utilisés par web_server.rs (canal distant).
pub(crate) use rpc::{
    do_abort_agent, do_get_agent_messages, do_get_agent_state, do_get_session_stats,
    do_list_agent_models, do_new_agent_session, do_send_agent_prompt, do_set_agent_model,
    do_start_agent_session, do_stop_agent_session, project_event_channel,
};


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
mod code_graph;
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
mod rpc;
mod interproject;
mod super_agent;
mod dashboard;
mod vault;
mod pi_update;
mod project_agents;
mod db;
mod agent;
mod agent_service;

// ── État global de l'application ──

/// État d'un projet ouvert (spec_multiprojects.md). Un par projet ouvert :
/// son agent RPC dédié + son watcher de fichiers.
/// NB : à l'étape actuelle (adaptateur progressif) seul `path` est rempli ;
/// `rpc`/`watcher` accueilleront l'état par projet quand on sortira de
/// l'adaptateur (les champs globaux reflètent encore le projet actif).
#[allow(dead_code)]
struct ProjectState {
    path: String,
    watcher: Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>,
}

/// État d'activité de l'agent d'un projet (issue #13, indicateur par projet).
/// Mis à jour par l'observateur d'événements RPC : `agent_start` → busy=true,
/// `agent_settled` → busy=false (fin définitive d'une exécution).
struct SessionActivity {
    busy: bool,
    updated: std::time::Instant,
}

struct AppState {
    project_path: Mutex<Option<String>>,
    /// Multi-projets (spec_multiprojects.md) : projets ouverts, indexés par
    /// chemin normalisé. Chaque projet a son propre agent RPC + watcher.
    projects: Mutex<HashMap<String, ProjectState>>,
    /// Projet actif (affiché) : chemin normalisé présent dans `projects`.
    active_project: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
    watch_state: Mutex<Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>>,
    terminals: Mutex<HashMap<String, terminal::TerminalState>>,
    /// Refonte (cahier §3.1) : service propriétaire des agents (registre en base
    /// + sessions en Phase 2). Source de vérité de l'objet Agent.
    agent_service: Arc<agent_service::AgentService>,
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
    /// Issue #13 : activité de l'agent par projet (path normalisé → SessionActivity).
    /// Mise à jour en arrière-plan par l'observateur RPC de chaque session projet.
    agent_activity: Arc<Mutex<HashMap<String, SessionActivity>>>,
    /// Issue #27 : commandes projet en cours d'exécution via le web-remote.
    /// Map run_id → processus enfant (permet l'arrêt `command_stop`). Vide si
    /// aucune commande ne tourne.
    web_runs: Mutex<HashMap<String, std::process::Child>>,
    /// Super-agent : projet sur lequel l'assistant travaille (dernier projet
    /// ouvert via l'action `open_project`). Distinct du projet actif : quand
    /// l'utilisateur change de projet, le projet de travail reste celui de la
    /// discussion en cours, pour que l'assistant ne confonde pas les projets.
    working_project: Mutex<Option<String>>,
    /// Coffre fort (issue #52) : clé AES-256 dérivée du mot de passe maître,
    /// conservée en mémoire uniquement tant que le coffre est déverrouillé.
    /// `None` = verrouillé. Jamais persistée sur disque.
    vault_key: Mutex<Option<Vec<u8>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    theme: String,
    #[serde(default)]
    subtheme: String,
    default_command: String,
    #[serde(default)]
    recent_projects: Vec<String>,
    // Multi-projets (spec_multiprojects.md) : liste persistée des projets ouverts
    // au dernier arrêt, restaurée au démarrage. Chaque entrée est un chemin normalisé.
    #[serde(default)]
    open_projects: Vec<String>,
    // Multi-projets : chemin du projet actif au dernier arrêt (restauré au démarrage).
    #[serde(default)]
    active_open_project: Option<String>,
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
    // Multi-onglets agents (spec_multi_agents) : si true, permet d'ouvrir
    // plusieurs onglets agent indépendants sur le même projet (bouton « + »
    // dans la barre d'onglets). Chaque agent a sa propre session/conversation.
    #[serde(default)]
    multi_agent_tabs: bool,
    // Purge automatique des sessions (H9) : délai de rétention en jours des
    // fichiers de session pi (défaut 15). 0 = purge désactivée. Exécutée par
    // un thread autonome (start_session_purge) sur tous les projets ouverts.
    #[serde(default = "default_session_retention_days")]
    session_retention_days: u32,
    // Issue #26 : si true, ne plus proposer la mise à jour de Pi (choix
    // « Ne plus demander » dans la modale). La vérification reste possible
    // manuellement. Détection automatique à l'ouverture de l'onglet agent.
    #[serde(default)]
    pi_skip_update_check: bool,
    // Quality-gate interne (Évolution 7) : skill embarqué par Pilot, activable
    // depuis l'onglet agent. Persistance + rechargement au démarrage de Pilot.
    #[serde(default)]
    quality_gate_enabled: bool,
    #[serde(default = "default_true")]
    show_thinking: bool,
    #[serde(default)]
    show_tools: bool,
    // Issue #41 : notification native desktop quand l'agent a terminé une tâche,
    // y compris pour un chat LOCAL (pas seulement à distance). Défaut off.
    #[serde(default)]
    notify_agent_done: bool,
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
    // Issue #15 : liaisons inter-projets — chemin projet → liste de projets liés
    // (lecture seule du code source + dépôt de tâches/analyse dans l'autre projet).
    #[serde(default)]
    project_links: HashMap<String, Vec<String>>,
    #[serde(default)]
    word_wrap: bool,
    // Option B (modale animée) : forcer l'animation d'ouverture des modales même
    // si la réduction de mouvement (prefers-reduced-motion) est active côté système.
    // Activé par défaut (default_true) pour que les anciennes configs / nouvelles
    // installations aient l'animation sans action de l'utilisateur.
    #[serde(default = "default_true")]
    modal_animations: bool,
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
    // Issue #61 : mode d'interface du web remote — « assistant » (minimaliste,
    // défaut) ou « agents » (interface complète). Persisté côté serveur (config)
    // pour être cohérent sur tous les appareils, au lieu du localStorage.
    #[serde(default = "default_web_mode")]
    web_mode: String,
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
    // ── Code Graph (spec_code_graph.md) ──
    // Graphe structurel du projet (nœuds/arêtes calls/imports/inherits),
    // construit localement sans LLM. Injecté à l'agent (mode A sous-graphe
    // scoré + mode B wiki). Complémentaire du RAG (sémantique).
    #[serde(default = "default_true")]
    code_graph_enabled: bool,
    // Moteur d'extraction : "heuristic" (V1) | "treesitter" (V2).
    #[serde(default = "default_graph_extraction")]
    graph_extraction: String,
    // Mode A : injecter un sous-graphe scoré au 1er prompt.
    #[serde(default = "default_true")]
    graph_inject_mode_a: bool,
    #[serde(default = "default_graph_budget")]
    graph_budget_tokens: u32,
    // Mode B : générer le wiki `.pilot/graph-wiki/` + consigne de lecture.
    #[serde(default = "default_true")]
    graph_inject_mode_b: bool,
    // Extraire les arêtes calls (INFERRED).
    #[serde(default = "default_true")]
    graph_include_calls: bool,
    /// Diff Review (A4 V2) : porte pré-écriture. Si true, l'agent doit confirmer
    /// auprès de l'utilisateur avant chaque write/edit (extension pi pilot-edit-gate).
    /// Désactivé par défaut (l'agent écrit librement, comme avant).
    #[serde(default)]
    confirm_file_edits: bool,
    // ── H7 : projets sensibles (local-first garanti, badge 🔒) ──
    // Liste des chemins de projets en mode « sensible » : dictée vocale cloud
    // bloquée, badge 🔒 affiché. Pas de routing cloud (H6) pour l'instant.
    #[serde(default)]
    sensitive_projects: Vec<String>,
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
    // ── Super-agent (spec_super_agent.md) ──
    // Assistant de suivi multi-projets, lecture seule. Nom configurable, liste
    // de clients, association projet → client. La base de suivi (clients,
    // projets, tâches, décisions) vit dans `~/.pilot/super-agent.db` (SQLite).
    #[serde(default = "default_super_agent_name")]
    super_agent_name: String,
    #[serde(default)]
    super_agent_clients: Vec<String>,
    #[serde(default)]
    super_agent_project_client: HashMap<String, String>,
    // Modèle actif du super-agent (format "provider/modelId"). Persisté pour
    // l'appel bloquant `ask_super_agent` (process frais par tour).
    #[serde(default)]
    super_agent_model: String,
    // Prompt système personnalisé du super-agent (éditable dans Paramètres).
    // Préfixé à chaque tour de `ask_super_agent` pour cadrer le comportement.
    #[serde(default)]
    super_agent_prompt: String,
    // Mémoire utilisateur persistée (A17) : profil/notes sur l'utilisateur ou
    // développeur de Pilot (préférences, contexte, habitudes). Renseignée par
    // l'assistant via l'outil `update_user_memory` et injectée dans son prompt
    // système (comme le prompt personnalisé). Persistée dans la config.
    #[serde(default)]
    super_agent_user_memory: String,
    // L'onglet Super-agent est GLOBAL (multi-projets) : son état d'ouverture est
    // persisté ici (pas par projet) pour le rouvrir au démarrage de Pilot.
    #[serde(default)]
    super_agent_open: bool,
    // Évolution « Tableau de bord systématique » : si true, l'onglet 📊 Tableau
    // de bord s'ouvre automatiquement au démarrage (uniquement si un projet est
    // chargé) et est verrouillé en position dans la barre d'onglets (juste après
    // l'onglet 🧭 Assistant, avant le bouton « + »). Défaut off.
    #[serde(default)]
    dashboard_auto_open: bool,
    // Rafraîchissement automatique du Tableau de bord : quand activé (défaut),
    // l'onglet 📊 recharge ses données toutes les `dashboard_auto_refresh_seconds`
    // secondes tant qu'il est visible/actif. Défaut : activé, 10 s.
    #[serde(default = "default_true")]
    dashboard_auto_refresh: bool,
    #[serde(default = "default_dashboard_refresh_seconds")]
    dashboard_auto_refresh_seconds: u32,
    // Issue #43 : options de rendu de la conversation de l'Assistant, harmonisées
    // avec l'agent standard (afficher la réflexion / les outils).
    #[serde(default = "default_true")]
    super_agent_show_thinking: bool,
    #[serde(default)]
    super_agent_show_tools: bool,
    // Issue #16 : notification native desktop quand l'Assistant (🧭) signale un
    // événement important (tâche déléguée à un agent terminée, anomalie de
    // suivi). Défaut off (désactivé), même principe que notify_agent_done.
    #[serde(default)]
    notify_super_agent_done: bool,
    // Évolution 3 : assistant « réponses courtes » — quand activé, l'assistant
    // informe et décide sans détailler tout ce qui se fait, sauf demande
    // explicite. Défaut off. Injecté dans le prompt système.
    #[serde(default)]
    super_agent_concise: bool,
    // A18 : personnalité adaptée à l'utilisateur. Quand activé, l'assistant
    // analyse en arrière-plan la conversation en cours pour déduire le
    // style/ton/personnalité qui correspond le mieux à l'utilisateur, puis
    // injecte cette personnalité dans son prompt système (comme la mémoire
    // utilisateur A17). `super_agent_personality` est la personnalité déduite,
    // persistée. Défaut off.
    #[serde(default)]
    super_agent_adaptive_personality: bool,
    #[serde(default)]
    super_agent_personality: String,
    // Issue #59 : quand l'onglet 🧭 Assistant est ouvert, bloquer/désactiver la
    // saisie de l'agent (éviter de répondre à l'agent au lieu de l'assistant).
    // Défaut off.
    #[serde(default)]
    super_agent_block_agent_input: bool,
    // Évolution 64 : « agent invisible ». Quand l'Assistant (🧭) délègue une
    // demande à l'agent (delegate_to_coder), l'agent s'exécute en arrière-plan
    // SANS créer d'onglet agent visible (aucun onglet créé du tout). Activé par
    // défaut. Désactivé → comportement actuel (l'onglet agent s'ouvre).
    #[serde(default = "default_true")]
    super_agent_invisible_agent: bool,
}

fn default_true() -> bool { true }
fn default_super_agent_name() -> String { "Assistant".to_string() }
fn default_context_budget() -> u32 { 8000 }
fn default_rag_endpoint() -> String { "http://127.0.0.1:11434".to_string() }
fn default_rag_model() -> String { "nomic-embed-text".to_string() }
fn default_graph_extraction() -> String { "heuristic".to_string() }
fn default_graph_budget() -> u32 { 4000 }
fn default_sidebar_width() -> u32 { 280 }
fn default_auto_save_delay() -> u32 { 3000 }
fn default_orchestration_idle_timeout() -> u32 { 120000 }
fn default_orchestration_revision_interval() -> u32 { 5 }
fn default_orchestration_granularity() -> String { "fine".to_string() }
fn default_coder_context_window() -> u32 { 0 }
fn default_web_port() -> u32 { 8787 }
fn default_web_bind() -> String { "127.0.0.1".to_string() }
fn default_web_mode() -> String { "assistant".to_string() }
fn default_session_retention_days() -> u32 { 15 }
fn default_dashboard_refresh_seconds() -> u32 { 10 }

/// Port web effectif. En build dev (`debug_assertions`), on décale le port
/// configuré de +1 pour permettre à la version installée et à la version dev
/// de tourner en parallèle sans conflit de port (issue #25). La valeur stockée
/// dans la config reste celle saisie par l'utilisateur ; seul le port réellement
/// utilisé est décalé en dev.
pub(crate) fn effective_web_port(cfg: &AppConfig) -> u16 {
    let base = cfg.web_port;
    #[cfg(debug_assertions)]
    let base = base.saturating_add(1);
    u16::try_from(base).unwrap_or(8787)
}
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

    /// Multi-projets : enregistre un projet comme ouvert (dédoublonné).
    fn add_open_project(&mut self, path: &str) {
        if !self.open_projects.contains(&path.to_string()) {
            self.open_projects.push(path.to_string());
        }
    }

    /// Multi-projets : retire un projet fermé de la liste persistée.
    fn remove_open_project(&mut self, path: &str) {
        self.open_projects.retain(|p| p != path);
        if self.active_open_project.as_deref() == Some(path) {
            self.active_open_project = None;
        }
    }

    /// Multi-projets : marque le projet actif (persisté au démarrage).
    fn set_active_open_project(&mut self, path: &str) {
        self.active_open_project = Some(path.to_string());
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            subtheme: "default".to_string(),
            default_command: String::new(),
            recent_projects: Vec::new(),
            open_projects: Vec::new(),
            active_open_project: None,
            last_project: None,
            auto_load_last_project: false,
            auto_run_command: false,
            integrated_terminal: false,
            rpc_agent_enabled: false,
            rpc_pi_path: String::new(),
            rpc_no_session: false,
            rpc_session_dir: String::new(),
            multi_agent_tabs: false,
            session_retention_days: default_session_retention_days(),
            pi_skip_update_check: false,
            quality_gate_enabled: false,
            show_thinking: true,
            show_tools: false,
            notify_agent_done: false,
            pdf_md_model: String::new(),
            sidebar_width: 280,
            auto_save: false,
            auto_save_delay: 3000,
            favorites: Vec::new(),
            project_links: HashMap::new(),
            word_wrap: false,
            modal_animations: true,
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
            web_mode: default_web_mode(),
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
            code_graph_enabled: true,
            graph_extraction: default_graph_extraction(),
            graph_inject_mode_a: true,
            graph_budget_tokens: default_graph_budget(),
            graph_inject_mode_b: true,
            graph_include_calls: true,
            confirm_file_edits: false,
            sensitive_projects: Vec::new(),
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
            // ── Super-agent (spec_super_agent.md) ──
            super_agent_name: default_super_agent_name(),
            super_agent_clients: Vec::new(),
            super_agent_project_client: HashMap::new(),
            super_agent_model: String::new(),
            super_agent_prompt: String::new(),
            super_agent_open: false,
            dashboard_auto_open: false,
            dashboard_auto_refresh: true,
            dashboard_auto_refresh_seconds: default_dashboard_refresh_seconds(),
            super_agent_show_thinking: true,
            super_agent_show_tools: false,
            notify_super_agent_done: false,
            super_agent_concise: false,
            super_agent_adaptive_personality: false,
            super_agent_personality: String::new(),
            super_agent_user_memory: String::new(),
            super_agent_block_agent_input: false,
            super_agent_invisible_agent: true,
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

/// Charge la config depuis le disque si elle est encore le défaut (chargement
/// paresseux). À appeler avant de lire des champs de config sensibles (ex:
/// `rpc_pi_path`) dans les commandes qui ne passent pas par `get_config` —
/// sinon, au démarrage, ces champs sont vides tant que `get_config` n'a pas été
/// appelé (bug « Pi indisponible » : health check E4 lu avant le chargement).
fn ensure_config_loaded(state: &AppState, app: &AppHandle) {
    let mut config = state.config.lock().unwrap();
    let default = AppConfig::default();
    if config.theme == default.theme
        && config.subtheme == default.subtheme
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
        let mut disk = load_config_disk(app);
        disk.migrate();
        *config = disk;
    }
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

pub(crate) fn save_config_disk(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
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

        // V2.1 Code Graph : refresh différé auto. Ce flag évite de lancer des
        // refresh concurrents pendant qu'une écriture se stabilise.
        let graph_refresh_inflight = Arc::new(AtomicBool::new(false));

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

            // V2.1 Code Graph : quand un fichier analysé change, relancer
            // l'indexation incrémentale en arrière-plan (fire-and-forget).
            // Ne construit pas le graphe s'il est absent (build lazy frontend)
            // et ne bloque jamais le poller (thread dédié + debounce).
            let graph_change = pending.keys().any(|k| code_graph::is_graph_file(k));
            if graph_change && !graph_refresh_inflight.swap(true, Ordering::Relaxed) {
                let path2 = path_buf.clone();
                let flag = graph_refresh_inflight.clone();
                std::thread::spawn(move || {
                    // Petite latence pour laisser l'écriture se stabiliser.
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    code_graph::refresh_by_watcher(&path2.to_string_lossy(), 400);
                    flag.store(false, Ordering::Relaxed);
                });
            }

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

    // Multi-projets (issue #14) : comme `do_set_active_project`, parker la
    // session active du projet précédent avant de rendre ce projet actif —
    // sinon la session resterait orpheline (hors de l'AgentService) et ne serait
    // jamais tuée à la fermeture de son projet (fuite de processus pi/plh).
    park_previous_active_if_switching(&state, path);

    // Multi-projets (spec_multiprojects.md) : enregistrer le projet dans la
    // collection des projets ouverts (clé = chemin normalisé) s'il n'y est pas,
    // puis le rendre actif. `project_path`/`watch_state` restent l'état du projet
    // actif (adaptateur progressif).
    {
        let mut projects = state.projects.lock().unwrap();
        projects
            .entry(path.to_string())
            .or_insert_with(|| ProjectState {
                path: path.to_string(),
                watcher: None,
            });
    }

    // Arrêter l'ancien watcher proprement
    stop_watcher(&state);

    // Démarrer le nouveau watcher
    start_watching(app, path, &state)?;

    // Stocker le chemin du projet (section critique courte)
    *state.project_path.lock().unwrap() = Some(path.to_string());
    *state.active_project.lock().unwrap() = Some(path.to_string());

    // Persister dans les projets récents (section critique courte)
    {
        let mut config = state.config.lock().unwrap();
        config.add_recent(path);
        config.add_open_project(path);
        config.set_active_open_project(path);
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
fn get_backend_info(state: State<AppState>, app: AppHandle) -> Result<BackendInfo, String> {
    ensure_config_loaded(&state, &app);
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
fn pi_health_check(state: State<AppState>, app: AppHandle) -> Result<PiHealth, String> {
    ensure_config_loaded(&state, &app);
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
    ensure_config_loaded(&state, &app);
    Ok(state.config.lock().unwrap().clone())
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

// ── H7 : projets sensibles (local-first) ──

/// Ajoute/retire un projet de la liste des projets sensibles (badge 🔒 + dictée
/// cloud bloquée). Retourne le nouvel état (true = sensible).
#[tauri::command]
fn set_project_sensitive(state: State<AppState>, app: AppHandle, path: String, sensitive: bool) -> Result<bool, String> {
    let mut config = state.config.lock().unwrap().clone();
    if sensitive {
        if !config.sensitive_projects.contains(&path) {
            config.sensitive_projects.push(path);
        }
    } else {
        config.sensitive_projects.retain(|p| p != &path);
    }
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    Ok(sensitive)
}

/// Retourne true si le chemin de projet donné est marqué sensible.
#[tauri::command]
fn is_project_sensitive(state: State<AppState>, path: String) -> bool {
    state.config.lock().unwrap().sensitive_projects.contains(&path)
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
fn close_project(state: State<AppState>, app: AppHandle, path: Option<String>) -> Result<(), String> {
    // Multi-projets (spec_multiprojects.md) : le chemin de la fermeture.
    // None = fermer le projet actif (rétro-compatibilité).
    let target = path.clone().unwrap_or_else(|| {
        state
            .project_path
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_default()
    });

    // Si on ferme le projet actif : stopper watcher + session RPC + titre.
    let is_active = {
        let active = state.active_project.lock().unwrap();
        active.as_deref() == Some(target.as_str())
    };

    if is_active || path.is_none() {
        stop_watcher(&state);
        // Arrêter la session active via l'AgentService (tue le processus pi et
        // réinitialise le pointeur actif).
        if let Some(agent_id) = state.agent_service.active_agent() {
            let _ = state.agent_service.stop(&target, &agent_id);
        }
        // Arrêter aussi la session reviewer (H2 V1) si elle tourne : c'est un
        // `pi`/`plh.exe` séparé (--no-session) qui ne meurt pas avec la session
        // principale → sans cet arrêt, il resterait en mémoire à la fermeture
        // du projet (fuite de processus issue #14).
        state.agent_service.stop_reviewer(&target);
        // H2 V2 : arrêter tous les processus agents au changement/fermeture de projet.
        agents::do_stop_all_agent_processes(&state);
        *state.project_path.lock().unwrap() = None;
        *state.active_project.lock().unwrap() = None;
        // Réinitialiser le titre de la fenêtre
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title("Pilot");
        }
    }

    // Retirer le projet de la collection multi-projets, en tuant proprement ses
    // sessions parkées (multi-projets / multi-onglets agents) si elles existent —
    // sinon fuite de processus pi. Les sessions parkées de CE projet
    // vivent dans le registre unique de l'AgentService (clé composite
    // (projet, agent)) et sont arrêtées via `stop_project_sessions`.
    state.agent_service.stop_project_sessions(&target);
    {
        let mut projects = state.projects.lock().unwrap();
        projects.remove(&target);
    }

    // Issue #13 : oublier l'activité de l'agent de CE projet (pas de fuite de map).
    state.agent_activity.lock().unwrap().remove(&target);

    // Multi-projets : retirer le projet fermé de la liste persistée.
    {
        let mut config = state.config.lock().unwrap();
        config.remove_open_project(&target);
        save_config_disk(&app, &config)?;
    }

    Ok(())
}

/// Multi-projets (spec_multiprojects.md) : définit le projet actif (affiché).
/// Le basculement de la session RPC / du watcher est géré par le frontend via
/// l'événement `project_changed` (même logique que l'ouverture de projet).
#[tauri::command]
fn set_active_project(state: State<AppState>, app: AppHandle, path: String) -> Result<(), String> {
    do_set_active_project(&state, &app, &path)
}

/// Multi-projets (issue #14) : invariant « aucune session orpheline ». Si une
/// session agent est active ET que le projet actif diffère
/// de `new_path`, on la parke dans SON projet (processus pi/plh conservé en
/// arrière-plan, conforme au multi-projets) avant le changement de projet actif.
/// No-op si aucune session active ou si on reste sur le même projet. Empêche que
/// la session d'un projet ne reste vivante hors de tout slot traçable par
/// `close_project` → fuite de processus.
fn park_previous_active_if_switching(state: &AppState, new_path: &str) {
    let has_session = state.agent_service.active_agent().is_some();
    if !has_session {
        return;
    }
    let cur = state.active_project.lock().unwrap().clone();
    if let Some(cur_p) = cur {
        if cur_p != new_path {
            let _ = crate::rpc::do_park_agent_session(state, None);
        }
    }
}

/// Multi-projets (spec_multiprojects.md) : définit le projet actif (affiché).
/// Le basculement de la session RPC est géré par le frontend (desktop) via
/// `project_changed` ou par le web (qui redémarre lui-même l'agent).
pub(crate) fn do_set_active_project(
    state: &State<AppState>,
    app: &AppHandle,
    path: &str,
) -> Result<(), String> {
    // Multi-projets (issue #14) : garantir qu'aucune session active du projet
    // précédent ne reste orpheline (hors de l'AgentService). Si le frontend a déjà
    // parké/stoppé (flux desktop normal), c'est un no-op ; sinon (parking échoué,
    // chemin web, appel direct), on parke la session dans SON projet avant de
    // basculer — sans quoi fermer ce projet ne la tuerait jamais (fuite de
    // processus pi/plh).
    park_previous_active_if_switching(state.inner(), path);

    // Le projet doit être dans la collection des projets ouverts.
    let registered = state.projects.lock().unwrap().contains_key(path);
    if !registered {
        return Err("Projet non ouvert".to_string());
    }

    // Arrêter le watcher du projet actif actuel (l'état global reflète le
    // projet actif), puis relancer un watcher sur le nouveau projet actif
    // (sinon plus aucun rafraîchissement de l'arbre).
    stop_watcher(state);
    start_watching(app, path, state)?;
    *state.project_path.lock().unwrap() = Some(path.to_string());
    *state.active_project.lock().unwrap() = Some(path.to_string());

    // Multi-projets : persister le projet actif (restauré au démarrage).
    {
        let mut config = state.config.lock().unwrap();
        config.add_open_project(path);
        config.set_active_open_project(path);
        save_config_disk(app, &config)?;
    }

    let payload = serde_json::json!({ "path": path });
    app.emit("project_changed", &payload).ok();

    Ok(())
}

/// Multi-projets (spec_multiprojects.md) : liste les projets ouverts + le projet
/// actif, pour l'afficheur UI et le web-remote.
#[tauri::command]
fn list_open_projects(state: State<AppState>) -> Vec<String> {
    let projects = state.projects.lock().unwrap();
    let mut list: Vec<String> = projects.keys().cloned().collect();
    list.sort();
    list
}

/// Multi-projets (spec_multiprojects.md) : chemin du projet actif (pour le
/// web-remote et l'afficheur UI).
#[tauri::command]
fn get_active_project(state: State<AppState>) -> Option<String> {
    state.active_project.lock().unwrap().clone()
}

/// Multi-projets (spec_multiprojects.md) : restaure au démarrage les projets
/// ouverts au dernier arrêt (persistés dans la config). Enregistre chacun dans
/// la collection `projects` sans lancer de watcher ni de session RPC (l'actif
/// sera rouvert via le flux normal d'ouverture). Retourne la liste des projets
/// ouverts et le projet actif pour que le frontend les (re)charge.
#[tauri::command]
fn restore_open_projects(state: State<AppState>) -> (Vec<String>, Option<String>) {
    let cfg = state.config.lock().unwrap().clone();
    let mut open: Vec<String> = Vec::new();
    for p in &cfg.open_projects {
        if std::path::Path::new(p).exists() {
            open.push(p.clone());
        }
    }
    // Projet actif : doit appartenir aux projets ouverts existants.
    let active = cfg
        .active_open_project
        .filter(|p| open.contains(p))
        .or_else(|| open.first().cloned());

    // Enregistrer dans la collection sans watcher/session (l'actif sera rouvert
    // par le frontend via le flux normal → ceci devient l'état du projet actif).
    {
        let mut projects = state.projects.lock().unwrap();
        for p in &open {
            projects.entry(p.clone()).or_insert_with(|| ProjectState {
                path: p.clone(),
                watcher: None,
            });
        }
    }
    // Positionner le projet actif dans l'état global (le frontend rouvert
    // ensuite l'actif réellement via open_project_shared, mais on aligne déjà
    // la collection pour `set_active_project` / `list_open_projects`).
    if let Some(ref a) = active {
        *state.active_project.lock().unwrap() = Some(a.clone());
        *state.project_path.lock().unwrap() = Some(a.clone());
    }

    (open, active)
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
            // 5.1 : poser le handle d'application sur l'AgentService pour permettre
            // l'émission des événements `agent-state-changed` depuis les transitions
            // de session (start/pause/stop).
            state.agent_service.set_app_handle(handle.clone());
            // 5.2 : remettre l'état d'exécution des agents à « non chargé » au
            // démarrage (les processus pi sont morts après `shutdown_all` ;
            // `loaded` est un état runtime, pas une vérité persistée). Sans ce
            // reset, un agent `loaded=true` ne relancerait pas son processus à
            // l'ouverture de son onglet (lazy start).
            let _ = state.agent_service.reset_runtime_state(&handle);
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
            // Purge automatique des sessions (H9) : thread autonome qui supprime
            // les sessions pi plus anciennes que le délai de rétention configuré
            // (session_retention_days, défaut 15) pour tous les projets ouverts.
            session_history::start_session_purge(handle.clone());
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
                projects: Mutex::new(HashMap::new()),
                active_project: Mutex::new(None),
                config: Mutex::new(AppConfig::default()),
                watch_state: Mutex::new(None),
                terminals: Mutex::new(HashMap::new()),
                agent_service: Arc::new(agent_service::AgentService::new()),
                event_tx,
                auth: Arc::new(web_auth::WebAuth::new()),
                guard: Arc::new(web_rate::WebGuard::new()),
                audit: Arc::new(web_audit::WebAudit::new()),
                web_shutdown: std::sync::Mutex::new(None),
                ext_gate_cache: std::sync::Mutex::new(None),
                agent_activity: Arc::new(Mutex::new(HashMap::new())),
                web_runs: Mutex::new(HashMap::new()),
                working_project: Mutex::new(None),
                vault_key: Mutex::new(None),
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_project_path,
            set_active_project,
            list_open_projects,
            get_active_project,
            restore_open_projects,
            files::read_file_content,
            files::get_file_info,
            files::read_file_binary,
            files::write_file_content,
            files::write_file_binary,
            files::write_context_handoff,
            files::read_project_commands,
            files::save_project_commands,
            files::file_exists,
            files::file_mtime,
            files::get_file_size,
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
            terminal::spawn_terminal_command,
            terminal::write_to_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            rpc::start_agent_session,
            rpc::stop_agent_session,
            rpc::park_agent_session,
            rpc::send_rpc_command,
            rpc::send_agent_command_to,
            rpc::get_agent_event_channel,
            rpc::get_agent_state,
            rpc::get_project_agent_states,
            rpc::get_session_stats,
            rpc::model_supports_images,
            rpc::send_agent_prompt,
            rpc::abort_agent,
            rpc::new_agent_session,
            rpc::purge_agent_conversation,
            session_history::resume_agent_session,
            rpc::get_agent_messages,
            rpc::set_agent_model,
            rpc::list_agent_models,
            rpc::list_agent_commands,
            agents::check_model_reachable,
            agents::execute_agent_bash,
            agents::compact_agent_context,
            session_history::list_sessions,
            rpc::send_inline_prompt,
            agents::convert_pdf_to_md_ai,
            tabs::save_tab_session,
            tabs::load_tab_session,
            project_agents::read_project_agents,
            project_agents::write_project_agents,
            search::search_in_files,
            code_check::lint_file,
            search::replace_in_files,
            agents::get_available_models_list,
            interproject::get_project_links,
            interproject::set_project_links,
            interproject::remove_project_link,
            interproject::interproject_handoff,
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
            set_project_sensitive,
            is_project_sensitive,
            plan::save_plan,
            plan::load_plan,
            plan::delete_plan,
            code_check::check_syntax,
            code_check::run_project_tests,
            extension_gate_supported,
            get_backend_info,
            pi_health_check,
            pi_update::check_pi_update,
            pi_update::update_pi,
            git::git_status,
            git::git_diff_file,
            git::git_create_snapshot,
            git::git_restore_snapshot,
            rpc::start_reviewer_session,
            rpc::stop_reviewer_session,
            rpc::send_reviewer_prompt,
            rpc::new_reviewer_session,
            rpc::set_reviewer_model,
            rpc::abort_reviewer,
            rpc::get_reviewer_state,
            // ── Gestion d'agents multi-rôles (H2 V2) ──
            agents::reset_agent_registry,
            // ── Refonte système d'agents (cahier §3.1) : objet Agent en base ──
            agent_service::list_agents,
            agent_service::get_agent,
            agent_service::upsert_agent,
            agent_service::replace_agents,
            agent_service::set_agent_visible,
            agent_service::set_agent_state,
            agent_service::list_agent_views,
            agent_service::save_agent_views,
            agent_service::list_agent_sessions,
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
            code_graph::graph_status,
            code_graph::build_code_graph,
            code_graph::query_code_graph,
            code_graph::graph_explain,
            code_graph::graph_affected,
            code_graph::graph_path,
            code_graph::build_graph_wiki,
            code_graph::graph_export,
            session_history::index_sessions,
            session_history::get_agent_sessions,
            session_history::search_sessions,
            session_history::get_session_detail,
            session_history::get_delegation_result,
            session_history::set_session_tags,
            session_history::list_session_tags,
            session_history::record_session_entry,
            // ── Super-agent (spec_super_agent.md) ──
            super_agent::start_super_agent_session,
            super_agent::stop_super_agent_session,
            super_agent::send_super_agent_prompt,
            super_agent::send_super_agent_command,
            super_agent::ask_super_agent,
            super_agent::new_super_agent_session,
            super_agent::set_super_agent_model,
            super_agent::set_super_agent_working_project,
            super_agent::super_agent_db_query,
            super_agent::super_agent_db_execute,
            super_agent::super_agent_schedule_create,
            super_agent::super_agent_schedule_delete,
            super_agent::super_agent_schedule_list,
            super_agent::super_agent_schedule_tick,
            super_agent::abort_super_agent,
            super_agent::get_super_agent_state,
            super_agent::get_super_agent_config,
            super_agent::set_super_agent_config,
            super_agent::set_super_agent_prompt,
            super_agent::set_super_agent_open,
            super_agent::set_super_agent_user_memory,
            super_agent::set_super_agent_personality,
            super_agent::analyze_super_agent_personality,
            super_agent::inject_session_summary,
            super_agent::initialize_super_agent,
            super_agent::list_clients,
            super_agent::add_client,
            super_agent::remove_client,
            super_agent::rename_client,
            super_agent::set_project_client,
            super_agent::list_super_agent_projects,
            super_agent::query_super_agent,
            // ── Tableau de bord projet (issue #51) ──
            dashboard::get_project_dashboard,
            dashboard::get_project_tracking,
            // ── Coffre fort de mots de passe (issue #52) ──
            vault::vault_status,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_set_master_password,
            vault::vault_list,
            vault::vault_add,
            vault::vault_update,
            vault::vault_delete,
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
                // Issue #14 : arrêt COMPLET de toutes les sessions RPC (principale,
                // reviewer, parkées par projet, agents multi-rôles) pour éviter que
                // des processus `pi`/`plh.exe` restent en mémoire après la fermeture
                // (sur Windows un enfant ne meurt pas avec son parent).
                {
                    let state = app.state::<AppState>();
                    rpc::do_shutdown_all_sessions(&state);
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
