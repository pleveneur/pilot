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
use gds_core::config::{plan_bootstrap_admin, BootstrapAdminDecision, ServerConfig};
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

/// Fichier du journal d'audit **persistant** du service (L2.10). Réglable par
/// `GDS_AUDIT_FILE` ; la valeur par défaut vit sur le **volume du superviseur**
/// (`pilot-gds_supervisor` → `/var/log/supervisor`), qui survit au redémarrage
/// du service comme à la recréation du conteneur.
const DEFAULT_AUDIT_FILE: &str = "/var/log/supervisor/web_audit.jsonl";

/// Chemin du journal d'audit persistant (`GDS_AUDIT_FILE` sinon le défaut).
fn audit_file() -> std::path::PathBuf {
    std::env::var("GDS_AUDIT_FILE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(DEFAULT_AUDIT_FILE))
}

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
    //     Le comptage est conservé pour l'amorçage automatique ci-dessous
    //     (3c), afin de ne lire l'état qu'une seule fois.
    println!("gds-server : base prête");
    println!(
        "gds-server : migrations appliquées jusqu'à la version {:04}",
        server_status::applied_migration(&pool).await?
    );
    let admins = gds_core::db::count_admins(&pool).await;
    match &admins {
        Ok(0) => println!(
            "gds-server : administrateur en attente d'initialisation (POST /api/gds/setup)"
        ),
        Ok(n) => println!("gds-server : administrateur déjà initialisé ({} compte(s))", n),
        // Un état inconnu n'empêche pas le service de démarrer, mais il est dit.
        Err(e) => eprintln!("gds-server : état des administrateurs inconnu : {}", e),
    }

    // 3c. Amorçage automatique du premier administrateur (L2.4) : si
    //     `GDS_ADMIN_EMAIL` ET `GDS_ADMIN_PASSWORD` sont TOUTES DEUX
    //     renseignées, le compte est créé ici, au démarrage. Silencieux et sûr :
    //     rien n'est écrasé si un administrateur existe déjà, une seule variable
    //     déclenche un avertissement (jamais un arrêt), et un échec est
    //     journalisé sans empêcher le service de démarrer. La décision est PURE
    //     (`plan_bootstrap_admin`, testée sans base) ; la création réutilise
    //     `create_initial_admin`, qui porte déjà le verrou d'usage unique.
    //     Aucun mot de passe n'apparaît dans un journal.
    if let Ok(existing) = admins {
        match plan_bootstrap_admin(
            cfg.admin_email.as_deref(),
            cfg.admin_password.as_deref(),
            existing,
        ) {
            BootstrapAdminDecision::Create { email, password } => {
                match gds_core::db::create_initial_admin(&pool, &email, &password).await {
                    Ok(true) => {
                        println!("gds-server : administrateur initial créé ({})", email)
                    }
                    // Course bénigne : un administrateur est apparu entre le
                    // comptage et la création — rien n'est écrasé.
                    Ok(false) => println!(
                        "gds-server : administrateur déjà présent — amorçage sans effet"
                    ),
                    Err(e) => eprintln!(
                        "gds-server : création de l'administrateur initial ignorée : {}",
                        e
                    ),
                }
            }
            BootstrapAdminDecision::AlreadyInitialized => println!(
                "gds-server : administrateur déjà présent — GDS_ADMIN_EMAIL/GDS_ADMIN_PASSWORD ignorées"
            ),
            BootstrapAdminDecision::Incomplete => eprintln!(
                "gds-server : GDS_ADMIN_EMAIL et GDS_ADMIN_PASSWORD doivent être renseignées \
                 ENSEMBLE pour créer l'administrateur automatiquement — amorçage ignoré"
            ),
            BootstrapAdminDecision::NotRequested => {}
        }
    }

    // 4. Contexte autonome du service, puis montage du routeur partagé du socle.
    let keys_pool = pool.clone();
    // 4a. Journal d'audit PERSISTANT (L2.10) : sans fichier, les entrées ne
    //     vivraient qu'en mémoire et disparaîtraient au redémarrage — or c'est
    //     précisément l'action de service qu'on veut pouvoir tracer APRÈS coup.
    //     Le fichier vit sur le volume du superviseur (`/var/log/supervisor`) :
    //     il survit au redémarrage du service comme à la recréation du conteneur.
    let audit = Arc::new(WebAudit::new());
    audit.set_file(audit_file());
    let ctx = Arc::new(ServerCtx {
        pool,
        auth: Arc::new(WebAuth::new()),
        guard: Arc::new(WebGuard::new()),
        audit,
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
    use serde_json::json;

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

    /// Lot 2 « compte utilisateur » — les trois routes d'opérations projet du
    /// service : **sans jeton → 401**, **rôle insuffisant → 403**, **rôle
    /// attendu → handler atteint** (500 « pas de base », jamais 404 : une route
    /// absente serait un montage oublié) et **entrée invalide → 400 sans toucher
    /// à la base** (la validation précède la résolution du pool).
    ///
    /// Ne touche à aucune base : le pool du contexte échoue toujours.
    #[tokio::test]
    async fn project_operation_routes_check_auth_role_and_input() {
        let ctx = null_ctx();
        let admin = ctx.auth.create_session_as("admin", Duration::from_secs(60));
        let dev = ctx.auth.create_session_as("dev", Duration::from_secs(60));
        let standard = ctx.auth.create_session_as("standard", Duration::from_secs(60));
        // Identité de compte (`users.id`) : nécessaire pour enregistrer une clef.
        let dev_identified = ctx
            .auth
            .create_session_for(7, "dev", Duration::from_secs(60));
        let app = server_router(ctx);

        let key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==";
        let routes = [
            ("/api/gds/projects/create", json!({"name": "projet-l2"})),
            ("/api/gds/projects/repo-exists", json!({"name": "projet-l2"})),
            ("/api/gds/ssh-keys", json!({"public_key": key})),
        ];

        // 1) Aucun jeton : refus de la couche d'authentification, sur les trois.
        for (uri, body) in &routes {
            let res = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(*uri)
                        .header("content-type", "application/json")
                        .extension(ConnectInfo(test_addr()))
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "sans jeton : {}", uri);
        }

        // 2) Rôle `standard` : la création de projet est une écriture → 403.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/create",
                &standard,
                json!({"name": "projet-l2"}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "standard ne crée pas de projet");

        // 3) Rôle attendu (`admin`, puis `dev`) : le handler est bien atteint
        //    (le pool du contexte de test échoue → 500, pas 403 ni 404).
        for token in [&admin, &dev] {
            let res = app
                .clone()
                .oneshot(admin_json_request(
                    "POST",
                    "/api/gds/projects/create",
                    token,
                    json!({"name": "projet-l2"}),
                ))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "create: rôle attendu");
        }

        // 4) Lecture : `standard` y a droit (500 « pas de base », pas 403).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/repo-exists",
                &standard,
                json!({"name": "projet-l2"}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "repo-exists: lecture");

        // 5) Nom invalide (traversée de chemin) : 400 AVANT la base.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/repo-exists",
                &standard,
                json!({"name": "../secret"}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "nom de projet refusé");

        // 6) Clef SSH : session SANS identité → 403 (une clef sans
        //    propriétaire n'a pas de sens)…
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                &admin,
                json!({"public_key": key}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "clef sans identité");

        // 7) … clef invalide → 400…
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                &dev_identified,
                json!({"public_key": "ssh-ed25519"}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "clef invalide");

        // 8) … et clef valide pour un compte identifié → handler atteint (500).
        let res = app
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                &dev_identified,
                json!({"public_key": key}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "clef valide");
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

    /// L3.3 — la validation d'un compte (`POST /api/gds/users/validate`) est
    /// désormais une route **d'administration** : un jeton de rôle `dev` reçoit
    /// 403 (la limite V1 « tout client authentifié peut valider » est
    /// supprimée), un jeton historique **sans rôle** aussi (fermé par défaut),
    /// un jeton `admin` franchit le garde et **atteint le handler** (pool absent
    /// → 500, jamais 403 ni 404). Sans jeton : 401.
    #[tokio::test]
    async fn user_validate_route_is_admin_only() {
        let body = serde_json::json!({ "email": "pending-l33@gds.test" });

        // 1) Jeton non administrateur (dev) : refusé avant le handler → 403.
        for role in ["dev", "standard", ""] {
            let ctx = null_ctx();
            let token = ctx
                .auth
                .create_session_as(role, std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request(
                    "POST",
                    "/api/gds/users/validate",
                    &token,
                    body.clone(),
                ))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "rôle {:?}", role);
        }

        // 2) Jeton administrateur : le garde laisse passer, le handler est
        //    atteint et échoue faute de pool (500) — la route existe bien.
        let ctx = null_ctx();
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/users/validate",
                &admin,
                body.clone(),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);

        // 3) Sans jeton : 401 (le garde d'authentification s'applique d'abord).
        let app = server_router(null_ctx());
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/gds/users/validate")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    /// L3.4 — l'attribution d'un projet est une **écriture d'administration** :
    /// un jeton `dev` reçoit 403 (un non-admin ne peut pas s'attribuer un
    /// projet), un jeton `admin` franchit le garde et atteint le handler (pool
    /// absent → 500). Même règle pour le listing des membres.
    #[tokio::test]
    async fn project_assignment_routes_are_admin_only() {
        let body = serde_json::json!({ "project_id": 1, "email": "dev-l34@gds.test" });
        for uri in [
            "/api/gds/admin/projects/assign",
            "/api/gds/admin/projects/unassign",
        ] {
            let ctx = null_ctx();
            let dev = ctx
                .auth
                .create_session_for(7, "dev", std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request("POST", uri, &dev, body.clone()))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{}", uri);

            let ctx = null_ctx();
            let admin = ctx
                .auth
                .create_session_as("admin", std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request("POST", uri, &admin, body.clone()))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "{}", uri);
        }

        // Listing des membres : même garde.
        let members_uri = "/api/gds/admin/projects/members?project_id=1";
        let ctx = null_ctx();
        let dev = ctx
            .auth
            .create_session_for(7, "dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app
            .oneshot(admin_json_request(
                "GET",
                members_uri,
                &dev,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        let ctx = null_ctx();
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app
            .oneshot(admin_json_request(
                "GET",
                members_uri,
                &admin,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    // ── L3.5 — matrice des droits des écritures du suivi ──

    /// L3.5 — sur les routes d'**écriture** du suivi et des tickets, le rôle
    /// `standard` est **limité à la lecture** : refusé en 403 (jamais 500/404),
    /// tandis que `admin`, `dev` et la session historique (rôle vide) franchissent
    /// la garde et atteignent le handler (pool absent → 500). Les routes de
    /// **lecture** (`GET`) restent, elles, ouvertes au rôle `standard`.
    ///
    /// Note : `/api/gds/tickets/{id}/comments` et `.../status` sont déclarées
    /// avec la syntaxe `{id}` (axum 0.8) alors que le socle dépend d'axum 0.7
    /// (`:id`). Ces deux routes sont donc **inatteignables** (le segment est
    /// littéral) : défaut préexistant, hors périmètre de ce lot, à traiter
    /// séparément. La garde L3.5 y est néanmoins posée (défense en profondeur).
    #[tokio::test]
    async fn tracking_write_routes_deny_standard_role() {
        let ttl = std::time::Duration::from_secs(60);
        let write_routes: [(&str, &str, serde_json::Value); 9] = [
            (
                "POST",
                "/api/gds/tracking/clients",
                serde_json::json!({ "name": "client-l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/clients/delete",
                serde_json::json!({ "name": "client-l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/projects",
                serde_json::json!({ "path": "/tmp/l35", "name": "l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/projects/delete",
                serde_json::json!({ "path": "/tmp/l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/tasks",
                serde_json::json!({ "id": 1, "project_id": 1, "title": "t-l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/tasks/delete",
                serde_json::json!({ "id": 1 }),
            ),
            (
                "POST",
                "/api/gds/tracking/decisions",
                serde_json::json!({ "id": 1, "summary": "d-l35" }),
            ),
            (
                "POST",
                "/api/gds/tracking/decisions/delete",
                serde_json::json!({ "id": 1 }),
            ),
            (
                "POST",
                "/api/gds/tickets",
                serde_json::json!({ "title": "ticket-l35" }),
            ),
        ];

        for (method, uri, body) in write_routes {
            // 1) Rôle standard : refus 403, avant tout accès au pool.
            let ctx = null_ctx();
            let standard = ctx.auth.create_session_as("standard", ttl);
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request(method, uri, &standard, body.clone()))
                .await
                .unwrap();
            assert_eq!(
                res.status(),
                StatusCode::FORBIDDEN,
                "standard {} {}",
                method,
                uri
            );

            // 2) Rôles autorisés : le handler est atteint (500), pas 403/404.
            for role in ["admin", "dev", ""] {
                let ctx = null_ctx();
                let token = ctx.auth.create_session_as(role, ttl);
                let app = server_router(ctx);
                let res = app
                    .oneshot(admin_json_request(method, uri, &token, body.clone()))
                    .await
                    .unwrap();
                assert_eq!(
                    res.status(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "rôle {:?} {} {}",
                    role,
                    method,
                    uri
                );
            }
        }

        // 3) Lecture : le rôle standard conserve l'accès (500 = handler atteint).
        for uri in ["/api/gds/tracking/clients", "/api/gds/tickets"] {
            let ctx = null_ctx();
            let standard = ctx.auth.create_session_as("standard", ttl);
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request(
                    "GET",
                    uri,
                    &standard,
                    serde_json::json!({}),
                ))
                .await
                .unwrap();
            assert_eq!(
                res.status(),
                StatusCode::INTERNAL_SERVER_ERROR,
                "lecture standard {}",
                uri
            );
        }
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

    /// Requête JSON authentifiée (jeton) vers `uri`, IP source de test.
    fn admin_json_request(
        method: &str,
        uri: &str,
        token: &str,
        body: serde_json::Value,
    ) -> Request<Body> {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", token))
            .extension(ConnectInfo(test_addr()))
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    /// Compteur de bases jetables du module de tests (évite toute collision de
    /// nom entre tests exécutés en parallèle).
    static HTTP_TEST_DB_SEQ: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    /// Base jetable du test HTTP : `DROP DATABASE` garanti au `Drop` (thread
    /// dédié, un `Drop` ne pouvant pas `.await`), sur le modèle de
    /// `GdsTestDbGuard` du socle. Indispensable pour que deux tests HTTP
    /// n'écrivent pas en parallèle dans la même table `users`.
    struct HttpTestDbGuard {
        admin_url: String,
        db_name: String,
    }

    impl Drop for HttpTestDbGuard {
        fn drop(&mut self) {
            let url = self.admin_url.clone();
            let name = self.db_name.clone();
            let _ = std::thread::spawn(move || {
                if let Ok(rt) = tokio::runtime::Runtime::new() {
                    let _ = rt.block_on(async move {
                        if let Ok(pool) = gds_core::db::connect(&url).await {
                            let _ = sqlx::query(
                                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                                 WHERE datname = $1 AND pid <> pg_backend_pid()",
                            )
                            .bind(&name)
                            .execute(&pool)
                            .await;
                            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", name))
                                .execute(&pool)
                                .await;
                            pool.close().await;
                        }
                    });
                }
            })
            .join();
        }
    }

    /// L3.2 — **scénario HTTP complet sur une base réelle jetable** (facultatif) :
    /// l'admin crée un compte, le liste (sans empreinte de mot de passe), change
    /// son rôle, réinitialise son mot de passe, le désactive — puis la connexion
    /// du compte est **REFUSÉE** (403). Vérifie aussi le garde-fou « dernier
    /// administrateur actif » (désactivation refusée en 409) et le refus d'un
    /// jeton non administrateur (403) sur la gestion des comptes.
    ///
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test ne s'exécute pas (CI verte).
    /// L'URL doit désigner une base **jetable** `pilot_gds_test_*`.
    #[tokio::test]
    async fn accounts_create_list_disable_then_login_refused() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "accounts_create_list_disable_then_login_refused: \
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

        // Base **dédiée** à ce test : créée ici, supprimée au Drop. Sans cela,
        // les deux tests HTTP écriraient en parallèle dans la même table
        // `users` de la base d'URL et se marcheraient dessus.
        let seq = HTTP_TEST_DB_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let test_db = format!("pilot_gds_test_http_{}_{}", std::process::id(), seq);
        let admin_pool = PgPool::connect(&url)
            .await
            .expect("connexion d'administration de la base de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création de la base jetable");
        let _guard = HttpTestDbGuard {
            admin_url: url.clone(),
            db_name: test_db.clone(),
        };

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts.clone().database(&test_db))
            .await
            .expect("connexion à la base jetable");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base jetable");

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: std::env::temp_dir(),
        });
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let dev = ctx
            .auth
            .create_session_as("dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let email = "compte-l32@gds.test";
        let password = "mot-de-passe-l32";
        let new_password = "mot-de-passe-l32-nouveau";

        // 1) Création par l'admin (compte directement ACTIF).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users",
                &admin,
                serde_json::json!({
                    "email": email, "name": "Compte L32",
                    "password": password, "role": "dev"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["role"], serde_json::json!("dev"));
        assert_eq!(value["status"], serde_json::json!("active"));
        assert!(
            !value.to_string().contains(password),
            "la réponse ne doit jamais contenir le mot de passe"
        );

        // 1 bis) Un rôle hors vocabulaire est refusé (400), aucun second compte.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users",
                &admin,
                serde_json::json!({
                    "email": "autre-l32@gds.test",
                    "password": "pw", "role": "root"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        // 2) Liste : le compte apparaît, sans empreinte de mot de passe.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/admin/users",
                &admin,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        let users = value["users"].as_array().expect("tableau users");
        assert_eq!(users.len(), 1, "un seul compte : {:?}", users);
        assert_eq!(users[0]["email"], serde_json::json!(email));
        assert_eq!(users[0]["role"], serde_json::json!("dev"));
        assert_eq!(users[0]["status"], serde_json::json!("active"));
        assert!(
            !value.to_string().contains("password_hash"),
            "l'empreinte de mot de passe ne doit pas sortir de la base"
        );

        // 3) La connexion du compte fonctionne (statut actif).
        let res = app
            .clone()
            .oneshot(login_request(email, password))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["role"], serde_json::json!("dev"));

        // 3 bis) Changement de rôle → `standard`, visible dans la liste.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users/role",
                &admin,
                serde_json::json!({ "email": email, "role": "standard" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["role"], serde_json::json!("standard"));

        // 3 ter) Réinitialisation du mot de passe : l'ancien ne vaut plus rien,
        // le nouveau ouvre le compte.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users/password",
                &admin,
                serde_json::json!({ "email": email, "password": new_password }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert!(
            !json_body(res).await.to_string().contains(new_password),
            "la réponse ne doit jamais contenir le mot de passe"
        );
        let res = app
            .clone()
            .oneshot(login_request(email, password))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let res = app
            .clone()
            .oneshot(login_request(email, new_password))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        // 4) Garde-fou « dernier administrateur actif » : un admin actif créé
        //    par l'admin ne peut pas être désactivé (409).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users",
                &admin,
                serde_json::json!({
                    "email": "dernier-admin-l32@gds.test",
                    "password": "pw-dernier-admin", "role": "admin"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(gds_core::db::count_active_admins(&pool).await.unwrap(), 1);
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users/status",
                &admin,
                serde_json::json!({
                    "email": "dernier-admin-l32@gds.test", "status": "disabled"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        let value = json_body(res).await;
        assert!(
            value["error"]
                .as_str()
                .unwrap_or("")
                .contains("dernier administrateur"),
            "message d'erreur inattendu : {}",
            value
        );
        assert_eq!(
            gds_core::db::count_active_admins(&pool).await.unwrap(),
            1,
            "l'administrateur actif doit être intact"
        );

        // 5) Désactivation du compte (autorisée) → sa connexion est REFUSÉE.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/users/status",
                &admin,
                serde_json::json!({ "email": email, "status": "disabled" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["status"], serde_json::json!("disabled"));
        let res = app
            .clone()
            .oneshot(login_request(email, new_password))
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "un compte désactivé ne doit plus pouvoir se connecter"
        );

        // 6) Un jeton non administrateur est refusé (403) sur la gestion des
        //    comptes (le garde `require_admin` s'applique).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/admin/users",
                &dev,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // Nettoyage : la base jetable est supprimée par son garde au Drop
        // (aucun `DELETE FROM users` nécessaire — elle est dédiée à ce test).
        pool.close().await;
        admin_pool.close().await;
    }

    // ── L4.4 / L4.5 — écran d'administration (projets, purge, journal, clefs) ──

    /// Requête GET authentifiée (jeton) vers `uri`, IP source de test.
    fn authed_get(uri: &str, token: &str) -> Request<Body> {
        Request::builder()
            .method("GET")
            .uri(uri)
            .header("authorization", format!("Bearer {}", token))
            .extension(ConnectInfo(test_addr()))
            .body(Body::empty())
            .unwrap()
    }

    /// Identifiants des projets renvoyés par `GET /api/gds/projects`.
    fn project_ids(value: &serde_json::Value) -> Vec<i64> {
        value["projects"]
            .as_array()
            .map(|a| a.iter().filter_map(|p| p["id"].as_i64()).collect())
            .unwrap_or_default()
    }

    /// Actions du journal, dans l'ordre renvoyé (les plus récentes d'abord).
    fn audit_actions(value: &serde_json::Value) -> Vec<String> {
        value["entries"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|e| e["action"].as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// L4.4 + L4.5 — **scénario HTTP complet sur une base réelle jetable**
    /// (facultatif) : attribution/retrait d'un projet (visibilité côté
    /// développeur), retrait avec purge **optionnelle** (le dépôt bare survit
    /// sans `purge`), journal d'audit (connexions + actions d'administration,
    /// paginé et filtrable) et révocation d'une clef SSH (supprimée en base et
    /// `authorized_keys` **régénéré immédiatement**).
    ///
    /// Tout passe par les **routes HTTP** du serveur, jamais par une connexion
    /// directe à la base du projet : c'est le contrat de l'écran d'administration.
    ///
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test ne s'exécute pas (CI verte).
    #[tokio::test]
    async fn admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end: \
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

        let seq = HTTP_TEST_DB_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let test_db = format!("pilot_gds_test_l45_{}_{}", std::process::id(), seq);
        let admin_pool = PgPool::connect(&url)
            .await
            .expect("connexion d'administration de la base de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création de la base jetable");
        let _guard = HttpTestDbGuard {
            admin_url: url.clone(),
            db_name: test_db.clone(),
        };

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts.clone().database(&test_db))
            .await
            .expect("connexion à la base jetable");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base jetable");

        // Racine de dépôts ET home `git` DÉDIÉS et jetables : la purge ne touche
        // que ce dossier, et `authorized_keys` n'est jamais écrit dans le vrai
        // `~git` de la machine de test (cf. `forced_git_user_home`).
        let sandbox = std::env::temp_dir().join(format!("pilot-l45-sandbox-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&sandbox);
        std::fs::create_dir_all(&sandbox).expect("bac à sable");
        let repos_root = sandbox.join("repos");
        std::fs::create_dir_all(&repos_root).expect("racine de dépôts");
        let repos_root_str = repos_root.to_string_lossy().to_string();
        let git_home = sandbox.join("git-home");
        std::fs::create_dir_all(&git_home).expect("home git jetable");
        let git_home_str = git_home.to_string_lossy().to_string();
        // Sûr ici : le test est facultatif (jamais exécuté en CI) et le binaire de
        // test est le seul à lire cette variable.
        std::env::set_var("PILOT_GIT_USER_HOME", &git_home_str);

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: repos_root.clone(),
        });

        // Comptes RÉELS (mot de passe haché) : la connexion emprunte la vraie
        // route, ce qui alimente le journal (`login`) et donne un `user_id` au
        // jeton — indispensable pour que la liste des projets soit filtrée.
        let admin_email = "admin-l45@gds.test";
        let admin_pw = "mot-de-passe-admin-l45";
        let dev_email = "dev-l45@gds.test";
        let dev_pw = "mot-de-passe-dev-l45";
        gds_core::db::create_user(
            &pool,
            admin_email,
            "Admin L45",
            &WebAuth::hash_password(admin_pw).unwrap(),
            "admin",
            "active",
        )
        .await
        .expect("admin de test");
        let dev_id = gds_core::db::create_user(
            &pool,
            dev_email,
            "Dev L45",
            &WebAuth::hash_password(dev_pw).unwrap(),
            "dev",
            "active",
        )
        .await
        .expect("dev de test");

        // Projet + dépôt bare réellement présents sur le disque.
        let project_id = gds_core::db::create_project(
            &pool,
            "projet-l45",
            "projet-l45.git",
            "",
            "",
            "active",
            "",
        )
        .await
        .expect("projet de test");
        let bare = gds_core::git::repo_bare_path(&repos_root_str, "projet-l45");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert!(bare.exists());

        let app = server_router(ctx.clone());

        // Connexions réelles des deux comptes.
        let res = app
            .clone()
            .oneshot(login_request(admin_email, admin_pw))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "connexion admin");
        let admin_token = json_body(res).await["token"]
            .as_str()
            .expect("jeton admin")
            .to_string();
        let res = app
            .clone()
            .oneshot(login_request(dev_email, dev_pw))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "connexion dev");
        let dev_token = json_body(res).await["token"]
            .as_str()
            .expect("jeton dev")
            .to_string();

        // 1) Sans attribution, le développeur ne voit PAS le projet.
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/projects", &dev_token))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let before = project_ids(&json_body(res).await);
        assert!(
            !before.contains(&project_id),
            "projet visible AVANT attribution : {:?}",
            before
        );

        // 2) Attribution par l'administrateur → le projet apparaît chez le dev.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/assign",
                &admin_token,
                serde_json::json!({ "project_id": project_id, "email": dev_email, "role": "dev" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/projects", &dev_token))
            .await
            .unwrap();
        let after = project_ids(&json_body(res).await);
        assert!(
            after.contains(&project_id),
            "projet invisible APRÈS attribution : {:?}",
            after
        );

        // 3) Retrait → il ne le voit plus.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/unassign",
                &admin_token,
                serde_json::json!({ "project_id": project_id, "email": dev_email }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/projects", &dev_token))
            .await
            .unwrap();
        let removed = project_ids(&json_body(res).await);
        assert!(
            !removed.contains(&project_id),
            "projet encore visible APRÈS retrait : {:?}",
            removed
        );

        // 4) Un jeton non administrateur ne peut PAS retirer un projet (403).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/remove",
                &dev_token,
                serde_json::json!({ "project_id": project_id }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // 5) Retrait SANS purge : rien n'est détruit sur le disque.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/remove",
                &admin_token,
                serde_json::json!({ "project_id": project_id }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["purged"], serde_json::json!(false));
        assert_eq!(value["name"], serde_json::json!("projet-l45"));
        assert!(
            bare.exists(),
            "le dépôt bare ne doit JAMAIS partir sans purge explicite"
        );
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/projects", &admin_token))
            .await
            .unwrap();
        assert!(!project_ids(&json_body(res).await).contains(&project_id));

        // 6) Retrait AVEC purge : le dépôt bare disparaît du disque.
        let project2 = gds_core::db::create_project(
            &pool,
            "projet-l45-b",
            "projet-l45-b.git",
            "",
            "",
            "active",
            "",
        )
        .await
        .expect("second projet de test");
        let bare2 = gds_core::git::repo_bare_path(&repos_root_str, "projet-l45-b");
        std::fs::create_dir_all(&bare2).unwrap();
        std::fs::write(bare2.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/remove",
                &admin_token,
                serde_json::json!({ "project_id": project2, "purge": true }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["purged"], serde_json::json!(true));
        assert!(
            !bare2.exists(),
            "la purge explicite doit détruire le dépôt bare"
        );
        // Le premier dépôt, lui, est toujours là (aucune purge en cascade).
        assert!(bare.exists());

        // 7) Journal : les connexions et les actions d'administration y figurent,
        //    les plus récentes d'abord, avec pagination et recherche.
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/admin/audit?limit=200", &admin_token))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let journal = json_body(res).await;
        let actions = audit_actions(&journal);
        for expected in [
            "login",
            "project_assign",
            "project_unassign",
            "project_remove",
            "project_remove_purge",
        ] {
            assert!(
                actions.iter().any(|a| a == expected),
                "action {:?} absente du journal : {:?}",
                expected,
                actions
            );
        }
        let pos = |a: &str| actions.iter().position(|x| x == a);
        assert!(
            pos("project_remove_purge").unwrap() < pos("login").unwrap(),
            "le journal doit être du plus récent au plus ancien : {:?}",
            actions
        );
        assert!(journal["total"].as_u64().unwrap() >= actions.len() as u64);
        // Chaque entrée porte l'IP source de la requête.
        assert!(!journal["entries"][0]["ip"].as_str().unwrap_or("").is_empty());

        // Pagination : une page d'une seule entrée.
        let res = app
            .clone()
            .oneshot(authed_get(
                "/api/gds/admin/audit?limit=1&offset=0",
                &admin_token,
            ))
            .await
            .unwrap();
        let page = json_body(res).await;
        assert_eq!(page["entries"].as_array().unwrap().len(), 1);
        assert_eq!(page["limit"], serde_json::json!(1));
        assert!(page["total"].as_u64().unwrap() >= 2);

        // Recherche libre : ne garde que les entrées correspondantes.
        let res = app
            .clone()
            .oneshot(authed_get(
                "/api/gds/admin/audit?q=project_remove_purge",
                &admin_token,
            ))
            .await
            .unwrap();
        let found = audit_actions(&json_body(res).await);
        assert!(
            !found.is_empty() && found.iter().all(|a| a == "project_remove_purge"),
            "recherche libre inefficace : {:?}",
            found
        );

        // Portée « tout le journal » acceptée (et au moins aussi large).
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/admin/audit?scope=all", &admin_token))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(json_body(res).await["scope"], serde_json::json!("all"));

        // 8) Clefs SSH : insertion, liste, révocation effective et fichier du
        //    serveur (`authorized_keys`) régénéré immédiatement.
        let key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL45KeyRevoked==";
        let key_id = gds_core::db::create_ssh_key(&pool, dev_id, key)
            .await
            .expect("clef de test");
        let auth_path = gds_core::ssh::authorized_keys_path_in(&git_home_str);
        gds_core::ssh::regenerate_authorized_keys(&pool)
            .await
            .expect("régénération initiale");
        assert!(
            std::fs::read_to_string(&auth_path)
                .unwrap()
                .contains("L45KeyRevoked"),
            "la clef enregistrée doit apparaître dans authorized_keys"
        );

        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/admin/ssh-keys", &admin_token))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let listed = json_body(res).await;
        let keys = listed["keys"].as_array().unwrap();
        assert!(keys.iter().any(|k| k["id"] == serde_json::json!(key_id)
            && k["email"] == serde_json::json!(dev_email)));
        // L'empreinte de mot de passe ne doit jamais sortir du serveur.
        assert!(!listed.to_string().contains("password_hash"));

        // Révocation d'une clef INEXISTANTE : 404, jamais une régénération muette.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/ssh-keys/revoke",
                &admin_token,
                serde_json::json!({ "id": key_id + 9999 }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);

        // Révocation réelle : la clef quitte la base ET le fichier du serveur.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/ssh-keys/revoke",
                &admin_token,
                serde_json::json!({ "id": key_id }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let revoked = json_body(res).await;
        assert_eq!(revoked["ok"], serde_json::json!(true));
        // `revoked` est le nombre de lignes supprimées (contrat de la route).
        assert_eq!(revoked["revoked"], serde_json::json!(1));
        assert_eq!(revoked["keys"], serde_json::json!(0));
        let left = gds_core::db::get_ssh_keys_by_user(&pool, dev_id)
            .await
            .unwrap();
        assert!(left.is_empty(), "clef encore en base : {:?}", left);
        let content = std::fs::read_to_string(&auth_path).unwrap_or_default();
        assert!(
            !content.contains("L45KeyRevoked"),
            "clef révoquée encore autorisée dans {} : {:?}",
            auth_path,
            content
        );
        assert!(content.trim().is_empty(), "authorized_keys doit être vide");

        // La révocation est elle aussi journalisée (portée par défaut).
        let res = app
            .clone()
            .oneshot(authed_get(
                "/api/gds/admin/audit?q=ssh_key_revoke",
                &admin_token,
            ))
            .await
            .unwrap();
        let found = audit_actions(&json_body(res).await);
        assert!(
            found.iter().any(|a| a == "ssh_key_revoke"),
            "révocation non journalisée : {:?}",
            found
        );

        // 9) L'espace occupé (dépôts + base) reste mesurable via la route d'état.
        let res = app.clone().oneshot(bearer(&admin_token)).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let status = json_body(res).await;
        assert!(status["repos_bytes"].as_u64().is_some());
        assert!(status["db_bytes"].as_u64().is_some());

        // Nettoyage : bac à sable jetable + base supprimée par le garde.
        let _ = std::fs::remove_dir_all(&sandbox);
        pool.close().await;
    }

    // ── Lot 2 « compte utilisateur » — opérations projet côté service ──

    /// **Scénario HTTP complet sur une base réelle jetable** (facultatif) :
    ///
    /// 1. l'administrateur **crée un projet et son dépôt bare** par le service
    ///    (le dépôt apparaît sur le disque, à l'emplacement attendu) ;
    /// 2. un second appel est **idempotent** (même `project_id`, pas de second
    ///    dépôt, `bare_created: false`) ;
    /// 3. l'existence du dépôt est interrogeable (présent / absent) et la
    ///    **lecture** est ouverte au rôle `standard`, alors que la **création**
    ///    lui est refusée (403) ;
    /// 4. la clef SSH du poste est rattachée au **compte porté par le jeton**
    ///    (jamais un email du corps), `authorized_keys` est régénéré, un second
    ///    enregistrement ne crée pas de doublon, et une session **sans
    ///    identité** est refusée (403).
    ///
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test ne s'exécute pas (CI verte).
    /// L'URL doit désigner une base **jetable** `pilot_gds_test_*`.
    #[tokio::test]
    async fn project_operations_create_repo_and_bind_key_to_connected_account() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "project_operations_create_repo_and_bind_key_to_connected_account: \
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

        let seq = HTTP_TEST_DB_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let test_db = format!("pilot_gds_test_l2_{}_{}", std::process::id(), seq);
        let admin_pool = PgPool::connect(&url)
            .await
            .expect("connexion d'administration de la base de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création de la base jetable");
        let _guard = HttpTestDbGuard {
            admin_url: url.clone(),
            db_name: test_db.clone(),
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts.clone().database(&test_db))
            .await
            .expect("connexion à la base jetable");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base jetable");

        // Bac à sable jetable : racine de dépôts ET home `git` dédiés, pour ne
        // jamais écrire dans le vrai `~git` de la machine de test.
        let sandbox = std::env::temp_dir().join(format!("pilot-l2-sandbox-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&sandbox);
        let repos_root = sandbox.join("repos");
        std::fs::create_dir_all(&repos_root).expect("racine de dépôts");
        let repos_root_str = repos_root.to_string_lossy().to_string();
        let git_home = sandbox.join("git-home");
        std::fs::create_dir_all(&git_home).expect("home git jetable");
        let git_home_str = git_home.to_string_lossy().to_string();
        std::env::set_var("PILOT_GIT_USER_HOME", &git_home_str);

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: repos_root.clone(),
        });

        // Comptes réels : la connexion passe par la vraie route et donne un
        // `user_id` au jeton — c'est lui qui porte l'identité (et le rôle).
        let admin_email = "admin-l2@gds.test";
        let dev_email = "dev-l2@gds.test";
        let std_email = "std-l2@gds.test";
        for (email, role, name, pw) in [
            (admin_email, "admin", "Admin L2", "mot-de-passe-admin-l2"),
            (dev_email, "dev", "Dev L2", "mot-de-passe-dev-l2"),
            (std_email, "standard", "Std L2", "mot-de-passe-std-l2"),
        ] {
            gds_core::db::create_user(
                &pool,
                email,
                name,
                &WebAuth::hash_password(pw).unwrap(),
                role,
                "active",
            )
            .await
            .expect("compte de test");
        }
        let app = server_router(ctx.clone());
        let mut tokens: Vec<String> = Vec::new();
        for (email, pw) in [
            (admin_email, "mot-de-passe-admin-l2"),
            (dev_email, "mot-de-passe-dev-l2"),
            (std_email, "mot-de-passe-std-l2"),
        ] {
            let res = app
                .clone()
                .oneshot(login_request(email, pw))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::OK, "connexion {}", email);
            tokens.push(
                json_body(res).await["token"]
                    .as_str()
                    .expect("jeton")
                    .to_string(),
            );
        }
        let (admin_token, dev_token, std_token) = (&tokens[0], &tokens[1], &tokens[2]);

        // 1) Création du projet + de son dépôt bare par le service.
        let expected = std::path::PathBuf::from(&repos_root_str).join("projet-l2.git");
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/create",
                admin_token,
                serde_json::json!({ "name": "projet-l2", "description": "lot 2" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "création du projet");
        let created = json_body(res).await;
        assert_eq!(created["ok"], serde_json::json!(true));
        assert_eq!(created["name"], serde_json::json!("projet-l2"));
        assert_eq!(created["bare_created"], serde_json::json!(true));
        let project_id = created["project_id"].as_i64().expect("project_id");
        assert_eq!(
            created["bare_path"].as_str().unwrap(),
            expected.to_string_lossy(),
            "le dépôt doit vivre dans la racine du service"
        );
        assert!(expected.join("HEAD").exists(), "dépôt bare absent du disque");

        // 2) Second appel : idempotent (même projet, même dépôt).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/create",
                admin_token,
                serde_json::json!({ "name": "projet-l2" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "seconde création");
        let again = json_body(res).await;
        assert_eq!(again["project_id"].as_i64(), Some(project_id));
        assert_eq!(again["bare_created"], serde_json::json!(false));
        let project_ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM projects WHERE name = $1")
            .bind("projet-l2")
            .fetch_all(&pool)
            .await
            .expect("comptage des projets");
        assert_eq!(project_ids, vec![project_id], "un seul projet en base");

        // 3) Existence du dépôt : lecture ouverte à tous, réponse exacte.
        for token in [&dev_token, &std_token] {
            let res = app
                .clone()
                .oneshot(admin_json_request(
                    "POST",
                    "/api/gds/projects/repo-exists",
                    token,
                    serde_json::json!({ "name": "projet-l2" }),
                ))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::OK);
            let value = json_body(res).await;
            assert_eq!(value["exists"], serde_json::json!(true));
            assert_eq!(value["in_db"], serde_json::json!(true));
            assert_eq!(value["on_disk"], serde_json::json!(true));
            assert_eq!(value["path"].as_str().unwrap(), expected.to_string_lossy());
        }
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/repo-exists",
                dev_token,
                serde_json::json!({ "name": "projet-inexistant-l2" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["exists"], serde_json::json!(false));
        assert_eq!(value["in_db"], serde_json::json!(false));

        // 4) Le rôle `standard` reste en lecture seule : création refusée.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/projects/create",
                std_token,
                serde_json::json!({ "name": "projet-interdit-l2" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert!(
            gds_core::db::get_project_by_name(&pool, "projet-interdit-l2")
                .await
                .unwrap()
                .is_none(),
            "le refus ne doit rien créer"
        );

        // 5) Clef SSH du poste : rattachée au compte du jeton, appliquée tout
        //    de suite au fichier `authorized_keys` du serveur.
        let key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL2PosteKey==";
        let auth_path = gds_core::ssh::authorized_keys_path_in(&git_home_str);
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                dev_token,
                serde_json::json!({ "public_key": key }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "enregistrement de la clef");
        let registered = json_body(res).await;
        assert_eq!(registered["created"], serde_json::json!(true));
        assert!(registered["fingerprint"].as_str().unwrap().starts_with("SHA256:"));
        // Aucun secret, aucun jeton dans la réponse.
        assert!(!registered.to_string().contains(dev_token));
        let key_id = registered["id"].as_i64().expect("id de clef");
        assert!(key_id > 0);
        let dev = gds_core::db::get_user_by_email(&pool, dev_email)
            .await
            .unwrap()
            .expect("compte dev");
        let keys = gds_core::db::get_ssh_keys_by_user(&pool, dev.id).await.unwrap();
        assert_eq!(keys.len(), 1, "une seule clef pour le compte connecté");
        assert!(keys[0].contains("L2PosteKey"), "clef en base : {:?}", keys[0]);
        let content = std::fs::read_to_string(&auth_path).unwrap_or_default();
        assert!(
            content.contains("L2PosteKey") && content.contains(dev_email),
            "authorized_keys non régénéré ({}): {:?}",
            auth_path,
            content
        );

        // 6) Second enregistrement de la MÊME clef : aucun doublon.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                dev_token,
                serde_json::json!({ "public_key": key }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let second = json_body(res).await;
        assert_eq!(second["created"], serde_json::json!(false));
        assert_eq!(second["id"].as_i64(), Some(key_id));
        assert_eq!(
            gds_core::db::get_ssh_keys_by_user(&pool, dev.id)
                .await
                .unwrap()
                .len(),
            1
        );

        // 7) Clef invalide (injection de ligne) : refusée, rien en base.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                dev_token,
                serde_json::json!({ "public_key": "ssh-ed25519 AAAA;rm -rf /" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        // 8) Session SANS identité (jeton forgé, `user_id = 0`) : refusée.
        let anonymous = ctx
            .auth
            .create_session_as("dev", std::time::Duration::from_secs(60));
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/ssh-keys",
                &anonymous,
                serde_json::json!({ "public_key": key }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "clef sans identité");

        // 9) Les deux actions sont journalisées et visibles pour l'admin.
        let res = app
            .clone()
            .oneshot(authed_get(
                "/api/gds/admin/audit?q=ssh_key_register",
                admin_token,
            ))
            .await
            .unwrap();
        assert_eq!(
            audit_actions(&json_body(res).await),
            vec!["ssh_key_register".to_string()],
            "enregistrement de clef non journalisé"
        );
        let res = app
            .clone()
            .oneshot(authed_get("/api/gds/admin/audit?q=project_create", admin_token))
            .await
            .unwrap();
        assert_eq!(audit_actions(&json_body(res).await).len(), 2, "deux créations journalisées");

        // Nettoyage : bac à sable jetable + base supprimée par le garde.
        let _ = std::fs::remove_dir_all(&sandbox);
        pool.close().await;
        admin_pool.close().await;
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

    /// L2.4 — décision d'amorçage du premier administrateur, SANS base : les
    /// trois cas exigés sont couverts (les deux variables → création ; un
    /// administrateur déjà présent → aucune création ; une seule variable →
    /// aucune création et avertissement). La décision pure est la même que
    /// celle appliquée au démarrage par `run()`.
    #[test]
    fn bootstrap_admin_creates_only_when_both_values_are_set() {
        assert_eq!(
            plan_bootstrap_admin(Some("owner@gds.test"), Some("mot-de-passe-choisi"), 0),
            BootstrapAdminDecision::Create {
                email: "owner@gds.test".to_string(),
                password: "mot-de-passe-choisi".to_string(),
            }
        );
    }

    /// L2.4 — un administrateur existe déjà : rien n'est écrasé, et le mot de
    /// passe n'est porté par AUCUNE variante de la décision (donc il ne peut
    /// pas être journalisé par cette branche).
    #[test]
    fn bootstrap_admin_never_overwrites_an_existing_admin() {
        let decision = plan_bootstrap_admin(Some("owner@gds.test"), Some("mot-de-passe-secret"), 1);
        assert_eq!(decision, BootstrapAdminDecision::AlreadyInitialized);
        assert!(
            !format!("{:?}", decision).contains("mot-de-passe-secret"),
            "la décision « déjà initialisé » ne doit pas contenir le mot de passe"
        );
    }

    /// L2.4 — une seule des deux variables est renseignée : avertir, ne rien
    /// créer ; aucune variable : l'initialisation reste à faire par la route
    /// `POST /api/gds/setup`.
    #[test]
    fn bootstrap_admin_requires_both_variables() {
        assert_eq!(
            plan_bootstrap_admin(Some("owner@gds.test"), None, 0),
            BootstrapAdminDecision::Incomplete
        );
        assert_eq!(
            plan_bootstrap_admin(None, Some("mot-de-passe-choisi"), 0),
            BootstrapAdminDecision::Incomplete
        );
        assert_eq!(
            plan_bootstrap_admin(None, None, 0),
            BootstrapAdminDecision::NotRequested
        );
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

    /// L3.3 — scénario sur une base réelle jetable (facultatif) : un jeton `dev`
    /// reçoit 403 sur `POST /api/gds/users/validate` et ne modifie rien, tandis
    /// qu'un jeton `admin` obtient 200 et passe le compte `pending` à `active`.
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test sort proprement (CI verte).
    #[tokio::test]
    async fn user_validate_route_admin_ok_dev_forbidden_on_real_db() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "user_validate_route_admin_ok_dev_forbidden_on_real_db: \
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

        let seq = HTTP_TEST_DB_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let test_db = format!("pilot_gds_test_http_{}_{}", std::process::id(), seq);
        let admin_pool = PgPool::connect(&url)
            .await
            .expect("connexion d'administration de la base de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création de la base jetable");
        let _guard = HttpTestDbGuard {
            admin_url: url.clone(),
            db_name: test_db.clone(),
        };

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts.clone().database(&test_db))
            .await
            .expect("connexion à la base jetable");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base jetable");

        let pending_email = "pending-l33@gds.test";
        gds_core::db::create_user(&pool, pending_email, "Pending L33", "", "dev", "pending")
            .await
            .expect("création du compte en attente");

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: std::env::temp_dir(),
        });
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let dev = ctx
            .auth
            .create_session_as("dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);

        // 1) Jeton dev : refusé (403), le compte reste `pending`.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/users/validate",
                &dev,
                serde_json::json!({ "email": pending_email }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        let user = gds_core::db::get_user_by_email(&pool, pending_email)
            .await
            .unwrap()
            .expect("compte présent");
        assert_eq!(user.status, "pending", "le refus ne doit rien modifier");

        // 2) Jeton admin : validation effective (200) → compte `active`.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/users/validate",
                &admin,
                serde_json::json!({ "email": pending_email }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["status"], serde_json::json!("active"));
        let user = gds_core::db::get_user_by_email(&pool, pending_email)
            .await
            .unwrap()
            .expect("compte présent");
        assert_eq!(user.status, "active");

        pool.close().await;
        admin_pool.close().await;
    }

    /// L3.4 — scénario sur une base réelle jetable (facultatif) : l'appartenance
    /// est un **droit**. Un projet attribué au développeur A n'apparaît pas dans
    /// la liste de B (lecture restreinte) et B ne peut pas s'attribuer le projet
    /// (écriture d'administration refusée, 403). L'attribution puis le retrait
    /// par l'admin pilotent la visibilité de A.
    /// Sans `PILOT_GDS_HTTP_TEST_URL`, le test sort proprement (CI verte).
    #[tokio::test]
    async fn project_assignment_restricts_read_and_write_on_real_db() {
        let url = match std::env::var("PILOT_GDS_HTTP_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "project_assignment_restricts_read_and_write_on_real_db: \
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

        let seq = HTTP_TEST_DB_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let test_db = format!("pilot_gds_test_l34_{}_{}", std::process::id(), seq);
        let admin_pool = PgPool::connect(&url)
            .await
            .expect("connexion d'administration de la base de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création de la base jetable");
        let _guard = HttpTestDbGuard {
            admin_url: url.clone(),
            db_name: test_db.clone(),
        };

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect_with(opts.clone().database(&test_db))
            .await
            .expect("connexion à la base jetable");
        gds_core::db::migrate(&pool)
            .await
            .expect("migrations sur la base jetable");

        let hash = WebAuth::hash_password("pw-l34").unwrap();
        gds_core::db::create_user(
            &pool,
            "admin-l34@gds.test",
            "Admin",
            &hash,
            "admin",
            "active",
        )
        .await
        .unwrap();
        let a_id =
            gds_core::db::create_user(&pool, "a-l34@gds.test", "Dev A", &hash, "dev", "active")
                .await
                .unwrap();
        let b_id =
            gds_core::db::create_user(&pool, "b-l34@gds.test", "Dev B", &hash, "dev", "active")
                .await
                .unwrap();
        let project_id = gds_core::db::create_project(
            &pool,
            "projet-l34",
            "projet-l34.git",
            "",
            "/srv/git/projet-l34.git",
            "active",
            "Projet L3.4",
        )
        .await
        .unwrap();

        let ctx = Arc::new(ServerCtx {
            pool: pool.clone(),
            auth: Arc::new(WebAuth::new()),
            guard: Arc::new(WebGuard::new()),
            audit: Arc::new(WebAudit::new()),
            repos_root: std::env::temp_dir(),
        });
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let token_a = ctx
            .auth
            .create_session_for(a_id, "dev", std::time::Duration::from_secs(60));
        let token_b = ctx
            .auth
            .create_session_for(b_id, "dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);

        // 0) Avant toute attribution : ni A ni B ne voit le projet.
        for token in [&token_a, &token_b] {
            let res = app
                .clone()
                .oneshot(admin_json_request(
                    "GET",
                    "/api/gds/projects",
                    token,
                    serde_json::json!({}),
                ))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::OK);
            let value = json_body(res).await;
            assert_eq!(value["projects"].as_array().unwrap().len(), 0);
        }

        // 1) B (non admin) ne peut pas s'attribuer le projet : écriture refusée.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/assign",
                &token_b,
                serde_json::json!({ "project_id": project_id, "email": "b-l34@gds.test" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // 2) L'admin attribue le projet à A (idempotent).
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/assign",
                &admin,
                serde_json::json!({ "project_id": project_id, "email": "a-l34@gds.test" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["created"], serde_json::json!(true));
        assert!(gds_core::db::is_project_member(&pool, project_id, a_id)
            .await
            .unwrap());

        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/assign",
                &admin,
                serde_json::json!({ "project_id": project_id, "email": "a-l34@gds.test" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["created"], serde_json::json!(false));

        // 3) A voit le projet, B non.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/projects",
                &token_a,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        let value = json_body(res).await;
        let names: Vec<String> = value["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(names, vec!["projet-l34".to_string()]);

        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/projects",
                &token_b,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        let value = json_body(res).await;
        assert_eq!(
            value["projects"].as_array().unwrap().len(),
            0,
            "B ne doit rien voir"
        );

        // 4) Le listing admin des membres expose A.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                &format!("/api/gds/admin/projects/members?project_id={}", project_id),
                &admin,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        let members = value["members"].as_array().unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["email"], serde_json::json!("a-l34@gds.test"));

        // 5) Retrait : A ne voit plus le projet.
        let res = app
            .clone()
            .oneshot(admin_json_request(
                "POST",
                "/api/gds/admin/projects/unassign",
                &admin,
                serde_json::json!({ "project_id": project_id, "email": "a-l34@gds.test" }),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert_eq!(value["removed"], serde_json::json!(true));
        assert!(!gds_core::db::is_project_member(&pool, project_id, a_id)
            .await
            .unwrap());

        let res = app
            .clone()
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/projects",
                &token_a,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        let value = json_body(res).await;
        assert_eq!(value["projects"].as_array().unwrap().len(), 0);

        pool.close().await;
        admin_pool.close().await;
    }

    /// L2.10 — cycle de vie du service : `GET /api/gds/admin/service` et les deux
    /// actions sont réservés au rôle `admin` (un `dev` reçoit 403, sans jeton
    /// 401). L'état est lisible sans base : en l'absence de superviseur (cas des
    /// tests et du poste de développement), la route répond 200 avec `error`
    /// renseigné — l'écran sait alors afficher un état « inconnu » plutôt qu'un
    /// état inventé. Une action, elle, échoue proprement (500) : mieux vaut
    /// refuser que de prétendre avoir redémarré.
    #[tokio::test]
    async fn service_control_routes_are_admin_only() {
        // 1) État : refusé à un dev, accordé à un admin.
        let ctx = null_ctx();
        let dev = ctx
            .auth
            .create_session_for(7, "dev", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/admin/service",
                &dev,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        let ctx = null_ctx();
        let admin = ctx
            .auth
            .create_session_as("admin", std::time::Duration::from_secs(60));
        let app = server_router(ctx);
        let res = app
            .oneshot(admin_json_request(
                "GET",
                "/api/gds/admin/service",
                &admin,
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let value = json_body(res).await;
        assert!(value["pid"].as_u64().unwrap_or(0) > 0);
        assert_eq!(
            value["programs"],
            serde_json::json!(["gds-server", "sshd"]),
            "le service pilote le service et l'accès par clef, jamais postgres"
        );
        assert!(value["action_delay_ms"].as_u64().unwrap_or(0) >= 50);

        // 2) Actions : refusées à un dev (403)…
        let body = serde_json::json!({});
        for uri in [
            "/api/gds/admin/service/restart",
            "/api/gds/admin/service/stop",
        ] {
            let ctx = null_ctx();
            let dev = ctx
                .auth
                .create_session_for(7, "dev", std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request("POST", uri, &dev, body.clone()))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{}", uri);

            // 3) …et sans jeton : 401 (le garde s'applique avant tout le reste).
            let app = server_router(null_ctx());
            let res = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(uri)
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{}", uri);

            // 4) Pour un admin : le superviseur est injoignable ici (la
            //    configuration `/etc/gds/supervisord.conf` n'existe que dans
            //    l'image) → refus net, jamais un faux succès.
            let ctx = null_ctx();
            let admin = ctx
                .auth
                .create_session_as("admin", std::time::Duration::from_secs(60));
            let app = server_router(ctx);
            let res = app
                .oneshot(admin_json_request("POST", uri, &admin, body.clone()))
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR, "{}", uri);
        }
    }
}
