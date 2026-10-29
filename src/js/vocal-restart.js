// LE BOUTON DE RELANCE DE L'ECOUTE DE L'ECRAN VOCAL (« Reveiller <Nom> »)
//
// Fiche du proprietaire (decisions 401 et 402 du suivi, retouchees le
// 2026-10-29) : un bouton ROND, de la MEME forme que le cercle central, qui
// OCCUPE TOUTE LA SURFACE INTERIEURE du cercle, moins l'epaisseur de la bordure.
// Quand il est affiche, il DEVIENT le cercle : il ne flotte plus dedans, et
// c'est le contour du cercle qui lui sert de bord (aucun anneau propre). Il est
// VISIBLE quand la dictee ne tourne pas, DISPARAIT pendant l'ecoute et revient
// des que le micro est coupe : c'est le signal « je n'ecoute plus, touchez pour
// reprendre ».
//
// Son libelle dit le geste et le nom : « Reveiller <Nom> », ou <Nom> est celui
// du PERSONNAGE ACTIF (meme source que le nom de l'onglet 🧭, aucun second
// mecanisme de nom ici : le nom est PASSE par l'appelant).
//
// Ce module ne fait AUCUN effet de bord : il ne touche ni au DOM, ni au micro,
// ni a la dictee, et il ne garde aucun etat. Il repond a deux questions, et ce
// sont les seules :
//   1. le bouton se VOIT-il ?  (`vocalRestartVisible`)
//   2. que dit son etiquette ? (texte affiche : `vocalRestartText` ; libelle
//      complet : `vocalRestartLabel`)
// L'application de la reponse vit dans `super-agent.js` (`vocalSyncRestartButton`,
// appele a la fin de `applyVocalState`) : la VISIBILITE suit donc l'etat REEL de
// la dictee, jamais un drapeau local qui pourrait diverger. Le CLIC emprunte la
// voie de demarrage qui existe deja (`toggleVoiceInput`, celle du bouton 🎙️ de
// la barre de saisie) : aucune seconde voie, aucun second moteur de
// transcription.
//
// La reduction de mouvement est respectee par construction : ce module ne
// produit ni animation, ni duree, ni mouvement.

// Le nom HABITUEL de l'Assistant (repli quand aucun personnage n'est actif) :
// il vient de `assistant-persona.js`, SEULE source de ce nom. Aucun nom n'est
// recopie ici.
import { DEFAULT_ASSISTANT_NAME } from "./assistant-persona.js";

/** Verbe du libelle : le geste, dit en clair (« Réveiller <Nom> »). */
export const VOCAL_RESTART_VERB = "Réveiller";

/**
 * Longueur maximale du TEXTE AFFICHE dans le cercle, verbe compris, en
 * caracteres.
 *
 * Au-dela, le texte est abrege par « … » : le bouton occupe toute la surface
 * interieure du disque (168 px) et le nom d'un personnage peut faire jusqu'a 60
 * caracteres, qui n'y tiendraient pas. Le nom ENTIER n'est jamais perdu : c'est
 * lui que portent l'infobulle et le nom accessible (`vocalRestartLabel`).
 */
export const VOCAL_RESTART_LABEL_MAX = 24;

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
 * Nom retenu pour le libelle : celui de l'appelant, sinon le nom habituel.
 *
 * Le nom ne vient PAS d'ici : il est passe par l'appelant, qui le tient de
 * `superAgentDisplayLabel` (`assistant-persona.js` : personnage actif, sinon nom
 * regle, sinon nom habituel). Ce module n'invente aucun nom et n'en garde aucun
 * — changer de personnage change le libelle au prochain rendu.
 *
 * Il ne remplace qu'un nom VIDE ou absent, par `DEFAULT_ASSISTANT_NAME` (la
 * MEME constante que l'onglet 🧭) : jamais « Réveiller  » avec un double espace,
 * jamais « undefined », jamais un trou.
 *
 * @param {unknown} [nom] nom affiche de l'Assistant
 * @returns {string} nom utilisable, jamais vide
 */
export function vocalRestartName(nom) {
  const brut = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
  return brut || DEFAULT_ASSISTANT_NAME;
}

/**
 * Libelle COMPLET du bouton : « Réveiller <Nom> ».
 *
 * C'est le texte de l'infobulle ET du nom accessible : il porte toujours le nom
 * ENTIER, meme quand l'affichage dans le cercle est abrege.
 *
 * @param {unknown} [nom] nom affiche de l'Assistant
 * @returns {string} « Réveiller Nova », « Réveiller Assistant », …
 */
export function vocalRestartLabel(nom) {
  return `${VOCAL_RESTART_VERB} ${vocalRestartName(nom)}`;
}

/**
 * Texte AFFICHE dans le cercle : le libelle complet, borne a
 * `VOCAL_RESTART_LABEL_MAX` caracteres.
 *
 * La coupe tombe sur une fin de mot quand il y en a une lisible (un mot tronque
 * au milieu ne se lit pas) ; sinon elle tombe au caractere suivant. Le verbe
 * n'est jamais laisse seul avec « … » : si le nom ne laisse aucune place, la
 * coupe reste au caractere. Le compte se fait en CARACTERES (points de code),
 * pas en unites UTF-16 : un nom avec emoji n'est jamais coupe au milieu d'une
 * paire de substitution.
 *
 * @param {unknown} [nom] nom affiche de l'Assistant
 * @returns {string} texte affichable, jamais vide
 */
export function vocalRestartText(nom) {
  const complet = vocalRestartLabel(nom);
  const points = Array.from(complet);
  if (points.length <= VOCAL_RESTART_LABEL_MAX) return complet;
  const coupe = points.slice(0, VOCAL_RESTART_LABEL_MAX - 1).join("");
  const espace = coupe.lastIndexOf(" ");
  const base = espace > VOCAL_RESTART_VERB.length ? coupe.slice(0, espace) : coupe;
  return `${base.replace(/\s+$/, "")}\u2026`;
}
