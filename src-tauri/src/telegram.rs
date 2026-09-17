// telegram.rs — Passerelle Telegram (bot officiel), ÉTAPE 1 : ENVOI uniquement.
//
// Objectif : prévenir le propriétaire sur Telegram quand Pilot a quelque chose
// à lui dire (fin de tâche d'un agent, anomalie d'agent bloqué, arrêt
// automatique d'une session). La RÉCEPTION des messages (répondre à Pilot
// depuis Telegram) n'est PAS prise en charge à cette étape.
//
// Contrat (spec_telegram.md) :
//   - STRICTEMENT INERTE si la passerelle est désactivée ou mal configurée
//     (jeton ou identifiant de discussion vide) : rien n'est tenté, aucune
//     erreur visible, aucun réseau touché ;
//   - un envoi ne bloque JAMAIS l'interface (thread détaché, délais courts) ;
//   - un échec est silencieux (au plus une ligne de journal) et n'interrompt
//     jamais l'action en cours ;
//   - le JETON n'est jamais journalisé, affiché ni écrit dans un fichier ; il
//     est retiré de tout message d'erreur (défense en profondeur) ;
//   - aucune dépendance ajoutée : on réutilise `reqwest::blocking` (déjà
//     présent pour le Context Engine).
//
// Le cœur de la décision (`dispatch`) reçoit son « envoyeur » par injection :
// les tests n'atteignent donc JAMAIS le réseau.

use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Base de l'API « bot » de Telegram.
pub const TELEGRAM_API_BASE: &str = "https://api.telegram.org";

/// Longueur maximale du texte envoyé, exprimée en CARACTÈRES (l'API Telegram
/// refuse au-delà de 4096 ; on garde une marge confortable pour les emojis et
/// les caractères composés).
pub const MAX_TEXT_CHARS: usize = 3500;

/// Délais courts : l'envoi est un arrière-plan de confort, il ne doit jamais
/// retenir un thread longtemps.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(5);

/// Configuration minimale de la passerelle, extraite de `AppConfig`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelegramConfig {
    pub enabled: bool,
    pub token: String,
    pub chat_id: String,
}

/// Résultat d'une tentative d'envoi. Aucun variant ne porte de secret : un
/// `Failed` ne peut pas contenir le jeton (nettoyé par `dispatch`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelegramOutcome {
    /// Rien à faire : passerelle désactivée ou mal configurée. La raison est
    /// destinée au diagnostic local (jamais transmise à l'utilisateur).
    Inert(&'static str),
    /// Message accepté par l'API.
    Sent,
    /// Échec (réseau, refus de l'API) : consigné sans le jeton, jamais remonté.
    Failed(String),
}

impl TelegramConfig {
    /// Construit la configuration depuis un `AppConfig` lu en mémoire.
    pub fn from_app_config(cfg: &crate::AppConfig) -> Self {
        Self {
            enabled: cfg.telegram_notify_enabled,
            token: cfg.telegram_bot_token.trim().to_string(),
            chat_id: cfg.telegram_chat_id.trim().to_string(),
        }
    }

    /// Motif d'inertie, ou `None` si la passerelle est utilisable.
    pub fn inert_reason(&self) -> Option<&'static str> {
        if !self.enabled {
            Some("passerelle désactivée")
        } else if self.token.trim().is_empty() {
            Some("jeton du bot absent")
        } else if self.chat_id.trim().is_empty() {
            Some("identifiant de discussion absent")
        } else {
            None
        }
    }

    /// Vrai si la passerelle peut envoyer.
    pub fn is_ready(&self) -> bool {
        self.inert_reason().is_none()
    }

    /// URL `sendMessage` du bot. ATTENTION : elle contient le jeton ; ne
    /// jamais la journaliser, l'afficher ni la persister.
    pub fn api_url(&self) -> String {
        format!(
            "{}/bot{}/sendMessage",
            TELEGRAM_API_BASE,
            self.token.trim()
        )
    }
}

/// Retire toute occurrence du jeton d'un message (défense en profondeur : un
/// message d'erreur — susceptible d'être journalisé — ne doit jamais contenir
/// le secret, même si la bibliothèque HTTP l'a inclus dans son erreur).
pub fn redact_token(message: &str, token: &str) -> String {
    let secret = token.trim();
    if secret.is_empty() {
        return message.to_string();
    }
    message.replace(secret, "***")
}

