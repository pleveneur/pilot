// telegram.rs — Passerelle Telegram (bot officiel), ÉTAPE 1 : ENVOI + ÉTAPE 2
// (lot 0) : SOCLE D'ÉCOUTE.
//
// Objectif : prévenir le propriétaire sur Telegram quand Pilot a quelque chose
// à lui dire (fin de tâche d'un agent, anomalie d'agent bloqué, arrêt
// automatique d'une session), et LIRE ce que le propriétaire écrit à son bot
// (les questions/réponses de l'assistant seront branchées dans un lot suivant :
// ici on livre uniquement le socle, la réception filtrée et son curseur).
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

    /// URL `getUpdates` du bot, à partir du curseur donné. ATTENTION : elle
    /// contient le jeton ; ne jamais la journaliser, l'afficher ni la
    /// persister. `timeout=0` → l'appel est NON bloquant (l'interface interroge
    /// à intervalle court, elle ne doit jamais rester suspendue).
    pub fn api_updates_url(&self, offset: i64) -> String {
        format!(
            "{}/bot{}/getUpdates?offset={}&timeout=0",
            TELEGRAM_API_BASE,
            self.token.trim(),
            offset
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
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
    });
    http_post_json(url, &body).map(|_| ())
}

/// POST JSON générique vers l'API Telegram (sendMessage, editMessageText,
/// answerCallbackQuery…). Délais courts, `without_url` pour ne jamais exposer le
/// jeton dans un message d'erreur.
fn http_post_json(url: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("client http: {}", e.without_url()))?;
    let resp = client
        .post(url)
        .json(body)
        .send()
        .map_err(|e| format!("réseau: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("API Telegram: HTTP {}", resp.status().as_u16()));
    }
    resp.json::<serde_json::Value>()
        .map_err(|e| format!("réponse illisible: {}", e))
}

// ── ÉTAPE 2 (lot 2) : QUESTIONS À BOUTONS NATIFS ────────────────────────────
//
// Les options d'une question sont envoyées sous forme de BOUTONS télégrammes
// (clavier « inline ») : le propriétaire répond d'un appui, sans recopier un
// numéro. L'identifiant du message est renvoyé pour pouvoir le MODIFIER ensuite
// (retrait des boutons + « déjà répondu », lot 4).

/// Un bouton de question : libellé visible + charge utile de rappel (`data`),
/// renvoyée telle quelle par Telegram quand le bouton est pressé. L'API borne
/// cette charge utile à 64 OCTETS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelegramButton {
    pub text: String,
    pub data: String,
}

/// Longueur maximale (en OCTETS) de la charge utile d'un bouton (limite API).
pub const MAX_CALLBACK_BYTES: usize = 64;

/// Résultat d'un envoi qui renvoie l'identifiant du message créé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelegramSendOutcome {
    /// Rien tenté : passerelle inerte ou texte vide.
    Inert(&'static str),
    /// Message accepté ; `Some(id)` permet de le modifier plus tard.
    Sent(Option<i64>),
    /// Échec (jeton retiré, jamais remonté).
    Failed(String),
}

/// Construit le clavier « inline » : UN bouton par ligne (plus lisible sur
/// mobile). Les boutons sans libellé ou dont la charge utile dépasse 64 OCTETS
/// sont ÉCARTÉS (défense en profondeur ; l'appelant les borne déjà).
/// Fonction PURE.
pub fn inline_keyboard_json(buttons: &[TelegramButton]) -> Vec<serde_json::Value> {
    buttons
        .iter()
        .filter(|b| !b.text.trim().is_empty() && b.data.len() <= MAX_CALLBACK_BYTES)
        .map(|b| serde_json::json!([{ "text": b.text.trim(), "callback_data": b.data }]))
        .collect()
}

/// Cœur sans I/O de l'envoi d'une question À BOUTONS (transport INJECTÉ, comme
/// `dispatch` : les tests n'atteignent jamais le réseau). Sans bouton
/// exploitable, la question part en texte simple (sans clavier).
pub fn dispatch_buttons<P>(
    cfg: &TelegramConfig,
    text: &str,
    buttons: &[TelegramButton],
    post: P,
) -> TelegramSendOutcome
where
    P: FnOnce(&str, &serde_json::Value) -> Result<serde_json::Value, String>,
{
    if let Some(reason) = cfg.inert_reason() {
        return TelegramSendOutcome::Inert(reason);
    }
    let cleaned = clean_text(text);
    if cleaned.is_empty() {
        return TelegramSendOutcome::Inert("message vide");
    }
    let keyboard = inline_keyboard_json(buttons);
    let mut body = serde_json::json!({
        "chat_id": cfg.chat_id.trim(),
        "text": cleaned,
        "disable_web_page_preview": true,
    });
    if !keyboard.is_empty() {
        body["reply_markup"] = serde_json::json!({ "inline_keyboard": keyboard });
    }
    match post(&cfg.api_url(), &body) {
        Ok(resp) => TelegramSendOutcome::Sent(
            resp.pointer("/result/message_id").and_then(|v| v.as_i64()),
        ),
        Err(e) => TelegramSendOutcome::Failed(redact_token(&e, &cfg.token)),
    }
}

