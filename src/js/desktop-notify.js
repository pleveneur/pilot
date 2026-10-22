// desktop-notify.js — Notifications desktop natives (D1, spec_web_remote.md)
//
// Notifie l'utilisateur sur le desktop quand une tâche lancée à distance (mode
// remote, depuis le téléphone) se termine. Utilise le plugin Tauri notification.
//
// Robustesse : tout est défensif — si le plugin n'est pas disponible, la
// permission est refusée, ou l'envoi échoue, on log un warning et on ne lève
// jamais d'erreur (la notification est un confort, pas une fonctionnalité
// critique). Aucune régression possible sur le flux agent.
//
// Depuis la passerelle Telegram (spec_telegram.md, étape 1 : envoi seulement),
// chaque avis est AUSSI transmis au moteur, en arrière-plan
// (`forwardToTelegram`) : c'est le moteur qui décide d'envoyer ou non (inerte
// tant que la passerelle est désactivée ou mal configurée). Aucune logique de
// notification n'est dupliquée : les trois points d'avis existants
// (`notifyAgentDone`, `notifySuperAgentDone`, `notifyAnomaly`) couvrent la fin
// de tâche d'un agent, les événements de l'assistant et les alertes
// d'anomalie / arrêt automatique.
//
// Étape 2, lot 3 : quand l'Assistant « parle » sur Telegram (communication du
// dialogue active), les avis bruts non critiques sont RETARDÉS d'une courte
// fenêtre pour éviter un doublon avec la phrase de l'Assistant, sans jamais
// risquer de les perdre (`deliverRawTelegramAvis` dans telegram-dialog.js). Les
// avis d'ALERTE (anomalie, arrêt automatique) passent en `critical` : ils
// partent TOUT DE SUITE, quoi qu'il arrive.
//
// REFONTE DES MESSAGES (deux projets suivis en même temps) : le texte de l'avis
// Telegram n'est PLUS composé ici. Il vient de la SOURCE UNIQUE
// `telegram-messages.js` : un message = UN projet (nom court en tête), trois
// types seulement (début, fin, alerte), aucun détail technique, aucune rafale.
// Chaque fonction ci-dessous alimente un ÉVÈNEMENT typé (`project`, `result`,
// `problem`, `decision`), jamais une phrase assemblée à la main.

import { invoke } from "@tauri-apps/api/core";
import { deliverRawTelegramAvis } from "./telegram-dialog.js";
import {
  TELEGRAM_MESSAGE_TYPES,
  buildOwnerMessage,
  setTelegramGateDeps,
} from "./telegram-messages.js";

let _permissionChecked = false;
let _granted = false;

/** Envoi réel : passerelle d'envoi EXISTANTE (inerte si non configurée). */
function defaultTelegramSend(text) {
  return invoke("telegram_notify", { text });
}

// La porte unique de publication (anti-rafale + heures calmes) reçoit son
// envoyeur ici : `telegram-messages.js` reste pur (aucun accès Tauri).
setTelegramGateDeps({ send: defaultTelegramSend });

/**
 * Traduit un avis historique (titre + corps libres) en ÉVÈNEMENT typé.
 * Sert uniquement de pont de compatibilité : les appelants modernes passent
 * directement `project`, `ok`, `result`, `problem`, `decision`.
 * @param {string} title
 * @param {string} body
 * @param {object} opts
 * @returns {object}
 */
function eventFromNotice(title, body, opts = {}) {
  const legacy = String(title || "");
  const project = opts.project;
  const text = String(body || "");
  if (/anomalie|arr[êe]t|silencieux|timeout|incident|panne/i.test(legacy) || opts.type === TELEGRAM_MESSAGE_TYPES.ALERT) {
    return {
      type: TELEGRAM_MESSAGE_TYPES.ALERT,
      project,
      problem: opts.problem || text,
      // AUCUNE décision par défaut : une alerte sans action possible en face
      // n'est jamais envoyée (elle produirait du bruit sans utilité).
      decision: opts.decision,
      danger: opts.danger === true,
    };
  }
  return {
    type: TELEGRAM_MESSAGE_TYPES.END,
    project,
    ok: opts.ok !== false,
    result: opts.result || text,
    testable: opts.testable,
  };
}

