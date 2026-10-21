// updater-refresh.test.js — le contrôle des mises à jour ne dépend plus d'un
// seul instant.
//
// Constat (rapport-maj-non-detectee.md) : `initUpdater()` ne programmait QU'UN
// `setTimeout` de 10 s. Une version publiée après le démarrage de Pilot
// n'était donc jamais vue tant que l'application restait ouverte, et une
// erreur de contrôle ne laissait aucune trace visible (« à jour » et « échec »
// étaient indiscernables).
//
// Ce fichier échoue sur l'ancien code (un seul appel à `check()` dans le
// temps) et passe sur le code corrigé.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.35" }));
vi.mock("./toast.js", () => ({
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("./preview.js", () => ({ renderMarkdown: (s) => String(s) }));

// Fenêtre / document simulés (environnement node) : on capture les écouteurs
// pour pouvoir déclencher un retour au premier plan.
const windowListeners = {};
const docListeners = {};

const HOUR = 60 * 60 * 1000;

let updater;

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
  checkMock.mockResolvedValue(null); // aucune mise à jour disponible
  for (const k of Object.keys(windowListeners)) delete windowListeners[k];
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  globalThis.window = {
    addEventListener: (type, fn) => {
      (windowListeners[type] ||= []).push(fn);
    },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (type, fn) => {
      (docListeners[type] ||= []).push(fn);
    },
  };
  vi.useFakeTimers();
  updater = await import("./updater.js");
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.document;
});

describe("initUpdater — plus d'un contrôle dans le temps", () => {
  it("contrôle au démarrage puis à chaque reprise périodique (6 h)", async () => {
    updater.initUpdater();

    // Rien avant le délai de démarrage (l'ouverture n'est pas ralentie).
    expect(checkMock).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(10000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // AVANT correctif : plus jamais de contrôle (total figé à 1).
    await vi.advanceTimersByTimeAsync(updater.REFRESH_INTERVAL_MS);
    expect(checkMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(updater.REFRESH_INTERVAL_MS);
    expect(checkMock).toHaveBeenCalledTimes(3);
  });

  it("contrôle aussi au retour de l'application au premier plan", async () => {
    updater.initUpdater();
    await vi.advanceTimersByTimeAsync(10000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    expect(typeof windowListeners.focus?.[0]).toBe("function");
    windowListeners.focus[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkMock).toHaveBeenCalledTimes(2);

    // Onglet caché : aucun contrôle inutile.
    globalThis.document.visibilityState = "hidden";
    docListeners.visibilitychange?.[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it("ne programme qu'un seul jeu de contrôles (idempotent)", async () => {
    updater.initUpdater();
    updater.initUpdater();
    await vi.advanceTimersByTimeAsync(10000);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("ne lance jamais deux contrôles en même temps (anti-rebond _checking)", async () => {
    let release;
    checkMock.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(null); })
    );
    updater.initUpdater();
    await vi.advanceTimersByTimeAsync(10000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // Deux déclencheurs pendant que le contrôle est en cours.
    windowListeners.focus[0]();
    windowListeners.focus[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkMock).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("dernier contrôle — « à jour » et « échec » ne sont jamais confondus", () => {
  it("aucun contrôle effectué : le dit explicitement", () => {
    expect(updater.getLastCheckStatus()).toBeNull();
    expect(updater.formatLastCheckStatus()).toMatch(/aucun contrôle effectué/i);
  });

  it("contrôle réussi : date + « Pilot est à jour »", async () => {
    await updater.checkForUpdate(true);
    const status = updater.getLastCheckStatus();
    expect(status.outcome).toBe("up-to-date");
    const label = updater.formatLastCheckStatus();
    expect(label).toMatch(/Pilot est à jour/);
    expect(label).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("contrôle en échec : dit ÉCHEC + la cause, et garde la date du dernier succès", async () => {
    await updater.checkForUpdate(true); // un succès d'abord
    checkMock.mockRejectedValueOnce(new Error("network error: could not connect"));

    await updater.checkForUpdate(true);

    const status = updater.getLastCheckStatus();
    expect(status.outcome).toBe("error");
    const label = updater.formatLastCheckStatus();
    expect(label).toMatch(/échec/i);
    expect(label).toMatch(/pas de connexion/i);
    expect(label).toMatch(/PAS pu savoir/i);
    expect(label).toMatch(/Dernier contrôle réussi/i);
    expect(label).not.toMatch(/Pilot est à jour\./);
  });
});