/// Bouton reçu de l'interface (désérialisé par Tauri).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TelegramButtonArg {
    pub text: String,
    pub data: String,
}

/// Accuse réception d'un appui de bouton (`answerCallbackQuery`) : défait la
/// barre de progression du client. Best-effort, silencieux, jeton jamais
/// journalisé (le message d'erreur est nettoyé par `http_post_json` + `redact`).
fn answer_callback(cfg: &TelegramConfig, callback_id: &str) {
    let url = format!(
        "{}/bot{}/answerCallbackQuery",
        TELEGRAM_API_BASE,
        cfg.token.trim()
    );
    let body = serde_json::json!({ "callback_query_id": callback_id });
    if let Err(e) = http_post_json(&url, &body) {
        eprintln!(
            "[telegram] accusé de réception d'appui ignoré : {}",
            redact_token(&e, &cfg.token)
        );
    }
}

/// Commande Tauri : publie une question AVEC boutons natifs et renvoie
/// l'identifiant du message (pour l'éditer ensuite). Ne renvoie JAMAIS d'erreur :
/// `status` vaut `sent` (message posé, `messageId` fourni quand l'API le rend),
/// `inert` (passerelle non configurée) ou `failed` (échec silencieux, journalisé
/// sans le jeton). Le repli éventuel (avis texte simple) est décidé par
/// l'appelant.
#[tauri::command]
pub fn telegram_send_buttons(
    app: AppHandle,
    text: String,
    buttons: Vec<TelegramButtonArg>,
) -> Result<serde_json::Value, String> {
    let Some(cfg) = read_gateway_config(&app) else {
        return Ok(serde_json::json!({ "status": "inert" }));
    };
    let buttons: Vec<TelegramButton> = buttons
        .into_iter()
        .map(|b| TelegramButton {
            text: b.text,
            data: b.data,
        })
        .collect();
    Ok(match dispatch_buttons(&cfg, &text, &buttons, http_post_json) {
        TelegramSendOutcome::Sent(Some(id)) => {
            serde_json::json!({ "status": "sent", "messageId": id })
        }
        // Message posé mais identifiant illisible : on ne fait PAS de repli (il
        // n'y aurait qu'un doublon) ; l'édition plus tard sera simplement omise.
        TelegramSendOutcome::Sent(None) => serde_json::json!({ "status": "sent" }),
        TelegramSendOutcome::Inert(_) => serde_json::json!({ "status": "inert" }),
        TelegramSendOutcome::Failed(e) => {
            eprintln!("[telegram] question à boutons refusée (ignorée) : {}", e);
            serde_json::json!({ "status": "failed" })
        }
    })
}

// ── ÉTAPE 2 (lot 4) : MISE À JOUR DU MESSAGE UNE FOIS RÉPONDU ──────────────
//
// La question répondue est RÉÉCRITE dans Telegram : les boutons sont RETIRÉS
// (clavier inline vide) et le texte porte la mention « déjà répondu ». Un échec
// de cette mise à jour est SILENCIEUX : l'affichage est un confort, il ne doit
// jamais perturber la conversation ni remonter à l'utilisateur.

/// Corps `editMessageText` : texte remplacé et clavier inline RETIRÉ (tableau
/// vide). Fonction PURE.
pub fn edit_text_body(cfg: &TelegramConfig, message_id: i64, text: &str) -> serde_json::Value {
    serde_json::json!({
        "chat_id": cfg.chat_id.trim(),
        "message_id": message_id,
        "text": clean_text(text),
        "reply_markup": { "inline_keyboard": [] },
    })
}

/// Cœur sans I/O de la mise à jour du message (transport INJECTÉ, comme
/// `dispatch_buttons`).
pub fn dispatch_edit<P>(
    cfg: &TelegramConfig,
    message_id: i64,
    text: &str,
    post: P,
) -> TelegramOutcome
where
    P: FnOnce(&str, &serde_json::Value) -> Result<serde_json::Value, String>,
{
    if let Some(reason) = cfg.inert_reason() {
        return TelegramOutcome::Inert(reason);
    }
    if message_id <= 0 {
        return TelegramOutcome::Inert("message inconnu");
    }
    let body = edit_text_body(cfg, message_id, text);
    if body["text"].as_str().unwrap_or("").is_empty() {
        return TelegramOutcome::Inert("message vide");
    }
    let url = format!(
        "{}/bot{}/editMessageText",
        TELEGRAM_API_BASE,
        cfg.token.trim()
    );
    match post(&url, &body) {
        Ok(_) => TelegramOutcome::Sent,
        Err(e) => TelegramOutcome::Failed(redact_token(&e, &cfg.token)),
    }
}

