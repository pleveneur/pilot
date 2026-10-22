// interproject.rs — Discussion inter-projets (issue #15).
//
// Permet de « lier » des projets entre eux : un projet (source) peut déposer
// une analyse/tâche dans un projet lié (cible), qui est alors ouvert (si besoin),
// activé, son agent lancé, et à qui l'on demande de traiter le fichier déposé.
// Les liaisons sont persistées dans la config (AppConfig.project_links).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

use crate::anomaly::{self, AgentAnomalyState};
use crate::{rpc, AppState, do_set_active_project, normalize_project_path, open_project_shared, save_config_disk};

/// Données d'un transfert inter-projets, une fois validées par la commande.
/// Regroupées pour être passées au corps testable du transfert.
pub(crate) struct HandoffPlan<'a> {
    pub source: &'a str,
    pub source_name: &'a str,
    pub target: &'a str,
    pub target_name: &'a str,
    pub content: &'a str,
}

/// Décision d'ADMISSION du transfert inter-projets (porte du verrou par projet).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TransferAdmission {
    /// Le projet cible est libre : le transfert peut ouvrir/lancer son agent.
    Proceed,
    /// Un agent TRAVAILLE déjà sur le projet cible : tâche déposée, rien lancé.
    AlreadyWorking,
}

/// Décision PURE de la garde d'admission du transfert (aucun état Tauri) : le
/// projet cible a-t-il DÉJÀ un agent qui travaille réellement (busy non périmé) ?
///
/// Le chemin est testé brut PUIS normalisé : la clé d'anomalie reprend le chemin
/// tel que fourni au démarrage de la session, qui peut différer du chemin reçu
/// ici (séparateurs, slash final, casse sous Windows).
pub(crate) fn admit_transfer(
    map: &HashMap<String, AgentAnomalyState>,
    target: &str,
    grace_minutes: u32,
    now: Instant,
) -> TransferAdmission {
    let busy = anomaly::project_has_working_agent(map, target, grace_minutes, now)
        || anomaly::project_has_working_agent(map, &normalize_project_path(target), grace_minutes, now);
    if busy {
        TransferAdmission::AlreadyWorking
    } else {
        TransferAdmission::Proceed
    }
}

/// Écrit le fichier de handoff dans `<target>/.pilot/handoffs/` et retourne son
/// chemin. Nommé depuis le projet source + horodatage.
fn write_handoff(plan: &HandoffPlan, ts: u64) -> Result<String, String> {
    let handoffs_dir = PathBuf::from(plan.target).join(".pilot").join("handoffs");
    std::fs::create_dir_all(&handoffs_dir).map_err(|e| {
        format!("Impossible de créer le dossier de handoff {} : {}", handoffs_dir.display(), e)
    })?;
    let safe_source = plan
        .source_name
        .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let filename = format!("from-{}-{}.md", safe_source, ts);
    let handoff_path = handoffs_dir.join(&filename);
    let handoff_body = format!(
        "# Tâche inter-projets\n\n- **Projet source** : `{}`\n- **Projet cible** : `{}`\n- **Déposé le** : `{}`\n\n## Analyse / instructions\n\n{}\n\n---\n\n> Dépôt créé par Pilot (discussion inter-projets). Traite le contenu ci-dessus.\n> Le projet source est accessible en **lecture seule** (`{}`) : tu peux lire son\n> code pour comprendre le contexte, mais tu ne dois **pas** le modifier.\n",
        plan.source_name, plan.target_name, ts, plan.content, plan.source
    );
    std::fs::write(&handoff_path, &handoff_body).map_err(|e| {
        format!("Impossible d'écrire le handoff {} : {}", handoff_path.display(), e)
    })?;
    Ok(handoff_path.to_string_lossy().to_string())
}

/// Réponse du refus HONNÊTE : la tâche est déposée, mais AUCUNE exécution n'a
/// été lancée (l'utilisateur n'a pas de faux succès).
fn deferred_result(plan: &HandoffPlan, handoff_str: &str) -> Value {
    json!({
        "handoff_path": handoff_str,
        "target": plan.target,
        "target_name": plan.target_name,
        "source": plan.source,
        "source_name": plan.source_name,
        "deferred": true,
        "message": format!(
            "Tâche déposée dans « {} », mais AUCUNE exécution n'a été lancée : un agent y travaille déjà. Pour reprendre la tâche, demandez à l'agent du projet cible de lire le fichier déposé ({}) — ou relancez le dépôt une fois le projet libre.",
            plan.target_name, handoff_str
        ),
    })
}

