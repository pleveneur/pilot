// rpc.rs — Agent RPC (pi --mode rpc) : sessions, prompts, reviewer, sonde backend.
//
// Domaine extrait de `lib.rs` (2026-08) : démarrage/arrêt de sessions agent pi,
// envoi de commandes RPC, prompts (normal + inline), gestion du reviewer, et
// sondage du backend (pi/plh, support `--extension`). Inclut les helpers
// partagés `run_captured` et `resolve_agent_home` (pub(crate), réexportés par
// lib.rs pour les autres modules).

use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

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
#[tauri::command]
pub fn get_agent_event_channel(state: State<AppState>, agent_id: Option<String>) -> Result<String, String> {
    let project = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    Ok(agent_event_channel(&project, &normalize_agent_id(agent_id.as_deref())))
}
use crate::session_history;
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
const ACTIVITY_GRACE_SECS: u64 = 15;

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
fn make_project_activity_observer(
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

pub(crate) fn do_start_agent_session(state: &AppState, app: &AppHandle, agent_id: Option<&str>) -> Result<bool, String> {
    let agent_id = normalize_agent_id(agent_id);
    let project = state.project_path.lock().unwrap();
    let cwd = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project);

    // Multi-projets (spec_multiprojects.md §3) : reprendre une session parkée du
    // projet actif si elle existe (vrai multi-agent) au lieu d'en relancer une.
    // Multi-onglets agents (spec_multi_agents) : la session parkée est indexée
    // par id d'agent dans `ProjectState.rpc` (processus pi toujours vivant) ; on
    // la remonte dans `rpc_state` pour reprendre exactement là où on en était.
    let resumed = {
        let mut projects = state.projects.lock().unwrap();
        projects
            .get_mut(&cwd)
            .and_then(|ps| ps.rpc.remove(&agent_id))
    };
    if let Some(mut session) = resumed {
        // Issue #48 : vérifier que le processus pi de la session parkée est
        // TOUJOURS vivant avant de la reprendre. Si le pi est mort pendant le
        // parking (crash, kill, redémarrage), reprendre la session donne une
        // session morte : `get_agent_messages` échoue (pipe fermé) → discussion
        // vide, aucun événement RPC reçu (agent_end jamais reçu → sessions non
        // persistées), et le statut reste bloqué en « streaming ». On jette la
        // session morte et on en démarre une nouvelle (l'historique pi reste
        // récupérable via list_sessions / index_sessions).
        let alive = session
            .child
            .try_wait()
            .map(|s| s.is_none())
            .unwrap_or(false);
        if alive {
            *state.rpc_state.lock().unwrap() = Some(session);
            *state.active_agent_id.lock().unwrap() = Some(agent_id);
            // Reprendre la session : pas de `new_session` (on garde l'historique).
            return Ok(true);
        }
        // Session morte : on la laisse tomber (try_wait a déjà récolté le
        // processus) et on démarre une nouvelle session ci-dessous.
        drop(session);
    }

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

    // Construire le répertoire de session avec le sous-dossier projet. Multi-
    // onglets agents : chaque agent a SON propre sous-dossier (`agent-<id>`) pour
    // une conversation indépendante ; l'agent par défaut garde le chemin hérité.
    let mut session_dir_resolved = if session_dir.is_empty() {
        resolve_agent_home(&pi_path)?.join("agent").join("sessions")
            .join(session_history::project_to_session_folder(&cwd))
    } else {
        std::path::PathBuf::from(&session_dir)
            .join(session_history::project_to_session_folder(&cwd))
    };
    if agent_id != DEFAULT_AGENT_ID {
        session_dir_resolved = session_dir_resolved.join(&agent_id);
    }
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

    // Extensions pi : pilot-edit-gate (porte pré-écriture A4 V2), pilot-context
    // (injection contexte/mémoire dans le system prompt — spec_context_engine /
    // spec_project_memory) et pilot-choices (boutons de choix/confirmation/saisie
    // — issue #30). `--extension` accepte plusieurs valeurs. Écrites dans le
    // dossier data depuis include_str! (imports type-only, effacés par jiti —
    // aucune dépendance npm).
    // - pilot-edit-gate : chargée UNIQUEMENT si `confirm_file_edits` est activé ET
    //   si le backend supporte `--extension`. Quand désactivé (défaut) ou non
    //   supporté (ex: plh sans le flag), elle n'est pas chargée → aucun surcharge,
    //   aucun blocage, l'agent écrit librement.
    // - pilot-context : chargée dès que `--extension` est supporté (indépendante
    //   de confirm_file_edits). No-op si Pilot n'écrit pas de fichier de handoff.
    // - pilot-choices : chargée dès que `--extension` est supporté (indépendante
    //   de confirm_file_edits). Enregistre des outils (ask_choice, ask_confirm,
    //   ask_input, ask_multi_choice) que le LLM peut appeler pour demander une
    //   interaction à l'utilisateur via des boutons rendus par Pilot.
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
                let choices_file = dir.join("pilot-choices.ts");
                if fs::write(&choices_file, include_str!("../extensions/pilot-choices.ts")).is_ok() {
                    extensions.push(choices_file.to_string_lossy().to_string());
                }
            }
        }
    }

    let channel = agent_event_channel(&cwd, &agent_id);
    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, no_session, &session_dir_str, skill_path.as_deref(), extensions, app.clone(), state.event_tx.clone(), &channel, None,
        // Issue #13 : observateur d'activité → map par projet (agent_start/settled).
        Some(make_project_activity_observer(&state.agent_activity, &cwd)),
        None,
    )
        .map_err(|e| {
            if pi_path.is_empty() {
                format!("{}. Installez pi (https://pi.dev) ou configurez le chemin dans les paramètres.", e)
            } else {
                format!("{}. Vérifiez le chemin dans les paramètres (Gestion RPC).", e)
            }
        })?;
    *rpc = Some(session);
    *state.active_agent_id.lock().unwrap() = Some(agent_id);

    // Démarrer une nouvelle session
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
    }

    Ok(false)
}

