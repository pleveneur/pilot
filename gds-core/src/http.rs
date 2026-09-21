// http.rs — Routeur HTTP GDS partagé + contexte serveur autonome
// (refonte GDS, micro-tâche L1.8a ; extrait de `src-tauri/src/gds_web.rs`).
//
// Ce module ne dépend **jamais** de Tauri : il est compilé par `gds-server`.
// Il contient :
//   - `ServerCtx` : le contexte serveur autonome (pool + auth + garde-fous +
//     audit), qui remplace le contexte desktop `WebCtx` (lié à `AppHandle`) ;
//   - le trait `GdsCtx`, contrat minimal de contexte consommé par les handlers
//     partagés. Le desk l'implémente dans `gds_web.rs` sur son `WebCtx` (le pool
//     y est résolu par requête : il peut changer de projet actif, alors que le
//     serveur autonome en a un seul, fixe) ;
//   - `AuthedClient` + `auth_middleware` (authentification par token opaque) ;
//   - les routes qui ne font **que** de la base de données : suivi (clients,
//     projets, tâches, décisions), tickets, utilisateurs (inscription, login,
//     validation), projets (liste) et dépôts git (liste).
//
// Restent hors du crate partagé (missions suivantes) : provision de la base,
// ajout d'un projet, poussée forcée du suivi (L1.8b), synchronisation locale du
// poste (L1.8c), adaptateur de montage complet (L1.8d).

use crate::audit::WebAudit;
use crate::auth::WebAuth;
use crate::db as gds_db;
use crate::rate::{token_key, WebGuard};
use crate::server_status;
use axum::extract::{ConnectInfo, Extension, Path, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;

/// Contrat minimal du contexte consommé par les handlers partagés.
///
/// Le serveur autonome utilise `ServerCtx` ; l'application desktop implémente
/// ce trait sur son `WebCtx` (`gds_web.rs`) car son pool GDS est **dynamique**
/// (un seul pool à la fois, celui du projet actif, et il peut ne pas encore
/// être provisionné) : le contexte partagé ne peut donc pas le figer à la
/// construction.
pub trait GdsCtx: Send + Sync + 'static {
    /// Pool PostgreSQL du GDS. `Err` = GDS indisponible (non provisionné,
    /// désactivé globalement…) : converti en réponse 500, comportement inchangé.
    fn pool(&self) -> Result<PgPool, String>;
    /// Sessions distantes (tokens opaques).
    fn auth(&self) -> &Arc<WebAuth>;
    /// Garde-fous distants (rate limiting).
    fn guard(&self) -> &Arc<WebGuard>;
    /// Journal d'audit distant.
    fn audit(&self) -> &Arc<WebAudit>;
    /// Racine des dépôts bare du serveur, pour l'état administrateur (L2.2).
    /// `None` par défaut : un contexte qui ne gère pas de dépôts (le poste) ne
    /// déclare aucun volume — la route d'administration n'est de toute façon
    /// montée que par le serveur autonome.
    fn repos_root(&self) -> Option<std::path::PathBuf> {
        None
    }
}

/// Contexte du serveur GDS autonome (conteneur) : un seul pool, fixe.
pub struct ServerCtx {
    pub pool: PgPool,
    pub auth: Arc<WebAuth>,
    pub guard: Arc<WebGuard>,
    pub audit: Arc<WebAudit>,
    /// Racine des dépôts bare (supervision administrateur L2.2).
    pub repos_root: std::path::PathBuf,
}

impl GdsCtx for ServerCtx {
    fn pool(&self) -> Result<PgPool, String> {
        Ok(self.pool.clone())
    }

    fn auth(&self) -> &Arc<WebAuth> {
        &self.auth
    }

    fn guard(&self) -> &Arc<WebGuard> {
        &self.guard
    }

    fn audit(&self) -> &Arc<WebAudit> {
        &self.audit
    }

    fn repos_root(&self) -> Option<std::path::PathBuf> {
        Some(self.repos_root.clone())
    }
}

