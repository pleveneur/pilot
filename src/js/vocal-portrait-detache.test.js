// Tests — REMARQUE DU PROPRIETAIRE DU 2026-10-03, point 4 : « le portrait est trop
// petit et il semble appartenir a la liste des taches ; il doit etre plus grand et
// nettement detache, visiblement au-dessus de la liste ».
// (docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md, puis
// docs/rapports/RAPPORT-remarques-ecran-vocal-20261003.md § 4.)
//
// PUIS REMARQUE DU 2026-11-13, point 7 : « le cercle en haut a sa taille, le
// personnage DESSOUS, sur le meme axe vertical, non rogne, avec une marge
// reelle ». Le portrait a donc QUITTE la colonne de droite : il vit sous le
// disque, dans la composition du milieu. Ce fichier a ete REECRIT (pas
// supprime) pour tenir compte de cette nouvelle place — les verrous qu'il
// portait n'ont pas disparu, ils mesurent la meme chose au bon endroit.
// Rapport : docs/rapports/RAPPORT-ecran-vocal-point7-cercle-photo.md.
//
// CE QUE CE FICHIER VERROUILLE :
//   R1 — la TAILLE, dans les deux endroits qui la lisent (feuille de style et
//        budget de la composition), et l'egalite entre les deux : le medaillon
//        est plus large que DEUX rangees de liste, et il ne depasse jamais la
//        place que la rangee lui laisse sous le disque.
//   R2 — le DETACHEMENT : 8 px sous l'image et 12 px d'AIR sous le nom, sans
//        filet, sans cadre, sans ombre — l'ecran n'en porte aucun.
//   R3 — l'APPARTENANCE : le portrait n'est plus dans la colonne des taches, ni
//        avant ni apres le titre ; il est SOUS LE DISQUE, dans `.vocal-center`,
//        apres le cercle dans l'ordre du document. Le titre « TACHES », lui,
//        ouvre toujours la section des taches.
//   R4 — l'ETAT NU et le clic : le portrait reste affiche quand tout est masque
//        (il est la seule chose que l'etat nu ne masque pas) et il ne prend
//        jamais le clic (la colonne entiere est traversante).
//   R5 — la place : elle n'est plus PAYEE par aucune colonne. La liste des
//        taches garde toute sa hauteur, avec ou sans personnage ; le medaillon
//        prend la place libre SOUS LE DISQUE, dans la rangee de la scene.
//   R6 — la VRAIE mesure : les sept fenetres du document, hauteur de rangee
//        mesuree au banc, taille rendue par le plan, et la cible de 3 x atteinte
//        la ou la hauteur la porte.
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
  VOCAL_PORTRAIT_FRAME_PX,
  VOCAL_PORTRAIT_GAP_PX,
  VOCAL_PORTRAIT_MIN_PX,
  VOCAL_PORTRAIT_NAME_PX,
  VOCAL_PORTRAIT_PX,
  VOCAL_PORTRAIT_TARGET_PX,
  VOCAL_STAGE_AIR_PX,
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

/**
 * LES SEPT FENETRES DU DOCUMENT, MESUREES AU BANC le 2026-11-13.
 *
 * `stageHeight` est la PREMIERE PISTE de `grid-template-rows` de
 * `.vocal-stage`, lue dans le navigateur (banc `.pi/tmp/mesure-vocal.html`) :
 * c'est la hauteur que `vocalStageRowHeight()` lit a l'execution, donc la seule
 * valeur qui compte pour le budget du medaillon. Elle vaut, dans cet ordre,
 * `hauteur - 207` : le repli `VOCAL_STAGE_RESERVED_PX` la retrouve a l'identique,
 * ce que le dernier test de R6 verifie.
 *
 * `portraitSize` est ce que le plan rend pour cette rangee — le chiffre REEL,
 * jamais arrondi en silence.
 */
const MESURES = [
  { width: 720, height: 520, orbSize: 151.6, stageHeight: 313, portraitSize: 97 },
  { width: 768, height: 576, orbSize: 188.3, stageHeight: 369, portraitSize: 116 },
  { width: 896, height: 672, orbSize: 251.3, stageHeight: 465, portraitSize: 149 },
  { width: 1024, height: 768, orbSize: 314.3, stageHeight: 561, portraitSize: 182 },
  { width: 1280, height: 800, orbSize: 335.3, stageHeight: 593, portraitSize: 193 },
  { width: 1440, height: 900, orbSize: 336, stageHeight: 693, portraitSize: 288 },
  { width: 1920, height: 1080, orbSize: 336, stageHeight: 873, portraitSize: 288 },
];

