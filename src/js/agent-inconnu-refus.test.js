// MISSION 381 (relance) — « l'agent lancé est exactement l'agent demandé ».
//
// Ce fichier complète `agent-demande-exact.test.js` (qui vérifie le contrat au
// niveau du LANCEUR de l'assistant et par lecture de source) par une preuve
// d'EXÉCUTION, au niveau du bus d'agents — là où les processus pi sont
// réellement démarrés :
//
//  (a) un identifiant INCONNU ne démarre RIEN (`start_agent_process` jamais
//      appelé) et ne produit AUCUN repli silencieux sur un agent du registre ;
//  (b) l'échec est EXPLICITE : le message nomme l'identifiant demandé ;
//  (c) une mission qui nomme un agent connu ET un agent inconnu ne démarre que
//      l'agent DEMANDÉ, et le texte de la mission ne part jamais vers un autre
//      agent que ceux nommés ;
//  (d) le projet est LIBÉRÉ après le refus : la demande peut être relancée avec
//      un identifiant valide (aucun verrou fantôme).
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";

// `agents-bus.js` lit `window._pilotProjectPath` (projet courant du chat) : en
// environnement node il n'existe pas. On fournit un `window` minimal, et on le
// retire à la fin si c'est nous qui l'avons créé (aucune fuite entre fichiers).
const hadWindow = typeof globalThis.window !== "undefined";
if (!hadWindow) globalThis.window = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

// Le bus écoute le canal unifié des agents (`listen`) : en environnement node, il
// n'y a ni `window` ni IPC Tauri → on fournit l'abonnement simulé.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  initAgentsBus,
  destroyAgentsBus,
  startParallelRun,
  handleAgentEvent,
  attachMissionSink,
  isRunInProgress,
} from "./agents-bus.js";

/** Événement RPC au format attendu par `handleAgentEvent`. */
function ev(project, agentId, event) {
  return { payload: { project, agent_id: agentId, event } };
}

/** Laisse tourner les micro-tâches (I/O simulées, agrégation, livraison). */
async function flushAsync(n = 14) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Registre minimal : un codeur (écriture) et un planificateur (lecture). Le
 * codeur sert de « tentation » : un repli silencieux le choisirait.
 */
const REGISTRY = {
  agents: [
    {
      id: "codeur",
      name: "Codeur",
      readonly: false,
      keep_context: false,
      models: { pi: "test/model", plh: "test/model" },
      capabilities: ["write"],
      max_calls_per_run: 3,
      call_depth: 1,
    },
    {
      id: "plan-maker",
      name: "Plan Maker",
      readonly: true,
      keep_context: false,
      models: { pi: "test/model", plh: "test/model" },
      capabilities: ["plan"],
      max_calls_per_run: 3,
      call_depth: 1,
    },
  ],
};

/**
 * Lance une mission et retourne de quoi l'observer : agents réellement démarrés,
 * textes envoyés (par agent), sink de livraison et clé de run.
 * @param {object} opts
 * @param {Array<{agentId: string, brief?: string}>} opts.agents
 * @param {string} opts.project
 */
async function launchMission({ agents, project }) {
  const spawned = [];
  const sent = []; // { agentId, message }
  vi.mocked(invoke).mockImplementation(async (cmd, args = {}) => {
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return REGISTRY;
    if (cmd === "list_agent_sessions" || cmd === "agent_activity_probe") return { sessions: [] };
    if (cmd === "start_agent_process") spawned.push(args.agentId);
    if (cmd === "send_agent_process_prompt") sent.push({ agentId: args.agentId, message: args.message });
    if (cmd === "file_exists") return true;
    if (cmd === "git_status_project") return { is_repo: true, head_ts: 0, pending: 0 };
    return undefined;
  });
  await initAgentsBus({});

  const sink = { done: vi.fn(), error: vi.fn() };
  let runKey = "";
  await startParallelRun(
    agents.map((a) => ({ agentId: a.agentId, project, brief: a.brief || "" })),
    "",
    {
      onStart: (_project, ctx) => {
        runKey = ctx.runKey;
        attachMissionSink(ctx.runKey, {
          onDone: (text) => sink.done(text),
          onError: (err) => sink.error(err),
        });
      },
    },
  );
  await flushAsync();
  return { spawned, sent, sink, runKey };
}

