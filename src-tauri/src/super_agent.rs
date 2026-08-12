// super_agent.rs — Super-agent (spec_super_agent.md)
//
// Assistant de suivi multi-projets, lecture seule. Session RPC dédiée (canal
// `rpc-event-superagent`), base SQLite locale `~/.pilot/super-agent.db`
// (clients, projets, tâches, décisions, résumés de sessions), config (nom,
// clients, association projet → client) persistée dans AppConfig.

use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::rpc_manager;
use crate::AppState;

/// Canal d'événements dédié au super-agent (ne pollue pas les canaux existants).
const SUPERAGENT_CHANNEL: &str = "rpc-event-superagent";

// ── Base SQLite ──

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin données: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier: {}", e))?;
    Ok(dir.join("super-agent.db"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("Erreur ouverture base: {}", e))?;
    init_db(&conn)?;
    Ok(conn)
}

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT DEFAULT '',
            client_id INTEGER,
            status TEXT DEFAULT 'suivi',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(client_id) REFERENCES clients(id)
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'demande',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            task_id INTEGER,
            summary TEXT NOT NULL,
            source_session TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id),
            FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        CREATE TABLE IF NOT EXISTS session_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            session_id TEXT DEFAULT '',
            summary TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );",
    )
    .map_err(|e| format!("Erreur init base: {}", e))
}

// ── Session RPC dédiée ──

/// Démarre (lazy) la session super-agent. Lecture seule : pas d'extensions
/// d'écriture (pilot-edit-gate), pas de skill. Canal dédié.
pub(crate) fn do_start_super_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let mut rpc = state.rpc_superagent.lock().unwrap();
    if rpc.is_some() {
        return Ok(()); // déjà lancé (idempotent)
    }
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();
    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, true, "", None, Vec::new(), app.clone(), state.event_tx.clone(),
        SUPERAGENT_CHANNEL, None, None,
    )
        .map_err(|e| format!("Erreur lancement du super-agent : {}", e))?;
    *rpc = Some(session);
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
        // Appliquer le modèle par défaut (registre global) pour que la session
        // puisse répondre dès le premier prompt.
        if let Some((provider, model_id)) = default_model_from_config(&pi_path) {
            let cmd = serde_json::json!({"type": "set_model", "provider": provider, "modelId": model_id});
            rpc_manager::send_command_sync(sess, cmd).ok();
        }
    }
    Ok(())
}

/// Résout le modèle par défaut du backend actif depuis `model-switch.json`
/// (`~/.<stem>/agent/model-switch.json`, champ `defaultModel`). Retourne
/// `(provider, model_id)` si présent.
fn default_model_from_config(pi_path: &str) -> Option<(String, String)> {
    let stem = if pi_path.is_empty() {
        "pi".to_string()
    } else {
        std::path::Path::new(pi_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "pi".to_string())
    };
    let path = crate::models_config::resolve_agent_home_by_stem(&stem)
        .ok()?
        .join("agent")
        .join("model-switch.json");
    if !path.exists() {
        return None;
    }
    let json_str = std::fs::read_to_string(&path).ok()?;
    let parsed: Value = serde_json::from_str(&json_str).ok()?;
    let def = parsed.get("defaultModel")?.as_str()?;
    let idx = def.find('/')?;
    Some((def[..idx].to_string(), def[idx + 1..].to_string()))
}

#[tauri::command]
pub fn start_super_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_super_agent_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_superagent.lock().unwrap();
    if let Some(mut session) = rpc.take() {
        rpc_manager::stop_session(&mut session);
    }
    Ok(())
}

#[tauri::command]
pub fn send_super_agent_prompt(state: State<AppState>, app: AppHandle, message: String) -> Result<(), String> {
    // Démarrage paresseux : garantit qu'une session existe avant d'envoyer.
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "prompt", "message": message});
    rpc_manager::send_command(session, &cmd)
}

