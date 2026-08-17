// agents-bus.js — Bus d'exécution inter-agents (H2 V2, spec_gestion_agents.md).
// Ordonnanceur séquentiel : un seul agent stream à la fois.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { backendKind } from "./backend-info.js";
import { notifyAgentDone } from "./desktop-notify.js";
import { buildProjectContext } from "./context-engine.js";
import { buildMemoryBlock } from "./project-memory.js";
import { buildGraphBlock } from "./code-graph.js";
import {
  loadAgentRegistry,
  normalizeAgent,
  resolveAgentModel,
  buildCoordinatorManifest,
  buildAgentPrompt,
  buildResultPrompt,
  parseCallMarker,
  parseParallelMarker,
  aggregateParallelResults,
  buildDefaultCoordinator,
} from "./agents.js";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectSemanticLoop,
  detectRepeatedToolCalls,
  buildToolLoopFingerprint,
  findRepeatedTail,
  buildLoopCorrectionPrompt,
  MAX_LOOP_ESCALATION,
} from "./loop-detection.js";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TOTAL_BUDGET = 30;
const DEFAULT_TIMEOUT_MS = 600000; // 10 min d'inactivité (le codeur fait des outils longs)

// Issue #37 : détection de boucle dans la réflexion des sous-agents.
// Escalade adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies par agent et par
// run, puis abandon (voir loop-detection.js).
const AGENT_LOOP_CHECK_INTERVAL_MS = 500; // throttle du streaming
const AGENT_LOOP_BUFFER_MIN = 200; // taille min de texte avant test

let busState = {
  listeners: null,
  registry: null,
  coordinator: null,
  agents: new Map(),
  runState: "idle",
  callStack: [],
  budgetTotal: DEFAULT_TOTAL_BUDGET,
  budgetByAgent: {},
  maxDepth: DEFAULT_MAX_DEPTH,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  timeoutId: null,
  currentAgentId: null,
  // H2 V2 parallèle : ensemble des agents en train de streamer + buffers par agent.
  activeAgents: new Set(),
  streamingTextByAgent: {},
  // Issue #10 : empreintes des derniers tool calls par agent (ex: requêtes DB
  // db_query/db_execute) pour détecter une boucle d'OUTILS identiques, même
  // sans texte streamé répété.
  toolCallsByAgent: {},
  parallelGroup: null, // { assignments, pending, results, onComplete }
  pendingPromise: null,
  isCompacting: false, // true pendant une compaction (filtre les deltas du résumé)
  // Issue #37 : état de détection de boucle par agent.
  loopCorrectionPending: {}, // agentId → true (arrêt en cours, correction à l'agent_end)
  loopCorrectionCount: {}, // agentId → nb de stratégies d'escalade déjà appliquées
  loopAbandoned: {}, // agentId → true après abandon (toutes les stratégies épuisées)
  loopLastChecked: {}, // agentId → timestamp du dernier test
  config: null,
  callbacks: {},
};

function resetBusState() {
  if (busState.timeoutId) clearTimeout(busState.timeoutId);
  busState.runState = "idle";
  busState.callStack = [];
  busState.budgetTotal = DEFAULT_TOTAL_BUDGET;
  busState.budgetByAgent = {};
  busState.timeoutId = null;
  busState.currentAgentId = null;
  busState.activeAgents = new Set();
  busState.streamingTextByAgent = {};
  busState.toolCallsByAgent = {};
  busState.parallelGroup = null;
  busState.pendingPromise = null;
  busState.isCompacting = false;
  busState.loopCorrectionPending = {};
  busState.loopCorrectionCount = {};
  busState.loopAbandoned = {};
  busState.loopLastChecked = {};
}

// Bug #9 : watchdog de sécurité du verrou de run. Si la run est marquée
// "running" mais qu'aucun agent n'est actif et qu'aucun groupe parallèle n'est
// en cours, le verrou est bloqué (fin normale/erreur sans libération). On force
// la libération pour ne pas bloquer les appels suivants à run_agents.
function releaseStuckRunLock() {
  if (busState.runState === "running" && busState.activeAgents.size === 0 && !busState.parallelGroup) {
    console.warn("[agents-bus] watchdog : verrou de run bloqué, libération forcée.");
    resetBusState();
  }
}

function emit(event, data) {
  const cb = busState.callbacks[event];
  if (cb) cb(data);
}

