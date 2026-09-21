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
//! (`L2.3`), compte admin (`L2.4`), supervision (`L2.7`), conteneur (`L2.8`).
//! L2.2 (routes de santé publique et d'état administrateur) est monté par
//! `gds_core::http::server_router`.
//!
//! Initialisation de la base (micro-tâche L2.3) : `gds-server --init-db` prépare
//! la base à partir d'un cluster **vide** (création du rôle et de la base
//! applicative si absents, via `gds_core::db::provision_with`, puis application
//! des migrations embarquées) et rend la main. L'entrypoint du conteneur appelle
//! ce mode AVANT de lancer le service ; l'opération est idempotente, donc un
//! second démarrage conserve les données du volume.
//!
//! Dépôts git dans le conteneur (micro-tâches L2.5 et L2.6) : `gds-server --init-ssh`
//! prépare le compte système `git` (sans mot de passe utilisable), son dossier
//! de clefs `~git/.ssh` (700) et son fichier `authorized_keys` (600), crée la
//! **racine des dépôts** (`GDS_REPOS_ROOT`, volume) au nom de `git`, **restreint
//! la coquille de connexion du compte `git` à `git-shell`** (aucun shell
//! généraliste ouvert), **matérialise les dépôts bare annoncés en base**
//! (équivalent automatique du `git init --bare` manuel) et **régénère** le
//! fichier des clefs autorisées **depuis la base** (source de vérité : les clefs
//! enregistrées deviennent utilisables, les clefs révoquées disparaissent).
//! Comme le poste enregistre clefs et projets **directement en base** (décision
//! 11, aucune notification possible), le service repasse ces opérations
//! **périodiquement** en tâche de fond (`maintenance_job`,
//! `SSH_KEYS_REFRESH_INTERVAL`). La matière première du dépôt bare est la table
//! `git_repos` ; la création réutilise le code existant (`git_init_bare`, le même
//! que `add_project`) et vise `<racine>/<projet>.git` (spec §2.3/§2.4).
//!
//! Le **service SSH** lui-même (sshd_config, clefs d'hôte sur volume, coquille
//! `git-shell` côté démon, démarrage de sshd) est du ressort de `entrypoint.sh` ;
//! la supervision de processus et l'assemblage de l'image restent hors de ces
//! micro-tâches (L2.7, L2.8).

mod config;

use gds_core::audit::WebAudit;
use gds_core::auth::WebAuth;
use gds_core::config::ServerConfig;
use gds_core::http::{server_router, ServerCtx};
use gds_core::rate::WebGuard;
use gds_core::server_status;
use std::sync::Arc;
use std::time::Duration;

/// Option de démarrage reconnue : prépare la base puis rend la main (appelée par
/// l'entrypoint du conteneur, cf. « Initialisation de la base » ci-dessus).
const INIT_DB_FLAG: &str = "--init-db";

/// Option de démarrage reconnue : prépare le compte `git`, la racine des dépôts,
/// la restriction du compte à `git-shell` et les clefs autorisées, puis rend la
/// main (L2.5/L2.6, appelée par l'entrypoint APRÈS `--init-db` et AVANT le
/// lancement du service).
const INIT_SSH_FLAG: &str = "--init-ssh";

/// Intervalle du job serveur de maintenance (L2.5/L2.6) : rafraîchissement du
/// fichier des clefs autorisées ET matérialisation des dépôts bare annoncés en
/// base. Le poste enregistre clefs et projets **directement en base** : le
/// service ne peut pas être notifié, il repasse donc périodiquement. Les deux
/// opérations sont idempotentes (aucune écriture tant que la base ne change pas),
/// donc ce cycle ne produit ni duplication ni corruption. La route
/// d'administration `POST /api/gds/admin/ssh-keys/refresh` permet un
/// rafraîchissement immédiat des clefs (L2.5).
const SSH_KEYS_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

/// Modes de démarrage du binaire (dispatch pur — testable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupMode {
    /// Service HTTP (mode par défaut).
    Serve,
    /// `--init-db` : prépare la base puis rend la main (L2.3).
    InitDb,
    /// `--init-ssh` : prépare les dépôts git puis rend la main (L2.5).
    InitSsh,
}

