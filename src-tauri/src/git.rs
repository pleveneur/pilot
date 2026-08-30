// git.rs — Intégration Git (C1) : statut, diff visuel, snapshots d'orchestration.
//
// Domaines extraits de `lib.rs` (2026-08) pour réduire la dette structurelle :
//   - `git_status` / `git_diff_file`  → badges de statut + diff visuel (C1).
//   - `git_create_snapshot` / `git_restore_snapshot` → A1 snapshots/annulation.
//
// Dépend de `crate::run_captured` (helper process partagé) et de
// `crate::AppState` (projet courant). Aucune logique métier agent ici.

use std::collections::HashMap;
use std::fs;
use std::time::Duration;

use serde_json::Value;
use tauri::State;

use crate::{run_captured, AppState};

// ── Helpers git génériques (GDS, spec_gds.md §4) ──
// Opérations git serveur/poste réutilisées par `gds.rs` (Phase A3) : init bare,
// clone, remote add, push, pull. Toutes passent par `run_captured` (helper
// process partagé) et retournent une erreur lisible en cas d'échec.

/// Initialise un dépôt bare (côté serveur GDS).
pub fn git_init_bare(path: &str) -> Result<(), String> {
    let out = run_captured("git", &["init", "--bare", path], Duration::from_secs(10));
    if out.trim().is_empty() {
        return Err("git init --bare a échoué (git absent ?)".to_string());
    }
    Ok(())
}

/// Clone un dépôt distant dans un dossier local.
#[allow(dead_code)] // GDS Phase A3 (spec_gds.md §4) — pas encore branché
pub fn git_clone(url: &str, dest: &str) -> Result<(), String> {
    let out = run_captured("git", &["clone", url, dest], Duration::from_secs(60));
    if out.trim().is_empty() {
        return Err(format!("git clone a échoué: {}", url));
    }
    Ok(())
}

/// Ajoute (ou met à jour) un remote à un dépôt local.
pub fn git_remote_add(cwd: &str, name: &str, url: &str) -> Result<(), String> {
    // Retirer un remote existant du même nom pour être idempotent.
    run_captured("git", &["-C", cwd, "remote", "remove", name], Duration::from_secs(5));
    let out = run_captured("git", &["-C", cwd, "remote", "add", name, url], Duration::from_secs(5));
    if out.trim().is_empty() {
        return Err(format!("git remote add a échoué: {}", name));
    }
    Ok(())
}

/// Pousse la branche courante (ou HEAD) vers un remote.
pub fn git_push(cwd: &str, remote: &str, branch: &str) -> Result<(), String> {
    let out = run_captured(
        "git",
        &["-C", cwd, "push", "-u", remote, branch],
        Duration::from_secs(60),
    );
    if out.trim().is_empty() {
        return Err(format!("git push a échoué (remote {}): {}", remote, out.trim()));
    }
    Ok(())
}

/// Tire les changements depuis un remote (branch courante).
#[allow(dead_code)] // GDS Phase A3 (spec_gds.md §4) — pas encore branché
pub fn git_pull(cwd: &str, remote: &str, branch: &str) -> Result<(), String> {
    let out = run_captured(
        "git",
        &["-C", cwd, "pull", remote, branch],
        Duration::from_secs(60),
    );
    if out.trim().is_empty() {
        return Err(format!("git pull a échoué (remote {}): {}", remote, out.trim()));
    }
    Ok(())
}

/// Nom de la branche courante d'un dépôt local (vide si détaché / pas de HEAD).
pub fn git_current_branch(cwd: &str) -> String {
    run_captured("git", &["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], Duration::from_secs(3))
        .trim()
        .to_string()
}

/// Résultat de `git_status` : `is_repo` (faux → pas un work tree Git), et la map
/// path → code porcelain v1 (`M`, `A`, `D`, `??`, …) pour les badges explorateur.
#[derive(serde::Serialize)]
pub(crate) struct GitStatus {
    is_repo: bool,
    entries: HashMap<String, String>,
}

#[tauri::command]
pub fn git_status(state: State<AppState>) -> Result<GitStatus, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    // Vérifier qu'on est dans un work tree Git.
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitStatus { is_repo: false, entries: HashMap::new() });
    }
    let out = run_captured(
        "git",
        &["-C", &cwd, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut entries = HashMap::new();
    for line in out.lines() {
        // Format porcelain v1 : `XY <path>` (path quoté si espaces/unicode).
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].to_string();
        let mut path = line[3..].to_string();
        // Déquote porcelain v1 : entoure de "..." si le path contient des espaces.
        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
            // Échappement C-style minimal : \" → " et \\ → \
            path = path.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        if !path.is_empty() {
            entries.insert(path, code);
        }
    }
    Ok(GitStatus { is_repo: true, entries })
}

