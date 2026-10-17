// settings.js — Modale de paramètres

import { invoke } from "@tauri-apps/api/core";
// Alias dialog pour ne pas ombrer le `confirm(...)` global (fenêtre) déjà utilisé
// ailleurs dans ce fichier (audit, mot de passe distant, déconnexion).
import { save as dialogSave, open as dialogOpen, confirm as dialogConfirm } from "@tauri-apps/plugin-dialog";
import { applyTheme, getCurrentTheme, getCurrentSubtheme, SUBTHEMES } from "./theme.js";
import { refreshShowThinking, refreshShowTools } from "./agent-pi.js";
import { showToast } from "./toast.js";
import { refreshIcons } from "./icons.js";
import { saveProvidersIfDirty, cancelProvidersIfDirty } from "./models-config.js";
import { animateModalOpen } from "./modal-anim.js";
import { MCP_TRANSPORT_STDIO, formatArgs, formatEnv, isRemoteTransport, validateServer, newServerId, testResult, buildServer } from "./mcp-utils.js";
// Périmètre de la clé du coffre (tâche 399) : libellés d'état partagés avec
// l'extension MCP — jamais une valeur de clé.
import { secretStatusLabel } from "./mcp-secret-scope.js";
// Contrôle de l'écran : journal lisible (relecture) — logique pure partagée avec
// l'extension MCP qui l'écrit.
import { SCREEN_JOURNAL_RELATIVE_PATH, parseScreenJournal } from "./screen-guard.js";
import { plfaceOutcomeMessage, plfaceStopMessage, plfaceStateMessage, isVrmPath, avatarRejectedMessage } from "./plface-utils.js";
import { layaStatusMessage, layaOutcomeMessage, layaModelStateMessage, layaModelProgressPercent } from "./laya-utils.js";
import { listen } from "@tauri-apps/api/event";
// T6 : contenu des sélecteurs de niveau de réflexion (socle pur, testé sous Node).
import { thinkingLevelOptions } from "./thinking-levels.js";
// Lot A idée 3 (tranche 3.5) : réglages de la checklist de livraison. Fonctions
// PURES (normalisation du mode, lecture/découpage du modèle) partagées avec la
// fiche de tâche du Kanban — testées dans super-agent-checklist.test.js.
import { normalizeChecklistMode, normalizeChecklistTemplate } from "./super-agent-kanban.js";

let currentConfig = null;

// Thème/sous-thème sauvegardés (pour revert à la fermeture sans enregistrer)
let savedTheme = "dark";
let savedSubtheme = "default";

/**
 * Peuple le sélecteur de sous-thèmes selon le thème (dark/light).
 * @param {HTMLSelectElement} select
 * @param {string} theme
 * @param {string} selected
 */
function populateSubthemeSelect(select, theme, selected) {
  const list = SUBTHEMES[theme] || SUBTHEMES.dark;
  select.innerHTML = "";
  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    if (s.id === selected) opt.selected = true;
    select.appendChild(opt);
  });
}
// Mémorise si on a déjà averti (toast) que le serveur écoute hors localhost,
// pour ne pas spammer au polling de badge toutes les 5 s.
let warnedRemoteBind = false;

/** true si le bind est au-delà de localhost (ex: 0.0.0.0, IP Tailscale, etc.). */
function isBroadBind(bind) {
  const b = (bind || "").trim().toLowerCase();
  return b !== "127.0.0.1" && b !== "localhost" && b !== "::1" && b !== "";
}

/** Affiche un toast d'avertissement (une fois par session de serveur) si le bind
 *  est élargi au-delà de localhost. */
function maybeWarnBroadBind(st) {
  if (!st || !st.running) { warnedRemoteBind = false; return; }
  if (isBroadBind(st.bind) && !warnedRemoteBind) {
    warnedRemoteBind = true;
    showToast(
      `Serveur web exposé sur ${st.bind}:${st.port} — restreignez l'accès via Tailscale/ACL.`,
      "warning",
      8000
    );
  }
  if (!isBroadBind(st.bind)) { warnedRemoteBind = false; }
}

/** Charge la liste des modèles disponibles depuis ~/.pi/agent/models.json */
async function loadModelsList() {
  try {
    return await invoke("get_available_models_list");
  } catch (_) {
    return [];
  }
}

/** Peuple un élément <select> avec les modèles, en conservant l'option "Modèle par défaut" en tête */
function populateModelSelect(selectEl, models, currentValue) {
  // Garder l'option "Modèle par défaut" (première)
  while (selectEl.options.length > 1) selectEl.remove(1);
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
  }
  // Sélectionner la valeur actuelle si elle existe
  if (currentValue && models.includes(currentValue)) {
    selectEl.value = currentValue;
  } else {
    selectEl.value = "";
  }
}

/**
 * T6 — Niveaux de réflexion réellement supportés par un modèle, sans session pi :
 * lecture du registre de pi (`~/.<stem>/agent/models-store.json` puis `models.json`).
 * Aucune liste n'est inventée ; toute erreur rend `[]` (fail-open).
 * @returns {Promise<string[]>}
 */
async function loadThinkingLevelsForModel(modelSpec) {
  const [provider, ...rest] = String(modelSpec || "").split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) return [];
  try {
    const levels = await invoke("available_thinking_levels_for_model", { provider, modelId });
    return Array.isArray(levels) ? levels : [];
  } catch (e) {
    console.warn("[settings] niveaux de réflexion illisibles pour", modelSpec, e);
    return [];
  }
}

/**
 * T6 — Peuple un sélecteur de niveau de réflexion à partir du **modèle réellement
 * utilisé** (jamais une liste codée en dur) et le désactive avec un message
 * explicite quand le modèle ne sait pas raisonner (§8 du plan). Le contenu est
 * calculé par le socle pur (`thinkingLevelOptions`, testé sous Node).
 *
 * @param {HTMLSelectElement|null} selectEl
 * @param {HTMLElement|null} noteEl élément où afficher le message d'indisponibilité
 * @param {string} modelSpec "provider/modelId" du modèle effectif ("" = inconnu)
 * @param {string} current niveau enregistré ("" = non réglé)
 * @param {string} unsetLabel libellé de l'entrée « non réglé »
 */
async function refreshThinkingLevelSelect(selectEl, noteEl, modelSpec, current, unsetLabel) {
  if (!selectEl) return;
  const [provider] = String(modelSpec || "").split("/");
  const levels = await loadThinkingLevelsForModel(modelSpec);
  const res = thinkingLevelOptions(levels, { current, provider, unsetLabel });
  selectEl.innerHTML = "";
  for (const opt of res.options) {
    selectEl.appendChild(new Option(opt.label, opt.value));
  }
  selectEl.value = current || "";
  selectEl.disabled = res.disabled;
  if (noteEl) {
    noteEl.textContent = res.message;
    noteEl.style.display = res.message ? "" : "none";
  }
}

/**
 * T6 — Niveaux de l'Assistant : le modèle effectif est son modèle dédié s'il est
 * défini, sinon le modèle par défaut du backend (même résolution que le moteur,
 * `resolve_super_agent_model`). `available_thinking_levels_for_model` lit le
 * registre du backend `pi` : c'est le moteur de l'Assistant.
 * Les deux éléments DOM sont passés en paramètres (l'appelant les détient).
 */
async function refreshAssistantThinkingLevels(currentConfig, selectEl, noteEl) {
  const modelSpec =
    String(currentConfig.super_agent_default_model || "").trim() ||
    String(currentConfig.super_agent_model || "").trim();
  await refreshThinkingLevelSelect(
    selectEl,
    noteEl,
    modelSpec,
    (currentConfig.super_agent_thinking_level || "").trim(),
    "Non réglé (suit le réglage général)",
  );
}

/**
 * T7 — Niveaux du réglage **général** de Pilot : ce réglage s'applique aux agents
 * dont aucun niveau propre n'est réglé. Il n'est pas lié à un modèle unique : la
 * liste est donc peuplée d'après le **modèle par défaut** des agents
 * (`defaultModel` du `model-switch.json`, celui que le bus utilise comme repli)
 * puis chaque agent ramène le niveau aux capacités de son propre modèle
 * (clamp, §5 du plan). Aucune liste n'est inventée ; registre illisible → état
 * « indisponible » explicite (fail-open).
 */
async function refreshDefaultThinkingLevels(currentConfig, selectEl, noteEl) {
  let modelSpec = "";
  try {
    const cfg = await invoke("read_model_aliases", { stem: "pi" });
    if (cfg && typeof cfg.defaultModel === "string") modelSpec = cfg.defaultModel.trim();
  } catch (e) {
    console.warn("[settings] modèle par défaut illisible pour le niveau de réflexion", e);
  }
  await refreshThinkingLevelSelect(
    selectEl,
    noteEl,
    modelSpec,
    (currentConfig.default_thinking_level || "").trim(),
    "Non réglé (défaut du moteur)",
  );
}

// ── Lot A idée 6 : fréquence par défaut des rappels de surveillance ──
// Bornes alignées sur le backend (super_agent.rs) : minimum technique 60 s et
// plafond de 20 rappels ACTIFS. Les valeurs du <select> sont déjà en secondes.
const SCHEDULE_INTERVAL_DEFAULT_SECS = 3600;
const SCHEDULE_MAX_ACTIVE = 20;

/**
 * Normalise la fréquence choisie (valeur du <select> ou de la config) :
 * entier de secondes, jamais sous le minimum technique de 60 s. Toute valeur
 * absente ou inexploitable retombe sur le défaut (1 heure).
 */
function normalizeScheduleInterval(value) {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return SCHEDULE_INTERVAL_DEFAULT_SECS;
  return Math.max(Math.round(n), 60);
}

/**
 * Affiche « n sur 20 » rappels de surveillance actifs, à côté du réglage de
 * fréquence. Lecture seule (liste des rappels) ; fail-open : en cas d'erreur on
 * n'affiche rien plutôt qu'un chiffre faux.
 */
async function refreshSuperAgentScheduleCount(el) {
  if (!el) return;
  try {
    const res = await invoke("super_agent_schedule_list");
    const rows = res && Array.isArray(res.schedules) ? res.schedules : [];
    const active = rows.filter((s) => s && s.enabled !== false).length;
    el.textContent = `${active} sur ${SCHEDULE_MAX_ACTIVE} rappels de surveillance actifs`;
  } catch (e) {
    console.warn("super_agent_schedule_list (Paramètres):", e);
    el.textContent = "";
  }
}

export async function initSettings() {
  const modal = document.getElementById("settings-modal");
  const btnSettings = document.getElementById("btn-settings");
  const btnSave = document.getElementById("btn-save-settings");
  const btnClose = document.getElementById("btn-close-settings");
  // ── Onglets des paramètres (sidebar verticale) ──
  // Bascule la classe .active entre les .settings-tab et les .settings-panel
  // correspondants (data-settings-tab / data-settings-panel). Les IDs des
  // champs (setting-*, btn-*, tailscale-*, web-*, audit-*) sont inchangés →
  // settings.js continue de fonctionner quel que soit l'onglet actif.
  const settingsTabs = modal.querySelectorAll(".settings-tab");
  settingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.settingsTab;
      settingsTabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      modal.querySelectorAll(".settings-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.settingsPanel === key);
      });
    });
  });
  const selectTheme = document.getElementById("setting-theme");
  const selectSubtheme = document.getElementById("setting-subtheme");
  const inputCmd = document.getElementById("setting-command");
  const chkAutoLoad = document.getElementById("setting-auto-load");
  const chkAutoRun = document.getElementById("setting-auto-run");
  const chkAgentStartOnLaunch = document.getElementById("setting-agent-start-on-launch");
  const chkSuperAgentStartOnLaunch = document.getElementById("setting-super-agent-start-on-launch");
  // ── PLface : lancer mon avatar au démarrage ──
  const chkPlfaceAutostart = document.getElementById("setting-plface-autostart");
  const inputPlfacePath = document.getElementById("setting-plface-path");
  const inputPlfaceAvatar = document.getElementById("setting-plface-avatar");
  const btnPlfaceBrowse = document.getElementById("btn-plface-browse");
  const btnPlfaceAvatarBrowse = document.getElementById("btn-plface-avatar-browse");
  const btnPlfaceTest = document.getElementById("btn-plface-test");
  const btnPlfaceStop = document.getElementById("btn-plface-stop");
  const plfaceTestStatus = document.getElementById("plface-test-status");
  const plfaceState = document.getElementById("plface-runtime-state");
  // ── Service Laya ──
  const chkLayaAutostart = document.getElementById("setting-laya-autostart");
  const inputLayaServicePath = document.getElementById("setting-laya-service-path");
  const inputLayaModelDir = document.getElementById("setting-laya-model-dir");
  const inputLayaNodePath = document.getElementById("setting-laya-node-path");
  const btnLayaServiceBrowse = document.getElementById("btn-laya-service-browse");
  const btnLayaModelBrowse = document.getElementById("btn-laya-model-browse");
  const btnLayaNodeBrowse = document.getElementById("btn-laya-node-browse");
  const btnLayaServiceStart = document.getElementById("btn-laya-service-start");
  const layaState = document.getElementById("laya-runtime-state");
  const layaMessage = document.getElementById("laya-message");
  const chkLayaModelAutoDownload = document.getElementById("setting-laya-model-auto-download");
  const inputLayaModelBaseUrl = document.getElementById("setting-laya-model-base-url");
  const inputLayaFetchPath = document.getElementById("setting-laya-fetch-path");
  const btnLayaFetchBrowse = document.getElementById("btn-laya-fetch-browse");
  const btnLayaModelDownload = document.getElementById("btn-laya-model-download");
  const btnLayaModelCancel = document.getElementById("btn-laya-model-cancel");
  const layaModelBar = document.getElementById("laya-model-bar");
  const layaModelState = document.getElementById("laya-model-state");
  const layaModelMessage = document.getElementById("laya-model-message");
  const chkIntegratedTerminal = document.getElementById("setting-integrated-terminal");
  const chkRpcAgent = document.getElementById("setting-rpc-agent");
  const inputRpcPath = document.getElementById("setting-rpc-path");
  const chkRpcNoSession = document.getElementById("setting-rpc-no-session");
  const inputRpcSessionDir = document.getElementById("setting-rpc-session-dir");
  const chkMultiAgentTabs = document.getElementById("setting-multi-agent-tabs");
  const chkDashboardAutoOpen = document.getElementById("setting-dashboard-auto-open");
  const chkDashboardAutoRefresh = document.getElementById("setting-dashboard-auto-refresh");
  const inputDashboardAutoRefreshSeconds = document.getElementById("setting-dashboard-auto-refresh-seconds");
  const inputSessionRetention = document.getElementById("setting-session-retention");
  const chkShowThinking = document.getElementById("setting-show-thinking");
  // T7 — niveau de réflexion par défaut de Pilot (agents sans réglage propre).
  const selectDefaultThinkingLevel = document.getElementById("setting-default-thinking-level");
  const defaultThinkingLevelNote = document.getElementById("setting-default-thinking-level-note");
  const chkShowTools = document.getElementById("setting-show-tools");
  const chkNotifyAgentDone = document.getElementById("setting-notify-agent-done");
  // ── Détection d'anomalies (tâche 8) ──
  const chkAnomalyEnabled = document.getElementById("setting-anomaly-enabled");
  const inputAnomalyTimeout = document.getElementById("setting-anomaly-timeout");
  const chkAutoStopEnabled = document.getElementById("setting-auto-stop-enabled");
  const inputAutoStopTimeout = document.getElementById("setting-auto-stop-minutes");
  // ── Notifications Telegram (spec_telegram.md, étape 1 : envoi seulement) ──
  const chkTelegramEnabled = document.getElementById("setting-telegram-enabled");
  const inputTelegramToken = document.getElementById("setting-telegram-token");
  const inputTelegramChatId = document.getElementById("setting-telegram-chat-id");
  const inputPdfMdModel = document.getElementById("setting-pdf-md-model");
  // Issue #88 : modèle par défaut DÉDIÉ à l'Assistant (vide = repli sur le
  // modèle par défaut global des agents).
  const inputSuperAgentDefaultModel = document.getElementById("setting-superagent-default-model");
  const chkAutoSave = document.getElementById("setting-auto-save");
  const inputAutoSaveDelay = document.getElementById("setting-auto-save-delay");
  const chkWordWrap = document.getElementById("setting-word-wrap");
  const chkModalAnim = document.getElementById("setting-modal-anim");
  const chkOrchestration = document.getElementById("setting-orchestration");
  const inputOrchestratorModel = document.getElementById("setting-orchestrator-model");
  const inputCoderModel = document.getElementById("setting-coder-model");
  const inputOrchIdleTimeout = document.getElementById("setting-orch-idle-timeout");
  const inputOrchRevisionInterval = document.getElementById("setting-orch-revision-interval");
  const selectOrchGranularity = document.getElementById("setting-orch-granularity");
  const selectOrchBatchSize = document.getElementById("setting-orch-batch-size");
  const chkOrchConfirmModelSwitch = document.getElementById("setting-orch-confirm-model-switch");
  const inputCoderContextWindow = document.getElementById("setting-coder-context-window");
  // ── Auto-test post-modification (E2) ──
  const chkOrchTestEnabled = document.getElementById("setting-orch-test-enabled");
  const inputOrchTestTimeout = document.getElementById("setting-orch-test-timeout");
  const inputOrchTestMaxCorrections = document.getElementById("setting-orch-test-max-corrections");
  const selectOrchTestScope = document.getElementById("setting-orch-test-scope");
  const inputOrchTestCommand = document.getElementById("setting-orch-test-command");
  // ── Snapshots / annulation de tâche (A1) ──
  const chkOrchSnapshotsEnabled = document.getElementById("setting-orch-snapshots-enabled");
  // ── Reviewer indépendant (H2 V1) ──
  const chkOrchReviewerEnabled = document.getElementById("setting-orch-reviewer-enabled");
  const selectOrchReviewerModel = document.getElementById("setting-orch-reviewer-model");
  const selectOrchReviewerScope = document.getElementById("setting-orch-reviewer-scope");
  const taOrchReviewerPatterns = document.getElementById("setting-orch-reviewer-patterns");
  const rowOrchReviewerPatterns = document.getElementById("setting-orch-reviewer-patterns-row");
  // ── Accès distant (mode remote) ──
  const chkWebEnabled = document.getElementById("setting-web-enabled");
  const inputWebBind = document.getElementById("setting-web-bind");
  const inputWebPort = document.getElementById("setting-web-port");
  const chkWebReadonly = document.getElementById("setting-web-readonly");
  const inputWebTtl = document.getElementById("setting-web-ttl");
  const taWebRoots = document.getElementById("setting-web-roots");
  const chkWebKeepalive = document.getElementById("setting-web-keepalive");
  // ── Tailscale Serve auto (spec_web_remote.md §14) ──
  const chkWebTailscaleServe = document.getElementById("setting-web-tailscale-serve");
  // ── GDS (spec_gds.md) : paramètre GLOBAL d'activation/désactivation ──
  const chkGdsEnabled = document.getElementById("setting-gds-enabled");
  // ── Context Engine (H1) ──
  const chkContextEngine = document.getElementById("setting-context-engine");
  const inputContextBudget = document.getElementById("setting-context-budget");
  const chkContextImports = document.getElementById("setting-context-imports");
  const chkContextSpecs = document.getElementById("setting-context-specs");
  const chkContextRecents = document.getElementById("setting-context-recents");
  // ── Context Engine V2 (RAG) — section dédiée ──
  const chkContextRag = document.getElementById("setting-context-rag");
  const inputRagEndpoint = document.getElementById("setting-context-rag-endpoint");
  const inputRagModel = document.getElementById("setting-context-rag-model");
  const ragBlock = document.getElementById("context-rag-block");
  const btnRagTest = document.getElementById("btn-context-rag-test");
  const ragTestStatus = document.getElementById("context-rag-test-status");
  // ── Code Graph (spec_code_graph.md) — section dédiée ──
  const chkCodeGraph = document.getElementById("setting-code-graph-enabled");
  const selectGraphExtraction = document.getElementById("setting-graph-extraction");
  const chkGraphInjectA = document.getElementById("setting-graph-inject-mode-a");
  const inputGraphBudget = document.getElementById("setting-graph-budget-tokens");
  const chkGraphInjectB = document.getElementById("setting-graph-inject-mode-b");
