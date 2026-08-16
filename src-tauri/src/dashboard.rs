// dashboard.rs — Tableau de bord projet (issue #51).
//
// Onglet « 📊 Tableau de bord » : vue détaillée du projet actif, alimentée par
// les métriques fichiers/Git (Rust) + la base de suivi de l'assistant
// (super-agent) + l'index de sessions (session_history). Réutilise
// `crate::run_captured` (git), `session_history::read_session_index` /
// `project_sessions_dir` / `project_to_session_folder` (activité) et la config
// (client associé). Lecture seule : ne modifie aucun fichier du projet.
//
// Sections : en-tête, stockage & poids, état Git, analyse code & langages,
// activité agent, évolution & vélocité, contexte & documentation, alertes.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::agent_service::SUPERAGENT_ID;
use crate::{run_captured, AppState};

/// Dossiers/dépendances/caches exclus du « poids du code source pur ».
pub(crate) const EXCLUDED_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", "out", ".venv", "venv",
    "__pycache__", ".pilot", ".idea", ".vscode", "coverage", ".next", ".nuxt",
    "vendor", ".cache", ".gradle", ".tox", ".mypy_cache", ".pytest_cache",
    ".terraform", ".svn", ".hg", ".gitlab", ".github", "Pods", ".dart_tool",
];

/// Extension → langage (pour la répartition). Retourne None pour les fichiers
/// non-code (binaires, images, etc.).
pub(crate) fn lang_for_ext(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "js" | "mjs" | "cjs" => "JavaScript",
        "jsx" => "JavaScript (React)",
        "ts" | "mts" | "cts" => "TypeScript",
        "tsx" => "TypeScript (React)",
        "py" => "Python",
        "rs" => "Rust",
        "go" => "Go",
        "java" => "Java",
        "c" => "C",
        "h" => "C/C++ Header",
        "cpp" | "cc" | "cxx" | "hpp" | "hh" => "C++",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "swift" => "Swift",
        "kt" | "kts" => "Kotlin",
        "scala" => "Scala",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "SCSS",
        "less" => "Less",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "sql" => "SQL",
        "sh" | "bash" => "Shell",
        "ps1" => "PowerShell",
        "bat" | "cmd" => "Batch",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "xml" => "XML",
        "md" | "markdown" => "Markdown",
        "txt" => "Text",
        "lua" => "Lua",
        "r" => "R",
        "dart" => "Dart",
        "ex" | "exs" => "Elixir",
        "erl" => "Erlang",
        "hs" => "Haskell",
        "clj" | "cljs" => "Clojure",
        "zig" => "Zig",
        "nim" => "Nim",
        "proto" => "Protobuf",
        "graphql" | "gql" => "GraphQL",
        "ini" | "cfg" => "Config",
        "dockerfile" => "Dockerfile",
        "makefile" => "Makefile",
        _ => return None,
    })
}

/// Détecte l'écosystème de dépendances du projet (fichiers de manifest présents).
pub(crate) fn detect_dependencies(root: &Path) -> Vec<String> {
    let mut deps: Vec<String> = Vec::new();
    let mut push = |name: &str, present: bool| {
        if present && !deps.contains(&name.to_string()) {
            deps.push(name.to_string());
        }
    };
    push("Node.js", root.join("package.json").exists());
    push("Rust (Cargo)", root.join("Cargo.toml").exists());
    push("Python (pip)", root.join("requirements.txt").exists() || root.join("pyproject.toml").exists() || root.join("setup.py").exists());
    push("Go", root.join("go.mod").exists());
    push("Java (Maven)", root.join("pom.xml").exists());
    push("Java (Gradle)", root.join("build.gradle").exists() || root.join("build.gradle.kts").exists());
    push("Ruby (Bundler)", root.join("Gemfile").exists());
    push("PHP (Composer)", root.join("composer.json").exists());
    push(".NET", root.join("*.csproj").exists() || root.join("*.sln").exists());
    push("Elixir (Mix)", root.join("mix.exs").exists());
    push("Dart (pub)", root.join("pubspec.yaml").exists());
    deps
}