/// Résultat de `git_diff_file` : `before` = version commitée (`HEAD:<relpath>`,
/// vide si non tracked ou jamais commité), `after` = contenu courant sur disque.
/// Sert au diff visuel (`diff-view.js`) en mode lecture seule.
#[derive(serde::Serialize)]
pub(crate) struct GitFileDiff {
    is_repo: bool,
    tracked: bool,
    before: String,
    after: String,
}

#[tauri::command]
pub fn git_diff_file(state: State<AppState>, path: String) -> Result<GitFileDiff, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let after = fs::read_to_string(&path).unwrap_or_default();
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(GitFileDiff { is_repo: false, tracked: false, before: String::new(), after });
    }
    // Chemin tracked relatif au repo root (vide si fichier non suivi).
    let rel = run_captured("git", &["-C", &cwd, "ls-files", "--full-name", "--", &path], Duration::from_secs(3));
    let rel = rel.trim().to_string();
    if rel.is_empty() {
        return Ok(GitFileDiff { is_repo: true, tracked: false, before: String::new(), after });
    }
    // Version commitée. Échoue (stdout vide) si staged-new jamais commité → before "".
    let before = run_captured("git", &["-C", &cwd, "show", &format!("HEAD:{}", rel)], Duration::from_secs(5));
    Ok(GitFileDiff { is_repo: true, tracked: true, before, after })
}

/// État Git d'un projet (outil assistant, lecture seule). `project` = chemin
/// absolu. Retourne la branche, les fichiers modifiés/ajoutés/supprimés et le
/// nombre d'éléments en attente (staged). Réutilise `run_captured` (helper
/// process partagé) et le format porcelain v1 de `git status`.
#[tauri::command]
pub fn git_status_project(project: String) -> Result<Value, String> {
    use std::time::Duration;
    let project = project.trim().to_string();
    if project.is_empty() {
        return Err("Chemin de projet vide".to_string());
    }
    let check = run_captured("git", &["-C", &project, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(serde_json::json!({ "is_repo": false }));
    }
    let branch = run_captured("git", &["-C", &project, "rev-parse", "--abbrev-ref", "HEAD"], Duration::from_secs(3));
    let branch = branch.trim().to_string();
    let out = run_captured(
        "git",
        &["-C", &project, "status", "--porcelain", "-uall", "--no-renames"],
        Duration::from_secs(8),
    );
    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut untracked = Vec::new();
    let mut staged = Vec::new();
    for line in out.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line[..2].to_string();
        let mut path = line[3..].to_string();
        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
            path = path.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        let x = code.chars().next().unwrap_or(' ');
        let y = code.chars().nth(1).unwrap_or(' ');
        if x == '?' && y == '?' {
            untracked.push(path);
        } else if x != ' ' {
            staged.push(path.clone());
            if y == 'D' || x == 'D' {
                deleted.push(path);
            } else if x == 'A' {
                added.push(path);
            } else {
                modified.push(path);
            }
        } else if y != ' ' {
            if y == 'D' {
                deleted.push(path);
            } else if y == 'A' {
                added.push(path);
            } else {
                modified.push(path);
            }
        }
    }
    Ok(serde_json::json!({
        "is_repo": true,
        "branch": branch,
        "modified": modified,
        "added": added,
        "deleted": deleted,
        "untracked": untracked,
        "staged": staged,
        "pending": modified.len() + added.len() + deleted.len() + untracked.len() + staged.len(),
    }))
}

/// Historique des commits d'un projet (outil assistant, lecture seule).
/// `project` = chemin absolu. Retourne les N derniers commits (N=20) avec
/// hash court, message, auteur et date. Réutilise `run_captured`.
#[tauri::command]
pub fn git_log_project(project: String) -> Result<Value, String> {
    use std::time::Duration;
    let project = project.trim().to_string();
    if project.is_empty() {
        return Err("Chemin de projet vide".to_string());
    }
    let check = run_captured("git", &["-C", &project, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        return Ok(serde_json::json!({ "is_repo": false, "commits": [] }));
    }
    let out = run_captured(
        "git",
        &["-C", &project, "log", "-n", "20", "--format=%h|%an|%ad|%s", "--date=short"],
        Duration::from_secs(5),
    );
    let commits: Vec<Value> = out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(4, '|');
            let hash = parts.next().unwrap_or("").to_string();
            let author = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            serde_json::json!({ "hash": hash, "author": author, "date": date, "subject": subject })
        })
        .collect();
    Ok(serde_json::json!({ "is_repo": true, "commits": commits }))
}

/// Résultat de `git_create_snapshot` :
/// - `ok: true, sha` = snapshot créé (SHA d'un commit non-référencé via `git stash create -u`,
///   ou `HEAD` si le working tree était propre).
/// - `ok: false, reason` = "not_a_repo" | "git_missing" | "error".
#[derive(serde::Serialize)]
pub(crate) struct SnapshotResult {
    ok: bool,
    sha: String,
    reason: String,
}

