// RETRAIT CIBLE d'UNE mission en attente — « la file doit savoir oublier UNE
// demande, pas seulement TOUTES ».
//
// Constat terrain (revue independante du 2026-10-23) : la file d'un projet ne
// savait oublier qu'EN ENTIER (`abandonProjectMissionQueue`, commande
// `/file vide`). Une demande devenue sans objet gardait sa place et prenait le
// verrou du projet a son tour (`.pilot/agent-stops.log`, 2026-10-22T11:02:54,
// `reason=queue-order-respected detected=admission-fifo` : quatre vieilles
// missions ont bloque le travail utile).
//
// Ces preuves ECHOUENT si la regle casse :
//   a. retirer une mission du MILIEU laisse les autres en file ET dans leur ordre ;
//   b. la place liberee est rendue PROPREMENT : le verrou du projet n'est ni pris
//      ni perdu, la suivante demarre des que le projet est libre ;
//   c. le retrait laisse une ligne de journal (motif + contexte + nom) dans le
//      journal des arrets automatiques du projet — et rien d'autre ;
//   d. retirer la mission EN COURS est REFUSE (c'est le geste « arreter un agent ») ;
//   e. aucune autre demande n'est supprimee au passage (missions, commandes) ;
//   f. `/file retire <rang>` retire la mission du RANG AFFICHE, et le retrait est
//      joignable par l'assistant (`remove_queued_mission`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Meme harnais que `file-attente-fifo-admission.test.js` (aucun DOM, aucun acces
// Tauri reel).
vi.hoisted(() => {
  const noop = () => {};
  const el = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    getAttribute: () => null,
    focus: noop,
    scrollIntoView: noop,
    insertAdjacentHTML: noop,
    innerHTML: "",
    textContent: "",
    value: "",
  });
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: el,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: el(),
    documentElement: el(),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn(async () => "/app-data") }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  enqueueMissionForProject,
  allocateMissionIdentity,
  getProjectMissionQueue,
  removeQueuedMission,
  replayQueuedMissionForProject,
  __superAgentQueueStateForTest,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";
import {
  enqueueProjectCommand,
  listProjectCommands,
  pumpProjectQueue,
  setProjectQueueProbe,
  abandonProjectCommands,
  __resetProjectQueueForTest,
} from "./project-task-queue.js";
import { readProjectQueueView, removeProjectQueuedMission } from "./project-queue-view.js";

const PROJECT = "G:\\IA_PL\\pilot";
const source = (rel) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const superAgentSrc = source("src/js/super-agent.js");
const agentPiSrc = source("src/js/agent-pi.js");
const queueViewSrc = source("src/js/project-queue-view.js");
const extensionSrc = source("src-tauri/extensions/pilot-assistant-actions.ts");

/** Y a-t-il une ecriture de journal ? (toutes commandes confondues) */
function journalWrites() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd, args]) => cmd === "write_file_content" && args && args.path && /agent-stops\.log$/.test(args.path))
    .map(([, args]) => String(args.content || ""));
}

/** Derniere ligne ECRITE par l'application dans un journal d'arrets. */
function lastJournal() {
  const lines = journalWrites();
  return lines.length ? lines[lines.length - 1] : "";
}

