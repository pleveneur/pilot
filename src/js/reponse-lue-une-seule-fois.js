// ── UNE REPONSE NE SE LIT PAS DEUX FOIS (mode Vocal) ───────────────────────
//
// Le defaut corrige : en mode Vocal, la lecture a voix haute de la reponse
// pouvait prononcer DEUX FOIS la meme chose. La lecture automatique part de la
// fin de tour (`agent_end` -> `autoReadVocalReply`, super-agent.js). Or un tour
// n'a pas forcement une seule fin : le moteur peut emettre plusieurs
// `agent_end` (relance automatique `willRetry`, tour relance par un compte
// rendu differe, erreur suivie d'une reprise). A chaque fin de tour, la lecture
// etait redemandee, et la seule garde etait l'ETAT TRANSITOIRE du bouton
// (`readState === "speaking"`). Cet etat retombe a `idle` des que la lecture
// est finie : le `agent_end` suivant relancait donc la MEME reponse, en
// entier. D'ou la repetition entendue.
//
// Ce module porte la seule regle qui manquait, et rien d'autre : un bouton
// d'ecoute se souvient qu'il a DEJA ete lu automatiquement.
//
// Ce que ce module ne fait PAS :
//   - il n'empeche pas l'utilisateur de relire une reponse (le bouton
//     « Ecouter » reste libre : le marquage ne concerne que la lecture
//     AUTOMATIQUE, et il est pose sur le bouton, donc il meurt avec la bulle) ;
//   - il ne decide pas QUAND lire (c'est `autoReadVocalReply`, inchange) ;
//   - il ne touche pas a la lecture elle-meme (`read-aloud.js`).
//
// Aucune API audio, aucun DOM obligatoire : la memoire est portee par l'objet
// `dataset` de l'element, exactement comme `data-read-state` du meme bouton.

/** Nom de la marque portee par le bouton (dataset → attribut `data-vocal-auto-read`). */
export const AUTO_READ_FLAG = "vocalAutoRead";

/**
 * Le bouton porte-t-il deja la marque « lu automatiquement » ?
 * @param {object|null|undefined} button element portant un `dataset`
 * @returns {boolean}
 */
export function isAutoReadDone(button) {
  const ds = button && button.dataset;
  if (!ds) return false;
  return ds[AUTO_READ_FLAG] === "1";
}

/**
 * Demande le droit de lire AUTOMATIQUEMENT ce bouton, et le marque.
 *
 * Rend `true` la PREMIERE fois (la lecture doit partir), `false` ensuite (elle
 * a deja eu lieu : on ne relit pas). Un objet sans `dataset` n'offre aucune
 * memoire : on garde alors le comportement historique (on lit), plutot que de
 * supprimer une lecture legitime sur un element inattendu.
 *
 * @param {object|null|undefined} button element portant un `dataset`
 * @returns {boolean} true si la lecture automatique doit se declencher
 */
export function claimAutoRead(button) {
  const ds = button && button.dataset;
  if (!ds) return true;
  if (ds[AUTO_READ_FLAG] === "1") return false;
  ds[AUTO_READ_FLAG] = "1";
  return true;
}
