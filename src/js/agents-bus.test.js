// Tests unitaires — agents-bus.js (verrou de run INDEXÉ PAR PROJET, T1-T3)
// Couvre le cloisonnement par projet du verrou de run : le MÊME type d'agent
// peut tourner en parallèle sur des PROJETS DIFFÉRENTS, tout en conservant
// l'exclusivité sur un MÊME projet. `busState.runs` est vide au chargement du
// module (env vitest Node, sans Tauri/window) → `isRunInProgress()` doit
// retourner false sans amorcer le bus.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock des commandes Tauri : stopAgentsRun doit purger les réservations (T6-fix,
// fuite 1) via deleteReservations (file_exists → delete_file_or_dir). On simule
// un fichier présent pour vérifier l'ordre complet de la purge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));

import { invoke } from "@tauri-apps/api/core";
import { getRunState, beginRun, endRun, isRunInProgress, stopAgentsRun, resolveEffectiveModel, releaseStuckRunLock, handleAgentEvent } from "./agents-bus.js";
import {
  markProjectReserved,
  unmarkProjectReserved,
  isProjectReserved,
  reservationsPath,
} from "./reservations.js";

describe("isRunInProgress — source de vérité « run occupée ou non » (par projet)", () => {
  it("est exportée comme fonction (contrat de la source unique)", () => {
    expect(typeof isRunInProgress).toBe("function");
  });

  it("retourne false quand aucune run n'est en cours (état initial = idle)", () => {
    expect(isRunInProgress()).toBe(false);
    expect(isRunInProgress("projetA")).toBe(false);
  });
});

describe("resolveEffectiveModel — fallback defaultModel du model-switch.json", () => {
  // Agent normalisé (forme produite par normalizeAgent dans agents.js).
  const mkAgent = (models) => ({ id: "x", models: { pi: "", plh: "", ...models } });

  it("retourne le modèle configuré de l'agent quand il est défini", () => {
    const a = mkAgent({ pi: "ollama/qwen2", plh: "" });
    expect(resolveEffectiveModel(a, "pi", "openai/gpt-4o")).toBe("ollama/qwen2");
    // L'autre backend est utilisé si le backend actif n'a pas de modèle.
    expect(resolveEffectiveModel(a, "plh", "openai/gpt-4o")).toBe("ollama/qwen2");
  });

  it("retombe sur le defaultModel (fallback) quand l'agent n'a aucun modèle", () => {
    const a = mkAgent({});
    expect(resolveEffectiveModel(a, "pi", "anthropic/claude")).toBe("anthropic/claude");
    expect(resolveEffectiveModel(a, "plh", "anthropic/claude")).toBe("anthropic/claude");
  });

  it("retourne une chaîne vide si ni l'agent ni le fallback n'ont de modèle", () => {
    const a = mkAgent({});
    expect(resolveEffectiveModel(a, "pi", "")).toBe("");
    expect(resolveEffectiveModel(a, "unknown", "")).toBe("");
  });

  it("trim et ignore un fallback non chaîne (robustesse)", () => {
    const a = mkAgent({});
    expect(resolveEffectiveModel(a, "pi", "  openai/gpt-4o  ")).toBe("openai/gpt-4o");
    expect(resolveEffectiveModel(a, "pi", undefined)).toBe("");
    expect(resolveEffectiveModel(a, "pi", null)).toBe("");
  });
});

describe("Verrou de run INDEXÉ PAR PROJET (T1-T3)", () => {
  beforeEach(() => {
    // Nettoyer l'état entre les tests (module-level).
    endRun("projetA");
    endRun("projetB");
  });

  it("beginRun sur un projet le passe en running, l'autre reste idle (parallélisme par projet)", () => {
    beginRun("projetA");
    expect(getRunState("projetA")).toBe("running");
    // Une run sur un AUTRE projet n'est pas bloquée (état indépendant).
    expect(getRunState("projetB")).toBe("idle");
    expect(isRunInProgress("projetA")).toBe(true);
    expect(isRunInProgress("projetB")).toBe(false);
  });

  it("2 runs sur des PROJETS DIFFÉRENTS peuvent être en cours simultanément (T2 : la garde passe)", () => {
    beginRun("projetA");
    beginRun("projetB");
    expect(getRunState("projetA")).toBe("running");
    expect(getRunState("projetB")).toBe("running");
    // isRunInProgress(project) : chacune voit sa propre run.
    expect(isRunInProgress("projetA")).toBe(true);
    expect(isRunInProgress("projetB")).toBe(true);
    // Sans argument : une run est en cours sur au moins un projet (rétrocompat).
    expect(isRunInProgress()).toBe(true);
  });

  it("isRunInProgress(project) sans argument = « une run sur n'importe quel projet » (T3, rétrocompat isRunStillActive)", () => {
    beginRun("projetA");
    expect(isRunInProgress()).toBe(true);
    expect(isRunInProgress("projetB")).toBe(false);
  });

  it("endRun(project) ne libère QUE la run du projet concerné (T4 : scoping du reset)", () => {
    beginRun("projetA");
    beginRun("projetB");
    endRun("projetA");
    expect(getRunState("projetA")).toBe("idle");
    expect(getRunState("projetB")).toBe("running");
    // La run restante sur B n'est pas touchée.
    expect(isRunInProgress("projetB")).toBe(true);
    expect(isRunInProgress("projetA")).toBe(false);
  });

  it("endRun sur un projet sans run est sans effet", () => {
    endRun("projetInexistant");
    expect(getRunState("projetInexistant")).toBe("idle");
    expect(isRunInProgress()).toBe(false);
  });
});

