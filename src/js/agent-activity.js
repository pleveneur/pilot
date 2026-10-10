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
// Le poll + le filtrage sont centralisés dans un « store » partagé
// (subscribeAgentActivity) consommé par l'indicateur ci-dessus ET par le
// résumé repliable des agents du mode « Assistant Only » immersif
// (super-agent.js) — même source de données, même filtrage, aucun polling
// dupliqué.
//
// Les fonctions pures (flattenAgents, anyBusy, shortMission, buildRunningMissions,
// renderDropdown, renderCard, renderStaticAgentList, formatLastActivity) sont
// testées dans agent-activity.test.js.

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
      // Owner requirement: the list must show EVERY live agent, whatever the
      // launch mode. The assistant's discreet delegation (startAgentInvisible
      // → set_agent_visible(false) + start_agent_session) creates a `main`
      // session, so restricting the exception to agent_process/assistant_agent
      // hid the most common delegate whenever it was idle (between two turns).
      // Any ALIVE process without a tab stays listed, even at rest, and remains
      // recoverable via "Afficher l'onglet". A stopped agent (alive=false, pi
      // process gone) is filtered as before — no lingering false positive.
      // Missing `visible` (old backend payload) is treated as visible. The
      // superagent (project "") and the assistant agents (ASSISTANT_SPACE) are
      // never filtered.
      if (!isSuper && !isAssistant && a.visible === false && !busy) {
        const aliveBackground = a.alive; // pi process alive, all modes (main / agent_process / assistant_agent)
        if (!aliveBackground) continue;
      }
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
        // Tâche #140 : un agent d'assistant (sans projet) porte l'espace réservé
        // `__assistant__` (et non "") : l'ouverture de son onglet doit pouvoir
        // distinguer « aucun projet » de « projet vide » pour ne JAMAIS retomber
        // sur le projet actif.
        projectPath: isAssistant ? ASSISTANT_SPACE : (isSuper ? "" : project),
        state,
        busy,
        // Mission en cours (affichage « missions en cours » du panneau de la
        // cloche) : dernier prompt réellement envoyé à la session — déjà tronqué
        // côté Rust — et outil long éventuellement en cours. Champs ADDITIFS :
        // les consommateurs existants (indicateur d'activité, résumé immersif,
        // onglet agent, assistant web) les ignorent.
        prompt: typeof a.prompt === "string" ? a.prompt : "",
        toolInProgress: a.toolInProgress === true,
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

// ── Missions en cours (affichage du panneau de la cloche) ──

/** Longueur maximale affichée du texte d'une mission. */
export const MISSION_MAX_CHARS = 80;

/** Tronque un texte à `MISSION_MAX_CHARS` caractères, suffixé « … » si coupé. */
function clipMission(text) {
  const chars = Array.from(text);
  if (chars.length <= MISSION_MAX_CHARS) return text;
  return chars.slice(0, MISSION_MAX_CHARS).join("") + "…";
}

/**
 * Repli explicite affiché quand le texte enregistré est le RÔLE de l'agent
 * (« Tu es un planificateur logiciel… ») et non une tâche : un rôle n'est JAMAIS
 * une mission. Cas réel : un processus démarré sans tâche (ex. `plan-maker`).
 */
export const MISSION_ROLE_FALLBACK = "en préparation";

// En-têtes MÉCANIQUES d'un prompt de délégation : ils décrivent la STRUCTURE du
// prompt (« ## Contexte », « ## Objectif », « ## Consignes », « ## Ce qu'il ne
// faut PAS faire »), pas la tâche. Les afficher n'apprend rien à l'utilisateur :
// on les saute pour prendre la première ligne de CONTENU réel.
const MECHANICAL_HEADERS = new Set([
  "contexte",
  "objectif",
  "consignes",
  "ce qu il ne faut pas faire",
]);

