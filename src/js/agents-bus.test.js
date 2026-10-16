// Tests unitaires — agents-bus.js (verrou de run INDEXÉ PAR PROJET, T1-T3)
// Couvre le cloisonnement par projet du verrou de run : le MÊME type d'agent
// peut tourner en parallèle sur des PROJETS DIFFÉRENTS, tout en conservant
// l'exclusivité sur un MÊME projet. `busState.runs` est vide au chargement du
// module (env vitest Node, sans Tauri/window) → `isRunInProgress()` doit
// retourner false sans amorcer le bus.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// Mock des commandes Tauri : stopAgentsRun doit purger les réservations (T6-fix,
// fuite 1) via deleteReservations (file_exists → delete_file_or_dir). On simule
// un fichier présent pour vérifier l'ordre complet de la purge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));

import { invoke } from "@tauri-apps/api/core";
import { getRunState, beginRun, endRun, isRunInProgress, stopAgentsRun, resolveEffectiveModel, describeModelFallback, releaseStuckRunLock, handleAgentEvent, needsFreshAgentSession, attachMissionSink, settleMission, buildWatchdogReleaseMessage, provesWorkOnDisk, resolveWantedThinkingLevel, applyAgentThinkingLevel, __setWatchdogConfirmDelayForTest } from "./agents-bus.js";
import {
  markProjectReserved,
  unmarkProjectReserved,
  isProjectReserved,
  reservationsPath,
} from "./reservations.js";
import { enqueueExclusivity } from "./exclusivity-queue.js";

describe("isRunInProgress — source de vérité « run occupée ou non » (par projet)", () => {
  it("est exportée comme fonction (contrat de la source unique)", () => {
    expect(typeof isRunInProgress).toBe("function");
  });

  it("retourne false quand aucune run n'est en cours (état initial = idle)", () => {
    expect(isRunInProgress()).toBe(false);
    expect(isRunInProgress("projetA")).toBe(false);
  });
});

describe("endRun — protection par génération (fin de run tardive)", () => {
  it("un endRun tardif (ancienne génération) ne supprime PAS le contexte d'une run plus récente", () => {
    const oldCtx = beginRun("projetGen");
    const genOld = oldCtx.generation;
    // Une NOUVELLE run démarre sur le même projet avant que l'ancienne (abandonnée)
    // ne se termine : chaque beginRun pose une génération neuve.
    const newCtx = beginRun("projetGen");
    expect(newCtx.generation).not.toBe(genOld);
    expect(getRunState("projetGen")).toBe("running");
    // Fin TARDIVE de l'ancienne run → ignorée, la nouvelle reste intacte.
    endRun("projetGen", genOld);
    expect(getRunState("projetGen")).toBe("running");
    // Fin de la run COURANTE → libère bien le contexte.
    endRun("projetGen", newCtx.generation);
    expect(getRunState("projetGen")).toBe("idle");
  });

  it("endRun sans génération (appel legacy / libération forcée) reste inconditionnel", () => {
    beginRun("projetGen");
    endRun("projetGen");
    expect(getRunState("projetGen")).toBe("idle");
  });
});

