// Tests — refus de confiance Git du dossier des dépôts (src/js/gds.js).
//
// Constat : le refus RÉELLEMENT observé
// « fatal: detected dubious ownership in repository at 'C:\GDS\repos\Kodali.git' »
// était affiché brut, incompréhensible pour un non-technicien. Il doit devenir
// une phrase simple + un bouton qui déclenche la correction automatique
// (`gds_service_trust`) puis relance le geste ; les autres erreurs
// (authentification) gardent leur message et n'affichent AUCUN bouton.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  friendlyGdsError,
  isTrustRefusal,
  showGdsError,
  TRUST_REFUSAL_MESSAGE,
} from "./gds.js";

let invokeImpl = () => Promise.resolve(null);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

const REAL_DUBIOUS =
  "git push a échoué (remote gds) — fatal: detected dubious ownership in repository " +
  "at 'C:\\GDS\\repos\\Kodali.git' — To add an exception for this directory, call: " +
  "git config --global --add safe.directory C:/GDS/repos/Kodali.git";
const REAL_AUTH =
  "git push a échoué (remote gds) — fatal: Authentication failed for " +
  "'git@gds.example:repos/pilot.git'";

/** Élément factice minimal, avec `querySelector` par identifiant. */
class FakeEl {
  constructor() {
    this.textContent = "";
    this._html = "";
    this._ids = new Map();
    this.listeners = {};
    this.disabled = false;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this._ids.clear(); }
  querySelector(sel) {
    if (this._ids.has(sel)) return this._ids.get(sel);
    if (sel.startsWith("#") && this._html.includes(`id="${sel.slice(1)}"`)) {
      const el = new FakeEl();
      this._ids.set(sel, el);
      return el;
    }
    return null;
  }
  querySelectorAll() { return []; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  async click() { for (const fn of this.listeners.click || []) await fn(); }
}

beforeEach(() => {
  globalThis.window = { _pilotProjectPath: "G:/projet-test" };
  globalThis.document = {
    createElement: () => new FakeEl(),
    createElementNS: () => new FakeEl(),
    querySelectorAll: () => [],
  };
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  vi.restoreAllMocks();
});

describe("refus de confiance Git — phrase simple", () => {
  it("le refus réel est reconnu et traduit en langage simple", () => {
    expect(isTrustRefusal(REAL_DUBIOUS)).toBe(true);
    expect(friendlyGdsError(REAL_DUBIOUS)).toBe(TRUST_REFUSAL_MESSAGE);
  });

  it("un échec d'authentification garde EXACTEMENT son message", () => {
    expect(isTrustRefusal(REAL_AUTH)).toBe(false);
    expect(friendlyGdsError(REAL_AUTH)).toBe(REAL_AUTH);
  });
});

describe("refus de confiance Git — bandeau + bouton de correction", () => {
  it("affiche le bandeau, et le bouton corrige puis relance le geste", async () => {
    const calls = [];
    let retried = 0;
    invokeImpl = (cmd, args) => { calls.push([cmd, args]); return Promise.resolve({ ok: true }); };
    const errEl = new FakeEl();
    showGdsError(errEl, REAL_DUBIOUS, () => { retried++; });

    expect(errEl.innerHTML).toContain("autorisé ce projet");
    const fix = errEl.querySelector("#gds-trust-fix");
    expect(fix, "bouton de correction absent du bandeau").not.toBeNull();

    await fix.click();
    expect(calls.length, "la correction automatique doit être appelée").toBe(1);
    expect(calls[0][0]).toBe("gds_service_trust");
    expect(calls[0][1]).toEqual({ project: "G:/projet-test" });
    expect(retried, "le geste doit être relancé après la correction").toBe(1);
  });

  it("un échec d'authentification n'affiche AUCUN bouton de correction", () => {
    const errEl = new FakeEl();
    showGdsError(errEl, REAL_AUTH, () => {});
    expect(errEl.textContent).toBe(REAL_AUTH);
    expect(errEl.querySelector("#gds-trust-fix")).toBeNull();
  });
});
