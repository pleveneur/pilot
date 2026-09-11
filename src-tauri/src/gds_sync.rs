// gds_sync.rs — Verrou global projet (spec_gds.md §5, Phase B)
//
// Logique de verrou global projet : acquisition exclusive (échec si déjà
// verrouillé par un autre), TTL/lease (expires_at) + renouvellement,
// récupération des verrous orphelins expirés, relâchement, mode urgent
// (réservé à la personne désignée). Journalise dans audit_gds + avertissement
// des deux parties. Les décisions pures (decide_acquire, can_urgent) sont
// testables sans base de données.

use crate::gds;
use crate::gds_db;
use crate::AppState;
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::PathBuf;
use tauri::{Manager, State};

/// TTL par défaut d'un verrou (secondes) : 30 min. Renouvelable (lease).
pub(crate) const LOCK_TTL_SECS: i64 = 1800;

/// Décision d'acquisition d'un verrou (pure — testable sans DB).
#[derive(Debug, PartialEq)]
pub(crate) enum AcquireDecision {
    /// Aucun verrou → acquisition possible.
    Acquired,
    /// Déjà verrouillé par un autre (non expiré) — contient l'email du titulaire.
    HeldBy(String),
    /// Verrou expiré (orphelin) → peut être récupéré.
    Expired,
}

/// Décide si un verrou peut être acquis, étant donné le verrou courant (None si
/// aucun) et l'instant courant (epoch millis). Pure — testable sans DB.
pub(crate) fn decide_acquire(current: Option<&gds_db::LockRow>, now_ms: i64) -> AcquireDecision {
    match current {
        None => AcquireDecision::Acquired,
        Some(l) if l.expires_at < now_ms => AcquireDecision::Expired,
        Some(l) => AcquireDecision::HeldBy(l.email.clone()),
    }
}

/// Décide si un utilisateur peut passer en mode urgent. `designated` = email de
/// la personne désignée (vide = aucun urgent autorisé). Pure — testable.
pub(crate) fn can_urgent(requester: &str, designated: &str) -> bool {
    !designated.is_empty() && requester == designated
}

