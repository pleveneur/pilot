// Tests — session-persistence.js : sauvegarde/restauration des onglets.
//
// Contrat vérifié :
//  - ce qui est sérialisé (et ce qui est ignoré : agent/terminal, scratchpad
//    marqué `__scratchpad__`, curseur, scroll) ;
//  - la liste d'alias par projet (`activePath`) ;
//  - les vues d'agent persistées (uniquement mode agent + projet sauvegardé,
//    ordre, nom renommé, onglet actif) ;
//  - le debounce conserve le projet CAPTURÉ à la planification (régression
//    « onglet agent fantôme » : Bug 2) ;
//  - `agent_start_on_launch === false` empêche la restauration des onglets
//    agents depuis `agent_views` sans réécrire les lignes persistées.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.window = {};
});

let invokeImpl;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

import {
  saveTabSession,
  scheduleSave,
  loadTabSession,
  restoreTabs,
} from "./session-persistence.js";

/** Fake TabsManager minimal : `tabs`, `getActiveTab`, `openFile`, `_openAgent`… */
function fakeTabs(tabs, handlers = {}) {
  const active = handlers.active !== undefined ? handlers.active : tabs[0];
  return {
    tabs,
    getActiveTab: () => active,
    openFile: handlers.openFile || vi.fn(async () => {}),
    _openScratchpad: handlers._openScratchpad || vi.fn(async () => {}),
    _openAgent: handlers._openAgent || vi.fn(async () => {}),
    _moveTabToIndex: handlers._moveTabToIndex || vi.fn(),
    switchTab: handlers.switchTab || vi.fn(),
  };
}

/** Vue CodeMirror minimale (curseur + scroll). */
function fakeView(lineNumber, from, col, scrollTop = 0, scrollLeft = 0) {
  return {
    state: {
      selection: { main: { head: from + col - 1 } },
      doc: { lineAt: () => ({ number: lineNumber, from }) },
    },
    scrollDOM: { scrollTop, scrollLeft },
  };
}

function callsFor(cmd) {
  return invokeImpl.mock.calls.filter((c) => c[0] === cmd);
}

beforeEach(() => {
  invokeImpl = vi.fn(async () => undefined);
});

describe("saveTabSession — sérialisation", () => {
  it("sérialise un onglet edit avec curseur et scroll", async () => {
    const tab = { id: 1, path: "C:/p/a.md", mode: "edit", view: fakeView(12, 100, 4, 50, 7) };
    const tabs = fakeTabs([tab]);

    await saveTabSession(tabs, "C:/p");

    const [cmd, args] = callsFor("save_tab_session")[0];
    expect(cmd).toBe("save_tab_session");
    expect(args.projectPath).toBe("C:/p");
    const data = JSON.parse(args.data);
    expect(data.activePath).toBe("C:/p/a.md");
    expect(data.tabs).toEqual([
      { path: "C:/p/a.md", mode: "edit", cursorLine: 12, cursorCol: 4, scrollTop: 50, scrollLeft: 7 },
    ]);
  });

  it("ignore les onglets sans chemin (agent, terminal) mais marque le scratchpad", async () => {
    const tabs = fakeTabs([
      { id: 1, path: "", mode: "agent", agentId: "default", projectPath: "C:/p" },
      { id: 2, path: "", mode: "terminal" },
      { id: 3, path: "", mode: "edit", isScratchpad: true },
    ]);

    await saveTabSession(tabs, "C:/p");

    const data = JSON.parse(callsFor("save_tab_session")[0][1].data);
    expect(data.tabs).toEqual([{ path: "__scratchpad__", mode: "edit", isScratchpad: true }]);
    expect(data.activePath).toBeNull();
  });

  it("sérialise le scroll des onglets non-edit (preview, pdf, csv, image)", async () => {
    const tabs = fakeTabs([
      { id: 1, path: "C:/p/a.md", mode: "preview", wrapper: { scrollTop: 11, scrollLeft: 2 } },
      { id: 2, path: "C:/p/b.pdf", mode: "pdf", wrapper: { scrollTop: 300, scrollLeft: 0 } },
    ]);

    await saveTabSession(tabs, "C:/p");

    const data = JSON.parse(callsFor("save_tab_session")[0][1].data);
    expect(data.tabs).toEqual([
      { path: "C:/p/a.md", mode: "preview", scrollTop: 11, scrollLeft: 2 },
      { path: "C:/p/b.pdf", mode: "pdf", scrollTop: 300, scrollLeft: 0 },
    ]);
  });

  it("persiste les vues d'agent du projet sauvegardé seulement, avec ordre et onglet actif", async () => {
    const active = { id: 9, mode: "agent", agentId: "default", projectPath: "C:/p" };
    const tabs = fakeTabs(
      [
        { id: 1, path: "C:/p/a.md", mode: "edit" },
        { id: 2, path: "", mode: "agent", agentId: "codeur", projectPath: "C:/p", name: "Codeur" },
        active,
        { id: 4, path: "", mode: "agent", agentId: "default", projectPath: "C:/autre" },
      ],
      { active }
    );

    await saveTabSession(tabs, "C:/p");

    const [cmd, args] = callsFor("save_agent_views")[0];
    expect(cmd).toBe("save_agent_views");
    expect(args.projectPath).toBe("C:/p");
    expect(args.views).toEqual([
      { agent_id: "codeur", project_path: "C:/p", order_index: 1, name_override: "Codeur", active: false },
      { agent_id: "default", project_path: "C:/p", order_index: 2, name_override: null, active: true },
    ]);
    // l'onglet agent d'un AUTRE projet n'est jamais persisté sous ce chemin
    expect(args.views.some((v) => v.project_path === "C:/autre")).toBe(false);
  });

  it("sans chemin de projet, n'entame aucune écriture", async () => {
    const tabs = fakeTabs([{ id: 1, path: "C:/p/a.md", mode: "edit" }]);
    await saveTabSession(tabs, "");
    await saveTabSession(tabs, null);
    expect(invokeImpl).not.toHaveBeenCalled();
  });
});

