// gds_write_guard.rs — GARDE D'ÉCRITURE TENUE PAR LE SOCLE (mode réseau
// multi-postes, étape 5).
//
// ─────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME QUE CE MODULE FERME
// Jusqu'ici, un projet tenu par un autre poste n'était protégé que par
// l'ÉCRAN : le panneau du portage refusait le geste, mais les commandes qui
// écrivent vraiment (enregistrer un fichier, créer, supprimer, renommer,
// coller une image) et celles qui LANÇENT un agent ne consultaient rien. Un
// refus qui ne vit que dans l'affichage n'est pas une garde : il suffit d'un
// autre appel, d'un raccourci ou d'un agent pour écrire dans un projet qu'un
// autre poste est en train de modifier.
//
// Ce module place la vérification **dans le socle** : chaque geste qui écrit
// passe par `ensure_path_writable` / `ensure_project_writable` avant de toucher
// le disque ou de lancer un processus. La décision vient du SERVEUR (il est
// seul juge) ; le poste ne fait que la lire.
//
// ─────────────────────────────────────────────────────────────────────────────
// RÈGLE CARDINALE : JAMAIS DE BLOCAGE DU TRAVAIL LOCAL (fail-open réseau)
// Tout ce qui n'est pas une réponse EXPLICITE du serveur disant « un autre
// poste tient ce projet » laisse passer :
//   • GDS désactivé globalement (paramètre)               → laisse passer ;
//   • projet sans `.pilot/gds.json`, ou GDS non activé    → laisse passer ;
//   • aucun compte GDS enregistré / aucune identité       → laisse passer ;
//   • serveur injoignable, DNS en panne, délai (3 s)      → laisse passer ;
//   • projet LIBRE, ou tenu par CE poste                  → laisse passer ;
//   • prise en main d'un autre poste déjà EXPIRÉE          → laisse passer.
// Une panne réseau ne doit JAMAIS empêcher d'enregistrer son travail : c'est la
// règle la plus importante de l'étape. Un refus ne peut donc venir que d'un
// état lu sur le serveur (`Probe::Etat`), jamais d'une erreur.

use crate::gds_handover::{
    holder_expired, holder_poste_id, state_object, write_verdict, WriteVerdict,
};
use crate::AppState;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Décision de la garde : soit on écrit, soit on refuse avec la RAISON (phrase
/// lisible, affichée telle quelle à l'utilisateur).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum GuardDecision {
    Allow,
    Refuse(String),
}

impl GuardDecision {
    /// Résultat prêt à remonter d'une commande Tauri.
    pub(crate) fn into_result(self) -> Result<(), String> {
        match self {
            GuardDecision::Allow => Ok(()),
            GuardDecision::Refuse(message) => Err(message),
        }
    }
}

/// Résultat d'une vérification de portage. Deux formes seulement : un ÉTAT lu
/// sur le serveur, ou l'impossibilité de le lire (panne / délai dépassé).
#[derive(Debug, Clone)]
pub(crate) enum Probe {
    /// Le serveur a répondu : l'état du portage est dans la valeur.
    Etat(Value),
    /// Rien n'a pu être lu (injoignable, délai, erreur quelconque).
    Panne,
}

/// Durée maximale accordée à la vérification réseau. Au-delà, on considère
/// qu'on ne sait pas → on laisse passer (jamais un enregistrement gelé).
pub(crate) const GUARD_TIMEOUT: Duration = Duration::from_secs(3);

/// Durée de validité d'un verdict. Une frappe (Ctrl+S répété) ne paie pas un
/// appel réseau à chaque fois ; au-delà, on redemande au serveur.
pub(crate) const GUARD_TTL: Duration = Duration::from_secs(5);

/// Nombre maximal de projets mémorisés (borne mémoire : la garde ne grossit pas
/// indéfiniment quand on ouvre et ferme beaucoup de projets).
pub(crate) const GUARD_CACHE_MAX: usize = 32;

/// Verdicts récents, par projet. `Mutex` statique : la garde est consultée
/// depuis plusieurs commandes concurrentes (enregistrement, agents).
static GUARD_CACHE: Mutex<Vec<(String, Instant, GuardDecision)>> = Mutex::new(Vec::new());

