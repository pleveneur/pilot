// gds_db.rs — Accès PostgreSQL du GDS (spec_gds.md §2)
//
// Pool sqlx async (tokio) construit depuis une adresse locale OU distante
// (IP publique / URL). `provision` crée la base `pilot_gds` + un utilisateur
// dédié (pas `postgres` superuser), de façon idempotente. `migrate` applique
// les migrations embarquées (`migrations/`). Helpers CRUD users/projects/
// git_repos.
//
// Règles : jamais de `.await` en tenant un Mutex std ; secrets hors code
// (env/.env) — les mots de passe sont passés en paramètre, jamais codés.

use chrono::{DateTime, Utc};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::time::Duration;

/// Nom de la base applicative GDS.
pub(crate) const GDS_DB_NAME: &str = "pilot_gds";

/// Construit un pool sqlx depuis une adresse de connexion PostgreSQL
/// (locale : `localhost`/socket, ou distante : IP publique / URL).
pub(crate) async fn connect(addr: &str) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect(addr)
        .await
        .map_err(|e| format!("Connexion PostgreSQL: {}", e))
}

/// Provisionne la base GDS : crée `db_name` + l'utilisateur dédié (idempotent).
/// `admin_url` = URL d'un compte superuser (ex: postgres://postgres:pass@host:5432/postgres).
/// Le mot de passe de l'utilisateur dédié est passé en paramètre (jamais codé).
pub(crate) async fn provision(
    admin_url: &str,
    db_name: &str,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let admin = connect(admin_url).await?;
    // Base : CREATE DATABASE ne peut pas être paramétré ni transactionnel.
    let db_exists: bool = sqlx::query("SELECT 1 FROM pg_database WHERE datname = $1")
        .bind(db_name)
        .fetch_optional(&admin)
        .await
        .map_err(|e| format!("Vérif base: {}", e))?
        .is_some();
    if !db_exists {
        let sql = format!("CREATE DATABASE \"{}\"", db_name);
        sqlx::query(&sql)
            .execute(&admin)
            .await
            .map_err(|e| format!("Création base: {}", e))?;
    }
    // Utilisateur dédié (droits limités au schéma applicatif).
    let user_exists: bool = sqlx::query("SELECT 1 FROM pg_roles WHERE rolname = $1")
        .bind(user)
        .fetch_optional(&admin)
        .await
        .map_err(|e| format!("Vérif user: {}", e))?
        .is_some();
    if !user_exists {
        let pwd = password.replace('\'', "''");
        let sql = format!("CREATE USER \"{}\" WITH PASSWORD '{}'", user, pwd);
        sqlx::query(&sql)
            .execute(&admin)
            .await
            .map_err(|e| format!("Création user: {}", e))?;
    }
    // Droits sur la base.
    let sql = format!("GRANT ALL PRIVILEGES ON DATABASE \"{}\" TO \"{}\"", db_name, user);
    sqlx::query(&sql)
        .execute(&admin)
        .await
        .map_err(|e| format!("Grant: {}", e))?;
    Ok(())
}

/// Applique les migrations embarquées (`migrations/0001_init.sql`).
pub(crate) async fn migrate(pool: &PgPool) -> Result<(), String> {
    sqlx::migrate!()
        .run(pool)
        .await
        .map_err(|e| format!("Migration GDS: {}", e))
}

/// Construit l'URL applicative depuis l'URL admin (même hôte/port, base + user
/// dédiés). `postgres://user:pass@host:port/db` → `postgres://<user>:<pwd>@<host:port>/<db>`.
pub(crate) fn app_url_from_admin(
    admin_url: &str,
    db_name: &str,
    user: &str,
    password: &str,
) -> Result<String, String> {
    let at = admin_url.rfind('@').ok_or("URL admin invalide (pas de @)")?;
    let host_part = &admin_url[at + 1..];
    let host = host_part.split('/').next().unwrap_or(host_part);
    Ok(format!("postgres://{}:{}@{}/{}", user, password, host, db_name))
}

// ── Helpers CRUD ──

/// Ligne utilisateur (lecture).
#[derive(Debug, Clone)]
pub(crate) struct UserRow {
    pub id: i64,
    pub email: String,
    #[allow(dead_code)]
    pub name: String,
    pub password_hash: String,
    pub role: String,
    pub status: String,
}

