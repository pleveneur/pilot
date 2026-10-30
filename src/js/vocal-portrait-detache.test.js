// Tests — REMARQUE DU PROPRIETAIRE DU 2026-10-03, point 4 : « le portrait est trop
// petit et il semble appartenir a la liste des taches ; il doit etre plus grand et
// nettement detache, visiblement au-dessus de la liste ».
// (docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md, puis
// docs/rapports/RAPPORT-remarques-ecran-vocal-20261003.md § 4.)
//
// CE QUE CE FICHIER VERROUILLE :
//   R1 — la TAILLE, dans les deux endroits qui la lisent (feuille de style et
//        budget de la colonne), et l'egalite entre les deux : le medaillon de
//        96 px est plus large que DEUX rangees de liste.
//   R2 — le DETACHEMENT : 8 px sous l'image et 12 px d'AIR sous le nom, sans
//        filet, sans cadre, sans ombre — l'ecran n'en porte aucun.
//   R3 — l'APPARTENANCE : le titre « TACHES » n'est plus le premier noeud de la
//        colonne, il OUVRE la section des taches. L'ordre du document devient
//        portrait, son nom, l'air, « TACHES », zone d'image, liste — donc le
//        personnage surplombe la section au lieu d'y figurer.
//   R4 — l'ETAT NU et le clic : le portrait reste affiche quand tout est masque
//        (il est la seule chose que l'etat nu ne masque pas) et il ne prend
//        jamais le clic (la colonne entiere est traversante).
//   R5 — la place prise est PAYEE, pas volee : elle sort de la liste, elle ne
//        deforme ni la colonne ni le disque.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  VOCAL_PORTRAIT_AIR_PX,
  VOCAL_PORTRAIT_AIR_TOP_PX,
  VOCAL_PORTRAIT_BLOCK_PX,
  VOCAL_PORTRAIT_EDGE_PX,
  VOCAL_PORTRAIT_GAP_PX,
  VOCAL_PORTRAIT_NAME_PX,
  VOCAL_PORTRAIT_PX,
  VOCAL_PORTRAIT_TARGET_PX,
  VOCAL_SIDE_FRAME_PX,
  VOCAL_TASK_PX,
  planVocalSides,
  vocalPortraitBlockSize,
  vocalPortraitSize,
  vocalTaskRows,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Regle CSS d'un selecteur, accolades exclues (decoupage verifie). */
function regle(selecteur, mini = 10) {
  return sliceSource(CSS, `${selecteur} {`, "}", mini);
}

const PORTRAIT = regle(".vocal-portrait", 60);
const NOM = regle(".vocal-portrait-name", 60);

describe("R1 — le portrait est plus grand, et les deux sources disent le meme chiffre", () => {
  it("le PLANCHER de 96 px est dans la feuille de style COMME dans le budget", () => {
    expect(VOCAL_PORTRAIT_PX).toBe(96);
    // La taille n'est plus un chiffre fige : elle est MESUREE (remarque du
    // proprietaire du 2026-11-02, « environ trois fois plus grand") et posee par
    // `vocalSyncSides` dans `--vocal-portrait-size`. La feuille de style lit ce
    // jeton, avec le planCHER en repli — le meme chiffre que le budget.
    expect(PORTRAIT).toMatch(/width:\s*var\(--vocal-portrait-size,\s*96px\)/);
    expect(PORTRAIT).toMatch(/height:\s*var\(--vocal-portrait-size,\s*96px\)/);
    expect(PORTRAIT).toContain(`${VOCAL_PORTRAIT_PX}px`);
    // Et la cible de la remarque est bien trois fois ce plancher.
    expect(VOCAL_PORTRAIT_TARGET_PX).toBe(3 * VOCAL_PORTRAIT_PX);
    expect(VOCAL_PORTRAIT_TARGET_PX).toBe(288);
  });

  it("la taille MESUREE ne depasse jamais la place, et ne descend pas sous le plancher", () => {
    // Trois bornes, dans cet ordre : la place dans le cadre (marge comprise), la
    // hauteur qui laisse trois rangees a la liste, la cible.
    const grand = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasPortrait: true });
    expect(grand.portraitSize).toBe(214);
    expect(grand.portraitSize).toBeLessThan(VOCAL_PORTRAIT_TARGET_PX);
    // 214 px tiennent dans le contenu de la colonne, marge de chaque cote :
    // 256 - 22 - 2 x 10 = 214. Le medaillon ne touche donc jamais le cadre.
    expect(grand.portraitSize).toBe(
      grand.taskTrack - VOCAL_SIDE_FRAME_PX - 2 * VOCAL_PORTRAIT_EDGE_PX,
    );
    // Une colonne large mais une fenetre basse : c'est la HAUTEUR qui borne, et
    // la liste garde ses trois rangees.
    const bas = planVocalSides({ width: 1024, height: 768, orbSize: 314.3, hasPortrait: true });
    expect(bas.portraitSize).toBe(198);
    expect(vocalTaskRows(bas.listHeight).rows).toBe(3);
    // Jamais sous le plancher, jamais au-dela de la place : une colonne de 40 px
    // ne porte pas de medaillon du tout.
    expect(vocalPortraitSize({ taskTrack: 40, columnHeight: 512 })).toBe(0);
    expect(vocalPortraitSize({ taskTrack: 200, columnHeight: 512 })).toBe(158);
    expect(vocalPortraitSize({ taskTrack: 0, columnHeight: 512 })).toBe(0);
    expect(vocalPortraitSize({ taskTrack: NaN, columnHeight: 512 })).toBe(0);
    expect(vocalPortraitSize({ taskTrack: 256, columnHeight: 0 })).toBe(0);
  });

  it("il est plus large que DEUX rangees de liste : il ne se lit pas comme une entree", () => {
    // C'est la formulation de la remarque : « on dirait qu'il appartient a la
    // liste ». Une entree de liste fait 46 px ; un medaillon de 96 px en couvre
    // deux — il se lit donc comme le personnage, pas comme une ligne.
    expect(VOCAL_TASK_PX).toBe(46);
    expect(VOCAL_PORTRAIT_PX).toBeGreaterThanOrEqual(2 * VOCAL_TASK_PX);
    // Et il tient dans une colonne, sans la remplir : il laisse de l'air autour.
    const plan = planVocalSides({ width: 1440, height: 900, orbSize: 336 });
    expect(VOCAL_PORTRAIT_PX).toBeLessThan(plan.taskTrack / 2);
  });
});

