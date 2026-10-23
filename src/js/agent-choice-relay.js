// agent-choice-relay.js — SOURCE UNIQUE de la décision « cette demande d'agent
// est-elle une QUESTION à remonter à l'utilisateur ? » et de l'événement de
// relais correspondant.
//
// Deux chemins de relais s'appuient sur ce module, avec le MÊME événement
// navigateur (`pilot-agent-relay-request`) — il n'existe pas de seconde
// mécanique :
//   - `agent-pi.js` : l'agent de l'onglet chat (question rendue dans la
//     conversation de l'assistant quand son onglet est ouvert) ;
//   - `agents-bus.js` : les agents lancés en arrière-plan (run d'agents de
//     l'assistant) — leur question REMONTE désormais comme une question
//     visible, elle n'est plus auto-répondue par le bus.
//
// Règle du propriétaire (2026-10-16) : un agent PEUT poser une question, on en
// a besoin ; la question doit remonter à l'utilisateur, qui répond lui-même.
// Aucune réponse de repli n'est inventée à sa place. Si l'utilisateur ne répond
// pas, la question reste en attente (la limite de 45 min côté Rust,
// `anomaly::AWAITING_USER_MAX_SUSPEND_SECS`, empêche le gel de la file).
//
// Module PUR (aucune I/O, aucun appel Tauri).
import { SCREEN_GATE_SENTINEL } from "./screen-guard.js";

/** Événement UNIQUE de relais d'une question d'agent vers la conversation de
 *  l'assistant. Détail attendu : `{ payload, agentId, projectPath }`. */
export const AGENT_RELAY_EVENT = "pilot-agent-relay-request";

/** Sentinel de la porte pré-écriture (Diff Review A4) : message `confirm`
 *  `PILOT_EDIT_GATE::<json>`. */
export const EDIT_GATE_SENTINEL = "PILOT_EDIT_GATE::";

/** Sentinel des actions Pilot demandées par l'assistant (ouvrir un projet,
 *  déléguer, etc.) : message `confirm` `PILOT_ASSISTANT_ACTION::<json>`. */
export const ASSISTANT_ACTION_SENTINEL = "PILOT_ASSISTANT_ACTION::";

/**
 * Vrai si le message est une PORTE INTERNE (écriture de fichier, action Pilot,
 * action sur l'écran). Ce ne sont pas des questions de l'utilisateur mais des
 * décisions sur la machine : elles ne sont jamais relayées dans la conversation
 * de l'assistant (elles ont leur propre dialogue).
 * @param {string} message
 * @returns {boolean}
 */
export function isInternalAgentGate(message) {
  const msg = typeof message === "string" ? message : "";
  if (!msg) return false;
  return (
    msg.startsWith(EDIT_GATE_SENTINEL) ||
    msg.startsWith(ASSISTANT_ACTION_SENTINEL) ||
    msg.startsWith(SCREEN_GATE_SENTINEL)
  );
}

/**
 * Vrai si une demande `extension_ui_request` (`select` / `confirm` / `input`)
 * est une QUESTION à remonter à l'utilisateur via l'assistant. Les portes
 * internes sont exclues.
 * @param {{method?:string, message?:string}} payload
 * @returns {boolean}
 */
export function isRelayableAgentChoice(payload) {
  const m = payload && payload.method;
  if (m === "select" || m === "input") return true;
  if (m === "confirm") {
    const msg = payload.message || "";
    if (msg.startsWith(EDIT_GATE_SENTINEL)) return false;
    if (msg.startsWith(ASSISTANT_ACTION_SENTINEL)) return false;
    // Contrôle de l'écran : la confirmation doit rester dans l'onglet de l'agent
    // concerné (elle décide d'une action réelle sur la machine).
    if (msg.startsWith(SCREEN_GATE_SENTINEL)) return false;
    return true;
  }
  return false;
}

/**
 * Titre lisible d'une question d'agent (pour la signaler, jamais pour y
 * répondre). `confirm` porte son intitulé dans `title`, `select` aussi (avec
 * éventuels sentinels de présentation), `input` également.
 * @param {{method?:string, title?:string, message?:string}} payload
 * @returns {string}
 */
export function agentQuestionLabel(payload) {
  const rawTitle = (payload && payload.title) || "";
  const message = (payload && payload.message) || "";
  const isInternal = isInternalAgentGate(rawTitle) || isInternalAgentGate(message);
  if (isInternal) return "validation interne de l'agent";
  let title = rawTitle;
  if (title.startsWith("PILOT_CONFIRM::")) {
    // Confirmation Oui/Non : le titre porte un JSON `{title, message}`.
    try {
      const parsed = JSON.parse(title.slice("PILOT_CONFIRM::".length));
      title = parsed.title || "Confirmation";
    } catch {
      title = title.slice("PILOT_CONFIRM::".length);
    }
  } else {
    title = title.replace("PILOT_MULTI_CHOICE::", "");
  }
  title = title.trim();
  if (title) return title;
  const method = (payload && payload.method) || "demande";
  return method === "select" ? "choix à faire" : method === "input" ? "saisie attendue" : "confirmation attendue";
}