/// Crée un utilisateur, retourne son id.
pub(crate) async fn create_user(
    pool: &PgPool,
    email: &str,
    name: &str,
    password_hash: &str,
    role: &str,
    status: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO users (email, name, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(email)
    .bind(name)
    .bind(password_hash)
    .bind(role)
    .bind(status)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création user: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne un utilisateur par email (None si absent).
pub(crate) async fn get_user_by_email(pool: &PgPool, email: &str) -> Result<Option<UserRow>, String> {
    let row = sqlx::query(
        "SELECT id, email, name, password_hash, role, status FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture user: {}", e))?;
    Ok(row.map(|r| UserRow {
        id: r.get::<i64, _>("id"),
        email: r.get::<String, _>("email"),
        name: r.get::<String, _>("name"),
        password_hash: r.get::<String, _>("password_hash"),
        role: r.get::<String, _>("role"),
        status: r.get::<String, _>("status"),
    }))
}

/// Passe un utilisateur à `status` (ex: 'active' après validation superadmin).
pub(crate) async fn set_user_status(pool: &PgPool, email: &str, status: &str) -> Result<(), String> {
    sqlx::query("UPDATE users SET status = $1, updated_at = now() WHERE email = $2")
        .bind(status)
        .bind(email)
        .execute(pool)
        .await
        .map_err(|e| format!("Mise à jour user: {}", e))?;
    Ok(())
}

/// Retourne l'id d'un projet par nom (None si absent).
pub(crate) async fn get_project_by_name(pool: &PgPool, name: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM projects WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture projet: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Crée un projet, retourne son id.
pub(crate) async fn create_project(
    pool: &PgPool,
    name: &str,
    repo_name: &str,
    repo_url: &str,
    path_on_server: &str,
    status: &str,
    description: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO projects (name, repo_name, repo_url, path_on_server, status, description) \
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(name)
    .bind(repo_name)
    .bind(repo_url)
    .bind(path_on_server)
    .bind(status)
    .bind(description)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création projet: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne l'id d'un dépôt git par projet (None si absent).
pub(crate) async fn get_git_repo_by_project(pool: &PgPool, project_id: i64) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM git_repos WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture git_repo: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Enregistre un dépôt git (bare) pour un projet.
pub(crate) async fn create_git_repo(
    pool: &PgPool,
    project_id: i64,
    path_on_server: &str,
    bare_path: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO git_repos (project_id, path_on_server, bare_path) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(project_id)
    .bind(path_on_server)
    .bind(bare_path)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création git_repo: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Associe un utilisateur à un projet (project_members).
pub(crate) async fn create_project_member(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
    role: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (project_id, user_id) DO NOTHING",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .map_err(|e| format!("Association membre: {}", e))?;
    Ok(())
}

/// Liste les projets (id, name, repo_name, repo_url, path_on_server, status).
pub(crate) async fn list_projects(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, name, repo_name, repo_url, path_on_server, status, description FROM projects ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste projets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "name": r.get::<String, _>("name"),
                "repo_name": r.get::<String, _>("repo_name"),
                "repo_url": r.get::<String, _>("repo_url"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "status": r.get::<String, _>("status"),
                "description": r.get::<String, _>("description"),
            })
        })
        .collect())
}

/// Liste les dépôts git (id, project_id, path_on_server, bare_path, name,
/// email). Jointe la table `projects` pour remonter le nom LISIBLE du projet
/// (affiché dans la modale « Ajouter un projet depuis le GDS ») et l'email
/// d'identité de son membre (réutilisé par gds_clone_repo / gds_add_project).
/// Les champs initiaux (id, project_id, path_on_server, bare_path) sont
/// conservés ADDITIF pour ne pas casser le rendu existant de `src/js/gds.js`.
pub(crate) async fn list_git_repos(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT g.id, g.project_id, g.path_on_server, g.bare_path, p.name, \
            (SELECT u.email FROM project_members pm \
               JOIN users u ON u.id = pm.user_id \
              WHERE pm.project_id = g.project_id \
              ORDER BY pm.id LIMIT 1) AS email \
         FROM git_repos g \
         JOIN projects p ON p.id = g.project_id \
         ORDER BY g.id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste git_repos: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            let email: Option<String> = r.get("email");
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "project_id": r.get::<i64, _>("project_id"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "bare_path": r.get::<String, _>("bare_path"),
                "name": r.get::<String, _>("name"),
                "email": email.unwrap_or_default(),
            })
        })
        .collect())
}

