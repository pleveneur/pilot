// help.rs — Aide intégrée « ❓ Aide » (spec_help.md).
//
// L'utilisateur pose une question sur l'utilisation/paramétrage de Pilot ; un
// LLM répond en se basant sur le **handbook** (doc condensée embarquée).
//
// Option A (pi cadré) — Niveau 1 : on lance un **processus pi temporaire**
// `pi --mode rpc --no-session`, on lui envoie un prompt fortement cadré
// (handbook + consigne « pas d'outils, pas de fichiers » + historique d'aide +
// question), on collecte la réponse, puis on tue le process. La session de
// coding principale (`rpc_state` dans `lib.rs`) n'est **jamais touchée** →
// aucune pollution, aucune modif de `rpc_manager.rs`.
//
// IMPORTANT — synchronisation des commandes : pi traite les commandes RPC de
// façon asynchrone/désordonnée (l'accusé `new_session` peut arriver APRÈS
// celui de `prompt`). Si on envoie new_session + set_model + prompt d'affilée
// sans attendre les accusés, `new_session` traité en dernier réinitialise la
// session et le prompt est perdu → aucune réponse streamée. On attend donc
// l'accusé `{"type":"response","command":<cmd>}` de chaque commande avant
// d'envoyer la suivante (pattern éprouvé par test direct).

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Handbook embarqué à la compilation (généré par `scripts/build-handbook.js`
/// depuis les blocs `<!-- HELP:* -->` de `help/overview.md` + des `spec_*.md`).
/// Toujours synchro avec la version installée.
pub const HANDBOOK: &str = include_str!("../../help/handbook.md");

/// Un tour de la conversation d'aide (côté frontend). L'historique est géré par
/// `help.js` et réinjecté à chaque question (le process pi est `--no-session`,
/// sans mémoire entre les tours).
#[derive(Deserialize, Clone)]
pub struct HelpTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Retourne le contenu du handbook (pour affichage éventuel / debug côté UI).
#[tauri::command]
pub fn get_handbook() -> String {
    HANDBOOK.to_string()
}

/// Commande principale de l'aide : pose une question à pi (process temporaire
/// cadré) en injectant le handbook + l'historique d'aide, retourne la réponse.
///
/// Le modèle utilisé est lu depuis `config.help_model` (format "provider/modelId",
/// peuplé par le sélecteur de l'UI d'aide). Pi `--no-session` n'a pas de modèle
/// par défaut : sans `set_model` explicite, le prompt ne produit aucune réponse.
#[tauri::command]
pub fn ask_help(
    state: State<crate::AppState>,
    question: String,
    history: Vec<HelpTurn>,
) -> Result<String, String> {
    let cfg = state.config.lock().unwrap();
    let pi_path = cfg.rpc_pi_path.clone();
    let help_model = cfg.help_model.clone();
    drop(cfg);

    if help_model.trim().is_empty() {
        return Err(
            "Aucun modèle configuré pour l'aide. Sélectionne un modèle dans la liste déroulante de l'onglet Aide."
                .to_string(),
        );
    }

    let prompt = build_help_prompt(&question, &history);

    // Cwd neutre (dossier temporaire) pour isoler l'aide : pi --no-session ne
    // charge pas de session projet, et un cwd vide évite tout scan de fichiers.
    let cwd = std::env::temp_dir().to_string_lossy().to_string();

    ask_pi_for_help(&cwd, &pi_path, &prompt, Some(&help_model))
}

/// Construit le prompt cadré envoyé à pi : consigne « assistant d'aide », le
/// handbook, l'historique d'aide (réinjecté) et la nouvelle question.
fn build_help_prompt(question: &str, history: &[HelpTurn]) -> String {
    let mut s = String::new();
    s.push_str(
        "MODE AIDE PILOT. Tu es l'assistant d'aide de l'éditeur Pilot.\n\
         Réponds UNIQUEMENT à partir du HANDBOOK ci-dessous. N'utilise AUCUN outil,\n\
         ne lis ni ne modifie aucun fichier, n'exécute aucune commande. Si la question\n\
         sort du cadre de Pilot, dis-le clairement et oriente l'utilisateur vers la\n\
         documentation. Réponds en français, de façon claire et concise, en Markdown.\n\n",
    );
    s.push_str("=== HANDBOOK ===\n");
    s.push_str(HANDBOOK);
    s.push_str("\n=== FIN HANDBOOK ===\n\n");

    // Historique d'aide (réinjecté car le process pi est sans mémoire).
    let non_empty: Vec<&HelpTurn> = history
        .iter()
        .filter(|t| !t.content.trim().is_empty())
        .collect();
    if !non_empty.is_empty() {
        s.push_str("[Historique de la conversation d'aide]\n");
        for turn in non_empty {
            let label = match turn.role.as_str() {
                "assistant" => "Assistant",
                _ => "Utilisateur",
            };
            s.push_str(&format!("{} : {}\n", label, turn.content.trim()));
        }
        s.push('\n');
    }

    s.push_str(&format!("Question : {}\n", question.trim()));
    s
}

// ── Helpers de lecture stdout (thread + canal avec timeout réel) ──

/// Lance un thread qui lit stdout de pi ligne par ligne et pousse chaque ligne
/// sur un canal mpsc. Permet d'utiliser `recv_timeout` pour un timeout réel
/// (un `BufReader::lines()` bloquant ne permettrait pas de timeout réactif).
/// Retourne le `Receiver`. Le thread se termine à la fermeture de stdout
/// (EOF) → le receiver obtiendra alors `Err(Disconnected)`.
fn spawn_stdout_reader(stdout: std::process::ChildStdout) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break; // le récepteur a été droppé (fin demandée)
                    }
                }
                Err(_) => break,
            }
        }
        // Fermeture naturelle : tx drop → rx.recv() renvoie Disconnected.
    });
    rx
}