describe("R2 — il est DETACHE, sans ajouter de trait", () => {
  it("8 px sous l'image, 12 px d'AIR sous le nom", () => {
    expect(VOCAL_PORTRAIT_GAP_PX).toBe(8);
    expect(VOCAL_PORTRAIT_AIR_PX).toBe(12);
    expect(NOM).toMatch(/margin-block:\s*8px 12px/);
    expect(NOM).toContain(`${VOCAL_PORTRAIT_GAP_PX}px ${VOCAL_PORTRAIT_AIR_PX}px`);
  });

  it("le bloc du personnage vaut la somme exacte de ses parties", () => {
    // L'air du haut (12) est entre dans le bloc le 2026-11-02 : le medaillon ne
    // touche plus le cadre.
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(
      VOCAL_PORTRAIT_AIR_TOP_PX +
        VOCAL_PORTRAIT_PX +
        VOCAL_PORTRAIT_GAP_PX +
        VOCAL_PORTRAIT_NAME_PX +
        VOCAL_PORTRAIT_AIR_PX,
    );
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(148);
    expect(VOCAL_PORTRAIT_AIR_TOP_PX).toBe(VOCAL_PORTRAIT_AIR_PX);
    // Une seule decomposition, lue par la feuille de style et par le budget.
    expect(vocalPortraitBlockSize(VOCAL_PORTRAIT_PX)).toBe(VOCAL_PORTRAIT_BLOCK_PX);
    expect(vocalPortraitBlockSize(214)).toBe(266);
    expect(vocalPortraitBlockSize(0)).toBe(0);
  });

  it("aucun filet, aucun cadre, aucune ombre : le detachement vient de la taille et de l'air", () => {
    // L'ecran ne porte aucune bordure : en ajouter une pour « detacher » le
    // portrait aurait ete un decor de plus, et une couleur de plus.
    expect(PORTRAIT).not.toMatch(/border(?!-radius)/);
    expect(PORTRAIT).not.toMatch(/outline/);
    expect(PORTRAIT).not.toMatch(/box-shadow/);
    expect(NOM).not.toMatch(/border(?!-radius)/);
    // Rond, garni : le medaillon reste un medaillon.
    expect(PORTRAIT).toMatch(/border-radius:\s*50%/);
    expect(PORTRAIT).toMatch(/object-fit:\s*cover/);
  });
});

