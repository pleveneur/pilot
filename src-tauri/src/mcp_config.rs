// mcp_config.rs — Mode consommateur MCP (Proof of Concept).
//
// Pilot ne supporte pas MCP nativement côté rust. Ce POC prouve qu'il peut se
// connecter à un serveur MCP tier via une EXTENSION pi qui embarque le SDK MCP
// bundlé (src-tauri/extensions/pilot-mcp-client.ts). Ce module rust gère la
// CONFIG des serveurs MCP :
//   - lecture / écriture de `mcp.json` dans <app_data_dir>/ (PAS dans AppConfig,
//     cf. spec : la config MCP est un fichier dédié, passé à l'extension via la
//     variable d'environnement PILOT_MCP_CONFIG au lancement du process pi),
//   - commandes Tauri minimales du POC :
//       mcp_list_servers      → liste des serveurs configurés
//       mcp_save_servers      → remplace la liste des serveurs
//       mcp_set_enabled       → active/désactive le POC MCP (flag global Pilot)
//       mcp_test_connection   → vérifie la handshake : serveur local (stdio)
//                               ou serveur distant (POST HTTP `initialize`)
//
// Format mcp.json :
// {
//   "servers": [
//     {
//       "id": "test",
//       "name": "Test MCP Server",
//       "transport": "stdio",
//       "enabled": true,
//       "command": "node",
//       "args": ["scripts/mcp-test-server.js"]
//     }
//   ]
// }

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager, State};

/// Délai d'attente du test d'un serveur MCP distant (POST `initialize`).
const REMOTE_TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows pour CREATE_NO_WINDOW (0x08000000).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Un serveur MCP configurable. Le transport reste une chaîne : `"stdio"` par
/// défaut (mode local, un programme de cet ordinateur) ou `"http"`/`"https"`
/// (mode distant, une adresse réseau).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    /// `"stdio"` par défaut (local) ; `"http"` / `"https"` désigne un serveur distant.
    pub transport: String,
    pub enabled: bool,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Adresse du serveur distant (vide pour un serveur local).
    pub url: String,
    /// Référence vers une entrée du coffre — JAMAIS la clé elle-même.
    pub secret_ref: Option<String>,
}

impl Default for McpServer {
    fn default() -> Self {
        McpServer {
            id: String::new(),
            name: String::new(),
            transport: "stdio".to_string(),
            enabled: false,
            command: String::new(),
            args: Vec::new(),
            url: String::new(),
            secret_ref: None,
        }
    }
}

/// Famille d'un transport MCP : locale (`Stdio`) ou distante (`Http`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    Stdio,
    Http,
}

impl McpServer {
    /// Range le serveur dans sa famille d'après `transport`, casse et espaces
    /// ignorés. Toute valeur inconnue est traitée comme locale (`Stdio`), ce qui
    /// préserve le comportement du POC.
    pub fn transport_kind(&self) -> TransportKind {
        match self.transport.trim().to_ascii_lowercase().as_str() {
            "http" | "https" => TransportKind::Http,
            _ => TransportKind::Stdio,
        }
    }

    /// Vrai pour un serveur distant (famille `Http`).
    pub fn is_remote(&self) -> bool {
        self.transport_kind() == TransportKind::Http
    }
}

/// Valide un serveur avant enregistrement. Retourne un message d'erreur en
/// français, ou `None` si le serveur est valide. Un serveur distant (famille
/// `Http`) doit avoir une adresse non vide ; un serveur local garde les règles
/// actuelles (aucune exigence supplémentaire ici).
pub fn validate_mcp_server(server: &McpServer) -> Option<String> {
    if server.is_remote() && server.url.trim().is_empty() {
        let label = if server.name.trim().is_empty() {
            server.id.as_str()
        } else {
            server.name.trim()
        };
        return Some(format!(
            "Serveur « {} » : l'adresse (url) est requise pour un serveur distant.",
            label
        ));
    }
    None
}

/// Message d'erreur d'un transport MCP non reconnu (ni `stdio`, ni `http`/
/// `https`), ou `None` s'il est reconnu. Une valeur vide est traitée comme le
/// transport local par défaut (`stdio`), cohérent avec `transport_kind()` qui
/// range toute valeur vide parmi les serveurs locaux. Fonction pure, testable.
pub fn unknown_transport_message(transport: &str) -> Option<String> {
    let t = transport.trim();
    if t.is_empty()
        || t.eq_ignore_ascii_case("stdio")
        || t.eq_ignore_ascii_case("http")
        || t.eq_ignore_ascii_case("https")
    {
        None
    } else {
        Some(format!(
            "Transport MCP inconnu : « {} » (attendu « stdio » ou « http »)",
            t
        ))
    }
}

/// Config MCP racine (miroir du mcp.json).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct McpConfig {
    #[serde(default)]
    pub servers: Vec<McpServer>,
}

/// Chemin du fichier de config MCP : <app_data_dir>/mcp.json.
fn mcp_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création dossier config: {}", e))?;
    Ok(dir.join("mcp.json"))
}

/// Lit le mcp.json. Retourne une config vide (serveurs = []) si le fichier est
/// absent. Round-trip JSON.
pub fn read_mcp_config(app: &AppHandle) -> Result<McpConfig, String> {
    let path = mcp_config_path(app)?;
    if !path.exists() {
        return Ok(McpConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Lecture mcp.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("mcp.json invalide: {}", e))
}

/// Écrit le mcp.json (backup `.bak` avant écriture).
pub fn write_mcp_config(app: &AppHandle, cfg: &McpConfig) -> Result<(), String> {
    let path = mcp_config_path(app)?;
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| format!("Sérialisation mcp.json: {}", e))?;
    std::fs::write(&path, raw).map_err(|e| format!("Écriture mcp.json: {}", e))
}

/// Lit un `mcp.json` depuis un chemin explicite (sans `AppHandle`). Fichier
/// absent ou illisible → config vide (fail-open). Testable isolément.
pub fn read_mcp_config_at(path: &Path) -> McpConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Sélectionne le serveur MCP que la session va utiliser : le serveur cible
/// (`target`, posé via `PILOT_MCP_SERVER`) s'il est activé, sinon le premier
/// serveur activé (repli). Fonction pure.
pub fn select_session_server<'a>(
    cfg: &'a McpConfig,
    target: Option<&str>,
) -> Option<&'a McpServer> {
    let target = target.map(str::trim).filter(|t| !t.is_empty());
    if let Some(t) = target {
        if let Some(s) = cfg.servers.iter().find(|s| s.id == t && s.enabled) {
            return Some(s);
        }
    }
    cfg.servers.iter().find(|s| s.enabled)
}

/// Normalise une référence de coffre : accepte `"<id>"` ou `"vault:<id>"`.
pub fn vault_ref_id(reference: &str) -> &str {
    let r = reference.trim();
    r.strip_prefix("vault:").map(str::trim).unwrap_or(r)
}

