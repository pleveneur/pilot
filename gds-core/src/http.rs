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
use crate::roles;
use crate::server_status;
use axum::extract::{ConnectInfo, Extension, Path, Query, Request, State};
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
use std::time::Duration;

/// Durée de vie des sessions délivrées par le service GDS
/// (`POST /api/gds/users/login`, L2.4).
///
/// Alignée sur le défaut du poste (`AppConfig::web_token_ttl_hours` = 168 h) pour
/// qu'un même jeton ait la même durée de vie des deux côtés. Le renouvellement et
/// le choix par instance appartiennent aux lots suivants.
const GDS_SESSION_TTL: Duration = Duration::from_secs(168 * 3600);

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

/// Routes d'**identité** du socle : la connexion (`POST /api/gds/users/login`).
///
/// Elle délivre le **premier** jeton : elle doit donc être joignable sans
/// authentification préalable, sinon aucun client ne pourrait jamais en obtenir
/// un (montée derrière `auth_middleware`, elle répondrait 401 à tout le monde).
/// Le poste, lui, la monte avec le reste (`gds_router`) : sa table de routes est
/// ainsi rigoureusement inchangée (L1.10).
///
/// Seule la **connexion** est concernée : `users/register` (auto-inscription)
/// reste dans `gds_routes`, donc derrière l'authentification sur le service — la
/// création de comptes y relève de l'administration (L3.2). Depuis **L3.3**,
/// `users/validate` est montée dans `admin_routes` (réservée au rôle `admin`) et
/// non plus dans `gds_routes` : la limite V1 « validation ouverte à tout client
/// authentifié » est supprimée.
pub fn login_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new().route("/api/gds/users/login", post(gds_login::<S>))
}

/// Router des routes GDS « pures base » (derrière `auth_middleware`).
pub fn gds_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new()
        .route("/api/gds/users/register", post(gds_register::<S>))
        // L3.3 : `users/validate` a quitté `gds_routes` pour `admin_routes`
        // (réservée au rôle `admin`) — la limite V1 est supprimée.
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
///  1. **Routes publiques** (`public_routes`) : `GET /api/gds/health` et
///     `POST /api/gds/setup` (initialisation à usage unique du compte
///     administrateur, L2.4), aucune authentification — un point de supervision
///     doit répondre sans jeton et l'initialisation a lieu avant qu'un jeton
///     puisse exister ; la santé ne divulgue aucune donnée sensible ;
///  2. **Connexion** (`login_routes`) : elle délivre le premier jeton, elle ne
///     peut donc pas être derrière `auth_middleware` (L2.4 : « connexion avec le
///     mot de passe saisi → jeton ») ; elle est protégée par le rate limiting
///     `check_login` du handler ;
///  3. **Routes partagées du socle** (`gds_routes`) : derrière
///     `auth_middleware` (token opaque), comportement inchangé ;
///  4. **Routes d'administration** (`admin_routes`) : derrière
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
        .merge(login_routes::<S>())
        .merge(protected)
        .with_state(ctx)
}

/// Routes **publiques** du service (aucune authentification).
///
/// À ce jour :
/// - `GET /api/gds/health` : la santé. Elle ne lit que des compteurs d'entités et
///   des métadonnées de version ; aucune donnée personnelle ni secret ;
/// - `POST /api/gds/setup` (L2.4) : l'initialisation du compte administrateur.
///   Elle doit être joignable **sans jeton** (au premier démarrage, le service
///   n'a encore aucun compte, donc aucun jeton possible) et devient inopérante
///   (409) dès qu'un administrateur existe.
///
/// La connexion (`login_routes`) est publique elle aussi, mais montée à part :
/// elle ne dépend pas de l'initialisation, elle est le seul moyen d'obtenir un
/// jeton.
pub fn public_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new()
        .route("/api/gds/health", get(gds_health::<S>))
        .route("/api/gds/setup", post(gds_setup::<S>))
}

