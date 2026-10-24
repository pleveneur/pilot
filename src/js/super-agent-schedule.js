// super-agent-schedule.js — logique pure du ticker des relances programmées
// de l'assistant (chantier #13). Fonctions pures, testables sans dépendances
// Tauri/DOM. Le ticker lui-même (setInterval) vit dans super-agent.js.

// Garde-fou 4 : pas de tick si la session super-agent est morte (onglet 🧭
// fermé). Retourne true seulement si l'onglet est ouvert.
export function shouldScheduleTick(open) {
  return open === true;
}

// DÉCISION UNIQUE d'injection des relances dues (une passe de tick).
//
// Deux règles, écrites ici et NULLE PART ailleurs (le ticker de super-agent.js
// ne fait qu'exécuter le plan rendu) :
//
//  1. RÉGLAGE DU PROPRIÉTAIRE « Vérifier les points à faire à l'ouverture de la
//     session (relances programmées) » (`super_agent_auto_check_startup`,
//     DÉSACTIVÉ par défaut — index.html, case `setting-superagent-auto-check-startup`).
//     Sa promesse est explicite : désactivé, « l'Assistant ne lance pas
//     automatiquement un rappel dû au démarrage ». Le tick démarre à l'ouverture
//     de l'onglet 🧭 (donc au démarrage de Pilot) et rattrape TOUT le retard
//     accumulé pendant que Pilot était fermé : sans cette règle, un rappel dû
//     partait tout seul au démarrage et l'assistant se lançait dans un travail
//     que personne n'avait demandé (constaté : reprise de chantier + mission
//     de publication au lancement). Tant que le propriétaire n'a pas lui-même
//     écrit dans cette session (`ownerEngaged`), un rappel reste DÛ (rien n'est
//     perdu, aucun marquage) et partira dès qu'il ouvrira la conversation — ou
//     immédiatement si le réglage est activé.
//  2. UNE SEULE relance par passe : plusieurs rappels échus ensemble (typique
//     après une fermeture de plusieurs jours) partaient dans la même passe, à
//     la suite, chacun ouvrant un vrai tour de génération → assistant occupé et
//     messages du propriétaire refusés. Les suivants restent DUS et partent aux
//     passes suivantes (10 s), une fois l'assistant redevenu libre.
//
// `backendBusy` et `pendingIds` restent les gardes historiques (assistant en
// train de répondre, injection déjà en vol).
//
// @returns {{toInject: object[], held: object[]}} plan de la passe
//   (`held` = rappels laissés DUS, jamais perdus, jamais marqués).
export function planDueReminderInjections(opts) {
  const {
    due,
    pendingIds,
    backendBusy,
    autoCheckStartup,
    ownerEngaged,
  } = opts || {};
  const list = Array.isArray(due) ? due : [];
  const pending = pendingIds instanceof Set ? pendingIds : new Set();
  const held = [];
  const eligible = [];
  const startupAllowed = autoCheckStartup === true || ownerEngaged === true;
  for (const d of list) {
    if (!d || d.id === undefined || d.id === null) continue;
    if (!startupAllowed) { held.push(d); continue; }
    if (backendBusy) { held.push(d); continue; }
    if (pending.has(d.id)) { held.push(d); continue; }
    eligible.push(d);
  }
  if (eligible.length > 1) {
    for (const extra of eligible.slice(1)) held.push(extra);
  }
  return { toInject: eligible.slice(0, 1), held };
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

// Libellé de notification pour le panneau Événements / toast (issue #36).
// Combine le marqueur discret et l'HEURE DE LIVRAISON : « ⏰ relance —
// 29/08 à 14:30 ». Attention au sens, souvent confondu : ce n'est PAS
// l'échéance théorique du rappel (`nextFireAt`), mais l'instant où l'appelant a
// effectivement livré la relance à l'assistant (`new Date()` côté
// super-agent.js) — les deux diffèrent dès qu'un tick a du retard (onglet
// fermé, assistant occupé, rappel rejoué). Le prompt complet reste consultable
// au survol (title, côté super-agent.js), jamais affiché en clair.
export function formatReminderNotificationLabel(deliveredAt) {
  return formatReminderQuietLabel(formatReminderDate(deliveredAt));
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
