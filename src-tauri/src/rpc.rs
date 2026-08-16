// rpc.rs — Agent RPC (pi --mode rpc) : sessions, prompts, reviewer, sonde backend.
//
// Domaine extrait de `lib.rs` (2026-08) : démarrage/arrêt de sessions agent pi,
// envoi de commandes RPC, prompts (normal + inline), gestion du reviewer, et
// sondage du backend (pi/plh, support `--extension`). Inclut les helpers
// partagés `run_captured` et `resolve_agent_home` (pub(crate), réexportés par
// lib.rs pour les autres modules).

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

use crate::agent_service::SpawnMode;
use crate::rpc_manager;

/// Multi-projets (spec_multiprojects.md §3) : canal d'événements Tauri dédié à
/// la session agent d'un projet donné (`rpc-event-<hash>`). Chaque projet émet
/// sur son propre canal → les événements d'un agent d'un projet inactif (parké
/// en arrière-plan) ne polluent pas le chat du projet actif. Le frontend écoute
/// le canal du projet actif via `get_agent_event_channel`.
pub(crate) fn project_event_channel(path: &str) -> String {
    // FNV-1a 32 bits (déterministe, cohérent avec le hash JS du frontend).
    let mut hash: u32 = 0x811c9dc5;
    for b in path.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("rpc-event-{:08x}", hash)
}

/// Id d'agent par défaut (onglet agent unique, rétrocompat).
pub(crate) const DEFAULT_AGENT_ID: &str = "default";

/// Normalise un id d'agent (None/vide → "default").
pub(crate) fn normalize_agent_id(agent_id: Option<&str>) -> String {
    let a = agent_id.unwrap_or("").trim();
    if a.is_empty() { DEFAULT_AGENT_ID.to_string() } else { a.to_string() }
}

/// Décision du garde-fou de `do_start_agent_session` (pur, testable) : retourne
/// `true` s'il faut BLOQUER le démarrage parce qu'une session d'un AUTRE agent
/// est déjà active et vivante.
///
/// - `active_id` : agent actuellement actif (None si rien d'affiché).
/// - `agent_id` : agent qu'on veut démarrer/reprendre.
/// - `active_alive` : l'agent actif est-il vivant ? (sinon c'est un orphelin à
///   nettoyer, on ne bloque pas).
///
/// Règle (issue #64) : on bloque UNIQUEMENT si un agent DIFFÉRENT est actif ET
/// vivant. Le MÊME agent (reprise idempotente par `AgentService::start`) ou un
/// agent mort (orphelin nettoyé par `clear_active_if_dead`) ne bloquent pas —
/// sinon l'agent invisible devenait injoignable tant que sa 1ʳᵉ session vivait.
fn should_block_start(active_id: Option<&str>, agent_id: &str, active_alive: bool) -> bool {
    match active_id {
        Some(a) => a != agent_id && active_alive,
        None => false,
    }
}

/// Multi-onglets agents (spec_multi_agents) : canal d'événements d'une session
/// agent d'un projet. L'agent par défaut conserve le canal hérité
/// `rpc-event-<hash>` (rétrocompat) ; les onglets supplémentaires utilisent
/// `rpc-event-<hash>-<agentid>` pour que chaque agent émette sur son propre
/// canal et que les chats ne se polluent pas.
pub(crate) fn agent_event_channel(path: &str, agent_id: &str) -> String {
    let base = project_event_channel(path);
    if agent_id == DEFAULT_AGENT_ID {
        base
    } else {
        format!("{}-{}", base, agent_id)
    }
}

/// Multi-projets : retourne le canal d'événements de la session du projet actif,
/// pour que le frontend écoute le bon canal lors de la création de l'onglet agent.
/// `agent_id` : id de l'agent (None/vide → agent par défaut).
/// A13 (assistant headless multi-projets) : un `project_path` explicite permet
/// d'écouter le canal d'un projet NON actif (délégation headless). Sinon, on
/// retombe sur le projet actif.
#[tauri::command]
pub fn get_agent_event_channel(state: State<AppState>, agent_id: Option<String>, project_path: Option<String>) -> Result<String, String> {
    let project = match project_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => p,
        None => state
            .project_path
            .lock()
            .unwrap()
            .clone()
            .ok_or("Aucun projet ouvert")?,
    };
    Ok(agent_event_channel(&project, &normalize_agent_id(agent_id.as_deref())))
}
use crate::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use crate::CREATE_NO_WINDOW;

