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

use crate::AppState;

// ── Base SQLite ──

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin données: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier: {}", e))?;
    Ok(dir.join("super-agent.db"))
}

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
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
        );
        -- Chantier #13 : planification d'actions récurrentes de l'assistant.
        -- `every` = intervalle en secondes (>= 60). `last_run_at` = dernière
        -- exécution (formule datetime('now') UTC), NULL si jamais exécuté.
        CREATE TABLE IF NOT EXISTS assistant_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            prompt TEXT NOT NULL,
            every INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Erreur init base: {}", e))
}

// ── Session RPC dédiée ──

/// Démarre (lazy) la session super-agent. La session vit désormais dans le
/// registre unique de l'AgentService (id `superagent`, canal `rpc-event-superagent`
/// isolé). Lecture seule stricte sur les
/// projets : l'extension `pilot-assistant-files` bloque techniquement toute
/// écriture hors de `~/.pilot/assistant/` (espace d'écriture dédié de
/// l'assistant), et `pilot-choices` fournit les outils de question (ask_choice,
/// ask_input, ask_confirm, ask_multi_choice). Pas de skill. Canal dédié.
pub(crate) fn do_start_super_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
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
        .start_superagent(app, &cwd, &pi_path, default_model)
}

/// Résout le modèle par défaut du backend actif depuis `model-switch.json`
/// (`~/.<stem>/agent/model-switch.json`, champ `defaultModel`). Retourne
/// `(provider, model_id)` si présent.
fn default_model_from_config(pi_path: &str) -> Option<(String, String)> {    let stem = if pi_path.is_empty() {
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

/// Liste concise des projets connus de la base (path + nom), pour que
/// l'assistant apprenne où se trouvent les projets au fil des discussions.
/// Retourne une chaîne vide si la base est vide ou inaccessible.
fn known_projects_context(app: &AppHandle) -> String {
    let conn = match open_db(app) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let mut stmt = match conn.prepare("SELECT path, name FROM projects ORDER BY updated_at DESC") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let rows = match stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    let mut items: Vec<String> = Vec::new();
    for row in rows.flatten() {
        let (path, name) = row;
        let label = if name.is_empty() || name == path {
            path
        } else {
            format!("{} ({})", name, path)
        };
        items.push(label);
    }
    if items.is_empty() {
        String::new()
    } else {
        format!("\n\nProjets que tu connais :\n- {}", items.join("\n- "))
    }
}

#[tauri::command]
pub fn start_super_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_super_agent_session(state: State<AppState>) -> Result<(), String> {
    state.agent_service.stop_superagent()
}

/// Construit la consigne « réponses courtes » à injecter dans le prompt système
/// du super-agent (évolution 3). Retourne une chaîne vide si le mode est désactivé.
fn concise_guideline(enabled: bool) -> String {
    if !enabled {
        return String::new();
    }
    "\n\nRègle de style : réponds de façon concise. Informe l'utilisateur et prends des décisions, mais ne détaille pas tout ce qui se fait, sauf si l'utilisateur le demande explicitement. Utilise des phrases courtes.".to_string()
}

/// Construit la consigne « personnalité adaptée à l'utilisateur » (A18) à
/// injecter dans le prompt système du super-agent. S'appuie sur la personnalité
/// déduite en arrière-plan de la conversation (persistée dans la config).
/// Retourne une chaîne vide si le mode est désactivé ou si aucune personnalité
/// n'a encore été déduite.
fn personality_guideline(enabled: bool, personality: &str) -> String {
    if !enabled || personality.trim().is_empty() {
        return String::new();
    }
    format!(
        "\n\nPersonnalité adaptée à l'utilisateur (déduite de la conversation) :\n{}",
        personality.trim()
    )
}

/// Construit le contexte projet injecté dans le prompt système du super-agent.
/// Le projet ACTIF est toujours la cible par défaut de la conversation ; l'ancien
/// projet de travail n'est rappelé qu'en second plan pour éviter que l'assistant
/// se focalise sur le mauvais projet (issue #40).
/// Retourne une chaîne vide si aucun projet actif ni de travail.
fn build_project_context(active: Option<&str>, working: Option<&str>) -> String {
    let mut ctx = String::new();
    if let Some(ap) = active {
        ctx.push_str(&format!(
            "\n\nProjet actuellement actif dans Pilot : « {} ». C'est le projet courant de la conversation.",
            ap
        ));
        if let Some(wp) = working {
            if Some(ap) != working {
                ctx.push_str(&format!(
                    "\nAncien projet de travail (ne le considère PLUS comme actif) : « {} ».",
                    wp
                ));
            }
        }
    } else if let Some(wp) = working {
        ctx.push_str(&format!(
            "\n\nProjet sur lequel tu travaillais : « {} ».",
            wp
        ));
    }
    if !ctx.is_empty() {
        ctx.push_str(
            "\nRègle : quand l'utilisateur parle d'un projet, considère TOUJOURS le projet actif comme le projet par défaut. N'utilise un ancien projet de travail que si l'utilisateur le nomme ou le mentionne explicitement. Si tu n'es pas sûr, demande-lui de préciser.",
        );
    }
    ctx
}

/// Envoie un prompt au super-agent (session RPC dédiée). Helper réutilisable par
/// la commande Tauri desktop et par le web remote (évolution 2). Démarre
/// paresseusement la session si nécessaire.
pub(crate) fn do_send_super_agent_prompt(
    state: &AppState,
    app: &AppHandle,
    message: String,
) -> Result<(), String> {
    // Démarrage paresseux : garantit qu'une session existe avant d'envoyer.
    do_start_super_agent_session(state, app)?;
    // Prompt système : nom de l'assistant + rôle de suivi multi-projets + prompt
    // personnalisé (configurable). Le nom est toujours injecté pour que
    // l'assistant sache qui il est, même si l'utilisateur n'a pas renseigné de
    // prompt personnalisé.
    let (name, system_prompt, concise, user_memory, adaptive_personality, personality) = {
        let cfg = state.config.lock().unwrap();
        (cfg.super_agent_name.clone(), cfg.super_agent_prompt.clone(), cfg.super_agent_concise, cfg.super_agent_user_memory.clone(), cfg.super_agent_adaptive_personality, cfg.super_agent_personality.clone())
    };
    let name = if name.trim().is_empty() { "Assistant".to_string() } else { name.trim().to_string() };
    let mut full_system = format!(
        "Tu es « {} », l'assistant de suivi multi-projets de Pilot. Tu suis plusieurs projets (organisés par client) de la demande à la livraison, tu apprends des sessions d'agents et tu réponds aux questions. Tu es strictement en lecture seule : tu ne modifies jamais les fichiers des projets.",
        name
    );
    // Contexte projet : le projet actuellement actif dans Pilot + le projet sur
    // lequel l'assistant travaillait (dernier projet ouvert via `open_project`).
    // Le projet ACTIF est TOUJOURS la cible par défaut (issue #40).
    let active_project = state.active_project.lock().unwrap().clone();
    let working_project = state.working_project.lock().unwrap().clone();
    full_system.push_str(&build_project_context(active_project.as_deref(), working_project.as_deref()));
    // Apprendre où se trouvent les projets : injecter la liste des projets
    // connus de la base (s'enrichit au fil des discussions / sessions).
    full_system.push_str(&known_projects_context(app));
    if !system_prompt.trim().is_empty() {
        full_system.push_str("\n\n");
        full_system.push_str(system_prompt.trim());
    }
    // A17 : mémoire utilisateur persistée (profil/notes sur l'utilisateur ou
    // développeur de Pilot). Injectée comme le prompt personnalisé pour que
    // l'assistant prenne en compte durablement les préférences et le contexte.
    if !user_memory.trim().is_empty() {
        full_system.push_str("\n\nMémoire sur l'utilisateur (profil/notes appris au fil des discussions) :\n");
        full_system.push_str(user_memory.trim());
    }
    // A18 : personnalité adaptée à l'utilisateur (déduite en arrière-plan de la
    // conversation). Injectée comme la mémoire utilisateur A17.
    full_system.push_str(&personality_guideline(adaptive_personality, &personality));
    // Chantier #13 : documenter l'outil schedule (relances différées/périodiques).
    full_system.push_str(
        "\n\nTu disposes d'un outil `schedule_create` pour programmer une relance différée (afterSeconds) ou périodique (everySeconds >= 60) qui reviendra dans ta conversation à l'échéance. Utile pour surveiller un codeur en cours, ou repointer un chantier plus tard. Utilise `schedule_list` / `schedule_delete` pour gérer tes rappels. Max 20 rappels actifs.",
    );
    // Évolution 3 : mode « réponses courtes » (désactivé par défaut).
    full_system.push_str(&concise_guideline(concise));
    let full_message = format!("{}\n\n{}", full_system, message);
    let cmd = serde_json::json!({"type": "prompt", "message": full_message});
    state.agent_service.send_superagent(cmd)
}

#[tauri::command]
pub fn send_super_agent_prompt(state: State<AppState>, app: AppHandle, message: String) -> Result<(), String> {
    do_send_super_agent_prompt(state.inner(), &app, message)
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
    let (pi_path, mut model, system_prompt, concise, user_memory, adaptive_personality, personality) = {
        let cfg = state.config.lock().unwrap();
        (
            cfg.rpc_pi_path.clone(),
            cfg.super_agent_model.clone(),
            cfg.super_agent_prompt.clone(),
            cfg.super_agent_concise,
            cfg.super_agent_user_memory.clone(),
            cfg.super_agent_adaptive_personality,
            cfg.super_agent_personality.clone(),
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
    // A17 : mémoire utilisateur persistée (profil/notes sur l'utilisateur).
    if !user_memory.trim().is_empty() {
        prompt.push_str(&format!(
            "Mémoire sur l'utilisateur (profil/notes appris au fil des discussions) :\n{}\n\n",
            user_memory.trim()
        ));
    }
    // A18 : personnalité adaptée à l'utilisateur (déduite en arrière-plan).
    prompt.push_str(&personality_guideline(adaptive_personality, &personality));
    // Évolution 3 : mode « réponses courtes » (désactivé par défaut).
    prompt.push_str(&concise_guideline(concise));
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

/// Enregistre le projet sur lequel l'assistant travaille (dernier projet ouvert
/// via l'action `open_project`). Distinct du projet actif : quand l'utilisateur
/// change de projet, le projet de travail reste celui de la discussion en cours.
#[tauri::command]
pub fn set_super_agent_working_project(state: State<AppState>, path: String) -> Result<(), String> {
    *state.working_project.lock().unwrap() = Some(path);
    Ok(())
}

// ── Accès à la base de suivi par l'assistant (outils db_query / db_execute) ──
//
// L'assistant est responsable de son suivi : il construit et met à jour ses
// propres structures dans sa base SQLite (~/.pilot/super-agent.db). Ces commandes
// lui donnent un accès contrôlé (lecture SELECT / écriture CREATE/INSERT/UPDATE/
// DELETE/ALTER/DROP) sur SA base uniquement — jamais sur les fichiers des projets.
// Le frontend intercepte les outils d'extension (sentinel) et appelle ces
// commandes ; le résultat est renvoyé au LLM.

fn sqlite_value_to_json(v: rusqlite::types::Value) -> Value {
    match v {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(i) => Value::Number(i.into()),
        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        rusqlite::types::Value::Text(s) => Value::String(s),
        rusqlite::types::Value::Blob(b) => Value::String(format!("<blob {} octets>", b.len())),
    }
}

/// Exécute une requête SELECT en lecture seule sur la base de suivi de
/// l'assistant. Retourne `{ rows: [...], count: n }`.
#[tauri::command]
pub fn super_agent_db_query(app: AppHandle, sql: String) -> Result<Value, String> {
    let trimmed = sql.trim_start();
    if !trimmed.to_uppercase().starts_with("SELECT") {
        return Err("super_agent_db_query : seules les requêtes SELECT sont autorisées".to_string());
    }
    let conn = open_db(&app)?;
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Erreur SQL : {}", e))?;
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
                obj.insert(name.clone(), sqlite_value_to_json(val));
            }
            Ok(serde_json::Value::Object(obj))
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut result: Vec<Value> = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Erreur SQL : {}", e))?);
    }
    Ok(serde_json::json!({ "rows": result, "count": result.len() }))
}

/// Exécute une requête d'écriture (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER,
/// DROP, PRAGMA) sur la base de suivi de l'assistant. Retourne `{ ok: true }`.
#[tauri::command]
pub fn super_agent_db_execute(app: AppHandle, sql: String) -> Result<Value, String> {
    let trimmed = sql.trim_start();
    let upper = trimmed.to_uppercase();
    if upper.starts_with("SELECT") {
        return Err("super_agent_db_execute : utilisez super_agent_db_query pour les SELECT".to_string());
    }
    let conn = open_db(&app)?;
    conn.execute_batch(&sql).map_err(|e| format!("Erreur SQL : {}", e))?;
    Ok(serde_json::json!({ "ok": true }))
}

// ── Planification d'actions récurrentes de l'assistant (chantier #13) ──
//
// L'assistant (onglet 🧭) peut créer des `assistant_schedules` : des actions
// récurrentes (prompt) déclenchées périodiquement (intervalle `every` >= 60s)
// par le ticker du frontend (super-agent.js, toutes les 10 s). Garde-fous :
//   - `every` >= 60 s (borne minimale, évite le spam),
//   - max 20 planifications en parallèle,
//   - 1 exécution max par planification et par tick (last_run_at marqué
//     atomiquement lors de l'émission),
//   - session super-agent morte = pas de tick (super_agent_schedule_tick).

pub(crate) const SCHEDULE_MIN_EVERY_SECS: i64 = 60;
pub(crate) const SCHEDULE_MAX: i64 = 20;

/// Planification telle que renvoyée au frontend / à l'assistant.
pub(crate) struct DueSchedule {
    id: i64,
    name: String,
    prompt: String,
    every: i64,
}

impl DueSchedule {
    fn to_json(&self) -> Value {
        serde_json::json!({ "id": self.id, "name": self.name, "prompt": self.prompt, "every": self.every })
    }
}

/// Insère une planification. Valide les garde-fous (every >= 60s, nom/prompt
/// non vides, max 20). Retourne l'id créé. Fonction pure sur `Connection` pour
/// être testable (in-memory en test, open_db en production).
pub(crate) fn schedule_insert(
    conn: &Connection,
    name: &str,
    prompt: &str,
    every: i64,
) -> Result<i64, String> {
    let name = name.trim();
    let prompt = prompt.trim();
    if name.is_empty() {
        return Err("schedule : un nom est requis".to_string());
    }
    if prompt.is_empty() {
        return Err("schedule : un prompt est requis".to_string());
    }
    if every < SCHEDULE_MIN_EVERY_SECS {
        return Err(format!(
            "schedule : l'intervalle doit être >= {} s (reçu {} s)",
            SCHEDULE_MIN_EVERY_SECS, every
        ));
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM assistant_schedules", [], |r| r.get(0))
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    if count >= SCHEDULE_MAX {
        return Err(format!(
            "schedule : maximum {} planifications atteint",
            SCHEDULE_MAX
        ));
    }
    conn.execute(
        "INSERT INTO assistant_schedules (name, prompt, every) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, prompt, every],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "schedule : ce nom existe déjà".to_string()
        } else {
            format!("Erreur SQL : {}", e)
        }
    })?;
    Ok(conn.last_insert_rowid())
}

/// Supprime une planification par id.
pub(crate) fn schedule_delete(conn: &Connection, id: i64) -> Result<bool, String> {
    let n = conn
        .execute("DELETE FROM assistant_schedules WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    Ok(n > 0)
}

/// Liste toutes les planifications.
pub(crate) fn schedule_list(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, prompt, every, enabled, last_run_at FROM assistant_schedules ORDER BY id",
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "name": r.get::<_, String>(1)?,
                "prompt": r.get::<_, String>(2)?,
                "every": r.get::<_, i64>(3)?,
                "enabled": r.get::<_, i64>(4)? != 0,
                "last_run_at": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Erreur SQL : {}", e))?);
    }
    Ok(result)
}

/// Retourne les planifications dues à `now` (format datetime('now') UTC) et les
/// marque comme exécutées (last_run_at = now) : 1 exécution max par
/// planification et par tick — un second appel dans la même fenêtre ne renvoie
/// plus rien pour ces planifications.
pub(crate) fn schedule_due_and_mark(conn: &Connection, now: &str) -> Result<Vec<DueSchedule>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, prompt, every FROM assistant_schedules \
             WHERE enabled = 1 AND (last_run_at IS NULL \
               OR last_run_at <= datetime(?1, '-' || CAST(every AS TEXT) || ' seconds')) \
             ORDER BY id",
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let rows = stmt
        .query_map([now], |r| {
            Ok(DueSchedule {
                id: r.get(0)?,
                name: r.get(1)?,
                prompt: r.get(2)?,
                every: r.get(3)?,
            })
        })
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let mut due = Vec::new();
    for row in rows {
        let d = row.map_err(|e| format!("Erreur SQL : {}", e))?;
        conn.execute(
            "UPDATE assistant_schedules SET last_run_at = ?1, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, d.id],
        )
        .map_err(|e| format!("Erreur SQL : {}", e))?;
        due.push(d);
    }
    Ok(due)
}

// ── Commandes Tauri (appelées depuis super-agent.js / l'extension) ──

/// Crée une planification d'action récurrente pour l'assistant.
#[tauri::command]
pub fn super_agent_schedule_create(
    app: AppHandle,
    name: String,
    prompt: String,
    every: i64,
) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let id = schedule_insert(&conn, &name, &prompt, every)?;
    Ok(serde_json::json!({ "ok": true, "id": id }))
}

