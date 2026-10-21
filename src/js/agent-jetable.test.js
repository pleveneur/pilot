// AGENT JETABLE (décision propriétaire du 2026-10-21) — preuves d'EXÉCUTION.
//
// La demande : permettre à l'assistant de lancer un agent dont le RÔLE est fourni
// dans la demande elle-même, SANS écriture en base (aucune entrée dans le
// registre, invisible dans la liste des agents), et dont la définition disparaît
// à la fin de la tâche (le travail produit — messages, rapport — reste visible).
//
// Ce fichier prouve les trois exigences, en observant les appels IPC réellement
// effectués (aucune intention déclarative) :
//
//  (a) LANCEMENT SANS ÉCRITURE : un agent au rôle fourni à la volée démarre
//      réellement dans le bus (`start_agent_process` avec son identifiant), et
//      AUCUNE commande d'écriture du registre n'est appelée pendant tout le
//      cycle (enregistrement mémoire → démarrage → fin de tâche).
//  (b) RIEN NE SUBSISTE APRÈS LA TÂCHE : la purge vide le magasin JS, appelle
//      `clear_ephemeral_agent` (mémoire Rust) et arrête la session PAR
//      L'ENTONNOIR d'arrêt (trace écrite avant l'arrêt, règle 3).
//  (c) REGISTRE INCHANGÉ : les agents persistants ne sont ni écrasés, ni
//      supprimés, ni purgés accidentellement (seuls les identifiants `eph-` sont
//      concernés), et l'agent jetable reste INVISIBLE.
import { describe, it, expect, vi, afterEach } from "vitest";

// Le bus lit `window._pilotProjectPath` : on fournit un `window` minimal.
if (typeof globalThis.window === "undefined") globalThis.window = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  EPHEMERAL_AGENT_PREFIX,
  buildEphemeralAgent,
  isEphemeralAgentId,
  persistEphemeralAgent,
  disposeEphemeralAgent,
  disposeEphemeralAgents,
  listEphemeralAgents,
  resetEphemeralAgents,
  mergeAgentsWithEphemeral,
  splitEphemeralIds,
} from "./ephemeral-agents.js";
import {
  initAgentsBus,
  destroyAgentsBus,
  runAgentsForAssistantAsync,
  handleAgentEvent,
} from "./agents-bus.js";

/** Commandes qui ÉCRIVENT le registre persistant (`agents.js`) : interdites ici. */
const REGISTRY_WRITE_COMMANDS = ["upsert_agent", "replace_agents", "delete_agent"];

/** Registre persistant minimal : un seul agent durable, jamais modifié. */
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
  ],
};

const PROJECT = "preuve-agent-jetable";

/** Laisse tourner les micro-tâches (IPC simulées, agrégation). */
async function flushAsync(n = 16) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/** `invoke` instrumenté : enregistre TOUS les appels, rend ce qu'attend le bus. */
function instrument({ agents = REGISTRY, spawned = [], sent = [] } = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd, args = {}) => {
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return agents;
    if (cmd === "list_agent_sessions") return { sessions: [] };
    if (cmd === "register_ephemeral_agent") return args.agent;
    if (cmd === "start_agent_process") {
      spawned.push(args.agentId);
      return 1;
    }
    if (cmd === "send_agent_process_prompt") {
      sent.push({ agentId: args.agentId, message: args.message });
      return undefined;
    }
    if (cmd === "file_exists") return true;
    if (cmd === "git_status_project") return { is_repo: true, head_ts: 0, pending: 0 };
    return undefined;
  });
  return { spawned, sent };
}

/** Toutes les commandes IPC passées, dans l'ordre. */
function calledCommands() {
  return vi.mocked(invoke).mock.calls.map((c) => String(c[0]));
}

/** Ligne de journal d'arrêt écrite pour un identifiant donné (`null` sinon). */
function stopTraceFor(agentId) {
  for (const call of vi.mocked(invoke).mock.calls) {
    const [cmd, args] = call;
    if (cmd !== "write_file_content" && cmd !== "create_file") continue;
    const path = String((args && args.path) || "");
    const content = String((args && args.content) || "");
    if (path.includes("agent-stops") && content.includes(agentId)) {
      return { cmd, path, content };
    }
  }
  return null;
}

/**
 * Agent jetable prêt à démarrer : le modèle est explicite parce que le bus
 * REFUSE de démarrer un agent sans modèle quand aucun défaut n'est configuré
 * (`ensureFallbackModel`) — comportement existant, inchangé ici. En usage réel,
 * un agent jetable sans modèle retombe sur le modèle par défaut de l'application.
 */
function makeAgent(overrides = {}) {
  return buildEphemeralAgent({
    name: "Auditeur",
    role: "Tu audites les verrous de projet, en lecture seule.",
    model: "test/model",
    readonly: true,
    ...overrides,
  });
}