/// Router des routes GDS « pures base » (derrière `auth_middleware`).
pub fn gds_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new()
        .route("/api/gds/users/register", post(gds_register::<S>))
        .route("/api/gds/users/login", post(gds_login::<S>))
        .route("/api/gds/users/validate", post(gds_validate::<S>))
        .route("/api/gds/projects", get(gds_projects::<S>))
        .route("/api/gds/git-repos", get(gds_git_repos::<S>))
        // ── Phase C1.5 : routes API suivi fusionné (lecture/écriture) ──
        .route(
            "/api/gds/tracking/clients",
            get(gds_tracking_clients::<S>).post(gds_tracking_client_upsert::<S>),
        )
        .route(
            "/api/gds/tracking/clients/delete",
            post(gds_tracking_client_delete::<S>),
        )
        .route(
            "/api/gds/tracking/projects",
            get(gds_tracking_projects::<S>).post(gds_tracking_project_upsert::<S>),
        )
        .route(
            "/api/gds/tracking/projects/delete",
            post(gds_tracking_project_delete::<S>),
        )
        .route(
            "/api/gds/tracking/tasks",
            get(gds_tracking_tasks::<S>).post(gds_tracking_task_upsert::<S>),
        )
        .route(
            "/api/gds/tracking/tasks/delete",
            post(gds_tracking_task_delete::<S>),
        )
        .route(
            "/api/gds/tracking/decisions",
            get(gds_tracking_decisions::<S>).post(gds_tracking_decision_upsert::<S>),
        )
        .route(
            "/api/gds/tracking/decisions/delete",
            post(gds_tracking_decision_delete::<S>),
        )
        // ── Phase C2.3 : tickets (modèle + CRUD + routes) ──
        .route("/api/gds/tickets", get(gds_tickets::<S>).post(gds_ticket_create_web::<S>))
        .route(
            "/api/gds/tickets/{id}/comments",
            post(gds_ticket_comment_web::<S>),
        )
        .route(
            "/api/gds/tickets/{id}/status",
            post(gds_ticket_status_web::<S>),
        )
}

/// Assemble le routeur HTTP du **service autonome** `gds-server`.
///
/// Trois zones distinctes (refonte GDS, L2.2) :
///
///  1. **Routes publiques** (`public_routes`) : `GET /api/gds/health`, aucune
///     authentification — un point de supervision doit répondre sans jeton et
///     ne divulgue aucune donnée sensible ;
///  2. **Routes partagées du socle** (`gds_routes`) : derrière
///     `auth_middleware` (token opaque), comportement inchangé ;
///  3. **Routes d'administration** (`admin_routes`) : derrière
///     `auth_middleware` **puis** `require_admin` (rôle `admin` exigé).
///
/// Le poste (`src-tauri`) monte les **mêmes** `gds_routes` derrière son propre
/// middleware dans `web_server.rs` ; ce point de montage est propre au service
/// (contexte figé, une seule base) et n'y est donc pas partagé.
pub fn server_router<S: GdsCtx>(ctx: Arc<S>) -> Router {
    // Garde de rôle appliqué aux seules routes d'administration (L2.2).
    let admin = admin_routes::<S>().layer(from_fn_with_state(ctx.clone(), require_admin::<S>));
    // Authentification appliquée à tout ce qui n'est pas public.
    let protected = Router::new()
        .merge(gds_routes::<S>())
        .merge(admin)
        .layer(from_fn_with_state(ctx.clone(), auth_middleware::<S>));
    Router::new()
        .merge(public_routes::<S>())
        .merge(protected)
        .with_state(ctx)
}

/// Routes **publiques** du service (aucune authentification).
///
/// À ce jour : la santé. Elle ne lit que des compteurs d'entités et des
/// métadonnées de version ; aucune donnée personnelle ni secret.
pub fn public_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new().route("/api/gds/health", get(gds_health::<S>))
}

/// Routes **d'administration** du service (montées derrière `require_admin`).
///
/// À ce jour : l'état serveur (volumes + dernière entrée d'audit). Les routes
/// d'administration à venir (comptes, dépôts, audit, contrôle) viendront ici.
pub fn admin_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new().route("/api/gds/admin/server", get(gds_admin_server::<S>))
}

/// `GET /api/gds/health` — **route publique**.
///
/// Répond toujours en 200, même base injoignable (compteurs `null`) : la
/// supervision doit distinguer « service vivant » de « base prête ».
async fn gds_health<S: GdsCtx>(State(ctx): State<Arc<S>>) -> Response {
    let pool = ctx.pool().ok();
    let report = server_status::collect_health(pool.as_ref(), server_status::started_at()).await;
    Json(report).into_response()
}

/// `GET /api/gds/admin/server` — **réservée au rôle `admin`** (voir
/// `require_admin`). Volumes (dépôts + base) et dernière entrée d'audit.
async fn gds_admin_server<S: GdsCtx>(State(ctx): State<Arc<S>>) -> Response {
    let pool = ctx.pool().ok();
    let repos_root = ctx.repos_root();
    let last_audit = ctx.audit().recent(1).into_iter().next();
    let report = server_status::collect_admin(pool.as_ref(), repos_root.as_deref(), last_audit).await;
    Json(report).into_response()
}

