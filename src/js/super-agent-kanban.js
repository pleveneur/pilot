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
  // Statut vraiment inconnu : ni « à faire » ni masqué, isolé dans sa propre
  // case pour qu'il reste visible et qualifiable par le propriétaire.
  { key: "unqualified", label: "À qualifier", icon: "help-circle", tone: "unqualified" },
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
  "afaire",
  "todo",
  "backlog",
  "prioritaire",
]);

// Statuts → colonne « En cours » (travail engagé).
const PROGRESS_STATUSES = new Set([
  "en_cours",
  "encours",
  "en_travail",
  "entravail",
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
  "atester",
  "en_validation",
  "envalidation",
  "validation",
  "en_attente",
  "enattente",
  "attente",
  "waiting",
  "review",
  "qa",
  "test",
]);

// Statuts → colonne « Terminé » (réalisé / livré / validé / résolu). Ces
// mots-clés servent AUSSI de marqueurs de FIN reconnus dans un statut en texte
// libre (voir `normalizeTaskStatus`) : « terminee - verifie par les fichiers … »
// ou « fermee_github » comptent donc comme terminé.
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
  "cloture",
  "resolue",
  "resolu",
  "decidee",
  "fermeegithub",
  "done",
  "closed",
]);

/**
 * Découpe un statut libre en jetons normalisés (minuscules, sans accents,
 * séparés sur tout caractère non alphanumérique). « terminee - verifie … » →
 * ["terminee", "verifie", …]. Pur.
 */
