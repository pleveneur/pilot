// updater-fenetre-maj.test.js — la fenêtre de mise à jour ne revient plus
// malgré « Plus tard », une seule installation peut tourner, et la commande
// manuelle répond toujours quelque chose.
//
// Constats de la relecture (rapport-relecture-maj.md, défauts 1 et 2) :
//  - `closeModal()` ne mémorisait RIEN : après « Plus tard », le contrôle
//    récurrent réaffichait la fenêtre à chaque retour au premier plan ;
//  - un contrôle de fond pendant une installation remettait
//    `installBtn.disabled = false` et masquait la progression, et
//    `installUpdate` n'avait aucun garde de réentrance → seconde installation
//    possible ;
//  - « Vérifier les mises à jour » ne disait RIEN si un contrôle tournait déjà.
//
// Ces tests ÉCHOUENT sur le code d'avant les correctifs.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { checkMock, showToastMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.35" }));
vi.mock("./toast.js", () => ({
  showToast: (...args) => showToastMock(...args),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("./preview.js", () => ({ renderMarkdown: (s) => String(s) }));

const windowListeners = {};
const docListeners = {};

let els;
let updater;

/** Élément DOM minimal (classList + écouteurs + style/textContent). */
function fakeEl(initiallyHidden = false) {
  const classes = new Set(initiallyHidden ? ["hidden"] : []);
  const handlers = {};
  const el = {
    style: {},
    textContent: "",
    innerHTML: "",
    disabled: false,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener: (type, fn) => {
      (handlers[type] ||= []).push(fn);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    __classes: classes,
    __handlers: handlers,
    __click() {
      for (const fn of handlers.click || []) fn({ target: el });
    },
  };
  return el;
}

function buildDom() {
  const ids = [
    "update-version",
    "update-date",
    "update-notes",
    "btn-update-install",
    "btn-update-later",
    "update-close",
    "update-progress-fill",
    "update-progress-label",
  ];
  const map = {};
  for (const id of ids) map[id] = fakeEl();
  const modal = fakeEl(true); // la fenêtre est fermée au départ
  const progress = fakeEl(true);
  modal.querySelector = (sel) => (sel === ".update-progress" ? progress : null);
  map["update-modal"] = modal;
  map.__progress = progress;

  globalThis.document = {
    visibilityState: "visible",
    getElementById: (id) => map[id] || null,
    addEventListener: (type, fn) => {
      (docListeners[type] ||= []).push(fn);
    },
  };
  return map;
}

/** Une mise à jour disponible, avec une installation contrôlable par le test. */
function makeUpdate(version, downloadAndInstall = vi.fn(() => new Promise(() => {}))) {
  return { available: true, version, date: "2026-10-21T10:00:00Z", body: `## v${version}\n\nnotes`, downloadAndInstall };
}

const modalVisible = () => !els["update-modal"].classList.contains("hidden");

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
  showToastMock.mockReset();
  for (const k of Object.keys(windowListeners)) delete windowListeners[k];
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  globalThis.window = {
    addEventListener: (type, fn) => {
      (windowListeners[type] ||= []).push(fn);
    },
  };
  // Aucun appel réseau réel (historique des releases).
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  els = buildDom();
  vi.useFakeTimers();
  updater = await import("./updater.js");
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe("Défaut 1 — « Plus tard » est mémorisé", () => {
  it("la fenêtre ne revient pas après un « Plus tard » (même version)", async () => {
    checkMock.mockResolvedValue(makeUpdate("0.4.40"));

    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);

    // L'utilisateur reporte.
    els["btn-update-later"].__click();
    expect(modalVisible()).toBe(false);

    // Contrôle récurrent (retour au premier plan / 6 h) : même version.
    await updater.checkForUpdate(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(modalVisible()).toBe(false); // AVANT correctif : réapparaissait

    // Un contrôle de plus ne la fait pas revenir non plus.
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(false);
  });

  it("une version DIFFÉRENTE est toujours proposée", async () => {
    checkMock.mockResolvedValue(makeUpdate("0.4.40"));
    await updater.checkForUpdate(true);
    els["update-close"].__click();
    expect(modalVisible()).toBe(false);

    checkMock.mockResolvedValue(makeUpdate("0.4.41"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);
    expect(els["update-version"].textContent).toBe("v0.4.41");
  });
});

describe("Défaut 2 — une seule installation à la fois", () => {
  it("un contrôle de fond pendant l'installation ne réinitialise rien, et un second clic ne lance rien", async () => {
    let releaseInstall;
    const installPromise = new Promise((resolve) => {
      releaseInstall = resolve;
    });
    const downloadAndInstall = vi.fn(async () => {
      await installPromise;
    });

    checkMock.mockResolvedValue(makeUpdate("0.4.40", downloadAndInstall));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);

    // Premier clic : l'installation démarre.
    els["btn-update-install"].__click();
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(els["btn-update-install"].disabled).toBe(true);
    expect(els.__progress.classList.contains("hidden")).toBe(false);

    // Un contrôle de fond tombe PENDANT le téléchargement.
    checkMock.mockResolvedValue(makeUpdate("0.4.40", downloadAndInstall));
    await updater.checkForUpdate(true);
    await vi.advanceTimersByTimeAsync(0);

    // AVANT correctif : bouton réactivé + progression masquée.
    expect(els["btn-update-install"].disabled).toBe(true);
    expect(els.__progress.classList.contains("hidden")).toBe(false);

    // Second clic : AUCUNE seconde installation, et l'utilisateur est informé.
    els["btn-update-install"].__click();
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1); // AVANT : 2
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringMatching(/déjà en cours/i),
      "info",
      expect.any(Number)
    );

    // On libère l'installation pour ne pas laisser de promesse en suspens.
    releaseInstall();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("Point mineur — le contrôle manuel répond toujours", () => {
  it("dit qu'un contrôle est déjà en cours au lieu de ne rien faire", async () => {
    let release;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        })
    );

    const running = updater.checkForUpdate(true);
    await vi.advanceTimersByTimeAsync(0);

    // Commande manuelle pendant le contrôle silencieux.
    await updater.checkForUpdate(false);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringMatching(/déjà en cours/i),
      "info",
      expect.any(Number)
    );

    release();
    await running;
  });
});

describe("Point mineur — pas de martèlement sur des retours de fenêtre", () => {
  it("les allers-retours de fenêtres ne produisent pas une requête par retour", async () => {
    checkMock.mockResolvedValue(null);
    updater.initUpdater();
    await vi.advanceTimersByTimeAsync(10000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // Cinq retours au premier plan coup sur coup.
    for (let i = 0; i < 5; i++) {
      windowListeners.focus[0]();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(checkMock).toHaveBeenCalledTimes(1); // AVANT : 6

    // Après l'intervalle minimal, le retour au premier plan contrôle à nouveau.
    await vi.advanceTimersByTimeAsync(updater.FOREGROUND_MIN_INTERVAL_MS);
    windowListeners.focus[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkMock).toHaveBeenCalledTimes(2);
  });
});