/// Retire toute occurrence d'une clé d'un message. Réutilise l'utilitaire
/// existant `telegram::redact_token` (ne pas réinventer le masquage) : un
/// message de diagnostic MCP ne doit jamais contenir le secret.
pub fn redact_mcp_message(message: &str, secret: &str) -> String {
    crate::telegram::redact_token(message, secret)
}

/// Chaîne du secret (E2) : complète `vars` avec `PILOT_MCP_SECRET` si le
/// serveur de la session (cible sinon premier activé) possède une référence
/// résoluble dans le coffre, et retourne une ligne de diagnostic DÉJÀ MASQUÉE.
///
/// Ne bloque jamais et ne journalise jamais la clé :
///   - aucun serveur activé / serveur sans référence → aucune variable ;
///   - clé résolue → `PILOT_MCP_SECRET` posée, diagnostic sans la valeur ;
///   - coffre verrouillé ou référence inconnue → aucune variable, message clair
///     sans secret (la session démarre quand même, sans ce serveur).
pub fn attach_mcp_secret(
    vars: &mut Vec<(String, String)>,
    config_path: &Path,
    vault_key: Option<&[u8]>,
    vault_file: &Path,
    target: Option<&str>,
) -> String {
    let cfg = read_mcp_config_at(config_path);
    let Some(server) = select_session_server(&cfg, target) else {
        return redact_mcp_message("MCP: aucun serveur activé — aucune clé transmise", "");
    };
    let label = if server.name.trim().is_empty() {
        server.id.as_str()
    } else {
        server.name.trim()
    };
    let Some(reference) = server
        .secret_ref
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    else {
        return redact_mcp_message(
            &format!("MCP: serveur « {} » sans clé (aucune référence)", label),
            "",
        );
    };
    let id = vault_ref_id(reference);
    match crate::vault::resolve_secret_at(vault_file, vault_key, id) {
        Ok(secret) => {
            vars.push(("PILOT_MCP_SECRET".to_string(), secret.clone()));
            // Le diagnostic ne doit jamais contenir la valeur : masquage appliqué
            // même si le message ne cite que l'identifiant de la référence.
            redact_mcp_message(
                &format!(
                    "MCP: clé du serveur « {} » résolue et transmise (réf. {})",
                    label, id
                ),
                &secret,
            )
        }
        Err(reason) => redact_mcp_message(
            &format!(
                "MCP: clé du serveur « {} » indisponible ({}) — session démarrée sans ce serveur",
                label, reason
            ),
            "",
        ),
    }
}

// ── Commandes Tauri ──

/// Liste les serveurs MCP configurés.
#[tauri::command]
pub fn mcp_list_servers(app: AppHandle) -> Result<Vec<McpServer>, String> {
    read_mcp_config(&app).map(|c| c.servers)
}

/// Remplace la liste des serveurs MCP (round-trip). Refuse un serveur distant
/// sans adresse (message clair, en français) avant toute écriture.
#[tauri::command]
pub fn mcp_save_servers(app: AppHandle, servers: Vec<McpServer>) -> Result<(), String> {
    for server in &servers {
        if let Some(err) = validate_mcp_server(server) {
            return Err(err);
        }
    }
    write_mcp_config(&app, &McpConfig { servers })
}

/// Active/désactive le POC MCP (flag consommateur Pilot). Indépendant des
/// serveurs : l'extension MCP n'est passée à pi que si mcp_enabled est vrai.
#[tauri::command]
pub fn mcp_set_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let state = app.state::<crate::AppState>();
    let saved = {
        let mut config = state.config.lock().unwrap();
        config.mcp_enabled = enabled;
        crate::save_config_disk(&app, &config)
    };
    Ok(saved.is_ok())
}

/// Active/désactive la confirmation MCP pilotée par l'assistant
/// (AppConfig.mcp_agent_confirm, défaut ON). Quand activé, l'assistant demande
/// une confirmation à l'utilisateur avant qu'un agent utilise un serveur MCP.
#[tauri::command]
pub fn mcp_set_agent_confirm(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let state = app.state::<crate::AppState>();
    let saved = {
        let mut config = state.config.lock().unwrap();
        config.mcp_agent_confirm = enabled;
        crate::save_config_disk(&app, &config)
    };
    Ok(saved.is_ok())
}

/// État MCP consolidé exposé à l'assistant (brique C). Retourne
/// `{ enabled, confirm, servers }` où `confirm` reflète `mcp_agent_confirm`
/// (défaut ON) et `servers` liste les serveurs configurés (avec leurs ids) pour
/// que l'assistant choisisse un serveur cible (mcp_server) et sache s'il doit
/// demander une confirmation avant qu'un agent l'utilise.
///
/// Ne contient JAMAIS la valeur d'une clé : seuls id, name, enabled et
/// transport sont exposés.
pub fn mcp_state_json(enabled: bool, confirm: bool, servers: &[McpServer]) -> Value {
    serde_json::json!({
        "enabled": enabled,
        "confirm": confirm,
        "servers": servers.iter().map(|s| serde_json::json!({
            "id": s.id,
            "name": s.name,
            "enabled": s.enabled,
            "transport": s.transport,
        })).collect::<Vec<_>>(),
    })
}

/// État MCP exposé à l'assistant (brique C) : voir `mcp_state_json`.
#[tauri::command]
pub fn mcp_get_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<crate::AppState>();
    let enabled = state.config.lock().unwrap().mcp_enabled;
    let confirm = state.config.lock().unwrap().mcp_agent_confirm;
    let servers = read_mcp_config(&app).map(|c| c.servers).unwrap_or_default();
    Ok(mcp_state_json(enabled, confirm, &servers))
}

// ── Test de connexion (local stdio et distant HTTP) ──

/// Résout la clé éventuelle du serveur depuis le coffre (chaîne E2). La valeur
/// ne sort jamais d'ici : elle ne sert qu'à remplir l'en-tête d'authentification
/// du test distant, n'est JAMAIS renvoyée à l'UI ni journalisée. `None` si le
/// serveur n'a pas de référence, si le coffre est verrouillé ou si la référence
/// est absente — le test continue alors sans authentification.
fn resolve_server_secret(server: &McpServer, vault_key: Option<&[u8]>) -> Option<String> {
    let reference = server.secret_ref.as_deref()?.trim();
    if reference.is_empty() {
        return None;
    }
    let path = crate::vault::vault_file_path().ok()?;
    crate::vault::resolve_secret_at(&path, vault_key, vault_ref_id(reference)).ok()
}

/// Corps JSON-RPC `initialize` de la handshake de test (commun aux deux
/// transports). Fonction pure, testable.
pub fn initialize_body() -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "pilot-mcp-test", "version": "0.1.0" }
        }
    })
}

