// assistant-instructions.js — LE NOM DANS LES INSTRUCTIONS DURABLES DE L'ASSISTANT.
//
// Défaut corrigé : le texte d'instructions durable de l'Assistant (réglages →
// « Prompt système », stocké en configuration) RECOPIAIT le nom du personnage
// (« Sylvie », « Nova »…) et son genre. Le personnage désactivé, son nom et son
// genre continuaient donc de s'appliquer : un personnage n'est pourtant que
// quatre fichiers lus dans un dossier, rien de plus.
//
// Deux règles, et deux seulement, vivent ici (pures : aucun DOM, aucun import
// Tauri, aucun état) :
//
//   1. RÉFÉRENCER, JAMAIS RECOPIER — un texte d'instructions écrit `{nom}` là où
//      il veut désigner l'Assistant. Le jeton est remplacé À CHAQUE MESSAGE par la
//      règle unique du nom (personnage actif → nom réglé → « Assistant »),
//      `assistant_identity::resolve_instruction_name` côté moteur. Le même jeton
//      est écrit là-bas (`INSTRUCTION_NAME_TOKEN`) : les deux valeurs sont
//      comparées par le verrou `personnage-jamais-fige-dans-les-instructions.test.js`,
//      sinon le jeton tapé par l'utilisateur cesserait silencieusement de marcher.
//
//   2. UN SEUL ÉCRIVAIN DU PROMPT — l'enregistrement des réglages ne doit pas
//      réécrire le prompt depuis la copie de la fenêtre : cette copie peut être
//      PÉRIMÉE (l'Assistant a réécrit son propre prompt entre-temps, par l'outil
//      `update_my_prompt`), et la réécrire faisait revenir une ancienne version EN
//      SILENCE, sans passer par l'historique `prompt-history.md`. Une modification
//      réelle part donc par le chemin dédié (`set_super_agent_prompt`), et
//      `save_config` préserve la version en vigueur.

/**
 * Jeton par lequel un texte d'instructions référence le nom de l'Assistant.
 * Même valeur que `INSTRUCTION_NAME_TOKEN` (`src-tauri/src/assistant_identity.rs`).
 */
export const INSTRUCTION_NAME_PLACEHOLDER = "{nom}";

/**
 * Une modification du champ « Prompt système » doit-elle partir par le chemin
 * DÉDIÉ (`set_super_agent_prompt`, qui tient l'historique) plutôt que par la
 * réécriture globale de la configuration ?
 *
 * Oui seulement si le texte a RÉELLEMENT changé : enregistrer d'autres réglages ne
 * doit rien ajouter à l'historique, sinon le fichier grossirait à chaque clic sur
 * « Enregistrer » et noierait les vraies versions.
 *
 * @param {string} edited - contenu actuel du champ
 * @param {string} loaded - contenu chargé à l'ouverture des réglages
 * @returns {boolean}
 */
export function promptNeedsDedicatedSave(edited, loaded) {
  const apres = typeof edited === "string" ? edited : "";
  const avant = typeof loaded === "string" ? loaded : "";
  return apres !== avant;
}

/**
 * Nombre de références au nom dans un texte d'instructions (utile aux verrous et
 * à l'aide affichée : zéro référence = texte qui ne suit pas le personnage).
 *
 * @param {string} text
 * @returns {number}
 */
export function instructionNameTokenCount(text) {
  if (typeof text !== "string" || text === "") return 0;
  return text.split(INSTRUCTION_NAME_PLACEHOLDER).length - 1;
}
