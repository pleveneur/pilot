// reservations.js — Fichiers réservés au codeur (orchestration multi-agents).
//
// MISSION 381 : il n'y a PLUS d'estimation préalable automatique. Aucun agent
// (planificateur ou autre) n'est lancé d'ici et le texte d'une mission ne
// traverse jamais ce module : la seule chose écrite ici est une liste de
// CHEMINS (`.pilot/reservations.json`). Le lancement d'un agent démarre
// exactement l'agent demandé (voir `super-agent.js`, outil `run_agents`).
//
// Le fichier `.pilot/reservations.json` reste lu par l'extension
// `pilot-reserve-gate.ts` (T3) qui bloque automatiquement les `write`/`edit` des
// agents HORS de la run sur ces fichiers (les participants de la run, identifiés
// via PILOT_AGENT_ID, ne sont jamais bloqués). Il n'est plus alimenté
// automatiquement ; ses helpers restent disponibles pour une réservation
// EXPLICITE (chemins uniquement).
//
// Format écrit (compatible pilot-reserve-gate.ts, T3) :
//   { "coder": "<agent_id>", "files": ["src/lib.rs", ...], "agents": ["<agent_id>", ...],
//     "createdAt": "<ISO>", "renewedAt": "<ISO>" }
// `createdAt` / `renewedAt` (horodatage de dernier renouvellement) permettent à
// la gate de détecter un détenteur disparu : sans renouvellement depuis 10 min,
// la réservation est périmée et libérée (avec trace) au lieu de bloquer
// indéfiniment. Le renouvellement est assuré par un battement de cœur ci-dessous,
// lui-même arrêté (et la réservation libérée) dès que la run détentrice n'existe
// plus : une réservation abandonnée ne peut donc plus rester fraîche à jamais.
// `coder` = premier codeur de la run (propriétaire du nettoyage), `agents` = ids
// de TOUS les participants de la run (codeurs et spécialistes) : la gate exempte
// tout participant (fail-open — on ne bloque jamais un agent légitime de la
// run). Les agents HORS de la run restent bloqués sur les fichiers réservés.

import { invoke } from "@tauri-apps/api/core";
import { projectKey } from "./project-key.js";

const RESERVATIONS_FILE = ".pilot/reservations.json";

/**
 * Normalise un chemin pour la comparaison des réservations (séparateurs
 * uniformisés en '/'). Compatible avec pilot-reserve-gate.ts (T3).
 * @param {string} p
 * @returns {string}
 */
export function normalizeReservedPath(p) {
  return String(p || "").trim().replace(/\\/g, "/");
}

/**
 * Déduplique une liste de fichiers réservés en conservant l'ordre et en
 * normalisant les chemins. Ignore les entrées vides.
 * @param {string[]} files
 * @returns {string[]}
 */
