// agent-pi.js — Onglet Agent Pi (chat RPC avec pi --mode rpc)

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import markdownit from "markdown-it";
import { isImageFile } from "./image-paste.js";
import { buildProjectContext } from "./context-engine.js";
import { buildMemoryBlock, buildMemoryExtractPrompt, initProjectMemory, memoryAbsPath } from "./project-memory.js";
import { generateAgentsMd } from "./agents-md.js";
import { renderEditGateDialog } from "./diff-view.js";
import { agentDisplayLabel, backendKind } from "./backend-info.js";
import { getTabsManager } from "./tabs.js";
import { refreshIcons, setIcon } from "./icons.js";
import { notifyAgentDoneFromRemote } from "./desktop-notify.js";
import { recordCurrentSession } from "./session-history.js";
import {
  buildPlanPrompt, buildTaskPrompt, buildRetryTaskPrompt, buildEscalationPrompt, buildRevisionPrompt,
  buildSubdividePrompt, buildFinalReviewPrompt, buildCoderFinalReviewPrompt, buildCoderFinalReviewContinuePrompt,
  parsePlanResponse, buildTreeString, normalizePlan,
  extractTaskSummary, summarizePlan, getAdaptiveGranularity,
  captureFileState, checkTaskFilesChanged, resolvePath,
  pickNextTask, isPlanBlocked, mergeRevisedPlan,
  validatePlan, replaceTaskWithSubtasks,
  parseSearchReplaceBlocks, applySearchReplaceBlocks,
  buildLintFailurePrompt, determineEscalationAction, estimateTokens, compactTaskPrompt,
  buildSelfFixPrompt, detectCoderMarker,
  createAttemptLog, detectLoop, summarizeTaskAttempts,
  detectReflectionOnly, buildNudgeAfterReflectionPrompt,
  detectTestRunner, buildTestCommand, derivePytestTargets,
  parseTestFailures, buildTestFailurePrompt, truncateTestOutput,
} from "./orchestration.js";
import {
  matchesGlob, matchesAnyCritical,
  buildReviewPrompt, parseReviewResult, buildReviewCorrectionPrompt,
} from "./orchestration-reviewer.js";

// ── État global de l'autocomplétion ──
let allCommands = [];
let acIndex = -1;
let acFiltered = [];
let acInputEl = null;
let acPopupEl = null;

// ── Alias de modèles (model-switch.json) ──
let modelAliases = {};       // { alias: "provider/modelId", ... }
let globalDefaultModel = ""; // defaultModel du registre global (presélection select agent)

// ── État du popup /prompt ──
let promptTemplates = [];
let promptIndex = 0;
let promptPopupEl = null;
let promptMessagesEl = null;

// ── État global du sélecteur de sessions ──
let resumeSessions = [];
let resumeIndex = -1;
let resumePopupEl = null;
let resumeMessagesEl = null; // Référence vers l'élément messages

// ── Paramètre d'affichage des pensées ──
let showThinkingEnabled = true;

/** Recharge le paramètre show_thinking depuis la config */
export async function refreshShowThinking() {
  try {
    const config = await invoke("get_config");
    showThinkingEnabled = config.show_thinking !== false;
  } catch (_) {
    showThinkingEnabled = true;
  }
}

// ── Paramètre d'affichage des outils ──
let showToolsEnabled = false;

/** Recharge le paramètre show_tools depuis la config */
export async function refreshShowTools() {
  try {
    const config = await invoke("get_config");
    showToolsEnabled = config.show_tools === true;
  } catch (_) {
    showToolsEnabled = false;
  }
}

const md = markdownit({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

/**
 * Crée l'onglet Agent Pi complet.
 * @param {HTMLElement} container - Élément conteneur (.editor-wrapper)
 * @returns {Promise<{wrapper: HTMLElement, unlisten: Function}>}
 */
export async function createAgentPi(container) {
  // Charger la configuration show_thinking
  await refreshShowThinking();
  // Charger la configuration show_tools
  await refreshShowTools();

  const wrapper = document.createElement("div");
  wrapper.className = "agent-chat-container";

  // ── Zone des messages ──
  const messagesEl = document.createElement("div");
  messagesEl.className = "agent-chat-messages";
  wrapper.appendChild(messagesEl);
  resumeMessagesEl = messagesEl;

  // ── Barre d'outils ──
  const toolbar = document.createElement("div");
  toolbar.className = "agent-chat-toolbar";
  toolbar.innerHTML = `
    <button class="agent-btn" data-action="abort" title="Arrêter l'agent"><i data-lucide="square" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="new-session" title="Nouvelle session"><i data-lucide="plus" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="compact" title="Compacter le contexte"><i data-lucide="archive" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="orchestration" title="Mode Orchestration : architecte + codeur"><i data-lucide="brain" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="quality-gate" id="agent-qg-btn" title="Quality-gate (cliquez pour activer l'anti-régression avant modif. de code)"><i data-lucide="shield-check" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="context" id="agent-ctx-btn" title="Context Engine : forcer la ré-injection du contexte projet au prochain envoi"><i data-lucide="layers" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="memory" id="agent-mem-btn" title="Mémoire projet : ouvrir/éditer PROJECT_MEMORY.md"><i data-lucide="notebook-pen" class="icon-sm"></i></button>
    <button class="agent-btn" data-action="agents-md" id="agent-amd-btn" title="Générer / mettre à jour AGENTS.md (instructions projet pour l'agent)"><i data-lucide="file-text" class="icon-sm"></i></button>
    <select class="agent-model-select" id="agent-model-select" title="Changer de modèle"></select>
    <select class="agent-model-select hidden" id="agent-orch-model-select" disabled title="Orchestrateur (mode Orchestration)"></select>
    <select class="agent-model-select hidden" id="agent-coder-model-select" disabled title="Codeur (mode Orchestration)"></select>
    <span class="agent-stats" id="agent-stats" title="Tokens / Coût"></span>
    <span class="agent-status" id="agent-status">Prêt</span>
  `;
  wrapper.appendChild(toolbar);

  // Quality-gate (Évolution 7) : init l'état du bouton depuis la config persistée.
  const qgBtn = wrapper.querySelector("#agent-qg-btn");
  async function refreshQualityGate() {
    try {
      const config = await invoke("get_config");
      if (qgBtn) {
        const on = config.quality_gate_enabled === true;
        qgBtn.classList.toggle("active", on);
        qgBtn.title = on
          ? "Quality-gate activé (cliquez pour désactiver)"
          : "Quality-gate (cliquez pour activer l'anti-régression avant modif. de code)";
      }
    } catch (_) { /* get_config non disponible */ }
  }
  refreshQualityGate();

  // ── Diff Review (A4 V2) : porte pré-écriture — charger le paramètre global ──
  // Tient compte de la capacité du backend : si le backend (ex: plh) ne supporte
  // pas `--extension`, l'option est ignorée (state.confirmFileEdits = false) même
  // si la config l'active — l'extension n'est pas chargée côté Rust, donc le gate
  // ne se déclenche jamais. On évite ainsi un « pipe closed » (clap rejette -e).
  async function refreshConfirmFileEdits() {
    try {
      const config = await invoke("get_config");
      const configWants = config.confirm_file_edits === true;
      let supported = true;
      try { supported = await invoke("extension_gate_supported"); } catch (_) {}
      state.confirmFileEdits = configWants && supported;
    } catch (_) { state.confirmFileEdits = false; }
  }
  refreshConfirmFileEdits();
  // Recharger quand les paramètres sont sauvegardés (event custom émis par main.js)
  window.addEventListener("pilot-config-changed", refreshConfirmFileEdits);

  // ── Auto-test post-modification (E2) : recharger la config à chaud ──
  async function refreshOrchestrationTestConfig() {
    try {
      const config = await invoke("get_config");
      state.orchestrationTestEnabled = config.orchestration_test_enabled === true;
      if (config.orchestration_test_timeout_ms && config.orchestration_test_timeout_ms >= 1000) {
        state.orchestrationTestTimeoutMs = config.orchestration_test_timeout_ms;
      }
      if (config.orchestration_test_max_corrections && config.orchestration_test_max_corrections > 0) {
        state.orchestrationTestMaxCorrections = config.orchestration_test_max_corrections;
      }
      state.orchestrationTestCommand = config.orchestration_test_command || "";
      if (config.orchestration_test_scope === "full" || config.orchestration_test_scope === "targeted") {
        state.orchestrationTestScope = config.orchestration_test_scope;
      }
      // Si l'auto-test est désactivé pendant un plan, reset la baseline.
      if (!state.orchestrationTestEnabled) {
        state.orchestrationTestBaseline = null;
        state.orchestrationTestBaselineWarned = false;
      }
      // ── A1 : snapshots ──
      state.orchestrationSnapshotsEnabled = config.orchestration_snapshots_enabled !== false;
      // ── H2 V1 : reviewer ──
      // Si le mode orchestration est actif, ne pas écraser les overrides session
      // (l'utilisateur a pu activer/désactiver le reviewer via l'écran d'activation).
      if (!state.orchestrationEnabled) {
        state.orchestrationReviewerEnabled = config.orchestration_reviewer_enabled === true;
        state.orchestrationReviewerScope = (config.orchestration_reviewer_scope === "critical") ? "critical" : "all";
        state.orchestrationReviewerCriticalPatterns = Array.isArray(config.orchestration_reviewer_critical_patterns)
          ? config.orchestration_reviewer_critical_patterns.map(String) : [];
        state.orchestrationReviewerProvider = config.orchestration_reviewer_provider || "";
        state.orchestrationReviewerModel = config.orchestration_reviewer_model || "";
      }
    } catch (_) { /* get_config non disponible */ }
  }
  refreshOrchestrationTestConfig();
  window.addEventListener("pilot-config-changed", refreshOrchestrationTestConfig);
  // Rafraîchir le sélecteur de modèle quand le registre models.json a été
  // édité depuis l'onglet Fournisseurs (models-config.js).
  window.addEventListener("pilot-models-changed", () => {
    loadModels(state);
    loadModelAliases();
  });

  // ── Panneau d'orchestration ──
  const orchestrationPanel = document.createElement("div");
  orchestrationPanel.className = "orchestration-panel hidden";
  orchestrationPanel.id = "orchestration-panel";
  orchestrationPanel.innerHTML = `
    <div class="orchestration-header">
      <span class="orchestration-title"><i data-lucide="clipboard-list" class="icon-sm"></i> Plan d'orchestration</span>
      <div class="orchestration-actions">
        <button class="agent-btn" data-action="orch-pause" title="Mettre en pause"><i data-lucide="pause" class="icon-sm"></i></button>
        <button class="agent-btn" data-action="orch-resume" title="Reprendre" disabled><i data-lucide="play" class="icon-sm"></i></button>
        <button class="agent-btn" data-action="orch-reset" title="Nouveau plan"><i data-lucide="rotate-cw" class="icon-sm"></i></button>
        <button class="agent-btn" data-action="orch-undo" title="Annuler la dernière tâche (restaurer les fichiers)" disabled><i data-lucide="undo-2" class="icon-sm"></i></button>
      </div>
    </div>
    <div class="orchestration-progress">
      <div class="orchestration-progress-bar"><div id="orch-progress-bar"></div></div>
      <span class="orchestration-progress-text" id="orch-progress-text">0/0 tâches</span>
    </div>
    <div class="orch-metrics" id="orch-metrics"></div>
    <div class="orch-attempts hidden" id="orch-attempts">
      <div class="orch-attempts-header" id="orch-attempts-header"><i data-lucide="clipboard-list" class="icon-sm"></i> Journal des tentatives <span class="orch-chevron">▶</span></div>
      <div class="orch-attempts-body hidden" id="orch-attempts-body"></div>
    </div>
    <div class="orchestration-tasks" id="orch-tasks"></div>
  `;
  wrapper.appendChild(orchestrationPanel);

  // Toggle repliable du journal des tentatives (observabilité).
  (function setupAttemptsToggle() {
    const header = orchestrationPanel.querySelector("#orch-attempts-header");
    if (!header) return;
    header.addEventListener("click", () => {
      const body = orchestrationPanel.querySelector("#orch-attempts-body");
      if (!body) return;
      body.classList.toggle("hidden");
      // Le glyphe ▶/▼ est rafraîchi au prochain renderOrchestrationAttempts.
    });
  })();

  // ── Zone de saisie ──
  const inputBar = document.createElement("div");
  inputBar.className = "agent-chat-input-bar";
  inputBar.style.position = "relative";
  inputBar.innerHTML = `
    <div class="agent-autocomplete" id="agent-autocomplete"></div>
    <div class="agent-resume-popup" id="agent-resume-popup"></div>
    <div class="agent-prompt-popup" id="agent-prompt-popup"></div>
    <div class="agent-image-previews" id="agent-image-previews"></div>
    <textarea class="agent-input" id="agent-input" rows="1" placeholder="Écrire un message... (Entrée pour envoyer, Shift+Entrée pour nouvelle ligne, / pour les commandes)"></textarea>
    <button class="agent-btn agent-mic-btn" data-action="voice" title="Dictée vocale (transcription cloud)" aria-label="Dictée vocale"><i data-lucide="mic" class="icon-sm"></i></button>
    <button class="agent-btn agent-send-btn" data-action="send"><i data-lucide="send-horizontal" class="icon-sm"></i></button>
  `;
  wrapper.appendChild(inputBar);

  container.appendChild(wrapper);
  refreshIcons(wrapper);

  // ── État interne ──
  const state = {
    isStreaming: false,
    // ── Rafraîchissement des stats (tokens/contexte) pendant le streaming ──
    // updateStats() n'était appelée qu'à agent_end/text_end → pendant une longue
    // réflexion (thinking) la jauge de contexte n'était pas rafraîchie et l'user
    // était surpris par les compactages (issue #2). On throttle le refresh pendant
    // le streaming (max 1 fois / 3s, sans chevauchement d'appels).
    statsRefreshPending: false,
    lastStatsRefresh: 0,
    currentAssistantBlock: null,  // élément DOM du message assistant en cours de streaming
    currentTextBlock: null,       // sous-élément pour le texte
    currentThinkingBlock: null,   // sous-élément pour la pensée
    currentToolBlocks: new Map(), // toolCallId → élément DOM
    pendingText: "",              // buffer texte en streaming
    pendingRender: false,          // flag pour throttling du rendu Markdown (requestAnimationFrame)
    lastAssistantRawText: "",      // texte brut complet de la dernière réponse (pour parsing orchestration)
    isCompacting: false,           // true pendant une compaction (filtre les deltas du résumé)
    thinkingVisible: true,
    pendingImages: [],
    pendingToolCalls: new Map(),  // toolCallId → { name, args } (en attente de tool_execution_start)
    lengthNudgeAttempts: 0,  // compteur de relances auto après stopReason:"length" (chat standard, max 2)
    lastStopReason: "",      // dernier stopReason assistant reçu (détection réponse tronquée)
    // ── Erreurs de connexion (chat standard) ──
    // pi émet auto_retry_start puis un message error à chaque retry. Sans
    // dé-duplication, l'UI empile « ❌ Erreur de connexion » 3-4× d'affilée,
    // puis se fige sans retour après épuisement des retries. On n'affiche qu'un
    // seul bloc mis à jour, transformé en message + bouton « Réessayer » sur
    // agent_end si aucune réponse n'est revenue.
    lastUserPrompt: "",     // dernier prompt utilisateur (chat standard, pour retry 1-clic)
    lastRetryImages: [],    // images du dernier prompt (pour retry 1-clic)
    lastPromptOrigin: null,  // D1 : origine du dernier prompt ("remote" | "desktop" | null) → notification desktop si "remote" à l'agent_end
    connRetryActive: false, // true pendant une rafale de retries pi (dé-duplication)
    connRetryBlock: null,   // bloc DOM du message « 🔄 nouvelle tentative » courant
    connErrorCount: 0,      // nb d'erreurs de connexion consécutives dans la rafale
    // Orchestration
    orchestrationEnabled: false,
    orchestrationPlan: null,      // { plan: [...], progress: { current_task, completed, failed, escalated, task_attempts } }
    orchestrationPaused: false,
    orchestrationRunning: false,  // true si un plan est en cours d'exécution
    orchestrationTimeout: null,   // timer ID pour le timeout d'inactivité du codeur
    orchestrationEscalating: false, // true si on attend la réponse de l'orchestrateur après escalade
    orchestrationRevising: false, // true si on attend la révision mid-plan de l'orchestrateur
    orchestrationSubdividing: false, // true si on attend la subdivision d'une tâche échouée (point M)
    orchestrationSubdividingTaskId: null, // ID de la tâche en cours de subdivision (point M)
    orchestrationTaskStartTime: null, // timestamp de début de la tâche courante (point N — métriques durée)
    orchestrationResponseChars: 0, // nb de caractères de la réponse en cours (point N — métriques)
    orchestrationConnectionError: false, // true si une erreur de connexion a mis le plan en pause (option 1)
    orchestrationConnErrorSeen: false, // true si on a déjà notifié une erreur de connexion (anti-spam retries pi)
    orchestrationTasksSinceRevision: 0, // compteur de tâches terminées depuis la dernière révision
    orchestrationRevisionInterval: 5, // toutes les N tâches terminées → révision mid-plan
    orchestrationIdleTimeoutMs: 120000, // timeout d'inactivité du codeur (ms)
    orchestrationGranularity: "fine", // niveau de granularité (fine, medium, large)
    orchestrationEffectiveGranularity: "fine", // granularité ajustée automatiquement selon les échecs
    orchestrationBatchSize: 0, // taille du batch (0 = désactivé, -1 = auto)
    orchestrationConfirmModelSwitch: false, // confirmer chaque bascule de modèle (plus lent mais plus sûr)
    coderContextWindow: 0, // fenêtre de contexte du codeur en tokens (0 = auto/désactivé)
    orchestrationTasksInBatch: 0, // compteur de tâches dans le batch actuel
    orchestrationJsonRetries: 0, // compteur de tentatives de re-parsing JSON du plan
    orchestrationPlanReplanRetries: 0, // V3 (Bug 5) : compteur de re-plans auto quand le plan est trop grossier (max 1)
    orchestrationLastUserPrompt: "", // V3 (Bug 5) : demande utilisateur réelle, pour validatePlan
    orchestrationCachedTree: null, // arborescence projet filtrée mise en cache
    orchestrationFinalReview: false, // true pendant la vérification finale (point 2)
    orchestrationFinalReviewCount: 0, // nombre de cycles de vérification finale (max 3)
    orchestrationFinalReviewCycles: 0, // V3 etape 4 : compteur de cycles FINAL_FIX (auto-correction codeur pendant la verif finale, max 3)
    orchestrationTurnId: 0, // identifiant de tour incrémenté à chaque new_session (point 5.7)
    orchestrationCurrentFileState: {}, // état des fichiers de la tâche en cours (pour validation post-tâche)
    orchestrationLintAttempts: {}, // compteur de corrections syntaxiques par tâche (V2 linting-in-the-loop)
    orchestrationNudgeAttempts: {}, // compteur de relances (nudge) après arrêt prématuré en réflexion (max 2 par tâche)
    // ── Auto-test post-modification (E2, spec_orchestration_autotest.md) ──
    orchestrationTestEnabled: false, // opt-in (défaut off)
    orchestrationTestTimeoutMs: 60000, // timeout dédié pour les tests (distinct du timeout d'inactivité)
    orchestrationTestMaxCorrections: 3, // budget commun (lint + test) borné à cette valeur
    orchestrationTestCommand: "", // override manuel ("" = auto-détection)
    orchestrationTestScope: "targeted", // "targeted" | "full"
    orchestrationTestRunner: null, // runner détecté ("npm"|"cargo"|"pytest"|"go"|null)
    orchestrationTestBaseline: null, // { failures: string[], exitCode, available: bool } — tests déjà rouges au démarrage
    orchestrationTestBaselineComputing: false, // anti-reentrance calcul baseline
    orchestrationTestBaselineWarned: false, // warning « tests injoignables » déjà affiché
    orchestrationTestAttempts: {}, // compteur de corrections de tests par tâche (E2)
    // ── Snapshots / annulation de tâche (A1, spec_orchestration_snapshots.md) ──
    orchestrationSnapshotsEnabled: true, // défaut activé (garantie de sécurité)
    orchestrationSnapshotsAvailable: null, // null = inconnu, bool = repo Git détecté
    orchestrationSnapshotsWarned: false, // message « indisponible » déjà affiché
    orchestrationSnapshots: {}, // map taskId → { sha, files: string[], ts }
    orchestrationCancelledTasks: [], // tâches annulées par l'utilisateur (exclues de « terminé »)
    // ── Reprise après compaction auto (spec_orchestration.md §11.8) ──
    // pi peut ne pas reprendre la génération après une compaction auto en mode RPC.
    // On démarre un timer de reprise sur compaction_end ; si aucun delta/agent_end
    // n'arrive dans le délai, on relance le flux (abort + executeNextTask).
    orchestrationCompactionTimer: null, // timer de reprise post-compaction
    orchestrationCompactionResumePending: false, // true entre compaction_end et la 1re activité post-compaction
    // ── Reviewer indépendant (H2 V1, spec_orchestration_reviewer.md) ──
    orchestrationReviewerEnabled: false, // opt-in (défaut off)
    orchestrationReviewerScope: "all", // "all" = chaque tâche | "critical" = fichiers sensibles
    orchestrationReviewerCriticalPatterns: [], // globs éditables (mode critical)
    orchestrationReviewerProvider: "", // "" = fallback sur modèle orchestrateur
    orchestrationReviewerModel: "", // "" = fallback sur modèle orchestrateur
    orchestrationReviewAttempts: {}, // compteur de corrections reviewer par tâche
    isReviewerStreaming: false, // true pendant un tour du reviewer
    reviewerPendingResolve: null, // resolver de la Promise en attente (runReviewGate)
    reviewerRawText: "", // texte brut accumulé du reviewer (pour parseReviewResult)
    reviewerCurrentBlock: null, // bulle DOM du reviewer courant
    reviewerCompacting: false, // filtre deltas pendant compaction reviewer (§11.8)
    orchestrationCurrentTaskCycles: 0, // V3 : compteur de cycles SELF_FIX (auto-controle codeur) pour la tâche courante (max 3)
    orchestrationReadFilesInTask: new Set(), // fichiers lus par le codeur pendant la tâche courante (point 5.3)
    orchestrationToolCallsInTask: [], // outils utilisés par le codeur pendant la tâche courante (point 5.10)
    coderWarmedUp: false, // true si le codeur local a été pré-chauffé (point 5.9)
    modelTestActive: false, // true pendant un test de réponse d'un modèle (popup d'activation)
    _previousPlan: null,         // plan terminé gardé temporairement comme contexte pour le nouveau plan
    currentModel: "",            // modèle actuel (provider/modelId)
    defaultModel: "",           // modèle par défaut (sauvegardé à l'activation du mode orchestration)
    orchestratorModel: "",      // provider/modelId de l'orchestrateur
    coderModel: "",              // provider/modelId du codeur
    // ── Context Engine (H1, spec_context_engine.md) ──
    contextInjected: false,         // true après injection du contexte projet (1x par session)
    contextRefreshRequested: false, // true si l'utilisateur a cliqué 📑 (forcer ré-injection)
    // ── Mémoire de projet (H3, spec_project_memory.md) ──
    memoryInjected: false,             // true après injection de PROJECT_MEMORY.md (1x par session chat)
    projectMemoryEnabled: true,        // reflète config.project_memory_enabled (injection chat + orchestration)
    projectMemoryAutoExtract: false,   // reflète config.project_memory_auto_extract (extraction post-tâche)
    orchestrationExtractingMemory: null, // taskId pendant le tour d'extraction mémoire (null sinon)
    // ── Diff Review (A4 V2, spec_diff_review.md) : porte pré-écriture ──
    // `confirmFileEdits` reflète la config Rust `confirm_file_edits`. Si false
    // (défaut) ou en Mode Orchestration, l'auto-approve est envoyé à l'extension
    // pilot-edit-gate (l'agent écrit librement). Si true, un diff Accepter/
    // Refuser s'affiche AVANT que l'outil write/edit ne s'exécute (pi bloqué).
    confirmFileEdits: false,
    // Flags de cycle de vie pi (restart/reconnect) — évitent d'attendre 30s sur
    // un pi mort : waitForPiReady poll get_agent_state et baille si piDead.
    piDead: false,
    restarting: false,
  };
  window.__agentState = state;

  const inputEl = wrapper.querySelector("#agent-input");

  // ── Context Engine (H1) : helpers pour construire le contexte projet ──
  /** Retourne l'onglet d'édition actif { path, content } pour l'injection de contexte. */
  function getActiveEditTab() {
    try {
      const tm = getTabsManager();
      if (!tm || !tm.tabs) return null;
      const tab = tm.getActiveTab();
      if (!tab || !tab.path) return null;
      // Uniquement les onglets de fichier (édition/preview/split) — pas agent/terminal/scratchpad
      if (["agent", "terminal", "prompt-builder", "help"].includes(tab.mode)) return null;
      if (tab.isScratchpad) return null;
      // content peut ne pas être à jour ; le Context Engine relira le fichier si content == null
      return { path: tab.path, content: tab.content || null };
    } catch (_) { return null; }
  }

  /** Retourne les chemins des fichiers récemment ouverts/édités (onglets ouverts). */
  function getRecentEditedPaths() {
    try {
      const tm = getTabsManager();
      if (!tm || !tm.tabs) return [];
      return tm.tabs
        .filter((t) => t.path && !["agent", "terminal", "prompt-builder", "help"].includes(t.mode) && !t.isScratchpad)
        .map((t) => t.path)
        .slice(0, 8);
    } catch (_) { return []; }
  }

  // ── Dictée vocale (Web Speech API) — Évolution 8 ──
  // Transcription navigateur. Sur WebView2 (Windows), l'audio passe par le cloud
  // Microsoft/Google (pas 100% local). Masqué si SpeechRecognition non supporté
  // (WebKit macOS/Linux). Desktop = secure context (localhost/tauri://).
  const VOICE_LANG = "fr-FR";
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const micBtn = wrapper.querySelector(".agent-mic-btn");
  if (micBtn && !voiceSupported) micBtn.style.display = "none";
  let voiceActive = false;
  let voiceRec = null;

  function stopVoiceInput() {
    // Empêche onresult/onend de réécrire le textarea après l'envoi.
    voiceActive = false;
    if (voiceRec) { try { voiceRec.stop(); } catch (_) {} }
    if (micBtn) micBtn.classList.remove("rec");
  }

  function toggleVoiceInput() {
    if (!voiceSupported) return;
    if (state.isStreaming) { appendSystemMessage(messagesEl, "⏳ Agent en cours, patiente la fin pour dicter."); return; }
    if (voiceActive) { stopVoiceInput(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = VOICE_LANG;
    rec.interimResults = true;
    rec.continuous = true;
    const preText = inputEl.value;
    let finalText = "";
    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
    rec.onresult = (e) => {
      if (!voiceActive) return;
      // Sur Chrome Android (continuous=true), le moteur peut finaliser des résultats
      // cumulatifs (chaque résultat contient les précédents). Les concaténer duplique
      // le texte. On distingue deux modes : cumulatif (Android, garder le plus complet)
      // vs incrémental (Chrome desktop, concaténer les segments).
      const finals = [];
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim = r[0].transcript;
      }
      if (finals.length >= 2 && norm(finals[finals.length - 1]).startsWith(norm(finals[finals.length - 2]))) {
        finalText = finals[finals.length - 1];
      } else {
        finalText = finals.join(" ");
      }
      let transcript;
      if (interim) {
        if (finalText && norm(interim).startsWith(norm(finalText))) transcript = interim;
        else transcript = (finalText ? finalText + " " : "") + interim;
      } else {
        transcript = finalText;
      }
      const sep = preText && !preText.endsWith(" ") ? " " : "";
      inputEl.value = preText + sep + transcript;
      inputEl.scrollTop = inputEl.scrollHeight;
    };
    rec.onerror = (ev) => {
      voiceActive = false; voiceRec = null;
      if (micBtn) micBtn.classList.remove("rec");
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        // not-allowed = micro absent (NotFound) ou permission refusée. Sur le desktop,
        // le patch wry (vendor/wry) accorde automatiquement la permission ; un not-allowed
        // indique donc généralement l'absence de micro (device non exposé à l'app) ou un
        // build non patché. service-not-allowed = service Web Speech indisponible dans ce
        // WebView (Edge/WebView2 ne fournit pas le service cloud Web Speech de Chrome).
        appendSystemMessage(messagesEl, "🎙️ Micro indisponible (" + ev.error + "). Vérifie qu'un micro est branché et autorisé (Réglages Windows → Confidentialité → Micro → applications de bureau). Alternative : web remote (HTTPS) depuis un téléphone ou un autre PC.");
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        appendSystemMessage(messagesEl, "🎙️ Erreur de dictée : " + ev.error);
      }
    };
    rec.onend = () => {
      const wasActive = voiceActive;
      voiceActive = false; voiceRec = null;
      if (micBtn) micBtn.classList.remove("rec");
      if (wasActive) {
        const sep = preText && !preText.endsWith(" ") ? " " : "";
        inputEl.value = preText + sep + finalText;
        autoResizeTextarea();
      }
    };
    try {
      rec.start();
      voiceRec = rec; voiceActive = true;
      if (micBtn) { micBtn.classList.add("rec"); micBtn.title = "Arrêter la dictée"; }
    } catch (err) {
      appendSystemMessage(messagesEl, "🎙️ Impossible de démarrer la dictée : " + err.message);
    }
  }
  const statusEl = wrapper.querySelector("#agent-status");
  const autocompleteEl = wrapper.querySelector("#agent-autocomplete");
  const resumePopup = wrapper.querySelector("#agent-resume-popup");
  const promptPopup = wrapper.querySelector("#agent-prompt-popup");

  // Exposer pour les fonctions d'autocomplétion externes
  acInputEl = inputEl;
  acPopupEl = autocompleteEl;
  resumePopupEl = resumePopup;
  promptPopupEl = promptPopup;

  // ── Gestion des images en attente ──

  const imagePreviewsEl = wrapper.querySelector("#agent-image-previews");

  function renderImagePreviews() {
    if (!imagePreviewsEl) return;
    if (state.pendingImages.length === 0) {
      imagePreviewsEl.innerHTML = "";
      imagePreviewsEl.style.display = "none";
      return;
    }
    imagePreviewsEl.style.display = "flex";
    imagePreviewsEl.innerHTML = state.pendingImages
      .map(
        (img, i) => `
        <div class="agent-image-thumb" data-index="${i}">
          <img src="${img.dataUrl}" alt="${escapeHtmlText(img.name)}" />
          <button class="agent-image-thumb-remove" data-remove="${i}" title="Retirer l'image">×</button>
        </div>`
      )
      .join("");

    // Attacher les clics de suppression
    imagePreviewsEl.querySelectorAll(".agent-image-thumb-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.remove);
        state.pendingImages.splice(idx, 1);
        renderImagePreviews();
      });
    });
  }

  async function addPendingImage(file) {
    const dataUrl = await fileToDataUrl(file);
    // Extraire le base64 pur (sans le préfixe data:image/...;base64,)
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const mimeType = file.type || (comma >= 0 ? dataUrl.slice(5, dataUrl.indexOf(";")) : "image/png");
    state.pendingImages.push({
      name: file.name || "image.png",
      mimeType: mimeType,
      dataUrl: dataUrl,
      base64: base64,
    });
    renderImagePreviews();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Échec lecture fichier"));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /** Ajoute une image à partir d'un chemin fichier (drop natif Tauri) */
  async function addPendingImagePath(filePath) {
    try {
      const data = await invoke("read_file_binary", { path: filePath });
      const name = filePath.split(/[/\\]/).pop() || "image.png";
      const ext = name.split(".").pop()?.toLowerCase() || "png";
      const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", tiff: "image/tiff", avif: "image/avif" };
      const mimeType = mimeMap[ext] || "image/png";
      // Convertir les bytes en base64 (robuste pour grands fichiers)
      const bytes = new Uint8Array(data);
      const base64 = bytesToBase64(bytes);
      const dataUrl = `data:${mimeType};base64,${base64}`;
      state.pendingImages.push({ name, mimeType, dataUrl, base64 });
      renderImagePreviews();
    } catch (err) {
      console.error("Erreur lecture image:", filePath, err);
    }
  }

  // ── Gestion du drop d'images (via API native Tauri) ──
  const unlistenDragDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
    const payload = event.payload || {};
    // Ne traiter que les drops (pas les hover/leave)
    if (payload.type !== "drop" && payload.type !== undefined) return;
    const paths = payload.paths || [];
    if (paths.length === 0) return;

    // Vérifier que le drop est dans la zone de chat agent
    const position = payload.position;
    if (position) {
      const rect = wrapper.getBoundingClientRect();
      const inAgent = position.x >= rect.left && position.x <= rect.right
                   && position.y >= rect.top && position.y <= rect.bottom;
      if (!inAgent) return;
    }

    for (const filePath of paths) {
      if (isImageFile({ name: filePath, type: "" })) {
        await addPendingImagePath(filePath);
      }
    }
  });

  // ── Auto-resize du textarea ──
  function autoResizeTextarea() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
  }

  // ── Gestion du collage d'images (Ctrl+V) ──
  inputEl.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await addPendingImage(file);
        return;
      }
    }
    // Redimensionner après collage de texte
    requestAnimationFrame(autoResizeTextarea);
  });

  // Auto-resize à chaque saisie
  inputEl.addEventListener("input", autoResizeTextarea);

  // ── Gestionnaires d'événements ──
  // Envoi du message
  const sendPrompt = async () => {
    const text = inputEl.value.trim();
    if (!text || state.isStreaming) return;
    if (voiceActive) stopVoiceInput();
    inputEl.value = "";
    autoResizeTextarea();
    const isSlashCommand = text.startsWith("/");
    hideAutocomplete();
    // Réinitialiser le flag d'erreur de connexion (nouvel envoi utilisateur)
    state.orchestrationConnErrorSeen = false;
    // L'utilisateur reprend la main : remise à zéro du compteur de relances auto
    // (length) pour la prochaine troncation éventuelle.
    state.lengthNudgeAttempts = 0;
    // Réinitialiser l'état d'erreur de connexion chat standard (nouvel envoi).
    // Le bloc « nouvelle tentative » éventuel est retiré : un nouvel envoi
    // explicite annule la séquence de retries précédente.
    state.connRetryActive = false;
    state.connErrorCount = 0;
    if (state.connRetryBlock) { state.connRetryBlock.remove(); state.connRetryBlock = null; }

    // Images en attente
    const images = state.pendingImages.length > 0
      ? state.pendingImages.map((img) => ({
          type: "image",
          mimeType: img.mimeType,
          data: img.base64,
        }))
      : null;

    // Mémoriser le prompt utilisateur (texte + images) pour le retry 1-clic
    // après une erreur de connexion (bouton « Réessayer »). Uniquement en
    // chat standard : les slash-commands et le mode Orchestration gèrent leur
    // propre logique de reprise.
    if (!isSlashCommand) {
      state.lastUserPrompt = text;
      state.lastRetryImages = images ? images.map((img) => ({ ...img })) : [];
    }

    // Vérifier si le modèle supporte les images avant d'envoyer
    if (images && state.currentModel) {
      const [provider, ...modelParts] = state.currentModel.split("/");
      const modelId = modelParts.join("/");
      try {
        const supportsImages = await invoke("model_supports_images", { provider, modelId });
        if (!supportsImages) {
          appendSystemMessage(messagesEl, "⚠️ Le modèle actuel ne supporte pas les images. Passe à un modèle compatible (ex: Gemini).");
          // Ne pas bloquer l'input : on remet le texte pour que l'utilisateur puisse l'envoyer sans image
          inputEl.value = text;
          state.pendingImages = [];
          renderImagePreviews();
          return;
        }
      } catch (e) {
        console.error("Erreur vérification support image:", e);
      }
    }

    // Ne pas afficher les commandes slash dans la conversation
    if (!isSlashCommand) {
      appendUserMessage(messagesEl, text);
    }

    // /resume : ne pas envoyer au LLM, lister directement les sessions
    if (text === "/resume") {
      try {
        const sessions = await invoke("list_sessions");
        if (sessions && sessions.length > 0) {
          resumeSessions = sessions;
          showResumePopup();
        } else {
          appendSystemMessage(messagesEl, "Aucune session enregistrée pour ce projet.");
        }
      } catch (err) {
        console.error("Erreur list_sessions:", err);
        appendErrorMessage(messagesEl, `Erreur: ${err}`);
      }
      return;
    }

    // /prompt : afficher les templates et exécuter avec les fichiers cochés
    if (text === "/prompt" || text.startsWith("/prompt ")) {
      showPromptPopup(messagesEl);
      return;
    }

    // /editor : tester l'éditeur intégré
    if (text === "/editor") {
      const testPayload = {
        type: "extension_ui_request",
        method: "editor",
        id: "test-" + Date.now(),
        title: "Test éditeur intégré",
        prefill: "// Modifie ce code\nfunction hello() {\n  return 'world';\n}",
      };
      handleExtensionUiRequest(testPayload, messagesEl);
      return;
    }

    try {
      // Mode Orchestration : si un plan est en cours d'exécution, mettre en pause
      if (state.orchestrationEnabled && state.orchestrationRunning && !isSlashCommand) {
        state.orchestrationPaused = true;
        appendSystemMessage(messagesEl, "⏸️ Plan mis en pause — l'utilisateur a envoyé un message.");
        updateOrchestrationButtons(state);
        // Annuler le timeout codeur si actif
        if (state.orchestrationTimeout) {
          clearTimeout(state.orchestrationTimeout);
          state.orchestrationTimeout = null;
        }
      }

      // Déterminer si le plan en cours est terminé (toutes les tâches faites ou escaladées)
      let planFinished = false;
      if (state.orchestrationPlan && state.orchestrationPlan.plan) {
        const progress = state.orchestrationPlan.progress || {};
        const doneIds = new Set([
          ...(progress.completed || []),
          ...(progress.escalated || []),
          ...(progress.failed || []),
        ]);
        planFinished = state.orchestrationPlan.plan.length > 0 &&
          state.orchestrationPlan.plan.every(t => doneIds.has(t.id));
      }

      // Si le plan est terminé, le réinitialiser pour permettre d'en créer un nouveau
      if (planFinished) {
        const oldPlan = state.orchestrationPlan;
        state.orchestrationPlan = null;
        state.orchestrationRunning = false;
        state.orchestrationPaused = false;
        state.orchestrationEscalating = false;
        state.orchestrationRevising = false;
        state.orchestrationSubdividing = false;
        state.orchestrationSubdividingTaskId = null;
        state.orchestrationTaskStartTime = null;
        state.orchestrationResponseChars = 0;
        state.orchestrationConnectionError = false;
        state.orchestrationConnErrorSeen = false;
        state.orchestrationTasksSinceRevision = 0;
        state.orchestrationCachedTree = null;
        state.orchestrationFinalReview = false;
        state.orchestrationFinalReviewCount = 0;
        state.orchestrationTasksInBatch = 0;
        // Supprimer le fichier plan sauvegardé
        try { await invoke("delete_plan"); } catch (_) {}
        appendSystemMessage(messagesEl, "✅ Plan précédent terminé — création d'un nouveau plan pour votre demande.");
        // Passer l'ancien plan comme contexte pour que l'orchestrateur sache ce qui a été fait
        // (il sera passé à buildPlanPrompt si on en crée un nouveau)
        state._previousPlan = oldPlan;
      }

      // Mode Orchestration : envoyer d'abord à l'orchestrateur pour créer un plan
      // (on ne vide PAS le contexte ici : l'orchestrateur doit voir la conversation)
      if (state.orchestrationEnabled && !state.orchestrationPlan && !isSlashCommand) {
        const orchResult = await switchToOrchestrator(state);
        if (orchResult) {
          // Invalider le cache d'arborescence (nouveau plan = nouveau contexte projet)
          state.orchestrationCachedTree = null;
          // Réinitialiser les compteurs de révision
          state.orchestrationTasksSinceRevision = 0;
          state.orchestrationRevising = false;
          // Passer l'ancien plan + l'arborescence filtrée + les fichiers clés comme contexte (point C / V2+)
          const projectTree = await getCachedProjectTree(state);
          const keyFileContents = await loadKeyFileContents(window._pilotProjectPath);
          const planPrompt = buildPlanPrompt(text, state._previousPlan || null, projectTree, keyFileContents, state.orchestrationGranularity);
          // V3 (Bug 5) : mémoriser la demande utilisateur réelle pour validatePlan
          // (sinon on passait par erreur la réponse de l'orchestrateur comme userPrompt).
          state.orchestrationLastUserPrompt = text;
          // Afficher le début de la demande dans le titre du panneau (pendant la
          // construction du plan, avant que orchestrationPlan ne soit défini).
          updateOrchestrationTitle(state);
          // Réinitialiser le compteur de re-plan auto au début d'une nouvelle planification
          state.orchestrationPlanReplanRetries = 0;
          state._previousPlan = null; // Consommer le contexte
          const payload = { message: planPrompt };
          if (images) payload.images = images;
          // D1 : prompt envoyé depuis le desktop (planification orchestration) →
          // origine locale. Évite une fausse notification « agent terminé à distance »
          // si un prompt remote avait précédé sans agent_end (ex: abort).
          state.lastPromptOrigin = "desktop";
          await invoke("send_agent_prompt", payload);
          state.pendingImages = [];
          renderImagePreviews();
        } else {
          inputEl.value = text; // Remettre le texte
          return;
        }
      } else {
        // Chat standard : s'assurer que le modèle actif côté agent correspond
        // au modèle sélectionné. Resync si désynchronisé (ex: new_session qui
        // reset le modèle au défaut de pi/plh), avec un message visible (point 1B).
        // En mode Orchestration, les switchToOrchestrator/Coder gèrent déjà la bascule.
        if (!state.orchestrationEnabled && !isSlashCommand && state.currentModel) {
          const expected = state.currentModel;
          let active = "";
          try {
            active = await confirmActiveModel(expected);
          } catch (e) {
            console.warn("get_agent_state échoué avant envoi:", e);
          }
          if (active && active !== expected) {
            const [p, ...rest] = expected.split("/");
            try {
              await invoke("set_agent_model", { provider: p, modelId: rest.join("/") });
              const confirmed = await confirmActiveModel(expected);
              if (confirmed && confirmed !== expected) {
                appendErrorMessage(messagesEl, "❌ Impossible de resynchroniser le modèle (actif: " + confirmed + ", attendu: " + expected + "). Prompt non envoyé.");
                inputEl.value = text;
                return;
              }
              appendSystemMessage(messagesEl, "🔄 Modèle resynchronisé : " + active + " → " + expected);
            } catch (err) {
              appendErrorMessage(messagesEl, "❌ Échec de resynchronisation du modèle : " + err + ". Prompt non envoyé.");
              inputEl.value = text;
              return;
            }
          }
        }
        // ── Context Engine (H1) : injecter le contexte projet une fois par session ──
        let finalMessage = text;
        const wantContext = !state.contextInjected || state.contextRefreshRequested;
        if (wantContext && !isSlashCommand) {
          try {
            const config = await invoke("get_config");
            if (config && config.context_engine_enabled !== false) {
              const ctxOpts = {
                enabled: true,
                budgetTokens: config.context_budget_tokens || 8000,
                includeImports: config.context_include_imports !== false,
                includeSpecs: config.context_include_specs !== false,
                includeRecents: config.context_include_recents !== false,
                // V2 (RAG) — spec_context_engine.md §7. Si activé + endpoint dispo,
                // le contexte est sélectionné par similarité cosinus ; sinon fallback V1.
                ragEnabled: config.context_rag_enabled === true,
                ragEndpoint: config.context_rag_endpoint || "http://127.0.0.1:11434",
                ragModel: config.context_rag_model || "nomic-embed-text",
                prompt: text, // le RAG a besoin du prompt pour la recherche cosinus
              };
              const activeTab = getActiveEditTab();
              const recents = getRecentEditedPaths();
              const ctxBlock = await buildProjectContext(window._pilotProjectPath, activeTab, recents, ctxOpts);
              if (ctxBlock) {
                finalMessage = ctxBlock + text;
                state.contextInjected = true;
                state.contextRefreshRequested = false;
                const ctxBtn = wrapper.querySelector("#agent-ctx-btn");
                if (ctxBtn) ctxBtn.classList.remove("active");
              }
            }
          } catch (ctxErr) {
            console.warn("Context Engine: échec construction contexte:", ctxErr);
          }
        }
        // ── Mémoire de projet (H3) : injecter PROJECT_MEMORY.md une fois par session ──
        const wantMemory = !state.memoryInjected;
        if (wantMemory && !isSlashCommand) {
          try {
            const config = await invoke("get_config");
            if (config && config.project_memory_enabled !== false) {
              const memBlock = await buildMemoryBlock(window._pilotProjectPath);
              if (memBlock) {
                finalMessage = memBlock + finalMessage;
                state.memoryInjected = true;
              }
            }
          } catch (memErr) {
            console.warn("Mémoire projet: échec injection:", memErr);
          }
        }
        const payload = { message: finalMessage };
        if (images) payload.images = images;
        // D1 : prompt envoyé depuis le desktop (chat standard) → origine locale.
        // Les prompts distants (web) ne passent pas ici (envoyés via /api/agent/prompt
        // côté backend) ; leur origine est positionnée via l'événement user_message.
        state.lastPromptOrigin = "desktop";
        await invoke("send_agent_prompt", payload);
        state.pendingImages = [];
        renderImagePreviews();
      }
    } catch (e) {
      console.error("Erreur envoi prompt:", e);
      appendErrorMessage(messagesEl, `Erreur: ${e}`);
    }
  };

  /**
   * Retry 1-clic du dernier prompt après une erreur de connexion épuisée
   * (chat standard). Replace le dernier message + images dans la zone de saisie
   * et relance l'envoi standard (en repassant par sendPrompt : resync modèle,
   * context engine, mémoire, etc.).
   */
  const retryLastPrompt = () => {
    if (state.isStreaming || !state.lastUserPrompt) return;
    // Réutiliser la même logique d'envoi : remettre texte + images puis appeler sendPrompt.
    inputEl.value = state.lastUserPrompt;
    autoResizeTextarea();
    if (state.lastRetryImages && state.lastRetryImages.length) {
      state.pendingImages = state.lastRetryImages.map((img) => ({
        // lastRetryImages est au format payload ({type, mimeType, data}) ;
        // pendingImages attend {name, mimeType, dataUrl, base64}.
        name: img.name || "image",
        mimeType: img.mimeType,
        dataUrl: `data:${img.mimeType};base64,${img.data}`,
        base64: img.data,
      }));
      renderImagePreviews();
    } else {
      state.pendingImages = [];
      renderImagePreviews();
    }
    sendPrompt();
  };

  // Touche Entrée pour envoyer
  inputEl.addEventListener("keydown", (e) => {
    // Gestion du popup de sessions si visible
    if (resumePopup && resumePopup.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveResumeSelection(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveResumeSelection(-1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideResumePopup();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyResumeSelection(messagesEl);
        return;
      }
    }

    // Gestion du popup /prompt si visible
    if (promptPopupEl && promptPopupEl.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        movePromptSelection(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        movePromptSelection(-1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hidePromptPopup();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyPromptSelection();
        return;
      }
    }

    // Gestion de l'autocomplétion si visible
    if (autocompleteEl.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveAcSelection(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveAcSelection(-1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
      if (e.key === "Enter" && acIndex >= 0 && acIndex < acFiltered.length) {
        e.preventDefault();
        const isModelAlias = acFiltered[acIndex].category === "modèle";
        applyAcSelection();
        // Ne pas envoyer le message si c'est un alias de modèle (déjà géré par applyModelAlias)
        if (!isModelAlias) sendPrompt();
        return;
      }
      if (e.key === "Tab" && acIndex >= 0 && acIndex < acFiltered.length) {
        e.preventDefault();
        const isModelAlias = acFiltered[acIndex].category === "modèle";
        applyAcSelection();
        if (!isModelAlias) sendPrompt();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (autocompleteEl.classList.contains("visible") && acIndex >= 0) {
        applyAcSelection();
      } else {
        hideAutocomplete();
        sendPrompt();
      }
    }
  });

  // Détection du / pour autocomplétion (commandes + alias de modèles)
  inputEl.addEventListener("input", () => {
    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const beforeCursor = val.substring(0, cursorPos);

    // Chercher le dernier / avant le curseur
    const lastSlash = beforeCursor.lastIndexOf("/");
    if (lastSlash >= 0) {
      const prefix = beforeCursor.substring(0, lastSlash);
      if (prefix === "" || prefix.endsWith(" ") || prefix.endsWith("\n")) {
        const query = beforeCursor.substring(lastSlash + 1).toLowerCase();
        showAutocomplete(query);
        return;
      }
    }
    hideAutocomplete();
  });

  // Clics sur la barre d'outils et bouton envoi
  wrapper.addEventListener("click", async (e) => {
    // V3 étape 6 : contrôles par tâche (sauter / éditer la description)
    const taskBtn = e.target.closest("[data-task-action]");
    if (taskBtn) {
      const taskAction = taskBtn.dataset.taskAction;
      const taskId = Number(taskBtn.dataset.taskId);
      if (taskAction === "skip") {
        await skipTask(messagesEl, state, statusEl, taskId);
      } else if (taskAction === "edit") {
        await editTaskDescription(messagesEl, state, taskId);
      }
      return;
    }
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case "send":
        sendPrompt();
        break;
      case "retry-last-prompt":
        retryLastPrompt();
        break;
      case "voice":
        toggleVoiceInput();
        break;
      case "abort":
        try {
          await invoke("abort_agent");
          statusEl.textContent = "Arrêté";
          statusEl.className = "agent-status agent-status-idle";
          state.isStreaming = false;
          // Bug « reprise intempestive de l'agent après arrêt » : un arrêt manuel
          // en mode orchestration doit aussi mettre le plan en pause. Sinon,
          // handleOrchestrationAgentEnd (déclenché par l'agent_end qui suit
          // l'abort) voit orchestrationRunning=true, traite la fin et relance
          // executeNextTask → l'agent reprend tout seul la tâche suivante.
          // En passant orchestrationRunning=false, handleOrchestrationAgentEnd
          // s'arrête immédiatement ; orchestrationPaused=true garde
          // executeNextTask. La reprise devient manuelle (bouton ▶️).
          if (state.orchestrationEnabled && state.orchestrationRunning) {
            state.orchestrationPaused = true;
            state.orchestrationRunning = false;
            if (state.orchestrationTimeout) {
              clearTimeout(state.orchestrationTimeout);
              state.orchestrationTimeout = null;
            }
            updateOrchestrationButtons(state);
            appendSystemMessage(messagesEl, "⏹️ Agent arrêté — plan mis en pause. Cliquez sur ▶️ (Reprendre) pour continuer.");
          }
        } catch (err) {
          console.error("Erreur abort:", err);
        }
        break;
      case "new-session":
        try {
          // Déterminer le modèle à appliquer après le reset. On privilégie le
          // defaultModel du registre global (model-switch.json) paramétré dans
          // l'onglet Fournisseurs ; à défaut on retombe sur le modèle courant.
          let targetModel = globalDefaultModel;
          if (!targetModel) {
            try {
              const kind = backendKind();
              const stem = (kind && kind !== "unknown") ? kind : "pi";
              const acfg = await invoke("read_model_aliases", { stem });
              if (acfg && typeof acfg.defaultModel === "string") {
                targetModel = acfg.defaultModel;
                globalDefaultModel = targetModel;
              }
            } catch (_) {}
          }
          if (!targetModel) targetModel = state.currentModel;
          await invoke("new_agent_session");
          // Appliquer le modèle cible (new_session le reset au défaut de pi).
          if (targetModel) {
            const [provider, ...modelParts] = targetModel.split("/");
            const modelId = modelParts.join("/");
            if (provider && modelId) {
              try {
                await invoke("set_agent_model", { provider, modelId });
              } catch (setErr) {
                console.warn("Impossible d'appliquer le modèle après new_session:", setErr);
              }
            }
          }
          // Réinitialiser l'état interne
          state.isStreaming = false;
          state.currentAssistantBlock = null;
          state.currentTextBlock = null;
          state.currentThinkingBlock = null;
          state.currentToolBlocks.clear();
          state.pendingToolCalls.clear();
          state.pendingText = "";
          state.lastAssistantRawText = "";
          state.pendingImages = [];
          state.pendingRender = false;
          messagesEl.innerHTML = "";
          statusEl.textContent = "Nouvelle session";
          statusEl.className = "agent-status agent-status-idle";
          // Recharger les modèles et récupérer le modèle actif après le reset
          await loadModels(state);
          updateStats();
          // Context Engine : reset (réinjecter au prochain prompt)
          state.contextInjected = false;
          state.contextRefreshRequested = false;
          state.memoryInjected = false;
        } catch (err) {
          console.error("Erreur new session:", err);
          // Même en cas d'erreur, réinitialiser l'état pour débloquer l'UI
          state.isStreaming = false;
          state.currentAssistantBlock = null;
          state.currentTextBlock = null;
          state.currentThinkingBlock = null;
          state.currentToolBlocks.clear();
          state.pendingToolCalls.clear();
          state.pendingText = "";
          state.lastAssistantRawText = "";
          state.pendingImages = [];
          state.pendingRender = false;
          messagesEl.innerHTML = "";
          statusEl.textContent = "Nouvelle session";
          statusEl.className = "agent-status agent-status-idle";
        }
        break;
      case "compact":
        try {
          await invoke("compact_agent_context");
          appendSystemMessage(messagesEl, "🧹 Compaction du contexte...");
          // Context Engine : la compaction efface le contexte → réinjecter au prochain prompt
          state.contextInjected = false;
          state.memoryInjected = false;
        } catch (err) {
          console.error("Erreur compact:", err);
        }
        break;
      case "quality-gate": {
        // Toggle + persistance + relance de l'agent (skills chargés au démarrage de pi).
        let config;
        try { config = await invoke("get_config"); } catch (e) { console.error(e); break; }
        const newState = !config.quality_gate_enabled;
        config.quality_gate_enabled = newState;
        try { await invoke("save_config", { config }); } catch (e) { console.error("save_config:", e); break; }
        if (qgBtn) {
          qgBtn.classList.toggle("active", newState);
          qgBtn.title = newState
            ? "Quality-gate activé (cliquez pour désactiver)"
            : "Quality-gate (cliquez pour activer l'anti-régression avant modif. de code)";
        }
        try {
          await invoke("stop_agent_session").catch(() => {});
          await invoke("start_agent_session");
          if (config.rpc_no_session) {
            // Pas de persistance : reset la session pi et l'UI (historique perdu).
            try { await invoke("send_rpc_command", { command: JSON.stringify({ type: "new_session" }) }); } catch (_) {}
            messagesEl.innerHTML = "";
          }
          appendSystemMessage(messagesEl, newState
            ? "🛡️ Quality-gate activé. Agent redémarré" + (config.rpc_no_session ? "" : " (session conservée)") + "."
            : "🛡️ Quality-gate désactivé. Agent redémarré" + (config.rpc_no_session ? "" : " (session conservée)") + ".");
        } catch (e) {
          appendSystemMessage(messagesEl, "🛡️ Quality-gate " + (newState ? "activé" : "désactivé") + " (relance agent échouée : prendra effet au prochain démarrage de Pilot).");
          console.error("Relance agent quality-gate:", e);
        }
        break;
      }
      case "context": {
        // Context Engine (H1) : forcer la ré-injection du contexte projet au prochain prompt.
        state.contextRefreshRequested = true;
        const ctxBtn = wrapper.querySelector("#agent-ctx-btn");
        if (ctxBtn) {
          ctxBtn.classList.add("active");
          ctxBtn.title = "Context Engine : contexte rafraîchi, sera réinjecté au prochain envoi";
        }
        try {
          const { toastInfo, toastWarning } = await import("./toast.js");
          // V2 (RAG) : si activé, on lance un rebuild complet de l'index vectoriel.
          // Sinon, V1 heuristique — simple refresh au prochain prompt.
          let ragRebuild = false;
          try {
            const config = await invoke("get_config");
            if (config && config.context_rag_enabled === true && window._pilotProjectPath
                && config.context_rag_endpoint && config.context_rag_model) {
              ragRebuild = true;
              toastInfo("📑 Indexation RAG en cours… (peut prendre quelques secondes)");
              // Écouter la fin du build (une seule fois) — event émis par le backend.
              const stopListen = await listen("context-index-done", (ev) => {
                stopListen();
                const p = ev.payload || {};
                if (p.ok) {
                  toastInfo(`📑 Index RAG reconstruit — ${p.stats.chunks} chunks (${p.stats.files} fichiers, ${p.stats.elapsed_ms} ms)`);
                } else {
                  toastWarning(`📑 Indexation RAG échouée : ${p.error || "erreur"}`);
                }
              });
              await invoke("context_index_clear", { projectPath: window._pilotProjectPath });
              await invoke("build_context_index", {
                projectPath: window._pilotProjectPath,
                endpoint: config.context_rag_endpoint,
                model: config.context_rag_model,
              });
            }
          } catch (ragErr) {
            console.warn("[context] RAG rebuild échec:", ragErr);
            if (ragRebuild) toastWarning("📑 Indexation RAG échouée : " + ragErr);
          }
          if (!ragRebuild) {
            toastInfo("📑 Contexte projet rafraîchi — sera injecté au prochain envoi");
          }
        } catch (_) { /* toast indisponible */ }
        break;
      }
      case "memory": {
        // Mémoire projet (H3) : ouvrir/éditer PROJECT_MEMORY.md (créé s'il n'existe pas).
        try {
          const projectPath = window._pilotProjectPath;
          if (!projectPath) {
            const { toastWarning } = await import("./toast.js");
            toastWarning("📝 Ouvre d'abord un projet pour utiliser la mémoire projet");
            break;
          }
          const abs = await initProjectMemory(projectPath);
          if (abs && window._pilotTabs) {
            await window._pilotTabs.openFile(abs, "edit");
          }
        } catch (e) {
          console.error("Ouverture mémoire projet:", e);
          appendErrorMessage(messagesEl, `❌ Ouverture mémoire projet échouée : ${e}`);
        }
        break;
      }
      case "agents-md": {
        // Issue #5 : générer / mettre à jour AGENTS.md via le modèle du chat.
        // AGENTS.md est lu nativement par pi/plh (discovery system prompt) ;
        // on ne l'injecte pas par Pilot. Le bouton lance un pi temporaire cadré
        // (cwd = projet) qui analyse le projet et écrit le fichier.
        const { toastError, toastSuccess, toastInfo } = await import("./toast.js");
        const amdBtn = btn;
        if (amdBtn) amdBtn.disabled = true;
        try {
          appendSystemMessage(messagesEl, "🤖 Génération / mise à jour d'AGENTS.md… (l'agent analyse le projet)");
          const summary = await generateAgentsMd(state.currentModel, {
            onInfo: (m) => toastInfo(m),
            onError: (m) => { toastError(m); appendErrorMessage(messagesEl, `❌ ${m}`); },
            onSuccess: (m) => { toastSuccess(m); appendSystemMessage(messagesEl, m); },
          });
          if (summary) {
            appendSystemMessage(messagesEl, `📋 AGENTS.md — résumé de l'agent :\n${summary}`);
          }
        } catch (e) {
          console.error("Génération AGENTS.md:", e);
          toastError(`Échec génération AGENTS.md : ${e}`);
          appendErrorMessage(messagesEl, `❌ Génération AGENTS.md échouée : ${e}`);
        } finally {
          if (amdBtn) amdBtn.disabled = false;
        }
        break;
      }
      case "reconnect":
        try {
          appendSystemMessage(messagesEl, "🔄 Reconnexion de l'agent en cours…");
          state.restarting = true;
          await invoke("stop_agent_session").catch(() => {});
          state.piDead = false;
          await invoke("start_agent_session");
          // Attendre que pi soit prêt (poll ~10s). Si pi meurt au démarrage,
          // on le détecte vite au lieu de laisser l'utilisateur sur un
          // « pipe closed » au prochain changement de modèle.
          const ready = await waitForPiReady(state, 10);
          state.restarting = false;
          if (!ready) {
            appendErrorMessage(messagesEl, "❌ L'agent n'a pas redémarré (pi ne répond pas). Cliquez à nouveau sur 🔄 pour réessayer.");
            statusEl.textContent = "⚠️ Échec reconnexion";
            statusEl.className = "agent-status agent-status-error";
            return;
          }
          // Redémarrer une nouvelle session
          try {
            await invoke("send_rpc_command", { command: JSON.stringify({ type: "new_session" }) });
          } catch (_) {}
          statusEl.textContent = "Prêt";
          statusEl.className = "agent-status agent-status-idle";
          messagesEl.innerHTML = "";
          appendSystemMessage(messagesEl, "✅ Agent reconnecté");
          // Context Engine : nouvelle session → réinjecter le contexte
          state.contextInjected = false;
          state.contextRefreshRequested = false;
          state.memoryInjected = false;
          // Remettre le bouton en mode abort
          setIcon(btn, "square");
          btn.title = "Arrêter l'agent";
          btn.dataset.action = "abort";
          // Remettre les stats à jour
          updateStats();
          loadCommands();
        } catch (err) {
          console.error("Erreur reconnexion:", err);
          appendErrorMessage(messagesEl, `❌ Échec reconnexion: ${err}`);
        }
        break;
      case "orchestration": {
        const orchBtn = e.target.closest("[data-action=\"orchestration\"]");
        if (state.orchestrationEnabled) {
          // ── Désactivation ──
          state.orchestrationEnabled = false;
          // Context Engine : l'orchestration a fait un new_agent_session ; à la
          // désactivation on repasse en chat standard → réinjecter le contexte.
          state.contextInjected = false;
          state.contextRefreshRequested = false;
          state.memoryInjected = false;
          orchBtn.classList.remove("active");
          orchBtn.title = "Mode Orchestration : architecte + codeur";
          state.orchestrationPlan = null;
          state.orchestrationRunning = false;
          state.orchestrationPaused = false;
          state.orchestrationEscalating = false;
          state.orchestrationRevising = false;
          state.orchestrationSubdividing = false;
          state.orchestrationSubdividingTaskId = null;
          state.orchestrationTaskStartTime = null;
          state.orchestrationResponseChars = 0;
          state.orchestrationConnectionError = false;
          state.orchestrationConnErrorSeen = false;
          state.orchestrationTasksSinceRevision = 0;
          state.orchestrationCachedTree = null;
          state.orchestrationActiveRole = null;
          state.orchestrationLintAttempts = {};
          state.orchestrationNudgeAttempts = {};
          // E2 : reset auto-test
          state.orchestrationTestBaseline = null;
          state.orchestrationTestBaselineComputing = false;
          state.orchestrationTestBaselineWarned = false;
          state.orchestrationTestRunner = null;
          state.orchestrationTestAttempts = {};
          // H2 V1 : reset reviewer
          state.orchestrationReviewAttempts = {};
          try { await invoke("stop_reviewer_session"); } catch (_) {}
          state._previousPlan = null;
          state.orchestrationTasksInBatch = 0;
          state.orchestrationFinalReview = false;
          state.orchestrationFinalReviewCount = 0;
          if (state.orchestrationTimeout) {
            clearTimeout(state.orchestrationTimeout);
            state.orchestrationTimeout = null;
          }
          orchestrationPanel.classList.add("hidden");
          // Réafficher le sélecteur standard et cacher les sélecteurs orch
          setModelSelectorsOrchestrationMode(false, state);
          // Restaurer le modèle standard sélectionné (mémorisé à l'activation)
          if (state.defaultModel) {
            const [provider, ...parts] = state.defaultModel.split("/");
            const modelId = parts.join("/");
            try {
              await invoke("set_agent_model", { provider, modelId });
              state.currentModel = state.defaultModel;
              // Vérifier que le modèle est bien actif côté agent (resync)
              const confirmed = await confirmActiveModel(state.defaultModel);
              if (confirmed && confirmed !== state.defaultModel) {
                appendSystemMessage(messagesEl, `⚠️ Modèle restauré demandé ${state.defaultModel}, mais le modèle actif est ${confirmed}. Vérifiez la configuration.`);
              } else {
                appendSystemMessage(messagesEl, `🔄 Modèle restauré : ${state.defaultModel}`);
              }
              // Resync le sélecteur standard sur le modèle restauré
              const stdSel = document.getElementById("agent-model-select");
              if (stdSel) stdSel.value = state.defaultModel;
              updateStats();
            } catch (err) {
              appendErrorMessage(messagesEl, `❌ Impossible de restaurer le modèle standard (${state.defaultModel}) : ${err}`);
            }
          }
          state.defaultModel = "";
          state.orchestrationLastUserPrompt = "";
          updateOrchestrationTitle(state);
          appendSystemMessage(messagesEl, "🧠 Mode Orchestration désactivé.");
        } else {
          // ── Activation : popup de sélection + test des modèles ──
          // La popup teste successivement le codeur puis l'orchestrateur. Si les
          // deux répondent, le mode s'active avec ces modèles ; sinon, message
          // d'erreur et restauration du modèle d'origine, le mode reste off.
          showOrchestrationModelPicker(state, messagesEl, statusEl, orchBtn);
        }
        break;
      }
      case "orch-pause":
        state.orchestrationPaused = true;
        appendSystemMessage(messagesEl, "⏸️ Plan mis en pause après la tâche en cours.");
        updateOrchestrationButtons(state);
        break;
      case "orch-resume":
        state.orchestrationPaused = false;
        state.orchestrationConnectionError = false;
        state.orchestrationConnErrorSeen = false;
        // Un arrêt manuel (abort) passe orchestrationRunning=false ; la reprise
        // manuelle doit le réactiver pour que handleOrchestrationAgentEnd
        // traite la fin de la prochaine tâche.
        state.orchestrationRunning = true;
        appendSystemMessage(messagesEl, "▶️ Reprise du plan.");
        updateOrchestrationButtons(state);
        if (state.orchestrationPlan && !state.isStreaming) {
          executeNextTask(messagesEl, state, statusEl);
        }
        break;
      case "orch-reset": {
        // A1 : reset snapshots aussi (nouveau plan → snapshots obsolètes)
        state.orchestrationSnapshots = {};
        state.orchestrationSnapshotsAvailable = null;
        state.orchestrationSnapshotsWarned = false;
        state.orchestrationCancelledTasks = [];
        // H2 V1 : reset reviewer (nouveau plan / reset)
        state.orchestrationReviewAttempts = {};
        try { await invoke("stop_reviewer_session"); } catch (_) {}
        // Reprise post-compaction : annuler un timer de reprise en cours.
        if (state.orchestrationCompactionTimer) { clearTimeout(state.orchestrationCompactionTimer); state.orchestrationCompactionTimer = null; }
        state.orchestrationCompactionResumePending = false;
        state.orchestrationPlan = null;
        state.orchestrationLastUserPrompt = "";
        state.orchestrationRunning = false;
        state.orchestrationPaused = false;
        state.orchestrationEscalating = false;
        state.orchestrationRevising = false;
        state.orchestrationSubdividing = false;
        state.orchestrationSubdividingTaskId = null;
        state.orchestrationExtractingMemory = null;
        state.orchestrationTaskStartTime = null;
        state.orchestrationResponseChars = 0;
        state.orchestrationConnectionError = false;
        state.orchestrationConnErrorSeen = false;
        state.orchestrationTasksSinceRevision = 0;
        state.orchestrationCachedTree = null;
        state.orchestrationLintAttempts = {};
        state.orchestrationNudgeAttempts = {};
        // E2 : reset auto-test (nouveau plan → baseline obsolète)
        state.orchestrationTestBaseline = null;
        state.orchestrationTestBaselineComputing = false;
        state.orchestrationTestBaselineWarned = false;
        state.orchestrationTestRunner = null;
        state.orchestrationTestAttempts = {};
        // H2 V1 : reset reviewer (nouveau plan)
        state.orchestrationReviewAttempts = {};
        state._previousPlan = null;
        state.orchestrationTasksInBatch = 0;
        state.orchestrationFinalReview = false;
        state.orchestrationFinalReviewCount = 0;
        if (state.orchestrationTimeout) {
          clearTimeout(state.orchestrationTimeout);
          state.orchestrationTimeout = null;
        }
        orchestrationPanel.classList.add("hidden");
        try { await invoke("delete_plan"); } catch (_) {}
        appendSystemMessage(messagesEl, "🔄 Plan réinitialisé. Envoyez un message pour créer un nouveau plan.");
        break;
      }
      case "orch-undo": {
        // A1 : annuler la dernière tâche annulable (restaurer les fichiers).
        const target = lastUndoableTask(state);
        if (!target) {
          appendSystemMessage(messagesEl, "↩️ Aucune tâche annulable (aucun snapshot avec fichiers, ou déjà annulée).");
          break;
        }
        if (state.isStreaming) {
          appendSystemMessage(messagesEl, "↩️ Impossible d'annuler pendant l'exécution du codeur. Mettez d'abord en pause.");
          break;
        }
        const taskObj = state.orchestrationPlan.plan.find((t) => t.id === target.taskId);
        const taskTitle = taskObj ? taskObj.title : target.taskId;
        const ok = await confirm(
          `Annuler la tâche ${target.taskId} « ${taskTitle} » ?\n\nLes ${target.snapshot.files.length} fichier(s) modifié(s) par cette tâche seront restaurés à leur état d'avant (les fichiers créés seront supprimés).\n\nToute modification manuelle que vous auriez faite sur ces fichiers sera perdue.`,
          { title: "Pilot — Annulation de tâche", kind: "warning" }
        );
        if (!ok) break;
        try {
          const res = await invoke("git_restore_snapshot", { sha: target.snapshot.sha, files: target.snapshot.files });
          // Invalider le cache d'arbre (fichiers restaurés/supprimés).
          state.orchestrationCachedTree = null;
          // Marquer la tâche comme annulée.
          if (!state.orchestrationCancelledTasks) state.orchestrationCancelledTasks = [];
          state.orchestrationCancelledTasks.push(target.taskId);
          const progress = state.orchestrationPlan.progress;
          if (progress.completed) progress.completed = progress.completed.filter((id) => id !== target.taskId);
          progress.current_task = 0;
          // Supprimer le snapshot (consommé — pas de double undo sur la même tâche).
          delete state.orchestrationSnapshots[target.taskId];
          try { await invoke("save_plan", { planJson: JSON.stringify(state.orchestrationPlan, null, 2) }); } catch (_) {}
          appendSystemMessage(messagesEl, `↩️ Tâche ${target.taskId} « ${taskTitle} » annulée : ${res.restored.length} fichier(s) restauré(s), ${res.deleted.length} supprimé(s).`);
          renderOrchestrationPlan(messagesEl, state);
          updateOrchestrationButtons(state);
        } catch (e) {
          console.error("Erreur annulation tâche:", e);
          appendErrorMessage(messagesEl, `❌ Erreur lors de l'annulation : ${e}`);
        }
        break;
      }
    }
  });

  // ── Écoute des événements RPC ──
  const orchFns = { renderOrchestrationPlan, executeNextTask, handleOrchestrationAgentEnd, handleOrchestrationTimeout, handleTaskFailure, handleOrchestrationConnectionError, switchToOrchestrator, switchToCoder, resetIdleTimer: resetOrchestrationIdleTimer, parsePlanResponse, validatePlan };
  const unlisten = await listen("rpc-event", (event) => {
    const payload = event.payload;
    try {
      handleRpcEvent(payload, messagesEl, state, statusEl, parsePlanResponse, orchFns);
    } catch (err) {
      console.error('[rpc-event] erreur dans handleRpcEvent:', err);
    }
  });

  // ── H2 V1 : écoute des événements du reviewer (canal séparé) ──
  const unlistenReviewer = await listen("rpc-event-reviewer", (event) => {
    const payload = event.payload;
    try {
      handleReviewerEvent(payload, messagesEl, state, statusEl);
    } catch (err) {
      console.error('[rpc-event-reviewer] erreur dans handleReviewerEvent:', err);
    }
  });

  // ── Démarrer une nouvelle session ──
  try {
    await invoke("send_rpc_command", { command: JSON.stringify({ type: "new_session" }) });
  } catch (e) {
    console.error("Erreur new_session:", e);
  }

  // ── Charger les stats initiales ──
  updateStats();

  // ── Charger les modèles disponibles (forcer le defaultModel global) ──
  loadModels(state, true);

  // ── Vérifier la reachabilité du modèle actif (point 2) ──
  // Détecte au démarrage un modèle par défaut injoignable (ex: serveur
  // llama-cpp/ollama éteint) pour prévenir avant le 1er prompt « ça répond pas ».
  checkDefaultModelReachable(state, messagesEl);

  // ── Charger les commandes disponibles ──
  await loadCommands();

  // ── Charger les alias de modèles ──
  // Important : loadCommands() fait `allCommands = list.map(...)` qui écrase le
  // tableau. On l'await AVANT loadModelAliases() pour garantir que les alias ne
  // sont pas perdus par un race condition entre les deux invoke concurrents
  // (issue #6 : la liste `/` n'affichait plus les alias).
  await loadModelAliases();

  // ── Changement de modèle dans le select ──
  const modelSelect = document.getElementById("agent-model-select");
  modelSelect.addEventListener("change", async () => {
    const value = modelSelect.value;
    if (!value) return;
    // En mode orchestration, interdire le changement manuel de modèle
    if (state.orchestrationEnabled) {
      appendSystemMessage(messagesEl, "⚠️ Changement de modèle désactivé en mode Orchestration. Les modèles sont gérés automatiquement.");
      // Restaurer le modèle courant dans le select
      const currentOpt = Array.from(modelSelect.options).find(o => o.value === state.currentModel);
      if (currentOpt) modelSelect.value = state.currentModel;
      return;
    }
    const [provider, modelId] = value.split("/", 2);
    try {
      await invoke("set_agent_model", { provider, modelId });
      state.currentModel = value;
      appendSystemMessage(messagesEl, `🔄 Modèle changé : ${provider}/${modelId}`);
      updateStats();
    } catch (err) {
      console.error("Erreur changement modèle:", err);
      appendErrorMessage(messagesEl, `❌ Impossible de changer de modèle : ${err}`);
    }
  });

  // ── Fonctions d'orchestration ──

  /** Efface le contexte de conversation (nouvelle session RPC) pour démarrer avec un contexte vierge.
   *  Utilisé avant chaque envoi de prompt en mode orchestration (plan, tâche, escalade)
   *  pour éviter que le codeur/orchestrateur ne voie tout l'historique accumulé.
   */
  async function clearContextForOrchestration() {
    try {
      await invoke("new_agent_session");
      // Nouveau tour : incrémenter l'identifiant de session (point 5.7)
      state.orchestrationTurnId = (state.orchestrationTurnId || 0) + 1;
    } catch (e) {
      console.warn("[orch] new_session échoué (session probablement non démarrée) :", e);
    }
  }

  /** Bascule vers le modèle orchestrateur */
  async function switchToOrchestrator(st) {
    if (!st.orchestratorModel) return false;
    const [provider, ...parts] = st.orchestratorModel.split("/");
    const modelId = parts.join("/");
    try {
      await invoke("set_agent_model", { provider, modelId });
      st.currentModel = st.orchestratorModel;
      st.orchestrationActiveRole = "orchestrator";
      if (st.orchestrationConfirmModelSwitch) {
        const confirmed = await confirmActiveModel(st.orchestratorModel);
        if (confirmed === st.orchestratorModel) {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🧠 ${st.orchestratorModel} (orchestrateur) ✓ confirmé`);
        } else if (confirmed) {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🧠 ${st.orchestratorModel} demandée — ⚠️ mais pi rapporte le modèle actif = ${confirmed}. La bascule n'a pas pris effet (vérifiez la configuration).`);
        } else {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🧠 ${st.orchestratorModel} (orchestrateur)`);
        }
      } else {
        appendSystemMessage(messagesEl, `⏩ Bascule vers 🧠 ${st.orchestratorModel} (orchestrateur)`);
      }
      return true;
    } catch (err) {
      appendErrorMessage(messagesEl, `❌ Erreur bascule orchestrateur : ${err}`);
      return false;
    }
  }

  /** Bascule vers le modèle codeur */
  async function switchToCoder(st) {
    if (!st.coderModel) return false;
    const [provider, ...parts] = st.coderModel.split("/");
    const modelId = parts.join("/");
    try {
      await invoke("set_agent_model", { provider, modelId });
      st.currentModel = st.coderModel;
      st.orchestrationActiveRole = "coder";
      if (st.orchestrationConfirmModelSwitch) {
        const confirmed = await confirmActiveModel(st.coderModel);
        if (confirmed === st.coderModel) {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🔨 ${st.coderModel} (codeur) ✓ confirmé`);
        } else if (confirmed) {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🔨 ${st.coderModel} demandée — ⚠️ mais pi rapporte le modèle actif = ${confirmed}. La bascule n'a pas pris effet (vérifiez la configuration).`);
        } else {
          appendSystemMessage(messagesEl, `⏩ Bascule vers 🔨 ${st.coderModel} (codeur)`);
        }
      } else {
        appendSystemMessage(messagesEl, `⏩ Bascule vers 🔨 ${st.coderModel} (codeur)`);
      }
      return true;
    } catch (err) {
      appendErrorMessage(messagesEl, `❌ Erreur bascule codeur : ${err}`);
      return false;
    }
  }

  /**
   * Interroge pi (get_state) pour confirmer le modèle réellement actif après un set_model.
   * Retourne "provider/id" du modèle actif, ou "" si introuvable.
   * Permet de détecter si la bascule n'a pas pris effet (ex: new_session qui reset).
   */
  async function confirmActiveModel(expected) {
    try {
      const agentState = await invoke("get_agent_state");
      if (agentState && agentState.data && agentState.data.model) {
        const m = agentState.data.model;
        const confirmed = `${m.provider || ""}/${m.id || ""}`;
        console.log(`[orch] confirmActiveModel: attendu=${expected} confirmé=${confirmed}`);
        return confirmed;
      }
    } catch (e) {
      console.warn("[orch] get_agent_state échoué :", e);
    }
    return "";
  }

  // Les fonctions de construction de prompts (buildPlanPrompt, buildTaskPrompt,
  // buildEscalationPrompt, buildRevisionPrompt, parsePlanResponse, etc.) sont
  // importees depuis ./orchestration.js.

  // ────────────────────────────────────────────────────────────────────────
  // Popup d'activation du Mode Orchestration + test de réponse des modèles
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Teste si un modèle répond réellement (pas seulement s'il est configurable).
   * Procédure : new_session → set_model → prompt minimal "Réponds uniquement OK"
   * → attend agent_end (succès) / message d'erreur (échec) / timeout 20 s.
   * Pendant le test, state.modelTestActive=true pour neutraliser handleRpcEvent
   * (les événements sont captés par un listener dédié ici).
   *
   * @param {string} provider
   * @param {string} modelId
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function testModelResponds(provider, modelId) {
    // Repartir d'un contexte vierge
    try { await invoke("new_agent_session"); } catch (_) {}
    // Bascule vers le modèle à tester
    try {
      await invoke("set_agent_model", { provider, modelId });
    } catch (e) {
      return { ok: false, error: `set_model échoué : ${e}` };
    }
    state.currentModel = `${provider}/${modelId}`;
    state.modelTestActive = true;

    let settled = false;
    let timer = null;
    let unlistenTest = null;
    let resolver = null;
    let receivedText = false; // un vrai texte de réponse a-t-il été reçu ?

    // Termine le test : stoppe pi (abort) pour éviter les retries/événements
    // résiduels, puis garde modelTestActive=true pendant un court délai afin
    // que les derniers événements en vol (auto_retry, agent_end d'abort...)
    // soient encore bloqués par handleRpcEvent et ne polluent pas le chat.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (unlistenTest) { try { unlistenTest(); } catch (_) {} unlistenTest = null; }
      invoke("abort_agent").catch(() => {});
      setTimeout(() => {
        state.modelTestActive = false;
        if (resolver) resolver(result);
      }, 400);
    };

    // Listener dédié : capte la fin/erreur du prompt de test.
    // IMPORTANT : agent_end seul NE signifie PAS un succès (pi émet aussi
    // agent_end après un abort/erreur de connexion). On n'accepte le succès
    // que si du texte a réellement été reçu.
    unlistenTest = await listen("rpc-event", (event) => {
      const p = event.payload;
      const t = p.type;
      if (t === "message_update") {
        const d = p.assistantMessageEvent;
        if (d && d.type === "text_delta" && d.delta) receivedText = true;
      } else if (t === "message") {
        const m = p.message;
        if (m && m.role === "assistant") {
          if (m.stopReason === "error") {
            const errMsg = m.errorMessage === "Connection error."
              ? "erreur de connexion (modèle injoignable)"
              : (m.errorMessage || "erreur");
            finish({ ok: false, error: errMsg });
          } else if (m.stopReason === "aborted") {
            finish({ ok: false, error: "réponse interrompue" });
          } else if (Array.isArray(m.content)) {
            for (const c of m.content) if (c.type === "text" && c.text) receivedText = true;
          } else if (typeof m.content === "string" && m.content) {
            receivedText = true;
          }
        }
      } else if (t === "auto_retry_start") {
        // pi n'arrive pas à joindre le modèle → échec direct (ne pas attendre
        // un agent_end trompeur).
        finish({ ok: false, error: "erreur de connexion (modèle injoignable)" });
      } else if (t === "agent_end") {
        if (receivedText) finish({ ok: true });
        else finish({ ok: false, error: "aucune réponse reçue (modèle probablement injoignable)" });
      } else if (t === "extension_error") {
        finish({ ok: false, error: p.message || "erreur extension" });
      }
    });

    const resultPromise = new Promise((resolve) => { resolver = resolve; });

    // Timeout de sécurité (20 s)
    timer = setTimeout(() => {
      finish({ ok: false, error: "timeout (le modèle n'a pas répondu en 20 s)" });
    }, 20000);

    // Envoi du prompt de test
    try {
      await invoke("send_agent_prompt", { message: 'Réponds uniquement "OK".' });
    } catch (e) {
      finish({ ok: false, error: `envoi prompt échoué : ${e}` });
    }

    return resultPromise;
  }

  /**
   * Active le Mode Orchestration après validation + test réussi des deux modèles.
   * Reprend la logique d'activation précédente (switch orchestrateur, chargement
   * plan existant) SANS le pré-chauffage du codeur (désormais superflu car le
   * test a déjà sollicité le codeur).
   */
  async function activateOrchestrationWith(orchModel, coderModel, savedDefaultModel, orchBtn, mEl, st, sEl, overrides) {
    st.orchestrationEnabled = true;
    st.orchestratorModel = orchModel;
    st.coderModel = coderModel;
    // Sauvegarder le modèle par défaut pour le restaurer à la désactivation
    st.defaultModel = savedDefaultModel || st.currentModel || "";
    // Overrides session (non persistés) : granularité + reviewer
    if (overrides) {
      if (overrides.granularity) {
        st.orchestrationGranularity = overrides.granularity;
        st.orchestrationEffectiveGranularity = overrides.granularity;
      }
      st.orchestrationReviewerEnabled = !!overrides.reviewerEnabled;
      if (overrides.reviewerModel) {
        const [rp, ...rrest] = overrides.reviewerModel.split("/");
        st.orchestrationReviewerProvider = rp || "";
        st.orchestrationReviewerModel = rrest.join("/") || "";
      } else {
        st.orchestrationReviewerProvider = "";
        st.orchestrationReviewerModel = "";
      }
    }

    // Repartir d'un contexte vierge (effacer le prompt de test "OK")
    try {
      await invoke("new_agent_session");
      st.orchestrationTurnId = (st.orchestrationTurnId || 0) + 1;
    } catch (_) {}
    // Bascule vers l'orchestrateur
    const switched = await switchToOrchestrator(st);
    if (!switched) {
      appendErrorMessage(mEl, "❌ Impossible de basculer vers le modèle orchestrateur. Vérifiez la configuration.");
      st.orchestrationEnabled = false;
      return;
    }
    orchBtn.classList.add("active");
    orchBtn.title = "Mode Orchestration activé";
    {
      const gLabels = { atomic: "atomique", fine: "fine", medium: "moyenne", large: "large" };
      const gLabel = gLabels[st.orchestrationGranularity] || st.orchestrationGranularity || "fine";
      let msg = `🧠 Mode Orchestration activé — orchestrateur : ${orchModel}, codeur : ${coderModel}.`;
      msg += `\n   📐 Granularité : ${gLabel}.`;
      if (st.orchestrationReviewerEnabled) {
        const rModel = st.orchestrationReviewerProvider
          ? `${st.orchestrationReviewerProvider}/${st.orchestrationReviewerModel}`
          : "modèle orchestrateur";
        msg += `\n   🔍 Reviewer activé : ${rModel}.`;
      } else {
        msg += `\n   🔍 Reviewer : désactivé.`;
      }
      appendSystemMessage(mEl, msg);
    }

    // Charger un plan existant si présent
    try {
      const planJson = await invoke("load_plan");
      if (planJson) {
        const plan = JSON.parse(planJson);
        st.orchestrationPlan = plan;
        const progress = plan.progress || {};
        const doneIds = [...(progress.completed || []), ...(progress.escalated || [])];
        const remaining = plan.plan.filter(t => !doneIds.includes(t.id));
        if (remaining.length > 0) {
          st.orchestrationRunning = true;
          st.orchestrationPaused = true;
          st.orchestrationFinalReview = false;
          st.orchestrationFinalReviewCount = 0;
        } else {
          st.orchestrationRunning = false;
          st.orchestrationPaused = false;
          st.orchestrationFinalReview = false;
          st.orchestrationFinalReviewCount = 0;
        }
        renderOrchestrationPlan(mEl, st);
        updateOrchestrationButtons(st);
        const msg = remaining.length > 0
          ? `📋 Plan existant chargé (${remaining.length} tâche(s) restante(s)). Cliquez ▶️ pour reprendre ou 🔄 pour un nouveau plan.`
          : "📋 Plan existant chargé — toutes les tâches sont terminées. 🔄 pour un nouveau plan.";
        appendSystemMessage(mEl, msg);
      }
    } catch (_) { /* Pas de plan existant */ }

    // Bascule l'affichage des sélecteurs : cache le sélecteur standard, affiche
    // les 2 sélecteurs (inactifs) orchestrateur + codeur positionnés sur les modèles choisis.
    setModelSelectorsOrchestrationMode(true, st);
  }

  /**
   * Affiche la popup de sélection du modèle orchestrateur et codeur (pré-remplis
   * avec la config), puis au validate : teste successivement le codeur puis
   * l'orchestrateur. Si les deux répondent → active le mode. Sinon → message
   * d'erreur et restauration du modèle d'origine, le mode reste désactivé.
   */
  async function showOrchestrationModelPicker(st, mEl, sEl, orchBtn) {
    // Charger la config pour les valeurs par défaut
    let config;
    try { config = await invoke("get_config"); } catch (e) {
      appendErrorMessage(mEl, `❌ Impossible de charger la configuration : ${e}`);
      return;
    }
    const defaultOrch = config.orchestrator_provider ? `${config.orchestrator_provider}/${config.orchestrator_model_id}` : "";
    const defaultCoder = config.coder_provider ? `${config.coder_provider}/${config.coder_model_id}` : "";
    const defaultGranularity = config.orchestration_granularity || "fine";
    const defaultReviewerEnabled = config.orchestration_reviewer_enabled === true;
    const defaultReviewerModel = config.orchestration_reviewer_provider
      ? `${config.orchestration_reviewer_provider}/${config.orchestration_reviewer_model}` : "";

    // Charger la liste des modèles disponibles
    let models = [];
    try {
      models = await fetchAvailableModels();
    } catch (e) {
      appendErrorMessage(mEl, `❌ Impossible de lister les modèles : ${e}`);
      return;
    }
    if (models.length === 0) {
      appendErrorMessage(mEl, "❌ Aucun modèle disponible. Configurez vos modèles dans pi (ou plh) d'abord, ou vérifiez le chemin dans les paramètres (Gestion RPC).");
      return;
    }

    // Construire la modale (réutilise les classes .modal / .modal-content / .setting-row / .modal-actions)
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.innerHTML = `
      <div class="modal-content" style="width:520px;max-width:95vw;">
        <h2><i data-lucide="brain" class="icon-sm"></i> Mode Orchestration — sélection des modèles</h2>
        <div class="setting-row">
          <label><i data-lucide="brain" class="icon-sm"></i> Orchestrateur (cloud, intelligent)</label>
          <select id="orch-pick-orch"></select>
        </div>
        <div class="setting-row">
          <label><i data-lucide="hammer" class="icon-sm"></i> Codeur (local, économique)</label>
          <select id="orch-pick-coder"></select>
        </div>
        <div class="setting-row">
          <label><i data-lucide="git-branch" class="icon-sm"></i> Granularité des tâches</label>
          <select id="orch-pick-granularity">
            <option value="atomic">Atomique (~10-25 lignes, 1 fichier — modèle local)</option>
            <option value="fine">Fine (~30-60 lignes, max 2 fichiers)</option>
            <option value="medium">Moyenne (~60-120 lignes, max 3 fichiers)</option>
            <option value="large">Large (~100-200 lignes, max 5 fichiers)</option>
          </select>
        </div>
        <div class="setting-row setting-row-checkbox">
          <input type="checkbox" id="orch-pick-reviewer" />
          <label for="orch-pick-reviewer"><i data-lucide="search-check" class="icon-sm"></i> Reviewer indépendant (relecture après chaque tâche)</label>
        </div>
        <div class="setting-row" id="orch-pick-reviewer-row">
          <label>Modèle du reviewer :</label>
          <select id="orch-pick-reviewer-model"></select>
          <small>vide = modèle orchestrateur</small>
        </div>
        <div class="orch-picker-status" id="orch-pick-status"></div>
        <div class="modal-actions">
          <button id="orch-pick-validate"><i data-lucide="circle-check" class="icon-sm"></i> Valider et tester</button>
          <button id="orch-pick-cancel">Annuler</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    refreshIcons(overlay);

    const orchSel = overlay.querySelector("#orch-pick-orch");
    const coderSel = overlay.querySelector("#orch-pick-coder");
    const granularitySel = overlay.querySelector("#orch-pick-granularity");
    const reviewerChk = overlay.querySelector("#orch-pick-reviewer");
    const reviewerSel = overlay.querySelector("#orch-pick-reviewer-model");
    const reviewerRow = overlay.querySelector("#orch-pick-reviewer-row");
    const statusBox = overlay.querySelector("#orch-pick-status");
    const validateBtn = overlay.querySelector("#orch-pick-validate");
    const cancelBtn = overlay.querySelector("#orch-pick-cancel");

    const buildOptions = (sel, defaultValue) => {
      let html = "";
      for (const m of models) {
        const provider = m.provider || m.providerId || "?";
        const id = m.id || m.modelId || "?";
        const label = m.label || `${provider}/${id}`;
        const value = `${provider}/${id}`;
        html += `<option value="${value}">${label}</option>`;
      }
      sel.innerHTML = html;
      if (defaultValue) sel.value = defaultValue;
    };
    buildOptions(orchSel, defaultOrch);
    buildOptions(coderSel, defaultCoder);
    // Granularité : positionner la valeur par défaut
    if (granularitySel) granularitySel.value = defaultGranularity;
    // Reviewer : peupler le sélecteur de modèle + pré-remplir
    // On ajoute une option « vide » (modèle orchestrateur) en tête.
    if (reviewerSel) {
      let html = `<option value="">Modèle orchestrateur (défaut)</option>`;
      for (const m of models) {
        const provider = m.provider || m.providerId || "?";
        const id = m.id || m.modelId || "?";
        const label = m.label || `${provider}/${id}`;
        const value = `${provider}/${id}`;
        html += `<option value="${value}">${label}</option>`;
      }
      reviewerSel.innerHTML = html;
      if (defaultReviewerModel) reviewerSel.value = defaultReviewerModel;
    }
    if (reviewerChk) reviewerChk.checked = defaultReviewerEnabled;
    // Wire-up : désactive le sélecteur de modèle reviewer si checkbox off
    const updateReviewerRow = () => {
      const on = reviewerChk ? reviewerChk.checked : false;
      if (reviewerSel) reviewerSel.disabled = !on;
      if (reviewerRow) reviewerRow.style.opacity = on ? "1" : "0.5";
    };
    if (reviewerChk) reviewerChk.addEventListener("change", updateReviewerRow);
    updateReviewerRow();

    const close = () => overlay.remove();

    cancelBtn.addEventListener("click", () => {
      if (validateBtn.disabled) return; // ne pas annuler pendant un test
      close();
      appendSystemMessage(mEl, "🧠 Activation du mode Orchestration annulée.");
    });

    // Fermer si clic sur l'overlay (en dehors du contenu), sauf pendant un test
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && !validateBtn.disabled) {
        close();
      }
    });

    // Échappement clavier (sauf pendant un test)
    const onKey = (e) => {
      if (e.key === "Escape" && !validateBtn.disabled) {
        close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);

    // Restaure le modèle d'origine (non-orchestrateur) après un échec de test
    const restoreModel = async (savedModel) => {
      // NB : state.modelTestActive est remis à false par finish() (après un délai
      // de 400 ms) ; on ne le touche pas ici pour ne pas court-circuter le
      // blocage des événements résiduels.
      if (savedModel) {
        const [p, ...rest] = savedModel.split("/");
        try { await invoke("set_agent_model", { provider: p, modelId: rest.join("/") }); } catch (_) {}
        state.currentModel = savedModel;
      }
      try { await invoke("new_agent_session"); } catch (_) {}
    };

    const reenableForm = () => {
      validateBtn.disabled = false;
      cancelBtn.disabled = false;
      orchSel.disabled = false;
      coderSel.disabled = false;
      if (granularitySel) granularitySel.disabled = false;
      if (reviewerChk) reviewerChk.disabled = false;
      updateReviewerRow();
    };

    const setStatus = (txt, isErr) => {
      statusBox.textContent = txt;
      statusBox.className = "orch-picker-status" + (isErr ? " orch-picker-status-error" : "");
    };

    validateBtn.addEventListener("click", async () => {
      const orchModel = orchSel.value;
      const coderModel = coderSel.value;
      const chosenGranularity = granularitySel ? granularitySel.value : "fine";
      const reviewerOn = reviewerChk ? reviewerChk.checked : false;
      const reviewerModelVal = (reviewerOn && reviewerSel) ? reviewerSel.value : "";
      if (!orchModel || !coderModel) {
        setStatus("❌ Sélectionnez les deux modèles.", true);
        return;
      }
      if (orchModel === coderModel) {
        setStatus("⚠️ L'orchestrateur et le codeur sont identiques. Choisissez deux modèles différents pour tirer parti du mode orchestration.", true);
        return;
      }
      validateBtn.disabled = true;
      cancelBtn.disabled = true;
      orchSel.disabled = true;
      coderSel.disabled = true;
      if (granularitySel) granularitySel.disabled = true;
      if (reviewerChk) reviewerChk.disabled = true;
      if (reviewerSel) reviewerSel.disabled = true;
      setStatus("");

      // Modèle d'origine (non-orchestrateur) à restaurer en cas d'échec
      const savedModel = state.currentModel || "";

      const splitModel = (full) => { const [p, ...r] = full.split("/"); return [p, r.join("/")]; };

      // Test du codeur d'abord (pour que le modèle actif reste l'orchestrateur à la fin)
      setStatus(`🔨 Test du codeur ${coderModel}...`);
      const [codP, codId] = splitModel(coderModel);
      const coderRes = await testModelResponds(codP, codId);
      if (!coderRes.ok) {
        setStatus(`❌ Codeur (${coderModel}) injoignable : ${coderRes.error}`, true);
        await restoreModel(savedModel);
        appendErrorMessage(mEl, `❌ Mode Orchestration non activé : le codeur (${coderModel}) ne répond pas (${coderRes.error}).`);
        reenableForm();
        return;
      }

      // Test de l'orchestrateur
      setStatus(`🧠 Test de l'orchestrateur ${orchModel}...`);
      const [orchP, orchId] = splitModel(orchModel);
      const orchRes = await testModelResponds(orchP, orchId);
      if (!orchRes.ok) {
        setStatus(`❌ Orchestrateur (${orchModel}) injoignable : ${orchRes.error}`, true);
        await restoreModel(savedModel);
        appendErrorMessage(mEl, `❌ Mode Orchestration non activé : l'orchestrateur (${orchModel}) ne répond pas (${orchRes.error}).`);
        reenableForm();
        return;
      }

      // Succès des deux → activer le mode
      setStatus("✅ Les deux modèles répondent. Activation...");
      await activateOrchestrationWith(orchModel, coderModel, savedModel, orchBtn, mEl, state, sEl, {
        granularity: chosenGranularity,
        reviewerEnabled: reviewerOn,
        reviewerModel: reviewerModelVal,
      });
      document.removeEventListener("keydown", onKey);
      close();
    });
  }

  /**
   * Bascule l'affichage des sélecteurs de modèle dans la barre d'outils :
   *  - mode Orchestration activé : cache le sélecteur standard, affiche les 2
   *    sélecteurs (inactifs) orchestrateur + codeur positionnés sur les modèles choisis.
   *  - mode Orchestration désactivé : inverse (réaffiche le sélecteur standard).
   * Les sélecteurs orch sont `disabled` : affichage seul, pas de modification live
   * (les modèles sont pilotés automatiquement par switchToOrchestrator/Coder).
   */
  function setModelSelectorsOrchestrationMode(orchActive, st) {
    const stdSel = document.getElementById("agent-model-select");
    const orchSelEl = document.getElementById("agent-orch-model-select");
    const coderSelEl = document.getElementById("agent-coder-model-select");
    if (orchActive) {
      if (stdSel) stdSel.classList.add("hidden");
      if (orchSelEl) {
        if (st && st.orchestratorModel) orchSelEl.value = st.orchestratorModel;
        orchSelEl.classList.remove("hidden");
      }
      if (coderSelEl) {
        if (st && st.coderModel) coderSelEl.value = st.coderModel;
        coderSelEl.classList.remove("hidden");
      }
    } else {
      if (orchSelEl) orchSelEl.classList.add("hidden");
      if (coderSelEl) coderSelEl.classList.add("hidden");
      if (stdSel) stdSel.classList.remove("hidden");
    }
  }

  // Met à jour le titre du panneau d'orchestration : « 📋 Plan d'orchestration : <début de la demande> ».
  // L'extrait est tronqué proprement (~70 car.) pour ne pas chevaucher les boutons à droite.
  function updateOrchestrationTitle(st) {
    const titleEl = document.querySelector("#orchestration-panel .orchestration-title");
    if (!titleEl) return;
    const req = (st.orchestrationLastUserPrompt || "").trim().replace(/\s+/g, " ");
    let label = "Plan d'orchestration";
    if (req) {
      const max = 70;
      let excerpt = req.length > max ? req.slice(0, max).replace(/\s+\S*$/, "") + "…" : req;
      label += " : " + excerpt;
    }
    titleEl.innerHTML = `<i data-lucide="clipboard-list" class="icon-sm"></i> ${escapeHtml(label)}`;
    refreshIcons(titleEl);
    titleEl.title = req ? `Demande : ${req}` : "Plan d'orchestration";
  }

  function renderOrchestrationPlan(messagesEl, st) {
    const panel = document.getElementById("orchestration-panel");
    updateOrchestrationTitle(st);
    if (!panel || !st.orchestrationPlan) return;
    panel.classList.remove("hidden");

    const tasks = st.orchestrationPlan.plan;
    const progress = st.orchestrationPlan.progress || { current_task: 0, completed: [], failed: [], escalated: [], retrying: [], task_attempts: {} };

    const completed = progress.completed || [];
    const failed = progress.failed || [];
    const escalated = progress.escalated || [];
    const retrying = progress.retrying || [];

    const tasksEl = document.getElementById("orch-tasks");
    tasksEl.innerHTML = tasks.map((task) => {
      const isCompleted = completed.includes(task.id);
      const isEscalated = escalated.includes(task.id);
      const isRetrying = retrying.includes(task.id);
      const isCurrent = progress.current_task === task.id;
      const status = isCompleted ? '✅' : isEscalated ? '❌🔧' : isRetrying ? '🔁' : isCurrent ? '🔄' : '☐';
      const title = escapeHtml(task.title || `Tâche ${task.id}`);
      const isDone = isCompleted || isEscalated;
      // V3 étape 6 : contrôles utilisateur par tâche (sauter / éditer la description)
      const canSkip = !isDone && !isCurrent;
      const canEdit = !isDone;
      const controls = (canSkip || canEdit) ? `
        <span class="orch-task-controls">
          ${canSkip ? `<button class="agent-btn orch-task-btn" data-task-action="skip" data-task-id="${task.id}" title="Sauter cette tâche">⏭️</button>` : ''}
          ${canEdit ? `<button class="agent-btn orch-task-btn" data-task-action="edit" data-task-id="${task.id}" title="Éditer la description">✏️</button>` : ''}
        </span>` : '';
      return `<div class="orch-task ${isCompleted ? 'orch-task-done' : isRetrying ? 'orch-task-retrying' : isCurrent ? 'orch-task-active' : ''}" data-task-id="${task.id}">
        <span class="orch-task-status">${status}</span>
        <span class="orch-task-title">${title}</span>
        ${controls}
      </div>`;
    }).join('');

    // Barre de progression
    const total = tasks.length;
    const done = completed.length + escalated.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = document.getElementById("orch-progress-bar");
    const text = document.getElementById("orch-progress-text");
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = `${done}/${total} tâches (${pct}%)`;

    // V3 étape 8 : métriques temps réel
    const metricsEl = document.getElementById("orch-metrics");
    if (metricsEl) {
      const failedCount = failed.length;
      const skippedCount = escalated.length;
      const completedCount = completed.length;
      const currentTask = tasks.find((t) => t.id === progress.current_task);
      let currentLine = "";
      if (currentTask && !completed.includes(currentTask.id) && !escalated.includes(currentTask.id)) {
        const attempts = (progress.task_attempts && progress.task_attempts[currentTask.id]) || 0;
        const cycles = st.orchestrationCurrentTaskCycles || 0;
        const parts = [];
        if (attempts > 0) parts.push(`tentative ${attempts}/3`);
        if (cycles > 0) parts.push(`auto-contrôle ${cycles}/3`);
        const detail = parts.length ? ` (${parts.join(" · ")})` : "";
        currentLine = `<div class="orch-metric orch-metric-current">🔄 En cours : #${currentTask.id} ${escapeHtml(currentTask.title || "")}${detail}</div>`;
      }
      const failureRate = total > 0 ? Math.round((failedCount / total) * 100) : 0;
      metricsEl.innerHTML = `
        <div class="orch-metrics-row">
          <span class="orch-metric orch-metric-ok">✅ ${completedCount} réussie(s)</span>
          <span class="orch-metric orch-metric-fail">❌ ${failedCount} échouée(s)</span>
          <span class="orch-metric orch-metric-skip">⏭️ ${skippedCount} sautée(s)</span>
          ${failedCount > 0 ? `<span class="orch-metric orch-metric-rate">taux d'échec ${failureRate}%</span>` : ''}
        </div>
        ${currentLine}`;
    }

    // Garder la tâche active visible dans la liste scrollable (fixed header/metrics)
    const activeTaskEl = tasksEl.querySelector(".orch-task-active");
    if (activeTaskEl) {
      const cRect = tasksEl.getBoundingClientRect();
      const tRect = activeTaskEl.getBoundingClientRect();
      if (tRect.top < cRect.top || tRect.bottom > cRect.bottom) {
        tasksEl.scrollTop += (tRect.top - cRect.top) - 4;
      }
    }

    renderOrchestrationAttempts(st);
    updateOrchestrationButtons(st);
  }

  /**
   * Rend le journal des tentatives de la tâche en cours (observabilité).
   * Voir spec_orchestration_observability.md. Bloc repliable ; clic sur une
   * entrée déplie l'excerpt + erreurs de linting.
   */
  /** Rendu lisible d'un testResult (observabilité E2) pour le journal des tentatives. */
  function testResultLabel(tr) {
    if (!tr) return "";
    const runner = tr.runner || "?";
    if (tr.timedOut) return `tests timeout (${runner})`;
    const nf = Array.isArray(tr.newFailures) ? tr.newFailures.length : 0;
    const inh = Array.isArray(tr.inheritedFailures) ? tr.inheritedFailures.length : 0;
    const head = `${runner} · exit ${tr.exit === null || tr.exit === undefined ? "?" : tr.exit} · ${nf} nouveau(s) échec(s)`;
    const tail = inh > 0 ? ` · ${inh} hérité(s)` : "";
    const out = tr.output_excerpt ? ` : ${String(tr.output_excerpt).split("\n")[0].slice(0, 200)}` : "";
    return head + tail + out;
  }

  function renderOrchestrationAttempts(st) {
    const panel = document.getElementById("orch-attempts");
    const header = document.getElementById("orch-attempts-header");
    const body = document.getElementById("orch-attempts-body");
    if (!panel || !header || !body) return;
    const progress = st.orchestrationPlan && st.orchestrationPlan.progress;
    const taskId = progress && progress.current_task;
    const logs = (progress && progress.task_logs && Array.isArray(progress.task_logs[taskId]))
      ? progress.task_logs[taskId]
      : [];
    if (!taskId || logs.length === 0) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    header.innerHTML = `<i data-lucide="clipboard-list" class="icon-sm"></i> Journal des tentatives (tâche #${taskId}) ${body.classList.contains("hidden") ? "▶" : "▼"}`;
    refreshIcons(header);
    body.innerHTML = logs.map((l) => {
      const loopBadge = l.loop ? `<span class="orch-attempt-badge orch-attempt-loop">🔄 bouclage</span>` : "";
      const snapBadge = (l.snapshot && l.snapshot.filesCount > 0) ? `<span class="orch-attempt-badge orch-attempt-snap" title="Snapshot ${escapeHtml(l.snapshot.sha || "")} — ${l.snapshot.filesCount} fichier(s) restaurable(s)">↩️ snapshot (${l.snapshot.filesCount})</span>` : "";
      const dur = (typeof l.durationMs === "number" && l.durationMs > 0) ? ` · ${Math.round(l.durationMs / 1000)}s` : "";
      const markerLabel = escapeHtml(l.marker || "?");
      const actionLabel = escapeHtml(l.action || "?");
      const reason = escapeHtml(l.reason || "");
      const excerpt = escapeHtml(l.responseExcerpt || "");
      const lint = l.lintErrors ? `<div class="orch-attempt-lint">🧹 ${escapeHtml(l.lintErrors)}</div>` : "";
      const tr = l.testResult ? `<div class="orch-attempt-lint">🧪 ${escapeHtml(testResultLabel(l.testResult))}</div>` : "";
      const rv = l.reviewResult ? `<div class="orch-attempt-lint">${l.reviewResult.approved ? "🔍 ✅" : "🔍 ⚠️"} ${escapeHtml(l.reviewResult.approved ? (l.reviewResult.summary || "approuvé") : (l.reviewResult.changes || "modifications demandées"))}</div>` : "";
      const files = (Array.isArray(l.filesChanged) && l.filesChanged.length > 0)
        ? `<div class="orch-attempt-files">📝 ${l.filesChanged.map(escapeHtml).join(", ")}</div>` : "";
      return `<div class="orch-attempt" data-attempt-n="${l.n}">
        <div class="orch-attempt-head">
          <span class="orch-attempt-n">#${l.n}</span>
          <span class="orch-attempt-marker">${markerLabel}</span>
          <span class="orch-attempt-action">${actionLabel}</span>${dur}
          ${loopBadge}
          ${snapBadge}
        </div>
        <div class="orch-attempt-reason">${reason}</div>
        <div class="orch-attempt-detail hidden">${excerpt ? `<div class="orch-attempt-excerpt">${excerpt}</div>` : ""}${lint}${tr}${rv}${files}</div>
      </div>`;
    }).join("");
    body.querySelectorAll(".orch-attempt").forEach((el) => {
      el.addEventListener("click", () => {
        const detail = el.querySelector(".orch-attempt-detail");
        if (detail) detail.classList.toggle("hidden");
      });
    });
  }

  /** Détermine la dernière tâche annulable (snapshot complet + non déjà annulée). */
  function lastUndoableTask(st) {
    if (!st.orchestrationPlan || !st.orchestrationPlan.progress) return null;
    if (!st.orchestrationSnapshotsEnabled) return null;
    if (st.orchestrationSnapshotsAvailable === false) return null;
    const completed = st.orchestrationPlan.progress.completed || [];
    const cancelled = new Set(st.orchestrationCancelledTasks || []);
    for (let i = completed.length - 1; i >= 0; i--) {
      const tid = completed[i];
      if (cancelled.has(tid)) continue;
      const snap = st.orchestrationSnapshots[tid];
      if (snap && Array.isArray(snap.files) && snap.files.length > 0 && snap.sha) {
        return { taskId: tid, snapshot: snap };
      }
    }
    return null;
  }

  /** Met à jour les boutons du panneau d'orchestration */
  function updateOrchestrationButtons(st) {
    const pauseBtn = orchestrationPanel.querySelector('[data-action="orch-pause"]');
    const resumeBtn = orchestrationPanel.querySelector('[data-action="orch-resume"]');
    if (pauseBtn) pauseBtn.disabled = !st.orchestrationRunning || st.orchestrationPaused;
    if (resumeBtn) resumeBtn.disabled = !st.orchestrationPaused || !st.orchestrationPlan;
    // A1 : bouton ↩️ actif si une tâche annulable existe et aucun codeur en cours.
    const undoBtn = orchestrationPanel.querySelector('[data-action="orch-undo"]');
    if (undoBtn) undoBtn.disabled = !lastUndoableTask(st) || !!st.isStreaming;
  }

  /**
   * V3 étape 6 — Saute une tâche (la marque comme escaladée/sautée).
   * N'est autorisée que sur les tâches non terminées et non courantes, pour éviter
   * toute race avec le codeur en cours d'exécution.
   */
  async function skipTask(messagesEl, st, statusEl, taskId) {
    if (!st.orchestrationPlan) return;
    const progress = st.orchestrationPlan.progress;
    if (!progress) return;
    if ((progress.completed || []).includes(taskId) || (progress.escalated || []).includes(taskId)) return;
    if (progress.current_task === taskId) {
      appendSystemMessage(messagesEl, `⚠️ Impossible de sauter la tâche ${taskId} en cours d'exécution. Mettez d'abord en pause.`);
      return;
    }
    if (!progress.escalated) progress.escalated = [];
    progress.escalated.push(taskId);
    if (progress.retrying) progress.retrying = progress.retrying.filter((id) => id !== taskId);
    st.orchestrationPlan.progress = progress;
    appendSystemMessage(messagesEl, `⏭️ Tâche ${taskId} sautée par l'utilisateur.`);
    try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
    renderOrchestrationPlan(messagesEl, st);
  }

  /**
   * V3 étape 6 — Édite la description d'une tâche via prompt().
   * La modification prend effet à la prochaine exécution/retry de la tâche.
   */
  async function editTaskDescription(messagesEl, st, taskId) {
    if (!st.orchestrationPlan) return;
    const task = st.orchestrationPlan.plan.find((t) => t.id === taskId);
    if (!task) return;
    const newDesc = prompt(`Éditer la description de la tâche ${taskId} :\n${task.title}`, task.description || "");
    if (newDesc === null) return; // annulé
    task.description = newDesc;
    appendSystemMessage(messagesEl, `✏️ Description de la tâche ${taskId} modifiée par l'utilisateur.`);
    try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
    renderOrchestrationPlan(messagesEl, st);
  }

  /** Charge quelques fichiers clés du projet pour enrichir le prompt de planification.
   *  Limite chaque fichier à ~200 lignes pour ne pas saturer le contexte de l'orchestrateur.
   */
  async function loadKeyFileContents(projectPath) {
    if (!projectPath) return {};
    const candidates = [
      'README.md', 'readme.md', 'Readme.md',
      'package.json',
      'Cargo.toml',
      'pyproject.toml', 'requirements.txt',
      'tsconfig.json', 'jsconfig.json',
      '.pilot/context.md',
    ];
    const out = {};
    for (const rel of candidates) {
      try {
        const abs = rel.startsWith('.pilot/')
          ? projectPath.replace(/[\\/]+$/, '') + '/' + rel
          : projectPath.replace(/[\\/]+$/, '') + '/' + rel;
        const exists = await invoke('file_exists', { path: abs });
        if (exists) {
          const text = await invoke('read_file_content', { path: abs });
          if (text != null) out[rel] = text;
        }
      } catch (_) {
        // ignore fichiers absents ou illisibles
      }
    }
    return out;
  }

  /** Retourne un avertissement si le codeur n'a pas lu tous les fichiers listés dans la tâche.
   *  Utilisé pour enrichir le feedback en cas d'échec (point 5.3 + 5.4).
   */
  function buildReadFilesWarning(task, readFilesSet) {
    if (!task.files || task.files.length === 0) return "";
    const readFiles = readFilesSet ? [...readFilesSet] : [];
    const isRead = (rel) => readFiles.some((r) => r === rel || r.endsWith("/" + rel) || rel.endsWith("/" + r));
    const missing = task.files.filter((f) => !isRead(f));
    if (missing.length === 0) return "";
    return `\n\n⚠️ ATTENTION : tu n'as pas lu les fichiers suivants avant de répondre :\n${missing.map((f) => `  - ${f}`).join("\n")}\nRelis-les avec read_file AVANT toute modification.`;
  }

  /** Détermine si un provider est considéré comme local (pas d'appel API distant). */
  function isLocalProvider(provider) {
    if (!provider) return false;
    const p = provider.toLowerCase();
    return ["ollama", "lmstudio", "localai", "llama.cpp", "llama-cpp", "kobold", "textgen", "tabbyapi", "vllm"].includes(p);
  }

  /** Valeur effective du batch selon le setting et le modèle codeur. */
  function getEffectiveBatchSize(batchSetting, coderModel) {
    // V3 étape 7 : le batch auto (-1) est désactivé par défaut. Chaque tâche
    // obtient un contexte frais (new_session) pour éviter la contamination entre
    // tâches — essentiel pour la fiabilité du triptyque Réfléchir/Faire/Contrôler.
    // L'utilisateur peut encore forcer un batch en configurant une valeur
    // positive explicite dans les paramètres.
    if (batchSetting > 0) return batchSetting;
    return 0;
  }

  /** Valeur effective de la fenêtre de contexte du codeur. */
  function getEffectiveCoderContextWindow(windowSetting, coderModel) {
    if (windowSetting > 0) return windowSetting;
    if (!coderModel) return 0;
    const provider = coderModel.split("/")[0];
    return isLocalProvider(provider) ? 32768 : 0;
  }

  /** Récupère l'arborescence projet filtrée, mise en cache pour la durée du plan (point H). */
  async function getCachedProjectTree(st) {
    if (st.orchestrationCachedTree) return st.orchestrationCachedTree;
    try {
      const tree = await invoke("refresh_tree");
      if (tree) {
        st.orchestrationCachedTree = buildTreeString(tree);
        return st.orchestrationCachedTree;
      }
    } catch (_) { /* arborescence non disponible */ }
    return '';
  }

  /** (Re)démarre le timer d'inactivité du codeur (point B). Reset à chaque delta/outil reçu. */
  function resetOrchestrationIdleTimer(st, mEl, sEl) {
    if (!st.orchestrationRunning || st.orchestrationPaused || st.orchestrationRevising || st.orchestrationSubdividing) return;
    if (st.orchestrationTimeout) clearTimeout(st.orchestrationTimeout);
    const ms = st.orchestrationIdleTimeoutMs || 120000;
    st.orchestrationTimeout = setTimeout(() => {
      handleOrchestrationTimeout(st, mEl, sEl);
    }, ms);
  }

  /** Lance une révision mid-plan par l'orchestrateur (point E). */
  async function startPlanRevision(st, messagesEl, statusEl) {
    st.orchestrationRevising = true;
    // Pas de timer d'inactivité pendant la révision (l'orchestrateur cloud est fiable)
    if (st.orchestrationTimeout) { clearTimeout(st.orchestrationTimeout); st.orchestrationTimeout = null; }
    await clearContextForOrchestration();
    const switched = await switchToOrchestrator(st);
    if (!switched) {
      appendErrorMessage(messagesEl, "❌ Impossible de basculer vers l'orchestrateur pour la révision. On continue avec le plan actuel.");
      st.orchestrationRevising = false;
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }
    const projectTree = await getCachedProjectTree(st);
    const revisionPrompt = buildRevisionPrompt(st.orchestrationPlan, projectTree, st.orchestrationToolCallsInTask || []);
    try {
      await invoke("send_agent_prompt", { message: revisionPrompt });
    } catch (e) {
      console.error("Erreur envoi révision:", e);
      appendErrorMessage(messagesEl, `❌ Erreur envoi révision : ${e}`);
      st.orchestrationRevising = false;
      await executeNextTask(messagesEl, st, statusEl);
    }
  }

  /** Lance une subdivision de tâche échouée par l'orchestrateur (point M).
   *  Au lieu d'escalader directement après 2 échecs, on demande à l'orchestrateur
   *  de re-découper la tâche en 2-4 sous-tâches plus petites. Si la subdivision
   *  échoue (pas de plan valide), on retombe sur l'escalade classique.
   */
  async function startPlanSubdivision(st, messagesEl, statusEl, failedTask) {
    // Pas de timer d'inactivité pendant la subdivision (l'orchestrateur cloud est fiable)
    if (st.orchestrationTimeout) { clearTimeout(st.orchestrationTimeout); st.orchestrationTimeout = null; }
    await clearContextForOrchestration();
    const switched = await switchToOrchestrator(st);
    if (!switched) {
      appendErrorMessage(messagesEl, "❌ Impossible de basculer vers l'orchestrateur pour la subdivision. Escalade directe...");
      st.orchestrationSubdividing = false;
      st.orchestrationSubdividingTaskId = null;
      st.orchestrationEscalating = true;
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }
    const progress = st.orchestrationPlan.progress;
    const attempts = (progress.task_attempts && progress.task_attempts[failedTask.id]) || 2;
    // Calculer le nextIdBase pour éviter les collisions (max ID du plan + 1)
    const planArr = st.orchestrationPlan.plan;
    const maxId = planArr.reduce((m, t) => Math.max(m, typeof t.id === "number" ? t.id : 0), 0);
    const errors = progress.last_error || "(pas de feedback explicite)";
    const metrics = (progress.task_metrics && progress.task_metrics[failedTask.id]) || null;
    const subdividePrompt = buildSubdividePrompt(failedTask, attempts, errors, metrics, maxId + 1);
    try {
      await invoke("send_agent_prompt", { message: subdividePrompt });
    } catch (e) {
      console.error("Erreur envoi subdivision:", e);
      appendErrorMessage(messagesEl, `❌ Erreur envoi subdivision : ${e}. Escalade directe...`);
      st.orchestrationSubdividing = false;
      st.orchestrationSubdividingTaskId = null;
      st.orchestrationEscalating = true;
      await executeNextTask(messagesEl, st, statusEl);
    }
  }

  /**
   * V3 étape 5 — Logique unifiée d'application d'une subdivision.
   * Utilisée par les 2 chemins de subdivision :
   *   - Point M (3 tentatives échouées) : startPlanSubdivision -> handler orchestrationSubdividing
   *   - Escalade [ACTION: REDECOUPER] : handler orchestrationEscalating
   * Si les sous-tâches sont valides (>= 2), remplace la tâche par les sous-tâches
   * et renvoie true. Sinon, affiche un avertissement et renvoie false (l'appelant
   * gère le fallback : escalade directe ou markEscalatedAndContinue).
   *
   * @returns {Promise<boolean>} true si la subdivision a été appliquée, false sinon
   */
  async function applySubdivision(st, messagesEl, failedTaskId, subtasks, sourceLabel) {
    if (subtasks && Array.isArray(subtasks) && subtasks.length >= 2) {
      const globalDirective = st.orchestrationPlan.global_directive;
      st.orchestrationPlan = replaceTaskWithSubtasks(st.orchestrationPlan, failedTaskId, subtasks);
      st.orchestrationPlan.global_directive = globalDirective;
      appendSystemMessage(messagesEl, `✂️ ${sourceLabel || "Subdivision"} : tâche ${failedTaskId} subdivisée en ${subtasks.length} sous-tâches. Reprise de l'exécution...`);
      try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
      renderOrchestrationPlan(messagesEl, st);
      return true;
    }
    appendSystemMessage(messagesEl, `⚠️ ${sourceLabel || "Subdivision"} échouée (pas de sous-tâches valides) pour la tâche ${failedTaskId}.`);
    return false;
  }

  /** Exécute la prochaine tâche du plan (respecte depends_on, validation post-tâche, timeout d'inactivité). */
  async function executeNextTask(messagesEl, st, statusEl) {
    if (!st.orchestrationPlan) {
      console.log("[executeNextTask] arrêt : pas de plan");
      return;
    }
    if (st.orchestrationPaused) {
      console.log("[executeNextTask] arrêt : plan en pause");
      return;
    }
    // Empêcher les double exécutions si un modèle est déjà en train de répondre
    if (st.isStreaming) {
      console.log("[executeNextTask] attente : isStreaming=true");
      return;
    }

    // Annuler tout timeout existant
    if (st.orchestrationTimeout) {
      clearTimeout(st.orchestrationTimeout);
      st.orchestrationTimeout = null;
    }
    // Réinitialiser le flag d'erreur de connexion (nouvelle tâche)
    st.orchestrationConnErrorSeen = false;

    const tasks = st.orchestrationPlan.plan;
    const progress = st.orchestrationPlan.progress || { current_task: 0, completed: [], failed: [], escalated: [], retrying: [], task_attempts: {} };

    // Sélection de la prochaine tâche en respectant les dépendances (point D)
    const doneIds = new Set([...(progress.completed || []), ...(progress.escalated || [])]);
    const nextTask = pickNextTask(tasks, doneIds);

    if (!nextTask) {
      // Plus aucune tâche exécutable : vérification finale par l'orchestrateur
      const remaining = tasks.filter((t) => !doneIds.has(t.id));
      const isBlocked = remaining.length > 0 && isPlanBlocked(tasks, doneIds);
      const reviewCount = st.orchestrationFinalReviewCount || 0;

      console.log(`[executeNextTask] plus de tâche exécutable : remaining=${remaining.length}, isBlocked=${isBlocked}, reviewCount=${reviewCount}, finalReview=${st.orchestrationFinalReview}`);

      // Déjà en vérification finale mais aucune tâche exécutable n'a été trouvée :
      // soit le plan est terminé, soit il est bloqué. Forcer la pause plutôt
      // que de rester silencieusement inactif.
      if (st.orchestrationFinalReview && remaining.length > 0) {
        appendSystemMessage(messagesEl, `⛔ Vérification finale bloquée : ${remaining.length} tâche(s) non exécutable(s) (dépendances manquantes ou plan terminé).`);
        st.orchestrationPaused = true;
        st.orchestrationRunning = false;
        st.orchestrationFinalReview = false;
        st.orchestrationFinalReviewCount = 0;
        st.orchestrationFinalReviewCycles = 0;
        renderOrchestrationPlan(messagesEl, st);
        updateOrchestrationButtons(st);
        return;
      }

      if (isBlocked && reviewCount >= 3) {
        appendSystemMessage(messagesEl, `⛔ Plan bloqué : ${remaining.length} tâche(s) restante(s) ont des dépendances non satisfaites après ${reviewCount} cycle(s) de vérification finale. Arrêt.`);
        st.orchestrationPaused = true;
        st.orchestrationRunning = false;
        st.orchestrationFinalReview = false;
        st.orchestrationFinalReviewCount = 0;
        st.orchestrationFinalReviewCycles = 0;
        renderOrchestrationPlan(messagesEl, st);
        updateOrchestrationButtons(st);
        return;
      }

      if (remaining.length === 0 || reviewCount >= 3) {
        appendSystemMessage(messagesEl, `✅ Plan terminé (${remaining.length} tâche(s) restante(s)). Arrêt.`);
        appendSystemMessage(messagesEl, summarizePlan(progress, tasks.length));
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        st._previousPlan = st.orchestrationPlan;
        st.orchestrationPlan = null;
        st.orchestrationRunning = false;
        st.orchestrationPaused = false;
        st.orchestrationCachedTree = null;
        st.orchestrationTasksInBatch = 0;
        st.orchestrationFinalReview = false;
        st.orchestrationFinalReviewCount = 0;
        st.orchestrationFinalReviewCycles = 0;
        renderOrchestrationPlan(messagesEl, st);
        return;
      }

      // V3 étape 4 : vérification finale par le codeur (relit les fichiers modifiés)
      // si un codeur local est configuré ; sinon fallback sur l'orchestrateur.
      st.orchestrationFinalReview = true;
      st.orchestrationFinalReviewCount = reviewCount + 1;
      st.orchestrationFinalReviewCycles = 0; // V3 étape 4 : reset des cycles FINAL_FIX
      st.orchestrationRunning = true;
      try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
      const projectTree = await getCachedProjectTree(st);
      const useCoder = !!st.coderModel;
      const switchFn = useCoder ? switchToCoder : switchToOrchestrator;
      const roleLabel = useCoder ? "le codeur relit les fichiers modifiés" : "demande à l'orchestrateur";
      appendSystemMessage(messagesEl, `🧠 Vérification finale #${st.orchestrationFinalReviewCount} — ${roleLabel}...`);
      await clearContextForOrchestration();
      const switched = await switchFn(st);
      if (!switched) {
        appendErrorMessage(messagesEl, `❌ Impossible de basculer vers ${useCoder ? "le codeur" : "l'orchestrateur"} pour la vérification finale. Arrêt.`);
        st.orchestrationPaused = true;
        st.orchestrationRunning = false;
        st.orchestrationFinalReview = false;
        renderOrchestrationPlan(messagesEl, st);
        updateOrchestrationButtons(st);
        return;
      }
      const reviewPrompt = useCoder
        ? buildCoderFinalReviewPrompt(st.orchestrationPlan, projectTree)
        : buildFinalReviewPrompt(st.orchestrationPlan, projectTree);
      try {
        await invoke("send_agent_prompt", { message: reviewPrompt });
      } catch (e) {
        console.error("Erreur envoi vérification finale:", e);
        appendErrorMessage(messagesEl, `❌ Erreur envoi vérification finale : ${e}`);
        st.orchestrationFinalReview = false;
        st.orchestrationRunning = false;
        st.orchestrationPaused = true;
        renderOrchestrationPlan(messagesEl, st);
        updateOrchestrationButtons(st);
      }
      return;
    }

    progress.current_task = nextTask.id;
    if (!progress.task_attempts) progress.task_attempts = {};
    if (!progress.task_attempts[nextTask.id]) progress.task_attempts[nextTask.id] = 0;
    st.orchestrationPlan.progress = progress;
    // Réinitialiser le tracker de fichiers lus pour la nouvelle tâche (point 5.3)
    st.orchestrationReadFilesInTask.clear();
    // Réinitialiser le tracker d'outils pour la nouvelle tâche (point 5.10)
    st.orchestrationToolCallsInTask = [];
    // V3 : réinitialiser le compteur de cycles SELF_FIX pour la nouvelle tâche
    st.orchestrationCurrentTaskCycles = 0;
    renderOrchestrationPlan(messagesEl, st);

    const attemptNumber = progress.task_attempts[nextTask.id] + 1;

    // ── Mode batch : garder la session ouverte pour N tâches consécutives ──
    const batchSize = getEffectiveBatchSize(st.orchestrationBatchSize, st.coderModel);
    // Ne sauter le reset que pour les tâches 2..N du batch (la 1ère doit toujours reset)
    const isBatchContinuation = batchSize > 0
      && st.orchestrationTasksInBatch > 0
      && st.orchestrationTasksInBatch < batchSize
      && !st.orchestrationEscalating
      && st.currentModel === st.coderModel
      && st.orchestrationActiveRole === "coder";

    if (!isBatchContinuation) {
      // Batch désactivé, début de batch, ou escalade : reset normal
      await clearContextForOrchestration();
      st.orchestrationTasksInBatch = 0;
    }

    // Capturer l'état des fichiers avant exécution (pour validation post-tâche, point A)
    st.orchestrationCurrentFileState = await captureFileState(nextTask, invoke, window._pilotProjectPath);

    // ── A1 : snapshot Git avant tâche (spéc_orchestration_snapshots.md §3.1) ──
    // Non-bloquant : si pas un repo Git / git absent / échec → A1 désactivé pour le plan.
    if (st.orchestrationSnapshotsEnabled) {
      try {
        const snap = await invoke("git_create_snapshot");
        if (snap.ok) {
          st.orchestrationSnapshotsAvailable = true;
          st.orchestrationSnapshots[nextTask.id] = { sha: snap.sha, files: [], ts: Date.now() };
        } else if (!st.orchestrationSnapshotsWarned) {
          st.orchestrationSnapshotsAvailable = false;
          st.orchestrationSnapshotsWarned = true;
          const why = snap.reason === "not_a_repo" ? "le projet n'est pas un repo Git"
            : snap.reason === "git_missing" ? "git n'est pas installé"
            : snap.reason === "no_head" ? "le repo n'a aucun commit"
            : "indisponible";
          appendSystemMessage(messagesEl, `↩️ Snapshots indisponibles (${why}). Annulation de tâche désactivée.`);
        }
      } catch (e) {
        if (!st.orchestrationSnapshotsWarned) {
          st.orchestrationSnapshotsAvailable = false;
          st.orchestrationSnapshotsWarned = true;
          appendSystemMessage(messagesEl, `↩️ Snapshots indisponibles (${e}). Annulation de tâche désactivée.`);
        }
      }
    }

    // ── Mémoire de projet (H3) : injecter PROJECT_MEMORY.md en tête du prompt de tâche ──
    const memBlock = (st.projectMemoryEnabled !== false) ? (await buildMemoryBlock(window._pilotProjectPath)) : "";

    if (st.orchestrationEscalating) {
      // Escalade : l'orchestrateur va faire la tâche
      const switched = await switchToOrchestrator(st);
      if (!switched) {
        appendErrorMessage(messagesEl, "❌ Impossible de basculer vers l'orchestrateur pour l'escalade. Plan interrompu.");
        st.orchestrationPaused = true;
        return;
      }
      const previousSummaries = progress.task_summaries || {};
      const taskMetrics = (progress.task_metrics && progress.task_metrics[nextTask.id]) || null;
      const escalationPrompt = buildEscalationPrompt(nextTask, progress.task_attempts[nextTask.id], progress.last_error || '', previousSummaries, taskMetrics, st.orchestrationToolCallsInTask || [], st.orchestrationPlan?.global_directive);
      appendSystemMessage(messagesEl, `🧠 Escalade tâche ${nextTask.id}/${tasks.length} : ${nextTask.title} (orchestrateur)`);
      try {
        await invoke("send_agent_prompt", { message: memBlock + escalationPrompt });
      } catch (e) {
        console.error("Erreur envoi escalade:", e);
        appendErrorMessage(messagesEl, `❌ Erreur envoi escalade : ${e}`);
        return;
      }
      // Timer d'inactivité (s'applique aussi à l'orchestrateur en escalade)
      resetOrchestrationIdleTimer(st, messagesEl, statusEl);
    } else {
      // Mode normal : codeur
      if (!isBatchContinuation) {
        // Hors batch ou début de batch : basculer vers le codeur
        const switched = await switchToCoder(st);
        if (!switched) {
          appendErrorMessage(messagesEl, "❌ Impossible de basculer vers le codeur. Plan interrompu.");
          st.orchestrationPaused = true;
          return;
        }
      }
      // Continuation de batch : on garde la session existante (le codeur est déjà actif)
      const previousSummaries = progress.task_summaries || {};
      const projectTree = await getCachedProjectTree(st);
      // Ajuster la granularité effective selon les échecs récents (point 5.6)
      st.orchestrationEffectiveGranularity = getAdaptiveGranularity(st.orchestrationGranularity, progress);
      // Titres des tâches suivantes prévues (vue d'ensemble pour le codeur)
      const remainingAfter = tasks.filter((t) => !doneIds.has(t.id) && t.id !== nextTask.id);
      const upcomingTitles = remainingAfter.slice(0, 5).map((t) => t.title);
      const taskPrompt = attemptNumber > 1
        ? buildRetryTaskPrompt(nextTask, attemptNumber, progress.last_error || "", previousSummaries, projectTree, upcomingTitles, st.orchestrationEffectiveGranularity, st.orchestrationPlan?.global_directive)
        : buildTaskPrompt(nextTask, attemptNumber, previousSummaries, projectTree, upcomingTitles, st.orchestrationEffectiveGranularity, st.orchestrationPlan?.global_directive);
      const maxCtx = getEffectiveCoderContextWindow(st.coderContextWindow, st.coderModel);
      const finalTaskPrompt = maxCtx > 0 ? compactTaskPrompt(taskPrompt, maxCtx) : taskPrompt;
      if (finalTaskPrompt !== taskPrompt) {
        appendSystemMessage(messagesEl, `🧹 Prompt de tâche compacté (${estimateTokens(finalTaskPrompt)} tokens estimés / ${maxCtx} max).`);
      }
      const label = attemptNumber > 1 ? `🔨 Tâche ${nextTask.id}/${tasks.length} (tentative ${attemptNumber}) : ${nextTask.title}` : `🔨 Tâche ${nextTask.id}/${tasks.length} : ${nextTask.title}`;
      appendSystemMessage(messagesEl, label);
      try {
        await invoke("send_agent_prompt", { message: memBlock + finalTaskPrompt });
      } catch (e) {
        console.error("Erreur envoi tâche:", e);
        appendErrorMessage(messagesEl, `❌ Erreur envoi tâche : ${e}`);
        return;
      }
      // Démarrer le timer d'inactivité du codeur (point B)
      resetOrchestrationIdleTimer(st, messagesEl, statusEl);
    }
  }

  /** Gère le timeout d'inactivité (pas de delta/outil reçu pendant le délai configuré). */
  async function handleOrchestrationTimeout(st, messagesEl, statusEl) {
    if (!st.orchestrationRunning || st.orchestrationPaused) return;
    st.orchestrationTimeout = null;

    // H3 : timeout pendant un tour d'extraction mémoire → abandonner l'extraction
    // et reprendre le flux normal (non-bloquant).
    if (st.orchestrationExtractingMemory) {
      appendSystemMessage(messagesEl, `⏰ Timeout pendant l'extraction mémoire projet — abandon, reprise du plan.`);
      try { await invoke("abort_agent"); } catch (_) {}
      st.orchestrationExtractingMemory = null;
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    if (st.orchestrationRevising) {
      appendSystemMessage(messagesEl, `⏰ Timeout pendant la révision. On continue avec le plan actuel.`);
      try { await invoke("abort_agent"); } catch (_) {}
      st.orchestrationRevising = false;
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    if (st.orchestrationSubdividing) {
      const failedTaskId = st.orchestrationSubdividingTaskId;
      appendSystemMessage(messagesEl, `⏰ Timeout pendant la subdivision de la tâche ${failedTaskId}. Escalade directe...`);
      try { await invoke("abort_agent"); } catch (_) {}
      st.orchestrationSubdividing = false;
      st.orchestrationSubdividingTaskId = null;
      if (st.orchestrationPlan.plan.find((t) => t.id === failedTaskId)) {
        st.orchestrationEscalating = true;
      }
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    const progress = st.orchestrationPlan.progress;
    const currentTaskId = progress.current_task;
    const currentTask = st.orchestrationPlan.plan.find((t) => t.id === currentTaskId);
    if (!currentTask) return;

    const secs = Math.round((st.orchestrationIdleTimeoutMs || 120000) / 1000);
    appendSystemMessage(messagesEl, `⏰ Timeout d'inactivité sur la tâche ${currentTaskId} (pas d'activité pendant ${secs}s).`);

    try { await invoke("abort_agent"); } catch (_) {}
    await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Timeout d'inactivité (pas d'activité pendant ${secs}s)`);
  }

  /**
   * Detecte si le codeur a emis un DONE indiquant qu'aucune modification n'etait
   * necessaire (cas NO_CHANGE formule naturellement, sans le marqueur explicite).
   * Voir spec_orchestration_observability.md - Bug NO_CHANGE.
   * @param {string} text - reponse brute du codeur
   * @returns {boolean}
   */
  function detectNoChangeDone(text) {
    if (!text || typeof text !== "string") return false;
    const lower = text.toLowerCase();
    return lower.includes("no_change")
      || lower.includes("aucun changement")
      || lower.includes("aucune modification")
      || lower.includes("aucune modification n")
      || lower.includes("deja conforme")
      || lower.includes("déjà conforme")
      || lower.includes("deja align")
      || lower.includes("déjà align")
      || lower.includes("rien a modifier")
      || lower.includes("rien à modifier")
      || lower.includes("rien a faire")
      || lower.includes("rien à faire")
      || lower.includes("rien a changer")
      || lower.includes("déjà implémenté")
      || lower.includes("deja implemente")
      || lower.includes("déjà présent")
      || lower.includes("deja present")
      || lower.includes("déjà en place")
      || lower.includes("deja en place")
      || lower.includes("déjà géré")
      || lower.includes("deja gere")
      || lower.includes("déjà fait")
      || lower.includes("deja fait")
      || lower.includes("no change required")
      || lower.includes("already aligned")
      || lower.includes("already implemented")
      || lower.includes("already in place");
  }

  /**
   * Déduit un marker lisible d'une raison d'échec (heuristique MVP).
   * @param {string} errorReason
   * @returns {string}
   */
  function deriveFailureMarker(errorReason) {
    if (!errorReason) return "failure";
    const r = errorReason.toLowerCase();
    if (/timeout/.test(r)) return "timeout";
    if (/need_help/.test(r)) return "NEED_HELP";
    if (/self_fix|3 cycles/.test(r)) return "self_fix_exhausted";
    if (/lint|syntaxe|eslint|py_compile|cargo check/.test(r)) return "syntax_error";
    if (/format invalide|non conforme/.test(r)) return "format_invalid";
    if (/validation/.test(r)) return "validation_fail";
    if (/application/.test(r)) return "apply_failed";
    return "failure";
  }

  /**
   * Ajoute une entrée au journal des tentatives d'une tâche (observabilité).
   * Voir spec_orchestration_observability.md. Détecte le bouclage en comparant
   * l'excerpt à celui de la tentative précédente.
   * @param {object} st - état agent
   * @param {number} taskId - ID de la tâche
   * @param {object} partial - champs de l'entrée (marker, reason, action, ...)
   */
  function logTaskAttempt(st, taskId, partial) {
    if (!st.orchestrationPlan || !taskId) return;
    const progress = st.orchestrationPlan.progress;
    if (!progress) return;
    if (!progress.task_logs) progress.task_logs = {};
    const logs = Array.isArray(progress.task_logs[taskId]) ? progress.task_logs[taskId] : [];
    const attemptNumber = (progress.task_attempts && typeof progress.task_attempts[taskId] === "number")
      ? progress.task_attempts[taskId]
      : logs.length + 1;
    // Détection de bouclage avec la dernière entrée
    const prev = logs.length > 0 ? logs[logs.length - 1] : null;
    let loop = false;
    if (prev && prev.responseExcerpt && partial.responseExcerpt) {
      loop = detectLoop(prev.responseExcerpt, partial.responseExcerpt);
    }
    const entry = createAttemptLog({ ...partial, loop }, attemptNumber);
    if (entry) {
      logs.push(entry);
      progress.task_logs[taskId] = logs;
    }
  }

  /** Gère un échec de tâche (NEED_HELP, timeout, validation échec, ou absence de DONE). */
  async function handleTaskFailure(st, messagesEl, statusEl, task, errorReason) {
    // Casser le batch : une erreur force un nouveau contexte vierge au prochain tour
    st.orchestrationTasksInBatch = getEffectiveBatchSize(st.orchestrationBatchSize, st.coderModel);
    const progress = st.orchestrationPlan.progress;
    const taskId = task.id;

    progress.task_attempts[taskId] = (progress.task_attempts[taskId] || 0) + 1;
    progress.last_error = errorReason;
    const attempts = progress.task_attempts[taskId];

    // Observabilité — journaliser la tentative avec marker déduit d'errorReason
    // et action déterminée (retry / subdivide / escalate). Voir spec_orchestration_observability.md.
    const alreadySubdivided = Array.isArray(progress.subdivided) && progress.subdivided.includes(taskId);
    const isSubtask = !!task.subtask;
    const failureAction = attempts < 3
      ? "retry"
      : (!isSubtask && !alreadySubdivided ? "subdivide" : "escalate");
    const failureMarker = deriveFailureMarker(errorReason);
    logTaskAttempt(st, taskId, {
      marker: failureMarker,
      reason: errorReason,
      action: failureAction,
      responseExcerpt: st.lastAssistantRawText || "",
      cycles: st.orchestrationCurrentTaskCycles || 0,
    });

    if (attempts < 3) {
      if (!progress.retrying) progress.retrying = [];
      if (!progress.retrying.includes(taskId)) progress.retrying.push(taskId);
      st.orchestrationPlan.progress = progress;
      appendSystemMessage(messagesEl, `🔁 Échec tâche ${taskId} (tentative ${attempts}/3). Nouvelle tentative par le codeur avec feedback sur l'échec précédent...`);
      try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
      renderOrchestrationPlan(messagesEl, st);
      await executeNextTask(messagesEl, st, statusEl);
    } else {
      if (!progress.retrying) progress.retrying = [];
      progress.retrying = progress.retrying.filter((id) => id !== taskId);
      if (!isSubtask && !alreadySubdivided) {
        // Subdivision (point M) : demander à l'orchestrateur de découper la tâche en sous-tâches
        st.orchestrationSubdividing = true;
        st.orchestrationSubdividingTaskId = taskId;
        st.orchestrationPlan.progress = progress;
        appendSystemMessage(messagesEl, `✂️ Échec tâche ${taskId} après ${attempts} tentatives. Demande de subdivision à l'orchestrateur...`);
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        renderOrchestrationPlan(messagesEl, st);
        await startPlanSubdivision(st, messagesEl, statusEl, task);
      } else {
        // Subdivision impossible (sous-tâche ou déjà subdivisée) → escalade directe
        st.orchestrationEscalating = true;
        st.orchestrationPlan.progress = progress;
        appendSystemMessage(messagesEl, `🧠 Échec tâche ${taskId} après ${attempts} tentatives. Escalade à l'orchestrateur...`);
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        renderOrchestrationPlan(messagesEl, st);
        await executeNextTask(messagesEl, st, statusEl);
      }
    }
  }

  /**
   * Gère une erreur de connexion détectée pendant l'exécution du plan (option 1).
   * Quand le codeur (ou l'orchestrateur en escalade/révision/subdivision) est
   * injoignable, on met le plan en pause avec un message contextuel au lieu de
   * laisser la validation post-tâche marquer la tâche « effectuée » à tort.
   * Pose `orchestrationConnectionError` pour que handleOrchestrationAgentEnd
   * ignore la fin d'agent qui suit.
   */
  function handleOrchestrationConnectionError(st, messagesEl) {
    // Annuler le timer d'inactivité (le tour s'interrompt)
    if (st.orchestrationTimeout) {
      clearTimeout(st.orchestrationTimeout);
      st.orchestrationTimeout = null;
    }
    const progress = st.orchestrationPlan && st.orchestrationPlan.progress;
    // Phase codeur = une tâche est en cours (current_task) ET on n'attend pas
    // une réponse de l'orchestrateur (escalade/révision/subdivision).
    const isCoderPhase = !!progress && !!progress.current_task
      && !st.orchestrationEscalating && !st.orchestrationRevising && !st.orchestrationSubdividing;
    // Réinitialiser les flags transitoires (l'escalade/révision/subdivision en cours est abandonnée)
    st.orchestrationEscalating = false;
    st.orchestrationRevising = false;
    st.orchestrationSubdividing = false;
    st.orchestrationSubdividingTaskId = null;
    st.orchestrationTaskStartTime = null;
    // Flag dédié : empêche handleOrchestrationAgentEnd de traiter la fin d'agent
    st.orchestrationConnectionError = true;
    st.orchestrationPaused = true;
    const model = isCoderPhase ? st.coderModel : st.orchestratorModel;
    const role = isCoderPhase ? "Codeur" : "Orchestrateur";
    appendSystemMessage(messagesEl, `🔌 ${role} injoignable${model ? ` (${model})` : ""} — erreur de connexion. Vérifiez que le serveur est lancé, puis cliquez ▶️ pour reprendre.`);
    renderOrchestrationPlan(messagesEl, st);
    updateOrchestrationButtons(st);
  }

  /** Gère la fin d'un tour d'agent en mode orchestration. */
  async function runLintCheck(filePaths, projectPath) {
    if (!filePaths || filePaths.length === 0 || !projectPath) {
      return { ok: true, hadChecker: false, output: "Aucun fichier à vérifier" };
    }
    try {
      const result = await invoke("check_syntax", { paths: filePaths, projectPath });
      if (result && typeof result.ok === "boolean") {
        return {
          ok: result.ok,
          hadChecker: result.hadChecker !== false,
          output: result.output || "",
        };
      }
    } catch (e) {
      console.error("[runLintCheck] erreur:", e);
      // En cas d'erreur du linter, on ne bloque pas la tâche
      return { ok: true, hadChecker: false, output: String(e) };
    }
    return { ok: true, hadChecker: false, output: "" };
  }

  /** Envoie une demande de correction syntaxique au codeur (linting-in-the-loop). */
  async function sendLintCorrectionPrompt(st, messagesEl, statusEl, task, lintPrompt) {
    if (st.currentModel !== st.coderModel) {
      await switchToCoder(st);
    }
    appendSystemMessage(messagesEl, `🔨 Correction syntaxique demandée au codeur pour la tâche ${task.id}.`);
    try {
      await invoke("send_agent_prompt", { message: lintPrompt });
      resetOrchestrationIdleTimer(st, messagesEl, statusEl);
    } catch (e) {
      console.error("Erreur envoi correction syntaxique:", e);
      appendErrorMessage(messagesEl, `❌ Erreur envoi correction : ${e}`);
    }
  }

  // ── Auto-test post-modification (E2, spec_orchestration_autotest.md) ──
  // Gate de tests qui étend le linting-in-the-loop (§11.3) : après chaque tâche
  // du codeur, on exécute les tests du projet (npm/cargo/pytest/go) au lieu de
  // ne valider que la syntaxe. Les échecs de tests déclenchent une boucle de
  // correction locale (SELF_FIX) au codeur, dans le même budget que le linting.
  // Une baseline (tests déjà rouges au démarrage) est calculée paresseusement à
  // la première gate pour ignorer les échecs hérités et ne signaler que les
  // régressions introduites par la tâche.

  /** Lit les manifestes projet pour détecter le test runner. */
  async function loadTestManifests(projectPath) {
    if (!projectPath) return {};
    const read = async (rel) => {
      try {
        const abs = resolvePath(rel, projectPath);
        const exists = await invoke("file_exists", { path: abs });
        if (!exists) return null;
        return await invoke("read_file_content", { path: abs });
      } catch (_) { return null; }
    };
    const [packageJson, cargoToml, pyprojectToml, pytestIni, conftestPy, requirementsTxt, goMod] = await Promise.all([
      read("package.json"),
      read("Cargo.toml"),
      read("pyproject.toml"),
      read("pytest.ini"),
      read("conftest.py"),
      read("requirements.txt"),
      read("go.mod"),
    ]);
    return { packageJson, cargoToml, pyprojectToml, pytestIni, conftestPy, requirementsTxt, goMod };
  }

  /**
   * Calcule la baseline des tests (échecs déjà présents avant toute modif).
   * Lancé paresseusement à la première gate. Si la commande explose/timeout,
   * E2 est désactivé pour le plan + warning (retombe sur check_syntax).
   * Stocké dans st.orchestrationTestBaseline = { failures, exitCode, available }.
   */
  async function computeTestBaseline(st, messagesEl) {
    if (st.orchestrationTestBaseline || st.orchestrationTestBaselineComputing) return;
    if (!st.orchestrationTestEnabled) return;
    st.orchestrationTestBaselineComputing = true;
    const projectPath = window._pilotProjectPath;
    try {
      const manifests = await loadTestManifests(projectPath);
      const runner = detectTestRunner(manifests);
      st.orchestrationTestRunner = runner;
      if (!runner) {
        // Pas de runner → fallback check_syntax (déjà fait par le linting).
        st.orchestrationTestBaseline = { failures: [], exitCode: 0, available: false };
        return;
      }
      const cmd = buildTestCommand(runner, "full", [], st.orchestrationTestCommand);
      if (!cmd) {
        st.orchestrationTestBaseline = { failures: [], exitCode: 0, available: false };
        return;
      }
      appendSystemMessage(messagesEl, `🧪 Calcul de la baseline des tests (${runner}) avant exécution du plan…`);
      const result = await invoke("run_project_tests", {
        command: cmd.command, args: cmd.args, timeoutMs: st.orchestrationTestTimeoutMs,
      });
      const parsed = parseTestFailures(runner, result.stdout, result.stderr);
      const failures = parsed.failures.map((f) => f.name);
      const available = !result.timed_out;
      st.orchestrationTestBaseline = { failures, exitCode: result.exit_code, available };
      if (!available && !st.orchestrationTestBaselineWarned) {
        st.orchestrationTestBaselineWarned = true;
        appendSystemMessage(messagesEl, `⚠️ Tests du projet injoignables (timeout à la baseline). Auto-test désactivé pour ce plan — fallback sur la vérification syntaxique.`);
      } else if (failures.length > 0) {
        appendSystemMessage(messagesEl, `🧪 Baseline : ${failures.length} test(s) déjà en échec avant exécution (ignorés pendant le plan).`);
      } else {
        appendSystemMessage(messagesEl, `🧪 Basaseline des tests OK (tous au vert).`);
      }
    } catch (e) {
      console.error("[computeTestBaseline] erreur:", e);
      st.orchestrationTestBaseline = { failures: [], exitCode: null, available: false };
      if (!st.orchestrationTestBaselineWarned) {
        st.orchestrationTestBaselineWarned = true;
        appendSystemMessage(messagesEl, `⚠️ Tests du projet injoignables (${e}). Auto-test désactivé pour ce plan — fallback sur la vérification syntaxique.`);
      }
    } finally {
      st.orchestrationTestBaselineComputing = false;
    }
  }

  /**
   * Exécute la gate de tests après une tâche du codeur. Retourne :
   *  - { ran: false } si E2 désactivé, pas de runner, baseline indisponible
   *  - { ran: true, ok: true, ... } si tests au vert (ou seuls échecs hérités)
   *  - { ran: true, ok: false, failures, newFailures, output, timedOut } si régression
   */
  async function runTestGate(st, task, changedFiles, messagesEl) {
    if (!st.orchestrationTestEnabled) return { ran: false };
    const projectPath = window._pilotProjectPath;
    if (!projectPath) return { ran: false };
    // Calcul paresseux de la baseline au premier appel.
    await computeTestBaseline(st, messagesEl);
    if (!st.orchestrationTestBaseline || !st.orchestrationTestBaseline.available) {
      return { ran: false };
    }
    const runner = st.orchestrationTestRunner;
    if (!runner) return { ran: false };
    // Ciblage : pour pytest, dériver les fichiers de test candidats et filtrer
    // par existence (buildTestCommand ne peut pas vérifier l'existence — pure).
    let testTargets = [];
    if (st.orchestrationTestScope === "targeted" && runner === "pytest" && changedFiles.length > 0) {
      const candidates = derivePytestTargets(changedFiles, projectPath);
      const checked = await Promise.all(candidates.map(async (p) => {
        try { return (await invoke("file_exists", { path: p })) ? p : null; }
        catch (_) { return null; }
      }));
      testTargets = checked.filter(Boolean);
    }
    const cmd = buildTestCommand(runner, st.orchestrationTestScope, testTargets, st.orchestrationTestCommand);
    if (!cmd) return { ran: false };
    let result;
    try {
      result = await invoke("run_project_tests", {
        command: cmd.command, args: cmd.args, timeoutMs: st.orchestrationTestTimeoutMs,
      });
    } catch (e) {
      console.error("[runTestGate] erreur run_project_tests:", e);
      // Ne pas bloquer la tâche sur une erreur d'exécution — fallback validation.
      return { ran: false, error: String(e) };
    }
    const parsed = parseTestFailures(runner, result.stdout, result.stderr);
    const baseline = st.orchestrationTestBaseline.failures || [];
    const newFailures = parsed.failures.filter((f) => !baseline.includes(f.name));
    const ok = newFailures.length === 0 && !result.timed_out;
    return {
      ran: true,
      ok,
      timedOut: result.timed_out,
      exitCode: result.exit_code,
      failures: parsed.failures,
      newFailures,
      output: truncateTestOutput(parsed.raw),
    };
  }

  /** Envoie une demande de correction des tests au codeur (boucle SELF_FIX E2). */
  async function sendTestCorrectionPrompt(st, messagesEl, statusEl, task, testPrompt) {
    if (st.currentModel !== st.coderModel) {
      await switchToCoder(st);
    }
    appendSystemMessage(messagesEl, `🧪 Correction des tests demandée au codeur pour la tâche ${task.id}.`);
    try {
      await invoke("send_agent_prompt", { message: testPrompt });
      resetOrchestrationIdleTimer(st, messagesEl, statusEl);
    } catch (e) {
      console.error("Erreur envoi correction tests:", e);
      appendErrorMessage(messagesEl, `❌ Erreur envoi correction tests : ${e}`);
    }
  }

  // ── H2 V1 : Reviewer indépendant (spec_orchestration_reviewer.md) ──

  /** Résout le provider/model du reviewer (fallback sur modèle orchestrateur). */
  function resolveReviewerModel(st) {
    let provider = st.orchestrationReviewerProvider || "";
    let modelId = st.orchestrationReviewerModel || "";
    if (!provider || !modelId) {
      const orch = st.orchestratorModel || "";
      const [p, ...rest] = orch.split("/");
      if (!provider) provider = p || "";
      if (!modelId) modelId = rest.join("/") || "";
    }
    return { provider, modelId };
  }

  /** Démarre le reviewer si nécessaire + contexte vierge + modèle. */
  async function ensureReviewerSession(st) {
    try { await invoke("start_reviewer_session"); }
    catch (e) { throw new Error(`start_reviewer_session : ${e}`); }
    try { await invoke("new_reviewer_session"); } catch (_) {}
    const { provider, modelId } = resolveReviewerModel(st);
    if (provider && modelId) {
      try { await invoke("set_reviewer_model", { provider, modelId }); } catch (_) {}
    }
  }

  /** Porte review : relit le diff de la tâche. */
  async function runReviewGate(st, task, changedFiles, messagesEl, statusEl) {
    if (!st.orchestrationReviewerEnabled) return { ran: false };
    if (!st.orchestrationPlan || !st.orchestrationRunning || st.orchestrationPaused) return { ran: false };
    // Scope critical : ne déclencher que si un fichier sensible est touché
    if (st.orchestrationReviewerScope === "critical") {
      if (!matchesAnyCritical(changedFiles, st.orchestrationReviewerCriticalPatterns || [])) {
        return { ran: false, skipped: true };
      }
    }
    const taskId = task.id;
    const maxCorr = st.orchestrationTestMaxCorrections || 3;
    const attempts = (st.orchestrationReviewAttempts[taskId] || 0)
      + (st.orchestrationLintAttempts[taskId] || 0)
      + (st.orchestrationTestAttempts[taskId] || 0);
    if (attempts >= maxCorr) return { ran: false, budgetExhausted: true };
    // Lancer le reviewer
    try { await ensureReviewerSession(st); }
    catch (e) {
      appendSystemMessage(messagesEl, "⚠️ Reviewer indisponible, validation sans relecture.");
      return { ran: false, error: String(e) };
    }
    // Lire le contenu des fichiers modifiés (contenu final)
    const projectPath = window._pilotProjectPath;
    const fileContents = [];
    for (const f of changedFiles) {
      try {
        const rel = (projectPath && f.startsWith(projectPath)) ? f.slice(projectPath.length).replace(/^[\/\\]+/, "") : f;
        const content = await invoke("read_file_content", { path: rel });
        fileContents.push({ path: rel, content });
      } catch (_) {}
    }
    let projectMemory = null;
    try { projectMemory = await invoke("read_file_content", { path: "PROJECT_MEMORY.md" }); } catch (_) {}
    const prompt = buildReviewPrompt(task, fileContents, projectMemory, st.orchestrationPlan?.global_directive || null);
    appendSystemMessage(messagesEl, `🔍 Reviewer indépendant : relecture de la tâche ${taskId}...`);
    st.reviewerRawText = "";
    st.isReviewerStreaming = true;
    const reviewPromise = new Promise((resolve) => { st.reviewerPendingResolve = resolve; });
    let timedOut = false;
    const timer = setTimeout(() => {
      if (st.reviewerPendingResolve) {
        timedOut = true;
        const r = st.reviewerPendingResolve;
        st.reviewerPendingResolve = null;
        r({ timedOut: true });
      }
    }, 90000);
    try { await invoke("send_reviewer_prompt", { message: prompt }); }
    catch (e) {
      clearTimeout(timer);
      st.isReviewerStreaming = false;
      st.reviewerPendingResolve = null;
      appendSystemMessage(messagesEl, "⚠️ Reviewer indisponible (envoi échoué), validation sans relecture.");
      return { ran: false, error: String(e) };
    }
    const result = await reviewPromise;
    clearTimeout(timer);
    st.isReviewerStreaming = false;
    st.reviewerPendingResolve = null;
    if (result && result.timedOut) {
      try { await invoke("abort_reviewer"); } catch (_) {}
      appendSystemMessage(messagesEl, "⚠️ Reviewer: timeout (90s), validation sans relecture.");
      return { ran: true, fallback: true };
    }
    if (result && result.crashed) {
      appendSystemMessage(messagesEl, "⚠️ Reviewer planté, validation sans relecture.");
      return { ran: true, fallback: true };
    }
    const parsed = parseReviewResult(st.reviewerRawText);
    if (parsed.summary === "" && parsed.changes === null) {
      appendSystemMessage(messagesEl, "⚠️ Reviewer: réponse sans marqueur, validation sans relecture.");
      return { ran: true, fallback: true };
    }
    st.orchestrationReviewAttempts[taskId] = (st.orchestrationReviewAttempts[taskId] || 0) + 1;
    return { ran: true, approved: parsed.approved, summary: parsed.summary, changes: parsed.changes };
  }

  /** Envoie une demande de correction au codeur suite à CHANGES_REQUESTED. */
  async function sendReviewCorrectionPrompt(st, messagesEl, statusEl, task, changes) {
    if (st.currentModel !== st.coderModel) await switchToCoder(st);
    appendSystemMessage(messagesEl, `🔍 Correction demandée par le reviewer pour la tâche ${task.id}.`);
    const prompt = buildReviewCorrectionPrompt(task, changes, st.orchestrationPlan?.global_directive || null);
    try {
      await invoke("send_agent_prompt", { message: prompt });
      resetOrchestrationIdleTimer(st, messagesEl, statusEl);
    } catch (e) {
      console.error("Erreur envoi correction reviewer:", e);
      appendErrorMessage(messagesEl, `❌ Erreur envoi correction reviewer : ${e}`);
    }
  }

  /** Handler des événements du reviewer (canal rpc-event-reviewer). */
  function handleReviewerEvent(payload, messagesEl, state, statusEl) {
    const type = payload.type;
    if (type === "process_exit" || type === "process_error") {
      if (state.reviewerPendingResolve) {
        const r = state.reviewerPendingResolve;
        state.reviewerPendingResolve = null;
        state.isReviewerStreaming = false;
        r({ crashed: true });
      }
      return;
    }
    switch (type) {
      case "agent_start":
        state.isReviewerStreaming = true;
        state.reviewerRawText = "";
        if (!state.reviewerCurrentBlock || state.reviewerCurrentBlock.dataset.closed) {
          const blk = createAssistantBlock(messagesEl);
          blk.classList.add("agent-reviewer-block");
          blk.dataset.closed = "false";
          const header = document.createElement("div");
          header.className = "agent-reviewer-header";
          header.textContent = "🔍 Reviewer";
          const flow = blk.querySelector(".agent-stream-flow");
          if (flow) flow.prepend(header);
          state.reviewerCurrentBlock = blk;
        }
        break;
      case "message_update": {
        const delta = payload.assistantMessageEvent;
        if (!delta) break;
        if (state.reviewerCompacting) break;
        if (delta.type === "text_delta") {
          state.reviewerRawText += delta.delta || "";
          if (state.reviewerCurrentBlock) {
            let section = state.reviewerCurrentBlock.querySelector(".agent-text-section:not([data-closed])");
            if (!section) section = appendTextSection(state.reviewerCurrentBlock, "", false);
            if (section) {
              section.innerHTML = md.render(state.reviewerRawText);
              scrollToBottom(messagesEl);
            }
          }
        }
        break;
      }
      case "compaction_start":
        state.reviewerCompacting = true;
        break;
      case "compaction_end":
      case "compaction":
        state.reviewerCompacting = false;
        state.reviewerRawText = "";
        break;
      case "agent_end":
        state.isReviewerStreaming = false;
        if (state.reviewerCurrentBlock) state.reviewerCurrentBlock.dataset.closed = "true";
        if (state.reviewerPendingResolve) {
          const r = state.reviewerPendingResolve;
          state.reviewerPendingResolve = null;
          r({ done: true });
        }
        break;
      default:
        break;
    }
  }

  async function handleOrchestrationAgentEnd(st, messagesEl, statusEl) {
    if (!st.orchestrationPlan || !st.orchestrationRunning) return;
    // Mémoriser si ce tour était une escalade AVANT de resetter le flag
    const wasEscalating = st.orchestrationEscalating;

    // Annuler le timeout d'inactivité
    if (st.orchestrationTimeout) {
      clearTimeout(st.orchestrationTimeout);
      st.orchestrationTimeout = null;
    }

    // Erreur de connexion déjà gérée dans le case "message" (option 1) —
    // ne pas traiter la fin d'agent (sinon la tâche serait marquée « effectuée » à tort).
    // MAIS si le codeur a quand même répondu avec un marqueur valide (DONE/SELF_FIX/
    // NEED_HELP/blocs) malgré un retry transitoire (auto_retry_start faux positif,
    // ex. latence cloud ou 429), on traite la fin — sinon le plan reste bloqué en
    // pause alors que le codeur a livré son travail. Voir spec_orchestration.md Bug 7.
    if (st.orchestrationConnectionError) {
      // Récupérer la réponse pour vérifier si elle est exploitable.
      const probeBubble = messagesEl.querySelector('.agent-bubble-assistant:last-child');
      const probeText = st.lastAssistantRawText || (probeBubble ? (probeBubble.textContent || '') : '');
      const hasValidMarker = /\b(?:DONE|SELF_FIX|NEED_HELP|NO_CHANGE)\s*:/i.test(probeText)
        || /SEARCH\/REPLACE:|CREATE:/i.test(probeText);
      if (hasValidMarker) {
        // Le codeur a répondu malgré le retry transitoire : traiter la fin.
        appendSystemMessage(messagesEl, `ℹ️ Réponse du codeur reçue malgré un retry transitoire — traitement de la fin de tâche.`);
        st.orchestrationConnectionError = false;
        st.orchestrationPaused = false;
        st.orchestrationRunning = true;
        // Ne pas return — on continue le traitement normal ci-dessous.
      } else {
        st.orchestrationConnectionError = false;
        return;
      }
    }

    // Récupérer le contenu de la dernière réponse
    const lastBubble = messagesEl.querySelector('.agent-bubble-assistant:last-child');
    const responseText = st.lastAssistantRawText || (lastBubble ? (lastBubble.textContent || '') : '');

    // ── H3 : tour d'extraction mémoire post-tâche (tour dédié) ──
    // L'agent a répondu au prompt d'extraction : appliquer d'éventuels blocs
    // SEARCH/REPLACE/CREATE vers PROJECT_MEMORY.md, puis reprendre le flux normal.
    if (st.orchestrationExtractingMemory) {
      st.orchestrationExtractingMemory = null;
      const sr = parseSearchReplaceBlocks(responseText);
      if (sr.hasBlocks) {
        const applyResult = await applySearchReplaceBlocks(sr.blocks, invoke, window._pilotProjectPath);
        if (applyResult.ok && applyResult.changedFiles.length > 0) {
          appendSystemMessage(messagesEl, `📝 Mémoire projet mise à jour : ${applyResult.changedFiles.join(", ")}`);
          st.orchestrationCachedTree = null;
        } else if (!applyResult.ok) {
          appendSystemMessage(messagesEl, `⚠️ Mémoire projet : échec application — ${applyResult.errors.join("; ")}`);
        }
      } else {
        appendSystemMessage(messagesEl, `📝 Mémoire projet : rien de nouveau à ajouter.`);
      }
      // Reprendre le flux normal vers la tâche suivante
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    // ── Vérification finale (après exécution de toutes les tâches) ──
    if (st.orchestrationFinalReview) {
      st.orchestrationFinalReview = false;

      // V3 étape 4 : détecter les marqueurs du codeur (relit les fichiers lui-meme).
      // DONE_FINAL = tout est correct ; FINAL_FIX = defaut constate, correction in-session.
      const hasDoneFinal = /DONE_FINAL\s*:/i.test(responseText);
      const finalFixMatch = responseText.match(/FINAL_FIX\s*:\s*([\s\S]*?)(?=\n(?:DONE_FINAL|FINAL_FIX)\s*:|$)/i);
      const hasFinalFix = !!finalFixMatch;

      // Cas 1 : FINAL_FIX (le codeur a detecte un defaut, demande un tour de correction in-session)
      if (hasFinalFix && !hasDoneFinal) {
        const defect = finalFixMatch[1].trim();
        const cycles = (st.orchestrationFinalReviewCycles || 0) + 1;
        if (cycles > 3) {
          appendSystemMessage(messagesEl, `⚠️ Vérification finale : 3 cycles FINAL_FIX épuisés, dernier défaut non résolu : ${defect}. Arrêt (les fichiers restent dans l'état actuel).`);
          appendSystemMessage(messagesEl, summarizePlan(st.orchestrationPlan.progress, st.orchestrationPlan.plan.length));
          try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
          st._previousPlan = st.orchestrationPlan;
          st.orchestrationPlan = null;
          st.orchestrationCachedTree = null;
          st.orchestrationTasksInBatch = 0;
          st.orchestrationFinalReviewCount = 0;
          st.orchestrationFinalReviewCycles = 0;
          st.orchestrationRunning = false;
          renderOrchestrationPlan(messagesEl, st);
          return;
        }
        // Appliquer les blocs faits dans ce tour (le codeur a pu faire des modifs avant FINAL_FIX)
        const srFinal = parseSearchReplaceBlocks(responseText);
        if (srFinal.hasBlocks) {
          const applyResult = await applySearchReplaceBlocks(srFinal.blocks, invoke, window._pilotProjectPath);
          if (!applyResult.ok) {
            appendSystemMessage(messagesEl, `⚠️ Vérification finale : échec d'application des blocs : ${applyResult.errors.join("; ")}.`);
          } else if (applyResult.changedFiles.length > 0) {
            st.orchestrationCachedTree = null;
          }
        }
        st.orchestrationFinalReview = true; // on reste en vérification finale
        st.orchestrationFinalReviewCycles = cycles;
        const cyclesRemaining = 3 - cycles;
        appendSystemMessage(messagesEl, `🔁 Vérification finale — FINAL_FIX (cycle ${cycles}/3) : le codeur corrige « ${defect} » in-session...`);
        if (st.currentModel !== st.coderModel) {
          await switchToCoder(st);
        }
        const continuePrompt = buildCoderFinalReviewContinuePrompt(defect, cyclesRemaining, st.orchestrationPlan?.global_directive);
        try {
          await invoke("send_agent_prompt", { message: continuePrompt });
          resetOrchestrationIdleTimer(st, messagesEl, statusEl);
        } catch (e) {
          console.error("Erreur envoi FINAL_FIX continue:", e);
          appendErrorMessage(messagesEl, `❌ Erreur envoi FINAL_FIX : ${e}`);
          st.orchestrationFinalReview = false;
          st.orchestrationRunning = false;
          st.orchestrationPaused = true;
          renderOrchestrationPlan(messagesEl, st);
        }
        return;
      }

      // Cas 2 : DONE_FINAL (le codeur confirme que tout est correct après relisage)
      if (hasDoneFinal) {
        appendSystemMessage(messagesEl, `✅ Vérification finale terminée : le codeur confirme que tout est correct (après relisage des fichiers).`);
        appendSystemMessage(messagesEl, summarizePlan(st.orchestrationPlan.progress, st.orchestrationPlan.plan.length));
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        st._previousPlan = st.orchestrationPlan;
        st.orchestrationPlan = null;
        st.orchestrationCachedTree = null;
        st.orchestrationTasksInBatch = 0;
        st.orchestrationFinalReviewCount = 0;
        st.orchestrationFinalReviewCycles = 0;
        st.orchestrationRunning = false;
        renderOrchestrationPlan(messagesEl, st);
        return;
      }

      // Cas 3 : réponse au format plan JSON (orchestrateur, ou codeur qui a détecté
      // des tâches manquantes entières) → nouveau plan vierge
      const parsedReview = parsePlanResponse(responseText) || {};
      const reviewPlan = parsedReview.plan;
      if (reviewPlan && Array.isArray(reviewPlan) && reviewPlan.length > 0) {
        const globalDirective = parsedReview.globalDirective || st.orchestrationPlan?.global_directive || null;
        st._previousPlan = st.orchestrationPlan;
        st.orchestrationPlan = {
          plan: normalizePlan(reviewPlan),
          global_directive: globalDirective,
          progress: { current_task: 0, completed: [], failed: [], escalated: [], retrying: [], task_attempts: {}, task_metrics: {}, subdivided: [], task_logs: {} }
        };
        st.orchestrationRunning = true;
        st.orchestrationTasksSinceRevision = 0;
        st.orchestrationTasksInBatch = 0;
        st.orchestrationCachedTree = null;
        st.orchestrationExtractingMemory = null;
        st.orchestrationFinalReviewCycles = 0;
        appendSystemMessage(messagesEl, `📝 Vérification finale : ${reviewPlan.length} nouvelle(s) tâche(s) détectée(s). Reprise par le codeur...`);
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        renderOrchestrationPlan(messagesEl, st);
        await executeNextTask(messagesEl, st, statusEl);
      } else {
        // Rien à corriger : tout est OK (réponse texte libre sans marqueur V3)
        appendSystemMessage(messagesEl, `✅ Vérification finale terminée : aucun défaut signalé. Plan considéré comme correct.`);
        appendSystemMessage(messagesEl, summarizePlan(st.orchestrationPlan.progress, st.orchestrationPlan.plan.length));
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        st._previousPlan = st.orchestrationPlan;
        st.orchestrationPlan = null;
        st.orchestrationCachedTree = null;
        st.orchestrationTasksInBatch = 0;
        st.orchestrationFinalReviewCount = 0;
        st.orchestrationFinalReviewCycles = 0;
        renderOrchestrationPlan(messagesEl, st);
      }
      return;
    }

    // ── Subdivision d'une tâche échouée (point M) ──
    // (traitée AVANT la révision car ce sont aussi des réponses de l'orchestrateur)
    if (st.orchestrationSubdividing) {
      st.orchestrationSubdividing = false;
      const failedTaskId = st.orchestrationSubdividingTaskId;
      st.orchestrationSubdividingTaskId = null;
      const parsedSub = parsePlanResponse(responseText) || {};
      // V3 étape 5 : logique unifiée d'application de subdivision
      const applied = await applySubdivision(st, messagesEl, failedTaskId, parsedSub.plan, "Subdivision");
      if (!applied) {
        appendSystemMessage(messagesEl, `Escalade directe de la tâche ${failedTaskId}...`);
        // Reprendre la tâche d'origine en mode escalade
        if (st.orchestrationPlan.plan.find((t) => t.id === failedTaskId)) {
          st.orchestrationEscalating = true;
        }
      }
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    // ── Révision mid-plan (point E) ──
    if (st.orchestrationRevising) {
      st.orchestrationRevising = false;
      const parsedRev = parsePlanResponse(responseText) || {};
      const revisedRemaining = parsedRev.plan;
      if (revisedRemaining && Array.isArray(revisedRemaining)) {
        const globalDirective = st.orchestrationPlan.global_directive;
        st.orchestrationPlan = mergeRevisedPlan(st.orchestrationPlan, revisedRemaining);
        st.orchestrationPlan.global_directive = globalDirective;
        st.orchestrationTasksSinceRevision = 0;
        appendSystemMessage(messagesEl, `🔄 Plan révisé par l'orchestrateur : ${revisedRemaining.length} tâche(s) restante(s).`);
        try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
        renderOrchestrationPlan(messagesEl, st);
      } else {
        appendSystemMessage(messagesEl, "⚠️ Révision échouée (pas de plan valide), on continue avec le plan actuel.");
      }
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    // ── Métriques de la tâche courante (point N) ──
    // Stocke durée + longueur de réponse pour la tâche qu'on vient d'exécuter.
    // Ignoré en mode révision/subdivision/escalade (ce sont des appels à l'orchestrateur,
    // pas des tâches codeur — leurs durées ne doivent pas écraser les métriques réelles).
    if (st.orchestrationTaskStartTime && !st.orchestrationRevising && !st.orchestrationSubdividing && !st.orchestrationEscalating && !wasEscalating && !st.orchestrationFinalReview) {
      const durationMs = Date.now() - st.orchestrationTaskStartTime;
      const progress0 = st.orchestrationPlan.progress;
      if (!progress0.task_metrics) progress0.task_metrics = {};
      const tid = progress0.current_task;
      if (tid) {
        progress0.task_metrics[tid] = {
          ...(progress0.task_metrics[tid] || {}),
          durationMs,
          responseChars: st.orchestrationResponseChars || 0,
        };
      }
    }
    st.orchestrationTaskStartTime = null;

    const progress = st.orchestrationPlan.progress;
    const currentTaskId = progress.current_task;
    const currentTask = st.orchestrationPlan.plan.find((t) => t.id === currentTaskId);
    if (!currentTask) {
      // Pas de tâche courante (état incohérent) : passer à la suite
      await executeNextTask(messagesEl, st, statusEl);
      return;
    }

    const hasDone = /DONE\s*:/i.test(responseText);
    const hasNeedHelp = /NEED_HELP\s*:/i.test(responseText);
    // V3 : detection du marqueur du codeur (SELF_FIX / DONE / NEED_HELP / NO_CHANGE).
    // Le marqueur le plus loin dans le texte gere le cas SELF_FIX puis DONE dans le meme tour.
    const coderMarker = detectCoderMarker(responseText);

    function storeTaskSummary(taskId, text) {
      if (!progress.task_summaries) progress.task_summaries = {};
      progress.task_summaries[taskId] = extractTaskSummary(text, taskId);
    }

    function markEscalatedAndContinue() {
      if (!progress.escalated) progress.escalated = [];
      progress.escalated.push(currentTaskId);
      progress.current_task = 0;
      storeTaskSummary(currentTaskId, responseText);
      // Métriques (point N) : marquer la tâche comme escaladée
      if (!progress.task_metrics) progress.task_metrics = {};
      progress.task_metrics[currentTaskId] = {
        ...(progress.task_metrics[currentTaskId] || {}),
        status: "escalated",
        attempts: progress.task_attempts[currentTaskId] || 0,
      };
      if (hasNeedHelp && !hasDone) {
        appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} escaladée mais l'orchestrateur a demandé de l'aide. On passe à la suite.`);
      } else {
        // Synthèse des tentatives du codeur avant escalade (observabilité).
        const taskLogsEsc = (progress.task_logs && progress.task_logs[currentTaskId]) || [];
        const synthEsc = taskLogsEsc.length > 1 ? ` (${summarizeTaskAttempts(taskLogsEsc)})` : "";
        appendSystemMessage(messagesEl, `✅ Tâche ${currentTaskId} réalisée par l'orchestrateur (escalade).${synthEsc}`);
      }
    }

    if (st.orchestrationEscalating) {
      // L'orchestrateur vient de répondre à une escalade — Mode Orchestration V2 : 4 choix
      st.orchestrationEscalating = false;
      const escalation = determineEscalationAction(responseText);

      // Choix 1 : redécouper la tâche en sous-tâches (V3 étape 5 : logique unifiée)
      if (escalation.action === "redecouper") {
        const parsedSub = parsePlanResponse(responseText) || {};
        const applied = await applySubdivision(st, messagesEl, currentTaskId, parsedSub.plan, "Escalade (redécoupage)");
        if (!applied) {
          appendSystemMessage(messagesEl, `⚠️ Redécoupage demandé par l'orchestrateur invalide. Passage en exécution directe...`);
          markEscalatedAndContinue();
          // Laisser la suite sauvegarder le plan et passer à la tâche suivante
        }
        await executeNextTask(messagesEl, st, statusEl);
        return;
      }

      // Choix 2 : réviser le plan global
      if (escalation.action === "reviser") {
        const parsedRev = parsePlanResponse(responseText) || {};
        const revisedRemaining = parsedRev.plan;
        if (revisedRemaining && Array.isArray(revisedRemaining)) {
          const globalDirective = st.orchestrationPlan.global_directive;
          st.orchestrationPlan = mergeRevisedPlan(st.orchestrationPlan, revisedRemaining);
          st.orchestrationPlan.global_directive = globalDirective;
          st.orchestrationTasksSinceRevision = 0;
          appendSystemMessage(messagesEl, `🔄 Escalade : révision globale du plan par l'orchestrateur (${revisedRemaining.length} tâche(s) restante(s)).`);
          try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
          renderOrchestrationPlan(messagesEl, st);
        } else {
          appendSystemMessage(messagesEl, `⚠️ Révision demandée par l'orchestrateur invalide. Passage en exécution directe...`);
          markEscalatedAndContinue();
          // Laisser la suite sauvegarder le plan et passer à la tâche suivante
        }
        await executeNextTask(messagesEl, st, statusEl);
        return;
      }

      // Choix 3 : lancer une commande système
      if (escalation.action === "commande") {
        const cmd = escalation.payload;
        if (cmd) {
          appendSystemMessage(messagesEl, `🔧 Escalade : exécution de la commande système : ${cmd}`);
          try {
            await invoke("execute_agent_bash", { command: cmd });
            appendSystemMessage(messagesEl, `✅ Commande exécutée. Relance de la tâche ${currentTaskId} par le codeur...`);
          } catch (e) {
            appendErrorMessage(messagesEl, `❌ Échec de la commande : ${e}`);
          }
        } else {
          appendSystemMessage(messagesEl, `⚠️ Commande demandée par l'orchestrateur non fournie. Relance de la tâche ${currentTaskId} par le codeur...`);
        }
        // Relancer la même tâche par le codeur (pas de marquage terminé)
        await executeNextTask(messagesEl, st, statusEl);
        return;
      }

      // Choix 4 (ou fallback) : exécuter la tâche directement (comportement classique)
      markEscalatedAndContinue();
      // Ne PAS retourner ici : il faut sauvegarder le plan et passer à la suite via executeNextTask
      // (sinon orchestrationRunning reste bloqué et la conversation suivante reprend l'ancien plan).
    } else if (coderMarker.marker === "NEED_HELP") {
      // Échec : le codeur demande de l'aide (V3 : détection unifiée via detectCoderMarker)
      const helpText = coderMarker.payload || 'Aide demandée sans précision';
      await handleTaskFailure(st, messagesEl, statusEl, currentTask, `NEED_HELP: ${helpText}`);
      return; // handleTaskFailure va relancer executeNextTask
    } else if (coderMarker.marker === "SELF_FIX") {
      // V3 : le codeur a detecte un defaut lui-meme en Phase 3 (CONTRÔLER).
      // On applique d'abord les blocs faits dans ce tour (Phase 2 du tour courant),
      // puis on renvoie un prompt court de correction IN-SESSION (sans new_session)
      // pour que le codeur corrige le defaut qu'il a lui-meme constate.
      // Boucle limite a 3 cycles par tentative classique.
      const cycles = (st.orchestrationCurrentTaskCycles || 0) + 1;
      if (cycles > 3) {
        appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — 3 cycles d'auto-correction (SELF_FIX) épuisés sans DONE. Échec de la tentative.`);
        await handleTaskFailure(st, messagesEl, statusEl, currentTask, `3 cycles SELF_FIX épuisés, dernier défaut : ${coderMarker.payload || "(non précisé)"}`);
        return;
      }
      // Appliquer les blocs faits dans ce tour (s'il y en a)
      const srSelfFix = parseSearchReplaceBlocks(responseText);
      if (srSelfFix.hasBlocks) {
        const applyResult = await applySearchReplaceBlocks(srSelfFix.blocks, invoke, window._pilotProjectPath);
        if (!applyResult.ok) {
          const readWarning = buildReadFilesWarning(currentTask, st.orchestrationReadFilesInTask);
          const feedback = `Les modifications n'ont pas pu être appliquées pendant le SELF_FIX :\n${applyResult.errors.join("\n")}\n\nVérifie que le texte dans SEARCH correspond EXACTEMENT au fichier lu via read_file.${readWarning}`;
          appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — échec d'application pendant SELF_FIX.`);
          await handleTaskFailure(st, messagesEl, statusEl, currentTask, feedback);
          return;
        }
        if (applyResult.changedFiles.length > 0) {
          st.orchestrationCachedTree = null;
        }
      }
      st.orchestrationCurrentTaskCycles = cycles;
      const cyclesRemaining = 3 - cycles;
      appendSystemMessage(messagesEl, `🔁 Tâche ${currentTaskId} — SELF_FIX (auto-contrôle, cycle ${cycles}/3) : le codeur corrige « ${coderMarker.payload || "défaut non précisé"} » in-session...`);
      // Observabilité — journaliser le cycle SELF_FIX.
      logTaskAttempt(st, currentTaskId, {
        marker: "SELF_FIX",
        reason: `Auto-contrôle cycle ${cycles}/3 : ${coderMarker.payload || "défaut non précisé"}`,
        action: "self_fix",
        filesChanged: srSelfFix.hasBlocks ? srSelfFix.blocks.map((b) => b.path).filter(Boolean) : [],
        responseExcerpt: responseText,
        durationMs: (progress.task_metrics && progress.task_metrics[currentTaskId] && progress.task_metrics[currentTaskId].durationMs) || null,
        cycles,
      });
      // Renvoyer le prompt de correction DANS LA MEME SESSION (pas de new_session)
      if (st.currentModel !== st.coderModel) {
        await switchToCoder(st);
      }
      const selfFixPrompt = buildSelfFixPrompt(currentTask, coderMarker.payload, st.orchestrationPlan?.global_directive, cyclesRemaining);
      try {
        await invoke("send_agent_prompt", { message: selfFixPrompt });
        resetOrchestrationIdleTimer(st, messagesEl, statusEl);
      } catch (e) {
        console.error("Erreur envoi SELF_FIX:", e);
        appendErrorMessage(messagesEl, `❌ Erreur envoi SELF_FIX : ${e}`);
        await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Erreur envoi SELF_FIX : ${e}`);
      }
      return;
    } else if (!coderMarker.marker && detectReflectionOnly(responseText)) {
      // ── Nudge proactif : le codeur s'est arrêté après la Phase 1 (RÉFLEXION) ──
      // sans exécuter la Phase 2. Cas typique des modèles faibles (9B) face à un
      // prompt multi-phases. On le relance DANS LA MÊME SESSION pour qu'il reprenne
      // à la Phase 2, sans consommer un cycle d'échec (ce n'est pas un retry).
      // Voir spec_orchestration_observability.md § nudge.
      const nudgeCount = (st.orchestrationNudgeAttempts && st.orchestrationNudgeAttempts[currentTaskId]) || 0;
      const MAX_NUDGES = 2;
      if (nudgeCount < MAX_NUDGES) {
        st.orchestrationNudgeAttempts = st.orchestrationNudgeAttempts || {};
        st.orchestrationNudgeAttempts[currentTaskId] = nudgeCount + 1;
        const nudgesRemaining = MAX_NUDGES - (nudgeCount + 1);
        appendSystemMessage(messagesEl, `🔁 Tâche ${currentTaskId} — arrêt après RÉFLEXION (aucun fichier modifié). Relance du codeur vers la Phase 2 (nudge ${nudgeCount + 1}/${MAX_NUDGES})...`);
        // Observabilité — journaliser le nudge.
        logTaskAttempt(st, currentTaskId, {
          marker: "REFLECTION_ONLY",
          reason: "Arrêt prématuré après RÉFLEXION (aucun bloc produit)",
          action: "nudge",
          responseExcerpt: responseText,
          cycles: st.orchestrationCurrentTaskCycles || 0,
        });
        if (st.currentModel !== st.coderModel) {
          await switchToCoder(st);
        }
        const nudgePrompt = buildNudgeAfterReflectionPrompt(currentTask, st.orchestrationPlan?.global_directive, nudgesRemaining);
        try {
          await invoke("send_agent_prompt", { message: nudgePrompt });
          resetOrchestrationIdleTimer(st, messagesEl, statusEl);
        } catch (e) {
          console.error("Erreur envoi nudge:", e);
          appendErrorMessage(messagesEl, `❌ Erreur envoi nudge : ${e}`);
          await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Erreur envoi nudge : ${e}`);
        }
        return;
      }
      // Si 2 nudges déjà épuisés sans succès, on tombe dans le flux normal
      // (validation échec → handleTaskFailure → retry/escalade). On log l'épuisement.
      appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — 2 relances (nudges) épuisées sans modification. Traitement comme échec.`);
      // On laisse le flux continuer vers la branche V2 (validation échec).
    } else {
      // ── Mode Orchestration V2 : édition chirurgicale + linting-in-the-loop ──
      const sr = parseSearchReplaceBlocks(responseText);

      // Format invalide détecté : code libre sans balises structurées
      if (sr.hasInvalidFormat) {
        const readWarning = buildReadFilesWarning(currentTask, st.orchestrationReadFilesInTask);
        const feedback = `Format invalide. Tu dois utiliser EXCLUSIVEMENT les formats SEARCH/REPLACE: <path> ... >>>>>>> REPLACE ou CREATE: <path> ... pour toute modification. N'envoie pas de fichier entier ou de code libre.${readWarning}`;
        appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — format de réponse non conforme. Correction demandée au codeur.`);
        await handleTaskFailure(st, messagesEl, statusEl, currentTask, feedback);
        return;
      }

      // Appliquer les blocs d'édition chirurgicale s'il y en a
      let changedFiles = [];
      if (sr.hasBlocks) {
        const applyResult = await applySearchReplaceBlocks(sr.blocks, invoke, window._pilotProjectPath);
        if (!applyResult.ok) {
          const readWarning = buildReadFilesWarning(currentTask, st.orchestrationReadFilesInTask);
          const feedback = `Les modifications n'ont pas pu être appliquées :\n${applyResult.errors.join("\n")}\n\nVérifie que le texte dans SEARCH correspond EXACTEMENT au fichier lu via read_file, puis réessaie.${readWarning}`;
          appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — échec d'application des modifications.`);
          await handleTaskFailure(st, messagesEl, statusEl, currentTask, feedback);
          return;
        }
        changedFiles = applyResult.changedFiles;
        // Invalider le cache d'arbre si des fichiers ont été créés/modifiés
        if (changedFiles.length > 0) {
          st.orchestrationCachedTree = null;
        }
        // ── A1 : associer les fichiers modifiés au snapshot pré-tâche (§3.2) ──
        if (st.orchestrationSnapshotsEnabled && st.orchestrationSnapshots[currentTaskId]) {
          st.orchestrationSnapshots[currentTaskId].files = changedFiles.slice();
        }
      }

      // Linting-in-the-loop sur les fichiers modifiés ou, à défaut, les fichiers listés.
      // V3 (fix suppressions) : on exclut les fichiers qui n'existent plus sur disque.
      // Pour une tâche de suppression, les fichiers listés n'existent plus → le linter
      // (eslint sur chemin inexistant, ou cargo check sur crate cassé par les
      // références aux fichiers supprimés) échouait systématiquement et déclenchait
      // « Trop d'erreurs de syntaxe persistantes après 3 corrections » alors que le
      // codeur avait correctement fait son travail. On ne linte que les fichiers
      // encore présents.
      const filesToLintRaw = changedFiles.length > 0 ? changedFiles : (currentTask.files || []);
      const filesToLint = [];
      for (const p of filesToLintRaw) {
        try {
          const abs = resolvePath(p, window._pilotProjectPath);
          const exists = await invoke("file_exists", { path: abs });
          if (exists) filesToLint.push(p);
        } catch (_) { /* garder le fichier si la sonde échoue (comportement précédent) */ filesToLint.push(p); }
      }
      const lint = await runLintCheck(filesToLint, window._pilotProjectPath);
      if (!lint.ok && lint.hadChecker) {
        st.orchestrationLintAttempts[currentTaskId] = (st.orchestrationLintAttempts[currentTaskId] || 0) + 1;
        const lintAttempt = st.orchestrationLintAttempts[currentTaskId];
        if (lintAttempt <= 3) {
          appendSystemMessage(messagesEl, `🧹 Erreur de syntaxe détectée (correction ${lintAttempt}/3). Envoi au codeur pour correction...`);
          // Observabilité — journaliser l'échec de linting (correction demandée).
          logTaskAttempt(st, currentTaskId, {
            marker: "syntax_error",
            reason: `Erreur de syntaxe (correction ${lintAttempt}/3)`,
            action: "lint_correction",
            filesChanged: filesToLint,
            responseExcerpt: responseText,
            lintErrors: lint.output || null,
            durationMs: (progress.task_metrics && progress.task_metrics[currentTaskId] && progress.task_metrics[currentTaskId].durationMs) || null,
            cycles: st.orchestrationCurrentTaskCycles || 0,
          });
          const lintPrompt = buildLintFailurePrompt(lint.output, currentTask);
          await sendLintCorrectionPrompt(st, messagesEl, statusEl, currentTask, lintPrompt);
          return;
        } else {
          appendSystemMessage(messagesEl, `🧹 Trop d'erreurs de syntaxe persistantes après 3 corrections. Échec de tâche.`);
          await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Linting échoué après 3 corrections : ${lint.output}`);
          return;
        }
      }

      // ── Auto-test post-modification (E2) ──
      // Gate de tests qui étend le linting-in-the-loop : exécute les tests du
      // projet (npm/cargo/pytest/go) au lieu de ne valider que la syntaxe. La
      // baseline (tests déjà rouges) est calculée paresseusement à la 1re gate.
      // Budget de corrections unifié : lint + test bornés à max_corrections.
      if (st.orchestrationTestEnabled) {
        const testGate = await runTestGate(st, currentTask, changedFiles, messagesEl);
        if (testGate.ran && !testGate.ok) {
          const lintAttempts = st.orchestrationLintAttempts[currentTaskId] || 0;
          const testAttempts = (st.orchestrationTestAttempts[currentTaskId] || 0) + 1;
          st.orchestrationTestAttempts[currentTaskId] = testAttempts;
          const totalCorrections = lintAttempts + testAttempts;
          const maxCorrections = st.orchestrationTestMaxCorrections || 3;
          if (totalCorrections <= maxCorrections) {
            const reason = testGate.timedOut
              ? `Tests en timeout (${Math.round((st.orchestrationTestTimeoutMs || 60000) / 1000)}s)`
              : `${testGate.newFailures.length} nouveau(s) échec(s) : ${testGate.newFailures.slice(0, 5).map((f) => f.name).join(", ")}`;
            appendSystemMessage(messagesEl, `🧪 Tests en échec (correction ${testAttempts}/${maxCorrections} — ${reason}). Envoi au codeur pour correction…`);
            // Observabilité — journaliser l'échec de tests (correction demandée).
            logTaskAttempt(st, currentTaskId, {
              marker: "tests_failed",
              reason: `Tests en échec (correction ${testAttempts}/${maxCorrections})`,
              action: "test_correction",
              filesChanged: changedFiles,
              responseExcerpt: responseText,
              testResult: {
                runner: st.orchestrationTestRunner,
                exit: testGate.exitCode,
                newFailures: testGate.newFailures.map((f) => f.name),
                inheritedFailures: (testGate.failures || [])
                  .filter((f) => (st.orchestrationTestBaseline.failures || []).includes(f.name))
                  .map((f) => f.name),
                timedOut: testGate.timedOut,
                output_excerpt: truncateTestOutput(testGate.output, 4000),
              },
              durationMs: (progress.task_metrics && progress.task_metrics[currentTaskId] && progress.task_metrics[currentTaskId].durationMs) || null,
              cycles: st.orchestrationCurrentTaskCycles || 0,
            });
            const testPrompt = buildTestFailurePrompt(
              testGate.failures,
              st.orchestrationTestBaseline.failures || [],
              currentTask,
              testGate.output
            );
            await sendTestCorrectionPrompt(st, messagesEl, statusEl, currentTask, testPrompt);
            return;
          } else {
            appendSystemMessage(messagesEl, `🧪 Tests en échec persistants après ${maxCorrections} corrections (lint + test). Échec de tâche.`);
            await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Tests en échec après ${maxCorrections} corrections : ${testGate.output}`);
            return;
          }
        }
      }

      // ── H2 V1 : Reviewer indépendant (spec_orchestration_reviewer.md) ──
      // Porte review après les tests E2, avant validation. Le reviewer relit le
      // diff de la tâche (contexte vierge) et émet APPROVED / CHANGES_REQUESTED.
      if (st.orchestrationReviewerEnabled && changedFiles.length > 0) {
        const taskDurationMs = (progress.task_metrics && progress.task_metrics[currentTaskId] && progress.task_metrics[currentTaskId].durationMs) || null;
        const reviewGate = await runReviewGate(st, currentTask, changedFiles, messagesEl, statusEl);
        if (reviewGate.ran && !reviewGate.approved && !reviewGate.fallback && reviewGate.changes) {
          // CHANGES_REQUESTED → retry codeur (budget unifié)
          const reviewAttempts = (st.orchestrationReviewAttempts[currentTaskId] || 0);
          const maxCorrections = st.orchestrationTestMaxCorrections || 3;
          const totalCorrections = (st.orchestrationLintAttempts[currentTaskId] || 0)
            + (st.orchestrationTestAttempts[currentTaskId] || 0) + reviewAttempts;
          if (totalCorrections <= maxCorrections) {
            appendSystemMessage(messagesEl, `🔍 Reviewer : modifications demandées (correction ${reviewAttempts}/${maxCorrections}). Envoi au codeur…`);
            logTaskAttempt(st, currentTaskId, {
              marker: "review_changes_requested",
              reason: `CHANGES_REQUESTED (correction ${reviewAttempts}/${maxCorrections})`,
              action: "review_correction",
              filesChanged: changedFiles,
              responseExcerpt: responseText,
              reviewResult: { approved: false, changes: reviewGate.changes, summary: reviewGate.summary || "" },
              durationMs: taskDurationMs,
              cycles: st.orchestrationCurrentTaskCycles || 0,
            });
            await sendReviewCorrectionPrompt(st, messagesEl, statusEl, currentTask, reviewGate.changes);
            return;
          } else {
            appendSystemMessage(messagesEl, `🔍 Reviewer : défauts persistants après ${maxCorrections} corrections. Échec de tâche.`);
            await handleTaskFailure(st, messagesEl, statusEl, currentTask, `Reviewer : défauts persistants après ${maxCorrections} corrections : ${reviewGate.changes}`);
            return;
          }
        }
        if (reviewGate.ran && reviewGate.approved) {
          appendSystemMessage(messagesEl, `🔍 Reviewer : ✅ ${reviewGate.summary}`);
          logTaskAttempt(st, currentTaskId, {
            marker: "review_approved",
            reason: reviewGate.summary || "approuvé",
            action: "review_approved",
            filesChanged: changedFiles,
            responseExcerpt: responseText,
            reviewResult: { approved: true, summary: reviewGate.summary, changes: null },
            durationMs: taskDurationMs,
            cycles: st.orchestrationCurrentTaskCycles || 0,
          });
        }
      }

      // Validation post-tâche (fichiers listés / mentionnés ont changé)
      // V3 (Bug 3) : si des fichiers ont été écrits via SEARCH/REPLACE/CREATE,
      // c'est la source de vérité — on ne dépend plus du mtime Windows (peu fiable
      // à la seconde près, qui marquait à tort « inchangé » et déclenchait des
      // escalades injustifiées). On garde checkTaskFilesChanged comme garde-fou
      // pour les cas sans blocs (NO_CHANGE, fichiers mentionnés hors format, etc.).
      let validation;
      if (changedFiles.length > 0) {
        validation = {
          ok: true,
          reason: `${changedFiles.length} fichier(s) écrit(s) via SEARCH/REPLACE/CREATE : ${changedFiles.join(", ")}`,
        };
      } else if (hasDone && !sr.hasBlocks && detectNoChangeDone(responseText)) {
        // NO_CHANGE legitime : le codeur a lu les fichiers et constate qu'aucune
        // modification n'est necessaire (deja conforme). Tache satisfaite —
        // sans cette branche le cas tombait dans validation echec -> retry -> boucle
        // (jusqu'a « tentative 4+ »), puis escalade abusive vers l'orchestrateur.
        validation = {
          ok: true,
          reason: "NO_CHANGE — aucun changement requis (deja conforme)",
        };
      } else {
        validation = await checkTaskFilesChanged(currentTask, st.orchestrationCurrentFileState || {}, invoke, responseText, window._pilotProjectPath);
      }
      if (validation.ok) {
        // Ne PAS incrémenter task_attempts ici (c'est fait dans handleTaskFailure pour les échecs)
        if (!progress.completed) progress.completed = [];
        progress.completed.push(currentTaskId);
        progress.current_task = 0;
        if (progress.retrying) progress.retrying = progress.retrying.filter((id) => id !== currentTaskId);
        if (progress.failed) progress.failed = progress.failed.filter((id) => id !== currentTaskId);
        // Réinitialiser les compteurs de lint pour cette tâche
        delete st.orchestrationLintAttempts[currentTaskId];
        delete st.orchestrationNudgeAttempts[currentTaskId];
        delete st.orchestrationTestAttempts[currentTaskId]; // E2
        storeTaskSummary(currentTaskId, responseText);
        // Métriques (point N) : marquer la tâche comme réussie
        if (!progress.task_metrics) progress.task_metrics = {};
        progress.task_metrics[currentTaskId] = {
          ...(progress.task_metrics[currentTaskId] || {}),
          status: "completed",
          attempts: progress.task_attempts[currentTaskId] || 0,
        };
        const tag = hasDone ? 'terminée' : 'terminée (fichiers modifiés, pas de marqueur DONE)';
        // Observabilité — journaliser la tentative réussie.
        const durMs = (progress.task_metrics && progress.task_metrics[currentTaskId] && progress.task_metrics[currentTaskId].durationMs) || null;
        logTaskAttempt(st, currentTaskId, {
          marker: hasDone ? "DONE" : "NO_CHANGE",
          reason: validation.reason || tag,
          action: "complete",
          filesChanged: changedFiles,
          responseExcerpt: responseText,
          durationMs: durMs,
          cycles: st.orchestrationCurrentTaskCycles || 0,
          // A1 : badge snapshot dans le journal (§7).
          snapshot: (st.orchestrationSnapshotsEnabled && st.orchestrationSnapshots[currentTaskId] && st.orchestrationSnapshots[currentTaskId].files.length > 0)
            ? { sha: st.orchestrationSnapshots[currentTaskId].sha.slice(0, 7), filesCount: st.orchestrationSnapshots[currentTaskId].files.length }
            : null,
        });
        // Synthèse des tentatives (si > 1 entrée, indique les retries traversés).
        const taskLogs = (progress.task_logs && progress.task_logs[currentTaskId]) || [];
        const synth = taskLogs.length > 1 ? ` (${summarizeTaskAttempts(taskLogs)})` : "";
        appendSystemMessage(messagesEl, `✅ Tâche ${currentTaskId} ${tag}.${synth} (${validation.reason})`);
        // Incrémenter le compteur de batch
        st.orchestrationTasksInBatch = (st.orchestrationTasksInBatch || 0) + 1;
        // A1 : rafraîchir le bouton ↩️ (snapshot désormais annulable).
        updateOrchestrationButtons(st);
      } else {
        // Validation échec : aucun fichier listé n'a été modifié/créé
        const readWarning = buildReadFilesWarning(currentTask, st.orchestrationReadFilesInTask);
        let detail = "";
        if (!sr.hasBlocks && !responseText.match(/DONE\s*:/i)) {
          detail = "\nTu n'as fourni aucun bloc SEARCH/REPLACE ou CREATE, ni de marqueur DONE.";
        }
        const reason = `Validation échec : ${validation.reason}${detail}${readWarning}`;
        appendSystemMessage(messagesEl, `⚠️ Tâche ${currentTaskId} — ${reason}`);
        // Casser le batch : une erreur dans le batch force un new_session au prochain tour
        st.orchestrationTasksInBatch = getEffectiveBatchSize(st.orchestrationBatchSize, st.coderModel);
        await handleTaskFailure(st, messagesEl, statusEl, currentTask, reason);
        return;
      }
    }

    // Sauvegarder le plan
    st.orchestrationPlan.progress = progress;
    try { await invoke("save_plan", { planJson: JSON.stringify(st.orchestrationPlan, null, 2) }); } catch (_) {}
    renderOrchestrationPlan(messagesEl, st);

    // ── Révision mid-plan (point E) : conditionnelle ──
    st.orchestrationTasksSinceRevision = (st.orchestrationTasksSinceRevision || 0) + 1;
    const interval = st.orchestrationRevisionInterval || 5;
    const doneIdsNow = new Set([...(progress.completed || []), ...(progress.escalated || [])]);
    const remainingAfter = st.orchestrationPlan.plan.filter((t) => !doneIdsNow.has(t.id));
    let shouldRevise = false;
    let failureRate = 0;
    let avgAttempts = 0;
    if (interval > 0 && st.orchestrationTasksSinceRevision >= interval && remainingAfter.length > 0) {
      // V3 (Bug 2) : révision CONDITIONNELLE — seulement sur signaux négatifs.
      // Avant, shouldRevise était forcé à true (révision inconditionnelle), ce qui
      // gaspillait des appels cloud et pouvait déstabiliser un plan sain.
      // Au passage, on déclare failureRate/avgAttempts au scope externe (l'ancien
      // code les déclarait en const dans le if puis les référençait hors du bloc,
      // ce qui levait une ReferenceError silencieuse).
      const totalDone = doneIdsNow.size;
      const failedCount = (progress.escalated || []).length + (progress.failed || []).length;
      failureRate = totalDone > 0 ? failedCount / totalDone : 0;
      const attempts = progress.task_attempts || {};
      const attemptValues = Object.values(attempts);
      avgAttempts = attemptValues.length > 0 ? attemptValues.reduce((a, b) => a + b, 0) / attemptValues.length : 0;
      shouldRevise = failureRate > 0.30 || avgAttempts > 1.3;
    }
    if (shouldRevise) {
      appendSystemMessage(messagesEl, `🧠 Révision mid-plan (${st.orchestrationTasksSinceRevision} tâche(s) terminée(s), taux d'échec ${Math.round(failureRate * 100)}%)...`);
      await startPlanRevision(st, messagesEl, statusEl);
      return;
    }

    // ── H3 : extraction mémoire projet post-tâche (opt-in) ──
    // Après une tâche réussie, demander au codeur d'extraire 1–3 faits appris
    // et de les ajouter à PROJECT_MEMORY.md. Tour dédié : on renvoie un prompt et
    // on attend l'agent_end suivant (branche early de handleOrchestrationAgentEnd).
    if (st.projectMemoryAutoExtract && !st.orchestrationExtractingMemory && currentTask) {
      st.orchestrationExtractingMemory = currentTaskId;
      const extractPrompt = buildMemoryExtractPrompt(currentTask, responseText);
      appendSystemMessage(messagesEl, `📝 Extraction mémoire projet (tâche ${currentTaskId})…`);
      try {
        await invoke("send_agent_prompt", { message: extractPrompt });
        resetOrchestrationIdleTimer(st, messagesEl, statusEl);
        return;
      } catch (e) {
        console.error("Erreur envoi extraction mémoire:", e);
        st.orchestrationExtractingMemory = null;
        // tomber sur executeNextTask ci-dessous
      }
    }

    console.log(`[handleOrchestrationAgentEnd] tâche ${progress.current_task} terminée, passage à executeNextTask`);
    await executeNextTask(messagesEl, st, statusEl);
  }

  // ── Chargement initial de la config d'orchestration ──
  try {
    const config = await invoke("get_config");
    state.orchestrationEnabled = config.orchestration_enabled || false;
    // Mémoire projet (H3) : flags d'injection + extraction auto
    state.projectMemoryEnabled = config.project_memory_enabled !== false;
    state.projectMemoryAutoExtract = config.project_memory_auto_extract === true;
    if (config.orchestrator_provider) {
      state.orchestratorModel = `${config.orchestrator_provider}/${config.orchestrator_model_id}`;
    }
    if (config.coder_provider) {
      state.coderModel = `${config.coder_provider}/${config.coder_model_id}`;
    }
    // Paramètres d'orchestration configurables (points B & E)
    if (config.orchestration_idle_timeout_ms && config.orchestration_idle_timeout_ms > 1000) {
      state.orchestrationIdleTimeoutMs = config.orchestration_idle_timeout_ms;
    }
    if (config.orchestration_revision_interval != null && config.orchestration_revision_interval >= 0) {
      state.orchestrationRevisionInterval = config.orchestration_revision_interval;
    }
    if (config.orchestration_granularity && !state.orchestrationEnabled) {
      state.orchestrationGranularity = config.orchestration_granularity;
      state.orchestrationEffectiveGranularity = config.orchestration_granularity;
    }
    if (config.orchestration_batch_size != null) {
      state.orchestrationBatchSize = config.orchestration_batch_size;
    }
    if (config.orchestration_confirm_model_switch != null) {
      state.orchestrationConfirmModelSwitch = config.orchestration_confirm_model_switch;
    }
    if (config.coder_context_window != null && config.coder_context_window >= 0) {
      state.coderContextWindow = config.coder_context_window;
    }
    // ── Auto-test post-modification (E2) ──
    state.orchestrationTestEnabled = config.orchestration_test_enabled === true;
    if (config.orchestration_test_timeout_ms && config.orchestration_test_timeout_ms >= 1000) {
      state.orchestrationTestTimeoutMs = config.orchestration_test_timeout_ms;
    }
    if (config.orchestration_test_max_corrections && config.orchestration_test_max_corrections > 0) {
      state.orchestrationTestMaxCorrections = config.orchestration_test_max_corrections;
    }
    state.orchestrationTestCommand = config.orchestration_test_command || "";
    if (config.orchestration_test_scope === "full" || config.orchestration_test_scope === "targeted") {
      state.orchestrationTestScope = config.orchestration_test_scope;
    }
    // ── A1 : snapshots ──
    state.orchestrationSnapshotsEnabled = config.orchestration_snapshots_enabled !== false;
    // ── H2 V1 : reviewer ──
    // Ne pas écraser les overrides session si le mode orchestration est actif.
    if (!state.orchestrationEnabled) {
      state.orchestrationReviewerEnabled = config.orchestration_reviewer_enabled === true;
      state.orchestrationReviewerScope = (config.orchestration_reviewer_scope === "critical") ? "critical" : "all";
      state.orchestrationReviewerCriticalPatterns = Array.isArray(config.orchestration_reviewer_critical_patterns)
        ? config.orchestration_reviewer_critical_patterns.map(String) : [];
      state.orchestrationReviewerProvider = config.orchestration_reviewer_provider || "";
      state.orchestrationReviewerModel = config.orchestration_reviewer_model || "";
    }
  } catch (_) {}

  // Mettre à jour le bouton orchestration si actif
  if (state.orchestrationEnabled) {
    const orchBtn = toolbar.querySelector('[data-action="orchestration"]');
    if (orchBtn) orchBtn.classList.add("active");
  }

  // ── Redémarrage à chaud depuis les Paramètres ──
  // Quand l'utilisateur modifie rpc_pi_path / rpc_no_session / rpc_session_dir
  // dans les Paramètres (et que l'onglet agent est ouvert), settings.js
  // dispatche "pilot-agent-restart-needed". On stoppe l'ancien backend, on en
  // démarre un nouveau avec la config à jour, puis on reset l'UI et recharge
  // les modèles. Évite le piège « ça ne répond plus » après reconfig : sans
  // ça, l'agent restait sur l'ancien backend (plh) jusqu'à fermeture/rouverture
  // manuelle de l'onglet.
  const onRestartNeeded = async () => {
    try {
      state.restarting = true;
      appendSystemMessage(messagesEl, "🔄 Redémarrage de l'agent en cours…");
      await invoke("stop_agent_session").catch(() => {});
      state.piDead = false;
      await invoke("start_agent_session");
      // Attendre que pi soit prêt (poll get_agent_state ~10s max). Si pi meurt
      // au démarrage, get_agent_state échoue vite (pipe closed) → message clair
      // au lieu d'attendre 12-30s en silence puis « pipe closed » au model change.
      const ready = await waitForPiReady(state, 10);
      state.restarting = false;
      if (!ready) {
        appendErrorMessage(messagesEl, "❌ L'agent n'a pas redémarré (pi s'est arrêté ou ne répond pas). Vérifiez la console (process_exit / extension_error). Cliquez sur 🔄 pour réessayer.");
        statusEl.textContent = "⚠️ Échec redémarrage";
        statusEl.className = "agent-status agent-status-error";
        return;
      }
      try { await invoke("send_rpc_command", { command: JSON.stringify({ type: "new_session" }) }); } catch (_) {}
      state.isStreaming = false;
      state.currentAssistantBlock = null;
      state.currentTextBlock = null;
      state.currentThinkingBlock = null;
      state.currentToolBlocks.clear();
      state.pendingToolCalls.clear();
      state.pendingText = "";
      state.lastAssistantRawText = "";
      state.pendingImages = [];
      state.pendingRender = false;
      messagesEl.innerHTML = "";
      statusEl.textContent = "Prêt";
      statusEl.className = "agent-status agent-status-idle";
      appendSystemMessage(messagesEl, "🔄 Agent redémarré (paramètres RPC modifiés).");
      await loadModels(state, true);
      updateStats();
      loadCommands();
      // Context Engine : reset (réinjecter au prochain prompt)
      state.contextInjected = false;
      state.contextRefreshRequested = false;
      state.memoryInjected = false;
    } catch (e) {
      state.restarting = false;
      console.error("Redémarrage agent:", e);
      appendErrorMessage(messagesEl, "❌ Échec redémarrage agent: " + e);
    }
  };
  window.addEventListener("pilot-agent-restart-needed", onRestartNeeded);

  return {
    wrapper,
    unlisten: () => {
      try { unlisten(); } catch (_) {}
      try { unlistenReviewer(); } catch (_) {}
      window.removeEventListener("pilot-agent-restart-needed", onRestartNeeded);
    },
    unlistenDragDrop,
  };
}

// ── Stats tokens/coûts ──

async function loadCommands() {
  try {
    const result = await invoke("list_agent_commands");
    let list = [];
    if (result && result.data && Array.isArray(result.data.commands)) {
      list = result.data.commands;
    } else if (result && Array.isArray(result.data)) {
      list = result.data;
    } else if (result && Array.isArray(result)) {
      list = result;
    }
    // Préserver les alias de modèles déjà chargés par loadModelAliases() (issue #6 :
    // loadCommands écrase allCommands ; si loadModelAliases a tourné avant — ex. via
    // l'event pilot-models-changed — on ne doit pas perdre les alias).
    const savedAliases = allCommands.filter((c) => c.category === "modèle");
    allCommands = list.map((c) => ({
      name: c.name || c.command || "?",
      description: c.description || c.desc || "",
      category: c.category || c.source || "",
    }));

    // Ajouter les commandes built-in
    const builtins = [
      { name: "resume", description: "Lister et charger une conversation enregistrée", category: "built-in" },
      { name: "prompt", description: "Exécuter un prompt avec les fichiers cochés", category: "built-in" },
    ];
    for (const bi of builtins) {
      if (!allCommands.find((c) => c.name === bi.name)) {
        allCommands.push(bi);
      }
    }
    // Réinjecter les alias préservés
    for (const alias of savedAliases) {
      if (!allCommands.find((c) => c.name === alias.name && c.category === "modèle")) {
        allCommands.push(alias);
      }
    }

    console.log("[loadCommands] chargées:", allCommands.length);
  } catch (err) {
    console.error("Erreur chargement commandes:", err);
  }
}

/** Charge les alias de modèles depuis le registre global du backend actif
 *  (~/.{stem}/agent/model-switch.json, lu via la commande Rust `read_model_aliases`).
 *  Les alias sont globaux à Pilot (un registre par backend pi/plh), plus liés à un
 *  projet. Source de vérité partagée avec l'agent pi/plh, qui lit le même fichier
 *  pour reconnaître les commandes slash. Édition via l'onglet « Fournisseurs »
 *  (models-config.js), où l'alias est saisi au niveau de chaque modèle. */
export async function loadModelAliases() {
  // Nettoyer les anciennes entrées d'alias dans allCommands
  allCommands = allCommands.filter(c => c.category !== "modèle");
  modelAliases = {};
  try {
    const kind = backendKind();
    const stem = (kind && kind !== "unknown") ? kind : "pi";
    const parsed = await invoke("read_model_aliases", { stem });
    const aliases = parsed && parsed.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {};
    modelAliases = aliases;
    globalDefaultModel = (parsed && typeof parsed.defaultModel === "string") ? parsed.defaultModel : "";
    for (const [alias, model] of Object.entries(aliases)) {
      if (!allCommands.find(c => c.name === alias && c.category === "modèle")) {
        allCommands.push({
          name: alias,
          description: `→ ${model}`,
          category: "modèle",
        });
      }
    }
    console.log("[loadModelAliases] chargés:", Object.keys(modelAliases).length);
  } catch (_) {
    // Fichier absent ou invalide → pas d'alias, pas d'erreur
    modelAliases = {};
  }
}

function showAutocomplete(query) {
  acFiltered = allCommands.filter((c) =>
    c.name.toLowerCase().includes(query)
  );
  if (acFiltered.length === 0) {
    hideAutocomplete();
    return;
  }
  acIndex = 0;
  renderAcList();
}

function hideAutocomplete() {
  if (acPopupEl) acPopupEl.classList.remove("visible");
  acIndex = -1;
  acFiltered = [];
}

function renderAcList() {
  if (!acPopupEl) return;
  let html = "";
  acFiltered.forEach((c, i) => {
    const active = i === acIndex ? " active" : "";
    html += `
      <div class="agent-autocomplete-item${active}" data-ac-index="${i}">
        <span class="ac-cmd">/${c.name}</span>
        <span class="ac-desc">${escapeHtmlText(c.description)}</span>
        ${c.category ? `<span class="ac-cat">${escapeHtmlText(c.category)}</span>` : ""}
      </div>
    `;
  });
  acPopupEl.innerHTML = html;
  acPopupEl.classList.add("visible");

  // Attacher les clics
  acPopupEl.querySelectorAll(".agent-autocomplete-item").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      acIndex = parseInt(el.dataset.acIndex);
      applyAcSelection();
    });
  });
}

function moveAcSelection(delta) {
  if (acFiltered.length === 0) return;
  acIndex = (acIndex + delta + acFiltered.length) % acFiltered.length;
  renderAcList();
}

// ── Autocomplétion des alias de modèles (intégrée dans /) ──
// Les alias sont ajoutés à allCommands par loadModelAliases() avec category="modèle".
// applyAcSelection() les détecte et appelle applyModelAlias() pour basculer le modèle.
function applyAcSelection() {
  if (acIndex < 0 || acIndex >= acFiltered.length || !acInputEl) return;
  const cmd = acFiltered[acIndex];

  // Alias de modèle : basculer le modèle au lieu d'insérer du texte
  if (cmd.category === "modèle") {
    applyModelAlias(cmd);
    return;
  }

  // Commande normale : insérer le texte
  const val = acInputEl.value;
  const cursorPos = acInputEl.selectionStart;
  const beforeCursor = val.substring(0, cursorPos);
  const afterCursor = val.substring(cursorPos);
  const lastSlash = beforeCursor.lastIndexOf("/");
  const newBefore = beforeCursor.substring(0, lastSlash + 1) + cmd.name + " ";
  acInputEl.value = newBefore + afterCursor;
  const newPos = newBefore.length;
  acInputEl.setSelectionRange(newPos, newPos);
  acInputEl.focus();
  hideAutocomplete();
}

/** Applique un alias de modèle : bascule le modèle et retire /alias de l'input */
async function applyModelAlias(cmd) {
  // Extraire le model depuis la description "→ provider/modelId"
  const modelValue = cmd.description.replace("→ ", "");
  const [provider, ...parts] = modelValue.split("/");
  const modelId = parts.join("/");

  // Retirer le /alias de l'input
  const val = acInputEl.value;
  const cursorPos = acInputEl.selectionStart;
  const beforeCursor = val.substring(0, cursorPos);
  const afterCursor = val.substring(cursorPos);
  const lastSlash = beforeCursor.lastIndexOf("/");
  if (lastSlash >= 0) {
    const beforeSlash = val.substring(0, lastSlash);
    acInputEl.value = beforeSlash + afterCursor;
    acInputEl.setSelectionRange(lastSlash, lastSlash);
  }
  acInputEl.focus();
  hideAutocomplete();

  // Basculer vers le modèle
  try {
    await invoke("set_agent_model", { provider, modelId });
    const st = window.__agentState;
    if (st) st.currentModel = modelValue;
    const modelSelect = document.getElementById("agent-model-select");
    if (modelSelect) {
      const opt = Array.from(modelSelect.options).find(o => o.value === modelValue);
      if (opt) modelSelect.value = modelValue;
    }
    const messagesEl = document.querySelector(".agent-chat-messages");
    if (messagesEl) {
      appendSystemMessage(messagesEl, `🔄 Modèle changé : ${modelValue} (via /${cmd.name})`);
    }
  } catch (err) {
    console.error("Erreur changement modèle via alias:", err);
    const messagesEl = document.querySelector(".agent-chat-messages");
    if (messagesEl) {
      appendErrorMessage(messagesEl, `❌ Impossible de changer de modèle : ${err}`);
    }
  }
}

function escapeHtmlText(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Conversion robuste Uint8Array → base64 (supporte les grands fichiers) */
function bytesToBase64(bytes) {
  const chunkSize = 0x8000; // 32KB chunks
  let result = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    result += String.fromCharCode.apply(null, chunk);
  }
  return btoa(result);
}

/** Récupère la liste des modèles disponibles.
 *  Source primaire : RPC (list_agent_models, interroge le programme actif — pi, plh).
 *  Fallback : lecture du fichier models.json (get_available_models_list) — utile si
 *  le programme RPC ne supporte pas get_available_models ou retourne un format
 *  non reconnu. Les chaînes "provider/modelId" du fallback sont converties en
 *  objets { provider, id, label } pour homogénéité avec le format RPC.
 *  Voir spec_rpc.md (résolution du config dir).
 */
async function fetchAvailableModels() {
  // 1. Source primaire : RPC (programme actif)
  try {
    const result = await invoke("list_agent_models");
    let models = [];
    if (result && result.data && Array.isArray(result.data.models)) models = result.data.models;
    else if (result && Array.isArray(result.data)) models = result.data;
    else if (result && Array.isArray(result)) models = result;
    if (models.length > 0) {
      return models.map(m => {
        if (typeof m === "string") {
          const idx = m.indexOf("/");
          const provider = idx >= 0 ? m.slice(0, idx) : m;
          const id = idx >= 0 ? m.slice(idx + 1) : "";
          return { provider, id, label: m };
        }
        return m;
      });
    }
  } catch (e) {
    console.warn("list_agent_models (RPC) échoué, fallback fichier:", e);
  }
  // 2. Fallback : lecture fichier (~/{stem}/agent/models.json via Rust)
  try {
    const list = await invoke("get_available_models_list");
    if (Array.isArray(list)) {
      return list.map(s => {
        const idx = s.indexOf("/");
        const provider = idx >= 0 ? s.slice(0, idx) : s;
        const id = idx >= 0 ? s.slice(idx + 1) : "";
        return { provider, id, label: s };
      });
    }
  } catch (e) {
    console.warn("get_available_models_list (fichier) échoué:", e);
  }
  return [];
}

async function loadModels(st, forceDefault = false) {
  const select = document.getElementById("agent-model-select");
  if (!select) return;
  try {
    const models = await fetchAvailableModels();
    if (models.length === 0) {
      select.innerHTML = '<option value="">Aucun modèle</option>';
      return;
    }
    let html = '';
    for (const m of models) {
      const provider = m.provider || m.providerId || "?";
      const id = m.id || m.modelId || "?";
      const label = m.label || `${provider}/${id}`;
      const value = `${provider}/${id}`;
      html += `<option value="${value}">${label}</option>`;
    }
    select.innerHTML = html;
    // Remplir aussi les sélecteurs (inactifs) du mode Orchestration avec la même liste.
    const orchSel2 = document.getElementById("agent-orch-model-select");
    const coderSel2 = document.getElementById("agent-coder-model-select");
    if (orchSel2) orchSel2.innerHTML = html;
    if (coderSel2) coderSel2.innerHTML = html;
    // En mode Orchestration, repositionner les sélecteurs orch sur les modèles choisis
    // (loadModels peut être rappelé après un new-session sans repasser par l'activation).
    if (st && st.orchestrationEnabled) {
      if (orchSel2 && st.orchestratorModel) orchSel2.value = st.orchestratorModel;
      if (coderSel2 && st.coderModel) coderSel2.value = st.coderModel;
    }
    // Déterminer le modèle à sélectionner dans le selecteur standard.
    // Helper : résoudre globalDefaultModel (cache ou lecture à la volée).
    const resolveDefault = async () => {
      let d = globalDefaultModel;
      if (!d) {
        try {
          const kind = backendKind();
          const stem = (kind && kind !== "unknown") ? kind : "pi";
          const acfg = await invoke("read_model_aliases", { stem });
          if (acfg && typeof acfg.defaultModel === "string") {
            d = acfg.defaultModel;
            globalDefaultModel = d;
          }
        } catch (_) {}
      }
      return d || "";
    };
    const hasOpt = (v) => v && Array.from(select.options).some(o => o.value === v);

    let target = "";
    let syncAgent = false;
    // Démarrage / redémarrage : le defaultModel global gouverne (priorité).
    if (forceDefault) {
      const d = await resolveDefault();
      if (hasOpt(d)) { target = d; syncAgent = true; }
    }
    // Sinon, modèle de la session active (agent déjà lancé).
    if (!target) {
      try {
        const agentState = await invoke("get_agent_state");
        if (agentState && agentState.data && agentState.data.model) {
          const cur = (agentState.data.model.provider || "") + "/" + (agentState.data.model.id || "");
          if (hasOpt(cur)) target = cur;
        }
      } catch (_) {}
    }
    // Dernier fallback : defaultModel global.
    if (!target) {
      const d = await resolveDefault();
      if (hasOpt(d)) target = d;
    }
    if (target) {
      select.value = target;
      if (st) st.currentModel = target;
      // Synchroniser l'agent si on a forcé le defaultModel (redémarrage).
      if (syncAgent) {
        const idx = target.indexOf("/");
        const provider = idx >= 0 ? target.slice(0, idx) : "";
        const modelId = idx >= 0 ? target.slice(idx + 1) : "";
        if (provider && modelId) {
          try { await invoke("set_agent_model", { provider, modelId }); } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.error("Erreur chargement modèles:", err);
  }
}

// Rafraîchit les stats (tokens / contexte / coût) pendant le streaming, au plus
// une fois toutes les 3 s et sans chevauchement d'appels (issue #2 : la jauge de
// contexte n'était pas mise à jour pendant une longue réflexion, d'où des
// compactages surprenants alors que l'affichage montrait un contexte faible).
function maybeRefreshStats(state) {
  if (!state.isStreaming) return;
  if (state.statsRefreshPending) return;
  const now = Date.now();
  if (now - (state.lastStatsRefresh || 0) < 3000) return;
  state.statsRefreshPending = true;
  state.lastStatsRefresh = now;
  updateStats().finally(() => { state.statsRefreshPending = false; });
}

async function updateStats() {
  const statsEl = document.getElementById("agent-stats");
  if (!statsEl) return;
  try {
    const stats = await invoke("get_agent_state");
    // get_agent_state retourne les données de la session
    if (stats && stats.data) {
      const d = stats.data;
      const model = d.model ? `${d.model.provider}/${d.model.id}` : "?";
      // Tenter d'obtenir les stats détaillées
      try {
        const detailedStats = await invoke("get_session_stats");
        if (detailedStats && detailedStats.data) {
          const ds = detailedStats.data;
          const tokens = ds.tokens?.total || 0;
          const cost = ds.cost || 0;
          const tokStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens;
          const ctxUsage = ds.contextUsage;
          const ctxPercent = ctxUsage?.percent;
          const ctxTokens = ctxUsage?.tokens;
          const ctxWindow = ctxUsage?.contextWindow;
          let ctxStr = '?%';
          if (ctxPercent != null) {
            const pct = Number(ctxPercent).toFixed(1);
            if (ctxTokens != null && ctxWindow != null) {
              const usedStr = ctxTokens >= 1000 ? `${(ctxTokens / 1000).toFixed(1)}k` : ctxTokens;
              const totalStr = ctxWindow >= 1000 ? `${(ctxWindow / 1000).toFixed(0)}k` : ctxWindow;
              ctxStr = `${pct}% (${usedStr}/${totalStr})`;
            } else {
              ctxStr = `${pct}%`;
            }
          }
          statsEl.textContent = `${model} | ${tokStr} tokens | $${cost.toFixed(2)} | ctx ${ctxStr}`;
          statsEl.title = `Tokens: ${tokens} entrée/sortie/cache | Coût: $${cost.toFixed(4)} | Contexte: ${ctxStr}`;
          return;
        }
      } catch (_) {
        // get_session_stats pas encore implémenté comme commande séparée
      }
      // Fallback : afficher juste le modèle et le nombre de messages
      const msgCount = d.messageCount || 0;
      statsEl.textContent = `${model} | ${msgCount} msg`;
    }
  } catch (_) {
    statsEl.textContent = "";
  }
}

/**
 * H9 (spec_session_history.md) : capture live de la session courante dans
 * l'index `.pilot/sessions.jsonl`. Appelé à l'agent_end (chat standard).
 * Récupère l'id de session pi via `list_sessions` (top = la plus récente,
 * = session courante si --no-session désactivé). En --no-session, aucune
 * session n'est persistée → pas d'indexation (cohérent).
 *
 * @param {object} state - état du chat agent
 * @param {string[]} filesThisTurn - fichiers touchés ce tour (write/edit, déjà collectés)
 */
async function captureSessionHistory(state, filesThisTurn) {
  try {
    const sessions = await invoke("list_sessions");
    if (!sessions || !sessions.length) return; // --no-session ou projet sans session pi
    const top = sessions[0];
    const id = top && top.id;
    if (!id) return;

    // Stats tokens/coût cumulées de la session.
    let tokens = null;
    let cost = null;
    try {
      const ds = await invoke("get_session_stats");
      const d = ds && ds.data;
      if (d) {
        if (d.tokens && typeof d.tokens.total === "number") tokens = d.tokens.total;
        if (typeof d.cost === "number") cost = d.cost;
      }
    } catch (_) {}

    await recordCurrentSession({
      id,
      model: state.currentModel || "",
      prompt: (state.lastUserPrompt || "").slice(0, 500),
      summary: (state.lastAssistantRawText || "").slice(0, 300),
      files: filesThisTurn || [],
      tokens,
      cost,
      turns: 1,
      origin: state.lastPromptOrigin || null,
      kind: "chat",
    });
  } catch (e) {
    console.error("captureSessionHistory:", e);
  }
}

/**
 * Vérifie au démarrage que le modèle actif est joignable.
 * Détecte un modèle par défaut local (llama-cpp/ollama sur localhost) dont le
 * serveur n'est pas démarré, et avertit l'utilisateur AVANT qu'il ne tape un
 * prompt qui échouerait en silence (« ça répond pas »).
 * Le test se limite aux URLs locales (localhost/127.0.0.1/0.0.0.0) pour éviter
 * les faux négatifs réseau sur les backends distants/cloud.
 */
async function checkDefaultModelReachable(st, messagesEl) {
  if (!messagesEl) return;
  let baseUrl;
  let modelLabel;
  try {
    const agentState = await invoke("get_agent_state");
    const model = agentState && agentState.data && agentState.data.model;
    if (!model) return;
    baseUrl = model.baseUrl || "";
    modelLabel = `${model.provider || "?"}/${model.id || model.name || "?"}`;
    if (!baseUrl) return;
  } catch (_) {
    return;
  }
  // Ne tester que les endpoints locaux (évite le bruit sur backends cloud).
  if (!/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(baseUrl)) {
    return;
  }
  let result;
  try {
    result = await invoke("check_model_reachable", { url: baseUrl });
  } catch (e) {
    console.warn("check_model_reachable indisponible:", e);
    return;
  }
  if (result && result.reachable === false) {
    const port = (baseUrl.match(/:(\d+)(?:\/|$)/) || [])[1] || "?";
    appendSystemMessage(
      messagesEl,
      `⚠️ Le modèle actif **${modelLabel}** pointe vers ${baseUrl} mais le serveur ne répond pas (port ${port} injoignable${result.error ? ` : ${result.error}` : ""}). Démarrez le serveur, ou sélectionnez un autre modèle dans la liste déroulante. Sinon les prompts échoueront en silence.`
    );
  }
}

// ── Gestion des événements RPC ──

// ── Diff Review (A4 V2) : helper module-level ──
/** Chemin relatif au projet (pour l'affichage). */
function toRelPath(abs) {
  const base = (window._pilotProjectPath || "").replace(/[\\/]+$/, "");
  if (base && abs && abs.startsWith(base)) return abs.slice(base.length).replace(/^[\\/]+/, "");
  return abs;
}

async function handleRpcEvent(payload, messagesEl, state, statusEl, parsePlanFn, orchFns) {
  const type = payload.type;

  // Message utilisateur tapé à distance (mode remote) : pi n'émet pas d'event
  // "user message" en streaming, le backend le signale donc explicitement pour
  // que le desktop affiche le prompt distant dans la conversation (spec remote).
  if (type === "user_message" && typeof payload.text === "string" && payload.text) {
    // D1 : mémoriser l'origine du prompt (source envoyée par le backend Rust —
    // "remote" pour un prompt web, "desktop" pour un prompt local). Sert à
    // déclencher une notification desktop native à l'agent_end si le prompt
    // venait du téléphone. Reset à null après notification pour ne pas renotifier.
    state.lastPromptOrigin = payload.source || "desktop";
    const el = appendUserMessage(messagesEl, payload.text);
    if (el && payload.source === "remote") el.classList.add("agent-message-remote");
    return;
  }

  // ── Garde anti-pollution pendant un test de modèle (popup d'activation orchestration) ──
  // Les événements du prompt de test "OK" sont captés par un listener dédié dans
  // testModelResponds ; on ne doit pas les traiter ici (sinon bulles parasites).
  if (state.modelTestActive) return;

  // ── Diagnostic temporaire : logger la séquence d'événements en mode orchestration ──
  if (state.orchestrationEnabled) {
    let detail = '';
    if (type === 'message_update' && payload.assistantMessageEvent) {
      detail = ' / subtype=' + payload.assistantMessageEvent.type;
    } else if (type === 'message' && payload.message) {
      detail = ' / role=' + payload.message.role + ' / stopReason=' + payload.message.stopReason
        + ' / content=' + (Array.isArray(payload.message.content) ? '[' + payload.message.content.map(c=>c.type).join(',') + ']' : (typeof payload.message.content === 'string' ? payload.message.content.length + ' car.' : '-'));
    }
    console.log(`[orch-event] ${type}${detail} | rawText.len=${(state.lastAssistantRawText||'').length} | running=${state.orchestrationRunning} plan=${!!state.orchestrationPlan}`);
  }

  // ── Garde anti-événements résiduels en mode orchestration (point 5.7) ──
  // Si pi envoie un turnId, on vérifie qu'il correspond au tour actif.
  if (state.orchestrationEnabled && state.orchestrationRunning && payload.turnId != null && payload.turnId !== state.orchestrationTurnId) {
    console.warn(`[orch-event] événement résiduel ignoré (turnId=${payload.turnId}, actif=${state.orchestrationTurnId})`);
    return;
  }
  // En mode orchestration, ignorer les deltas/outils/agent_end si aucun tour n'est
  // censé être en cours (ni streaming, ni début de message attendu). Les événements
  // de compaction (compaction_start/compaction_end/compaction) sont exemptés : ils
  // peuvent survenir entre deux tours (avant que pi ne traite le prompt suivant) et
  // doivent être traités pour la logique de reprise (§11.8).
  const isStartEvent = type === "agent_start" || type === "message_start" || type === "message_update";
  const isCompactionEvent = type === "compaction_start" || type === "compaction_end" || type === "compaction";
  if (state.orchestrationEnabled && state.orchestrationRunning && !state.isStreaming && !isStartEvent && !isCompactionEvent) {
    console.warn(`[orch-event] événement ${type} ignoré : aucun tour actif`);
    return;
  }

  // ── Routage vers l'inline completion si une requête est en cours ──
  const inlineActive = window._pilotInlineComplete && window._pilotInlineComplete.isRequesting();

  if (inlineActive) {
    switch (type) {
      case "message_update": {
        // Les deltas de texte de pi arrivent via assistantMessageEvent
        const delta = payload.assistantMessageEvent;
        if (delta && delta.type === "text_delta" && delta.delta) {
          window._pilotInlineComplete.handleDelta(delta.delta);
        }
        // Ignorer silencieusement les autres sous-événements (thinking, tool calls)
        return;
      }
      case "message_start": {
        // Marquer le début — ne pas créer de bulle dans le chat
        return;
      }
      case "message_end": {
        // Fin du message — ne pas finaliser dans le chat
        return;
      }
      case "agent_end":
        window._pilotInlineComplete.handleEnd();
        state.isStreaming = false;
        statusEl.textContent = "Prêt";
        statusEl.className = "agent-status agent-status-idle";
        // Ne PAS afficher dans le chat — la réponse inline a été routée
        state.currentAssistantBlock = null;
        state.currentTextBlock = null;
        return;
      case "agent_start":
        state.isStreaming = true;
        statusEl.textContent = "✨ Complétion...";
        statusEl.className = "agent-status agent-status-streaming";
        return;
      case "extension_error":
        window._pilotInlineComplete.handleError(payload.message || "Erreur inline");
        state.isStreaming = false;
        statusEl.textContent = "Prêt";
        statusEl.className = "agent-status agent-status-idle";
        return;
      default:
        // Autres événements (tool_execution_*, thinking_*, etc.) : ignorer silencieusement
        return;
    }
  }

  // ── Traitement normal (chat) ──
  switch (type) {
    case "agent_start":
      state.isStreaming = true;
      state.lastStopReason = "";  // réinit pour la détection de troncation (length) à l'agent_end
      // Issue #2 : forcer un rafraîchissement des stats dès le 1er delta du tour.
      state.lastStatsRefresh = 0;
      state.statsRefreshPending = false;
      // Sécurité : si une compaction a été interrompue sans compaction_end,
      // isCompacting pourrait être resté true → reset pour ne pas filtrer les
      // deltas du nouveau tour.
      state.isCompacting = false;
      // Reprise post-compaction : pi a démarré un nouveau tour → annuler la reprise.
      if (state.orchestrationCompactionResumePending) {
        state.orchestrationCompactionResumePending = false;
        if (state.orchestrationCompactionTimer) { clearTimeout(state.orchestrationCompactionTimer); state.orchestrationCompactionTimer = null; }
      }
      // En mode orchestration, préfixer le statut avec le rôle actif (Orchestrateur/Codeur)
      const orchRolePrefix =
        state.orchestrationEnabled && state.orchestrationActiveRole
          ? (state.orchestrationActiveRole === "orchestrator" ? "🧠 Orchestrateur — " : "🔨 Codeur — ")
          : "";
      statusEl.textContent = orchRolePrefix + "🤔 Réflexion...";
      statusEl.className = "agent-status agent-status-streaming";
      // Mode Orchestration : démarrer le chronométrage de la tâche courante (point N)
      if (state.orchestrationEnabled && state.orchestrationRunning) {
        state.orchestrationTaskStartTime = Date.now();
        state.orchestrationResponseChars = 0;
      }
      break;

    case "agent_end":
      // D1 (spec_web_remote.md) : notification desktop native si le prompt venait
      // du web (mode remote) — l'utilisateur a lancé une tâche depuis son
      // téléphone et veut être prévenu sur le desktop quand l'agent a terminé.
      // Reset immédiat pour ne pas renotifier sur l'agent_end suivant (un prompt
      // desktop ne doit pas notifier). Le reset évite aussi les fausses notifs
      // sur un agent_end parasite sans prompt préalable.
      if (state.lastPromptOrigin === "remote") {
        notifyAgentDoneFromRemote();
        state.lastPromptOrigin = null;
      }
      state.isStreaming = false;
      state.pendingRender = false;
      // Reprise post-compaction : pi a terminé normalement → annuler la reprise.
      if (state.orchestrationCompactionResumePending) {
        state.orchestrationCompactionResumePending = false;
        if (state.orchestrationCompactionTimer) { clearTimeout(state.orchestrationCompactionTimer); state.orchestrationCompactionTimer = null; }
      }
      // Finaliser le bloc assistant en cours
      if (state.currentAssistantBlock) {
        if (state.pendingText) {
          finalizeTextBlock(state);
        }
        // Si la bulle assistant est vide (contenu invisible, pas d'erreur), la retirer
        const bubble = getBubbleTarget(state.currentAssistantBlock);
        const flow = bubble?.querySelector(".agent-stream-flow");
        if (flow && flow.children.length === 0) {
          state.currentAssistantBlock.remove();
        }
      } else {
        // agent_start a été émis mais aucun message_start → pas de contenu visible, rien à afficher
      }
      statusEl.textContent = "Prêt";
      statusEl.className = "agent-status agent-status-idle";
      state.currentAssistantBlock = null;
      state.currentTextBlock = null;
      state.currentThinkingBlock = null;
      // H9 (spec_session_history.md) : capturer les fichiers touchés ce tour
      // avant le clear des tool calls (write/edit), pour l'index live de l'historique.
      const _h9Files = [];
      state.pendingToolCalls.forEach((tc) => {
        const name = String(tc && tc.name || "").toLowerCase();
        if (name === "write" || name === "edit") {
          const a = (tc && tc.args) || {};
          const p = a.path || a.file_path || a.filePath || a.filename;
          if (p) {
            const rel = String(p).replace(/\\/g, "/");
            if (!_h9Files.includes(rel)) _h9Files.push(rel);
          }
        }
      });
      state.currentToolBlocks.clear();
      state.pendingToolCalls.clear();
      state.pendingText = "";
      // Mettre à jour les stats
      updateStats();

      // H9 : capture live de la session (chat standard hors orchestration).
      // Fire-and-forget : ne bloque pas le rendu. En orchestration, la capture
      // est gérée séparément (les sessions pi d'orchestration sont rétro-indexables).
      if (!state.orchestrationEnabled) {
        captureSessionHistory(state, _h9Files).catch((e) =>
          console.error("captureSessionHistory:", e)
        );
      }

      // ── Chat standard : finalisation d'une rafale de retries de connexion ──
      // Si auto_retry_start a été reçu, soit le retry a réussi (une réponse a
      // été générée → lastAssistantRawText non vide) et on retire simplement le
      // bloc « 🔄 nouvelle tentative », soit les retries sont épuisés sans
      // réponse → on transforme le bloc en message d'erreur + bouton « Réessayer »
      // (sans cela, l'agent se fige sans retour et l'utilisateur doit re-soumettre
      // manuellement son prompt).
      if (!state.orchestrationEnabled && state.connRetryActive) {
        const hadResponse = !!(state.lastAssistantRawText && state.lastAssistantRawText.trim());
        const block = state.connRetryBlock;
        if (hadResponse) {
          if (block) block.remove();
        } else {
          renderConnErrorFinalBlock(state, messagesEl, block);
        }
        state.connRetryActive = false;
        state.connRetryBlock = null;
        state.connErrorCount = 0;
      }

      // Mode Orchestration : gérer la fin d'une tâche
      if (state.orchestrationEnabled && state.orchestrationRunning) {
        orchFns.handleOrchestrationAgentEnd(state, messagesEl, statusEl);
      } else if (state.orchestrationEnabled && state.orchestrationPlan && !state.orchestrationRunning) {
        // Diagnostic : un plan existe mais orchestrationRunning est false à la fin
        // d'une réponse — c'est anormal (le codeur vient de répondre mais le plan
        // n'avance pas). Voir spec_orchestration_observability.md.
        appendSystemMessage(messagesEl, `⚠️ [diagnostic] Réponse reçue mais le plan est inactif (running=false, paused=${state.orchestrationPaused}, planId=${state.orchestrationPlan.progress?.current_task}). Clique ▶️ pour reprendre.`);
      } else if (state.orchestrationEnabled && !state.orchestrationPlan && !state.orchestrationRunning) {
        // L'orchestrateur vient de répondre — essayer de parser le plan
        const rawText = state.lastAssistantRawText || '';
        const parsedPlan = parsePlanFn(rawText) || {};
        let plan = parsedPlan.plan || null;
        let globalDirective = parsedPlan.globalDirective || null;
        // Fallback DOM si rawText est vide/tronqué
        if (!plan || plan.length === 0) {
          const lastBubble = messagesEl.querySelector('.agent-bubble-assistant:last-child');
          if (lastBubble) {
            const domText = lastBubble.textContent || '';
            const parsedDom = parsePlanFn(domText) || {};
            plan = parsedDom.plan || null;
            globalDirective = globalDirective || parsedDom.globalDirective || null;
          }
        }
        if (plan && plan.length > 0) {
          // Plan JSON valide → exécution
          state.orchestrationJsonRetries = 0;
          // V3 (Bug 5) : valider la qualité du plan AVANT de le construire.
          // On utilise le VRAI prompt utilisateur (mémorisé à l'envoi) et non la
          // réponse de l'orchestrateur, sinon le critère « promptLen » est toujours vrai.
          const userPromptForValidation = state.orchestrationLastUserPrompt || rawText || "";
          const v = orchFns.validatePlan(plan, userPromptForValidation);
          if (v.severity === "reject" && v.warnings.some((w) => w.includes("découpage manifestement insuffisant"))) {
            // Plan manifestement trop grossier → demander un re-plan (max 1)
            const replanRetries = state.orchestrationPlanReplanRetries || 0;
            if (replanRetries < 1) {
              state.orchestrationPlanReplanRetries = replanRetries + 1;
              appendSystemMessage(messagesEl, `⚠️ Plan trop grossier : ${v.warnings.join(" ")} Demande de re-découpage à l'orchestrateur (1re et unique tentative)...`);
              try {
                await invoke("send_agent_prompt", {
                  message: `Ton plan est trop grossier : ${v.warnings.join(" ")} Re-découpe-le en respectant STRICTEMENT : max 2 fichiers par tâche, ~30-60 lignes, vise 5 à 25 tâches selon l'ampleur. Réponds UNIQUEMENT avec le JSON du plan au format {"global_directive": "...", "plan": [...]}.`
                });
              } catch (e) {
                console.error("Erreur envoi re-plan:", e);
                appendErrorMessage(messagesEl, `❌ Erreur lors de la demande de re-plan : ${e}`);
              }
              return; // on attend la nouvelle réponse de l'orchestrateur
            } else {
              appendSystemMessage(messagesEl, `⚠️ Plan toujours grossier après 1 re-plan. Exécution quand même (la subdivision auto corrigera les tâches trop grandes en cas d'échec).`);
            }
          } else if (v.severity === "warn") {
            appendSystemMessage(messagesEl, `⚠️ Qualité du plan :\n${v.warnings.map(w => `• ${w}`).join("\n")}\n_(L'exécution continue ; si les tâches s'avèrent trop grossières, elles seront subdivisées automatiquement après 2 échecs.)_`);
          }
          state.orchestrationPlan = {
            plan: plan,
            global_directive: globalDirective,
            progress: { current_task: 0, completed: [], failed: [], escalated: [], retrying: [], task_attempts: {}, task_metrics: {}, subdivided: [], task_logs: {} }
          };
          state.orchestrationRunning = true;
          state.orchestrationRevising = false;
          state.orchestrationSubdividing = false;
          state.orchestrationSubdividingTaskId = null;
          state.orchestrationExtractingMemory = null;
          state.orchestrationTasksSinceRevision = 0;
          orchFns.renderOrchestrationPlan(messagesEl, state);
          appendSystemMessage(messagesEl, `📋 Plan reçu avec ${plan.length} tâches. Démarrage de l'exécution...`);
          try { await invoke("save_plan", { planJson: JSON.stringify(state.orchestrationPlan, null, 2) }); } catch (_) {}
          state.orchestrationTasksInBatch = 0;
          await orchFns.executeNextTask(messagesEl, state, statusEl);
        } else {
          // Pas de plan JSON — soit réponse texte, soit JSON invalide
          const responseText = rawText || (messagesEl.querySelector('.agent-bubble-assistant:last-child')?.textContent || '');
          const isPlainText = !responseText.includes('{') && !responseText.includes('"plan"');
          if (isPlainText) {
            // Réponse texte de l'orchestrateur (question simple) — ne pas lancer de plan
            state.orchestrationJsonRetries = 0;
            console.log('[orchestration] Réponse texte de l\'orchestrateur (pas de plan nécessaire).');
          } else if (!state.orchestrationConnErrorSeen) {
            // JSON invalide — auto-retry (max 2 tentatives)
            const retries = (state.orchestrationJsonRetries || 0);
            if (retries < 2) {
              state.orchestrationJsonRetries = retries + 1;
              console.warn(`[orchestration] JSON invalide, tentative ${retries + 1}/2. Envoi d\'une demande de correction...`);
              appendSystemMessage(messagesEl, `🔄 JSON invalide (tentative ${retries + 1}/2). Demande de correction à l\'orchestrateur...`);
              try {
                await invoke("send_agent_prompt", {
                  message: "Le json renvoyé n'est pas bon, recommence"
                });
              } catch (e) {
                console.error("Erreur envoi correction JSON:", e);
                appendErrorMessage(messagesEl, `❌ Erreur lors de la demande de correction : ${e}`);
              }
            } else {
              // 2 tentatives échouées — afficher l'erreur
              state.orchestrationJsonRetries = 0;
              const preview = responseText.slice(0, 400);
              console.warn('[orchestration] JSON invalide après 2 tentatives.', '\n--- response ---\n' + responseText);
              appendSystemMessage(messagesEl, `⚠️ L\'orchestrateur n\'a pas retourné de plan valide après 2 tentatives.\nDébut réponse :\n${preview.replace(/\n/g, ' ').slice(0, 300)}\n—\nVérifiez la console (F12) pour le détail complet. Réessayez ou reformulez votre demande.`);
            }
          }
        }
      }
      // ── Chat standard : relance auto après réponse tronquée (stopReason:"length") ──
      // Les modèles locaux (ex. gemma 12B) qui écrivent de gros fichiers via un
      // tool call "write" se font couper par la limite de tokens de sortie : le
      // tool call est tronqué, pi le rejette ("hit the output token limit"), puis
      // le modèle produit souvent une réponse vide et s'arrête. Sans relance,
      // l'utilisateur croit que l'agent « s'est arrêté pour rien » et doit taper
      // « ok » à la main. On reproduit ce nudge automatiquement (max 2), comme en
      // mode orchestration (detectReflectionOnly). Cf. session pi 019f85e4.
      if (!state.orchestrationEnabled && state.lastStopReason === "length") {
        const MAX_LENGTH_NUDGES = 2;
        state.lengthNudgeAttempts = (state.lengthNudgeAttempts || 0) + 1;
        if (state.lengthNudgeAttempts <= MAX_LENGTH_NUDGES) {
          appendSystemMessage(messagesEl,
            `✂️ Réponse tronquée (limite de tokens de sortie atteinte). Relance automatique (${state.lengthNudgeAttempts}/${MAX_LENGTH_NUDGES})…`);
          try {
            await invoke("send_agent_prompt", {
              message: "Ta réponse précédente a été coupée par la limite de tokens de sortie. Reprends exactement là où tu t'es arrêté."
            });
          } catch (e) {
            console.error("Erreur relance auto (length):", e);
            appendErrorMessage(messagesEl, `❌ Erreur lors de la relance auto : ${e}`);
          }
        } else {
          appendSystemMessage(messagesEl,
            "✂️ Réponse toujours tronquée après 2 relances auto. Augmente la limite de tokens de sortie (max_tokens) ou relance manuellement avec « continue ».");
        }
      }
      // Réinitialiser le texte brut APRÈS le parsing
      state.lastAssistantRawText = "";
      break;

    case "turn_start":
      // Un nouveau tour commence — pas d'action nécessaire
      break;

    case "turn_end":
      // Fin d'un tour
      break;

    case "message": {
      // Message complet (non streamé) — ex: erreur de connexion ollama
      const msg = payload.message;
      if (!msg) break;

      if (msg.role === "user") {
        // Déjà affiché via l'envoi local
      } else if (msg.role === "assistant") {
        // Réutiliser la bulle existante si on est dans le même tour d'agent
        if (!state.currentAssistantBlock) {
          state.currentAssistantBlock = createAssistantBlock(messagesEl);
        }
        const blk = state.currentAssistantBlock;
        state.currentTextBlock = null;
        state.currentThinkingBlock = null;
        state.pendingText = "";
        state.lastStopReason = msg.stopReason || "";
        // Ne PAS réinitialiser lastAssistantRawText ici : il est déjà remis à zéro
        // dans message_start (streamé) ou va être rempli ci-dessous (non streamé).
        // Le garder vide empêche handleOrchestrationAgentEnd de voir la réponse.

        if (msg.stopReason === "error" && msg.errorMessage) {
          // Dé-duplication (chat standard) : si pi est en rafale de retries
          // (auto_retry_start reçu), le bloc « 🔄 nouvelle tentative » suffit —
          // ne pas empiler un ❌ par retry échoué. On garde juste isStreaming=false.
          if (!state.orchestrationEnabled && state.connRetryActive) {
            state.isStreaming = false;
          } else {
            const friendlyMsg = msg.errorMessage === "Connection error."
              ? "Erreur de connexion, vérifiez votre connexion à l'API"
              : msg.errorMessage;
            appendTextSection(blk, `❌ **Erreur** : ${friendlyMsg}`);
            statusEl.textContent = "Erreur";
            statusEl.className = "agent-status agent-status-error";
            state.isStreaming = false;
            // ── Détection modèle injoignable en mode Orchestration (option 1) ──
            // Une erreur de connexion pendant l'exécution du plan (ex: serveur
            // llama-cpp éteint) ne doit pas être confondue avec un échec de tâche
            // normal — sinon la validation post-tâche peut marquer la tâche
            // « effectuée » à tort. On met le plan en pause avec un message clair.
            if (state.orchestrationEnabled && state.orchestrationRunning) {
              orchFns.handleOrchestrationConnectionError(state, messagesEl);
            }
          }
        } else if (msg.stopReason === "aborted") {
          appendTextSection(blk, "⏹️ Agent arrêté");
          statusEl.textContent = "Arrêté";
          statusEl.className = "agent-status agent-status-idle";
          state.isStreaming = false;
        } else if (Array.isArray(msg.content) && msg.content.length > 0) {
          // Remplir lastAssistantRawText pour le mode orchestration (non streamé)
          let fullText = "";
          let lastTextSection = null; // tracker pour fermer avant thinking/tool (ordre chronologique)
          for (const part of msg.content) {
            if (part.type === "text" && part.text) {
              // reuse=true : les parts text consécutives fusionnent (continuité de paragraphe)
              lastTextSection = appendTextSection(blk, part.text);
              fullText += part.text;
            } else {
              // Fermer la section texte courante avant d'insérer une pensée ou un
              // outil, pour préserver l'ordre chronologique (sinon le prochain
              // text serait réinjecté dans la section précédente, au-dessus du
              // tool/thinking). Cf. spec_rpc § affichage streamé.
              if (lastTextSection) {
                closeTextSection(lastTextSection);
                lastTextSection = null;
              }
              if (part.type === "thinking" && part.thinking) {
                appendThinkingSection(blk, part.thinking);
              } else if ((part.type === "toolCall" || part.type === "tool_call") && part.name) {
                appendToolBlock(blk, part.name, part.arguments || part.args || {});
              }
            }
          }
          if (fullText) state.lastAssistantRawText = fullText;
          // Fermer la dernière section texte (évite la réutilisation par un
          // message complet suivant dans la même bulle, qui y réinjecterait son
          // contenu au-dessus des outils/pensées).
          if (lastTextSection) {
            closeTextSection(lastTextSection);
            lastTextSection = null;
          }
          // Nettoyer les blocs thinking vides (contenu «{}»  ou vide)
          const thinkingBlocks = blk.querySelectorAll(".agent-thinking");
          for (const tb of thinkingBlocks) {
            const contents = tb.querySelectorAll(".agent-thinking-content");
            const hasVisibleContent = Array.from(contents).some(el => el.textContent.trim().length > 0);
            if (!hasVisibleContent) tb.remove();
          }
          // Nettoyer les blocs outil vides (sans détail utile)
          const toolInlines = blk.querySelectorAll(".agent-tool-inline");
          for (const ti of toolInlines) {
            const code = ti.querySelector("code");
            if (code && code.textContent.trim() === "") ti.remove();
          }
          const toolBlocks = blk.querySelectorAll(".agent-tool-block");
          for (const tb of toolBlocks) {
            const cmds = tb.querySelector(".agent-tool-cmds");
            if (cmds && cmds.textContent.trim() === "") tb.remove();
          }
          // Si la bulle est vide après rendu (pas de texte, outils masqués), la retirer
          const bubble = getBubbleTarget(blk);
          const flow = bubble?.querySelector(".agent-stream-flow");
          if (flow && flow.children.length === 0) {
            blk.remove();
          }
        } else if (typeof msg.content === "string" && msg.content) {
          appendTextSection(blk, msg.content);
          state.lastAssistantRawText = msg.content;
        }
      } else if (msg.role === "toolResult" && (showToolsEnabled || msg.isError)) {
        // Afficher le résultat d'outil dans la bulle assistant en cours.
        // Les résultats en erreur (ex. tool call tronqué par la limite de tokens
        // de sortie) sont affichés même si les outils sont masqués : sinon
        // l'utilisateur ne voit pas pourquoi l'agent « s'arrête » sans raison.
        const targetBlk = state.currentAssistantBlock || (() => {
          const blk = createAssistantBlock(messagesEl);
          state.currentAssistantBlock = blk;
          return blk;
        })();
        const output = extractToolResultText(msg);
        if (output) {
          const toolName = msg.toolName || "";
          if (toolName) {
            appendToolResult(targetBlk, toolName, output);
          }
        }
      }
      break;
    }

    case "message_start": {
      const msg = payload.message;
      if (!msg) break;

      if (msg.role === "user") {
        // Déjà affiché via l'envoi local
      } else if (msg.role === "assistant") {
        // Réutiliser la bulle existante si on est dans le même tour d'agent
        if (!state.currentAssistantBlock) {
          state.currentAssistantBlock = createAssistantBlock(messagesEl);
        }
        state.currentTextBlock = null;
        state.currentThinkingBlock = null;
        state.pendingText = "";
        state.pendingRender = false;
        state.lastAssistantRawText = "";
      }
      break;
    }

    case "message_update": {
      const delta = payload.assistantMessageEvent;
      if (!delta) break;
      // Filtre anti-pollution : pendant une compaction, plh stream le résumé en
      // text_delta. Ce texte n'est PAS la réponse du codeur — il ne doit pas
      // être accumulé dans lastAssistantRawText (parsing orchestration) ni
      // affiché comme une réponse. Le résumé est affiché via appendCompactionSummary
      // sur compaction_end. On ignore donc tous les deltas pendant isCompacting.
      if (state.isCompacting) break;

      // Issue #2 : rafraîchir la jauge de contexte/tokens pendant le streaming
      // (couvre text_delta ET thinking_delta) pour ne plus être surpris par les
      // compactages lors d'une longue réflexion.
      maybeRefreshStats(state);

      switch (delta.type) {
        case "text_start":
          state.currentTextBlock = appendTextSection(state.currentAssistantBlock, "");
          state.pendingText = "";
          state.pendingRender = false;
          break;

        case "text_delta":
          state.pendingText += delta.delta || "";
          state.lastAssistantRawText += delta.delta || "";
          // Comptage des caractères de réponse pour les métriques (point N)
          if (state.orchestrationEnabled && state.orchestrationRunning) {
            state.orchestrationResponseChars = (state.orchestrationResponseChars || 0) + (delta.delta ? delta.delta.length : 0);
          }
          // Reset du timer d'inactivité du codeur en mode orchestration (point B)
          if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
            orchFns.resetIdleTimer(state, messagesEl, statusEl);
          }
          // Reprise post-compaction : pi génère à nouveau → annuler la reprise.
          if (state.orchestrationCompactionResumePending) {
            state.orchestrationCompactionResumePending = false;
            if (state.orchestrationCompactionTimer) { clearTimeout(state.orchestrationCompactionTimer); state.orchestrationCompactionTimer = null; }
          }
          if (!state.currentTextBlock || state.currentTextBlock.dataset.closed) {
            state.currentTextBlock = appendTextSection(state.currentAssistantBlock, "", false);
          }
          if (state.currentTextBlock) {
            // Throttling du rendu Markdown : un seul rendu par frame d'animation
            if (!state.pendingRender) {
              state.pendingRender = true;
              requestAnimationFrame(() => {
                state.pendingRender = false;
                if (state.currentTextBlock && state.pendingText) {
                  state.currentTextBlock.innerHTML = md.render(state.pendingText);
                }
                scrollToBottom(messagesEl);
              });
            }
          }
          break;

        case "text_end":
          // Annuler le rendu en attente et forcer le rendu final immédiat
          state.pendingRender = false;
          if (state.currentTextBlock && state.pendingText) {
            state.currentTextBlock.innerHTML = md.render(state.pendingText);
            scrollToBottom(messagesEl);
            // Détecter un changement de modèle dans la réponse
            const modelMatch = state.pendingText.match(/\[success\]\s*Modèle changé\s*:\s*(\S+)/);
            if (modelMatch) {
              state.currentModel = modelMatch[1];
              const select = document.getElementById("agent-model-select");
              if (select) {
                const opt = Array.from(select.options).find((o) => o.value === state.currentModel);
                if (opt) select.value = state.currentModel;
              }
              updateStats();
            }
          }
          state.pendingText = "";
          break;

        case "thinking_start":
          // Fermer la section texte courante pour préserver l'ordre chronologique
          if (state.currentTextBlock && !state.currentTextBlock.dataset.closed) {
            closeTextSection(state.currentTextBlock);
            state.currentTextBlock = null;
          }
          // allowEmpty=true : le bloc est créé vide, le contenu arrive via thinking_delta
          state.currentThinkingBlock = appendThinkingSection(state.currentAssistantBlock, "", true);
          scrollToBottom(messagesEl);
          break;

        case "thinking_delta":
          if (state.currentThinkingBlock) {
            if (showThinkingEnabled) {
              const contents = state.currentThinkingBlock.querySelectorAll(".agent-thinking-content");
              // Reset timer d'inactivite orchestration (pensée en cours, ne pas timeout).
              if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
                orchFns.resetIdleTimer(state, messagesEl, statusEl);
              }
              const contentEl = contents[contents.length - 1];
              if (contentEl) {
                contentEl.textContent += delta.delta || "";
              }
            } else {
              // Animation "pensée." → "pensée.." → "pensée..."
              const dotsEl = state.currentThinkingBlock.querySelector(".agent-thinking-dots");
              if (dotsEl) {
                const current = dotsEl.textContent;
                const dotsCount = (current.match(/\./g) || []).length;
                // Reset timer d'inactivite orchestration (pensée masquée en cours).
              if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
                orchFns.resetIdleTimer(state, messagesEl, statusEl);
              }
              const nextDots = dotsCount >= 3 ? 1 : dotsCount + 1;
                dotsEl.textContent = "pensée" + ".".repeat(nextDots);
              }
            }
          }
          scrollToBottom(messagesEl);
          break;

        case "thinking_end":
          // Nettoyer le bloc pensée
          if (state.currentThinkingBlock) {
            if (!showThinkingEnabled) {
              // Mode pensée masquée : supprimer le bloc
              state.currentThinkingBlock.remove();
              state.currentThinkingBlock = null;
            } else {
              // Mode pensée visible : vérifier si le contenu est vide
              const contents = state.currentThinkingBlock.querySelectorAll(".agent-thinking-content");
              const hasVisibleContent = Array.from(contents).some(el => el.textContent.trim().length > 0);
              if (!hasVisibleContent) {
                // Pas de contenu utile → supprimer le bloc pensée
                state.currentThinkingBlock.remove();
                state.currentThinkingBlock = null;
              }
            }
            // Ne pas supprimer la bulle ici — on la garde pour le message suivant du même tour.
            // La bulle sera nettoyée à agent_end si vide.
          }
          break;

        case "toolcall_start":
          // Reset du timer d'inactivite en mode orchestration (le codeur fait un
          // tool call read_file etc. — il ne faut pas le timeout pendant l'outil).
          if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
            orchFns.resetIdleTimer(state, messagesEl, statusEl);
          }
          // Ne pas afficher encore — on attend tool_execution_start pour avoir le vrai nom
          state.pendingToolCalls.set(delta.toolCallId || "unknown", {
            name: delta.toolName || "",
            args: delta.args || {}
          });
          break;

        case "toolcall_delta":
          // Reset du timer d'inactivite en mode orchestration (arguments de tool call en cours).
          if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
            orchFns.resetIdleTimer(state, messagesEl, statusEl);
          }
          // Mise à jour progressive des arguments — pour l'instant on ignore
          break;

        case "toolcall_end":
          // Tool call finalisé
          break;

        case "done":
          state.isStreaming = false;
          statusEl.textContent = "Prêt";
          statusEl.className = "agent-status agent-status-idle";
          break;

        case "error":
          state.isStreaming = false;
          statusEl.textContent = "Erreur";
          statusEl.className = "agent-status agent-status-error";
          // Injecter l'erreur dans la bulle assistant existante,
          // ou créer un bloc assistant si aucun n'existe
          const errText = (delta.reason === "Connection error." || delta.reason === "Connection error")
            ? "Erreur de connexion, vérifiez votre connexion à l'API"
            : (delta.reason || "Erreur agent");
          if (state.currentAssistantBlock) {
            appendTextSection(state.currentAssistantBlock, `❌ **Erreur** : ${errText}`);
          } else {
            const errBlk = createAssistantBlock(messagesEl);
            appendTextSection(errBlk, `❌ **Erreur** : ${errText}`);
          }
          break;
      }
      break;
    }

    case "message_end": {
      // Finaliser le texte si encore en streaming
      state.pendingRender = false;
      if (state.currentAssistantBlock && state.pendingText) {
        finalizeTextBlock(state);
      }
      // Nettoyer les blocs thinking vides
      if (state.currentThinkingBlock) {
        const contents = state.currentThinkingBlock.querySelectorAll(".agent-thinking-content");
        const hasVisibleContent = Array.from(contents).some(el => el.textContent.trim().length > 0);
        if (!hasVisibleContent) {
          state.currentThinkingBlock.remove();
          state.currentThinkingBlock = null;
        }
      }
      // ── Détection d'erreur/abort dans le flux streamé ──
      // plh/pi peuvent émettre un message_end avec stopReason:"error" + errorMessage
      // (ex: serveur LLM injoignable). Sans cette branche, l'erreur était silencieuse :
      // la bulle vide était retirée à agent_end → l'UI n'affichait rien ("ça répond pas").
      // Le cas non streamé (event "message") est déjà géré plus haut ; ici on couvre
      // le chemin streamé (message_start → message_update → message_end).
      const endMsg = payload.message;
      // Mémoriser le stopReason pour la détection de troncation (length) à l'agent_end
      state.lastStopReason = endMsg ? (endMsg.stopReason || "") : "";
      if (endMsg && endMsg.stopReason === "error" && endMsg.errorMessage) {
        const raw = endMsg.errorMessage || "";
        let friendlyMsg;
        if (raw === "Connection error.") {
          friendlyMsg = "Erreur de connexion, vérifiez votre connexion à l'API";
        } else if (/error sending request|Erreur HTTP|failed to connect|connection refused/i.test(raw)) {
          // Extraire l'URL si présente pour un message parlant
          const urlMatch = raw.match(/https?:\/\/[^\s")]+/);
          friendlyMsg = urlMatch
            ? `Serveur LLM injoignable (${urlMatch[0]}). Vérifiez que le serveur est démarré, ou sélectionnez un autre modèle.`
            : `Serveur LLM injoignable. Vérifiez que le serveur est démarré, ou sélectionnez un autre modèle. (${raw})`;
        } else {
          friendlyMsg = raw;
        }
        // Dé-duplication (chat standard) : pendant une rafale de retries pi,
        // le bloc « 🔄 nouvelle tentative » suffit — on n'empile pas un ❌ par
        // retry. On garde juste isStreaming=false (le bloc retry reste affiché).
        if (!state.orchestrationEnabled && state.connRetryActive) {
          state.isStreaming = false;
        } else {
          if (!state.currentAssistantBlock) {
            state.currentAssistantBlock = createAssistantBlock(messagesEl);
          }
          appendTextSection(state.currentAssistantBlock, `❌ **Erreur** : ${friendlyMsg}`);
          statusEl.textContent = "Erreur";
          statusEl.className = "agent-status agent-status-error";
          state.isStreaming = false;
          // Mode Orchestration : une erreur de connexion ne doit pas être confondue
          // avec un échec de tâche normal — on met le plan en pause avec un message.
          if (state.orchestrationEnabled && state.orchestrationRunning) {
            orchFns.handleOrchestrationConnectionError(state, messagesEl);
          }
        }
      }
      // Ne pas supprimer la bulle ici — on la garde pour le message suivant du même tour.
      // La bulle sera nettoyée à agent_end si vide.
      break;
    }

    case "tool_execution_start": {
      // Reprise post-compaction : pi exécute un outil = activité → annuler la reprise.
      if (state.orchestrationCompactionResumePending) {
        state.orchestrationCompactionResumePending = false;
        if (state.orchestrationCompactionTimer) { clearTimeout(state.orchestrationCompactionTimer); state.orchestrationCompactionTimer = null; }
      }
      // Reset timer d'inactivite orchestration (un outil s'execute — read_file etc.
      // peut etre long, il ne faut pas timeout pendant l'execution de l'outil).
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
        orchFns.resetIdleTimer(state, messagesEl, statusEl);
      }
      const toolId = payload.toolCallId;
      const toolName = payload.toolName || "";
      const toolArgs = payload.args || {};
      // Retirer des appels en attente
      state.pendingToolCalls.delete(toolId);
      if (!showThinkingEnabled && !showToolsEnabled) break;
      // Ne pas afficher si le nom est vide
      if (!toolName) break;
      // Fermer la section texte courante pour préserver l'ordre chronologique
      if (state.currentTextBlock && !state.currentTextBlock.dataset.closed) {
        closeTextSection(state.currentTextBlock);
        state.currentTextBlock = null;
      }
      const existingBlock = state.currentToolBlocks.get(toolId);
      if (!existingBlock) {
        const blk = appendToolBlock(state.currentAssistantBlock, toolName, toolArgs);
        if (blk) state.currentToolBlocks.set(toolId, blk);
      }
      scrollToBottom(messagesEl);
      // Reset du timer d'inactivité du codeur en mode orchestration (point B+)
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
        orchFns.resetIdleTimer(state, messagesEl, statusEl);
      }
      // Tracker les lectures de fichiers pertinentes pour la tâche courante (point 5.3)
      if (state.orchestrationEnabled && state.orchestrationRunning && toolName === "read_file") {
        const readPath = toolArgs.path || toolArgs.file || "";
        if (readPath) state.orchestrationReadFilesInTask.add(readPath);
      }
      // Tracker tous les outils utilisés pour enrichir les prompts de révision/escalade (point 5.10)
      if (state.orchestrationEnabled && state.orchestrationRunning && toolName) {
        state.orchestrationToolCallsInTask.push({
          name: toolName,
          args: toolArgs,
          timestamp: Date.now(),
        });
      }
      break;
    }

    case "tool_execution_update": {
      break;
    }

    case "tool_execution_end": {
      // Issue #2 : après un outil, le contexte utilisé a changé → rafraîchir.
      maybeRefreshStats(state);
      // Reset timer d'inactivite orchestration (un outil vient de finir — le codeur
      // va probablement reprendre, ne pas timeout maintenant).
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
        orchFns.resetIdleTimer(state, messagesEl, statusEl);
      }
      if (showToolsEnabled && state.currentAssistantBlock) {
        const toolName = payload.toolName || "";
        if (toolName) {
          const result = payload.result;
          const output = extractToolResultOutput(result);
          if (output) {
            appendToolResult(state.currentAssistantBlock, toolName, output);
            scrollToBottom(messagesEl);
          }
        }
      }
      // Reset du timer d'inactivité du codeur en mode orchestration (point B+)
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused) {
        orchFns.resetIdleTimer(state, messagesEl, statusEl);
      }
      break;
    }

    case "compaction_start":
      appendSystemMessage(messagesEl, `🧹 Compaction en cours... (raison: ${payload.reason || "?"})`);
      // Activer le filtre des deltas : pendant la compaction, le résumé est
      // streamé en message_update/text_delta par plh (contrairement à pi qui
      // ne stream pas le résumé). Il ne faut PAS accumuler ce texte dans
      // lastAssistantRawText (utilisé pour parser la réponse du codeur en
      // orchestration) — sinon le parsing de DONE / blocs search/replace
      // échoue → handleTaskFailure → boucle de retry → arrêt perçu.
      state.isCompacting = true;
      break;

    case "compaction_end": {
      const label = payload.aborted ? "⚠️ Compaction annulée" : "✅ Compaction terminée";
      appendSystemMessage(messagesEl, label);
      // Désactiver le filtre des deltas : la compaction est terminée, la vraie
      // réponse du codeur (post-compaction) doit être accumulée normalement.
      // On reset lastAssistantRawText pour que la réponse post-compaction
      // commence proprement (le résumé éventuellement accumulé par une fuite
      // de deltas ne pollue pas le parsing de DONE / blocs search/replace).
      state.isCompacting = false;
      state.lastAssistantRawText = "";
      state.pendingText = "";
      // Fermer le bloc texte courant pour que la réponse post-compaction
      // démarre dans une nouvelle section (séparation visuelle résumé/réponse).
      if (state.currentTextBlock) {
        state.currentTextBlock.dataset.closed = "true";
        state.currentTextBlock = null;
      }
      // Si un résumé est fourni dans compaction_end, l'afficher.
      // On l'attache à la bulle assistant courante (si un tour est en cours) pour
      // préserver la continuité visuelle : la réflexion du dessus reste dans la
      // même bulle, juste au-dessus du résumé repliable, au lieu d'être rejetée
      // dans une bulle précédente éloignée par le scrollToBottom.
      if (payload.summary && showThinkingEnabled) {
        const blk = state.currentAssistantBlock || createAssistantBlock(messagesEl);
        appendCompactionSummary(blk, payload.summary);
        scrollToBottom(messagesEl);
      }
      // ── Reprise après compaction auto (spec_orchestration.md §11.8) ──
      // pi peut ne pas reprendre la génération après une compaction auto en mode
      // RPC : le tour en cours est interrompu sans agent_end, ou le prompt en
      // attente n'est pas retraité. On démarre un timer de reprise : si aucune
      // activité (delta/agent_end/outil) n'arrive dans le délai, on abort et on
      // relance la tâche courante via executeNextTask (reprise propre, sans
      // marquer d'échec). Le flag est clearer par le 1er delta/agent_end/outil.
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused && !payload.aborted) {
        if (state.orchestrationCompactionTimer) clearTimeout(state.orchestrationCompactionTimer);
        state.orchestrationCompactionResumePending = true;
        // 10s en milieu de tour (laisser à pi le temps de reprendre) ; 2s entre
        // tours (isStreaming=false : pi a compacté avant de traiter le prompt).
        const delay = state.isStreaming ? 10000 : 2000;
        state.orchestrationCompactionTimer = setTimeout(() => {
          state.orchestrationCompactionTimer = null;
          if (!state.orchestrationCompactionResumePending) return;
          state.orchestrationCompactionResumePending = false;
          if (!state.orchestrationRunning || state.orchestrationPaused || !state.orchestrationPlan) return;
          appendSystemMessage(messagesEl, "🔁 Reprise du plan après compaction (pi n'a pas relancé automatiquement)...");
          // Couper un éventuel tour zombie, puis relancer la tâche courante.
          invoke("abort_agent").catch(() => {}).finally(() => {
            state.isStreaming = false;
            orchFns.executeNextTask(messagesEl, state, statusEl);
          });
        }, delay);
      }
      break;
    }

    case "compaction": {
      // Résultat de compaction avec résumé
      const tokensBefore = payload.tokensBefore;
      const summary = payload.summary || "";
      const fromHook = payload.fromHook || false;
      const tokStr = tokensBefore ? `${(tokensBefore / 1000).toFixed(1)}k` : "?";
      const hookLabel = fromHook ? " (auto)" : "";
      appendSystemMessage(messagesEl, `🧹 Compaction${hookLabel} : ${tokStr} tokens compactés`);
      // Ancien format (événement unique) : la compaction est terminée → reset
      // du filtre des deltas et de lastAssistantRawText (même logique que
      // compaction_end).
      state.isCompacting = false;
      state.lastAssistantRawText = "";
      state.pendingText = "";
      if (state.currentTextBlock) {
        state.currentTextBlock.dataset.closed = "true";
        state.currentTextBlock = null;
      }
      // Afficher le résumé dans un bloc collapsible si showThinkingEnabled.
      // Bulle courante si un tour est en cours (continuité visuelle), sinon bulle neuve.
      if (summary && showThinkingEnabled) {
        const blk = state.currentAssistantBlock || createAssistantBlock(messagesEl);
        appendCompactionSummary(blk, summary);
        scrollToBottom(messagesEl);
      }
      // Reprise post-compaction (même logique que compaction_end) — l'événement
      // `compaction` (auto, fromHook) est l'ancien format ; pi peut ne pas
      // reprendre ensuite en mode RPC.
      if (state.orchestrationEnabled && state.orchestrationRunning && !state.orchestrationPaused && fromHook) {
        if (state.orchestrationCompactionTimer) clearTimeout(state.orchestrationCompactionTimer);
        state.orchestrationCompactionResumePending = true;
        const delay = state.isStreaming ? 10000 : 2000;
        state.orchestrationCompactionTimer = setTimeout(() => {
          state.orchestrationCompactionTimer = null;
          if (!state.orchestrationCompactionResumePending) return;
          state.orchestrationCompactionResumePending = false;
          if (!state.orchestrationRunning || state.orchestrationPaused || !state.orchestrationPlan) return;
          appendSystemMessage(messagesEl, "🔁 Reprise du plan après compaction (pi n'a pas relancé automatiquement)...");
          invoke("abort_agent").catch(() => {}).finally(() => {
            state.isStreaming = false;
            orchFns.executeNextTask(messagesEl, state, statusEl);
          });
        }, delay);
      }
      break;
    }

    case "session": {
      // Événement d'initialisation de session — affiché si showThinkingEnabled
      if (showThinkingEnabled && payload.id && payload.version) {
        const sessionId = payload.id.slice(0, 8);
        const cwd = payload.cwd ? ` — ${payload.cwd}` : "";
        appendSystemMessage(messagesEl, `📡 Session ${sessionId} (v${payload.version})${cwd}`);
      }
      break;
    }

    case "thinking_level_change": {
      // Changement de niveau de thinking — affiché si showThinkingEnabled
      if (showThinkingEnabled) {
        const level = payload.thinkingLevel || "?";
        appendSystemMessage(messagesEl, `🧠 Thinking level : ${level}`);
      }
      break;
    }

    case "queue_update":
      // Mise à jour des files d'attente — peut être affiché si souhaité
      break;

    case "extension_error":
      console.error("[agent-pi] extension_error:", payload);
      appendErrorMessage(messagesEl, `⚠️ Erreur extension: ${payload.error || payload.message || JSON.stringify(payload)}`);
      break;

    case "extension_ui_request":
      if (payload.method === "notify" && payload.message) {
        const modelMatch = payload.message.match(/Modèle changé\s*:\s*(\S+)/);
        if (modelMatch) {
          state.currentModel = modelMatch[1];
          const select = document.getElementById("agent-model-select");
          if (select) {
            const opt = Array.from(select.options).find((o) => o.value === state.currentModel);
            if (opt) select.value = state.currentModel;
          }
          updateStats();
        }
      }
      handleExtensionUiRequest(payload, messagesEl, state);
      break;

    case "model_change":
      state.currentModel = `${payload.provider || ""}/${payload.modelId || ""}`;
      // Mettre à jour le sélecteur
      const mcSelect = document.getElementById("agent-model-select");
      if (mcSelect) {
        const mcOpt = Array.from(mcSelect.options).find((o) => o.value === state.currentModel);
        if (mcOpt) mcSelect.value = state.currentModel;
      }
      updateStats();
      break;

    case "process_error": {
      // Erreur venant de stderr du processus pi (ex: ollama indisponible)
      const errText = (payload.text || "").trim();
      if (!errText) break;
      console.error("[agent-pi] process_error (stderr):", errText);
      // Injecter dans la bulle assistant si on est en train de streamer,
      // sinon créer un bloc assistant dédié
      if (state.isStreaming && state.currentAssistantBlock) {
        appendTextSection(state.currentAssistantBlock, `❌ **Erreur processus** :\n\`\`\`\n${errText}\n\`\`\``);
      } else {
        const errBlk = createAssistantBlock(messagesEl);
        appendTextSection(errBlk, `❌ **Erreur processus** :\n\`\`\`\n${errText}\n\`\`\``);
      }
      break;
    }

    case "process_exit":
      state.isStreaming = false;
      state.piDead = true;
      console.error("[agent-pi] process_exit:", payload);
      // Pendant un restart/reconnect, le handler de restart affiche déjà un
      // message clair (et waitForPiReady baille sur piDead). Ne pas dupliquer.
      if (state.restarting) break;
      statusEl.textContent = "⚠️ Déconnecté";
      statusEl.className = "agent-status agent-status-error";
      appendSystemMessage(messagesEl, "⚠️ Le processus pi s'est arrêté. Cliquez sur 🔄 pour reconnecter.");
      // Remplacer le bouton abort par reconnect
      const abortBtn = document.querySelector('[data-action="abort"]');
      if (abortBtn) {
        setIcon(abortBtn, "rotate-cw");
        abortBtn.title = "Reconnecter l'agent";
        abortBtn.dataset.action = "reconnect";
      }
      break;

    case "auto_retry_start": {
      // pi RPC n'arrive pas à joindre le modèle (erreur de connexion) et retente.
      // C'est le signal direct d'un serveur/model injoignable (ex: llama-cpp éteint,
      // ou API cloud down). On l'intercepte pour afficher un message clair au lieu
      // du trompeur « L'orchestrateur n'a pas retourné de plan valide ».
      if (state.orchestrationEnabled) {
        if (!state.orchestrationConnErrorSeen) {
          state.orchestrationConnErrorSeen = true;
          // Stopper les retries automatiques de pi (sinon ça boucle pendant maxAttempts×)
          try { await invoke("abort_agent"); } catch (_) {}
          if (state.orchestrationRunning) {
            // Exécution d'une tâche → pause (option 1)
            orchFns.handleOrchestrationConnectionError(state, messagesEl);
          } else {
            // Construction du plan → l'orchestrateur est injoignable
            const model = state.orchestratorModel || '';
            appendSystemMessage(messagesEl, `🔌 Orchestrateur injoignable${model ? ` (${model})` : ""} — erreur de connexion. Vérifiez que le serveur/model est lancé et accessible, puis réessayez.`);
          }
        }
        break;
      }
      // ── Chat standard : dé-dupliquer les erreurs de connexion ──
      // pi émet auto_retry_start avant chaque nouvelle tentative. Sans cette
      // branche, l'UI empile « ❌ Erreur de connexion » 3-4× (un par retry) puis
      // se fige sans retour. On n'affiche qu'un seul bloc (mis à jour) ; il sera
      // transformé en message + bouton « Réessayer » sur agent_end si aucune
      // réponse n'est revenue (épuisement des retries).
      state.connRetryActive = true;
      state.connErrorCount = (state.connErrorCount || 0) + 1;
      // Au 1er retry d'une nouvelle rafale, invalider le texte du tour précédent :
      // sinon hadResponse (agent_end) resterait true sur un texte obsolète et on
      // retirerait le bloc retry au lieu d'afficher le bouton « Réessayer ».
      if (state.connErrorCount === 1) {
        state.lastAssistantRawText = "";
      }
      const model = state.currentModel || '';
      const label = state.connErrorCount <= 1
        ? `🔌 Modèle injoignable${model ? ` (${model})` : ""} — nouvelle tentative…`
        : `🔌 Modèle injoignable${model ? ` (${model})` : ""} — nouvelle tentative (${state.connErrorCount})…`;
      if (state.connRetryBlock) {
        state.connRetryBlock.textContent = label;
      } else {
        state.connRetryBlock = appendSystemMessage(messagesEl, label);
      }
      break;
    }

    default:
      // Tracer les événements non reconnus pour debug
      console.log("[agent-pi] Événement RPC non reconnu:", payload.type, payload);
      break;
  }

  scrollToBottom(messagesEl);
}

// ── Création des blocs de message ──

function appendUserMessage(container, text) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-user";
  el.innerHTML = `<div class="agent-bubble agent-bubble-user">${escapeHtml(text)}</div>`;
  container.appendChild(el);
  scrollToBottom(container);
  return el;
}

function createAssistantBlock(container) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-assistant";
  const bubble = document.createElement("div");
  bubble.className = "agent-bubble agent-bubble-assistant";
  const flow = document.createElement("div");
  flow.className = "agent-stream-flow";
  bubble.appendChild(flow);
  el.appendChild(bubble);
  container.appendChild(el);
  return el;
}

function getBubbleTarget(parent) {
  if (!parent) return null;
  // Flux chronologique des événements du tour courant
  const flow = parent.querySelector(".agent-stream-flow");
  if (flow) return flow;
  // Fallback pour compatibilité avec les anciennes bulles
  const bubble = parent.querySelector(".agent-bubble-assistant");
  return bubble || parent;
}

function appendTextSection(parent, content, reuse = true) {
  const target = getBubbleTarget(parent);
  if (!target) return null;

  let section = null;
  if (reuse) {
    // Réutiliser la dernière section texte non fermée pour un flux continu
    const sections = target.querySelectorAll(".agent-text-section");
    for (let i = sections.length - 1; i >= 0; i--) {
      if (!sections[i].dataset.closed) {
        section = sections[i];
        break;
      }
    }
  }

  if (!section) {
    section = document.createElement("div");
    section.className = "agent-text-section";
    target.appendChild(section);
  }

  if (content) {
    section.innerHTML = md.render(content);
  }
  return section;
}

function closeTextSection(section) {
  if (section && !section.dataset.closed) {
    section.dataset.closed = "true";
  }
}

function appendThinkingSection(parent, content, allowEmpty = false) {
  const target = getBubbleTarget(parent);
  if (!target) return null;

  // Ne pas afficher de bloc thinking si le contenu est vide ou uniquement un objet vide
  // Sauf si allowEmpty=true (streaming : le contenu arrive via thinking_delta)
  const trimmedContent = (content || "").trim();
  if (!allowEmpty && (!trimmedContent || trimmedContent === "{}")) return null;

  // Créer un nouveau bloc thinking dans le flux chronologique.
  // Chaque pensée a sa propre place au moment où elle arrive.
  const block = document.createElement("div");
  block.className = "agent-thinking";
  if (showThinkingEnabled) {
    block.innerHTML = `<div class="agent-thinking-content">${trimmedContent ? renderThinkingContent(trimmedContent) : ''}</div>`;
  } else {
    block.innerHTML = `<div class="agent-thinking-dots">pensée</div>`;
  }
  target.appendChild(block);
  return block;
}

function renderThinkingContent(text) {
  // Parser le contenu thinking : isoler les blocs ```...```
  let html = "";
  let remaining = text;
  const codeRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(text)) !== null) {
    // Texte avant le bloc de code
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      html += escapeHtml(before);
    }
    // Bloc de code
    const lang = match[1] || "";
    const code = match[2];
    html += `<pre class="thinking-code-block"><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code.trim())}</code></pre>`;
    lastIndex = match.index + match[0].length;
  }

  // Texte restant après le dernier bloc
  const after = text.slice(lastIndex);
  if (after.trim()) {
    html += escapeHtml(after);
  }

  return html || escapeHtml(text);
}

function appendToolBlock(parent, toolName, args) {
  // N'afficher les appels d'outils que si la pensée ou les outils sont visibles
  if (!showThinkingEnabled && !showToolsEnabled) return null;
  // Ne pas afficher si le nom de l'outil est vide
  if (!toolName) return null;
  if (!parent) {
    parent = createAssistantBlock(document.querySelector(".agent-chat-messages"));
  }
  const target = getBubbleTarget(parent);
  if (!target) return null;

  // Construire un résumé lisible de l'appel
  const label = toolName;
  let detail = "";
  if (toolName === "bash" || toolName === "execute_command") {
    detail = args?.command || args?.cmd || "";
  } else if (toolName === "read" || toolName === "read_file") {
    detail = args?.path || args?.file || "";
  } else if (toolName === "write" || toolName === "write_file") {
    detail = args?.path || args?.file || "";
  } else if (toolName === "edit" || toolName === "patch_file") {
    detail = args?.path || args?.file || "";
  } else if (toolName === "grep" || toolName === "grep_search") {
    detail = args?.pattern || "";
  } else {
    // Pour les outils génériques, ne pas afficher les args vides
    const argsStr = JSON.stringify(args);
    detail = (argsStr === "{}" || argsStr === "") ? "" : argsStr;
  }
  // Limiter la longueur du détail
  if (detail.length > 120) detail = detail.slice(0, 117) + "...";

  // Badge d'outil ajouté au flux chronologique, au moment de tool_execution_start.
  const inlineEl = document.createElement("div");
  inlineEl.className = "agent-tool-inline";
  inlineEl.dataset.toolName = toolName;
  if (detail.trim().length > 0) {
    inlineEl.innerHTML = `<span class="agent-tool-label">${escapeHtml(label)}</span> <code>${escapeHtml(detail)}</code>`;
  } else {
    inlineEl.innerHTML = `<span class="agent-tool-label">${escapeHtml(label)}</span>`;
  }
  target.appendChild(inlineEl);
  return inlineEl;
}

function appendSystemMessage(container, text) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-system";
  el.textContent = text;
  container.appendChild(el);
  return el;
}

function appendErrorMessage(container, text) {
  const el = document.createElement("div");
  el.className = "agent-message agent-message-error";
  el.textContent = text;
  container.appendChild(el);
  return el;
}

/**
 * Transforme le bloc « 🔄 nouvelle tentative » en message d'erreur final +
 * bouton « Réessayer » après épuisement des retries de connexion (chat standard).
 * Sans cela, l'agent se fige en silence et l'utilisateur doit re-soumettre
 * manuellement son dernier prompt. Le bouton relance l'envoi via retryLastPrompt.
 */
function renderConnErrorFinalBlock(state, messagesEl, retryBlock) {
  if (retryBlock) { retryBlock.remove(); }
  if (state.connRetryBlock === retryBlock) state.connRetryBlock = null;
  const model = state.currentModel || '';
  const n = state.connErrorCount || 1;
  const el = document.createElement("div");
  el.className = "agent-message agent-message-error agent-conn-final";
  el.innerHTML = `❌ Modèle injoignable${model ? ` (${model})` : ""} après ${n} tentative(s) de connexion. Vérifiez que le serveur est démarré, puis réessayez. ` +
    `<button class="agent-btn agent-retry-btn" data-action="retry-last-prompt" title="Réessayer le dernier message"><i data-lucide="rotate-cw" class="icon-sm"></i> Réessayer</button>`;
  messagesEl.appendChild(el);
  refreshIcons(el);
  return el;
}

// ── Sélection de session après /resume ──

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " Ko";
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}

function showResumePopup() {
  if (!resumePopupEl || resumeSessions.length === 0) return;
  resumeIndex = 0;
  renderResumePopup();
}

function hideResumePopup() {
  if (resumePopupEl) resumePopupEl.classList.remove("visible");
  resumeIndex = -1;
}

function renderResumePopup() {
  if (!resumePopupEl) return;
  let html = '<div class="agent-resume-title"><i data-lucide="folder-open" class="icon-sm"></i> Sessions enregistrées :</div>';
  resumeSessions.forEach((s, i) => {
    const date = s.timestamp ? new Date(s.timestamp).toLocaleString() : "?";
    const size = s.size ? formatFileSize(s.size) : "";
    const preview = s.preview || "";
    const active = i === resumeIndex ? " active" : "";
    html += `
      <div class="agent-resume-item${active}" data-resume-index="${i}">
        <div class="resume-header">
          <span class="resume-date">${escapeHtmlText(date)}</span>
          <span class="resume-preview">${escapeHtmlText(preview)}</span>
          <span class="resume-size">${size}</span>
        </div>
      </div>`;
  });
  resumePopupEl.innerHTML = html;
  refreshIcons(resumePopupEl);
  resumePopupEl.classList.add("visible");

  // Attacher les clics
  resumePopupEl.querySelectorAll(".agent-resume-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.resumeIndex);
      if (isNaN(idx)) return;
      resumeIndex = idx;
      applyResumeSelection(resumeMessagesEl);
    });
  });
}

function moveResumeSelection(delta) {
  if (resumeSessions.length === 0) return;
  resumeIndex = (resumeIndex + delta + resumeSessions.length) % resumeSessions.length;
  renderResumePopup();
}

async function applyResumeSelection(messagesEl) {
  if (resumeIndex < 0 || resumeIndex >= resumeSessions.length) return;
  const session = resumeSessions[resumeIndex];
  const file = session.file;
  if (!file) return;

  hideResumePopup();
  acInputEl.value = "";

  if (!messagesEl) return;

  // Purger l'écran avant chargement
  messagesEl.innerHTML = "";
  appendSystemMessage(messagesEl, `🔄 Reprise de la session...`);

  try {
    await invoke("resume_agent_session", { sessionFile: file });
    const fname = file.split("/").pop() || file.split("\\").pop() || file;
    appendSystemMessage(messagesEl, `✅ Session chargée : ${fname}`);

    // Récupérer et afficher tous les messages de la session
    try {
      const raw = await invoke("read_file_content", { path: file });
      if (raw) {
        const lines = raw.split("\n").filter((l) => l.trim());
        let currentBlk = null; // Bloc assistant fusionné
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === "message") {
              const msg = evt.message;
              if (!msg) continue;
              if (msg.role === "user") {
                // Changement d'interlocuteur → réinitialiser le bloc assistant
                currentBlk = null;
                const text = extractMessageText(msg);
                if (text) appendUserMessage(messagesEl, text);
              } else if (msg.role === "assistant") {
                let createdBlk = false;
                if (Array.isArray(msg.content) && msg.content.length > 0) {
                  // Fusionner dans le même bloc jusqu'au prochain user
                  if (!currentBlk) { currentBlk = createAssistantBlock(messagesEl); createdBlk = true; }
                  let pendingThinking = "";
                  let lastTextSection = null; // fermer avant thinking/tool (ordre chronologique)
                  for (const part of msg.content) {
                    if (part.type === "thinking" && part.thinking) {
                      if (showThinkingEnabled) pendingThinking += part.thinking;
                    } else {
                      // Fermer la section texte courante avant d'insérer une pensée
                      // ou un outil (sinon le prochain text est réinjecté dans la
                      // section précédente, au-dessus du tool/thinking).
                      if (lastTextSection) { closeTextSection(lastTextSection); lastTextSection = null; }
                      if (pendingThinking) { appendThinkingSection(currentBlk, pendingThinking); pendingThinking = ""; }
                      if (part.type === "text" && part.text) {
                        lastTextSection = appendTextSection(currentBlk, part.text);
                      } else if ((part.type === "toolCall" || part.type === "tool_call") && part.name && currentBlk) {
                        appendToolBlock(currentBlk, part.name, part.arguments || part.args || {});
                      }
                    }
                  }
                  if (lastTextSection) closeTextSection(lastTextSection);
                  if (pendingThinking) appendThinkingSection(currentBlk, pendingThinking);
                } else if (typeof msg.content === "string" && msg.content) {
                  if (!currentBlk) { currentBlk = createAssistantBlock(messagesEl); createdBlk = true; }
                  appendTextSection(currentBlk, msg.content);
                } else if (msg.stopReason === "error" && msg.errorMessage) {
                  // Message assistant vide avec erreur → afficher l'erreur
                  if (!currentBlk) currentBlk = createAssistantBlock(messagesEl);
                  appendSystemMessage(messagesEl, `⚠️ ${msg.errorMessage}`);
                } else if (msg.stopReason === "aborted") {
                  if (!currentBlk) currentBlk = createAssistantBlock(messagesEl);
                  appendTextSection(currentBlk, "⏹️ Agent arrêté");
                }
                // Si la bulle créée est vide après rendu (outils masqués), la retirer
                if (currentBlk && createdBlk) {
                  const bubble = getBubbleTarget(currentBlk);
                  const flow = bubble?.querySelector(".agent-stream-flow");
                  if (flow && flow.children.length === 0) {
                    currentBlk.remove();
                    currentBlk = null;
                  }
                }
              } else if (msg.role === "toolResult" && showToolsEnabled) {
                // Résultat d'outil dans la bulle assistant en cours
                if (!currentBlk) { currentBlk = createAssistantBlock(messagesEl); }
                const output = extractToolResultText(msg);
                if (output) {
                  const toolName = msg.toolName || "";
                  if (toolName) {
                    appendToolResult(currentBlk, toolName, output);
                  }
                }
              }
            } else if (evt.type === "compaction") {
              // Résultat de compaction dans le rejeu de session
              const tokensBefore = evt.tokensBefore;
              const tokStr = tokensBefore ? `${(tokensBefore / 1000).toFixed(1)}k` : "?";
              const hookLabel = evt.fromHook ? " (auto)" : "";
              appendSystemMessage(messagesEl, `🧹 Compaction${hookLabel} : ${tokStr} tokens compactés`);
              if (evt.summary && showThinkingEnabled) {
                currentBlk = null;
                const blk = createAssistantBlock(messagesEl);
                appendCompactionSummary(blk, evt.summary);
                currentBlk = blk;
              }
            } else if (evt.type === "session" && showThinkingEnabled) {
              const sessionId = (evt.id || "").slice(0, 8);
              const cwd = evt.cwd ? ` — ${evt.cwd}` : "";
              appendSystemMessage(messagesEl, `📡 Session ${sessionId} (v${evt.version || "?"})${cwd}`);
            } else if (evt.type === "thinking_level_change" && showThinkingEnabled) {
              appendSystemMessage(messagesEl, `🧠 Thinking level : ${evt.thinkingLevel || "?"}`);
            }
          } catch (_) { /* ligne invalide, ignorer */ }
        }
        scrollToBottom(messagesEl);
      }
    } catch (err) {
      console.error("Erreur récupération messages:", err);
    }
  } catch (e) {
    console.error("Erreur resume:", e);
    if (messagesEl) {
      appendErrorMessage(messagesEl, `Erreur: ${e}`);
    }
  }
}

function extractMessageText(msg) {
  if (!msg || !msg.content) return "";
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
  }
  if (typeof msg.content === "string") return msg.content;
  return "";
}

// ── Popup /prompt : sélection et exécution de prompts ──

// Templates intégrés (même définition que dans prompt-builder.js)
const PROMPT_BUILTIN_TEMPLATES = [
  { key: "code-review", label: "🔍 Code Review", instructions: "Fais une code review approfondie des fichiers sélectionnés. Analyse :\n- La qualité du code et la lisibilité\n- Les bugs potentiels et erreurs de logique\n- Les vulnérabilités de sécurité\n- Les problèmes de performance\n- Le respect des bonnes pratiques et conventions\n\nPropose des améliorations concrètes avec des exemples de code." },
  { key: "refactor", label: "🔧 Refactorisation", instructions: "Refactore les fichiers sélectionnés en appliquant :\n- Les principes SOLID et DRY\n- L'extraction de fonctions/duplication de code\n- L'amélioration de la lisibilité et de la maintenabilité\n- La simplification de la logique complexe\n\nConserve le comportement existant. Montre les changements proposés avec des diffs." },
  { key: "generate-docs", label: "📖 Générer documentation", instructions: "Génère une documentation complète pour les fichiers sélectionnés :\n- Commentaire JSDoc/docstring pour chaque fonction publique\n- Documentation des types et paramètres\n- Exemples d'utilisation\n- Un README si pertinent\n\nUtilise le style de documentation adapté au langage de chaque fichier." },
  { key: "add-tests", label: "🧪 Ajouter des tests", instructions: "Écris des tests unitaires complets pour les fichiers sélectionnés :\n- Teste chaque fonction publique et ses cas limites\n- Inclue les cas nominaux et les cas d'erreur\n- Utilise le framework de test du projet (ou suggère-en un)\n- Vise une couverture maximale\n\nMontre le code de test complet, prêt à être exécuté." },
  { key: "explain", label: "💡 Expliquer le code", instructions: "Explique le code des fichiers sélectionnés de façon claire et pédagogique :\n- L'architecture et la structure globale\n- Le rôle de chaque fonction/classe importante\n- Le flux de données et les dépendances\n- Les design patterns utilisés\n\nAdapte l'explication pour un développeur junior qui découvre le projet." },
  { key: "find-bugs", label: "🐛 Trouver les bugs", instructions: "Analyse les fichiers sélectionnés pour trouver tous les bugs potentiels :\n- Erreurs de logique et conditions de course\n- Fuites mémoire et erreurs de gestion des ressources\n- Gestion défectueuse des erreurs et exceptions\n- Problèmes de validation des entrées\n\nPriorise les bugs par sévérité (critique, majeur, mineur) et propose un correctif pour chacun." },
];

function showPromptPopup(messagesEl) {
  if (!promptPopupEl || !acInputEl) return;
  promptMessagesEl = messagesEl;

  // Construire la liste des choix : templates intégrés + fichiers cochés
  promptTemplates = [];

  // Templates intégrés
  for (const t of PROMPT_BUILTIN_TEMPLATES) {
    promptTemplates.push({ type: "builtin", key: t.key, label: t.label, instructions: t.instructions });
  }

  // Templates utilisateur (dossier templates/ du projet)
  const projectPath = window._pilotProjectPath;
  if (projectPath) {
    try {
      const { getSidebar } = require_or_import_sidebar();
      if (getSidebar) {
        const sidebar = getSidebar();
        if (sidebar && sidebar.treeData) {
          const templatesNode = findTemplatesNode(sidebar.treeData);
          if (templatesNode && templatesNode.children) {
            for (const child of templatesNode.children) {
              if (!child.is_dir && child.name.endsWith(".md")) {
                promptTemplates.push({ type: "user", key: child.name, label: "📄 " + child.name, path: child.path });
              }
            }
          }
        }
      }
    } catch (_) { /* sidebar pas disponible */ }
  }

  if (promptTemplates.length === 0) {
    appendSystemMessage(messagesEl, "Aucun template disponible.");
    return;
  }

  promptIndex = 0;
  renderPromptPopup();
}

function hidePromptPopup() {
  if (promptPopupEl) promptPopupEl.classList.remove("visible");
  promptIndex = -1;
}

function renderPromptPopup() {
  if (!promptPopupEl) return;
  let html = `<div class="agent-prompt-title"><i data-lucide="puzzle" class="icon-sm"></i> Exécuter un prompt :</div>`;
  promptTemplates.forEach((t, i) => {
    const active = i === promptIndex ? " active" : "";
    html += `
      <div class="agent-prompt-item${active}" data-prompt-index="${i}">
        <span class="prompt-label">${escapeHtmlText(t.label)}</span>
      </div>`;
  });
  promptPopupEl.innerHTML = html;
  refreshIcons(promptPopupEl);
  promptPopupEl.classList.add("visible");

  // Attacher les clics
  promptPopupEl.querySelectorAll(".agent-prompt-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      promptIndex = parseInt(el.dataset.promptIndex);
      applyPromptSelection();
    });
  });
}

function movePromptSelection(delta) {
  if (promptTemplates.length === 0) return;
  promptIndex = (promptIndex + delta + promptTemplates.length) % promptTemplates.length;
  renderPromptPopup();
}

async function applyPromptSelection() {
  if (promptIndex < 0 || promptIndex >= promptTemplates.length) return;
  const tmpl = promptTemplates[promptIndex];
  hidePromptPopup();
  acInputEl.value = "";

  const projectPath = window._pilotProjectPath || "";
  const projectName = projectPath ? projectPath.replace(/\\/g, "/").split("/").pop() : "";

  let instructions = "";

  // Récupérer les instructions
  if (tmpl.type === "builtin") {
    instructions = tmpl.instructions;
  } else if (tmpl.type === "user") {
    try {
      const content = await invoke("read_file_content", { path: tmpl.path });
      const parts = content.split(/^## (?:Arborescence|Fichiers)/m);
      instructions = parts[0]
        ? parts[0].replace(/^# Projet :.*\n+/m, "").replace(/^## Instructions\n+/m, "").trim()
        : "";
    } catch (_) {
      instructions = "";
    }
  }

  // Construire le prompt
  let prompt = "";
  if (projectName) prompt += `# Projet : ${projectName}\n\n`;
  if (instructions) prompt += `## Instructions\n\n${instructions}\n\n`;

  if (!prompt.trim()) {
    if (promptMessagesEl) appendSystemMessage(promptMessagesEl, "⚠️ Aucun contenu à envoyer. Le template ne contient pas d'instructions.");
    return;
  }

  // Afficher un résumé dans le chat et envoyer
  if (promptMessagesEl) {
    appendSystemMessage(promptMessagesEl, `🧩 Prompt exécuté : ${tmpl.label}`);
  }

  try {
    // Ouvrir l'onglet Agent Pi s'il n'est pas déjà ouvert
    if (window._pilotTabs) {
      const agentTab = window._pilotTabs.tabs.find((t) => t.mode === "agent");
      if (!agentTab) {
        await window._pilotTabs.openFile(agentDisplayLabel(), "agent");
        await new Promise((r) => setTimeout(r, 500));
      } else {
        window._pilotTabs.switchTab(agentTab.id);
      }
    }
    await invoke("send_agent_prompt", { message: prompt });
  } catch (err) {
    if (promptMessagesEl) appendErrorMessage(promptMessagesEl, `Erreur envoi prompt: ${err}`);
  }
}

// Accès à la sidebar depuis agent-pi.js
function require_or_import_sidebar() {
  try {
    // La sidebar expose getSidebar en module ES
    return { getSidebar: window._pilotGetSidebar };
  } catch (_) {
    return { getSidebar: null };
  }
}

function getSelectedPathsFromSidebar() {
  // La sélection par checkboxes a été remplacée par le drag & drop dans le Prompt Builder.
  // Cette fonction retourne toujours un Set vide pour compatibilité.
  return new Set();
}

function findTemplatesNode(node) {
  if (!node) return null;
  if (node.name === "templates" && node.is_dir) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findTemplatesNode(child);
      if (found) return found;
    }
  }
  return null;
}

// ── Gestion des dialogues d'extension ──

/**
 * Attend que pi soit prêt après un (re)démarrage : poll get_agent_state jusqu'à
 * `maxSecs` secondes. Retourne true si pi répond, false sinon (pi mort/bloqué).
 * Détecte vite un pi mort (pipe closed → get_agent_state échoue immédiatement)
 * au lieu d'attendre le timeout complet.
 */
async function waitForPiReady(state, maxSecs) {
  const deadline = Date.now() + maxSecs * 1000;
  while (Date.now() < deadline) {
    if (state.piDead) return false; // process_exit reçu pendant l'attente
    try {
      await invoke("get_agent_state");
      return true;
    } catch (_) {
      // pi pas encore prêt ou mort → réessayer
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Dialogues DOM pour les extension_ui_request (confirm/select/input).
 * window.confirm / window.prompt sont inopérants dans WebView2 (Tauri 2) —
 * utiliser des modales DOM garantit que la réponse repart toujours vers pi,
 * sinon pi reste bloqué indéfiniment (→ timeout 30s → pipe closed).
 */
function _domDialog({ title, bodyHtml, okLabel, cancelLabel, okValue }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "agent-ext-dialog-overlay";
    const box = document.createElement("div");
    box.className = "agent-ext-dialog";
    const titleEl = document.createElement("div");
    titleEl.className = "agent-ext-dialog-title";
    titleEl.textContent = title || "Pilot";
    const body = document.createElement("div");
    body.className = "agent-ext-dialog-body";
    body.innerHTML = bodyHtml || "";
    const actions = document.createElement("div");
    actions.className = "agent-ext-dialog-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "agent-diff-btn agent-diff-btn-reject";
    cancelBtn.textContent = cancelLabel || "Annuler";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-diff-btn agent-diff-btn-accept";
    okBtn.textContent = okLabel || "OK";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(titleEl);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = (val) => { overlay.remove(); resolve(val); };
    okBtn.addEventListener("click", () => done(okValue === undefined ? true : okValue));
    cancelBtn.addEventListener("click", () => done(okValue === undefined ? false : null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(okValue === undefined ? false : null); });
    // Focus initial
    const focusable = body.querySelector("input, textarea, select");
    if (focusable) setTimeout(() => focusable.focus(), 0);
    else okBtn.focus();
  });
}

/** Confirm yes/no → Promise<boolean> */
function domConfirm(title, message) {
  return _domDialog({
    title,
    bodyHtml: `<p style="margin:0;white-space:pre-wrap;word-break:break-word">${escapeHtmlText(message || "")}</p>`,
    okLabel: "Oui",
    cancelLabel: "Non",
  });
}

/** Free-form input → Promise<string|null> (null = cancelled) */
function domPrompt(title, placeholder) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "agent-ext-dialog-overlay";
    const box = document.createElement("div");
    box.className = "agent-ext-dialog";
    const titleEl = document.createElement("div");
    titleEl.className = "agent-ext-dialog-title";
    titleEl.textContent = title || "Saisie";
    const body = document.createElement("div");
    body.className = "agent-ext-dialog-body";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder || "";
    input.style.cssText = "width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text-primary);font-size:13px;box-sizing:border-box";
    body.appendChild(input);
    const actions = document.createElement("div");
    actions.className = "agent-ext-dialog-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "agent-diff-btn agent-diff-btn-reject";
    cancelBtn.textContent = "Annuler";
    const okBtn = document.createElement("button");
    okBtn.className = "agent-diff-btn agent-diff-btn-accept";
    okBtn.textContent = "Valider";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(titleEl); box.appendChild(body); box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = (val) => { overlay.remove(); resolve(val); };
    okBtn.addEventListener("click", () => done(input.value));
    cancelBtn.addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value); if (e.key === "Escape") done(null); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    setTimeout(() => input.focus(), 0);
  });
}

/** Select from options → Promise<string|null> */
function domSelect(title, options) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "agent-ext-dialog-overlay";
    const box = document.createElement("div");
    box.className = "agent-ext-dialog";
    const titleEl = document.createElement("div");
    titleEl.className = "agent-ext-dialog-title";
    titleEl.textContent = title || "Choix";
    const body = document.createElement("div");
    body.className = "agent-ext-dialog-body";
    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:4px;max-height:300px;overflow:auto";
    const done = (val) => { overlay.remove(); resolve(val); };
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.className = "agent-diff-btn";
      btn.style.cssText = "justify-content:flex-start;text-align:left";
      btn.textContent = String(opt);
      btn.addEventListener("click", () => done(String(opt)));
      list.appendChild(btn);
    }
    body.appendChild(list);
    const actions = document.createElement("div");
    actions.className = "agent-ext-dialog-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "agent-diff-btn agent-diff-btn-reject";
    cancelBtn.textContent = "Annuler";
    cancelBtn.addEventListener("click", () => done(null));
    actions.appendChild(cancelBtn);
    box.appendChild(titleEl); box.appendChild(body); box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
  });
}

async function handleExtensionUiRequest(payload, container, state) {
  const { id, method } = payload;

  if (method === "notify") {
    const type = payload.notifyType || "info";
    const msg = payload.message || "";
    appendSystemMessage(container, `ℹ️ [${type}] ${msg}`);
    return;
  }

  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
    // Fire-and-forget, on ignore pour l'instant
    return;
  }

  // Méthodes de dialogue : select, confirm, input, editor
  if (method === "confirm") {
    // ── Diff Review (A4 V2) : porte pré-écriture pilot-edit-gate ──
    // L'extension pi envoie un confirm avec un message sentinel + JSON
    // ({tool, path, before, after}). On intercepte pour afficher un diff riche
    // AVANT l'écriture (pi est bloqué en attendant la réponse).
    const SENTINEL = "PILOT_EDIT_GATE::";
    const rawMsg = payload.message || "";
    if (rawMsg.startsWith(SENTINEL)) {
      await handleEditGateConfirm(id, rawMsg.slice(SENTINEL.length), container, state);
      return;
    }
    const ok = await domConfirm(payload.title || "Confirmation", payload.message || "");
    await invoke("send_rpc_command", {
      command: {
        type: "extension_ui_response",
        id,
        confirmed: ok,
        cancelled: !ok,
      },
    });
  } else if (method === "select") {
    const options = payload.options || [];
    const choice = await domSelect(payload.title || "Choix", options);
    if (choice) {
      await invoke("send_rpc_command", {
        command: { type: "extension_ui_response", id, value: choice },
      });
    } else {
      await invoke("send_rpc_command", {
        command: { type: "extension_ui_response", id, cancelled: true },
      });
    }
  } else if (method === "input") {
    const value = await domPrompt(payload.title || "Entrée", payload.placeholder || "");
    if (value !== null && value !== undefined) {
      await invoke("send_rpc_command", {
        command: { type: "extension_ui_response", id, value },
      });
    } else {
      await invoke("send_rpc_command", {
        command: { type: "extension_ui_response", id, cancelled: true },
      });
    }
  } else if (method === "editor") {
    appendExtensionEditor(container, id, payload);
  }
}

// ── Diff Review (A4 V2) : porte pré-écriture (pilot-edit-gate) ──

/**
 * Traite une demande de confirmation de l'extension pilot-edit-gate.
 * Décide : auto-approve (paramètre désactivé ou Mode Orchestration) OU affiche
 * un diff Accepter/Refuser avant d'autoriser l'outil write/edit.
 *
 * @param {object} payload - extension_ui_request brut
 * @param {string} id - id de la requête (pour la réponse)
 * @param {string} jsonStr - payload JSON après le sentinel
 * @param {HTMLElement} container - zone de chat où attacher le dialogue
 */
async function handleEditGateConfirm(id, jsonStr, container, state) {
  let info;
  try {
    info = JSON.parse(jsonStr);
  } catch (_) {
    // Payload malformé : ne pas bloquer l'agent (auto-allow)
    await invoke("send_rpc_command", {
      command: { type: "extension_ui_response", id, confirmed: true },
    });
    return;
  }

  // Auto-approve si la porte est désactivée OU en Mode Orchestration (autonome).
  const gateActive = state.confirmFileEdits && !state.orchestrationRunning;
  if (!gateActive) {
    await invoke("send_rpc_command", {
      command: { type: "extension_ui_response", id, confirmed: true },
    });
    return;
  }

  const relPath = toRelPath(info.path || "");
  const toolName = info.tool || "write";

  // Attacher le dialogue à la bulle assistant courante (ou en créer une).
  let attachTo = state.currentAssistantBlock;
  if (!attachTo) {
    attachTo = createAssistantBlock(container);
    state.currentAssistantBlock = attachTo;
  }
  const target = getBubbleTarget(attachTo) || attachTo;

  const respond = async (accepted) => {
    try {
      const { toastInfo } = await import("./toast.js");
      toastInfo(accepted ? "✓ Modification acceptée : " + relPath : "✗ Modification refusée : " + relPath);
    } catch (_) {}
    await invoke("send_rpc_command", {
      command: { type: "extension_ui_response", id, confirmed: !!accepted, cancelled: !accepted },
    });
  };

  const dialog = renderEditGateDialog({
    relPath,
    toolName,
    before: info.before,
    after: info.after,
    onDecision: respond,
  });
  target.appendChild(dialog);
  scrollToBottom(container);
}

/**
 * Affiche un éditeur intégré dans la zone de chat pour extension_ui_request type "editor".
 */
function appendExtensionEditor(container, requestId, payload) {
  const title = payload.title || "Édition";
  const prefill = payload.prefill || "";

  const wrapper = document.createElement("div");
  wrapper.className = "agent-extension-editor";

  wrapper.innerHTML = `
    <div class="agent-extension-editor-header">
      <span><i data-lucide="file-text" class="icon-sm"></i> ${escapeHtml(title)}</span>
      <span class="agent-extension-editor-hint">Ctrl+Enter pour valider</span>
    </div>
    <textarea class="agent-extension-editor-textarea" rows="10" spellcheck="false">${escapeHtml(prefill)}</textarea>
    <div class="agent-extension-editor-actions">
      <button class="agent-extension-editor-cancel">Annuler</button>
      <button class="agent-extension-editor-submit">Valider</button>
    </div>
  `;

  const textarea = wrapper.querySelector(".agent-extension-editor-textarea");
  const btnSubmit = wrapper.querySelector(".agent-extension-editor-submit");
  const btnCancel = wrapper.querySelector(".agent-extension-editor-cancel");

  const respond = async (value, cancelled) => {
    const cmd = { type: "extension_ui_response", id: requestId };
    if (cancelled) {
      cmd.cancelled = true;
    } else {
      cmd.value = value || "";
    }
    // Désactiver les boutons après réponse
    btnSubmit.disabled = true;
    btnCancel.disabled = true;
    textarea.disabled = true;
    wrapper.style.opacity = "0.6";
    try {
      await invoke("send_rpc_command", { command: cmd });
    } catch (e) {
      console.error("Erreur extension_ui_response:", e);
    }
  };

  btnSubmit.addEventListener("click", () => respond(textarea.value, false));
  btnCancel.addEventListener("click", () => respond(null, true));

  // Ctrl+Enter pour valider
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      respond(textarea.value, false);
    }
  });

  container.appendChild(wrapper);
  refreshIcons(wrapper);
  textarea.focus();
  container.scrollTop = container.scrollHeight;
}

// ── Utilitaires ──

function finalizeTextBlock(state) {
  if (state.currentTextBlock && state.pendingText) {
    state.currentTextBlock.innerHTML = md.render(state.pendingText);
  }
  state.pendingText = "";
}

function extractToolOutput(result) {
  if (!result) return null;
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  if (result.output) return result.output;
  return JSON.stringify(result, null, 2);
}

/** Extrait le texte d'un message toolResult (payload complet) */
function extractToolResultText(msg) {
  if (!msg || !msg.content) return null;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
  }
  if (typeof msg.content === "string") return msg.content;
  return null;
}

/** Extrait la sortie texte depuis un objet result (tool_execution_end) */
function extractToolResultOutput(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
  }
  if (result.output) return result.output;
  if (result.stdout) return result.stdout;
  if (result.stderr) return `[stderr]\n${result.stderr}`;
  return null;
}

/** Ajoute un bloc de résultat d'outil (collapsible) juste après son badge */
function appendToolResult(parent, toolName, output) {
  const target = getBubbleTarget(parent);
  if (!target || !output) return null;

  // Insérer le résultat juste après le dernier badge de cet outil dans le flux
  let anchor = null;
  const badges = target.querySelectorAll(".agent-tool-inline");
  for (let i = badges.length - 1; i >= 0; i--) {
    const labelEl = badges[i].querySelector(".agent-tool-label");
    if (labelEl && labelEl.textContent === toolName) {
      anchor = badges[i];
      break;
    }
  }

  const id = "tool-result-" + Math.random().toString(36).slice(2, 8);
  const truncated = output.length > 500 ? output.slice(0, 500) + "…" : output;

  const block = document.createElement("div");
  block.className = "agent-tool-result";
  block.innerHTML = `
    <div class="agent-tool-result-header" data-toggle="${id}">
      <span class="agent-tool-result-caret">▶</span>
      <span class="agent-tool-result-name">${escapeHtml(toolName)}</span>
      <span class="agent-tool-result-preview">${escapeHtml(truncated.slice(0, 80))}</span>
    </div>
    <pre class="agent-tool-result-content hidden" id="${id}"><code>${escapeHtml(output)}</code></pre>
  `;

  if (anchor) {
    anchor.after(block);
  } else {
    target.appendChild(block);
  }

  // Toggle collapsible
  const header = block.querySelector(".agent-tool-result-header");
  const content = block.querySelector(".agent-tool-result-content");
  const caret = block.querySelector(".agent-tool-result-caret");
  header.addEventListener("click", () => {
    const isHidden = content.classList.toggle("hidden");
    caret.textContent = isHidden ? "▶" : "▼";
  });

  return block;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Ajoute un bloc collapsible pour le résumé de compaction */
function appendCompactionSummary(parent, summary) {
  const target = getBubbleTarget(parent);
  if (!target || !summary) return null;

  const id = "compaction-" + Math.random().toString(36).slice(2, 8);
  const preview = summary.split("\n")[0] || "Résumé de compaction";
  const isLong = summary.length > 300;

  const block = document.createElement("div");
  block.className = "agent-tool-result";
  block.innerHTML = `
    <div class="agent-tool-result-header" data-toggle="${id}">
      <span class="agent-tool-result-caret">▶</span>
      <span class="agent-tool-result-name">Compaction</span>
      <span class="agent-tool-result-preview">${escapeHtml(preview.slice(0, 100))}</span>
    </div>
    <div class="agent-compaction-summary hidden" id="${id}">${md.render(summary)}</div>
  `;
  target.appendChild(block);

  // Toggle collapsible
  const header = block.querySelector(".agent-tool-result-header");
  const content = block.querySelector(".agent-compaction-summary");
  const caret = block.querySelector(".agent-tool-result-caret");
  header.addEventListener("click", () => {
    const isHidden = content.classList.toggle("hidden");
    caret.textContent = isHidden ? "▶" : "▼";
  });

  return block;
}

function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}
