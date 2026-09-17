// Tests — porte de remise durable des comptes rendus de l'Assistant.
// Garantie : le compte rendu est TOUJOURS confié à la remise durable
// (`inject_session_summary`), même quand l'assistant est occupé (dans ce cas
// `defer: true` → écrit en base `delivered=0`, rejoué dès la libération). Plus
// de perte au redémarrage / à la fermeture de l'onglet (ancienne file en
// mémoire seule).

import { describe, it, expect, vi } from "vitest";
import { createReportDeliveryGate } from "./super-agent-reports.js";

describe("createReportDeliveryGate — remise durable systématique", () => {
  it("assistant libre → remise immédiate (defer:false, delivered)", async () => {
    const isBusy = vi.fn(() => false);
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy, send });

    const status = await gate.deliver({ summary: "cr", projectPath: "/p", category: "runagents" });

    expect(status).toBe("delivered");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].summary).toBe("cr");
    expect(send.mock.calls[0][1]).toEqual({ defer: false });
    expect(gate.pendingCount()).toBe(0);
  });

  it("assistant occupé → remise durable DIFFÉRÉE (defer:true, queued) — jamais perdue", async () => {
    const isBusy = vi.fn(() => true);
    const send = vi.fn(async () => "queued");
    const gate = createReportDeliveryGate({ isBusy, send });

    const status = await gate.deliver({ summary: "cr", projectPath: "/p", category: "runagents" });

    expect(status).toBe("queued");
    // La remise durable EST appelée (écriture en base) : c'est la correction.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ defer: true });
    expect(gate.pendingCount()).toBe(1);
  });

  it("flush alors que l'assistant est occupé → no-op, aucun rejeu", async () => {
    const isBusy = vi.fn(() => true);
    const send = vi.fn(async () => "queued");
    const replay = vi.fn(async () => {});
    const gate = createReportDeliveryGate({ isBusy, send, replay });

    await gate.deliver({ summary: "cr", projectPath: "/p", category: "session" });
    const r = await gate.flush();

    expect(r).toBe("busy");
    expect(replay).not.toHaveBeenCalled();
    expect(gate.pendingCount()).toBe(1);
  });

  it("flush après libération → rejoue les remises différées (une fois) et remet le compteur à zéro", async () => {
    let busy = true;
    const send = vi.fn(async () => "queued");
    const replay = vi.fn(async () => {});
    const gate = createReportDeliveryGate({ isBusy: () => busy, send, replay });

    await gate.deliver({ summary: "cr1", projectPath: "/p", category: "runagents" });
    await gate.deliver({ summary: "cr2", projectPath: "/p", category: "runagents" });
    expect(gate.pendingCount()).toBe(2);

    busy = false;
    const r = await gate.flush();
    expect(r).toBe("flushed");
    expect(replay).toHaveBeenCalledTimes(1);
    expect(gate.pendingCount()).toBe(0);

    // Plus rien de différé → pas de second rejeu.
    expect(await gate.flush()).toBe("empty");
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("flush sans remise différée → empty (aucun rejeu)", async () => {
    const replay = vi.fn(async () => {});
    const gate = createReportDeliveryGate({ isBusy: () => false, send: async () => "delivered", replay });

    expect(await gate.flush()).toBe("empty");
    expect(replay).not.toHaveBeenCalled();
  });

  it("aucun rejeu concurrent pendant un flush en cours (in-flight)", async () => {
    let busy = true;
    let resolveReplay;
    const replay = vi.fn(
      () => new Promise((res) => {
        resolveReplay = res;
      })
    );
    const gate = createReportDeliveryGate({ isBusy: () => busy, send: async () => "queued", replay });

    await gate.deliver({ summary: "cr", projectPath: "/p", category: "session" });
    busy = false;
    const first = gate.flush();
    const second = gate.flush();
    expect(await second).toBe("in-flight");
    resolveReplay();
    expect(await first).toBe("flushed");
    expect(replay).toHaveBeenCalledTimes(1);
  });
});
