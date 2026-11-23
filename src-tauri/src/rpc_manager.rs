// rpc_manager.rs — Gestion du processus pi --mode rpc (JSONL stdin/stdout)

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// État d'une session RPC Pi
pub struct RpcSession {
    pub child: Child,
    pub stdin: ChildStdin,
    pub running: Arc<AtomicBool>,
    /// Commandes synchrones en attente de réponse (id → oneshot sender)
    pub pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
    /// P0 (issue #84) : dernier stderr brut du processus (borné ~8 ko), drainé
    /// au fil de l'eau par le thread de lecture stderr. Permet de retrouver la
    /// cause réelle d'un échec de lancement/arrêt rapide (`process_exit`) même
    /// après coup, et de la diagnostiquer (le stderr est en plus émis sous forme
    /// d'événements `process_error` vers le frontend). Jamais de stack complète
    /// (taille bornée), pas de données sensibles.
    #[allow(dead_code)] // réservé : exposé via la surface d'état de session/santé
    pub last_stderr: Arc<Mutex<String>>,
}

/// Taille maximale (en octets) du buffer stderr conservé dans l'état de session.
/// Borné pour ne pas exposer de données volumineuses ni saturer la mémoire.
const STDERR_BUFFER_MAX: usize = 8192;

/// Observateur d'événements RPC — appelé pour chaque événement JSONL parsé (hors
/// réponses corrélées). Utilisé par l'indicateur d'activité par projet (issue #13)
/// pour basculer un drapeau `busy` sur `agent_start`/`agent_settled`. `Option`
/// permet aux sessions sans suivi (reviewer, agents multi-rôles, PDF) de ne pas
/// payer le coût.
pub type EventObserver = Arc<dyn Fn(&Value) + Send + Sync>;

