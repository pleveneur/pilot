// Tests — tabs.js : aiguillage des onglets de la refonte GDS.
//
// Contrat vérifié : `openFile` route les modes `gds`, `gds-admin` et
// `gds-params` vers leurs ouvreurs dédiés (avec le libellé par défaut quand
// aucun n'est fourni), et `_openGdsAdmin` / `_openGdsParams` RÉUTILISENT
// l'onglet transverse déjà ouvert au lieu d'en créer un second.
//
// Régression visée : un mode renommé ou une branche d'aiguillage supprimée
// ferait retomber l'appel dans la branche « fichier » (accès `this.tabs`) ou
// ouvrirait deux écrans d'administration en parallèle.

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

import { TabsManager } from "./tabs.js";

describe("openFile — aiguillage des onglets GDS (refonte)", () => {
  it("mode gds-admin → _openGdsAdmin avec le libellé par défaut", async () => {
    const _openGdsAdmin = vi.fn(async () => {});
    await TabsManager.prototype.openFile.call({ _openGdsAdmin }, "", "gds-admin");
    expect(_openGdsAdmin).toHaveBeenCalledWith("GDS Serveur");
  });

  it("mode gds-admin → libellé explicite conservé (appel de main.js)", async () => {
    const _openGdsAdmin = vi.fn(async () => {});
    await TabsManager.prototype.openFile.call({ _openGdsAdmin }, "GDS Serveur", "gds-admin");
    expect(_openGdsAdmin).toHaveBeenCalledWith("GDS Serveur");
  });

  it("mode gds-params → _openGdsParams avec le libellé par défaut", async () => {
    const _openGdsParams = vi.fn(async () => {});
    await TabsManager.prototype.openFile.call({ _openGdsParams }, "", "gds-params");
    expect(_openGdsParams).toHaveBeenCalledWith("GDS — paramétrage");
  });

  it("mode gds → _openGds (onglet par projet) avec le libellé par défaut", async () => {
    const _openGds = vi.fn(async () => {});
    await TabsManager.prototype.openFile.call({ _openGds }, "", "gds");
    expect(_openGds).toHaveBeenCalledWith("GDS");
  });
});

describe("_openGdsAdmin / _openGdsParams — onglet transverse unique", () => {
  it("_openGdsAdmin réutilise l'onglet déjà ouvert (aucun second écran)", async () => {
    const ctx = { tabs: [{ id: 7, mode: "gds-admin" }], switchTab: vi.fn() };

    await TabsManager.prototype._openGdsAdmin.call(ctx, "GDS Serveur");

    expect(ctx.switchTab).toHaveBeenCalledWith(7);
    expect(ctx.switchTab).toHaveBeenCalledTimes(1);
    expect(ctx.tabs.length).toBe(1);
  });

  it("_openGdsParams réutilise l'onglet déjà ouvert (aucun second écran)", async () => {
    const ctx = { tabs: [{ id: 3, mode: "gds-params" }], switchTab: vi.fn() };

    await TabsManager.prototype._openGdsParams.call(ctx, "GDS — paramétrage");

    expect(ctx.switchTab).toHaveBeenCalledWith(3);
    expect(ctx.switchTab).toHaveBeenCalledTimes(1);
    expect(ctx.tabs.length).toBe(1);
  });
});
