// LE BOUTON DE RELANCE DE L'ECOUTE DE L'ECRAN VOCAL (« ok <personnage> »)
//
// Fiche du proprietaire (decisions 401 et 402 du suivi) : un bouton ROND, de la
// MEME forme que le cercle central, pose A L'INTERIEUR du haut du cercle, dont
// le contour du cercle sert de bord. Il est VISIBLE quand la dictee ne tourne
// pas, DISPARAIT pendant l'ecoute et revient des que le micro est coupe : c'est
// le signal « je n'ecoute plus, touchez pour reprendre ».
//
// Ce module ne fait AUCUN effet de bord : il ne touche ni au DOM, ni au micro,
// ni a la dictee, et il ne garde aucun etat. Il repond a deux questions, et ce
// sont les seules :
//   1. le bouton se VOIT-il ?  (`vocalRestartVisible`)
//   2. que dit son etiquette ? (`vocalRestartLabel`)
// L'application de la reponse vit dans `super-agent.js` (`vocalSyncRestartButton`,
// appele a la fin de `applyVocalState`) : la VISIBILITE suit donc l'etat REEL de
// la dictee, jamais un drapeau local qui pourrait diverger. Le CLIC emprunte la
// voie de demarrage qui existe deja (`toggleVoiceInput`, celle du bouton 🎙️ de
// la barre de saisie) : aucune seconde voie, aucun second moteur de
// transcription.
//
// La reduction de mouvement est respectee par construction : ce module ne
// produit ni animation, ni duree, ni mouvement.

/** Libelle d'action (infobulle + nom accessible) : le geste, dit en clair. */
export const VOCAL_RESTART_TITLE = "Lancer l'écoute";

/** Mot du bouton : la forme courte du reveil « ok <personnage> ». */
export const VOCAL_RESTART_WORD = "ok";

/**
 * Longueur maximale du nom affiche. Au-dela, le nom est abrege : le bouton est
 * un rond de 56 px, un nom trop long deborderait du disque et casserait la
 * regle « le contour du cercle lui sert de bord ».
 */
export const VOCAL_RESTART_NAME_MAX = 10;

/** L'etat de l'ecran ou le bouton a un sens : le repos. */
export const VOCAL_RESTART_ETAT = "idle";

/**
 * Le bouton se voit-il ?
 *
 * Quatre conditions, dans cet ordre (l'ordre EST la regle) :
 *   1. la transcription est DISPONIBLE — sinon ce serait un bouton mort, sur un
 *      ecran qui dit deja « dictee indisponible sur ce poste » ;
 *   2. AUCUNE dictee n'est ouverte — c'est la demande du proprietaire : il
 *      disparait pendant l'ecoute, et revient des que le micro est coupe ;
 *   3. aucun armement n'est PROGRAMME — sinon il clignoterait a chaque repos,
 *      pendant les 350 ms qui separent la fin d'une session de son rearment
 *      automatique (il ne doit pas s'allumer pour un demi-clignement) ;
 *   4. l'ecran est au REPOS. Pendant la PAROLE de Pilot et pendant son TRAVAIL,
 *      la dictee est fermee par construction (desarmement voulu) : un bouton y
 *      promettrait une reprise que l'ecran refuserait aussitot, et il se
 *      poserait sur le halo quand la mesure du micro entend une voix.
 *
 * @param {{transcription?: boolean, dicteeOuverte?: boolean,
 *          armementProgramme?: boolean, etat?: string}} [etats]
 * @returns {boolean} vrai quand le bouton doit etre visible
 */
export function vocalRestartVisible(etats) {
  const e = etats || {};
  if (e.transcription !== true) return false;
  if (e.dicteeOuverte === true) return false;
  if (e.armementProgramme === true) return false;
  return String(e.etat == null ? "" : e.etat) === VOCAL_RESTART_ETAT;
}

/**
 * Etiquette du bouton : « ok » + le nom du personnage actif.
 *
 * Le nom ne vient PAS d'ici : il est passe par l'appelant, qui le tient de
 * `superAgentDisplayLabel` (`assistant-persona.js` : personnage actif, sinon
 * nom regle, sinon nom habituel). Ce module n'invente aucun nom et n'en garde
 * aucun — changer de personnage change l'etiquette au prochain rendu.
 *
 * Seul le PREMIER mot du nom est garde (un titre du type « Nova la gardienne »
 * ne tiendrait pas dans le rond) et il est borne a `VOCAL_RESTART_NAME_MAX`.
 *
 * @param {string} [nom] nom affiche de l'Assistant
 * @returns {string} « ok Nova », « ok », …
 */
export function vocalRestartLabel(nom) {
  const brut = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
  const premier = brut.split(" ")[0] || "";
  if (!premier) return VOCAL_RESTART_WORD;
  const court =
    premier.length > VOCAL_RESTART_NAME_MAX
      ? `${premier.slice(0, VOCAL_RESTART_NAME_MAX - 1)}…`
      : premier;
  return `${VOCAL_RESTART_WORD} ${court}`;
}
