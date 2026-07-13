// web_server.rs — Serveur HTTP/WebSocket embarqué (mode remote)
//
// Architecture (spec_web_remote.md §2, §13) :
//   - Serveur axum dans un thread std dédié + runtime tokio multi-thread.
//   - État partagé : récupéré via `app.state::<AppState>()` (Tauri gère déjà un Arc).
//   - Handlers async ; toute opération bloquante (lock std::Mutex, send_command_sync,
//     lecture fichier) encapsulée dans `tokio::task::spawn_blocking` (décision 13.2).
//   - Interdiction absolue de `.await` en tenant un lock `std::sync::Mutex`.
//   - Fan-out des événements RPC via `broadcast::Sender` partagé (décision 13.3).
//   - Authentification : mot de passe argon2 (config) + token opaque (WebAuth).
//   - Validation stricte des chemins : canonicalize + starts_with(project_root)
//     (path traversal), refus UNC et symlinks sortants (décision 6.4).
//
// Sécurité structurante dès la première route (décision 6.10).

use crate::web_auth::WebAuth;
use crate::web_audit::WebAudit;
use crate::web_rate::{token_key, WebGuard};
use crate::{
    build_tree, do_abort_agent, do_compact_agent_context, do_get_agent_messages,
    do_get_agent_state, do_get_session_stats, do_list_agent_models, do_new_agent_session,
    do_send_agent_prompt, do_set_agent_model, do_start_agent_session, do_stop_agent_session,
    open_project_shared, AppConfig, AppState,
};
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Extension, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use include_dir::Dir;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Assets web embarqués dans le binaire (dossier `web/` à la racine du projet).
/// Packaging Tauri propre, aucun fichier externe au runtime (décision 13.9).
static WEB_DIR: Dir<'static> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/../web");

/// Contexte partagé entre les handlers axum.
pub struct WebCtx {
    pub app_handle: AppHandle,
    pub auth: Arc<WebAuth>,
    pub guard: Arc<WebGuard>,
    pub audit: Arc<WebAudit>,
    pub event_tx: tokio::sync::broadcast::Sender<Value>,
}

/// Démarre le serveur web si `web_enabled` est vrai et qu'un mot de passe est défini.
/// Crée son propre thread std dédié + runtime tokio, et enregistre le signal d'arrêt
/// dans `AppState.web_shutdown` (pour `restart_web_server`). Non bloquant.
pub fn start_if_enabled(app_handle: AppHandle) {
    let config = app_handle.state::<AppState>().config.lock().unwrap().clone();
    if !config.web_enabled {
        return;
    }
    if config.web_password_hash.is_empty() {
        eprintln!("[web] Serveur désactivé : aucun mot de passe défini");
        return;
    }
    let port = config.web_port;
    let bind = config.web_bind.clone();

    // Avertissement de sécurité : bind élargi au-delà de 127.0.0.1 (décision 6.1)
    if bind != "127.0.0.1" && bind != "localhost" {
        eprintln!("[web] ⚠️  Le serveur écoute sur '{}' (hors localhost) — restreignez l'accès via Tailscale/ACL", bind);
    }

    // Signal d'arrêt gracieux partagé avec restart_web_server.
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    app_handle
        .state::<AppState>()
        .web_shutdown
        .lock()
        .unwrap()
        .replace(shutdown_tx);

    let event_tx = app_handle.state::<AppState>().event_tx.clone();
    let auth = app_handle.state::<AppState>().auth.clone();
    let guard = app_handle.state::<AppState>().guard.clone();
    let audit = app_handle.state::<AppState>().audit.clone();
    let ctx = Arc::new(WebCtx {
        app_handle: app_handle.clone(),
        auth,
        guard,
        audit,
        event_tx,
    });

    std::thread::Builder::new()
        .name("pilot-web".into())
        .spawn(move || run_server_blocking(ctx, bind, u16::try_from(port).unwrap_or(8787), shutdown_rx))
        .ok();

    // Resync Tailscale Serve si l'option est activée (spec_web_remote.md §14) :
    // reconfigure le proxy HTTPS vers le port courant (utile après un reload
    // suite à un changement de port, sinon le proxy resterait sur l'ancien port).
    crate::tailscale::sync_serve_if_enabled(&app_handle);
}

