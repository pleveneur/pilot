// agent-question-surface.js — SOURCE UNIQUE de la décision « QUI affiche une
// question d'agent » et de « qui l'a RÉELLEMENT prise en charge ».
//
// Défaut protégé (docs/rapports/RAPPORT-gel-questions-sans-surface.md) : la
// seule surface capable d'afficher une question d'agent était l'onglet 🧭
// Assistant. Son écouteur de `pilot-agent-relay-request` est posé à la CRÉATION
// de l'onglet et RETIRÉ à sa fermeture : question posée sans onglet 🧭 = aucun
// affichage, aucune réponse, attente ouverte jusqu'au plafond de 45 min côté
// Rust — la file du projet restait réservée tout ce temps.
//
// Deux réponses, décidées ICI (jamais ailleurs) :
//   1. la question est peinte par UN SEUL porteur : l'onglet 🧭 quand il est
//      ouvert (comportement inchangé, mêmes boutons, réponse routée par
//      `send_agent_command_to`), sinon la surface de SECOURS de l'application
//      (le dialogue de choix EXISTANT, agent-pi.js) ;
//   2. si aucune surface ne peut la peindre, l'attente n'est PAS laissée
//      ouverte : elle se termine par un arrêt TRACÉ (`question-sans-surface`,
//      entonnoir de la règle 3) et un message explicite. Aucune réponse
//      inventée : on ne décide jamais à la place de l'utilisateur.
//
// Le registre de prise en charge (`claimAgentQuestion`) est ce qui rend « un
// seul écouteur par question » observable : l'émetteur (agents-bus.js) relit le
// registre JUSTE APRÈS avoir émis l'événement, et sait donc si une surface a
// réellement pris la question.
//
// Module PUR : aucun DOM, aucune I/O, aucun appel Tauri. Les textes sont
// testables et le branchement DOM vit dans `agent-question-fallback.js`.

import { hasMachineSentinel, readableMachineText } from "./machine-sentinel.js";

/** Surface : l'onglet 🧭 Assistant (boutons de choix + file des questions). */
export const AGENT_QUESTION_SURFACE_TAB = "assistant-tab";
/** Surface de SECOURS : le dialogue de choix de l'application (agent-pi.js). */
export const AGENT_QUESTION_SURFACE_DIALOG = "app-dialog";
/** Aucune surface : l'attente doit être terminée, pas laissée ouverte. */
export const AGENT_QUESTION_SURFACE_NONE = "none";

/** Motif journalisé (règle 3) quand une attente est terminée faute de surface. */
export const AGENT_QUESTION_NO_SURFACE_REASON = "question-sans-surface";
/** Détecteur associé : le relais n'a trouvé aucun porteur. */
export const AGENT_QUESTION_NO_SURFACE_DETECTED = "relais-sans-ecouteur";

// Sentinelles de PRÉSENTATION des outils de choix (mêmes littéraux que
// `pilot-choices.ts` : le titre porte le type de question).
export const MULTI_CHOICE_SENTINEL = "PILOT_MULTI_CHOICE::";
export const CONFIRM_CHOICE_SENTINEL = "PILOT_CONFIRM::";

/** Nombre maximal de prises en charge mémorisées (borne mémoire : le registre
 *  ne sert qu'à départager les porteurs d'une même question, pas d'historique). */
export const AGENT_QUESTION_CLAIMS_MAX = 100;

/** Registre des prises en charge : clé de question → surface qui la porte. */
const claims = new Map();
/** Surface PRINCIPALE enregistrée (l'onglet 🧭), ou `null`. */
let primarySurface = null;

/**
 * Clé d'une question : projet + agent + identifiant de la demande. Deux questions
 * différentes ne partagent jamais une clé ; une même question garde la sienne.
 * @param {{payload?:object, agentId?:string, projectPath?:string}} detail
 * @returns {string} "" quand la demande n'a pas d'identifiant (non départageable)
 */
export function agentQuestionKey(detail) {
  const d = detail || {};
  const payload = d.payload || {};
  const rawId = payload.id;
  const id =
    typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
  if (!id) return "";
  const agentId = typeof d.agentId === "string" && d.agentId ? d.agentId : "default";
  const project = typeof d.projectPath === "string" ? d.projectPath : "";
  return `${project}|${agentId}|${id}`;
}

/**
 * Enregistre (ou retire) la surface PRINCIPALE, c'est-à-dire l'onglet 🧭 dont
 * l'écouteur est en place. Idempotent. Le jeton permet à un onglet fermé de ne
 * pas retirer la surface d'un onglet ouvert après lui.
 * @param {unknown} token - jeton opaque de la surface qui s'enregistre
 */