fn err_response(e: String) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response()
}

// ── Authentification (token opaque) ──

/// Client authentifié injecté par `auth_middleware` dans les extensions de la
/// requête, pour que les handlers puissent appliquer un rate limiting par token
/// et émettre un audit log (origine + sujet) sans re-extraire le bearer.
/// `key` = hash SHA-256 du token (jamais le token brut), `ip` = IP source,
/// `role` = rôle du compte porté par la session (chaîne vide si la session ne
/// porte pas de rôle — cas du mode remote du poste).
#[derive(Clone)]
pub struct AuthedClient {
    pub key: String,
    pub ip: String,
    pub role: String,
}

/// Middleware d'authentification : valide le header `Authorization: Bearer <token>`.
pub async fn auth_middleware<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    headers: HeaderMap,
    mut req: Request,
    next: Next,
) -> Response {
    if let Some(token) = extract_bearer(&headers) {
        if ctx.auth().validate(&token) {
            // IP source depuis ConnectInfo (posé par into_make_service_with_connect_info).
            let ip = req
                .extensions()
                .get::<ConnectInfo<std::net::SocketAddr>>()
                .map(|ci| ci.0.ip().to_string())
                .unwrap_or_default();
            req.extensions_mut().insert(AuthedClient {
                key: token_key(&token),
                ip,
                role: ctx.auth().role_of(&token).unwrap_or_default(),
            });
            return next.run(req).await;
        }
    }
    (StatusCode::UNAUTHORIZED, Json(json!({"error": "Non authentifié"}))).into_response()
}

/// Garde « administrateur uniquement » (L2.2), monté **après**
/// `auth_middleware` sur les seules routes d'administration : l'appelant doit
/// être authentifié (sinon 401) et sa session doit porter le rôle `admin`
/// (sinon 403, avec une entrée d'audit `admin_denied`).
///
/// Le rôle provient de la **session existante** (`WebAuth::create_session_as`),
/// il n'est donc jamais relu depuis la base à chaque requête. Le contrôle fin
/// des rôles et statuts (matrice de droits, revalidation `status = active`)
/// appartient au lot L3.3 qui étendra ce garde ; ici il est volontairement
/// **fermé par défaut** : une session sans rôle est refusée.
async fn require_admin<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    req: Request,
    next: Next,
) -> Response {
    let (ip, key, role, path) = match req.extensions().get::<AuthedClient>() {
        Some(c) => (
            c.ip.clone(),
            c.key.clone(),
            c.role.clone(),
            req.uri().path().to_string(),
        ),
        None => {
            return (StatusCode::UNAUTHORIZED, Json(json!({"error": "Non authentifié"})))
                .into_response()
        }
    };
    if role == "admin" {
        return next.run(req).await;
    }
    ctx.audit().record(&ip, &key, "admin_denied", &path, false);
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "Accès réservé à l'administrateur" })),
    )
        .into_response()
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let t = v.strip_prefix("Bearer ")?;
    let t = t.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
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
async fn gds_register<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<RegisterBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard().check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match ctx.pool() {
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
async fn gds_login<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<LoginBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard().check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match ctx.pool() {
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
async fn gds_validate<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Json(body): Json<ValidateBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::set_user_status(&pool, &body.email, "active").await {
        Ok(()) => Json(json!({ "ok": true, "email": body.email, "status": "active" })).into_response(),
        Err(e) => err_response(e),
    }
}

// ── Projets & dépôts git ──

async fn gds_projects<S: GdsCtx>(State(ctx): State<Arc<S>>) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_projects(&pool).await {
        Ok(list) => Json(json!({ "projects": list })).into_response(),
        Err(e) => err_response(e),
    }
}

async fn gds_git_repos<S: GdsCtx>(State(ctx): State<Arc<S>>) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_git_repos(&pool).await {
        Ok(list) => Json(json!({ "git_repos": list })).into_response(),
        Err(e) => err_response(e),
    }
}

// ── Phase C1.5 : routes API suivi fusionné (lecture/écriture) ──
// Exposent les CRUD des 4 entités du suivi (clients, projects, tasks,
// decisions) derrière auth_middleware. Rate limiting dédié (check_tracking,
// 60 op / 60 s / token) + journalisation d'audit (tracking_*).

