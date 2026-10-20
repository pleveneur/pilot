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
  detectRepeatedBlock,
  detectRepeatedWord,
  detectSemanticLoop,
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

// ── 4. Agent INVISIBLE de l'Assistant (`run_agents` : l'assistant délègue) ────
// Deux garanties distinctes, verrouillées ici :
//   • RÈGLE 2 : une consultation répétée (read, `git status`…) ne fait JAMAIS
//     entrer le moindre appel dans la fenêtre d'arrêt ;
//   • ANTI-BOUCLE VIVANTE : la détection de boucle d'OUTILS ne doit pas être
//     muette tant que le modèle n'a pas streamé 200 caractères. La garde « buffer
//     trop court » (anti-faux-positif du TEXTE) sortait de la fonction avant
//     d'évaluer les appels : un agent invisible qui répétait le même `edit` sans
//     écrire de texte n'était jamais arrêté.
describe("règle 2 — agent invisible de l'Assistant (détection d'outils)", () => {
  /** Extrait une DÉCLARATION de fonction complète du source (comptage d'accolades). */
  function extractFunction(src, anchor) {
    const start = src.indexOf(anchor);
    if (start < 0) return "";
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return "";
  }

  const INVISIBLE_FN = "function maybeDetectInvisibleAgentLoop(";
  const FN_BODY = extractFunction(SUPER_AGENT, INVISIBLE_FN);
  // Le gestionnaire d'événements de l'agent INVISIBLE : c'est LUI qui porte le
  // point de POUSSÉE. Le garde est cherché DANS cette fonction et non « quelque
  // part dans le fichier » — sinon la disparition du garde au site invisible
  // resterait verte, masquée par le garde du chemin visible de l'Assistant.
  const INVISIBLE_HANDLER = extractFunction(SUPER_AGENT, "function handleInvisibleAgentEvent(");
  const intervalMs = Number((SUPER_AGENT.match(/const INVISIBLE_LOOP_CHECK_INTERVAL_MS = (\d+);/) || [])[1]);
  const bufferMin = Number((SUPER_AGENT.match(/const INVISIBLE_LOOP_BUFFER_MIN = (\d+);/) || [])[1]);

  /**
   * Exécute la VRAIE fonction de production (extraite du source) sur une suite
   * d'appels d'outils. La fenêtre d'appels est remplie EXACTEMENT comme en
   * production : seuls les appels que le classifieur partagé ne classe pas en
   * lecture pure entrent dans la fenêtre (le garde est au point de POUSSÉE,
   * pas dans le détecteur).
   * @param {Array<[string, object]>} calls - [nom d'outil, arguments]
   * @param {{buffer?:string}} [opts]
   * @returns {{stops:object[], messages:string[], window:string[]}}
   */
  function runInvisibleLoop(calls, opts = {}) {
    expect(FN_BODY, "la détection de boucle de l'agent invisible a disparu du source").not.toBe("");
    const stops = [];
    const messages = [];
    expect(INVISIBLE_HANDLER, "le gestionnaire d'événements de l'agent invisible a disparu du source").not.toBe("");
    const pushGuard = extractStatement(INVISIBLE_HANDLER, GUARD_SUPER_AGENT);
    expect(
      pushGuard,
      "le garde de poussée de l'agent INVISIBLE a disparu de son gestionnaire d'événements",
    ).not.toBe("");
    const window = [];
    // eslint-disable-next-line no-new-func
    const push = new Function(
      "isReadOnlyAgentToolCall",
      "buildToolLoopFingerprint",
      "superLoopToolCalls",
      // Le garde extrait est celui du gestionnaire INVISIBLE : il pousse dans
      // `loop.toolCalls`. On lie donc le `loop` de production à la fenêtre
      // observée, pour exécuter l'instruction telle quelle (et non une copie).
      `return function (payload) {
        const loop = { toolCalls: superLoopToolCalls };
        const toolName = payload.toolName || payload.tool || "outil";
        ${pushGuard}
      };`,
    )(isReadOnlyAgentToolCall, buildToolLoopFingerprint, window);
    for (const [name, args] of calls) push({ toolName: name, args });

    // `new Function` : la fonction extraite est évaluée dans un scope qui NEUTRALISE
    // l'affichage et l'arrêt (observés), en gardant la LOGIQUE de décision réelle.
    const fn = new Function(
      "INVISIBLE_LOOP_CHECK_INTERVAL_MS",
      "INVISIBLE_LOOP_BUFFER_MIN",
      "detectRepeatedToolCalls",
      "detectRepeatedBlock",
      "detectRepeatedWord",
      "detectSemanticLoop",
      "appendSystemMessage",
      "stopInvisibleAgent",
      `return ${FN_BODY};`,
    )(
      intervalMs,
      bufferMin,
      detectRepeatedToolCalls,
      detectRepeatedBlock,
      detectRepeatedWord,
      detectSemanticLoop,
      (_el, message) => messages.push(String(message)),
      (agentId, projectPath, info) => stops.push({ agentId, projectPath, ...(info || {}) }),
    );
    fn(
      null,
      { buffer: opts.buffer || "", lastText: "", lastChecked: 0, stopped: false, toolCalls: window },
      "agent-1",
      "C:/p",
    );
    return { stops, messages, window };
  }

  it("le garde de lecture est au point de POUSSÉE du chemin invisible (et une seule fois)", () => {
    // Contrat de POSITION : si le garde migrait (ou si le bloc de poussée perdait
    // son `if`), le test de comportement ci-dessous ne verrait plus la règle 2.
    const occurrences = INVISIBLE_HANDLER.split(GUARD_SUPER_AGENT).length - 1;
    expect(occurrences, "un seul garde de poussée dans le gestionnaire invisible").toBe(1);
    expect(INVISIBLE_HANDLER).toContain("loop.toolCalls.push(buildToolLoopFingerprint(toolName, payload.args));");
  });

  it("un `edit` répété SANS texte (buffer < 200) est quand même détecté (le mutisme d'origine)", () => {
    const calls = Array.from({ length: 3 }, () => ["edit", { path: "src/a.js", oldText: "a", newText: "b" }]);
    const { stops } = runInvisibleLoop(calls);
    expect(stops, "une boucle d'outils sans texte streamé doit arrêter l'agent").toHaveLength(1);
    expect(stops[0]).toMatchObject({ agentId: "agent-1", reason: "loop-detection", detected: "tool-calls" });
  });

  it("15 consultations `git status --short` (buffer vide) : AUCUN arrêt", () => {
    const calls = Array.from({ length: 15 }, () => ["bash", { command: "git status --short" }]);
    const { stops, window } = runInvisibleLoop(calls);
    expect(window, "une consultation ne doit pas entrer dans la fenêtre d'arrêt").toEqual([]);
    expect(stops, "une consultation répétée ne doit jamais arrêter un agent").toEqual([]);
  });

  it("15 `read` du même fichier (buffer vide) : AUCUN arrêt", () => {
    const calls = Array.from({ length: 15 }, () => ["read", { path: "src/js/super-agent.js" }]);
    const { stops, window } = runInvisibleLoop(calls);
    expect(window).toEqual([]);
    expect(stops).toEqual([]);
  });

  it("texte répété (buffer long) : arrêt avec detected=text, pas tool-calls", () => {
    const repeated = "la même phrase encore et encore\n".repeat(40);
    const { stops } = runInvisibleLoop([], { buffer: repeated });
    expect(stops, "une répétition de texte doit rester détectée").toHaveLength(1);
    expect(stops[0]).toMatchObject({ reason: "loop-detection", detected: "text" });
  });

  it("un intervalle de vérification non écoulé ne déclenche rien (pas d'arrêt prématuré)", () => {
    // `lastChecked` frais : la fonction sort avant toute décision.
    const fingerprint = buildToolLoopFingerprint("edit", { path: "a.js", oldText: "a", newText: "b" });
    const stops = [];
    const fn = new Function(
      "INVISIBLE_LOOP_CHECK_INTERVAL_MS",
      "INVISIBLE_LOOP_BUFFER_MIN",
      "detectRepeatedToolCalls",
      "detectRepeatedBlock",
      "detectRepeatedWord",
      "detectSemanticLoop",
      "appendSystemMessage",
      "stopInvisibleAgent",
      `return ${FN_BODY};`,
    )(
      intervalMs,
      bufferMin,
      detectRepeatedToolCalls,
      detectRepeatedBlock,
      detectRepeatedWord,
      detectSemanticLoop,
      () => {},
      (...args) => stops.push(args),
    );
    const loop = { buffer: "", lastText: "", lastChecked: Date.now(), stopped: false, toolCalls: [fingerprint, fingerprint, fingerprint] };
    fn(null, loop, "agent-1", "C:/p");
    expect(stops).toEqual([]);
  });

  it("seuils de production inchangés (intervalle et taille minimale du buffer)", () => {
    expect(intervalMs).toBe(500);
    expect(bufferMin).toBe(200);
  });
});