/// Réponse du succès nominal (transfert effectivement lancé) : elle ne porte
/// JAMAIS `deferred`.
fn nominal_result(plan: &HandoffPlan, handoff_str: &str) -> Value {
    json!({
        "handoff_path": handoff_str,
        "target": plan.target,
        "target_name": plan.target_name,
        "source": plan.source,
        "source_name": plan.source_name,
    })
}

/// Corps du transfert inter-projets, découpé des effets Tauri pour être TESTABLE
/// sans construire `AppState`.
///
/// ORDRE STRICT (comportement verrouillé par les tests, mission 377) :
/// 1. le fichier de handoff est écrit — la tâche n'est jamais perdue ;
/// 2. l'admission est consultée (`admit`) APRÈS le dépôt ;
/// 3. en cas de refus, on retourne un refus HONNÊTE et `dispatch` (ouverture du
///    projet cible, démarrage de l'agent, envoi du prompt) n'est JAMAIS exécuté ;
/// 4. sinon `dispatch` est exécuté (une fois), puis on retourne le succès nominal.
///
/// Les deux effets (décision et lancement) sont injectés : la production passe
/// la carte d'anomalie et les appels RPC, les tests passent des compteurs.
pub(crate) fn transfer_handoff<A, D>(
    plan: &HandoffPlan,
    ts: u64,
    admit: A,
    dispatch: D,
) -> Result<Value, String>
where
    A: FnOnce(&str) -> TransferAdmission,
    D: FnOnce(&str) -> Result<(), String>,
{
    // 1. Déposer la tâche AVANT toute décision : un refus laisse la consigne.
    let handoff_str = write_handoff(plan, ts)?;

    // 2. Garde d'admission (porte) : tranche avant tout lancement.
    if admit(plan.target) == TransferAdmission::AlreadyWorking {
        return Ok(deferred_result(plan, &handoff_str));
    }

    // 3. Lancement effectif (ouverture de la cible, agent, prompt).
    dispatch(&handoff_str)?;

    Ok(nominal_result(plan, &handoff_str))
}

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
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let plan = HandoffPlan {
        source: &source,
        source_name: &source_name,
        target: &target,
        target_name: &target_name,
        content,
    };

    // Cœur du transfert (dépôt → garde → lancement), découpé pour être testable
    // sans état Tauri ; la décision d'admission est une fonction PURE et les
    // effets de lancement sont confinés dans la closure `dispatch`.
    transfer_handoff(
        &plan,
        ts,
        |target_cible| {
            // Garde du verrou par projet (porte inter-projets, mission « portes
            // du verrou ») : si le projet cible a DÉJÀ un agent qui travaille, on
            // ne lance PAS de seconde exécution et on n'écrase pas la mission en
            // cours. La décision est prise AVANT tout lancement.
            let m = state.agent_anomaly.lock().unwrap();
            let grace = crate::default_stale_busy_grace_minutes();
            let now = Instant::now();
            admit_transfer(&m, target_cible, grace, now)
        },
        |handoff_str| {
            // 2. Garantir que la cible est ouverte et active.
            //    Avant de basculer, parker l'éventuelle session active du projet
            //    source (processus pi vivant en arrière-plan, conforme au
            //    multi-projets) pour ne pas bloquer le lancement de l'agent de la
            //    cible (« session déjà active »).
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
            rpc::do_send_agent_prompt(state.inner(), prompt, None)
        },
    )
}

#[cfg(test)]
mod tests {
    //! Garde-fou de non-regression de la PORTE inter-projets (mission 377), par
    //! le COMPORTEMENT.
    //!
    //! Le transfert a ete decoupe en trois pieces (aucun changement de
    //! comportement, cf. `.pilot/rapports/rapport-tests-transfert-377.md`) :
    //! - `admit_transfer` : decision PURE (le projet cible a-t-il un agent qui
    //!   travaille ?), testable sans etat Tauri ;
    //! - `transfer_handoff` : enchainement depot du handoff -> garde ->
    //!   lancement, avec les effets INJECTES (closure `dispatch`) ;
    //! - `interproject_handoff` : la commande Tauri (validation des entrees,
    //!   `AppState`, appels RPC) — non instanciable en test unitaire.
    //!
    //! Ces tests n'examinent PAS le texte du source : ils executent la decision
    //! et l'enchainement REELS, avec de vrais dossiers temporaires et un
    //! compteur de lancements. Ils rougissent si la garde autorise toujours, si
    //! le refus perd son motif, si la tache n'est plus deposee en cas de refus,
    //! si le lancement est execute alors que le projet est occupe, ou si un
    //! agent fige bloque le transfert.

