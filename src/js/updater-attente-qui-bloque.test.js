// updater-attente-qui-bloque.test.js — le rappel de mise à jour en attente doit
// dire QUI bloque et DEPUIS QUAND.
//
// Cas constaté (rapport `RAPPORT-diag-indicateur-travail.md`, point D.2) : une
// session vivante reste marquée « outil en cours », la sonde `isWorkRunning()`
// répond donc toujours vrai, et le propriétaire voyait un rappel collant
// « ⬆ Mise à jour v0.4.44 en attente (à la fin du travail en cours) » — sans
// jamais savoir QUEL agent ni depuis combien de temps. Le blocage était muet.
//
// Correctif : le texte du rappel nomme l'agent et son projet qui bloquent, avec
// l'ancienneté du travail, à partir des données DÉJÀ présentes dans la liste
// d'activité (aucune requête, aucun sondage supplémentaire). Quand aucune
// information n'est disponible, le texte historique est conservé MOT POUR MOT.
//
// Ces tests ÉCHOUENT sur le code d'avant le correctif (le texte ne contenait ni
// nom d'agent ni ancienneté).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.43" }));
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

/** Texte historique du rappel — référence de non-régression (repli). */
const TEXTE_ACTUEL = "⬆ Mise à jour v0.4.44 en attente (à la fin du travail en cours)";

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

const rappel = () => els["status-update-waiting"].textContent;
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

describe("Texte du rappel — le blocage est NOMMÉ, jamais muet", () => {
  it("une session bloque : le rappel dit l'agent, son projet et l'ancienneté", async () => {
    const t0 = Date.now() - (2 * 3600 + 13 * 60) * 1000; // 2 h 13 min
    updater.setUpdateWorkProbe(async () => true);
    updater.setUpdateWorkHoldersProbe(() => [
      { agentId: "codeur|G:/IA_PL/pilot", label: "codeur", project: "Pilot", since: t0 },
    ]);
    checkMock.mockResolvedValue(miseAJour("0.4.44"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(false); // le travail n'est jamais interrompu
    // Nom de l'agent + projet + ancienneté du travail : exactement ce qui
    // manquait (« à la fin du travail en cours » sans dire de qui ni depuis quand).
    expect(rappel()).toContain("codeur");
    expect(rappel()).toContain("Pilot");
    expect(rappel()).toContain("en cours depuis");
    expect(rappel()).toContain("2 h 13 min");
    expect(rappel()).toContain("v0.4.44");
    expect(els["status-update-waiting"].classList.contains("hidden")).toBe(false);
  });

  it("plusieurs sessions bloquent : la PLUS ANCIENNE est nommée, les autres comptées", () => {
    const now = 1_000_000_000_000;
    const texte = updater.formatWaitingNotice(
      "0.4.44",
      [
        { label: "codeur", project: "Pilot", since: now - 10 * 60 * 1000 }, // 10 min
        { label: "Magnus", project: "", since: now - 3 * 3600 * 1000 }, // 3 h (la plus ancienne)
        { label: "relecteur", project: "Autre", since: now - 60 * 1000 }, // 1 min
      ],
      now
    );
    expect(texte).toContain("Magnus");
    expect(texte).toContain("3 h 00 min 00 s");
    expect(texte).toContain("+ 2 autres");
    expect(texte).not.toContain("codeur"); // une seule session nommée
  });

  it("un début inconnu n'invente aucune durée (aucune ancienneté affichée)", () => {
    const texte = updater.formatWaitingNotice("0.4.44", [
      { label: "codeur", project: "Pilot", since: null },
    ]);
    expect(texte).toContain("codeur");
    expect(texte).not.toContain("en cours depuis");
  });

  it("REPLI : liste vide ⇒ le texte actuel est conservé MOT POUR MOT", async () => {
    updater.setUpdateWorkProbe(async () => true);
    updater.setUpdateWorkHoldersProbe(() => []);
    checkMock.mockResolvedValue(miseAJour("0.4.44"));

    await updater.checkForUpdate(true);

    expect(rappel()).toBe(TEXTE_ACTUEL);
  });

  it("REPLI : sonde absente ou en échec ⇒ texte actuel, aucune erreur affichée", async () => {
    expect(updater.formatWaitingNotice("0.4.44", [])).toBe(TEXTE_ACTUEL);
    expect(updater.formatWaitingNotice("0.4.44", null)).toBe(TEXTE_ACTUEL);

    updater.setUpdateWorkProbe(async () => true);
    updater.setUpdateWorkHoldersProbe(() => {
      throw new Error("relevé indisponible");
    });
    checkMock.mockResolvedValue(miseAJour("0.4.44"));

    await updater.checkForUpdate(true);

    expect(rappel()).toBe(TEXTE_ACTUEL); // jamais un nom inventé
    expect(modalVisible()).toBe(false);
  });

  it("terrain libre : le rappel n'est pas posé (aucun texte d'attente)", async () => {
    updater.setUpdateWorkProbe(async () => false);
    updater.setUpdateWorkHoldersProbe(() => [{ label: "codeur", project: "Pilot", since: 1 }]);
    checkMock.mockResolvedValue(miseAJour("0.4.44"));

    await updater.checkForUpdate(true);

    expect(modalVisible()).toBe(true);
    expect(rappel()).toBe("");
  });
});

describe("Câblage — la sonde « qui bloque » lit le relevé DÉJÀ en mémoire", () => {
  it("main.js installe la sonde des bloqueurs à côté de la sonde d'activité", () => {
    const src = source("main.js");
    expect(src).toContain("setUpdateWorkHoldersProbe(");
    const debut = src.indexOf("function initUpdateWindowReservation() {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("/** Avertit l'utilisateur", debut));
    // Même source que la sonde « travail en cours » : le relevé d'activité.
    expect(corps).toContain("getAgentActivitySnapshot()");
    expect(corps).toContain("isAgentWorking");
    // Aucune nouvelle requête ni nouveau sondage (pas d'invoke, pas de setInterval).
    expect(corps).not.toContain("invoke(");
  });

  it("updater.js n'ouvre aucune requête pour nommer les bloqueurs", () => {
    const src = source("updater.js");
    const debut = src.indexOf("async function readWorkHolders() {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf("/**", debut));
    expect(corps).not.toContain("invoke(");
    expect(corps).not.toContain("fetch(");
    expect(corps).not.toContain("setInterval");
  });
});