/// Un tour de la conversation du super-agent (côté frontend).
#[derive(serde::Deserialize, Clone)]
pub struct SuperAgentTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Appel bloquant du super-agent : lance un process pi **frais** `--no-session`
/// (pattern `ask_pi_caged`, éprouvé par l'aide et le reviewer), envoie
/// new_session → set_model → prompt, collecte le stream et retourne la réponse
/// complète. L'historique est réinjecté dans le prompt (le process est sans
/// mémoire). Garantit une réponse fiable, contrairement à la session persistante
/// `--no-session` qui ne streame pas de sortie.
///
/// Commande **async** : le travail bloquant (spawn du process pi + collecte du
/// stream) est exécuté dans `spawn_blocking` avec un timeout global, pour ne
/// jamais bloquer l'UI pendant la génération.
#[tauri::command]
pub async fn ask_super_agent(
    state: State<'_, AppState>,
    message: String,
    history: Vec<SuperAgentTurn>,
) -> Result<String, String> {
    let (pi_path, mut model, system_prompt) = {
        let cfg = state.config.lock().unwrap();
        (
            cfg.rpc_pi_path.clone(),
            cfg.super_agent_model.clone(),
            cfg.super_agent_prompt.clone(),
        )
    };

    // Si aucun modèle n'a été choisi, retomber sur le modèle par défaut du
    // backend (pi --no-session n'a pas de modèle par défaut).
    if model.trim().is_empty() {
        if let Some((p, id)) = default_model_from_config(&pi_path) {
            model = format!("{}/{}", p, id);
        }
    }

    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();

    // Construire le prompt : prompt système (configurable) + historique + message
    // courant. Le prompt système cadre le comportement de l'assistant à chaque
    // tour (le process pi frais est sans mémoire).
    let mut prompt = String::new();
    if !system_prompt.trim().is_empty() {
        prompt.push_str(&format!("{}\n\n", system_prompt.trim()));
    }
    for turn in &history {
        let role = if turn.role == "user" { "Utilisateur" } else { "Assistant" };
        prompt.push_str(&format!("{} : {}\n\n", role, turn.content));
    }
    prompt.push_str(&format!("Utilisateur : {}", message));

    let pi_path_owned = pi_path;
    let cwd_owned = cwd;
    let prompt_owned = prompt;
    let model_owned = model;

    // Exécution bloquante dans spawn_blocking + timeout global (120 s).
    let result: Result<String, String> = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::task::spawn_blocking(move || {
            let model_opt = if model_owned.trim().is_empty() {
                None
            } else {
                Some(model_owned.as_str())
            };
            crate::help::ask_pi_caged_timed(
                &cwd_owned,
                &pi_path_owned,
                &prompt_owned,
                model_opt,
                std::time::Duration::from_secs(110),
            )
        }),
    )
    .await
    .map_err(|_| {
        "Le super-agent a mis trop de temps à répondre (120 s). Réessayez ou changez de modèle.".to_string()
    })?
    .map_err(|e| format!("Erreur interne: {}", e))?;

    result
}

#[tauri::command]
pub fn new_super_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "new_session"});
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
pub fn set_super_agent_model(state: State<AppState>, app: AppHandle, provider: String, model_id: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "set_model", "provider": provider, "modelId": model_id});
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    // Vérifier le champ success : un set_model qui échoue (provider/modèle
    // introuvable) répond {success: false, error: "..."}.
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
    // Persister le modèle actif pour l'appel bloquant `ask_super_agent`.
    drop(rpc);
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_model = format!("{}/{}", provider, model_id);
    crate::save_config_disk(&app, &cfg).ok();
    Ok(())
}

#[tauri::command]
pub fn abort_super_agent(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "abort"});
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
pub fn get_super_agent_state(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "get_state"});
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}

// ── Config (nom, clients, association projet → client) ──

#[tauri::command]
pub fn get_super_agent_config(state: State<AppState>) -> Result<Value, String> {
    let cfg = state.config.lock().unwrap();
    Ok(serde_json::json!({
        "name": cfg.super_agent_name,
        "clients": cfg.super_agent_clients,
        "project_client": cfg.super_agent_project_client,
        "prompt": cfg.super_agent_prompt,
    }))
}

