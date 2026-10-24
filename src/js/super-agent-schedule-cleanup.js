// super-agent-schedule-cleanup.js — SOURCE UNIQUE de la décision de MÉNAGE des
// rappels programmés de l'Assistant (chantier « les rappels inutiles se purgent
// tout seuls »).
//
// Constat : rien ne purgeait jamais la table `assistant_schedules`. Le
// propriétaire y avait 325 rappels, dont beaucoup désactivés ou périmés ; la
// seule borne existante était le plafond de 20 rappels ACTIFS (création
// refusée), les rappels désactivés s'accumulant sans limite.
//
// Ce module est PUR (aucun import Tauri/DOM) : il reçoit la liste des rappels
// telle que la renvoie le backend et rend un PLAN. Il est le SEUL endroit où les
// règles de ménage sont écrites ; l'appel automatique (super-agent.js) et le
// bouton « Supprimer les rappels inutiles » (settings.js) ne font qu'APPLIQUER
// le plan rendu ici.
//
// Les quatre règles (+ les garde-fous) :
//
//  1. RAPPEL DÉSACTIVÉ ET PÉRIMÉ — un rappel désactivé dont la dernière
//     exécution (ou, s'il n'a jamais tourné, la date de création) remonte à plus
//     de 30 jours est SUPPRIMÉ.
//  2. RAPPEL UNIQUE DÉJÀ CONSOMMÉ — un rappel qui ne devait se déclencher
//     qu'une seule fois (`one_shot`) et dont l'échéance est dépassée de plus de
//     30 jours est SUPPRIMÉ.
//  3. RAPPEL PÉRIODIQUE STÉRILE — un rappel périodique qui n'a rien détecté sur
//     ses 20 dernières exécutions (`sterile_runs >= 20`) est DÉSACTIVÉ (pas
//     supprimé tout de suite) ; la règle 1 le supprimera 30 jours plus tard.
//  4. PLAFOND — au plus 20 rappels ACTIFS (`CLEANUP_MAX_ACTIVE`) : la création
//     au-delà est refusée côté Rust en listant les rappels candidats, du plus
//     ancien au plus récent (message construit par `schedule_insert`).
//
//  5. FRÉQUENCE — le ménage automatique tourne au plus UNE FOIS PAR JOUR
//     (`CLEANUP_MIN_INTERVAL_MS`, horodatage persisté côté backend) et ne
//     supprime jamais en silence : chaque suppression écrit UNE ligne (date, nom
//     du rappel, raison) dans le journal existant de l'Assistant
//     (`injection_logs`, via `log_injection`).
//  6. GARDE-FOUS ABSOLUS — jamais de suppression d'un rappel ACTIF et récent,
//     jamais d'un rappel FUTUR qui n'a jamais tourné, jamais d'un rappel qu'on
//     ne sait pas classer (donnée absente, date illisible, type inattendu). En
//     cas de doute : ON GARDE (raison explicite dans le plan).

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Règle 1 : ancienneté minimale (jours) d'un rappel désactivé avant suppression. */
export const CLEANUP_DISABLED_STALE_DAYS = 30;
/** Règle 2 : tolérance (jours) après l'échéance d'un rappel unique consommé. */
export const CLEANUP_ONE_SHOT_GRACE_DAYS = 30;
/** Règle 3 : nombre d'exécutions stériles consécutives avant désactivation. */
export const CLEANUP_STERILE_RUNS = 20;
/** Règle 4 : nombre maximal de rappels ACTIFS (miroir de `SCHEDULE_MAX` Rust). */
export const CLEANUP_MAX_ACTIVE = 20;
/** Règle 5 : deux ménages automatiques sont espacés d'au moins 24 h. */
export const CLEANUP_MIN_INTERVAL_MS = DAY_MS;
/** Fréquence minimale d'un rappel (miroir de `SCHEDULE_MIN_EVERY_SECS` Rust). */
export const SCHEDULE_MIN_EVERY_SECS = 60;

// Motifs (libellés destinés au journal ET à l'écran : une seule formulation).
const REASON_DISABLED_STALE =
  `rappel désactivé et sans exécution depuis plus de ${CLEANUP_DISABLED_STALE_DAYS} jours`;
const REASON_ONE_SHOT_STALE =
  `rappel unique périmé : échéance dépassée de plus de ${CLEANUP_ONE_SHOT_GRACE_DAYS} jours`;
const REASON_STERILE =
  `${CLEANUP_STERILE_RUNS} exécutions consécutives sans rien détecter`;

/**
 * Convertit un horodatage en millisecondes epoch, ou `null` si la valeur est
 * absente/illisible. Accepte :
 *  - le format SQLite `datetime('now')` : `"YYYY-MM-DD HH:MM:SS"` (UTC, sans
 *    fuseau — on l'annote en UTC, sinon `new Date()` l'interpréterait en heure
 *    LOCALE et décalerait toutes les bornes de quelques heures) ;
 *  - une chaîne ISO (`…Z` ou avec décalage) ;
 *  - un nombre / une `Date` (millisecondes epoch).
 */
