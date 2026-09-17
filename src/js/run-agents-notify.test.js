// Tests unitaires — run-agents-notify.js (T7, spec_orchestration_multiagents.md
// §3.6 / §5.5) : distinction « point d'avancement » / « fin de tâche »,
// construction du compte-rendu (summary), de la notification desktop et de
// l'avis de fin (issue #87, 2ᵉ moitié : un échec doit être annoncé comme tel).
import { describe, it, expect, vi } from "vitest";
import {
  RUN_PROGRESS_PREFIX,
  isRunProgressMessage,
  buildRunAgentsSummary,
  buildRunAgentsNotification,
  runAgentsResultFailed,
  emitRunAgentsFinishNotice,
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

// Format réellement produit par `aggregateParallelResults` (src/js/agents.js).
const resultDone = [
  "=== Résultat de codeur (done) ===",
  "J'ai modifié src/js/editor.js.",
].join("\n");
const resultError = [
  "=== Résultat de codeur (error) ===",
  "Erreur de l'agent codeur : timeout d'inactivité.",
].join("\n");

function makeEmitters() {
  return {
    notify: vi.fn(() => Promise.resolve()),
    playSound: vi.fn(() => Promise.resolve()),
    consign: vi.fn(() => Promise.resolve("delivered")),
  };
}

describe("runAgentsResultFailed (échec agrégé → avis d'échec)", () => {
  it("un résultat entièrement réussi n'est pas un échec", () => {
    expect(runAgentsResultFailed(resultDone)).toBe(false);
  });

  it("un agent en échec dans le résultat agrégé rend la run en échec", () => {
    expect(runAgentsResultFailed(resultError)).toBe(true);
    expect(runAgentsResultFailed(`${resultDone}\n\n${resultError}`)).toBe(true);
  });

  it("une demande mise en file (« queued ») n'est pas un échec", () => {
    expect(runAgentsResultFailed("=== Résultat de codeur (queued) ===\n⏳ en file")).toBe(false);
  });

  it("un message d'échec explicite est un échec", () => {
    expect(runAgentsResultFailed("[Échec de la run agents] boom")).toBe(true);
    expect(runAgentsResultFailed("[Échec de la préparation de la run agents] x")).toBe(true);
  });

  it("gère les entrées vides / non-texte", () => {
    expect(runAgentsResultFailed("")).toBe(false);
    expect(runAgentsResultFailed(undefined)).toBe(false);
    expect(runAgentsResultFailed(null)).toBe(false);
  });
});

describe("emitRunAgentsFinishNotice (un avis de fin, une seule fois)", () => {
  it("fin de run réussie → une notification « terminée », un son, une consignation", async () => {
    const em = makeEmitters();
    const res = await emitRunAgentsFinishNotice({
      ok: true, projectPath: "/proj", result: resultDone, ...em,
    });
    expect(em.notify).toHaveBeenCalledTimes(1);
    expect(em.notify.mock.calls[0][0].title).toContain("terminée");
    expect(em.playSound).toHaveBeenCalledTimes(1);
    expect(em.playSound).toHaveBeenCalledWith("fin");
    expect(em.consign).toHaveBeenCalledTimes(1);
    expect(em.consign).toHaveBeenCalledWith(resultDone);
    expect(res).toEqual({ ok: true, notified: true, sound: true, consigned: true });
  });

  it("fin de run en échec → une notification « en échec » (pas de silence)", async () => {
    const em = makeEmitters();
    const res = await emitRunAgentsFinishNotice({
      ok: false, projectPath: null, result: resultError, ...em,
    });
    expect(em.notify).toHaveBeenCalledTimes(1);
    expect(em.notify.mock.calls[0][0].title).toContain("en échec");
    expect(em.notify.mock.calls[0][0].body).toContain("❌");
    expect(em.playSound).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
  });

  it("pas de double notification, même si la consignation échoue", async () => {
    const em = makeEmitters();
    em.consign = vi.fn(() => Promise.reject(new Error("invoke en erreur")));
    const res = await emitRunAgentsFinishNotice({
      ok: false, projectPath: null, result: resultError, ...em,
    });
    // Une seule notification, une seule fois ; l'échec de remise est absorbé.
    expect(em.notify).toHaveBeenCalledTimes(1);
    expect(em.playSound).toHaveBeenCalledTimes(1);
    expect(res.notified).toBe(true);
    expect(res.consigned).toBe(false);
  });

  it("un émetteur de notification défaillant ne remonte pas et ne bloque pas la suite", async () => {
    const em = makeEmitters();
    em.notify = vi.fn(() => { throw new Error("plugin notification absent"); });
    const res = await emitRunAgentsFinishNotice({
      ok: true, projectPath: null, result: resultDone, ...em,
    });
    expect(res.consigned).toBe(true);
    expect(em.consign).toHaveBeenCalledTimes(1);
  });
});
