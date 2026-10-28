// Tests unitaires — CHIEN DE GARDE vs COMPILATION (mission « chien de garde /
// compilation »).
//
// Constat mesuré (2026-10-28) : cinq missions d'agents ont été libérées par la
// porte `ghosts` du chien de garde (« agents déclarés actifs mais plus aucun ne
// travaille (session fantôme ou inactive) ») avec des inactivités mesurées de
// 5, 9, 11 et 18 minutes, ALORS QU'ELLES COMPILAIENT le workspace Rust
// (desktop + gds-core + gds-server) : opération longue et silencieuse, aucun
// événement entre `tool_execution_start` et `tool_execution_end`.
//
// Règle vérifiée ici : un OUTIL EN COURS compte comme activité (jamais de
// coupure pendant ce temps) ; une VRAIE session fantôme (agent mort ou au repos
// sans outil en cours) reste coupée ; une activité récente n'est pas coupée.
//
// Aucun chiffre attendu n'est figé : les durées sont RECALCULÉES depuis les
// constantes du module (`TOOL_IN_PROGRESS_MAX_MS`, `RUN_LAUNCH_MIN_STUCK_IDLE_MS`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Aucun backend Tauri en environnement Node : mock minimal des commandes.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import {
  beginRun,
  endRun,
  getRunState,
  handleAgentEvent,
  releaseStuckRunLock,
  isAnyToolInProgress,
  toolOperationLost,
  TOOL_IN_PROGRESS_MAX_MS,
  RUN_LAUNCH_MIN_STUCK_IDLE_MS,
  __setWatchdogConfirmDelayForTest,
} from "./agents-bus.js";

const PROJECT = "projet-compilation";

/** Run en cours avec un agent actif « codeur » sur le projet. */
function beginRunWithAgent() {
  const ctx = beginRun(PROJECT);
  ctx.activeAgents.add("codeur");
  ctx.agentProject["codeur"] = PROJECT;
  return ctx;
}

/** Sonde Rust `agent_activity_probe` : sessions vivantes SANS preuve de travail. */
function mockProbe(sessions) {
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "list_agent_sessions" || cmd === "agent_activity_probe" ? { sessions } : undefined
  );
}

/** Événement RPC d'agent routé vers la run du projet. */
function agentEvent(type, event = {}) {
  return { payload: { project: PROJECT, agent_id: "codeur", event: { type, ...event } } };
}

/** Protocole de prudence du chien de garde : DEUX mesures concordantes. */
async function mesureTwice(opts) {
  await releaseStuckRunLock(PROJECT, opts);
  await releaseStuckRunLock(PROJECT, opts);
}

beforeEach(() => {
  __setWatchdogConfirmDelayForTest(0);
  endRun(PROJECT);
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  __setWatchdogConfirmDelayForTest();
  endRun(PROJECT);
  vi.mocked(invoke).mockReset();
});

describe("signal « outil en cours » — fonctions pures", () => {
  it("un outil ouvert il y a peu est EN COURS (activité qui avance)", () => {
    const now = Date.now();
    // Recalculé : n'importe quelle durée strictement inférieure à la borne.
    const recent = now - Math.floor(TOOL_IN_PROGRESS_MAX_MS / 2);
    expect(toolOperationLost(recent, now)).toBe(false);
    expect(isAnyToolInProgress({ codeur: recent }, now)).toBe(true);
  });

  it("au-delà de la borne existante (60 min, alignée sur le moteur), l'outil est réputé PERDU", () => {
    const now = Date.now();
    expect(toolOperationLost(now - TOOL_IN_PROGRESS_MAX_MS, now)).toBe(true);
    expect(isAnyToolInProgress({ codeur: now - TOOL_IN_PROGRESS_MAX_MS }, now)).toBe(false);
    // Juste avant la borne : encore en cours.
    expect(toolOperationLost(now - TOOL_IN_PROGRESS_MAX_MS + 1000, now)).toBe(false);
  });

  it("marqueur sans horodatage (0, null, absent) = aucune preuve → pas de blocage éternel", () => {
    const now = Date.now();
    expect(toolOperationLost(0, now)).toBe(true);
    expect(toolOperationLost(null, now)).toBe(true);
    expect(toolOperationLost(undefined, now)).toBe(true);
    expect(isAnyToolInProgress({}, now)).toBe(false);
    expect(isAnyToolInProgress(null, now)).toBe(false);
  });

  it("un seul agent avec un outil en cours suffit (run parallèle)", () => {
    const now = Date.now();
    const vieux = now - TOOL_IN_PROGRESS_MAX_MS * 2;
    expect(isAnyToolInProgress({ a: vieux, b: now }, now)).toBe(true);
    expect(isAnyToolInProgress({ a: vieux, b: vieux }, now)).toBe(false);
  });
});

