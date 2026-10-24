// update-window.test.js — FENÊTRE RÉSERVÉE de mise à jour (règle du propriétaire).
//
// Contrôles demandés, chacun DOIT mordre si le correctif est neutralisé :
//   a. l'écran de mise à jour ne peut pas apparaître pendant qu'un agent
//      travaille (le travail n'est jamais interrompu) ;
//   b. aucun agent ne peut démarrer pendant que l'écran est affiché ;
//   c. aucun agent ne peut démarrer pendant qu'une mise à jour s'installe ;
//   d. une mise à jour détectée pendant un travail s'affiche D'ELLE-MÊME quand
//      le terrain se libère ;
//   e. pas d'écran fantôme : la règle est revérifiée AU MOMENT D'AFFICHER ;
//   f. la règle et le texte des refus n'existent QU'À UN SEUL endroit, et la
//      décision reste celle du gardien existant (`run-policy.js`) — pas de
//      second gardien concurrent.
//
// Les preuves de neutralisation (a→f) sont décrites dans
// `.pilot/rapports/rapport-maj-pilot-fenetre-reservee.md`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const { checkMock, showToastMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.40" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("./toast.js", () => ({
  showToast: (...args) => showToastMock(...args),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("./preview.js", () => ({ renderMarkdown: (s) => String(s) }));

import {
  UPDATE_WINDOW_REASONS,
  UPDATE_INSTALLING_BLOCKED_MESSAGE,
  __resetUpdateWindowForTest,
  getUpdateWindowReservation,
  isUpdateWindowReserved,
  reserveUpdateWindow,
  releaseUpdateWindow,
  updateWindowBlockedMessage,
} from "./update-window.js";
import {
  MANUAL_COMMAND_BLOCKED_MESSAGE,
  MANUAL_COMMAND_NATURE,
  canSendManualCommand,
  canSendManualCommandAsync,
  canStartWork,
  manualCommandBlockedMessage,
} from "./run-policy.js";

const source = (rel) =>
  readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  __resetUpdateWindowForTest();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. LA RÈGLE, seule (modules purs) — b, c, f
