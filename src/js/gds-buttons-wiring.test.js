// Tests — branchement des boutons de l'écran GDS du projet (src/js/gds.js).
//
// Défaut corrigé (23/09) : « Activer GDS » et « Retour » apparaissaient mais
// étaient inertes. `renderConnect` s'interrompait à
// `loadSavedServers(serverSelect).then(...)` (la fonction ne renvoyait pas sa
// promesse) → les `addEventListener` des boutons placés PLUS BAS n'étaient
// jamais posés (le panneau, lui, était déjà dans le DOM).
//
// Ce test ÉCHOUE si un bouton de l'écran de connexion/correction redevient
// inerte (aucun écouteur `click` attaché).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGds } from "./gds.js";

let invokeImpl = () => Promise.resolve(null);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
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
  /** `#id` → stub mémorisé (présent dans innerHTML ou dans un enfant). */
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
  // `_fixed` survit à `container.innerHTML = …` (posé par createGds).
  container._fixed = new Map([
    ["#gds-body", new FakeEl("div")],
    ["#gds-subtitle", new FakeEl("div")],
    ["#gds-state-badge", new FakeEl("div")],
  ]);
  return container;
}

/** Laisse tourner les microtâches (rendu asynchrone de refresh()). */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const identity = { email: "moi@exemple.test", git_name: "Moi" };
const server = { host: "127.0.0.1", port: "5432", user: "gds", name: "GDS maison" };

beforeEach(() => {
  globalThis.window = { _pilotProjectPath: "G:/projet-test", addEventListener() {}, removeEventListener() {} };
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

describe("écran GDS du projet — boutons réellement branchés", () => {
  it("projet NON activé : « Activer GDS » porte un écouteur click", async () => {
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "not_configured", on_server: false });
      if (cmd === "gds_get_config") return Promise.resolve({ enabled: false });
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    const activate = container.querySelector("#gds-activate-btn");
    expect(activate, "bouton « Activer GDS » absent de l'écran").not.toBeNull();
    expect(activate.listeners.click?.length || 0).toBeGreaterThan(0);
  });

  it("projet déjà rattaché + « Changer de serveur » : « Activer GDS » et « Retour » branchés", async () => {
    invokeImpl = (cmd) => {
      if (cmd === "gds_identity_prefs") return Promise.resolve(identity);
      if (cmd === "gds_connection_status") return Promise.resolve({ status: "error", on_server: true });
      if (cmd === "gds_get_config") {
        return Promise.resolve({ enabled: true, db_host: "127.0.0.1", db_user: "gds", db_port: "5432", gds_local_dir: "" });
      }
      if (cmd === "gds_secrets_status") return Promise.resolve({ db_password: true, admin_password: true });
      if (cmd === "gds_list_saved_servers") return Promise.resolve([server]);
      return Promise.resolve(null);
    };
    const container = makeContainer();
    createGds(container);
    await flush();

    const edit = container.querySelector("#gds-edit-cfg-btn");
    expect(edit, "bouton « Changer de serveur » absent").not.toBeNull();
    await edit.click().catch(() => {}); // avant correctif : renderConnect levait ici
    await flush();

    for (const id of ["#gds-activate-btn", "#gds-edit-back-btn"]) {
      const el = container.querySelector(id);
      expect(el, `bouton ${id} absent`).not.toBeNull();
      expect(el.listeners.click?.length || 0, `bouton ${id} inerte`).toBeGreaterThan(0);
    }
  });
});
