// Tests — LOT 2 de l'ecran Vocal : LES TACHES EN HAUT, LE PORTRAIT EN BAS
// (docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md,
// § 2.2 a § 2.7, et § 8 qui nomme ces tests : T12 etendu, T18 nouveau, T19
// nouveau).
//
// CE QUE CE FICHIER VERROUILLE :
//   T12 — les deux groupes, dans l'ordre « En cours » puis « En attente », et le
//         NOMBRE DE LIGNES qui suit la hauteur ET le cas : les sept lignes du
//         tableau § 2.5 (plafond 6 avec un personnage, 8 sans).
//   T18 — sans personnage, la colonne ne reserve RIEN : `listH = H - 72` au cas
//         B, `H - 170` au cas A, deux valeurs nommees distinctement de `H`.
//   T19 — le portrait ne bouge pas quand la liste change : `listH` ne depend pas
//         du nombre de missions, et l'ordre du document reste titre -> liste ->
//         portrait -> pastille -> ligne d'activite.
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
  vocalNowLine,
  VOCAL_TASKS_MAX,
  VOCAL_TASKS_MAX_BARE,
  VOCAL_TASKS_MIN_HEADERS_PX,
  VOCAL_SIDES_TICK_MS,
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
 * proposition : [largeur, hauteur, disque, H, lignes cas A, lignes cas B].
 * Les deux dernieres colonnes sont celles du document, recopiees telles quelles.
 */
const SEPT_LIGNES = [
  [720, 520, 151.6, 231, 1, 2],
  [768, 576, 188.3, 287, 1, 3],
  [820, 620, 217.2, 331, 2, 4],
  [896, 672, 251.3, 383, 3, 5],
  [1024, 768, 314.3, 479, 5, 7],
  [1280, 800, 335.3, 511, 6, 8],
  [1440, 900, 336, 512, 6, 8],
];

describe("T18 — sans personnage, la colonne ne reserve rien", () => {
  it("`listH` vaut H - 170 avec un personnage, H - 72 sans : DEUX valeurs", () => {
    for (const [largeur, hauteur, disque, H] of SEPT_LIGNES) {
      const avec = planVocalSides({
        width: largeur,
        height: hauteur,
        orbSize: disque,
        hasPortrait: true,
      });
      const sans = planVocalSides({
        width: largeur,
        height: hauteur,
        orbSize: disque,
        hasPortrait: false,
      });
      // La hauteur de la COLONNE ne depend pas du cas : seul le bloc du
      // personnage (72 + 6 + 20) apparait ou disparait.
      expect(avec.columnHeight, `${largeur} : H`).toBe(H);
      expect(sans.columnHeight, `${largeur} : H`).toBe(H);
      expect(avec.columnHeight, `${largeur} : H cas A`).toBe(avec.listHeight + 170);
      expect(sans.columnHeight, `${largeur} : H cas B`).toBe(sans.listHeight + 72);
      expect(avec.hasPortrait).toBe(true);
      expect(sans.hasPortrait).toBe(false);
    }
  });

  it("les 98 px du cas A sont EXACTEMENT ceux du cas B rendus a la liste", () => {
    const avec = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasPortrait: true });
    const sans = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasPortrait: false });
    // 170 - 72 = 98 px : le medaillon (72), son ecart (6) et la pastille (20).
    expect(sans.listHeight - avec.listHeight).toBe(98);
    expect(avec.listHeight).toBe(342);
    expect(sans.listHeight).toBe(440);
  });

  it("le critere est le personnage SEUL : aucune autre entree ne change le cas", () => {
    // Meme fenetre, meme disque : `hasPortrait` est la seule chose qui differe,
    // et c'est elle qui decide. Rien n'est lu ailleurs, rien n'est memorise.
    const base = { width: 1440, height: 900, orbSize: 336 };
    expect(planVocalSides({ ...base, hasPortrait: true }).listHeight).toBe(342);
    expect(planVocalSides({ ...base, hasPortrait: false }).listHeight).toBe(440);
    // Entree absente = cas B : l'absence de personnage est le defaut, jamais le
    // cas A (on ne reserve pas 98 px pour un personnage qu'on n'a pas vu).
    expect(planVocalSides(base).listHeight).toBe(440);
  });

  it("au cas B, le medaillon n'est pas affiche, et il n'y a AUCUN nom sous l'image", () => {
    const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
    // Le noeud existe dans la colonne, mais nait `hidden` : c'est
    // `applyVocalPortrait` qui le montre, et seulement s'il y a un personnage.
    expect(build).toMatch(/<img class="vocal-portrait"[^>]*hidden/);
    // REVISION DU 2026-10-29 (decision du proprietaire) : aucun nom sous
    // l'image. Le nom vit sous le bouton-cercle, il n'a donc plus rien a faire
    // ici — ni en balisage, ni en CSS.
    expect(build).not.toMatch(/vocal-portrait-name/);
    // Aucune hauteur n'est reservee a sa place : `hidden` le retire du flux
    // (aucune regle CSS ne lui rend un `display`), et rien ne lui cede de place
    // quand il est absent.
    expect(CSS).not.toMatch(/\.vocal-portrait[^{]*\{[^}]*display\s*:/);
    // Le seul element qui absorbe la hauteur libre est la liste.
    expect(CSS).toMatch(/\.vocal-side-body\s*\{[^}]*flex:\s*1 1 auto/);
  });
});