/// Commande Tauri : réécrit le message d'une question répondue. N'attend pas le
/// réseau (thread détaché) et ne renvoie JAMAIS d'erreur ; un échec n'est
/// consigné que d'une ligne, sans le jeton.
#[tauri::command]
pub fn telegram_edit_message(app: AppHandle, message_id: i64, text: String) -> Result<(), String> {
    let Some(cfg) = read_gateway_config(&app) else {
        return Ok(());
    };
    if !cfg.is_ready() || message_id <= 0 {
        return Ok(());
    }
    std::thread::spawn(move || {
        if let TelegramOutcome::Failed(e) = dispatch_edit(&cfg, message_id, &text, http_post_json) {
            eprintln!("[telegram] mise à jour du message ignorée : {}", e);
        }
    });
    Ok(())
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

// ── ÉTAPE 2 (lot 0) : SOCLE D'ÉCOUTE ────────────────────────────────────────
//
// Pilot peut LIRE les messages que le propriétaire écrit à son bot. Périmètre
// volontairement minimal (le branchement des questions de l'assistant viendra
// dans un lot suivant) :
//   - une réception `getUpdates` filtrée sur l'identifiant de discussion du
//     propriétaire ; tout autre expéditeur est ignoré SILENCIEUSEMENT (jamais
//     de réponse, jamais d'erreur) ;
//   - un curseur persistant (`dernier update_id + 1`) pour ne pas retraiter les
//     messages du propriétaire déjà remis (mémorisation best-effort : un échec
//     d'écriture fait relire le message à la passe suivante) ;
//   - une inertie STRICTEMENT identique à l'envoi (mêmes champs, mêmes règles) :
//     passerelle décochée ou champ vide → aucun accès réseau, aucune erreur.

/// Un message entrant RETENU (venant du propriétaire uniquement) : soit un
/// texte, soit l'appui sur un bouton d'une question (`callback_query`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    pub update_id: i64,
    /// Texte du message (vide pour un appui de bouton).
    pub text: String,
    /// Charge utile du bouton pressé (`callback_query.data`), vide sinon.
    pub callback_data: String,
    /// Identifiant à accuser réception (`callback_query.id`), vide sinon.
    pub callback_id: String,
}

/// Résultat d'une passe de réception.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundPoll {
    /// Messages du propriétaire, dans l'ordre reçu.
    pub messages: Vec<InboundMessage>,
    /// Curseur à mémoriser pour la prochaine passe (`dernier update_id + 1`).
    pub next_offset: i64,
    /// Motif d'inertie si la passerelle n'est pas utilisable.
    pub inert: Option<&'static str>,
}

/// Identifiant de discussion d'un objet `chat` Telegram, sous forme de chaîne
/// (l'API renvoie un nombre pour les personnes/groupes, une chaîne pour
/// certains canaux).
fn chat_id_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.trim().to_string()),
        _ => None,
    }
}

/// Cœur PUR de la réception : extrait d'une réponse `getUpdates` les messages
/// du PROPRIÉTAIRE, ignore silencieusement tout autre expéditeur (jamais de
/// réponse, jamais d'erreur), et calcule `next_offset` au-delà de TOUS les
/// updates reçus, y compris ceux des inconnus.
///
/// Nuance : c'est un curseur PROPOSÉ. L'interface commite `updateId + 1` après la
/// remise durable de chaque message du propriétaire, puis avance en fin de passe
/// jusqu'à `next_offset` (updates ÉCARTÉS compris) pour ne pas les relire
/// indéfiniment. En cas d'échec de remise, le curseur reste en arrière : un
/// message du propriétaire n'est donc jamais perdu (au plus remis deux fois si
/// l'écriture du curseur échoue, cf. sémantique « au moins une fois »).
/// Aucune I/O.
pub fn collect_inbound(
    cfg: &TelegramConfig,
    offset: i64,
    response: &serde_json::Value,
) -> InboundPoll {
    let owner = cfg.chat_id.trim();
    let mut messages = Vec::new();
    let mut next_offset = offset;
    if let Some(updates) = response.get("result").and_then(|v| v.as_array()) {
        for update in updates {
            let Some(update_id) = update.get("update_id").and_then(|v| v.as_i64()) else {
                continue;
            };
            if update_id + 1 > next_offset {
                next_offset = update_id + 1;
            }
            let message = update
                .get("message")
                .or_else(|| update.get("edited_message"));
            if message.is_none() {
                // Appui sur un bouton (étape 2, lot 3) : l'identité est filtrée
                // EXACTEMENT comme pour un message — seule la discussion du
                // propriétaire est retenue (`callback_query.message.chat.id`).
                if let Some(query) = update.get("callback_query") {
                    let chat_id = query
                        .get("message")
                        .and_then(|m| m.get("chat"))
                        .and_then(|c| c.get("id"))
                        .and_then(chat_id_string);
                    if chat_id.as_deref() == Some(owner) {
                        let data = query
                            .get("data")
                            .and_then(|v| v.as_str())
                            .map(|s| s.trim().to_string())
                            .unwrap_or_default();
                        let callback_id = query
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        // Charge utile vide : rien à interpréter (le curseur
                        // avance quand même).
                        if !data.is_empty() {
                            messages.push(InboundMessage {
                                update_id,
                                text: String::new(),
                                callback_data: data,
                                callback_id,
                            });
                        }
                    }
                }
                continue;
            }
            let message = message.unwrap();
            let chat_id = message
                .get("chat")
                .and_then(|c| c.get("id"))
                .and_then(chat_id_string);
            if chat_id.as_deref() != Some(owner) {
                // Expéditeur inconnu : ignoré silencieusement.
                continue;
            }
            let text = message
                .get("text")
                .and_then(|v| v.as_str())
                .or_else(|| message.get("caption").and_then(|v| v.as_str()))
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if text.is_empty() {
                continue;
            }
            messages.push(InboundMessage {
                update_id,
                text,
                callback_data: String::new(),
                callback_id: String::new(),
            });
        }
    }
    InboundPoll {
        messages,
        next_offset,
        inert: None,
    }
}