/// Lance le processus `pi --mode rpc` et démarre le thread de lecture stdout.
/// `pi_path` : chemin vers l'exécutable pi ("pi" si dans le PATH).
/// `no_session` : si true, ajoute --no-session (pas de persistance).
/// `event_channel` : nom du canal Tauri sur lequel émettre les événements
/// ("rpc-event" pour la session principale, "rpc-event-reviewer" pour le
/// reviewer H2 V1 — canal séparé pour ne pas polluer handleRpcEvent).
/// `agent_id` : si Some, chaque événement est enveloppé dans
/// `{ "agent_id": id, "event": value }` sur `event_channel` (bus d'agents H2 V2).
/// `observer` : observateur d'événements optionnel (indicateur d'activité par projet).
pub fn spawn_and_start(cwd: &str, pi_path: &str, no_session: bool, session_dir: &str, skill_paths: &[String], extensions: Vec<String>, app_handle: AppHandle, event_tx: tokio::sync::broadcast::Sender<Value>, event_channel: &str, agent_id: Option<&str>, observer: Option<EventObserver>, broadcast_channel: Option<String>, env_vars: Option<Vec<(String, String)>>) -> Result<RpcSession, String> {
    // Robustesse shim (issue #76) : si le chemin pointe vers un shim npm
    // `pi.cmd`/`pi.ps1`/`pi.bat` (ou est vide → repli "pi" via le PATH), le
    // résoudre vers le vrai exécutable (node + cli.js) car `Command::new` ne
    // sait pas exécuter un `.cmd`/`.bat` sur Windows.
    let (pi_exe, pi_base_args) = crate::pi_update::resolve_pi_executable(pi_path);

    let mut cmd = Command::new(&pi_exe);
    cmd.args(&pi_base_args)
        .args(["--mode", "rpc"]);
    if no_session {
        cmd.arg("--no-session");
    }
    if !session_dir.is_empty() {
        cmd.args(["--session-dir", session_dir]);
    }
    // Compétences (skills) : `--skill <chemin>` est répétable et additif avec la
    // découverte auto. Quality-gate interne (Évolution 7) + compétences de la
    // bibliothèque commune `~/.pilot/skills` sélectionnées pour CET agent.
    for sp in skill_paths.iter().filter(|s| !s.is_empty()) {
        cmd.args(["--skill", sp]);
    }
    // Extensions pi (pilot-edit-gate porte pré-écriture A4 V2, pilot-context
    // injection contexte/mémoire dans le system prompt). `--extension` accepte
    // plusieurs valeurs : on ajoute chaque chemin.
    for ep in extensions.iter().filter(|e| !e.is_empty()) {
        cmd.args(["--extension", ep]);
    }
    // Identité de l'agent pour les extensions (ex: pilot-reserve-gate Phase 0) :
    // expose l'agent_id courant au processus pi via une variable d'environnement.
    // Sans effet pour les sessions sans agent_id (session principale, reviewer).
    if let Some(aid) = agent_id {
        cmd.env("PILOT_AGENT_ID", aid);
    }
    // Variables d'environnement additionnelles optionnelles. POC MCP : l'extension
    // mcp-client lit le chemin du mcp.json via PILOT_MCP_CONFIG. `None` (ou liste
    // vide) pour les sessions sans besoin (reviewer, PDF, agents sans projet).
    if let Some(env_list) = env_vars {
        for (k, v) in env_list {
            cmd.env(k, v);
        }
    }
    crate::hide_console(&mut cmd);
    let mut child = cmd
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Erreur lancement de pi (exe: {}): {}", pi_exe, e))?;

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
    let agent_id_owned = agent_id.map(|s| s.to_string());
    // Projet cible (cwd) : ajouté au payload des événements agents (bus H2 V2)
    // pour que le frontend puisse router les événements par projet et faire
    // tourner le MÊME type d'agent en parallèle sur des projets DIFFÉRENTS
    // (le runState et le parallelGroup sont désormais indexés par projet).
    let project_owned = if agent_id.is_some() {
        Some(cwd.to_string())
    } else {
        None
    };
    let observer_stdout = observer.clone();

    // P0 (issue #84) : buffer stderr partagé, alimenté par le thread de lecture
    // stderr et conservé dans l'état de session (`RpcSession.last_stderr`).
    let last_stderr = Arc::new(Mutex::new(String::new()));
    let last_stderr_reader = last_stderr.clone();

    // Thread de lecture stdout
    let app_exit = app_handle.clone();
    let channel_stdout = event_channel.to_string();
    let broadcast_channel_owned = broadcast_channel;
    std::thread::spawn(move || {
        // L'émission vers le frontend passe par un callback : cela rend
        // `read_jsonl_loop` testable sans AppHandle (cf. tests en bas de fichier).
        let involuntary = read_jsonl_loop(
            Box::new(stdout),
            &|v: &Value| {
                let _ = app_clone.emit(&channel_stdout, v);
            },
            running_clone,
            pending_clone,
            event_tx,
            agent_id_owned.as_deref(),
            project_owned.as_deref(),
            observer_stdout,
            broadcast_channel_owned,
        );
        // Ne signaler un process_exit que pour une fin involontaire (pi mort/crash),
        // signalé par read_jsonl_loop (EOF/erreur alors que running était encore
        // true). Un arrêt volontaire (stop_session a passé running=false, ex.
        // redémarrage pour un changement de projet distant) n'émet rien → le
        // desktop n'affiche pas « Déconnecté » (le pi est redémarré juste après).
        if involuntary {
            let exit_event = serde_json::json!({"type": "process_exit", "reason": "stdout_closed"});
            app_exit.emit(&channel_stdout, &exit_event).ok();
        }
    });

    // Thread de lecture stderr
    let app_stderr = app_handle.clone();
    let channel_stderr = event_channel.to_string();
    std::thread::spawn(move || {
        read_stderr_loop(Box::new(stderr), app_stderr, running_stderr, &channel_stderr, Some(last_stderr_reader));
    });

    Ok(RpcSession {
        child,
        stdin,
        running,
        pending,
        last_stderr,
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
    command: Value,
    timeout_secs: u64,
) -> Result<Value, String> {
    let rx = send_command_register(session, command)?;
    wait_response(rx, timeout_secs)
}

/// Enregistre la commande dans la table des réponses attendues ET l'écrit sur le
/// stdin de pi, **sans attendre la réponse**. Retourne le receiver permettant de
/// l'attendre ensuite via `wait_response`.
///
/// Pourquoi séparer l'envoi de l'attente : l'appelant peut ainsi relâcher ses
/// propres verrous AVANT l'attente bloquante. L'AgentService gardait sinon son
/// registre de sessions pendant tout le timeout (30 s) ; un `pi` mort ou muet
/// gelait alors tous les autres accès au registre — dont les commandes
/// synchrones du thread principal, donc toute l'UI (incident v0.4.30).
pub fn send_command_register(
    session: &mut RpcSession,
    mut command: Value,
) -> Result<mpsc::Receiver<Value>, String> {
    // Générer un id unique si non fourni
    let id = format!("rpc-{}", uuid_simple());
    command["id"] = Value::String(id.clone());

    let (tx, rx) = mpsc::channel();
    {
        let mut pending = session.pending.lock().unwrap();
        pending.insert(id.clone(), tx);
    }

    if let Err(e) = send_command(session, &command) {
        // Ne pas laisser d'entrée orpheline : le writer a échoué, aucune réponse
        // ne viendra jamais pour cet id (fuite bornée mais inutile).
        session.pending.lock().unwrap().remove(&id);
        return Err(e);
    }
    Ok(rx)
}

/// Attend la réponse d'une commande enregistrée par `send_command_register`.
/// Distincte de l'envoi pour permettre de relâcher les verrous avant l'attente
/// (cf. `send_command_register`).
pub fn wait_response(rx: mpsc::Receiver<Value>, timeout_secs: u64) -> Result<Value, String> {
    rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
        .map_err(|e| match e {
            mpsc::RecvTimeoutError::Timeout => {
                format!("Timeout ({}s) ou canal fermé en attente de réponse", timeout_secs)
            }
            // Le thread de lecture a vidé la table des réponses attendues : le
            // processus pi est mort. Échec IMMÉDIAT (et non après 30 s) → l'UI
            // n'attend pas un timeout complet pour constater la panne.
            mpsc::RecvTimeoutError::Disconnected => {
                "Session pi terminée avant la réponse (processus arrêté)".to_string()
            }
        })
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

// ── UTF-8 decoding of a stream read in chunks ──

/// Decodes `chunk` after the bytes left in `pending`.
/// A multi-byte character cut at the end of a chunk (é, à, emoji) is NOT
/// decoded: its leading bytes stay in `pending` until the next chunk (RPC-01).
/// Only a really invalid sequence becomes U+FFFD (like `from_utf8_lossy`);
/// no valid byte is ever lost.
pub(crate) fn decode_utf8_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut out = String::new();
    loop {
        let (valid, invalid_len) = match std::str::from_utf8(&pending[..]) {
            Ok(_) => (pending.len(), None),
            Err(e) => (e.valid_up_to(), e.error_len()),
        };
        if let Ok(s) = std::str::from_utf8(&pending[..valid]) {
            out.push_str(s);
        }
        match invalid_len {
            Some(len) => {
                // Invalid sequence in the middle of the stream: replaced, then go on.
                out.push('\u{FFFD}');
                pending.drain(..valid + len);
            }
            None => {
                // Everything is decoded, or only an incomplete char remains at the end.
                pending.drain(..valid);
                return out;
            }
        }
    }
}

/// End of stream: bytes still pending (truncated character) become U+FFFD
/// instead of being lost.
pub(crate) fn flush_utf8_pending(pending: &mut Vec<u8>) -> String {
    let rest = String::from_utf8_lossy(pending).into_owned();
    pending.clear();
    rest
}

// ── JSONL Parser (thread stdout) ──

/// Lit le stdout JSONL de pi jusqu'à EOF. Retourne `true` si la sortie est
/// INVOLONTAIRE (pi mort/crash détecté sur EOF/erreur alors que `running`
/// était encore true). Dans ce cas, `running` est passé à false ici, AVANT
/// l'émission de process_exit par l'appelant, pour que send_command retourne
/// proprement « Session arrêtée » au lieu d'écrire sur un stdin fermé
/// (os error 232).
fn read_jsonl_loop(
    mut reader: Box<dyn Read + Send>,
    emit: &dyn Fn(&Value),
    running: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
    event_tx: tokio::sync::broadcast::Sender<Value>,
    agent_id: Option<&str>,
    project: Option<&str>,
    observer: Option<EventObserver>,
    broadcast_channel: Option<String>,
) -> bool {
    let mut buffer = String::new();
    // Bytes of a UTF-8 character cut between two reads (RPC-01). A last line
    // without a final `\n` stays ignored at EOF, as before: no flush here.
    let mut utf8_pending: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    let mut involuntary_exit = false;

    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF (pi terminé). Fin involontaire (running encore true) : on
                // pose running=false pour que send_command échoue proprement.
                if running.load(Ordering::Relaxed) {
                    running.store(false, Ordering::Relaxed);
                    involuntary_exit = true;
                }
                // Réveiller les commandes synchrones en attente : sans cela,
                // chaque `send_sync` attendait le timeout complet (30 s) alors
                // qu'aucune réponse ne pouvait plus arriver (verrou du registre
                // de sessions tenu → thread principal et UI gelés).
                pending.lock().unwrap().clear();
                break;
            }
            Ok(n) => {
                // En cours d'arrêt (stop_session a passé running=false) : on draine
                // le pipe sans traiter ni émettre, jusqu'à EOF. Cela garde le pipe
                // ouvert côté lecture tant que pi n'est pas mort → évite un EPIPE
                // ("broken pipe, write") côté pi (node) qui crasherait bruyamment.
                if !running.load(Ordering::Relaxed) {
                    continue;
                }

                buffer.push_str(&decode_utf8_chunk(&mut utf8_pending, &buf[..n]));

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
                            // Observateur d'activité (issue #13) : notifié pour chaque
                            // événement parsé, y compris les réponses corrélées (inoffensif).
                            if let Some(obs) = &observer {
                                obs(&value);
                            }
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
                            let emit_value = if let Some(id) = agent_id {
                                serde_json::json!({"agent_id": id, "project": project, "event": value})
                            } else {
                                value.clone()
                            };
                            emit(&emit_value);
                            // Fan-out parallèle vers les WebSockets distants (décision 13.3).
                            // Sender::send n'est pas async → appel valide depuis ce thread std.
                            // Une erreur (pas de receiver / lent) est ignorée : le client web
                            // resynchronise son état au reconnect via les fetch REST (§5).
                            // Note : en V1, le reviewer n'est pas fan-out vers le web (canal
                            // séparé, pas de session distante dédiée) — le fan-out se fait sur
                            // le canal principal uniquement via l'event_tx de la session main.
                            // Si un canal de broadcast est fourni (ex: "superagent"), l'événement
                            // est enveloppé dans {"__channel": ch, "event": value} pour que le
                            // client web puisse distinguer les sessions (mode assistant vs agents,
                            // évolution 2). Les sessions non taggées (None) gardent le format brut
                            // existant → aucune régression sur le web remote actuel.
                            let broadcast_value = match &broadcast_channel {
                                Some(ch) => serde_json::json!({ "__channel": ch, "event": value }),
                                None => value,
                            };
                            let _ = event_tx.send(broadcast_value);
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
            Err(_) => {
                // Erreur de lecture : même traitement qu'un EOF involontaire.
                if running.load(Ordering::Relaxed) {
                    running.store(false, Ordering::Relaxed);
                    involuntary_exit = true;
                }
                // Même réveil des attentes que sur EOF (aucune réponse possible).
                pending.lock().unwrap().clear();
                break;
            }
        }
    }
    // Mort involontaire du processus (EOF / erreur de lecture alors que
    // `running` était encore vrai) : notifier l'observateur d'un `process_exit`,
    // exactement comme un arrêt explicite. Sans cela, `agent_activity[projet].busy`
    // reste posé à vie et toutes les missions d'écriture restent en file
    // d'attente (tâche 314). Un arrêt volontaire (stop_session a passé
    // `running=false`) ne passe pas ici : aucun reset n'est émis, donc pi peut
    // être redémarré sans afficher un « Déconnecté » injustifié.
    if involuntary_exit {
        if let Some(obs) = &observer {
            obs(&serde_json::json!({ "type": "process_exit" }));
        }
    }
    involuntary_exit
}

