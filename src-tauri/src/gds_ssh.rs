// gds_ssh.rs — Clef SSH du POSTE dev pour le GDS (spec_gds.md §4, Phase A3)
//
// Volet POSTE uniquement : génération/lecture de la clef SSH du poste dev
// (`~/.ssh/id_ed25519`), idempotente (n'écrase jamais une clef existante),
// enregistrement en base et synchronisation.
//
// Les helpers SERVEUR (utilisateur système `git`, `~git/.ssh/authorized_keys`
// 700/600, synchro DB → authorized_keys, activation sshd, décisions par OS) ont
// migré dans `gds_core::ssh` (refonte GDS, L1.6) : le futur serveur GDS les
// utilise sans embarquer Tauri. Ils restent ré-exportés ci-dessous pour le desk.
//
// Les décisions pures (validation de clef, formatage d'une réponse) sont
// testables sans admin ni base. Les sous-processus (ssh-keygen) passent par
// `run_captured` (helper process partagé).

use crate::gds_db;
use crate::run_captured;
use crate::AppState;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::time::Duration;
use tauri::State;

// ── Helpers serveur déplacés dans `gds-core` (refonte GDS, L1.6) ──
// Le serveur GDS (conteneur Linux) partage ces helpers avec le desk : décisions
// par OS, provision SSH (`~git/.ssh/authorized_keys`), synchro DB →
// authorized_keys et formatage des lignes de clef. Consommés DIRECTEMENT depuis
// `gds_core` (L1.10) : plus de ré-export `pub(crate)` intermédiaire.
// `provision_server_ssh` n'est plus appelé dans ce module — son unique appelant
// (`gds.rs`) pointe lui aussi directement sur `gds_core::ssh`.
use gds_core::ssh::{format_authorized_key, sync_authorized_keys};

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
    record_poste_key(pool, email, &key.public_key).await?;
    sync_authorized_keys(pool).await?;
    Ok(poste_key_response(&key.public_key, &key.path, key.generated, false))
}

/// Enregistre la clef publique du poste en base (idempotent), liée à l'email.
/// Ne touche à AUCUN fichier : c'est le seul point commun entre le chemin LOCAL
/// (qui synchronise ensuite `authorized_keys` du poste) et le chemin DISTANT
/// (qui n'écrit rien et laisse l'administrateur copier la clef).
async fn record_poste_key(pool: &PgPool, email: &str, public_key: &str) -> Result<(), String> {
    let (_, key_part) = split_public_key(public_key)?;
    let full = format_authorized_key("ssh-ed25519", &key_part, email);
    if let Some(user) = gds_db::get_user_by_email(pool, email).await? {
        if gds_db::get_ssh_key_by_key(pool, &full).await?.is_none() {
            gds_db::create_ssh_key(pool, user.id, &full).await?;
        }
    }
    Ok(())
}

/// Réponse JSON des chemins « clef du poste ». `manual = true` (serveur
/// DISTANT) indique à l'UI que la clef doit être copiée À LA MAIN dans
/// `~git/.ssh/authorized_keys` du serveur (aucune écriture à distance).
pub(crate) fn poste_key_response(
    public_key: &str,
    path: &str,
    generated: bool,
    manual: bool,
) -> Value {
    let mut v = json!({
        "ok": true,
        "public_key": public_key,
        "path": path,
        "generated": generated,
    });
    if manual {
        v["manual"] = json!(true);
    }
    v
}

/// Comme `ensure_poste_key`, mais pour un serveur GDS DISTANT : la clef du poste
/// est générée localement puis enregistrée en BASE uniquement. AUCUNE écriture
/// dans `~git/.ssh/authorized_keys` (celle-ci vit sur la machine distante et est
/// ajoutée MANUELLEMENT par l'administrateur, cf. docs/gds-linux-setup.md) : on
/// n'administre jamais un serveur distant depuis le poste. La clef publique est
/// retournée (`manual: true`) pour être copiée sur le serveur.
pub(crate) async fn ensure_poste_key_remote(pool: &PgPool, email: &str) -> Result<Value, String> {
    let key = ensure_ssh_key()?;
    record_poste_key(pool, email, &key.public_key).await?;
    Ok(poste_key_response(&key.public_key, &key.path, key.generated, true))
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
    fn poste_key_response_marks_remote_as_manual() {
        // LOCAL : pas de drapeau `manual` (clef synchronisée automatiquement).
        let local = poste_key_response("ssh-ed25519 AAAAkey", "/home/me/.ssh/id_ed25519", true, false);
        assert_eq!(local["ok"], json!(true));
        assert!(local.get("manual").is_none(), "le chemin local ne doit pas être marqué manuel");
        assert_eq!(local["public_key"], json!("ssh-ed25519 AAAAkey"));
        assert_eq!(local["generated"], json!(true));
        // DISTANT : `manual: true` → l'administrateur copie la clef lui-même.
        let remote = poste_key_response("ssh-ed25519 AAAAkey", "/home/me/.ssh/id_ed25519", false, true);
        assert_eq!(remote["manual"], json!(true));
        assert_eq!(remote["path"], json!("/home/me/.ssh/id_ed25519"));
        assert_eq!(remote["generated"], json!(false));
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

}