/**
 * Transmet un avis à la passerelle Telegram (spec_telegram.md, étape 1 :
 * ENVOI seulement).
 *
 * Le texte vient de la source unique `telegram-messages.js`. Le moteur (Rust)
 * décide seul de l'inertie : passerelle désactivée ou mal configurée → aucun
 * envoi, aucune erreur remontée. Côté interface l'appel est « fire-and-forget » :
 * on n'attend JAMAIS la réponse et tout échec est avalé (un avis non transmis ne
 * doit jamais perturber le flux de notification).
 *
 * Appelée AVANT les filtres de notification native (réglage local, permission
 * OS) : Telegram est un canal indépendant, il ne doit pas être conditionné par
 * le réglage des notifications desktop.
 *
 * Étape 2, lot 3 (anti-doublon SANS PERTE) : quand la communication du dialogue
 * est ACTIVE, l'avis part immédiatement s'il est `critical` (alerte), sinon il
 * est retardé d'une courte fenêtre et n'est abandonné que si l'Assistant parle
 * réellement pendant celle-ci (voir `deliverRawTelegramAvis`).
 *
 * Un évènement qui ne porte AUCUNE information utile au propriétaire (corps
 * vide, purement technique) ne produit aucun envoi : pas de message « néant ».
 *
 * @param {string} title
 * @param {string} body
 * @param {{critical?: boolean, project?: string, type?: string, ok?: boolean,
 *   result?: string, testable?: string, problem?: string, decision?: string,
 *   danger?: boolean, telegram?: boolean}} [opts]
 *   `telegram: false` = information interne : rien ne part sur Telegram.
 * @returns {Promise<void>}
 */
export function forwardToTelegram(title, body, opts = {}) {
  if (opts.telegram === false) return Promise.resolve();
  const event = eventFromNotice(title, body, opts);
  const text = buildOwnerMessage(event);
  if (!text) return Promise.resolve();
  // Une ALERTE n'est JAMAIS retardée ni coupée par la communication du dialogue
  // (comportement d'avant la refonte) : seul un danger immédiat franchit les
  // heures calmes.
  deliverRawTelegramAvis(
    text,
    {
      critical:
        event.type === TELEGRAM_MESSAGE_TYPES.ALERT ||
        event.danger === true ||
        opts.critical === true,
    },
    { project: event.project, danger: event.danger === true },
  );
  return Promise.resolve();
}

/**
 * Vérifie (et demande au besoin) la permission de notification native.
 * @returns {Promise<boolean>} true si on peut notifier.
 */
async function ensurePermission() {
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    if (typeof mod.isPermissionGranted === "function") {
      const already = await mod.isPermissionGranted();
      if (already) { _granted = true; return true; }
      if (!_permissionChecked && typeof mod.requestPermission === "function") {
        const perm = await mod.requestPermission();
        _granted = perm === "granted" || perm === "allowed";
        _permissionChecked = true;
        return _granted;
      }
      _granted = false;
      return false;
    }
    return false;
  } catch (e) {
    console.warn("[desktop-notify] plugin notification indisponible:", e);
    return false;
  }
}

/**
 * Notifie le DÉBUT d'une tâche lancée à distance (« MakeFilm : correction de
 * l'autotest lancée »). Une seule ligne, aucun détail technique : le
 * propriétaire sait que quelque chose commence et sur quel projet.
 * @param {{project?: string, action?: string}} [opts]
 * @returns {Promise<void>}
 */
export async function notifyTaskStarted(opts = {}) {
  const title = opts.title || "Pilot — Tâche lancée";
  forwardToTelegram(title, opts.action || "", {
    type: TELEGRAM_MESSAGE_TYPES.START,
    project: opts.project,
    telegram: opts.telegram,
  });
  return Promise.resolve();
}