#[tauri::command]
pub fn start_agent_session(state: State<AppState>, app: AppHandle, agent_id: Option<String>) -> Result<bool, String> {
    do_start_agent_session(state.inner(), &app, agent_id.as_deref())
}

/// Multi-projets (spec_multiprojects.md §3) : « parke » la session agent du
/// projet actif dans `ProjectState.rpc` SANS tuer le processus pi (vrai
/// multi-agent en arrière-plan). À la bascule, `do_start_agent_session`
/// reprend la session parkée au lieu d'en relancer une. Idempotent : no-op si
/// aucune session active ou si le projet actif est inconnu.
/// Multi-onglets agents (spec_multi_agents) : `agent_id` indexe la session
/// parkée dans la map du projet (None/vide → agent par défaut).
pub(crate) fn do_park_agent_session(state: &AppState, agent_id: Option<&str>) -> Result<(), String> {
    // None → parker l'agent actif (rétrocompat des appelants existants).
    let agent_id = match agent_id {
        Some(a) => normalize_agent_id(Some(a)),
        None => state.active_agent_id.lock().unwrap().clone()
            .unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
    };
    let active = state.active_project.lock().unwrap().clone();
    let session = state.rpc_state.lock().unwrap().take();
    let Some(session) = session else {
        return Ok(()); // aucune session active
    };
    if let Some(ref active_path) = active {
        let mut projects = state.projects.lock().unwrap();
        if let Some(ps) = projects.get_mut(active_path) {
            ps.rpc.insert(agent_id, session);
            *state.active_agent_id.lock().unwrap() = None;
            return Ok(());
        }
        // Projet actif inconnu dans la collection → tuer pour éviter une fuite.
    }
    let mut session = session;
    rpc_manager::stop_session(&mut session);
    Ok(())
}

#[tauri::command]
pub fn park_agent_session(state: State<AppState>, agent_id: Option<String>) -> Result<(), String> {
    do_park_agent_session(state.inner(), agent_id.as_deref())
}

