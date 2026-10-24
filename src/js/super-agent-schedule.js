// super-agent-schedule.js — logique pure du ticker des relances programmées
// de l'assistant (chantier #13). Fonctions pures, testables sans dépendances
// Tauri/DOM. Le ticker lui-même (setInterval) vit dans super-agent.js.

// Garde-fou 4 : pas de tick si la session super-agent est morte (onglet 🧭
// fermé). Retourne true seulement si l'onglet est ouvert.
export function shouldScheduleTick(open) {
  return open === true;
}

// ── Relecture du correctif `d26717e` : échecs, retardataires, retenue ────────

// DÉFAUT 2 — Nombre d'ÉCHECS CONSÉCUTIFS d'envoi d'un rappel au-delà duquel il
// est MIS À L'ÉCART, le temps qu'un autre rappel passe. Le compteur vit
// UNIQUEMENT en mémoire côté ticker : aucune écriture en base (la table
// `assistant_schedules` n'a pas à porter l'état d'un tunnel d'envoi).
export const REMINDER_MAX_CONSECUTIVE_FAILURES = 3;

// DÉFAUT 3 — Un rappel est « RETARDATAIRE » quand son échéance est dépassée de
// plus de DEUX intervalles (cas type : arriéré accumulé pendant que Pilot était
// fermé). Les retardataires partent GROUPÉS dans UN SEUL message — un seul tour
// de l'assistant — au lieu d'occuper l'assistant pendant des heures (une
// relance par passe = un prompt système complet = un tour complet).
export const REMINDER_LAGGARD_INTERVAL_FACTOR = 2;

