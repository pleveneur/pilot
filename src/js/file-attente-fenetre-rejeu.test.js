// P1 — FENÊTRE DE COURSE DU REJEU : « toute demande respecte l'ordre d'arrivée,
// y compris pendant un rejeu ».
//
// ANGLE MORT signalé par la relecture indépendante (`rapport-relecture-file.md`) :
// une correction limitée à « file non vide, donc j'enfile » reste trouée. Le
// rejeu RETIRE la mission en tête de file (`queue.shift()`), PUIS la lance : entre
// ces deux instants la file paraît VIDE et le bus paraît LIBRE (`launchOrQueue`
// ne sonde que `isRunInProgress` + l'activité manuelle). Une demande qui arrivait
// exactement dans cette fenêtre ne voyait donc aucun occupant et DÉMARRAIT devant
// la mission rejouée — l'ordre d'arrivée violé par un autre chemin que D1.
//
// Correctif prouvé ici : une RÉSERVATION est posée synchronement au retrait de la
// tête (`claimDequeuedMission`, appelée par le point unique de lancement
// `launchQueuedMission`) et levée quand le lancement est CONCLU (run inscrite au
// bus, ou échec traité). Elle compte comme une mission DEVANT toute demande qui
// arrive, et jamais devant la mission elle-même (`dequeue`).
//
// Ces preuves ÉCHOUENT si la fenêtre se rouvre :
//   a. une demande arrivée pendant l'inscription au bus s'empile (`queue-ahead`)
//      alors que la file est VIDE — sans réservation, `pending` vaudrait 0 et la
//      demande démarrerait devant la mission rejouée ;
//   b. l'ordre d'exécution réel reste [mission rejouée, demande arrivée] ;
//   c. la réservation est levée à la conclusion du lancement (aucune attente
//      fantôme) et retirée même en cas d'échec (mission alors remise en file) ;
//   d. la mission rejouée n'est jamais bloquée par sa propre réservation
//      (`dequeue`), sinon le rejeu se remettrait en file à l'infini ;
//   e. une réservation périmée (lancement qui ne s'est jamais conclu) ne retient
//      pas indéfiniment les demandes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `file-attente-fifo-admission.test.js` / `file-attente-regle-4.test.js`
// (aucun DOM, aucun accès Tauri réel).
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
  pendingMissionClaims,
  pendingMissionAheadLabels,
  claimDequeuedMission,
  getProjectMissionQueue,
  replayQueuedMissionForProject,
  __resetSuperAgentQueueForTest,
  __superAgentQueueStateForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";

const PROJECT = "G:\\IA_PL\\pilot";
const source = (rel) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const superAgentSrc = source("src/js/super-agent.js");

/** Dépose une mission par le CHEMIN DE PRODUCTION (aucune fixture à la main). */
function queueMission(label, launch) {
  return enqueueMissionForProject(PROJECT, launch, label, allocateMissionIdentity(["codeur"]));
}

/** Laisse tourner une macrotâche : les `then` de fin de lancement sont exécutés. */
const flush = () => new Promise((res) => setTimeout(res, 0));

/**
 * Ouvre la FENÊTRE DE COURSE : une mission est retirée de la file par le rejeu et
 * son lancement reste EN COURS (promesse non résolue) — exactement l'instant où
 * la file paraît vide et le bus paraît libre.
 * @param {string} label - libellé de la mission rejouée
 * @param {string[]} executed - journal d'exécution réel
 * @returns {Promise<{release: () => void, claims: number}>} le déclencheur de fin
 */
