// Tests — REMARQUE DU PROPRIETAIRE DU 2026-10-03, point 1 : « la colonne de
// gauche est trop proche du cercle ».
// (docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md, puis
// docs/rapports/RAPPORT-remarques-ecran-vocal-20261003.md § 1.)
//
// CE QUE CE FICHIER VERROUILLE :
//   P1 — les deux colonnes lisent le MEME jeton de largeur de contenu
//        (`--vocal-side-tasks`) : elles ne peuvent pas deriver l'une de l'autre.
//   P2 — la colonne de gauche s'aligne vers l'EXTERIEUR (`justify-self: start`),
//        la colonne des taches vers le disque (`end`) : chacune s'arrete donc au
//        bord de la couronne de son cote.
//   P3 — la consequence, mesuree : sur les SEPT fenetres du tableau, la distance
//        entre le bord interieur de chaque colonne et le bord de la couronne vaut
//        `VOCAL_SIDE_GAP_PX` (24 px) des DEUX cotes. Avant le correctif, elle
//        valait `24 - couronne` a gauche, donc NEGATIVE des que la fenetre est
//        grande : le texte passait dans la lueur du halo.
//   P4 — le disque n'a pas ete retreci (`VOCAL_ORB_RESERVED_PX` inchange), les
//        colonnes n'ont pas ete poussees hors de l'ecran, et aucun second jeton
//        d'espacement n'a ete invente.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CROWN_PX,
  VOCAL_SIDE_CLEARANCE_PX,
  VOCAL_SIDE_GAP_PX,
  VOCAL_ORB_RESERVED_PX,
  planVocalSides,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Regle CSS d'un selecteur, accolades exclues (decoupage verifie). */
function regle(selecteur, mini = 10) {
  return sliceSource(CSS, `${selecteur} {`, "}", mini);
}

const DISCUSSION = regle(".vocal-side-discussion", 100);
const TACHES = regle(".vocal-side-tasks", 100);

// Les sept fenetres du tableau § 7bis.4 des specs : largeur, hauteur, disque.
const FENETRES = [
  [720, 520, 151.6],
  [768, 576, 188.3],
  [820, 620, 217.2],
  [896, 672, 251.3],
  [1024, 768, 314.3],
  [1280, 800, 335.3],
  [1440, 900, 336],
];

