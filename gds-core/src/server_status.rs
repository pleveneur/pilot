//! server_status.rs — Santé et état du serveur GDS (refonte GDS, micro-tâche L2.2).
//!
//! Module du **socle partagé** (`gds-core`) : il construit les deux charges
//! utiles de supervision du service, utilisées par le routeur du serveur
//! autonome (`gds_core::http::server_router`) et réutilisables par le poste.
//!
//! * `GET /api/gds/health` — **PUBLIQUE** : version du binaire, version de
//!   migration appliquée, durée de fonctionnement depuis le démarrage, compteurs
//!   d'utilisateurs / projets / dépôts. Ne divulgue **aucune** donnée sensible :
//!   ni mot de passe, ni chaîne de connexion, ni chemin de fichier, ni nom
//!   d'utilisateur.
//! * `GET /api/gds/admin/server` — **RÉSERVÉE À L'ADMINISTRATEUR** (le garde est
//!   dans `http.rs`) : espace disque occupé par les volumes (racine des dépôts
//!   bare + base applicative) et dernière entrée du journal d'audit.
//!
//! Robustesse : toutes les valeurs issues de la base sont des `Option`. Si la
//! base est injoignable, la **santé répond quand même** (HTTP 200) avec des
//! compteurs `null` : un point de supervision doit rester joignable pour dire
//! que le service est vivant. Aucune donnée de base n'est journalisée.

use crate::audit::AuditEntry;
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Nombre maximal d'entrées de répertoire parcourues lors du calcul de la
/// taille des dépôts : borne défensive pour qu'une racine pathologique ne fasse
/// jamais durer la requête indéfiniment.
const MAX_SCAN_ENTRIES: usize = 200_000;

/// Instant de démarrage du service, posé une seule fois par le binaire
/// (`gds-server`) au tout début de son exécution.
static STARTED: OnceLock<Instant> = OnceLock::new();

/// Pose (une seule fois) l'instant de démarrage et le renvoie. Idempotent : un
/// second appel ne modifie pas la valeur.
pub fn mark_started() -> Instant {
    *STARTED.get_or_init(Instant::now)
}

/// Instant de démarrage connu ; posé paresseusement si `mark_started` n'a pas
/// encore été appelé (cas des tests unitaires).
pub fn started_at() -> Instant {
    mark_started()
}

/// Durée de fonctionnement en secondes depuis `started` (pure, testable).
pub fn uptime_seconds(started: Instant) -> u64 {
    let elapsed: Duration = Instant::now().saturating_duration_since(started);
    elapsed.as_secs()
}

/// Version du binaire GDS. Le socle et le service partagent la même version de
/// workspace ; la valeur est figée à la compilation (aucune donnée externe).
pub fn binary_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Compteurs d'entités de la base. `None` = base injoignable (valeur inconnue,
/// volontairement pas 0 pour ne pas mentir).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Counters {
    pub users: Option<i64>,
    pub projects: Option<i64>,
    pub git_repos: Option<i64>,
}

/// Charge utile de `GET /api/gds/health` (**publique**).
///
/// Champs exposés, exactement : `version` (version du binaire), `migration_version`
/// (dernière migration appliquée), `uptime_seconds`, `users`, `projects`,
/// `git_repos`. Rien d'autre : aucun secret, aucune connexion, aucun chemin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HealthReport {
    pub version: String,
    pub migration_version: Option<i64>,
    pub uptime_seconds: u64,
    pub users: Option<i64>,
    pub projects: Option<i64>,
    pub git_repos: Option<i64>,
}

/// Charge utile de `GET /api/gds/admin/server` (**administrateur uniquement**).
///
/// `repos_bytes` = octets occupés sous la racine des dépôts bare.
/// `db_bytes` = taille de la base applicative (PostgreSQL), `None` si inconnue.
/// `last_audit` = dernière entrée du journal d'audit du socle, `None` si vide.
#[derive(Debug, Clone, Serialize)]
pub struct AdminStatusReport {
    pub repos_bytes: u64,
    pub db_bytes: Option<i64>,
    pub last_audit: Option<AuditEntry>,
}

