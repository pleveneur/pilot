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
