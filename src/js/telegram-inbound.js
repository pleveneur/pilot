// telegram-inbound.js — Écoute Telegram (étape 2, lot 0 : socle d'écoute).
//
// Pilot LIT les messages que le propriétaire écrit à son bot Telegram et les
// remet à la conversation de l'Assistant. Ce module est DÉMARRÉ AVEC
// L'APPLICATION (voir main.js) : il ne dépend PAS de l'ouverture de l'onglet 🧭.
//
// Répartition des responsabilités :
//   - la réception vit côté Rust (`telegram_poll_inbound`) : filtrage strict sur
//     l'identifiant de discussion du propriétaire (les autres expéditeurs sont
//     ignorés silencieusement, sans jamais recevoir de réponse), inertie totale
//     quand la passerelle n'est pas configurée (aucun accès réseau, aucune
//     erreur), jeton jamais journalisé ;
//   - la remise réutilise le mécanisme EXISTANT des comptes rendus d'agents
//     (`injectExternalMessageToSuperAgent` → porte durable) : le message est
//     d'abord écrit en attente en base, puis délivré dès que l'assistant est
//     libre. Rien n'est perdu si l'assistant est occupé ou fermé ;
//   - le curseur n'est validé (`telegram_inbound_commit`) QU'APRÈS la remise
//     durable réussie de chaque message : un message non remis est relu à la
//     passe suivante (aucune perte). À la fin d'une passe où TOUS les messages
//     ont été traités, le curseur avance jusqu'au dernier update VU
//     (`nextOffset`, updates ÉCARTÉS côté Rust compris : autre expéditeur,
//     message sans texte) pour ne pas les relire indéfiniment. Il ne dépasse
//     donc jamais le dernier message réellement vu ; en cas d'échec de remise,
//     il reste en arrière.
//   - la mémorisation est BEST-EFFORT (sémantique « au moins une fois ») : si
//     l'écriture du curseur échoue, le message est relu à la passe suivante et
//     donc remis DEUX fois — un doublon reste préférable à une perte.
//   - un message sans texte (photo, sticker, texte vide) est simplement ÉCARTÉ
//     par le Rust : il n'est jamais remonté ni remis, seul le curseur avance.
//
// Tout est défensif : un échec (réseau, backend, commande) n'affiche AUCUNE
// erreur à l'utilisateur et ne perturbe jamais le reste de l'application.

import { invoke } from "@tauri-apps/api/core";
import { injectExternalMessageToSuperAgent } from "./super-agent.js";
import { consumeTelegramQuestionAnswer } from "./telegram-questions.js";

/** Intervalle d'interrogation (court : l'utilisateur attend une réaction). */
export const TELEGRAM_INBOUND_INTERVAL_MS = 4000;

/**
 * Habille le texte reçu pour que l'Assistant sache d'où il vient.
 * @param {string} text
 * @returns {string}
 */
export function formatTelegramInboundText(text) {
  return `[Message Telegram de l'utilisateur] ${String(text || "").trim()}`.trimEnd();
}

/**
 * Crée l'écoute Telegram avec ses dépendances INJECTÉES (testable sans réseau,
 * sans Tauri et sans minuteur réel).
 *
 * @param {object} [deps]
 * @param {(cmd: string, args?: object) => Promise<unknown>} [deps.invokeFn]
 *   appel des commandes Rust de réception / validation du curseur.
 * @param {(text: string) => Promise<unknown>} [deps.deliver]
 *   remise à la conversation de l'Assistant (porte durable).
 * @param {(text: string) => boolean} [deps.consumeAnswer]
 *   tente d'appliquer le message comme RÉPONSE à une question en cours de
 *   l'Assistant (étape 2, lot 1). Renvoie vrai si le message a été consommé
 *   (il n'est alors PAS déposé dans la conversation).
 * @param {number} [deps.intervalMs]
 * @param {{setInterval: Function, clearInterval: Function}} [deps.timers]
 * @param {(...args: unknown[]) => void} [deps.warn] - journalisation silencieuse.
 * @returns {{start: Function, stop: Function, pollOnce: Function, isRunning: Function}}
 */
