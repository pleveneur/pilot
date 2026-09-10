// gds_web.rs — Routes API GDS (spec_gds.md §2, Phase A)
//
// Routes axum de base branchées sur le pool gds_db + config gds.rs. Réutilise
// auth_middleware + AuthedClient (web_server.rs) et WebGuard (web_rate.rs).
// Les routes B (sync, verrous), C1.3/C1.5 (suivi fusionné) et C2.3 (tickets)
// sont implémentées.
// Opérations bloquantes dans spawn_blocking.

use crate::gds;
use crate::gds_client;
use crate::gds_db;
use crate::gds_sync;
use crate::web_auth::WebAuth;
use crate::web_server::{AuthedClient, WebCtx};
use crate::AppState;
use axum::extract::{ConnectInfo, Extension, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
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
        // ── Phase B : sync + verrous (implémentées) ──
        .route("/api/gds/sync", post(gds_sync_web))
        .route("/api/gds/lock/release", post(gds_lock_release_web))
        .route("/api/gds/lock/urgent", post(gds_lock_urgent_web))
        .route("/api/gds/locks", get(gds_locks_web))
        // ── Phase C1.3 : forçage serveur du suivi (titulaire du verrou) ──
        .route("/api/gds/tracking/force", post(gds_tracking_force_web))
        // ── Phase C1.5 : routes API suivi fusionné (lecture/écriture) ──
        .route(
            "/api/gds/tracking/clients",
            get(gds_tracking_clients).post(gds_tracking_client_upsert),
        )
        .route("/api/gds/tracking/clients/delete", post(gds_tracking_client_delete))
        .route(
            "/api/gds/tracking/projects",
            get(gds_tracking_projects).post(gds_tracking_project_upsert),
        )
        .route("/api/gds/tracking/projects/delete", post(gds_tracking_project_delete))
        .route(
            "/api/gds/tracking/tasks",
            get(gds_tracking_tasks).post(gds_tracking_task_upsert),
        )
        .route("/api/gds/tracking/tasks/delete", post(gds_tracking_task_delete))
        .route(
            "/api/gds/tracking/decisions",
            get(gds_tracking_decisions).post(gds_tracking_decision_upsert),
        )
        .route("/api/gds/tracking/decisions/delete", post(gds_tracking_decision_delete))
        // ── Phase C2.3 : tickets (modèle + CRUD + routes) ──
        .route("/api/gds/tickets", get(gds_tickets).post(gds_ticket_create_web))
        .route("/api/gds/tickets/{id}/comments", post(gds_ticket_comment_web))
        .route("/api/gds/tickets/{id}/status", post(gds_ticket_status_web))
}

