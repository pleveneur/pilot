// code_check.rs — Vérification de code (Mode Orchestration V2 : linting-in-the-loop).
//
// Domaine extrait de `lib.rs` (2026-08) : `check_syntax`, `lint_file` et
// `run_project_tests` lancent des outils locaux (eslint, py_compile, cargo check,
// commande de test) pour valider le travail du codeur. Inclut les helpers
// process locaux (`run_command`, `run_python_command`, `which`, `run_command_timed`).

use serde::Serialize;

use tauri::State;

use crate::AppState;

#[cfg(windows)]
use crate::CREATE_NO_WINDOW;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ── Vérification syntaxique (Mode Orchestration V2 — linting-in-the-loop) ──

#[derive(Debug, Serialize)]
pub struct SyntaxCheckResult {
    ok: bool,
    had_checker: bool,
    output: String,
}

/// Vérifie la syntaxe des fichiers modifiés par le codeur. Lance un outil local
/// adapté à l'extension : eslint pour JS/TS, python -m py_compile pour Python,
/// cargo check pour Rust. Si aucun vérificateur n'est disponible, la vérification
/// est silencieusement passée (had_checker=false) pour ne pas bloquer la tâche.
#[tauri::command]
pub fn check_syntax(paths: Vec<String>, project_path: String) -> Result<SyntaxCheckResult, String> {
    if paths.is_empty() {
        return Ok(SyntaxCheckResult {
            ok: true,
            had_checker: false,
            output: "Aucun fichier à vérifier".to_string(),
        });
    }

    let project = std::path::Path::new(&project_path);
    let mut all_ok = true;
    let mut outputs: Vec<String> = Vec::new();
    let mut had_checker = false;
    let mut rust_dirs: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();

    for path in &paths {
        let p = std::path::Path::new(path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let rel = p
            .strip_prefix(project)
            .unwrap_or(p)
            .to_string_lossy()
            .to_string();

        match ext {
            "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs" => {
                let eslint_local = project.join("node_modules").join(".bin").join(if cfg!(target_os = "windows") { "eslint.cmd" } else { "eslint" });
                let (cmd, args): (String, Vec<String>) = if eslint_local.exists() {
                    (eslint_local.to_string_lossy().to_string(), vec![path.clone()])
                } else if which("npx").is_some() {
                    ("npx".to_string(), vec!["--no-install".to_string(), "eslint".to_string(), path.clone()])
                } else {
                    outputs.push(format!(
                        "[{}] Aucun linter JS/TS disponible (eslint local ou npx introuvable)",
                        rel
                    ));
                    continue;
                };
                if let Some((ok, output)) = run_command(&cmd, &args, Some(&project_path)) {
                    had_checker = true;
                    all_ok = all_ok && ok;
                    outputs.push(format!("[{}] {}", rel, output));
                }
            }
            "py" => {
                let out = run_python_command("python", "-m", "py_compile", path, &project_path)
                    .or_else(|| run_python_command("python3", "-m", "py_compile", path, &project_path));
                if let Some((ok, output)) = out {
                    had_checker = true;
                    all_ok = all_ok && ok;
                    outputs.push(format!("[{}] {}", rel, output));
                } else {
                    outputs.push(format!("[{}] python/python3 introuvable", rel));
                }
            }
            "rs" => {
                // Trouver le Cargo.toml parent le plus proche
                let mut dir = p.parent();
                let mut found = None;
                while let Some(d) = dir {
                    if d.join("Cargo.toml").exists() {
                        found = Some(d.to_path_buf());
                        break;
                    }
                    dir = d.parent();
                }
                if let Some(dir) = found {
                    rust_dirs.insert(dir);
                } else {
                    outputs.push(format!("[{}] Aucun Cargo.toml trouvé pour cargo check", rel));
                }
            }
            _ => {
                outputs.push(format!(
                    "[{}] Extension non supportée par le linter intégré",
                    rel
                ));
            }
        }
    }

    // cargo check une seule fois par crate Rust concerné
    for dir in rust_dirs {
        let dir_str = dir.to_string_lossy().to_string();
        let label = dir.file_name().and_then(|f| f.to_str()).unwrap_or("rust");
        if let Some((ok, output)) = run_command("cargo", &["check"], Some(&dir_str)) {
            had_checker = true;
            all_ok = all_ok && ok;
            outputs.push(format!("[{}] {}", label, output));
        } else {
            outputs.push(format!("[{}] cargo introuvable", label));
        }
    }

    Ok(SyntaxCheckResult {
        ok: all_ok,
        had_checker,
        output: outputs.join("\n---\n"),
    })
}

fn run_python_command(binary: &str, arg1: &str, arg2: &str, file: &str, cwd: &str) -> Option<(bool, String)> {
    if which(binary).is_none() {
        return None;
    }
    run_command(binary, &[arg1, arg2, file], Some(cwd))
}

fn which(cmd: &str) -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    let out = {
        let mut c = std::process::Command::new("where");
        c.arg(cmd);
        c.creation_flags(CREATE_NO_WINDOW);
        c.output().ok()?
    };
    #[cfg(not(target_os = "windows"))]
    let out = std::process::Command::new("which").arg(cmd).output().ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout);
        s.lines().next().map(|l| std::path::PathBuf::from(l.trim()))
    } else {
        None
    }
}

