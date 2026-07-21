// rpc_manager.rs — Gestion du processus pi --mode rpc (JSONL stdin/stdout)

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Constante Windows pour CREATE_NO_WINDOW (0x08000000)
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// État d'une session RPC Pi
pub struct RpcSession {
    pub child: Child,
    pub stdin: ChildStdin,
    pub running: Arc<AtomicBool>,
    /// Commandes synchrones en attente de réponse (id → oneshot sender)
    pub pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
}

/// Lance le processus `pi --mode rpc` et démarre le thread de lecture stdout.
/// `pi_path` : chemin vers l'exécutable pi ("pi" si dans le PATH).
/// `no_session` : si true, ajoute --no-session (pas de persistance).
pub fn spawn_and_start(cwd: &str, pi_path: &str, no_session: bool, session_dir: &str, skill_path: Option<&str>, extension_path: Option<&str>, app_handle: AppHandle, event_tx: tokio::sync::broadcast::Sender<Value>) -> Result<RpcSession, String> {
    let pi_exe = if pi_path.is_empty() { "pi" } else { pi_path };

    let mut cmd = Command::new(pi_exe);
    cmd.args(["--mode", "rpc"]);
    if no_session {
        cmd.arg("--no-session");
    }
    if !session_dir.is_empty() {
        cmd.args(["--session-dir", session_dir]);
    }
    // Quality-gate interne (Évolution 7) : skill embarqué par Pilot, ajouté quand
    // l'option est activée. Les autres skills globaux restent chargés (découverte auto).
    if let Some(sp) = skill_path {
        if !sp.is_empty() {
            cmd.args(["--skill", sp]);
        }
    }
    // Diff Review (A4 V2) : extension pilot-edit-gate (porte pré-écriture).
    // Toujours chargée — l'auto-approve se décide côté Pilot (client RPC).
    if let Some(ep) = extension_path {
        if !ep.is_empty() {
            cmd.args(["--extension", ep]);
        }
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Erreur lancement de pi: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or("Impossible de capturer stdin du processus pi")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Impossible de capturer stdout du processus pi")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Impossible de capturer stderr du processus pi")?;

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let running_stderr = running.clone();
    let pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let pending_clone = pending.clone();
    let app_clone = app_handle.clone();

    // Thread de lecture stdout
    let app_exit = app_handle.clone();
    let running_exit = running.clone();
    std::thread::spawn(move || {
        read_jsonl_loop(Box::new(stdout), app_clone, running_clone, pending_clone, event_tx);
        // Ne signaler un process_exit que pour une fin involontaire (pi mort/crash).
        // Un arrêt volontaire (stop_session a passé running=false, ex. redémarrage
        // pour un changement de projet distant) n'émet rien → le desktop
        // n'affiche pas « Déconnecté » (le pi est redémarré juste après).
        if running_exit.load(Ordering::Relaxed) {
            let exit_event = serde_json::json!({"type": "process_exit", "reason": "stdout_closed"});
            app_exit.emit("rpc-event", &exit_event).ok();
        }
    });

    // Thread de lecture stderr
    let app_stderr = app_handle.clone();
    std::thread::spawn(move || {
        read_stderr_loop(Box::new(stderr), app_stderr, running_stderr);
    });

    Ok(RpcSession {
        child,
        stdin,
        running,
        pending,
    })
}

/// Envoie une commande JSON sur stdin du processus pi
pub fn send_command(session: &mut RpcSession, command: &Value) -> Result<(), String> {
    if !session.running.load(Ordering::Relaxed) {
        return Err("Session arrêtée".to_string());
    }
    let line = serde_json::to_string(command).map_err(|e| format!("Erreur sérialisation: {}", e))?;
    writeln!(session.stdin, "{}", line).map_err(|e| format!("Erreur écriture stdin: {}", e))?;
    session
        .stdin
        .flush()
        .map_err(|e| format!("Erreur flush stdin: {}", e))?;
    Ok(())
}

/// Envoie une commande et attend la réponse (pour les commandes synchrones).
/// Utilise un oneshot channel corrélé par l'`id` de la commande.
/// `timeout_secs` : délai max d'attente (défaut 30s). Des commandes légères
/// (get_available_models, get_state) utilisent un délai plus court pour ne pas
/// bloquer l'UI 30s si pi est mort/bloqué juste après un redémarrage.
pub fn send_command_sync(
    session: &mut RpcSession,
    command: Value,
) -> Result<Value, String> {
    send_command_sync_timeout(session, command, 30)
}

