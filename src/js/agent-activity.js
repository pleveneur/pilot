// agent-activity.js — Indicateur d'activité des agents (haut droite)
//
// Cercle flottant en haut à droite reflétant l'activité de TOUS les agents
// (assistant + codeurs). Le cercle « respire » (animation agent-pulse) dès
// qu'UN agent travaille. Au clic : liste déroulante (fond solide, teinté violet
// assistant) avec un
// cercle respirant par agent, puis une fiche (nom, état, projet, dernière
// activité) avec un bouton « Afficher l'onglet ».
//
// Comportement de la liste : le clic sur le cercle principal bascule
// l'ouverture/fermeture. La liste reste OUVERTE tant qu'on ne reclique pas sur
// ce cercle (pas de fermeture au clic extérieur). L'état déplié/replié est
// persisté via localStorage (agent-activity-expanded) et restauré au démarrage.
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

// Espace réservé des agents d'assistant SANS projet (clé `__assistant__`),
// distinct de "" (super-agent Magnus) et de tout chemin de projet réel.
const ASSISTANT_SPACE = "__assistant__";

/** Échappe un texte pour insertion HTML sûre. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formate un timestamp en heure locale (HH:MM, 24h) ou null si absent. */
export function formatLastActivity(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch (_) {
    return null;
  }
}

/**
 * Aplatit la supervision en une liste plate d'agents.
 * @param {object} supervision — sortie de get_agent_supervision ({projects:[...]}).
 * @param {Map<string,number>} [lastActivityMap] — timestamps de dernière activité.
 * @returns {Array<{agentId,rawId,label,project,projectPath,state,busy,lastActivity,kind}>}
 */
export function flattenAgents(supervision, lastActivityMap) {
  const projects = (supervision && supervision.projects) || [];
  const list = [];
  for (const proj of projects) {
    const project = proj.path || "";
    const isSuper = project === "";
    const isAssistant = project === ASSISTANT_SPACE;
    // L'assistant (projet pseudo-global "") et l'espace des agents d'assistant
    // (ASSISTANT_SPACE) n'ont pas de projet réel : étiquette lisible « Assistant ».
    const projectName = isSuper
      ? ""
      : isAssistant
        ? "Assistant"
        : proj.name || project.split(/[\\/]/).pop() || "";
    for (const a of proj.agents || []) {
      const label = a.agent || "";
      const state = a.state || "stopped";
      const busy = state === "running" || state === "compacting";
      // Identité UNIQUE par agent : deux agents peuvent porter le même nom
      // (« codeur ») sur des PROJETS différents. Pour l'assistant (projet ""),
      // l'id reste "superagent" ; pour un agent, on combine nom + chemin projet
      // (ex: "codeur|C:/proj/Pilot") pour lever toute ambiguïté dans la liste
      // aplatie et au clic. `rawId` garde l'id brut (== label pour un agent
      // nommé), `label` et `project` restent l'affichage lisible.
      const rawId = isSuper ? "superagent" : label;
      const agentId = isSuper ? "superagent" : (isAssistant ? label : `${label}|${project}`);
      list.push({
        agentId,
        rawId,
        label,
        project: projectName,
        projectPath: isSuper || isAssistant ? "" : project,
        state,
        busy,
        lastActivity: lastActivityMap ? formatLastActivity(lastActivityMap.get(rawId)) : null,
        kind: isSuper ? "superagent" : (isAssistant ? "assistant" : "agent"),
      });
    }
  }
  return list;
}

/** true si au moins un agent est occupé (travail en cours). */
export function anyBusy(list) {
  return list.some((a) => a.busy);
}

/** Rendu HTML de la liste déroulante (fond solide teinté violet, un item par agent).
 * Affiche la pastille (cercle) ainsi que le nom de l'agent, et son projet s'il
 * est présent. Le nom complet (avec projet) reste accessible au survol via un
 * tooltip (title) sur le bouton. */
