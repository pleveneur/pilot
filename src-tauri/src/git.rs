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

use tauri::State;

use crate::{run_captured, AppState};

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
