// Tests — backend-info.js : sonde du backend (pi vs plh) et libellés d'affichage.
//
// Contrat vérifié : avant toute sonde tout est neutre (unknown / « Agent Pi »),
// le genre plh bascule TOUS les libellés, et un échec d'appel retombe en
// fail-open (unknown, extensions non supportées) sans lever.
// Le cache est un état de module : chaque test réimporte une instance neuve.

import { describe, it, expect, vi, beforeEach } from "vitest";

const emitted = [];
let invokeImpl;

vi.hoisted(() => {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    dispatchEvent: (e) => emitted.push(e),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

async function freshModule() {
  vi.resetModules();
  return await import("./backend-info.js");
}

describe("backend-info — état neutre avant sonde", () => {
  beforeEach(() => {
    emitted.length = 0;
    invokeImpl = vi.fn(async () => ({ kind: "pi", ext_supported: true }));
  });

  it("sans sonde : unknown, extensions non supportées, libellés « Pi »", async () => {
    const m = await freshModule();
    expect(m.getBackendInfoSync()).toBeNull();
    expect(m.backendKind()).toBe("unknown");
    expect(m.backendExtSupported()).toBe(false);
    expect(m.agentDisplayLabel()).toBe("Agent Pi");
    expect(m.agentDisplayPhrase()).toBe("l'agent Pi");
  });
});

describe("backend-info — backend plh", () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  it("refreshBackendInfo({kind:'plh'}) bascule tous les libellés et le gate extensions", async () => {
    invokeImpl = vi.fn(async () => ({ kind: "plh", ext_supported: true }));
    const m = await freshModule();

    await m.refreshBackendInfo();

    expect(m.backendKind()).toBe("plh");
    expect(m.backendExtSupported()).toBe(true);
    expect(m.agentDisplayLabel()).toBe("Agent PLh");
    expect(m.agentDisplayPhrase()).toBe("l'agent PLh");
    expect(m.getBackendInfoSync()).toEqual({ kind: "plh", ext_supported: true });
  });

  it("refreshBackendInfo émet pilot-backend-changed avec le détail sondé", async () => {
    invokeImpl = vi.fn(async () => ({ kind: "plh", ext_supported: false }));
    const m = await freshModule();

    await m.refreshBackendInfo();

    const evt = emitted.filter((e) => e.type === "pilot-backend-changed");
    expect(evt.length).toBe(1);
    expect(evt[0].detail).toEqual({ kind: "plh", ext_supported: false });
  });

  it("échec de la sonde → fail-open unknown, pas d'exception", async () => {
    invokeImpl = vi.fn(async () => {
      throw new Error("backend absent");
    });
    const m = await freshModule();

    const res = await m.refreshBackendInfo();

    expect(res).toEqual({ kind: "unknown", ext_supported: false });
    expect(m.backendKind()).toBe("unknown");
    expect(m.backendExtSupported()).toBe(false);
    expect(m.agentDisplayLabel()).toBe("Agent Pi"); // plh uniquement, jamais par défaut
  });
});

describe("backend-info — health check", () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  it("checkPiHealth expose le résultat en cache et émet pilot-pi-health-changed", async () => {
    const health = { ok: true, kind: "pi", version: "1.2.3", error: "", path: "/pi" };
    invokeImpl = vi.fn(async (cmd) => (cmd === "pi_health_check" ? health : { kind: "pi", ext_supported: true }));
    const m = await freshModule();

    await m.checkPiHealth();

    expect(m.getPiHealthSync()).toEqual(health);
    const evt = emitted.filter((e) => e.type === "pilot-pi-health-changed");
    expect(evt.length).toBe(1);
    expect(evt[0].detail.ok).toBe(true);
  });

  it("échec du health check → {ok:false, error:'probe_failed'}, jamais d'exception", async () => {
    invokeImpl = vi.fn(async () => {
      throw new Error("timeout");
    });
    const m = await freshModule();

    const res = await m.checkPiHealth();

    expect(res.ok).toBe(false);
    expect(res.error).toBe("probe_failed");
    expect(m.getPiHealthSync().ok).toBe(false);
  });
});
