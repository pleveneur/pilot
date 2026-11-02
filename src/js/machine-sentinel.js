// machine-sentinel.js — SOURCE UNIQUE du FILET DE SÉCURITÉ des « sentinelles
// machine » : les chaînes `PILOT_<FAMILLE>::<charge utile>` qu'une extension
// utilise pour parler à Pilot (ex. `PILOT_ASSISTANT_SCHEDULE::{"op":"list"}`).
//
// RÈGLE PROTÉGÉE (propriétaire, 2026-11) : une sentinelle interne ne doit
// JAMAIS être montrée telle quelle à l'utilisateur. Ce n'est pas une question,
// c'est un appel de fonction déguisé en dialogue : affichée brute, elle
// produit une « demande de confirmation » incompréhensible avec deux boutons
// Valider / Annuler (défaut observé : `PILOT_ASSISTANT_SCHEDULE::{"op":"list"}`
// relayé par le bus d'agents, voir
// `docs/rapports/RAPPORT-sentinelle-brute-confirmation.md`).
//
// Trois garanties, dans cet ordre :
//   1. une sentinelle CONNUE (famille planification) devient une phrase
//      française compréhensible, sans identifiant machine ni JSON ;
//   2. une sentinelle INCONNUE ne fuit jamais : elle devient une formulation
//      neutre, lisible, qui ne prétend rien de faux ;
//   3. un texte SANS sentinelle n'est jamais modifié (aucune réécriture des
//      questions légitimes d'un agent).
//
// Module PUR (aucun DOM, aucune I/O, aucun appel Tauri) : il est appelé au
// moment de PEINDRE, donc sur tous les chemins d'affichage — session de
// l'assistant, onglet chat, relais des questions d'agents, barre des questions
// en attente. Un seul mécanisme, jamais une seconde copie de la règle.

/** Sentinelle de la planification (outils `schedule_*`, extension
 *  `pilot-assistant-schedule.ts`). */
export const SCHEDULE_SENTINEL = "PILOT_ASSISTANT_SCHEDULE::";

/** Préfixe des sentinelles de l'assistant (famille `PILOT_ASSISTANT_*`). */
export const ASSISTANT_SENTINEL_PREFIX = "PILOT_ASSISTANT_";

/** Motif d'une sentinelle machine : `PILOT_` + famille en majuscules + `::`.
 *  Volontairement large : le filet de sécurité doit reconnaître aussi une
 *  famille qu'il ne connaît pas. */
export const MACHINE_SENTINEL_RE = /PILOT_[A-Z0-9_]+::/;

/** Phrases lisibles par opération de planification. Aucune ne contient
 *  d'identifiant machine ni de JSON. */
export const SCHEDULE_SENTENCES = {
  list: "Je vais relever la liste de mes rappels programmés. Je continue ?",
  create: "Je vais programmer un nouveau rappel qui reviendra dans notre conversation. Je continue ?",
  delete: "Je vais supprimer un rappel programmé. Je continue ?",
  set_enabled: "Je vais suspendre ou réactiver un rappel programmé. Je continue ?",
  other: "Je vais mettre à jour mes rappels programmés. Je continue ?",
};

/** Formulation NEUTRE pour une sentinelle non reconnue (filet de sécurité). */
export const NEUTRAL_SENTENCE =
  "Pilot a besoin de votre accord pour continuer une action interne. Je continue ?";

/**
 * Vrai si le texte contient une sentinelle machine.
 * @param {unknown} text
 * @returns {boolean}
 */
export function hasMachineSentinel(text) {
  return typeof text === "string" && MACHINE_SENTINEL_RE.test(text);
}

/**
 * Détail de la PREMIÈRE sentinelle d'un texte.
 * @param {unknown} text
 * @returns {{name:string, payload:string, index:number}|null} `null` si aucune.
 */
export function machineSentinelOf(text) {
  if (typeof text !== "string") return null;
  const m = MACHINE_SENTINEL_RE.exec(text);
  if (!m) return null;
  return {
    name: m[0],
    payload: text.slice(m.index + m[0].length),
    index: m.index,
  };
}

/**
 * Vrai si le texte porte une sentinelle de la famille de l'assistant
 * (`PILOT_ASSISTANT_*`) : ces demandes ne sont pas des questions de
 * l'utilisateur, elles appartiennent à la session de l'assistant.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isAssistantSentinel(text) {
  return typeof text === "string" && text.includes(ASSISTANT_SENTINEL_PREFIX);
}

/**
 * Demande de planification portée par un titre, ou `null` si ce n'en est pas
 * une. Ne lève jamais : un JSON illisible donne `null`.
 * @param {unknown} title
 * @returns {object|null}
 */