/// Routes **d'administration** du service (montées derrière `require_admin`).
///
/// À ce jour : l'état serveur (volumes + dernière entrée d'audit) et, depuis
/// L2.5, la régénération immédiate du fichier des clefs autorisées. Les routes
/// d'administration à venir (comptes, dépôts, audit, contrôle) viendront ici.
pub fn admin_routes<S: GdsCtx>() -> Router<Arc<S>> {
    Router::new()
        .route("/api/gds/admin/server", get(gds_admin_server::<S>))
        .route(
            "/api/gds/admin/ssh-keys/refresh",
            post(gds_admin_ssh_keys_refresh::<S>),
        )
        // ── L3.2 : gestion des comptes (création, liste, rôle, statut, mot de passe) ──
        .route(
            "/api/gds/admin/users",
            get(gds_admin_users::<S>).post(gds_admin_user_create::<S>),
        )
        .route("/api/gds/admin/users/role", post(gds_admin_user_role::<S>))
        .route(
            "/api/gds/admin/users/status",
            post(gds_admin_user_status::<S>),
        )
        .route(
            "/api/gds/admin/users/password",
            post(gds_admin_user_password::<S>),
        )
        // ── L3.3 : validation d'un compte (ex-limite V1) réservée à l'admin ──
        .route("/api/gds/users/validate", post(gds_validate::<S>))
        // ── L3.4 : attribution des projets aux développeurs ──
        .route(
            "/api/gds/admin/projects/members",
            get(gds_admin_project_members::<S>),
        )
        .route(
            "/api/gds/admin/projects/assign",
            post(gds_admin_project_assign::<S>),
        )
        .route(
            "/api/gds/admin/projects/unassign",
            post(gds_admin_project_unassign::<S>),
        )
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

/// `POST /api/gds/admin/ssh-keys/refresh` — **réservée au rôle `admin`**
/// (voir `require_admin`).
///
/// Régénère **immédiatement** le fichier `authorized_keys` du compte système
/// `git` depuis la table `ssh_keys` (L2.5 : la base est la source de vérité) et
/// rend la main avec le décompte des clefs autorisées. Le service régénère déjà
/// ce fichier périodiquement (job de `gds-server`) ; cette route permet un
/// rafraîchissement **déterministe** juste après l'enregistrement (ou le
/// retrait) d'une clef, sans attendre le cycle suivant.
///
/// Réponses :
/// - `200 { ok: true, keys, rewritten, path, ssh_dir }` (`rewritten` = le
///   fichier a changé à cet appel) ;
/// - `500 { error }` : base injoignable ou fichier non écriturable (service hors
///   conteneur, compte système `git` absent…).
async fn gds_admin_ssh_keys_refresh<S: GdsCtx>(State(ctx): State<Arc<S>>) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match crate::ssh::regenerate_authorized_keys(&pool).await {
        Ok(sync) => {
            let home = crate::ssh::git_user_home();
            Json(json!({
                "ok": true,
                "keys": sync.keys,
                "rewritten": sync.rewritten,
                "path": crate::ssh::authorized_keys_path_in(&home),
                "ssh_dir": crate::ssh::authorized_keys_dir_in(&home),
            }))
            .into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Gestion des comptes (L3.2) — routes d'administration ──
//
// Montées dans `admin_routes`, donc derrière `auth_middleware` **puis**
// `require_admin` (rôle `admin` exigé). Règle constante : aucune réponse ne
// contient jamais un mot de passe ni une empreinte.

/// `GET /api/gds/admin/users` — **réservée au rôle `admin`**.
/// Liste les comptes (id, email, name, role, status), triés par email.
async fn gds_admin_users<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_users(&pool).await {
        Ok(list) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "users_list", "admin", true);
            Json(json!({ "users": list })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct AdminUserCreateBody {
    email: String,
    #[serde(default)]
    name: String,
    password: String,
    #[serde(default = "default_user_role")]
    role: String,
}

/// Rôle par défaut d'un compte créé par un administrateur (`dev`, comme la
/// valeur par défaut de la base).
fn default_user_role() -> String {
    "dev".to_string()
}

/// `POST /api/gds/admin/users` — **réservée au rôle `admin`**.
///
/// Crée un compte directement **actif** (l'attente de validation ne concerne que
/// l'auto-inscription publique `users/register`). Réponses :
/// - `200 { ok, id, email, role, status }` ;
/// - `400` : email/mot de passe vide ou rôle hors vocabulaire ;
/// - `409` : email déjà inscrit ;
/// - `500` : base injoignable ou erreur d'écriture.
///
/// Le mot de passe est haché (Argon2id) et n'est jamais renvoyé.
async fn gds_admin_user_create<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<AdminUserCreateBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    if email.is_empty() || body.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Email et mot de passe requis" })),
        )
            .into_response();
    }
    let role = body.role.trim();
    if !gds_db::is_known_role(role) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Rôle inconnu: {}", role) })),
        )
            .into_response();
    }
    match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(_)) => {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "Email déjà inscrit" })),
            )
                .into_response()
        }
        Ok(None) => {}
        Err(e) => return err_response(e),
    }
    let hash = match WebAuth::hash_password(&body.password) {
        Ok(h) => h,
        Err(e) => return err_response(e),
    };
    match gds_db::create_user(&pool, &email, &body.name, &hash, role, "active").await {
        Ok(id) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "user_create", &email, true);
            Json(json!({
                "ok": true,
                "id": id,
                "email": email,
                "role": role,
                "status": "active",
            }))
            .into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct AdminUserRoleBody {
    email: String,
    role: String,
}