describe("needsFreshAgentSession — contexte vierge pour relance d'agents secondaires (restitution fiable)", () => {
  const keep = { id: "code", keep_context: true };
  const noKeep = { id: "review", keep_context: false }; // défaut des agents secondaires

  it("exige un contexte vierge pour un agent sans keep_context (défaut des agents secondaires)", () => {
    expect(needsFreshAgentSession(noKeep, undefined)).toBe(true);
    expect(needsFreshAgentSession(noKeep, {})).toBe(true);
  });

  it("exige un contexte vierge quand options.purge est vrai, même pour un keep_context", () => {
    expect(needsFreshAgentSession(keep, { purge: true })).toBe(true);
  });

  it("conserve la reprise (false) pour un agent keep_context sans purge", () => {
    expect(needsFreshAgentSession(keep, undefined)).toBe(false);
    expect(needsFreshAgentSession(keep, {})).toBe(false);
    expect(needsFreshAgentSession(keep, { purge: false })).toBe(false);
  });

  it("purge non-booléenne / absent ne force pas un tour keep_context", () => {
    expect(needsFreshAgentSession(keep, { purge: 0 })).toBe(false);
    expect(needsFreshAgentSession(keep, null)).toBe(false);
  });

  it("gère un agent manquant sans erreur (fail-open)", () => {
    expect(needsFreshAgentSession(null, {})).toBe(false);
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

describe("describeModelFallback — repli de modèle VISIBLE (point de suivi 331)", () => {
  const mkAgent = (models) => ({ id: "codeur", models: { pi: "", plh: "", ...models } });

  it("aucun repli quand l'agent a un modèle pour le backend actif", () => {
    const info = describeModelFallback(mkAgent({ pi: "ollama/qwen2" }), "pi", "openai/gpt-4o");
    expect(info.fallback).toBe(false);
    expect(info.source).toBe("agent");
    expect(info.model).toBe("ollama/qwen2");
    expect(info.message).toBe("");
  });

  it("repli CROISÉ (modèle de l'autre moteur) signalé avec le modèle employé", () => {
    const info = describeModelFallback(mkAgent({ pi: "ollama/qwen2" }), "plh", "openai/gpt-4o");
    expect(info.fallback).toBe(true);
    expect(info.source).toBe("cross");
    expect(info.model).toBe("ollama/qwen2");
    expect(info.message).toContain("ollama/qwen2");
    expect(info.message).toContain("codeur");
  });

  it("repli sur le defaultModel signalé lui aussi", () => {
    const info = describeModelFallback(mkAgent({}), "pi", "anthropic/claude");
    expect(info.fallback).toBe(true);
    expect(info.source).toBe("default");
    expect(info.model).toBe("anthropic/claude");
    expect(info.message).toContain("anthropic/claude");
  });

  it("aucun modèle disponible → pas de repli silencieux ni message (échec explicite déjà géré)", () => {
    const info = describeModelFallback(mkAgent({}), "pi", "");
    expect(info.model).toBe("");
    expect(info.fallback).toBe(false);
    expect(info.source).toBe("none");
    expect(info.message).toBe("");
  });

  it("robuste aux entrées manquantes (agent absent, fallback non chaîne)", () => {
    expect(describeModelFallback(null, "pi", "openai/gpt-4o")).toEqual({
      model: "openai/gpt-4o",
      fallback: true,
      source: "default",
      message: expect.stringContaining("openai/gpt-4o"),
    });
    const info = describeModelFallback(mkAgent({ pi: "p/m" }), "pi", undefined);
    expect(info.model).toBe("p/m");
    expect(info.fallback).toBe(false);
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
  /** Protocole de prudence : DEUX mesures concordantes exigées (écart nul en test). */
  const releaseConfirmed = async (project = "projetA") => {
    await releaseStuckRunLock(project);
    await releaseStuckRunLock(project);
  };
  beforeEach(() => {
    __setWatchdogConfirmDelayForTest(0);
    endRun("projetA");
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => {
    __setWatchdogConfirmDelayForTest();
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

  it("scénario du bug : agent vivant mais inactif (parké) → verrou libéré APRÈS deux mesures concordantes", async () => {
    beginRunWithAgent();
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() })]);
    // Prudence (mission « libération abusive ») : la 1re mesure NE libère PAS
    // (l'agent peut n'être pas encore enregistré côté Rust).
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
    // 2e mesure concordante → libération.
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

  it("agent au travail (busy=true) mais silence apparent > agent_timeout_ms → verrou MAINTENU (outil long silencieux)", async () => {
    const ctx = beginRunWithAgent();
    // Le bus n'a reçu aucun événement depuis le seuil d'inactivité (outil long :
    // build, tests, lecture)…
    ctx.lastActivityAt = Date.now() - 11 * 60 * 1000;
    // …mais la sonde de vivacité dit que l'agent travaille encore.
    mockSessions([session({ busy: true, lastActivity: new Date().toISOString() })]);
    await releaseStuckRunLock("projetA");
    // La garde de temps ne doit PAS libérer le créneau d'un agent en travail
    // (elle ne s'applique qu'en l'absence de tout agent actif).
    expect(getRunState("projetA")).toBe("running");
  });

  it("activité très récente (busy pas encore posé, lastActivity < 2 min) → verrou maintenu (fenêtre de grâce)", async () => {
    beginRunWithAgent();
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 30_000).toISOString() })]);
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
  });

  it("données manquantes (sans busy ni lastActivity) → aucune session travailleuse → verrou libéré (après confirmation)", async () => {
    beginRunWithAgent();
    mockSessions([session()]); // vivante, sans busy ni lastActivity
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("idle");
  });

  it("faux positif du rejeu de file : run fraîche, agent actif silencieux (aucune donnée sonde) → verrou MAINTENU avec un plancher d'inactivité", async () => {
    // Cause racine des pertes de travail : la sonde d'admission du rejeu de file
    // (cadencée à 15 s) appelait `releaseStuckRunLock` sans condition de durée.
    // Un run qui venait de démarrer (agent déclaré actif, session pas encore
    // enregistrée côté Rust : ni busy ni lastActivity) était donc coupé au bout
    // de quelques secondes alors que l'agent travaillait encore en silence
    // (réflexion, lecture d'un gros fichier, série de tests).
    beginRunWithAgent();
    mockSessions([session()]); // vivante, sans busy ni lastActivity
    // Appelant OBSERVATEUR : il exige une inactivité d'au moins 2 min. La run
    // vient de démarrer → rien à couper, même après deux mesures concordantes.
    await releaseStuckRunLock("projetA", { requireIdleMs: 2 * 60 * 1000 });
    await releaseStuckRunLock("projetA", { requireIdleMs: 2 * 60 * 1000 });
    expect(getRunState("projetA")).toBe("running");
  });

  it("plancher d'inactivité : au-delà du plancher, la session fantôme est bien libérée (protection réelle préservée)", async () => {
    // Même avec un plancher d'inactivité, un FAUX verrou (session vivante mais au
    // repos depuis bien plus que le plancher) reste libéré : la protection
    // réelle (verrou fantôme, agent mort, réservation abandonnée) est intacte.
    const ctx = beginRunWithAgent();
    ctx.startedAt = Date.now() - 5 * 60 * 1000;
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 5 * 60 * 1000).toISOString() })]);
    await releaseStuckRunLock("projetA", { requireIdleMs: 2 * 60 * 1000 });
    await releaseStuckRunLock("projetA", { requireIdleMs: 2 * 60 * 1000 });
    expect(getRunState("projetA")).toBe("idle");
  });

  it("sonde de sessions en erreur → verrou MAINTENU (fail-closed : jamais de libération sur incertitude)", async () => {
    beginRunWithAgent();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") throw new Error("sonde indisponible");
      return undefined;
    });
    // AVANT : fail-open → libération (et donc risque de double run).
    // MAINTENANT : fail-closed → le verrou est conservé.
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("running");
  });

  it("session morte (alive=false avec busy résiduel) → verrou libéré", async () => {
    beginRunWithAgent();
    mockSessions([session({ alive: false, busy: true })]);
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("idle");
  });

  it("busy-stale (busy=true retenu par un process figé, dernière activité ancienne) → verrou libéré", async () => {
    // Cause racine du verrou fantôme : un process pi FIGÉ (vivant, ni settled ni
    // exit) laisse busy=true bien qu'aucun travail n'avance. isAnyAgentWorking le
    // considère non-travailleur → aucun agent réellement actif → verrou libéré.
    beginRunWithAgent();
    mockSessions([session({ busy: true, lastActivity: new Date(Date.now() - 26 * 60 * 1000).toISOString() })]);
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("idle");
  });

  it("instrumentation : le message NOMME la porte qui a tiré, l'agent et l'inactivité mesurée", async () => {
    const ctx = beginRunWithAgent();
    ctx.lastActivityAt = Date.now() - 10 * 60 * 1000;
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() })]);
    let msg = "";
    attachMissionSink(ctx.runKey, { onDone: () => {}, onError: (e) => (msg = e.message) });
    await releaseConfirmed();
    // Avant : les quatre portes émettaient le même message. Maintenant la cause
    // est visible : porte + agents + inactivité réellement mesurée.
    expect(msg).toContain("agents déclarés actifs");
    expect(msg).toContain("magnus");
    expect(msg).toContain("10 min");
  });

  it("message HONNÊTE : du travail produit avant l'arrêt → « run interrompue, partiel », jamais « échec »", async () => {
    const ctx = beginRunWithAgent();
    ctx.producedText = "Analyse partielle : le module X dépend de Y.";
    ctx.lastActivityAt = Date.now() - 10 * 60 * 1000;
    mockSessions([session({ busy: false, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() })]);
    let done = null;
    let err = null;
    attachMissionSink(ctx.runKey, { onDone: (t) => (done = t), onError: (e) => (err = e) });
    await releaseConfirmed();
    expect(err).toBeNull();
    expect(done).toContain("Run interrompue");
    expect(done).toContain("Analyse partielle");
  });

  it("mission 310 : travail COMMITTÉ pendant la run → la mission n'est PAS annoncée en échec", async () => {
    // Cas réel (2026-10-01 14:46) : run libérée par la porte `ghosts` avec
    // « inactivité mesurée : 14 min 4 s » alors que du travail a été écrit et
    // committé pendant cette fenêtre, et que l'agent déclaré n'avait AUCUNE
    // session visible par la sonde. Sans vérification du disque, la mission
    // était annoncée en échec (et donc relancée alors qu'elle était faite).
    const ctx = beginRunWithAgent();
    ctx.startedAt = Date.now() - 14 * 60 * 1000;
    ctx.lastActivityAt = ctx.startedAt;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") return { sessions: [] };
      if (cmd === "git_status_project") {
        // Commit tombé 4 min APRÈS le démarrage de la run.
        return { is_repo: true, head_ts: Math.round((ctx.startedAt + 4 * 60 * 1000) / 1000), pending: 0 };
      }
      return undefined;
    });
    let done = null;
    let err = null;
    attachMissionSink(ctx.runKey, { onDone: (t) => (done = t), onError: (e) => (err = e) });
    await releaseConfirmed();
    expect(err).toBeNull();
    expect(done).toContain("PRÉSENT sur le disque");
    expect(done).toContain("PAS un échec");
  });

  it("mission 310 : aucun travail sur le disque (commit antérieur, rien de modifié) → échec honnête conservé", async () => {
    const ctx = beginRunWithAgent();
    ctx.lastActivityAt = Date.now() - 10 * 60 * 1000;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") {
        return { sessions: [session({ busy: false, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() })] };
      }
      if (cmd === "git_status_project") {
        return { is_repo: true, head_ts: Math.round((ctx.startedAt - 60 * 60 * 1000) / 1000), pending: 0 };
      }
      return undefined;
    });
    let done = null;
    let msg = "";
    attachMissionSink(ctx.runKey, { onDone: (t) => (done = t), onError: (e) => (msg = e.message) });
    await releaseConfirmed();
    expect(done).toBeNull();
    expect(msg).toContain("Aucun travail nouveau détecté sur le disque");
  });

  it("mission 310 : outil en cours (toolInProgress) alors que busy est faux → run MAINTENUE", async () => {
    beginRunWithAgent();
    // Aucun événement depuis 10 min (outil long silencieux : build, tests) et pi
    // a déjà émis un agent_end (busy=false) : seul toolInProgress témoigne du
    // travail encore en cours. Le libérer coupait l'agent au milieu du travail.
    mockSessions([
      session({ busy: false, toolInProgress: true, lastActivity: new Date(Date.now() - 10 * 60 * 1000).toISOString() }),
    ]);
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("running");
  });

  it("mission 310 : une AUTRE session du projet produit encore → run MAINTENUE (agent déclaré sans session)", async () => {
    beginRunWithAgent();
    // L'agent déclaré (« magnus ») n'a aucune session : la porte `ghosts`
    // concluait « plus aucun agent ne travaille » alors que le projet produit.
    mockSessions([
      { agent: "autre-agent", project: "projetA", mode: "main", alive: true, busy: true },
    ]);
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("running");
  });

  it("objectif 5 : fin NORMALE d'une mission → statut de l'agent remis au repos (Paused, busy=false)", async () => {
    beginRunWithAgent();
    const calls = [];
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      calls.push([cmd, args]);
      return undefined;
    });
    const ev = (type, event = {}) => ({
      payload: { project: "projetA", agent_id: "magnus", event: { type, ...event } },
    });
    handleAgentEvent({
      payload: {
        project: "projetA",
        agent_id: "magnus",
        event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "mission terminée" } },
      },
    });
    handleAgentEvent(ev("agent_start"));
    handleAgentEvent(ev("agent_end", { willRetry: false }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    // AVANT : proc_state restait « Running » (agent affiché en cours à vie) —
    // l'observateur Rust ne remettait à zéro que sa map d'activité en mémoire.
    const call = calls.find(([c]) => c === "set_agent_state");
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({
      agentId: "magnus",
      projectPath: "projetA",
      loaded: true,
      busy: false,
      procState: "Paused",
    });
  });

  it("run orpheline sans agent actif → libération immédiate (cas 1 inchangé)", async () => {
    beginRun("projetA");
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("idle");
  });
});

