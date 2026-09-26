// Tests — avertissement GitHub avant publication GDS + rafraîchissement de
// l'explorateur après une synchronisation (branche gds-refonte-l2).
//
// Défauts corrigés (ce fichier ÉCHOUE avant, PASSE après) :
//  1. Le passage au GDS n'avertissait PAS l'utilisateur qu'il quitte GitHub :
//     le premier clic sur « Publier » / « Ajouter » lançait l'envoi aussitôt.
//     Ici le premier clic ne doit RIEN envoyer ; l'envoi n'a lieu qu'après
//     confirmation, et le texte doit parler de GitHub.
//  2. Après une synchronisation réussie, l'explorateur restait figé (le
//     guetteur de fichiers ignore `.git`). Le test vérifie que le chemin de
//     rafraîchissement existant (`_rebuildTree`) est bien appelé.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGds } from "./gds.js";

let invokeImpl = () => Promise.resolve(null);
let calls = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => {
    calls.push(args[0]);
    return invokeImpl(...args);
  },
}));

/** Élément factice minimal, avec `querySelector` par identifiant. */
class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this._ids = new Map();
    this._html = "";
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {} };
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.selectedIndex = -1;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._ids.clear(); }
  get options() { return this.children; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  querySelector(sel) {
    if (this._ids.has(sel)) return this._ids.get(sel);
    if (this._fixed?.has(sel)) return this._fixed.get(sel);
    if (sel.startsWith("#") && this._html.includes(`id="${sel.slice(1)}"`)) {
      const el = new FakeEl("button");
      this._ids.set(sel, el);
      return el;
    }
    for (const c of [...this.children, ...(this._fixed?.values() || [])]) {
      const found = c.querySelector ? c.querySelector(sel) : null;
      if (found) return found;
    }
    return null;
  }
  querySelectorAll() { return []; }
  async click() { for (const fn of this.listeners.click || []) await fn(); }
}

function makeContainer() {
  const container = new FakeEl("div");
  container._fixed = new Map([
    ["#gds-body", new FakeEl("div")],
    ["#gds-subtitle", new FakeEl("div")],
    ["#gds-state-badge", new FakeEl("div")],
  ]);
  return container;
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** HTML de tous les blocs rendus sous `#gds-body` (les panneaux sont appendés). */
function bodyHtml(container) {
  return container.querySelector("#gds-body").children.map((c) => c.innerHTML).join("\n");
}

const identity = { email: "moi@exemple.test", git_name: "Moi" };
const server = { host: "127.0.0.1", port: "5432", user: "gds", name: "GDS maison" };

beforeEach(() => {
  calls = [];
  globalThis.window = {
    _pilotProjectPath: "G:/projet-test",
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    createElementNS: () => new FakeEl("svg"),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  vi.restoreAllMocks();
});

describe("avertissement GitHub avant le passage au GDS", () => {
  it("projet jamais publié : « Publier » ne fait rien avant confirmation, et parle de GitHub", async () => {
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "not_published", on_server: true });
      if (cmd === "gds_get_config") {
        return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432", gds_local_dir: "" });
      }
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    expect(bodyHtml(container)).toContain('id="gds-publish-github-notice"');
    expect(bodyHtml(container)).toContain("GitHub");

    const publish = container.querySelector("#gds-publish-btn");
    expect(publish, "bouton « Publier » absent").not.toBeNull();
    await publish.click();
    expect(calls, "aucun envoi ne doit partir avant confirmation").not.toContain("gds_add_project");

    const confirm = container.querySelector("#gds-publish-github-confirm");
    expect(confirm, "bouton de confirmation absent").not.toBeNull();
    await confirm.click();
    expect(calls, "l'envoi doit partir après confirmation").toContain("gds_add_project");
  });

  it("projet pas encore ajouté : « Ajouter le projet au GDS » ne fait rien avant confirmation", async () => {
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "error", on_server: false });
      if (cmd === "gds_get_config") {
        return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432", gds_local_dir: "" });
      }
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    expect(bodyHtml(container)).toContain('id="gds-add-github-notice"');
    expect(bodyHtml(container)).toContain("GitHub");

    const add = container.querySelector("#gds-add-btn");
    expect(add, "bouton « Ajouter » absent").not.toBeNull();
    await add.click();
    expect(calls).not.toContain("gds_add_project");

    await container.querySelector("#gds-add-github-confirm").click();
    expect(calls).toContain("gds_add_project");
  });

  it("projet pas encore inscrit : « (Re)créer le raccourci » ne fait rien avant confirmation", async () => {
    // Ce bouton rejoue le MÊME geste que « Ajouter au GDS » : il doit donc
    // passer par le même avertissement GitHub.
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "error", on_server: false });
      if (cmd === "gds_get_config") {
        return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432", gds_local_dir: "" });
      }
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    expect(bodyHtml(container)).toContain('id="gds-relink-github-notice"');

    const relink = container.querySelector("#gds-relink-btn");
    expect(relink, "bouton « (Re)créer le raccourci » absent").not.toBeNull();
    await relink.click();
    expect(calls, "aucun envoi avant confirmation").not.toContain("gds_add_project");

    await container.querySelector("#gds-relink-github-confirm").click();
    expect(calls).toContain("gds_add_project");
  });

  it("projet déjà sur le serveur : aucun avertissement GitHub (pas de répétition)", async () => {
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "error", on_server: true });
      if (cmd === "gds_get_config") {
        return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432", gds_local_dir: "" });
      }
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    const html = bodyHtml(container);
    expect(html).not.toContain("github-notice");
    expect(html).not.toContain("plus lié");

    // Raccourci d'un projet DÉJÀ inscrit : le geste est immédiat (rien de
    // nouveau n'est publié, `origin` est préservé).
    await container.querySelector("#gds-relink-btn").click();
    expect(calls).toContain("gds_add_project");
  });
});

describe("rafraîchissement de l'explorateur après un geste GDS", () => {
  it("synchronisation réussie : `_rebuildTree` est appelé", async () => {
    const rebuilt = vi.fn();
    globalThis.window._pilotGetSidebar = () => ({ _rebuildTree: rebuilt });
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "connected", on_server: true });
      if (cmd === "gds_get_config") return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432" });
      if (cmd === "gds_sync_project") return Promise.resolve({ action: "up-to-date" });
      if (cmd === "gds_sync_status") {
        return Promise.resolve({ enabled: true, last_sync_ok: true, pending: 0, last_conflicts: 0, last_pushed: 0, last_pulled: 0, last_sync_at: null });
      }
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    const sync = container.querySelector("#gds-sync-btn");
    expect(sync, "bouton « Synchroniser » absent").not.toBeNull();
    await sync.click();
    await flush();

    expect(calls).toContain("gds_sync_project");
    expect(rebuilt, "l'explorateur doit être rafraîchi après la synchro").toHaveBeenCalled();
  });

  it("publication réussie : `_rebuildTree` est appelé", async () => {
    const rebuilt = vi.fn();
    globalThis.window._pilotGetSidebar = () => ({ _rebuildTree: rebuilt });
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "not_published", on_server: true });
      if (cmd === "gds_get_config") return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432" });
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      if (cmd === "gds_add_project") return Promise.resolve({ initialized: false });
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    await container.querySelector("#gds-publish-btn").click();
    await container.querySelector("#gds-publish-github-confirm").click();
    await flush();

    expect(rebuilt, "l'explorateur doit être rafraîchi après la publication").toHaveBeenCalled();
  });
});
