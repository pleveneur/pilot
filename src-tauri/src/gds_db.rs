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

/// Liste les dépôts git (id, project_id, path_on_server, bare_path).
pub(crate) async fn list_git_repos(pool: &PgPool) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, project_id, path_on_server, bare_path FROM git_repos ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Liste git_repos: {}", e))?;
    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<i64, _>("id"),
                "project_id": r.get::<i64, _>("project_id"),
                "path_on_server": r.get::<String, _>("path_on_server"),
                "bare_path": r.get::<String, _>("bare_path"),
            })
        })
        .collect())
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
