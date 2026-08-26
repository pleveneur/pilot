// agents-bus.js — Bus d'exécution inter-agents (H2 V2, spec_gestion_agents.md).
// Ordonnanceur : un seul agent stream à la fois PAR PROJET. Depuis T1, l'état de
// run est INDEXÉ PAR PROJET (busState.runs[project]) : le même type d'agent peut
// tourner en parallèle sur des PROJETS DIFFÉRENTS (architecte sur A pendant
// architecte sur B), tout en conservant l'exclusivité d'un type d'agent sur le
// MÊME projet (gérée côté Rust par la clé composite session_key(project,
// agent_id) + frontend exclusivity-queue.js, clé project\u{1f}agent_id).

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
  classifyAgent,
} from "./agents.js";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectSemanticLoop,
  detectRepeatedToolCalls,
  detectRepeatedActions,
  buildToolLoopFingerprint,
  findRepeatedTail,
  buildLoopCorrectionPrompt,
  MAX_LOOP_ESCALATION,
} from "./loop-detection.js";
import {
  enqueueExclusivity,
  dequeueExclusivity,
  isAgentActiveOnProject as isAgentActiveOnProjectSessions,
} from "./exclusivity-queue.js";
import { isProjectReservedBy, deleteReservations } from "./reservations.js";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TOTAL_BUDGET = 30;
const DEFAULT_TIMEOUT_MS = 600000; // 10 min d'inactivité (le codeur fait des outils longs)

// Issue #37 : détection de boucle dans la réflexion des sous-agents.
// Escalade adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies par agent et par
// run, puis abandon (voir loop-detection.js).
const AGENT_LOOP_CHECK_INTERVAL_MS = 500; // throttle du streaming
const AGENT_LOOP_BUFFER_MIN = 200; // taille min de texte avant test

// P0-2 : outils de LECTURE PURE (sans effet de bord). Les répéter est de
// l'exploration légitime (lire un gros fichier en plusieurs lectures, faire des
// recherches). Ils ne sont PAS enregistrés dans l'historique de détection de
// boucle (donc PAS comptés) pour éviter les faux positifs qui coupent des
// sous-agents qui font des recherches/lectures légitimes. Seuls les outils qui
// MODIFIENT réellement l'état ou exécutent (bash, write, edit, db_execute, …)
// restent détectés. Même liste que agent-pi.js (README_READ_ONLY_TOOLS).
const AGENT_READ_ONLY_TOOLS = new Set([
  "read",
  "search",
  "grep",
  "glob",
  "list",
  "ls",
  "find",
  "read_project_file",
  "search_project",
]);

// ── T1 : contexte de run PAR PROJET ─────────────────────────────────────────
// Tout l'état mutable d'une run vit dans un `runCtx` indexé par projet dans
// `busState.runs[project]`. Deux runs sur des projets DIFFÉRENTS ont donc des
// contextes indépendants (même type d'agent autorisé en parallèle sur des
// projets distincts). `maxDepth` et `timeoutMs` restent globaux (config).
function newRunCtx(project) {
  return {
    project,
    runState: "idle", // "idle" | "running" | "stopping"
    callStack: [],
    budgetTotal: DEFAULT_TOTAL_BUDGET,
    budgetByAgent: {},
    timeoutId: null,
    currentAgentId: null,
    // H2 V2 parallèle : ensemble des agents en train de streamer + buffers par agent.
    activeAgents: new Set(),
    streamingTextByAgent: {},
    // Issue #10 : empreintes des derniers tool calls par agent (ex: requêtes DB
    // db_query/db_execute) pour détecter une boucle d'OUTILS identiques, même
    // sans texte streamé répété.
    toolCallsByAgent: {},
    // Issue : empreintes des derniers tool calls de LECTURE PURE par agent
    // (read/search/grep/list/glob/find). Exclus du comptage principal (P0-2,
    // faux positifs sur l'exploration légitime) mais suivis dans un historique
    // SÉPARÉ avec un seuil plus élevé pour détecter une boucle soutenue de
    // lectures/recherches identiques (ex: architecte qui relit le même fichier).
    readOnlyToolCallsByAgent: {},
    // Compteur de tours pi PAR AGENT (pas global) : en run parallèle, chaque
    // agent a son propre budget. Un agent qui enchaîne des turn_start légitimes
    // (ex: plusieurs tool calls) ne doit pas être coupé à cause des tours des
    // autres agents. La vraie boucle d'outils est détectée en amont par
    // maybeDetectAgentLoop ; ce compteur n'est qu'un filet de sécurité.
    piTurnCountByAgent: {},
    parallelGroup: null, // { assignments, pending, results, onComplete }
    pendingPromise: null,
    isCompacting: false, // true pendant une compaction (filtre les deltas du résumé)
    // Issue #37 : état de détection de boucle par agent.
    loopCorrectionPending: {}, // agentId → true (arrêt en cours, correction à l'agent_end)
    loopCorrectionCount: {}, // agentId → nb de stratégies d'escalade déjà appliquées
    loopAbandoned: {}, // agentId → true après abandon (toutes les stratégies épuisées)
    loopLastChecked: {}, // agentId → timestamp du dernier test
    // Ciblage de projet (run_agents) : agentId → cwd du projet (toujours égal à
    // ctx.project dans ce contexte). Utilisé pour router les commandes
    // (abort/command/prompt) vers la bonne session pendant le tour.
    agentProject: {},
    // Bug #9 : horodatage de la dernière activité réelle (événement agent reçu).
    // Utilisé par le watchdog releaseStuckRunLock comme garde de temps : si le
    // verrou est "running" sans activité depuis trop longtemps, on le libère.
    lastActivityAt: null,
    // T5 : file d'attente d'exclusivité des spécialités par projet. Clé
    // `project\u{1f}agent_id` → file d'assignments en attente. Quand un agent de
    // même agent_id est déjà actif sur le même projet, la demande est mise en
    // attente et lancée automatiquement à la fin de la tâche en cours.
    exclusivityQueue: {},
    // Filet de sécurité par run : nombre de tours agent (détection boucle).
    turnCount: 0,
  };
}

let busState = {
  listeners: null,
  autoStopListener: null,
  registry: null,
  coordinator: null,
  agents: new Map(),
  config: null,
  callbacks: {},
  // Config dérivée, partagée entre toutes les runs (lecture seule pendant l'exécution).
  maxDepth: DEFAULT_MAX_DEPTH,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  // T1 : état de run INDEXÉ PAR PROJET. Clé = projet (cwd) de la run.
  runs: {}, // project → runCtx
};

