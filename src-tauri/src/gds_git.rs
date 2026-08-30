// gds_git.rs — Dépôts git serveur GDS (spec_gds.md §4)
//
// Un repo bare par projet (`<gds_repos_dir>/<projet>.git`), transport SSH par
// clef liée à l'email. Réutilise les helpers git de `git.rs` (git_init_bare,
// git_remote_add, git_push, git_current_branch). Valide les chemins (anti path
// traversal).

use crate::gds_db;
use crate::git::git_init_bare;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::PathBuf;

/// Dossier des repos serveur (`<gds_local_dir>/repos`).
pub(crate) fn repos_dir(gds_local_dir: &str) -> PathBuf {
    PathBuf::from(gds_local_dir).join("repos")
}

/// Chemin du repo bare d'un projet (`<gds_repos_dir>/<projet>.git`).
pub(crate) fn repo_bare_path(gds_local_dir: &str, project_name: &str) -> PathBuf {
    repos_dir(gds_local_dir).join(format!("{}.git", project_name))
}

/// Valide un nom de projet (anti path traversal) : pas de séparateur, pas de `..`.
pub(crate) fn validate_project_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Nom de projet vide".to_string());
    }
    let has_sep = name.contains('/') || name.contains('\\') || name.contains("..") || name.contains(' ');
    if has_sep {
        return Err("Nom de projet invalide".to_string());
    }
    Ok(name.to_string())
}

/// Crée le repo bare + enregistre le projet et le repo en base. `git_init_bare`
/// est bloquant → exécuté dans `spawn_blocking`. Retourne un résumé JSON.
pub(crate) async fn add_project(
    pool: &PgPool,
    gds_local_dir: &str,
    name: &str,
    email: &str,
    description: &str,
) -> Result<Value, String> {
    let name = validate_project_name(name)?;
    let dir = repos_dir(gds_local_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Création dossier repos: {}", e))?;
    let bare = repo_bare_path(gds_local_dir, &name);
    let bare_str = bare.to_string_lossy().to_string();
    // git_init_bare est bloquant (sous-processus git) → spawn_blocking.
    tokio::task::spawn_blocking(move || {
        if !std::path::Path::new(&bare_str).exists() {
            git_init_bare(&bare_str)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let repo_name = format!("{}.git", name);
    let path_on_server = bare.to_string_lossy().to_string();
    let project_id = gds_db::create_project(pool, &name, &repo_name, "", &path_on_server, "active", description).await?;
    gds_db::create_git_repo(pool, project_id, &path_on_server, &path_on_server).await?;
    // Associer l'utilisateur (email) au projet (V1 : tous accès, table prête V2).
    if let Ok(Some(user)) = gds_db::get_user_by_email(pool, email).await {
        let _ = gds_db::create_project_member(pool, project_id, user.id, "dev").await;
    }
    Ok(json!({ "project_id": project_id, "name": name, "bare_path": path_on_server }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_project_name_ok() {
        assert_eq!(validate_project_name("  myproj  ").unwrap(), "myproj");
    }

    #[test]
    fn validate_project_name_rejects_traversal() {
        assert!(validate_project_name("../etc").is_err());
        assert!(validate_project_name("a/b").is_err());
        assert!(validate_project_name("a\\b").is_err());
        assert!(validate_project_name("a b").is_err());
        assert!(validate_project_name("").is_err());
    }
}
