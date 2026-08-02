// search.rs — Recherche globale et remplacement dans les fichiers (B3).
//
// Domaine extrait de `lib.rs` (2026-08) : `search_in_files` / `replace_in_files`
// parcourent l'arborescence du projet (mêmes dossiers/extensions ignorés que le
// watcher via `IGNORED_DIRS`) pour chercher/remplacer un motif (regex ou
// littéral). Dépend de `crate::AppState` (projet courant) et `crate::IGNORED_DIRS`.

use serde::Serialize;
use std::fs;

use tauri::State;

use crate::{AppState, IGNORED_DIRS};

// ── Recherche globale dans les fichiers ──

#[derive(Debug, Serialize, Clone)]
pub struct SearchResult {
    path: String,
    line: usize,
    col: usize,
    text: String,
}

#[tauri::command]
pub fn search_in_files(
    state: State<AppState>,
    query: String,
    use_regex: bool,
    extensions: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    // Compiler le pattern (regex ou texte littéral)
    let pattern: regex::Regex = if use_regex {
        regex::Regex::new(&query)
            .map_err(|e| format!("Regex invalide : {}", e))?
    } else {
        // Échapper les caractères spéciaux regex pour une recherche littérale
        let escaped = regex::escape(&query);
        regex::Regex::new(&escaped)
            .map_err(|e| format!("Erreur pattern : {}", e))?
    };

    // Filtre d'extensions
    let ext_filter: Vec<String> = if extensions.is_empty() {
        vec![]
    } else {
        extensions
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    };

    // Dossiers/fichiers à ignorer (source unique : IGNORED_DIRS, partagée avec
    // build_tree et le watcher pour rester cohérent).
    let ignore_dirs: &[&str] = IGNORED_DIRS;
    let ignore_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
        ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".woff", ".woff2",
        ".ttf", ".eot", ".mp3", ".mp4", ".avi", ".mov", ".exe", ".dll",
        ".so", ".dylib", ".o", ".obj", ".pyc", ".class", ".jar", ".wasm",
    ];

    let max = max_results.unwrap_or(500);
    let mut results = Vec::new();

    fn walk_dir(
        dir: &std::path::Path,
        pattern: &regex::Regex,
        ext_filter: &[String],
        ignore_dirs: &[&str],
        ignore_exts: &[&str],
        max: usize,
        results: &mut Vec<SearchResult>,
    ) -> Result<(), String> {
        if results.len() >= max {
            return Ok(());
        }
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Erreur lecture dossier {:?}: {}", dir, e))?;
        for entry in entries {
            if results.len() >= max {
                return Ok(());
            }
            let entry = entry.map_err(|e| format!("Erreur entrée : {}", e))?;
            let path = entry.path();

            // Ignorer les dossiers cachés et les dossiers listés
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.') || ignore_dirs.contains(&name_str.as_ref()) {
                continue;
            }

            if path.is_dir() {
                walk_dir(&path, pattern, ext_filter, ignore_dirs, ignore_exts, max, results)?;
            } else {
                // Filtre par extension
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let full_ext = format!(".{}", ext);

                // Ignorer les fichiers binaires
                if ignore_exts.contains(&full_ext.as_str()) {
                    continue;
                }

                // Filtre d'extensions si spécifié
                if !ext_filter.is_empty() && !ext_filter.contains(&ext) {
                    continue;
                }

                // Taille max : 2 Mo (ignorer les gros fichiers)
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > 2_000_000 {
                        continue;
                    }
                }

                // Lire et chercher
                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue, // Fichier binaire ou illisible
                };

                let path_str = path.to_string_lossy().to_string();
                for (line_num, line) in content.lines().enumerate() {
                    if results.len() >= max {
                        return Ok(());
                    }
                    for mat in pattern.find_iter(line) {
                        results.push(SearchResult {
                            path: path_str.clone(),
                            line: line_num + 1,
                            col: mat.start() + 1,
                            text: line.to_string(),
                        });
                    }
                }
            }
        }
        Ok(())
    }

    walk_dir(
        std::path::Path::new(&project),
        &pattern,
        &ext_filter,
        &ignore_dirs,
        &ignore_exts,
        max,
        &mut results,
    )?;

    Ok(results)
}

// ── Remplacement global dans les fichiers (B3 — Find & Replace) ──