/// Supprime un projet GDS par nom (Évolution 2). Les dépendances
/// (git_repos, project_members, project_locks, tasks, decisions, tickets) sont
/// purgées en cascade (tables au `ON DELETE CASCADE`). On cible uniquement le
/// projet GDS (path IS NULL) pour ne jamais toucher aux projets de suivi.
/// Retourne le nombre de lignes supprimées (0 si absent).
pub(crate) async fn delete_project_by_name(pool: &PgPool, name: &str) -> Result<u64, String> {
    if name.trim().is_empty() {
        return Err("Nom de projet vide".to_string());
    }
    let res = sqlx::query("DELETE FROM projects WHERE name = $1 AND path IS NULL")
        .bind(name)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression projet GDS: {}", e))?;
    Ok(res.rows_affected())
}

// ── Verrous de projet (Phase B, spec_gds.md §5) ──
// UN verrou global par projet (project_id UNIQUE). TTL/lease via expires_at
// (epoch millis) pour récupérer les verrous orphelins. Mode urgent (urgent BOOL)
// pour passer outre un verrou (réservé à la personne désignée).

/// Ligne de verrou de projet (lecture).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct LockRow {
    pub id: i64,
    pub project_id: i64,
    pub user_id: i64,
    pub email: String,
    pub locked_at: i64,
    pub expires_at: i64,
    pub urgent: bool,
    pub reason: String,
}

/// Instant courant en epoch millis (partagé par les verrous).
pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Acquiert un verrou exclusif sur un projet (UN par projet). Retourne
/// `Ok(true)` si acquis, `Ok(false)` si déjà verrouillé (ON CONFLICT DO NOTHING
/// sur project_id UNIQUE).
pub(crate) async fn acquire_lock(
    pool: &PgPool,
    project_id: i64,
    user_id: i64,
    email: &str,
    ttl_secs: i64,
    urgent: bool,
    reason: &str,
) -> Result<bool, String> {
    let now = now_millis();
    let expires = now + ttl_secs * 1000;
    let res = sqlx::query(
        "INSERT INTO project_locks (project_id, user_id, email, locked_at, expires_at, urgent, reason, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (project_id) DO NOTHING",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(email)
    .bind(now)
    .bind(expires)
    .bind(urgent)
    .bind(reason)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("Acquisition verrou: {}", e))?;
    Ok(res.rows_affected() > 0)
}

/// Retourne le verrou d'un projet (None si absent).
pub(crate) async fn get_lock_by_project(pool: &PgPool, project_id: i64) -> Result<Option<LockRow>, String> {
    let row = sqlx::query(
        "SELECT id, project_id, user_id, email, locked_at, expires_at, urgent, reason \
         FROM project_locks WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture verrou: {}", e))?;
    Ok(row.map(|r| LockRow {
        id: r.get::<i64, _>("id"),
        project_id: r.get::<i64, _>("project_id"),
        user_id: r.get::<i64, _>("user_id"),
        email: r.get::<String, _>("email"),
        locked_at: r.get::<i64, _>("locked_at"),
        expires_at: r.get::<i64, _>("expires_at"),
        urgent: r.get::<bool, _>("urgent"),
        reason: r.get::<String, _>("reason"),
    }))
}

/// Liste tous les verrous.
pub(crate) async fn list_locks(pool: &PgPool) -> Result<Vec<LockRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, user_id, email, locked_at, expires_at, urgent, reason \
         FROM project_locks ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste verrous: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| LockRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<i64, _>("project_id"),
            user_id: r.get::<i64, _>("user_id"),
            email: r.get::<String, _>("email"),
            locked_at: r.get::<i64, _>("locked_at"),
            expires_at: r.get::<i64, _>("expires_at"),
            urgent: r.get::<bool, _>("urgent"),
            reason: r.get::<String, _>("reason"),
        })
        .collect())
}

/// Relâche le verrou d'un projet (suppression).
pub(crate) async fn release_lock(pool: &PgPool, project_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM project_locks WHERE project_id = $1")
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Relâchement verrou: {}", e))?;
    Ok(())
}

