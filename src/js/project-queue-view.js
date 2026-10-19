// project-queue-view.js — File d'attente VISIBLE d'un projet (mission 385).
//
// Compose LA file de l'utilisateur à partir des files RÉELLES qui existent déjà
// dans Pilot (aucune migration, aucun changement de logique de lancement) :
//
//  1. commandes manuelles du chat d'agent  → project-task-queue.js ;
//  2. missions de l'assistant (`run_agents`) → super-agent.js ;
//  3. délégations (`delegate_to_coder` / issue #66) → super-agent.js ;
//  4. demandes d'agents en file d'exclusivité → agents-bus.js.
//
// L'ordre affiché est l'ordre de démarrage observé : commandes manuelles, puis
// missions, puis délégations, puis agents en file. La tâche EN COURS occupe le
// rang 1, d'où « en attente (2e) » pour la première demande en attente.
//
// Ce module ne fait que LIRE (plus l'abandon explicite demandé par l'utilisateur
// via `/file vide`). Rien ici ne démarre, n'estime ou ne modifie une tâche.

import { getProjectRunLockInfo, listProjectExclusivityEntries, abandonProjectExclusivityQueues } from "./agents-bus.js";
import {
  getProjectMissionQueue,
  getProjectDelegationQueue,
  abandonProjectMissionQueue,
  abandonProjectDelegationQueue,
} from "./super-agent.js";
import {
  buildProjectQueueView,
  formatQueueReport,
  listProjectCommands,
  listProjectLaunchedCommands,
  abandonProjectCommands,
} from "./project-task-queue.js";

/**
 * Étiquettes des tâches réellement EN COURS sur le projet (source de vérité :
 * le verrou de run du bus, plus les commandes déjà lancées dont le démarrage
 * n'est pas encore confirmé).
 * @param {string} project
 * @returns {Array<{kind:string, label:string}>}
 */
function readRunningEntries(project) {
  const running = [];
  for (const command of listProjectLaunchedCommands(project)) {
    running.push({ kind: "commande", label: command.label });
  }
  let info = null;
  try {
    info = getProjectRunLockInfo(project);
  } catch (_) {
    info = null;
  }
  for (const key of (info && info.keys) || []) {
    if (key.runState !== "running" && key.runState !== "stopping") continue;
    const agents = (key.agents || []).filter(Boolean);
    if (agents.length === 0) running.push({ kind: "agent", label: "tâche en cours" });
    for (const agentId of agents) running.push({ kind: "agent", label: agentId });
  }
  return running;
}

/**
 * Vue ORDONNÉE de la file d'un projet (pure côté composition : aucune I/O).
 * @param {string} project - projet ciblé
 * @returns {{project:string, running:Array, waiting:Array, waitingCount:number, isEmpty:boolean}}
 */
export function readProjectQueueView(project) {
  const target = project || ".";
  const read = (fn, fallback) => {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  };
  return buildProjectQueueView({
    project: target,
    running: read(() => readRunningEntries(target), []),
    manual: read(() => listProjectCommands(target), []),
    missions: read(() => getProjectMissionQueue(target), []),
    delegations: read(() => getProjectDelegationQueue(target), []),
    agents: read(() => listProjectExclusivityEntries(target), []),
  });
}

/**
 * Texte de la commande `/file` pour un projet.
 * @param {string} project
 * @returns {string}
 */
export function formatProjectQueueReport(project) {
  try {
    return formatQueueReport(readProjectQueueView(project));
  } catch (_) {
    return "🧾 File d'attente du projet : indisponible pour le moment (réessayez dans un instant).";
  }
}

/**
 * Abandonne les demandes EN ATTENTE d'un projet (commande `/file vide`).
 * La tâche en cours n'est jamais arrêtée. Les décomptes par famille sont
 * retournés pour être annoncés (rien ne disparaît en silence).
 * @param {string} project
 * @returns {{commands:number, missions:number, delegations:number, agents:number}}
 */
export function abandonProjectQueue(project) {
  const target = project || ".";
  const counts = { commands: 0, missions: 0, delegations: 0, agents: 0 };
  try {
    counts.commands = abandonProjectCommands(target);
  } catch (_) {}
  try {
    counts.missions = abandonProjectMissionQueue(target);
  } catch (_) {}
  try {
    counts.delegations = abandonProjectDelegationQueue(target);
  } catch (_) {}
  try {
    counts.agents = abandonProjectExclusivityQueues(target);
  } catch (_) {}
  return counts;
}
