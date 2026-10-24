// update-window-bus.test.js — mise à jour de Pilot : seul le blocage pendant
// l'INSTALLATION est garanti (aucun chemin de LANCEMENT ne démarre) ; un écran
// de mise à jour simplement OUVERT ne bloque plus rien (décision du
// propriétaire, 2026-11 : décision non bloquante et réversible).
//
// Complète `update-window.test.js` (règle pure + écran). Ici on prouve les
// chemins d'exécution RÉELS :
//   g. `startAgentsRun` (bus) DÉMARRE malgré un écran ouvert, et refuse pendant
//      une installation en nommant le motif exact ;
//   h. le rejeu de la file de MISSIONS ne lance pas et ne CONSOMME pas la
//      mission pendant l'installation (elle reste en tête, prête à repartir) ;
//   i. le rejeu de la file de DÉLÉGATIONS ne transmet rien pendant l'installation ;
//   j. source : tout point d'admission de mission ET tout rejeu consulte la
//      réservation (un oubli fait échouer ce test) — pas de second gardien.
//
// Ces preuves ÉCHOUENT si l'un des gardes d'INSTALLATION est retiré.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Aucun backend réel : même harnais minimal que les autres tests du bus
// (env Node, sans Tauri, sans DOM complet).
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

// `list_agent_sessions` -> aucune session active : le TERRAIN est libre côté
// activité, seule la réservation de mise à jour peut donc refuser.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => {
    if (cmd === "list_agent_sessions") return { sessions: [] };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn(async () => "/app-data") }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { startAgentsRun } from "./agents-bus.js";
import {
  allocateMissionIdentity,
  enqueueMissionForProject,
  delegationState,
  getProjectMissionQueue,
  replayDelegationQueueForProject,
  replayQueuedMissionForProject,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";
import {
  UPDATE_INSTALLING_BLOCKED_MESSAGE,
  UPDATE_WINDOW_BLOCKED_MESSAGE,
  UPDATE_WINDOW_REASONS,
  __resetUpdateWindowForTest,
  isUpdateWindowReserved,
  releaseUpdateWindow,
  reserveUpdateWindow,
} from "./update-window.js";
import { manualCommandBlockedMessage } from "./run-policy.js";

const PROJECT = "G:\\IA_PL\\pilot";
const flush = () => new Promise((res) => setTimeout(res, 0));
const source = (rel) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  __resetUpdateWindowForTest();
  __resetSuperAgentQueueForTest();
  __resetMissionIdsForTest();
  globalThis._pilotProjectPath = PROJECT;
});

describe("g — le bus ne démarre QUE pendant une installation (l'écran ouvert ne bloque rien)", () => {
  it("écran ouvert : `startAgentsRun` démarre normalement (l'écran n'occupe plus le terrain)", async () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.WINDOW, { version: "0.4.41" });
    // Le motif `WINDOW` ne réserve RIEN : le bus ne refuse plus.
    expect(isUpdateWindowReserved()).toBe(false);
    const res = await startAgentsRun("fais ceci").then(
      () => "started",
      (e) => String((e && e.message) || e)
    );
    // AVANT correctif : `UPDATE_WINDOW_BLOCKED_MESSAGE` (rien ne démarrait).
    expect(res).not.toBe(UPDATE_WINDOW_BLOCKED_MESSAGE);
    expect(res).not.toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);
  });

  it("installation en cours : motif distinct (attendre le redémarrage)", async () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING, { version: "0.4.41" });
    await expect(startAgentsRun("fais ceci")).rejects.toThrow(UPDATE_INSTALLING_BLOCKED_MESSAGE);
    expect(manualCommandBlockedMessage()).toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);
  });

  it("installation terminée : le bus redémarre (aucun blocage résiduel)", async () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);
    await expect(startAgentsRun("fais ceci")).rejects.toThrow(UPDATE_INSTALLING_BLOCKED_MESSAGE);
    releaseUpdateWindow();
    // La run démarre réellement (elle échouera plus loin, faute de backend, mais
    // le REFUS de la fenêtre n'est plus la cause).
    const res = await startAgentsRun("fais ceci").then(
      () => "started",
      (e) => String((e && e.message) || e)
    );
    expect(res).not.toBe(UPDATE_WINDOW_BLOCKED_MESSAGE);
    expect(res).not.toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);
  });
});

