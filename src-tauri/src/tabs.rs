// tabs.rs — Persistance des onglets (sessions d'édition par projet).
//
// Domaine extrait de `lib.rs` (2026-08) : sauvegarde / restauration de l'état
// des onglets d'un projet dans le répertoire de données de l'app.

use std::fs;
use std::hash::{Hash, Hasher};

use tauri::{AppHandle, Manager};

// ── Persistance des onglets ──

fn session_filename(project_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project_path.hash(&mut hasher);
    format!("{:016x}.json", hasher.finish())
}

#[tauri::command]
pub fn save_tab_session(app: AppHandle, project_path: String, data: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin config: {}", e))?;
    let sessions_dir = dir.join("sessions");
    fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("Erreur création dossier sessions: {}", e))?;
    let path = sessions_dir.join(session_filename(&project_path));
    fs::write(&path, data).map_err(|e| format!("Erreur écriture session: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_tab_session(app: AppHandle, project_path: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erreur chemin config: {}", e))?;
    let path = dir.join("sessions").join(session_filename(&project_path));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Erreur lecture session: {}", e))
}
