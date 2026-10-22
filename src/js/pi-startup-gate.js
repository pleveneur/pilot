// pi-startup-gate.js — GARDE DE DÉMARRAGE : la vérification du moteur (pi) passe
// AVANT tout travail.
//
// Règle du propriétaire (non réinterprétée) :
//   1. au lancement de Pilot, la PREMIÈRE chose à faire est de vérifier si une
//      nouvelle version du moteur (pi) existe ;
//   2. tant que cette vérification n'est pas terminée — et tant qu'une mise à
//      jour est en cours — Pilot ne commence PAS à « réfléchir » : aucune
//      première réflexion de l'assistant, aucun agent lancé, aucune tâche de
//      fond ;
//   3. si une nouvelle version existe, elle s'installe et le travail attend la
//      fin de l'installation ; l'écran dit clairement ce qui se passe ;
//   4. jamais de blocage éternel : la vérification est BORNÉE (durée maximale
//      ci-dessous). Au-delà, le terrain est rendu d'autorité et le travail
//      démarre avec la version en service — c'est un filet de sécurité de
//      dernier recours, la séquence de démarrage (`pi-update.js`) rendant le
//      terrain elle-même, avec un message explicite, bien avant.
//
// Ce module est le SEUL propriétaire de cet état. La décision « le travail
// peut-il démarrer ? » reste celle du gardien existant (`run-policy.js`,
// `canStartWork`) et de son extension « l'assistant peut-il réfléchir ? »
// (`canAssistantReflect`) : il n'existe donc pas de second gardien concurrent,
// et le texte des attentes n'est écrit qu'ici.

/** Motifs de blocage du terrain (un seul actif à la fois). */
export const PI_STARTUP_GATE_REASONS = Object.freeze({
  /** La version du moteur est en cours de vérification. */
  CHECKING: "checking",
  /** Une nouvelle version du moteur est en cours d'installation. */
  UPDATING: "updating",
});

/** Attente affichée pendant la vérification de la version du moteur. */
export const PI_CHECKING_BLOCKED_MESSAGE =
  "⏳ Vérification de la version de l'agent Pi : le travail (assistant, agents, " +
  "tâches de fond) démarre dès que cette vérification est terminée.";

/**
 * Attente affichée pendant l'installation d'une nouvelle version du moteur.
 * @param {string} [version] - version en cours d'installation (facultative)
 * @returns {string}
 */
export function piUpdatingBlockedMessage(version) {
  const v = typeof version === "string" && version.trim() ? ` ${version.trim()}` : "";
  return (
    `⏳ Mise à jour de l'agent Pi${v} en cours : le travail (assistant, agents, ` +
    "tâches de fond) démarre à la fin de l'installation."
  );
}

/**
 * Durée MAXIMALE du blocage, motif par motif (filet de dernier recours : au-delà,
 * le terrain est rendu d'autorité pour que rien ne bloque indéfiniment). Ces
 * plafonds sont volontairement PLUS LARGES que les délais de la séquence de
 * démarrage : dans le cas normal, c'est la séquence qui rend le terrain, avec un
 * message explicite.
 */
export const PI_CHECKING_MAX_MS = 90_000;
export const PI_UPDATING_MAX_MS = 300_000;

/** Motif actif ("" = terrain libre, le travail peut démarrer). */
let _reason = "";
/** Version concernée (informatif, jamais une décision). */
let _version = "";
/** Échéance absolue du blocage courant (0 = aucune). */
let _deadlineAt = 0;
/** Issue de la dernière séquence (informatif : « up_to_date », « updated »…). */
let _outcome = "";
/** Version du moteur réellement en service à la fin de la séquence. */
let _current = "";
/** Horloge injectable (tests déterministes). */
let _now = () => Date.now();

/**
 * Arme le garde pour un motif donné.
 * @param {string} reason - `PI_STARTUP_GATE_REASONS.CHECKING` ou `.UPDATING`
 * @param {{version?: string, maxMs?: number}} [info]
 * @returns {string} motif effectivement posé
 */
