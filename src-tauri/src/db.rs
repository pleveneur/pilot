// db.rs — Base SQLite partagée `pilot.db` (refonte système d'agents, cahier §3.1).
//
// Ouvre `pilot.db` dans le répertoire de données de l'app et applique les
// migrations versionnées. Tables centrales :
//   - `agents`      : l'objet Agent (état logique, indépendant de l'UI).
//   - `agent_views` : la vue optionnelle (onglet) dissociée de l'objet.
//
// La persistance des onglets (ex `tabs.rs` JSON hachés) et le registre des
// agents sont désormais centralisés dans ces tables.

use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
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
    backup_before_agent_path_migration(&conn, &path);
    init_db(&conn)?;
    Ok(conn)
}

/// Tâche #345 : copie de sûreté de `pilot.db` AVANT la migration des chemins de
/// projet (fusion des fiches d'agent en double).
///
/// Une seule copie, à nom fixe : si elle existe déjà elle n'est JAMAIS écrasée
/// ni supprimée (l'utilisateur peut restaurer la base d'origine telle quelle).
/// Rien à faire sur une base neuve (fichier absent) ou déjà migrée (colonne
/// `chemin_normalise` présente) : pas de copie inutile à chaque ouverture.
fn backup_before_agent_path_migration(conn: &Connection, path: &std::path::Path) {
    if !path.exists() || column_exists(conn, "agents", "chemin_normalise") {
        return;
    }
    let dest = path.with_file_name("pilot.db.bak-chemins-normalises");
    if dest.exists() {
        return;
    }
    // `pilot.db` peut être en mode WAL : la copie du seul fichier principal
    // manquerait les transactions non « checkpointées ». On copie donc aussi
    // les journaux s'ils existent (best-effort : un échec de copie ne bloque pas
    // le démarrage — la migration reste idempotente et sans perte de lignes).
    if std::fs::copy(path, &dest).is_ok() {
        for suffix in ["-wal", "-shm"] {
            let src = path.with_file_name(format!("pilot.db{}", suffix));
            if src.exists() {
                let _ = std::fs::copy(
                    &src,
                    path.with_file_name(format!("pilot.db.bak-chemins-normalises{}", suffix)),
                );
            }
        }
    }
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

    // Tâche #345 : clé de projet canonique + unicité `(id, chemin_normalise)`,
    // avec fusion des fiches en double déjà présentes (migration idempotente).
    migrate_agent_paths(conn)?;
    Ok(())
}

/// Indique si une colonne existe (sonde `PRAGMA table_info`).
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({})", table)) else {
        return false;
    };
    let found = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.flatten().any(|n| n == column))
        .unwrap_or(false);
    found
}