#[derive(Clone)]
pub(crate) struct BackendProbe {
    pub(crate) kind: String,
    pub(crate) ext_supported: bool,
}

/// Sondage du backend : exécute `<pi_path> --version` (genre : "pi" / "plh" /
/// "unknown") et `--help` (présence de `--extension`). Mis en cache dans
/// `ext_gate_cache` (re-sondé si `pi_path` change). Bloquant mais borné (~3s par
/// commande). Évite de planter un backend qui ne supporte pas `--extension`
/// (ex: plh sans le flag → clap rejette l'arg et sort → « pipe closed »).
pub(crate) fn probe_backend(state: &AppState, pi_path: &str) -> BackendProbe {
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
pub(crate) fn probe_extension_support(state: &AppState, pi_path: &str) -> bool {
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
pub(crate) fn kind_from_version_output(out: &str) -> String {
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

/// Fenêtre (s) pendant laquelle un projet reste « occupé » après sa dernière
/// activité RPC, même après un `agent_settled`. Évite que la pastille n'oscille
/// en « en attente » entre deux sous-tâches d'un même plan d'orchestration
/// (chaque `agent_settled` termine une exécution, mais le plan global continue).
pub(crate) const ACTIVITY_GRACE_SECS: u64 = 15;

/// Événements RPC considérés comme une activité de l'agent (maintiennent le
/// projet « occupé »). `agent_start`/`agent_settled` basculent le drapeau busy ;
/// tous rafraîchissent `updated` pour la fenêtre de grâce anti-flicker.
const ACTIVITY_EVENTS: &[&str] = &[
    "agent_start",
    "agent_end",
    "agent_settled",
    "turn_start",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "compaction_start",
    "compaction_end",
    "auto_retry_start",
    "auto_retry_end",
];

/// Construit l'observateur d'événements RPC qui alimente la map d'activité par
/// projet (issue #13). Sur `agent_start` → busy=true ; sur `agent_settled` →
/// busy=false (fin définitive d'une exécution, après retries/compaction).
/// `ACTIVITY_EVENTS` rafraîchit `updated` (base de la fenêtre de grâce anti-flicker).
pub(crate) fn make_project_activity_observer(
    map: &Arc<Mutex<HashMap<String, crate::SessionActivity>>>,
    project_key: &str,
) -> rpc_manager::EventObserver {
    let map = map.clone();
    let key = project_key.to_string();
    Arc::new(move |value: &Value| {
        let t = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if !ACTIVITY_EVENTS.contains(&t) {
            return;
        }
        let mut m = map.lock().unwrap();
        let now = std::time::Instant::now();
        let entry = m.entry(key.clone()).or_insert(crate::SessionActivity {
            busy: false,
            updated: now,
        });
        if t == "agent_start" {
            entry.busy = true;
        } else if t == "agent_settled" {
            entry.busy = false;
        }
        entry.updated = now;
    })
}

/// Réinitialise le drapeau d'activité d'un projet (arrêt de session / fermeture).
pub(crate) fn reset_project_activity(state: &AppState, project_key: &str) {
    let mut m = state.agent_activity.lock().unwrap();
    if let Some(e) = m.get_mut(project_key) {
        e.busy = false;
        // Mettre `updated` dans le passé pour sortir aussi de la fenêtre de grâce :
        // un agent réellement stoppé/fermé doit passer « en attente » immédiatement.
        e.updated = std::time::Instant::now()
            - std::time::Duration::from_secs(ACTIVITY_GRACE_SECS + 1);
    }
}

/// Issue #13 : état d'activité des agents de TOUS les projets ouverts, sous forme
/// de map `{ chemin_normalisé: { "busy": bool } }`. Permet à la barre « Projets
/// en cours » d'afficher une pastille « travaille en arrière-plan » par projet,
/// même quand son agent est parké (inactif en apparence).
#[tauri::command]
pub fn get_project_agent_states(state: State<AppState>) -> Result<Value, String> {
    let projects = state.projects.lock().unwrap();
    let keys: Vec<String> = projects.keys().cloned().collect();
    drop(projects);
    let activity = state.agent_activity.lock().unwrap();
    let now = std::time::Instant::now();
    let grace = std::time::Duration::from_secs(ACTIVITY_GRACE_SECS);
    let mut map = serde_json::Map::new();
    for k in keys {
        // Un projet reste « occupé » tant que busy OU qu'une activité récente
        // (fenêtre de grâce) : évite le flicker « prêt » entre deux sous-tâches
        // d'un plan orchestration encore en cours.
        let busy = activity
            .get(&k)
            .map(|a| a.busy || now.duration_since(a.updated) < grace)
            .unwrap_or(false);
        map.insert(k, serde_json::json!({ "busy": busy }));
    }
    Ok(Value::Object(map))
}

pub(crate) fn do_start_agent_session(state: &AppState, app: &AppHandle, agent_id: Option<&str>, project_path: Option<&str>) -> Result<bool, String> {
    let agent_id = normalize_agent_id(agent_id);
    // A13 (assistant headless multi-projets) : un `project_path` explicite
    // permet de démarrer l'agent d'un projet NON actif en arrière-plan (sans
    // ouvrir le projet ni l'onglet). Sinon, on retombe sur le projet actif.
    let cwd = match project_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => p.to_string(),
        None => state
            .project_path
            .lock()
            .unwrap()
            .clone()
            .ok_or("Aucun projet ouvert")?,
    };

    // Garde-fou anti-orphan : un pointeur `active` peut subsister alors que la
    // session pointée est morte (ex: délégation ayant spawné un agent puis dont
    // la session a disparu sans nettoyer le pointeur). Sans vérification de
    // vivacité, TOUTE délégation suivante échouerait silencieusement avec
    // « Une session agent est déjà active » (aucun commit, aucune session
    // visible). Si l'agent actif est mort/absent, on nettoie le pointeur et on
    // continue (débloque les délégations) ; s'il est vivant, on conserve
    // l'erreur « déjà active ».
    // A13 : ce garde-fou ne concerne QUE le projet actif (le pointeur `active`
    // ne désigne que l'agent affiché du projet actif). Pour un projet non actif
    // (délégation headless), on ne touche pas au pointeur actif.
    //
    // Issue #64 (agent invisible) : on ne bloque PAS la reprise du MÊME agent.
    // Quand l'assistant délègue à nouveau à l'agent invisible déjà vivant, le
    // pointeur `active` désigne ce même agent et sa session est vivante : il
    // faut LA REPRENDRE (envoyer le nouveau prompt), pas errorer « déjà active ».
    // `AgentService::start` est idempotent (reprend la session vivante) — on ne
    // bloque donc que si un agent DIFFÉRENT est actif et vivant.
    let is_active_project = {
        let active = state.project_path.lock().unwrap().clone();
        active.as_deref() == Some(cwd.as_str())
    };
    if is_active_project {
        if let Some(active_id) = state.agent_service.active_agent() {
            // Agent actif DIFFÉRENT de celui qu'on veut démarrer : nettoyer
            // l'orphelin s'il est mort, sinon bloquer (vraie session concurrente).
            let active_alive = state.agent_service.agent_alive(&cwd, &active_id);
            if should_block_start(Some(&active_id), &agent_id, active_alive) {
                return Err("Une session agent est déjà active".to_string());
            }
            // Orphelin (agent actif mort) : nettoyer le pointeur pour débloquer.
            if !active_alive {
                state.agent_service.clear_active();
            }
            // Même agent vivant : on tombe à `start` qui reprend la session (idempotent).
        }
    }

    // Déléguer le démarrage/reprise à l'AgentService (session principale,
    // canal projet). Le registre unique (clé composite
    // (projet, agent)) est la source de vérité des sessions : si une session
    // parkée vivante existe pour (cwd, agent_id) — multi-projets / multi-onglets
    // agents — elle est reprise (processus pi toujours vivant, pas de relance,
    // l'historique est conservé) et la méthode retourne `true` ; sinon un
    // nouveau processus pi est lancé (`false`). Le spawn (config, skill
    // quality-gate, extensions pi, observateur d'activité) est géré par
    // `AgentService::spawn_session` ; le pointeur `active` du service devient la
    // source de vérité de l'agent affiché.
    let (pi_path, no_session) = {
        let config = state.config.lock().unwrap();
        (config.rpc_pi_path.clone(), config.rpc_no_session)
    };
    state.agent_service.start(
        app,
        &cwd,
        &agent_id,
        &pi_path,
        no_session,
        SpawnMode::MainSession,
    )?;
    Ok(false)
}

#[tauri::command]
pub fn start_agent_session(state: State<AppState>, app: AppHandle, agent_id: Option<String>, project_path: Option<String>) -> Result<bool, String> {
    do_start_agent_session(state.inner(), &app, agent_id.as_deref(), project_path.as_deref())
}

/// Multi-projets (spec_multiprojects.md §3) : « parke » la session agent du
/// projet actif SANS tuer le processus pi (vrai multi-agent en arrière-plan).
/// À la bascule, `do_start_agent_session` reprend la session parkée au lieu
/// d'en relancer une. Idempotent : no-op si aucune session active ou si le
/// projet actif est inconnu.
/// Multi-onglets agents (spec_multi_agents) : `agent_id` indexe la session
/// parkée (None/vide → agent par défaut).
/// Le parking vit dans l'AgentService (registre unique, clé composite
/// (projet, agent)) — la session reste dans le registre, marquée Parked,
/// processus pi vivant conservé.
pub(crate) fn do_park_agent_session(state: &AppState, agent_id: Option<&str>) -> Result<(), String> {
    // None → parker l'agent actif (rétrocompat des appelants existants).
    let agent_id = match agent_id {
        Some(a) => normalize_agent_id(Some(a)),
        None => state.agent_service.active_agent()
            .unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
    };
    let active = state.active_project.lock().unwrap().clone();
    let Some(active_path) = active else {
        return Ok(()); // aucun projet actif
    };
    // Marquer la session (projet, agent) comme Parkée dans l'AgentService ; le
    // pointeur actif est remis à None si c'était l'agent affiché. No-op si la
    // session n'existe pas (rien à parker).
    let _ = state.agent_service.pause(&active_path, &agent_id);
    Ok(())
}

#[tauri::command]
pub fn park_agent_session(state: State<AppState>, agent_id: Option<String>) -> Result<(), String> {
    do_park_agent_session(state.inner(), agent_id.as_deref())
}

/// Arrête l'agent pi en cours (s'il existe) et libère la session. Idempotent : no-op
/// si aucune session n'est active. Multi-onglets agents : `agent_id` cible l'agent
/// à arrêter (None/vide → agent par défaut). L'agent ciblé (actif ou parké) est
/// retiré du registre unique de l'AgentService et son processus pi est tué.
/// A13 (assistant headless multi-projets) : un `project_path` explicite permet
/// d'arrêter l'agent d'un projet NON actif (délégation headless). Sinon, on
/// retombe sur le projet actif.
pub(crate) fn do_stop_agent_session(state: &AppState, agent_id: Option<&str>, project_path: Option<&str>) {
    // None → arrêter l'agent actif (rétrocompat des appelants existants).
    let agent_id = match agent_id {
        Some(a) => normalize_agent_id(Some(a)),
        None => state.agent_service.active_agent()
            .unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
    };
    let active = state.agent_service.active_agent();
    let project = match project_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => Some(p.to_string()),
        None => state.project_path.lock().unwrap().clone(),
    };
    if active.as_deref() == Some(agent_id.as_str()) {
        // Issue #13 : remettre le projet actif à « libre » quand une session
        // est réellement arrêtée (pas lors d'un parking, où le processus pi
        // continue de travailler en arrière-plan).
        if let Some(project) = &project {
            reset_project_activity(state, project);
        }
    }
    // La session (active ou parkée) vit dans le registre unique de
    // l'AgentService (clé composite (projet, agent)). `stop` la retire et tue
    // le processus pi ; no-op si aucune session pour (projet, agent).
    if let Some(project) = project {
        let _ = state.agent_service.stop(&project, &agent_id);
    }
    // Bug 4 : le reviewer (H2 V1) est INDÉPENDANT de la session principale ; il
    // ne doit PAS être tué à chaque arrêt de celle-ci. Son cycle de vie est lié
    // au cycle d'orchestration (démarré/arrêté explicitement via
    // start_reviewer_session / stop_reviewer_session / orchestration).
}

#[tauri::command]
pub fn stop_agent_session(state: State<AppState>, agent_id: Option<String>, project_path: Option<String>) -> Result<(), String> {
    do_stop_agent_session(state.inner(), agent_id.as_deref(), project_path.as_deref());
    Ok(())
}

/// Arrêt COMPLET de TOUTES les sessions RPC à la fermeture de Pilot.
/// Corrige l'issue #14 (processus `plh.exe`/`pi` qui restent en mémoire) :
/// sur Windows un processus enfant ne meurt pas automatiquement quand son
/// parent meurt, il faut donc tuer explicitement chaque session encore
/// vivante. Couvre :
///  - la session principale (chat Agent Pi),
///  - la session reviewer (`orch-reviewer`),
///  - les sessions « parkées » par projet / par onglet agent (clé composite
///    (projet, agent), multi-projets / multi-onglets),
///  - les sessions des agents multi-rôles (H2 V2),
///  - la session super-agent (Assistant, id `superagent`).
pub(crate) fn do_shutdown_all_sessions(state: &AppState) {
    // `shutdown_all` arrête TOUTES les sessions du registre unique de
    // l'AgentService et réinitialise le pointeur actif : session active du chat
    // Agent Pi + agents multi-rôles (H2 V2) + sessions parkées par projet / par
    // onglet agent (clé composite (projet, agent)) + reviewer (orch-reviewer)
    // + super-agent (id `superagent`).
    state.agent_service.shutdown_all();
}

#[tauri::command]
pub fn send_rpc_command(state: State<AppState>, command: Value) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command(session, &command)
    })?
}

