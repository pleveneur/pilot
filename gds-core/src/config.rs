//! Configuration GDS — séparation des deux mondes (refonte GDS, L1.9).
//!
//! Deux configurations distinctes cohabitent, et ne doivent jamais être
//! confondues :
//!
//! 1. **Configuration du POSTE** (`GdsConfig`) : elle vit dans le dossier du
//!    projet (`.pilot/gds.json`). Elle décrit comment *ce poste* parle à un
//!    serveur GDS : adresse du serveur, identifiants de l'utilisateur,
//!    rattachement du dépôt, dossier local de clonage. La lecture/écriture du
//!    fichier (`read_gds_config` / `write_gds_config`) reste côté application :
//!    le serveur autonome n'a pas de `.pilot/`.
//!
//! 2. **Configuration du SERVEUR** (`ServerConfig`) : elle est lue
//!    **exclusivement depuis l'environnement du service** (`gds-server`), et
//!    jamais depuis le fichier d'un projet. Elle décrit l'écoute réseau du
//!    service, son accès à la base, le compte administrateur créé au premier
//!    démarrage et ses chemins de dépôts.
//!
//! Ce module ne fait aucune E/S de fichier : il expose des **données pures** et
//! des helpers purs, testables, partagés par le poste et le serveur.

use crate::db::GDS_DB_NAME;
use serde::{Deserialize, Serialize};

/// Extrait (user, password, host, port) d'une URL `postgres://user:pass@host:port/db`.
/// Tolère l'absence de mot de passe ou de port (défaut 5432).
fn pg_url_parts(url: &str) -> Option<(String, String, String, String)> {
    let s = url.trim().strip_prefix("postgres://")?;
    let (userpart, rest) = s.split_once('@')?;
    let (user, pass) = match userpart.split_once(':') {
        Some((u, p)) => (u, p),
        None => (userpart, ""),
    };
    let hostpart = rest.split('/').next().unwrap_or(rest);
    let (host, port) = match hostpart.split_once(':') {
        Some((h, p)) => (h, p),
        None => (hostpart, "5432"),
    };
    Some((user.to_string(), pass.to_string(), host.to_string(), port.to_string()))
}

/// Config GDS d'un projet (`.pilot/gds.json`) — **config du POSTE**.
///
/// Les mots de passe ne sont JAMAIS stockés ici : ils vivent dans
/// `~/.pilot/gds_secrets.json` (`GdsSecrets`). L'hôte/port/utilisateur
/// PostgreSQL sont en champs distincts (`db_host`/`db_port`/`db_user`) ;
/// `server_url` est dérivé SANS mot de passe (rétrocompat : d'anciennes
/// configs pouvaient embarquer une URL `postgres://user:pass@host:port/db`).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GdsConfig {
    pub enabled: bool,
    #[serde(default)]
    pub db_host: String,
    #[serde(default)]
    pub db_port: String,
    #[serde(default)]
    pub db_user: String,
    pub identity_email: String,
    /// Dérivé, SANS mot de passe (rétrocompat). Reconstruit par `normalize`.
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub gds_local_dir: Option<String>,
    /// Port SSH du serveur GDS (défaut 22). Rétrocompat : absent d'un ancien
    /// `.pilot/gds.json` → 0, normalisé en 22 (comportement historique
    /// inchangé). 0 = « non fourni » dans `gds_save_config` (préserve l'existant).
    #[serde(default)]
    pub ssh_port: u16,
    /// Racine des dépôts bare CÔTÉ SERVEUR (ex: `/home/git/repos`), utile pour
    /// un serveur GDS distant. Vide/absent (serveur local historique) → l'URL du
    /// remote reste `ssh://git@<host>:<port>/<nom>.git` : sur le serveur local,
    /// le home du user `git` EST le dossier des repos. Rétrocompatible.
    #[serde(default)]
    pub gds_server_repos: Option<String>,
    /// Hôte SSH (host:port) du serveur GDS, dérivé de `db_host` à la provision.
    /// Utilisé pour construire l'URL du remote git (transport SSH).
    #[serde(default)]
    pub ssh_host: String,
}

