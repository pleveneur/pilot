// tailscale.rs — Automatisation Tailscale Serve (exposition HTTPS automatique)
//
// Spec : spec_web_remote.md §14. Pilot configure automatiquement Tailscale Serve
// (HTTPS 443 sur le tailnet → http://127.0.0.1:<web_port>) quand l'option
// `web_tailscale_serve` est activée, et resynchronise le proxy quand le port change.
// L'adresse d'accès (https://<dns_name>/) est stable et exposée dans l'UI desktop
// avec un bouton Copier + un QR code (SVG généré côté backend via la crate `qrcode`).
//
// Opt-in (Niveau 2) : Pilot ne modifie jamais la config Tailscale Serve sans
// consentement explicite de l'utilisateur. Exige `web_bind == 127.0.0.1` car
// Tailscale Serve forward vers `127.0.0.1`.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows `CREATE_NO_WINDOW` (0x08000000). Appliquée à chaque
/// `Command::new` silencieux pour éviter qu'une fenêtre console noire
/// n'apparaisse/disparaisse fugacement à l'écran (ex: `tailscale`, `where`).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::AppState;

/// Infos Tailscale + état du proxy serve (lecture seule, ne modifie rien).
/// Sérialisé vers le frontend desktop pour afficher le badge, l'URL et le statut.
#[derive(Serialize, Clone)]
pub struct TailscaleStatus {
    /// Tailscale est installé et détecté (binaire trouvé).
    pub available: bool,
    /// Hostname MagicDNS sans le `.` final (ex: "desktop-8l92ua5.tailc069df.ts.net").
    pub dns_name: Option<String>,
    /// Première IPv4 Tailscale (ex: "100.85.138.3").
    pub ip4: Option<String>,
    /// La machine est connectée au tailnet (Self.Online).
    pub online: bool,
    /// URL HTTPS d'accès = https://<dns_name>/ (None si dns_name absent).
    pub url: Option<String>,
    /// Tailscale Serve est configuré (un proxy existe).
    pub serve_configured: bool,
    /// Port cible du proxy (ex: 8787). None si non configuré ou non parsable.
    pub serve_target_port: Option<u16>,
    /// Message d'erreur éventuel (Tailscale absent, commande échouée, etc.).
    pub error: Option<String>,
}

impl Default for TailscaleStatus {
    fn default() -> Self {
        Self {
            available: false,
            dns_name: None,
            ip4: None,
            online: false,
            url: None,
            serve_configured: false,
            serve_target_port: None,
            error: None,
        }
    }
}

/// Résultat d'une commande de configuration du proxy.
#[derive(Serialize)]
pub struct ServeResult {
    pub ok: bool,
    pub url: Option<String>,
    pub serve_target_port: Option<u16>,
    pub error: Option<String>,
}