/// Supprime une planification d'action récurrente.
#[tauri::command]
pub fn super_agent_schedule_delete(app: AppHandle, id: i64) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let removed = schedule_delete(&conn, id)?;
    Ok(serde_json::json!({ "ok": removed, "id": id }))
}

/// Liste les planifications d'actions récurrentes.
#[tauri::command]
pub fn super_agent_schedule_list(app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let rows = schedule_list(&conn)?;
    Ok(serde_json::json!({ "schedules": rows, "count": rows.len() }))
}

/// Tick du ticker frontend (toutes les 10 s). Retourne les planifications dues
/// (au plus 1 par planification et par tick, marquées atomiquement) uniquement
/// si la session super-agent est vivante — session morte = pas de tick.
#[tauri::command]
pub fn super_agent_schedule_tick(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    if !state.agent_service.superagent_alive() {
        return Ok(serde_json::json!({ "alive": false, "due": [], "count": 0 }));
    }
    let conn = open_db(&app)?;
    let now: String = conn
        .query_row("SELECT datetime('now')", [], |r| r.get(0))
        .map_err(|e| format!("Erreur SQL : {}", e))?;
    let due = schedule_due_and_mark(&conn, &now)?;
    let due_json: Vec<Value> = due.iter().map(|d| d.to_json()).collect();
    Ok(serde_json::json!({ "alive": true, "due": due_json, "count": due_json.len() }))
}

