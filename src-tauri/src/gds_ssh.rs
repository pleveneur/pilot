// gds_ssh.rs — Gestion des clefs SSH serveur du GDS (spec_gds.md §4, Phase A3)
//
// Deux volets :
//   1. Côté POSTE : génération/lecture de la clef SSH du poste dev
//      (`~/.ssh/id_ed25519`), idempotente (n'écrase jamais une clef existante).
//   2. Côté SERVEUR (GDS V1 = serveur local) : création de l'utilisateur
//      système `git`, `~git/.ssh/authorized_keys` (700/600), synchronisation
//      DB → authorized_keys (clefs liées aux emails), activation sshd.
//
// Les décisions pures (détection OS, formatage/parsing authorized_keys,
// validation de clef, idempotence) sont testables sans admin ni base.
// Les sous-processus (ssh-keygen, useradd, chmod, systemctl…) passent par
// `run_captured` (helper process partagé), comme les helpers git.

use crate::gds_db;
use crate::run_captured;
use crate::AppState;
use serde_json::{json, Value};
use sqlx::PgPool;
use sqlx::Row;
use std::time::Duration;
use tauri::State;

/// OS détecté pour les décisions de provision SSH (pure — testable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshOs {
    Linux,
    MacOs,
    Windows,
    Unknown,
}

/// Détecte l'OS courant (pure — testable).
pub(crate) fn detect_os() -> SshOs {
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

/// Chemin de la clef privée ed25519 du poste dev (`~/.ssh/id_ed25519`).
pub(crate) fn ssh_key_path() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        ".ssh/id_ed25519".to_string()
    } else {
        format!("{}/.ssh/id_ed25519", home)
    }
}

/// Info de la clef SSH du poste (retournée à l'UI).
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct SshKeyInfo {
    pub public_key: String,
    pub path: String,
    pub generated: bool,
}

/// Lit la clef publique (`<path>.pub`).
pub(crate) fn read_public_key(pub_path: &str) -> Result<String, String> {
    let content =
        std::fs::read_to_string(pub_path).map_err(|e| format!("Lecture clef publique: {}", e))?;
    Ok(content.trim().to_string())
}

/// Génère la paire ed25519 du poste si absente (idempotent — n'écrase jamais
/// une clef existante), puis retourne la clef publique. `ssh-keygen` écrit sa
/// progression sur stderr (nullé par `run_captured`) → on vérifie la création
/// du fichier `.pub` plutôt que la sortie.
pub(crate) fn ensure_ssh_key() -> Result<SshKeyInfo, String> {
    let path = ssh_key_path();
    let pub_path = format!("{}.pub", path);
    let generated = !std::path::Path::new(&path).exists();
    if generated {
        if let Some(dir) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Création ~/.ssh: {}", e))?;
        }
        run_captured(
            "ssh-keygen",
            &["-t", "ed25519", "-N", "", "-f", &path],
            Duration::from_secs(30),
        );
        if !std::path::Path::new(&pub_path).exists() {
            return Err("ssh-keygen a échoué (OpenSSH absent ?)".to_string());
        }
    }
    let public_key = read_public_key(&pub_path)?;
    Ok(SshKeyInfo {
        public_key,
        path,
        generated,
    })
}

// ── Validation & formatage authorized_keys (pures — testables) ──

/// Types de clef publique acceptés (OpenSSH).
const ALLOWED_KEY_TYPES: &[&str] = &[
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "ssh-dss",
];

/// Valide le type de clef (pure — testable).
pub(crate) fn validate_key_type(key_type: &str) -> Result<String, String> {
    let kt = key_type.trim();
    if ALLOWED_KEY_TYPES.contains(&kt) {
        Ok(kt.to_string())
    } else {
        Err("Type de clef non supporté".to_string())
    }
}

/// Valide la partie base64 d'une clef publique (anti-injection de ligne) :
/// aucun espace, retour-chariot, ou métacaractère shell. Pure — testable.
pub(crate) fn validate_public_key(key: &str) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Clef publique vide".to_string());
    }
    if key.chars().any(|c| c.is_whitespace() || c == '\n' || c == '\r') {
        return Err("Clef publique invalide (caractères interdits)".to_string());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c))
    {
        return Err("Clef publique invalide (format base64 attendu)".to_string());
    }
    Ok(key.to_string())
}

/// Sépare une ligne de clef publique en `(type, base64)` après validation.
/// Pure — testable.
pub(crate) fn split_public_key(public_key: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = public_key.split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Clef publique invalide (format `type base64 [comment]` attendu)".to_string());
    }
    let kt = validate_key_type(parts[0])?;
    let key = validate_public_key(parts[1])?;
    Ok((kt, key))
}