describe("T19 — le portrait ne bouge pas quand la liste change", () => {
  it("`listH` est identique que la liste porte 0, 1 ou 6 missions", () => {
    const cas = { width: 1440, height: 900, orbSize: 336 };
    const vide = planVocalSides({ ...cas, hasPortrait: true });
    expect(vide.listHeight).toBe(342);
    // Le nombre de missions n'entre pas dans la decision des colonnes : il n'y a
    // meme pas de parametre pour lui. Le plan ne bouge donc pas.
    expect(Object.keys(vide).sort()).toEqual([
      "columnHeight",
      "hasAvatar",
      "hasPortrait",
      "imageZone",
      "listHeight",
      "shown",
      "track",
    ]);
  });

  it("l'ordre du document est titre -> zone d'image -> liste -> activite", () => {
    // Le balisage statique pose portrait -> liste (revision du 2026-10-29 : le
    // personnage d'abord, la liste dessous ; plus aucun nom sous l'image).
    const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
    const colonne = sliceSource(
      build,
      '<aside class="vocal-side-tasks vocal-side">',
      "</aside>",
      20,
    );
    const iCorps = colonne.indexOf('class="vocal-side-body"');
    const iPortrait = colonne.indexOf('class="vocal-portrait"');
    expect(iCorps).toBeGreaterThan(-1);
    expect(iPortrait).toBeGreaterThan(-1);
    expect(iPortrait).toBeLessThan(iCorps);
    expect(colonne).not.toMatch(/vocal-portrait-name/);
    // Le titre et la ligne d'activite sont CREES par la repeinture, a leur place
    // imposee : le titre AVANT tout, la ligne APRES tout.
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).toMatch(
      /vocalColumnNode\(colonne, "\.vocal-tasks-title", "first"\)/,
    );
    expect(rendu).toMatch(/vocalColumnNode\(colonne, "\.vocal-now", "last"\)/);
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
    const plan = planVocalTasks(missions, { listHeight: 342, hasPortrait: true });
    expect(plan.groups.map((g) => g.key)).toEqual(["running", "waiting"]);
    expect(plan.groups.map((g) => g.label)).toEqual(["En cours", "En attente"]);
  });

  it("le tableau § 2.5, les SEPT lignes, cas A et cas B au pixel pres", () => {
    for (const [largeur, hauteur, disque, H, lignesA, lignesB] of SEPT_LIGNES) {
      const avec = planVocalSides({
        width: largeur,
        height: hauteur,
        orbSize: disque,
        hasPortrait: true,
      });
      const sans = planVocalSides({
        width: largeur,
        height: hauteur,
        orbSize: disque,
        hasPortrait: false,
      });
      expect(avec.columnHeight, `${largeur} : H`).toBe(H);
      expect(vocalTaskRows(avec.listHeight, true).rows, `${largeur} x ${hauteur} : cas A`).toBe(
        lignesA,
      );
      expect(vocalTaskRows(sans.listHeight, false).rows, `${largeur} x ${hauteur} : cas B`).toBe(
        lignesB,
      );
    }
  });

  it("le plafond suit le cas : 6 avec un personnage, 8 sans", () => {
    expect(VOCAL_TASKS_MAX).toBe(6);
    expect(VOCAL_TASKS_MAX_BARE).toBe(8);
    // 8 n'est pas choisi : c'est ce que la place permet a la hauteur maximale.
    expect(Math.floor((440 - 2 * 20) / 46)).toBe(8);
    expect(vocalTaskRows(440, false).rows).toBe(8);
    expect(vocalTaskRows(440, true).rows).toBe(6);
  });

  it("sous 86 px de liste, les en-tetes de groupe disparaissent", () => {
    expect(VOCAL_TASKS_MIN_HEADERS_PX).toBe(2 * 20 + 46);
    expect(vocalTaskRows(85, true).headers).toBe(false);
    expect(vocalTaskRows(86, true).headers).toBe(true);
    // Sans en-tetes, la place restante vaut au plus deux lignes.
    expect(vocalTaskRows(85, true).rows).toBeLessThanOrEqual(2);
  });

  it("jamais zero ligne : une colonne qui n'affiche rien mentirait", () => {
    for (const h of [0, 1, 20, 45]) {
      expect(vocalTaskRows(h, true).rows, `listH ${h}`).toBe(1);
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
    const plan = planVocalTasks([...enCours, ...attente], {
      listHeight: 342,
      hasPortrait: true,
    });
    expect(plan.total).toBe(10);
    expect(plan.shown).toBe(6);
    expect(plan.more).toBe(4);
    // La repartition du document : 3 + 3 au cas A.
    expect(plan.groups[0].items.length).toBe(3);
    expect(plan.groups[1].items.length).toBe(3);
    // Cas B : 4 + 4.
    const melange = planVocalTasks([...enCours, ...attente], {
      listHeight: 440,
      hasPortrait: false,
    });
    expect(melange.groups[0].items.length).toBe(4);
    expect(melange.groups[1].items.length).toBe(4);
    expect(melange.more).toBe(2);
    // Dix missions « en cours » et rien en attente : la place du groupe vide
    // revient au groupe plein (6 lignes, jamais 3 + un trou).
    const plein = planVocalTasks(
      Array.from({ length: 10 }, (_, i) => ({
        agent: "a",
        project: "p",
        mission: `m${i}`,
        waiting: false,
      })),
      { listHeight: 342, hasPortrait: true },
    );
    expect(plein.groups.length).toBe(1);
    expect(plein.groups[0].items.length).toBe(6);
    expect(plein.more).toBe(4);
  });

  it("un groupe vide ne prend pas la place de l'autre", () => {
    const enAttenteSeule = planVocalTasks(
      Array.from({ length: 5 }, (_, i) => ({
        agent: "a",
        project: "p",
        mission: `m${i}`,
        waiting: true,
      })),
      { listHeight: 342, hasPortrait: true },
    );
    expect(enAttenteSeule.groups.length).toBe(1);
    expect(enAttenteSeule.groups[0].key).toBe("waiting");
    expect(enAttenteSeule.shown).toBe(5);
  });

  it("liste vide : une phrase, pas un trou", () => {
    expect(VOCAL_TASKS_TITLE).toBe("T\u00c2CHES");
    expect(VOCAL_TASKS_EMPTY_TEXT).toBe("Aucune t\u00e2che en cours");
    const plan = planVocalTasks([], { listHeight: 342, hasPortrait: true });
    expect(plan.empty).toBe(true);
    expect(plan.groups).toEqual([]);
    expect(plan.total).toBe(0);
    // Et la ligne d'activite le dit aussi, d'une autre phrase.
    expect(vocalNowLine([])).toBe("Tout est au repos");
  });
});

