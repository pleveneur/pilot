// gds.rs — Config GDS par projet (.pilot/gds.json) + provision (spec_gds.md §0.4, §3)
//
// La config GDS vit UNIQUEMENT dans le projet (`.pilot/gds.json`) : activation
// on/off, URL du serveur GDS, identité email, dossier local de clonage.
// AUCUN champ gds_* dans la config globale de Pilot (décision 29/08/2026).

use crate::gds_db;
use crate::gds_git;
use crate::git::{git_current_branch, git_push, git_remote_add};
use crate::web_auth::WebAuth;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::PathBuf;
use tauri::State;

/// Config GDS d'un projet (`.pilot/gds.json`).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GdsConfig {
    pub enabled: bool,
    pub server_url: String,
    pub identity_email: String,
    #[serde(default)]
    pub gds_local_dir: Option<String>,
    /// Hôte SSH (host:22) du serveur GDS, dérivé de l'adresse PostgreSQL à la
    /// provision. Utilisé pour construire l'URL du remote git (transport SSH).
    #[serde(default)]
    pub ssh_host: String,
}

/// Dossier local par défaut des projets GDS (clonage) : `~/Pilot/GDS`.
pub(crate) fn default_gds_local_dir() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        "Pilot/GDS".to_string()
    } else {
        format!("{}/Pilot/GDS", home)
    }
}

pub(crate) fn gds_config_path(project: &str) -> PathBuf {
    PathBuf::from(project).join(".pilot").join("gds.json")
}

pub(crate) fn read_gds_config(project: &str) -> Result<GdsConfig, String> {
    let path = gds_config_path(project);
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Lecture gds.json: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("gds.json invalide: {}", e))
}

pub(crate) fn write_gds_config(project: &str, cfg: &GdsConfig) -> Result<(), String> {
    let path = gds_config_path(project);
    let dir = path.parent().ok_or("Chemin gds.json invalide")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Création .pilot: {}", e))?;
    let content = serde_json::to_string_pretty(cfg).map_err(|e| format!("Sérialisation gds.json: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Écriture gds.json: {}", e))
}

#[allow(dead_code)] // API config GDS, utilisée par l'UI desktop (Phase A UI)
pub(crate) fn is_gds_enabled(project: &str) -> bool {
    read_gds_config(project).map(|c| c.enabled).unwrap_or(false)
}

/// Hôte (host:port) extrait d'une URL serveur GDS, pour construire l'URL git SSH.
fn server_host(server_url: &str) -> String {
    let s = server_url.trim();
    let s = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))
        .or_else(|| s.strip_prefix("ssh://"))
        .unwrap_or(s);
    s.split('/').next().unwrap_or(s).to_string()
}

/// Hôte SSH (host:22) dérivé de l'adresse PostgreSQL du serveur GDS.
/// `postgres://user:pass@host:5432/db` → `host:22` (port SSH 22, pas 5432).
fn ssh_host_from_db_addr(db_addr: &str) -> String {
    let at = db_addr.rfind('@').unwrap_or(0);
    let after_at = &db_addr[at + 1..];
    let host_port = after_at.split('/').next().unwrap_or(after_at);
    let host = host_port.split(':').next().unwrap_or(host_port);
    format!("{}:22", host)
}

/// Provisionne la base GDS (test connexion → provision → migrate → admin) et
/// retourne le pool applicatif. Partagé entre la commande Tauri et la route web.
pub(crate) async fn provision_db(
    db_addr: &str,
    db_user: &str,
    db_password: &str,
    admin_email: &str,
    admin_password: &str,
) -> Result<PgPool, String> {
    // 1. Test connexion PostgreSQL AVANT activation.
    let _test = gds_db::connect(db_addr).await?;
    // 2. Provision base + user dédié.
    gds_db::provision(db_addr, gds_db::GDS_DB_NAME, db_user, db_password).await?;
    // 3. Pool applicatif + migrations.
    let app_url = gds_db::app_url_from_admin(db_addr, gds_db::GDS_DB_NAME, db_user, db_password)?;
    let pool = gds_db::connect(&app_url).await?;
    gds_db::migrate(&pool).await?;
    // 4. Provision premier user admin (idempotent).
    let admin_email = admin_email.trim().to_string();
    if !admin_email.is_empty() {
        let existing = gds_db::get_user_by_email(&pool, &admin_email).await?;
        if existing.is_none() {
            let hash = WebAuth::hash_password(admin_password).unwrap_or_default();
            let _ = gds_db::create_user(&pool, &admin_email, "admin", &hash, "admin", "active").await;
        }
    }
    Ok(pool)
}

