// pi_update.rs — Détection et mise à jour de l'agent Pi (issue #26)
//
// À l'ouverture de l'onglet agent, Pilot vérifie si une nouvelle version de Pi
// est disponible (endpoint officiel https://pi.dev/api/latest-version) et
// propose à l'utilisateur de la mettre à jour via la commande intégrée
// `pi update --self`. Uniquement pour le backend `pi` (pas `plh`, qui est une
// réimplémentation Rust non mise à jour via `pi update`). L'utilisateur peut
// choisir « Ne plus demander » (flag `pi_skip_update_check` dans la config).

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{kind_from_version_output, run_captured, AppState};

/// Résultat de la vérification de mise à jour de Pi.
#[derive(Serialize)]
pub struct PiUpdateCheck {
    pub update_available: bool,
    pub current: String,
    pub latest: String,
    /// Raison si aucune mise à jour proposée : "", "no_path", "not_pi",
    /// "fetch_failed", "up_to_date".
    pub reason: String,
}

/// Résultat de la mise à jour de Pi.
#[derive(Serialize)]
pub struct PiUpdateResult {
    pub ok: bool,
    pub output: String,
    pub error: String,
}

/// Compare deux versions semver "X.Y.Z" → -1, 0, 1. Retourne 0 si non parsable.
fn compare_versions(a: &str, b: &str) -> i32 {
    fn parse(v: &str) -> Option<(u32, u32, u32)> {
        let s = v.trim().trim_start_matches('v');
        let mut it = s.split('.');
        let major = it.next()?.parse().ok()?;
        let minor = it.next()?.parse().ok()?;
        let patch = it.next()?.parse().ok()?;
        Some((major, minor, patch))
    }
    let (pa, pb) = match (parse(a), parse(b)) {
        (Some(x), Some(y)) => (x, y),
        _ => return 0,
    };
    if pa.0 != pb.0 {
        return if pa.0 < pb.0 { -1 } else { 1 };
    }
    if pa.1 != pb.1 {
        return if pa.1 < pb.1 { -1 } else { 1 };
    }
    if pa.2 != pb.2 {
        return if pa.2 < pb.2 { -1 } else { 1 };
    }
    0
}

/// Récupère la dernière version de Pi depuis l'endpoint officiel.
fn fetch_latest_version() -> Option<String> {
    let resp = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?
        .get("https://pi.dev/api/latest-version")
        .send()
        .ok()?;
    let json: serde_json::Value = resp.json().ok()?;
    json.get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Vérifie si une mise à jour de Pi est disponible. Ne propose que pour le
/// backend `pi` (pas `plh`). Retourne `update_available=false` si le chemin est
/// vide, si le backend n'est pas pi, si la récupération échoue, ou si à jour.
#[tauri::command]
pub fn check_pi_update(state: State<AppState>) -> PiUpdateCheck {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return PiUpdateCheck {
            update_available: false,
            current: String::new(),
            latest: String::new(),
            reason: "no_path".into(),
        };
    }
    let out = run_captured(&pi_path, &["--version"], Duration::from_secs(10));
    let current = out.trim().to_string();
    if kind_from_version_output(&out) != "pi" {
        return PiUpdateCheck {
            update_available: false,
            current,
            latest: String::new(),
            reason: "not_pi".into(),
        };
    }
    let latest = match fetch_latest_version() {
        Some(v) => v,
        None => {
            return PiUpdateCheck {
                update_available: false,
                current,
                latest: String::new(),
                reason: "fetch_failed".into(),
            }
        }
    };
    if compare_versions(&current, &latest) < 0 {
        PiUpdateCheck {
            update_available: true,
            current,
            latest,
            reason: String::new(),
        }
    } else {
        PiUpdateCheck {
            update_available: false,
            current,
            latest,
            reason: "up_to_date".into(),
        }
    }
}

/// Exécute `pi update --self` en redirigeant la sortie vers un fichier
/// temporaire (évite tout deadlock de pipe si la sortie est volumineuse).
/// Retourne `(succès, sortie)`.
fn run_update_captured(exe: &str, base_args: &[String], deadline_dur: Duration) -> (bool, String) {
    use std::process::{Command, Stdio};
    use std::time::Instant;
    let tmp = std::env::temp_dir().join(format!("pilot-pi-update-{}.log", std::process::id()));
    let file = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(_) => return (false, String::new()),
    };
    let file2 = match file.try_clone() {
        Ok(f) => f,
        Err(_) => return (false, String::new()),
    };
    let mut cmd = Command::new(exe);
    cmd.args(base_args)
        .args(["update", "--self"])
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(file2));
    #[cfg(windows)]
    cmd.creation_flags(crate::CREATE_NO_WINDOW);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            return (false, String::new());
        }
    };
    let deadline = Instant::now() + deadline_dur;
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    break false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break false,
        }
    };
    let out = std::fs::read_to_string(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    (ok, out)
}