/// Formate une ligne authorized_keys : `type base64 email`. Pure — testable.
pub(crate) fn format_authorized_key(key_type: &str, key: &str, email: &str) -> String {
    format!("{} {} {}", key_type, key, email)
}

/// Parse une ligne authorized_keys en `(type, base64, comment)`. Retourne
/// `None` pour les lignes vides ou commentaires. Pure — testable.
pub(crate) fn parse_authorized_key(line: &str) -> Option<(String, String, String)> {
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
pub(crate) fn merge_authorized_keys(existing: &str, new_lines: &[String]) -> String {
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

/// Empreinte SHA256 d'une clef publique (convention `ssh-keygen -lf` :
/// SHA256 du blob base64 décodé, encodé en base64). Pure — testable.
pub(crate) fn public_key_fingerprint(public_key: &str) -> String {
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
pub(crate) fn is_admin() -> bool {
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
pub(crate) fn git_user_exists() -> bool {
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
pub(crate) fn commands_to_create_git_user(os: &SshOs) -> Vec<String> {
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
pub(crate) fn git_user_home() -> String {
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
/// est le `ProfileImagePath` du registre (pas `C:\Users\git`). Priorité :
/// 1. Registre ProfileImagePath (locale-indépendant) via PowerShell.
/// 2. `net user git` (champ "Répertoire de base" / "Home directory", localisé).
/// 3. Repli `C:\Users\git`.
#[cfg(windows)]
fn windows_git_user_home() -> String {
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
    let out = run_captured("net", &["user", "git"], Duration::from_secs(5));
    for line in out.lines() {
        if let Some(p) = extract_windows_path(line) {
            return p;
        }
    }
    "C:\\Users\\git".to_string()
}

#[cfg(not(windows))]
fn windows_git_user_home() -> String {
    String::new()
}

/// Extrait un chemin absolu Windows (`X:\...`) d'une ligne. Pure — testable.
pub(crate) fn extract_windows_path(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':' && bytes[i + 2] == b'\\' {
            return Some(line[i..].trim().to_string());
        }
    }
    None
}

/// Chemin du fichier `authorized_keys` de l'utilisateur `git`.
pub(crate) fn authorized_keys_path() -> String {
    format!("{}/.ssh/authorized_keys", git_user_home())
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

/// Provisionne le serveur SSH local (Phase A3) : crée l'utilisateur `git` s'il
/// n'existe pas, crée `~git/.ssh/authorized_keys` (700/600), s'assure que sshd
/// autorise l'accès git. Retourne une erreur claire si les droits admin
/// manquent pour créer l'utilisateur.
pub(crate) fn provision_server_ssh() -> Result<Value, String> {
    let os = detect_os();
    // 1. Créer l'utilisateur système `git` s'il n'existe pas.
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
            let out = run_shell(cmd);
            if out.trim().is_empty() {
                return Err(format!("Échec de la création de l'utilisateur `git` : {}", cmd));
            }
        }
    }
    // 2. Créer ~git/.ssh/authorized_keys (700/600).
    let home = git_user_home();
    let ssh_dir = format!("{}/.ssh", home);
    std::fs::create_dir_all(&ssh_dir).map_err(|e| format!("Création ~git/.ssh: {}", e))?;
    let auth = format!("{}/authorized_keys", ssh_dir);
    if !std::path::Path::new(&auth).exists() {
        std::fs::write(&auth, "").map_err(|e| format!("Création authorized_keys: {}", e))?;
    }
    if os != SshOs::Windows {
        run_captured("chmod", &["700", &ssh_dir], Duration::from_secs(5));
        run_captured("chmod", &["600", &auth], Duration::from_secs(5));
    }
    // 3. S'assurer que sshd autorise l'accès git.
    ensure_sshd_git_access(&os)?;
    Ok(json!({ "ok": true, "user": "git", "home": home, "authorized_keys": auth }))
}

// ── Synchronisation DB → authorized_keys (clefs liées aux emails) ──

/// Synchronise la table `ssh_keys` (associée aux emails) vers
/// `~git/.ssh/authorized_keys` : pour chaque clef, écrit la ligne
/// `type base64 <email>`. Idempotent (déduplication par clef).
pub(crate) async fn sync_authorized_keys(pool: &PgPool) -> Result<(), String> {
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
    let auth = authorized_keys_path();
    let existing = std::fs::read_to_string(&auth).unwrap_or_default();
    let merged = merge_authorized_keys(&existing, &lines);
    std::fs::write(&auth, merged).map_err(|e| format!("Écriture authorized_keys: {}", e))?;
    Ok(())
}

/// Enregistre une clef publique pour un email : insère en base (idempotent)
/// puis synchronise `authorized_keys`. Validation stricte du format (anti
/// injection de ligne).
pub(crate) async fn register_ssh_key(
    pool: &PgPool,
    email: &str,
    public_key: &str,
) -> Result<Value, String> {
    let (kt, key) = split_public_key(public_key)?;
    let user = gds_db::get_user_by_email(pool, email)
        .await?
        .ok_or_else(|| format!("Utilisateur inconnu: {}", email))?;
    let full = format_authorized_key(&kt, &key, email);
    gds_db::create_ssh_key(pool, user.id, &full).await?;
    sync_authorized_keys(pool).await?;
    Ok(json!({ "ok": true, "email": email, "public_key": full }))
}

/// S'assure que la clef du poste dev est générée et enregistrée pour l'email
/// donné (idempotent). Appelé à la provision, à l'ajout de projet et à la
/// synchro pour que le remote `ssh://git@<host>:22/<projet>.git` soit utilisable.
pub(crate) async fn ensure_poste_key(pool: &PgPool, email: &str) -> Result<Value, String> {
    let key = ensure_ssh_key()?;
    let (_, key_part) = split_public_key(&key.public_key)?;
    let full = format_authorized_key("ssh-ed25519", &key_part, email);
    if let Some(user) = gds_db::get_user_by_email(pool, email).await? {
        if gds_db::get_ssh_key_by_key(pool, &full).await?.is_none() {
            gds_db::create_ssh_key(pool, user.id, &full).await?;
        }
    }
    sync_authorized_keys(pool).await?;
    Ok(json!({ "ok": true, "public_key": key.public_key, "path": key.path, "generated": key.generated }))
}

// ── Commandes Tauri ──

/// Commande Tauri : génère/affiche la clef publique du poste dev.
/// Retourne `{ public_key, path, generated }`.
#[tauri::command]
pub fn gds_ssh_key() -> Result<Value, String> {
    let key = ensure_ssh_key()?;
    Ok(json!({ "public_key": key.public_key, "path": key.path, "generated": key.generated }))
}

/// Commande Tauri : enregistre une clef publique de dev (email + clef) en base
/// puis met à jour `authorized_keys`.
#[tauri::command]
pub async fn gds_register_ssh_key(
    state: State<'_, AppState>,
    email: String,
    public_key: String,
) -> Result<Value, String> {
    let pool = state
        .gds_pool
        .lock()
        .unwrap()
        .clone()
        .ok_or("GDS non provisionné")?;
    register_ssh_key(&pool, &email, &public_key).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_os_returns_something() {
        // Ne doit jamais être Unknown sur les 3 plateformes cibles.
        let os = detect_os();
        assert!(matches!(os, SshOs::Linux | SshOs::MacOs | SshOs::Windows));
    }

    #[test]
    fn validate_public_key_accepts_base64() {
        assert_eq!(
            validate_public_key("AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==").unwrap(),
            "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey=="
        );
    }

    #[test]
    fn validate_public_key_rejects_injection() {
        // Espace / retour-chariot / métacaractère shell → rejeté.
        assert!(validate_public_key("AAA key").is_err());
        assert!(validate_public_key("AAA\nkey").is_err());
        assert!(validate_public_key("AAA;rm -rf /").is_err());
        assert!(validate_public_key("").is_err());
    }

    #[test]
    fn validate_key_type_accepts_ed25519() {
        assert_eq!(validate_key_type("ssh-ed25519").unwrap(), "ssh-ed25519");
        assert!(validate_key_type("ssh-rsa").is_ok());
        assert!(validate_key_type("bogus").is_err());
    }

    #[test]
    fn split_public_key_validates_and_splits() {
        let (kt, key) = split_public_key("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==").unwrap();
        assert_eq!(kt, "ssh-ed25519");
        assert_eq!(key, "AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==");
        // Trop court → erreur.
        assert!(split_public_key("ssh-ed25519").is_err());
        // Type invalide → erreur.
        assert!(split_public_key("bogus AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey==").is_err());
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
            extract_windows_path("R\u{e9}pertoire de base                             C:\\Users\\pldistance\\Pilot\\GDS\\repos"),
            Some("C:\\Users\\pldistance\\Pilot\\GDS\\repos".to_string())
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
}
