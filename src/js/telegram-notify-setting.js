// telegram-notify-setting.js — réglage UNIQUE « me prévenir sur Telegram ».
//
// RÈGLE (propriétaire, décidée) : il existe UN SEUL réglage qui dit si le
// propriétaire veut être prévenu sur Telegram, et il n'existe qu'à un seul
// endroit. Ce réglage est `AppConfig.telegram_notify_enabled` (src-tauri/src/
// lib.rs) : un seul champ, une seule case à cocher (Paramètres → onglet
// Assistant → « Notifications Telegram »), une seule porte d'envoi côté Rust
// (`TelegramConfig::inert_reason`). Ce module ne crée AUCUN réglage : il ne fait
// que lire et écrire ce champ par les commandes existantes `get_config` /
// `save_config`. Les autres modules consultent, ils ne recopient jamais la
// valeur.
//
// Qui fait quoi :
//   - l'ÉTAT est lu par l'assistant dans son prompt système, reconstruit à
//     CHAQUE envoi côté Rust (`telegram_notify_guideline` dans super_agent.rs) :
//     il est donc toujours à jour, jamais figé au démarrage ;
//   - l'assistant CHANGE le réglage avec l'outil `set_telegram_notifications`
//     (extension pilot-assistant-actions) : le même chemin sert dans le chat de
//     l'onglet 🧭 ET depuis un message Telegram reçu (même session) ;
//   - la RÉACTIVATION automatique (un message du propriétaire arrive via
//     Telegram) vit côté Rust, à la réception (`telegram.rs`) : elle ne dépend
//     ni de l'ouverture d'un onglet ni de ce module.
//
// Inertie : une lecture impossible (configuration indisponible) laisse le
// réglage INCHANGÉ — jamais de valeur par défaut écrite à la place (réserve
// R-B : une écriture ne doit jamais persister des défauts).

/** Nom EXACT du champ de configuration (source unique côté JS). */
export const TELEGRAM_NOTIFY_FIELD = "telegram_notify_enabled";

/** Événement émis par Rust quand la réception Telegram réactive le réglage. */
export const TELEGRAM_NOTIFY_CHANGED_EVENT = "pilot-telegram-notify-changed";

/**
 * L'utilisateur veut-il être prévenu sur Telegram ?
 * Lecture STRICTE : seul `true` active (un champ absent d'une ancienne
 * configuration reste coupé, comme le défaut Rust). Fonction PURE.
 * @param {object|null|undefined} cfg
 * @returns {boolean}
 */
export function isTelegramNotifyEnabled(cfg) {
  return !!(cfg && cfg[TELEGRAM_NOTIFY_FIELD] === true);
}

/**
 * Configuration avec le réglage positionné (l'objet d'origine n'est pas
 * modifié : `save_config` réécrit TOUTE la configuration, donc on part toujours
 * de la configuration lue à l'instant). Fonction PURE.
 * @param {object|null|undefined} cfg
 * @param {boolean} enabled
 * @returns {object}
 */
export function withTelegramNotifyEnabled(cfg, enabled) {
  return { ...(cfg || {}), [TELEGRAM_NOTIFY_FIELD]: enabled === true };
}

/**
 * Phrase UNIQUE de confirmation (une ligne, sans jargon), utilisée par la
 * conversation pour confirmer l'application immédiate. Fonction PURE.
 * @param {boolean} enabled
 * @returns {string}
 */
export function telegramNotifyConfirmation(enabled) {
  return enabled
    ? "C'est fait : je vous préviens sur Telegram."
    : "C'est fait : plus rien ne part sur Telegram.";
}

/**
 * Applique le réglage par les commandes existantes (`get_config` /
 * `save_config`) puis signale le changement à l'interface (le bouton de
 * communication Telegram de l'onglet 🧭 et les Paramètres se rafraîchissent).
 *
 * Écriture ATOMIQUE au sens de la réserve R-B : la configuration est RELUE juste
 * avant d'être réécrite (jamais un instantané périmé), et un échec de lecture
 * ANNULE l'écriture (aucune valeur par défaut persistée).
 *
 * @param {boolean} enabled
 * @param {object} [deps]
 * @param {(cmd: string, args?: object) => Promise<unknown>} [deps.invokeFn]
 * @param {(detail: object) => void} [deps.notify] - émission de l'événement
 *   `pilot-config-changed` (injectable pour les tests).
 * @returns {Promise<{ok: boolean, enabled: boolean, changed: boolean, error?: string}>}
 */
export async function setTelegramNotifyEnabled(enabled, deps = {}) {
  const call = deps.invokeFn || defaultInvoke;
  const next = enabled === true;
  let cfg;
  try {
    cfg = await call("get_config");
  } catch (e) {
    return { ok: false, enabled: next, changed: false, error: String(e) };
  }
  if (!cfg || typeof cfg !== "object") {
    return {
      ok: false,
      enabled: next,
      changed: false,
      error: "configuration indisponible",
    };
  }
  const changed = isTelegramNotifyEnabled(cfg) !== next;
  if (!changed) {
    // Déjà dans l'état demandé : aucune écriture inutile (l'assistant confirme
    // quand même, en une ligne).
    return { ok: true, enabled: next, changed: false };
  }
  const updated = withTelegramNotifyEnabled(cfg, next);
  try {
    await call("save_config", { config: updated });
  } catch (e) {
    return { ok: false, enabled: next, changed: false, error: String(e) };
  }
  try {
    (deps.notify || defaultNotify)(updated);
  } catch (_) {
    // Le rafraîchissement de l'interface est un confort : jamais une erreur.
  }
  return { ok: true, enabled: next, changed: true };
}

/** Appel Tauri par défaut (import paresseux : ce module reste testable seul). */
function defaultInvoke(cmd, args) {
  return import("@tauri-apps/api/core").then((m) => m.invoke(cmd, args));
}

/** Émission par défaut de `pilot-config-changed` (écouté par toute l'interface). */
function defaultNotify(cfg) {
  if (typeof window === "undefined" || !window || !window.dispatchEvent) return;
  window.dispatchEvent(new CustomEvent("pilot-config-changed", { detail: cfg }));
}
