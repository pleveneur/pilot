// super-agent-kanban-view.js — Vue Kanban multi-projets en onglet DÉDIÉ.
//
// L'onglet 🧭 Assistant ouvrait sa vue Kanban dans le panneau inférieur (bascule
// liste ↔ Kanban via le bouton « Vues »). Depuis cette évolution, le bouton
// « Vues » ouvre la vue Kanban dans un ONGLET DÉDIÉ de Pilot (pattern des onglets
// Review / Historique / Dashboard / Coffre), enregistré sous le mode
// `superagent-kanban` dans tabs.js.
//
// La logique PURE (structuration par client/colonnes, normalisation des statuts)
// reste dans super-agent-kanban.js (buildKanbanByClient, normalizeTaskStatus,
// columnToStatus) — INCHANGÉE et réutilisée telle quelle. Les commandes Rust sont
// réutilisées à l'identique. Les écritures vont UNIQUEMENT dans la base de suivi
// de l'Assistant (~/.pilot/super-agent.db), jamais sur les fichiers projets.
//
// Module autonome exportant createSuperKanban(container) → { wrapper, refresh,
// unlisten }, sur le pattern des onglets outils existants.

import { invoke } from "@tauri-apps/api/core";
import { refreshIcons } from "./icons.js";
import { buildKanbanByClient, normalizeTaskStatus, columnToStatus } from "./super-agent-kanban.js";

/** Échappe le HTML (copie locale — non exportée depuis super-agent.js). */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Échappe une valeur pour un attribut HTML (guillemets inclus). */
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

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
  // Id de la carte glissée (résistant aux re-rendus : géré au niveau du conteneur).
  let dragTaskId = null;
  const clearDragOver = () =>
    container.querySelectorAll(".super-kanban-col.drag-over").forEach((c) => c.classList.remove("drag-over"));

  // Rendu de la vue Kanban multi-projets (get_super_agent_kanban). Chaque
  // client est affiché avec ses 4 colonnes (À faire / En cours / À valider /
  // Terminé) et ses cartes de tâches. La structuration par colonne/client est
  // déléguée à la logique pure super-agent-kanban.js (buildKanbanByClient) ;
  // ici on ne fait que produire l'HTML.
  async function loadSuperKanban() {
    container.innerHTML = `<div class="dash-loading">Chargement du Kanban…</div>`;
    try {
      const data = await invoke("get_super_agent_kanban");
      const clients = (data && data.clients) || [];
      if (!clients.length) {
        container.innerHTML =
          `<div class="dash-muted">Aucune tâche pour l'instant. Utilisez « Initialiser » ou « Projets & clients » dans l'onglet Assistant pour démarrer le suivi.</div>`;
        return;
      }
      kanbanTasksById.clear();
      for (const client of (data.clients || [])) {
        for (const t of (client.tasks || [])) {
          if (t && t.id != null) kanbanTasksById.set(t.id, t);
        }
      }
      const byClient = buildKanbanByClient(clients);
      let html = "";
      for (const client of byClient) {
        const cols = (client.columns || [])
          .map((col) => {
            const cards = (col.cards || [])
              .map((t) => {
                const rawTitle = t.title || "Sans titre";
                const title = escapeHtml(rawTitle);
                const proj = escapeHtml(t.project_name || "");
                const desc = escapeHtml((t.description || "").slice(0, 120));
                const selKey = normalizeTaskStatus(t.status);
                const selOpts = [
                  ["todo", "À faire"],
                  ["progress", "En cours"],
                  ["review", "À valider"],
                  ["done", "Terminé"],
                  ["cancelled", "Annulée"],
                ]
                  .map(([k, l]) => `<option value="${k}" ${k === selKey ? "selected" : ""}>${l}</option>`)
                  .join("");
                return `<div class="super-kanban-card" draggable="true" data-task-id="${t.id}">
                  <div class="super-kanban-card-title">${title}</div>
                  ${proj ? `<div class="super-kanban-card-proj"><i data-lucide="folder" class="icon-sm"></i> ${proj}</div>` : ""}
                  ${desc ? `<div class="super-kanban-card-desc">${desc}</div>` : ""}
                  <div class="super-kanban-card-tools">
                    <select class="kanban-status-select" data-task-id="${t.id}" title="Déplacer la carte">${selOpts}</select>
                    <button type="button" class="kanban-icon-btn kanban-edit-btn" data-task-id="${t.id}" title="Éditer la carte"><i data-lucide="pencil" class="icon-sm"></i></button>
                    <button type="button" class="kanban-icon-btn kanban-del-btn" data-task-id="${t.id}" data-title="${escapeAttr(rawTitle)}" title="Supprimer la carte"><i data-lucide="trash-2" class="icon-sm"></i></button>
                  </div>
                </div>`;
              })
              .join("");
            const empty = cards
              ? ""
              : `<div class="super-kanban-empty">Aucune tâche</div>`;
            return `<div class="super-kanban-col tone-${col.tone}" data-col-key="${col.key}">
              <div class="super-kanban-col-head"><i data-lucide="${col.icon}" class="icon-sm"></i> ${col.label} <span class="super-kanban-col-count">${col.cards.length}</span></div>
              <div class="super-kanban-col-body">${cards}${empty}</div>
            </div>`;
          })
          .join("");
        const total = (client.columns || []).reduce((n, c) => n + (c.cards || []).length, 0);
        html += `<div class="super-kanban-client">
          <div class="super-kanban-client-head"><i data-lucide="building-2" class="icon-sm"></i> ${escapeHtml(client.name)} <span class="dash-muted">${total} tâche(s)</span>
            <button type="button" class="kanban-new-btn" title="Créer une nouvelle carte"><i data-lucide="plus" class="icon-sm"></i> Nouvelle carte</button>
          </div>
          <div class="super-kanban-board">${cols}</div>
        </div>`;
      }
      container.innerHTML = html;
      refreshIcons(container);
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
    const curProj = task ? (task.project_path || "") : "";
    const projectOptions = projects.length
      ? projects
          .map((p) =>
            `<option value="${escapeAttr(p.path || "")}" ${String(p.path || "") === curProj ? "selected" : ""}>${escapeHtml(p.name || p.path || "")}</option>`
          )
          .join("")
      : `<option value="">— aucun projet connu —</option>`;
    const statusOptions = [
      ["todo", "À faire"],
      ["progress", "En cours"],
      ["review", "À valider"],
      ["done", "Terminé"],
      ["cancelled", "Annulée"],
    ]
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
          await invoke("super_agent_create_task", { projectPath, title, description, deadline });
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
    const sel = e.target.closest(".kanban-status-select");
    if (!sel) return;
    moveKanbanTask(Number(sel.dataset.taskId), columnToStatus(sel.value));
    sel.value = ""; // reset pour permettre une re-sélection identique plus tard
  });
  container.addEventListener("click", (e) => {
    const newBtn = e.target.closest(".kanban-new-btn");
    if (newBtn) { openKanbanModal({ mode: "create" }); return; }
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
