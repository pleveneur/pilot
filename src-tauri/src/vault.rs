// vault.rs — Coffre fort de mots de passe (issue #52)
//
// Stockage : fichier chiffré `~/.pilot/vault.json` (hors du projet, centralisé).
// Chiffrement : AES-256-GCM, clé dérivée du mot de passe maître via Argon2id.
// Le mot de passe maître n'est jamais stocké en clair ; seule la clé dérivée est
// conservée en mémoire (AppState.vault_key) tant que le coffre est déverrouillé.
// Portée double : chaque entrée est globale à Pilot OU spécifique à un projet.
//
// Format du fichier (JSON) :
//   { "version": 1, "salt": "<b64>", "nonce": "<b64>", "ciphertext": "<b64>" }
// Le clair est un tableau JSON d'entrées `VaultEntry`.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::AppState;

/// Une entrée du coffre. `scope` vaut "global" (tous les projets) ou "project"
/// (restreint au projet `project_path`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub description: String,
    pub login: String,
    pub password: String,
    pub scope: String,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

/// Structure chiffrée persistée sur disque.
#[derive(Debug, Serialize, Deserialize)]
struct VaultFile {
    version: u32,
    salt: String,
    nonce: String,
    ciphertext: String,
}

/// État renvoyé au frontend : le coffre existe-t-il ? est-il déverrouillé ?
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    initialized: bool,
    unlocked: bool,
}

fn vault_path() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let dir = PathBuf::from(home).join(".pilot");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier .pilot: {}", e))?;
    Ok(dir.join("vault.json"))
}

/// Dérive une clé AES-256 (32 octets) depuis le mot de passe maître + un sel.
fn derive_key(master_password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let argon2 = Argon2::default();
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(master_password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Erreur dérivation clé: {}", e))?;
    Ok(key)
}

/// Chiffre `plaintext` avec AES-256-GCM (nonce aléatoire de 12 octets).
fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Erreur clé: {}", e))?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Erreur chiffrement: {}", e))?;
    Ok((ct, nonce_bytes.to_vec()))
}

/// Déchiffre `ciphertext` avec AES-256-GCM. Échoue si le mot de passe est faux
/// (échec d'authentification GCM).
fn decrypt(ciphertext: &[u8], nonce: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Erreur clé: {}", e))?;
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Mot de passe maître incorrect ou données corrompues".to_string())
}

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Récupère la clé en mémoire (coffre déverrouillé) ou erreur.
fn get_key(state: &State<AppState>) -> Result<Vec<u8>, String> {
    state
        .vault_key
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Le coffre est verrouillé".to_string())
}

/// Lit et déchiffre les entrées avec une clé déjà dérivée.
fn read_entries_with_key(path: &PathBuf, key: &[u8]) -> Result<Vec<VaultEntry>, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Erreur lecture coffre: {}", e))?;
    let file: VaultFile =
        serde_json::from_str(&content).map_err(|e| format!("Erreur format coffre: {}", e))?;
    let key32: [u8; 32] = key
        .try_into()
        .map_err(|_| "Clé invalide (taille)".to_string())?;
    let nonce = B64
        .decode(&file.nonce)
        .map_err(|e| format!("Erreur nonce: {}", e))?;
    let ct = B64
        .decode(&file.ciphertext)
        .map_err(|e| format!("Erreur ciphertext: {}", e))?;
    let plaintext = decrypt(&ct, &nonce, &key32)?;
    serde_json::from_str(&String::from_utf8_lossy(&plaintext))
        .map_err(|e| format!("Erreur données: {}", e))
}

