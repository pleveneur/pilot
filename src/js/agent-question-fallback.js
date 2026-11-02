// agent-question-fallback.js — SURFACE DE SECOURS d'une question d'agent.
//
// Défaut protégé (docs/rapports/RAPPORT-gel-questions-sans-surface.md) : la
// seule surface capable d'afficher une question d'agent était l'onglet 🧭
// Assistant. Quand cet onglet n'était pas ouvert, la question n'était peinte
// NULLE PART et l'attente restait ouverte (jusqu'au plafond de 45 min côté
// Rust) : l'agent ne travaillait plus et la file du projet restait réservée.
//
// Cette surface est enregistrée AVEC L'APPLICATION (main.js), pas à l'ouverture
// d'un onglet. Elle n'affiche RIEN quand l'onglet 🧭 est ouvert : la décision
// « qui peint » vit dans `agent-question-surface.js` (module pur, source
// unique) et l'onglet garde la priorité — mêmes boutons, même file de questions,
// aucun double affichage.
//
// Elle RÉUTILISE ce qui existe, elle ne crée pas un second mécanisme :
//   - les dialogues de choix de l'application (`domSelect` / `domConfirm` /
//     `domPrompt` / `domMultiSelect` d'agent-pi.js, mêmes boutons que l'onglet) ;
//   - le ROUTAGE de la réponse vers LA session agent concernée
//     (`respondAgentRelay` de super-agent.js → `send_agent_command_to`) ;
//   - le filet des sentinelles machine (`machine-sentinel.js`) : une sentinelle
//     `PILOT_*::` n'est jamais peinte.
// Aucune réponse n'est décidée à la place de l'utilisateur.

import { AGENT_RELAY_EVENT } from "./agent-choice-relay.js";
import {
  AGENT_QUESTION_SURFACE_DIALOG,
  AGENT_QUESTION_SURFACE_NONE,
  agentQuestionAnswer,
  agentQuestionHeadline,
  agentQuestionView,
  claimAgentQuestion,
  decideAgentQuestionSurface,
  hasPrimaryAgentQuestionSurface,
  releaseAgentQuestion,
} from "./agent-question-surface.js";

/** Écouteur posé (idempotence de `initAgentQuestionFallback`). */
let installedListener = null;
/** Fonction de dialogue en service (injectable pour les tests). */
let activeAsk = null;

/**
 * Dialogue de choix par DÉFAUT : les dialogues EXISTANTS de l'application.
 * Import dynamique pour que les tests (et le web distant) n'aient pas à charger
 * l'onglet agent entier, et pour ne rien charger tant qu'aucune question n'est
 * posée.
 * @param {object} view - vue de la question (`agentQuestionView`)
 * @param {object} detail - `{ payload, agentId, projectPath }`
 * @returns {Promise<unknown>} réponse du dialogue (`null` = annulé)
 */
async function defaultAsk(view, detail) {
  const dialogs = await import("./agent-pi.js");
  const headline = agentQuestionHeadline(detail, view);
  if (view.kind === "confirm") return dialogs.domConfirm(headline, view.message);
  if (view.kind === "multi") return dialogs.domMultiSelect(headline, view.message, view.options);
  if (view.kind === "select") return dialogs.domSelect(headline, view.options);
  if (view.kind === "input") return dialogs.domPrompt(headline, view.placeholder);
  return null;
}

/**
 * Traite une demande de relais de question (`pilot-agent-relay-request`).
 *
 * La prise en charge (`claimAgentQuestion`) est faite AVANT tout `await` : elle
 * est donc visible par l'émetteur (agents-bus.js) juste après l'émission de
 * l'événement, même si le dialogue s'ouvre ensuite.
 *
 * @param {object} detail - `{ payload, agentId, projectPath }`
 * @param {Function} [ask] - dialogue utilisé (défaut : `defaultAsk`)
 * @param {Function} [respond] - routage de la réponse (défaut : `respondAgentRelay`
 *   de super-agent.js → `send_agent_command_to`, c'est-à-dire LE MÊME endroit du
 *   bus que la réponse donnée dans l'onglet 🧭). Injectable pour les tests.
 * @returns {Promise<{servie:boolean, surface:string}>}
 */
