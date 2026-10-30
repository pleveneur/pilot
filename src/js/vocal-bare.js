// vocal-bare.js — L'ETAT NU DE L'ECRAN VOCAL : tout masquer sauf le portrait.
//
// Decision du proprietaire tranchee le 2026-10-29 (decision 9, section 6 de
// docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md) : un SEUL
// petit bouton, present dans l'ecran Vocal et la seulement, masque tout ce que
// l'ecran affiche — SAUF le portrait du personnage — puis remet tout en place du
// meme geste.
//
// Ce module ne touche a AUCUN noeud : il ne fait que DIRE ce que le bouton et
// l'overlay doivent etre pour un etat donne (libelle, icone, aria-pressed,
// classe). La peinture appartient a `vocalSyncBare()` (super-agent.js), seul
// ecrivain, et l'aspect a la feuille de style. Aucun etat n'est memorise ici :
// le booleen vit en memoire dans l'ecran et repart a « tout visible » a chaque
// entree (section 6.6 : l'ecran Vocal est un mode, pas une preference).

// La classe d'etat posee sur l'overlay. Une seule, et elle n'a aucun rapport
// avec `vocal-chrome-hidden` (l'effacement du bas au repos) : les deux peuvent
// etre posees en meme temps sans se contredire.
export const VOCAL_BARE_CLASS = "vocal-bare";

// La classe du bouton. Elle sert aussi au TEST et au CSS : elle n'est jamais
// ecrite deux fois ailleurs dans le code.
export const VOCAL_DISPLAY_TOGGLE_CLASS = "vocal-display-toggle";

// LES DEUX LIBELLES, MOT POUR MOT (section 6.4). Ils vont au `title` ET a
// l'`aria-label` : l'ETAT d'abord, l'ACTION ensuite. Le mot est « le portrait »,
// jamais « le personnage » : c'est plus court dans une infobulle.
export const VOCAL_BARE_LABEL_VISIBLE =
  "tout est visible — cliquer pour ne garder que le portrait";
export const VOCAL_BARE_LABEL_HIDDEN =
  "tout est masqué — cliquer pour tout réafficher";

// L'icone de Lucide deja disponible dans le projet : la paire de tous les
// logiciels, aucune legende a apprendre, aucune icone a dessiner.
export const VOCAL_BARE_ICON_VISIBLE = "eye";
export const VOCAL_BARE_ICON_HIDDEN = "eye-off";

// La duree du fondu, en millisecondes. C'est `--transition` (0,18 s) cote CSS :
// la valeur est ecrite ici pour que le test puisse la nommer, et la feuille de
// style ne fait que la reprendre.
export const VOCAL_BARE_FADE_MS = 180;

/**
 * Ramene une valeur quelconque au booleen de l'etat nu. Tout ce qui n'est pas
 * explicitement vrai vaut « tout visible » : un etat illisible ne doit jamais
 * laisser l'ecran masque.
 * @param {unknown} valeur
 * @returns {boolean} vrai = tout est masque (seul le portrait reste)
 */
export function normalizeVocalBare(valeur) {
  return valeur === true;
}

/**
 * Le libelle (infobulle ET nom accessible) de l'etat courant.
 * @param {unknown} bare etat nu
 * @returns {string} la phrase, mot pour mot
 */
export function vocalBareLabel(bare) {
  return normalizeVocalBare(bare) ? VOCAL_BARE_LABEL_HIDDEN : VOCAL_BARE_LABEL_VISIBLE;
}

/**
 * La valeur de `aria-pressed` : vrai quand tout est visible, faux quand tout est
 * masque (section 6.10, point 2). Le bouton est un interrupteur dont l'etat
 * « enfonce » est l'affichage complet.
 * @param {unknown} bare etat nu
 * @returns {boolean}
 */
export function vocalBarePressed(bare) {
  return !normalizeVocalBare(bare);
}

/**
 * Le nom de l'icone Lucide : oeil ouvert quand tout est visible, oeil barre
 * quand tout est masque.
 * @param {unknown} bare etat nu
 * @returns {string}
 */
export function vocalBareIcon(bare) {
  return normalizeVocalBare(bare) ? VOCAL_BARE_ICON_HIDDEN : VOCAL_BARE_ICON_VISIBLE;
}

/**
 * La classe a poser sur l'overlay ("" = a retirer). Une chaine vide plutot qu'un
 * booleen : `classList.toggle(classe, Boolean)` accepte les deux, mais la chaine
 * dit exactement ce qui est ecrit dans le document.
 * @param {unknown} bare etat nu
 * @returns {string}
 */
export function vocalBareClass(bare) {
  return normalizeVocalBare(bare) ? VOCAL_BARE_CLASS : "";
}

/**
 * L'etat d'apres un geste sur le bouton : la bascule, aller-retour. C'est le
 * SEUL calcul du clic — le reste suit (`vocalBareLabel`, `vocalBareIcon`,
 * `vocalBarePressed`, `vocalBareClass`).
 * @param {unknown} bare etat nu courant
 * @returns {boolean} l'etat d'apres
 */
export function vocalBareNext(bare) {
  return !normalizeVocalBare(bare);
}