fn run_command(cmd: impl AsRef<std::ffi::OsStr>, args: &[impl AsRef<std::ffi::OsStr>], cwd: Option<&str>) -> Option<(bool, String)> {
    let mut command = std::process::Command::new(cmd);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    if let Some(c) = cwd {
        command.current_dir(c);
    }
    let output = command.output().ok()?;
    let ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stdout.is_empty() {
        stderr
    } else if stderr.is_empty() {
        stdout
    } else {
        format!("{}\n{}", stdout, stderr)
    };
    Some((ok, combined))
}

// ── Lint diagnostics inline (B2) — eslint --format json pour JS/TS ──

#[derive(Debug, Serialize)]
pub struct LintDiagnostic {
    /// Ligne de début (1-indexée).
    from_line: usize,
    /// Colonne de début (1-indexée).
    from_col: usize,
    /// Ligne de fin (1-indexée).
    to_line: usize,
    /// Colonne de fin (1-indexée).
    to_col: usize,
    /// "error" ou "warning".
    severity: String,
    /// Message humain.
    message: String,
    /// Identifiant de règle (ex: "no-console") si disponible.
    source: String,
}

/// Lance le linter du projet sur un seul fichier et renvoie des diagnostics
/// structurés (ligne/col/sévérité/message) exploitables par `@codemirror/lint`.
/// V1 : JS/TS via eslint (`--format json`). Les autres langages renvoient une
/// liste vide (le lint intégré de l'orchestration reste sur `check_syntax`).
/// Aucun checker disponible → liste vide (échec silencieux côté éditeur).
#[tauri::command]
pub fn lint_file(
    state: State<AppState>,
    path: String,
) -> Result<Vec<LintDiagnostic>, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);
    let project_dir = std::path::Path::new(&project);

    let p = std::path::Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs" | "vue" => {}
        _ => return Ok(Vec::new()), // V1 : JS/TS uniquement
    }

    // Localiser eslint (local node_modules/.bin sinon npx --no-install)
    let eslint_local = project_dir
        .join("node_modules")
        .join(".bin")
        .join(if cfg!(target_os = "windows") {
            "eslint.cmd"
        } else {
            "eslint"
        });
    let (cmd, args): (String, Vec<String>) = if eslint_local.exists() {
        (eslint_local.to_string_lossy().to_string(), vec!["--format".to_string(), "json".to_string(), path.clone()])
    } else if which("npx").is_some() {
        (
            "npx".to_string(),
            vec![
                "--no-install".to_string(),
                "eslint".to_string(),
                "--format".to_string(),
                "json".to_string(),
                path.clone(),
            ],
        )
    } else {
        return Ok(Vec::new()); // Pas de linter disponible → silencieux
    };

    let out = run_command(&cmd, &args, Some(project.as_str()));
    let (_, raw) = match out {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };

    // eslint --format json : tableau d'objets { filePath, messages: [...] }
    // eslint renvoie exit code 1 s'il y a des erreurs, mais stdout contient le JSON.
    let trimmed = raw.trim();
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()), // Sortie non-JSON (eslint absent/cassé) → silencieux
    };

    let mut diags = Vec::new();
    for file_obj in parsed {
        if let Some(messages) = file_obj.get("messages").and_then(|m| m.as_array()) {
            for msg in messages {
                let line = msg.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let col = msg.get("column").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                let end_line = msg.get("endLine").and_then(|v| v.as_u64()).map(|v| v as usize).unwrap_or(line);
                let end_col = msg
                    .get("endColumn")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize)
                    .unwrap_or(col);
                let sev = msg.get("severity").and_then(|v| v.as_u64()).unwrap_or(1);
                let message = msg
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let rule = msg.get("ruleId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                diags.push(LintDiagnostic {
                    from_line: line,
                    from_col: col,
                    to_line: end_line,
                    to_col: end_col,
                    severity: if sev >= 2 { "error".to_string() } else { "warning".to_string() },
                    message,
                    source: rule,
                });
            }
        }
    }

    Ok(diags)
}