describe("R3 — le portrait n'appartient plus a la section des taches", () => {
  it("le titre « TACHES » est pose AU-DESSUS DE LA LISTE, pas en tete de colonne", () => {
    // Le changement de place du titre EST le detachement : le portrait, qui reste
    // en tete de colonne, n'est plus suivi immediatement par le titre de la
    // section des taches — il la surplombe.
    const rendu = sliceSource(SUPER, "function vocalRenderColumn(plan)", "buildVocalTasksHtml(vu)", 400);
    expect(rendu).toMatch(/vocalColumnNode\(colonne, "\.vocal-tasks-title", "above-list"\)/);
    expect(rendu).not.toMatch(/vocalColumnNode\(colonne, "\.vocal-tasks-title", "first"\)/);
  });

  it("`above-list` insere le noeud JUSTE AVANT la liste", () => {
    const noeud = sliceSource(SUPER, "function vocalColumnNode(colonne, selecteur, place)", "\n}", 400);
    // La liste est le point d'insertion : le titre se pose devant elle.
    expect(noeud).toContain('colonne.querySelector(".vocal-side-body")');
    expect(noeud).toContain("colonne.insertBefore(noeud, liste)");
    // Les deux autres places existent toujours : la fonction n'a pas ete scindee
    // en trois fonctions (un seul point d'insertion, trois places).
    expect(noeud).toMatch(/place === "first"/);
    expect(noeud).toMatch(/colonne\.appendChild\(noeud\)/);
  });

  it("la zone d'image se pose entre le titre et la liste", () => {
    // Consequence de R3 : `vocalImageZoneNode` s'insere apres le titre. L'ordre
    // peint est donc portrait, nom, air, titre, zone, liste — sans trou.
    const zone = sliceSource(SUPER, "function vocalImageZoneNode(colonne)", "\n}", 200);
    expect(zone).toContain('colonne.querySelector(".vocal-tasks-title")');
    expect(zone).toContain("colonne.insertBefore(noeud, titre ? titre.nextSibling : colonne.firstChild)");
  });

  it("le portrait est cree AVANT le titre dans le balisage de l'overlay", () => {
    // L'ordre du document est celui du balisage statique : le portrait est dans la
    // colonne des taches des sa creation, et le titre est cree ensuite par la
    // repeinture, devant la liste — donc apres lui.
    const ov = sliceSource(SUPER, 'class="vocal-side-tasks vocal-side"', "class=\"vocal-side-body", 100);
    expect(ov).toContain('<img class="vocal-portrait" alt="" hidden />');
    expect(ov).not.toContain("vocal-tasks-title");
  });
});

describe("R4 — il reste affiche quand tout est masque, et ne prend jamais le clic", () => {
  it("l'etat nu ne masque ni le portrait ni son nom", () => {
    // Le bloc de l'etat nu est lu en entier : il ne doit citer NI l'un NI l'autre.
    // Les COMMENTAIRES sont neutralises : celui qui precede le bloc NOMME le
    // portrait et son nom pour dire qu'il ne les touche pas — c'est la REGLE qui
    // compte, pas la phrase qui explique pourquoi il n'y en a pas.
    const nu = neutraliserSource(
      sliceSource(
        CSS,
        ".pilot-vocal.vocal-bare .vocal-mic-fix,",
        "transition: opacity var(--transition), visibility 0s linear 180ms;",
        100,
      ),
    );
    expect(nu).not.toContain(".vocal-portrait");
    expect(nu).not.toContain(".vocal-portrait-name");
  });

  it("il ne recoit aucun clic", () => {
    expect(PORTRAIT).toMatch(/pointer-events:\s*none/);
    expect(NOM).toMatch(/pointer-events:\s*none/);
    expect(NOM).not.toMatch(/pointer-events:\s*auto/);
  });
});

describe("R5 — la place prise est payee par la LISTE, pas par la colonne", () => {
  it("le bloc sort de la hauteur de la liste, la colonne garde la sienne", () => {
    const base = { width: 1440, height: 900, orbSize: 336 };
    const sans = planVocalSides(base);
    const avec = planVocalSides({ ...base, hasPortrait: true });
    // Meme colonne : seule la LISTE perd le bloc du personnage, qui mesure la
    // taille reelle du medaillon (214 + 52 = 266 px), pas le plancher.
    expect(avec.columnHeight).toBe(sans.columnHeight);
    expect(avec.portraitBlock).toBe(avec.portraitSize + 52);
    expect(avec.listHeight).toBe(sans.listHeight - avec.portraitBlock);
    expect(avec.listHeight).toBe(512 - 51 - 266);
  });

  it("la liste garde au moins une rangee dans la plus petite fenetre", () => {
    // Une place gagnee en ecrasant la liste serait une regression : sous une
    // rangee, la colonne n'aurait plus rien a montrer. A 720 x 520 il reste
    // 231 - 51 - 148 = 32 px, soit UNE rangee (46 px de haut, mais 32 px de
    // place : la rangee est rognee d'autant, jamais absente) — c'est le cas
    // limite assume et documente au § 4 du rapport. Le medaillon, lui, reste au
    // plancher : c'est la HAUTEUR qui le borne, pas la place en largeur.
    const plan = planVocalSides({ width: 720, height: 520, orbSize: 151.6, hasPortrait: true });
    expect(plan.portraitSize).toBe(96);
    expect(plan.listHeight).toBe(32);
    expect(plan.listHeight).toBeGreaterThan(0);
    // Et la colonne n'est jamais vide : le personnage occupe le haut.
    expect(plan.columnHeight).toBe(231);
  });
});
