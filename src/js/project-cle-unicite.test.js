// NON-RÉGRESSION D3 — « deux écritures du même dossier = UNE SEULE file ».
//
// Défaut prouvé (D3 du rapport `rapport-file-attente-pertes-doublons.md`) : les
// files de missions/délégations, le verrou de run du bus, la file d'exclusivité
// et les réservations de fichiers étaient indexés par le chemin BRUT du projet,
// alors qu'un autre module normalisait déjà ce chemin. Selon l'écriture reçue
// (« G:\IA_PL\pilot », « g:/ia_pl/pilot », « G:/IA_PL/Pilot/ »…), la même
// demande créait donc DEUX files : l'une traitée, l'autre INVISIBLE (jamais
// relue, jamais rejouée, jamais abandonnée explicitement).
//
// Ce fichier ÉCHOUE si une seule de ces structures se remet à comparer le
// chemin brut :
//   1. la clé d'identité (`projectKey`) et la clé d'exclusivité (`exclusivityKey`) ;
//   2. la file d'exclusivité (`enqueueExclusivity` / `dequeueExclusivity`) ;
//   3. la file de missions de l'assistant (`enqueueMissionForProject`,
//      `getProjectMissionQueue`, état de file) ;
//   4. la file d'exclusivité du bus d'agents (`exclusivityQueueOfProject`) ;
//   5. les réservations de fichiers (`markProjectReserved`,
//      `isProjectReserved`, `isProjectReservedBy`).
import { describe, it, expect, vi, beforeEach } from "vitest";

// `super-agent.js` / `agents-bus.js` sont des modules d'UI : `window` minimal
// AVANT les imports (même harnais que les autres tests de ces modules).
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

import { projectKey, sameProject } from "./project-key.js";
import { exclusivityKey, enqueueExclusivity, dequeueExclusivity } from "./exclusivity-queue.js";
import { exclusivityQueueOfProject, destroyAgentsBus } from "./agents-bus.js";
import {
  enqueueMissionForProject,
  getProjectMissionQueue,
  missionQueueKey,
  allocateMissionIdentity,
  abandonProjectMissionQueue,
  __superAgentQueueStateForTest,
  __resetSuperAgentQueueForTest,
} from "./super-agent.js";
import { __resetMissionIdsForTest } from "./mission-identity.js";
import {
  markProjectReserved,
  isProjectReserved,
  isProjectReservedBy,
  deleteReservations,
} from "./reservations.js";

// LE MÊME dossier, écrit de quatre façons (Windows, Unix, casse, barre finale).
const WRITINGS = ["G:\\IA_PL\\pilot", "g:/ia_pl/pilot", "G:/IA_PL/Pilot/", " G:\\IA_PL\\pilot\\\\ "];
const A = WRITINGS[0];
const B = WRITINGS[1];

beforeEach(() => {
  __resetMissionIdsForTest();
  __resetSuperAgentQueueForTest();
});

describe("D3 — la clé d'identité de projet est UNIQUE", () => {
  it("toutes les écritures du même dossier donnent la MÊME clé", () => {
    const keys = WRITINGS.map((w) => projectKey(w));
    expect(new Set(keys).size, `clés distinctes pour un même dossier : ${keys.join(" | ")}`).toBe(1);
    // …et deux dossiers différents restent distincts.
    expect(sameProject(A, "G:\\IA_PL\\autre")).toBe(false);
  });

  it("la clé d'exclusivité ne dépend pas de l'écriture du chemin", () => {
    const keys = WRITINGS.map((w) => exclusivityKey(w, "codeur"));
    expect(new Set(keys).size, `clés d'exclusivité distinctes : ${keys.join(" | ")}`).toBe(1);
    // Le séparateur projet ↔ agent est conservé (contrat historique).
    expect(exclusivityKey(A, "codeur")).toContain("\u{1f}");
    expect(exclusivityKey(A, "codeur")).toBe(projectKey(A) + "\u{1f}codeur");
  });
});

describe("D3 — une seule file d'exclusivité par dossier", () => {
  it("empiler avec une écriture puis dépiler avec une autre : même file, même ordre", () => {
    const queue = {};
    const first = { agentId: "codeur", brief: "tâche 1", project: A };
    const second = { agentId: "codeur", brief: "tâche 2", project: B };
    enqueueExclusivity(queue, "codeur", A, first);
    enqueueExclusivity(queue, "codeur", B, second);
    // UNE seule clé dans la file : deux écritures ne créent pas deux files.
    expect(Object.keys(queue), "deux files pour le même dossier").toHaveLength(1);
    // Dépiler avec la PREMIÈRE écriture retrouve les deux entrées dans l'ordre.
    expect(dequeueExclusivity(queue, "codeur", A)).toBe(first);
    expect(dequeueExclusivity(queue, "codeur", A)).toBe(second);
    expect(queue).toEqual({});
  });
});

describe("D3 — une seule file de missions de l'assistant par dossier", () => {
  it("deux écritures du chemin alimentent et lisent la MÊME file", () => {
    const launch = async () => ({ started: true });
    enqueueMissionForProject(A, launch, "mission A", allocateMissionIdentity(["codeur"]));
    enqueueMissionForProject(B, launch, "mission B", allocateMissionIdentity(["testeur"]));

    // Clé de file identique pour les deux écritures.
    expect(missionQueueKey(A)).toBe(missionQueueKey(B));
    // L'accesseur d'interface (chemin RÉEL quelconque) voit les DEUX missions.
    expect(getProjectMissionQueue(A).map((e) => e.label)).toEqual(["mission A", "mission B"]);
    expect(getProjectMissionQueue(B).map((e) => e.label)).toEqual(["mission A", "mission B"]);
    expect(__superAgentQueueStateForTest(B).queueLength).toBe(2);
    // L'abandon par la SECONDE écriture vide la file créée par la première
    // (aucune file orpheline invisible).
    expect(abandonProjectMissionQueue(B)).toBe(2);
    expect(__superAgentQueueStateForTest(A).queueLength).toBe(0);
  });
});

describe("D3 — une seule file d'exclusivité du bus par dossier", () => {
  it("`exclusivityQueueOfProject` renvoie le MÊME objet pour deux écritures", () => {
    try {
      const q1 = exclusivityQueueOfProject(A);
      const q2 = exclusivityQueueOfProject(B);
      expect(q2).toBe(q1);
      q1[exclusivityKey(A, "codeur")] = [{ agentId: "codeur", brief: "occupé", project: A }];
      // Lecture par l'autre écriture : la demande est visible, pas dans une file
      // fantôme.
      expect(q2[exclusivityKey(B, "codeur")]).toHaveLength(1);
    } finally {
      destroyAgentsBus();
    }
  });
});

describe("D3 — une seule réservation de fichiers par dossier", () => {
  it("marquer avec une écriture puis interroger avec une autre", async () => {
    // Écriture d'origine : barres inverses Windows (chaîne BRUTE ≠ clé
    // canonique, c'est ce qui rend le test mordant).
    markProjectReserved(A, "codeur");
    expect(isProjectReserved(B), "deux écritures = deux projets réservés distincts").toBe(true);
    expect(isProjectReserved(A)).toBe(true);
    expect(isProjectReservedBy(B, "codeur")).toBe(true);
    expect(isProjectReservedBy(A, "codeur")).toBe(true);
    expect(isProjectReservedBy(B, "reviewer")).toBe(false);
    // Nettoyage par l'autre écriture : l'état est bien libéré.
    await deleteReservations(B);
    expect(isProjectReserved(A)).toBe(false);
    expect(isProjectReserved(B)).toBe(false);
  });
});