/**
 * Envoie une notification desktop "Agent terminé (tâche à distance)".
 * Ne fait rien silencieusement si la permission est refusée ou le plugin absent.
 * @param {object} [opts] — { project?: string, result?: string, testable?: string }
 */
export async function notifyAgentDoneFromRemote(opts = {}) {
  await notifyAgentDone({
    ...opts,
    title: opts.title || "Pilot — Agent terminé",
    result: opts.result || "la tâche lancée à distance est terminée",
  });
}

/**
 * Notifie l'utilisateur quand l'agent a terminé sa tâche. Utilisé à la fois pour
 * une tâche à distance (notifyAgentDoneFromRemote) et pour un chat local (issue
 * #41, réglage `notify_agent_done`). Vérifie la config pour le chat local : si
 * le réglage est désactivé (défaut), on n'émet rien. Le mode remote est
 * insensible au réglage (l'utilisateur a explicitement lancé à distance).
 *
 * Telegram : message de FIN (deux lignes maximum) — nom court du PROJET en tête,
 * résultat (« livré » ou « échec »), puis éventuellement ce qu'il reste à tester.
 * @param {object} [opts] — { project?, ok?, result?, testable?, title?, body?, local?, telegram? }
 */
export async function notifyAgentDone(opts = {}) {
  const title = opts.title || "Pilot — Agent terminé";
  const body = opts.body || "✅ L'agent a terminé.";
  // Passerelle Telegram (spec_telegram.md) : transmise en premier, en
  // arrière-plan, indépendamment du réglage local et de la permission OS.
  forwardToTelegram(title, body, {
    type: TELEGRAM_MESSAGE_TYPES.END,
    project: opts.project,
    ok: opts.ok !== false,
    result: opts.result,
    testable: opts.testable,
    telegram: opts.telegram,
  });
  if (opts.local) {
    // Chat local : uniquement si le réglage est activé (issue #41).
    try {
      const cfg = await invoke("get_config");
      if (!cfg || !cfg.notify_agent_done) return;
    } catch (_) {
      return;
    }
  }
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    // Vérifier la permission (demande au 1er appel si pas encore fait).
    let granted = _granted;
    if (!granted) granted = await ensurePermission();
    if (!granted) return;
    if (typeof mod.sendNotification === "function") {
      await mod.sendNotification({ title, body });
    }
  } catch (e) {
    console.warn("[desktop-notify] échec envoi notification:", e);
  }
}

/**
 * Notifie l'utilisateur quand l'assistant (🧭, super-agent) signale un
 * événement IMPORTANT (tâche déléguée terminée, anomalie de suivi, connexion
 * perdue). Consulte le réglage `notify_super_agent_done` (défaut off, issue
 * #16) : si désactivé, on n'émet rien — évite la sur-notification sur les
 * réponses banales de l'assistant. Défensif (ne lève jamais d'erreur).
 *
 * Telegram : message de FIN du projet concerné (`project` = chemin ou nom).
 * `telegram: false` = information purement interne : rien ne part.
 * @param {object} [opts] — { project?, ok?, result?, testable?, title?, body?, telegram? }
 */
export async function notifySuperAgentDone(opts = {}) {
  const title = opts.title || "Pilot — Assistant";
  const body = opts.body || "ℹ️ L'assistant signale un événement important.";
  // Passerelle Telegram : canal indépendant du réglage `notify_super_agent_done`.
  // Une ALERTE (`type: "alert"`) suit le gabarit d'alerte (une ligne, décision
  // attendue) ; tout le reste est un message de FIN du projet concerné.
  forwardToTelegram(title, body, {
    type: opts.type === TELEGRAM_MESSAGE_TYPES.ALERT ? TELEGRAM_MESSAGE_TYPES.ALERT : TELEGRAM_MESSAGE_TYPES.END,
    project: opts.project,
    ok: opts.ok !== false,
    result: opts.result,
    testable: opts.testable,
    problem: opts.problem,
    decision: opts.decision,
    danger: opts.danger === true,
    telegram: opts.telegram,
  });
  try {
    const cfg = await invoke("get_config");
    if (!cfg || !cfg.notify_super_agent_done) return;
  } catch (_) {
    return;
  }
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    let granted = _granted;
    if (!granted) granted = await ensurePermission();
    if (!granted) return;
    if (typeof mod.sendNotification === "function") {
      await mod.sendNotification({ title, body });
    }
  } catch (e) {
    console.warn("[desktop-notify] échec envoi notification assistant:", e);
  }
}