/// Relais des choix d'agent via l'assistant (tâche de suivi #22).
///
/// Envoie une commande (ex: `extension_ui_response`) à la session agent d'un
/// projet donné, identifiée par (project_path, agent_id). L'AgentService étant
/// la source unique de vérité des sessions (clé composite (projet, agent)), le
/// routage se réduit à une consultation directe de son registre
/// (`AgentService.send`).
///
/// Permet de répondre à un bouton de question rendu dans le chat de l'assistant
/// en routant la réponse vers LE bon agent, sans mélanger les réponses quand
/// plusieurs agents sont en attente (exigence multi-agents).
#[tauri::command]
pub fn send_agent_command_to(
    state: State<AppState>,
    project_path: Option<String>,
    agent_id: Option<String>,
    command: Value,
) -> Result<(), String> {
    let agent_id = normalize_agent_id(agent_id.as_deref());
    // Résoudre le projet : explicitement fourni, sinon le projet actif (les
    // sessions agents vivent toutes dans le registre unique, clé (projet, agent)
    // — `active_project` et `project_path` sont maintenus synchronisés).
    let project = match project_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => p,
        None => state
            .active_project
            .lock()
            .unwrap()
            .clone()
            .ok_or("Aucun projet ouvert")?,
    };
    state.agent_service.send(&project, &agent_id, command)
}