#[tauri::command]
pub fn set_super_agent_config(
    state: State<AppState>,
    app: AppHandle,
    name: Option<String>,
    clients: Option<Vec<String>>,
    project_client: Option<HashMap<String, String>>,
    prompt: Option<String>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(n) = name {
        cfg.super_agent_name = n;
    }
    if let Some(c) = clients {
        cfg.super_agent_clients = c;
    }
    if let Some(pc) = project_client {
        cfg.super_agent_project_client = pc;
    }
    if let Some(p) = prompt {
        cfg.super_agent_prompt = p;
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

// L'onglet Super-agent est GLOBAL (multi-projets) : son état d'ouverture est
// persisté dans AppConfig (pas par projet) pour le rouvrir au démarrage.
#[tauri::command]
pub fn set_super_agent_open(state: State<AppState>, app: AppHandle, open: bool) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_open = open;
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

// ── Clients ──

#[tauri::command]
pub fn list_clients(state: State<AppState>, _app: AppHandle) -> Result<Value, String> {
    let cfg = state.config.lock().unwrap();
    let clients: Vec<Value> = cfg
        .super_agent_clients
        .iter()
        .map(|c| serde_json::json!({"name": c}))
        .collect();
    Ok(serde_json::json!({"clients": clients}))
}

#[tauri::command]
pub fn add_client(state: State<AppState>, app: AppHandle, name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if !cfg.super_agent_clients.contains(&name) {
        cfg.super_agent_clients.push(name);
        crate::save_config_disk(&app, &cfg)?;
    }
    Ok(())
}

#[tauri::command]
pub fn remove_client(state: State<AppState>, app: AppHandle, name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_clients.retain(|c| c != &name);
    // Retirer l'association projet → client pour ce client.
    cfg.super_agent_project_client.retain(|_, v| v != &name);
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

#[tauri::command]
pub fn rename_client(state: State<AppState>, app: AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(idx) = cfg.super_agent_clients.iter().position(|c| c == &old_name) {
        cfg.super_agent_clients[idx] = new_name.clone();
    }
    for v in cfg.super_agent_project_client.values_mut() {
        if *v == old_name {
            *v = new_name.clone();
        }
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

#[tauri::command]
pub fn set_project_client(state: State<AppState>, app: AppHandle, project_path: String, client: Option<String>) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    match client {
        Some(c) => { cfg.super_agent_project_client.insert(project_path, c); }
        None => { cfg.super_agent_project_client.remove(&project_path); }
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

// ── Apprentissage : injection de résumé de session ──

/// Enregistre un résumé de session dans la base et l'injecte au super-agent
/// (s'il est démarré) pour qu'il apprenne en continu.
#[tauri::command]
pub fn inject_session_summary(
    state: State<AppState>,
    app: AppHandle,
    project_path: Option<String>,
    session_id: Option<String>,
    summary: String,
) -> Result<(), String> {
    // Persister dans la base.
    let conn = open_db(&app)?;
    let project_id: Option<i64> = match &project_path {
        Some(p) => {
            conn.execute(
                "INSERT INTO projects (path, name) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')",
                rusqlite::params![p, p],
            )
            .map_err(|e| format!("Erreur enregistrement projet: {}", e))?;
            conn.query_row(
                "SELECT id FROM projects WHERE path = ?1",
                rusqlite::params![p],
                |r| r.get(0),
            )
            .ok()
        }
        None => None,
    };
    conn.execute(
        "INSERT INTO session_summaries (project_id, session_id, summary) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, session_id.unwrap_or_default(), summary],
    )
    .map_err(|e| format!("Erreur enregistrement résumé: {}", e))?;
    drop(conn);

    // Injecter au super-agent s'il est démarré.
    let mut rpc = state.rpc_superagent.lock().unwrap();
    if let Some(sess) = rpc.as_mut() {
        let msg = format!(
            "[Résumé de session] Projet: {}\n{}\n\nIntègre ces informations dans ton suivi (tâches, décisions, état d'avancement).",
            project_path.unwrap_or_default(),
            summary
        );
        let cmd = serde_json::json!({"type": "prompt", "message": msg});
        rpc_manager::send_command(sess, &cmd).ok();
    }
    Ok(())
}

// ── Initialisation d'un projet existant ──

/// Analyse un projet (structure, docs) et pose les questions nécessaires au
/// super-agent pour son fonctionnement. En V1 : enregistre le projet dans la
/// base et envoie un prompt d'initialisation au super-agent.
#[tauri::command]
pub fn initialize_super_agent(
    state: State<AppState>,
    app: AppHandle,
    project_path: String,
) -> Result<(), String> {
    // Enregistrer le projet dans la base.
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO projects (path, name) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET updated_at = datetime('now')",
        rusqlite::params![project_path, project_path],
    )
    .map_err(|e| format!("Erreur enregistrement projet: {}", e))?;
    drop(conn);

    // S'assurer que la session est démarrée.
    do_start_super_agent_session(state.inner(), &app)?;

    let mut rpc = state.rpc_superagent.lock().unwrap();
    if let Some(sess) = rpc.as_mut() {
        let msg = format!(
            "Tu es l'assistant de suivi du projet « {} ». Analyse ce projet (structure, documentation, historique) puis pose les questions nécessaires à ton fonctionnement : contexte, objectifs, client, jalons, état d'avancement. Tu es en lecture seule : ne modifie aucun fichier du projet.",
            project_path
        );
        let cmd = serde_json::json!({"type": "prompt", "message": msg});
        rpc_manager::send_command(sess, &cmd)?;
    }
    Ok(())
}

// ── Question sur tous les projets ──

/// Répond à une question en s'appuyant sur la base + le super-agent.
#[tauri::command]
pub fn query_super_agent(state: State<AppState>, app: AppHandle, question: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let mut rpc = state.rpc_superagent.lock().unwrap();
    let session = rpc.as_mut().ok_or("Aucune session super-agent active")?;
    let cmd = serde_json::json!({"type": "prompt", "message": question});
    rpc_manager::send_command(session, &cmd)
}
