// files.rs — Opérations fichiers pures (I/O), sans état applicatif.
//
// Domaine extrait de `lib.rs` (2026-08) : lecture/écriture de fichiers,
// métadonnées (encodage, EOL, mtime), existence, ouverture navigateur.
// Ces commandes ne dépendent ni de `AppState`, ni du watcher, ni d'un helper
// — elles sont purement fonctionnelles (path → résultat).

use std::fs;

/// Lit un fichier binaire (octets bruts).
#[tauri::command]
pub fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

/// Lit un fichier texte (UTF-8).
#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Erreur lecture: {}", e))
}

#[derive(serde::Serialize)]
pub struct FileInfo {
    encoding: String,
    eol: String,
}

/// Détecte l'encodage (BOM) et la fin de ligne (CRLF/LF) d'un fichier.
#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Erreur lecture: {}", e))?;

    // Détection de l'encodage (BOM)
    let encoding = if bytes.starts_with(b"\xef\xbb\xbf") {
        "UTF-8 BOM"
    } else if bytes.starts_with(b"\xff\xfe") {
        "UTF-16 LE"
    } else if bytes.starts_with(b"\xfe\xff") {
        "UTF-16 BE"
    } else {
        "UTF-8"
    };

    // Détection de la fin de ligne
    let mut crlf_count = 0usize;
    let mut lf_count = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                crlf_count += 1;
                i += 2;
                continue;
            }
        } else if bytes[i] == b'\n' {
            lf_count += 1;
        }
        i += 1;
    }

    let eol = if crlf_count == 0 && lf_count == 0 {
        "—" // Fichier binaire ou vide
    } else if crlf_count > lf_count {
        "CRLF"
    } else if lf_count > 0 {
        "LF"
    } else {
        "—"
    };

    Ok(FileInfo { encoding: encoding.to_string(), eol: eol.to_string() })
}

/// Écrit un fichier texte.
#[tauri::command]
pub fn write_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Erreur écriture: {}", e))
}

/// Écrit le fichier de handoff d'injection de contexte (`.pilot/context-inject.md`)
/// consommé par l'extension pi `pilot-context` (avant_agent_start → systemPrompt).
/// Crée le dossier `.pilot` s'il n'existe pas. Le contenu (contexte + mémoire projet)
/// est injecté dans le system prompt, hors de la discussion stockée (message user).
#[tauri::command]
pub fn write_context_handoff(project_path: String, content: String) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Ok(());
    }
    let dir = std::path::Path::new(&project_path).join(".pilot");
    fs::create_dir_all(&dir).map_err(|e| format!("Erreur création .pilot: {}", e))?;
    let file = dir.join("context-inject.md");
    fs::write(&file, &content).map_err(|e| format!("Erreur écriture handoff: {}", e))
}

/// Écrit un fichier binaire.
#[tauri::command]
pub fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| format!("Erreur écriture: {}", e))
}

/// Lit la liste des commandes du projet depuis `.pilot/commands.json` (#17).
/// Retourne un tableau JSON vide si le fichier n'existe pas encore.
#[tauri::command]
pub fn read_project_commands(project_path: String) -> Result<serde_json::Value, String> {
    let file = std::path::Path::new(&project_path)
        .join(".pilot")
        .join("commands.json");
    match std::fs::read_to_string(&file) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| format!("commandes projet invalides : {}", e)),
        Err(_) => Ok(serde_json::json!([])),
    }
}

/// Écrit la liste des commandes du projet dans `.pilot/commands.json` (#17),
/// en créant le dossier `.pilot` si nécessaire.
#[tauri::command]
pub fn save_project_commands(
    project_path: String,
    commands: serde_json::Value,
) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Ok(());
    }
    let dir = std::path::Path::new(&project_path).join(".pilot");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erreur création .pilot: {}", e))?;
    let file = dir.join("commands.json");
    let s = serde_json::to_string_pretty(&commands)
        .map_err(|e| format!("sérialisation commandes : {}", e))?;
    std::fs::write(&file, s).map_err(|e| format!("Erreur écriture commandes : {}", e))
}

/// Vérifie qu'un fichier existe.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Renvoie la taille d'un fichier en octets (0 si absent/illisible).
/// Utilisé par le Context Engine pour ignorer les gros fichiers (anti-gel).
#[tauri::command]
pub fn get_file_size(path: String) -> u64 {
    fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0)
}

/// Renvoie la date de dernière modification d'un fichier (mtime) en millisecondes
/// depuis l'epoch UNIX. Utilisé par le Mode Orchestration pour détecter qu'un
/// fichier a été créé/modifié par le codeur après une tâche.
#[tauri::command]
pub fn file_mtime(path: String) -> Result<f64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Erreur metadata: {}", e))?;
    let mtime = meta.modified().map_err(|e| format!("Erreur mtime: {}", e))?;
    let dur = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Erreur epoch: {}", e))?;
    Ok(dur.as_secs_f64() * 1000.0)
}

/// Ouvre une URL/un fichier dans le navigateur par défaut du système.
#[tauri::command]
pub fn open_in_browser(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Erreur ouverture navigateur: {}", e))
}