/// `POST /api/gds/admin/users/role` — **réservée au rôle `admin`**.
/// Change le rôle d'un compte. Réponses : `200`, `400` (rôle hors vocabulaire),
/// `404` (email inconnu), `500`.
async fn gds_admin_user_role<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<AdminUserRoleBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    let role = body.role.trim();
    if !gds_db::is_known_role(role) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Rôle inconnu: {}", role) })),
        )
            .into_response();
    }
    match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Utilisateur introuvable" })),
            )
                .into_response()
        }
        Err(e) => return err_response(e),
    }
    match gds_db::set_user_role(&pool, &email, role).await {
        Ok(()) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "user_role", &email, true);
            Json(json!({ "ok": true, "email": email, "role": role })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct AdminUserStatusBody {
    email: String,
    status: String,
}

/// `POST /api/gds/admin/users/status` — **réservée au rôle `admin`**.
///
/// Change le statut d'un compte en **réutilisant** `gds_db::set_user_status`.
/// Garde-fou « dernier administrateur » : la désactivation du **dernier**
/// administrateur **actif** est refusée (`409`) — l'installation ne doit jamais
/// se retrouver sans personne pour gérer les comptes. Réponses : `200`, `400`
/// (statut hors vocabulaire), `404` (email inconnu), `409` (dernier admin),
/// `500`.
async fn gds_admin_user_status<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<AdminUserStatusBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    let status = body.status.trim();
    if !gds_db::is_known_status(status) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Statut inconnu: {}", status) })),
        )
            .into_response();
    }
    // Le compte est lu d'abord : 404 si l'email est inconnu, et le garde-fou
    // n'a besoin de compter que pour la désactivation d'un admin ACTIF.
    let user = match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Utilisateur introuvable" })),
            )
                .into_response()
        }
        Err(e) => return err_response(e),
    };
    if status == "disabled" && user.role == "admin" && user.status == "active" {
        match gds_db::count_active_admins(&pool).await {
            Ok(n) if n <= 1 => {
                ctx.audit().record(
                    &authed.ip,
                    &authed.key,
                    "user_disable_denied",
                    &email,
                    false,
                );
                return (
                    StatusCode::CONFLICT,
                    Json(json!({
                        "error": "Impossible de désactiver le dernier administrateur actif"
                    })),
                )
                    .into_response();
            }
            Ok(_) => {}
            Err(e) => return err_response(e),
        }
    }
    match gds_db::set_user_status(&pool, &email, status).await {
        Ok(()) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "user_status", &email, true);
            Json(json!({ "ok": true, "email": email, "status": status })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct AdminUserPasswordBody {
    email: String,
    password: String,
}

/// `POST /api/gds/admin/users/password` — **réservée au rôle `admin`**.
/// Réinitialise le mot de passe d'un compte. Le mot de passe n'est ni
/// journalisé, ni renvoyé : seule son empreinte (Argon2id) est écrite.
/// Réponses : `200`, `400` (mot de passe vide), `404` (email inconnu), `500`.
async fn gds_admin_user_password<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<AdminUserPasswordBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    if body.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Mot de passe requis" })),
        )
            .into_response();
    }
    match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Utilisateur introuvable" })),
            )
                .into_response()
        }
        Err(e) => return err_response(e),
    }
    let hash = match WebAuth::hash_password(&body.password) {
        Ok(h) => h,
        Err(e) => return err_response(e),
    };
    match gds_db::reset_user_password(&pool, &email, &hash).await {
        Ok(()) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "user_password", &email, true);
            Json(json!({ "ok": true, "email": email })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Initialisation du compte administrateur (L2.4) ──

#[derive(Deserialize)]
struct SetupBody {
    email: String,
    password: String,
}

/// `POST /api/gds/setup` — **initialisation à usage unique** du compte
/// administrateur (L2.4). Route **publique** : au premier démarrage, le service
/// n'a aucun compte, donc aucun jeton n'est possible.
///
/// Réponses :
/// - `200 { ok: true, email }` : un administrateur vient d'être créé avec
///   l'email et le mot de passe **saisis par le propriétaire** (aucun mot de
///   passe fabriqué par le programme) ;
/// - `409` : un administrateur existe déjà — l'initialisation n'est plus
///   possible (les comptes suivants relèvent des routes d'administration L3.2) ;
/// - `400` : email ou mot de passe vide (il n'y a **pas** de valeur de repli) ;
/// - `429` : trop de tentatives depuis la même IP (garde-fou partagé avec la
///   connexion) ;
/// - `500` : base injoignable ou erreur d'écriture.
///
/// Le mot de passe n'est ni journalisé, ni renvoyé, ni conservé en clair : il est
/// seulement haché (Argon2id) par le socle (`WebAuth::hash_password`).
async fn gds_setup<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<SetupBody>,
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
    if email.is_empty() || body.password.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Email et mot de passe administrateur requis" })),
        )
            .into_response();
    }
    // Verrou d'initialisation : un administrateur existe → refus définitif.
    match gds_db::count_admins(&pool).await {
        Ok(0) => {}
        Ok(_) => return already_initialized(),
        Err(e) => return err_response(e),
    }
    match gds_db::create_initial_admin(&pool, &email, &body.password).await {
        Ok(true) => Json(json!({ "ok": true, "email": email })).into_response(),
        // Deux appels simultanés : le second n'a rien créé, même réponse qu'un
        // administrateur préexistant.
        Ok(false) => already_initialized(),
        Err(e) => err_response(e),
    }
}

