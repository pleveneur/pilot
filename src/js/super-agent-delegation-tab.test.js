// Tests unitaires — cause C3 du diagnostic de délégation : la transmission de
// délégation (voie visible) ouvrait l'onglet de l'agent « default » au lieu de
// l'agent réellement résolu. Conséquence : le message délégué s'affichait dans
// le mauvais onglet et la transmission échouait ensuite (session du mauvais
// agent).
//
// Contrat vérifié :
//  - `transmitDelegationToAgent` ouvre l'onglet de l'agent RÉSOLU (agentId +
//    projectPath) et envoie la demande à CET agent ;
//  - `TabManager.openFile(..., agentId, projectPath)` propage l'agentId à
//    `_openAgent` (la session démarrée porte l'identifiant résolu) ;
//  - la voie invisible reste inchangée (`startAgentInvisible`, pas d'onglet).
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
import { transmitDelegationToAgent } from "./super-agent.js";
import { TabsManager } from "./tabs.js";

const fakeMessagesEl = () => ({
  addEventListener: () => {},
  appendChild: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
});

describe("transmitDelegationToAgent — l'onglet et la session portent l'agent RÉSOLU (cause C3)", () => {
  it("voie visible : openFile cible l'agent résolu (agentId + projectPath)", async () => {
    invoke.mockClear();
    const openFile = vi.fn(async () => ({}));
    const startAgentInvisible = vi.fn(async () => {});
    const tabs = { openFile, startAgentInvisible };

    const ok = await transmitDelegationToAgent({
      request: "corrige le bug",
      projectPath: "/p/A",
      agentId: "codeur",
      messagesEl: fakeMessagesEl(),
      tabs,
      invisible: false,
      forceInvisible: false,
      agentTabOpen: true,
    });

    expect(ok).toBe(true);
    // Discriminant : avant correctif l'appel était
    // openFile("", "agent", false, false) → onglet de `default`.
    expect(openFile).toHaveBeenCalledWith("", "agent", false, false, "codeur", "/p/A");
    expect(startAgentInvisible).not.toHaveBeenCalled();
  });

  it("voie visible : la demande est envoyée à l'agent résolu", async () => {
    invoke.mockClear();
    const tabs = {
      openFile: vi.fn(async () => ({})),
      startAgentInvisible: vi.fn(async () => {}),
    };

    await transmitDelegationToAgent({
      request: "corrige le bug",
      projectPath: "/p/A",
      agentId: "reviewer",
      messagesEl: fakeMessagesEl(),
      tabs,
      invisible: false,
      forceInvisible: false,
      agentTabOpen: true,
    });

    const send = invoke.mock.calls.find((c) => c[0] === "send_agent_command_to");
    expect(send).toBeTruthy();
    expect(send[1].agentId).toBe("reviewer");
    expect(send[1].project_path).toBe("/p/A");
  });

  it("voie invisible : startAgentInvisible avec l'agent résolu, aucun onglet ouvert", async () => {
    invoke.mockClear();
    const openFile = vi.fn(async () => ({}));
    const startAgentInvisible = vi.fn(async () => {});
    const tabs = { openFile, startAgentInvisible };

    await transmitDelegationToAgent({
      request: "corrige le bug",
      projectPath: "/p/A",
      agentId: "codeur",
      messagesEl: fakeMessagesEl(),
      tabs,
      invisible: true,
      forceInvisible: false,
      agentTabOpen: false,
    });

    expect(startAgentInvisible).toHaveBeenCalledWith("codeur", "/p/A");
    expect(openFile).not.toHaveBeenCalled();
  });
});

describe("TabsManager.openFile — propagation de l'agentId à _openAgent (cause C3)", () => {
  it("mode agent : agentId et projectPath explicites priment sur `default`", async () => {
    const _openAgent = vi.fn(async () => ({}));
    const ctx = { _openAgent };
    await TabsManager.prototype.openFile.call(ctx, "Agent Pi", "agent", false, false, "codeur", "/p/A");
    expect(_openAgent).toHaveBeenCalledWith("Agent Pi", "codeur", false, false, "/p/A");
  });

  it("mode agent sans agentId : retombe sur `default` (comportement inchangé)", async () => {
    const _openAgent = vi.fn(async () => ({}));
    const ctx = { _openAgent };
    await TabsManager.prototype.openFile.call(ctx, "Agent Pi", "agent", false);
    expect(_openAgent).toHaveBeenCalledWith("Agent Pi", "default", false, true, null);
  });
});