const chkGraphIncludeCalls = document.getElementById("setting-graph-include-calls");
  // ── Super-agent (spec_super_agent.md) ──
  const inputSuperAgentName = document.getElementById("setting-superagent-name");
  const taSuperAgentClients = document.getElementById("setting-superagent-clients");

  /**
   * Clients de l'assistant : la BASE DE SUIVI est la source de vérité (c'est
   * elle que lisent le panneau « Projets & clients », le Suivi et le Kanban).
   * La config n'en garde qu'un MIROIR, qui peut être en retard : remplir la
   * liste depuis la config ferait afficher une liste vide alors que des clients
   * existent — et l'enregistrement les effacerait. On lit donc la base, avec
   * repli sur la config si elle est injoignable.
   */
  function clientNames(list) {
    return (Array.isArray(list) ? list : [])
      .map((c) => (typeof c === "string" ? c : c && c.name))
      .filter(Boolean);
  }

  async function fillSuperAgentClientsFromDb(fallback) {
    if (!taSuperAgentClients) return;
    let names = clientNames(fallback);
    try {
      const res = await invoke("list_clients");
      names = clientNames(res && res.clients);
    } catch (e) {
      console.warn("list_clients:", e);
    }
    taSuperAgentClients.value = names.join("\n");
  }

  /** Applique la liste saisie à la base de suivi (ajouts et retraits réels). */
  async function applySuperAgentClientsToDb(names) {
    const wanted = clientNames(names);
    let current = [];
    try {
      const res = await invoke("list_clients");
      current = clientNames(res && res.clients);
    } catch (e) {
      console.warn("list_clients:", e);
      return;
    }
    for (const name of wanted) {
      if (!current.includes(name)) {
        try { await invoke("add_client", { name }); } catch (e) { console.warn("add_client:", e); }
      }
    }
    for (const name of current) {
      if (!wanted.includes(name)) {
        try { await invoke("remove_client", { name }); } catch (e) { console.warn("remove_client:", e); }
      }
    }
  }
  const taSuperAgentPrompt = document.getElementById("setting-superagent-prompt");
  const chkSuperAgentThinking = document.getElementById("setting-superagent-thinking");
  // T6 : niveau de réflexion de l'Assistant ("" = non réglé → repli sur le
  // réglage général puis sur le défaut du moteur).
  const selectSuperAgentThinkingLevel = document.getElementById("setting-superagent-thinking-level");
  const superAgentThinkingLevelNote = document.getElementById("setting-superagent-thinking-level-note");
  const chkSuperAgentTools = document.getElementById("setting-superagent-tools");
  const chkSuperAgentNotifyDone = document.getElementById("setting-superagent-notify-done");
  const chkAssistantSoundEnabled = document.getElementById("setting-assistant-sound-enabled");
  const inputAssistantSoundVolume = document.getElementById("setting-assistant-sound-volume");
  const assistantSoundVolumeRow = document.getElementById("assistant-sound-volume-row");
  const assistantSoundVolumeLabel = document.getElementById("assistant-sound-volume-label");
  const btnAssistantSoundTest = document.getElementById("btn-assistant-sound-test");
  const chkSuperAgentConcise = document.getElementById("setting-superagent-concise");
  const chkSuperAgentCoordinator = document.getElementById("setting-superagent-coordinator");
  const chkSuperAgentUserFriendly = document.getElementById("setting-superagent-user-friendly");
  const chkSuperAgentBlockAgentInput = document.getElementById("setting-superagent-block-agent-input");
  const chkSuperAgentInvisibleAgent = document.getElementById("setting-superagent-invisible-agent");
  const chkSuperAgentPurgeBeforeDelegate = document.getElementById("setting-superagent-purge-before-delegate");
  const chkSuperAgentQualityGate = document.getElementById("setting-superagent-quality-gate");
