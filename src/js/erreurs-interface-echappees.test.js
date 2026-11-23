// erreurs-interface-echappees.test.js — COMP-06, lot 6 (revue du 2026-11-16).
//
// Des messages d'erreur renvoyés par des commandes Tauri étaient insérés tels
// quels dans `innerHTML`. Un message d'erreur est une DONNÉE : il peut porter un
// texte venu d'ailleurs (ex. le refus d'écriture GDS cite une échéance lue dans
// l'état renvoyé par le serveur ; une erreur d'E/S ou de format peut citer un
// nom ou un fragment de fichier). Il doit rester lisible, jamais devenir du HTML.
//
// Chemins réels couverts (modules montés, commandes Tauri simulées) :
//  - tabs.js `_openAgent` : `start_agent_session` rejette → écran d'erreur ;
//  - tabs.js `_openAgent` (onglet déjà ouvert) → `showAgentOpenError` ;
//  - vault.js `createVault` : `vault_status` rejette, `vault_list` rejette,
//    `vault_delete` rejette.
//
// LIMITE : pas de navigateur ni de jsdom (non embarqué par le dépôt). Le faux
// DOM ci-dessous ne parse pas le HTML : on lit la chaîne effectivement remise à
// `innerHTML` / `insertAdjacentHTML` et le `textContent` des nœuds créés.
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const noop = () => {};
  const created = [];
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || "div").toUpperCase();
      this.children = [];
      this.parent = null;
      this.style = {};
      this.dataset = {};
      this.listeners = {};
      this.className = "";
      this.innerHTML = "";
      this.textContent = "";
      this.value = "";
      this.title = "";
      this.insertedHtml = [];
      this.bySelector = new Map();
      const classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: noop,
        contains: (c) => classes.has(c),
      };
      created.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener() {}
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    prepend(c) {
      c.parent = this;
      this.children.unshift(c);
    }
    insertBefore(c, ref) {
      c.parent = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c);
      else this.children.splice(i, 0, c);
      return c;
    }
    get firstChild() {
      return this.children[0] || null;
    }
    insertAdjacentHTML(_pos, html) {
      this.insertedHtml.push(String(html));
    }
    remove() {}
    // One stable child per selector: stands in for the nodes the real
    // browser would create from the component's static markup.
    querySelector(sel) {
      if (!this.bySelector.has(sel)) this.bySelector.set(sel, new FakeEl("div"));
      return this.bySelector.get(sel);
    }
    querySelectorAll() {
      return [];
    }
    setAttribute() {}
    getAttribute() {
      return null;
    }
    focus() {}
    scrollIntoView() {}
  }
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  const head = new FakeEl("head");
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: new FakeEl("body"),
    documentElement: new FakeEl("html"),
    // float-tooltip (via force-graph) injects a <style> into document.head at load time.
    head,
    getElementsByTagName: () => [head],
    createTextNode: (t) => ({ nodeValue: String(t) }),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = noop;
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  return { FakeEl, created };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {}, setIcon: () => {}, setIconText: () => {} }));

import { invoke } from "@tauri-apps/api/core";
import { TabsManager } from "./tabs.js";
import { createVault } from "./vault.js";

// Harmless markup standing in for untrusted text inside an error message.
const MARKUP = '<b id="injecte">poste-B</b>';
const MARKUP_ESCAPED = "&lt;b id=&quot;injecte&quot;&gt;poste-B&lt;/b&gt;";
const GDS_REFUSAL =
  `Écriture refusée : projet tenu par un autre poste, jusqu'à ${MARKUP} — ce poste est en lecture seule.`;

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  invoke.mockReset();
  H.created.length = 0;
});