/// Boucle bloquante du serveur (exécutée dans son propre thread std + runtime tokio).
fn run_server_blocking(
    ctx: Arc<WebCtx>,
    bind: String,
    port: u16,
    shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("pilot-web")
        .build()
        .expect("runtime tokio web");

    runtime.block_on(async move {
        let app = build_router(ctx);
        let addr = format!("{}:{}", bind, port);
        eprintln!("[web] Serveur distant en écoute sur http://{}", addr);
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[web] Impossible de bind {} : {}", addr, e);
                return;
            }
        };
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
        eprintln!("[web] Serveur distant arrêté");
    });
}

/// Recharge à chaud le serveur web : signale l'arrêt de l'instance en cours (si elle
/// existe), attend brièvement la libération du port, puis relance selon la config.
/// Appelée par la commande Tauri `reload_web_server` après un changement de réglages
/// réseau (`web_enabled` / `web_bind` / `web_port`). Sans effet si le serveur est
/// désactivé après reload (arrêt seul).
pub fn restart_web_server(app_handle: &AppHandle) {
    // 1. Arrêter l'instance en cours.
    let prev = app_handle
        .state::<AppState>()
        .web_shutdown
        .lock()
        .unwrap()
        .take();
    if let Some(tx) = prev {
        let _ = tx.send(());
        // Laisser le temps à l'ancien listener de libérer le port.
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    // 2. Relancer (ne fait rien si web_enabled=false ou pas de mot de passe).
    start_if_enabled(app_handle.clone());
}

fn build_router(ctx: Arc<WebCtx>) -> Router {
    // Routes API protégées (sauf /api/auth/login).
    let protected = Router::new()
        .route("/api/agent/state", get(agent_state))
        .route("/api/agent/messages", get(agent_messages))
        .route("/api/agent/stats", get(agent_stats))
        .route("/api/models", get(agent_models))
        .route("/api/agent/prompt", post(agent_prompt))
        .route("/api/agent/abort", post(agent_abort))
        .route("/api/agent/new", post(agent_new))
        .route("/api/agent/compact", post(agent_compact))
        .route("/api/agent/model", post(agent_set_model))
        .route("/api/tree", get(file_tree))
        .route("/api/file", get(file_content).put(file_save).post(file_create))
        .route("/api/file/meta", get(file_meta))
        .route("/api/project", get(project_info))
        .route("/api/project/open", post(project_open))
        .route("/api/project/create", post(project_create))
        .route("/api/project/browse", get(project_browse))
        .layer(from_fn_with_state(ctx.clone(), auth_middleware));

    Router::new()
        .route("/api/auth/login", post(login))
        .route("/ws/agent", get(ws_agent))
        .merge(protected)
        .fallback(serve_static)
        .with_state(ctx)
}

// ── Authentification ──

#[derive(Deserialize)]
struct LoginBody {
    password: String,
}

async fn login(
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<LoginBody>,
) -> Response {
    // Rate limiting login : max 5 tentatives / 60 s / IP (garde-fou brute-force).
    let ip = addr.ip().to_string();
    if !ctx.guard.check_login(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, "60")],
            Json(json!({"error": "Trop de tentatives. Réessayez dans 1 min."})),
        )
            .into_response();
    }
    let app = ctx.app_handle.clone();
    let verify = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        if cfg.web_password_hash.is_empty() {
            return false;
        }
        WebAuth::verify_password(&body.password, &cfg.web_password_hash)
            && body.password.len() <= 1024
    })
    .await
    .unwrap_or(false);

    if !verify {
        ctx.audit.record(&ip, "", "login", "échec identifiants", false);
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Identifiants invalides"})),
        )
            .into_response();
    }

    let ttl_hours = ctx
        .app_handle
        .state::<AppState>()
        .config
        .lock()
        .unwrap()
        .web_token_ttl_hours;
    let ttl = Duration::from_secs((ttl_hours as u64).max(1) * 3600);
    let token = ctx.auth.create_session(ttl);
    ctx.audit.record(&ip, &token_key(&token), "login", "session créée", true);
    eprintln!("[web] Nouvelle session distante créée (ip={})", ip);
    Json(json!({"token": token})).into_response()
}

/// Client authentifié injecté par `auth_middleware` dans les extensions de la
/// requête, pour que les handlers puissent appliquer un rate limiting par token
/// et émettre un audit log (origine + sujet) sans re-extraire le bearer.
/// `key` = hash SHA-256 du token (jamais le token brut), `ip` = IP source.
#[derive(Clone)]
struct AuthedClient {
    key: String,
    ip: String,
}

