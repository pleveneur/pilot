// agents-ui.js — Rendu de l'onglet 🎭 Agents (H2 V2, spec_gestion_agents.md).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  loadAgentRegistry,
  saveAgentRegistry,
  normalizeAgent,
  validateAgentId,
  buildDefaultCoordinator,
} from "./agents.js";
import {
  initAgentsBus,
  destroyAgentsBus,
  startAgentsRun,
  stopAgentsRun,
} from "./agents-bus.js";

export async function createAgents(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "agents-container";

  // ── Layout 3 colonnes ──
  wrapper.innerHTML = `
    <div class="agents-sidebar">
      <div class="agents-sidebar-header">
        <span class="agents-title">🎭 Agents</span>
        <button class="agent-btn" id="btn-agents-reset" title="Réinitialiser les agents par défaut"><i data-lucide="rotate-cw" class="icon-sm"></i></button>
        <button class="agent-btn" id="btn-agents-add" title="Ajouter un agent"><i data-lucide="plus" class="icon-sm"></i></button>
      </div>
      <div class="agents-list" id="agents-list"></div>
    </div>
    <div class="agents-chat">
      <div class="agents-chat-messages" id="agents-chat-messages"></div>
      <div class="agents-chat-input-bar">
        <textarea id="agents-input" rows="1" placeholder="Demande au coordinateur..."></textarea>
        <button class="agent-btn" id="btn-agents-stop" title="Arrêter la run" disabled><i data-lucide="square" class="icon-sm"></i></button>
        <button class="agent-btn" id="btn-agents-send" title="Envoyer"><i data-lucide="send-horizontal" class="icon-sm"></i></button>
      </div>
    </div>
    <div class="agents-activity">
      <div class="agents-activity-title">Activité</div>
      <div class="agents-activity-content" id="agents-activity-content">
        <div class="muted">Aucune run en cours.</div>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const listEl = wrapper.querySelector("#agents-list");
  const messagesEl = wrapper.querySelector("#agents-chat-messages");
  const activityEl = wrapper.querySelector("#agents-activity-content");
  const inputEl = wrapper.querySelector("#agents-input");
  const sendBtn = wrapper.querySelector("#btn-agents-send");
  const stopBtn = wrapper.querySelector("#btn-agents-stop");
  const addBtn = wrapper.querySelector("#btn-agents-add");
  const resetBtn = wrapper.querySelector("#btn-agents-reset");

  let registry = { version: 1, agents: [] };
  let availableModels = [];
  let isRunning = false;
  let editingId = null;

  let currentEditorModal = null;

  // ── Chargement initial ──
  try {
    availableModels = await invoke("get_available_models_list");
  } catch (_) {
    availableModels = [];
  }

  async function reloadRegistry() {
    try {
      registry = await loadAgentRegistry();
      if (!registry.agents) registry.agents = [];
      renderList();
    } catch (e) {
      toastError("Erreur chargement agents : " + e);
    }
  }

  await reloadRegistry();

  // ── Bus d'agents ──
  // ⚠️ Les clés DOIVENT correspondre exactement aux noms d'événements émis par
  // agents-bus.js (emit("start"), emit("agentStart"), emit("delta"), …) car le
  // bus appelle busState.callbacks[event]. Tout préfixe « on » ici rendrait les
  // callbacks muets (bug historique : l'UI ne réagissait jamais à la run).
  const busCallbacks = {
    start: () => {
      isRunning = true;
      stopBtn.disabled = false;
      sendBtn.disabled = true;
      activityEl.innerHTML = `<div class="agents-status running">▶ Run démarrée</div>`;
    },
    agentStart: ({ agentId, model }) => {
      appendSystemMessage(messagesEl, `${agentIcon(agentId)} ${agentName(agentId)} réfléchit${model ? ` · ${model}` : ""}...`);
      updateActivity();
    },
    delta: ({ agentId, text }) => {
      appendOrUpdateAgentDelta(messagesEl, agentId, text);
    },
    toolStart: ({ agentId, toolName }) => {
      appendSystemMessage(messagesEl, `🔧 ${agentIcon(agentId)} ${agentName(agentId)} utilise : ${toolName}`);
      updateActivity();
    },
    notify: ({ agentId, message, notifyType }) => {
      const icon = notifyType === "warning" ? "⚠️" : notifyType === "error" ? "❌" : "ℹ️";
      appendSystemMessage(messagesEl, `${icon} ${agentIcon(agentId)} ${agentName(agentId)}: ${message}`);
      updateActivity();
    },
    transition: ({ from, to }) => {
      appendSystemMessage(messagesEl, `➡️ ${agentIcon(from)} ${agentName(from)} appelle ${agentIcon(to)} ${agentName(to)}`);
      updateActivity();
    },
    result: ({ from, to, text }) => {
      appendSystemMessage(messagesEl, `⬅️ ${agentIcon(from)} ${agentName(from)} a répondu à ${agentIcon(to)} ${agentName(to)}`, true);
    },
    done: ({ agentId, text }) => {
      appendAgentMessage(messagesEl, agentId, text, true);
      finishRun();
    },
    stop: () => {
      appendSystemMessage(messagesEl, "⏹ Run arrêtée par l'utilisateur.");
      finishRun();
    },
    error: ({ message }) => {
      appendErrorMessage(messagesEl, message);
      finishRun();
    },
  };

  await initAgentsBus(busCallbacks);

  function finishRun() {
    isRunning = false;
    stopBtn.disabled = true;
    sendBtn.disabled = false;
    activityEl.innerHTML = `<div class="muted">Aucune run en cours.</div>`;
  }

  function agentName(id) {
    const a = registry.agents.find((x) => x.id === id);
    return a ? a.name : id;
  }
  function agentIcon(id) {
    const a = registry.agents.find((x) => x.id === id);
    return a ? a.icon || "🤖" : "🤖";
  }

  function updateActivity() {
    const stack = window.__agentBusState?.callStack || [];
    const budget = window.__agentBusState?.budgetTotal ?? "?";
    activityEl.innerHTML = `
      <div class="agents-status running">▶ Run en cours</div>
      <div class="agents-metric">Budget restant : ${budget}</div>
      <div class="agents-metric">Pile : ${stack.length > 0 ? stack.map((s) => agentIcon(s.agentId) + " " + agentName(s.agentId)).join(" → ") : "coordinateur"}</div>
    `;
  }

  // ── Rendu de la liste ──
  function renderList() {
    listEl.innerHTML = "";
    for (const raw of registry.agents) {
      const a = normalizeAgent(raw);
      const card = document.createElement("div");
      card.className = "agent-card" + (a.readonly ? " readonly" : "");
      card.dataset.id = a.id;
      card.innerHTML = `
        <div class="agent-card-main">
          <span class="agent-card-icon">${a.icon || "🤖"}</span>
          <div class="agent-card-info">
            <div class="agent-card-name">${escapeHtml(a.name)}</div>
            <div class="agent-card-id muted">${escapeHtml(a.id)}</div>
          </div>
        </div>
        <div class="agent-card-models muted">
          π ${escapeHtml(a.models.pi || "—")} · ℓ ${escapeHtml(a.models.plh || "—")}
        </div>
        <div class="agent-card-actions">
          <button class="agent-btn" data-action="edit" title="Modifier"><i data-lucide="pencil" class="icon-sm"></i></button>
          ${a.id !== "coordinateur" ? `<button class="agent-btn" data-action="delete" title="Supprimer"><i data-lucide="trash-2" class="icon-sm"></i></button>` : ""}
        </div>
      `;
      listEl.appendChild(card);
    }
    refreshIcons(wrapper);
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest(".agent-card");
    const id = card?.dataset.id;
    if (!id) return;

    if (btn.dataset.action === "edit") {
      openEditor(id);
    } else if (btn.dataset.action === "delete") {
      if (!confirm(`Supprimer l'agent « ${agentName(id)} » ?`)) return;
      registry.agents = registry.agents.filter((a) => a.id !== id);
      await persistRegistry();
    }
  });

  // ── Modale éditeur d'agent ──
  function openEditor(id) {
    closeEditorModal();
    editingId = id;
    const existing = registry.agents.find((a) => a.id === id);
    const a = normalizeAgent(existing || buildDefaultCoordinator());
    const isNew = !existing;

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content agent-editor-content">
        <div class="modal-header">
          <h3>${isNew ? "Nouvel agent" : "Modifier « " + escapeHtml(a.name) + " »"}</h3>
          <button class="modal-close" id="btn-ae-close" title="Fermer">×</button>
        </div>
        <div class="agent-form">
          <label>ID (kebab-case)</label>
          <input type="text" id="ae-id" value="${escapeHtml(a.id)}" ${!isNew ? "disabled" : ""} />
          <label>Nom</label>
          <input type="text" id="ae-name" value="${escapeHtml(a.name)}" />
          <label>Icône</label>
          <input type="text" id="ae-icon" value="${escapeHtml(a.icon)}" />
          <label>Description</label>
          <input type="text" id="ae-description" value="${escapeHtml(a.description)}" />
          <label>Rôle</label>
          <textarea id="ae-role" rows="6">${escapeHtml(a.role)}</textarea>
          <label>Modèle π (pi)</label>
          <select id="ae-model-pi"><option value="">Modèle par défaut</option></select>
          <label>Modèle ℓ (plh)</label>
          <select id="ae-model-plh"><option value="">Modèle par défaut</option></select>
          <div class="agent-form-checks">
            <label><input type="checkbox" id="ae-readonly" ${a.readonly ? "checked" : ""} /> Lecture seule</label>
            <label><input type="checkbox" id="ae-keep" ${a.keep_context ? "checked" : ""} /> Garder le contexte</label>
          </div>
          <label>Max appels / run</label>
          <input type="number" id="ae-max-calls" value="${a.max_calls_per_run}" min="1" max="100" />
          <label>Profondeur max</label>
          <input type="number" id="ae-depth" value="${a.call_depth}" min="0" max="10" />
        </div>
        <div class="modal-actions">
          <button id="btn-ae-save">Enregistrer</button>
          <button id="btn-ae-cancel">Annuler</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    currentEditorModal = modal;

    populateSelect(modal.querySelector("#ae-model-pi"), a.models.pi);
    populateSelect(modal.querySelector("#ae-model-plh"), a.models.plh);
    refreshIcons(modal);

    function closeModal() {
      if (modal.parentNode) modal.remove();
      if (currentEditorModal === modal) currentEditorModal = null;
    }

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    modal.querySelector("#btn-ae-close").addEventListener("click", closeModal);
    modal.querySelector("#btn-ae-cancel").addEventListener("click", closeModal);
    modal.querySelector("#btn-ae-save").addEventListener("click", async () => {
      const newId = modal.querySelector("#ae-id").value.trim();
      const name = modal.querySelector("#ae-name").value.trim();
      if (!newId || !name) {
        toastError("ID et nom sont requis.");
        return;
      }
      const ids = registry.agents.map((x) => x.id).filter((x) => x !== id);
      const v = validateAgentId(newId, ids);
      if (!v.ok) {
        toastError(v.error);
        return;
      }

      const updated = {
        id: newId,
        name,
        icon: modal.querySelector("#ae-icon").value.trim(),
        description: modal.querySelector("#ae-description").value.trim(),
        role: modal.querySelector("#ae-role").value.trim(),
        models: {
          pi: modal.querySelector("#ae-model-pi").value,
          plh: modal.querySelector("#ae-model-plh").value,
        },
        capabilities: a.capabilities,
        readonly: modal.querySelector("#ae-readonly").checked,
        keep_context: modal.querySelector("#ae-keep").checked,
        max_calls_per_run: parseInt(modal.querySelector("#ae-max-calls").value, 10) || 5,
        call_depth: parseInt(modal.querySelector("#ae-depth").value, 10) || 1,
      };

      if (existing) {
        const idx = registry.agents.findIndex((x) => x.id === id);
        registry.agents[idx] = updated;
      } else {
        registry.agents.push(updated);
      }
      await persistRegistry();
      closeModal();
    });
  }

  function closeEditorModal() {
    if (currentEditorModal && currentEditorModal.parentNode) {
      currentEditorModal.remove();
    }
    currentEditorModal = null;
  }

  function populateSelect(select, current) {
    for (const m of availableModels) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === current) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function persistRegistry() {
    try {
      await saveAgentRegistry(registry);
      toastSuccess("Registre agents sauvegardé.");
      await reloadRegistry();
      // Recharger le bus avec le nouveau registre
      await initAgentsBus(busCallbacks);
    } catch (e) {
      toastError("Erreur sauvegarde agents : " + e);
    }
  }

  // ── Boutons globaux ──
  addBtn.addEventListener("click", () => openEditor(""));
  resetBtn.addEventListener("click", async () => {
    if (!confirm("Réinitialiser les 6 agents par défaut ? Cela écrase ~/.pilot/agents.json.")) return;
    try {
      await invoke("save_agent_registry", { registry: { version: 1, agents: [] } });
      await reloadRegistry();
      await initAgentsBus(busCallbacks);
      toastSuccess("Agents réinitialisés.");
    } catch (e) {
      toastError("Erreur réinitialisation : " + e);
    }
  });

  // ── Chat ──
  async function doSend() {
    const text = inputEl.value.trim();
    if (!text || isRunning) return;
    inputEl.value = "";
    resizeInput();
    // Nouvelle run = conversation fraîche : on vide l'ancienne conversation PUIS
    // on ajoute la demande utilisateur (ne pas vider dans le callback "start" du
    // bus, sinon la bulle utilisateur serait effacée juste après son ajout).
    messagesEl.innerHTML = "";
    appendUserMessage(messagesEl, text);
    try {
      await startAgentsRun(text);
    } catch (e) {
      console.error("[agents-ui] startAgentsRun error", e);
      toastError("Erreur run agents : " + e);
    }
  }

  sendBtn.addEventListener("click", doSend);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  inputEl.addEventListener("input", resizeInput);

  stopBtn.addEventListener("click", () => stopAgentsRun());

  function resizeInput() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }

  // ── Cleanup ──
  function cleanup() {
    closeEditorModal();
    destroyAgentsBus();
  }

  return { wrapper, unlisten: cleanup };
}

