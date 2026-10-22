// updater-arret-services-avant-maj.test.js — GARDE-FOU de la correction des
// fichiers verrouillés à chaque mise à jour (service Laya).
//
// Diagnostic (`.pilot/rapports/rapport-diagnostic-laya-fichiers-verrouilles.md`) :
// le greffon de mise à jour quitte l'application par `std::process::exit(0)`,
// donc l'événement de fermeture propre — le seul qui arrêtait le service Laya —
// n'est JAMAIS émis. L'installateur ne referme que Pilot.exe et écrase les
// fichiers en place : `node.exe` du service et les DLL ONNX, encore mappés, sont
// verrouillés → « erreur d'ouverture du fichier pour écriture ».
//
// Ce fichier verrouille trois choses (il ÉCHOUE sur le code d'avant) :
//   a. l'ORDRE : télécharger → ARRÊTER LES SERVICES → installer (l'arrêt doit
//      précéder l'installateur, pas le suivre ni disparaître) ;
//   b. le FAIL-OPEN : un échec de l'arrêt ne bloque jamais l'installation ;
//   c. la SOURCE : l'installation ne repasse pas par `downloadAndInstall`, qui
//      ne permet pas d'intercaler l'arrêt des services.
//
// Aucun processus n'est lancé ni arrêté : l'appel Rust est simulé.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const { checkMock, invokeMock, relaunchMock, toastErrorMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  invokeMock: vi.fn(),
  relaunchMock: vi.fn(async () => {}),
  toastErrorMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a) => checkMock(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunchMock() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.38" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock("./toast.js", () => ({
  showToast: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: (...a) => toastErrorMock(...a),
}));
vi.mock("./preview.js", () => ({ renderMarkdown: (s) => String(s) }));

// Ordre réel des étapes de l'installation, tel que l'utilisateur le subit.
let events = [];

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

let els;

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
    addEventListener: () => {},
  };
  return map;
}

/** Une mise à jour disponible : chaque étape est observée dans `events`. */
function makeUpdate() {
  return {
    available: true,
    version: "0.4.39",
    date: "2026-10-22T10:00:00Z",
    body: "## v0.4.39\n\nnotes",
    download: vi.fn(async () => {
      events.push("download");
    }),
    install: vi.fn(async () => {
      events.push("install");
    }),
  };
}

let updater;

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
  invokeMock.mockReset();
  relaunchMock.mockReset();
  toastErrorMock.mockReset();
  events = [];
  invokeMock.mockImplementation(async (cmd) => {
    events.push(`invoke:${cmd}`);
    return { plfaceStopped: true, layaStopped: true };
  });
  globalThis.window = { addEventListener: () => {} };
  // Aucun appel réseau réel (historique des releases).
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  els = buildDom();
  updater = await import("./updater.js");
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

/** Ouvre la fenêtre de mise à jour puis lance l'installation (clic). */
async function lancerInstallation() {
  checkMock.mockResolvedValue(makeUpdate());
  await updater.checkForUpdate(true);
  els["btn-update-install"].__click();
  await vi.waitFor(() => {
    expect(events).toContain("install");
  });
}

describe("a. Ordre des étapes — l'arrêt des services précède l'installateur", () => {
  it("télécharge, arrête le service Laya (et PLface), puis installe", async () => {
    await lancerInstallation();
    expect(events).toEqual([
      "download",
      "invoke:stop_services_before_update",
      "install",
    ]);
    // L'installation est bien allée au bout (relance demandée).
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});

describe("b. Fail-open — l'arrêt ne bloque jamais la mise à jour", () => {
  it("un échec de l'arrêt des services laisse l'installation se poursuivre", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      events.push(`invoke:${cmd}`);
      throw new Error("service déjà arrêté");
    });
    await lancerInstallation();
    expect(events).toEqual([
      "download",
      "invoke:stop_services_before_update",
      "install",
    ]);
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("un échec du téléchargement n'arrête AUCUN service", async () => {
    const update = makeUpdate();
    update.download = vi.fn(async () => {
      events.push("download");
      throw new Error("réseau");
    });
    checkMock.mockResolvedValue(update);
    await updater.checkForUpdate(true);
    els["btn-update-install"].__click();
    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
    });
    expect(events).toEqual(["download"]); // ni arrêt, ni installation
  });
});

describe("c. Source — pas de retour à `downloadAndInstall`", () => {
  it("updater.js appelle l'arrêt des services entre le téléchargement et l'installation", () => {
    const SRC = readFileSync(new URL("./updater.js", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n"
    );
    expect(SRC).not.toMatch(/downloadAndInstall/);
    // On se limite au corps de `installUpdate` (l'aide `arreterServicesAvantMaj`
    // est définie plus haut dans le fichier).
    const debut = SRC.indexOf("async function installUpdate(");
    expect(debut).toBeGreaterThan(-1);
    const corps = SRC.slice(debut);
    const telechargement = corps.indexOf("await update.download(");
    const arret = corps.indexOf("await arreterServicesAvantMaj();");
    const installation = corps.indexOf("await update.install()");
    expect(telechargement).toBeGreaterThan(-1);
    expect(arret).toBeGreaterThan(-1);
    expect(installation).toBeGreaterThan(-1);
    expect(telechargement).toBeLessThan(arret);
    expect(arret).toBeLessThan(installation);
  });
});