/** Normalise une ligne (minuscules, sans accents ni ponctuation) pour comparaison. */
function normalizeHeading(line) {
  return String(line == null ? "" : line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** true si la ligne n'est qu'un en-tête mécanique de prompt (markdown compris). */
export function isMechanicalHeader(line) {
  return MECHANICAL_HEADERS.has(normalizeHeading(line));
}

/**
 * true si la ligne est l'énoncé du RÔLE de l'agent (« Tu es un <métier> … »,
 * « Vous êtes une … »), jamais une tâche à afficher.
 */
export function looksLikeAgentRole(line) {
  const flat = String(line == null ? "" : line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /^(?:tu es|vous etes|you are)\s+(?:un|une|le|la|the)\b/i.test(flat);
}

/** Retire les décorations markdown de tête (titre, liste, citation, gras). */
function stripLeadingMarkdown(line) {
  let s = String(line == null ? "" : line).trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/^>\s?/, "")
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\*{1,2}/, "")
      .trim();
    if (s === before) break;
  }
  return s.replace(/\*{1,2}$/, "").trim();
}

/**
 * Réduit le texte d'une demande d'agent à une ligne courte et LISIBLE pour
 * l'affichage. Fonction PURE et déterministe :
 *  1. si le texte contient une ligne `Tâche : <titre>` (prompts d'orchestration,
 *     y compris retries) → ce `<titre>` (PRIORITAIRE) ;
 *  2. sinon la première ligne de CONTENU réel : fences de code ignorées, en-têtes
 *     mécaniques de délégation (« ## Contexte », « **Objectif** »…) sautés et
 *     markdown de tête retiré ; coupée à `MISSION_MAX_CHARS` caractères avec « … » ;
 *  3. si seule une ligne de RÔLE d'agent est trouvée (processus sans tâche) →
 *     « en préparation » (repli explicite) : jamais le rôle ;
 *  4. si le texte est vide ou inconnu → « (demande non précisée) » : JAMAIS une
 *     ligne vide, JAMAIS un texte inventé.
 * @param {string} text — prompt brut (déjà tronqué côté Rust) ou valeur absente.
 * @returns {string} libellé de mission, toujours non vide.
 */
export function shortMission(text) {
  const raw = String(text == null ? "" : text);
  const lines = raw.split(/\r?\n/);
  // 1. Ligne « Tâche : … » (orchestration) — PRIORITAIRE, cherchée partout.
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*>]\s*)*(?:\*\*)?T[âa]che\s*:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/);
    if (m && m[1].trim()) return clipMission(m[1].trim());
  }
  // 2. Première ligne de CONTENU réel, hors fences, hors en-têtes mécaniques et
  //    hors markdown de tête. Un RÔLE est sauté (jamais affiché comme mission).
  let inFence = false;
  let sawRoleLine = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isMechanicalHeader(trimmed)) continue;
    const clean = stripLeadingMarkdown(trimmed);
    if (!clean) continue;
    if (looksLikeAgentRole(clean)) {
      sawRoleLine = true;
      continue;
    }
    return clipMission(clean);
  }
  // 3. Repli explicite : le rôle n'est JAMAIS affiché.
  if (sawRoleLine) return MISSION_ROLE_FALLBACK;
  // 4. Repli explicite (texte vide ou inconnu).
  return "(demande non précisée)";
}

/**
 * Construit la liste des missions RÉELLEMENT en cours à afficher (panneau de la
 * cloche, onglet « En cours »). Fonction PURE.
 *
 * Règles (faux négatifs interdits) :
 *  - un agent RETENU si `busy` OU `toolInProgress` : un outil long et SILENCIEUX
 *    (compilation, tests) ne fait pas disparaître sa mission ;
 *  - un agent AU REPOS (`idle` / `paused` / `stopped`) est MASQUÉ : pas de mission ;
 *  - l'Assistant lui-même suit la même règle ;
 *  - les missions EN ATTENTE (files d'attente de délégation / de run) sont
 *    ajoutées avec `waiting: true` (mention « en attente » à l'affichage).
 * @param {Array} list — liste aplatie (flattenAgents).
 * @param {Array<{project: string, mission: string}>} [queued] — missions en file.
 * @returns {Array<{agent: string, project: string, mission: string, waiting: boolean}>}
 */