// Instant (ms epoch) d'une échéance renvoyée par Rust. `datetime('now')` de
// SQLite produit « 2026-08-29 14:30:00 », c'est-à-dire de l'UTC SANS fuseau :
// `new Date("2026-08-29 14:30:00")` l'interpréterait en heure locale (décalage
// du fuseau dans la latence calculée). On force donc le suffixe `Z`. Retourne
// null si la valeur est absente ou illisible (l'appelant retombe alors sur le
// comportement d'avant : aucun regroupement, rien n'est inventé).
export function parseScheduleInstant(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// Le rappel est-il un RETARDATAIRE à l'instant `nowMs` ? Faux (donc : livraison
// une par passe, comme avant) dès que l'échéance ou l'intervalle manque.
export function isOverdueLaggard(reminder, nowMs) {
  const dueAt = parseScheduleInstant(reminder && reminder.nextFireAt);
  const every = Number(reminder && reminder.every);
  const now = Number(nowMs);
  if (dueAt === null || !Number.isInteger(every) || every <= 0) return false;
  if (!Number.isFinite(now)) return false;
  return now - dueAt > REMINDER_LAGGARD_INTERVAL_FACTOR * every * 1000;
}

// Nombre d'échecs consécutifs mémorisé pour un rappel (Map ou objet simple).
function reminderFailureCount(failureCounts, id) {
  if (!failureCounts) return 0;
  const raw = failureCounts instanceof Map ? failureCounts.get(id) : failureCounts[id];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Message réellement remis à l'assistant pour un lot de rappels. UN SEUL envoi
// par passe (donc UN SEUL tour) : soit une relance seule (format historique),
// soit un lot de retardataires regroupés (« N relances échues : … »). Le texte
// de chaque rappel est conservé tel quel, numéroté pour ne pas les confondre.
export function buildReminderInjectionMessage(items) {
  const list = Array.isArray(items)
    ? items.filter((d) => d && typeof d.prompt === "string" && d.prompt.trim() !== "")
    : [];
  if (list.length === 0) return "";
  if (list.length === 1) return `[⏰ Rappel programmé] ${list[0].prompt}`;
  const n = list.length;
  const lines = list.map((d, i) => `${i + 1}. ${d.prompt}`).join("\n");
  return (
    `[⏰ ${n} relances échues] ${n} relances programmées sont arrivées à échéance ` +
    `sans avoir pu être livrées (Assistant occupé, onglet fermé). Traite-les ` +
    `toutes, dans l'ordre, sans les confondre :\n${lines}`
  );
}

// Libellé du panneau 🔔 / toast pour un LOT livré : « ⏰ 3 relances — 29/08 à
// 14:30 ». Une seule ligne par lot (l'heure reste celle de la LIVRAISON).
export function formatReminderGroupNotificationLabel(count, deliveredAt) {
  const n = Number(count) || 0;
  if (n <= 1) return formatReminderNotificationLabel(deliveredAt);
  const when = formatReminderDate(deliveredAt);
  return when ? `⏰ ${n} relances — ${when}` : `⏰ ${n} relances`;
}

// DÉFAUT 4 — Signal SYSTÈME de la retenue (affiché UNE fois par session par le
// ticker) : le propriétaire n'est plus laissé dans l'ignorance du fait que des
// relances attendent son premier message. Chaîne vide si rien n'est retenu.
export function formatReminderHoldNotice(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1
    ? "1 relance en attente — écrivez, ou activez ⚙️ → Assistant"
    : `${n} relances en attente — écrivez, ou activez ⚙️ → Assistant`;
}

// Garde « UNE SEULE fois par session » du signal de retenue : la règle
// d'unicité est donc écrite ici et testable seule, et le ticker ne fait que
// l'interroger à chaque passe (10 s) sans jamais la réécrire. `reset()` est
// appelé à l'ouverture d'une session de conversation (startScheduleTicker).
export function createReminderHoldGuard() {
  let notified = false;
  return {
    reset() {
      notified = false;
    },
    /** Vrai au plus UNE fois par session, et seulement s'il y a à dire. */
    shouldNotify(waitingForOwner) {
      if (!(Number(waitingForOwner) > 0)) return false;
      if (notified) return false;
      notified = true;
      return true;
    },
  };
}

// DÉCISION UNIQUE d'injection des relances dues (une passe de tick).
//
// Trois règles, écrites ici et NULLE PART ailleurs (le ticker de super-agent.js
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
//  2. UN SEUL ENVOI par passe (donc UN SEUL tour de l'assistant). Plusieurs
//     rappels échus ensemble (typique après une fermeture de plusieurs jours)
//     partaient dans la même passe, à la suite, chacun ouvrant un vrai tour de
//     génération → assistant occupé et messages du propriétaire refusés. Un
//     envoi peut toutefois porter PLUSIEURS relances REGROUPÉES (règle 3) : la
//     limite est celle du nombre de TOURS, pas du nombre de rappels traités.
//     Les rappels non livrés restent DUS et partent à la passe suivante (10 s),
//     une fois l'assistant redevenu libre.
//  3. REGROUPEMENT DES RETARDATAIRES et ROTATION EN CAS D'ÉCHEC :
//     - les rappels en retard de plus de deux intervalles (`isOverdueLaggard`)
//       partent GROUPÉS dans un seul message (« N relances échues : … ») ;
//     - parmi les autres, un seul part par passe, en commençant par celui qui a
//       le MOINS d'échecs consécutifs (compteur en mémoire, `failureCounts`) ;
//       un rappel qui échoue `REMINDER_MAX_CONSECUTIVE_FAILURES` fois de suite
//       est ÉCARTÉ tant qu'un autre peut partir — il n'est jamais perdu et il
//       n'affame plus les suivants (`schedule_due` renvoie toujours `ORDER BY
//       id`, donc sans cette règle le premier éligible monopolise la passe).
//
// `backendBusy` et `pendingIds` restent les gardes historiques (assistant en
// train de répondre, injection déjà en vol).
//
// @returns {{toInject: object[], mode: "none"|"single"|"group", held: object[],
//   waitingForOwner: number}} plan de la passe
//   (`held` = rappels laissés DUS, jamais perdus, jamais marqués ; `mode` =
//   forme de l'UNIQUE message à envoyer ; `waitingForOwner` = nombre de
//   rappels retenus PARCE QUE le propriétaire n'a pas encore écrit, seule
//   cause qui mérite un signal à l'écran).
export function planDueReminderInjections(opts) {
  const {
    due,
    pendingIds,
    backendBusy,
    autoCheckStartup,
    ownerEngaged,
    failureCounts,
    now,
  } = opts || {};
  const list = Array.isArray(due) ? due : [];
  const pending = pendingIds instanceof Set ? pendingIds : new Set();
  const held = [];
  const eligible = [];
  const waitingForOwner = [];
  const startupAllowed = autoCheckStartup === true || ownerEngaged === true;
  for (const d of list) {
    if (!d || d.id === undefined || d.id === null) continue;
    if (!startupAllowed) { held.push(d); waitingForOwner.push(d); continue; }
    if (backendBusy) { held.push(d); continue; }
    if (pending.has(d.id)) { held.push(d); continue; }
    eligible.push(d);
  }
  // ROTATION / MISE À L'ÉCART : les rappels qui viennent d'échouer passent APRÈS
  // ceux qui n'ont jamais échoué ; un rappel écarté n'est retenté que s'il ne
  // reste rien d'autre à livrer (aucun rappel n'est donc jamais perdu).
  const ranked = eligible
    .map((d, index) => ({ d, index, failures: reminderFailureCount(failureCounts, d.id) }))
    .sort((a, b) => a.failures - b.failures || a.index - b.index);
  const healthy = ranked.filter((r) => r.failures < REMINDER_MAX_CONSECUTIVE_FAILURES);
  const quarantined = ranked.filter((r) => r.failures >= REMINDER_MAX_CONSECUTIVE_FAILURES);
  const laggards = healthy.filter((r) => isOverdueLaggard(r.d, now));
  let chosen = [];
  let mode = "none";
  if (laggards.length > 0) {
    chosen = laggards.map((r) => r.d);
    mode = chosen.length > 1 ? "group" : "single";
  } else if (healthy.length > 0) {
    chosen = [healthy[0].d];
    mode = "single";
  } else if (quarantined.length > 0) {
    // Plus rien de sain : on retente ENSEMBLE les rappels écartés. Aucun n'est
    // perdu et aucun ne prend la place d'un autre (aucune famine possible).
    chosen = quarantined.map((r) => r.d);
    mode = chosen.length > 1 ? "group" : "single";
  }
  const chosenIds = new Set(chosen.map((d) => d.id));
  for (const d of eligible) {
    if (!chosenIds.has(d.id)) held.push(d);
  }
  return { toInject: chosen, mode, held, waitingForOwner: waitingForOwner.length };
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
