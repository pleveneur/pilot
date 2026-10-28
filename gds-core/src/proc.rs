// proc.rs — Exécution de processus externes (socle partagé desk/serveur).
//
// Déplacé depuis `src-tauri/src/rpc.rs` (refonte GDS, L1.5a) : le serveur GDS a
// besoin des mêmes helpers que le desk pour lancer des sous-processus `git` et
// `ssh`. Le desk les réutilise via `crate::run_captured` (ré-export inchangé).

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows `CREATE_NO_WINDOW` (0x08000000) : évite qu'une fenêtre de
/// console s'ouvre à chaque sous-processus lancé par l'application.
///
/// **Seule définition du drapeau dans tout le dépôt.** Elle n'est utilisée que
/// par [`hide_console`], qui est le point unique de masquage : le desk
/// (`src-tauri`) l'appelle via `gds_core::proc::hide_console` (ré-exporté par
/// `crate::hide_console`), `gds-server` compile le même module. Aucun autre
/// fichier ne doit écrire ce littéral (verrouillé par
/// `src/js/fenetres-noires-lancements.test.js`).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// **Point unique** de masquage de la fenêtre de console d'un lancement de
/// processus : à appeler sur le `Command` avant `spawn`/`output`/`status`.
///
/// Sous Windows, Pilot est une application GUI (sous-système `windows`, sans
/// console) : lancer un programme console sans ce drapeau ouvre réellement une
/// fenêtre noire qui clignote. Le masquage est **transitif** : ce processus et
/// toute sa descendance restent sans fenêtre.
///
/// Sur macOS et Linux, le drapeau n'existe pas et aucune fenêtre de console ne
/// s'ouvre : la fonction ne fait rien (même signature, aucun `cfg` chez
/// l'appelant).
pub fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Lance `<exe> <args...>`, capture stdout, kill si `deadline` dépassé.
pub fn run_captured(exe: &str, args: &[&str], deadline_dur: std::time::Duration) -> String {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
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
    hide_console(&mut cmd);
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
