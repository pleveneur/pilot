// conversation-scroll.js — OÙ DOIT SE RETROUVER LA CONVERSATION AU RETOUR D'UN
// PLEIN ÉCRAN (mode Vocal, mode Assistant seul) : SOURCE UNIQUE de la décision.
//
// LE DÉFAUT CORRIGÉ (docs/rapports/RAPPORT-retour-mode-conversation-en-bas.md) :
// sortir d'un plein écran REMET les nœuds du chat à leur place d'origine. Or
// DÉPLACER un nœud défilable dans le DOM remet son `scrollTop` à 0 — la
// conversation réapparaissait donc tout en haut, et l'utilisateur devait
// redescendre à la main pour retrouver où il en était. Le défaut ne venait donc
// pas de l'écran Vocal lui-même (il ne déplace pas la conversation : il la rend
// invisible, `visibility: hidden`, ce qui préserve les mesures) mais de la
// restitution des nœuds à la sortie du plein écran.
//
// Ce module est PUR : aucun DOM, aucun import, aucune minuterie, aucun accès au
// stockage. Il reçoit les trois nombres que tout conteneur défilant expose
// (`scrollTop`, `clientHeight`, `scrollHeight`) et rend un nombre de pixels —
// c'est ce qui rend la décision vérifiable sans navigateur.
//
// LES DEUX RÈGLES DE L'UTILISATEUR, dans l'ordre :
//   1. il était EN BAS (ou presque, seuil) → il retrouve la conversation en bas,
//      y compris si du contenu est arrivé pendant le plein écran ;
//   2. il avait REMONTÉ volontairement pour relire → sa position exacte est
//      rendue, sans saut en haut ni saut en bas arbitraire (la position est
//      bornée au contenu réel, jamais au-delà).
//
// Aucun second mécanisme de défilement n'est créé : le suivi automatique du bas
// (`superAtBottom` de super-agent.js) reprend la main ensuite, ré-armé ou non
// selon la position RÉELLEMENT restaurée.

/** Seuil (px) du « déjà en bas ». Même valeur que le suivi automatique de la
 *  conversation (`SUPER_SCROLL_BOTTOM_THRESHOLD`, super-agent.js), qui la lit
 *  ICI : une seule valeur dans tout le dépôt. */
export const CONVERSATION_SCROLL_BOTTOM_THRESHOLD = 60;

/** Nombre sûr : toute valeur non finie vaut 0 (aucune exception, aucun NaN). */
function nb(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * L'utilisateur est-il « déjà en bas » (dans le seuil) ?
 * Règle historique conservée à l'identique : `scrollTop + clientHeight >=
 * scrollHeight - threshold`. Un contenu qui ne déborde pas est donc toujours
 * « en bas ».
 * @param {number} scrollTop
 * @param {number} clientHeight
 * @param {number} scrollHeight
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function conversationAtBottom(
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CONVERSATION_SCROLL_BOTTOM_THRESHOLD,
) {
  const seuil = nb(threshold);
  return nb(scrollTop) + nb(clientHeight) >= nb(scrollHeight) - seuil;
}

/** Position la plus basse atteignable (jamais négative). */
export function conversationScrollMax(clientHeight, scrollHeight) {
  return Math.max(0, nb(scrollHeight) - nb(clientHeight));
}

/**
 * Photographie de la position de la conversation, prise AVANT que ses nœuds ne
 * soient déplacés. C'est le seul instant où l'information existe encore : après
 * le déplacement, `scrollTop` vaut 0 et le « il était en bas » est perdu.
 * @returns {{top: number, atBottom: boolean}}
 */
export function conversationScrollSnapshot(
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CONVERSATION_SCROLL_BOTTOM_THRESHOLD,
) {
  return {
    top: Math.max(0, nb(scrollTop)),
    atBottom: conversationAtBottom(scrollTop, clientHeight, scrollHeight, threshold),
  };
}

/**
 * Position à rendre à la conversation, en pixels (LA décision de ce module).
 *   - aucune photographie → `null` : il n'y a rien à restaurer, l'appelant ne
 *     touche à rien (aucun saut inventé) ;
 *   - « il était en bas » → le bas RÉEL du contenu d'aujourd'hui (du contenu a
 *     pu arriver pendant le plein écran : le bas reste juste) ;
 *   - sinon → sa position, bornée à ce qui est encore atteignable.
 * @param {{top: number, atBottom: boolean}|null|undefined} snapshot
 * @param {number} clientHeight
 * @param {number} scrollHeight
 * @returns {number|null}
 */
export function conversationScrollTarget(snapshot, clientHeight, scrollHeight) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const max = conversationScrollMax(clientHeight, scrollHeight);
  if (snapshot.atBottom === true) return max;
  const top = Math.max(0, nb(snapshot.top));
  return Math.min(max, top);
}
