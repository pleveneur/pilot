// Tests — LA COLONNE DES TACHES, EN HAUT DE LA COLONNE DE DROITE
// (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md, § 2.5 et
// § 7bis, revus par la mission « ecran Vocal »).
//
// CE QUE CE FICHIER VERROUILLE :
//   T12 — les deux groupes, dans l'ordre « En cours » puis « En attente », et le
//         NOMBRE DE LIGNES qui suit la hauteur : les sept lignes du tableau
//         § 2.5 pour les sept fenetres du document, plafond 8.
//   T18 — le haut de la colonne ne reserve plus RIEN pour le personnage :
//         `listH = H - 51`, un SEUL total (le titre et l'air du bas), la
//         fenetre du visage prenant sa place SUR ce total.
//   T19 — la colonne ne passe JAMAIS sous le cercle (`--vocal-side-tasks`,
//         une largeur, pas une marge) et l'ordre du document est
//         titre -> zone d'image -> liste, sans ligne d'activite.
//
// Plus les verrous de coherence : une SEULE source de missions
// (`collectSuperMissions`), un SEUL point de peinture (`vocalSyncSides`), un tic
// qui part et revient, aucune ecriture, aucun reglage.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate §3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import {
  planVocalSides,
  planVocalTasks,
  vocalTaskRows,
  VOCAL_TASKS_MAX,
  VOCAL_TASKS_MIN_HEADERS_PX,
  VOCAL_SIDES_TICK_MS,
  VOCAL_SIDE_FIXED_PX,
  VOCAL_CROWN_PX,
  VOCAL_SIDE_GAP_PX,
  VOCAL_TASKS_TITLE,
  VOCAL_TASKS_EMPTY_TEXT,
  VOCAL_TASKS_GROUP_RUNNING,
  VOCAL_TASKS_GROUP_WAITING,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const SIDES = lire("src/js/vocal-sides.js");

/** Fragment de `super-agent.js` entre deux ancres (decoupage verifie). */
function corps(debut, fin) {
  return sliceSource(SUPER, debut, fin, 40);
}

/**
 * Les SEPT fenetres du tableau § 2.5, avec la colonne `H` du tableau § 3.2 de la
 * conception : [largeur, hauteur, disque, H, lignes de liste].
 * `H - 51` px de liste, en-tetes compris : le document fait foi.
 */
const SEPT_LIGNES = [
  [720, 520, 151.6, 231, 3],
  [768, 576, 188.3, 287, 4],
  [820, 620, 217.2, 331, 5],
  [896, 672, 251.3, 383, 6],
  [1024, 768, 314.3, 479, 8],
  [1280, 800, 335.3, 511, 8],
  [1440, 900, 336, 512, 8],
];

describe("T18 — le haut de la colonne ne reserve plus rien pour le personnage", () => {
  it("`listH` vaut H - 51 : UN seul total, le titre et l'air du bas", () => {
    for (const [largeur, hauteur, disque, H] of SEPT_LIGNES) {
      const plan = planVocalSides({ width: largeur, height: hauteur, orbSize: disque });
      expect(plan.columnHeight, `${largeur} : H`).toBe(H);
      expect(plan.listHeight, `${largeur} : liste`).toBe(H - VOCAL_SIDE_FIXED_PX);
    }
  });

  it("51 px, et pas un de plus : 14 + 11 + 14 de titre, 12 px d'air en bas", () => {
    expect(VOCAL_SIDE_FIXED_PX).toBe(39 + 12);
    // 180 px de fenetre du visage quand elle s'affiche : 51 + 180 = 231 px.
    const avecAvatar = planVocalSides({
      width: 1440,
      height: 900,
      orbSize: 336,
      hasAvatar: true,
    });
    expect(avecAvatar.columnHeight).toBe(512);
    expect(avecAvatar.listHeight).toBe(512 - 231);
  });

  it("le personnage n'a plus de place dans la colonne : le plan ne le connait pas", () => {
    const cas = { width: 1440, height: 900, orbSize: 336 };
    const plan = planVocalSides(cas);
    expect(Object.keys(plan).sort()).toEqual([
      "columnHeight",
      "hasAvatar",
      "imageZone",
      "listHeight",
      "shown",
      "taskTrack",
      "track",
    ]);
    // Une entree `hasPortrait` d'un appelant ancien ne change RIEN : elle n'est
    // plus lue, donc elle ne peut plus faire apparaitre un trou.
    expect(planVocalSides({ ...cas, hasPortrait: true }).listHeight).toBe(plan.listHeight);
    // Et l'entree absente non plus : aucun cas par defaut cache.
    expect(plan.listHeight).toBe(461);
  });

  it("le portrait a QUITTE la colonne : il est dans le disque, sans nom dessous", () => {
    const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
    // Le seul portrait de l'ecran est le premier enfant du disque, avant le
    // halo : c'est le centre du cercle, pas le haut de la colonne.
    const disque = sliceSource(build, '<div class="vocal-orb"', "</div>", 400);
    expect(disque).toMatch(/<img class="vocal-portrait"[^>]*hidden/);
    expect(disque.indexOf('class="vocal-portrait"')).toBeLessThan(
      disque.indexOf('class="vocal-halo"'),
    );
    // La colonne de droite n'en porte plus aucun.
    const colonne = sliceSource(
      build,
      '<aside class="vocal-side-tasks vocal-side">',
      "</aside>",
      20,
    );
    expect(colonne).not.toMatch(/vocal-portrait/);
    // Ni nom sous l'image dans la colonne : le seul nom de l'ecran est celui du
    // disque (`.vocal-orb-name`).
    expect(build).not.toMatch(/vocal-portrait-name/);
  });
});