/// Compteurs d'entités depuis la base. Erreur = base injoignable ou schéma
/// absent (l'appelant décide de la dégradation, ici des `None`).
pub async fn count_entities(pool: &PgPool) -> Result<Counters, String> {
    let row = sqlx::query(
        "SELECT (SELECT COUNT(*) FROM users) AS users, \
                (SELECT COUNT(*) FROM projects) AS projects, \
                (SELECT COUNT(*) FROM git_repos) AS git_repos",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Compteurs GDS: {}", e))?;
    Ok(Counters {
        users: Some(row.get::<i64, _>("users")),
        projects: Some(row.get::<i64, _>("projects")),
        git_repos: Some(row.get::<i64, _>("git_repos")),
    })
}

/// Dernière migration **réellement appliquée** (table `_sqlx_migrations`).
/// `0` = aucune migration appliquée (base vierge sans table de suivi).
pub async fn applied_migration(pool: &PgPool) -> Result<i64, String> {
    let row = sqlx::query(
        "SELECT COALESCE(MAX(version), 0) AS version FROM _sqlx_migrations WHERE success",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Version de migration GDS: {}", e))?;
    Ok(row.get::<i64, _>("version"))
}

/// Taille de la base applicative courante, en octets (PostgreSQL).
pub async fn database_size_bytes(pool: &PgPool) -> Result<i64, String> {
    let row = sqlx::query("SELECT pg_database_size(current_database()) AS size")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Taille de la base GDS: {}", e))?;
    Ok(row.get::<i64, _>("size"))
}

/// Taille cumulée des fichiers sous `root`, en octets. Marche itérative bornée
/// (`MAX_SCAN_ENTRIES`), **sans suivi de lien symbolique** ; les entrées
/// illisibles sont ignorées (best effort, jamais d'erreur remontée). Une racine
/// absente vaut 0.
pub fn dir_size_bytes(root: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut visited: usize = 0;
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_SCAN_ENTRIES {
                return total;
            }
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                if let Ok(md) = entry.metadata() {
                    total = total.saturating_add(md.len());
                }
            }
        }
    }
    total
}

/// Construit la santé publique. `pool` = `None` quand la base est injoignable :
/// les compteurs et la version de migration valent alors `null`, mais la route
/// répond (aucune erreur).
pub async fn collect_health(pool: Option<&PgPool>, started: Instant) -> HealthReport {
    let (migration_version, counters) = match pool {
        Some(pool) => {
            let migration = applied_migration(pool).await.ok();
            let counters = count_entities(pool).await.ok();
            (migration, counters)
        }
        None => (None, None),
    };
    let counters = counters.unwrap_or(Counters {
        users: None,
        projects: None,
        git_repos: None,
    });
    HealthReport {
        version: binary_version().to_string(),
        migration_version,
        uptime_seconds: uptime_seconds(started),
        users: counters.users,
        projects: counters.projects,
        git_repos: counters.git_repos,
    }
}

