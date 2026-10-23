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
  removeQueuedMission,
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
 * RETRAIT CIBLE d'UNE mission de l'assistant, designee par son rang AFFICHE
 * (celui que `/file` montre : la tache en cours occupe le rang 1).
 *
 * C'est le geste qui manquait : la file ne savait oublier qu'EN ENTIER (mission
 * 385, `/file vide`). Une demande devenue sans objet gardait sa place et prenait
 * le verrou du projet a son tour (cf. `queue-order-respected` / `admission-fifo`
 * dans `.pilot/agent-stops.log`).
 *
 * Ce module reste la SEULE source de l'ordre affiche (rangs) : c'est donc ici,
 * et nulle part ailleurs, qu'un rang affiche se traduit en mission de la file.
 * Le retrait lui-meme (splice, journal, rejeu) appartient a `removeQueuedMission`.
 * @param {string} project - projet ciblé
 * @param {{rank?:number, missionId?:number, reason?:string, detected?:string}} selector
 * @returns {{ok:boolean, removed:number, id:number|null, label:string, remaining:number, reason:string, message:string}}
 */
export function removeProjectQueuedMission(project, selector = {}) {
  const target = project || ".";
  const reason = selector.reason || "queue-mission-removed";
  const detected = selector.detected || "remove-one";
  const numericMission = Number(selector.missionId);
  const hasMission = Number.isFinite(numericMission) && numericMission > 0;
  const numericRank = Number(selector.rank);
  const hasRank = Number.isFinite(numericRank) && numericRank > 0;
  if (!hasMission && !hasRank) {
    const remaining = (() => {
      try {
        return getProjectMissionQueue(target).length;
      } catch (_) {
        return 0;
      }
    })();
    return {
      ok: false,
      removed: 0,
      id: null,
      label: "",
      remaining,
      reason: "no-selector",
      message:
        "Aucune mission designee : precisez le rang affiche par /file (par exemple /file retire 2) ou le numero de mission. Rien n'a ete retire.",
    };
  }
  if (hasMission) {
    return removeQueuedMission(target, { id: Math.trunc(numericMission), reason, detected });
  }

  const rank = Math.trunc(numericRank);
  let view = null;
  try {
    view = readProjectQueueView(target);
  } catch (_) {
    view = null;
  }
  const waiting = (view && view.waiting) || [];
  const entry = waiting.find((item) => item && item.rank === rank);
  if (!entry) {
    const missionCount = (() => {
      try {
        return getProjectMissionQueue(target).length;
      } catch (_) {
        return 0;
      }
    })();
    // Le rang 1 (ou celui d'une tache lancee) est occupe par ce qui TOURNE : ce
    // n'est pas une mission en attente, et l'arreter est un autre geste.
    const runningIndex = ((view && view.running) || []).findIndex((item, i) => 1 + i === rank);
    if (runningIndex >= 0) {
      return {
        ok: false,
        removed: 0,
        id: null,
        label: "",
        remaining: missionCount,
        reason: "running",
        message: `La demande du rang ${rank} est la tache EN COURS : le retrait ne concerne que les missions EN ATTENTE. Pour l'arreter, c'est l'arret de l'agent (autre geste). Rien n'a ete retire.`,
      };
    }
    return {
      ok: false,
      removed: 0,
      id: null,
      label: "",
      remaining: missionCount,
      reason: "no-rank",
      message: `Aucune demande en attente au rang ${rank} : rien n'a ete retire. La tache EN COURS ne se retire pas par ce chemin (arreter un agent est un autre geste).`,
    };
  }
  if (entry.kind !== "mission") {
    let missions = 0;
    try {
      missions = getProjectMissionQueue(target).length;
    } catch (_) {
      missions = 0;
    }
    return {
      ok: false,
      removed: 0,
      id: null,
      label: "",
      remaining: missions,
      reason: "not-a-mission",
      message: `La demande en attente au rang ${rank} n'est pas une mission de l'Assistant (${entry.kind}) : ce geste ne retire que les missions de l'Assistant, une par une. Rien n'a ete retire.`,
    };
  }
  // Les missions de la vue sont, dans l'ordre, exactement celles de la file de
  // missions : la position parmi elles est l'index de file (1 = tete).
  const position = waiting.filter((item) => item && item.kind === "mission").indexOf(entry) + 1;
  return removeQueuedMission(target, { index: position, reason, detected });
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