function resetTimeout() {
  if (busState.timeoutId) clearTimeout(busState.timeoutId);
  if (busState.runState !== "running") return;
  busState.timeoutId = setTimeout(() => {
    // Timeout d'inactivité : on signale l'erreur puis on arrête la run SANS
    // émettre l'événement "stop" (sinon l'UI afficherait « Run arrêtée par
    // l'utilisateur. » alors que l'utilisateur n'a rien fait — issue #10).
    const agentId = busState.currentAgentId;
    emit("error", { message: `Timeout d'inactivité pour ${agentId}. Augmentez le timeout dans Paramètres (agent_timeout_ms).` });
    // P7 : notification desktop à l'arrêt auto (réutilise desktop-notify.js).
    notifyAgentDone({
      title: "Pilot — Agent en timeout",
      body: `⏱️ L'agent ${agentId} est resté inactif (${Math.round(busState.timeoutMs / 1000)} s). La run a été arrêtée automatiquement.`,
    }).catch(() => {});
    stopAgentsRun({ silent: true });
  }, busState.timeoutMs);
}

function ensureBudget(agentId) {
  if (busState.budgetTotal <= 0) {
    return { ok: false, message: "Budget total d'appels épuisé." };
  }
  const agent = busState.agents.get(agentId);
  const max = agent ? agent.max_calls_per_run : 5;
  const used = busState.budgetByAgent[agentId] || 0;
  if (used >= max) {
    return { ok: false, message: `Budget d'appels épuisé pour ${agentId}.` };
  }
  return { ok: true };
}

function consumeBudget(agentId) {
  busState.budgetTotal -= 1;
  busState.budgetByAgent[agentId] = (busState.budgetByAgent[agentId] || 0) + 1;
}

function detectCycle(agentId) {
  return busState.callStack.some((entry) => entry.agentId === agentId);
}

export async function initAgentsBus(options = {}) {
  busState.callbacks = options;
  busState.config = await invoke("get_config").catch(() => ({}));

  busState.registry = await loadAgentRegistry();
  const rawAgents = Array.isArray(busState.registry.agents) ? busState.registry.agents : [];

  // Normaliser et indexer les agents du registre
  busState.agents = new Map();
  for (const raw of rawAgents) {
    const a = normalizeAgent(raw);
    if (a && a.id) busState.agents.set(a.id, a);
  }

  // Coordinateur : utiliser celui du registre s'il existe, sinon le défaut
  const regCoord = busState.agents.get("coordinateur");
  if (regCoord) {
    busState.coordinator = regCoord;
  } else {
    const fallback = resolveCoordinatorFallback();
    busState.coordinator = buildDefaultCoordinator({ pi: fallback, plh: fallback });
    busState.agents.set("coordinateur", busState.coordinator);
  }

  // Charger les garde-fous depuis la config
  busState.maxDepth = busState.config.agent_max_call_depth || DEFAULT_MAX_DEPTH;
  busState.budgetTotal = busState.config.agent_max_total_calls || DEFAULT_TOTAL_BUDGET;
  busState.timeoutMs = busState.config.agent_timeout_ms || DEFAULT_TIMEOUT_MS;

  // Écouter le canal unifié des agents
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  busState.listeners = await listen("rpc-event-agents", handleAgentEvent);
}

/**
 * Recharge la map des agents depuis le registre persistant (P4).
 * Le bus ne charge le registre qu'à l'init ; un agent créé entre-temps (ex:
 * create_agent de l'assistant) ne serait pas visible dans run_agents. On
 * re-synchronise donc la map (et le coordinateur) avant chaque run.
 */
async function reloadAgentsRegistry() {
  busState.registry = await loadAgentRegistry();
  const rawAgents = Array.isArray(busState.registry.agents) ? busState.registry.agents : [];
  busState.agents = new Map();
  for (const raw of rawAgents) {
    const a = normalizeAgent(raw);
    if (a && a.id) busState.agents.set(a.id, a);
  }
  const regCoord = busState.agents.get("coordinateur");
  if (regCoord) {
    busState.coordinator = regCoord;
  } else {
    const fallback = resolveCoordinatorFallback();
    busState.coordinator = buildDefaultCoordinator({ pi: fallback, plh: fallback });
    busState.agents.set("coordinateur", busState.coordinator);
  }
}

function resolveCoordinatorFallback() {
  // Le modèle du coordinateur se règle uniquement via l'éditeur d'agents (onglet 🎭).
  // En cas de coordinateur absent du registre (chemin défensif), on retourne "" : pas
  // de set_model → pi utilise son modèle par défaut (defaultModel du model-switch.json).
  return "";
}