/// Middleware d'authentification : valide le header `Authorization: Bearer <token>`.
async fn auth_middleware(
    State(ctx): State<Arc<WebCtx>>,
    headers: HeaderMap,
    mut req: Request,
    next: Next,
) -> Response {
    if let Some(token) = extract_bearer(&headers) {
        if ctx.auth.validate(&token) {
            // IP source depuis ConnectInfo (posé par into_make_service_with_connect_info).
            let ip = req
                .extensions()
                .get::<ConnectInfo<std::net::SocketAddr>>()
                .map(|ci| ci.0.ip().to_string())
                .unwrap_or_default();
            req.extensions_mut().insert(AuthedClient {
                key: token_key(&token),
                ip,
            });
            return next.run(req).await;
        }
    }
    (StatusCode::UNAUTHORIZED, Json(json!({"error": "Non authentifié"}))).into_response()
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

// ── Helpers de réponse ──

fn json_result(res: Result<Value, String>) -> Response {
    match res {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e})),
        )
            .into_response(),
    }
}

fn ok_result(res: Result<(), String>) -> Response {
    match res {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e})),
        )
            .into_response(),
    }
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({"error": "Mode lecture seule : action désactivée"})),
    )
        .into_response()
}

fn is_readonly(app: &AppHandle) -> bool {
    app.state::<AppState>().config.lock().unwrap().web_readonly
}

// ── Routes Agent (délèguent aux fonctions libres do_* via spawn_blocking) ──

async fn agent_state(State(ctx): State<Arc<WebCtx>>) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_get_agent_state(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r))
}

#[derive(Deserialize)]
struct MessagesQuery {
    /// Nombre de messages récents à skipper (pagination « plus récents d'abord »).
    offset: Option<usize>,
    /// Nombre de messages à retourner (défaut 200, max 500).
    limit: Option<usize>,
}

async fn agent_messages(
    State(ctx): State<Arc<WebCtx>>,
    Query(q): Query<MessagesQuery>,
) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_get_agent_messages(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    match res.and_then(|r| r) {
        Ok(v) => {
            // Format défensif : pi répond { data: { messages: [...] } } à
            // get_messages (cf. rpc-types). On gère aussi les variantes
            // { messages: [...] } et tableau direct pour robustesse.
            let arr: Vec<Value> = if let Some(a) = v.as_array() {
                a.clone()
            } else if let Some(m) = v
                .get("data")
                .and_then(|d| d.get("messages"))
                .and_then(|m| m.as_array())
            {
                m.clone()
            } else if let Some(m) = v.get("messages").and_then(|m| m.as_array()) {
                m.clone()
            } else {
                Vec::new()
            };
            let total = arr.len();
            let offset = q.offset.unwrap_or(0).min(total);
            let limit = q.limit.unwrap_or(200).clamp(1, 500);
            // Pagination « plus récents d'abord » : on skippe les `offset` plus
            // récents puis on prend les `limit` suivants (plus anciens).
            let end = total.saturating_sub(offset);
            let start = end.saturating_sub(limit);
            let page: Vec<Value> = arr[start..end].to_vec();
            let has_more = start > 0;
            Json(json!({
                "messages": page,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": has_more,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e})),
        )
            .into_response(),
    }
}

async fn agent_stats(State(ctx): State<Arc<WebCtx>>) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_get_session_stats(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r))
}

async fn agent_models(State(ctx): State<Arc<WebCtx>>) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_list_agent_models(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r))
}

#[derive(Deserialize)]
struct PromptBody {
    message: String,
    images: Option<Vec<Value>>,
}

