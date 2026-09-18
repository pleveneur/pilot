// telegram-questions.js — Telegram, étape 2, LOT 1 : répondre depuis Telegram
// aux questions de l'assistant.
//
// Quand l'Assistant (ou un agent relayé dans son onglet) pose une question
// (choix simple, confirmation, saisie libre, choix multiple), la question est
// AUSSI envoyée sur Telegram via la passerelle d'envoi EXISTANTE
// (`telegram_notify`). Le propriétaire répond en texte :
//   - un numéro (« 1 », « 2 »…) sélectionne l'option correspondante ;
//   - pour une CONFIRMATION, un accord clair (« oui », « ok », « vas-y »…) vaut
//     confirmation et un refus clair (« non », « annule », « stop »…) vaut
//     refus ; un texte ambigu ne tranche RIEN (la question est reposée) ;
//   - tout autre texte est pris comme réponse libre (valeur pour une saisie,
//     précision pour un choix).
// La réponse revient dans Pilot par le MÊME chemin qu'une réponse donnée dans
// l'application (le `resolve` fourni par l'appelant appelle `q.submit`).
//
// Garanties :
//   - la PREMIÈRE réponse gagne (application OU Telegram) : l'autre voie est
//     ignorée proprement, sans double réponse, sans erreur, sans alerte ;
//     la question est marquée répondue AVANT l'envoi applicatif, pour qu'une
//     réponse Telegram arrivant PENDANT cet envoi soit refusée (course) ;
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
    lines.push(
      descriptor.kind === "confirm"
        ? "Répondez par le numéro correspondant (ou par « oui » / « non »)."
        : "Répondez par le numéro correspondant.",
    );
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

// ── Interprétation d'un texte libre répondant à une CONFIRMATION ───────────
// Une confirmation est une PORTE : « non » ne doit JAMAIS valoir « oui ». Le
// texte reçu est donc classé AVANT toute décision :
//   - accord clair → confirmation ;
//   - refus clair → refus ;
//   - texte ambigu / hors sujet → AUCUNE décision : la question reste posée et
//     est reposée (le propriétaire peut répondre « 1 » / « 2 » ou reformuler).
// Les listes sont volontairement COURTES et explicites : mieux vaut redemander
// que de deviner à la place du propriétaire.
const CONFIRM_YES_TEXTS = new Set([
  "oui", "ouais", "ouaip", "yep", "y", "yes", "ok", "okay", "okey",
  "d'accord", "daccord", "dac", "accord", "entendu", "parfait", "confirme",
  "confirmer", "je confirme", "vas-y", "vasy", "vas y", "go", "valide",
  "valider", "je valide", "je suis d'accord", "c'est d'accord", "ja",
  "si", "sí", "bien sûr", "bien sur",
]);
const CONFIRM_NO_TEXTS = new Set([
  "non", "nan", "nope", "no", "n", "annule", "annuler", "annulé",
  "abandonne", "abandonner", "stop", "stoppe", "halte", "laisse tomber",
  "laisse-tomber", "laisse", "pas maintenant", "pas pour l'instant", "plus tard",
  "surtout pas", "surtout-pas", "jamais", "refuse", "refuser", "refusé",
  "no way", "negatif", "négatif",
]);

/** Normalise un texte pour la comparaison (minuscules, apostrophes, ponctuation). */
function normalizeConfirmText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[.,;:!?\u2026]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classe un texte libre adressé à une question de CONFIRMATION.
 * Fonction PURE.
 * @param {string} text
 * @returns {{kind: "empty"} | {kind: "decision", confirmed: boolean, value: string} | {kind: "undecided", value: string}}
 */
export function interpretConfirmationText(text) {
  const raw = String(text ?? "").trim();
  const norm = normalizeConfirmText(raw);
  if (!norm) return { kind: "empty" };
  if (CONFIRM_YES_TEXTS.has(norm)) return { kind: "decision", confirmed: true, value: raw };
  if (CONFIRM_NO_TEXTS.has(norm)) return { kind: "decision", confirmed: false, value: raw };
  return { kind: "undecided", value: raw };
}

