// super-agent-schedule.js — logique pure du ticker des relances programmées
// de l'assistant (chantier #13). Fonctions pures, testables sans dépendances
// Tauri/DOM. Le ticker lui-même (setInterval) vit dans super-agent.js.

// Garde-fou 4 : pas de tick si la session super-agent est morte (onglet 🧭
// fermé). Retourne true seulement si l'onglet est ouvert.
export function shouldScheduleTick(open) {
  return open === true;
}

// Validation miroir de la borne Rust (every >= 60 s). Retourne null si valide,
// sinon un message d'erreur.
export function parseScheduleEvery(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    return "L'intervalle doit être un entier.";
  }
  if (n < 60) {
    return "L'intervalle doit être >= 60 s.";
  }
  return null;
}

// Formate une date/heure de rappel au format français court « 29/08 à 14:30 »
// (jour/mois à HH:MM, heure locale). Retourne "" si la date est absente ou
// invalide : l'appelant garde alors la bulle inchangée (jamais « Invalid
// Date »/« NaN » à l'écran). Formatage manuel (pas d'Intl) pour garantir le
// même rendu sur Windows/macOS/Linux quel que soit le moteur.
export function formatReminderDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} à ${hh}:${mi}`;
}

// Bulle de relance discrète (retours utilisateur 2026-08-29). Le prompt du
// rappel est une consigne technique destinée à l'assistant : l'afficher en
// clair pollue la conversation pour rien. La bulle ne montre donc qu'un
// marqueur court « ⏰ relance — 29/08 à 14:30 » (garde-fou discret) ; la date
// n'apparaît que si formatReminderDate en a produit une. Le prompt complet
// reste consultable au survol (title, côté super-agent.js).
export function formatReminderQuietLabel(when) {
  return when ? `⏰ relance — ${when}` : "⏰ relance";
}

// Validation miroir de l'opération Rust schedule_set_enabled (désactivation /
// réactivation d'un rappel sans le supprimer). Retourne null si valide, sinon
// un message d'erreur. `id` doit être un entier positif, `enabled` un booléen.
export function parseScheduleSetEnabled(id, enabled) {
  const n = Number(id);
  if (!Number.isInteger(n) || Number.isNaN(n) || n <= 0) {
    return "L'id du rappel doit être un entier positif.";
  }
  if (typeof enabled !== "boolean") {
    return "enabled doit être un booléen.";
  }
  return null;
}
