// ── Assistant de groupe (GDS Phase C2) — lecture seule ──
//
// Assistant de groupe : session RPC dédiée (canal `rpc-event-group`, extension
// pilot-group-assistant), globale (multi-projets). Répond aux questions sur les
// projets du groupe en lisant le SUIVI FUSIONNÉ (clients, projets, tâches,
// décisions) centralisé dans Postgres via le GDS. STRICTEMENT en lecture seule :
// ne modifie jamais le code des projets ni le suivi.
//
// Respecte `gds_enabled` (paramètre global, défaut true) : si le GDS est
// désactivé globalement, le démarrage de la session est refusé (aucune lecture
// du suivi fusionné n'est possible sans GDS).
//
// Modèle configurable : `group_assistant_model` dans AppConfig (format
// "provider/modelId"), persisté comme le modèle du super-agent.

use crate::AppState;
use serde_json::Value;
use tauri::{AppHandle, State};

/// Démarre (ou reprend) la session de l'assistant de groupe. Refuse si le GDS
/// est désactivé globalement (`gds_enabled`). Async : le spawn du processus pi
/// + handshake RPC est bloquant (démarrage Node.js + chargement des extensions).
#[tauri::command]
pub async fn start_group_assistant_session(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    do_start_group_assistant_session(state.inner(), &app)
}

/// Démarre (ou reprend) la session de l'assistant de groupe (logique interne).
pub(crate) fn do_start_group_assistant_session(
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    // Garde-fou GDS : l'assistant de groupe lit le suivi fusionné centralisé
    // dans Postgres via le GDS. Sans GDS activé globalement, aucune lecture
    // n'est possible → on refuse le démarrage avec un message clair.
    if !crate::gds_globally_enabled(state) {
        return Err(
            "L'assistant de groupe nécessite le GDS (paramètre global désactivé). \
             Activez le GDS dans les Paramètres pour l'utiliser."
                .to_string(),
        );
    }
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let cwd = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default();
    let default_model = default_model_from_config(&pi_path);
    state
        .agent_service
        .start_group_assistant(app, &cwd, &pi_path, default_model)
}

/// Arrête la session de l'assistant de groupe.
#[tauri::command]
pub fn stop_group_assistant_session(state: State<AppState>) -> Result<(), String> {
    state.agent_service.stop_group_assistant()
}

/// Résout le modèle par défaut du backend actif depuis `model-switch.json`
/// (réutilise la logique du super-agent). Retourne `(provider, model_id)`.
fn default_model_from_config(pi_path: &str) -> Option<(String, String)> {
    crate::super_agent::default_model_from_config(pi_path)
}

/// Envoie un prompt à l'assistant de groupe. Construit le prompt système
/// (rôle lecture seule + contexte du suivi fusionné) puis envoie la commande.
#[tauri::command]
pub async fn send_group_assistant_prompt(
    state: State<'_, AppState>,
    app: AppHandle,
    message: String,
) -> Result<(), String> {
    do_send_group_assistant_prompt(state.inner(), &app, message)
}

/// Envoie un prompt à l'assistant de groupe (logique interne).
pub(crate) fn do_send_group_assistant_prompt(
    state: &AppState,
    app: &AppHandle,
    message: String,
) -> Result<(), String> {
    // Démarrage paresseux : garantit qu'une session existe avant d'envoyer.
    do_start_group_assistant_session(state, app)?;
    // Prompt système : rôle de l'assistant de groupe (lecture seule stricte).
    let mut full_system = format!(
        "Tu es l'assistant de groupe de Pilot. Tu réponds aux questions sur les projets du groupe \
         en lisant le suivi fusionné (clients, projets, tâches, décisions) centralisé dans le GDS. \
         Tu es STRICTEMENT en lecture seule : tu ne modifies jamais le code des projets ni le suivi. \
         Utilise l'outil `group_tracking_query` pour lire les données avant de répondre."
    );
    // Contexte : le projet actuellement actif dans Pilot (si un projet est chargé).
    let active_project = state.active_project.lock().unwrap().clone();
    if let Some(p) = active_project {
        full_system.push_str(&format!(
            "\n\nProjet actuellement actif dans Pilot : {}",
            p
        ));
    }
    let full_message = format!("{}\n\n{}", full_system, message);
    let cmd = serde_json::json!({"type": "prompt", "message": full_message});
    state.agent_service.send_group_assistant(cmd)
}

/// Définit le modèle actif de l'assistant de groupe (configurable). Persiste
/// `group_assistant_model` dans AppConfig (format "provider/modelId").
#[tauri::command]
pub fn set_group_assistant_model(
    state: State<AppState>,
    app: AppHandle,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    do_start_group_assistant_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "set_model", "provider": provider, "modelId": model_id});
    let resp = state.agent_service.send_group_assistant_sync(cmd)?;
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
    let mut cfg = state.config.lock().unwrap();
    cfg.group_assistant_model = format!("{}/{}", provider, model_id);
    crate::save_config_disk(&app, &cfg).ok();
    Ok(())
}

/// Retourne l'état de la session de l'assistant de groupe (vivante ou non).
#[tauri::command]
pub fn get_group_assistant_state(state: State<AppState>) -> Result<Value, String> {
    let alive = state.agent_service.group_assistant_alive();
    let model = state.config.lock().unwrap().group_assistant_model.clone();
    Ok(serde_json::json!({
        "alive": alive,
        "model": model,
    }))
}