impl GdsConfig {
    /// Normalise la config : dérive `db_host`/`db_port`/`db_user` depuis une
    /// ancienne `server_url`, reconstruit `server_url` SANS mot de passe et
    /// dérive `ssh_host` depuis `db_host`. Rétrocompat des `.pilot/gds.json`.
    pub fn normalize(&mut self) {
        // Récupérer host/port/user depuis une éventuelle ancienne server_url.
        if (self.db_host.is_empty() || self.db_user.is_empty()) && !self.server_url.trim().is_empty() {
            if let Some((u, _p, h, port)) = pg_url_parts(&self.server_url) {
                if self.db_host.is_empty() {
                    self.db_host = h;
                }
                if self.db_port.is_empty() {
                    self.db_port = port;
                }
                if self.db_user.is_empty() {
                    self.db_user = u;
                }
            }
        }
        if self.db_port.is_empty() {
            self.db_port = "5432".to_string();
        }
        // `server_url` toujours dérivé SANS mot de passe (aucun `user:pass@`).
        if !self.db_host.is_empty() && !self.db_user.is_empty() {
            self.server_url = format!(
                "postgres://{}@{}:{}/postgres",
                self.db_user, self.db_host, self.db_port
            );
        }
        if self.ssh_port == 0 {
            self.ssh_port = default_ssh_port();
        }
        if self.ssh_host.is_empty() && !self.db_host.is_empty() {
            self.ssh_host = ssh_host_from_db_host(&self.db_host, self.ssh_port);
        }
    }
}

/// Port SSH par défaut (historique) : 22.
fn default_ssh_port() -> u16 {
    22
}

/// Dossier local par défaut des projets GDS (clonage).
/// Windows : `C:\GDS` (hors du profil utilisateur) — le user `git` du serveur
/// GDS local n'a pas accès au profil de l'utilisateur courant, ce qui faisait
/// échouer le clone SSH (`Set-Location : Accès refusé`). Décision utilisateur.
/// Linux/macOS : `~/Pilot/GDS` (inchangé).
pub fn default_gds_local_dir() -> String {
    if cfg!(windows) {
        return "C:\\GDS".to_string();
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        "Pilot/GDS".to_string()
    } else {
        format!("{}/Pilot/GDS", home)
    }
}

/// Hôte (host:port) extrait d'une URL serveur GDS, pour construire l'URL git SSH.
pub fn server_host(server_url: &str) -> String {
    let s = server_url.trim();
    let s = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))
        .or_else(|| s.strip_prefix("ssh://"))
        .unwrap_or(s);
    s.split('/').next().unwrap_or(s).to_string()
}

/// Hôte SSH (host:22) dérivé de l'adresse serveur GDS (server_url).
/// Gère les schémas `postgres://`, `http://`, `https://` et `ssh://` :
/// - `postgres://user:pass@host:5432/db` → `host:22` (port SSH 22, pas 5432)
/// - `http://host:8080` → `host:22`
/// - `https://host` → `host:22`
/// - `ssh://git@host` → `host:22`
pub fn ssh_host_from_server_url(server_url: &str, ssh_port: u16) -> String {
    let s = server_url.trim();
    // Retire le schéma.
    let s = s
        .strip_prefix("postgres://")
        .or_else(|| s.strip_prefix("http://"))
        .or_else(|| s.strip_prefix("https://"))
        .or_else(|| s.strip_prefix("ssh://"))
        .unwrap_or(s);
    // Retire user:pass@ (postgres:// et ssh://).
    let at = s.rfind('@').map(|i| i + 1).unwrap_or(0);
    let after_at = &s[at..];
    // Retire le chemin (/db, /proj.git).
    let host_port = after_at.split('/').next().unwrap_or(after_at);
    // Retire le port éventuel (5432, 8080…).
    let host = host_port.split(':').next().unwrap_or(host_port);
    format!("{}:{}", host, effective_ssh_port(ssh_port))
}

/// Hôte SSH (host:<port>) dérivé de l'hôte PostgreSQL du serveur GDS.
/// `host` → `host:22` (port SSH 22, pas le port PostgreSQL 5432).
pub fn ssh_host_from_db_addr(db_addr: &str, ssh_port: u16) -> String {
    ssh_host_from_server_url(db_addr, ssh_port)
}

/// Hôte SSH (host:<port>) dérivé de l'hôte PostgreSQL (`db_host`).
pub fn ssh_host_from_db_host(db_host: &str, ssh_port: u16) -> String {
    let host = db_host.trim();
    if host.is_empty() {
        String::new()
    } else {
        format!("{}:{}", host, effective_ssh_port(ssh_port))
    }
}

