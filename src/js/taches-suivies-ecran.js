// LES TÂCHES DU SUIVI, VISIBLES À L'ÉCRAN (volet « Travaux » du panneau du suivi).
//
// Défaut corrigé (docs/rapports/RAPPORT-liste-taches-affichee.md) : le volet
// « Travaux » ne lisait QUE le store d'activité des agents (`buildRunningMissions`).
// Il n'a jamais lu la base de suivi — alors que `super-agent-kanban.js` exportait
// déjà la règle « ouverte ou close » (`isOpenTaskStatus`) et ses deux filtres,
// sans aucun appelant. Conséquences : créer / annuler / regrouper une tâche dans
// le suivi ne changeait rien à l'écran, le nombre affiché ne pouvait pas
// correspondre aux tâches ouvertes, et une tâche seulement suivie ne pouvait pas
// être distinguée d'un travail en cours ou en attente.
//
// Ce module est le SEUL endroit qui :
//   - traduit la réponse de `get_super_agent_kanban` en tâches SUIVIES (règle
//     unique, dédoublonnage par identifiant de tâche) ;
//   - compose le groupe « Suivi » du volet (aucun en-tête quand il n'y a rien) ;
//   - garde une mémoire courte de la liste (une seule requête en vol, jamais
//     d'écran vidé sur une panne) ;
//   - publie / écoute l'UNIQUE signal « le suivi a changé ».
// Aucun DOM ici pour les décisions : `renderTrackedTasksGroupHtml` produit une
// chaîne, l'appelant la pose. Aucune écriture en base : lecture seule.

import { invoke } from "@tauri-apps/api/core";
import { isOpenTaskStatus, normalizeTaskStatus, taskStatusLabel } from "./super-agent-kanban.js";

/** La commande qui rend le suivi (déjà utilisée par l'onglet Kanban). */
export const TACHES_SUIVIES_COMMAND = "get_super_agent_kanban";

/** Durée pendant laquelle la liste lue est réutilisée (jamais une photo périmée). */
export const TACHES_SUIVIES_TTL_MS = 5000;

/** Nombre de lignes affichées avant le renvoi vers l'onglet Kanban. */
export const TACHES_SUIVIES_MAX = 50;

/** En-tête du groupe (une seule composition). */
export const TACHES_SUIVIES_GROUP_LABEL = "Suivi";

/** Classe du groupe : couleur neutre, curseur par défaut (ligne non cliquable). */
export const TACHES_SUIVIES_GROUP_CLASS = "suivi";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Les tâches du suivi qui restent à faire, dans l'ordre de la base.
 *
 * Règle appliquée : `isOpenTaskStatus` (la seule). Une tâche close / annulée /
 * à qualifier n'est donc jamais présentée comme « suivie ». Le dédoublonnage se
 * fait sur l'identifiant de la tâche : la même tâche renvoyée deux fois (deux
 * clients, deux projets, réponse en double) ne produit qu'UNE ligne.
 * Pure : aucune lecture, aucune écriture, aucun DOM.
 *
 * @param {{clients?: Array}} kanban réponse de `get_super_agent_kanban`
 * @returns {Array<{id:number,title:string,status:string,statusKey:string,statusLabel:string,project:string,client:string}>}
 */
export function openTrackedTasks(kanban) {
  const out = [];
  const seen = new Set();
  const clients = (kanban && kanban.clients) || [];
  for (const client of clients) {
    const clientName = String((client && client.name) || "").trim();
    for (const task of (client && client.tasks) || []) {
      if (!task || task.id == null) continue;
      const id = Number(task.id);
      if (!Number.isFinite(id)) continue;
      if (seen.has(id)) continue; // jamais deux fois la même tâche
      if (!isOpenTaskStatus(task.status)) continue; // règle unique « ouverte ou close »
      seen.add(id);
      const title = String(task.title || "").trim();
      out.push({
        id,
        title: title || "Sans titre",
        status: String(task.status || ""),
        statusKey: normalizeTaskStatus(task.status),
        statusLabel: taskStatusLabel(task.status),
        project: String(task.project_name || task.project_path || "").trim(),
        client: clientName === "Sans client" ? "" : clientName,
      });
    }
  }
  return out;
}

/**
 * Empreinte de la liste (identifiant + statut) : sert à ne pas repeindre quand
 * rien n'a changé. Pure.
 * @param {Array} tasks
 * @returns {string}
 */
