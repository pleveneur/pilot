// ANTI-RÉCIDIVE — « une sonde périodique n'appelle JAMAIS `list_agent_sessions` ».
//
// FAIT (diagnostic) : les deux rejeux périodiques de l'assistant (file de
// missions et file de délégations, cadencés à 15 s) jugeaient l'admission du
// projet avec `invoke("list_agent_sessions")` — soit, côté Rust, un `get_state`
// SYNCHRONE envoyé à chaque session VIVANTE (timeout 2 s) plus une lecture de la
// table `agents` à chaque passe. Une session figée bloquait donc la sonde, et la
// file de travail du projet restait gelée 25-30 min.
//
// CONSIGNE ABSOLUE : `list_agent_sessions` ne s'appelle QUE sur demande explicite
// (assistant, affichage), JAMAIS dans une boucle. Ces tests ÉCHOUENT si l'appel
// lourd revient dans un chemin périodique, ou si la sonde légère disparaît.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` touche `window` à l'évaluation : `window` minimal AVANT import.
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

// Aucun accès Tauri réel en environnement Node.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { beginRun, endRun, releaseStuckRunLock } from "./agents-bus.js";
import { replayQueuedMissionForProject, replayDelegationQueueForProject, runAgentsQueueByProject, delegationState } from "./super-agent.js";

const HEAVY = "list_agent_sessions";
const LIGHT = "agent_activity_probe";