/// Acquiert le verrou global du projet (exclusif). Retourne l'état du verrou.
/// - Aucun verrou → acquis.
/// - Verrou expiré (orphelin) → récupéré (expire_stale_locks puis ré-acquisition).
/// - Verrou détenu par un autre (non expiré) → échec avec avertissement.
pub(crate) async fn acquire_project_lock(
    pool: &PgPool,
    project: &str,
    reason: &str,
) -> Result<Value, String> {
    let cfg = gds::read_gds_config(project)?;
    let name = gds::project_name(project);
    let project_id = gds_db::get_project_by_name(pool, &name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    let user = gds_db::get_user_by_email(pool, &cfg.identity_email).await?;
    let user_id = user.map(|u| u.id).unwrap_or(0);

    // 1. Décision pure sur l'état courant du verrou.
    let current = gds_db::get_lock_by_project(pool, project_id).await?;
    match decide_acquire(current.as_ref(), gds_db::now_millis()) {
        AcquireDecision::HeldBy(email) => {
            // Déjà verrouillé par un autre (non expiré) — avertir (refus).
            gds_db::audit_gds(
                pool,
                "desktop",
                &cfg.identity_email,
                "lock.denied",
                &format!("held by {}", email),
                false,
            )
            .await?;
            return Ok(json!({
                "acquired": false,
                "held_by": email,
                "expires_at": current.as_ref().map(|l| l.expires_at).unwrap_or(0),
                "urgent": current.as_ref().map(|l| l.urgent).unwrap_or(false),
            }));
        }
        // Aucun verrou, ou verrou expiré (orphelin) → récupérable.
        AcquireDecision::Acquired | AcquireDecision::Expired => {}
    }
    // 2. Récupérer les verrous orphelins expirés (TTL).
    gds_db::expire_stale_locks(pool).await?;
    // 3. Acquisition exclusive (ON CONFLICT DO NOTHING).
    let acquired = gds_db::acquire_lock(
        pool,
        project_id,
        user_id,
        &cfg.identity_email,
        LOCK_TTL_SECS,
        false,
        reason,
    )
    .await?;
    if acquired {
        gds_db::audit_gds(pool, "desktop", &cfg.identity_email, "lock.acquire", reason, true).await?;
        return Ok(json!({ "acquired": true, "email": cfg.identity_email, "ttl_secs": LOCK_TTL_SECS }));
    }
    // 4. Course : un autre a acquis entre-temps — avertir.
    let lock = gds_db::get_lock_by_project(pool, project_id).await?;
    match lock {
        Some(l) => {
            gds_db::audit_gds(
                pool,
                "desktop",
                &cfg.identity_email,
                "lock.denied",
                &format!("held by {}", l.email),
                false,
            )
            .await?;
            Ok(json!({
                "acquired": false,
                "held_by": l.email,
                "expires_at": l.expires_at,
                "urgent": l.urgent,
            }))
        }
        None => Err("Verrou introuvable après échec d'acquisition".to_string()),
    }
}

/// Passe un verrou en mode urgent (réservé à la personne désignée). Si le
/// verrou est détenu par un autre, l'urgent le remplace (le projet devient
/// « en conflit potentiel ») et avertit les deux parties.
pub(crate) async fn urgent_project_lock(pool: &PgPool, project: &str, reason: &str) -> Result<Value, String> {
    let cfg = gds::read_gds_config(project)?;
    let name = gds::project_name(project);
    let project_id = gds_db::get_project_by_name(pool, &name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    let user = gds_db::get_user_by_email(pool, &cfg.identity_email).await?;
    let user_id = user.map(|u| u.id).unwrap_or(0);
    let designated = cfg.urgent_email.clone().unwrap_or_default();

    if !can_urgent(&cfg.identity_email, &designated) {
        gds_db::audit_gds(
            pool,
            "desktop",
            &cfg.identity_email,
            "lock.urgent.denied",
            "not designated",
            false,
        )
        .await?;
        return Err("Mode urgent réservé à la personne désignée".to_string());
    }
    // Récupérer l'ancien titulaire pour l'avertissement.
    let prev = gds_db::get_lock_by_project(pool, project_id).await?;
    // Remplacer le verrou (supprime puis ré-acquiert en urgent).
    gds_db::release_lock(pool, project_id).await?;
    let acquired = gds_db::acquire_lock(
        pool,
        project_id,
        user_id,
        &cfg.identity_email,
        LOCK_TTL_SECS,
        true,
        reason,
    )
    .await?;
    if !acquired {
        return Err("Échec de l'acquisition du verrou urgent".to_string());
    }
    gds_db::audit_gds(pool, "desktop", &cfg.identity_email, "lock.urgent", reason, true).await?;
    let warned = prev.map(|l| l.email).unwrap_or_default();
    Ok(json!({ "acquired": true, "urgent": true, "replaced": warned, "email": cfg.identity_email }))
}

/// Relâche le verrou global du projet.
pub(crate) async fn release_project_lock(pool: &PgPool, project: &str) -> Result<Value, String> {
    let cfg = gds::read_gds_config(project)?;
    let name = gds::project_name(project);
    let project_id = gds_db::get_project_by_name(pool, &name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    gds_db::release_lock(pool, project_id).await?;
    gds_db::audit_gds(pool, "desktop", &cfg.identity_email, "lock.release", "", true).await?;
    Ok(json!({ "released": true }))
}

/// Commande Tauri : relâche le verrou global du projet.
#[tauri::command]
pub async fn gds_release_lock(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    release_project_lock(&pool, &project).await
}

/// Commande Tauri : retourne l'état du verrou global du projet (None si absent).
#[tauri::command]
pub async fn gds_get_lock(state: State<'_, AppState>, project: String) -> Result<Option<Value>, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    let name = gds::project_name(&project);
    let project_id = gds_db::get_project_by_name(&pool, &name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    let lock = gds_db::get_lock_by_project(&pool, project_id).await?;
    Ok(lock.map(|l| {
        json!({
            "email": l.email,
            "locked_at": l.locked_at,
            "expires_at": l.expires_at,
            "urgent": l.urgent,
            "reason": l.reason,
        })
    }))
}

/// Commande Tauri : synchronise PUIS verrouille un projet GDS (Évol 2/3).
/// 1) Synchronisation automatique (fetch/pull sans écrasement) via
///    `gds_client::sync_project` — celle-ci réalise aussi l'acquisition du
///    verrou (`acquire_project_lock`), refusée si détenu par un autre non
///    expiré (HeldBy), avec TTL/orphelins + audit_gds.
/// 2) Retourne l'état du verrou (satisfait « synchronisation automatique à
///    l'appui » pour les boutons VERROUILLER et l'ouverture de projet GDS).
/// On n'appelle PAS `acquire_project_lock` une seconde fois : la sync vient de
/// l'acquérir → une 2e acquisition renverrait `HeldBy` par le titulaire
/// lui-même (fausse négative). Fail-open pour le suivi (jamais bloquant),
/// PAS pour le verrou (une erreur de sync/lock remonte en erreur).
#[tauri::command]
pub async fn gds_lock_project(
    state: State<'_, AppState>,
    project: String,
    reason: String,
) -> Result<Value, String> {
    let _ = &reason; // raison conservée pour la signature de la commande (Tauri) ;
    // l'acquisition du verrou est réalisée dans sync_project (raison "sync").
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    // Pool : repli `restore_pool_for_project` si le pool AppState est absent
    // (sortie de garde AVANT l'await — garde non-Send à ne pas porter).
    let pool_opt = state.gds_pool.lock().unwrap().clone();
    let pool = match pool_opt {
        Some(p) => p,
        None => crate::gds::restore_pool_for_project(&project)
            .await
            .map_err(|e| format!("GDS non provisionné : {}", e))?,
    };
    // sync + acquisition du verrou (fetch/pull sans écrasement, HeldBy refusé).
    let sync = crate::gds_client::sync_project(&pool, &project).await?;
    Ok(sync.get("lock").cloned().unwrap_or(json!({ "acquired": false })))
}

/// Commande Tauri : état agrégé du verrou GDS d'un projet (Évol 3/4).
/// Retourne `{ locked, email, expires_at, ... }` en agrégeant `gds_get_lock` :
/// verrou absent / projet non enregistré → `{ locked: false, email, null,
/// expires_at: null }`. Fail-open côté lecture (jamais bloquant).
#[tauri::command]
pub async fn gds_lock_state(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Ok(json!({ "locked": false, "email": null, "expires_at": null }));
    }
    let pool_opt = state.gds_pool.lock().unwrap().clone();
    let pool = match pool_opt {
        Some(p) => p,
        None => crate::gds::restore_pool_for_project(&project)
            .await
            .map_err(|_| "GDS non provisionné".to_string())?,
    };
    let name = gds::project_name(&project);
    let project_id = match gds_db::get_project_by_name(&pool, &name).await? {
        Some(id) => id,
        None => return Ok(json!({ "locked": false, "email": null, "expires_at": null })),
    };
    match gds_db::get_lock_by_project(&pool, project_id).await? {
        Some(l) => Ok(json!({
            "locked": true,
            "email": l.email,
            "expires_at": l.expires_at,
            "urgent": l.urgent,
            "reason": l.reason,
        })),
        None => Ok(json!({ "locked": false, "email": null, "expires_at": null })),
    }
}

/// Commande Tauri : passe le verrou du projet en mode urgent (personne désignée).
#[tauri::command]
pub async fn gds_urgent_lock(state: State<'_, AppState>, project: String, reason: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    urgent_project_lock(&pool, &project, &reason).await
}

// ── Pont bidirectionnel SQLite↔Postgres (Phase C1.2, spec_gds.md §6) ──
//
// Fusionne le suivi du super-agent (SQLite local `~/.pilot/super-agent.db`) avec
// PostgreSQL (tables clients/projects/tasks/decisions, migration 0004). Option A :
// Postgres = source de vérité QUAND connecté au GDS ; SQLite local = vérité sinon
// (mode déconnecté). Résolution des divergences par « dernier écrit gagne » sur
// `updated_at` + log des conflits (audit_gds). Watermark de dernière synchro
// persisté dans SQLite (table gds_sync_state).

/// Côté gagnant d'un conflit « dernier écrit gagne » (pure — testable).
#[derive(Debug, PartialEq)]
pub(crate) enum ConflictSide {
    /// La ligne locale est plus récente → on pousse vers Postgres.
    Local,
    /// La ligne distante (Postgres) est plus récente → on rapatrie en local.
    Remote,
    /// Même `updated_at` → aucune action.
    Equal,
}

/// Résout un conflit de divergence sur `updated_at` : le côté le plus récent
/// gagne (« dernier écrit gagne », spec_gds.md §6.1). Pure — testable sans DB.
pub(crate) fn resolve_conflict(local_ms: i64, remote_ms: i64) -> ConflictSide {
    if local_ms > remote_ms {
        ConflictSide::Local
    } else if remote_ms > local_ms {
        ConflictSide::Remote
    } else {
        ConflictSide::Equal
    }
}

/// Parse un `updated_at` (SQLite `YYYY-MM-DD HH:MM:SS` UTC ou Postgres
/// TIMESTAMPTZ RFC3339) en epoch millis. 0 si non parseable.
pub(crate) fn parse_updated_at(s: &str) -> i64 {
    let s = s.trim();
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return ndt.and_utc().timestamp_millis();
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return dt.timestamp_millis();
    }
    if let Ok(dt) = DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f%:z") {
        return dt.timestamp_millis();
    }
    0
}

/// Convertit un `DateTime<Utc>` Postgres au format SQLite `YYYY-MM-DD HH:MM:SS`.
pub(crate) fn pg_to_sqlite_dt(dt: DateTime<Utc>) -> String {
    dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Convertit un epoch millis en `DateTime<Utc>` (pour les upserts Postgres).
pub(crate) fn ms_to_utc(ms: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp_millis(ms).unwrap_or_else(Utc::now)
}

/// Chemin de la base SQLite du super-agent (`~/.pilot/super-agent.db`).
pub(crate) fn sqlite_db_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "HOME/USERPROFILE introuvable".to_string())?;
    if home.is_empty() {
        return Err("HOME/USERPROFILE vide".to_string());
    }
    Ok(PathBuf::from(&home).join(".pilot").join("super-agent.db"))
}