/// Réponse **409** de `POST /api/gds/setup` (déjà initialisé).
fn already_initialized() -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "Un administrateur existe déjà : l'initialisation n'est plus possible"
        })),
    )
        .into_response()
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
/// porte pas de rôle — cas du mode remote du poste), `user_id` = identifiant
/// `users.id` du compte (`0` si la session ne porte pas d'identité — refonte
/// GDS **L3.4**, pour la lecture restreinte des projets attribués).
#[derive(Clone)]
pub struct AuthedClient {
    pub key: String,
    pub ip: String,
    pub role: String,
    pub user_id: i64,
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
                user_id: ctx.auth().user_id_of(&token).unwrap_or(0),
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
/// il n'est donc jamais relu depuis la base à chaque requête. Depuis **L3.3**,
/// ce garde protège **toutes** les routes d'administration, y compris la
/// validation d'un compte (`users/validate`, ex-limite V1). Il est
/// volontairement **fermé par défaut** : une session sans rôle est refusée. La
/// matrice fine des droits étendue (revalidation `status = active`) relève du
/// lot L3.5.
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
    // Matrice des droits (L3.5) : rôle `admin` exigé.
    if roles::is_admin(&role) {
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
///
/// L2.4 : délivre un **jeton de session portant le rôle** du compte, via le
/// mécanisme étendu de L2.2 (`WebAuth::create_session_as`) — sans lui, aucun
/// client distant ne pourrait appeler les routes authentifiées (dont la route
/// d'administration réservée au rôle `admin`). Ajout de champ uniquement : les
/// clients existants (desk) reçoivent `ok`/`email`/`role` comme avant.
///
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
    let token = ctx.auth().create_session_for(user.id, &user.role, GDS_SESSION_TTL);
    Json(json!({ "ok": true, "email": user.email, "role": user.role, "token": token }))
        .into_response()
}

#[derive(Deserialize)]
struct ValidateBody {
    email: String,
}

/// Validation d'un compte : passe un compte à `status = 'active'`.
///
/// **Réservée au rôle `admin`** (L3.3) : la route est montée dans
/// `admin_routes`, donc derrière `auth_middleware` **puis** `require_admin`. La
/// limite V1 (« tout client authentifié peut valider un compte ») est
/// supprimée : un jeton non administrateur reçoit 403 avant d'atteindre ce
/// handler.
async fn gds_validate<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ValidateBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::set_user_status(&pool, &body.email, "active").await {
        Ok(()) => {
            ctx.audit()
                .record(&authed.ip, &authed.key, "user_validate", &body.email, true);
            Json(json!({ "ok": true, "email": body.email, "status": "active" })).into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── L3.4 : attribution des projets (routes d'administration) ──

#[derive(Deserialize)]
struct ProjectMembersQuery {
    project_id: i64,
}

/// `GET /api/gds/admin/projects/members?project_id=N` — **réservée au rôle
/// `admin`**. Liste les membres (développeurs attribués) d'un projet.
async fn gds_admin_project_members<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Query(q): Query<ProjectMembersQuery>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    match gds_db::list_project_members(&pool, q.project_id).await {
        Ok(members) => {
            ctx.audit().record(
                &authed.ip,
                &authed.key,
                "project_members_list",
                &q.project_id.to_string(),
                true,
            );
            Json(json!({ "members": members })).into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ProjectAssignBody {
    project_id: i64,
    email: String,
    #[serde(default)]
    role: String,
}

/// `POST /api/gds/admin/projects/assign` — **réservée au rôle `admin`**.
///
/// Attribue un compte (par email) à un projet : c'est l'unique voie d'accès
/// d'un développeur non administrateur (refonte GDS **L3.4**, l'inscription
/// automatique a été supprimée). `role` dans le projet vaut `dev` par défaut.
async fn gds_admin_project_assign<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectAssignBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    let user = match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Compte inconnu" })),
            )
                .into_response()
        }
        Err(e) => return err_response(e),
    };
    let role = if body.role.trim().is_empty() {
        "dev"
    } else {
        body.role.trim()
    };
    match gds_db::assign_project(&pool, body.project_id, user.id, role).await {
        Ok(created) => {
            ctx.audit().record(
                &authed.ip,
                &authed.key,
                "project_assign",
                &format!("{}:{}", body.project_id, email),
                true,
            );
            Json(json!({
                "ok": true,
                "created": created,
                "project_id": body.project_id,
                "email": email,
                "role": role,
            }))
            .into_response()
        }
        Err(e) => err_response(e),
    }
}

#[derive(Deserialize)]
struct ProjectUnassignBody {
    project_id: i64,
    email: String,
}

/// `POST /api/gds/admin/projects/unassign` — **réservée au rôle `admin`**.
/// Retire l'attribution d'un compte à un projet (refonte GDS **L3.4**).
async fn gds_admin_project_unassign<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectUnassignBody>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let email = body.email.trim().to_string();
    let user = match gds_db::get_user_by_email(&pool, &email).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Compte inconnu" })),
            )
                .into_response()
        }
        Err(e) => return err_response(e),
    };
    match gds_db::unassign_project(&pool, body.project_id, user.id).await {
        Ok(removed) => {
            ctx.audit().record(
                &authed.ip,
                &authed.key,
                "project_unassign",
                &format!("{}:{}", body.project_id, email),
                true,
            );
            Json(json!({
                "ok": true,
                "removed": removed,
                "project_id": body.project_id,
                "email": email,
            }))
            .into_response()
        }
        Err(e) => err_response(e),
    }
}