// Instrumentation pure (mission « libération abusive du verrou de run ») : le
// message de libération doit distinguer les quatre portes (avant, un seul
// message identique pour toutes → cause invisible).
describe("buildWatchdogReleaseMessage — instrumentation des portes du watchdog", () => {
  it("les quatre portes produisent des messages DIFFÉRENTS et nomment agents + inactivité", () => {
    const msgs = ["noActive", "residualParallel", "ghosts", "orphanQueue"].map((door) =>
      buildWatchdogReleaseMessage({ door, agents: ["magnus"], idleMs: 90_000, queued: 2 }),
    );
    expect(new Set(msgs).size).toBe(4);
    expect(msgs[2]).toContain("agents déclarés actifs mais plus aucun ne travaille");
    expect(msgs[2]).toContain("magnus");
    expect(msgs[2]).toContain("1 min 30 s");
    expect(msgs[2]).toContain("2 demande(s) encore en file");
    // Sans agent et sans mesure : message honnête, pas de champ inventé.
    const bare = buildWatchdogReleaseMessage({ door: "noActive" });
    expect(bare).toContain("aucun agent actif");
    expect(bare).toContain("aucun agent enregistré");
    expect(bare).not.toContain("inactivité");
  });
});
// Incident : après la mort silencieuse d'un agent (proc_state='Running' sans
// processus vivant, busy retombé à 0), le verrou de run du projet restait
// « running » indéfiniment : `releaseStuckRunLock` ne détectait pas le cas
// « groupe parallèle avec du travail encore EN FILE (pending > 0) mais AUCUN
// agent actif », et sa garde de temps dépendait de `lastActivityAt` (jamais posé
// si aucun événement d'agent n'avait été reçu). Résultat : toutes les demandes
// suivantes étaient mises en file en silence, sans jamais démarrer, jusqu'au
// redémarrage de Pilot (la variante de casse du chemin contournait le verrou).
describe("releaseStuckRunLock — verrou orphelin : travail en file sans porteur (issue #87)", () => {
  /** Protocole de prudence : DEUX mesures concordantes exigées (écart nul en test). */
  const releaseConfirmed = async (project = "projetA") => {
    await releaseStuckRunLock(project);
    await releaseStuckRunLock(project);
  };
  beforeEach(() => {
    __setWatchdogConfirmDelayForTest(0);
    endRun("projetA");
    vi.mocked(invoke).mockClear();
  });
  afterEach(() => {
    __setWatchdogConfirmDelayForTest();
    endRun("projetA");
    vi.mocked(invoke).mockReset();
  });

  /** Run avec du travail en file (pending > 0) mais aucun agent actif. */
  const beginOrphanRun = ({ idleMs, assignment } = {}) => {
    const ctx = beginRun("projetA");
    ctx.parallelGroup = {
      assignments: assignment ? [assignment] : [],
      pending: 1,
      results: {},
      onComplete: async () => {},
    };
    // Aucune activité jamais reçue : `lastActivityAt` reste null.
    ctx.startedAt = Date.now() - (idleMs === undefined ? 120_000 : idleMs);
    return ctx;
  };
  const mockSessions = (sessions) => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "list_agent_sessions" ? { sessions } : undefined
    );
  };

  it("travail en file, aucun agent porteur, file vide → verrou LIBÉRÉ (jamais de blocage permanent)", async () => {
    beginOrphanRun();
    mockSessions([]); // aucun processus vivant sur le projet
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("idle");
  });

  it("file NON drainable (clé invalide) → verrou CONSERVÉ : aucune mission abandonnée", async () => {
    const ctx = beginOrphanRun();
    // Clé sans séparateur → `drainExclusivityQueues` ne peut pas la lancer : la
    // demande resterait en file. Libérer le verrou la perdrait définitivement.
    ctx.exclusivityQueue["cle-invalide"] = [
      { agentId: "magnus", brief: "travail en attente", project: "projetA" },
    ];
    mockSessions([]);
    await releaseConfirmed();
    expect(getRunState("projetA")).toBe("running");
    expect(ctx.exclusivityQueue["cle-invalide"].length).toBe(1);
  });

  it("demande en file derrière un agent fantôme → la demande est RELANCÉE (le verrou est conservé)", async () => {
    const demande = { agentId: "magnus", brief: "travail en attente", project: "projetA" };
    const ctx = beginOrphanRun({ assignment: demande });
    enqueueExclusivity(ctx.exclusivityQueue, "magnus", "projetA", demande);
    mockSessions([]);
    await releaseStuckRunLock("projetA");
    // La demande en attente est bien sortie de la file (relancée) au lieu de
    // rester coincée : le groupe parallèle n'attend plus personne.
    expect(ctx.parallelGroup.pending).toBe(0);
    expect(ctx.exclusivityQueue[`projetA\u{1f}magnus`]).toBeUndefined();
    expect(getRunState("projetA")).toBe("running");
  });

  it("un agent travaille encore sur le projet (hors agents actifs du contexte) → verrou MAINTENU", async () => {
    beginOrphanRun({ idleMs: 120_000 });
    mockSessions([{ agent: "autre", project: "projetA", mode: "agent_process", alive: true, busy: true }]);
    await releaseStuckRunLock("projetA");
    // La demande en file doit continuer d'attendre un travail réellement en
    // cours : jamais de double run par-dessus.
    expect(getRunState("projetA")).toBe("running");
  });

  it("run qui vient de démarrer (pending > 0, aucun agent encore actif) → verrou MAINTENU (fenêtre de grâce)", async () => {
    beginOrphanRun({ idleMs: 0 });
    mockSessions([]);
    await releaseStuckRunLock("projetA");
    // Aucune coupe d'une run en cours de démarrage (entre beginRun et l'entrée
    // du premier agent dans activeAgents).
    expect(getRunState("projetA")).toBe("running");
  });

  it("sonde de sessions indisponible → verrou MAINTENU pour un travail en file (jamais de libération sur incertitude)", async () => {
    beginOrphanRun();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agent_sessions") throw new Error("sonde indisponible");
      return undefined;
    });
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
  });

  it("garde de temps : run sans AUCUN événement (lastActivityAt null) et sans file → libérée via startedAt", async () => {
    const ctx = beginRun("projetA");
    ctx.agentProject["magnus"] = "projetA";
    ctx.activeAgents.add("magnus");
    ctx.startedAt = Date.now() - (11 * 60 * 1000); // > timeoutMs (10 min)
    ctx.lastActivityAt = null; // aucun événement d'agent jamais reçu
    mockSessions([{ agent: "magnus", project: "projetA", mode: "agent_process", alive: true }]);
    await releaseStuckRunLock("projetA");
    expect(getRunState("projetA")).toBe("running");
    // 2e mesure : l'agent ne travaille toujours pas → la garde de temps libère.
    ctx.lastActivityAt = null;
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

// ── Livraison croisée des rapports (missions parallèles) ────────────────────
// Défaut corrigé : `_runAgentsForAssistant` écrasait l'état GLOBAL
// `busState.callbacks` → la seconde mission écrasait la première et un rapport
// de fin pouvait être livré à la mauvaise mission. La livraison est désormais
// indexée par CLÉ DE RUN (sink par mission).
describe("livraison du rapport par mission (sink par clé de run)", () => {
  it("chaque mission reçoit SON rapport (aucune livraison croisée)", () => {
    const ctxA = beginRun("projetMissionA");
    const ctxB = beginRun("projetMissionB");
    const got = {};
    attachMissionSink(ctxA.runKey, { onDone: (t) => (got.A = t), onError: () => (got.A = "erreur") });
    attachMissionSink(ctxB.runKey, { onDone: (t) => (got.B = t), onError: () => (got.B = "erreur") });

    expect(settleMission(ctxA.runKey, "done", { text: "rapport A" })).toBe(true);
    expect(got.A).toBe("rapport A");
    expect(got.B).toBeUndefined(); // le rapport de A n'est PAS livré à B

    expect(settleMission(ctxB.runKey, "done", { text: "rapport B" })).toBe(true);
    expect(got.B).toBe("rapport B");
    expect(got.A).toBe("rapport A"); // inchangé

    endRun("projetMissionA", ctxA.generation);
    endRun("projetMissionB", ctxB.generation);
  });

  it("un sink n'est résolu qu'une fois (pas de double rapport)", () => {
    const ctx = beginRun("projetMissionOnce");
    let count = 0;
    attachMissionSink(ctx.runKey, { onDone: () => count++, onError: () => count++ });
    expect(settleMission(ctx.runKey, "done", { text: "x" })).toBe(true);
    expect(settleMission(ctx.runKey, "error", { message: "y" })).toBe(false);
    expect(settleMission(ctx.runKey, "stop", {})).toBe(false);
    expect(count).toBe(1);
    endRun("projetMissionOnce", ctx.generation);
  });

  it("settleMission sans sink (run hors assistant) est un no-op", () => {
    expect(settleMission("projetSansSink", "done", { text: "x" })).toBe(false);
  });
});

describe("provesWorkOnDisk — preuve disque avant d'annoncer un échec (mission 310)", () => {
  const start = Date.parse("2026-10-01T14:32:17Z");
  const tsAt = (deltaMs) => Math.round((start + deltaMs) / 1000);

  it("commit tombé PENDANT la run → travail prouvé (mission pas en échec)", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: tsAt(4 * 60 * 1000), pending: 0 }, start, false)).toBe(true);
  });

  it("commit ANTÉRIEUR à la run → aucune preuve (échec honnête conservé)", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: tsAt(-60 * 60 * 1000), pending: 0 }, start, false)).toBe(false);
  });

  it("commit dans la même seconde que le démarrage (granularité git) → toléré", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: tsAt(0), pending: 0 }, start, false)).toBe(true);
  });

  it("mission d'ÉCRITURE avec des fichiers modifiés non committés → travail présent", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: 0, pending: 3 }, start, false)).toBe(true);
  });

  it("mission de LECTURE : des fichiers modifiés par ailleurs ne prouvent rien", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: 0, pending: 3 }, start, true)).toBe(false);
  });

  it("pas un dépôt git / sonde indisponible → aucune preuve (fail-safe)", () => {
    expect(provesWorkOnDisk({ is_repo: false }, start, false)).toBe(false);
    expect(provesWorkOnDisk(null, start, false)).toBe(false);
    expect(provesWorkOnDisk(undefined, start, false)).toBe(false);
  });

  it("dépôt sans aucun commit (head_ts 0) → aucune preuve", () => {
    expect(provesWorkOnDisk({ is_repo: true, head: "", head_ts: 0, pending: 0 }, start, false)).toBe(false);
  });
});

