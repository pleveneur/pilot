// screen-guard.js — Garde-fous du CONTRÔLE DE L'ÉCRAN par les agents (cœur PUR).
//
// Un serveur MCP « écran » (capture d'écran, clavier, souris) peut piloter la
// machine : ces fonctions décident, pour CHAQUE action, si elle doit être
// refusée, soumise à confirmation ou simulée, et écrivent une ligne de journal
// lisible (sans contenu sensible).
//
// Module PUR (aucune I/O, aucun appel Tauri, aucun import Node) : il est utilisé
//   - par `src/js/settings.js` (réglages) et `src/js/agent-pi.js` (dialogue),
//   - par `src-tauri/extensions/mcp-client.src.ts` (porte d'exécution), le
//     bundler esbuild l'inlinant dans le fichier généré `pilot-mcp-client.ts`.
// Testé directement par `src/js/screen-guard.test.js`.

/** Clé du message sentinel d'une demande de confirmation d'action sur l'écran.
 *  Le frontend (agent-pi.js) reconnaît ce préfixe pour afficher un dialogue
 *  dédié et répondre `{ confirmed, cancelled }` — voir la note sur le contrat
 *  RPC `confirm` de pi (une réponse sans `confirmed` est lue comme un refus). */
export const SCREEN_GATE_SENTINEL = "PILOT_SCREEN_GATE::";

/** Réglages par défaut : contrôle ACTIVÉ (défaut demandé), mais en mode
 *  SIMULATION — état sûr : rien n'est réellement exécuté sur l'écran tant que
 *  l'utilisateur n'a pas explicitement basculé en mode réel. */
export const DEFAULT_SCREEN_GUARD = Object.freeze({
  enabled: true,
  simulation: true,
  emergencyStop: false,
});

/** Issue d'une action : `refuse` (rien ne part), `confirm` (demander), ou
 *  l'action est autorisée une fois la confirmation obtenue. */
export const SCREEN_OUTCOME = Object.freeze({
  REFUSE: "refuse",
  CONFIRM: "confirm",
});

/** Libellés du journal (lisibles par un non-spécialiste). */
export const SCREEN_JOURNAL_ACCEPTED = "accepté";
export const SCREEN_JOURNAL_REFUSED = "refusé";
export const SCREEN_JOURNAL_SIMULATED = "simulé";

// ── Messages renvoyés à l'agent (jamais de contenu sensible) ──

export const SCREEN_DISABLED_MESSAGE =
  "Action sur l'écran refusée : le contrôle de l'écran par les agents est désactivé " +
  "(Options → Serveurs MCP).";

export const SCREEN_EMERGENCY_MESSAGE =
  "Action sur l'écran refusée : l'arrêt d'urgence du contrôle de l'écran est actif. " +
  "Rétablissez le contrôle (Options → Serveurs MCP) pour le réautoriser.";

export const SCREEN_REFUSED_MESSAGE = "Action sur l'écran refusée par l'utilisateur.";

export const SCREEN_SIMULATION_MESSAGE =
  "Action simulée (mode simulation) : rien n'a été exécuté réellement sur l'écran. " +
  "Désactivez le mode simulation (Options → Serveurs MCP) pour autoriser une action réelle.";

export const SCREEN_NO_UI_MESSAGE =
  "Action sur l'écran refusée : session autonome sans interface pour confirmer l'action.";

/**
 * Lit les réglages du contrôle de l'écran depuis le contenu d'un `config.json`.
 * Tolérant (fail-safe) : un contenu illisible ou un champ absent retombe sur les
 * défauts, c'est-à-dire contrôle activé mais en **simulation**.
 * @param {string} text — contenu du fichier de configuration Pilot
 * @returns {{enabled: boolean, simulation: boolean, emergencyStop: boolean}}
 */
