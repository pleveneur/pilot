// updater-attente-terrain.test.js — une mise à jour DISPONIBLE n'a plus AUCUNE
// priorité sur le travail, et ne retarde plus la relance automatique.
//
// Historique (à ne pas régresser) :
//  - 2026-10-23 (version 0.4.42) : l'écran de mise à jour n'apparaissait jamais
//    parce qu'il exigeait 10 s de terrain libre d'affilée ; un correctif lui
//    avait donné la PRIORITÉ sur les relances automatiques (mission sortie de
//    file, délégation en file) : `isUpdateWaitingForGround()` faisait garder la
//    demande en file et déclenchait l'écran.
//  - 2026-11 (décision du propriétaire) : la décision de mise à jour doit être
//    NON BLOQUANTE et RÉVERSIBLE. L'écran de mise à jour OUVERT ne réserve plus
//    le terrain (seule une INSTALLATION le réserve) : il n'a donc plus besoin de
//    « prendre la place » de quoi que ce soit. `isUpdateWaitingForGround` est
//    RETIRÉE et les deux relances automatiques ne lui cèdent plus la place : une
//    mission sortie de file démarre immédiatement.
//
// La partie « installation » (le terrain reste réservé pendant l'installation)
// est couverte, inchangée, par `update-window.test.js` § c.

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
    "status-update-waiting",
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
let policy;

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
  globalThis.window = { addEventListener: () => {} };
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  els = buildDom();
  updater = await import("./updater.js");
  policy = await import("./run-policy.js");
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe("Attente de terrain — l'écran attend son tour sans jamais bloquer", () => {
  it("sans mise à jour mémorisée, rien n'attend", () => {
    expect(updater.getPendingUpdateWindow().pending).toBe(false);
  });

  it("travail en cours : rien ne s'affiche (le travail n'est pas interrompu), l'attente reste visible", async () => {
    updater.setUpdateWorkProbe(async () => true);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false);
    expect(updater.getPendingUpdateWindow().pending).toBe(true);
    // Le rappel de la barre de statut dit que la mise à jour attend.
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
    expect(els["status-update-waiting"].textContent).toContain("0.4.42");
  });

  it("terrain libre : l'écran s'affiche et N'OCCUPE PLUS le terrain", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(true);
    // AVANT correctif : la réservation était posée ici, donc tout le travail
    // était refusé tant que l'écran restait ouvert.
    expect(updater.getPendingUpdateWindow().reserved).toBe(false);
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(policy.canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);
  });

  it("« Plus tard » : rien ne bloque et l'écran reste rouvrable", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(miseAJour("0.4.42"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);

    els["btn-update-later"].__click();

    expect(modalVisible()).toBe(false);
    expect(updater.getPendingUpdateWindow().reserved).toBe(false);
    expect(policy.canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);

    // …et l'écran se rouvre À LA DEMANDE (l'information n'est jamais perdue).
    await updater.reopenPendingUpdateWindow();
    expect(modalVisible()).toBe(true);
  });

  it("une sonde en échec n'invente ni travail ni blocage (fail-closed côté affichage)", async () => {
    updater.setUpdateWorkProbe(async () => {
      throw new Error("sonde indisponible");
    });
    checkMock.mockResolvedValue(miseAJour("0.4.42"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false); // on ne coupe jamais un travail sur une erreur
    expect(updater.getPendingUpdateWindow().reserved).toBe(false); // mais rien n'est bloqué
  });
});

describe("Câblage — les relances AUTOMATIQUES ne cèdent plus la place à la mise à jour", () => {
  it("mission sortie de file : le garde du TERRAIN reste, le garde d'attente a disparu", () => {
    const src = source("super-agent.js");
    const debut = src.indexOf("function launchQueuedMission(target, entry) {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("// Point de suivi 344 (volet c) — points d'entrée de TEST", debut));

    // Le garde du terrain (vérification/installation du moteur `pi`) est INTACT.
    const gardeTerrain = corps.indexOf("if (isTerrainReserved()) {");
    const lancement = corps.indexOf("entry.launch({ dequeue: true })");
    expect(gardeTerrain).toBeGreaterThan(-1);
    expect(lancement).toBeGreaterThan(-1);
    expect(gardeTerrain).toBeLessThan(lancement);
    // La mission n'est jamais perdue quand le terrain est réservé.
    const bloc = corps.slice(gardeTerrain, lancement);
    expect(bloc).toContain("unshift(entry)");
    expect(bloc).toContain("armQueueReplay(target)");

    // Plus AUCUNE priorité de mise à jour : ni consultation, ni déclenchement.
    expect(corps).not.toContain("isUpdateWaitingForGround");
    expect(corps).not.toContain("recheckPendingUpdateWindow");
  });

  it("délégation en file : le garde du terrain reste, le garde d'attente a disparu", () => {
    const src = source("super-agent.js");
    const debut = src.indexOf("function flushDelegationQueue(projectPath) {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("function ", debut + 10));

    const consommation = corps.indexOf("ds.queue.shift()");
    expect(consommation).toBeGreaterThan(-1);
    expect(corps).not.toContain("isUpdateWaitingForGround");
    expect(corps).not.toContain("recheckPendingUpdateWindow");
  });

  it("la priorité d'attente n'existe PLUS nulle part (retirée, jamais recopiée)", () => {
    const updaterSrc = source("updater.js");
    expect(updaterSrc).not.toContain("export function isUpdateWaitingForGround");
    expect(updaterSrc).not.toContain("isUpdateWaitingForGround(");

    for (const fichier of ["super-agent.js", "agents-bus.js", "main.js", "run-policy.js"]) {
      const src = source(fichier);
      expect(src).not.toContain("isUpdateWaitingForGround");
      expect(/_dismissedVersion/.test(src)).toBe(false);
    }
  });
});