/// Construit la requête HTTP POST du test d'un serveur distant. Fonction PURE
/// (aucune I/O) : `secret` est posé en EN-TÊTE `Authorization: Bearer`, jamais
/// dans l'URL (une URL fuit facilement dans les traces du client HTTP).
pub fn build_remote_test_request(
    url: &str,
    secret: Option<&str>,
) -> Result<reqwest::blocking::Request, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Adresse (url) du serveur distant vide".to_string());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(REMOTE_TEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Client HTTP indisponible : {}", e))?;
    let mut builder = client
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .json(&initialize_body());
    if let Some(secret) = secret.map(str::trim).filter(|s| !s.is_empty()) {
        builder = builder.header("authorization", format!("Bearer {}", secret));
    }
    builder
        .build()
        .map_err(|e| format!("Adresse de serveur distant invalide : {}", e))
}

/// Lit la réponse d'un serveur MCP distant : soit un objet JSON direct (corps
/// entier, éventuellement multi-lignes), soit la première ligne `data:` d'un
/// flux d'événements (`text/event-stream`). Fonction pure, testable.
pub fn parse_remote_test_response(body: &str) -> Option<Value> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 1) Objet JSON direct.
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Some(v);
    }
    // 2) Flux SSE : première ligne `data:` porteuse d'un JSON.
    for line in trimmed.lines() {
        let Some(payload) = line.trim().strip_prefix("data:") else {
            continue;
        };
        if let Ok(v) = serde_json::from_str::<Value>(payload.trim()) {
            return Some(v);
        }
    }
    None
}

