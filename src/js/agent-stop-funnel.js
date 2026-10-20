// agent-stop-funnel.js — ENTONNOIR UNIQUE des arrêts AUTOMATIQUES d'agents.
//
// RÈGLE 3 du projet : « une session ne peut pas disparaître sans trace écrite de
// sa raison d'arrêt ». La règle était tenue site par site (chaque chemin d'arrêt
// écrivait sa propre trace juste avant d'appeler l'IPC d'arrêt). Conséquence :
// un NOUVEAU chemin d'arrêt ajouté sans trace passait inaperçu — la règle ne se
// défendait que par la vigilance et par un test d'analyse de source.
//
// Cet entonnoir renverse la charge : il n'y a plus qu'UN SEUL point de passage
// pour arrêter automatiquement un agent. `stopAgentWithTrace` écrit d'abord le
// motif (journal `<projet>/.pilot/agent-stops.log`, repli global — mécanique de
// `agent-stop-trace.js`), PUIS exécute l'arrêt demandé. Les sites d'arrêt
// automatique ne choisissent donc plus « trace ou pas trace » : ils décrivent
// leur motif et fournissent l'action d'arrêt.
//
// GARANTIES (dans cet ordre) :
//   1. la trace est écrite AVANT l'arrêt (`await` strict : l'ordre est observable
//      sur un faux `invoke`, cf. `agent-stop-funnel.test.js`) ;
//   2. l'arrêt n'est JAMAIS bloqué par la journalisation : une trace impossible
//      n'empêche pas de stopper (fail-open côté arrêt, jamais côté information) ;
//   3. un motif ou un détecteur absent est une faute d'appel : elle est DITE
//      (`reportAgentStopTraceFailure`) au lieu de produire une ligne inutile, et
//      l'arrêt a quand même lieu.
//
// Le module porte aussi le DÉTECTEUR PUR (`scanAutomaticStopSites`) qui recense
// les sites d'arrêt automatique d'une source et repère ceux qui ne passent pas
// par l'entonnoir : c'est lui que le test de non-régression applique à
// `agents-bus.js`, et c'est lui qu'on éprouve en lui injectant un site muet.
import {
  reportAgentStopTraceFailure,
  traceAutomaticAgentStop,
} from "./agent-stop-trace.js";

/**
 * Commandes IPC qui arrêtent un agent (arrêt automatique). Toute apparition de
 * l'une d'elles dans une source est un SITE D'ARRÊT à examiner.
 * @type {readonly string[]}
 */
export const AUTOMATIC_STOP_COMMANDS = Object.freeze([
  "abort_agent_process",
  "stop_agent_process",
  "stop_agent_session",
]);

/**
 * Nom du mécanisme d'arrêt de RUN (arrêt de tous les agents d'une run). Il est
 * lui aussi un site terminal : un appel direct hors entonnoir est un arrêt
 * potentiellement muet.
 */
export const STOP_RUN_MECHANISM = "stopAgentsRun";

// Marqueur des arrêts VOLONTAIRES (bouton « tout arrêter », action utilisateur) :
// ils ne sont pas automatiques et n'ont donc pas de ligne de journal. Un site
// n'a le droit d'y échapper que s'il porte ce marqueur, de façon NOMMÉE.
export const MANUAL_STOP_MARKER = "R3-EXCEPTION-MANUEL";

/**
 * Arrête un agent AUTOMATIQUEMENT, en écrivant d'abord le motif de l'arrêt.
 *
 * L'ordre est garanti et observable : la ligne de journal est écrite (et
 * attendue) AVANT que `stop` ne soit exécuté. Fail-open côté arrêt : si la
 * journalisation échoue (ou si le motif est incomplet), `stop` est exécuté
 * quand même — l'échec de trace, lui, est déjà signalé (rapporteur branché par
 * le bus sur `emit("notify")`, repli global, à défaut événement).
 *
 * @param {object} options
 * @param {string} options.reason - motif de l'arrêt (LITTÉRAL au site d'appel)
 * @param {string} options.detected - détecteur à l'origine de l'arrêt (LITTÉRAL)
 * @param {string} [options.agentId] - agent arrêté
 * @param {string|null} [options.projectPath] - projet de l'agent (journal local)
 * @param {number|null} [options.uid] - uid de session transmis à l'arrêt
 * @param {string} [options.detail] - précision libre (champ `detail=` du journal)
 * @param {() => any} options.stop - action d'arrêt (garde de propriété INCHANGÉE)
 * @returns {Promise<{traced: boolean, stopped: boolean}>}
 *   `traced` : la ligne de journal a été écrite (projet ou journal global) ;
 *   `stopped` : l'action d'arrêt s'est exécutée sans lever.
 */