pub(crate) fn do_get_agent_state(state: &AppState) -> Result<Value, String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync_timeout(session, cmd, 8)
    })?
}

#[tauri::command]
pub fn get_agent_state(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_state(state.inner())
}

#[tauri::command]
pub fn get_session_stats(state: State<AppState>) -> Result<Value, String> {
    do_get_session_stats(state.inner())
}

pub(crate) fn do_get_session_stats(state: &AppState) -> Result<Value, String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "get_session_stats" });
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync(session, cmd)
    })?
}

/// Résout le répertoire home du programme RPC (pi, plh, ...) à partir du chemin
/// de l'exécutable configuré. Convention : ~/.<stem> où <stem> est le nom de
/// l'exécutable sans extension (plh.exe → ~/.plh, pi → ~/.pi). Si pi_path est
/// vide, utilise "pi" par défaut. Permet à Pilot de fonctionner avec n'importe
/// quel programme compatible pi en RPC sans chemin en dur.
pub(crate) fn resolve_agent_home(pi_path: &str) -> Result<std::path::PathBuf, String> {
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
pub fn model_supports_images(provider: String, model_id: String, state: State<AppState>) -> Result<bool, String> {
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
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let mut cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    if let Some(ref imgs) = images {
        if !imgs.is_empty() {
            cmd["images"] = Value::Array(imgs.clone());
        }
    }
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command(session, &cmd)
    })?
}