export function parseScreenGuard(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || "{}"));
  } catch (_) {
    return { ...DEFAULT_SCREEN_GUARD };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SCREEN_GUARD };
  return {
    // Champ absent ⇒ activé (le contrôle est activé par défaut).
    enabled: raw.screen_control_enabled !== false,
    // Champ absent ⇒ simulation (état sûr).
    simulation: raw.screen_control_simulation !== false,
    // Champ absent ⇒ pas d'arrêt d'urgence.
    emergencyStop: raw.screen_control_emergency_stop === true,
  };
}

/**
 * Vrai si le serveur MCP est un serveur de contrôle de l'écran : drapeau
 * explicite, ou détection de secours sur le nom / la commande (couvre une
 * configuration déjà en place avant l'ajout du drapeau). Sur-inclure ne peut
 * qu'ajouter des confirmations — jamais en retirer.
 * @param {{screen?: boolean, name?: string, command?: string}} server
 * @returns {boolean}
 */
export function isScreenServer(server) {
  if (!server) return false;
  if (server.screen === true) return true;
  const name = String(server.name || "");
  const command = String(server.command || "");
  return /screen|écran|ecran/i.test(name) || /screenmcp/i.test(command);
}

/**
 * Vrai si le nom d'outil appartient au serveur donné (outils MCP nommés
 * `mcp_<serverId>_<outil>`).
 * @param {string} toolName
 * @param {string} serverId
 * @returns {boolean}
 */
export function isScreenTool(toolName, serverId) {
  const t = String(toolName || "");
  const id = String(serverId || "");
  if (!t || !id) return false;
  return t.startsWith(`mcp_${id}_`);
}

/**
 * Décide du sort d'une action sur l'écran, AVANT toute exécution.
 *
 * Aucune autorisation permanente n'existe : l'issue n'est jamais « autorisé »
 * d'office. Un contrôle désactivé ou un arrêt d'urgence (relus en direct à
 * chaque action) refusent immédiatement ; sinon la confirmation est demandée.
 * Le mode simulation ne dispense PAS de la confirmation : il bloque ensuite
 * l'exécution réelle (`simulated: true`).
 * @param {{enabled?: boolean, simulation?: boolean, emergencyStop?: boolean}|null} guard
 * @returns {{action: string, reason: string, simulated: boolean}}
 */
export function screenGateOutcome(guard) {
  const g = guard || {};
  if (g.enabled !== true) {
    return { action: SCREEN_OUTCOME.REFUSE, reason: SCREEN_DISABLED_MESSAGE, simulated: false };
  }
  if (g.emergencyStop === true) {
    return { action: SCREEN_OUTCOME.REFUSE, reason: SCREEN_EMERGENCY_MESSAGE, simulated: false };
  }
  return { action: SCREEN_OUTCOME.CONFIRM, reason: "", simulated: g.simulation === true };
}

/** Clés de paramètres dont la valeur ne doit JAMAIS être journalisée : elles
 *  peuvent contenir du texte saisi, un mot de passe ou un jeton. */
const SENSITIVE_KEY_RE = /pass|secret|token|api[_-]?key|credential|auth|text|content|payload|value/i;
/** Longueur au-delà de laquelle une valeur textuelle est masquée dans le journal. */
const MAX_JOURNAL_VALUE = 40;
/** Longueur maximale du détail journalisé. */
const MAX_JOURNAL_DETAIL = 200;
/** Marque d'un détail vide (la ligne garde ainsi ses quatre champs). */
export const SCREEN_JOURNAL_EMPTY_DETAIL = "-";

/** Masque les valeurs sensibles repérées par leur clé. Fonction pure interne. */
function redactValue(value, key, depth) {
  if (SENSITIVE_KEY_RE.test(String(key))) return "[masqué]";
  if (typeof value === "string") {
    return value.length > MAX_JOURNAL_VALUE
      ? `[masqué: ${value.length} car.]`
      : value;
  }
  if (Array.isArray(value)) {
    return depth > 0 ? value.map((v) => redactValue(v, "", depth - 1)) : `[${value.length} élément(s)]`;
  }
  if (value && typeof value === "object") {
    return depth > 0 ? redactObject(value, depth - 1) : "[objet]";
  }
  return value;
}