describe("scheduleSave — debounce et projet capturé (Bug 2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("n'écrit qu'une fois après le délai et sur le projet CAPTURÉ", async () => {
    const tabs = fakeTabs([{ id: 1, path: "C:/p/a.md", mode: "edit" }]);

    scheduleSave(tabs, "C:/p/A");
    // le projet actif change avant l'échéance : la sauvegarde doit rester sur A
    window._pilotProjectPath = "C:/p/B";
    await vi.advanceTimersByTimeAsync(300);

    const saves = callsFor("save_tab_session");
    expect(saves.length).toBe(1);
    expect(saves[0][1].projectPath).toBe("C:/p/A");
  });

  it("une planification plus récente annule la précédente", async () => {
    const tabs = fakeTabs([{ id: 1, path: "C:/p/a.md", mode: "edit" }]);

    scheduleSave(tabs, "C:/p/A");
    scheduleSave(tabs, "C:/p/B");
    await vi.advanceTimersByTimeAsync(300);

    const saves = callsFor("save_tab_session");
    expect(saves.length).toBe(1);
    expect(saves[0][1].projectPath).toBe("C:/p/B");
  });

  it("sans projet, ne planifie rien", async () => {
    scheduleSave(fakeTabs([]), "");
    await vi.advanceTimersByTimeAsync(300);
    expect(invokeImpl).not.toHaveBeenCalled();
  });
});

describe("loadTabSession", () => {
  it("retourne la session désérialisée", async () => {
    invokeImpl = vi.fn(async () => JSON.stringify({ activePath: "a.md", tabs: [{ path: "a.md", mode: "edit" }] }));
    const session = await loadTabSession("C:/p");
    expect(session.tabs.length).toBe(1);
    expect(session.activePath).toBe("a.md");
  });

  it("retourne null si aucune session, projet absent ou JSON invalide", async () => {
    invokeImpl = vi.fn(async () => null);
    expect(await loadTabSession("C:/p")).toBeNull();

    expect(await loadTabSession("")).toBeNull();

    invokeImpl = vi.fn(async () => "{ pas du json");
    expect(await loadTabSession("C:/p")).toBeNull();
  });

  it("retourne null si la commande échoue (jamais d'exception)", async () => {
    invokeImpl = vi.fn(async () => {
      throw new Error("disque");
    });
    expect(await loadTabSession("C:/p")).toBeNull();
  });
});

