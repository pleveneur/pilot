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
use serde_json::{json, Value};
use sqlx::PgPool;
use tauri::State;

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

/// Commande Tauri : passe le verrou du projet en mode urgent (personne désignée).
#[tauri::command]
pub async fn gds_urgent_lock(state: State<'_, AppState>, project: String, reason: String) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    urgent_project_lock(&pool, &project, &reason).await
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
}
