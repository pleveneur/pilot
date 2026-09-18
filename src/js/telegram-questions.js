// telegram-questions.js — Telegram, étape 2, LOT 1 : répondre depuis Telegram
// aux questions de l'assistant.
//
// Quand l'Assistant (ou un agent relayé dans son onglet) pose une question
// (choix simple, confirmation, saisie libre, choix multiple), la question est
// AUSSI envoyée sur Telegram via la passerelle d'envoi EXISTANTE
// (`telegram_notify`). Le propriétaire répond en texte :
//   - un numéro (« 1 », « 2 »…) sélectionne l'option correspondante ;
//   - tout autre texte est pris comme réponse libre (valeur pour une saisie,
//     précision pour un choix / une confirmation).
// La réponse revient dans Pilot par le MÊME chemin qu'une réponse donnée dans
// l'application (le `resolve` fourni par l'appelant appelle `q.submit`).
//
// Garanties :
//   - la PREMIÈRE réponse gagne (application OU Telegram) : l'autre voie est
//     ignorée proprement, sans double réponse, sans erreur, sans alerte ;
//   - si aucune réponse n'arrive, la question reste posée (aucune expiration
//     automatique) et UN SEUL rappel discret est envoyé après quelques minutes ;
//   - inertie : rien n'est tenté quand la passerelle n'est pas configurée
//     (`telegram_notify` est inerte côté Rust) et aucun échec n'est visible ;
//   - le jeton n'est jamais manipulé ici (il vit uniquement côté Rust).
//
// Le cœur est PUR (formatage + interprétation) et la passerelle a ses
// dépendances INJECTÉES : testable sans réseau, sans Tauri et sans horloge.

import { invoke } from "@tauri-apps/api/core";

/** Délai avant l'unique rappel discret (« quelques minutes »). */
export const TELEGRAM_QUESTION_REMINDER_MS = 3 * 60 * 1000;

/**
 * Met en forme la question pour Telegram : le titre, le message éventuel, puis
 * la liste numérotée des options quand il y en a. Sans options (saisie libre),
 * on invite simplement à répondre en texte. Fonction PURE.
 * @param {{title?: string, message?: string, options?: string[]}} [descriptor]
 * @returns {string}
 */
export function formatQuestionForTelegram(descriptor = {}) {
  const title = String(descriptor.title || "Question").trim() || "Question";
  const lines = [`❓ ${title}`];
  const message = String(descriptor.message || "").trim();
  if (message) lines.push(message);
  const options = Array.isArray(descriptor.options) ? descriptor.options : [];
  if (options.length) {
    options.forEach((opt, i) => lines.push(`${i + 1}. ${String(opt)}`));
    lines.push("Répondez par le numéro correspondant.");
  } else {
    lines.push("Répondez par un message texte.");
  }
  return lines.join("\n");
}

/**
 * Rappel discret (UNE seule fois) quand la question est toujours sans réponse.
 * Fonction PURE.
 * @param {{title?: string, message?: string, options?: string[]}} [descriptor]
 * @returns {string}
 */
export function formatQuestionReminder(descriptor = {}) {
  return `⏳ Toujours en attente de votre réponse :\n${formatQuestionForTelegram(descriptor)}`;
}

/**
 * Interprète un message reçu du propriétaire comme réponse à la question :
 *   - vide → `{ kind: "empty" }` (aucune réponse à appliquer) ;
 *   - numéro valide → `{ kind: "option", index, value }` ;
 *   - autre texte (y compris un numéro hors plage) → `{ kind: "text", value }`.
 * Fonction PURE.
 * @param {string} text
 * @param {{options?: string[]}} [descriptor]
 * @returns {{kind: "empty"} | {kind: "option", index: number, value: string} | {kind: "text", value: string}}
 */
export function parseTelegramAnswer(text, descriptor = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) return { kind: "empty" };
  const options = Array.isArray(descriptor.options) ? descriptor.options : [];
  const match = /^(\d+)[.)]?$/.exec(raw);
  if (match) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < options.length) {
      return { kind: "option", index, value: String(options[index]) };
    }
  }
  return { kind: "text", value: raw };
}

