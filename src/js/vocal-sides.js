// vocal-sides.js — LOT 1 de l'ecran Vocal : la LARGEUR des deux colonnes
// laterales, en une seule formule PURE.
//
// Source : docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md
// (§ 2.4 pour les noms, § 3.1 pour la formule, § 3.2 pour le tableau que le
// test T10 rejoue ligne par ligne).
//
// Aucun DOM, aucun import Tauri, aucune ecriture : ce module ne fait que
// calculer. Le seul ecrivain de la valeur `track` est `vocalSyncSides()`
// (super-agent.js), qui la pose en `--vocal-side` sur l'overlay.
//
// LES NOMBRES, ET D'OU ILS VIENNENT (aucune valeur inventee) :
//   320 px   largeur d'une colonne sous 1600 px de fenetre — 42 caracteres a
//            13 px, une ligne de texte lisible et pas un mot par ligne ;
//   400 px   plafond, atteint a 1920 px (0,25 px de plus par pixel de fenetre
//            au-dela de 1600) — 52 caracteres ;
//   240 px   seuil de presence, LE MEME DANS LES DEUX SENS : 72 (portrait) +
//            6 + 20 (nom) + 14 + 14 (titre) + 14 + 20 (en-tete de groupe) +
//            46 (une tache) + 12 + 18 (ligne d'activite) = 236, arrondis a 240 ;
//   24 px    jour de chaque cote du disque (le `column-gap` de la grille) ;
//   16 px    marge de chaque cote de l'ecran (le `padding` de la scene) ;
//   289 px   ce que le reste de l'ecran prend en hauteur (36 onglets + 44 barre
//            + 80 ligne d'etat + 60 saisie + 69 respirations) — le meme nombre
//            que `--vocal-orb-size` dans la feuille de style ;
//   88 / 336 la couronne du halo, en fraction du disque (jeton `--vocal-crown`).
// Les deux derniers existent DEJA : ce module les lit, il ne les invente pas.

/** Largeur minimale d'une colonne pour qu'elle apparaisse (seuil de decision 7). */
export const VOCAL_SIDE_MIN_PX = 240;
/** Largeur nominale d'une colonne tant que la fenetre fait 1600 px ou moins. */
export const VOCAL_SIDE_MAX_PX = 320;
/** Plafond de largeur, atteint a 1920 px de fenetre. */
export const VOCAL_SIDE_WIDE_MAX_PX = 400;
/** Largeur de fenetre a partir de laquelle les colonnes commencent a s'elargir. */
export const VOCAL_SIDE_WIDE_AT_PX = 1600;
/** Jour de chaque cote du disque, en px (`column-gap` de la scene). */
export const VOCAL_SIDE_GAP_PX = 24;
/** Marge de chaque cote de l'ecran, en px (`padding` de la scene). */
export const VOCAL_SIDE_PAD_PX = 16;
/** Hauteur du medaillon du personnage, en px. */
export const VOCAL_PORTRAIT_PX = 72;
/** Hauteur d'une tache dans la liste, en px (lot 2). */
export const VOCAL_TASK_PX = 46;
/** Hauteur d'un en-tete de groupe de la liste, en px (lot 2). */
export const VOCAL_TASK_HEADER_PX = 20;
/**
 * Total fixe du haut de la colonne QUAND un personnage est affiche :
 * 14 + 14 + 14 (titre et marges) + 72 (portrait) + 6 (ecart du nom) +
 * 20 (nom) + 12 + 18 (ligne d'activite) = 170 px. C'est ce total qui garantit
 * qu'un personnage actif ne coute pas un pixel de plus a la colonne.
 */
export const VOCAL_SIDE_FIXED_PX = 170;
/** Rapport boite / disque : 336 + 2 x 88 = 512 px de boite pour 336 de disque. */
export const VOCAL_ORB_BOX_RATIO = 1 + (2 * 88) / 336;
/** Placement vertical du disque dans la scene (hors flux : couronnes comprises). */
export const VOCAL_ORB_RESERVED_PX = 289;

/**
 * La largeur des deux colonnes, et la hauteur dont elles disposent.
 *
 * @param {object} entrees
 * @param {number} entrees.width    largeur de la fenetre, en px
 * @param {number} entrees.height   hauteur de la fenetre, en px
 * @param {number} entrees.orbSize  diametre du disque, en px (`--vocal-orb-size`)
 * @param {boolean} [entrees.hasPortrait] un portrait affichable existe-t-il
 * @returns {{track:number, shown:boolean, columnHeight:number, listHeight:number}}
 *   `track` = largeur d'UNE colonne (0 = colonnes absentes), `shown` = les
 *   colonnes sont-elles affichees, `columnHeight` = hauteur de la colonne
 *   (`H`), `listHeight` = place laissee a la LISTE sous son haut fixe.
 */
export function planVocalSides({ width, height, orbSize, hasPortrait } = {}) {
  const largeur = Number(width);
  const hauteur = Number(height);
  const disque = Number(orbSize);
  const w = Number.isFinite(largeur) ? largeur : 0;
  const h = Number.isFinite(hauteur) ? hauteur : 0;
  const orb = Number.isFinite(disque) && disque > 0 ? disque : 0;

  // Ce qui reste pour les deux colonnes : la fenetre, moins le disque, moins
  // le jour de chaque cote du disque, moins la marge de chaque cote de l'ecran.
  const avail = Math.floor((w - orb - 2 * VOCAL_SIDE_GAP_PX - 2 * VOCAL_SIDE_PAD_PX) / 2);
  // Largeur nominale : 320 px jusqu'a 1600, puis 0,25 px par pixel de fenetre
  // (la moitie de la largeur ajoutee va aux colonnes, l'autre moitie aux jours
  // et aux marges — c'est ce qui laisse le disque EXACTEMENT au centre).
  const nominal =
    w <= VOCAL_SIDE_WIDE_AT_PX
      ? VOCAL_SIDE_MAX_PX
      : Math.min(
          VOCAL_SIDE_WIDE_MAX_PX,
          VOCAL_SIDE_MAX_PX + Math.round((w - VOCAL_SIDE_WIDE_AT_PX) / 4),
        );
  // Sous 240 px une colonne ne tient pas une tache : elle n'existe pas du tout.
  const track = avail < VOCAL_SIDE_MIN_PX ? 0 : Math.min(nominal, avail);

  // La hauteur des colonnes : la boite du disque, plafonnee par la place que la
  // fenetre offre reellement (jamais 512 px ecrases sur la ligne d'etat). Elle
  // ne depend NI de la largeur des colonnes NI du nombre de taches.
  const place = h - VOCAL_ORB_RESERVED_PX;
  const columnHeight = Math.max(0, Math.round(Math.min(orb * VOCAL_ORB_BOX_RATIO, place)));

  // Haut fixe de la colonne : 170 px avec un personnage, 72 px sans (il n'y a
  // alors ni portrait ni nom, et la liste prend toute la hauteur).
  const fixe = hasPortrait ? VOCAL_SIDE_FIXED_PX : VOCAL_PORTRAIT_PX;
  const listHeight = Math.max(0, columnHeight - fixe);

  return { track, shown: track > 0, columnHeight, listHeight };
}