export function setPrimaryAgentQuestionSurface(token) {
  primarySurface = token === undefined ? null : token;
}

/**
 * Retire la surface principale SEULEMENT si `token` en est encore le porteur.
 * @param {unknown} token
 * @returns {boolean} true si la surface a été retirée
 */
export function clearPrimaryAgentQuestionSurface(token) {
  if (primarySurface === null || primarySurface === undefined) return false;
  if (token !== undefined && primarySurface !== token) return false;
  primarySurface = null;
  return true;
}

/**
 * Une surface principale (onglet 🧭) est-elle en place ?
 * @returns {boolean}
 */
export function hasPrimaryAgentQuestionSurface() {
  return primarySurface !== null && primarySurface !== undefined;
}

/**
 * Décide LA surface qui doit peindre une question. L'onglet 🧭 gagne toujours
 * (c'est là que vivent les boutons de choix et la file) ; à défaut, la surface
 * de secours ; à défaut, aucune — l'appelant doit alors TERMINER l'attente.
 * @param {{primarySurface?:boolean, appDialogAvailable?:boolean}} [etats]
 * @returns {string} une des trois constantes `AGENT_QUESTION_SURFACE_*`
 */
export function decideAgentQuestionSurface(etats = {}) {
  const e = etats || {};
  if (e.primarySurface) return AGENT_QUESTION_SURFACE_TAB;
  if (e.appDialogAvailable) return AGENT_QUESTION_SURFACE_DIALOG;
  return AGENT_QUESTION_SURFACE_NONE;
}

/**
 * Réserve une question pour UNE surface. Le PREMIER appelant obtient la
 * question ; tout appelant suivant (autre surface, ou second écouteur de la même
 * surface) est refusé : c'est la garantie « aucun double affichage, aucune
 * double réponse ». Une demande sans identifiant n'est pas départageable : elle
 * est acceptée (mieux vaut l'afficher que la perdre).
 * @param {object} detail - `{ payload, agentId, projectPath }`
 * @param {string} surface - une des constantes `AGENT_QUESTION_SURFACE_*`
 * @returns {boolean} true si l'appelant doit peindre la question
 */
export function claimAgentQuestion(detail, surface) {
  const key = agentQuestionKey(detail);
  if (!key) return true;
  if (claims.has(key)) return false;
  claims.set(key, surface);
  if (claims.size > AGENT_QUESTION_CLAIMS_MAX) {
    // Éviction du plus ancien : le registre n'est pas un historique.
    const oldest = claims.keys().next();
    if (!oldest.done) claims.delete(oldest.value);
  }
  return true;
}

/**
 * La question a-t-elle été prise en charge par une surface ?
 * @param {object} detail
 * @returns {boolean}
 */
export function isAgentQuestionClaimed(detail) {
  const key = agentQuestionKey(detail);
  if (!key) return false;
  return claims.has(key);
}

/**
 * Surface qui porte la question, ou `""` si aucune.
 * @param {object} detail
 * @returns {string}
 */
export function agentQuestionSurfaceOf(detail) {
  const key = agentQuestionKey(detail);
  return key && claims.has(key) ? claims.get(key) : "";
}

/**
 * Libère une question (elle a été répondue, annulée ou re-relayée).
 * @param {object} detail
 * @returns {boolean} true si une prise en charge existait
 */
export function releaseAgentQuestion(detail) {
  const key = agentQuestionKey(detail);
  if (!key) return false;
  return claims.delete(key);
}

/** Remet le registre et la surface principale à zéro (tests, fermeture globale). */
export function resetAgentQuestionSurfaces() {
  claims.clear();
  primarySurface = null;
}

/**
 * Nom court du projet d'une question (dernier segment du chemin), "" si inconnu.
 * @param {string} projectPath
 * @returns {string}
 */
export function agentQuestionProjectName(projectPath) {
  const p = String(projectPath || "").replace(/[\\/]+$/, "");
  if (!p) return "";
  const parts = p.split(/[\\/]+/);
  return parts[parts.length - 1] || "";
}

/**
 * Libellé de l'agent qui pose la question (« par défaut » quand il n'est pas
 * nommé, comme l'en-tête du relais dans l'onglet 🧭).
 * @param {string} agentId
 * @returns {string}
 */
export function agentQuestionAgentLabel(agentId) {
  const id = typeof agentId === "string" ? agentId : "";
  return !id || id === "default" ? "par défaut" : id;
}