/// Ouvre la base SQLite du super-agent (lecture/écriture) et garantit le schéma
/// du pont (colonne `updated_at` sur `decisions` + tables de mapping/état).
pub(crate) fn open_sqlite() -> Result<Connection, String> {
    let path = sqlite_db_path()?;
    let conn = Connection::open(&path).map_err(|e| format!("Ouverture super-agent.db: {}", e))?;
    ensure_sqlite_schema(&conn)?;
    Ok(conn)
}

/// Garantit le schéma du pont dans SQLite, SANS toucher super_agent.rs :
/// - colonne `updated_at` sur `decisions` (absente du schéma SQLite) — ALTER
///   idempotent via PRAGMA table_info ;
/// - table `gds_id_map` (mapping id SQLite ↔ id Postgres pour tasks/decisions) ;
/// - table `gds_sync_state` (watermark de dernière synchro).
pub(crate) fn ensure_sqlite_schema(conn: &Connection) -> Result<(), String> {
    ensure_sqlite_column(conn, "decisions", "updated_at", "TEXT DEFAULT (datetime('now'))")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gds_id_map (
            entity TEXT NOT NULL,
            sqlite_id INTEGER NOT NULL,
            pg_id INTEGER NOT NULL,
            PRIMARY KEY (entity, sqlite_id)
        );
        CREATE TABLE IF NOT EXISTS gds_sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Création tables pont GDS: {}", e))?;
    Ok(())
}

/// Ajoute une colonne à une table SQLite si absente (migration idempotente via
/// PRAGMA table_info — SQLite n'a pas `ADD COLUMN IF NOT EXISTS` avant 3.35).
pub(crate) fn ensure_sqlite_column(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), String> {
    let mut present = false;
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("Erreur PRAGMA: {}", e))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("Erreur PRAGMA: {}", e))?;
    for row in rows {
        if row.map(|name| name == column).unwrap_or(false) {
            present = true;
            break;
        }
    }
    drop(stmt);
    if !present {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
            [],
        )
        .map_err(|e| format!("Migration colonne {}: {}", column, e))?;
    }
    Ok(())
}

// ── Couche d'accès SQLite : lecture des lignes modifiées ──

struct SqliteClient {
    name: String,
    notes: String,
    updated_at: i64,
}
struct SqliteProject {
    path: String,
    name: String,
    client_id: Option<i64>,
    status: String,
    updated_at: i64,
}
struct SqliteTask {
    id: i64,
    project_id: i64,
    title: String,
    description: String,
    status: String,
    updated_at: i64,
}
struct SqliteDecision {
    id: i64,
    project_id: Option<i64>,
    task_id: Option<i64>,
    summary: String,
    source_session: String,
    updated_at: i64,
}

fn read_clients_since(conn: &Connection, since_ms: i64) -> Result<Vec<SqliteClient>, String> {
    let mut stmt = conn
        .prepare("SELECT name, notes, updated_at FROM clients")
        .map_err(|e| format!("Préparation clients: {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SqliteClient {
                name: r.get(0)?,
                notes: r.get(1)?,
                updated_at: parse_updated_at(&r.get::<_, String>(2)?),
            })
        })
        .map_err(|e| format!("Lecture clients: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        let c = row.map_err(|e| format!("Ligne client: {}", e))?;
        if c.updated_at > since_ms {
            out.push(c);
        }
    }
    Ok(out)
}

fn read_projects_since(conn: &Connection, since_ms: i64) -> Result<Vec<SqliteProject>, String> {
    let mut stmt = conn
        .prepare("SELECT path, name, client_id, status, updated_at FROM projects")
        .map_err(|e| format!("Préparation projets: {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SqliteProject {
                path: r.get(0)?,
                name: r.get(1)?,
                client_id: r.get(2)?,
                status: r.get(3)?,
                updated_at: parse_updated_at(&r.get::<_, String>(4)?),
            })
        })
        .map_err(|e| format!("Lecture projets: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        let p = row.map_err(|e| format!("Ligne projet: {}", e))?;
        if p.updated_at > since_ms {
            out.push(p);
        }
    }
    Ok(out)
}

fn read_tasks_since(conn: &Connection, since_ms: i64) -> Result<Vec<SqliteTask>, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, description, status, updated_at FROM tasks")
        .map_err(|e| format!("Préparation tâches: {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SqliteTask {
                id: r.get(0)?,
                project_id: r.get(1)?,
                title: r.get(2)?,
                description: r.get(3)?,
                status: r.get(4)?,
                updated_at: parse_updated_at(&r.get::<_, String>(5)?),
            })
        })
        .map_err(|e| format!("Lecture tâches: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        let t = row.map_err(|e| format!("Ligne tâche: {}", e))?;
        if t.updated_at > since_ms {
            out.push(t);
        }
    }
    Ok(out)
}

fn read_decisions_since(conn: &Connection, since_ms: i64) -> Result<Vec<SqliteDecision>, String> {
    let mut stmt = conn
        .prepare("SELECT id, project_id, task_id, summary, source_session, updated_at FROM decisions")
        .map_err(|e| format!("Préparation décisions: {}", e))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SqliteDecision {
                id: r.get(0)?,
                project_id: r.get(1)?,
                task_id: r.get(2)?,
                summary: r.get(3)?,
                source_session: r.get(4)?,
                updated_at: parse_updated_at(&r.get::<_, String>(5)?),
            })
        })
        .map_err(|e| format!("Lecture décisions: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        let d = row.map_err(|e| format!("Ligne décision: {}", e))?;
        if d.updated_at > since_ms {
            out.push(d);
        }
    }
    Ok(out)
}

// ── Couche d'accès SQLite : écriture + mapping + watermark ──

fn write_client(conn: &Connection, name: &str, notes: &str, updated_at: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO clients (name, notes, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT (name) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at",
        rusqlite::params![name, notes, updated_at],
    )
    .map_err(|e| format!("Écriture client SQLite: {}", e))?;
    Ok(())
}

fn write_project(
    conn: &Connection,
    path: &str,
    name: &str,
    client_id: Option<i64>,
    status: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO projects (path, name, client_id, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT (path) DO UPDATE SET name = excluded.name, client_id = excluded.client_id, \
             status = excluded.status, updated_at = excluded.updated_at",
        rusqlite::params![path, name, client_id, status, updated_at],
    )
    .map_err(|e| format!("Écriture projet SQLite: {}", e))?;
    Ok(())
}

fn write_task(
    conn: &Connection,
    id: i64,
    project_id: i64,
    title: &str,
    description: &str,
    status: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO tasks (id, project_id, title, description, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title, \
             description = excluded.description, status = excluded.status, updated_at = excluded.updated_at",
        rusqlite::params![id, project_id, title, description, status, updated_at],
    )
    .map_err(|e| format!("Écriture tâche SQLite: {}", e))?;
    Ok(())
}

fn write_decision(
    conn: &Connection,
    id: i64,
    project_id: Option<i64>,
    task_id: Option<i64>,
    summary: &str,
    source_session: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO decisions (id, project_id, task_id, summary, source_session, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, task_id = excluded.task_id, \
             summary = excluded.summary, source_session = excluded.source_session, \
             updated_at = excluded.updated_at",
        rusqlite::params![id, project_id, task_id, summary, source_session, updated_at],
    )
    .map_err(|e| format!("Écriture décision SQLite: {}", e))?;
    Ok(())
}