#[tauri::command]
pub fn new_super_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "new_session"});
    state.agent_service.send_superagent_sync(cmd).map(|_| ())
}

#[tauri::command]
pub fn set_super_agent_model(state: State<AppState>, app: AppHandle, provider: String, model_id: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "set_model", "provider": provider, "modelId": model_id});
    let resp = state.agent_service.send_superagent_sync(cmd)?;
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
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_model = format!("{}/{}", provider, model_id);
    crate::save_config_disk(&app, &cfg).ok();
    Ok(())
}

/// Envoie une commande arbitraire au processus pi du super-agent (ex:
/// `extension_ui_response` pour répondre aux boutons de question posés par
/// l'assistant via pilot-choices).
#[tauri::command]
pub fn send_super_agent_command(state: State<AppState>, app: AppHandle, command: Value) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    state.agent_service.send_superagent(command)
}

#[tauri::command]
pub fn abort_super_agent(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "abort"});
    state.agent_service.send_superagent(cmd)
}

#[tauri::command]
pub fn get_super_agent_state(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "get_state"});
    state.agent_service.send_superagent_sync_timeout(cmd, 8)
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
        "show_thinking": cfg.super_agent_show_thinking,
        "show_tools": cfg.super_agent_show_tools,
        "super_agent_invisible_agent": cfg.super_agent_invisible_agent,
        "super_agent_quality_gate": cfg.super_agent_quality_gate,
        "super_agent_inherit_context": cfg.super_agent_inherit_context,
        "adaptive_personality": cfg.super_agent_adaptive_personality,
        "personality": cfg.super_agent_personality,
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
    show_thinking: Option<bool>,
    show_tools: Option<bool>,
    adaptive_personality: Option<bool>,
    super_agent_quality_gate: Option<bool>,
    super_agent_inherit_context: Option<bool>,
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
    if let Some(v) = show_thinking {
        cfg.super_agent_show_thinking = v;
    }
    if let Some(v) = show_tools {
        cfg.super_agent_show_tools = v;
    }
    if let Some(v) = adaptive_personality {
        cfg.super_agent_adaptive_personality = v;
    }
    if let Some(v) = super_agent_quality_gate {
        cfg.super_agent_quality_gate = v;
    }
    if let Some(v) = super_agent_inherit_context {
        cfg.super_agent_inherit_context = v;
    }
    crate::save_config_disk(&app, &cfg)?;
    Ok(())
}