describe("restoreTabs", () => {
  it("restaure les onglets d'édition et le scratchpad", async () => {
    invokeImpl = vi.fn(async (cmd) => {
      if (cmd === "load_tab_session") {
        return JSON.stringify({
          activePath: "C:/p/a.md",
          tabs: [{ path: "C:/p/a.md", mode: "edit" }, { path: "__scratchpad__", isScratchpad: true }],
        });
      }
      if (cmd === "list_agent_views") return [];
      if (cmd === "list_open_projects") return [];
      return undefined;
    });
    const openFile = vi.fn(async () => {});
    const _openScratchpad = vi.fn(async () => {});
    const tabs = fakeTabs([], { openFile, _openScratchpad });

    await restoreTabs(tabs, "C:/p");

    expect(openFile).toHaveBeenCalledWith("C:/p/a.md", "edit");
    expect(_openScratchpad).toHaveBeenCalled();
  });

  it("agent_start_on_launch=false : les vues agents ne sont PAS rouvertes", async () => {
    invokeImpl = vi.fn(async (cmd) => {
      if (cmd === "load_tab_session") return null;
      if (cmd === "list_agent_views") return [{ agent_id: "default", project_path: "C:/p" }];
      if (cmd === "get_config") return { agent_start_on_launch: false };
      if (cmd === "list_open_projects") return ["C:/p"];
      return undefined;
    });
    const _openAgent = vi.fn(async () => {});
    const tabs = fakeTabs([], { _openAgent });

    await restoreTabs(tabs, "C:/p");

    expect(callsFor("list_agent_views").length).toBeGreaterThan(0); // lu…
    expect(_openAgent).not.toHaveBeenCalled(); // …mais jamais rouvert
  });

  it("agent_start_on_launch absent (ancienne config) = activé : les vues sont rouvertes", async () => {
    invokeImpl = vi.fn(async (cmd) => {
      if (cmd === "load_tab_session") return null;
      if (cmd === "list_agent_views") {
        return [{ agent_id: "default", project_path: "C:/p" }];
      }
      if (cmd === "get_config") return {}; // champ absent
      if (cmd === "list_open_projects") return [];
      return undefined;
    });
    const _openAgent = vi.fn(async () => {});
    const tabs = fakeTabs([], { _openAgent });

    await restoreTabs(tabs, "C:/p");

    expect(_openAgent).toHaveBeenCalledWith("Agent Pi", "default", false, false, "C:/p");
  });

  it("restaure les vues des AUTRES projets ouverts, scopées à leur projet (T4)", async () => {
    const views = {
      "C:/p/A": [{ agent_id: "codeur", order_index: 0, project_path: "C:/p/A" }],
      "C:/p/B": [{ agent_id: "default", order_index: 0, project_path: "C:/p/B" }],
    };
    invokeImpl = vi.fn(async (cmd, args) => {
      if (cmd === "load_tab_session") return null;
      if (cmd === "list_agent_views") return views[args.projectPath] || [];
      if (cmd === "get_config") return { agent_start_on_launch: true };
      if (cmd === "list_open_projects") return ["C:/p/A", "C:/p/B"];
      return undefined;
    });
    const _openAgent = vi.fn(async () => {});
    const tabs = fakeTabs([], { _openAgent });

    await restoreTabs(tabs, "C:/p/A");

    expect(_openAgent).toHaveBeenCalledWith("Agent Pi", "codeur", false, false, "C:/p/A");
    expect(_openAgent).toHaveBeenCalledWith("Agent Pi", "default", false, false, "C:/p/B");
    expect(_openAgent.mock.calls.length).toBe(2); // ni doublon ni projet en trop
  });

  it("ni session ni vue agent : ne touche à rien", async () => {
    invokeImpl = vi.fn(async (cmd) => (cmd === "list_agent_views" ? [] : null));
    const tabs = fakeTabs([], { openFile: vi.fn(), _openAgent: vi.fn() });

    await restoreTabs(tabs, "C:/p");

    expect(tabs.openFile).not.toHaveBeenCalled();
    expect(tabs._openAgent).not.toHaveBeenCalled();
  });
});