/// Renouvelle le TTL d'un verrou (lease). API CRUD — renouvellement périodique
/// branché plus tard (boucle de lease).
#[allow(dead_code)]
pub(crate) async fn renew_lock(pool: &PgPool, project_id: i64, ttl_secs: i64) -> Result<(), String> {
    let expires = now_millis() + ttl_secs * 1000;
    sqlx::query("UPDATE project_locks SET expires_at = $1 WHERE project_id = $2")
        .bind(expires)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Renouvellement verrou: {}", e))?;
    Ok(())
}

/// Supprime les verrous expirés (TTL) — récupération des verrous orphelins.
/// Retourne le nombre de verrous expirés supprimés.
pub(crate) async fn expire_stale_locks(pool: &PgPool) -> Result<u64, String> {
    let now = now_millis();
    let res = sqlx::query("DELETE FROM project_locks WHERE expires_at < $1")
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| format!("Expiration verrous: {}", e))?;
    Ok(res.rows_affected())
}

// ── Clefs SSH serveur (Phase A3, spec_gds.md §4) ──
// Clefs publiques des devs, associées à un utilisateur (email) de la base.
// public_key UNIQUE (une clef = un dev).

/// Enregistre une clef publique pour un utilisateur (idempotent : ON CONFLICT
/// DO NOTHING sur public_key UNIQUE). Retourne l'id de la clef (0 si déjà
/// présente).
pub(crate) async fn create_ssh_key(pool: &PgPool, user_id: i64, public_key: &str) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO ssh_keys (user_id, public_key) VALUES ($1, $2) \
         ON CONFLICT (public_key) DO NOTHING RETURNING id",
    )
    .bind(user_id)
    .bind(public_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Création clef SSH: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")).unwrap_or(0))
}

/// Retourne les clefs publiques d'un utilisateur (par id).
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub(crate) async fn get_ssh_keys_by_user(pool: &PgPool, user_id: i64) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT public_key FROM ssh_keys WHERE user_id = $1 ORDER BY id")
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Lecture clefs SSH: {}", e))?;
    Ok(rows.iter().map(|r| r.get::<String, _>("public_key")).collect())
}