/** Lit un fichier source en normalisant les fins de ligne (piège CI Windows). */
const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * Extrait le corps d'une fonction : de `marker` jusqu'au PREMIER `}` en colonne 0
 * (les corps de ces modules sont indentés). Échoue bruyamment si la fonction
 * n'existe plus — un renommage ne doit pas rendre ces preuves muettes.
 * @param {string} src
 * @param {string} marker
 * @param {string} [endMarker] - fin de corps (méthode d'un `impl` Rust : `\n    }\n`)
 */
function functionBody(src, marker, endMarker = "\n}\n") {
  const start = src.indexOf(marker);
  expect(start, `fonction introuvable : ${marker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end, `fin de fonction introuvable : ${marker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("sonde de rejeu — l'appel périodique est LÉGER, jamais la liste des sessions", () => {
  it("super-agent.js : `isRunStillActive` (sonde des DEUX rejeux) n'appelle plus la liste des sessions", () => {
    const src = readSource("./super-agent.js");
    const body = functionBody(src, "async function isRunStillActive(");
    expect(body).not.toContain(HEAVY);
    expect(body, "la sonde doit passer par la commande légère").toContain(LIGHT);
  });

  it("super-agent.js : les deux rejeux périodiques restent à 15 s (cadence NON modifiée en silence)", () => {
    const src = readSource("./super-agent.js");
    // Le correctif ne consiste PAS à espacer la sonde : elle garde son rythme et
    // devient légère. Un futur changement de cadence devra être assumé ici.
    expect(src).toContain("const RUN_AGENTS_QUEUE_REPLAY_MS = 15 * 1000;");
    expect(src).toContain("const DELEGATION_QUEUE_REPLAY_MS = 15 * 1000;");
  });

  it("super-agent.js : les deux passes de rejeu ne touchent pas la liste des sessions", () => {
    const src = readSource("./super-agent.js");
    expect(functionBody(src, "export async function replayQueuedMissionForProject(")).not.toContain(HEAVY);
    expect(functionBody(src, "export async function replayDelegationQueueForProject(")).not.toContain(HEAVY);
    expect(functionBody(src, "export function armQueueReplay(")).not.toContain(HEAVY);
    expect(functionBody(src, "export function armDelegationQueueReplay(")).not.toContain(HEAVY);
  });

  it("agents-bus.js : les sondes du watchdog (`releaseStuckRunLock`) passent par la sonde légère unique", () => {
    const src = readSource("./agents-bus.js");
    // `isRunStillActive` libère d'abord le verrou fantôme : ces deux sondes sont
    // donc elles aussi exécutées toutes les 15 s et doivent rester légères.
    expect(functionBody(src, "async function anyActiveAgentWorking(")).not.toContain(HEAVY);
    expect(functionBody(src, "async function projectHasWorkingSession(")).not.toContain(HEAVY);
    const probe = functionBody(src, "async function probeActivitySessions(");
    expect(probe).toContain(LIGHT);
    expect(probe).not.toContain(HEAVY);
  });

  it("le rejeu de file sonde RÉELLEMENT avec `agent_activity_probe` (preuve d'exécution)", async () => {
    const project = "sonde-legere-rejeu";
    const calls = [];
    let launched = 0;
    runAgentsQueueByProject[project] = [{ launch: () => { launched++; } }];
    invoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      if (cmd === HEAVY) throw new Error("appel lourd interdit dans une sonde");
      if (cmd === LIGHT) return { sessions: [] }; // aucun agent actif → admission libre
      return undefined;
    });
    try {
      const r = await replayQueuedMissionForProject(project);
      expect(r).toEqual({ replayed: true, reason: "launched" });
      expect(launched).toBe(1);
      expect(calls, "la sonde légère doit être utilisée").toContain(LIGHT);
      expect(calls, "la liste des sessions est INTERDITE ici").not.toContain(HEAVY);
    } finally {
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      delete runAgentsQueueByProject[project];
    }
  });

  it("le rejeu de délégations sonde avec la même sonde légère", async () => {
    const project = "sonde-legere-delegation";
    const calls = [];
    delegationState(project).queue.push({ request: "demande en attente" });
    invoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      if (cmd === HEAVY) throw new Error("appel lourd interdit dans une sonde");
      if (cmd === LIGHT) return { sessions: [{ project, alive: true, busy: true, lastActivity: new Date().toISOString() }] };
      return undefined;
    });
    try {
      const r = await replayDelegationQueueForProject(project);
      // Agent busy → la demande reste en file (jamais perdue), et aucune sonde lourde.
      expect(r).toEqual({ replayed: false, reason: "busy" });
      expect(calls).toContain(LIGHT);
      expect(calls).not.toContain(HEAVY);
    } finally {
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      delegationState(project).queue.length = 0;
    }
  });

  it("agents-bus.js : libérer un verrou ne consulte jamais la liste des sessions", async () => {
    const project = "sonde-legere-verrou";
    const calls = [];
    const ctx = beginRun(project);
    ctx.activeAgents.add("codeur");
    ctx.agentProject["codeur"] = project;
    invoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      if (cmd === HEAVY) throw new Error("appel lourd interdit dans une sonde");
      if (cmd === LIGHT) {
        return { sessions: [{ agent: "codeur", project, alive: true, busy: true, lastActivity: new Date().toISOString() }] };
      }
      return undefined;
    });
    try {
      await releaseStuckRunLock(project);
      expect(calls).not.toContain(HEAVY);
    } finally {
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      endRun(project);
    }
  });

  it("Rust : la sonde légère existe, est branchée, et ne fait ni base ni RPC par session", () => {
    const svc = readSource("../../src-tauri/src/agent_service.rs");
    const body = functionBody(svc, "pub fn agent_activity_probe(&self, app: &AppHandle) -> Value {", "\n    }\n");
    // Aucun accès base (`get_agent`) ni RPC synchrone (`send_sync_timeout`) : c'est
    // ce qui rend l'appel répétable sans geler la file de travail du projet.
    expect(body).not.toContain("get_agent(");
    expect(body).not.toContain("send_sync_timeout(");
    expect(body).not.toContain(HEAVY);
    // Commande exposée et enregistrée : sans branchement, la sonde du front
    // échouerait en silence (fail-open « occupé ») et les files ne repartiraient
    // plus jamais.
    expect(svc).toContain("pub fn agent_activity_probe(state: State<AppState>, app: AppHandle)");
    const lib = readSource("../../src-tauri/src/lib.rs");
    expect(lib).toContain("agent_service::agent_activity_probe,");
  });

  it("la liste des sessions reste la SEULE source des usages explicites (assistant, affichage)", () => {
    const src = readSource("./super-agent.js");
    // Non-régression : on ne supprime PAS l'outil de supervision de l'assistant.
    expect(src).toContain(`invoke("${HEAVY}")`);
  });
});

// Le mock `invoke` est partagé entre tests : on repart d'un état neutre.
beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});
