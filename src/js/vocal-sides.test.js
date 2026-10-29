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
  VOCAL_PORTRAIT_PX,
  VOCAL_ORB_BOX_RATIO,
  VOCAL_ORB_RESERVED_PX,
} from "./vocal-sides.js";

/** Les constantes du document, ecrites une fois, telles quelles. */
const MIN = 240;
const NOMINAL = 320;
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
    // (H = 231, il reste 61 px de liste sous le haut fixe de 170 px).
    const juste = planVocalSides({ width: 720, height: 520, orbSize: 151.6, hasPortrait: true });
    expect(juste.track).toBe(244);
    expect(juste.columnHeight).toBe(231);
    expect(juste.listHeight).toBe(61);
  });

  it("la colonne ne depasse jamais la place disponible (`avail`)", () => {
    // 768 x 576 : avail = 249 px, donc la colonne est ECRASEE a 249 px et non
    // laissee a sa valeur nominale de 320.
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
    // La meme hauteur, que le personnage existe ou non.
    expect(
      planVocalSides({ width: 1200, height: 900, orbSize: 336, hasPortrait: true })
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
    const avec = planVocalSides({ width: 1280, height: 900, orbSize: 336, hasPortrait: true });
    const sans = planVocalSides({ width: 1280, height: 900, orbSize: 336, hasPortrait: false });
    // 170 px quand un personnage occupe le haut de la colonne, 72 px sans lui.
    expect(VOCAL_SIDE_FIXED_PX).toBe(170);
    expect(VOCAL_PORTRAIT_PX).toBe(72);
    expect(avec.listHeight).toBe(512 - VOCAL_SIDE_FIXED_PX);
    expect(sans.listHeight).toBe(512 - VOCAL_PORTRAIT_PX);
    // Jamais de valeur negative, meme quand la fenetre est minuscule.
    expect(planVocalSides({ width: 1280, height: 120, orbSize: 336 }).listHeight).toBe(0);
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
