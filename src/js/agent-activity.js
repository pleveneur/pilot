// agent-activity.js — Indicateur d'activité des agents (haut droite)
//
// Cercle flottant en haut à droite reflétant l'activité de TOUS les agents
// (assistant + codeurs). Le cercle « respire » (animation agent-pulse) dès
// qu'UN agent travaille. Au clic : liste déroulante (fond transparent) avec un
// cercle respirant par agent, puis une fiche (nom, état, projet, dernière
// activité) avec un bouton « Afficher l'onglet ».
//
// Source de vérité : `get_agent_supervision` (dashboard.rs), pollée toutes les
// 2 s, + événement push `agent-state-changed` (Rust → JS) pour un rafraîchissement
// immédiat. Aucune commande Rust ajoutée.
//
// Les fonctions pures (flattenAgents, anyBusy, renderDropdown, renderCard,
// formatLastActivity) sont testées dans agent-activity.test.js.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Dernière activité connue par agent (timestamp), alimentée par
// `agent-state-changed`. Clé = agentId (id brut, ex: "superagent" ou l'id agent).
const lastActivity = new Map();

/** Échappe un texte pour insertion HTML sûre. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formate un timestamp en heure locale (HH:MM) ou null si absent. */
export function formatLastActivity(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return null;
  }
}

/**
 * Aplatit la supervision en une liste plate d'agents.
 * @param {object} supervision — sortie de get_agent_supervision ({projects:[...]}).
 * @param {Map<string,number>} [lastActivityMap] — timestamps de dernière activité.
 * @returns {Array<{agentId,label,project,state,busy,lastActivity,kind}>}
 */
export function flattenAgents(supervision, lastActivityMap) {
  const projects = (supervision && supervision.projects) || [];
  const list = [];
  for (const proj of projects) {
    const project = proj.path || "";
    const isSuper = project === "";
    // L'assistant (projet pseudo-global "") n'a pas de projet : on laisse vide.
    const projectName = isSuper ? "" : proj.name || project.split(/[\\/]/).pop() || "";
    for (const a of proj.agents || []) {
      const label = a.agent || "";
      const state = a.state || "stopped";
      const busy = state === "running" || state === "compacting";
      const agentId = isSuper ? "superagent" : label;
      list.push({
        agentId,
        label,
        project: projectName,
        state,
        busy,
        lastActivity: lastActivityMap ? formatLastActivity(lastActivityMap.get(agentId)) : null,
        kind: isSuper ? "superagent" : "agent",
      });
    }
  }
  return list;
}

/** true si au moins un agent est occupé (travail en cours). */
export function anyBusy(list) {
  return list.some((a) => a.busy);
}

/** Rendu HTML de la liste déroulante (fond transparent, un cercle par agent). */
export function renderDropdown(list) {
  if (!list.length) {
    return '<div class="agent-activity-empty">Aucun agent actif</div>';
  }
  return list
    .map(
      (a) => `
    <button class="agent-activity-item" data-agent-id="${esc(a.agentId)}" data-kind="${esc(a.kind)}">
      <span class="agent-activity-item-dot ${a.busy ? "breathing" : ""}"></span>
      <span class="agent-activity-item-label">${esc(a.label)}</span>
      <span class="agent-activity-item-project">${esc(a.project)}</span>
    </button>`
    )
    .join("");
}

/** Rendu HTML de la fiche d'un agent (nom, état, projet, dernière activité). */
export function renderCard(agent) {
  const stateLabel = agent.busy ? "Travail" : "Repos";
  return `
    <div class="agent-activity-card-head">
      <span class="agent-activity-item-dot ${agent.busy ? "breathing" : ""}"></span>
      <span class="agent-activity-card-name">${esc(agent.label)}</span>
    </div>
    <div class="agent-activity-card-row"><span>État</span><span>${stateLabel}</span></div>
    <div class="agent-activity-card-row"><span>Projet</span><span>${esc(agent.project || "—")}</span></div>
    <div class="agent-activity-card-row"><span>Dernière activité</span><span>${esc(agent.lastActivity || "—")}</span></div>
    <button class="agent-activity-card-open" data-agent-id="${esc(agent.agentId)}" data-kind="${esc(agent.kind)}">Afficher l'onglet</button>
  `;
}

/**
 * Initialise l'indicateur d'activité des agents.
 * @param {object} tabs — instance du gestionnaire d'onglets (tabs.js).
 */
export function initAgentActivity(tabs) {
  const container = document.getElementById("agent-activity");
  const dot = document.getElementById("agent-activity-dot");
  const dropdown = document.getElementById("agent-activity-dropdown");
  const card = document.getElementById("agent-activity-card");
  if (!container || !dot || !dropdown || !card) return;

  let currentList = [];
  let currentCardAgent = null;

  async function refresh() {
    try {
      const sup = await invoke("get_agent_supervision");
      currentList = flattenAgents(sup, lastActivity);
      const busy = anyBusy(currentList);
      dot.classList.toggle("breathing", busy);
      dot.title = busy ? "Un agent travaille" : "Agents au repos";
      if (!dropdown.classList.contains("hidden")) {
        dropdown.innerHTML = renderDropdown(currentList);
      }
      if (currentCardAgent) {
        const updated = currentList.find(
          (a) => a.agentId === currentCardAgent.agentId && a.kind === currentCardAgent.kind
        );
        if (updated) {
          currentCardAgent = updated;
          card.innerHTML = renderCard(updated);
        }
      }
    } catch (_) {
      /* ignore : pas de mise à jour */
    }
  }

  function toggleDropdown() {
    if (dropdown.classList.contains("hidden")) {
      dropdown.innerHTML = renderDropdown(currentList);
      dropdown.classList.remove("hidden");
      card.classList.add("hidden");
    } else {
      dropdown.classList.add("hidden");
    }
  }

  // Clic sur le cercle → ouvre/ferme la liste déroulante.
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Clic sur un agent de la liste → affiche sa fiche.
  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".agent-activity-item");
    if (!item) return;
    const agent = currentList.find(
      (a) => a.agentId === item.dataset.agentId && a.kind === item.dataset.kind
    );
    if (!agent) return;
    currentCardAgent = agent;
    card.innerHTML = renderCard(agent);
    dropdown.classList.add("hidden");
    card.classList.remove("hidden");
  });

  // Bouton « Afficher l'onglet » → ouvre l'onglet de l'agent.
  card.addEventListener("click", (e) => {
    const btn = e.target.closest(".agent-activity-card-open");
    if (!btn) return;
    const agent = currentList.find(
      (a) => a.agentId === btn.dataset.agentId && a.kind === btn.dataset.kind
    );
    if (!agent) return;
    if (agent.kind === "superagent") {
      tabs.openFile(agent.label, "superagent");
    } else {
      tabs._openAgent(agent.label, agent.agentId);
    }
    card.classList.add("hidden");
  });

  // Fermeture au clic extérieur (pattern sidebar.js).
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) {
      dropdown.classList.add("hidden");
      card.classList.add("hidden");
    }
  });

  // Rafraîchissement immédiat sur changement d'état d'un agent.
  listen("agent-state-changed", (event) => {
    const p = event.payload || {};
    if (p.agentId) lastActivity.set(p.agentId, Date.now());
    refresh();
  }).catch(() => {});

  // Poll toutes les 2 s (source de vérité get_agent_supervision).
  setInterval(refresh, 2000);
  refresh();
}
