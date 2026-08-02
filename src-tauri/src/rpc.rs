// rpc.rs — Agent RPC (pi --mode rpc) : sessions, prompts, reviewer, sonde backend.
//
// Domaine extrait de `lib.rs` (2026-08) : démarrage/arrêt de sessions agent pi,
// envoi de commandes RPC, prompts (normal + inline), gestion du reviewer, et
// sondage du backend (pi/plh, support `--extension`). Inclut les helpers
// partagés `run_captured` et `resolve_agent_home` (pub(crate), réexportés par
// lib.rs pour les autres modules).

use serde_json::Value;
use std::fs;
use tauri::{AppHandle, Manager, State};

use crate::rpc_manager;
use crate::session_history;
use crate::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use crate::CREATE_NO_WINDOW;

#[derive(Clone)]
pub(crate) struct BackendProbe {
    pub(crate) kind: String,
    pub(crate) ext_supported: bool,
}

/// Sondage du backend : exécute `<pi_path> --version` (genre : "pi" / "plh" /
/// "unknown") et `--help` (présence de `--extension`). Mis en cache dans
/// `ext_gate_cache` (re-sondé si `pi_path` change). Bloquant mais borné (~3s par
/// commande). Évite de planter un backend qui ne supporte pas `--extension`
/// (ex: plh sans le flag → clap rejette l'arg et sort → « pipe closed »).
pub(crate) fn probe_backend(state: &AppState, pi_path: &str) -> BackendProbe {
    if pi_path.is_empty() {
        return BackendProbe { kind: "unknown".to_string(), ext_supported: false };
    }
    // Cache : re-sonder seulement si pi_path a changé depuis la dernière sonde.
    {
        let cache = state.ext_gate_cache.lock().unwrap();
        if let Some((cached_path, cached)) = cache.as_ref() {
            if cached_path == pi_path {
                return cached.clone();
            }
        }
    }
    let kind = run_version_probe(pi_path);
    let ext_supported = run_help_probe(pi_path);
    let probe = BackendProbe { kind, ext_supported };
    *state.ext_gate_cache.lock().unwrap() = Some((pi_path.to_string(), probe.clone()));
    probe
}

/// Wrapper : support de `--extension` uniquement (gate pré-écriture).
pub(crate) fn probe_extension_support(state: &AppState, pi_path: &str) -> bool {
    probe_backend(state, pi_path).ext_supported
}

/// Exécute `<pi_path> --version`, capture stdout, et déduit le genre.
/// - "pi"  : sortie commençant par un numéro de version (ex: "0.80.10")
/// - "plh" : sortie commençant par "plh" (ex: "plh 0.1.0")
/// - "unknown" sinon. Timeout ~10s.
fn run_version_probe(pi_path: &str) -> String {
    use std::time::Duration;
    let out = run_captured(pi_path, &["--version"], Duration::from_secs(10));
    kind_from_version_output(&out)
}

