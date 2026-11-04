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
//
// DEUXIÈME TEMPS (défaut revenu, cf. même rapport, section « Deuxième
// correctif ») : la décision ci-dessus est calculée sur la géométrie lue à
// l'instant de la sortie, qui peut être TRANSITOIRE. `conversationScrollReplayTarget`
// rejoue donc la MÊME décision sur la géométrie réelle, au premier signal de
// rendu — jamais sur un minuteur, jamais en défilement animé, et sans jamais
// ramener de force quelqu'un qui a repris la main sur la conversation.

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

/**
 * LAQUELLE DES DEUX PHOTOGRAPHIES RENDRE EN REVENANT À « DÉTAILLÉ ».
 *
 * TROISIÈME CAUSE DU MÊME DÉFAUT (mission « au retour du mode Vocal, la
 * conversation repart tout en haut »), et la plus discrète : la photographie
 * prise dans `exitVocal` / `exitImmersive` est trop TARDIVE pour une seule
 * situation — celle de l'utilisateur qui RELISAIT un passage.
 *
 * Pourquoi : l'entrée dans « Assistant seul » force le bas (issue #82, décision
 * conservée). Cette écriture a lieu AVANT tout plein écran, donc avant les
 * photographies de sortie : au retour, la photographie dit « il était en bas »
 * alors qu'il lisait un passage, et il est ramené en bas contre son gré.
 *
 * La position qu'il avait réellement en QUITTANT « Détaillé » existe pourtant :
 * elle est photographiée à ce moment-là (`memoizeSuperDetailScroll`, avant le
 * moindre déplacement de nœud). Le choix entre les deux est donc une décision,
 * et elle est ici :
 *   1. une seule photographie disponible → c'est elle (rien n'est inventé) ;
 *   2. l'utilisateur a REPRIS LA MAIN pendant le plein écran (il a remonté la
 *      conversation : geste observé sur l'écran où il se trouvait) → sa
 *      position du moment l'emporte, elle est plus récente et volontaire ;
 *   3. sinon → la position qu'il avait en quittant « Détaillé » : le bas s'il
 *      était en bas (il retrouve la fin, contenu nouveau compris), son passage
 *      s'il relisait (il n'est pas ramené en bas).
 *
 * @param {{top: number, atBottom: boolean}|null|undefined} snapshotDetaille
 *   photographie de « Détaillé » prise AVANT de le quitter
 * @param {{top: number, atBottom: boolean}|null|undefined} snapshotPleinEcran
 *   photographie prise à l'instant de la sortie du plein écran
 * @param {boolean} gesteDansLePleinEcran l'utilisateur a-t-il remonté la
 *   conversation PENDANT le plein écran ?
 * @returns {{top: number, atBottom: boolean}|null}
 */
export function conversationScrollReturnSnapshot(
  snapshotDetaille,
  snapshotPleinEcran,
  gesteDansLePleinEcran,
) {
  const detaille =
    snapshotDetaille && typeof snapshotDetaille === "object" ? snapshotDetaille : null;
  const pleinEcran =
    snapshotPleinEcran && typeof snapshotPleinEcran === "object" ? snapshotPleinEcran : null;
  if (!detaille) return pleinEcran;
  if (!pleinEcran) return detaille;
  if (gesteDansLePleinEcran === true) return pleinEcran;
  return detaille;
}

/**
 * Faut-il REPOSER la position au premier signal de RENDU (la correction du
 * défaut « la conversation repart tout en haut », revenu une seconde fois) ?
 *
 * Le pourquoi : la position ci-dessus est décidée sur `clientHeight` /
 * `scrollHeight` lus à l'instant de la sortie du plein écran. Cet instant n'est
 * pas toujours celui de la mise en page DÉFINITIVE (« Détaillé » remet en place
 * la barre de saisie, la rangée des questions et les nœuds du chat dans le même
 * tour). Si la géométrie est encore transitoire et que le contenu est alors
 * mesuré comme NON débordant (`scrollHeight <= clientHeight`), la décision rend
 * 0 et la conversation est écrite **tout en haut** — et rien ne la corrige
 * ensuite. La même décision, rejouée sur la géométrie réelle, rend le bas.
 *
 * Les trois règles, dans l'ordre :
 *   1. rien à restaurer / aucune position atteignable → `null` (aucune
 *      écriture inventée) ;
 *   2. la position déjà écrite est DÉJÀ celle que la mise en page demande →
 *      `null` : aucune écriture inutile, donc aucun clignotement ;
 *   3. l'utilisateur a repris la main (il a déplacé la conversation depuis
 *      notre écriture) et il ne cherchait pas le bas → `null` : on ne le
 *      ramène jamais de force. S'il cherchait le bas, le bas reste sa position.
 *
 * @param {{top: number, atBottom: boolean}|null|undefined} snapshot
 * @param {number} applied position réellement écrite (px)
 * @param {number} currentTop position de la conversation maintenant (px)
 * @param {number} clientHeight
 * @param {number} scrollHeight
 * @returns {number|null} position à reposer, ou `null` s'il n'y a rien à faire
 */
export function conversationScrollReplayTarget(
  snapshot,
  applied,
  currentTop,
  clientHeight,
  scrollHeight,
) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const cible = conversationScrollTarget(snapshot, clientHeight, scrollHeight);
  if (cible === null) return null;
  if (cible === nb(applied)) return null;
  if (snapshot.atBottom !== true && nb(currentTop) !== nb(applied)) return null;
  return cible;
}