/// Normalise le chemin d'exécution de pi. Sur Windows le chemin configuré peut
/// être un shim npm global (`pi.cmd` / `pi.ps1` / `pi.bat`) que `Command::new`
/// ne sait pas exécuter directement. Si c'est un shim, on résout vers le vrai
/// script `node_modules\pi\cli.js` exécuté via `node`. Retourne
/// `(exécutable, arguments de base)`. Repli : le chemin d'origine (ou "pi" si
/// vide, pour laisser le PATH résoudre). Utilisé par la mise à jour et par
/// `rpc_manager::spawn_and_start` (sessions RPC).
pub(crate) fn resolve_pi_executable(pi_path: &str) -> (String, Vec<String>) {
    let trimmed = pi_path.trim();
    if trimmed.is_empty() {
        return ("pi".to_string(), Vec::new());
    }
    let lower = trimmed.to_lowercase();
    let is_shim =
        lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".ps1");
    if !is_shim {
        // Pas un shim explicite : on garde le chemin tel quel (exe direct,
        // "pi", chemin vers node, etc.).
        return (trimmed.to_string(), Vec::new());
    }
    // Shim npm global : le script réel vit dans `node_modules\pi\cli.js`
    // adjacent au shim (ex. C:\Users\x\AppData\Roaming\npm\pi.cmd
    // → ...\npm\node_modules\pi\cli.js). On l'exécute via `node`.
    if let Some(parent) = std::path::Path::new(trimmed).parent() {
        let cli = parent.join("node_modules").join("pi").join("cli.js");
        if cli.exists() {
            return ("node".to_string(), vec![cli.to_string_lossy().to_string()]);
        }
    }
    (trimmed.to_string(), Vec::new())
}

/// Convertit un échec de mise à jour en message orienté utilisateur (français),
/// en détectant la cause probable depuis la sortie capturée. Retourne une chaîne
/// vide si la mise à jour a réussi.
fn update_error_hint(ok: bool, out: &str) -> String {
    if ok {
        return String::new();
    }
    let lower = out.to_lowercase();
    if lower.contains("not writable")
        || lower.contains("eperm")
        || lower.contains("eacces")
        || lower.contains("access denied")
        || lower.contains("permission denied")
    {
        "L'installation de Pi est protégée en écriture. Lance la mise à jour en administrateur, ou réinstalle Pi manuellement.".to_string()
    } else if lower.contains("command not found")
        || lower.contains("not recognized")
        || lower.contains("no such file")
    {
        "La commande de mise à jour de Pi est introuvable. Vérifie que Pi est installé et accessible dans le PATH.".to_string()
    } else if lower.contains("ebusy")
        || lower.contains("being used by another process")
        || lower.contains("text file busy")
    {
        "Un processus Pi utilise encore les fichiers. Ferme les autres agents Pi puis réessaie.".to_string()
    } else if !out.trim().is_empty() {
        // Pas de cause connue : remonter un court extrait de la sortie réelle
        // pour aider au diagnostic (jamais technique, jamais de stack complète).
        let short = out
            .trim()
            .lines()
            .take(5)
            .collect::<Vec<_>>()
            .join(" | ");
        format!("Échec de la mise à jour de Pi : {}", short)
    } else {
        "Échec de la mise à jour de Pi (aucune sortie).".to_string()
    }
}

/// Met à jour Pi via sa commande intégrée `pi update --self`.
///
/// 3. Avant de lancer la mise à jour, arrête TOUTES les sessions RPC de pi pour
///    libérer les verrous de fichiers (Windows : le processus pi en cours
///    verrouille son propre exécutable/scripts, ce qui fait échouer
///    `pi update --self`). La session principale est relancée par le frontend
///    après la mise à jour (événement `pilot-agent-restart-needed`).
/// 4. Normalise le chemin d'exécution si c'est un shim `.cmd`/`.ps1` (node +
///    cli.js), car `Command::new` ne sait pas exécuter un `.cmd`/`.bat`.
#[tauri::command]
pub fn update_pi(state: State<AppState>, _app: AppHandle) -> PiUpdateResult {
    let config = state.config.lock().unwrap();
    let pi_path = config.rpc_pi_path.clone();
    drop(config);
    if pi_path.is_empty() {
        return PiUpdateResult {
            ok: false,
            output: String::new(),
            error: "no_path".into(),
        };
    }
    // 3. Verrou process : arrêter toutes les sessions RPC de pi (sessions
    // actives, parkées, agents délégués, reviewer, super-agent) pour libérer
    // les verrous de fichiers avant de remplacer le binaire.
    state.agent_service.shutdown_all();

    // 4. Robustesse shim : résoudre le vrai exécutable avant le spawn.
    let (exe, base_args) = resolve_pi_executable(&pi_path);
    let (ok, out) = run_update_captured(&exe, &base_args, Duration::from_secs(180));

    // 1. Diagnosité : remonter un message clair (ou un extrait de la sortie
    // réelle) à l'UI au lieu d'un échec muet générique.
    let error = update_error_hint(ok, &out);
    if !ok {
        return PiUpdateResult {
            ok: false,
            output: out,
            error,
        };
    }
    PiUpdateResult {
        ok: true,
        output: out,
        error,
    }
}