/// Déduplique le parsing du genre depuis la sortie `--version`.
pub(crate) fn kind_from_version_output(out: &str) -> String {
    let s = out.trim().to_lowercase();
    if s.starts_with("plh") {
        "plh".to_string()
    } else if s.split_whitespace().next().map(|w| w.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)).unwrap_or(false) {
        "pi".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Exécute `<pi_path> --help`, capture stdout, et vérifie si `--extension`
/// apparaît dans la sortie. Timeout ~10s (kill si dépassé).
fn run_help_probe(pi_path: &str) -> bool {
    use std::time::Duration;
    let out = run_captured(pi_path, &["--help"], Duration::from_secs(10));
    out.contains("--extension")
}

/// Lance `<exe> <args...>`, capture stdout, kill si `deadline` dépassé.
pub(crate) fn run_captured(exe: &str, args: &[&str], deadline_dur: std::time::Duration) -> String {
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

pub(crate) fn do_start_agent_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let cwd = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();

    let mut rpc = state.rpc_state.lock().unwrap();
    if rpc.is_some() {
        return Err("Une session agent est déjà active".to_string());
    }

    let (pi_path, no_session, session_dir, qg_enabled, confirm_file_edits) = {
        let config = state.config.lock().unwrap();
        (
            config.rpc_pi_path.clone(),
            config.rpc_no_session,
            config.rpc_session_dir.clone(),
            config.quality_gate_enabled,
            config.confirm_file_edits,
        )
    };

    // Construire le répertoire de session avec le sous-dossier projet
    let session_dir_resolved = if session_dir.is_empty() {
        resolve_agent_home(&pi_path)?.join("agent").join("sessions")
            .join(session_history::project_to_session_folder(&cwd))
    } else {
        std::path::PathBuf::from(&session_dir)
            .join(session_history::project_to_session_folder(&cwd))
    };
    let session_dir_str = session_dir_resolved.to_string_lossy().to_string();

    // Quality-gate interne (Évolution 7) : si activé, écrire le SKILL.md embarqué
    // par Pilot dans le dossier data, puis le passer à pi via --skill.
    let skill_path: Option<String> = if qg_enabled {
        if let Ok(data_dir) = app.path().app_data_dir() {
            let skill_file = data_dir.join("skills").join("quality-gate").join("SKILL.md");
            if fs::create_dir_all(skill_file.parent().unwrap_or(&data_dir)).is_ok() {
                let content: &str = include_str!("../skills/quality-gate/SKILL.md");
                if fs::write(&skill_file, content).is_ok() {
                    Some(skill_file.to_string_lossy().to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // Extensions pi : pilot-edit-gate (porte pré-écriture A4 V2) et pilot-context
    // (injection contexte/mémoire dans le system prompt — spec_context_engine /
    // spec_project_memory). `--extension` accepte plusieurs valeurs. Écrites dans
    // le dossier data depuis include_str! (imports type-only, effacés par jiti —
    // aucune dépendance npm).
    // - pilot-edit-gate : chargée UNIQUEMENT si `confirm_file_edits` est activé ET
    //   si le backend supporte `--extension`. Quand désactivé (défaut) ou non
    //   supporté (ex: plh sans le flag), elle n'est pas chargée → aucun surcharge,
    //   aucun blocage, l'agent écrit librement.
    // - pilot-context : chargée dès que `--extension` est supporté (indépendante
    //   de confirm_file_edits). No-op si Pilot n'écrit pas de fichier de handoff.
    let ext_supported = probe_extension_support(state, &pi_path);
    let mut extensions: Vec<String> = Vec::new();
    if ext_supported {
        if let Ok(data_dir) = app.path().app_data_dir() {
            let dir = data_dir.join("extensions");
            if fs::create_dir_all(&dir).is_ok() {
                if confirm_file_edits {
                    let ext_file = dir.join("pilot-edit-gate.ts");
                    if fs::write(&ext_file, include_str!("../extensions/pilot-edit-gate.ts")).is_ok() {
                        extensions.push(ext_file.to_string_lossy().to_string());
                    }
                }
                let ctx_file = dir.join("pilot-context.ts");
                if fs::write(&ctx_file, include_str!("../extensions/pilot-context.ts")).is_ok() {
                    extensions.push(ctx_file.to_string_lossy().to_string());
                }
            }
        }
    }

    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, no_session, &session_dir_str, skill_path.as_deref(), extensions, app.clone(), state.event_tx.clone(), "rpc-event", None,
    )
        .map_err(|e| {
            if pi_path.is_empty() {
                format!("{}. Installez pi (https://pi.dev) ou configurez le chemin dans les paramètres.", e)
            } else {
                format!("{}. Vérifiez le chemin dans les paramètres (Gestion RPC).", e)
            }
        })?;
    *rpc = Some(session);

    // Démarrer une nouvelle session
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
    }

    Ok(())
}

#[tauri::command]
pub fn start_agent_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_agent_session(state.inner(), &app)
}

/// Arrête l'agent pi en cours (s'il existe) et libère la session. Idempotent : no-op
/// si aucune session n'est active.
pub(crate) fn do_stop_agent_session(state: &AppState) {
    let mut rpc = state.rpc_state.lock().unwrap();
    if let Some(mut session) = rpc.take() {
        rpc_manager::stop_session(&mut session);
    }
    // H2 V1 : arrêter aussi le reviewer (cycle de vie lié à la session principale).
    let mut rev = state.rpc_reviewer.lock().unwrap();
    if let Some(mut session) = rev.take() {
        rpc_manager::stop_session(&mut session);
    }
}

#[tauri::command]
pub fn stop_agent_session(state: State<AppState>) -> Result<(), String> {
    do_stop_agent_session(state.inner());
    Ok(())
}

#[tauri::command]
pub fn send_rpc_command(state: State<AppState>, command: Value) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    rpc_manager::send_command(session, &command)
}

pub(crate) fn do_get_agent_state(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}

#[tauri::command]
pub fn get_agent_state(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_state(state.inner())
}

#[tauri::command]
pub fn get_session_stats(state: State<AppState>) -> Result<Value, String> {
    do_get_session_stats(state.inner())
}

pub(crate) fn do_get_session_stats(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_session_stats" });
    rpc_manager::send_command_sync(session, cmd)
}

/// Résout le répertoire home du programme RPC (pi, plh, ...) à partir du chemin
/// de l'exécutable configuré. Convention : ~/.<stem> où <stem> est le nom de
/// l'exécutable sans extension (plh.exe → ~/.plh, pi → ~/.pi). Si pi_path est
/// vide, utilise "pi" par défaut. Permet à Pilot de fonctionner avec n'importe
/// quel programme compatible pi en RPC sans chemin en dur.
pub(crate) fn resolve_agent_home(pi_path: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Impossible de trouver le home dir".to_string())?;
    let stem = if pi_path.is_empty() {
        "pi".to_string()
    } else {
        std::path::Path::new(pi_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "pi".to_string())
    };
    Ok(std::path::PathBuf::from(&home).join(format!(".{}", stem)))
}

#[tauri::command]
pub fn model_supports_images(provider: String, model_id: String, state: State<AppState>) -> Result<bool, String> {
    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();
    let models_path = resolve_agent_home(&pi_path)?.join("agent").join("models.json");
    let json_str = std::fs::read_to_string(&models_path)
        .map_err(|e| format!("Lecture models.json: {}", e))?;
    let config: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    if let Some(models) = config["providers"][&provider]["models"].as_array() {
        for m in models {
            if m["id"].as_str() == Some(&model_id) {
                if let Some(input) = m["input"].as_array() {
                    return Ok(input.iter().any(|v| v.as_str() == Some("image")));
                }
                return Ok(false);
            }
        }
    }
    Ok(false)
}

pub(crate) fn do_send_agent_prompt(
    state: &AppState,
    message: String,
    images: Option<Vec<Value>>,
) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let mut cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    if let Some(ref imgs) = images {
        if !imgs.is_empty() {
            cmd["images"] = Value::Array(imgs.clone());
        }
    }
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
pub fn send_agent_prompt(
    state: State<AppState>,
    message: String,
    images: Option<Vec<Value>>,
) -> Result<(), String> {
    // Notifier les clients distants (WebSocket) du message utilisateur tapé sur
    // le desktop : pi n'émet pas d'event "user message" en streaming, donc sans
    // cela le remote ne verrait pas les prompts desktop dans la conversation (on
    // exclut les commandes slash, non affichées). Le desktop l'affiche déjà
    // localement (appendUserMessage avant l'invoke) et n'écoute pas le canal de
    // broadcast → pas de doublon côté desktop.
    //
    // Context Engine (H1) : le message peut contenir un préambule de contexte
    // projet (=== CONTEXTE PROJET ... === FIN CONTEXTE ===). On le strippe pour
    // l'affichage distant (l'agent reçoit bien le message complet via pi).
    if !message.is_empty() && !message.starts_with('/') {
        let display_text = strip_context_preamble(&message);
        let ev = serde_json::json!({ "type": "user_message", "text": display_text, "source": "desktop" });
        let _ = state.event_tx.send(ev);
    }
    do_send_agent_prompt(state.inner(), message, images)
}

/// Supprime le préambule « === CONTEXTE PROJET ... === FIN CONTEXTE === » injecté
/// par le Context Engine (H1) pour ne pas polluer l'affichage distant du message
/// utilisateur. Retourne le texte utilisateur seul.
fn strip_context_preamble(message: &str) -> String {
    let start_marker = "=== CONTEXTE PROJET";
    let end_marker = "=== FIN CONTEXTE ===";
    if !message.starts_with(start_marker) {
        return message.to_string();
    }
    // Trouver la fin du bloc contexte, puis sauter les lignes vides qui suivent.
    if let Some(end_idx) = message.find(end_marker) {
        let after = &message[end_idx + end_marker.len()..];
        after.trim_start_matches(['\n', '\r', ' ']).to_string()
    } else {
        // Bloc mal formé : on renvoie tel quel (sécurité).
        message.to_string()
    }
}

/// Envoie un prompt de complétion inline à l'agent.
/// La réponse sera routée vers le module inline-complete du frontend
/// via le flag global `window._pilotInlineComplete.isRequesting()`.
#[tauri::command]
pub fn send_inline_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    rpc_manager::send_command(session, &cmd)
}

pub(crate) fn do_abort_agent(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "abort" });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
pub fn abort_agent(state: State<AppState>) -> Result<(), String> {
    do_abort_agent(state.inner())
}