describe("T19 — la liste ne passe jamais sous le cercle", () => {
  it("`taskTrack = track - (couronne - jour)`, une LARGEUR, jamais une marge", () => {
    expect(VOCAL_CROWN_PX).toBe(88);
    expect(VOCAL_SIDE_GAP_PX).toBe(24);
    const plan = planVocalSides({ width: 1440, height: 900, orbSize: 336 });
    expect(plan.track).toBe(320);
    expect(plan.taskTrack).toBe(320 - 64);
    // Aucune colonne : aucune largeur de taches non plus.
    expect(planVocalSides({ width: 640, height: 480, orbSize: 125.3 }).taskTrack).toBe(0);
  });

  it("la largeur est ecrite par `vocalSyncSides` SEUL et lue par la feuille de style", () => {
    const sync = corps("function vocalSyncSides()", "\n}\n");
    expect((sync.match(/setProperty\("--vocal-side-tasks"/g) || []).length).toBe(1);
    // Une LARGEUR (`width:`), pas un `margin` : une boite plus etroite coupe un
    // titre long par elle-meme, elle ne le pose jamais sur le disque.
    expect(CSS).toMatch(/\.vocal-side-tasks\s*\{[^}]*width:\s*var\(--vocal-side-tasks/);
    expect(CSS).not.toMatch(/\.vocal-side-tasks\s*\{[^}]*margin-inline-start/);
    // Alignee vers le disque : elle ne s'en eloigne pas.
    expect(CSS).toMatch(/\.vocal-side-tasks\s*\{[^}]*justify-self:\s*end/);
    // Un titre long est coupe, jamais deborde : les deux titres partagent la
    // meme regle, donc le titre des taches ne peut pas deriver.
    expect(CSS).toMatch(
      /\.vocal-discussion-title,\s*\.vocal-tasks-title\s*\{[^}]*text-overflow:\s*ellipsis/,
    );
    // Le TEXTE d'une tache (le resume comme l'identite) est coupe par sa boite.
    expect(CSS).toMatch(/\.vocal-task-mission\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(CSS).toMatch(/\.vocal-task-who\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("l'ordre du document est titre -> zone d'image -> liste, sans activite", () => {
    // Le balisage statique : la zone d'image (vide) puis le conteneur de liste.
    const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
    const colonne = sliceSource(
      build,
      '<aside class="vocal-side-tasks vocal-side">',
      "</aside>",
      20,
    );
    expect(colonne).toMatch(/vocal-side-body/);
    // Le titre et la zone d'image sont CREES par la repeinture, a leur place
    // imposee : le titre AVANT tout, la zone d'image ensuite, la liste apres.
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).toMatch(/vocalColumnNode\(colonne, "\.vocal-tasks-title", "first"\)/);
    expect(rendu.indexOf("vocalImageZoneNode(colonne)")).toBeGreaterThan(
      rendu.indexOf('".vocal-tasks-title"'),
    );
    expect(rendu.indexOf('querySelector(".vocal-side-body")')).toBeGreaterThan(
      rendu.indexOf("vocalImageZoneNode(colonne)"),
    );
  });

  it("la ligne d'activite du bas de la colonne N'EXISTE PLUS", () => {
    // Decision du proprietaire : le texte d'activite quitte l'ecran, et sa place
    // n'est pas reprise. La fonction, son noeud et son style partent ensemble —
    // aucun d'eux ne survit a moitie.
    expect(SIDES).not.toMatch(/vocalNowLine/);
    expect(SUPER).not.toMatch(/vocal-now|vocalNowLine/);
    expect(CSS).not.toMatch(/\.vocal-now/);
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).not.toMatch(/vocal-now/);
    // Et la colonne ne nomme aucun autre texte d'activite a sa place.
    expect(rendu).not.toMatch(/r\u00e9fl\u00e9chit|ex\u00e9cute une op/);
  });
});

describe("T12 — les taches : en cours d'abord, en attente ensuite, et le bon compte", () => {
  it("les deux groupes du document, dans l'ordre, jamais trois", () => {
    expect(VOCAL_TASKS_GROUP_RUNNING).toBe("En cours");
    expect(VOCAL_TASKS_GROUP_WAITING).toBe("En attente");
    const missions = [
      { agent: "codeur", project: "pilot", mission: "a", waiting: false },
      { agent: "revue", project: "pilot", mission: "b", waiting: false },
      { agent: "tests", project: "pilot", mission: "c", waiting: true },
    ];
    const plan = planVocalTasks(missions, { listHeight: 342 });
    expect(plan.groups.map((g) => g.key)).toEqual(["running", "waiting"]);
    expect(plan.groups.map((g) => g.label)).toEqual(["En cours", "En attente"]);
  });

  it("le tableau § 2.5, les SEPT fenetres, au pixel pres", () => {
    for (const [largeur, hauteur, disque, H, lignes] of SEPT_LIGNES) {
      const plan = planVocalSides({ width: largeur, height: hauteur, orbSize: disque });
      expect(plan.columnHeight, `${largeur} : H`).toBe(H);
      expect(
        vocalTaskRows(plan.listHeight).rows,
        `${largeur} x ${hauteur} : ${plan.listHeight} px de liste`,
      ).toBe(lignes);
    }
  });

  it("le plafond est UN seul nombre : 8, ce que la place permet", () => {
    expect(VOCAL_TASKS_MAX).toBe(8);
    // 8 n'est pas choisi : c'est ce que la place permet a la hauteur maximale.
    expect(Math.floor((440 - 2 * 20) / 46)).toBe(8);
    expect(vocalTaskRows(440).rows).toBe(8);
    expect(vocalTaskRows(512).rows).toBe(8);
    // La liste ne peut plus montrer plus que le plafond, meme quand la place
    // deborderait (fenetre tres haute).
    expect(vocalTaskRows(1024).rows).toBe(VOCAL_TASKS_MAX);
    expect(vocalTaskRows(1024).cap).toBe(VOCAL_TASKS_MAX);
  });

  it("sous 86 px de liste, les en-tetes de groupe disparaissent", () => {
    expect(VOCAL_TASKS_MIN_HEADERS_PX).toBe(2 * 20 + 46);
    expect(vocalTaskRows(85).headers).toBe(false);
    expect(vocalTaskRows(86).headers).toBe(true);
    // Sans en-tetes, la place restante vaut au plus deux lignes.
    expect(vocalTaskRows(85).rows).toBeLessThanOrEqual(2);
  });

  it("jamais zero ligne : une colonne qui n'affiche rien mentirait", () => {
    for (const h of [0, 1, 20, 45]) {
      expect(vocalTaskRows(h).rows, `listH ${h}`).toBe(1);
    }
  });

  it("l'excedent est DIT : `+ N autre(s)`, jamais cache en silence", () => {
    const enCours = Array.from({ length: 6 }, (_, i) => ({
      agent: "agent",
      project: "pilot",
      mission: `en cours ${i + 1}`,
      waiting: false,
    }));
    const attente = Array.from({ length: 4 }, (_, i) => ({
      agent: "agent",
      project: "pilot",
      mission: `en attente ${i + 1}`,
      waiting: true,
    }));
    // Huit lignes disponibles (fenetre de 1440 x 900) : quatre et quatre.
    const huit = planVocalTasks([...enCours, ...attente], { listHeight: 461 });
    expect(huit.rows).toBe(8);
    expect(huit.total).toBe(10);
    expect(huit.shown).toBe(8);
    expect(huit.more).toBe(2);
    expect(huit.groups[0].items.length).toBe(4);
    expect(huit.groups[1].items.length).toBe(4);
    // Trois lignes disponibles (720 x 520) : deux et une, le surplus est dit.
    const trois = planVocalTasks([...enCours, ...attente], { listHeight: 180 });
    expect(trois.rows).toBe(3);
    expect(trois.groups[0].labels || trois.groups.length).toBe(2);
    expect(trois.shown).toBe(3);
    expect(trois.more).toBe(7);
    // Dix missions « en cours » et rien en attente : la place du groupe vide
    // revient au groupe plein, jamais un trou.
    const plein = planVocalTasks(
      Array.from({ length: 10 }, (_, i) => ({
        agent: "a",
        project: "p",
        mission: `m${i}`,
        waiting: false,
      })),
      { listHeight: 461 },
    );
    expect(plein.groups.length).toBe(1);
    expect(plein.groups[0].items.length).toBe(8);
    expect(plein.more).toBe(2);
  });

  it("un groupe vide ne prend pas la place de l'autre", () => {
    const enAttenteSeule = planVocalTasks(
      Array.from({ length: 5 }, (_, i) => ({
        agent: "a",
        project: "p",
        mission: `m${i}`,
        waiting: true,
      })),
      { listHeight: 342 },
    );
    expect(enAttenteSeule.groups.length).toBe(1);
    expect(enAttenteSeule.groups[0].key).toBe("waiting");
    expect(enAttenteSeule.shown).toBe(5);
  });

  it("liste vide : une phrase, pas un trou", () => {
    expect(VOCAL_TASKS_TITLE).toBe("T\u00c2CHES");
    expect(VOCAL_TASKS_EMPTY_TEXT).toBe("Aucune t\u00e2che en cours");
    const plan = planVocalTasks([], { listHeight: 342 });
    expect(plan.empty).toBe(true);
    expect(plan.groups).toEqual([]);
    expect(plan.total).toBe(0);
  });
});

describe("coherence : une seule source de missions, un seul point de peinture", () => {
  it("`collectSuperMissions` existe et sert la colonne SANS second calcul", () => {
    expect(SUPER).toMatch(/export function collectSuperMissions\(\)/);
    // Le bouton « Travail » contient le pipeline UNIQUE...
    const compteur = corps("export function publishSuperMissionsCount()", "\n}\n");
    expect(compteur).toMatch(
      /buildRunningMissions\(getAgentActivitySnapshot\(\)\.list, collectQueuedMissions\(\)\)/,
    );
    // ...et `collectSuperMissions` ne fait que le NOMMER : il ne recalcule rien.
    const source = corps("export function collectSuperMissions()", "\n}\n");
    expect(source).toMatch(/return publishSuperMissionsCount\(\)/);
    expect(source).not.toMatch(/buildRunningMissions|collectQueuedMissions/);
    // La colonne lit la meme source que le bouton, jamais un second calcul.
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).toMatch(/collectSuperMissions\(\)/);
    expect(rendu).not.toMatch(/buildRunningMissions|collectQueuedMissions/);
  });

  it("la colonne se peint la ou la largeur se pose : `vocalSyncSides` seul", () => {
    const sync = corps("function vocalSyncSides()", "\n}\n");
    expect(sync).toMatch(/vocalRenderColumn\(plan\)/);
    // Une seule ecriture de `--vocal-side` et une seule de `--vocal-side-tasks`.
    expect((sync.match(/setProperty\("--vocal-side"/g) || []).length).toBe(1);
    expect((sync.match(/setProperty\("--vocal-side-tasks"/g) || []).length).toBe(1);
    // Le plan des taches est construit a UN seul endroit, dans la peinture de
    // colonne, a partir de la hauteur que `vocalSyncSides` vient de decider.
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).toMatch(/planVocalTasks\(/);
    expect(rendu).toMatch(/listHeight: plan\.listHeight/);
  });

  it("un seul tic, pose a l'entree et retire a la sortie", () => {
    expect(VOCAL_SIDES_TICK_MS).toBe(900);
    const entree = corps("function enterVocal()", "function exitVocal()");
    expect(entree).toMatch(/setInterval\(vocalSyncSides, VOCAL_SIDES_TICK_MS\)/);
    const sortie = corps("function exitVocal()", "function autoReadVocalReply()");
    expect(sortie).toMatch(/clearInterval\(vocalSidesTick\)/);
    expect(sortie).toMatch(/vocalSidesTick = null/);
  });

  it("le personnage change d'etiquette SANS attendre le tic : meme point d'application", () => {
    const ui = corps("export function applyAssistantPersonaUi()", "\n}\n");
    expect(ui.indexOf("applyVocalPortrait()")).toBeGreaterThan(-1);
    expect(ui.indexOf("vocalSyncSides()")).toBeGreaterThan(ui.indexOf("applyVocalPortrait()"));
  });

  it("aucune lecture du disque ni de stockage dans la decision des taches", () => {
    expect(SIDES).not.toMatch(/invoke\(|localStorage|sessionStorage|fetch\(|indexedDB/);
    expect(SIDES).not.toMatch(/document\.|window\./);
  });

  it("les hauteurs du budget § 2.5 sont ecrites dans la feuille de style", () => {
    // Le nombre de lignes calcule ne vaut que si la feuille de style tient le
    // meme budget : 46 px par tache, 20 px par en-tete.
    expect(CSS).toMatch(/\.vocal-task\s*\{[^}]*height:\s*46px/);
    expect(CSS).toMatch(/\.vocal-task-group\s*\{[^}]*height:\s*20px/);
    // La colonne ne defile jamais : `pointer-events: none` + `overflow: hidden`.
    expect(CSS).toMatch(/\.vocal-side\s*\{[^}]*pointer-events:\s*none/);
    expect(CSS).toMatch(/\.vocal-side-tasks\s*\{[^}]*overflow:\s*hidden/);
  });
});
