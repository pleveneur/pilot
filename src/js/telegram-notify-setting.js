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
//   - l'ÉTAT est obtenu par l'assistant en APPELANT l'outil UNIQUE
//     `telegram_notifications` (extension pilot-assistant-actions) : sans
//     argument il renvoie l'état en clair, avec `enabled` il le change et
//     renvoie le nouvel état. AUCUNE valeur n'est injectée dans le prompt
//     système ni dans un bloc de contexte : la seule source est l'appel ;
//   - le même chemin sert dans le chat de l'onglet 🧭 ET depuis un message
//     Telegram reçu (même session) ;
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
 * Réponse de l'outil UNIQUE quand on lui demande l'état (aucun argument) : dit
 * en clair OUI ou NON, sans jargon. C'est la SEULE façon dont l'assistant
 * apprend l'état — rien n'est injecté dans son prompt ni dans un contexte.
 * Fonction PURE.
 * @param {boolean} enabled
 * @returns {string}
 */
export function telegramNotifyStateAnswer(enabled) {
  return enabled === true
    ? "Réglage « me prévenir sur Telegram » : OUI. L'utilisateur veut être prévenu sur Telegram (début et fin de mission, alertes). Pour l'arrêter : rappelle cet outil avec enabled: false."
    : "Réglage « me prévenir sur Telegram » : NON. Rien ne part sur Telegram (aucun message de début ni de fin, aucune alerte) et les alertes restent visibles dans Pilot. Pour l'activer : rappelle cet outil avec enabled: true.";
}

/**
 * LECTURE de l'état par la commande existante `get_config` (source unique :
 * `AppConfig.telegram_notify_enabled`). Un échec n'invente AUCUNE valeur :
 * `ok: false` et l'appelant le signale en clair.
 * @param {object} [deps]
 * @param {(cmd: string, args?: object) => Promise<unknown>} [deps.invokeFn]
 * @returns {Promise<{ok: boolean, enabled: boolean, error?: string}>}
 */
export async function readTelegramNotifyEnabled(deps = {}) {
  const call = deps.invokeFn || defaultInvoke;
  let cfg;
  try {
    cfg = await call("get_config");
  } catch (e) {
    return { ok: false, enabled: false, error: String(e) };
  }
  if (!cfg || typeof cfg !== "object") {
    return { ok: false, enabled: false, error: "configuration indisponible" };
  }
  return { ok: true, enabled: isTelegramNotifyEnabled(cfg) };
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
