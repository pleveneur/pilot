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
//       mcp_test_connection   → lance le serveur stdio et vérifie la handshake
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
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows pour CREATE_NO_WINDOW (0x08000000).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Un serveur MCP configurable. Le transport reste une chaîne : `"stdio"` par
/// défaut (mode local, seul transport effectivement consommé par le POC).
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

fn first_enabled_stdio(cfg: &McpConfig) -> Option<&McpServer> {
    cfg.servers
        .iter()
        .find(|s| s.enabled && s.transport.trim().eq_ignore_ascii_case("stdio"))
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
#[tauri::command]
pub fn mcp_get_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<crate::AppState>();
    let enabled = state.config.lock().unwrap().mcp_enabled;
    let confirm = state.config.lock().unwrap().mcp_agent_confirm;
    let servers = read_mcp_config(&app).map(|c| c.servers).unwrap_or_default();
    Ok(serde_json::json!({
        "enabled": enabled,
        "confirm": confirm,
        "servers": servers.iter().map(|s| serde_json::json!({
            "id": s.id,
            "name": s.name,
            "enabled": s.enabled,
            "transport": s.transport,
        })).collect::<Vec<_>>(),
    }))
}

/// Teste la connexion à un serveur MCP stdio : lance la commande et vérifie la
/// handshake MCP (`initialize` → réponse) avec un timeout. Retourne
/// `{ ok, server, error }` où `ok` indique le succès de la handshake.
#[tauri::command]
pub fn mcp_test_connection(_app: AppHandle, server: McpServer) -> Result<serde_json::Value, String> {
    let timeout = std::time::Duration::from_secs(8);
    let label = if server.name.is_empty() {
        server.id.clone()
    } else {
        server.name.clone()
    };

    if server.command.trim().is_empty() {
        return Err("Commande du serveur vide".to_string());
    }
    if !server.transport.trim().eq_ignore_ascii_case("stdio") {
        return Err("POC : seul le transport stdio est supporté".to_string());
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
    fn first_enabled_stdio_ignores_unknown_and_disabled_transports() {
        let cfg = McpConfig {
            servers: vec![
                // Désactivé → ignoré
                McpServer {
                    id: "off".to_string(),
                    transport: "stdio".to_string(),
                    enabled: false,
                    command: "x".to_string(),
                    ..Default::default()
                },
                // Transport réellement inconnu → ignoré (traité comme local,
                // mais pas `stdio` au sens strict de first_enabled_stdio)
                McpServer {
                    id: "unknown".to_string(),
                    transport: "carrier-pigeon".to_string(),
                    enabled: true,
                    command: "y".to_string(),
                    ..Default::default()
                },
                sample_server(),
            ],
        };
        let picked = first_enabled_stdio(&cfg).expect("un serveur stdio enabled");
        assert_eq!(picked.id, "test");
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
}
