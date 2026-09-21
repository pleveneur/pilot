// ssh.rs — Helpers SSH du GDS (socle partagé desk/serveur).
//
// Deux provenances (refonte GDS, lot L1) :
//   - L1.4 : `public_key_fingerprint` (la couche base en a besoin pour
//     `get_ssh_key_by_fingerprint`).
//   - L1.6 : les helpers **serveur** — décisions par OS (`SshOs`, `detect_os`,
//     `commands_to_create_git_user`), provision du serveur SSH
//     (`provision_server_ssh`), synchronisation `ssh_keys` →
//     `~git/.ssh/authorized_keys` (`sync_authorized_keys`) et les fonctions
//     pures de formatage / analyse / fusion des lignes `authorized_keys`.
//   - L2.5 : la provision du **compte git + racine des dépôts** pour le
//     conteneur (`provision_git_account`, sans toucher au service SSH) et la
//     régénération **autoritative** du fichier des clefs autorisées depuis la
//     base (`render_authorized_keys`, `write_authorized_keys`,
//     `regenerate_authorized_keys`, `stored_key_lines`). Depuis L2.5,
//     `sync_authorized_keys` est autoritatif : une clef retirée en base est
//     retirée du fichier (voir `merge_authorized_keys` pour l'ancienne
//     sémantique de fusion, conservée).
//
// Le côté **poste dev** (génération de clef, `ensure_poste_key`,
// `poste_key_response`, `ensure_poste_key_remote`) reste dans
// `src-tauri/src/gds_ssh.rs` : c'est lui qui écrit dans le `~/.ssh` du poste,
// le serveur ne connaît que ses propres fichiers.
//
// Les commandes shell gardent leurs DEUX branches (`cmd /C` sous Windows,
// `sh -c` ailleurs) : dans le conteneur Linux seule la branche POSIX est
// compilée et exécutée (`cfg(target_os)`), mais le desk Windows/macOS continue
// d'utiliser ces helpers — aucune branche n'est supprimée ici.

use crate::proc::run_captured;
use serde_json::{json, Value};
use sqlx::PgPool;
use sqlx::Row;
use std::time::Duration;

/// OS détecté pour les décisions de provision SSH (pure — testable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshOs {
    Linux,
    MacOs,
    Windows,
    Unknown,
}

/// Détecte l'OS courant (pure — testable).
pub fn detect_os() -> SshOs {
    #[cfg(target_os = "linux")]
    {
        SshOs::Linux
    }
    #[cfg(target_os = "macos")]
    {
        SshOs::MacOs
    }
    #[cfg(target_os = "windows")]
    {
        SshOs::Windows
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        SshOs::Unknown
    }
}

/// Empreinte SHA256 d'une clef publique (convention `ssh-keygen -lf` :
/// SHA256 du blob base64 décodé, encodé en base64). Pure — testable.
pub fn public_key_fingerprint(public_key: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let parts: Vec<&str> = public_key.split_whitespace().collect();
    if parts.len() < 2 {
        return String::new();
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(parts[1])
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&decoded);
    let digest = hasher.finalize();
    let fp = base64::engine::general_purpose::STANDARD.encode(digest);
    format!("SHA256:{}", fp)
}

/// Formate une ligne authorized_keys : `type base64 email`. Pure — testable.
pub fn format_authorized_key(key_type: &str, key: &str, email: &str) -> String {
    format!("{} {} {}", key_type, key, email)
}

/// Parse une ligne authorized_keys en `(type, base64, comment)`. Retourne
/// `None` pour les lignes vides ou commentaires. Pure — testable.
pub fn parse_authorized_key(line: &str) -> Option<(String, String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut parts = line.split_whitespace();
    let key_type = parts.next()?;
    let key = parts.next()?;
    let comment = parts.next().unwrap_or("");
    Some((key_type.to_string(), key.to_string(), comment.to_string()))
}

