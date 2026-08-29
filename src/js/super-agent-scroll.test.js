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
vi.mock("./super-agent-schedule.js", () => ({ shouldScheduleTick: vi.fn(), parseScheduleEvery: vi.fn() }));

const { shouldScrollSuperToBottom, truncateSuperAgentSummary, computeSuperAtBottomFlag } = await import("./super-agent.js");

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

describe("computeSuperAtBottomFlag (réarmement du suivi automatique, SOUCIS 1)", () => {
  // Fenêtre : scrollHeight = 1000, clientHeight = 500, seuil = 60.
  // "En bas" = scrollTop + clientHeight >= scrollHeight - seuil = 940.

  it("(a) relire : utilisateur au-dessus du seuil → suivi désactivé (false)", () => {
    // Utilisateur a remonté pour relire : loin du bas.
    expect(computeSuperAtBottomFlag(0, 500, 1000)).toBe(false);
    expect(computeSuperAtBottomFlag(200, 500, 1000)).toBe(false);
    // Juste au-dessus du seuil (439 → 939 < 940) : encore en train de relire.
    expect(computeSuperAtBottomFlag(439, 500, 1000)).toBe(false);
  });

  it("(b) redescendre en bas → suivi automatique ré-armé (true)", () => {
    // Utilisateur redescend tout en bas avec l'ascenseur.
    expect(computeSuperAtBottomFlag(500, 500, 1000)).toBe(true);
    // Dans le seuil (460 → 960 >= 940) : ré-armé.
    expect(computeSuperAtBottomFlag(460, 500, 1000)).toBe(true);
    // Limite exacte du seuil : 440 → 940 >= 940 → ré-armé.
    expect(computeSuperAtBottomFlag(440, 500, 1000)).toBe(true);
  });

  it("simule une séquence complète : relire puis redescendre → ré-armé", () => {
    // 1. L'utilisateur remonte pour relire.
    let flag = computeSuperAtBottomFlag(100, 500, 1000);
    expect(flag).toBe(false);
    // 2. Du contenu arrive : le suivi ne force PAS le bas (flag false).
    // 3. L'utilisateur redescend tout en bas avec l'ascenseur.
    flag = computeSuperAtBottomFlag(500, 500, 1000);
    expect(flag).toBe(true);
    // 4. Le suivi est ré-armé : le prochain message suivra à 100 %.
  });
});

describe("truncateSuperAgentSummary (P0-4 : résumé de fin de tâche borné)", () => {
  it("laisse un résumé court inchangé", () => {
    expect(truncateSuperAgentSummary("court")).toBe("court");
    expect(truncateSuperAgentSummary("")).toBe("");
    expect(truncateSuperAgentSummary(null)).toBe("");
  });

  it("tronque un résumé trop volumineux avec un marqueur", () => {
    const big = "x".repeat(20000);
    const r = truncateSuperAgentSummary(big);
    expect(r.length).toBeLessThan(20000);
    expect(r.length).toBeGreaterThan(8000);
    expect(r.endsWith("[résumé tronqué : trop volumineux]")).toBe(true);
    expect(r.slice(0, 8000)).toBe(big.slice(0, 8000));
  });

  it("laisse un résumé à la borne tel quel", () => {
    const big = "y".repeat(8000);
    expect(truncateSuperAgentSummary(big)).toBe(big);
  });
});
