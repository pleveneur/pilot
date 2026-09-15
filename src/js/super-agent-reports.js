// super-agent-reports.js — Porte d'accusé de lecture des comptes rendus
// injectés à l'Assistant (module PUR, testable — extrait de super-agent.js).
//
// Problème corrigé : `inject_session_summary` (Rust) marque un compte rendu
// `delivered = 1` dès que la session super-agent est vivante et non occupée.
// Or `agent_process_busy` côté backend ne passe à vrai qu'à l'`agent_start` de
// pi : entre l'envoi d'un message par l'utilisateur (flag front `backendBusy`
// posé immédiatement) et cet `agent_start`, le backend croit l'assistant libre.
// Un compte rendu transmis dans cette fenêtre est donc marqué « livré » alors
// que pi, en pleine génération, ignore silencieusement le nouveau prompt →
// compte rendu perdu ET réputé reçu.
//
// Remède : ne transmettre que si l'assistant est RÉELLEMENT libre (flag front
// fiable `backendBusy === false`) ; sinon mettre le compte rendu en file (NON
// consommé) et le rejouer dès la libération.
//
// Ce module ne connaît ni Tauri ni le DOM : il reçoit `isBusy` et `send` en
// dépendances, ce qui le rend entièrement testable.

/**
 * Crée la porte de livraison des comptes rendus.
 * @param {object} opts
 * @param {() => boolean} opts.isBusy - vrai si l'assistant est en train de
 *   générer (occupé). Tant qu'il est vrai, aucun envoi n'est tenté.
 * @param {(entry: object) => Promise<unknown>} opts.send - livraison RÉELLE
 *   d'une entrée (invoke `inject_session_summary` + traitement associé). N'est
 *   appelée que lorsque l'assistant est libre.
 * @returns {{
 *   deliver: (entry: object) => Promise<"delivered"|"queued">,
 *   flush: () => Promise<"flushed"|"busy"|"empty"|"in-flight">,
 *   pendingCount: () => number,
 *   reset: () => void,
 * }}
 */
export function createReportDeliveryGate({ isBusy, send }) {
  const queue = [];
  let flushing = false;

  /**
   * Transmet une entrée si l'assistant est libre ; sinon la met en file.
   * @param {object} entry - { summary, projectPath, category, ... }
   * @returns {Promise<"delivered"|"queued">}
   */
  async function deliver(entry) {
    if (isBusy()) {
      queue.push(entry);
      return "queued";
    }
    await send(entry);
    return "delivered";
  }

  /**
   * Rejoue la première entrée en attente si l'assistant est libre. Traite une
   * seule entrée par appel (les appels suivants — fin de tour, poll, libération
   * suivante — drainent le reste). No-op si déjà occupé, si la file est vide, ou
   * si un flush est déjà en cours (pas de doublon/désordre).
   * @returns {Promise<"flushed"|"busy"|"empty"|"in-flight">}
   */
  async function flush() {
    if (flushing) return "in-flight";
    if (queue.length === 0) return "empty";
    if (isBusy()) return "busy";
    flushing = true;
    try {
      // Re-vérifie l'état au moment du shift (l'assistant peut s'être occupé
      // entre-temps) : on ne retire l'entrée qu'au moment de l'envoi.
      if (isBusy() || queue.length === 0) return "busy";
      await send(queue.shift());
      return "flushed";
    } finally {
      flushing = false;
    }
  }

  return {
    deliver,
    flush,
    pendingCount: () => queue.length,
    reset: () => {
      queue.length = 0;
      flushing = false;
    },
  };
}