/// Port SSH effectif (0/absent → 22). Pure — testable.
pub fn effective_ssh_port(ssh_port: u16) -> u16 {
    if ssh_port == 0 {
        default_ssh_port()
    } else {
        ssh_port
    }
}

/// Nom de la machine locale (best-effort, jamais bloquant).
fn local_hostname() -> String {
    for key in ["HOSTNAME", "COMPUTERNAME"] {
        if let Ok(v) = std::env::var(key) {
            let v = v.trim().to_ascii_lowercase();
            if !v.is_empty() {
                return v;
            }
        }
    }
    if let Ok(v) = std::fs::read_to_string("/etc/hostname") {
        let v = v.trim().to_ascii_lowercase();
        if !v.is_empty() {
            return v;
        }
    }
    String::new()
}

/// Vrai si `host` désigne la machine locale (127.0.0.1, localhost, ::1, nom de
/// la machine, vide). Cœur PUR : `hostname` est injectable pour les tests.
/// Retire un éventuel `[ipv6]` et un `:port`. Pure — testable.
pub fn is_local_host_with(host: &str, hostname: &str) -> bool {
    let raw = host.trim();
    if raw.is_empty() {
        return true;
    }
    // Retire `[ipv6]` puis un éventuel `:port` (un IPv6 nu contient ≥2 ':' → gardé).
    let h = if let Some(rest) = raw.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else if raw.matches(':').count() == 1 {
        raw.split(':').next().unwrap_or(raw)
    } else {
        raw
    };
    let h = h.trim().to_ascii_lowercase();
    if h.is_empty() {
        return true;
    }
    if h == "localhost" || h == "::1" || h == "0.0.0.0" {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return ip.is_loopback();
    }
    let hostname = hostname.trim().to_ascii_lowercase();
    if !hostname.is_empty() && (h == hostname || h == format!("{}.local", hostname)) {
        return true;
    }
    false
}

/// Vrai si `host` désigne la machine locale (cf. `is_local_host_with`).
pub fn is_local_host(host: &str) -> bool {
    is_local_host_with(host, &local_hostname())
}

/// Vrai si le serveur GDS configuré est le serveur LOCAL (même machine que
/// Pilot) : on garde alors STRICTEMENT le comportement historique (bare local,
/// provision SSH locale, URL sans préfixe de repos). Sinon (serveur DISTANT),
/// aucune administration ni création sur le poste. Pure — testable.
pub fn is_local_gds_server(cfg: &GdsConfig) -> bool {
    let host = if !cfg.db_host.trim().is_empty() {
        cfg.db_host.trim().to_string()
    } else {
        server_host(&cfg.server_url)
    };
    is_local_host(&host)
}

/// Joint deux segments de chemin POSIX (serveur distant), en normalisant les
/// séparateurs. Pure — testable.
pub fn join_posix_path(base: &str, child: &str) -> String {
    let base = base.trim().replace('\\', "/");
    let child = child.trim().replace('\\', "/");
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        child.trim_start_matches('/')
    )
}

/// Chemin du dépôt bare CÔTÉ SERVEUR pour un serveur DISTANT, depuis la racine
/// `gds_server_repos`. `None` si aucune racine n'est renseignée. Pure — testable.
pub fn server_repo_path(cfg: &GdsConfig, project_name: &str) -> Option<String> {
    cfg.gds_server_repos
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|repos| join_posix_path(repos, &format!("{}.git", project_name)))
}

