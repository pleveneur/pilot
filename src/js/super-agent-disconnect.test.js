// Tests unitaires — super-agent.js : message « Connexion au super-agent perdue »
// enrichi d'un extrait de stderr réel (issue #84).
//
// Le message générique était affiché sans jamais révéler la cause réelle d'un
// blocage. Depuis le correctif, le stderr du processus (process_error) est
// bufferisé puis, quand la session reste morte après la fenêtre de grâce, un
// court extrait (borné ~500 chars, HTML-sûr, jamais de stack complète) est
// inclus dans le message.
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

const { buildSuperAgentDisconnectedMessage, superAgentStderrExtractFrom, SUPER_AGENT_GRACE_WINDOW_MS, isSuperAgentDisconnectedMessage, shouldClearDisconnectedMessage } = await import("./super-agent.js");

describe("buildSuperAgentDisconnectedMessage (issue #84)", () => {
  it("sans stderr capturé, retourne le message générique seul (sans régression)", () => {
    expect(buildSuperAgentDisconnectedMessage()).toBe("⚠️ Connexion au super-agent perdue.");
    expect(buildSuperAgentDisconnectedMessage("")).toBe("⚠️ Connexion au super-agent perdue.");
  });

  it("inclut un court extrait du stderr réel comme cause probable", () => {
    const msg = buildSuperAgentDisconnectedMessage("Error: Cannot find module 'web-to-markdown'");
    expect(msg.startsWith("⚠️ Connexion au super-agent perdue. Cause probable : ")).toBe(true);
    expect(msg).toContain("web-to-markdown");
  });

  it("borne l'extrait à ~500 chars (jamais de stack complète)", () => {
    const huge = "x".repeat(5000);
    const msg = buildSuperAgentDisconnectedMessage(huge);
    expect(msg.length).toBeLessThanOrEqual(501 + "⚠️ Connexion au super-agent perdue. Cause probable : ".length);
    expect(msg).toContain("…");
  });
});

describe("superAgentStderrExtractFrom (formatage pure)", () => {
  it("vide/whitespace → chaîne vide", () => {
    expect(superAgentStderrExtractFrom("")).toBe("");
    expect(superAgentStderrExtractFrom("   \n  ")).toBe("");
  });

  it("supprime les caractères de contrôle et vide les lignes", () => {
    const raw = "ERREUR\u0000\u0001\n\n  \nmodule introuvable\n";
    const out = superAgentStderrExtractFrom(raw);
    expect(out).toBe("ERREUR | module introuvable");
    expect(out).not.toContain("\u0000");
  });

  it("conserve un texte court intact", () => {
    expect(superAgentStderrExtractFrom("Error: command failed")).toBe("Error: command failed");
  });
});

describe("SUPER_AGENT_GRACE_WINDOW_MS (correctif V2 — alignement fenêtre)", () => {
  it("est aligné sur le cooldown anti-crash Rust (~30 s), pas sur l'ancien 8 s", () => {
    // La politique Rust (agent_service.rs) : SUPERAGENT_CRASH_WINDOW=20 s +
    // SUPERAGENT_RESTART_COOLDOWN=30 s. La fenêtre frontend doit couvrir le
    // redémarrage/cooldown légitime pour ne pas déclarer « perdue » à tort.
    expect(SUPER_AGENT_GRACE_WINDOW_MS).toBeGreaterThanOrEqual(30000);
    expect(SUPER_AGENT_GRACE_WINDOW_MS).toBeGreaterThan(8000);
  });
});

describe("isSuperAgentDisconnectedMessage (détection pure)", () => {
  it("détecte le message générique", () => {
    expect(isSuperAgentDisconnectedMessage("⚠️ Connexion au super-agent perdue.")).toBe(true);
  });

  it("détecte le message enrichi d'un extrait stderr", () => {
    expect(isSuperAgentDisconnectedMessage("⚠️ Connexion au super-agent perdue. Cause probable : module introuvable")).toBe(true);
  });

  it("ne détecte pas un autre message", () => {
    expect(isSuperAgentDisconnectedMessage("Projet ouvert : X")).toBe(false);
    expect(isSuperAgentDisconnectedMessage("")).toBe(false);
  });
});

describe("shouldClearDisconnectedMessage (correctif V2 — retrait du message)", () => {
  it("retire le message quand le processus redevient vivant ET qu'il est présent", () => {
    expect(shouldClearDisconnectedMessage(true, true)).toBe(true);
  });

  it("ne retire rien si la session reste morte (vrai blocage préservé)", () => {
    expect(shouldClearDisconnectedMessage(false, true)).toBe(false);
  });

  it("ne retire rien s'il n'y a pas de message", () => {
    expect(shouldClearDisconnectedMessage(true, false)).toBe(false);
    expect(shouldClearDisconnectedMessage(false, false)).toBe(false);
  });
});
