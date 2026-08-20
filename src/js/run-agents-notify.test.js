// Tests unitaires — run-agents-notify.js (T7, spec_orchestration_multiagents.md
// §3.6 / §5.5) : distinction « point d'avancement » / « fin de tâche »,
// construction du compte-rendu (summary) et de la notification desktop.
import { describe, it, expect } from "vitest";
import {
  RUN_PROGRESS_PREFIX,
  isRunProgressMessage,
  buildRunAgentsSummary,
  buildRunAgentsNotification,
} from "./run-agents-notify.js";

describe("isRunProgressMessage (point d'avancement vs fin de tâche)", () => {
  it("détecte un message d'avancement préfixé [Info run_agents]", () => {
    expect(isRunProgressMessage(`${RUN_PROGRESS_PREFIX} ⏳ L'agent est déjà actif.`)).toBe(true);
  });

  it("ne détecte pas une fin de tâche (résultat / échec)", () => {
    expect(isRunProgressMessage("Résultat agrégé de la run")).toBe(false);
    expect(isRunProgressMessage("[Échec de la run agents] timeout")).toBe(false);
    expect(isRunProgressMessage("[Échec de la préparation de la run agents] x")).toBe(false);
  });

  it("gère les entrées non-texte / vides", () => {
    expect(isRunProgressMessage("")).toBe(false);
    expect(isRunProgressMessage(undefined)).toBe(false);
    expect(isRunProgressMessage(null)).toBe(false);
  });
});

describe("buildRunAgentsSummary (compte-rendu injecté / consignation)", () => {
  it("encadre une fin de tâche par le marqueur « Tâche run_agents terminée »", () => {
    const s = buildRunAgentsSummary("agents terminé");
    expect(s).toBe("[Tâche run_agents terminée] Résultat de la run d'agents :\nagents terminé");
  });

  it("injecte tel quel un point d'avancement (préfixe conservé, pas de marqueur)", () => {
    const s = buildRunAgentsSummary(`${RUN_PROGRESS_PREFIX} ⏳ en file.`);
    expect(s).toBe(`${RUN_PROGRESS_PREFIX} ⏳ en file.`);
    expect(s).not.toContain("Tâche run_agents terminée");
  });

  it("conserve un message d'échec sous son préfixe", () => {
    const s = buildRunAgentsSummary("[Échec de la run agents] boom");
    expect(s).toBe("[Tâche run_agents terminée] Résultat de la run d'agents :\n[Échec de la run agents] boom");
  });
});

describe("buildRunAgentsNotification (notification desktop de fin)", () => {
  it("succès → titre « terminée » avec le projet", () => {
    const { title, body } = buildRunAgentsNotification({ ok: true, projectPath: "/proj" });
    expect(title).toContain("terminée");
    expect(body).toContain("✅");
    expect(body).toContain("/proj");
  });

  it("échec → titre « en échec »", () => {
    const { title, body } = buildRunAgentsNotification({ ok: false, projectPath: null });
    expect(title).toContain("en échec");
    expect(body).toContain("❌");
  });

  it("sans projet → pas de suffixe projet", () => {
    const { body } = buildRunAgentsNotification({ ok: true, projectPath: null });
    expect(body).not.toContain("projet «");
  });
});
