// agent-stop-trace.js — Journal disque du MOTIF des arrêts AUTOMATIQUES d'agents.
//
// Un arrêt automatique (boucle détectée, timeout d'inactivité, plafond de tours,
// libération de verrou par le watchdog, arrêt automatique Rust…) n'était visible
// que dans la console du frontend : le motif réel était perdu et aucune trace ne
// survivait à la session. Ce module écrit une ligne par arrêt automatique dans
// `<projet>/.pilot/agent-stops.log` — même emplacement et même style que le
// journal des actions écran (`.pilot/screen-actions.log`, cf. screen-guard.js) —
// avec les commandes IPC existantes : aucune commande Rust nouvelle.
//
// RÈGLE 3 : « une session ne peut pas disparaître sans trace écrite de sa raison
// d'arrêt ». Deux garanties :
//   1. REPLI GLOBAL — quand aucun chemin de projet n'est disponible (agent sans
//      projet) ou que l'écriture dans le projet échoue, la ligne est écrite dans
//      `<app_data_dir>/agent-stops.log` (même forme de ligne) au lieu d'être
//      perdue ;
//   2. NON-SILENCE — une trace qui n'a pas pu être écrite est DITE : `console.warn`
//      + rapporteur branché par l'appelant (`setAgentStopTraceFailureReporter`,
//      câblé sur `emit("notify")` dans agents-bus.js), et à défaut un événement
//      global `pilot-agent-stop-trace-failed`. Jamais de fail-open muet.
//
// La construction de la ligne et la rotation sont PURES et testées
// (loop-detection.js : `buildAgentStopTraceLine`, `appendAgentStopTrace`). Ici on
// ne fait que l'I/O, et une trace impossible à écrire ne bloque JAMAIS un arrêt
// d'agent (fail-open côté arrêt, jamais côté information).
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  AGENT_STOP_TRACE_RELATIVE_PATH,
  appendAgentStopTrace,
  buildAgentStopTraceLine,
} from "./loop-detection.js";

// Nom du journal GLOBAL de repli (racine des données de l'application).
export const GLOBAL_AGENT_STOP_TRACE_FILENAME = "agent-stops.log";

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
 * Chemin absolu du journal GLOBAL de repli, dans le répertoire de données de
 * l'application (pure) : `<app_data_dir>/agent-stops.log`.
 * @param {string} appDataDirPath - résultat de `appDataDir()`
 * @returns {string} "" si le répertoire est inconnu
 */
export function globalAgentStopTracePath(appDataDirPath) {
  const base = String(appDataDirPath || "").replace(/[\\/]+$/, "");
  if (!base) return "";
  const sep = base.includes("\\") ? "\\" : "/";
  return base + sep + GLOBAL_AGENT_STOP_TRACE_FILENAME;
}

// Rapporteur d'échec branché par l'appelant (agents-bus.js : `emit("notify")`).
// Un module ne peut pas émettre l'événement de notification de l'UI : on lui
// donne donc la fonction, et à défaut on émet un événement global.
let failureReporter = null;

// Chaîne d'écriture du journal : une trace à la fois (le journal est lu puis
// réécrit, deux écritures concurrentes perdraient une ligne).
let traceWriteChain = Promise.resolve();

/**
 * Branche le rapporteur d'échec de journalisation (idempotent, `null` pour
 * revenir au comportement par défaut). L'appelant (agents-bus.js) y branche son
 * `emit("notify")` pour que l'utilisateur VOIE qu'une trace n'a pas été écrite.
 * @param {((message: string, entry: object) => void)|null} reporter
 */
export function setAgentStopTraceFailureReporter(reporter) {
  failureReporter = typeof reporter === "function" ? reporter : null;
}

/**
 * Rend VISIBLE l'échec d'écriture d'une trace (jamais silencieux) : console +
 * rapporteur branché, ou à défaut événement global `pilot-agent-stop-trace-failed`.
 * @param {string} message - message lisible (cause de l'échec)
 * @param {object} [entry] - entrée de trace d'origine
 */
export function reportAgentStopTraceFailure(message, entry = {}) {
  const text = String(message || "");
  const e = entry || {};
  console.warn("[agent-stop-trace]", text);
  if (failureReporter) {
    try {
      failureReporter(text, e);
    } catch (_) {
      // Un rapporteur défaillant ne doit jamais faire échouer l'arrêt d'agent.
    }
    return;
  }
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.dispatchEvent === "function" &&
      typeof CustomEvent === "function"
    ) {
      window.dispatchEvent(
        new CustomEvent("pilot-agent-stop-trace-failed", {
          detail: { message: text, reason: e.reason || "unknown" },
        }),
      );
    }
  } catch (_) {
    // Environnement sans DOM (tests Node) : le console.warn ci-dessus suffit.
  }
}