#[tauri::command]
pub fn send_agent_prompt(
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
pub fn send_inline_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command(session, &cmd)
    })?
}

pub(crate) fn do_abort_agent(state: &AppState) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "abort" });
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command(session, &cmd)
    })?
}

#[tauri::command]
pub fn abort_agent(state: State<AppState>) -> Result<(), String> {
    do_abort_agent(state.inner())
}

pub(crate) fn do_new_agent_session(state: &AppState) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "new_session" });
    // SYNCHRONE : on attend que pi ait terminé le new_session avant de retourner.
    // new_session réinitialise le modèle au modèle par défaut de pi — si on ne l'attend
    // pas, un set_model suivant peut être appliqué AVANT le reset, puis annulé par le
    // new_session traité tardivement (bascule orchestrateur/codeur perdu).
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync(session, cmd).map(|_| ())
    })?
}

#[tauri::command]
pub fn new_agent_session(state: State<AppState>) -> Result<(), String> {
    do_new_agent_session(state.inner())
}

/// Purge la conversation de l'agent (équivalent au clic sur « + » de l'onglet
/// agent) en préservant le modèle actif. Utilisé par l'Assistant (🧭) à la
/// demande via l'outil `purge_agent_conversation` (début de conversation ou
/// arrêt de l'agent).
///
/// `new_session` réinitialise le modèle au modèle par défaut de pi — on capture
/// donc le modèle actif (get_state) avant la purge et on le ré-applique après,
/// pour ne pas perdre le choix de modèle de l'utilisateur.
#[tauri::command]
pub fn purge_agent_conversation(state: State<AppState>) -> Result<(), String> {
    do_purge_agent_conversation(state.inner())
}

