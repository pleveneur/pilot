// Tests unitaires — super-agent.js : tâche #160 (overlay plein écran des
// événements de l'Assistant). Fonctions pures testées :
//   - normalizeOverlaySeconds : durée réglable (défaut 5 s, bornée [1, 120])
//   - superEventOverlayLevelClass : mapping niveau → classe CSS (même palette
//     que le panneau cloche : info/warning/danger/success)
//
// On mocke les dépendances navigateur/Tauri pour pouvoir charger le module en
// vitest (node) — même approche que super-agent-reflecting.test.js.
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({ default: vi.fn(() => ({ render: () => "" })) }));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(), detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(), detectSemanticLoop: vi.fn(),
  buildToolLoopFingerprint: vi.fn(),
}));
vi.mock("./desktop-notify.js", () => ({ notifySuperAgentDone: vi.fn(), playAssistantSound: vi.fn() }));
vi.mock("./agents.js", () => ({
  loadAgentRegistry: vi.fn(), upsertAgent: vi.fn(), normalizeAgent: vi.fn(),
  validateAgentId: vi.fn(), classifyAgent: vi.fn(),
}));
vi.mock("./agents-bus.js", () => ({
  runAgentsForAssistant: vi.fn(), runAgentsForAssistantAsync: vi.fn(), setBusNotifyCallback: vi.fn(),
}));
vi.mock("./reservations.js", () => ({ estimateAndReserve: vi.fn() }));
vi.mock("./structured-brief.js", () => ({ applyAssistantBriefEnvelope: vi.fn() }));
vi.mock("./super-agent-schedule.js", () => ({ shouldScheduleTick: vi.fn(), parseScheduleEvery: vi.fn() }));

const { normalizeOverlaySeconds, superEventOverlayLevelClass } = await import("./super-agent.js");

describe("normalizeOverlaySeconds (durée de l'overlay plein écran, tâche #160)", () => {
  it("défaut 5 s quand la valeur est absente/invalide", () => {
    expect(normalizeOverlaySeconds(undefined)).toBe(5);
    expect(normalizeOverlaySeconds(null)).toBe(5);
    expect(normalizeOverlaySeconds(NaN)).toBe(5);
    expect(normalizeOverlaySeconds("abc")).toBe(5);
  });

  it("défaut 5 s quand la valeur est nulle ou négative", () => {
    expect(normalizeOverlaySeconds(0)).toBe(5);
    expect(normalizeOverlaySeconds(-3)).toBe(5);
  });

  it("borne la durée à [1, 120] secondes", () => {
    expect(normalizeOverlaySeconds(1)).toBe(1);
    expect(normalizeOverlaySeconds(5)).toBe(5);
    expect(normalizeOverlaySeconds(120)).toBe(120);
    expect(normalizeOverlaySeconds(1000)).toBe(120);
  });

  it("tronque les valeurs décimales (secondes entières)", () => {
    expect(normalizeOverlaySeconds(7.9)).toBe(7);
  });

  it("une valeur décimale tronquée à 0 tombe sur le défaut", () => {
    expect(normalizeOverlaySeconds(0.5)).toBe(5);
  });
});

describe("superEventOverlayLevelClass (palette de la pastille overlay)", () => {
  it("mappe les niveaux comme le panneau cloche", () => {
    expect(superEventOverlayLevelClass("error")).toBe("danger");
    expect(superEventOverlayLevelClass("warn")).toBe("warning");
    expect(superEventOverlayLevelClass("success")).toBe("success");
    expect(superEventOverlayLevelClass("info")).toBe("info");
  });

  it("retombe sur info pour un niveau inconnu", () => {
    expect(superEventOverlayLevelClass("")).toBe("info");
    expect(superEventOverlayLevelClass(undefined)).toBe("info");
    expect(superEventOverlayLevelClass("unknown")).toBe("info");
  });
});