describe("chien de garde — une COMPILATION en cours n'est jamais prise pour de l'inactivité", () => {
  it("compilation en cours, sonde muette → run MAINTENUE (cause exacte du défaut)", async () => {
    const ctx = beginRunWithAgent();
    // La sonde ne porte AUCUNE preuve (pas de busy, pas de toolInProgress, pas de
    // dernière activité) : c'est ce cas qui faisait conclure « session fantôme »
    // au milieu d'un build silencieux.
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    // Le bus, lui, a reçu le démarrage de l'outil (cargo build) et rien depuis.
    handleAgentEvent(agentEvent("tool_execution_start", { toolName: "bash" }));
    expect(isAnyToolInProgress(ctx.toolInProgressByAgent)).toBe(true);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("running");
  });

  it("témoin : sans outil en cours, la même situation libère bien la run (protection réelle intacte)", async () => {
    beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });

  it("une LECTURE longue (outil de consultation) compte aussi comme activité", async () => {
    const ctx = beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    // `read` est un outil de lecture pure : le repère est posé avant le retour
    // anticipé de l'historique de lecture.
    handleAgentEvent(agentEvent("tool_execution_start", { toolName: "read", args: { path: "src-tauri/src/lib.rs" } }));
    expect(isAnyToolInProgress(ctx.toolInProgressByAgent)).toBe(true);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("running");
  });

  it("la fin de l'outil (tool_execution_end) rend la run de nouveau jugeable", async () => {
    const ctx = beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    handleAgentEvent(agentEvent("tool_execution_start", { toolName: "bash" }));
    handleAgentEvent(agentEvent("tool_execution_end", { toolName: "bash" }));
    expect(isAnyToolInProgress(ctx.toolInProgressByAgent)).toBe(false);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });

  it("VRAIE session fantôme : agent mort pendant l'outil → coupée (le repère ne protège pas un mort)", async () => {
    const ctx = beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: false }]);
    handleAgentEvent(agentEvent("tool_execution_start", { toolName: "bash" }));
    expect(isAnyToolInProgress(ctx.toolInProgressByAgent)).toBe(true);
    // Le processus meurt : la fin de session lève le repère d'outil.
    handleAgentEvent(agentEvent("process_exit", { reason: "processus arrêté" }));
    expect(Object.keys(ctx.toolInProgressByAgent)).toHaveLength(0);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });

  it("fin de tour finale (agent_end sans willRetry) → plus d'outil en cours, jamais de verrou retenu", async () => {
    const ctx = beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    handleAgentEvent(agentEvent("tool_execution_start", { toolName: "bash" }));
    handleAgentEvent(agentEvent("agent_end", { willRetry: false }));
    expect(isAnyToolInProgress(ctx.toolInProgressByAgent)).toBe(false);
  });

  it("activité récente (aucun outil, run qui vient de produire un événement) → pas de coupure", async () => {
    const ctx = beginRunWithAgent();
    mockProbe([{ agent: "codeur", project: PROJECT, mode: "agent_process", alive: true }]);
    // Un événement vient d'arriver : `lastActivityAt` est à maintenant.
    handleAgentEvent(
      agentEvent("message_update", { assistantMessageEvent: { type: "text_delta", delta: "compilation en cours" } }),
    );
    expect(Date.now() - ctx.lastActivityAt).toBeLessThan(RUN_LAUNCH_MIN_STUCK_IDLE_MS);
    // Appelant OBSERVATEUR (rejeu de file, balayage) : plancher d'inactivité.
    await mesureTwice({ requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
    expect(getRunState(PROJECT)).toBe("running");
  });
});