/// Fusionne des lignes authorized_keys en dédupliquant par clef (base64).
/// Préserve les lignes existantes (commentaires inclus) et n'ajoute que les
/// nouvelles clefs absentes. Idempotent. Pure — testable.
///
/// ⚠️ Depuis L2.5, le chemin de synchronisation (`sync_authorized_keys`) est
/// **autoritatif** (`render_authorized_keys`) : cette fusion « ajout seul »
/// n'est donc plus appelée par le socle (elle laisserait survivre une clef
/// révoquée). Conservée telle quelle — aucune régression pour le poste dev.
pub fn merge_authorized_keys(existing: &str, new_lines: &[String]) -> String {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = String::new();
    for line in existing.lines() {
        let t = line.trim();
        if !t.is_empty() && !t.starts_with('#') {
            if let Some((_, key, _)) = parse_authorized_key(t) {
                seen.insert(key);
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    for line in new_lines {
        if let Some((_, key, _)) = parse_authorized_key(line) {
            if !seen.contains(&key) {
                out.push_str(line);
                out.push('\n');
                seen.insert(key);
            }
        }
    }
    out
}

// ── Provision serveur (GDS V1 = serveur local) ──

/// Exécute une commande shell (cmd /C sur Windows, sh -c ailleurs).
fn run_shell(cmd: &str) -> String {
    #[cfg(windows)]
    {
        run_captured("cmd", &["/C", cmd], Duration::from_secs(30))
    }
    #[cfg(not(windows))]
    {
        run_captured("sh", &["-c", cmd], Duration::from_secs(30))
    }
}

/// Détecte si le processus a les droits admin/root (pure — testable).
pub fn is_admin() -> bool {
    match detect_os() {
        SshOs::Windows => {
            let out = run_captured("net", &["session"], Duration::from_secs(5));
            !out.trim().is_empty()
        }
        _ => {
            let out = run_captured("id", &["-u"], Duration::from_secs(5));
            out.trim() == "0"
        }
    }
}

/// Vérifie si l'utilisateur système `git` existe.
pub fn git_user_exists() -> bool {
    match detect_os() {
        SshOs::Windows => {
            let out = run_captured("net", &["user", "git"], Duration::from_secs(5));
            !out.trim().is_empty()
        }
        _ => {
            let out = run_captured("id", &["git"], Duration::from_secs(5));
            !out.trim().is_empty()
        }
    }
}

/// Commandes à exécuter pour créer l'utilisateur système `git` (décision pure
/// par OS — testable). Le compte est créé SANS mot de passe utilisable
/// (auth SSH par clef uniquement) : `useradd` verrouille le compte par défaut.
pub fn commands_to_create_git_user(os: &SshOs) -> Vec<String> {
    match os {
        SshOs::Linux => vec!["useradd -m -s /bin/bash git".to_string()],
        SshOs::MacOs => vec!["sysadminctl -addUser git -password pilot-gds".to_string()],
        SshOs::Windows => vec!["net user git pilot-gds /add".to_string()],
        SshOs::Unknown => vec![],
    }
}

/// Dossier personnel de l'utilisateur `git`.
/// - Linux/macOS : via `getent passwd git` (champ 6 = home).
/// - Windows : via `windows_git_user_home()` (registre ProfileImagePath, le
///   home réel consulté par sshd — pas `C:\Users\git`).
pub fn git_user_home() -> String {
    match detect_os() {
        SshOs::Windows => windows_git_user_home(),
        _ => {
            let out = run_captured("getent", &["passwd", "git"], Duration::from_secs(5));
            if let Some(home) = out.split(':').nth(5) {
                let home = home.trim();
                if !home.is_empty() {
                    return home.to_string();
                }
            }
            "/home/git".to_string()
        }
    }
}

/// Résout le home réel du user `git` sur Windows. Le home consulté par sshd
/// est le champ « Répertoire de base » / « Home directory » du compte
/// (`net user git`), PAS le `ProfileImagePath` du registre : ce dernier pointe
/// vers le profil de session interactive (ex: `C:\Users\TEMP`), souvent un
/// dossier système restreint non accessible au poste dev — ce qui faisait
/// échouer `create_dir_all` avec « Accès refusé (os error 5) ». Priorité :
/// 1. `net user git` (champ "Répertoire de base" / "Home directory", localisé).
/// 2. Registre ProfileImagePath (repli, locale-indépendant) via PowerShell.
/// 3. Repli `C:\Users\git`.
#[cfg(windows)]
fn windows_git_user_home() -> String {
    let out = run_captured("net", &["user", "git"], Duration::from_secs(5));
    for line in out.lines() {
        if let Some(p) = extract_windows_path(line) {
            return p;
        }
    }
    let script = "$sid=(Get-WmiObject Win32_UserAccount -Filter \"Name='git'\").SID; if($sid){(Get-ItemProperty \"HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\$sid\").ProfileImagePath}";
    let out = run_captured(
        "powershell",
        &["-NoProfile", "-Command", script],
        Duration::from_secs(10),
    );
    let home = out.trim();
    if !home.is_empty() {
        return home.to_string();
    }
    "C:\\Users\\git".to_string()
}

#[cfg(not(windows))]
fn windows_git_user_home() -> String {
    String::new()
}

/// Extrait un chemin absolu Windows (`X:\...`) d'une ligne. Pure — testable.
pub fn extract_windows_path(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':' && bytes[i + 2] == b'\\' {
            return Some(line[i..].trim().to_string());
        }
    }
    None
}

// ── Compte système `git` et fichier des clefs autorisées (L2.5) ──

/// Nom du compte système propriétaire des dépôts et du fichier de clefs, côté
/// serveur comme côté poste (« serveur local »). C'est le compte attendu par les
/// remotes `ssh://git@<hôte>/<projet>.git`.
pub const GIT_USER: &str = "git";
/// Sous-dossier du home `git` contenant les clefs autorisées.
pub const SSH_DIR_NAME: &str = ".ssh";
/// Nom du fichier lu par sshd pour authentifier les clefs publiques.
pub const AUTHORIZED_KEYS_FILE: &str = "authorized_keys";

/// Dossier des clefs autorisées sous un home donné (`<home>/.ssh`). Pure.
pub fn authorized_keys_dir_in(home: &str) -> String {
    format!("{}/{}", home.trim_end_matches('/'), SSH_DIR_NAME)
}

/// Chemin du fichier des clefs autorisées sous un home donné. Pure.
pub fn authorized_keys_path_in(home: &str) -> String {
    format!("{}/{}", authorized_keys_dir_in(home), AUTHORIZED_KEYS_FILE)
}

/// Chemin du fichier `authorized_keys` de l'utilisateur `git` de CETTE machine.
pub fn authorized_keys_path() -> String {
    authorized_keys_path_in(&git_user_home())
}

/// Droits POSIX (bits `rwx`) d'un chemin, `None` sur Windows ou si le chemin
/// n'existe pas. Sert de **constat** vérifiable (jamais de décision).
fn mode_of(path: &str) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .ok()
            .map(|m| m.permissions().mode() & 0o777)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// Applique au dossier de clefs et au fichier les droits **restreints** exigés
/// par sshd (`StrictModes`) : `~git/.ssh` en 700, `authorized_keys` en 600, et
/// propriétaire `git`. Best-effort (aucune erreur remontée) : hors root le
/// `chown` échoue sans conséquence sur le poste dev ; les droits réellement
/// observés sont remontés par `provision_git_account` (`mode_of`).
fn restrict_key_file_permissions(ssh_dir: &str, auth_path: &str) {
    if detect_os() == SshOs::Windows {
        return;
    }
    run_captured("chmod", &["700", ssh_dir], Duration::from_secs(5));
    run_captured("chmod", &["600", auth_path], Duration::from_secs(5));
    let owner = format!("{}:{}", GIT_USER, GIT_USER);
    run_captured("chown", &["-R", &owner, ssh_dir], Duration::from_secs(10));
}

/// S'assure que sshd autorise l'accès git (OpenSSH Server actif). Best-effort :
/// ne fait pas échouer la provision si le service ne peut pas être démarré
/// (peut nécessiter admin) — la synchro échouera alors avec un message clair.
fn ensure_sshd_git_access(os: &SshOs) -> Result<(), String> {
    match os {
        SshOs::Linux => {
            let out = run_captured("systemctl", &["is-active", "ssh"], Duration::from_secs(5));
            if out.trim() != "active" {
                run_captured("systemctl", &["start", "ssh"], Duration::from_secs(10));
            }
            Ok(())
        }
        SshOs::MacOs => {
            let out = run_captured("systemsetup", &["-getremotelogin"], Duration::from_secs(5));
            if !out.to_lowercase().contains("on") {
                run_captured("systemsetup", &["-setremotelogin", "on"], Duration::from_secs(10));
            }
            Ok(())
        }
        SshOs::Windows => {
            let out = run_captured("sc", &["query", "sshd"], Duration::from_secs(5));
            if !out.contains("RUNNING") {
                run_captured("sc", &["start", "sshd"], Duration::from_secs(10));
            }
            Ok(())
        }
        SshOs::Unknown => Ok(()),
    }
}

/// Rapport de provision du compte `git` (L2.5). Double rôle : résultat
/// exploitable par le serveur (journal) et **constat vérifiable** (droits
/// réellement observés après application).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitAccountReport {
    /// `true` si le compte système a été créé par cet appel.
    pub user_created: bool,
    /// Nom du compte (toujours `git`).
    pub user: String,
    /// Home du compte tel que résolu sur la machine.
    pub home: String,
    /// Dossier `~git/.ssh`.
    pub ssh_dir: String,
    /// Fichier `~git/.ssh/authorized_keys`.
    pub authorized_keys: String,
    /// `true` si la racine des dépôts a été créée par cet appel.
    pub repos_root_created: bool,
    /// Racine des dépôts préparée (vide si aucune n'est demandée).
    pub repos_root: String,
    /// Droits POSIX observés sur le dossier de clefs (jamais sur Windows).
    pub ssh_dir_mode: Option<u32>,
    /// Droits POSIX observés sur le fichier de clefs.
    pub authorized_keys_mode: Option<u32>,
    /// Droits POSIX observés sur la racine des dépôts.
    pub repos_root_mode: Option<u32>,
}

impl GitAccountReport {
    /// Constats lisibles (une ligne par constat) pour le journal du serveur.
    /// Aucune donnée sensible : seuls des chemins et des droits sont cités.
    pub fn summary_lines(&self) -> Vec<String> {
        let mode = |m: Option<u32>| match m {
            Some(v) => format!("{:03o}", v),
            None => "-".to_string(),
        };
        let mut lines = vec![
            format!(
                "compte système `{}` : {} (home {})",
                self.user,
                if self.user_created {
                    "créé"
                } else {
                    "déjà présent"
                },
                self.home
            ),
            format!(
                "dossier de clefs {} : droits {}",
                self.ssh_dir,
                mode(self.ssh_dir_mode)
            ),
            format!(
                "fichier de clefs autorisées {} : droits {}",
                self.authorized_keys,
                mode(self.authorized_keys_mode)
            ),
        ];
        if !self.repos_root.is_empty() {
            lines.push(format!(
                "racine des dépôts {} : {} (droits {})",
                self.repos_root,
                if self.repos_root_created {
                    "créée"
                } else {
                    "déjà présente"
                },
                mode(self.repos_root_mode)
            ));
        }
        lines
    }
}

/// Provisionne le serveur SSH **local du poste dev** (Phase A3) : crée
/// l'utilisateur `git` s'il n'existe pas, crée `~git/.ssh/authorized_keys`
/// (700/600) et s'assure que sshd autorise l'accès git. Retourne une erreur
/// claire si les droits admin manquent pour créer l'utilisateur.
///
/// Comportement inchangé (L1.6) : aucune racine de dépôts n'est préparée ici
/// (le poste la gère dans `gds.rs`) et le service SSH est bien vérifié
/// (`ensure_sshd_git_access`) — c'est le seul écart avec
/// `provision_git_account`, qui s'adresse au **conteneur** (L2.5).
pub fn provision_server_ssh() -> Result<Value, String> {
    let report = provision_git_account_core(None, true)?;
    Ok(json!({
        "ok": true,
        "user": report.user,
        "home": report.home,
        "authorized_keys": report.authorized_keys
    }))
}

/// Provisionne le compte système `git` et son système de fichiers côté
/// **serveur** (micro-tâche L2.5, conteneur) :
///
/// 1. utilisateur `git` sans mot de passe utilisable (accès par clef uniquement) ;
/// 2. dossier de clefs `~git/.ssh` en **700** et fichier
///    `~git/.ssh/authorized_keys` en **600**, propriétaire `git` (droits exigés
///    par sshd `StrictModes`) ;
/// 3. **racine des dépôts** (`repos_root`, volume) créée puis confiée à `git`,
///    pour que les dépôts bare puissent y être créés (L2.6).
///
/// Ne touche **jamais** au service SSH (dans le conteneur, sshd relève de L2.6)
/// et ne remplit pas le fichier de clefs : c'est `regenerate_authorized_keys`
/// (source de vérité = base) qui s'en charge.
///
/// Idempotent : compte existant conservé, fichier existant jamais vidé, racine
/// existante jamais recréée ni vidée.
pub fn provision_git_account(repos_root: &str) -> Result<GitAccountReport, String> {
    provision_git_account_core(Some(repos_root), false)
}

/// Cœur commun de la provision du compte `git` (poste dev et conteneur).
///
/// `repos_root = None` : le poste dev ne prépare pas de racine de dépôts.
/// `ensure_sshd = true` : vérifie/active le service SSH (poste dev uniquement).
fn provision_git_account_core(
    repos_root: Option<&str>,
    ensure_sshd: bool,
) -> Result<GitAccountReport, String> {
    let os = detect_os();
    // 1. Compte système `git` s'il n'existe pas. Le succès est jugé par
    //    `git_user_exists()` et JAMAIS par la sortie de la commande : `useradd`
    //    n'écrit rien en cas de succès (contrairement à `net user`).
    let mut user_created = false;
    if !git_user_exists() {
        if !is_admin() {
            return Err(
                "Droits administrateur requis pour créer l'utilisateur système `git` \
                 (relancez Pilot en administrateur)"
                    .to_string(),
            );
        }
        let cmds = commands_to_create_git_user(&os);
        if cmds.is_empty() {
            return Err("OS non supporté pour la création de l'utilisateur `git`".to_string());
        }
        for cmd in &cmds {
            run_shell(cmd);
        }
        if !git_user_exists() {
            return Err(format!(
                "Échec de la création de l'utilisateur système `git` (commandes essayées : {})",
                cmds.join(" ; ")
            ));
        }
        user_created = true;
    }
    // 2. Dossier de clefs + fichier `authorized_keys` (700/600). Le fichier est
    //    créé VIDE s'il est absent ; s'il existe, il n'est jamais vidé ici.
    let home = git_user_home();
    let ssh_dir = authorized_keys_dir_in(&home);
    std::fs::create_dir_all(&ssh_dir).map_err(|e| {
        format!("Création {} : {} — vérifiez que le home du user `git` est accessible (champ « Répertoire de base » de `net user git`)", ssh_dir, e)
    })?;
    let auth = authorized_keys_path_in(&home);
    if !std::path::Path::new(&auth).exists() {
        std::fs::write(&auth, "").map_err(|e| format!("Création authorized_keys: {}", e))?;
    }
    restrict_key_file_permissions(&ssh_dir, &auth);
    // 3. Racine des dépôts (volume) : créée puis confiée à `git`. Le `chown`
    //    n'est PAS récursif : on ne touche jamais au contenu d'un volume déjà
    //    rempli (aucun parcours coûteux, aucun risque sur les dépôts existants).
    let mut repos_root_created = false;
    let mut repos_root_path = String::new();
    let mut repos_root_mode = None;
    if let Some(root) = repos_root {
        let existed = std::path::Path::new(root).exists();
        std::fs::create_dir_all(root)
            .map_err(|e| format!("Création de la racine des dépôts {} : {}", root, e))?;
        repos_root_created = !existed;
        if os != SshOs::Windows {
            let owner = format!("{}:{}", GIT_USER, GIT_USER);
            run_captured("chown", &[&owner, root], Duration::from_secs(10));
            run_captured("chmod", &["755", root], Duration::from_secs(5));
        }
        repos_root_path = root.to_string();
        repos_root_mode = mode_of(root);
    }
    // 4. Service SSH : uniquement pour le poste dev (conteneur : L2.6).
    if ensure_sshd {
        ensure_sshd_git_access(&os)?;
    }
    Ok(GitAccountReport {
        user_created,
        user: GIT_USER.to_string(),
        home,
        ssh_dir_mode: mode_of(&ssh_dir),
        ssh_dir,
        authorized_keys_mode: mode_of(&auth),
        authorized_keys: auth,
        repos_root_created,
        repos_root: repos_root_path,
        repos_root_mode,
    })
}

// ── Régénération autoritative de authorized_keys (DB → fichier, L2.5) ──

/// Résultat d'une régénération de `authorized_keys`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorizedKeysSync {
    /// Nombre de clefs **effectivement** présentes dans le fichier (après
    /// déduplication par clef).
    pub keys: usize,
    /// `true` si le fichier a été (ré)écrit ; `false` si son contenu était déjà
    /// exactement le contenu attendu (idempotence stricte : aucune écriture,
    /// aucune modification de date).
    pub rewritten: bool,
}

