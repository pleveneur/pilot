// project_snapshot.rs — Snapshot structuré d'un projet (A1, outil assistant).
//
// Outil lecture seule `project_snapshot(project)` : retourne un état structuré
// d'un projet — liste des fichiers/dossiers principaux, langages détectés,
// état Git (branche, derniers commits) et métriques de base. Exposé comme outil
// de l'assistant (onglet 🧭) via l'extension pilot-assistant-actions.
//
// Réutilise les mécanismes existants (ne réinvente rien) :
//   - `dashboard::scan_project` / `dashboard::git_state` / `dashboard::lang_for_ext`
//     / `dashboard::detect_dependencies` / `dashboard::human_size` → métriques
//     fichiers + langages + état Git (issue #51).
//   - `crate::run_captured` → git log (derniers commits).
//   - `files.rs` → lecture (via scan_project).
//
// Lecture seule stricte : ne modifie aucun fichier du projet.

use std::fs;
use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::dashboard;
use crate::run_captured;

/// Liste les entrées de premier niveau (fichiers + dossiers) d'un projet, triées
/// (dossiers d'abord, puis par nom). Ignore les dossiers exclus (dépendances/
/// caches) pour ne pas polluer la vue « fichiers principaux ».
fn top_level_entries(root: &Path) -> Vec<Value> {
    let mut entries: Vec<Value> = Vec::new();
    if let Ok(read) = fs::read_dir(root) {
        for entry in read.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = path.is_dir();
            // Ignorer les dossiers exclus (dépendances/caches) — même liste que
            // le dashboard pour rester cohérent.
            if is_dir && dashboard::EXCLUDED_DIRS.contains(&name.as_str()) {
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            entries.push(serde_json::json!({
                "name": name,
                "type": if is_dir { "dir" } else { "file" },
                "size": size,
                "size_h": dashboard::human_size(size),
            }));
        }
    }
    // Dossiers d'abord, puis par nom (insensible à la casse).
    entries.sort_by(|a, b| {
        let a_dir = a.get("type").and_then(|x| x.as_str()).unwrap_or("") == "dir";
        let b_dir = b.get("type").and_then(|x| x.as_str()).unwrap_or("") == "dir";
        b_dir
            .cmp(&a_dir)
            .then_with(|| {
                a.get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_lowercase()
                    .cmp(&b.get("name").and_then(|x| x.as_str()).unwrap_or("").to_lowercase())
            })
    });
    entries
}

/// Derniers commits Git (top N) : hash court, message, auteur, date.
fn last_commits(cwd: &str, n: usize) -> Vec<Value> {
    let out = run_captured(
        "git",
        &[
            "-C", cwd, "log", "-n", &n.to_string(),
            "--format=%h|%an|%ad|%s", "--date=short",
        ],
        Duration::from_secs(5),
    );
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(4, '|');
            let hash = parts.next().unwrap_or("").to_string();
            let author = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            serde_json::json!({
                "hash": hash,
                "author": author,
                "date": date,
                "subject": subject,
            })
        })
        .collect()
}

/// Snapshot structuré d'un projet (lecture seule). `project` = chemin absolu.
/// Retourne : en-tête, fichiers/dossiers principaux, langages détectés, état
/// Git (branche + derniers commits) et métriques de base (taille, lignes, …).
#[tauri::command]
pub fn project_snapshot(project: String) -> Result<Value, String> {
    let project = project.trim().to_string();
    if project.is_empty() {
        return Err("Chemin de projet vide".to_string());
    }
    let root = Path::new(&project);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Le projet « {} » n'existe pas ou n'est pas un dossier.", project));
    }

    // ── En-tête ──
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&project)
        .to_string();

    // ── Métriques de base (réutilise scan_project du dashboard) ──
    let (
        total_size, file_count, dir_count, code_size, code_file_count,
        heaviest, lang_map, _ext_map, total_lines, total_functions,
        total_classes, total_todos, total_fixmes, _files_modified_7d,
    ) = dashboard::scan_project(root);

    // ── Langages détectés (répartition par nombre de fichiers) ──
    let total_lang_files: u64 = lang_map.values().map(|v| v.0).sum();
    let mut languages: Vec<Value> = lang_map
        .iter()
        .map(|(lang, (files, lines, funcs))| {
            let percent = if total_lang_files > 0 {
                (*files as f64 / total_lang_files as f64) * 100.0
            } else {
                0.0
            };
            serde_json::json!({
                "name": lang,
                "files": files,
                "lines": lines,
                "functions": funcs,
                "percent": (percent * 10.0).round() / 10.0,
            })
        })
        .collect();
    languages.sort_by(|a, b| {
        b.get("files").and_then(|x| x.as_u64()).unwrap_or(0)
            .cmp(&a.get("files").and_then(|x| x.as_u64()).unwrap_or(0))
    });

    // ── État Git (réutilise git_state du dashboard) + derniers commits ──
    let mut git = dashboard::git_state(&project);
    if git.get("is_repo").and_then(|x| x.as_bool()).unwrap_or(false) {
        git["last_commits"] = serde_json::json!(last_commits(&project, 10));
    } else {
        git["last_commits"] = serde_json::json!([]);
    }

    // ── Fichiers les plus lourds (top 5) ──
    let heaviest: Vec<Value> = heaviest
        .iter()
        .take(5)
        .map(|(p, s)| {
            let rel = p
                .strip_prefix(&project)
                .unwrap_or(p)
                .trim_start_matches(['/', '\\'])
                .to_string();
            serde_json::json!({ "path": rel, "size": s, "size_h": dashboard::human_size(*s) })
        })
        .collect();

    Ok(serde_json::json!({
        "project": {
            "name": name,
            "path": project,
        },
        "files": {
            "top_level": top_level_entries(root),
            "file_count": file_count,
            "dir_count": dir_count,
        },
        "languages": {
            "distribution": languages,
            "dependencies": dashboard::detect_dependencies(root),
        },
        "git": git,
        "metrics": {
            "total_size": total_size,
            "total_size_h": dashboard::human_size(total_size),
            "code_size": code_size,
            "code_size_h": dashboard::human_size(code_size),
            "code_file_count": code_file_count,
            "lines": total_lines,
            "functions": total_functions,
            "classes": total_classes,
            "todos": total_todos,
            "fixmes": total_fixmes,
            "heaviest": heaviest,
        },
    }))
}