/// Cœur PUR d'une passe de réception, transport INJECTÉ (`fetch(url)`) — comme
/// `dispatch` pour l'envoi : les tests n'atteignent JAMAIS le réseau.
pub fn poll_inbound<S>(cfg: &TelegramConfig, offset: i64, fetch: S) -> Result<InboundPoll, String>
where
    S: FnOnce(&str) -> Result<serde_json::Value, String>,
{
    if let Some(reason) = cfg.inert_reason() {
        return Ok(InboundPoll {
            messages: Vec::new(),
            next_offset: offset,
            inert: Some(reason),
        });
    }
    match fetch(&cfg.api_updates_url(offset)) {
        Ok(response) => Ok(collect_inbound(cfg, offset, &response)),
        // Défense en profondeur : un message d'erreur ne porte jamais le jeton.
        Err(e) => Err(redact_token(&e, &cfg.token)),
    }
}

/// Réception réelle : GET `getUpdates`, délais courts, `without_url` pour ne
/// jamais exposer le jeton dans un message d'erreur.
fn http_get_updates(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|e| format!("client http: {}", e.without_url()))?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("réseau: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("API Telegram: HTTP {}", resp.status().as_u16()));
    }
    resp.json::<serde_json::Value>()
        .map_err(|e| format!("réponse illisible: {}", e))
}

/// Fichier du curseur de réception, rangé dans les données de l'application
/// (PAS dans les Paramètres : aucun réglage ajouté, rien à réécrire côté
/// interface).
const INBOUND_STATE_FILE: &str = "telegram_inbound_state.json";

fn inbound_state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(INBOUND_STATE_FILE))
}

/// Empreinte NON RÉVERSIBLE du jeton du bot (FNV-1a 64 bits, hexadécimal).
/// Elle permet de détecter un changement de bot SANS jamais écrire le jeton
/// dans le fichier d'état (le jeton reste uniquement dans les Paramètres).
fn token_fingerprint(token: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in token.trim().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Curseur contenu dans un état mémorisé, pour le jeton courant. `None` si
/// l'état est illisible, ou s'il ne porte pas l'empreinte de CE jeton (autre
/// bot, ou état écrit avant l'introduction de l'empreinte).
fn stored_offset(raw: &str, token: &str) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let fingerprint = value.get("token_fingerprint").and_then(|f| f.as_str())?;
    if fingerprint != token_fingerprint(token) {
        return None;
    }
    value.get("offset").and_then(|o| o.as_i64())
}

/// Lit le curseur mémorisé.
///
/// CAUSE : après un changement de jeton de bot, les identifiants d'updates du
/// nouveau bot repartent bas ; l'ancien curseur écarterait alors
/// SILENCIEUSEMENT tous ses messages. Le curseur est donc mémorisé avec
/// l'empreinte du jeton : si elle diffère du jeton courant (ou manque), le
/// curseur est oublié (retour à 0) et l'état est réécrit avec la nouvelle
/// empreinte. 0 également si l'état est absent (au premier lancement, aucun
/// fichier n'est créé avant la première remise).
fn read_inbound_offset(app: &AppHandle, token: &str) -> i64 {
    let Some(path) = inbound_state_path(app) else {
        return 0;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return 0;
    };
    match stored_offset(&raw, token) {
        Some(offset) => offset,
        None => {
            write_inbound_state(&path, token, 0);
            0
        }
    }
}

/// Mémorise le curseur et l'empreinte du jeton (silencieux : un échec
/// d'écriture n'interrompt rien).
fn write_inbound_offset(app: &AppHandle, token: &str, offset: i64) {
    let Some(path) = inbound_state_path(app) else {
        return;
    };
    write_inbound_state(&path, token, offset);
}

/// Écriture best-effort de l'état : jamais le jeton en clair, jamais d'erreur
/// visible. Un échec fait simplement relire/remettre le message (sémantique
/// « au moins une fois »).
fn write_inbound_state(path: &std::path::Path, token: &str, offset: i64) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let payload = serde_json::json!({
        "offset": offset,
        "token_fingerprint": token_fingerprint(token),
    })
    .to_string();
    let _ = std::fs::write(path, payload);
}