export function destroyAgentsBus() {
  if (busState.timeoutId) clearTimeout(busState.timeoutId);
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  stopAllAgentProcesses();
  resetBusState();
}

let turnCount = 0;
let piTurnCount = 0;
const MAX_TURNS = 50;
const MAX_PI_TURNS_PER_AGENT = 40;

/**
 * Issue #37 : détecte une boucle dans la réflexion d'un sous-agent et, le cas
 * échéant, arrête son processus (abort) pour renvoyer ensuite une demande de
 * correction à l'agent_end. Appelé sur chaque text_delta (throttlé).
 * @param {string} agentId
 */
function maybeDetectAgentLoop(agentId) {
  if (busState.runState !== "running") return;
  if (busState.loopCorrectionPending[agentId]) return; // déjà en cours
  if (busState.loopAbandoned[agentId]) return; // déjà abandonné

  const now = Date.now();
  if (now - (busState.loopLastChecked[agentId] || 0) < AGENT_LOOP_CHECK_INTERVAL_MS) return;
  busState.loopLastChecked[agentId] = now;

  // Issue #10 : la détection d'une boucle d'OUTILS (detectRepeatedToolCalls) est
  // indépendante de la longueur du buffer texte. Un agent qui répète la même
  // requête DB (db_query/db_execute) sans streamer de texte ne remplit pas
  // forcément AGENT_LOOP_BUFFER_MIN → on vérifie les tool calls AVANT le garde
  // de longueur du buffer texte, sinon la boucle d'outils n'est jamais détectée.
  if (detectRepeatedToolCalls(busState.toolCallsByAgent[agentId])) {
    busState.loopCorrectionPending[agentId] = true;
    busState.loopCorrectionCount[agentId] = (busState.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle d'outils détectée", agentId);
    emit("notify", { agentId, message: `Boucle d'outils détectée pour l'agent ${agentId} (appels identiques répétés). Correction automatique…` });
    invoke("abort_agent_process", { agentId }).catch(() => {});
    return;
  }

  const text = busState.streamingTextByAgent[agentId] || "";
  if (text.length < AGENT_LOOP_BUFFER_MIN) return;

  if (
    detectRepeatedBlock(text) ||
    detectRepeatedWord(text) ||
    detectSemanticLoop(text)
  ) {
    busState.loopCorrectionPending[agentId] = true;
    busState.loopCorrectionCount[agentId] = (busState.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle détectée", agentId);
    emit("notify", { agentId, message: `Boucle détectée dans la réflexion de l'agent ${agentId}. Correction automatique…` });
    invoke("abort_agent_process", { agentId }).catch(() => {});
  }
}

function handleAgentEvent(ev) {
  const payload = ev.payload || {};
  const agentId = payload.agent_id;
  const event = payload.event || {};
  if (!agentId) return;

  // Ignorer les événements d'agents qui ne sont pas actifs (séquentiel : un seul
  // agent actif ; parallèle : plusieurs agents actifs simultanément).
  if (!busState.activeAgents.has(agentId)) return;
  if (busState.runState !== "running") return;

  const type = event.type;
  resetTimeout();

  if (type === "turn_start") {
    piTurnCount++;
    if (piTurnCount > MAX_PI_TURNS_PER_AGENT) {
      console.error("[agents-bus] MAX_PI_TURNS exceeded", agentId, piTurnCount);
      emit("error", { message: `L'agent ${agentId} a fait ${piTurnCount} tours pi sans terminer (max ${MAX_PI_TURNS_PER_AGENT}). Possible boucle d'outils. Arrêt forcé.` });
      stopAgentsRun({ silent: true });
      return;
    }
  }

  // Log minimal : seulement les événements clés (pas chaque delta)
  if (type !== "message_update" && type !== "tool_execution_update") {
    console.log("[agents-bus] event", type, "agent=" + agentId, "turn=" + turnCount);
  }

  if (type === "message_update") {
    const delta = event.assistantMessageEvent || {};
    console.log("[agents-bus] delta type=" + delta.type, agentId, delta.type === "text_delta" ? ("len=" + (delta.delta||"").length) : "");
    // Filtre anti-pollution (§3.4) : pendant une compaction, plh stream le
    // résumé en text_delta. Ce texte n'est PAS la réponse de l'agent — il ne
    // doit pas être accumulé dans streamingText (utilisé pour parser `[[CALL]]`
    // via parseCallMarker) ni affiché comme une réponse. On ignore donc tous
    // les deltas pendant isCompacting (même logique qu'agent-pi.js).
    if (busState.isCompacting) {
      // deltas ignorés (résumé de compaction)
    } else if (delta.type === "text_delta" && typeof delta.delta === "string") {
      busState.streamingTextByAgent[agentId] = (busState.streamingTextByAgent[agentId] || "") + delta.delta;
      emit("delta", { agentId, text: delta.delta });
      // Issue #37 : détection de boucle dans la réflexion du sous-agent.
      maybeDetectAgentLoop(agentId);
    }
  } else if (type === "message") {
    // L'event "message" apporte le message assistant COMPLET (role, stopReason,
    // content). Le texte utile est déjà streamé via message_update/text_delta
    // ci-dessus et accumulé dans streamingText ; l'accumuler à nouveau ici le
    // doublerait dans streamingText ET dans l'UI (emit delta). Le chat standard
    // (agent-pi.js) n'accumule pas non plus le "message" — on l'ignore donc pour
    // le rendu, à l'instar d'agent-pi.js.
  } else if (type === "compaction_start") {
    // Activer le filtre des deltas : pendant la compaction, le résumé est
    // streamé en text_delta (plh). On le signale à l'UI mais on n'accumule pas.
    console.log("[agents-bus] compaction_start", agentId, "reason=" + (event.reason || "?"));
    busState.isCompacting = true;
  } else if (type === "compaction_end" || type === "compaction") {
    // Désactiver le filtre et reset streamingText : la compaction est terminée,
    // la vraie réponse de l'agent (post-compaction) doit repartir proprement.
    // On n'accumule pas le résumé pour ne pas polluer parseCallMarker.
    console.log("[agents-bus] compaction_end", agentId);
    busState.isCompacting = false;
    busState.streamingTextByAgent[agentId] = "";
    busState.toolCallsByAgent[agentId] = [];
  } else if (type === "tool_execution_start") {
    const toolName = event.toolName || event.tool || "outil";
    console.log("[agents-bus] tool:", toolName, "agent=" + agentId);
    emit("toolStart", { agentId, toolName });
    // Issue #10 : accumuler une empreinte du tool call (ex: requête DB) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    const fp = buildToolLoopFingerprint(toolName, event.args || event.arguments || {});
    const arr = (busState.toolCallsByAgent[agentId] = busState.toolCallsByAgent[agentId] || []);
    // Déduplication des empreintes consécutives identiques (un même outil peut
    // être émis plusieurs fois par événement) pour ne pas déclencher trop tôt.
    if (arr[arr.length - 1] !== fp) arr.push(fp);
    maybeDetectAgentLoop(agentId);
  } else if (type === "extension_ui_request") {
    handleExtensionUiRequest(agentId, event);
  } else if (type === "agent_end") {
    // Issue #37 : si cet agent a été arrêté pour boucle, on le relance avec une
    // demande de correction au lieu de terminer son tour (reste actif). Escalade
    // adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies, puis abandon.
    if (busState.loopCorrectionPending[agentId]) {
      busState.loopCorrectionPending[agentId] = false;
      const streamed = busState.streamingTextByAgent[agentId] || "";
      busState.streamingTextByAgent[agentId] = "";
      busState.toolCallsByAgent[agentId] = [];
      piTurnCount = 0; // c'est une continuation du tour, pas un nouveau tour
      resetTimeout();
      const count = busState.loopCorrectionCount[agentId] || 0;
      if (count < MAX_LOOP_ESCALATION) {
        const level = count; // 1..MAX_LOOP_ESCALATION (déjà incrémenté à la détection)
        const repeatedTail = findRepeatedTail(streamed);
        const correction = buildLoopCorrectionPrompt(level, { repeatedTail });
        sendPromptToAgent(agentId, correction).catch((e) => {
          console.error("[agents-bus] erreur envoi correction boucle", agentId, e);
          failAgentTurn(agentId, String(e));
        });
      } else {
        busState.loopAbandoned[agentId] = true;
        emit("notify", { agentId, message: `⚠️ L'agent ${agentId} a tourné en boucle plusieurs fois. Tâche abandonnée.` });
        failAgentTurn(agentId, "Boucle de réflexion persistante (toutes les stratégies d'escalade épuisées).");
      }
      return;
    }
    turnCount++;
    piTurnCount = 0;
    console.log("[agents-bus] agent_end turn=" + turnCount, agentId);
    if (turnCount > MAX_TURNS) {
      emit("error", { message: `Boucle détectée : ${turnCount} tours (max ${MAX_TURNS}). Arrêt forcé.` });
      stopAgentsRun({ silent: true });
      return;
    }
    finishAgentTurn(agentId);
  } else if (type === "process_exit" || type === "process_error" || type === "extension_error") {
    const reason = event.reason || event.message || event.error || "processus arrêté";
    console.log("[agents-bus] process error/exit", agentId, reason);
    failAgentTurn(agentId, reason);
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text || "")
      .join("");
  }
  return "";
}

/**
 * Gère les extension_ui_request des agents : auto-répond car les agents tournent
 * de manière autonome (pas d'interaction UI manuelle possible pendant une run).
 * - notify  → affiche le message dans l'UI, pas de réponse attendue
 * - confirm → auto-approuve (l'utilisateur a explicitement demandé la tâche)
 * - select  → sélectionne la première option
 * - input   → annule (pas de saisie utilisateur possible en mode autonome)
 * - editor  → ignore (pas d'éditeur intégré pour les agents)
 */
async function handleExtensionUiRequest(agentId, event) {
  const { id, method } = event;
  console.log("[agents-bus] ext_ui_req", agentId, "method=" + method, "id=" + id, JSON.stringify(event).slice(0, 300));
  if (!id || !method) {
    console.warn("[agents-bus] ext_ui_req: missing id or method", { id, method });
    return;
  }

  if (method === "notify") {
    const msg = event.message || "";
    if (msg) emit("notify", { agentId, message: msg, notifyType: event.notifyType || "info" });
    return; // notify ne nécessite pas de réponse
  }

  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
    return; // fire-and-forget
  }

  let command;
  if (method === "confirm") {
    command = { type: "extension_ui_response", id, confirmed: true, cancelled: false };
  } else if (method === "select") {
    const options = event.options || [];
    command = options.length > 0
      ? { type: "extension_ui_response", id, value: options[0] }
      : { type: "extension_ui_response", id, cancelled: true };
  } else if (method === "input") {
    command = { type: "extension_ui_response", id, cancelled: true };
  } else if (method === "editor") {
    command = { type: "extension_ui_response", id, cancelled: true };
  } else {
    command = { type: "extension_ui_response", id, cancelled: true };
  }

  try {
    await invoke("send_agent_process_command", { agentId, command });
    console.log("[agents-bus] ext_ui_response sent", agentId, "method=" + method, "id=" + id);
  } catch (err) {
    console.error("[agents-bus] extension_ui_response error", agentId, err);
  }
}