export async function handleAgentQuestionRequest(detail, ask, respond) {
  const d = detail || {};
  const payload = d.payload || {};
  const surface = decideAgentQuestionSurface({
    primarySurface: hasPrimaryAgentQuestionSurface(),
    appDialogAvailable: typeof (ask || activeAsk) === "function",
  });
  if (surface !== AGENT_QUESTION_SURFACE_DIALOG) {
    // L'onglet 🧭 est ouvert (il peint) ou aucune surface (l'émetteur termine
    // l'attente) : cette surface ne fait rien, jamais deux affichages.
    return { servie: false, surface };
  }
  if (!claimAgentQuestion(d, AGENT_QUESTION_SURFACE_DIALOG)) {
    return { servie: false, surface: AGENT_QUESTION_SURFACE_NONE };
  }

  const view = agentQuestionView(payload);
  const send = async (cancelled, value) => {
    if (typeof respond === "function") {
      await respond({ projectPath: d.projectPath, agentId: d.agentId, id: payload.id, value, cancelled });
      return;
    }
    // Point UNIQUE du routage réel : la même fonction que la réponse donnée dans
    // l'onglet 🧭 (aucun second mécanisme de réponse).
    const { respondAgentRelay } = await import("./super-agent.js");
    await respondAgentRelay(d.projectPath, d.agentId, payload.id, value, cancelled);
  };
  const answer = async (value) => {
    const { cancelled, value: payloadValue } = agentQuestionAnswer(view, value);
    await send(cancelled, payloadValue);
  };

  try {
    if (view.kind === "machine") {
      // Rien à demander à l'utilisateur, et une sentinelle n'est JAMAIS peinte
      // (machine-sentinel.js) : on répond la phrase explicite de la vue.
      await send(false, view.answer);
    } else if (view.kind === "unsupported") {
      // Méthode sans question posable ici : refus explicite, jamais un silence.
      await answer(null);
    } else {
      await answer(await (ask || activeAsk)(view, d));
    }
  } catch (err) {
    // Un dialogue qui échoue ne doit pas relancer l'attente infinie : la
    // demande est REFUSÉE explicitement (jamais approuvée), et l'échec est dit.
    console.error("[agent-question-fallback] dialogue impossible :", err);
    try {
      await answer(null);
    } catch (_) {
      // L'émetteur a déjà été informé par le registre (« prise en charge »).
    }
  } finally {
    releaseAgentQuestion(d);
  }
  return { servie: true, surface: AGENT_QUESTION_SURFACE_DIALOG };
}

/**
 * Installe la surface de secours AU NIVEAU DE L'APPLICATION (main.js), afin
 * qu'une question d'agent trouve toujours un porteur même sans onglet 🧭.
 * Idempotent : un second appel ne pose pas un second écouteur (garantie « un
 * seul écouteur par question »).
 * @param {{ask?: Function, respond?: Function}} [options] - `ask` / `respond` :
 *   dialogue et routage injectés (tests)
 * @returns {() => void} désinstallation
 */
export function initAgentQuestionFallback(options = {}) {
  const ask = options && typeof options.ask === "function" ? options.ask : defaultAsk;
  const respond = options && typeof options.respond === "function" ? options.respond : null;
  activeAsk = ask;
  if (installedListener) return uninstallAgentQuestionFallback;
  installedListener = (event) => {
    void handleAgentQuestionRequest(event && event.detail, ask, respond);
  };
  window.addEventListener(AGENT_RELAY_EVENT, installedListener);
  return uninstallAgentQuestionFallback;
}

/** Retire l'écouteur de secours (idempotent). */
export function uninstallAgentQuestionFallback() {
  if (installedListener) {
    try {
      window.removeEventListener(AGENT_RELAY_EVENT, installedListener);
    } catch (_) {
      // Environnement sans DOM : rien à retirer.
    }
    installedListener = null;
  }
  activeAsk = null;
}
