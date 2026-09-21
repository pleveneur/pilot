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
//! Hors périmètre de L2.1 (micro-tâches suivantes) : initialisation de la base
//! (`L2.3`), compte admin (`L2.4`), clés SSH (`L2.5`/`L2.6`), supervision
//! (`L2.7`), conteneur (`L2.8`). L2.2 (routes de santé publique et d'état
//! administrateur) est monté par `gds_core::http::server_router`.
//!
//! Initialisation de la base (micro-tâche L2.3) : `gds-server --init-db` prépare
//! la base à partir d'un cluster **vide** (création du rôle et de la base
//! applicative si absents, via `gds_core::db::provision_with`, puis application
//! des migrations embarquées) et rend la main. L'entrypoint du conteneur appelle
//! ce mode AVANT de lancer le service ; l'opération est idempotente, donc un
//! second démarrage conserve les données du volume.

mod config;

use gds_core::audit::WebAudit;
use gds_core::auth::WebAuth;
use gds_core::config::ServerConfig;
use gds_core::http::{server_router, ServerCtx};
use gds_core::rate::WebGuard;
use gds_core::server_status;
use std::sync::Arc;

/// Option de démarrage reconnue : prépare la base puis rend la main (appelée par
/// l'entrypoint du conteneur, cf. « Initialisation de la base » ci-dessus).
const INIT_DB_FLAG: &str = "--init-db";

#[tokio::main]
async fn main() {
    if std::env::args().skip(1).any(|a| a == INIT_DB_FLAG) {
        if let Err(e) = init_db().await {
            eprintln!("gds-server : initialisation de la base impossible : {}", e);
            std::process::exit(1);
        }
        return;
    }
    if let Err(e) = run().await {
        eprintln!("gds-server : démarrage impossible : {}", e);
        std::process::exit(1);
    }
}

/// Prépare la base du service à partir d'un cluster vierge (L2.3) :
///
/// 1. pool d'**administration** sur la base de maintenance (compte
///    superutilisateur) puis `provision_with` — crée le rôle et la base
///    applicative s'ils sont absents, sans jamais recréer ni vider une base
///    existante (les données du volume sont conservées) ;
/// 2. pool **applicatif** (rôle dédié, non-superuser) puis `migrate` —
///    application des migrations embarquées, idempotente.
///
/// Les journaux montrent ce qui a réellement été créé puis la version de
/// migration atteinte (aucun secret n'y figure). Aucune autre étape de L2 n'est
/// faite ici : le compte administrateur relève de L2.4, les clés SSH de L2.5.
async fn init_db() -> Result<(), String> {
    let cfg = ServerConfig::from_env()?;

    // 1. Préparation du rôle + de la base (base de maintenance obligatoirement
    //    présente, contrairement à la base applicative au premier démarrage).
    let admin = config::open_pool_with_retry(
        config::admin_options(&cfg),
        "connexion d'administration",
    )
    .await?;
    let outcome =
        gds_core::db::provision_with(&admin, &cfg.db_name, &cfg.db_user, &cfg.db_password)
            .await?;
    if outcome.database_created {
        println!("gds-server : base « {} » créée", cfg.db_name);
    } else {
        println!(
            "gds-server : base « {} » déjà présente (données conservées)",
            cfg.db_name
        );
    }
    if outcome.role_created {
        println!("gds-server : rôle « {} » créé", cfg.db_user);
    } else {
        println!("gds-server : rôle « {} » déjà présent", cfg.db_user);
    }
    admin.close().await;

    // 2. Migrations embarquées, appliquées par le rôle applicatif.
    let pool = config::open_pool_with_retry(config::pg_options(&cfg), "base applicative").await?;
    let versions = gds_core::db::embedded_migration_versions();
    println!(
        "gds-server : migrations embarquées : {}",
        gds_core::db::format_migration_versions(&versions)
    );
    gds_core::db::migrate(&pool).await?;
    println!(
        "gds-server : migrations appliquées jusqu'à la version {:04}",
        server_status::applied_migration(&pool).await?
    );
    pool.close().await;
    Ok(())
}

/// Séquence de démarrage complète, isolée de `main` pour être lisible et
/// laisser `main` ne gérer que l'issue du processus.
async fn run() -> Result<(), String> {
    // 0. Horloge de démarrage : la route de santé (L2.2) expose la durée de
    //    fonctionnement du service depuis cet instant (posé une seule fois).
    server_status::mark_started();

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
        // Racine des dépôts bare : volume supervisé par la route d'état (L2.2).
        repos_root: cfg.repos_root.clone().into(),
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

    /// Corps JSON d'une réponse (petit, borné).
    async fn json_body(res: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(res.into_body(), 256 * 1024)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn bearer(token: &str) -> Request<Body> {
        Request::builder()
            .method("GET")
            .uri("/api/gds/admin/server")
            .header("authorization", format!("Bearer {}", token))
            .body(Body::empty())
            .unwrap()
    }

    /// L2.2 — la santé est **publique** : elle répond sans jeton, en 200, avec
    /// exactement les six champs attendus et aucune donnée sensible.
    #[tokio::test]
    async fn health_route_is_public_and_leaks_nothing() {
        let app = server_router(null_ctx());
        let res = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/gds/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let text = json_body(res).await.to_string();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let obj = value.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "git_repos",
                "migration_version",
                "projects",
                "uptime_seconds",
                "users",
                "version"
            ]
        );
        let lower = text.to_lowercase();
        for forbidden in ["password", "postgres", "secret", "/", "\\"] {
            assert!(!lower.contains(forbidden), "santé : fuite {:?} → {}", forbidden, text);
        }
    }

    /// L2.2 — l'état serveur exige un jeton : sans en-tête, 401 (le garde de
    /// rôle est atteint sans qu'aucune base ne soit touchée).
    #[tokio::test]
    async fn admin_status_requires_a_token() {
        let app = server_router(null_ctx());
        let res = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/gds/admin/server")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    /// L2.2 — un jeton **non administrateur** est refusé (403), et un jeton
    /// historique **sans rôle** aussi (fermé par défaut).
    #[tokio::test]
    async fn admin_status_forbids_non_admin_tokens() {
        for role in ["dev", "standard", ""] {
            let ctx = null_ctx();
            let token = ctx
                .auth
                .create_session_as(role, std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app.oneshot(bearer(&token)).await.unwrap();
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "rôle {:?}", role);
        }
    }

    /// L2.2 — un jeton **administrateur** franchit le garde : le handler rend la
    /// forme attendue (volumes + dernière entrée d'audit), la base étant absente
    /// les tailles de base et l'audit valent `null`.
    #[tokio::test]
    async fn admin_status_allows_an_admin_token() {
        let ctx = null_ctx();
        let token = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app.oneshot(bearer(&token)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("repos_bytes"));
        assert!(obj.contains_key("db_bytes"));
        assert!(obj.contains_key("last_audit"));
        assert_eq!(obj.len(), 3);
    }
}
