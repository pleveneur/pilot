// Tests unitaires — super-agent.js : décision pure `superAgentReflectingFromEvent`
// (évolution UI « teinte réflexion » de la zone de saisie de l'assistant) et
// `superAgentInputReflecting` (la zone de saisie ne respire que pendant le
// travail de l'ASSISTANT).
//
// Quand l'assistant réfléchit (agent_start), la barre de saisie reçoit la classe
// CSS `superagent-input-reflecting` (dégradé discret --superagent-accent). Au
// repos (agent_end / process_exit / process_error), la classe est retirée. Les
// autres événements ne changent pas l'état (null) : on conserve l'état courant.
//
// DÉFAUT VERROUILLÉ ICI : la zone de saisie de l'onglet 🧭 a respiré sur l'état
// GLOBAL « un agent travaille » (`anyBusy` de agent-activity.js). Résultat : alors
// que l'Assistant était au repos et qu'un SEUL autre agent travaillait (agent de
// projet, agent d'arrière-plan), la barre clignotait en boucle (`animation:
// assistant-input-breathe 1s ease-in-out infinite`). Le travail d'un AUTRE agent
// ne doit jamais rallumer cette zone.
//
// On mocke les dépendances navigateur/Tauri pour pouvoir charger le module en
// vitest (node) sans déclencher la cascade d'imports navigateur.
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
// `use` doit etre chainable : le vrai markdown-it renvoie l'instance
// (`markdownit({…}).use(plugin, opts)` dans preview.js).
vi.mock("markdown-it", () => ({
  default: vi.fn(() => ({ use() { return this; }, render: () => "" })),
}));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn(), purgeAgentTabView: vi.fn() }));
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
// Mock COMPLET des exports de super-agent-schedule.js : le module reel est
// importe au chargement et son garde de retenue est cree au niveau module.
vi.mock("./super-agent-schedule.js", () => ({
  shouldScheduleTick: vi.fn(),
  parseScheduleEvery: vi.fn(),
  formatReminderNotificationLabel: vi.fn(),
  planDueReminderInjections: vi.fn(() => ({ toInject: [], mode: "none", held: [], waitingForOwner: 0 })),
  buildReminderInjectionMessage: vi.fn(),
  formatReminderGroupNotificationLabel: vi.fn(),
  formatReminderHoldNotice: vi.fn(),
  createReminderHoldGuard: vi.fn(() => ({ reset() {}, shouldNotify: () => false })),
}));

// `super-agent.js` charge designormais `updater.js` -> `preview.js`, qui pose un
// ecouteur `theme-changed` des le chargement du module : un `window` minimal suffit.
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
}

const { superAgentReflectingFromEvent, superAgentInputReflecting } = await import("./super-agent.js");

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

describe("superAgentInputReflecting (la zone de saisie ne respire que pour l'Assistant)", () => {
  it("respire quand l'Assistant lui-même réfléchit", () => {
    expect(superAgentInputReflecting({ agentReflecting: true })).toBe(true);
    expect(superAgentInputReflecting({ agentReflecting: true, pendingQuestion: false })).toBe(true);
  });

  it("NE respire PAS quand seul un AUTRE agent travaille (symptôme du clignotement)", () => {
    // L'Assistant est au repos ; un agent de projet travaille. L'état global des
    // agents (`anyBusy`) peut valoir vrai : il ne doit RIEN rallumer ici. Une clé
    // parasite (ancien `agentsWorking`, `busy` global…) est ignorée.
    expect(superAgentInputReflecting({ agentReflecting: false, agentsWorking: true })).toBe(false);
    expect(superAgentInputReflecting({ agentReflecting: false, busy: true })).toBe(false);
    expect(
      superAgentInputReflecting({ agentReflecting: false, agentsWorking: true, pendingQuestion: false })
    ).toBe(false);
  });

  it("reste au repos quand personne ne travaille", () => {
    expect(superAgentInputReflecting({ agentReflecting: false, agentsWorking: false })).toBe(false);
    expect(superAgentInputReflecting({})).toBe(false);
    expect(superAgentInputReflecting()).toBe(false);
  });

  it("ne respire jamais pendant l'attente d'une question (règle #132 conservée)", () => {
    expect(superAgentInputReflecting({ agentReflecting: true, pendingQuestion: true })).toBe(false);
    expect(superAgentInputReflecting({ agentReflecting: false, pendingQuestion: true })).toBe(false);
  });
});

// Verrou de SOURCE : le défaut ne vivait pas dans la fonction pure mais dans son
// alimentation. `super-agent.js` ne doit plus consommer l'état global des agents
// pour la zone de saisie — sinon la barre se rallume pour le travail d'un autre
// agent et le clignotement revient.
describe("super-agent.js — la zone de saisie n'est plus alimentée par l'état global des agents", () => {
  const SRC = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("aucun « agentsWorking » (l'ancien couplage à anyBusy) ne subsiste", () => {
    expect(SRC).not.toMatch(/agentsWorking/);
  });

  it("aucun abonnement au store partagé ne consomme le drapeau global `busy`", () => {
    // Un abonné qui lit le 2e argument de subscribeAgentActivity s'alimente de
    // l'état global des agents : c'est ce couplage qui faisait clignoter la barre.
    expect(SRC).not.toMatch(/subscribeAgentActivity\(\s*\([^)]*\bbusy\b/);
  });
});
