// telegram-inbound.test.js — Tests d'écoute Telegram (étape 2, lot 0).
//
// Câblage LÉGER : le transport Tauri et la remise à l'Assistant sont simulés.
// Aucun accès réseau, aucun minuteur réel.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ status: "inert", messages: [] })),
}));
vi.mock("./super-agent.js", () => ({
  injectExternalMessageToSuperAgent: vi.fn(async () => "delivered"),
}));

import { invoke } from "@tauri-apps/api/core";
import { injectExternalMessageToSuperAgent } from "./super-agent.js";
import {
  createTelegramInbound,
  formatTelegramInboundText,
  initTelegramInbound,
  TELEGRAM_INBOUND_INTERVAL_MS,
} from "./telegram-inbound.js";

/** Collecte les appels (commande → arguments) pour les assertions. */
function recordingInvoke(pollResult, { failPoll = false } = {}) {
  const calls = [];
  const invokeFn = vi.fn(async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "telegram_poll_inbound") {
      if (failPoll) throw new Error("backend absent");
      return typeof pollResult === "function" ? pollResult() : pollResult;
    }
    return undefined; // telegram_inbound_commit
  });
  return { invokeFn, calls };
}

const silence = { warn: () => {} };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatTelegramInboundText", () => {
  it("préfixe le message pour que l'assistant sache d'où il vient", () => {
    expect(formatTelegramInboundText("  coucou  ")).toBe(
      "[Message Telegram de l'utilisateur] coucou",
    );
  });

  it("tolère une valeur vide sans produire 'undefined'", () => {
    expect(formatTelegramInboundText(undefined)).toBe("[Message Telegram de l'utilisateur]");
  });
});

