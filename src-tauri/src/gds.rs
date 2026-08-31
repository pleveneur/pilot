// gds.rs — Config GDS par projet (.pilot/gds.json) + provision (spec_gds.md §0.4, §3)
//
// La config GDS vit UNIQUEMENT dans le projet (`.pilot/gds.json`) : activation
// on/off, URL du serveur GDS, identité email, dossier local de clonage.
// AUCUN champ gds_* dans la config globale de Pilot (décision 29/08/2026).

use crate::gds_db;
use crate::gds_git;
use crate::gds_ssh;
use crate::git::{git_current_branch, git_push, git_remote_add};
use crate::web_auth::WebAuth;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;

/// Nom du fichier de secrets GDS (mots de passe), stocké HORS du projet
/// (dans `~/.pilot/`), en 0600, jamais commité. Les mots de passe ne vivent
/// jamais dans `gds.json` (chantier UX GDS) : on ne voit plus d'URL
/// `postgres://user:pass@host` en clair, ni dans le projet ni dans les logs.
pub(crate) const GDS_SECRETS_FILE: &str = "gds_secrets.json";

/// Secrets d'un projet (mots de passe dédié Postgres + compte admin GDS).
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct ProjectSecrets {
    #[serde(default)]
    pub db_password: Option<String>,
    #[serde(default)]
    pub admin_password: Option<String>,
}

/// Fichier de secrets global (`~/.pilot/gds_secrets.json`, 0600, hors git),
/// indexé par nom de projet (chaque projet a son propre serveur GDS).
#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct GdsSecrets {
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectSecrets>,
}

/// Chemin du fichier de secrets (`~/.pilot/gds_secrets.json`).
fn secrets_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "HOME/USERPROFILE introuvable".to_string())?;
    if home.is_empty() {
        return Err("HOME/USERPROFILE vide".to_string());
    }
    let dir = PathBuf::from(&home).join(".pilot");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Création ~/.pilot: {}", e))?;
    Ok(dir.join(GDS_SECRETS_FILE))
}

/// Lit les secrets GDS (fichier absent → defaults). Aucun secret dans les logs.
pub(crate) fn read_gds_secrets() -> Result<GdsSecrets, String> {
    let path = secrets_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).map_err(|e| format!("gds_secrets invalid: {}", e)),
        Err(_) => Ok(GdsSecrets::default()),
    }
}