// T1 : helpers purs d'accès à l'état de run PAR PROJET. Un appel sans projet
// (clé ".") couvre le projet actif implicite.
// Agents d'assistant (tâche #140) : projet réservé (jamais un vrai chemin de
// projet). Quand une run cible ce token, l'agent tourne dans l'espace réservé
// `~/.pilot/assistant/` : pas de contexte projet injecté, commandes IPC dédiées
// (start_assistant_agent_process / send_assistant_agent_prompt), clé de run
// distincte. Doit rester distinct de "" (super-agent) et de tout projet réel.
export const ASSISTANT_SPACE = "__assistant__";

function runKey(project) {
  return project || ".";
}

/**
 * Retourne le contexte de run du projet, en le créant s'il n'existe pas.
 * @param {string} [project]
 * @returns {object} runCtx
 */
function getRunCtx(project) {
  const key = runKey(project);
  if (!busState.runs[key]) busState.runs[key] = newRunCtx(key);
  return busState.runs[key];
}

/**
 * État de run d'un projet ("idle" par défaut). Helper pur utilisé par
 * startParallelRun (garde), isRunInProgress et le watchdog.
 * @param {string} [project]
 * @returns {string}
 */
export function getRunState(project) {
  const ctx = busState.runs[runKey(project)];
  return ctx ? ctx.runState : "idle";
}

/**
 * Démarre une run sur un projet : réinitialise un contexte neuf puis le passe
 * en "running". Ne touche PAS aux contextes des autres projets.
 * @param {string} [project]
 * @returns {object} runCtx neuf en état "running"
 */
export function beginRun(project) {
  const key = runKey(project);
  const fresh = newRunCtx(key);
  const ctx = getRunCtx(key);
  for (const k of Object.keys(fresh)) if (k !== "project") ctx[k] = fresh[k];
  ctx.budgetTotal = (busState.config && busState.config.agent_max_total_calls) || DEFAULT_TOTAL_BUDGET;
  ctx.runState = "running";
  return ctx;
}

/**
 * Termine une run sur un projet : supprime uniquement son contexte (libère le
 * verrou de run projet-scopé). Ne touche PAS aux runs des autres projets.
 * @param {string} [project]
 */
export function endRun(project) {
  const ctx = busState.runs[runKey(project)];
  if (ctx && ctx.timeoutId) clearTimeout(ctx.timeoutId);
  delete busState.runs[runKey(project)];
}

// Réinitialise tous les contextes de run (utilisé par destroyAgentsBus et
// stopAgentsRun). stopAgentsRun reste volontairement GLOBAL (l'utilisateur
// arrête tout) : on nettoie l'ensemble des runs.
function clearAllRuns() {
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
  }
  busState.runs = {};
}

// Bug #9 : watchdog de sécurité du verrou de run, SCOpÉ au projet. Si la run
// d'un projet est marquée "running" mais qu'aucun agent n'est réellement en
// train de streamer, le verrou de CE projet est bloqué. On force sa libération
// (endRun) pour ne pas bloquer les appels suivants à run_agents sur ce projet.
async function releaseStuckRunLock(project) {
  const key = runKey(project);
  if (getRunState(key) !== "running") return;
  const ctx = busState.runs[key];

  // 1. Cas nominal : aucun agent actif et aucun groupe parallèle en cours →
  //    verrou bloqué (fin normale/erreur sans libération).
  const noActive = ctx.activeAgents.size === 0;
  const noParallel = !ctx.parallelGroup || ctx.parallelGroup.pending <= 0;
  if (noActive && noParallel) {
    console.warn("[agents-bus] watchdog : verrou de run bloqué (aucun agent actif), libération forcée.");
    endRun(key);
    return;
  }

  // 2. Groupe parallèle résiduel : objet non nul mais pending <= 0 (tous les
  //    agents ont terminé/échoué sans que onComplete n'ait libéré le verrou).
  if (ctx.parallelGroup && ctx.parallelGroup.pending <= 0) {
    console.warn("[agents-bus] watchdog : groupe parallèle résiduel (pending<=0), libération forcée.");
    endRun(key);
    return;
  }

  // 3. Agents fantômes : activeAgents non vide mais aucun processus réellement
  //    vivant (sessions supprimées à la fermeture du projet / arrêt des
  //    processus sans événement agent_end/process_exit).
  if (ctx.activeAgents.size > 0) {
    const alive = await anyActiveAgentAlive(key);
    if (!alive) {
      console.warn("[agents-bus] watchdog : agents fantômes (aucun processus vivant), libération forcée.");
      endRun(key);
      return;
    }
  }

  // 4. Garde de temps : verrou "running" sans activité réelle depuis trop
  //    longtemps (filet de sécurité si la sonde de vivacité est indisponible).
  if (ctx.lastActivityAt && Date.now() - ctx.lastActivityAt > busState.timeoutMs) {
    console.warn("[agents-bus] watchdog : verrou de run inactif depuis trop longtemps, libération forcée.");
    endRun(key);
  }
}

// Sonde de vivacité : retourne true si au moins un agent actif de la run du
// projet a une session de processus réellement vivante (list_agent_sessions).
// Utilisée par releaseStuckRunLock pour distinguer un agent fantôme d'un agent
// qui stream encore. En cas d'erreur de sonde, on retourne true (prudence).
async function anyActiveAgentAlive(project) {
  const key = runKey(project);
  const ctx = busState.runs[key];
  if (!ctx) return false;
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    for (const agentId of ctx.activeAgents) {
      const proj = ctx.agentProject[agentId] || null;
      // Préférer une correspondance (agent, projet) ; sinon n'importe quelle
      // session vivante de cet agent (prudence).
      const byProject = sessions.find((s) => s.agent === agentId && s.alive && (proj === null || s.project === proj));
      if (byProject) return true;
      const byAgent = sessions.find((s) => s.agent === agentId && s.alive);
      if (byAgent) return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

function emit(event, data) {
  const cb = busState.callbacks[event];
  if (cb) cb(data);
}

/**
 * T5 : indique si un agent multi-rôles H2 V2 est déjà actif sur un projet donné.
 * Vérifie d'abord l'état local (agents des runs en cours), puis les sessions
 * vivantes via `list_agent_sessions` (agents de runs précédentes encore actifs).
 * Fail-open : en cas d'erreur de sonde, on ne bloque pas (prudence).
 * @param {string} agentId
 * @param {string} project
 * @returns {Promise<boolean>}
 */
async function isAgentActiveOnProject(agentId, project) {
  // 1. Local : agent déjà actif dans une run en cours sur ce projet.
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.activeAgents.has(agentId) && ctx.project === project) return true;
  }
  // 2. Sessions vivantes (agents de runs précédentes encore actifs).
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    return isAgentActiveOnProjectSessions(sessions, agentId, project);
  } catch (e) {
    return false;
  }
}