pub fn send_command_sync_timeout(
    session: &mut RpcSession,
    mut command: Value,
    timeout_secs: u64,
) -> Result<Value, String> {
    // Générer un id unique si non fourni
    let id = format!("rpc-{}", uuid_simple());
    command["id"] = Value::String(id.clone());

    let (tx, rx) = mpsc::channel();
    {
        let mut pending = session.pending.lock().unwrap();
        pending.insert(id, tx);
    }

    send_command(session, &command)?;

    rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
        .map_err(|_| format!("Timeout ({}s) ou canal fermé en attente de réponse", timeout_secs))
}

/// Arrête proprement le processus pi
pub fn stop_session(session: &mut RpcSession) {
    session.running.store(false, Ordering::Relaxed);
    // Vérifier si le processus est encore en vie avant d'écrire
    match session.child.try_wait() {
        Ok(Some(_)) => {
            // Déjà terminé, rien à faire
            return;
        }
        Ok(None) => {
            // Encore en vie, envoyer abort
            let _ = writeln!(session.stdin, r#"{{"type":"abort"}}"#);
            session.stdin.flush().ok();
            // Laisser le temps à pi de traiter l'abort, puis killer
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        Err(_) => {
            // Erreur lors du check, on tente quand même de killer
        }
    }
    session.child.kill().ok();
    session.child.wait().ok();
}

// ── JSONL Parser (thread stdout) ──

fn read_jsonl_loop(
    mut reader: Box<dyn Read + Send>,
    app_handle: AppHandle,
    running: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
    event_tx: tokio::sync::broadcast::Sender<Value>,
) {
    let mut buffer = String::new();
    let mut buf = [0u8; 4096];

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF (pi terminé)
            Ok(n) => {
                // En cours d'arrêt (stop_session a passé running=false) : on draine
                // le pipe sans traiter ni émettre, jusqu'à EOF. Cela garde le pipe
                // ouvert côté lecture tant que pi n'est pas mort → évite un EPIPE
                // ("broken pipe, write") côté pi (node) qui crasherait bruyamment.
                if !running.load(Ordering::Relaxed) {
                    continue;
                }

                buffer.push_str(&String::from_utf8_lossy(&buf[..n]));

                // Split sur \n uniquement (pas U+2028, U+2029)
                while let Some(pos) = buffer.find('\n') {
                    let mut line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();

                    // Trim \r final si présent (tolérance CRLF)
                    if line.ends_with('\r') {
                        line.pop();
                    }

                    if line.is_empty() {
                        continue;
                    }

                    // Parser JSON
                    match serde_json::from_str::<Value>(&line) {
                        Ok(value) => {
                            // Si c'est une réponse avec id → corréler avec la commande en attente
                            if value.get("type").and_then(|v| v.as_str()) == Some("response") {
                                if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                                    let mut pending_map = pending.lock().unwrap();
                                    if let Some(sender) = pending_map.remove(id) {
                                        sender.send(value).ok();
                                        continue; // Ne pas émettre l'événement
                                    }
                                }
                            }

                            // Émettre l'événement vers le frontend pour tout le reste
                            app_handle.emit("rpc-event", &value).ok();
                            // Fan-out parallèle vers les WebSockets distants (décision 13.3).
                            // Sender::send n'est pas async → appel valide depuis ce thread std.
                            // Une erreur (pas de receiver / lent) est ignorée : le client web
                            // resynchronise son état au reconnect via les fetch REST (§5).
                            let _ = event_tx.send(value.clone());
                        }
                        Err(e) => {
                            eprintln!(
                                "[rpc] Erreur parsing JSON: {} — ligne: {}",
                                e, line
                            );
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }
}

/// Thread de lecture stderr — émet les erreurs sous forme d'événements rpc-event
fn read_stderr_loop(
    mut reader: Box<dyn Read + Send>,
    app_handle: AppHandle,
    running: Arc<AtomicBool>,
) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF
            Ok(n) => {
                // Drain mode pendant l'arrêt (running=false) : on garde le pipe
                // ouvert (évite un EPIPE côté pi) sans remonter le bruit stderr de
                // fin de process.
                if !running.load(Ordering::Relaxed) {
                    continue;
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let event = serde_json::json!({
                    "type": "process_error",
                    "text": text,
                });
                app_handle.emit("rpc-event", &event).ok();
            }
            Err(_) => break,
        }
    }
}

/// Génère un UUID simple (8 caractères hexa, suffisant pour la corrélation)
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:08x}", ts as u32)
}

// ── Conversion PDF → Markdown via session RPC temporaire ──

