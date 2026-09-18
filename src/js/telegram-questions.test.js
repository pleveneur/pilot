// telegram-questions.test.js — Telegram, étape 2, lot 1 : questions/réponses.
//
// Tests de l'INTERPRÉTATION d'une réponse (numéro → option, texte libre, texte
// vide, première réponse gagne, inertie) et de la passerelle de question
// (envoi + rappel unique + résolution par le même chemin que l'application).
// Aucun accès réseau, aucun minuteur réel.

import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import {
  formatQuestionForTelegram,
  formatQuestionReminder,
  parseTelegramAnswer,
  createTelegramQuestionBridge,
  consumeTelegramQuestionAnswer,
  TELEGRAM_QUESTION_REMINDER_MS,
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
    fireAll: () => {
      for (const [id, entry] of [...scheduled]) {
        scheduled.delete(id);
        entry.fn();
      }
    },
    count: () => scheduled.size,
    delays: () => [...scheduled.values()].map((e) => e.ms),
  };
}

const silence = { warn: () => {} };

describe("parseTelegramAnswer — interprétation d'une réponse", () => {
  const choice = { title: "Approche ?", options: ["A", "B", "C"] };

  it("un numéro sélectionne l'option correspondante", () => {
    expect(parseTelegramAnswer("1", choice)).toEqual({ kind: "option", index: 0, value: "A" });
    expect(parseTelegramAnswer("2.", choice)).toEqual({ kind: "option", index: 1, value: "B" });
    expect(parseTelegramAnswer(" 3) ", choice)).toEqual({ kind: "option", index: 2, value: "C" });
  });

  it("tout autre texte est pris comme réponse libre", () => {
    expect(parseTelegramAnswer("plutôt la troisième", choice)).toEqual({
      kind: "text",
      value: "plutôt la troisième",
    });
  });

  it("un numéro hors plage est une réponse libre (pas une option)", () => {
    expect(parseTelegramAnswer("9", choice)).toEqual({ kind: "text", value: "9" });
    expect(parseTelegramAnswer("0", choice)).toEqual({ kind: "text", value: "0" });
  });

  it("un texte vide ne produit aucune réponse", () => {
    expect(parseTelegramAnswer("", choice)).toEqual({ kind: "empty" });
    expect(parseTelegramAnswer("   \n ", choice)).toEqual({ kind: "empty" });
    expect(parseTelegramAnswer(undefined, choice)).toEqual({ kind: "empty" });
  });

  it("sans options, un numéro reste une réponse libre (saisie)", () => {
    expect(parseTelegramAnswer("42", { title: "Quel port ?", options: [] })).toEqual({
      kind: "text",
      value: "42",
    });
  });
});

describe("formatQuestionForTelegram", () => {
  it("affiche le titre, le message et la liste numérotée des options", () => {
    const text = formatQuestionForTelegram({
      title: "Quelle approche ?",
      message: "Détail de la question.",
      options: ["A", "B"],
    });
    expect(text).toBe(
      "❓ Quelle approche ?\nDétail de la question.\n1. A\n2. B\nRépondez par le numéro correspondant.",
    );
  });

  it("affiche Oui / Non pour une confirmation", () => {
    const text = formatQuestionForTelegram({
      title: "Confirmer ?",
      message: "",
      options: ["Oui", "Non"],
    });
    expect(text).toContain("1. Oui");
    expect(text).toContain("2. Non");
  });

  it("invite à répondre en texte quand il n'y a pas d'option (saisie libre)", () => {
    const text = formatQuestionForTelegram({ title: "Quel nom ?", options: [] });
    expect(text).toBe("❓ Quel nom ?\nRépondez par un message texte.");
  });

  it("ne produit jamais 'undefined' avec un descripteur incomplet", () => {
    expect(formatQuestionForTelegram()).toBe("❓ Question\nRépondez par un message texte.");
  });

  it("le rappel reprend la question, discrètement", () => {
    const text = formatQuestionReminder({ title: "Confirmer ?", options: ["Oui", "Non"] });
    expect(text.startsWith("⏳ Toujours en attente de votre réponse :")).toBe(true);
    expect(text).toContain("Confirmer ?");
  });
});

