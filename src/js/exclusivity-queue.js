// exclusivity-queue.js — File d'attente d'exclusivité des spécialités par projet
// (orchestration multi-agents, T5). Fonctions pures, testables.
//
// L'exclusivité garantit qu'un seul agent de chaque spécialité (agent_id) tourne
// à la fois sur un même projet. En cas de conflit, la demande est mise en file
// d'attente (clé (project, agent_id)) et lancée automatiquement à la fin de la
// tâche en cours. Ce module expose la logique pure (clé, enqueue, dequeue,
// détection de conflit) ; le bus d'agents (agents-bus.js) l'utilise et gère le
// lancement effectif des runs.

/**
 * Clé de file d'attente pour (project, agent_id). Le séparateur U+001F (unit
 * separator) ne peut pas apparaître dans un chemin de projet : il garantit
 * l'absence de collision entre projets.
 * @param {string} project
 * @param {string} agentId
 * @returns {string}
 */
export function exclusivityKey(project, agentId) {
  return `${project}\u{1f}${agentId}`;
}

/**
 * Met une demande en file d'attente (clé (project, agent_id)). Mutate la map.
 * @param {object} queue - map clé → array d'assignments
 * @param {string} agentId
 * @param {string} project
 * @param {object} assignment - { agentId, brief, project }
 */
export function enqueueExclusivity(queue, agentId, project, assignment) {
  const key = exclusivityKey(project, agentId);
  if (!queue[key]) queue[key] = [];
  queue[key].push(assignment);
}

/**
 * Retire et retourne la demande suivante de la file pour (project, agent_id),
 * ou null si la file est vide. Mutate la map (supprime la clé si vide).
 * @param {object} queue
 * @param {string} agentId
 * @param {string} project
 * @returns {object|null}
 */
export function dequeueExclusivity(queue, agentId, project) {
  const key = exclusivityKey(project, agentId);
  const arr = queue[key];
  if (!arr || arr.length === 0) return null;
  const next = arr.shift();
  if (arr.length === 0) delete queue[key];
  return next;
}

/**
 * Indique si un agent est déjà actif sur un projet, d'après une liste de
 * sessions (mode agent_process, en train d'exécuter une tâche, même projet).
 * Fonction pure.
 * Deux agents de spécialités DIFFÉRENTES sur le même projet ne sont pas en
 * conflit (seule la même spécialité est exclusive).
 *
 * Un agent est « actif » (exclusif) s'il est `busy` (agent_start → true,
 * agent_settled → false) ET vivant. Une session vivante mais INACTIVE (settled,
 * run précédente terminée) n'est PAS exclusive : elle doit pouvoir être
 * réutilisée/redémarrée pour une nouvelle run (bug : run_agents sur un agent
 * déjà ouvert mais inactif ne démarrait pas).
 * @param {Array<{agent:string, alive:boolean, busy:boolean, mode:string, project:string}>} sessions
 * @param {string} agentId
 * @param {string} project
 * @returns {boolean}
 */
export function isAgentActiveOnProject(sessions, agentId, project) {
  return (sessions || []).some(
    (s) => s.agent === agentId && s.busy && s.alive && s.mode === "agent_process" && s.project === project
  );
}

// Chantier 6/6 (verrou fantôme) : fenêtre de grâce courte. Une session dont la
// dernière activité date de MOINS de cette durée est considérée réellement en
// activité même si busy n'est pas (encore) à true — couvre un tour qui vient de
// démarrer (agent_start pas encore propagé) et les fins de tour en vol. Au-delà,
// une session vivante mais sans travail n'est plus « une run en cours » : elle
// ne doit JAMAIS maintenir un verrou de run (faux « Une run est déjà en cours »).
export const RECENT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Pure (testable) : indique si UNE session d'agent représente un travail
 * RÉELLEMENT en cours. Un agent travaille réellement si :
 *  - busy === true (agent_start reçu, aucun agent_settled depuis), OU
 *  - sa dernière activité (lastActivity ISO) date de moins de `windowMs`.
 * Une session « vivante mais inactive » (parkée après agent_settled, oubliée)
 * ne compte PAS : un processus vivant ≠ travail en cours.
 * Fail-open anti-verrou : en cas de donnée manquante ou illisible (session
 * absente/morte, busy absent ET lastActivity absente/non parsable), retourne
 * false — jamais de verrou sur incertitude (le bug historique était un FAUX
 * verrou ; il ne faut pas créer l'inverse, un verrou oublié).
 * @param {{alive?:boolean, busy?:boolean, lastActivity?:string}|null} session
 * @param {number} [now] - timestamp de référence (ms)
 * @param {number} [windowMs] - fenêtre de grâce (défaut 2 min)
 * @returns {boolean}
 */
export function isSessionWorking(session, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS) {
  if (!session || session.alive !== true) return false;
  if (session.busy === true) return true;
  if (!session.lastActivity) return false;
  const ts = Date.parse(session.lastActivity);
  if (!Number.isFinite(ts)) return false;
  return now - ts < windowMs;
}

/**
 * Pure (testable) : indique si au moins UN des agents donnés a une session
 * VRAIMENT en activité (voir isSessionWorking). Priorité à la session
 * (agent, projet mappé) ; sinon n'importe quelle session vivante de cet agent
 * (même politique de matching que la sonde historique). Sans donnée exploitable
 * → false (fail-open) : aucun agent prouvé en activité = aucun verrou.
 * @param {Array<object>} sessions - liste des sessions (list_agent_sessions)
 * @param {Iterable<string>} agentIds - agents participants à la run
 * @param {(agentId: string) => string|null} [getAgentProject] - projet mappé
 *   d'un agent (agentProject du contexte de run) ; null si inconnu
 * @param {number} [now]
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function isAnyAgentWorking(sessions, agentIds, getAgentProject, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS) {
  const alive = (sessions || []).filter((s) => s && s.alive === true);
  for (const agentId of agentIds || []) {
    const proj = getAgentProject ? getAgentProject(agentId) : null;
    // Priorité (agent, projet) : si une session dédiée existe, c'est elle qui
    // tranche seule. Sinon (projet inconnu ou sans session dédiée), on regarde
    // n'importe quelle session vivante de l'agent (prudence, pratique historique).
    const byProject = proj ? alive.find((s) => s.agent === agentId && s.project === proj) : null;
    const candidates = byProject ? [byProject] : alive.filter((s) => s.agent === agentId);
    if (candidates.some((s) => isSessionWorking(s, now, windowMs))) return true;
  }
  return false;
}
