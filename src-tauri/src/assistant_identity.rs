// assistant_identity.rs — IDENTITÉ de l'Assistant : son GENRE et son MODÈLE.
//
// SOURCE UNIQUE des deux réglages (tâches 402 et 403), décidés ici, une seule
// fois, et testés sans configuration ni session :
//
//   1. GENRE (masculin / féminin / non précisé) — la phrase injectée dans le
//      prompt de l'assistant vient de `assistant_gender_instruction`, et de nulle
//      part ailleurs. La valeur réglée dans Pilot (`AppConfig::assistant_gender`)
//      n'est qu'une des deux entrées : le GENRE PORTÉ PAR LA FICHE DU PERSONNAGE
//      actif (Présences, `genre.txt`) passe avant, parce que le personnage est
//      plus précis que le réglage général. « Non précisé » n'injecte AUCUNE
//      phrase : le comportement actuel est alors strictement préservé.
//
//   2. MODÈLE PAR DÉFAUT propre au personnage actif (fiche Présences,
//      `modele.txt`) — `decide_assistant_model` dit quel modèle la session de
//      l'Assistant utilise et D'OÙ il vient. Fiche sans modèle = la chaîne
//      existante de Pilot (modèle choisi → réglage dédié #88 → défaut global),
//      donc le comportement actuel, sans erreur et sans message.
//
// Règles tenues ici (et vérifiées par les tests du module) :
//   - AUCUNE valeur en dur cachée ailleurs : les phrases de genre et la décision
//     de priorité des modèles vivent dans ce fichier ;
//   - une FICHE INCOMPLÈTE n'est jamais une erreur : champ absent → `None` →
//     comportement actuel, aucun message ;
//   - un MODÈLE INCONNU du registre n'échoue jamais : il est écarté avec une
//     TRACE LISIBLE (`AssistantModelDecision::trace`) et Pilote repart sur sa
//     propre chaîne de modèles.
//
// Ce module ne lit aucun fichier et n'appelle aucune commande : il reçoit des
// chaînes déjà lues (persona.rs pour la fiche, AppConfig pour le réglage) et
// rend des décisions. C'est ce qui le rend testable et impossible à contourner
// par un second chemin.

use crate::super_agent::parse_model_spec;

/// Valeur de configuration « non précisé » (défaut) : aucune phrase de genre.
pub const ASSISTANT_GENDER_UNSPECIFIED: &str = "";
/// Valeur canonique du genre féminin (ce qui est ÉCRIT dans la configuration).
pub const ASSISTANT_GENDER_FEMININE: &str = "feminin";
/// Valeur canonique du genre masculin (ce qui est ÉCRIT dans la configuration).
pub const ASSISTANT_GENDER_MASCULINE: &str = "masculin";

/// Genre retenu pour l'Assistant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistantGender {
    /// Féminin : accords et pronoms au féminin quand l'assistant parle de lui.
    Feminine,
    /// Masculin : accords et pronoms au masculin.
    Masculine,
    /// Rien de réglé : AUCUNE phrase injectée (comportement actuel préservé).
    Unspecified,
}

/// D'où vient le genre appliqué (pour la phrase injectée, jamais pour un réglage).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistantGenderSource {
    /// Genre porté par la fiche du personnage actif (Présences).
    Persona,
    /// Genre réglé dans Pilot (Options → Assistant).
    Configured,
    /// Aucun genre : rien n'est injecté.
    None,
}

/// Lit une valeur de genre, TOLÉRANTE (casse, accents, formes courtes) et
/// toujours ramenée aux trois valeurs canoniques. Toute valeur inconnue ou vide
/// donne `Unspecified` — jamais une erreur : une fiche mal remplie ne doit pas
/// empêcher l'assistant de parler.
pub fn parse_assistant_gender(raw: &str) -> AssistantGender {
    let plat: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'õ' | 'ò' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            autre => autre,
        })
        .filter(|c| c.is_alphanumeric())
        .collect();
    match plat.as_str() {
        "feminin" | "feminine" | "femme" | "f" | "female" | "elle" => AssistantGender::Feminine,
        "masculin" | "masculine" | "homme" | "m" | "male" | "il" | "lui" => AssistantGender::Masculine,
        _ => AssistantGender::Unspecified,
    }
}