describe("createTelegramQuestionBridge — envoi et réponse", () => {
  it("envoie la question puis applique une réponse par numéro", () => {
    const send = vi.fn();
    const timers = fakeTimers();
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send, timers, ...silence });
    const question = { id: "q1" };

    bridge.ask(question, { title: "Approche ?", options: ["A", "B"] }, resolve);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("1. A");

    expect(bridge.feed("2")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ kind: "option", index: 1, value: "B" });
  });

  it("applique un texte libre (précision / saisie) au même chemin", () => {
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers: fakeTimers(), ...silence });
    bridge.ask({ id: "q" }, { title: "Quel nom ?", options: [] }, resolve);

    expect(bridge.feed("MonProjet")).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ kind: "text", value: "MonProjet" });
  });

  it("ignore un texte vide (la question reste posée)", () => {
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers: fakeTimers(), ...silence });
    bridge.ask({ id: "q" }, { title: "Confirmer ?", options: ["Oui", "Non"] }, resolve);

    expect(bridge.feed("   ")).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.current().resolved).toBe(false);
  });

  it("PREMIÈRE RÉPONSE GAGNE : après une réponse dans l'application, Telegram est ignoré", () => {
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers: fakeTimers(), ...silence });
    const question = { id: "q" };
    bridge.ask(question, { title: "Approche ?", options: ["A", "B"] }, resolve);

    // L'utilisateur répond dans l'application → la question est résolue.
    bridge.settle(question);

    expect(bridge.feed("1")).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("PREMIÈRE RÉPONSE GAGNE : après une réponse Telegram, une seconde est ignorée", () => {
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers: fakeTimers(), ...silence });
    bridge.ask({ id: "q" }, { title: "Approche ?", options: ["A", "B"] }, resolve);

    expect(bridge.feed("1")).toBe(true);
    expect(bridge.feed("2")).toBe(false); // pas de double réponse
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("n'envoie AUCUN rappel quand la question est résolue avant l'échéance", () => {
    const send = vi.fn();
    const timers = fakeTimers();
    const bridge = createTelegramQuestionBridge({ send, timers, ...silence });
    const question = { id: "q" };
    bridge.ask(question, { title: "Confirmer ?", options: ["Oui", "Non"] }, () => {});
    bridge.settle(question);

    expect(timers.count()).toBe(0); // rappel annulé
    timers.fireAll();
    expect(send).toHaveBeenCalledTimes(1); // seulement la question
  });

  it("envoie UN SEUL rappel discret après quelques minutes, si la question reste posée", () => {
    const send = vi.fn();
    const timers = fakeTimers();
    const bridge = createTelegramQuestionBridge({ send, timers, ...silence });
    bridge.ask({ id: "q" }, { title: "Confirmer ?", options: ["Oui", "Non"] }, () => {});

    expect(timers.delays()).toEqual([TELEGRAM_QUESTION_REMINDER_MS]);
    timers.fireAll();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain("Toujours en attente");
    // Un seul rappel : rien de plus après.
    timers.fireAll();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("n'oublie jamais une question restée sans réponse (aucune expiration)", () => {
    const timers = fakeTimers();
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers, ...silence });
    bridge.ask({ id: "q" }, { title: "Approche ?", options: ["A"] }, resolve);

    timers.fireAll(); // le rappel ne résout rien
    expect(resolve).not.toHaveBeenCalled();
    expect(bridge.current()).not.toBeNull();
    expect(bridge.feed("1")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("reste strictement inerte sans configuration (envoi no-op, aucune erreur visible)", () => {
    // Simule la passerelle non configurée : l'envoi ne fait rien et ne lève rien.
    const bridge = createTelegramQuestionBridge({
      send: () => undefined,
      timers: fakeTimers(),
      warn: () => {
        throw new Error("aucun avertissement attendu");
      },
    });
    expect(() => bridge.ask({ id: "q" }, { title: "Approche ?", options: ["A"] }, () => {})).not.toThrow();
    expect(() => bridge.feed("1")).not.toThrow();
  });

  it("avale un envoi qui échoue (aucune erreur remontée)", () => {
    const warns = [];
    const bridge = createTelegramQuestionBridge({
      send: () => {
        throw new Error("réseau indisponible");
      },
      timers: fakeTimers(),
      warn: (...a) => warns.push(a.join(" ")),
    });
    expect(() => bridge.ask({ id: "q" }, { title: "?", options: [] }, () => {})).not.toThrow();
    expect(warns.join("\n")).toContain("envoi ignoré");
  });

  it("'clear' oublie la question active (fermeture de l'onglet)", () => {
    const resolve = vi.fn();
    const bridge = createTelegramQuestionBridge({ send: () => {}, timers: fakeTimers(), ...silence });
    bridge.ask({ id: "q" }, { title: "?", options: ["A"] }, resolve);
    bridge.clear();

    expect(bridge.current()).toBeNull();
    expect(bridge.feed("1")).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("consumeTelegramQuestionAnswer (passerelle partagée)", () => {
  it("ne consomme rien quand aucune question n'est en cours", () => {
    expect(consumeTelegramQuestionAnswer("bonjour Pilot")).toBe(false);
  });
});