const chkSuperAgentForceStructuredBrief = document.getElementById("setting-superagent-force-structured-brief");
const chkSuperAgentInheritContext = document.getElementById("setting-superagent-inherit-context");
const chkSuperAgentAutoCheckStartup = document.getElementById("setting-superagent-auto-check-startup");
// ── Lot A idée 6 : fréquence par défaut des rappels de surveillance ──
const selectSuperAgentScheduleInterval = document.getElementById("setting-superagent-schedule-interval");
const superAgentScheduleCount = document.getElementById("setting-superagent-schedule-count");
// ── Tâche #160 : overlay plein écran des événements ──
const chkSuperAgentEventsOverlay = document.getElementById("setting-superagent-events-overlay");
const inputSuperAgentEventsOverlaySeconds = document.getElementById("setting-superagent-events-overlay-seconds");
const superAgentEventsOverlayDurationRow = document.getElementById("superagent-events-overlay-duration-row");
// Onglet « Tâches » du panneau cloche (actif par défaut).
const chkSuperAgentTasksTab = document.getElementById("setting-superagent-tasks-tab");
// ── Lot A idée 3 (tranche 3.5) : checklist de livraison ──
// Mode de contrôle au passage en « Terminé » (off / warn / block) et modèle de
// points par défaut (un point par ligne) proposé sur une tâche sans point.
const selectSuperAgentChecklistMode = document.getElementById("setting-superagent-checklist-mode");
const taSuperAgentChecklistTemplate = document.getElementById("setting-superagent-checklist-template");
// ── Lot A idée 4 (tranche 5b) : ligne de traçabilité à chaque livraison ──
// Clé `super_agent_tracabilite_enabled` (défaut ON côté Rust : champ absent ⇒
// activé, donc aucune régression pour les configurations existantes).
const chkSuperAgentTracabilite = document.getElementById("setting-superagent-tracabilite");
// ── Lot A idée 2 (tranche 5) : afficher le suivi du temps estimé / passé ──
// Clé `super_agent_show_time` (défaut OFF côté Rust : champ absent ⇒ masqué,
// donc le suivi du temps ne s'affiche pas tant que le propriétaire ne l'a pas
// demandé). Ce réglage ne touche QUE l'affichage.
const chkSuperAgentShowTime = document.getElementById("setting-superagent-show-time");
  // ── Mémoire (transfert de suivi, issue #69) ──
  const chkMemTracking = document.getElementById("mem-tracking");
  const chkMemSettings = document.getElementById("mem-settings");
  const chkMemBehavior = document.getElementById("mem-behavior");
  const chkMemUi = document.getElementById("mem-ui");
  const btnMemExport = document.getElementById("btn-superagent-memory-export");
  const btnMemImport = document.getElementById("btn-superagent-memory-import");
  const memStatus = document.getElementById("mem-status");
  const chkConfirmFileEdits = document.getElementById("setting-confirm-file-edits");
  const chkProjectMemory = document.getElementById("setting-project-memory-enabled");
  const chkProjectMemoryAuto = document.getElementById("setting-project-memory-auto-extract");
  // ── Gestion d'agents multi-rôles (H2 V2) ──
  const inputAgentMaxDepth = document.getElementById("setting-agent-max-depth");
  const inputAgentMaxTotalCalls = document.getElementById("setting-agent-max-total-calls");
  const inputAgentTimeoutMs = document.getElementById("setting-agent-timeout-ms");
  const inputAgentMaxResultTokens = document.getElementById("setting-agent-max-result-tokens");
  const inputAgentMaxTurns = document.getElementById("setting-agent-max-turns");
  // ── Agents du projet (issue #35) : config `.pilot/agents.json` ──
  const projectAgentsProject = document.getElementById("project-agents-project");
  const projectAgentsWarn = document.getElementById("project-agents-warn");
  const projectAgentsList = document.getElementById("project-agents-list");
  const projectAgentsStatus = document.getElementById("project-agents-status");
  const btnAddProjectAgent = document.getElementById("btn-add-project-agent");
  const btnSaveProjectAgents = document.getElementById("btn-save-project-agents");
  let projectAgents = []; // état éditable (liste {id, name})
  let projectAgentsDirty = false;
  const tsBlock = document.getElementById("tailscale-block");
  const tsBadge = document.getElementById("tailscale-badge");
  const tsUrl = document.getElementById("tailscale-url");
  const tsCopyBtn = document.getElementById("btn-tailscale-copy");
  const tsQrcode = document.getElementById("tailscale-qrcode");
  const tsServeStatus = document.getElementById("tailscale-serve-status");
  const tsReconfigureBtn = document.getElementById("btn-tailscale-reconfigure");
  let tailscaleChanged = false; // flag levé si la checkbox Tailscale Serve change
  const webPwStatus = document.getElementById("web-pw-status");
  const btnWebSetPw = document.getElementById("btn-web-set-password");
  const btnWebClearPw = document.getElementById("btn-web-clear-password");
  const webActiveCount = document.getElementById("web-active-count");
  const btnWebKick = document.getElementById("btn-web-kick");
  const btnWebAudit = document.getElementById("btn-web-audit");
  const remoteBadge = document.getElementById("remote-badge");
  const remoteBadgeCount = document.getElementById("remote-badge-count");
  let webNetChanged = false; // flag levé si web_enabled/bind/port changent → reload serveur
  let rpcLaunchChanged = false; // flag levé si rpc_pi_path/no_session/session_dir changent → relance agent
  let confirmEditsChanged = false; // flag levé si confirm_file_edits change → relance agent (charger/décharger l'extension pilot-edit-gate)

  // ── Journal d'audit distant ──
  const auditModal = document.getElementById("audit-modal");
  const auditClose = document.getElementById("audit-close");
  const btnAuditRefresh = document.getElementById("btn-audit-refresh");
  const btnAuditClear = document.getElementById("btn-audit-clear");
  const auditBody = document.getElementById("audit-body");
  const auditCount = document.getElementById("audit-count");

  const ACTION_LABELS = {
    login: 'Login', prompt: 'Prompt', abort: 'Stop', new: 'New', compact: 'Compact',
    set_model: 'Modèle', project_open: 'Projet', ws_open: 'WS', kick: 'Kick',
    set_password: 'Mot de passe', rate_limited: 'Limité',
  };

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  }
  function shortSubject(s) { return s ? s.slice(0, 8) : '—'; }

  async function loadAudit() {
    try {
      const entries = await invoke("web_audit_log", { n: 200 });
      renderAudit(Array.isArray(entries) ? entries : []);
    } catch (e) {
      auditBody.innerHTML = '<tr><td colspan="6" class="muted">Erreur : ' + String(e) + '</td></tr>';
      auditCount.textContent = '';
    }
  }

  function renderAudit(entries) {
    auditCount.textContent = entries.length + ' entrée(s)';
    if (!entries.length) {
      auditBody.innerHTML = '<tr><td colspan="6" class="muted">Aucune activité distante enregistrée.</td></tr>';
      return;
    }
    // Plus récente en haut (le backend renvoie ancien → récent, on inverse).
    const rows = entries.slice().reverse().map((e) => {
      const label = ACTION_LABELS[e.action] || e.action;
      const cls = e.ok ? 'ok' : 'fail';
      const state = e.ok ? '✓' : '✗';
      return '<tr class="' + cls + '">'
        + '<td>' + escapeHtml(fmtTime(e.ts)) + '</td>'
        + '<td>' + escapeHtml(e.ip || '—') + '</td>'
        + '<td>' + escapeHtml(shortSubject(e.subject)) + '</td>'
        + '<td><span class="audit-badge' + (e.ok ? '' : ' bad') + '">' + escapeHtml(label) + '</span></td>'
        + '<td class="detail">' + escapeHtml(e.detail || '') + '</td>'
        + '<td>' + state + '</td>'
        + '</tr>';
    }).join('');
    auditBody.innerHTML = rows;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ── Agents du projet (issue #35) ──
  function renderProjectAgentsList() {
    if (!projectAgentsList) return;
    projectAgentsList.innerHTML = "";
    if (projectAgents.length === 0) {
      projectAgentsList.innerHTML = '<div style="font-size:12px;opacity:.6;padding:4px 0;">Aucun agent configuré pour ce projet.</div>';
      return;
    }
    projectAgents.forEach((agent, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;";
      const label = document.createElement("span");
      label.style.cssText = "font-size:11px;opacity:.6;min-width:70px;";
      label.textContent = agent.id;
      const input = document.createElement("input");
      input.type = "text";
      input.value = agent.name || "";
      input.placeholder = "Nom de l'agent";
      input.style.cssText = "flex:1;min-width:0;padding:4px 8px;border:1px solid var(--border-color,#444);background:var(--bg-color,#222);color:var(--text-color,#ddd);border-radius:6px;";
      input.addEventListener("input", () => {
        projectAgents[i].name = input.value.trim();
        projectAgentsDirty = true;
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "web-btn";
      del.textContent = "✕";
      del.title = "Retirer cet agent";
      del.addEventListener("click", () => {
        projectAgents.splice(i, 1);
        projectAgentsDirty = true;
        renderProjectAgentsList();
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(del);
      projectAgentsList.appendChild(row);
    });
  }

  async function loadProjectAgents() {
    projectAgentsDirty = false;
    if (!projectAgentsList) return;
    const path = window._pilotProjectPath || "";
    if (projectAgentsProject) {
      projectAgentsProject.textContent = path
        ? (path.replace(/\\/g, "/").split("/").pop() || path)
        : "— (aucun projet)";
    }
    if (!path) {
      projectAgents = [];
      if (projectAgentsWarn) projectAgentsWarn.style.display = "block";
      renderProjectAgentsList();
      return;
    }
    projectAgents = await invoke("read_project_agents", { projectPath: path }).catch(() => []);
    renderProjectAgentsList();
    const enabled = currentConfig?.multi_agent_tabs === true;
    if (projectAgentsWarn) projectAgentsWarn.style.display = enabled ? "none" : "block";
    if (projectAgentsStatus) projectAgentsStatus.textContent = "";
  }

  async function saveProjectAgents() {
    const path = window._pilotProjectPath;
    if (!path) { alert("Aucun projet ouvert pour enregistrer la config d'agents."); return; }
    if (projectAgentsStatus) projectAgentsStatus.textContent = "Enregistrement…";
    try {
      await invoke("write_project_agents", { projectPath: path, agents: projectAgents });
      projectAgentsDirty = false;
      // Issue #35 : ouvrir immédiatement les agents paramétrés qui ne le sont pas
      // déjà (ex: config enregistrée depuis Paramètres), si le multi-onglets est
      // activé. Chaque `_openAgent` démarre/reprent sa propre session.
      if (currentConfig?.multi_agent_tabs === true && window._pilotTabs) {
        for (const a of projectAgents) {
          const exists = window._pilotTabs.tabs.some((t) => t.mode === "agent" && (t.agentId || "default") === a.id);
          if (!exists) {
            try {
              await window._pilotTabs._openAgent(a.name || a.id, a.id);
            } catch (_) { /* agent indisponible (gate health E4) → on ignore */ }
          }
        }
      }
      if (projectAgentsStatus) projectAgentsStatus.textContent = "✓ Enregistré";
      setTimeout(() => { if (projectAgentsStatus) projectAgentsStatus.textContent = ""; }, 2000);
    } catch (e) {
      if (projectAgentsStatus) projectAgentsStatus.textContent = "Erreur : " + e;
    }
  }

  btnAddProjectAgent?.addEventListener("click", () => {
    const used = new Set(projectAgents.map((a) => a.id));
    let n = 1;
    while (used.has(`agent-${n}`)) n++;
    projectAgents.push({ id: `agent-${n}`, name: `Agent ${n}` });
    projectAgentsDirty = true;
    renderProjectAgentsList();
  });
  btnSaveProjectAgents?.addEventListener("click", saveProjectAgents);

  // ── Serveurs MCP (POC) — onglet dédié dans les Paramètres ──
  const chkMcpEnabled = document.getElementById("setting-mcp-enabled");
  const chkMcpAgentConfirm = document.getElementById("setting-mcp-agent-confirm");
  const chkMcpSecretStrict = document.getElementById("setting-mcp-secret-strict");
  const mcpServersList = document.getElementById("mcp-servers-list");
  const btnMcpAdd = document.getElementById("btn-mcp-add");
  const btnMcpReload = document.getElementById("btn-mcp-reload");
  const mcpEditor = document.getElementById("mcp-editor");
  const mcpFName = document.getElementById("mcp-f-name");
  const mcpFTransport = document.getElementById("mcp-f-transport");
  const mcpFLocalFields = document.getElementById("mcp-fields-local");
  const mcpFRemoteFields = document.getElementById("mcp-fields-remote");
  const mcpFCommand = document.getElementById("mcp-f-command");
  const mcpFArgs = document.getElementById("mcp-f-args");
  const mcpFEnv = document.getElementById("mcp-f-env");
  const mcpFUrl = document.getElementById("mcp-f-url");
  const mcpFSecretRef = document.getElementById("mcp-f-secret-ref");
  const mcpSecretRefList = document.getElementById("mcp-secret-ref-list");
  const mcpSecretRefStatus = document.getElementById("mcp-f-secret-ref-status");
  const mcpFEnabled = document.getElementById("mcp-f-enabled");
  const mcpFScreen = document.getElementById("mcp-f-screen");
  const mcpFStatus = document.getElementById("mcp-f-status");
  const btnMcpSave = document.getElementById("btn-mcp-save");
  const btnMcpCancel = document.getElementById("btn-mcp-cancel");
  const mcpStatus = document.getElementById("mcp-status");
  // Contrôle de l'écran par les agents (serveurs MCP « écran »).
  const chkMcpScreenEnabled = document.getElementById("setting-mcp-screen-enabled");
  const chkMcpScreenSimulation = document.getElementById("setting-mcp-screen-simulation");
  const btnMcpScreenStop = document.getElementById("btn-mcp-screen-stop");
  const btnMcpScreenResume = document.getElementById("btn-mcp-screen-resume");
  const btnMcpScreenLog = document.getElementById("btn-mcp-screen-log");
  const mcpScreenStatus = document.getElementById("mcp-screen-status");
  const mcpScreenLog = document.getElementById("mcp-screen-log");
  let mcpServers = []; // état éditable ([{id,name,transport,enabled,command,args}])
  let mcpEditingId = null; // id du serveur en cours d'édition (null = nouveau)

  // ── Contrôle de l'écran par les agents ──
  // Réglages miroir de `screen-guard.js` : le contrôle est ACTIVÉ par défaut,
  // mais en SIMULATION (état sûr). L'arrêt d'urgence est un réglage PERSISTÉ :
  // il survit au redémarrage, d'où l'écriture immédiate côté Rust.

  /** Aligne les cases et le libellé d'état sur `currentConfig`. */
  function syncScreenGuardControls() {
    const enabled = !(currentConfig && currentConfig.screen_control_enabled === false);
    const simulation = !(currentConfig && currentConfig.screen_control_simulation === false);
    const emergency = !!(currentConfig && currentConfig.screen_control_emergency_stop === true);
    if (chkMcpScreenEnabled) chkMcpScreenEnabled.checked = enabled;
    if (chkMcpScreenSimulation) chkMcpScreenSimulation.checked = simulation;
    setMcpScreenStatus(
      emergency
        ? "🛑 Arrêt d'urgence ACTIF : aucune action sur l'écran ne peut partir (même après redémarrage) tant que vous n'avez pas rétabli le contrôle."
        : enabled
          ? simulation
            ? "Contrôle de l'écran autorisé, en simulation : votre accord est demandé, mais rien n'est réellement exécuté."
            : "⚠️ Contrôle de l'écran autorisé en mode réel : une action autorisée s'exécute vraiment sur votre écran."
          : "Contrôle de l'écran désactivé : les outils d'écran ne sont pas proposés à l'agent.",
      emergency ? "var(--danger,#f87171)" : enabled && !simulation ? "var(--warning,#fbbf24)" : "var(--text-muted)",
    );
  }

  function setMcpScreenStatus(text, color) {
    if (!mcpScreenStatus) return;
    mcpScreenStatus.style.whiteSpace = "pre-line";
    mcpScreenStatus.textContent = text || "";
    if (color) mcpScreenStatus.style.color = color;
  }

  /** Enregistre les trois réglages côté Rust. Le miroir local `currentConfig`
   * est mis à jour AUSSI : `save_config` (modale Paramètres) réécrit toute la
   * configuration, il doit porter les valeurs courantes et non les anciennes. */
  function applyScreenGuardLocally(enabled, simulation, emergencyStop) {
    if (currentConfig) {
      currentConfig.screen_control_enabled = enabled;
      currentConfig.screen_control_simulation = simulation;
      currentConfig.screen_control_emergency_stop = emergencyStop;
    }
    syncScreenGuardControls();
  }

  async function saveScreenGuard(enabled, simulation, emergencyStop) {
    try {
      await invoke("mcp_set_screen_guard", { enabled, simulation, emergencyStop });
      applyScreenGuardLocally(enabled, simulation, emergencyStop);
      return true;
    } catch (e) {
      syncScreenGuardControls();
      alert("Erreur : " + e);
      return false;
    }
  }

  /** Affiche/masque le journal des actions écran du projet ouvert (heure,
   * action, résultat). Aucun contenu sensible n'y est inscrit. */
  async function toggleMcpScreenLog() {
    if (!mcpScreenLog) return;
    if (mcpScreenLog.style.display !== "none") {
      mcpScreenLog.style.display = "none";
      return;
    }
    mcpScreenLog.style.display = "block";
    const base = window._pilotProjectPath;
    if (!base) {
      mcpScreenLog.textContent =
        "Aucun projet ouvert : le journal est propre à chaque projet.";
      return;
    }
    mcpScreenLog.textContent = "Chargement…";
    try {
      const text = await invoke("read_file_content", {
        path: `${String(base).replace(/[\\/]+$/, "")}/${SCREEN_JOURNAL_RELATIVE_PATH}`,
      });
      const entries = parseScreenJournal(text, 100);
      mcpScreenLog.textContent = entries.length
        ? entries
            .map((x) => `${x.at}  ${x.tool}  ${x.outcome}${x.detail ? "  " + x.detail : ""}`)
            .join("\n")
        : "Journal vide : aucune action sur l'écran n'a encore été demandée dans ce projet.";
    } catch (_) {
      mcpScreenLog.textContent =
        "Aucun journal pour ce projet : aucune action sur l'écran n'a encore été demandée.";
    }
  }

  function setMcpStatus(text, color) {
    if (!mcpStatus) return;
    mcpStatus.textContent = text || "";
    mcpStatus.style.color = color || "var(--text-muted)";
  }

  async function loadMcp() {
    if (!chkMcpEnabled) return;
    try {
      const list = await invoke("mcp_list_servers");
      mcpServers = Array.isArray(list) ? list : [];
    } catch (_) {
      mcpServers = [];
    }
    chkMcpEnabled.checked = !!(currentConfig && currentConfig.mcp_enabled);
    chkMcpAgentConfirm.checked = !!(currentConfig && currentConfig.mcp_agent_confirm);
    // Mode strict de la clé du coffre : ACTIVÉ par défaut (y compris pour une
    // configuration antérieure au réglage). Désactivé = ancien comportement.
    if (chkMcpSecretStrict) {
      chkMcpSecretStrict.checked = !(currentConfig && currentConfig.mcp_secret_strict === false);
    }
    syncScreenGuardControls();
    setMcpStatus("");
    renderMcpServers();
  }

  // Affiche les champs utiles au type choisi : local → commande/arguments ;
  // distant → adresse/référence de clé. Le type est le seul aiguillage.
  function applyMcpTransportVisibility() {
    const remote = !!(mcpFTransport && mcpFTransport.value === "http");
    if (mcpFLocalFields) mcpFLocalFields.style.display = remote ? "none" : "";
    if (mcpFRemoteFields) mcpFRemoteFields.style.display = remote ? "" : "none";
  }

  function renderMcpServers() {
    if (!mcpServersList) return;
    mcpServersList.innerHTML = "";
    if (mcpServers.length === 0) {
      mcpServersList.innerHTML = '<div style="font-size:12px;opacity:.6;padding:4px 0;">Aucun serveur MCP configuré. Ajoutez-en un pour permettre à l agent de s&apos;y connecter.</div>';
      return;
    }
    mcpServers.forEach((s) => {
      const card = document.createElement("div");
      card.className = "mcp-server-card";
      const badge = document.createElement("span");
      badge.className = "mcp-badge " + (s.enabled ? "ok" : "off");
      badge.textContent = s.enabled ? "activé" : "désactivé";
      const info = document.createElement("div");
      info.className = "mcp-server-info";
      const title = document.createElement("div");
      title.className = "mcp-server-title";
      title.textContent = s.name || s.id || "(sans nom)";
      const meta = document.createElement("div");
      meta.className = "mcp-server-meta";
      // Serveur distant : « distant » + adresse ; pour un serveur local : « stdio »
      // + commande. La référence de coffre peut être affichée, JAMAIS la clé.
      const remote = isRemoteTransport(s.transport);
      if (remote) {
        meta.textContent = "distant · " + (s.url || "—") + (s.secret_ref ? " · clé demandée : " + s.secret_ref : " · aucune clé");
      } else {
        // La clé d'un serveur LOCAL est elle aussi possible depuis la tâche 399
        // (référence de coffre transmise dans son environnement).
        meta.textContent = (((s.transport || "stdio") + " · " + ((s.command || "") + " " + formatArgs(s.args || [])).trim()) || "—") +
          (s.secret_ref ? " · clé demandée : " + s.secret_ref : " · aucune clé");
      }
      info.appendChild(title);
      info.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "mcp-server-actions";
      const btnTest = document.createElement("button");
      btnTest.type = "button"; btnTest.className = "web-btn"; btnTest.textContent = "Tester";
      btnTest.addEventListener("click", () => testMcpServer(s));
      const btnEdit = document.createElement("button");
      btnEdit.type = "button"; btnEdit.className = "web-btn"; btnEdit.textContent = "Modifier";
      btnEdit.addEventListener("click", () => openMcpEditor(s));
      const btnDel = document.createElement("button");
      btnDel.type = "button"; btnDel.className = "web-btn web-btn-danger"; btnDel.textContent = "Supprimer";
      btnDel.addEventListener("click", () => deleteMcpServer(s));
      actions.appendChild(btnTest);
      actions.appendChild(btnEdit);
      actions.appendChild(btnDel);
      card.appendChild(badge);
      card.appendChild(info);
      card.appendChild(actions);
      mcpServersList.appendChild(card);
    });
  }

  // Propose les entrées du coffre dans le champ « Clé » (liste déroulante du
  // champ, saisie libre conservée). `vault_list_refs` ne renvoie que la
  // référence, la description et la portée : jamais le mot de passe.
  // Le coffre doit être déverrouillé ; sinon on guide vers l'onglet 🔐 au lieu
  // d'une liste vide muette. Point de décision UNIQUE : `openMcpEditor`.
  async function fillMcpSecretRefOptions() {
    if (!mcpSecretRefList) return;
    mcpSecretRefList.innerHTML = "";
    const setStatus = (text) => {
      if (mcpSecretRefStatus) mcpSecretRefStatus.textContent = text;
    };
    let refs = [];
    try {
      refs = await invoke("vault_list_refs");
    } catch (e) {
      setStatus("Coffre 🔐 verrouillé ou inaccessible : déverrouillez-le (onglet 🔐) pour choisir une entrée ici. (" + e + ")");
      return;
    }
    refs = Array.isArray(refs) ? refs : [];
    refs.forEach((e) => {
      const reference = "vault:" + e.id;
      const label = e.description || "(sans description)";
      const opt = document.createElement("option");
      opt.value = reference;
      opt.label = label;
      opt.textContent = label + " · " + reference;
      mcpSecretRefList.appendChild(opt);
    });
    setStatus(
      refs.length === 0
        ? "Le coffre 🔐 ne contient aucune entrée : ajoutez-en une (description + mot de passe), puis choisissez-la ici."
        : refs.length + " entrée(s) du coffre 🔐 disponible(s) dans la liste du champ."
    );
  }

  function openMcpEditor(s) {
    mcpEditingId = s ? s.id : null;
    if (mcpFTransport) mcpFTransport.value = (s && isRemoteTransport(s.transport)) ? "http" : MCP_TRANSPORT_STDIO;
    mcpFName.value = s ? (s.name || "") : "";
    mcpFCommand.value = s ? (s.command || "") : "";
    mcpFArgs.value = s ? formatArgs(s.args || []) : "";
    if (mcpFEnv) mcpFEnv.value = s ? formatEnv(s.env) : "";
    if (mcpFUrl) mcpFUrl.value = s ? (s.url || "") : "";
    if (mcpFSecretRef) mcpFSecretRef.value = s ? (s.secret_ref || "") : "";
    // Une référence déjà enregistrée reste affichée telle quelle, même si elle
    // n'est plus (ou pas encore) dans la liste : on n'écrase rien.
    fillMcpSecretRefOptions();
    if (mcpFEnabled) mcpFEnabled.checked = s ? !!s.enabled : true;
    if (mcpFScreen) mcpFScreen.checked = s ? !!s.screen : false;
    applyMcpTransportVisibility();
    mcpFStatus.textContent = "";
    mcpFStatus.style.color = "var(--text-muted)";
    if (mcpEditor) {
      mcpEditor.style.display = "block";
      mcpEditor.scrollIntoView({ block: "nearest" });
    }
  }

  async function saveMcpServer() {
    const transport = mcpFTransport ? mcpFTransport.value : MCP_TRANSPORT_STDIO;
    const form = {
      name: mcpFName.value,
      transport,
      command: mcpFCommand.value,
      argsText: mcpFArgs.value,
      envText: mcpFEnv ? mcpFEnv.value : "",
      url: mcpFUrl ? mcpFUrl.value : "",
      secretRef: mcpFSecretRef ? mcpFSecretRef.value : "",
      enabled: mcpFEnabled.checked,
      screen: mcpFScreen ? mcpFScreen.checked : false,
    };
    const err = validateServer(form);
    if (err) { mcpFStatus.textContent = "⚠ " + err; mcpFStatus.style.color = "var(--danger,#f87171)"; return; }
    const id = mcpEditingId || newServerId(mcpServers);
    const server = buildServer(id, form);
    mcpFStatus.textContent = "Enregistrement…";
    mcpFStatus.style.color = "var(--text-muted)";
    try {
      if (mcpEditingId) {
        mcpServers = mcpServers.map((x) => (x.id === mcpEditingId ? server : x));
      } else {
        mcpServers.push(server);
      }
      await invoke("mcp_save_servers", { servers: mcpServers });
      mcpEditingId = null;
      mcpEditor.style.display = "none";
      renderMcpServers();
      setMcpStatus("✓ Serveurs enregistrés.", "var(--success,#4ade80)");
      setTimeout(() => setMcpStatus(""), 2500);
    } catch (e) {
      mcpFStatus.textContent = "Erreur : " + e;
      mcpFStatus.style.color = "var(--danger,#f87171)";
    }
  }

  async function deleteMcpServer(s) {
    const label = s.name || s.id || "ce serveur";
    if (!confirm(`Supprimer le serveur MCP « ${label} » ?`)) return;
    const next = mcpServers.filter((x) => x.id !== s.id);
    try {
      await invoke("mcp_save_servers", { servers: next });
      mcpServers = next;
      renderMcpServers();
      if (mcpEditingId === s.id) { mcpEditingId = null; if (mcpEditor) mcpEditor.style.display = "none"; }
    } catch (e) {
      alert("Erreur : " + e);
    }
  }

  async function testMcpServer(s) {
    const label = s.name || s.id || "serveur";
    setMcpStatus(`⏳ Test de « ${label} »…`);
    try {
      const res = await invoke("mcp_test_connection", { server: s });
      const r = testResult(res);
      if (r.ok) {
        // Tâche 309 : montrer ce que le serveur sait faire, au lieu de laisser
        // l'utilisateur le deviner. `tools` est la liste annoncée par le serveur
        // (nom + description courte) ; `toolsError` explique une découverte
        // impossible (le serveur n'a pas répondu à `tools/list`).
        const tools = Array.isArray(res && res.tools) ? res.tools : [];
        const lines = [`✓ Connexion au serveur « ${label} » réussie.`];
        if (tools.length) {
          lines.push(`${tools.length} outil(s) exposé(s) :`);
          for (const t of tools) {
            const desc = String((t && t.description) || "").trim();
            const short = desc.length > 120 ? desc.slice(0, 117) + "…" : desc;
            lines.push(`  • ${t.name}${short ? ` — ${short}` : ""}`);
          }
        } else if (res && res.toolsError) {
          lines.push(`Aucun outil listé : ${res.toolsError}`);
        } else {
          lines.push("Ce serveur n'expose aucun outil.");
        }
        // État de la clé du coffre pour CE serveur (tâche 399) : dit toujours
        // si le serveur tourne avec ou sans clé — jamais une valeur.
        if (res && res.secretStatus) {
          lines.push(`Clé du coffre : ${secretStatusLabel(res.secretStatus)}.`);
        }
        // Statut multi-ligne (le span est inline : sans cela les sauts de ligne
        // seraient écrasés et la liste serait illisible).
        if (mcpStatus) mcpStatus.style.whiteSpace = "pre-line";
        setMcpStatus(lines.join("\n"), "var(--success,#4ade80)");
        showToast(
          `MCP : connexion OK (${label}) — ${tools.length} outil(s)`,
          "success",
          4000,
        );
      } else {
        setMcpStatus(`❌ ${r.error || `Échec de connexion au serveur « ${label} ».`}`, "var(--danger,#f87171)");
      }
    } catch (e) {
      setMcpStatus(`❌ ${e}`, "var(--danger,#f87171)");
    }
  }

  btnMcpAdd?.addEventListener("click", () => openMcpEditor(null));
  btnMcpReload?.addEventListener("click", loadMcp);
  btnMcpCancel?.addEventListener("click", () => {
    mcpEditingId = null;
    if (mcpEditor) mcpEditor.style.display = "none";
  });
  btnMcpSave?.addEventListener("click", saveMcpServer);
  mcpFTransport?.addEventListener("change", applyMcpTransportVisibility);
  // Toggle global → persisté immédiatement (flag consommateur Pilot, distinct de
  // la liste des serveurs). Revert visuel si le backend échoue.
  chkMcpEnabled?.addEventListener("change", async () => {
    if (!chkMcpEnabled) return;
    try {
      await invoke("mcp_set_enabled", { enabled: chkMcpEnabled.checked });
    } catch (e) {
      chkMcpEnabled.checked = !chkMcpEnabled.checked;
      alert("Erreur : " + e);
    }
  });
  // Confirmation utilisateur avant qu'un agent utilise un serveur MCP (brique
  // C) : activée par défaut. L'assistant la lit via mcp_state et demande un
  // confirmation (ask_confirm) avant de lancer un agent sur un serveur MCP.
  chkMcpAgentConfirm?.addEventListener("change", async () => {
    if (!chkMcpAgentConfirm) return;
    try {
      await invoke("mcp_set_agent_confirm", { enabled: chkMcpAgentConfirm.checked });
    } catch (e) {
      chkMcpAgentConfirm.checked = !chkMcpAgentConfirm.checked;
      alert("Erreur : " + e);
    }
  });
  // Restriction de la clé du coffre au serveur qui la demande (tâche 399) :
  // persistée immédiatement (l'extension relit `config.json` à chaque spawn),
  // revert visuel si le backend échoue. Désactiver = ancien comportement.
  chkMcpSecretStrict?.addEventListener("change", async () => {
    if (!chkMcpSecretStrict) return;
    try {
      await invoke("mcp_set_secret_strict", { enabled: chkMcpSecretStrict.checked });
    } catch (e) {
      chkMcpSecretStrict.checked = !chkMcpSecretStrict.checked;
      alert("Erreur : " + e);
    }
  });

  // Contrôle de l'écran : chaque case est persistée immédiatement (effet sans
  // redémarrer l'agent, qui relit la configuration à chaque action).
  chkMcpScreenEnabled?.addEventListener("change", () => {
    saveScreenGuard(
      !!chkMcpScreenEnabled.checked,
      !!(chkMcpScreenSimulation && chkMcpScreenSimulation.checked),
      false,
    );
  });
  chkMcpScreenSimulation?.addEventListener("change", () => {
    saveScreenGuard(
      !!(chkMcpScreenEnabled && chkMcpScreenEnabled.checked),
      !!chkMcpScreenSimulation.checked,
      false,
    );
  });
  // Arrêt d'urgence : coupe l'autorisation ET refuse les actions en attente.
  btnMcpScreenStop?.addEventListener("click", async () => {
    await saveScreenGuard(false, false, true);
    try {
      window.dispatchEvent(new CustomEvent("pilot-screen-emergency-stop"));
    } catch (_) {}
  });
  // Rétablissement : retour à un ÉTAT SÛR (autorisé, mais en simulation).
  btnMcpScreenResume?.addEventListener("click", () => saveScreenGuard(true, true, false));
  btnMcpScreenLog?.addEventListener("click", toggleMcpScreenLog);

  btnWebAudit.addEventListener("click", async (e) => {
    auditModal.classList.remove("hidden");
    animateModalOpen(auditModal, e.clientX, e.clientY);
    await loadAudit();
  });
  auditClose.addEventListener("click", () => auditModal.classList.add("hidden"));
  auditModal.addEventListener("click", (e) => { if (e.target === auditModal) auditModal.classList.add("hidden"); });
  btnAuditRefresh.addEventListener("click", loadAudit);
  btnAuditClear.addEventListener("click", async () => {
    if (!confirm("Effacer toutes les entrées du journal d'audit distant ?")) return;
    try { await invoke("web_audit_clear"); await loadAudit(); } catch (e) { alert('Erreur : ' + e); }
  });

  // Ouvrir la modale
  btnSettings.addEventListener("click", async (e) => {
    const clickX = e.clientX, clickY = e.clientY;
    try {
      currentConfig = await invoke("get_config");
    } catch (e) {
      // Réserve R-B : sans configuration lisible, ouvrir la modale sur un objet
      // par défaut ferait persister ces défauts à l'enregistrement (perte de TOUS
      // les réglages). On ANNULE l'ouverture avec un message clair.
      console.error("get_config (Paramètres):", e);
      alert("Configuration indisponible pour le moment. Réessayez dans un instant : aucun réglage n'a été modifié.");
      return;
    }
    // Agents du projet (issue #35) : charger la config du projet actif.
    await loadProjectAgents();
    await loadMcp();
    selectTheme.value = currentConfig.theme || "dark";
    inputCmd.value = currentConfig.default_command || "";
    chkAutoLoad.checked = currentConfig.auto_load_last_project || false;
    chkAutoRun.checked = currentConfig.auto_run_command || false;
    chkAgentStartOnLaunch.checked = currentConfig.agent_start_on_launch === true;
    // Start assistant on launch: DEFAULT ENABLED (undefined = true for old
    // configs without the super_agent_start_on_launch field).
    if (chkSuperAgentStartOnLaunch) chkSuperAgentStartOnLaunch.checked = currentConfig.super_agent_start_on_launch !== false;
    // ── PLface : lancement de l'avatar au démarrage (désactivé par défaut) ──
    if (chkPlfaceAutostart) chkPlfaceAutostart.checked = currentConfig.plface_autostart_enabled === true;
    if (inputPlfacePath) inputPlfacePath.value = currentConfig.plface_exe_path || "";
    if (inputPlfaceAvatar) inputPlfaceAvatar.value = currentConfig.plface_avatar_path || "";
    refreshPlfaceState();
    // ── Service Laya : réglages du service local ──
    if (chkLayaAutostart) chkLayaAutostart.checked = currentConfig.laya_autostart_enabled === true;
    if (inputLayaServicePath) inputLayaServicePath.value = currentConfig.laya_service_path || "";
    if (inputLayaModelDir) inputLayaModelDir.value = currentConfig.laya_model_dir || "";
    if (inputLayaNodePath) inputLayaNodePath.value = currentConfig.laya_node_path || "";
    if (chkLayaModelAutoDownload) chkLayaModelAutoDownload.checked = currentConfig.laya_model_auto_download_enabled === true;
    if (inputLayaModelBaseUrl) inputLayaModelBaseUrl.value = currentConfig.laya_model_base_url || "";
    if (inputLayaFetchPath) inputLayaFetchPath.value = currentConfig.laya_fetch_path || "";
    refreshLayaState();
    startLayaProgressListener();
    refreshLayaModelState();
    chkIntegratedTerminal.checked = currentConfig.integrated_terminal || false;
    chkRpcAgent.checked = currentConfig.rpc_agent_enabled || false;
    inputRpcPath.value = currentConfig.rpc_pi_path || "";
    chkRpcNoSession.checked = currentConfig.rpc_no_session || false;
    inputRpcSessionDir.value = currentConfig.rpc_session_dir || "";
    if (chkMultiAgentTabs) chkMultiAgentTabs.checked = currentConfig.multi_agent_tabs === true;
    if (chkDashboardAutoOpen) chkDashboardAutoOpen.checked = currentConfig.dashboard_auto_open === true;
    if (chkDashboardAutoRefresh) chkDashboardAutoRefresh.checked = currentConfig.dashboard_auto_refresh !== false;
    if (inputDashboardAutoRefreshSeconds) inputDashboardAutoRefreshSeconds.value = currentConfig.dashboard_auto_refresh_seconds ?? 120;
    if (inputSessionRetention) inputSessionRetention.value = currentConfig.session_retention_days ?? 15;
    chkShowThinking.checked = currentConfig.show_thinking !== false;
    await refreshDefaultThinkingLevels(
      currentConfig,
      selectDefaultThinkingLevel,
      defaultThinkingLevelNote,
    );
    chkShowTools.checked = currentConfig.show_tools || false;
    if (chkNotifyAgentDone) chkNotifyAgentDone.checked = currentConfig.notify_agent_done === true;
    // ── Détection d'anomalies (tâche 8) ──
    if (chkAnomalyEnabled) chkAnomalyEnabled.checked = currentConfig.anomaly_detection_enabled !== false;
    if (inputAnomalyTimeout) inputAnomalyTimeout.value = currentConfig.anomaly_timeout_minutes ?? 30;
    if (chkAutoStopEnabled) chkAutoStopEnabled.checked = currentConfig.agent_auto_stop_enabled !== false;
    if (inputAutoStopTimeout) inputAutoStopTimeout.value = currentConfig.agent_auto_stop_minutes ?? 10;
    // ── Notifications Telegram (étape 1 : envoi seulement) ──
    if (chkTelegramEnabled) chkTelegramEnabled.checked = currentConfig.telegram_notify_enabled === true;
    if (inputTelegramToken) inputTelegramToken.value = currentConfig.telegram_bot_token || "";
    if (inputTelegramChatId) inputTelegramChatId.value = currentConfig.telegram_chat_id || "";
    inputPdfMdModel.value = currentConfig.pdf_md_model || "";
    if (inputSuperAgentDefaultModel) inputSuperAgentDefaultModel.value = currentConfig.super_agent_default_model || "";
    chkAutoSave.checked = currentConfig.auto_save || false;
    inputAutoSaveDelay.value = currentConfig.auto_save_delay || 3000;
    chkWordWrap.checked = currentConfig.word_wrap || false;
    if (chkModalAnim) chkModalAnim.checked = currentConfig.modal_animations !== false;
    window._pilotModalAnimations = currentConfig.modal_animations !== false;
    chkOrchestration.checked = currentConfig.orchestration_enabled || false;
    chkOrchConfirmModelSwitch.checked = currentConfig.orchestration_confirm_model_switch || false;
    inputCoderContextWindow.value = currentConfig.coder_context_window || 0;
    // ── Auto-test (E2) ──
    if (chkOrchTestEnabled) chkOrchTestEnabled.checked = currentConfig.orchestration_test_enabled === true;
    if (inputOrchTestTimeout) inputOrchTestTimeout.value = currentConfig.orchestration_test_timeout_ms || 60000;
    if (inputOrchTestMaxCorrections) inputOrchTestMaxCorrections.value = currentConfig.orchestration_test_max_corrections || 3;
    if (selectOrchTestScope) selectOrchTestScope.value = currentConfig.orchestration_test_scope || "targeted";
    if (inputOrchTestCommand) inputOrchTestCommand.value = currentConfig.orchestration_test_command || "";
    // ── Snapshots (A1) ──
    if (chkOrchSnapshotsEnabled) chkOrchSnapshotsEnabled.checked = currentConfig.orchestration_snapshots_enabled !== false;
    // ── Reviewer (H2 V1) ──
    if (chkOrchReviewerEnabled) chkOrchReviewerEnabled.checked = currentConfig.orchestration_reviewer_enabled === true;
    const reviewerModelValue = currentConfig.orchestration_reviewer_provider
      ? `${currentConfig.orchestration_reviewer_provider}/${currentConfig.orchestration_reviewer_model}`
      : "";
    if (selectOrchReviewerScope) selectOrchReviewerScope.value = (currentConfig.orchestration_reviewer_scope === "critical") ? "critical" : "all";
    if (taOrchReviewerPatterns) taOrchReviewerPatterns.value = Array.isArray(currentConfig.orchestration_reviewer_critical_patterns)
      ? currentConfig.orchestration_reviewer_critical_patterns.join("\n") : "";
    if (rowOrchReviewerPatterns) rowOrchReviewerPatterns.style.display = (selectOrchReviewerScope && selectOrchReviewerScope.value === "critical") ? "" : "none";
    inputOrchestratorModel.value = currentConfig.orchestrator_provider
      ? `${currentConfig.orchestrator_provider}/${currentConfig.orchestrator_model_id}`
      : "";
    inputCoderModel.value = currentConfig.coder_provider
      ? `${currentConfig.coder_provider}/${currentConfig.coder_model_id}`
      : "";
    inputOrchIdleTimeout.value = currentConfig.orchestration_idle_timeout_ms || 120000;
    inputOrchRevisionInterval.value = currentConfig.orchestration_revision_interval != null ? currentConfig.orchestration_revision_interval : 5;
    selectOrchGranularity.value = currentConfig.orchestration_granularity || "fine";
    selectOrchBatchSize.value = String(currentConfig.orchestration_batch_size || 0);
    // Peupler les selects de modèles puis positionner les valeurs
    const models = await loadModelsList();
    populateModelSelect(inputPdfMdModel, models, currentConfig.pdf_md_model || "");
    populateModelSelect(inputSuperAgentDefaultModel, models, currentConfig.super_agent_default_model || "");
    populateModelSelect(inputOrchestratorModel, models, currentConfig.orchestrator_provider
      ? `${currentConfig.orchestrator_provider}/${currentConfig.orchestrator_model_id}`
      : "");
    populateModelSelect(inputCoderModel, models, currentConfig.coder_provider
      ? `${currentConfig.coder_provider}/${currentConfig.coder_model_id}`
      : "");
    // ── Reviewer : peupler le sélecteur de modèle (comme orchestrateur/codeur) ──
    populateModelSelect(selectOrchReviewerModel, models, reviewerModelValue);
    // ── Champs Accès distant ──
    chkWebEnabled.checked = currentConfig.web_enabled || false;
    inputWebBind.value = currentConfig.web_bind || "127.0.0.1";
    inputWebPort.value = currentConfig.web_port || 8787;
    chkWebReadonly.checked = currentConfig.web_readonly || false;
    inputWebTtl.value = currentConfig.web_token_ttl_hours || 168;
    taWebRoots.value = (currentConfig.web_browse_roots || []).join("\n");
    chkWebKeepalive.checked = currentConfig.web_keep_alive || false;
    chkWebTailscaleServe.checked = currentConfig.web_tailscale_serve || false;
    // ── GDS : actif par défaut (rétrocompatibilité) ──
    chkGdsEnabled.checked = currentConfig.gds_enabled !== false;
    // ── Context Engine ──
    chkContextEngine.checked = currentConfig.context_engine_enabled !== false;
    inputContextBudget.value = currentConfig.context_budget_tokens || 8000;
    chkContextImports.checked = currentConfig.context_include_imports !== false;
    chkContextSpecs.checked = currentConfig.context_include_specs !== false;
    chkContextRecents.checked = currentConfig.context_include_recents !== false;
    // ── Context Engine V2 (RAG) — section dédiée ──
    if (chkContextRag) {
      chkContextRag.checked = currentConfig.context_rag_enabled === true;
      if (inputRagEndpoint) inputRagEndpoint.value = currentConfig.context_rag_endpoint || "http://127.0.0.1:11434";
      if (inputRagModel) inputRagModel.value = currentConfig.context_rag_model || "nomic-embed-text";
    }
    // ── Code Graph — section dédiée ──
    if (chkCodeGraph) chkCodeGraph.checked = currentConfig.code_graph_enabled !== false;
    if (selectGraphExtraction) selectGraphExtraction.value = currentConfig.graph_extraction || "heuristic";
    if (chkGraphInjectA) chkGraphInjectA.checked = currentConfig.graph_inject_mode_a !== false;
    if (inputGraphBudget) inputGraphBudget.value = currentConfig.graph_budget_tokens || 4000;
    if (chkGraphInjectB) chkGraphInjectB.checked = currentConfig.graph_inject_mode_b !== false;
    if (chkGraphIncludeCalls) chkGraphIncludeCalls.checked = currentConfig.graph_include_calls !== false;
  // ── Super-agent (spec_super_agent.md) ──
  if (inputSuperAgentName) inputSuperAgentName.value = currentConfig.super_agent_name || "Assistant";
  await fillSuperAgentClientsFromDb(currentConfig.super_agent_clients);
  if (taSuperAgentPrompt) taSuperAgentPrompt.value = currentConfig.super_agent_prompt || "";
  if (chkSuperAgentThinking) chkSuperAgentThinking.checked = currentConfig.super_agent_show_thinking !== false;
  await refreshAssistantThinkingLevels(currentConfig, selectSuperAgentThinkingLevel, superAgentThinkingLevelNote);
  if (chkSuperAgentTools) chkSuperAgentTools.checked = currentConfig.super_agent_show_tools === true;
  if (chkSuperAgentNotifyDone) chkSuperAgentNotifyDone.checked = currentConfig.notify_super_agent_done === true;
  if (chkAssistantSoundEnabled) chkAssistantSoundEnabled.checked = currentConfig.assistant_sound_enabled === true;
  if (inputAssistantSoundVolume) inputAssistantSoundVolume.value = currentConfig.assistant_sound_volume ?? 100;
  if (assistantSoundVolumeRow) assistantSoundVolumeRow.style.display = (chkAssistantSoundEnabled && chkAssistantSoundEnabled.checked) ? "" : "none";
  if (assistantSoundVolumeLabel) assistantSoundVolumeLabel.textContent = `${inputAssistantSoundVolume ? inputAssistantSoundVolume.value : 100} %`;
  if (chkSuperAgentConcise) chkSuperAgentConcise.checked = currentConfig.super_agent_concise === true;
  if (chkSuperAgentCoordinator) chkSuperAgentCoordinator.checked = currentConfig.super_agent_coordinator === true;
  if (chkSuperAgentUserFriendly) chkSuperAgentUserFriendly.checked = currentConfig.super_agent_user_friendly === true;
  if (chkSuperAgentBlockAgentInput) chkSuperAgentBlockAgentInput.checked = currentConfig.super_agent_block_agent_input === true;
  if (chkSuperAgentInvisibleAgent) chkSuperAgentInvisibleAgent.checked = currentConfig.super_agent_invisible_agent !== false;
  if (chkSuperAgentPurgeBeforeDelegate) chkSuperAgentPurgeBeforeDelegate.checked = currentConfig.super_agent_purge_before_delegate !== false;
  if (chkSuperAgentQualityGate) chkSuperAgentQualityGate.checked = currentConfig.super_agent_quality_gate !== false;
  if (chkSuperAgentForceStructuredBrief) chkSuperAgentForceStructuredBrief.checked = currentConfig.super_agent_force_structured_brief !== false;
  if (chkSuperAgentInheritContext) chkSuperAgentInheritContext.checked = currentConfig.super_agent_inherit_context === true;
  if (chkSuperAgentAutoCheckStartup) chkSuperAgentAutoCheckStartup.checked = currentConfig.super_agent_auto_check_startup === true;
  // ── Lot A idée 6 : fréquence des rappels de surveillance ──
  if (selectSuperAgentScheduleInterval) {
    selectSuperAgentScheduleInterval.value = String(normalizeScheduleInterval(currentConfig.super_agent_schedule_interval_secs));
  }
  await refreshSuperAgentScheduleCount(superAgentScheduleCount);
  // ── Tâche #160 : overlay plein écran des événements ──
  if (chkSuperAgentEventsOverlay) chkSuperAgentEventsOverlay.checked = currentConfig.super_agent_events_overlay_enabled === true;
  if (inputSuperAgentEventsOverlaySeconds) inputSuperAgentEventsOverlaySeconds.value = currentConfig.super_agent_events_overlay_seconds ?? 5;
  if (superAgentEventsOverlayDurationRow) superAgentEventsOverlayDurationRow.style.display = (chkSuperAgentEventsOverlay && chkSuperAgentEventsOverlay.checked) ? "" : "none";
  if (chkSuperAgentTasksTab) chkSuperAgentTasksTab.checked = currentConfig.super_agent_tasks_tab_enabled !== false;
  // ── Lot A idée 3 (tranche 3.5) : checklist de livraison ──
  // Repli sûr : un mode absent/inconnu s'affiche « Rappel simple » (défaut) et un
  // modèle absent/vide affiche le modèle par défaut — jamais un réglage vide.
  if (selectSuperAgentChecklistMode) {
    selectSuperAgentChecklistMode.value = normalizeChecklistMode(currentConfig.super_agent_checklist_mode);
  }
  if (taSuperAgentChecklistTemplate) {
    taSuperAgentChecklistTemplate.value = normalizeChecklistTemplate(currentConfig.super_agent_checklist_template);
  }
  // ── Lot A idée 4 (tranche 5b) : traçabilité des livraisons ──
  // Clé absente ⇒ coché (défaut « activé »), comme le réglage Rust correspondant.
  if (chkSuperAgentTracabilite) chkSuperAgentTracabilite.checked = currentConfig.super_agent_tracabilite_enabled !== false;
  // ── Lot A idée 2 (tranche 5) : affichage du suivi du temps ──
  // Clé absente ⇒ décoché (défaut « désactivé »), comme le réglage Rust.
  if (chkSuperAgentShowTime) chkSuperAgentShowTime.checked = currentConfig.super_agent_show_time === true;
  // ── Diff Review (A4 V2) : porte pré-écriture ──
  if (chkConfirmFileEdits) chkConfirmFileEdits.checked = currentConfig.confirm_file_edits === true;
  await refreshConfirmEditsAvailability();
  // ── Mémoire de projet (H3) ──
  if (chkProjectMemory) chkProjectMemory.checked = currentConfig.project_memory_enabled !== false;
  if (chkProjectMemoryAuto) chkProjectMemoryAuto.checked = currentConfig.project_memory_auto_extract === true;
  // ── Gestion d'agents multi-rôles (H2 V2) ──
  if (inputAgentMaxDepth) inputAgentMaxDepth.value = currentConfig.agent_max_call_depth || 3;
  if (inputAgentMaxTotalCalls) inputAgentMaxTotalCalls.value = currentConfig.agent_max_total_calls || 30;
  if (inputAgentTimeoutMs) inputAgentTimeoutMs.value = currentConfig.agent_timeout_ms || 600000;
  if (inputAgentMaxResultTokens) inputAgentMaxResultTokens.value = currentConfig.agent_max_result_tokens || 4000;
  if (inputAgentMaxTurns) inputAgentMaxTurns.value = currentConfig.agent_max_turns || 200;
    webNetChanged = false;
    tailscaleChanged = false;
    rpcLaunchChanged = false;
    confirmEditsChanged = false;
    await refreshWebStatus();
    await refreshTailscaleStatus();
    // ── Sous-thèmes : peupler + aperçu en direct ──
    savedTheme = currentConfig.theme || "dark";
    savedSubtheme = currentConfig.subtheme || "default";
    populateSubthemeSelect(selectSubtheme, savedTheme, savedSubtheme);
    // Aperçu en direct : applique immédiatement le thème/sous-thème choisi
    // (sans enregistrer) ; revert à la fermeture si non sauvegardé.
    selectTheme.addEventListener("change", () => {
      const t = selectTheme.value;
      populateSubthemeSelect(selectSubtheme, t, "default");
      applyTheme(t, selectSubtheme.value);
    });
    selectSubtheme.addEventListener("change", () => {
      applyTheme(selectTheme.value, selectSubtheme.value);
    });
    modal.classList.remove("hidden");
    animateModalOpen(modal, clickX, clickY);
  });

  // ── Context Engine V2 (RAG) : toggle d'affichage du block + bouton test ──
  if (chkContextRag) {
    chkContextRag.addEventListener("change", () => {
      // Rien à masquer : le block est toujours visible dans l'onglet dédié RAG.
      // Le changement d'état est pris en compte à l'enregistrement.
    });
  }
  if (btnRagTest) {
    btnRagTest.addEventListener("click", async () => {
      if (!ragTestStatus) return;
      const endpoint = (inputRagEndpoint.value || "http://127.0.0.1:11434").trim();
      const model = (inputRagModel.value || "nomic-embed-text").trim();
      ragTestStatus.textContent = "⏳ Test en cours…";
      ragTestStatus.style.color = "var(--text-muted)";
      try {
        const res = await invoke("context_rag_probe", { endpoint, model });
        if (res && res.ok) {
          ragTestStatus.textContent = `✅ Ollama joignable — modèle « ${model} » (dim ${res.dim})`;
          ragTestStatus.style.color = "var(--success, #4ade80)";
          showToast(`RAG : Ollama OK (modèle ${model}, dim ${res.dim})`);
        } else {
          ragTestStatus.textContent = `❌ ${res && res.error ? res.error : "Ollama injoignable"}`;
          ragTestStatus.style.color = "var(--danger, #f87171)";
        }
      } catch (e) {
        ragTestStatus.textContent = `❌ ${e}`;
        ragTestStatus.style.color = "var(--danger, #f87171)";
      }
    });
  }

  // ── Son de notification de l'Assistant (spec_super_agent.md) ──
  if (chkAssistantSoundEnabled) {
    chkAssistantSoundEnabled.addEventListener("change", () => {
      if (assistantSoundVolumeRow) assistantSoundVolumeRow.style.display = chkAssistantSoundEnabled.checked ? "" : "none";
    });
  }
  // ── Tâche #160 : overlay plein écran — montre/masque la row durée ──
  if (chkSuperAgentEventsOverlay) {
    chkSuperAgentEventsOverlay.addEventListener("change", () => {
      if (superAgentEventsOverlayDurationRow) superAgentEventsOverlayDurationRow.style.display = chkSuperAgentEventsOverlay.checked ? "" : "none";
    });
  }
  if (inputAssistantSoundVolume) {
    inputAssistantSoundVolume.addEventListener("input", () => {
      if (assistantSoundVolumeLabel) assistantSoundVolumeLabel.textContent = `${inputAssistantSoundVolume.value} %`;
    });
  }
  if (btnAssistantSoundTest) {
    btnAssistantSoundTest.addEventListener("click", async () => {
      const vol = inputAssistantSoundVolume ? (parseInt(inputAssistantSoundVolume.value, 10) || 100) : 100;
      try {
        await invoke("play_assistant_sound", { soundType: "point", volume: vol });
      } catch (e) {
        showToast(`Son : ${e}`);
      }
    });
  }

  // ── Mémoire (transfert de suivi, issue #69) ──
  if (btnMemExport) {
    btnMemExport.addEventListener("click", async () => {
      const include = {
        tracking: chkMemTracking ? chkMemTracking.checked : true,
        settings: chkMemSettings ? chkMemSettings.checked : true,
        behavior: chkMemBehavior ? chkMemBehavior.checked : false,
        ui: chkMemUi ? chkMemUi.checked : false,
      };
      if (!include.tracking && !include.settings && !include.behavior && !include.ui) {
        showToast("Sélectionnez au moins un contenu à exporter.", "warning");
        return;
      }
      if (memStatus) memStatus.textContent = "Export…";
      try {
        const json = await invoke("export_super_agent_memory", { include });
        const outPath = await dialogSave({
          defaultPath: "pilot-assistant-memoire.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!outPath) return; // annulé
        await invoke("write_file_content", { path: outPath, content: json });
        if (memStatus) memStatus.textContent = "✅ Mémoire exportée.";
        showToast("Mémoire exportée : " + outPath.split(/[/\\]/).pop());
      } catch (e) {
        if (memStatus) memStatus.textContent = "";
        showToast("Export : " + e, "error");
      }
    });
  }
  // ── PLface : lancer mon avatar au démarrage ──
  // Le moteur Rust lit la configuration ENREGISTRÉE. Pour que le test reflète ce
  // que l'utilisateur vient de saisir, on enregistre d'abord les deux champs
  // PLface (fusion sur la config courante, sans toucher aux autres réglages).
  async function persistPlfaceSettings() {
    if (!chkPlfaceAutostart && !inputPlfacePath) return;
    try {
      const cfg = await invoke("get_config");
      if (chkPlfaceAutostart) cfg.plface_autostart_enabled = chkPlfaceAutostart.checked;
      if (inputPlfacePath) cfg.plface_exe_path = inputPlfacePath.value.trim();
      if (inputPlfaceAvatar) cfg.plface_avatar_path = inputPlfaceAvatar.value.trim();
      await invoke("save_config", { config: cfg });
      currentConfig = cfg;
    } catch (e) {
      // Réserve R-B : lecture échouée → écriture annulée (jamais de défauts
      // persistés à la place de la vraie configuration).
      console.error("persistPlfaceSettings:", e);
      showToast("Configuration indisponible : réglages PLface non enregistrés.", "error");
    }
  }
  // Indicateur d'état lisible : « Votre avatar est lancé / est arrêté ». Sondé
  // à l'ouverture de la modale et après chaque action. Fail-open : un échec de
  // sonde affiche simplement « arrêté » (aucune erreur bloquante).
  async function refreshPlfaceState() {
    if (!plfaceState) return;
    let running = false;
    try {
      running = await invoke("plface_status");
    } catch (_) {
      running = false;
    }
    const { text, kind } = plfaceStateMessage(running === true);
    plfaceState.textContent = text;
    plfaceState.style.color = kind === "success" ? "var(--success)" : "var(--text-muted)";
  }
  if (btnPlfaceBrowse) {
    btnPlfaceBrowse.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          multiple: false,
          directory: false,
          filters: [
            { name: "Programme de l'avatar (exécutable)", extensions: ["exe", "bin", "app", "command", "sh"] },
            { name: "Tous les fichiers", extensions: ["*"] },
          ],
        });
        if (!picked) return; // annulé
        // Remplit UNIQUEMENT le champ du programme (jamais celui du modèle).
        if (inputPlfacePath) inputPlfacePath.value = Array.isArray(picked) ? picked[0] : picked;
      } catch (e) {
        showToast("Sélection du fichier : " + e, "error");
      }
    });
  }
  if (btnPlfaceTest) {
    btnPlfaceTest.addEventListener("click", async () => {
      if (plfaceTestStatus) {
        plfaceTestStatus.textContent = "Test en cours…";
        plfaceTestStatus.style.color = "var(--text-muted)";
      }
      await persistPlfaceSettings();
      let outcome = "";
      try {
        outcome = await invoke("check_and_launch_plface");
      } catch (_) {
        outcome = "";
      }
      const { text, kind } = plfaceOutcomeMessage(outcome);
      const colors = {
        success: "var(--success)",
        info: "var(--text-secondary)",
        warning: "var(--warning)",
        error: "var(--danger)",
      };
      if (plfaceTestStatus) {
        plfaceTestStatus.textContent = text;
        plfaceTestStatus.style.color = colors[kind] || "var(--text-muted)";
      }
      showToast(text, kind);
      await refreshPlfaceState();
    });
  }
  if (btnPlfaceAvatarBrowse) {
    btnPlfaceAvatarBrowse.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          multiple: false,
          directory: false,
          filters: [
            { name: "Modèle d'avatar (.vrm)", extensions: ["vrm"] },
          ],
        });
        if (!picked) return; // annulé : aucune erreur
        const filePath = Array.isArray(picked) ? picked[0] : picked;
        // Refus propre : un fichier non-.vrm ne remplit jamais le champ du modèle
        // (et n'atterrit jamais dans celui du programme).
        if (!isVrmPath(filePath)) {
          const { text, kind } = avatarRejectedMessage(filePath);
          showToast(text, kind);
          return;
        }
        // Remplit UNIQUEMENT le champ du modèle.
        if (inputPlfaceAvatar) inputPlfaceAvatar.value = filePath;
      } catch (e) {
        showToast("Sélection du fichier : " + e, "error");
      }
    });
  }
  // Arrêt propre à la demande : demande au visage de se fermer (`GET /close`).
  // Discret si l'avatar ne tourne pas ou ne répond pas (aucune erreur angoissante).
  if (btnPlfaceStop) {
    btnPlfaceStop.addEventListener("click", async () => {
      if (plfaceTestStatus) {
        plfaceTestStatus.textContent = "Arrêt en cours…";
        plfaceTestStatus.style.color = "var(--text-muted)";
      }
      let outcome = "";
      try {
        outcome = await invoke("stop_plface");
      } catch (_) {
        outcome = "";
      }
      const { text, kind } = plfaceStopMessage(outcome);
      const colors = {
        success: "var(--success)",
        info: "var(--text-secondary)",
        warning: "var(--warning)",
        error: "var(--danger)",
      };
      if (plfaceTestStatus) {
        plfaceTestStatus.textContent = text;
        plfaceTestStatus.style.color = colors[kind] || "var(--text-muted)";
      }
      showToast(text, kind);
      await refreshPlfaceState();
    });
  }
  // Désactivation de l'avatar (case décochée) : arrêt propre, discret. L'événement
  // `change` ne se déclenche que sur action de l'utilisateur (pas au remplissage
  // programmatique de la modale).
  if (chkPlfaceAutostart) {
    chkPlfaceAutostart.addEventListener("change", async () => {
      if (chkPlfaceAutostart.checked) return; // activation : rien à arrêter ici
      try {
        await invoke("stop_plface");
      } catch (_) {}
      await refreshPlfaceState();
    });
  }

  // ── Service Laya : état + parcours des réglages ──
  // Indicateur d'état lisible : traduit l'état renvoyé par `laya_status`. Un
  // échec de sonde n'est jamais bloquant (état « non configuré » + note discrète).
  async function refreshLayaState() {
    if (!layaState) return;
    let status = null;
    let ok = true;
    try {
      status = await invoke("laya_status");
    } catch (_) {
      status = null;
      ok = false;
    }
    const { text, kind } = layaStatusMessage(status);
    const colors = {
      success: "var(--success)",
      info: "var(--text-secondary)",
      warning: "var(--warning)",
      error: "var(--danger)",
    };
    layaState.textContent = text;
    layaState.style.color = colors[kind] || "var(--text-muted)";
    if (layaMessage) {
      layaMessage.textContent = ok ? "" : "État du service momentanément indisponible.";
      layaMessage.style.color = "var(--text-muted)";
    }
  }
  // Démarrage du service À LA DEMANDE (sans redémarrer Pilot) : affiche l'issue
  // RÉELLE de la tentative, pour que « pourquoi il n'a pas démarré » soit
  // visible à l'écran (les détails restant dans le journal du service). Si le
  // service répond déjà, il n'est ni arrêté ni relancé.
  if (btnLayaServiceStart) {
    btnLayaServiceStart.addEventListener("click", async () => {
      btnLayaServiceStart.disabled = true;
      if (layaState) {
        layaState.textContent = "Démarrage du service Laya…";
        layaState.style.color = "var(--text-secondary)";
      }
      let outcome = "";
      try {
        outcome = await invoke("laya_service_start");
      } catch (_) {
        outcome = "";
      }
      btnLayaServiceStart.disabled = false;
      const { text, kind } = layaOutcomeMessage(outcome);
      showToast(text, kind);
      // Relit l'état : l'issue réelle reste affichée dans la ligne d'état.
      await refreshLayaState();
    });
  }
  if (btnLayaServiceBrowse) {
    btnLayaServiceBrowse.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          multiple: false,
          directory: false,
          filters: [
            { name: "Service Laya (.mjs)", extensions: ["mjs"] },
            { name: "Tous les fichiers", extensions: ["*"] },
          ],
        });
        if (!picked) return; // annulé
        // Remplit UNIQUEMENT le champ du service (jamais celui du modèle).
        if (inputLayaServicePath) inputLayaServicePath.value = Array.isArray(picked) ? picked[0] : picked;
      } catch (e) {
        showToast("Sélection du fichier : " + e, "error");
      }
    });
  }
  if (btnLayaModelBrowse) {
    btnLayaModelBrowse.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({ multiple: false, directory: true });
        if (!picked) return; // annulé
        // Remplit UNIQUEMENT le champ du modèle.
        if (inputLayaModelDir) inputLayaModelDir.value = Array.isArray(picked) ? picked[0] : picked;
      } catch (e) {
        showToast("Sélection du dossier : " + e, "error");
      }
    });
  }
  if (btnLayaNodeBrowse) {
    btnLayaNodeBrowse.addEventListener("click", async () => {
      try {
        // Aucun filtre : l'interpréteur s'appelle `node.exe` sous Windows et
        // `node` ailleurs — filtrer par extension rendrait le bouton inutile
        // sur macOS et Linux.
        const picked = await dialogOpen({ multiple: false, directory: false });
        if (!picked) return; // annulé
        // Remplit UNIQUEMENT le champ de l'interpréteur.
        if (inputLayaNodePath) inputLayaNodePath.value = Array.isArray(picked) ? picked[0] : picked;
      } catch (e) {
        showToast("Sélection du programme : " + e, "error");
      }
    });
  }

  // ── Modèle Laya : état, téléchargement, interruption ──
  // Traduit l'état du modèle (`laya_model_state`) et suit la progression émise
  // par le moteur (`laya-download-progress`). Aucun échec de commande n'est
  // bloquant : état « momentanément indisponible » + note discrète.
  const LAYA_KIND_COLORS = {
    success: "var(--success)",
    info: "var(--text-secondary)",
    warning: "var(--warning)",
    error: "var(--danger)",
  };

  let layaModelPoll = null;
  function stopLayaModelPoll() {
    if (layaModelPoll) {
      clearInterval(layaModelPoll);
      layaModelPoll = null;
    }
  }
  function startLayaModelPoll() {
    stopLayaModelPoll();
    layaModelPoll = setInterval(refreshLayaModelState, 1000);
  }

  function applyLayaModelState(state, available = true) {
    const { text, kind } = layaModelStateMessage(available ? state : null);
    if (layaModelState) {
      layaModelState.textContent = text;
      layaModelState.style.color = LAYA_KIND_COLORS[kind] || "var(--text-muted)";
    }
    if (layaModelBar) layaModelBar.value = layaModelProgressPercent(state);
    if (layaModelMessage) {
      layaModelMessage.textContent = available ? "" : "État du modèle momentanément indisponible.";
      layaModelMessage.style.color = "var(--text-muted)";
    }
  }

  async function refreshLayaModelState() {
    if (!layaModelState) return null;
    let state = null;
    let ok = true;
    try {
      state = await invoke("laya_model_state");
    } catch (_) {
      state = null;
      ok = false;
    }
    applyLayaModelState(state, ok);
    // Le sondage s'arrête de lui-même dès que le téléchargement est terminé.
    if (!ok || !state || state.downloading !== true) stopLayaModelPoll();
    return ok ? state : null;
  }

  // Écoute de la progression : une seule écoute à la fois, désinscrite à la
  // fermeture de la modale (jamais de fuite d'écouteur).
  let layaProgressUnlisten = null;
  async function startLayaProgressListener() {
    if (layaProgressUnlisten) return;
    try {
      layaProgressUnlisten = await listen("laya-download-progress", (event) => {
        const payload = event && event.payload ? event.payload : {};
        applyLayaModelState({ present: false, downloading: true, percent: payload.percent }, true);
      });
    } catch (_) {
      layaProgressUnlisten = null;
    }
  }
  function stopLayaProgressListener() {
    if (layaProgressUnlisten) {
      try {
        layaProgressUnlisten();
      } catch (_) {}
      layaProgressUnlisten = null;
    }
  }

  if (btnLayaFetchBrowse) {
    btnLayaFetchBrowse.addEventListener("click", async () => {
      try {
        const picked = await dialogOpen({
          multiple: false,
          directory: false,
          filters: [
            { name: "Programme de téléchargement (.mjs)", extensions: ["mjs"] },
            { name: "Tous les fichiers", extensions: ["*"] },
          ],
        });
        if (!picked) return; // annulé
        if (inputLayaFetchPath) inputLayaFetchPath.value = Array.isArray(picked) ? picked[0] : picked;
      } catch (e) {
        showToast("Sélection du programme : " + e, "error");
      }
    });
  }
  if (btnLayaModelDownload) {
    btnLayaModelDownload.addEventListener("click", async () => {
      try {
        const res = await invoke("laya_model_download", {
          baseUrl: inputLayaModelBaseUrl ? inputLayaModelBaseUrl.value.trim() : "",
          fetchPath: inputLayaFetchPath ? inputLayaFetchPath.value.trim() : "",
        });
        if (res === "alreadyRunning") {
          showToast("Un téléchargement du modèle est déjà en cours.", "info");
        }
        startLayaModelPoll();
        const state = await refreshLayaModelState();
        // Aucun message de succès lancé « à l'aveugle » : c'est la ligne d'état
        // qui dit où en est le téléchargement. Si la demande n'a même pas pu
        // démarrer (rien d'embarqué, adresse inconnue, interpréteur absent),
        // la RAISON RÉELLE est annoncée ici, au lieu d'un faux « lancé ».
        if (
          res !== "alreadyRunning" &&
          state &&
          state.present !== true &&
          state.downloading !== true &&
          state.reason
        ) {
          const { text, kind } = layaModelStateMessage(state);
          showToast(text, kind);
        }
      } catch (e) {
        showToast("Téléchargement du modèle : " + e, "error");
      }
    });
  }
  if (btnLayaModelCancel) {
    btnLayaModelCancel.addEventListener("click", async () => {
      try {
        const stopped = await invoke("laya_model_cancel");
        showToast(
          stopped ? "Téléchargement interrompu (la reprise continuera au même point)." : "Aucun téléchargement en cours.",
          stopped ? "info" : "warning"
        );
        await refreshLayaModelState();
      } catch (e) {
        showToast("Interruption : " + e, "error");
      }
    });
  }

  if (btnMemImport) {
    btnMemImport.addEventListener("click", async () => {
      try {
        const inPath = await dialogOpen({
          multiple: false,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!inPath) return; // annulé
        const json = await invoke("read_file_content", { path: inPath });
        const ok = await dialogConfirm(
          "Importer cette mémoire REMPLACERA le suivi de l'Assistant sur ce poste (et les sections cochées de la config). Continuer ?",
          { title: "Importer la mémoire de l'Assistant", kind: "warning" }
        );
        if (!ok) return;
        if (memStatus) memStatus.textContent = "Import…";
        const sections = {
          tracking: chkMemTracking ? chkMemTracking.checked : true,
          settings: chkMemSettings ? chkMemSettings.checked : true,
          behavior: chkMemBehavior ? chkMemBehavior.checked : false,
          ui: chkMemUi ? chkMemUi.checked : false,
        };
        const res = await invoke("import_super_agent_memory", { json, sections });
        if (memStatus) memStatus.textContent = "✅ Importé : " + (res.imported || []).join(", ") + ".";
        showToast("Mémoire importée.");
        // Appliquer l'apparence importée + rafraîchir la config de l'Assistant
        // (nom/label) via l'événement déjà écouté par super-agent.js.
        const cfg = await invoke("get_config");
        applyTheme(cfg.theme || "dark", cfg.subtheme || "default");
        window.dispatchEvent(new CustomEvent("pilot-config-changed", { detail: cfg }));
        // Recharger le panneau des réglages avec la config importée.
        if (currentConfig) {
          try { currentConfig = await invoke("get_config"); } catch (_) {}
          selectTheme.value = currentConfig.theme || "dark";
          populateSubthemeSelect(selectSubtheme, currentConfig.theme || "dark", currentConfig.subtheme || "default");
          if (inputSuperAgentName) inputSuperAgentName.value = currentConfig.super_agent_name || "Assistant";
          await fillSuperAgentClientsFromDb(currentConfig.super_agent_clients);
          if (taSuperAgentPrompt) taSuperAgentPrompt.value = currentConfig.super_agent_prompt || "";
          if (chkSuperAgentConcise) chkSuperAgentConcise.checked = currentConfig.super_agent_concise === true;
          if (chkSuperAgentUserFriendly) chkSuperAgentUserFriendly.checked = currentConfig.super_agent_user_friendly === true;
          if (chkSuperAgentQualityGate) chkSuperAgentQualityGate.checked = currentConfig.super_agent_quality_gate !== false;
        }
      } catch (e) {
        if (memStatus) memStatus.textContent = "";
        showToast("Import : " + e, "error");
      }
    });
  }

  // Issue #88 : appliquer/effacer immédiatement le modèle par défaut dédié à
  // l'Assistant (commande persistée en config par le cœur). Vide = effacer le
  // réglage → l'Assistant repart sur le modèle par défaut global des agents.
  if (inputSuperAgentDefaultModel) {
    inputSuperAgentDefaultModel.addEventListener("change", async () => {
      const value = inputSuperAgentDefaultModel.value.trim();
      const [provider, modelId] = value.split("/", 2);
      try {
        await invoke("set_super_agent_default_model", { provider: provider || "", modelId: modelId || "" });
      } catch (e) {
        showToast("Modèle par défaut de l'Assistant : " + e, "error");
      }
    });
  }

  // Fermer (Annuler) — annule aussi les modifs providers non sauvegardées
  btnClose.addEventListener("click", async () => {
    await cancelProvidersIfDirty();
    stopLayaModelPoll();
    stopLayaProgressListener();
    // Revert l'aperçu en direct : on revient au thème/sous-thème sauvegardé
    applyTheme(savedTheme, savedSubtheme);
    modal.classList.add("hidden");
  });

  // Ouvrir depuis l'extérieur (ex: gate E4 dans tabs.js → bouton « Ouvrir les
  // paramètres » quand l'agent est indisponible). Focus le champ chemin pi.
  window.addEventListener("pilot-open-settings", (e) => {
    populateSubthemeSelect(selectSubtheme, savedTheme, savedSubtheme);
    // Onglet demandé (ex: { tab: "superagent" } depuis l'onglet 🧭 Assistant
    // et son mode assistant seul) : active l'onglet correspondant AVANT
    // l'ouverture. Sans detail (ex: gate E4), conserve le comportement
    // historique : onglet actif courant + focus sur le chemin pi.
    const wanted = e && e.detail && e.detail.tab;
    if (wanted) {
      const tabBtn = modal.querySelector(`.settings-tab[data-settings-tab="${wanted}"]`);
      if (tabBtn) tabBtn.click();
    }
    modal.classList.remove("hidden");
    startLayaProgressListener();
    refreshLayaModelState();
    if (!wanted) {
      try { inputRpcPath.focus(); inputRpcPath.scrollIntoView({ block: "center" }); } catch (_) {}
    }
  });

  // Sauvegarder
  btnSave.addEventListener("click", async () => {
      // D'abord le registre de modèles (models.json + aliases) si modifié.
      // En cas d'échec de validation, on garde la modale ouverte pour corriger.
      {
        const ok = await saveProvidersIfDirty();
        if (!ok) return;
      }
      // Agents du projet (issue #35) : sauvegarder la config si modifiée.
      if (projectAgentsDirty) await saveProjectAgents();
      // Parse orchestrator model: "provider/modelId" or empty
      const orchParts = inputOrchestratorModel.value.trim().split("/", 2);
      const coderParts = inputCoderModel.value.trim().split("/", 2);
      // Reviewer : même parsing (vide = fallback sur modèle orchestrateur)
      const reviewerParts = selectOrchReviewerModel ? selectOrchReviewerModel.value.trim().split("/", 2) : ["", ""];
      // Validation : le format doit être "provider/modelId". Si le modelId est
      // vide (pas de "/"), l'utilisateur a probablement mis le nom du modèle
      // dans le champ provider — set_model échouera silencieusement côté pi.
      const orchMissing = inputOrchestratorModel.value.trim() && !(orchParts[1] || "").trim();
      const coderMissing = inputCoderModel.value.trim() && !(coderParts[1] || "").trim();
      const reviewerMissing = (selectOrchReviewerModel && selectOrchReviewerModel.value.trim()) && !(reviewerParts[1] || "").trim();
      if (orchMissing || coderMissing || reviewerMissing) {
        const which = [];
        if (orchMissing) which.push("orchestrateur");
        if (coderMissing) which.push("codeur");
        if (reviewerMissing) which.push("reviewer");
        alert(
          `Format invalide pour le modèle ${which.join(" et ")} : utilisez "provider/modelId"\n` +
          `Exemple : ollama/glm-5.2:cloud — le "provider" (ollama, llama-cpp, deepseek…) ne doit PAS être vide.\n` +
          `Vérifiez que vous n'avez pas mis le nom du modèle seul (sans le provider devant).`
        );
        return; // ne pas fermer la modale
      }
      const config = {
        theme: selectTheme.value,
        subtheme: selectSubtheme.value,
        default_command: inputCmd.value.trim(),
        recent_projects: currentConfig?.recent_projects || [],
        auto_load_last_project: chkAutoLoad.checked,
        auto_run_command: chkAutoRun.checked,
        agent_start_on_launch: chkAgentStartOnLaunch.checked,
        super_agent_start_on_launch: chkSuperAgentStartOnLaunch ? chkSuperAgentStartOnLaunch.checked : true,
        // ── PLface : lancement de l'avatar au démarrage ──
        plface_autostart_enabled: chkPlfaceAutostart ? chkPlfaceAutostart.checked : false,
        plface_exe_path: inputPlfacePath ? inputPlfacePath.value.trim() : "",
        plface_avatar_path: inputPlfaceAvatar ? inputPlfaceAvatar.value.trim() : "",
        // ── Service Laya : réglages du service local ──
        laya_autostart_enabled: chkLayaAutostart ? chkLayaAutostart.checked : false,
        laya_service_path: inputLayaServicePath ? inputLayaServicePath.value.trim() : "",
        laya_model_dir: inputLayaModelDir ? inputLayaModelDir.value.trim() : "",
        laya_model_auto_download_enabled: chkLayaModelAutoDownload ? chkLayaModelAutoDownload.checked : false,
        laya_model_base_url: inputLayaModelBaseUrl ? inputLayaModelBaseUrl.value.trim() : "",
        laya_fetch_path: inputLayaFetchPath ? inputLayaFetchPath.value.trim() : "",
        laya_node_path: inputLayaNodePath ? inputLayaNodePath.value.trim() : "",
        integrated_terminal: chkIntegratedTerminal.checked,
        rpc_agent_enabled: chkRpcAgent.checked,
        rpc_pi_path: inputRpcPath.value.trim(),
        rpc_no_session: chkRpcNoSession.checked,
        rpc_session_dir: inputRpcSessionDir.value.trim(),
        multi_agent_tabs: chkMultiAgentTabs ? chkMultiAgentTabs.checked : false,
        dashboard_auto_open: chkDashboardAutoOpen ? chkDashboardAutoOpen.checked : false,
        dashboard_auto_refresh: chkDashboardAutoRefresh ? chkDashboardAutoRefresh.checked : true,
        dashboard_auto_refresh_seconds: inputDashboardAutoRefreshSeconds ? (parseInt(inputDashboardAutoRefreshSeconds.value, 10) || 120) : 120,
        session_retention_days: inputSessionRetention ? (parseInt(inputSessionRetention.value, 10) || 15) : 15,
        quality_gate_enabled: currentConfig?.quality_gate_enabled || false,
        // MCP : lire la case à cocher vivante. L'onglet MCP persiste déjà le
        // flag via mcp_set_enabled ; relire currentConfig (instantané pris à
        // l'ouverture de la modale) écraserait par une valeur périmée.
        mcp_enabled: chkMcpEnabled ? chkMcpEnabled.checked : (currentConfig?.mcp_enabled || false),
        // Mode strict de la clé du coffre (tâche 399) : lu sur la case vivante ;
        // absent du DOM → configuration courante, défaut strict.
        mcp_secret_strict: chkMcpSecretStrict
          ? chkMcpSecretStrict.checked
          : currentConfig?.mcp_secret_strict !== false,
        // Contrôle de l'écran par les agents : `save_config` RÉÉCRIT toute la
        // configuration, donc les champs absents retomberaient sur leurs
        // défauts. On relit les cases vivantes (l'onglet MCP les persiste déjà)
        // et l'arrêt d'urgence depuis la configuration courante.
        screen_control_enabled: chkMcpScreenEnabled
          ? chkMcpScreenEnabled.checked
          : currentConfig?.screen_control_enabled !== false,
        screen_control_simulation: chkMcpScreenSimulation
          ? chkMcpScreenSimulation.checked
          : currentConfig?.screen_control_simulation !== false,
        screen_control_emergency_stop: currentConfig?.screen_control_emergency_stop === true,
        show_thinking: chkShowThinking.checked,
        // T7 — niveau de réflexion par défaut de Pilot. "" = non réglé (le moteur
        // garde son propre défaut : aucun changement de comportement).
        default_thinking_level: selectDefaultThinkingLevel
          ? selectDefaultThinkingLevel.value.trim()
          : (currentConfig?.default_thinking_level || ""),
        show_tools: chkShowTools.checked,
        notify_agent_done: chkNotifyAgentDone ? chkNotifyAgentDone.checked : false,
        // ── Détection d'anomalies (tâche 8) ──
        anomaly_detection_enabled: chkAnomalyEnabled ? chkAnomalyEnabled.checked !== false : true,
        anomaly_timeout_minutes: inputAnomalyTimeout ? (parseInt(inputAnomalyTimeout.value, 10) || 30) : 30,
        // ── Arrêt auto des agents délégués bloqués (T2) ──
        agent_auto_stop_enabled: chkAutoStopEnabled ? chkAutoStopEnabled.checked !== false : true,
        agent_auto_stop_minutes: inputAutoStopTimeout ? (parseInt(inputAutoStopTimeout.value, 10) || 10) : 10,
        // ── Notifications Telegram (spec_telegram.md, étape 1 : envoi seulement) ──
        // Défauts sûrs : désactivé et champs vides. Un repli sur `currentConfig`
        // évite qu'un enregistrement réinitialise un réglage déjà saisi si un
        // champ venait à manquer dans le DOM.
        telegram_notify_enabled: chkTelegramEnabled
          ? chkTelegramEnabled.checked === true
          : (currentConfig?.telegram_notify_enabled === true),
        telegram_bot_token: inputTelegramToken
          ? inputTelegramToken.value.trim()
          : (currentConfig?.telegram_bot_token || ""),
        telegram_chat_id: inputTelegramChatId
          ? inputTelegramChatId.value.trim()
          : (currentConfig?.telegram_chat_id || ""),
        // ── Communication Telegram du DIALOGUE de l'Assistant (étape 2, lot 3) ──
        // Pas d'UI ici (le bouton vit dans l'onglet 🧭 Assistant). On PRÉSERVE la
        // valeur courante pour qu'un enregistrement des Paramètres ne coupe pas
        // la communication sans que l'utilisateur l'ait demandé. Champ absent
        // d'une ancienne config ⇒ défaut sûr (désactivé).
        telegram_dialog_enabled: currentConfig?.telegram_dialog_enabled === true,
        // ── Plafond « réfléchit » du super-agent (tâche #141) ──
        // Pas d'UI dédiée : on préserve les valeurs de la config courante pour
        // qu'un enregistrement des Paramètres ne les réinitialise pas (défauts
        // activé / 10 min, cf. lib.rs).
        super_agent_auto_stop_enabled: currentConfig?.super_agent_auto_stop_enabled !== false,
        super_agent_auto_stop_minutes: currentConfig?.super_agent_auto_stop_minutes || 10,
        // ── Verrou de run fantôme (busy-stale) ──
        // Pas d'UI dédiée : on préserve la valeur de la config courante pour
        // qu'un enregistrement des Paramètres ne la réinitialise pas (défaut
        // 25 min, cf. lib.rs).
        stale_busy_grace_minutes: currentConfig?.stale_busy_grace_minutes || 25,
        pdf_md_model: inputPdfMdModel.value.trim(),
        // Issue #88 : modèle par défaut dédié à l'Assistant. Préservé explicitement
        // ici — l'enregistrement des Paramètres réécrit TOUTE la config, un champ
        // absent serait réinitialisé à vide.
        super_agent_default_model: inputSuperAgentDefaultModel
          ? inputSuperAgentDefaultModel.value.trim()
          : (currentConfig?.super_agent_default_model || ""),
        // Modèle ACTIF de l'Assistant (celui qui fait tourner la session en
        // cours, écrit par le sélecteur de l'onglet 🧭 via
        // `set_super_agent_model`) : réglage SANS UI dans les Paramètres.
        // `save_config` réécrit TOUTE la config → on préserve explicitement la
        // valeur courante, sinon la clé serait réinitialisée à vide et
        // l'Assistant repartirait sur son modèle par défaut (issue #88).
        // À ne pas confondre avec `super_agent_default_model` ci-dessus.
        super_agent_model: currentConfig?.super_agent_model || "",
        auto_save: chkAutoSave.checked,
        auto_save_delay: parseInt(inputAutoSaveDelay.value, 10) || 3000,
        favorites: currentConfig?.favorites || [],
        word_wrap: chkWordWrap.checked,
        modal_animations: chkModalAnim ? chkModalAnim.checked : true,
        orchestration_enabled: chkOrchestration.checked,
        orchestrator_provider: orchParts[0] || "",
        orchestrator_model_id: orchParts[1] || "",
        coder_provider: coderParts[0] || "",
        coder_model_id: coderParts[1] || "",
        orchestration_idle_timeout_ms: parseInt(inputOrchIdleTimeout.value, 10) || 120000,
        orchestration_revision_interval: parseInt(inputOrchRevisionInterval.value, 10) || 0,
        orchestration_granularity: selectOrchGranularity.value,
        orchestration_batch_size: parseInt(selectOrchBatchSize.value, 10) || 0,
        orchestration_confirm_model_switch: chkOrchConfirmModelSwitch.checked,
        coder_context_window: parseInt(inputCoderContextWindow.value, 10) || 0,
        // ── Auto-test (E2) ──
        orchestration_test_enabled: chkOrchTestEnabled ? chkOrchTestEnabled.checked : false,
        orchestration_test_timeout_ms: parseInt(inputOrchTestTimeout.value, 10) || 60000,
        orchestration_test_max_corrections: parseInt(inputOrchTestMaxCorrections.value, 10) || 3,
        orchestration_test_scope: selectOrchTestScope ? selectOrchTestScope.value : "targeted",
        orchestration_test_command: inputOrchTestCommand ? inputOrchTestCommand.value.trim() : "",
        // ── Snapshots (A1) ──
        orchestration_snapshots_enabled: chkOrchSnapshotsEnabled ? chkOrchSnapshotsEnabled.checked : true,
        // ── Reviewer (H2 V1) ──
        orchestration_reviewer_enabled: chkOrchReviewerEnabled ? chkOrchReviewerEnabled.checked : false,
        orchestration_reviewer_provider: (reviewerParts[0] || "").trim(),
        orchestration_reviewer_model: (reviewerParts[1] || "").trim(),
        orchestration_reviewer_scope: selectOrchReviewerScope ? selectOrchReviewerScope.value : "all",
        orchestration_reviewer_critical_patterns: taOrchReviewerPatterns
          ? taOrchReviewerPatterns.value.split("\n").map((s) => s.trim()).filter(Boolean) : [],
        // ── Accès distant ──
        web_enabled: chkWebEnabled.checked,
        web_bind: inputWebBind.value.trim() || "127.0.0.1",
        web_port: parseInt(inputWebPort.value, 10) || 8787,
        web_readonly: chkWebReadonly.checked,
        web_token_ttl_hours: parseInt(inputWebTtl.value, 10) || 168,
        web_browse_roots: taWebRoots.value
          .split("\n").map((s) => s.trim()).filter(Boolean),
        web_keep_alive: chkWebKeepalive.checked,
        web_tailscale_serve: chkWebTailscaleServe.checked,
        web_password_hash: currentConfig?.web_password_hash || "",
        // ── GDS : paramètre global d'activation ──
        gds_enabled: chkGdsEnabled.checked,
        help_model: currentConfig?.help_model || "",
        // ── Context Engine (H1) ──
        context_engine_enabled: chkContextEngine.checked,
        context_budget_tokens: parseInt(inputContextBudget.value, 10) || 8000,
        context_include_imports: chkContextImports.checked,
        context_include_specs: chkContextSpecs.checked,
        context_include_recents: chkContextRecents.checked,
        // ── Context Engine V2 (RAG) — section dédiée ──
        context_rag_enabled: chkContextRag ? chkContextRag.checked : false,
        context_rag_endpoint: (inputRagEndpoint.value || "http://127.0.0.1:11434").trim(),
        context_rag_model: (inputRagModel.value || "nomic-embed-text").trim(),
        // ── Code Graph — section dédiée ──
        code_graph_enabled: chkCodeGraph ? chkCodeGraph.checked : true,
        graph_extraction: selectGraphExtraction ? selectGraphExtraction.value : "heuristic",
        graph_inject_mode_a: chkGraphInjectA ? chkGraphInjectA.checked : true,
        graph_budget_tokens: parseInt(inputGraphBudget ? inputGraphBudget.value : "4000", 10) || 4000,
        graph_inject_mode_b: chkGraphInjectB ? chkGraphInjectB.checked : true,
        graph_include_calls: chkGraphIncludeCalls ? chkGraphIncludeCalls.checked : true,
        // ── Diff Review (A4 V2) : porte pré-écriture ──
        confirm_file_edits: chkConfirmFileEdits.checked,
        // ── Mémoire de projet (H3) ──
        project_memory_enabled: chkProjectMemory ? chkProjectMemory.checked : true,
        project_memory_auto_extract: chkProjectMemoryAuto ? chkProjectMemoryAuto.checked : false,
        // ── Gestion d'agents multi-rôles (H2 V2) ──
        agent_max_call_depth: parseInt(inputAgentMaxDepth.value, 10) || 3,
        agent_max_total_calls: parseInt(inputAgentMaxTotalCalls.value, 10) || 30,
        agent_timeout_ms: parseInt(inputAgentTimeoutMs.value, 10) || 600000,
        agent_max_result_tokens: parseInt(inputAgentMaxResultTokens.value, 10) || 4000,
        agent_max_turns: parseInt(inputAgentMaxTurns.value, 10) || 200,
        // ── Super-agent (spec_super_agent.md) ──
        super_agent_name: (inputSuperAgentName ? inputSuperAgentName.value : "Assistant").trim() || "Assistant",
        super_agent_clients: taSuperAgentClients
          ? taSuperAgentClients.value.split(/\n+/).map((s) => s.trim()).filter(Boolean)
          : [],
        super_agent_prompt: taSuperAgentPrompt ? taSuperAgentPrompt.value : "",
        super_agent_show_thinking: chkSuperAgentThinking ? chkSuperAgentThinking.checked !== false : true,
        // T6 : niveau de réflexion de l'Assistant. Un sélecteur désactivé conserve
        // la valeur enregistrée dans ses options → jamais de réglage effacé.
        super_agent_thinking_level: selectSuperAgentThinkingLevel ? selectSuperAgentThinkingLevel.value.trim() : "",
        super_agent_show_tools: chkSuperAgentTools ? chkSuperAgentTools.checked === true : false,
        notify_super_agent_done: chkSuperAgentNotifyDone ? chkSuperAgentNotifyDone.checked === true : false,
        assistant_sound_enabled: chkAssistantSoundEnabled ? chkAssistantSoundEnabled.checked === true : false,
        assistant_sound_volume: inputAssistantSoundVolume ? (parseInt(inputAssistantSoundVolume.value, 10) || 100) : 100,
        super_agent_concise: chkSuperAgentConcise ? chkSuperAgentConcise.checked === true : false,
        super_agent_coordinator: chkSuperAgentCoordinator ? chkSuperAgentCoordinator.checked === true : false,
        super_agent_user_friendly: chkSuperAgentUserFriendly ? chkSuperAgentUserFriendly.checked === true : false,
        super_agent_block_agent_input: chkSuperAgentBlockAgentInput ? chkSuperAgentBlockAgentInput.checked === true : false,
        super_agent_invisible_agent: chkSuperAgentInvisibleAgent ? chkSuperAgentInvisibleAgent.checked !== false : true,
        // Chantier 5/5 : purge automatique avant délégation (défaut ON).
        super_agent_purge_before_delegate: chkSuperAgentPurgeBeforeDelegate ? chkSuperAgentPurgeBeforeDelegate.checked !== false : true,
        super_agent_quality_gate: chkSuperAgentQualityGate ? chkSuperAgentQualityGate.checked !== false : true,
        super_agent_force_structured_brief: chkSuperAgentForceStructuredBrief ? chkSuperAgentForceStructuredBrief.checked !== false : true,
        super_agent_inherit_context: chkSuperAgentInheritContext ? chkSuperAgentInheritContext.checked === true : false,
        super_agent_auto_check_startup: chkSuperAgentAutoCheckStartup ? chkSuperAgentAutoCheckStartup.checked === true : false,
        // ── Lot A idée 6 : fréquence par défaut des rappels de surveillance ──
        // Bornée au minimum technique de 60 s (le select propose 5 min minimum,
        // mais une config ancienne/corrompue ne doit jamais descendre sous 60 s).
        super_agent_schedule_interval_secs: normalizeScheduleInterval(
          selectSuperAgentScheduleInterval ? selectSuperAgentScheduleInterval.value : 3600
        ),
        // ── Tâche #160 : overlay plein écran des événements ──
        super_agent_events_overlay_enabled: chkSuperAgentEventsOverlay ? chkSuperAgentEventsOverlay.checked === true : false,
        super_agent_events_overlay_seconds: inputSuperAgentEventsOverlaySeconds ? (parseInt(inputSuperAgentEventsOverlaySeconds.value, 10) || 5) : 5,
        super_agent_tasks_tab_enabled: chkSuperAgentTasksTab ? chkSuperAgentTasksTab.checked !== false : true,
        // ── Lot A idée 3 (tranche 3.5) : checklist de livraison ──
        // Mode normalisé (off/warn/block, défaut « rappel ») et modèle de points
        // normalisé (un champ vidé retombe sur le modèle par défaut côté Rust :
        // `save_config` réécrit toute la config, un vide écraserait le défaut).
        super_agent_checklist_mode: selectSuperAgentChecklistMode
          ? normalizeChecklistMode(selectSuperAgentChecklistMode.value)
          : normalizeChecklistMode(currentConfig?.super_agent_checklist_mode),
        super_agent_checklist_template: taSuperAgentChecklistTemplate
          ? normalizeChecklistTemplate(taSuperAgentChecklistTemplate.value)
          : normalizeChecklistTemplate(currentConfig?.super_agent_checklist_template),
        // ── Lot A idée 4 (tranche 5b) : traçabilité des livraisons ──
        // Champ absent du DOM ⇒ vrai (défaut), pour ne jamais désactiver un
        // réglage que l'utilisateur n'a pas touché.
        super_agent_tracabilite_enabled: chkSuperAgentTracabilite ? chkSuperAgentTracabilite.checked !== false : true,
        // ── Lot A idée 2 (tranche 5) : affichage du suivi du temps ──
        // Champ absent du DOM ⇒ faux par défaut : le suivi du temps reste masqué
        // tant qu'il n'est pas explicitement demandé.
        super_agent_show_time: chkSuperAgentShowTime ? chkSuperAgentShowTime.checked === true : false,
      };
    try {
      await invoke("save_config", { config });
      // Les clients de l'assistant vivent dans la BASE DE SUIVI (source de vérité) :
      // la liste saisie y est appliquée via les commandes dédiées. La config
      // n'en garde qu'un miroir, resynchronisé depuis la base par Rust.
      await applySuperAgentClientsToDb(config.super_agent_clients);
      window._pilotModalAnimations = config.modal_animations !== false;
      applyTheme(config.theme, config.subtheme || "default");
      refreshShowThinking();
      refreshShowTools();
      // Notifier le changement d'auto-save
      window.dispatchEvent(new CustomEvent("pilot-config-changed", { detail: config }));
      // Relancer l'agent a chaud si les parametres de lancement RPC ont change
      // (chemin pi / no-session / repertoire de session). Si l'onglet agent est
      // ouvert, agent-pi.js ecoute l'evenement et redemarre le backend ; sinon
      // rien a faire (le prochain openFile lira la nouvelle config). Sans ca,
      // l'agent resterait sur l'ancien backend jusqu'a fermeture/ouverture
      // manuelle de l'onglet.
      // Relance agent à chaud si un paramètre impactant le spawn de pi a changé
      // (chemin/no-session/session-dir OU toggle porte pré-écriture qui charge/
      // décharge l'extension pilot-edit-gate). Un SEUL restart même si plusieurs
      // flags ont changé (évite deux stop+start en conflit : le 2e stop tuerait
      // le pi fraîchement démarré par le 1er → « pipe closed »).
      if ((rpcLaunchChanged || confirmEditsChanged) && config.rpc_agent_enabled) {
        const agentTab = window._pilotTabs && window._pilotTabs.tabs.find((t) => t.mode === "agent");
        if (agentTab) {
          window.dispatchEvent(new CustomEvent("pilot-agent-restart-needed"));
        }
      }
      rpcLaunchChanged = false;
      confirmEditsChanged = false;
      // Recharger à chaud le serveur web si les réglages réseau ont changé.
      if (webNetChanged) {
        try {
          await invoke("reload_web_server");
          const st = await invoke("web_status");
          maybeWarnBroadBind(st);
          if (st.enabled && !st.running) {
            alert(
              "Le serveur web distant n'a pas démarré.\n" +
              "Causes possibles : aucun mot de passe défini, ou port " + st.port + " déjà occupé.\n" +
              "Définissez un mot de passe dans la section « Accès distant » puis ré-enregistrez."
            );
          } else if (st.enabled && st.running) {
            console.log("[web] Serveur distant démarré sur http://" + st.bind + ":" + st.port);
          }
        } catch (e) { console.warn("reload_web_server:", e); }
        webNetChanged = false;
      }
      // ── Reconfiguration Tailscale Serve si la checkbox a changé (spec §14) ──
      // Note : reload_web_server (au-dessus) resync déjà via sync_serve_if_enabled
      // côté Rust quand l'option est cochée et le bind = 127.0.0.1. Ce bloc gère le
      // cas où la checkbox change SANS changement de port (webNetChanged false),
      // et la désactivation explicite (reset) quand on décoche.
      if (tailscaleChanged) {
        try {
          if (chkWebTailscaleServe.checked) {
            const r = await invoke("tailscale_enable_serve");
            if (!r.ok) {
              showToast("Tailscale Serve : " + (r.error || "échec"), "warning", 6000);
            }
          } else {
            await invoke("tailscale_disable_serve");
          }
        } catch (e) {
          showToast("Tailscale Serve : " + e, "warning", 6000);
        }
        tailscaleChanged = false;
        await refreshTailscaleStatus();
      }
    } catch (e) {
      console.error("Erreur sauvegarde config:", e);
    }
    stopLayaModelPoll();
    stopLayaProgressListener();
    modal.classList.add("hidden");
  });

  // NB: pas de fermeture au clic hors de la modale (issue #7). La modale ne doit
  // se fermer qu'explicitement (Annuler / Enregistrer). Un clic extérieur se
  // déclenchait aussi en fin de sélection souris dans un champ de saisie quand
  // la sélection dépassait la modale, ce qui la fermait sans le vouloir.

  // ── Accès distant : statut (mot de passe + clients) ──
  // ── Diff Review (A4 V2) : sonde la capacité du backend à charger l'extension
  // pilot-edit-gate. Si le backend (ex: plh) ne supporte pas `--extension`, on
  // désactive la checkbox + affiche une note d'info (option ignorée sans crash).
  async function refreshConfirmEditsAvailability() {
    if (!chkConfirmFileEdits) return;
    let supported = true;
    try {
      supported = await invoke("extension_gate_supported");
    } catch (_) { supported = true; }
    const note = document.getElementById("confirm-edits-note");
    if (supported) {
      chkConfirmFileEdits.disabled = false;
      if (note) note.style.display = "none";
    } else {
      chkConfirmFileEdits.checked = false;
      chkConfirmFileEdits.disabled = true;
      if (note) note.style.display = "block";
      confirmEditsChanged = false; // ne pas relancer pour une option désactivée
    }
  }

  async function refreshWebStatus() {
    try {
      const st = await invoke("web_status");
      maybeWarnBroadBind(st);
      webPwStatus.textContent = st.has_password ? "✓ défini" : "non défini";
      webPwStatus.className = "web-pw-status " + (st.has_password ? "ok" : "muted");
      btnWebClearPw.disabled = !st.has_password;
      webActiveCount.textContent = String(st.active_count);
      btnWebKick.disabled = !st.active_count;
      // Badge compteur d'audit sur le bouton « Journal ».
      try {
        const n = await invoke("web_audit_count");
        btnWebAudit.innerHTML = n > 0
          ? `<i data-lucide="scroll-text" class="icon-sm"></i> Ouvrir le journal (${n})`
          : `<i data-lucide="scroll-text" class="icon-sm"></i> Ouvrir le journal`;
        refreshIcons();
      } catch (_) { /* web désactivé */ }
    } catch (_) {
      webPwStatus.textContent = "?";
      webActiveCount.textContent = "0";
      btnWebKick.disabled = true;
    }
  }

  // Réseau (enabled/bind/port) → flag pour reload du serveur au save.
  [chkWebEnabled, inputWebBind, inputWebPort].forEach((el) =>
    el.addEventListener("change", () => { webNetChanged = true; })
  );

  // Lancement de l'agent (chemin/no-session/répertoire de session) → flag
  // pour relancer l'agent à chaud au save (évite « ça ne répond plus » après
  // reconfig du backend, ex: plh → pi). Voir agent-pi.js onRestartNeeded.
  [inputRpcPath, chkRpcNoSession, inputRpcSessionDir].forEach((el) =>
    el.addEventListener("change", () => { rpcLaunchChanged = true; })
  );

  // Diff Review (A4 V2) : toggle de la porte pré-écriture → relance agent à chaud
  // pour charger/décharger l'extension pi pilot-edit-gate.
  if (chkConfirmFileEdits) {
    chkConfirmFileEdits.addEventListener("change", () => { confirmEditsChanged = true; });
  }

  // H2 V1 : toggle de la visibilité des globs critiques selon le scope reviewer.
  if (selectOrchReviewerScope && rowOrchReviewerPatterns) {
    selectOrchReviewerScope.addEventListener("change", () => {
      rowOrchReviewerPatterns.style.display = (selectOrchReviewerScope.value === "critical") ? "" : "none";
    });
  }

  // Définir / changer le mot de passe distant.
  btnWebSetPw.addEventListener("click", async () => {
    const pw = prompt("Définir le mot de passe d'accès distant :\n(vide = désactiver le serveur)");
    if (pw === null) return; // annulé
    try {
      await invoke("set_web_password", { password: pw });
      // Recharger la config pour récupérer le hash fraîchement défini (sinon le
      // prochain « Enregistrer » l'écraserait avec l'ancienne valeur "").
      try { currentConfig = await invoke("get_config"); } catch (_) {}
      await refreshWebStatus();
      // Le serveur peut nécessiter un (re)démarrage si on vient d'activer.
      webNetChanged = true;
    } catch (e) {
      alert("Erreur : " + e);
    }
  });

  // Effacer le mot de passe (désactive le serveur).
  btnWebClearPw.addEventListener("click", async () => {
    if (!confirm("Effacer le mot de passe distant ? Le serveur web sera désactivé et toutes les sessions révoquées.")) return;
    try {
      await invoke("set_web_password", { password: "" });
      try { currentConfig = await invoke("get_config"); } catch (_) {}
      await refreshWebStatus();
      webNetChanged = true;
    } catch (e) {
      alert("Erreur : " + e);
    }
  });

  // Déconnecter tous les clients distants (kick remote).
  btnWebKick.addEventListener("click", async () => {
    if (!confirm("Déconnecter immédiatement tous les clients web connectés ?")) return;
    try {
      await invoke("web_kick_remote");
      await refreshWebStatus();
    } catch (e) {
      alert("Erreur : " + e);
    }
  });

  // ── Tailscale Serve auto (spec_web_remote.md §14) ──
  async function refreshTailscaleStatus() {
    try {
      const st = await invoke("tailscale_status");
      if (!st.available) {
        tsBadge.textContent = "Tailscale : ❌ non détecté";
        tsBadge.className = "tailscale-badge fail";
        chkWebTailscaleServe.disabled = true;
        tsBlock.style.opacity = "0.5";
        tsUrl.value = "";
        tsServeStatus.textContent = "Statut serve : —";
        tsQrcode.innerHTML = "";
        if (st.error) tsBadge.title = st.error;
        return;
      }
      chkWebTailscaleServe.disabled = false;
      tsBlock.style.opacity = "";
      tsBadge.textContent = st.online
        ? `Tailscale : ✓ actif (${st.dns_name || "?"})`
        : "Tailscale : ⚠️ installé mais hors-ligne";
      tsBadge.className = "tailscale-badge " + (st.online ? "ok" : "warn");
      tsUrl.value = st.url || "";
      const cfgPort = st.port || 0;
      if (st.serve_configured) {
        const portOk = st.serve_target_port === cfgPort;
        tsServeStatus.textContent = portOk
          ? `Statut serve : configuré vers ${st.serve_target_port} ✓`
          : `Statut serve : ⚠️ configuré vers ${st.serve_target_port} (port config = ${cfgPort}) — reconfigurez`;
      } else {
        tsServeStatus.textContent = "Statut serve : non configuré";
      }
      tsQrcode.innerHTML = "";
      if (st.url) {
        try {
          const svg = await invoke("tailscale_serve_qrcode", { url: st.url });
          tsQrcode.innerHTML = svg;
        } catch (_) { tsQrcode.innerHTML = ""; }
      }
    } catch (e) {
      tsBadge.textContent = "Tailscale : ?";
      tsBadge.className = "tailscale-badge fail";
    }
  }

  tsCopyBtn.addEventListener("click", async () => {
    const url = tsUrl.value;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Adresse copiée : " + url, "success", 4000);
    } catch (_) {
      tsUrl.select();
      showToast("Copie automatique bloquée — copiez manuellement (Ctrl+C)", "warning", 6000);
    }
  });

  tsReconfigureBtn.addEventListener("click", async () => {
    try {
      const r = await invoke("tailscale_enable_serve");
      if (r.ok) {
        showToast("Tailscale Serve reconfiguré → " + (r.url || ""), "success", 5000);
      } else {
        showToast("Tailscale Serve : " + (r.error || "échec"), "warning", 6000);
      }
      await refreshTailscaleStatus();
    } catch (e) {
      showToast("Tailscale Serve : " + e, "warning", 6000);
    }
  });

  chkWebTailscaleServe.addEventListener("change", () => { tailscaleChanged = true; });

  // Badge distant (barre d'actions) : polling léger + clic ouvre la modale.
  remoteBadge.addEventListener("click", () => btnSettings.click());
  async function pollRemoteBadge() {
    try {
      const st = await invoke("web_status");
      maybeWarnBroadBind(st);
      if (st.running && st.active_count > 0) {
        remoteBadge.classList.remove("hidden", "off");
        remoteBadgeCount.textContent = String(st.active_count);
      } else if (st.running) {
        remoteBadge.classList.remove("hidden");
        remoteBadge.classList.add("off");
        remoteBadgeCount.textContent = "0";
      } else {
        remoteBadge.classList.add("hidden");
      }
    } catch (_) { /* serveur web non disponible */ }
  }
  pollRemoteBadge();
  setInterval(pollRemoteBadge, 5000);

  // Charger et appliquer le thème au démarrage
  try {
    const cfg = await invoke("get_config");
    window._pilotModalAnimations = cfg.modal_animations !== false;
    applyTheme(cfg.theme || "dark", cfg.subtheme || "default");
  } catch (_) {
    applyTheme("dark", "default");
  }

  // Rafraîchir les selects de modèles quand le registre a été édité depuis
  // l'onglet Fournisseurs (models-config.js). On repeuple uniquement si la
  // modale est ouverte (currentConfig chargé).
  window.addEventListener("pilot-models-changed", async () => {
    if (!currentConfig) return;
    try {
      const models = await loadModelsList();
      populateModelSelect(inputPdfMdModel, models, currentConfig.pdf_md_model || "");
      populateModelSelect(inputSuperAgentDefaultModel, models, currentConfig.super_agent_default_model || "");
      populateModelSelect(inputOrchestratorModel, models, currentConfig.orchestrator_provider
        ? `${currentConfig.orchestrator_provider}/${currentConfig.orchestrator_model_id}` : "");
      populateModelSelect(inputCoderModel, models, currentConfig.coder_provider
        ? `${currentConfig.coder_provider}/${currentConfig.coder_model_id}` : "");
      const reviewerModelValue = currentConfig.orchestration_reviewer_provider
        ? `${currentConfig.orchestration_reviewer_provider}/${currentConfig.orchestration_reviewer_model}` : "";
      populateModelSelect(selectOrchReviewerModel, models, reviewerModelValue);
    } catch (_) { /* ignore */ }
  });
}