/// Forme CANONIQUE à écrire dans la configuration (ce que lit `parse_assistant_gender`).
/// Une valeur inconnue est ramenée à « non précisé », jamais conservée telle quelle.
pub fn canonical_assistant_gender(raw: &str) -> &'static str {
    match parse_assistant_gender(raw) {
        AssistantGender::Feminine => ASSISTANT_GENDER_FEMININE,
        AssistantGender::Masculine => ASSISTANT_GENDER_MASCULINE,
        AssistantGender::Unspecified => ASSISTANT_GENDER_UNSPECIFIED,
    }
}

/// Genre EFFECTIF de l'Assistant — règle de priorité UNIQUE :
///   1. le genre porté par la FICHE DU PERSONNAGE actif (Présences) ;
///   2. sinon le réglage de Pilot (Options → Assistant) ;
///   3. sinon aucun genre (aucune phrase injectée).
pub fn effective_assistant_gender(
    persona_gender: &str,
    configured_gender: &str,
) -> (AssistantGender, AssistantGenderSource) {
    let personnage = parse_assistant_gender(persona_gender);
    if personnage != AssistantGender::Unspecified {
        return (personnage, AssistantGenderSource::Persona);
    }
    let regle = parse_assistant_gender(configured_gender);
    if regle != AssistantGender::Unspecified {
        return (regle, AssistantGenderSource::Configured);
    }
    (AssistantGender::Unspecified, AssistantGenderSource::None)
}

/// LA phrase de genre injectée dans le prompt de l'assistant — UN SEUL endroit.
///
/// `Unspecified` rend `""` : rien n'est ajouté, le prompt reste exactement
/// celui d'avant (un utilisateur qui n'a rien réglé ne voit aucun changement).
/// La phrase ne nomme jamais l'assistant : le nom a son propre chemin unique
/// (`personaDisplayName` côté fenêtre), et le figer ici créerait une seconde
/// règle de nom.
pub fn assistant_gender_instruction(gender: AssistantGender) -> String {
    let (adjectifs, exemple) = match gender {
        AssistantGender::Feminine => ("féminin", "je suis prête, je suis contente"),
        AssistantGender::Masculine => ("masculin", "je suis prêt, je suis content"),
        AssistantGender::Unspecified => return String::new(),
    };
    format!(
        "\n\nIdentité de genre (réglage de l'utilisateur) : tu t'exprimes au {} quand tu parles de toi — accords, adjectifs et pronoms au {} (par exemple « {} »). Cela ne change ni tes réponses ni tes décisions, seulement la façon de les dire, et tu n'as pas à l'expliquer.",
        adjectifs, adjectifs, exemple
    )
}

/// Le BLOC DU PERSONNAGE injecté dans le prompt de l'assistant : la phrase de
/// genre, précédée de la provenance quand elle vient de la fiche du personnage
/// (pour que l'assistant sache que c'est le personnage qui parle, pas un
/// réglage général). Bloc VIDE quand aucun genre n'est défini — aucune ligne
/// vide, aucun en-tête orphelin, prompt inchangé.
pub fn assistant_identity_block(persona_gender: &str, configured_gender: &str) -> String {
    let (gender, source) = effective_assistant_gender(persona_gender, configured_gender);
    let instruction = assistant_gender_instruction(gender);
    if instruction.is_empty() {
        return String::new();
    }
    match source {
        AssistantGenderSource::Persona => format!(
            "\n\nGenre porté par la fiche du personnage actif (Présences) :{}",
            instruction
        ),
        _ => instruction,
    }
}