/** Vrai si le descripteur décrit une question de confirmation (Oui / Non). */
function isConfirmDescriptor(descriptor) {
  if (descriptor && descriptor.kind === "confirm") return true;
  const options = Array.isArray(descriptor && descriptor.options) ? descriptor.options : [];
  return options.length === 2 && options[0] === "Oui" && options[1] === "Non";
}

/**
 * Interprète un message reçu du propriétaire comme réponse à la question :
 *   - vide → `{ kind: "empty" }` (aucune réponse à appliquer) ;
 *   - numéro valide → `{ kind: "option", index, value }` ;
 *   - confirmation (Oui / Non) + texte → `{ kind: "decision", confirmed }`
 *     pour un accord / refus clair, `{ kind: "undecided" }` sinon (la question
 *     reste posée, elle est reposée) ; jamais de confirmation par défaut ;
 *   - autre texte (y compris un numéro hors plage) → `{ kind: "text", value }`.
 * Fonction PURE.
 * @param {string} text
 * @param {{kind?: string, options?: string[]}} [descriptor]
 * @returns {{kind: "empty"} | {kind: "option", index: number, value: string} | {kind: "decision", confirmed: boolean, value: string} | {kind: "undecided", value: string} | {kind: "text", value: string}}
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
  // Confirmation : le texte est interprété (accord / refus / ambigu), jamais
  // utilisé comme « note » valant accord par défaut.
  if (isConfirmDescriptor(descriptor)) return interpretConfirmationText(raw);
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
 *   reopen: (question?: object) => void,
 *   answerFromApp: (question: object, apply: () => unknown) => Promise<{applied: boolean, value?: unknown}>,
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

  // Question active : { question, descriptor, resolve, resolved, reminderSent }.
  // Après résolution on CONSERVE l'entrée (`resolved: true`) pour qu'une réponse
  // tardive ne soit pas ré-interprétée contre une question suivante : elle est
  // alors REFUSÉE par `feed` et devient un message libre de la conversation (le
  // comportement observé de l'étape 2, lot 1).
  let active = null;
  let reminder = null;

  function clearReminder() {
    if (reminder !== null) {
      timers.clearTimeout(reminder);
      reminder = null;
    }
  }

  /** Arme l'unique rappel si la question est encore ouverte et sans rappel émis. */
  function armReminder() {
    if (!active || active.reminderSent) return;
    clearReminder();
    reminder = timers.setTimeout(() => {
      reminder = null;
      if (active && !active.resolved) {
        fire(formatQuestionReminder(active.descriptor));
        active.reminderSent = true;
      }
    }, reminderMs);
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
    active = {
      question,
      descriptor: descriptor || {},
      resolve,
      resolved: false,
      // Course « première réponse gagne » (voir `answerFromApp`) :
      //   - `applying` : une application de réponse est EN COURS (réservation
      //     synchrone posée avant tout await) ;
      //   - `answered` : l'application du gagnant est TERMINÉE (question close).
      // Ces deux états rendent une SECONDE soumission (autre clic, réponse
      // Telegram) inopérante, sans jamais bloquer le flux gagnant.
      applying: false,
      answered: false,
      reminderSent: false,
    };
    fire(formatQuestionForTelegram(active.descriptor));
    armReminder();
  }

  /**
   * Marque la question comme résolue dans l'application (première réponse
   * gagne). Sans argument, résout la question active. Une réponse Telegram
   * arrivant ensuite n'est plus acceptée comme réponse (`feed` renvoie faux) :
   * elle est déposée comme message libre dans la conversation de l'Assistant.
   */
  function settle(question) {
    if (active && (question === undefined || active.question === question)) {
      active.resolved = true;
      // La question est close : une réponse (applicative ou Telegram) arrivant
      // ensuite ne doit plus rien appliquer (première réponse gagne).
      active.answered = true;
      clearReminder();
    }
  }

  /**
   * Rouvre la question active (l'envoi applicatif a ÉCHOUÉ) : la barre reste
   * affichée et une réponse Telegram doit rester acceptée. Réarme l'unique
   * rappel s'il n'a pas encore été émis.
   */
  function reopen(question) {
    if (!active || (question !== undefined && active.question !== question)) return;
    if (!active.resolved) return;
    active.resolved = false;
    armReminder();
  }

  /**
   * Répond à la question ACTIVE depuis l'application en garantissant la
   * « première réponse gagne » face à TOUTE réponse concurrente (autre clic très
   * rapproché, réponse Telegram) : la question est RÉSERVÉE (marquée résolue et
   * « application en cours ») AVANT d'appeler `apply` — sans aucun await avant
   * la réservation. Deux soumissions enchaînées sans attente ne peuvent donc pas
   * produire deux réponses : la seconde est inopérante (`{ applied: false }`).
   * Le marquage laisse passer le flux gagnant (notamment la réponse Telegram,
   * dont l'application aval revient ici). En cas d'échec de l'envoi, la question
   * est rouverte (Telegram reste utilisable) et la réservation est libérée.
   * @returns {Promise<{applied: boolean, value?: unknown}>}
   */
  async function answerFromApp(question, apply) {
    if (!active || (question !== undefined && active.question !== question)) {
      return { applied: false };
    }
    // Déjà répondue et appliquée, ou une application est déjà en cours (ce flux
    // ou un flux concurrent) → la seconde soumission est inopérante.
    if (active.answered || active.applying) return { applied: false };
    // Réservation SYNCHRONE (aucun await avant) : c'est elle qui rend la
    // seconde réponse inopérante, y compris si elle arrive « en même temps ».
    active.resolved = true;
    active.applying = true;
    clearReminder();
    try {
      const value = await apply();
      if (active && active.question === question) active.answered = true;
      return { applied: true, value };
    } catch (e) {
      reopen(question);
      throw e;
    } finally {
      if (active && active.question === question) active.applying = false;
    }
  }

  /**
   * Tente d'appliquer un message entrant comme réponse à la question active.
   * Sur une CONFIRMATION, un texte ambigu ne tranche RIEN : la question reste
   * posée et est reposée (avec ses choix) ; le message est tout de même
   * « consommé » (il n'est pas déposé comme message libre dans la conversation,
   * pour ne pas faire répondre l'assistant en parallèle de sa propre question).
   * @returns {boolean} vrai si le message a été consommé comme réponse (ou
   *   comme tentative de réponse non tranchée).
   */
  function feed(text) {
    if (!active || active.resolved) return false;
    const parsed = parseTelegramAnswer(text, active.descriptor);
    if (parsed.kind === "empty") return false;
    if (parsed.kind === "undecided") {
      // Aucune décision (porte de confirmation) : on repose la question pour
      // que le propriétaire puisse répondre « 1 » / « 2 » ou reformuler.
      fire(formatQuestionForTelegram(active.descriptor));
      return true;
    }
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

  return { ask, settle, reopen, answerFromApp, feed, clear, current: () => active };
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

/**
 * Répond à la question depuis l'application en marquant d'abord la question
 * résolue (course « première réponse gagne »), puis en appliquant la réponse.
 * En cas d'échec de l'application, la question est rouverte.
 * @param {object} question - identité de la question (tête de file).
 * @param {() => unknown} apply - application de la réponse (envoi asynchrone).
 * @param {object} [bridge] - passerelle (défaut : la passerelle partagée).
 * @returns {Promise<{applied: boolean, value?: unknown}>}
 */
export function answerTelegramQuestionFromApp(question, apply, bridge) {
  return (bridge || telegramQuestionBridge).answerFromApp(question, apply);
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
