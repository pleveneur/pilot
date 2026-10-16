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
 * Rust `get_super_agent_kanban`) dans les colonnes, dans l'ordre stable de
 * KANBAN_COLUMNS. Chaque colonne contient { key, label, icon, tone, cards }.
 * Une tâche annulée/abandonnée est exclue (hors tableau).
 *
 * Les IDÉES (table `idees_evolutions`, déjà existante) ne sont JAMAIS mélangées
 * aux tâches : elles sont rangées à part dans `todo.ideaCards`, pour être
 * affichées en sous-catégorie « Idées » de la colonne « À faire ». Le paramètre
 * `ideas` est optionnel (appel à un argument inchangé).
 */
export function buildKanbanColumns(tasks, ideas) {
  const columns = KANBAN_COLUMNS.map((c) => ({ ...c, cards: [] }));
  const byKey = new Map(columns.map((c) => [c.key, c]));
  for (const task of tasks || []) {
    const key = normalizeTaskStatus(task && task.status);
    if (key === "cancelled") continue; // archivé hors 4 colonnes
    const col = byKey.get(key) || byKey.get("todo");
    if (col) col.cards.push(task);
  }
  const todo = byKey.get("todo");
  if (todo) todo.ideaCards = (ideas || []).slice();
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

// ── Sélecteur de projet + sous-catégorie « Idées » (Kanban multi-projets) ────
// Le Kanban sert aussi bien pour UN projet que pour TOUS : un filtre en haut
// limite l'affichage à un projet (le choix est conservé côté vue). Ces fonctions
// pures ne connaissent ni DOM ni invoke → testables directement.

/** Valeur du sélecteur « Tous les projets » (choix par défaut). */
export const ALL_PROJECTS = "__all__";

/** Titre du sous-groupe d'idées dans la colonne « À faire ». */
export const IDEAS_GROUP_LABEL = "Idées";

/**
 * Liste les projets présents dans la réponse Kanban (tâches et/ou idées),
 * dédoublonnés par chemin et triés par nom. Retourne `[{ path, name }]`. Un
 * projet sans chemin est ignoré (impossible à filtrer). Pur.
 * @param {Array<{tasks?: Array}>} clients
 * @param {Array} [ideas]
 */
export function listKanbanProjects(clients, ideas) {
  const byPath = new Map();
  const add = (path, name) => {
    const p = String(path || "");
    if (!p || byPath.has(p)) return;
    byPath.set(p, { path: p, name: String(name || "") || p });
  };
  for (const client of clients || []) {
    for (const t of (client && client.tasks) || []) {
      if (t) add(t.project_path, t.project_name);
    }
  }
  for (const i of ideas || []) {
    if (i) add(i.project_path, i.project_name);
  }
  return Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/**
 * Aplatit toutes les tâches de la réponse Kanban et ne garde que celles du
 * projet demandé. `ALL_PROJECTS` (ou une valeur vide) ne filtre rien : le mode
 * « tous les projets » montre tout, chaque carte portant son projet. Pur.
 * @param {Array<{tasks?: Array}>} clients
 * @param {string} [projectPath]
 * @returns {Array}
 */
export function filterKanbanTasks(clients, projectPath) {
  const all = [];
  for (const client of clients || []) {
    for (const t of (client && client.tasks) || []) if (t) all.push(t);
  }
  if (!projectPath || projectPath === ALL_PROJECTS) return all;
  return all.filter((t) => String(t.project_path || "") === String(projectPath));
}

// Statuts d'idée considérés comme CLOS (l'idée n'est plus à faire) : on ne les
// affiche pas dans le tableau, comme les tâches annulées. Le reste (idee,
// a_prevoir, a planifier, « etudiee - verdict rendu… ») reste visible.
const IDEA_CLOSED_STATUSES = new Set([
  "implementee",
  "implemente",
  "realisee",
  "realise",
  "livree",
  "livre",
  "annulee",
  "annule",
  "abandonnee",
  "abandonne",
  "rejetee",
  "rejete",
]);

/**
 * Une idée est-elle encore ouverte (à afficher dans la sous-catégorie « Idées ») ?
 * Une idée implémentée / réalisée / livrée / annulée / rejetée est close. Le test
 * est insensible à la casse et aux accents. Pur.
 * @param {string} status
 * @returns {boolean}
 */
export function isOpenIdeaStatus(status) {
  const tokens = String(status || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  return !tokens.some((t) => IDEA_CLOSED_STATUSES.has(t));
}

/**
 * Idées à afficher, filtrées par projet et débarrassées de celles déjà closes.
 * `ALL_PROJECTS` (ou vide) ne filtre pas par projet. Pur.
 * @param {Array} ideas
 * @param {string} [projectPath]
 * @returns {Array}
 */
export function selectKanbanIdeas(ideas, projectPath) {
  const all = (ideas || []).filter((i) => i && isOpenIdeaStatus(i.status));
  if (!projectPath || projectPath === ALL_PROJECTS) return all;
  return all.filter((i) => String(i.project_path || "") === String(projectPath));
}

/**
 * Libellé projet d'une carte : « Projet » ou « Projet - Client » quand le client
 * est renseigné. Sert à comprendre d'un coup d'oeil à quel projet appartient la
 * carte en mode « tous les projets ». Retourne "" si aucun projet. Pur.
 * @param {{project_name?: string, client_name?: string}} item
 * @returns {string}
 */
export function formatCardProject(item) {
  const proj = String((item && item.project_name) || "").trim();
  const client = String((item && item.client_name) || "").trim();
  if (!proj) return client;
  if (!client || client === "Sans client") return proj;
  return `${proj} - ${client}`;
}

/**
 * Une tâche est-elle BLOQUÉE ? Le blocage est porté par la colonne
 * `blocker_reason` (marquée via `super_agent_flag_blocker`). Le motif doit
 * rester lisible sur la carte. Pur.
 * @param {{blocker_reason?: string}} task
 * @returns {boolean}
 */
export function isBlockedTask(task) {
  return String((task && task.blocker_reason) || "").trim().length > 0;
}

/**
 * Etat de dependance d'une tache vis-a-vis de la tache qu'elle attend
 * ("attend la tache X"). L'etat est calcule par le coeur
 * (`dependency_state` de `get_super_agent_kanban`) : "waiting" (la tache
 * attendue n'est pas close), "ready" (pas de dependance, ou dependance close),
 * "unknown" (lien mort). Un champ absent (reponse d'un coeur plus ancien) est
 * traite comme "ready" : on ne devine JAMAIS un « en attente ». Pur.
 * @param {{dependency_state?: string}} task
 * @returns {"waiting"|"ready"|"unknown"}
 */
export function taskDependencyState(task) {
  const state = String((task && task.dependency_state) || "").trim();
  if (state === "waiting" || state === "ready" || state === "unknown") return state;
  return "ready";
}

/**
 * La tache attend-elle une autre tache NON close ? Distinct du blocage par
 * incident (`isBlockedTask` / `blocker_reason`). Pur.
 * @param {{dependency_state?: string}} task
 * @returns {boolean}
 */
export function isWaitingDependency(task) {
  return taskDependencyState(task) === "waiting";
}

/**
 * Libelle du badge « En attente de : <titre> » d'une tache freinee par une
 * dependance. Retourne "" si la tache n'est pas en attente. Le titre vient du
 * coeur (`depends_on_title`) ; sans titre connu, on reste generique pour ne pas
 * inventer. Distinct du motif de blocage (incident). Pur.
 * @param {{dependency_state?: string, depends_on_title?: string}} task
 * @returns {string}
 */
export function dependencyLabel(task) {
  if (!isWaitingDependency(task)) return "";
  const title = String((task && task.depends_on_title) || "").trim();
  return title ? `En attente de : ${title}` : "En attente d'une autre tache";
}

// ── Idée 3 (Lot A), tranche 3.4 : checklist de livraison vue de l'écran ──────
// L'interface ne DÉCIDE rien et ne DEVINE rien : elle compte les points RELUS
// EN BASE (commandes `super_agent_task_check_*`) et se contente de LIRE le
// verdict rendu par le cœur (`guard_task_checklist`, tranche 3.3). Aucune règle
// de mode (désactivé / rappel / bloquant) n'est réécrite ici : le mode est
// décidé côté Rust, l'écran affiche le verdict. Ces fonctions pures sont
// testables sans DOM ni invoke.

/// Préfixe des messages du contrôle de checklist (miroir de
/// `checklist_gate_message` dans `super_agent.rs`).
export const CHECKLIST_GATE_PREFIX = "Checklist de livraison :";

/// Formule que le cœur n'ajoute QU'EN mode « rappel » : la clôture est alors
/// possible en relançant avec `force = true`.
export const CHECKLIST_FORCE_HINT = "force = true";

/**
 * Compte les points d'une checklist : `{ total, done, remaining }`. Une liste
 * absente ou vide donne 0/0/0 — une tâche sans point ne change donc jamais
 * d'apparence. Les entrées nulles sont ignorées. Pur.
 * @param {Array<{done?: boolean}>|null|undefined} checks
 * @returns {{total: number, done: number, remaining: number}}
 */
export function checklistProgress(checks) {
  const list = Array.isArray(checks) ? checks.filter(Boolean) : [];
  const total = list.length;
  const done = list.filter((c) => !!c.done).length;
  return { total, done, remaining: total - done };
}

/**
 * Compteur discret d'une carte : « 2/3 » (points cochés / total). Chaîne vide
 * quand la tâche ne porte AUCUN point, pour que les tâches existantes gardent
 * exactement leur apparence. Pur.
 * @param {Array<{done?: boolean}>|null|undefined} checks
 * @returns {string}
 */
export function checklistCounterLabel(checks) {
  const { total, done } = checklistProgress(checks);
  return total ? `${done}/${total}` : "";
}

/**
 * Lit le VERDICT du contrôle de checklist dans l'erreur renvoyée par le cœur
 * (`super_agent_update_task_status` / `super_agent_update_task`). Le mode reste
 * décidé côté Rust ; l'interface se borne à distinguer les deux refus possibles
 * d'après le message, sans réimplémenter la règle :
 *  - `needsConfirmation` : la clôture est possible en relançant UNE fois avec
 *    `force: true` (la formule « force = true » n'est présente qu'en mode
 *    « rappel ») ;
 *  - `refused` : la clôture est refusée (mode bloquant) — forcer n'y changerait
 *    rien, donc aucune relance n'est proposée ;
 *  - `gate: false` : l'erreur ne vient pas du contrôle de checklist (erreur
 *    technique, à journaliser telle quelle).
 * Pur.
 * @param {unknown} err erreur rejetée par `invoke`, ou son message
 * @returns {{gate: boolean, needsConfirmation: boolean, refused: boolean,
 *            remaining: number, message: string}}
 */
export function parseChecklistGate(err) {
  const message = String((err && err.message) || err || "").trim();
  if (!message.includes(CHECKLIST_GATE_PREFIX)) {
    return { gate: false, needsConfirmation: false, refused: false, remaining: 0, message };
  }
  const m = /(\d+)\s*point/i.exec(message);
  const needsConfirmation = message.includes(CHECKLIST_FORCE_HINT);
  return {
    gate: true,
    needsConfirmation,
    refused: !needsConfirmation,
    remaining: m ? Number(m[1]) : 0,
    message,
  };
}
