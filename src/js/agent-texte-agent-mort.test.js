// Tests — le texte qu'un agent avait DÉJÀ ÉCRIT n'est plus jeté quand il meurt.
//
// Défaut protégé (constaté en relecture indépendante du 2026-10-23) : à la mort
// d'un agent (`process_exit` / `process_error` / `extension_error`),
// `failAgentTurn` remettait `ctx.streamingTextByAgent[agentId]` à zéro SANS le
// lire, et côté Assistant `loop.lastText` était accumulé puis remis à zéro sans
// être restitué. Une mission perdue ne laissait donc aucun texte exploitable,
// alors que l'agent avait peut-être déjà écrit la moitié du travail.
//
// Ces tests ÉCHOUENT si le texte est de nouveau jeté :
//  1. agent mort AVEC du texte → texte dans le message d'échec ET dans le journal
//     des arrêts existant (`<projet>/.pilot/agent-stops.log`, champ `text=`) ;
//  2. agent mort SANS texte → mention explicite « aucun texte récupéré » (jamais
//     un silence, jamais un texte inventé) ;
//  3. mémoire vide mais session sur le disque → récupération par
//     `get_delegation_result` (mécanisme DÉJÀ existant, non dupliqué).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Système de fichiers virtuel (IPC simulé) : journal des arrêts + projet ──
const files = new Map();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args) => {
    const path = String((args && args.path) || "");
    if (cmd === "create_file") return undefined;
    if (cmd === "read_file_content") return files.has(path) ? files.get(path) : "";
    if (cmd === "write_file_content") {
      files.set(path, String((args && args.content) || ""));
      return undefined;
    }
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor"),
}));

import { invoke } from "@tauri-apps/api/core";
import { beginRun, endRun, handleAgentEvent, attachMissionSink } from "./agents-bus.js";
import { agentStopTracePath } from "./agent-stop-trace.js";
import {
  PARTIAL_TEXT_MAX_CHARS,
  PARTIAL_TEXT_LOG_HINT,
  normalizePartialText,
  extractDelegationResultText,
  buildPartialTextDeathNotice,
  buildAgentDeathReport,
} from "./agent-partial-text.js";
import { buildAgentStopTraceLine } from "./loop-detection.js";
import { readFileSync } from "node:fs";

const PROJECT = "C:\\p\\agent-mort";
const LOG = agentStopTracePath(PROJECT);

/** Laisse tourner la finalisation asynchrone (trace disque puis message). */
const flushAsync = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

/** Événement du bus (forme réelle : { payload: { project, agent_id, event } }). */
const ev = (agentId, type, event = {}) => ({
  payload: { project: PROJECT, agent_id: agentId, event: { type, ...event } },
});

/** Delta de texte streamé (ce que l'agent est en train d'écrire). */
const delta = (agentId, text) =>
  ev(agentId, "message_update", { assistantMessageEvent: { type: "text_delta", delta: text } });

/**
 * Lance une run avec l'agent `codeur` actif et capture le rapport de mission.
 * @param {{disk?: object|null}} [opts] - `disk` : réponse de `get_delegation_result`
 */
const beginRunOfDeadAgent = (opts = {}) => {
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const path = String((args && args.path) || "");
    switch (cmd) {
      case "get_config":
        return {};
      case "list_agents":
        return { agents: [] };
      case "create_file":
        return undefined;
      case "read_file_content":
        return files.has(path) ? files.get(path) : "";
      case "write_file_content":
        files.set(path, String((args && args.content) || ""));
        return undefined;
      case "get_delegation_result":
        if (opts.disk) return opts.disk;
        throw new Error("aucune session sur le disque");
      default:
        return undefined;
    }
  });
  const ctx = beginRun(PROJECT);
  ctx.activeAgents.add("codeur");
  ctx.agentProject["codeur"] = PROJECT;
  const got = { done: null, error: null };
  attachMissionSink(ctx.runKey, {
    onDone: (t) => (got.done = t),
    onError: (e) => (got.error = e.message),
  });
  return { ctx, got };
};

/** Contenu du journal des arrêts (fichier virtuel). */
const logContent = () => String(files.get(LOG) || "");

beforeEach(() => {
  files.clear();
  vi.mocked(invoke).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  endRun(PROJECT);
  vi.restoreAllMocks();
});