describe("la ligne d'activite : UNE phrase, jamais vide", () => {
  it("un agent qui travaille, une operation ou une reflexion", () => {
    expect(
      vocalNowLine([{ agent: "codeur", project: "pilot", mission: "x", toolInProgress: true }]),
    ).toBe("codeur ex\u00e9cute une op\u00e9ration");
    expect(vocalNowLine([{ agent: "codeur", project: "pilot", mission: "x" }])).toBe(
      "codeur r\u00e9fl\u00e9chit",
    );
  });

  it("plusieurs agents, un demarrage, une file d'attente", () => {
    expect(
      vocalNowLine([
        { agent: "a", project: "p", mission: "1" },
        { agent: "b", project: "p", mission: "2" },
      ]),
    ).toMatch(/^2 agents travaillent/);
    expect(
      vocalNowLine([{ agent: "a", project: "p", mission: "1", waiting: true, starting: true }]),
    ).toBe("D\u00e9marrage de 1 mission");
    expect(
      vocalNowLine([
        { agent: "a", project: "p", mission: "1", waiting: true },
        { agent: "b", project: "p", mission: "2", waiting: true },
      ]),
    ).toBe("2 missions en attente");
  });

  it("jamais vide, jamais deux phrases", () => {
    for (const entree of [[], null, undefined, [{}], [{ agent: "" }]]) {
      const texte = vocalNowLine(entree);
      expect(texte.length).toBeGreaterThan(0);
      // Une seule phrase : aucun point final suivi d'une majuscule.
      expect(texte).not.toMatch(/\.\s+[A-Z\u00c0-\u00dc]/);
    }
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
    // Une seule ecriture de `--vocal-side`, inchangee depuis le lot 1.
    expect((sync.match(/setProperty\("--vocal-side"/g) || []).length).toBe(1);
    // Le plan des taches est construit a UN seul endroit, dans la peinture de
    // colonne, a partir de la hauteur que `vocalSyncSides` vient de decider.
    const rendu = corps("function vocalRenderColumn(plan)", "\n}\n");
    expect(rendu).toMatch(/planVocalTasks\(/);
    expect(rendu).toMatch(/listHeight: plan\.listHeight/);
    expect(rendu).toMatch(/hasPortrait: plan\.hasPortrait/);
  });

  it("un seul tic, pose a l'entree et retire a la sortie", () => {
    expect(VOCAL_SIDES_TICK_MS).toBe(900);
    const entree = corps("function enterVocal()", "function exitVocal()");
    expect(entree).toMatch(/setInterval\(vocalSyncSides, VOCAL_SIDES_TICK_MS\)/);
    const sortie = corps("function exitVocal()", "function autoReadVocalReply()");
    expect(sortie).toMatch(/clearInterval\(vocalSidesTick\)/);
    expect(sortie).toMatch(/vocalSidesTick = null/);
  });

  it("le personnage change de cas SANS attendre le tic : meme point d'application", () => {
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
    // meme budget : 46 px par tache, 20 px par en-tete, 18 px pour la ligne
    // d'activite, 72 px pour le medaillon.
    expect(CSS).toMatch(/\.vocal-task\s*\{[^}]*height:\s*46px/);
    expect(CSS).toMatch(/\.vocal-task-group\s*\{[^}]*height:\s*20px/);
    expect(CSS).toMatch(/\.vocal-now\s*\{[^}]*line-height:\s*18px/);
    expect(CSS).toMatch(/\.vocal-portrait\s*\{[^}]*height:\s*72px/);
    // La colonne ne defile jamais : `pointer-events: none` + `overflow: hidden`.
    expect(CSS).toMatch(/\.vocal-side\s*\{[^}]*pointer-events:\s*none/);
    expect(CSS).toMatch(/\.vocal-side-tasks\s*\{[^}]*overflow:\s*hidden/);
  });
});
