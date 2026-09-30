// Tests unitaires — super-agent.js : consigne préparée du bouton
// « Analyser et ranger mes données » (`buildDataAnalysisPrompt`).
//
// Le bouton n'ajoute AUCUNE machinerie au cœur du logiciel : il dépose dans la
// conversation une consigne verrouillée ici. Ces tests garantissent que la
// consigne impose bien (1) la lecture en LECTURE SEULE du dossier de travail
// de l'Assistant et de sa base de suivi, (2) la stricte interdiction de
// modifier / supprimer / renommer / déplacer, (3) un rapport écrit suivi d'une
// proposition de rangement en trois parties (sûr / discutable / à décider), et
// (4) l'aveu honnête de ce qui n'a pas pu être examiné.
//
// On mocke les dépendances navigateur/Tauri pour pouvoir charger le module en
// vitest (node) sans déclencher la cascade d'imports navigateur (même en-tête
// que super-agent-reflecting.test.js).
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

const { buildDataAnalysisPrompt } = await import("./super-agent.js");

describe("buildDataAnalysisPrompt — consigne du bouton « Analyser et ranger mes données »", () => {
  const prompt = buildDataAnalysisPrompt();

  it("nomme les deux sources de données à examiner (dossier de travail + base de suivi)", () => {
    expect(prompt).toContain("~/.pilot/assistant/");
    expect(prompt).toContain("~/.pilot/super-agent.db");
    expect(prompt).toContain("dossier de travail");
    expect(prompt).toContain("base de suivi");
  });

  it("impose la lecture seule et l'emploi d'outils de LECTURE uniquement", () => {
    expect(prompt.toLowerCase()).toContain("lecture seule");
    expect(prompt).toContain("`db_query` en SELECT");
    expect(prompt).toContain("pas de `db_execute`");
  });

  it("interdit explicitement de modifier, supprimer, renommer et déplacer", () => {
    expect(prompt).toContain("ne RIEN modifier");
    expect(prompt).toContain("ne RIEN supprimer");
    expect(prompt).toContain("ne rien renommer");
    expect(prompt).toContain("ne rien déplacer");
    expect(prompt).toContain("aucun fichier créé, édité, renommé ou supprimé");
  });

  it("exige un rapport écrit puis une proposition de rangement en trois parties", () => {
    expect(prompt).toContain("Rends un rapport écrit");
    expect(prompt).toContain("PROPOSITION DE RANGEMENT");
    expect(prompt).toContain("ce qui est sûr");
    expect(prompt).toContain("ce qui est discutable");
    expect(prompt).toContain("doit être décidé par l'utilisateur");
  });

  it("exige l'honnêteté sur ce qui n'a pas pu être examiné", () => {
    expect(prompt).toContain("pas pu être examiné");
    expect(prompt).toContain("au lieu de le passer sous silence");
    expect(prompt).toContain("N'invente aucun chiffre");
  });

  it("rappelle en clôture que rien n'est modifié et que l'utilisateur décide", () => {
    expect(prompt).toContain("tu ne modifies rien");
    expect(prompt).toContain("l'utilisateur décidera ensuite du rangement");
  });

  it("est stable (aucun état, aucun aléatoire) : deux appels identiques", () => {
    expect(buildDataAnalysisPrompt()).toBe(prompt);
  });
});
