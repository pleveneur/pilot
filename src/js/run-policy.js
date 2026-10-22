// Politique d'admission des missions d'agents (lecture partagée / modification
// exclusive). Aucune I/O : la décision est calculée à partir de la nature de la
// mission, de ce qui tourne déjà SUR LE MÊME PROJET, et de la réservation GLOBALE
// du terrain (vérification/mise à jour du moteur `pi`, module
// `pi-startup-gate.js` ; mise à jour de Pilot, module `update-window.js` —
// consultés et jamais dupliqués).
//
// Règles (spécifiées par le propriétaire, non réinterprétées) :
//   - des projets différents ne se bloquent jamais (le cadrage par projet est
//     fait par l'appelant : `runningNatures` ne porte que les runs du projet
//     visé) ;
//   - sur un même projet : lecture + lecture = autorisé (missions de lecture
//     partagées) ;
//   - toute mission qui MODIFIE est exclusive : elle ne démarre pas tant que
//     quelque chose tourne sur le projet ;
//   - rien ne démarre tant qu'une mission qui MODIFIE tourne sur le projet ;
//   - rien ne démarre non plus pendant que le TERRAIN est réservé par une
//     opération GLOBALE : vérification de la version du moteur `pi` et son
//     installation (`pi-startup-gate.js`), ou mise à jour de Pilot
//     (`update-window.js`). Chacune de ces parties est portée par SON module
//     (seul propriétaire de son état) et consultée ICI, dans le gardien déjà
//     existant : une seule décision, un seul endroit.

import { isUpdateWindowReserved, updateWindowBlockedMessage } from "./update-window.js";
import { isPiStartupGateBlocking, piStartupGateMessage } from "./pi-startup-gate.js";

/** Nature d'une mission d'après le drapeau `readonly` du registre des agents. */
export function missionNature(readonly) {
  return readonly === true ? "read" : "write";
}

/**
 * Décide si une mission peut démarrer.
 * @param {"read"|"write"} nature - nature de la mission à admettre
 * @param {Array<"read"|"write">} runningNatures - natures des runs déjà en
 *   cours SUR LE MÊME PROJET (vide = rien ne tourne)
 * @returns {boolean} true si la mission peut démarrer immédiatement
 */
export function canStartMission(nature, runningNatures) {
  const running = Array.isArray(runningNatures) ? runningNatures : [];
  if (running.length === 0) return true;
  // Une modification est exclusive : jamais en parallèle de quoi que ce soit.
  if (nature === "write") return false;
  // Une lecture cohabite uniquement avec d'autres lectures.
  return running.every((n) => n === "read");
}

/**
 * Le TERRAIN est-il réservé par une opération globale ? (décideur UNIQUE :
 * aucun autre module ne recombine ces deux réservations)
 *
 *   1. vérification de la version du moteur `pi` en cours, ou son installation
 *      (`pi-startup-gate.js`) — règle du propriétaire : le travail attend la fin
 *      de la vérification, puis celle de l'installation ;
 *   2. mise à jour de Pilot (écran ouvert ou installation en cours).
 * @returns {boolean}
 */
export function isTerrainReserved() {
  return isPiStartupGateBlocking() || isUpdateWindowReserved();
}

/**
 * Motif EXACT d'un refus dû à une réservation du terrain (chaîne vide = aucune
 * réservation : le refus, s'il y en a un, vient d'une autre cause).
 * @returns {string}
 */
export function terrainReservedMessage() {
  return piStartupGateMessage() || updateWindowBlockedMessage();
}

/**
 * L'assistant peut-il ouvrir un tour de réflexion maintenant ? (décideur UNIQUE
 * de la PREMIÈRE RÉFLEXION au démarrage)
 *
 * Tant que le moteur n'a pas été vérifié — et pendant son installation — Pilot
 * ne commence pas à « réfléchir ». La même réservation vaut pour la mise à jour
 * de Pilot (aucun agent ne démarre pendant qu'elle occupe le terrain).
 * @returns {boolean}
 */
export function canAssistantReflect() {
  return !isTerrainReserved();
}

/**
 * Message affiché quand une première réflexion de l'assistant est refusée.
 * @returns {string}
 */
export function assistantReflectionBlockedMessage() {
  return terrainReservedMessage();
}

// ── Commande MANUELLE (prompt tapé dans l'interface) ───────────────────────
//
// Une commande manuelle envoyée à un agent peut MODIFIER le projet (les agents
// de codage disposent des outils d'écriture) : elle compte donc comme une
// MODIFICATION, exclusive sur le projet, quel que soit l'agent visé. Elle
// passe par la MÊME politique d'admission que les missions (`canStartMission`,
// via `isRunInProgress` côté bus) au lieu de l'ignorer.

/** Nature d'une commande manuelle : modification exclusive du projet. */
export const MANUAL_COMMAND_NATURE = "write";

/** Message utilisateur (non technique) quand la commande manuelle est refusée. */
export const MANUAL_COMMAND_BLOCKED_MESSAGE =
  "⏳ Une tâche d'agents est déjà en cours sur ce projet. Attendez la fin de cette " +
  "tâche (ou arrêtez-la) avant d'envoyer votre message : deux travaux ne peuvent " +
  "pas modifier le projet en même temps.";

