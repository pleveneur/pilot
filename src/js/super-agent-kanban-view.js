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
  formatCardProject, isBlockedTask, isWaitingDependency, dependencyLabel,
  checklistCounterLabel, parseChecklistGate,
  DEFAULT_CHECKLIST_TEMPLATE, normalizeChecklistMode, normalizeChecklistTemplate,
  parseChecklistTemplate, shouldOfferTemplatePoints,
  TASK_DELIVERABLE_LIST_COMMAND, buildDeliverableBlock, deliverableErrorMessage,
  DELIVERABLE_EMPTY_TEXT,
  TASK_TIME_GET_COMMAND, TASK_TIME_SET_ESTIMATED_COMMAND, TASK_TIME_ADD_SPENT_COMMAND,
  taskTimePillLabel, taskTimeSummaryLabel, taskTimeState, taskTimeErrorMessage,
  parseEstimatedMinutesInput, parseSpentMinutesInput } from "./super-agent-kanban.js";

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
  // Idée 3 (Lot A), tranche 3.4 : dernière checklist RELUE EN BASE par tâche
  // (id → points). Alimente le compteur des cartes et la fiche de tâche ;
  // aucune valeur n'est devinée côté écran. Un chargement plus récent annule
  // le précédent (`checkFetchToken`).
  let checkCounts = new Map();
  let checkFetchToken = 0;
  // Idée 3 (Lot A), tranche 3.5 : réglages de la checklist (mode de contrôle +
  // modèle de points), relus en configuration à CHAQUE ouverture de fiche. Ils
  // ne servent qu'à PROPOSER les points du modèle sur une tâche sans point :
  // rien n'est jamais créé automatiquement. `null` = pas encore lu.
  let checklistCfg = null;
  // Idée 2 (Lot A), tranche 3 : derniers temps RELUS EN BASE par tâche
  // (id → charge utile de `super_agent_task_time_get`). Alimente la pastille
  // « prévu / passé » des cartes ; aucune valeur n'est devinée côté écran.
  // Un chargement plus récent annule le précédent (`timeFetchToken`).
  let taskTimes = new Map();
  let timeFetchToken = 0;
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
    // Idée 3 (Lot A), tranche 3.4 : compteur discret de la checklist (« 2/3 »),
    // affiché SEULEMENT si la tâche porte au moins un point (relu en base).
    const checkLabel = checklistCounterLabel(checkCounts.get(t.id));
    // Idée 2 (Lot A), tranche 3 : pastille de temps « 45 min prévues / 70 min
    // passées », affichée SEULEMENT si au moins un des deux temps est renseigné
    // (relu en base). Une tâche sans temps garde exactement son apparence.
    const timeLabel = taskTimePillLabel(taskTimes.get(t.id));
    return `<div class="super-kanban-card${blocked ? " blocked" : ""}${waiting ? " waiting-dep" : ""}" draggable="true" data-task-id="${t.id}">
      <div class="super-kanban-card-head">
        <input type="checkbox" class="kanban-select-cb" data-task-id="${t.id}" ${selectedTaskIds.has(t.id) ? "checked" : ""} title="Sélectionner cette tâche" aria-label="Sélectionner cette tâche">
        <div class="super-kanban-card-title">${title}</div>
        ${checkLabel ? `<span class="kanban-check-counter" title="${checkLabel} : points de checklist cochés">${checkLabel}</span>` : ""}
        ${timeLabel ? `<span class="kanban-time-pill dash-muted" title="${escapeAttr(timeLabel)}">${escapeHtml(timeLabel)}</span>` : ""}
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
    // Les compteurs de checklist déjà relus en base restent affichés tels quels
    // après un re-rendu (changement de filtre) sans nouvel appel au backend.
    applyCheckCounters();
    // Idem pour les pastilles de temps déjà relues : un re-rendu ne doit ni les
    // perdre ni déclencher une nouvelle lecture en base.
    applyTimePills();
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
    // Idée 3 (Lot A), tranche 3.4 : en mode « rappel », le cœur réclame une
    // confirmation pour les tâches dont la checklist n'est pas finie. On collecte
    // ces tâches (et les refus secs du mode bloquant) au lieu d'interrompre le
    // lot, puis on demande UNE fois avant de relancer ces clôtures avec `force`.
    const needsForce = [];
    const refused = [];
    for (const c of decision.changes) {
      try {
        await invoke("super_agent_update_task_status", { taskId: c.id, status: c.to });
        applied.push(c);
      } catch (err) {
        const verdict = parseChecklistGate(err);
        if (verdict.needsConfirmation) needsForce.push({ change: c, message: verdict.message });
        else if (verdict.refused) refused.push(verdict.message);
        else console.error("Erreur clôture en lot:", err);
      }
    }
    if (needsForce.length) {
      const nf = needsForce.length;
      const ok = await openKanbanConfirm({
        title: "Checklist incomplète",
        message: escapeHtml(needsForce.map((x) => x.message).join(" ")),
        confirmLabel: `Clôturer ${nf} tâche${nf > 1 ? "s" : ""}`,
      });
      if (ok) {
        for (const { change } of needsForce) {
          try {
            await invoke("super_agent_update_task_status", {
              taskId: change.id,
              status: change.to,
              force: true,
            });
            applied.push(change);
          } catch (err) {
            console.error("Erreur clôture en lot (forcée) :", err);
          }
        }
      }
    }
    // Mode bloquant : le refus du cœur est montré tel quel, sans relance.
    if (refused.length) await showKanbanNotice("Clôture refusée", refused.join(" "));
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

  /**
   * Avis minimal non bloquant-ambigu (même habillage que les modales Kanban) :
   * sert à montrer tel quel le refus rendu par le cœur. Résolue à la fermeture.
   */
  function showKanbanNotice(title, message) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal";
      overlay.innerHTML = `<div class="modal-content kanban-modal-content">
        <h2><i data-lucide="alert-triangle" class="icon-lg"></i> ${escapeHtml(title)}</h2>
        <p class="kanban-confirm-msg">${escapeHtml(String(message))}</p>
        <div class="modal-actions">
          <button type="button" class="btn kanban-notice-ok">Fermer</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const done = () => {
        overlay.remove();
        resolve();
      };
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) done();
      });
      overlay.querySelector(".kanban-notice-ok").addEventListener("click", done);
      refreshIcons(overlay);
    });
  }

  // ── Idée 3 (Lot A), tranche 3.4 : contrôle de checklist à la clôture ───────
  // Le MODE (désactivé / rappel / bloquant) est décidé côté Rust : l'interface
  // ne fait que LIRE le verdict (`parseChecklistGate`) et n'applique donc aucune
  // règle propre. En mode « rappel » le cœur autorise la clôture si elle est
  // relancée AVEC `force: true` → une confirmation explicite, puis UNE seule
  // relance. En mode bloquant le refus est affiché tel quel, SANS relance.

  /**
   * Traite l'échec d'une écriture qui fait passer une tâche en « Terminé » :
   * demande confirmation puis relance UNE fois avec `force` si le cœur réclame
   * une confirmation (mode « rappel ») ; affiche le refus tel quel sinon.
   * @param {unknown} err erreur renvoyée par `invoke`
   * @param {Function} retryWithForce relance de la même écriture, forçée
   * @returns {Promise<boolean>} vrai si l'écriture a fini par aboutir
   */
  async function handleChecklistGate(err, retryWithForce) {
    const verdict = parseChecklistGate(err);
    if (verdict.needsConfirmation) {
      const ok = await openKanbanConfirm({
        title: "Checklist incomplète",
        message: escapeHtml(verdict.message),
        confirmLabel: "Terminer quand même",
      });
      if (!ok) return false; // refus de forcer → rien n'est écrit
      try {
        await retryWithForce();
        return true;
      } catch (err2) {
        await showKanbanNotice("Checklist incomplète", String(err2));
        return false;
      }
    }
    if (verdict.refused) {
      // Mode bloquant : le message du cœur est montré tel quel, sans relance.
      await showKanbanNotice("Clôture refusée", verdict.message);
      return false;
    }
    console.error("Erreur changement de statut de tâche :", err);
    return false;
  }

  /**
   * Change le STATUT d'une tâche en respectant le contrôle de checklist du cœur.
   * @returns {Promise<boolean>} vrai si le statut a bien été écrit
   */
  function updateTaskStatusWithGate(taskId, status) {
    return invoke("super_agent_update_task_status", { taskId, status }).then(
      () => true,
      (err) =>
        handleChecklistGate(err, () =>
          invoke("super_agent_update_task_status", { taskId, status, force: true })
        )
    );
  }

  /**
   * Écrit la fiche (titre/description/projet/échéance/statut) via
   * `super_agent_update_task`, en respectant le même contrôle de checklist quand
   * le statut visé est « Terminé ».
   * @returns {Promise<boolean>} vrai si la fiche a bien été enregistrée
   */
  function updateTaskWithGate(params) {
    return invoke("super_agent_update_task", params).then(
      () => true,
      (err) => handleChecklistGate(err, () => invoke("super_agent_update_task", { ...params, force: true }))
    );
  }

  /**
   * Compteurs de checklist des cartes : lecture EN BASE des tâches affichées
   * (aucun état deviné). Séquentielle et fail-open — une lecture impossible
   * laisse simplement la carte sans compteur. Un chargement plus récent annule
   * le précédent (jeton).
   */
  async function refreshCheckCounts() {
    const token = ++checkFetchToken;
    for (const t of visibleTasks()) {
      if (!t || t.id == null) continue;
      try {
        const res = await invoke("super_agent_task_check_list", { taskId: t.id });
        if (token !== checkFetchToken) return; // un chargement plus récent a pris la main
        checkCounts.set(t.id, (res && res.checks) || []);
      } catch (_err) {
        /* checklist illisible : pas de compteur inventé */
      }
    }
    applyCheckCounters();
  }

  /**
   * Met à jour le compteur des cartes DÉJÀ rendues (sans re-rendre le tableau :
   * défilement, sélection et glisser-déposer restent intacts).
   */
  function applyCheckCounters() {
    container.querySelectorAll(".super-kanban-card[data-task-id]").forEach((card) => {
      const id = Number(card.dataset.taskId);
      const label = checklistCounterLabel(checkCounts.get(id));
      let el = card.querySelector(".kanban-check-counter");
      if (!label) {
        if (el) el.remove(); // tâche sans point : aucune pastille (inchangé)
        return;
      }
      if (!el) {
        el = document.createElement("span");
        el.className = "kanban-check-counter";
        const head = card.querySelector(".super-kanban-card-head");
        (head || card).appendChild(el);
      }
      el.textContent = label;
      el.title = `${label} : points de checklist cochés`;
    });
  }

  /**
   * Temps des cartes : lecture EN BASE des tâches affichées (aucun état deviné).
   * Séquentielle et fail-open — une lecture impossible laisse simplement la
   * carte SANS pastille (jamais une valeur inventée). Un chargement plus récent
   * annule le précédent (jeton).
   */
  async function refreshTaskTimes() {
    const token = ++timeFetchToken;
    for (const t of visibleTasks()) {
      if (!t || t.id == null) continue;
      try {
        const res = await invoke(TASK_TIME_GET_COMMAND, { taskId: t.id });
        if (token !== timeFetchToken) return; // un chargement plus récent a pris la main
        taskTimes.set(t.id, res || {});
      } catch (_err) {
        /* temps illisible : aucune pastille inventée */
      }
    }
    applyTimePills();
  }

  /**
   * Met à jour la pastille de temps des cartes DÉJÀ rendues (sans re-rendre le
   * tableau : défilement, sélection et glisser-déposer restent intacts). Une
   * carte dont les deux temps sont non renseignés ne reçoit AUCUNE pastille.
   */
  function applyTimePills() {
    container.querySelectorAll(".super-kanban-card[data-task-id]").forEach((card) => {
      const id = Number(card.dataset.taskId);
      const label = taskTimePillLabel(taskTimes.get(id));
      let el = card.querySelector(".kanban-time-pill");
      if (!label) {
        if (el) el.remove(); // aucun temps renseigné : aucune pastille (inchangé)
        return;
      }
      if (!el) {
        el = document.createElement("span");
        el.className = "kanban-time-pill dash-muted";
        const head = card.querySelector(".super-kanban-card-head");
        (head || card).appendChild(el);
      }
      el.textContent = label;
      el.title = label;
    });
  }

  /**
   * Lit les DEUX réglages de checklist en configuration (mode + modèle), une
   * fois par fiche ouverte. Lecture seule, fail-open : une configuration
   * illisible retombe sur les défauts sûrs (mode « rappel », modèle par défaut)
   * — jamais sur une erreur bloquante pour l'utilisateur.
   */
  async function loadChecklistConfig() {
    if (checklistCfg) return checklistCfg;
    try {
      const cfg = await invoke("get_config");
      checklistCfg = {
        mode: normalizeChecklistMode(cfg && cfg.super_agent_checklist_mode),
        template: normalizeChecklistTemplate(cfg && cfg.super_agent_checklist_template),
      };
    } catch (_err) {
      checklistCfg = { mode: "warn", template: DEFAULT_CHECKLIST_TEMPLATE };
    }
    return checklistCfg;
  }

  /**
   * Ajoute, sur une tâche SANS point, un bouton « Ajouter les points du modèle »
   * — seulement si le contrôle n'est pas désactivé et que le modèle contient au
   * moins un point. Rien n'est créé tant que l'utilisateur n'a pas cliqué, et
   * aucune tâche ayant déjà des points n'est touchée.
   */
  async function offerTemplatePoints(list) {
    if (list.querySelector(".kanban-checklist-template-btn")) return;
    const cfg = await loadChecklistConfig();
    if (!shouldOfferTemplatePoints([], cfg.mode)) return;
    const points = parseChecklistTemplate(cfg.template);
    if (!points.length) return;
    // Un rendu plus récent (ou un point déjà ajouté) a pu changer l'état.
    if (!list.isConnected || !list.querySelector(".kanban-checklist-empty")) return;
    const wrap = document.createElement("div");
    wrap.className = "kanban-checklist-suggest";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn kanban-checklist-template-btn";
    btn.textContent = "Ajouter les points du modèle";
    btn.title = `Créer ${points.length} point(s) de checklist : ${points.join(" | ")}`;
    const hint = document.createElement("span");
    hint.className = "dash-muted";
    hint.textContent = points.join(" · ");
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    list.appendChild(wrap);
  }

  /**
   * Relit la checklist d'une tâche EN BASE et redessine le bloc de la fiche
   * (aucun état deviné côté écran). Le résultat alimente aussi le compteur de la
   * carte correspondante. Appelée après CHAQUE opération.
   */
  async function renderChecklist(block, taskId) {
    const list = block.querySelector(".kanban-checklist-list");
    const count = block.querySelector(".kanban-checklist-count");
    let checks = [];
    try {
      const res = await invoke("super_agent_task_check_list", { taskId });
      checks = (res && res.checks) || [];
    } catch (err) {
      list.innerHTML = `<div class="dash-error">Checklist indisponible : ${escapeHtml(String(err))}</div>`;
      return;
    }
    checkCounts.set(taskId, checks);
    const label = checklistCounterLabel(checks);
    if (count) count.textContent = label ? `${label} point(s) cochés` : "aucun point";
    list.innerHTML = checks.length
      ? checks
          .map(
            (c) => `<div class="kanban-check-row${c.done ? " done" : ""}">
            <label class="kanban-check-label"><input type="checkbox" class="kanban-check-toggle" data-check-id="${c.id}" ${c.done ? "checked" : ""}> <span>${escapeHtml(c.label)}</span></label>
            <button type="button" class="kanban-icon-btn kanban-check-del" data-check-id="${c.id}" title="Supprimer ce point"><i data-lucide="x" class="icon-sm"></i></button>
          </div>`
          )
          .join("")
      : `<div class="dash-muted kanban-checklist-empty">Aucun point : aucune vérification n'est requise avant de terminer cette tâche.</div>`;
    refreshIcons(list);
    applyCheckCounters();
    // Tâche sans point : proposer (sans rien imposer) les points du modèle.
    if (!checks.length) await offerTemplatePoints(list);
  }

  /**
   * Idée 2 (Lot A), tranche 3 : relit le TEMPS d'une tâche EN BASE et redessine
   * le résumé du bloc « Temps » de la fiche (aucun état deviné côté écran). Le
   * résultat alimente aussi la pastille de la carte correspondante. Appelée à
   * l'ouverture de la fiche ET après CHAQUE opération réussie. La présence d'un
   * temps est lue sur `estimated_set` / `spent_set` — jamais sur la valeur, car
   * `0` est faux en JavaScript : « rien prévu » (0) reste distinct de « non
   * renseigné » (null). Un échec de lecture affiche une ligne claire et ne
   * remonte JAMAIS d'exception : le reste de la fiche continue de fonctionner.
   */
  async function renderTaskTime(block, taskId) {
    if (!block) return;
    const summary = block.querySelector(".kanban-time-summary");
    const estInput = block.querySelector(".kanban-time-estimated-input");
    const errEl = block.querySelector(".kanban-time-error");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    try {
      const res = await invoke(TASK_TIME_GET_COMMAND, { taskId });
      taskTimes.set(taskId, res || {});
      const state = taskTimeState(res);
      if (summary) summary.textContent = taskTimeSummaryLabel(res);
      // Le prévu est PRÉREMPLI avec la valeur relue (vide = non renseigné) ; le
      // passé reste un CUMUL à ajouter, donc son champ n'est jamais prérempli.
      if (estInput) estInput.value = state.estimatedSet ? String(state.estimatedMinutes) : "";
      applyTimePills();
    } catch (err) {
      // Lecture impossible : une ligne d'information suffit, rien n'est inventé
      // et la pastille de la carte garde la dernière valeur relue en base.
      if (summary) summary.textContent = "";
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = taskTimeErrorMessage(err);
      }
    }
  }

  /**
   * Idée 4 (Lot A), tranche 4.4 : relit les lignes de traçabilité de la tâche
   * EN BASE et redessine le bloc « Livrable » de la fiche (aucun état deviné côté
   * écran). Bloc en LECTURE SEULE : l'écriture d'une ligne est automatique côté
   * cœur (tranche 4.2), aucun bouton n'écrit ici. Un échec de lecture affiche une
   * ligne d'information claire et ne remonte JAMAIS d'exception : le reste de la
   * fiche continue de fonctionner.
   */
  async function renderDeliverables(block, taskId) {
    if (!block) return;
    const list = block.querySelector(".kanban-deliverables-list");
    const count = block.querySelector(".kanban-deliverables-count");
    if (!list) return;
    try {
      const res = await invoke(TASK_DELIVERABLE_LIST_COMMAND, { taskId });
      const { lines, counter } = buildDeliverableBlock(res);
      if (count) count.textContent = counter;
      list.innerHTML = lines.length
        ? lines
            .map(
              (l) => `<div class="kanban-check-row kanban-deliverable-row">
            <span class="kanban-check-label kanban-deliverable-label"><span>${escapeHtml(l.label)}</span></span>
            <span class="dash-muted kanban-deliverable-meta">${escapeHtml(l.date)}${l.origin ? ` · ${escapeHtml(l.origin)}` : ""}</span>
          </div>`
            )
            .join("")
        : `<div class="dash-muted kanban-deliverables-empty">${escapeHtml(DELIVERABLE_EMPTY_TEXT)}</div>`;
      refreshIcons(list);
    } catch (err) {
      // Lecture impossible : une ligne d'information suffit, rien n'est inventé
      // et aucune exception ne remonte (la fiche reste utilisable).
      if (count) count.textContent = "";
      list.innerHTML = `<div class="dash-error kanban-deliverables-error">${escapeHtml(deliverableErrorMessage(err))}</div>`;
    }
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
      // Compteurs de checklist des cartes (lecture en base, après le rendu pour
      // ne jamais retarder l'affichage du Kanban).
      refreshCheckCounts();
      // Idée 2 (Lot A), tranche 3 : temps des cartes (lecture en base elle aussi,
      // APRÈS le rendu : l'affichage du Kanban n'attend pas les pastilles).
      refreshTaskTimes();
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
  // Le passage en « Terminé » est soumis au contrôle de checklist du cœur :
  // confirmation + UNE relance forcée en mode « rappel », refus affiché tel quel
  // en mode bloquant (aucune règle dupliquée ici, cf. `handleChecklistGate`).
  async function moveKanbanTask(taskId, status) {
    if (await updateTaskStatusWithGate(taskId, status)) loadSuperKanban();
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
    checklistCfg = null; // réglages relus pour CETTE fiche (jamais ceux d'une précédente)
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
        ${isEdit ? `<div class="kanban-field kanban-checklist">
          <div class="kanban-checklist-head"><i data-lucide="list-checks" class="icon-sm"></i> Checklist de livraison <span class="kanban-checklist-count dash-muted"></span></div>
          <div class="kanban-checklist-list"><div class="dash-muted">Chargement de la checklist…</div></div>
          <div class="kanban-checklist-add">
            <input type="text" class="kanban-checklist-input" placeholder="Nouveau point (ex: tests passés)" aria-label="Nouveau point de checklist">
            <button type="button" class="btn kanban-checklist-add-btn">Ajouter</button>
          </div>
        </div>` : ""}
        ${isEdit ? `<div class="kanban-field kanban-checklist kanban-task-time">
          <div class="kanban-checklist-head"><i data-lucide="clock" class="icon-sm"></i> Temps <span class="kanban-time-summary kanban-checklist-count dash-muted"></span></div>
          <div class="kanban-checklist-add">
            <input type="text" inputmode="numeric" class="kanban-checklist-input kanban-time-estimated-input" placeholder="Temps prévu (min)" aria-label="Temps prévu en minutes">
            <button type="button" class="btn kanban-checklist-add-btn kanban-time-set-btn">Régler le prévu</button>
          </div>
          <div class="kanban-checklist-add">
            <input type="text" inputmode="numeric" class="kanban-checklist-input kanban-time-spent-input" placeholder="Temps passé à ajouter (min)" aria-label="Temps passé à ajouter en minutes">
            <button type="button" class="btn kanban-checklist-add-btn kanban-time-add-btn">Ajouter le passé</button>
          </div>
          <div class="dash-muted kanban-time-hint">Le temps passé se cumule. Laisser le prévu vide l'efface ; aucun temps n'est déduit ni estimé à votre place.</div>
          <div class="dash-error kanban-time-error" hidden></div>
        </div>` : ""}
        ${isEdit ? `<div class="kanban-field kanban-checklist kanban-deliverables">
          <div class="kanban-checklist-head"><i data-lucide="package-check" class="icon-sm"></i> Livrable <span class="kanban-deliverables-count dash-muted"></span></div>
          <div class="kanban-checklist-list kanban-deliverables-list"><div class="dash-muted">Chargement des livraisons…</div></div>
        </div>` : ""}
        <div class="modal-actions">
          <button type="button" class="btn kanban-cancel-btn">Annuler</button>
          <button type="submit" class="btn kanban-save-btn">${isEdit ? "Enregistrer" : "Créer"}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      // Le compteur des cartes peut avoir changé depuis la fiche : on relit le
      // cache (toujours issu de la base) sans recharger tout le Kanban.
      applyCheckCounters();
      // Idem pour la pastille de temps : ce qui vient d'être saisi sur la fiche
      // se voit sur la carte dès sa fermeture (cache relu en base, jamais deviné).
      applyTimePills();
    };
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
          const saved = await updateTaskWithGate({
            taskId: task.id,
            title,
            description,
            projectPath: f.project.value || null,
            status: columnToStatus(f.status.value),
            deadline,
          });
          // Statut refusé ou confirmation déclinée : la fiche reste ouverte, rien
          // n'a été écrit (aucun état optimiste affiché).
          if (!saved) return;
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
    // Idée 3 (Lot A), tranche 3.4 : checklist de la tâche éditée. Le bloc est
    // TOUJOURS relu en base après chaque opération (ajout, coche, suppression) —
    // l'écran n'affiche jamais un état deviné.
    if (isEdit) {
      const block = overlay.querySelector(".kanban-checklist");
      // Idée 4 (Lot A), tranche 4.4 : le bloc « Livrable » de la fiche est relu EN
      // BASE à l'ouverture ET après CHAQUE opération de la fiche — l'écran
      // n'affiche jamais un état deviné (même invariant que la checklist). Le bloc
      // est en LECTURE SEULE : l'écriture d'une ligne de traçabilité est
      // automatique côté cœur (tranche 4.2), aucun bouton n'écrit ici. Une écriture
      // réussie depuis la fiche ferme la fiche et recharge le Kanban : les lignes
      // neuves apparaissent donc dès la réouverture, jamais par un état optimiste.
      const deliverableBlock = overlay.querySelector(".kanban-deliverables");
      const reloadDeliverables = () => renderDeliverables(deliverableBlock, task.id);
      const addPoint = async () => {
        const input = block.querySelector(".kanban-checklist-input");
        const label = (input.value || "").trim();
        if (!label) return;
        try {
          await invoke("super_agent_task_check_add", { taskId: task.id, label });
          input.value = "";
        } catch (err) {
          console.error("Erreur ajout point de checklist:", err);
        }
        await renderChecklist(block, task.id);
        await reloadDeliverables();
      };
      // Tranche 3.5 : crée les points du MODÈLE par défaut (jamais imposés :
      // uniquement sur un clic explicite, et seulement si la tâche n'a aucun
      // point — le bouton n'existe que dans ce cas).
      const addTemplatePoints = async () => {
        const cfg = await loadChecklistConfig();
        const points = parseChecklistTemplate(cfg.template);
        for (const label of points) {
          try {
            await invoke("super_agent_task_check_add", { taskId: task.id, label });
          } catch (err) {
            console.error("Erreur ajout point du modèle:", err);
          }
        }
        await renderChecklist(block, task.id);
        await reloadDeliverables();
      };
      block.addEventListener("click", async (e) => {
        const del = e.target.closest(".kanban-check-del");
        if (del) {
          try {
            await invoke("super_agent_task_check_delete", { checkId: Number(del.dataset.checkId) });
          } catch (err) {
            console.error("Erreur suppression point de checklist:", err);
          }
          await renderChecklist(block, task.id);
          await reloadDeliverables();
          return;
        }
        if (e.target.closest(".kanban-checklist-add-btn")) await addPoint();
        else if (e.target.closest(".kanban-checklist-template-btn")) await addTemplatePoints();
      });
      block.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.closest(".kanban-checklist-input")) {
          e.preventDefault(); // pas de soumission implicite du formulaire de la fiche
          addPoint();
        }
      });
      block.addEventListener("change", async (e) => {
        const cb = e.target.closest(".kanban-check-toggle");
        if (!cb) return;
        try {
          await invoke("super_agent_task_check_set_done", {
            checkId: Number(cb.dataset.checkId),
            done: cb.checked,
          });
        } catch (err) {
          console.error("Erreur coche point de checklist:", err);
        }
        await renderChecklist(block, task.id);
        await reloadDeliverables();
      });
      // Idée 2 (Lot A), tranche 3 : bloc « Temps » de la fiche. Il n'écrit JAMAIS
      // de statut (uniquement le prévu ABSOLU et le passé en CUMUL, par les deux
      // commandes de la tranche 2.2) et il RELIT la base après CHAQUE opération
      // réussie. Un refus (saisie invalide, valeur négative, tâche inconnue)
      // affiche un message clair et n'écrit RIEN.
      const timeBlock = overlay.querySelector(".kanban-task-time");
      const setTimeError = (message) => {
        const errEl = timeBlock && timeBlock.querySelector(".kanban-time-error");
        if (!errEl) return;
        errEl.hidden = false;
        errEl.textContent = message;
      };
      const setEstimated = async () => {
        const input = timeBlock.querySelector(".kanban-time-estimated-input");
        const parsed = parseEstimatedMinutesInput(input ? input.value : "");
        // Saisie refusée avant tout appel : rien n'est envoyé au cœur.
        if (!parsed.ok) {
          setTimeError(parsed.message);
          return;
        }
        try {
          await invoke(TASK_TIME_SET_ESTIMATED_COMMAND, { taskId: task.id, minutes: parsed.minutes });
        } catch (err) {
          setTimeError(taskTimeErrorMessage(err));
          return;
        }
        await renderTaskTime(timeBlock, task.id);
      };
      const addSpent = async () => {
        const input = timeBlock.querySelector(".kanban-time-spent-input");
        const parsed = parseSpentMinutesInput(input ? input.value : "");
        // Champ vide ou saisie invalide : refus net, aucune écriture.
        if (!parsed.ok) {
          setTimeError(parsed.message);
          return;
        }
        try {
          await invoke(TASK_TIME_ADD_SPENT_COMMAND, { taskId: task.id, minutes: parsed.minutes });
        } catch (err) {
          setTimeError(taskTimeErrorMessage(err));
          return;
        }
        // Le passé est un CUMUL : le champ repart vide pour le prochain ajout.
        if (input) input.value = "";
        await renderTaskTime(timeBlock, task.id);
      };
      timeBlock.addEventListener("click", (e) => {
        if (e.target.closest(".kanban-time-set-btn")) { setEstimated(); return; }
        if (e.target.closest(".kanban-time-add-btn")) addSpent();
      });
      timeBlock.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || !e.target.closest(".kanban-checklist-input")) return;
        e.preventDefault(); // pas de soumission implicite du formulaire de la fiche
        if (e.target.closest(".kanban-time-estimated-input")) setEstimated();
        else if (e.target.closest(".kanban-time-spent-input")) addSpent();
      });
      renderTaskTime(timeBlock, task.id);
      renderChecklist(block, task.id);
      reloadDeliverables();
    }
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