function statusTokens(status) {
  return String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Normalise un statut libre vers une colonne Kanban : todo | progress | review
 * | done | "cancelled" | "unqualified". La décision « ouverte ou close » est
 * PRISE ICI, en un seul endroit, côté interface (miroir Rust :
 * `classify_task_status` dans `super_agent.rs`) :
 *  - annulé/abandonné → "cancelled" (hors colonnes) ;
 *  - un marqueur de fin (terminee, livree, fermee, decidee, …) reconnu comme
 *    jeton du statut → "done", même suivi d'un texte libre ;
 *  - sinon exactement l'un des statuts connus → sa colonne ;
 *  - statut vide ou vraiment inconnu → "unqualified" (jamais « À faire »).
 */
export function normalizeTaskStatus(status) {
  const tokens = statusTokens(status);
  if (!tokens.length) return "unqualified";
  const joined = tokens.join("");
  if (joined === "aqualifier") return "unqualified";
  if (CANCELLED_STATUSES.has(joined) || tokens.some((t) => CANCELLED_STATUSES.has(t))) {
    return "cancelled";
  }
  if (DONE_STATUSES.has(joined) || tokens.some((t) => DONE_STATUSES.has(t))) {
    return "done";
  }
  if (PROGRESS_STATUSES.has(joined)) return "progress";
  if (REVIEW_STATUSES.has(joined)) return "review";
  if (TODO_STATUSES.has(joined)) return "todo";
  // Un statut vraiment inconnu n'est PAS « à faire » : il reste visible dans
  // la case distincte « À qualifier ».
  return "unqualified";
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
    case "unqualified":
      return "a_qualifier";
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

// ── Clôture EN LOT (sélection multiple) ─────────────────────────────────────
// Le propriétaire peut cocher plusieurs tâches de la vue Kanban et les clôturer
// d'un coup. Aucune écriture nouvelle n'est introduite : la clôture passe par la
// MÊME route que la clôture unitaire (`super_agent_update_task_status`, via
// `columnToStatus("done")`), une fois par tâche cochée. Ces fonctions pures
// isolent les décisions (sélection, activation du bouton, confirmation,
// réversibilité) pour les tester sans DOM.

/** Statut écrit par la clôture en lot : la colonne « Terminé ». */
export const BULK_CLOSE_STATUS = columnToStatus("done");

/**
 * Ouvre (checked=true) ou ferme (checked=false) la sélection d'une tâche.
 * Retourne un NOUVEL ensemble — l'état précédent n'est jamais modifié. Pur.
 * @param {Set<number>|null} selection
 * @param {number} taskId
 * @param {boolean} checked
 * @returns {Set<number>}
 */
export function toggleSelection(selection, taskId, checked) {
  const next = new Set(selection || []);
  if (checked) next.add(taskId);
  else next.delete(taskId);
  return next;
}

/** Nombre de tâches sélectionnées (0 pour un ensemble vide ou absent). Pur. */
export function selectionCount(selection) {
  return selection ? selection.size : 0;
}

/**
 * Le bouton « Clôturer la sélection » doit-il être visible et actif ? Oui
 * seulement si au moins une tâche est cochée. Pur.
 */
export function canCloseSelection(selection) {
  return selectionCount(selection) > 0;
}

/** Texte de la confirmation obligatoire : nombre de tâches + réversibilité. Pur. */
export function bulkCloseConfirmMessage(count) {
  const n = Number(count) || 0;
  return (
    `Clôturer ${n} tâche${n > 1 ? "s" : ""} ? Leur statut passera à « Terminé » et elles ` +
    `quitteront leur colonne. Rien n'est supprimé : l'opération est réversible ` +
    `(bouton « Annuler » juste après).`
  );
}

/**
 * Prépare les changements d'une clôture en lot SANS rien écrire : chaque
 * changement vaut `{ id, from, to }`. Une tâche cochée absente de la liste est
 * ignorée (jamais inventée). Pur.
 * @param {Array<{id:number,status:string}>} tasks
 * @param {Set<number>|null} selection
 * @returns {Array<{id:number,from:string,to:string}>}
 */
export function buildBulkClosePlan(tasks, selection) {
  const ids = selection || new Set();
  const changes = [];
  for (const t of tasks || []) {
    if (!t || t.id == null) continue;
    if (!ids.has(t.id)) continue;
    changes.push({ id: t.id, from: String(t.status || ""), to: BULK_CLOSE_STATUS });
  }
  return changes;
}

/**
 * Décide de l'application de la clôture en lot : c'est le SEUL endroit où l'on
 * décide si quelque chose est écrit. `confirmed === false` (confirmation
 * refusée) → aucun changement, rien ne bouge. Pur.
 * @returns {{applied: boolean, changes: Array<{id:number,from:string,to:string}>}}
 */
export function planBulkClose(tasks, selection, confirmed) {
  if (!confirmed) return { applied: false, changes: [] };
  return { applied: true, changes: buildBulkClosePlan(tasks, selection) };
}

/**
 * Plan inverse, pour le bouton « Annuler » : rétablit le statut précédent de
 * chaque tâche clôturée. Ne contient que des changements de statut — jamais une
 * suppression. Pur.
 * @param {Array<{id:number,from:string,to:string}>} changes
 * @returns {Array<{id:number,status:string}>}
 */
export function buildBulkUndoPlan(changes) {
  return (changes || [])
    .filter((c) => c && c.id != null)
    .map((c) => ({ id: c.id, status: c.from }));
}

/**
 * Une tâche est-elle OUVERTE ? L'onglet « Tâches » du panneau cloche ne montre
 * que le travail qui reste à faire. Une tâche terminée, annulée/abandonnée OU
 * à qualifier (statut inconnu) n'est pas « ouverte » : elle ne doit pas
 * gonfler la liste « à faire ». Pur et testable.
 * @param {string} status statut brut en base
 * @returns {boolean}
 */
export function isOpenTaskStatus(status) {
  const key = normalizeTaskStatus(status);
  return key === "todo" || key === "progress" || key === "review";
}

/**
 * Libellé français d'une colonne Kanban pour un statut brut (« À faire », « En
 * cours », « À valider », « Terminé »). Sert à afficher le statut de façon
 * lisible dans la liste des tâches ouvertes. Un statut annulé/abandonné
 * retombe sur « Annulée » ; un statut inconnu sur « À faire ». Pur.
 * @param {string} status
 * @returns {string}
 */
export function taskStatusLabel(status) {
  const key = normalizeTaskStatus(status);
  if (key === "cancelled") return "Annulée";
  const col = KANBAN_COLUMNS.find((c) => c.key === key);
  return col ? col.label : "À faire";
}

/**
 * Ne garde, dans la réponse de `get_super_agent_kanban`, que les tâches
 * OUVERTES, en conservant la structure par client. Un client dont toutes les
 * tâches sont terminées/annulées est retiré (pas d'en-tête vide). Pur.
 * @param {Array<{name?: string, tasks?: Array}>} clients
 * @returns {Array<{name: string, tasks: Array}>}
 */
export function filterOpenTasksByClient(clients) {
  const out = [];
  for (const client of clients || []) {
    if (!client) continue;
    const tasks = (client.tasks || []).filter((t) => isOpenTaskStatus(t && t.status));
    if (tasks.length) out.push({ name: client.name || "Sans client", tasks });
  }
  return out;
}

/**
 * Miroir de `filterOpenTasksByClient` pour la case distincte « À qualifier » :
 * conserve les tâches au statut inconnu (ni ouverte ni close), par client, afin
 * qu'elles restent VISIBLES et qualifiables au lieu d'être comptées « à faire ».
 * Pur.
 * @param {Array<{name?: string, tasks?: Array}>} clients
 * @returns {Array<{name: string, tasks: Array}>}
 */
export function filterUnqualifiedTasksByClient(clients) {
  const out = [];
  for (const client of clients || []) {
    if (!client) continue;
    const tasks = (client.tasks || []).filter(
      (t) => normalizeTaskStatus(t && t.status) === "unqualified"
    );
    if (tasks.length) out.push({ name: client.name || "Sans client", tasks });
  }
  return out;
}

/**
 * Formate la date d'échéance d'une tâche (colonne `deadline`, ISO `YYYY-MM-DD`)
 * pour l'affichage : `{ text: "JJ/MM/AAAA", overdue, iso }`, ou `null` si
 * absente ou illisible. La comparaison au jour courant se fait sur la chaîne
 * ISO (ordre lexicographique = ordre chronologique). `now` est injectable pour
 * un test déterministe. Pur.
 * @param {string|undefined|null} deadline
 * @param {Date} [now]
 * @returns {{text: string, overdue: boolean, iso: string}|null}
 */
export function formatTaskDeadline(deadline, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(deadline || "").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { text: `${m[3]}/${m[2]}/${m[1]}`, overdue: iso < today, iso };
}