describe("R1 — le portrait est plus grand, et les deux sources disent le meme chiffre", () => {
  it("le PLANCHER de 96 px est dans la feuille de style COMME dans le budget", () => {
    expect(VOCAL_PORTRAIT_PX).toBe(96);
    // La taille n'est plus un chiffre fige : elle est MESUREE (remarque du
    // proprietaire du 2026-11-02, « environ trois fois plus grand ») et posee par
    // `vocalSyncSides` dans `--vocal-portrait-size`. La feuille de style lit ce
    // jeton, avec le PLANCHER en repli — le meme chiffre que le budget.
    expect(PORTRAIT).toMatch(/width:\s*var\(--vocal-portrait-size,\s*96px\)/);
    expect(PORTRAIT).toMatch(/height:\s*var\(--vocal-portrait-size,\s*96px\)/);
    expect(PORTRAIT).toContain(`${VOCAL_PORTRAIT_PX}px`);
    // Et la cible de la remarque est bien trois fois ce plancher.
    expect(VOCAL_PORTRAIT_TARGET_PX).toBe(3 * VOCAL_PORTRAIT_PX);
    expect(VOCAL_PORTRAIT_TARGET_PX).toBe(288);
  });

  it("la taille MESUREE est celle du tableau, et ne depasse jamais la place", () => {
    for (const cas of MESURES) {
      const plan = planVocalSides({ ...cas, hasPortrait: true });
      const nom = `${cas.width}x${cas.height}`;
      // Le chiffre rendu est celui qui a ete mesure au banc, au pixel.
      expect(plan.portraitSize, `${nom} : taille mesuree`).toBe(cas.portraitSize);
      // Aucune des quatre bornes n'est depassee : la cible, le disque qu'il
      // surmonte (un medaillon plus large que le cercle ne serait plus
      // « sous le cercle »), et la place de la rangee.
      expect(plan.portraitSize, `${nom} : cible`).toBeLessThanOrEqual(VOCAL_PORTRAIT_TARGET_PX);
      expect(plan.portraitSize, `${nom} : largeur du disque`).toBeLessThanOrEqual(cas.orbSize);
      // La composition ENTIERE (air du haut + disque + bloc du personnage)
      // tient dans la rangee : rien ne deborde sur la barre du haut ni sur la
      // ligne d'etat.
      expect(
        VOCAL_STAGE_AIR_PX + cas.orbSize + vocalPortraitBlockSize(plan.portraitSize),
        `${nom} : la composition deborde de la rangee`,
      ).toBeLessThanOrEqual(cas.stageHeight);
    }
  });

  it("sous le plancher visible, le medaillon prend ce qu'il y a — ou disparait", () => {
    // Entre 56 et 96 px de place, le medaillon s'affiche quand meme : il prend
    // ce que la rangee donne, et le nom reste lisible dessous.
    expect(vocalPortraitSize({ orbSize: 336, stageHeight: 500 })).toBe(100);
    expect(vocalPortraitSize({ orbSize: 336, stageHeight: 456 })).toBe(VOCAL_PORTRAIT_MIN_PX);
    // En dessous de 56 px ce n'est plus un portrait mais un timbre-poste sous un
    // grand cercle : le module rend 0, et la composition se reduit au disque.
    expect(vocalPortraitSize({ orbSize: 336, stageHeight: 455 })).toBe(0);
    // Rien a mesurer : aucune valeur inventee.
    expect(vocalPortraitSize({})).toBe(0);
    expect(vocalPortraitSize({ orbSize: 0, stageHeight: 900 })).toBe(0);
    expect(vocalPortraitSize({ orbSize: 336, stageHeight: 0 })).toBe(0);
    expect(vocalPortraitSize({ orbSize: 336, stageHeight: NaN })).toBe(0);
  });

  it("il est plus large que DEUX rangees de liste : il ne se lit pas comme une entree", () => {
    // C'est la formulation de la remarque : « on dirait qu'il appartient a la
    // liste ». Une entree de liste fait 46 px ; un medaillon de 96 px en couvre
    // deux — il se lit donc comme le personnage, pas comme une ligne. Et toutes
    // les tailles mesurees restent au-dessus de ce seuil.
    expect(VOCAL_TASK_PX).toBe(46);
    expect(VOCAL_PORTRAIT_PX).toBeGreaterThanOrEqual(2 * VOCAL_TASK_PX);
    for (const cas of MESURES) {
      expect(cas.portraitSize, `${cas.width}x${cas.height}`).toBeGreaterThanOrEqual(
        2 * VOCAL_TASK_PX,
      );
    }
  });
});