async fn agent_prompt(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<PromptBody>,
) -> Response {
    // Rate limiting prompt : max 10 / 60 s / token (protection crédits API / DoS).
    if !ctx.guard.check_prompt(&authed.key) {
        ctx.audit.record(&authed.ip, &authed.key, "rate_limited", "prompt", false);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, "60")],
            Json(json!({"error": "Trop de prompts. Réessayez dans 1 min."})),
        )
            .into_response();
    }
    if body.message.len() > 100 * 1024 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "Prompt trop volumineux (max 100 Ko)"})),
        )
            .into_response();
    }
    // Limite images : 4 max, 2 Mo chacune (décision 13.6)
    if let Some(ref imgs) = body.images {
        if imgs.len() > 4 {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({"error": "Maximum 4 images par prompt"})),
            )
                .into_response();
        }
        for img in imgs {
            if let Some(data) = img.get("data").and_then(|v| v.as_str()) {
                if data.len() > 2 * 1024 * 1024 {
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        Json(json!({"error": "Image > 2 Mo"})),
                    )
                        .into_response();
                }
            }
        }
    }
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    // Notifier le desktop (et les autres clients web) du message utilisateur tapé à
    // distance : pi n'émet pas d'event "user message" en streaming, donc sans cela
    // le desktop ne verrait pas les prompts distants dans la conversation (ils
    // apparaîtraient seulement au rappel de la discussion). On exclut les commandes
    // slash (commandes système, non affichées localement non plus).
    let user_text = body.message.clone();
    let msg_len = user_text.len();
    let has_images = body.images.as_ref().map_or(0, |v| v.len());
    if !user_text.is_empty() && !user_text.starts_with('/') {
        let ev = json!({ "type": "user_message", "text": user_text, "source": "remote" });
        let _ = ctx.event_tx.send(ev.clone());
        let _ = ctx.app_handle.emit("rpc-event", ev);
    }
    let app = ctx.app_handle.clone();
    let message = body.message;
    let images = body.images;
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_send_agent_prompt(st.inner(), message, images)
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(
        &authed.ip,
        &authed.key,
        "prompt",
        &format!("{} car{}{}", msg_len, if has_images > 0 { format!(", {} img", has_images) } else { String::new() }, if ok { "" } else { " (err)" }),
        ok,
    );
    ok_result(res.and_then(|r| r))
}

async fn agent_abort(State(ctx): State<Arc<WebCtx>>, Extension(authed): Extension<AuthedClient>) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_abort_agent(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "abort", "", ok);
    ok_result(res.and_then(|r| r))
}

async fn agent_new(State(ctx): State<Arc<WebCtx>>, Extension(authed): Extension<AuthedClient>) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_new_agent_session(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "new", "", ok);
    ok_result(res.and_then(|r| r))
}

async fn agent_compact(State(ctx): State<Arc<WebCtx>>, Extension(authed): Extension<AuthedClient>) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_compact_agent_context(st.inner())
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "compact", "", ok);
    ok_result(res.and_then(|r| r))
}

#[derive(Deserialize)]
struct SetModelBody {
    provider: String,
    #[serde(rename = "modelId")]
    model_id: String,
}

async fn agent_set_model(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<SetModelBody>,
) -> Response {
    let app = ctx.app_handle.clone();
    let provider = body.provider;
    let model_id = body.model_id;
    let provider_aud = provider.clone();
    let model_id_aud = model_id.clone();
    let res = tokio::task::spawn_blocking(move || {
        let st = app.state::<AppState>();
        do_set_agent_model(st.inner(), provider, model_id)
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(
        &authed.ip,
        &authed.key,
        "set_model",
        &format!("{}/{}{}", provider_aud, model_id_aud, if ok { "" } else { " (err)" }),
        ok,
    );
    ok_result(res.and_then(|r| r))
}

// ── Routes Fichiers (lecture seule distant, validation des chemins) ──

#[derive(Deserialize)]
struct PathQuery {
    path: Option<String>,
}

async fn file_tree(State(ctx): State<Arc<WebCtx>>, Query(q): Query<PathQuery>) -> Response {
    let app = ctx.app_handle.clone();
    let req_path = q.path;
    let res = tokio::task::spawn_blocking(move || {
        let root = project_root(&app)?;
        let target = match req_path {
            Some(p) if !p.is_empty() => validate_within(&p, &root)?,
            _ => root,
        };
        build_tree(&target)
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r.map(|n| serde_json::to_value(&n).unwrap_or(Value::Null))))
}

async fn file_content(
    State(ctx): State<Arc<WebCtx>>,
    Query(q): Query<PathQuery>,
) -> Response {
    let app = ctx.app_handle.clone();
    let req_path = q.path.unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        let root = project_root(&app)?;
        let canon = validate_within(&req_path, &root)?;
        let bytes = std::fs::read(&canon).map_err(|e| format!("Lecture: {}", e))?;
        // Détecter binaire (présence de NUL) — refus en lecture seule distant
        if bytes.iter().any(|&b| b == 0) {
            return Err("Fichier binaire : non affichable en lecture distante".to_string());
        }
        let content = String::from_utf8(bytes).map_err(|e| format!("UTF-8: {}", e))?;
        Ok(content)
    })
    .await
    .map_err(|e| e.to_string());
    match res.and_then(|r| r) {
        Ok(content) => Json(json!({"content": content})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": e})),
        )
            .into_response(),
    }
}