/// D'où vient le modèle effectif retenu pour la session de l'Assistant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistantModelSource {
    /// Modèle porté par la fiche du personnage actif (Présences) : prioritaire.
    Persona,
    /// Modèle choisi dans la barre d'outils de l'onglet 🧭 (`super_agent_model`).
    Chosen,
    /// Réglage dédié de l'Assistant (`super_agent_default_model`, issue #88).
    Dedicated,
    /// Modèle par défaut global des agents (`defaultModel`).
    Global,
    /// Aucun : le moteur applique le sien.
    None,
}

/// Décision complète du modèle de l'assistant.
#[derive(Debug, Clone)]
pub struct AssistantModelDecision {
    /// Modèle retenu (`provider`, `modelId`), ou `None` (le moteur décide).
    pub model: Option<(String, String)>,
    /// Étage qui a fourni le modèle.
    pub source: AssistantModelSource,
    /// Trace LISIBLE quand un modèle pourtant présent a été écarté (inconnu du
    /// registre, mal formé). `None` : rien à signaler. Jamais une erreur.
    pub trace: Option<String>,
}

/// Décide le modèle effectif de la session de l'Assistant, avec le MODÈLE DU
/// PERSONNAGE en tête. Fonction PURE (aucune configuration, aucun disque).
///
/// Priorité :
///   1. **modèle de la fiche du personnage actif** — s'il est renseigné, bien
///      formé et encore présent dans le registre des modèles installés :
///      c'est un choix plus précis que tout réglage de Pilot, donc il gagne.
///      Un modèle renseigné mais INCONNU du registre est ÉCARTÉ avec une trace
///      lisible (jamais un échec de démarrage : une fiche qui cite un modèle
///      désinstallé ne doit pas empêcher l'assistant de parler) ;
///   2. **modèle choisi** dans l'onglet 🧭, s'il est encore installé ;
///   3. **réglage dédié** de l'Assistant (issue #88) ;
///   4. **défaut global** des agents.
///
/// `available` = spécifications installées (`"provider/modelId"`) ; `None` =
/// liste illisible → aucune validation (fail-open : on fait confiance au
/// réglage plutôt que de bloquer le démarrage).
pub fn decide_assistant_model(
    persona_model: &str,
    chosen: &str,
    dedicated: &str,
    global: Option<(String, String)>,
    available: Option<&[String]>,
) -> AssistantModelDecision {
    let mut trace = None;
    let persona_spec = persona_model.trim();
    if !persona_spec.is_empty() {
        match parse_model_spec(persona_spec) {
            Some((provider, model_id)) => {
                let spec = format!("{}/{}", provider, model_id);
                let installed = match available {
                    Some(list) => list.iter().any(|s| s == &spec),
                    None => true,
                };
                if installed {
                    return AssistantModelDecision {
                        model: Some((provider, model_id)),
                        source: AssistantModelSource::Persona,
                        trace: None,
                    };
                }
                trace = Some(format!(
                    "Modèle du personnage actif « {} » introuvable dans le registre : repli sur le modèle de Pilot (aucun échec, la fiche n'est pas modifiée).",
                    spec
                ));
            }
            None => {
                trace = Some(format!(
                    "Modèle du personnage actif mal formé (« {} ») : attendu « fournisseur/modèle ». Repli sur le modèle de Pilot.",
                    persona_spec
                ));
            }
        }
    }

    // Chaîne EXISTANTE de Pilot, inchangée (mêmes règles qu'avant ce lot).
    if let Some((provider, model_id)) = validated_spec(chosen, available) {
        return AssistantModelDecision {
            model: Some((provider, model_id)),
            source: AssistantModelSource::Chosen,
            trace,
        };
    }
    if let Some((provider, model_id)) = parse_model_spec(dedicated) {
        return AssistantModelDecision {
            model: Some((provider, model_id)),
            source: AssistantModelSource::Dedicated,
            trace,
        };
    }
    match global {
        Some((provider, model_id)) => AssistantModelDecision {
            model: Some((provider, model_id)),
            source: AssistantModelSource::Global,
            trace,
        },
        None => AssistantModelDecision {
            model: None,
            source: AssistantModelSource::None,
            trace,
        },
    }
}