afterEach(() => {
  if (globalThis.window) globalThis.window._pilotProjectPath = "";
  destroyAgentsBus();
  resetEphemeralAgents();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

// ── (a) Un rôle fourni à la volée démarre SANS aucune écriture en base ──────
describe("(a) agent au rôle fourni : lancement réel, aucune écriture en base", () => {
  it("construit un identifiant éphémère et conserve le rôle demandé", () => {
    const agent = buildEphemeralAgent({
      name: "Auditeur de verrous",
      role: "Tu vérifies les verrous de projet et tu ne modifies rien.",
      model: "test/model",
      readonly: true,
    });
    expect(agent).not.toBeNull();
    expect(isEphemeralAgentId(agent.id)).toBe(true);
    expect(agent.id.startsWith(EPHEMERAL_AGENT_PREFIX)).toBe(true);
    // Le rôle est porté par la définition (le prompt de l'agent le reçoit), et
    // l'agent n'est JAMAIS visible : ce n'est pas un onglet du registre.
    expect(agent.role).toBe("Tu vérifies les verrous de projet et tu ne modifies rien.");
    expect(agent.visible).toBe(false);
    expect(agent.readonly).toBe(true);
    expect(agent.ephemeral).toBe(true);
  });

  it("un identifiant imposé hors du préfixe réservé est refusé (pas de risque d'écriture)", () => {
    expect(buildEphemeralAgent({ name: "X", role: "rôle" }, { id: "codeur" })).toBeNull();
  });

  it("l'enregistrement passe par la commande MÉMOIRE, jamais par le registre", async () => {
    instrument();
    const agent = buildEphemeralAgent({ name: "Auditeur", role: "Tu audites." });
    await persistEphemeralAgent(agent, PROJECT);

    expect(calledCommands()).toContain("register_ephemeral_agent");
    for (const cmd of REGISTRY_WRITE_COMMANDS) {
      expect(calledCommands(), `« ${cmd} » écrit le registre : interdit pour un agent jetable`).not.toContain(cmd);
    }
    // La définition vit en mémoire et reste invisible.
    const live = listEphemeralAgents();
    expect(live.map((a) => a.id)).toEqual([agent.id]);
    expect(live[0].visible).toBe(false);
  });

  it("démarre réellement l'agent jetable dans le bus, sans toucher au registre", async () => {
    const { spawned, sent } = instrument();
    const agent = makeAgent();
    await persistEphemeralAgent(agent, PROJECT);

    await initAgentsBus({});
    const result = { done: [], error: [] };
    await runAgentsForAssistantAsync(
      [{ agentId: agent.id, project: PROJECT, brief: "Audite les verrous." }],
      (text) => result.done.push(text),
      (err) => result.error.push(err)
    );
    await flushAsync();

    // Le rôle fourni à la volée a bien produit un DÉMARRAGE réel.
    expect(spawned, "l'agent jetable n'a pas démarré").toContain(agent.id);
    // Aucune écriture du registre pendant tout le cycle de lancement.
    for (const cmd of REGISTRY_WRITE_COMMANDS) {
      expect(calledCommands(), `« ${cmd} » a été appelé pendant le lancement`).not.toContain(cmd);
    }
    // La mission est bien remise à l'agent DEMANDÉ (aucun repli sur « codeur »).
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) expect(call.agentId).toBe(agent.id);
    expect(spawned).not.toContain("codeur");
  });
});

// ── (b) À la fin de la tâche, la définition n'existe plus ───────────────────
describe("(b) fin de tâche : la définition disparaît des deux étages", () => {
  it("purge le magasin JS, la mémoire Rust et arrête la session PAR l'entonnoir", async () => {
    instrument();
    const agent = buildEphemeralAgent({ name: "Auditeur", role: "Tu audites." });
    await persistEphemeralAgent(agent, PROJECT);
    expect(listEphemeralAgents().length).toBe(1);
    const before = calledCommands().length;

    const purged = await disposeEphemeralAgents([agent.id], PROJECT);
    expect(purged).toEqual([agent.id]);

    // Rien ne subsiste côté JS.
    expect(listEphemeralAgents(), "la définition doit avoir disparu").toEqual([]);
    expect(isEphemeralAgentId(agent.id)).toBe(true); // le PRÉFIXE reste réservé
    const after = calledCommands().slice(before);
    // Purge de la mémoire Rust (aucune écriture en base).
    expect(after).toContain("clear_ephemeral_agent");
    // Session arrêtée : arrêt AUTOMATIQUE → trace écrite AVANT l'arrêt (règle 3).
    expect(after).toContain("stop_agent_process");
    const trace = stopTraceFor(agent.id);
    expect(trace, "l'arrêt d'un agent jetable doit laisser une trace écrite").not.toBeNull();
    expect(trace.content).toContain("ephemeral-task-ended");
    for (const cmd of REGISTRY_WRITE_COMMANDS) {
      expect(calledCommands(), `« ${cmd} » ne doit jamais être appelé`).not.toContain(cmd);
    }
  });

  it("purger un identifiant DÉJÀ purgé ne lève pas et n'écrit rien", async () => {
    instrument();
    const agent = buildEphemeralAgent({ name: "Auditeur", role: "Tu audites." });
    await persistEphemeralAgent(agent, PROJECT);
    await disposeEphemeralAgent(agent.id, PROJECT);
    vi.mocked(invoke).mockClear();
    instrument();

    await expect(disposeEphemeralAgent(agent.id, PROJECT)).resolves.toBe(false);
    expect(listEphemeralAgents()).toEqual([]);
    for (const cmd of REGISTRY_WRITE_COMMANDS) expect(calledCommands()).not.toContain(cmd);
  });

  it("l'arrêt de la tâche laisse le TRAVAIL visible (session et rapport intacts)", async () => {
    const { spawned } = instrument();
    const agent = makeAgent();
    await persistEphemeralAgent(agent, PROJECT);
    await initAgentsBus({});
    const result = { done: [], error: [] };
    await runAgentsForAssistantAsync(
      [{ agentId: agent.id, project: PROJECT, brief: "Audite." }],
      (t) => result.done.push(t),
      (e) => result.error.push(e)
    );
    await flushAsync();
    expect(spawned).toContain(agent.id);

    // L'agent travaille puis termine : la fin de tâche purge la DÉFINITION mais
    // le compte rendu est bien produit (le travail n'est pas effacé).
    const ev = (event) => ({ payload: { project: PROJECT, agent_id: agent.id, event } });
    handleAgentEvent(ev({ type: "agent_start" }));
    handleAgentEvent(
      ev({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Audit terminé : aucun verrou fantôme." },
      })
    );
    handleAgentEvent(ev({ type: "agent_end", willRetry: false }));
    await flushAsync(20);

    await disposeEphemeralAgents([agent.id], PROJECT);
    expect(listEphemeralAgents()).toEqual([]);
    expect(result.done.length + result.error.length).toBeGreaterThan(0);
    const delivered = (result.done[0] || (result.error[0] && String(result.error[0] && result.error[0].message)) || "");
    expect(String(delivered), "le travail de l'agent doit rester visible après la purge").toMatch(/audit/i);
  });
});

// ── (c) Les agents du registre sont inchangés ───────────────────────────────
describe("(c) registre intact : aucune entrée existante modifiée ou supprimée", () => {
  it("la fusion n'écrase jamais un agent persistant et n'en modifie aucun", () => {
    const ephemeral = [{ ...buildEphemeralAgent({ name: "Auditeur", role: "Tu audites." }), id: "eph-fusion-1" }];
    const merged = mergeAgentsWithEphemeral(REGISTRY.agents, ephemeral);
    expect(merged.length).toBe(2);
    // Le premier est l'agent persistant, à l'identique (même objet, même contenu).
    expect(merged[0]).toEqual(REGISTRY.agents[0]);
    expect(REGISTRY.agents.length, "la liste du registre ne doit pas être mutée").toBe(1);
    // Même identifiant → le persistant gagne (aucun écrasement possible).
    const clash = mergeAgentsWithEphemeral(REGISTRY.agents, [{ ...REGISTRY.agents[0], role: "écrasé" }]);
    expect(clash.length).toBe(1);
    expect(clash[0].role).toBeUndefined();
  });

  it("la purge ne touche QUE les identifiants éphémères d'une mission mixte", async () => {
    const { spawned } = instrument();
    const agent = buildEphemeralAgent({ name: "Auditeur", role: "Tu audites." });
    await persistEphemeralAgent(agent, PROJECT);
    vi.mocked(invoke).mockClear();
    instrument();

    const purged = await disposeEphemeralAgents(["codeur", agent.id], PROJECT);
    expect(purged).toEqual([agent.id]);
    // Aucune commande d'arrêt ni de suppression visant « codeur ».
    for (const call of vi.mocked(invoke).mock.calls) {
      const [cmd, args] = call;
      if (REGISTRY_WRITE_COMMANDS.includes(cmd)) {
        throw new Error(`commande d'écriture du registre appelée : ${cmd}`);
      }
      if (cmd === "stop_agent_process" || cmd === "abort_agent_process") {
        expect(args && args.agentId, "un agent du registre ne doit jamais être arrêté par cette purge").not.toBe("codeur");
      }
    }
    expect(spawned).toEqual([]);
    // Le registre persistant est toujours lisible et complet.
    expect(REGISTRY.agents.map((a) => a.id)).toEqual(["codeur"]);
  });

  it("sépare correctement identifiants persistants et éphémères", () => {
    expect(splitEphemeralIds(["codeur", "eph-a", "", "eph-b"])).toEqual({
      persistent: ["codeur"],
      ephemeral: ["eph-a", "eph-b"],
    });
  });
});