/// Arrête l'agent pi en cours (s'il existe) et libère la session. Idempotent : no-op
/// si aucune session n'est active. Multi-onglets agents : `agent_id` cible l'agent
/// à arrêter (None/vide → agent par défaut). Si l'agent ciblé n'est pas l'actif,
/// on arrête sa session parkée dans `ProjectState.rpc`.
pub(crate) fn do_stop_agent_session(state: &AppState, agent_id: Option<&str>) {
    // None → arrêter l'agent actif (rétrocompat des appelants existants).
    let agent_id = match agent_id {
        Some(a) => normalize_agent_id(Some(a)),
        None => state.active_agent_id.lock().unwrap().clone()
            .unwrap_or_else(|| DEFAULT_AGENT_ID.to_string()),
    };
    let active = state.active_agent_id.lock().unwrap().clone();
    if active.as_deref() == Some(agent_id.as_str()) {
        let mut rpc = state.rpc_state.lock().unwrap();
        if let Some(mut session) = rpc.take() {
            // Issue #13 : remettre le projet actif à « libre » UNIQUEMENT quand une
            // session a réellement été arrêtée. Dans le cas d'un parking (multi-
            // projets, session déjà déplacée dans `ProjectState.rpc`), `rpc_state`
            // est vide : le processus pi continue de travailler en arrière-plan et on
            // ne doit PAS éteindre sa pastille d'activité (issue #13 — indicateur sur
            // un projet non au premier plan).
            if let Some(p) = state.project_path.lock().unwrap().clone() {
                reset_project_activity(state, &p);
            }
            rpc_manager::stop_session(&mut session);
        }
        *state.active_agent_id.lock().unwrap() = None;
    } else {
        // Agent non actif → arrêter sa session parkée dans CE projet.
        let cwd = state.project_path.lock().unwrap().clone();
        if let Some(cwd) = cwd {
            let mut projects = state.projects.lock().unwrap();
            if let Some(ps) = projects.get_mut(&cwd) {
                if let Some(mut session) = ps.rpc.remove(&agent_id) {
                    rpc_manager::stop_session(&mut session);
                }
            }
        }
    }
    // H2 V1 : arrêter aussi le reviewer (cycle de vie lié à la session principale).
    let mut rev = state.rpc_reviewer.lock().unwrap();
    if let Some(mut session) = rev.take() {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
pub fn stop_agent_session(state: State<AppState>, agent_id: Option<String>) -> Result<(), String> {
    do_stop_agent_session(state.inner(), agent_id.as_deref());
    Ok(())
}

/// Arrêt COMPLET de TOUTES les sessions RPC à la fermeture de Pilot.
/// Corrige l'issue #14 (processus `plh.exe`/`pi` qui restent en mémoire) :
/// sur Windows un processus enfant ne meurt pas automatiquement quand son
/// parent meurt, il faut donc tuer explicitement chaque session encore
/// vivante. Couvre :
///  - la session principale (`rpc_state`, potentiellement plh),
///  - la session reviewer (`rpc_reviewer`),
///  - les sessions « parkées » par projet (`projects[*].rpc`, multi-projets),
///  - les sessions des agents multi-rôles (`agent_sessions`, H2 V2).
pub(crate) fn do_shutdown_all_sessions(state: &AppState) {
    // Session principale + reviewer.
    {
        let mut rpc = state.rpc_state.lock().unwrap();
        if let Some(mut session) = rpc.take() {
            rpc_manager::stop_session(&mut session);
        }
        let mut rev = state.rpc_reviewer.lock().unwrap();
        if let Some(mut session) = rev.take() {
            rpc_manager::stop_session(&mut session);
        }
    }
    // Sessions parkées par projet (multi-projets / multi-onglets agents).
    {
        let mut projects = state.projects.lock().unwrap();
        for (_, ps) in projects.iter_mut() {
            for (_, mut session) in ps.rpc.drain() {
                rpc_manager::stop_session(&mut session);
            }
        }
    }
    // Sessions agents multi-rôles (H2 V2).
    crate::agents::do_stop_all_agent_processes(state);
    // Session super-agent (spec_super_agent.md).
    {
        let mut sa = state.rpc_superagent.lock().unwrap();
        if let Some(mut session) = sa.take() {
            rpc_manager::stop_session(&mut session);
        }
    }
}

#[tauri::command]
pub fn send_rpc_command(state: State<AppState>, command: Value) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    rpc_manager::send_command(session, &command)
}

/// Relais des choix d'agent via l'assistant (tâche de suivi #22).
///
/// Envoie une commande (ex: `extension_ui_response`) à la session agent d'un
/// projet donné, identifiée par (project_path, agent_id). Priorité à la session
/// active (`rpc_state`) si elle correspond au couple projet/agent visé, sinon à
/// la session parkée du projet (`projects[path].rpc[agent_id]`, multi-onglets
/// agents — processus pi vivant en arrière-plan), sinon aux sessions des agents
/// multi-rôles (`agent_sessions`, H2 V2).
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
    let proj = project_path.filter(|p| !p.trim().is_empty());

    // 1) Session active si elle correspond au (projet, agent) ciblé.
    {
        let active_proj = state.active_project.lock().unwrap().clone();
        let active_agent = state.active_agent_id.lock().unwrap().clone()
            .unwrap_or_else(|| DEFAULT_AGENT_ID.to_string());
        let proj_matches = match &proj {
            Some(p) => active_proj.as_deref() == Some(p.as_str()),
            None => true, // projet non précisé → session active
        };
        if proj_matches && active_agent == agent_id {
            let mut rpc = state.rpc_state.lock().unwrap();
            if let Some(session) = rpc.as_mut() {
                return rpc_manager::send_command(session, &command);
            }
        }
    }
    // 2) Session parkée du projet ciblé (multi-onglets agents).
    if let Some(p) = &proj {
        let mut projects = state.projects.lock().unwrap();
        if let Some(ps) = projects.get_mut(p) {
            if let Some(session) = ps.rpc.get_mut(&agent_id) {
                return rpc_manager::send_command(session, &command);
            }
        }
    }
    // 3) Session des agents multi-rôles (H2 V2).
    {
        let mut agents = state.agent_sessions.lock().unwrap();
        if let Some(session) = agents.get_mut(&agent_id) {
            return rpc_manager::send_command(session, &command);
        }
    }
    Err("Aucune session agent trouvée pour relayer la réponse".to_string())
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
pub fn get_agent_state(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_state(state.inner())
}

#[tauri::command]
pub fn get_session_stats(state: State<AppState>) -> Result<Value, String> {
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
pub fn abort_agent(state: State<AppState>) -> Result<(), String> {
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
pub fn new_agent_session(state: State<AppState>) -> Result<(), String> {
    do_new_agent_session(state.inner())
}

/// Évolution 63 : purge la conversation de l'agent (équivalent au clic sur
/// « + » de l'onglet agent) en préservant le modèle actif. Utilisé par
/// l'Assistant (🧭) avant de déléguer une demande à l'agent, quand l'option
/// `super_agent_purge_agent_conversation` est activée.
///
/// `new_session` réinitialise le modèle au modèle par défaut de pi — on capture
/// donc le modèle actif (get_state) avant la purge et on le ré-applique après,
/// pour ne pas perdre le choix de modèle de l'utilisateur.
#[tauri::command]
pub fn purge_agent_conversation(state: State<AppState>) -> Result<(), String> {
    do_purge_agent_conversation(state.inner())
}

pub(crate) fn do_purge_agent_conversation(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
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
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_messages" });
    rpc_manager::send_command_sync(session, cmd)
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
pub fn set_agent_model(
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
pub fn list_agent_models(state: State<AppState>) -> Result<Value, String> {
    do_list_agent_models(state.inner())
}

#[tauri::command]
pub fn list_agent_commands(state: State<AppState>) -> Result<Value, String> {
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
        &cwd, &pi_path, true, "", None, Vec::new(), app.clone(), state.event_tx.clone(), "rpc-event-reviewer", None, None, None,
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
pub fn start_reviewer_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_reviewer_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_reviewer_session(state: State<AppState>) -> Result<(), String> {
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
pub fn send_reviewer_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    do_send_reviewer_prompt(state.inner(), message)
}

#[tauri::command]
pub fn new_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({"type": "new_session"});
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
pub fn set_reviewer_model(state: State<AppState>, provider: String, model_id: String) -> Result<(), String> {
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
pub fn abort_reviewer(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    rpc_manager::send_command(session, &serde_json::json!({"type": "abort"}))
}

#[tauri::command]
pub fn get_reviewer_state(state: State<AppState>) -> Result<Value, String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}

#[cfg(test)]
mod tests {
    use super::kind_from_version_output;

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
}
