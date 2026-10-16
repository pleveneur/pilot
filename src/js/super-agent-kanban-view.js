// super-agent-kanban-view.js — Vue Kanban multi-projets en onglet DÉDIÉ.
//
// L'onglet 🧭 Assistant ouvrait sa vue Kanban dans le panneau inférieur (bascule
// liste ↔ Kanban via le bouton « Vues »). Depuis cette évolution, le bouton
// « Vues » ouvre la vue Kanban dans un ONGLET DÉDIÉ de Pilot (pattern des onglets
// Review / Historique / Dashboard / Coffre), enregistré sous le mode
// `superagent-kanban` dans tabs.js.
//
// La logique PURE (structuration en colonnes, normalisation des statuts, filtre
// de projet, sous-catégorie « Idées », détection de blocage) reste dans
// super-agent-kanban.js — INCHANGÉE et réutilisée telle quelle. Les commandes
// Rust sont réutilisées à l'identique ; la sélection de projet et les idées
// viennent de la MÊME réponse `get_super_agent_kanban` (aucune table nouvelle :
// les idées sont lues dans la table existante `idees_evolutions`, alimentée par
// l'assistant). Les écritures vont UNIQUEMENT dans la base de suivi de
// l'Assistant (~/.pilot/super-agent.db), jamais sur les fichiers projets.
//
// Module autonome exportant createSuperKanban(container) → { wrapper, refresh,
// unlisten }, sur le pattern des onglets outils existants.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { ALL_PROJECTS, IDEAS_GROUP_LABEL, normalizeTaskStatus, columnToStatus,
  toggleSelection, selectionCount, canCloseSelection, bulkCloseConfirmMessage,
  planBulkClose, buildBulkUndoPlan,
  buildKanbanColumns, listKanbanProjects, filterKanbanTasks, selectKanbanIdeas,
  formatCardProject, isBlockedTask, isWaitingDependency, dependencyLabel } from "./super-agent-kanban.js";

