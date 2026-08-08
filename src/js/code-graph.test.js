// Tests unitaires — code-graph.js (Code Graph : fonctions pures)
import { describe, it, expect, vi } from "vitest";
import { estimateTokens, buildGraphBlock } from "./code-graph.js";

// ── estimateTokens ────────────────────────────────────────────────────
describe("estimateTokens", () => {
  it("retourne 0 sur entrée invalide", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens("")).toBe(0);
  });

  it("approxime ~1 token / 3.5 chars (arrondi supérieur)", () => {
    expect(estimateTokens("1234567")).toBe(2); // 7 / 3.5 = 2
    expect(estimateTokens("x")).toBe(1);
  });
});

// ── buildGraphBlock ───────────────────────────────────────────────────
describe("buildGraphBlock", () => {
  it("retourne '' si désactivé (sans appeler invoke)", async () => {
    const block = await buildGraphBlock("/proj", "prompt", { enabled: false });
    expect(block).toBe("");
  });

  it("retourne '' si pas de projet", async () => {
    const block = await buildGraphBlock(null, "prompt", { enabled: true });
    expect(block).toBe("");
  });

  it("retourne '' si pas de config", async () => {
    const block = await buildGraphBlock("/proj", "prompt", null);
    expect(block).toBe("");
  });

  it("si invoke échoue (mode A + B), retombe silencieusement sur ''", async () => {
    // Simule un échec réseau → les deux invoke rejettent → bloc vide.
    // On mocke le module @tauri-apps/api/core pour que invoke rejette.
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn(async () => { throw new Error("no tauri"); }),
    }));
    const mod = await import("./code-graph.js");
    const block = await mod.buildGraphBlock("/proj", "prompt", {
      enabled: true,
      injectModeA: true,
      injectModeB: true,
      budgetTokens: 4000,
    });
    expect(block).toBe("");
  });
});
