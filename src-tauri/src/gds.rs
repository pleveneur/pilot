// gds.rs — Config GDS par projet (.pilot/gds.json) + provision (spec_gds.md §0.4, §3)
//
// La config GDS vit UNIQUEMENT dans le projet (`.pilot/gds.json`) : activation
// on/off, URL du serveur GDS, identité email, dossier local de clonage.
// AUCUN champ gds_* dans la config globale de Pilot (décision 29/08/2026).

use crate::gds_db;
use crate::gds_git;
use crate::gds_service;
use crate::gds_ssh;
use crate::git::{ensure_git_repo_with_identity, git_clone, git_config_user_email, git_config_user_name, git_current_branch, git_has_remote, git_is_repo, git_push, git_remote_add, git_remote_remove};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

// L1.8b/L1.10 : la « préparation de la base » (`provision_db`) vit dans le socle
// partagé (`gds_core::db`) — le serveur autonome en a besoin. Consommée
// DIRECTEMENT depuis `gds_core` (plus de ré-export `pub(crate)` intermédiaire).
use gds_core::db::provision_db;

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
    /// Nom court de la fiche serveur (obligatoire à la saisie, mais facultatif
    /// à la lecture : les fiches déjà mémorisées sans nom se lisent en chaîne
    /// vide et retombent sur `user@host` à l'affichage).
    #[serde(default)]
    pub name: String,
    /// Description libre de la fiche serveur (facultatif).
    #[serde(default)]
    pub description: String,
    /// Date ISO (UTC) du dernier test de connexion MÉMORISÉ pour cette fiche.
    /// Chaîne vide = jamais testé depuis cette version.
    #[serde(default)]
    pub last_test_at: String,
    /// Résultat du dernier test : `Some(true)` joignable, `Some(false)`
    /// injoignable, `None` jamais testé. Sert à afficher l'état sur la fiche.
    #[serde(default)]
    pub reachable: Option<bool>,
    /// Port SSH du serveur (celui des dépôts git) — valeur TECHNIQUE du
    /// serveur, saisie UNE fois dans la fiche et recopiée dans chaque projet
    /// qui l'applique. Chaîne vide = jamais renseigné → repli sur le port du
    /// projet (22 par défaut). `#[serde(default)]` : toute fiche antérieure
    /// reste lisible, rien n'est effacé.
    #[serde(default)]
    pub ssh_port: String,
    /// Racine des dépôts git CÔTÉ SERVEUR (ex. `/srv/git/repos`) — même logique
    /// que `ssh_port`. Chaîne vide = jamais renseignée.
    #[serde(default)]
    pub gds_server_repos: String,

    // ── Fiche « identité utilisateur » (lot 1 : le compte GDS remplace le
    // compte technique). Tous ces champs sont FACULTATIFS à la lecture : une
    // fiche écrite avant ce lot (compte technique) se relit sans eux, sans
    // qu'aucun secret ne soit perdu ni effacé.
    /// Hôte de la fiche, mémorisé EXPLICITEMENT : la clé `user@host` ne peut
    /// plus être redécoupée fiablement quand l'utilisateur est une adresse
    /// e-mail (qui contient un `@`). Vide = fiche héritée → repli sur la clé.
    #[serde(default)]
    pub host: String,
    /// Partie « utilisateur » de la clé de la map `servers`, mémorisée elle
    /// aussi pour la même raison (l'UI doit retrouver la fiche pour la
    /// modifier/supprimer). Vide = fiche héritée → repli sur la clé.
    #[serde(default)]
    pub key_user: String,
    /// Port de l'API HTTP du service GDS (le compte utilisateur parle au
    /// service, jamais à la base). Chaîne vide = jamais renseigné.
    #[serde(default)]
    pub http_port: String,
    /// E-mail du compte GDS de l'utilisateur sur ce serveur. Non vide = fiche
    /// au format « identité utilisateur ».
    #[serde(default)]
    pub gds_email: String,
    /// Rôle renvoyé par le serveur à la connexion (`admin` / `dev` /
    /// `standard`). Affiché sur la fiche, jamais deviné.
    #[serde(default)]
    pub gds_role: String,
    /// Mot de passe du compte GDS — **SECRET**, jamais renvoyé à l'UI.
    #[serde(default)]
    pub gds_password: Option<String>,
}

/// Défaut `validated = true` : les serveurs déjà enregistrés (Évolution 1)
/// proviennent toujours d'une provision où le test de connexion a réussi.
fn default_validated() -> bool {
    true
}

/// Identifiants d'**administration** d'un serveur GDS (refonte GDS, L4.2).
///
/// Volontairement SÉPARÉS de `ServerCredentials` (connexions projet) : l'écran
/// d'administration transverse se connecte à l'API HTTP du serveur avec un
/// compte administrateur, qui n'est pas nécessairement l'identité employée
/// pour les projets. Mélanger les deux polluerait la liste des serveurs de
/// projet (`servers` est indexée `user@host` et listée telle quelle).
/// `admin_password` est un secret : il n'est JAMAIS renvoyé à l'UI ni journalisé.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct AdminServerCredentials {
    /// Adresse du serveur telle que saisie à l'écran (sans schéma, sans port).
    #[serde(default)]
    pub host: String,
    /// Port **HTTP** de l'API GDS (chaîne vide = port par défaut côté UI).
    #[serde(default)]
    pub http_port: String,
    /// Email du compte administrateur du serveur.
    #[serde(default)]
    pub admin_email: String,
    /// Mot de passe administrateur — **SECRET**, jamais renvoyé à l'UI.
    #[serde(default)]
    pub admin_password: Option<String>,
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
    /// Identifiants d'ADMINISTRATION du serveur, pour l'écran transverse
    /// « GDS Serveur » (refonte GDS, L4.2) — clé `host|email` (voir
    /// `admin_server_key`). Entrée SÉPARÉE de `servers` (connexions projet) :
    /// une entrée admin ne doit jamais apparaître comme un serveur de projet.
    #[serde(default)]
    pub admin_servers: BTreeMap<String, AdminServerCredentials>,
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
pub(crate) struct TestGdsSecretsGuard;

#[cfg(test)]
impl TestGdsSecretsGuard {
    pub(crate) fn new() -> Self {
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
/// `[{ host, port, user, ... }]`. Fail-open : erreur → liste vide.
///
/// `host` et `user` sont relus depuis la FICHE quand elle les mémorise (fiches
/// au format « identité utilisateur », dont la clé contient un `@` d'e-mail) et
/// retombent sur la clé `user@host` pour les fiches écrites avant ce lot :
/// aucune fiche héritée n'est perdue ni transformée.
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
            let (key_user, key_host) = match key.split_once('@') {
                Some((u, h)) => (u.to_string(), h.to_string()),
                None => (key.clone(), String::new()),
            };
            let user = if c.key_user.is_empty() { key_user } else { c.key_user.clone() };
            let host = if c.host.is_empty() { key_host } else { c.host.clone() };
            let identity = !c.gds_email.trim().is_empty();
            json!({
                "host": host,
                "port": if c.db_port.is_empty() { "5432" } else { &c.db_port },
                "user": user,
                "validated": true,
                "name": c.name,
                "description": c.description,
                "last_test_at": c.last_test_at,
                "reachable": c.reachable,
                // Valeurs TECHNIQUES du serveur (port SSH, racine des dépôts) :
                // jamais des secrets, recopiées dans le projet qui applique la
                // fiche — l'écran du projet ne les redemande donc plus.
                "ssh_port": c.ssh_port,
                "gds_server_repos": c.gds_server_repos,
                // Fiche « identité utilisateur » (lot 1) : l'adresse GDS, le
                // port de l'API HTTP et le rôle reconnu. Jamais de mot de passe.
                "identity": identity,
                "http_port": c.http_port,
                "gds_email": c.gds_email,
                "gds_role": c.gds_role,
                // Booléen (pas un secret) : la fiche porte-t-elle encore le
                // compte technique de la base ? Depuis le lot 4, une fiche
                // « compte GDS » est applicable seule (le serveur prépare sa
                // base) ; ce booléen ne sert plus qu'à la cible d'enregistrement
                // de clef « Mes clés », qui passe, elle, encore par la base.
                "has_db_password": !c.db_password.as_deref().unwrap_or("").is_empty(),
            })
        })
        .collect()
}

// ── Écran d'administration transverse (refonte GDS, L4.2) ──
//
// Le mot de passe administrateur d'un serveur est mémorisé à part des
// connexions projet : l'écran d'administration « GDS Serveur » ne mélange
// jamais l'identité admin avec l'identité projet (exigence de la micro-tâche
// L4.2). Aucune de ces fonctions ne renvoie le mot de passe à l'UI.

/// Clé de la map `admin_servers` : hôte + email d'administration. Volontairement
/// NON analysée (on ne la redécoupe jamais) : les champs sont relus depuis la
/// valeur stockée, ce qui évite toute ambiguïté (un email contient un `@`).
/// Pure — testable.
pub(crate) fn admin_server_key(host: &str, email: &str) -> String {
    format!("{}|{}", host.trim(), email.trim().to_lowercase())
}

/// Mémorise les identifiants d'ADMINISTRATION d'un serveur (écran d'administration,
/// L4.2). Écrit dans `admin_servers` — **jamais** dans `servers`. Le mot de passe
/// n'est écrit que s'il est non vide : recharger l'écran (sans ressaisir le mot de
/// passe) ne doit pas effacer un secret déjà mémorisé. Un mot de passe vide ne
/// crée pas l'entrée si elle n'existe pas.
pub(crate) fn save_admin_credentials(
    host: &str,
    http_port: &str,
    email: &str,
    password: &str,
) -> Result<(), String> {
    let host = host.trim();
    let email = email.trim();
    if host.is_empty() || email.is_empty() {
        return Err("Adresse du serveur et email administrateur requis".to_string());
    }
    let mut secrets = read_gds_secrets()?;
    let key = admin_server_key(host, email);
    if password.is_empty() && !secrets.admin_servers.contains_key(&key) {
        return Ok(());
    }
    let entry = secrets.admin_servers.entry(key).or_default();
    entry.host = host.to_string();
    entry.admin_email = email.to_string();
    entry.http_port = http_port.trim().to_string();
    if !password.is_empty() {
        // Verbatim : un mot de passe n'est jamais rogné (un espace peut en faire
        // partie, et le secret doit correspondre exactement à celui que
        // `users/login` a accepté).
        entry.admin_password = Some(password.to_string());
    }
    write_gds_secrets(&secrets)
}

/// Identifiants d'administration mémorisés pour (hôte, email). `None` si jamais
/// vus. Les valeurs ne sont JAMAIS renvoyées à l'UI : seuls les appels HTTP
/// internes les utilisent.
pub(crate) fn get_admin_credentials(
    host: &str,
    email: &str,
) -> Result<Option<AdminServerCredentials>, String> {
    let secrets = read_gds_secrets()?;
    Ok(secrets
        .admin_servers
        .get(&admin_server_key(host, email))
        .cloned())
}

