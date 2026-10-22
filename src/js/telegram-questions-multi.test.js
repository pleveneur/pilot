// telegram-questions-multi.test.js — Telegram, étape 2, lot 5 : QUESTION À
// CHOIX MULTIPLE (cases à cocher + bouton « Terminé »).
//
// Contrôles exigés (chacun DOIT échouer si la règle est neutralisée) :
//   (a) un clic d'option ne VALIDE pas (il coche) ;
//   (b) un second clic DÉCOCHE ;
//   (c) « Terminé » renvoie TOUTES les options cochées, DANS L'ORDRE des options ;
//   (d) le texte libre reste accepté, à l'identique ;
//   (e) choix unique et Oui/Non gardent « un clic = une réponse » ;
//   (f) une charge d'une autre génération ne coche ni ne valide ;
//   (g) une question REMPLACÉE n'accepte plus ni coche ni validation.
// Aucun accès réseau, aucun minuteur réel.

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import {
  buildQuestionButtons,
  formatQuestionForTelegram,
  formatQuestionAnswered,
  parseCallbackData,
  checkedOptionIndices,
  checkedOptionValues,
  multiSelectionPayload,
  createTelegramQuestionBridge,
  TELEGRAM_MULTI_DONE_ACTION,
} from "./telegram-questions.js";

/** Minuteurs factices : on contrôle l'unique rappel sans attendre. */
function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => scheduled.delete(id),
    count: () => scheduled.size,
  };
}