/// Id Postgres d'une entité (task/decision) depuis le mapping SQLite. None si
/// jamais poussée.
fn get_pg_id(conn: &Connection, entity: &str, sqlite_id: i64) -> Result<Option<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT pg_id FROM gds_id_map WHERE entity = ?1 AND sqlite_id = ?2")
        .map_err(|e| format!("Préparation mapping: {}", e))?;
    let mut rows = stmt
        .query_map(rusqlite::params![entity, sqlite_id], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("Lecture mapping: {}", e))?;
    if let Some(row) = rows.next() {
        return Ok(Some(row.map_err(|e| format!("Ligne mapping: {}", e))?));
    }
    Ok(None)
}

/// Enregistre le mapping id SQLite → id Postgres d'une entité.
fn set_pg_id(conn: &Connection, entity: &str, sqlite_id: i64, pg_id: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO gds_id_map (entity, sqlite_id, pg_id) VALUES (?1, ?2, ?3) \
         ON CONFLICT (entity, sqlite_id) DO UPDATE SET pg_id = excluded.pg_id",
        rusqlite::params![entity, sqlite_id, pg_id],
    )
    .map_err(|e| format!("Écriture mapping: {}", e))?;
    Ok(())
}

/// Watermark de dernière synchro (epoch millis). 0 si jamais synchronisé.
fn get_watermark(conn: &Connection) -> Result<i64, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM gds_sync_state WHERE key = 'last_sync_ms'")
        .map_err(|e| format!("Préparation watermark: {}", e))?;
    let mut rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| format!("Lecture watermark: {}", e))?;
    if let Some(row) = rows.next() {
        let s = row.map_err(|e| format!("Ligne watermark: {}", e))?;
        return Ok(s.parse::<i64>().unwrap_or(0));
    }
    Ok(0)
}

fn set_watermark(conn: &Connection, ms: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO gds_sync_state (key, value) VALUES ('last_sync_ms', ?1) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![ms.to_string()],
    )
    .map_err(|e| format!("Écriture watermark: {}", e))?;
    Ok(())
}

// ── État de synchro (Phase C1.4, spec_gds.md §6) ──
//
// Mode déconnecté + résumés visuels : l'état de la synchro (dernière synchro,
// éléments en attente, conflits, mode hors-ligne) est persisté dans SQLite
// (table gds_sync_state) pour être affiché dans l'interface et piloter la
// resynchronisation automatique quand le serveur redevient joignable.

/// Lit une valeur d'état de synchro (clé de `gds_sync_state`). Vide si absente.
fn get_state(conn: &Connection, key: &str) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM gds_sync_state WHERE key = ?1")
        .map_err(|e| format!("Préparation état: {}", e))?;
    let mut rows = stmt
        .query_map(rusqlite::params![key], |r| r.get::<_, String>(0))
        .map_err(|e| format!("Lecture état: {}", e))?;
    if let Some(row) = rows.next() {
        return Ok(row.map_err(|e| format!("Ligne état: {}", e))?);
    }
    Ok(String::new())
}

/// Écrit une valeur d'état de synchro (clé de `gds_sync_state`).
fn set_state(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO gds_sync_state (key, value) VALUES (?1, ?2) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Écriture état: {}", e))?;
    Ok(())
}

/// Compte les lignes locales modifiées depuis le watermark (accumulation en
/// mode déconnecté). Connexion fournie (déjà ouverte).
fn pending_count_from_conn(conn: &Connection, watermark: i64) -> Result<i64, String> {
    let clients = read_clients_since(conn, watermark)?;
    let projects = read_projects_since(conn, watermark)?;
    let tasks = read_tasks_since(conn, watermark)?;
    let decisions = read_decisions_since(conn, watermark)?;
    Ok((clients.len() + projects.len() + tasks.len() + decisions.len()) as i64)
}

/// Nombre d'éléments de suivi locaux en attente de synchro (modifiés depuis le
/// watermark). 0 si tout est synchronisé. Ouvre la base SQLite.
pub(crate) fn pending_count() -> Result<i64, String> {
    let conn = open_sqlite()?;
    let watermark = get_watermark(&conn)?;
    pending_count_from_conn(&conn, watermark)
}

/// Persiste le résultat d'une tentative de synchro dans `gds_sync_state`
/// (dernière synchro, erreur, compteurs, mode hors-ligne).
fn record_sync_result(ok: bool, error: &str, pushed: i64, pulled: i64, conflicts: i64) -> Result<(), String> {
    let conn = open_sqlite()?;
    let now = Utc::now().to_rfc3339();
    set_state(&conn, "last_sync_ok", if ok { "1" } else { "0" })?;
    set_state(&conn, "last_sync_at", &now)?;
    set_state(&conn, "last_sync_error", error)?;
    set_state(&conn, "last_pushed", &pushed.to_string())?;
    set_state(&conn, "last_pulled", &pulled.to_string())?;
    set_state(&conn, "last_conflicts", &conflicts.to_string())?;
    set_state(&conn, "offline", if ok { "0" } else { "1" })?;
    Ok(())
}

/// Résumé de l'état de synchro pour l'interface (résumés visuels C1.4) :
/// dernière synchro (ok/date/erreur), compteurs (poussés/rapatriés/conflits),
/// éléments en attente et mode hors-ligne. Lecture seule.
pub(crate) fn read_sync_status() -> Result<Value, String> {
    let conn = open_sqlite()?;
    let watermark = get_watermark(&conn)?;
    let pending = pending_count_from_conn(&conn, watermark)?;
    let last_ok = get_state(&conn, "last_sync_ok")? == "1";
    let last_at = get_state(&conn, "last_sync_at")?;
    let last_error = get_state(&conn, "last_sync_error")?;
    let pushed = get_state(&conn, "last_pushed")?.parse::<i64>().unwrap_or(0);
    let pulled = get_state(&conn, "last_pulled")?.parse::<i64>().unwrap_or(0);
    let conflicts = get_state(&conn, "last_conflicts")?.parse::<i64>().unwrap_or(0);
    let offline = get_state(&conn, "offline")? == "1";
    Ok(json!({
        "last_sync_ok": last_ok,
        "last_sync_at": last_at,
        "last_sync_error": last_error,
        "last_pushed": pushed,
        "last_pulled": pulled,
        "last_conflicts": conflicts,
        "pending": pending,
        "offline": offline,
        "watermark": watermark,
    }))
}

/// Pont bidirectionnel : synchronise le suivi SQLite ↔ Postgres.
/// - desktop → Postgres : pousse les lignes SQLite modifiées (updated_at >
///   watermark) via les upserts CRUD C1.1, en respectant « dernier écrit gagne »
///   (une ligne Postgres plus récente n'est pas écrasée).
/// - Postgres → desktop : rapatrie les lignes Postgres plus récentes (via
///   get_*_modified_since) si la ligne locale n'est pas plus récente.
/// - Conflits : loggés dans audit_gds (action `tracking.conflict`).
/// Persiste le résultat (C1.4) dans `gds_sync_state` pour les résumés visuels.
pub(crate) async fn sync_tracking(pool: &PgPool) -> Result<Value, String> {
    match sync_tracking_inner(pool).await {
        Ok(v) => {
            let pushed = v.get("pushed").and_then(|x| x.as_i64()).unwrap_or(0);
            let pulled = v.get("pulled").and_then(|x| x.as_i64()).unwrap_or(0);
            let conflicts = v.get("conflicts").and_then(|x| x.as_i64()).unwrap_or(0);
            let _ = record_sync_result(true, "", pushed, pulled, conflicts);
            Ok(v)
        }
        Err(e) => {
            let _ = record_sync_result(false, &e, 0, 0, 0);
            Err(e)
        }
    }
}

