// terminal.rs — Terminal intégré (xterm.js + PTY via portable-pty).
//
// Domaines extraits de `lib.rs` (2026-08) pour réduire la dette structurelle :
//   - `spawn_terminal` / `write_to_terminal` / `resize_terminal` / `kill_terminal`
//     (PTY intégré, onglet 🖥️).
//   - `get_shell_info` (choix du shell selon l'OS : cmd.exe / $SHELL).
//   - `TerminalState` (état partagé d'un PTY, stocké dans `AppState.terminals`).
//
// Utilise portable-pty : ConPTY (Windows), PTY natif (macOS/Linux).

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::AppState;

/// État d'un terminal intégré : handle du process + reader/writer du PTY.
pub struct TerminalState {
    pub running: Arc<AtomicBool>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub writer: Option<Box<dyn std::io::Write + Send>>,
}

#[tauri::command]
pub fn spawn_terminal(
    state: State<AppState>,
    app: AppHandle,
    terminal_id: String,
    run_default: bool,
) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let project_path = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    let config = state.config.lock().unwrap();

    // Déterminer le shell et les arguments
    let (shell, args): (String, Vec<String>) = get_shell_info(&project_path);

    // Commande à exécuter automatiquement
    let auto_cmd = if run_default && !config.default_command.is_empty() {
        Some(config.default_command.clone())
    } else {
        None
    };
    drop(config);

    spawn_pty(app, terminal_id, &project_path, &shell, &args, auto_cmd.as_deref())
}

/// Spawn d'un terminal dans un dossier précis, exécutant une commande donnée
/// (#17, palette de commandes du projet). `cwd` est le dossier de travail
/// absolu (racine du projet ou sous-dossier) et `command` la commande à lancer
/// (ex: `npm run build`, `cargo build`). Utilise le même mécanisme PTY que le
/// terminal intégré standard.
#[tauri::command]
pub fn spawn_terminal_command(
    app: AppHandle,
    terminal_id: String,
    cwd: String,
    command: String,
) -> Result<(), String> {
    // Le dossier de travail doit exister.
    if cwd.trim().is_empty() {
        return Err("dossier de travail vide".into());
    }
    if !std::path::Path::new(&cwd).is_dir() {
        return Err(format!("dossier introuvable : {}", cwd));
    }
    let (shell, args) = get_shell_info(&cwd);
    let auto_cmd = if command.trim().is_empty() {
        None
    } else {
        Some(command.clone())
    };
    spawn_pty(app, terminal_id, &cwd, &shell, &args, auto_cmd.as_deref())
}

/// Factorise la création d'un PTY : ouvre une paire (master/slave), spawn le
/// shell dans `cwd` avec une commande auto optionnelle, et lance le thread de
/// lecture qui stream la sortie vers le frontend (`terminal-output`).
#[allow(clippy::too_many_arguments)]
fn spawn_pty(
    app: AppHandle,
    terminal_id: String,
    cwd: &str,
    shell: &str,
    args: &[String],
    auto_cmd: Option<&str>,
) -> Result<(), String> {
    // Créer le PTY
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Erreur création PTY: {}", e))?;

    // Construire la commande
    let mut cmd = CommandBuilder::new(shell);
    cmd.args(args);
    cmd.cwd(cwd);

    // Windows : injecter le PATH complet (système + utilisateur) reconstruit
    // depuis la registry, car le PTY hérite de l'environnement du processus
    // Pilot qui peut ne pas contenir le PATH utilisateur (ex: .cargo\bin).
    #[cfg(target_os = "windows")]
    if let Some(full_path) = get_full_user_path() {
        cmd.env("PATH", full_path);
    }

    // Si une commande auto est spécifiée, on la passe différemment selon l'OS
    if let Some(ref auto) = auto_cmd {
        #[cfg(target_os = "windows")]
        {
            cmd.args(&["/k", auto]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            // On utilise l'option -c pour bash/zsh
            let shell_cmd = format!("{}; exec $SHELL", auto);
            // On remplace les args par -c et la commande
            cmd.args(&["-c", &shell_cmd]);
        }
    }

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Erreur spawn shell: {}", e))?;

    let master = pty_pair.master;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("Erreur clone reader: {}", e))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Erreur take writer: {}", e))?;

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let app_clone = app.clone();
    let id_clone = terminal_id.clone();

    // Thread de lecture : streamer la sortie du PTY vers le frontend
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if !running_clone.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data: Vec<u8> = buf[..n].to_vec();
                    let payload = serde_json::json!({
                        "id": id_clone,
                        "data": data,
                    });
                    app_clone.emit("terminal-output", &payload).ok();
                }
                Err(_) => break,
            }
        }
    });
    // Le handle est volontairement détaché : le thread s'arrête
    // quand le writer est droppé et que le read retourne EOF/erreur.
    drop(handle);

    let term_state = TerminalState {
        running,
        master,
        child,
        writer: Some(writer),
    };

    app.state::<AppState>()
        .terminals
        .lock()
        .unwrap()
        .insert(terminal_id, term_state);

    Ok(())
}