/** Laisse tourner les ecritures de journal (chaine asynchrone du journal). */
async function flushAsync() {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Depose une mission dans la file par le CHEMIN DE PRODUCTION
 * (`enqueueMissionForProject` + identite allouee) — aucune fixture ne fabrique
 * une entree de file a la main.
 */
function queueMission(label, launch) {
  return enqueueMissionForProject(PROJECT, launch || (async () => {}), label, allocateMissionIdentity(["codeur"]));
}

const labels = () => getProjectMissionQueue(PROJECT).map((e) => e.label);

beforeEach(() => {
  __resetMissionIdsForTest();
  __resetSuperAgentQueueForTest();
  __resetProjectQueueForTest();
  setProjectQueueProbe(null);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  __resetSuperAgentQueueForTest();
  __resetProjectQueueForTest();
  setProjectQueueProbe(null);
});

// ── a. Une seule mission retiree, les autres intactes ET dans leur ordre ────
describe("a. retirer UNE mission laisse les autres en file, dans leur ordre", () => {
  it("la mission du MILIEU disparait, les deux autres gardent leur place et leur ordre", () => {
    const a = queueMission("A — corriger le parseur");
    const b = queueMission("B — relire le rapport");
    const c = queueMission("C — publier la version");

    const result = removeQueuedMission(PROJECT, { id: b.id });

    expect(result.ok, "le retrait d'une mission en attente doit reussir").toBe(true);
    expect(result.removed).toBe(1);
    expect(result.id).toBe(b.id);
    expect(result.remaining).toBe(2);
    // Les AUTRES missions sont toujours la, dans le MEME ordre (aucun tri, aucun
    // glissement d'une mission sur l'autre).
    expect(labels()).toEqual(["A — corriger le parseur", "C — publier la version"]);
    expect(getProjectMissionQueue(PROJECT).map((e) => e.id)).toEqual([a.id, c.id]);
  });

  it("aucune autre demande n'est supprimee au passage (mission retiree nommee, file des commandes intacte)", () => {
    queueMission("A — corriger le parseur");
    const b = queueMission("B — relire le rapport");
    queueMission("C — publier la version");
    // Une COMMANDE manuelle attend aussi : le retrait d'une mission ne doit pas
    // la toucher (chaque famille garde son propre geste).
    enqueueProjectCommand({ project: PROJECT, text: "corrige le bug 12", launch: async () => true });
    expect(listProjectCommands(PROJECT)).toHaveLength(1);

    const result = removeQueuedMission(PROJECT, { id: b.id });

    expect(result.label, "la mission retiree doit etre NOMMEE dans le resultat").toContain("relire le rapport");
    expect(labels()).toEqual(["A — corriger le parseur", "C — publier la version"]);
    expect(listProjectCommands(PROJECT).map((e) => e.label), "la commande en attente ne doit pas partir avec la mission").toHaveLength(1);
  });

  it("retirer la DERNIERE mission ne demarre rien et ne perd pas les precedentes", () => {
    const executed = [];
    queueMission("A — corriger le parseur", async () => executed.push("A"));
    queueMission("B — relire le rapport", async () => executed.push("B"));
    const c = queueMission("C — publier la version", async () => executed.push("C"));

    const result = removeQueuedMission(PROJECT, { id: c.id });

    expect(result.ok).toBe(true);
    expect(labels()).toEqual(["A — corriger le parseur", "B — relire le rapport"]);
    expect(executed, "un retrait ne lance jamais rien").toEqual([]);
  });
});

// ── b. La place liberee est rendue PROPREMENT (verrou ni pris ni perdu) ────
describe("b. le verrou du projet n'est ni pris ni perdu par le retrait", () => {
  it("projet libre : retirer une mission ne prend PAS le verrou, et la suivante demarre ensuite", async () => {
    const executed = [];
    queueMission("A — corriger le parseur", async () => executed.push("A"));
    const b = queueMission("B — relire le rapport", async () => executed.push("B"));

    const result = removeQueuedMission(PROJECT, { id: b.id });

    expect(result.ok).toBe(true);
    const state = __superAgentQueueStateForTest(PROJECT);
    expect(state.inFlight, "le retrait ne doit pas marquer le projet « run en vol »").toBe(false);
    expect(state.claims, "le retrait ne doit pas poser de reservation de lancement").toBe(0);
    expect(executed, "retirer une mission ne demarre rien").toEqual([]);

    // La place occupee par la mission retiree n'est pas perdue pour autant : la
    // suivante repart des que le projet est libre.
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({
      replayed: true,
      reason: "launched",
    });
    expect(executed).toEqual(["A"]);
  });

  it("projet occupe : retirer une mission en attente ne relache pas le verrou de la tache en cours", async () => {
    const executed = [];
    // A sort de la file par le rejeu et ne se termine jamais : la place est prise.
    queueMission("A — corriger le parseur", () => {
      executed.push("A");
      return new Promise(() => {});
    });
    const b = queueMission("B — relire le rapport");
    queueMission("C — publier la version");
    await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
    expect(__superAgentQueueStateForTest(PROJECT).inFlight, "A doit tenir le verrou").toBe(true);

    const result = removeQueuedMission(PROJECT, { id: b.id });

    expect(result.ok).toBe(true);
    expect(__superAgentQueueStateForTest(PROJECT).inFlight, "le verrou de la tache en cours doit rester tenu").toBe(true);
    expect(labels()).toEqual(["C — publier la version"]);
    expect(executed, "la tache en cours continue, elle n'est ni arretee ni relancee").toEqual(["A"]);
  });
});

// ── c. Le retrait laisse une trace ecrite (et une seule) ──────────────────
describe("c. le retrait est journalise (motif, contexte, mission nommee)", () => {
  it("une ligne porte le motif queue-mission-removed, le contexte et le NOM de la mission retiree", async () => {
    queueMission("A — corriger le parseur");
    const b = queueMission("B — relire le rapport");
    queueMission("C — publier la version");

    removeQueuedMission(PROJECT, { id: b.id });
    await flushAsync();

    const journal = lastJournal();
    expect(journal, "aucune ligne de journal : le retrait serait silencieux").not.toBe("");
    expect(journal).toContain("reason=queue-mission-removed");
    expect(journal).toContain("detected=remove-one");
    expect(journal).toContain("relire le rapport");
    // Seule la mission RETIREE est nommee : les autres n'ont pas ete touchees.
    expect(journal).not.toContain("corriger le parseur");
    expect(journal).not.toContain("publier la version");
  });

  it("un retrait REFUSE n'ecrit aucune ligne de retrait (rien n'a bouge)", async () => {
    const result = removeQueuedMission(PROJECT, { id: 999 });
    await flushAsync();

    expect(result.ok).toBe(false);
    expect(journalWrites().filter((line) => line.includes("queue-mission-removed"))).toEqual([]);
  });
});

// ── d. La mission EN COURS ne se retire pas par ce chemin ─────────────────
describe("d. retirer la mission EN COURS est refuse (autre geste : arreter un agent)", () => {
  it("la mission deja sortie de la file (en cours) est refusee, sans rien retirer d'autre", async () => {
    const executed = [];
    const a = queueMission("A — corriger le parseur", () => {
      executed.push("A");
      return new Promise(() => {});
    });
    queueMission("B — relire le rapport");
    await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
    expect(executed).toEqual(["A"]);

    const result = removeQueuedMission(PROJECT, { id: a.id });

    expect(result.ok, "retirer la mission en cours doit etre REFUSE").toBe(false);
    expect(result.removed).toBe(0);
    expect(result.reason).toBe("mission-running");
    expect(result.message).toContain("ATTENTE");
    // Rien d'autre n'a ete retire, et la tache en cours tourne toujours.
    expect(labels()).toEqual(["B — relire le rapport"]);
    expect(__superAgentQueueStateForTest(PROJECT).inFlight).toBe(true);
    expect(executed).toEqual(["A"]);
  });

  it("file vide : le refus dit qu'arreter la tache en cours est un autre geste", () => {
    const result = removeQueuedMission(PROJECT, { id: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty");
    expect(result.message).toContain("Aucune mission en attente");
  });
});

// ── f. Le rang AFFICHE par /file designe la bonne mission ──────────────────
describe("f. `/file retire <rang>` retire la mission du rang affiche, jamais une autre", () => {
  /** Installe une tache EN COURS reelle (commande deja lancee) : elle occupe le rang 1. */
  async function startRunningCommand() {
    setProjectQueueProbe(async () => true);
    enqueueProjectCommand({ project: PROJECT, text: "corrige le bug 12", launch: async () => true });
    const pumped = await pumpProjectQueue(PROJECT);
    expect(pumped.launched, "la tache en cours doit etre reellement lancee").toBe(true);
  }

  it("le rang 1 est la tache EN COURS : il n'est pas retirable (refus net, rien ne bouge)", async () => {
    await startRunningCommand();
    queueMission("A — corriger le parseur");
    queueMission("B — relire le rapport");
    const view = readProjectQueueView(PROJECT);
    expect(view.running).toHaveLength(1);
    expect(view.waiting.map((e) => [e.rank, e.kind])).toEqual([
      [2, "mission"],
      [3, "mission"],
    ]);

    const result = removeProjectQueuedMission(PROJECT, { rank: 1 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("running");
    expect(labels()).toEqual(["A — corriger le parseur", "B — relire le rapport"]);
    // La commande en cours n'a pas ete abandonnee par ce geste.
    expect(listProjectCommands(PROJECT)).toEqual([]);
  });

  it("le rang 3 affiche retire la DEUXIEME mission, pas la premiere", async () => {
    await startRunningCommand();
    queueMission("A — corriger le parseur");
    const b = queueMission("B — relire le rapport");
    queueMission("C — publier la version");

    const result = removeProjectQueuedMission(PROJECT, { rank: 3, detected: "file-retire" });

    expect(result.ok).toBe(true);
    expect(result.id).toBe(b.id);
    expect(result.label).toContain("relire le rapport");
    expect(labels()).toEqual(["A — corriger le parseur", "C — publier la version"]);
    expect(result.remaining).toBe(2);
    await flushAsync();
    expect(lastJournal()).toContain("reason=queue-mission-removed");
    expect(lastJournal()).toContain("detected=file-retire");
  });

  it("un rang hors file est refuse sans rien retirer", async () => {
    queueMission("A — corriger le parseur");
    const result = removeProjectQueuedMission(PROJECT, { rank: 9 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-rank");
    expect(labels()).toEqual(["A — corriger le parseur"]);
  });

  it("sans rang ni numero de mission : refus (aucune supposition, rien n'est retire)", () => {
    queueMission("A — corriger le parseur");
    const result = removeProjectQueuedMission(PROJECT, {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-selector");
    expect(labels()).toEqual(["A — corriger le parseur"]);
  });

  it("le retrait d'une mission ne touche pas au vidage complet (les deux gestes coexistent)", async () => {
    const { abandonProjectQueue } = await import("./project-queue-view.js");
    const b = queueMission("B — relire le rapport");
    queueMission("C — publier la version");
    enqueueProjectCommand({ project: PROJECT, text: "corrige le bug 12", launch: async () => true });
    const abandoned = abandonProjectCommands(PROJECT);
    enqueueProjectCommand({ project: PROJECT, text: "autre demande", launch: async () => true });

    removeQueuedMission(PROJECT, { id: b.id });
    expect(labels()).toEqual(["C — publier la version"]);

    // `/file vide` continue de tout abandonner (aucune regression du geste existant).
    const counts = abandonProjectQueue(PROJECT);
    expect(counts.missions).toBe(1);
    expect(counts.commands).toBe(1);
    expect(abandoned).toBe(1);
    expect(labels()).toEqual([]);
  });
});

// ── f bis. Cablage : commande locale, vue de file, outil de l'assistant ────
describe("f bis. le retrait est joignable la ou la file est visible", () => {
  it("`/file retire <rang>` est une commande LOCALE du chat d'agent", () => {
    expect(agentPiSrc, "la commande `/file retire` a disparu du chat").toContain("/^\\/file\\s+retire\\s+(\\d+)$/i");
    expect(agentPiSrc).toContain("removeProjectQueuedMission(queueProject, {");
    // La commande reste locale : elle ne part jamais vers le moteur.
    const block = agentPiSrc.slice(agentPiSrc.indexOf("const oneMissionRetire"));
    expect(block.slice(0, 700)).toContain("return;");
  });

  it("la vue de file reste la SEULE a traduire un rang affiche en mission", () => {
    expect(queueViewSrc).toContain("export function removeProjectQueuedMission(project, selector = {})");
    expect(queueViewSrc).toContain("removeQueuedMission(target, { index: position");
    // Le vidage complet est intact (aucune modification du geste `/file vide`).
    expect(queueViewSrc).toContain("abandonProjectMissionQueue(target, { detected: \"file-vide\" })");
  });

  it("le retrait n'est pas un vidage : `abandonProjectMissionQueue` est inchange", () => {
    expect(superAgentSrc).toContain("export function abandonProjectMissionQueue(projectPath, opts = {})");
    const removeIdx = superAgentSrc.indexOf("export function removeQueuedMission(");
    const abandonIdx = superAgentSrc.indexOf("export function abandonProjectMissionQueue(");
    expect(removeIdx, "removeQueuedMission doit exister").toBeGreaterThan(-1);
    expect(abandonIdx, "abandonProjectMissionQueue doit rester").toBeGreaterThan(-1);
    // Le retrait passe par le point UNIQUE de journalisation (aucun 2e journal).
    const removeEnd = superAgentSrc.indexOf("export async function abandonQueuedRunAgentsMissions(");
    expect(removeEnd).toBeGreaterThan(removeIdx);
    const removeBody = superAgentSrc.slice(removeIdx, removeEnd);
    expect(removeBody).toContain("traceQueueAbandon({");
    expect(removeBody).not.toContain("write_file_content");
  });

  it("l'assistant peut retirer une mission par le chemin d'action existant", () => {
    expect(extensionSrc, "l'outil remove_queued_mission n'est pas declare").toContain('name: "remove_queued_mission"');
    expect(extensionSrc).toContain('const QUEUE_REMOVE_SENTINEL = "PILOT_ASSISTANT_QUEUE_REMOVE::";');
    expect(superAgentSrc, "Pilot n'intercepte pas le sentinel de retrait").toContain(
      'const QUEUE_REMOVE_SENTINEL = "PILOT_ASSISTANT_QUEUE_REMOVE::";',
    );
    expect(superAgentSrc).toContain('const { removeProjectQueuedMission } = await import("./project-queue-view.js");');
  });
});
