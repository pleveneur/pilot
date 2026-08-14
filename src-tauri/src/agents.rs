// agents.rs — H2 V2 : gestion d'agents multi-rôles (spec_gestion_agents.md).
//
// Domaine extrait de `lib.rs` (2026-08) : registre des agents (load/save/reset),
// bus de sessions agents (HashMap<agent_id, RpcSession>), pilotage des processus
// agents (start/stop/prompt/session/modèle/abort/command/state), health-check de
// modèles distants, exécution bash et compactage de contexte.
//
// Dépend de `crate::AppState`, `crate::AppConfig`, `crate::resolve_agent_home`
// et du module `rpc_manager`. `do_stop_all_agent_processes` est pub(crate) car
// appelée à l'arrêt de l'app et au changement de projet (lib.rs).

use serde_json::Value;
use tauri::{AppHandle, State};
use std::fs;

use crate::{config_path, resolve_agent_home, rpc_manager, AppConfig, AppState};

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
                "role": "Tu es le chef d'orchestre d'une équipe d'agents de codage. Tu ne codes pas toi-même. Tu délègues chaque sous-tâche à l'agent spécialisé adapté via [[CALL:agent_id]]. Pour des sous-tâches INDÉPENDANTES, lance-les en parallèle via [[PARALLEL]] (blocs agent:/task: séparés par ---). Tu synthétises les résultats et réponds à l'utilisateur.",
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
pub fn load_agent_registry(state: State<AppState>) -> Result<Value, String> {
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
pub fn save_agent_registry(registry: Value) -> Result<(), String> {
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

/// Réinitialise ~/.pilot/agents.json avec les 6 agents par défaut.
/// Contrairement à save_agent_registry({agents:[]}) qui viderait tout, cette
/// commande reconstruit le registre par défaut à partir de la config courante
/// (modèles orchestrateur/codeur) puis l'écrit sur disque. Retourne le registre
/// généré pour que le frontend puisse rafraîchir l'UI sans relecture disque.
#[tauri::command]
pub fn reset_agent_registry(state: State<AppState>) -> Result<Value, String> {
    let path = agents_registry_path()?;
    let dir = path.parent().ok_or("Chemin agents.json invalide")?;
    fs::create_dir_all(dir).map_err(|e| format!("Erreur création dossier .pilot: {}", e))?;
    // Sauvegarde du fichier courant avant écrasement (récupération possible).
    let backup = path.with_extension("json.bak");
    if path.exists() {
        let _ = fs::copy(&path, &backup);
    }
    let config = state.config.lock().unwrap().clone();
    let default = build_default_agent_registry(&config);
    let json = serde_json::to_string_pretty(&default)
        .map_err(|e| format!("Erreur sérialisation registry: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Erreur écriture agents.json: {}", e))?;
    Ok(default)
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
        &cwd, &pi_path, no_session, &session_dir_str, None, Vec::new(), app.clone(), state.event_tx.clone(), "rpc-event-agents", Some(&agent_id), None, None,
    ).map_err(|e| format!("Erreur lancement agent {} : {}", agent_id, e))?;
    sessions.insert(agent_id, session);
    Ok(())
}

#[tauri::command]
pub fn start_agent_process(state: State<AppState>, app: AppHandle, agent_id: String, cwd: String, pi_path: String, no_session: bool) -> Result<(), String> {
    do_start_agent_process(state.inner(), &app, agent_id, cwd, pi_path, no_session)
}

pub(crate) fn do_stop_agent_process(state: &AppState, agent_id: String) {
    let mut sessions = state.agent_sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&agent_id) {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
pub fn stop_agent_process(state: State<AppState>, agent_id: String) -> Result<(), String> {
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
pub fn stop_all_agent_processes(state: State<AppState>) -> Result<(), String> {
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
pub fn send_agent_process_prompt(state: State<AppState>, agent_id: String, message: String) -> Result<(), String> {
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
pub fn new_agent_process_session(state: State<AppState>, agent_id: String) -> Result<(), String> {
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
pub fn set_agent_process_model(state: State<AppState>, agent_id: String, provider: String, model_id: String) -> Result<(), String> {
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
pub fn abort_agent_process(state: State<AppState>, agent_id: String) -> Result<(), String> {
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
pub fn send_agent_process_command(state: State<AppState>, agent_id: String, command: Value) -> Result<(), String> {
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
pub fn get_agent_process_state(state: State<AppState>, agent_id: String) -> Result<Value, String> {
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
pub async fn check_model_reachable(url: String) -> Result<Value, String> {
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
pub fn execute_agent_bash(state: State<AppState>, command: String) -> Result<Value, String> {
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
pub fn compact_agent_context(state: State<AppState>) -> Result<(), String> {
    do_compact_agent_context(state.inner())
}


#[tauri::command]
pub fn convert_pdf_to_md_ai(state: State<AppState>, text: String) -> Result<String, String> {
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





/// Liste tous les modèles disponibles depuis ~/.pi/agent/models.json
/// Retourne un tableau de chaînes "provider/modelId" trié alphabétiquement.
#[tauri::command]
pub fn get_available_models_list(state: State<AppState>) -> Result<Vec<String>, String> {
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
