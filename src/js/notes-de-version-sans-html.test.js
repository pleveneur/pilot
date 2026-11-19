// notes-de-version-sans-html.test.js — COMP-07, volet « notes de mise à jour ».
//
// Les notes affichées dans la fenêtre de mise à jour viennent du RÉSEAU
// (`notes` de latest.json, corps des releases GitHub) : c'est du texte non
// fiable. Le Markdown y est rendu (titres, gras, liens), le HTML brut y reste
// du TEXTE — jamais une balise active dans la fenêtre principale.
//
// Méthode : même montage que updater-fenetre-maj.test.js, mais avec le VRAI
// `preview.js` / markdown-it (seul Mermaid, étranger au rendu, est neutralisé).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.4.35" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("./toast.js", () => ({
  showToast: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("mermaid", () => ({
  default: { initialize: () => {}, mermaidAPI: { render: async () => ({ svg: "" }) } },
}));

function fakeEl(initiallyHidden = false) {
  const classes = new Set(initiallyHidden ? ["hidden"] : []);
  return {
    style: {},
    textContent: "",
    innerHTML: "",
    disabled: false,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

let els;
let updater;

beforeEach(async () => {
  vi.resetModules();
  checkMock.mockReset();
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
  els = {};
  for (const id of ids) els[id] = fakeEl();
  const modal = fakeEl(true);
  const progress = fakeEl(true);
  modal.querySelector = (sel) => (sel === ".update-progress" ? progress : null);
  els["update-modal"] = modal;
  globalThis.window = { addEventListener: () => {} };
  globalThis.document = {
    visibilityState: "visible",
    body: { classList: { contains: () => false } },
    getElementById: (id) => els[id] || null,
    addEventListener: () => {},
  };
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
  vi.useFakeTimers();
  updater = await import("./updater.js");
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe("COMP-07 — les notes de mise à jour n'exécutent pas de HTML", () => {
  it("notes de latest.json : Markdown rendu, HTML brut affiché comme texte", async () => {
    checkMock.mockResolvedValue({
      available: true,
      version: "0.4.40",
      date: "2026-10-21T10:00:00Z",
      body: "## v0.4.40\n\n**Nouveau**\n\n<img src=x onerror=alert(1)>\n\nRéveiller <Nom>",
      download: vi.fn(async () => {}),
      install: vi.fn(async () => {}),
    });
    await updater.checkForUpdate(true);
    const html = els["update-notes"].innerHTML;
    expect(html).toContain("<strong>Nouveau</strong>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // Les gabarits « <Nom> » des notes réelles restent lisibles.
    expect(html).toContain("&lt;Nom&gt;");
    expect(html).not.toMatch(/<img/i);
  });
});
