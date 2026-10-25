// BUG « une tâche mise en file d'attente derrière une tâche en cours exécute la
// tâche PRÉCÉDENTE » — le CONTEXTE DE SUIVI d'une mission doit décrire SA tâche.
//
// Cause (vérifiée par lecture, pas supposée) : le bloc « Contexte de suivi
// (assistant) » était construit et FIGÉ au moment où la demande ARRIVAIT
// (`super-agent.js`, `attachDelegationContext` appelé dans le handler de
// `run_agents`, puis transporté dans les affectations). Une demande mise en file
// emportait donc un contexte qui décrivait la mission qui tournait à cet
// instant — c'est-à-dire la mission PRÉCÉDENTE. Comme ce bloc est PREFIXÉ au
// brief (donc lu en premier par l'agent), l'agent commençait par exécuter
// l'étape précédente alors que son objectif, plus bas dans le prompt, était bien
// le sien.
//
// Preuves apportées ici (elles ÉCHOUENT si le défaut revient) :
//   a. DÉFAUT REPRODUIT : un contexte lu à l'ARRIVÉE décrit la mission
//      précédente et se retrouve EN TÊTE du brief réellement porté.
//   b. CORRECTION : relu AU LANCEMENT (`refreshAssignmentsBrief`, production),
//      le contexte décrit la tâche de la mission, jamais celle qui vient de
//      finir.
//   c. De bout en bout par la FILE DE PRODUCTION : une mission mise en file,
//      rejouée par `replayQueuedMissionForProject`, part avec le contexte de SA
//      tâche — pas celui de la mission qui occupait le projet à son arrivée.
//   d. Câblage : l'arrivée ne fige plus aucun contexte (les affectations portent
//      le brief de BASE) et la relecture est dans le CHEMIN DE LANCEMENT
//      (`launchRun`, démarrage de `run_assistant_agents`) et dans le rejeu de la
//      file de délégations (`flushDelegationQueue`).
//   e. Fail-open : une lecture de suivi impossible laisse le brief intact (aucun
//      contexte inventé, aucune exception).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `file-attente-fifo-admission.test.js` (aucun DOM, aucun accès
// Tauri réel) : `super-agent.js` est un module d'UI évalué à l'import.
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
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn(async () => "/app-data") }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  allocateMissionIdentity,
  enqueueMissionForProject,
  getProjectMissionQueue,
  refreshAssignmentsBrief,
  replayQueuedMissionForProject,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";

const PROJECT = "G:\\IA_PL\\pilot";
const source = (rel) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const superAgentSrc = source("src/js/super-agent.js");

/** Marqueurs distincts : « ce que le suivi raconte » vs « ce que la mission demande ». */
const MISSION_A = "livrer les routes HTTP du portage (mission A)";
const MISSION_B = "brancher le bureau sur les routes (mission B)";
const TASK_B = "brancher l'application de bureau sur les routes";
const BASE_BRIEF = "## Objectif\nBrancher l'application de bureau sur les routes.\n\n## Consignes\n- ...";

/** Suivi et mémoire de session mutables : ils décrivent « où en est le chantier ». */
let trackingState = null;
let memoryState = null;

/**
 * Fixe le suivi de l'assistant : le projet suivi + les « chantiers en cours »
 * (c'est cette ligne que l'agent lit en premier dans le brief).
 * @param {string[]} workInProgress - chantiers en cours au moment T
 */
function setTracking(workInProgress) {
  trackingState = {
    clients: [
      {
        name: "IA_PL",
        decisions_recentes: [],
        sessions_recentes: [],
        projects: [{ path: PROJECT, name: "pilot", tasks_en_cours: 22, tasks_terminees: 258 }],
      },
    ],
  };
  memoryState = JSON.stringify({
    current_topic: "",
    active_project: "pilot",
    work_in_progress: workInProgress,
    notes: "",
  });
}

/** Laisse tourner une macrotâche (résolution des `then` d'un lancement). */
const flush = () => new Promise((res) => setTimeout(res, 0));

beforeEach(() => {
  __resetMissionIdsForTest();
  __resetSuperAgentQueueForTest();
  vi.mocked(invoke).mockReset();
  setTracking([MISSION_A]);
  // Seules les DEUX lectures de suivi sont servies : tout le reste est neutre.
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_super_agent_tracking") return trackingState;
    if (cmd === "super_agent_load_session_memory") return memoryState;
    return undefined;
  });
});

afterEach(() => {
  __resetSuperAgentQueueForTest();
});