/// Prépare le texte avant envoi :
///   - retire les caractères de contrôle (y compris `\r`) et normalise les
///     fins de ligne ;
///   - compacte les suites de lignes vides (au plus une) ;
///   - rogne les espaces en tête/queue ;
///   - borne la longueur en CARACTÈRES (jamais au milieu d'un caractère
///     multi-octets), avec un `…` final quand on tronque.
///
/// Fonction pure et testable (aucune I/O).
pub fn clean_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_newlines = 0usize;
    for ch in text.chars() {
        if ch == '\r' {
            continue;
        }
        if ch == '\n' {
            pending_newlines += 1;
            if pending_newlines <= 2 {
                out.push('\n');
            }
            continue;
        }
        pending_newlines = 0;
        if ch == '\t' {
            out.push('\t');
            continue;
        }
        // Autres caractères de contrôle (NUL, bell, séquences ANSI…).
        if ch.is_control() {
            continue;
        }
        out.push(ch);
    }

    let trimmed = out.trim();
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        let mut s: String = trimmed
            .chars()
            .take(MAX_TEXT_CHARS.saturating_sub(1))
            .collect();
        s.push('…');
        s
    } else {
        trimmed.to_string()
    }
}

/// Cœur de la passerelle, sans I/O : décide (inerte ou non), prépare le texte,
/// puis délègue l'envoi à `send` (injecté — les tests passent un faux envoyeur
/// qui n'atteint jamais le réseau).
///
/// `send(url, chat_id, text) -> Result<(), String>`
pub fn dispatch<S>(cfg: &TelegramConfig, text: &str, send: S) -> TelegramOutcome
where
    S: FnOnce(&str, &str, &str) -> Result<(), String>,
{
    if let Some(reason) = cfg.inert_reason() {
        return TelegramOutcome::Inert(reason);
    }
    let cleaned = clean_text(text);
    if cleaned.is_empty() {
        return TelegramOutcome::Inert("message vide");
    }
    match send(&cfg.api_url(), cfg.chat_id.trim(), &cleaned) {
        Ok(()) => TelegramOutcome::Sent,
        // Le jeton peut apparaître dans l'erreur d'un client HTTP (URL) : on le
        // retire systématiquement avant de la conserver.
        Err(e) => TelegramOutcome::Failed(redact_token(&e, &cfg.token)),
    }
}

/// Envoyeur réel : POST JSON `sendMessage` via `reqwest::blocking`, délais
/// courts. Le message d'erreur n'inclut jamais l'URL (`without_url`) afin de ne
/// pas exposer le jeton.
fn http_send(url: &str, chat_id: &str, text: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("client http: {}", e.without_url()))?;
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
    });
    let resp = client
        .post(url)
        .json(&body)
        .send()
        .map_err(|e| format!("réseau: {}", e.without_url()))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("API Telegram: HTTP {}", resp.status().as_u16()))
    }
}

/// Consigne le résultat sans jamais écrire le jeton. Volontairement discret :
/// un état inerte ne produit AUCUNE trace (c'est le cas normal et silencieux).
fn log_outcome(outcome: &TelegramOutcome) {
    match outcome {
        TelegramOutcome::Sent => eprintln!("[telegram] avis envoyé au propriétaire."),
        TelegramOutcome::Inert(_) => {}
        TelegramOutcome::Failed(e) => {
            eprintln!("[telegram] envoi impossible (ignoré) : {}", e)
        }
    }
}

/// Lit la configuration courante SANS jamais la réécrire (aucune valeur par
/// défaut persistée, cf. lot 3-bis) et sans bloquer l'appelant.
fn read_gateway_config(app: &AppHandle) -> Option<TelegramConfig> {
    let state = app.try_state::<crate::AppState>()?;
    crate::ensure_config_loaded(&state.config, || crate::load_config_disk(app));
    let cfg = crate::get_config_read(&state.config, app).ok()?;
    Some(TelegramConfig::from_app_config(&cfg))
}