export function parseScheduleStamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  // "YYYY-MM-DD HH:MM:SS" (SQLite, UTC) → "YYYY-MM-DDTHH:MM:SSZ".
  const sqlite = raw.replace(" ", "T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(sqlite);
  const iso = hasZone ? sqlite : `${sqlite}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Entrée « conservée » du plan (raison lisible, aucune action). */
function keep(id, name, reason, referenceMs) {
  return { action: "keep", id, name, reason, referenceMs: Number.isFinite(referenceMs) ? referenceMs : 0 };
}

/**
 * Classe UN rappel. Retourne `{ action: "delete" | "disable" | "keep", id, name,
 * reason, referenceMs }`. `referenceMs` sert à ordonner les candidats du plus
 * ancien au plus récent (règle 4).
 */
export function classifyScheduleCleanupItem(schedule, nowMs) {
  if (!schedule || typeof schedule !== "object") {
    return keep(null, "", "rappel illisible : conservé par précaution", 0);
  }
  const id = Number(schedule.id);
  const name = typeof schedule.name === "string" ? schedule.name.trim() : "";
  if (!Number.isInteger(id) || id <= 0) {
    return keep(null, name, "identifiant inconnu : conservé par précaution", 0);
  }
  if (!name) {
    return keep(id, `rappel ${id}`, "nom inconnu : conservé par précaution", 0);
  }
  const createdMs = parseScheduleStamp(schedule.created_at);
  if (createdMs === null) {
    // Sans date de création on ne peut ni dater l'échéance ni l'ancienneté.
    return keep(id, name, "date de création illisible : conservé par précaution", 0);
  }
  const every = Number(schedule.every);
  if (!Number.isFinite(every) || every < SCHEDULE_MIN_EVERY_SECS) {
    return keep(id, name, "fréquence inexploitable : conservé par précaution", createdMs);
  }
  const ranMs = parseScheduleStamp(schedule.last_run_at);
  const oneShot = schedule.one_shot === true || schedule.one_shot === 1;
  const enabled = schedule.enabled === true || schedule.enabled === 1;

  // Règle 2 (prioritaire sur la règle 1 pour un rappel unique) : l'échéance d'un
  // rappel unique est FIXE (création + intervalle) ; elle ne se décale pas.
  if (oneShot) {
    const dueMs = createdMs + every * 1000;
    if (nowMs - dueMs > CLEANUP_ONE_SHOT_GRACE_DAYS * DAY_MS) {
      return { action: "delete", id, name, reason: REASON_ONE_SHOT_STALE, referenceMs: dueMs };
    }
    return keep(
      id,
      name,
      nowMs - dueMs > 0
        ? "rappel unique en retard récent : conservé"
        : "rappel unique à échéance future : conservé",
      dueMs,
    );
  }

  // Règle 1 : désactivé + aucune activité (exécution, sinon création) > 30 jours.
  if (schedule.enabled === false || schedule.enabled === 0) {
    const refMs = ranMs !== null ? ranMs : createdMs;
    if (nowMs - refMs > CLEANUP_DISABLED_STALE_DAYS * DAY_MS) {
      return { action: "delete", id, name, reason: REASON_DISABLED_STALE, referenceMs: refMs };
    }
    return keep(id, name, "rappel désactivé mais récent : conservé", refMs);
  }

  // `enabled` ni vrai ni faux : on ne sait pas classer → on garde (garde-fou 6).
  if (!enabled) {
    return keep(id, name, "état d'activation inconnu : conservé par précaution", ranMs ?? createdMs);
  }

  // Règle 3 : périodique ACTIF devenu stérile sur ses 20 dernières exécutions.
  const sterile = Number(schedule.sterile_runs);
  if (Number.isFinite(sterile) && sterile >= CLEANUP_STERILE_RUNS) {
    return { action: "disable", id, name, reason: REASON_STERILE, referenceMs: ranMs ?? createdMs };
  }

  // Rappel actif et récent : jamais touché (garde-fou 6).
  return keep(id, name, "rappel actif : conservé", ranMs ?? createdMs);
}

/**
 * Construit le PLAN de ménage (décision unique). Aucune écriture, aucune I/O.
 *
 * @param {object} opts
 * @param {object[]} opts.schedules   rappels tels que renvoyés par le backend
 *   (`id`, `name`, `every`, `enabled`, `last_run_at`, `created_at`, `one_shot`,
 *   `sterile_runs`).
 * @param {number|Date} [opts.now]    instant de référence (défaut : maintenant).
 * @param {string|number|null} [opts.lastCleanupAt] horodatage du dernier ménage
 *   effectué (persisté côté backend) — sert à la règle 5.
 * @param {boolean} [opts.enforceDailyGuard] `true` pour le ménage AUTOMATIQUE :
 *   aucun nouveau ménage si le précédent date de moins de 24 h. Le bouton manuel
 *   (geste du propriétaire) passe `false` : mêmes règles de contenu, sans attendre.
 * @returns {{run: boolean, skippedReason: string, delete: object[],
 *   disable: object[], keep: object[], activeCount: number}}
 *   `delete` et `disable` sont ordonnés du plus ancien au plus récent.
 */
export function classifyScheduleCleanup(opts) {
  const options = opts || {};
  const list = Array.isArray(options.schedules) ? options.schedules : [];
  const nowMs = parseScheduleStamp(options.now) ?? Date.now();
  const plan = { run: false, skippedReason: "", delete: [], disable: [], keep: [], activeCount: 0 };

  // Règle 5 : au plus un ménage automatique par jour (rien n'est jamais fait
  // deux fois dans la même journée, même après un redémarrage de Pilot).
  const lastMs = parseScheduleStamp(options.lastCleanupAt);
  if (options.enforceDailyGuard === true && lastMs !== null && nowMs - lastMs < CLEANUP_MIN_INTERVAL_MS) {
    plan.skippedReason = "ménage déjà effectué aujourd'hui";
    for (const s of list) {
      if (s && (s.enabled === true || s.enabled === 1)) plan.activeCount += 1;
    }
    plan.keep = list.map((s) => classifyScheduleCleanupItem(s, nowMs));
    return plan;
  }

  plan.run = true;
  for (const s of list) {
    const verdict = classifyScheduleCleanupItem(s, nowMs);
    if (verdict.action === "delete") plan.delete.push(verdict);
    else if (verdict.action === "disable") plan["disable"].push(verdict);
    else plan.keep.push(verdict);
    if (s && (s.enabled === true || s.enabled === 1)) plan.activeCount += 1;
  }
  // Règle 4 : « du plus ancien au plus récent ».
  plan.delete.sort((a, b) => a.referenceMs - b.referenceMs || (a.id ?? 0) - (b.id ?? 0));
  plan["disable"].sort((a, b) => a.referenceMs - b.referenceMs || (a.id ?? 0) - (b.id ?? 0));
  return plan;
}

/**
 * Vrai si la création d'un rappel serait refusée par le plafond de la règle 4
 * (au plus `CLEANUP_MAX_ACTIVE` rappels ACTIFS). Miroir exact du garde-fou Rust
 * (`schedule_insert`), utilisé par l'écran des rappels pour prévenir AVANT la
 * création au lieu de laisser l'Assistant découvrir le refus.
 */
export function scheduleCapReached(schedules) {
  const list = Array.isArray(schedules) ? schedules : [];
  const active = list.filter((s) => s && (s.enabled === true || s.enabled === 1)).length;
  return active >= CLEANUP_MAX_ACTIVE;
}

/** Ligne d'un candidat, pour le journal ET la confirmation (« — nom : raison »). */
export function formatCleanupCandidate(item) {
  const label = item && item.name ? item.name : `rappel ${item && item.id !== undefined ? item.id : "?"}`;
  const reason = item && item.reason ? item.reason : "";
  return reason ? `— ${label} : ${reason}` : `— ${label}`;
}

/**
 * Texte de confirmation affiché AVANT toute suppression (le bouton n'agit
 * qu'après accord). Annonce le NOMBRE, puis la liste des rappels concernés, du
 * plus ancien au plus récent (et les rappels seulement désactivés, s'il y en a).
 */
export function cleanupConfirmationText(plan) {
  const p = plan || { delete: [], disable: [] };
  const deletions = Array.isArray(p.delete) ? p.delete : [];
  const disables = Array.isArray(p["disable"]) ? p["disable"] : [];
  const total = deletions.length + disables.length;
  if (total === 0) {
    return "Aucun rappel inutile à supprimer : rien ne sera modifié.";
  }
  const parts = [];
  // Pluriels écrits en toutes lettres : un texte annoncé à l'utilisateur ne doit
  // jamais afficher « seraont ».
  const pluriel = (n) => (n > 1 ? "s" : "");
  if (deletions.length === 0) {
    parts.push("Aucun rappel à supprimer.");
  } else {
    const n = deletions.length;
    parts.push(`${n} rappel${pluriel(n)} ${n > 1 ? "seront" : "sera"} supprimé${pluriel(n)} :`);
    for (const item of deletions) parts.push(formatCleanupCandidate(item));
  }
  if (disables.length > 0) {
    const n = disables.length;
    parts.push(
      `${n} rappel${pluriel(n)} devenu${pluriel(n)} inutile${pluriel(n)} ${n > 1 ? "seront" : "sera"} désactivé${pluriel(n)} (pas supprimé${pluriel(n)} tout de suite) :`,
    );
    for (const item of disables) parts.push(formatCleanupCandidate(item));
  }
  return parts.join("\n");
}

/**
 * Charge utile envoyée au backend pour appliquer un plan : uniquement les
 * identifiants, noms et motifs (une ligne de journal par élément). Aucune autre
 * décision n'est prise en aval.
 */
export function cleanupApplyPayload(plan) {
  const p = plan || {};
  const toItem = (x) => ({ id: x.id, name: x.name || "", reason: x.reason || "" });
  return {
    deletions: (Array.isArray(p.delete) ? p.delete : []).map(toItem),
    disables: (Array.isArray(p["disable"]) ? p["disable"] : []).map(toItem),
  };
}