// ── a. Le défaut, reproduit avec le code de PRODUCTION ─────────────────────
describe("a. défaut reproduit — un contexte lu à l'ARRIVÉE décrit la mission précédente", () => {
  it("le bloc figé à l'arrivée annonce la mission A (celle qui tourne) et part EN TÊTE", async () => {
    // À l'instant où la demande B ARRIVE, la mission A est le travail en cours.
    setTracking([MISSION_A]);
    const assignments = [{ agentId: "codeur", brief: BASE_BRIEF, project: PROJECT }];

    // Lecture du contexte À CE MOMENT-LÀ (c'est ce que faisait l'arrivée).
    await refreshAssignmentsBrief(assignments, BASE_BRIEF, PROJECT, TASK_B);
    const figéALArrivée = assignments[0].brief;

    // Le défaut est bien réel : le prompt de la mission B commence par décrire A.
    expect(figéALArrivée.startsWith("## Contexte de suivi (assistant)")).toBe(true);
    expect(figéALArrivée).toContain(MISSION_A);
    // Et il ne contient AUCUNE information de la mission B : rien n'a changé
    // dans le suivi à ce stade, le bloc est un instantané.
    expect(figéALArrivée).not.toContain(MISSION_B);
  });
});

// ── b. Correction : le contexte est relu AU LANCEMENT ──────────────────────
describe("b. correction — au LANCEMENT, le contexte décrit SA propre tâche", () => {
  it("le suivi a changé entre l'arrivée et le lancement : c'est le nouveau qui part", async () => {
    const assignments = [{ agentId: "codeur", brief: BASE_BRIEF, project: PROJECT }];

    // ARRIVÉE : la mission A occupe le projet (contexte A). On ne le fige plus.
    setTracking([MISSION_A]);
    const lectureALArrivée = await refreshAssignmentsBrief([], BASE_BRIEF, PROJECT, TASK_B);
    expect(lectureALArrivée).toContain(MISSION_A);

    // LANCEMENT (la mission sort de la file, A est terminée) : relecture.
    setTracking([MISSION_B]);
    const briefAuLancement = await refreshAssignmentsBrief(assignments, BASE_BRIEF, PROJECT, TASK_B);

    expect(briefAuLancement, "le brief envoyé doit être celui des affectations").toBe(assignments[0].brief);
    expect(briefAuLancement).toContain(MISSION_B);
    expect(
      briefAuLancement,
      "le contexte de la mission PRÉCÉDENTE ne doit jamais être envoyé à l'agent"
    ).not.toContain(MISSION_A);
    // L'objectif de la demande reste présent, à sa place (le bloc est un préfixe).
    expect(briefAuLancement).toContain("Brancher l'application de bureau sur les routes.");
  });

  it("aucune information de suivi : le brief part inchangé (aucun contexte inventé)", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const assignments = [{ agentId: "codeur", brief: BASE_BRIEF }];
    const brief = await refreshAssignmentsBrief(assignments, BASE_BRIEF, PROJECT, TASK_B);
    expect(brief).toBe(BASE_BRIEF);
    expect(assignments[0].brief).toBe(BASE_BRIEF);
  });

  it("fail-open : une lecture impossible laisse le brief intact (jamais d'exception)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("suivi indisponible"));
    const assignments = [{ agentId: "codeur", brief: BASE_BRIEF }];
    const brief = await refreshAssignmentsBrief(assignments, BASE_BRIEF, PROJECT, TASK_B);
    expect(brief).toBe(BASE_BRIEF);
    expect(assignments[0].brief).toBe(BASE_BRIEF);
  });
});

// ── c. De bout en bout par la FILE DE PRODUCTION ───────────────────────────
describe("c. file d'attente — la mission rejouée part avec le contexte de SA tâche", () => {
  it("mise en file derrière une tâche en cours, puis rejeu : le contexte est celui du lancement", async () => {
    const briefsEnvoyés = [];
    // La mission B est créée pendant que A tourne : à l'ARRIVÉE, le suivi décrit A.
    setTracking([MISSION_A]);
    const assignments = [{ agentId: "codeur", brief: BASE_BRIEF, project: PROJECT }];

    // Mise en file par le CHEMIN DE PRODUCTION (aucune fixture à la main).
    enqueueMissionForProject(
      PROJECT,
      // Lancement : exactement le geste du chemin de lancement de production
      // (`attachLaunchContext` → `refreshAssignmentsBrief`), puis lecture du
      // brief réellement porté par les affectations (ce que lit le bus).
      async () => {
        await refreshAssignmentsBrief(assignments, BASE_BRIEF, PROJECT, TASK_B);
        briefsEnvoyés.push(assignments.map((a) => a.brief).join("\n"));
      },
      TASK_B,
      allocateMissionIdentity(["codeur"])
    );
    expect(getProjectMissionQueue(PROJECT).map((e) => e.label)).toEqual([TASK_B]);

    // Le projet se libère : la mission A est terminée, le suivi avance.
    setTracking([MISSION_B]);
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({
      replayed: true,
      reason: "launched",
    });
    await flush();

    expect(briefsEnvoyés).toHaveLength(1);
    expect(briefsEnvoyés[0]).toContain(MISSION_B);
    expect(
      briefsEnvoyés[0],
      "défaut revenu : la mission rejouée emporte le contexte de la mission précédente"
    ).not.toContain(MISSION_A);
    expect(getProjectMissionQueue(PROJECT)).toEqual([]);
  });
});