/// Lit la prochaine ligne de pi avec un timeout. Retourne :
/// - `Ok(Some(line))` si une ligne est disponible
/// - `Ok(None)` si stdout est fermé (EOF, canal déconnecté)
/// - `Err("Timeout…")` si aucune ligne dans le délai imparti
fn next_line(rx: &mpsc::Receiver<String>, timeout: Duration) -> Result<Option<String>, String> {
    match rx.recv_timeout(timeout) {
        Ok(line) => Ok(Some(line)),
        Err(mpsc::RecvTimeoutError::Timeout) => Err("Timeout : pi n'a pas répondu dans le délai".to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Ok(None), // EOF stdout
    }
}

/// Extrait le message d'erreur d'un event `process_exit` / `extension_error`.
fn event_error_msg(event: &serde_json::Value) -> String {
    event
        .get("reason")
        .or_else(|| event.get("message"))
        .or_else(|| event.get("error"))
        .and_then(|v| v.as_str())
        .unwrap_or("Erreur lors de la réponse de l'aide")
        .to_string()
}

/// Attend l'accusé `{"type":"response","command":cmd}` de pi, vérifie `success`.
/// Ignore les events non pertinents (extension_ui_request, notifications…).
/// Détecte `process_exit` / `extension_error` (erreur immédiate).
fn wait_response(
    rx: &mpsc::Receiver<String>,
    cmd: &str,
    timeout: Duration,
) -> Result<bool, String> {
    let start = Instant::now();
    loop {
        // Timeout GLOBAL strict (pas seulement d'inactivité) : si pi streame en
        // continu (thinking_delta), recv_timeout(Duration::ZERO) renverrait
        // quand même les lignes en attente → boucle infinie sans cette garde.
        if start.elapsed() >= timeout {
            return Err(format!("Timeout : pi n'a pas accusé la commande {}", cmd));
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        match next_line(rx, remaining)? {
            None => return Err(format!("pi a fermé stdout avant d'accuser {}", cmd)),
            Some(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let event = match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if etype == "response"
                    && event.get("command").and_then(|v| v.as_str()) == Some(cmd)
                {
                    let ok = event.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !ok {
                        let err = event
                            .get("error")
                            .and_then(|v| v.as_str())
                            .unwrap_or("commande échouée")
                            .to_string();
                        return Err(format!("pi a refusé {} : {}", cmd, err));
                    }
                    return Ok(true);
                }
                if etype == "process_exit" || etype == "extension_error" {
                    return Err(event_error_msg(&event));
                }
                // Autres events (extension_ui_request, etc.) → ignorés.
            }
        }
    }
}

/// Collecte le stream de la réponse au prompt : accumule les `text_delta` des
/// events `message_update` jusqu'à `agent_end`. Ignore les `thinking_*`
/// (raisonnement interne) pour ne garder que le texte final affichable.
/// Détecte `process_exit` / `extension_error`.
fn collect_stream(rx: &mpsc::Receiver<String>, timeout: Duration) -> Result<String, String> {
    let start = Instant::now();
    let mut collected = String::new();
    loop {
        // Timeout GLOBAL strict (cf. wait_response) : sans cette garde, une
        // inférence qui streame en continu (thinking_delta) ne déclencherait
        // jamais le timeout car recv_timeout(Duration::ZERO) renvoie les lignes
        // en attente → boucle infinie.
        if start.elapsed() >= timeout {
            return Err("Timeout : la réponse de l'aide a pris plus de 2 minutes".to_string());
        }
        let remaining = timeout.saturating_sub(start.elapsed());
        match next_line(rx, remaining)? {
            None => {
                // EOF stdout sans agent_end.
                if collected.trim().is_empty() {
                    return Err("L'IA n'a retourné aucun texte (stream fermé prématurément)".to_string());
                }
                return Ok(collected.trim().to_string());
            }
            Some(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let event = match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match etype {
                    "message_update" => {
                        if let Some(delta) = event.get("assistantMessageEvent") {
                            let dtype = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if dtype == "text_delta" {
                                if let Some(t) = delta.get("delta").and_then(|v| v.as_str()) {
                                    collected.push_str(t);
                                }
                            }
                            // text_start / text_end / thinking_* : ignorés (le
                            // texte est déjà accumulé via text_delta).
                        }
                    }
                    "agent_end" => {
                        if collected.trim().is_empty() {
                            return Err("L'IA n'a retourné aucun texte".to_string());
                        }
                        return Ok(collected.trim().to_string());
                    }
                    "process_exit" | "extension_error" => {
                        return Err(event_error_msg(&event));
                    }
                    _ => {} // response(prompt), extension_ui_request, etc. → ignorés
                }
            }
        }
    }
}

/// Lance un processus pi temporaire `--mode rpc --no-session`, envoie les
/// commandes en séquence (new_session → set_model → prompt) en **attendant
/// l'accusé de chacune** avant la suivante, collecte la réponse streamée,
/// puis tue le process. Le modèle (format "provider/modelId") est obligatoire.
fn ask_pi_for_help(
    cwd: &str,
    pi_path: &str,
    prompt: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let pi_exe = if pi_path.is_empty() { "pi" } else { pi_path };

    let mut cmd = Command::new(pi_exe);
    cmd.args(["--mode", "rpc", "--no-session"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer pi pour l'aide : {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Impossible d'accéder à stdin")?;
    let stdout = child.stdout.take().ok_or("Impossible d'accéder à stdout")?;
    let stderr_child = child.stderr.take().ok_or("Impossible d'accéder à stderr")?;

    // Thread de lecture stdout (timeout réel via recv_timeout).
    let rx = spawn_stdout_reader(stdout);

    // Thread de lecture stderr en arrière-plan (non-bloquant). Sur Windows,
    // pi.cmd → node survit à kill() : stderr resterait ouvert, et un
    // read_to_string bloquant penderait indéfiniment. On lit donc dans un thread.
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf_clone = stderr_buf.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr_child);
        let mut s = String::new();
        let _ = reader.read_to_string(&mut s);
        *stderr_buf_clone.lock().unwrap() = s;
    });

    // Helper local d'envoi d'une commande JSON.
    let mut send = |cmd: &serde_json::Value| -> Result<(), String> {
        let line = serde_json::to_string(cmd).unwrap_or_default();
        writeln!(stdin, "{}", line).map_err(|e| format!("Erreur écriture stdin : {}", e))?;
        stdin.flush().map_err(|e| format!("Erreur flush : {}", e))?;
        Ok(())
    };

    // 1. new_session — attendre l'accusé avant de continuer.
    send(&serde_json::json!({"type":"new_session"}))
        .map_err(|e| format!("Erreur envoi new_session : {}", e))?;
    wait_response(&rx, "new_session", Duration::from_secs(30))
        .map_err(|e| format!("new_session : {}", e))?;

    // 2. set_model — obligatoire (pi --no-session n'a pas de modèle par défaut).
    if let Some(m) = model {
        let m = m.trim();
        if !m.is_empty() {
            let (provider, model_id) = match m.split_once('/') {
                Some((p, id)) => (p, id),
                None => (m, ""),
            };
            send(&serde_json::json!({
                "type": "set_model",
                "provider": provider,
                "modelId": model_id
            }))
            .map_err(|e| format!("Erreur envoi set_model : {}", e))?;
            wait_response(&rx, "set_model", Duration::from_secs(30)).map_err(|e| {
                format!(
                    "Modèle d'aide « {} » invalide : {} — sélectionne un autre modèle dans la liste déroulante",
                    m, e
                )
            })?;
        }
    }

    // 3. prompt — on garde stdin ouvert (ne pas drop) : pi a besoin du canal
    //    ouvert pendant le streaming de la réponse. On tue le process à la fin.
    send(&serde_json::json!({ "type": "prompt", "message": prompt }))
        .map_err(|e| format!("Erreur envoi prompt : {}", e))?;

    let result = collect_stream(&rx, Duration::from_secs(120));

    // Nettoyage : tuer pi ferme stdout → le thread de lecture se termine.
    // try_wait (non-bloquant) : sur Windows, pi.cmd lance un enfant node qui
    // survit à kill() ; un wait() bloquant pourrait donc pendre. On ne bloque pas.
    let _ = child.kill();
    let exit_status = child.try_wait().ok().flatten();
    let err_out = stderr_buf.lock().unwrap().clone();

    match result {
        Ok(text) => Ok(text),
        Err(e) => {
            // Enrichir le message d'erreur avec le code de sortie + stderr pour
            // le diagnostic, sans fuir le handbook.
            let exit_dbg = match exit_status {
                Some(s) => format!("exit_code={}", s.code().unwrap_or(-1)),
                None => "exit indisponible".to_string(),
            };
            let stderr_dbg = if err_out.trim().is_empty() {
                String::new()
            } else {
                format!("\nstderr: {}", err_out.trim())
            };
            Err(format!("{} [{}{}]{}", e, exit_dbg, stderr_dbg, ""))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test d'intégration (ignoré par défaut) : nécessite pi dans le PATH et un
    /// modèle local lancé (llama-cpp/ornith). Lancer avec :
    ///   cargo test --lib -- --ignored integration_ask_pi_for_help
    /// Valide que la séquence synchronisée (new_session → set_model → prompt)
    /// produit bien une réponse streamée.
    #[test]
    #[ignore]
    fn integration_ask_pi_for_help() {
        let cwd = std::env::temp_dir().to_string_lossy().to_string();
        // pi n'est pas forcément dans le PATH du test : utiliser PI_PATH env ou
        // le chemin npm par défaut (Windows).
        let pi_path = std::env::var("PI_PATH")
            .unwrap_or_else(|_| "C:\\Users\\pldistance\\AppData\\Roaming\\npm\\pi.cmd".to_string());
        let res = ask_pi_for_help(&cwd, &pi_path, "Réponds uniquement le mot OK", Some("llama-cpp/ornith"));
        println!("[help test] résultat = {:?}", res);
        assert!(res.is_ok(), "ask_pi_for_help a échoué : {:?}", res);
        let txt = res.unwrap();
        assert!(txt.to_uppercase().contains("OK"), "réponse inattendue : {}", txt);
        println!("[help test] ✅ réponse reçue : {}", txt);
    }
}