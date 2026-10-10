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
/// `pub(crate)` : réutilisée par les tests unitaires qui valident les purges
/// d'état sur une base en mémoire (même schéma que la base réelle).
pub(crate) fn init_db(conn: &Connection) -> Result<(), String> {
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
            thinking_pi   TEXT NOT NULL DEFAULT '', -- niveau de réflexion backend pi ('' = non réglé)
            thinking_plh  TEXT NOT NULL DEFAULT '', -- niveau de réflexion backend plh ('' = non réglé)
            capabilities  TEXT DEFAULT '[]',         -- JSON array
            skills        TEXT NOT NULL DEFAULT '[]', -- JSON array (noms de compétences)
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

    // Migration idempotente : ajoute `skills` aux bases existantes (le
    // `CREATE TABLE IF NOT EXISTS` ci-dessus ne modifie pas une table déjà
    // créée). On sonde `PRAGMA table_info` pour éviter l'erreur « duplicate
    // column name ». La colonne est NOT NULL DEFAULT '[]' → renseignée pour
    // les lignes existantes à l'ALTER, sans perte.
    add_column_if_missing(
        conn,
        "agents",
        "skills",
        "ALTER TABLE agents ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'",
    )?;

    // Migration idempotente (T3) : niveaux de réflexion par backend. `''` = non
    // réglé → repli sur le réglage général de Pilot puis sur le défaut du moteur
    // (aucun comportement figé pour un utilisateur qui n'y touche pas).
    add_column_if_missing(
        conn,
        "agents",
        "thinking_pi",
        "ALTER TABLE agents ADD COLUMN thinking_pi TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        conn,
        "agents",
        "thinking_plh",
        "ALTER TABLE agents ADD COLUMN thinking_plh TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

/// Ajoute une colonne à une table si elle n'existe pas (migration idempotente).
fn add_column_if_missing(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("Erreur PRAGMA table_info({}): {}", table, e))?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Erreur lecture colonnes {}: {}", table, e))?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    if !names.iter().any(|n| n == column) {
        conn.execute(alter_sql, [])
            .map_err(|e| format!("Erreur migration {}.{}: {}", table, column, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T3 : `init_db` sur une base contenant déjà des agents ajoute les colonnes
    /// `thinking_pi`/`thinking_plh` SANS perdre les lignes, et reste idempotent.
    #[test]
    fn init_db_adds_thinking_columns_to_existing_agents() {
        let conn = Connection::open_in_memory().expect("db mémoire");
        // Base « ancienne » : table `agents` sans thinking_pi/thinking_plh.
        conn.execute_batch(
            "CREATE TABLE agents (
                id TEXT NOT NULL, project_path TEXT, name TEXT NOT NULL,
                icon TEXT DEFAULT '🤖', description TEXT DEFAULT '', role TEXT NOT NULL,
                models_pi TEXT DEFAULT '', models_plh TEXT DEFAULT '',
                capabilities TEXT DEFAULT '[]', skills TEXT NOT NULL DEFAULT '[]',
                readonly INTEGER DEFAULT 0, keep_context INTEGER DEFAULT 0,
                max_calls_per_run INTEGER DEFAULT 5, call_depth INTEGER DEFAULT 1,
                loaded INTEGER DEFAULT 0, busy INTEGER DEFAULT 0,
                proc_state TEXT DEFAULT 'Unloaded', visible INTEGER DEFAULT 1,
                last_active_at TEXT, UNIQUE (id, project_path));",
        )
        .expect("table ancienne");
        conn.execute(
            "INSERT INTO agents (id, name, role) VALUES ('codeur', 'Codeur', 'Tu codes.')",
            [],
        )
        .expect("ligne existante");

        init_db(&conn).expect("migration");
        init_db(&conn).expect("migration idempotente");

        let (name, thinking_pi, thinking_plh): (String, String, String) = conn
            .query_row(
                "SELECT name, thinking_pi, thinking_plh FROM agents WHERE id = 'codeur'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("ligne conservée");
        assert_eq!(name, "Codeur", "la ligne existante est conservée");
        assert_eq!(thinking_pi, "", "défaut = non réglé");
        assert_eq!(thinking_plh, "", "défaut = non réglé");

        let mut stmt = conn.prepare("PRAGMA table_info(agents)").expect("pragma");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("colonnes")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(cols.iter().filter(|c| **c == "thinking_pi").count(), 1);
        assert_eq!(cols.iter().filter(|c| **c == "thinking_plh").count(), 1);
    }
}
