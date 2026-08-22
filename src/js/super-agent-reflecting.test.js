// Tests unitaires — super-agent.js : décision pure `superAgentReflectingFromEvent`
// (évolution UI « teinte réflexion » de la zone de saisie de l'assistant).
//
// Quand l'assistant réfléchit (agent_start), la barre de saisie reçoit la classe
// CSS `superagent-input-reflecting` (dégradé discret --superagent-accent). Au
// repos (agent_end / process_exit / process_error), la classe est retirée. Les
// autres événements ne changent pas l'état (null) : on conserve l'état courant.
//
// On mocke les dépendances navigateur/Tauri pour pouvoir charger le module en
// vitest (node) sans déclencher la cascade d'imports navigateur.
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

const { superAgentReflectingFromEvent } = await import("./super-agent.js");

describe("superAgentReflectingFromEvent (teinte réflexion de la zone de saisie)", () => {
  it("active la teinte sur agent_start (réflexion)", () => {
    expect(superAgentReflectingFromEvent("agent_start")).toBe(true);
  });

  it("désactive la teinte sur agent_end / process_exit / process_error (repos)", () => {
    expect(superAgentReflectingFromEvent("agent_end")).toBe(false);
    expect(superAgentReflectingFromEvent("process_exit")).toBe(false);
    expect(superAgentReflectingFromEvent("process_error")).toBe(false);
  });

  it("ne change pas l'état pour les autres événements (null)", () => {
    expect(superAgentReflectingFromEvent("text_delta")).toBeNull();
    expect(superAgentReflectingFromEvent("thinking_delta")).toBeNull();
    expect(superAgentReflectingFromEvent("tool_call")).toBeNull();
    expect(superAgentReflectingFromEvent("message_end")).toBeNull();
    expect(superAgentReflectingFromEvent("extension_ui_request")).toBeNull();
    expect(superAgentReflectingFromEvent("")).toBeNull();
    expect(superAgentReflectingFromEvent(undefined)).toBeNull();
  });
});