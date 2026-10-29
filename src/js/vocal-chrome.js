/**
 * vocal-chrome.js — LE BAS DE L'ECRAN VOCAL S'EFFACE AU REPOS.
 *
 * Source UNIQUE des decisions du masquage (CONCEPTION-ecran-vocal-cercle-et-bas.md
 * §2) : ce module est PUR (aucun DOM, aucune minuterie, aucun appel), il ne
 * decide que sur des faits qu'on lui donne. L'ecriture de la classe CSS, les
 * ecouteurs et l'unique minuteur vivent dans `super-agent.js`
 * (`vocalSyncChrome`), qui ne fait rien d'autre que d'appliquer ce que ce
 * module tranche.
 *
 * Les TROIS noeuds concernes, et eux seuls : la ligne d'etat, la zone de saisie,
 * le bouton de depannage du micro. Le disque, le bouton de relance, le logo
 * (bouton des trois modes) et l'entree « Travail » ne sont JAMAIS masques : le
 * CSS ne les nomme pas, et un test le verifie.
 */

/** Delai avant le REMASQUAGE, quand aucun geste ne vient : 2 500 ms. */
export const VOCAL_CHROME_IDLE_MS = 2500;

/**
 * Tolerance du pointeur : un deplacement cumule de 4 px depuis le dernier
 * reveil est un geste. Sous ce seuil, le tremblement d'une main posee ne
 * reveille rien.
 */
export const VOCAL_CHROME_MOVE_PX = 4;

/** La classe posee sur l'overlay quand le bas est efface (source unique). */
export const VOCAL_CHROME_HIDDEN_CLASS = "vocal-chrome-hidden";

/**
 * PEUT-ON effacer le bas ? PURE — l'ORDRE de ces quatre regles EST la spec.
 *
 * Rend `true` quand au moins une des quatre circonstances INTERDIT le
 * masquage — c'est-a-dire quand le bas doit rester a l'ecran :
 *
 *  1. **Le micro est ferme** (refus, absence, occupation, panne) : le bouton
 *     « Autoriser le micro » est le seul recours, il ne s'efface jamais.
 *  2. **Le champ de saisie est occupe** : il contient du texte (brouillon, ou
 *     dictee en cours de transcription) ou il a le focus.
 *  3. **Pilot ecoute ou parle** : pendant l'ecoute, la ligne d'etat est la seule
 *     chose qui dit que le micro est ouvert ; pendant la lecture, c'est elle qui
 *     dit que Pilot repond. Aucun des deux ne peut etre efface.
 *  4. **Le pointeur est sur la zone du bas** : on ne cache pas ce que la souris
 *     vise.
 *
 * Aucune autre circonstance ne retient le bas : au repos, champ vide et pointeur
 * ailleurs, le masquage est permis (et la dictee armee mais encore muette n'y
 * change rien — c'est le cas particulier voulu : l'ecran reste nu).
 *
 * @param {{etat?: string, saisie?: boolean, micFerme?: string|boolean, pointeurActif?: boolean}} [faits]
 * @returns {boolean} true = le bas reste visible (masquage interdit)
 */
export function vocalChromeVisible(faits = {}) {
  const f = faits || {};
  // 1. Micro ferme : le bouton de depannage ne s'efface jamais.
  if (String(f.micFerme == null ? "" : f.micFerme).trim() !== "") return true;
  // 2. Champ occupe (texte present ou focus dedans).
  if (f.saisie === true) return true;
  // 3. Pilot ecoute ou parle.
  if (f.etat === "listening" || f.etat === "speaking") return true;
  // 4. Pointeur sur la zone du bas.
  if (f.pointeurActif === true) return true;
  // Rien ne retient le bas : le masquage est permis.
  return false;
}

/**
 * La classe CSS a poser sur l'overlay. PURE.
 * `vocalChromeVisible` rend « le bas reste visible » : c'est son INVERSE qui
 * pose la classe — une seule correspondance, jamais deux.
 * @param {boolean} visible
 * @returns {string} `"vocal-chrome-hidden"` ou `""`
 */
export function vocalChromeClass(visible) {
  return visible === false ? VOCAL_CHROME_HIDDEN_CLASS : "";
}

/**
 * Cette touche reveille-t-elle le bas ? PURE.
 * Toute frappe reveille le bas, SAUF Echap : c'est la touche de sortie du mode
 * (§8), elle ne doit pas rallumer l'ecran au moment ou on le quitte.
 * @param {string} touche valeur de `KeyboardEvent.key`
 * @returns {boolean}
 */
export function vocalChromeWakeKey(touche) {
  const k = String(touche == null ? "" : touche);
  return !(k === "Escape" || k === "Esc");
}

/**
 * Le pointeur a-t-il bouge assez pour valoir un geste ? PURE.
 *
 * Distance entre la position courante et le REPERE (la derniere position qui a
 * reveille le bas, ou la position d'entree) : au-dela de `seuil`, c'est un geste.
 * Sans repere connu (premier mouvement apres l'entree du mode), on reveille —
 * l'ecran vient de s'ouvrir, son bas est visible de toute facon.
 *
 * @param {{x?: number, y?: number}} [courant]
 * @param {{x?: number, y?: number}|null} [repere]
 * @param {number} [seuil]
 * @returns {boolean}
 */
export function vocalChromeMoved(courant, repere, seuil = VOCAL_CHROME_MOVE_PX) {
  const c = courant || {};
  const x = Number(c.x);
  const y = Number(c.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const r = repere || null;
  const rx = r ? Number(r.x) : NaN;
  const ry = r ? Number(r.y) : NaN;
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return true;
  const s = Number.isFinite(seuil) && seuil > 0 ? seuil : VOCAL_CHROME_MOVE_PX;
  return Math.hypot(x - rx, y - ry) >= s;
}