/// Lignes `authorized_keys` (`type base64 email`) des clefs **enregistrées en
/// base** : la table `ssh_keys` (rattachée aux utilisateurs par email) est la
/// seule source de vérité. Les clefs de format inattendu sont ignorées.
pub async fn stored_key_lines(pool: &PgPool) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT k.public_key, u.email FROM ssh_keys k JOIN users u ON u.id = k.user_id ORDER BY k.id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Lecture clefs SSH: {}", e))?;
    let mut lines: Vec<String> = Vec::new();
    for r in rows {
        let key: String = r.get("public_key");
        let email: String = r.get("email");
        if let Some((kt, k, _)) = parse_authorized_key(&key) {
            lines.push(format_authorized_key(&kt, &k, &email));
        }
    }
    Ok(lines)
}

/// Contenu **autoritatif** du fichier `authorized_keys` : exactement les lignes
/// fournies — une clef absente de la liste (donc supprimée en base) est absente
/// du fichier (aucune survivance d'une autorisation révoquée). Déduplication par
/// clef (base64), ordre d'entrée conservé, lignes vides/commentaires ignorées.
/// Un ensemble vide produit un contenu **vide** (et non un fichier absent).
/// Pure — testable.
pub fn render_authorized_keys(lines: &[String]) -> String {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = String::new();
    for line in lines {
        if let Some((kt, k, comment)) = parse_authorized_key(line) {
            if !seen.insert(k.clone()) {
                continue;
            }
            if comment.is_empty() {
                out.push_str(&format!("{} {}", kt, k));
            } else {
                out.push_str(&format_authorized_key(&kt, &k, &comment));
            }
            out.push('\n');
        }
    }
    out
}

