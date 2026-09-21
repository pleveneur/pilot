//! Configuration d'exécution du service `gds-server` (L2.1).
//!
//! La lecture de l'**environnement** vit dans le socle partagé
//! (`gds_core::config::ServerConfig`, L1.9) : elle est commune au poste et au
//! service et n'est donc jamais dupliquée. Ce module ne porte que ce qui est
//! **propre au démarrage du service** :
//!   - la construction des options de connexion PostgreSQL depuis la config ;
//!   - la politique de reprise (« attente progressive ») tant que PostgreSQL
//!     n'est pas prêt, sous une forme **pure** (séquence de délais) et une forme
//!     asynchrone testable sans base.

use gds_core::config::ServerConfig;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::time::Duration;

/// Nombre de tentatives d'ouverture du pool au démarrage.
pub const DB_CONNECT_ATTEMPTS: u32 = 30;
/// Délai avant la deuxième tentative (il double ensuite, jusqu'au plafond).
pub const DB_CONNECT_INITIAL_DELAY: Duration = Duration::from_millis(500);
/// Plafond du délai entre deux tentatives.
pub const DB_CONNECT_MAX_DELAY: Duration = Duration::from_secs(5);

/// Port PostgreSQL : entier strictement positif attendu, sinon `5432` (défaut
/// sûr de la spec §6.4 ; une valeur invalide n'empêche pas le démarrage).
pub fn pg_port(cfg: &ServerConfig) -> u16 {
    cfg.db_port
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|p| *p > 0)
        .unwrap_or(5432)
}

/// Options de connexion PostgreSQL dérivées de la configuration serveur.
///
/// On passe par `PgConnectOptions` (et non par une URL) : le mot de passe peut
/// contenir des caractères spéciaux sans encodage d'URL, et il n'est jamais
/// journalisé.
pub fn pg_options(cfg: &ServerConfig) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&cfg.db_host)
        .port(pg_port(cfg))
        .username(&cfg.db_user)
        .password(&cfg.db_password)
        .database(&cfg.db_name)
}

/// Ouvre le pool avec la politique du service (5 connexions, 10 s d'attente).
/// Le message d'erreur n'expose jamais le mot de passe.
pub async fn open_pool(opts: PgConnectOptions) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(opts)
        .await
        .map_err(|e| format!("Connexion PostgreSQL: {}", e))
}

/// Délai avant la tentative d'index `attempt` (0 = première tentative, sans
/// attente préalable). Doublement plafonné → attente progressive :
/// 0,5 s, 1 s, 2 s, 4 s, 5 s, 5 s…
pub fn retry_delay(attempt: u32) -> Duration {
    let factor = 1u32 << attempt.min(4);
    DB_CONNECT_INITIAL_DELAY
        .saturating_mul(factor)
        .min(DB_CONNECT_MAX_DELAY)
}

/// Séquence d'attente du démarrage : `delays.len()` = nombre de tentatives.
pub fn startup_delays() -> Vec<Duration> {
    (0..DB_CONNECT_ATTEMPTS).map(retry_delay).collect()
}

/// Tente `op` jusqu'à `delays.len()` fois : premier appel immédiat, puis le
/// délai `delays[i]` entre la tentative `i` et la suivante. Renvoie la valeur
/// du premier succès, ou la **dernière** erreur si toutes échouent.
///
/// L'opération est injectée : la reprise est donc prouvable sans base de
/// données (voir les tests).
pub async fn retry_with_delays<T, F, Fut>(delays: &[Duration], mut op: F) -> Result<T, String>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last_err = String::from("aucune tentative effectuée");
    for (i, delay) in delays.iter().enumerate() {
        match op(i as u32).await {
            Ok(value) => return Ok(value),
            Err(e) => last_err = e,
        }
        if i + 1 < delays.len() {
            tokio::time::sleep(*delay).await;
        }
    }
    Err(last_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(pairs: &[(&str, &str)]) -> ServerConfig {
        let map: std::collections::HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        let mut all = map;
        all.entry("POSTGRES_PASSWORD".to_string()).or_insert_with(|| "pw".to_string());
        ServerConfig::from_lookup(move |name| all.get(name).cloned()).unwrap()
    }

    #[test]
    fn pg_port_defaults_and_overrides() {
        assert_eq!(pg_port(&cfg(&[])), 5432);
        assert_eq!(pg_port(&cfg(&[("GDS_DB_PORT", "6543")])), 6543);
        // Valeur invalide → défaut sûr, jamais d'échec au démarrage.
        assert_eq!(pg_port(&cfg(&[("GDS_DB_PORT", "abc")])), 5432);
        assert_eq!(pg_port(&cfg(&[("GDS_DB_PORT", "0")])), 5432);
    }

    #[test]
    fn pg_options_carry_configuration() {
        let c = cfg(&[
            ("GDS_DB_HOST", "db.internal"),
            ("GDS_DB_PORT", "6543"),
            ("GDS_DB_USER", "svc"),
            ("GDS_DB_NAME", "custom_db"),
        ]);
        let opts = pg_options(&c);
        assert_eq!(opts.get_host(), "db.internal");
        assert_eq!(opts.get_port(), 6543);
        assert_eq!(opts.get_username(), "svc");
        assert_eq!(opts.get_database(), Some("custom_db"));
    }

    #[test]
    fn retry_delay_is_progressive_and_capped() {
        assert_eq!(retry_delay(0), Duration::from_millis(500));
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(2), Duration::from_secs(2));
        assert_eq!(retry_delay(3), Duration::from_secs(4));
        // Plafond atteint et maintenu : la progression est bornée.
        assert_eq!(retry_delay(4), Duration::from_secs(5));
        assert_eq!(retry_delay(9), Duration::from_secs(5));
        assert_eq!(retry_delay(29), Duration::from_secs(5));
        // Croissance puis plafonnement.
        assert!(retry_delay(1) > retry_delay(0));
        assert!(retry_delay(9) <= DB_CONNECT_MAX_DELAY);
    }

    #[test]
    fn startup_delays_has_one_per_attempt() {
        let delays = startup_delays();
        assert_eq!(delays.len(), DB_CONNECT_ATTEMPTS as usize);
        assert_eq!(delays[0], Duration::from_millis(500));
    }

    #[tokio::test]
    async fn retry_stops_on_first_success() {
        let zero = [Duration::ZERO; 5];
        let mut calls = 0u32;
        let result: Result<u32, String> = retry_with_delays(&zero, |_attempt| {
            calls += 1;
            let n = calls;
            async move {
                if n < 3 {
                    Err(format!("échec {}", n))
                } else {
                    Ok(n)
                }
            }
        })
        .await;
        assert_eq!(result, Ok(3));
        assert_eq!(calls, 3); // les tentatives suivantes ne sont pas appelées
    }

    #[tokio::test]
    async fn retry_exhausts_and_returns_last_error() {
        let zero = [Duration::ZERO; 4];
        let mut calls = 0u32;
        let result: Result<u32, String> = retry_with_delays(&zero, |_attempt| {
            calls += 1;
            let n = calls;
            async move { Err(format!("erreur {}", n)) }
        })
        .await;
        assert_eq!(calls, 4); // autant d'appels que de délais fournis
        assert_eq!(result, Err("erreur 4".to_string()));
    }

    #[tokio::test]
    async fn retry_with_no_attempt_reports_clearly() {
        let result: Result<u32, String> = retry_with_delays(&[], |_attempt| async { Ok(1) })
            .await;
        assert!(result.is_err());
    }
}