function redactObject(obj, depth) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = redactValue(v, k, depth);
  return out;
}

/**
 * Résume les paramètres d'une action pour le journal : les valeurs sensibles
 * (texte saisi, mots de passe, jetons) sont masquées et les textes longs
 * tronqués. Ne renvoie JAMAIS le texte tapé.
 * @param {unknown} input — paramètres de l'outil MCP
 * @returns {string}
 */
export function summarizeScreenAction(input) {
  let text;
  try {
    if (!input || typeof input !== "object") return "";
    text = JSON.stringify(redactObject(input, 2));
  } catch (_) {
    return "[paramètres illisibles]";
  }
  if (!text || text === "{}") return "";
  return text.length > MAX_JOURNAL_DETAIL ? text.slice(0, MAX_JOURNAL_DETAIL) + "…" : text;
}

/**
 * Horodatage local lisible `AAAA-MM-JJ HH:MM:SS`. La date est injectable pour
 * être testable.
 * @param {Date} [date]
 * @returns {string}
 */
export function formatScreenTimestamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Construit une ligne de journal lisible :
 * `2026-10-08 14:03:22  mcp-2_capture_screen  accepté  {"monitor":1}`
 * Champs séparés par DEUX espaces (l'horodatage en contient un seul). Un détail
 * vide s'écrit `-` pour que la ligne garde TOUJOURS ses quatre champs (sans
 * quoi elle ne serait plus relisible).
 * @param {{at?: string, tool?: string, outcome?: string, detail?: string}} entry
 * @returns {string}
 */
export function formatScreenJournalLine(entry) {
  const e = entry || {};
  const at = e.at || formatScreenTimestamp();
  const tool = String(e.tool || "?");
  const outcome = String(e.outcome || "?");
  const detail = String(e.detail || "").replace(/\s+/g, " ").trim() || SCREEN_JOURNAL_EMPTY_DETAIL;
  return `${at}  ${tool}  ${outcome}  ${detail}`;
}

/**
 * Relit une ligne du journal (inverse de `formatScreenJournalLine`). Retourne
 * `null` si la ligne n'a pas le format attendu (ligne vide, en-tête, texte
 * ajouté à la main…).
 * @param {string} line
 * @returns {{at: string, tool: string, outcome: string, detail: string}|null}
 */
export function parseScreenJournalLine(line) {
  const s = String(line || "").trimEnd();
  if (!s) return null;
  const parts = [];
  let rest = s;
  for (let i = 0; i < 3; i++) {
    const idx = rest.indexOf("  ");
    if (idx < 0) return null;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  parts.push(rest);
  const [at, tool, outcome, detail] = parts;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at)) return null;
  if (
    outcome !== SCREEN_JOURNAL_ACCEPTED &&
    outcome !== SCREEN_JOURNAL_REFUSED &&
    outcome !== SCREEN_JOURNAL_SIMULATED
  ) {
    return null;
  }
  return { at, tool, outcome, detail: detail === SCREEN_JOURNAL_EMPTY_DETAIL ? "" : detail };
}

/**
 * Lit un journal complet et ne garde que les lignes compréhensibles, de la plus
 * récente à la plus ancienne (pour l'affichage).
 * @param {string} text
 * @param {number} [max]
 * @returns {{at: string, tool: string, outcome: string, detail: string}[]}
 */
export function parseScreenJournal(text, max = 200) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const entry = parseScreenJournalLine(line);
    if (entry) out.push(entry);
  }
  return out.slice(-Math.max(1, max)).reverse();
}

/** Chemin du journal des actions écran, dans un projet donné. */
export const SCREEN_JOURNAL_RELATIVE_PATH = ".pilot/screen-actions.log";