const silence = { warn: () => {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

const multiQuestion = {
  kind: "multi",
  title: "Quels modules ?",
  options: ["ToDo", "Agenda", "Notes"],
};

/** Passerelle prête à l'emploi, avec un message à boutons identifié (77). */
function multiBridge() {
  const send = vi.fn();
  const resolve = vi.fn();
  const sendButtons = vi.fn(async () => ({ sent: true, messageId: 77 }));
  const editMessage = vi.fn(async () => undefined);
  const bridge = createTelegramQuestionBridge({
    send,
    sendButtons,
    editMessage,
    timers: fakeTimers(),
    ...silence,
  });
  return { bridge, send, resolve, sendButtons, editMessage };
}

describe("choix multiple — fonctions pures (cases, « Terminé », ordre)", () => {
  it("l'encodage de clic reste UNIQUE : « q<génération>:<index> » ou « :ok »", () => {
    expect(parseCallbackData("q7:2")).toEqual({ generation: 7, index: 2 });
    expect(parseCallbackData(`q7:${TELEGRAM_MULTI_DONE_ACTION}`)).toEqual({
      generation: 7,
      action: "ok",
    });
    expect(parseCallbackData("q7:nawak")).toBeNull();
    expect(parseCallbackData("qok")).toBeNull();
  });

  it("une case par option (☐ / ✅) + un bouton « Terminé »", () => {
    expect(buildQuestionButtons(multiQuestion, 3)).toEqual([
      { text: "☐ ToDo", data: "q3:0" },
      { text: "☐ Agenda", data: "q3:1" },
      { text: "☐ Notes", data: "q3:2" },
      { text: "✔️ Terminé", data: "q3:ok" },
    ]);
    expect(buildQuestionButtons(multiQuestion, 3, new Set([2, 0]))).toEqual([
      { text: "✅ ToDo", data: "q3:0" },
      { text: "☐ Agenda", data: "q3:1" },
      { text: "✅ Notes", data: "q3:2" },
      { text: "✔️ Terminé", data: "q3:ok" },
    ]);
  });

  it("les indices cochés sont filtrés et TRIÉS dans l'ordre des options", () => {
    expect(checkedOptionIndices(multiQuestion, new Set([2, 0]))).toEqual([0, 2]);
    expect(checkedOptionIndices(multiQuestion, [9, -1, 1, 1])).toEqual([1]);
    expect(checkedOptionIndices(multiQuestion, null)).toEqual([]);
    expect(checkedOptionValues(multiQuestion, new Set([2, 0]))).toEqual(["ToDo", "Notes"]);
  });

  it("la charge utile de validation porte indices ET libellés, dans l'ordre", () => {
    expect(multiSelectionPayload(multiQuestion, new Set([2, 0]))).toEqual({
      kind: "selection",
      indices: [0, 2],
      values: ["ToDo", "Notes"],
    });
  });

  it("le message ouvert invite à cocher puis à valider, et rappelle la sélection", () => {
    const ouvert = formatQuestionForTelegram(multiQuestion, new Set([1]));
    expect(ouvert).toContain("puis appuyez sur « Terminé »");
    expect(ouvert).toContain("Sélection actuelle : Agenda");
    expect(formatQuestionForTelegram(multiQuestion)).not.toContain("Sélection actuelle");
  });

  it("le message réécrit montre la sélection validée (et reste neutre sinon)", () => {
    const valide = formatQuestionAnswered(multiQuestion, new Set([2, 0]));
    expect(valide).toContain("Répondu");
    expect(valide).toContain("votre sélection : ToDo, Notes");
    // Répondue depuis l'application : la sélection n'est pas connue de Telegram.
    expect(formatQuestionAnswered(multiQuestion)).toContain("Déjà répondu");
    // Choix simple : texte inchangé (aucune régression).
    expect(formatQuestionAnswered({ title: "A ?", options: ["A", "B"] })).toContain(
      "Déjà répondu",
    );
  });
});

describe("choix multiple — la passerelle de question", () => {
  it("le message part avec les cases non cochées et le bouton « Terminé »", async () => {
    const { bridge, sendButtons } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, vi.fn());
    await flush();

    const [text, buttons] = sendButtons.mock.calls[0];
    expect(text).toContain("Quels modules ?");
    expect(buttons.map((b) => b.text)).toEqual(["☐ ToDo", "☐ Agenda", "☐ Notes", "✔️ Terminé"]);
    expect(buttons.map((b) => b.data)).toEqual(["q1:0", "q1:1", "q1:2", "q1:ok"]);
  });

  it("(a) un clic d'option COCHE sans répondre et met le message à jour", async () => {
    const { bridge, resolve, editMessage } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();

    expect(bridge.pressCallback("q1:1")).toBe(true);
    // Aucune réponse envoyée : la question reste ouverte.
    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.current().resolved).toBe(false);
    // Le message est réécrit avec la case cochée (même message, pas de doublon).
    expect(editMessage).toHaveBeenCalledTimes(1);
    const [messageId, text, buttons] = editMessage.mock.calls[0];
    expect(messageId).toBe(77);
    expect(text).toContain("Sélection actuelle : Agenda");
    expect(buttons.map((b) => b.text)).toEqual(["☐ ToDo", "✅ Agenda", "☐ Notes", "✔️ Terminé"]);
  });

  it("(b) un second clic sur la même option DÉCOCHE", async () => {
    const { bridge, resolve, editMessage } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();

    bridge.pressCallback("q1:1");
    bridge.pressCallback("q1:1");
    await flush();
    expect(resolve).not.toHaveBeenCalled();
    const [id, , buttons] = editMessage.mock.calls.at(-1);
    expect(id).toBe(77);
    expect(buttons.map((b) => b.text)).toEqual(["☐ ToDo", "☐ Agenda", "☐ Notes", "✔️ Terminé"]);
    expect(bridge.current().checked.size).toBe(0);
  });

  it("(c) « Terminé » renvoie les options cochées DANS L'ORDRE des options", async () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();

    // Cochées dans le désordre : Notes (2) puis ToDo (0).
    bridge.pressCallback("q1:2");
    bridge.pressCallback("q1:0");
    expect(resolve).not.toHaveBeenCalled();

    expect(bridge.pressCallback("q1:ok")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0]).toEqual({
      kind: "selection",
      indices: [0, 2], // ordre des options, pas ordre des clics
      values: ["ToDo", "Notes"],
    });
    expect(bridge.current().resolved).toBe(true);
  });

  it("« Terminé » sans rien cocher renvoie une sélection VIDE (pas un abandon)", async () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();

    expect(bridge.pressCallback("q1:ok")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ kind: "selection", indices: [], values: [] });
  });

  it("après validation, le message est réécrit : plus de boutons, sélection visible", async () => {
    const { bridge, editMessage } = multiBridge();
    const question = { id: "qmulti" };
    bridge.ask(question, multiQuestion, vi.fn());
    await flush();
    bridge.pressCallback("q1:0");
    bridge.pressCallback("q1:2");
    bridge.pressCallback("q1:ok");
    // `settle` reproduit ce que fait l'application quand la réponse est appliquée
    // (même identité de question que celle posée).
    bridge.settle(question);
    await flush();

    const last = editMessage.mock.calls.at(-1);
    expect(last[0]).toBe(77);
    expect(last[1]).toContain("Répondu");
    expect(last[1]).toContain("votre sélection : ToDo, Notes");
    expect(last[2]).toBeUndefined(); // aucun clavier : boutons retirés
    // Une fois le message clos, plus aucune réécriture de cases.
    const count = editMessage.mock.calls.length;
    bridge.pressCallback("q1:1");
    expect(editMessage.mock.calls.length).toBe(count);
  });

  it("(d) le texte libre reste accepté tel quel sur une question à choix multiple", async () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();

    expect(bridge.feed("plutôt ToDo et Notes")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ kind: "text", value: "plutôt ToDo et Notes" });
  });

  it("(d bis) un numéro d'option en texte reste une réponse immédiate (inchangé)", () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);

    expect(bridge.feed("2")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ kind: "option", index: 1, value: "Agenda" });
  });

  it("(e) choix unique et Oui/Non : toujours UN clic = une réponse", () => {
    const bridge = createTelegramQuestionBridge({
      send: vi.fn(),
      sendButtons: vi.fn(async () => ({ sent: true, messageId: 5 })),
      editMessage: vi.fn(async () => undefined),
      timers: fakeTimers(),
      ...silence,
    });
    // Un choix simple n'a AUCUN bouton « Terminé » et répond au premier clic.
    expect(buildQuestionButtons({ options: ["A", "B"] }, 1).map((b) => b.data)).toEqual([
      "q1:0",
      "q1:1",
    ]);
    const resolveChoice = vi.fn();
    bridge.ask({ id: "q" }, { title: "Approche ?", options: ["A", "B"] }, resolveChoice);
    expect(bridge.pressCallback("q1:1")).toBe(true);
    expect(resolveChoice).toHaveBeenCalledWith({ kind: "option", index: 1, value: "B" });

    // Confirmation Oui/Non : premier clic = décision immédiate.
    const resolveConfirm = vi.fn();
    bridge.ask(
      { id: "c" },
      { kind: "confirm", title: "Confirmer ?", options: ["Oui", "Non"] },
      resolveConfirm,
    );
    const gen = bridge.current().generation;
    expect(bridge.pressCallback(`q${gen}:1`)).toBe(true);
    expect(resolveConfirm).toHaveBeenCalledWith({ kind: "option", index: 1, value: "Non" });

    // « Terminé » sur une question SANS choix multiple ne répond rien.
    bridge.ask(
      { id: "c2" },
      { kind: "confirm", title: "Confirmer ?", options: ["Oui", "Non"] },
      vi.fn(),
    );
    const gen2 = bridge.current().generation;
    expect(bridge.pressCallback(`q${gen2}:ok`)).toBe(true);
    expect(bridge.current().resolved).toBe(false);
  });

  it("(f) une charge d'une AUTRE génération ne coche ni ne valide", async () => {
    const { bridge, resolve, editMessage } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();
    editMessage.mockClear();

    // Clic d'un message périmé (génération 0) : ni coche, ni validation, ni
    // réécriture ; seule la question active est concernée.
    expect(bridge.pressCallback("q0:1")).toBe(true);
    expect(bridge.pressCallback("q0:ok")).toBe(true);
    expect(bridge.current().checked.size).toBe(0);
    expect(bridge.current().resolved).toBe(false);
    expect(editMessage).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("(g) une question REMPLACÉE n'accepte plus ni coche ni validation", async () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q1" }, multiQuestion, resolve);
    await flush();
    const resolve2 = vi.fn();
    // Deuxième question : la première est remplacée (génération 1 → 2).
    bridge.ask({ id: "q2" }, multiQuestion, resolve2);
    await flush();

    expect(bridge.pressCallback("q1:0")).toBe(true); // coche de la question remplacée
    expect(bridge.pressCallback("q1:ok")).toBe(true); // validation de la remplacée
    expect(resolve).not.toHaveBeenCalled();
    expect(resolve2).not.toHaveBeenCalled();
    expect(bridge.current().checked.size).toBe(0);
    expect(bridge.current().resolved).toBe(false);
  });

  it("(g bis) une question déjà validée ignore les clics suivants", async () => {
    const { bridge, resolve, send } = multiBridge();
    bridge.ask({ id: "q" }, multiQuestion, resolve);
    await flush();
    bridge.pressCallback("q1:0");
    bridge.pressCallback("q1:ok");
    send.mockClear();

    expect(bridge.pressCallback("q1:1")).toBe(true); // coche tardive
    expect(bridge.pressCallback("q1:ok")).toBe(true); // validation tardive
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.at(-1)[0]).toContain("déjà été répondue");
  });

  it("aucune régression de la saisie libre (aucun bouton, aucune case)", () => {
    const { bridge, resolve } = multiBridge();
    bridge.ask({ id: "q" }, { title: "Ton nom ?", options: [] }, resolve);
    expect(bridge.current().multi).toBe(false);
    expect(bridge.pressCallback("q1:ok")).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.feed("Jean")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ kind: "text", value: "Jean" });
  });
});