/// Thread de lecture stderr — émet les erreurs sous forme d'événements rpc-event
/// et conserve un extrait borné dans l'état de session (`last_stderr`).
fn read_stderr_loop(
    mut reader: Box<dyn Read + Send>,
    app_handle: AppHandle,
    running: Arc<AtomicBool>,
    event_channel: &str,
    last_stderr: Option<Arc<Mutex<String>>>,
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
                // P0 (issue #84) : conserver un extrait borné du stderr dans
                // l'état de session pour le diagnostic (garde la fin, la plus
                // pertinente pour un crash).
                if let Some(sink) = &last_stderr {
                    let mut sink = sink.lock().unwrap();
                    sink.push_str(&text);
                    if sink.len() > STDERR_BUFFER_MAX {
                        let start = sink.len() - STDERR_BUFFER_MAX;
                        *sink = sink[start..].to_string();
                    }
                }
                let event = serde_json::json!({
                    "type": "process_error",
                    "text": text,
                });
                app_handle.emit(event_channel, &event).ok();
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
    cmd.args(["--mode", "rpc", "--no-session"]).current_dir(cwd);
    crate::hide_console(&mut cmd);
    run_pdf_conversion(cmd, provider, model_id, prompt, PDF_CONVERT_TIMEOUT)
}