async function finishAgentTurn(agentId) {
  const text = busState.streamingTextByAgent[agentId] || "";
  busState.streamingTextByAgent[agentId] = "";
  busState.toolCallsByAgent[agentId] = [];
  busState.activeAgents.delete(agentId);

  // ── H2 V2 parallèle : si cet agent fait partie d'un groupe parallèle, on
  // enregistre son résultat et on agrège quand tous les agents ont terminé.
  if (busState.parallelGroup && busState.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    busState.parallelGroup.results[agentId] = { status: "done", text };
    busState.parallelGroup.pending--;
    if (busState.parallelGroup.pending <= 0) {
      const group = busState.parallelGroup;
      busState.parallelGroup = null;
      await group.onComplete(group.results);
    }
    return;
  }

  // ── H2 V2 parallèle : le coordinateur (ou un agent) délègue à N agents en
  // parallèle via [[PARALLEL]]. On lance les N agents simultanément, puis on
  // renvoie le résultat agrégé à l'appelant via onComplete (pas de push sur la
  // pile : l'appelant est rappelé directement, sinon il se considérerait comme
  // son propre appelant à la fin → boucle infinie).
  const parallel = parseParallelMarker(text);
  if (parallel) {
    emit("parallelStart", { from: agentId, assignments: parallel.assignments });
    await dispatchParallel(parallel.assignments, async (results) => {
      const aggregated = aggregateParallelResults(results);
      const result = buildResultPrompt("parallel", "done", aggregated, busState.config.agent_max_result_tokens);
      emit("parallelDone", { results });
      await runAgentTurn(busState.agents.get(agentId), result);
    });
    return;
  }

  const call = parseCallMarker(text);

  if (call) {
    // L'agent actif a décidé de déléguer
    const { agentId: targetId, payload: brief } = call;
    emit("transition", { from: agentId, to: targetId });

    // Garde-fous
    if (busState.callStack.length >= busState.maxDepth) {
      const result = buildResultPrompt(targetId, "error", `Profondeur max (${busState.maxDepth}) atteinte.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result);
      return;
    }
    const budgetCheck = ensureBudget(targetId);
    if (!budgetCheck.ok) {
      const result = buildResultPrompt(targetId, "error", budgetCheck.message, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result);
      return;
    }
    if (detectCycle(targetId)) {
      const result = buildResultPrompt(targetId, "error", `Cycle détecté : ${targetId} est déjà dans la pile.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result);
      return;
    }
    const targetAgent = busState.agents.get(targetId);
    if (!targetAgent) {
      const result = buildResultPrompt(targetId, "error", `Agent "${targetId}" inconnu.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result);
      return;
    }

    consumeBudget(targetId);
    busState.callStack.push({ agentId, textBeforeCall: call.before });

    // Lancer / réinitialiser l'agent cible et lui envoyer le brief
    await runAgentTurn(targetAgent, brief);
    return;
  }

  // L'agent a terminé son tour : renvoyer le résultat à l'appelant, ou finir la run
  if (busState.callStack.length > 0) {
    const caller = busState.callStack.pop();
    const result = buildResultPrompt(agentId, "done", text, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result);
  } else {
    // Fin de la run : coordinateur a répondu
    if (!text || !text.trim()) {
      emit("error", { message: `L'agent ${agentId} n'a produit aucune réponse textuelle. Il a peut-être utilisé des outils sans générer de texte final. Réessayez en reformulant votre demande.` });
      resetBusState();
      return;
    }
    emit("done", { agentId, text });
    resetBusState();
  }
}

async function failAgentTurn(agentId, reason) {
  busState.streamingTextByAgent[agentId] = "";
  busState.toolCallsByAgent[agentId] = [];
  busState.activeAgents.delete(agentId);
  // H2 V2 parallèle : si l'agent fait partie d'un groupe parallèle, on enregistre
  // l'erreur et on agrège quand tous les agents ont terminé (ou échoué).
  if (busState.parallelGroup && busState.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    busState.parallelGroup.results[agentId] = { status: "error", text: reason };
    busState.parallelGroup.pending--;
    if (busState.parallelGroup.pending <= 0) {
      const group = busState.parallelGroup;
      busState.parallelGroup = null;
      await group.onComplete(group.results);
    }
    return;
  }
  if (busState.callStack.length > 0) {
    const caller = busState.callStack.pop();
    const result = buildResultPrompt(agentId, "error", `Erreur de l'agent ${agentId} : ${reason}`, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result);
  } else {
    emit("error", { message: `Erreur de l'agent ${agentId} : ${reason}` });
    resetBusState();
  }
}

export async function startAgentsRun(userPrompt, projectContext = "") {
  releaseStuckRunLock();
  if (busState.runState === "running") {
    throw new Error("Une run est déjà en cours.");
  }
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }

  resetBusState();
  busState.runState = "running";
  busState.currentAgentId = busState.coordinator.id;
  busState.callStack = [];
  turnCount = 0;

  const manifest = buildCoordinatorManifest(Array.from(busState.agents.values()));
  const brief = `${userPrompt}\n\n${manifest}`;

  emit("start", { agentId: busState.coordinator.id, prompt: userPrompt });
  await runAgentTurn(busState.coordinator, brief, projectContext);
}

/**
 * H2 V2 parallèle : lance N agents simultanément sur des briefs distincts
 * (mode piloté par l'utilisateur, sans coordinateur). Quand tous ont terminé,
 * émet `parallelDone` puis `done` avec le résultat agrégé.
 * `assignments` : [{ agentId, brief }].
 */
export async function startParallelRun(assignments, projectContext = "") {
  releaseStuckRunLock();
  if (busState.runState === "running") {
    throw new Error("Une run est déjà en cours.");
  }
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }

  resetBusState();
  busState.runState = "running";
  busState.callStack = [];
  turnCount = 0;

  emit("start", { agentId: "parallel", prompt: assignments.map((a) => a.agentId).join(", ") });
  try {
    await dispatchParallel(assignments, async (results) => {
      const aggregated = aggregateParallelResults(results);
      emit("parallelDone", { results });
      emit("done", { agentId: "parallel", text: aggregated });
      // Bug #9 : libérer le verrou de run à la fin normale (ou erreur agrégée)
      // de la run parallèle. Sans ce reset, runState restait "running" et les
      // appels suivants à run_agents échouaient avec « Une run est déjà en cours ».
      resetBusState();
    });
  } catch (e) {
    // Sécurité : si dispatchParallel échoue de façon synchrone, libérer le verrou.
    resetBusState();
    throw e;
  }
}