describe("P1 — les deux colonnes lisent la MEME largeur de contenu", () => {
  it("`--vocal-side-tasks` est la largeur des DEUX colonnes", () => {
    // Une seule verite, deux colonnes : si l'une revenait a `--vocal-side`, elle
    // mordrait de nouveau dans la couronne (c'est exactement le defaut d'origine,
    // qui ne touchait que la colonne de gauche).
    expect(DISCUSSION).toMatch(/width:\s*var\(--vocal-side-tasks, 100%\)/);
    expect(TACHES).toMatch(/width:\s*var\(--vocal-side-tasks, 100%\)/);
    // Aucun second jeton d'espacement : on ne cree pas une largeur par colonne.
    expect(CSS).not.toContain("--vocal-side-discussion");
  });

  it("chaque colonne s'aligne vers l'EXTERIEUR de son cote", () => {
    // `start` a gauche et `end` a droite : la boite se colle du cote de l'ecran,
    // donc son bord INTERIEUR s'arrete au meme endroit, vu de chaque cote.
    expect(DISCUSSION).toMatch(/justify-self:\s*start/);
    expect(TACHES).toMatch(/justify-self:\s*end/);
    // La largeur est bien une LARGEUR : une marge interieure ne couperait rien
    // (le titre deborderait de sa boite au lieu d'etre tronque).
    expect(DISCUSSION).not.toMatch(/margin-inline-end:\s*calc/);
    expect(TACHES).not.toMatch(/margin-inline-start:\s*calc/);
  });

  it("`vocalSyncSides()` n'ecrit QUE ce jeton pour les colonnes", () => {
    // La largeur de piste reste ecrite (elle place la grille), et la largeur de
    // contenu aussi : deux `setProperty` et pas un troisieme, qui serait un
    // second reglage de largeur a tenir a jour.
    const corps = sliceSource(
      SUPER,
      'ov.style.setProperty("--vocal-side", `${plan.track}px`);',
      'ov.classList.toggle("vocal-sides-off"',
      200,
    );
    expect(corps).toContain('"--vocal-side-tasks"');
    expect(corps).toContain(`${"${plan.taskTrack}px"}`);
    const largeurs = SUPER.match(/setProperty\("--vocal-side[^"]*"/g) || [];
    expect(largeurs).toEqual(['setProperty("--vocal-side"', 'setProperty("--vocal-side-tasks"']);
  });
});

describe("P2 — la place liberee autour du cercle est la MEME des deux cotes", () => {
  /** Le bord de la couronne, mesure depuis le bord de la piste, cote gauche. */
  const BORD_COURONNE = VOCAL_SIDE_GAP_PX - VOCAL_CROWN_PX;

  it("le contenu s'arrete EXACTEMENT au bord de la couronne : 64 px de moins que la piste", () => {
    // `VOCAL_SIDE_CLEARANCE_PX` est la seule valeur qui relie les trois jetons :
    // la couronne (88), le jour de la grille (24) et le retrait du contenu (64).
    // 88 - 24 = 64 : la piste perd le jour, le contenu perd le reste.
    expect(VOCAL_SIDE_CLEARANCE_PX).toBe(VOCAL_CROWN_PX - VOCAL_SIDE_GAP_PX);
    expect(VOCAL_SIDE_CLEARANCE_PX).toBe(64);
  });

  it("sur les sept fenetres, le bord interieur des DEUX colonnes touche la meme limite", () => {
    for (const [width, height, orbSize] of FENETRES) {
      const plan = planVocalSides({ width, height, orbSize });
      expect(plan.shown, `${width} x ${height} : deux colonnes`).toBe(true);
      const { track, taskTrack } = plan;
      const stage = 2 * track + 2 * VOCAL_SIDE_GAP_PX + orbSize;
      // Reperes, dans l'ordre de lecture : le bord de la couronne a gauche, le
      // bord interieur de chaque colonne.
      const couronneGauche = track + BORD_COURONNE;
      const bordInterieurGauche = taskTrack; // `justify-self: start`
      const couronneDroite = stage - couronneGauche; // la scene est symetrique
      const bordInterieurDroite = stage - taskTrack; // `justify-self: end`
      // Aucune des deux ne mord dans la lueur — et l'ecart residuel est le MEME :
      // c'est ce qui rend les deux colonnes symetriques autour du disque.
      expect(bordInterieurGauche - couronneGauche, `${width} x ${height} : gauche`).toBe(0);
      expect(couronneDroite - bordInterieurDroite, `${width} x ${height} : droite`).toBe(0);
      // Et le contenu est bien PLUS ETROIT que la piste : sans ce retrait, le bord
      // interieur tombait 64 px sous le bord de la couronne (defaut d'origine).
      expect(taskTrack, `${width} x ${height} : retrait`).toBe(track - 64);
      expect(taskTrack, `${width} x ${height} : non vide`).toBeGreaterThan(0);
    }
  });

  it("la colonne de gauche a EXACTEMENT la largeur de contenu de celle des taches", () => {
    // Une seule largeur pour les deux : la discussion n'est pas une colonne au
    // rabais, elle est la symetrique de l'autre (et les deux regles CSS lisent le
    // meme jeton, verifie en P1).
    for (const [width, height, orbSize] of FENETRES) {
      const plan = planVocalSides({ width, height, orbSize });
      expect(plan.taskTrack, `${width} x ${height}`).toBe(plan.track - VOCAL_SIDE_CLEARANCE_PX);
      expect(plan.taskTrack, `${width} x ${height} : jamais plus large que la piste`).toBeLessThan(
        plan.track,
      );
    }
  });
});

describe("P3 — le disque n'a pas ete retreci et rien n'a ete pousse dehors", () => {
  it("la formule du disque est inchangee", () => {
    // La remarque interdisait de regagner de la place en reduisant le cercle :
    // la hauteur reservee au disque dans la formule des colonnes est la meme.
    expect(VOCAL_ORB_RESERVED_PX).toBe(289);
    expect(regle(".pilot-vocal", 200)).toMatch(
      /--vocal-orb-size:\s*clamp\(120px, calc\(\(100vh - 289px\) \* 21 \/ 32\), 336px\)/,
    );
  });

  it("le correctif ne touche NI le disque, NI le halo, NI les colonnes elles-memes", () => {
    // Trois invariants de la conception, verifies ici parce qu'une place gagnee
    // en tirant sur l'un des trois serait une regression du meme ecran.
    // 1. La couronne (88 px pour 336) et l'arc gardent leur proportion.
    expect(regle(".pilot-vocal", 200)).toMatch(
      /--vocal-crown:\s*calc\(var\(--vocal-orb-size\) \* 88 \/ 336\)/,
    );
    // 2. L'ecart de grille entre une colonne et le disque ne bouge pas : c'est
    //    LUI qui donne les 24 px mesures ci-dessus.
    expect(regle(".vocal-stage", 60)).toMatch(/column-gap:\s*24px/);
    // 3. La colonne garde sa hauteur et son debordement coupe : rien n'a ete
    //    agrandi pour faire de la place.
    expect(regle(".vocal-side", 60)).toMatch(/height:\s*min\(var\(--vocal-orb-box\), 100%\)/);
    expect(regle(".vocal-side", 60)).toMatch(/overflow:\s*hidden/);
  });

  it("aucune couleur en dur dans les deux regles touchees", () => {
    for (const nom of ["DISCUSSION", "TACHES"]) {
      const corps = nom === "DISCUSSION" ? DISCUSSION : TACHES;
      expect(corps, `${nom} : aucune couleur ecrite en dur`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(corps, `${nom} : aucun rgb()`).not.toMatch(/\brgba?\(/);
      expect(corps, `${nom} : aucune teinte nommee`).not.toMatch(
        /\b(?:white|black|red|blue|green|gray|grey)\b/,
      );
    }
  });
});
