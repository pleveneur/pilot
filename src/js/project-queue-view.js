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
import { traceAutomaticAgentStop } from "./agent-stop-trace.js";

/**
 * RÈGLE 4 — journalise l'abandon des familles dont l'abandon est PILOTÉ ICI
 * (commandes manuelles).
 *
 * Les deux autres familles de `super-agent.js` (missions de l'assistant,
 * délégations) écrivent désormais leur propre trace DANS la fonction d'abandon
 * (`abandonProjectMissionQueue` / `abandonProjectDelegationQueue`) : elles ne
 * sont donc plus journalisées ici, sinon la même demande laisserait deux lignes
 * (double écriture). La famille « agents » porte elle aussi sa propre trace
 * (`abandonProjectExclusivityQueues`, detected=user-abandon).
 * @param {string} project - projet ciblé
 * @param {string} family - libellé lisible de la famille ("commande", …)
 * @param {string[]} labels - libellés des demandes abandonnées
 */
function journalAbandonedFamily(project, family, labels) {
  const list = (labels || []).map((l) => String(l || "")).filter(Boolean);
  if (list.length === 0) return;
  // Fail-open : un journal impossible à écrire ne doit pas empêcher l'abandon
  // (sa trace d'échec est déjà dite par `agent-stop-trace`).
  traceAutomaticAgentStop({
    reason: "queue-abandoned",
    detected: "file-vide",
    agentId: "",
    projectPath: project || "",
    detail: `${list.length} ${family}(s) en file : ${list.join(" · ")}`.slice(0, 300),
  }).catch(() => {});
}

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
  // Nommer AVANT de vider (règle 4 : rien ne disparaît en silence).
  const labelsOf = (read) => {
    try {
      return (read() || []).map((entry) => String((entry && entry.label) || "")).filter(Boolean);
    } catch (_) {
      return [];
    }
  };
  const pendingCommands = labelsOf(() => listProjectCommands(target));
  try {
    counts.commands = abandonProjectCommands(target);
  } catch (_) {}
  try {
    // `abandonProjectMissionQueue` journalise ELLE-MÊME l'abandon (règle 4) :
    // aucune trace n'est écrite ici, sous peine de double écriture.
    counts.missions = abandonProjectMissionQueue(target, { detected: "file-vide" });
  } catch (_) {}
  try {
    // Idem pour les délégations : la trace appartient à la fonction d'abandon.
    counts.delegations = abandonProjectDelegationQueue(target, { detected: "file-vide" });
  } catch (_) {}
  try {
    // Famille « agents » : `abandonProjectExclusivityQueues` journalise et
    // annonce déjà ses libellés (detected=user-abandon).
    counts.agents = abandonProjectExclusivityQueues(target);
  } catch (_) {}
  journalAbandonedFamily(target, "commande", pendingCommands);
  return counts;
}