function arm(reason, info = {}) {
  const known = reason === PI_STARTUP_GATE_REASONS.CHECKING || reason === PI_STARTUP_GATE_REASONS.UPDATING;
  _reason = known ? reason : PI_STARTUP_GATE_REASONS.CHECKING;
  const version = info && typeof info.version === "string" ? info.version : "";
  _version = version;
  const fallback = _reason === PI_STARTUP_GATE_REASONS.UPDATING ? PI_UPDATING_MAX_MS : PI_CHECKING_MAX_MS;
  const maxMs = info && Number.isFinite(info.maxMs) && info.maxMs > 0 ? info.maxMs : fallback;
  _deadlineAt = _now() + maxMs;
  return _reason;
}

/**
 * Bloque le démarrage : la vérification de la version du moteur commence.
 * @param {{version?: string, maxMs?: number}} [info]
 * @returns {string} motif posé
 */
export function beginPiStartupCheck(info = {}) {
  _outcome = "";
  _current = "";
  return arm(PI_STARTUP_GATE_REASONS.CHECKING, info);
}

/**
 * Bloque le démarrage : une nouvelle version du moteur s'installe.
 * @param {{version?: string, maxMs?: number}} [info]
 * @returns {string} motif posé
 */
export function beginPiStartupUpdate(info = {}) {
  return arm(PI_STARTUP_GATE_REASONS.UPDATING, info);
}

/**
 * Rend le terrain (vérification terminée, quel qu'en soit le résultat).
 * @param {string} [outcome] - issue de la séquence (informatif)
 * @param {{current?: string}} [info]
 * @returns {void}
 */
export function endPiStartupGate(outcome = "", info = {}) {
  _reason = "";
  _version = "";
  _deadlineAt = 0;
  _outcome = typeof outcome === "string" ? outcome : "";
  _current = info && typeof info.current === "string" ? info.current : "";
}

/**
 * true si la vérification du moteur (ou son installation) interdit de démarrer
 * maintenant. Au-delà de la durée maximale, le terrain est rendu d'autorité :
 * une vérification en échec ne peut donc PAS bloquer la session indéfiniment.
 * @returns {boolean}
 */
export function isPiStartupGateBlocking() {
  if (_reason === "") return false;
  if (_deadlineAt > 0 && _now() > _deadlineAt) {
    // Filet de dernier recours : jamais de blocage éternel. L'issue est tracée
    // pour que le rapport et les tests puissent la constater.
    _reason = "";
    _version = "";
    _deadlineAt = 0;
    _outcome = "gate-timeout";
    return false;
  }
  return true;
}

/**
 * État courant du garde (lecture seule, pour l'affichage et les contrôles).
 * @returns {{blocking: boolean, reason: string, version: string, outcome: string, current: string, deadlineAt: number}}
 */
export function getPiStartupGateState() {
  const blocking = isPiStartupGateBlocking();
  return {
    blocking,
    reason: blocking ? _reason : "",
    version: blocking ? _version : "",
    outcome: _outcome,
    current: _current,
    deadlineAt: blocking ? _deadlineAt : 0,
  };
}

/**
 * Message d'attente à afficher (chaîne vide = le terrain est libre).
 * @returns {string}
 */
export function piStartupGateMessage() {
  if (!isPiStartupGateBlocking()) return "";
  if (_reason === PI_STARTUP_GATE_REASONS.UPDATING) return piUpdatingBlockedMessage(_version);
  return PI_CHECKING_BLOCKED_MESSAGE;
}

/**
 * Remise à zéro COMPLÈTE (tests uniquement : aucun blocage ne doit survivre au
 * cas précédent).
 * @param {function(): number} [now] - horloge simulée (facultative)
 * @returns {void}
 */
export function __resetPiStartupGateForTest(now) {
  _reason = "";
  _version = "";
  _deadlineAt = 0;
  _outcome = "";
  _current = "";
  _now = typeof now === "function" ? now : () => Date.now();
}