/// Compte les lignes, fonctions et classes d'un fichier texte (heuristique).
fn count_code_metrics(content: &str) -> (u64, u64, u64) {
    let mut lines = 0u64;
    let mut functions = 0u64;
    let mut classes = 0u64;
    for line in content.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        lines += 1;
        // Heuristique fonctions (multi-langages).
        if t.contains("function")
            || t.contains("=>")
            || t.starts_with("def ")
            || t.starts_with("fn ")
            || t.starts_with("func ")
            || t.starts_with("public ")
            || t.starts_with("private ")
            || t.starts_with("protected ")
            || t.contains("() {")
        {
            functions += 1;
        }
        // Heuristique classes/structs/interfaces.
        if t.starts_with("class ")
            || t.starts_with("struct ")
            || t.starts_with("interface ")
            || t.starts_with("enum ")
            || t.starts_with("trait ")
            || t.starts_with("type ")
        {
            classes += 1;
        }
    }
    (lines, functions, classes)
}

/// Compte les marqueurs TODO/FIXME dans un contenu.
fn count_todos(content: &str) -> (u64, u64) {
    let mut todo = 0u64;
    let mut fixme = 0u64;
    for line in content.lines() {
        let up = line.to_uppercase();
        if up.contains("TODO") {
            todo += 1;
        }
        if up.contains("FIXME") {
            fixme += 1;
        }
    }
    (todo, fixme)
}

/// Parcourt récursivement le projet et agrège les métriques de stockage + code.
/// Retourne (total_size, file_count, dir_count, code_size, code_file_count,
/// heaviest_files, lang_map, ext_map, total_lines, total_functions,
/// total_classes, total_todos, total_fixmes, files_modified_7d).
/// `files_modified_7d` est une liste de (chemin, taille, mtime_epoch_secs).
#[allow(clippy::too_many_arguments)]
pub(crate) fn scan_project(
    root: &Path,
) -> (
    u64, u64, u64, u64, u64,
    Vec<(String, u64)>,
    HashMap<String, (u64, u64, u64)>, // lang → (files, lines, funcs)
    HashMap<String, u64>,            // ext → count
    u64, u64, u64, u64, u64,
    Vec<(String, u64, u64)>,
) {
    let mut total_size = 0u64;
    let mut file_count = 0u64;
    let mut dir_count = 0u64;
    let mut code_size = 0u64;
    let mut code_file_count = 0u64;
    let mut heaviest: Vec<(String, u64)> = Vec::new();
    let mut lang_map: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut ext_map: HashMap<String, u64> = HashMap::new();
    let mut total_lines = 0u64;
    let mut total_functions = 0u64;
    let mut total_classes = 0u64;
    let mut total_todos = 0u64;
    let mut total_fixmes = 0u64;
    let mut files_modified_7d: Vec<(String, u64, u64)> = Vec::new();

    let cutoff = std::time::SystemTime::now() - Duration::from_secs(7 * 24 * 3600);

    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                // Ignorer les dossiers exclus (dépendances/caches).
                if EXCLUDED_DIRS.contains(&name.as_str()) {
                    continue;
                }
                dir_count += 1;
                stack.push(path);
            } else {
                let meta = match fs::metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let size = meta.len();
                total_size += size;
                file_count += 1;
                // Fichiers modifiés sur 7 jours (vélocité).
                if let Ok(modified) = meta.modified() {
                    if modified >= cutoff {
                        let mtime = modified
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        files_modified_7d.push((path.to_string_lossy().to_string(), size, mtime));
                    }
                }
                // Fichiers les plus lourds (top 10).
                if heaviest.len() < 10 {
                    heaviest.push((path.to_string_lossy().to_string(), size));
                    heaviest.sort_by(|a, b| b.1.cmp(&a.1));
                } else if let Some(last) = heaviest.last() {
                    if size > last.1 {
                        heaviest.pop();
                        heaviest.push((path.to_string_lossy().to_string(), size));
                        heaviest.sort_by(|a, b| b.1.cmp(&a.1));
                    }
                }
                // Analyse code.
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                // Fichiers spéciaux sans extension.
                let base = name.to_lowercase();
                let lang = if base == "dockerfile" {
                    Some("Dockerfile")
                } else if base == "makefile" {
                    Some("Makefile")
                } else {
                    lang_for_ext(&ext)
                };
                if let Some(lang) = lang {
                    code_file_count += 1;
                    code_size += size;
                    *ext_map.entry(ext.clone()).or_insert(0) += 1;
                    // Lire le contenu pour les métriques (limité aux fichiers texte).
                    if size < 2_000_000 {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let (lines, funcs, classes) = count_code_metrics(&content);
                            let (todo, fixme) = count_todos(&content);
                            total_lines += lines;
                            total_functions += funcs;
                            total_classes += classes;
                            total_todos += todo;
                            total_fixmes += fixme;
                            let e = lang_map.entry(lang.to_string()).or_insert((0, 0, 0));
                            e.0 += 1;
                            e.1 += lines;
                            e.2 += funcs;
                        }
                    }
                }
            }
        }
    }
    (
        total_size, file_count, dir_count, code_size, code_file_count,
        heaviest, lang_map, ext_map, total_lines, total_functions,
        total_classes, total_todos, total_fixmes, files_modified_7d,
    )
}

