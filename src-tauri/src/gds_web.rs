// gds_web.rs — Routes API GDS (spec_gds.md §2, Phase A)
//
// Routes axum de base branchées sur le pool gds_db + config gds.rs. Réutilise
// auth_middleware + AuthedClient (web_server.rs) et WebGuard (web_rate.rs).
// Les routes B/C (sync, verrous, suivi, tickets) sont RÉSERVÉES : elles
// répondent « disponible à la Phase B/C ». Opérations bloquantes dans
// spawn_blocking.

use crate::gds;
use crate::gds_db;
use crate::web_auth::WebAuth;
use crate::web_server::WebCtx;
use crate::AppState;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use tauri::Manager;

/// Router des routes GDS (fusionné dans le router protégé de web_server.rs,
/// donc derrière auth_middleware).
pub(crate) fn gds_routes() -> Router<Arc<WebCtx>> {
    Router::new()
        .route("/api/gds/provision", post(gds_provision_web))
        .route("/api/gds/users/register", post(gds_register))
        .route("/api/gds/users/login", post(gds_login))
        .route("/api/gds/users/validate", post(gds_validate))
        .route("/api/gds/projects", get(gds_projects).post(gds_add_project_web))
        .route("/api/gds/git-repos", get(gds_git_repos))
        // ── Réservées Phase B/C (verrous, sync, suivi, tickets) ──
        .route("/api/gds/sync", post(gds_phase_bc))
        .route("/api/gds/lock/release", post(gds_phase_bc))
        .route("/api/gds/lock/urgent", post(gds_phase_bc))
        .route("/api/gds/locks", get(gds_phase_bc))
        .route("/api/gds/tracking", get(gds_phase_bc))
        .route("/api/gds/tickets", get(gds_phase_bc))
}

/// Pool GDS depuis AppState (clone court, jamais tenu en lock pendant un await).
fn gds_pool(ctx: &WebCtx) -> Result<PgPool, String> {
    ctx.app_handle
        .state::<AppState>()
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné".to_string())
}

fn err_response(e: String) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response()
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

// ── Identité (auto-inscription, login, validation superadmin) ──

#[derive(Deserialize)]
struct RegisterBody {
    email: String,
    name: String,
    password: String,
}

/// Auto-inscription : crée un compte status 'pending' (validation superadmin requise).
/// Rate limiting login (5/60 s/IP) réutilisé pour limiter les inscriptions abusives.
async fn gds_register(
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<RegisterBody>,
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
    let email = body.email.trim().to_string();
    if email.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Email vide" }))).into_response();
    }
    match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(_)) => {
            return (StatusCode::CONFLICT, Json(json!({ "error": "Email déjà inscrit" }))).into_response();
        }
        Ok(None) => {}
        Err(e) => return err_response(e),
    }
    let hash = WebAuth::hash_password(&body.password).unwrap_or_default();
    match gds_db::create_user(&pool, &email, &body.name, &hash, "dev", "pending").await {
        Ok(id) => Json(json!({ "ok": true, "id": id, "status": "pending" })).into_response(),
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

/// Login : vérifie argon2 + refuse si status != active.
/// Rate limiting login (5/60 s/IP) réutilisé (garde-fou brute-force).
async fn gds_login(
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<LoginBody>,
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
    let email = body.email.trim().to_string();
    let user = match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(u)) => u,
        _ => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Identifiants invalides" }))).into_response(),
    };
    if user.status != "active" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Compte en attente de validation" }))).into_response();
    }
    if !WebAuth::verify_password(&body.password, &user.password_hash) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Identifiants invalides" }))).into_response();
    }
    Json(json!({ "ok": true, "email": user.email, "role": user.role })).into_response()
}

#[derive(Deserialize)]
struct ValidateBody {
    email: String,
}

/// Validation superadmin : passe un compte à 'active'.
///
/// ⚠️ Limite V1 : la route est derrière `auth_middleware` (tout client distant
/// authentifié peut appeler cette route). Le contrôle du rôle superadmin
/// (vérifier que l'appelant est bien un admin) n'est pas encore implémenté —
/// à renforcer en Phase B (rôles + gestionnaire de verrous).
async fn gds_validate(State(ctx): State<Arc<WebCtx>>, Json(body): Json<ValidateBody>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::set_user_status(&pool, &body.email, "active").await {
        Ok(()) => Json(json!({ "ok": true, "email": body.email, "status": "active" })).into_response(),
        Err(e) => err_response(e),
    }
}

// ── Projets & dépôts git ──

async fn gds_projects(State(ctx): State<Arc<WebCtx>>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_projects(&pool).await {
        Ok(list) => Json(json!({ "projects": list })).into_response(),
        Err(e) => err_response(e),
    }
}

async fn gds_git_repos(State(ctx): State<Arc<WebCtx>>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_git_repos(&pool).await {
        Ok(list) => Json(json!({ "git_repos": list })).into_response(),
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct AddProjectBody {
    project: String,
    email: String,
}

async fn gds_add_project_web(State(ctx): State<Arc<WebCtx>>, Json(body): Json<AddProjectBody>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds::add_project_to_gds(&pool, &body.project, &body.email).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

// ── Routes réservées Phase B/C ──

async fn gds_phase_bc() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": "Disponible à la Phase B/C" })),
    )
        .into_response()
}