describe("clés de run — missions de LECTURE partagées (morceau 2)", () => {
  it("deux missions de LECTURE sur le MÊME projet ont des clés distinctes (aucun écrasement)", () => {
    const a = beginRun("projetRead2", { readOnly: true });
    const b = beginRun("projetRead2", { readOnly: true });
    expect(a.runKey).not.toBe(b.runKey);
    expect(a.runKey.startsWith("projetRead2#read:")).toBe(true);
    // Le PROJET RÉEL reste distinct de la clé de run (routage des événements).
    expect(a.project).toBe("projetRead2");
    expect(b.project).toBe("projetRead2");
    expect(a.readonly).toBe(true);
    expect(isRunInProgress("projetRead2", { nature: "read" })).toBe(false);
    endRun("projetRead2", a.generation);
    // La seconde lecture survit à la fin de la première.
    expect(getRunState("projetRead2")).toBe("running");
    endRun("projetRead2", b.generation);
    expect(getRunState("projetRead2")).toBe("idle");
  });

  it("une MODIFICATION est bloquée par une lecture sur ce projet, pas par un AUTRE projet", () => {
    beginRun("projetMix", { readOnly: true });
    expect(isRunInProgress("projetMix", { nature: "write" })).toBe(true);
    expect(isRunInProgress("projetAutre", { nature: "write" })).toBe(false);
    endRun("projetMix", undefined);
  });
});

