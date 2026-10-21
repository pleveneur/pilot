// P2 (D2) — « un arrêt d'agent ne détruit PLUS une mission en attente ».
//
// Défaut prouvé (rapport-file-attente-pertes-doublons.md, §4.2) : `stop_agent`
// concluait « le projet est libre » sur la seule foi du verrou de run
// (`isRunInProgress`, qui ne lit que les contextes du BUS) puis VIDait la file
// des missions. Trace horodatée : `2026-10-20T09:25:10.347Z reason=queue-abandoned
// detected=stop-agent` → mission #14 détruite alors que la session `codeur` n°13
// était encore VIVANTE (arrêtée seulement à `09:25:27.480Z`).
//
// Ces preuves ÉCHOUENT si le défaut revient :
//   a. la consigne de production appelée par `stop_agent`
//      (`keepQueuedRunAgentsMissions`) CONSERVE la file intacte (ordre, identité,
//      nombre) et la TRACE en nommant la mission ;
//   b. le rejeu qui suit ne lance RIEN tant qu'une session du projet travaille
//      encore (jugement sur les sessions VIVANTES, jamais sur le verrou) — puis
//      lance la tête de file dès que la session a disparu, les missions
//      suivantes restant en file ;
//   c. la branche `stop_agent` (projet ET espace assistant) appelle bien cette
//      consigne de conservation et n'appelle plus l'abandon.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `file-attente-regle-4.test.js` / `verrou-par-projet.test.js`
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
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  runAgentsQueueByProject,
  enqueueMissionForProject,
  allocateMissionIdentity,
  keepQueuedRunAgentsMissions,
  replayQueuedMissionForProject,
  __superAgentQueueStateForTest,
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
 * Session VIVANTE de l'agent `codeur` sur le projet : c'est elle que l'arrêt
 * d'agent ignorait (il ne regardait que le verrou du bus).
 */
const workingSession = () => ({
  agent: "codeur",
  project: PROJECT,
  mode: "agent_process",
  alive: true,
  busy: true,
  lastActivity: new Date().toISOString(),
});

/** Branche `stop_agent` du handler d'actions de l'assistant. */
function stopAgentBranch() {
  const stopIdx = superAgentSrc.indexOf('action === "stop_agent"');
  const nextIdx = superAgentSrc.indexOf('action === "create_agent"', stopIdx);
  expect(stopIdx).toBeGreaterThan(-1);
  expect(nextIdx).toBeGreaterThan(stopIdx);
  return superAgentSrc.slice(stopIdx, nextIdx);
}

/** Empile N missions par le chemin de PRODUCTION (aucune fixture d'identité). */
function queueTwoMissions() {
  const first = enqueueMissionForProject(
    PROJECT,
    async () => ({ started: "A" }),
    "mission A : corriger le parseur",
    allocateMissionIdentity(["codeur"]),
  );
  const second = enqueueMissionForProject(
    PROJECT,
    async () => ({ started: "B" }),
    "mission B : écrire les tests",
    allocateMissionIdentity(["testeur"]),
  );
  return {
    ids: [first.entry.id, second.entry.id],
    labels: ["mission A : corriger le parseur", "mission B : écrire les tests"],
  };
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

// ── a. La file survit à l'arrêt, et la trace la nomme ──────────────────────
describe("P2 (a) — un arrêt d'agent CONSERVE la file non vide", () => {
  it("la file reste intacte (ordre + identité) et le journal NOMME les missions conservées", async () => {
    const { ids, labels } = queueTwoMissions();
    // Le verrou de run est LIBRE (projet jugé « libre » par l'ancien code) alors
    // qu'une session travaille encore : c'est exactement la situation du défaut.
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") return { sessions: [workingSession()] };
      if (cmd === "get_config") return {};
      return undefined;
    });

    const res = await keepQueuedRunAgentsMissions(PROJECT, { detected: "stop-agent" });

    // 1) AUCUNE mission n'est détruite : même nombre, même ordre, même identité.
    expect(res.count).toBe(2);
    expect(res.labels).toEqual([`#${ids[0]} « ${labels[0]} »`, `#${ids[1]} « ${labels[1]} »`]);
    expect(runAgentsQueueByProject[PROJECT]).toHaveLength(2);
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.id)).toEqual(ids);
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.label)).toEqual(labels);

    // 2) La trace nomme les missions CONSERVÉES (motif `queue-kept`, jamais
    //    `queue-abandoned` : une conservation n'est pas un abandon).
    const journal = lastJournal();
    expect(journal, "la conservation doit laisser une trace").toContain("reason=queue-kept");
    expect(journal).toContain("detected=stop-agent");
    expect(journal).toContain(labels[0]);
    expect(journal).toContain(labels[1]);
    expect(journal).not.toContain("reason=queue-abandoned");

    // 3) Le rejeu est ARMÉ (la mission n'est pas seulement conservée : elle sera
    //    rejouée même si aucune fin de run du bus ne réveille la file).
    expect(__superAgentQueueStateForTest(PROJECT).replayArmed).toBe(true);
  });

  it("file vide : la conservation ne trace rien et n'arme aucun rejeu", async () => {
    const res = await keepQueuedRunAgentsMissions(PROJECT, { detected: "stop-agent" });
    expect(res).toEqual({ count: 0, labels: [], replayArmed: false });
    expect(lastJournal()).toBe("");
    expect(__superAgentQueueStateForTest(PROJECT).replayArmed).toBe(false);
  });
});