/// Tâche #345 — « fiches d'agent en double » : clé de projet canonique.
///
/// Le registre `agents` était écrit et relu avec le chemin BRUT du projet : le
/// même projet enregistré `G:/IA_PL/pilot` puis `G:\IA_PL\pilot\` fabriquait une
/// fiche supplémentaire à chaque écriture (constaté sur la base réelle : 348
/// lignes pour 168 identifiants). On ajoute `chemin_normalise` (clé canonique,
/// cf. `crate::normalize_project_path`, déjà utilisé par GDS), on FUSIONNE les
/// doublons existants (la fiche la PLUS ANCIENNE est conservée, `rowid`
/// minimal), on aligne `agents.project_path` et `agent_views.project_path` sur
/// cette clé (la clé étrangère de `agent_views` porte sur le couple
/// `(id, project_path)`), puis on pose l'index UNIQUE `(id, chemin_normalise)`
/// qui rend le doublon désormais impossible côté écriture.
///
/// Idempotente et sans réécriture en régime établi : `open_conn` appelle
/// `init_db` à CHAQUE opération, donc dès que la base est canonique l'analyse
/// ne détecte rien et sort après avoir garanti l'index.
fn migrate_agent_paths(conn: &Connection) -> Result<(), String> {
    let column_added = !column_exists(conn, "agents", "chemin_normalise");
    add_column_if_missing(
        conn,
        "agents",
        "chemin_normalise",
        "ALTER TABLE agents ADD COLUMN chemin_normalise TEXT",
    )?;

    // 1. Analyse : clé canonique attendue par fiche + repérage des doublons.
    let mut rows: Vec<(i64, String, Option<String>, Option<String>)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT rowid, id, project_path, chemin_normalise FROM agents ORDER BY rowid")
            .map_err(|e| format!("Erreur migration chemins (prepare): {}", e))?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| format!("Erreur migration chemins (query): {}", e))?;
        for row in mapped {
            rows.push(row.map_err(|e| format!("Erreur migration chemins (row): {}", e))?);
        }
    }
    let mut needs = column_added;
    // Clé canonique → rowid de la fiche la plus ancienne (celle que l'on garde).
    let mut seen_keys: HashMap<(String, String), i64> = HashMap::new();
    let mut dupes: Vec<i64> = Vec::new();
    for (rowid, id, raw, stored) in &rows {
        let canonical = raw.as_deref().map(crate::normalize_project_path);
        if *stored != canonical {
            needs = true;
        }
        if let Some(c) = &canonical {
            // `project_path` doit lui-même être la forme canonique (clé étrangère
            // de `agent_views` + cohérence avec les clés de session et la purge).
            if raw.as_deref() != Some(c.as_str()) {
                needs = true;
            }
            if seen_keys.insert((id.clone(), c.clone()), *rowid).is_some() {
                needs = true;
                dupes.push(*rowid);
            }
        }
    }
    // Les vues d'onglets doivent porter la même clé canonique (FK).
    let mut views: Vec<(String, String)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT agent_id, project_path FROM agent_views")
            .map_err(|e| format!("Erreur migration chemins (vues): {}", e))?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Erreur migration chemins (vues query): {}", e))?;
        for row in mapped {
            views.push(row.map_err(|e| format!("Erreur migration chemins (vues row): {}", e))?);
        }
    }
    let views_canonical = views
        .iter()
        .all(|(_, p)| *p == crate::normalize_project_path(p));
    if !needs && views_canonical {
        // Base déjà canonique : garantir l'index, ne rien réécrire.
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_id_chemin ON agents (id, chemin_normalise)",
            [],
        )
        .map_err(|e| format!("Erreur index chemins: {}", e))?;
        return Ok(());
    }

    // 2. Réécriture : la clé étrangère de `agent_views` porte sur `(id,
    //    project_path)`, que l'on change → on la désactive le temps de
    //    l'opération (connexion courte, aucun accès concurrent) puis on la
    //    réactive systématiquement.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|e| format!("Erreur migration chemins (fk off): {}", e))?;
    let result = rewrite_agent_paths(conn, &rows, &dupes);
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
    result?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_id_chemin ON agents (id, chemin_normalise)",
        [],
    )
    .map_err(|e| format!("Erreur index chemins: {}", e))?;
    Ok(())
}