/**
 * Passerelle d'une question vers Telegram et retour de la réponse.
 *
 * @param {object} [deps]
 * @param {(text: string) => unknown} [deps.send] - envoi (passerelle existante).
 * @param {number} [deps.reminderMs] - délai de l'unique rappel.
 * @param {{setTimeout: Function, clearTimeout: Function}} [deps.timers]
 * @param {(...args: unknown[]) => void} [deps.warn] - journalisation silencieuse.
 * @returns {{
 *   ask: (question: object, descriptor: object, resolve: (parsed: object) => unknown) => void,
 *   settle: (question?: object) => void,
 *   feed: (text: string) => boolean,
 *   clear: () => void,
 *   current: () => object|null,
 * }}
 */
export function createTelegramQuestionBridge(deps = {}) {
  const send = deps.send || (() => {});
  const reminderMs = Number.isFinite(deps.reminderMs)
    ? deps.reminderMs
    : TELEGRAM_QUESTION_REMINDER_MS;
  const timers = deps.timers || { setTimeout, clearTimeout };
  const warn = deps.warn || (() => {});

  // Question active : { question, descriptor, resolve, resolved }.
  // Après résolution on CONSERVE l'entrée (`resolved: true`) pour qu'une réponse
  // tardive soit ignorée au lieu d'être ré-interprétée contre une question
  // suivante ou déposée dans la conversation.
  let active = null;
  let reminder = null;

  function clearReminder() {
    if (reminder !== null) {
      timers.clearTimeout(reminder);
      reminder = null;
    }
  }

  /** Envoi silencieux : un échec n'est jamais visible et n'interrompt rien. */
  function fire(text) {
    try {
      const result = send(text);
      if (result && typeof result.catch === "function") {
        result.catch((e) => warn("[telegram-questions] envoi ignoré :", e));
      }
    } catch (e) {
      warn("[telegram-questions] envoi ignoré :", e);
    }
  }

  /** Publie une nouvelle question : envoi immédiat + unique rappel planifié. */
  function ask(question, descriptor, resolve) {
    clearReminder();
    active = { question, descriptor: descriptor || {}, resolve, resolved: false };
    fire(formatQuestionForTelegram(active.descriptor));
    reminder = timers.setTimeout(() => {
      reminder = null;
      if (active && !active.resolved) fire(formatQuestionReminder(active.descriptor));
    }, reminderMs);
  }

  /**
   * Marque la question comme résolue dans l'application (première réponse
   * gagne) : un message Telegram ultérieur sera ignoré. Sans argument, résout
   * la question active.
   */
  function settle(question) {
    if (active && (question === undefined || active.question === question)) {
      active.resolved = true;
      clearReminder();
    }
  }

  /**
   * Tente d'appliquer un message entrant comme réponse à la question active.
   * @returns {boolean} vrai si le message a été consommé comme réponse.
   */
  function feed(text) {
    if (!active || active.resolved) return false;
    const parsed = parseTelegramAnswer(text, active.descriptor);
    if (parsed.kind === "empty") return false;
    // Première réponse gagne : on marque AVANT d'appliquer (anti-réentrance).
    active.resolved = true;
    clearReminder();
    const entry = active;
    try {
      const result = entry.resolve(parsed);
      if (result && typeof result.catch === "function") {
        result.catch((e) => warn("[telegram-questions] réponse ignorée :", e));
      }
    } catch (e) {
      warn("[telegram-questions] réponse ignorée :", e);
    }
    return true;
  }

  /** Oublie la question active (fermeture de l'onglet, nouvelle session…). */
  function clear() {
    clearReminder();
    active = null;
  }

  return { ask, settle, feed, clear, current: () => active };
}

/** Envoi réel : passerelle d'envoi EXISTANTE (inerte si non configurée). */
function defaultSend(text) {
  return invoke("telegram_notify", { text });
}

/** Passerelle partagée par l'application (un seul état de question active). */
export const telegramQuestionBridge = createTelegramQuestionBridge({
  send: defaultSend,
});

/** Publie la question active (appelé par l'onglet Assistant). */
export function askTelegramQuestion(question, descriptor, resolve) {
  telegramQuestionBridge.ask(question, descriptor, resolve);
}

/** Marque la question comme résolue dans l'application (première réponse). */
export function settleTelegramQuestion(question) {
  telegramQuestionBridge.settle(question);
}

/** Oublie la question active (fermeture de l'onglet / nouvelle session). */
export function clearTelegramQuestion() {
  telegramQuestionBridge.clear();
}

/**
 * Consomme un message Telegram entrant comme réponse à la question en cours.
 * @returns {boolean} vrai si le message était une réponse (à ne PAS déposer
 *   dans la conversation de l'Assistant).
 */
export function consumeTelegramQuestionAnswer(text) {
  return telegramQuestionBridge.feed(text);
}