describe("niveaux de réflexion — chaîne de priorité (T5)", () => {
  it("l'agent prime sur le réglage général", () => {
    expect(resolveWantedThinkingLevel({ thinking: { pi: "high", plh: "" } }, "pi", "low")).toBe("high");
  });
  it("repli croisé pi ↔ plh puis réglage général", () => {
    expect(resolveWantedThinkingLevel({ thinking: { pi: "", plh: "low" } }, "pi", "medium")).toBe("low");
    expect(resolveWantedThinkingLevel({ thinking: { pi: "", plh: "" } }, "pi", "medium")).toBe("medium");
  });
  it("aucun réglage → chaîne vide (le moteur garde son défaut)", () => {
    expect(resolveWantedThinkingLevel({ thinking: { pi: "", plh: "" } }, "pi", "")).toBe("");
    expect(resolveWantedThinkingLevel({}, "pi", undefined)).toBe("");
    expect(resolveWantedThinkingLevel(null, "pi", null)).toBe("");
  });
});

describe("applyAgentThinkingLevel — ramenage et fail-open (T5)", () => {
  afterEach(() => {
    invoke.mockImplementation(async (cmd) => (cmd === "file_exists" ? true : undefined));
  });

  it("aucun réglage → aucun appel RPC (zéro régression)", async () => {
    invoke.mockClear();
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "", plh: "" } }, "pi", "/p", "");
    expect(out).toEqual({ requested: "", level: null, available: [] });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("niveau supporté → posé tel quel", async () => {
    const calls = [];
    invoke.mockImplementation(async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "get_agent_process_thinking_levels") return ["off", "low", "medium", "high"];
      return undefined;
    });
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "high", plh: "" } }, "pi", "/p", "");
    expect(out.level).toBe("high");
    expect(calls.map((c) => c[0])).toEqual([
      "get_agent_process_thinking_levels",
      "set_agent_process_thinking_level",
    ]);
    expect(calls[1][1]).toEqual({ agentId: "codeur", level: "high", project: "/p" });
  });

  it("niveau au-dessus du maximum du modèle → ramené au palier inférieur", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_agent_process_thinking_levels" ? ["off", "low", "medium"] : undefined));
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "max", plh: "" } }, "pi", "/p");
    expect(out.level).toBe("medium");
    expect(out.requested).toBe("max");
  });

  it("modèle non raisonnant → « off » seul et mémorisation dans le contexte de run", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_agent_process_thinking_levels" ? ["off"] : undefined));
    const ctx = {};
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "high", plh: "" } }, "pi", "/p", "", ctx);
    expect(out.level).toBe("off");
    expect(ctx).toEqual({ thinkingLevel: "off", thinkingLevelRequested: "high" });
  });

  it("liste vide (modèle inconnu du moteur) → rien n'est envoyé", async () => {
    const calls = [];
    invoke.mockImplementation(async (cmd) => {
      calls.push(cmd);
      return [];
    });
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "high", plh: "" } }, "pi", "/p");
    expect(out.level).toBeNull();
    expect(calls).toEqual(["get_agent_process_thinking_levels"]);
  });

  it("backend sans la commande RPC → fail-open, aucune exception", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "get_agent_process_thinking_levels") throw new Error("unknown command");
      return undefined;
    });
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "high", plh: "" } }, "plh", "/p");
    expect(out.level).toBeNull();
    expect(out.error).toContain("unknown command");
  });

  it("refus du set_thinking_level → fail-open, niveau effectif non mémorisé", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "get_agent_process_thinking_levels") return ["off", "high"];
      if (cmd === "set_agent_process_thinking_level") throw new Error("refusé");
      return undefined;
    });
    const ctx = {};
    const out = await applyAgentThinkingLevel({ id: "codeur", thinking: { pi: "high", plh: "" } }, "pi", "/p", "", ctx);
    expect(out.level).toBeNull();
    expect(ctx.thinkingLevel).toBeUndefined();
  });
});

