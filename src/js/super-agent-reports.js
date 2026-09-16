// super-agent-reports.js — Porte d'accusé de lecture des comptes rendus
// injectés à l'Assistant (module PUR, testable — extrait de super-agent.js).
//
// Deux garanties :
//
// 1) REMISE DURABLE SYSTÉMATIQUE. `inject_session_summary` (Rust) écrit
//    TOUJOURS le compte rendu dans la table durable `session_summaries`
//    (`delivered=0`) avant toute tentative d'injection. La porte doit donc
//    TOUJOURS confier l'entrée à cette remise, y compris quand l'assistant est
//    occupé : sinon rien n'est écrit en base et le compte rendu est perdu si
//    Pilot redémarre ou si l'onglet se ferme (ancienne file EN MÉMOIRE seule).
//
// 2) PAS DE FAUX « LIVRÉ ». `inject_session_summary` marque un compte rendu
//    `delivered = 1` dès que la session super-agent est vivante et non occupée.
//    Or `agent_process_busy` côté backend ne passe à vrai qu'à l'`agent_start`
//    de pi : entre l'envoi d'un message par l'utilisateur (flag front
//    `backendBusy` posé immédiatement) et cet `agent_start`, le backend croit
//    l'assistant libre. Un compte rendu transmis dans cette fenêtre serait
//    marqué « livré » alors que pi, en pleine génération, ignore silencieusement
//    le nouveau prompt → perdu ET réputé reçu. La porte transmet donc `defer`
//    quand l'assistant est occupé : la ligne est écrite mais NON marquée
//    livrée, et le rejeu Rust la délivre dès la libération.
//
// Ce module ne connaît ni Tauri ni le DOM : il reçoit `isBusy`, `send` et
// `replay` en dépendances, ce qui le rend entièrement testable.

/**
 * Crée la porte de livraison des comptes rendus.
 * @param {object} opts
 * @param {() => boolean} opts.isBusy - vrai si l'assistant est en train de
 *   générer (occupé). Tant qu'il est vrai, la remise est faite en mode différé
 *   (`defer`) : écrite en base mais pas marquée livrée.
 * @param {(entry: object, options?: {defer?: boolean}) => Promise<unknown>} opts.send
 *   remise RÉELLE d'une entrée (invoke `inject_session_summary` + traitement
 *   associé). Toujours appelée (avec `defer: true` si l'assistant est occupé).
 * @param {() => Promise<unknown>} [opts.replay] - rejeu des remises différées
 *   (invoke `replay_superagent_summaries`). Appelé par `flush()` quand des
 *   remises différées attendent et que l'assistant est redevenu libre.
 * @returns {{
 *   deliver: (entry: object) => Promise<"delivered"|"queued">,
 *   flush: () => Promise<"flushed"|"busy"|"empty"|"in-flight">,
 *   pendingCount: () => number,
 *   reset: () => void,
 * }}
 */
export function createReportDeliveryGate({ isBusy, send, replay }) {
  // Nombre de remises différées depuis le dernier rejeu (compteur informatif :
  // la source de vérité est la table durable `session_summaries`).
  let pending = 0;
  let flushing = false;

  /**
   * Confie une entrée à la remise durable. Elle est TOUJOURS écrite en base ;
   * `defer` n'affecte que la tentative d'injection immédiate (assistant occupé
   * → reste `delivered=0`, rejoué plus tard).
   * @param {object} entry - { summary, projectPath, category, ... }
   * @returns {Promise<"delivered"|"queued">}
   */
  async function deliver(entry) {
    const busy = isBusy();
    await send(entry, { defer: busy });
    if (busy) {
      pending += 1;
      return "queued";
    }
    return "delivered";
  }

  /**
   * Rejoue les remises différées si l'assistant est libre. No-op si un flush est
   * déjà en cours, si l'assistant est occupé ou si rien n'a été différé.
   * Traite au plus un cycle de rejeu par appel (le rejeu Rust est lui-même borné
   * et anti-doublon).
   * @returns {Promise<"flushed"|"busy"|"empty"|"in-flight">}
   */
  async function flush() {
    if (flushing) return "in-flight";
    if (isBusy()) return "busy";
    if (pending === 0 || !replay) return "empty";
    flushing = true;
    try {
      pending = 0;
      await replay();
      return "flushed";
    } finally {
      flushing = false;
    }
  }

  return {
    deliver,
    flush,
    pendingCount: () => pending,
    reset: () => {
      pending = 0;
      flushing = false;
    },
  };
}