/// Nom de projet (dernier segment du chemin) — ex: `/path/to/proj` → `proj`.
pub fn project_name(project: &str) -> String {
    std::path::Path::new(project)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// URL du remote git GDS d'un projet.
/// - Racine serveur renseignée en chemin **POSIX absolu** :
///   `ssh://git@<host>:<port><gds_server_repos>/<nom>.git` (chemin absolu).
/// - Sinon, serveur **local** (historique) : `ssh://git@<host>:<port>/<nom>.git`.
/// - Sinon, serveur **distant** : chemin absolu sous la racine, repli sur la
///   forme locale si la racine est absente.
/// Hôte SSH dédié (renseigné à la provision) ; repli sur server_url si absent
/// (configs anciennes). Évite d'embarquer le port PostgreSQL 5432 dans l'URL SSH.
pub fn gds_remote_url(cfg: &GdsConfig, project_name: &str) -> String {
    let ssh_port = effective_ssh_port(cfg.ssh_port);
    let host = if cfg.ssh_host.is_empty() {
        if cfg.db_host.is_empty() {
            ssh_host_from_server_url(&cfg.server_url, ssh_port)
        } else {
            ssh_host_from_db_host(&cfg.db_host, ssh_port)
        }
    } else {
        cfg.ssh_host.clone()
    };
    // Serveur LOCAL (historique) : le home du user `git` EST le dossier des
    // repos → URL inchangée `ssh://git@<host>:<port>/<nom>.git`.
    // Serveur DISTANT : chemin ABSOLU sous la racine des repos serveur
    // (`gds_server_repos`) — la sémantique `ssh://` de git est absolue (vérifié :
    // git passe `git-upload-pack '/chemin'`). Aucun repli local n'est tenté.
    // Racine des dépôts renseignée : elle fait AUTORITÉ, quel que soit le
    // serveur.
    //
    // Un serveur « local » peut être un CONTENEUR sur la même machine
    // (`db_host` = 127.0.0.1) : le home de son user `git` n'est alors PAS la
    // racine des dépôts, et la forme courte `ssh://git@host:port/<nom>.git` ne
    // désigne aucun dépôt → liaison impossible à établir alors que le projet
    // est bien inscrit sur le serveur (constat de terrain). On honore donc la
    // racine dès qu'elle est un chemin POSIX ABSOLU (cas conteneur / service
    // GDS, dont la racine vit sous `/`). Une racine Windows (`C:\GDS\repos`)
    // reste sur la forme historique : un ancien serveur local natif garde
    // exactement son URL (son home git EST la racine).
    if let Some(path) = server_repo_path(cfg, project_name) {
        if path.starts_with('/') {
            return format!("ssh://git@{}{}", host, path);
        }
        if !is_local_gds_server(cfg) {
            // Chemin ABSOLU obligatoire : la sémantique `ssh://` de git est
            // absolue (vérifié : `git-upload-pack '/chemin'`). On préfixe donc
            // par `/` si la racine fournie est relative.
            return format!("ssh://git@{}/{}", host, path);
        }
    }
    format!("ssh://git@{}/{}.git", host, project_name)
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration du SERVEUR (service `gds-server`)
// ─────────────────────────────────────────────────────────────────────────────

/// Valeurs par défaut de la configuration serveur (spec cible §6.4).
pub const DEFAULT_HTTP_BIND: &str = "0.0.0.0:8080";
pub const DEFAULT_PG_BIND: &str = "0.0.0.0:5432";
pub const DEFAULT_SSH_PORT: u16 = 22;
pub const DEFAULT_REPOS_ROOT: &str = "/srv/git/repos";
pub const DEFAULT_TLS_MODE: &str = "none";
pub const DEFAULT_DB_HOST: &str = "localhost";
pub const DEFAULT_DB_PORT: &str = "5432";
pub const DEFAULT_DB_USER: &str = "pilot";

/// Configuration du **SERVEUR** GDS autonome (service `gds-server`), lue
/// EXCLUSIVEMENT depuis l'environnement du service — jamais depuis le fichier
/// d'un projet. Aucun mot de passe n'est journalisé.
///
/// La création du compte administrateur initial (`admin_email` /
/// `admin_password`) n'est **requise qu'au premier démarrage** : on ne peut pas
/// savoir ici si un administrateur existe déjà, donc ces champs sont
/// optionnels ; `bootstrap_admin()` fournit le contrôle à la demande.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    /// Bind HTTP du service (défaut `0.0.0.0:8080`).
    pub http_bind: String,
    /// Bind PostgreSQL (défaut `0.0.0.0:5432`).
    pub pg_bind: String,
    /// Port SSH du serveur (défaut `22`, publié `2222` par le conteneur).
    pub ssh_port: u16,
    /// Racine des dépôts bare CÔTÉ SERVEUR (défaut `/srv/git/repos`).
    pub repos_root: String,
    /// URL publique annoncée aux postes (peut être vide : renseignée par l'UI).
    pub public_url: String,
    /// Mode TLS : `none` | `tailscale` | `proxy` (défaut `none`).
    pub tls_mode: String,
    /// Hôte PostgreSQL (défaut `localhost`).
    pub db_host: String,
    /// Port PostgreSQL (défaut `5432`).
    pub db_port: String,
    /// Rôle applicatif PostgreSQL (défaut `pilot`).
    pub db_user: String,
    /// Base applicative (défaut `pilot_gds`).
    pub db_name: String,
    /// Mot de passe du rôle applicatif — **SECRET**, requis.
    pub db_password: String,
    /// Email du compte administrateur initial (bootstrap, optionnel).
    pub admin_email: Option<String>,
    /// Mot de passe du compte administrateur initial — **SECRET** (bootstrap).
    pub admin_password: Option<String>,
}

impl ServerConfig {
    /// Lit la configuration serveur depuis l'environnement du processus.
    ///
    /// * `POSTGRES_PASSWORD` est **obligatoire** : sans lui, aucun accès à la
    ///   base n'est possible, et l'erreur est explicite (message en français).
    /// * Toutes les autres variables ont une valeur par défaut (spec §6.4).
    pub fn from_env() -> Result<Self, String> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Variante pure et testable de `from_env` : la lecture des variables est
    /// injectée (aucune mutation globale d'environnement dans les tests).
    pub fn from_lookup<F>(lookup: F) -> Result<Self, String>
    where
        F: Fn(&str) -> Option<String>,
    {
        let get = |name: &str| lookup(name).map(|v| v.trim().to_string());
        let non_empty = |name: &str| get(name).filter(|v| !v.is_empty());
        let or_default = |name: &str, default: &str| non_empty(name).unwrap_or_else(|| default.to_string());

        let db_password = non_empty("POSTGRES_PASSWORD").ok_or_else(|| {
            "Configuration du serveur incomplète : le mot de passe de la base de données \
             n'est pas défini. Renseignez la variable d'environnement POSTGRES_PASSWORD \
             avant de démarrer le service GDS."
                .to_string()
        })?;

        Ok(ServerConfig {
            http_bind: or_default("GDS_HTTP_BIND", DEFAULT_HTTP_BIND),
            pg_bind: or_default("GDS_PG_BIND", DEFAULT_PG_BIND),
            ssh_port: parse_ssh_port(non_empty("GDS_SSH_PORT").as_deref()),
            repos_root: or_default("GDS_REPOS_ROOT", DEFAULT_REPOS_ROOT),
            public_url: or_default("GDS_PUBLIC_URL", ""),
            tls_mode: or_default("GDS_TLS_MODE", DEFAULT_TLS_MODE),
            db_host: or_default("GDS_DB_HOST", DEFAULT_DB_HOST),
            db_port: or_default("GDS_DB_PORT", DEFAULT_DB_PORT),
            db_user: or_default("GDS_DB_USER", DEFAULT_DB_USER),
            db_name: or_default("GDS_DB_NAME", GDS_DB_NAME),
            db_password,
            admin_email: non_empty("GDS_ADMIN_EMAIL"),
            admin_password: non_empty("GDS_ADMIN_PASSWORD"),
        })
    }

    /// Compte administrateur initial : `Ok((email, mot_de_passe))` s'il est
    /// fourni par l'environnement, sinon une erreur explicite (français).
    /// Raccourci sur `plan_bootstrap_admin` (aucun administrateur supposé
    /// présent) : le démarrage réel passe par `plan_bootstrap_admin`, qui tient
    /// compte des comptes déjà en base.
    pub fn bootstrap_admin(&self) -> Result<(String, String), String> {
        match plan_bootstrap_admin(
            self.admin_email.as_deref(),
            self.admin_password.as_deref(),
            0,
        ) {
            BootstrapAdminDecision::Create { email, password } => Ok((email, password)),
            _ => Err(
                "Compte administrateur non défini : renseignez les variables \
                 d'environnement GDS_ADMIN_EMAIL et GDS_ADMIN_PASSWORD pour créer le \
                 premier compte administrateur du service GDS."
                    .to_string(),
            ),
        }
    }
}

/// Décision d'**amorçage** du premier compte administrateur, prise au démarrage
/// du serveur à partir de `GDS_ADMIN_EMAIL` / `GDS_ADMIN_PASSWORD` et du nombre
/// d'administrateurs déjà présents en base.
///
/// Le mot de passe n'est porté que par la variante `Create` : les branches qui
/// ne créent rien ne le manipulent jamais, donc rien de secret ne peut être
/// journalisé par erreur.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapAdminDecision {
    /// Les deux variables sont renseignées et aucun administrateur n'existe :
    /// créer le compte.
    Create { email: String, password: String },
    /// Les deux variables sont renseignées mais un administrateur existe déjà :
    /// ne rien écraser (le noter et continuer).
    AlreadyInitialized,
    /// Une seule des deux variables est renseignée : avertir et continuer sans
    /// rien créer.
    Incomplete,
    /// Aucune des deux : l'initialisation reste possible via
    /// `POST /api/gds/setup`.
    NotRequested,
}