#[derive(Debug, Serialize)]
pub struct ReplaceResult {
    /// Nombre de fichiers effectivement modifiés.
    files_modified: usize,
    /// Nombre total d'occurrences remplacées.
    occurrences: usize,
    /// Liste (chemin relatif) des fichiers modifiés, pour rafraîchir l'UI.
    modified: Vec<String>,
}

/// Remplace toutes les occurrences de `query` par `replacement` dans tous les
/// fichiers du projet correspondant au filtre d'extensions. Réutilise la
/// logique de parcours de `search_in_files` (mêmes dossiers/extensions
/// ignorés). Si `use_regex` est faux, le pattern et le remplacement sont
/// traités littéralement (échappés). Écrit seulement les fichiers dont le
/// contenu a changé. Retourne un compte pour confirmation côté UI.
#[tauri::command]
pub fn replace_in_files(
    state: State<AppState>,
    query: String,
    replacement: String,
    use_regex: bool,
    extensions: String,
) -> Result<ReplaceResult, String> {
    if query.is_empty() {
        return Ok(ReplaceResult {
            files_modified: 0,
            occurrences: 0,
            modified: Vec::new(),
        });
    }

    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    // Compiler le pattern (regex ou texte littéral)
    let pattern: regex::Regex = if use_regex {
        regex::Regex::new(&query).map_err(|e| format!("Regex invalide : {}", e))?
    } else {
        regex::Regex::new(&regex::escape(&query)).map_err(|e| format!("Erreur pattern : {}", e))?
    };

    // Replacer : littéral si pas regex (NoExpand ne traite pas les `$`),
    // sinon chaîne interprétée (supporte $1, ${name}). Construit localement
    // dans walk_replace pour éviter les soucis de lifetime de NoExpand.

    // Filtre d'extensions
    let ext_filter: Vec<String> = if extensions.is_empty() {
        vec![]
    } else {
        extensions
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    };

    let ignore_dirs: &[&str] = IGNORED_DIRS;
    let ignore_exts = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
        ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".woff", ".woff2",
        ".ttf", ".eot", ".mp3", ".mp4", ".avi", ".mov", ".exe", ".dll",
        ".so", ".dylib", ".o", ".obj", ".pyc", ".class", ".jar", ".wasm",
    ];

    let mut files_modified = 0usize;
    let mut occurrences = 0usize;
    let mut modified: Vec<String> = Vec::new();

    fn walk_replace(
        dir: &std::path::Path,
        project: &std::path::Path,
        pattern: &regex::Regex,
        replacement: &str,
        use_regex: bool,
        ext_filter: &[String],
        ignore_dirs: &[&str],
        ignore_exts: &[&str],
        files_modified: &mut usize,
        occurrences: &mut usize,
        modified: &mut Vec<String>,
    ) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| format!("Erreur lecture dossier {:?}: {}", dir, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Erreur entrée : {}", e))?;
            let path = entry.path();

            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.') || ignore_dirs.contains(&name_str.as_ref()) {
                continue;
            }

            if path.is_dir() {
                walk_replace(
                    &path, project, pattern, replacement, use_regex,
                    ext_filter, ignore_dirs, ignore_exts,
                    files_modified, occurrences, modified,
                )?;
            } else {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let full_ext = format!(".{}", ext);

                if ignore_exts.contains(&full_ext.as_str()) {
                    continue;
                }
                if !ext_filter.is_empty() && !ext_filter.contains(&ext) {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > 2_000_000 {
                        continue;
                    }
                }

                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue, // Binaire / illisible
                };

                let count = pattern.find_iter(&content).count();
                if count == 0 {
                    continue;
                }

                let new_content = if use_regex {
                    pattern.replace_all(&content, replacement).to_string()
                } else {
                    pattern.replace_all(&content, regex::NoExpand(replacement)).to_string()
                };

                if new_content == content {
                    continue; // Rien n'a réellement changé
                }

                fs::write(&path, &new_content)
                    .map_err(|e| format!("Erreur écriture {:?}: {}", path, e))?;
                let rel = path
                    .strip_prefix(project)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                modified.push(rel);
                *files_modified += 1;
                *occurrences += count;
            }
        }
        Ok(())
    }

    walk_replace(
        std::path::Path::new(&project),
        std::path::Path::new(&project),
        &pattern,
        &replacement,
        use_regex,
        &ext_filter,
        ignore_dirs,
        &ignore_exts,
        &mut files_modified,
        &mut occurrences,
        &mut modified,
    )?;

    Ok(ReplaceResult {
        files_modified,
        occurrences,
        modified,
    })
}