export async function stopAgentWithTrace({
  reason,
  detected,
  agentId = "",
  projectPath = "",
  uid = null,
  detail = "",
  stop,
} = {}) {
  const why = typeof reason === "string" ? reason.trim() : "";
  const how = typeof detected === "string" ? detected.trim() : "";
  let traced = false;

  if (why && how) {
    try {
      traced = (await traceAutomaticAgentStop({
        reason: why,
        detected: how,
        agentId,
        projectPath,
        uid,
        detail,
      })) === true;
      // `traceAutomaticAgentStop` signale déjà ses propres échecs (rapporteur,
      // repli global) : on ne double pas le message ici.
    } catch (err) {
      // Défense en profondeur : même si la journalisation lève, l'arrêt a lieu.
      traced = false;
      reportAgentStopTraceFailure(
        `Motif d'arrêt automatique non journalisé (reason=${why}, agent=${agentId || "none"}) : ${err}`,
        { reason: why, agentId },
      );
    }
  } else {
    reportAgentStopTraceFailure(
      `Motif d'arrêt automatique incomplet — trace impossible (reason="${why}", detected="${how}", agent=${agentId || "none"}).`,
      { reason: why || "unknown", agentId },
    );
  }

  // L'arrêt n'est jamais conditionné par la journalisation (fail-open).
  let stopped = false;
  if (typeof stop === "function") {
    try {
      await stop();
      stopped = true;
    } catch (_) {
      // Les sites d'arrêt du bus étouffent déjà leurs erreurs (`.catch(()=>{})`) :
      // une erreur d'arrêt n'a jamais interrompu une run.
      stopped = false;
    }
  }
  return { traced, stopped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur PUR : sites d'arrêt automatique d'une source et contournements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Positions de toutes les occurrences d'une expression régulière globale.
 * @param {string} src
 * @param {RegExp} re - expression GLOBALE
 * @returns {number[]}
 */
function positionsOf(src, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) out.push(m.index);
  return out;
}

/**
 * Paires d'accolades ouvrantes/fermantes (comptage lexique), pour délimiter un
 * bloc de fonction sans dépendre de la distance dans le fichier.
 * @param {string} src
 * @returns {Array<[number, number]>}
 */
function bracePairs(src) {
  const stack = [];
  const pairs = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") stack.push(i);
    else if (src[i] === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.push([open, i]);
    }
  }
  return pairs;
}

const FUNCTION_HEADER_RE = /^[ \t]*(?:export\s+)?(?:async\s+)?function[ \t]+[A-Za-z0-9_$]+/m;

/**
 * L'accolade `open` appartient-elle à un EN-TÊTE DE FONCTION ? (en-tête sur une
 * ligne, fonction fléchée affectée, ou signature répartie sur plusieurs lignes)
 * @param {string} src
 * @param {number} open
 * @returns {boolean}
 */