/// Lit le suivi fusionné des projets du groupe (lecture seule stricte).
/// `scope` : "all" (défaut), "clients", "projects", "tasks" ou "decisions".
/// Source de vérité : Postgres via le GDS quand le pool est disponible ;
/// sinon repli sur la base SQLite du super-agent (`~/.pilot/super-agent.db`).
#[tauri::command]
pub async fn group_assistant_tracking_query(
    state: State<'_, AppState>,
    app: AppHandle,
    scope: String,
) -> Result<Value, String> {
    let scope = scope.trim().to_lowercase();
    let scope = if scope.is_empty() { "all" } else { scope.as_str() };
    // Garde-fou GDS : sans GDS activé globalement, aucune lecture du suivi
    // fusionné n'est possible.
    if !crate::gds_globally_enabled(&state) {
        return Err(
            "L'assistant de groupe nécessite le GDS (paramètre global désactivé)."
                .to_string(),
        );
    }
    // Source de vérité : Postgres via le GDS quand le pool est disponible.
    let pool = state.gds_pool.lock().unwrap().clone();
    if let Some(pool) = pool {
        return read_from_postgres(&pool, scope).await;
    }
    // Repli : base SQLite du super-agent (suivi local).
    read_from_sqlite(&app, scope)
}

/// Lit le suivi fusionné depuis Postgres (GDS). Lecture seule stricte.
async fn read_from_postgres(pool: &sqlx::PgPool, scope: &str) -> Result<Value, String> {
    let mut out = serde_json::Map::new();
    if scope == "all" || scope == "clients" {
        let clients = crate::gds_db::list_clients(pool)
            .await
            .map_err(|e| format!("Lecture clients GDS: {}", e))?;
        out.insert(
            "clients".to_string(),
            serde_json::to_value(&clients).unwrap_or(Value::Null),
        );
    }
    if scope == "all" || scope == "projects" {
        let projects = crate::gds_db::list_tracking_projects(pool)
            .await
            .map_err(|e| format!("Lecture projets GDS: {}", e))?;
        out.insert(
            "projects".to_string(),
            serde_json::to_value(&projects).unwrap_or(Value::Null),
        );
    }
    if scope == "all" || scope == "tasks" {
        let tasks = crate::gds_db::list_tasks(pool)
            .await
            .map_err(|e| format!("Lecture tâches GDS: {}", e))?;
        out.insert(
            "tasks".to_string(),
            serde_json::to_value(&tasks).unwrap_or(Value::Null),
        );
    }
    if scope == "all" || scope == "decisions" {
        let decisions = crate::gds_db::list_decisions(pool)
            .await
            .map_err(|e| format!("Lecture décisions GDS: {}", e))?;
        out.insert(
            "decisions".to_string(),
            serde_json::to_value(&decisions).unwrap_or(Value::Null),
        );
    }
    Ok(Value::Object(out))
}

/// Lit le suivi fusionné depuis la base SQLite du super-agent (repli local).
/// Lecture seule stricte (SELECT uniquement).
fn read_from_sqlite(app: &AppHandle, scope: &str) -> Result<Value, String> {
    let conn = crate::super_agent::open_db(app)?;
    let mut out = serde_json::Map::new();
    if scope == "all" || scope == "clients" {
        out.insert("clients".to_string(), query_rows(&conn, "SELECT id, name, notes, updated_at FROM clients ORDER BY name")?);
    }
    if scope == "all" || scope == "projects" {
        out.insert("projects".to_string(), query_rows(&conn, "SELECT id, path, name, client_id, status, updated_at FROM projects WHERE path IS NOT NULL ORDER BY name")?);
    }
    if scope == "all" || scope == "tasks" {
        out.insert("tasks".to_string(), query_rows(&conn, "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at FROM tasks ORDER BY id")?);
    }
    if scope == "all" || scope == "decisions" {
        out.insert("decisions".to_string(), query_rows(&conn, "SELECT id, project_id, task_id, summary, source_session, updated_at FROM decisions ORDER BY id")?);
    }
    Ok(Value::Object(out))
}

/// Exécute une requête SELECT sur la base SQLite et retourne les lignes (JSON).
fn query_rows(conn: &rusqlite::Connection, sql: &str) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Erreur SQL: {}", e))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();
    let rows = stmt
        .query_map([], |r| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val = r
                    .get::<_, rusqlite::types::Value>(i)
                    .unwrap_or(rusqlite::types::Value::Null);
                obj.insert(name.clone(), crate::super_agent::sqlite_value_to_json(val));
            }
            Ok(serde_json::Value::Object(obj))
        })
        .map_err(|e| format!("Erreur SQL: {}", e))?;
    let mut result: Vec<Value> = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Erreur SQL: {}", e))?);
    }
    Ok(serde_json::json!({ "rows": result, "count": result.len() }))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    #[test]
    fn scope_normalization() {
        // "all" par défaut quand vide.
        let s = "".trim().to_lowercase();
        let s = if s.is_empty() { "all" } else { s.as_str() };
        assert_eq!(s, "all");
        // Normalisation minuscules.
        let s = "PROJECTS".trim().to_lowercase();
        assert_eq!(s, "projects");
    }
}