/// Commande Tauri : une passe de réception. Appelée à intervalle court par
/// l'interface (module `telegram-inbound.js`), INDÉPENDAMMENT de l'onglet 🧭.
///
/// - passerelle non configurée / décochée → `inert`, SANS accès réseau ;
/// - sinon → `getUpdates` filtré sur le propriétaire, messages renvoyés à
///   l'interface avec le curseur atteint ;
/// - un échec (réseau, API) est silencieux (`status: "error"`) : jamais
///   d'erreur visible, jamais de jeton dans le message.
///
/// Le curseur n'est PAS avancé ici : l'interface appelle `telegram_inbound_commit`
/// APRÈS la remise durable de chaque message à l'assistant, puis avance jusqu'au
/// dernier update VU (`nextOffset`, updates filtrés compris) en fin de passe.
/// Garantie : rien n'est perdu (un message non remis est relu à la passe
/// suivante, et le curseur ne saute jamais par-dessus). La mémorisation est en
/// revanche BEST-EFFORT (`write_inbound_offset` ignore un échec d'écriture) : si
/// elle échoue, le message est relu et remis une seconde fois (sémantique
/// « au moins une fois »).
#[tauri::command]
pub fn telegram_poll_inbound(app: AppHandle) -> Result<serde_json::Value, String> {
    let cfg = match read_gateway_config(&app) {
        Some(cfg) => cfg,
        None => {
            return Ok(serde_json::json!({
                "status": "inert",
                "reason": "configuration indisponible",
                "messages": [],
            }))
        }
    };
    let offset = read_inbound_offset(&app, &cfg.token);
    match poll_inbound(&cfg, offset, http_get_updates) {
        Ok(poll) => {
            if let Some(reason) = poll.inert {
                return Ok(serde_json::json!({
                    "status": "inert",
                    "reason": reason,
                    "messages": [],
                }));
            }
            // Accusé de réception des appuis de boutons (défait la barre de
            // progression du client Telegram) : best-effort et silencieux.
            for m in poll.messages.iter().filter(|m| !m.callback_id.is_empty()) {
                answer_callback(&cfg, &m.callback_id);
            }
            Ok(serde_json::json!({
                "status": "ok",
                "nextOffset": poll.next_offset,
                "messages": poll
                    .messages
                    .iter()
                    .map(|m| serde_json::json!({
                        "updateId": m.update_id,
                        "text": m.text,
                        "callbackData": m.callback_data,
                        "callbackId": m.callback_id,
                    }))
                    .collect::<Vec<_>>(),
            }))
        }
        Err(e) => {
            eprintln!("[telegram] réception impossible (ignorée) : {}", e);
            Ok(serde_json::json!({ "status": "error", "messages": [] }))
        }
    }
}

