// Tests unitaires — tâche #140 : onglet d'un agent SANS projet (espace
// `__assistant__`). Défaut corrigé : le clic « Afficher l'onglet » ouvrait
// l'onglet de l'agent homonyme du PROJET ACTIF (le chemin du projet n'était pas
// transmis) et, sans projet ouvert, l'ouverture échouait en silence (erreur
// avalée).
//
// Contrat vérifié :
//  - `flattenAgents` marque l'espace des agents d'assistant `"__assistant__"`
//    (et non `""`) pour que l'appelant puisse dire « aucun projet » ;
//  - `_openAgent(..., "__assistant__")` résout l'agent GLOBAL (project_path
//    null), démarre la session par les commandes dédiées
//    (`start_assistant_agent_process`, cwd `"__assistant__"`) et n'appelle
//    JAMAIS `start_agent_session` (qui viserait le projet actif).
import { describe, it, expect, vi } from "vitest";

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

import { invoke } from "@tauri-apps/api/core";
import { flattenAgents } from "./agent-activity.js";
import { TabsManager } from "./tabs.js";

const ASSISTANT_SPACE = "__assistant__";

/** Réponses minimales des commandes sollicitées par l'ouverture d'un onglet. */
function mockInvoke() {
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === "pi_health_check") return { ok: true, kind: "pi", version: "1.0", path: "pi", error: null };
    if (cmd === "get_config") return { rpc_pi_path: "/usr/bin/pi", rpc_no_session: true };
    if (cmd === "get_agent") return undefined; // agent pas encore chargé
    void args;
    return undefined;
  });
}

describe("flattenAgents — espace des agents d'assistant", () => {
  it("marque l'agent d'assistant avec l'espace `__assistant__` (aucun projet)", () => {
    const sup = {
      projects: [
        {
          path: ASSISTANT_SPACE,
          name: "Assistant",
          agents: [{ agent: "analyseur", state: "running", alive: true }],
        },
      ],
    };
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    // Discriminant : avant correctif l'espace était `""`, indistinguable de
    // « pas d'information » → l'ouverture retombait sur le projet actif.
    expect(list[0].kind).toBe("assistant");
    expect(list[0].projectPath).toBe(ASSISTANT_SPACE);
  });
});

describe("_openAgent — ouverture de l'onglet d'un agent sans projet", () => {
  it("résout l'agent GLOBAL et démarre la session d'assistant (jamais le projet actif)", async () => {
    mockInvoke();
    window._pilotProjectPath = "/p/ACTIF";
    const ctx = {
      tabs: [],
      container: { appendChild: () => {} },
      _renderTabButton: () => {},
      switchTab: () => {},
      _scheduleSave: () => {},
      _startAgentSession: TabsManager.prototype._startAgentSession,
    };

    const tab = await TabsManager.prototype._openAgent.call(
      ctx, "analyseur", "analyseur", false, true, ASSISTANT_SPACE
    );

    // L'agent est cherché en GLOBAL (project_path null) : un agent d'assistant
    // est persisté avec `project_path IS NULL`.
    const getAgent = invoke.mock.calls.find((c) => c[0] === "get_agent");
    expect(getAgent[1]).toEqual({ agentId: "analyseur", projectPath: null });

    // La session est démarrée par la commande dédiée (espace assistant).
    const startAssistant = invoke.mock.calls.find((c) => c[0] === "start_assistant_agent_process");
    expect(startAssistant).toBeTruthy();
    expect(startAssistant[1]).toMatchObject({ agentId: "analyseur", cwd: ASSISTANT_SPACE });

    // Jamais de démarrage projet-scopé (fuite vers le projet actif).
    expect(invoke.mock.calls.some((c) => c[0] === "start_agent_session")).toBe(false);

    // L'onglet ne peut PAS prétendre appartenir au projet actif (sinon
    // `_activateTab`/la persistance le traiteraient comme un onglet de projet).
    expect(tab.projectPath).toBe(ASSISTANT_SPACE);
    expect(tab.projectPath).not.toBe("/p/ACTIF");
  });
});
