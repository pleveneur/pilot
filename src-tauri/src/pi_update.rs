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
use tauri::State;

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
fn run_update_captured(exe: &str, deadline_dur: Duration) -> (bool, String) {
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
    cmd.args(["update", "--self"])
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

/// Met à jour Pi via sa commande intégrée `pi update --self`.
#[tauri::command]
pub fn update_pi(state: State<AppState>) -> PiUpdateResult {
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
    let (ok, out) = run_update_captured(&pi_path, Duration::from_secs(180));
    if !ok {
        return PiUpdateResult {
            ok: false,
            output: out,
            error: "update_failed".into(),
        };
    }
    PiUpdateResult {
        ok: true,
        output: out,
        error: String::new(),
    }
}