/// Écrit le fichier `authorized_keys` (dossier parent créé si besoin).
/// **Idempotent strict** : si le fichier contient déjà exactement le contenu
/// attendu, rien n'est écrit et `Ok(false)` est retourné — plusieurs démarrages
/// successifs ne peuvent donc ni dupliquer, ni corrompre, ni « dater » les
/// autorisations.
pub fn write_authorized_keys(auth_path: &str, rendered: &str) -> Result<bool, String> {
    let current = std::fs::read_to_string(auth_path).unwrap_or_default();
    if current == rendered {
        return Ok(false);
    }
    if let Some(dir) = std::path::Path::new(auth_path).parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Création du dossier de clefs {} : {}", dir.display(), e))?;
    }
    std::fs::write(auth_path, rendered).map_err(|e| format!("Écriture de {} : {}", auth_path, e))?;
    Ok(true)
}

/// Régénère `~git/.ssh/authorized_keys` **à partir de la base** (L2.5) : le
/// fichier contient alors exactement les clefs enregistrées — une clef
/// supprimée en base disparaît du fichier (et une clef ajoutée y apparaît).
///
/// Les droits restreints (700 pour le dossier, 600 pour le fichier,
/// propriétaire `git`) sont (ré)appliqués à chaque appel : c'est la garantie que
/// sshd (`StrictModes`) accepte le fichier, y compris après une réécriture.
pub async fn regenerate_authorized_keys(pool: &PgPool) -> Result<AuthorizedKeysSync, String> {
    let lines = stored_key_lines(pool).await?;
    let rendered = render_authorized_keys(&lines);
    let home = git_user_home();
    let ssh_dir = authorized_keys_dir_in(&home);
    let auth = authorized_keys_path_in(&home);
    let rewritten = write_authorized_keys(&auth, &rendered)?;
    restrict_key_file_permissions(&ssh_dir, &auth);
    Ok(AuthorizedKeysSync {
        keys: rendered.lines().count(),
        rewritten,
    })
}

