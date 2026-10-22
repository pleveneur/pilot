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

use crate::{anomaly, rpc, AppState, do_set_active_project, normalize_project_path, open_project_shared, save_config_disk};
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

    // Garde du verrou par projet (porte inter-projets, mission « portes du
    // verrou ») : si le projet cible a DÉJÀ un agent qui travaille, on ne lance
    // PAS de seconde exécution et on n'écrase pas la mission en cours. Le
    // handoff est déposé (fichier déjà écrit, jamais perdu) et l'utilisateur
    // reçoit un message HONNÊTE (« déposé mais non lancé ») au lieu d'un faux
    // succès. Le chemin est testé brut et normalisé : la clé d'anomalie reprend
    // le chemin tel que fourni au démarrage de la session.
    let target_busy = {
        let m = state.agent_anomaly.lock().unwrap();
        let grace = crate::default_stale_busy_grace_minutes();
        let now = std::time::Instant::now();
        anomaly::project_has_working_agent(&m, &target, grace, now)
            || anomaly::project_has_working_agent(&m, &normalize_project_path(&target), grace, now)
    };
    if target_busy {
        return Ok(json!({
            "handoff_path": handoff_str,
            "target": target,
            "target_name": target_name,
            "source": source,
            "source_name": source_name,
            "deferred": true,
            "message": format!(
                "Tâche déposée dans « {} », mais AUCUNE exécution n'a été lancée : un agent y travaille déjà. Pour reprendre la tâche, demandez à l'agent du projet cible de lire le fichier déposé ({}) — ou relancez le dépôt une fois le projet libre.",
                target_name, handoff_str
            ),
        }));
    }

    // 2. Garantir que la cible est ouverte et active.
    //    Avant de basculer, parker l'éventuelle session active du projet source
    //    (processus pi vivant en arrière-plan, conforme au multi-projets) pour ne
    //    pas bloquer le lancement de l'agent de la cible (« session déjà active »).
    let _ = rpc::do_park_agent_session(state.inner(), None);
    let registered = state
        .projects
        .lock()
        .unwrap()
        .contains_key(&normalize_project_path(&target));
    if !registered {
        open_project_shared(&app, &target)?;
    } else {
        do_set_active_project(&state, &app, &target)?;
    }

    // 3. Lancer / reprendre l'agent de la cible (session active).
    rpc::do_start_agent_session(state.inner(), &app, None, None)?;

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

#[cfg(test)]
mod tests {
    //! Garde-fou de non-regression de la PORTE inter-projets (mission 377).
    //!
    //! La garde d'admission du transfert vit DANS la commande
    //! `interproject_handoff` : elle lit `State<AppState>` (un etat Tauri, non
    //! instanciable dans un test unitaire) et il est interdit de la deplacer.
    //! Ces tests verrouillent donc la structure EXACTE de la garde dans le
    //! source de production : si quelqu'un la retire, la deplace apres le
    //! lancement de l'agent, perd un de ses deux chemins (chemin brut + chemin
    //! normalise), transforme le refus en faux succes, ou ecrit le handoff
    //! apres la garde (tache perdue), ils rougissent.

    /// Source de PRODUCTION de ce fichier (module de tests retire), fins de
    /// ligne normalisees : un worktree CRLF (CI Windows) doit produire le meme
    /// texte qu'un worktree LF (quality-gate 3.4).
    fn production() -> String {
        let src = include_str!("interproject.rs").replace("\r\n", "\n");
        match src.rfind("#[cfg(test)]") {
            Some(cut) => src[..cut].to_string(),
            None => src,
        }
    }

    /// Position d'une ancre, avec un message explicite si elle a disparu.
    fn position(src: &str, anchor: &str) -> usize {
        src.find(anchor).unwrap_or_else(|| {
            panic!(
                "ancre de la garde introuvable (retiree ou deplacee ?) : {:?}",
                anchor
            )
        })
    }

    /// Cas principal : un projet cible OCCUPE par un agent qui travaille ne
    /// recoit aucune execution. La garde interroge l'occupation sur les deux
    /// chemins (brut puis normalise, comme la clef d'anomalie), refuse par un
    /// retour honnete `deferred` et, surtout, tranche AVANT de lancer l'agent.
    #[test]
    fn le_transfert_refuse_de_lancer_un_agent_quand_le_projet_cible_travaille() {
        let prod = production();

        // 1. La garde existe et couvre les DEUX chemins.
        assert_eq!(
            prod.matches("anomaly::project_has_working_agent(").count(),
            2,
            "la garde doit tester le chemin brut ET le chemin normalise"
        );
        position(
            &prod,
            "anomaly::project_has_working_agent(&m, &target, grace, now)",
        );
        position(
            &prod,
            "anomaly::project_has_working_agent(&m, &normalize_project_path(&target), grace, now)",
        );

        // 2. Le refus est honnete : tache deposee mais non lancee.
        position(&prod, "\"deferred\": true,");
        position(&prod, "AUCUNE exécution n'a été lancée");

        // 3. La garde est une PORTE : elle tranche avant le lancement.
        let garde = position(&prod, "let target_busy = {");
        assert!(
            garde < position(&prod, "rpc::do_start_agent_session("),
            "la garde doit passer AVANT le lancement de l'agent du projet cible"
        );
        assert!(
            garde < position(&prod, "rpc::do_send_agent_prompt("),
            "la garde doit passer AVANT l'envoi du prompt"
        );
        assert!(
            prod.contains("    if target_busy {\n"),
            "le refus doit rester porte par un branchement sur `target_busy`"
        );
    }

    /// Cas « busy perime » : un agent fige ne bloque pas le transfert. La garde
    /// lit la grace configuree et un instant de reference, comme les autres
    /// sondes de vivacite ; sans eux, une session morte bloquerait le projet
    /// pour toujours.
    #[test]
    fn le_refus_ignore_un_agent_fige_et_suit_la_grace_configuree() {
        let prod = production();
        position(&prod, "let grace = crate::default_stale_busy_grace_minutes();");
        position(&prod, "let now = std::time::Instant::now();");
    }

    /// La tache deposee ne se perd jamais : l'ecriture du fichier de handoff
    /// precede la garde, donc un refus laisse quand meme la consigne sur place.
    #[test]
    fn le_handoff_est_depose_avant_la_garde_pour_ne_jamais_perdre_la_tache() {
        let prod = production();
        let ecriture = position(&prod, "std::fs::write(&handoff_path, &handoff_body)");
        assert!(
            ecriture < position(&prod, "let target_busy = {"),
            "le fichier de handoff doit etre ecrit AVANT la garde (tache jamais perdue)"
        );
    }

    /// Le chemin nominal (projet cible libre) reste un succes franc : il ne doit
    /// pas se declarer « differe ».
    #[test]
    fn le_succes_nominal_ne_se_declare_pas_differe() {
        let prod = production();
        let refus = position(&prod, "\"deferred\": true,");
        let retour_nominal = prod.rfind("Ok(json!({").expect("retour nominal du transfert");
        assert!(refus < retour_nominal, "le refus precede le retour nominal");
        assert!(
            !prod[retour_nominal..].contains("deferred"),
            "le retour nominal ne doit pas annoncer un transfert differe"
        );
    }
}