/**
 * Le travail peut-il DÉMARRER maintenant ? (décideur UNIQUE du démarrage)
 *
 * Une seule fonction pour les deux familles de démarrages — mission d'agents
 * et commande manuelle — afin qu'aucun chemin ne puisse oublier une partie de
 * la règle :
 *   1. le TERRAIN est réservé par une opération globale (vérification de la
 *      version du moteur `pi` et son installation, ou mise à jour de Pilot) →
 *      refus, quel que soit l'état du projet ;
 *   2. sinon, la politique d'admission du projet tranche (`canStartMission` :
 *      lecture partagée / modification exclusive).
 * @param {string} project - projet ciblé (le verrou est PAR PROJET)
 * @param {"read"|"write"} nature - nature du travail à admettre
 * @param {function(string, {nature:string}):boolean} [isRunInProgress] - sonde
 *   du verrou d'admission du bus (agents-bus.js), injectée pour rester sans
 *   dépendance.
 * @returns {boolean} false si le travail ne doit pas démarrer maintenant
 */
export function canStartWork(project, nature, isRunInProgress) {
  if (isTerrainReserved()) return false;
  if (typeof isRunInProgress !== "function") return true;
  return !isRunInProgress(project, { nature });
}

/**
 * Message de refus d'un travail refusé, MOTIF EXACT (une seule source) :
 * vérification/installation du moteur ou fenêtre de mise à jour si le terrain
 * est réservé, sinon le message d'occupation du projet.
 * @returns {string}
 */
export function workBlockedMessage() {
  return terrainReservedMessage() || MANUAL_COMMAND_BLOCKED_MESSAGE;
}

/**
 * Une commande manuelle peut-elle être envoyée maintenant sur ce projet ?
 * @param {string} project - projet ciblé (le verrou est PAR PROJET)
 * @param {function(string, {nature:string}):boolean} isRunInProgress - sonde du
 *   verrou d'admission du bus (agents-bus.js), injectée pour rester pur.
 * @returns {boolean} false si une run tourne déjà sur le même projet
 */
export function canSendManualCommand(project, isRunInProgress) {
  // Décideur UNIQUE (`canStartWork`) : une commande manuelle est une
  // modification exclusive du projet, et elle est refusée pendant la fenêtre
  // réservée de mise à jour.
  return canStartWork(project, MANUAL_COMMAND_NATURE, isRunInProgress);
}

/**
 * Message de refus d'une commande manuelle (motif exact fourni par le
 * décideur unique `canSendManualCommand`/`canStartWork`).
 * @returns {string}
 */
export function manualCommandBlockedMessage() {
  return workBlockedMessage();
}

/**
 * Variante ASYNCHRONE de `canSendManualCommand` : elle consulte EN PLUS la
 * sonde d'ACTIVITÉ réelle de l'agent du projet (`get_project_agent_states.busy`
 * via `isProjectAgentBusy`). Indispensable car une commande manuelle n'inscrit
 * AUCUNE run dans le bus : deux commandes manuelles concurrentes sur le même
 * projet (deux onglets d'agent) seraient invisibles l'une pour l'autre avec la
 * seule sonde du bus. Mêmes règles, source de décision élargie.
 * @param {string} project - projet ciblé (le verrou est PAR PROJET)
 * @param {function(string, {nature:string}):boolean} isRunInProgress
 * @param {function(string):Promise<boolean>} [isAgentBusy] - sonde d'activité
 *   réelle de l'agent du projet (injectée pour rester sans dépendance).
 * @param {function(string):Promise<void>} [releaseStaleLock] - levée d'un verrou
 *   ORPHELIN (agent mort, tâche sans porteur) tentée AVANT de refuser
 *   l'utilisateur (mission 380). Injectée pour rester sans dépendance ; absente
 *   → comportement inchangé (refus).
 * @returns {Promise<boolean>}
 */
export async function canSendManualCommandAsync(project, isRunInProgress, isAgentBusy, releaseStaleLock) {
  // Terrain réservé (vérification/installation du moteur, ou mise à jour de
  // Pilot) : le refus est VOULU — aucune levée de verrou orphelin n'est tentée,
  // il n'y a pas de verrou en cause.
  if (isTerrainReserved()) return false;
  if (!canSendManualCommand(project, isRunInProgress)) {
    // Mission 380 : un verrou resté fermé sans porteur ne doit pas condamner la
    // saisie de l'utilisateur jusqu'au redémarrage. On tente une levée CIBLÉE
    // (le chien de garde du bus ne libère que ce qui est réellement orphelin),
    // puis on re-décide : le refus n'est affiché que si le blocage est réel.
    if (typeof releaseStaleLock !== "function") return false;
    try {
      await releaseStaleLock(project);
    } catch (_) {
      // Sonde/levée en échec : on conserve le refus (fail-closed).
      return false;
    }
    if (!canSendManualCommand(project, isRunInProgress)) return false;
  }
  if (typeof isAgentBusy !== "function") return true;
  try {
    return !(await isAgentBusy(project));
  } catch (_) {
    // Sonde en échec : on ne bloque pas l'utilisateur (fail-open borné).
    return true;
  }
}