/// Cherche le binaire `tailscale` : d'abord dans le PATH, puis dans les chemins
/// d'installation connus par plateforme. Retourne la chaîne à passer à
/// `Command::new` (nom ou chemin absolu).
pub fn find_binary() -> Option<String> {
    // 1. PATH : `tailscale version` doit réussir.
    let mut probe = Command::new("tailscale");
    probe.arg("version");
    #[cfg(windows)]
    probe.creation_flags(CREATE_NO_WINDOW);
    if probe
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some("tailscale".to_string());
    }
    // 2. Chemins d'installation connus.
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Tailscale\tailscale.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
            PathBuf::from("/usr/local/bin/tailscale"),
            PathBuf::from("/opt/homebrew/bin/tailscale"),
        ]
    } else {
        vec![
            PathBuf::from("/usr/bin/tailscale"),
            PathBuf::from("/usr/local/bin/tailscale"),
            PathBuf::from("/snap/bin/tailscale"),
        ]
    };
    for c in candidates {
        if c.exists() {
            // Vérifier qu'il s'exécute (un fichier peut exister mais être cassé).
            let mut probe = Command::new(&c);
            probe.arg("version");
            #[cfg(windows)]
            probe.creation_flags(CREATE_NO_WINDOW);
            if probe
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(c.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Lance une commande `tailscale <args...>` et retourne son stdout (String).
fn run_tailscale(bin: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|e| format!("exécution '{}' échouée : {}", bin, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("'tailscale {}' a échoué : {}", args.join(" "), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Détection de l'état Tailscale + du proxy serve (lecture seule).
pub fn detect() -> TailscaleStatus {
    let mut st = TailscaleStatus::default();
    let bin = match find_binary() {
        Some(b) => b,
        None => {
            st.error = Some("Tailscale non trouvé (installez-le ou ajoutez-le au PATH)".into());
            return st;
        }
    };
    st.available = true;

    // `tailscale status --json` : Self.DNSName, Self.TailscaleIPs, Self.Online.
    match run_tailscale(&bin, &["status", "--json"]) {
        Ok(json_str) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                let self_node = v.get("Self");
                if let Some(dns) = self_node
                    .and_then(|s| s.get("DNSName"))
                    .and_then(|d| d.as_str())
                {
                    // Nettoyer le `.` final éventuel (FQDN MagicDNS).
                    let dns = dns.trim_end_matches('.').to_string();
                    if !dns.is_empty() {
                        st.dns_name = Some(dns.clone());
                        st.url = Some(format!("https://{}/", dns));
                    }
                }
                if let Some(ips) = self_node
                    .and_then(|s| s.get("TailscaleIPs"))
                    .and_then(|i| i.as_array())
                {
                    st.ip4 = ips
                        .iter()
                        .find_map(|ip| ip.as_str().filter(|s| s.contains('.')))
                        .map(|s| s.to_string());
                }
                st.online = self_node
                    .and_then(|s| s.get("Online"))
                    .and_then(|o| o.as_bool())
                    .unwrap_or(false);
            }
        }
        Err(e) => {
            st.error = Some(format!("Tailscale inaccessible : {}", e));
        }
    }

    // Statut du proxy serve : `tailscale serve status`.
    match run_tailscale(&bin, &["serve", "status"]) {
        Ok(out) => {
            // Ligne type : `|-- / proxy http://127.0.0.1:8790`
            if out.contains("proxy") {
                st.serve_configured = true;
                st.serve_target_port = parse_proxy_port(&out);
            }
        }
        Err(e) => {
            // `serve status` peut retourner un code non-zéro quand rien n'est
            // configuré → c'est juste « non configuré », pas une erreur bloquante.
            if !st.error.is_some() {
                st.error = Some(format!("serve status : {}", e));
            }
        }
    }
    st
}

/// Extrait le port cible d'une sortie `tailscale serve status`
/// (cherche `http://127.0.0.1:<port>` ou `http://localhost:<port>`).
fn parse_proxy_port(out: &str) -> Option<u16> {
    for line in out.lines() {
        let l = line.trim();
        if !l.contains("proxy") {
            continue;
        }
        // Capturer le port après `http://host:`.
        if let Some(rest) = l.split("http://").nth(1) {
            if let Some(port_part) = rest.split(':').nth(1) {
                let digits: String = port_part.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(p) = digits.parse::<u16>() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Configure Tailscale Serve vers `http://127.0.0.1:<port>` (HTTPS 443 sur le
/// tailnet). Idempotent : ne reset pas si déjà configuré vers le bon port.
/// Retourne l'URL d'accès.
pub fn configure_serve(port: u16) -> Result<String, String> {
    let bin = find_binary()
        .ok_or_else(|| "Tailscale non trouvé".to_string())?;

    // Vérifier l'état courant pour éviter un reset inutile.
    let current = run_tailscale(&bin, &["serve", "status"]).unwrap_or_default();
    if current.contains("proxy") {
        if let Some(cur_port) = parse_proxy_port(&current) {
            if cur_port == port {
                // Déjà configuré vers le bon port → rien à faire.
                let st = detect();
                return st.url.ok_or_else(|| "URL Tailscale indisponible".to_string());
            }
        }
    }

    // reset puis serve --bg --https=443 http://127.0.0.1:<port>
    // `reset` peut échouer si rien n'est configuré → on ignore l'erreur.
    let _ = run_tailscale(&bin, &["serve", "reset"]);
    run_tailscale(
        &bin,
        &[
            "serve",
            "--bg",
            "--https=443",
            &format!("http://127.0.0.1:{}", port),
        ],
    )
    .map_err(|e| format!("configuration Tailscale Serve : {}", e))?;

    let st = detect();
    st.url.ok_or_else(|| "Tailscale Serve configuré mais URL indisponible".to_string())
}

/// Désactive Tailscale Serve (`tailscale serve reset`).
pub fn disable_serve() -> Result<(), String> {
    let bin = find_binary().ok_or_else(|| "Tailscale non trouvé".to_string())?;
    // reset est idempotent (OK si rien n'était configuré).
    run_tailscale(&bin, &["serve", "reset"])
        .map(|_| ())
        .or(Ok(())) // ignorer l'erreur si rien n'était configuré
}

/// Resync automatique du proxy : appelée par `start_if_enabled` /
/// `restart_web_server` quand `web_tailscale_serve` est activé. Ne fait rien si
/// l'option est off, si le serveur web est désactivé, ou si le bind n'est pas
/// 127.0.0.1 (le proxy forward vers 127.0.0.1, injoignable sinon).
pub fn sync_serve_if_enabled(app: &AppHandle) {
    let cfg = app.state::<AppState>().config.lock().unwrap().clone();
    if !cfg.web_tailscale_serve || !cfg.web_enabled {
        return;
    }
    if cfg.web_bind != "127.0.0.1" && cfg.web_bind != "localhost" {
        eprintln!(
            "[tailscale] ⚠️ web_bind='{}' != 127.0.0.1 — Tailscale Serve (forward 127.0.0.1) ne joindra pas le serveur. Remettez le bind sur 127.0.0.1 dans les Paramètres.",
            cfg.web_bind
        );
        return;
    }
    let port = u16::try_from(cfg.web_port).unwrap_or(8787);
    match configure_serve(port) {
        Ok(url) => eprintln!("[tailscale] Serve configuré vers le port {} → {}", port, url),
        Err(e) => eprintln!("[tailscale] sync échouée : {}", e),
    }
}

// ── Commandes Tauri (exposées au frontend desktop) ──

#[tauri::command]
pub fn tailscale_status() -> TailscaleStatus {
    detect()
}

#[tauri::command]
pub fn tailscale_enable_serve(app: AppHandle) -> ServeResult {
    let cfg = app.state::<AppState>().config.lock().unwrap().clone();
    // Tailscale Serve forward vers 127.0.0.1 : exiger un bind local.
    if cfg.web_bind != "127.0.0.1" && cfg.web_bind != "localhost" {
        return ServeResult {
            ok: false,
            url: None,
            serve_target_port: None,
            error: Some(format!(
                "« Adresse d'écoute » = '{}' : doit être 127.0.0.1 (Tailscale Serve forward vers 127.0.0.1). Changez le bind dans les Paramètres puis reconfigurez.",
                cfg.web_bind
            )),
        };
    }
    let port = u16::try_from(cfg.web_port).unwrap_or(8787);
    match configure_serve(port) {
        Ok(url) => {
            let st = detect();
            ServeResult {
                ok: true,
                url: Some(url),
                serve_target_port: st.serve_target_port,
                error: None,
            }
        }
        Err(e) => ServeResult {
            ok: false,
            url: None,
            serve_target_port: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub fn tailscale_disable_serve() -> Result<(), String> {
    disable_serve()
}

/// Génère un QR code SVG de l'URL passée (rendu manuel via parcours des modules).
#[tauri::command]
pub fn tailscale_serve_qrcode(url: String) -> Result<String, String> {
    if url.trim().is_empty() {
        return Err("URL vide".to_string());
    }
    let code = qrcode::QrCode::new(url.as_bytes())
        .map_err(|e| format!("génération QR : {}", e))?;
    let size = code.width();
    let colors = code.into_colors(); // Vec<Color>, len = size*size
    let scale: usize = 8;
    let quiet: usize = 2; // marge blanche (modules)
    let dim = (size + quiet * 2) * scale;
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">",
        w = dim, h = dim
    );
    svg.push_str(&format!(
        "<rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>",
        w = dim, h = dim
    ));
    for y in 0..size {
        for x in 0..size {
            let dark = colors[y * size + x] == qrcode::types::Color::Dark;
            if dark {
                let px = (x + quiet) * scale;
                let py = (y + quiet) * scale;
                svg.push_str(&format!(
                    "<rect x=\"{x}\" y=\"{y}\" width=\"{s}\" height=\"{s}\" fill=\"#000\"/>",
                    x = px, y = py, s = scale
                ));
            }
        }
    }
    svg.push_str("</svg>");
    Ok(svg)
}