    use super::{admit_transfer, transfer_handoff, HandoffPlan, TransferAdmission};
    use crate::anomaly::AgentAnomalyState;
    use crate::normalize_project_path;
    use crate::test_util::TempDir;
    use serde_json::json;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::path::Path;
    use std::time::{Duration, Instant};

    /// Grace de production (`default_stale_busy_grace_minutes`).
    const GRACE: u32 = 25;

    /// Instant de reference NETTEMENT posterieur au demarrage du processus : les
    /// entrees d'anomalie simulees remontent dans le passe sans soustraction
    /// risquee sur `Instant`.
    fn reference_now() -> Instant {
        Instant::now() + Duration::from_secs(100_000)
    }

    /// Entree d'anomalie d'un agent du projet : `busy` depuis `idle_secs`.
    fn entry(idle_secs: u64, busy: bool, now: Instant) -> AgentAnomalyState {
        AgentAnomalyState {
            last_activity: now - Duration::from_secs(idle_secs),
            last_progress: now - Duration::from_secs(idle_secs),
            last_activity_wall: Some(std::time::SystemTime::now()),
            last_event: "agent_start".to_string(),
            busy,
            blocked_reported: false,
            auto_stopped_reported: false,
            awaiting_user: false,
            tool_in_progress: false,
            produced_output: false,
        }
    }

    /// Carte d'anomalie contenant UN agent, `busy` depuis `idle_secs`, sous la
    /// cle `cle` (chemin brut ou normalise, prefixe du separateur de cle).
    fn carte(cle: &str, idle_secs: u64, now: Instant) -> HashMap<String, AgentAnomalyState> {
        let mut map = HashMap::new();
        map.insert(format!("{}\u{1f}codeur", cle), entry(idle_secs, true, now));
        map
    }

    /// Banc d'essai reel : deux dossiers temporaires existants (source et
    /// cible), nettoyes automatiquement, et de quoi batir un `HandoffPlan`.
    struct Banc {
        _source_dir: TempDir,
        _target_dir: TempDir,
        source: String,
        target: String,
    }

    impl Banc {
        fn new(label: &str) -> Self {
            let source_dir = TempDir::new(&format!("{}-source", label));
            let target_dir = TempDir::new(&format!("{}-cible", label));
            let source = source_dir.str();
            let target = target_dir.str();
            Banc { _source_dir: source_dir, _target_dir: target_dir, source, target }
        }

        fn plan<'b>(&'b self, content: &'b str) -> HandoffPlan<'b> {
            HandoffPlan {
                source: &self.source,
                source_name: "source",
                target: &self.target,
                target_name: "cible",
                content,
            }
        }

        /// Dossier des handoffs de la cible.
        fn handoffs(&self) -> std::path::PathBuf {
            Path::new(&self.target).join(".pilot").join("handoffs")
        }

        /// Nombre de fichiers de handoff deja deposes.
        fn depots(&self) -> usize {
            std::fs::read_dir(self.handoffs()).map(|d| d.count()).unwrap_or(0)
        }
    }

