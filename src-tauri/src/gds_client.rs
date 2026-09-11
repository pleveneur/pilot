// gds_client.rs — Synchronisation poste (spec_gds.md §5, Phase B)
//
// Commande `gds_sync_project` : lit `.pilot/gds.json`, résout `gds_local_dir`
// (défaut `~/Pilot/GDS`), clone si absent sinon fetch/pull depuis le remote
// dédié `gds`, puis acquiert le verrou global projet (Phase B). Réutilise
// git.rs + gds.rs. Sous-processus git bloquants → spawn_blocking.

use crate::gds;
use crate::gds_git;
use crate::gds_ssh;
use crate::gds_sync;
use crate::git;
use crate::AppState;
use serde_json::{json, Value};
use sqlx::PgPool;
use tauri::State;

/// Nom du remote git dédié GDS (distinct de `origin` — préserve un éventuel
/// remote GitHub existant).
pub(crate) const GDS_REMOTE: &str = "gds";

/// Synchronise un projet depuis le remote GDS (clone si absent, sinon
/// fetch/pull) puis acquiert le verrou global projet. Partagé entre la commande
/// Tauri et la route web. `project` = chemin absolu du projet local.
pub(crate) async fn sync_project(pool: &PgPool, project: &str) -> Result<Value, String> {
    let cfg = gds::read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(gds::default_gds_local_dir);
    let name = gds::project_name(project);
    // Phase A3 : s'assurer que la clef du poste est enregistrée pour que le
    // remote `ssh://git@<host>:22/<projet>.git` soit utilisable.
    gds_ssh::ensure_poste_key(pool, &cfg.identity_email).await?;
    let dest = std::path::Path::new(&local_dir).join(&name);
    let dest_str = dest.to_string_lossy().to_string();
    let branch = git::git_current_branch(project);
    let branch = if branch.is_empty() || branch == "HEAD" {
        "main".to_string()
    } else {
        branch
    };
    let url = gds::gds_remote_url(&cfg, &name);

    // Etape 5 : le dossier cible existe sans `.git` → l'initialiser au lieu de
    // `git_fetch` qui échoue (« git fetch a échoué (remote gds) »). (a)
    // Vérification du repo bare serveur AVANT clone : projet jamais ajouté →
    // message d'action clair + onboarding automatique si le projet de travail
    // est un repo Git (c). On NE touche jamais au projet de travail de l'utilisateur
    // (ex: testsnake2 sans `.git`) autrement que via gds_add_project (qui n'agit
    // que si c'est un repo Git). (b) Le remote `gds` est ajouté s'il est absent.
    if !gds_git::bare_repo_exists(&local_dir, &name) {
        let work_is_repo = git::git_is_repo(project);
        let email = cfg.identity_email.trim().to_string();
        if work_is_repo && !email.is_empty() {
            // Onboarding : projet de travail Git + config complète → ajout GDS.
            // Aucun nom saisi ici (pas d'UI interactive) : l'identité est
            // configurée depuis le nom mémorisé (ou l'identité déjà existante).
            gds::add_project_to_gds(pool, project, &email, None).await?;
        } else {
            return Err(
                "Le projet n'a pas encore été ajouté au GDS. Ajoutez-le d'abord grâce à « Ajouter le projet au GDS » (section 3)."
                    .to_string(),
            );
        }
    }

    // Opérations git bloquantes (clone/fetch/pull) → spawn_blocking.
    let action = tokio::task::spawn_blocking(move || {
        if !dest.exists() {
            git::git_clone(&url, &dest_str)?;
            // Le clone crée le remote par défaut `origin` ; ajouter le remote
            // dédié `gds` pour que les fetch/pull suivants fonctionnent.
            git::git_remote_add(&dest_str, GDS_REMOTE, &url)?;
            return Ok::<String, String>("cloned".to_string());
        }
        if !git::git_is_repo(&dest_str) {
            // (a) Dossier cible présent mais pas un work tree Git : l'initialiser
            // avec un premier commit via l'helper partagé (identité git auto :
            // email du compte GDS + nom mémorisé, jamais la config globale), puis
            // connecter au remote gds (au lieu de git_fetch qui échoue).
            let ident_email = cfg.identity_email.trim().to_string();
            let ident_name = gds::memorized_git_name().unwrap_or_default();
            git::ensure_git_repo_with_identity(&dest_str, &ident_email, &ident_name)?;
            git::git_remote_add(&dest_str, GDS_REMOTE, &url)?;
            let _ = git::git_fetch(&dest_str, GDS_REMOTE, &branch);
            let _ = git::git_pull(&dest_str, GDS_REMOTE, &branch);
            return Ok::<String, String>("initialized".to_string());
        }
        // (b) Remote dédié `gds` manquant → l'ajouter avant fetch/pull.
        if !git::git_has_remote(&dest_str, GDS_REMOTE) {
            git::git_remote_add(&dest_str, GDS_REMOTE, &url)?;
        }
        git::git_fetch(&dest_str, GDS_REMOTE, &branch)?;
        git::git_pull(&dest_str, GDS_REMOTE, &branch)?;
        Ok::<String, String>("synced".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    // Verrou global projet (acquisition exclusive, TTL).
    let lock = gds_sync::acquire_project_lock(pool, project, "sync").await?;

    // Phase C1.2 : pont bidirectionnel suivi SQLite↔Postgres (dernier écrit
    // gagne). Non bloquant : une erreur de suivi ne casse pas la sync git.
    let tracking = match gds_sync::sync_tracking(pool).await {
        Ok(v) => v,
        Err(e) => json!({ "ok": false, "error": e }),
    };

    Ok(json!({
        "ok": true,
        "project": name,
        "local_dir": local_dir,
        "action": action,
        "lock": lock,
        "tracking": tracking,
        "initialized": action == "initialized",
    }))
}

/// Commande Tauri : synchronise le projet courant depuis le remote GDS.
#[tauri::command]
pub async fn gds_sync_project(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    sync_project(&pool, &project).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gds_remote_is_gds() {
        assert_eq!(GDS_REMOTE, "gds");
    }
}
