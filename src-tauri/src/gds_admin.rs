// gds_admin.rs — Écran d'administration GDS du poste (refonte GDS, lot L4).
//
// L'onglet transverse « 🖥️ GDS Serveur » administre un serveur GDS **par son
// interface HTTP** : décision figée de la refonte, l'écran n'ouvre JAMAIS de
// connexion PostgreSQL directe sur la base du serveur. Ce module ne contient
// donc aucune requête SQL — uniquement des appels HTTP à l'API partagée du
// socle (`gds_core::http`, montée par `gds-server`), qui reste la seule
// autorité : rôles, audit et garde-fous (« dernier administrateur », rate
// limiting de connexion) sont appliqués côté serveur, jamais réimplémentés ici.
//
// Micro-tâches servies :
//   L4.2 — bloc « Connexion serveur » : test de connexion (joignabilité, compte
//          administrateur, état du serveur) et mémorisation des identifiants.
//   L4.3 — bloc « Comptes » : liste, création, rôle, statut, mot de passe.
//   (L4.4 à L4.6 viendront dans ce même module.)
//
// Règle constante : **le mot de passe n'est jamais renvoyé à l'UI**, ni
// journalisé. Il est saisi dans le formulaire, transmis à `users/login` sur le
// serveur, puis mémorisé (fichier de secrets 0600, entrée `admin_servers`
// SÉPARÉE des connexions projet — voir `gds::save_admin_credentials`) seulement
// après un test de connexion réussi. Les jetons de session obtenus restent
// internes au poste : les réponses des commandes ne contiennent que des données
// d'état (version, migrateur, volumes, compteurs, listes de comptes).

use serde_json::{json, Value};
use std::time::Duration;

// Vocabulaire des rôles / statuts et garde-fous : `gds_core::db` est l'unique
// source de vérité côté socle (le desk l'alias déjà en `gds_db`) — l'écran ne
// redéfinit ni la liste des rôles ni celle des statuts.
use gds_core::db as gds_db;

use crate::gds;

/// Port HTTP par défaut de l'API GDS (spec §2.5) : proposé quand l'utilisateur
/// laisse le champ « port » vide et que l'adresse n'en porte pas.
pub(crate) const DEFAULT_ADMIN_HTTP_PORT: &str = "8080";

/// Délai maximum d'un appel HTTP d'administration : l'écran doit rendre la main
/// avec un message clair plutôt que laisser l'utilisateur attendre.
const ADMIN_HTTP_TIMEOUT: Duration = Duration::from_secs(10);

// ─────────────────────────────────────────────────────────────────────────────
// Aides PURES (testables sans réseau, sans base, sans Tauri)
// ─────────────────────────────────────────────────────────────────────────────

/// Sépare `hôte:port` (le port doit être numérique). Renvoie l'hôte et le port
/// éventuel. `[::1]:8080` (IPv6 entre crochets) est séparé correctement.
fn split_host_port(s: &str) -> (String, Option<String>) {
    match s.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), Some(p.to_string()))
        }
        _ => (s.to_string(), None),
    }
}

/// Vrai si la chaîne est un port numérique utilisable (1..=65535). Pure.
fn is_valid_port(p: &str) -> bool {
    matches!(p.trim().parse::<u32>(), Ok(n) if n >= 1 && n <= 65535)
}

/// Construit l'URL de base de l'API HTTP du serveur depuis les champs de l'écran
/// (« adresse » + « port »). Pure.
///
/// * L'adresse peut déjà porter un schéma (`http://`, `https://`) ; sans schéma
///   on préfixe `http://` (le cas courant d'un serveur GDS sur réseau local).
/// * Le port du champ « port » prime ; sinon le port présent dans l'adresse ;
///   sinon [`DEFAULT_ADMIN_HTTP_PORT`].
pub(crate) fn admin_base_url(host: &str, http_port: &str) -> Result<String, String> {
    let raw = host.trim();
    if raw.is_empty() {
        return Err("Adresse du serveur GDS requise".to_string());
    }
    // Le schéma est retiré AVANT de nettoyer le slash final : sinon `http://`
    // deviendrait `http:` et ne ressemblerait plus à un schéma.
    let (scheme, rest) = if let Some(r) = raw.strip_prefix("https://") {
        ("https", r)
    } else if let Some(r) = raw.strip_prefix("http://") {
        ("http", r)
    } else {
        ("http", raw)
    };
    let rest = rest.trim_end_matches('/').trim();
    if rest.is_empty() {
        return Err("Adresse du serveur GDS invalide".to_string());
    }
    let (host_only, addr_port) = split_host_port(rest);
    if host_only.trim().is_empty() {
        return Err("Adresse du serveur GDS invalide".to_string());
    }
    let field_port = http_port.trim();
    let port = if !field_port.is_empty() {
        if !is_valid_port(field_port) {
            return Err(format!("Port invalide : {}", field_port));
        }
        field_port.to_string()
    } else {
        addr_port.unwrap_or_else(|| DEFAULT_ADMIN_HTTP_PORT.to_string())
    };
    Ok(format!("{}://{}:{}", scheme, host_only.trim(), port))
}

/// Message d'erreur lisible extrait d'une réponse HTTP du serveur : le champ
/// `error` du JSON s'il est présent (le serveur parle français), sinon un
/// message générique selon le code HTTP. Pure.
pub(crate) fn admin_error_message(status: u16, body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
            let e = e.trim();
            if !e.is_empty() {
                return e.to_string();
            }
        }
    }
    match status {
        400 => "Requête refusée par le serveur GDS".to_string(),
        401 => "Identifiants invalides".to_string(),
        403 => "Accès réservé à l'administrateur".to_string(),
        404 => "Route introuvable sur le serveur GDS".to_string(),
        409 => "Opération refusée par le serveur GDS".to_string(),
        429 => "Trop de tentatives. Réessayez dans 1 min.".to_string(),
        s if s >= 500 => format!("Erreur du serveur GDS (HTTP {})", s),
        s => format!("Réponse inattendue du serveur GDS (HTTP {})", s),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client HTTP
// ─────────────────────────────────────────────────────────────────────────────

/// Jetons de session d'administration gardés **en mémoire du poste** (clé : URL
/// de base + email). Ils évitent de rouvrir une session à chaque opération de
/// l'écran : le serveur limite les connexions (5 par minute et par IP, L2.4) et
/// l'écran « Comptes » enchaîne plusieurs actions (liste, création, rôle,
/// statut, mot de passe). Le jeton ne quitte **jamais** le poste : il n'est pas
/// renvoyé à l'interface, seulement réutilisé en en-tête `Authorization`.
static ADMIN_TOKENS: std::sync::Mutex<Vec<(String, String)>> =
    std::sync::Mutex::new(Vec::new());

/// Clé de cache d'une session (URL de base + email, insensible à la casse).
fn token_key(base: &str, email: &str) -> String {
    format!("{}|{}", base, email.trim().to_ascii_lowercase())
}

/// Verrou du cache, tolérant à l'empoisonnement (une panique d'un autre thread
/// ne doit pas rendre l'écran inutilisable).
fn lock_tokens() -> std::sync::MutexGuard<'static, Vec<(String, String)>> {
    ADMIN_TOKENS.lock().unwrap_or_else(|e| e.into_inner())
}

fn cached_token(key: &str) -> Option<String> {
    lock_tokens()
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, t)| t.clone())
}

fn store_token(key: &str, token: &str) {
    let mut guard = lock_tokens();
    guard.retain(|(k, _)| k != key);
    guard.push((key.to_string(), token.to_string()));
}

fn drop_token(key: &str) {
    lock_tokens().retain(|(k, _)| k != key);
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(ADMIN_HTTP_TIMEOUT)
        .build()
        .map_err(|e| format!("Client HTTP: {}", e))
}

/// Réponse brute d'un appel : (statut, corps). Aucun secret n'y figure (le corps
/// est celui du serveur, jamais la requête).
struct Reply {
    status: u16,
    body: String,
}

impl Reply {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
    fn error(&self) -> String {
        admin_error_message(self.status, &self.body)
    }
}

