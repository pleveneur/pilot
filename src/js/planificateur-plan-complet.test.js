// Tests de non-régression — MISSION 384 : LE PLANIFICATEUR (plan-maker) TOURNE
// VRAIMENT ET LIVRE UN PLAN COMPLET.
//
// Symptôme d'origine : une demande adressée AU SEUL agent planificateur
// (`run_agents(["plan-maker"], …)`) « démarrait puis s'arrêtait au bout de
// quelques secondes » — sans plan. Deux défauts du bus d'agents rendaient cette
// fin silencieuse POSSIBLE (et invisible) :
//
//  (a) `provesWorkOnDisk()` acceptait un COMMIT tombé pendant la run comme preuve
//      de travail, MÊME pour une mission de LECTURE. Or le plan-maker n'écrit
//      jamais : un commit venu d'ailleurs (vous, un autre outil) faisait passer
//      son tour SANS livrable pour un succès (« travail présent sur le disque »).
//  (b) une part de groupe parallèle sans texte était enregistrée `done` avec un
//      texte vide → agrégée en « (aucun texte) » ET la mission était livrée à
//      l'Assistant comme RÉUSSIE. L'Assistant croyait le plan produit.
//
// Correctif mesuré ici :
//  - une mission de LECTURE ne prouve JAMAIS son travail par le disque ;
//  - une part sans livrable ET sans preuve disque est un ÉCHEC explicite nommant
//    l'agent (plus de « done » vide) ;
//  - une mission dont AUCUNE part n'a livré est livrée en ÉCHEC (jamais en
//    succès) : `parallelMissionFailed`.
//
// ⚠️ Ces tests ÉCHOUENT si l'on revient à un « faux succès » de session vide.
import { describe, it, expect, vi, afterEach } from "vitest";

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
  provesWorkOnDisk,
  parallelMissionFailed,
} from "./agents-bus.js";
import { parsePlanFiles } from "./reservations.js";

const PLAN = JSON.stringify({
  plan: [
    {
      id: 1,
      title: "Corriger le calcul du verrou",
      description: "Isoler la libération du verrou de run.",
      files: ["src/js/agents-bus.js"],
      estimated_tokens: 1200,
      suggested_constraints: ["ne pas toucher super-agent.js"],
      depends_on: [],
    },
    {
      id: 2,
      title: "Couvrir par un test",
      description: "Ajouter un test de non-régression.",
      files: ["src/js/planificateur-plan-complet.test.js"],
      estimated_tokens: 800,
      suggested_constraints: [],
      depends_on: [1],
    },
  ],
});

/** Événement RPC au format attendu par `handleAgentEvent`. */
function ev(project, agentId, event) {
  return { payload: { project, agent_id: agentId, event } };
}

