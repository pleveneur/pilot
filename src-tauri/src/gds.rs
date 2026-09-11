// gds.rs — Config GDS par projet (.pilot/gds.json) + provision (spec_gds.md §0.4, §3)
//
// La config GDS vit UNIQUEMENT dans le projet (`.pilot/gds.json`) : activation
// on/off, URL du serveur GDS, identité email, dossier local de clonage.
// AUCUN champ gds_* dans la config globale de Pilot (décision 29/08/2026).

use crate::gds_db;
use crate::gds_git;
use crate::gds_ssh;
use crate::git::{ensure_git_repo_with_identity, git_clone, git_config_user_email, git_config_user_name, git_current_branch, git_has_remote, git_is_repo, git_push, git_remote_add, git_remote_remove};
use crate::web_auth::WebAuth;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
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

/// Secrets d'un serveur GDS mémorisé (`~/.pilot/gds_secrets.json`, map
/// `servers`), clé composite (db_host + db_user). Permet de réutiliser une
/// connexion déjà configurée (Évolution 1) sans ressaisir les mots de passe.
/// Jamais révélés à l'UI : la liste ne remonte que hôte/port/utilisateur.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct ServerCredentials {
    #[serde(default)]
    pub db_port: String,
    #[serde(default)]
    pub db_password: Option<String>,
    #[serde(default)]
    pub admin_password: Option<String>,
    /// Vrai si la connexion au serveur a été VALIDÉE (test de connexion effectif
    /// réussi à la provision). Seuls les serveurs validés sont proposés dans la
    /// liste des serveurs mémorisés. Défaut true pour rétrocompatibilité des
    /// serveurs déjà enregistrés (tous issus d'une provision réussie).
    #[serde(default = "default_validated")]
    pub validated: bool,
}

/// Défaut `validated = true` : les serveurs déjà enregistrés (Évolution 1)
/// proviennent toujours d'une provision où le test de connexion a réussi.
fn default_validated() -> bool {
    true
}

/// Fichier de secrets global (`~/.pilot/gds_secrets.json`, 0600, hors git),
/// indexé par nom de projet (chaque projet a son propre serveur GDS). Évolution
/// 1 : conserve le champ `projects` (rétrocompat) et ajoute une map `servers`
/// mémorisant les connexions par serveur (clé db_host + db_user).
///
/// `git_name` : nom git mémorisé (demandé UNE SEULE FOIS à l'utilisateur, puis
/// pré-rempli/désactivé aux demandes suivantes) pour l'identité git auto à
/// l'ajout d'un projet. Non sensible (pas un secret) — il vit dans la même
/// structure de config, jamais de mot de passe en clair.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct GdsSecrets {
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectSecrets>,
    /// Connexions mémorisées par serveur (Évolution 1) — clé `user@host`.
    #[serde(default)]
    pub servers: BTreeMap<String, ServerCredentials>,
    /// Nom git mémorisé (identité git auto, GDS). Vide = jamais saisi.
    #[serde(default)]
    pub git_name: String,
    /// Email d'identité GLOBAL de l'utilisateur (saisi UNE SEULE fois, puis
    /// pré-rempli dans tous les champs email de l'interface, et utilisé comme
    /// admin email à la provision automatique). Vide = jamais saisi. Non
    /// sensible (pas un secret) mais vit dans le fichier 0600. Migration
    /// tolérante serde default : les anciens fichiers sans ce champ le lisent
    /// comme vide.
    #[serde(default)]
    pub identity_email: String,
}