/**
 * T5 : permet au frontend (super-agent.js) d'enregistrer un callback de
 * notification pour informer l'assistant des événements de file d'attente
 * (demande en attente / démarrage). Conservé par `_runAgentsForAssistant`
 * (spread de prevCallbacks).
 * @param {function} fn - ({ agentId, message }) => void
 */
export function setBusNotifyCallback(fn) {
  busState.callbacks.notify = fn;
}

/**
 * T5 : libère le créneau (project, agent_id) quand un agent termine (ou échoue)
 * son tour. S'il y a une demande en file d'attente pour ce couple, on la lance
 * immédiatement (même agent, même projet). Elle reste dans le groupe parallèle
 * courant : `dispatchParallel` a conservé son `pending` au moment de la mise en
 * file, donc la run ne se termine pas avant que la demande en attente ne se soit
 * réellement exécutée.
 */
async function launchNextQueued(agentId, project) {
  const ctx = getRunCtx(project);
  const next = dequeueExclusivity(ctx.exclusivityQueue, agentId, project);
  if (!next) return;
  const id = next.agentId || agentId;
  const agent = busState.agents.get(id);
  if (!agent) {
    // Agent introuvable : enregistrer un résultat d'erreur dans le groupe
    // parallèle afin que la run ne reste pas bloquée (pending conservé).
    if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === id)) {
      ctx.parallelGroup.results[id] = { status: "error", text: `Agent "${id}" introuvable.` };
      ctx.parallelGroup.pending--;
    }
    return;
  }
  emit("notify", { agentId: id, message: `▶️ L'agent ${id} démarre sa tâche en file d'attente sur ce projet.` });
  await runAgentTurn(agent, next.brief, "", next.project || project, undefined);
}

function resetTimeout(ctx) {
  ctx.lastActivityAt = Date.now();
  if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
  if (ctx.runState !== "running") return;
  ctx.timeoutId = setTimeout(() => {
    // Timeout d'inactivité : on signale l'erreur puis on arrête la run SANS
    // émettre l'événement "stop" (sinon l'UI afficherait « Run arrêtée par
    // l'utilisateur. » alors que l'utilisateur n'a rien fait — issue #10).
    const agentId = ctx.currentAgentId;
    emit("error", { message: `Timeout d'inactivité pour ${agentId}. Augmentez le timeout dans Paramètres (agent_timeout_ms).` });
    // P7 : notification desktop à l'arrêt auto (réutilise desktop-notify.js).
    notifyAgentDone({
      title: "Pilot — Agent en timeout",
      body: `⏱️ L'agent ${agentId} est resté inactif (${Math.round(busState.timeoutMs / 1000)} s). La run a été arrêtée automatiquement.`,
    }).catch(() => {});
    stopAgentsRun({ silent: true });
  }, busState.timeoutMs);
}

function ensureBudget(agentId, ctx) {
  if (ctx.budgetTotal <= 0) {
    return { ok: false, message: "Budget total d'appels épuisé." };
  }
  const agent = busState.agents.get(agentId);
  const max = agent ? agent.max_calls_per_run : 5;
  const used = ctx.budgetByAgent[agentId] || 0;
  if (used >= max) {
    return { ok: false, message: `Budget d'appels épuisé pour ${agentId}.` };
  }
  return { ok: true };
}

function consumeBudget(agentId, ctx) {
  ctx.budgetTotal -= 1;
  ctx.budgetByAgent[agentId] = (ctx.budgetByAgent[agentId] || 0) + 1;
}

function detectCycle(agentId, ctx) {
  return ctx.callStack.some((entry) => entry.agentId === agentId);
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

  // Charger les garde-fous depuis la config (partagés entre toutes les runs)
  busState.maxDepth = busState.config.agent_max_call_depth || DEFAULT_MAX_DEPTH;
  busState.timeoutMs = busState.config.agent_timeout_ms || DEFAULT_TIMEOUT_MS;

  // Écouter le canal unifié des agents
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  busState.listeners = await listen("rpc-event-agents", handleAgentEvent);

  // T2 : écouter l'arrêt AUTOMATIQUE d'un agent délégué bloqué (émis par le
  // moniteur Rust). `stop_session` supprime l'émission `process_exit` → sans
  // cet événement, le créneau d'exclusivité (file d'attente, launchNextQueued)
  // ne serait jamais libéré. On termine le tour de l'agent via failAgentTurn
  // pour libérer le créneau et laisser un agent en attente prendre le relais.
  if (busState.autoStopListener) {
    busState.autoStopListener();
    busState.autoStopListener = null;
  }
  busState.autoStopListener = await listen("agent-auto-stopped", (ev) => {
    const p = ev.payload || {};
    const agentId = p.agent;
    if (!agentId) return;
    // Router vers le contexte de run du projet concerné.
    let ctx = null;
    for (const key of Object.keys(busState.runs)) {
      if (busState.runs[key].activeAgents.has(agentId)) { ctx = busState.runs[key]; break; }
    }
    if (!ctx || ctx.runState !== "running") return;
    const reason = p.reason || "arrêt automatique (bloqué sans progression)";
    console.warn("[agents-bus] arrêt automatique de l'agent", agentId, reason);
    emit("notify", {
      agentId,
      message: `⏱️ L'agent ${agentId} a été arrêté automatiquement (bloqué sans progression). Un agent en file d'attente peut prendre le relais.`,
    });
    // Libère le créneau d'exclusivité (launchNextQueued) et fait échouer le tour.
    failAgentTurn(agentId, `Agent arrêté automatiquement : ${reason}`, ctx);
  });
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
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
  }
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  if (busState.autoStopListener) {
    busState.autoStopListener();
    busState.autoStopListener = null;
  }
  stopAllAgentProcesses();
  clearAllRuns();
}