describe("agent mort AVEC du texte deja ecrit — le travail n'est plus jete", () => {
  it("le texte partiel figure dans le message d'echec rendu a l'assistant", async () => {
    const { got } = beginRunOfDeadAgent();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(delta("codeur", "J'ai commence : la fonction parse() doit gerer le cas vide."));
    handleAgentEvent(ev("codeur", "process_exit", { reason: "processus arrêté" }));
    await flushAsync();

    expect(got.done).toBeNull();
    expect(got.error).toContain("J'ai commence : la fonction parse() doit gerer le cas vide.");
    // La phrase dit clairement que la mission n'est PAS terminée.
    expect(got.error).toContain("n'est PAS terminee");
    // …et n'affirme jamais à tort qu'il n'y avait rien.
    expect(got.error).not.toContain("Aucun texte recupere");
  });

  it("le texte partiel est ecrit dans le journal des arrets EXISTANT (champ text=, pas un second journal)", async () => {
    beginRunOfDeadAgent();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(delta("codeur", "Brouillon: la correction consiste a valider l'entree."));
    handleAgentEvent(ev("codeur", "process_exit", { reason: "processus arrêté" }));
    await flushAsync();

    const content = logContent();
    expect(content).toContain("op=auto-stop");
    expect(content).toContain("reason=session-error");
    expect(content).toContain("detected=process-exit");
    expect(content).toContain("agent=codeur");
    expect(content).toContain("text=");
    expect(content).toContain("Brouillon: la correction consiste a valider l'entree.");
    // Le journal reste UNE ligne par arrêt : le texte ne crée pas de lignes
    // parasites qui casseraient la lecture des traces précédentes.
    expect(content.split("\n").filter(Boolean)).toHaveLength(1);
    // Aucun second emplacement : le seul fichier écrit est le journal des arrêts.
    expect([...files.keys()].filter((p) => p.includes("agent-stop") || p.includes("partial"))).toEqual([LOG]);
    expect(PARTIAL_TEXT_LOG_HINT).toBe(".pilot/agent-stops.log");
  });

  it("un plantage (process_error) conserve aussi le texte deja ecrit", async () => {
    const { got } = beginRunOfDeadAgent();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(delta("codeur", "Analyse terminee sur 3 fichiers; reste la migration."));
    handleAgentEvent(ev("codeur", "process_error", { text: "boom" }));
    await flushAsync();

    expect(got.error).toContain("Analyse terminee sur 3 fichiers; reste la migration.");
    expect(logContent()).toContain("text=");
  });

  it("un texte multiligne reste sur UNE seule ligne de journal (sauts encodes)", async () => {
    beginRunOfDeadAgent();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(delta("codeur", "Ligne 1 du travail\nLigne 2 du travail"));
    handleAgentEvent(ev("codeur", "process_exit", { reason: "processus arrêté" }));
    await flushAsync();

    const content = logContent();
    expect(content.split("\n").filter(Boolean)).toHaveLength(1);
    expect(content).toContain("Ligne 1 du travail\\nLigne 2 du travail");
  });
});

describe("agent mort SANS texte — la mention est explicite (jamais un silence)", () => {
  it("sans texte en memoire ni sur le disque, le message dit « aucun texte recupere »", async () => {
    const { got } = beginRunOfDeadAgent();
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(ev("codeur", "process_exit", { reason: "processus arrêté" }));
    await flushAsync();

    expect(got.error).toBeTruthy();
    expect(got.error).toContain("Aucun texte recupere");
    // La cause de l'arrêt reste lisible, et la mission n'est pas relancée.
    expect(got.error).toContain("processus arrêté");
    expect(got.error).toContain("pas relancee automatiquement");
    // Rien à conserver → aucune ligne `text=` vide ajoutée au journal.
    expect(logContent()).toContain("detected=process-exit");
    expect(logContent()).not.toContain("text=");
  });
});

describe("memoire vide mais session sur le disque — recuperation existante reutilisee", () => {
  it("le texte est relu par get_delegation_result (aucun second mecanisme) et restitue", async () => {
    const fromDisk = "Session du disque : refactor de buildIndex() termine a moitie.";
    const { got } = beginRunOfDeadAgent({
      disk: { project: PROJECT, session_id: "s1", result: { role: "assistant", text: fromDisk } },
    });
    handleAgentEvent(ev("codeur", "agent_start"));
    handleAgentEvent(ev("codeur", "process_exit", { reason: "processus arrêté" }));
    await flushAsync();

    // L'appel porte bien l'agent et le projet (ordre de résolution Rust inchangé).
    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "get_delegation_result");
    expect(call, "la récupération existante doit être tentée quand la mémoire est vide").toBeTruthy();
    expect(call[1]).toMatchObject({ project: PROJECT, agentId: "codeur" });
    expect(got.error).toContain(fromDisk);
    expect(got.error).toContain("session");
    expect(logContent()).toContain(fromDisk);
  });
});