/// Rate limiting suivi : retourne None si autorisé, Some(429) sinon (avec
/// entrée d'audit `rate_limited`).
fn tracking_allowed<S: GdsCtx>(ctx: &S, authed: &AuthedClient) -> Option<Response> {
    if !ctx.guard().check_tracking(&authed.key) {
        ctx.audit().record(&authed.ip, &authed.key, "rate_limited", "tracking", false);
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

async fn gds_tracking_clients<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_clients(&pool).await {
        Ok(list) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_list", "clients", true);
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

async fn gds_tracking_client_upsert<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ClientUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
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
            ctx.audit().record(&authed.ip, &authed.key, action, &format!("clients:{}", name), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ClientDeleteBody {
    name: String,
}

async fn gds_tracking_client_delete<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ClientDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_client(&pool, &body.name).await {
        Ok(()) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_delete", &format!("clients:{}", body.name), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Projets (suivi) ──

async fn gds_tracking_projects<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tracking_projects(&pool).await {
        Ok(list) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_list", "projects", true);
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

async fn gds_tracking_project_upsert<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
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
            ctx.audit().record(&authed.ip, &authed.key, action, &format!("projects:{}", path), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ProjectDeleteBody {
    path: String,
}

async fn gds_tracking_project_delete<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_project(&pool, &body.path).await {
        Ok(()) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_delete", &format!("projects:{}", body.path), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Tâches ──

async fn gds_tracking_tasks<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tasks(&pool).await {
        Ok(list) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_list", "tasks", true);
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

async fn gds_tracking_task_upsert<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TaskUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
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
            ctx.audit().record(&authed.ip, &authed.key, action, &format!("tasks:{}", id), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct TaskDeleteBody {
    id: i64,
}

async fn gds_tracking_task_delete<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TaskDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_task(&pool, body.id).await {
        Ok(()) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_delete", &format!("tasks:{}", body.id), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Décisions ──

async fn gds_tracking_decisions<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_decisions(&pool).await {
        Ok(list) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_list", "decisions", true);
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

async fn gds_tracking_decision_upsert<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<DecisionUpsertBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
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
            ctx.audit().record(&authed.ip, &authed.key, action, &format!("decisions:{}", id), true);
            Json(json!({ "ok": true, "id": id })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct DecisionDeleteBody {
    id: i64,
}

async fn gds_tracking_decision_delete<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<DecisionDeleteBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::delete_decision(&pool, body.id).await {
        Ok(()) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_delete", &format!("decisions:{}", body.id), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Phase C2.3 : tickets (modèle + CRUD + routes) ──
// Exposent le CRUD des tickets (création, liste, commentaires, changement de
// statut) derrière auth_middleware. Rate limiting dédié (check_tracking) +
// journalisation d'audit (ticket_*).

/// GET /api/gds/tickets — liste tous les tickets.
async fn gds_tickets<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_tickets(&pool).await {
        Ok(list) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_list", "tickets", true);
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
async fn gds_ticket_create_web<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<TicketCreateBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
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
            ctx.audit().record(&authed.ip, &authed.key, "tracking_create", &format!("tickets:{}", id), true);
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
async fn gds_ticket_comment_web<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Path(id): Path<i64>,
    Json(body): Json<TicketCommentBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let body_text = body.body.trim().to_string();
    if body_text.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Commentaire vide" }))).into_response();
    }
    match gds_db::ticket_comment_add(&pool, id, None, &body_text, &body.author_label).await {
        Ok(cid) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_update", &format!("tickets:{}:comment:{}", id, cid), true);
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
async fn gds_ticket_status_web<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Path(id): Path<i64>,
    Json(body): Json<TicketStatusBody>,
) -> Response {
    if let Some(resp) = tracking_allowed(&*ctx, &authed) {
        return resp;
    }
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::ticket_status_update(&pool, id, &body.status).await {
        Ok(()) => {
            ctx.audit().record(&authed.ip, &authed.key, "tracking_update", &format!("tickets:{}:status:{}", id, body.status), true);
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le routeur partagé porte `GET /api/gds/projects` alors que l'application
    /// desktop y ajoute `POST /api/gds/projects` (ajout d'un projet, L1.8b) :
    /// axum autorise le `merge` de deux routeurs qui déclarent le **même chemin
    /// avec des méthodes différentes**, mais `panic` si une méthode est
    /// déclarée deux fois (cf. `MethodRouter::merge_for_path`). Ce test
    /// verrouille le montage desktop (L1.8a) : il échouerait bruyamment au lieu
    /// de laisser le serveur planter au démarrage.
    #[test]
    fn shared_routes_merge_with_same_path_other_method() {
        let shared = gds_routes::<ServerCtx>();
        let desktop_side = Router::<Arc<ServerCtx>>::new()
            .route("/api/gds/projects", post(|| async { "ok" }))
            .route("/api/gds/sync", post(|| async { "ok" }));
        let _merged = shared.merge(desktop_side);
    }
}
