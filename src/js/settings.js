// settings.js — Modale de paramètres

import { invoke } from "@tauri-apps/api/core";
import { applyTheme, getCurrentTheme, getCurrentSubtheme, SUBTHEMES } from "./theme.js";
import { refreshShowThinking, refreshShowTools } from "./agent-pi.js";
import { showToast } from "./toast.js";
import { refreshIcons } from "./icons.js";
import { saveProvidersIfDirty, cancelProvidersIfDirty } from "./models-config.js";
import { animateModalOpen } from "./modal-anim.js";

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
  const chkSuperAgentConcise = document.getElementById("setting-superagent-concise");
  const chkSuperAgentBlockAgentInput = document.getElementById("setting-superagent-block-agent-input");
  const chkSuperAgentInvisibleAgent = document.getElementById("setting-superagent-invisible-agent");
  const chkSuperAgentQualityGate = document.getElementById("setting-superagent-quality-gate");
const chkSuperAgentInheritContext = document.getElementById("setting-superagent-inherit-context");
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
    selectTheme.value = currentConfig.theme || "dark";
    inputCmd.value = currentConfig.default_command || "";
    chkAutoLoad.checked = currentConfig.auto_load_last_project || false;
    chkAutoRun.checked = currentConfig.auto_run_command || false;
    chkIntegratedTerminal.checked = currentConfig.integrated_terminal || false;
    chkRpcAgent.checked = currentConfig.rpc_agent_enabled || false;
    inputRpcPath.value = currentConfig.rpc_pi_path || "";
    chkRpcNoSession.checked = currentConfig.rpc_no_session || false;
    inputRpcSessionDir.value = currentConfig.rpc_session_dir || "";
    if (chkMultiAgentTabs) chkMultiAgentTabs.checked = currentConfig.multi_agent_tabs === true;
    if (chkDashboardAutoOpen) chkDashboardAutoOpen.checked = currentConfig.dashboard_auto_open === true;
    if (chkDashboardAutoRefresh) chkDashboardAutoRefresh.checked = currentConfig.dashboard_auto_refresh !== false;
    if (inputDashboardAutoRefreshSeconds) inputDashboardAutoRefreshSeconds.value = currentConfig.dashboard_auto_refresh_seconds ?? 10;
    if (inputSessionRetention) inputSessionRetention.value = currentConfig.session_retention_days ?? 15;
    chkShowThinking.checked = currentConfig.show_thinking !== false;
    chkShowTools.checked = currentConfig.show_tools || false;
    if (chkNotifyAgentDone) chkNotifyAgentDone.checked = currentConfig.notify_agent_done === true;
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
  if (chkSuperAgentConcise) chkSuperAgentConcise.checked = currentConfig.super_agent_concise === true;
  if (chkSuperAgentBlockAgentInput) chkSuperAgentBlockAgentInput.checked = currentConfig.super_agent_block_agent_input === true;
  if (chkSuperAgentInvisibleAgent) chkSuperAgentInvisibleAgent.checked = currentConfig.super_agent_invisible_agent !== false;
  if (chkSuperAgentQualityGate) chkSuperAgentQualityGate.checked = currentConfig.super_agent_quality_gate !== false;
  if (chkSuperAgentInheritContext) chkSuperAgentInheritContext.checked = currentConfig.super_agent_inherit_context === true;
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

  // Fermer (Annuler) — annule aussi les modifs providers non sauvegardées
  btnClose.addEventListener("click", async () => {
    await cancelProvidersIfDirty();
    // Revert l'aperçu en direct : on revient au thème/sous-thème sauvegardé
    applyTheme(savedTheme, savedSubtheme);
    modal.classList.add("hidden");
  });

  // Ouvrir depuis l'extérieur (ex: gate E4 dans tabs.js → bouton « Ouvrir les
  // paramètres » quand l'agent est indisponible). Focus le champ chemin pi.
  window.addEventListener("pilot-open-settings", () => {
    populateSubthemeSelect(selectSubtheme, savedTheme, savedSubtheme);
    modal.classList.remove("hidden");
    try { inputRpcPath.focus(); inputRpcPath.scrollIntoView({ block: "center" }); } catch (_) {}
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
        integrated_terminal: chkIntegratedTerminal.checked,
        rpc_agent_enabled: chkRpcAgent.checked,
        rpc_pi_path: inputRpcPath.value.trim(),
        rpc_no_session: chkRpcNoSession.checked,
        rpc_session_dir: inputRpcSessionDir.value.trim(),
        multi_agent_tabs: chkMultiAgentTabs ? chkMultiAgentTabs.checked : false,
        dashboard_auto_open: chkDashboardAutoOpen ? chkDashboardAutoOpen.checked : false,
        dashboard_auto_refresh: chkDashboardAutoRefresh ? chkDashboardAutoRefresh.checked : true,
        dashboard_auto_refresh_seconds: inputDashboardAutoRefreshSeconds ? (parseInt(inputDashboardAutoRefreshSeconds.value, 10) || 10) : 10,
        session_retention_days: inputSessionRetention ? (parseInt(inputSessionRetention.value, 10) || 15) : 15,
        quality_gate_enabled: currentConfig?.quality_gate_enabled || false,
        show_thinking: chkShowThinking.checked,
        show_tools: chkShowTools.checked,
        notify_agent_done: chkNotifyAgentDone ? chkNotifyAgentDone.checked : false,
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
        super_agent_concise: chkSuperAgentConcise ? chkSuperAgentConcise.checked === true : false,
        super_agent_block_agent_input: chkSuperAgentBlockAgentInput ? chkSuperAgentBlockAgentInput.checked === true : false,
        super_agent_invisible_agent: chkSuperAgentInvisibleAgent ? chkSuperAgentInvisibleAgent.checked !== false : true,
        super_agent_quality_gate: chkSuperAgentQualityGate ? chkSuperAgentQualityGate.checked !== false : true,
        super_agent_inherit_context: chkSuperAgentInheritContext ? chkSuperAgentInheritContext.checked === true : false,
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