describe("createTelegramInbound — une passe de réception", () => {
  it("remet le message du propriétaire puis valide le curseur après remise", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      nextOffset: 12,
      messages: [{ updateId: 11, text: "bonjour Pilot" }],
    });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    const delivered = await inbound.pollOnce();

    expect(delivered).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("[Message Telegram de l'utilisateur] bonjour Pilot");
    // Le curseur n'est validé QU'APRÈS la remise (updateId + 1).
    expect(calls).toEqual([
      ["telegram_poll_inbound", undefined],
      ["telegram_inbound_commit", { offset: 12 }],
    ]);
    expect(inbound.lastCommitted()).toEqual({ updateId: 11, offset: 12 });
  });

  it("remet plusieurs messages dans l'ordre et valide chaque curseur", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      messages: [
        { updateId: 1, text: "un" },
        { updateId: 2, text: "deux" },
      ],
    });
    const order = [];
    const deliver = vi.fn(async (t) => {
      order.push(t);
      return "delivered";
    });
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(2);
    expect(order).toEqual([
      "[Message Telegram de l'utilisateur] un",
      "[Message Telegram de l'utilisateur] deux",
    ]);
    expect(calls.filter(([cmd]) => cmd === "telegram_inbound_commit")).toEqual([
      ["telegram_inbound_commit", { offset: 2 }],
      ["telegram_inbound_commit", { offset: 3 }],
    ]);
  });

  it("ne remet rien quand la passerelle est inerte (aucun message)", async () => {
    const { invokeFn, calls } = recordingInvoke({ status: "inert", messages: [] });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    // Aucun curseur à valider : un seul appel (la réception).
    expect(calls).toEqual([["telegram_poll_inbound", undefined]]);
  });

  it("valide le curseur d'un message sans texte sans le remettre", async () => {
    const { invokeFn } = recordingInvoke({
      status: "ok",
      messages: [
        { updateId: 4, text: "   " },
        { updateId: 5, text: "vrai" },
      ],
    });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("[Message Telegram de l'utilisateur] vrai");
  });

  it("N'AVANCE PAS le curseur si la remise échoue (le message sera relu)", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      messages: [
        { updateId: 8, text: "premier" },
        { updateId: 9, text: "second" },
      ],
    });
    const deliver = vi.fn(async () => {
      throw new Error("base indisponible");
    });
    const warns = [];
    const inbound = createTelegramInbound({
      invokeFn,
      deliver,
      warn: (...a) => warns.push(a.join(" ")),
    });

    expect(await inbound.pollOnce()).toBe(0);
    expect(calls.some(([cmd]) => cmd === "telegram_inbound_commit")).toBe(false);
    expect(warns.join("\n")).toContain("remise impossible");
  });

  it("ignore silencieusement un échec de réception (aucune erreur levée)", async () => {
    const { invokeFn } = recordingInvoke(null, { failPoll: true });
    const deliver = vi.fn(async () => "delivered");
    const warns = [];
    const inbound = createTelegramInbound({
      invokeFn,
      deliver,
      warn: (...a) => warns.push(a.join(" ")),
    });

    expect(await inbound.pollOnce()).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(warns.join("\n")).toContain("réception ignorée");
  });

  it("ne lance jamais deux passes concurrentes", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const invokeFn = vi.fn(async (cmd) => {
      if (cmd === "telegram_poll_inbound") {
        await gate;
        return { status: "ok", messages: [{ updateId: 1, text: "a" }] };
      }
      return undefined;
    });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    const first = inbound.pollOnce();
    expect(await inbound.pollOnce()).toBe(0); // ignorée
    release();
    expect(await first).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe("createTelegramInbound — réponses aux questions (étape 2, lot 1)", () => {
  it("consomme un message comme réponse à une question sans le déposer dans la conversation", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      messages: [{ updateId: 5, text: "2" }],
    });
    const deliver = vi.fn(async () => "delivered");
    const consumeAnswer = vi.fn(() => true);
    const inbound = createTelegramInbound({ invokeFn, deliver, consumeAnswer, ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    // Le message brut est confié à l'interpréteur (pas le texte préfixé).
    expect(consumeAnswer).toHaveBeenCalledWith("2");
    expect(deliver).not.toHaveBeenCalled();
    // Le curseur avance tout de même : le message ne sera pas relu.
    expect(calls).toContainEqual(["telegram_inbound_commit", { offset: 6 }]);
  });

  it("dépose dans la conversation un message qui n'est pas une réponse", async () => {
    const { invokeFn } = recordingInvoke({
      status: "ok",
      messages: [{ updateId: 7, text: "bonjour" }],
    });
    const deliver = vi.fn(async () => "delivered");
    const consumeAnswer = vi.fn(() => false);
    const inbound = createTelegramInbound({ invokeFn, deliver, consumeAnswer, ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    expect(deliver).toHaveBeenCalledWith("[Message Telegram de l'utilisateur] bonjour");
  });

  it("reste inert sans configuration : aucune réponse consommée, rien déposé", async () => {
    const { invokeFn } = recordingInvoke({ status: "inert", messages: [] });
    const deliver = vi.fn(async () => "delivered");
    const consumeAnswer = vi.fn(() => true);
    const inbound = createTelegramInbound({ invokeFn, deliver, consumeAnswer, ...silence });

    expect(await inbound.pollOnce()).toBe(0);
    expect(consumeAnswer).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("createTelegramInbound — interrogation périodique", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("interroge à intervalle régulier et s'arrête proprement (idempotent)", async () => {
    vi.useFakeTimers();
    const invokeFn = vi.fn(async () => ({ status: "inert", messages: [] }));
    const inbound = createTelegramInbound({
      invokeFn,
      deliver: vi.fn(),
      intervalMs: 5000,
      ...silence,
    });

    inbound.start();
    inbound.start(); // idempotent : un seul intervalle
    expect(inbound.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(invokeFn).toHaveBeenCalledTimes(1);

    inbound.stop();
    inbound.stop();
    expect(inbound.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(20000);
    expect(invokeFn).toHaveBeenCalledTimes(1); // plus rien après l'arrêt
  });
});

describe("initTelegramInbound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("démarre une seule instance, indépendamment de l'onglet Assistant", async () => {
    vi.useFakeTimers();
    const first = initTelegramInbound();
    const second = initTelegramInbound();
    expect(second).toBe(first);
    expect(first.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(TELEGRAM_INBOUND_INTERVAL_MS);
    expect(invoke).toHaveBeenCalled();
    expect(injectExternalMessageToSuperAgent).not.toHaveBeenCalled(); // passerelle inerte

    first.stop();
  });
});

describe("createTelegramInbound — curseur : avance jusqu'aux updates ÉCARTÉS (sans perte)", () => {
  it("avance le curseur quand la passe ne contient QUE des updates écartés (inconnu, photo, texte vide)", async () => {
    // Rust ne remonte aucun message (autre expéditeur / sans texte) mais calcule
    // nextOffset sur TOUS les updates : le curseur doit avancer pour ne pas les
    // relire indéfiniment.
    const { invokeFn, calls } = recordingInvoke({ status: "ok", nextOffset: 42, messages: [] });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(calls).toEqual([
      ["telegram_poll_inbound", undefined],
      ["telegram_inbound_commit", { offset: 42 }],
    ]);
    expect(inbound.lastCommitted()).toEqual({ updateId: 41, offset: 42 });
  });

  it("après le dernier message du propriétaire, avance aussi sur les updates écartés qui suivent", async () => {
    // update_id 9 = propriétaire ; 10 = inconnu écarté → nextOffset 11.
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      nextOffset: 11,
      messages: [{ updateId: 9, text: "bonjour" }],
    });
    const deliver = vi.fn(async () => "delivered");
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    expect(calls.filter(([cmd]) => cmd === "telegram_inbound_commit")).toEqual([
      ["telegram_inbound_commit", { offset: 10 }], // après remise du message
      ["telegram_inbound_commit", { offset: 11 }], // avance sur l'update écarté
    ]);
  });

  it("N'AVANCE PAS jusqu'à nextOffset si la remise échoue (aucun message perdu)", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      nextOffset: 20,
      messages: [
        { updateId: 18, text: "premier" },
        { updateId: 19, text: "second" },
      ],
    });
    const deliver = vi.fn(async () => {
      throw new Error("base indisponible");
    });
    const inbound = createTelegramInbound({ invokeFn, deliver, ...silence });

    expect(await inbound.pollOnce()).toBe(0);
    // Le curseur est resté totalement en arrière : les deux messages seront relus.
    expect(calls.some(([cmd]) => cmd === "telegram_inbound_commit")).toBe(false);
  });

  it("sans nextOffset (réponse ancienne) : aucun commit supplémentaire", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      messages: [{ updateId: 3, text: "a" }],
    });
    const inbound = createTelegramInbound({ invokeFn, deliver: vi.fn(async () => "delivered"), ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    expect(calls.filter(([cmd]) => cmd === "telegram_inbound_commit")).toEqual([
      ["telegram_inbound_commit", { offset: 4 }],
    ]);
  });

  it("ne recule jamais : un nextOffset déjà atteint ne produit pas de commit en double", async () => {
    const { invokeFn, calls } = recordingInvoke({
      status: "ok",
      nextOffset: 12,
      messages: [{ updateId: 11, text: "a" }],
    });
    const inbound = createTelegramInbound({ invokeFn, deliver: vi.fn(async () => "delivered"), ...silence });

    expect(await inbound.pollOnce()).toBe(1);
    // Commit in-loop (12) puis nextOffset (12) NON supérieur → un seul commit.
    expect(calls.filter(([cmd]) => cmd === "telegram_inbound_commit")).toEqual([
      ["telegram_inbound_commit", { offset: 12 }],
    ]);
  });
});