// Lance la run d'agents et route le résultat vers `onDone` / `onError`.
// Cœur commun des deux variantes (bloquante et non bloquante).
function _runAgentsForAssistant(assignments, onDone, onError) {
  const prevCallbacks = busState.callbacks;
  // Bug #9 : garde anti double-résolution — le callback ne doit être appelé
  // qu'une seule fois (done/error/stop/échec de startParallelRun).
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    busState.callbacks = prevCallbacks;
    fn(value);
  };
  busState.callbacks = {
    ...prevCallbacks,
    done: ({ text }) => finish(onDone, text || ""),
    error: ({ message }) => finish(onError, new Error(message || "Erreur de la run agents.")),
    stop: () => finish(onError, new Error("Run agents arrêtée.")),
  };
  startParallelRun(assignments).catch((e) => finish(onError, e));
}

/**
 * Lance une run sur des agents sélectionnés (coordinateur assistant) et retourne
 * une Promise résolue avec le résultat agrégé (texte) ou rejetée en cas d'erreur.
 * Utilisé par l'outil `run_agents` de l'assistant (spec_super_agent.md) :
 * l'assistant choisit quels agents utiliser et reçoit le résultat pour continuer
 * son raisonnement. Les agents sélectionnés tournent en parallèle (feuilles).
 * @param {Array<{agentId:string, brief:string}>} assignments
 * @returns {Promise<string>}
 */
