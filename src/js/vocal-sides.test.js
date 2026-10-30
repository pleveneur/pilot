// Tests — LOT 1 : LA LARGEUR DES DEUX COLONNES (`planVocalSides`).
//
// Source : docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md
// (§ 3.1 la formule, § 3.2 la hauteur, et le tableau de valeurs que la
// conception rejoue ligne par ligne — ici T10).
//
// CE QUE CE FICHIER VERROUILLE :
//   1. La formule, telle qu'elle est ecrite : `avail`, `nominal`, `track`,
//      `H` — aucune variante, aucune valeur inventee.
//   2. Le SEUIL : sous 240 px une colonne n'existe pas du tout.
//   3. Le tableau de la conception, ligne par ligne (le document fait foi).
//   4. La hauteur ne depend NI de la largeur des colonnes NI du nombre de
//      taches : elle ne bouge pas quand la largeur change.
//   5. Rien n'est ecrit, rien n'est invente : une entree absente ne fait pas
//      apparaitre de colonnes.
//   6. Le budget de hauteur, dans les TROIS cas de la zone d'image (correction
//      du 2026-10-31 : le personnage est en haut a droite, la liste dessous).

import { describe, it, expect } from "vitest";
import {
  planVocalSides,
  VOCAL_SIDE_MIN_PX,
  VOCAL_SIDE_MAX_PX,
  VOCAL_SIDE_WIDE_MAX_PX,
  VOCAL_SIDE_WIDE_AT_PX,
  VOCAL_SIDE_GAP_PX,
  VOCAL_SIDE_PAD_PX,
  VOCAL_SIDE_FIXED_PX,
  VOCAL_PORTRAIT_BLOCK_PX,
  VOCAL_CROWN_PX,
  VOCAL_ORB_BOX_RATIO,
  VOCAL_ORB_RESERVED_PX,
} from "./vocal-sides.js";

/** Les constantes du document, ecrites une fois, telles quelles. */
const MIN = 240;
const NOMINAL = 384;
const PLAFOND = 400;
const LARGE = 1600;
const JOUR = 24;
const MARGE = 16;
const RESERVE = 289;

/** La formule du § 3.1, rejouee a la main (elle ne lit pas le module). */
function attendu(width, orbSize, height) {
  const avail = Math.floor((width - orbSize - 2 * JOUR - 2 * MARGE) / 2);
  const nominal =
    width <= LARGE ? NOMINAL : Math.min(PLAFOND, NOMINAL + Math.round((width - LARGE) / 4));
  const track = avail < MIN ? 0 : Math.min(nominal, avail);
  const columnHeight = Math.round(Math.min(orbSize * (1 + (2 * 88) / 336), height - RESERVE));
  return { track, shown: track > 0, columnHeight };
}

