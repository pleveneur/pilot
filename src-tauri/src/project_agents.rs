// project_agents.rs — Config des onglets agents par projet (issue #35).
//
// Permet de définir un nombre d'agents (multi-onglets) et un nom pour chacun,
// persistés dans `.pilot/agents.json` à la racine du projet (versionné et
// partagé entre utilisateurs). Au démarrage du projet, les agents paramétrés
// sont rechargés (restauration gérée côté frontend dans `restoreTabs`).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Un agent configuré pour un projet (onglet agent avec son nom).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectAgent {
    pub id: String,
    pub name: String,
}

/// Structure de `.pilot/agents.json`.
#[derive(Serialize, Deserialize, Default)]
struct AgentsFile {
    agents: Vec<ProjectAgent>,
}

fn agents_path(project_path: &str) -> Result<PathBuf, String> {
    if project_path.is_empty() {
        return Err("Aucun projet ouvert".to_string());
    }
    Ok(PathBuf::from(project_path).join(".pilot").join("agents.json"))
}

/// Lit la config d'agents du projet (liste vide si fichier absent ou invalide).
#[tauri::command]
pub fn read_project_agents(project_path: String) -> Vec<ProjectAgent> {
    let path = match agents_path(&project_path) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<AgentsFile>(&raw)
            .map(|f| f.agents)
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Écrit la config d'agents du projet dans `.pilot/agents.json`.
#[tauri::command]
pub fn write_project_agents(project_path: String, agents: Vec<ProjectAgent>) -> Result<(), String> {
    let path = agents_path(&project_path)?;
    let dir = path.parent().unwrap_or(&path);
    fs::create_dir_all(dir).map_err(|e| format!("Erreur création dossier .pilot: {}", e))?;
    let data = serde_json::to_string_pretty(&AgentsFile { agents })
        .map_err(|e| format!("Erreur sérialisation: {}", e))?;
    fs::write(&path, data).map_err(|e| format!("Erreur écriture agents.json: {}", e))?;
    Ok(())
}