fn send_get(client: &reqwest::blocking::Client, url: &str, token: Option<&str>) -> Result<Reply, String> {
    let mut req = client.get(url);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().map_err(|e| format!("{}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().unwrap_or_default();
    Ok(Reply { status, body })
}

fn send_post_json(
    client: &reqwest::blocking::Client,
    url: &str,
    token: Option<&str>,
    payload: &Value,
) -> Result<Reply, String> {
    let mut req = client.post(url).json(payload);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().map_err(|e| format!("{}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().unwrap_or_default();
    Ok(Reply { status, body })
}

/// Mot de passe d'administration à employer : celui saisi s'il est non vide,
/// sinon celui mémorisé pour (hôte, email). Jamais renvoyé à l'appelant d'une
/// commande (usage strictement interne aux appels HTTP).
fn admin_password(host: &str, email: &str, provided: &str) -> String {
    // Le mot de passe est pris VERBATIM (jamais rogné : un espace peut en faire
    // partie) ; seul le cas « champ vide » déclenche le repli sur le mot de
    // passe mémorisé.
    if !provided.is_empty() {
        return provided.to_string();
    }
    gds::get_admin_credentials(host, email)
        .ok()
        .flatten()
        .and_then(|c| c.admin_password)
        .unwrap_or_default()
}

/// Ouvre une session administrateur : `users/login` puis contrôle du rôle via
/// la route d'administration. Renvoie `Ok((token, login_json))` ou
/// `Err(message lisible)`. Le mot de passe n'apparaît dans aucun message.
fn open_admin_session(
    client: &reqwest::blocking::Client,
    base: &str,
    email: &str,
    password: &str,
) -> Result<(String, Value), String> {
    let login = send_post_json(
        client,
        &format!("{}/api/gds/users/login", base),
        None,
        &json!({ "email": email, "password": password }),
    )?;
    if !login.ok() {
        return Err(login.error());
    }
    let login_json = login.json();
    let token = login_json
        .get("token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "Le serveur GDS n'a pas délivré de session".to_string())?;
    // Le rôle est vérifié en pratique par le serveur (403 sur route admin) : un
    // compte `dev` ne doit pas être accepté comme administrateur par l'écran.
    let probe = send_get(
        client,
        &format!("{}/api/gds/admin/server", base),
        Some(token),
    )?;
    if !probe.ok() {
        return Err(probe.error());
    }
    // Session utilisable : gardée en mémoire pour les opérations suivantes.
    store_token(&token_key(base, email), token);
    Ok((token.to_string(), login_json))
}

/// Exécute une opération d'administration authentifiée.
///
/// Réutilise la session en cache (elle évite de consommer le quota de
/// connexions du serveur) ; si elle est refusée (401 : serveur redémarré ou
/// session expirée), une seule reconnexion est tentée. `action` reçoit le
/// client HTTP, l'URL de base et le jeton de session — elle ne renvoie jamais le
/// jeton ni le mot de passe.
///
/// Renvoie **toujours** un objet JSON `{ ok, ... }` : `ok: false` avec un
/// `error` lisible pour tout échec attendu (identifiants, dernier
/// administrateur, serveur injoignable).
fn admin_action<F>(
    host: &str,
    http_port: &str,
    email: &str,
    password: &str,
    action: F,
) -> Value
where
    F: Fn(&reqwest::blocking::Client, &str, &str) -> Result<Reply, String>,
{
    let base = match admin_base_url(host, http_port) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let email = email.trim();
    if email.is_empty() {
        return json!({ "ok": false, "error": "Email administrateur requis" });
    }
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let key = token_key(&base, email);

    // 1. Session déjà ouverte pour ce serveur ?
    if let Some(token) = cached_token(&key) {
        match action(&client, &base, &token) {
            Ok(r) if r.ok() => return ok_value(r),
            // Session refusée → on oublie le jeton et on se reconnecte.
            Ok(r) if r.status == 401 => drop_token(&key),
            Ok(r) => return json!({ "ok": false, "error": r.error() }),
            Err(e) => {
                return json!({ "ok": false, "error": format!("Serveur GDS injoignable ({})", e) })
            }
        }
    }

    // 2. Nouvelle session (mot de passe saisi, sinon mémorisé).
    let pw = admin_password(host, email, password);
    if pw.is_empty() {
        return json!({ "ok": false, "error": "Mot de passe administrateur requis" });
    }
    let token = match open_admin_session(&client, &base, email, &pw) {
        Ok((t, _)) => t,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    match action(&client, &base, &token) {
        Ok(r) if r.ok() => ok_value(r),
        Ok(r) => json!({ "ok": false, "error": r.error() }),
        Err(e) => json!({ "ok": false, "error": format!("Serveur GDS injoignable ({})", e) }),
    }
}

/// Réponse d'action transformée en objet JSON `{ ok: true, ... }` (le corps du
/// serveur est repris tel quel — il ne contient jamais de secret).
fn ok_value(reply: Reply) -> Value {
    match reply.json() {
        Value::Object(mut map) => {
            map.insert("ok".to_string(), json!(true));
            Value::Object(map)
        }
        other => json!({ "ok": true, "result": other }),
    }
}

/// Exécute une opération d'administration hors du thread principal (les appels
/// HTTP sont bloquants) et renvoie son objet JSON.
async fn blocking_admin<F>(task: F) -> Result<Value, String>
where
    F: FnOnce() -> Value + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("Tâche d'administration: {}", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.3 — Comptes : charges utiles PURES (validées avant tout appel HTTP)
// ─────────────────────────────────────────────────────────────────────────────

/// Charge utile de création d'un compte (admin). L'email et le mot de passe
/// initial sont requis ; le rôle doit appartenir au vocabulaire du socle ; le
/// nom est facultatif.
///
/// Le mot de passe est pris **verbatim** (jamais rogné : un espace peut en faire
/// partie) et ne sort que dans le corps de la requête.
pub(crate) fn account_create_payload(
    email: &str,
    name: &str,
    role: &str,
    password: &str,
) -> Result<Value, String> {
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du compte requis".to_string());
    }
    if password.is_empty() {
        return Err("Mot de passe initial requis".to_string());
    }
    let role = role.trim();
    if !gds_db::is_known_role(role) {
        return Err(format!("Rôle inconnu : {}", role));
    }
    Ok(json!({
        "email": email,
        "name": name.trim(),
        "role": role,
        "password": password,
    }))
}

/// Charge utile de changement de rôle. Pure.
pub(crate) fn account_role_payload(email: &str, role: &str) -> Result<Value, String> {
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du compte requis".to_string());
    }
    let role = role.trim();
    if !gds_db::is_known_role(role) {
        return Err(format!("Rôle inconnu : {}", role));
    }
    Ok(json!({ "email": email, "role": role }))
}

/// Charge utile de changement de statut (`pending` | `active` | `disabled`).
/// Pure. Le refus du « dernier administrateur actif » (L3.2) est appliqué par le
/// **serveur** (409) : il n'est pas réimplémenté ici.
pub(crate) fn account_status_payload(email: &str, status: &str) -> Result<Value, String> {
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du compte requis".to_string());
    }
    let status = status.trim();
    if !gds_db::is_known_status(status) {
        return Err(format!("Statut inconnu : {}", status));
    }
    Ok(json!({ "email": email, "status": status }))
}

/// Charge utile de réinitialisation de mot de passe. Pure. Le mot de passe est
/// pris verbatim et n'apparaît dans aucune réponse.
pub(crate) fn account_password_payload(email: &str, password: &str) -> Result<Value, String> {
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du compte requis".to_string());
    }
    if password.is_empty() {
        return Err("Nouveau mot de passe requis".to_string());
    }
    Ok(json!({ "email": email, "password": password }))
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.2 — Test de connexion et état du serveur
// ─────────────────────────────────────────────────────────────────────────────

/// Teste la connexion au serveur GDS et renvoie un **état sans secret** :
/// joignabilité (route publique `health`), existence et rôle du compte
/// administrateur (login + route d'administration), état du serveur (version,
/// migration, compteurs, volumes, dernière entrée d'audit).
///
/// `password` vide → repli sur le mot de passe mémorisé pour (hôte, email).
/// Le résultat est toujours un objet JSON : `{ ok, reachable, error?, ... }`.
pub(crate) fn perform_admin_test(
    host: &str,
    http_port: &str,
    email: &str,
    password: &str,
) -> Value {
    let base = match admin_base_url(host, http_port) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "reachable": false, "error": e }),
    };
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "reachable": false, "error": e }),
    };
    // 1. Joignabilité : route PUBLIQUE (ne prouve pas encore les identifiants).
    let health = match send_get(&client, &format!("{}/api/gds/health", base), None) {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "reachable": false,
                "error": format!("Serveur GDS injoignable ({})", e),
            })
        }
    };
    if !health.ok() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": health.error(),
        });
    }
    let health = health.json();

    // 2. Identité administrateur : email + mot de passe (saisi ou mémorisé).
    let email = email.trim();
    if email.is_empty() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": "Email administrateur requis",
        });
    }
    let pw = admin_password(host, email, password);
    if pw.is_empty() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": "Mot de passe administrateur requis",
        });
    }
    let (token, login) = match open_admin_session(&client, &base, email, &pw) {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "reachable": true,
                "base_url": base,
                "error": e,
            })
        }
    };

    // 3. État serveur (route d'administration déjà sondée par la session).
    let admin = match send_get(&client, &format!("{}/api/gds/admin/server", base), Some(&token)) {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "reachable": true,
                "base_url": base,
                "error": format!("État du serveur indisponible ({})", e),
            })
        }
    };
    if !admin.ok() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": admin.error(),
        });
    }
    let admin = admin.json();

    // Aucun mot de passe, aucun jeton dans la réponse.
    json!({
        "ok": true,
        "reachable": true,
        "base_url": base,
        "email": login.get("email").cloned().unwrap_or(json!(email)),
        "role": login.get("role").cloned().unwrap_or(Value::Null),
        "version": health.get("version").cloned().unwrap_or(Value::Null),
        "migration_version": health.get("migration_version").cloned().unwrap_or(Value::Null),
        "uptime_seconds": health.get("uptime_seconds").cloned().unwrap_or(Value::Null),
        "users": health.get("users").cloned().unwrap_or(Value::Null),
        "projects": health.get("projects").cloned().unwrap_or(Value::Null),
        "git_repos": health.get("git_repos").cloned().unwrap_or(Value::Null),
        "repos_bytes": admin.get("repos_bytes").cloned().unwrap_or(Value::Null),
        "db_bytes": admin.get("db_bytes").cloned().unwrap_or(Value::Null),
        "last_audit": admin.get("last_audit").cloned().unwrap_or(Value::Null),
    })
}