/// Retourne l'id d'une clef publique exacte (None si absente).
pub(crate) async fn get_ssh_key_by_key(pool: &PgPool, public_key: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM ssh_keys WHERE public_key = $1")
        .bind(public_key)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture clef SSH: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Retourne l'id d'une clef publique par empreinte SHA256 (None si absente).
/// L'empreinte est calculée sur la partie base64 de la clef (même convention
/// que `ssh-keygen -lf`).
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub(crate) async fn get_ssh_key_by_fingerprint(pool: &PgPool, fingerprint: &str) -> Result<Option<i64>, String> {
    let rows = sqlx::query("SELECT id, public_key FROM ssh_keys")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Lecture clefs SSH: {}", e))?;
    for r in rows {
        let key: String = r.get("public_key");
        if crate::gds_ssh::public_key_fingerprint(&key) == fingerprint {
            return Ok(Some(r.get::<i64, _>("id")));
        }
    }
    Ok(None)
}

/// Supprime une clef publique par id.
#[allow(dead_code)] // API CRUD clefs SSH (Phase A3) — exposée pour l'UI/API.
pub(crate) async fn delete_ssh_key(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM ssh_keys WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression clef SSH: {}", e))?;
    Ok(())
}

/// Journalise une action GDS dans `audit_gds` (Phase B : verrous, sync).
pub(crate) async fn audit_gds(
    pool: &PgPool,
    ip: &str,
    subject: &str,
    action: &str,
    detail: &str,
    ok: bool,
) -> Result<(), String> {
    sqlx::query("INSERT INTO audit_gds (ip, subject, action, detail, ok) VALUES ($1, $2, $3, $4, $5)")
        .bind(ip)
        .bind(subject)
        .bind(action)
        .bind(detail)
        .bind(ok)
        .execute(pool)
        .await
        .map_err(|e| format!("Audit GDS: {}", e))?;
    Ok(())
}

// ── Suivi fusionné (Phase C1.1, spec_gds.md §6) ──
// Tables clients/projects/tasks/decisions alignées sur le schéma SQLite du
// super-agent (~/.pilot/super-agent.db). `updated_at` = clé de résolution de
// divergence (Option A : « dernier écrit gagne » + log des conflits, §6.1).
// CRUD par updated_at : upsert, select modifiés depuis une date, delete.
//
// Clés d'upsert :
//  - clients  → name (clé naturelle SQLite, UNIQUE)
//  - projects → path (clé naturelle SQLite, UNIQUE ; la table GDS existante
//    est étendue, les projets git ont path NULL)
//  - tasks / decisions → id (pas de clé naturelle en SQLite ; le pont C1.2
//    maintient la correspondance id SQLite ↔ id Postgres).
//
// API CRUD (Phase C1.1) — branchée par le pont bidirectionnel (C1.2).

/// Ligne client (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct ClientRow {
    pub id: i64,
    pub name: String,
    pub notes: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert un client par `name` (clé naturelle). Retourne l'id.
pub(crate) async fn upsert_client(
    pool: &PgPool,
    name: &str,
    notes: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO clients (name, notes, updated_at) VALUES ($1, $2, $3) \
         ON CONFLICT (name) DO UPDATE SET notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(name)
    .bind(notes)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert client: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les clients modifiés depuis `since` (résolution de divergence).
pub(crate) async fn get_clients_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<ClientRow>, String> {
    let rows = sqlx::query(
        "SELECT id, name, notes, updated_at FROM clients WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture clients modifiés: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ClientRow {
            id: r.get::<i64, _>("id"),
            name: r.get::<String, _>("name"),
            notes: r.get::<String, _>("notes"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime un client par `name`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub(crate) async fn delete_client(pool: &PgPool, name: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM clients WHERE name = $1")
        .bind(name)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression client: {}", e))?;
    Ok(())
}

/// Liste tous les clients (API suivi fusionné, Phase C1.5).
pub(crate) async fn list_clients(pool: &PgPool) -> Result<Vec<ClientRow>, String> {
    let rows = sqlx::query("SELECT id, name, notes, updated_at FROM clients ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Liste clients: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ClientRow {
            id: r.get::<i64, _>("id"),
            name: r.get::<String, _>("name"),
            notes: r.get::<String, _>("notes"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne projet de suivi (path non NULL).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct ProjectRow {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub client_id: Option<i64>,
    pub status: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert un projet de suivi par `path` (clé naturelle). Retourne l'id.
/// `client_id` = id du client (None si non rattaché).
pub(crate) async fn upsert_project(
    pool: &PgPool,
    path: &str,
    name: &str,
    client_id: Option<i64>,
    status: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO projects (path, name, client_id, status, updated_at) VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, client_id = EXCLUDED.client_id, \
             status = EXCLUDED.status, updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(path)
    .bind(name)
    .bind(client_id)
    .bind(status)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert projet: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les projets de suivi (path non NULL) modifiés depuis `since`.
pub(crate) async fn get_projects_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<ProjectRow>, String> {
    let rows = sqlx::query(
        "SELECT id, path, name, client_id, status, updated_at FROM projects \
         WHERE path IS NOT NULL AND updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture projets modifiés: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ProjectRow {
            id: r.get::<i64, _>("id"),
            path: r.get::<String, _>("path"),
            name: r.get::<String, _>("name"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            status: r.get::<String, _>("status"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime un projet de suivi par `path`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub(crate) async fn delete_project(pool: &PgPool, path: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM projects WHERE path = $1")
        .bind(path)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression projet: {}", e))?;
    Ok(())
}

/// Liste tous les projets de suivi (path non NULL) — API suivi fusionné, Phase C1.5.
pub(crate) async fn list_tracking_projects(pool: &PgPool) -> Result<Vec<ProjectRow>, String> {
    let rows = sqlx::query(
        "SELECT id, path, name, client_id, status, updated_at FROM projects \
         WHERE path IS NOT NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste projets suivi: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| ProjectRow {
            id: r.get::<i64, _>("id"),
            path: r.get::<String, _>("path"),
            name: r.get::<String, _>("name"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            status: r.get::<String, _>("status"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne tâche (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct TaskRow {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub deadline: String,
    pub blocker_reason: String,
    pub source_task_id: Option<i64>,
    pub updated_at: DateTime<Utc>,
}

/// Upsert une tâche par `id` (pas de clé naturelle en SQLite). Retourne l'id.
pub(crate) async fn upsert_task(
    pool: &PgPool,
    id: i64,
    project_id: i64,
    title: &str,
    description: &str,
    status: &str,
    deadline: &str,
    blocker_reason: &str,
    source_task_id: Option<i64>,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO tasks (id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, title = EXCLUDED.title, \
             description = EXCLUDED.description, status = EXCLUDED.status, deadline = EXCLUDED.deadline, \
             blocker_reason = EXCLUDED.blocker_reason, source_task_id = EXCLUDED.source_task_id, \
             updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(title)
    .bind(description)
    .bind(status)
    .bind(deadline)
    .bind(blocker_reason)
    .bind(source_task_id)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert tâche: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les tâches modifiées depuis `since`.
pub(crate) async fn get_tasks_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<TaskRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at \
         FROM tasks WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture tâches modifiées: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TaskRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<i64, _>("project_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            deadline: r.get::<String, _>("deadline"),
            blocker_reason: r.get::<String, _>("blocker_reason"),
            source_task_id: r.get::<Option<i64>, _>("source_task_id"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Supprime une tâche par `id`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub(crate) async fn delete_task(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM tasks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression tâche: {}", e))?;
    Ok(())
}

/// Liste toutes les tâches — API suivi fusionné, Phase C1.5.
pub(crate) async fn list_tasks(pool: &PgPool) -> Result<Vec<TaskRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, title, description, status, deadline, blocker_reason, source_task_id, updated_at \
         FROM tasks ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste tâches: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TaskRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<i64, _>("project_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            deadline: r.get::<String, _>("deadline"),
            blocker_reason: r.get::<String, _>("blocker_reason"),
            source_task_id: r.get::<Option<i64>, _>("source_task_id"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// Ligne décision (suivi).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct DecisionRow {
    pub id: i64,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub summary: String,
    pub source_session: String,
    pub updated_at: DateTime<Utc>,
}

/// Upsert une décision par `id` (pas de clé naturelle en SQLite). Retourne l'id.
pub(crate) async fn upsert_decision(
    pool: &PgPool,
    id: i64,
    project_id: Option<i64>,
    task_id: Option<i64>,
    summary: &str,
    source_session: &str,
    updated_at: DateTime<Utc>,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO decisions (id, project_id, task_id, summary, source_session, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, task_id = EXCLUDED.task_id, \
             summary = EXCLUDED.summary, source_session = EXCLUDED.source_session, \
             updated_at = EXCLUDED.updated_at \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(task_id)
    .bind(summary)
    .bind(source_session)
    .bind(updated_at)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Upsert décision: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne les décisions modifiées depuis `since`.
pub(crate) async fn get_decisions_modified_since(
    pool: &PgPool,
    since: DateTime<Utc>,
) -> Result<Vec<DecisionRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, task_id, summary, source_session, updated_at \
         FROM decisions WHERE updated_at > $1 ORDER BY id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture décisions modifiées: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            task_id: r.get::<Option<i64>, _>("task_id"),
            summary: r.get::<String, _>("summary"),
            source_session: r.get::<String, _>("source_session"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

/// `updated_at` d'un client par `name` (None si absent) — résolution de
/// divergence « dernier écrit gagne » du pont C1.2.
pub(crate) async fn get_client_updated_at(
    pool: &PgPool,
    name: &str,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM clients WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at client: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'un projet de suivi par `path` (None si absent).
pub(crate) async fn get_project_updated_at(
    pool: &PgPool,
    path: &str,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM projects WHERE path = $1")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at projet: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'une tâche par `id` (None si absente).
pub(crate) async fn get_task_updated_at(
    pool: &PgPool,
    id: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at tâche: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// `updated_at` d'une décision par `id` (None si absente).
pub(crate) async fn get_decision_updated_at(
    pool: &PgPool,
    id: i64,
) -> Result<Option<DateTime<Utc>>, String> {
    let row = sqlx::query("SELECT updated_at FROM decisions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture updated_at décision: {}", e))?;
    Ok(row.map(|r| r.get::<DateTime<Utc>, _>("updated_at")))
}

/// Id d'un client par `name` (None si absent) — mapping client_id du pont C1.2.
pub(crate) async fn get_client_by_name(pool: &PgPool, name: &str) -> Result<Option<i64>, String> {
    let row = sqlx::query("SELECT id FROM clients WHERE name = $1")
        .bind(name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture client par nom: {}", e))?;
    Ok(row.map(|r| r.get::<i64, _>("id")))
}

/// Nom d'un client par `id` (None si absent) — mapping client_id du pont C1.2.
pub(crate) async fn get_client_by_id(pool: &PgPool, id: i64) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT name FROM clients WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Lecture client par id: {}", e))?;
    Ok(row.map(|r| r.get::<String, _>("name")))
}

/// Supprime une décision par `id`.
#[allow(dead_code)] // API CRUD suivi (Phase C1.1) — branchée par le pont C1.2.
pub(crate) async fn delete_decision(pool: &PgPool, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM decisions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| format!("Suppression décision: {}", e))?;
    Ok(())
}

/// Liste toutes les décisions — API suivi fusionné, Phase C1.5.
pub(crate) async fn list_decisions(pool: &PgPool) -> Result<Vec<DecisionRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, task_id, summary, source_session, updated_at \
         FROM decisions ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste décisions: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            task_id: r.get::<Option<i64>, _>("task_id"),
            summary: r.get::<String, _>("summary"),
            source_session: r.get::<String, _>("source_session"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        })
        .collect())
}

// ── Tickets (Phase C2.3, spec_gds.md §2.2) ──
// Modèle de demandes/tickets : tickets + commentaires + événements (audit de
// visibilité). `source` distingue l'origine ('web' | 'interne' | 'assistant').
// `status` ∈ 'ouvert' | 'en cours' | 'en correction' | 'fermé' ; `priority` ∈
// 'low' | 'medium' | 'high'. Respecte `gds_enabled` (les commandes/appels
// refusent toute opération si le GDS est désactivé globalement).

/// Ligne ticket (lecture).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct TicketRow {
    pub id: i64,
    pub project_id: Option<i64>,
    pub client_id: Option<i64>,
    pub reporter_user_id: Option<i64>,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// Crée un ticket. Retourne l'id. `source` ∈ 'web' | 'interne' | 'assistant'.
pub(crate) async fn ticket_create(
    pool: &PgPool,
    project_id: Option<i64>,
    client_id: Option<i64>,
    reporter_user_id: Option<i64>,
    title: &str,
    description: &str,
    priority: &str,
    source: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO tickets (project_id, client_id, reporter_user_id, title, description, priority, source) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(project_id)
    .bind(client_id)
    .bind(reporter_user_id)
    .bind(title)
    .bind(description)
    .bind(priority)
    .bind(source)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Création ticket: {}", e))?;
    Ok(row.get::<i64, _>("id"))
}

/// Retourne un ticket par id (None si absent).
#[allow(dead_code)] // API CRUD tickets (Phase C2.3) — exposée pour l'UI/API.
pub(crate) async fn get_ticket_by_id(pool: &PgPool, id: i64) -> Result<Option<TicketRow>, String> {
    let row = sqlx::query(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Lecture ticket: {}", e))?;
    Ok(row.map(|r| TicketRow {
        id: r.get::<i64, _>("id"),
        project_id: r.get::<Option<i64>, _>("project_id"),
        client_id: r.get::<Option<i64>, _>("client_id"),
        reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
        title: r.get::<String, _>("title"),
        description: r.get::<String, _>("description"),
        status: r.get::<String, _>("status"),
        priority: r.get::<String, _>("priority"),
        source: r.get::<String, _>("source"),
        created_at: r.get::<DateTime<Utc>, _>("created_at"),
        updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
        resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
    }))
}

/// Recherche des tickets par filtres (texte libre, statut, projet, client).
/// Tous les filtres sont optionnels (chaîne vide = non filtré). Retourne les
/// tickets correspondants triés par `updated_at` décroissant (les plus récents
/// d'abord).
pub(crate) async fn ticket_search(
    pool: &PgPool,
    query: &str,
    status: &str,
    project_id: Option<i64>,
    client_id: Option<i64>,
) -> Result<Vec<TicketRow>, String> {
    // Construit la clause WHERE avec des placeholders séquentiels $1..$n puis
    // bind les valeurs dans l'ordre. `query`/`status` vides = non filtrés.
    let mut sql = String::from(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets WHERE 1=1",
    );
    let mut n = 0usize;
    let mut binds: Vec<String> = Vec::new();
    if !query.trim().is_empty() {
        n += 1;
        sql.push_str(&format!(" AND (title ILIKE ${} OR description ILIKE ${})", n, n + 1));
        let like = format!("%{}%", query.trim());
        binds.push(like.clone());
        binds.push(like);
        n += 1;
    }
    if !status.trim().is_empty() {
        n += 1;
        sql.push_str(&format!(" AND status = ${}", n));
        binds.push(status.trim().to_string());
    }
    if let Some(pid) = project_id {
        n += 1;
        sql.push_str(&format!(" AND project_id = ${}", n));
        binds.push(pid.to_string());
    }
    if let Some(cid) = client_id {
        n += 1;
        sql.push_str(&format!(" AND client_id = ${}", n));
        binds.push(cid.to_string());
    }
    sql.push_str(" ORDER BY updated_at DESC");
    let mut q = sqlx::query(&sql);
    for b in &binds {
        q = q.bind(b);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Recherche tickets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TicketRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            priority: r.get::<String, _>("priority"),
            source: r.get::<String, _>("source"),
            created_at: r.get::<DateTime<Utc>, _>("created_at"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
            resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
        })
        .collect())
}

/// Liste tous les tickets (API suivi fusionné, Phase C2.3).
pub(crate) async fn list_tickets(pool: &PgPool) -> Result<Vec<TicketRow>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, client_id, reporter_user_id, title, description, status, priority, source, \
                created_at, updated_at, resolved_at \
         FROM tickets ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste tickets: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| TicketRow {
            id: r.get::<i64, _>("id"),
            project_id: r.get::<Option<i64>, _>("project_id"),
            client_id: r.get::<Option<i64>, _>("client_id"),
            reporter_user_id: r.get::<Option<i64>, _>("reporter_user_id"),
            title: r.get::<String, _>("title"),
            description: r.get::<String, _>("description"),
            status: r.get::<String, _>("status"),
            priority: r.get::<String, _>("priority"),
            source: r.get::<String, _>("source"),
            created_at: r.get::<DateTime<Utc>, _>("created_at"),
            updated_at: r.get::<DateTime<Utc>, _>("updated_at"),
            resolved_at: r.get::<Option<DateTime<Utc>>, _>("resolved_at"),
        })
        .collect())
}

/// Ajoute un commentaire à un ticket. Retourne l'id du commentaire.
pub(crate) async fn ticket_comment_add(
    pool: &PgPool,
    ticket_id: i64,
    user_id: Option<i64>,
    body: &str,
    author_label: &str,
) -> Result<i64, String> {
    let row = sqlx::query(
        "INSERT INTO ticket_comments (ticket_id, user_id, body, author_label) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(ticket_id)
    .bind(user_id)
    .bind(body)
    .bind(author_label)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Ajout commentaire ticket: {}", e))?;
    // Touche le ticket (updated_at) pour refléter l'activité.
    sqlx::query("UPDATE tickets SET updated_at = now() WHERE id = $1")
        .bind(ticket_id)
        .execute(pool)
        .await
        .ok();
    Ok(row.get::<i64, _>("id"))
}

/// Met à jour le statut d'un ticket. `status` ∈ 'ouvert' | 'en cours' |
/// 'en correction' | 'fermé'. Quand le statut passe à 'fermé', `resolved_at`
/// est posé à now() (sinon conservé).
pub(crate) async fn ticket_status_update(pool: &PgPool, ticket_id: i64, status: &str) -> Result<(), String> {
    let status = status.trim().to_string();
    if status.is_empty() {
        return Err("Statut ticket vide".to_string());
    }
    let resolved = if status == "fermé" {
        "now()"
    } else {
        "NULL"
    };
    let sql = format!(
        "UPDATE tickets SET status = $1, updated_at = now(), resolved_at = {} WHERE id = $2",
        resolved
    );
    sqlx::query(&sql)
        .bind(&status)
        .bind(ticket_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Mise à jour statut ticket: {}", e))?;
    Ok(())
}

/// Journalise un événement de ticket (audit visibilité).
pub(crate) async fn ticket_event_add(
    pool: &PgPool,
    ticket_id: i64,
    actor: &str,
    action: &str,
    detail: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO ticket_events (ticket_id, actor, action, detail) VALUES ($1, $2, $3, $4)",
    )
    .bind(ticket_id)
    .bind(actor)
    .bind(action)
    .bind(detail)
    .execute(pool)
    .await
    .map_err(|e| format!("Journalisation événement ticket: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_url_from_admin_replaces_user_and_db() {
        let url = app_url_from_admin(
            "postgres://postgres:secret@192.168.1.10:5432/postgres",
            "pilot_gds",
            "pilot",
            "pwd",
        )
        .unwrap();
        assert_eq!(url, "postgres://pilot:pwd@192.168.1.10:5432/pilot_gds");
    }
}
