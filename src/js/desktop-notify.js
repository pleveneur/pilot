// desktop-notify.js — Notifications desktop natives (D1, spec_web_remote.md)
//
// Notifie l'utilisateur sur le desktop quand une tâche lancée à distance (mode
// remote, depuis le téléphone) se termine. Utilise le plugin Tauri notification.
//
// Robustesse : tout est défensif — si le plugin n'est pas disponible, la
// permission est refusée, ou l'envoi échoue, on log un warning et on ne lève
// jamais d'erreur (la notification est un confort, pas une fonctionnalité
// critique). Aucune régression possible sur le flux agent.

import { invoke } from "@tauri-apps/api/core";

let _permissionChecked = false;
let _granted = false;

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
 * Envoie une notification desktop "Agent terminé (tâche à distance)".
 * Ne fait rien silencieusement si la permission est refusée ou le plugin absent.
 * @param {object} [opts] — { title?: string, body?: string }
 */
export async function notifyAgentDoneFromRemote(opts = {}) {
  await notifyAgentDone({ ...opts, title: opts.title || "Pilot — Agent terminé", body: opts.body || "✅ La tâche lancée à distance est terminée." });
}

/**
 * Notifie l'utilisateur quand l'agent a terminé sa tâche. Utilisé à la fois pour
 * une tâche à distance (notifyAgentDoneFromRemote) et pour un chat local (issue
 * #41, réglage `notify_agent_done`). Vérifie la config pour le chat local : si
 * le réglage est désactivé (défaut), on n'émet rien. Le mode remote est
 * insensible au réglage (l'utilisateur a explicitement lancé à distance).
 * @param {object} [opts] — { title?: string, body?: string, local?: boolean }
 */
export async function notifyAgentDone(opts = {}) {
  if (opts.local) {
    // Chat local : uniquement si le réglage est activé (issue #41).
    try {
      const cfg = await invoke("get_config");
      if (!cfg || !cfg.notify_agent_done) return;
    } catch (_) {
      return;
    }
  }
  const title = opts.title || "Pilot — Agent terminé";
  const body = opts.body || "✅ L'agent a terminé.";
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
 * @param {object} [opts] — { title?: string, body?: string }
 */
export async function notifySuperAgentDone(opts = {}) {
  try {
    const cfg = await invoke("get_config");
    if (!cfg || !cfg.notify_super_agent_done) return;
  } catch (_) {
    return;
  }
  const title = opts.title || "Pilot — Assistant";
  const body = opts.body || "ℹ️ L'assistant signale un événement important.";
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
 * @param {object} [opts] — { title?: string, body?: string }
 */
export async function notifyAnomaly(opts = {}) {
  try {
    const cfg = await invoke("get_config");
    if (!cfg || cfg.anomaly_detection_enabled === false) return;
  } catch (_) {
    return;
  }
  const title = opts.title || "Pilot — Anomalie détectée";
  const body = opts.body || "⚠️ Un agent semble bloqué (actif sans progression).";
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
  try {
    const cfg = await invoke("get_config");
    if (!cfg || cfg.assistant_sound_enabled !== true) return;
  } catch (_) {
    return;
  }
  const vol = (typeof volume === "number" && volume >= 0) ? Math.min(100, Math.round(volume)) : 100;
  try {
    await invoke("play_assistant_sound", { soundType: soundType || "point", volume: vol });
  } catch (e) {
    console.warn("[desktop-notify] échec son assistant:", e);
  }
}