    /// Cas principal : un projet cible OCCUPE par un agent qui travaille ne
    /// recoit AUCUNE execution. Le transfert est refuse, avec le bon motif, et
    /// la tache deposee n'est pas perdue.
    #[test]
    fn projet_cible_occupe_le_transfert_est_refuse_et_rien_n_est_lance() {
        let now = reference_now();
        let banc = Banc::new("ipj-occupe");
        // Cle d'anomalie = chemin normalise (comme au demarrage de session).
        let map = carte(&normalize_project_path(&banc.target), 0, now);
        let plan = banc.plan("analyse a traiter");

        let lancements = Cell::new(0u32);
        let res = transfer_handoff(
            &plan,
            42,
            |cible| admit_transfer(&map, cible, GRACE, now),
            |_handoff| {
                lancements.set(lancements.get() + 1);
                Ok(())
            },
        )
        .expect("un refus de transfert n'est pas une erreur");

        // 1. Le refus est HONNETE et porte le motif attendu.
        assert_eq!(
            res["deferred"],
            json!(true),
            "un projet occupe doit produire un transfert differe : {}",
            res
        );
        let message = res["message"].as_str().unwrap_or_default();
        assert!(
            message.contains("AUCUNE exécution n'a été lancée"),
            "le refus doit dire qu'aucune execution n'a ete lancee : {:?}",
            message
        );
        assert!(
            message.contains("un agent y travaille déjà"),
            "le refus doit enoncer le motif (projet occupe) : {:?}",
            message
        );

        // 2. AUCUNE execution : l'effet de lancement n'est jamais execute.
        assert_eq!(
            lancements.get(),
            0,
            "le transfert refuse ne doit PAS lancer d'agent sur le projet cible"
        );

        // 3. La tache n'est pas perdue : le fichier est reellement sur le disque.
        let chemin = res["handoff_path"].as_str().expect("chemin de handoff rendu");
        let corps = std::fs::read_to_string(chemin).expect("le handoff depose existe");
        assert!(
            corps.contains("analyse a traiter"),
            "le handoff depose contient la consigne : {}",
            corps
        );
    }

    /// Les DEUX formes du chemin du projet cible sont couvertes : la cle
    /// d'anomalie reprend le chemin tel que fourni au demarrage de session, qui
    /// peut differer du chemin recu ici (separateur final, casse sous Windows).
    /// Si une des deux formes cesse d'etre testee, le transfert n'est plus
    /// refuse et ce test rougit.
    #[test]
    fn la_garde_voit_le_projet_cible_sous_ses_deux_formes_de_chemin() {
        let now = reference_now();

        // Forme BRUTE : la cible est passee exactement telle qu'elle est clee.
        let brut = Banc::new("ipj-brut");
        let map_brut = carte(&brut.target, 0, now);
        assert_eq!(
            admit_transfer(&map_brut, &brut.target, GRACE, now),
            TransferAdmission::AlreadyWorking,
            "un agent occupe doit etre vu sur le chemin brut"
        );

        // Forme NORMALISEE : la cible arrive avec un separateur final, la cle
        // d'anomalie porte le chemin sans separateur final.
        let normalise = Banc::new("ipj-normalise");
        let cible_avec_separateur = format!("{}/", normalise.target);
        let map_normalise = carte(&normalize_project_path(&normalise.target), 0, now);
        assert_eq!(
            admit_transfer(&map_normalise, &cible_avec_separateur, GRACE, now),
            TransferAdmission::AlreadyWorking,
            "un agent occupe doit etre vu sur le chemin normalise"
        );

        // Bout en bout : la cible passee avec un separateur final est refusee.
        let mut plan_avec_separateur = normalise.plan("consigne");
        plan_avec_separateur.target = &cible_avec_separateur;
        let lancements = Cell::new(0u32);
        let res = transfer_handoff(
            &plan_avec_separateur,
            43,
            |cible| admit_transfer(&map_normalise, cible, GRACE, now),
            |_handoff| {
                lancements.set(lancements.get() + 1);
                Ok(())
            },
        )
        .expect("un refus de transfert n'est pas une erreur");
        assert_eq!(res["deferred"], json!(true), "cible occupee : transfert differe");
        assert_eq!(lancements.get(), 0, "aucun lancement sur un projet occupe");
    }

    /// Cas « busy perime » : un agent FIGE ne bloque pas le transfert, et la
    /// decision suit la grace configuree (meme carte, deux graces, deux
    /// decisions). Sans cela, une session morte bloquerait le projet pour
    /// toujours.
    #[test]
    fn un_agent_fige_ne_bloque_pas_le_transfert_et_la_grace_est_respectee() {
        let now = reference_now();
        let banc = Banc::new("ipj-fige");
        // Agent marque occupe, mais sans aucune activite depuis 30 minutes.
        let map = carte(&normalize_project_path(&banc.target), 30 * 60, now);

        // Grace de production (25 min) : l'entree est perimee → projet libre.
        assert_eq!(
            admit_transfer(&map, &banc.target, GRACE, now),
            TransferAdmission::Proceed,
            "un agent fige (busy perime) ne doit pas bloquer le transfert"
        );
        // Meme carte, grace genereuse (60 min) : le busy est encore frais → refus.
        assert_eq!(
            admit_transfer(&map, &banc.target, 60, now),
            TransferAdmission::AlreadyWorking,
            "la decision doit suivre la grace configuree"
        );

        // Bout en bout avec la grace de production : le transfert a bien lieu.
        let plan = banc.plan("consigne");
        let lancements = Cell::new(0u32);
        let res = transfer_handoff(
            &plan,
            44,
            |cible| admit_transfer(&map, cible, GRACE, now),
            |_handoff| {
                lancements.set(lancements.get() + 1);
                Ok(())
            },
        )
        .expect("transfert");
        assert_eq!(lancements.get(), 1, "un projet libre doit recevoir l'execution");
        assert!(
            res.get("deferred").is_none(),
            "un agent fige ne doit pas produire un transfert differe : {}",
            res
        );
    }