/**
 * Notifie l'utilisateur quand une ANOMALIE d'agent est détectée (tâche 8 :
 * agent actif mais sans progression depuis le seuil). Consulte le réglage
 * `anomaly_detection_enabled` (défaut on) : si la surveillance est désactivée,
 * on n'émet rien. Défensif (ne lève jamais d'erreur).
 *
 * Telegram : ALERTE d'UNE ligne — ce qui bloque ET la décision attendue. Sans
 * décision, aucune alerte ne part (jamais de bruit sans action possible).
 * @param {object} [opts] — { project?, problem?, decision?, danger?, title?, body? }
 */
export async function notifyAnomaly(opts = {}) {
  const title = opts.title || "Pilot — Anomalie détectée";
  const body = opts.body || "⚠️ Un agent semble bloqué (actif sans progression).";
  // Passerelle Telegram : ALERTE — elle ne doit JAMAIS être retardée ni coupée,
  // même si la communication du dialogue est active (une anomalie ou un arrêt
  // automatique est trop important pour dépendre de la parole de l'Assistant).
  // Transmise même si la notification native est désactivée côté surveillance
  // (`anomaly_detection_enabled`). Seul un DANGER IMMÉDIAT franchit les heures
  // calmes (23 h → 7 h).
  forwardToTelegram(title, body, {
    type: TELEGRAM_MESSAGE_TYPES.ALERT,
    project: opts.project,
    problem: opts.problem,
    decision: opts.decision,
    danger: opts.danger === true,
    telegram: opts.telegram,
  });
  try {
    const cfg = await invoke("get_config");
    if (!cfg || cfg.anomaly_detection_enabled === false) return;
  } catch (_) {
    return;
  }
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    let granted = _granted;
    if (!granted) granted = await ensurePermission();
    if (!granted) return;
    if (typeof mod.sendNotification === "function") {
      await mod.sendNotification({ title, body });
    }
  } catch (e) {
    console.warn("[desktop-notify] échec envoi notification anomalie:", e);
  }
}

/**
 * Joue le son de notification de l'Assistant (🧭, super-agent) via le script
 * PowerShell `~/.pilot/assistant/notify.ps1`. `soundType` : "attention" |
 * "point" | "fin". Consulte le réglage `assistant_sound_enabled` (défaut off,
 * spec_super_agent.md) : si désactivé, on n'émet rien. Défensif (ne lève jamais
 * d'erreur).
 * @param {string} soundType - type de son ("attention" | "point" | "fin").
 * @param {number} [volume] - volume 0-100 (défaut 100).
 */
export async function playAssistantSound(soundType, volume) {
  let configVolume = 100;
  try {
    const cfg = await invoke("get_config");
    if (!cfg || cfg.assistant_sound_enabled !== true) return;
    if (typeof cfg.assistant_sound_volume === "number") {
      configVolume = cfg.assistant_sound_volume;
    }
  } catch (_) {
    return;
  }
  const vol = (typeof volume === "number" && volume >= 0) ? Math.min(100, Math.round(volume)) : Math.min(100, Math.round(configVolume));
  try {
    await invoke("play_assistant_sound", { soundType: soundType || "point", volume: vol });
  } catch (e) {
    console.warn("[desktop-notify] échec son assistant:", e);
  }
}