/// Chemin du fichier de secrets (`~/.pilot/gds_secrets.json`).
/// Sous `#[test]` uniquement : si un override thread-local GDS est posé, il est
/// utilisé à la place pour que les tests n'écrivent JAMAIS dans le vrai fichier
/// utilisateur.
fn secrets_path() -> Result<PathBuf, String> {
    #[cfg(test)]
    {
        if let Some(p) = test_gds_secrets_override_path() {
            return Ok(p);
        }
    }
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

// ── Isolation des tests GDS vis-à-vis du fichier secrets réel ──
//
// En mode test, un override thread-local (`TEST_GDS_SECRETS_OVERRIDE`)
// redirige `secrets_path()` vers un fichier TEMPORAIRE dédié. Chaque test pose
// son guard (Drop) : le fichier temporaire est retiré systématiquement, même en
// cas de panique, et le vrai `~/.pilot/gds_secrets.json` n'est jamais touché.

#[cfg(test)]
thread_local! {
    static TEST_GDS_SECRETS_OVERRIDE: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn test_gds_secrets_override_path() -> Option<PathBuf> {
    TEST_GDS_SECRETS_OVERRIDE.with(|c| c.borrow().clone())
}

/// Compteur global pour rendre chaque fichier temporaire unique par test.
#[cfg(test)]
static TEST_GDS_SECRETS_COUNTER: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Guard posé au début des tests GDS : dirige les secrets vers un fichier
/// temporaire (jetable, retiré au Drop, même en cas de panique) et ne touche
/// jamais au vrai `~/.pilot/gds_secrets.json`.
#[cfg(test)]
#[derive(Default)]
struct TestGdsSecretsGuard;

#[cfg(test)]
impl TestGdsSecretsGuard {
    fn new() -> Self {
        let n = TEST_GDS_SECRETS_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "pilot-gds-secrets-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = std::fs::remove_file(&path);
        TEST_GDS_SECRETS_OVERRIDE.with(|c| *c.borrow_mut() = Some(path));
        TestGdsSecretsGuard
    }
}

#[cfg(test)]
impl Drop for TestGdsSecretsGuard {
    fn drop(&mut self) {
        if let Some(p) = test_gds_secrets_override_path() {
            let _ = std::fs::remove_file(&p);
        }
        TEST_GDS_SECRETS_OVERRIDE.with(|c| *c.borrow_mut() = None);
    }
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

// ── Mémorisation des connexions par serveur (Évolution 1) ──
//
// La map `servers` du fichier de secrets stocke les mots de passe d'un serveur
// GDS indépendamment de l'activation par projet (clé `user@host`). Permet de
// réutiliser un serveur déjà provisionné sur un autre projet sans ressaisir
// les mots de passe. Les mots de passe ne sont JAMAIS remontés à l'UI.

/// Clé composite d'un serveur : `user@host` (les mots de passe sont réutilisés
/// quel que soit le port). Pure — testable.
pub(crate) fn server_key(host: &str, user: &str) -> String {
    format!("{}@{}", user.trim(), host.trim())
}

/// Retourne les mots de passe mémorisés pour un serveur (None si jamais vu).
/// `port` n'est pas utilisé comme clé (les mots de passe sont réutilisés quel
/// que soit le port d'un même hôte/utilisateur). Les valeurs ne doivent JAMAIS
/// être renvoyées à l'UI (seulement au provision).
pub(crate) fn get_saved_server(
    host: &str,
    port: &str,
    user: &str,
) -> Result<Option<ServerCredentials>, String> {
    let _ = port;
    let secrets = read_gds_secrets()?;
    Ok(secrets
        .servers
        .get(&server_key(host, user))
        .cloned()
        .filter(|c| !c.db_password.as_deref().unwrap_or("").is_empty()))
}

/// Liste les serveurs mémorisés SANS les mots de passe (pour l'UI) :
/// `[{ host, port, user }]`. Fail-open : erreur → liste vide.
pub(crate) fn list_saved_servers() -> Vec<Value> {
    let secrets = match read_gds_secrets() {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    secrets
        .servers
        .iter()
        // Seuls les serveurs dont la connexion a été VALIDÉE sont proposés :
        // un serveur n'est ajouté à la liste qu'après un test de connexion
        // effectif réussi (marqué validé à l'enregistrement).
        .filter(|(_, c)| c.validated)
        .map(|(key, c)| {
            let (user, host) = match key.split_once('@') {
                Some((u, h)) => (u.to_string(), h.to_string()),
                None => (key.clone(), String::new()),
            };
            json!({
                "host": host,
                "port": if c.db_port.is_empty() { "5432" } else { &c.db_port },
                "user": user,
                "validated": true,
            })
        })
        .collect()
}

/// Nom git mémorisé (vide si jamais saisi). Lecture de la config mémoire GDS.
pub(crate) fn memorized_git_name() -> Option<String> {
    read_gds_secrets()
        .ok()
        .map(|s| s.git_name.trim().to_string())
        .filter(|n| !n.is_empty())
}

/// Email d'identité GLOBAL mémorisé (vide si jamais saisi). Utilisé pour
/// pré-remplir tous les champs email de l'UI (identité unique saisie une fois)
/// et comme admin email à la provision automatique.
pub(crate) fn global_identity_email() -> Option<String> {
    read_gds_secrets()
        .ok()
        .map(|s| s.identity_email.trim().to_string())
        .filter(|e| !e.is_empty())
}

/// Résout l'email à utiliser pour une opération GDS : l'email fourni par
/// l'appelant PRIME, sinon repli sur l'identité globale mémorisée. Pure.
pub(crate) fn effective_identity_email(email: &str) -> String {
    let e = email.trim();
    if !e.is_empty() {
        e.to_string()
    } else {
        global_identity_email().unwrap_or_default()
    }
}

/// Résout le NOM GIT à utiliser pour configurer l'identité git locale d'un
/// projet GDS : le nom fourni par l'UI (saisi UNE fois par l'utilisateur) PRIME,
/// sinon le nom mémorisé. Échoue avec un message clair si le nom est requis et
/// qu'aucune source n'est disponible. Pure + testable.
pub(crate) fn effective_git_name(git_name: &Option<String>) -> Result<String, String> {
    let provided = git_name.as_deref().map(|s| s.trim()).unwrap_or("");
    if !provided.is_empty() {
        return Ok(provided.to_string());
    }
    if let Some(pref) = memorized_git_name() {
        return Ok(pref);
    }
    Err("Nom git requis : fournissez votre nom git une seule fois (il sera mémorisé et pré-rempli ensuite)."
        .to_string())
}

/// Mémorise le nom git (une fois saisi par l'utilisateur) pour pré-remplissage
/// / désactivation des demandes suivantes. Ne touche JAMAIS aux mots de passe.
pub(crate) fn memorize_git_name(name: &str) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Ok(());
    }
    let mut secrets = read_gds_secrets()?;
    if secrets.git_name != name {
        secrets.git_name = name;
        write_gds_secrets(&secrets)?;
    }
    Ok(())
}

/// Commande Tauri : état de l'identité git d'un projet (à l'ajout au GDS).
/// Retourne `{ name_configured, email_configured, git_name }` — le nom mémorisé
/// (pré-remplissage), sans exposer AUCUN secret.
#[tauri::command]
pub fn gds_git_identity_prefs(project: String) -> Result<Value, String> {
    let n = git_config_user_name(&project);
    let e = git_config_user_email(&project);
    Ok(json!({
        "name_configured": !n.is_empty(),
        "email_configured": !e.is_empty(),
        "git_name": memorized_git_name().unwrap_or_default(),
    }))
}

/// Commande Tauri : mémorise le nom git de l'utilisateur (saisi une seule fois)
/// pour pré-remplissage/désactivation des demandes suivantes. Non sensible.
/// (Conservée pour rétrocompat ; l'UI utilise désormais gds_save_identity.)
#[tauri::command]
pub fn gds_save_git_name(name: String) -> Result<(), String> {
    memorize_git_name(&name)
}

/// Commande Tauri : état de l'identité GLOBALE (email + nom git), SANS aucun
/// secret. Sert à pré-remplir tous les champs email (identité saisie une seule
/// fois) et le nom git. Retourne `{ email, git_name }` (champ vide = jamais
/// saisi).
#[tauri::command]
pub fn gds_identity_prefs() -> Result<Value, String> {
    let secrets = read_gds_secrets()?;
    Ok(json!({
        "email": secrets.identity_email.trim().to_string(),
        "git_name": secrets.git_name.trim().to_string(),
    }))
}

/// Commande Tauri : mémorise l'identité GLOBALE de l'utilisateur (email + nom
/// git, saisis UNE seule fois). Non sensible : vivent dans gds_secrets.json
/// (0600), jamais dans .pilot/gds.json. Ne touche JAMAIS aux mots de passe.
#[tauri::command]
pub fn gds_save_identity(email: String, git_name: String) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    secrets.identity_email = email.trim().to_string();
    if !git_name.trim().is_empty() {
        secrets.git_name = git_name.trim().to_string();
    }
    write_gds_secrets(&secrets)
}

/// Mémorise les mots de passe d'un serveur GDS (indépendamment du projet).
/// Seuls les mots de passe non vides sont enregistrés (ne les écrasent jamais).
pub(crate) fn save_server_credentials(
    host: &str,
    port: &str,
    user: &str,
    db_password: &str,
    admin_password: &str,
) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    let entry = secrets
        .servers
        .entry(server_key(host, user))
        .or_default();
    if port.trim().is_empty() {
        entry.db_port = "5432".to_string();
    } else {
        entry.db_port = port.trim().to_string();
    }
    if !db_password.trim().is_empty() {
        entry.db_password = Some(db_password.trim().to_string());
    }
    if !admin_password.trim().is_empty() {
        entry.admin_password = Some(admin_password.trim().to_string());
    }
    // L'enregistrement n'a lieu qu'APRÈS un test de connexion réussi (appelé
    // depuis gds_provision, uniquement après provision_db qui connecte). On
    // marque donc le serveur comme validé : seuls ces serveurs seront proposés.
    entry.validated = true;
    write_gds_secrets(&secrets)
}