/// Functional deadline of the PDF → Markdown conversion (unchanged: 2 minutes).
const PDF_CONVERT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Deadline message ("… plus de 2 minutes" for the default delay).
fn pdf_timeout_message(timeout: std::time::Duration) -> String {
    let secs = timeout.as_secs();
    let label = if secs >= 60 && secs % 60 == 0 {
        let min = secs / 60;
        format!("{} minute{}", min, if min > 1 { "s" } else { "" })
    } else {
        format!("{} ms", timeout.as_millis())
    };
    format!("Timeout : la conversion a pris plus de {}", label)
}

/// Body of `convert_text_with_pi`: `cmd` (program + arguments + cwd) and
/// `timeout` are injected so the deadline can be tested with a fake engine.
fn run_pdf_conversion(
    mut cmd: std::process::Command,
    provider: &str,
    model_id: &str,
    prompt: &str,
    timeout: std::time::Duration,
) -> Result<String, String> {
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // `cmd` arrives already hidden (`hide_console` is set by the caller, where
    // the command is created — guard `fenetres-noires-lancements.test.js`).
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

    // Lire la réponse de stdout jusqu'à agent_end ou timeout.
    // RPC-02: the blocking read lives in a dedicated thread, the wait here has a
    // REAL deadline (`recv_timeout`) — a silent engine is interrupted too.
    // At the deadline the process is killed: its stdout closes, the thread reads
    // EOF (or sees the closed channel) and ends by itself.
    let (line_tx, line_rx) = mpsc::channel::<std::io::Result<String>>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let failed = line.is_err();
            if line_tx.send(line).is_err() || failed {
                break;
            }
        }
    });
    let mut collected_text = String::new();
    let deadline = std::time::Instant::now() + timeout;

    loop {
        // Deadline passed even if lines keep coming (chatty engine without
        // agent_end): same stop as for a silent engine.
        let now = std::time::Instant::now();
        if now >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(pdf_timeout_message(timeout));
        }
        let line = match line_rx.recv_timeout(deadline - now) {
            Ok(line) => line,
            Err(mpsc::RecvTimeoutError::Timeout) => continue, // → stop above
            // Reader thread ended: end of the stdout stream.
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anomaly::{make_observer, AgentAnomalyState};
    use crate::SessionActivity;

    type ActivityMap = Arc<Mutex<HashMap<String, SessionActivity>>>;
    type AnomalyMap = Arc<Mutex<HashMap<String, AgentAnomalyState>>>;

    const PROJECT: &str = "/proj";

    fn activity_maps() -> (ActivityMap, AnomalyMap, EventObserver) {
        let activity: ActivityMap = Arc::new(Mutex::new(HashMap::new()));
        let anomaly: AnomalyMap = Arc::new(Mutex::new(HashMap::new()));
        let obs = make_observer(&activity, &anomaly, PROJECT, "/proj\u{1f}agent");
        (activity, anomaly, obs)
    }

    fn project_busy(activity: &ActivityMap) -> bool {
        activity.lock().unwrap().get(PROJECT).map(|a| a.busy).unwrap_or(false)
    }

    fn drive_reader(
        content: &[u8],
        running_flag: bool,
        observer: Option<EventObserver>,
    ) -> (bool, Arc<AtomicBool>) {
        let running = Arc::new(AtomicBool::new(running_flag));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, _rx) = tokio::sync::broadcast::channel(8);
        let reader: Box<dyn Read + Send> = Box::new(std::io::Cursor::new(content.to_vec()));
        let involuntary = read_jsonl_loop(
            reader,
            &|_v: &Value| {},
            running.clone(),
            pending,
            event_tx,
            None,
            Some(PROJECT),
            observer,
            None,
        );
        (involuntary, running)
    }

    /// Tâche 314 : la mort involontaire de pi doit libérer l'activité du projet,
    /// sinon toutes les missions d'écriture restent en file d'attente à vie.
    /// Échoue sans le correctif (l'observateur n'était jamais notifié sur EOF).
    #[test]
    fn involuntary_exit_releases_project_activity() {
        let (activity, _anomaly, obs) = activity_maps();
        // L'agent démarre → le projet est marqué occupé (même clé que
        // `get_project_agent_states`, qui bloque la file).
        obs(&serde_json::json!({ "type": "agent_start" }));
        assert!(project_busy(&activity), "agent_start doit marquer le projet occupé");

        // pi meurt sans `agent_settled` : le flux stdout se ferme.
        let (involuntary, running) = drive_reader(b"", true, Some(obs));

        assert!(involuntary, "une fermeture inattendue doit être signalée");
        assert!(!running.load(Ordering::Relaxed), "running doit retomber à false");
        assert!(
            !project_busy(&activity),
            "la mort involontaire de pi doit libérer l'activité du projet"
        );
    }

    /// Incident v0.4.30 : à la mort de `pi` (EOF), les commandes synchrones en
    /// attente doivent échouer IMMÉDIATEMENT (canal fermé) au lieu d'attendre
    /// leur timeout complet (30 s). Sans le correctif, chaque sondage du frontend
    /// gelait le thread principal le temps du timeout, en boucle (UI inutilisable
    /// après un crash de l'Assistant).
    #[test]
    fn eof_wakes_pending_sync_waiters() {
        let running = Arc::new(AtomicBool::new(true));
        let pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // Une commande synchrone est en attente de réponse…
        let (tx, rx) = mpsc::channel();
        pending.lock().unwrap().insert("rpc-attente".to_string(), tx);
        let (event_tx, _broadcast_rx) = tokio::sync::broadcast::channel(8);
        let reader: Box<dyn Read + Send> = Box::new(std::io::Cursor::new(Vec::new()));

        // …et le processus meurt (flux stdout fermé).
        read_jsonl_loop(
            reader,
            &|_v: &Value| {},
            running.clone(),
            pending.clone(),
            event_tx,
            None,
            Some(PROJECT),
            None,
            None,
        );

        assert!(
            pending.lock().unwrap().is_empty(),
            "la table des réponses attendues doit être vidée à la mort de pi"
        );
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(50)).is_err(),
            "l'attente doit être réveillée (canal fermé) sans attendre le timeout"
        );
        assert!(!running.load(Ordering::Relaxed), "running doit retomber à false");
    }

    /// L'arrêt volontaire (running=false) ne doit pas émettre de reset : pi est
    /// redémarré juste après (changement de projet distant) et l'interface ne
    /// doit pas afficher « Déconnecté ». Le correctif ne concerne que la mort
    /// involontaire.
    #[test]
    fn voluntary_stop_does_not_reset_project_activity() {
        let (activity, _anomaly, obs) = activity_maps();
        obs(&serde_json::json!({ "type": "agent_start" }));
        assert!(project_busy(&activity));

        // running déjà passé à false par stop_session → pas de fin involontaire.
        let (involuntary, _running) = drive_reader(b"{\"type\":\"agent_start\"}\n", false, Some(obs));

        assert!(!involuntary, "un arrêt volontaire ne doit pas être signalé");
        assert!(
            project_busy(&activity),
            "un arrêt volontaire ne doit PAS réémettre de reset (pas de faux « Déconnecté »)"
        );
    }

    /// Fake reader that returns EXACTLY the given chunks, one per `read`, then
    /// EOF. Lets a multi-byte UTF-8 character be cut between two reads.
    struct ChunkedReader {
        chunks: std::collections::VecDeque<Vec<u8>>,
    }

    impl ChunkedReader {
        fn new(chunks: Vec<Vec<u8>>) -> Self {
            Self { chunks: chunks.into() }
        }
    }

    impl Read for ChunkedReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            match self.chunks.pop_front() {
                None => Ok(0),
                Some(chunk) => {
                    assert!(chunk.len() <= out.len(), "bloc de test trop grand");
                    out[..chunk.len()].copy_from_slice(&chunk);
                    Ok(chunk.len())
                }
            }
        }
    }

    /// RPC-01 : un caractère sur plusieurs octets (é, 🚀, à) coupé entre deux
    /// lectures doit arriver intact, dans l'ordre, ligne JSONL par ligne JSONL,
    /// y compris quand la coupure tombe sur le tout dernier bloc avant EOF.
    /// Sans le correctif, chaque bloc était décodé seul → « �� ».
    #[test]
    fn rpc_utf8_coupe_entre_blocs_reste_intact() {
        let l1 = "{\"type\":\"message_update\",\"t\":\"Caf\u{e9} \u{e9}t\u{e9}\"}\n";
        let l2 = "{\"type\":\"message_update\",\"t\":\"go \u{1f680} !\"}\r\n";
        let l3 = "{\"type\":\"agent_end\",\"t\":\"voil\u{e0}\"}\n";
        let all: Vec<u8> = [l1, l2, l3].concat().into_bytes();

        // Cut points: in the middle of the first « é » (2 bytes), after 1 then
        // 3 bytes of 🚀 (4 bytes), and in the middle of « à » on the last chunk.
        let e_pos = all.windows(2).position(|w| w == "\u{e9}".as_bytes()).unwrap();
        let rocket = all.windows(4).position(|w| w == "\u{1f680}".as_bytes()).unwrap();
        let a_pos = all.windows(2).position(|w| w == "\u{e0}".as_bytes()).unwrap();
        let cuts = [e_pos + 1, rocket + 1, rocket + 3, a_pos + 1];
        let mut chunks = Vec::new();
        let mut prev = 0;
        for c in cuts {
            chunks.push(all[prev..c].to_vec());
            prev = c;
        }
        chunks.push(all[prev..].to_vec()); // last chunk: 2nd byte of « à » + end

        let emitted: Mutex<Vec<Value>> = Mutex::new(Vec::new());
        let running = Arc::new(AtomicBool::new(true));
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, mut event_rx) = tokio::sync::broadcast::channel(8);
        let involuntary = read_jsonl_loop(
            Box::new(ChunkedReader::new(chunks)),
            &|v: &Value| emitted.lock().unwrap().push(v.clone()),
            running.clone(),
            pending,
            event_tx,
            None,
            None,
            None,
            None,
        );

        let texts: Vec<String> = emitted
            .lock()
            .unwrap()
            .iter()
            .map(|v| v["t"].as_str().unwrap_or("").to_string())
            .collect();
        assert_eq!(
            texts,
            vec!["Caf\u{e9} \u{e9}t\u{e9}", "go \u{1f680} !", "voil\u{e0}"],
            "texte UTF-8 intact et ordre des événements préservé"
        );
        // Same content, same order, on the WebSocket fan-out.
        let mut fanout = Vec::new();
        while let Ok(v) = event_rx.try_recv() {
            fanout.push(v["t"].as_str().unwrap_or("").to_string());
        }
        assert_eq!(fanout, texts);
        // Stream close unchanged: EOF while running was still true.
        assert!(involuntary, "EOF inattendu toujours signalé");
        assert!(!running.load(Ordering::Relaxed));
    }

    /// Une dernière ligne sans `\n` (ici tronquée au milieu d'un « é ») reste
    /// ignorée comme avant, sans panique ni événement fantôme.
    #[test]
    fn rpc_utf8_coupe_fin_de_flux_sans_saut_de_ligne() {
        let full = "{\"type\":\"a\",\"t\":\"\u{e9}\"}\n{\"type\":\"b\",\"t\":\"\u{e9}";
        let bytes = full.as_bytes();
        let chunks = vec![bytes[..bytes.len() - 1].to_vec()]; // 2nd byte of « é » lost
        let emitted: Mutex<Vec<Value>> = Mutex::new(Vec::new());
        let (event_tx, _rx) = tokio::sync::broadcast::channel(8);
        let involuntary = read_jsonl_loop(
            Box::new(ChunkedReader::new(chunks)),
            &|v: &Value| emitted.lock().unwrap().push(v.clone()),
            Arc::new(AtomicBool::new(true)),
            Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            None,
            None,
            None,
            None,
        );
        let got = emitted.lock().unwrap().clone();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["t"], "\u{e9}");
        assert!(involuntary);
    }

    /// Temp directory private to the test (fictitious, removed at the end).
    #[cfg(target_os = "linux")]
    fn pdf_fake_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pilot-pdf2md-test-{}-{}-{}",
            tag,
            std::process::id(),
            uuid_simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Fake engine: `/bin/sh` that records its PID then runs `script` (the PID
    /// stays that of the final process thanks to `exec`). No real pi, no network.
    #[cfg(target_os = "linux")]
    fn pdf_fake_engine(dir: &std::path::Path, script: &str) -> std::process::Command {
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.args(["-c", &format!("echo $$ > pid; {}", script)]).current_dir(dir);
        cmd
    }

    #[cfg(target_os = "linux")]
    fn pdf_fake_pid_alive(dir: &std::path::Path) -> bool {
        let pid = std::fs::read_to_string(dir.join("pid")).expect("PID du faux moteur");
        std::path::Path::new(&format!("/proc/{}", pid.trim())).exists()
    }

    /// RPC-02 : un moteur MUET (aucune ligne sur stdout) doit être interrompu à
    /// l'échéance — erreur de délai rendue à temps, processus tué et récolté.
    /// Avant le correctif, le délai n'était vérifié qu'à l'arrivée d'une ligne :
    /// l'attente durait autant que le moteur (ici 8 s, en vrai sans fin).
    #[cfg(target_os = "linux")]
    #[test]
    fn pdf2md_moteur_muet_interrompu_a_l_echeance() {
        let dir = pdf_fake_dir("muet");
        let cmd = pdf_fake_engine(&dir, "exec sleep 8");
        let start = std::time::Instant::now();
        let res = run_pdf_conversion(cmd, "", "", "texte fictif",
            std::time::Duration::from_millis(400));
        let elapsed = start.elapsed();
        let alive = pdf_fake_pid_alive(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        let err = res.expect_err("un moteur muet ne doit pas produire de texte");
        assert!(err.starts_with("Timeout"), "erreur de délai attendue, reçu : {}", err);
        assert!(elapsed < std::time::Duration::from_secs(4), "échéance non tenue : {:?}", elapsed);
        assert!(!alive, "le faux moteur doit être tué et récolté à l'échéance");
        // The default functional delay and its message are unchanged.
        assert_eq!(PDF_CONVERT_TIMEOUT, std::time::Duration::from_secs(120));
        assert_eq!(
            pdf_timeout_message(PDF_CONVERT_TIMEOUT),
            "Timeout : la conversion a pris plus de 2 minutes"
        );
    }

    /// Non-régression : un moteur qui répond (`text_delta` puis `agent_end`)
    /// rend son texte tout de suite, puis il est arrêté (il dormait ensuite).
    #[cfg(target_os = "linux")]
    #[test]
    fn pdf2md_moteur_qui_repond_rend_le_texte_avant_l_echeance() {
        let dir = pdf_fake_dir("repond");
        let delta = r##"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"# Titre é"}}"##;
        let script = format!("printf '%s\\n' '{}' '{{\"type\":\"agent_end\"}}'; exec sleep 8", delta);
        let cmd = pdf_fake_engine(&dir, &script);
        let start = std::time::Instant::now();
        let res = run_pdf_conversion(cmd, "", "", "texte fictif",
            std::time::Duration::from_secs(5));
        let elapsed = start.elapsed();
        let alive = pdf_fake_pid_alive(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(res, Ok("# Titre \u{e9}".to_string()));
        assert!(elapsed < std::time::Duration::from_secs(4), "{:?}", elapsed);
        assert!(!alive, "le moteur doit être arrêté après agent_end");
    }
}