/** Laisse tourner les micro-tâches (I/O simulées, agrégation, livraison). */
async function flushAsync(n = 14) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/** Registre minimal : le plan-maker est un agent de LECTURE (readonly). */
const REGISTRY = {
  agents: [
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
 * Lance une mission adressée AU SEUL plan-maker et retourne de quoi l'observer.
 * @param {object} opts
 * @param {string} opts.project - projet cible
 * @param {object|Error} [opts.gitStatus] - état Git simulé pendant la run
 * @returns {Promise<{sink: object, runKey: string, spawned: string[]}>}
 */
async function launchPlanMission({ project, gitStatus = { is_repo: true, head_ts: 0, pending: 0 } }) {
  const spawned = [];
  vi.mocked(invoke).mockImplementation(async (cmd, args = {}) => {
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return REGISTRY;
    if (cmd === "list_agent_sessions") return { sessions: [] };
    if (cmd === "start_agent_process") spawned.push(args.agentId);
    if (cmd === "git_status_project") {
      if (gitStatus instanceof Error) throw gitStatus;
      return gitStatus;
    }
    if (cmd === "file_exists") return true;
    return undefined;
  });
  await initAgentsBus({});

  const sink = { done: vi.fn(), error: vi.fn() };
  let runKey = "";
  await startParallelRun(
    [{ agentId: "plan-maker", project, brief: "Planifie la correction du verrou de run." }],
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
  return { sink, runKey, spawned };
}

afterEach(() => {
  globalThis._pilotProjectPath = "";
  // Remet le bus à zéro : aucune run (y compris de LECTURE) ne doit survivre au
  // test (sinon le verrou d'un test bloquerait le suivant).
  destroyAgentsBus();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

// ── 1. La mission de LECTURE ne prouve jamais son travail par le disque ─────
describe("mission de LECTURE : un commit tombé pendant la run ne prouve RIEN", () => {
  const start = Date.parse("2026-10-01T14:32:17Z");
  const tsAt = (deltaMs) => Math.round((start + deltaMs) / 1000);

  it("commit pendant la run + mission de lecture → aucune preuve (jamais un faux succès)", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: tsAt(4 * 60 * 1000), pending: 0 }, start, true)).toBe(false);
    // La même preuve reste valable pour une mission d'ÉCRITURE (comportement
    // historique de la mission 310, lui, conservé).
    expect(provesWorkOnDisk({ is_repo: true, head_ts: tsAt(4 * 60 * 1000), pending: 0 }, start, false)).toBe(true);
  });

  it("fichiers modifiés par ailleurs + mission de lecture → aucune preuve", () => {
    expect(provesWorkOnDisk({ is_repo: true, head_ts: 0, pending: 5 }, start, true)).toBe(false);
  });
});

// ── 2. Statut de la MISSION déduit des parts ───────────────────────────────
describe("parallelMissionFailed — une mission sans aucun livrable est un échec", () => {
  it("toutes les parts en échec → mission en échec", () => {
    expect(parallelMissionFailed({ "plan-maker": { status: "error", text: "x" } })).toBe(true);
  });

  it("au moins une part exploitable → mission non échouée", () => {
    expect(parallelMissionFailed({ "plan-maker": { status: "done", text: "plan" } })).toBe(false);
    expect(
      parallelMissionFailed({ "plan-maker": { status: "error", text: "" }, codeur: { status: "done", text: "fait" } }),
    ).toBe(false);
  });

  it("aucun résultat → pas d'échec prononcé (fail-open)", () => {
    expect(parallelMissionFailed({})).toBe(false);
    expect(parallelMissionFailed(null)).toBe(false);
  });
});

// ── 3. La mission adressée au SEUL plan-maker livre un PLAN COMPLET ────────
describe("mission adressée au seul plan-maker : elle tourne et livre un plan complet", () => {
  const project = "preuve-384-plan-maker";

  it("le plan-maker est le SEUL agent lancé, la run est une LECTURE, et le plan est complet", async () => {
    const { sink, runKey, spawned } = await launchPlanMission({ project });

    // (a) Aucun autre agent que celui DEMANDÉ n'a démarré (mission 381 tenue).
    expect(spawned, "un agent autre que le plan-maker a été démarré").toEqual(["plan-maker"]);
    // (b) Mission de LECTURE : clé de run propre (`projet#read:N`) — elle ne
    //     prend pas le créneau d'écriture du projet.
    expect(runKey.startsWith(`${project}#read:`), `clé de run inattendue : ${runKey}`).toBe(true);

    // (c) L'agent produit son plan (streaming), puis termine son tour.
    handleAgentEvent(ev(project, "plan-maker", { type: "agent_start" }));
    handleAgentEvent(
      ev(project, "plan-maker", {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: PLAN },
      }),
    );
    handleAgentEvent(ev(project, "plan-maker", { type: "agent_end", willRetry: false }));
    await flushAsync();

    // (d) La mission est livrée en SUCCÈS, avec le plan COMPLET.
    expect(sink.error, "la mission ne doit pas échouer").not.toHaveBeenCalled();
    expect(sink.done, "le rapport de la mission doit être livré").toHaveBeenCalledTimes(1);
    const report = sink.done.mock.calls[0][0];
    const json = JSON.parse(report.slice(report.indexOf("{"), report.lastIndexOf("}") + 1));
    expect(Array.isArray(json.plan)).toBe(true);
    expect(json.plan.length, "un plan doit contenir au moins une tâche").toBeGreaterThanOrEqual(1);
    for (const task of json.plan) {
      expect(task.title, "chaque tâche du plan doit être nommée").toBeTruthy();
      expect(Array.isArray(task.files), "chaque tâche doit citer ses fichiers").toBe(true);
      expect(task.files.length).toBeGreaterThan(0);
    }
    // (e) Les fichiers du plan sont exploitables (réservations T6).
    expect(parsePlanFiles(report)).toEqual(["src/js/agents-bus.js", "src/js/planificateur-plan-complet.test.js"]);

    // (f) Le verrou du projet est bien libéré : plus aucun verrou fantôme qui
    //     ferait « s'arrêter » les missions suivantes.
    expect(isRunInProgress(project), "le projet doit être libéré après la mission").toBe(false);
  });

  it("la session NE se termine PAS en quelques secondes : tant qu'aucun livrable n'est reçu, elle reste ouverte", async () => {
    const { sink } = await launchPlanMission({ project });

    // L'agent démarre… et rien d'autre n'arrive (modèle lent, lecture de
    // fichiers en cours). AVANT le correctif, un tour vide ou une preuve disque
    // étrangère pouvaient clore la run ; ici la run doit RESTER ouverte.
    handleAgentEvent(ev(project, "plan-maker", { type: "agent_start" }));
    await flushAsync();

    expect(sink.done, "aucune fin de mission ne doit être annoncée sans livrable").not.toHaveBeenCalled();
    expect(sink.error, "aucun échec ne doit être annoncé sans livrable").not.toHaveBeenCalled();
    expect(isRunInProgress(project), "la session doit rester ouverte tant que le plan n'est pas livré").toBe(true);
  });

  it("une session qui se termine SANS livrable est un ÉCHEC explicite (jamais un faux succès)", async () => {
    // Commit tombé pendant la run (fait par ailleurs) : il ne doit PAS servir de
    // preuve pour une mission de lecture.
    const gitStatus = { is_repo: true, head_ts: Math.round(Date.now() / 1000), pending: 2 };
    const { sink, spawned } = await launchPlanMission({ project, gitStatus });
    expect(spawned).toEqual(["plan-maker"]);

    handleAgentEvent(ev(project, "plan-maker", { type: "agent_start" }));
    // Fin de tour SANS aucun texte : le plan n'a pas été produit.
    handleAgentEvent(ev(project, "plan-maker", { type: "agent_end", willRetry: false }));
    await flushAsync();

    expect(sink.done, "une session sans livrable ne doit JAMAIS être un succès").not.toHaveBeenCalled();
    expect(sink.error, "la mission doit être rapportée en échec").toHaveBeenCalledTimes(1);
    const message = String(sink.error.mock.calls[0][0] && sink.error.mock.calls[0][0].message);
    expect(message, "l'échec doit nommer l'agent").toContain("plan-maker");
    expect(message, "l'échec doit dire que la demande n'a pas été exécutée").toContain("PAS été exécutée");
    // Le projet reste libre : l'Assistant peut relancer la planification.
    expect(isRunInProgress(project), "le projet doit être libéré après l'échec").toBe(false);
  });
});