describe("stopAgentsRun — purge des réservations (T6-fix, fuite 1)", () => {
  beforeEach(() => {
    endRun("projetA");
    endRun("projetB");
    vi.mocked(invoke).mockClear();
  });

  it("purge les réservations des runs arrêtées AVANT de vider les runs (plus de fichier résiduel)", async () => {
    // Réservations actives sur le projet d'une run en cours.
    markProjectReserved("projetA", "codeur1");
    beginRun("projetA");
    await stopAgentsRun();
    // La purge disque a été demandée (file_exists simulé présent → suppression).
    const calls = vi.mocked(invoke).mock.calls;
    const del = calls.find((c) => c[0] === "delete_file_or_dir");
    expect(del).toBeTruthy();
    expect(del[1].path).toBe(reservationsPath("projetA"));
    // La map mémoire est nettoyée et la run vidée (le chemin "stopping" ne
    // laisse ni fichier résiduel ni verrou bloqué).
    expect(isProjectReserved("projetA")).toBe(false);
    expect(getRunState("projetA")).toBe("idle");
    expect(isRunInProgress("projetA")).toBe(false);
  });

  it("purge les réservations de TOUS les projets concernés (arrêt global)", async () => {
    markProjectReserved("projetA", "codeur1");
    markProjectReserved("projetB", "codeur2");
    beginRun("projetA");
    beginRun("projetB");
    await stopAgentsRun();
    const deleted = vi.mocked(invoke).mock.calls
      .filter((c) => c[0] === "delete_file_or_dir")
      .map((c) => c[1].path);
    expect(deleted).toContain(reservationsPath("projetA"));
    expect(deleted).toContain(reservationsPath("projetB"));
    expect(isProjectReserved("projetA")).toBe(false);
    expect(isProjectReserved("projetB")).toBe(false);
  });

  it("sans run en cours : aucun abort, aucune purge (retour immédiat)", async () => {
    markProjectReserved("projetA", "codeur1");
    await stopAgentsRun();
    const cmds = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(cmds).not.toContain("abort_agent_process");
    expect(cmds).not.toContain("delete_file_or_dir");
    // La réservation n'est PAS purgée par stopAgentsRun sans run active : elle
    // le sera par la purge au démarrage du bus (fuite 2) ou l'estimation suivante.
    expect(isProjectReserved("projetA")).toBe(true);
    unmarkProjectReserved("projetA");
  });
});

// ── Chantier 6/6 : verrou fantôme (session vivante ≠ run en cours) ──────────
// Incident du 29/08 : des délégations étaient rejetées « Une run est déjà en
// cours sur ce projet » alors que la session de l'agent était simplement
// VIVANTE mais inactive (parkée après agent_settled). Le watchdog
// (releaseStuckRunLock, appelé en tête de startAgentsRun/startParallelRun)
// doit libérer le verrou quand aucun agent n'est VRAIMENT en activité, et le
// maintenir quand un agent travaille réellement (busy ou activité récente).
describe("releaseStuckRunLock — verrou fantôme (chantier 6/6)", () => {
  beforeEach(() => {
    endRun("projetA");
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => {
    endRun("projetA");
    // Restaurer l'implémentation par défaut du mock (mockReset réinitialise
    // l'implémentation d'origine passée à vi.fn dans la factory du mock).
    vi.mocked(invoke).mockReset();
  });

  /** Pose la run en cours avec un agent actif « magnus » sur le projet. */
  const beginRunWithAgent = () => {
    const ctx = beginRun("projetA");
    ctx.activeAgents.add("magnus");
    ctx.agentProject["magnus"] = "projetA";
    return ctx;
  };
  /** Mock la sonde Rust list_agent_sessions. */
  const mockSessions = (sessions) => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "list_agent_sessions" ? { sessions } : undefined
    );
  };
  const session = (extra = {}) => (
    { agent: "magnus", project: "projetA", mode: "agent_process", alive: true, ...extra }
  );

  it("scénario du bug : agent vivant mais inactif (parké) → verrou libéré, la délégation passe", async () => {
    beginRunWithAgent();
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() })]);
    await releaseStuckRunLock("projetA");
    // Le système se détache de la session fantôme : le verrou est libéré →
    // la prochaine demande n'est plus rejetée « Une run est déjà en cours ».
    expect(getRunState("projetA")).toBe("idle");
  });

  it("agent réellement au travail (busy=true) → verrou MAINTENU (pas de double run)", async () => {
    beginRunWithAgent();
    mockSessions([session({ busy: true })]);
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
  });

  it("activité très récente (busy pas encore posé, lastActivity < 2 min) → verrou maintenu (fenêtre de grâce)", async () => {
    beginRunWithAgent();
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 30_000).toISOString() })]);
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
  });

  it("données manquantes (sans busy ni lastActivity) → JAMAIS de verrou (fail-open)", async () => {
    beginRunWithAgent();
    mockSessions([session()]); // vivante, sans busy ni lastActivity
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("idle");
  });

  it("sonde de sessions en erreur → verrou libéré (fail-open, jamais de faux verrou)", async () => {
    beginRunWithAgent();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") throw new Error("sonde indisponible");
      return undefined;
    });
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("idle");
  });

  it("session morte (alive=false avec busy résiduel) → verrou libéré", async () => {
    beginRunWithAgent();
    mockSessions([session({ alive: false, busy: true })]);
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("idle");
  });

  it("run orpheline sans agent actif → libération immédiate (cas 1 inchangé)", async () => {
    beginRun("projetA");
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("idle");
  });
});