describe("h — le rejeu de la file de MISSIONS ne lance rien et ne perd rien", () => {
  it("mission en file + INSTALLATION en cours : pas de lancement, mission TOUJOURS en file", async () => {
    const launched = vi.fn(async () => {});
    enqueueMissionForProject(PROJECT, launched, "mission de test", allocateMissionIdentity(["codeur"]));
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);

    const res = await replayQueuedMissionForProject(PROJECT);
    await flush();

    expect(res).toEqual({ replayed: false, reason: "busy" }); // AVANT correctif : lancée
    expect(launched).not.toHaveBeenCalled();
    expect(getProjectMissionQueue(PROJECT)).toHaveLength(1); // rien de consommé
  });

  it("installation terminée : la mission repart d'elle-même (aucune perte)", async () => {
    const launched = vi.fn(async () => {});
    enqueueMissionForProject(PROJECT, launched, "mission de test", allocateMissionIdentity(["codeur"]));
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);
    await replayQueuedMissionForProject(PROJECT);
    expect(launched).not.toHaveBeenCalled();

    releaseUpdateWindow();
    const res = await replayQueuedMissionForProject(PROJECT);
    await flush();

    expect(res.replayed).toBe(true);
    expect(launched).toHaveBeenCalledTimes(1);
    expect(getProjectMissionQueue(PROJECT)).toHaveLength(0);
  });
});

describe("i — le rejeu de la file de DÉLÉGATIONS ne transmet rien", () => {
  it("délégation en file + réservation : filtre de rejeu, demande conservée", async () => {
    const ds = delegationState(PROJECT);
    ds.queue.push({ request: { prompt: "x" }, projectPath: PROJECT, agentId: "codeur" });
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);

    const flushSpy = vi.fn(async () => {});
    const res = await replayDelegationQueueForProject(PROJECT, { flush: flushSpy });

    expect(res).toEqual({ replayed: false, reason: "busy" });
    expect(flushSpy).not.toHaveBeenCalled();
    expect(delegationState(PROJECT).queue).toHaveLength(1);
    releaseUpdateWindow();
    const after = await replayDelegationQueueForProject(PROJECT, { flush: flushSpy });
    expect(after.replayed).toBe(true);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });
});

describe("j — source : tous les chemins d'admission/rejeu consultent la réservation", () => {
  const src = source("src/js/super-agent.js");

  it("les DEUX admissions de mission et les DEUX rejeux portent le garde", () => {
    // Le garde est celui du décideur UNIQUE (`run-policy.js` → `isTerrainReserved`),
    // qui couvre les DEUX réservations globales : vérification/installation du
    // moteur `pi` ET mise à jour de Pilot.
    const updateAdmissions = src.match(/busy:\s*[^\n]*isTerrainReserved\(\)/g) || [];
    expect(updateAdmissions.length).toBe(2); // launchOrQueue + startRun
    const replayGuards = src.match(/async \(p\) => !isTerrainReserved\(\)/g) || [];
    expect(replayGuards.length).toBe(2); // missions + délégations
  });

  it("la file de délégations ne se vide pas pendant la réservation", () => {
    expect(src).toContain("function flushDelegationQueue(projectPath) {");
    const body = src.slice(src.indexOf("function flushDelegationQueue(projectPath) {"));
    const guardIdx = body.indexOf("if (isTerrainReserved()) {");
    const shiftIdx = body.indexOf("ds.queue.shift()");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(shiftIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(shiftIdx);
  });

  it("le point de passage UNIQUE des missions sorties de file porte le garde (couvre aussi la fin de run)", () => {
    // `launchQueuedMission` est le seul point qui lance une mission SORTIE de
    // file : il est appelé par le rejeu périodique ET par la fin d'une run
    // (lancement direct de la mission suivante). Le garde y est donc unique et
    // couvrant ; le retirer réouvre le démarrage automatique pendant la mise à
    // jour.
    const body = src.slice(src.indexOf("function launchQueuedMission(target, entry) {"));
    const guardIdx = body.indexOf("if (isTerrainReserved()) {");
    const launchIdx = body.indexOf("entry.launch({ dequeue: true })");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(launchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(launchIdx);
    // La mission refusée est REMISE EN TÊTE de file (jamais perdue).
    const beforeLaunch = body.slice(0, launchIdx);
    expect(beforeLaunch).toContain("unshift(entry)");
    expect(beforeLaunch).toContain("armQueueReplay(target)");
  });

  it("le bus consulte le décideur unique (`canStartWork`) et non une copie de la règle", () => {
    const bus = source("src/js/agents-bus.js");
    expect(bus).toContain("canStartWork(runProject, nature, isRunInProgress)");
    expect(bus).toContain("workBlockedMessage()");
    // Aucun accès direct à l'état des réservations (mise à jour de Pilot,
    // vérification/installation du moteur) dans le bus : la décision reste
    // centralisée dans run-policy.js.
    expect(bus.includes("isUpdateWindowReserved")).toBe(false);
    expect(bus.includes("isPiStartupGateBlocking")).toBe(false);
  });
});
