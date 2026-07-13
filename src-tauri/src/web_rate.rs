// web_rate.rs — Rate limiting & garde-fous du serveur web distant (mode remote)
//
// Défense en profondeur (décision 6.3/6.4) : Tailscale est la première barrière,
// l'authentification la seconde, et ces compteurs la troisième — pour limiter les
// dégâts d'un token volé ou d'un brute-force même sur le mesh.
//
// Limites (fixes, conservatoires) :
//   - Login  : 5 tentatives / 60 s / IP source.
//   - Prompt : 10 prompts    / 60 s / token.
//   - WS     : 3 connexions simultanées / token.
//
// Implémentation : fenêtre glissante simple (Vec<Instant> par clé, nettoyage
// paresseux à chaque vérification). Tout est en mémoire dans le process Tauri ;
// les compteurs sont réinitialisés au redémarrage (acceptable).

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Limite de login : tentatives max par fenêtre, par IP source.
const LOGIN_MAX: usize = 5;
const LOGIN_WINDOW: Duration = Duration::from_secs(60);

/// Limite de prompts : max par fenêtre, par token.
const PROMPT_MAX: usize = 10;
const PROMPT_WINDOW: Duration = Duration::from_secs(60);

/// Nombre max de WebSockets simultanés par token.
const WS_MAX: usize = 3;

/// Clé stable et non réversible dérivée d'un token brut (hash SHA-256 hex).
/// On l'utilise comme clé de comptage plutôt que le token brut, pour ne jamais
/// trimballer/loguer le token lui-même dans les structures de garde.
pub fn token_key(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Compteurs de rate limiting partagés (login, prompt, WS par token).
pub struct WebGuard {
    login: Mutex<HashMap<String, Vec<Instant>>>,
    prompt: Mutex<HashMap<String, Vec<Instant>>>,
    ws_count: Mutex<HashMap<String, usize>>,
}

impl WebGuard {
    pub fn new() -> Self {
        Self {
            login: Mutex::new(HashMap::new()),
            prompt: Mutex::new(HashMap::new()),
            ws_count: Mutex::new(HashMap::new()),
        }
    }

    /// Login : true si la tentative est autorisée (et l'enregistre), false si la
    /// limite est atteinte pour cette IP sur la fenêtre courante.
    pub fn check_login(&self, ip: &str) -> bool {
        self.check(&self.login, ip, LOGIN_MAX, LOGIN_WINDOW)
    }

    /// Prompt : true si autorisé (et enregistre), false si limite atteinte pour
    /// ce token sur la fenêtre courante. `key` = `token_key(token)`.
    pub fn check_prompt(&self, key: &str) -> bool {
        self.check(&self.prompt, key, PROMPT_MAX, PROMPT_WINDOW)
    }

    fn check(
        &self,
        map: &Mutex<HashMap<String, Vec<Instant>>>,
        key: &str,
        max: usize,
        window: Duration,
    ) -> bool {
        let now = Instant::now();
        let mut m = map.lock().unwrap();
        let v = m.entry(key.to_string()).or_default();
        v.retain(|t| now.duration_since(*t) < window);
        if v.len() >= max {
            return false;
        }
        v.push(now);
        true
    }

    /// WebSocket : tente d'acquérir un slot pour ce token. true si autorisé
    /// (incrémente le compteur), false si `WS_MAX` connexions déjà ouvertes.
    /// Appairer avec `ws_release` à la fermeture de la socket.
    pub fn ws_acquire(&self, key: &str) -> bool {
        let mut m = self.ws_count.lock().unwrap();
        let c = m.entry(key.to_string()).or_insert(0);
        if *c >= WS_MAX {
            return false;
        }
        *c += 1;
        true
    }

    /// Libère un slot WebSocket pour ce token (à la fermeture de la socket).
    pub fn ws_release(&self, key: &str) {
        let mut m = self.ws_count.lock().unwrap();
        if let Some(c) = m.get_mut(key) {
            if *c > 0 {
                *c -= 1;
            }
            if *c == 0 {
                m.remove(key);
            }
        }
    }

    /// Réinitialise tous les compteurs (au kick remote / changement de mot de
    /// passe — les tokens étant invalidés, les compteurs par token n'ont plus de
    /// sens ; on purge aussi le login pour repartir propre).
    pub fn reset_all(&self) {
        self.prompt.lock().unwrap().clear();
        self.ws_count.lock().unwrap().clear();
        // On conserve l'historique login (liée à l'IP, pas au token) pour ne pas
        // offrir une fenêtre de brute-force au moment d'une révocation.
    }
}