describe("fonctions pures de restitution (contrat de texte)", () => {
  it("normalizePartialText borne le texte et DIT la troncature", () => {
    expect(normalizePartialText("   ")).toBe("");
    expect(normalizePartialText(null)).toBe("");
    expect(normalizePartialText("abc")).toBe("abc");
    const long = "x".repeat(PARTIAL_TEXT_MAX_CHARS + 500);
    const kept = normalizePartialText(long);
    expect(kept.length).toBeLessThanOrEqual(PARTIAL_TEXT_MAX_CHARS);
    expect(kept).toContain("texte tronque");
  });

  it("extractDelegationResultText lit la reponse de get_delegation_result", () => {
    expect(extractDelegationResultText({ result: { role: "assistant", text: "ok" } })).toBe("ok");
    expect(extractDelegationResultText({ result: "brut" })).toBe("brut");
    expect(extractDelegationResultText({ text: "aplati" })).toBe("aplati");
    expect(extractDelegationResultText(null)).toBe("");
    expect(extractDelegationResultText({ result: { role: "assistant", text: "  " } })).toBe("");
  });

  it("buildPartialTextDeathNotice ne renvoie JAMAIS une chaine vide", () => {
    expect(buildPartialTextDeathNotice({ text: "", source: "none" })).toContain("Aucun texte recupere");
    const withText = buildPartialTextDeathNotice({ text: "travail en cours", source: "memory" });
    expect(withText).toContain("travail en cours");
    expect(withText).toContain("memoire de la session");
    expect(withText).toContain("n'est PAS terminee");
  });

  it("buildAgentStopTraceLine accepte le champ text= (meme ligne, sauts encodes)", () => {
    const line = buildAgentStopTraceLine({
      reason: "session-error",
      detected: "process-exit",
      agentId: "codeur",
      projectPath: PROJECT,
      uid: 42,
      text: "a\nb",
      timestamp: "2026-10-23T10:00:00.000Z",
    });
    expect(line).toContain("uid=42");
    expect(line).toContain("text=a\\nb");
    expect(line.includes("\n")).toBe(false);
    // Une trace sans texte garde exactement le format historique.
    const plain = buildAgentStopTraceLine({
      reason: "session-error",
      detected: "process-exit",
      agentId: "codeur",
      projectPath: PROJECT,
      timestamp: "2026-10-23T10:00:00.000Z",
    });
    expect(plain.includes("text=")).toBe(false);
  });
});

describe("Assistant — le texte d'un agent d'arriere-plan mort est restitue (plus de remise a zero muette)", () => {
  const readSrc = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("buildAgentDeathReport dit le texte produit ou « aucun texte recupere »", () => {
    const withText = buildAgentDeathReport({ text: "Le module A est refactorise; reste B.", source: "memory" });
    expect(withText).toContain("Le module A est refactorise; reste B.");
    expect(withText).toContain("PAS terminee");
    expect(withText).toContain("n'est pas relancee automatiquement");
    const empty = buildAgentDeathReport({ text: "", source: "none" });
    expect(empty).toContain("Aucun texte recupere");
    expect(empty).toContain("PAS terminee");
  });

  it("l'Assistant compose son compte rendu de mort avec ce contrat (plus de remise a zero muette)", () => {
    const src = readSrc("super-agent.js");
    const fn = src.indexOf("export function buildInvisibleAgentDeathSummary(partialText) {");
    expect(fn, "compte rendu de mort de l'agent d'arrière-plan introuvable").toBeGreaterThan(-1);
    expect(src.slice(fn, fn + 400)).toContain("buildAgentDeathReport");
  });

  it("la branche process_exit de l'Assistant passe par la restitution (aucun « Connexion perdue » muet)", () => {
    const src = readSrc("super-agent.js");
    const start = src.indexOf('if (type === "process_exit" || type === "process_error") {\n    // MORT / PLANTE');
    expect(start, "branche de mort de l'agent d'arrière-plan introuvable").toBeGreaterThan(-1);
    const branch = src.slice(start, start + 600);
    expect(branch).toContain("reportInvisibleAgentDeath");
    // Le buffer n'est plus jeté : le texte déjà produit est conservé de côté.
    expect(src).toContain("loop.priorText = loop.lastText");
  });
});