// ── Point de suivi 344 (volet b) — message compréhensible quand une run est
// interrompue. Le moteur renvoie un texte technique (« This operation was
// aborted ») que l'utilisateur ne peut pas interpréter : on attend une phrase
// simple en français qui dit ce qui s'est passé ET ce que devient le travail
// déjà fait (vérifié sur le disque).
describe("run interrompue — message compréhensible (point de suivi 344 b)", () => {
  const flushAsync = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const ev = (agentId, type, event = {}) => ({
    payload: { project: "projetAbandon", agent_id: agentId, event: { type, ...event } },
  });
  const abortMsg = (agentId) =>
    ev(agentId, "message", {
      message: { role: "assistant", stopReason: "error", errorMessage: "This operation was aborted", content: [] },
    });

  /** Prépare une run d'un agent actif et capture le rapport final de la mission. */
  const beginInterruptedRun = () => {
    const ctx = beginRun("projetAbandon");
    ctx.activeAgents.add("codeur");
    ctx.agentProject["codeur"] = "projetAbandon";
    const got = [];
    attachMissionSink(ctx.runKey, {
      onDone: (t) => got.push({ kind: "done", text: t }),
      onError: (e) => got.push({ kind: "error", text: e.message }),
    });
    return { ctx, got };
  };

  afterEach(() => {
    endRun("projetAbandon");
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "file_exists" ? true : undefined));
  });

  it("rien écrit sur le disque → phrase simple, sans le texte technique", async () => {
    const { got } = beginInterruptedRun();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(abortMsg("codeur"));
    handleAgentEvent(ev("codeur", "agent_end", { willRetry: false }));
    await flushAsync();
    expect(got).toHaveLength(1);
    const text = got[0].text;
    expect(text).not.toMatch(/aborted/i); // plus de texte technique
    expect(text).toContain("interrompue"); // ce qui s'est passé
    expect(text).toContain("Rien n'a été écrit sur le disque"); // devenir du travail
  });

  it("du travail déjà écrit sur le disque → conservé, dit explicitement", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "git_status_project" ? { is_repo: true, head_ts: 0, pending: 2 } : cmd === "file_exists" ? true : undefined
    );
    const { got } = beginInterruptedRun();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(abortMsg("codeur"));
    handleAgentEvent(ev("codeur", "agent_end", { willRetry: false }));
    await flushAsync();
    expect(got).toHaveLength(1);
    const text = got[0].text;
    expect(text).not.toMatch(/aborted/i);
    expect(text).toContain("a été conservé"); // le travail déjà écrit est gardé
  });
});