export async function runAgentsForAssistant(assignments) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  // P4 : re-synchroniser la map des agents depuis le registre persistant pour
  // qu'un agent créé entre-temps (create_agent) soit visible/sélectionnable.
  await reloadAgentsRegistry();
  return new Promise((resolve, reject) => {
    _runAgentsForAssistant(assignments, resolve, reject);
  });
}

/**
 * Variante NON bloquante de `runAgentsForAssistant` : lance la run en
 * arrière-plan et retourne immédiatement. Le résultat est délivré via les
 * callbacks `onDone(text)` / `onError(err)` à la fin de la run. Utilisée par
 * l'assistant (outil `run_agents`) pour ne pas bloquer son tour (et donc
 * l'input utilisateur) pendant que les agents travaillent.
 */
export async function runAgentsForAssistantAsync(assignments, onDone, onError) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  await reloadAgentsRegistry();
  _runAgentsForAssistant(assignments, onDone, onError);
}

export function stopAgentsRun(options = {}) {
  if (busState.runState !== "running") return;
  busState.runState = "stopping";
  // H2 V2 parallèle : abort tous les agents actifs (pas seulement le dernier).
  for (const agentId of busState.activeAgents) {
    invoke("abort_agent_process", { agentId }).catch(() => {});
  }
  // `silent: true` pour les arrêts automatiques (timeout, boucle, trop de tours) :
  // le message d'erreur a déjà été émis via "error". Le message « Run arrêtée par
  // l'utilisateur. » ne doit apparaître que pour un arrêt manuel (issue #10).
  if (!options.silent) {
    emit("stop", {});
  }
  resetBusState();
}

