// agents-ui.js — Onglet 🎭 Agents : écran de CONFIGURATION des agents
// (spec_gestion_agents.md, cahier D7).
//
// La colonne « discussion » (chat coordinateur, mode parallèle, stop, envoyer)
// a été supprimée : les lancements passent par l'onglet 🧭 Assistant et par les
// onglets d'agents. Cet écran sert à gérer le registre (liste + éditeur, dont
// les compétences de chaque agent) et à AFFICHER l'activité des runs en cours
// (y compris ceux lancés ailleurs, via le bus d'agents).

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  loadAgentRegistry,
  saveAgentRegistry,
  normalizeAgent,
  validateAgentId,
  buildDefaultCoordinator,
  registryAfterReset,
} from "./agents.js";
import { initAgentsBus, destroyAgentsBus, stopAgentsRun } from "./agents-bus.js";

export async function createAgents(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "agents-container";

  // ── Layout 2 colonnes : liste des agents + activité ──
  wrapper.innerHTML = `
    <div class="agents-sidebar">
      <div class="agents-sidebar-header">
        <span class="agents-title">🎭 Agents</span>
        <button class="agent-btn" id="btn-agents-reset" title="Restaurer les 7 agents fournis (vos agents personnalisés sont conservés)"><i data-lucide="rotate-cw" class="icon-sm"></i></button>
        <button class="agent-btn" id="btn-agents-add" title="Ajouter un agent"><i data-lucide="plus" class="icon-sm"></i></button>
      </div>
      <div class="agents-list" id="agents-list"></div>
    </div>
    <div class="agents-activity">
      <div class="agents-activity-header">
        <span class="agents-activity-title">Activité</span>
        <button class="agent-btn" id="btn-agents-stop" title="Arrêter la run" style="display:none">⏹ Arrêter</button>
      </div>
      <div class="agents-activity-content" id="agents-activity-content">
        <div class="muted">Aucune run en cours.</div>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const listEl = wrapper.querySelector("#agents-list");
  const activityEl = wrapper.querySelector("#agents-activity-content");
  const stopBtn = wrapper.querySelector("#btn-agents-stop");
  const addBtn = wrapper.querySelector("#btn-agents-add");
  const resetBtn = wrapper.querySelector("#btn-agents-reset");

  let registry = { version: 1, agents: [] };
  let availableModels = [];
  let commonSkills = []; // compétences de la bibliothèque commune (~/.pilot/skills)
  let defaultIds = []; // identifiants fournis d'origine (D4) — non créables
  let isRunning = false;
  let agentStates = new Map(); // agentId -> { order, status, detail, model, run }
  let agentOrder = 0;

  let currentEditorModal = null;

  // ── Chargement initial ──
  try {
    availableModels = await invoke("get_available_models_list");
  } catch (_) {
    availableModels = [];
  }
  try {
    commonSkills = await invoke("list_common_skills");
    if (!Array.isArray(commonSkills)) commonSkills = [];
  } catch (_) {
    commonSkills = [];
  }
  try {
    defaultIds = await invoke("default_agent_ids");
    if (!Array.isArray(defaultIds)) defaultIds = [];
  } catch (_) {
    defaultIds = [];
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
  // agents-bus.js (emit("start"), emit("agentStart"), …) car le bus appelle
  // busState.callbacks[event]. Tout préfixe « on » ici rendrait les callbacks
  // muets (bug historique : l'UI ne réagissait jamais à la run).
  //
  // Ces callbacks n'affichent plus de conversation (D7) : ils alimentent
  // uniquement le tableau d'activité, de sorte qu'une run lancée depuis
  // l'assistant ou un onglet d'agent reste visible ici.
  const busCallbacks = {
    start: () => {
      isRunning = true;
      agentStates.clear();
      agentOrder = 0;
      updateActivity();
    },
    agentStart: ({ agentId, model }) => {
      mark(agentId, "pense", model || "");
      updateActivity();
    },
    delta: ({ agentId }) => {
      mark(agentId, "pense", "répond en direct…");
      updateActivity();
    },
    toolStart: ({ agentId, toolName }) => {
      mark(agentId, "outil", toolName || "outil");
      updateActivity();
    },
    notify: ({ agentId, message, notifyType }) => {
      mark(agentId, notifyType === "error" ? "err" : "note", message);
      updateActivity();
    },
    transition: ({ from, to }) => {
      mark(from, "appelle", `→ ${agentName(to)}`);
      updateActivity();
    },
    parallelStart: ({ assignments }) => {
      for (const a of assignments) mark(a.agentId, "parallèle", "en cours…");
      updateActivity();
    },
    parallelDone: ({ results }) => {
      for (const [id, r] of Object.entries(results)) {
        mark(id, r.status === "error" ? "err" : "fait", "résultat reçu");
      }
      updateActivity();
    },
    result: ({ from, to }) => {
      mark(to, "reprend", `← résultat de ${agentName(from)}`);
      updateActivity();
    },
    done: () => finishRun(),
    stop: () => {
      const cur = window.__agentBusState?.currentAgentId;
      if (cur) mark(cur, "stop", "arrêté");
      finishRun();
    },
    error: ({ message }) => {
      const cur = window.__agentBusState?.currentAgentId;
      if (cur) mark(cur, "err", message);
      finishRun();
    },
  };

  await initAgentsBus(busCallbacks);

  function finishRun() {
    isRunning = false;
    // Conserver le tableau d'activité final (issue #9) : on bascule simplement
    // le statut de la run en « terminée » au lieu de tout effacer.
    updateActivity();
  }

  function agentName(id) {
    const a = registry.agents.find((x) => x.id === id);
    return a ? a.name : id;
  }
  function agentIcon(id) {
    const a = registry.agents.find((x) => x.id === id);
    return a ? a.icon || "🤖" : "🤖";
  }

  // Enregistre l'état courant d'un agent dans le panneau « Activité » (issue #9).
  function mark(agentId, status, detail = "") {
    if (!agentStates.has(agentId)) {
      agentStates.set(agentId, { order: agentOrder++, status: "", detail: "" });
    }
    const s = agentStates.get(agentId);
    s.status = status;
    s.detail = detail;
    s.model = "";
  }

  function updateActivity() {
    stopBtn.style.display = isRunning ? "" : "none";
    // Rien à afficher : message neutre plutôt qu'un tableau vide « Run terminée ».
    if (!isRunning && agentStates.size === 0) {
      activityEl.innerHTML =
        '<div class="muted">Aucune run en cours.<br>Les lancements se font depuis l\'onglet 🧭 Assistant ou depuis les onglets d\'agents.</div>';
      return;
    }
    const st = window.__agentBusState;
    const stack = st?.callStack || [];
    const budget = st?.budgetTotal ?? "?";
    const depth = st?.maxDepth ?? "?";
    const chain = stack.length
      ? stack.map((s) => agentIcon(s.agentId) + " " + agentName(s.agentId)).join(" → ")
      : "coordinateur";

    const statusLabel = isRunning ? "▶ Run en cours" : "Run terminée";
    const statusCls = isRunning ? "running" : "";

    const board = Array.from(agentStates.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([agentId, s]) => {
        const a = registry.agents.find((x) => x.id === agentId);
        const name = a ? a.name : agentId;
        const icon = a && a.icon ? a.icon : "🤖";
        const desc = a && a.description ? a.description : "";
        const chip = s.status || "…";
        const chipCls = chip === "err" ? "error" : chip === "fait" ? "done" : chip === "outil" ? "tool" : "running";
        // Agent(s) actif(s) mis en avant (idees_evolutions.md §26) : surligné(s) en
        // vert, distinct(s) du reste de l'équipe. En parallèle, tous les agents
        // actifs (activeAgents) sont surlignés.
        const active = isRunning && (st?.activeAgents?.has(agentId) || agentId === st?.currentAgentId);
        return `
          <div class="agent-status-card ${chipCls}${active ? " active" : ""}">
            <span class="asc-icon">${icon}</span>
            <div class="asc-info">
              <div class="asc-name">${escapeHtml(name)}</div>
              ${desc ? `<div class="asc-desc">${escapeHtml(desc)}</div>` : ""}
              ${s.detail ? `<div class="asc-detail">${escapeHtml(s.detail)}</div>` : ""}
            </div>
            <span class="asc-chip ${chipCls}${active ? " active" : ""}">${escapeHtml(chip)}</span>
          </div>
        `;
      })
      .join("");

    activityEl.innerHTML = `
      <div class="agents-status ${statusCls}">${statusLabel}</div>
      <div class="agents-metric">Budget restant : ${budget}</div>
      <div class="agents-metric">Profondeur : ${stack.length} / ${depth}</div>
      <div class="agents-chain">${chain}</div>
      <div class="agents-board-title">Équipe</div>
      <div class="agents-board">${board || '<div class="muted">En attente de la première action…</div>'}</div>
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
      const badges = [];
      if (a.readonly) badges.push('<span class="agent-badge">lecture seule</span>');
      if (a.skills.length > 0) {
        badges.push(
          `<span class="agent-badge skills" title="${escapeHtml(a.skills.join(", "))}">🛠 ${a.skills.length}</span>`,
        );
      }
      card.innerHTML = `
        <div class="agent-card-main">
          <span class="agent-card-icon">${a.icon || "🤖"}</span>
          <div class="agent-card-info">
            <div class="agent-card-name">${escapeHtml(a.name)}</div>
            <div class="agent-card-id muted">${escapeHtml(a.id)}</div>
          </div>
        </div>
        ${badges.length ? `<div class="agent-card-badges">${badges.join("")}</div>` : ""}
        <div class="agent-card-models muted">
          π ${escapeHtml(a.models.pi || "—")} · ℓ ${escapeHtml(a.models.plh || "—")}
        </div>
        <div class="agent-card-actions">
          <button class="agent-btn" data-action="edit" title="Modifier"><i data-lucide="pencil" class="icon-sm"></i></button>
          <button class="agent-btn" data-action="delete" title="Supprimer"><i data-lucide="trash-2" class="icon-sm"></i></button>
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
      // Un agent FORNI est recréé avec sa configuration par défaut lors d'une
      // réinitialisation (et le coordinateur est recréé au démarrage) : on le
      // signale, contrairement à un agent personnalisé.
      const msg = defaultIds.includes(id)
        ? `Supprimer « ${agentName(id)} » ?\n\nCet agent fait partie des agents fournis d'origine : il sera restauré avec sa configuration par défaut lors d'une réinitialisation.`
        : `Supprimer l'agent « ${agentName(id)} » ?`;
      if (!confirm(msg)) return;
      registry.agents = registry.agents.filter((a) => a.id !== id);
      await persistRegistry();
    }
  });

  // ── Modale éditeur d'agent ──
  function openEditor(id) {
    closeEditorModal();
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
          <label>Compétences (bibliothèque commune)</label>
          <div class="agent-form-skills" id="ae-skills"></div>
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
    renderSkillsPicker(modal.querySelector("#ae-skills"), a.skills);
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
      // D4 : un identifiant fourni d'origine n'est pas créable (la
      // réinitialisation écraserait l'agent ainsi nommé).
      if (isNew && defaultIds.includes(newId)) {
        toastError(`« ${newId} » est un identifiant fourni par Pilot : choisissez un autre identifiant.`);
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
        skills: Array.from(modal.querySelectorAll("#ae-skills input:checked")).map((cb) => cb.value),
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

  // Cases à cocher des compétences de la bibliothèque commune. Les compétences
  // listées par l'agent mais absentes du disque restent affichées (cochées) :
  // sans ça, un enregistrement les ferait disparaître silencieusement.
  function renderSkillsPicker(container, selected) {
    const chosen = new Set(selected);
    const known = new Set(commonSkills.map((s) => s.name));
    for (const s of commonSkills) {
      container.appendChild(skillOption(s.name, s.description));
    }
    for (const name of selected) {
      if (!known.has(name)) {
        container.appendChild(skillOption(name, "introuvable dans la bibliothèque (~/.pilot/skills)"));
      }
    }
    if (container.childElementCount === 0) {
      const hint = document.createElement("span");
      hint.className = "muted";
      hint.innerHTML =
        'Aucune compétence disponible. Déposez un dossier <code>&lt;nom&gt;/SKILL.md</code> dans <code>~/.pilot/skills</code>.';
      container.appendChild(hint);
    }

    function skillOption(name, description) {
      const label = document.createElement("label");
      label.className = "agent-skill-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = name;
      cb.checked = chosen.has(name);
      const text = document.createElement("span");
      text.textContent = name;
      label.appendChild(cb);
      label.appendChild(text);
      label.title = description || name;
      return label;
    }
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
  // La colonne « discussion » a été retirée : le bouton ⏹ Arrêter reste, déplacé
  // dans l'en-tête du panneau d'activité (garde-fou conservé).
  stopBtn.addEventListener("click", () => {
    stopAgentsRun();
  });
  addBtn.addEventListener("click", () => openEditor(""));
  resetBtn.addEventListener("click", async () => {
    if (
      !confirm(
        "Restaurer les 7 agents fournis ?\n\nLeurs réglages par défaut sont réappliqués ; vos agents personnalisés sont conservés.",
      )
    )
      return;
    try {
      // reset_agent_registry (Rust) ne touche QUE les 7 agents fournis (D5).
      // Il renvoie ces 7 agents, mais PAS les agents personnalisés restés en
      // base : redessiner depuis ce retour les ferait disparaître de l'écran,
      // et la sauvegarde suivante les effacerait en base. On affiche donc le
      // registre RÉEL relu en base (source de vérité).
      const resetResult = await invoke("reset_agent_registry");
      registry = registryAfterReset(resetResult, await loadAgentRegistry());
      renderList();
      await initAgentsBus(busCallbacks);
      toastSuccess("Agents fournis restaurés.");
    } catch (e) {
      toastError("Erreur réinitialisation : " + e);
    }
  });

  // ── Cleanup ──
  function cleanup() {
    closeEditorModal();
    destroyAgentsBus();
  }

  return { wrapper, unlisten: cleanup };
}

// ── Helpers DOM ──

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