// ── b. Le rejeu juge sur les sessions VIVANTES ────────────────────────────
describe("P2 (b) — le rejeu juge sur les sessions vivantes, jamais sur le verrou", () => {
  it("session encore vivante → rien n'est lancé et la file reste entière", async () => {
    queueTwoMissions();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") return { sessions: [workingSession()] };
      if (cmd === "get_config") return {};
      return undefined;
    });

    // Sonde RÉELLE de production (aucune injection) : le verrou du bus est libre,
    // seule la session vivante doit faire dire « occupé ».
    const r = await replayQueuedMissionForProject(PROJECT);
    expect(r).toEqual({ replayed: false, reason: "busy" });
    expect(runAgentsQueueByProject[PROJECT]).toHaveLength(2);
  });

  it("session disparue → la mission conservée est REJOUÉE, la suivante reste en file", async () => {
    const launched = [];
    const { labels } = queueTwoMissions();
    const queue = runAgentsQueueByProject[PROJECT];
    // Chaque entrée rejoue SA propre demande (chemin de production : `shift` +
    // `launchQueuedMission`).
    queue[0].launch = () => {
      launched.push(labels[0]);
      return { started: true };
    };
    queue[1].launch = () => {
      launched.push(labels[1]);
      return { started: true };
    };

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") return { sessions: [] };
      if (cmd === "get_config") return {};
      return undefined;
    });

    const r = await replayQueuedMissionForProject(PROJECT);
    expect(r).toEqual({ replayed: true, reason: "launched" });
    expect(launched).toEqual([labels[0]]);
    // La mission rejouée n'est plus en file, la SECONDE y est toujours : aucune
    // mission n'a été perdue à l'arrêt (l'ancien code vidait les deux).
    expect(runAgentsQueueByProject[PROJECT]).toHaveLength(1);
    expect(runAgentsQueueByProject[PROJECT][0].label).toBe(labels[1]);
  });
});

// ── c. Câblage : la branche stop_agent appelle la CONSERVATION ────────────
describe("P2 (c) — la branche stop_agent conserve les missions (projet ET espace assistant)", () => {
  it("projet : conservation appelée, abandon retiré, message visible nommant l'action", () => {
    const branch = stopAgentBranch();
    expect(branch).toContain("keepQueuedRunAgentsMissions(queueKey");
    expect(branch, "l'arrêt ne doit plus abandonner les missions en attente").not.toContain(
      "abandonQueuedRunAgentsMissions(queueKey",
    );
    expect(branch).toContain("conservée(s) en file d'attente par l'arrêt de l'agent");
  });

  it("espace assistant : même conservation, même message (aucune purge globale)", () => {
    const branch = stopAgentBranch();
    expect(branch).toContain("keepQueuedRunAgentsMissions(assistantKey");
    expect(branch, "l'arrêt ne doit plus abandonner la file d'assistant").not.toContain(
      "abandonQueuedRunAgentsMissions(assistantKey",
    );
    expect(branch).toContain("mission(s) d'assistant conservée(s) en file d'attente");
    expect(branch).not.toContain("runAgentsQueueByProject = {}");
  });

  it("le point de production unique de conservation existe et ne vide jamais la file", () => {
    const fnIdx = superAgentSrc.indexOf("export async function keepQueuedRunAgentsMissions(");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = superAgentSrc.slice(fnIdx, superAgentSrc.indexOf("\n}\n", fnIdx));
    expect(body).toContain("runAgentsQueueByProject[key]");
    expect(body, "la conservation ne doit jamais vider la file").not.toContain("length = 0");
    expect(body).not.toContain(".shift(");
    expect(body).toContain("armQueueReplay(key)");
    expect(body).toContain("queue-kept");
  });
});