export function scheduleRequestFrom(title) {
  if (typeof title !== "string" || !title.startsWith(SCHEDULE_SENTINEL)) return null;
  try {
    const req = JSON.parse(title.slice(SCHEDULE_SENTINEL.length));
    return req && typeof req === "object" && !Array.isArray(req) ? req : null;
  } catch (_) {
    return null;
  }
}

/**
 * Vrai si la demande est une ACTION INTERNE que le relais EXÉCUTE sans
 * l'utilisateur : il n'y a donc aucune question à lui poser, et le message
 * d'attente ne doit pas prétendre le contraire. Aujourd'hui : la famille
 * planification (`input` portant `PILOT_ASSISTANT_SCHEDULE::`), exécutée par
 * `runSuperAgentScheduleOp` dans la conversation de l'assistant.
 * @param {{method?:string, title?:string}} payload
 * @returns {boolean}
 */
export function isSelfAnsweredMachineRequest(payload) {
  const p = payload || {};
  if (p.method !== "input") return false;
  const title = typeof p.title === "string" ? p.title : "";
  return title.startsWith(SCHEDULE_SENTINEL);
}

/**
 * Phrase lisible pour une opération de planification.
 * @param {{op?:string}|null} req
 * @returns {string}
 */
export function scheduleSentence(req) {
  const op = req && typeof req.op === "string" ? req.op : "";
  return SCHEDULE_SENTENCES[op] || SCHEDULE_SENTENCES.other;
}

/**
 * Essaie d'extraire un titre lisible d'une charge utile JSON
 * (`{"title":"…","message":"…"}` — sentinelles de présentation
 * `PILOT_CONFIRM::` / `PILOT_MULTI_CHOICE::`).
 * @param {string} payload
 * @returns {string} texte nettoyé, ou "" si rien d'exploitable.
 */
function readableFromJsonPayload(payload) {
  const raw = typeof payload === "string" ? payload.trim() : "";
  if (!raw.startsWith("{")) return "";
  try {
    const parsed = JSON.parse(raw);
    const title = parsed && typeof parsed.title === "string" ? parsed.title : "";
    if (!title) return "";
    return readableMachineText(title);
  } catch (_) {
    return "";
  }
}

/**
 * Remplace une sentinelle (et sa charge utile machine) par une phrase
 * française lisible. Le texte éventuellement présent AVANT la sentinelle est
 * conservé, la charge utile technique est supprimée.
 * @param {string} text
 * @returns {string}
 */
export function sentinelSentenceFor(text) {
  const found = machineSentinelOf(text);
  if (!found) return "";
  const payload = found.payload;
  if (found.name === SCHEDULE_SENTINEL) {
    let req = null;
    try {
      req = JSON.parse(payload);
    } catch (_) {
      req = null;
    }
    return scheduleSentence(req && typeof req === "object" ? req : null);
  }
  // Sentinelles de PRÉSENTATION : elles portent elles-mêmes le texte de la
  // question. Si le JSON est exploitable, on garde la question de l'auteur.
  const fromJson = readableFromJsonPayload(payload);
  if (fromJson) return fromJson;
  return NEUTRAL_SENTENCE;
}

/**
 * FILET DE SÉCURITÉ PRINCIPAL : rend un texte affichable.
 *  - aucun sentinelle → texte inchangé (jamais de réécriture d'une question
 *    légitime) ;
 *  - sentinelle connue → phrase française de la famille ;
 *  - sentinelle inconnue → formulation neutre lisible.
 * Le résultat ne contient JAMAIS `PILOT_*::` ni la charge utile JSON.
 * @param {unknown} text
 * @returns {string}
 */
export function readableMachineText(text) {
  if (typeof text !== "string") return "";
  const found = machineSentinelOf(text);
  if (!found) return text;
  const before = text.slice(0, found.index).trim();
  const sentence = sentinelSentenceFor(text);
  return before ? `${before} ${sentence}` : sentence;
}

/**
 * Nettoie le couple titre + message d'une demande d'extension juste avant de
 * le peindre. Seul point d'entrée utilisé par les écrans (desktop : session de
 * l'assistant et onglet chat/relais ; web distant : aucun affichage de ce
 * type aujourd'hui, la règle est verrouillée par test).
 * @param {{title?:string, message?:string}} payload
 * @returns {{title:string, message:string}}
 */
export function readableQuestion(payload) {
  const p = payload || {};
  const title = readableMachineText(typeof p.title === "string" ? p.title : "");
  const message = readableMachineText(typeof p.message === "string" ? p.message : "");
  return { title, message };
}
