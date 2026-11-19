// FILE BLOQUÉE PAR UNE TÊTE SANS PROPRIÉTAIRE
// ==========================================
// DÉFAUT (reproduit deux fois sur la machine du propriétaire) : après l'arrêt
// d'un agent qui travaillait sur un projet, plus AUCUNE nouvelle demande de cet
// agent sur CE projet ne démarre. Le projet paraît libre (aucune session
// listée, verrou de run libéré), la même demande sur un AUTRE projet démarre
// immédiatement, et la demande reste « en attente » indéfiniment.
//
// CAUSE (vérifiée ici, pas supposée) : la file d'exclusivité vit au niveau du
// PROJET et SURVIT à la run qui l'a remplie (RÈGLE 4 : une demande ne disparaît
// jamais en silence). Quand l'agent est arrêté, le contexte de la run
// propriétaire est détruit : la tête de file devient INEXÉCUTABLE (elle ne doit
// jamais tourner dans le contexte d'une autre mission). `launchNextQueued` ne
// regardait que la TÊTE : elle refusait, conservait l'entrée morte… et
// n'examinait JAMAIS les demandes suivantes. Toute demande arrivée après
// l'arrêt (donc empilée DERRIÈRE la morte) était donc perdue : jamais lancée,
// jamais abandonnée, sans aucun message — à vie, jusqu'au redémarrage de Pilot.
//
// Le harnais est celui de `file-attente-regle-4.test.js` / `verrou-de-run-
// bloque-la-file.test.js` : le VRAI bus (`agents-bus.js`), aucune fenêtre Tauri.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  endRun,
  exclusivityQueueOfProject,
  initAgentsBus,
  launchNextQueuedForProject,
  startParallelRun,
} from "./agents-bus.js";
import { exclusivityKey } from "./exclusivity-queue.js";
import { QUEUE_REFUSED_OWNER_GONE } from "./verrou-de-run.js";

const P = "file-bloquee-projet";
const AUTRE = "file-bloquee-autre-projet";
const AGENT = "lecteur";
const qk = (project = P) => exclusivityKey(project, AGENT);

const busRuns = () => globalThis.__agentBusState.runs;
const runsOf = (project) => Object.values(busRuns()).filter((c) => c && c.project === project);
const fileOf = (project = P) => exclusivityQueueOfProject(project)[qk(project)] || [];

/** Prompts RÉELLEMENT envoyés aux agents (le brief part par cette commande). */
function sentPrompts() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "send_agent_process_prompt")
    .map(([, args]) => String((args && args.message) || ""));
}

/**
 * Porte la sonde d'activité à « cet agent travaille sur ce projet » : c'est
 * l'état réel qui fait qu'une nouvelle demande est MISE EN FILE (au lieu d'être
 * lancée) — donc celui qui expose la tête de file morte.
 */
function agentOccupe(busy, project = P) {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "list_agents") {
      return {
        agents: [{ id: AGENT, name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false }],
      };
    }
    if (cmd === "get_config") return {};
    if (cmd === "list_agent_sessions" || cmd === "agent_activity_probe") {
      return busy
        ? {
            sessions: [
              {
                agent: AGENT,
                project,
                mode: "agent_process",
                alive: true,
                busy: true,
                lastActivity: new Date().toISOString(),
              },
            ],
          }
        : { sessions: [] };
    }
    return undefined;
  });
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of Object.keys(busRuns())) delete busRuns()[key];
  for (const project of [P, AUTRE]) {
    const queue = exclusivityQueueOfProject(project);
    for (const key of Object.keys(queue)) delete queue[key];
  }
});

describe("file d'exclusivité — une tête sans propriétaire ne barre plus les demandes suivantes", () => {
  it("après l'ARRÊT de l'agent, la nouvelle demande du même couple démarre au lieu de rester en attente à vie", async () => {
    agentOccupe(false);
    await initAgentsBus({});

    // 1) Une première demande met en file une demande A (l'agent est occupé).
    agentOccupe(false);
    await startParallelRun([{ agentId: AGENT, project: P, brief: "A : travail en cours" }], "", {});
    const runA = runsOf(P).find((c) => c.activeAgents && c.activeAgents.has(AGENT));
    expect(runA, "la première demande doit avoir démarré").toBeTruthy();

    agentOccupe(true);
    await startParallelRun([{ agentId: AGENT, project: P, brief: "B : demande en attente" }], "", {});
    const runB = runsOf(P).find((c) => c !== runA);
    expect(fileOf().map((e) => e.brief), "B doit être en file, propriétaire = sa run").toEqual(["B : demande en attente"]);
    expect(fileOf()[0].ownerRunKey).toBe(runB.runKey);

    // 2) L'utilisateur ARRÊTE l'agent : la run propriétaire disparaît, la file
    //    (qui vit au niveau du PROJET) garde la demande B, désormais inexécutable.
    endRun(P, runB.generation);
    expect(fileOf(), "la file survit à la run (RÈGLE 4)").toHaveLength(1);

    // 3) L'utilisateur renvoie une demande : l'agent est toujours déclaré occupé
    //    sur ce projet → elle est empilée DERRIÈRE la demande morte.
    agentOccupe(true);
    await startParallelRun([{ agentId: AGENT, project: P, brief: "C : la nouvelle demande" }], "", {});
    expect(fileOf().map((e) => e.brief)).toEqual(["B : demande en attente", "C : la nouvelle demande"]);

    // 4) Le rejeu (balayage / watchdog / fin de tour) tente la file.
    const outcome = await launchNextQueuedForProject(AGENT, P);

    // Le défaut : le rejeu s'arrête sur la tête morte et rend « propriétaire
    // disparu » — la demande C, dont le propriétaire est VIVANT, n'est jamais
    // lancée et reste en attente pour toujours, sans message.
    expect(
      outcome.reason,
      "le rejeu ne doit plus être refusé à cause d'une tête sans propriétaire alors qu'une demande vivante attend derrière",
    ).not.toBe(QUEUE_REFUSED_OWNER_GONE);
    expect(fileOf().map((e) => e.brief), "la demande VIVANTE doit avoir quitté la file (lancée)").toEqual([
      "B : demande en attente",
    ]);
    expect(
      sentPrompts().some((m) => m.includes("C : la nouvelle demande")),
      "la demande C doit avoir été RÉELLEMENT envoyée à l'agent",
    ).toBe(true);
  });

  it("la demande morte reste en file, signalée UNE fois, et n'est jamais exécutée pour une autre mission", async () => {
    agentOccupe(false);
    await initAgentsBus({});

    agentOccupe(false);
    await startParallelRun([{ agentId: AGENT, project: P, brief: "A" }], "", {});
    agentOccupe(true);
    await startParallelRun([{ agentId: AGENT, project: P, brief: "B : orpheline" }], "", {});
    const runB = runsOf(P)[runsOf(P).length - 1];
    endRun(P, runB.generation);

    // Aucune autre demande : le rejeu refuse, comme avant (RÈGLE 4 conservée).
    const alone = await launchNextQueuedForProject(AGENT, P);
    expect(alone).toMatchObject({ launched: false, reason: QUEUE_REFUSED_OWNER_GONE });
    expect(fileOf().map((e) => e.brief)).toEqual(["B : orpheline"]);
    expect(sentPrompts().some((m) => m.includes("B : orpheline")), "jamais exécutée hors de son contexte").toBe(false);
  });
});