/// Commande Tauri : liste les serveurs GDS mémorisés (hôte/port/utilisateur
/// uniquement — jamais les mots de passe). Pour l'UI section 1 (Évolution 1).
#[tauri::command]
pub fn gds_list_saved_servers() -> Vec<Value> {
    list_saved_servers()
}

/// Commande Tauri : applique un serveur mémorisé à un projet — pré-remplit la
/// config `.pilot/gds.json` (hôte/port/utilisateur/email) et copie les mots de
/// passe dans les secrets du projet pour que `gds_provision` n'exige pas de
/// ressaisie. Échoue proprement si le serveur n'est pas mémorisé.
#[tauri::command]
pub fn gds_apply_server(
    project: String,
    host: String,
    port: String,
    user: String,
    email: String,
) -> Result<Value, String> {
    if host.trim().is_empty() || user.trim().is_empty() {
        return Err("Hôte et utilisateur requis".to_string());
    }
    let saved = get_saved_server(&host, &port, &user)?
        .filter(|s| s.validated)
        .ok_or_else(|| {
            "Ce serveur n'est pas mémorisé (ressaisissez vos mots de passe une première fois)"
                .to_string()
        })?;
    // Copier les mots de passe dans les secrets du projet.
    save_project_secrets(
        &project,
        saved.db_password.as_deref().unwrap_or(""),
        saved.admin_password.as_deref().unwrap_or(""),
    )?;
    // Pré-remplir la config projet (jamais de mot de passe ici).
    let local_dir = read_gds_config(&project)
        .ok()
        .and_then(|c| c.gds_local_dir)
        .unwrap_or_else(default_gds_local_dir);
    let cfg = GdsConfig {
        enabled: true,
        db_host: host.trim().to_string(),
        db_port: if port.trim().is_empty() { "5432".to_string() } else { port.trim().to_string() },
        db_user: user.trim().to_string(),
        identity_email: email.trim().to_string(),
        server_url: format!(
            "postgres://{}@{}:{}/postgres",
            user.trim(),
            host.trim(),
            if port.trim().is_empty() { "5432" } else { port.trim() }
        ),
        gds_local_dir: Some(local_dir.clone()),
        ssh_host: format!("{}:22", host.trim()),
        urgent_email: None,
    };
    write_gds_config(&project, &cfg)?;
    Ok(json!({
        "ok": true,
        "db_host": cfg.db_host,
        "db_port": cfg.db_port,
        "db_user": cfg.db_user,
        "gds_local_dir": local_dir,
        "secrets": true,
    }))
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

/// Ajoute un projet au GDS (initialisation git auto + bare + enregistrement +
/// remote add + push initial). Partagé entre la commande Tauri et la route web.
///
/// Si le projet de travail n'est PAS encore un dépôt Git, Pilot l'initialise
/// automatiquement (git init + premier commit) AVANT de créer le bare serveur —
/// plus aucune commande git manuelle. Identité git auto : si `user.name`/`user.email`
/// (local ou global) manquent, Pilot les règle en LOCAL (`.git/config`, jamais
/// `--global`) — `user.email` = email du compte GDS connecté (`email`, aucune
/// saisie), `user.name` = `git_name` fourni (saisi UNE fois) ou nom mémorisé.
/// Ordre robuste : init local + identité + premier commit → bare serveur →
/// remote add + push. En cas d'échec intermédiaire, le bare serveur créé est
/// retiré proprement (pas d'état « à moitié attaché »).
pub(crate) async fn add_project_to_gds(
    pool: &PgPool,
    project: &str,
    email: &str,
    git_name: Option<String>,
) -> Result<Value, String> {
    let cfg = read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    // Phase A3 : s'assurer que la clef du poste est enregistrée pour que le
    // remote `ssh://git@<host>:22/<projet>.git` soit utilisable.
    gds_ssh::ensure_poste_key(pool, email).await?;
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let name = project_name(project);
    let repo_url = gds_remote_url(&cfg, &name);

    // ── Identité git automatique (avant init/commit) ──
    // user.email (local ou global) manquant → réglé en LOCAL = email du compte
    // GDS connecté (aucune saisie). user.name manquant → résolu depuis `git_name`
    // (saisi une seule fois) ou mémorisé ; sinon message clair.
    let current = tokio::task::spawn_blocking({
        let p = project.to_string();
        move || (git_config_user_name(&p), git_config_user_email(&p))
    })
    .await
    .map_err(|e| e.to_string())?;
    let needs_name = current.0.is_empty();
    let resolved_name: Option<String> = if needs_name {
        Some(effective_git_name(&git_name)?)
    } else {
        None
    };
    let email_conn = email.trim().to_string();

    // Tâche 1 : si le projet n'est pas encore un dépôt Git, initialiser le
    // dépôt local + premier commit, en réglant l'identité git (auto) si absente.
    // Idempotent : un projet déjà repo renvoie false et ne refait rien (mais
    // l'identité manquante est quand même comblée).
    let project_init = project.to_string();
    let name_for_identity = resolved_name.clone().unwrap_or_default();
    let initialized = tokio::task::spawn_blocking(move || {
        ensure_git_repo_with_identity(&project_init, &email_conn, &name_for_identity)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Mémoriser le nom utilisé (saisi une seule fois) pour la prochaine fois.
    if let Some(n) = &resolved_name {
        let _ = memorize_git_name(n);
    }

    // Bare serveur + enregistrement en base (idempotent).
    let res = gds_git::add_project(pool, &local_dir, &name, email, "").await?;

    // git remote add + push initial dans le projet local (bloquant → spawn_blocking).
    let repo_url_push = repo_url.clone();
    let project_owned = project.to_string();
    let remote_result = tokio::task::spawn_blocking(move || {
        // Remote dédié `gds` (et non `origin`) : préserve un éventuel remote
        // `origin` existant (ex: GitHub) et reste idempotent — `git_remote_add`
        // retire puis ré-ajoute le remote `gds` sans toucher aux autres.
        git_remote_add(&project_owned, "gds", &repo_url_push)?;
        let branch = git_current_branch(&project_owned);
        if !branch.is_empty() && branch != "HEAD" {
            git_push(&project_owned, "gds", &branch)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string());

    // État partiel évité : un échec (remote add / push) laisse le bare serveur
    // déjà créé → le retirer proprement pour ne pas rester « à moitié attaché ».
    match remote_result {
        Err(join_err) => {
            let _ = gds_git::remove_bare(&local_dir, &name);
            return Err(join_err);
        }
        Ok(Err(inner_err)) => {
            let _ = gds_git::remove_bare(&local_dir, &name);
            return Err(inner_err);
        }
        Ok(Ok(())) => {}
    }

    Ok(json!({
        "ok": true,
        "project": name,
        "repo_url": repo_url,
        "bare": res,
        "initialized": initialized,
    }))
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
    // Mémoriser la connexion par serveur (Évolution 1) : réutilisable sur un
    // autre projet sans ressaisir les mots de passe. Best-effort : une fois la
    // base Postgres provisionnée, un échec d'écriture des secrets ne doit PAS
    // faire échouer tout le provision (sinon état incohérent : Err renvoyé
    // mais serveur déjà provisionné). On ne logue aucune valeur sensible —
    // seul le message d'erreur (I/O secrets, jamais les mots de passe).
    if let Err(e) = save_server_credentials(&host, &port, &user, &db_password, &admin_password) {
        eprintln!("[gds] provision : mémorisation des connexions serveur ignorée ({})", e);
    }
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

/// Provision automatique du GDS d'un projet à l'ouverture (R1). Fail-open et
/// idempotent — ne bloque JAMAIS l'ouverture, n'écrase jamais un projet déjà
/// relié. Ordre :
///  - `.pilot/gds.json` absent ou non activé → Ok(None) (rien à faire).
///  - config activée avec hôte/utilisateur → restore_pool_for_project.
///  - config activée mais incomplète (hôte vide) → serveur VALIDÉ mémorisé +
///    gds_apply_server (copie les mdp) + provision_db (admin email = identité
///    globale). L'ajout du PROJET (bare + remote + push) reste MANUEL 1re fois.
pub(crate) async fn auto_provision_pool(project: &str) -> Result<Option<PgPool>, String> {
    let cfg = match read_gds_config(project) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    if !cfg.enabled {
        return Ok(None);
    }
    if !cfg.db_host.is_empty() && !cfg.db_user.is_empty() {
        return match restore_pool_for_project(project).await {
            Ok(p) => Ok(Some(p)),
            Err(e) => Err(format!(
                "Reconnexion GDS impossible pour « {} » : {}",
                project_name(project),
                e
            )),
        };
    }
    if cfg.db_host.is_empty() {
        for srv in list_saved_servers() {
            let host = srv["host"].as_str().unwrap_or("").to_string();
            let port = srv["port"].as_str().unwrap_or("5432").to_string();
            let user = srv["user"].as_str().unwrap_or("").to_string();
            if host.is_empty() || user.is_empty() {
                continue;
            }
            let email = effective_identity_email("");
            if email.is_empty() {
                continue;
            }
            if let Err(_e) = gds_apply_server(
                project.to_string(), host.clone(), port.clone(), user.clone(), email.clone(),
            ) {
                continue;
            }
            let secrets = read_gds_secrets()?;
            let stored = secrets
                .projects
                .get(&project_name(project))
                .cloned()
                .unwrap_or_default();
            let db_password = stored.db_password.clone().unwrap_or_default();
            let admin_password = stored.admin_password.clone().unwrap_or_default();
            if db_password.is_empty() || admin_password.is_empty() {
                continue;
            }
            let db_addr = format!(
                "postgres://{}:{}@{}:{}/postgres",
                user,
                url_encode(&db_password),
                host,
                port
            );
            let pool = provision_db(&db_addr, &user, &db_password, &email, &admin_password)
                .await?;
            return Ok(Some(pool));
        }
        return Err("Aucun serveur GDS mémorisé et validé — configurez-le une première fois dans l'onglet GDS.".to_string());
    }
    Ok(None)
}

/// Commande Tauri : provision automatique (R1). Reconnecte le pool ou provisionne
/// depuis un serveur mémorisé. Fail-open, ne révèle aucun secret, stocke le
/// pool dans AppState. Sert aussi de point d'appel pour l'UI (« Activer GDS »).
#[tauri::command]
pub async fn gds_auto_provision(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Ok(json!({ "ok": true, "provisioned": false, "skipped": "global_disabled" }));
    }
    match auto_provision_pool(&project).await {
        Ok(Some(pool)) => {
            *state.gds_pool.lock().unwrap() = Some(pool);
            Ok(json!({ "ok": true, "provisioned": true }))
        }
        Ok(None) => Ok(json!({ "ok": true, "provisioned": false, "skipped": "not_activated" })),
        Err(e) => Err(e),
    }
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
/// Configure l'identité git automatiquement si absente : `email` = compte GDS
/// (réutilisé tel quel, aucune saisie), `git_name` = nom saisi UNE fois par
/// l'utilisateur (sinon nom mémorisé).
#[tauri::command]
pub async fn gds_add_project(
    state: State<'_, AppState>,
    project: String,
    email: String,
    git_name: Option<String>,
) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    add_project_to_gds(&pool, &project, &email, git_name).await
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
/// Retour ADDITIF : en plus de id/project_id/path_on_server/bare_path, remonte
/// `name` (nom lisible via join `projects`), `email` (identité du membre),
/// `local_exists` (un clonage local `<gds_local_dir>/<name>` existe-t-il ?) et
/// `local_path` (chemin du clonage local, pour l'action « Ouvrir normalement un
/// déjà en local »). Le dossier local est lu depuis la config du projet courant
/// (paramètre optionnel) avec repli sur le défaut — aucune I/O de clone ici.
#[tauri::command]
pub async fn gds_list_git_repos(
    state: State<'_, AppState>,
    project: Option<String>,
) -> Result<Vec<Value>, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    // Dossier local où sont clonés les projets GDS (config du projet courant,
    // sinon défaut) — détection de présence locale sans aucun clone.
    let local_dir = project
        .as_deref()
        .and_then(|p| read_gds_config(p).ok())
        .and_then(|c| c.gds_local_dir)
        .unwrap_or_else(default_gds_local_dir);
    // Email d'identité de repli (config du projet courant) si aucun membre en base.
    let cfg_email = project
        .as_deref()
        .and_then(|p| read_gds_config(p).ok())
        .map(|c| c.identity_email)
        .unwrap_or_default();
    let mut repos = gds_db::list_git_repos(&pool).await?;
    for r in repos.iter_mut() {
        let name = r["name"].as_str().unwrap_or("").to_string();
        let local_path = std::path::Path::new(&local_dir)
            .join(&name)
            .to_string_lossy()
            .to_string();
        let local_exists = !name.is_empty() && std::path::Path::new(&local_path).exists();
        r["local_exists"] = json!(local_exists);
        r["local_path"] = json!(local_path);
        if r["email"].as_str().unwrap_or("").is_empty() && !cfg_email.is_empty() {
            r["email"] = json!(cfg_email);
        }
    }
    Ok(repos)
}

/// Commande Tauri : clone un dépôt GDS en local, l'ouvre comme projet et le
/// connecte automatiquement au GDS. `project` = projet courant de travail
/// (fournit l'identité email + `gds_local_dir`) ; `repo_name` = dépôt GDS à
/// cloner (ex: `myproj`) ; `local_dir_override` (optionnel) force un dossier de
/// clonage. Retourne `{ path, already_existed }`.
///
/// Comportement : (1) config GDS + pool (repli `restore_pool_for_project`) ;
/// (2) `dest = <gds_local_dir>/<repo_name>` ; (3) clone si absent (sinon, si le
/// dossier existe déjà et est un dépôt Git, pas de clone ; le remote `gds` est
/// ajouté si absent) ; (4) écrit le `.pilot/gds.json` du clone local (même
/// serveur/identité que le projet courant) puis l'enregistre via
/// `add_project_to_gds` (idempotent : associe le membre + remote + push).
/// Fail-open : on ne supprime JAMAIS le bare serveur ni un worktree local existant.
#[tauri::command]
pub async fn gds_clone_repo(
    state: State<'_, AppState>,
    project: String,
    repo_name: String,
    local_dir_override: Option<String>,
) -> Result<Value, String> {
    let name = gds_git::validate_project_name(&repo_name)?;
    // Config GDS du projet courant (email + dossier local + serveur SSH).
    let cfg = read_gds_config(&project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let email = effective_identity_email(&cfg.identity_email);
    if email.is_empty() {
        return Err("Identité email manquante — configurez le bloc « Identité » du GDS.".to_string());
    }
    let local_dir = local_dir_override
        .filter(|d| !d.trim().is_empty())
        .or_else(|| cfg.gds_local_dir.clone())
        .unwrap_or_else(default_gds_local_dir);
    let dest = std::path::Path::new(&local_dir).join(&name);
    let dest_str = dest.to_string_lossy().to_string();
    let url = gds_remote_url(&cfg, &name);

    // Pool : repli sur restore_pool_for_project si le pool AppState est vide.
    // Le clone sort du garde Mutex AVANT l'await (garde non-Send à ne pas porter).
    let pool_opt = state.gds_pool.lock().unwrap().clone();
    let pool = match pool_opt {
        Some(p) => p,
        None => restore_pool_for_project(&project)
            .await
            .map_err(|_| "GDS non provisionné — provisionnez-le d'abord dans l'onglet GDS".to_string())?,
    };
    // Phase A3 : la clef du poste doit être enregistrée pour le remote SSH.
    gds_ssh::ensure_poste_key(&pool, &email).await?;

    // Opérations git bloquantes (clone / remote add) → spawn_blocking.
    let url2 = url.clone();
    let dest2 = dest_str.clone();
    let already_existed = tokio::task::spawn_blocking(move || {
        let existed = std::path::Path::new(&dest2).exists();
        if !existed {
            git_clone(&url2, &dest2)?;
        } else if !git_is_repo(&dest2) {
            let msg = "Le dossier local « ".to_string()
                + &dest2
                + " » existe mais n'est pas un dépôt Git — utilisez l'action « Ouvrir normalement un déjà en local » ou retirez-le manuellement.";
            return Err(msg);
        }
        // Le remote dédié `gds` est garanti (le clone crée `origin`).
        if !git_has_remote(&dest2, "gds") {
            git_remote_add(&dest2, "gds", &url2)?;
        }
        Ok::<_, String>(existed)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Le clone local doit être « connecté au GDS » : lui écrire sa propre config
    // `.pilot/gds.json` (même serveur/identité/dossier que le projet courant),
    // nécessaire pour `add_project_to_gds` (qui exige une config activée) et pour
    // que les sync/push suivants fonctionnent depuis le clone.
    let dest_cfg = GdsConfig {
        enabled: true,
        db_host: cfg.db_host.clone(),
        db_port: cfg.db_port.clone(),
        db_user: cfg.db_user.clone(),
        identity_email: email.clone(),
        server_url: cfg.server_url.clone(),
        gds_local_dir: Some(local_dir.clone()),
        ssh_host: cfg.ssh_host.clone(),
        urgent_email: cfg.urgent_email.clone(),
    };
    write_gds_config(&dest_str, &dest_cfg)?;

    // Enregistrer la copie locale auprès du serveur (idempotent, fail-open) :
    // bare/projet déjà présents sur le serveur → réutilisés, simple assoc. membre
    // + remote + push. Ne touche JAMAIS au bare serveur ni au worktree local.
    add_project_to_gds(&pool, &dest_str, &email, None).await?;

    Ok(json!({
        "path": dest_str,
        "already_existed": already_existed,
    }))
}

/// Retire un projet du GDS (Évolution 2). Toujours : retire le remote `gds`
/// local + supprime `.pilot/gds.json`. La purge serveur (suppression du dépôt
/// bare + entrées en base) n'a lieu QUE si `purge_server=true` (jamais par
/// défaut — destructive). Respecte `gds_enabled` (court-circuit). Netttoie le
/// pool gds_pool si plus aucun projet configuré après retrait. Fail-open : on
/// ne supprime JAMAIS le bare sans `purge_server=true` explicite.
#[tauri::command]
pub async fn gds_remove_project(
    state: State<'_, AppState>,
    project: String,
    purge_server: bool,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Err("GDS désactivé globalement".to_string());
    }
    // Capturer la config + un éventuel pool AVANT de supprimer gds.json
    // (restore_pool_for_project en a besoin pour reconstruire le pool).
    let name = project_name(&project);
    let local_dir = read_gds_config(&project)
        .ok()
        .and_then(|c| c.gds_local_dir)
        .unwrap_or_else(default_gds_local_dir);
    let pool_for_purge = if purge_server {
        let current = state.gds_pool.lock().unwrap().clone();
        match current {
            Some(p) => Some(p),
            None => restore_pool_for_project(&project).await.ok(),
        }
    } else {
        None
    };

    // 1. Retirer le remote `gds` local (pattern git_remote_add → remove).
    let project_owned = project.clone();
    tokio::task::spawn_blocking(move || git_remote_remove(&project_owned, "gds"))
        .await
        .map_err(|e| e.to_string())??;

    // 2. Supprimer .pilot/gds.json.
    let cfg_path = gds_config_path(&project);
    if cfg_path.exists() {
        std::fs::remove_file(&cfg_path)
            .map_err(|e| format!("Suppression gds.json: {}", e))?;
    }

    // 3. Purge serveur UNIQUEMENT si demandé explicitement.
    let mut purged = false;
    if purge_server {
        gds_git::remove_bare(&local_dir, &name)?;
        if let Some(pool) = pool_for_purge {
            let _ = gds_db::delete_project_by_name(&pool, &name).await?;
        }
        purged = true;
    }

    // 4. Nettoyer le pool si plus aucun projet GDS configuré reste.
    let state_ref = &state;
    {
        let cfg = state_ref.config.lock().unwrap().clone();
        let mut paths = cfg.open_projects.clone();
        if let Some(p) = &cfg.active_open_project {
            if !paths.contains(p) {
                paths.push(p.clone());
            }
        }
        let mut orphan = true;
        for proj in paths {
            if proj == project {
                continue;
            }
            if let Ok(gc) = read_gds_config(&proj) {
                if gc.enabled && !gc.db_host.is_empty() {
                    orphan = false;
                    break;
                }
            }
        }
        if orphan {
            *state_ref.gds_pool.lock().unwrap() = None;
        }
    }

    Ok(json!({ "ok": true, "project": name, "purged_server": purged }))
}

/// Décision d'état de connexion GDS d'un projet (Évolution 3) — pure et
/// testable. `configured` = `.pilot/gds.json` présent, `enabled` = activé par
/// projet, `has_pw` = mot de passe enregistré dans les secrets, `pool_ok` =
/// pool joignable (reconnexion effective), `bare_ok` = dépôt bare valide,
/// `remote_ok` = remote `gds` présent.
///  - config absente (ou non activée) → `not_configured`
///  - tout coché → `connected`
///  - sinon → `error`
pub(crate) fn connection_status_from_flags(
    configured: bool,
    enabled: bool,
    has_pw: bool,
    pool_ok: bool,
    bare_ok: bool,
    remote_ok: bool,
) -> &'static str {
    if !configured || !enabled {
        return "not_configured";
    }
    if has_pw && pool_ok && bare_ok && remote_ok {
        "connected"
    } else {
        "error"
    }
}

/// Cache court (TTL ~5 s) de la joignabilité du pool GDS pour un projet.
/// Évite les appels réseau répétés (timeouts) quand la sidebar interroge
/// plusieurs projets à chaque rendu. Fail-open : un accès à ce cache ne
/// bloque jamais l'UI. Aucune donnée sensible n'y est stockée (juste un booléen).
fn gds_pool_cache() -> &'static StdMutex<HashMap<String, (Instant, bool)>> {
    static CACHE: OnceLock<StdMutex<HashMap<String, (Instant, bool)>>> = OnceLock::new();
    CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// Vérifie si le pool PostgreSQL d'un projet est joignable, en réutilisant le
/// pool déjà présent dans `AppState.gds_pool` (ping léger `SELECT 1`) AVANT de
/// tenter une reconnexion (`restore_pool_for_project` n'est plus appelé qu'en
/// dernier recours). Un cache court (TTL ~5 s) par projet évite les appels
/// réseau répétés de la sidebar. Fail-open : jamais bloquant pour l'UI.
async fn pool_is_connected(state: State<'_, AppState>, project: &str, has_pw: bool) -> bool {
    if !has_pw {
        return false;
    }
    let name = project_name(project);
    let now = Instant::now();
    // Cache court : réutiliser un résultat récent (< TTL) si possible.
    if let Ok(lock) = gds_pool_cache().lock() {
        if let Some((at, ok)) = lock.get(&name) {
            if now.duration_since(*at) < Duration::from_secs(5) {
                return *ok;
            }
        }
    }
    // Pool déjà présent dans AppState : ping léger, pas de reconnexion.
    // On clone la référence hors du garde (garde Mutex non-Send, à ne pas
    // porter à travers un await).
    let existing = state.gds_pool.lock().ok().and_then(|g| g.clone());
    if let Some(pool) = existing {
        let alive = tokio::time::timeout(
            Duration::from_secs(2),
            sqlx::query("SELECT 1").execute(&pool),
        )
        .await
        .ok()
        .and_then(|r| r.ok())
        .is_some();
        if alive {
            if let Ok(mut lock) = gds_pool_cache().lock() {
                lock.insert(name.clone(), (now, true));
            }
            return true;
        }
    }
    // Aucun pool actif (ou devenu injoignable) → tentative de reconnexion en
    // dernier recours, puis stockage du pool si elle réussit.
    let ok = match restore_pool_for_project(project).await {
        Ok(p) => {
            let alive = tokio::time::timeout(
                Duration::from_secs(2),
                sqlx::query("SELECT 1").execute(&p),
            )
            .await
            .ok()
            .and_then(|r| r.ok())
            .is_some();
            if alive {
                *state.gds_pool.lock().unwrap() = Some(p);
            } else {
                let _ = p.close().await;
            }
            alive
        }
        Err(_) => false,
    };
    if let Ok(mut lock) = gds_pool_cache().lock() {
        lock.insert(name, (now, ok));
    }
    ok
}

/// Commande Tauri : état honnête de la connexion GDS d'un projet (Évolution 3).
/// Retourne `{"status": "connected" | "error" | "not_configured"}`. Réutilise
/// les infos de connexion (restore_pool_for_project pour la joignabilité).
/// Fail-open : jamais bloquant ; ne révèle JAMAIS de secret.
#[tauri::command]
pub async fn gds_connection_status(
    state: State<'_, AppState>,
    project: String,
) -> Result<Value, String> {
    if !crate::gds_globally_enabled(&state) {
        return Ok(json!({ "status": "not_configured" }));
    }
    let cfg = match read_gds_config(&project) {
        Ok(c) => c,
        Err(e) if e.starts_with("Lecture gds.json") => {
            return Ok(json!({ "status": "not_configured" }));
        }
        Err(e) => return Err(e),
    };
    if !cfg.enabled {
        return Ok(json!({ "status": "not_configured" }));
    }
    // Mot de passe enregistré dans les secrets (valeurs jamais révélées).
    let secrets = read_gds_secrets().ok();
    let has_pw = secrets
        .as_ref()
        .and_then(|s| s.projects.get(&project_name(&project)))
        .and_then(|p| p.db_password.as_deref())
        .map(|p| !p.is_empty())
        .unwrap_or(false);
    // Pool joignable : réutilise le pool AppState et un cache court (fail-open).
    let pool_ok = pool_is_connected(state.clone(), &project, has_pw).await;
    // Dépôt bare valide sur le serveur GDS.
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let name = project_name(&project);
    let project_owned = project.clone();
    let bare_ok = gds_git::bare_repo_exists(&local_dir, &name);
    // Remote `gds` présent dans le dépôt local.
    let remote_ok = tokio::task::spawn_blocking(move || crate::git::git_has_remote(&project_owned, "gds"))
        .await
        .unwrap_or(false);
    let status =
        connection_status_from_flags(true, cfg.enabled, has_pw, pool_ok, bare_ok, remote_ok);
    // Présence du projet sur le serveur GDS (on_server) : R3 — quand déjà
    // ajouté, on ne permet plus de l'ajouter (l'UI masque le bouton). Requiert
    // un pool joignable (sinon fail-open : false). Aucun secret révélé.
    let mut on_server = false;
    if pool_ok {
        let pool = state.gds_pool.lock().unwrap().clone();
        if let Some(p) = pool {
            if let Ok(id) = gds_db::get_project_by_name(&p, &name).await {
                on_server = id.is_some();
            }
        }
    }
    Ok(json!({ "status": status, "on_server": on_server }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::ensure_git_repo_with_initial_commit;

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

    #[test]
    fn connection_status_flags_decision() {
        // Config absente / non activée → not_configured (même si pool/bare ok).
        assert_eq!(connection_status_from_flags(false, false, true, true, true, true), "not_configured");
        assert_eq!(connection_status_from_flags(true, false, true, true, true, true), "not_configured");
        // Tout est bon → connected.
        assert_eq!(connection_status_from_flags(true, true, true, true, true, true), "connected");
        // testsnake2 (dépôt non valide → bare_ok=false) → error.
        assert_eq!(connection_status_from_flags(true, true, true, true, false, true), "error");
        // Chaque prérequis manquant → error.
        assert_eq!(connection_status_from_flags(true, true, false, true, true, true), "error");
        assert_eq!(connection_status_from_flags(true, true, true, false, true, true), "error");
        assert_eq!(connection_status_from_flags(true, true, true, true, true, false), "error");
    }

    #[test]
    fn save_server_credentials_memorizes_and_lists_without_pw() {
        // Secrets isolés dans un fichier TEMPORAIRE (jamais ~/.pilot réel) : le
        // guard Drop retire le fichier même en cas de panique.
        let _guard = TestGdsSecretsGuard::new();
        save_server_credentials("192.168.1.50", "5432", "pilot", "dbpw", "adminpw").unwrap();
        // get_saved_server retrouve les mots de passe.
        let saved = get_saved_server("192.168.1.50", "5432", "pilot").unwrap().unwrap();
        assert_eq!(saved.db_password.as_deref(), Some("dbpw"));
        assert_eq!(saved.admin_password.as_deref(), Some("adminpw"));
        // list_saved_servers NE révèle JAMAIS les mots de passe.
        let list = list_saved_servers();
        let serialized = serde_json::to_string(&list).unwrap();
        assert!(!serialized.contains("dbpw"));
        assert!(!serialized.contains("adminpw"));
        assert!(list.iter().any(|v| v["host"] == "192.168.1.50" && v["user"] == "pilot"));
    }

    #[test]
    fn server_only_listed_and_appliable_when_validated() {
        // Secrets isolés dans un fichier TEMPORAIRE (jamais ~/.pilot réel), avec
        // une clé d'hôte PROPRES (distincte des autres tests GDS) + un projet
        // dans le répertoire temp pour ne rien écrire dans le workspace.
        let _guard = TestGdsSecretsGuard::new();
        let host = "192.168.1.250";
        let key = server_key(host, "pilot");
        let proj_dir = std::env::temp_dir()
            .join(format!("pilot-gds-apply-proj-{}", std::process::id()));
        let proj = proj_dir.to_string_lossy().to_string();
        // Un serveur enregistré est toujours marqué validé (l'enregistrement
        // n'a lieu qu'après un test de connexion réussi dans gds_provision).
        save_server_credentials(host, "5432", "pilot", "dbpw", "adminpw").unwrap();
        let saved = get_saved_server(host, "5432", "pilot").unwrap().unwrap();
        assert!(saved.validated);
        // La liste ne contient QUE des serveurs validés (tous ici le sont).
        let list = list_saved_servers();
        assert!(list.iter().all(|v| v["validated"] == true));
        assert!(list.iter().any(|v| v["host"] == host && v["user"] == "pilot"));
        // Un serveur non validé (fichier édité à la main) est filtré de la liste.
        let mut secrets = read_gds_secrets().unwrap();
        if let Some(e) = secrets.servers.get_mut(&key) {
            e.validated = false;
        }
        write_gds_secrets(&secrets).unwrap();
        let list2 = list_saved_servers();
        assert!(
            !list2.iter().any(|v| v["host"] == host && v["user"] == "pilot"),
            "serveur non validé ne doit pas être proposé"
        );
        // gds_apply_server refuse un serveur non validé.
        let res = gds_apply_server(proj, host.to_string(), "5432".to_string(), "pilot".to_string(), "dev@kalico".to_string());
        assert!(res.is_err());
        let _ = std::fs::remove_dir_all(&proj_dir);
    }

    #[test]
    fn gds_init_flow_attaches_non_repo_to_bare_and_is_idempotent() {
        // Task 5.1 + 5.2 : dossier non-repo → work tree git + premier commit,
        // puis attaché (remote add + push) sur un bare de TEST ; idempotent au
        // rejeu (déjà repo + remote → aucun 2e commit, aucune erreur).
        // Identité git isolée : jamais la config utilisateur réelle.
        let _iso = crate::git::test_helpers::IsolatedGitConfig::new(
            "[user]\n name = Pilot Test\n email = pilot-test@example.com\n",
        );
        let work = std::env::temp_dir().join(format!("pilot-gds-wrk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let work = work.to_string_lossy().to_string();
        std::fs::write(std::path::Path::new(&work).join("main.rs"), "fn main() {}\n").unwrap();

        let bare = std::env::temp_dir().join(format!("pilot-gds-bare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&bare);
        let bare = bare.to_string_lossy().to_string();
        crate::git::git_init_bare(&bare).unwrap();

        // 1. invariant : non-repo → initialisé avec premier commit.
        assert!(!crate::git::git_is_repo(&work));
        assert!(ensure_git_repo_with_initial_commit(&work).unwrap());
        assert!(crate::git::git_is_repo(&work));

        // 2. attaché sans erreur (remote add + push).
        let branch = git_current_branch(&work);
        git_remote_add(&work, "gds", &bare).unwrap();
        git_push(&work, "gds", &branch).unwrap();

        // 3. idempotence : rejouer init + remote + push ne crée aucun 2e commit.
        assert!(!ensure_git_repo_with_initial_commit(&work).unwrap());
        git_remote_add(&work, "gds", &bare).unwrap();
        git_push(&work, "gds", &branch).unwrap();
        let count = crate::run_captured(
            "git",
            &["-C", &work, "rev-list", "--count", "HEAD"],
            Duration::from_secs(3),
        );
        assert_eq!(count.trim(), "1", "aucun 2e commit attendu");
        let _ = std::fs::remove_dir_all(&std::path::PathBuf::from(&work));
        let _ = std::fs::remove_dir_all(&std::path::PathBuf::from(&bare));
    }

    #[test]
    fn partial_state_cleanup_removes_bare_after_failed_attach() {
        // Task 5.3 : un échec d'attache (remote add / push) doit retirer le
        // bare serveur créé → pas d'état « à moitié attaché » (remove_bare,
        // pattern de add_project_to_gds). Purement local (tempdir).
        let local = std::env::temp_dir().join(format!("pilot-gds-part-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&local);
        std::fs::create_dir_all(crate::gds_git::repos_dir(&local.to_string_lossy())).unwrap();
        let bare = crate::gds_git::repo_bare_path(&local.to_string_lossy(), "proj");
        std::fs::create_dir_all(&bare).unwrap();
        assert!(bare.exists());
        // Nettoyage propre + idempotent (absent → ok, comme sur un second essai).
        crate::gds_git::remove_bare(&local.to_string_lossy(), "proj").unwrap();
        assert!(!bare.exists());
        crate::gds_git::remove_bare(&local.to_string_lossy(), "proj").unwrap();
        let _ = std::fs::remove_dir_all(&local);
    }

    #[test]
    fn effective_git_name_prefers_supplied_name() {
        // Le nom fourni par l'UI (saisi une seule fois) PRIME sur le mémorisé.
        let res = effective_git_name(&Some("  Alice D.  ".to_string())).unwrap();
        assert_eq!(res, "Alice D.");
        assert!(effective_git_name(&Some(String::new())).is_err());
        assert!(effective_git_name(&None).is_err());
    }

    #[test]
    fn effective_git_name_falls_back_to_memorized_and_saves_are_isolated() {
        // Secrets mémorisés isolés (jamais ~/.pilot réel).
        let _guard = TestGdsSecretsGuard::new();
        assert!(memorized_git_name().is_none());
        memorize_git_name("Alice").unwrap();
        // Sans nom fourni → repli sur le nom mémorisé (pré-rempli, plus de demande).
        assert_eq!(effective_git_name(&None).unwrap(), "Alice");
        assert_eq!(effective_git_name(&Some(" ".to_string())).unwrap(), "Alice");
        // Le fichier temp de secrets ne contient AUCUN mot de passe.
        let secrets = read_gds_secrets().unwrap();
        assert_eq!(secrets.git_name, "Alice");
        // Mémorisation idempotente : re-sauver le même nom ne change rien.
        memorize_git_name("Alice").unwrap();
        assert_eq!(read_gds_secrets().unwrap().git_name, "Alice");
    }

    #[test]
    fn effective_git_name_errors_clean_when_name_required_but_unknown() {
        // Aucun nom fourni ni mémorisé → message CLAIR (une seule demande).
        let _guard = TestGdsSecretsGuard::new();
        let err = effective_git_name(&None).unwrap_err();
        assert!(err.contains("Nom git requis"), "message clair attendu: {}", err);
        assert!(!err.contains("git config --global"), "pas de commande git à taper");
    }

    #[test]
    fn global_identity_saved_and_read_without_secrets() {
        // Identité globale (email + nom git) sauvegardée puis relue, sans
        // aucun mot de passe. Secrets isolés dans un fichier temportaire.
        let _guard = TestGdsSecretsGuard::new();
        gds_save_identity(" dev@kalico ".to_string(), "Alice".to_string()).unwrap();
        let v = gds_identity_prefs().unwrap();
        assert_eq!(v["email"], "dev@kalico");
        assert_eq!(v["git_name"], "Alice");
        // Le nom git reste mémorisé (rétrocompat gds_git_identity_prefs).
        assert_eq!(memorized_git_name().unwrap(), "Alice");
        // Aucun mot de passe exposé / persistant.
        assert_eq!(global_identity_email().unwrap(), "dev@kalico");
        assert_eq!(effective_identity_email(""), "dev@kalico");
        assert_eq!(effective_identity_email("other@x"), "other@x");
        let content = std::fs::read_to_string(secrets_path().unwrap()).unwrap();
        assert!(!content.contains("password"));
    }

    #[test]
    fn auto_provision_skips_when_not_activated() {
        // Projet sans .pilot/gds.json (ou désactivé) → Ok(None), jamais d'erreur.
        let dir = std::env::temp_dir().join(format!("pilot-gds-autoprov-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        // Pas de config → Ok(None).
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(crate::gds::auto_provision_pool(&project));
        assert!(res.is_ok());
        assert!(res.unwrap().is_none());
        // Config présente mais désactivée → Ok(None).
        let mut cfg = GdsConfig {
            enabled: false,
            server_url: String::new(),
            identity_email: String::new(),
            gds_local_dir: None,
            ssh_host: String::new(),
            urgent_email: None,
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        let _ = write_gds_config(&project, &cfg);
        let res = rt.block_on(crate::gds::auto_provision_pool(&project));
        assert!(res.is_ok() && res.unwrap().is_none());
        // Config activée mais hôte vide + aucun serveur mémorisé → erreur claire
        // (fail-open pour l'ouverture : le hook ignore l'erreur).
        cfg.enabled = true;
        let _ = write_gds_config(&project, &cfg);
        let res = rt.block_on(crate::gds::auto_provision_pool(&project));
        assert!(res.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_identity_prefs_reports_isolated_state_and_memorized_name() {
        // Identité git isolée (config globale vide) + secrets isolés : la commande
        // `gds_git_identity_prefs` voit l'identité absente et pré-remplit le nom
        // mémorisé. Ne touche jamais à la config utilisateur réelle ni aux secrets.
        let _iso = crate::git::test_helpers::IsolatedGitConfig::new("");
        let _guard = TestGdsSecretsGuard::new();
        memorize_git_name("Alice").unwrap();
        let dir = std::env::temp_dir().join(format!("pilot-gds-prefs-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        let v = gds_git_identity_prefs(project.clone()).unwrap();
        assert_eq!(v["name_configured"], false);
        assert_eq!(v["email_configured"], false);
        assert_eq!(v["git_name"], "Alice", "nom mémorisé pré-rempli");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_identity_auto_sets_email_to_connected_account_and_name_local_only() {
        // Identité git isolée (config globale vide) : à l'ajout au GDS, l'email
        // du compte connecté (qu'il soit dev OU admin) est réglé en LOCAL, et le
        // nom mémorisé/fourni aussi — sans toucher la config utilisateur réelle.
        let _iso = crate::git::test_helpers::IsolatedGitConfig::new("");
        let dir = std::env::temp_dir().join(format!("pilot-gds-idauto-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&project).join("a.txt"), "x").unwrap();
        // email = compte GDS (ici admin : même chemin que dev) ; nom fourni une fois.
        crate::git::ensure_git_repo_with_identity(&project, "admin@kalico", "Alice").unwrap();
        assert_eq!(crate::git::git_config_user_email(&project), "admin@kalico");
        assert_eq!(crate::git::git_config_user_name(&project), "Alice");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