/// Connexion d'un **compte utilisateur GDS** (fiche « identité utilisateur ») :
/// `GET /api/gds/health` (joignabilité) puis `POST /api/gds/users/login`.
///
/// Contraste avec `perform_admin_test` : **aucune** exigence de rôle — un
/// développeur ou un compte standard identifie parfaitement un serveur, et
/// l'écran d'administration garde sa propre garde. Aucun jeton ni mot de passe
/// ne sort d'ici : seul le rôle reconnu remonte (pour l'afficher sur la fiche).
pub(crate) fn perform_identity_login(
    host: &str,
    http_port: &str,
    email: &str,
    password: &str,
    user_key: &str,
) -> Value {
    let base = match admin_base_url(host, http_port) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "reachable": false, "error": e }),
    };
    let email = email.trim();
    if email.is_empty() {
        return json!({ "ok": false, "reachable": false, "error": "E-mail GDS requis" });
    }
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "reachable": false, "error": e }),
    };
    // 1. Joignabilité : route PUBLIQUE (aucun identifiant en jeu).
    let health = match send_get(&client, &format!("{}/api/gds/health", base), None) {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "reachable": false,
                "error": format!("Serveur GDS injoignable ({})", e),
            })
        }
    };
    if !health.ok() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": health.error(),
        });
    }
    // 2. Identité : mot de passe saisi, sinon celui mémorisé sous la clé donnée
    // (`user_key` = partie utilisateur de la fiche, qui n'est pas toujours
    // l'adresse pour une fiche héritée du compte technique).
    let pw = if !password.is_empty() {
        password.to_string()
    } else {
        gds::stored_gds_password(host, user_key)
            .or_else(|| gds::stored_gds_password(host, email))
            .unwrap_or_default()
    };
    if pw.is_empty() {
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": "Mot de passe GDS requis",
        });
    }
    let login = match send_post_json(
        &client,
        &format!("{}/api/gds/users/login", base),
        None,
        &json!({ "email": email, "password": pw }),
    ) {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "reachable": false,
                "error": format!("Connexion au serveur GDS impossible ({})", e),
            })
        }
    };
    if !login.ok() {
        let error = if login.status == 401 {
            "Adresse ou mot de passe refusé : vérifiez que ce compte GDS existe bien sur ce serveur."
                .to_string()
        } else {
            login.error()
        };
        return json!({
            "ok": false,
            "reachable": true,
            "base_url": base,
            "error": error,
        });
    }
    let login = login.json();
    json!({
        "ok": true,
        "reachable": true,
        "base_url": base,
        "email": login.get("email").cloned().unwrap_or(json!(email)),
        "role": login.get("role").cloned().unwrap_or(Value::Null),
    })
}

/// Commande Tauri : teste la connexion d'un **compte GDS** (fiche « identité
/// utilisateur »). Ne renvoie jamais le mot de passe ni le jeton ; le rôle
/// reconnu sert à l'afficher en langage simple (« administrateur »,
/// « développeur », « standard »).
#[tauri::command]
pub async fn gds_identity_login(
    host: String,
    http_port: String,
    email: String,
    password: String,
    user_key: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        perform_identity_login(&host, &http_port, &email, &password, &user_key)
    })
    .await
}

/// Commande Tauri : serveurs mémorisés pour l'écran d'administration (hôte, port
/// HTTP, email — **jamais** de mot de passe). Pré-remplit le bloc « Connexion
/// serveur » et évite de tout ressaisir.
#[tauri::command]
pub fn gds_admin_saved_servers() -> Vec<Value> {
    gds::list_admin_servers()
}

/// Commande Tauri : « Tester la connexion » (L4.2). N'enregistre rien : le
/// résultat n'inclut jamais le mot de passe. Exécutée hors du thread principal
/// (appel réseau bloquant), pour ne pas figer l'interface.
#[tauri::command]
pub async fn gds_admin_test_connection(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || perform_admin_test(&host, &http_port, &email, &password)).await
}

/// Commande Tauri : « Se connecter » — teste la connexion PUIS mémorise les
/// identifiants d'administration (entry `admin_servers`, séparée des connexions
/// projet) uniquement en cas de succès. Le mot de passe n'est jamais renvoyé.
#[tauri::command]
pub async fn gds_admin_connect(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let result = perform_admin_test(&host, &http_port, &email, &password);
        if result.get("ok") == Some(&json!(true)) {
            if let Err(e) = gds::save_admin_credentials(&host, &http_port, &email, &password) {
                return json!({
                    "ok": false,
                    "reachable": true,
                    "error": format!("Mémorisation des identifiants impossible: {}", e),
                });
            }
        }
        result
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.3 — Comptes : commandes Tauri
// ─────────────────────────────────────────────────────────────────────────────
//
// Toutes passent par les routes d'administration du serveur (`/api/gds/admin/
// users`), jamais par la base : le serveur applique la matrice des droits, le
// garde-fou « dernier administrateur actif » (409) et l'audit. Chaque commande
// renvoie un objet JSON `{ ok, ... }` **sans mot de passe ni jeton** ; le
// `email` / `password` attendus sont ceux du **compte administrateur** connecté
// dans le bloc « Connexion serveur » (mot de passe vide → repli sur le mot de
// passe mémorisé).

/// Commande Tauri (L4.3) : liste des comptes (id, email, nom, rôle, statut,
/// date de création).
#[tauri::command]
pub async fn gds_admin_accounts(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(
                client,
                &format!("{}/api/gds/admin/users", base),
                Some(token),
            )
        })
    })
    .await
}

/// Commande Tauri (L4.3) : création d'un compte (email + nom + rôle + mot de
/// passe initial). Le compte est créé **actif** par le serveur.
#[tauri::command]
pub async fn gds_admin_account_create(
    host: String,
    http_port: String,
    email: String,
    password: String,
    target_email: String,
    target_name: String,
    target_role: String,
    target_password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload =
            match account_create_payload(&target_email, &target_name, &target_role, &target_password)
            {
                Ok(p) => p,
                Err(e) => return json!({ "ok": false, "error": e }),
            };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

/// Commande Tauri (L4.3) : changement de rôle d'un compte.
#[tauri::command]
pub async fn gds_admin_account_set_role(
    host: String,
    http_port: String,
    email: String,
    password: String,
    target_email: String,
    target_role: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match account_role_payload(&target_email, &target_role) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users/role", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

/// Commande Tauri (L4.3) : (dés)activation d'un compte. Le refus de désactiver
/// le dernier administrateur actif vient du serveur (409) et remonte tel quel.
#[tauri::command]
pub async fn gds_admin_account_set_status(
    host: String,
    http_port: String,
    email: String,
    password: String,
    target_email: String,
    target_status: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match account_status_payload(&target_email, &target_status) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users/status", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

/// Commande Tauri (L4.3) : réinitialisation du mot de passe d'un compte.
#[tauri::command]
pub async fn gds_admin_account_set_password(
    host: String,
    http_port: String,
    email: String,
    password: String,
    target_email: String,
    target_password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match account_password_payload(&target_email, &target_password) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users/password", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.4 — Dépôts / projets : charges utiles PURES (validées avant tout appel HTTP)
// ─────────────────────────────────────────────────────────────────────────────

/// Valide un identifiant de projet reçu de l'écran (strictement positif). Pure.
fn valid_project_id(project_id: i64) -> Result<i64, String> {
    if project_id <= 0 {
        return Err("Projet invalide".to_string());
    }
    Ok(project_id)
}

/// Charge utile d'attribution d'un compte à un projet (par email, comme la
/// route L3.4). Le rôle dans le projet doit appartenir au vocabulaire du socle.
/// Pure : aucun appel réseau, aucune donnée sensible (jamais de mot de passe).
pub(crate) fn project_assign_payload(
    project_id: i64,
    email: &str,
    role: &str,
) -> Result<Value, String> {
    let project_id = valid_project_id(project_id)?;
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du développeur requis".to_string());
    }
    let role = role.trim();
    if !gds_db::is_known_role(role) {
        return Err(format!("Rôle inconnu : {}", role));
    }
    Ok(json!({ "project_id": project_id, "email": email, "role": role }))
}

/// Charge utile de retrait d'un compte d'un projet. Pure.
pub(crate) fn project_unassign_payload(project_id: i64, email: &str) -> Result<Value, String> {
    let project_id = valid_project_id(project_id)?;
    let email = email.trim();
    if email.is_empty() {
        return Err("Email du développeur requis".to_string());
    }
    Ok(json!({ "project_id": project_id, "email": email }))
}

/// Charge utile de retrait d'un projet du serveur. `purge` est **explicite** :
/// l'absence du drapeau vaut « ne rien détruire sur le disque ». Pure.
pub(crate) fn project_remove_payload(project_id: i64, purge: bool) -> Result<Value, String> {
    let project_id = valid_project_id(project_id)?;
    Ok(json!({ "project_id": project_id, "purge": purge }))
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.4 — Dépôts / projets : commandes Tauri
// ─────────────────────────────────────────────────────────────────────────────
//
// Toute la lecture (projets, dépôts, membres) et l'écriture (attribution,
// retrait, retrait purgé) passent par les routes HTTP du serveur : l'écran
// n'ouvre jamais de connexion PostgreSQL sur la base du projet actif. Le
// retrait purgé est destructif et n'est déclenché qu'après une confirmation
// explicite côté écran ; le serveur relit toujours la cible depuis sa base.

/// Commande Tauri (L4.4) : liste des projets du serveur (`GET /api/gds/projects`).
#[tauri::command]
pub async fn gds_admin_projects(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(client, &format!("{}/api/gds/projects", base), Some(token))
        })
    })
    .await
}

