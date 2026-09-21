// auth.rs — Authentification du serveur web distant (mode remote) — socle partagé
//
// Extrait de `src-tauri/src/web_auth.rs` (refonte GDS, L1.7) : le serveur GDS
// autonome (`gds-server`) a besoin de la même authentification que le mode
// remote du desk. Aucune dépendance Tauri.
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
    /// Rôle du compte au moment de la création de la session (chaîne vide si
    /// inconnu, cas des sessions du mode remote du poste). Consommé par le garde
    /// « administrateur uniquement » des routes d'administration GDS (L2.2).
    role: String,
    /// Identifiant du compte GDS (`users.id`) au moment de la création de la
    /// session ; `0` si inconnu (sessions historiques du mode remote du poste).
    /// Consommé par la lecture restreinte de l'appartenance aux projets
    /// (refonte GDS, L3.4) : un développeur non administrateur ne voit que les
    /// projets qui lui sont attribués.
    user_id: i64,
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

    /// Crée une session **sans rôle** (comportement historique du mode remote
    /// du poste, où l'identité est celle du propriétaire et non d'un compte
    /// GDS), renvoie le token brut (base64url).
    pub fn create_session(&self, ttl: Duration) -> String {
        self.create_session_as("", ttl)
    }

    /// Crée une session **portant un rôle** (compte GDS), renvoie le token brut
    /// (base64url) à transmettre au client. Le token brut n'est **jamais**
    /// stocké ; seul son hash SHA-256 l'est. Le rôle accompagne la session pour
    /// que les gardes de routes n'aient pas à relire la base à chaque requête.
    ///
    /// L'identité du compte (`users.id`) reste inconnue (`0`) : réservée aux
    /// sessions qui n'ont besoin que du rôle (tests, comptes admin).
    pub fn create_session_as(&self, role: &str, ttl: Duration) -> String {
        self.create_session_for(0, role, ttl)
    }

    /// Crée une session portant **le rôle et l'identité** du compte GDS (refonte
    /// GDS, **L3.4**). `user_id` est l'identifiant `users.id` ; `0` signifie
    /// « inconnu » (aucune restriction d'appartenance ne peut alors être
    /// appliquée). Renvoie le token brut (base64url).
    pub fn create_session_for(&self, user_id: i64, role: &str, ttl: Duration) -> String {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token = encode_token(&bytes);
        let entry = Session {
            token_hash: hash_token(&token),
            expires_at: Instant::now() + ttl,
            role: role.to_string(),
            user_id,
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(entry.token_hash.clone(), entry);
        token
    }

    /// Rôle associé à un token valide ; `None` si le token est inconnu ou
    /// expiré (la session expirée est nettoyée au passage, comme `validate`).
    pub fn role_of(&self, token: &str) -> Option<String> {
        if token.is_empty() {
            return None;
        }
        let key = hash_token(token);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get(&key) {
            Some(sess) if sess.expires_at > Instant::now() => Some(sess.role.clone()),
            Some(_) => {
                sessions.remove(&key);
                None
            }
            None => None,
        }
    }

    /// Identifiant du compte (`users.id`) associé à un token valide (refonte
    /// GDS, **L3.4**) ; `None` si le token est inconnu ou expiré. `Some(0)` est
    /// renvoyé pour une session historique du poste (rôle sans compte GDS).
    pub fn user_id_of(&self, token: &str) -> Option<i64> {
        if token.is_empty() {
            return None;
        }
        let key = hash_token(token);
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get(&key) {
            Some(sess) if sess.expires_at > Instant::now() => Some(sess.user_id),
            Some(_) => {
                sessions.remove(&key);
                None
            }
            None => None,
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn hash_then_verify_roundtrip() {
        let h = WebAuth::hash_password("secret-123").unwrap();
        assert!(WebAuth::verify_password("secret-123", &h));
        assert!(!WebAuth::verify_password("wrong", &h));
    }

    #[test]
    fn empty_password_refused() {
        assert!(WebAuth::hash_password("").is_err());
    }

    #[test]
    fn empty_hash_never_verifies() {
        assert!(!WebAuth::verify_password("anything", ""));
        assert!(!WebAuth::verify_password("anything", "not-a-valid-phc"));
    }

    #[test]
    fn session_create_validate_and_expiry() {
        let auth = WebAuth::new();
        let token = auth.create_session(Duration::from_millis(50));
        assert!(auth.validate(&token));
        assert!(!auth.validate("bogus-token"));
        // Expire après la TTL.
        std::thread::sleep(Duration::from_millis(80));
        assert!(!auth.validate(&token));
        assert_eq!(auth.active_count(), 0);
    }

    #[test]
    fn revoke_all_invalidates_sessions() {
        let auth = WebAuth::new();
        let t1 = auth.create_session(Duration::from_secs(60));
        let t2 = auth.create_session(Duration::from_secs(60));
        assert_eq!(auth.active_count(), 2);
        auth.revoke_all();
        assert_eq!(auth.active_count(), 0);
        assert!(!auth.validate(&t1));
        assert!(!auth.validate(&t2));
    }

    #[test]
    fn role_is_bound_to_the_session() {
        let auth = WebAuth::new();
        let admin = auth.create_session_as("admin", Duration::from_secs(60));
        let legacy = auth.create_session(Duration::from_secs(60));
        assert_eq!(auth.role_of(&admin).as_deref(), Some("admin"));
        // Session historique (mode remote du poste) : rôle vide, jamais "admin".
        assert_eq!(auth.role_of(&legacy).as_deref(), Some(""));
        assert_eq!(auth.role_of("bogus-token"), None);
        assert_eq!(auth.role_of(""), None);
    }

    #[test]
    fn role_of_expired_session_is_none_and_cleans_up() {
        let auth = WebAuth::new();
        let token = auth.create_session_as("admin", Duration::from_millis(30));
        assert_eq!(auth.role_of(&token).as_deref(), Some("admin"));
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(auth.role_of(&token), None);
        assert_eq!(auth.active_count(), 0);
    }

    #[test]
    fn user_id_is_bound_to_the_session() {
        // L3.4 : la session porte l'identité du compte pour la lecture
        // restreinte des projets attribués.
        let auth = WebAuth::new();
        let dev = auth.create_session_for(42, "dev", Duration::from_secs(60));
        let legacy = auth.create_session(Duration::from_secs(60));
        assert_eq!(auth.user_id_of(&dev), Some(42));
        assert_eq!(auth.role_of(&dev).as_deref(), Some("dev"));
        // Session historique du poste : rôle vide et identité inconnue (0).
        assert_eq!(auth.user_id_of(&legacy), Some(0));
        assert_eq!(auth.user_id_of("bogus-token"), None);
        assert_eq!(auth.user_id_of(""), None);
    }

    #[test]
    fn token_hash_is_not_raw_token() {
        // Le stock interne ne contient jamais le token brut, seulement son SHA-256.
        let auth = WebAuth::new();
        let token = auth.create_session(Duration::from_secs(60));
        let sessions = auth.sessions.lock().unwrap();
        let stored = sessions.keys().next().unwrap();
        assert_ne!(stored, token.as_bytes());
        assert_eq!(stored, &hash_token(&token));
    }
}