// ─────────────────────────────────────────────────────────────────────────────
// 1. LA DÉCISION (pure) — testable sans réseau, sans disque, sans Tauri
// ─────────────────────────────────────────────────────────────────────────────

/// Traduit une vérification de portage en décision d'écriture. **PURE.**
///
/// C'est ici, et nulle part ailleurs, que se joue la règle : refuser TOUT de
/// suite si le serveur n'a rien dit (panne), et ne refuser que si un AUTRE poste
/// tient le projet avec une prise en main encore valide.
pub(crate) fn decide(probe: Probe, poste_id: &str) -> GuardDecision {
    let etat = match probe {
        // PANNE : on ne sait pas → on laisse passer. Doubler cette ligne en
        // `Refuse` bloquerait le travail local sur une coupure réseau.
        Probe::Panne => return GuardDecision::Allow,
        Probe::Etat(v) => v,
    };
    let state = state_object(&etat);
    // Tenue par un AUTRE poste, et sa prise en main n'est pas expirée.
    let autre_tient = match holder_poste_id(state) {
        Some(titulaire) => {
            !titulaire.trim().eq_ignore_ascii_case(poste_id.trim()) && !holder_expired(state)
        }
        None => false,
    };
    if !autre_tient {
        // Libre, tenu par soi, ou tenue d'un autre expirée : le travail local est
        // exactement celui d'aujourd'hui.
        return GuardDecision::Allow;
    }
    match write_verdict(&etat, poste_id) {
        // Le message vient du socle du portage : il nomme le poste porteur et la
        // fin de validité. Aucun second vocabulaire de refus n'est inventé.
        WriteVerdict::Refused(message) => GuardDecision::Refuse(message),
        WriteVerdict::Allowed => GuardDecision::Allow,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LE PROJET D'UN CHEMIN (pure) — la garde d'un geste fichier
// ─────────────────────────────────────────────────────────────────────────────

/// Projet ouvert dont dépend un chemin, le PLUS SPÉCIFIQUE (un sous-projet
/// l'emporte sur son parent). **PURE.**
///
/// Un chemin hors de tout projet ouvert n'est pas gardé : c'est un brouillon,
/// un export ou un fichier temporaire, il n'appartient à personne.
pub(crate) fn project_of_path(projects: &[String], path: &str) -> Option<String> {
    let cible = crate::normalize_project_path(path);
    if cible.is_empty() {
        return None;
    }
    let mut meilleur: Option<(usize, String)> = None;
    for projet in projects {
        let normalise = crate::normalize_project_path(projet);
        if normalise.is_empty() {
            continue;
        }
        let dedans = cible == normalise || cible.starts_with(&format!("{}/", normalise));
        if !dedans {
            continue;
        }
        let plus_specifique = meilleur
            .as_ref()
            .map(|(len, _)| normalise.len() > *len)
            .unwrap_or(true);
        if plus_specifique {
            meilleur = Some((normalise.len(), projet.clone()));
        }
    }
    meilleur.map(|(_, projet)| projet)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MÉMOIRE COURTE DES VERDICTS (pure + statique)
// ─────────────────────────────────────────────────────────────────────────────

fn cache_key(project: &str) -> String {
    crate::normalize_project_path(project)
}

/// Verdict encore valable pour ce projet ? **PURE** (le magasin est passé en
/// argument) : la règle de péremption se teste sans attendre.
pub(crate) fn cache_get<'a>(
    entries: &'a [(String, Instant, GuardDecision)],
    project: &str,
    now: Instant,
    ttl: Duration,
) -> Option<&'a GuardDecision> {
    let key = cache_key(project);
    entries
        .iter()
        .find(|(k, at, _)| {
            *k == key && now.saturating_duration_since(*at) < ttl
        })
        .map(|(_, _, decision)| decision)
}

/// Enregistre un verdict (remplace l'ancien pour ce projet, borne la taille).
/// **PURE** sur le magasin passé en argument.
pub(crate) fn cache_put(
    entries: &mut Vec<(String, Instant, GuardDecision)>,
    project: &str,
    decision: &GuardDecision,
    now: Instant,
) {
    let key = cache_key(project);
    entries.retain(|(k, _, _)| *k != key);
    entries.push((key, now, decision.clone()));
    while entries.len() > GUARD_CACHE_MAX {
        entries.remove(0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. LA GARDE (I/O) — appelée par les commandes qui écrivent
// ─────────────────────────────────────────────────────────────────────────────

/// Projets ouverts sur ce poste (liste persistée + projet actif), pour savoir à
/// quel projet appartient un chemin.
fn open_projects_of(state: &AppState) -> Vec<String> {
    let mut projets: Vec<String> = Vec::new();
    if let Ok(config) = state.config.lock() {
        projets.extend(config.open_projects.iter().cloned());
    }
    if let Ok(actif) = state.project_path.lock() {
        if let Some(chemin) = actif.as_ref() {
            let key = crate::normalize_project_path(chemin);
            if !projets
                .iter()
                .any(|p| crate::normalize_project_path(p) == key)
            {
                projets.push(chemin.clone());
            }
        }
    }
    projets
}

/// Lit l'état du portage sur le serveur, sans jamais laisser échouer l'appel.
async fn probe(project: &str) -> Probe {
    // `peek_write_gate` ouvre une session de LECTURE seule : il ne modifie rien
    // et ne prend jamais le projet en main (`claim = false`).
    match tokio::time::timeout(
        GUARD_TIMEOUT,
        crate::gds_handover::peek_write_gate(project),
    )
    .await
    {
        Ok(Ok(value)) => Probe::Etat(value),
        // Délai dépassé, serveur injoignable, compte absent, projet inconnu du
        // serveur : dans TOUS ces cas on ne sait pas, donc on laisse écrire.
        _ => Probe::Panne,
    }
}

/// Garde d'écriture d'un **geste fichier** : trouve le projet ouvert dont
/// dépend `path`, puis applique la garde de ce projet. Un chemin hors projet est
/// laissé passer.
pub(crate) async fn ensure_path_writable(state: &AppState, path: &str) -> Result<(), String> {
    match project_of_path(&open_projects_of(state), path) {
        Some(project) => ensure_project_writable(state, &project).await,
        None => Ok(()),
    }
}

/// Garde d'écriture d'un **projet** : refuse quand un autre poste le tient.
///
/// À appeler avant tout geste qui modifie le disque du projet ou qui lance un
/// agent pour ce projet. Ne renvoie `Err` QUE si le serveur a répondu qu'un
/// autre poste tient le projet (voir la règle cardinale en tête de fichier).
pub(crate) async fn ensure_project_writable(
    state: &AppState,
    project: &str,
) -> Result<(), String> {
    if project.trim().is_empty() {
        return Ok(());
    }
    // 1. GDS désactivé globalement : aucune garde, comportement d'aujourd'hui.
    if !crate::gds_globally_enabled(state) {
        return Ok(());
    }
    // 2. Projet non connecté au GDS, ou GDS non activé pour lui : rien à garder.
    match crate::gds::read_gds_config(project) {
        Ok(cfg) if cfg.enabled => {}
        _ => return Ok(()),
    }
    // 3. Identité de CE poste (elle sert à distinguer « tenu par moi »).
    let poste_id = match crate::gds::poste_id() {
        Ok(id) => id,
        Err(_) => return Ok(()),
    };
    // 4. Verdict récent : on ne redemande pas au serveur à chaque frappe.
    let connu = {
        let cache = GUARD_CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        cache_get(&cache, project, Instant::now(), GUARD_TTL).cloned()
    };
    if let Some(decision) = connu {
        return decision.into_result();
    }
    // 5. Vérification réseau bornée dans le temps, puis mémorisée.
    let decision = decide(probe(project).await, &poste_id);
    {
        let mut cache = GUARD_CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        cache_put(&mut cache, project, &decision, Instant::now());
    }
    decision.into_result()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Identifiant de CE poste dans les tests.
    const MOI: &str = "11111111-1111-1111-1111-111111111111";
    /// Identifiant d'un AUTRE poste.
    const AUTRE: &str = "22222222-2222-2222-2222-222222222222";

    /// État de portage : projet tenu par `titulaire`, prise en main valide.
    /// Forme réelle rendue par `peek_write_gate` (l'état du serveur est dans
    /// `state`, le porteur sous `state.holder`).
    fn tenu_par(titulaire: &str) -> Value {
        json!({
            "ok": true,
            "allowed": false,
            "claim_required": false,
            "poste_id": MOI,
            "message": "",
            "state": {
                "holder": { "poste_id": titulaire },
                "expires_at": "2099-01-01T00:00:00Z",
                "expired": false
            }
        })
    }

    /// État de portage : projet LIBRE (aucun porteur).
    fn libre() -> Value {
        json!({
            "ok": true,
            "allowed": false,
            "claim_required": true,
            "poste_id": MOI,
            "message": crate::gds_handover::CLAIM_REQUIRED_MESSAGE,
            "state": { "holder": null, "expired": false }
        })
    }

    // ── LES QUATRE SITUATIONS QUI DOIVENT TENIR ──────────────────────────────
    // (1) tenu par un AUTRE poste → REFUS, (2) tenu par SOI → accepté,
    // (3) LIBRE → accepté, (4) RÉSEAU MUET → accepté.

    #[test]
    fn situation_1_projet_tenu_par_un_autre_poste_est_refuse() {
        let decision = decide(Probe::Etat(tenu_par(AUTRE)), MOI);
        match decision {
            GuardDecision::Refuse(message) => {
                // Le refus DIT la raison : un autre poste tient le projet, et
                // jusqu'à quand. Le message est celui du socle du portage (une
                // seule source de vérité, aucun second vocabulaire inventé).
                assert!(
                    message.contains("autre poste"),
                    "le refus doit dire qu'un autre poste tient le projet, vu : {}",
                    message
                );
                assert!(
                    message.contains("2099-01-01"),
                    "le refus doit dire jusqu'à quand, vu : {}",
                    message
                );
            }
            GuardDecision::Allow => panic!(
                "MORSURE : le projet est tenu par un autre poste, l'écriture doit être refusée"
            ),
        }
    }

    #[test]
    fn situation_2_projet_tenu_par_ce_poste_est_accepte() {
        assert_eq!(decide(Probe::Etat(tenu_par(MOI)), MOI), GuardDecision::Allow);
        // Le serveur rend l'identifiant avec une casse ou des espaces différents :
        // c'est le MÊME poste, on n'y refuse jamais son propre travail.
        assert_eq!(
            decide(Probe::Etat(tenu_par(&format!(" {} ", MOI.to_uppercase()))), MOI),
            GuardDecision::Allow
        );
    }

    #[test]
    fn situation_3_projet_libre_est_accepte() {
        assert_eq!(decide(Probe::Etat(libre()), MOI), GuardDecision::Allow);
        // Aucun état de portage du tout (serveur antérieur) : rien ne s'oppose.
        assert_eq!(
            decide(Probe::Etat(json!({ "ok": true, "allowed": true })), MOI),
            GuardDecision::Allow
        );
        // Un état sans porteur nommé : pas un autre porteur, donc pas un refus.
        assert_eq!(
            decide(
                Probe::Etat(json!({ "ok": true, "state": { "holder": { "poste_id": "" } } })),
                MOI
            ),
            GuardDecision::Allow
        );
    }

    #[test]
    fn situation_4_reseau_muet_est_accepte_jamais_un_blocage() {
        // MORSURE : si cette ligne devenait `Refuse`, un serveur éteint, un DNS
        // en panne ou une coupure réseau empêcheraient d'enregistrer son travail.
        // Une panne ne doit jamais bloquer le travail local.
        assert_eq!(decide(Probe::Panne, MOI), GuardDecision::Allow);
    }

    #[test]
    fn prise_en_main_d_un_autre_poste_expiree_est_acceptee() {
        // Le serveur dit explicitement que la prise en main est expirée : le projet
        // n'est plus tenu, on n'empêche pas de travailler.
        let etat = json!({
            "ok": true,
            "state": {
                "holder": { "poste_id": AUTRE },
                "expires_at": "2020-01-01T00:00:00Z",
                "expired": true
            }
        });
        assert_eq!(decide(Probe::Etat(etat), MOI), GuardDecision::Allow);
    }

    #[test]
    fn refus_remonte_en_erreur_lisible_pas_en_plantage() {
        let erreur = decide(Probe::Etat(tenu_par(AUTRE)), MOI)
            .into_result()
            .expect_err("le refus doit remonter en Err");
        // La phrase est celle du socle du portage : elle dit « Écriture refusée ».
        assert!(
            erreur.starts_with("Écriture refusée"),
            "message de refus inattendu : {}",
            erreur
        );
    }

    // ── LE PROJET D'UN CHEMIN ────────────────────────────────────────────────

    #[test]
    fn chemin_sous_un_projet_ouvert_trouve_le_projet() {
        let projets = vec!["/g/pilot".to_string()];
        assert_eq!(
            project_of_path(&projets, "/g/pilot/src/js/main.js"),
            Some("/g/pilot".to_string())
        );
        // Le dossier du projet lui-même.
        assert_eq!(
            project_of_path(&projets, "/g/pilot"),
            Some("/g/pilot".to_string())
        );
    }

    #[test]
    fn chemin_hors_projet_n_est_pas_garde() {
        let projets = vec!["/g/pilot".to_string()];
        assert_eq!(project_of_path(&projets, "/g/ailleurs/notes.txt"), None);
        // Un dossier FRÈRE dont le nom commence pareil n'est pas dedans.
        assert_eq!(project_of_path(&projets, "/g/pilot-archive/x.txt"), None);
        assert_eq!(project_of_path(&[], "/g/pilot/x.txt"), None);
    }

    #[test]
    fn chemin_windows_et_separateurs_melanges() {
        let projets = vec!["G:\\IA_PL\\pilot".to_string()];
        assert_eq!(
            project_of_path(&projets, "G:/IA_PL/pilot/src/main.js"),
            Some("G:\\IA_PL\\pilot".to_string())
        );
    }

    #[test]
    fn sous_projet_le_plus_specifique_l_emporte() {
        let projets = vec!["/g/pilot".to_string(), "/g/pilot/web".to_string()];
        assert_eq!(
            project_of_path(&projets, "/g/pilot/web/js/app.js"),
            Some("/g/pilot/web".to_string())
        );
        assert_eq!(
            project_of_path(&projets, "/g/pilot/src/main.js"),
            Some("/g/pilot".to_string())
        );
    }

    // ── LA MÉMOIRE COURTE DES VERDICTS ───────────────────────────────────────

    #[test]
    fn un_verdict_est_reutilise_puis_oublie() {
        let t0 = Instant::now();
        let mut cache: Vec<(String, Instant, GuardDecision)> = Vec::new();
        cache_put(&mut cache, "/g/pilot", &GuardDecision::Refuse("tenu".into()), t0);
        assert!(cache_get(&cache, "/g/pilot", t0, GUARD_TTL).is_some());
        // Toujours valable juste avant la péremption (chemin normalisé identique).
        assert!(cache_get(&cache, "/g/pilot/", t0 + GUARD_TTL / 2, GUARD_TTL).is_some());
        // Périmé : on redemandera au serveur (le portage peut avoir changé).
        assert!(cache_get(&cache, "/g/pilot", t0 + GUARD_TTL, GUARD_TTL).is_none());
        assert!(cache_get(&cache, "/g/autre", t0, GUARD_TTL).is_none());
    }

    #[test]
    fn un_nouveau_verdict_remplace_l_ancien_et_la_memoire_est_bornee() {
        let t0 = Instant::now();
        let mut cache: Vec<(String, Instant, GuardDecision)> = Vec::new();
        cache_put(&mut cache, "/g/pilot", &GuardDecision::Refuse("tenu".into()), t0);
        cache_put(&mut cache, "/g/pilot", &GuardDecision::Allow, t0);
        assert_eq!(cache.len(), 1, "un seul verdict par projet");
        assert_eq!(
            cache_get(&cache, "/g/pilot", t0, GUARD_TTL),
            Some(&GuardDecision::Allow)
        );
        for i in 0..(GUARD_CACHE_MAX + 10) {
            cache_put(&mut cache, &format!("/g/p{}", i), &GuardDecision::Allow, t0);
        }
        assert_eq!(cache.len(), GUARD_CACHE_MAX, "mémoire bornée");
    }
}
