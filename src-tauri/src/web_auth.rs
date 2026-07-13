// web_auth.rs — Authentification du serveur web distant (mode remote)
//
// Modèle (décision 6.3) :
//   - Mot de passe applicatif stocké **hashé argon2** dans AppConfig (jamais en clair).
//   - Token de session opaque (rand 32 bytes, base64url), sans signification intrinsèque.
//   - On stocke en mémoire le **hash SHA-256 du token** (pas le token brut) → une fuite
//     de la map ne permet pas de rejouer la session.
//   - Expiration paresseuse (champ expires_at vérifié à chaque lookup).
//   - Révocation immédiate : `revoke_all()` vide la map (bouton « kick remote » ou
//     changement de mot de passe).

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Hash SHA-256 d'un token (stocké en mémoire, pas le token brut).
fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

struct Session {
    #[allow(dead_code)]
    token_hash: Vec<u8>,
    expires_at: Instant,
}

/// Stock des sessions en mémoire vive. La map disparaît au redémarrage du process :
/// l'utilisateur retape sa passphrase une fois sur le téléphone (souhaitable).
pub struct WebAuth {
    sessions: Mutex<HashMap<Vec<u8>, Session>>,
}

impl WebAuth {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Hash un mot de passe en argon2 (chaîne encodée PHC). Refuse le mot de passe vide.
    pub fn hash_password(password: &str) -> Result<String, String> {
        if password.is_empty() {
            return Err("Mot de passe vide refusé".to_string());
        }
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| format!("Hash argon2: {}", e))?;
        Ok(hash.to_string())
    }

    /// Vérifie un mot de passe contre un hash argon2. Hash vide → false.
    pub fn verify_password(password: &str, hash: &str) -> bool {
        if hash.is_empty() {
            return false;
        }
        let parsed = match PasswordHash::new(hash) {
            Ok(p) => p,
            Err(_) => return false,
        };
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    }

    /// Crée une session, renvoie le token brut (base64url) à transmettre au client.
    /// Le token brut n'est **jamais** stocké ; seul son hash SHA-256 l'est.
    pub fn create_session(&self, ttl: Duration) -> String {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token = encode_token(&bytes);
        let entry = Session {
            token_hash: hash_token(&token),
            expires_at: Instant::now() + ttl,
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(entry.token_hash.clone(), entry);
        token
    }

    /// Valide un token brut : true si une session correspondante existe et n'est pas
    /// expirée. Nettoie paresseusement la session expirée si applicable.
    pub fn validate(&self, token: &str) -> bool {
        if token.is_empty() {
            return false;
        }
        let key = hash_token(token);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get(&key) {
            Some(sess) => {
                if sess.expires_at <= Instant::now() {
                    sessions.remove(&key);
                    false
                } else {
                    true
                }
            }
            None => false,
        }
    }

    /// Révoque toutes les sessions (kick remote / changement de mot de passe).
    pub fn revoke_all(&self) {
        self.sessions.lock().unwrap().clear();
    }

    /// Nombre de sessions actives (pour le badge desktop « client distant connecté »).
    pub fn active_count(&self) -> usize {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, s| s.expires_at > now);
        sessions.len()
    }
}

fn encode_token(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}