/// Ré-chiffre et écrit les entrées (conserve le sel existant).
fn write_entries(path: &PathBuf, key: &[u8], entries: &[VaultEntry]) -> Result<(), String> {
    let key32: [u8; 32] = key
        .try_into()
        .map_err(|_| "Clé invalide (taille)".to_string())?;
    let plaintext =
        serde_json::to_vec(entries).map_err(|e| format!("Erreur sérialisation: {}", e))?;
    let (ct, nonce) = encrypt(&plaintext, &key32)?;
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Erreur lecture coffre: {}", e))?;
    let file: VaultFile =
        serde_json::from_str(&content).map_err(|e| format!("Erreur format coffre: {}", e))?;
    let new_file = VaultFile {
        version: 1,
        salt: file.salt,
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ct),
    };
    std::fs::write(
        path,
        serde_json::to_string_pretty(&new_file).map_err(|e| format!("Erreur écriture: {}", e))?,
    )
    .map_err(|e| format!("Erreur écriture coffre: {}", e))
}

// ── Commandes Tauri ──

/// État du coffre : initialisé ? déverrouillé ?
#[tauri::command]
pub fn vault_status(state: State<AppState>) -> Result<VaultStatus, String> {
    let path = vault_path()?;
    Ok(VaultStatus {
        initialized: path.exists(),
        unlocked: state.vault_key.lock().unwrap().is_some(),
    })
}

/// Déverrouille le coffre avec le mot de passe maître. En cas de succès, la clé
/// dérivée est conservée en mémoire et les entrées sont renvoyées.
#[tauri::command]
pub fn vault_unlock(
    state: State<AppState>,
    master_password: String,
) -> Result<Vec<VaultEntry>, String> {
    let path = vault_path()?;
    if !path.exists() {
        return Err("Le coffre n'est pas initialisé".to_string());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Erreur lecture coffre: {}", e))?;
    let file: VaultFile =
        serde_json::from_str(&content).map_err(|e| format!("Erreur format coffre: {}", e))?;
    let salt = B64
        .decode(&file.salt)
        .map_err(|e| format!("Erreur sel: {}", e))?;
    let key = derive_key(&master_password, &salt)?;
    let nonce = B64
        .decode(&file.nonce)
        .map_err(|e| format!("Erreur nonce: {}", e))?;
    let ct = B64
        .decode(&file.ciphertext)
        .map_err(|e| format!("Erreur ciphertext: {}", e))?;
    let plaintext = decrypt(&ct, &nonce, &key)?;
    let entries: Vec<VaultEntry> =
        serde_json::from_str(&String::from_utf8_lossy(&plaintext))
            .map_err(|e| format!("Erreur données: {}", e))?;
    *state.vault_key.lock().unwrap() = Some(key.to_vec());
    Ok(entries)
}

/// Verrouille le coffre (efface la clé en mémoire).
#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> Result<(), String> {
    *state.vault_key.lock().unwrap() = None;
    Ok(())
}

/// Initialise le coffre (1er mot de passe maître) ou change le mot de passe
/// maître (si le coffre est déjà déverrouillé). Les entrées existantes sont
/// conservées et ré-chiffrées avec la nouvelle clé.
#[tauri::command]
pub fn vault_set_master_password(
    state: State<AppState>,
    master_password: String,
) -> Result<(), String> {
    if master_password.len() < 4 {
        return Err("Le mot de passe maître doit contenir au moins 4 caractères".to_string());
    }
    let path = vault_path()?;
    let existing: Vec<VaultEntry> = if path.exists() {
        let key_opt = state.vault_key.lock().unwrap().clone();
        match key_opt {
            Some(key) => read_entries_with_key(&path, &key)?,
            None => {
                return Err(
                    "Le coffre existe déjà : déverrouillez-le d'abord pour changer le mot de passe maître"
                        .to_string(),
                )
            }
        }
    } else {
        Vec::new()
    };

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_key(&master_password, &salt)?;
    let plaintext =
        serde_json::to_vec(&existing).map_err(|e| format!("Erreur sérialisation: {}", e))?;
    let (ct, nonce) = encrypt(&plaintext, &key)?;
    let file = VaultFile {
        version: 1,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ct),
    };
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&file).map_err(|e| format!("Erreur écriture: {}", e))?,
    )
    .map_err(|e| format!("Erreur écriture coffre: {}", e))?;
    *state.vault_key.lock().unwrap() = Some(key.to_vec());
    Ok(())
}

