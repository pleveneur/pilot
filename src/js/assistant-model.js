// assistant-model.js — MODÈLE IA PROPRE AU PERSONNAGE ACTIF (tâche 403),
// saisi dans Pilot → Options → onglet Assistant.
//
// Pourquoi ce module : Présences n'a aucun écran. Le modèle d'un personnage ne
// pouvait donc être saisi nulle part, et la première marche de l'escalier de
// modèles (fiche → modèle choisi → réglage dédié → défaut global) restait
// toujours vide. Le champ vit désormais à côté du genre et de la voix, dans la
// section Assistant des Paramètres.
//
// Ce module ne décide QUE du champ : la clé de configuration ADDITIVE, la
// normalisation de ce qui est tapé, la valeur RÉELLEMENT affichée, et la phrase
// d'aide. Il ne lit aucun fichier, n'appelle aucune commande, ne touche à aucun
// élément de l'écran : c'est ce qui le rend testable sous Node et impossible à
// contourner par un second chemin.
//
// Ce qu'il ne fait PAS (et qui vivrait ailleurs s'il fallait le faire) :
//   - il ne DÉCIDE aucun modèle effectif : la priorité (fiche du personnage →
//     modèle choisi → réglage dédié #88 → défaut global) vit à UN SEUL endroit,
//     `src-tauri/src/assistant_identity.rs::decide_assistant_model` ;
//   - il n'écrit pas la fiche : l'écriture de `modele.txt` est côté Rust
//     (`persona::write_assistant_persona_model`), sur geste de l'utilisateur ;
//   - il ne compose aucune phrase de repli : la décision unique la fournit.

/** Clé de configuration (ADDITIVE, à côté de `assistant_gender`). */
export const ASSISTANT_MODEL_KEY = "assistant_model";

/** Valeur « aucun modèle propre au personnage » (défaut, repli silencieux). */
export const ASSISTANT_MODEL_NONE = "";

/** Longueur maximale retenue (une spécification `fournisseur/modèle` est courte). */
export const ASSISTANT_MODEL_MAX_CHARS = 120;

/** Commande Rust qui relit le modèle porté par la fiche (lecture LÉGÈRE). */
export const ASSISTANT_MODEL_READ_COMMAND = "read_assistant_persona_model";

/** Commande Rust qui écrit le modèle dans la fiche du personnage actif. */
export const ASSISTANT_MODEL_WRITE_COMMAND = "write_assistant_persona_model";

/**
 * Normalise ce que l'utilisateur a tapé : espaces rognés, caractères de
 * contrôle retirés, longueur bornée. La GRAMMAIRE `fournisseur/modèle` n'est
 * PAS vérifiée ici : elle appartient à `persona::normalize_model_line`
 * (une seule règle, du côté qui écrit), qui refuse une valeur mal formée plutôt
 * que de l'écrire.
 * Fonction PURE.
 * @param {unknown} raw
 * @returns {string} valeur à afficher / à envoyer, jamais `null`
 */
export function normalizeAssistantModel(raw) {
  if (typeof raw !== "string") return ASSISTANT_MODEL_NONE;
  const propre = Array.from(raw)
    .filter((c) => {
      const code = c.codePointAt(0) || 0;
      return !(code < 0x20 || code === 0x7f);
    })
    .join("");
  return propre.trim().slice(0, ASSISTANT_MODEL_MAX_CHARS).trim();
}

/**
 * Vrai si le champ ne porte aucun modèle propre (donc repli sur la chaîne de
 * Pilot). Fonction PURE.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function assistantModelIsUnspecified(raw) {
  return normalizeAssistantModel(raw) === ASSISTANT_MODEL_NONE;
}

/**
 * Valeur RÉELLEMENT affichée dans le champ — fonction PURE, règle unique :
 *
 *   1. un personnage actif porte son modèle (`modele.txt`) : c'est LUI qui
 *      s'applique, donc c'est lui qu'on montre (sinon l'écran mentirait sur ce
 *      qui tourne) ;
 *   2. sinon la valeur mémorisée par Pilot (`assistant_model`), c'est-à-dire le
 *      dernier choix écrit — souvenir utile quand aucun personnage n'est actif ;
 *   3. sinon rien (champ vide = aucun modèle propre).
 *
 * @param {boolean} active - un personnage actif est-il déposé ?
 * @param {unknown} fiche - modèle lu dans la fiche (`modele.txt`)
 * @param {unknown} configured - valeur mémorisée en configuration
 * @returns {string}
 */
export function assistantModelPrefill(active, fiche, configured) {
  const duPersonnage = normalizeAssistantModel(fiche);
  if (active === true && duPersonnage) return duPersonnage;
  return normalizeAssistantModel(configured);
}

/**
 * Phrase d'aide affichée sous le champ (une seule, jamais un paragraphe).
 * Fonction PURE.
 * @param {{active?: boolean, model?: unknown}} [etat]
 * @returns {string}
 */
export function assistantModelHelpText(etat = {}) {
  const actif = Boolean(etat && etat.active === true);
  const modele = normalizeAssistantModel(etat ? etat.model : "");
  if (!actif) {
    return "Aucun personnage n'est actif : ce champ ne peut pas encore être écrit. Activez un personnage dans Présences, puis revenez ici.";
  }
  if (!modele) {
    return "Vide : le personnage n'a pas de modèle propre, l'Assistant utilise le modèle réglé pour lui, sinon le modèle par défaut des agents.";
  }
  return `Le personnage lit avec « ${modele} ». Si ce modèle n'existe plus, l'Assistant repart sur ses réglages et une ligne l'indique dans le volet Événements.`;
}