/// Réécriture effective du registre (appelée FK désactivée, cf. `migrate_agent_paths`).
fn rewrite_agent_paths(
    conn: &Connection,
    rows: &[(i64, String, Option<String>, Option<String>)],
    dupes: &[i64],
) -> Result<(), String> {
    // a. Renseigne la clé canonique de chaque fiche (le chemin brut est encore
    //    intact : il sert à calculer la forme canonique).
    for (rowid, _, raw, _) in rows {
        let canonical = raw.as_deref().map(crate::normalize_project_path);
        conn.execute(
            "UPDATE agents SET chemin_normalise = ?1 WHERE rowid = ?2",
            params![canonical, rowid],
        )
        .map_err(|e| format!("Erreur migration chemins (clé): {}", e))?;
    }
    // b. Fusion : les fiches en double (même id + même clé canonique) sont
    //    supprimées ; la plus ancienne (rowid minimal) est conservée.
    for rowid in dupes {
        conn.execute("DELETE FROM agents WHERE rowid = ?1", params![rowid])
            .map_err(|e| format!("Erreur migration chemins (fusion): {}", e))?;
    }
    // c. Vues d'onglets : clé canonique, dédoublonnage, vues orphelines retirées.
    let mut views: Vec<(String, String, i64, Option<String>, i64)> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT agent_id, project_path, order_index, name_override, active FROM agent_views",
            )
            .map_err(|e| format!("Erreur migration chemins (vues prepare): {}", e))?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| format!("Erreur migration chemins (vues query): {}", e))?;
        for row in mapped {
            views.push(row.map_err(|e| format!("Erreur migration chemins (vues row): {}", e))?);
        }
    }
    let mut kept: Vec<(String, String, i64, Option<String>, i64)> = Vec::new();
    let mut seen_views: HashSet<(String, String)> = HashSet::new();
    for (agent_id, path, order_index, name_override, active) in views {
        let canonical = crate::normalize_project_path(&path);
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM agents WHERE id = ?1 AND chemin_normalise = ?2)",
                params![agent_id, canonical],
                |r| r.get(0),
            )
            .map_err(|e| format!("Erreur migration chemins (vues exists): {}", e))?;
        if exists && seen_views.insert((agent_id.clone(), canonical.clone())) {
            kept.push((agent_id, canonical, order_index, name_override, active));
        }
    }
    conn.execute("DELETE FROM agent_views", [])
        .map_err(|e| format!("Erreur migration chemins (vues purge): {}", e))?;
    for (agent_id, canonical, order_index, name_override, active) in kept {
        conn.execute(
            "INSERT INTO agent_views (agent_id, project_path, order_index, name_override, active)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![agent_id, canonical, order_index, name_override, active],
        )
        .map_err(|e| format!("Erreur migration chemins (vues insert): {}", e))?;
    }
    // d. `project_path` devient la forme canonique : les deux colonnes sont
    //    désormais alignées (`chemin_normalise` est la clé explicite et indexée).
    conn.execute(
        "UPDATE agents SET project_path = chemin_normalise
         WHERE project_path IS NOT NULL AND project_path <> chemin_normalise",
        [],
    )
    .map_err(|e| format!("Erreur migration chemins (normalisation): {}", e))?;
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

    /// Tâche #345 : `init_db` sur une base « ancienne » (sans
    /// `chemin_normalise`) fusionne les fiches d'un même projet écrites sous deux
    /// formes de chemin, conserve la PLUS ANCIENNE, aligne `agents.project_path`
    /// et `agent_views.project_path` sur la clé canonique, pose l'index unique et
    /// reste idempotent. Un projet au chemin voisin mais réellement distinct n'est
    /// PAS fusionné.
    #[test]
    fn init_db_merges_duplicate_agent_paths() {
        let conn = Connection::open_in_memory().expect("db mémoire");
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
                last_active_at TEXT, UNIQUE (id, project_path));
             CREATE TABLE agent_views (
                agent_id TEXT NOT NULL, project_path TEXT NOT NULL,
                order_index INTEGER NOT NULL, name_override TEXT, active INTEGER DEFAULT 0,
                PRIMARY KEY (agent_id, project_path),
                FOREIGN KEY (agent_id, project_path) REFERENCES agents(id, project_path));",
        )
        .expect("schéma ancien");
        // Fiche la plus ancienne (forme `/`), doublon (forme `\` + slash final),
        // et un projet au chemin voisin mais réellement distinct.
        conn.execute_batch(
            "INSERT INTO agents (id, project_path, name, role) VALUES
                ('codeur', 'G:/IA_PL/pilot', 'Ancienne', 'role A'),
                ('codeur', 'G:\\IA_PL\\pilot\\', 'Récente', 'role B'),
                ('codeur', 'G:/IA_PL/pilot - Analyseur', 'Analyseur', 'role C');
             INSERT INTO agent_views (agent_id, project_path, order_index) VALUES
                ('codeur', 'G:\\IA_PL\\pilot\\', 3);",
        )
        .expect("lignes de test");

        init_db(&conn).expect("migration");
        init_db(&conn).expect("migration idempotente (2e passage)");

        let kept_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE id = 'codeur' AND chemin_normalise IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .expect("compte après fusion");
        assert_eq!(kept_count, 2, "un doublon fusionné, le projet distinct conservé");

        // La fiche la PLUS ANCIENNE est conservée (son libellé), pas la récente.
        let kept_name: String = conn
            .query_row(
                "SELECT name FROM agents WHERE id = 'codeur' AND chemin_normalise = ?1",
                params![crate::normalize_project_path("G:\\IA_PL\\pilot\\")],
                |r| r.get(0),
            )
            .expect("fiche conservée");
        assert_eq!(kept_name, "Ancienne", "la fiche la plus ancienne est conservée");

        // Les deux colonnes sont alignées et les vues suivent la forme canonique.
        let (project_path, chemin_normalise): (String, String) = conn
            .query_row(
                "SELECT project_path, chemin_normalise FROM agents
                 WHERE id = 'codeur' AND chemin_normalise = ?1",
                params![crate::normalize_project_path("G:/IA_PL/pilot")],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("alignement des colonnes");
        assert_eq!(project_path, chemin_normalise);
        let view_path: String = conn
            .query_row("SELECT project_path FROM agent_views", [], |r| r.get(0))
            .expect("vue conservée");
        assert_eq!(view_path, crate::normalize_project_path("G:/IA_PL/pilot"));

        // L'index unique rend le doublon désormais impossible à l'écriture.
        // (La forme canonique est celle effectivement stockée : sur Windows elle
        // est aussi en minuscules.)
        let canonical = crate::normalize_project_path("G:/IA_PL/pilot");
        conn.execute(
            "INSERT INTO agents (id, project_path, chemin_normalise, name, role)
             VALUES ('codeur', ?1, ?1, 'doublon', 'r')",
            params![canonical],
        )
        .expect_err("le doublon doit être refusé par l'index unique");
    }
}