/** Échappe le HTML (copie locale — non exportée depuis super-agent.js). */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Échappe une valeur pour un attribut HTML (guillemets inclus). */
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Clé de persistance du projet retenu par le sélecteur du Kanban (choix conservé
// d'une ouverture de l'onglet à l'autre, sur le modèle des autres préférences UI).
const KANBAN_PROJECT_KEY = "pilot:kanban:project";

/** Statuts proposés dans les listes déroulantes des cartes (libellés français). */
const STATUS_OPTIONS = [
  ["todo", "À faire"],
  ["progress", "En cours"],
  ["review", "À valider"],
  ["done", "Terminé"],
  ["unqualified", "À qualifier"],
  ["cancelled", "Annulée"],
];

/**
 * Monte la vue Kanban multi-projets dans `container` (un onglet dédié de Pilot).
 * Les listeners drag/drop/change/click sont délégués sur le conteneur (résistants
 * aux re-rendus) et disparaissent avec l'onglet fermé.
 * @param {HTMLElement} container - wrapper de l'onglet (tab.wrapper).
 * @returns {{ wrapper: HTMLElement, refresh: Function, unlisten: Function }}
 */
export function createSuperKanban(container) {
  // Réutilise les styles `.super-kanban*` existants ; la classe apportée par le
  // onglet (`.superagent-kanban-wrapper`) garantit le plein écran.
  container.classList.add("super-kanban");
  container.dataset.superKanbanView = "1";

  // Cache des tâches brutes du dernier chargement (id → task) : sert à
  // préremplir le formulaire d'édition (get_super_agent_kanban ne retourne que
  // les champs affichés, donc on garde la dernière réponse en mémoire).
  let kanbanTasksById = new Map();
  // Dernière réponse chargée, gardée en mémoire pour re-rendre le tableau quand
  // le filtre de projet change (aucun appel supplémentaire au backend).
  let kanbanClients = [];
  let kanbanIdeas = [];
  // Id de la carte glissée (résistant aux re-rendus : géré au niveau du conteneur).
  let dragTaskId = null;
  // Clôture en lot : ids cochés (persistants d'un re-rendu à l'autre pour ne pas
  // perdre la sélection pendant un rafraîchissement de la vue) et dernier lot
  // clôturé (pour le bouton « Annuler » de la confirmation de résultat).
  let selectedTaskIds = new Set();
  let lastBulkClose = null; // { changes: [{ id, from, to }] } | null
  // Projet affiché : « Tous les projets » par défaut, ou le chemin d'un projet.
  // Le choix est relu au montage de l'onglet et conservé dans localStorage.
  let projectFilter = readKanbanProjectFilter();

  /** Projet mémorisé (localStorage) — « Tous les projets » si absent/illisible. */
  function readKanbanProjectFilter() {
    try {
      return localStorage.getItem(KANBAN_PROJECT_KEY) || ALL_PROJECTS;
    } catch (_err) {
      return ALL_PROJECTS; // stockage indisponible : repli sûr
    }
  }

  /** Mémorise le projet retenu (best-effort : un échec ne casse pas la vue). */
  function saveKanbanProjectFilter(value) {
    try {
      localStorage.setItem(KANBAN_PROJECT_KEY, value || ALL_PROJECTS);
    } catch (_err) {
      /* stockage indisponible : le filtrage reste actif pour la session */
    }
  }

  /** Tâches VISIBLES avec le filtre courant (base de la clôture en lot). */
  const visibleTasks = () => filterKanbanTasks(kanbanClients, projectFilter);

  /** Reflète l'état de la sélection dans la barre du haut (sans re-rendu :
   *  la position de défilement et la mise en page restent intactes). */
  function syncBulkUi() {
    const bar = container.querySelector(".kanban-bulk-bar");
    if (!bar) return;
    const n = selectionCount(selectedTaskIds);
    bar.querySelector(".kanban-bulk-count").textContent =
      n === 0 ? "Aucune tâche sélectionnée" : `${n} tâche${n > 1 ? "s" : ""} sélectionnée${n > 1 ? "s" : ""}`;
    bar.querySelector(".kanban-bulk-close-btn").hidden = !canCloseSelection(selectedTaskIds);
    bar.querySelector(".kanban-bulk-clear-btn").hidden = !canCloseSelection(selectedTaskIds);
    const undo = bar.querySelector(".kanban-bulk-undo");
    const closed = (lastBulkClose && lastBulkClose.changes.length) || 0;
    undo.hidden = closed === 0;
    if (closed) {
      undo.querySelector(".kanban-bulk-undo-text").textContent =
        `${closed} tâche${closed > 1 ? "s" : ""} clôturée${closed > 1 ? "s" : ""}.`;
    }
  }

  /** Barre de sélection et de clôture en lot (sticky : reste visible au défilement). */
  function bulkBarHtml() {
    return `<div class="kanban-bulk-bar">
      <span class="kanban-bulk-count">Aucune tâche sélectionnée</span>
      <button type="button" class="kanban-bulk-clear-btn" hidden>Tout désélectionner</button>
      <button type="button" class="kanban-bulk-close-btn" hidden>Clôturer la sélection</button>
      <span class="kanban-bulk-undo" hidden>
        <span class="kanban-bulk-undo-text"></span>
        <button type="button" class="kanban-bulk-undo-btn">Annuler</button>
      </span>
    </div>`;
  }

  /** Sélecteur de projet (tous / un seul) + création. En mode « tous », chaque
   *  carte porte son projet (formatCardProject) pour rester identifiable. */
  function toolbarHtml() {
    const projects = listKanbanProjects(kanbanClients, kanbanIdeas);
    const opts = [
      `<option value="${ALL_PROJECTS}" ${projectFilter === ALL_PROJECTS ? "selected" : ""}>Tous les projets</option>`,
    ]
      .concat(
        projects.map(
          (p) =>
            `<option value="${escapeAttr(p.path)}" ${p.path === projectFilter ? "selected" : ""}>${escapeHtml(p.name)}</option>`
        )
      )
      .join("");
    return `<div class="kanban-toolbar">
      <label class="kanban-project-filter"><i data-lucide="folder" class="icon-sm"></i> Projet
        <select class="kanban-project-select" title="Afficher tous les projets ou un seul">${opts}</select>
      </label>
      <button type="button" class="kanban-new-btn" title="Créer une nouvelle carte"><i data-lucide="plus" class="icon-sm"></i> Nouvelle carte</button>
    </div>`;
  }

  /** Carte de TÂCHE : sélection, déplacement, édition, suppression. Le projet
   *  (+ client) et le MOTIF DE BLOCAGE sont affichés quand ils sont renseignés. */
  function taskCardHtml(t) {
    const rawTitle = t.title || "Sans titre";
    const title = escapeHtml(rawTitle);
    const proj = escapeHtml(formatCardProject(t));
    const desc = escapeHtml((t.description || "").slice(0, 140));
    const blocked = isBlockedTask(t);
    const blocker = blocked ? escapeHtml(String(t.blocker_reason).trim().slice(0, 200)) : "";
    // Dependance « attend la tache X » : etat DISTINCT du blocage par incident.
    const waiting = isWaitingDependency(t);
    const depLabel = waiting ? dependencyLabel(t) : "";
    const selKey = normalizeTaskStatus(t.status);
    const selOpts = STATUS_OPTIONS
      .map(([k, l]) => `<option value="${k}" ${k === selKey ? "selected" : ""}>${l}</option>`)
      .join("");
    return `<div class="super-kanban-card${blocked ? " blocked" : ""}${waiting ? " waiting-dep" : ""}" draggable="true" data-task-id="${t.id}">
      <div class="super-kanban-card-head">
        <input type="checkbox" class="kanban-select-cb" data-task-id="${t.id}" ${selectedTaskIds.has(t.id) ? "checked" : ""} title="Sélectionner cette tâche" aria-label="Sélectionner cette tâche">
        <div class="super-kanban-card-title">${title}</div>
      </div>
      ${blocked ? `<div class="super-kanban-card-blocker" title="${blocker}"><i data-lucide="alert-triangle" class="icon-sm"></i> Bloquée : ${blocker}</div>` : ""}
      ${waiting ? `<div class="super-kanban-card-dependency" title="${escapeAttr(depLabel)}"><i data-lucide="link-2" class="icon-sm"></i> ${escapeHtml(depLabel)}</div>` : ""}
      ${proj ? `<div class="super-kanban-card-proj"><i data-lucide="folder" class="icon-sm"></i> ${proj}</div>` : ""}
      ${desc ? `<div class="super-kanban-card-desc">${desc}</div>` : ""}
      <div class="super-kanban-card-tools">
        <select class="kanban-status-select" data-task-id="${t.id}" title="Déplacer la carte">${selOpts}</select>
        <button type="button" class="kanban-icon-btn kanban-edit-btn" data-task-id="${t.id}" title="Éditer la carte"><i data-lucide="pencil" class="icon-sm"></i></button>
        <button type="button" class="kanban-icon-btn kanban-del-btn" data-task-id="${t.id}" data-title="${escapeAttr(rawTitle)}" title="Supprimer la carte"><i data-lucide="trash-2" class="icon-sm"></i></button>
      </div>
    </div>`;
  }

  /** Carte d'IDÉE : lecture seule (aucun bouton de tâche), statut + priorité
   *  affichés. Les idées viennent de `idees_evolutions` et ne sont pas des tâches. */
  function ideaCardHtml(idea) {
    const title = escapeHtml(idea.title || "Idée sans titre");
    const proj = escapeHtml(formatCardProject(idea));
    const desc = escapeHtml((idea.description || "").slice(0, 120));
    const status = escapeHtml(String(idea.status || "").trim());
    const priority = escapeHtml(String(idea.priority || "").trim());
    const meta = [status, priority].filter(Boolean).join(" · ");
    return `<div class="super-kanban-card kanban-idea-card" data-idea-id="${idea.id}" title="Idée du suivi — se gère côté Assistant">
      <div class="super-kanban-card-head"><i data-lucide="lightbulb" class="icon-sm"></i><div class="super-kanban-card-title">${title}</div></div>
      ${proj ? `<div class="super-kanban-card-proj"><i data-lucide="folder" class="icon-sm"></i> ${proj}</div>` : ""}
      ${desc ? `<div class="super-kanban-card-desc">${desc}</div>` : ""}
      ${meta ? `<div class="kanban-idea-meta">${meta}</div>` : ""}
    </div>`;
  }

  /** Reconstruit l'onglet : sélecteur + barre de lot + bandeau de portée + grille
   *  unique (une colonne par statut, avec les idées en sous-groupe de « À faire »). */
  function renderKanban() {
    const tasks = visibleTasks();
    const columns = buildKanbanColumns(tasks, selectKanbanIdeas(kanbanIdeas, projectFilter));
    const activeProject =
      projectFilter === ALL_PROJECTS
        ? null
        : listKanbanProjects(kanbanClients, kanbanIdeas).find((p) => p.path === projectFilter);
    const scopeName = activeProject ? activeProject.name : "Tous les projets";
    const scopeIcon = activeProject ? "folder" : "layers";
    const cols = columns
      .map((col) => {
        const cards = (col.cards || []).map(taskCardHtml).join("");
        const ideaCards = (col.ideaCards || []).map(ideaCardHtml).join("");
        const ideasGroup = ideaCards
          ? `<div class="super-kanban-ideas">
              <div class="super-kanban-ideas-head"><i data-lucide="lightbulb" class="icon-sm"></i> ${IDEAS_GROUP_LABEL} <span class="super-kanban-col-count">${col.ideaCards.length}</span></div>
              ${ideaCards}
            </div>`
          : "";
        const empty = cards || ideasGroup ? "" : `<div class="super-kanban-empty">Aucune tâche</div>`;
        return `<div class="super-kanban-col tone-${col.tone}" data-col-key="${col.key}">
          <div class="super-kanban-col-head"><i data-lucide="${col.icon}" class="icon-sm"></i> ${col.label} <span class="super-kanban-col-count">${col.cards.length}</span></div>
          <div class="super-kanban-col-body">${cards}${ideasGroup}${empty}</div>
        </div>`;
      })
      .join("");
    const scope = `<div class="kanban-scope"><i data-lucide="${scopeIcon}" class="icon-sm"></i> ${escapeHtml(scopeName)} <span class="dash-muted">${tasks.length} tâche(s)</span></div>`;
    container.innerHTML = toolbarHtml() + bulkBarHtml() + scope + `<div class="super-kanban-board">${cols}</div>`;
    refreshIcons(container);
    syncBulkUi();
  }

  /**
   * Clôture le lot sélectionné après confirmation explicite. Une confirmation
   * refusée (annulée) n'écrit RIEN. Chaque tâche passe par la MÊME route que la
   * clôture unitaire (`super_agent_update_task_status`), une fois par tâche —
   * aucune suppression, aucune commande nouvelle.
   */
  async function confirmAndCloseSelection() {
    const n = selectionCount(selectedTaskIds);
    if (n === 0) return;
    const confirmed = await openKanbanConfirm({
      title: "Clôturer la sélection",
      message: bulkCloseConfirmMessage(n),
      confirmLabel: `Clôturer ${n} tâche${n > 1 ? "s" : ""}`,
    });
    // On ne clôture que les tâches VISIBLES (une tâche masquée par le filtre de
    // projet ne doit jamais être modifiée à l'insu de l'utilisateur).
    const decision = planBulkClose(visibleTasks(), selectedTaskIds, confirmed);
    if (!decision.applied) return; // confirmation refusée → rien ne change
    const applied = [];
    for (const c of decision.changes) {
      try {
        await invoke("super_agent_update_task_status", { taskId: c.id, status: c.to });
        applied.push(c);
      } catch (err) {
        console.error("Erreur clôture en lot:", err);
      }
    }
    lastBulkClose = applied.length ? { changes: applied } : null;
    selectedTaskIds = new Set();
    loadSuperKanban();
  }

  /** Rétablit le statut précédent des tâches du dernier lot clôturé (réversible). */
  async function undoBulkClose() {
    const plan = buildBulkUndoPlan(lastBulkClose && lastBulkClose.changes);
    for (const c of plan) {
      try {
        await invoke("super_agent_update_task_status", { taskId: c.id, status: c.status });
      } catch (err) {
        console.error("Erreur annulation clôture:", err);
      }
    }
    lastBulkClose = null;
    loadSuperKanban();
  }

  /**
   * Boîte de confirmation minimale (même habillage que les modales existantes).
   * Résout `true` si l'utilisateur confirme, `false` sinon (fermeture, Échap ou
   * « Annuler »).
   */
  function openKanbanConfirm({ title, message, confirmLabel }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal";
      overlay.innerHTML = `<div class="modal-content kanban-modal-content">
        <h2><i data-lucide="check-circle-2" class="icon-lg"></i> ${title}</h2>
        <p class="kanban-confirm-msg">${message}</p>
        <div class="modal-actions">
          <button type="button" class="btn kanban-cancel-btn">Annuler</button>
          <button type="button" class="btn kanban-confirm-ok">${confirmLabel}</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const done = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) done(false);
      });
      overlay.querySelector(".kanban-cancel-btn").addEventListener("click", () => done(false));
      overlay.querySelector(".kanban-confirm-ok").addEventListener("click", () => done(true));
      refreshIcons(overlay);
    });
  }
  const clearDragOver = () =>
    container.querySelectorAll(".super-kanban-col.drag-over").forEach((c) => c.classList.remove("drag-over"));

  // Chargement de la vue Kanban multi-projets (get_super_agent_kanban). La
  // réponse contient les tâches groupées par client ET les idées ; le filtre de
  // projet puis le rendu en colonnes sont délégués à la logique pure
  // super-agent-kanban.js — ici on ne fait que produire l'HTML.
  async function loadSuperKanban() {
    container.innerHTML = `<div class="dash-loading">Chargement du Kanban…</div>`;
    try {
      const data = await invoke("get_super_agent_kanban");
      kanbanClients = (data && data.clients) || [];
      kanbanIdeas = (data && data.ideas) || [];
      kanbanTasksById.clear();
      for (const client of kanbanClients) {
        for (const t of (client.tasks || [])) {
          if (t && t.id != null) kanbanTasksById.set(t.id, t);
        }
      }
      // Un projet mémorisé qui n'existe plus (ou une base sans idées) retombe sur
      // « Tous les projets » : le sélecteur ne doit jamais être dans le vide.
      const known = listKanbanProjects(kanbanClients, kanbanIdeas);
      if (projectFilter !== ALL_PROJECTS && !known.some((p) => p.path === projectFilter)) {
        projectFilter = ALL_PROJECTS;
        saveKanbanProjectFilter(projectFilter);
      }
      const hasContent = known.length > 0 || kanbanIdeas.length > 0;
      if (!hasContent) {
        container.innerHTML =
          `<div class="dash-muted">Aucune tâche pour l'instant. Utilisez « Initialiser » ou « Projets & clients » dans l'onglet Assistant pour démarrer le suivi.</div>`;
        return;
      }
      renderKanban();
    } catch (err) {
      console.error("Erreur get_super_agent_kanban:", err);
      container.innerHTML =
        `<div class="dash-error">Erreur de chargement du Kanban : ${escapeHtml(String(err))}</div>`;
    }
  }

  // ── Pilotage CRUD de la vue Kanban (création/édition/déplacement/suppression) ──
  // Les écritures vont UNIQUEMENT dans la base de suivi de l'Assistant
  // (~/.pilot/super-agent.db), jamais sur les fichiers projets.

  // Déplace une carte vers une colonne (statut canonique via columnToStatus).
  async function moveKanbanTask(taskId, status) {
    try {
      await invoke("super_agent_update_task_status", { taskId, status });
      loadSuperKanban();
    } catch (err) {
      console.error("Erreur déplacement carte:", err);
    }
  }

  // Supprime une carte (bouton en deux temps : 1er clic « arme », 2e clic confirme).
  async function deleteKanbanTask(taskId, title) {
    try {
      await invoke("super_agent_delete_task", { taskId });
      loadSuperKanban();
    } catch (err) {
      console.error("Erreur suppression carte:", err);
    }
    void title;
  }

  // Modale de création ou d'édition d'une carte. Les champs (titre, description,
  // projet, échéance, statut) alimentent create_task / update_task. Une échéance
  // laissée vide est effacée (chaîne vide passée à update_task).
  async function openKanbanModal({ mode, task }) {
    const isEdit = mode === "edit";
    let projects = [];
    try {
      const data = await invoke("list_super_agent_projects");
      projects = (data && data.projects) || [];
    } catch (err) {
      console.error("Erreur liste projets:", err);
    }
    // En création, on pré-remplit avec le projet affiché par le sélecteur (à
    // défaut, le premier projet connu).
    const curProj = task
      ? (task.project_path || "")
      : (projectFilter !== ALL_PROJECTS ? projectFilter : "");
    const projectOptions = projects.length
      ? projects
          .map((p) =>
            `<option value="${escapeAttr(p.path || "")}" ${String(p.path || "") === curProj ? "selected" : ""}>${escapeHtml(p.name || p.path || "")}</option>`
          )
          .join("")
      : `<option value="">— aucun projet connu —</option>`;
    const statusOptions = STATUS_OPTIONS
      .map(([k, l]) =>
        `<option value="${k}" ${k === normalizeTaskStatus(task ? task.status : "") ? "selected" : ""}>${l}</option>`
      )
      .join("");
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.innerHTML = `<div class="modal-content kanban-modal-content">
      <h2><i data-lucide="${isEdit ? "pencil" : "plus"}" class="icon-lg"></i> ${isEdit ? "Éditer la carte" : "Nouvelle carte"}</h2>
      <form class="kanban-task-form">
        <label class="kanban-field">Titre <span class="dash-muted">*</span>
          <input type="text" name="title" required value="${escapeAttr(task ? task.title : "")}">
        </label>
        <label class="kanban-field">Description
          <textarea name="description" rows="3">${escapeHtml(task ? task.description || "" : "")}</textarea>
        </label>
        <label class="kanban-field">Projet
          <select name="project">${projectOptions}</select>
        </label>
        <label class="kanban-field">Échéance
          <input type="date" name="deadline" value="${escapeAttr(task ? task.deadline || "" : "")}">
        </label>
        ${isEdit ? `<label class="kanban-field">Statut
          <select name="status">${statusOptions}</select>
        </label>` : ""}
        <div class="modal-actions">
          <button type="button" class="btn kanban-cancel-btn">Annuler</button>
          <button type="submit" class="btn kanban-save-btn">${isEdit ? "Enregistrer" : "Créer"}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".kanban-cancel-btn").addEventListener("click", close);
    overlay.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const title = (f.title.value || "").trim();
      if (!title) return;
      const description = (f.description.value || "").trim();
      const deadline = f.deadline.value || ""; // "" efface l'échéance
      try {
        if (isEdit) {
          await invoke("super_agent_update_task", {
            taskId: task.id,
            title,
            description,
            projectPath: f.project.value || null,
            status: columnToStatus(f.status.value),
            deadline,
          });
        } else {
          const projectPath = f.project.value || (projects[0] && projects[0].path) || "";
          if (!projectPath) {
            f.title.setCustomValidity("Aucun projet connu : créez un projet suivi avant d'ajouter une carte.");
            f.title.reportValidity();
            return;
          }
          await invoke("super_agent_create_task", {
            projectPath,
            title,
            description,
            deadline,
            // Pas de dependance posee depuis ce formulaire : la valeur explicite
            // evite toute ambiguite de deserialisation cote Tauri.
            dependsOnTaskId: null,
          });
        }
        close();
        loadSuperKanban();
      } catch (err) {
        console.error("Erreur création/édition carte:", err);
      }
    });
    refreshIcons(overlay);
    const first = overlay.querySelector("input[name=title]");
    if (first) first.focus();
  }

  // ── Listeners délégués du Kanban (résistants aux re-rendus : attachés une
  // seule fois au conteneur, dont seul le contenu est remplacé à chaque load).
  container.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".super-kanban-card");
    if (!card) return;
    dragTaskId = card.dataset.taskId;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragTaskId)); } catch (_err) { /* non supporté */ }
  });
  container.addEventListener("dragover", (e) => {
    const col = e.target.closest(".super-kanban-col");
    if (col && dragTaskId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDragOver();
      col.classList.add("drag-over");
    }
  });
  container.addEventListener("dragleave", (e) => {
    const col = e.target.closest(".super-kanban-col");
    if (col) col.classList.remove("drag-over");
  });
  container.addEventListener("drop", (e) => {
    const col = e.target.closest(".super-kanban-col");
    clearDragOver();
    if (!col || !dragTaskId) return;
    e.preventDefault();
    moveKanbanTask(Number(dragTaskId), columnToStatus(col.dataset.colKey));
    dragTaskId = null;
  });
  container.addEventListener("dragend", () => {
    dragTaskId = null;
    clearDragOver();
  });
  container.addEventListener("change", (e) => {
    // Sélecteur de projet : ne réinterroge pas le backend, re-rend le tableau à
    // partir de la dernière réponse et mémorise le choix.
    const psel = e.target.closest(".kanban-project-select");
    if (psel) {
      projectFilter = psel.value || ALL_PROJECTS;
      saveKanbanProjectFilter(projectFilter);
      selectedTaskIds = new Set(); // évite de clôturer une tâche masquée
      renderKanban();
      return;
    }
    const cb = e.target.closest(".kanban-select-cb");
    if (cb) {
      selectedTaskIds = toggleSelection(selectedTaskIds, Number(cb.dataset.taskId), cb.checked);
      syncBulkUi();
      return;
    }
    const sel = e.target.closest(".kanban-status-select");
    if (!sel) return;
    moveKanbanTask(Number(sel.dataset.taskId), columnToStatus(sel.value));
    sel.value = ""; // reset pour permettre une re-sélection identique plus tard
  });
  container.addEventListener("click", (e) => {
    const newBtn = e.target.closest(".kanban-new-btn");
    if (newBtn) { openKanbanModal({ mode: "create" }); return; }
    const clearSelBtn = e.target.closest(".kanban-bulk-clear-btn");
    if (clearSelBtn) {
      selectedTaskIds = new Set();
      container.querySelectorAll(".kanban-select-cb").forEach((cb) => { cb.checked = false; });
      syncBulkUi();
      return;
    }
    const closeSelBtn = e.target.closest(".kanban-bulk-close-btn");
    if (closeSelBtn) { confirmAndCloseSelection(); return; }
    const undoBtn = e.target.closest(".kanban-bulk-undo-btn");
    if (undoBtn) { undoBulkClose(); return; }
    const delBtn = e.target.closest(".kanban-del-btn");
    if (delBtn) {
      if (delBtn.dataset.armed === "1") {
        deleteKanbanTask(Number(delBtn.dataset.taskId), delBtn.dataset.title || "");
        return;
      }
      delBtn.dataset.armed = "1";
      delBtn.classList.add("armed");
      const orig = delBtn.innerHTML;
      delBtn.innerHTML = "Confirmer ?";
      window.setTimeout(() => {
        if (delBtn.isConnected) {
          delete delBtn.dataset.armed;
          delBtn.classList.remove("armed");
          delBtn.innerHTML = orig;
        }
      }, 2500);
      return;
    }
    const editBtn = e.target.closest(".kanban-edit-btn");
    if (editBtn) {
      const task = kanbanTasksById.get(Number(editBtn.dataset.taskId));
      openKanbanModal({ mode: "edit", task: task || null });
      return;
    }
  });

  // Premier chargement automatique à l'ouverture de l'onglet.
  loadSuperKanban();

  return {
    wrapper: container,
    // Exposé pour resynchronisation (ex: rouvrir/recharger la vue à la demande).
    refresh: () => loadSuperKanban(),
    unlisten: () => {
      // Les listeners sont délégués sur le conteneur (détruit avec l'onglet).
      dragTaskId = null;
      kanbanTasksById.clear();
    },
  };
}