/// Commande Tauri : mémorise le curseur de réception après remise réussie d'un
/// message à l'assistant (accusé de lecture du côté de l'interface). Monotone :
/// le curseur ne recule jamais, même si un appel tardif portait une valeur plus
/// petite. EXCEPTION voulue : si le jeton a changé, le curseur repart de 0
/// (cf. `read_inbound_offset`). Silencieux (aucune erreur visible). Sans
/// configuration, il n'y a pas d'empreinte à mémoriser : rien n'est écrit (le
/// message sera relu — sémantique « au moins une fois »).
#[tauri::command]
pub fn telegram_inbound_commit(app: AppHandle, offset: i64) -> Result<(), String> {
    if let Some(cfg) = read_gateway_config(&app) {
        if offset > read_inbound_offset(&app, &cfg.token) {
            write_inbound_offset(&app, &cfg.token, offset);
        }
    }
    Ok(())
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

    // ── Étape 2 (lot 0) : socle d'écoute ──

    fn updates_json(updates: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "ok": true, "result": updates })
    }

    #[test]
    fn updates_url_uses_get_updates_with_cursor() {
        let cfg = ready();
        assert_eq!(
            cfg.api_updates_url(41),
            "https://api.telegram.org/bot123456:ABC-DEF/getUpdates?offset=41&timeout=0"
        );
    }

    #[test]
    fn inbound_keeps_owner_message_and_ignores_stranger() {
        let cfg = ready(); // propriétaire = 4242
        let response = updates_json(serde_json::json!([
            { "update_id": 10, "message": { "chat": { "id": 9999 }, "text": "inconnu" } },
            { "update_id": 11, "message": { "chat": { "id": 4242 }, "text": "  bonjour Pilot  " } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert_eq!(poll.messages.len(), 1, "un seul expéditeur retenu");
        assert_eq!(poll.messages[0].update_id, 11);
        assert_eq!(poll.messages[0].text, "bonjour Pilot");
        // Le curseur avance AUSSI sur l'update de l'inconnu (sinon il serait relu).
        assert_eq!(poll.next_offset, 12);
        assert_eq!(poll.inert, None);
    }

    #[test]
    fn inbound_cursor_prevents_reprocessing() {
        let cfg = ready();
        let batch = updates_json(serde_json::json!([
            { "update_id": 7, "message": { "chat": { "id": 4242 }, "text": "premier" } },
        ]));
        let first = poll_inbound(&cfg, 0, move |url: &str| {
            assert!(url.contains("offset=0"), "première passe depuis 0 : {url}");
            Ok(batch.clone())
        })
        .unwrap();
        assert_eq!(first.messages.len(), 1);
        assert_eq!(first.next_offset, 8);

        // Seconde passe : on repart du curseur mémorisé → le faux Telegram ne
        // renvoie plus l'update déjà consommé.
        let second = poll_inbound(&cfg, first.next_offset, |url: &str| {
            assert!(url.contains("offset=8"), "seconde passe depuis le curseur : {url}");
            Ok(updates_json(serde_json::json!([])))
        })
        .unwrap();
        assert!(second.messages.is_empty(), "aucun doublon");
        assert_eq!(second.next_offset, 8, "curseur stable sans nouvel update");
    }

    #[test]
    fn inbound_inert_when_disabled_never_touches_network() {
        let cfg = TelegramConfig {
            enabled: false,
            ..ready()
        };
        let poll = poll_inbound(&cfg, 5, |_| panic!("aucun accès réseau attendu")).unwrap();
        assert_eq!(poll.inert, Some("passerelle désactivée"));
        assert!(poll.messages.is_empty());
        assert_eq!(poll.next_offset, 5, "curseur inchangé");
    }

    #[test]
    fn inbound_inert_when_token_or_chat_missing_never_touches_network() {
        let no_token = TelegramConfig {
            token: "  ".to_string(),
            ..ready()
        };
        let p1 = poll_inbound(&no_token, 3, |_| panic!("aucun accès réseau attendu")).unwrap();
        assert_eq!(p1.inert, Some("jeton du bot absent"));
        assert_eq!(p1.next_offset, 3);

        let no_chat = TelegramConfig {
            chat_id: String::new(),
            ..ready()
        };
        let p2 = poll_inbound(&no_chat, 3, |_| panic!("aucun accès réseau attendu")).unwrap();
        assert_eq!(p2.inert, Some("identifiant de discussion absent"));
        assert_eq!(p2.next_offset, 3);
    }

    #[test]
    fn inbound_active_gateway_calls_fetch_with_cursor() {
        let cfg = ready();
        let response = updates_json(serde_json::json!([
            { "update_id": 3, "message": { "chat": { "id": 4242 }, "text": "salut" } },
        ]));
        let poll = poll_inbound(&cfg, 2, move |url: &str| {
            assert!(url.ends_with("/bot123456:ABC-DEF/getUpdates?offset=2&timeout=0"));
            Ok(response.clone())
        })
        .unwrap();
        assert_eq!(poll.messages.len(), 1);
        assert_eq!(poll.messages[0].text, "salut");
        assert_eq!(poll.next_offset, 4);
        assert_eq!(poll.inert, None);
    }

    #[test]
    fn inbound_error_never_leaks_token() {
        let cfg = ready();
        // Un faux transport qui recrache l'URL (donc le jeton), comme le ferait
        // le message d'une bibliothèque HTTP.
        let err = poll_inbound(&cfg, 0, |url: &str| Err(format!("réseau: {url}"))).unwrap_err();
        assert!(!err.contains("123456:ABC-DEF"), "jeton divulgué : {err}");
        assert!(err.contains("***"));
    }

    #[test]
    fn inbound_skips_messages_without_text() {
        let cfg = ready();
        let response = updates_json(serde_json::json!([
            { "update_id": 1, "message": { "chat": { "id": 4242 } } },
            { "update_id": 2, "message": { "chat": { "id": 4242 }, "caption": "légende" } },
            { "update_id": 3, "my_chat_member": {} },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert_eq!(poll.messages.len(), 1, "seul le message porteur de texte est retenu");
        assert_eq!(poll.messages[0].text, "légende");
        assert_eq!(poll.next_offset, 4);
    }

    #[test]
    fn inbound_matches_string_chat_id() {
        let cfg = TelegramConfig {
            chat_id: "  @moncanal  ".to_string(),
            ..ready()
        };
        let response = updates_json(serde_json::json!([
            { "update_id": 1, "message": { "chat": { "id": "@moncanal" }, "text": "ok" } },
            { "update_id": 2, "message": { "chat": { "id": "@autre" }, "text": "non" } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert_eq!(poll.messages.len(), 1);
        assert_eq!(poll.messages[0].text, "ok");
    }

    // ── Étape 2 (lot 1) : une réponse ne peut venir QUE du propriétaire ──

    #[test]
    fn inbound_stranger_cannot_answer_pending_question() {
        // Un inconnu qui répondrait « 1 » (numéro d'option valide) ne doit
        // JAMAIS être remonté : il ne peut donc pas répondre à une question de
        // l'assistant. Silencieux, sans alerte.
        let cfg = ready(); // propriétaire = 4242
        let response = updates_json(serde_json::json!([
            { "update_id": 20, "message": { "chat": { "id": 9999 }, "text": "1" } },
            { "update_id": 21, "message": { "chat": { "id": 9999 }, "text": "oui, vas-y" } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert!(poll.messages.is_empty(), "aucun message d'inconnu remonté");
        assert_eq!(poll.next_offset, 22, "le curseur avance sans rien remettre");
        assert_eq!(poll.inert, None);
    }

    // ── Étape 2 (lot 3) : appuis de bouton (mêmes règles d'identité) ──

    #[test]
    fn inbound_keeps_owner_callback_press() {
        let cfg = ready();
        let poll = collect_inbound(
            &cfg,
            0,
            &serde_json::json!({
                "ok": true,
                "result": [{
                    "update_id": 30,
                    "callback_query": {
                        "id": "cb-1",
                        "data": "q1:0",
                        "message": { "chat": { "id": 4242 }, "message_id": 9 },
                    },
                }],
            }),
        );
        assert_eq!(poll.messages.len(), 1);
        assert_eq!(poll.messages[0].callback_data, "q1:0");
        assert_eq!(poll.messages[0].callback_id, "cb-1");
        assert_eq!(poll.messages[0].text, "", "un appui n'est pas un texte");
        assert_eq!(poll.next_offset, 31);
    }

    #[test]
    fn inbound_stranger_callback_press_is_ignored() {
        // Même filtre d'identité que pour les messages : seule la discussion du
        // propriétaire est retenue. Un inconnu ne peut donc pas répondre.
        let cfg = ready(); // propriétaire = 4242
        let response = updates_json(serde_json::json!([
            { "update_id": 40, "callback_query": {
                "id": "cb-9", "data": "q1:0", "message": { "chat": { "id": 9999 } } } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert!(poll.messages.is_empty(), "appui d'un inconnu non remonté");
        assert_eq!(poll.next_offset, 41, "le curseur avance sans rien remettre");
    }

    #[test]
    fn inbound_skips_callback_with_empty_payload() {
        let cfg = ready();
        let response = updates_json(serde_json::json!([
            { "update_id": 50, "callback_query": {
                "id": "cb-2", "message": { "chat": { "id": 4242 } } } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert!(poll.messages.is_empty(), "rien à interpréter");
        assert_eq!(poll.next_offset, 51);
    }

    #[test]
    fn inbound_keeps_message_and_callback_in_order() {
        let cfg = ready();
        let response = updates_json(serde_json::json!([
            { "update_id": 60, "message": { "chat": { "id": 4242 }, "text": "bonjour" } },
            { "update_id": 61, "callback_query": {
                "id": "cb-3", "data": "q1:1", "message": { "chat": { "id": 4242 } } } },
        ]));
        let poll = collect_inbound(&cfg, 0, &response);
        assert_eq!(poll.messages.len(), 2);
        assert_eq!(poll.messages[0].text, "bonjour");
        assert_eq!(poll.messages[1].callback_data, "q1:1");
        assert_eq!(poll.next_offset, 62);
    }

    // ── Étape 2 (lot 4) : mise à jour du message après réponse ──

    #[test]
    fn edit_text_body_removes_inline_keyboard() {
        let cfg = ready();
        let body = edit_text_body(&cfg, 321, "✅ Déjà répondu");
        assert_eq!(body["chat_id"], "4242");
        assert_eq!(body["message_id"], 321);
        assert_eq!(body["text"], "✅ Déjà répondu");
        assert_eq!(
            body["reply_markup"]["inline_keyboard"].as_array().unwrap().len(),
            0,
            "clavier inline retiré"
        );
    }

    #[test]
    fn dispatch_edit_targets_edit_endpoint_and_never_leaks_token() {
        let cfg = ready();
        let outcome = dispatch_edit(&cfg, 321, "✅ Déjà répondu", |url, body| {
            assert!(url.ends_with("/bot123456:ABC-DEF/editMessageText"));
            assert_eq!(body["message_id"], 321);
            assert_eq!(body["reply_markup"]["inline_keyboard"].as_array().unwrap().len(), 0);
            Err(format!("réseau: {url}"))
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
    fn dispatch_edit_inert_never_touches_network() {
        let disabled = TelegramConfig {
            enabled: false,
            ..ready()
        };
        assert_eq!(
            dispatch_edit(&disabled, 5, "texte", |_, _| panic!("aucun réseau attendu")),
            TelegramOutcome::Inert("passerelle désactivée")
        );
        // Message sans identifiant : rien à réécrire (aucun appel réseau).
        assert_eq!(
            dispatch_edit(&ready(), 0, "texte", |_, _| panic!("aucun réseau attendu")),
            TelegramOutcome::Inert("message inconnu")
        );
        assert_eq!(
            dispatch_edit(&ready(), 5, "   ", |_, _| panic!("aucun réseau attendu")),
            TelegramOutcome::Inert("message vide")
        );
    }

    // ── Curseur d'écoute : le jeton du bot a changé ──

    #[test]
    fn token_fingerprint_is_stable_hex_and_never_the_token() {
        let fp = token_fingerprint("123456:ABC-DEF");
        assert_eq!(fp.len(), 16, "empreinte FNV-1a 64 bits en hex");
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!fp.contains("ABC-DEF"), "le jeton n'apparaît jamais");
        assert_ne!(fp, token_fingerprint("123457:ABC-DEF"), "deux jetons diffèrent");
        assert_eq!(fp, token_fingerprint("  123456:ABC-DEF  "), "jeton rogné");
    }

    #[test]
    fn offset_restarts_from_zero_when_token_change_and_is_kept_when_same() {
        let path = std::env::temp_dir().join(format!(
            "pilot-telegram-state-{}-{:?}.json",
            std::process::id(),
            std::thread::current().id()
        ));
        write_inbound_state(&path, "ancien:jeton", 41);
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("ancien:jeton"), "jeton jamais écrit en clair");
        // Même jeton → curseur conservé.
        assert_eq!(stored_offset(&raw, "ancien:jeton"), Some(41));
        // Autre jeton → aucun curseur retenu (repart de 0).
        assert_eq!(stored_offset(&raw, "nouveau:jeton"), None);
        // État d'une version antérieure (sans empreinte) → idem : repart de 0.
        assert_eq!(stored_offset(r#"{"offset":7}"#, "nouveau:jeton"), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn inbound_without_config_cannot_answer_pending_question() {
        // Interrupteur décoché ou champ vide : aucune tentative réseau, donc
        // aucune réponse possible — inertie totale et silencieuse.
        let disabled = TelegramConfig {
            enabled: false,
            ..ready()
        };
        let p = poll_inbound(&disabled, 9, |_| panic!("aucun accès réseau attendu")).unwrap();
        assert!(p.messages.is_empty());
        assert_eq!(p.next_offset, 9);
        assert_eq!(p.inert, Some("passerelle désactivée"));
    }

    // ── Étape 2 (lot 2) : questions à boutons natifs ──

    fn bouton(text: &str, data: &str) -> TelegramButton {
        TelegramButton {
            text: text.to_string(),
            data: data.to_string(),
        }
    }

    #[test]
    fn inline_keyboard_puts_one_button_per_row() {
        let rows = inline_keyboard_json(&[bouton("A", "q1:0"), bouton("B", "q1:1")]);
        assert_eq!(rows.len(), 2, "un bouton par ligne");
        assert_eq!(rows[0][0]["text"], "A");
        assert_eq!(rows[0][0]["callback_data"], "q1:0");
        assert_eq!(rows[1][0]["callback_data"], "q1:1");
    }

    #[test]
    fn inline_keyboard_drops_empty_labels_and_oversized_payloads() {
        let gros = "x".repeat(MAX_CALLBACK_BYTES + 1);
        let rows = inline_keyboard_json(&[
            bouton("   ", "q1:0"),
            bouton("ok", &gros),
            bouton("valide", "q1:1"),
        ]);
        assert_eq!(rows.len(), 1, "seul le bouton exploitable est retenu");
        assert_eq!(rows[0][0]["callback_data"], "q1:1");
        // Borne : 64 OCTETS acceptés, 65 rejetés.
        let limite = "y".repeat(MAX_CALLBACK_BYTES);
        assert_eq!(inline_keyboard_json(&[bouton("ok", &limite)]).len(), 1);
    }

    #[test]
    fn dispatch_buttons_sends_markup_and_returns_message_id() {
        let cfg = ready();
        let posted = Arc::new(Mutex::new(Vec::<(String, serde_json::Value)>::new()));
        let sink = posted.clone();
        let outcome = dispatch_buttons(
            &cfg,
            "❓ Approche ?",
            &[bouton("A", "q1:0"), bouton("B", "q1:1")],
            move |url, body| {
                sink.lock().unwrap().push((url.to_string(), body.clone()));
                Ok(serde_json::json!({ "ok": true, "result": { "message_id": 321 } }))
            },
        );
        assert_eq!(outcome, TelegramSendOutcome::Sent(Some(321)));
        let calls = posted.lock().unwrap();
        assert!(calls[0].0.ends_with("/bot123456:ABC-DEF/sendMessage"));
        assert_eq!(calls[0].1["chat_id"], "4242");
        assert_eq!(calls[0].1["reply_markup"]["inline_keyboard"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn dispatch_buttons_without_usable_buttons_omits_markup() {
        let cfg = ready();
        let outcome = dispatch_buttons(&cfg, "❓ Quel nom ?", &[], |_, body| {
            assert!(body.get("reply_markup").is_none(), "aucun clavier vide envoyé");
            Ok(serde_json::json!({ "ok": true, "result": { "message_id": 7 } }))
        });
        assert_eq!(outcome, TelegramSendOutcome::Sent(Some(7)));
    }

    #[test]
    fn dispatch_buttons_inert_never_touches_network() {
        let cfg = TelegramConfig {
            enabled: false,
            ..ready()
        };
        assert_eq!(
            dispatch_buttons(&cfg, "❓ Q ?", &[bouton("A", "q1:0")], |_, _| panic!(
                "aucun accès réseau attendu"
            )),
            TelegramSendOutcome::Inert("passerelle désactivée")
        );
        assert_eq!(
            dispatch_buttons(&ready(), "   ", &[bouton("A", "q1:0")], |_, _| panic!(
                "aucun accès réseau attendu"
            )),
            TelegramSendOutcome::Inert("message vide")
        );
    }

    #[test]
    fn dispatch_buttons_failure_never_leaks_token() {
        let cfg = ready();
        let outcome = dispatch_buttons(&cfg, "❓ Q ?", &[bouton("A", "q1:0")], |url, _| {
            Err(format!("réseau: {url}"))
        });
        match outcome {
            TelegramSendOutcome::Failed(msg) => {
                assert!(!msg.contains("123456:ABC-DEF"), "jeton divulgué : {msg}");
                assert!(msg.contains("***"));
            }
            other => panic!("attendu Failed, obtenu {other:?}"),
        }
    }
}
