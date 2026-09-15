// Tests — porte d'accusé de lecture des comptes rendus de l'Assistant.
// Corrige « compte rendu marqué transmis avant lecture » : tant que l'assistant
// est occupé (backendBusy), le compte rendu est mis en file (non transmis, donc
// non marqué livré) et rejoué dès qu'il se libère.

import { describe, it, expect, vi } from "vitest";
import { createReportDeliveryGate } from "./super-agent-reports.js";

describe("createReportDeliveryGate — ne transmet que si l'assistant est libre", () => {
  it("assistant libre → transmet immédiatement (delivered)", async () => {
    const isBusy = vi.fn(() => false);
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy, send });

    const status = await gate.deliver({ summary: "cr", projectPath: "/p", category: "runagents" });

    expect(status).toBe("delivered");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].summary).toBe("cr");
    expect(gate.pendingCount()).toBe(0);
  });

  it("assistant occupé → met en file SANS transmettre (queued, pas marqué livré)", async () => {
    const isBusy = vi.fn(() => true);
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy, send });

    const status = await gate.deliver({ summary: "cr", projectPath: "/p", category: "runagents" });

    expect(status).toBe("queued");
    expect(send).not.toHaveBeenCalled();
    expect(gate.pendingCount()).toBe(1);
  });

  it("flush alors que l'assistant est occupé → no-op (l'entrée reste en file)", async () => {
    const isBusy = vi.fn(() => true);
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy, send });

    await gate.deliver({ summary: "cr", projectPath: "/p", category: "session" });
    const r = await gate.flush();

    expect(r).toBe("busy");
    expect(send).not.toHaveBeenCalled();
    expect(gate.pendingCount()).toBe(1);
  });

  it("flush après libération → rejoue l'entrée mise en attente (une seule)", async () => {
    let busy = true;
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy: () => busy, send });

    await gate.deliver({ summary: "cr1", projectPath: "/p", category: "runagents" });
    await gate.deliver({ summary: "cr2", projectPath: "/p", category: "runagents" });
    expect(gate.pendingCount()).toBe(2);

    busy = false;
    const r = await gate.flush();
    expect(r).toBe("flushed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].summary).toBe("cr1");
    expect(gate.pendingCount()).toBe(1);

    // Le drain suivant transmet la seconde entrée (FIFO).
    await gate.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].summary).toBe("cr2");
    expect(gate.pendingCount()).toBe(0);
  });

  it("flush sur file vide → empty (aucun envoi)", async () => {
    const send = vi.fn(async () => "delivered");
    const gate = createReportDeliveryGate({ isBusy: () => false, send });

    expect(await gate.flush()).toBe("empty");
    expect(send).not.toHaveBeenCalled();
  });

  it("aucun doublon pendant un flush en cours (in-flight)", async () => {
    let busy = true;
    let resolveSend;
    const send = vi.fn(
      () => new Promise((res) => {
        resolveSend = res;
      })
    );
    const gate = createReportDeliveryGate({ isBusy: () => busy, send });

    await gate.deliver({ summary: "cr", projectPath: "/p", category: "session" });
    expect(gate.pendingCount()).toBe(1);
    busy = false;
    // Un flush précédent est déjà en cours : on en déclenche un second avant la
    // résolution (ne doit pas envoyer une 2ᵉ fois / ni désordonner).
    const first = gate.flush();
    const second = gate.flush();
    expect(await second).toBe("in-flight");
    resolveSend("delivered");
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });
});
