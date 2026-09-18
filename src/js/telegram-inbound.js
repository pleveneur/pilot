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
//     durable réussie de chaque message : rien n'est perdu (un message non remis
//     est relu à la passe suivante), rien n'est relu deux fois (le curseur des
//     messages déjà remis est mémorisé).
//
// Tout est défensif : un échec (réseau, backend, commande) n'affiche AUCUNE
// erreur à l'utilisateur et ne perturbe jamais le reste de l'application.

import { invoke } from "@tauri-apps/api/core";
import { injectExternalMessageToSuperAgent } from "./super-agent.js";

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
 * @param {number} [deps.intervalMs]
 * @param {{setInterval: Function, clearInterval: Function}} [deps.timers]
 * @param {(...args: unknown[]) => void} [deps.warn] - journalisation silencieuse.
 * @returns {{start: Function, stop: Function, pollOnce: Function, isRunning: Function}}
 */
export function createTelegramInbound(deps = {}) {
  const invokeFn = deps.invokeFn || ((cmd, args) => invoke(cmd, args));
  const deliver = deps.deliver || ((text) => injectExternalMessageToSuperAgent(text));
  const intervalMs = deps.intervalMs || TELEGRAM_INBOUND_INTERVAL_MS;
  const timers = deps.timers || { setInterval, clearInterval };
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
      for (const message of messages) {
        const text = (message && message.text) || "";
        const updateId = message && typeof message.updateId === "number" ? message.updateId : null;
        if (!text.trim()) {
          // Rien à remettre : on valide tout de même le curseur pour ne pas
          // relire indéfiniment ce message.
          await commit(updateId === null ? null : updateId + 1, updateId);
          continue;
        }
        try {
          await deliver(formatTelegramInboundText(text));
        } catch (e) {
          // Remise impossible : on N'avance PAS le curseur → ce message (et les
          // suivants) sera relu à la passe suivante. Aucune perte.
          warn("[telegram-inbound] remise impossible (message relu ensuite) :", e);
          break;
        }
        delivered += 1;
        await commit(updateId === null ? null : updateId + 1, updateId);
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