/// Pool GDS depuis AppState (clone court, jamais tenu en lock pendant un await).
/// Court-circuite toutes les routes GDS si le GDS est désactivé globalement
/// (paramètre global `gds_enabled`, actif par défaut).
fn gds_pool(ctx: &WebCtx) -> Result<PgPool, String> {
    let app_state = ctx.app_handle.state::<AppState>();
    if !crate::gds_globally_enabled(&app_state) {
        return Err("GDS désactivé globalement (Paramètres → GDS)".to_string());
    }
    let pool = app_state.gds_pool.lock().unwrap().clone();
    pool.ok_or("GDS non provisionné".to_string())
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

// ── Phase B : synchronisation & verrous ──

#[derive(Deserialize)]
struct SyncBody {
    project: String,
    reason: Option<String>,
}

/// POST /api/gds/sync — synchronise un projet depuis le remote GDS + acquiert
/// le verrou global. Rate limiting login réutilisé (garde-fou).
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

/// POST /api/gds/lock/release — relâche le verrou global du projet.
async fn gds_lock_release_web(
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
    match gds_sync::release_project_lock(&pool, &body.project).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

/// POST /api/gds/lock/urgent — passe le verrou en mode urgent (personne désignée).
async fn gds_lock_urgent_web(
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
    let reason = body.reason.unwrap_or_default();
    match gds_sync::urgent_project_lock(&pool, &body.project, &reason).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

/// GET /api/gds/locks — liste les verrous actifs.
async fn gds_locks_web(State(ctx): State<Arc<WebCtx>>) -> Response {
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_locks(&pool).await {
        Ok(list) => Json(json!({ "locks": list })).into_response(),
        Err(e) => err_response(e),
    }
}

/// POST /api/gds/tracking/force — force la poussée du suivi local vers Postgres
/// (réservé au titulaire du verrou de projet). Phase C1.3.
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

// ── Phase C1.5 : routes API suivi fusionné (lecture/écriture) ──
// Exposent les CRUD des 4 entités du suivi (clients, projects, tasks,
// decisions) derrière auth_middleware. Rate limiting dédié (check_tracking,
// 60 op / 60 s / token) + journalisation d'audit (tracking_*). Toutes les
// routes respectent `gds_enabled` via `gds_pool` (court-circuit si désactivé).

/// Rate limiting suivi : retourne None si autorisé, Some(429) sinon (avec
/// entrée d'audit `rate_limited`).
fn tracking_allowed(ctx: &WebCtx, authed: &AuthedClient) -> Option<Response> {
    if !ctx.guard.check_tracking(&authed.key) {
        ctx.audit.record(&authed.ip, &authed.key, "rate_limited", "tracking", false);
        return Some(
            (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": "Trop de requêtes suivi. Réessayez dans 1 min." })),
            )
                .into_response(),
        );
    }
    None
}

// ── Clients ──

async fn gds_tracking_clients(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_clients(&pool).await {
        Ok(list) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_list", "clients", true);
            Json(json!({ "clients": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ClientUpsertBody {
    name: String,
    #[serde(default)]
    notes: String,
}

async fn gds_tracking_client_upsert(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ClientUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nom client vide" }))).into_response();
    }
    let existing = gds_db::get_client_updated_at(&pool, &name).await;
    let is_create = matches!(existing, Ok(None));
    match gds_db::upsert_client(&pool, &name, &body.notes, Utc::now()).await {
        Ok(id) => {
            let action = if is_create { "tracking_create" } else { "tracking_update" };
            ctx.audit.record(&authed.ip, &authed.key, action, &format!("clients:{}", name), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ClientDeleteBody {
    name: String,
}

async fn gds_tracking_client_delete(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ClientDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_client(&pool, &body.name).await {
        Ok(()) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_delete", &format!("clients:{}", body.name), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Projets (suivi) ──

async fn gds_tracking_projects(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tracking_projects(&pool).await {
        Ok(list) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_list", "projects", true);
            Json(json!({ "projects": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ProjectUpsertBody {
    path: String,
    name: String,
    client_id: Option<i64>,
    #[serde(default)]
    status: String,
}

async fn gds_tracking_project_upsert(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let path = body.path.trim().to_string();
    if path.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Chemin projet vide" }))).into_response();
    }
    let existing = gds_db::get_project_updated_at(&pool, &path).await;
    let is_create = matches!(existing, Ok(None));
    match gds_db::upsert_project(&pool, &path, &body.name, body.client_id, &body.status, Utc::now()).await {
        Ok(id) => {
            let action = if is_create { "tracking_create" } else { "tracking_update" };
            ctx.audit.record(&authed.ip, &authed.key, action, &format!("projects:{}", path), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ProjectDeleteBody {
    path: String,
}

async fn gds_tracking_project_delete(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_project(&pool, &body.path).await {
        Ok(()) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_delete", &format!("projects:{}", body.path), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Tâches ──

async fn gds_tracking_tasks(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tasks(&pool).await {
        Ok(list) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_list", "tasks", true);
            Json(json!({ "tasks": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TaskUpsertBody {
    id: i64,
    project_id: i64,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    deadline: String,
    #[serde(default)]
    blocker_reason: String,
    source_task_id: Option<i64>,
}

async fn gds_tracking_task_upsert(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TaskUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let existing = gds_db::get_task_updated_at(&pool, body.id).await;
    let is_create = matches!(existing, Ok(None));
    match gds_db::upsert_task(
        &pool,
        body.id,
        body.project_id,
        &body.title,
        &body.description,
        &body.status,
        &body.deadline,
        &body.blocker_reason,
        body.source_task_id,
        Utc::now(),
    )
    .await
    {
        Ok(id) => {
            let action = if is_create { "tracking_create" } else { "tracking_update" };
            ctx.audit.record(&authed.ip, &authed.key, action, &format!("tasks:{}", id), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TaskDeleteBody {
    id: i64,
}

async fn gds_tracking_task_delete(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TaskDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_task(&pool, body.id).await {
        Ok(()) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_delete", &format!("tasks:{}", body.id), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Décisions ──

async fn gds_tracking_decisions(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_decisions(&pool).await {
        Ok(list) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_list", "decisions", true);
            Json(json!({ "decisions": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct DecisionUpsertBody {
    id: i64,
    project_id: Option<i64>,
    task_id: Option<i64>,
    summary: String,
    #[serde(default)]
    source_session: String,
}

async fn gds_tracking_decision_upsert(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<DecisionUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let existing = gds_db::get_decision_updated_at(&pool, body.id).await;
    let is_create = matches!(existing, Ok(None));
    match gds_db::upsert_decision(
        &pool,
        body.id,
        body.project_id,
        body.task_id,
        &body.summary,
        &body.source_session,
        Utc::now(),
    )
    .await
    {
        Ok(id) => {
            let action = if is_create { "tracking_create" } else { "tracking_update" };
            ctx.audit.record(&authed.ip, &authed.key, action, &format!("decisions:{}", id), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct DecisionDeleteBody {
    id: i64,
}

async fn gds_tracking_decision_delete(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<DecisionDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_decision(&pool, body.id).await {
        Ok(()) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_delete", &format!("decisions:{}", body.id), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Phase C2.3 : tickets (modèle + CRUD + routes) ──
// Exposent le CRUD des tickets (création, liste, commentaires, changement de
// statut) derrière auth_middleware. Rate limiting dédié (check_tracking) +
// journalisation d'audit (ticket_*). Toutes les routes respectent `gds_enabled`
// via `gds_pool` (court-circuit si désactivé).

/// GET /api/gds/tickets — liste tous les tickets.
async fn gds_tickets(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tickets(&pool).await {
        Ok(list) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_list", "tickets", true);
            Json(json!({ "tickets": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TicketCreateBody {
    title: String,
    #[serde(default)]
    description: String,
    project_id: Option<i64>,
    client_id: Option<i64>,
    #[serde(default)]
    priority: String,
    #[serde(default)]
    source: String,
}

/// POST /api/gds/tickets — crée un ticket.
async fn gds_ticket_create_web(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TicketCreateBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let title = body.title.trim().to_string();
    if title.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Titre ticket vide" }))).into_response();
    }
    let priority = if body.priority.trim().is_empty() { "medium" } else { body.priority.trim() }.to_string();
    let source = if body.source.trim().is_empty() { "web" } else { body.source.trim() }.to_string();
    match gds_db::ticket_create(
        &pool,
        body.project_id,
        body.client_id,
        None, // reporter_user_id : non résolu côté web V1 (visiteur anonyme)
        &title,
        &body.description,
        &priority,
        &source,
    )
    .await
    {
        Ok(id) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_create", &format!("tickets:{}", id), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TicketCommentBody {
    body: String,
    #[serde(default)]
    author_label: String,
}

/// POST /api/gds/tickets/{id}/comments — ajoute un commentaire à un ticket.
async fn gds_ticket_comment_web(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Path(id): Path<i64>,
    Json(body): Json<TicketCommentBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let body_text = body.body.trim().to_string();
    if body_text.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Commentaire vide" }))).into_response();
    }
    match gds_db::ticket_comment_add(&pool, id, None, &body_text, &body.author_label).await {
        Ok(cid) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_update", &format!("tickets:{}:comment:{}", id, cid), true);
            Json(json!({ "ok": true, "comment_id": cid })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TicketStatusBody {
    status: String,
}

/// POST /api/gds/tickets/{id}/status — met à jour le statut d'un ticket.
async fn gds_ticket_status_web(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Path(id): Path<i64>,
    Json(body): Json<TicketStatusBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&ctx, &authed) {
        return resp;
    }
    let pool = match gds_pool(&ctx) {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::ticket_status_update(&pool, id, &body.status).await {
        Ok(()) => {
            ctx.audit.record(&authed.ip, &authed.key, "tracking_update", &format!("tickets:{}:status:{}", id, body.status), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}
