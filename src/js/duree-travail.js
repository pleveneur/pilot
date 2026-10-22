// duree-travail.js — Durée d'un travail EN COURS (fonctions PURES)
//
// Problème résolu (rapport `.pilot/rapports/rapport-diagnostic-attente-silencieuse.md`) :
// l'affichage traitait une commande longue comme un événement INSTANTANÉ (début →
// fin). Pendant dix minutes de compilation, aucune surface ne pouvait donc prouver
// que le travail avançait : aucune durée n'existait nulle part dans l'application.
//
// Ce module fournit la seule brique manquante — la DURÉE, calculée à partir d'un
// horodatage de début — et les libellés HONNÊTES qui l'accompagnent. Aucune I/O,
// aucun DOM, aucun accès au moteur : uniquement du calcul et du formatage, donc
// testable directement (voir `duree-travail.test.js`).
//
// Aucun de ces libellés n'invente un état : ils décrivent un intervalle daté.

/** Libellé de repos, quand RIEN ne travaille. */
export const STATUS_IDLE = "Prêt";

/**
 * Libellé de l'activité du MODÈLE (et non d'une commande externe). Conservé mot
 * pour mot : c'est le libellé historique de l'onglet agent.
 */
export const STATUS_THINKING = "🤔 Réflexion...";

/**
 * Formate une durée en clair : « 42 s », « 3 min 12 s », « 1 h 05 min 07 s ».
 * Les secondes sont toujours affichées pour une durée < 1 h (le compteur doit
 * AVANCER visiblement) ; au-delà, minutes et secondes sont complétées à 2 chiffres.
 * @param {number} ms durée en millisecondes (valeur négative ou invalide → « 0 s »).
 * @returns {string}
 */
export function formatElapsed(ms) {
  const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h} h ${pad(m)} min ${pad(sec)} s`;
  if (m > 0) return `${m} min ${pad(sec)} s`;
  return `${sec} s`;
}

/**
 * Formate une durée en version COMPACTE pour les panneaux étroits :
 * « 42 s », « 3 min », « 1 h 05 min ». La granularité fine (secondes) n'y est pas
 * nécessaire : le rafraîchissement des panneaux est de 2 s.
 * @param {number} ms
 * @returns {string}
 */
export function shortElapsed(ms) {
  const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h} h ${String(m).padStart(2, "0")} min`;
  }
  if (total >= 60) return `${Math.floor(total / 60)} min`;
  return `${total} s`;
}

/**
 * Ligne datée de la fiche d'agent : « En cours depuis 3 min 12 s ».
 * Retourne `null` quand aucun début n'est connu (rien à dater → rien à afficher :
 * jamais une durée inventée).
 * @param {number} sinceTs horodatage (ms epoch) du début du travail.
 * @param {number} [nowTs] instant de référence (défaut : maintenant).
 * @returns {string|null}
 */
export function formatWorkingSince(sinceTs, nowTs) {
  const since = Number(sinceTs);
  if (!since || !Number.isFinite(since)) return null;
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  return `En cours depuis ${formatElapsed(now - since)}`;
}

/**
 * Version courte pour le volet des missions (bas à droite) : « depuis 3 min ».
 * @param {number} sinceTs
 * @param {number} [nowTs]
 * @returns {string|null}
 */
export function formatWorkingSinceShort(sinceTs, nowTs) {
  const since = Number(sinceTs);
  if (!since || !Number.isFinite(since)) return null;
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  return `depuis ${shortElapsed(now - since)}`;
}

/**
 * Libellé HONNÊTE de l'état d'un agent, décidé en UN seul endroit (fonction PURE).
 *
 * Règle : quand une COMMANDE tourne, le libellé dit quelle commande et depuis
 * combien de temps — jamais « Prêt », jamais « Réflexion… » (le modèle n'est pas
 * en train de réfléchir, il attend un programme externe).
 *
 * @param {object} [input]
 * @param {boolean} [input.toolInProgress] une commande tourne (marqueur de supervision).
 * @param {string} [input.toolName] nom de l'outil en cours (« bash »…).
 * @param {number} [input.toolStartedAt] début LOCAL de la commande (ms epoch, 0 = inconnu).
 * @param {boolean} [input.processing] l'agent traite une réponse (running/compacting).
 * @param {string} [input.prefix] préfixe de rôle (mode Orchestration).
 * @param {number} [input.now] instant de référence.
 * @returns {{text: string, className: string, working: boolean}}
 */