/// Métadonnées légères d'un fichier (sans contenu) : taille, date, type.
/// Utile au web avant ouverture/édition, et pour l'affichage dans la visionneuse.
async fn file_meta(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Query(q): Query<PathQuery>,
) -> Response {
    let app = ctx.app_handle.clone();
    let req_path = q.path.unwrap_or_default();
    let path_aud = req_path.clone();
    let res = tokio::task::spawn_blocking(move || {
        let root = project_root(&app)?;
        let canon = validate_within(&req_path, &root)?;
        let md = std::fs::metadata(&canon).map_err(|e| format!("Metadata: {}", e))?;
        let modified = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let is_dir = md.is_dir();
        let name = canon
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = canon
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(json!({
            "path": canon.to_string_lossy(),
            "name": name,
            "size": md.len(),
            "modified": modified,
            "is_dir": is_dir,
            "is_file": !is_dir,
            "ext": ext,
        }))
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "file_meta", &path_aud, ok);
    match res.and_then(|r| r) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

/// Enregistre le contenu d'un fichier existant (édition web v2). Le fichier doit
/// déjà exister et être dans le projet (validation `validate_within`). Refus en
/// readonly, refus des contenus binaires (NUL) et > 5 Mo. La création de nouveaux
/// fichiers n'est pas couverte ici (v2 = édition de fichiers ouverts).
#[derive(Deserialize)]
struct FileSaveBody {
    path: String,
    content: String,
}

async fn file_save(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<FileSaveBody>,
) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    if body.content.len() > 5 * 1024 * 1024 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "Fichier trop volumineux (max 5 Mo)"})),
        )
            .into_response();
    }
    let app = ctx.app_handle.clone();
    let path = body.path;
    let content = body.content;
    let path_aud = path.clone();
    let res = tokio::task::spawn_blocking(move || {
        let root = project_root(&app)?;
        let canon = validate_within(&path, &root)?;
        if canon.is_dir() {
            return Err("C'est un dossier, pas un fichier".to_string());
        }
        // Refuser contenu binaire (présence d'un octet NUL) — défensif.
        if content.as_bytes().iter().any(|&b| b == 0) {
            return Err("Contenu binaire refusé".to_string());
        }
        std::fs::write(&canon, content).map_err(|e| format!("Écriture: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "file_save", &path_aud, ok);
    match res.and_then(|r| r) {
        Ok(_) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}

/// Valide et résout le chemin d'un **nouveau** fichier (inexistant) dans `root`.
/// `path` peut être absolu (dans le projet) ou relatif au project root. On
/// canonicalise le **parent** (qui doit exister) puis on vérifie `starts_with(root)`
/// et on refuse les basenames contenant un séparateur (anti path traversal).
/// Retourne le chemin canonique cible (non existant).
fn validate_new_within(path: &str, root: &Path) -> Result<PathBuf, String> {
    if is_unc_path(path) {
        return Err("Chemin UNC refusé".to_string());
    }
    let p = Path::new(path);
    let base = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    };
    let parent = base.parent().ok_or("Chemin invalide (pas de parent)")?;
    let basename = base.file_name().ok_or("Chemin invalide (pas de nom)")?;
    let basename_str = basename.to_string_lossy();
    let has_sep = basename_str.contains('/')
        || basename_str.bytes().any(|c| c == 0x5C);
    if has_sep || basename_str == ".." || basename_str == "." || basename_str.is_empty() {
        return Err("Nom de fichier invalide".to_string());
    }
    let parent_canon = parent
        .canonicalize()
        .map_err(|e| format!("Dossier parent introuvable: {}", e))?;
    if !parent_canon.starts_with(root) {
        return Err("Accès hors du projet refusé".to_string());
    }
    let target = parent_canon.join(basename);
    if target.exists() {
        return Err("Ce fichier existe déjà (utilisez Éditer pour le modifier)".to_string());
    }
    Ok(target)
}

/// Crée un nouveau fichier (body : `path`, `content`). `path` est absolu (dans le
/// projet) ou relatif au project root. Refus readonly, binaire, > 5 Mo, existant.
#[derive(Deserialize)]
struct FileCreateBody {
    path: String,
    content: String,
}

async fn file_create(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<FileCreateBody>,
) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    if body.content.len() > 5 * 1024 * 1024 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "Fichier trop volumineux (max 5 Mo)"})),
        )
            .into_response();
    }
    let app = ctx.app_handle.clone();
    let path = body.path;
    let content = body.content;
    let path_aud = path.clone();
    let res = tokio::task::spawn_blocking(move || {
        let root = project_root(&app)?;
        let target = validate_new_within(&path, &root)?;
        if content.as_bytes().iter().any(|&b| b == 0) {
            return Err("Contenu binaire refusé".to_string());
        }
        std::fs::write(&target, content).map_err(|e| format!("Écriture: {}", e))?;
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string());
    let ok = res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "file_create", &path_aud, ok);
    match res.and_then(|r| r) {
        Ok(canon) => Json(json!({"ok": true, "path": canon})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response(),
    }
}
// ── Routes Projet ──

