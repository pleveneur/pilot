// super-agent-kanban.js — Vue Kanban multi-projets de l'onglet Assistant (🧭).
//
// « Kanban multi-projets » : chaque tâche de suivi de l'assistant
// (~/.pilot/super-agent.db, tables tasks/decisions/session_summaries gérées par
// l'Assistant) est classée dans l'une des 4 colonnes Kanban via une NORMALISATION
// de son statut texte libre (`status`), car la base contient des statuts
// variés (demande, planifie, en_cours, terminee, livree, annulee, …) selon les
// agents/projets qui les ont créés.
//
// Normalisation SANS IA : le statut est mis en minuscules, sans accents ni
// espaces, puis comparé à des ensembles connus. Un statut inconnu/défaut tombe
// dans « À faire ». Les statuts annulés/abandonnés ne sont PAS rangés dans les
// 4 colonnes (archivés hors tableau).
//
// Module 100 % pur (aucun DOM, aucun invoke) → testable unitairement.

/** 4 colonnes Kanban, dans l'ordre d'affichage. key = identifiant stable. */
export const KANBAN_COLUMNS = [
  { key: "todo", label: "À faire", icon: "circle-dashed", tone: "todo" },
  { key: "progress", label: "En cours", icon: "loader", tone: "progress" },
  { key: "review", label: "À valider", icon: "eye", tone: "review" },
  { key: "done", label: "Terminé", icon: "check-circle-2", tone: "done" },
];

// Statuts « non affichés » dans les 4 colonnes (annulés / abandonnés).
const CANCELLED_STATUSES = new Set([
  "annule",
  "annulee",
  "abandonne",
  "abandonnee",
  "cancelled",
  "ignoree",
]);

// Statuts → colonne « À faire » (demande en cours de traitement / planifiée).
const TODO_STATUSES = new Set([
  "demande",
  "planifie",
  "planifiee",
  "propos",
  "proposee",
  "nouveau",
  "nouvelle",
  "a_faire",
  "todo",
  "backlog",
  "prioritaire",
]);

// Statuts → colonne « En cours » (travail engagé).
const PROGRESS_STATUSES = new Set([
  "en_cours",
  "encours",
  "en_travail",
  "travail",
  "actif",
  "active",
  "started",
  "progress",
  "doing",
  "entamee",
  "entame",
]);

// Statuts → colonne « À valider » (revue / test / attente confirmation).
const REVIEW_STATUSES = new Set([
  "a_valider",
  "avalider",
  "a_tester",
  "en_validation",
  "validation",
  "en_attente",
  "attente",
  "waiting",
  "review",
  "qa",
  "test",
]);

// Statuts → colonne « Terminé » (réalisé / livré / validé / résolu).
const DONE_STATUSES = new Set([
  "terminee",
  "termine",
  "finie",
  "fini",
  "livree",
  "livre",
  "achevee",
  "acheve",
  "validee",
  "valide",
  "atteinte",
  "atteint",
  "fermee",
  "ferme",
  "cloturee",
  "resolue",
  "resolu",
  "done",
  "closed",
]);

/** Réduit un statut à sa forme normalisée (minuscules, sans accents/espaces). */
function normalizeStatusToken(status) {
  return String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Normalise un statut libre vers une colonne Kanban : todo | progress | review
 * | done | "cancelled" (hors colonnes). Toute valeur inconnue/vide → "todo".
 */
export function normalizeTaskStatus(status) {
  const token = normalizeStatusToken(status);
  if (!token) return "todo";
  if (CANCELLED_STATUSES.has(token)) return "cancelled";
  if (PROGRESS_STATUSES.has(token)) return "progress";
  if (REVIEW_STATUSES.has(token)) return "review";
  if (DONE_STATUSES.has(token)) return "done";
  if (TODO_STATUSES.has(token)) return "todo";
  // Défaut conservateur : une tâche demandée et non catégorisée → À faire.
  return "todo";
}

/**
 * Statut canonique à ÉCRIRE en base pour une colonne Kanban (inverse de
 * normalizeTaskStatus) : quand l'utilisateur déplace une carte entre colonnes
 * depuis la vue, on persiste le statut texte canonique du tableau (demande /
 * en_cours / a_valider / terminee) ou la variante annulée. Une colonne
 * inconnue retombe sur « demande » (À faire). Logique pure, sans DOM ni invoke.
 */
export function columnToStatus(key) {
  switch (key) {
    case "todo":
      return "demande";
    case "progress":
      return "en_cours";
    case "review":
      return "a_valider";
    case "done":
      return "terminee";
    case "cancelled":
      return "annulee";
    default:
      return "demande";
  }
}

/**
 * Répartit une liste de tâches brutes (telles que retournées par la commande
 * Rust `get_super_agent_kanban`) dans les 4 colonnes, dans l'ordre stable de
 * KANBAN_COLUMNS. Chaque colonne contient { key, label, icon, tone, cards }.
 * Une tâche annulée/abandonnée est exclue (hors tableau).
 */
export function buildKanbanColumns(tasks) {
  const columns = KANBAN_COLUMNS.map((c) => ({ ...c, cards: [] }));
  const byKey = new Map(columns.map((c) => [c.key, c]));
  for (const task of tasks || []) {
    const key = normalizeTaskStatus(task && task.status);
    if (key === "cancelled") continue; // archivé hors 4 colonnes
    const col = byKey.get(key) || byKey.get("todo");
    if (col) col.cards.push(task);
  }
  return columns;
}

/**
 * Comptes par colonne (aide à l'affichage d'un résumé compact si besoin).
 * Retourne un objet { todo, progress, review, done }.
 */
export function countByColumn(columns) {
  const counts = { todo: 0, progress: 0, review: 0, done: 0 };
  for (const col of columns) counts[col.key] = (col.cards || []).length;
  return counts;
}

/**
 * Structure la vue Kanban multi-projets PAR CLIENT : pour chaque client de la
 * réponse de `get_super_agent_kanban` (liste de { name, tasks }), calcule ses
 * 4 colonnes via buildKanbanColumns. Retourne un tableau [{ name, columns }]
 * prêt à être rendu, chaque `columns` étant au format KANBAN_COLUMNS enrichi
 * (`cards`). Logique pure → testable sans DOM.
 */
export function buildKanbanByClient(clients) {
  return (clients || []).map((client) => ({
    name: (client && client.name) || "Sans client",
    columns: buildKanbanColumns((client && client.tasks) || []),
  }));
}