/**
 * En-tête de la question : QUI la pose (agent + projet) et CE QU'elle demande.
 * Une seule ligne, sans sentinelle machine (les titres de présentation sont
 * déjà déballés par `agentQuestionView`).
 * @param {{agentId?:string, projectPath?:string}} detail
 * @param {{title?:string}} view
 * @returns {string}
 */
export function agentQuestionHeadline(detail, view) {
  const d = detail || {};
  const label = agentQuestionAgentLabel(d.agentId);
  const project = agentQuestionProjectName(d.projectPath);
  const title = (view && typeof view.title === "string" && view.title.trim()) || "Question";
  const where = project ? `L'agent « ${label} » du projet « ${project} »` : `L'agent « ${label} »`;
  return `🤖 ${where} attend votre réponse : ${title}`;
}

/**
 * Déballe un titre porteur d'une sentinelle de présentation.
 * @param {string} rawTitle
 * @returns {{kind:string, title:string, message:string}} `kind` ∈
 *   `select` | `multi` | `confirm` (vide quand aucune sentinelle)
 */
function parsePresentationTitle(rawTitle) {
  const raw = typeof rawTitle === "string" ? rawTitle : "";
  if (raw.startsWith(CONFIRM_CHOICE_SENTINEL)) {
    const rest = raw.slice(CONFIRM_CHOICE_SENTINEL.length);
    try {
      const parsed = JSON.parse(rest);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          kind: "confirm",
          title: typeof parsed.title === "string" ? parsed.title : "Confirmation",
          message: typeof parsed.message === "string" ? parsed.message : "",
        };
      }
    } catch (_) {
      // JSON illisible : on garde le texte, il sera nettoyé par le filet machine.
    }
    return { kind: "confirm", title: rest, message: "" };
  }
  if (raw.startsWith(MULTI_CHOICE_SENTINEL)) {
    return {
      kind: "multi",
      title: raw.slice(MULTI_CHOICE_SENTINEL.length),
      message: "",
    };
  }
  return { kind: "", title: raw, message: "" };
}

/**
 * Vue affichable d'une demande `extension_ui_request` : ce qu'il faut peindre,
 * sans sentinelle machine.
 *
 * `kind` :
 *   - `confirm`  : Oui / Non (message détaillé éventuel) ;
 *   - `select`   : une option parmi la liste ;
 *   - `multi`    : plusieurs options (cases à cocher) ;
 *   - `input`    : saisie libre ;
 *   - `machine`  : demande INTERNE de Pilot (sentinelle) — elle ne se pose pas à
 *     l'utilisateur depuis cette surface, il faut répondre explicitement ;
 *   - `unsupported` : méthode sans question (notify, editor…).
 *
 * @param {{method?:string, title?:string, message?:string, options?:string[], placeholder?:string}} payload
 * @returns {{kind:string, title:string, message:string, options:string[], placeholder:string, answer:string}}
 *   `answer` : réponse explicite à renvoyer pour `machine` / `unsupported`.
 */
export function agentQuestionView(payload) {
  const p = payload || {};
  const method = typeof p.method === "string" ? p.method : "";
  const parsed = parsePresentationTitle(typeof p.title === "string" ? p.title : "");
  const message = readable(p.message);

  if (method === "select") {
    const kind = parsed.kind === "multi" ? "multi" : parsed.kind === "confirm" ? "confirm" : "select";
    return {
      kind,
      title: readable(parsed.title) || (kind === "confirm" ? "Confirmation" : "Choix"),
      message: kind === "confirm" ? readable(parsed.message) || message : message,
      options: Array.isArray(p.options) ? p.options.map((o) => String(o)) : [],
      placeholder: "",
      answer: "",
    };
  }

  if (method === "confirm") {
    return {
      kind: "confirm",
      title: readable(p.title) || "Confirmation",
      message,
      options: ["Oui", "Non"],
      placeholder: "",
      answer: "",
    };
  }

  if (method === "input") {
    const rawTitle = typeof p.title === "string" ? p.title : "";
    if (hasSentinel(rawTitle)) {
      // Une sentinelle machine n'est PAS une question de l'utilisateur : on ne
      // la peint jamais (règle machine-sentinel.js) et on répond une phrase
      // claire au moteur — ni formulaire technique, ni silence.
      return {
        kind: "machine",
        title: "",
        message: "",
        options: [],
        placeholder: "",
        answer: JSON.stringify({
          error:
            "Cette action interne de Pilot doit être demandée dans la conversation de l'assistant : elle ne peut pas être exécutée depuis la session d'un agent. Rien n'a été modifié.",
        }),
      };
    }
    return {
      kind: "input",
      title: readable(rawTitle) || "Saisie",
      message,
      options: [],
      placeholder: typeof p.placeholder === "string" ? readable(p.placeholder) : "",
      answer: "",
    };
  }

  return {
    kind: "unsupported",
    title: "",
    message: "",
    options: [],
    placeholder: "",
    answer: "",
  };
}