export function buildRunningMissions(list, queued) {
  const out = [];
  for (const a of list || []) {
    if (!a || (!a.busy && !a.toolInProgress)) continue;
    out.push({
      agent: a.label || "",
      project: a.project || "Assistant",
      mission: shortMission(a.prompt),
      waiting: false,
    });
  }
  for (const q of queued || []) {
    if (!q) continue;
    out.push({
      agent: q.agent || "",
      project: q.project || "Assistant",
      mission: shortMission(q.mission),
      waiting: true,
    });
  }
  return out;
}

// ── Store partagé (supervision, plusieurs consommateurs) ──
// Sémantique historique de l'indicateur (poll 2 s + push `agent-state-changed`,
// filtrage flattenAgents), extraite d'initAgentActivity pour être réutilisée
// sans doublon : un seul polling actif quelle que soit la consommation. En cas
// d'échec de get_agent_supervision, aucun abonné n'est noté (pas de mise à
// jour), comme avant.
const activitySubscribers = new Set();
let activityStarted = false;
// Dernière liste/busy notifiés. `null` = store jamais alimenté.
let currentActivityList = null;
let currentActivityBusy = false;

async function activityRefresh() {
  try {
    const sup = await invoke("get_agent_supervision");
    const list = flattenAgents(sup, lastActivity);
    currentActivityList = list;
    currentActivityBusy = anyBusy(list);
    for (const cb of [...activitySubscribers]) {
      try { cb(currentActivityList, currentActivityBusy); } catch (_) {}
    }
  } catch (_) {
    /* ignore : pas de mise à jour */
  }
}

/** Démarre le polling partagé (une seule fois, au premier abonné). */
function ensureActivityStore() {
  if (activityStarted) return;
  activityStarted = true;
  // Push immédiat : changement d'état d'un agent (mise à jour lastActivity).
  listen("agent-state-changed", (event) => {
    const p = event.payload || {};
    if (p.agentId) lastActivity.set(p.agentId, Date.now());
    activityRefresh();
  }).catch(() => {});
  // Poll toutes les 2 s (source de vérité get_agent_supervision).
  setInterval(activityRefresh, 2000);
  activityRefresh();
}

/**
 * S'abonne au flux d'activité partagé (liste aplatie flattenAgents + busy).
 * L'abonné est noté immédiatement avec le dernier état connu (s'il existe),
 * puis à chaque poll/événement. @returns {Function} désabonnement.
 */
export function subscribeAgentActivity(cb) {
  ensureActivityStore();
  activitySubscribers.add(cb);
  if (currentActivityList) {
    try { cb(currentActivityList, currentActivityBusy); } catch (_) {}
  }
  return () => activitySubscribers.delete(cb);
}

/** Dernier état connu du store partagé (vide tant qu'aucun poll n'a abouti). */
export function getAgentActivitySnapshot() {
  return { list: currentActivityList || [], busy: currentActivityBusy };
}

/**
 * Rendu HTML de la liste des agents en AFFICHAGE SEUL (mode « Assistant Only »
 * immersif, barre du haut). Retour du 30/08 : la liste déployée en mode
 * assistant seul doit être EXACTEMENT la même que celle du mode standard —
 * mêmes entrées (pastille + nom + projet), issues de la même source (store
 * partagé, même filtrage amont) et rendues par le MÊME code : on réutilise
 * donc renderDropdown tel quel. SEULE différence (portée par le monteur) :
 * aucun handler d'action n'est branché sur ces items dans le mode immersif —
 * cliquer une entrée n'affiche AUCUN détail (pas de fiche, pas d'ouverture
 * d'onglet, pas de changement de projet) ; un clic replie simplement le
 * résumé. La liste reste strictement informative.
 * @param {Array} list — liste aplatie (flattenAgents), identique au standard.
 * @returns {string} HTML identique à la liste déroulante standard.
 */
export function renderStaticAgentList(list) {
  return renderDropdown(list || []);
}