async function openReplayWindow(label, executed) {
  let release;
  const gate = new Promise((res) => {
    release = res;
  });
  queueMission(label, () => {
    executed.push(label);
    return gate;
  });
  // Rejeu RÉEL par le point de production : la tête sort de la file, le lancement
  // est en cours.
  const r = await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
  expect(r).toMatchObject({ replayed: true, reason: "launched" });
  return { release: () => release({ started: true }), claims: __superAgentQueueStateForTest(PROJECT).claims };
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

// ── a. Aucun doublon pendant la fenêtre de course du rejeu ──────────────────
describe("P1 — une demande arrivée pendant l'inscription au bus ne double pas la mission rejouée", () => {
  it("file VIDE + bus LIBRE pendant le rejeu : la demande s'empile quand même", async () => {
    const executed = [];
    const { release } = await openReplayWindow("A — mission rejouée", executed);
    // A a quitté la file : elle est VIDE à cet instant (c'est tout le défaut).
    expect(getProjectMissionQueue(PROJECT)).toEqual([]);
    // …mais sa run n'est pas encore inscrite au bus : elle est DEVANT.
    expect(pendingMissionsAhead(PROJECT), "la mission rejouée n'est plus comptée comme occupant").toBe(1);
    expect(decideMissionAdmission(PROJECT, { busy: false })).toEqual({
      queue: true,
      pending: 1,
      reason: "queue-ahead",
    });

    // La demande qui arrive est réellement mise en file (chemin de production).
    const arrival = queueMission("B — demande arrivée dans la fenêtre", async () => {
      executed.push("B — demande arrivée dans la fenêtre");
    });
    expect(arrival.count).toBe(1);
    // Rien n'a démarré en plus : A tourne, B attend derrière elle.
    expect(executed).toEqual(["A — mission rejouée"]);
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual(["B — demande arrivée dans la fenêtre"]);
    release();
  });

  it("la trace NOMME la mission en cours de démarrage (ce qui n'est pas doublé est nommé)", async () => {
    const executed = [];
    const { release } = await openReplayWindow("A — mission rejouée", executed);
    const labels = pendingMissionAheadLabels(PROJECT);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain("A — mission rejouée");
    expect(labels[0]).toContain("en cours de démarrage");
    release();
  });

  it("ordre d'exécution réel : la mission rejouée passe AVANT la demande arrivée dans la fenêtre", async () => {
    const executed = [];
    const { release } = await openReplayWindow("A — mission rejouée", executed);
    // B arrive dans la fenêtre → mise en file (elle ne démarre pas).
    if (decideMissionAdmission(PROJECT, { busy: false }).queue) {
      queueMission("B — demande arrivée dans la fenêtre", async () => {
        executed.push("B — demande arrivée dans la fenêtre");
      });
    }
    expect(executed).toEqual(["A — mission rejouée"]);

    // A s'inscrit au bus puis se termine : la file est drainée dans l'ordre.
    release();
    await flush();
    expect(__superAgentQueueStateForTest(PROJECT).claims).toBe(0);
    const next = await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
    expect(next).toMatchObject({ replayed: true, reason: "launched" });
    await flush();
    expect(executed).toEqual(["A — mission rejouée", "B — demande arrivée dans la fenêtre"]);
  });
});

// ── b. La réservation est bornée : jamais d'attente fantôme ─────────────────
describe("P1 — la réservation est levée à la conclusion du lancement", () => {
  it("réservation posée pendant l'inscription, levée dès que la run est inscrite au bus", async () => {
    const executed = [];
    const { release, claims } = await openReplayWindow("A — mission rejouée", executed);
    expect(claims, "aucune réservation posée au retrait de la tête").toBe(1);

    release();
    await flush();
    // Plus de réservation : les demandes suivantes ne sont plus retenues par une
    // inscription terminée.
    expect(__superAgentQueueStateForTest(PROJECT).claims).toBe(0);
    expect(pendingMissionsAhead(PROJECT)).toBe(0);
    expect(decideMissionAdmission(PROJECT, { busy: false })).toEqual({ queue: false, pending: 0, reason: "" });
  });

  it("un lancement en ÉCHEC ne laisse pas de réservation et conserve la mission en file", async () => {
    queueMission("A — mission rejouée", () => Promise.reject(new Error("backend indisponible")));
    const r = await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
    expect(r).toMatchObject({ replayed: true, reason: "launched" });
    await flush();
    // Mission remise en file (jamais perdue) …
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual(["A — mission rejouée"]);
    // … et aucune réservation résiduelle (sinon le projet resterait « réservé »).
    expect(__superAgentQueueStateForTest(PROJECT).claims).toBe(0);
    expect(__superAgentQueueStateForTest(PROJECT).inFlight).toBe(false);
  });

  it("une réservation PÉRIMÉE ne retient plus les demandes", () => {
    claimDequeuedMission(PROJECT, "A — lancement perdu", Date.now() - 5 * 60 * 1000);
    expect(pendingMissionClaims(PROJECT)).toEqual([]);
    expect(pendingMissionsAhead(PROJECT)).toBe(0);
    expect(__superAgentQueueStateForTest(PROJECT).claims).toBe(0);
  });
});

// ── c. Anti-boucle : le rejeu ne se compte pas lui-même ─────────────────────
describe("P1 — la mission rejouée n'est jamais bloquée par sa propre réservation", () => {
  it("`dequeue` ignore la réservation (sinon le rejeu se remettrait en file à l'infini)", async () => {
    const executed = [];
    const { release } = await openReplayWindow("A — mission rejouée", executed);
    // Pendant la fenêtre, la demande rejouée est exemptée : c'est ELLE l'occupant.
    expect(pendingMissionsAhead(PROJECT, { dequeue: true })).toBe(0);
    expect(decideMissionAdmission(PROJECT, { busy: false, dequeue: true })).toEqual({
      queue: false,
      pending: 0,
      reason: "",
    });
    release();
    await flush();
  });
});

// ── d. Câblage : une seule réservation, au point unique de lancement ───────
describe("P1 — câblage de la fermeture de la fenêtre", () => {
  it("la réservation est posée au point UNIQUE de lancement et libérée à la conclusion", () => {
    // Un seul site de pose : le lancement protégé d'une mission sortie de file.
    expect((superAgentSrc.match(/= claimDequeuedMission\(/g) || []).length).toBe(1);
    const launchIdx = superAgentSrc.indexOf("function launchQueuedMission(target, entry)");
    expect(launchIdx).toBeGreaterThan(-1);
    const launchBody = superAgentSrc.slice(launchIdx, superAgentSrc.indexOf("// Point de suivi 344 (volet c) — points d'entrée de TEST", launchIdx));
    // Posée AVANT le lancement …
    expect(launchBody).toContain("const releaseClaim = claimDequeuedMission(target, missionQueueLabel(entry));");
    expect(launchBody.indexOf("const releaseClaim")).toBeLessThan(launchBody.indexOf("result = entry.launch({ dequeue: true });"));
    // … libérée sur les TROIS issues : succès, échec, exception synchrone.
    expect(launchBody).toContain("result.then(() => releaseClaim(), onFailure);");
    expect((launchBody.match(/releaseClaim\(\)/g) || []).length).toBe(3);
  });

  it("la décision d'admission compte la file ET la mission en cours d'inscription", () => {
    // Le point unique d'admission additionne la file et les réservations …
    expect(superAgentSrc).toContain("return queued + pendingMissionClaims(projectPath).length;");
    // … et il est le SEUL à décider pour les trois points d'entrée.
    expect((superAgentSrc.match(/const admission = decideMissionAdmission\(target, \{/g) || []).length).toBe(3);
    // Les trois points nomment aussi la mission en cours d'inscription dans la
    // trace (sinon la décision serait tracée sans dire ce qui n'est pas doublé).
    expect((superAgentSrc.match(/const aheadLabels = pendingMissionAheadLabels\(target\);/g) || []).length).toBe(3);
    // Aucune décision d'admission revenue « verrou seul » sur `launchOrQueue`.
    expect(superAgentSrc).not.toContain("if (isRunInProgress(target, { nature: missionNature }) || busyManual) {");
  });

  it("le rejeu libère la réservation même quand la promesse de lancement est déjà résolue", async () => {
    // Lancement SYNCHRONE (pas de promesse) : la réservation ne doit pas rester.
    queueMission("A — mission rejouée", () => undefined);
    const r = await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true });
    expect(r).toMatchObject({ replayed: true, reason: "launched" });
    expect(__superAgentQueueStateForTest(PROJECT).claims).toBe(0);
  });
});