/// Détermine le mode de démarrage à partir des arguments (pure — testable).
/// `--init-db` est prioritaire (l'entrypoint appelle de toute façon les deux
/// modes séparément). Un argument inconnu est ignoré (comportement inchangé).
fn startup_mode<I, A>(args: I) -> StartupMode
where
    I: IntoIterator<Item = A>,
    A: AsRef<str>,
{
    let mut mode = StartupMode::Serve;
    for arg in args {
        match arg.as_ref() {
            INIT_DB_FLAG => return StartupMode::InitDb,
            INIT_SSH_FLAG => mode = StartupMode::InitSsh,
            _ => {}
        }
    }
    mode
}

#[tokio::main]
async fn main() {
    match startup_mode(std::env::args().skip(1)) {
        StartupMode::InitDb => {
            if let Err(e) = init_db().await {
                eprintln!("gds-server : initialisation de la base impossible : {}", e);
                std::process::exit(1);
            }
            return;
        }
        StartupMode::InitSsh => {
            if let Err(e) = init_ssh().await {
                eprintln!("gds-server : préparation des dépôts git impossible : {}", e);
                std::process::exit(1);
            }
            return;
        }
        StartupMode::Serve => {}
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

/// Prépare les dépôts git du service à partir du conteneur (micro-tâches L2.5 et
/// L2.6) :
///
/// 1. compte système `git` (sans mot de passe utilisable : l'accès se fait par
///    clef), dossier de clefs `~git/.ssh` en **700** et fichier
///    `~git/.ssh/authorized_keys` en **600** (droits exigés par sshd) ;
/// 2. **racine des dépôts** (`GDS_REPOS_ROOT`, volume) créée puis confiée à
///    `git` ;
/// 3. compte `git` **restreint à `git-shell`** (L2.6) : le service SSH ne sert
///    que les dépôts, jamais une session interactive généraliste ;
/// 4. **régénération** du fichier des clefs autorisées **depuis la base** : les
///    clefs enregistrées deviennent utilisables, les clefs révoquées
///    disparaissent. L'opération est idempotente (un fichier déjà conforme n'est
///    pas réécrit) ;
/// 5. **matérialisation des dépôts bare annoncés en base** (L2.6) : c'est
///    l'équivalent automatique du `git init --bare` manuel, le poste écrivant le
///    projet directement en base. Le service le refait de toute façon
///    périodiquement en marche (voir `maintenance_job`).
///
/// Appelé par `entrypoint.sh` à chaque démarrage, avant le lancement du service.
/// Le **service SSH** lui-même (sshd_config, clefs d'hôte, démarrage de sshd) est
/// préparé par `entrypoint.sh` : rien de tel ici.
async fn init_ssh() -> Result<(), String> {
    let cfg = ServerConfig::from_env()?;

    // 1-2. Compte système, dossier/fichier de clefs, racine des dépôts.
    let report = gds_core::ssh::provision_git_account(&cfg.repos_root)?;
    for line in report.summary_lines() {
        println!("gds-server : {}", line);
    }

    // 3. Compte `git` restreint à la coquille git (L2.6) : le service SSH ne
    //    sert que les dépôts, jamais une session interactive. Un échec ici
    //    laisserait un shell généraliste ouvert sur le serveur → refus explicite.
    let shell = gds_core::ssh::restrict_git_account_to_git_shell()?;
    for line in shell.summary_lines() {
        println!("gds-server : {}", line);
    }

    // 4-5. Fichier des clefs autorisées régénéré puis dépôts bare matérialisés,
    //      depuis la base (source de vérité).
    let pool = config::open_pool_with_retry(config::pg_options(&cfg), "base applicative").await?;
    let sync = gds_core::ssh::regenerate_authorized_keys(&pool).await?;
    println!(
        "gds-server : clefs autorisées : {} clef(s) dans {} ({})",
        sync.keys,
        gds_core::ssh::authorized_keys_path(),
        if sync.rewritten {
            "fichier régénéré"
        } else {
            "fichier déjà conforme"
        }
    );
    let bares = gds_core::git::ensure_project_bares(&pool, &cfg.repos_root).await?;
    for line in bares.summary_lines() {
        println!("gds-server : {}", line);
    }
    pool.close().await;
    Ok(())
}

/// Job serveur de maintenance (L2.5 et L2.6) : tant que le service tourne,
/// régénère `~git/.ssh/authorized_keys` **depuis la base** (premier passage
/// immédiat au démarrage, puis `SSH_KEYS_REFRESH_INTERVAL`) et **matérialise**
/// les dépôts bare annoncés en base. Le poste enregistrant clefs et projets
/// directement en base, ce cycle est le seul moyen d'appliquer une nouvelle clef
/// (ou un retrait) et de créer le dépôt d'un projet ajouté pendant la vie du
/// conteneur, sans attendre un redémarrage.
///
/// Toute erreur est journalisée puis ignorée : ni le fichier des clefs ni un
/// dépôt manquant ne sont critiques pour l'API, et rien de tout cela ne doit
/// **jamais** arrêter le service.
async fn maintenance_job(pool: sqlx::PgPool, repos_root: String) {
    loop {
        match gds_core::ssh::regenerate_authorized_keys(&pool).await {
            Ok(sync) if sync.rewritten => println!(
                "gds-server : clefs autorisées régénérées ({} clef(s))",
                sync.keys
            ),
            Ok(_) => {}
            Err(e) => {
                eprintln!("gds-server : régénération des clefs autorisées ignorée : {}", e)
            }
        }
        match gds_core::git::ensure_project_bares(&pool, &repos_root).await {
            Ok(bares) if !bares.created.is_empty() => println!(
                "gds-server : dépôts bare créés : {}",
                bares.created.join(", ")
            ),
            Ok(_) => {}
            Err(e) => {
                eprintln!("gds-server : matérialisation des dépôts bare ignorée : {}", e)
            }
        }
        tokio::time::sleep(SSH_KEYS_REFRESH_INTERVAL).await;
    }
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

    // 3b. Journaux de démarrage attendus par l'exploitation (L2.7, conteneur
    //     supervisé) : la base est prête, la version de migration atteinte est
    //     annoncée, et l'état du compte administrateur est dit EXPLICITEMENT.
    //     Tant qu'aucun administrateur n'existe, l'initialisation
    //     (`POST /api/gds/setup`, L2.4) reste à faire : le journal le signale,
    //     pour qu'un service « sans compte » ne passe jamais inaperçu. Le
    //     message nomme la route à utiliser, mais ne contient aucun secret.
    println!("gds-server : base prête");
    println!(
        "gds-server : migrations appliquées jusqu'à la version {:04}",
        server_status::applied_migration(&pool).await?
    );
    match gds_core::db::count_admins(&pool).await {
        Ok(0) => println!(
            "gds-server : administrateur en attente d'initialisation (POST /api/gds/setup)"
        ),
        Ok(n) => println!("gds-server : administrateur déjà initialisé ({} compte(s))", n),
        // Un état inconnu n'empêche pas le service de démarrer, mais il est dit.
        Err(e) => eprintln!("gds-server : état des administrateurs inconnu : {}", e),
    }

    // 4. Contexte autonome du service, puis montage du routeur partagé du socle.
    let keys_pool = pool.clone();
    let ctx = Arc::new(ServerCtx {
        pool,
        auth: Arc::new(WebAuth::new()),
        guard: Arc::new(WebGuard::new()),
        audit: Arc::new(WebAudit::new()),
        // Racine des dépôts bare : volume supervisé par la route d'état (L2.2).
        repos_root: cfg.repos_root.clone().into(),
    });
    // 4b. Job serveur de maintenance (L2.5/L2.6) : rafraîchissement du fichier
    //     des clefs autorisées ET matérialisation des dépôts bare annoncés en
    //     base. Le poste enregistre clefs et projets sans pouvoir notifier le
    //     service, d'où ce repassage périodique. Une erreur du job n'arrête
    //     jamais le service.
    tokio::spawn(maintenance_job(keys_pool, cfg.repos_root.clone()));
    let app = server_router(ctx);

    // 5. Écoute HTTP sur l'adresse donnée par l'environnement.
    let listener = tokio::net::TcpListener::bind(&cfg.http_bind)
        .await
        .map_err(|e| format!("écoute HTTP sur {} impossible : {}", cfg.http_bind, e))?;
    println!("gds-server : à l'écoute sur {}", cfg.http_bind);
    // `into_make_service_with_connect_info` est **nécessaire** : `auth_middleware`,
    // `gds_register`, `gds_login` et `gds_setup` extraient
    // `ConnectInfo<SocketAddr>` (IP source pour le rate limiting et l'audit).
    // Sans lui, ces routes répondraient 500 au lieu de 200/401/400 (le poste,
    // lui, passe déjà par `into_make_service_with_connect_info`).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .map_err(|e| format!("serveur HTTP : {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use gds_core::http::GdsCtx;
    use sqlx::postgres::PgConnectOptions;
    use sqlx::PgPool;
    use std::str::FromStr;
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
    ///
    /// L2.4 : `/api/gds/users/login` a quitté cette liste — la connexion doit
    /// précéder l'authentification (elle délivre le premier jeton) et est
    /// désormais publique (cf. `login_route_is_public`).
    #[tokio::test]
    async fn server_router_covers_several_shared_routes() {
        for uri in ["/api/gds/git-repos", "/api/gds/tickets"] {
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

    /// Adresse source injectée dans les requêtes de test : en production elle
    /// est posée par `into_make_service_with_connect_info` (cf. `run`).
    fn test_addr() -> std::net::SocketAddr {
        std::net::SocketAddr::from(([127, 0, 0, 1], 4242))
    }

    /// `POST /api/gds/setup` (email + mot de passe choisis, L2.4).
    fn setup_request(email: &str, password: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/api/gds/setup")
            .header("content-type", "application/json")
            .extension(ConnectInfo(test_addr()))
            .body(Body::from(
                serde_json::json!({ "email": email, "password": password }).to_string(),
            ))
            .unwrap()
    }

    /// `POST /api/gds/users/login`.
    fn login_request(email: &str, password: &str) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri("/api/gds/users/login")
            .header("content-type", "application/json")
            .extension(ConnectInfo(test_addr()))
            .body(Body::from(
                serde_json::json!({ "email": email, "password": password }).to_string(),
            ))
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

    // ── L2.4 — initialisation du compte administrateur ──

    /// L2.4 — l'initialisation est **publique** : sans jeton, la requête atteint
    /// le handler (ici le pool est absent → 500 « base injoignable » et aucune
    /// création). Un montage manquant répondrait 404 et un montage derrière
    /// l'authentification répondrait 401 : l'un comme l'autre rendrait le
    /// premier démarrage impossible (aucun jeton ne peut exister avant que le
    /// premier compte ne soit créé). Ce test ne touche à aucune base.
    #[tokio::test]
    async fn setup_route_is_public() {
        let app = server_router(null_ctx());
        let res = app
            .oneshot(setup_request("owner@gds.test", "mot-de-passe-choisi"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let value = json_body(res).await;
        assert!(
            value.get("error").is_some(),
            "réponse d'erreur attendue, obtenue : {}",
            value
        );
    }

    /// L2.4 — la **connexion** est publique : sans jeton, la requête atteint le
    /// handler (pool absent → 500 « base injoignable »). Derrière
    /// l'authentification, elle répondrait 401 et **aucun jeton ne pourrait
    /// jamais être obtenu** ; absente, elle répondrait 404.
    #[tokio::test]
    async fn login_route_is_public() {
        let app = server_router(null_ctx());
        let res = app
            .oneshot(login_request("owner@gds.test", "mot-de-passe-choisi"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    /// L2.4 — **bout en bout sur une base réelle jetable** (facultatif) :
    /// initialisation (200, un seul administrateur, mot de passe **choisi**),
    /// second appel (409), connexion avec le mot de passe saisi (200 + jeton
    /// portant le rôle), connexion avec un autre mot de passe (401), puis route
    /// d'administration ouverte par ce jeton (200).
    ///
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test ne s'exécute pas (CI verte).
    /// L'URL doit désigner une base **jetable** `pilot_gds_test_*` : le test ne
    /// la supprime pas, mais remet la table `users` dans son état initial (il est
    /// ainsi rejouable).
    #[tokio::test]
    async fn setup_then_login_then_admin_route() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "setup_then_login_then_admin_route: \
                     PILOT_GDS_HTTP_TEST_URL absente — test ignoré"
                );
                return;
            }
        };
        let opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_HTTP_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let db_name = opts.get_database().unwrap_or("").to_string();
        if !db_name.starts_with("pilot_gds_test_") {
            eprintln!(
                "REFUS: PILOT_GDS_HTTP_TEST_URL doit viser une base jetable \
                 `pilot_gds_test_*` (base visée : {:?}) — test ignoré",
                db_name
            );
            return;
        }

        let pool = gds_core::db::connect(&url)
            .await
            .expect("connexion à la base de test");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base de test");
        // État initial : aucun compte (le test est rejouable tel quel).
        sqlx::query("DELETE FROM users")
            .execute(&pool)
            .await
            .expect("remise à zéro de la table users");

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: std::env::temp_dir(),
        });
        let app = server_router(ctx);
        let email = "owner-l24@gds.test";
        let password = "mot-de-passe-choisi-l24";

        // 1) Aucun administrateur : le premier appel crée le compte.
        assert_eq!(gds_core::db::count_admins(&pool).await.unwrap(), 0);
        let res = app
            .clone()
            .oneshot(setup_request(email, password))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["ok"], serde_json::json!(true));
        assert_eq!(value["email"], serde_json::json!(email));
        assert!(
            !value.to_string().contains(password),
            "la réponse ne doit jamais contenir le mot de passe"
        );
        assert_eq!(
            gds_core::db::count_admins(&pool).await.unwrap(),
            1,
            "exactement un administrateur"
        );

        // 2) Second appel : refusé (409), aucun second compte.
        let res = app
            .clone()
            .oneshot(setup_request("autre@gds.test", "encore-un-autre"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(gds_core::db::count_admins(&pool).await.unwrap(), 1);

        // 3) Connexion avec le mot de passe SAISI : jeton portant le rôle.
        let res = app
            .clone()
            .oneshot(login_request(email, password))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["role"], serde_json::json!("admin"));
        let token = value["token"]
            .as_str()
            .expect("jeton de session délivré par la connexion")
            .to_string();
        assert!(!token.is_empty());

        // 4) Un AUTRE mot de passe est refusé (c'est bien celui saisi qui compte).
        let res = app
            .clone()
            .oneshot(login_request(email, "mot-de-passe-errone"))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

        // 5) Ce jeton ouvre la route réservée au rôle `admin`.
        let res = app.clone().oneshot(bearer(&token)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // Nettoyage : la base jetable revient à son état initial.
        sqlx::query("DELETE FROM users")
            .execute(&pool)
            .await
            .expect("nettoyage de la table users");
        pool.close().await;
    }

    // ── L2.5 — dépôts git dans le conteneur ──

    /// `POST /api/gds/admin/ssh-keys/refresh` avec un jeton éventuel.
    fn refresh_request(token: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .method("POST")
            .uri("/api/gds/admin/ssh-keys/refresh");
        if let Some(t) = token {
            builder = builder.header("authorization", format!("Bearer {}", t));
        }
        builder.body(Body::empty()).unwrap()
    }

    /// Le binaire reconnaît les modes de démarrage attendus par l'entrypoint
    /// (`--init-db` en L2.3, `--init-ssh` en L2.5) et sert par défaut.
    #[test]
    fn startup_mode_selects_the_expected_mode() {
        assert_eq!(startup_mode(Vec::<String>::new()), StartupMode::Serve);
        assert_eq!(startup_mode(["--init-db"]), StartupMode::InitDb);
        assert_eq!(startup_mode(["--init-ssh"]), StartupMode::InitSsh);
        // `--init-db` reste prioritaire si les deux modes sont fournis.
        assert_eq!(
            startup_mode(["--init-ssh", "--init-db"]),
            StartupMode::InitDb
        );
        // Argument inconnu ignoré : le service démarre (comportement inchangé).
        assert_eq!(startup_mode(["--wat"]), StartupMode::Serve);
        // Les arguments réels de `std::env::args()` (String) sont acceptés.
        let args: Vec<String> = vec!["--init-ssh".to_string()];
        assert_eq!(startup_mode(args), StartupMode::InitSsh);
    }

    /// La route de rafraîchissement des clefs est montée derrière
    /// `require_admin` : sans jeton → 401, avec un jeton non administrateur →
    /// 403 (refus avant tout accès à la base), avec un jeton administrateur →
    /// 500 si la base est absente (la route existe : jamais 404).
    #[tokio::test]
    async fn ssh_keys_refresh_route_is_admin_only() {
        let app = server_router(null_ctx());
        let res = app.oneshot(refresh_request(None)).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

        let ctx = null_ctx();
        let dev = ctx
            .auth
            .create_session_as("dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app.oneshot(refresh_request(Some(&dev))).await.unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        let ctx = null_ctx();
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app.oneshot(refresh_request(Some(&admin))).await.unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
