// plan.rs — Persistance du plan d'orchestration (.pilot/plan.json).
//
// Domaine extrait de `lib.rs` (2026-08) : sauvegarde / chargement / suppression
// du plan d'orchestration dans le projet courant.

use std::fs;

use tauri::State;

use crate::AppState;

// ── Persistance du plan d'orchestration ──

/// Sauvegarde le plan d'orchestration dans le projet
#[tauri::command]
pub fn save_plan(state: State<AppState>, plan_json: String) -> Result<(), String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_dir = std::path::PathBuf::from(&project).join(".pilot");
    fs::create_dir_all(&plan_dir)
        .map_err(|e| format!("Erreur création dossier .pilot : {}", e))?;

    let plan_path = plan_dir.join("plan.json");
    fs::write(&plan_path, &plan_json)
        .map_err(|e| format!("Erreur écriture plan : {}", e))?;

    Ok(())
}

/// Charge le plan d'orchestration du projet
#[tauri::command]
pub fn load_plan(state: State<AppState>) -> Result<String, String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_path = std::path::PathBuf::from(&project).join(".pilot").join("plan.json");
    if !plan_path.exists() {
        return Ok(String::new()); // Pas de plan existant
    }

    fs::read_to_string(&plan_path)
        .map_err(|e| format!("Erreur lecture plan : {}", e))
}

/// Supprime le plan d'orchestration du projet
#[tauri::command]
pub fn delete_plan(state: State<AppState>) -> Result<(), String> {
    let project_path = state.project_path.lock().unwrap();
    let project = project_path
        .as_ref()
        .ok_or("Aucun projet ouvert")?
        .clone();
    drop(project_path);

    let plan_path = std::path::PathBuf::from(&project).join(".pilot").join("plan.json");
    if plan_path.exists() {
        fs::remove_file(&plan_path)
            .map_err(|e| format!("Erreur suppression plan : {}", e))?;
    }

    Ok(())
}
