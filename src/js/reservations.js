// reservations.js — Fichiers réservés au codeur (orchestration multi-agents, T6).
//
// Flux d'estimation PRÉALABLE : avant de lancer un codeur via `run_agents`,
// l'assistant déclenche l'agent `plan-maker` (lecture seule, capabilities
// ["plan"]) pour obtenir un plan JSON, extrait la liste des fichiers que le
// codeur va probablement toucher, et l'écrit dans `.pilot/reservations.json`
// du projet concerné. Ce fichier est lu par l'extension `pilot-reserve-gate.ts`
// (T3) qui bloque automatiquement les `write`/`edit` des non-codeurs sur ces
// fichiers (le codeur, identifié via PILOT_AGENT_ID, n'est jamais bloqué).
//
// Estimation INFORMATIVE : fail-open. Si l'estimation échoue (plan-maker absent,
// parsing échoué, timeout, écriture impossible), on n'écrit rien et on NE BLOQUE
// PAS le lancement du codeur.
//
// Format écrit (compatible pilot-reserve-gate.ts, T3) :
//   { "coder": "<agent_id>", "files": ["src/lib.rs", ...] }

import { invoke } from "@tauri-apps/api/core";

const RESERVATIONS_FILE = ".pilot/reservations.json";
const ESTIMATION_TIMEOUT_MS = 60000; // 60 s max pour l'estimation (fail-open au-delà)

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
 *   { "coder": "<agent_id>", "files": ["src/lib.rs", ...] }
 * @param {string} coderId
 * @param {string[]} files
 * @returns {{coder: string, files: string[]}}
 */
export function buildReservations(coderId, files) {
  return {
    coder: String(coderId || ""),
    files: dedupeFiles(files),
  };
}

// ── État de suivi des projets réservés (côté frontend) ──
// Permet au bus d'agents de nettoyer les réservations à la fin de la run du
// codeur (finishAgentTurn / failAgentTurn). Module-level : persiste tant que
// l'app est ouverte. Associe chaque projet au coderId qui l'a réservé pour ne
// libérer les réservations que lorsque le bon codeur termine (pas un autre).
const reservedProjects = new Map(); // project → coderId

export function markProjectReserved(project, coderId) {
  if (project) reservedProjects.set(project, String(coderId || ""));
}

export function unmarkProjectReserved(project) {
  if (project) reservedProjects.delete(project);
}

/** Indique si le projet a des réservations écrites par l'estimation T6. */
export function isProjectReserved(project) {
  return !!project && reservedProjects.has(project);
}

/**
 * Indique si le projet a des réservations écrites POUR un codeur donné. Le
 * nettoyage n'est fait que si l'agent finissant est le codeur propriétaire.
 */
export function isProjectReservedBy(project, agentId) {
  if (!project || !agentId) return false;
  return reservedProjects.get(project) === String(agentId);
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
 * @returns {Promise<boolean>}
 */
export async function writeReservations(project, coderId, files) {
  if (!project) return false;
  try {
    const payload = JSON.stringify(buildReservations(coderId, files), null, 2);
    await invoke("write_file_content", { path: reservationsPath(project), content: payload });
    markProjectReserved(project, coderId);
    return true;
  } catch (e) {
    console.warn("[reservations] échec écriture reservations.json :", e);
    return false;
  }
}

/**
 * Supprime les réservations d'un projet (fail-open). Si le fichier n'existe
 * pas, ne fait rien. Utilisé à la fin de la run du codeur (finishAgentTurn /
 * failAgentTurn) et à l'arrêt/annulation d'un agent.
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

/**
 * Flux d'estimation préalable (T6). Si `coderIds` contient au moins un codeur,
 * lance l'agent `plan-maker` (lecture seule) sur la tâche pour obtenir un plan,
 * extrait les fichiers et écrit `.pilot/reservations.json` du projet concerné.
 * Fail-open : en cas d'échec, n'écrit rien et ne bloque pas le lancement du
 * codeur.
 *
 * `deps` est injecté par l'appelant (super-agent.js) pour éviter une dépendance
 * circulaire avec agents-bus.js : { runAgentsForAssistant, loadAgentRegistry }.
 *
 * @param {string} project - chemin absolu du projet cible
 * @param {string} task - la demande confiée au codeur
 * @param {string[]} coderIds - ids des agents codeurs de la run
 * @param {{runAgentsForAssistant: Function, loadAgentRegistry: Function}} deps
 * @returns {Promise<{reserved: boolean, coderId: string, files: string[]}>}
 */
export async function estimateAndReserve(project, task, coderIds, deps) {
  const { runAgentsForAssistant, loadAgentRegistry } = deps || {};
  const firstCoder = (Array.isArray(coderIds) ? coderIds : []).find(Boolean);
  const empty = { reserved: false, coderId: firstCoder || "", files: [] };
  if (!project || !firstCoder || !runAgentsForAssistant || !loadAgentRegistry) {
    return empty;
  }
  // plan-maker absent du registre → pas d'estimation (fail-open).
  try {
    const registry = await loadAgentRegistry();
    const hasPlanMaker = (registry.agents || []).some((a) => a && a.id === "plan-maker");
    if (!hasPlanMaker) return empty;
  } catch (_) {
    return empty;
  }
  try {
    const result = await Promise.race([
      runAgentsForAssistant([{ agentId: "plan-maker", brief: task, project }]),
      new Promise((_, rej) => setTimeout(() => rej(new Error("estimation timeout")), ESTIMATION_TIMEOUT_MS)),
    ]);
    const files = parsePlanFiles(result);
    if (files.length === 0) return empty;
    const ok = await writeReservations(project, firstCoder, files);
    return { reserved: ok, coderId: firstCoder, files };
  } catch (e) {
    console.warn("[reservations] estimation échouée (fail-open, le codeur n'est pas bloqué) :", e);
    return empty;
  }
}