describe("R2 — il est DETACHE, sans ajouter de trait", () => {
  it("8 px sous l'image, 12 px d'AIR sous le nom", () => {
    expect(VOCAL_PORTRAIT_GAP_PX).toBe(8);
    expect(VOCAL_PORTRAIT_AIR_PX).toBe(12);
    expect(NOM).toMatch(/margin-block:\s*8px 12px/);
    expect(NOM).toContain(`${VOCAL_PORTRAIT_GAP_PX}px ${VOCAL_PORTRAIT_AIR_PX}px`);
    // Et l'ecart au DISQUE est le meme air : 12 px, en haut du medaillon.
    expect(VOCAL_PORTRAIT_AIR_TOP_PX).toBe(VOCAL_PORTRAIT_AIR_PX);
    expect(PORTRAIT).toMatch(/margin-block-start:\s*12px/);
  });

  it("le bloc du personnage vaut la somme exacte de ses parties", () => {
    // L'air du haut (12) est l'ecart au disque : le medaillon ne touche plus le
    // cercle. L'air du bas (12) est celui qui le detache de ce qui suit.
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
    expect(vocalPortraitBlockSize(277)).toBe(329);
    expect(vocalPortraitBlockSize(0)).toBe(0);
    // Le cadre de la composition ajoute a ce bloc l'air du HAUT de la rangee
    // (`VOCAL_STAGE_AIR_PX`) : c'est le chiffre que `vocalPortraitSize` retranche.
    expect(VOCAL_PORTRAIT_FRAME_PX).toBe(
      VOCAL_PORTRAIT_BLOCK_PX - VOCAL_PORTRAIT_PX + VOCAL_STAGE_AIR_PX,
    );
    expect(VOCAL_PORTRAIT_FRAME_PX).toBe(64);
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
  it("il n'est plus dans le balisage de la colonne des taches, ni avant ni apres le titre", () => {
    // C'est le changement du point 7 : le personnage a QUITTE la colonne. La
    // colonne des taches ne le cite plus du tout — ni l'image, ni le nom. Si
    // l'un des deux revenait dans cette colonne, il faudrait de nouveau lui
    // payer une place, et la liste perdrait des rangees.
    const colonne = sliceSource(
      SUPER,
      'class="vocal-side-tasks vocal-side"',
      'class="vocal-side-body',
      100,
    );
    expect(colonne).not.toContain("vocal-portrait");
    expect(colonne).not.toContain("vocal-portrait-name");
  });

  it("il est SOUS le disque : le cercle vient AVANT lui dans l'ordre du document", () => {
    // L'ordre du document est celui de la peinture. Le portrait ne peut pas
    // repasser au-dessus du cercle sans que ce test tombe : c'est le verrou du
    // point 7 (« le cercle en haut, le personnage dessous »).
    const centre = sliceSource(SUPER, '<div class="vocal-center">', 'class="vocal-side-tasks', 200);
    const orb = centre.indexOf('<div class="vocal-orb">');
    const portrait = centre.indexOf('<img class="vocal-portrait"');
    expect(orb).toBeGreaterThanOrEqual(0);
    expect(portrait).toBeGreaterThanOrEqual(0);
    expect(orb, "le portrait est repasse AU-DESSUS du cercle").toBeLessThan(portrait);
    // Et il est bien DANS la composition du milieu, pas ailleurs dans la scene.
    expect(centre).toContain("vocal-center");
  });

  it("le titre « TACHES » est pose AU-DESSUS DE LA LISTE, pas en tete de colonne", () => {
    // Le titre ouvre la section : le personnage, qui n'est plus dans la colonne,
    // ne peut donc plus etre suivi immediatement par lui.
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
    // Elle ne sert plus qu'a la FENETRE DU VISAGE (le personnage est sous le
    // disque) : meme insertion, apres le titre, donc entre les deux.
    const zone = sliceSource(SUPER, "function vocalImageZoneNode(colonne)", "\n}", 200);
    expect(zone).toContain('colonne.querySelector(".vocal-tasks-title")');
    expect(zone).toContain("colonne.insertBefore(noeud, titre ? titre.nextSibling : colonne.firstChild)");
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

describe("R5 — la place n'est plus payee par aucune colonne", () => {
  it("la liste garde TOUTE sa hauteur, avec ou sans personnage", () => {
    // Point 7 : le medaillon est sous le disque, il ne prend donc plus rien a la
    // colonne de droite. La liste des taches ne paie plus le bloc du personnage
    // — c'est la contrepartie du deplacement, et elle est verifiee ici.
    const base = { width: 1440, height: 900, orbSize: 336, stageHeight: 693 };
    const sans = planVocalSides(base);
    const avec = planVocalSides({ ...base, hasPortrait: true });
    expect(avec.columnHeight).toBe(sans.columnHeight);
    expect(avec.listHeight).toBe(sans.listHeight);
    // La liste vaut la colonne moins son haut fixe (53 px), point final.
    expect(avec.listHeight).toBe(avec.columnHeight - 53);
    // Et le bloc du personnage est bien compte, mais AILLEURS : dans la rangee,
    // sous le disque.
    expect(avec.portraitBlock).toBe(vocalPortraitBlockSize(avec.portraitSize));
    expect(VOCAL_STAGE_AIR_PX + base.orbSize + avec.portraitBlock).toBeLessThanOrEqual(
      base.stageHeight,
    );
  });

  it("la plus petite fenetre garde ses rangees, et son medaillon", () => {
    // Une place gagnee en ecrasant la liste serait une regression. A 720 x 520
    // la liste garde ses 178 px, soit TROIS rangees et leurs deux en-tetes,
    // exactement comme sans personnage ; le medaillon, lui, se contente de ce
    // que la rangee laisse (97 px).
    const avec = planVocalSides(MESURES[0] && { ...MESURES[0], hasPortrait: true });
    expect(avec.portraitSize).toBe(97);
    expect(avec.listHeight).toBe(178);
    expect(vocalTaskRows(avec.listHeight).rows).toBe(3);
    expect(vocalTaskRows(avec.listHeight).headers).toBe(true);
  });
});

describe("R6 — « environ trois fois plus grand », et la VRAIE mesure", () => {
  it("le chiffre mesure pour chaque fenetre, du plus petit au plus grand", () => {
    // Le tableau du rapport et de `spec_modes_ecran_vocal.md` § 3ter, ligne par
    // ligne. Il tombe si un seul chiffre bouge — c'est un plafond tenu, pas une
    // formule qu'on peut arrondir.
    const attendu = [97, 116, 149, 182, 193, 288, 288];
    expect(MESURES.map((c) => c.portraitSize)).toEqual(attendu);
    for (const cas of MESURES) {
      const plan = planVocalSides({ ...cas, hasPortrait: true });
      expect(plan.portraitSize, `${cas.width}x${cas.height}`).toBe(cas.portraitSize);
      // Le medaillon ne touche NI le cercle (12 px d'ecart) NI la fin de la
      // rangee : la marge est toujours reelle.
      expect(plan.portraitBlock).toBe(cas.portraitSize + 52);
    }
  });

  it("la cible de 3 x est atteinte des que la hauteur la porte (1440 x 900)", () => {
    for (const cas of MESURES.filter((c) => c.height >= 900)) {
      const plan = planVocalSides({ ...cas, hasPortrait: true });
      expect(plan.portraitSize, `${cas.width}x${cas.height}`).toBe(VOCAL_PORTRAIT_TARGET_PX);
      expect(plan.portraitSize / VOCAL_PORTRAIT_PX).toBe(3);
    }
    // En dessous, ce n'est pas un choix : c'est la hauteur qui manque, et le
    // chiffre baisse sans jamais deborder (verifie en R1).
    const petit = planVocalSides({ ...MESURES[4], hasPortrait: true });
    expect(petit.portraitSize).toBe(193);
    expect(petit.portraitSize).toBeLessThan(VOCAL_PORTRAIT_TARGET_PX);
  });

  it("le repli du calcul de la rangee retrouve la rangee MESUREE, aux sept fenetres", () => {
    // `vocalSyncSides` mesure `.vocal-stage` ; quand la mesure est illisible
    // (overlay pas encore pose) il retombe sur `hauteur - VOCAL_STAGE_RESERVED_PX`.
    // Le repli et la mesure doivent donner le MEME budget, sinon le medaillon
    // changerait de taille au premier tic suivant l'ouverture.
    for (const cas of MESURES) {
      const mesure = planVocalSides({ ...cas, hasPortrait: true });
      const repli = planVocalSides({
        width: cas.width,
        height: cas.height,
        orbSize: cas.orbSize,
        hasPortrait: true,
      });
      expect(repli.stageHeight, `${cas.width}x${cas.height} : repli`).toBe(cas.stageHeight);
      expect(repli.portraitSize, `${cas.width}x${cas.height} : repli`).toBe(cas.portraitSize);
      expect(mesure.stageHeight).toBe(cas.stageHeight);
    }
  });
});