export async function stopAllAgentProcesses() {
  await invoke("stop_all_agent_processes").catch(() => {});
}

async function runAgentTurn(agent, brief, projectContext = "") {
  if (!agent) {
    emit("error", { message: "Agent introuvable pour ce tour." });
    resetBusState();
    return;
  }

  busState.currentAgentId = agent.id;
  busState.activeAgents.add(agent.id);
  busState.streamingTextByAgent[agent.id] = "";
  busState.isCompacting = false; // par sécurité si une compaction a été interrompue sans compaction_end

  const backend = backendKind();
  const prompt = buildAgentPrompt(agent, brief, projectContext, backend, "");
  const model = resolveAgentModel(agent, backend, "");
  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");

  const cwd = window._pilotProjectPath || ".";
  const cfg = busState.config || {};
  const piPath = cfg.rpc_pi_path || "";
  const noSession = !agent.keep_context;

  console.log("[agents-bus] turn", { agentId: agent.id, model, provider: provider || "(none)", modelId: modelId || "(none)", cwd });

  emit("agentStart", { agentId: agent.id, model });

  try {
    // #21 : héritage de contexte pour les agents spécifiques de l'assistant.
    // Quand le paramètre est activé, on écrit le handoff de contexte (comme
    // l'agent standard) pour que l'extension pilot-context.ts l'injecte en
    // plus du rôle propre de l'agent cible (concaténation).
    if (cfg.super_agent_inherit_context === true) {
      try {
        const config = await invoke("get_config");
        let handoffBlocks = "";
        if (config) {
          if (config.project_memory_enabled !== false) {
            const memBlock = await buildMemoryBlock(cwd);
            if (memBlock) handoffBlocks += memBlock;
          }
          if (config.context_engine_enabled !== false) {
            const ctxOpts = {
              enabled: true,
              budgetTokens: config.context_budget_tokens || 8000,
              includeImports: config.context_include_imports !== false,
              includeSpecs: config.context_include_specs !== false,
              includeRecents: config.context_include_recents !== false,
              ragEnabled: config.context_rag_enabled === true,
              ragEndpoint: config.context_rag_endpoint || "http://127.0.0.1:11434",
              ragModel: config.context_rag_model || "nomic-embed-text",
              prompt: brief,
            };
            const ctxBlock = await Promise.race([
              buildProjectContext(cwd, null, [], ctxOpts),
              new Promise((_, reject) => setTimeout(() => reject(new Error("context-engine timeout (8s)")), 8000)),
            ]).catch((e) => { console.warn("[agents-bus] contexte abandonné:", e); return null; });
            if (ctxBlock) handoffBlocks += ctxBlock;
          }
          if (config.code_graph_enabled !== false) {
            const graphBlock = await buildGraphBlock(cwd, brief, {
              enabled: true,
              injectModeA: config.graph_inject_mode_a !== false,
              budgetTokens: config.graph_budget_tokens || 4000,
              injectModeB: config.graph_inject_mode_b !== false,
            });
            if (graphBlock) handoffBlocks += graphBlock;
          }
        }
        if (handoffBlocks) {
          await invoke("write_context_handoff", { projectPath: cwd, content: handoffBlocks });
        }
      } catch (e) {
        console.warn("[agents-bus] échec écriture handoff contexte:", e);
      }
    }

    await invoke("start_agent_process", {
      agentId: agent.id,
      cwd,
      piPath,
      noSession,
    });

    if (!agent.keep_context) {
      await invoke("new_agent_process_session", { agentId: agent.id });
    }

    if (provider && modelId) {
      await invoke("set_agent_process_model", {
        agentId: agent.id,
        provider,
        modelId,
      });
    }

    await sendPromptToAgent(agent.id, prompt);
    resetTimeout();
    console.log("[agents-bus] prompt sent to", agent.id);
  } catch (err) {
    console.error("[agents-bus] runAgentTurn error", agent.id, err);
    failAgentTurn(agent.id, String(err));
  }
}

