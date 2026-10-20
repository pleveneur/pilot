// RÈGLE 2 — « une lecture n'arrête JAMAIS un agent », sur TOUS les chemins.
//
// L'audit indépendant (verrous règles 2-3-4) a trouvé la règle respectée sur le
// seul bus d'agents, mais PAS sur les deux autres chemins d'arrêt automatique :
//   • `agent-pi.js` (onglet agent principal) ne connaissait que les outils de
//     lecture pure et comptait `bash` comme un MUTATEUR → ~15 consultations
//     identiques (`git status --short` entre deux corrections) coupaient une run
//     de codeur (deux runs réellement tuées) ;
//   • `super-agent.js` (Assistant) arrêtait après 3 lectures identiques.
//
// Le correctif est UN SEUL classifieur partagé (`isReadOnlyAgentToolCall`, dans
// le module pur `loop-detection.js`), branché aux trois sites. Ce fichier le
// verrouille de façon DISCRIMINANTE : les gardes sont EXTRAITES du source de
// production puis EXÉCUTÉES (aucune reproduction manuelle du mécanisme), avec le
// VRAI classifieur. Si un site revient à une liste locale, si le garde est
// inversé ou supprimé, ces tests passent au ROUGE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import {
  isReadOnlyAgentToolCall,
  buildToolLoopFingerprint,
  detectRepeatedActions,
  detectRepeatedToolCalls,
} from "./loop-detection.js";
import { beginRun, endRun, handleAgentEvent } from "./agents-bus.js";

const source = (rel) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const AGENT_PI = source("src/js/agent-pi.js");
const SUPER_AGENT = source("src/js/super-agent.js");
const AGENTS_BUS = source("src/js/agents-bus.js");

/**
 * Extrait du source le bloc `{ … }` d'un `if (…) {` dont l'en-tête est donné,
 * par comptage d'accolades (aucune regex fragile, blocs imbriqués inclus).
 * @param {string} src
 * @param {string} header - en-tête exact, ex. `if (!isReadOnlyAgentToolCall(toolName, payload.args)) {`
 * @returns {string} instruction COMPLÈTE (en-tête + corps), exécutable telle quelle
 */