export function resolveAgentStatus(input) {
  const o = input || {};
  const pre = o.prefix || "";
  const startedAt = Number(o.toolStartedAt) || 0;
  const running = o.toolInProgress === true || startedAt > 0;
  if (running) {
    const name = o.toolName ? String(o.toolName) : "commande";
    const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now();
    const dur = startedAt > 0 ? ` (${formatElapsed(now - startedAt)})` : "";
    return {
      text: `${pre}⏳ ${name} en cours…${dur}`,
      className: "agent-status agent-status-streaming",
      working: true,
    };
  }
  if (o.processing === true) {
    return {
      text: `${pre}${STATUS_THINKING}`,
      className: "agent-status agent-status-streaming",
      working: true,
    };
  }
  return { text: STATUS_IDLE, className: "agent-status agent-status-idle", working: false };
}

/** Nombre maximum de lignes de sortie en direct conservées (les DERNIÈRES). */
export const LIVE_OUTPUT_MAX_LINES = 10;
/** Nombre maximum de caractères de sortie en direct conservés. */
export const LIVE_OUTPUT_MAX_CHARS = 2000;

/**
 * Réduit la sortie EN DIRECT d'une commande à un extrait affichable : les
 * DERNIÈRES lignes (ce qui vient de se passer), plafonnées en lignes et en
 * caractères. Les retours chariot Windows sont normalisés.
 *
 * La coupe se fait toujours par la FIN : on garde ce qui est arrivé le plus
 * récemment. Un extrait coupé est précédé de « … » pour ne pas faire croire à un
 * début de sortie.
 *
 * @param {unknown} text sortie brute (`partialResult` de `tool_execution_update`).
 * @param {number} [maxLines] défaut `LIVE_OUTPUT_MAX_LINES`.
 * @param {number} [maxChars] défaut `LIVE_OUTPUT_MAX_CHARS`.
 * @returns {string} extrait, ou `""` s'il n'y a rien à montrer.
 */
export function clipLiveOutput(text, maxLines, maxChars) {
  if (typeof text !== "string" || !text) return "";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const limitLines = Number(maxLines) > 0 ? Number(maxLines) : LIVE_OUTPUT_MAX_LINES;
  const limitChars = Number(maxChars) > 0 ? Number(maxChars) : LIVE_OUTPUT_MAX_CHARS;
  const keptLines = lines.slice(-limitLines);
  let out = keptLines.join("\n");
  if (Array.from(out).length > limitChars) {
    out = Array.from(out).slice(-limitChars).join("");
  }
  if (!out.trim()) return "";
  // Préfixe « … » quand quelque chose a été retiré (fin de sortie seulement).
  const truncated = keptLines.length < lines.length || Array.from(keptLines.join("\n")).length > limitChars;
  return truncated ? "…\n" + out : out;
}

/**
 * Extrait le texte affichable d'une charge `tool_execution_update`.
 * Le champ utile est `partialResult` ; selon les moteurs et les outils il porte
 * une chaîne ou un objet (`output`, `stdout`, `text`, `content`). Aucune valeur
 * n'est inventée : rien de reconnu → `""`.
 * @param {object} payload charge de l'événement.
 * @returns {string}
 */
export function toolUpdateText(payload) {
  const pr = payload && payload.partialResult;
  if (pr == null) return "";
  if (typeof pr === "string") return pr;
  if (typeof pr === "number" || typeof pr === "boolean") return String(pr);
  if (typeof pr === "object") {
    for (const key of ["output", "stdout", "text"]) {
      if (typeof pr[key] === "string" && pr[key]) return pr[key];
    }
    if (Array.isArray(pr.content)) {
      return pr.content
        .filter((p) => p && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
    }
  }
  return "";
}