/// Écrit les secrets GDS (`~/.pilot/gds_secrets.json`), permissions 0600
/// best-effort (Unix). Sur Windows, l'ACL contrôle l'accès.
pub(crate) fn write_gds_secrets(secrets: &GdsSecrets) -> Result<(), String> {
    let path = secrets_path()?;
    let content =
        serde_json::to_string_pretty(secrets).map_err(|e| format!("Sérialisation secrets: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Écriture gds_secrets.json: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Enregistre les mots de passe d'un projet dans le fichier de secrets.
pub(crate) fn save_project_secrets(
    project: &str,
    db_password: &str,
    admin_password: &str,
) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    let entry = secrets.projects.entry(project_name(project)).or_default();
    if !db_password.is_empty() {
        entry.db_password = Some(db_password.to_string());
    }
    if !admin_password.is_empty() {
        entry.admin_password = Some(admin_password.to_string());
    }
    write_gds_secrets(&secrets)
}

/// Pourcentage-encodage minimal (RFC 3986) d'un segment d'URL (ex: mot de
/// passe) pour construire une URL `postgres://user:pass@host/db` exploitable.
pub(crate) fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

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

/// Config GDS d'un projet (`.pilot/gds.json`).
///
/// Les mots de passe ne sont JAMAIS stockés ici : ils vivent dans
/// `~/.pilot/gds_secrets.json` (`GdsSecrets`). L'hôte/port/utilisateur
/// PostgreSQL sont en champs distincts (`db_host`/`db_port`/`db_user`) ;
/// `server_url` est dérivé SANS mot de passe (rétrocompat : d'anciennes
/// configs pouvaient embarquer une URL `postgres://user:pass@host:port/db`).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GdsConfig {
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
    /// Hôte SSH (host:22) du serveur GDS, dérivé de `db_host` à la provision.
    /// Utilisé pour construire l'URL du remote git (transport SSH).
    #[serde(default)]
    pub ssh_host: String,
    /// Email de la personne désignée autorisée à passer en mode urgent (Phase B).
    /// Vide = aucun urgent autorisé (arbitrage 6 : réservé à la personne désignée).
    #[serde(default)]
    pub urgent_email: Option<String>,
}

impl GdsConfig {
    /// Normalise la config : dérive `db_host`/`db_port`/`db_user` depuis une
    /// ancienne `server_url`, reconstruit `server_url` SANS mot de passe et
    /// dérive `ssh_host` depuis `db_host`. Rétrocompat des `.pilot/gds.json`.
    fn normalize(&mut self) {
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
        if self.ssh_host.is_empty() && !self.db_host.is_empty() {
            self.ssh_host = format!("{}:22", self.db_host);
        }
    }
}

/// Dossier local par défaut des projets GDS (clonage).
/// Windows : `C:\GDS` (hors du profil utilisateur) — le user `git` du serveur
/// GDS local n'a pas accès au profil de l'utilisateur courant, ce qui faisait
/// échouer le clone SSH (`Set-Location : Accès refusé`). Décision utilisateur.
/// Linux/macOS : `~/Pilot/GDS` (inchangé).
pub(crate) fn default_gds_local_dir() -> String {
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

pub(crate) fn gds_config_path(project: &str) -> PathBuf {
    PathBuf::from(project).join(".pilot").join("gds.json")
}

pub(crate) fn read_gds_config(project: &str) -> Result<GdsConfig, String> {
    let path = gds_config_path(project);
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Lecture gds.json: {}", e))?;
    let mut cfg: GdsConfig =
        serde_json::from_str(&content).map_err(|e| format!("gds.json invalide: {}", e))?;
    cfg.normalize();
    Ok(cfg)
}

/// Écrit la config GDS (`.pilot/gds.json`) APRÈS normalisation : garantit
/// qu'aucun mot de passe n'apparaît dans `server_url` (rétrocompat).
pub(crate) fn write_gds_config(project: &str, cfg: &GdsConfig) -> Result<(), String> {
    let mut c = cfg.clone();
    c.normalize();
    let path = gds_config_path(project);
    let dir = path.parent().ok_or("Chemin gds.json invalide")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Création .pilot: {}", e))?;
    let content =
        serde_json::to_string_pretty(&c).map_err(|e| format!("Sérialisation gds.json: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Écriture gds.json: {}", e))
}

#[allow(dead_code)] // API config GDS, utilisée par l'UI desktop (Phase A UI)
pub(crate) fn is_gds_enabled(project: &str) -> bool {
    read_gds_config(project).map(|c| c.enabled).unwrap_or(false)
}

/// Hôte (host:port) extrait d'une URL serveur GDS, pour construire l'URL git SSH.
fn server_host(server_url: &str) -> String {
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
fn ssh_host_from_server_url(server_url: &str) -> String {
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
    format!("{}:22", host)
}

/// Hôte SSH (host:22) dérivé de l'hôte PostgreSQL du serveur GDS.
/// `host` → `host:22` (port SSH 22, pas le port PostgreSQL 5432).
fn ssh_host_from_db_addr(db_addr: &str) -> String {
    ssh_host_from_server_url(db_addr)
}

/// Hôte SSH (host:22) dérivé de l'hôte PostgreSQL (`db_host`).
fn ssh_host_from_db_host(db_host: &str) -> String {
    let host = db_host.trim();
    if host.is_empty() {
        String::new()
    } else {
        format!("{}:22", host)
    }
}

/// Nom de projet (dernier segment du chemin) — ex: `/path/to/proj` → `proj`.
pub(crate) fn project_name(project: &str) -> String {
    std::path::Path::new(project)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// URL du remote git GDS d'un projet (`ssh://git@<host>/<name>.git`).
/// Hôte SSH dédié (renseigné à la provision) ; repli sur server_url si absent
/// (configs anciennes). Évite d'embarquer le port PostgreSQL 5432 dans l'URL SSH.
pub(crate) fn gds_remote_url(cfg: &GdsConfig, project_name: &str) -> String {
    let host = if cfg.ssh_host.is_empty() {
        if cfg.db_host.is_empty() {
            server_host(&cfg.server_url)
        } else {
            format!("{}:22", cfg.db_host)
        }
    } else {
        cfg.ssh_host.clone()
    };
    format!("ssh://git@{}/{}.git", host, project_name)
}

/// Provisionne la base GDS (test connexion → provision → migrate → admin) et
/// retourne le pool applicatif. Partagé entre la commande Tauri et la route web.
pub(crate) async fn provision_db(
    db_addr: &str,
    db_user: &str,
    db_password: &str,
    admin_email: &str,
    admin_password: &str,
) -> Result<PgPool, String> {
    // 1. Test connexion PostgreSQL AVANT activation.
    let _test = gds_db::connect(db_addr).await?;
    // 2. Provision base + user dédié.
    gds_db::provision(db_addr, gds_db::GDS_DB_NAME, db_user, db_password).await?;
    // 3. Pool applicatif + migrations.
    let app_url = gds_db::app_url_from_admin(db_addr, gds_db::GDS_DB_NAME, db_user, db_password)?;
    let pool = gds_db::connect(&app_url).await?;
    gds_db::migrate(&pool).await?;
    // 4. Provision premier user admin (idempotent).
    let admin_email = admin_email.trim().to_string();
    if !admin_email.is_empty() {
        let existing = gds_db::get_user_by_email(&pool, &admin_email).await?;
        if existing.is_none() {
            let hash = WebAuth::hash_password(admin_password).unwrap_or_default();
            let _ = gds_db::create_user(&pool, &admin_email, "admin", &hash, "admin", "active").await;
        }
    }
    Ok(pool)
}

/// Ajoute un projet au GDS (bare + enregistrement + remote add + push initial).
/// Partagé entre la commande Tauri et la route web.
pub(crate) async fn add_project_to_gds(pool: &PgPool, project: &str, email: &str) -> Result<Value, String> {
    let cfg = read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    // Phase A3 : s'assurer que la clef du poste est enregistrée pour que le
    // remote `ssh://git@<host>:22/<projet>.git` soit utilisable.
    gds_ssh::ensure_poste_key(pool, email).await?;
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let name = project_name(project);
    let res = gds_git::add_project(pool, &local_dir, &name, email, "").await?;
    // git remote add + push initial dans le projet local (bloquant → spawn_blocking).
    let repo_url = gds_remote_url(&cfg, &name);
    let project_owned = project.to_string();
    let repo_url_owned = repo_url.clone();
    // Remote dédié `gds` (et non `origin`) : préserve un éventuel remote
    // `origin` existant (ex: GitHub) et reste idempotent — `git_remote_add`
    // retire puis ré-ajoute le remote `gds` sans toucher aux autres.
    tokio::task::spawn_blocking(move || {
        git_remote_add(&project_owned, "gds", &repo_url_owned)?;
        let branch = git_current_branch(&project_owned);
        if !branch.is_empty() && branch != "HEAD" {
            git_push(&project_owned, "gds", &branch)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(json!({ "ok": true, "project": name, "repo_url": repo_url, "bare": res }))
}

/// Commande Tauri : provisionne le serveur GDS du projet (base + migrations +
/// dossier repos) et active le GDS (écrit `.pilot/gds.json`).
///
/// Les mots de passe sont stockés HORS du projet (`~/.pilot/gds_secrets.json`,
/// 0600) via `save_project_secrets` ; `.pilot/gds.json` ne contient jamais de
/// mot de passe. Hôte/port/utilisateur sont en champs distincts (`db_host`,
/// `db_port`, `db_user`) au lieu d'une URL `postgres://user:pass@host:port/db`.
/// Un mot de passe laissé vide est repris des secrets si déjà enregistré (la
/// ressaisie n'est nécessaire qu'à la première configuration).
#[tauri::command]
pub async fn gds_provision(
    state: State<'_, AppState>,
    project: String,
    db_host: String,
    db_port: String,
    db_user: String,
    db_password: String,
    admin_email: String,
    admin_password: String,
) -> Result<Value, String> {
    let host = db_host.trim().to_string();
    let port = if db_port.trim().is_empty() {
        "5432".to_string()
    } else {
        db_port.trim().to_string()
    };
    let user = db_user.trim().to_string();
    if host.is_empty() || user.is_empty() {
        return Err("Hôte et utilisateur PostgreSQL sont requis".to_string());
    }
    // Reprise des mots de passe depuis les secrets si non ressaisis.
    let secrets = read_gds_secrets()?;
    let stored = secrets.projects.get(&project_name(&project)).cloned().unwrap_or_default();
    let mut db_password = db_password;
    if db_password.trim().is_empty() {
        db_password = stored.db_password.clone().unwrap_or_default();
    }
    if db_password.trim().is_empty() {
        return Err("Mot de passe dédié PostgreSQL requis".to_string());
    }
    let mut admin_password = admin_password;
    if admin_password.trim().is_empty() {
        admin_password = stored.admin_password.clone().unwrap_or_default();
    }
    if !admin_email.trim().is_empty() && admin_password.trim().is_empty() {
        return Err("Mot de passe admin requis (ou l'email admin est à vide)".to_string());
    }
    // URL admin reconstruite à la volée (jamais persistée ni loggée).
    let db_addr = format!(
        "postgres://{}:{}@{}:{}/postgres",
        user,
        url_encode(&db_password),
        host,
        port
    );
    let pool =
        provision_db(&db_addr, &user, &db_password, &admin_email, &admin_password).await?;
    // Phase A3 : provision SSH serveur (user git + authorized_keys + sshd) puis
    // générer la clef du poste et l'enregistrer automatiquement.
    gds_ssh::provision_server_ssh()?;
    gds_ssh::ensure_poste_key(&pool, &admin_email).await?;
    // Dossier des repos. Préserve un `gds_local_dir` existant (re-provision
    // idempotent) : on ne réinitialise pas vers `~/Pilot/GDS` si l'utilisateur
    // a déplacé le dossier (ex: hors du profil, `C:\GDS`).
    let existing = read_gds_config(&project).ok();
    let local_dir = existing
        .and_then(|c| c.gds_local_dir)
        .unwrap_or_else(default_gds_local_dir);
    let repos = gds_git::repos_dir(&local_dir);
    std::fs::create_dir_all(&repos).map_err(|e| format!("Création dossier repos: {}", e))?;
    // Écrire la config projet (activation) SANS mot de passe.
    let cfg = GdsConfig {
        enabled: true,
        db_host: host.clone(),
        db_port: port.clone(),
        db_user: user.clone(),
        identity_email: admin_email.trim().to_string(),
        server_url: format!("postgres://{}@{}:{}/postgres", user, host, port),
        gds_local_dir: Some(local_dir),
        ssh_host: ssh_host_from_db_host(&host),
        urgent_email: None,
    };
    write_gds_config(&project, &cfg)?;
    // Stocker les mots de passe hors projet (0600, hors git).
    save_project_secrets(&project, &db_password, &admin_password)?;
    // Stocker le pool dans AppState.
    *state.gds_pool.lock().unwrap() = Some(pool);
    Ok(json!({ "ok": true, "db": gds_db::GDS_DB_NAME, "repos_dir": repos.to_string_lossy() }))
}

/// Reconnexion automatique : reconstruit le pool PostgreSQL d'un projet GDS
/// déjà provisionné, depuis la config persistée + les secrets, SANS refaire
/// `gds_provision`. Saisie des paramètres une seule fois. Fail-open : un échec
/// (config absente, mot de passe non enregistré, serveur injoignable) ne bloque
/// pas le démarrage — un message actionnable est retourné.
#[tauri::command]
pub async fn gds_restore_pool(state: State<'_, AppState>, project: String) -> Result<Value, String> {
    let cfg = read_gds_config(&project)
        .map_err(|e| format!("GDS non configuré pour ce projet: {}", e))?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    if cfg.db_host.is_empty() || cfg.db_user.is_empty() {
        return Err("GDS configuré mais hôte/utilisateur manquants".to_string());
    }
    let secrets = read_gds_secrets()?;
    let pw = secrets
        .projects
        .get(&project_name(&project))
        .and_then(|p| p.db_password.as_deref())
        .filter(|p| !p.is_empty())
        .ok_or(
            "Mot de passe PostgreSQL non enregistré — ressaisissez-le dans la section 1 (Provisionner)."
                .to_string(),
        )?;
    let app_url = format!(
        "postgres://{}:{}@{}:{}/pilot_gds",
        cfg.db_user,
        url_encode(pw),
        cfg.db_host,
        cfg.db_port
    );
    let pool = gds_db::connect(&app_url).await?;
    let _ = gds_db::migrate(&pool).await; // migrations idempotentes
    *state.gds_pool.lock().unwrap() = Some(pool);
    Ok(json!({ "ok": true, "restored": true }))
}

/// Version sans `State` de la reconnexion, pour le hook de démarrage (setup).
pub(crate) async fn restore_pool_for_project(project: &str) -> Result<PgPool, String> {
    let cfg = read_gds_config(project)?;
    if !cfg.enabled || cfg.db_host.is_empty() || cfg.db_user.is_empty() {
        return Err("GDS non configuré".to_string());
    }
    let secrets = read_gds_secrets()?;
    let pw = secrets
        .projects
        .get(&project_name(project))
        .and_then(|p| p.db_password.as_deref())
        .filter(|p| !p.is_empty())
        .ok_or("Mot de passe PostgreSQL non enregistré".to_string())?;
    let app_url = format!(
        "postgres://{}:{}@{}:{}/pilot_gds",
        cfg.db_user,
        url_encode(pw),
        cfg.db_host,
        cfg.db_port
    );
    let pool = gds_db::connect(&app_url).await?;
    let _ = gds_db::migrate(&pool).await;
    Ok(pool)
}

/// Commande Tauri : état des secrets d'un projet (SANS révéler les valeurs).
/// L'UI l'utilise pour savoir si les champs mot de passe doivent être
/// ressaisis ou pré-remplis (masqués).
#[tauri::command]
pub fn gds_secrets_status(project: String) -> Result<Value, String> {
    let secrets = read_gds_secrets()?;
    let entry = secrets.projects.get(&project_name(&project));
    let has_db = entry
        .and_then(|e| e.db_password.as_deref())
        .map(|p| !p.is_empty())
        .unwrap_or(false);
    let has_admin = entry
        .and_then(|e| e.admin_password.as_deref())
        .map(|p| !p.is_empty())
        .unwrap_or(false);
    Ok(json!({ "db_password": has_db, "admin_password": has_admin }))
}

/// Commande Tauri : valide un compte utilisateur (superadmin) → status active.
#[tauri::command]
pub async fn gds_validate_user(state: State<'_, AppState>, email: String) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::set_user_status(&pool, &email, "active").await?;
    Ok(json!({ "ok": true, "email": email, "status": "active" }))
}

/// Commande Tauri : ajoute le projet courant au GDS (bare + remote + push).
#[tauri::command]
pub async fn gds_add_project(state: State<'_, AppState>, project: String, email: String) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    add_project_to_gds(&pool, &project, &email).await
}

/// Commande Tauri : lit la config GDS du projet (`.pilot/gds.json`).
/// Retourne `null` si le fichier n'existe pas encore (projet non activé).
#[tauri::command]
pub fn gds_get_config(project: String) -> Result<Option<GdsConfig>, String> {
    match read_gds_config(&project) {
        Ok(cfg) => Ok(Some(cfg)),
        Err(e) if e.starts_with("Lecture gds.json") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Commande Tauri : écrit la config GDS du projet (`.pilot/gds.json`).
///
/// - Dérive `ssh_host` depuis l'hôte PostgreSQL si vide ou si l'adresse a changé.
/// - Préserve `urgent_email`, `gds_local_dir`, `db_host`, `db_port`, `db_user`
///   si le payload ne les inclut pas (l'UI simplifiée n'envoie plus que
///   `enabled` + `identity_email`) — sinon perte de données à chaque sauvegarde.
/// - L'UI n'envoie plus jamais d'URL à mot de passe : `server_url` est toujours
///   reconstruit SANS mot de passe par `write_gds_config` (normalize).
#[tauri::command]
pub fn gds_save_config(project: String, mut cfg: GdsConfig) -> Result<(), String> {
    let existing = read_gds_config(&project).ok();
    if cfg.urgent_email.is_none() {
        if let Some(ex) = &existing {
            cfg.urgent_email = ex.urgent_email.clone();
        }
    }
    if cfg.gds_local_dir.is_none() {
        if let Some(ex) = &existing {
            cfg.gds_local_dir = ex.gds_local_dir.clone();
        }
    }
    // Préserve les champs PostgreSQL non envoyés par l'UI (hôte/port/user).
    if cfg.db_host.is_empty() {
        if let Some(ex) = &existing {
            cfg.db_host = ex.db_host.clone();
        }
    }
    if cfg.db_port.is_empty() {
        if let Some(ex) = &existing {
            cfg.db_port = ex.db_port.clone();
        }
    }
    if cfg.db_user.is_empty() {
        if let Some(ex) = &existing {
            cfg.db_user = ex.db_user.clone();
        }
    }
    // Recalcule ssh_host si vide ou si l'adresse a changé (via server_url dérivé).
    let recompute = cfg.ssh_host.is_empty()
        || existing
            .as_ref()
            .map(|ex| ex.server_url != cfg.server_url)
            .unwrap_or(true);
    if recompute {
        cfg.ssh_host = ssh_host_from_server_url(&cfg.server_url);
    }
    write_gds_config(&project, &cfg)
}

/// Commande Tauri : liste les projets enregistrés sur le serveur GDS.
#[tauri::command]
pub async fn gds_list_projects(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::list_projects(&pool).await
}

/// Commande Tauri : liste les dépôts git (bare) enregistrés sur le serveur GDS.
#[tauri::command]
pub async fn gds_list_git_repos(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    gds_db::list_git_repos(&pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_host_handles_http_https_ssh() {
        assert_eq!(server_host("http://192.168.1.10:8080"), "192.168.1.10:8080");
        assert_eq!(server_host("https://gds.example.com"), "gds.example.com");
        assert_eq!(server_host("ssh://git@192.168.1.10"), "git@192.168.1.10");
    }

    #[test]
    fn ssh_host_from_postgres_url_uses_ssh_port() {
        // Le bug bloquant : le port PostgreSQL 5432 ne doit pas être embarqué.
        assert_eq!(
            ssh_host_from_db_addr("postgres://postgres:secret@192.168.1.10:5432/postgres"),
            "192.168.1.10:22"
        );
        assert_eq!(
            ssh_host_from_db_addr("postgres://user:pw@db.local:5432/pilot_gds"),
            "db.local:22"
        );
    }

    #[test]
    fn ssh_host_derived_from_http_https_ssh_urls() {
        assert_eq!(ssh_host_from_server_url("http://192.168.1.10:8080"), "192.168.1.10:22");
        assert_eq!(ssh_host_from_server_url("https://gds.example.com"), "gds.example.com:22");
        assert_eq!(ssh_host_from_server_url("ssh://git@192.168.1.10"), "192.168.1.10:22");
        assert_eq!(
            ssh_host_from_server_url("postgres://postgres:secret@192.168.1.10:5432/postgres"),
            "192.168.1.10:22"
        );
    }

    #[test]
    fn gds_save_config_recomputes_ssh_host_when_server_url_changes() {
        let dir = std::env::temp_dir().join(format!("pilot-gds-test-recompute-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        let initial = GdsConfig {
            enabled: true,
            server_url: "postgres://postgres:secret@old.host:5432/postgres".to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: "old.host:22".to_string(),
            urgent_email: Some("admin@kalico".to_string()),
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        write_gds_config(&project, &initial).unwrap();
        // Sauvegarde avec une nouvelle URL et ssh_host vide (l'UI ne l'envoie plus).
        let new_cfg = GdsConfig {
            enabled: true,
            server_url: "https://new.host".to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: String::new(),
            urgent_email: None,
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        gds_save_config(project.clone(), new_cfg).unwrap();
        let saved = read_gds_config(&project).unwrap();
        // ssh_host recalculé depuis la nouvelle URL.
        assert_eq!(saved.ssh_host, "new.host:22");
        // urgent_email préservé (non envoyé par l'UI).
        assert_eq!(saved.urgent_email.as_deref(), Some("admin@kalico"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gds_save_config_preserves_ssh_host_when_url_unchanged() {
        let dir = std::env::temp_dir().join(format!("pilot-gds-test-preserve-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        let initial = GdsConfig {
            enabled: true,
            server_url: "postgres://postgres:secret@host:5432/postgres".to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: Some("/custom/dir".to_string()),
            ssh_host: "custom:2222".to_string(),
            urgent_email: None,
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        write_gds_config(&project, &initial).unwrap();
        // Sauvegarde avec la même URL, ssh_host et gds_local_dir non envoyés.
        let new_cfg = GdsConfig {
            enabled: true,
            server_url: "postgres://postgres:secret@host:5432/postgres".to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: String::new(),
            urgent_email: None,
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        gds_save_config(project.clone(), new_cfg).unwrap();
        let saved = read_gds_config(&project).unwrap();
        // ssh_host recalculé (vide → dérivé), gds_local_dir préservé.
        assert_eq!(saved.ssh_host, "host:22");
        assert_eq!(saved.gds_local_dir.as_deref(), Some("/custom/dir"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ssh_remote_url_construction_uses_ssh_host() {
        let db_addr = "postgres://postgres:secret@192.168.1.10:5432/postgres";
        let cfg = GdsConfig {
            enabled: true,
            server_url: db_addr.to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: ssh_host_from_db_addr(db_addr),
            urgent_email: None,
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        let repo_url = format!("ssh://git@{}/{}", cfg.ssh_host, "proj.git");
        assert_eq!(repo_url, "ssh://git@192.168.1.10:22/proj.git");
    }

    #[test]
    fn write_gds_config_never_embeds_password() {
        // Une config ancienne avec URL postgres://user:pass@host ne doit JAMAIS
        // être réécrite avec le mot de passe en clair dans server_url.
        let dir = std::env::temp_dir().join(format!("pilot-gds-test-nopass-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        let cfg = GdsConfig {
            enabled: true,
            server_url: "postgres://postgres:SUPERSECRET@host:5432/postgres".to_string(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_host: String::new(),
            urgent_email: None,
            db_host: "host".to_string(),
            db_port: "5432".to_string(),
            db_user: "postgres".to_string(),
        };
        write_gds_config(&project, &cfg).unwrap();
        let content = std::fs::read_to_string(gds_config_path(&project)).unwrap();
        assert!(!content.contains("SUPERSECRET"));
        assert!(!content.contains("postgres://postgres:"));
        assert!(content.contains("postgres://postgres@host:5432/postgres"));
        // Normalisation : db_host/db_user dérivés restent disponibles.
        let saved = read_gds_config(&project).unwrap();
        assert_eq!(saved.db_host, "host");
        assert_eq!(saved.db_user, "postgres");
        assert_eq!(saved.server_url, "postgres://postgres@host:5432/postgres");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