afterEach(() => {
  if (globalThis.window) globalThis.window._pilotProjectPath = "";
  // Aucune run (y compris de LECTURE) ne doit survivre au test : le verrou
  // d'un test bloquerait le suivant.
  destroyAgentsBus();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterAll(() => {
  if (!hadWindow) delete globalThis.window;
});

// ── (a)+(b) Un identifiant inconnu ne démarre RIEN et l'échec le nomme ──────
describe("agent inconnu : aucun lancement, aucun repli, échec explicite", () => {
  const project = "preuve-381-agent-inconnu";

  it("ne démarre AUCUN processus et ne se replie jamais sur un agent du registre", async () => {
    const { spawned, sent, sink } = await launchMission({
      project,
      agents: [{ agentId: "agent-qui-nexiste-pas", brief: "Corrige le verrou de run." }],
    });

    // Aucun processus pi démarré — en particulier PAS « codeur » (le repli
    // silencieux que la mission interdit) ni « plan-maker ».
    expect(spawned, "un agent a été démarré alors qu'aucun agent valide n'était demandé").toEqual([]);
    expect(sent, "une mission a été transmise à un agent non demandé").toEqual([]);

    // L'échec est explicite et nomme l'identifiant demandé.
    expect(sink.done, "un agent inconnu ne peut pas produire un succès").not.toHaveBeenCalled();
    expect(sink.error, "le refus doit être rapporté").toHaveBeenCalledTimes(1);
    const message = String(sink.error.mock.calls[0][0] && sink.error.mock.calls[0][0].message);
    expect(message).toContain("agent-qui-nexiste-pas");
    expect(message, "l'échec doit dire que l'agent est inconnu").toContain("inconnu");
  });

  it("libère le projet : la même demande peut être relancée avec un agent valide", async () => {
    const { sink } = await launchMission({
      project,
      agents: [{ agentId: "agent-qui-nexiste-pas" }],
    });
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(isRunInProgress(project), "le refus ne doit pas laisser un verrou fantôme").toBe(false);
  });
});

// ── (c) Mission mixte : seul l'agent DEMANDÉ démarre ───────────────────────
describe("mission mixte (un agent connu + un inconnu) : seul l'agent demandé démarre", () => {
  const project = "preuve-381-mission-mixte";

  it("démarre exactement l'agent valide demandé, et lui seul reçoit la mission", async () => {
    const brief = "Corrige le verrou de run puis lance les tests.";
    const { spawned, sent, sink } = await launchMission({
      project,
      agents: [{ agentId: "codeur", brief }, { agentId: "agent-qui-nexiste-pas", brief }],
    });

    // Exactement l'agent nommé et valide — aucun agent auxiliaire (plan-maker),
    // aucun repli, aucun doublon.
    expect(spawned, "les agents démarrés doivent être exactement ceux demandés").toEqual(["codeur"]);
    // Le texte de la mission n'est remis qu'à l'agent demandé.
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call.agentId, "une mission a été remise à un agent non demandé").toBe("codeur");
      expect(call.message).toContain("verrou de run");
    }
    // La mission reste ouverte tant que l'agent demandé travaille : le refus de
    // la part inconnue n'est pas un « abandon silencieux » de la mission.
    expect(sink.done).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();

    // Fin du travail de l'agent demandé : le rapport livré nomme la part en
    // échec (identifiant inconnu) — le refus n'est jamais silencieux.
    handleAgentEvent(ev(project, "codeur", { type: "agent_start" }));
    handleAgentEvent(
      ev(project, "codeur", {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Verrou corrigé, tests ajoutés." },
      }),
    );
    handleAgentEvent(ev(project, "codeur", { type: "agent_end", willRetry: false }));
    await flushAsync();

    const delivered = sink.done.mock.calls.length
      ? String(sink.done.mock.calls[0][0])
      : String(sink.error.mock.calls[0][0].message);
    expect(delivered).toContain("agent-qui-nexiste-pas");
    expect(isRunInProgress(project), "le projet doit être libéré après la mission").toBe(false);
  });
});

// ── (d) Aucun agent auxiliaire n'est démarré « en amont » ──────────────────
describe("aucun agent auxiliaire n'est démarré en amont du lancement", () => {
  const project = "preuve-381-sans-devis";

  it("une mission sur le codeur démarre le codeur en PREMIER et sans planificateur", async () => {
    const { spawned } = await launchMission({
      project,
      agents: [{ agentId: "codeur", brief: "Ajoute un test de non-régression." }],
    });

    expect(spawned, "aucun agent ne doit précéder l'agent demandé").toEqual(["codeur"]);
    expect(spawned).not.toContain("plan-maker");
  });
});