// ── d. Câblage : où la relecture est appelée ───────────────────────────────
describe("d. câblage — la relecture est dans le LANCEMENT, plus à l'arrivée", () => {
  it("l'arrivée ne fige plus de contexte : les affectations portent le brief de BASE", () => {
    // Le brief n'est plus construit par `attachDelegationContext` à l'arrivée…
    expect(
      superAgentSrc,
      "le contexte est de nouveau figé à l'arrivée de la demande"
    ).not.toContain("brief: await attachDelegationContext(messagesEl, applyAssistantBriefEnvelope(task, {");
    // …les deux handlers de mission portent le brief de base…
    expect((superAgentSrc.match(/brief: baseBrief,/g) || []).length).toBe(2);
    expect((superAgentSrc.match(/const baseBrief = applyAssistantBriefEnvelope\(task, \{/g) || []).length).toBe(2);
    // …et le contexte est relu par le module de production, au lancement.
    expect((superAgentSrc.match(/const brief = await refreshAssignmentsBrief\(assignments, baseBrief,/g) || []).length).toBe(2);
  });

  it("run_agents : relecture DANS `launchRun` (le chemin par lequel passe aussi le rejeu)", () => {
    const start = superAgentSrc.indexOf("const launchRun = () =>");
    const end = superAgentSrc.indexOf("const launchOrQueue = async (launchOpts = {}) => {", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const launchRun = superAgentSrc.slice(start, end);
    expect(launchRun).toContain("attachLaunchContext().then(() => new Promise((resolve) => {");
    // Le contexte est lu AVANT le démarrage de la run (aucun agent ne peut partir
    // avec un brief d'une autre mission).
    const refreshIdx = launchRun.indexOf("attachLaunchContext()");
    const runIdx = launchRun.indexOf("runAgentsForAssistantAsync(");
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(refreshIdx);
  });

  it("run_assistant_agents : relecture avant le démarrage de la run d'assistant", () => {
    const start = superAgentSrc.indexOf('if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {');
    const end = superAgentSrc.indexOf('if (title.startsWith(SESSIONS_SENTINEL)) {', start);
    const win = superAgentSrc.slice(start, end);
    const refreshIdx = win.indexOf("await attachLaunchContext();");
    const runIdx = win.indexOf("runAgentsForAssistantAsync(");
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(refreshIdx);
  });

  it("file de délégations : le rejeu relit le contexte à la transmission", () => {
    const start = superAgentSrc.indexOf("function flushDelegationQueue(projectPath) {");
    const end = superAgentSrc.indexOf("// ── Agent invisible : suivi en arrière-plan (évolution 64) ──", start);
    const win = superAgentSrc.slice(start, end);
    // Le brief de BASE voyage avec l'entrée de file…
    expect(superAgentSrc.replace(/\s+/g, " ")).toContain("ds.queue.push({ request, baseRequest, task: delegationTask,");
    // …et le rejeu le relit au moment de la transmission (jamais celui de l'arrivée).
    expect(win).toContain("next.baseRequest != null");
    expect(win).toContain("refreshAssignmentsBrief([], next.baseRequest, next.projectPath || null");
  });

  it("la correction ne touche ni l'ordre de la file, ni les rangs, ni l'exclusivité", () => {
    // Les garanties existantes restent en place, mot pour mot.
    expect(superAgentSrc).toContain("result = entry.launch({ dequeue: true });");
    expect(superAgentSrc).toContain("if (launchOpts && launchOpts.dequeue) restoreQueuedMissionRank(target, queued.entry);");
    expect((superAgentSrc.match(/const admission = decideMissionAdmission\(target, \{/g) || []).length).toBe(3);
    expect(superAgentSrc).toContain("queue.push({ launch });");
  });
});
