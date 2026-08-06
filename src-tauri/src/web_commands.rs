// web_commands.rs — Mode remote : commandes desktop de pilotage de l'accès distant.
//
// Domaine extrait de `lib.rs` (2026-08) : mot de passe, kick remote, compteurs,
// statut serveur web, journal d'audit et rechargement du serveur axum. Dépend
// des modules web_* et de `crate::resolve_agent_home`.

use tauri::{AppHandle, State};

use crate::{save_config_disk, sync_tray, web_audit, web_auth, web_server, AppState};

// ── Mode remote : commandes desktop de pilotage de l'accès distant ──

/// Définit (ou change) le mot de passe d'accès distant. Hash argon2 puis persistance.
/// Mot de passe vide = désactivation du serveur (efface le hash) + révocation sessions.
#[tauri::command]
pub fn set_web_password(state: State<AppState>, app: AppHandle, password: String) -> Result<(), String> {
    let mut config = state.config.lock().unwrap().clone();
    if password.is_empty() {
        config.web_password_hash.clear();
    } else {
        config.web_password_hash = web_auth::WebAuth::hash_password(&password)?;
    }
    save_config_disk(&app, &config)?;
    *state.config.lock().unwrap() = config;
    // Invalide toutes les sessions existantes (décision 6.3) + purge les compteurs
    // de rate limiting par token (les tokens n'ont plus de sens).
    state.auth.revoke_all();
    state.guard.reset_all();
    state.audit.record("", "", "set_password", if password.is_empty() { "mot de passe effacé" } else { "mot de passe modifié" }, true);
    Ok(())
}

/// Déconnecte immédiatement tous les clients web connectés (kick remote).
#[tauri::command]
pub fn web_kick_remote(state: State<AppState>) -> Result<(), String> {
    state.auth.revoke_all();
    state.guard.reset_all();
    state.audit.record("", "", "kick", "sessions révoquées", true);
    Ok(())
}

/// Nombre de sessions distantes actuellement actives (badge « client distant connecté »).
#[tauri::command]
pub fn web_active_count(state: State<AppState>) -> Result<usize, String> {
    Ok(state.auth.active_count())
}

/// Indique si un mot de passe distant est défini (sans le révéler).
#[tauri::command]
pub fn web_has_password(state: State<AppState>) -> bool {
    !state.config.lock().unwrap().web_password_hash.is_empty()
}

/// Nombre d'entrées du journal d'audit distant (badge sur le bouton « Journal »).
#[tauri::command]
pub fn web_audit_count(state: State<AppState>) -> usize {
    state.audit.len()
}

/// Renvoie les `n` dernières entrées du journal d'audit distant (plus ancienne
/// d'abord, plus récente en dernier). Pour le panneau de supervision desktop.
#[tauri::command]
pub fn web_audit_log(state: State<AppState>, n: Option<usize>) -> Vec<web_audit::AuditEntry> {
    state.audit.recent(n.unwrap_or(200))
}

/// Vide le journal d'audit distant.
#[tauri::command]
pub fn web_audit_clear(state: State<AppState>) -> () {
    state.audit.clear();
}

/// État consolidé du serveur web distant (badge + diagnostics) : activation,
/// présence d'un mot de passe, nombre de clients connectés, et `running` (un
/// serveur est réellement en écoute — déduit de `web_shutdown.is_some()`).
#[derive(serde::Serialize)]
pub struct WebStatus {
    enabled: bool,
    has_password: bool,
    active_count: usize,
    running: bool,
    bind: String,
    port: u32,
}

#[tauri::command]
pub fn web_status(state: State<AppState>) -> WebStatus {
    let cfg = state.config.lock().unwrap().clone();
    WebStatus {
        enabled: cfg.web_enabled,
        has_password: !cfg.web_password_hash.is_empty(),
        active_count: state.auth.active_count(),
        running: state.web_shutdown.lock().unwrap().is_some(),
        bind: cfg.web_bind.clone(),
        port: crate::effective_web_port(&cfg) as u32,
    }
}

/// Recharge à chaud le serveur web distant : arrête l'instance en cours (si elle
/// existe) puis la relance selon la config actuelle. À appeler depuis le panneau
/// Paramètres après un changement de `web_enabled` / `web_bind` / `web_port`.
/// `web_readonly`, `web_browse_roots` et `web_token_ttl_hours` sont lus à la volée
/// par les handlers et ne nécessitent pas de reload.
#[tauri::command]
pub fn reload_web_server(app: AppHandle) -> Result<(), String> {
    web_server::restart_web_server(&app);
    // Synchroniser l'icône système (tray) avec l'état d'activation du serveur web.
    // Le tray permet de cacher/montrer la fenêtre et d'accéder à « Quitter » quand
    // le keep-alive maintient le process vivant après fermeture de la fenêtre.
    sync_tray(&app);
    Ok(())
}