// Filet de sécurité par agent (en dernier recours) : la vraie boucle d'outils
// est détectée en amont par maybeDetectAgentLoop. 60 tours pi par agent laisse
// de la marge aux agents qui font beaucoup de tool calls légitimes sans les
// couper à tort (le compteur global partagé les coupait dès 40 en run parallèle).
const MAX_PI_TURNS_PER_AGENT = 60;
const MAX_TURNS = 50;

/**
 * Issue #37 : détecte une boucle dans la réflexion d'un sous-agent et, le cas
 * échéant, arrête son processus (abort) pour renvoyer ensuite une demande de
 * correction à l'agent_end. Appelé sur chaque text_delta (throttlé).
 * @param {string} agentId
 * @param {object} ctx - contexte de run du projet
 */
function maybeDetectAgentLoop(agentId, ctx) {
  if (ctx.runState !== "running") return;
  if (ctx.loopCorrectionPending[agentId]) return; // déjà en cours
  if (ctx.loopAbandoned[agentId]) return; // déjà abandonné

  const now = Date.now();
  if (now - (ctx.loopLastChecked[agentId] || 0) < AGENT_LOOP_CHECK_INTERVAL_MS) return;
  ctx.loopLastChecked[agentId] = now;

  // Issue #10 : la détection d'une boucle d'OUTILS (detectRepeatedToolCalls) est
  // indépendante de la longueur du buffer texte. Un agent qui répète la même
  // requête DB (db_query/db_execute) sans streamer de texte ne remplit pas
  // forcément AGENT_LOOP_BUFFER_MIN → on vérifie les tool calls AVANT le garde
  // de longueur du buffer texte, sinon la boucle d'outils n'est jamais détectée.
  // Issue #35 : on combine detectRepeatedToolCalls (3 appels IDENTIQUES
  // CONSÉCUTIFS) et detectRepeatedActions (fenêtre glissante : une même action
  // répétée, pas besoin de consécutivité) pour couvrir les deux formes de boucle
  // d'outils. Un agent qui enchaîne la même commande bash est arrêté dès 5
  // occurrences dans les 20 dernières actions.
  if (
    detectRepeatedToolCalls(ctx.toolCallsByAgent[agentId]) ||
    detectRepeatedActions(ctx.toolCallsByAgent[agentId]) ||
    // Issue : boucle d'outils de LECTURE PURE (read/search/grep/list/glob/find).
    // Ces outils sont exclus du comptage principal (P0-2, faux positifs sur
    // l'exploration légitime), mais un agent qui répète la MÊME lecture/recherche
    // en boucle (ex: architecte qui relit le même fichier) ne serait jamais
    // détecté. On les suit dans un historique séparé avec un seuil PLUS ÉLEVÉ
    // (minRepeat 8 dans une fenêtre de 20) pour ne déclencher que sur une boucle
    // soutenue, pas sur une exploration normale (lectures à offsets différents,
    // recherches à requêtes différentes → empreintes distinctes).
    detectRepeatedActions(ctx.readOnlyToolCallsByAgent[agentId], { minRepeat: 8 })
  ) {
    ctx.loopCorrectionPending[agentId] = true;
    ctx.loopCorrectionCount[agentId] = (ctx.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle d'outils détectée", agentId);
    emit("notify", { agentId, message: `Boucle d'outils détectée pour l'agent ${agentId} (appels identiques répétés). Correction automatique…` });
    invoke("abort_agent_process", { agentId, project: ctx.agentProject[agentId] || ctx.project || null }).catch(() => {});
    return;
  }

  const text = ctx.streamingTextByAgent[agentId] || "";
  if (text.length < AGENT_LOOP_BUFFER_MIN) return;

  if (
    detectRepeatedBlock(text) ||
    detectRepeatedWord(text) ||
    detectSemanticLoop(text)
  ) {
    ctx.loopCorrectionPending[agentId] = true;
    ctx.loopCorrectionCount[agentId] = (ctx.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle détectée", agentId);
    emit("notify", { agentId, message: `Boucle détectée dans la réflexion de l'agent ${agentId}. Correction automatique…` });
    invoke("abort_agent_process", { agentId, project: ctx.agentProject[agentId] || ctx.project || null }).catch(() => {});
  }
}

// Résout le contexte de run d'un événement agent. Le payload porte désormais le
// projet (rpc_manager.rs) → on route vers busState.runs[project]. Fallback :
// on cherche le contexte dont l'agent est actif (rétrocompat).
function runCtxForEvent(payload) {
  if (payload && payload.project) {
    const ctx = busState.runs[payload.project];
    if (ctx) return ctx;
  }
  const agentId = payload && payload.agent_id;
  if (!agentId) return null;
  for (const key of Object.keys(busState.runs)) {
    if (busState.runs[key].activeAgents.has(agentId)) return busState.runs[key];
  }
  return null;
}

function handleAgentEvent(ev) {
  const payload = ev.payload || {};
  const agentId = payload.agent_id;
  const event = payload.event || {};
  if (!agentId) return;

  // Router vers le contexte de run du bon projet (T1) : le même agent_id peut
  // tourner en parallèle sur des projets différents.
  const ctx = runCtxForEvent(payload);
  // Ignorer les événements d'agents qui ne sont pas actifs (séquentiel : un seul
  // agent actif ; parallèle : plusieurs agents actifs simultanément).
  if (!ctx || !ctx.activeAgents.has(agentId)) return;
  if (ctx.runState !== "running") return;

  const type = event.type;
  resetTimeout(ctx);

  if (type === "turn_start") {
    // Compteur de tours pi PAR AGENT (pas global) : en run parallèle, chaque
    // agent a son propre budget. Un agent qui enchaîne des turn_start légitimes
    // (ex: plusieurs tool calls) ne doit pas être coupé à cause des tours des
    // autres agents. La vraie boucle d'outils est détectée en amont par
    // maybeDetectAgentLoop (detectRepeatedToolCalls / detectRepeatedActions) ;
    // ce compteur n'est qu'un filet de sécurité en dernier recours.
    const count = (ctx.piTurnCountByAgent[agentId] || 0) + 1;
    ctx.piTurnCountByAgent[agentId] = count;
    if (count > MAX_PI_TURNS_PER_AGENT) {
      console.error("[agents-bus] MAX_PI_TURNS exceeded", agentId, count);
      emit("error", { message: `L'agent ${agentId} a fait ${count} tours pi sans terminer (max ${MAX_PI_TURNS_PER_AGENT}). Arrêt forcé.` });
      stopAgentsRun({ silent: true });
      return;
    }
  }

  // Log minimal : seulement les événements clés (pas chaque delta)
  if (type !== "message_update" && type !== "tool_execution_update") {
    console.log("[agents-bus] event", type, "agent=" + agentId, "turn=" + ctx.turnCount);
  }

  if (type === "message_update") {
    const delta = event.assistantMessageEvent || {};
    console.log("[agents-bus] delta type=" + delta.type, agentId, delta.type === "text_delta" ? ("len=" + (delta.delta||"").length) : "");
    // Filtre anti-pollution (§3.4) : pendant une compaction, plh stream le
    // résumé en text_delta. Ce texte n'est PAS la réponse de l'agent — il ne
    // doit pas être accumulé dans streamingText (utilisé pour parser `[[CALL]]`
    // via parseCallMarker) ni affiché comme une réponse. On ignore donc tous
    // les deltas pendant isCompacting (même logique qu'agent-pi.js).
    if (ctx.isCompacting) {
      // deltas ignorés (résumé de compaction)
    } else if (delta.type === "text_delta" && typeof delta.delta === "string") {
      ctx.streamingTextByAgent[agentId] = (ctx.streamingTextByAgent[agentId] || "") + delta.delta;
      emit("delta", { agentId, text: delta.delta });
      // Issue #37 : détection de boucle dans la réflexion du sous-agent.
      maybeDetectAgentLoop(agentId, ctx);
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
    ctx.isCompacting = true;
  } else if (type === "compaction_end" || type === "compaction") {
    // Désactiver le filtre et reset streamingText : la compaction est terminée,
    // la vraie réponse de l'agent (post-compaction) doit repartir proprement.
    // On n'accumule pas le résumé pour ne pas polluer parseCallMarker.
    console.log("[agents-bus] compaction_end", agentId);
    ctx.isCompacting = false;
    ctx.streamingTextByAgent[agentId] = "";
    ctx.toolCallsByAgent[agentId] = [];
    ctx.readOnlyToolCallsByAgent[agentId] = [];
  } else if (type === "tool_execution_start") {
    const toolName = event.toolName || event.tool || "outil";
    console.log("[agents-bus] tool:", toolName, "agent=" + agentId);
    emit("toolStart", { agentId, toolName });
    // Issue #10 : accumuler une empreinte du tool call (ex: requête DB) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    // P0-2 : on exclut les outils de LECTURE PURE (read/search/grep/list/ls/
    // find/glob…) du comptage — les répéter est de l'exploration légitime et
    // générait des faux positifs (sous-agents coupés pendant recherche/lecture).
    // Seules les actions qui MODIFIENT réellement sont comptées.
    if (AGENT_READ_ONLY_TOOLS.has(toolName)) {
      // P0-2 : les outils de lecture pure ne sont PAS comptés dans l'historique
      // principal (faux positifs sur l'exploration légitime). On les suit dans
      // un historique SÉPARÉ avec un seuil plus élevé (voir maybeDetectAgentLoop)
      // pour détecter une boucle soutenue de lectures/recherches identiques.
      const roFp = buildToolLoopFingerprint(toolName, event.args || event.arguments || {});
      const roArr = (ctx.readOnlyToolCallsByAgent[agentId] = ctx.readOnlyToolCallsByAgent[agentId] || []);
      roArr.push(roFp);
      if (roArr.length > 40) roArr.splice(0, roArr.length - 40);
      maybeDetectAgentLoop(agentId, ctx);
      return;
    }
    const fp = buildToolLoopFingerprint(toolName, event.args || event.arguments || {});
    const arr = (ctx.toolCallsByAgent[agentId] = ctx.toolCallsByAgent[agentId] || []);
    // Issue #35 : on accumule CHAQUE empreinte (pas de déduplication des
    // consécutives identiques). L'ancienne déduplication effondrait une séquence
    // de N commandes bash identiques en UNE seule entrée → detectRepeatedToolCalls
    // (3 consécutives) et detectRepeatedActions (5 dans une fenêtre) ne pouvaient
    // JAMAIS se déclencher, laissant un agent enchaîner ~46 tours sans détection
    // ni arrêt (incidents #4/#8/#9, issue #35). On borne la fenêtre pour éviter
    // une croissance illimitée.
    arr.push(fp);
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    maybeDetectAgentLoop(agentId, ctx);
  } else if (type === "extension_ui_request") {
    handleExtensionUiRequest(agentId, event, ctx);
  } else if (type === "agent_end") {
    // Issue #37 : si cet agent a été arrêté pour boucle, on le relance avec une
    // demande de correction au lieu de terminer son tour (reste actif). Escalade
    // adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies, puis abandon.
    if (ctx.loopCorrectionPending[agentId]) {
      ctx.loopCorrectionPending[agentId] = false;
      const streamed = ctx.streamingTextByAgent[agentId] || "";
      ctx.streamingTextByAgent[agentId] = "";
      ctx.toolCallsByAgent[agentId] = [];
      ctx.readOnlyToolCallsByAgent[agentId] = [];
      ctx.piTurnCountByAgent[agentId] = 0; // c'est une continuation du tour, pas un nouveau tour
      resetTimeout(ctx);
      const count = ctx.loopCorrectionCount[agentId] || 0;
      if (count < MAX_LOOP_ESCALATION) {
        const level = count; // 1..MAX_LOOP_ESCALATION (déjà incrémenté à la détection)
        const repeatedTail = findRepeatedTail(streamed);
        const correction = buildLoopCorrectionPrompt(level, { repeatedTail });
        sendPromptToAgent(agentId, correction, ctx).catch((e) => {
          console.error("[agents-bus] erreur envoi correction boucle", agentId, e);
          failAgentTurn(agentId, String(e), ctx);
        });
      } else {
        ctx.loopAbandoned[agentId] = true;
        emit("notify", { agentId, message: `⚠️ L'agent ${agentId} a tourné en boucle plusieurs fois. Tâche abandonnée.` });
        failAgentTurn(agentId, "Boucle de réflexion persistante (toutes les stratégies d'escalade épuisées).", ctx);
      }
      return;
    }
    ctx.turnCount++;
    ctx.piTurnCountByAgent[agentId] = 0;
    console.log("[agents-bus] agent_end turn=" + ctx.turnCount, agentId);
    if (ctx.turnCount > MAX_TURNS) {
      emit("error", { message: `Boucle détectée : ${ctx.turnCount} tours (max ${MAX_TURNS}). Arrêt forcé.` });
      stopAgentsRun({ silent: true });
      return;
    }
    finishAgentTurn(agentId, ctx);
  } else if (type === "process_exit" || type === "process_error" || type === "extension_error") {
    const reason = event.reason || event.message || event.error || "processus arrêté";
    console.log("[agents-bus] process error/exit", agentId, reason);
    failAgentTurn(agentId, reason, ctx);
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
async function handleExtensionUiRequest(agentId, event, ctx) {
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
    await invoke("send_agent_process_command", { agentId, command, project: ctx.agentProject[agentId] || ctx.project || null });
    console.log("[agents-bus] ext_ui_response sent", agentId, "method=" + method, "id=" + id);
  } catch (err) {
    console.error("[agents-bus] extension_ui_response error", agentId, err);
  }
}

// T6 : nettoie les réservations du projet quand le CODEUR termine son tour
// (finishAgentTurn) ou échoue (failAgentTurn), et à l'arrêt/annulation. Seul
// le codeur QUI A RÉSERVÉ libère les réservations écrites par l'estimation
// préalable : les spécialistes restent bloqués en écriture sur les fichiers
// réservés tant que le codeur travaille. Sans effet si le projet n'a pas de
// réservations actives ou si l'agent n'est pas le codeur propriétaire.
async function cleanupReservationsForAgent(agentId, project) {
  if (!project) return;
  const agent = busState.agents.get(agentId);
  const { isCoder } = classifyAgent(agent);
  if (!isCoder) return; // seuls les codeurs libèrent les réservations
  if (!isProjectReservedBy(project, agentId)) return; // pas son projet réservé
  await deleteReservations(project);
}

async function finishAgentTurn(agentId, ctx) {
  const text = ctx.streamingTextByAgent[agentId] || "";
  ctx.streamingTextByAgent[agentId] = "";
  ctx.toolCallsByAgent[agentId] = [];
  ctx.readOnlyToolCallsByAgent[agentId] = [];
  const project = ctx.agentProject[agentId] || ctx.project;
  // T6 : libérer les réservations du projet à la fin du tour du codeur.
  await cleanupReservationsForAgent(agentId, project);
  ctx.activeAgents.delete(agentId);
  delete ctx.agentProject[agentId];
  // T5 : le créneau (project, agent_id) est libéré → lancer la demande suivante
  // de la file d'attente, s'il y en a une.
  if (project) await launchNextQueued(agentId, project);

  // ── H2 V2 parallèle : si cet agent fait partie d'un groupe parallèle, on
  // enregistre son résultat et on agrège quand tous les agents ont terminé.
  if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    ctx.parallelGroup.results[agentId] = { status: "done", text };
    ctx.parallelGroup.pending--;
    if (ctx.parallelGroup.pending <= 0) {
      const group = ctx.parallelGroup;
      ctx.parallelGroup = null;
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
    }, undefined, project, ctx);
    return;
  }

  const call = parseCallMarker(text);

  if (call) {
    // L'agent actif a décidé de déléguer
    const { agentId: targetId, payload: brief } = call;
    emit("transition", { from: agentId, to: targetId });

    // Garde-fous
    if (ctx.callStack.length >= busState.maxDepth) {
      const result = buildResultPrompt(targetId, "error", `Profondeur max (${busState.maxDepth}) atteinte.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    const budgetCheck = ensureBudget(targetId, ctx);
    if (!budgetCheck.ok) {
      const result = buildResultPrompt(targetId, "error", budgetCheck.message, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    if (detectCycle(targetId, ctx)) {
      const result = buildResultPrompt(targetId, "error", `Cycle détecté : ${targetId} est déjà dans la pile.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    const targetAgent = busState.agents.get(targetId);
    if (!targetAgent) {
      const result = buildResultPrompt(targetId, "error", `Agent "${targetId}" inconnu.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }

    consumeBudget(targetId, ctx);
    ctx.callStack.push({ agentId, textBeforeCall: call.before });

    // Lancer / réinitialiser l'agent cible et lui envoyer le brief
    await runAgentTurn(targetAgent, brief);
    return;
  }

  // L'agent a terminé son tour : renvoyer le résultat à l'appelant, ou finir la run
  if (ctx.callStack.length > 0) {
    const caller = ctx.callStack.pop();
    const result = buildResultPrompt(agentId, "done", text, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result);
  } else {
    // Fin de la run : coordinateur a répondu. endRun (projet-scopé) ne libère
    // QUE la run de ce projet, sans toucher aux runs d'autres projets (T4).
    if (!text || !text.trim()) {
      emit("error", { message: `L'agent ${agentId} n'a produit aucune réponse textuelle. Il a peut-être utilisé des outils sans générer de texte final. Réessayez en reformulant votre demande.` });
      endRun(ctx.project);
      return;
    }
    emit("done", { agentId, text });
    endRun(ctx.project);
  }
}

async function failAgentTurn(agentId, reason, ctx) {
  ctx.streamingTextByAgent[agentId] = "";
  ctx.toolCallsByAgent[agentId] = [];
  ctx.readOnlyToolCallsByAgent[agentId] = [];
  const project = ctx.agentProject[agentId] || ctx.project;
  // T6 : libérer les réservations du projet à l'échec du tour du codeur.
  await cleanupReservationsForAgent(agentId, project);
  ctx.activeAgents.delete(agentId);
  delete ctx.agentProject[agentId];
  // T5 : le créneau (project, agent_id) est libéré → lancer la demande suivante
  // de la file d'attente, s'il y en a une.
  if (project) await launchNextQueued(agentId, project);
  // H2 V2 parallèle : si l'agent fait partie d'un groupe parallèle, on enregistre
  // l'erreur et on agrège quand tous les agents ont terminé (ou échoué).
  if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    ctx.parallelGroup.results[agentId] = { status: "error", text: reason };
    ctx.parallelGroup.pending--;
    if (ctx.parallelGroup.pending <= 0) {
      const group = ctx.parallelGroup;
      ctx.parallelGroup = null;
      await group.onComplete(group.results);
    }
    return;
  }
  if (ctx.callStack.length > 0) {
    const caller = ctx.callStack.pop();
    const result = buildResultPrompt(agentId, "error", `Erreur de l'agent ${agentId} : ${reason}`, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result);
  } else {
    emit("error", { message: `Erreur de l'agent ${agentId} : ${reason}` });
    endRun(ctx.project);
  }
}

export async function startAgentsRun(userPrompt, projectContext = "") {
  const runProject = window._pilotProjectPath || ".";
  await releaseStuckRunLock(runProject);
  if (getRunState(runProject) === "running") {
    throw new Error("Une run est déjà en cours sur ce projet.");
  }
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }

  const ctx = beginRun(runProject);
  ctx.currentAgentId = busState.coordinator.id;
  ctx.callStack = [];
  ctx.turnCount = 0;

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
export async function startParallelRun(assignments, projectContext = "", options) {
  // T2 : la run est scopée au PROJET cible (assignments[0].project, sinon projet
  // actif). Deux runs sur des projets DIFFÉRENTS peuvent tourner en parallèle.
  const runProject = (assignments && assignments[0] && assignments[0].project) || window._pilotProjectPath || ".";
  await releaseStuckRunLock(runProject);
  // T2 : garde projet-scopée — une run sur un AUTRE projet ne bloque pas.
  if (getRunState(runProject) === "running") {
    throw new Error("Une run est déjà en cours sur ce projet.");
  }
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }

  const ctx = beginRun(runProject);
  ctx.callStack = [];
  ctx.turnCount = 0;

  emit("start", { agentId: "parallel", prompt: assignments.map((a) => a.agentId).join(", ") });
  try {
    await dispatchParallel(assignments, async (results) => {
      const aggregated = aggregateParallelResults(results);
      emit("parallelDone", { results });
      emit("done", { agentId: "parallel", text: aggregated });
      // Bug #9 + T4 : libérer le verrou de run de CE PROJET à la fin normale (ou
      // erreur agrégée) de la run parallèle, sans toucher aux autres projets.
      endRun(runProject);
    }, options, runProject, ctx);
  } catch (e) {
    // Sécurité : si dispatchParallel échoue de façon synchrone, libérer le verrou.
    endRun(runProject);
    throw e;
  }
}

// Lance la run d'agents et route le résultat vers `onDone` / `onError`.
// Cœur commun des deux variantes (bloquante et non bloquante).
// `options.purge` : si vrai, purge la conversation de chaque agent avant la
// run (contexte vierge, comme le mode manuel) — utilisé par `run_agents`.
function _runAgentsForAssistant(assignments, onDone, onError, options) {
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
  startParallelRun(assignments, "", options).catch((e) => finish(onError, e));
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
export async function runAgentsForAssistant(assignments, options) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  // P4 : re-synchroniser la map des agents depuis le registre persistant pour
  // qu'un agent créé entre-temps (create_agent) soit visible/sélectionnable.
  await reloadAgentsRegistry();
  return new Promise((resolve, reject) => {
    _runAgentsForAssistant(assignments, resolve, reject, options);
  });
}

/**
 * Variante NON bloquante de `runAgentsForAssistant` : lance la run en
 * arrière-plan et retourne immédiatement. Le résultat est délivré via les
 * callbacks `onDone(text)` / `onError(err)` à la fin de la run. Utilisée par
 * l'assistant (outil `run_agents`) pour ne pas bloquer son tour (et donc
 * l'input utilisateur) pendant que les agents travaillent.
 */
export async function runAgentsForAssistantAsync(assignments, onDone, onError, options) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  await reloadAgentsRegistry();
  _runAgentsForAssistant(assignments, onDone, onError, options);
}

/**
 * Source de vérité « une run est occupée ou non » (par projet). Retourne `true`
 * si une run est en cours sur le projet donné. Sans argument (ou projet vide),
 * retourne `true` si une run est en cours sur N'IMPORTE QUEL projet (rétrocompat
 * pour isRunStillActive / watchdog global de l'assistant).
 *
 * Utilisée par l'assistant (super-agent.js, outil `run_agents`) en plus de son
 * flag local `runAgentsInFlightByProject` pour détecter TOUTES les runs en
 * cours, y compris celles lancées hors de sa file (mode manuel, run directe,
 * bus resté bloqué en "running"). Sans cette garde, une demande arrivant
 * pendant une run dont le flag local est faux passait la file puis échouait
 * brutalement avec « Une run est déjà en cours » (levé par startParallelRun).
 * @param {string} [project]
 * @returns {boolean}
 */
export function isRunInProgress(project) {
  const keys = project ? [runKey(project)] : Object.keys(busState.runs);
  return keys.some((k) => {
    const ctx = busState.runs[k];
    return ctx && (ctx.runState === "running" || ctx.runState === "stopping");
  });
}

export function stopAgentsRun(options = {}) {
  // stopAgentsRun reste volontairement GLOBAL (l'utilisateur arrête tout).
  const runningKeys = Object.keys(busState.runs).filter((k) => {
    const s = busState.runs[k].runState;
    return s === "running" || s === "stopping";
  });
  if (runningKeys.length === 0) return;
  for (const key of runningKeys) {
    const ctx = busState.runs[key];
    ctx.runState = "stopping";
    // H2 V2 parallèle : abort tous les agents actifs (pas seulement le dernier).
    for (const agentId of ctx.activeAgents) {
      invoke("abort_agent_process", { agentId, project: ctx.agentProject[agentId] || ctx.project || null }).catch(() => {});
    }
  }
  // `silent: true` pour les arrêts automatiques (timeout, boucle, trop de tours) :
  // le message d'erreur a déjà été émis via "error". Le message « Run arrêtée par
  // l'utilisateur. » ne doit apparaître que pour un arrêt manuel (issue #10).
  if (!options.silent) {
    emit("stop", {});
  }
  clearAllRuns();
}

export async function stopAllAgentProcesses() {
  await invoke("stop_all_agent_processes").catch(() => {});
}

async function runAgentTurn(agent, brief, projectContext = "", project = null, options) {
  if (!agent) {
    emit("error", { message: "Agent introuvable pour ce tour." });
    return;
  }

  // Ciblage de projet (run_agents) : cwd = projet cible si fourni, sinon projet
  // actif (rétrocompatible). Mémorisé pour router les commandes (abort/command/
  // prompt) vers la bonne session pendant le tour.
  const cwd = project || window._pilotProjectPath || ".";
  const isAssistant = cwd === ASSISTANT_SPACE;
  const ctx = getRunCtx(cwd);
  ctx.currentAgentId = agent.id;
  ctx.activeAgents.add(agent.id);
  ctx.streamingTextByAgent[agent.id] = "";
  ctx.isCompacting = false; // par sécurité si une compaction a été interrompue sans compaction_end

  const backend = backendKind();
  const prompt = buildAgentPrompt(agent, brief, projectContext, backend, "");
  const model = resolveAgentModel(agent, backend, "");
  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");

  ctx.agentProject[agent.id] = cwd;
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
    // Tâche #140 : jamais pour les agents d'assistant (hors projet) — pas de
    // contexte de projet à injecter, et pas d'extension pilot-context dans
    // l'espace assistant.
    if (cfg.super_agent_inherit_context === true && !isAssistant) {
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
            // Timeout 8s sur le bloc graphe : si un rebuild du graphe est en
            // cours (verrou global), on abandonne le bloc graphe (null) et on
            // continue le lancement de l'agent — le graphe ne doit jamais
            // bloquer indéfiniment le démarrage d'une run.
            const graphBlock = await Promise.race([
              buildGraphBlock(cwd, brief, {
                enabled: true,
                injectModeA: config.graph_inject_mode_a !== false,
                budgetTokens: config.graph_budget_tokens || 4000,
                injectModeB: config.graph_inject_mode_b !== false,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("code-graph timeout (8s)")), 8000)),
            ]).catch((e) => { console.warn("[agents-bus] bloc graphe abandonné:", e); return null; });
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

    if (isAssistant) {
      // Agent d'assistant (hors projet) : commandes IPC dédiées, session
      // réservée ASSISTANT_SPACE, processus dans l'espace ~/.pilot/assistant/.
      await invoke("start_assistant_agent_process", {
        agentId: agent.id,
        cwd,
        piPath,
        noSession,
      });
    } else {
      await invoke("start_agent_process", {
        agentId: agent.id,
        cwd,
        piPath,
        noSession,
      });
    }

    // Anti-boucle (run_agents) : si `options.purge` est vrai, on purge la
    // conversation de l'agent AVANT la tâche (contexte vierge, comme le mode
    // manuel) — indépendamment de `keep_context`. Sinon, on conserve le
    // comportement historique : nouvelle session uniquement pour les agents
    // sans `keep_context`.
    if ((options && options.purge) || !agent.keep_context) {
      await invoke("new_agent_process_session", { agentId: agent.id, project: cwd });
    }

    if (provider && modelId) {
      await invoke("set_agent_process_model", {
        agentId: agent.id,
        provider,
        modelId,
        project: cwd,
      });
    }

    if (isAssistant) {
      await sendPromptToAssistantAgent(agent.id, prompt);
    } else {
      await sendPromptToAgent(agent.id, prompt, ctx);
    }
    resetTimeout(ctx);
    console.log("[agents-bus] prompt sent to", agent.id);
  } catch (err) {
    console.error("[agents-bus] runAgentTurn error", agent.id, err);
    failAgentTurn(agent.id, String(err), ctx);
  }
}

async function sendPromptToAgent(agentId, message, ctx) {
  await invoke("send_agent_process_prompt", { agentId, message, project: ctx.agentProject[agentId] || ctx.project || null });
}

// Envoie un prompt à un agent d'assistant (hors projet) : commande IPC dédiée,
// session résolue par le service sous la clé ASSISTANT_SPACE (aucun projet).
async function sendPromptToAssistantAgent(agentId, message) {
  await invoke("send_assistant_agent_prompt", { agentId, message });
}

/**
 * H2 V2 parallèle : lance N agents simultanément (chacun dans son propre
 * processus pi), attend que tous aient terminé, puis appelle `onComplete` avec
 * les résultats agrégés { agentId: { status, text } }.
 * Les agents parallèles sont des agents « feuille » : ils exécutent leur brief
 * et retournent leur résultat (pas de délégation [[CALL]] imbriquée en V1).
 */
async function dispatchParallel(assignments, onComplete, options, runProject, ctx) {
  ctx.parallelGroup = {
    assignments,
    pending: assignments.length,
    results: {},
    onComplete,
  };
  for (const a of assignments) {
    const agent = busState.agents.get(a.agentId);
    if (!agent) {
      ctx.parallelGroup.results[a.agentId] = { status: "error", text: `Agent "${a.agentId}" inconnu.` };
      ctx.parallelGroup.pending--;
      continue;
    }
    const budgetCheck = ensureBudget(a.agentId, ctx);
    if (!budgetCheck.ok) {
      ctx.parallelGroup.results[a.agentId] = { status: "error", text: budgetCheck.message };
      ctx.parallelGroup.pending--;
      continue;
    }
    consumeBudget(a.agentId, ctx);
    // T5 : exclusivité des spécialités par projet. Si un agent de même agent_id
    // est déjà actif sur le même projet, mettre la demande en file d'attente au
    // lieu de la lancer (elle se lancera automatiquement à la fin de la tâche en
    // cours). La demande reste dans le groupe parallèle (pending conservé) pour
    // que la run ne se termine pas avant son exécution.
    const project = a.project || window._pilotProjectPath || ".";
    if (await isAgentActiveOnProject(a.agentId, project)) {
      enqueueExclusivity(ctx.exclusivityQueue, a.agentId, project, a);
      ctx.parallelGroup.results[a.agentId] = {
        status: "queued",
        text: `⏳ Demande mise en file d'attente : l'agent ${a.agentId} est déjà actif sur ce projet. Elle se lancera automatiquement à la fin de la tâche en cours.`,
      };
      emit("notify", { agentId: a.agentId, message: `⏳ L'agent ${a.agentId} est déjà actif sur ce projet. La demande est mise en file d'attente et se lancera automatiquement à la fin de la tâche en cours.` });
      continue;
    }
    await runAgentTurn(agent, a.brief, "", a.project, options);
  }
  // Si tous les agents ont échoué au démarrage (inconnus / budget), on agrège
  // immédiatement sans attendre d'agent_end.
  if (ctx.parallelGroup && ctx.parallelGroup.pending <= 0) {
    const group = ctx.parallelGroup;
    ctx.parallelGroup = null;
    await group.onComplete(group.results);
  }
}

// Exposition minimale de l'état pour l'UI (lecture seule recommandée).
if (typeof window !== "undefined") {
  window.__agentBusState = busState;
}