/// Permet à l'assistant de mettre à jour son propre prompt personnalisé au fil
/// des discussions (outil `update_my_prompt`). Le changement est persisté dans
/// la config (donc pris en compte dès le prochain message) et un historique des
/// versions est conservé pour traçabilité / réversibilité.
#[tauri::command]
pub fn set_super_agent_prompt(state: State<AppState>, app: AppHandle, prompt: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_prompt = prompt.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions du prompt (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("prompt-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{prompt}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Permet à l'assistant de mettre à jour la mémoire persistée sur l'utilisateur
/// (A17, outil `update_user_memory`). Profil/notes sur l'utilisateur ou
/// développeur de Pilot (préférences, contexte, habitudes) appris au fil des
/// discussions. Le changement est persisté dans la config (donc injecté dès le
/// prochain message) et un historique des versions est conservé pour traçabilité
/// / réversibilité.
#[tauri::command]
pub fn set_super_agent_user_memory(state: State<AppState>, app: AppHandle, memory: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_user_memory = memory.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions de la mémoire (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("user-memory-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{memory}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Persiste la personnalité adaptée à l'utilisateur (A18) déduite en
/// arrière-plan de la conversation. Le changement est persisté dans la config
/// (donc injecté dès le prochain message) et un historique des versions est
/// conservé pour traçabilité / réversibilité.
#[tauri::command]
pub fn set_super_agent_personality(state: State<AppState>, app: AppHandle, personality: String) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.super_agent_personality = personality.clone();
    crate::save_config_disk(&app, &cfg)?;
    // Historique des versions de la personnalité (traçabilité / réversibilité).
    if let Ok(dir) = app.path().app_data_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let hist = dir.join("personality-history.md");
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
            let entry = format!("\n--- {ts} ---\n{personality}\n");
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&hist)
                .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
        }
    }
    Ok(())
}

/// Analyse en arrière-plan la conversation en cours (A18) pour déduire le
/// style/ton/personnalité qui correspond le mieux à l'utilisateur. Lance un
/// process pi frais `--no-session` (pattern `ask_pi_caged`, éprouvé par l'aide
/// et le reviewer) sur l'historique fourni et retourne une description concise
/// de la personnalité. Commande **async** : le travail bloquant est exécuté dans
/// `spawn_blocking` avec un timeout global, pour ne jamais bloquer l'UI.
#[tauri::command]
pub async fn analyze_super_agent_personality(
    state: State<'_, AppState>,
    history: Vec<SuperAgentTurn>,
) -> Result<String, String> {
    let (pi_path, mut model) = {
        let cfg = state.config.lock().unwrap();
        (cfg.rpc_pi_path.clone(), cfg.super_agent_model.clone())
    };
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

    // Construire le prompt d'analyse à partir de l'historique de la conversation.
    let mut prompt = String::from(
        "Analyse la conversation suivante entre un utilisateur et un assistant de suivi de projets. Déduis le style, le ton et la personnalité qui correspondent le mieux à l'UTILISATEUR (sa façon de s'exprimer, son niveau de détail, son humour, sa formalité, ses préférences de communication). Réponds UNIQUEMENT par une description concise (2 à 4 phrases) de la personnalité à adopter pour s'adapter à cet utilisateur, à la première personne du point de vue de l'assistant (ex: « Je m'adresse à toi de façon directe et concise, avec un ton léger… »). Ne répète pas la conversation.",
    );
    for turn in &history {
        let role = if turn.role == "user" { "Utilisateur" } else { "Assistant" };
        prompt.push_str(&format!("\n\n{} : {}", role, turn.content));
    }

    let pi_path_owned = pi_path;
    let cwd_owned = cwd;
    let prompt_owned = prompt;
    let model_owned = model;

    let result: String = tokio::time::timeout(
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
    .map_err(|_| "L'analyse de personnalité a mis trop de temps à répondre (120 s).".to_string())?
    .map_err(|e| format!("Erreur interne: {}", e))??;

    Ok(result.trim().to_string())
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

/// Liste les projets connus de la base avec leur client associé (source de
/// vérité : la config `super_agent_project_client`, path → nom de client).
/// Retourne `{ projects: [{ path, name, client }] }`.
#[tauri::command]
pub fn list_super_agent_projects(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT path, name FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Erreur lecture projets: {}", e))?;
    let mut projects: Vec<Value> = Vec::new();
    for row in rows {
        if let Ok((path, name)) = row {
            projects.push(serde_json::json!({"path": path, "name": name}));
        }
    }
    drop(stmt);
    drop(conn);
    // Associer le client depuis la config (source de vérité de l'association).
    let cfg = state.config.lock().unwrap();
    for p in projects.iter_mut() {
        let path = p.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let client = cfg.super_agent_project_client.get(path).cloned().unwrap_or_default();
        p["client"] = serde_json::json!(client);
    }
    Ok(serde_json::json!({"projects": projects}))
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
    if state.agent_service.superagent_alive() {
        let msg = format!(
            "[Résumé de session] Projet: {}\n{}\n\nIntègre ces informations dans ton suivi (tâches, décisions, état d'avancement).",
            project_path.unwrap_or_default(),
            summary
        );
        let cmd = serde_json::json!({"type": "prompt", "message": msg});
        state.agent_service.send_superagent(cmd).ok();
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

    let msg = format!(
        "Tu es l'assistant de suivi du projet « {} ». Analyse ce projet (structure, documentation, historique) puis pose les questions nécessaires à ton fonctionnement : contexte, objectifs, client, jalons, état d'avancement. Tu es en lecture seule : ne modifie aucun fichier du projet.",
        project_path
    );
    let cmd = serde_json::json!({"type": "prompt", "message": msg});
    state.agent_service.send_superagent(cmd)
}

// ── Question sur tous les projets ──

/// Répond à une question en s'appuyant sur la base + le super-agent.
#[tauri::command]
pub fn query_super_agent(state: State<AppState>, app: AppHandle, question: String) -> Result<(), String> {
    do_start_super_agent_session(state.inner(), &app)?;
    let cmd = serde_json::json!({"type": "prompt", "message": question});
    state.agent_service.send_superagent(cmd)
}

#[cfg(test)]
mod tests {
    use super::{build_project_context, init_db, schedule_delete, schedule_due_and_mark, schedule_insert, schedule_list};
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn schedule_rejects_every_below_60() {
        let conn = mem_conn();
        let err = schedule_insert(&conn, "trop rapide", "prompt", 59).unwrap_err();
        assert!(err.contains(">= 60"));
        // 60 est accepté.
        assert!(schedule_insert(&conn, "ok", "prompt", 60).is_ok());
    }

    #[test]
    fn schedule_rejects_empty_name_or_prompt_and_duplicate_name() {
        let conn = mem_conn();
        assert!(schedule_insert(&conn, "  ", "prompt", 120).is_err());
        assert!(schedule_insert(&conn, "nom", "  ", 120).is_err());
        assert!(schedule_insert(&conn, "même nom", "a", 120).is_ok());
        assert!(schedule_insert(&conn, "même nom", "b", 120).is_err());
    }

    #[test]
    fn schedule_caps_at_20() {
        let conn = mem_conn();
        for i in 0..20 {
            schedule_insert(&conn, &format!("s{}", i), "prompt", 120).unwrap();
        }
        assert!(schedule_insert(&conn, "s21", "prompt", 120).is_err());
    }

    #[test]
    fn schedule_due_marks_and_returns_at_most_once_per_tick() {
        let conn = mem_conn();
        schedule_insert(&conn, "s1", "prompt", 60).unwrap();
        // Premier tick : jamais exécutée → due.
        let due = schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap();
        assert_eq!(due.len(), 1);
        // Second tick immédiat : marquée → plus due.
        let due2 = schedule_due_and_mark(&conn, "2025-01-01 00:00:00").unwrap();
        assert!(due2.is_empty());
        // Avance de 61 s → due à nouveau.
        let due3 = schedule_due_and_mark(&conn, "2025-01-01 00:01:01").unwrap();
        assert_eq!(due3.len(), 1);
        // Marquer avec une date dans le futur ne renvoie rien non plus.
        assert!(schedule_due_and_mark(&conn, "2025-01-01 00:00:30").unwrap().is_empty());
    }

    #[test]
    fn schedule_delete_and_list() {
        let conn = mem_conn();
        let id = schedule_insert(&conn, "s1", "prompt", 120).unwrap();
        assert_eq!(schedule_list(&conn).unwrap().len(), 1);
        assert!(schedule_delete(&conn, id).unwrap());
        assert!(!schedule_delete(&conn, id).unwrap());
        assert!(schedule_list(&conn).unwrap().is_empty());
    }

    #[test]
    fn active_project_is_always_the_default_target() {
        let ctx = build_project_context(Some("/proj/actif"), Some("/proj/ancien"));
        // Le projet actif est annoncé comme « projet courant de la conversation ».
        assert!(ctx.contains("Projet actuellement actif dans Pilot : « /proj/actif »."));
        // L'ancien projet de travail est explicitement rétrogradé.
        assert!(ctx.contains("Ancien projet de travail (ne le considère PLUS comme actif) : « /proj/ancien »."));
        // La règle insiste sur la primauté du projet actif.
        assert!(ctx.contains("considère TOUJOURS le projet actif comme le projet par défaut"));
        // L'index de l'ancien projet (source du bug #40) n'apparaît PAS comme actif.
        assert!(!ctx.contains("Projet actuellement actif dans Pilot : « /proj/ancien »."));
    }

    #[test]
    fn no_working_when_same_as_active() {
        // Si l'ancien projet == projet actif, on ne parle pas d'un « ancien projet ».
        let ctx = build_project_context(Some("/proj"), Some("/proj"));
        assert!(ctx.contains("Projet actuellement actif"));
        assert!(!ctx.contains("Ancien projet de travail"));
    }

    #[test]
    fn working_only_when_no_active() {
        let ctx = build_project_context(None, Some("/proj"));
        assert!(ctx.contains("Projet sur lequel tu travaillais : « /proj »."));
        assert!(!ctx.contains("Projet actuellement actif"));
    }

    #[test]
    fn empty_when_no_project() {
        assert_eq!(build_project_context(None, None), "");
    }
}
