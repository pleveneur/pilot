// discussion_seule.rs — CASE « Discussion seulement via llama » (conception
// docs/conceptions/CONCEPTION-personnage-discussion-seule-via-llama.md).
//
// CE MODULE EST LA SOURCE UNIQUE DES DÉCISIONS ET DES PHRASES de ce mode. Il est
// PUR : aucune entrée/sortie, aucun accès à la configuration, aucun état. Le
// disque (la fiche du personnage) est lu par `persona_fiche.rs`, l'assemblage du
// prompt par `super_agent.rs`, l'écran par `src/js/settings.js` et
// `src/js/super-agent.js`, qui IMPORTENT ces décisions au lieu de les recopier.
//
// CE QUE LE MODE FAIT (et ce qu'il ne fait pas) :
//   - la case est PROPRE À CHAQUE PERSONNAGE (clé = son nom) et gardée dans la
//     configuration (`character_conversation_only`, champ ADDITIF) ;
//   - case DÉCOCHÉE (le cas normal) : rien ne change, au mot près — aucune des
//     présentes phrases n'est utilisée, le prompt de l'assistant est assemblé
//     exactement comme avant ;
//   - case COCHÉE : le personnage parle UNIQUEMENT avec son modèle local, ne
//     lance aucun agent, ne touche à aucun projet, n'a AUCUN outil de travail
//     (la session ne charge que l'outil d'écriture de sa propre fiche) ;
//   - son identité vient SEULEMENT de sa fiche (Présences) : aucune phrase de
//     rôle n'est écrite ici ;
//   - REFUS NET si le moteur local ne répond pas : le message est gardé, aucune
//     bascule silencieuse vers le moteur habituel.

use std::collections::HashMap;

use crate::persona_fiche::FicheEtat;

/// Clé de configuration du mode (objet nom du personnage → `true`). Champ
/// ADDITIF : une configuration ancienne ne la porte pas, la carte est vide, donc
/// aucun personnage n'est en discussion seule (comportement d'avant, à l'octet).
pub const CONVERSATION_ONLY_KEY: &str = "character_conversation_only";

/// La pastille de l'en-tête de l'onglet Assistant. Texte EXACT de la conception.
pub const BADGE_LABEL: &str = "Discussion seule";

/// Refus (mode écrit) : le moteur local n'a pas répondu. Phrase EXACTE de la
/// conception (§2.2). Le message de l'utilisateur est GARDÉ : aucune bascule.
pub const REFUSAL_TEXT: &str = "Le modèle local de llama n'a pas répondu ; ton message est gardé : réessaie dans un instant, ou décoche « Discussion seulement via llama » pour revenir au moteur habituel.";

/// Refus (mode Vocal) : la même chose, plus court (§2.2, variante orale).
pub const REFUSAL_VOCAL: &str = "Le modèle local n'a pas répondu ; ton message est gardé. Réessaie, ou décoche la discussion seule.";

/// Refus AVANT envoi quand le personnage n'a AUCUN modèle local réglé.
///
/// La conception interdit formellement de basculer en douce sur le moteur
/// habituel (§2.2). Or la chaîne de modèles de Pilot retombe, elle, sur le
/// modèle réglé pour l'assistant puis sur le défaut global quand la fiche ne
/// porte pas de modèle : sans cette phrase, la case cochée aurait parlé avec le
/// moteur habituel SANS le dire. Cette phrase-ci est donc la seule addition
/// textuelle du lot, et elle est NOMMÉE dans le rapport de mission.
pub const NO_LOCAL_MODEL_SENTENCE: &str = "Aucun modèle local n'est réglé pour ce personnage : renseigne son modèle (Options → Assistant → « Modèle du personnage »), puis réessaie. Rien n'est parti vers un autre moteur.";