/**
 * Texte affichable d'un champ (jamais de sentinelle machine brute).
 * @param {unknown} text
 * @returns {string}
 */
function readable(text) {
  return readableMachineText(typeof text === "string" ? text : "");
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasSentinel(text) {
  return hasMachineSentinel(text);
}

/**
 * Traduit la réponse d'un dialogue en commande `extension_ui_response`
 * (`{cancelled:true}` ou `{value}`), au format EXACT qu'attend l'extension
 * `pilot-choices.ts` (JSON `{selected}` / `{selected:[]}` / `{confirmed}`,
 * texte brut pour une saisie).
 * @param {object} view - résultat de `agentQuestionView`
 * @param {unknown} answer - valeur rendue par le dialogue (`null` = annulé)
 * @returns {{cancelled:boolean, value:string|undefined}}
 */
export function agentQuestionAnswer(view, answer) {
  const v = view || {};
  if (answer === null || answer === undefined) return { cancelled: true, value: undefined };
  if (v.kind === "confirm") {
    return { cancelled: false, value: JSON.stringify({ confirmed: answer === true, note: "" }) };
  }
  if (v.kind === "multi") {
    const selected = Array.isArray(answer) ? answer.map((a) => String(a)) : [];
    return { cancelled: false, value: JSON.stringify({ selected, note: "" }) };
  }
  if (v.kind === "select") {
    return { cancelled: false, value: JSON.stringify({ selected: String(answer), note: "" }) };
  }
  if (v.kind === "input") {
    return { cancelled: false, value: String(answer) };
  }
  // `machine` : la réponse explicite fabriquée par la vue, jamais un silence.
  if (typeof v.answer === "string" && v.answer) {
    return { cancelled: false, value: v.answer };
  }
  return { cancelled: true, value: undefined };
}

/**
 * Normalise les arguments d'un `responder` de question en
 * `{id, value, cancelled}`.
 *
 * Un même responder est appelé de DEUX façons dans l'application :
 *   - `responder(value, cancelled)` — réponse directe (demandes internes
 *     exécutées par le relais, ex. planification) ;
 *   - `responder(id, value, cancelled)` — soumission de la barre des questions
 *     (`q.responder(q.id, value, cancelled)` dans `finishPendingQuestion`).
 * Sans normalisation, le chemin à deux arguments décalait les valeurs : la
 * réponse de l'utilisateur partait comme `cancelled: true` (choix perdu, agent
 * croyant à une annulation). La règle vit ici, PURE et testée, pour qu'aucun
 * appelant n'ait à la deviner.
 *
 * @param {string} defaultId - identifiant de la question ouverte
 * @param {unknown[]} args - arguments reçus par le responder
 * @returns {{id:*, value:*, cancelled:boolean}}
 */
export function normalizeAgentAnswerArgs(defaultId, args) {
  const a = Array.isArray(args) ? args : [];
  if (a.length >= 3) return { id: a[0], value: a[1], cancelled: a[2] === true };
  return { id: defaultId, value: a[0], cancelled: a[1] === true };
}

/**
 * Message EXPLICITE d'une attente terminée faute de surface (affiché dans la
 * conversation de l'assistant et en notification) : ce qui s'est passé, pourquoi,
 * et ce qui a été fait. Jamais de silence, jamais de réponse inventée.
 * @param {{agentId?:string, label?:string}} [options] - `label` : question
 *   reformulée par `agentQuestionLabel` (agent-choice-relay.js)
 * @returns {string}
 */
export function agentQuestionNoSurfaceMessage(options = {}) {
  const o = options || {};
  const label = agentQuestionAgentLabel(o.agentId);
  const question = typeof o.label === "string" && o.label.trim() ? ` (« ${o.label.trim()} »)` : "";
  return (
    `⚠️ L'agent « ${label} » attend une réponse qui ne peut pas être affichée${question} : ` +
    `aucune surface n'a pu la présenter. L'attente est donc TERMINÉE — l'agent est arrêté et son créneau libéré ` +
    `(motif journalisé dans .pilot/agent-stops.log). Aucune réponse n'a été décidée à votre place.`
  );
}