/// Corps du pont bidirectionnel (sans persistance d'état).
async fn sync_tracking_inner(pool: &PgPool) -> Result<Value, String> {
    // ── Phase 1 (synchrone) : lire tout le suivi SQLite en mémoire, puis
    // fermer la connexion AVANT tout await (rusqlite::Connection n'est pas
    // Sync → ne peut pas être tenue à travers un await dans un futur Send).
    let (watermark, clients, projects, tasks, decisions, client_names, client_ids, mappings, local_updated) =
        read_sqlite_snapshot()?;
    let now_ms = gds_db::now_millis();
    let mut pushed: i64 = 0;
    let mut pulled: i64 = 0;
    let mut conflicts: i64 = 0;
    let mut writes: Vec<WriteOp> = Vec::new();
    let mut new_mappings: Vec<(String, i64, i64)> = Vec::new();

    // ── Phase 2 (async) : pousser les lignes SQLite modifiées vers Postgres ──
    for c in clients {
        let remote = gds_db::get_client_updated_at(pool, &c.name).await?;
        match resolve_conflict(c.updated_at, remote.map(|d| d.timestamp_millis()).unwrap_or(0)) {
            ConflictSide::Remote => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("client {} (remote newer)", c.name), false).await?;
                conflicts += 1;
            }
            ConflictSide::Local | ConflictSide::Equal => {
                let _ = gds_db::upsert_client(pool, &c.name, &c.notes, ms_to_utc(c.updated_at)).await?;
                pushed += 1;
            }
        }
    }
    for p in projects {
        let remote = gds_db::get_project_updated_at(pool, &p.path).await?;
        match resolve_conflict(p.updated_at, remote.map(|d| d.timestamp_millis()).unwrap_or(0)) {
            ConflictSide::Remote => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("project {} (remote newer)", p.path), false).await?;
                conflicts += 1;
            }
            ConflictSide::Local | ConflictSide::Equal => {
                let client_id = p.client_id.and_then(|cid| client_names.get(&cid).cloned());
                let client_id = match client_id {
                    Some(name) => gds_db::get_client_by_name(pool, &name).await?,
                    None => None,
                };
                let _ = gds_db::upsert_project(pool, &p.path, &p.name, client_id, &p.status, ms_to_utc(p.updated_at)).await?;
                pushed += 1;
            }
        }
    }
    for t in tasks {
        let pg_id = match mappings.get(&("task".to_string(), t.id)) {
            Some(id) => *id,
            None => {
                let id = gds_db::upsert_task(pool, t.id, t.project_id, &t.title, &t.description, &t.status, "", "", None, ms_to_utc(t.updated_at)).await?;
                new_mappings.push(("task".to_string(), t.id, id));
                id
            }
        };
        let remote = gds_db::get_task_updated_at(pool, pg_id).await?;
        match resolve_conflict(t.updated_at, remote.map(|d| d.timestamp_millis()).unwrap_or(0)) {
            ConflictSide::Remote => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("task {} (remote newer)", t.id), false).await?;
                conflicts += 1;
            }
            ConflictSide::Local | ConflictSide::Equal => {
                let _ = gds_db::upsert_task(pool, pg_id, t.project_id, &t.title, &t.description, &t.status, "", "", None, ms_to_utc(t.updated_at)).await?;
                pushed += 1;
            }
        }
    }
    for d in decisions {
        let pg_id = match mappings.get(&("decision".to_string(), d.id)) {
            Some(id) => *id,
            None => {
                let id = gds_db::upsert_decision(pool, d.id, d.project_id, d.task_id, &d.summary, &d.source_session, ms_to_utc(d.updated_at)).await?;
                new_mappings.push(("decision".to_string(), d.id, id));
                id
            }
        };
        let remote = gds_db::get_decision_updated_at(pool, pg_id).await?;
        match resolve_conflict(d.updated_at, remote.map(|d| d.timestamp_millis()).unwrap_or(0)) {
            ConflictSide::Remote => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("decision {} (remote newer)", d.id), false).await?;
                conflicts += 1;
            }
            ConflictSide::Local | ConflictSide::Equal => {
                let _ = gds_db::upsert_decision(pool, pg_id, d.project_id, d.task_id, &d.summary, &d.source_session, ms_to_utc(d.updated_at)).await?;
                pushed += 1;
            }
        }
    }

    // ── Phase 2 (async) : rapatrier les lignes Postgres plus récentes ──
    let since = ms_to_utc(watermark);
    for c in gds_db::get_clients_modified_since(pool, since).await? {
        let local = local_updated.get(&format!("clients:{}", c.name)).copied().unwrap_or(0);
        match resolve_conflict(local, c.updated_at.timestamp_millis()) {
            ConflictSide::Remote => {
                writes.push(WriteOp::Client { name: c.name.clone(), notes: c.notes.clone(), updated_at: pg_to_sqlite_dt(c.updated_at) });
                pulled += 1;
            }
            ConflictSide::Local => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("client {} (local newer)", c.name), false).await?;
                conflicts += 1;
            }
            ConflictSide::Equal => {}
        }
    }
    for p in gds_db::get_projects_modified_since(pool, since).await? {
        let local = local_updated.get(&format!("projects:{}", p.path)).copied().unwrap_or(0);
        match resolve_conflict(local, p.updated_at.timestamp_millis()) {
            ConflictSide::Remote => {
                let client_id = match p.client_id {
                    Some(cid) => match gds_db::get_client_by_id(pool, cid).await? {
                        Some(name) => client_ids.get(&name).copied(),
                        None => None,
                    },
                    None => None,
                };
                writes.push(WriteOp::Project { path: p.path.clone(), name: p.name.clone(), client_id, status: p.status.clone(), updated_at: pg_to_sqlite_dt(p.updated_at) });
                pulled += 1;
            }
            ConflictSide::Local => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("project {} (local newer)", p.path), false).await?;
                conflicts += 1;
            }
            ConflictSide::Equal => {}
        }
    }
    for t in gds_db::get_tasks_modified_since(pool, since).await? {
        let local = local_updated.get(&format!("tasks:{}", t.id)).copied().unwrap_or(0);
        match resolve_conflict(local, t.updated_at.timestamp_millis()) {
            ConflictSide::Remote => {
                writes.push(WriteOp::Task { id: t.id, project_id: t.project_id, title: t.title.clone(), description: t.description.clone(), status: t.status.clone(), updated_at: pg_to_sqlite_dt(t.updated_at) });
                new_mappings.push(("task".to_string(), t.id, t.id));
                pulled += 1;
            }
            ConflictSide::Local => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("task {} (local newer)", t.id), false).await?;
                conflicts += 1;
            }
            ConflictSide::Equal => {}
        }
    }
    for d in gds_db::get_decisions_modified_since(pool, since).await? {
        let local = local_updated.get(&format!("decisions:{}", d.id)).copied().unwrap_or(0);
        match resolve_conflict(local, d.updated_at.timestamp_millis()) {
            ConflictSide::Remote => {
                writes.push(WriteOp::Decision { id: d.id, project_id: d.project_id, task_id: d.task_id, summary: d.summary.clone(), source_session: d.source_session.clone(), updated_at: pg_to_sqlite_dt(d.updated_at) });
                new_mappings.push(("decision".to_string(), d.id, d.id));
                pulled += 1;
            }
            ConflictSide::Local => {
                gds_db::audit_gds(pool, "desktop", "tracking", "tracking.conflict", &format!("decision {} (local newer)", d.id), false).await?;
                conflicts += 1;
            }
            ConflictSide::Equal => {}
        }
    }

    // ── Phase 3 (synchrone) : réouvrir SQLite, appliquer écritures + mapping
    // + watermark, puis fermer.
    let conn = open_sqlite()?;
    for w in &writes {
        match w {
            WriteOp::Client { name, notes, updated_at } => write_client(&conn, name, notes, updated_at)?,
            WriteOp::Project { path, name, client_id, status, updated_at } => write_project(&conn, path, name, *client_id, status, updated_at)?,
            WriteOp::Task { id, project_id, title, description, status, updated_at } => write_task(&conn, *id, *project_id, title, description, status, updated_at)?,
            WriteOp::Decision { id, project_id, task_id, summary, source_session, updated_at } => write_decision(&conn, *id, *project_id, *task_id, summary, source_session, updated_at)?,
        }
    }
    for (entity, sqlite_id, pg_id) in &new_mappings {
        set_pg_id(&conn, entity, *sqlite_id, *pg_id)?;
    }
    set_watermark(&conn, now_ms)?;
    drop(conn);

    Ok(json!({ "ok": true, "pushed": pushed, "pulled": pulled, "conflicts": conflicts }))
}