export function renderDropdown(list) {
  if (!list.length) {
    return '<div class="agent-activity-empty">Aucun agent actif</div>';
  }
  return list
    .map(
      (a) => `
    <button class="agent-activity-item" data-agent-id="${esc(a.agentId)}" data-kind="${esc(a.kind)}" title="${esc(a.label)}${a.project ? " — " + esc(a.project) : ""}">
      <span class="agent-activity-item-dot ${a.busy ? "breathing" : ""} ${a.kind === "superagent" ? "superagent" : ""}"></span>
      <span class="agent-activity-item-label">${esc(a.label)}</span>
      ${a.project ? `<span class="agent-activity-item-project">${esc(a.project)}</span>` : ""}
    </button>`
    )
    .join("");
}

/** Rendu HTML de la fiche d'un agent (nom, état, projet, dernière activité). */
export function renderCard(agent) {
  const stateLabel = agent.busy ? "Travail" : "Repos";
  return `
    <div class="agent-activity-card-head">
      <span class="agent-activity-item-dot ${agent.busy ? "breathing" : ""} ${agent.kind === "superagent" ? "superagent" : ""}"></span>
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
      localStorage.setItem("agent-activity-expanded", "true");
    } else {
      dropdown.classList.add("hidden");
      localStorage.setItem("agent-activity-expanded", "false");
    }
  }

  // Clic sur le cercle → bascule l'ouverture/fermeture de la liste.
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Clic sur un agent de la liste → affiche sa fiche (la liste se replie).
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
    localStorage.setItem("agent-activity-expanded", "false");
    card.classList.remove("hidden");
  });

  // Bouton « Afficher l'onglet » → ouvre l'onglet de l'agent du BON projet.
  card.addEventListener("click", async (e) => {
    const btn = e.target.closest(".agent-activity-card-open");
    if (!btn) return;
    const agent = currentList.find(
      (a) => a.agentId === btn.dataset.agentId && a.kind === btn.dataset.kind
    );
    if (!agent) return;
    if (agent.kind === "superagent") {
      tabs.openFile(agent.label, "superagent");
    } else if (agent.kind === "assistant") {
      // Agent d'assistant SANS projet : il tourne dans l'espace réservé
      // ~/.pilot/assistant, aucun projet réel à activer. On ouvre simplement
      // son onglet via son id brut.
      tabs._openAgent(agent.label, agent.rawId);
    } else {
      // L'onglet d'un agent est lié au PROJET actif (_openAgent utilise
      // window._pilotProjectPath). Si l'agent cliqué appartient à un autre
      // projet, basculer d'abord sur ce projet via la sidebar, puis ouvrir
      // son onglet avec son id brut (rawId). `agentId` (composite unique)
      // ne sert qu'à l'identification interne/du clic, pas à l'ouverture.
      const targetPath = agent.projectPath;
      if (targetPath && targetPath !== (window._pilotProjectPath || "")) {
        const sidebar = window._pilotGetSidebar ? window._pilotGetSidebar() : null;
        if (sidebar) {
          try { await sidebar._activateProject(targetPath); } catch (_) {}
        }
      }
      tabs._openAgent(agent.label, agent.rawId);
    }
    card.classList.add("hidden");
  });

  // NOTE : pas de fermeture au clic extérieur — la liste reste ouverte jusqu'à
  // ce qu'on reclique sur le cercle principal (comportement « liste persistante »).
  // L'état déplié/replié est persisté via localStorage (agent-activity-expanded).

  // Rafraîchissement immédiat sur changement d'état d'un agent.
  listen("agent-state-changed", (event) => {
    const p = event.payload || {};
    if (p.agentId) lastActivity.set(p.agentId, Date.now());
    refresh();
  }).catch(() => {});

  // Poll toutes les 2 s (source de vérité get_agent_supervision).
  setInterval(refresh, 2000);
  refresh();

  // Restaure l'état déplié/replié persisté (localStorage).
  if (localStorage.getItem("agent-activity-expanded") === "true") {
    dropdown.innerHTML = renderDropdown(currentList);
    dropdown.classList.remove("hidden");
  }
}