function extractStatement(src, header) {
  const start = src.indexOf(header);
  if (start < 0) return "";
  let depth = 0;
  const bodyStart = start + header.length;
  for (let i = bodyStart - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

/** Gardes EXACTES des trois sites (ancres du source de production). */
const GUARD_AGENT_PI = "if (toolName && !isReadOnlyAgentToolCall(toolName, toolArgs)) {";
const GUARD_SUPER_AGENT = "if (!isReadOnlyAgentToolCall(toolName, payload.args)) {";
const GUARD_AGENTS_BUS = "if (isReadOnlyAgentToolCall(toolName, toolArgs)) {";

// Seuils de production (lus dans le source : ils font partie du contrat).
const agentPiWindow = Number((AGENT_PI.match(/const ACTION_LOOP_WINDOW = (\d+);/) || [])[1]);
const agentPiMinRepeat = Number((AGENT_PI.match(/const ACTION_LOOP_MIN_REPEAT = (\d+);/) || [])[1]);

// ── 0. Le classifieur partagé (fondation des trois chemins) ─────────────────
describe("règle 2 — classifieur partagé `isReadOnlyAgentToolCall`", () => {
  it("reconnaît les outils de lecture pure", () => {
    for (const tool of ["read", "search", "grep", "glob", "list", "ls", "find", "read_project_file", "search_project"]) {
      expect(isReadOnlyAgentToolCall(tool, { path: "src/a.js" }), tool).toBe(true);
    }
  });

  it("reconnaît les commandes shell CONSULTATIVES (le trou de l'onglet agent)", () => {
    for (const command of [
      "git status --short",
      "git diff --stat",
      "git log --oneline -5",
      "ls -la src",
      "cat package.json",
      "rg -n loop src",
      "sed -n 1,40p src/js/agents-bus.js",
      "npm ls",
    ]) {
      expect(isReadOnlyAgentToolCall("bash", { command }), command).toBe(true);
    }
  });

  it("NE classe PAS en lecture ce qui MODIFIE ou exécute (l'anti-boucle doit rester vivante)", () => {
    for (const tool of ["edit", "write", "patch", "delete_file", "unknown_tool"]) {
      expect(isReadOnlyAgentToolCall(tool, { path: "src/a.js" }), tool).toBe(false);
    }
    for (const command of ["cargo test --lib", "npm test", "git commit -m x", "rm -rf src", "sed -i s/a/b/ f.js"]) {
      expect(isReadOnlyAgentToolCall("bash", { command }), command).toBe(false);
    }
  });

  it("n'est plus dupliquée : aucun site ne conserve une liste locale d'outils de lecture", () => {
    expect(AGENT_PI).not.toContain("const READ_ONLY_TOOLS =");
    expect(SUPER_AGENT).not.toMatch(/const (SUPER_)?READ_ONLY_TOOLS =/);
    expect(AGENTS_BUS).not.toContain("const AGENT_READ_ONLY_TOOLS =");
  });
});

// ── 1. Site `agent-pi.js` (onglet agent principal) ──────────────────────────
describe("règle 2 — onglet agent principal (`agent-pi.js`)", () => {
  /**
   * Exécute la garde EXTRAITE de la production, avec le vrai classifieur et le
   * vrai constructeur d'empreinte. `maybeDetectActionLoop` est remplacé par la
   * détection PURE (mêmes seuils que la production) : on observe donc les mêmes
   * décisions d'arrêt sans piloter le DOM du chat.
   */
  function runGuard(calls) {
    const body = extractStatement(AGENT_PI, GUARD_AGENT_PI);
    expect(body, "la garde de l'onglet agent a disparu du source").not.toBe("");
    const state = { actionHistory: [] };
    const stops = [];
    const maybeDetectActionLoop = () => {
      if (detectRepeatedActions(state.actionHistory, { windowSize: agentPiWindow, minRepeat: agentPiMinRepeat })) {
        stops.push(state.actionHistory.at(-1));
      }
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "isReadOnlyAgentToolCall",
      "buildToolLoopFingerprint",
      "ACTION_LOOP_WINDOW",
      "state",
      "messagesEl",
      "maybeDetectActionLoop",
      `return function (toolName, toolArgs) {${body}};`,
    )(isReadOnlyAgentToolCall, buildToolLoopFingerprint, agentPiWindow, state, null, maybeDetectActionLoop);
    for (const [toolName, args] of calls) fn(toolName, args);
    return { state, stops };
  }

  it("15 consultations `git status --short` identiques : AUCUN arrêt (le faux verrou d'origine)", () => {
    const calls = Array.from({ length: 15 }, () => ["bash", { command: "git status --short" }]);
    const { state, stops } = runGuard(calls);
    expect(state.actionHistory, "une consultation ne doit pas entrer dans l'historique d'arrêt").toEqual([]);
    expect(stops, "une consultation répétée ne doit jamais couper la run").toEqual([]);
  });

  it("deux séries de consultations identiques (git status / git diff) : toujours aucun arrêt", () => {
    const calls = [
      ...Array.from({ length: 8 }, () => ["bash", { command: "git status --short" }]),
      ...Array.from({ length: 8 }, () => ["bash", { command: "git diff --stat" }]),
      ...Array.from({ length: 6 }, () => ["read", { path: "src/js/agent-pi.js" }]),
    ];
    const { state, stops } = runGuard(calls);
    expect(state.actionHistory).toEqual([]);
    expect(stops).toEqual([]);
  });

  it("15 MÊMES modifications (`edit`) : l'arrêt anti-boucle existe toujours", () => {
    const calls = Array.from({ length: 15 }, () => ["edit", { path: "src/js/agent-pi.js", oldText: "a", newText: "b" }]);
    const { state, stops } = runGuard(calls);
    expect(state.actionHistory, "une modification reste comptée").toHaveLength(15);
    expect(stops.length, "15 modifications identiques doivent couper la run").toBeGreaterThan(0);
  });

  it("seuils de production inchangés (fenêtre et répétition)", () => {
    expect(agentPiWindow).toBe(40);
    expect(agentPiMinRepeat).toBe(15);
  });
});

// ── 2. Site `super-agent.js` (Assistant) ────────────────────────────────────
describe("règle 2 — Assistant (`super-agent.js`)", () => {
  /** Exécute la garde EXTRAITE avec le vrai classifieur (file réelle simulée). */
  function runGuard(calls) {
    const body = extractStatement(SUPER_AGENT, GUARD_SUPER_AGENT);
    expect(body, "la garde de l'Assistant a disparu du source").not.toBe("");
    const superLoopToolCalls = [];
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "isReadOnlyAgentToolCall",
      "buildToolLoopFingerprint",
      "superLoopToolCalls",
      `return function (payload) {\n        // Même extraction du nom que la production, juste avant la garde.\n        const toolName = payload.toolName || payload.tool || "outil";\n        ${body}\n      };`,
    )(isReadOnlyAgentToolCall, buildToolLoopFingerprint, superLoopToolCalls);
    for (const [toolName, args] of calls) fn({ toolName, args });
    return superLoopToolCalls;
  }

  it("3 lectures identiques : AUCUN arrêt (l'Assistant ne se coupe plus sur une exploration)", () => {
    const history = runGuard(Array.from({ length: 3 }, () => ["read", { path: "src/js/super-agent.js" }]));
    expect(history).toEqual([]);
    expect(detectRepeatedToolCalls(history)).toBe(false);
  });

  it("15 consultations shell identiques : AUCUN arrêt", () => {
    const history = runGuard(Array.from({ length: 15 }, () => ["bash", { command: "git status --short" }]));
    expect(history).toEqual([]);
    expect(detectRepeatedToolCalls(history)).toBe(false);
  });

  it("3 MÊMES modifications (`edit`) : l'arrêt anti-boucle existe toujours", () => {
    const history = runGuard(Array.from({ length: 3 }, () => ["edit", { path: "a.js", oldText: "a", newText: "b" }]));
    expect(history).toHaveLength(3);
    expect(detectRepeatedToolCalls(history), "3 modifications identiques restent une boucle").toBe(true);
  });
});

// ── 3. Site `agents-bus.js` (sous-agents / orchestration) ────────────────────
describe("règle 2 — bus d'agents (`agents-bus.js`) : consultation shell", () => {
  const PROJECT = "projetRegle2Shell";
  const AGENT = "codeur";
  let nowSpy;
  let clock;

  beforeEach(() => {
    endRun(PROJECT);
    clock = Date.now();
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => (clock += 600));
  });

  afterEach(() => {
    nowSpy.mockRestore();
    endRun(PROJECT);
  });

  it("la garde du bus est la MÊME classification (lecture → historique séparé)", () => {
    expect(AGENTS_BUS).toContain(GUARD_AGENTS_BUS);
    expect(AGENTS_BUS).toContain("pushReadOnlyToolCall(");
  });

  it("15 `git status --short` identiques dans une run : aucun arrêt", () => {
    const ctx = beginRun(PROJECT);
    ctx.activeAgents.add(AGENT);
    ctx.agentProject[AGENT] = PROJECT;
    for (let i = 0; i < 15; i++) {
      handleAgentEvent({
        payload: {
          project: PROJECT,
          agent_id: AGENT,
          event: { type: "tool_execution_start", toolName: "bash", args: { command: "git status --short" } },
        },
      });
    }
    expect(ctx.toolCallsByAgent[AGENT] || [], "une consultation ne compte pas comme action").toEqual([]);
    expect(ctx.readOnlyToolCallsByAgent[AGENT], "elle reste tracée à part").toHaveLength(15);
    expect(ctx.loopCorrectionPending[AGENT], "aucune correction déclenchée").toBeFalsy();
  });
});
