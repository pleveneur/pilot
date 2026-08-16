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
