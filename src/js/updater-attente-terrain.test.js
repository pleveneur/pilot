// updater-attente-terrain.test.js — une mise à jour EN ATTENTE a la PRIORITÉ sur
// la relance AUTOMATIQUE du travail.
//
// Cas constaté (poste du propriétaire, 2026-10-23, version publiée 0.4.42) :
// la mise à jour était bien détectée, annoncée par un toast et rappelée dans la
// barre de statut (« en attente à la fin du travail en cours »), mais elle ne
// s'installait JAMAIS. Aucun dossier `%TEMP%\Pilot-0.4.42-updater-*` n'existait :
// le chemin d'installation n'avait jamais été parcouru, donc l'écran de mise à
// jour ne s'était jamais affiché. Cause : la chaîne d'agents relance la mission
// suivante dans la même foulée que la fin d'une run ; le terrain n'est jamais
// libre les 10 s d'affilée que demande le réexamen (`main.js`), et une mise à
// jour « en attente » n'arrêtait pas cette relance (seule une réservation DÉJÀ
// posée l'arrêtait).
//
// Correctif : `isUpdateWaitingForGround()` (updater.js, source unique) est
// consultée par les deux relances AUTOMATIQUES — mission sortie de file
// (`launchQueuedMission`) et délégation en file (`flushDelegationQueue`) : elles
// gardent la demande en file ET déclenchent l'écran, puisque le terrain est libre
// à cet instant précis.
//
// Ces tests ÉCHOUENT sur le code d'avant le correctif.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.41" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("./toast.js", () => ({
  showToast: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("./preview.js", () => ({ renderMarkdown: (s) => String(s) }));

const ICI = dirname(fileURLToPath(import.meta.url));
const source = (nom) => readFileSync(join(ICI, nom), "utf8").replace(/\r\n/g, "\n");

/** Élément DOM minimal (classList + écouteurs + style/textContent). */
function fakeEl(initialementCache = false) {
  const classes = new Set(initialementCache ? ["hidden"] : []);
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
  globalThis.document = {
    visibilityState: "visible",
    getElementById: (id) => map[id] || null,
    addEventListener: () => {},
  };
  return map;
}

const modalVisible = () => !els["update-modal"].classList.contains("hidden");

function miseAJour(version) {
  return {
    available: true,
    version,
    date: "2026-10-23T13:18:10Z",
    body: `## v${version}\n\nnotes`,
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  };
}

let updater;

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
  globalThis.window = { addEventListener: () => {} };
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  els = buildDom();
  updater = await import("./updater.js");
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe("Attente de terrain — la mise à jour attend son tour, sans être affamée", () => {
  it("sans mise à jour mémorisée, rien n'attend", () => {
    expect(updater.isUpdateWaitingForGround()).toBe(false);
  });

  it("travail en cours : rien ne s'affiche et l'attente est DÉCLARÉE (elle obtient la priorité)", async () => {
    updater.setUpdateWorkProbe(async () => true);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false); // le travail n'est jamais interrompu
    // AVANT correctif, cette attente n'était pas consultable : la relance
    // automatique de la mission suivante n'avait aucun moyen de la voir.
    expect(updater.isUpdateWaitingForGround()).toBe(true);
    expect(updater.getPendingUpdateWindow().pending).toBe(true);
  });

  it("terrain libre : l'écran s'affiche, plus rien n'attend (le terrain est réservé)", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(true);
    expect(updater.getPendingUpdateWindow().reserved).toBe(true);
    expect(updater.isUpdateWaitingForGround()).toBe(false);
  });

  it("« Plus tard » : l'attente cesse, la relance automatique repart (aucun blocage)", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);

    els["btn-update-later"].__click();

    expect(modalVisible()).toBe(false);
    expect(updater.getPendingUpdateWindow().reserved).toBe(false);
    // La version reportée ne doit JAMAIS retenir la chaîne d'agents.
    expect(updater.isUpdateWaitingForGround()).toBe(false);
  });

  it("une sonde en échec n'invente ni travail ni priorité (fail-closed côté affichage)", async () => {
    updater.setUpdateWorkProbe(async () => {
      throw new Error("sonde indisponible");
    });
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false); // on ne coupe jamais un travail sur une erreur
    expect(updater.isUpdateWaitingForGround()).toBe(true); // mais l'attente reste visible
  });
});

describe("Câblage — les deux relances AUTOMATIQUES cèdent la place à la mise à jour", () => {
  it("mission sortie de file : le garde précède le lancement et déclenche l'écran", () => {
    const src = source("super-agent.js");
    const debut = src.indexOf("function launchQueuedMission(target, entry) {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("// Point de suivi 344 (volet c) — points d'entrée de TEST", debut));

    const gardeAttente = corps.indexOf("if (isUpdateWaitingForGround()) {");
    const lancement = corps.indexOf("entry.launch({ dequeue: true })");
    expect(gardeAttente).toBeGreaterThan(-1);
    expect(lancement).toBeGreaterThan(-1);
    expect(gardeAttente).toBeLessThan(lancement);

    // La mission n'est pas perdue : elle reste EN TÊTE de file, rejeu réarmé.
    const bloc = corps.slice(gardeAttente, lancement);
    expect(bloc).toContain("unshift(entry)");
    expect(bloc).toContain("armQueueReplay(target)");
    // …et l'écran est déclenché MAINTENANT (le terrain est libre à cet instant).
    expect(bloc).toContain("recheckPendingUpdateWindow()");
  });

  it("délégation en file : le garde précède la consommation de la file et déclenche l'écran", () => {
    const src = source("super-agent.js");
    const debut = src.indexOf("function flushDelegationQueue(projectPath) {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("function ", debut + 10));

    const gardeAttente = corps.indexOf("if (isUpdateWaitingForGround()) {");
    const consommation = corps.indexOf("ds.queue.shift()");
    expect(gardeAttente).toBeGreaterThan(-1);
    expect(consommation).toBeGreaterThan(-1);
    expect(gardeAttente).toBeLessThan(consommation);

    const bloc = corps.slice(gardeAttente, consommation);
    expect(bloc).toContain("armDelegationQueueReplay(projectPath)");
    expect(bloc).toContain("recheckPendingUpdateWindow()");
  });

  it("la règle de l'attente n'existe qu'à UN endroit (updater.js), jamais recopiée", () => {
    const updaterSrc = source("updater.js");
    expect((updaterSrc.match(/export function isUpdateWaitingForGround\(/g) || []).length).toBe(1);

    for (const fichier of ["super-agent.js", "agents-bus.js", "main.js", "run-policy.js"]) {
      const src = source(fichier);
      // Aucune copie de la règle : on consulte, on ne recopie pas les conditions.
      expect(/export function isUpdateWaitingForGround\(/.test(src)).toBe(false);
      expect(/_dismissedVersion/.test(src)).toBe(false);
    }
  });
});