/**
 * Écrit UNE ligne dans un journal (append logique + rotation). Lève en cas
 * d'échec IPC : l'appelant décide du repli.
 * @param {string} path - journal ciblé
 * @param {string} line - ligne déjà construite
 * @returns {Promise<void>}
 */
async function writeAgentStopTraceFile(path, line) {
  // create_file crée le dossier parent si nécessaire ; il échoue si le journal
  // existe déjà (sans conséquence, on écrase ensuite le contenu).
  await invoke("create_file", { path }).catch(() => {});
  let existing = "";
  try {
    existing = await invoke("read_file_content", { path });
  } catch (_) {
    // Journal absent ou illisible : on repart d'un journal vide.
    existing = "";
  }
  const next = appendAgentStopTrace(existing, line);
  await invoke("write_file_content", { path, content: next });
}

/**
 * Journalise le motif d'un arrêt automatique d'agent (append logique + rotation).
 *
 * Lecture puis réécriture (pas de commande d'append côté IPC) : le journal est
 * petit (une ligne par arrêt, cap 256 Ko) et les arrêts automatiques sont rares.
 *
 * SÉRIALISATION : le journal est LU puis RÉÉCRIT, donc deux traces concurrentes
 * (par exemple l'abandon simultané de plusieurs files par `/file vide`, qui
 * journalise une ligne par famille) lisaient la même version et la seconde
 * écriture écrasait la ligne de la première — des lignes disparaissaient sans
 * trace. Les écritures sont donc chaînées : chacune voit le journal laissé par
 * la précédente. Aucun appelant n'attend plus longtemps qu'avant (l'ordre et le
 * `await` sont conservés).
 *
 * Repli GLOBAL : sans chemin de projet, ou si l'écriture dans le projet échoue,
 * la ligne part dans `<app_data_dir>/agent-stops.log` (jamais de perte muette).
 *
 * @param {object} entry
 * @param {string} entry.reason - cause de l'arrêt (ex: "loop-detection")
 * @param {string} [entry.detected] - détecteur déclenché ("tool-calls", "text")
 * @param {string} [entry.agentId]
 * @param {string} [entry.projectPath]
 * @param {number|null} [entry.uid] - uid de session transmis à l'arrêt
 * @param {string} [entry.text] - texte DÉJÀ ÉCRIT par l'agent au moment de son
 *   arrêt (mort / plante) : il rejoint la MÊME ligne de journal, dans le champ
 *   `text=`. Aucun second journal, aucun second emplacement de traces.
 * @returns {Promise<boolean>} true si la ligne a été écrite (projet OU global)
 */
export async function traceAutomaticAgentStop(entry = {}) {
  const run = traceWriteChain.then(() => writeAgentStopTrace(entry));
  // La chaîne ne doit jamais rester rejetée (une trace en échec est déjà dite).
  traceWriteChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * Écriture RÉELLE d'une trace (exécutée une à la fois, cf. `traceWriteChain`).
 * @param {object} entry
 * @returns {Promise<boolean>}
 */
async function writeAgentStopTrace(entry = {}) {
  const e = entry || {};
  const line = buildAgentStopTraceLine(e);
  const projectLogPath = agentStopTracePath(e.projectPath);
  if (projectLogPath) {
    try {
      await writeAgentStopTraceFile(projectLogPath, line);
      return true;
    } catch (err) {
      // Le journal du projet est inaccessible : on ne perd pas la ligne, on
      // bascule sur le journal GLOBAL (et on dit pourquoi).
      console.warn("[agent-stop-trace] journal de projet non écrit :", err);
    }
  }
  let appDir = "";
  try {
    appDir = await appDataDir();
  } catch (err) {
    reportAgentStopTraceFailure(
      `Motif d'arrêt automatique non journalisé (reason=${e.reason || "unknown"}, agent=${e.agentId || "none"}) : répertoire de données de l'application introuvable (${err}).`,
      e,
    );
    return false;
  }
  const globalLogPath = globalAgentStopTracePath(appDir);
  if (!globalLogPath) {
    reportAgentStopTraceFailure(
      `Motif d'arrêt automatique non journalisé (reason=${e.reason || "unknown"}, agent=${e.agentId || "none"}) : aucun journal disponible (projet inconnu et répertoire de données vide).`,
      e,
    );
    return false;
  }
  try {
    await writeAgentStopTraceFile(globalLogPath, line);
    return true;
  } catch (err) {
    reportAgentStopTraceFailure(
      `Motif d'arrêt automatique non journalisé (reason=${e.reason || "unknown"}, agent=${e.agentId || "none"}) dans le journal GLOBAL ${globalLogPath} : ${err}`,
      e,
    );
    return false;
  }
}