    /// La tache deposee ne se perd jamais : au moment EXACT ou la garde est
    /// consultee, le fichier de handoff est deja sur le disque. Si l'ecriture
    /// passe apres la garde, un refus perd la consigne et ce test rougit.
    #[test]
    fn la_tache_est_deposee_avant_la_garde_donc_jamais_perdue() {
        let banc = Banc::new("ipj-ordre");
        let plan = banc.plan("consigne a ne pas perdre");

        let depots_a_l_admission = Cell::new(usize::MAX);
        let res = transfer_handoff(
            &plan,
            45,
            |_cible| {
                depots_a_l_admission.set(banc.depots());
                TransferAdmission::AlreadyWorking
            },
            |_handoff| panic!("aucun lancement ne doit avoir lieu quand le projet est occupe"),
        )
        .expect("un refus de transfert n'est pas une erreur");

        assert_eq!(
            depots_a_l_admission.get(),
            1,
            "le handoff doit etre depose AVANT que la garde ne tranche"
        );
        assert_eq!(res["deferred"], json!(true));
        let chemin = res["handoff_path"].as_str().expect("chemin de handoff rendu");
        assert!(
            std::fs::read_to_string(chemin)
                .expect("le handoff survit au refus")
                .contains("consigne a ne pas perdre"),
            "la consigne reste sur place malgre le refus"
        );
    }

    /// Chemin nominal : projet cible LIBRE → une seule execution, sur le
    /// fichier de handoff reellement depose, et aucun `deferred` annonce.
    #[test]
    fn projet_cible_libre_le_transfert_lance_une_fois_et_ne_se_declare_pas_differe() {
        let now = reference_now();
        let banc = Banc::new("ipj-libre");
        let plan = banc.plan("consigne");
        let map: HashMap<String, AgentAnomalyState> = HashMap::new();

        let recus: RefCell<Vec<String>> = RefCell::new(Vec::new());
        let res = transfer_handoff(
            &plan,
            46,
            |cible| admit_transfer(&map, cible, GRACE, now),
            |handoff| {
                recus.borrow_mut().push(handoff.to_string());
                Ok(())
            },
        )
        .expect("le transfert nominal doit reussir");

        let recus = recus.into_inner();
        assert_eq!(recus.len(), 1, "le transfert nominal lance une execution, pas deux");
        assert_eq!(
            Some(recus[0].as_str()),
            res["handoff_path"].as_str(),
            "l'agent doit etre lance sur le fichier de handoff depose"
        );
        assert!(
            Path::new(&recus[0]).exists(),
            "le fichier de handoff transmis a l'agent existe"
        );
        assert!(
            res.get("deferred").is_none(),
            "un transfert lance ne doit pas se declarer differe : {}",
            res
        );
    }

    /// Un echec de lancement remonte tel quel : jamais un faux succes.
    #[test]
    fn une_erreur_de_lancement_remonte_au_lieu_d_un_faux_succes() {
        let now = reference_now();
        let banc = Banc::new("ipj-echec");
        let plan = banc.plan("consigne");
        let map: HashMap<String, AgentAnomalyState> = HashMap::new();

        let res = transfer_handoff(
            &plan,
            47,
            |cible| admit_transfer(&map, cible, GRACE, now),
            |_handoff| Err("session déjà active".to_string()),
        );

        assert_eq!(
            res,
            Err("session déjà active".to_string()),
            "un echec de lancement doit remonter, pas etre maquille en succes"
        );
    }
}