/// Spécification validée contre le registre : `None` si vide, mal formée, ou
/// absente de la liste installée (`available` = `None` ⇒ aucune validation).
fn validated_spec(spec: &str, available: Option<&[String]>) -> Option<(String, String)> {
    let (provider, model_id) = parse_model_spec(spec)?;
    if let Some(list) = available {
        let complet = format!("{}/{}", provider, model_id);
        if !list.iter().any(|s| s == &complet) {
            return None;
        }
    }
    Some((provider, model_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registre() -> Vec<String> {
        vec!["plh/rapide".to_string(), "plh/fin".to_string()]
    }

    // ── Genre ───────────────────────────────────────────────────────────────

    #[test]
    fn le_parsing_du_genre_est_tolerant_et_jamais_une_erreur() {
        for feminin in ["feminin", "Féminin", " FÉMININ ", "femme", "f", "female", "elle"] {
            assert_eq!(
                parse_assistant_gender(feminin),
                AssistantGender::Feminine,
                "« {feminin} » doit être reconnu comme féminin"
            );
        }
        for masculin in ["masculin", "Masculin", "homme", "m", "male", "il"] {
            assert_eq!(
                parse_assistant_gender(masculin),
                AssistantGender::Masculine,
                "« {masculin} » doit être reconnu comme masculin"
            );
        }
        for rien in ["", "   ", "non précisé", "autre", "x", "???"] {
            assert_eq!(
                parse_assistant_gender(rien),
                AssistantGender::Unspecified,
                "« {rien} » ne doit imposer AUCUN genre"
            );
        }
        // La valeur canonique écrite en configuration se relit à l'identique.
        assert_eq!(canonical_assistant_gender("FÉMININ"), ASSISTANT_GENDER_FEMININE);
        assert_eq!(canonical_assistant_gender("Homme"), ASSISTANT_GENDER_MASCULINE);
        assert_eq!(canonical_assistant_gender("inconnu"), ASSISTANT_GENDER_UNSPECIFIED);
    }

    #[test]
    fn le_defaut_ne_change_rien_au_prompt() {
        // Défaut (réglage vide, fiche sans genre) : AUCUNE phrase.
        assert_eq!(
            effective_assistant_gender("", ""),
            (AssistantGender::Unspecified, AssistantGenderSource::None)
        );
        assert_eq!(assistant_gender_instruction(AssistantGender::Unspecified), "");
        assert_eq!(assistant_identity_block("", ""), "");
        // Une valeur inconnue n'impose pas davantage de genre.
        assert_eq!(assistant_identity_block("non précisé", "autre"), "");
    }

    #[test]
    fn le_genre_regle_est_injecte_dans_une_phrase_unique() {
        let feminin = assistant_identity_block("", "féminin");
        assert!(feminin.contains("au féminin"), "phrase feminine attendue : {feminin}");
        assert!(feminin.contains("je suis prête"), "exemple au féminin attendu");
        let masculin = assistant_identity_block("", "masculin");
        assert!(masculin.contains("au masculin"));
        assert!(masculin.contains("je suis prêt"));
        // Les deux phrases sont DIFFÉRENTES : le réglage a un effet réel.
        assert_ne!(feminin, masculin);
        // Provenance : le réglage de Pilot n'annonce pas une fiche de personnage.
        assert!(!feminin.contains("fiche du personnage"));
    }

    #[test]
    fn la_fiche_du_personnage_passe_avant_le_reglage_de_pilot() {
        let (gender, source) = effective_assistant_gender("féminin", "masculin");
        assert_eq!(gender, AssistantGender::Feminine);
        assert_eq!(source, AssistantGenderSource::Persona);
        let bloc = assistant_identity_block("féminin", "masculin");
        assert!(
            bloc.contains("fiche du personnage actif"),
            "le bloc doit dire que le genre vient de la fiche : {bloc}"
        );
        // Fiche MUETTE : le réglage de Pilot reprend la main (aucune régression).
        let (gender, source) = effective_assistant_gender("", "masculin");
        assert_eq!((gender, source), (AssistantGender::Masculine, AssistantGenderSource::Configured));
    }

    // ── Modèle par personnage ───────────────────────────────────────────────

    #[test]
    fn sans_modele_de_personnage_la_chaine_de_pilot_est_inchangee() {
        let disponible = registre();
        // Fiche sans modèle : le modèle choisi dans Pilot gagne (comportement actuel).
        let d = decide_assistant_model(
            "",
            "plh/fin",
            "plh/rapide",
            Some(("plh".into(), "global".into())),
            Some(&disponible),
        );
        assert_eq!(d.model, Some(("plh".to_string(), "fin".to_string())));
        assert_eq!(d.source, AssistantModelSource::Chosen);
        assert_eq!(d.trace, None, "aucune trace quand la fiche est muette");

        // Fiche sans modèle, rien de choisi : le réglage dédié, puis le global.
        let d = decide_assistant_model("", "", "plh/rapide", None, Some(&disponible));
        assert_eq!(d.source, AssistantModelSource::Dedicated);
        assert_eq!(d.model, Some(("plh".to_string(), "rapide".to_string())));
        let d = decide_assistant_model(
            "",
            "",
            "",
            Some(("plh".into(), "global".into())),
            Some(&disponible),
        );
        assert_eq!(d.source, AssistantModelSource::Global);
        assert_eq!(d.model, Some(("plh".to_string(), "global".to_string())));
        // Rien nulle part : aucun modèle imposé, le moteur décide.
        let d = decide_assistant_model("", "", "", None, None);
        assert_eq!(d.model, None);
        assert_eq!(d.source, AssistantModelSource::None);
    }

    #[test]
    fn le_modele_du_personnage_est_utilise_quand_il_est_installe() {
        let disponible = registre();
        let d = decide_assistant_model(
            "plh/fin",
            "plh/rapide",
            "plh/rapide",
            Some(("plh".into(), "global".into())),
            Some(&disponible),
        );
        assert_eq!(
            d.model,
            Some(("plh".to_string(), "fin".to_string())),
            "la fiche du personnage est plus précise qu'un réglage de Pilot"
        );
        assert_eq!(d.source, AssistantModelSource::Persona);
        assert_eq!(d.trace, None, "modèle installé : aucune trace");
    }

    #[test]
    fn un_modele_de_personnage_inconnu_retombe_sur_pilot_avec_une_trace() {
        let disponible = registre();
        let d = decide_assistant_model(
            "plh/disparu",
            "plh/rapide",
            "",
            None,
            Some(&disponible),
        );
        assert_eq!(
            d.model,
            Some(("plh".to_string(), "rapide".to_string())),
            "modèle inconnu : retour au modèle de Pilot, jamais un échec"
        );
        assert_eq!(d.source, AssistantModelSource::Chosen);
        let trace = d.trace.expect("une trace lisible est exigée");
        assert!(trace.contains("plh/disparu"));
        assert!(trace.contains("introuvable"), "la trace doit être compréhensible : {trace}");

        // Liste illisible (`None`) : aucune validation, la fiche reste appliquée.
        let d = decide_assistant_model("plh/inconnu", "plh/rapide", "", None, None);
        assert_eq!(d.source, AssistantModelSource::Persona);

        // Spécification mal formée : écartée elle aussi, avec une trace.
        let d = decide_assistant_model("pas-un-modele", "plh/rapide", "", None, Some(&disponible));
        assert_eq!(d.source, AssistantModelSource::Chosen);
        assert!(d.trace.unwrap_or_default().contains("mal formé"));
    }

    #[test]
    fn un_modele_choisi_desinstalle_ne_bloque_pas_le_demarrage() {
        // Le modèle choisi dans Pilot a été retiré du registre : repli dédié,
        // puis global — exactement le comportement d'avant ce lot.
        let disponible = registre();
        let d = decide_assistant_model(
            "",
            "plh/retire",
            "plh/fin",
            None,
            Some(&disponible),
        );
        assert_eq!(d.source, AssistantModelSource::Dedicated);
        assert_eq!(d.model, Some(("plh".to_string(), "fin".to_string())));
    }
}