// ─────────────────────────────────────────────────────────────────────────
describe("Règle — la mise à jour réserve le terrain (décideur unique run-policy.js)", () => {
  it("terrain libre : le travail démarre (la réservation ne bloque rien par elle-même)", () => {
    expect(isUpdateWindowReserved()).toBe(false);
    expect(canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);
    expect(manualCommandBlockedMessage()).toBe(MANUAL_COMMAND_BLOCKED_MESSAGE);
  });

  it("b — écran de mise à jour OUVERT : le terrain reste LIBRE (l'écran ne réserve plus rien)", () => {
    // Décision du propriétaire (2026-11) : la décision de mise à jour est
    // RÉVERSIBLE et NON BLOQUANTE. Un écran simplement affiché ne doit empêcher
    // ni l'utilisateur d'envoyer, ni l'assistant de répondre, ni un agent de
    // démarrer. Le motif `WINDOW` est conservé (compatibilité) mais ne réserve
    // plus le terrain.
    const posed = reserveUpdateWindow(UPDATE_WINDOW_REASONS.WINDOW, { version: "0.4.41" });
    expect(posed).toBe("");
    expect(isUpdateWindowReserved()).toBe(false);
    expect(canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(canStartWork("G:\\IA_PL\\pilot", "read", () => false)).toBe(true);
    expect(canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);
    expect(manualCommandBlockedMessage()).toBe(MANUAL_COMMAND_BLOCKED_MESSAGE);
    expect(updateWindowBlockedMessage()).toBe("");
    // La version reste connue (informatif, jamais une décision).
    expect(getUpdateWindowReservation()).toEqual({ reserved: false, reason: "", version: "0.4.41" });
  });

  it("c — INSTALLATION en cours : message distinct (l'utilisateur sait qu'il faut attendre le redémarrage)", () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING, { version: "0.4.41" });
    expect(canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(false);
    expect(manualCommandBlockedMessage()).toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);
    expect(updateWindowBlockedMessage()).toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);
  });

  it("la réservation est RENDUE par `releaseUpdateWindow` (le travail repart tout de suite)", () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);
    expect(canStartWork("projet", "write", () => false)).toBe(false);
    releaseUpdateWindow();
    expect(isUpdateWindowReserved()).toBe(false);
    expect(canStartWork("projet", "write", () => false)).toBe(true);
    expect(updateWindowBlockedMessage()).toBe("");
    expect(manualCommandBlockedMessage()).toBe(MANUAL_COMMAND_BLOCKED_MESSAGE);
  });

  it("n'usurpe pas le motif : un travail en cours sur le projet reste refusé par la politique existante", () => {
    // Aucune réservation : le refus vient de la run en cours (message projet).
    expect(canStartWork("projet", "write", () => true)).toBe(false);
    expect(manualCommandBlockedMessage()).toBe(MANUAL_COMMAND_BLOCKED_MESSAGE);
    // Une LECTURE partage le créneau avec une lecture (règle existante intacte).
    expect(canStartWork("projet", "read", (p, o) => o.nature === "write" && false)).toBe(true);
  });

  it("la commande manuelle asynchrone ne tente AUCUNE levée de verrou pendant la fenêtre réservée", async () => {
    reserveUpdateWindow(UPDATE_WINDOW_REASONS.INSTALLING);
    const releaseStaleLock = vi.fn(async () => {});
    const isAgentBusy = vi.fn(async () => false);
    const allowed = await canSendManualCommandAsync("projet", () => false, isAgentBusy, releaseStaleLock);
    expect(allowed).toBe(false);
    expect(releaseStaleLock).not.toHaveBeenCalled();
    expect(isAgentBusy).not.toHaveBeenCalled();
  });

  it("f — le texte des refus et la réservation n'existent QU'À UN endroit", () => {
    const dir = new URL("./", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
    const carriers = files.filter((f) => {
      const src = readFileSync(new URL(f, dir), "utf8");
      return src.includes("Mise à jour de Pilot : l'écran de mise à jour est ouvert") || src.includes("Mise à jour de Pilot en cours d'installation");
    });
    // Un seul porteur : le module de la règle. Aucun fichier ne recopie le texte.
    expect(carriers).toEqual(["update-window.js"]);
    // Et un seul module décide : aucun autre n'appelle reserveUpdateWindow().
    const reservers = files.filter(
      (f) => f !== "update-window.js" && /reserveUpdateWindow\(/.test(readFileSync(new URL(f, dir), "utf8"))
    );
    expect(reservers).toEqual(["updater.js"]);
    // VERROU : personne ne réserve le terrain pour un écran simplement AFFICHÉ
    // (le motif `WINDOW` ne réserve plus rien ; ce test échoue si un appel
    // `reserveUpdateWindow(…WINDOW…)` réapparaît quelque part).
    const windowReservers = files.filter((f) =>
      /reserveUpdateWindow\(\s*UPDATE_WINDOW_REASONS\.WINDOW/.test(readFileSync(new URL(f, dir), "utf8"))
    );
    expect(windowReservers).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. L'ÉCRAN — a, d, e (updater.js avec un backend simulé)
// ─────────────────────────────────────────────────────────────────────────
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
let updater;
// Références RE-IMPORTÉES après `vi.resetModules()` : ce sont EXACTEMENT les
// instances utilisées par `updater.js` (sinon la règle serait lue dans une copie
// de module, et les preuves ne prouveraient rien).
let win;
let policy;

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
  const modal = fakeEl(true);
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

function makeUpdate(version, steps = {}) {
  return {
    available: true,
    version,
    date: "2026-10-21T10:00:00Z",
    body: `## v${version}\n\nnotes`,
    download: steps.download || vi.fn(async () => {}),
    install: steps.install || vi.fn(async () => {}),
  };
}

const modalVisible = () => !els["update-modal"].classList.contains("hidden");

beforeEach(async () => {
  __resetUpdateWindowForTest();
  vi.resetModules();
  checkMock.mockReset();
  showToastMock.mockReset();
  globalThis.window = { addEventListener: () => {}, _pilotProjectPath: "G:\\IA_PL\\pilot" };
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  els = buildDom();
  vi.useFakeTimers();
  updater = await import("./updater.js");
  win = await import("./update-window.js");
  policy = await import("./run-policy.js");
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
  __resetUpdateWindowForTest();
});

describe("a — l'écran n'apparaît JAMAIS pendant qu'un agent travaille", () => {
  it("travail en cours : rien ne s'affiche (le travail n'est pas interrompu), aucune réservation posée", async () => {
    updater.setUpdateWorkProbe(async () => true); // un agent travaille
    checkMock.mockResolvedValue(makeUpdate("0.4.41"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false); // AVANT correctif : s'affichait
    expect(win.isUpdateWindowReserved()).toBe(false);
    // L'utilisateur est informé, sans être interrompu : un toast, une seule fois.
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(String(showToastMock.mock.calls[0][0])).toContain("0.4.41");
    // Un rappel discret reste visible dans la barre de statut.
    expect(els["status-update-waiting"].textContent).toContain("0.4.41");
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
  });

  it("d — l'écran arrive DE LUI-MÊME dès que le terrain se libère (aucun contrôle à relancer)", async () => {
    let working = true;
    updater.setUpdateWorkProbe(async () => working);
    checkMock.mockResolvedValue(makeUpdate("0.4.41"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(false);

    working = false; // le travail est terminé
    await updater.recheckPendingUpdateWindow();

    expect(modalVisible()).toBe(true);
    expect(els["update-version"].textContent).toBe("v0.4.41");
    // L'écran ne réserve RIEN : on peut travailler pendant qu'il est affiché.
    expect(win.isUpdateWindowReserved()).toBe(false);
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    // Le rappel d'attente disparaît une fois l'écran affiché (l'écran porte
    // désormais l'information) ; il revient si l'écran est écarté.
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(true);
  });

  it("e — pas d'écran fantôme : la règle est revérifiée AU MOMENT D'AFFICHER", async () => {
    // Le premier appel dit « libre », le second « occupé » : le travail a repris
    // entre l'intention d'afficher et l'affichage. L'écran ne doit PAS s'ouvrir.
    let calls = 0;
    updater.setUpdateWorkProbe(async () => {
      calls += 1;
      return calls > 1;
    });
    checkMock.mockResolvedValue(makeUpdate("0.4.41"));

    await updater.checkForUpdate(true);

    expect(calls).toBe(2); // la règle est bien relue juste avant d'afficher
    expect(modalVisible()).toBe(false);
    expect(win.isUpdateWindowReserved()).toBe(false);
  });
});

describe("b — l'écran OUVERT ne bloque plus rien : la décision est réversible", () => {
  it("écran ouvert ⇒ on peut envoyer, l'assistant répond, les agents démarrent", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(makeUpdate("0.4.41"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);

    // AVANT correctif : tous ces chemins étaient refusés tant que l'écran
    // restait ouvert (verrou posé au simple affichage, sans échéance).
    expect(win.isUpdateWindowReserved()).toBe(false);
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(policy.canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);
    expect(policy.manualCommandBlockedMessage()).toBe(MANUAL_COMMAND_BLOCKED_MESSAGE);
    expect(policy.canAssistantReflect()).toBe(true);

    // « Plus tard » ferme l'écran sans rien changer au terrain (déjà libre) et
    // SANS effacer l'information : le rappel de statut reste visible.
    els["btn-update-later"].__click();
    expect(modalVisible()).toBe(false);
    expect(win.isUpdateWindowReserved()).toBe(false);
    expect(policy.canSendManualCommand("G:\\IA_PL\\pilot", () => false)).toBe(true);
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
    expect(els["status-update-waiting"].textContent).toContain("non installée");
  });

  it("✕ (fermeture) libère aussi et laisse le rappel visible", async () => {
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(makeUpdate("0.4.41"));
    await updater.checkForUpdate(true);
    expect(modalVisible()).toBe(true);
    els["update-close"].__click();
    expect(modalVisible()).toBe(false);
    expect(win.isUpdateWindowReserved()).toBe(false);
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
  });
});

describe("c — aucun agent ne démarre pendant l'installation", () => {
  it("l'installation réserve le terrain avec SON motif, et aucune fermeture ne le rend", async () => {
    let releaseInstall;
    const gate = new Promise((res) => {
      releaseInstall = res;
    });
    const install = vi.fn(async () => {
      await gate;
    });
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(makeUpdate("0.4.41", { install }));
    await updater.checkForUpdate(true);

    const clicked = els["btn-update-install"].__click();
    await vi.advanceTimersByTimeAsync(50);

    // Réservation d'INSTALLATION (motif distinct de l'écran ouvert).
    expect(win.getUpdateWindowReservation()).toMatchObject({ reserved: true, reason: "installing" });
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(false);
    expect(policy.manualCommandBlockedMessage()).toBe(UPDATE_INSTALLING_BLOCKED_MESSAGE);

    // Pendant l'installation, « Plus tard »/✕ ne peuvent pas rendre le terrain.
    els["btn-update-later"].__click();
    els["update-close"].__click();
    expect(win.isUpdateWindowReserved()).toBe(true);

    releaseInstall();
    await vi.advanceTimersByTimeAsync(50);
    // Installation ALLÉE AU BOUT (ici : installateur simulé, puis redémarrage) :
    // le terrain reste réservé, aucun agent ne démarre sous l'installateur ni
    // avant le redémarrage de Pilot.
    expect(win.isUpdateWindowReserved()).toBe(true);
  });

  it("installation ÉCHOUÉE : le terrain est rendu (on peut travailler) et le rappel dit « non installée »", async () => {
    const install = vi.fn(async () => {
      throw new Error("installateur indisponible");
    });
    updater.setUpdateWorkProbe(async () => false);
    checkMock.mockResolvedValue(makeUpdate("0.4.41", { install }));
    await updater.checkForUpdate(true);

    els["btn-update-install"].__click();
    await vi.advanceTimersByTimeAsync(50);

    // L'écran reste affiché (on peut réessayer) mais n'occupe plus le terrain :
    // une décision de mise à jour ne doit jamais bloquer le travail.
    expect(modalVisible()).toBe(true);
    expect(win.isUpdateWindowReserved()).toBe(false);
    expect(policy.canStartWork("G:\\IA_PL\\pilot", "write", () => false)).toBe(true);
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
    expect(els["status-update-waiting"].textContent).toContain("non installée");
  });
});