pub(crate) fn do_purge_agent_conversation(state: &AppState) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    state.agent_service.with_active_session(&project, |session| {
        let model = get_current_model(session);
        let cmd = serde_json::json!({ "type": "new_session" });
        rpc_manager::send_command_sync(session, cmd).ok();
        if let Some((provider, model_id)) = model {
            let set_cmd = serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            });
            rpc_manager::send_command_sync(session, set_cmd).ok();
        }
        Ok(())
    })?
}

/// Lit le modèle actuellement actif (provider/id) de la session pi via
/// get_state, s'il est disponible.
fn get_current_model(session: &mut rpc_manager::RpcSession) -> Option<(String, String)> {
    let cmd = serde_json::json!({ "type": "get_state" });
    if let Ok(resp) = rpc_manager::send_command_sync_timeout(session, cmd, 8) {
        if let Some(model) = resp.get("data").and_then(|d| d.get("model")) {
            let provider = model
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let id = model
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !provider.is_empty() && !id.is_empty() {
                return Some((provider, id));
            }
        }
    }
    None
}

pub(crate) fn do_get_agent_messages(state: &AppState) -> Result<Value, String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "get_messages" });
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync(session, cmd)
    })?
}

#[tauri::command]
pub fn get_agent_messages(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_messages(state.inner())
}

pub(crate) fn do_set_agent_model(
    state: &AppState,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({
        "type": "set_model",
        "provider": provider,
        "modelId": model_id
    });
    let resp = state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync(session, cmd)
    })??;
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
pub fn set_agent_model(
    state: State<AppState>,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    do_set_agent_model(state.inner(), provider, model_id)
}

pub(crate) fn do_list_agent_models(state: &AppState) -> Result<Value, String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({"type": "get_available_models"});
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync_timeout(session, cmd, 12)
    })?
}

#[tauri::command]
pub fn list_agent_models(state: State<AppState>) -> Result<Value, String> {
    do_list_agent_models(state.inner())
}

#[tauri::command]
pub fn list_agent_commands(state: State<AppState>) -> Result<Value, String> {
    let project = state.active_project.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({"type": "get_commands"});
    state.agent_service.with_active_session(&project, |session| {
        rpc_manager::send_command_sync(session, cmd)
    })?
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

    state.agent_service.start_reviewer(app, &cwd, &pi_path)
}

#[tauri::command]
pub fn start_reviewer_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_reviewer_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    state.agent_service.stop_reviewer(&project);
    Ok(())
}

