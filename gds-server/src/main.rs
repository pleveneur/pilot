//! `gds-server` — binaire serveur GDS autonome (headless).
//!
//! Démarrage autonome (réfonte GDS, micro-tâche L2.1) : le service lit
//! l'environnement (via le socle partagé `gds_core::config::ServerConfig`),
//! ouvre le pool PostgreSQL **avec reprise** tant que la base n'est pas prête,
//! applique les migrations embarquées, monte le routeur partagé du socle
//! (`gds_core::http::server_router`) et écoute sur l'adresse donnée par
//! `GDS_HTTP_BIND`.
//!
//! Ce binaire ne dépend ni de Tauri, ni de ses plugins, ni de `wry` : il est
//! destiné au conteneur tout-en-un (lot L2).
//!
//! Hors périmètre de L2.1 (micro-tâches suivantes) : routes de santé (`L2.2`),
//! initialisation de la base (`L2.3`), compte admin (`L2.4`), clés SSH
//! (`L2.5`/`L2.6`), supervision (`L2.7`), conteneur (`L2.8`).

mod config;

use gds_core::audit::WebAudit;
use gds_core::auth::WebAuth;
use gds_core::config::ServerConfig;
use gds_core::http::{server_router, ServerCtx};
use gds_core::rate::WebGuard;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("gds-server : démarrage impossible : {}", e);
        std::process::exit(1);
    }
}

/// Séquence de démarrage complète, isolée de `main` pour être lisible et
/// laisser `main` ne gérer que l'issue du processus.
async fn run() -> Result<(), String> {
    // 1. Configuration du service (environnement uniquement).
    let cfg = ServerConfig::from_env()?;

    // 2. Pool PostgreSQL avec reprise (attente progressive tant que la base
    //    n'accepte pas les connexions — cas normal au premier démarrage du
    //    conteneur, PostgreSQL démarrant en parallèle).
    let options = config::pg_options(&cfg);
    let pool = config::retry_with_delays(&config::startup_delays(), |attempt| {
        let options = options.clone();
        async move {
            match config::open_pool(options).await {
                Ok(pool) => Ok(pool),
                Err(e) => {
                    // Trace de progression : le conteneur démarre PostgreSQL en
                    // parallèle, l'absence de base au premier instant est normale.
                    eprintln!(
                        "gds-server : base de données non prête (tentative {}) : {}",
                        attempt + 1,
                        e
                    );
                    Err(e)
                }
            }
        }
    })
    .await?;

    // 3. Migrations embarquées (idempotent).
    gds_core::db::migrate(&pool).await?;

    // 4. Contexte autonome du service, puis montage du routeur partagé du socle.
    let ctx = Arc::new(ServerCtx {
        pool,
        auth: Arc::new(WebAuth::new()),
        guard: Arc::new(WebGuard::new()),
        audit: Arc::new(WebAudit::new()),
    });
    let app = server_router(ctx);

    // 5. Écoute HTTP sur l'adresse donnée par l'environnement.
    let listener = tokio::net::TcpListener::bind(&cfg.http_bind)
        .await
        .map_err(|e| format!("écoute HTTP sur {} impossible : {}", cfg.http_bind, e))?;
    println!("gds-server : à l'écoute sur {}", cfg.http_bind);
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("serveur HTTP : {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use gds_core::http::GdsCtx;
    use sqlx::PgPool;
    use tower::ServiceExt;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};

    /// Contexte minimal sans base : `pool()` échoue toujours, mais le routeur
    /// (et donc la couche d'authentification) est bien monté. Ce contexte ne
    /// sert qu'à vérifier le **montage**, pas le comportement des handlers.
    struct NullCtx {
        auth: Arc<WebAuth>,
        guard: Arc<WebGuard>,
        audit: Arc<WebAudit>,
    }

    impl GdsCtx for NullCtx {
        fn pool(&self) -> Result<PgPool, String> {
            Err("test : pas de base de données".to_string())
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

    fn null_ctx() -> Arc<NullCtx> {
        Arc::new(NullCtx {
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
        })
    }

    /// Le routeur du service monte bien le **routeur partagé du socle** et le
    /// protège : une requête non authentifiée sur une route partagée est
    /// rejetée en 401 **avant** tout accès au pool. Un montage manquant
    /// donnerait 404 ; ce test ne touche à aucune base de données.
    #[tokio::test]
    async fn server_router_mounts_shared_routes_behind_auth() {
        let app = server_router(null_ctx());
        let res = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/gds/projects")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    /// Plusieurs routes du routeur partagé sont présentes (une route absente
    /// répondrait 404, pas 401) : la couche d'authentification s'applique avant
    /// le routage, donc on vérifie que le chemin est bien couvert par le
    /// routeur monté et non par le fallback.
    #[tokio::test]
    async fn server_router_covers_several_shared_routes() {
        for uri in ["/api/gds/users/login", "/api/gds/git-repos", "/api/gds/tickets"] {
            let app = server_router(null_ctx());
            let res = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "route {}", uri);
        }
    }
}