/// Lance un processus pi --mode rpc temporaire, envoie un prompt de restructuration
/// Markdown, collecte la réponse, et retourne le texte restructuré.
/// Le processus est nettoyé après utilisation.
pub fn convert_text_with_pi(
    cwd: &str,
    pi_path: &str,
    provider: &str,
    model_id: &str,
    prompt: &str,
) -> Result<String, String> {
    let pi_exe = if pi_path.is_empty() { "pi" } else { pi_path };

    // Spawn pi --mode rpc --no-session
    let mut cmd = std::process::Command::new(pi_exe);
    cmd.args(["--mode", "rpc", "--no-session"])
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer pi pour la conversion PDF → MD : {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Impossible d'accéder à stdin")?;
    let stdout = child.stdout.take().ok_or("Impossible d'accéder à stdout")?;
    let mut stderr_child = child.stderr.take().ok_or("Impossible d'accéder à stderr")?;

    // Envoyer les commandes de séquence
    // 1. new_session
    writeln!(stdin, "{{\"type\":\"new_session\"}}")
        .map_err(|e| format!("Erreur envoi new_session : {}", e))?;
    stdin.flush().map_err(|e| format!("Erreur flush : {}", e))?;

    // 2. set_model (si un modèle est spécifié)
    if !provider.is_empty() || !model_id.is_empty() {
        let set_model = serde_json::json!({
            "type": "set_model",
            "provider": provider,
            "modelId": model_id
        });
        writeln!(stdin, "{}", serde_json::to_string(&set_model).unwrap_or_default())
            .map_err(|e| format!("Erreur envoi set_model : {}", e))?;
        stdin.flush().map_err(|e| format!("Erreur flush : {}", e))?;
    }

    // 3. prompt
    let prompt_cmd = serde_json::json!({
        "type": "prompt",
        "message": prompt
    });
    writeln!(stdin, "{}", serde_json::to_string(&prompt_cmd).unwrap_or_default())
        .map_err(|e| format!("Erreur envoi prompt : {}", e))?;
    stdin.flush().map_err(|e| format!("Erreur flush : {}", e))?;

    // Fermer stdin pour signaler à pi qu'on n'enverra plus de commandes
    drop(stdin);

    // Lire la réponse de stdout jusqu'à agent_end ou timeout
    let reader = BufReader::new(stdout);
    let mut collected_text = String::new();
    let timeout = std::time::Duration::from_secs(120);
    let start = std::time::Instant::now();

    for line in reader.lines() {
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Timeout : la conversion a pris plus de 2 minutes".to_string());
        }

        match line {
            Ok(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<Value>(trimmed) {
                    Ok(event) => {
                        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

                        match event_type {
                            "message_update" => {
                                let delta = event.get("assistantMessageEvent");
                                if let Some(delta) = delta {
                                    let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                    if delta_type == "text_delta" {
                                        if let Some(text) = delta.get("delta").and_then(|v| v.as_str()) {
                                            collected_text.push_str(text);
                                        }
                                    }
                                }
                            }
                            "message" => {
                                // Message complet (non streamé)
                                if let Some(msg) = event.get("message") {
                                    if msg.get("role").and_then(|v| v.as_str()) == Some("assistant") {
                                        if let Some(content) = msg.get("content").and_then(|v| v.as_str()) {
                                            collected_text.push_str(content);
                                        }
                                        if let Some(parts) = msg.get("content").and_then(|v| v.as_array()) {
                                            for part in parts {
                                                if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                                                    if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                                                        collected_text.push_str(t);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "agent_end" => {
                                // Fin de la réponse
                                let _ = child.kill();
                                let _ = child.wait();
                                if collected_text.is_empty() {
                                    return Err("L'IA n'a retourné aucun texte".to_string());
                                }
                                return Ok(collected_text);
                            }
                            "process_exit" | "extension_error" => {
                                let _ = child.kill();
                                let _ = child.wait();
                                let msg = event.get("reason")
                                    .or_else(|| event.get("message"))
                                    .or_else(|| event.get("error"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Erreur lors de la conversion");
                                return Err(msg.to_string());
                            }
                            _ => {} // Ignorer les autres événements
                        }
                    }
                    Err(_) => continue,
                }
            }
            Err(_) => {
                // Fin du stream stdout
                break;
            }
        }
    }

    // Nettoyer le processus
    let _ = child.kill();
    let _ = child.wait();

    // Lire stderr pour les erreurs
    let mut stderr_output = String::new();
    let _ = stderr_child.read_to_string(&mut stderr_output);

    if collected_text.is_empty() {
        if stderr_output.is_empty() {
            Err("Aucune réponse reçue de l'IA".to_string())
        } else {
            Err(format!("Erreur pi : {}", stderr_output.trim()))
        }
    } else {
        Ok(collected_text)
    }
}