#[tauri::command]
pub fn write_to_terminal(
    state: State<AppState>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get_mut(&terminal_id)
        .ok_or("Terminal introuvable")?;

    use std::io::Write;
    if let Some(ref mut writer) = term.writer {
        writer
            .write_all(&data)
            .map_err(|e| format!("Erreur écriture terminal: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Erreur flush terminal: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get(&terminal_id)
        .ok_or("Terminal introuvable")?;

    term.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Erreur redimensionnement terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn kill_terminal(
    state: State<AppState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    if let Some(mut term) = terminals.remove(&terminal_id) {
        term.running.store(false, Ordering::Relaxed);

        // Dropper le writer envoie EOF au slave → le read retournera 0/erreur
        term.writer.take();

        // Tuer le processus enfant (force la fermeture des pipes)
        term.child.kill().ok();

        // Le thread de lecture se termine naturellement quand le pipe est fermé.
        // On ne join pas pour éviter un deadlock si le read() est bloquant.
        // Le JoinHandle est détaché, le thread finira seul.
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    ("cmd.exe".to_string(), vec![])
}

#[cfg(target_os = "macos")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    (shell, vec![])
}

#[cfg(target_os = "linux")]
fn get_shell_info(_project_path: &str) -> (String, Vec<String>) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    (shell, vec![])
}

/// Reconstruit le PATH complet (système + utilisateur) depuis la registry
/// Windows. Le PTY hérite de l'environnement du processus Pilot, qui peut ne
/// pas contenir le PATH utilisateur complet (ex: `.cargo\bin` ajouté après le
/// lancement de Pilot). On lit donc `Path` dans HKLM (système) et HKCU
/// (utilisateur), on les concatène, et on développe les variables d'environnement
/// (ex: `%SystemRoot%`) via `ExpandEnvironmentStringsW`.
#[cfg(target_os = "windows")]
fn get_full_user_path() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut parts: Vec<String> = Vec::new();

    // PATH système (HKLM)
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(env) = hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment") {
        if let Ok(p) = env.get_value::<String, _>("Path") {
            parts.push(p);
        }
    }

    // PATH utilisateur (HKCU)
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(env) = hkcu.open_subkey("Environment") {
        if let Ok(p) = env.get_value::<String, _>("Path") {
            parts.push(p);
        }
    }

    if parts.is_empty() {
        return None;
    }

    let joined = parts.join(";");

    // Développer les variables d'environnement (%SystemRoot%, %USERPROFILE%, …)
    let wide: Vec<u16> = joined.encode_utf16().chain(std::iter::once(0)).collect();
    // Premier appel pour obtenir la taille nécessaire
    let size = unsafe {
        windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            0,
        )
    };
    if size == 0 {
        return Some(joined);
    }
    let mut buf = vec![0u16; size as usize];
    let written = unsafe {
        windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            wide.as_ptr(),
            buf.as_mut_ptr(),
            size,
        )
    };
    if written == 0 {
        return Some(joined);
    }
    // Retirer le \0 final
    while buf.last() == Some(&0) {
        buf.pop();
    }
    Some(String::from_utf16_lossy(&buf))
}
