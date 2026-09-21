// proc.rs — Exécution de processus externes (socle partagé desk/serveur).
//
// Déplacé depuis `src-tauri/src/rpc.rs` (refonte GDS, L1.5a) : le serveur GDS a
// besoin des mêmes helpers que le desk pour lancer des sous-processus `git` et
// `ssh`. Le desk les réutilise via `crate::run_captured` (ré-export inchangé).

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows `CREATE_NO_WINDOW` (0x08000000) : évite qu'une fenêtre de
/// console s'ouvre à chaque sous-processus lancé par l'application. Valeur
/// identique à celle de `src-tauri/src/lib.rs` (les deux crates sont compilés
/// séparément, la constante n'est pas partageable telle quelle).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Lance `<exe> <args...>`, capture stdout, kill si `deadline` dépassé.
pub fn run_captured(exe: &str, args: &[&str], deadline_dur: std::time::Duration) -> String {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let deadline = Instant::now() + deadline_dur;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return String::new();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return String::new(),
        }
    }
    match child.wait_with_output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => String::new(),
    }
}

/// Exécute `<exe> <args...>`, capture stdout ET stderr, kill si `deadline`
/// dépassé. Retourne `(stdout, stderr, success)`. Utilisé par les helpers qui
/// ont besoin du stderr (ex: `git clone`, qui écrit sa progression et ses
/// erreurs sur stderr) pour remonter la cause réelle d'un échec au lieu d'un
/// message générique.
pub fn run_captured_full(
    exe: &str,
    args: &[&str],
    deadline_dur: std::time::Duration,
) -> (String, String, bool) {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return (String::new(), String::new(), false),
    };
    let deadline = Instant::now() + deadline_dur;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return (String::new(), String::new(), false);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return (String::new(), String::new(), false),
        }
    }
    match child.wait_with_output() {
        Ok(o) => (
            String::from_utf8_lossy(&o.stdout).to_string(),
            String::from_utf8_lossy(&o.stderr).to_string(),
            o.status.success(),
        ),
        Err(_) => (String::new(), String::new(), false),
    }
}