/**
 * Monte le résumé des agents dans la barre du haut du mode « Assistant Only »
 * : le petit point unique (animation agent-pulse) qui « respire » quand un
 * agent ou l'Assistant travaille, statique sinon, reste AFFICHÉ EN PERMANENCE
 * dans le host — y compris quand la liste est déployée : il sert de poignée
 * d'ouverture/fermeture. Un clic sur le point déploie la liste des agents
 * (renderStaticAgentList — strictement informative, mêmes entrées que
 * l'indicateur du mode standard) à côté du point ; un second clic (sur le
 * point, ou n'importe quel item de la liste) replie. Rien n'est persisté :
 * chaque entrée en mode immersif repart repliée. Mise à jour continue via le
 * store partagé.
 * @param {HTMLElement|null} host — conteneur (détruit avec l'overlay immersif).
 * @returns {Function} désabonnement (à appeler à la sortie du mode).
 */
export function mountCollapsibleAgentList(host) {
  if (!host) return () => {};
  let expanded = false;
  const dot = (ariaExpanded, busy) => `
    <button type="button" class="sa-immersive-dot ${busy ? "breathing" : ""}" aria-expanded="${ariaExpanded}" title="${busy ? "Agents au travail — afficher la liste" : "Agents au repos — afficher la liste"}" aria-label="Agents"></button>`;
  const render = (list, busy) => {
    if (expanded) {
      // Retour 30/08 : la liste déployée réutilise le rendu EXACT des entrées
      // de la liste standard (renderStaticAgentList ≡ renderDropdown), dans un
      // panneau aux mêmes couleurs que le dropdown standard. Aucun handler
      // d'action n'est branché sur les items : cliquer une entrée n'affiche
      // aucun détail — le clic replie le résumé (strictement informatif,
      // aucune fiche, aucune ouverture d'onglet). Le point reste rendu à côté
      // : il ne disparaît JAMAIS, la liste apparaît sous/sur lui.
      host.innerHTML = `${dot("true", busy)}
    <div class="sa-immersive-agents-drop">${renderStaticAgentList(list)}</div>`;
    } else {
      host.innerHTML = dot("false", busy);
    }
  };
  // Clic sur la zone (point OU liste) → bascule point ⇆ liste. Le point restant
  // toujours rendu, un re-clic dessus sert de poignée de fermeture. Les items
  // de la liste déployée restent informatifs : le clic ne fait que replier.
  host.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded = !expanded;
    const snapshot = getAgentActivitySnapshot();
    render(snapshot.list, snapshot.busy);
  });
  // Rendu initial sans attendre le premier poll : replié (point). Tant que le
  // store n'a rien signalé, busy=false (état neutre : point éteint).
  const snapshot = getAgentActivitySnapshot();
  render(snapshot.list, snapshot.busy);
  return subscribeAgentActivity(render);
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

  // Consommation du store partagé (poll 2 s + push agent-state-changed, même
  // filtrage flattenAgents) : comportement identique à l'ancien refresh()
  // interne, sans polling propre (source unique pour tous les affichages).
  subscribeAgentActivity((list, busy) => {
    currentList = list;
    dot.classList.toggle("breathing", busy);
    dot.title = busy ? "Un agent travaille" : "Agents au repos";
    if (!dropdown.classList.contains("hidden")) {
      dropdown.innerHTML = renderDropdown(list);
    }
    if (currentCardAgent) {
      const updated = list.find(
        (a) => a.agentId === currentCardAgent.agentId && a.kind === currentCardAgent.kind
      );
      if (updated) {
        currentCardAgent = updated;
        card.innerHTML = renderCard(updated);
      }
    }
  });

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
      // ~/.pilot/assistant, aucun projet réel à activer. On ouvre son onglet via
      // son id brut ET l'espace réservé (5ᵉ argument) pour que le gestionnaire
      // d'onglets ne retombe pas sur le projet actif (tâche #140).
      tabs._openAgent(agent.label, agent.rawId, false, true, ASSISTANT_SPACE);
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
  // Le poll 2 s + le push `agent-state-changed` sont gérés par le store partagé
  // (ensureActivityStore), auquel l'indicateur vient de s'abonner.

  // Restaure l'état déplié/replié persisté (localStorage).
  if (localStorage.getItem("agent-activity-expanded") === "true") {
    dropdown.innerHTML = renderDropdown(currentList);
    dropdown.classList.remove("hidden");
  }
}