// ── Helpers DOM ──

function appendUserMessage(container, text) {
  const div = document.createElement("div");
  div.className = "agents-message agents-message-user";
  div.innerHTML = `<div class="agents-bubble">${renderMarkdownPlain(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendAgentMessage(container, agentId, text, isFinal = false) {
  const existing = container.querySelector(`.agents-message-agent[data-agent-id="${escapeCss(agentId)}"]`);
  if (existing && !isFinal) {
    existing.querySelector(".agents-bubble").innerHTML += renderMarkdownPlain(text);
  } else {
    const div = document.createElement("div");
    div.className = "agents-message agents-message-agent";
    div.dataset.agentId = agentId;
    div.innerHTML = `<div class="agents-bubble">${renderMarkdownPlain(text)}</div>`;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

function appendOrUpdateAgentDelta(container, agentId, text) {
  appendAgentMessage(container, agentId, text, false);
}

function appendSystemMessage(container, text, collapsed = false) {
  const div = document.createElement("div");
  div.className = "agents-message agents-message-system";
  div.innerHTML = `<div class="agents-system-text${collapsed ? " collapsed" : ""}">${escapeHtml(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendErrorMessage(container, text) {
  const div = document.createElement("div");
  div.className = "agents-message agents-message-error";
  div.innerHTML = `<div class="agents-bubble">❌ ${escapeHtml(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderMarkdownPlain(text) {
  // Rendu ultra-léger : échapper le HTML, conserver les sauts de ligne.
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCss(str) {
  return String(str).replace(/"/g, '\\"');
}