function isFunctionHeader(src, open) {
  const lineStart = src.lastIndexOf("\n", open) + 1;
  const header = src.slice(lineStart, open + 1).trim();
  if (/^(?:export\s+)?(?:async\s+)?function\b/.test(header)) return true;
  if (/=>\s*\{$/.test(header)) return true;
  if (header === "{" || header === "") {
    const back = src.slice(Math.max(0, open - 2000), open);
    const idx = back.search(FUNCTION_HEADER_RE);
    if (idx >= 0 && !/[;{}]/.test(back.slice(idx))) return true;
  }
  return false;
}

/**
 * Bloc lexical de la fonction (la plus interne) qui contient `site`.
 * @param {string} src
 * @param {Array<[number, number]>} pairs
 * @param {number} site
 * @returns {{start:number, end:number}|null}
 */
function enclosingFunctionBlock(src, pairs, site) {
  const candidates = pairs
    .filter(([open, close]) => open < site && site < close && isFunctionHeader(src, open))
    .sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
  if (!candidates.length) return null;
  return { start: candidates[0][0], end: candidates[0][1] };
}

/** Numéro de ligne (1-indexé) d'une position. */
function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * Recense les SITES D'ARRÊT AUTOMATIQUE d'une source et dit, pour chacun, s'il
 * passe par l'entonnoir (trace de motif AVANT l'arrêt, dans son bloc), s'il est
 * une exception MANUELLE déclarée, ou s'il est MUET (contournement de la règle 3).
 *
 * Pure : aucune I/O, aucun accès au DOM — utilisable sur le source réel comme
 * sur une copie modifiée en mémoire (contrôle négatif du test).
 *
 * @param {string} source - contenu d'un fichier JS
 * @param {{maxDistance?: number, exceptionWindow?: number}} [options]
 * @returns {{sites: Array<object>, untraced: Array<object>, total: number, funneled: number, exceptions: number}}
 */
export function scanAutomaticStopSites(source, options = {}) {
  const src = String(source || "").replace(/\r\n/g, "\n");
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : 1600;
  const exceptionWindow = Number.isFinite(options.exceptionWindow) ? options.exceptionWindow : 700;
  const pairs = bracePairs(src);
  const funnelCalls = positionsOf(src, /\bstopAgentWithTrace\s*\(/g);

  const raw = [];
  for (const cmd of AUTOMATIC_STOP_COMMANDS) {
    for (const index of positionsOf(src, new RegExp(`invoke\\("${cmd}"`, "g"))) {
      raw.push({ kind: cmd, index });
    }
  }
  for (const index of positionsOf(src, /\bstopAgentsRun\s*\(/g)) {
    // La DÉFINITION n'est pas un site d'appel.
    const head = src.slice(Math.max(0, index - 40), index);
    if (/(?:async\s+)?function\s+$/.test(head)) continue;
    raw.push({ kind: STOP_RUN_MECHANISM, index });
  }
  raw.sort((a, b) => a.index - b.index);

  const sites = raw.map((site) => {
    const block = enclosingFunctionBlock(src, pairs, site.index);
    const blockStart = block ? block.start : 0;
    // Un site est « entonnoiré » quand il est DANS LA MÊME INSTRUCTION qu'un
    // appel `stopAgentWithTrace` (le site est alors la fermeture `stop:`), et
    // dans la même fonction. La règle « aucun `;` entre les deux » évite le faux
    // positif d'un site MANUEL situé quelques lignes après un arrêt tracé : sans
    // elle, la proximité suffisait à faire passer un contournement pour couvert.
    const candidates = funnelCalls.filter(
      (t) => t > blockStart && t < site.index && site.index - t <= maxDistance,
    );
    const nearestFunnel = candidates.length ? Math.max(...candidates) : -1;
    const funneled = nearestFunnel >= 0 && !src.slice(nearestFunnel, site.index).includes(";");
    const exception =
      !funneled &&
      src
        .slice(Math.max(0, site.index - exceptionWindow), site.index)
        .includes(MANUAL_STOP_MARKER);
    return {
      ...site,
      line: lineOf(src, site.index),
      funneled,
      exception,
      untraced: !funneled && !exception,
    };
  });

  const untraced = sites.filter((s) => s.untraced);
  return {
    sites,
    untraced,
    total: sites.length,
    funneled: sites.filter((s) => s.funneled).length,
    exceptions: sites.filter((s) => s.exception).length,
  };
}

/**
 * Sites d'arrêt automatique qui NE passent PAS par l'entonnoir (et ne sont pas
 * des exceptions manuelles déclarées) : le contrôle de non-régression de la
 * règle 3 s'appuie dessus.
 * @param {string} source
 * @param {object} [options] - voir `scanAutomaticStopSites`
 * @returns {Array<object>}
 */
export function findUnfunneledAutomaticStops(source, options = {}) {
  return scanAutomaticStopSites(source, options).untraced;
}