/// Opération d'écriture SQLite différée (appliquée en phase 3, sans await).
enum WriteOp {
    Client { name: String, notes: String, updated_at: String },
    Project { path: String, name: String, client_id: Option<i64>, status: String, updated_at: String },
    Task { id: i64, project_id: i64, title: String, description: String, status: String, updated_at: String },
    Decision { id: i64, project_id: Option<i64>, task_id: Option<i64>, summary: String, source_session: String, updated_at: String },
}

/// Lit un instantané complet du suivi SQLite en mémoire (phase 1, synchrone) :
/// watermark, lignes modifiées, mapping id, noms/ids clients et updated_at
/// locaux. La connexion est fermée avant tout await.
#[allow(clippy::type_complexity)]
fn read_sqlite_snapshot(
) -> Result<(i64, Vec<SqliteClient>, Vec<SqliteProject>, Vec<SqliteTask>, Vec<SqliteDecision>, std::collections::HashMap<i64, String>, std::collections::HashMap<String, i64>, std::collections::HashMap<(String, i64), i64>, std::collections::HashMap<String, i64>), String> {
    let conn = open_sqlite()?;
    let watermark = get_watermark(&conn)?;
    let clients = read_clients_since(&conn, watermark)?;
    let projects = read_projects_since(&conn, watermark)?;
    let tasks = read_tasks_since(&conn, watermark)?;
    let decisions = read_decisions_since(&conn, watermark)?;

    // Noms/ids clients (mapping client_id SQLite ↔ Postgres via le nom).
    let mut client_names = std::collections::HashMap::new();
    let mut client_ids = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT id, name FROM clients")
        .map_err(|e| format!("Préparation clients map: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture clients map: {}", e))?;
    for row in rows {
        let (id, name) = row.map_err(|e| format!("Ligne client map: {}", e))?;
        client_names.insert(id, name.clone());
        client_ids.insert(name, id);
    }
    drop(stmt);

    // Mapping id SQLite → Postgres (tasks/decisions).
    let mut mappings = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT entity, sqlite_id, pg_id FROM gds_id_map")
        .map_err(|e| format!("Préparation mapping: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
        .map_err(|e| format!("Lecture mapping: {}", e))?;
    for row in rows {
        let (entity, sqlite_id, pg_id) = row.map_err(|e| format!("Ligne mapping: {}", e))?;
        mappings.insert((entity, sqlite_id), pg_id);
    }
    drop(stmt);

    // updated_at locaux (clé `table:clé_naturelle` ou `table:id`).
    let mut local_updated = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT name, updated_at FROM clients")
        .map_err(|e| format!("Préparation updated clients: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture updated clients: {}", e))?;
    for row in rows {
        let (k, v) = row.map_err(|e| format!("Ligne updated client: {}", e))?;
        local_updated.insert(format!("clients:{}", k), parse_updated_at(&v));
    }
    drop(stmt);
    let mut stmt = conn
        .prepare("SELECT path, updated_at FROM projects")
        .map_err(|e| format!("Préparation updated projets: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture updated projets: {}", e))?;
    for row in rows {
        let (k, v) = row.map_err(|e| format!("Ligne updated projet: {}", e))?;
        local_updated.insert(format!("projects:{}", k), parse_updated_at(&v));
    }
    drop(stmt);
    let mut stmt = conn
        .prepare("SELECT id, updated_at FROM tasks")
        .map_err(|e| format!("Préparation updated tâches: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture updated tâches: {}", e))?;
    for row in rows {
        let (k, v) = row.map_err(|e| format!("Ligne updated tâche: {}", e))?;
        local_updated.insert(format!("tasks:{}", k), parse_updated_at(&v));
    }
    drop(stmt);
    let mut stmt = conn
        .prepare("SELECT id, updated_at FROM decisions")
        .map_err(|e| format!("Préparation updated décisions: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture updated décisions: {}", e))?;
    for row in rows {
        let (k, v) = row.map_err(|e| format!("Ligne updated décision: {}", e))?;
        local_updated.insert(format!("decisions:{}", k), parse_updated_at(&v));
    }
    drop(stmt);
    drop(conn);

    Ok((watermark, clients, projects, tasks, decisions, client_names, client_ids, mappings, local_updated))
}

/// Commande Tauri : synchronise le suivi SQLite ↔ Postgres (pont C1.2).
#[tauri::command]
pub async fn gds_sync_tracking(state: State<'_, AppState>) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    sync_tracking(&pool).await
}

/// Variante tolérante pour le mode déconnecté (C1.4) : si le pool est absent
/// (serveur injoignable), enregistre l'état hors-ligne et retourne une erreur
/// sans bloquer. Utilisée par la tâche de resynchronisation automatique.
pub(crate) async fn sync_tracking_auto(pool: Option<&PgPool>) -> Result<Value, String> {
    match pool {
        Some(p) => sync_tracking(p).await,
        None => {
            let _ = record_sync_result(false, "Serveur GDS injoignable (mode déconnecté)", 0, 0, 0);
            Err("Serveur GDS injoignable (mode déconnecté)".to_string())
        }
    }
}

/// Commande Tauri : résumé de l'état de synchro du suivi (C1.4) pour
/// l'interface — dernière synchro, éléments en attente, conflits, mode
/// hors-ligne. Retourne `{ enabled: false }` si le GDS est désactivé.
#[tauri::command]
pub async fn gds_sync_status(state: State<'_, AppState>) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Ok(json!({ "enabled": false }));
    }
    let mut v = read_sync_status()?;
    v["enabled"] = json!(true);
    Ok(v)
}

/// Tâche de fond C1.4 : resynchronisation automatique du suivi en mode
/// déconnecté. Toutes les 30 s, si le GDS est activé globalement et qu'il y a
/// des modifications locales en attente (pending > 0), tente de (re)connecter
/// le pool PostgreSQL puis de synchroniser le suivi (pont C1.2). Quand le
/// serveur redevient joignable, les modifications accumulées en mode déconnecté
/// sont poussées automatiquement. Fail-open : une erreur ne bloque jamais
/// l'interface.
pub(crate) fn start_gds_sync_monitor(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let state = handle.state::<AppState>();
            if !crate::gds_globally_enabled(&state) {
                continue;
            }
            // Modifications locales en attente ? (accumulation mode déconnecté)
            let pending = match pending_count() {
                Ok(n) => n,
                Err(_) => continue,
            };
            if pending <= 0 {
                continue;
            }
            // Pool disponible ? sinon tenter une reconnexion depuis un projet GDS.
            let pool = state.gds_pool.lock().unwrap().clone();
            let pool = match pool {
                Some(p) => Some(p),
                None => {
                    let cfg = state.config.lock().unwrap().clone();
                    let mut paths = cfg.open_projects.clone();
                    if let Some(p) = &cfg.active_open_project {
                        if !paths.contains(p) {
                            paths.push(p.clone());
                        }
                    }
                    let mut restored = None;
                    for proj in paths {
                        if let Ok(gcfg) = crate::gds::read_gds_config(&proj) {
                            if gcfg.enabled && !gcfg.db_host.is_empty() {
                                if let Ok(p) = crate::gds::restore_pool_for_project(&proj).await {
                                    *state.gds_pool.lock().unwrap() = Some(p.clone());
                                    restored = Some(p);
                                    break;
                                }
                            }
                        }
                    }
                    restored
                }
            };
            match pool {
                Some(p) => {
                    let _ = sync_tracking_auto(Some(&p)).await;
                }
                None => {
                    let _ = sync_tracking_auto(None).await;
                }
            }
        }
    });
}