/// Commande Tauri (L4.4) : liste des dépôts git du serveur
/// (`GET /api/gds/git-repos`).
#[tauri::command]
pub async fn gds_admin_git_repos(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(client, &format!("{}/api/gds/git-repos", base), Some(token))
        })
    })
    .await
}

/// Commande Tauri (L4.4) : membres attribués à un projet
/// (`GET /api/gds/admin/projects/members?project_id=N`).
#[tauri::command]
pub async fn gds_admin_project_members(
    host: String,
    http_port: String,
    email: String,
    password: String,
    project_id: i64,
) -> Result<Value, String> {
    blocking_admin(move || {
        if let Err(e) = valid_project_id(project_id) {
            return json!({ "ok": false, "error": e });
        }
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(
                client,
                &format!("{}/api/gds/admin/projects/members?project_id={}", base, project_id),
                Some(token),
            )
        })
    })
    .await
}

/// Commande Tauri (L4.4) : attribue un compte (email) à un projet
/// (`POST /api/gds/admin/projects/assign`). C'est ce qui donne à un
/// développeur non administrateur le droit de voir le projet.
#[tauri::command]
pub async fn gds_admin_project_assign(
    host: String,
    http_port: String,
    email: String,
    password: String,
    project_id: i64,
    target_email: String,
    target_role: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match project_assign_payload(project_id, &target_email, &target_role) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/projects/assign", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

/// Commande Tauri (L4.4) : retire l'attribution d'un compte à un projet
/// (`POST /api/gds/admin/projects/unassign`). Le développeur perd aussitôt le
/// droit de voir le projet.
#[tauri::command]
pub async fn gds_admin_project_unassign(
    host: String,
    http_port: String,
    email: String,
    password: String,
    project_id: i64,
    target_email: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match project_unassign_payload(project_id, &target_email) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/projects/unassign", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

/// Commande Tauri (L4.4) : retire un projet du serveur
/// (`POST /api/gds/admin/projects/remove`). `purge = true` supprime aussi le
/// dépôt bare ; c'est destructif et réservé à une confirmation explicite.
#[tauri::command]
pub async fn gds_admin_project_remove(
    host: String,
    http_port: String,
    email: String,
    password: String,
    project_id: i64,
    purge: bool,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match project_remove_payload(project_id, purge) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/projects/remove", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.5 — Espace utilisé + journal + clés SSH (charges utiles pures)
// ─────────────────────────────────────────────────────────────────────────────

/// Encode un texte pour l'insérer dans une query string (pure, testable).
/// Percent-encodage minimal conforme : les caractères non réservés passent tels
/// quels, tous les autres deviennent `%XX`.
pub(crate) fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Query string de consultation du journal d'audit (pure, testable).
/// `scope` est ramené à « admin » (défaut) ou « all » ; `limit` est borné à 200
/// comme côté serveur ; `q` n'est ajouté que s'il est non vide.
pub(crate) fn build_audit_query(offset: usize, limit: usize, scope: &str, q: &str) -> String {
    let scope = match scope.trim().to_lowercase().as_str() {
        "all" | "tout" => "all",
        _ => "admin",
    };
    let mut s = format!(
        "?offset={}&limit={}&scope={}",
        offset,
        limit.clamp(1, 200),
        scope
    );
    let text = q.trim();
    if !text.is_empty() {
        s.push_str(&format!("&q={}", pct_encode(text)));
    }
    s
}

/// Charge utile de révocation d'une clef SSH. L'identifiant doit être
/// strictement positif (pure, testable).
pub(crate) fn ssh_key_revoke_payload(id: i64) -> Result<Value, String> {
    if id <= 0 {
        return Err("Clef invalide".to_string());
    }
    Ok(json!({ "id": id }))
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.5 — Espace utilisé + journal + clés SSH : commandes Tauri
// ─────────────────────────────────────────────────────────────────────────────
//
// Lecture seule de l'état serveur (volumes + dernière entrée d'audit), du
// journal d'audit paginé et de la liste des clefs SSH ; écriture limitée à la
// RÉVOCATION d'une clef (le serveur régénère alors `authorized_keys`). Tout
// passe par les routes HTTP du serveur : aucune connexion PostgreSQL directe.

/// Commande Tauri (L4.5) : état serveur administrateur, dont l'espace occupé
/// par les dépôts et la base (`GET /api/gds/admin/server`).
#[tauri::command]
pub async fn gds_admin_server(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(client, &format!("{}/api/gds/admin/server", base), Some(token))
        })
    })
    .await
}

/// Commande Tauri (L4.5) : journal d'audit paginé et filtré
/// (`GET /api/gds/admin/audit`). `scope` = « admin » (défaut) ou « all ».
#[tauri::command]
pub async fn gds_admin_audit(
    host: String,
    http_port: String,
    email: String,
    password: String,
    offset: Option<u32>,
    limit: Option<u32>,
    scope: Option<String>,
    search: Option<String>,
) -> Result<Value, String> {
    blocking_admin(move || {
        let qs = build_audit_query(
            offset.unwrap_or(0) as usize,
            limit.unwrap_or(50) as usize,
            &scope.unwrap_or_default(),
            &search.unwrap_or_default(),
        );
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(
                client,
                &format!("{}/api/gds/admin/audit{}", base, qs),
                Some(token),
            )
        })
    })
    .await
}

/// Commande Tauri (L4.5) : liste des clefs SSH autorisées, avec leur
/// propriétaire (`GET /api/gds/admin/ssh-keys`).
#[tauri::command]
pub async fn gds_admin_ssh_keys(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(client, &format!("{}/api/gds/admin/ssh-keys", base), Some(token))
        })
    })
    .await
}

/// Commande Tauri (L4.5) : révoque une clef SSH
/// (`POST /api/gds/admin/ssh-keys/revoke`). Le serveur régénère immédiatement
/// `authorized_keys` : la révocation est effective côté `sshd` sans attendre.
#[tauri::command]
pub async fn gds_admin_ssh_key_revoke(
    host: String,
    http_port: String,
    email: String,
    password: String,
    key_id: i64,
) -> Result<Value, String> {
    blocking_admin(move || {
        let payload = match ssh_key_revoke_payload(key_id) {
            Ok(p) => p,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/ssh-keys/revoke", base),
                Some(token),
                &payload,
            )
        })
    })
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// L4.6 — Actions de service (redémarrer / arrêter) : commandes Tauri
// ─────────────────────────────────────────────────────────────────────────────
//
// Les routes serveur (`GET /api/gds/admin/service`, `POST …/restart`,
// `POST …/stop`) sont celles de L2.10 ; elles sont réservées au rôle `admin` et
// tracées dans l'audit du socle. Aucune connexion PostgreSQL directe ici.
//
// La sonde de santé est **publique** (`GET /api/gds/health`) : un redémarrage du
// service invalide les sessions en mémoire côté serveur, donc re-tester la santé
// avec un jeton ferait conclure à tort que le serveur ne répond plus. La sonde
// n'envoie donc AUCUN en-tête `Authorization` et ne demande aucun identifiant.

/// Sonde de santé **publique** : `GET /api/gds/health`, sans jeton. Pure vis-à-vis
/// de l'état du poste (aucun cache de session consulté ni écrit).
///
/// Renvoie toujours un objet JSON : `{ ok: true, version, … }` si le service
/// répond, sinon `{ ok: false, error }` — c'est ce que l'écran interroge en boucle
/// après un redémarrage (retour de la santé) ou un arrêt (santé injoignable).
pub(crate) fn probe_public_health(host: &str, http_port: &str) -> Value {
    let base = match admin_base_url(host, http_port) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    match send_get(&client, &format!("{}/api/gds/health", base), None) {
        Ok(r) if r.ok() => ok_value(r),
        Ok(r) => json!({ "ok": false, "error": r.error() }),
        Err(e) => json!({ "ok": false, "error": format!("Serveur GDS injoignable ({})", e) }),
    }
}

