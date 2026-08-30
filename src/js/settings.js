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
import { MCP_TRANSPORT, parseArgs, formatArgs, validateServer, newServerId, testResult } from "./mcp-utils.js";

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
  const chkShowTools = document.getElementById("setting-show-tools");
  const chkNotifyAgentDone = document.getElementById("setting-notify-agent-done");
  // ── Détection d'anomalies (tâche 8) ──
  const chkAnomalyEnabled = document.getElementById("setting-anomaly-enabled");
  const inputAnomalyTimeout = document.getElementById("setting-anomaly-timeout");
  const chkAutoStopEnabled = document.getElementById("setting-auto-stop-enabled");
  const inputAutoStopTimeout = document.getElementById("setting-auto-stop-minutes");
  const inputPdfMdModel = document.getElementById("setting-pdf-md-model");
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
  const taSuperAgentPrompt = document.getElementById("setting-superagent-prompt");
  const chkSuperAgentThinking = document.getElementById("setting-superagent-thinking");
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
// ── Tâche #160 : overlay plein écran des événements ──
const chkSuperAgentEventsOverlay = document.getElementById("setting-superagent-events-overlay");
const inputSuperAgentEventsOverlaySeconds = document.getElementById("setting-superagent-events-overlay-seconds");
const superAgentEventsOverlayDurationRow = document.getElementById("superagent-events-overlay-duration-row");
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
  const mcpServersList = document.getElementById("mcp-servers-list");
  const btnMcpAdd = document.getElementById("btn-mcp-add");
  const btnMcpReload = document.getElementById("btn-mcp-reload");
  const mcpEditor = document.getElementById("mcp-editor");
  const mcpFName = document.getElementById("mcp-f-name");
  const mcpFCommand = document.getElementById("mcp-f-command");
  const mcpFArgs = document.getElementById("mcp-f-args");
  const mcpFEnabled = document.getElementById("mcp-f-enabled");
  const mcpFStatus = document.getElementById("mcp-f-status");
  const btnMcpSave = document.getElementById("btn-mcp-save");
  const btnMcpCancel = document.getElementById("btn-mcp-cancel");
  const mcpStatus = document.getElementById("mcp-status");
  let mcpServers = []; // état éditable ([{id,name,transport,enabled,command,args}])
  let mcpEditingId = null; // id du serveur en cours d'édition (null = nouveau)

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
    setMcpStatus("");
    renderMcpServers();
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
      meta.textContent = (s.transport || "stdio") + " · " + ((s.command || "") + " " + formatArgs(s.args || [])).trim() || "—";
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

  function openMcpEditor(s) {
    mcpEditingId = s ? s.id : null;
    mcpFName.value = s ? (s.name || "") : "";
    mcpFCommand.value = s ? (s.command || "") : "";
    mcpFArgs.value = s ? formatArgs(s.args || []) : "";
    mcpFEnabled.checked = s ? !!s.enabled : true;
    mcpFStatus.textContent = "";
    mcpFStatus.style.color = "var(--text-muted)";
    if (mcpEditor) {
      mcpEditor.style.display = "block";
      mcpEditor.scrollIntoView({ block: "nearest" });
    }
  }

  async function saveMcpServer() {
    const name = mcpFName.value.trim();
    const command = mcpFCommand.value.trim();
    const err = validateServer({ name, command });
    if (err) { mcpFStatus.textContent = "⚠ " + err; mcpFStatus.style.color = "var(--danger,#f87171)"; return; }
    const prev = mcpEditingId ? mcpServers.find((x) => x.id === mcpEditingId) : null;
    const id = mcpEditingId || (prev ? prev.id : newServerId(mcpServers));
    const server = {
      id,
      name,
      transport: MCP_TRANSPORT,
      enabled: mcpFEnabled.checked,
      command,
      args: parseArgs(mcpFArgs.value),
    };
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
        setMcpStatus(`✓ Connexion au serveur « ${label} » réussie.`, "var(--success,#4ade80)");
        showToast(`MCP : connexion OK (${label})`, "success", 4000);
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
    } catch (_) {
      currentConfig = { theme: "dark", default_command: "", recent_projects: [], auto_load_last_project: false, auto_run_command: false, integrated_terminal: false, rpc_agent_enabled: false, rpc_pi_path: "", rpc_no_session: false, rpc_session_dir: "", multi_agent_tabs: false, quality_gate_enabled: false, show_thinking: true, show_tools: false, pdf_md_model: "", auto_save: false, auto_save_delay: 3000, context_engine_enabled: true, context_budget_tokens: 8000, context_include_imports: true, context_include_specs: true, context_include_recents: true, context_rag_enabled: false, context_rag_endpoint: "http://127.0.0.1:11434", context_rag_model: "nomic-embed-text", modal_animations: true };
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
    chkShowTools.checked = currentConfig.show_tools || false;
    if (chkNotifyAgentDone) chkNotifyAgentDone.checked = currentConfig.notify_agent_done === true;
    // ── Détection d'anomalies (tâche 8) ──
    if (chkAnomalyEnabled) chkAnomalyEnabled.checked = currentConfig.anomaly_detection_enabled !== false;
    if (inputAnomalyTimeout) inputAnomalyTimeout.value = currentConfig.anomaly_timeout_minutes ?? 30;
    if (chkAutoStopEnabled) chkAutoStopEnabled.checked = currentConfig.agent_auto_stop_enabled !== false;
    if (inputAutoStopTimeout) inputAutoStopTimeout.value = currentConfig.agent_auto_stop_minutes ?? 10;
    inputPdfMdModel.value = currentConfig.pdf_md_model || "";
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
  if (taSuperAgentClients) taSuperAgentClients.value = Array.isArray(currentConfig.super_agent_clients)
    ? currentConfig.super_agent_clients.join("\n") : "";
  if (taSuperAgentPrompt) taSuperAgentPrompt.value = currentConfig.super_agent_prompt || "";
  if (chkSuperAgentThinking) chkSuperAgentThinking.checked = currentConfig.super_agent_show_thinking !== false;
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
  // ── Tâche #160 : overlay plein écran des événements ──
  if (chkSuperAgentEventsOverlay) chkSuperAgentEventsOverlay.checked = currentConfig.super_agent_events_overlay_enabled === true;
  if (inputSuperAgentEventsOverlaySeconds) inputSuperAgentEventsOverlaySeconds.value = currentConfig.super_agent_events_overlay_seconds ?? 5;
  if (superAgentEventsOverlayDurationRow) superAgentEventsOverlayDurationRow.style.display = (chkSuperAgentEventsOverlay && chkSuperAgentEventsOverlay.checked) ? "" : "none";
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
          if (taSuperAgentClients) taSuperAgentClients.value = Array.isArray(currentConfig.super_agent_clients)
            ? currentConfig.super_agent_clients.join("\n") : "";
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

  // Fermer (Annuler) — annule aussi les modifs providers non sauvegardées
  btnClose.addEventListener("click", async () => {
    await cancelProvidersIfDirty();
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
        // POC MCP : pas d'UI Paramètres (conservation silencieuse).
        mcp_enabled: currentConfig?.mcp_enabled || false,
        show_thinking: chkShowThinking.checked,
        show_tools: chkShowTools.checked,
        notify_agent_done: chkNotifyAgentDone ? chkNotifyAgentDone.checked : false,
        // ── Détection d'anomalies (tâche 8) ──
        anomaly_detection_enabled: chkAnomalyEnabled ? chkAnomalyEnabled.checked !== false : true,
        anomaly_timeout_minutes: inputAnomalyTimeout ? (parseInt(inputAnomalyTimeout.value, 10) || 30) : 30,
        // ── Arrêt auto des agents délégués bloqués (T2) ──
        agent_auto_stop_enabled: chkAutoStopEnabled ? chkAutoStopEnabled.checked !== false : true,
        agent_auto_stop_minutes: inputAutoStopTimeout ? (parseInt(inputAutoStopTimeout.value, 10) || 10) : 10,
        // ── Plafond « réfléchit » du super-agent (tâche #141) ──
        // Pas d'UI dédiée : on préserve les valeurs de la config courante pour
        // qu'un enregistrement des Paramètres ne les réinitialise pas (défauts
        // activé / 10 min, cf. lib.rs).
        super_agent_auto_stop_enabled: currentConfig?.super_agent_auto_stop_enabled !== false,
        super_agent_auto_stop_minutes: currentConfig?.super_agent_auto_stop_minutes || 10,
        pdf_md_model: inputPdfMdModel.value.trim(),
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
        // ── Super-agent (spec_super_agent.md) ──
        super_agent_name: (inputSuperAgentName ? inputSuperAgentName.value : "Assistant").trim() || "Assistant",
        super_agent_clients: taSuperAgentClients
          ? taSuperAgentClients.value.split(/\n+/).map((s) => s.trim()).filter(Boolean)
          : [],
        super_agent_prompt: taSuperAgentPrompt ? taSuperAgentPrompt.value : "",
        super_agent_show_thinking: chkSuperAgentThinking ? chkSuperAgentThinking.checked !== false : true,
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
        // ── Tâche #160 : overlay plein écran des événements ──
        super_agent_events_overlay_enabled: chkSuperAgentEventsOverlay ? chkSuperAgentEventsOverlay.checked === true : false,
        super_agent_events_overlay_seconds: inputSuperAgentEventsOverlaySeconds ? (parseInt(inputSuperAgentEventsOverlaySeconds.value, 10) || 5) : 5,
      };
    try {
      await invoke("save_config", { config });
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
