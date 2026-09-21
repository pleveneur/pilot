// gds_web.rs — Routes API GDS propres à l'application desktop (spec_gds.md §2).
//
// Refonte GDS L1.8a : le **routeur partagé** (contexte serveur autonome +
// authentification + routes purement base : suivi, tickets, utilisateurs,
// projets/dépôts git en lecture) vit désormais dans `gds_core::http` et est
// monté par `web_server.rs`. Ce fichier ne conserve que les routes qui font de
// la **logique métier côté poste** et qui restent hors du serveur autonome :
//   - provision de la base (`gds_core::db::provision_db`)    → L1.8b ;
//   - ajout d'un projet au GDS (`gds::add_project_to_gds`)  → L1.8b ;
//   - poussée forcée du suivi (`gds_sync::force_push_tracking`) → L1.8b ;
//   - synchronisation locale du poste (`gds_client::sync_project`) → L1.8c
//     (un serveur n'a pas de copie de travail : cette route reste côté desk).
//
// `WebCtx` implémente `gds_core::http::GdsCtx` pour être monté sans changement
// dans le même routeur protégé : le pool GDS y est résolu par requête (projet
// actif, provisionnement à chaud), ce que `ServerCtx` ne peut pas figer.
//
// L1.8d (adaptateur de montage côté application) : `gds_router()` ci-dessous est
// le **seul** point d'appel de `gds_core::http::gds_routes` côté poste — donc une
// source unique pour le routeur partagé, sans copie locale. Il est générique sur
// le contexte (`DesktopGdsCtx`) pour être monté et **testé** sans Tauri.

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

/// Routes GDS propres au poste (montées par `gds_router`, donc derrière
/// `auth_middleware` dans `web_server.rs`, comme le routeur partagé).
pub(crate) fn gds_desktop_routes<S: DesktopGdsCtx>() -> Router<Arc<S>> {
    Router::new()
        .route("/api/gds/provision", post(gds_provision_web::<S>))
        .route("/api/gds/projects", post(gds_add_project_web::<S>))
        // ── Phase B : synchronisation (verrou retiré en L6) ──
        .route("/api/gds/sync", post(gds_sync_web::<S>))
        // ── Phase C1.3 : forçage serveur du suivi (membres du projet) ──
        .route("/api/gds/tracking/force", post(gds_tracking_force_web::<S>))
}

/// **Adaptateur de montage de l'application** : monte le routeur partagé du
/// socle puis les routes propres au poste. Seul point d'appel de
/// `gds_core::http::gds_routes` côté desktop (source unique) ; `web_server.rs`
/// se contente de fusionner ce routeur derrière l'authentification.
pub(crate) fn gds_router<S: DesktopGdsCtx>() -> Router<Arc<S>> {
    // L2.4 : `login_routes` est montée séparément par le **service** (elle doit
    // précéder l'authentification, sinon aucun jeton ne peut être obtenu). Le
    // poste la remonte ici pour que sa table de routes reste **rigoureusement
    // identique** à avant (L1.10 : aucune modification de comportement du
    // desk — la connexion GDS y reste derrière `auth_middleware`).
    gds_core::http::login_routes::<S>()
        .merge(gds_core::http::gds_routes::<S>())
        .merge(gds_desktop_routes::<S>())
}

/// Capacités du **poste** requises par les routes GDS desktop : résolution du
/// pool depuis `AppState` (projet actif) et provisionnement à chaud. Le routeur
/// partagé (`gds_core::http::gds_routes`) n'a besoin que de `GdsCtx` ; ce trait
/// n'existe que pour l'adaptateur de montage, ce qui le rend testable avec un
/// contexte léger (sans Tauri).
pub trait DesktopGdsCtx: GdsCtx {
    /// Pool GDS courant du poste ; `Err` = GDS indisponible (non provisionné,
    /// désactivé globalement…).
    fn desktop_pool(&self) -> Result<PgPool, String>;
    /// Mémorise un pool fraîchement provisionné (route `provision`).
    fn set_desktop_pool(&self, pool: PgPool);
}

impl DesktopGdsCtx for WebCtx {
    fn desktop_pool(&self) -> Result<PgPool, String> {
        gds_pool(self)
    }

