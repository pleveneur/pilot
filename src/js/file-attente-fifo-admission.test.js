// P1 (D1) — « toute demande respecte l'ORDRE D'ARRIVÉE ».
//
// Défaut prouvé (rapport-file-attente-pertes-doublons.md, §4.1) : à l'admission
// d'une demande, la file du projet n'était JAMAIS consultée — seul le verrou de
// run décidait (`super-agent.js` : `launchOrQueue`, `startRun` de `run_agents`,
// `startRun` de `run_assistant_agents`). Dès que ce verrou paraissait libre, la
// demande qui arrivait démarrait DEVANT les missions déjà en attente
// (lancements directs horodatés 08:45:07Z, 09:15:07Z, 09:21:05Z, 09:25:28Z).
//
// Ces preuves ÉCHOUENT si le défaut revient :
//   a. une demande qui arrive DERRIÈRE une mission en attente NE DÉMARRE PAS,
//      même quand le verrou du projet paraît libre (décision `queue-ahead`) ;
//   b. l'ordre d'exécution réel est [A, B] : A (mise en file d'abord) démarre
//      avant B (arrivée après), et B n'est lancée qu'à son tour ;
//   c. la décision « respecter l'ordre d'arrivée » est EXPLICITE et TRACÉE dans
//      le journal des arrêts automatiques du projet (`queue-order-respected`) ;
//   d. les TROIS points d'entrée d'une demande décident par le même point de
//      décision, et le rejeu d'une mission de la file n'est pas compté comme
//      « une mission devant » (sinon la tête se remettrait en file à l'infini).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `file-attente-arret-conserve.test.js` /
// `file-attente-regle-4.test.js` (aucun DOM, aucun accès Tauri réel).
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
  decideMissionAdmission,
  pendingMissionsAhead,
  getProjectMissionQueue,
  replayQueuedMissionForProject,
  traceMissionQueuedBehindPending,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";

const PROJECT = "G:\\IA_PL\\pilot";
const source = (rel) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const superAgentSrc = source("src/js/super-agent.js");

/** Dernière ligne ÉCRITE par l'application dans un journal d'arrêts. */
function lastJournal() {
  const lines = vi
    .mocked(invoke)
    .mock.calls.filter(([cmd, args]) => cmd === "write_file_content" && args && args.path && /agent-stops\.log$/.test(args.path))
    .map(([, args]) => String(args.content || ""));
  return lines.length ? lines[lines.length - 1] : "";
}

/**
 * Dépose une mission dans la file par le CHEMIN DE PRODUCTION
 * (`enqueueMissionForProject`, identité allouée par `allocateMissionIdentity`) —
 * aucune fixture ne fabrique l'entrée de file à la main.
 * @param {string} label - texte de la demande
 * @param {Function} launch - ce que fait la mission quand elle démarrera
 */
function queueMission(label, launch) {
  return enqueueMissionForProject(PROJECT, launch, label, allocateMissionIdentity(["codeur"]));
}

beforeEach(() => {
  __resetMissionIdsForTest();
  __resetSuperAgentQueueForTest();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  __resetSuperAgentQueueForTest();
});

// ── a. La file est consultée AVANT de décider de démarrer ───────────────────
describe("P1 (a) — une demande ne démarre plus devant une mission en attente", () => {
  it("file vide et projet libre : démarrage immédiat ; mission en attente : mise en file", () => {
    // File vide + projet libre → la demande démarre (comportement normal).
    expect(decideMissionAdmission(PROJECT, { busy: false })).toEqual({ queue: false, pending: 0, reason: "" });
    expect(pendingMissionsAhead(PROJECT)).toBe(0);

    // Une mission attend (déposée par le chemin de production).
    queueMission("A — corriger le parseur", async () => {});

    // Le verrou du projet paraît LIBRE (`busy: false`) : c'est exactement l'état
    // qui laissait passer un lancement direct et faisait « démarrer à sa place »
    // la demande suivante (D1). La file est désormais consultée : la demande
    // s'empile DERRIÈRE la mission en attente.
    expect(pendingMissionsAhead(PROJECT)).toBe(1);
    expect(decideMissionAdmission(PROJECT, { busy: false })).toEqual({
      queue: true,
      pending: 1,
      reason: "queue-ahead",
    });
  });

  it("projet réellement occupé : mise en file (comportement historique conservé)", () => {
    expect(decideMissionAdmission(PROJECT, { busy: true })).toEqual({ queue: true, pending: 0, reason: "busy" });
  });

  it("le rejeu de la tête de file n'est PAS compté comme « une mission devant » (sinon boucle)", () => {
    queueMission("A — corriger le parseur", async () => {});
    queueMission("B — écrire les tests", async () => {});
    // Lancement issu du rejeu (`dequeue`) : le projet est libre pour LUI.
    expect(pendingMissionsAhead(PROJECT, { dequeue: true })).toBe(0);
    expect(decideMissionAdmission(PROJECT, { busy: false, dequeue: true })).toEqual({
      queue: false,
      pending: 0,
      reason: "",
    });
    // La file, elle, est intacte : le rejeu ne retire rien.
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual([
      "A — corriger le parseur",
      "B — écrire les tests",
    ]);
  });
});

