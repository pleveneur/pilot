// RÈGLE 4 (audit indépendant « verrous règles 1-4-2 ») — IDENTITÉ de la demande
// rejouée depuis la file d'attente : deux demandes A puis B en file, quand une
// demande redémarre c'est BIEN SON texte qui part — jamais celui de la
// précédente.
//
// Deux mécanismes distincts portent cette identité, tous deux verrouillés ici :
//   1. MISSIONS DE L'ASSISTANT (`super-agent.js`) : chaque entrée de file reçoit
//      son libellé (`runAgentsQueueByProject[target].at(-1).label = task`) et son
//      lanceur (`{ launch: launchMission }` / `{ launch: () => startRun() }`) est
//      une fermeture déclarée DANS la branche, donc liée au texte de SA demande.
//      Le rejeu (`replayQueuedMissionForProject`) sort la TÊTE de file : A part
//      d'abord, puis B — jamais l'inverse, jamais deux fois la même.
//   2. COMMANDES MANUELLES (`agent-pi.js`) : la fermeture de file réinjecte
//      `inputEl.value = text`, où `text` est le PARAMÈTRE de la commande refusée
//      (`queueRefusedCommand = (text) => …`) — donc le texte de SA demande.
//
// Échec attendu si un rejeu réutilise la demande PRÉCÉDENTE : l'ordre observé
// devient A→A (ou B→A) et/ou le libellé restant en file n'est plus celui de B.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` est un module d'UI : `window` minimal AVANT l'import
// (vi.hoisted s'exécute avant les imports), comme les autres tests du module.
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

import {
  replayQueuedMissionForProject,
  getProjectMissionQueue,
  runAgentsQueueByProject,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";

// Lecture du source en neutralisant les fins de ligne (worktree CRLF en CI
// Windows : cf. AGENTS.md § Fins de ligne).
const source = (rel) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SRC = source("src/js/super-agent.js");
const AGENT_PI = source("src/js/agent-pi.js");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const PUSH_START = "runAgentsQueueByProject[target].push({ launch:";
const PUSH_END = "runAgentsQueueByProject[target].at(-1).label = task;";

/**
 * Extrait de la production les snippets « mise en file d'une mission » tels
 * qu'ils sont écrits (un par appelant : run_agents ×2, run_assistant_agents ×1).
 * @returns {string[]}
 */
function pushSnippets(src) {
  const out = [];
  let idx = src.indexOf(PUSH_START);
  while (idx >= 0) {
    const lineStart = src.lastIndexOf("\n", idx) + 1;
    const endIdx = src.indexOf(PUSH_END, idx);
    if (endIdx < 0) break;
    const lineEnd = src.indexOf("\n", endIdx);
    out.push(src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd));
    idx = src.indexOf(PUSH_START, lineEnd < 0 ? src.length : lineEnd);
  }
  return out;
}

/**
 * Exécute un snippet de mise en file EXTRAIT de la production, avec la file
 * réelle passée en paramètre. Le lanceur est celui de la demande courante : il
 * enregistre le TEXTE que la production lui a associé.
 *
 * La ligne d'amorçage du tableau (`if (!runAgentsQueueByProject[target]) …`) est
 * celle des trois branches appelantes, juste avant le push : on la reproduit pour
 * que le snippet s'exécute dans le même contexte.
 */
async function runPushSnippet(snippet, queueStore, target, task, launched) {
  const launchMission = async () => {
    launched.push(task);
    return { started: true };
  };
  const startRun = async () => {
    launched.push(task);
    return { started: true };
  };
  const fn = new AsyncFunction(
    "runAgentsQueueByProject",
    "target",
    "task",
    "launchMission",
    "startRun",
    `if (!runAgentsQueueByProject[target]) runAgentsQueueByProject[target] = [];\n${snippet}`,
  );
  await fn(queueStore, target, task, launchMission, startRun);
}