async function sendPromptToAgent(agentId, message) {
  await invoke("send_agent_process_prompt", { agentId, message });
}

/**
 * H2 V2 parallèle : lance N agents simultanément (chacun dans son propre
 * processus pi), attend que tous aient terminé, puis appelle `onComplete` avec
 * les résultats agrégés { agentId: { status, text } }.
 * Les agents parallèles sont des agents « feuille » : ils exécutent leur brief
 * et retournent leur résultat (pas de délégation [[CALL]] imbriquée en V1).
 */
async function dispatchParallel(assignments, onComplete) {
  busState.parallelGroup = {
    assignments,
    pending: assignments.length,
    results: {},
    onComplete,
  };
  for (const a of assignments) {
    const agent = busState.agents.get(a.agentId);
    if (!agent) {
      busState.parallelGroup.results[a.agentId] = { status: "error", text: `Agent "${a.agentId}" inconnu.` };
      busState.parallelGroup.pending--;
      continue;
    }
    const budgetCheck = ensureBudget(a.agentId);
    if (!budgetCheck.ok) {
      busState.parallelGroup.results[a.agentId] = { status: "error", text: budgetCheck.message };
      busState.parallelGroup.pending--;
      continue;
    }
    consumeBudget(a.agentId);
    await runAgentTurn(agent, a.brief);
  }
  // Si tous les agents ont échoué au démarrage (inconnus / budget), on agrège
  // immédiatement sans attendre d'agent_end.
  if (busState.parallelGroup && busState.parallelGroup.pending <= 0) {
    const group = busState.parallelGroup;
    busState.parallelGroup = null;
    await group.onComplete(group.results);
  }
}

// Exposition minimale de l'état pour l'UI (lecture seule recommandée).
if (typeof window !== "undefined") {
  window.__agentBusState = busState;
}