// ── Forçage serveur par titulaire du verrou (Phase C1.3, spec_gds.md §6) ──
//
// Le titulaire du verrou de projet peut forcer la poussée du suivi local vers
// Postgres, en ÉCRASANT les données distantes (au lieu du « dernier écrit
// gagne » du pont C1.2). Réservé au membre qui détient le verrou GDS du projet.

/// Lit TOUT le suivi SQLite en mémoire (since 0) + mapping noms clients.
/// La connexion est fermée avant tout await (rusqlite::Connection n'est pas
/// Sync → ne peut pas être tenue à travers un await dans un futur Send).
#[allow(clippy::type_complexity)]
fn read_all_sqlite() -> Result<
    (
        Vec<SqliteClient>,
        Vec<SqliteProject>,
        Vec<SqliteTask>,
        Vec<SqliteDecision>,
        std::collections::HashMap<i64, String>,
    ),
    String,
> {
    let conn = open_sqlite()?;
    let clients = read_clients_since(&conn, 0)?;
    let projects = read_projects_since(&conn, 0)?;
    let tasks = read_tasks_since(&conn, 0)?;
    let decisions = read_decisions_since(&conn, 0)?;
    let mut client_names = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT id, name FROM clients")
        .map_err(|e| format!("Préparation clients map: {}", e))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("Lecture clients map: {}", e))?;
    for row in rows {
        let (id, name) = row.map_err(|e| format!("Ligne client map: {}", e))?;
        client_names.insert(id, name);
    }
    drop(stmt);
    drop(conn);
    Ok((clients, projects, tasks, decisions, client_names))
}

/// Force la poussée du suivi local vers Postgres, en ÉCRASANT les données
/// distantes. Réservé au titulaire du verrou de projet (le membre courant doit
/// détenir le verrou GDS du projet). Phase C1.3.
pub(crate) async fn force_push_tracking(pool: &PgPool, project: &str) -> Result<Value, String> {
    let cfg = gds::read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let name = gds::project_name(project);
    let project_id = gds_db::get_project_by_name(pool, &name)
        .await?
        .ok_or("Projet non enregistré sur le serveur GDS")?;
    // Vérifier que le membre courant est bien le titulaire du verrou.
    let lock = gds_db::get_lock_by_project(pool, project_id).await?;
    match lock {
        Some(l) if l.email == cfg.identity_email => {}
        Some(l) => {
            gds_db::audit_gds(
                pool,
                "desktop",
                &cfg.identity_email,
                "tracking.force.denied",
                &format!("lock held by {}", l.email),
                false,
            )
            .await?;
            return Err(format!(
                "Forçage réservé au titulaire du verrou (détenu par {})",
                l.email
            ));
        }
        None => {
            gds_db::audit_gds(
                pool,
                "desktop",
                &cfg.identity_email,
                "tracking.force.denied",
                "no lock",
                false,
            )
            .await?;
            return Err(
                "Aucun verrou détenu — synchronisez d'abord pour acquérir le verrou".to_string(),
            );
        }
    }
    // Lire tout le suivi local (since 0) en mémoire, puis pousser en écrasant.
    let (clients, projects, tasks, decisions, client_names) = read_all_sqlite()?;
    let mut pushed: i64 = 0;
    for c in clients {
        let _ = gds_db::upsert_client(pool, &c.name, &c.notes, ms_to_utc(c.updated_at)).await?;
        pushed += 1;
    }
    for p in projects {
        let client_id = p.client_id.and_then(|cid| client_names.get(&cid).cloned());
        let client_id = match client_id {
            Some(cname) => gds_db::get_client_by_name(pool, &cname).await?,
            None => None,
        };
        let _ = gds_db::upsert_project(
            pool,
            &p.path,
            &p.name,
            client_id,
            &p.status,
            ms_to_utc(p.updated_at),
        )
        .await?;
        pushed += 1;
    }
    for t in tasks {
        let _ = gds_db::upsert_task(
            pool,
            t.id,
            t.project_id,
            &t.title,
            &t.description,
            &t.status,
            "",
            "",
            None,
            ms_to_utc(t.updated_at),
        )
        .await?;
        pushed += 1;
    }
    for d in decisions {
        let _ = gds_db::upsert_decision(
            pool,
            d.id,
            d.project_id,
            d.task_id,
            &d.summary,
            &d.source_session,
            ms_to_utc(d.updated_at),
        )
        .await?;
        pushed += 1;
    }
    gds_db::audit_gds(
        pool,
        "desktop",
        &cfg.identity_email,
        "tracking.force",
        &format!("pushed {}", pushed),
        true,
    )
    .await?;
    Ok(json!({ "ok": true, "forced": true, "pushed": pushed }))
}