/// Construit l'état serveur administrateur. Ne dépend d'aucun secret : la base
/// n'est lue que pour sa taille (taille inconnue → `None`).
pub async fn collect_admin(
    pool: Option<&PgPool>,
    repos_root: Option<&Path>,
    last_audit: Option<AuditEntry>,
) -> AdminStatusReport {
    let repos_bytes = repos_root.map(dir_size_bytes).unwrap_or(0);
    let db_bytes = match pool {
        Some(pool) => database_size_bytes(pool).await.ok(),
        None => None,
    };
    AdminStatusReport {
        repos_bytes,
        db_bytes,
        last_audit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Clés exactes de la route de santé : tout ajout/retrait casserait le
    /// contrat de supervision (L2.2).
    #[test]
    fn health_report_serializes_with_exact_fields() {
        let report = HealthReport {
            version: "0.4.16".to_string(),
            migration_version: Some(7),
            uptime_seconds: 42,
            users: Some(3),
            projects: Some(2),
            git_repos: Some(1),
        };
        let value: Value = serde_json::to_value(&report).unwrap();
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
        assert_eq!(obj["migration_version"], serde_json::json!(7));
        assert_eq!(obj["uptime_seconds"], serde_json::json!(42));
    }

    /// La route **publique** ne doit contenir aucune donnée sensible : ni mot de
    /// passe, ni chaîne de connexion, ni chemin de fichier, ni nom de compte.
    #[test]
    fn health_report_leaks_nothing_sensitive() {
        let report = HealthReport {
            version: binary_version().to_string(),
            migration_version: Some(7),
            uptime_seconds: 1,
            users: Some(1),
            projects: Some(1),
            git_repos: Some(1),
        };
        let text = serde_json::to_string(&report).unwrap().to_lowercase();
        for forbidden in [
            "password",
            "postgres://",
            "postgresql://",
            "host",
            "user_",
            "email",
            "secret",
            "/srv",
            "\\",
            "/",
        ] {
            assert!(
                !text.contains(forbidden),
                "la santé publique ne doit pas contenir {:?} (corps : {})",
                forbidden,
                text
            );
        }
    }

    /// Base injoignable : la santé répond quand même, compteurs inconnus (`null`).
    #[tokio::test]
    async fn health_without_database_reports_unknown_counters() {
        let report = collect_health(None, started_at()).await;
        assert_eq!(report.users, None);
        assert_eq!(report.projects, None);
        assert_eq!(report.git_repos, None);
        assert_eq!(report.migration_version, None);
        assert_eq!(report.version, binary_version());
    }

    /// L'uptime est nul au démarrage puis croît avec le temps écoulé.
    #[test]
    fn uptime_is_zero_at_start_and_grows() {
        let now = Instant::now();
        assert_eq!(uptime_seconds(now), 0);
        let past = now - Duration::from_secs(3);
        assert!(uptime_seconds(past) >= 3);
    }

    #[test]
    fn binary_version_is_not_empty() {
        assert!(!binary_version().is_empty());
    }

    /// L'état administrateur porte exactement les trois champs attendus.
    #[test]
    fn admin_report_serializes_sizes_and_last_audit() {
        let entry = AuditEntry {
            ts: 1_700_000_000_000,
            ip: "127.0.0.1".to_string(),
            subject: "abc".to_string(),
            action: "login".to_string(),
            detail: "session créée".to_string(),
            ok: true,
        };
        let report = AdminStatusReport {
            repos_bytes: 4096,
            db_bytes: Some(2048),
            last_audit: Some(entry),
        };
        let value: Value = serde_json::to_value(&report).unwrap();
        let obj = value.as_object().unwrap();
        assert_eq!(obj.len(), 3);
        assert_eq!(obj["repos_bytes"], serde_json::json!(4096));
        assert_eq!(obj["db_bytes"], serde_json::json!(2048));
        assert_eq!(obj["last_audit"]["action"], serde_json::json!("login"));
    }

    #[test]
    fn admin_report_without_audit_or_database() {
        let report = AdminStatusReport {
            repos_bytes: 0,
            db_bytes: None,
            last_audit: None,
        };
        let value: Value = serde_json::to_value(&report).unwrap();
        assert_eq!(value["db_bytes"], Value::Null);
        assert_eq!(value["last_audit"], Value::Null);
    }

    /// Marche de répertoire : somme récursive des fichiers, racine absente → 0.
    #[test]
    fn dir_size_sums_recursively_and_is_zero_when_missing() {
        let base = std::env::temp_dir().join(format!(
            "pilot-l2-2-dirsize-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sub = base.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(base.join("a.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(sub.join("b.bin"), vec![0u8; 5]).unwrap();
        assert_eq!(dir_size_bytes(&base), 15);
        let _ = std::fs::remove_dir_all(&base);
        assert_eq!(dir_size_bytes(&base), 0);
        assert_eq!(dir_size_bytes(Path::new("")), 0);
    }
}