async fn project_info(State(ctx): State<Arc<WebCtx>>) -> Response {
    let app = ctx.app_handle.clone();
    let res = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let current = state.project_path.lock().unwrap().clone();
        let roots = resolve_browse_roots(&cfg);
        Ok(json!({
            "current": current,
            "recent": cfg.recent_projects,
            "roots": roots,
            "readonly": cfg.web_readonly,
        }))
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r))
}

#[derive(Deserialize)]
struct ProjectOpenBody {
    path: String,
}

async fn project_open(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectOpenBody>,
) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    let app = ctx.app_handle.clone();
    let path = body.path;
    let path_aud = path.clone();
    // Validation : le chemin doit être dans une racine autorisée (whitelist).
    let app_v = app.clone();
    let path_v = path.clone();
    let valid = tokio::task::spawn_blocking(move || {
        let state = app_v.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let roots = resolve_browse_roots(&cfg);
        validate_within_roots(&path_v, &roots)
    })
    .await
    .unwrap_or(false);
    if !valid {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Chemin hors des racines autorisées"})),
        )
            .into_response();
    }
    let app2 = app.clone();
    let path2 = path.clone();
    let res = tokio::task::spawn_blocking(move || {
        let node = open_project_shared(&app2, &path2)?;
        // Redémarrer l'agent pi sur le nouveau cwd — uniquement si une session
        // était active. Le desktop redémarre pi lui-même via le cycle fermeture/
        // ouverture de l'onglet agent ; le web n'a pas ce mécanisme → on le
        // centralise ici (spec_web_remote.md §3).
        let state = app2.state::<AppState>();
        let was_active = state.rpc_state.lock().unwrap().is_some();
        if was_active {
            do_stop_agent_session(&state);
            if let Err(e) = do_start_agent_session(&state, &app2) {
                eprintln!("[web] Redémarrage agent après changement de projet échoué : {}", e);
            }
        }
        Ok(node)
    })
    .await
    .map_err(|e| e.to_string());
    match res.and_then(|r| r) {
        Ok(node) => {
            ctx.audit.record(&authed.ip, &authed.key, "project_open", &path_aud, true);
            Json(serde_json::to_value(&node).unwrap_or(Value::Null)).into_response()
        }
        Err(e) => {
            ctx.audit.record(&authed.ip, &authed.key, "project_open", &path_aud, false);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e})),
            )
                .into_response()
        }
    }
}

/// Crée un nouveau dossier projet dans une racine autorisée puis l'ouvre.
/// Le chemin cible ne doit pas exister ; son parent doit exister et être dans
/// une racine (whitelist) : on reconstruit `parent_canon.join(basename)` pour
/// éviter tout path traversal (basename sans séparateur/..).
#[derive(Deserialize)]
struct ProjectCreateBody {
    path: String,
}

/// true si le chemin est un chemin UNC (réseau), à refuser pour le remote.
/// Sur Windows, `std::fs::canonicalize` ajoute le préfixe verbatim `\\?\`
/// (ex. `\\?\G:\...`) qui est un chemin local étendu — **pas** un UNC — il ne
/// faut donc pas le confondre avec `\\server\share`. On distingue :
///   - `\\?\...`       → préfixe verbatim local (OK, pas UNC)
///   - `\\?\UNC\...`   → UNC verbatim (refusé)
///   - `\\.\...`       → préfixe device (OK, pas UNC)
///   - `\\server\...`  → UNC classique (refusé)
fn is_unc_path(p: &str) -> bool {
    let b = p.as_bytes();
    // Doit commencer par deux antislashs.
    if !(b.len() >= 2 && b[0] == 0x5C && b[1] == 0x5C) {
        return false;
    }
    // Préfixe verbatim `\\?\` : chemin étendu local. Sauf `\\?\UNC\...` (UNC).
    if p.starts_with("\\\\?\\") {
        let rest = &p[4..];
        let upper = rest.to_ascii_uppercase();
        return upper.starts_with("UNC\\") || upper.starts_with("UNC/");
    }
    // Préfixe device `\\.\` : pas un UNC.
    if p.starts_with("\\\\.\\") {
        return false;
    }
    // `\\server\share` : UNC classique.
    true
}

