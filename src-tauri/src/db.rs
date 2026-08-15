// db.rs — Base SQLite partagée `pilot.db` (refonte système d'agents, cahier §3.1).
//
// Ouvre `pilot.db` dans le répertoire de données de l'app et applique les
// migrations versionnées. Tables centrales :
//   - `agents`      : l'objet Agent (état logique, indépendant de l'UI).
//   - `agent_views` : la vue optionnelle (onglet) dissociée de l'objet.
//
// La persistance des onglets (ex `tabs.rs` JSON hachés) et le registre
// `~/.pilot/agents.json` convergent vers ces tables.

use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Chemin de la base `pilot.db` dans le répertoire de données de l'app.
pub(crate) fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin données: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier données: {}", e))?;
    Ok(dir.join("pilot.db"))
}

/// Ouvre (ou crée) la base et applique les migrations. À appeler à chaque
/// opération (connexion courte) — SQLite est léger et le volume est faible.
pub(crate) fn open_conn(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("Erreur ouverture pilot.db: {}", e))?;
    init_db(&conn)?;
    Ok(conn)
}

/// Applique les migrations versionnées (idempotentes via IF NOT EXISTS).
fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;

        -- Registre d'agents : l'objet central (cahier §4.3).
        CREATE TABLE IF NOT EXISTS agents (
            id            TEXT NOT NULL,
            project_path  TEXT,                      -- NULL = agent global ; sinon projet attaché
            name          TEXT NOT NULL,
            icon          TEXT DEFAULT '🤖',
            description   TEXT DEFAULT '',
            role          TEXT NOT NULL,
            models_pi     TEXT DEFAULT '',
            models_plh    TEXT DEFAULT '',
            capabilities  TEXT DEFAULT '[]',         -- JSON array
            readonly      INTEGER DEFAULT 0,
            keep_context  INTEGER DEFAULT 0,
            max_calls_per_run INTEGER DEFAULT 5,
            call_depth    INTEGER DEFAULT 1,

            -- État logique (persisté pour survivre aux redémarrages)
            loaded        INTEGER DEFAULT 0,
            busy          INTEGER DEFAULT 0,
            proc_state    TEXT DEFAULT 'Unloaded',   -- Running / Compacting / Paused / Stopped / Error
            visible       INTEGER DEFAULT 1,         -- 0 = « agent invisible »
            last_active_at TEXT,

            UNIQUE (id, project_path)
        );

        -- Vues d'onglets : dissocie la vue (Tab) de l'objet Agent.
        CREATE TABLE IF NOT EXISTS agent_views (
            agent_id      TEXT NOT NULL,
            project_path  TEXT NOT NULL,
            order_index   INTEGER NOT NULL,
            name_override TEXT,
            active        INTEGER DEFAULT 0,
            PRIMARY KEY (agent_id, project_path),
            FOREIGN KEY (agent_id, project_path) REFERENCES agents(id, project_path)
        );
        ",
    )
    .map_err(|e| format!("Erreur migration pilot.db: {}", e))?;
    Ok(())
}
