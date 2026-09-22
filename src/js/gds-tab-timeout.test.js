// Tests — onglet « 🌐 GDS » (src/js/gds.js) : le corps de l'onglet ne doit
// JAMAIS rester vide quand une commande ne se règle pas (défaut corrigé :
// en-tête + « Projet : … », corps vide, aucun bouton « Activer GDS »).
//
// DOM minimal maison (aucune dépendance ajoutée) : suffisant pour createGds().
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createGds,
  fetchGdsConnectionStatus,
  GDS_CONNECTION_TIMEOUT_MS,
} from "./gds.js";

let invokeImpl = () => Promise.resolve(null);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.title = "";
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
    this._byId = new Map();
  }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  querySelector(sel) { return this._byId.get(sel) || null; }
  querySelectorAll() { return []; }
}

/** Conteneur factice : les 3 éléments retrouvés par createGds(). */
function makeContainer() {
  const container = new FakeEl("div");
  const body = new FakeEl("div");
  container._byId.set("#gds-body", body);
  container._byId.set("#gds-subtitle", new FakeEl("div"));
  container._byId.set("#gds-state-badge", new FakeEl("div"));
  return { container, body };
}

beforeEach(() => {
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
  };
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("onglet GDS — aucune commande ne doit laisser le corps vide", () => {
  it("une commande qui ne se règle JAMAIS ne laisse pas le corps vide (surface puis message actionnable)", async () => {
    vi.useFakeTimers();
    invokeImpl = (cmd) => {
      // La commande qui ne répond jamais : promesse jamais réglée.
      if (cmd === "gds_connection_status") return new Promise(() => {});
      if (cmd === "gds_identity_prefs") return Promise.resolve({ email: "", git_name: "" });
      return Promise.resolve(null);
    };
    const { container, body } = makeContainer();
    createGds(container);

    // (1) AVANT toute commande : une surface d'attente, jamais un corps vide.
    expect(body.innerHTML).toContain("Vérification de la connexion");

    // (2) La borne expire → message actionnable + moyen de réessayer.
    await vi.advanceTimersByTimeAsync(GDS_CONNECTION_TIMEOUT_MS + 10);
    expect(body.innerHTML).toContain("ne répond pas");
    expect(body.innerHTML).toContain("Réessayer");
    expect(body.innerHTML).toContain("gds-retry");
  });

});

describe("fetchGdsConnectionStatus — attente bornée", () => {
  it("une promesse qui ne se règle jamais rend timedOut (jamais d'attente infinie)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = Date.now();
    const res = await fetchGdsConnectionStatus(() => new Promise(() => {}), "P", 30);
    expect(res.timedOut).toBe(true);
    expect(res.status).toBe("error");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("transmet un état normal", async () => {
    const res = await fetchGdsConnectionStatus(
      () => Promise.resolve({ status: "connected", on_server: true }),
      "P",
      1000
    );
    expect(res).toMatchObject({ status: "connected", on_server: true, timedOut: false });
  });

  it("rattrape un rejet (fail-open, jamais de promesse non réglée)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetchGdsConnectionStatus(() => Promise.reject(new Error("boom")), "P", 1000);
    expect(res.timedOut).toBe(false);
    expect(res.status).toBe("error");
  });
});