/// Compose le résultat du test distant (`{ ok, server, protocolVersion, error }`).
/// Toute erreur est MASQUÉE (`redact_mcp_message`) : la clé ne peut pas fuir
/// dans un message renvoyé à l'UI. Fonction pure, testable.
pub fn remote_test_result(
    label: &str,
    response: Option<&Value>,
    detail: &str,
    secret: Option<&str>,
) -> Value {
    let secret = secret.unwrap_or("");
    match response {
        Some(v) if v.get("result").is_some() => serde_json::json!({
            "ok": true,
            "server": label,
            "protocolVersion": v["result"]["protocolVersion"].as_str().unwrap_or(""),
            "error": ""
        }),
        Some(v) if v.get("error").is_some() => {
            // `error` peut être un objet JSON-RPC (`{code, message}`) ou une
            // simple chaîne (`{"error":"not_found","message":"..."}`) : on
            // accepte les deux, et à défaut d'un texte exploitable on replie sur
            // `detail` (statut HTTP) plutôt qu'un texte figé qui masquerait la
            // cause réelle.
            let err = v["error"]["message"]
                .as_str()
                .or_else(|| v["message"].as_str())
                .or_else(|| v["error"].as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(detail);
            serde_json::json!({
                "ok": false,
                "server": label,
                "protocolVersion": "",
                "error": redact_mcp_message(err, secret)
            })
        }
        _ => serde_json::json!({
            "ok": false,
            "server": label,
            "protocolVersion": "",
            "error": redact_mcp_message(detail, secret)
        }),
    }
}

/// Test distant (bloquant — appelé depuis `spawn_blocking`) : POST `initialize`,
/// lecture JSON directe ou première ligne `data:` d'un flux SSE.
fn test_remote_connection(
    server: &McpServer,
    label: &str,
    secret: Option<&str>,
) -> Result<Value, String> {
    let request = match build_remote_test_request(&server.url, secret) {
        Ok(r) => r,
        Err(e) => return Ok(remote_test_result(label, None, &e, secret)),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(REMOTE_TEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Client HTTP indisponible : {}", e))?;
    match client.execute(request) {
        Ok(response) => {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            let parsed = parse_remote_test_response(&body);
            let detail = if status.is_success() {
                "réponse illisible : aucun objet JSON-RPC exploitable".to_string()
            } else {
                format!("le serveur a répondu avec le statut HTTP {}", status.as_u16())
            };
            Ok(remote_test_result(label, parsed.as_ref(), &detail, secret))
        }
        Err(e) => {
            // Le message peut citer l'URL mais jamais l'en-tête : masquage
            // appliqué par `remote_test_result` en défense en profondeur.
            let detail = format!("connexion impossible : {}", e);
            Ok(remote_test_result(label, None, &detail, secret))
        }
    }
}

/// Test local stdio : lance la commande et vérifie la handshake MCP
/// (`initialize` → réponse) avec un timeout. Déroulement inchangé depuis le POC.
fn test_stdio_connection(server: McpServer, label: String) -> Result<Value, String> {
    let timeout = std::time::Duration::from_secs(8);
    if server.command.trim().is_empty() {
        return Err("Commande du serveur vide".to_string());
    }

    let mut cmd = Command::new(server.command.trim());
    cmd.args(server.args.iter().filter(|a| !a.is_empty()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer {} : {}", label, e))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Impossible de capturer stdin du serveur MCP")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Impossible de capturer stdout du serveur MCP")?;

    // Handshake MCP minimale (JSON-RPC initialize).
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "pilot-mcp-test", "version": "0.1.0" }
        }
    });
    let line = serde_json::to_string(&init_request).unwrap_or_default();
    let _ = writeln!(stdin, "{}", line);
    let _ = stdin.flush();

    // Lire les lignes stdout jusqu'à une réponse contenant le résultat.
    let mut reader = BufReader::new(stdout);
    let start = std::time::Instant::now();
    let mut raw_response: Option<Value> = None;
    // Draine stderr dans un thread pour éviter un blocage sur pipe plein.
    let stderr = child.stderr.take();
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            use std::io::Read;
            let _ = e.read_to_string(&mut s);
        }
        s
    });

    loop {
        if start.elapsed() > timeout {
            break;
        }
        let mut buf = String::new();
        match reader.read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = buf.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    // Une réponse à notre id=1, ou notification sans id → candidat.
                    if v.get("id").and_then(|i| i.as_i64()) == Some(1)
                        || (v.get("method").is_none() && v.get("id").is_some())
                    {
                        if v.get("result").is_some() || v.get("error").is_some() {
                            raw_response = Some(v);
                            break;
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }

    let mut child = child;
    let _ = child.kill();
    let _ = child.wait();
    let mut collected_stderr = err_thread
        .join()
        .unwrap_or_else(|_| String::new());
    if !collected_stderr.trim().is_empty() {
        collected_stderr = collected_stderr.trim().to_string();
    }

    match raw_response {
        Some(v) if v.get("result").is_some() => Ok(serde_json::json!({
            "ok": true,
            "server": label,
            "protocolVersion": v["result"]["protocolVersion"].as_str().unwrap_or(""),
            "error": ""
        })),
        Some(v) if v.get("error").is_some() => {
            let err = v["error"]["message"].as_str().unwrap_or("handshake error");
            Ok(serde_json::json!({ "ok": false, "server": label, "protocolVersion": "", "error": err }))
        }
        _ => {
            // Timeout ou aucune réponse JSON valide.
            let detail = if collected_stderr.is_empty() {
                "timeout : aucune réponse handshake MCP (initialize) en 8s".to_string()
            } else {
                format!("aucune réponse handshake MCP (initialize) en 8s — serveur: {}", collected_stderr)
            };
            Ok(serde_json::json!({ "ok": false, "server": label, "protocolVersion": "", "error": detail }))
        }
    }
}

/// Teste la connexion à un serveur MCP : distant (`http`/`https`) → POST
/// `initialize` en HTTP ; local (`stdio`) → handshake du processus. Un transport
/// réellement inconnu est refusé avec un message clair. Retourne
/// `{ ok, server, protocolVersion, error }` (la clé n'y apparaît jamais).
#[tauri::command]
pub async fn mcp_test_connection(
    state: State<'_, crate::AppState>,
    server: McpServer,
) -> Result<Value, String> {
    let label = if server.name.is_empty() {
        server.id.clone()
    } else {
        server.name.clone()
    };

    match server.transport_kind() {
        TransportKind::Http => {
            // Clé résolue côté Rust (coffre) : jamais renvoyée à l'UI.
            let vault_key = state.vault_key.lock().unwrap().clone();
            let secret = resolve_server_secret(&server, vault_key.as_deref());
            tokio::task::spawn_blocking(move || {
                test_remote_connection(&server, &label, secret.as_deref())
            })
            .await
            .map_err(|e| format!("Test de connexion interrompu : {}", e))?
        }
        TransportKind::Stdio => {
            // Transport réellement inconnu (ni stdio ni http) : refus explicite.
            if let Some(err) = unknown_transport_message(&server.transport) {
                return Err(err);
            }
            tokio::task::spawn_blocking(move || test_stdio_connection(server, label))
                .await
                .map_err(|e| format!("Test de connexion interrompu : {}", e))?
        }
    }
}

// ── Tests unitaires (parsing / sérialisation mcp.json, flag mcp_enabled) ──

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_server() -> McpServer {
        McpServer {
            id: "test".to_string(),
            name: "Test Server".to_string(),
            transport: "stdio".to_string(),
            enabled: true,
            command: "node".to_string(),
            args: vec!["scripts/mcp-test-server.js".to_string()],
            ..Default::default()
        }
    }

    #[test]
    fn serialization_round_trip() {
        let cfg = McpConfig {
            servers: vec![sample_server()],
        };
        let raw = serde_json::to_string(&cfg).unwrap();
        let parsed: McpConfig = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.servers.len(), 1);
        assert_eq!(parsed.servers[0], sample_server());
    }

    #[test]
    fn parse_mcp_json_with_defaults() {
        let raw = r#"{
            "servers": [
                { "id": "a", "name": "A", "transport": "stdio" }
            ]
        }"#;
        let cfg: McpConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.servers.len(), 1);
        // Champ `args` absent → défaut Vec::new().
        assert!(cfg.servers[0].args.is_empty());
        // Champ `enabled` absent → défaut false.
        assert!(!cfg.servers[0].enabled);
        assert_eq!(cfg.servers[0].command, String::new());
    }

    #[test]
    fn missing_file_yields_empty_config() {
        // Sans AppHandle, on teste juste la structure par défaut.
        let cfg = McpConfig::default();
        assert!(cfg.servers.is_empty());
    }

    #[test]
    fn legacy_stdio_config_reads_back_without_loss() {
        // mcp.json d'origine (six champs, mode local) : doit se relire à l'identique.
        let raw = r#"{
            "servers": [
                {
                    "id": "test",
                    "name": "Test MCP Server",
                    "transport": "stdio",
                    "enabled": true,
                    "command": "node",
                    "args": ["scripts/mcp-test-server.js"]
                }
            ]
        }"#;
        let cfg: McpConfig = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.servers.len(), 1);
        let s = &cfg.servers[0];
        assert_eq!(
            s,
            &McpServer {
                id: "test".to_string(),
                name: "Test MCP Server".to_string(),
                transport: "stdio".to_string(),
                enabled: true,
                command: "node".to_string(),
                args: vec!["scripts/mcp-test-server.js".to_string()],
                url: String::new(),
                secret_ref: None,
            }
        );
        // Les deux nouveaux champs sont vides sans être exigés par le fichier.
        assert_eq!(s.url, String::new());
        assert!(s.secret_ref.is_none());
        // Le transport local reste "stdio".
        assert_eq!(s.transport, "stdio");
        assert_eq!(s.transport_kind(), TransportKind::Stdio);

        // E8 : ce fichier d'origine est ACCEPTÉ par la validation…
        assert_eq!(validate_mcp_server(s), None);
        // …et se RÉENREGISTRE sans perte (round-trip complet) : les six champs
        // d'origine gardent leurs valeurs, les deux champs nouveaux restent vides.
        let resaved = serde_json::to_string(&cfg).unwrap();
        let reread: McpConfig = serde_json::from_str(&resaved).unwrap();
        assert_eq!(reread.servers.len(), 1);
        assert_eq!(reread.servers[0], *s, "le serveur relu doit être identique après réenregistrement");
        let stored: Value = serde_json::from_str(&resaved).unwrap();
        let obj = stored["servers"][0]
            .as_object()
            .expect("objet serveur réenregistré");
        assert_eq!(obj["id"], "test");
        assert_eq!(obj["name"], "Test MCP Server");
        assert_eq!(obj["transport"], "stdio");
        assert_eq!(obj["enabled"], true);
        assert_eq!(obj["command"], "node");
        assert_eq!(obj["args"][0], "scripts/mcp-test-server.js");
        assert_eq!(reread.servers[0].url, String::new());
        assert!(reread.servers[0].secret_ref.is_none());
    }

    #[test]
    fn transport_kind_is_case_insensitive_and_defaults_to_local() {
        let kind = |transport: &str| McpServer {
            transport: transport.to_string(),
            ..Default::default()
        }
        .transport_kind();
        assert_eq!(kind("stdio"), TransportKind::Stdio);
        assert_eq!(kind("STDIO"), TransportKind::Stdio);
        assert_eq!(kind("http"), TransportKind::Http);
        assert_eq!(kind("HTTP"), TransportKind::Http);
        assert_eq!(kind("Https"), TransportKind::Http);
        assert_eq!(kind("  https  "), TransportKind::Http);
        // Valeur inconnue ou vide → famille locale (comportement actuel conservé).
        assert_eq!(kind("carrier-pigeon"), TransportKind::Stdio);
        assert_eq!(kind(""), TransportKind::Stdio);
    }

    #[test]
    fn remote_server_requires_url_and_is_preserved() {
        // Distant sans adresse → refus, message en français.
        let mut remote = McpServer {
            id: "distant".to_string(),
            name: "Distant".to_string(),
            transport: "http".to_string(),
            ..Default::default()
        };
        let err = validate_mcp_server(&remote).expect("un refus attendu sans adresse");
        assert!(err.contains("adresse"), "message: {}", err);

        // Distant avec adresse → accepté et conservé au round-trip.
        remote.url = "https://mcp.example.com/mcp".to_string();
        remote.secret_ref = Some("vault:mon-entree".to_string());
        assert_eq!(validate_mcp_server(&remote), None);
        assert_eq!(remote.transport_kind(), TransportKind::Http);
        let cfg = McpConfig {
            servers: vec![remote.clone()],
        };
        let raw = serde_json::to_string(&cfg).unwrap();
        let parsed: McpConfig = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.servers[0].url, "https://mcp.example.com/mcp");
        assert_eq!(parsed.servers[0].secret_ref.as_deref(), Some("vault:mon-entree"));
        assert_eq!(parsed.servers[0].transport_kind(), TransportKind::Http);

        // Un serveur local reste valide sans adresse.
        assert_eq!(validate_mcp_server(&sample_server()), None);
    }

    #[test]
    fn mcp_enabled_flag_not_in_servers() {
        // Le flag consommateur Pilot (AppConfig.mcp_enabled) est distinct de la
        // config des serveurs (mcp.json). Vérifie que la sérialisation ne
        // contient pas de champ global parasite.
        let cfg = McpConfig { servers: vec![] };
        let raw = serde_json::to_string(&cfg).unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert!(parsed.get("mcp_enabled").is_none());
        assert!(parsed.get("servers").is_some());
    }

    // ── E2 : chaîne du secret (sécurité) ──

    /// Valeur FICTIVE d'une clé et serveur distant fictif qui la référence.
    const FICTIONAL_KEY: &str = "cle-fictive-42-xyz";

    fn fictional_remote_server() -> McpServer {
        McpServer {
            id: "distant".to_string(),
            name: "Distant".to_string(),
            transport: "http".to_string(),
            enabled: true,
            url: "https://exemple.invalid/mcp".to_string(),
            secret_ref: Some("vault:entree-fictive".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn redaction_hides_a_key_in_a_diagnostic_message() {
        let msg = format!(
            "échec d'authentification : la clé {} a été refusée par le serveur",
            FICTIONAL_KEY
        );
        let redacted = redact_mcp_message(&msg, FICTIONAL_KEY);
        assert!(!redacted.contains(FICTIONAL_KEY), "message: {}", redacted);
        assert!(redacted.contains("***"));
        // Sans secret à masquer, le message est rendu inchangé.
        assert_eq!(redact_mcp_message("rien à masquer", ""), "rien à masquer");
    }

    #[test]
    fn listings_never_expose_the_key_value() {
        let server = fictional_remote_server();
        // `mcp_list_servers` renvoie la RÉFÉRENCE, jamais la valeur.
        let listed = serde_json::to_string(&vec![server.clone()]).unwrap();
        assert!(listed.contains("entree-fictive"), "la référence doit rester visible");
        assert!(!listed.contains(FICTIONAL_KEY));
        // `mcp_get_state` n'expose que id/name/enabled/transport.
        let state = mcp_state_json(true, true, std::slice::from_ref(&server)).to_string();
        assert!(!state.contains(FICTIONAL_KEY));
        assert!(!state.contains("entree-fictive"));
    }

    #[test]
    fn vault_ref_id_accepts_plain_and_prefixed_references() {
        assert_eq!(vault_ref_id("entree"), "entree");
        assert_eq!(vault_ref_id("vault:entree"), "entree");
        assert_eq!(vault_ref_id("  vault:entree  "), "entree");
    }

    #[test]
    fn session_server_target_wins_then_first_enabled() {
        let cfg = McpConfig {
            servers: vec![
                McpServer {
                    id: "off".to_string(),
                    enabled: false,
                    ..Default::default()
                },
                fictional_remote_server(),
            ],
        };
        // Cible valide → elle gagne.
        assert_eq!(select_session_server(&cfg, Some("distant")).unwrap().id, "distant");
        // Cible absente/désactivée → repli sur le premier serveur activé.
        assert_eq!(select_session_server(&cfg, Some("inconnu")).unwrap().id, "distant");
        assert_eq!(select_session_server(&cfg, None).unwrap().id, "distant");
        // Aucun serveur activé → aucun.
        let empty = McpConfig {
            servers: vec![McpServer {
                id: "off".to_string(),
                enabled: false,
                ..Default::default()
            }],
        };
        assert!(select_session_server(&empty, None).is_none());
    }

    #[test]
    fn secret_chain_injects_only_the_key_and_stays_silent_on_failure() {
        let dir = std::env::temp_dir().join(format!("pilot_mcp_e2_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let vault_file = dir.join("vault.json");
        let config_file = dir.join("mcp.json");
        let cfg = McpConfig {
            servers: vec![fictional_remote_server()],
        };
        std::fs::write(&config_file, serde_json::to_string(&cfg).unwrap()).unwrap();

        // Coffre DÉVERROUILLÉ contenant une entrée FICTIVE (dossier temporaire).
        let entries = vec![crate::vault::VaultEntry {
            id: "entree-fictive".to_string(),
            description: "clé de test".to_string(),
            login: String::new(),
            password: FICTIONAL_KEY.to_string(),
            scope: "global".to_string(),
            project_path: None,
            created_at: 0,
            updated_at: 0,
        }];
        let key = crate::vault::write_test_vault(&vault_file, "mot-de-passe-fictif", &entries);

        // 1) Clé résolue → posée en variable, JAMAIS dans le diagnostic.
        let mut vars = vec![(
            "PILOT_MCP_CONFIG".to_string(),
            config_file.to_string_lossy().into_owned(),
        )];
        let diag = attach_mcp_secret(&mut vars, &config_file, Some(&key), &vault_file, None);
        assert_eq!(
            vars.iter().find(|(k, _)| k == "PILOT_MCP_SECRET").map(|(_, v)| v.as_str()),
            Some(FICTIONAL_KEY)
        );
        assert!(!diag.contains(FICTIONAL_KEY), "diagnostic: {}", diag);

        // 2) Référence ABSENTE du coffre → aucune clé, session quand même lancée.
        let missing = McpServer {
            id: "absent".to_string(),
            name: "Absent".to_string(),
            transport: "http".to_string(),
            enabled: true,
            url: "https://exemple.invalid/mcp".to_string(),
            secret_ref: Some("vault:introuvable".to_string()),
            ..Default::default()
        };
        let config_missing = dir.join("mcp-absent.json");
        std::fs::write(
            &config_missing,
            serde_json::to_string(&McpConfig { servers: vec![missing] }).unwrap(),
        )
        .unwrap();
        let mut vars = Vec::new();
        let diag = attach_mcp_secret(&mut vars, &config_missing, Some(&key), &vault_file, None);
        assert!(vars.is_empty(), "aucune clé ne doit être transmise");
        assert!(!diag.contains(FICTIONAL_KEY));
        assert!(diag.contains("indisponible"), "diagnostic: {}", diag);

        // 3) Coffre VERROUILLÉ → idem, aucune clé, aucun blocage.
        let mut vars = Vec::new();
        let diag = attach_mcp_secret(&mut vars, &config_file, None, &vault_file, None);
        assert!(vars.is_empty());
        assert!(!diag.contains(FICTIONAL_KEY));
        assert!(diag.contains("verrouillé"), "diagnostic: {}", diag);

        // 4) Serveur sans référence → aucune clé, message neutre.
        let plain = McpConfig {
            servers: vec![McpServer {
                id: "local".to_string(),
                enabled: true,
                command: "node".to_string(),
                ..Default::default()
            }],
        };
        let config_plain = dir.join("mcp-plain.json");
        std::fs::write(&config_plain, serde_json::to_string(&plain).unwrap()).unwrap();
        let mut vars = Vec::new();
        let diag = attach_mcp_secret(&mut vars, &config_plain, None, &vault_file, None);
        assert!(vars.is_empty());
        assert!(diag.contains("sans clé"), "diagnostic: {}", diag);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── E4 : test de connexion distant (construction de requête, lecture de
    //    réponse JSON/SSE, échec propre sans fuite de clé) ──

    #[test]
    fn remote_test_request_targets_url_with_initialize_body() {
        let req = build_remote_test_request("  https://exemple.invalid/mcp  ", None).unwrap();
        assert_eq!(req.method(), reqwest::Method::POST);
        assert_eq!(req.url().as_str(), "https://exemple.invalid/mcp");
        assert!(req.headers().get("content-type").is_some());
        let body = req.body().and_then(|b| b.as_bytes()).expect("corps de requête");
        let parsed: Value = serde_json::from_slice(body).unwrap();
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["id"], 1);
        assert_eq!(parsed["method"], "initialize");
        assert_eq!(parsed["params"]["protocolVersion"], "2024-11-05");
        assert_eq!(parsed["params"]["clientInfo"]["name"], "pilot-mcp-test");
        // Une adresse vide est refusée par un message en français.
        let err = build_remote_test_request("   ", None).unwrap_err();
        assert!(err.contains("Adresse"), "message: {}", err);
    }

    #[test]
    fn remote_test_request_puts_the_key_in_a_header_never_in_the_url() {
        let req =
            build_remote_test_request("https://exemple.invalid/mcp", Some(FICTIONAL_KEY)).unwrap();
        // La clé n'est JAMAIS dans l'adresse.
        assert_eq!(req.url().as_str(), "https://exemple.invalid/mcp");
        assert!(!req.url().as_str().contains(FICTIONAL_KEY));
        // …elle est bien dans l'en-tête d'authentification.
        let auth = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(auth, format!("Bearer {}", FICTIONAL_KEY));
        // Clé absente ou blanche → aucun en-tête.
        for secret in [None, Some(""), Some("   ")] {
            let req = build_remote_test_request("https://exemple.invalid/mcp", secret).unwrap();
            assert!(
                req.headers().get("authorization").is_none(),
                "aucun en-tête d'authentification attendu pour {:?}",
                secret
            );
        }
    }

    #[test]
    fn remote_response_reads_direct_json_and_sse_data_line() {
        // JSON direct sur une ligne.
        let direct = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}"#;
        assert_eq!(
            parse_remote_test_response(direct).unwrap()["result"]["protocolVersion"],
            "2024-11-05"
        );
        // JSON direct multi-lignes (corps complet).
        let pretty = "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"result\": { \"protocolVersion\": \"2024-11-05\" }\n}";
        assert!(parse_remote_test_response(pretty).is_some());
        // Flux d'événements : première ligne `data:` porteuse du JSON.
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2024-11-05\"}}\n\n";
        assert_eq!(
            parse_remote_test_response(sse).unwrap()["result"]["protocolVersion"],
            "2024-11-05"
        );
        // Corps illisible → None (l'appelant en fait un message d'échec).
        assert!(parse_remote_test_response("ceci n'est pas du JSON").is_none());
        assert!(parse_remote_test_response("data: pas-du-json").is_none());
        assert!(parse_remote_test_response("").is_none());
    }

    #[test]
    fn remote_failure_message_is_clean_and_never_leaks_the_key() {
        // Connexion impossible : le détail CITERAIT la clé → elle est masquée.
        let detail = format!("connexion impossible : refus avec la clé {}", FICTIONAL_KEY);
        let res = remote_test_result("Distant", None, &detail, Some(FICTIONAL_KEY));
        assert_eq!(res["ok"], false);
        let err = res["error"].as_str().unwrap();
        assert!(err.contains("connexion impossible"), "message: {}", err);
        assert!(!err.contains(FICTIONAL_KEY), "message: {}", err);

        // Réponse illisible (aucun objet JSON-RPC) → échec propre, sans clé.
        let res = remote_test_result(
            "Distant",
            None,
            "réponse illisible : aucun objet JSON-RPC exploitable",
            Some(FICTIONAL_KEY),
        );
        assert_eq!(res["ok"], false);
        assert!(!res["error"].as_str().unwrap().contains(FICTIONAL_KEY));

        // Erreur JSON-RPC renvoyée par le serveur → masquée aussi.
        let err_obj = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "code": -32000, "message": format!("clé {} refusée", FICTIONAL_KEY) }
        });
        let res = remote_test_result("Distant", Some(&err_obj), "", Some(FICTIONAL_KEY));
        assert_eq!(res["ok"], false);
        assert!(!res["error"].as_str().unwrap().contains(FICTIONAL_KEY));

        // Succès : le protocole est remonté, aucune clé dans le résultat.
        let ok_obj = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "protocolVersion": "2024-11-05" }
        });
        let res = remote_test_result("Distant", Some(&ok_obj), "", Some(FICTIONAL_KEY));
        assert_eq!(res["ok"], true);
        assert_eq!(res["protocolVersion"], "2024-11-05");
        assert_eq!(res["error"], "");
        assert!(!res.to_string().contains(FICTIONAL_KEY));
    }

    /// Le serveur peut renvoyer `error` sous forme de simple chaîne (au lieu
    /// d'un objet JSON-RPC) : le message utile doit remonter, pas un texte figé.
    #[test]
    fn remote_string_error_surfaces_a_useful_message() {
        let resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": "authentification refusée par le serveur"
        });
        let res = remote_test_result(
            "Distant",
            Some(&resp),
            "le serveur a répondu avec le statut HTTP 401",
            None,
        );
        assert_eq!(res["ok"], false);
        let err = res["error"].as_str().unwrap();
        assert!(
            err.contains("authentification refusée"),
            "message utile attendu, obtenu : {}",
            err
        );
        assert_ne!(err, "handshake error", "texte figé : {}", err);

        // Même forme, avec le message utile dans le champ frère `message`.
        let resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": "not_found",
            "message": "aucun serveur MCP à cette adresse"
        });
        let res = remote_test_result("Distant", Some(&resp), "", None);
        assert!(
            res["error"].as_str().unwrap().contains("aucun serveur MCP"),
            "message : {}",
            res["error"]
        );
    }

    /// Sans message exploitable dans `error`, on replie sur `detail` (le statut
    /// HTTP) au lieu d'un texte figé qui masquerait la cause réelle.
    #[test]
    fn remote_error_without_message_falls_back_to_the_http_status() {
        let resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "code": -32000 }
        });
        let res = remote_test_result(
            "Distant",
            Some(&resp),
            "le serveur a répondu avec le statut HTTP 403",
            None,
        );
        assert_eq!(res["ok"], false);
        let err = res["error"].as_str().unwrap();
        assert!(
            err.contains("statut HTTP 403"),
            "statut attendu, obtenu : {}",
            err
        );
        assert_ne!(err, "handshake error", "texte figé : {}", err);
    }

    #[test]
    fn unknown_transport_is_refused_with_a_clear_message() {
        assert!(unknown_transport_message("stdio").is_none());
        assert!(unknown_transport_message("STDIO").is_none());
        assert!(unknown_transport_message("http").is_none());
        assert!(unknown_transport_message("https").is_none());
        // Transport vide → transport local par défaut (même famille que stdio).
        assert!(unknown_transport_message("").is_none());
        assert!(unknown_transport_message("   ").is_none());
        let msg = unknown_transport_message("carrier-pigeon").expect("un refus attendu");
        assert!(msg.contains("carrier-pigeon"), "message: {}", msg);
        assert!(msg.contains("stdio") && msg.contains("http"), "message: {}", msg);
    }

    // ── E4 : bout en bout HORS LIGNE du test distant ──

    /// Sert UNE requête HTTP minimale sur `listener` et renvoie la requête brute
    /// reçue (en-têtes + corps). `content_type` choisit JSON direct ou flux
    /// d'événements (`data:` sur une ligne). Aucun serveur externe, aucune clé
    /// réelle : la boucle locale suffit à vérifier l'envoi et la lecture.
    fn serve_once_raw(
        listener: std::net::TcpListener,
        response: String,
    ) -> (std::thread::JoinHandle<()>, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("connexion du client test");
            let mut raw: Vec<u8> = Vec::new();
            let mut buf = [0u8; 512];
            loop {
                let n = sock.read(&mut buf).expect("lecture de la requête");
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw).into_owned();
                if let Some(pos) = text.find("\r\n\r\n") {
                    let len = text[..pos]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if raw.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&raw).into_owned();
            let _ = sock.write_all(response.as_bytes());
            let _ = sock.flush();
            let _ = tx.send(request);
        });
        (handle, rx)
    }

    /// Sert UNE requête en `200 OK` (JSON direct ou flux d'événements).
    fn serve_once(
        listener: std::net::TcpListener,
        content_type: &'static str,
        json: &'static str,
    ) -> (std::thread::JoinHandle<()>, std::sync::mpsc::Receiver<String>) {
        let response = if content_type == "text/event-stream" {
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {}\r\nconnection: close\r\n\r\nevent: message\ndata: {}\n\n",
                content_type, json
            )
        } else {
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                content_type,
                json.len(),
                json
            )
        };
        serve_once_raw(listener, response)
    }

    /// Réponse HTTP brute avec un statut arbitraire (preuve des échecs).
    fn http_response(status_line: &str, content_type: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {}\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            status_line,
            content_type,
            body.len(),
            body
        )
    }

    #[test]
    fn remote_test_connection_works_end_to_end_without_leaking_the_key() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("écoute locale");
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let ok_json =
            r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}"#;
        let server = McpServer {
            id: "distant".to_string(),
            name: "Distant".to_string(),
            transport: "http".to_string(),
            enabled: true,
            url: format!("{}/mcp", base),
            ..Default::default()
        };

        // 1) Réponse JSON directe, avec une clé FICTIVE → succès.
        let (json_thread, sent) =
            serve_once(listener.try_clone().unwrap(), "application/json", ok_json);
        let res = test_remote_connection(&server, "Distant", Some(FICTIONAL_KEY)).unwrap();
        assert_eq!(res["ok"], true, "résultat: {}", res);
        assert_eq!(res["protocolVersion"], "2024-11-05");
        assert!(!res.to_string().contains(FICTIONAL_KEY));

        let request = sent
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("requête reçue par le serveur local");
        let head = request.split("\r\n\r\n").next().unwrap_or_default();
        let request_line = head.lines().next().unwrap_or_default();
        // La clé ne fuit NI dans la ligne de requête (l'URL)…
        assert!(!request_line.contains(FICTIONAL_KEY), "requête: {}", request_line);
        assert!(request_line.starts_with("POST /mcp "), "requête: {}", request_line);
        // …ni dans le corps ; elle voyage uniquement en en-tête.
        assert!(
            head.contains(&format!("Bearer {}", FICTIONAL_KEY)),
            "en-tête d'authentification attendu: {}",
            head
        );
        assert!(
            !request.split("\r\n\r\n").nth(1).unwrap_or_default().contains(FICTIONAL_KEY),
            "le corps ne doit pas contenir la clé"
        );
        assert!(request.contains("\"method\":\"initialize\""), "requête: {}", request);
        json_thread.join().expect("serveur local JSON terminé");

        // 2) Même test avec une réponse en FLUX D'ÉVÉNEMENTS, SANS clé → succès.
        let (sse_thread, sent) =
            serve_once(listener.try_clone().unwrap(), "text/event-stream", ok_json);
        let res = test_remote_connection(&server, "Distant", None).unwrap();
        assert_eq!(res["ok"], true, "résultat: {}", res);
        assert_eq!(res["protocolVersion"], "2024-11-05");
        let request = sent
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("requête reçue par le serveur local");
        // Sans clé, aucun en-tête d'authentification n'est envoyé.
        assert!(
            !request.to_ascii_lowercase().contains("authorization:"),
            "aucun en-tête d'authentification attendu: {}",
            request
        );

        // 3) Serveur injoignable → échec propre, message masqué, aucune panique.
        sse_thread.join().expect("serveur local SSE terminé");
        let dead_url = format!("http://127.0.0.1:{}/mcp", listener.local_addr().unwrap().port());
        // Le listener est fermé : la connexion échoue immédiatement.
        drop(listener);
        let dead = McpServer {
            url: dead_url,
            ..server.clone()
        };
        let res = test_remote_connection(&dead, "Distant", Some(FICTIONAL_KEY)).unwrap();
        assert_eq!(res["ok"], false, "résultat: {}", res);
        assert!(!res["error"].as_str().unwrap_or("").contains(FICTIONAL_KEY));
    }

    // ── E8 : garde-fou final — aucun secret dans les sorties observables ──

    /// Parcourt récursivement un `Value` et collecte TOUTES les chaînes qu'il
    /// contient (clés JSON comprises) : support de la preuve de non-fuite.
    fn collect_json_strings(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::String(s) => out.push(s.clone()),
            Value::Array(items) => items.iter().for_each(|v| collect_json_strings(v, out)),
            Value::Object(map) => map.iter().for_each(|(k, v)| {
                out.push(k.clone());
                collect_json_strings(v, out);
            }),
            _ => {}
        }
    }

    /// Échoue si la valeur de la clé (FICTIVE) apparaît dans N'IMPORTE quelle
    /// chaîne de N'IMPORTE quelle sortie observable du backend MCP :
    /// `mcp_list_servers`, `mcp_get_state`, les quatre formes du résultat de
    /// `mcp_test_connection` distant, et les diagnostics d'`attach_mcp_secret`.
    #[test]
    fn all_json_outputs_of_mcp_commands_are_free_of_the_key_value() {
        let server = fictional_remote_server();

        // 1) `mcp_list_servers` : liste des serveurs sérialisée.
        let listed = serde_json::to_value(vec![server.clone()]).unwrap();
        // 2) `mcp_get_state` : `mcp_state_json`.
        let state = mcp_state_json(true, true, std::slice::from_ref(&server));
        // 3) `mcp_test_connection` (distant) : succès, erreur JSON-RPC du serveur,
        //    échec HTTP et connexion impossible. Chaque détail CITE la clé : elle
        //    doit ressortir masquée, voire absente, jamais en clair.
        let ok_obj = serde_json::json!({
            "jsonrpc": "2.0", "id": 1,
            "result": { "protocolVersion": "2024-11-05" }
        });
        let err_obj = serde_json::json!({
            "jsonrpc": "2.0", "id": 1,
            "error": { "code": -32000, "message": format!("clé {} refusée", FICTIONAL_KEY) }
        });
        let mut outputs: Vec<Value> = vec![
            listed,
            state,
            remote_test_result("Distant", Some(&ok_obj), "", Some(FICTIONAL_KEY)),
            remote_test_result("Distant", Some(&err_obj), "", Some(FICTIONAL_KEY)),
            remote_test_result(
                "Distant",
                None,
                &format!("le serveur a répondu avec le statut HTTP 500 (clé {})", FICTIONAL_KEY),
                Some(FICTIONAL_KEY),
            ),
            remote_test_result(
                "Distant",
                None,
                &format!("connexion impossible : refus de la clé {}", FICTIONAL_KEY),
                Some(FICTIONAL_KEY),
            ),
        ];

        // 4) Diagnostics d'`attach_mcp_secret` : clé résolue, coffre verrouillé,
        //    serveur local sans référence. Le diagnostic de succès mentionne la
        //    valeur via le coffre : il doit rester muet sur elle.
        let dir = std::env::temp_dir().join(format!("pilot_mcp_e8_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let vault_file = dir.join("vault.json");
        let config_file = dir.join("mcp.json");
        std::fs::write(
            &config_file,
            serde_json::to_string(&McpConfig {
                servers: vec![server.clone()],
            })
            .unwrap(),
        )
        .unwrap();
        let key = crate::vault::write_test_vault(
            &vault_file,
            "mot-de-passe-fictif",
            &[crate::vault::VaultEntry {
                id: "entree-fictive".to_string(),
                description: "clé de test".to_string(),
                login: String::new(),
                password: FICTIONAL_KEY.to_string(),
                scope: "global".to_string(),
                project_path: None,
                created_at: 0,
                updated_at: 0,
            }],
        );
        let mut vars_ok = Vec::new();
        let diag_ok = attach_mcp_secret(&mut vars_ok, &config_file, Some(&key), &vault_file, None);
        let mut vars_locked = Vec::new();
        let diag_locked =
            attach_mcp_secret(&mut vars_locked, &config_file, None, &vault_file, None);
        let config_plain = dir.join("mcp-plain.json");
        std::fs::write(
            &config_plain,
            r#"{"servers":[{"id":"local","enabled":true,"command":"node"}]}"#,
        )
        .unwrap();
        let mut vars_plain = Vec::new();
        let diag_plain =
            attach_mcp_secret(&mut vars_plain, &config_plain, None, &vault_file, None);
        for diag in [&diag_ok, &diag_locked, &diag_plain] {
            outputs.push(Value::String(diag.clone()));
        }

        // La clé est bien résolue et transmise (sinon la preuve porterait sur du vide)…
        assert_eq!(
            vars_ok
                .iter()
                .find(|(k, _)| k == "PILOT_MCP_SECRET")
                .map(|(_, v)| v.as_str()),
            Some(FICTIONAL_KEY)
        );
        // …mais elle n'apparaît dans AUCUNE chaîne d'AUCUNE sortie observée.
        for output in &outputs {
            let mut strings = Vec::new();
            collect_json_strings(output, &mut strings);
            assert!(!strings.is_empty(), "sortie vide, preuve sans objet : {}", output);
            for s in &strings {
                assert!(
                    !s.contains(FICTIONAL_KEY),
                    "secret exposé dans « {} » (sortie: {})",
                    s,
                    output
                );
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Échecs de bout en bout d'un serveur distant : statut HTTP 500 (JSON-RPC
    /// en erreur ou corps non JSON) et erreur JSON-RPC en `200 OK` citant la clé.
    /// Aucun de ces résultats ne doit laisser fuiter la valeur.
    #[test]
    fn remote_http_failures_never_leak_the_key_end_to_end() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("écoute locale");
        let url = format!(
            "http://127.0.0.1:{}/mcp",
            listener.local_addr().unwrap().port()
        );
        let server = McpServer {
            id: "distant".to_string(),
            name: "Distant".to_string(),
            transport: "http".to_string(),
            enabled: true,
            url,
            ..Default::default()
        };
        let error_body = format!(
            r#"{{"jsonrpc":"2.0","id":1,"error":{{"code":-32000,"message":"clé {} refusée"}}}}"#,
            FICTIONAL_KEY
        );

        // 1) HTTP 500 + erreur JSON-RPC citant la clé → masquée.
        let (handle, _rx) = serve_once_raw(
            listener.try_clone().unwrap(),
            http_response("500 Internal Server Error", "application/json", &error_body),
        );
        let res = test_remote_connection(&server, "Distant", Some(FICTIONAL_KEY)).unwrap();
        handle.join().expect("serveur local terminé");
        assert_eq!(res["ok"], false, "résultat: {}", res);
        assert!(!res.to_string().contains(FICTIONAL_KEY), "résultat: {}", res);

        // 2) HTTP 200 + erreur JSON-RPC citant la clé → masquée.
        let (handle, _rx) = serve_once_raw(
            listener.try_clone().unwrap(),
            http_response("200 OK", "application/json", &error_body),
        );
        let res = test_remote_connection(&server, "Distant", Some(FICTIONAL_KEY)).unwrap();
        handle.join().expect("serveur local terminé");
        assert_eq!(res["ok"], false, "résultat: {}", res);
        assert!(!res.to_string().contains(FICTIONAL_KEY), "résultat: {}", res);

        // 3) HTTP 500 + corps NON JSON citant la clé → masquée (statut seul remonté).
        let (handle, _rx) = serve_once_raw(
            listener.try_clone().unwrap(),
            http_response(
                "500 Internal Server Error",
                "text/plain",
                &format!("clé {} refusée", FICTIONAL_KEY),
            ),
        );
        let res = test_remote_connection(&server, "Distant", Some(FICTIONAL_KEY)).unwrap();
        handle.join().expect("serveur local terminé");
        assert_eq!(res["ok"], false, "résultat: {}", res);
        assert!(!res.to_string().contains(FICTIONAL_KEY), "résultat: {}", res);
        assert_eq!(res["error"], "le serveur a répondu avec le statut HTTP 500");
    }
}