// ── Restitution fiable (fin de run → assistant) ───────────────────────────
// Chantier : « les agents finissent (agent_settled) mais leur résultat
// n'arrive JAMAIS dans la conversation de l'Assistant ». Causes testées ici :
//  1. agent_end PRÉMATURÉ avec willRetry=true (pi relance automatiquement) —
//     la run ne doit PAS être finalisée sur cet événement ;
//  2. agent_settled = filet « zéro perte » si l'agent_end final est perdu ;
//  3. agent_settled PÉRIMÉ (run précédente, session réutilisée) → ignoré ;
//  4. erreur pi transitoire (message stopReason=error) → échec différé,
//     annulé si une relance automatique suit ;
//  5. idempotence : agent_end final + agent_settled → un seul agrégat.
describe("handleAgentEvent — restitution fiable (fin de run → assistant)", () => {
  /** Flushe les microtâches (finishAgentTurn / onComplete sont async). */
  const flushAsync = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  /** Prépare une run parallèle avec deux agents actifs et un onComplete espion. */
  const beginParallelRun = () => {
    const ctx = beginRun("projetA");
    ctx.activeAgents.add("coder");
    ctx.activeAgents.add("architec");
    ctx.agentProject["coder"] = "projetA";
    ctx.agentProject["architec"] = "projetA";
    const completions = [];
    ctx.parallelGroup = {
      assignments: [{ agentId: "coder" }, { agentId: "architec" }],
      pending: 2,
      results: {},
      onComplete: (results) => completions.push(results),
    };
    return { ctx, completions };
  };
  /** Événement de fin générique (agent_start / agent_end / agent_settled…). */
  const ev = (agentId, type, event = {}) => ({
    payload: { project: "projetA", agent_id: agentId, event: { type, ...event } },
  });
  /** Delta de texte (message_update) accumulé dans le buffer de l'agent. */
  const delta = (agentId, text) => ({
    payload: {
      project: "projetA",
      agent_id: agentId,
      event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } },
    },
  });
  /** Message assistant pi (stopReason error ⇒ erreur fournisseur). */
  const errMsg = (agentId, text) =>
    ev(agentId, "message", {
      message: { role: "assistant", stopReason: "error", errorMessage: text, content: [] },
    });

  afterEach(() => {
    endRun("projetA");
    vi.mocked(invoke).mockReset();
  });

  it("agent_end avec willRetry=true ne finalise PAS le tour (la relance suit)", async () => {
    const { ctx, completions } = beginParallelRun();
    handleAgentEvent(delta("coder", "début du travail"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: true }));
    // L'agent reste actif : pi va se relancer tout seul, le tour continue.
    expect(ctx.activeAgents.has("coder")).toBe(true);
    expect(ctx.parallelGroup.pending).toBe(2);
    expect(completions).toHaveLength(0);
    // La run reste "running" (aucun endRun prématuré).
    expect(getRunState("projetA")).toBe("running");
    await flushAsync();
    expect(completions).toHaveLength(0);
  });

  it("scénario du bug : willRetry puis agent_end final → le VRAI résultat agrégé aboutit", async () => {
    const { ctx, completions } = beginParallelRun();
    // Tour 1 (échec transitoire) pi se relance : le travail réel est produit
    // APRÈS le premier agent_end — c'est lui qui doit être restitué.
    handleAgentEvent(ev("coder", "agent_start"));
    handleAgentEvent(delta("coder", "tentative 1"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: true }));
    handleAgentEvent(ev("coder", "agent_start"));
    handleAgentEvent(delta("coder", "résultat final complet"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: false }));
    await flushAsync();
    // L'agent est finalisé avec le texte de la relance (pas la tentative 1)…
    expect(ctx.activeAgents.has("coder")).toBe(false);
    expect(ctx.parallelGroup.results["coder"]).toEqual({
      status: "done",
      text: "résultat final complet",
    });
    expect(completions).toHaveLength(0); // il reste "architec" (pending=1)
    // …et le 2e agent peut terminer normalement (agent_end classique).
    handleAgentEvent(ev("architec", "agent_start"));
    handleAgentEvent(delta("architec", "ok architecte"));
    handleAgentEvent(ev("architec", "agent_end", { willRetry: false }));
    await flushAsync();
    expect(completions).toHaveLength(1);
    // Restitution : les DEUX résultats atteignent le regroupement (onComplete).
    expect(completions[0]["architec"]).toEqual({ status: "done", text: "ok architecte" });
  });

  it("agent_settled en filet : finalise un tour dont l'agent_end final a été perdu", async () => {
    const { ctx, completions } = beginParallelRun();
    // L'agent_end final est PERDU (seul agent_settled arrive).
    handleAgentEvent(ev("coder", "agent_start"));
    handleAgentEvent(delta("coder", "travail perdu côté coder"));
    handleAgentEvent(ev("architec", "agent_start"));
    handleAgentEvent(delta("architec", "archi OK"));
    handleAgentEvent(ev("architec", "agent_end", { willRetry: false }));
    handleAgentEvent(ev("coder", "agent_settled"));
    await flushAsync();
    expect(completions).toHaveLength(1);
    expect(completions[0]["coder"]).toEqual({ status: "done", text: "travail perdu côté coder" });
  });

  it("agent_settled périmé (aucun agent_start vu dans cette run) → ignoré", async () => {
    const { ctx, completions } = beginParallelRun();
    // Aucun agent_start n'a été vu pour "coder" dans CETTE run : l'agent_settled
    // est périmé (événement de la session précédente, processus réutilisé).
    handleAgentEvent(ev("coder", "agent_settled"));
    await flushAsync();
    expect(completions).toHaveLength(0);
    // L'agent n'a PAS été finalisé par un événement périmé : la run continue.
    expect(ctx.activeAgents.has("coder")).toBe(true);
    expect(ctx.parallelGroup.pending).toBe(2);
  });

  it("double finalisation impossible : agent_end final puis agent_settled → un agrégat", async () => {
    const { ctx, completions } = beginParallelRun();
    handleAgentEvent(ev("coder", "agent_start"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: false }));
    handleAgentEvent(ev("architec", "agent_start"));
    handleAgentEvent(ev("architec", "agent_end", { willRetry: false }));
    await flushAsync();
    expect(completions).toHaveLength(1); // run terminée normalement
    // agent_settled de la MÊME session, arrivé après : ignoré (idempotence).
    handleAgentEvent(ev("coder", "agent_settled"));
    handleAgentEvent(ev("architec", "agent_settled"));
    await flushAsync();
    expect(completions).toHaveLength(1);
  });

  it("erreur pi transitoire suivie d'auto_retry → tour continu, succès final", async () => {
    const { ctx, completions } = beginParallelRun();
    handleAgentEvent(ev("coder", "agent_start"));
    // Message d'erreur du fournisseur (ex: 429) : pas d'échec immédiat.
    handleAgentEvent(errMsg("coder", "Connection error."));
    handleAgentEvent(ev("coder", "auto_retry_start"));
    // pi relance et produit le vrai résultat.
    handleAgentEvent(delta("coder", "réponse après relance"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: false }));
    await flushAsync();
    expect(ctx.parallelGroup.results["coder"]).toEqual({
      status: "done",
      text: "réponse après relance",
    });
    expect(completions).toHaveLength(0); // il reste "architec" (pending=1)
  });

  it("erreur définitive (pas de relance) → échec prononcé à l'agent_end final", async () => {
    const { ctx, completions } = beginParallelRun();
    handleAgentEvent(ev("coder", "agent_start"));
    handleAgentEvent(errMsg("coder", "credits depleted"));
    handleAgentEvent(ev("coder", "agent_end", { willRetry: false }));
    await flushAsync();
    // L'erreur mémorisée est prononcée à la FIN du tour (plus d'échec immédiat).
    expect(ctx.activeAgents.has("coder")).toBe(false);
    expect(ctx.parallelGroup.results["coder"].status).toBe("error");
  });
});