pub(crate) fn do_new_agent_session(state: &AppState) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "new_session" });
    // SYNCHRONE : on attend que pi ait terminé le new_session avant de retourner.
    // new_session réinitialise le modèle au modèle par défaut de pi — si on ne l'attend
    // pas, un set_model suivant peut être appliqué AVANT le reset, puis annulé par le
    // new_session traité tardivement (bascule orchestrateur/codeur perdu).
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
pub fn new_agent_session(state: State<AppState>) -> Result<(), String> {
    do_new_agent_session(state.inner())
}

pub(crate) fn do_get_agent_messages(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({ "type": "get_messages" });
    rpc_manager::send_command_sync(session, cmd)
}

#[tauri::command]
pub fn get_agent_messages(state: State<AppState>) -> Result<Value, String> {
    do_get_agent_messages(state.inner())
}

pub(crate) fn do_set_agent_model(
    state: &AppState,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({
        "type": "set_model",
        "provider": provider,
        "modelId": model_id
    });
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    // Vérifier le champ success de la réponse pi : un set_model qui échoue
    // (provider/modèle introuvable) répond {success: false, error: "..."}.
    // Sans cette vérification, l'échec passait inaperçu et le modèle restait le
    // modèle par défaut (ex: llama-cpp), ce qui donnait l'illusion d'une bascule
    // réussie alors que les prompts partaient sur le mauvais modèle.
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("set_model a échoué (réponse sans succès)")
            .to_string();
        return Err(format!(
            "pi a refusé set_model(provider='{}', modelId='{}') : {}",
            provider, model_id, err
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn set_agent_model(
    state: State<AppState>,
    provider: String,
    model_id: String,
) -> Result<(), String> {
    do_set_agent_model(state.inner(), provider, model_id)
}

pub(crate) fn do_list_agent_models(state: &AppState) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({"type": "get_available_models"});
    rpc_manager::send_command_sync_timeout(session, cmd, 12)
}

#[tauri::command]
pub fn list_agent_models(state: State<AppState>) -> Result<Value, String> {
    do_list_agent_models(state.inner())
}

#[tauri::command]
pub fn list_agent_commands(state: State<AppState>) -> Result<Value, String> {
    let mut rpc = state.rpc_state.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session agent active")?;
    let cmd = serde_json::json!({"type": "get_commands"});
    rpc_manager::send_command_sync(session, cmd)
}

// ── H2 V1 : session reviewer dédiée (canal rpc-event-reviewer) ──────────────
// Le reviewer est un second processus pi --mode rpc --no-session (contexte vierge,
// jetable) lancé lazy au 1er besoin de review. Pas de skill/extension (lecture
// seule, pas de porte pré-écriture). Émet sur le canal séparé rpc-event-reviewer.

pub(crate) fn do_start_reviewer_session(state: &AppState, app: &AppHandle) -> Result<(), String> {
    let project = state.project_path.lock().unwrap();
    let cwd = project
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project);

    let pi_path = state.config.lock().unwrap().rpc_pi_path.clone();

    let mut rpc = state.rpc_reviewer.lock().unwrap();
    if rpc.is_some() {
        return Ok(()); // déjà lancé (idempotent)
    }

    let session = rpc_manager::spawn_and_start(
        &cwd, &pi_path, true, "", None, Vec::new(), app.clone(), state.event_tx.clone(), "rpc-event-reviewer", None,
    )
        .map_err(|e| format!("Erreur lancement du reviewer : {}", e))?;
    *rpc = Some(session);

    // Démarrer une nouvelle session (contexte vierge)
    if let Some(sess) = rpc.as_mut() {
        let cmd = serde_json::json!({"type": "new_session"});
        rpc_manager::send_command_sync(sess, cmd).ok();
    }
    Ok(())
}

#[tauri::command]
pub fn start_reviewer_session(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    do_start_reviewer_session(state.inner(), &app)
}

#[tauri::command]
pub fn stop_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    if let Some(mut session) = rpc.take() {
        rpc_manager::stop_session(&mut session);
    }
    Ok(())
}

