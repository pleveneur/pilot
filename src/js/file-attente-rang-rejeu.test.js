// FILE D'ATTENTE — « une mission rejouée garde SON RANG ».
//
// Bug visé : une demande mise en file derrière une tâche en cours n'est pas
// exécutée à SON tour.
//
// Mécanisme prouvé (avant correctif) : quand une mission SORT de la file puis
// trouve le projet encore occupé, la production la remet en file par le chemin
// unique `enqueueMissionForProject` — qui pousse TOUJOURS en QUEUE de file. La
// mission perd donc son rang : celles qui étaient DERRIÈRE elle passent DEVANT.
// Le créneau libéré exécute alors une AUTRE demande que celle dont c'était le
// tour (typiquement celle de l'étape précédente, déjà livrée) : c'est
// exactement ce que l'utilisateur observe comme « la tâche mise en file a
// exécuté la tâche précédente ».
//
// Les deux preuves ci-dessous ÉCHOUENT si le correctif est retiré :
//   a. COMPORTEMENT : une mission remise en file après un rejeu reprend la
//      TÊTE (rang 1), pas la queue ;
//   b. CÂBLAGE : les trois chemins de remise en file de production
//      (`launchOrQueue` et `startRun`) restaurent le rang quand — et seulement
//      quand — la mission sort de la file (`launchOpts.dequeue`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

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
  runAgentsQueueByProject,
  enqueueMissionForProject,
  restoreQueuedMissionRank,
  getProjectMissionQueue,
  allocateMissionIdentity,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";

const root = new URL("../../", import.meta.url);
const superAgentSrc = readFileSync(new URL("src/js/super-agent.js", root), "utf8").replace(/\r\n/g, "\n");

const PROJECT = "rang-rejeu-projet";

/** Empile une mission par le chemin de PRODUCTION (identité allouée). */
function queue(label, launch = async () => {}) {
  return enqueueMissionForProject(PROJECT, launch, label, allocateMissionIdentity(["codeur"]));
}

beforeEach(() => {
  __resetMissionIdsForTest();
  __resetSuperAgentQueueForTest();
});

afterEach(() => {
  delete runAgentsQueueByProject[PROJECT];
});

// ── a. Comportement : la mission rejouée reprend SON rang ──────────────────
describe("file d'attente — une mission rejouée reprend son rang", () => {
  it("remise en file après un rejeu : elle repasse en TÊTE (rang 1), jamais derrière les suivantes", () => {
    // Deux missions attendent : B (tête) puis C.
    const b = queue("mission B : écrire les routes HTTP");
    const c = queue("mission C : brancher l'application de bureau");
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.label)).toEqual([
      "mission B : écrire les routes HTTP",
      "mission C : brancher l'application de bureau",
    ]);

    // B sort de la file (c'est le `shift` de l'appelant dans `settleRun` /
    // `replayQueuedMissionForProject`), puis trouve le projet ENCORE OCCUPÉ :
    // la production la remet en file par le chemin unique.
    const entryB = runAgentsQueueByProject[PROJECT].shift();
    expect(entryB).toBe(b.entry);
    const requeued = enqueueMissionForProject(PROJECT, entryB.launch, entryB.label, {
      id: entryB.id,
      agentIds: entryB.agentIds,
    });
    // Correctif : la mission rejouée est REPLACÉE à sa place (tête de file).
    restoreQueuedMissionRank(PROJECT, requeued.entry);

    // Le tour suivant DOIT être B — pas C. Sans le correctif, C passerait
    // devant B et le créneau libéré exécuterait une autre demande que celle
    // dont c'était le tour.
    const order = runAgentsQueueByProject[PROJECT];
    expect(order.map((e) => e.label)).toEqual([
      "mission B : écrire les routes HTTP",
      "mission C : brancher l'application de bureau",
    ]);
    // Le rang affiché (calculé depuis la position) reste celui de B.
    expect(getProjectMissionQueue(PROJECT)[0]).toMatchObject({
      label: "mission B : écrire les routes HTTP",
      id: b.entry.id,
    });
  });

  it("restoreQueuedMissionRank : idempotent, sans effet sur une entrée absente ou déjà en tête", () => {
    queue("A");
    const b = queue("B");
    // Déjà en QUEUE : elle remonte en tête une fois.
    expect(restoreQueuedMissionRank(PROJECT, b.entry)).toBe(true);
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.label)).toEqual(["B", "A"]);
    // Rappel : plus rien à faire, aucun doublon, aucun déplacement.
    expect(restoreQueuedMissionRank(PROJECT, b.entry)).toBe(true);
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.label)).toEqual(["B", "A"]);
    // Entrée étrangère à la file (jamais empilée) : aucun effet.
    expect(restoreQueuedMissionRank(PROJECT, { label: "pas dans la file" })).toBe(false);
    expect(runAgentsQueueByProject[PROJECT].map((e) => e.label)).toEqual(["B", "A"]);
    // Projet sans file : aucun effet, aucune file fantôme créée.
    expect(restoreQueuedMissionRank("projet-sans-file", b.entry)).toBe(false);
    expect(runAgentsQueueByProject["projet-sans-file"]).toBeUndefined();
  });
});

// ── b. Câblage : les TROIS chemins de remise en file restaurent le rang ─────
describe("file d'attente — câblage de production", () => {
  it("les trois remises en file passent par restoreQueuedMissionRank quand la mission sort de la file", () => {
    const sites = superAgentSrc.match(/restoreQueuedMissionRank\(target, queued\.entry\)/g) || [];
    expect(sites, "les TROIS chemins de remise en file doivent restaurer le rang").toHaveLength(3);
    // Le garde : uniquement pour une mission SORTIE de la file (`dequeue`).
    // Une demande qui ARRIVE (dequeue absent) garde sa place en queue de file.
    const guards = superAgentSrc.match(/if \(launchOpts && launchOpts\.dequeue\) restoreQueuedMissionRank/g) || [];
    expect(guards, "le rang ne doit être restauré que pour une mission rejouée").toHaveLength(3);
    // Les trois chemins d'empilement restent branchés sur le chemin unique.
    const enqueues = superAgentSrc.match(/enqueueMissionForProject\(target,/g) || [];
    expect(enqueues, "un chemin de mise en file ne passe plus par enqueueMissionForProject").toHaveLength(3);
  });

  it("restoreQueuedMissionRank est exportée et n'invente aucune file", () => {
    expect(superAgentSrc).toContain("export function restoreQueuedMissionRank(projectPath, entry)");
    expect(superAgentSrc).toContain("queue.splice(at, 1);");
    expect(superAgentSrc).toContain("queue.unshift(entry);");
  });
});