/// Réponse renvoyée au modèle quand il appelle un outil de travail. Elle n'est
/// pas montrée à l'utilisateur : elle APPREND au personnage qu'il ne travaille
/// pas dans ce mode (aucun agent lancé, aucun fichier touché). Servie à
/// l'extension par la commande d'état : une seule rédaction, jamais recopiée.
pub const WORK_TOOL_REFUSAL: &str = "Discussion seule : cet outil n'est pas disponible ici. Je ne fais que parler — aucun agent n'a été lancé, aucun fichier n'a été touché.";

/// Ligne d'état après 3 s d'attente (§2.4), dans l'onglet comme sur la ligne
/// d'état de l'écran Vocal.
pub const WAITING_LINE: &str = "J'attends le modèle local…";
/// Délai avant d'afficher la ligne d'attente.
pub const WAITING_NOTICE_MS: u64 = 3_000;
/// Délai au-delà duquel on conclut au refus (le message reste dans la barre).
pub const WAITING_TIMEOUT_MS: u64 = 60_000;

/// Ligne grise affichée UNE SEULE FOIS quand le personnage actif change en
/// cours de session (§3.4). Elle nomme le personnage et rien d'autre ; le fil
/// de discussion est conservé. Rendue vide quand aucun personnage n'est actif.
pub fn persona_switch_line(persona: &str) -> String {
    let nom = persona.trim();
    if nom.is_empty() {
        return String::new();
    }
    format!("Personnage actif : {}.", nom)
}

/// Ligne grise du PERSONNAGE DÉSACTIVÉ en cours de discussion (§1.5) : le
/// message suivant repart en fonctionnement habituel, le fil est conservé, et
/// cette phrase le dit UNE fois.
pub const PERSONA_DISABLED_LINE: &str =
    "Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel.";

/// Ligne grise quand la réponse était EN COURS et que le local s'est arrêté
/// (§2.3, dernière ligne) : la réponse déjà reçue est gardée telle quelle,
/// aucune excuse inventée, aucune reprise automatique.
pub const PARTIAL_STOP_LINE: &str =
    "La réponse s'est arrêtée : le modèle local n'a plus répondu.";

/// Nom de l'outil d'écriture de la fiche (le seul outil du mode).
pub const FICHE_TOOL_NAME: &str = "ecrire_ma_fiche";

/// Sentinelle machine portée par l'outil d'écriture (`ctx.ui.input`). Le front
/// l'intercepte et exécute l'écriture via Rust, jamais le modèle.
pub const FICHE_SENTINEL: &str = "PILOT_PERSONA_FICHE::";

/// Valeur de la clé qui vaut `true` (actif). Une entrée absente ou `false` est
/// la même chose : le mode n'est pas actif.
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// LE MODE EST-IL ACTIF POUR CE PERSONNAGE ? Fonction PURE, seule autorité.
///
/// Trois conditions, dans cet ordre :
///   1. la carte de configuration est vide ou ne nomme pas ce personnage → non ;
///   2. aucun personnage actif (`persona_name` vide) → non : la case n'existe
///      même pas à l'écran sans personnage, et une valeur restée en configuration
///      ne peut donc pas s'appliquer à l'assistant nu ;
///   3. sinon la valeur du personnage décide (`true` = actif, tout le reste non).
pub fn is_active(map: &HashMap<String, bool>, persona_name: Option<&str>) -> bool {
    let Some(name) = persona_name.map(normalize_name).filter(|n| !n.is_empty()) else {
        return false;
    };
    map.iter()
        .find(|(k, _)| normalize_name(k) == name)
        .map(|(_, v)| *v)
        .unwrap_or(false)
}

/// Écrit l'état du mode pour UN personnage. Une désactivation SUPPRIME l'entrée
/// au lieu d'écrire `false` : la configuration reste celle d'avant pour tout
/// personnage qui n'a jamais coché la case.
pub fn set_state(map: &mut HashMap<String, bool>, name: &str, active: bool) {
    let nom = name.trim();
    if nom.is_empty() {
        return;
    }
    // Une éventuelle entrée de même nom à la casse différente est retirée : une
    // seule entrée par personnage, jamais deux qui se contrediraient.
    let cible = normalize_name(nom);
    map.retain(|k, _| normalize_name(k) != cible);
    if active {
        map.insert(nom.to_string(), true);
    }
}

