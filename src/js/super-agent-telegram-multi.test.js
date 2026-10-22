// super-agent-telegram-multi.test.js — Telegram, étape 2, lot 5 : RETOUR D'UNE
// SÉLECTION MULTIPLE dans Pilot.
//
// Contrat vérifié ici (l'endroit où la réponse Telegram devient une réponse de
// l'application) : une sélection validée par « Terminé » REMPLACE l'ensemble des
// options cochées puis envoie la question UNE SEULE fois, par le même chemin
// qu'une réponse donnée dans Pilot (`q.submit`). Aucune régression sur les
// autres sortes de réponses (option, confirmation, texte libre).
import { describe, it, expect, vi } from "vitest";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module. On installe donc un `window` minimal AVANT son import.
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
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, get length() { return 0; }, key: () => null };
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

import { applyTelegramAnswer } from "./super-agent.js";

/** Question à choix multiple telle que la construit l'onglet Assistant. */
function multiQuestion(selected = []) {
  return {
    title: "Quels modules ?",
    message: "",
    options: ["ToDo", "Agenda", "Notes"],
    multi: true,
    selected: new Set(selected),
    submit: vi.fn(async () => true),
  };
}

describe("retour d'une sélection multiple validée sur Telegram", () => {
  it("remplace les cases cochées et envoie la question UNE fois", async () => {
    const q = multiQuestion(["Agenda"]); // une case déjà cochée dans Pilot
    await applyTelegramAnswer(q, {
      kind: "selection",
      indices: [0, 2],
      values: ["ToDo", "Notes"],
    });

    expect([...q.selected]).toEqual(["ToDo", "Notes"]); // remplacée, pas ajoutée
    expect(q.submit).toHaveBeenCalledTimes(1);
    expect(q.submit).toHaveBeenCalledWith("", false);
  });

  it("une sélection vide reste une réponse (aucune option cochée)", async () => {
    const q = multiQuestion(["Agenda"]);
    await applyTelegramAnswer(q, { kind: "selection", indices: [], values: [] });

    expect([...q.selected]).toEqual([]);
    expect(q.submit).toHaveBeenCalledTimes(1);
  });

  it("une sélection n'est JAMAIS appliquée à une question sans choix multiple", async () => {
    const q = {
      title: "Approche ?",
      options: ["A", "B"],
      selected: "A",
      submit: vi.fn(async () => true),
    };
    await applyTelegramAnswer(q, { kind: "selection", indices: [0], values: ["A"] });
    expect(q.submit).not.toHaveBeenCalled();
    expect(q.selected).toBe("A");
  });

  it("aucune régression : option, confirmation et texte libre inchangés", async () => {
    // Choix multiple : un numéro d'option ajoute toujours à l'ensemble.
    const multi = multiQuestion(["Agenda"]);
    await applyTelegramAnswer(multi, { kind: "option", index: 1, value: "Agenda" });
    expect([...multi.selected]).toEqual(["Agenda"]);
    expect(multi.submit).toHaveBeenCalledWith("", false);

    // Choix simple : la valeur remplace la sélection.
    const choice = { title: "Approche ?", options: ["A", "B"], selected: null, submit: vi.fn(async () => true) };
    await applyTelegramAnswer(choice, { kind: "option", index: 1, value: "B" });
    expect(choice.selected).toBe("B");

    // Confirmation : décision explicite.
    const confirm = { title: "Confirmer ?", options: ["Oui", "Non"], confirmed: false, submit: vi.fn(async () => true) };
    await applyTelegramAnswer(confirm, { kind: "decision", confirmed: true, value: "oui" });
    expect(confirm.confirmed).toBe(true);

    // Texte libre : valeur transmise telle quelle.
    const input = { title: "Ton nom ?", options: [], submit: vi.fn(async () => true) };
    await applyTelegramAnswer(input, { kind: "text", value: "Jean" });
    expect(input.submit).toHaveBeenCalledWith("Jean", false);

    // Texte ambigu sur une confirmation : aucune décision.
    const ambiguous = { title: "Confirmer ?", options: ["Oui", "Non"], confirmed: null, submit: vi.fn(async () => true) };
    await applyTelegramAnswer(ambiguous, { kind: "undecided", value: "peut-être" });
    expect(ambiguous.submit).not.toHaveBeenCalled();
  });
});
