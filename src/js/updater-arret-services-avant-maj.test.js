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

const { checkMock, invokeMock, relaunchMock, toastErrorMock, showToastMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  invokeMock: vi.fn(),
  relaunchMock: vi.fn(async () => {}),
  toastErrorMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a) => checkMock(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunchMock() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.38" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock("./toast.js", () => ({
  showToast: (...a) => showToastMock(...a),
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
  showToastMock.mockReset();
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
    // L'arrêt peut être capturé (`arretServices = await …`) pour permettre le
    // message d'échec de l'installation : seule la PRÉSENCE et l'ORDRE comptent.
    const arret = corps.indexOf("arreterServicesAvantMaj(");
    const installation = corps.indexOf("await update.install()");
    expect(telechargement).toBeGreaterThan(-1);
    expect(arret).toBeGreaterThan(-1);
    expect(installation).toBeGreaterThan(-1);
    expect(telechargement).toBeLessThan(arret);
    expect(arret).toBeLessThan(installation);
  });
});

// ── Point 1 : la réponse de l'arrêt n'est plus ignorée ──────────────────────
// Avant : `await invoke(...)` sans lire la réponse → un service qui refuse de
// mourir était invisible (et la mise à jour échouait ensuite sans explication).
describe("d. La réponse de l'arrêt est lue, service par service", () => {
  it("rend l'état des deux services quand tout a été arrêté", async () => {
    const etat = await updater.arreterServicesAvantMaj();
    expect(etat).toEqual({
      ok: true,
      plfaceStopped: true,
      layaStopped: true,
      attempted: true,
    });
  });

  it("signale le service qui n'a pas pu être arrêté, sans bloquer l'installation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      events.push(`invoke:${cmd}`);
      return { plfaceStopped: true, layaStopped: false };
    });
    const etat = await updater.arreterServicesAvantMaj();
    expect(etat).toEqual({
      ok: false,
      plfaceStopped: true,
      layaStopped: false,
      attempted: true,
    });
    // Fail-open : l'installation continue malgré l'arrêt incomplet.
    events = [];
    await lancerInstallation();
    expect(events).toEqual([
      "download",
      "invoke:stop_services_before_update",
      "install",
    ]);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("une commande indisponible n'invente pas un arrêt abouti", async () => {
    invokeMock.mockImplementation(async () => {
      throw new Error("commande inconnue");
    });
    const etat = await updater.arreterServicesAvantMaj();
    expect(etat.ok).toBe(false);
    expect(etat.attempted).toBe(false);
  });

  it("une réponse absente ou inattendue ne devient jamais un blocage", async () => {
    expect(updater.lireArretServices(undefined)).toEqual({
      ok: true,
      plfaceStopped: true,
      layaStopped: true,
    });
    expect(updater.lireArretServices({})).toEqual({
      ok: true,
      plfaceStopped: true,
      layaStopped: true,
    });
  });
});

// ── Point 2 : après un échec d'installation, les services ne restent pas
// éteints EN SILENCE ────────────────────────────────────────────────────────
describe("e. Échec de l'installation après l'arrêt des services", () => {
  /** Installe avec un installateur qui échoue (fichier verrouillé). */
  async function lancerInstallationQuiEchoue() {
    const update = makeUpdate();
    update.install = vi.fn(async () => {
      events.push("install");
      throw new Error("erreur d'ouverture du fichier pour écriture");
    });
    checkMock.mockResolvedValue(update);
    await updater.checkForUpdate(true);
    els["btn-update-install"].__click();
    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    return showToastMock.mock.calls.map((c) => String(c[0]));
  }

  it("dit au propriétaire quoi faire quand l'installation échoue après un arrêt réussi", async () => {
    const messages = await lancerInstallationQuiEchoue();
    expect(
      messages.some((m) => /relance Pilot/i.test(m)),
      `consigne attendue, reçue : ${JSON.stringify(messages)}`
    ).toBe(true);
    // Message non bloquant : aucune relance, aucune fenêtre d'alerte.
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("prévient d'abord que le service n'a PAS pu être arrêté (cause réelle des fichiers verrouillés)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      events.push(`invoke:${cmd}`);
      return { plfaceStopped: true, layaStopped: false };
    });
    const messages = await lancerInstallationQuiEchoue();
    expect(
      messages.some((m) => /n'a pas pu être arrêté/i.test(m)),
      `consigne attendue, reçue : ${JSON.stringify(messages)}`
    ).toBe(true);
    expect(messages.some((m) => /relance Pilot/i.test(m))).toBe(false);
  });

  it("aucune consigne quand l'arrêt n'a même pas pu être tenté", async () => {
    // Téléchargement en échec : rien n'a été arrêté, donc rien à redémarrer.
    const update = makeUpdate();
    update.download = vi.fn(async () => {
      events.push("download");
      throw new Error("réseau");
    });
    checkMock.mockResolvedValue(update);
    await updater.checkForUpdate(true);
    els["btn-update-install"].__click();
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(
      showToastMock.mock.calls.map((c) => String(c[0])).filter((m) => /relance/i.test(m))
    ).toEqual([]);
  });

  it("la consigne ne s'affiche pas quand l'installation réussit", async () => {
    await lancerInstallation();
    expect(
      showToastMock.mock.calls.map((c) => String(c[0])).filter((m) => /relance Pilot/i.test(m))
    ).toEqual([]);
  });
});