/// État Git : branche active, fichiers modifiés / non suivis / prêts à commiter.
pub(crate) fn git_state(cwd: &str) -> Value {
    let check = run_captured("git", &["-C", cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return serde_json::json!({ "is_repo": false });
    }
    let branch = run_captured("git", &["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], Duration::from_secs(3));
    let branch = branch.trim().to_string();
    let out = run_captured(
        "git",
        &["-C", cwd, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut modified = 0u64;
    let mut untracked = 0u64;
    let mut staged = 0u64;
    for line in out.lines() {
        if line.len() < 2 {
            continue;
        }
        let code = &line[..2];
        let x = code.chars().next().unwrap_or(' ');
        let y = code.chars().nth(1).unwrap_or(' ');
        if x == '?' && y == '?' {
            untracked += 1;
        } else if x != ' ' {
            staged += 1;
        } else if y != ' ' {
            modified += 1;
        }
    }
    let total = modified + untracked + staged;
    serde_json::json!({
        "is_repo": true,
        "branch": branch,
        "modified": modified,
        "untracked": untracked,
        "staged": staged,
        "total": total,
    })
}

/// Activité agent : sessions, tokens 7j, messages, actions, dernière session.
/// S'appuie sur l'index `.pilot/sessions.jsonl` (session_history) + scan des
/// fichiers de session pi pour les actions d'outils. Agrège sur UN OU PLUSIEURS
/// projets (un seul quand un projet est actif ; tous les projets ouverts quand
/// aucun n'est actif, pour le volet Assistant du tableau de bord).
fn activity_metrics(state: &AppState, project_paths: &[String]) -> Value {
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::days(7);

    let mut session_count = 0u64;
    let mut tokens_7d = 0u64;
    let mut total_messages = 0u64;
    let mut last_session: Option<String> = None;

    for project_path in project_paths {
        let entries = crate::session_history::read_session_index(project_path);
        for e in &entries {
            session_count += 1;
            if let Some(t) = e.get("turns").and_then(|x| x.as_u64()) {
                total_messages += t;
            }
            let ts = e.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                let dt_utc = dt.with_timezone(&chrono::Utc);
                if dt_utc >= cutoff {
                    if let Some(t) = e.get("tokens").and_then(|x| x.as_u64()) {
                        tokens_7d += t;
                    }
                }
                if last_session.is_none() || dt_utc > last_session_parse(last_session.as_deref()) {
                    last_session = Some(ts.to_string());
                }
            } else if last_session.is_none() {
                last_session = Some(ts.to_string());
            }
        }
    }

    // Actions d'outils : scanner les fichiers de session pi des projets.
    let mut actions: HashMap<String, u64> = HashMap::new();
    let config = state.config.lock().unwrap();
    let session_dir = crate::session_history::project_sessions_dir(&config);
    for project_path in project_paths {
        let folder = crate::session_history::project_to_session_folder(project_path);
        let project_dir = session_dir.join(&folder);
        if project_dir.exists() {
            if let Ok(entries_iter) = fs::read_dir(&project_dir) {
                for entry in entries_iter.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                        continue;
                    }
                    if let Ok(content) = fs::read_to_string(&path) {
                        for line in content.lines() {
                            let line = line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            let v: Value = match serde_json::from_str(line) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
                            if t == "tool_execution_start" || t == "toolcall_start" {
                                let name = v
                                    .get("tool")
                                    .and_then(|x| x.get("name"))
                                    .and_then(|x| x.as_str())
                                    .or_else(|| v.get("toolName").and_then(|x| x.as_str()))
                                    .or_else(|| v.get("name").and_then(|x| x.as_str()))
                                    .unwrap_or("outil")
                                    .to_string();
                                *actions.entry(name).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    drop(config);
    let total_actions: u64 = actions.values().sum();
    let bash = actions.get("Bash").or_else(|| actions.get("bash")).copied().unwrap_or(0);
    let edit = actions.get("edit").copied().unwrap_or(0);
    let write = actions.get("write").copied().unwrap_or(0);

    // Série temporelle tokens/messages par jour (7 jours).
    let by_day = activity_by_day(project_paths);

    serde_json::json!({
        "session_count": session_count,
        "tokens_7d": tokens_7d,
        "total_messages": total_messages,
        "actions": {
            "bash": bash,
            "edit": edit,
            "write": write,
            "total": total_actions,
        },
        "by_day": by_day,
        "last_session": last_session,
    })
}

fn last_session_parse(s: Option<&str>) -> chrono::DateTime<chrono::Utc> {
    s.and_then(|x| chrono::DateTime::parse_from_rfc3339(x).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap())
}

/// Liste des 7 derniers jours (dates locales YYYY-MM-DD, du plus ancien au plus récent).
fn last_7_days() -> Vec<String> {
    let now = chrono::Local::now();
    (0..7)
        .rev()
        .map(|i| (now - chrono::Duration::days(i)).format("%Y-%m-%d").to_string())
        .collect()
}

/// Remplit les 7 derniers jours depuis une map date → valeur (0 si absent).
fn fill_days(map: &HashMap<String, u64>) -> Vec<Value> {
    last_7_days()
        .into_iter()
        .map(|d| serde_json::json!({ "date": d, "value": map.get(&d).copied().unwrap_or(0) }))
        .collect()
}

/// Commits par jour sur 7 jours (git log --date=short, agrégé par date).
fn commits_by_day(cwd: &str) -> Vec<Value> {
    let out = run_captured(
        "git",
        &["-C", cwd, "log", "--since=7 days ago", "--format=%ad", "--date=short"],
        Duration::from_secs(5),
    );
    let mut map: HashMap<String, u64> = HashMap::new();
    for line in out.lines() {
        let d = line.trim();
        if d.is_empty() {
            continue;
        }
        *map.entry(d.to_string()).or_insert(0) += 1;
    }
    fill_days(&map)
}

/// Fichiers modifiés par jour sur 7 jours (mtime, agrégé par date locale).
fn files_by_day(files: &[(String, u64, u64)]) -> Vec<Value> {
    let mut map: HashMap<String, u64> = HashMap::new();
    for (_, _, mtime) in files {
        let day = chrono::DateTime::from_timestamp(*mtime as i64, 0)
            .map(|dt| dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        if !day.is_empty() {
            *map.entry(day).or_insert(0) += 1;
        }
    }
    fill_days(&map)
}

/// Tokens & messages par jour sur 7 jours, depuis l'index de sessions.
fn activity_by_day(project_paths: &[String]) -> Vec<Value> {
    let mut map: HashMap<String, (u64, u64)> = HashMap::new();
    for project_path in project_paths {
        let entries = crate::session_history::read_session_index(project_path);
        for e in &entries {
            let ts = e.get("timestamp").and_then(|x| x.as_str()).unwrap_or("");
            let day = match chrono::DateTime::parse_from_rfc3339(ts) {
                Ok(dt) => dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string(),
                Err(_) => continue,
            };
            let tokens = e.get("tokens").and_then(|x| x.as_u64()).unwrap_or(0);
            let turns = e.get("turns").and_then(|x| x.as_u64()).unwrap_or(0);
            let entry = map.entry(day).or_insert((0, 0));
            entry.0 += tokens;
            entry.1 += turns;
        }
    }
    last_7_days()
        .into_iter()
        .map(|d| {
            let (tokens, messages) = map.get(&d).copied().unwrap_or((0, 0));
            serde_json::json!({ "date": d, "tokens": tokens, "messages": messages })
        })
        .collect()
}

/// Contexte & documentation : extrait README, fichiers mémoire, derniers fichiers.
fn context_docs(root: &Path, files_modified_7d: &[(String, u64, u64)]) -> Value {
    // README (extrait).
    let mut readme = String::new();
    for name in ["README.md", "readme.md", "README", "Readme.md"] {
        let p = root.join(name);
        if p.exists() {
            if let Ok(c) = fs::read_to_string(&p) {
                let chars: Vec<char> = c.chars().take(600).collect();
                readme = chars.iter().collect::<String>();
                if c.chars().count() > 600 {
                    readme.push('…');
                }
            }
            break;
        }
    }
    // Fichiers mémoire / décisions d'architecture.
    let mut memory_files: Vec<String> = Vec::new();
    for name in ["PROJECT_MEMORY.md", "AGENTS.md", "ARCHITECTURE.md", "docs/architecture.md", "DECISIONS.md", "ADR.md"] {
        if root.join(name).exists() {
            memory_files.push(name.to_string());
        }
    }
    // Derniers fichiers modifiés (tri par mtime décroissant, top 8).
    let mut recent: Vec<(String, u64, u64)> = files_modified_7d.to_vec();
    recent.sort_by(|a, b| b.1.cmp(&a.1));
    let recent: Vec<Value> = recent
        .iter()
        .take(8)
        .map(|(p, _, _)| {
            let rel = p
                .strip_prefix(&root.to_string_lossy().to_string())
                .unwrap_or(p)
                .trim_start_matches(['/', '\\'])
                .to_string();
            let mtime = fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            serde_json::json!({ "path": rel, "mtime": mtime })
        })
        .collect();
    serde_json::json!({
        "readme": readme,
        "memory_files": memory_files,
        "recent_files": recent,
    })
}

/// Construit la liste d'alertes & suggestions.
fn build_alerts(
    heaviest: &[(String, u64)],
    git: &Value,
    lang_map: &HashMap<String, (u64, u64, u64)>,
    total_size: u64,
) -> Vec<Value> {
    let mut alerts: Vec<Value> = Vec::new();
    // Fichiers volumineux.
    for (p, size) in heaviest.iter().take(3) {
        if *size > 1_000_000 {
            let rel = p.rsplit(['/', '\\']).next().unwrap_or(p);
            alerts.push(serde_json::json!({
                "level": "warning",
                "text": format!("Fichier volumineux : {} ({})", rel, human_size(*size)),
            }));
        }
    }
    // Éléments non commités.
    if git.get("is_repo").and_then(|x| x.as_bool()).unwrap_or(false) {
        let total = git.get("total").and_then(|x| x.as_u64()).unwrap_or(0);
        if total > 0 {
            alerts.push(serde_json::json!({
                "level": "info",
                "text": format!("{} élément(s) non commité(s) ({} modifié(s), {} non suivi(s), {} prêt(s)).", total,
                    git.get("modified").and_then(|x| x.as_u64()).unwrap_or(0),
                    git.get("untracked").and_then(|x| x.as_u64()).unwrap_or(0),
                    git.get("staged").and_then(|x| x.as_u64()).unwrap_or(0)),
            }));
        }
    }
    // Langage principal.
    if let Some((lang, _)) = lang_map.iter().max_by_key(|(_, v)| v.0) {
        alerts.push(serde_json::json!({
            "level": "info",
            "text": format!("Langage principal : {}.", lang),
        }));
    }
    // Taille globale.
    if total_size > 500_000_000 {
        alerts.push(serde_json::json!({
            "level": "warning",
            "text": format!("Projet volumineux : {} au total.", human_size(total_size)),
        }));
    }
    alerts
}

pub(crate) fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} Go", b / GB)
    } else if b >= MB {
        format!("{:.1} Mo", b / MB)
    } else if b >= KB {
        format!("{:.1} Ko", b / KB)
    } else {
        format!("{} o", bytes)
    }
}

/// Commande principale : renvoie toutes les métriques du tableau de bord du
/// projet actif. Lecture seule. Retourne un objet JSON structuré par section.
#[tauri::command]
pub fn get_project_dashboard(state: State<AppState>) -> Result<Value, String> {
    let project_path = state.project_path.lock().unwrap().clone();

    // Aucun projet ouvert : retourner le volet Assistant uniquement (métriques
    // agent agrégées sur tous les projets ouverts, ou vides si aucun). Le
    // frontend masque la partie projet via `has_project: false`.
    let Some(project_path) = project_path else {
        let projects = state.config.lock().unwrap().open_projects.clone();
        let activity = activity_metrics(&state, &projects);
        return Ok(serde_json::json!({
            "has_project": false,
            "project": {
                "name": "",
                "path": "",
                "client": "",
                "refreshed_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            },
            "activity": activity,
        }));
    };

    let root = Path::new(&project_path);
    if !root.exists() {
        return Err(format!("Le projet « {} » n'existe pas.", project_path));
    }

    // ── En-tête ──
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&project_path)
        .to_string();
    let client = {
        let cfg = state.config.lock().unwrap();
        cfg.super_agent_project_client
            .get(&project_path)
            .cloned()
            .unwrap_or_default()
    };
    let refreshed_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // ── Stockage & poids ──
    let (
        total_size, file_count, dir_count, code_size, code_file_count,
        heaviest, lang_map, ext_map, total_lines, total_functions,
        total_classes, total_todos, total_fixmes, files_modified_7d,
    ) = scan_project(root);

    // ── État Git ──
    let git = git_state(&project_path);

    // ── Analyse code & langages ──
    let total_lang_files: u64 = lang_map.values().map(|v| v.0).sum();
    let mut distribution: Vec<Value> = lang_map
        .iter()
        .map(|(lang, (files, lines, funcs))| {
            let percent = if total_lang_files > 0 {
                (*files as f64 / total_lang_files as f64) * 100.0
            } else {
                0.0
            };
            serde_json::json!({
                "name": lang,
                "percent": (percent * 10.0).round() / 10.0,
                "files": files,
                "lines": lines,
                "functions": funcs,
            })
        })
        .collect();
    distribution.sort_by(|a, b| {
        b.get("files").and_then(|x| x.as_u64()).unwrap_or(0)
            .cmp(&a.get("files").and_then(|x| x.as_u64()).unwrap_or(0))
    });
    let mut extensions: Vec<Value> = ext_map
        .iter()
        .map(|(ext, count)| serde_json::json!({ "ext": ext, "count": count }))
        .collect();
    extensions.sort_by(|a, b| {
        b.get("count").and_then(|x| x.as_u64()).unwrap_or(0)
            .cmp(&a.get("count").and_then(|x| x.as_u64()).unwrap_or(0))
    });
    let dependencies = detect_dependencies(root);

    // ── Activité agent ──
    let activity = activity_metrics(&state, &[project_path.clone()]);

    // ── Évolution & vélocité ──
    let commits_7d = run_captured(
        "git",
        &["-C", &project_path, "log", "--since=7 days ago", "--oneline"],
        Duration::from_secs(5),
    )
    .lines()
    .filter(|l| !l.trim().is_empty())
    .count() as u64;
    let files_modified_7d_count = files_modified_7d.len() as u64;
    let lines_modified_7d: u64 = files_modified_7d
        .iter()
        .filter_map(|(p, _, _)| fs::read_to_string(p).ok())
        .map(|c| c.lines().count() as u64)
        .sum();
    let size_modified_7d: u64 = files_modified_7d.iter().map(|(_, s, _)| s).sum();

    // ── Séries temporelles par jour (7 jours) ──
    let commits_by_day = commits_by_day(&project_path);
    let files_by_day = files_by_day(&files_modified_7d);

    // ── Contexte & documentation ──
    let context = context_docs(root, &files_modified_7d);

    // ── Alertes ──
    let alerts = build_alerts(&heaviest, &git, &lang_map, total_size);

    Ok(serde_json::json!({
        "has_project": true,
        "project": {
            "name": name,
            "path": project_path,
            "client": client,
            "refreshed_at": refreshed_at,
        },
        "storage": {
            "total_size": total_size,
            "total_size_h": human_size(total_size),
            "file_count": file_count,
            "dir_count": dir_count,
            "code_size": code_size,
            "code_size_h": human_size(code_size),
            "code_file_count": code_file_count,
            "heaviest": heaviest.iter().map(|(p, s)| serde_json::json!({
                "path": p,
                "size": s,
                "size_h": human_size(*s),
            })).collect::<Vec<_>>(),
        },
        "git": git,
        "languages": {
            "distribution": distribution,
            "extensions": extensions,
            "metrics": {
                "lines": total_lines,
                "functions": total_functions,
                "classes": total_classes,
            },
            "todos": total_todos,
            "fixmes": total_fixmes,
            "dependencies": dependencies,
        },
        "activity": activity,
        "evolution": {
            "period_days": 7,
            "commits_7d": commits_7d,
            "files_modified_7d": files_modified_7d_count,
            "lines_modified_7d": lines_modified_7d,
            "size_modified_7d": size_modified_7d,
            "size_modified_7d_h": human_size(size_modified_7d),
            "commits_by_day": commits_by_day,
            "files_by_day": files_by_day,
        },
        "context": context,
        "alerts": alerts,
    }))
}

/// Suivi multi-projets (tableau de bord) : état de suivi de tous les projets
/// ouverts (ou du projet actif seul si la liste est vide). Pour chaque projet :
/// chemin, nom, client associé, activité de l'agent (occupé ?), nombre de
/// tâches (total + ouvertes), statut de suivi et horodatage de la dernière
/// session indexée. Lecture seule — ne modifie aucun fichier.
#[tauri::command]
pub fn get_project_tracking(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    let config = state.config.lock().unwrap();
    let mut projects: Vec<String> = if config.open_projects.is_empty() {
        state
            .project_path
            .lock()
            .unwrap()
            .clone()
            .into_iter()
            .collect()
    } else {
        config.open_projects.clone()
    };
    // Dédoublonner + conserver l'ordre.
    let mut seen = std::collections::HashSet::new();
    projects.retain(|p| seen.insert(p.clone()));
    let active = state.active_project.lock().unwrap().clone();
    let client_map = config.super_agent_project_client.clone();
    drop(config);

    // Activité de l'agent par projet (issue #13). Calculée sous le verrou puis
    // libérée avant les I/O disque (lecture des index de sessions).
    let now = std::time::Instant::now();
    let grace = std::time::Duration::from_secs(crate::rpc::ACTIVITY_GRACE_SECS);
    let busy_map: HashMap<String, bool> = {
        let activity = state.agent_activity.lock().unwrap();
        projects
            .iter()
            .map(|p| {
                let busy = activity
                    .get(p)
                    .map(|a| a.busy || now.duration_since(a.updated) < grace)
                    .unwrap_or(false);
                (p.clone(), busy)
            })
            .collect()
    };

    // Tâches + statut depuis la base de l'assistant (super-agent).
    let mut task_counts: HashMap<String, (u64, u64, String)> = HashMap::new();
    if let Ok(conn) = crate::super_agent::open_db(&app) {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT p.path, p.status, COUNT(t.id), \
             SUM(CASE WHEN t.status NOT IN ('done','cancelled','closed') THEN 1 ELSE 0 END) \
             FROM projects p LEFT JOIN tasks t ON t.project_id = p.id \
             GROUP BY p.path",
        ) {
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1).unwrap_or_default(),
                    r.get::<_, i64>(2).unwrap_or(0) as u64,
                    r.get::<_, i64>(3).unwrap_or(0) as u64,
                ))
            });
            if let Ok(rows) = rows {
                for row in rows.flatten() {
                    task_counts.insert(row.0, (row.2, row.3, row.1));
                }
            }
        }
    }

    let mut out: Vec<Value> = Vec::new();
    for path in &projects {
        let name = Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_string();
        let client = client_map.get(path).cloned().unwrap_or_default();
        let busy = *busy_map.get(path).unwrap_or(&false);
        let (task_count, open_tasks, status) =
            task_counts.get(path).cloned().unwrap_or((0, 0, String::new()));
        // Dernière session indexée pour ce projet.
        let last_session = crate::session_history::read_session_index(path)
            .into_iter()
            .filter_map(|e| e.get("timestamp").and_then(|x| x.as_str()).map(String::from))
            .max();
        out.push(serde_json::json!({
            "path": path,
            "name": name,
            "client": client,
            "active": active.as_deref() == Some(path.as_str()),
            "agent_busy": busy,
            "task_count": task_count,
            "open_tasks": open_tasks,
            "status": status,
            "last_session": last_session.unwrap_or_default(),
        }));
    }

    Ok(serde_json::json!({ "projects": out, "active": active }))
}

/// Supervision multi-projets (P8) : vue agrégée des agents en cours sur TOUS
/// les projets, par projet, avec leur état (running / paused / stopped).
/// Réutilise le mécanisme existant `AgentService::list_agent_sessions` (P2) —
/// ne réinvente pas la supervision. Lecture seule.
///
/// L'état de l'assistant (super-agent, projet pseudo-global "") est inclus
/// dans la même vue, libellé « Assistant (Magnus) » (A14).
///
/// Mapping d'état depuis la machine à états du registre :
/// - vivant + actif  → "running"
/// - vivant + parké  → "paused"
/// - processus mort  → "stopped"
/// (l'état "compacting" n'existe pas encore dans le registre ; le frontend
/// l'affiche tel quel s'il apparaît un jour.)
#[tauri::command]
pub fn get_agent_supervision(state: State<AppState>, app: AppHandle) -> Result<Value, String> {
    let sessions = state.agent_service.list_agent_sessions(&app)?;
    let sessions = sessions
        .get("sessions")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    // Agrégation par projet : (projet, agent, état, mode, vivant, visible, actif).
    let mut by_project: Vec<(String, Vec<Value>)> = Vec::new();
    for s in sessions {
        let project = s.get("project").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let agent = s.get("agent").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let state = s.get("state").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let alive = s.get("alive").and_then(|x| x.as_bool()).unwrap_or(false);
        let mode = s.get("mode").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let visible = s.get("visible").and_then(|x| x.as_bool()).unwrap_or(false);
        let active = s.get("active").and_then(|x| x.as_bool()).unwrap_or(false);

        let status = if !alive {
            "stopped"
        } else if state == "active" {
            "running"
        } else {
            "paused"
        };

        // L'assistant (super-agent) est enregistré sous l'id `superagent` avec
        // un projet pseudo-global "" : on lui donne un libellé lisible.
        let agent_label = if agent == SUPERAGENT_ID {
            "Assistant (Magnus)".to_string()
        } else {
            agent
        };

        let entry = serde_json::json!({
            "agent": agent_label,
            "mode": mode,
            "state": status,
            "alive": alive,
            "visible": visible,
            "active": active,
        });

        if let Some((_, list)) = by_project.iter_mut().find(|(p, _)| *p == project) {
            list.push(entry);
        } else {
            by_project.push((project, vec![entry]));
        }
    }

    // Tri par projet (nom), puis par agent.
    by_project.sort_by(|a, b| a.0.cmp(&b.0));
    for (_, list) in by_project.iter_mut() {
        list.sort_by(|a, b| {
            a.get("agent")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .cmp(b.get("agent").and_then(|x| x.as_str()).unwrap_or(""))
        });
    }

    let projects: Vec<Value> = by_project
        .into_iter()
        .map(|(project, agents)| {
            // Projet pseudo-global "" = assistant (super-agent).
            let name = if project.is_empty() {
                "Assistant (Magnus)".to_string()
            } else {
                Path::new(&project)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&project)
                    .to_string()
            };
            serde_json::json!({ "path": project, "name": name, "agents": agents })
        })
        .collect();

    Ok(serde_json::json!({ "projects": projects }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lang_for_ext_known() {
        assert_eq!(lang_for_ext("rs"), Some("Rust"));
        assert_eq!(lang_for_ext("ts"), Some("TypeScript"));
        assert_eq!(lang_for_ext("py"), Some("Python"));
        assert_eq!(lang_for_ext("js"), Some("JavaScript"));
    }

    #[test]
    fn lang_for_ext_unknown() {
        assert_eq!(lang_for_ext("png"), None);
        assert_eq!(lang_for_ext("exe"), None);
    }

    #[test]
    fn count_code_metrics_counts_lines() {
        let (lines, funcs, classes) = count_code_metrics("fn main() {\n  let x = 1;\n}\n\nclass Foo {}\n");
        assert_eq!(lines, 4);
        assert!(funcs >= 1);
        assert!(classes >= 1);
    }

    #[test]
    fn count_todos_detects_markers() {
        let (todo, fixme) = count_todos("// TODO: fix this\n// FIXME: later\n// todo again\n");
        assert_eq!(todo, 2);
        assert_eq!(fixme, 1);
    }

    #[test]
    fn human_size_formats() {
        assert_eq!(human_size(500), "500 o");
        assert_eq!(human_size(2048), "2.0 Ko");
        assert_eq!(human_size(5 * 1024 * 1024), "5.0 Mo");
    }

    #[test]
    fn detect_dependencies_empty_dir() {
        let tmp = std::env::temp_dir().join(format!("pilot_dash_deps_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let deps = detect_dependencies(&tmp);
        assert!(deps.is_empty());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn detect_dependencies_node() {
        let tmp = std::env::temp_dir().join(format!("pilot_dash_deps2_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        fs::write(tmp.join("package.json"), "{}").unwrap();
        let deps = detect_dependencies(&tmp);
        assert!(deps.contains(&"Node.js".to_string()));
        let _ = fs::remove_dir_all(&tmp);
    }
}