export function trackedTasksSignature(tasks) {
  return (tasks || [])
    .filter((t) => t && t.id != null)
    .map((t) => `${t.id}:${t.status}`)
    .join("|");
}

/**
 * Le groupe « Suivi » du volet « Travaux ».
 *
 * Rien à afficher ⇒ chaîne VIDE : aucun en-tête orphelin, aucun message ajouté
 * (le volet garde exactement son apparence quand le suivi est vide). Sinon un
 * en-tête explicite dit que ces tâches ne sont PAS en train d'être travaillées,
 * et chaque ligne porte le libellé de son statut (« À faire », « En cours »,
 * « À valider »). Pure.
 *
 * @param {Array} tasks résultat de `openTrackedTasks`
 * @param {{max?:number}} [options]
 * @returns {string} HTML
 */
export function renderTrackedTasksGroupHtml(tasks, options = {}) {
  const list = (tasks || []).filter((t) => t && t.id != null);
  if (!list.length) return "";
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : TACHES_SUIVIES_MAX;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  const header =
    `<div class="sa-task-client sa-missions-group ${TACHES_SUIVIES_GROUP_CLASS}">` +
    `${escapeHtml(TACHES_SUIVIES_GROUP_LABEL)} (${list.length}) — suivi seul, aucun agent ne travaille dessus` +
    `</div>`;
  const rows = shown
    .map((t) => {
      const meta = [t.project, t.client].filter(Boolean).join(" · ");
      return (
        `<div class="sa-task-item ${TACHES_SUIVIES_GROUP_CLASS}" data-task-id="${t.id}">` +
        `<div class="sa-task-head">` +
        `<span class="sa-task-title">${escapeHtml(t.title)}</span>` +
        `<span class="sa-task-status tone-${escapeHtml(t.statusKey)}">${escapeHtml(t.statusLabel)}</span>` +
        `</div>` +
        (meta ? `<div class="sa-task-meta">${escapeHtml(meta)}</div>` : "") +
        `</div>`
      );
    })
    .join("");
  const more =
    rest > 0
      ? `<div class="sa-task-more dash-muted">… et ${rest} autre${rest > 1 ? "s" : ""} tâche${rest > 1 ? "s" : ""} suivie${rest > 1 ? "s" : ""} — voir l'onglet Kanban.</div>`
      : "";
  return header + rows + more;
}

// ── Mémoire courte de la liste ──────────────────────────────────────────────

let cache = null;
let cacheAt = 0;
let inFlight = null;
const listeners = new Set();

/**
 * Lit les tâches suivies. Une seule requête en vol ; la liste relue est réutilisée
 * `TACHES_SUIVIES_TTL_MS`. Échec (backend indisponible) ⇒ `null` et la DERNIÈRE
 * liste connue est conservée : l'écran ne se vide jamais sur une panne et
 * l'appelant n'a aucune exception à gérer.
 *
 * @param {{force?:boolean, now?:number, fetch?:Function}} [options]
 * @returns {Promise<Array|null>}
 */
export function loadTrackedTasks(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!options.force && cache && now - cacheAt < TACHES_SUIVIES_TTL_MS) return Promise.resolve(cache);
  if (inFlight) return inFlight;
  const fetchFn = typeof options.fetch === "function" ? options.fetch : () => invoke(TACHES_SUIVIES_COMMAND);
  inFlight = (async () => {
    try {
      const data = await fetchFn();
      cache = openTrackedTasks(data);
      cacheAt = now;
      return cache;
    } catch (_err) {
      return cache; // fail-open : dernière photo connue (ou null), jamais d'exception
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Oublie la liste mémorisée (le prochain chargement relit la base). */
export function resetTrackedTasksCache() {
  cache = null;
  cacheAt = 0;
  inFlight = null;
}

/**
 * S'abonne à l'unique signal « le suivi a changé ».
 * @param {Function} cb
 * @returns {Function} désabonnement
 */
export function onTrackedTasksChanged(cb) {
  if (typeof cb !== "function") return () => {};
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Publie l'unique signal « le suivi a changé » : la liste mémorisée est oubliée
 * et chaque abonné est prévenu (un abonné fautif n'empêche pas les autres).
 */
export function notifyTrackedTasksChanged() {
  cache = null; // la photo est OUBLIEE : la prochaine lecture relit la base
  cacheAt = 0;
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch (_err) {
      /* un abonné fautif ne coupe pas le signal des autres */
    }
  }
}