/// Résultat de `git_restore_snapshot` : fichiers restaurés (modifiés) et
/// fichiers supprimés (créés par la tâche et absents du snapshot).
#[derive(serde::Serialize)]
pub(crate) struct RestoreResult {
    restored: Vec<String>,
    deleted: Vec<String>,
}

/// Crée un snapshot Git avant une tâche d'orchestration. `git stash create -u`
/// capture tracked + untracked dans un commit non-référencé (le working tree et
/// l'index ne sont **pas** modifiés). Si le working tree est propre, sha = HEAD.
/// Voir spec_orchestration_snapshots.md §3.1.
#[tauri::command]
pub fn git_create_snapshot(state: State<AppState>) -> Result<SnapshotResult, String> {
    use std::time::Duration;
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let check = run_captured("git", &["-C", &cwd, "rev-parse", "--is-inside-work-tree"], Duration::from_secs(3));
    if !check.trim().eq_ignore_ascii_case("true") {
        // Distinguer « pas un repo » de « git absent » : si rev-parse renvoie
        // vide (git manquant ou erreur), on l'indique aussi.
        let probe = run_captured("git", &["--version"], Duration::from_secs(2));
        let reason = if probe.trim().is_empty() { "git_missing" } else { "not_a_repo" };
        return Ok(SnapshotResult { ok: false, sha: String::new(), reason: reason.to_string() });
    }
    // `git stash create -u` : capture tracked + untracked dans un commit
    // non-référencé. stdout = SHA, ou vide si rien à stasher (working tree propre).
    let sha = run_captured("git", &["-C", &cwd, "stash", "create", "-u"], Duration::from_secs(8));
    let sha_trim = sha.trim().to_string();
    if !sha_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: sha_trim, reason: String::new() });
    }
    // Working tree propre par rapport à HEAD : snapshot = HEAD.
    let head = run_captured("git", &["-C", &cwd, "rev-parse", "HEAD"], Duration::from_secs(3));
    let head_trim = head.trim().to_string();
    if !head_trim.is_empty() {
        return Ok(SnapshotResult { ok: true, sha: head_trim, reason: String::new() });
    }
    // Cas extrême : pas de commit (repo vide sans HEAD). Pas de snapshot possible.
    Ok(SnapshotResult { ok: false, sha: String::new(), reason: "no_head".to_string() })
}

/// Restaure les fichiers modifiés par une tâche à leur état d'avant (snapshot).
/// Pour chaque fichier : si présent dans l'arbre du snapshot → `git checkout
/// <sha> -- <file>` (restaure le contenu pré-tâche) ; sinon → suppression du
/// disque (fichier créé par la tâche). Unstage final pour ne pas polluer l'index.
/// Voir spec_orchestration_snapshots.md §3.3.
#[tauri::command]
pub fn git_restore_snapshot(state: State<AppState>, sha: String, files: Vec<String>) -> Result<RestoreResult, String> {
    use std::time::Duration;
    if sha.trim().is_empty() {
        return Err("SHA de snapshot vide".to_string());
    }
    let project = state.project_path.lock().unwrap();
    let cwd = match project.as_ref() {
        Some(p) => p.clone(),
        None => return Err("Aucun projet ouvert".to_string()),
    };
    drop(project);
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    let mut to_unstage: Vec<String> = Vec::new();
    for rel in &files {
        let rel = rel.trim();
        if rel.is_empty() { continue; }
        // Le fichier existe-t-il dans l'arbre du snapshot ?
        let probe = run_captured("git", &["-C", &cwd, "ls-tree", "--full-name", &sha, "--", rel], Duration::from_secs(3));
        if !probe.trim().is_empty() {
            // Présent : restaurer le contenu pré-tâche.
            run_captured("git", &["-C", &cwd, "checkout", &sha, "--", rel], Duration::from_secs(8));
            restored.push(rel.to_string());
            to_unstage.push(rel.to_string());
        } else {
            // Absent du snapshot : créé par la tâche → supprimer du disque.
            let abs = std::path::Path::new(&cwd).join(rel);
            match fs::remove_file(&abs) {
                Ok(_) => { deleted.push(rel.to_string()); to_unstage.push(rel.to_string()); }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Déjà absent — rien à faire (peut-être supprimé manuellement).
                    to_unstage.push(rel.to_string());
                }
                Err(_) => { /* permission/autre — on ignore, non fatal */ }
            }
        }
    }
    // Unstage les fichiers restaurés/supprimés pour ne pas polluer l'index
    // (`git checkout <sha> -- <file>` stage la version restaurée).
    if !to_unstage.is_empty() {
        let mut args: Vec<&str> = vec!["-C", &cwd, "reset", "HEAD", "--"];
        let owned: Vec<String> = to_unstage.iter().map(|s| s.to_string()).collect();
        for r in &owned { args.push(r); }
        let _ = run_captured("git", &args, Duration::from_secs(5));
    }
    Ok(RestoreResult { restored, deleted })
}