/// Décide de l'amorçage du premier administrateur — **pure**, donc testable
/// sans base de données (les tests serveur couvrent les trois cas : les deux
/// variables, un administrateur déjà présent, une seule variable).
///
/// `admins_existing` est le nombre d'administrateurs déjà en base, lu par
/// l'appelant (`gds_core::db::count_admins`).
pub fn plan_bootstrap_admin(
    admin_email: Option<&str>,
    admin_password: Option<&str>,
    admins_existing: i64,
) -> BootstrapAdminDecision {
    match (admin_email, admin_password) {
        (Some(_), Some(_)) if admins_existing > 0 => BootstrapAdminDecision::AlreadyInitialized,
        (Some(email), Some(password)) => BootstrapAdminDecision::Create {
            email: email.to_string(),
            password: password.to_string(),
        },
        (Some(_), None) | (None, Some(_)) => BootstrapAdminDecision::Incomplete,
        (None, None) => BootstrapAdminDecision::NotRequested,
    }
}

/// Port SSH de l'environnement : entier > 0 attendu, sinon valeur par défaut
/// (`22`). Une valeur invalide n'interrompt pas le démarrage (défaut sûr).
fn parse_ssh_port(raw: Option<&str>) -> u16 {
    match raw {
        Some(v) => match v.trim().parse::<u16>() {
            Ok(p) if p > 0 => p,
            _ => default_ssh_port(),
        },
        None => default_ssh_port(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn cfg_lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + 'static {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |name: &str| map.get(name).cloned()
    }

    // ── ServerConfig : environnement du service ──

    #[test]
    fn server_config_defaults_when_only_password_is_provided() {
        let cfg = ServerConfig::from_lookup(cfg_lookup(&[("POSTGRES_PASSWORD", "s3cret")])).unwrap();
        assert_eq!(cfg.db_password, "s3cret");
        assert_eq!(cfg.http_bind, "0.0.0.0:8080");
        assert_eq!(cfg.pg_bind, "0.0.0.0:5432");
        assert_eq!(cfg.ssh_port, 22);
        assert_eq!(cfg.repos_root, "/srv/git/repos");
        assert_eq!(cfg.tls_mode, "none");
        assert_eq!(cfg.db_host, "localhost");
        assert_eq!(cfg.db_port, "5432");
        assert_eq!(cfg.db_user, "pilot");
        assert_eq!(cfg.db_name, "pilot_gds");
        assert_eq!(cfg.public_url, "");
        assert_eq!(cfg.admin_email, None);
        assert_eq!(cfg.admin_password, None);
    }

    #[test]
    fn server_config_reads_every_documented_variable() {
        let cfg = ServerConfig::from_lookup(cfg_lookup(&[
            ("POSTGRES_PASSWORD", "pwd"),
            ("GDS_HTTP_BIND", "127.0.0.1:9000"),
            ("GDS_PG_BIND", "127.0.0.1:5433"),
            ("GDS_SSH_PORT", "2222"),
            ("GDS_REPOS_ROOT", "/var/git/repos"),
            ("GDS_PUBLIC_URL", "https://gds.example.com"),
            ("GDS_TLS_MODE", "tailscale"),
            ("GDS_DB_HOST", "db.internal"),
            ("GDS_DB_PORT", "6543"),
            ("GDS_DB_USER", "svc"),
            ("GDS_DB_NAME", "pilot_gds_test"),
            ("GDS_ADMIN_EMAIL", "admin@example.com"),
            ("GDS_ADMIN_PASSWORD", "adminpwd"),
        ]))
        .unwrap();
        assert_eq!(cfg.http_bind, "127.0.0.1:9000");
        assert_eq!(cfg.pg_bind, "127.0.0.1:5433");
        assert_eq!(cfg.ssh_port, 2222);
        assert_eq!(cfg.repos_root, "/var/git/repos");
        assert_eq!(cfg.public_url, "https://gds.example.com");
        assert_eq!(cfg.tls_mode, "tailscale");
        assert_eq!(cfg.db_host, "db.internal");
        assert_eq!(cfg.db_port, "6543");
        assert_eq!(cfg.db_user, "svc");
        assert_eq!(cfg.db_name, "pilot_gds_test");
        assert_eq!(cfg.admin_email.as_deref(), Some("admin@example.com"));
        assert_eq!(cfg.admin_password.as_deref(), Some("adminpwd"));
        assert!(cfg.bootstrap_admin().is_ok());
    }

    #[test]
    fn server_config_missing_db_password_has_clear_french_message() {
        let err = ServerConfig::from_lookup(cfg_lookup(&[])).unwrap_err();
        assert!(err.contains("POSTGRES_PASSWORD"), "message attendu: {}", err);
        assert!(err.contains("base de données"), "message attendu: {}", err);
        // Une valeur vide (présente mais vide) équivaut à absente.
        let err2 = ServerConfig::from_lookup(cfg_lookup(&[("POSTGRES_PASSWORD", "   ")])).unwrap_err();
        assert!(err2.contains("POSTGRES_PASSWORD"));
    }

    #[test]
    fn server_config_bootstrap_admin_requires_both_values() {
        let only_email =
            ServerConfig::from_lookup(cfg_lookup(&[("POSTGRES_PASSWORD", "pwd"), ("GDS_ADMIN_EMAIL", "a@b.c")]))
                .unwrap();
        let err = only_email.bootstrap_admin().unwrap_err();
        assert!(err.contains("GDS_ADMIN_EMAIL"), "message attendu: {}", err);
        assert!(err.contains("GDS_ADMIN_PASSWORD"), "message attendu: {}", err);
        let neither = ServerConfig::from_lookup(cfg_lookup(&[("POSTGRES_PASSWORD", "pwd")])).unwrap();
        assert!(neither.bootstrap_admin().is_err());
    }

    #[test]
    fn server_config_invalid_ssh_port_falls_back_to_default() {
        for bad in ["abc", "0", "-3", "70000"] {
            let cfg = ServerConfig::from_lookup(cfg_lookup(&[
                ("POSTGRES_PASSWORD", "pwd"),
                ("GDS_SSH_PORT", bad),
            ]))
            .unwrap();
            assert_eq!(cfg.ssh_port, 22, "port invalide {} → défaut 22", bad);
        }
    }

    // ── Config du POSTE : le socle expose bien les helpers purs partagés ──

    #[test]
    fn core_exposes_project_remote_url_rules_unchanged() {
        // Serveur LOCAL à racine Windows (natif historique) : URL historique.
        let local = GdsConfig {
            enabled: true,
            server_url: String::new(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_port: 0,
            gds_server_repos: Some("C:\\GDS\\repos".to_string()),
            ssh_host: "127.0.0.1:22".to_string(),
            db_host: "127.0.0.1".to_string(),
            db_port: "5432".to_string(),
            db_user: "postgres".to_string(),
        };
        assert!(is_local_gds_server(&local));
        assert_eq!(gds_remote_url(&local, "proj"), "ssh://git@127.0.0.1:22/proj.git");

        // Serveur vu comme local mais racine POSIX ABSOLUE (SERVEUR EN
        // CONTENEUR sur la même machine) : la racine fait autorité, sinon l'URL
        // ne désigne aucun dépôt sur le serveur.
        let container = GdsConfig {
            gds_server_repos: Some("/srv/git/repos".to_string()),
            ssh_port: 2222,
            ssh_host: "127.0.0.1:2222".to_string(),
            ..local.clone()
        };
        assert!(is_local_gds_server(&container));
        assert_eq!(
            gds_remote_url(&container, "proj"),
            "ssh://git@127.0.0.1:2222/srv/git/repos/proj.git"
        );

        // Serveur DISTANT : chemin absolu sous la racine serveur, port SSH dédié.
        let distant = GdsConfig {
            enabled: true,
            server_url: String::new(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_port: 2222,
            gds_server_repos: Some("/home/git/repos".to_string()),
            ssh_host: String::new(),
            db_host: "gds.example.com".to_string(),
            db_port: "5432".to_string(),
            db_user: "postgres".to_string(),
        };
        assert!(!is_local_gds_server(&distant));
        assert_eq!(
            gds_remote_url(&distant, "proj"),
            "ssh://git@gds.example.com:2222/home/git/repos/proj.git"
        );
        assert_eq!(join_posix_path("C:\\GDS\\repos", "proj.git"), "C:/GDS/repos/proj.git");
    }
}