// ── Auto-test post-modification (E2, spec_orchestration_autotest.md) ──

#[derive(Debug, Serialize)]
pub struct TestRunResult {
    /// Code de sortie du process (`None` si timeout ou crash sans code).
    exit_code: Option<i32>,
    /// stdout capturé (tronqué à ~256 Ko).
    stdout: String,
    /// stderr capturé (tronqué à ~256 Ko).
    stderr: String,
    /// `true` si le process a été tué pour dépassement de timeout.
    timed_out: bool,
    /// Durée réelle d'exécution en ms.
    duration_ms: u32,
}

/// Exécute une commande de tests du projet avec timeout, capture stdout+stderr
/// (limités à ~256 Ko chacun), kill si le timeout est dépassé. La commande est
/// lancée **sans shell** (`Command::new(cmd).args(args)`, pas de `shell=true`)
/// pour éviter toute injection, et le `cwd` est forcé au projet ouvert par le
/// frontend. Utilisé par le Mode Orchestration (E2) après chaque tâche du codeur.
#[tauri::command]
pub fn run_project_tests(
    state: State<AppState>,
    command: String,
    args: Vec<String>,
    timeout_ms: u32,
) -> Result<TestRunResult, String> {
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);

    let (stdout, stderr, exit_code, timed_out, duration_ms) =
        run_command_timed(&command, &args, &cwd, timeout_ms);
    Ok(TestRunResult {
        exit_code,
        stdout,
        stderr,
        timed_out,
        duration_ms,
    })
}

/// Lance `<cmd> <args...>` dans `cwd`, capture stdout et stderr séparément
/// (lecteurs parallèles pour éviter le deadlock quand les buffers OS se
/// remplissent), kill si `timeout_ms` dépassé. Tronque chaque flux à 256 Ko
/// (les premiers échecs sont les plus pertinents ; un `cargo test` verbeux
/// peut produire plusieurs Mo). Renvoie `(stdout, stderr, exit_code, timed_out,
/// duration_ms)`.
fn run_command_timed(
    cmd: &str,
    args: &[String],
    cwd: &str,
    timeout_ms: u32,
) -> (String, String, Option<i32>, bool, u32) {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut command = Command::new(cmd);
    command.args(args).current_dir(cwd);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let start = Instant::now();
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            return (
                String::new(),
                format!("Impossible de lancer '{}': {}", cmd, e),
                None,
                false,
                0,
            );
        }
    };

    // Détacher les pipes avant la boucle d'attente (take) et les lire dans des
    // threads dédiés pour éviter le deadlock : si le process produit plus que
    // la capacité du buffer OS (~64 Ko) sur un flux non drainé, il bloque sur
    // l'écriture et ne termine jamais → try_wait boucle indéfiniment.
    let mut stdout_child = child.stdout.take();
    let mut stderr_child = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(8192);
        if let Some(ref mut s) = stdout_child {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(8192);
        if let Some(ref mut s) = stderr_child {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });

    let deadline = Duration::from_millis(timeout_ms as u64);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= deadline {
                    let _ = child.kill();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }

    // Attend la fin effective du child (immédiat après try_wait(Some) ou après
    // kill pour timeout) pour récupérer le code de sortie.
    let exit_code = match child.wait() {
        Ok(status) => {
            if timed_out {
                None
            } else {
                status.code()
            }
        }
        Err(_) => None,
    };

    let raw_stdout = stdout_handle.join().unwrap_or_default();
    let raw_stderr = stderr_handle.join().unwrap_or_default();

    let truncate = |b: Vec<u8>| -> String {
        const CAP: usize = 256 * 1024;
        if b.len() > CAP {
            let head = String::from_utf8_lossy(&b[..CAP]).to_string();
            format!("{}… (tronqué, {} octets au total)", head, b.len())
        } else {
            String::from_utf8_lossy(&b).to_string()
        }
    };

    let duration_ms = start.elapsed().as_millis() as u32;
    (truncate(raw_stdout), truncate(raw_stderr), exit_code, timed_out, duration_ms)
}