/// Ajoute un projet au GDS (bare + enregistrement + remote add + push initial).
/// Partagé entre la commande Tauri et la route web.
pub(crate) async fn add_project_to_gds(pool: &PgPool, project: &str, email: &str) -> Result<Value, String> {
    let cfg = read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let name = std::path::Path::new(project)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let res = gds_git::add_project(pool, &local_dir, &name, email, "").await?;
    // git remote add + push initial dans le projet local (bloquant → spawn_blocking).
    let repo_name = format!("{}.git", name);
    // Hôte SSH dédié (renseigné à la provision) ; repli sur server_url si absent
    // (configs anciennes). Évite d'embarquer le port PostgreSQL 5432 dans l'URL SSH.
    let host = if cfg.ssh_host.is_empty() {
        server_host(&cfg.server_url)
    } else {
        cfg.ssh_host.clone()
    };
    let repo_url = format!("ssh://git@{}/{}", host, repo_name);
    let project_owned = project.to_string();
    let repo_url_owned = repo_url.clone();
    // Remote dédié `gds` (et non `origin`) : préserve un éventuel remote
    // `origin` existant (ex: GitHub) et reste idempotent — `git_remote_add`
    // retire puis ré-ajoute le remote `gds` sans toucher aux autres.
    tokio::task::spawn_blocking(move || {
        git_remote_add(&project_owned, "gds", &repo_url_owned)?;
        let branch = git_current_branch(&project_owned);
        if !branch.is_empty() && branch != "HEAD" {
            git_push(&project_owned, "gds", &branch)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(json!({ "ok": true, "project": name, "repo_url": repo_url, "bare": res }))
}

/// Commande Tauri : provisionne le serveur GDS du projet (base + migrations +
/// dossier repos) et active le GDS (écrit `.pilot/gds.json`).
#[tauri::command]
pub async fn gds_provision(
    state: State<'_, AppState>,
    project: String,
    db_addr: String,
    db_user: String,
    db_password: String,
    admin_email: String,
    admin_password: String,
) -> Result<Value, String> {
    let pool = provision_db(&db_addr, &db_user, &db_password, &admin_email, &admin_password).await?;
    // Dossier des repos.
    let local_dir = default_gds_local_dir();
    let repos = gds_git::repos_dir(&local_dir);
    std::fs::create_dir_all(&repos).map_err(|e| format!("Création dossier repos: {}", e))?;
    // Écrire la config projet (activation).
    let cfg = GdsConfig {
        enabled: true,
        server_url: db_addr.clone(),
        identity_email: admin_email.trim().to_string(),
        gds_local_dir: Some(local_dir),
        ssh_host: ssh_host_from_db_addr(&db_addr),
    };
    write_gds_config(&project, &cfg)?;
    // Stocker le pool dans AppState.
    *state.gds_pool.lock().unwrap() = Some(pool);
    Ok(json!({ "ok": true, "db": gds_db::GDS_DB_NAME, "repos_dir": repos.to_string_lossy() }))
}

/// Commande Tauri : valide un compte utilisateur (superadmin) → status active.
#[tauri::command]
pub async fn gds_validate_user(state: State<'_, AppState>, email: String) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::set_user_status(&pool, &email, "active").await?;
    Ok(json!({ "ok": true, "email": email, "status": "active" }))
}

/// Commande Tauri : ajoute le projet courant au GDS (bare + remote + push).
#[tauri::command]
pub async fn gds_add_project(state: State<'_, AppState>, project: String, email: String) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    add_project_to_gds(&pool, &project, &email).await
}

/// Commande Tauri : lit la config GDS du projet (`.pilot/gds.json`).
/// Retourne `null` si le fichier n'existe pas encore (projet non activé).
#[tauri::command]
pub fn gds_get_config(project: String) -> Result<Option<GdsConfig>, String> {
    match read_gds_config(&project) {
        Ok(cfg) => Ok(Some(cfg)),
        Err(e) if e.starts_with("Lecture gds.json") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Commande Tauri : écrit la config GDS du projet (`.pilot/gds.json`).
#[tauri::command]
pub fn gds_save_config(project: String, cfg: GdsConfig) -> Result<(), String> {
    write_gds_config(&project, &cfg)
}

/// Commande Tauri : liste les projets enregistrés sur le serveur GDS.
#[tauri::command]
pub async fn gds_list_projects(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::list_projects(&pool).await
}

/// Commande Tauri : liste les dépôts git (bare) enregistrés sur le serveur GDS.
#[tauri::command]
pub async fn gds_list_git_repos(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::list_git_repos(&pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_host_handles_http_https_ssh() {
        assert_eq!(server_host("http://192.168.1.10:8080"), "192.168.1.10:8080");
        assert_eq!(server_host("https://gds.example.com"), "gds.example.com");
        assert_eq!(server_host("ssh://git@192.168.1.10"), "git@192.168.1.10");
    }

    #[test]
    fn ssh_host_from_postgres_url_uses_ssh_port() {
        // Le bug bloquant : le port PostgreSQL 5432 ne doit pas être embarqué.
        assert_eq!(
            ssh_host_from_db_addr("postgres://postgres:secret@192.168.1.10:5432/postgres"),
            "192.168.1.10:22"
        );
        assert_eq!(
            ssh_host_from_db_addr("postgres://user:pw@db.local:5432/pilot_gds"),
            "db.local:22"
        );
    }

    #[test]
    fn ssh_remote_url_construction_uses_ssh_host() {
        let db_addr = "postgres://postgres:secret@192.168.1.10:5432/postgres";
        let cfg = GdsConfig {
            enabled: true,
            server_url: db_addr.to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: ssh_host_from_db_addr(db_addr),
        };
        let repo_url = format!("ssh://git@{}/{}", cfg.ssh_host, "proj.git");
        assert_eq!(repo_url, "ssh://git@192.168.1.10:22/proj.git");
    }
}
