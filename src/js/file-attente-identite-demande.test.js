// RÈGLE 4 (audit indépendant « verrous règles 1-4-2 ») — IDENTITÉ de la demande
// rejouée depuis la file d'attente : deux demandes A puis B en file, quand une
// demande redémarre c'est BIEN SON texte qui part — jamais celui de la
// précédente.
//
// Deux mécanismes distincts portent cette identité, tous deux verrouillés ici :
//   1. MISSIONS DE L'ASSISTANT (`super-agent.js`) : les TROIS chemins d'empilement
//      passent par le chemin de PRODUCTION UNIQUE `enqueueMissionForProject`
//      (`launchOrQueue`, `startRun`, `run_assistant_agents`), qui pose le libellé
//      de LA demande (`label = task`) ET son identité de mission. La fermeture de
//      lancement (`launchMission` / `() => startRun()`) est déclarée DANS la
//      branche, donc liée au texte de SA demande. Le rejeu
//      (`replayQueuedMissionForProject`) sort la TÊTE de file : A part d'abord,
//      puis B — jamais l'inverse, jamais deux fois la même.
//      (Depuis la fermeture des faux verrous 2-3-4, ces tests appellent la FONCTION
//      DE PRODUCTION elle-même : neutraliser `enqueueMissionForProject` /
//      `stampQueuedMission` rend ces tests ROUGES.)
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
  missionQueueKey,
  enqueueMissionForProject,
  allocateMissionIdentity,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";

// Lecture du source en neutralisant les fins de ligne (worktree CRLF en CI
// Windows : cf. AGENTS.md § Fins de ligne).
const source = (rel) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SRC = source("src/js/super-agent.js");
const AGENT_PI = source("src/js/agent-pi.js");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;



/**
 * Sites de mise en file EXTRAITS de la production : un par chemin d'empilement
 * (`launchOrQueue`, `startRun`, `run_assistant_agents`). Il n'existe plus de
 * `push` direct : toute mise en file passe par `enqueueMissionForProject`.
 * @param {string} src
 * @returns {string[]}
 */
const TARGET = "G:/projet-file";
const A = "Demande A : corriger le parser";
const B = "Demande B : ajouter les tests du parser";

function enqueueCallSites(src) {
  // Appels de production comptes directement (aucune regex fragile) : chaque
  // chemin d'empilement appelle enqueueMissionForProject(target, .
  return src.match(/enqueueMissionForProject[(]target,/g) || [];
}

/**
 * Met une demande en file par la FONCTION DE PRODUCTION (aucune reproduction du
 * mécanisme dans le test) : identité de mission ALLOUÉE par la production
 * (`allocateMissionIdentity`, numéro monotone) puis ESTAMPILLÉE sur l'entrée de
 * file par `enqueueMissionForProject`. Le test relit ensuite l'identité que la
 * production a réellement posée (`res.entry.id` / `res.entry.agentIds`) :
 * neutraliser l'allocation ou l'estampille rend les tests ROUGES.
 * @param {Function} launch
 * @param {string} label
 * @returns {{entry:object, identity:object, stampedId:number|null, stampedAgentIds:string[]}}
 */
function enqueueForTest(launch, label) {
  const identity = allocateMissionIdentity(["codeur"]);
  const res = enqueueMissionForProject(TARGET, launch, label, identity);
  return {
    entry: res.entry,
    identity,
    stampedId: res.entry.id,
    stampedAgentIds: res.entry.agentIds.slice(),
  };
}

describe("règle 4a — missions de l'assistant : chaque entrée de file porte SA demande", () => {

  it("les 3 chemins de mise en file passent par le chemin de PRODUCTION unique", () => {
    // Un chemin qui pousserait encore directement dans la file contournerait
    // l'identité de mission (numéro + agents) : il ne doit plus en exister.
    const sites = enqueueCallSites(SRC);
    expect(sites, "un chemin de mise en file ne passe plus par enqueueMissionForProject").toHaveLength(3);
    expect(SRC).not.toContain("runAgentsQueueByProject[target].push(");
    // Le libellé de LA demande et l'identité sont posés dans l'unique fonction.
    expect(SRC).toContain("queue.at(-1).label = label;");
    expect(SRC).toContain("stampQueuedMission(queue, queue.at(-1), identity)");
  });

  it("A puis B en file : l'ordre et les libellés sont ceux des demandes (jamais A pour B)", async () => {
    __resetSuperAgentQueueForTest();
    const launched = [];
    // Chaque demande porte SA fermeture : c'est le texte de SA demande qui part.
    const a = enqueueForTest(async () => { launched.push(A); return { started: true }; }, A);
    const b = enqueueForTest(async () => { launched.push(B); return { started: true }; }, B);

    // Identité de mission : ALLOUÉE par la production (compteur monotone) et
    // réellement ESTAMPILLÉE sur l'entrée de file — jamais une constante de
    // fixture.
    expect(typeof a.stampedId, "la production doit allouer l'identité de mission").toBe("number");
    expect(a.stampedId).toBe(a.identity.id);
    expect(b.stampedId).toBe(b.identity.id);
    expect(b.stampedId).toBeGreaterThan(a.stampedId);
    expect(a.stampedAgentIds).toEqual(["codeur"]);

    // D3 : la file est indexée par l'identité de projet (clé normalisée).
    const queue = runAgentsQueueByProject[missionQueueKey(TARGET)];
    expect(queue.map((e) => e.label)).toEqual([A, B]);
    // L'accesseur d'interface expose la MÊME identité estampillée (les missions
    // en attente sont nommables par leur numéro de production).
    expect(getProjectMissionQueue(TARGET).map((e) => e.id)).toEqual([a.stampedId, b.stampedId]);

    // Rejeu de la tête : c'est A qui part, et il reste B en file — avec le
    // libellé de B.
    const first = queue.shift();
    await first.launch();
    expect(launched).toEqual([A]);
    expect(runAgentsQueueByProject[missionQueueKey(TARGET)].map((e) => e.label)).toEqual([B]);

    // Rejeu suivant : c'est B qui part (jamais A une deuxième fois).
    const second = runAgentsQueueByProject[missionQueueKey(TARGET)].shift();
    await second.launch();
    expect(launched).toEqual([A, B]);
    __resetSuperAgentQueueForTest();
  });

  it("rejeu RÉEL (`replayQueuedMissionForProject`) : la tête de file part, B garde son libellé", async () => {
    __resetSuperAgentQueueForTest();
    const launched = [];
    enqueueForTest(async () => { launched.push(A); return { started: true }; }, A);
    enqueueForTest(async () => { launched.push(B); return { started: true }; }, B);

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
    enqueueForTest(async () => { launched.push(A); return { started: true }; }, A);
    enqueueForTest(async () => { launched.push(B); return { started: true }; }, B);

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