// ── Point de suivi 344 (volet a) — AUCUNE PERTE DU TRAVAIL ÉCRIT à l'arrêt
// d'une run. Le travail d'un agent est écrit sur le disque par SES PROPRES
// outils (write/edit/bash, exécutés par le processus `pi`), jamais par Pilot :
// Pilot ne met rien en tampon et ne rétablit rien. Le seul primitif de retour en
// arrière du projet est `git_restore_snapshot` (A1), appelé EXCLUSIVEMENT par le
// bouton manuel « annuler la tâche » (agent-pi.js). Ces tests verrouillent cet
// invariant pour TOUS les chemins d'arrêt d'une run : abort du moteur, erreur du
// modèle, arrêt manuel, fin brutale du processus (watchdog : voir le test
// structurel ci-dessous qui couvre aussi super-agent.js, où vit le watchdog de
// 5 min). Échec du test = un chemin d'arrêt s'est mis à détruire ou à rétablir
// du travail écrit.
describe("aucune perte du travail écrit à l'arrêt d'une run (point de suivi 344 a)", () => {
  const readSrc = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

  // Commandes qui pourraient DÉTRUIRE ou RÉTABLIR le travail écrit d'un agent.
  const DESTRUCTIVE_INVOKES = ["git_restore_snapshot", "git_checkout", "git_reset", "delete_file_or_dir"];

  // Isolation du journal d'appels : chaque scénario ne juge QUE ses propres
  // commandes (sinon une trace laissée par un scénario précédent le ferait
  // échouer à tort).
  afterEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "file_exists" ? true : undefined));
  });

  it("le seul retour en arrière du projet est l'annulation MANUELLE (A1)", () => {
    const hits = [];
    for (const f of readdirSync(new URL("./", import.meta.url))) {
      if (!f.endsWith(".js") || f.endsWith(".test.js")) continue;
      const n = (readSrc(f).match(/git_restore_snapshot/g) || []).length;
      if (n > 0) hits.push([f, n]);
    }
    // Un SEUL site : le bouton ↩️ « annuler la tâche » de l'orchestration.
    expect(hits).toEqual([["agent-pi.js", 1]]);
  });

  it("les chemins d'arrêt (agents-bus + super-agent : watchdog compris) n'ont aucun appel destructeur", () => {
    for (const f of ["agents-bus.js", "super-agent.js"]) {
      const src = readSrc(f);
      for (const cmd of DESTRUCTIVE_INVOKES) {
        expect(src, `${f} ne doit pas invoquer ${cmd}`).not.toContain(cmd);
      }
      expect(src, `${f} ne doit pas remettre les fichiers à zéro`).not.toMatch(/reset\s+--hard|git\s+clean\s+-/);
    }
  });

  // ── Preuve comportementale, chemin par chemin ──
  const flushAsync = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const ev = (project, agentId, type, event = {}) => ({
    payload: { project, agent_id: agentId, event: { type, ...event } },
  });
  const modelError = (project, agentId, message) =>
    ev(project, agentId, "message", { message: { role: "assistant", stopReason: "error", errorMessage: message, content: [] } });

  /** Run d'un agent actif, avec un rapport de mission capturé. */
  const beginRunOfAgent = (project) => {
    const ctx = beginRun(project);
    ctx.activeAgents.add("codeur");
    ctx.agentProject["codeur"] = project;
    const got = [];
    attachMissionSink(ctx.runKey, {
      onDone: (t) => got.push({ kind: "done", text: t }),
      onError: (e) => got.push({ kind: "error", text: e.message }),
    });
    return { ctx, got };
  };

  /**
   * Appels Tauri destructeurs pour le TRAVAIL DU PROJET restés dans le journal.
   * `reservations.json` est exclu : c'est un fichier de comptabilité interne de
   * Pilot (verrous de fichiers), pas le travail de l'agent.
   * @returns {Array<{cmd: string, path: string}>}
   */
  const destructiveCalls = () =>
    vi.mocked(invoke).mock.calls
      .map(([cmd, args]) => ({ cmd: String(cmd), path: String((args && args.path) || "") }))
      .filter(({ cmd, path }) => DESTRUCTIVE_INVOKES.includes(cmd) && !path.endsWith("reservations.json"));

  const scenarios = [
    {
      name: "abort du moteur",
      project: "projet344Abort",
      send: (P) => [
        ev(P, "codeur", "agent_start"),
        modelError(P, "codeur", "This operation was aborted"),
        ev(P, "codeur", "agent_end", { willRetry: false }),
      ],
    },
    {
      name: "erreur du modèle (non abort)",
      project: "projet344Erreur",
      send: (P) => [
        ev(P, "codeur", "agent_start"),
        modelError(P, "codeur", "Connection error."),
        ev(P, "codeur", "agent_end", { willRetry: false }),
      ],
    },
    {
      name: "fin brutale du processus (process_exit)",
      project: "projet344Exit",
      send: (P) => [
        ev(P, "codeur", "agent_start"),
        ev(P, "codeur", "process_exit", { reason: "processus arrêté" }),
      ],
    },
    {
      name: "arrêt manuel (stopAgentsRun)",
      project: "projet344Stop",
      send: (P) => [ev(P, "codeur", "agent_start")],
      after: async () => { await stopAgentsRun({}); },
    },
  ];

  for (const sc of scenarios) {
    it(`${sc.name} : la run s'arrête, les fichiers déjà écrits restent en place`, async () => {
      // Le projet contient déjà du travail écrit (2 fichiers modifiés).
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "git_status_project") return { is_repo: true, head_ts: 0, pending: 2 };
        if (cmd === "file_exists") return true;
        return undefined;
      });
      const { got } = beginRunOfAgent(sc.project);
      for (const e of sc.send(sc.project)) handleAgentEvent(e);
      if (sc.after) await sc.after();
      await flushAsync();

      // L'arrêt est bien allé au bout (rapport de mission livré ou run fermée)…
      expect(getRunState(sc.project).state).not.toBe("running");
      // …et AUCUNE commande n'a rétabli ni supprimé un fichier du projet.
      expect(destructiveCalls()).toEqual([]);

      // Le travail écrit survit aussi à la vérification disque : la sonde est une
      // LECTURE (`git_status_project`), jamais une écriture.
      if (sc.name === "abort du moteur") {
        expect(got).toHaveLength(1);
        expect(got[0].text).toContain("a été conservé");
      }
      endRun(sc.project);
    });
  }
});