/// Serveurs mémorisés pour l'écran d'administration : hôte, port HTTP et email
/// administrateur — **jamais** le mot de passe (un simple booléen `has_password`
/// indique qu'un secret est disponible). Alimente le pré-remplissage du bloc
/// « Connexion serveur » (L4.2).
pub(crate) fn list_admin_servers() -> Vec<Value> {
    let secrets = match read_gds_secrets() {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    secrets
        .admin_servers
        .values()
        .map(|e| {
            json!({
                "host": e.host,
                "http_port": e.http_port,
                "email": e.admin_email,
                "has_password": e.admin_password.as_deref().map(|p| !p.is_empty()).unwrap_or(false),
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
    // Mémorise la fiche pour que l'UI la retrouve sans redécouper la clé
    // (`user@host` serait ambigu avec une adresse e-mail).
    entry.host = host.trim().to_string();
    entry.key_user = user.trim().to_string();
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

/// Fixe les valeurs TECHNIQUES d'une fiche serveur déjà mémorisée (clé
/// `user@host`) : port SSH et racine des dépôts. Une valeur VIDE conserve
/// celle déjà mémorisée (même règle que le nom et la description) ; sans
/// entrée existante : no-op silencieux. Aucun secret ici.
pub(crate) fn set_server_technical(
    host: &str,
    user: &str,
    ssh_port: &str,
    gds_server_repos: &str,
) -> Result<(), String> {
    let ssh = ssh_port.trim();
    let repos = gds_server_repos.trim();
    if ssh.is_empty() && repos.is_empty() {
        return Ok(());
    }
    let mut secrets = read_gds_secrets()?;
    let key = server_key(host, user);
    let Some(entry) = secrets.servers.get_mut(&key) else {
        return Ok(());
    };
    if !ssh.is_empty() {
        entry.ssh_port = ssh.to_string();
    }
    if !repos.is_empty() {
        entry.gds_server_repos = repos.to_string();
    }
    write_gds_secrets(&secrets)
}

/// Fixe le NOM et la DESCRIPTION d'une fiche serveur déjà mémorisée (clé
/// `user@host`). Ne touche PAS aux mots de passe. Sans entrée existante :
/// no-op silencieux (l'ajout passe par `save_server_credentials`).
pub(crate) fn set_server_label(
    host: &str,
    user: &str,
    name: &str,
    description: &str,
) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    let key = server_key(host, user);
    let Some(entry) = secrets.servers.get_mut(&key) else {
        return Ok(());
    };
    entry.name = name.trim().to_string();
    entry.description = description.trim().to_string();
    write_gds_secrets(&secrets)
}

/// Horodatage ISO (UTC, secondes) des tests de connexion mémorisés.
pub(crate) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Mémorise le RÉSULTAT du dernier test de connexion d'une fiche serveur (date
/// + joignable/injoignable). Ne touche PAS aux mots de passe. Sans entrée
/// existante : no-op silencieux (les fiches non mémorisées n'ont pas d'état).
pub(crate) fn record_server_test(host: &str, user: &str, reachable: bool) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    let key = server_key(host, user);
    let Some(entry) = secrets.servers.get_mut(&key) else {
        return Ok(());
    };
    entry.last_test_at = now_iso();
    entry.reachable = Some(reachable);
    write_gds_secrets(&secrets)
}

// ── Fiche « identité utilisateur » (lot 1) ──
//
// Le poste ne se connecte plus à la base pour identifier un serveur : la fiche
// porte le COMPTE GDS de l'utilisateur (e-mail + mot de passe → jeton porteur
// du rôle, délivré par le service). Les fiches écrites avant ce lot gardent
// leurs secrets techniques : rien n'est effacé, l'identité s'ajoute dessus.

/// Mot de passe GDS mémorisé pour une fiche (`user` = partie utilisateur de la
/// clé de la fiche, pas forcément l'e-mail : une fiche héritée reste keyée sur
/// son compte technique). Jamais renvoyé à l'UI.
pub(crate) fn stored_gds_password(host: &str, user: &str) -> Option<String> {
    let secrets = read_gds_secrets().ok()?;
    secrets
        .servers
        .get(&server_key(host, user))
        .and_then(|c| c.gds_password.clone())
        .filter(|p| !p.trim().is_empty())
}

/// Mémorise l'IDENTITÉ GDS (e-mail, rôle reconnu, port HTTP) sur une fiche
/// existante, sans jamais toucher au compte technique ni à l'ancien mot de
/// passe GDS si le nouveau est vide. Crée la fiche si elle n'existe pas encore
/// (ajout). Le mot de passe GDS est un SECRET : il n'est jamais renvoyé.
pub(crate) fn save_gds_identity(
    host: &str,
    user: &str,
    http_port: &str,
    email: &str,
    password: &str,
    role: &str,
) -> Result<(), String> {
    let mut secrets = read_gds_secrets()?;
    let entry = secrets.servers.entry(server_key(host, user)).or_default();
    entry.host = host.trim().to_string();
    entry.key_user = user.trim().to_string();
    entry.http_port = http_port.trim().to_string();
    entry.gds_email = email.trim().to_string();
    entry.gds_role = role.trim().to_string();
    if !password.trim().is_empty() {
        entry.gds_password = Some(password.trim().to_string());
    }
    // Comme pour le compte technique : la fiche n'est écrite qu'après une
    // connexion réussie, elle est donc proposée dans la liste.
    entry.validated = true;
    write_gds_secrets(&secrets)
}

// ── Fiche « identité utilisateur » (lot 1) ──
//
// Note : le retrait d'une fiche passe par `delete_saved_server` (clé
// `user@host`), inchangé.

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
    // CONSERVER les informations de serveur DISTANT déjà présentes : la fiche
    // ne porte pas forcément de port SSH ni de racine des dépôts (fiche
    // héritée) ; les écraser avec des valeurs par défaut casserait le
    // rattachement à un serveur existant. Quand la fiche les porte, elles font
    // AUTORITÉ (ce sont les valeurs techniques du serveur choisi : l'écran du
    // projet ne les demande plus).
    let existing = read_gds_config(&project).ok();
    let local_dir = existing
        .as_ref()
        .and_then(|c| c.gds_local_dir.clone())
        .unwrap_or_else(default_gds_local_dir);
    let existing_ssh_port = existing
        .as_ref()
        .map(|c| if c.ssh_port == 0 { 22 } else { c.ssh_port })
        .unwrap_or(22);
    let existing_repos = existing.as_ref().and_then(|c| c.gds_server_repos.clone());
    let ssh_port = saved
        .ssh_port
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|p| *p > 0)
        .unwrap_or(existing_ssh_port);
    let gds_server_repos = Some(saved.gds_server_repos.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(existing_repos);
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
        ssh_port,
        gds_server_repos,
        ssh_host: format!("{}:{}", host.trim(), ssh_port),
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

// ─────────────────────────────────────────────────────────────────────────────
// L5.2 — Section « Serveurs GDS » de l'écran de paramétrage utilisateur.
//
// RÉUTILISE les commandes existantes : `gds_list_saved_servers` (lister),
// `gds_apply_server` (appliquer à un projet) et `save_server_credentials`
// (enregistrer les identifiants). L'ÉDITION, la SUPPRESSION et le TEST de
// connexion d'un serveur mémorisé n'existaient pas : ils sont ajoutés ici.
//
// Règle de cohérence : un serveur n'est marqué « validé » (donc proposé et
// applicable) qu'après un TEST DE CONNEXION PostgreSQL réellement réussi. Le
// test et l'ajout partagent `test_saved_server_connection` pour garantir que
// l'affichage ne prétend ni plus ni moins que ce qui est réellement joignable.
// Aucun mot de passe n'est JAMAIS renvoyé à l'interface.

/// Repli sur le mot de passe mémorisé d'un serveur (clé `user@host`) quand
/// l'appelant ne fournit pas de mot de passe (test d'un serveur déjà enregistré).
pub(crate) fn stored_server_password(host: &str, port: &str, user: &str) -> Option<String> {
    get_saved_server(host, port, user)
        .ok()
        .flatten()
        .and_then(|s| s.db_password)
        .filter(|p| !p.is_empty())
}

/// Teste une connexion PostgreSQL pour un serveur GDS (hôte/port/utilisateur +
/// mot de passe fourni OU mémorisé). Ne persiste RIEN et ne renvoie aucun
/// secret : `Ok(())` seulement si la connexion aboutit réellement.
pub(crate) async fn test_saved_server_connection(
    host: &str,
    port: &str,
    user: &str,
    db_password: &str,
) -> Result<(), String> {
    let host = host.trim();
    let user = user.trim();
    if host.is_empty() || user.is_empty() {
        return Err("Hôte et utilisateur PostgreSQL sont requis".to_string());
    }
    let port = if port.trim().is_empty() { "5432" } else { port.trim() };
    let mut pw = db_password.trim().to_string();
    if pw.is_empty() {
        pw = stored_server_password(host, port, user).unwrap_or_default();
    }
    if pw.is_empty() {
        return Err("Mot de passe PostgreSQL requis pour tester la connexion".to_string());
    }
    // URL d'administration reconstruite à la volée (jamais persistée ni loggée).
    let addr = format!(
        "postgres://{}:{}@{}:{}/postgres",
        user,
        url_encode(&pw),
        host,
        port
    );
    gds_db::connect(&addr).await.map(|_| ())
}

/// Supprime un serveur mémorisé (map `servers`, clé `user@host`). Renvoie true
/// si une entrée a été retirée. Opération LOCALE : aucun appel au serveur, les
/// projets déjà reliés ne sont pas touchés (seuls les mots de passe sont oubliés).
pub(crate) fn delete_saved_server(host: &str, user: &str) -> Result<bool, String> {
    let mut secrets = read_gds_secrets()?;
    let removed = secrets.servers.remove(&server_key(host, user)).is_some();
    if removed {
        write_gds_secrets(&secrets)?;
    }
    Ok(removed)
}

/// Commande Tauri : teste la connexion PostgreSQL d'un serveur SANS rien
/// enregistrer. Utilisée par le bouton « Tester » de la section « Serveurs GDS ».
#[tauri::command]
pub async fn gds_test_saved_server(
    host: String,
    port: String,
    user: String,
    db_password: String,
) -> Result<Value, String> {
    let res = test_saved_server_connection(&host, &port, &user, &db_password).await;
    // Lot 5 : mémoriser le résultat (date + joignable/injoignable) sur la fiche.
    // `ok` vaut `false` quand la connexion échoue : c'est une information utile,
    // pas une erreur d'exécution de la commande. L'échec est donc renvoyé à
    // l'appelant APRÈS enregistrement.
    let _ = record_server_test(&host, &user, res.is_ok());
    res?;
    Ok(json!({ "ok": true }))
}

/// Commande Tauri : AJOUTE une fiche « identité utilisateur » APRÈS une
/// connexion réussie du compte GDS (e-mail + mot de passe → jeton du service).
/// La fiche est clée sur l'adresse GDS ; le rôle reconnu est mémorisé. Aucune
/// connexion à la base : c'est le compte utilisateur qui identifie le serveur.
#[tauri::command]
pub async fn gds_add_saved_server(
    host: String,
    http_port: String,
    email: String,
    password: String,
    name: String,
    description: String,
    ssh_port: String,
    server_repos: String,
) -> Result<Value, String> {
    if host.trim().is_empty() || email.trim().is_empty() {
        return Err("Adresse du serveur et e-mail GDS sont requis".to_string());
    }
    let res = crate::gds_admin::perform_identity_login(&host, &http_port, &email, &password, &email);
    let role = identity_login_role(&res)?;
    save_gds_identity(&host, &email, &http_port, &email, &password, &role)?;
    set_server_label(&host, &email, &name, &description)?;
    // Valeurs TECHNIQUES du serveur : elles vivent ici (et non plus sur l'écran
    // du projet, qui les recopie depuis la fiche choisie).
    set_server_technical(&host, &email, &ssh_port, &server_repos)?;
    let _ = record_server_test(&host, &email, true);
    Ok(json!({
        "ok": true,
        "host": host.trim(),
        "http_port": http_port.trim(),
        "email": email.trim(),
        "role": role,
        "name": name.trim(),
    }))
}

/// Rôle renvoyé par la connexion, ou l'erreur LISIBLE du refus (jamais un
/// secret). Pure — partagée par l'ajout et la modification d'une fiche.
fn identity_login_role(res: &Value) -> Result<String, String> {
    if res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(res
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    } else {
        Err(res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Connexion au compte GDS refusée")
            .to_string())
    }
}

/// Commande Tauri : MODIFIE une fiche « identité utilisateur ». La CLÉ de la
/// fiche ne change pas quand seule l'identité est complétée : une fiche écrite
/// avant ce lot (compte technique) garde donc ses secrets. Le mot de passe
/// laissé vide CONSERVE celui déjà mémorisé ; un changement d'adresse renomme
/// la clé (l'ancienne entrée est retirée, comme avant).
#[tauri::command]
pub async fn gds_update_saved_server(
    old_host: String,
    old_user: String,
    host: String,
    http_port: String,
    email: String,
    password: String,
    name: String,
    description: String,
    ssh_port: String,
    server_repos: String,
) -> Result<Value, String> {
    if host.trim().is_empty() || email.trim().is_empty() {
        return Err("Adresse du serveur et e-mail GDS sont requis".to_string());
    }
    let key_user = if old_user.trim().is_empty() {
        email.trim().to_string()
    } else {
        old_user.trim().to_string()
    };
    // Valeurs effectives : fournies, sinon reprises sous l'ancienne clé (mot de
    // passe GDS, nom, description) — un champ laissé vide ne doit rien effacer.
    let mut password_eff = password.trim().to_string();
    let mut name_eff = name.trim().to_string();
    let mut description_eff = description.trim().to_string();
    // Valeurs techniques : conservées si laissées vides (même règle).
    let mut ssh_eff = ssh_port.trim().to_string();
    let mut repos_eff = server_repos.trim().to_string();
    let previous = read_gds_secrets()
        .ok()
        .and_then(|s| s.servers.get(&server_key(&old_host, &key_user)).cloned());
    if let Some(old) = previous {
        if password_eff.is_empty() {
            password_eff = old.gds_password.unwrap_or_default();
        }
        if name_eff.is_empty() {
            name_eff = old.name;
        }
        if description_eff.is_empty() {
            description_eff = old.description;
        }
        if ssh_eff.is_empty() {
            ssh_eff = old.ssh_port;
        }
        if repos_eff.is_empty() {
            repos_eff = old.gds_server_repos;
        }
    }
    let res =
        crate::gds_admin::perform_identity_login(&host, &http_port, &email, &password_eff, &key_user);
    let role = identity_login_role(&res)?;
    if server_key(&old_host, &key_user) != server_key(&host, &key_user) {
        let mut secrets = read_gds_secrets()?;
        secrets.servers.remove(&server_key(&old_host, &key_user));
        write_gds_secrets(&secrets)?;
    }
    save_gds_identity(
        &host,
        &key_user,
        &http_port,
        &email,
        &password_eff,
        &role,
    )?;
    set_server_label(&host, &key_user, &name_eff, &description_eff)?;
    set_server_technical(&host, &key_user, &ssh_eff, &repos_eff)?;
    let _ = record_server_test(&host, &key_user, true);
    Ok(json!({
        "ok": true,
        "host": host.trim(),
        "http_port": http_port.trim(),
        "email": email.trim(),
        "user": key_user,
        "role": role,
        "name": name_eff,
    }))
}

/// Commande Tauri : SUPPRIME un serveur mémorisé (clé `user@host`).
#[tauri::command]
pub fn gds_delete_saved_server(host: String, user: String) -> Result<Value, String> {
    if host.trim().is_empty() || user.trim().is_empty() {
        return Err("Hôte et utilisateur PostgreSQL sont requis".to_string());
    }
    let deleted = delete_saved_server(&host, &user)?;
    Ok(json!({ "ok": true, "deleted": deleted }))
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

// L1.9/L1.10 : la configuration pure du POSTE (`GdsConfig`) et les helpers purs
// qui en dérivent (URL du remote git, chemins POSIX côté serveur, détection de
// serveur local) vivent dans le socle partagé (`gds_core::config`), car le
// serveur autonome en a besoin. Consommés DIRECTEMENT depuis `gds_core` : plus
// de ré-export `pub(crate)` intermédiaire, donc la dérogation « imports
// inutilisés » disparaît. Deux helpers n'avaient plus AUCUN appelant
// (`effective_ssh_port`, `is_local_host`) : ils ne sont plus importés. Les
// helpers sollicités uniquement par les tests de ce module restent importés sous
// `cfg(test)` pour ne pas produire d'avertissement au build normal.
use gds_core::config::{
    default_gds_local_dir, gds_remote_url, is_local_gds_server, project_name, server_repo_path,
    ssh_host_from_db_host, ssh_host_from_server_url, GdsConfig,
};
#[cfg(test)]
use gds_core::config::{
    is_local_host_with, join_posix_path, server_host, ssh_host_from_db_addr,
};

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

/// Voie d'accès au serveur GDS pour les opérations de projet du poste.
///
/// * `Legacy` : écriture DIRECTE en base avec le compte technique de la base —
///   fiches serveur **héritées** (aucune identité de compte GDS mémorisée),
///   comportement strictement INCHANGÉ ;
/// * `Service` : appel de l'API du service GDS avec le **jeton du compte GDS de
///   l'utilisateur** (refonte GDS, lot 3) — le serveur applique les gardes de
///   rôle et crée le dépôt dans SA racine de dépôts.
///
/// Le choix se fait une fois par opération (`resolve_server_side`) : identité de
/// compte disponible → service, sinon repli historique.
pub(crate) enum ServerSide<'a> {
    Legacy(&'a PgPool),
    Service(gds_service::ServiceIdentity),
}

/// Voie à employer pour ce projet : le service dès qu'une identité de compte GDS
/// est mémorisée pour l'hôte du projet, la base directe sinon (fiches héritées).
///
/// Le pool est FACULTATIF (lot 4) : sur la voie service le poste n'a plus besoin
/// d'aucune connexion PostgreSQL (le serveur prépare SA base). Il n'est donc
/// requis que par la voie héritée — sans lui, l'erreur reste celle du poste non
/// provisionné (message inchangé, rendu actionnable par l'UI).
pub(crate) fn resolve_server_side<'a>(
    cfg: &GdsConfig,
    pool: Option<&'a PgPool>,
) -> Result<ServerSide<'a>, String> {
    match gds_service::resolve_service_identity(cfg) {
        Some(ident) => Ok(ServerSide::Service(ident)),
        None => match pool {
            Some(p) => Ok(ServerSide::Legacy(p)),
            None => Err("GDS non provisionné".to_string()),
        },
    }
}

/// Enregistre (idempotent) la clef SSH du poste sur la voie choisie.
///
/// * `Legacy` : enregistrement par le poste — serveur LOCAL, en base ET dans
///   `authorized_keys` ; serveur DISTANT, en base seulement (la clef est ajoutée
///   à la main sur le serveur : on n'administre jamais une machine distante) ;
/// * `Service` : le serveur la rattache lui-même au compte prouvé par le jeton.
pub(crate) async fn register_poste_key_for(
    side: &ServerSide<'_>,
    cfg: &GdsConfig,
    email: &str,
) -> Result<(), String> {
    match side {
        ServerSide::Legacy(pool) => {
            if is_local_gds_server(cfg) {
                gds_ssh::ensure_poste_key(pool, email).await?;
            } else {
                gds_ssh::ensure_poste_key_remote(pool, email).await?;
            }
        }
        ServerSide::Service(ident) => {
            gds_service::register_poste_key(ident).await?;
        }
    }
    Ok(())
}

/// Pool PostgreSQL FACULTATIF d'un projet (lot 4). Ordre :
///  1. le pool déjà ouvert dans `AppState` ;
///  2. **rien** si la config porte une identité de COMPTE GDS : la voie service
///     n'a besoin d'aucun pool (le serveur prépare sa base — aucune connexion
///     PostgreSQL, donc aucun port de base à publier) ;
///  3. sinon une reconnexion — voie héritée (compte technique), inchangée.
///
/// `None` n'est donc PAS une erreur ici : c'est la voie héritée sans base, que
/// `resolve_server_side` refusera avec un message clair. Fail-open : jamais
/// bloquant pour l'interface.
pub(crate) async fn optional_pool(
    state: &AppState,
    project: &str,
    cfg: Option<&GdsConfig>,
) -> Option<PgPool> {
    if let Some(p) = state.gds_pool.lock().ok().and_then(|g| g.clone()) {
        return Some(p);
    }
    let owned = read_gds_config(project).ok();
    let cfg = cfg.or(owned.as_ref());
    if cfg
        .map(|c| gds_service::resolve_service_identity(c).is_some())
        .unwrap_or(false)
    {
        return None;
    }
    restore_pool_for_project(project).await.ok()
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
/// Annulation d'un ajout raté sur un serveur LOCAL (voie héritée), limitée à
/// ce que cet essai a RÉELLEMENT créé : retire le dépôt bare créé par cet essai
/// ET les lignes de suivi du projet GDS. Sans la seconde partie, le projet
/// reste inscrit en base (`projects` + `git_repos`) alors que son dépôt n'existe
/// plus : Pilot l'annonce « enregistré sur le serveur » alors qu'il est
/// inutilisable (état contradictoire observé).
/// APPELÉE UNIQUEMENT quand le projet n'était PAS déjà inscrit avant l'essai
/// (voir `pre_existing` dans `add_project_with`) : un projet déjà inscrit — et
/// ses tickets/tâches en cascade — n'est jamais supprimé par une relance ratée.
/// Best-effort (jamais bloquant) et jamais destructif pour un projet de suivi :
/// `delete_project_by_name` ne cible que les projets GDS (`path IS NULL`).
async fn rollback_local_add(pool: &PgPool, local_dir: &str, name: &str) {
    let _ = gds_git::remove_bare(local_dir, name);
    let _ = gds_db::delete_project_by_name(pool, name).await;
}

// ── Confiance Git du compte de service (`safe.directory`) ──

/// Repose la confiance **étroite** du compte de service `git` sur la racine des
/// dépôts du projet. Best-effort : un échec est journalisé mais ne bloque JAMAIS
/// l'appelant (l'ajout du projet reste possible, le message Git restant clair).
fn ensure_local_service_trust(local_dir: &str) {
    let repos_root = gds_git::repos_dir(local_dir).to_string_lossy().to_string();
    let report = gds_git::ensure_service_trust(&repos_root);
    if let Some(err) = report.error {
        eprintln!(
            "[gds] confiance Git du compte `git` non posée ({}): {}",
            report.config_path, err
        );
    }
}

/// Repli **Windows** : repose l'entrée étroite avec les droits administrateur,
/// après une **seule** invitation système (rien à taper). Les valeurs sont
/// passées par variables d'environnement du processus PowerShell : aucun
/// échappement de chemin à gérer. `--replace-all` laisse la **seule** entrée
/// étroite (l'entrée trop large disparaît) et ne touche à aucun autre réglage.
#[cfg(windows)]
fn escalate_service_trust(config_path: &str, wanted: &str) -> Result<(), String> {
    let script = concat!(
        "$a = @('config','--file',$env:PILOT_TRUST_FILE,'--replace-all','safe.directory',$env:PILOT_TRUST_VALUE); ",
        "Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath git -ArgumentList $a"
    );
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .env("PILOT_TRUST_FILE", config_path)
        .env("PILOT_TRUST_VALUE", wanted)
        .output()
        .map_err(|e| format!("élévation impossible : {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "élévation refusée ou échouée : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Hors Windows, la confiance est assurée par le `chown` des dépôts : aucune
/// élévation n'existe (et n'est jamais atteinte).
#[cfg(not(windows))]
fn escalate_service_trust(_config_path: &str, _wanted: &str) -> Result<(), String> {
    Err("élévation disponible uniquement sous Windows".to_string())
}

/// Repli **Windows** pour la portée **machine** (`git config --system`) : même
/// invitation unique, mais l'écriture est **conditionnelle** — l'entrée étroite
/// n'est ajoutée que si absente, l'entrée large `*` est retirée, et aucune autre
/// racine déjà déclarée n'est perdue. La valeur passe par une variable
/// d'environnement (aucun échappement de chemin à gérer).
#[cfg(windows)]
fn escalate_system_service_trust(wanted: &str) -> Result<(), String> {
    let script = concat!(
        "$b = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('",
        "if (@(git config --system --get-all safe.directory 2>$null) -notcontains $env:PILOT_TRUST_VALUE) { ",
        "git config --system --fixed-value --unset-all safe.directory ''*'' 2>$null; ",
        "git config --system --add safe.directory $env:PILOT_TRUST_VALUE }')); ",
        "Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath powershell ",
        "-ArgumentList @('-NoProfile','-EncodedCommand',$b)"
    );
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .env("PILOT_TRUST_VALUE", wanted)
        .output()
        .map_err(|e| format!("élévation impossible : {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "élévation refusée ou échouée : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    // La preuve reste la RELECTURE faite par l'appelant (jamais supposée).
    Ok(())
}

#[cfg(not(windows))]
fn escalate_system_service_trust(_wanted: &str) -> Result<(), String> {
    Err("élévation disponible uniquement sous Windows".to_string())
}

/// Nombre de relectures après une élévation Windows, et intervalle entre elles
/// (~10 s au total) : `Start-Process -Verb RunAs -Wait` ne garantit PAS que le
/// processus élevé ait fini d'écrire (ShellExecuteEx n'offre aucun handle
/// d'attente) — une relecture immédiate et unique concluait donc à tort à un
/// échec alors que l'entrée aboutissait juste après (faux négatif).
const TRUST_RECHECK_ATTEMPTS: u32 = 40;
const TRUST_RECHECK_INTERVAL: Duration = Duration::from_millis(250);

/// Relit l'état réel après une élévation, jusqu'à ce que la relecture constate
/// l'entrée attendue (`error == None`) ou que la borne de relectures soit
/// épuisée. La lecture et l'attente sont **injectées** : décision pure, donc
/// testable sans disque, sans git et sans droits administrateur. Seul un échec
/// réellement constaté à l'issue de la borne est rendu (jamais un faux échec).
fn trust_after_escalation<R, S>(
    mut read: R,
    mut pause: S,
    attempts: u32,
) -> gds_git::ServiceTrustReport
where
    R: FnMut() -> gds_git::ServiceTrustReport,
    S: FnMut(),
{
    let mut report = read();
    for _ in 1..attempts {
        if report.error.is_none() {
            break;
        }
        pause();
        report = read();
    }
    report
}

/// Un clic : (re)pose la confiance **étroite** du compte de service `git` sur
/// la racine des dépôts de ce projet. Si l'écriture est refusée, une invitation
/// système Windows est déclenchée (aucune commande à taper), puis le fichier est
/// **relu** pour prouver le résultat. N'écrit QUE cette confiance : aucune
/// suppression, aucune reprise de propriétaire, aucun autre réglage.
#[tauri::command]
pub async fn gds_service_trust(project: String) -> Result<Value, String> {
    let cfg = read_gds_config(&project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let repos_root = gds_git::repos_dir(&local_dir).to_string_lossy().to_string();
    let mut report = gds_git::ensure_service_trust(&repos_root);
    let mut escalated = false;
    if report.error.is_some() {
        // Écriture refusée → invitation système, puis RELECTURE (preuve).
        escalate_service_trust(&report.config_path, &report.wanted)?;
        escalated = true;
        // L'écriture autorisée peut aboutir APRÈS le retour du lanceur : on relit
        // l'état réel plusieurs fois (borné) avant de conclure.
        report = trust_after_escalation(
            || gds_git::ensure_service_trust(&repos_root),
            || std::thread::sleep(TRUST_RECHECK_INTERVAL),
            TRUST_RECHECK_ATTEMPTS,
        );
    }
    if let Some(err) = &report.error {
        return Err(format!("Confiance Git non posée : {}", err));
    }
    // Portée **machine** : le git lancé par sshd (ForceCommand du compte `git`)
    // n'a PAS le home du compte de service — seul `git config --system` le fait
    // passer (le `receive-pack` d'un push refuse sinon en « dubious ownership »).
    // Même entrée étroite, mêmes garanties : idempotent, jamais `*` seul.
    let mut system = gds_git::ensure_system_service_trust(&repos_root);
    if system.error.is_some() {
        escalate_system_service_trust(&system.wanted)?;
        escalated = true;
        // Idem portée machine : relectures bornées, jamais une lecture unique.
        system = trust_after_escalation(
            || gds_git::ensure_system_service_trust(&repos_root),
            || std::thread::sleep(TRUST_RECHECK_INTERVAL),
            TRUST_RECHECK_ATTEMPTS,
        );
    }
    if let Some(err) = &system.error {
        return Err(format!("Confiance Git de portée machine non posée : {}", err));
    }
    Ok(json!({
        "ok": true,
        "config_path": report.config_path,
        "directory": report.wanted,
        "modified": report.modified,
        "broad_found": report.broad_found,
        "escalated": escalated,
        "entries": report.final_values,
        "system_scope": system.config_path,
        "system_modified": system.modified,
        "system_entries": system.final_values,
    }))
}

pub(crate) async fn add_project_to_gds(
    pool: Option<&PgPool>,
    project: &str,
    email: &str,
    git_name: Option<String>,
) -> Result<Value, String> {
    let cfg = read_gds_config(project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let side = resolve_server_side(&cfg, pool)?;
    add_project_with(&cfg, side, project, email, git_name).await
}

/// Corps commun de l'ajout d'un projet, sur la voie choisie (`ServerSide`).
/// Seuls trois points divergent entre les deux voies : la garde de droits, la
/// clef SSH du poste et la création du dépôt bare.
async fn add_project_with(
    cfg: &GdsConfig,
    side: ServerSide<'_>,
    project: &str,
    email: &str,
    git_name: Option<String>,
) -> Result<Value, String> {
    let name = project_name(project);
    // Matrice des droits (L3.5) : l'ajout d'un projet au serveur et sa
    // publication initiale sont réservés à l'administrateur ou à un développeur
    // (tout compte du serveur voit tous les projets, sans attribution ; le rôle
    // `standard` reste en lecture seule). Refus AVANT toute action (clef SSH,
    // dépôt, push) pour ne rien modifier en cas de refus.
    // Les DEUX voies appliquent cette même règle : ici, la base du poste est
    // interrogée (`ensure_can_add_project`) ; sur la voie SERVICE, c'est le
    // serveur qui l'applique (`POST /api/gds/projects/create` →
    // `ensure_can_add_project`, identité relue dans le jeton) : le poste ne
    // réimplémente rien, mais rien n'est non plus laissé sans garde.
    if let ServerSide::Legacy(pool) = &side {
        gds_db::ensure_can_add_project(pool, &name, email, "desktop").await?;
    }
    // Phase A3 : s'assurer que la clef du poste est enregistrée pour que le
    // remote `ssh://git@<host>:<port>/<projet>.git` soit utilisable.
    register_poste_key_for(&side, cfg, email).await?;
    let is_local = is_local_gds_server(cfg);
    let local_dir = cfg.gds_local_dir.clone().unwrap_or_else(default_gds_local_dir);
    let repo_url = gds_remote_url(cfg, &name);

    // Garde-fou Windows : la confiance étroite du compte `git` sur le dossier des
    // dépôts doit être en place AVANT la création du bare, sinon le push initial
    // est refusé (« detected dubious ownership »). Une seule lecture de fichier
    // en coût ; best-effort, jamais bloquant.
    if is_local {
        ensure_local_service_trust(&local_dir);
    }

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

    // Prudence DONNÉES (reprise après relecture) : mémoriser si le projet était
    // DÉJÀ inscrit en base AVANT cet essai. Un administrateur (ou un dev
    // attribué) qui relance « Ajouter » sur un projet existant ne doit jamais
    // voir son inscription, ses tickets ni ses tâches supprimés par une
    // annulation. En cas de doute (erreur de lecture de la base), on suppose le
    // projet préexistant → aucune suppression (voie prudente).
    let pre_existing = match &side {
        ServerSide::Legacy(pool) => gds_db::get_project_by_name(pool, &name)
            .await
            .map(|v| v.is_some())
            .unwrap_or(true),
        // Voie service : aucune suppression locale de toute façon.
        ServerSide::Service(_) => true,
    };

    // Bare serveur + enregistrement en base (idempotent). Serveur LOCAL : bare
    // créé sur le poste (`<gds_local_dir>/repos/<nom>.git`), comportement
    // INCHANGÉ. Serveur DISTANT : AUCUN bare local ; on enregistre seulement le
    // projet/le dépôt en base avec le chemin POSIX côté serveur (le bare est créé
    // manuellement sur le serveur, docs/gds-server-setup.md).
    let res = match &side {
        ServerSide::Legacy(pool) if is_local => {
            gds_git::add_project(pool, &local_dir, &name, email, "").await?
        }
        ServerSide::Legacy(pool) => {
            let path_on_server = server_repo_path(cfg, &name).ok_or_else(|| {
                "Racine des dépôts serveur non renseignée (champ « Racine des dépôts \
                 serveur », onglet GDS) — requise pour un serveur distant"
                    .to_string()
            })?;
            gds_git::add_project_remote(pool, &name, &path_on_server, &repo_url, email, "").await?
        }
        // Voie service : le serveur crée son projet ET son dépôt bare dans SA
        // racine de dépôts (il ne dépend plus du chemin configuré sur le poste),
        // rattachés au compte de la session. Idempotent.
        ServerSide::Service(ident) => gds_service::create_project(ident, &name).await?,
    };

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

    // État partiel évité (serveur LOCAL uniquement, projet réellement nouveau) :
    // un échec (remote add / push) laisse le bare local déjà créé → le retirer
    // proprement ET annuler l'inscription du projet en base (`rollback_local_add`),
    // pour ne pas rester « à moitié attaché » (projet annoncé sur le serveur sans
    // dépôt). Un projet DÉJÀ inscrit n'est JAMAIS annulé : on renvoie l'erreur
    // telle quelle, sans supprimer son inscription ni ses données en cascade.
    // Serveur DISTANT : rien n'a été créé sur le poste, on ne supprime RIEN (le
    // dépôt serveur est sous responsabilité manuelle) et on renvoie un message
    // orientant vers la préparation serveur.
    match remote_result {
        Err(join_err) => {
            if is_local && !pre_existing {
                if let ServerSide::Legacy(pool) = &side {
                    rollback_local_add(pool, &local_dir, &name).await;
                }
            }
            return Err(join_err);
        }
        Ok(Err(inner_err)) => {
            if is_local {
                if let ServerSide::Legacy(pool) = &side {
                    if !pre_existing {
                        rollback_local_add(pool, &local_dir, &name).await;
                    }
                    return Err(inner_err);
                }
            }
            // Voie service : rien n'est retiré — le dépôt du serveur n'est pas
            // sous la responsabilité du poste. Relancer l'ajout est sans risque
            // (projet et dépôt déjà créés, le serveur les réutilise).
            return Err(format!(
                "{} — vérifiez que le dépôt bare existe sur le serveur \
                 (docs/gds-server-setup.md)",
                inner_err
            ));
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
    // Seul l'HÔTE est commun aux deux voies : l'utilisateur PostgreSQL n'existe
    // que sur la voie héritée (compte technique).
    if host.is_empty() {
        return Err("Hôte PostgreSQL requis".to_string());
    }
    // ── Voie « compte GDS » (lot 4) : la préparation de la base appartient au
    // SERVEUR (son amorçage la provisionne et rejoue les migrations, idempotent).
    // Le poste n'ouvre AUCUNE connexion PostgreSQL : ni compte technique
    // (utilisateur dédié, mots de passe), ni port de base. On vérifie seulement
    // que le SERVICE répond — c'est la preuve que sa base est prête.
    if let Some(ident) = gds_service::resolve_identity_for_host(&host, &admin_email) {
        gds_service::service_health(&ident.host, &ident.http_port).await?;
        let existing = read_gds_config(&project).ok();
        let local_dir = existing
            .as_ref()
            .and_then(|c| c.gds_local_dir.clone())
            .unwrap_or_else(default_gds_local_dir);
        let ssh_port = existing.as_ref().map(|c| c.ssh_port).unwrap_or(22);
        let gds_server_repos = existing.as_ref().and_then(|c| c.gds_server_repos.clone());
        let cfg = GdsConfig {
            enabled: true,
            db_host: host.clone(),
            db_port: port.clone(),
            // Aucun compte technique : la base est la propriété du serveur.
            db_user: String::new(),
            // L'identité du projet est celle du COMPTE GDS employé (elle doit
            // rester cohérente avec la fiche pour que la session se rouvre).
            identity_email: ident.email.clone(),
            server_url: String::new(),
            gds_local_dir: Some(local_dir.clone()),
            ssh_port,
            gds_server_repos,
            ssh_host: ssh_host_from_db_host(&host, ssh_port),
        };
        write_gds_config(&project, &cfg)?;
        // AUCUN secret enregistré : il n'y en a aucun à enregistrer. Rien n'est
        // effacé (les secrets d'une fiche héritée restent en place).
        return Ok(json!({
            "ok": true,
            "db": gds_db::GDS_DB_NAME,
            "repos_dir": "",
            "manual_setup": false,
            "service": true,
        }));
    }
    // ── Voie héritée (compte technique) : seule voie où ces informations sont
    // requises. L'utilisateur PostgreSQL est indispensable ici.
    if user.is_empty() {
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
    // Configuration existante : préserve `gds_local_dir`, le PORT SSH et la
    // racine des dépôts serveur (re-provision idempotent — ne réinitialise JAMAIS
    // vers `~/Pilot/GDS` ni le port 22 si l'utilisateur les a personnalisés).
    let existing = read_gds_config(&project).ok();
    let local_dir = existing
        .as_ref()
        .and_then(|c| c.gds_local_dir.clone())
        .unwrap_or_else(default_gds_local_dir);
    let ssh_port = existing.as_ref().map(|c| c.ssh_port).unwrap_or(22);
    let gds_server_repos = existing.as_ref().and_then(|c| c.gds_server_repos.clone());
    // Écrire la config projet (activation) SANS mot de passe.
    let cfg = GdsConfig {
        enabled: true,
        db_host: host.clone(),
        db_port: port.clone(),
        db_user: user.clone(),
        identity_email: admin_email.trim().to_string(),
        server_url: format!("postgres://{}@{}:{}/postgres", user, host, port),
        gds_local_dir: Some(local_dir.clone()),
        ssh_port,
        gds_server_repos,
        ssh_host: ssh_host_from_db_host(&host, ssh_port),
    };
    // Serveur LOCAL : provision SSH locale (user git + authorized_keys + sshd) et
    // dossier des repos local — comportement historique INCHANGÉ. Serveur
    // DISTANT : AUCUNE administration ni création sur le poste (la préparation
    // du serveur est MANUELLE, voir docs/gds-server-setup.md) ; on génère
    // seulement la clef du poste et on l'enregistre en base pour affichage.
    let is_local = is_local_gds_server(&cfg);
    let mut repos_dir_str = String::new();
    let ssh_public_key: String;
    if is_local {
        gds_core::ssh::provision_server_ssh()?;
        let key = gds_ssh::ensure_poste_key(&pool, &admin_email).await?;
        ssh_public_key = key["public_key"].as_str().unwrap_or("").to_string();
        let repos = gds_git::repos_dir(&local_dir);
        std::fs::create_dir_all(&repos).map_err(|e| format!("Création dossier repos: {}", e))?;
        repos_dir_str = repos.to_string_lossy().to_string();
        // Confiance étroite du compte de service `git` sur les dépôts créés par
        // ce poste (Windows ; sans effet sur Unix) — posée une fois pour toutes.
        ensure_local_service_trust(&local_dir);
    } else {
        let key = gds_ssh::ensure_poste_key_remote(&pool, &admin_email).await?;
        ssh_public_key = key["public_key"].as_str().unwrap_or("").to_string();
    }
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
    Ok(json!({
        "ok": true,
        "db": gds_db::GDS_DB_NAME,
        "repos_dir": repos_dir_str,
        "manual_setup": !is_local,
        "ssh_public_key": ssh_public_key,
    }))
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
            "Mot de passe PostgreSQL non enregistré — ressaisissez-le dans l'onglet GDS \
             (bouton « Enregistrer les mots de passe », sans refaire l'activation)."
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
    // Voie « compte GDS » (lot 4) : aucun pool à préparer ni à restaurer côté
    // poste — le serveur a déjà préparé SA base. On ne se connecte donc JAMAIS à
    // PostgreSQL ici (limite n°1 levée : plus d'attente réseau du compte
    // technique sur le chemin projet).
    if gds_service::resolve_service_identity(&cfg).is_some() {
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
    // Voie « compte GDS » : rien à provisionner côté poste — on le dit à l'UI
    // (l'état « connecté » vient de la santé du service, pas d'un pool).
    if let Ok(cfg) = read_gds_config(&project) {
        if cfg.enabled && gds_service::resolve_service_identity(&cfg).is_some() {
            return Ok(json!({ "ok": true, "provisioned": true, "service": true }));
        }
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
    // Pool FACULTATIF (lot 4) : la voie « compte GDS » n'en a aucun besoin (le
    // serveur prépare sa base) ; la voie héritée le retrouve comme avant.
    let pool = optional_pool(&state, &project, None).await;
    add_project_to_gds(pool.as_ref(), &project, &email, git_name).await
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
/// - Préserve `gds_local_dir`, `db_host`, `db_port`, `db_user`
///   si le payload ne les inclut pas (l'UI simplifiée n'envoie plus que
///   `enabled` + `identity_email`) — sinon perte de données à chaque sauvegarde.
/// - L'UI n'envoie plus jamais d'URL à mot de passe : `server_url` est toujours
///   reconstruit SANS mot de passe par `write_gds_config` (normalize).
#[tauri::command]
pub fn gds_save_config(
    project: String,
    mut cfg: GdsConfig,
    db_password: Option<String>,
    admin_password: Option<String>,
) -> Result<(), String> {
    let existing = read_gds_config(&project).ok();
    if cfg.gds_local_dir.is_none() {
        if let Some(ex) = &existing {
            cfg.gds_local_dir = ex.gds_local_dir.clone();
        }
    }
    // Préserve le port SSH (0 = non fourni par l'UI) et la racine des dépôts
    // serveur (None = non fournie), comme les autres champs.
    if cfg.ssh_port == 0 {
        if let Some(ex) = &existing {
            cfg.ssh_port = ex.ssh_port;
        }
    }
    if cfg.gds_server_repos.is_none() {
        if let Some(ex) = &existing {
            cfg.gds_server_repos = ex.gds_server_repos.clone();
        }
    }
    // Préserve les champs PostgreSQL non envoyés par l'UI (hôte/port/user) —
    // SAUF si une NOUVELLE `server_url` est fournie (elle fait alors autorité :
    // `normalize()` en dérive l'hôte/port/utilisateur).
    let server_changed = existing
        .as_ref()
        .map(|ex| !cfg.server_url.trim().is_empty() && ex.server_url != cfg.server_url)
        .unwrap_or(false);
    if cfg.db_host.is_empty() && !server_changed {
        if let Some(ex) = &existing {
            cfg.db_host = ex.db_host.clone();
        }
    }
    if cfg.db_port.is_empty() && !server_changed {
        if let Some(ex) = &existing {
            cfg.db_port = ex.db_port.clone();
        }
    }
    if cfg.db_user.is_empty() && !server_changed {
        if let Some(ex) = &existing {
            cfg.db_user = ex.db_user.clone();
        }
    }
    // Recalcule ssh_host si vide ou si l'adresse a changé : hôte PostgreSQL en
    // priorité, sinon `server_url`, sinon valeur inchangée.
    let recompute = cfg.ssh_host.is_empty() || server_changed;
    if recompute {
        cfg.ssh_host = if !cfg.db_host.trim().is_empty() {
            ssh_host_from_db_host(&cfg.db_host, cfg.ssh_port)
        } else if !cfg.server_url.trim().is_empty() {
            ssh_host_from_server_url(&cfg.server_url, cfg.ssh_port)
        } else {
            cfg.ssh_host.clone()
        };
    }
    // Ressaisie de mot de passe SANS refaire `gds_provision` (T5) : les mots de
    // passe sont écrits HORS projet (`~/.pilot/gds_secrets.json`, 0600) — jamais
    // dans `.pilot/gds.json`. Un champ vide PRÉSERVE la valeur existante.
    if db_password.as_deref().map(|p| !p.is_empty()).unwrap_or(false)
        || admin_password.as_deref().map(|p| !p.is_empty()).unwrap_or(false)
    {
        save_project_secrets(
            &project,
            db_password.as_deref().unwrap_or(""),
            admin_password.as_deref().unwrap_or(""),
        )?;
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
/// déjà en local »). En plus, `work_exists` / `work_path` signalent qu'un PROJET
/// DE TRAVAIL existant (ouvert ou récent, AppConfig) porte un nom de dossier
/// identique au dépôt GDS à un AUTRE chemin que le clone — l'UI synchronise alors
/// ce projet au lieu de cloner un doublon (issue doublon GDS). Le dossier local
/// est lu depuis la config du projet courant (paramètre optionnel) avec repli sur
/// le défaut — aucune I/O de clone ici. Fail-open : une erreur de lecture des
/// projets ouverts/récents laisse la détection `work_*` inerte (liste OK).
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
    // Projets de travail connus (ouverts + récents) pour éviter de re-cloner un
    // projet déjà présent comme projet de travail à un AUTRE chemin que le clone
    // GDS (issue doublon GDS : ex. `G:\IA_PL\Kodali` + `C:\GDS\Kodali`).
    // Fail-open : toute erreur de lecture laisse `work_projects` vide — la
    // détection est alors inerte (pas de crash de la liste des dépôts).
    let mut work_projects: Vec<String> = Vec::new();
    if let Ok(cfg) = state.config.lock() {
        work_projects.extend(cfg.open_projects.iter().cloned());
        work_projects.extend(cfg.recent_projects.iter().cloned());
    }
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
        // Détection « existe comme projet de travail » : un projet ouvert/récent
        // dont le NOM DE DOSSIER (que le chemin) correspond au dépôt GDS, à un
        // chemin DIFFÉRENT du clone GDS (`local_path`). On prend le premier match
        // (projets ouverts privilégiés car ajoutés en premier).
        let mut work_exists = false;
        let mut work_path = String::new();
        if !name.is_empty() && !work_projects.is_empty() {
            let name_lower = name.to_lowercase();
            let clone_norm = crate::normalize_project_path(&local_path);
            for wp in work_projects.iter() {
                let wp_norm = crate::normalize_project_path(wp);
                if wp_norm == clone_norm {
                    continue; // c'est le clone GDS lui-même (cas local_exists).
                }
                let folder = wp_norm.rsplit('/').next().unwrap_or("");
                if !folder.is_empty() && folder.to_lowercase() == name_lower {
                    work_exists = true;
                    work_path = wp.clone();
                    break;
                }
            }
        }
        r["work_exists"] = json!(work_exists);
        r["work_path"] = json!(work_path);
        if r["email"].as_str().unwrap_or("").is_empty() && !cfg_email.is_empty() {
            r["email"] = json!(cfg_email);
        }
    }
    Ok(repos)
}

/// Helper partagé « attache d'un dossier au GDS » (refonte dossier-unique).
/// Connecte un dossier local cible (`target`) au GDS : lui écrit son propre
/// `.pilot/gds.json` (même serveur/identité/dossier que la config de référence
/// `cfg`), s'assure que la clef du poste est enregistrée et associe le dossier
/// au serveur via `add_project_to_gds` (idempotent, fail-open). Utilisé par
/// `gds_clone_repo` (non-régression) et par la commande `gds_connect_existing`.
/// N'inclut AUCUNE suppression — c'est un attachement, pas une purge.
async fn connect_dir_to_gds(
    pool: Option<&PgPool>,
    target: &str,
    cfg: &GdsConfig,
    email: &str,
    local_dir: &str,
) -> Result<(), String> {
    // Écrire au dossier cible sa propre config `.pilot/gds.json` (même
    // serveur/identité/dossier que le projet de référence) — nécessaire pour
    // `add_project_to_gds` (qui exige une config activée) et pour que les
    // sync/push suivants fonctionnent depuis ce dossier.
    let target_cfg = GdsConfig {
        enabled: true,
        db_host: cfg.db_host.clone(),
        db_port: cfg.db_port.clone(),
        db_user: cfg.db_user.clone(),
        identity_email: email.to_string(),
        server_url: cfg.server_url.clone(),
        gds_local_dir: Some(local_dir.to_string()),
        ssh_port: cfg.ssh_port,
        gds_server_repos: cfg.gds_server_repos.clone(),
        ssh_host: cfg.ssh_host.clone(),
    };
    write_gds_config(target, &target_cfg)?;
    // La clef du poste est enregistrée par `add_project_with` sur la voie choisie
    // (service ou héritée) : un seul appel, aucune duplication.
    add_project_to_gds(pool, target, email, None).await?;
    Ok(())
}

/// Commande Tauri : connecte un DOSSIER DE TRAVAIL EXISTANT au GDS (refonte
/// dossier-unique). `project` = projet courant de travail (fournit la config
/// GDS de référence + l'identité email) ; `target_dir` = dossier local existant
/// à connecter. (a) écrit le `.pilot/gds.json` du dossier cible depuis la
/// config du projet de référence ; (b) si le dossier n'est pas un repo git, il
/// est initialisé via `ensure_git_repo_with_identity` (pattern add_project_to_gds) ;
/// (c) connecte via le helper partagé (clef poste + remote gds + push initial).
/// Retourne `{ path, initialized }`. Opérations git bloquantes → `spawn_blocking`.
/// N'inclut AUCUNE suppression.
#[tauri::command]
pub async fn gds_connect_existing(
    state: State<'_, AppState>,
    project: String,
    target_dir: String,
) -> Result<Value, String> {
    if target_dir.trim().is_empty() {
        return Err("Dossier cible requis".to_string());
    }
    let target_dir = target_dir.trim().to_string();
    // Config GDS du projet de référence (email + dossier local + serveur SSH).
    let cfg = read_gds_config(&project)?;
    if !cfg.enabled {
        return Err("GDS non activé pour ce projet".to_string());
    }
    let email = effective_identity_email(&cfg.identity_email);
    if email.is_empty() {
        return Err("Identité email manquante — configurez le bloc « Identité » du GDS.".to_string());
    }
    let local_dir = cfg
        .gds_local_dir
        .clone()
        .unwrap_or_else(default_gds_local_dir);
    let pool = optional_pool(&state, &project, Some(&cfg)).await;

    // (b) Si le dossier n'est pas encore un dépôt Git, initialiser le dépôt
    // local + premier commit, en réglant l'identité git (auto) si absente.
    // Idempotent : un dossier déjà repo renvoie false et ne refait rien.
    let email_conn = email.trim().to_string();
    let current = tokio::task::spawn_blocking({
        let p = target_dir.clone();
        move || (git_config_user_name(&p), git_config_user_email(&p))
    })
    .await
    .map_err(|e| e.to_string())?;
    let needs_name = current.0.is_empty();
    let resolved_name: Option<String> = if needs_name {
        Some(effective_git_name(&None)?)
    } else {
        None
    };
    let dir_init = target_dir.clone();
    let name_for_identity = resolved_name.clone().unwrap_or_default();
    let initialized = tokio::task::spawn_blocking(move || {
        ensure_git_repo_with_identity(&dir_init, &email_conn, &name_for_identity)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Mémoriser le nom utilisé (saisi une seule fois) pour la prochaine fois.
    if let Some(n) = &resolved_name {
        let _ = memorize_git_name(n);
    }

    // (a)+(c) Connecter le dossier au GDS via le helper partagé (gds.json +
    // clef poste + add_project_to_gds). Aucune suppression.
    connect_dir_to_gds(pool.as_ref(), &target_dir, &cfg, &email, &local_dir).await?;

    Ok(json!({ "path": target_dir, "initialized": initialized }))
}

/// Commande Tauri : supprime UNIQUEMENT le worktree dupliqué `<gds_local_dir>/<name>`
/// (refonte dossier-unique). Sûre : ne touche JAMAIS au dossier connecté
/// (`connected_dir`), jamais au projet actuellement ouvert, et jamais dans
/// `<local_dir>/repos/` (protection du bare). **Non destructif par défaut** :
/// si `confirm=false`, renvoie une simulation (dry-run, removed=false + chemin
/// à supprimer prévu) ; la suppression réelle exige `confirm=true` (confirmation
/// utilisateur gérée côté frontend). Retourne `{ removed, path }` (et `dry_run`
/// en mode simulation). Opération fs → `spawn_blocking`.
#[tauri::command]
pub async fn gds_remove_dup_worktree(
    state: State<'_, AppState>,
    project: String,
    dup_dir: String,
    connected_dir: String,
    confirm: bool,
) -> Result<Value, String> {
    if dup_dir.trim().is_empty() || connected_dir.trim().is_empty() {
        return Err("Chemins requis".to_string());
    }
    let dup_dir = dup_dir.trim().to_string();
    let connected_dir = connected_dir.trim().to_string();
    let dup_norm = crate::normalize_project_path(&dup_dir);
    let conn_norm = crate::normalize_project_path(&connected_dir);

    // Jamais de suppression du dossier venant d'être connecté.
    if dup_norm == conn_norm {
        return Err("Le dossier dupliqué est le dossier connecté — rien à supprimer.".to_string());
    }
    // Jamais de suppression du dossier cible s'il est dans `repos/` (bare).
    let local_dir = read_gds_config(&project)
        .ok()
        .and_then(|c| c.gds_local_dir)
        .unwrap_or_else(default_gds_local_dir);
    let repos = gds_git::repos_dir(&local_dir);
    let repos_norm = crate::normalize_project_path(&repos.to_string_lossy());
    if dup_norm.starts_with(&repos_norm) {
        return Err("Le dossier cible se situe dans le dossier repos GDS (bare) — suppression refusée.".to_string());
    }
    // Jamais de suppression du projet actuellement ouvert.
    if let Ok(gcfg) = state.config.lock() {
        for p in gcfg.open_projects.iter().chain(gcfg.active_open_project.iter()) {
            if crate::normalize_project_path(p) == dup_norm {
                return Err("Impossible de supprimer le projet actuellement ouvert : « ".to_string()
                    + &dup_dir + " ».");
            }
        }
    }
    // Absent → rien à supprimer (informatif, non bloquant).
    if !std::path::Path::new(&dup_dir).exists() {
        return Ok(json!({ "removed": false, "path": dup_dir, "absent": true }));
    }

    // Non destructif par défaut : simulation (dry-run) tant que confirm=false.
    if !confirm {
        return Ok(json!({ "removed": false, "path": dup_dir, "dry_run": true }));
    }

    // Suppression réelle (opération fs bloquante → spawn_blocking).
    let dup_for_rm = dup_dir.clone();
    let removed = tokio::task::spawn_blocking(move || {
        std::fs::remove_dir_all(&dup_for_rm)
            .map_err(|e| format!("Suppression de « {} » : {}", dup_for_rm, e))?;
        Ok::<bool, String>(true)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(json!({ "removed": removed, "path": dup_dir }))
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
    // Pool : facultatif (lot 4). Le clone sort du garde Mutex AVANT l'await
    // (garde non-Send à ne pas porter).
    let pool = optional_pool(&state, &project, Some(&cfg)).await;
    // Phase A3 : la clef du poste doit être enregistrée pour le remote SSH
    // (voie héritée historique ou voie service selon l'identité du projet).
    register_poste_key_for(&resolve_server_side(&cfg, pool.as_ref())?, &cfg, &email).await?;

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

    // Connecter le clone au GDS (helper partagé) : lui écrire son `.pilot/gds.json`
    // + clef du poste + enregistrement serveur (idempotent, fail-open). Le remote
    // dédié `gds` est ajouté et un éventuel push initial est fait. Ne touche JAMAIS
    // au bare serveur ni à un worktree local existant.
    connect_dir_to_gds(pool.as_ref(), &dest_str, &cfg, &email, &local_dir).await?;

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
    let purge_cfg = read_gds_config(&project).ok();
    let local_dir = purge_cfg
        .as_ref()
        .and_then(|c| c.gds_local_dir.clone())
        .unwrap_or_else(default_gds_local_dir);
    let pool_for_purge = if purge_server {
        // Pool facultatif (lot 4) : la voie service n'en a pas besoin.
        optional_pool(&state, &project, purge_cfg.as_ref()).await
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
        // Serveur LOCAL : suppression du bare sur le poste. Serveur DISTANT :
        // on ne touche JAMAIS au disque (ni local ni distant) — la préparation
        // et le nettoyage du serveur sont manuels (docs/gds-server-setup.md) ; on
        // purge seulement les entrées de la base GDS.
        if purge_cfg.as_ref().map(is_local_gds_server).unwrap_or(true) {
            gds_git::remove_bare(&local_dir, &name)?;
        }
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
/// `remote_ok` = remote `gds` présent, `branch` = la branche attendue existe
/// sur le dépôt RÉELLEMENT servi (`Some(true)` oui, `Some(false)` non — dépôt
/// vide jamais publié, `None` = dépôt non interrogeable).
///  - config absente (ou non activée) → `not_configured`
///  - tout coché ET branche publiée → `connected`
///  - tout coché mais dépôt distant vide → `not_published` (action : publier)
///  - sinon → `error`
pub(crate) fn connection_status_from_flags(
    configured: bool,
    enabled: bool,
    has_pw: bool,
    pool_ok: bool,
    bare_ok: bool,
    remote_ok: bool,
    branch: Option<bool>,
) -> &'static str {
    if !configured || !enabled {
        return "not_configured";
    }
    if has_pw && pool_ok && bare_ok && remote_ok {
        return match branch {
            Some(true) => "connected",
            // Dépôt du serveur VIDE : le projet n'a jamais été publié. Le dépôt
            // existe et le service répond, mais la synchronisation ne peut pas
            // fonctionner — jamais « connecté », et l'écran le dit clairement.
            Some(false) => "not_published",
            // Dépôt non interrogeable (réseau, clef, chemin obsolète) : « à
            // vérifier », jamais une liaison annoncée sur une supposition.
            None => "error",
        };
    }
    "error"
}

/// État de la branche attendue sur le dépôt RÉELLEMENT servi par le remote
/// `gds` du poste : on interroge le serveur (`git ls-remote`), on ne déduit
/// rien d'une ligne en base ni d'un dossier du poste. Bloquant (git réseau) →
/// à appeler depuis `spawn_blocking`.
fn remote_branch_state(project: &str) -> Option<bool> {
    let branch = crate::git::git_current_branch(project);
    crate::git::git_remote_branch_state(project, "gds", &branch)
}

/// Délai maximal accordé à la reconnexion GDS (connexion + migrations) quand
/// aucun pool actif n'est disponible. Passé ce délai, la vérification répond
/// `false` : sans borne, l'étape `migrate` (verrou consultatif PostgreSQL)
/// pouvait laisser `gds_connection_status` sans réponse — et l'onglet « 🌐 GDS »
/// s'affichait entièrement vide (rapport onglet GDS vide, §5 et §9).
const GDS_RESTORE_TIMEOUT: Duration = Duration::from_secs(3);

/// Borne une attente : renvoie `None` si `fut` ne se règle pas dans `dur`.
/// Garantit qu'une commande async de Tauri répond TOUJOURS quelque chose.
async fn bounded<T>(dur: Duration, fut: impl std::future::Future<Output = T>) -> Option<T> {
    tokio::time::timeout(dur, fut).await.ok()
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
    // dernier recours, puis stockage du pool si elle réussit. L'attente est
    // BORNÉE : l'étape de migration peut attendre indéfiniment un verrou
    // consultatif PostgreSQL — au-delà du délai, la vérification répond (false)
    // au lieu de laisser la commande sans réponse (écran vide côté onglet).
    let ok = match bounded(GDS_RESTORE_TIMEOUT, restore_pool_for_project(project)).await {
        Some(Ok(p)) => {
            let alive = tokio::time::timeout(
                Duration::from_secs(2),
                sqlx::query("SELECT 1").execute(&p),
            )
            .await
            .ok()
            .and_then(|r| r.ok())
            .is_some();
            // Verrou mémoire empoisonné : on ne panique JAMAIS (une commande doit
            // toujours répondre) ; le pool est alors simplement fermé. Le garde
            // est lâché AVANT tout `await` (futur non-`Send`).
            let mut slot = Some(p);
            let stored = if alive {
                match state.gds_pool.lock() {
                    Ok(mut g) => {
                        *g = slot.take();
                        true
                    }
                    Err(_) => false,
                }
            } else {
                false
            };
            if !stored {
                if let Some(p) = slot {
                    let _ = p.close().await;
                }
            }
            stored
        }
        // Délai dépassé (migration bloquée) ou connexion impossible.
        Some(Err(_)) => false,
        None => {
            // Trace de cette classe de panne (borne atteinte : base muette ou
            // verrou de migration occupé) — ne doit plus être silencieuse.
            eprintln!(
                "[gds] vérification de connexion bornée pour « {} » ({} s) : base muette ou verrou de migration occupé",
                name,
                GDS_RESTORE_TIMEOUT.as_secs()
            );
            false
        }
    };
    if let Ok(mut lock) = gds_pool_cache().lock() {
        lock.insert(name, (now, ok));
    }
    ok
}

/// Vrai si le dépôt bare d'un projet existe côté serveur GDS.
///
/// PRINCIPE : une information lue sur CE poste ne peut JAMAIS fonder
/// « Connecté », sauf s'il est établi que ce poste EST le serveur — le serveur
/// local **natif historique**, dont la racine des dépôts est déclarée par un
/// chemin du poste (Windows, ex. `C:\GDS\repos`). Dans ce seul cas : test du
/// système de fichiers (`<gds_local_dir>/repos/<nom>.git`), comportement
/// historique INCHANGÉ.
/// Dans TOUS les autres cas — racine des dépôts NON renseignée, racine POSIX
/// absolue (`/srv/git/repos` = conteneur/service) ou serveur DISTANT — la
/// réponse vient du serveur (base PostgreSQL `git_repos`) : le disque du poste
/// n'est jamais consulté. Un simple dossier homonyme sous `gds_local_dir` ne
/// doit pas faire conclure « Connecté » alors que rien n'a été poussé (constats
/// de terrain : conteneur vu comme local avec `db_host = 127.0.0.1`, ou racine
/// des dépôts non renseignée).
///
/// Fail-open : erreur DB ou pool absent → false, donc « à vérifier », jamais
/// « Connecté » sur une supposition. Aucun secret révélé.
pub(crate) async fn server_bare_exists(
    pool: Option<&PgPool>,
    cfg: &GdsConfig,
    name: &str,
) -> bool {
    // Seule preuve LOCALE admise : ce poste EST le serveur — local ET racine des
    // dépôts déclarée en chemin du poste (donc non POSIX absolu).
    let declared_root = cfg
        .gds_server_repos
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let poste_is_the_server =
        is_local_gds_server(cfg) && declared_root.is_some_and(|r| !r.starts_with('/'));
    if poste_is_the_server {
        let local_dir = cfg
            .gds_local_dir
            .clone()
            .unwrap_or_else(default_gds_local_dir);
        return gds_git::bare_repo_exists(&local_dir, name);
    }
    match pool {
        Some(p) => gds_db::project_has_git_repo(p, name).await.unwrap_or(false),
        None => false,
    }
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
    // Voie « compte GDS » (lot 4) : l'état se lit auprès du SERVICE (santé +
    // existence du dépôt), jamais par une connexion PostgreSQL — ni compte
    // technique, ni port de base. Fail-open : service muet → « error ».
    if let Some(ident) = gds_service::resolve_service_identity(&cfg) {
        let name = project_name(&project);
        let service_ok = gds_service::service_health(&ident.host, &ident.http_port)
            .await
            .is_ok();
        let bare_ok =
            service_ok && gds_service::repo_exists(&ident, &name).await.unwrap_or(false);
        let project_owned = project.clone();
        let remote_ok = tokio::task::spawn_blocking(move || {
            crate::git::git_has_remote(&project_owned, "gds")
        })
        .await
        .unwrap_or(false);
        // Fait vérifiable : la branche attendue est-elle publiée sur le dépôt
        // RÉELLEMENT servi ? Un dépôt vide (projet jamais publié) ne doit jamais
        // être annoncé « connecté ». Interrogé seulement quand tout le reste est
        // vert (aucun appel réseau inutile dans les cas d'erreur).
        let project_branch = project.clone();
        let branch_state = if service_ok && bare_ok && remote_ok {
            tokio::task::spawn_blocking(move || remote_branch_state(&project_branch))
                .await
                .unwrap_or(None)
        } else {
            None
        };
        let status = connection_status_from_flags(
            true,
            true,
            service_ok,
            service_ok,
            bare_ok,
            remote_ok,
            branch_state,
        );
        return Ok(json!({ "status": status, "on_server": bare_ok }));
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
    // Dépôt bare valide côté serveur GDS : preuve locale admise UNIQUEMENT quand
    // ce poste est le serveur (local + racine déclarée en chemin du poste) —
    // historique inchangé. Partout ailleurs (racine NON renseignée, racine POSIX
    // absolue, serveur distant) la base PostgreSQL `git_repos` fait foi : on ne
    // conclut JAMAIS d'un dossier de ce poste pour un dépôt qui vit sur le serveur.
    let name = project_name(&project);
    let project_owned = project.clone();
    let bare_ok = {
        let pool = state.gds_pool.lock().ok().and_then(|g| g.clone());
        server_bare_exists(pool.as_ref(), &cfg, &name).await
    };
    // Remote `gds` présent dans le dépôt local.
    let remote_ok = tokio::task::spawn_blocking(move || crate::git::git_has_remote(&project_owned, "gds"))
        .await
        .unwrap_or(false);
    // Même fait vérifiable que la voie service : la branche attendue doit
    // exister sur le dépôt RÉELLEMENT servi (ligne en base ou dossier du poste
    // ne suffisent pas). Interrogé seulement quand tout le reste est vert.
    let project_branch = project.clone();
    let branch_state = if has_pw && pool_ok && bare_ok && remote_ok {
        tokio::task::spawn_blocking(move || remote_branch_state(&project_branch))
            .await
            .unwrap_or(None)
    } else {
        None
    };
    let status = connection_status_from_flags(
        true,
        cfg.enabled,
        has_pw,
        pool_ok,
        bare_ok,
        remote_ok,
        branch_state,
    );
    // Présence du projet sur le serveur GDS (on_server) : R3 — quand déjà
    // ajouté, on ne permet plus de l'ajouter (l'UI masque le bouton). Requiert
    // un pool joignable (sinon fail-open : false). Aucun secret révélé.
    let mut on_server = false;
    if pool_ok {
        let pool = state.gds_pool.lock().ok().and_then(|g| g.clone());
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

    fn trust_report(error: Option<&str>) -> gds_git::ServiceTrustReport {
        gds_git::ServiceTrustReport {
            error: error.map(str::to_string),
            ..Default::default()
        }
    }

    /// Faux négatif d'origine : l'écriture autorisée aboutit APRÈS la première
    /// relecture (le lanceur `RunAs -Wait` ne l'attend pas réellement). Le clic
    /// doit conclure au SUCCÈS dès que l'entrée est finalement relue présente.
    #[test]
    fn late_first_read_is_not_a_failure() {
        let mut reads = 0u32;
        let r = trust_after_escalation(
            || {
                reads += 1;
                trust_report(if reads < 3 {
                    Some("Permission denied")
                } else {
                    None
                })
            },
            || {},
            5,
        );
        assert!(
            r.error.is_none(),
            "entrée présente à la 3e relecture ⇒ succès, jamais un faux échec"
        );
        assert_eq!(reads, 3, "aucune relecture inutile après le succès");
    }

    /// Entrée réellement absente : après la borne, l'échec est honnête (et la
    /// relecture s'arrête, aucune boucle infinie).
    #[test]
    fn really_absent_entry_still_fails() {
        let mut reads = 0u32;
        let r = trust_after_escalation(
            || {
                reads += 1;
                trust_report(Some("Permission denied"))
            },
            || {},
            4,
        );
        assert!(
            r.error.is_some(),
            "aucune entrée après la borne ⇒ échec réel annoncé"
        );
        assert_eq!(reads, 4, "la relecture est bornée (pas de boucle infinie)");
    }

    /// Attente qui ne se règle JAMAIS : c'est exactement l'étape de migration
    /// qui attend un verrou consultatif PostgreSQL déjà occupé. La borne doit
    /// répondre (et non laisser la commande sans réponse → écran vide).
    #[tokio::test]
    async fn bounded_answers_while_a_migration_lock_never_releases() {
        let started = Instant::now();
        let r = bounded(
            Duration::from_millis(200),
            std::future::pending::<Result<PgPool, String>>(),
        )
        .await;
        assert!(r.is_none(), "l'attente non bornée serait restée pendue");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// Une fois prête, l'attente bornée rend bien la valeur (pas de faux délai).
    #[tokio::test]
    async fn bounded_returns_the_value_when_ready() {
        assert_eq!(
            bounded(Duration::from_secs(2), async { 42u8 }).await,
            Some(42)
        );
    }

    /// Base injoignable (port local fermé) : la connexion échoue et la
    /// vérification BORNÉE répond un échec au lieu de pendre.
    #[tokio::test]
    async fn unreachable_base_is_reported_not_dangled() {
        // Port libre côté OS, aucun service en écoute derrière.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").expect("bind port libre");
            l.local_addr().expect("addr").port()
        };
        let url = format!("postgres://u:p@127.0.0.1:{}/pilot_gds", port);
        // sqlx réessaie jusqu'à son `acquire_timeout` (10 s) : c'est justement ce
        // que la borne doit arrêter. Aucun pool utilisable ne doit être rendu et
        // la réponse doit arriver (jamais de commande pendue).
        let started = Instant::now();
        let r = bounded(Duration::from_millis(300), gds_db::connect(&url)).await;
        assert!(
            !matches!(r, Some(Ok(_))),
            "aucun pool ne doit être rendu (port {}), obtenu: {}",
            port,
            match &r {
                None => "délai dépassé (None)".to_string(),
                Some(Ok(_)) => "pool ouvert".to_string(),
                Some(Err(e)) => format!("erreur: {}", e),
            }
        );
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "la vérification doit être bornée, jamais pendue"
        );
    }

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
            ssh_host_from_db_addr("postgres://postgres:secret@192.168.1.10:5432/postgres", 22),
            "192.168.1.10:22"
        );
        assert_eq!(
            ssh_host_from_db_addr("postgres://user:pw@db.local:5432/pilot_gds", 22),
            "db.local:22"
        );
    }

    #[test]
    fn ssh_host_derived_from_http_https_ssh_urls() {
        assert_eq!(ssh_host_from_server_url("http://192.168.1.10:8080", 22), "192.168.1.10:22");
        assert_eq!(ssh_host_from_server_url("https://gds.example.com", 22), "gds.example.com:22");
        assert_eq!(ssh_host_from_server_url("ssh://git@192.168.1.10", 22), "192.168.1.10:22");
        assert_eq!(
            ssh_host_from_server_url("postgres://postgres:secret@192.168.1.10:5432/postgres", 22),
            "192.168.1.10:22"
        );
        // Port SSH personnalisé : le port PostgreSQL (5432) est ignoré.
        assert_eq!(
            ssh_host_from_server_url("postgres://postgres:secret@host:5432/postgres", 2222),
            "host:2222"
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: "old.host:22".to_string(),
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: String::new(),
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        gds_save_config(project.clone(), new_cfg, None, None).unwrap();
        let saved = read_gds_config(&project).unwrap();
        // ssh_host recalculé depuis la nouvelle URL.
        assert_eq!(saved.ssh_host, "new.host:22");
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: "custom:2222".to_string(),
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: String::new(),
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        gds_save_config(project.clone(), new_cfg, None, None).unwrap();
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
            ssh_port: 22,
            gds_server_repos: None,
            ssh_host: ssh_host_from_db_addr(db_addr, 22),
            db_host: String::new(),
            db_port: String::new(),
            db_user: String::new(),
        };
        let repo_url = format!("ssh://git@{}/{}", cfg.ssh_host, "proj.git");
        assert_eq!(repo_url, "ssh://git@192.168.1.10:22/proj.git");
    }

    // ── T10 : non-régression serveur LOCAL vs serveur DISTANT (purs) ──

    #[test]
    fn is_local_host_detects_loopback_and_machine_name() {
        let machine = "buildbox";
        // Loopback / noms réservés → local.
        for h in [
            "127.0.0.1",
            "127.0.0.5",
            "localhost",
            "LocalHost",
            "::1",
            "[::1]",
            "localhost:5432",
            "127.0.0.1:22",
            "",
            "   ",
            "buildbox",
            "BUILDBOX",
            "buildbox.local",
        ] {
            assert!(is_local_host_with(h, machine), "{} doit être local", h);
        }
        // Hôtes distants → non local.
        for h in [
            "192.168.1.10",
            "10.0.0.42",
            "gds.example.com",
            "buildbox2",
            "db.local:5432",
        ] {
            assert!(!is_local_host_with(h, machine), "{} doit être distant", h);
        }
    }

    #[test]
    fn local_server_keeps_historical_remote_url() {
        // Serveur LOCAL dont la racine de repos est un chemin WINDOWS (serveur
        // natif historique) : URL STRICTEMENT inchangée (pas de préfixe de
        // repos) — le home du user `git` EST la racine.
        let cfg = GdsConfig {
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
        assert!(is_local_gds_server(&cfg));
        assert_eq!(
            gds_remote_url(&cfg, "proj"),
            "ssh://git@127.0.0.1:22/proj.git"
        );
        assert!(server_repo_path(&cfg, "proj").is_some());

        // Racine POSIX ABSOLUE sur un serveur vu comme « local » (cas d'un
        // SERVEUR EN CONTENEUR sur la même machine) : elle fait autorité, sinon
        // l'URL ne désigne aucun dépôt sur le serveur (liaison impossible alors
        // que le projet y est inscrit).
        let mut container = cfg.clone();
        container.gds_server_repos = Some("/srv/git/repos".to_string());
        container.ssh_port = 2222;
        container.ssh_host = "127.0.0.1:2222".to_string();
        assert!(is_local_gds_server(&container));
        assert_eq!(
            gds_remote_url(&container, "proj"),
            "ssh://git@127.0.0.1:2222/srv/git/repos/proj.git"
        );
    }

    #[test]
    fn distant_server_url_uses_ssh_port_and_server_repos() {
        let cfg = GdsConfig {
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
        assert!(!is_local_gds_server(&cfg));
        // Chemin ABSOLU côté serveur (sémantique `ssh://` vérifiée).
        assert_eq!(
            server_repo_path(&cfg, "proj").as_deref(),
            Some("/home/git/repos/proj.git")
        );
        assert_eq!(
            gds_remote_url(&cfg, "proj"),
            "ssh://git@gds.example.com:2222/home/git/repos/proj.git"
        );
        // Racine avec slash final / séparateur Windows normalisés.
        assert_eq!(
            join_posix_path("/home/git/repos/", "/proj.git"),
            "/home/git/repos/proj.git"
        );
        assert_eq!(
            join_posix_path("C:\\GDS\\repos", "proj.git"),
            "C:/GDS/repos/proj.git"
        );
    }

    #[test]
    fn distant_server_without_repos_root_falls_back_to_historical_url() {
        // Racine non renseignée → repli sur l'URL historique (aucune régression
        // pour une config distante incomplète), pas de panique.
        let cfg = GdsConfig {
            enabled: true,
            server_url: String::new(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: None,
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: "gds.example.com:22".to_string(),
            db_host: "gds.example.com".to_string(),
            db_port: "5432".to_string(),
            db_user: "postgres".to_string(),
        };
        assert!(server_repo_path(&cfg, "proj").is_none());
        assert_eq!(
            gds_remote_url(&cfg, "proj"),
            "ssh://git@gds.example.com:22/proj.git"
        );
    }

    #[test]
    fn old_gds_json_without_new_fields_is_loaded_with_ssh_port_22() {
        // Rétrocompat : un `.pilot/gds.json` écrit AVANT ce chantier (sans
        // `ssh_port` ni `gds_server_repos`) doit se charger sans erreur, avec un
        // port SSH à 22 (comportement historique) et aucune racine serveur.
        let dir = std::env::temp_dir().join(format!("pilot-gds-retro-{}", std::process::id()));
        let project = dir.to_string_lossy().to_string();
        std::fs::create_dir_all(dir.join(".pilot")).unwrap();
        std::fs::write(
            gds_config_path(&project),
            "{\n  \"enabled\": true,\n  \"db_host\": \"192.168.1.10\",\n  \"db_port\": \"5432\",\n  \"db_user\": \"postgres\",\n  \"identity_email\": \"dev@kalico\",\n  \"server_url\": \"postgres://postgres@192.168.1.10:5432/postgres\",\n  \"ssh_host\": \"192.168.1.10:22\"\n}\n",
        )
        .unwrap();
        let cfg = read_gds_config(&project).unwrap();
        assert_eq!(cfg.ssh_port, 22);
        assert_eq!(cfg.gds_server_repos, None);
        assert_eq!(cfg.ssh_host, "192.168.1.10:22");
        assert_eq!(gds_remote_url(&cfg, "proj"), "ssh://git@192.168.1.10:22/proj.git");
        let _ = std::fs::remove_dir_all(&dir);
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: String::new(),
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
        assert_eq!(connection_status_from_flags(false, false, true, true, true, true, Some(true)), "not_configured");
        assert_eq!(connection_status_from_flags(true, false, true, true, true, true, Some(true)), "not_configured");
        // Tout est bon → connected.
        assert_eq!(connection_status_from_flags(true, true, true, true, true, true, Some(true)), "connected");
        // Dépôt distant VIDE (branche jamais publiée) → not_published :
        // défaut de terrain — « connecté » était annoncé alors que rien n'était
        // poussé et que la synchronisation ne pouvait pas fonctionner.
        assert_eq!(connection_status_from_flags(true, true, true, true, true, true, Some(false)), "not_published");
        // Dépôt non interrogeable → jamais « connecté » sur une supposition.
        assert_eq!(connection_status_from_flags(true, true, true, true, true, true, None), "error");
        // testsnake2 (dépôt non valide → bare_ok=false) → error.
        assert_eq!(connection_status_from_flags(true, true, true, true, false, true, Some(true)), "error");
        // Chaque prérequis manquant → error (même si la branche est publiée).
        assert_eq!(connection_status_from_flags(true, true, false, true, true, true, Some(true)), "error");
        assert_eq!(connection_status_from_flags(true, true, true, false, true, true, Some(true)), "error");
        assert_eq!(connection_status_from_flags(true, true, true, true, true, false, Some(true)), "error");
        // Un prérequis manquant reste « error » et jamais « not_published ».
        assert_eq!(connection_status_from_flags(true, true, true, false, true, true, Some(false)), "error");
    }

    /// R1 + reprise 2 : une information lue sur le POSTE ne fonde JAMAIS
    /// « Connecté », sauf si ce poste EST le serveur (local + racine déclarée en
    /// chemin du poste). Racine NON renseignée, racine POSIX absolue (conteneur)
    /// ou serveur distant : un dossier homonyme sous `gds_local_dir` ne compte
    /// pas — sans preuve côté serveur, la réponse est « à vérifier ».
    #[tokio::test]
    async fn bare_exists_local_disk_only_for_native_local_server() {
        let base = std::env::temp_dir().join(format!("pilot-gds-test-bare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let name = "proj";
        // Le dossier homonyme existe sur CE poste (c'est lui qui trompait).
        std::fs::create_dir_all(base.join("repos").join(format!("{}.git", name))).unwrap();
        let local_cfg = GdsConfig {
            enabled: true,
            server_url: String::new(),
            identity_email: "dev@kalico".to_string(),
            gds_local_dir: Some(base.to_string_lossy().to_string()),
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: "127.0.0.1:22".to_string(),
            db_host: "127.0.0.1".to_string(),
            db_port: "5432".to_string(),
            db_user: "postgres".to_string(),
        };
        // 0) CAS DE TERRAIN (défaut resté ouvert) : serveur local (127.0.0.1),
        //    racine des dépôts NON renseignée, dossier homonyme sur CE poste,
        //    base du serveur injoignable (pool absent) → jamais « Connecté ».
        assert!(is_local_gds_server(&local_cfg));
        assert!(server_repo_path(&local_cfg, name).is_none());
        let bare_ok = server_bare_exists(None, &local_cfg, name).await;
        assert!(!bare_ok, "un dossier homonyme du poste ne vaut pas preuve de liaison");
        assert_eq!(
            connection_status_from_flags(true, true, true, false, bare_ok, true, Some(true)),
            "error"
        );
        // Même base joignable et raccourci `gds` présent : sans preuve CÔTÉ
        // SERVEUR il n'y a jamais « connected » (l'ancienne logique, fondée sur
        // le dossier local, annonçait « connected »).
        assert_eq!(
            connection_status_from_flags(true, true, true, true, bare_ok, true, Some(true)),
            "error"
        );

        // 1) LOCAL NATIF à racine DÉCLARÉE en chemin du poste : disque, inchangé.
        let native_cfg = GdsConfig {
            gds_server_repos: Some("C:\\GDS\\repos".to_string()),
            ..local_cfg.clone()
        };
        assert!(is_local_gds_server(&native_cfg));
        assert!(server_bare_exists(None, &native_cfg, name).await);

        // 2) Même machine, racine POSIX ABSOLUE (conteneur) : le disque du poste
        //    ne compte plus — sans pool, réponse honnête « non vérifié ».
        let mut container = local_cfg.clone();
        container.gds_server_repos = Some("/srv/git/repos".to_string());
        assert!(is_local_gds_server(&container));
        assert!(!server_bare_exists(None, &container, name).await);

        // 3) DISTANT (POSIX comme Windows) : jamais le disque de ce poste.
        let distant = GdsConfig {
            db_host: "10.0.0.42".to_string(),
            ssh_host: "10.0.0.42:22".to_string(),
            ..container.clone()
        };
        assert!(!is_local_gds_server(&distant));
        assert!(!server_bare_exists(None, &distant, name).await);
        let distant_win = GdsConfig {
            gds_server_repos: Some("C:\\GDS\\repos".to_string()),
            ..distant.clone()
        };
        assert!(!server_bare_exists(None, &distant_win, name).await);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn delete_saved_server_removes_entry_and_keeps_others() {
        // L5.2 : la suppression d'un serveur mémorisé retire SON entrée et
        // laisse les autres intactes ; la liste ne le propose plus (cohérence
        // de l'affichage avec ce qui est réellement enregistré).
        let _guard = TestGdsSecretsGuard::new();
        save_server_credentials("10.0.0.1", "5432", "alpha", "pwA", "adm")
            .unwrap();
        save_server_credentials("10.0.0.2", "5432", "beta", "pwB", "adm")
            .unwrap();
        assert!(list_saved_servers().iter().any(|v| v["host"] == "10.0.0.1"));
        // Suppression réelle.
        assert!(delete_saved_server("10.0.0.1", "alpha").unwrap());
        // Le serveur supprimé disparaît ; l'autre reste.
        let list = list_saved_servers();
        assert!(!list.iter().any(|v| v["host"] == "10.0.0.1"));
        assert!(list.iter().any(|v| v["host"] == "10.0.0.2"));
        // Supprimer un serveur inexistant ne fait rien et ne panique pas.
        assert!(!delete_saved_server("10.0.0.1", "alpha").unwrap());
        // Les identifiants supprimés ne sont plus retrouvés.
        assert!(get_saved_server("10.0.0.1", "5432", "alpha")
            .unwrap()
            .is_none());
    }

    #[test]
    fn stored_server_password_reads_memorized_ignoring_port() {
        // L5.2 : le test d'un serveur déjà mémorisé reprend le mot de passe
        // enregistré (le port n'est pas une clé).
        let _guard = TestGdsSecretsGuard::new();
        save_server_credentials("10.0.0.9", "5433", "gamma", "pwG", "adm").unwrap();
        assert_eq!(
            stored_server_password("10.0.0.9", "5432", "gamma").as_deref(),
            Some("pwG")
        );
        // Serveur inconnu → aucun mot de passe (le test exigera une saisie).
        assert!(stored_server_password("10.0.0.9", "5432", "inconnu").is_none());
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
        gds_core::git_cmd::git_init_bare(&bare).unwrap();

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

    /// Cas de terrain (défaut confirmé) : le dépôt du serveur existe mais est
    /// VIDE — la branche n'a jamais été publiée. Les faits du poste (remote
    /// `gds` présent, base joignable) ne doivent JAMAIS produire « connected » :
    /// l'état se lit sur le dépôt RÉELLEMENT servi. Ce test ÉCHOUE si
    /// l'indicateur redevient « connecté » pour un dépôt vide.
    #[test]
    fn empty_remote_repo_is_never_announced_connected() {
        let _iso = crate::git::test_helpers::IsolatedGitConfig::new(
            "[user]\n name = Pilot Test\n email = pilot-test@example.com\n",
        );
        let work = std::env::temp_dir().join(format!("pilot-gds-empty-wrk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let work = work.to_string_lossy().to_string();
        std::fs::write(std::path::Path::new(&work).join("main.rs"), "fn main() {}\n").unwrap();

        let bare = std::env::temp_dir().join(format!("pilot-gds-empty-bare-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&bare);
        let bare = bare.to_string_lossy().to_string();
        gds_core::git_cmd::git_init_bare(&bare).unwrap();

        ensure_git_repo_with_initial_commit(&work).unwrap();
        git_remote_add(&work, "gds", &bare).unwrap();
        let branch = git_current_branch(&work);

        // Dépôt distant vide : le serveur répond, la branche est absente.
        assert_eq!(
            crate::git::git_remote_branch_state(&work, "gds", &branch),
            Some(false),
            "dépôt vide : le remote répond et la branche est absente"
        );
        assert_eq!(remote_branch_state(&work), Some(false));
        assert_eq!(
            connection_status_from_flags(true, true, true, true, true, true, remote_branch_state(&work)),
            "not_published"
        );

        // Après publication, la même lecture donne le verdict honnête.
        git_push(&work, "gds", &branch).unwrap();
        assert_eq!(remote_branch_state(&work), Some(true));
        assert_eq!(
            connection_status_from_flags(true, true, true, true, true, true, remote_branch_state(&work)),
            "connected"
        );

        // Chemin de dépôt obsolète (dépôt réellement absent) : non interrogeable
        // → « à vérifier », jamais « connecté » ni « publié ».
        let missing = std::env::temp_dir().join(format!("pilot-gds-absent-{}", std::process::id()));
        let missing = missing.to_string_lossy().to_string();
        git_remote_add(&work, "gds", &missing).unwrap();
        assert_eq!(remote_branch_state(&work), None);
        assert_eq!(
            connection_status_from_flags(true, true, true, true, true, true, remote_branch_state(&work)),
            "error"
        );

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
        // Secrets mémorisés isolés (jamais ~/.pilot réel).
        let _guard = TestGdsSecretsGuard::new();
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
        // Secrets mémorisés isolés (jamais ~/.pilot réel).
        let _guard = TestGdsSecretsGuard::new();
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
            ssh_port: 0,
            gds_server_repos: None,
            ssh_host: String::new(),
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
    fn admin_server_key_is_stable_and_case_insensitive_on_email() {
        assert_eq!(admin_server_key(" host ", "Root@X.Y"), "host|root@x.y");
        assert_eq!(
            admin_server_key("host", "root@x.y"),
            admin_server_key(" host ", "ROOT@X.Y")
        );
    }

    #[test]
    fn admin_credentials_are_separate_from_project_servers_and_never_returned() {
        // Secrets isolés dans un fichier TEMPORAIRE (jamais ~/.pilot réel).
        let _guard = TestGdsSecretsGuard::new();
        // Entrée admin SÉPARÉE : elle ne doit PAS apparaître dans la liste des
        // serveurs de projet (`servers`), ni y créer la moindre entrée (L4.2).
        save_admin_credentials("192.168.1.77", "8090", "root@gds.example", "s3cret").unwrap();
        assert!(
            list_saved_servers().is_empty(),
            "aucune entrée admin ne doit apparaître comme serveur de projet"
        );
        assert!(
            read_gds_secrets().unwrap().servers.is_empty(),
            "la map `servers` (projets) doit rester intacte"
        );
        // Retrouvée par (hôte, email), avec le mot de passe mémorisé.
        let saved = get_admin_credentials("192.168.1.77", "root@gds.example")
            .unwrap()
            .unwrap();
        assert_eq!(saved.http_port, "8090");
        assert_eq!(saved.admin_password.as_deref(), Some("s3cret"));
        // La liste destinée à l'UI NE révèle JAMAIS le mot de passe.
        let list = list_admin_servers();
        let serialized = serde_json::to_string(&list).unwrap();
        assert!(!serialized.contains("s3cret"));
        assert!(list.iter().any(|v| v["host"] == "192.168.1.77"
            && v["email"] == "root@gds.example"
            && v["has_password"] == true));
    }

    #[test]
    fn admin_credentials_empty_password_does_not_create_nor_erase() {
        let _guard = TestGdsSecretsGuard::new();
        // Mot de passe vide sur une entrée inexistante → aucune création.
        save_admin_credentials("h", "8080", "a@b", "").unwrap();
        assert!(list_admin_servers().is_empty());
        // Mot de passe mémorisé, puis re-sauvegarde SANS mot de passe → conservé.
        save_admin_credentials("h", "8080", "a@b", "pw1").unwrap();
        save_admin_credentials("h", "8081", "a@b", "").unwrap();
        let saved = get_admin_credentials("h", "a@b").unwrap().unwrap();
        assert_eq!(saved.admin_password.as_deref(), Some("pw1"), "secret conservé");
        assert_eq!(saved.http_port, "8081", "le port a bien été mis à jour");
        // Hôte ou email vide → refus explicite (jamais d'entrée anonyme).
        assert!(save_admin_credentials("", "8080", "a@b", "pw").is_err());
        assert!(save_admin_credentials("h", "8080", "", "pw").is_err());
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

    #[test]
    fn server_label_is_memorized_and_listed_without_password() {
        // Lot 1 : nom + description mémorisés sur la fiche serveur et exposés à
        // l'UI SANS jamais laisser fuir un mot de passe.
        let _guard = TestGdsSecretsGuard::new();
        save_server_credentials("10.9.0.1", "5432", "srv", "pw", "adm").unwrap();
        set_server_label("10.9.0.1", "srv", "  GDS maison  ", "Serveur de test").unwrap();
        let entry = list_saved_servers()
            .into_iter()
            .find(|v| v["host"] == "10.9.0.1")
            .expect("serveur listé");
        assert_eq!(entry["name"], "GDS maison", "nom rogné");
        assert_eq!(entry["description"], "Serveur de test");
        let serialized = serde_json::to_string(&entry).unwrap();
        assert!(!serialized.contains("pw") && !serialized.contains("adm"));
        // Nom libellé sur un serveur INCONNU : no-op, aucune fiche créée.
        set_server_label("10.9.0.2", "inconnu", "X", "Y").unwrap();
        assert!(!list_saved_servers().iter().any(|v| v["host"] == "10.9.0.2"));
    }

    #[test]
    fn legacy_server_entry_without_label_reads_with_defaults() {
        // Lot 1 : rétrocompatibilité stricte — une entrée écrite AVANT l'ajout
        // du nom/description (fichier JSON sans ces champs) reste lisible.
        let _guard = TestGdsSecretsGuard::new();
        let legacy = r#"{
            "servers": {
                "srv@10.9.1.1": {
                    "db_port": "5432",
                    "db_password": "pw",
                    "validated": true
                }
            }
        }"#;
        std::fs::write(secrets_path().unwrap(), legacy).unwrap();
        let secrets = read_gds_secrets().unwrap();
        let c = secrets.servers.get("srv@10.9.1.1").unwrap();
        assert_eq!(c.name, "");
        assert_eq!(c.description, "");
        assert!(c.validated);
        let entry = list_saved_servers()
            .into_iter()
            .find(|v| v["host"] == "10.9.1.1")
            .unwrap();
        assert_eq!(entry["name"], "");
        assert_eq!(entry["description"], "");
        assert_eq!(entry["last_test_at"], "");
        assert!(entry["reachable"].is_null());
        // Lot 1 : une fiche héritée est vue comme non-« compte GDS » et garde
        // son compte technique (donc « Appliquer » reste possible).
        assert_eq!(entry["identity"], false);
        assert_eq!(entry["has_db_password"], true);
        assert_eq!(entry["gds_email"], "");
    }

    #[test]
    fn identity_fiche_is_listed_with_email_role_and_never_its_password() {
        // Lot 1 : la fiche porte le COMPTE GDS (e-mail + mot de passe) ; la
        // liste expose l'e-mail, le port HTTP, le rôle et l'absence de compte
        // technique — jamais un mot de passe.
        let _guard = TestGdsSecretsGuard::new();
        let host = "10.9.7.1";
        let email = "dev@exemple.com";
        save_gds_identity(host, email, "8080", email, "secret-gds", "dev").unwrap();
        let list = list_saved_servers();
        let entry = list.iter().find(|v| v["host"] == host).unwrap();
        assert_eq!(entry["user"], email, "la clé de la fiche reste retrouvable");
        assert_eq!(entry["gds_email"], email);
        assert_eq!(entry["http_port"], "8080");
        assert_eq!(entry["gds_role"], "dev");
        assert_eq!(entry["identity"], true);
        assert_eq!(entry["has_db_password"], false);
        let serialized = serde_json::to_string(&list).unwrap();
        assert!(!serialized.contains("secret-gds"));
        // Le mot de passe mémorisé se relit par la clé de la fiche.
        assert_eq!(stored_gds_password(host, email).as_deref(), Some("secret-gds"));
        // Un mot de passe vide en modification CONSERVE le mémorisé.
        save_gds_identity(host, email, "8080", email, "", "admin").unwrap();
        assert_eq!(stored_gds_password(host, email).as_deref(), Some("secret-gds"));
        assert_eq!(
            list_saved_servers()
                .iter()
                .find(|v| v["host"] == host)
                .unwrap()["gds_role"],
            "admin"
        );
    }

    #[test]
    fn completing_a_legacy_fiche_with_an_identity_never_erases_its_secrets() {
        // Lot 1 : la fiche héritée (compte technique) est COMPLÉTÉE, sans
        // changement de clé et sans perte des mots de passe déjà mémorisés.
        let _guard = TestGdsSecretsGuard::new();
        let host = "10.9.8.1";
        save_server_credentials(host, "5432", "pilot", "dbpw", "adminpw").unwrap();
        save_gds_identity(host, "pilot", "8080", "dev@exemple.com", "gds-pw", "admin").unwrap();
        let saved = get_saved_server(host, "5432", "pilot").unwrap().unwrap();
        assert_eq!(saved.db_password.as_deref(), Some("dbpw"));
        assert_eq!(saved.admin_password.as_deref(), Some("adminpw"));
        assert_eq!(saved.gds_password.as_deref(), Some("gds-pw"));
        let entry = list_saved_servers()
            .into_iter()
            .find(|v| v["host"] == host)
            .unwrap();
        assert_eq!(entry["user"], "pilot", "la clé de la fiche ne change pas");
        assert_eq!(entry["identity"], true);
        assert_eq!(entry["has_db_password"], true);
        assert_eq!(entry["gds_email"], "dev@exemple.com");
    }

    #[test]
    fn server_test_state_is_memorized_and_listed() {
        // Lot 5 : le résultat du dernier test (date + joignable/injoignable) est
        // persisté sur la fiche et exposé à l'UI, jamais un mot de passe.
        let _guard = TestGdsSecretsGuard::new();
        save_server_credentials("10.9.4.1", "5432", "srv", "pw", "adm").unwrap();
        record_server_test("10.9.4.1", "srv", false).unwrap();
        let down = list_saved_servers()
            .into_iter()
            .find(|v| v["host"] == "10.9.4.1")
            .unwrap();
        assert_eq!(down["reachable"], false);
        let date = down["last_test_at"].as_str().unwrap().to_string();
        assert!(date.ends_with('Z') && date.contains('T'), "date ISO UTC : {}", date);
        // Un test réussi remplace l'état précédent.
        record_server_test("10.9.4.1", "srv", true).unwrap();
        let up = list_saved_servers()
            .into_iter()
            .find(|v| v["host"] == "10.9.4.1")
            .unwrap();
        assert_eq!(up["reachable"], true);
        assert_eq!(up["last_test_at"], down["last_test_at"]);
        // Serveur inconnu : no-op, aucune fiche créée.
        record_server_test("10.9.4.2", "inconnu", true).unwrap();
        assert!(!list_saved_servers().iter().any(|v| v["host"] == "10.9.4.2"));
    }

    #[test]
    fn apply_server_preserves_existing_ssh_and_repos() {
        // Lot 2 (défaut réel corrigé) : appliquer une fiche mémorisée ne doit
        // PLUS écraser le port SSH ni la racine des dépôts côté serveur du
        // projet ; le nom d'hôte SSH suit le nouveau serveur.
        let _guard = TestGdsSecretsGuard::new();
        let dir = std::env::temp_dir().join(format!("pilot-gds-apply-keep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".pilot")).unwrap();
        let project = dir.to_string_lossy().to_string();
        let mut cfg = GdsConfig {
            enabled: true,
            db_host: "10.9.2.1".to_string(),
            db_port: "5432".to_string(),
            db_user: "old".to_string(),
            identity_email: "a@b".to_string(),
            server_url: String::new(),
            gds_local_dir: Some("/tmp/clones".to_string()),
            ssh_port: 2222,
            gds_server_repos: Some("/home/git/repos".to_string()),
            ssh_host: "10.9.2.1:2222".to_string(),
        };
        cfg.normalize();
        write_gds_config(&project, &cfg).unwrap();
        save_server_credentials("10.9.3.1", "5432", "srv", "pw", "adm").unwrap();
        set_server_label("10.9.3.1", "srv", "Nouveau", "").unwrap();
        gds_apply_server(
            project.clone(),
            "10.9.3.1".to_string(),
            "5432".to_string(),
            "srv".to_string(),
            "me@exemple.com".to_string(),
        )
        .unwrap();
        let after = read_gds_config(&project).unwrap();
        assert_eq!(after.db_host, "10.9.3.1");
        assert_eq!(after.ssh_port, 2222, "port SSH conservé");
        assert_eq!(after.gds_server_repos.as_deref(), Some("/home/git/repos"));
        assert_eq!(after.ssh_host, "10.9.3.1:2222");
        assert_eq!(after.gds_local_dir.as_deref(), Some("/tmp/clones"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