// ── Projets & dépôts git ──

/// `GET /api/gds/projects` — liste les projets visibles par l'appelant.
///
/// Lecture **restreinte** (refonte GDS, **L3.4**) : un compte portant un rôle
/// et une identité (`dev`/`standard`) ne voit que les projets qui lui sont
/// **attribués** (`project_members`). Un administrateur voit tout ; une session
/// historique du poste (rôle vide, sans identité GDS) conserve le comportement
/// antérieur — c'est le propriétaire, il voit tout (aucune régression desk).
async fn gds_projects<S: GdsCtx>(
    State(ctx): State<Arc<S>>,
    Extension(authed): Extension<AuthedClient>,
) -> Response {
    let pool = match ctx.pool() {
        Ok(p) => p,
        Err(e) => return err_response(e),
    };
    let restricted = !authed.role.is_empty() && authed.role != "admin" && authed.user_id != 0;
    let list = if restricted {
        gds_db::list_projects_for_user(&pool, authed.user_id).await
    } else {
        gds_db::list_projects(&pool).await
    };
    match list {
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

/// Garde **matrice de droits** des écritures du suivi et des tickets
/// (refonte GDS, L3.5) : le rôle `standard` est **limité à la lecture**
/// (spec cible §5.2).
///
/// Retourne `Some(403)` et journalise `write_denied` pour un compte `standard`
/// (ou hors vocabulaire) ; `None` pour `admin`, `dev` et la session historique
/// du poste (rôle vide), afin de ne changer aucun comportement existant.
fn write_allowed<S: GdsCtx>(ctx: &S, authed: &AuthedClient, subject: &str) -> Option<Response> {
    if roles::can_write(&authed.role) {
        return None;
    }
    ctx.audit()
        .record(&authed.ip, &authed.key, "write_denied", subject, false);
    Some(
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": roles::write_denied_message(&authed.role) })),
        )
            .into_response(),
    )
}

/// Garde des routes d'**écriture** du suivi : rate limiting puis matrice des
/// droits (L3.5). Les routes de **lecture** n'appellent que `tracking_allowed`.
fn tracking_write_allowed<S: GdsCtx>(
    ctx: &S,
    authed: &AuthedClient,
    subject: &str,
) -> Option<Response> {
    if let Some(resp) = tracking_allowed(ctx, authed) {
        return Some(resp);
    }
    write_allowed(ctx, authed, subject)
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:clients:upsert") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:clients:delete") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:projects:upsert") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:projects:delete") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:tasks:upsert") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:tasks:delete") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:decisions:upsert") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tracking:decisions:delete") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tickets:create") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tickets:comment") {
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
    if let Some(resp) = tracking_write_allowed(&*ctx, &authed, "tickets:status") {
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
