// interproject.rs — Discussion inter-projets (issue #15).
//
// Permet de « lier » des projets entre eux : un projet (source) peut déposer
// une analyse/tâche dans un projet lié (cible), qui est alors ouvert (si besoin),
// activé, son agent lancé, et à qui l'on demande de traiter le fichier déposé.
// Les liaisons sont persistées dans la config (AppConfig.project_links).

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

use crate::{rpc, AppState, do_set_active_project, open_project_shared, save_config_disk};

/// Issue #15 : liste les projets liés à `project` (chemins normalisés).
#[tauri::command]
pub fn get_project_links(state: State<AppState>, project: String) -> Vec<String> {
    let cfg = state.config.lock().unwrap();
    let mut links = cfg.project_links.get(&project).cloned().unwrap_or_default();
    links.sort();
    // Ne garder que des chemins qui existent réellement (liens orphelins).
    links.retain(|p| Path::new(p).exists());
    links
}

/// Issue #15 : définit la liste des projets liés à `project` (remplace la liste).
#[tauri::command]
pub fn set_project_links(
    state: State<AppState>,
    app: AppHandle,
    project: String,
    links: Vec<String>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.project_links.insert(project, links);
    save_config_disk(&app, &cfg)?;
    Ok(())
}

/// Issue #15 : retire `linked` des liaisons de `project` (sans remplacer la liste).
#[tauri::command]
pub fn remove_project_link(
    state: State<AppState>,
    app: AppHandle,
    project: String,
    linked: String,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    if let Some(list) = cfg.project_links.get_mut(&project) {
        list.retain(|p| p != &linked);
        if list.is_empty() {
            cfg.project_links.remove(&project);
        }
    }
    save_config_disk(&app, &cfg)?;
    Ok(())
}

/// Issue #15 : dépôt d'une tâche/analyse depuis `source` vers `target`.
///
/// 1. Écrit un fichier de handoff dans `target/.pilot/handoffs/` (nommé depuis
///    le projet source + horodatage), contenant l'analyse déposée.
/// 2. Garantit que `target` est ouvert et actif (l'ouvre s'il ne l'est pas).
/// 3. Lance (ou reprend) l'agent du projet cible.
/// 4. Envoie à cet agent un prompt lui demandant de lire et traiter le fichier.
///
/// Retourne le chemin du fichier de handoff et la cible, pour affichage UI.
#[tauri::command]
pub fn interproject_handoff(
    state: State<AppState>,
    app: AppHandle,
    source: String,
    target: String,
    content: String,
) -> Result<Value, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("Le contenu de la tâche/analyse est vide".to_string());
    }
    // Source et cible doivent être des dossiers existants.
    if !Path::new(&source).is_dir() {
        return Err(format!("Projet source introuvable : {}", source));
    }
    if !Path::new(&target).is_dir() {
        return Err(format!("Projet cible introuvable : {}", target));
    }
    if source == target {
        return Err("Le projet source et le projet cible sont identiques".to_string());
    }

    let source_name = Path::new(&source)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let target_name = Path::new(&target)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 1. Écrire le fichier de handoff dans la cible.
    let handoffs_dir = PathBuf::from(&target).join(".pilot").join("handoffs");
    std::fs::create_dir_all(&handoffs_dir).map_err(|e| {
        format!("Impossible de créer le dossier de handoff {} : {}", handoffs_dir.display(), e)
    })?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let safe_source = source_name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let filename = format!("from-{}-{}.md", safe_source, ts);
    let handoff_path = handoffs_dir.join(&filename);
    let handoff_body = format!(
        "# Tâche inter-projets\n\n- **Projet source** : `{}`\n- **Projet cible** : `{}`\n- **Déposé le** : `{}`\n\n## Analyse / instructions\n\n{}\n\n---\n\n> Dépôt créé par Pilot (discussion inter-projets). Traite le contenu ci-dessus.\n> Le projet source est accessible en **lecture seule** (`{}`) : tu peux lire son\n> code pour comprendre le contexte, mais tu ne dois **pas** le modifier.\n",
        source_name,
        target_name,
        ts,
        content,
        source
    );
    std::fs::write(&handoff_path, &handoff_body).map_err(|e| {
        format!("Impossible d'écrire le handoff {} : {}", handoff_path.display(), e)
    })?;
    let handoff_str = handoff_path.to_string_lossy().to_string();

    // 2. Garantir que la cible est ouverte et active.
    //    Avant de basculer, parker l'éventuelle session active du projet source
    //    (processus pi vivant en arrière-plan, conforme au multi-projets) pour ne
    //    pas bloquer le lancement de l'agent de la cible (« session déjà active »).
    let _ = rpc::do_park_agent_session(state.inner(), None);
    let registered = state.projects.lock().unwrap().contains_key(&target);
    if !registered {
        open_project_shared(&app, &target)?;
    } else {
        do_set_active_project(&state, &app, &target)?;
    }

    // 3. Lancer / reprendre l'agent de la cible (session active).
    rpc::do_start_agent_session(state.inner(), &app, None)?;

    // 4. Envoyer le prompt de traitement du handoff.
    let prompt = format!(
        "Un projet lié (`{}`) t'a déposé une tâche inter-projets. \n\nLIS et TRAITE le fichier suivant : `{}`. \n\nIl contient une analyse et des instructions venant du projet source `{}` (accessible en lecture seule — tu peux consulter son code pour le contexte, sans le modifier). \n\nCommence par lire le fichier de handoff, puis exécute ce qui est demandé.",
        source_name, handoff_str, source_name
    );
    rpc::do_send_agent_prompt(state.inner(), prompt, None)?;

    Ok(json!({
        "handoff_path": handoff_str,
        "target": target,
        "target_name": target_name,
        "source": source,
        "source_name": source_name,
    }))
}
