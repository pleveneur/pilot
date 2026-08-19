// Tests unitaires — super-agent.js : décision de scroll intelligent
// (Bug 2 UX) : à agent_end et à l'apparition d'un élément interactif, la vue
// descend en bas SEULEMENT si l'utilisateur était déjà en bas (seuil
// SUPER_SCROLL_BOTTOM_THRESHOLD). Ne force pas le bas si l'utilisateur a
// volontairement remonté pour relire (issue #60).
//
// NB : super-agent.js importe de nombreuses dépendances (agent-pi, editor via
// CodeMirror, Tauri…). On les mocke pour pouvoir charger le module en vitest et
// tester la fonction pure `shouldScrollSuperToBottom` sans déclencher la
// cascade d'imports navigateur.
import { vi, describe, it, expect } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({ default: vi.fn(() => ({ render: () => "" })) }));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(), detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(), detectSemanticLoop: vi.fn(),
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

const { shouldScrollSuperToBottom } = await import("./super-agent.js");

// Fenêtre d'exemple : scrollHeight = 1000, clientHeight = 500.
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 500;

describe("shouldScrollSuperToBottom (décision de scroll intelligente)", () => {
  it("descend si l'utilisateur est déjà en bas (dans le seuil 60 px)", () => {
    expect(shouldScrollSuperToBottom(460, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(true);
    expect(shouldScrollSuperToBottom(500, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(true);
    expect(shouldScrollSuperToBottom(940, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(true);
  });

  it("ne force pas le bas si l'utilisateur a volontairement remonté (> 60 px)", () => {
    expect(shouldScrollSuperToBottom(0, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(false);
    expect(shouldScrollSuperToBottom(200, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(false);
    // Juste au-delà du seuil : 439 → 939 < 940 → false.
    expect(shouldScrollSuperToBottom(439, CLIENT_HEIGHT, SCROLL_HEIGHT)).toBe(false);
  });

  it("respecte un seuil personnalisé", () => {
    // Seuil 20 px : 480+500 = 980 >= 1000-20 → true ; 479+500 = 979 < 980 → false.
    expect(shouldScrollSuperToBottom(480, CLIENT_HEIGHT, SCROLL_HEIGHT, 20)).toBe(true);
    expect(shouldScrollSuperToBottom(479, CLIENT_HEIGHT, SCROLL_HEIGHT, 20)).toBe(false);
  });

  it("gère le cas d'un contenu qui ne déborde pas (déjà tout en bas)", () => {
    // scrollHeight == clientHeight → toujours en bas.
    expect(shouldScrollSuperToBottom(0, 500, 500)).toBe(true);
  });
});