/// Commande Tauri (L4.6) : état du service (PID du processus qui répond et état
/// des programmes pilotés), `GET /api/gds/admin/service` — réservée au rôle
/// `admin` par le serveur.
#[tauri::command]
pub async fn gds_admin_service_status(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_get(client, &format!("{}/api/gds/admin/service", base), Some(token))
        })
    })
    .await
}

/// Commande Tauri (L4.6) : `POST /api/gds/admin/service/restart` — redémarre
/// `gds-server` et `sshd` (la base PostgreSQL n'est jamais touchée). L'ordre est
/// différé côté serveur ; l'écran suit ensuite la santé publique.
#[tauri::command]
pub async fn gds_admin_service_restart(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/service/restart", base),
                Some(token),
                &json!({}),
            )
        })
    })
    .await
}

/// Commande Tauri (L4.6) : `POST /api/gds/admin/service/stop` — arrête
/// `gds-server` et `sshd` (la base PostgreSQL continue de répondre).
#[tauri::command]
pub async fn gds_admin_service_stop(
    host: String,
    http_port: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    blocking_admin(move || {
        admin_action(&host, &http_port, &email, &password, |client, base, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/service/stop", base),
                Some(token),
                &json!({}),
            )
        })
    })
    .await
}

/// Commande Tauri (L4.6) : santé **publique** (`GET /api/gds/health`), sans
/// identifiant. Sert au re-test automatique après un redémarrage (retour de la
/// santé) et à la constatation d'un arrêt (santé injoignable).
#[tauri::command]
pub async fn gds_admin_health(host: String, http_port: String) -> Result<Value, String> {
    blocking_admin(move || probe_public_health(&host, &http_port)).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — aides pures, parcours HTTP réel sur un faux serveur local
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn status_text(code: u16) -> &'static str {
        match code {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            409 => "Conflict",
            429 => "Too Many Requests",
            _ => "Internal Server Error",
        }
    }

    /// Faux serveur HTTP local : répond selon le chemin demandé, journalise
    /// chaque requête (méthode, chemin, en-tête Authorization, corps) dans
    /// `requests`. Renvoie l'URL de base `http://127.0.0.1:<port>`.
    fn spawn_fake_server(
        routes: Vec<(&'static str, u16, String)>,
        requests: Arc<Mutex<Vec<String>>>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = match stream {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    continue;
                }
                let mut content_length = 0usize;
                let mut auth = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let trimmed = line.trim_end();
                    if trimmed.is_empty() {
                        break;
                    }
                    let lower = trimmed.to_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        content_length = v.trim().parse().unwrap_or(0);
                    }
                    if let Some(v) = lower.strip_prefix("authorization:") {
                        auth = v.trim().to_string();
                    }
                }
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    let _ = reader.read_exact(&mut body);
                }
                let body = String::from_utf8_lossy(&body).to_string();
                let method = first.split_whitespace().next().unwrap_or("").to_string();
                let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
                requests.lock().unwrap().push(format!(
                    "{} {} auth={} body={}",
                    method, path, auth, body
                ));
                let (status, resp_body) = routes
                    .iter()
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, s, b)| (*s, b.clone()))
                    .unwrap_or((404, "{\"error\":\"not found\"}".to_string()));
                let resp = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    status_text(status),
                    resp_body.len(),
                    resp_body
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }

    /// Découpe une URL de base de test en (hôte, port) pour la passer aux
    /// fonctions comme le ferait l'UI (champs séparés).
    fn host_port(base: &str) -> (String, String) {
        let rest = base.strip_prefix("http://").unwrap_or(base);
        let (h, p) = split_host_port(rest);
        (h, p.unwrap_or_default())
    }

    #[test]
    fn admin_base_url_builds_scheme_and_port() {
        assert_eq!(
            admin_base_url("192.168.1.10", "8080").unwrap(),
            "http://192.168.1.10:8080"
        );
        // Sans port : 8080 par défaut ; le schéma https est conservé.
        assert_eq!(
            admin_base_url("https://gds.example.com", "").unwrap(),
            "https://gds.example.com:8080"
        );
        // Port déjà présent dans l'adresse.
        assert_eq!(
            admin_base_url("http://host:9090", "").unwrap(),
            "http://host:9090"
        );
        // Le champ « port » prime sur le port de l'adresse.
        assert_eq!(
            admin_base_url("host:1234", "5678").unwrap(),
            "http://host:5678"
        );
        // Espaces et slash final tolérés.
        assert_eq!(admin_base_url(" host/ ", " 7000 ").unwrap(), "http://host:7000");
        // IPv6 entre crochets.
        assert_eq!(admin_base_url("[::1]", "8080").unwrap(), "http://[::1]:8080");
        // Adresse vide ou port non numérique → message clair.
        assert!(admin_base_url("", "8080").is_err());
        assert!(admin_base_url("   ", "").is_err());
        assert!(admin_base_url("http://", "8080").is_err());
        assert!(admin_base_url("host", "abc").is_err());
        assert!(admin_base_url("host", "0").is_err());
    }

    #[test]
    fn admin_error_message_prefers_server_error_field() {
        assert_eq!(
            admin_error_message(401, "{\"error\":\"Identifiants invalides\"}"),
            "Identifiants invalides"
        );
        assert_eq!(
            admin_error_message(
                409,
                "{\"error\":\"Impossible de désactiver le dernier administrateur actif\"}"
            ),
            "Impossible de désactiver le dernier administrateur actif"
        );
        // Corps non JSON → message générique selon le statut.
        assert_eq!(admin_error_message(401, "not json"), "Identifiants invalides");
        assert_eq!(admin_error_message(403, ""), "Accès réservé à l'administrateur");
        assert_eq!(
            admin_error_message(429, ""),
            "Trop de tentatives. Réessayez dans 1 min."
        );
        assert_eq!(
            admin_error_message(404, ""),
            "Route introuvable sur le serveur GDS"
        );
        assert!(admin_error_message(500, "").contains("500"));
        assert!(admin_error_message(418, "").contains("418"));
    }

    #[test]
    fn perform_identity_login_accepts_any_role_and_never_exposes_a_secret() {
        // Lot 1 : le test de la fiche « compte GDS » accepte un rôle NON admin
        // (contrairement à l'écran d'administration) et ne renvoie ni mot de
        // passe ni jeton.
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"1.2.3\"}".to_string()),
                (
                    "/api/gds/users/login",
                    200,
                    json!({"ok": true, "email": "dev@x", "role": "dev", "token": "tok-dev"})
                        .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v = perform_identity_login(&host, &port, "dev@x", "pw-secret", "dev@x");
        assert_eq!(v["ok"], json!(true), "connexion attendue OK: {}", v);
        assert_eq!(v["role"], json!("dev"));
        assert_eq!(v["email"], json!("dev@x"));
        assert_eq!(v["reachable"], json!(true));
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "mot de passe exposé: {}", text);
        assert!(!text.contains("tok-dev"), "jeton exposé: {}", text);
        // Aucune route d'administration n'est appelée : le rôle importe peu.
        let log = reqs.lock().unwrap().join("\n");
        assert!(!log.contains("/api/gds/admin"), "journal: {}", log);
    }

    #[test]
    fn perform_identity_login_wrong_password_reports_clean_message() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"1\"}".to_string()),
                (
                    "/api/gds/users/login",
                    401,
                    "{\"error\":\"Identifiants invalides\"}".to_string(),
                ),
            ],
            reqs,
        );
        let (host, port) = host_port(&base);
        let v = perform_identity_login(&host, &port, "dev@x", "mauvais", "dev@x");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["reachable"], json!(true));
        assert_eq!(
            v["error"],
            json!(
                "Adresse ou mot de passe refusé : vérifiez que ce compte GDS existe bien sur ce serveur."
            )
        );
        assert!(!v.to_string().contains("mauvais"));
    }

    #[test]
    fn perform_identity_login_uses_the_password_memorized_on_the_fiche() {
        // Parcours réel du bouton « Tester » d'une fiche mémorisée : le champ
        // mot de passe est vide, le secret vient du fichier de la fiche.
        let _guard = gds::TestGdsSecretsGuard::new();
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"1\"}".to_string()),
                (
                    "/api/gds/users/login",
                    200,
                    json!({"ok": true, "email": "dev@x", "role": "admin", "token": "t"})
                        .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        gds::save_gds_identity(&host, "pilot", &port, "dev@x", "memo-pw", "").unwrap();
        // `user_key` = clé de la fiche (« pilot », fiche héritée complétée) : le
        // mot de passe mémorisé est retrouvé même si l'e-mail diffère.
        let v = perform_identity_login(&host, &port, "dev@x", "", "pilot");
        assert_eq!(v["ok"], json!(true), "résultat: {}", v);
        assert_eq!(v["role"], json!("admin"));
        assert!(reqs.lock().unwrap().join("\n").contains("memo-pw"));
        // Sans mot de passe saisi NI mémorisé : message clair, aucun appel réseau.
        let none = perform_identity_login(&host, &port, "autre@x", "", "autre@x");
        assert_eq!(none["ok"], json!(false));
        assert!(none["error"].as_str().unwrap().contains("Mot de passe GDS requis"));
    }

    #[test]
    fn perform_admin_test_success_returns_state_without_any_secret() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                (
                    "/api/gds/health",
                    200,
                    json!({
                        "version": "1.2.3",
                        "migration_version": 9,
                        "uptime_seconds": 12,
                        "users": 3,
                        "projects": 2,
                        "git_repos": 2
                    })
                    .to_string(),
                ),
                (
                    "/api/gds/users/login",
                    200,
                    json!({"ok": true, "email": "admin@x", "role": "admin", "token": "tok123"})
                        .to_string(),
                ),
                (
                    "/api/gds/admin/server",
                    200,
                    json!({
                        "repos_bytes": 4096,
                        "db_bytes": 2048,
                        "last_audit": {"action": "login"}
                    })
                    .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v = perform_admin_test(&host, &port, "admin@x", "pw-secret");
        assert_eq!(v["ok"], json!(true), "connexion attendue OK: {}", v);
        assert_eq!(v["version"], json!("1.2.3"));
        assert_eq!(v["migration_version"], json!(9));
        assert_eq!(v["users"], json!(3));
        assert_eq!(v["git_repos"], json!(2));
        assert_eq!(v["repos_bytes"], json!(4096));
        assert_eq!(v["db_bytes"], json!(2048));
        assert_eq!(v["role"], json!("admin"));
        assert_eq!(v["email"], json!("admin@x"));
        // PREUVE : aucun secret dans la réponse (ni mot de passe, ni jeton).
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "mot de passe exposé: {}", text);
        assert!(!text.contains("tok123"), "jeton de session exposé: {}", text);
        assert!(
            !text.to_lowercase().contains("password"),
            "champ mot de passe exposé: {}",
            text
        );
        // Le mot de passe a bien été transmis AU SERVEUR (et pas mémorisé ici).
        let log = reqs.lock().unwrap().join("\n");
        assert!(
            log.contains("pw-secret"),
            "le mot de passe doit être envoyé au serveur"
        );
        // Le jeton est bien utilisé en Bearer pour la route d'administration.
        assert!(log.contains("auth=bearer tok123"), "journal: {}", log);
    }

    #[test]
    fn perform_admin_test_wrong_password_reports_clean_message() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"1.2.3\"}".to_string()),
                (
                    "/api/gds/users/login",
                    401,
                    "{\"error\":\"Identifiants invalides\"}".to_string(),
                ),
            ],
            reqs,
        );
        let (host, port) = host_port(&base);
        let v = perform_admin_test(&host, &port, "admin@x", "mauvais");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["reachable"], json!(true));
        assert_eq!(v["error"], json!("Identifiants invalides"));
        let text = v.to_string();
        assert!(!text.contains("mauvais"));
    }

    #[test]
    fn perform_admin_test_without_admin_role_is_refused() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"1\"}".to_string()),
                (
                    "/api/gds/users/login",
                    200,
                    "{\"ok\":true,\"email\":\"dev@x\",\"role\":\"dev\",\"token\":\"t\"}"
                        .to_string(),
                ),
                (
                    "/api/gds/admin/server",
                    403,
                    "{\"error\":\"Réservé à l'administrateur\"}".to_string(),
                ),
            ],
            reqs,
        );
        let (host, port) = host_port(&base);
        let v = perform_admin_test(&host, &port, "dev@x", "pw");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["reachable"], json!(true));
        assert_eq!(v["error"], json!("Réservé à l'administrateur"));
    }

    #[test]
    fn perform_admin_test_unreachable_server_reports_clear_error() {
        // Port fermé : on ouvre puis libère un port, rien n'écoute plus.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        drop(listener);
        let v = perform_admin_test("127.0.0.1", &port, "admin@x", "pw");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["reachable"], json!(false));
        assert!(
            v["error"].as_str().unwrap_or("").contains("injoignable"),
            "message attendu clair: {}",
            v
        );
    }

    #[test]
    fn perform_admin_test_requires_email_and_password() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![("/api/gds/health", 200, "{\"version\":\"1\"}".to_string())],
            reqs,
        );
        let (host, port) = host_port(&base);
        // Email vide → message clair, sans appel de connexion.
        let v = perform_admin_test(&host, &port, "  ", "pw");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["error"], json!("Email administrateur requis"));
        // Mot de passe vide ET non mémorisé → message clair.
        let v = perform_admin_test(&host, &port, "admin@x", "");
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["error"], json!("Mot de passe administrateur requis"));
    }

    #[test]
    fn perform_admin_test_host_with_scheme_and_port_field_together() {
        // L'adresse est collée telle quelle dans le champ « adresse » (cas réel
        // d'un copier-coller `http://host:8080`), le champ port reste vide.
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![
                ("/api/gds/health", 200, "{\"version\":\"7\"}".to_string()),
                (
                    "/api/gds/users/login",
                    200,
                    "{\"ok\":true,\"email\":\"a@b\",\"role\":\"admin\",\"token\":\"t2\"}"
                        .to_string(),
                ),
                (
                    "/api/gds/admin/server",
                    200,
                    "{\"repos_bytes\":1,\"db_bytes\":null,\"last_audit\":null}".to_string(),
                ),
            ],
            reqs,
        );
        let v = perform_admin_test(&base, "", "a@b", "pw");
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["version"], json!("7"));
    }

    /// Faux serveur HTTP « scripté » : il répond **dans l'ordre** du script, sans
    /// tenir compte de la route, et journalise chaque requête. Utile pour un
    /// enchaînement connexion → opération(s). Au-delà du script : 500.
    fn spawn_scripted_server(
        script: Vec<(u16, String)>,
        requests: Arc<Mutex<Vec<String>>>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let script = Arc::new(Mutex::new(script));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = match stream {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    continue;
                }
                let mut content_length = 0usize;
                let mut auth = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let trimmed = line.trim_end();
                    if trimmed.is_empty() {
                        break;
                    }
                    let lower = trimmed.to_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        content_length = v.trim().parse().unwrap_or(0);
                    }
                    if let Some(v) = lower.strip_prefix("authorization:") {
                        auth = v.trim().to_string();
                    }
                }
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    let _ = reader.read_exact(&mut body);
                }
                let body = String::from_utf8_lossy(&body).to_string();
                let method = first.split_whitespace().next().unwrap_or("").to_string();
                let path = first.split_whitespace().nth(1).unwrap_or("/").to_string();
                requests
                    .lock()
                    .unwrap()
                    .push(format!("{} {} auth={} body={}", method, path, auth, body));
                let (status, resp_body) = {
                    let mut s = script.lock().unwrap();
                    if s.is_empty() {
                        (500, "{\"error\":\"script épuisé\"}".to_string())
                    } else {
                        s.remove(0)
                    }
                };
                let resp = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    status_text(status),
                    resp_body.len(),
                    resp_body
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }

    /// Réponse de connexion du faux serveur (jeton paramétrable).
    fn login_body(token: &str) -> String {
        json!({"ok": true, "email": "admin@x", "role": "admin", "token": token}).to_string()
    }

    /// Réponse de contrôle du rôle : `open_admin_session` sonde la route
    /// d'administration (`admin/server`) avant de rendre la session utilisable,
    /// le script doit donc la prévoir juste après chaque connexion.
    fn probe_body() -> String {
        json!({"repos_bytes": 0, "db_bytes": null, "last_audit": null}).to_string()
    }

    /// Action « lister les comptes » (celle qu'exécute `gds_admin_accounts`).
    fn accounts_action(
        client: &reqwest::blocking::Client,
        base: &str,
        token: &str,
    ) -> Result<Reply, String> {
        send_get(
            client,
            &format!("{}/api/gds/admin/users", base),
            Some(token),
        )
    }

    // ── L4.3 : charges utiles pures ──

    #[test]
    fn account_payload_validation_uses_socle_vocabulary() {
        // Création : email et mot de passe initial requis, rôle du socle.
        let ok = account_create_payload(" a@b ", " Nom ", "dev", " pw ").unwrap();
        assert_eq!(ok["email"], json!("a@b"));
        assert_eq!(ok["name"], json!("Nom"));
        assert_eq!(ok["role"], json!("dev"));
        // Le mot de passe est VERBATIM (un espace peut en faire partie).
        assert_eq!(ok["password"], json!(" pw "));
        assert_eq!(
            account_create_payload("a@b", "n", "admin", "pw").unwrap()["role"],
            json!("admin")
        );
        assert_eq!(
            account_create_payload("a@b", "n", "standard", "pw").unwrap()["role"],
            json!("standard")
        );
        assert_eq!(
            account_create_payload("", "n", "dev", "pw").unwrap_err(),
            "Email du compte requis"
        );
        assert_eq!(
            account_create_payload("a@b", "n", "dev", "").unwrap_err(),
            "Mot de passe initial requis"
        );
        assert!(account_create_payload("a@b", "n", "root", "pw")
            .unwrap_err()
            .contains("root"));

        // Rôle : vocabulaire du socle uniquement.
        assert_eq!(
            account_role_payload(" a@b ", "admin").unwrap()["email"],
            json!("a@b")
        );
        assert!(account_role_payload("", "admin").is_err());
        assert!(account_role_payload("a@b", "boss")
            .unwrap_err()
            .contains("boss"));

        // Statut : `pending` | `active` | `disabled` ; le « dernier admin » est
        // tranché par le serveur, pas ici.
        assert_eq!(
            account_status_payload("a@b", "disabled").unwrap()["status"],
            json!("disabled")
        );
        assert!(account_status_payload("a@b", "zombie")
            .unwrap_err()
            .contains("zombie"));
        assert!(account_status_payload("", "active").is_err());

        // Mot de passe : requis, verbatim, jamais mentionné dans un message
        // d'erreur.
        assert_eq!(
            account_password_payload(" a@b ", " x ").unwrap()["password"],
            json!(" x ")
        );
        assert_eq!(
            account_password_payload("a@b", "").unwrap_err(),
            "Nouveau mot de passe requis"
        );
        assert!(account_password_payload("", "pw").is_err());
    }

    // ── L4.4 : charges utiles pures ──

    #[test]
    fn project_payload_validation_covers_assign_unassign_remove() {
        // Attribution : identifiant strictement positif, email requis, rôle du socle.
        let ok = project_assign_payload(3, " dev@x ", "dev").unwrap();
        assert_eq!(ok["project_id"], json!(3));
        assert_eq!(ok["email"], json!("dev@x"));
        assert_eq!(ok["role"], json!("dev"));
        assert_eq!(project_assign_payload(1, "a@b", "standard").unwrap()["role"], json!("standard"));
        assert_eq!(project_assign_payload(1, "a@b", "admin").unwrap()["role"], json!("admin"));
        assert_eq!(project_assign_payload(0, "a@b", "dev").unwrap_err(), "Projet invalide");
        assert_eq!(project_assign_payload(-1, "a@b", "dev").unwrap_err(), "Projet invalide");
        assert_eq!(
            project_assign_payload(1, "  ", "dev").unwrap_err(),
            "Email du développeur requis"
        );
        assert!(project_assign_payload(1, "a@b", "boss")
            .unwrap_err()
            .contains("boss"));

        // Retrait d'attribution : email requis, identifiant valide.
        let un = project_unassign_payload(5, " a@b ").unwrap();
        assert_eq!(un["project_id"], json!(5));
        assert_eq!(un["email"], json!("a@b"));
        assert_eq!(project_unassign_payload(0, "a@b").unwrap_err(), "Projet invalide");
        assert_eq!(
            project_unassign_payload(1, "").unwrap_err(),
            "Email du développeur requis"
        );

        // Retrait d'un projet : `purge` est un drapeau explicite.
        assert_eq!(project_remove_payload(7, true).unwrap()["purge"], json!(true));
        assert_eq!(project_remove_payload(7, false).unwrap()["purge"], json!(false));
        assert_eq!(project_remove_payload(0, true).unwrap_err(), "Projet invalide");
    }

    #[test]
    fn project_remove_action_sends_the_explicit_purge_flag() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-R")),
                (200, probe_body()),
                (
                    200,
                    json!({"ok": true, "project_id": 4, "name": "alpha", "purged": true}).to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let payload = project_remove_payload(4, true).unwrap();
        let v = admin_action(&host, &port, "admin@x", "pw-secret", |client, b, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/projects/remove", b),
                Some(token),
                &payload,
            )
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["purged"], json!(true));
        assert_eq!(v["name"], json!("alpha"));
        // Aucun secret dans ce que voit l'interface.
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "{}", text);
        assert!(!text.contains("tok-R"), "{}", text);
        // Le drapeau de purge est bien PARTI au serveur (jamais implicite).
        let log = reqs.lock().unwrap().join("\n");
        assert!(log.contains("POST /api/gds/admin/projects/remove "), "{}", log);
        assert!(log.contains("\"purge\":true"), "{}", log);
    }

    #[test]
    fn project_members_action_uses_the_query_parameter() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-M")),
                (200, probe_body()),
                (
                    200,
                    json!({"members": [{"user_id": 9, "email": "dev@x", "role": "dev"}]})
                        .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v = admin_action(&host, &port, "admin@x", "pw", |client, b, token| {
            send_get(
                client,
                &format!("{}/api/gds/admin/projects/members?project_id={}", b, 12),
                Some(token),
            )
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["members"][0]["email"], json!("dev@x"));
        let log = reqs.lock().unwrap().join("\n");
        assert!(
            log.contains("GET /api/gds/admin/projects/members?project_id=12"),
            "{}",
            log
        );
    }
    // ── L4.5 : espace utilisé, journal d'audit, clefs SSH ──

    #[test]
    fn audit_query_defaults_to_admin_scope_and_encodes_the_search() {
        // Défaut : filtre « administration », page 50.
        assert_eq!(build_audit_query(0, 50, "", ""), "?offset=0&limit=50&scope=admin");
        // Portée explicite « tout » (tolérance de casse/accents).
        assert_eq!(build_audit_query(10, 20, "ALL", ""), "?offset=10&limit=20&scope=all");
        assert_eq!(build_audit_query(0, 20, "tout", ""), "?offset=0&limit=20&scope=all");
        // La recherche libre est percent-encodée et trimée.
        assert_eq!(
            build_audit_query(0, 50, "admin", "  dev@x  "),
            "?offset=0&limit=50&scope=admin&q=dev%40x"
        );
        // Un `limit` hors bornes est ramené dans [1, 200].
        assert_eq!(build_audit_query(0, 9999, "admin", ""), "?offset=0&limit=200&scope=admin");
        assert_eq!(build_audit_query(0, 0, "admin", ""), "?offset=0&limit=1&scope=admin");
    }

    #[test]
    fn ssh_key_revoke_payload_rejects_non_positive_ids() {
        assert!(ssh_key_revoke_payload(0).is_err());
        assert!(ssh_key_revoke_payload(-3).is_err());
        assert_eq!(ssh_key_revoke_payload(7).unwrap(), json!({"id": 7}));
    }

    #[test]
    fn audit_action_hits_the_paginated_admin_route() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-J")),
                (200, probe_body()),
                (
                    200,
                    json!({
                        "entries": [{"ts": 5, "action": "login", "ok": true}],
                        "total": 1, "offset": 0, "limit": 50, "scope": "admin",
                    })
                    .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let qs = build_audit_query(0, 50, "admin", "dev@x");
        let v = admin_action(&host, &port, "admin@x", "pw", |client, b, token| {
            send_get(
                client,
                &format!("{}/api/gds/admin/audit{}", b, qs),
                Some(token),
            )
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["entries"][0]["action"], json!("login"));
        assert_eq!(v["total"], json!(1));
        let log = reqs.lock().unwrap().join("\n");
        assert!(
            log.contains("GET /api/gds/admin/audit?offset=0&limit=50&scope=admin&q=dev%40x"),
            "{}",
            log
        );
    }

    #[test]
    fn ssh_key_revoke_action_posts_the_id_and_reports_keys() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-K")),
                (200, probe_body()),
                (200, json!({"ok": true, "id": 7, "revoked": 1, "keys": 2, "rewritten": true}).to_string()),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let payload = ssh_key_revoke_payload(7).unwrap();
        let v = admin_action(&host, &port, "admin@x", "pw", |client, b, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/ssh-keys/revoke", b),
                Some(token),
                &payload,
            )
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["revoked"], json!(1));
        assert_eq!(v["keys"], json!(2));
        let log = reqs.lock().unwrap().join("\n");
        assert!(
            log.contains("POST /api/gds/admin/ssh-keys/revoke"),
            "{}",
            log
        );
        assert!(log.contains("{\"id\":7}"), "{}", log);
    }

    // ── L4.3 : opérations d'administration (session réutilisée) ──

    #[test]
    fn admin_action_logs_in_once_then_reuses_the_cached_session() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-A")),
                (200, probe_body()),
                (
                    200,
                    json!({"users": [{
                        "id": 1, "email": "a@b", "name": "A",
                        "role": "admin", "status": "active",
                        "created_at": "2026-01-02T03:04:05+00:00"
                    }]})
                    .to_string(),
                ),
                (200, json!({"users": []}).to_string()),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v1 = admin_action(&host, &port, "admin@x", "pw-secret", accounts_action);
        assert_eq!(v1["ok"], json!(true), "{}", v1);
        assert_eq!(v1["users"][0]["email"], json!("a@b"));
        assert_eq!(
            v1["users"][0]["created_at"],
            json!("2026-01-02T03:04:05+00:00")
        );
        // PREUVE : ni mot de passe, ni jeton dans ce que voit l'interface.
        let text = v1.to_string();
        assert!(!text.contains("pw-secret"), "mot de passe exposé: {}", text);
        assert!(!text.contains("tok-A"), "jeton exposé: {}", text);

        // Deuxième appel : la session en cache suffit (pas de nouvelle
        // connexion → le quota anti-force-brute du serveur reste intact).
        let v2 = admin_action(&host, &port, "admin@x", "pw-secret", accounts_action);
        assert_eq!(v2["ok"], json!(true));
        assert_eq!(v2["users"].as_array().unwrap().len(), 0);
        let log = reqs.lock().unwrap().join("\n");
        assert_eq!(
            log.matches("POST /api/gds/users/login").count(),
            1,
            "une seule connexion attendue: {}",
            log
        );
        // Le jeton est utilisé 3 fois : la sonde de rôle de `open_admin_session`
        // (`admin/server`) une fois, puis les DEUX actions sur la session en
        // cache — sans nouvelle connexion.
        assert_eq!(log.matches("auth=bearer tok-a").count(), 3, "{}", log);
    }

    #[test]
    fn admin_action_relogs_in_when_the_cached_session_is_rejected() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-1")),
                (200, probe_body()),
                (200, json!({"users": []}).to_string()),
                // Session en cache refusée (serveur redémarré / expirée).
                (401, json!({"error": "Non authentifié"}).to_string()),
                (200, login_body("tok-2")),
                (200, probe_body()),
                (200, json!({"users": [{"email": "c@d"}]}).to_string()),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        assert_eq!(
            admin_action(&host, &port, "admin@x", "pw", accounts_action)["ok"],
            json!(true)
        );
        // La session refusée est remplacée sans erreur visible pour l'utilisateur.
        let v = admin_action(&host, &port, "admin@x", "pw", accounts_action);
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["users"][0]["email"], json!("c@d"));
        let log = reqs.lock().unwrap().join("\n");
        assert_eq!(log.matches("POST /api/gds/users/login").count(), 2, "{}", log);
        assert!(log.contains("auth=bearer tok-1"), "{}", log);
        assert!(log.contains("auth=bearer tok-2"), "{}", log);
    }

    #[test]
    fn admin_action_reports_the_server_message_and_never_the_secret() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-Z")),
                (200, probe_body()),
                (
                    409,
                    json!({"error": "Impossible de désactiver le dernier administrateur actif"})
                        .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let payload = account_status_payload("seul-admin@x", "disabled").unwrap();
        let v = admin_action(&host, &port, "admin@x", "pw-secret", |client, b, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users/status", b),
                Some(token),
                &payload,
            )
        });
        assert_eq!(v["ok"], json!(false));
        assert_eq!(
            v["error"],
            json!("Impossible de désactiver le dernier administrateur actif")
        );
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "{}", text);
        assert!(!text.contains("tok-Z"), "{}", text);
    }

    #[test]
    fn account_create_action_sends_the_password_but_never_returns_it() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-C")),
                (200, probe_body()),
                (
                    200,
                    json!({"ok": true, "id": 7, "email": "d@x", "role": "dev", "status": "active"})
                        .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let payload = account_create_payload("d@x", "Dev", "dev", "init-pw").unwrap();
        let v = admin_action(&host, &port, "admin@x", "pw-secret", |client, b, token| {
            send_post_json(
                client,
                &format!("{}/api/gds/admin/users", b),
                Some(token),
                &payload,
            )
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["email"], json!("d@x"));
        assert_eq!(v["id"], json!(7));
        let text = v.to_string();
        assert!(!text.contains("init-pw"), "mot de passe initial exposé: {}", text);
        assert!(!text.contains("pw-secret"), "{}", text);
        assert!(!text.contains("tok-C"), "{}", text);
        // Le mot de passe initial a bien été TRANSMIS au serveur.
        let log = reqs.lock().unwrap().join("\n");
        assert!(
            log.contains("init-pw"),
            "le mot de passe doit partir au serveur: {}",
            log
        );
        assert!(log.contains("POST /api/gds/admin/users "), "{}", log);
    }

    #[test]
    fn admin_action_requires_the_admin_identity_without_calling_the_server() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(vec![], reqs.clone());
        let (host, port) = host_port(&base);
        // Email vide : refus immédiat, aucun appel.
        let v = admin_action(&host, &port, "  ", "pw", accounts_action);
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["error"], json!("Email administrateur requis"));
        // Mot de passe vide ET non mémorisé pour cet hôte : refus clair.
        let v = admin_action(&host, &port, "inconnu@x", "", accounts_action);
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["error"], json!("Mot de passe administrateur requis"));
        assert!(
            reqs.lock().unwrap().is_empty(),
            "aucun appel réseau attendu: {:?}",
            reqs.lock().unwrap()
        );
    }

    // ── L4.6 : actions de service + santé publique ──

    #[test]
    fn service_status_action_hits_the_admin_route_and_reports_the_pid() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_scripted_server(
            vec![
                (200, login_body("tok-S")),
                (200, probe_body()),
                (
                    200,
                    json!({
                        "pid": 4242,
                        "action_delay_ms": 750,
                        "programs": ["gds-server", "sshd"],
                        "states": [
                            {"name": "gds-server", "state": "RUNNING", "pid": 55},
                            {"name": "sshd", "state": "RUNNING", "pid": 56}
                        ],
                        "error": null
                    })
                    .to_string(),
                ),
            ],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v = admin_action(&host, &port, "admin@x", "pw-secret", |client, b, token| {
            send_get(client, &format!("{}/api/gds/admin/service", b), Some(token))
        });
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["pid"], json!(4242));
        assert_eq!(v["states"][0]["name"], json!("gds-server"));
        // Aucun secret dans ce que voit l'interface.
        let text = v.to_string();
        assert!(!text.contains("pw-secret"), "{}", text);
        assert!(!text.contains("tok-S"), "{}", text);
        let log = reqs.lock().unwrap().join("\n");
        assert!(log.contains("GET /api/gds/admin/service "), "{}", log);
    }

    #[test]
    fn service_restart_and_stop_post_to_their_admin_routes() {
        for (token, path) in [
            ("tok-R", "/api/gds/admin/service/restart"),
            ("tok-X", "/api/gds/admin/service/stop"),
        ] {
            let reqs = Arc::new(Mutex::new(Vec::new()));
            let base = spawn_scripted_server(
                vec![
                    (200, login_body(token)),
                    (200, probe_body()),
                    (
                        200,
                        json!({"ok": true, "programs": ["gds-server", "sshd"]}).to_string(),
                    ),
                ],
                reqs.clone(),
            );
            let (host, port) = host_port(&base);
            let v = admin_action(&host, &port, "admin@x", "pw", |client, b, t| {
                send_post_json(client, &format!("{}{}", b, path), Some(t), &json!({}))
            });
            assert_eq!(v["ok"], json!(true), "{}", v);
            let log = reqs.lock().unwrap().join("\n");
            assert!(log.contains(&format!("POST {}", path)), "{}", log);
        }
    }

    #[test]
    fn public_health_probe_sends_no_token_and_reports_the_version() {
        let reqs = Arc::new(Mutex::new(Vec::new()));
        let base = spawn_fake_server(
            vec![(
                "/api/gds/health",
                200,
                json!({"version": "9.9.9", "migration_version": 7, "uptime_seconds": 3,
                       "users": 1, "projects": 2, "git_repos": 3})
                .to_string(),
            )],
            reqs.clone(),
        );
        let (host, port) = host_port(&base);
        let v = probe_public_health(&host, &port);
        assert_eq!(v["ok"], json!(true), "{}", v);
        assert_eq!(v["version"], json!("9.9.9"));
        assert_eq!(v["git_repos"], json!(3));
        // PREUVE : aucun en-tête Authorization sur la sonde publique (un
        // redémarrage invalide les sessions ; la sonde ne doit dépendre d'aucune).
        let log = reqs.lock().unwrap().join("\n");
        assert!(log.contains("GET /api/gds/health"), "{}", log);
        assert!(log.contains("auth= "), "aucun jeton attendu: {}", log);
        assert!(!log.to_lowercase().contains("bearer"), "{}", log);
    }

    #[test]
    fn public_health_probe_reports_an_unreachable_service() {
        // Port fermé : on ouvre puis libère un port, rien n'écoute plus.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        drop(listener);
        let v = probe_public_health("127.0.0.1", &port);
        assert_eq!(v["ok"], json!(false));
        assert!(
            v["error"].as_str().unwrap_or("").contains("injoignable"),
            "message attendu clair: {}",
            v
        );
    }

    #[test]
    fn public_health_probe_rejects_an_invalid_address() {
        let v = probe_public_health("  ", "8080");
        assert_eq!(v["ok"], json!(false));
        assert!(v["error"].as_str().unwrap_or("").contains("Adresse"));
    }
}