    fn set_desktop_pool(&self, pool: PgPool) {
        *self.app_handle.state::<AppState>().gds_pool.lock().unwrap() = Some(pool);
    }
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

async fn gds_provision_web<S: DesktopGdsCtx>(
    State(ctx): State<Arc<S>>,
    Json(body): Json<ProvisionBody>,
) -> Response {
    let db_addr = body.db_addr;
    let db_user = body.db_user;
    let db_password = body.db_password;
    let admin_email = body.admin_email;
    let admin_password = body.admin_password;
    let pool = match gds_core::db::provision_db(&db_addr, &db_user, &db_password, &admin_email, &admin_password).await {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    };
    ctx.set_desktop_pool(pool);
    Json(json!({ "ok": true, "db": gds_db::GDS_DB_NAME })).into_response()
}

// ── Ajout d'un projet ──

#[derive(Deserialize)]
struct AddProjectBody {
    project: String,
    email: String,
    git_name: Option<String>,
}

async fn gds_add_project_web<S: DesktopGdsCtx>(
    State(ctx): State<Arc<S>>,
    Json(body): Json<AddProjectBody>,
) -> Response {
    let pool = match ctx.desktop_pool() {
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
async fn gds_sync_web<S: DesktopGdsCtx>(
    State(ctx): State<Arc<S>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<SyncBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard().check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match ctx.desktop_pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_client::sync_project(&pool, &body.project).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

/// POST /api/gds/tracking/force — force la poussée du suivi local vers Postgres
/// (réservé à l'administrateur ou à un développeur attribué au projet — L3.6).
/// Phase C1.3.
async fn gds_tracking_force_web<S: DesktopGdsCtx>(
    State(ctx): State<Arc<S>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<SyncBody>,
) -> Response {
    let ip = addr.ip().to_string();
    if !ctx.guard().check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Trop de tentatives. Réessayez dans 1 min." })),
        )
            .into_response();
    }
    let pool = match ctx.desktop_pool() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Method, Request};
    use axum::middleware::from_fn_with_state;
    use gds_core::audit::WebAudit;
    use gds_core::auth::WebAuth;
    use gds_core::rate::WebGuard;
    use std::sync::Mutex;
    use tower::ServiceExt;

    /// Contexte léger : aucune dépendance Tauri ni base réelle. Sans jeton,
    /// `auth_middleware` répond 401 avant tout accès au pool : `pool()` /
    /// `desktop_pool()` ne sont jamais appelés par les requêtes testées.
    struct TestCtx {
        auth: Arc<WebAuth>,
        guard: Arc<WebGuard>,
        audit: Arc<WebAudit>,
        pool: Mutex<Option<PgPool>>,
    }

    impl TestCtx {
        fn new() -> Self {
            Self {
                auth: Arc::new(WebAuth::new()),
                guard: Arc::new(WebGuard::new()),
                audit: Arc::new(WebAudit::new()),
                pool: Mutex::new(None),
            }
        }
    }

    impl GdsCtx for TestCtx {
        fn pool(&self) -> Result<PgPool, String> {
            self.desktop_pool()
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
    }

    impl DesktopGdsCtx for TestCtx {
        fn desktop_pool(&self) -> Result<PgPool, String> {
            self.pool
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| "GDS non provisionné".to_string())
        }
        fn set_desktop_pool(&self, pool: PgPool) {
            *self.pool.lock().unwrap() = Some(pool);
        }
    }

    /// Monte le routeur du poste (`gds_router`, source unique) **sans** la
    /// couche d'authentification : le statut renvoyé distingue alors « route
    /// montée » (handler atteint, ou 405 pour une autre méthode) de « route
    /// absente » (404).
    async fn status_for(method: Method, uri: &str) -> StatusCode {
        let ctx = Arc::new(TestCtx::new());
        let app = gds_router::<TestCtx>().with_state(ctx);
        app.oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    }

    /// Monte `gds_router` **avec** l'authentification, comme `web_server.rs`.
    async fn status_behind_auth(method: Method, uri: &str) -> StatusCode {
        let ctx = Arc::new(TestCtx::new());
        let app = gds_router::<TestCtx>()
            .layer(from_fn_with_state(
                ctx.clone(),
                gds_core::http::auth_middleware::<TestCtx>,
            ))
            .with_state(ctx);
        app.oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    }

    /// Le montage desktop inclut bien le **routeur partagé du socle** : une route
    /// purement base (`GET /api/gds/projects`) atteint son handler — sans pool il
    /// répond 500, alors qu'un montage partagé manquant donnerait 404.
    #[tokio::test]
    async fn shared_core_route_is_mounted() {
        assert_eq!(
            status_for(Method::GET, "/api/gds/projects").await,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    /// Les routes métier du poste restent montées sur le même routeur (L1.8c :
    /// `/api/gds/sync` déclarée en POST) : une autre méthode donne 405 (chemin
    /// connu), pas 404.
    #[tokio::test]
    async fn desktop_route_is_mounted() {
        assert_eq!(
            status_for(Method::GET, "/api/gds/sync").await,
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    /// Contre-épreuve : une route absente renvoie 404 (et non 405), ce qui montre
    /// que les statuts précédents traduisent bien la présence des routes.
    #[tokio::test]
    async fn unknown_route_is_not_mounted() {
        assert_eq!(
            status_for(Method::GET, "/api/gds/does-not-exist").await,
            StatusCode::NOT_FOUND
        );
    }

    /// Le routeur GDS monté reste derrière l'authentification (sans jeton : 401),
    /// pour les routes partagées comme pour les routes du poste. La connexion
    /// (`/api/gds/users/login`) est du nombre : le socle la monte séparément pour
    /// le service (elle doit y être publique), mais la table de routes du **poste**
    /// est inchangée (L2.4 / L1.10).
    #[tokio::test]
    async fn gds_router_is_behind_auth() {
        assert_eq!(
            status_behind_auth(Method::GET, "/api/gds/projects").await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_behind_auth(Method::POST, "/api/gds/sync").await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_behind_auth(Method::POST, "/api/gds/users/login").await,
            StatusCode::UNAUTHORIZED
        );
    }
}
