// gds_web.rs — Routes API GDS propres à l'application desktop (spec_gds.md §2).
//
// Refonte GDS L1.8a : le **routeur partagé** (contexte serveur autonome +
// authentification + routes purement base : suivi, tickets, utilisateurs,
// projets/dépôts git en lecture) vit désormais dans `gds_core::http` et est
// monté par `web_server.rs`. Ce fichier ne conserve que les routes qui font de
// la **logique métier côté poste** et qui restent hors du serveur autonome :
//   - provision de la base (`gds::provision_db`)            → L1.8b ;
//   - ajout d'un projet au GDS (`gds::add_project_to_gds`)  → L1.8b ;
//   - poussée forcée du suivi (`gds_sync::force_push_tracking`) → L1.8b ;
//   - synchronisation locale du poste (`gds_client::sync_project`) → L1.8c
//     (un serveur n'a pas de copie de travail : cette route reste côté desk).
//
// `WebCtx` implémente `gds_core::http::GdsCtx` pour être monté sans changement
// dans le même routeur protégé : le pool GDS y est résolu par requête (projet
// actif, provisionnement à chaud), ce que `ServerCtx` ne peut pas figer.

use crate::gds;
use crate::gds_client;
use crate::gds_db;
use crate::gds_sync;
use crate::web_server::WebCtx;
use crate::AppState;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use gds_core::http::GdsCtx;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use tauri::Manager;

/// Routes GDS du poste (fusionnées dans le router protégé de `web_server.rs`,
/// donc derrière `auth_middleware`, comme le routeur partagé).
pub(crate) fn gds_desktop_routes() -> Router<Arc<WebCtx>> {
    Router::new()
        .route("/api/gds/provision", post(gds_provision_web))
        .route("/api/gds/projects", post(gds_add_project_web))
        // ── Phase B : synchronisation (verrou retiré en L6) ──
        .route("/api/gds/sync", post(gds_sync_web))
        // ── Phase C1.3 : forçage serveur du suivi (membres du projet) ──
        .route("/api/gds/tracking/force", post(gds_tracking_force_web))
}

/// Pool GDS depuis AppState (clone court, jamais tenu en lock pendant un await).
/// Court-circuite les routes GDS si le GDS est désactivé globalement
/// (paramètre global `gds_enabled`, actif par défaut).
fn gds_pool(ctx: &WebCtx) -> Result<PgPool, String> {
    let app_state = ctx.app_handle.state::<AppState>();
    if !crate::gds_globally_enabled(&app_state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = app_state.gds_pool.lock().unwrap().clone();
    pool.ok_or("GDS non provisionné".to_string())
}

/// Adaptation du `WebCtx` desktop au contrat du routeur partagé
/// (`gds_core::http::GdsCtx`). Le pool reste résolu par requête — c'est le
/// strict minimum pour que les routes purement base extraites en L1.8a
/// continuent de répondre sans changer de comportement (même garde
/// `gds_enabled`, même message d'erreur).
impl GdsCtx for WebCtx {
    fn pool(&self) -> Result<PgPool, String> {
        gds_pool(self)
    }

    fn auth(&self) -> &Arc<crate::web_auth::WebAuth> {
        &self.auth
    }

    fn guard(&self) -> &Arc<crate::web_rate::WebGuard> {
        &self.guard
    }

    fn audit(&self) -> &Arc<crate::web_audit::WebAudit> {
        &self.audit
    }
}

// ── Provision ──

#[derive(Deserialize)]
struct ProvisionBody {
    db_addr: String,
    db_user: String,
    db_password: String,
    admin_email: String,
    admin_password: String,
}

async fn gds_provision_web(State(ctx): State<Arc<WebCtx>>, Json(body): Json<ProvisionBody>) -> Response {
    let app = ctx.app_handle.clone();
    let db_addr = body.db_addr;
    let db_user = body.db_user;
    let db_password = body.db_password;
    let admin_email = body.admin_email;
    let admin_password = body.admin_password;
    let pool = match gds::provision_db(&db_addr, &db_user, &db_password, &admin_email, &admin_password).await {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    };
    *app.state::<AppState>().gds_pool.lock().unwrap() = Some(pool);
    Json(json!({ "ok": true, "db": gds_db::GDS_DB_NAME })).into_response()
}

// ── Ajout d'un projet ──

#[derive(Deserialize)]
struct AddProjectBody {
    project: String,
    email: String,
    git_name: Option<String>,
}

async fn gds_add_project_web(State(ctx): State<Arc<WebCtx>>, Json(body): Json<AddProjectBody>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds::add_project_to_gds(&pool, &body.project, &body.email, body.git_name).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

// ── Phase B : synchronisation (verrou retiré en L6) ──

#[derive(Deserialize)]
struct SyncBody {
    project: String,
}

/// POST /api/gds/sync — synchronise un projet depuis le remote GDS.
/// Rate limiting login réutilisé (garde-fou).
///
/// Décision de la refonte : cette route **reste côté application** (copie de
/// travail locale) et n'entre pas dans le routeur partagé du serveur (L1.8c).
async fn gds_sync_web(
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<SyncBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard.check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_client::sync_project(&pool, &body.project).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

/// POST /api/gds/tracking/force — force la poussée du suivi local vers Postgres
/// (réservé aux membres du projet). Phase C1.3.
async fn gds_tracking_force_web(
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<SyncBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard.check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_sync::force_push_tracking(&pool, &body.project).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

fn err_response(e: String) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response()
}