describe("tabs.js — l'échec de démarrage d'un agent s'affiche en texte", () => {
  function agentInvoke(startError) {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "pi_health_check") return { ok: true, kind: "pi", version: "1.0", path: "pi", error: null };
      if (cmd === "get_config") return {};
      if (cmd === "get_agent") return { loaded: false };
      if (cmd === "start_agent_session") throw startError;
      return undefined;
    });
  }
  function ctx(tabs = []) {
    return {
      tabs,
      container: { appendChild: () => {} },
      _renderTabButton: () => {},
      switchTab: () => {},
      _scheduleSave: () => {},
      _startAgentSession: TabsManager.prototype._startAgentSession,
    };
  }

  it("nouvel onglet : le refus de start_agent_session n'injecte aucun balisage", async () => {
    agentInvoke(GDS_REFUSAL);
    window._pilotProjectPath = "/p/projet";
    const tab = await TabsManager.prototype._openAgent.call(ctx(), "Agent", "default", false, true, "/p/projet");
    const html = tab.wrapper.innerHTML;
    // Readable: the UI frame and the message text are both still there.
    expect(html).toContain("❌ Erreur:");
    expect(html).toContain("Écriture refusée : projet tenu par un autre poste");
    // Not interpreted: the markup arrives escaped, never as a live tag.
    expect(html).toContain(MARKUP_ESCAPED);
    expect(html).not.toContain("<b id=");
  });

  it("onglet déjà ouvert : showAgentOpenError affiche l'erreur en texte", async () => {
    agentInvoke(new Error(GDS_REFUSAL));
    window._pilotProjectPath = "/p/projet";
    const existing = { id: 1, mode: "agent", agentId: "default", projectPath: "/p/projet", wrapper: new H.FakeEl("div") };
    await TabsManager.prototype._openAgent.call(ctx([existing]), "Agent", "default", false, true, "/p/projet");
    const html = existing.wrapper.innerHTML;
    expect(html).toContain("Impossible d'ouvrir l'agent");
    expect(html).toContain("Error: Écriture refusée");
    expect(html).toContain(MARKUP_ESCAPED);
    expect(html).not.toContain("<b id=");
  });
});

describe("vault.js — les erreurs du coffre s'affichent en texte", () => {
  function mountVault() {
    const container = new H.FakeEl("div");
    createVault(container);
    return container;
  }
  function errorNodeIn(el) {
    return el.children.find((c) => c.className === "vault-error");
  }

  it("vault_status rejette : message lisible, aucun balisage injecté", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "vault_status") throw `Erreur lecture coffre: ${MARKUP}`;
      return undefined;
    });
    const container = mountVault();
    await flush();
    const body = container.querySelector("#vault-body");
    expect(body.innerHTML).not.toContain("<b id=");
    const node = errorNodeIn(body);
    expect(node).toBeTruthy();
    expect(node.textContent).toBe(`Erreur lecture coffre: ${MARKUP}`);
  });

  it("vault_list rejette : message lisible, aucun balisage injecté", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "vault_status") return { initialized: true, unlocked: true };
      if (cmd === "vault_list") throw `Erreur format coffre: ${MARKUP}`;
      return undefined;
    });
    const container = mountVault();
    await flush();
    const body = container.querySelector("#vault-body");
    expect(body.innerHTML).not.toContain("<b id=");
    const node = errorNodeIn(body);
    expect(node).toBeTruthy();
    expect(node.textContent).toBe(`Erreur format coffre: ${MARKUP}`);
  });

  it("vault_delete rejette : message lisible en tête de liste, aucun balisage injecté", async () => {
    const entry = { id: "e1", description: "Serveur", login: "root", password: "x", scope: "global" };
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "vault_status") return { initialized: true, unlocked: true };
      if (cmd === "vault_list") return [entry];
      if (cmd === "vault_delete") throw `Erreur écriture coffre: ${MARKUP}`;
      return undefined;
    });
    const container = mountVault();
    await flush();
    const del = H.created.find((el) => el.title === "Supprimer");
    expect(del).toBeTruthy();
    await del.listeners.click[0]();
    await flush();
    const entries = container.querySelector("#vault-entries");
    expect(entries.insertedHtml.join("")).not.toContain("<b id=");
    const node = entries.children[0];
    expect(node.className).toBe("vault-error");
    expect(node.textContent).toBe(`Erreur écriture coffre: ${MARKUP}`);
  });
});
