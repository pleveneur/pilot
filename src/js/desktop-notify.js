// desktop-notify.js — Notifications desktop natives (D1, spec_web_remote.md)
//
// Notifie l'utilisateur sur le desktop quand une tâche lancée à distance (mode
// remote, depuis le téléphone) se termine. Utilise le plugin Tauri notification.
//
// Robustesse : tout est défensif — si le plugin n'est pas disponible, la
// permission est refusée, ou l'envoi échoue, on log un warning et on ne lève
// jamais d'erreur (la notification est un confort, pas une fonctionnalité
// critique). Aucune régression possible sur le flux agent.

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
  const title = opts.title || "Pilot — Agent terminé";
  const body = opts.body || "✅ La tâche lancée à distance est terminée.";
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