/// Point d'entrée de l'envoi : entièrement en arrière-plan.
///
/// - passerelle inerte → on ne lance même pas de thread et on ne touche pas au
///   réseau ;
/// - sinon → thread détaché (fire-and-forget), délais courts, erreurs avalées.
pub fn notify_background(app: &AppHandle, text: String) {
    let cfg = match read_gateway_config(app) {
        Some(cfg) => cfg,
        None => return,
    };
    if !cfg.is_ready() {
        return;
    }
    std::thread::spawn(move || {
        let outcome = dispatch(&cfg, &text, http_send);
        log_outcome(&outcome);
    });
}

/// Commande Tauri : transmet un avis à la passerelle Telegram.
///
/// Appelée « fire-and-forget » depuis l'interface (`invoke(...).catch(...)`) :
/// elle rend la main immédiatement. Ne renvoie jamais d'erreur — un avis non
/// envoyé ne doit rien casser côté appelant.
#[tauri::command]
pub fn telegram_notify(app: AppHandle, text: String) {
    notify_background(&app, text);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Avis de FIN DE TÂCHE (forme produite par l'interface).
    const DONE_TEXT: &str = "Pilot — Agent terminé — ✅ L'agent a terminé.";
    /// Avis d'ALERTE (anomalie / arrêt automatique).
    const ALERT_TEXT: &str = "Pilot — Anomalie détectée — ⚠️ Un agent semble bloqué.";

    fn ready() -> TelegramConfig {
        TelegramConfig {
            enabled: true,
            token: "123456:ABC-DEF".to_string(),
            chat_id: "4242".to_string(),
        }
    }

    /// Faux envoyeur : enregistre les appels, ne touche jamais le réseau.
    #[derive(Clone, Default)]
    struct FakeSender {
        calls: Arc<Mutex<Vec<(String, String, String)>>>,
    }

    impl FakeSender {
        fn sender(&self) -> impl FnOnce(&str, &str, &str) -> Result<(), String> {
            let calls = self.calls.clone();
            move |url: &str, chat_id: &str, text: &str| {
                calls
                    .lock()
                    .unwrap()
                    .push((url.to_string(), chat_id.to_string(), text.to_string()));
                Ok(())
            }
        }

        fn recorded(&self) -> Vec<(String, String, String)> {
            self.calls.lock().unwrap().clone()
        }
    }

    // ── Inertie (aucun envoi, aucune erreur) ──

    #[test]
    fn inert_when_disabled_never_calls_sender() {
        let cfg = TelegramConfig {
            enabled: false,
            ..ready()
        };
        assert_eq!(
            dispatch(&cfg, DONE_TEXT, |_, _, _| panic!("envoi interdit")),
            TelegramOutcome::Inert("passerelle désactivée")
        );
    }

    #[test]
    fn inert_when_token_missing_never_calls_sender() {
        let cfg = TelegramConfig {
            token: "   ".to_string(),
            ..ready()
        };
        assert!(!cfg.is_ready());
        assert_eq!(
            dispatch(&cfg, DONE_TEXT, |_, _, _| panic!("envoi interdit")),
            TelegramOutcome::Inert("jeton du bot absent")
        );
    }

    #[test]
    fn inert_when_chat_id_missing_never_calls_sender() {
        let cfg = TelegramConfig {
            chat_id: "".to_string(),
            ..ready()
        };
        assert_eq!(
            dispatch(&cfg, ALERT_TEXT, |_, _, _| panic!("envoi interdit")),
            TelegramOutcome::Inert("identifiant de discussion absent")
        );
    }

    #[test]
    fn inert_when_text_empty_or_whitespace() {
        let cfg = ready();
        assert_eq!(
            dispatch(&cfg, "", |_, _, _| panic!("envoi interdit")),
            TelegramOutcome::Inert("message vide")
        );
        assert_eq!(
            dispatch(&cfg, "  \n\n \t ", |_, _, _| panic!("envoi interdit")),
            TelegramOutcome::Inert("message vide")
        );
    }

    // ── Envoi quand la passerelle est active ──

    #[test]
    fn active_gateway_forwards_done_notice_and_alert() {
        let cfg = ready();
        let fake = FakeSender::default();
        assert_eq!(dispatch(&cfg, DONE_TEXT, fake.sender()), TelegramOutcome::Sent);
        assert_eq!(dispatch(&cfg, ALERT_TEXT, fake.sender()), TelegramOutcome::Sent);

        let calls = fake.recorded();
        assert_eq!(calls.len(), 2, "un envoi par avis");
        // URL construite à partir du jeton, jamais journalisée côté test.
        assert!(calls[0].0.ends_with("/bot123456:ABC-DEF/sendMessage"));
        assert_eq!(calls[0].1, "4242");
        assert_eq!(calls[0].2, DONE_TEXT);
        assert_eq!(calls[1].2, ALERT_TEXT);
    }

    #[test]
    fn active_gateway_sends_cleaned_text() {
        let cfg = ready();
        let fake = FakeSender::default();
        dispatch(&cfg, "ligne 1\r\n\r\n\r\nligne 2\u{0007}", fake.sender());
        let calls = fake.recorded();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].2, "ligne 1\n\nligne 2");
    }

    #[test]
    fn active_gateway_trims_config_values() {
        let cfg = TelegramConfig {
            enabled: true,
            token: "  tok  ".to_string(),
            chat_id: "  42  ".to_string(),
        };
        let fake = FakeSender::default();
        assert_eq!(dispatch(&cfg, DONE_TEXT, fake.sender()), TelegramOutcome::Sent);
        let calls = fake.recorded();
        assert_eq!(calls[0].0, "https://api.telegram.org/bottok/sendMessage");
        assert_eq!(calls[0].1, "42");
    }

    // ── Nettoyage / encodage du texte ──

    #[test]
    fn clean_text_strips_control_chars_and_compacts_blank_lines() {
        assert_eq!(clean_text("a\r\nb"), "a\nb");
        assert_eq!(clean_text("a\n\n\n\nb"), "a\n\nb");
        assert_eq!(clean_text("a\u{0000}b\u{001b}[31mc"), "ab[31mc");
        assert_eq!(clean_text("  espaces  "), "espaces");
        assert_eq!(clean_text("\t tab conservé \t"), "tab conservé");
    }

    #[test]
    fn clean_text_keeps_unicode_and_emoji_intact() {
        let s = "✅ terminé — éàü 🚀 中文";
        assert_eq!(clean_text(s), s);
    }

    #[test]
    fn clean_text_truncates_at_char_boundary() {
        let long = "é".repeat(MAX_TEXT_CHARS + 500);
        let cleaned = clean_text(&long);
        // Borné en caractères, terminaison par « … ».
        assert_eq!(cleaned.chars().count(), MAX_TEXT_CHARS);
        assert!(cleaned.ends_with('…'));
        // Aucune coupure au milieu d'un caractère : le texte reste valide.
        assert!(cleaned.chars().all(|c| c == 'é' || c == '…'));
    }

    #[test]
    fn clean_text_of_max_length_is_not_truncated() {
        let exact = "a".repeat(MAX_TEXT_CHARS);
        let cleaned = clean_text(&exact);
        assert_eq!(cleaned, exact);
    }

    // ── Sécurité : le jeton ne fuit jamais ──

    #[test]
    fn failure_never_leaks_token_in_outcome() {
        let cfg = ready();
        // Un envoyeur qui recrache le jeton dans son erreur (comme le ferait le
        // message d'une bibliothèque HTTP citant l'URL).
        let outcome = dispatch(&cfg, DONE_TEXT, |url: &str, _, _| {
            Err(format!("erreur réseau pour {url}"))
        });
        match outcome {
            TelegramOutcome::Failed(msg) => {
                assert!(!msg.contains("123456:ABC-DEF"), "jeton divulgué : {msg}");
                assert!(msg.contains("***"));
            }
            other => panic!("attendu Failed, obtenu {other:?}"),
        }
    }

    #[test]
    fn redact_token_ignores_blank_token() {
        assert_eq!(redact_token("rien à cacher", "   "), "rien à cacher");
        assert_eq!(redact_token("secret ici", "secret"), "*** ici");
    }

    #[test]
    fn api_url_uses_official_send_message_endpoint() {
        let cfg = ready();
        assert_eq!(
            cfg.api_url(),
            "https://api.telegram.org/bot123456:ABC-DEF/sendMessage"
        );
    }
}