/// Personnages actifs de la carte (nom, dans l'ordre alphabétique) — utile pour
/// les diagnostics et les tests, jamais pour décider.
pub fn active_names(map: &HashMap<String, bool>) -> Vec<String> {
    let mut noms: Vec<String> = map
        .iter()
        .filter(|(_, v)| **v)
        .map(|(k, _)| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .collect();
    noms.sort();
    noms
}

/// Le CADRE du mode : ce que le personnage doit savoir de sa situation.
///
/// Ce texte ne décrit AUCUN personnage : il ne dit ni ce qu'il est, ni son ton,
/// ni comment il appelle le propriétaire (cela vient de la fiche, et de là
/// seulement). Il ne fait que poser la situation : tu parles, tu ne travailles
/// pas, tu n'as qu'un droit d'écriture, le tien, et ta réflexion ne se montre
/// jamais.
pub fn cadre() -> String {
    [
        "## Ta situation en ce moment".to_string(),
        "Tu es en conversation seule avec le propriétaire : tu parles, tu ne travailles pas. Tu ne lances aucun agent, tu n'ouvres aucun projet, tu ne lances aucune commande et tu ne modifies aucun fichier des projets — cet outil-là ne t'est pas donné, et il n'y a rien à contourner : ce que tu as à dire, tu le dis.".to_string(),
        "Réponds avec tes propres mots, en conversation, comme à l'oral : des phrases suivies, sans liste, sans tableau, sans bout de code. Va à l'essentiel ; si le propriétaire demande des détails, développe autant qu'il faut.".to_string(),
        "Tu ne montres JAMAIS ta réflexion, ton raisonnement interne ni la façon dont tu arrives à ta réponse : seul le texte destiné au propriétaire apparaît, à l'écrit comme à l'oral. Ne recopie pas ta réflexion, ne la cite pas, ne la résume pas : elle ne se montre nulle part.".to_string(),
        "## Ton seul droit d'écriture : ta propre fiche".to_string(),
        only_tool_sentence(FICHE_TOOL_NAME),
        "Quand le propriétaire te dit de retenir, de noter ou de changer quelque chose sur toi (ce que tu es, ton ton, comment tu l'appelles, ce que tu fais, ce que tu ne fais jamais), écris-le avec cet outil en donnant la valeur VOULUE des champs concernés — pas un commentaire, pas une phrase de ta réflexion, la valeur elle-même.".to_string(),
        "Si l'outil répond que le passage appartient au propriétaire, tu ne l'écrases pas : tu le lui dis et tu lui demandes s'il veut que tu le changes. À l'oral, tu ne poses aucune question : tu laisses le passage tel quel et tu le dis en une phrase.".to_string(),
        "Si l'outil répond qu'il n'y a pas de fiche, tu ne la crées pas : tu continues de parler normalement, et tu le dis si la question se pose.".to_string(),
    ]
    .join("\n\n")
}

/// La phrase qui présente l'unique outil du mode. Le nom de l'outil n'est écrit
/// qu'à UN endroit (`FICHE_TOOL_NAME`) et passé ici.
pub fn only_tool_sentence(tool: &str) -> String {
    format!("Tu disposes d'un seul outil, `{}`. Il écrit dans TA fiche, pour les passages que TU as écrits, et rien d'autre : ni le carnet, ni le palier de relation, ni la description visuelle, ni les réglages de Pilot, ni aucun fichier d'un projet.", tool)
}

/// L'IDENTITÉ telle qu'elle s'écrit dans le prompt de ce mode : les passages de
/// la fiche, dans l'ordre de la fiche, et RIEN d'autre. Aucune phrase de rôle.
pub fn identity_block(fiche: &FicheEtat) -> String {
    fiche.prompt_block()
}

/// LE MESSAGE COMPLET envoyé au moteur dans ce mode : l'identité de la fiche,
/// le cadre, puis la demande de l'utilisateur MOT POUR MOT (aucune troncature,
/// aucune consigne de style ajoutée par-dessus).
pub fn build_message(fiche: &FicheEtat, message: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let identite = identity_block(fiche);
    if !identite.trim().is_empty() {
        parts.push(identite);
    }
    parts.push(cadre());
    let mut texte = parts.join("\n\n");
    texte.push_str("\n\n");
    texte.push_str(message);
    texte
}

/// La phrase de refus à afficher (et à dire) : version courte à l'oral.
pub fn refusal_sentence(vocal: bool) -> &'static str {
    if vocal {
        REFUSAL_VOCAL
    } else {
        REFUSAL_TEXT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les trois lignes grises du mode sont écrites ICI et NULLE PART ailleurs :
    /// la fenêtre ne fait que choisir laquelle est encore due. Chacune dit un
    /// fait, une fois.
    #[test]
    fn les_lignes_grises_sont_ecrites_dans_le_socle() {
        assert_eq!(
            PERSONA_DISABLED_LINE,
            "Le personnage a été désactivé : l'assistant reprend son fonctionnement habituel."
        );
        assert_eq!(
            PARTIAL_STOP_LINE,
            "La réponse s'est arrêtée : le modèle local n'a plus répondu."
        );
        assert_eq!(persona_switch_line("Nova"), "Personnage actif : Nova.");
        // Sans personnage, aucune ligne : rien à annoncer.
        assert_eq!(persona_switch_line(""), "");
        assert_eq!(persona_switch_line("   "), "");
    }

    fn carte(paires: &[(&str, bool)]) -> HashMap<String, bool> {
        paires.iter().map(|(n, v)| (n.to_string(), *v)).collect()
    }

    // ── La décision d'activation ────────────────────────────────────────────
    #[test]
    fn sans_personnage_le_mode_n_est_jamais_actif() {
        let map = carte(&[("Sylvie", true)]);
        assert!(!is_active(&map, None));
        assert!(!is_active(&map, Some("")));
        assert!(!is_active(&map, Some("   ")));
    }

    #[test]
    fn la_case_est_propre_a_chaque_personnage() {
        let map = carte(&[("Sylvie", true), ("Nova", false)]);
        assert!(is_active(&map, Some("Sylvie")));
        assert!(!is_active(&map, Some("Nova")));
        assert!(!is_active(&map, Some("Inconnu")));
    }

    #[test]
    fn une_carte_vide_est_le_defaut_inchange() {
        let map = HashMap::new();
        assert!(!is_active(&map, Some("Sylvie")));
        assert!(active_names(&map).is_empty());
    }

    #[test]
    fn le_nom_est_compare_sans_casse_ni_espaces() {
        let map = carte(&[("  sylvie ", true)]);
        assert!(is_active(&map, Some("Sylvie")));
        assert!(is_active(&map, Some("SYLVIE")));
    }

    #[test]
    fn desactiver_supprime_l_entree_et_une_seule_est_gardee() {
        let mut map = carte(&[("Sylvie", true)]);
        set_state(&mut map, "Sylvie", false);
        assert!(map.is_empty(), "désactiver n'écrit pas false : elle retire l'entrée");
        set_state(&mut map, "Sylvie", true);
        set_state(&mut map, "SYLVIE", true);
        assert_eq!(map.len(), 1, "un seul enregistrement par personnage");
        assert!(is_active(&map, Some("Sylvie")));
    }

    #[test]
    fn un_nom_vide_n_ecrit_rien() {
        let mut map = HashMap::new();
        set_state(&mut map, "   ", true);
        assert!(map.is_empty());
    }

    #[test]
    fn active_names_est_trie_et_ignore_les_inactifs() {
        let map = carte(&[("Sylvie", true), ("Nova", true), ("Autre", false)]);
        assert_eq!(active_names(&map), vec!["Nova".to_string(), "Sylvie".to_string()]);
    }

    // ── Les phrases (le texte de la conception, au mot près) ────────────────
    #[test]
    fn les_phrases_sont_celles_de_la_conception() {
        assert_eq!(
            REFUSAL_TEXT,
            "Le modèle local de llama n'a pas répondu ; ton message est gardé : réessaie dans un instant, ou décoche « Discussion seulement via llama » pour revenir au moteur habituel."
        );
        assert_eq!(
            REFUSAL_VOCAL,
            "Le modèle local n'a pas répondu ; ton message est gardé. Réessaie, ou décoche la discussion seule."
        );
        assert_eq!(BADGE_LABEL, "Discussion seule");
        assert_eq!(WAITING_LINE, "J'attends le modèle local…");
        assert_eq!(refusal_sentence(false), REFUSAL_TEXT);
        assert_eq!(refusal_sentence(true), REFUSAL_VOCAL);
    }

    #[test]
    fn les_delais_sont_ceux_de_la_conception() {
        assert_eq!(WAITING_NOTICE_MS, 3_000);
        assert_eq!(WAITING_TIMEOUT_MS, 60_000);
    }

    // ── Le cadre : la situation, jamais un personnage ───────────────────────
    #[test]
    fn le_cadre_ne_decrit_aucun_personnage() {
        let texte = cadre();
        // Le cadre parle de la SITUATION…
        assert!(texte.contains("conversation seule"));
        assert!(texte.contains(FICHE_TOOL_NAME));
        assert!(texte.contains("réflexion"));
        // …et ne nomme personne : ni nom propre, ni ton imposé, ni prénom.
        assert!(!texte.contains("Sylvie"));
        assert!(!texte.contains("Nova"));
        assert!(!texte.contains("Assistant »"));
    }

    #[test]
    fn le_cadre_interdit_le_travail_et_l_ecriture_ailleurs() {
        let texte = cadre();
        assert!(texte.contains("Tu ne lances aucun agent"));
        assert!(texte.contains("tu ne modifies aucun fichier des projets"));
        assert!(texte.contains("ni le carnet"));
        assert!(texte.contains("ni le palier de relation"));
        assert!(texte.contains("ni la description visuelle"));
        // La réflexion ne se montre jamais.
        assert!(texte.contains("Tu ne montres JAMAIS ta réflexion"));
    }

    #[test]
    fn le_cadre_ne_demande_jamais_de_poser_une_question_a_l_oral() {
        let texte = cadre();
        assert!(texte.contains("À l'oral, tu ne poses aucune question"));
    }

    // ── Le message assemblé ────────────────────────────────────────────────
    #[test]
    fn le_message_porte_l_identite_de_la_fiche_puis_la_demande_intacte() {
        let fiche = FicheEtat::ok(
            "Sylvie",
            "Sylvie, une archiviste patiente.",
            "douce, précise",
            "mon cher",
            "je range les documents",
            "je n'invente jamais un fait",
        );
        let message = "Bonjour, comment vas-tu ?";
        let construit = build_message(&fiche, message);
        assert!(construit.contains("Sylvie, une archiviste patiente."));
        assert!(construit.contains("douce, précise"));
        assert!(construit.contains("je n'invente jamais un fait"));
        assert!(construit.contains("conversation seule"));
        // La demande est la DERNIÈRE chose, mot pour mot.
        assert!(construit.ends_with(message));
    }

    #[test]
    fn le_message_sans_fiche_ne_porte_aucune_identite_inventee() {
        let fiche = FicheEtat::absente("Sylvie");
        let construit = build_message(&fiche, "Bonjour");
        assert!(construit.ends_with("Bonjour"));
        assert!(construit.contains("conversation seule"));
        // Aucun rôle de Pilot n'est injecté dans ce mode.
        assert!(!construit.contains("suivi multi-projets"));
        assert!(!construit.contains("lecture seule"));
    }

    #[test]
    fn le_message_ne_tronque_jamais_la_demande() {
        let fiche = FicheEtat::absente("Sylvie");
        let longue = format!("{} !", "a".repeat(5_000));
        let construit = build_message(&fiche, &longue);
        assert!(construit.ends_with(&longue));
    }
}