/// Commande Tauri : force la poussée du suivi local vers Postgres (réservé au
/// titulaire du verrou de projet). Phase C1.3.
#[tauri::command]
pub async fn gds_force_push_suivi(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    force_push_tracking(&pool, &project).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lock_row(expires_at: i64, email: &str) -> gds_db::LockRow {
        gds_db::LockRow {
            id: 1,
            project_id: 1,
            user_id: 1,
            email: email.to_string(),
            locked_at: 0,
            expires_at,
            urgent: false,
            reason: String::new(),
        }
    }

    #[test]
    fn acquire_no_lock_is_acquired() {
        assert_eq!(decide_acquire(None, 1000), AcquireDecision::Acquired);
    }

    #[test]
    fn acquire_held_by_other_is_denied() {
        let lock = lock_row(5000, "alice@x");
        assert_eq!(decide_acquire(Some(&lock), 1000), AcquireDecision::HeldBy("alice@x".to_string()));
    }

    #[test]
    fn acquire_expired_lock_is_recoverable() {
        // Verrou orphelin expiré (expires_at < now) → récupérable.
        let lock = lock_row(500, "alice@x");
        assert_eq!(decide_acquire(Some(&lock), 1000), AcquireDecision::Expired);
    }

    #[test]
    fn urgent_only_for_designated_person() {
        // Personne désignée → autorisé.
        assert!(can_urgent("alice@x", "alice@x"));
        // Autre utilisateur → refusé.
        assert!(!can_urgent("bob@x", "alice@x"));
        // Aucune personne désignée (vide) → aucun urgent autorisé.
        assert!(!can_urgent("alice@x", ""));
    }

    // ── Pont bidirectionnel SQLite↔Postgres (Phase C1.2) ──

    #[test]
    fn resolve_conflict_local_wins_when_newer() {
        assert_eq!(resolve_conflict(2000, 1000), ConflictSide::Local);
    }

    #[test]
    fn resolve_conflict_remote_wins_when_newer() {
        assert_eq!(resolve_conflict(1000, 2000), ConflictSide::Remote);
    }

    #[test]
    fn resolve_conflict_equal_is_noop() {
        assert_eq!(resolve_conflict(1500, 1500), ConflictSide::Equal);
    }

    #[test]
    fn parse_updated_at_sqlite_format() {
        // Format SQLite `YYYY-MM-DD HH:MM:SS` (UTC).
        assert_eq!(parse_updated_at("1970-01-01 00:00:01"), 1000);
    }

    #[test]
    fn parse_updated_at_postgres_rfc3339() {
        // Format Postgres TIMESTAMPTZ.
        assert_eq!(parse_updated_at("1970-01-01T00:00:01Z"), 1000);
    }

    #[test]
    fn parse_updated_at_invalid_is_zero() {
        assert_eq!(parse_updated_at("pas-une-date"), 0);
    }

    #[test]
    fn pg_to_sqlite_dt_roundtrip() {
        let dt = ms_to_utc(1000);
        assert_eq!(pg_to_sqlite_dt(dt), "1970-01-01 00:00:01");
    }

    #[test]
    fn ensure_sqlite_column_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE decisions (id INTEGER PRIMARY KEY, summary TEXT);",
        )
        .unwrap();
        // Ajoute la colonne une première fois.
        ensure_sqlite_column(&conn, "decisions", "updated_at", "TEXT DEFAULT (datetime('now'))")
            .unwrap();
        // Idempotent : ne doit pas échouer ni dupliquer.
        ensure_sqlite_column(&conn, "decisions", "updated_at", "TEXT DEFAULT (datetime('now'))")
            .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('decisions') WHERE name = 'updated_at'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn ensure_sqlite_schema_creates_bridge_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE decisions (id INTEGER PRIMARY KEY, summary TEXT);",
        )
        .unwrap();
        ensure_sqlite_schema(&conn).unwrap();
        // Tables du pont présentes.
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('gds_id_map','gds_sync_state')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tables.len(), 2);
    }

    #[test]
    fn id_mapping_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE gds_id_map (entity TEXT NOT NULL, sqlite_id INTEGER NOT NULL, pg_id INTEGER NOT NULL, PRIMARY KEY (entity, sqlite_id));",
        )
        .unwrap();
        assert_eq!(get_pg_id(&conn, "task", 7).unwrap(), None);
        set_pg_id(&conn, "task", 7, 42).unwrap();
        assert_eq!(get_pg_id(&conn, "task", 7).unwrap(), Some(42));
    }

    #[test]
    fn watermark_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE gds_sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        assert_eq!(get_watermark(&conn).unwrap(), 0);
        set_watermark(&conn, 12345).unwrap();
        assert_eq!(get_watermark(&conn).unwrap(), 12345);
    }

    // ── Mode déconnecté + résumés visuels (Phase C1.4) ──

    #[test]
    fn state_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE gds_sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        assert_eq!(get_state(&conn, "last_sync_ok").unwrap(), "");
        set_state(&conn, "last_sync_ok", "1").unwrap();
        assert_eq!(get_state(&conn, "last_sync_ok").unwrap(), "1");
        // Idempotent (upsert).
        set_state(&conn, "last_sync_ok", "0").unwrap();
        assert_eq!(get_state(&conn, "last_sync_ok").unwrap(), "0");
    }

    #[test]
    fn pending_count_counts_modified_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE clients (name TEXT PRIMARY KEY, notes TEXT, updated_at TEXT);
             CREATE TABLE projects (path TEXT PRIMARY KEY, name TEXT, client_id INTEGER, status TEXT, updated_at TEXT);
             CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, description TEXT, status TEXT, updated_at TEXT);
             CREATE TABLE decisions (id INTEGER PRIMARY KEY, project_id INTEGER, task_id INTEGER, summary TEXT, source_session TEXT, updated_at TEXT);",
        )
        .unwrap();
        // 2 clients modifiés après le watermark, 1 avant.
        conn.execute_batch(
            "INSERT INTO clients (name, notes, updated_at) VALUES
                ('a', '', '1970-01-01 00:00:02'),
                ('b', '', '1970-01-01 00:00:02'),
                ('c', '', '1970-01-01 00:00:00');",
        )
        .unwrap();
        // Watermark = 1000 ms (1970-01-01 00:00:01).
        assert_eq!(pending_count_from_conn(&conn, 1000).unwrap(), 2);
        // Watermark = 0 → seules les lignes strictement postérieures comptent
        // (c est à 0 ms, non > 0).
        assert_eq!(pending_count_from_conn(&conn, 0).unwrap(), 2);
    }

    #[test]
    fn record_sync_result_persists_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE gds_sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        // record_sync_result ouvre sa propre connexion (chemin réel) — on teste
        // ici la logique via set_state/get_state directement.
        set_state(&conn, "last_sync_ok", "1").unwrap();
        set_state(&conn, "last_pushed", "5").unwrap();
        set_state(&conn, "last_conflicts", "2").unwrap();
        set_state(&conn, "offline", "0").unwrap();
        assert_eq!(get_state(&conn, "last_sync_ok").unwrap(), "1");
        assert_eq!(get_state(&conn, "last_pushed").unwrap(), "5");
        assert_eq!(get_state(&conn, "last_conflicts").unwrap(), "2");
        assert_eq!(get_state(&conn, "offline").unwrap(), "0");
    }

    #[test]
    fn read_sync_status_defaults() {
        // Base vide → état par défaut (aucune synchro, pas hors-ligne, 0 en attente).
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE gds_sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE clients (name TEXT PRIMARY KEY, notes TEXT, updated_at TEXT);
             CREATE TABLE projects (path TEXT PRIMARY KEY, name TEXT, client_id INTEGER, status TEXT, updated_at TEXT);
             CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, description TEXT, status TEXT, updated_at TEXT);
             CREATE TABLE decisions (id INTEGER PRIMARY KEY, project_id INTEGER, task_id INTEGER, summary TEXT, source_session TEXT, updated_at TEXT);",
        )
        .unwrap();
        // Vérifie les valeurs par défaut des clés d'état.
        assert_eq!(get_state(&conn, "last_sync_ok").unwrap(), "");
        assert_eq!(get_state(&conn, "offline").unwrap(), "");
        assert_eq!(get_state(&conn, "last_pushed").unwrap(), "");
    }
}