pub(crate) fn do_send_reviewer_prompt(state: &AppState, message: String) -> Result<(), String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "prompt", "message": message });
    state.agent_service.send_reviewer(&project, cmd)
}

#[tauri::command]
pub fn send_reviewer_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    do_send_reviewer_prompt(state.inner(), message)
}

#[tauri::command]
pub fn new_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({"type": "new_session"});
    state.agent_service.send_reviewer_sync(&project, cmd).map(|_| ())
}

#[tauri::command]
pub fn set_reviewer_model(state: State<AppState>, provider: String, model_id: String) -> Result<(), String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
    let resp = state.agent_service.send_reviewer_sync(&project, cmd)?;
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("set_model a échoué").to_string();
        return Err(format!("pi a refusé set_model (reviewer) : {}", err));
    }
    Ok(())
}

#[tauri::command]
pub fn abort_reviewer(state: State<AppState>) -> Result<(), String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    state.agent_service.send_reviewer(&project, serde_json::json!({"type": "abort"}))
}

#[tauri::command]
pub fn get_reviewer_state(state: State<AppState>) -> Result<Value, String> {
    let project = state.project_path.lock().unwrap().clone().ok_or("Aucun projet ouvert")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    state.agent_service.send_reviewer_sync_timeout(&project, cmd, 8)
}

#[cfg(test)]
mod tests {
    use super::{kind_from_version_output, should_block_start};

    #[test]
    fn kind_pi_version() {
        // Sortie `pi --version` : numéro de version en tête
        assert_eq!(kind_from_version_output("0.80.10\n"), "pi");
        assert_eq!(kind_from_version_output("  0.80.10"), "pi");
        assert_eq!(kind_from_version_output("1.2.3-alpha"), "pi");
    }

    #[test]
    fn kind_plh_prefix() {
        // Sortie `plh --version` : préfixe "plh"
        assert_eq!(kind_from_version_output("plh 0.1.0"), "plh");
        assert_eq!(kind_from_version_output("PLH 0.1.0\n"), "plh");
        assert_eq!(kind_from_version_output("plh"), "plh");
    }

    #[test]
    fn kind_plh_wins_over_version() {
        // Une sortie qui commence par "plh" mais contient un chiffre ne doit
        // pas être détectée comme "pi" : le préfixe plh est prioritaire.
        assert_eq!(kind_from_version_output("plh 0.80.10"), "plh");
    }

    #[test]
    fn kind_unknown() {
        // Sorties inattendues / vides → "unknown"
        assert_eq!(kind_from_version_output(""), "unknown");
        assert_eq!(kind_from_version_output("   \n\t"), "unknown");
        assert_eq!(kind_from_version_output("command not found"), "unknown");
        assert_eq!(kind_from_version_output("hello"), "unknown");
    }

    #[test]
    fn kind_leading_word_digit() {
        // Un mot en tête qui commence par un chiffre est un indice "pi"
        assert_eq!(kind_from_version_output("0.9.2\n"), "pi");
        // Un mot en tête qui ne commence pas par un chiffre → unknown
        assert_eq!(kind_from_version_output("version 0.9.2"), "unknown");
    }

    // Issue #64 : le garde-fou de `do_start_agent_session` ne doit PAS bloquer
    // la reprise du MÊME agent (agent invisible déjà vivant). Il ne bloque que
    // si un agent DIFFÉRENT est actif et vivant.
    #[test]
    fn should_block_start_allows_same_agent_resume() {
        // Même agent, vivant → ne PAS bloquer (reprise idempotente).
        assert!(!should_block_start(Some("default"), "default", true));
        // Même agent, mort → ne PAS bloquer (orphelin à nettoyer).
        assert!(!should_block_start(Some("default"), "default", false));
        // Aucun agent actif → ne PAS bloquer.
        assert!(!should_block_start(None, "default", false));
    }

    #[test]
    fn should_block_start_blocks_different_alive_agent() {
        // Agent différent vivant → bloquer (vraie session concurrente).
        assert!(should_block_start(Some("codeur"), "default", true));
        // Agent différent mort → ne PAS bloquer (orphelin à nettoyer).
        assert!(!should_block_start(Some("codeur"), "default", false));
    }
}
