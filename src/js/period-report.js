// period-report.js — Idée 5 (Lot A) : « Bilan de période ».
//
// Logique PURE : bornes de période et mise en forme du texte du bilan. Aucun
// accès DOM, aucun appel Tauri → testable directement dans `period-report.test.js`.
//
// Règle de période : semaine du LUNDI au DIMANCHE, en heure LOCALE. Les bornes
// sont rendues en `YYYY-MM-DD` LOCAL, jamais via `toISOString()` (qui travaille
// en UTC et décalerait la semaine d'un jour à l'ouest de Greenwich). Le backend
// reçoit ces deux dates ISO et ne fait aucun calcul de fuseau.

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Date locale `YYYY-MM-DD` (jamais UTC). Accepte un `Date` ou une valeur
 * convertible ; une valeur invalide donne `""`. */
export function isoLocalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai si `value` est une date ISO `YYYY-MM-DD` bien formée. */
export function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value.trim());
}

/** Bornes de la semaine (lundi → dimanche) contenant `reference`, en local. */
export function weekBounds(reference = new Date()) {
  const ref = reference instanceof Date ? reference : new Date(reference);
  const day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const offset = (day.getDay() + 6) % 7; // 0 = lundi … 6 = dimanche
  const monday = new Date(day);
  monday.setDate(day.getDate() - offset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoLocalDate(monday), to: isoLocalDate(sunday) };
}

/** Bornes de la semaine précédant celle de `reference`. */
export function previousWeekBounds(reference = new Date()) {
  const ref = reference instanceof Date ? reference : new Date(reference);
  const day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  day.setDate(day.getDate() - 7);
  return weekBounds(day);
}

export const PERIOD_KIND_LABELS = {
  "this-week": "Semaine en cours",
  "last-week": "Semaine dernière",
  custom: "Période libre",
};

/** Libellé lisible d'un type de période (`""` si inconnu). */
export function periodKindLabel(kind) {
  return PERIOD_KIND_LABELS[kind] || "";
}

/**
 * Bornes `[from, to]` pour un type de période :
 * - `"this-week"` → semaine contenant `reference` ;
 * - `"last-week"` → semaine précédente ;
 * - `"custom"` → bornes libres `custom.from` / `custom.to` (inversées si
 *   nécessaire) ; `null` si l'une des deux dates n'est pas une date ISO valide.
 * Tout autre type (ou custom incomplet) → `null`.
 */
export function periodBounds(kind, reference = new Date(), custom = null) {
  if (kind === "this-week") return weekBounds(reference);
  if (kind === "last-week") return previousWeekBounds(reference);
  if (kind === "custom") {
    const from = custom && typeof custom.from === "string" ? custom.from.trim() : "";
    const to = custom && typeof custom.to === "string" ? custom.to.trim() : "";
    if (!isIsoDate(from) || !isIsoDate(to)) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return null;
}

/** Nombre d'entrées d'une section du bilan (liste absente = 0). */
function sectionItems(report, key) {
  const value = report && report[key];
  return Array.isArray(value) ? value : [];
}

function bullet(value) {
  const text = value == null ? "" : String(value).trim();
  return text ? text : "(sans libellé)";
}

function appendSection(lines, heading, items, render) {
  lines.push("");
  lines.push(`${heading} (${items.length})`);
  if (!items.length) {
    lines.push("- Aucun");
    return;
  }
  for (const item of items) lines.push(`- ${render(item)}`);
}

/**
 * Met en forme un bilan `report` (JSON renvoyé par la commande
 * `super_agent_period_report`) en texte prêt à coller. Robuste : un rapport
 * absent ou partiel produit un texte « vide » cohérent (toutes les sections
 * affichent « Aucun »), jamais une exception.
 *
 * @param {object|null} report
 * @param {{title?: string}} [options]
 * @returns {string}
 */
export function formatPeriodReport(report, options = {}) {
  const r = report && typeof report === "object" ? report : {};
  const from = typeof r.from === "string" ? r.from : "";
  const to = typeof r.to === "string" ? r.to : "";
  const title = (options && options.title) || "Bilan de période";

  const tasks = sectionItems(r, "tasks_done");
  const decisions = sectionItems(r, "decisions");
  const milestones = sectionItems(r, "milestones");
  const blockers = sectionItems(r, "blockers");

  const lines = [`${title} — ${from || "?"} → ${to || "?"}`];

  appendSection(lines, "Tâches terminées/livrées", tasks, (t) =>
    t && t.project_name ? `${bullet(t.title)} (${t.project_name})` : bullet(t && t.title)
  );
  appendSection(lines, "Décisions prises", decisions, (d) =>
    d && d.project_name ? `${bullet(d.summary)} (${d.project_name})` : bullet(d && d.summary)
  );
  appendSection(lines, "Jalons atteints", milestones, (m) =>
    m && m.due_date ? `${bullet(m.title)} — échéance ${m.due_date}` : bullet(m && m.title)
  );
  appendSection(lines, "Blocages rencontrés", blockers, (b) => {
    const title2 = bullet(b && b.title);
    const reason = b && b.blocker_reason ? String(b.blocker_reason).trim() : "";
    return reason ? `${title2} — ${reason}` : title2;
  });

  return lines.join("\n");
}