/// Synchronise la table `ssh_keys` (associée aux emails) vers
/// `~git/.ssh/authorized_keys` : pour chaque clef, écrit la ligne
/// `type base64 <email>`.
///
/// **Comportement L2.5 (autoritatif)** : le fichier est RÉGÉNÉRÉ depuis la base
/// (il ne s'agit plus d'une fusion), donc une clef révoquée est retirée. La
/// signature est conservée à l'identique pour le poste dev (`src-tauri`), qui
/// n'a pas à changer.
pub async fn sync_authorized_keys(pool: &PgPool) -> Result<(), String> {
    regenerate_authorized_keys(pool).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_fingerprint_is_deterministic() {
        let k = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==";
        let fp1 = public_key_fingerprint(k);
        let fp2 = public_key_fingerprint(k);
        assert!(!fp1.is_empty());
        assert_eq!(fp1, fp2);
        assert!(fp1.starts_with("SHA256:"));
        // Clef invalide → empreinte vide.
        assert_eq!(public_key_fingerprint("bogus"), "");
    }

    #[test]
    fn detect_os_returns_something() {
        // Ne doit jamais être Unknown sur les 3 plateformes cibles.
        let os = detect_os();
        assert!(matches!(os, SshOs::Linux | SshOs::MacOs | SshOs::Windows));
    }

    #[test]
    fn format_parse_authorized_key_roundtrip() {
        let line = format_authorized_key("ssh-ed25519", "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==", "dev@kalico");
        assert_eq!(line, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey== dev@kalico");
        let parsed = parse_authorized_key(&line).unwrap();
        assert_eq!(parsed.0, "ssh-ed25519");
        assert_eq!(parsed.1, "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==");
        assert_eq!(parsed.2, "dev@kalico");
        // Lignes vides / commentaires → None.
        assert!(parse_authorized_key("").is_none());
        assert!(parse_authorized_key("# comment").is_none());
    }

    #[test]
    fn merge_authorized_keys_dedups_and_is_idempotent() {
        let existing = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey== alice@x\n# gardé\n";
        let new1 = vec![
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey== bob@x".to_string(),
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewKey== carol@x".to_string(),
        ];
        let merged = merge_authorized_keys(existing, &new1);
        // La clef existante n'est pas dupliquée ; la nouvelle est ajoutée.
        assert_eq!(merged.matches("AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==").count(), 1);
        assert_eq!(merged.matches("AAAAC3NzaC1lZDI1NTE5AAAAINewKey==").count(), 1);
        assert!(merged.contains("# gardé"));
        // Idempotence : re-fusionner ne change rien.
        let merged2 = merge_authorized_keys(&merged, &new1);
        assert_eq!(merged, merged2);
    }

    #[test]
    fn commands_to_create_git_user_by_os() {
        assert!(!commands_to_create_git_user(&SshOs::Linux).is_empty());
        assert!(!commands_to_create_git_user(&SshOs::MacOs).is_empty());
        assert!(!commands_to_create_git_user(&SshOs::Windows).is_empty());
        assert!(commands_to_create_git_user(&SshOs::Unknown).is_empty());
    }

    #[test]
    fn extract_windows_path_finds_drive_path() {
        // Ligne `net user git` (champ "Répertoire de base" / "Home directory").
        assert_eq!(
            extract_windows_path("R\u{e9}pertoire de base                             C:\\GDS\\repos"),
            Some("C:\\GDS\\repos".to_string())
        );
        // Ligne sans chemin → None.
        assert_eq!(extract_windows_path("Stations autoris\u{e9}es                            Tout"), None);
        assert_eq!(extract_windows_path(""), None);
        // Chemin en début de ligne.
        assert_eq!(
            extract_windows_path("C:\\Users\\git"),
            Some("C:\\Users\\git".to_string())
        );
    }

    // ── L2.5 — clefs autorisées : chemins purs, rendu autoritatif, écriture idempotente ──

    #[test]
    fn authorized_keys_paths_are_pure() {
        assert_eq!(authorized_keys_dir_in("/home/git"), "/home/git/.ssh");
        assert_eq!(
            authorized_keys_path_in("/home/git"),
            "/home/git/.ssh/authorized_keys"
        );
        // Un home terminé par `/` ne produit pas de double séparateur.
        assert_eq!(authorized_keys_dir_in("/var/lib/git/"), "/var/lib/git/.ssh");
        assert_eq!(
            authorized_keys_path_in("/var/lib/git/"),
            "/var/lib/git/.ssh/authorized_keys"
        );
        // Windows : le chemin reste exploitable (séparateur toléré par l'OS).
        assert_eq!(
            authorized_keys_path_in("C:\\Users\\git"),
            "C:\\Users\\git/.ssh/authorized_keys"
        );
    }

    #[test]
    fn render_authorized_keys_is_authoritative_and_deduplicates() {
        let k1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyOne== alice@x";
        let k2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyTwo== bob@x";
        let lines = vec![k1.to_string(), k1.to_string(), k2.to_string()];
        let rendered = render_authorized_keys(&lines);
        // Déduplication par clef, ordre d'entrée conservé, une ligne par clef.
        assert_eq!(rendered, format!("{}\n{}\n", k1, k2));
        assert_eq!(rendered.lines().count(), 2);

        // AUTORITATIF : une clef absente de la liste disparaît du fichier
        // (c'est la révocation d'une clef enregistrée en base).
        let after_removal = render_authorized_keys(&[k2.to_string()]);
        assert!(!after_removal.contains("KeyOne"));
        assert_eq!(after_removal, format!("{}\n", k2));

        // Aucune clef enregistrée → fichier VIDE (et non contenu résiduel).
        assert_eq!(render_authorized_keys(&[]), "");
        // Lignes vides / commentaires ignorées (jamais copiées dans le fichier).
        assert_eq!(
            render_authorized_keys(&["".to_string(), "# commentaire".to_string()]),
            ""
        );
        // Deux fois le même rendu → contenu identique (idempotence du contenu).
        assert_eq!(render_authorized_keys(&lines), rendered);
    }

    #[test]
    fn write_authorized_keys_is_idempotent_and_reports_rewrite() {
        let dir = std::env::temp_dir().join(format!(
            "pilot-l25-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let auth = dir.join("authorized_keys");
        let auth_str = auth.to_string_lossy().to_string();
        let k1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyOne== alice@x";
        let k2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyTwo== bob@x";

        // Création (dossier parent absent → créé par l'écriture).
        let first = write_authorized_keys(&auth_str, &format!("{}\n{}\n", k1, k2)).unwrap();
        assert!(first, "le premier appel doit écrire le fichier");
        // 2e appel avec le MÊME contenu → aucune écriture (idempotence).
        let second = write_authorized_keys(&auth_str, &format!("{}\n{}\n", k1, k2)).unwrap();
        assert!(!second, "un contenu identique ne doit pas être réécrit");
        // Toujours les deux clefs (aucune duplication).
        let content = std::fs::read_to_string(&auth).unwrap();
        assert_eq!(content.matches("KeyOne").count(), 1);
        assert_eq!(content.matches("KeyTwo").count(), 1);
        // Révocation : une clef retirée → réécriture effective.
        let third = write_authorized_keys(&auth_str, &format!("{}\n", k2)).unwrap();
        assert!(third, "une clef retirée doit provoquer une réécriture");
        let content = std::fs::read_to_string(&auth).unwrap();
        assert!(!content.contains("KeyOne"));
        assert!(content.contains("KeyTwo"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_account_report_summary_lists_observed_modes() {
        let report = GitAccountReport {
            user_created: true,
            user: GIT_USER.to_string(),
            home: "/home/git".to_string(),
            ssh_dir: "/home/git/.ssh".to_string(),
            authorized_keys: "/home/git/.ssh/authorized_keys".to_string(),
            repos_root_created: false,
            repos_root: "/srv/git/repos".to_string(),
            ssh_dir_mode: Some(0o700),
            authorized_keys_mode: Some(0o600),
            repos_root_mode: Some(0o755),
        };
        let summary = report.summary_lines().join("\n");
        assert!(summary.contains("git` : créé"), "{}", summary);
        assert!(summary.contains("/home/git/.ssh : droits 700"), "{}", summary);
        assert!(
            summary.contains("/home/git/.ssh/authorized_keys : droits 600"),
            "{}",
            summary
        );
        assert!(
            summary.contains("/srv/git/repos : déjà présente (droits 755)"),
            "{}",
            summary
        );
        // Sans racine de dépôts (poste dev), la ligne correspondante n'existe pas
        // et les droits inconnus s'affichent « - » (Windows).
        let minimal = GitAccountReport {
            user_created: false,
            user: GIT_USER.to_string(),
            home: "C:\\Users\\git".to_string(),
            ssh_dir: "C:\\Users\\git/.ssh".to_string(),
            authorized_keys: "C:\\Users\\git/.ssh/authorized_keys".to_string(),
            repos_root_created: false,
            repos_root: String::new(),
            ssh_dir_mode: None,
            authorized_keys_mode: None,
            repos_root_mode: None,
        };
        let lines = minimal.summary_lines();
        assert_eq!(lines.len(), 3, "aucune ligne sans racine : {:?}", lines);
        assert!(lines[1].ends_with("droits -"), "{:?}", lines);
        assert!(lines[0].contains("déjà présent"), "{:?}", lines);
    }

    // ── L2.5 — régénération depuis la base (test d'intégration facultatif) ──
    //
    // Ne s'exécute QUE si `PILOT_GDS_TEST_URL` vise une base `pilot_gds_test_*`
    // (même garde-fou que `db.rs`) : sans variable d'environnement, la CI reste
    // verte. Le fichier est écrit dans un dossier temporaire — jamais dans le
    // `~/.ssh` de la machine de test (la cible réelle du conteneur est vérifiée
    // par l'essai réel de L2.5).
    #[tokio::test]
    async fn authorized_keys_regeneration_follows_database() {
        use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
        use std::str::FromStr;

        let url = match std::env::var("PILOT_GDS_TEST_URL") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => {
                eprintln!(
                    "authorized_keys_regeneration_follows_database: PILOT_GDS_TEST_URL \
                     absente — test ignoré"
                );
                return;
            }
        };
        let base_opts = match PgConnectOptions::from_str(&url) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("PILOT_GDS_TEST_URL invalide ({}) — test ignoré", e);
                return;
            }
        };
        let env_db = base_opts.get_database().unwrap_or("").to_string();
        if !env_db.starts_with("pilot_gds_test_") || env_db == crate::db::GDS_DB_NAME {
            eprintln!(
                "REFUS: PILOT_GDS_TEST_URL doit viser une base `pilot_gds_test_*` (visée: {:?}) \
                 — test ignoré",
                env_db
            );
            return;
        }

        let test_db = format!("pilot_gds_test_{}_l25", std::process::id());
        let admin_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(base_opts.clone())
            .await
            .expect("connexion admin de test");
        let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{}\"", test_db))
            .execute(&admin_pool)
            .await;
        sqlx::query(&format!("CREATE DATABASE \"{}\"", test_db))
            .execute(&admin_pool)
            .await
            .expect("création base de test");
        // Teardown garanti même en cas de panique (thread dédié : un `Drop` ne
        // peut pas `.await`).
        struct DropTestDb {
            admin: PgConnectOptions,
            name: String,
        }
        impl Drop for DropTestDb {
            fn drop(&mut self) {
                let admin = self.admin.clone();
                let name = self.name.clone();
                let _ = std::thread::spawn(move || {
                    if let Ok(rt) = tokio::runtime::Runtime::new() {
                        let _ = rt.block_on(async move {
                            if let Ok(pool) = PgPoolOptions::new().connect_with(admin).await {
                                let _ = sqlx::query(
                                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                                     WHERE datname = $1 AND pid <> pg_backend_pid()",
                                )
                                .bind(&name)
                                .execute(&pool)
                                .await;
                                let _ = sqlx::query(&format!(
                                    "DROP DATABASE IF EXISTS \"{}\"",
                                    name
                                ))
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
        let _guard = DropTestDb {
            admin: base_opts.clone(),
            name: test_db.clone(),
        };
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .connect_with(base_opts.clone().database(&test_db))
            .await
            .expect("connexion base de test");
        crate::db::migrate(&pool).await.expect("migrations");

        let user_id: i64 = sqlx::query(
            "INSERT INTO users (email, role, status) VALUES ($1, 'dev', 'active') RETURNING id",
        )
        .bind("dev@l25.test")
        .fetch_one(&pool)
        .await
        .expect("utilisateur de test")
        .get("id");
        let k1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyOneL25==";
        let k2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyTwoL25==";
        let id1 = crate::db::create_ssh_key(&pool, user_id, k1).await.unwrap();
        let id2 = crate::db::create_ssh_key(&pool, user_id, k2).await.unwrap();
        assert!(id1 > 0 && id2 > 0);

        let dir = std::env::temp_dir().join(format!("pilot-l25-db-{}", std::process::id()));
        let auth = dir.join("authorized_keys").to_string_lossy().to_string();

        // 1) Les clefs enregistrées en base finissent dans le fichier, avec
        //    l'email comme commentaire.
        let lines = stored_key_lines(&pool).await.unwrap();
        assert_eq!(lines.len(), 2);
        let rendered = render_authorized_keys(&lines);
        assert!(write_authorized_keys(&auth, &rendered).unwrap());
        let content = std::fs::read_to_string(&auth).unwrap();
        assert!(content.contains("KeyOneL25"));
        assert!(content.contains("KeyTwoL25"));
        assert!(content.contains("dev@l25.test"));
        assert_eq!(content.lines().count(), 2);

        // 2) Idempotence : un second passage n'écrit rien.
        let lines_again = stored_key_lines(&pool).await.unwrap();
        assert!(!write_authorized_keys(&auth, &render_authorized_keys(&lines_again)).unwrap());

        // 3) Une clef RETIRÉE de la base disparaît du fichier (exigence L2.5).
        crate::db::delete_ssh_key(&pool, id1).await.unwrap();
        let lines_after = stored_key_lines(&pool).await.unwrap();
        assert_eq!(lines_after.len(), 1);
        assert!(write_authorized_keys(&auth, &render_authorized_keys(&lines_after)).unwrap());
        let content = std::fs::read_to_string(&auth).unwrap();
        assert!(!content.contains("KeyOneL25"), "clef révoquée encore autorisée");
        assert!(content.contains("KeyTwoL25"));

        // 4) Toutes les clefs retirées → fichier vide (aucune autorisation).
        crate::db::delete_ssh_key(&pool, id2).await.unwrap();
        let lines_empty = stored_key_lines(&pool).await.unwrap();
        assert!(lines_empty.is_empty());
        assert!(write_authorized_keys(&auth, &render_authorized_keys(&lines_empty)).unwrap());
        assert_eq!(std::fs::read_to_string(&auth).unwrap(), "");

        let _ = std::fs::remove_dir_all(&dir);
        pool.close().await;
    }
}
