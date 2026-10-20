// agent-stop-trace.js — Journal disque du MOTIF des arrêts AUTOMATIQUES d'agents.
//
// Un arrêt automatique (boucle détectée) n'était visible que dans la console du
// frontend : le motif réel (« boucle d'outils » vs « boucle de réflexion »)
// était perdu et aucune trace ne survivait à la session. Ce module écrit une
// ligne par arrêt automatique dans `<projet>/.pilot/agent-stops.log` — même
// emplacement et même style que le journal des actions écran
// (`.pilot/screen-actions.log`, cf. screen-guard.js) — avec les commandes IPC
// existantes : aucune commande Rust nouvelle.
//
// La construction de la ligne et la rotation sont PURES et testées
// (loop-detection.js : `buildAgentStopTraceLine`, `appendAgentStopTrace`). Ici on
// ne fait que l'I/O, en FAIL-OPEN : une trace impossible à écrire ne bloque
// jamais un arrêt d'agent.
import { invoke } from "@tauri-apps/api/core";
import {
  AGENT_STOP_TRACE_RELATIVE_PATH,
  appendAgentStopTrace,
  buildAgentStopTraceLine,
} from "./loop-detection.js";

/**
 * Chemin absolu du journal des arrêts pour un projet donné (pure).
 * Le séparateur suit celui du chemin du projet (Windows `\`, POSIX `/`).
 * @param {string} projectPath
 * @returns {string} "" si le projet est inconnu (pas de journal possible)
 */
export function agentStopTracePath(projectPath) {
  const base = String(projectPath || "").replace(/[\\/]+$/, "");
  if (!base) return "";
  const sep = base.includes("\\") ? "\\" : "/";
  const rel = AGENT_STOP_TRACE_RELATIVE_PATH.split("/").join(sep);
  return base + sep + rel;
}

/**
 * Journalise le motif d'un arrêt automatique d'agent (append logique + rotation).
 *
 * Lecture puis réécriture (pas de commande d'append côté IPC) : le journal est
 * petit (une ligne par arrêt, cap 256 Ko) et les arrêts automatiques sont rares.
 *
 * @param {object} entry
 * @param {string} entry.reason - cause de l'arrêt (ex: "loop-detection")
 * @param {string} [entry.detected] - détecteur déclenché ("tool-calls", "text")
 * @param {string} [entry.agentId]
 * @param {string} [entry.projectPath]
 * @param {number|null} [entry.uid] - uid de session transmis à l'arrêt
 * @returns {Promise<boolean>} true si la ligne a été écrite
 */
export async function traceAutomaticAgentStop(entry = {}) {
  const path = agentStopTracePath(entry && entry.projectPath);
  if (!path) return false; // agent sans projet : pas de journal de projet
  try {
    // create_file crée le dossier `.pilot` parent si nécessaire ; il échoue si
    // le journal existe déjà (sans conséquence, on écrase ensuite le contenu).
    await invoke("create_file", { path }).catch(() => {});
    let existing = "";
    try {
      existing = await invoke("read_file_content", { path });
    } catch (_) {
      // Journal absent ou illisible : on repart d'un journal vide.
      existing = "";
    }
    const next = appendAgentStopTrace(existing, buildAgentStopTraceLine(entry));
    await invoke("write_file_content", { path, content: next });
    return true;
  } catch (e) {
    console.warn("[agent] motif d'arrêt automatique non journalisé:", e);
    return false;
  }
}