async fn project_create(
    State(ctx): State<Arc<WebCtx>>,
    Extension(authed): Extension<AuthedClient>,
    Json(body): Json<ProjectCreateBody>,
) -> Response {
    if is_readonly(&ctx.app_handle) {
        return forbidden();
    }
    let app = ctx.app_handle.clone();
    let path = body.path;
    let path_aud = path.clone();
    if is_unc_path(&path) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "Chemin UNC refusé"}))).into_response();
    }
    // Validation + création du dossier (spawn_blocking car fs bloquant).
    let app_v = app.clone();
    let path_v = path.clone();
    let create_res = tokio::task::spawn_blocking(move || {
        let state = app_v.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let roots = resolve_browse_roots(&cfg);
        if roots.is_empty() {
            return Err("Aucune racine autorisée pour créer un projet".to_string());
        }
        let p = std::path::Path::new(&path_v);
        let parent = p.parent().ok_or("Chemin invalide (pas de parent)")?;
        let basename = p.file_name().ok_or("Chemin invalide (pas de nom)")?;
        let basename_str = basename.to_string_lossy();
        // Refuser séparateurs/.. dans le basename (anti path traversal) :
        // on teste via les bytes (0x5C = antislash) pour éviter tout backslash
        // littéral dans le source.
        let has_sep = basename_str.contains('/')
            || basename_str.bytes().any(|c| c == 0x5C);
        if has_sep || basename_str == ".." || basename_str == "." || basename_str.is_empty() {
            return Err("Nom de projet invalide".to_string());
        }
        let parent_canon = parent
            .canonicalize()
            .map_err(|e| format!("Parent introuvable: {}", e))?;
        if !roots.iter().any(|r| parent_canon.starts_with(r)) {
            return Err("Parent hors des racines autorisées".to_string());
        }
        let target = parent_canon.join(basename);
        if target.exists() {
            return Err("Ce dossier existe déjà".to_string());
        }
        std::fs::create_dir_all(&target).map_err(|e| format!("Création: {}", e))?;
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string());
    let target_path = match create_res.and_then(|r| r) {
        Ok(t) => t,
        Err(e) => {
            ctx.audit.record(&authed.ip, &authed.key, "project_create", &path_aud, false);
            return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
        }
    };
    // Ouvrir le projet fraîchement créé (émet déjà project_changed côté desktop).
    let app2 = app.clone();
    let target_clone = target_path.clone();
    let open_res = tokio::task::spawn_blocking(move || {
        open_project_shared(&app2, &target_clone)
    })
    .await
    .map_err(|e| e.to_string());
    let ok = open_res.is_ok();
    ctx.audit.record(&authed.ip, &authed.key, "project_create", &target_path, ok);
    match open_res.and_then(|r| r) {
        Ok(node) => Json(serde_json::to_value(&node).unwrap_or(Value::Null)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

#[derive(Deserialize)]
struct BrowseQuery {
    root: String,
}

async fn project_browse(
    State(ctx): State<Arc<WebCtx>>,
    Query(q): Query<BrowseQuery>,
) -> Response {
    let app = ctx.app_handle.clone();
    let root = q.root;
    let res = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap().clone();
        let roots = resolve_browse_roots(&cfg);
        let canon = validate_within_roots_canon(&root, &roots)?;
        // Lister uniquement les sous-dossiers (décision 6.4)
        let mut dirs = Vec::new();
        for entry in std::fs::read_dir(&canon).map_err(|e| format!("Lecture: {}", e))? {
            let entry = entry.map_err(|e| format!("Entrée: {}", e))?;
            if entry.path().is_dir() {
                dirs.push(entry.path().to_string_lossy().to_string());
            }
        }
        dirs.sort();
        Ok(json!({"path": canon.to_string_lossy(), "dirs": dirs}))
    })
    .await
    .map_err(|e| e.to_string());
    json_result(res.and_then(|r| r))
}

// ── WebSocket /ws/agent (diffusion des événements RPC en temps réel) ──

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

async fn ws_agent(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(ctx): State<Arc<WebCtx>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
) -> Response {
    let token = q.token.unwrap_or_default();
    if !ctx.auth.validate(&token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let key = token_key(&token);
    let ip = addr.ip().to_string();
    ctx.audit.record(&ip, &key, "ws_open", "", true);
    ws.on_upgrade(move |socket| async move {
        // Limite de WebSockets simultanés par token (décision 6.4d) : max 3.
        if !ctx.guard.ws_acquire(&key) {
            let _ = socket.close().await; // refus : trop de connexions
            return;
        }
        handle_ws(socket, ctx.clone()).await;
        ctx.guard.ws_release(&key);
    })
}

async fn handle_ws(mut socket: WebSocket, ctx: Arc<WebCtx>) {
    let mut rx = ctx.event_tx.subscribe();
    loop {
        tokio::select! {
            ev = rx.recv() => {
                match ev {
                    Ok(v) => {
                        let text = serde_json::to_string(&v).unwrap_or_default();
                        if socket.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => { /* ignore (ping/client echo) */ }
                    _ => break,
                }
            }
        }
    }
    let _ = socket.close().await;
}

// ── Assets statiques (embarqués via include_dir) ──

async fn serve_static(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let file = if path.is_empty() { "index.html" } else { path };
    match WEB_DIR.get_file(file) {
        Some(f) => {
            let mime = guess_mime(file);
            let mut resp = Response::new(Body::from(f.contents().to_vec()));
            resp.headers_mut()
                .insert(header::CONTENT_TYPE, mime.parse().unwrap_or_else(|_| "application/octet-stream".parse().unwrap()));
            // Headers de sécurité (décision 6.6)
            resp.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
            resp
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn guess_mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

// ── Validation des chemins (path traversal, UNC, symlinks sortants) ──

/// Racine canonique du projet courant (canonicalisée).
fn project_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<AppState>();
    let p = state
        .project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Aucun projet ouvert")?;
    let pb = PathBuf::from(&p);
    pb.canonicalize().map_err(|e| format!("Racine projet invalide: {}", e))
}

/// Valide qu'un chemin est à l'intérieur de `root` (canonicalisation + starts_with).
/// Refuse les chemins UNC et les symlinks sortants (canonicalize résout les liens).
fn validate_within(path: &str, root: &Path) -> Result<PathBuf, String> {
    if is_unc_path(path) {
        return Err("Chemin UNC refusé".to_string());
    }
    let p = Path::new(path);
    let canon = p
        .canonicalize()
        .map_err(|e| format!("Chemin invalide: {}", e))?;
    if !canon.starts_with(root) {
        return Err("Accès hors du projet refusé".to_string());
    }
    Ok(canon)
}

/// Racines autorisées pour la navigation projet (whitelist canonique).
/// Si `web_browse_roots` est vide → union des parents canoniques des récents
/// (décision 13.5).
fn resolve_browse_roots(cfg: &AppConfig) -> Vec<PathBuf> {
    if !cfg.web_browse_roots.is_empty() {
        return cfg
            .web_browse_roots
            .iter()
            .filter_map(|r| PathBuf::from(r).canonicalize().ok())
            .collect();
    }
    let mut roots = Vec::new();
    for recent in &cfg.recent_projects {
        if let Ok(p) = PathBuf::from(recent).canonicalize() {
            if let Some(parent) = p.parent() {
                if !roots.iter().any(|r: &PathBuf| r == parent) {
                    roots.push(parent.to_path_buf());
                }
            }
        }
    }
    roots
}

/// Vérifie qu'un chemin se trouve dans l'une des racines autorisées (booléen).
fn validate_within_roots(path: &str, roots: &[PathBuf]) -> bool {
    if is_unc_path(path) {
        return false;
    }
    let canon = match PathBuf::from(path).canonicalize() {
        Ok(c) => c,
        Err(_) => return false,
    };
    roots.iter().any(|r| canon.starts_with(r))
}

/// Version Result de validate_within_roots (retourne le chemin canonique).
fn validate_within_roots_canon(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    if is_unc_path(path) {
        return Err("Chemin UNC refusé".to_string());
    }
    let canon = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("Chemin invalide: {}", e))?;
    if !roots.iter().any(|r| canon.starts_with(r)) {
        return Err("Hors des racines autorisées".to_string());
    }
    Ok(canon)
}