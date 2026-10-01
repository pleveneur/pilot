// Tests unitaires — fuite d'écouteurs globaux des onglets agent (agent-pi.js).
//
// Le défaut (erreurs console de l'onglet Assistant) : `createAgentPi` enregistre
// des écouteurs globaux sur `window`/`document` (pilot-config-changed,
// pilot-models-changed, pilot-superagent-open-changed, pilot-project-sensitivity)
// mais son `unlisten` ne les retirait PAS. Chaque onglet agent fermé laissait donc
// ses handlers en place : ils s'accumulaient (un jeu par onglet fermé) et
// s'exécutaient sur un onglet détruit à chaque `pilot-config-changed` (émis
// notamment par l'onglet Assistant quand il enregistre ses réglages) ou à chaque
// ouverture/fermeture de l'onglet Assistant (`pilot-superagent-open-changed`) :
// rafales d'appels IPC redondants et écritures dans des éléments détachés.
//
// Ces tests sont DISCRIMINANTS : avant le correctif, `detachGlobalListeners`
// n'existe pas et les écouteurs globaux ne passent pas par un `onGlobal` collecté
// → rouge ; après, le retrait est effectif et branché dans `unlisten` → vert.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Stubs DOM minimaux + IPC Tauri : agent-pi.js est un module d'UI (il touche
// `window`/`document` et les API Tauri au chargement). Même pattern que
// agent-activity-assistant-tab.test.js.
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
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { detachGlobalListeners } from "./agent-pi.js";

// Fausse cible d'écouteurs (vitest tourne en environnement node, sans jsdom).
function fakeTarget() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (handlers.has(type)) handlers.get(type).delete(handler);
    },
    count(type) {
      return handlers.has(type) ? handlers.get(type).size : 0;
    },
  };
}

describe("detachGlobalListeners", () => {
  it("retire les écouteurs collectés (cible + type + handler)", () => {
    const win = fakeTarget();
    const doc = fakeTarget();
    const a = () => {};
    const b = () => {};
    const c = () => {};
    const listeners = [
      [win, "pilot-config-changed", a],
      [doc, "pilot-project-sensitivity", b],
      [win, "pilot-superagent-open-changed", c],
    ];
    for (const [t, type, h] of listeners) t.addEventListener(type, h);
    expect(win.count("pilot-config-changed")).toBe(1);
    expect(doc.count("pilot-project-sensitivity")).toBe(1);

    detachGlobalListeners(listeners);

    expect(win.count("pilot-config-changed")).toBe(0);
    expect(doc.count("pilot-project-sensitivity")).toBe(0);
    expect(win.count("pilot-superagent-open-changed")).toBe(0);
  });

  it("ne touche pas un écouteur d'un autre onglet (retrait ciblé)", () => {
    const win = fakeTarget();
    const mine = () => {};
    const other = () => {};
    win.addEventListener("pilot-config-changed", mine);
    win.addEventListener("pilot-config-changed", other);

    detachGlobalListeners([[win, "pilot-config-changed", mine]]);

    expect(win.count("pilot-config-changed")).toBe(1);
    expect(win.handlers.get("pilot-config-changed").has(other)).toBe(true);
  });

  it("tolère une liste vide ou absente", () => {
    expect(() => detachGlobalListeners([])).not.toThrow();
    expect(() => detachGlobalListeners(undefined)).not.toThrow();
  });

  it("après deux onglets ouverts puis fermés, plus aucun handler fantôme", () => {
    const win = fakeTarget();
    const sets = [];
    for (let i = 0; i < 2; i++) {
      const h = () => {};
      const listeners = [[win, "pilot-config-changed", h]];
      win.addEventListener("pilot-config-changed", h);
      sets.push(listeners);
    }
    expect(win.count("pilot-config-changed")).toBe(2);

    for (const s of sets) detachGlobalListeners(s);

    expect(win.count("pilot-config-changed")).toBe(0);
  });
});

describe("branchement des écouteurs globaux dans createAgentPi (garde anti-régression)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "agent-pi.js"), "utf8");

  // Événements globaux auxquels un onglet agent réagit.
  const GLOBAL_EVENTS = [
    "pilot-config-changed",
    "pilot-models-changed",
    "pilot-superagent-open-changed",
    "pilot-project-sensitivity",
  ];

  it("aucun ajout direct sur window/document : tout passe par onGlobal", () => {
    const direct = [
      ...src.matchAll(/(window|document)\.addEventListener\("(pilot-[a-z-]+)"/g),
    ].map((m) => m[2]);
    // Les deux seuls ajouts globaux hors `onGlobal` sont ceux déjà retirés
    // explicitement dans unlisten (redémarrage + RAG).
    const legacyAllowed = ["pilot-agent-restart-needed", "pilot:rag-building"];
    const unexpected = direct.filter((e) => !legacyAllowed.includes(e));
    expect(unexpected).toEqual([]);
  });

  it("chaque événement global est enregistré via onGlobal", () => {
    for (const ev of GLOBAL_EVENTS) {
      const n = (src.match(new RegExp(`onGlobal\\(\\s*(window|document)\\s*,\\s*"${ev}"`, "g")) || []).length;
      expect(n).toBeGreaterThanOrEqual(1);
    }
    // pilot-config-changed est écouté par 4 handlers distincts (porte
    // pré-écriture, blocage de saisie, auto-test, état de saisie agent).
    const nConfig = (src.match(/onGlobal\(\s*window\s*,\s*"pilot-config-changed"/g) || []).length;
    expect(nConfig).toBe(4);
  });

  it("unlisten retire les écouteurs globaux collectés", () => {
    expect(/detachGlobalListeners\(globalListeners\)/.test(src)).toBe(true);
  });

  it("la collection est alimentée par onGlobal (cible, type, handler)", () => {
    expect(/globalListeners\.push\(\[target, type, handler\]\)/.test(src)).toBe(true);
  });
});