pub(crate) fn do_send_reviewer_prompt(state: &AppState, message: String) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "prompt", "message": message });
    rpc_manager::send_command(session, &cmd)
}

#[tauri::command]
pub fn send_reviewer_prompt(state: State<AppState>, message: String) -> Result<(), String> {
    do_send_reviewer_prompt(state.inner(), message)
}

#[tauri::command]
pub fn new_reviewer_session(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({"type": "new_session"});
    rpc_manager::send_command_sync(session, cmd).map(|_| ())
}

#[tauri::command]
pub fn set_reviewer_model(state: State<AppState>, provider: String, model_id: String) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "set_model", "provider": provider, "modelId": model_id });
    let resp = rpc_manager::send_command_sync(session, cmd)?;
    if let Some(false) = resp.get("success").and_then(|v| v.as_bool()) {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("set_model a échoué").to_string();
        return Err(format!("pi a refusé set_model (reviewer) : {}", err));
    }
    Ok(())
}

#[tauri::command]
pub fn abort_reviewer(state: State<AppState>) -> Result<(), String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    rpc_manager::send_command(session, &serde_json::json!({"type": "abort"}))
}

#[tauri::command]
pub fn get_reviewer_state(state: State<AppState>) -> Result<Value, String> {
    let mut rpc = state.rpc_reviewer.lock().unwrap();
    let session = rpc
        .as_mut()
        .ok_or("Aucune session reviewer active")?;
    let cmd = serde_json::json!({ "type": "get_state" });
    rpc_manager::send_command_sync_timeout(session, cmd, 8)
}