/// Liste les entrées (coffre déverrouillé requis).
#[tauri::command]
pub fn vault_list(state: State<AppState>) -> Result<Vec<VaultEntry>, String> {
    let key = get_key(&state)?;
    let path = vault_path()?;
    read_entries_with_key(&path, &key)
}

/// Ajoute une entrée.
#[tauri::command]
pub fn vault_add(
    state: State<AppState>,
    entry: VaultEntry,
) -> Result<Vec<VaultEntry>, String> {
    let key = get_key(&state)?;
    let path = vault_path()?;
    let mut entries = read_entries_with_key(&path, &key)?;
    let now = now_ts();
    let mut e = entry;
    if e.id.is_empty() {
        e.id = uuid::Uuid::new_v4().to_string();
    }
    e.created_at = now;
    e.updated_at = now;
    entries.push(e);
    write_entries(&path, &key, &entries)?;
    Ok(entries)
}

/// Met à jour une entrée existante (identifiée par `id`).
#[tauri::command]
pub fn vault_update(
    state: State<AppState>,
    entry: VaultEntry,
) -> Result<Vec<VaultEntry>, String> {
    let key = get_key(&state)?;
    let path = vault_path()?;
    let mut entries = read_entries_with_key(&path, &key)?;
    let now = now_ts();
    let found = entries
        .iter_mut()
        .find(|e| e.id == entry.id)
        .ok_or_else(|| "Entrée introuvable".to_string())?;
    found.description = entry.description;
    found.login = entry.login;
    found.password = entry.password;
    found.scope = entry.scope;
    found.project_path = entry.project_path;
    found.updated_at = now;
    write_entries(&path, &key, &entries)?;
    Ok(entries)
}

/// Supprime une entrée.
#[tauri::command]
pub fn vault_delete(state: State<AppState>, id: String) -> Result<Vec<VaultEntry>, String> {
    let key = get_key(&state)?;
    let path = vault_path()?;
    let mut entries = read_entries_with_key(&path, &key)?;
    entries.retain(|e| e.id != id);
    write_entries(&path, &key, &entries)?;
    Ok(entries)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_is_stable_and_32_bytes() {
        let salt = [7u8; 16];
        let k1 = derive_key("motdepasse", &salt).unwrap();
        let k2 = derive_key("motdepasse", &salt).unwrap();
        assert_eq!(k1.len(), 32);
        assert_eq!(k1, k2);
        let k3 = derive_key("autre", &salt).unwrap();
        assert_ne!(k1, k3);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [42u8; 32];
        let (ct, nonce) = encrypt(b"secret-data", &key).unwrap();
        let pt = decrypt(&ct, &nonce, &key).unwrap();
        assert_eq!(pt, b"secret-data");
    }

    #[test]
    fn decrypt_wrong_key_fails() {
        let key = [1u8; 32];
        let wrong = [2u8; 32];
        let (ct, nonce) = encrypt(b"data", &key).unwrap();
        assert!(decrypt(&ct, &nonce, &wrong).is_err());
    }

    #[test]
    fn nonce_is_random() {
        let key = [9u8; 32];
        let (_, n1) = encrypt(b"a", &key).unwrap();
        let (_, n2) = encrypt(b"a", &key).unwrap();
        assert_ne!(n1, n2);
    }

    #[test]
    fn entry_serde_roundtrip() {
        let e = VaultEntry {
            id: "abc".into(),
            description: "Serveur OVH".into(),
            login: "root".into(),
            password: "p4ss".into(),
            scope: "project".into(),
            project_path: Some("/proj".into()),
            created_at: 1,
            updated_at: 2,
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: VaultEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc");
        assert_eq!(back.scope, "project");
        assert_eq!(back.project_path.as_deref(), Some("/proj"));
    }
}