describe("T10 — la largeur des colonnes, formule du § 3.1", () => {
  it("les constantes du module sont celles du document, sans arrondi", () => {
    expect(VOCAL_SIDE_MIN_PX).toBe(MIN);
    expect(VOCAL_SIDE_MAX_PX).toBe(NOMINAL);
    expect(VOCAL_SIDE_WIDE_MAX_PX).toBe(PLAFOND);
    expect(VOCAL_SIDE_WIDE_AT_PX).toBe(LARGE);
    expect(VOCAL_SIDE_GAP_PX).toBe(JOUR);
    expect(VOCAL_SIDE_PAD_PX).toBe(MARGE);
    expect(VOCAL_ORB_RESERVED_PX).toBe(RESERVE);
    // 512 / 336 : la couronne du halo est de 88 px pour un disque de 336 px.
    expect(VOCAL_ORB_BOX_RATIO).toBeCloseTo(512 / 336, 10);
  });

  it("le tableau du § 3.2, les ONZE lignes, au pixel pres", () => {
    // Fenetre, disque, boite, H, avail, track — les colonnes du document, dans
    // son ordre. `boite` ne sert qu'a la lecture : H est min(boite, 100vh - 289).
    const lignes = [
      [640, 480, 125.3, 217, 0],
      [720, 520, 151.6, 244, 244],
      [768, 576, 188.3, 249, 249],
      [820, 620, 217.2, 261, 261],
      [896, 672, 251.3, 282, 282],
      [1024, 768, 314.3, 314, 314],
      [1280, 800, 335.3, 432, NOMINAL],
      [1440, 900, 336, 512, NOMINAL],
      [1600, 900, 336, 592, NOMINAL],
      [1920, 1080, 336, 752, PLAFOND],
      [2560, 1440, 336, 1072, PLAFOND],
    ];
    for (const [largeur, hauteur, disque, avail, colonne] of lignes) {
      const plan = planVocalSides({ width: largeur, height: hauteur, orbSize: disque });
      expect(plan.track, `largeur ${largeur} : colonne`).toBe(colonne);
      expect(plan.shown, `largeur ${largeur} : colonnes presentes`).toBe(colonne > 0);
      // `avail` est ce qui reste pour UNE colonne : la moitie de la fenetre
      // moins le disque, les deux jours et les deux marges.
      const disponible = Math.floor((largeur - disque - 2 * JOUR - 2 * MARGE) / 2);
      expect(disponible, `largeur ${largeur} : avail`).toBe(avail);
    }
  });

  it("le seuil vaut 240 DANS LES DEUX SENS", () => {
    // 640 x 480 : avail = 217 px, sous le seuil -> aucune colonne du tout.
    expect(planVocalSides({ width: 640, height: 480, orbSize: 125.3 }).track).toBe(0);
    // 720 x 520 : avail = 244 px -> la colonne parait, et tient deja une tache
    // (H = 231, il reste 180 px de liste sous le haut fixe de 51 px).
    const juste = planVocalSides({ width: 720, height: 520, orbSize: 151.6 });
    expect(juste.track).toBe(244);
    expect(juste.columnHeight).toBe(231);
    expect(juste.listHeight).toBe(180);
  });

  it("la colonne des taches s'arrete AVANT la couronne du disque", () => {
    // La largeur de la colonne des taches n'est pas celle de la piste : elle
    // vaut la piste MOINS la couronne du halo, plus le jour que la grille compte
    // deja. 88 - 24 = 64 px en moins, quel que soit le disque.
    expect(VOCAL_CROWN_PX).toBe(88);
    for (const [largeur, disque] of [
      [1440, 336],
      [1280, 335.3],
      [1024, 314.3],
      [2560, 336],
    ]) {
      const plan = planVocalSides({ width: largeur, height: 900, orbSize: disque });
      expect(plan.taskTrack, `largeur ${largeur}`).toBe(plan.track - (88 - JOUR));
    }
    // Aucune colonne : aucune largeur de taches non plus (jamais de valeur
    // negative, meme quand la place manque).
    const aucune = planVocalSides({ width: 640, height: 480, orbSize: 125.3 });
    expect(aucune.track).toBe(0);
    expect(aucune.taskTrack).toBe(0);
    // Une piste plus etroite que la couronne ne rend jamais un nombre negatif.
    const etroite = planVocalSides({ width: 720, height: 520, orbSize: 151.6 });
    expect(etroite.track).toBe(244);
    expect(etroite.taskTrack).toBe(180);
  });

  it("la colonne ne depasse jamais la place disponible (`avail`)", () => {
    // 768 x 576 : avail = 249 px, donc la colonne est ECRASEE a 249 px et non
    // laissee a sa valeur nominale de 384.
    const etroit = planVocalSides({ width: 768, height: 576, orbSize: 188.3 });
    expect(etroit.track).toBe(249);
    expect(etroit.track).toBeLessThan(NOMINAL);
  });

  it("la formule du document et le module donnent le MEME resultat partout", () => {
    for (let largeur = 800; largeur <= 2600; largeur += 7) {
      for (const disque of [120, 200, 288, 336]) {
        const ici = planVocalSides({ width: largeur, height: 900, orbSize: disque });
        const doc = attendu(largeur, disque, 900);
        expect(ici.track, `largeur ${largeur}, disque ${disque}`).toBe(doc.track);
        expect(ici.columnHeight, `largeur ${largeur}, disque ${disque}`).toBe(
          doc.columnHeight,
        );
      }
    }
  });

  it("la hauteur ne depend NI de la largeur, NI du nombre de taches", () => {
    const etroit = planVocalSides({ width: 1200, height: 900, orbSize: 336 });
    const large = planVocalSides({ width: 2560, height: 900, orbSize: 336 });
    expect(etroit.columnHeight).toBe(large.columnHeight);
    // 336 + 2 x 88 = 512 px : la boite du disque, entierement disponible.
    expect(etroit.columnHeight).toBe(512);
    // La meme hauteur, que la fenetre du visage s'affiche ou non : la zone
    // d'image prend sa place DANS la colonne, elle ne l'allonge pas.
    expect(
      planVocalSides({ width: 1200, height: 900, orbSize: 336, hasAvatar: true })
        .columnHeight,
    ).toBe(etroit.columnHeight);
  });

  it("une fenetre basse ECORCHE la colonne, elle ne la fait pas deborder", () => {
    // 640 x 480 : la boite du disque vaudrait 191 px et la scene n'en offre que
    // 191 - c'est bien la fenetre qui decide, jamais la boite.
    const bas = planVocalSides({ width: 640, height: 480, orbSize: 125.3 });
    expect(bas.columnHeight).toBe(191);
    expect(bas.columnHeight).toBeLessThan(512);
  });

  it("la place laissee a la liste suit le haut fixe de la colonne", () => {
    // Le haut fixe : 14 + 11 + 14 (le titre) + 12 (l'air du bas) = 51 px. La ligne
    // d'activite n'est plus comptee, elle n'existe plus.
    expect(VOCAL_SIDE_FIXED_PX).toBe(39 + 12);
    const plan = planVocalSides({ width: 1280, height: 900, orbSize: 336 });
    expect(plan.listHeight).toBe(512 - VOCAL_SIDE_FIXED_PX);
    expect(plan.listHeight).toBe(461);
    // La fenetre du visage, quand elle s'affiche, prend sa place sur ce total.
    const avecAvatar = planVocalSides({ width: 1280, height: 900, orbSize: 336, hasAvatar: true });
    expect(avecAvatar.listHeight).toBe(512 - VOCAL_SIDE_FIXED_PX - 180);
    // Jamais de valeur negative, meme quand la fenetre est minuscule.
    expect(planVocalSides({ width: 1280, height: 120, orbSize: 336 }).listHeight).toBe(0);
  });

  it("le PERSONNAGE, en haut a droite, prend la place de son bloc mesure (148 px au plancher)", () => {
    // Correction du 2026-10-31 : l'image est revenue en tete de la colonne, donc
    // la colonne lui reserve de nouveau sa place — medaillon (96 px au plancher,
    // depuis la remarque du proprietaire du 2026-10-03), ecart (8), nom sous
    // l'image (20), l'AIR qui detache le personnage de la liste (12) et l'AIR qui
    // le detache du cadre (12 depuis le 2026-11-02). Le disque ne porte rien.
    // La taille, elle, est MESUREE : le bloc vaut `taille + 52`.
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(12 + 96 + 8 + 20 + 12);
    const avec = planVocalSides({
      width: 1280,
      height: 900,
      orbSize: 336,
      hasPortrait: true,
    });
    expect(avec.hasPortrait).toBe(true);
    expect(avec.portraitSize).toBe(277);
    expect(avec.portraitBlock).toBe(329);
    expect(avec.listHeight).toBe(512 - VOCAL_SIDE_FIXED_PX - 329);
    expect(avec.listHeight).toBe(132);
    // Le personnage l'emporte : pas de fenetre du visage en plus, et la zone
    // d'image ne reserve alors AUCUNE place vide (le medaillon est un vrai noeud).
    expect(avec.imageZone.kind).toBe("portrait");
    expect(avec.imageZone.height).toBe(0);
    expect(
      planVocalSides({ width: 1280, height: 900, orbSize: 336, hasPortrait: true, hasAvatar: true })
        .listHeight,
    ).toBe(132);
  });

  it("aucune entree : aucune colonne, aucune erreur, aucune valeur inventee", () => {
    for (const entrees of [undefined, {}, { width: NaN, height: NaN, orbSize: NaN }]) {
      const plan = planVocalSides(entrees);
      expect(plan.track).toBe(0);
      expect(plan.shown).toBe(false);
      expect(plan.columnHeight).toBe(0);
      expect(plan.listHeight).toBe(0);
    }
  });
});