export function createTelegramInbound(deps = {}) {
  const invokeFn = deps.invokeFn || ((cmd, args) => invoke(cmd, args));
  const deliver = deps.deliver || ((text) => injectExternalMessageToSuperAgent(text));
  const consumeAnswer = deps.consumeAnswer || consumeTelegramQuestionAnswer;
  const intervalMs = deps.intervalMs || TELEGRAM_INBOUND_INTERVAL_MS;
  // Minuteurs par défaut : de petites flèches rappellent les fonctions natives
  // via l'objet global. Un raccourci d'objet (`{ setInterval, clearInterval }`)
  // détacherait les fonctions de leur objet d'origine et l'appel en méthode
  // (`timers.setInterval(...)`) lèverait « Illegal invocation » : le chemin par
  // défaut — celui réellement utilisé par l'application — doit fonctionner sans
  // aucune injection. Les minuteurs restent injectables pour les tests.
  const timers = deps.timers || {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
  };
  const warn = deps.warn || ((...args) => console.warn(...args));

  let handle = null;
  let inFlight = false;
  let committed = null;

  /**
   * Mémorise le curseur après remise réussie. Jamais bloquant, jamais visible.
   * @param {number|null} nextCursor
   * @returns {Promise<void>}
   */
  async function commit(nextCursor, updateId) {
    if (typeof nextCursor !== "number" || !Number.isFinite(nextCursor)) return;
    try {
      await invokeFn("telegram_inbound_commit", { offset: nextCursor });
      committed = { updateId, offset: nextCursor };
    } catch (e) {
      warn("[telegram-inbound] curseur non mémorisé (message relu ensuite) :", e);
    }
  }

  /**
   * Une passe : interroge la réception, remet chaque message du propriétaire à
   * l'assistant, puis valide le curseur. Ne lève JAMAIS d'erreur (un échec est
   * silencieux) et renvoie le nombre de messages effectivement remis.
   *
   * @returns {Promise<number>}
   */
  async function pollOnce() {
    if (inFlight) return 0; // jamais deux passes concurrentes
    inFlight = true;
    try {
      const res = await invokeFn("telegram_poll_inbound");
      const messages = (res && res.messages) || [];
      let delivered = 0;
      let failed = false;
      for (const message of messages) {
        const text = (message && message.text) || "";
        const updateId = message && typeof message.updateId === "number" ? message.updateId : null;
        if (!text.trim()) {
          // Rien à remettre : on valide tout de même le curseur pour ne pas
          // relire indéfiniment ce message.
          await commit(updateId === null ? null : updateId + 1, updateId);
          continue;
        }
        // Étape 2, lot 1 : si une question de l'Assistant attend une réponse, le
        // message est interprété comme CETTE réponse (même chemin que dans
        // l'application) et n'est PAS déposé dans la conversation.
        let consumed = false;
        try {
          consumed = consumeAnswer(text) === true;
        } catch (e) {
          warn("[telegram-inbound] réponse ignorée :", e);
        }
        if (consumed) {
          delivered += 1;
          await commit(updateId === null ? null : updateId + 1, updateId);
          continue;
        }
        try {
          await deliver(formatTelegramInboundText(text));
        } catch (e) {
          // Remise impossible : on N'avance PAS le curseur → ce message (et les
          // suivants) sera relu à la passe suivante. Aucune perte.
          warn("[telegram-inbound] remise impossible (message relu ensuite) :", e);
          failed = true;
          break;
        }
        delivered += 1;
        await commit(updateId === null ? null : updateId + 1, updateId);
      }
      // Avance le curseur jusqu'au dernier update VU, y compris ceux ÉCARTÉS
      // côté Rust (autre expéditeur, message sans texte) : sans cela ils sont
      // relus à chaque passe. Uniquement si TOUS les messages du lot ont été
      // traités : en cas d'échec de remise, le curseur reste en arrière (le
      // message en échec et les suivants seront relus — aucune perte).
      if (
        !failed &&
        res &&
        typeof res.nextOffset === "number" &&
        Number.isFinite(res.nextOffset) &&
        (!committed || res.nextOffset > committed.offset)
      ) {
        await commit(res.nextOffset, res.nextOffset - 1);
      }
      return delivered;
    } catch (e) {
      // Réception impossible (passerelle en erreur, backend absent…) : ignorée.
      warn("[telegram-inbound] réception ignorée :", e);
      return 0;
    } finally {
      inFlight = false;
    }
  }

  /** Démarre l'interrogation périodique (idempotent). */
  function start() {
    if (handle !== null) return;
    handle = timers.setInterval(() => {
      pollOnce();
    }, intervalMs);
  }

  /** Arrête l'interrogation périodique (idempotent). */
  function stop() {
    if (handle === null) return;
    timers.clearInterval(handle);
    handle = null;
  }

  return {
    start,
    stop,
    pollOnce,
    isRunning: () => handle !== null,
    /** Dernier curseur validé ({ updateId, offset }) — outil de diagnostic/tests. */
    lastCommitted: () => committed,
  };
}

let singleton = null;

/**
 * Démarre l'écoute Telegram pour l'application (idempotent : un seul intervalle
 * quel que soit le nombre d'appels). Appelé UNE FOIS au démarrage de Pilot,
 * INDÉPENDAMMENT de l'onglet 🧭 Assistant.
 * @returns {ReturnType<typeof createTelegramInbound>}
 */
export function initTelegramInbound() {
  if (singleton) return singleton;
  singleton = createTelegramInbound();
  singleton.start();
  return singleton;
}