export function dedupeFiles(files) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    const n = normalizeReservedPath(f);
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Extrait la liste des fichiers depuis le plan JSON produit par l'agent
 * plan-maker. Format attendu :
 *   {"plan": [{"files": ["src/a.rs", "src/b.rs"], ...}, ...]}
 * Le texte peut être enveloppé dans des fences markdown ```json ... ``` et/ou
 * précédé de texte (ex: le wrapper `=== Résultat de plan-maker (done) ===` du
 * bus d'agents). Retourne la liste dédupliquée des fichiers de toutes les
 * tâches, ou [] si aucun fichier n'a pu être extrait. Fail-open : en cas
 * d'erreur de parsing, retourne [].
 * @param {string} text
 * @returns {string[]}
 */
export function parsePlanFiles(text) {
  if (!text || typeof text !== "string") return [];
  let str = text.trim();
  // Retirer une éventuelle fence de code markdown (le plan-maker peut répondre
  // avec un bloc ```json ... ```).
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) str = fence[1].trim();

  // Extraire le premier objet JSON complet (le texte peut contenir du prose
  // autour, ex: le wrapper d'agrégation du bus d'agents).
  let json = null;
  const direct = tryParseJson(str);
  if (direct) {
    json = direct;
  } else {
    const m = str.match(/\{[\s\S]*\}/);
    if (m) json = tryParseJson(m[0]);
  }
  if (!json) return [];

  const plan = json && Array.isArray(json.plan) ? json.plan : [];
  const files = [];
  for (const task of plan) {
    if (task && Array.isArray(task.files)) {
      for (const f of task.files) {
        if (typeof f === "string" && f.trim()) files.push(f);
      }
    }
  }
  return dedupeFiles(files);
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/**
 * Construit l'objet reservations.json attendu par pilot-reserve-gate.ts (T3) :
 *   { "coder": "<agent_id>", "files": ["src/lib.rs", ...], "agents": [...] }
 * `coder` reste le propriétaire du nettoyage (1er codeur de la run) ; `agents`
 * liste TOUS les participants de la run (coder inclus) pour que la gate
 * n'exempte pas que le 1er codeur (fuite 3 : un second codeur légitime de la
 * même run ne devait pas être bloqué silencieusement).
 * @param {string} coderId
 * @param {string[]} files
 * @param {string[]} [participantIds] - ids de tous les agents de la run
 * @returns {{coder: string, files: string[], agents: string[]}}
 */
export function buildReservations(coderId, files, participantIds = []) {
  return {
    coder: String(coderId || ""),
    files: dedupeFiles(files),
    agents: dedupeFiles([String(coderId || ""), ...(Array.isArray(participantIds) ? participantIds : [])]),
  };
}

// ── État de suivi des projets réservés (côté frontend) ──
// Permet au bus d'agents de nettoyer les réservations à la fin de la run du
// codeur (finishAgentTurn / failAgentTurn). Module-level : persiste tant que
// l'app est ouverte. Associe chaque projet au coderId qui l'a réservé pour ne
// libérer les réservations que lorsque le bon codeur termine (pas un autre).
//
// D3 : la clé est l'identité de projet (`projectKey`, source UNIQUE de
// `project-key.js`) et NON le chemin brut. Deux écritures du même dossier
// (« G:\\IA_PL\\pilot », « g:/ia_pl/pilot », avec barre finale…) désignent donc
// le MÊME projet : une seule réservation, un seul état. Le chemin RÉEL est
// conservé dans la valeur (jamais normalisé) : c'est lui qui sert aux accès
// disque (`reservationsPath`), la normalisation n'étant qu'une clé de
// comparaison.
const reservedProjects = new Map(); // projectKey → { coderId, project: chemin réel }

// Battement de cœur des réservations : tant que la run détentrice vit, le
// fichier est réécrit (`renewedAt`) toutes les 60 s. La porte pré-écriture s'en
// sert pour distinguer un détenteur vivant d'un détenteur disparu : sans
// renouvellement depuis 10 min, la réservation est périmée et libérée avec trace.
//
// Le renouvellement est CONDITIONNÉ à la vivacité de la run (`isRunAlive`,
// sonde injectée par l'appelant). Sans ce contrôle, le minuteur survivait à sa
// run (lancement avorté, mission mise en file jamais rejouée, nettoyage manqué)
// et renouvelait indéfiniment une réservation dont l'agent n'existe plus : la
// porte ne pouvait alors JAMAIS libérer les fichiers (défaut constaté). Run
// disparue → minuteur arrêté et réservation libérée immédiatement.
const RESERVATION_HEARTBEAT_MS = 60000;
const reservationHeartbeats = new Map(); // projectKey → intervalId

function stopReservationHeartbeat(project) {
  const key = projectKey(project);
  const id = reservationHeartbeats.get(key);
  if (id) {
    clearInterval(id);
    reservationHeartbeats.delete(key);
  }
}

// Libération d'une réservation ABANDONNÉE (run détentrice disparue). Ciblée sur
// le seul projet concerné (jamais les autres réservations), silencieuse et
// fail-open : ne rejette jamais.
function releaseAbandonedReservation(project) {
  console.warn("[reservations] run détentrice disparue : réservation libérée pour", project);
  deleteReservations(project).catch(() => {});
}

function startReservationHeartbeat(project, buildPayload, isRunAlive) {
  stopReservationHeartbeat(project);
  const id = setInterval(() => {
    if (typeof isRunAlive === "function" && !isRunAlive()) {
      releaseAbandonedReservation(project);
      return;
    }
    // Fail-open : un renouvellement raté ne doit jamais casser l'app.
    invoke("write_file_content", { path: reservationsPath(project), content: buildPayload() }).catch(() => {});
  }, RESERVATION_HEARTBEAT_MS);
  id?.unref?.(); // ne pas maintenir le process Node en vie (tests)
  reservationHeartbeats.set(projectKey(project), id);
}

export function markProjectReserved(project, coderId) {
  if (project) reservedProjects.set(projectKey(project), { coderId: String(coderId || ""), project });
}

export function unmarkProjectReserved(project) {
  if (project) {
    reservedProjects.delete(projectKey(project));
    stopReservationHeartbeat(project);
  }
}

/** Indique si le projet a des réservations de fichiers actives (bail en cours). */
export function isProjectReserved(project) {
  return !!project && reservedProjects.has(projectKey(project));
}

/**
 * Indique si le projet a des réservations écrites POUR un codeur donné. Le
 * nettoyage n'est fait que si l'agent finissant est le codeur propriétaire.
 */
export function isProjectReservedBy(project, agentId) {
  if (!project || !agentId) return false;
  const entry = reservedProjects.get(projectKey(project));
  return !!entry && entry.coderId === String(agentId);
}

/** Chemin absolu du fichier de réservations d'un projet. */
export function reservationsPath(project) {
  return `${String(project || "").replace(/\/+$/, "")}/${RESERVATIONS_FILE}`;
}

/**
 * Écrit les réservations d'un projet (fail-open : ne rejette jamais, retourne
 * false en cas d'erreur). Marque le projet comme réservé pour nettoyage.
 * @param {string} project - chemin absolu du projet
 * @param {string} coderId
 * @param {string[]} files
 * @param {string[]} [participantIds] - ids de tous les agents de la run
 * @param {(() => boolean)|null} [isRunAlive] - sonde de vivacité de la run
 *   détentrice (renouvellement arrêté + libération dès qu'elle est disparue)
 * @returns {Promise<boolean>}
 */
export async function writeReservations(project, coderId, files, participantIds = [], isRunAlive = null) {
  if (!project) return false;
  try {
    const createdAt = new Date().toISOString();
    const buildPayload = () =>
      JSON.stringify(
        { ...buildReservations(coderId, files, participantIds), createdAt, renewedAt: new Date().toISOString() },
        null,
        2,
      );
    await invoke("write_file_content", { path: reservationsPath(project), content: buildPayload() });
    markProjectReserved(project, coderId);
    startReservationHeartbeat(project, buildPayload, isRunAlive);
    return true;
  } catch (e) {
    console.warn("[reservations] échec écriture reservations.json :", e);
    return false;
  }
}

/**
 * Purge TOUTES les réservations actives (map mémoire + fichiers disque) —
 * fail-open. Utilisée à l'arrêt global des runs (stopAgentsRun, fuite 1) : le
 * chemin « stopping » ignore les événements agent_end, donc finishAgentTurn ne
 * tourne jamais → sans cette purge, le fichier résiduel bloquerait les agents.
 * @returns {Promise<void>}
 */
export async function clearAllReservations() {
  // Les clés de la map sont des identités normalisées : le fichier disque doit
  // être purgé avec le chemin RÉEL mémorisé (la clé n'est pas un chemin).
  const projects = Array.from(reservedProjects.values()).map((entry) => entry.project);
  for (const project of projects) {
    await deleteReservations(project);
  }
}

/**
 * Supprime les réservations d'un projet (fail-open). Si le fichier n'existe
 * pas, ne fait rien. Utilisé à la fin de la run du codeur (finishAgentTurn /
 * failAgentTurn), à l'arrêt/annulation d'un agent et à la purge du résiduel au
 * démarrage du bus (fuite 2 : le fichier ne doit jamais survivre à un
 * rechargement de la webview).
 * @param {string} project - chemin absolu du projet
 * @returns {Promise<void>}
 */
export async function deleteReservations(project) {
  unmarkProjectReserved(project);
  if (!project) return;
  try {
    const path = reservationsPath(project);
    if (await invoke("file_exists", { path })) {
      await invoke("delete_file_or_dir", { path });
    }
  } catch (e) {
    console.warn("[reservations] échec suppression reservations.json :", e);
  }
}

// MISSION 381 — le flux d'estimation préalable automatique (`estimateAndReserve`)
// a été SUPPRIMÉ : plus aucun agent n'est lancé depuis ce module et le texte
// d'une mission ne lui est plus jamais transmis. Seuls les helpers de réservation
// de CHEMINS ci-dessus subsistent (écriture / suppression / état par projet).