describe("règle 4a — missions de l'assistant : chaque entrée de file porte SA demande", () => {
  const TARGET = "G:/projet-file";
  const A = "Demande A : corriger le parser";
  const B = "Demande B : ajouter les tests du parser";

  it("les 3 sites de mise en file posent le libellé de LEUR demande", () => {
    // Un site oublié = une mission sans libellé dans l'interface (et, si le
    // libellé vient d'une variable partagée, le libellé d'une AUTRE demande).
    const snippets = pushSnippets(SRC);
    expect(snippets, "un site de mise en file ne pose plus le libellé de sa demande").toHaveLength(3);
    for (const snippet of snippets) {
      // La fermeture ET le libellé utilisent la variable LOCALE `task` de la
      // branche (celle de la demande courante), jamais une autre source.
      expect(snippet).toContain("at(-1).label = task;");
      expect(snippet).toMatch(/push\(\{ launch: (launchMission|\(\) => startRun\(\)) \}\);/);
    }
  });

  it("A puis B en file : l'ordre et les libellés sont ceux des demandes (jamais A pour B)", async () => {
    for (const snippet of pushSnippets(SRC)) {
      const queueStore = {};
      const launched = [];
      await runPushSnippet(snippet, queueStore, TARGET, A, launched);
      await runPushSnippet(snippet, queueStore, TARGET, B, launched);

      const queue = queueStore[TARGET];
      expect(queue.map((e) => e.label)).toEqual([A, B]);

      // Rejeu de la tête : c'est A qui part, et il reste B en file — avec le
      // libellé de B.
      const first = queue.shift();
      await first.launch();
      expect(launched).toEqual([A]);
      expect(queueStore[TARGET].map((e) => e.label)).toEqual([B]);

      // Rejeu suivant : c'est B qui part (jamais A une deuxième fois).
      const second = queueStore[TARGET].shift();
      await second.launch();
      expect(launched).toEqual([A, B]);
    }
  });

  it("rejeu RÉEL (`replayQueuedMissionForProject`) : la tête de file part, B garde son libellé", async () => {
    __resetSuperAgentQueueForTest();
    const queueStore = runAgentsQueueByProject;
    const launched = [];
    const snippet = pushSnippets(SRC)[0];
    await runPushSnippet(snippet, queueStore, TARGET, A, launched);
    await runPushSnippet(snippet, queueStore, TARGET, B, launched);

    // Mission 1 en file → libellés visibles par l'interface, dans l'ordre.
    expect(getProjectMissionQueue(TARGET).map((e) => e.label)).toEqual([A, B]);

    // 1re passe : A part (admission libre).
    const r1 = await replayQueuedMissionForProject(TARGET, { isAdmissionFree: async () => true });
    expect(r1).toEqual({ replayed: true, reason: "launched" });
    expect(launched).toEqual([A]);
    // Il reste B — et son libellé est celui de B, pas celui de la mission qui
    // vient de partir.
    expect(getProjectMissionQueue(TARGET).map((e) => e.label)).toEqual([B]);

    // 2e passe : B part à son tour. Un rejeu de la demande précédente
    // produirait ici un second lancement de A.
    const r2 = await replayQueuedMissionForProject(TARGET, { isAdmissionFree: async () => true });
    expect(r2).toEqual({ replayed: true, reason: "launched" });
    expect(launched).toEqual([A, B]);
    expect(getProjectMissionQueue(TARGET)).toEqual([]);

    __resetSuperAgentQueueForTest();
  });

  it("l'admission occupée ne consomme PAS la file (B reste la prochaine, intacte)", async () => {
    __resetSuperAgentQueueForTest();
    const launched = [];
    const snippet = pushSnippets(SRC)[0];
    await runPushSnippet(snippet, runAgentsQueueByProject, TARGET, A, launched);
    await runPushSnippet(snippet, runAgentsQueueByProject, TARGET, B, launched);

    const busy = await replayQueuedMissionForProject(TARGET, { isAdmissionFree: async () => false });
    expect(busy).toEqual({ replayed: false, reason: "busy" });
    expect(launched).toEqual([]);
    expect(getProjectMissionQueue(TARGET).map((e) => e.label)).toEqual([A, B]);
    __resetSuperAgentQueueForTest();
  });
});

describe("règle 4b — commandes manuelles : le lanceur de file réinjecte SA demande", () => {
  /**
   * Fenêtre de la commande refusée dans `agent-pi.js` : de
   * `const queueRefusedCommand = (text) => {` à la fin de la fonction.
   */
  function queueRefusedCommandSource(src) {
    const marker = "const queueRefusedCommand = (text) => {";
    const start = src.indexOf(marker);
    expect(start, "queueRefusedCommand introuvable dans agent-pi.js").toBeGreaterThan(-1);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return "";
  }

  const block = queueRefusedCommandSource(AGENT_PI);

  it("le texte envoyé au démarrage est le PARAMÈTRE `text` de la commande refusée", () => {
    // Le lanceur de file est une fermeture sur `text` (paramètre de la fonction
    // appelée POUR cette demande). S'il lisait une variable de module (dernier
    // texte tapé, dernière commande…), une demande en file enverrait le texte
    // d'une AUTRE demande.
    const launchIdx = block.indexOf("launch: async () => {");
    expect(launchIdx, "le lanceur de file a disparu de queueRefusedCommand").toBeGreaterThan(-1);

    const launchBody = block.slice(launchIdx);
    // Le lanceur réinjecte `text` (le PARAMÈTRE de la commande refusée : chaque
    // appel de `queueRefusedCommand` crée sa propre fermeture).
    const assignments = launchBody.match(/inputEl\.value\s*=[^;]*;/g) || [];
    expect(assignments, "le lanceur doit réinjecter le texte de SA demande").toEqual(["inputEl.value = text;"]);
  });

  it("l'entrée de file porte aussi le libellé de SA demande (`label: text`)", () => {
    expect(block).toMatch(/enqueueProjectCommand\(\{[\s\S]*?label: text,/);
  });
});