// ── b. Ordre d'exécution réel : A (en file) puis B (arrivée après) ──────────
describe("P1 (b) — l'ordre d'arrivée est respecté à l'exécution", () => {
  it("A mise en file, B arrive alors que le projet paraît libre → A démarre en premier, puis B", async () => {
    const executed = [];

    // 1) A est déposée pendant que le projet était occupé (mise en file).
    queueMission("A — corriger le parseur", async () => {
      executed.push("A");
    });

    // 2) B arrive : l'admission consulte la file → B ne démarre PAS.
    const admissionB = decideMissionAdmission(PROJECT, { busy: false });
    expect(admissionB).toEqual({ queue: true, pending: 1, reason: "queue-ahead" });
    if (admissionB.queue) {
      queueMission("B — publier la version", async () => {
        executed.push("B");
      });
    }

    // 3) Aucune des deux n'a démarré, et l'ordre de la file est [A, B].
    expect(executed).toEqual([]);
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual([
      "A — corriger le parseur",
      "B — publier la version",
    ]);

    // 4) Le projet est libre : le rejeu lance la TÊTE de file (A), pas B.
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({
      replayed: true,
      reason: "launched",
    });
    expect(executed).toEqual(["A"]);
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual(["B — publier la version"]);

    // 5) Puis B, à son tour (elle n'a pas été perdue, seulement attendue).
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({
      replayed: true,
      reason: "launched",
    });
    expect(executed).toEqual(["A", "B"]);
    expect(getProjectMissionQueue(PROJECT)).toEqual([]);
  });
});

// ── c. Décision explicite ET tracée ────────────────────────────────────────
describe("P1 (c) — la décision « respecter l'ordre d'arrivée » est écrite au journal", () => {
  it("la trace nomme les missions déjà en attente, avec le motif queue-order-respected", async () => {
    const ahead = ["#14 « corriger le test MCP Linux »", "#15 « relire le parseur »"];
    const trace = traceMissionQueuedBehindPending(PROJECT, ahead, "publier la version");
    expect(trace, "la décision doit laisser une trace écrite").toBeTruthy();
    await trace;

    const journal = lastJournal();
    expect(journal, "aucune ligne de journal n'a été écrite").not.toBe("");
    expect(journal).toContain("reason=queue-order-respected");
    expect(journal).toContain("detected=admission-fifo");
    // Les missions DÉJÀ en attente sont NOMMÉES : on sait ce qui n'a pas été doublé.
    expect(journal).toContain("corriger le test MCP Linux");
    expect(journal).toContain("relire le parseur");
  });

  it("aucune mission devant : aucune trace (un démarrage immédiat n'a rien à consigner)", async () => {
    await traceMissionQueuedBehindPending(PROJECT, [], "publier la version");
    expect(lastJournal()).toBe("");
  });
});

// ── d. Câblage des trois points d'entrée ───────────────────────────────────
describe("P1 (d) — les trois points d'entrée d'une demande consultent la file", () => {
  it("`run_agents` (×2) et `run_assistant_agents` décident par le même point", () => {
    const decisions = superAgentSrc.match(/const admission = decideMissionAdmission\(target, \{/g) || [];
    expect(decisions, "un point d'entrée ne consulte plus la file avant de démarrer").toHaveLength(3);
    // Les trois décisions d'AVANT (verrou de run SEUL, file jamais lue) ne doivent
    // pas revenir : chacune laissait une demande doubler une mission en attente.
    for (const ancienne of [
      "if (isRunInProgress(target, { nature: missionNature }) || busyManual) {",
      "if (blockedByFlag || blockedByBus) {",
      "if (runAgentsInFlightByProject[target] || isRunInProgress(target)) {",
    ]) {
      expect(superAgentSrc, `décision d'admission revenue au seul verrou (file ignorée) : ${ancienne}`).not.toContain(ancienne);
    }
    // Chaque point d'entrée empile au lieu de lancer quand la décision le dit.
    expect((superAgentSrc.match(/if \(admission\.queue\) \{/g) || []).length).toBe(3);
    // … et chaque empilement derrière une file non vide est tracé nommément.
    expect((superAgentSrc.match(/traceMissionQueuedBehindPending\(target, aheadLabels, task\);/g) || []).length).toBe(3);
    // Le rejeu d'une mission SORTIE de la file se déclare comme tel : sans cela,
    // la tête de file se compterait comme « devant » elle-même et se remettrait
    // en file indéfiniment.
    expect(superAgentSrc).toContain("result = entry.launch({ dequeue: true });");
    // La décision ordonne bien : file d'abord, occupation ensuite.
    const pendingIdx = superAgentSrc.indexOf('reason: "queue-ahead"');
    const busyIdx = superAgentSrc.indexOf('if (opts && opts.busy) return { queue: true, pending, reason: "busy" };');
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeGreaterThan(pendingIdx);
  });

  it("l'écran sait montrer la file (ce qui tourne, ce qui attend, dans quel ordre)", async () => {
    // La vue de file du projet compose les missions EN ATTENTE dans l'ordre de
    // démarrage, avec leur rang (« en attente (2e) »).
    const { readProjectQueueView, formatProjectQueueReport } = await import("./project-queue-view.js");
    queueMission("A — corriger le parseur", async () => {});
    queueMission("B — publier la version", async () => {});
    const view = readProjectQueueView(PROJECT);
    expect(view.waiting.map((e) => e.label)).toEqual(["A — corriger le parseur", "B — publier la version"]);
    expect(view.waiting[0].rank).toBeLessThan(view.waiting[1].rank);
    const report = formatProjectQueueReport(PROJECT);
    expect(report).toContain("en attente (1er)");
    expect(report).toContain("publier la version");
  });
});
