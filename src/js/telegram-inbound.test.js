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
