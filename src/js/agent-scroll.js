// agent-scroll.js — suivi du bas dans la conversation d'un agent (pur, testable).
//
// L'onglet d'un agent doit suivre la conversation comme une messagerie : il
// descend en bas quand du contenu arrive, MAIS seulement si l'utilisateur y est
// déjà — s'il a remonté volontairement pour relire, on ne l'arrache pas de sa
// lecture (issue #60).
//
// Défaut corrigé : la décision était recalculée APRÈS l'ajout du contenu. Un
// gros bloc (message long, résultat d'outil) augmente `scrollHeight` de plus
// que le seuil → le calcul croyait que l'utilisateur avait remonté et coupait
// le suivi : l'onglet restait figé sur un ancien moment. De plus, dans un
// onglet masqué (`display:none`), `clientHeight`/`scrollHeight` valent 0 : le
// scroll ne pouvait pas être appliqué et rien ne le rattrapait à la réouverture.
//
// L'intention est donc mémorisée sur le conteneur (`_agentAtBottom`, ré-armé
// par le listener `scroll`) : le suivi persiste tant que l'utilisateur n'est
// pas remonté, quel que soit le volume de contenu arrivé.

export const SCROLL_BOTTOM_THRESHOLD = 60;

/**
 * Décision pure : le conteneur doit-il suivre le bas ?
 * Si une intention est mémorisée (`_agentAtBottom`), elle prime (elle survit à
 * l'ajout de contenu et à un onglet masqué). Sinon, calcul ponctuel sur la
 * position courante (conteneurs sans listener, comportement d'origine).
 * @param {{scrollTop:number, clientHeight:number, scrollHeight:number, _agentAtBottom?:boolean}|null} container
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function shouldFollowBottom(container, threshold = SCROLL_BOTTOM_THRESHOLD) {
  if (!container) return false;
  if (typeof container._agentAtBottom === "boolean") return container._agentAtBottom;
  return container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
}

/**
 * Met à jour l'intention mémorisée à partir de la position courante (listener
 * `scroll`). Un conteneur masqué (hauteur nulle) ne fournit aucune position
 * fiable : on conserve l'intention existante au lieu de la désarmer.
 * @param {{scrollTop:number, clientHeight:number, scrollHeight:number, _agentAtBottom?:boolean}|null} container
 * @param {number} [threshold]
 * @returns {boolean} intention après mise à jour
 */
export function updateFollowBottomFlag(container, threshold = SCROLL_BOTTOM_THRESHOLD) {
  if (!container) return false;
  if (container.clientHeight === 0) return container._agentAtBottom !== false;
  const atBottom =
    container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
  container._agentAtBottom = atBottom;
  return atBottom;
}
