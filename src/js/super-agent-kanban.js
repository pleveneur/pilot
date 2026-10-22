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
 * Une tâche est-elle OUVERTE ? L'onglet « Tâches » du suivi du travail ne montre
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

// ── Idée 1 (Lot A), tranche 1.3 : pastille « tâche longue » des cartes ──────
// Le signal est CALCULÉ PAR LE CŒUR RUST (`detect_long_task`, tranches 1.1/1.2)
// et arrive DÉJÀ DANS L'ÉTAT du Kanban sous deux champs : `is_long_task`
// (booléen) et `long_task_reason` (raison courte déjà rédigée, ou null).
// L'interface ne DÉTECTE RIEN et ne calcule AUCUN seuil : elle se borne à LIRE
// ces deux champs reçus du serveur et à recopier la raison telle quelle dans
// l'infobulle. Une carte ordinaire ne reçoit donc aucune pastille et garde
// exactement son apparence.

/// Texte de la pastille discrète des cartes signalées comme longues.
export const LONG_TASK_PILL_LABEL = "longue";

/**
 * Pastille « tâche longue » d'une carte, telle qu'elle doit être affichée :
 * `{ label, reason }` quand le cœur a signalé la tâche comme longue
 * (`is_long_task`), `null` sinon — une carte ordinaire ne reçoit donc AUCUNE
 * pastille. Le seuil de détection n'est jamais recalculé ici : seule la valeur
 * reçue du cœur est lue, jamais le texte de la demande. `reason` est la raison
 * fournie TELLE QUELLE (chaîne vide si le cœur n'en fournit pas : aucune raison
 * n'est inventée). Pur.
 * @param {{is_long_task?: boolean, long_task_reason?: string|null}} task
 * @returns {{label: string, reason: string}|null}
 */
export function longTaskPill(task) {
  if (!task || !task.is_long_task) return null;
  const reason = String(task.long_task_reason == null ? "" : task.long_task_reason).trim();
  return { label: LONG_TASK_PILL_LABEL, reason };
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

// ── Idée 3 (Lot A), tranche 3.5 : réglages de la checklist de livraison ─────
// Deux réglages pilotent la checklist : le MODE de contrôle au passage en
// « Terminé » (`super_agent_checklist_mode`) et le MODÈLE de points proposé sur
// une tâche qui n'a encore aucun point (`super_agent_checklist_template`).
// Rien n'est décidé ici sur le fond du contrôle (c'est le cœur Rust qui
// tranche) : ces fonctions PURES se bornent à lire/normaliser la configuration,
// découper le modèle en lignes et dire si l'écran peut PROPOSER les points du
// modèle. SANS I/O, testables directement.

/// Modèle de checklist par défaut, un point par ligne. Miroir de
/// `default_super_agent_checklist_template` (src-tauri/src/lib.rs) : une config
/// ancienne, absente ou vide retombe EXACTEMENT sur ces trois points.
export const DEFAULT_CHECKLIST_TEMPLATE_LINES = [
  "Tests passés",
  "Documentation à jour",
  "Rien de non commité",
];
export const DEFAULT_CHECKLIST_TEMPLATE = DEFAULT_CHECKLIST_TEMPLATE_LINES.join("\n");

/** Modes de contrôle acceptés, dans l'ordre d'affichage du réglage. */
export const CHECKLIST_MODES = ["off", "warn", "block"];

/**
 * Normalise le mode de contrôle de checklist (`super_agent_checklist_mode`) avec
 * repli SÛR sur `warn` — même règle que `checklist_mode_from_config` côté Rust :
 * une valeur absente, vide, inconnue ou en casse différente vaut « rappel »
 * (jamais bloquant par surprise, jamais silencieusement désactivé). Pur.
 * @param {unknown} raw
 * @returns {"off"|"warn"|"block"}
 */
export function normalizeChecklistMode(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  if (v === "off") return "off";
  if (v === "block") return "block";
  return "warn";
}

/**
 * Normalise le modèle de checklist (`super_agent_checklist_template`) : un champ
 * absent ou vide (config ancienne) retombe sur le modèle par défaut — la même
 * valeur que celle écrite par le cœur Rust. Pur.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeChecklistTemplate(raw) {
  const v = String(raw == null ? "" : raw).trim();
  return v || DEFAULT_CHECKLIST_TEMPLATE;
}

/**
 * Découpe le modèle en points : une ligne non vide = un point. Les lignes
 * vides/blanches sont ignorées, les espaces de début/fin retirés, `\r\n`
 * toléré. Un modèle absent/vide donne donc les points du modèle par défaut.
 * Pur.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseChecklistTemplate(raw) {
  return normalizeChecklistTemplate(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * L'écran peut-il PROPOSER les points du modèle sur cette tâche ? Oui seulement
 * si la tâche n'a AUCUN point ET que le contrôle n'est pas désactivé (`off`).
 * Rien n'est jamais imposé : c'est le clic de l'utilisateur qui crée les points.
 * Pur.
 * @param {Array<{done?: boolean}>|null|undefined} checks points relus en base
 * @param {unknown} mode mode de configuration brut
 * @returns {boolean}
 */
export function shouldOfferTemplatePoints(checks, mode) {
  if (normalizeChecklistMode(mode) === "off") return false;
  return checklistProgress(checks).total === 0;
}

// ── Idée 4 (Lot A), tranche 4.4 : bloc « Livrable » de la fiche de tâche ─────
// La fiche d'une tâche affiche ses lignes de traçabilité RELUES EN BASE
// (`super_agent_task_deliverable_list`, tranche 4.3) : libellé du livrable, date,
// et l'origine (ou la décision liée) quand elle existe. Rien n'est décidé ni
// inventé ici : ces fonctions PURES normalisent la réponse des commandes de
// lecture et préparent l'affichage. L'écriture d'une ligne est AUTOMATIQUE côté
// cœur (tranche 4.2) : l'interface n'offre aucun chemin d'écriture.

/// Noms EXACTS des deux commandes de lecture de la traçabilité (contrat avec
/// `super_agent.rs`, tranche 4.3). La fiche n'appelle que la commande par tâche ;
/// la commande par projet servira à la vue « Traçabilité » (tranche suivante).
export const TASK_DELIVERABLE_LIST_COMMAND = "super_agent_task_deliverable_list";
export const PROJECT_DELIVERABLE_LIST_COMMAND = "super_agent_project_deliverable_list";

/// Mention de repli écrite par le cœur quand l'origine d'un livrable n'est pas
/// identifiable (miroir de `DELIVERABLE_ORIGIN_UNKNOWN`, super_agent.rs). Elle
/// n'est jamais répétée à l'écran : elle signifie « origine inconnue ».
export const DELIVERABLE_ORIGIN_UNKNOWN = "origine non précisée";

/// Texte du bloc « Livrable » quand la tâche n'a AUCUNE livraison.
export const DELIVERABLE_EMPTY_TEXT = "Aucune livraison enregistrée";

/// Début de la ligne d'information affichée quand la lecture échoue.
export const DELIVERABLE_ERROR_PREFIX = "Livraisons indisponibles";

/**
 * Formate l'horodatage d'une ligne de traçabilité (`created_at`, SQLite
 * « AAAA-MM-JJ HH:MM:SS » ou ISO) au format « JJ/MM/AAAA ». Chaîne vide si
 * l'horodatage est absent ou illisible : on n'invente jamais une date. Pur.
 * @param {string|null|undefined} createdAt
 * @returns {string}
 */
export function formatDeliverableDate(createdAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(createdAt == null ? "" : createdAt).trim());
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Origine affichable d'une ligne : la décision liée quand elle existe
 * (« Décision #12 »), complétée par l'origine textuelle si elle est renseignée.
 * La mention de repli du cœur (« origine non précisée ») n'est jamais répétée.
 * Chaîne vide quand l'origine est inconnue : aucune mention n'est inventée. Pur.
 * @param {{decision_id?: number|null, origin?: string}} row ligne brute relue
 * @returns {string}
 */
export function deliverableOriginLabel(row) {
  const r = row || {};
  const origin = String(r.origin == null ? "" : r.origin).trim();
  const known = origin && origin !== DELIVERABLE_ORIGIN_UNKNOWN ? origin : "";
  if (r.decision_id != null) {
    return known ? `Décision #${r.decision_id} : ${known}` : `Décision #${r.decision_id}`;
  }
  return known;
}

/**
 * Normalise la réponse d'une commande de lecture (`{ deliverables: [...] }`) en
 * lignes d'affichage `{ id, label, date, origin }`. L'ORDRE de la base est
 * CONSERVÉ (la fiche affiche l'ordre de production, du plus ancien au plus
 * récent) : aucun tri n'est refait ici. Les entrées nulles sont ignorées ; une
 * réponse absente ou sans ligne donne une liste VIDE — aucune ligne inventée. Pur.
 * @param {{deliverables?: Array}|null|undefined} result
 * @returns {Array<{id: number|null, label: string, date: string, origin: string}>}
 */
export function buildDeliverableLines(result) {
  const rows = result && Array.isArray(result.deliverables) ? result.deliverables : [];
  const lines = [];
  for (const row of rows) {
    if (!row) continue;
    lines.push({
      id: row.id == null ? null : row.id,
      label: String(row.label == null ? "" : row.label).trim(),
      date: formatDeliverableDate(row.created_at),
      origin: deliverableOriginLabel(row),
    });
  }
  return lines;
}

/**
 * Libellé du compteur discret du bloc : « 2 livraisons », ou chaîne VIDE quand
 * la tâche n'a aucune livraison (aucune mention parasite sur les tâches sans
 * traçabilité). Pur.
 * @param {number} count
 * @returns {string}
 */
export function deliverableCounterLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `${n} livraison${n > 1 ? "s" : ""}`;
}

/**
 * Prépare le contenu du bloc « Livrable » de la fiche à partir de la réponse
 * brute de la commande de lecture : `{ lines, count, counter, empty }`. Aucune
 * lecture n'est faite ici (l'appel `invoke` reste à l'interface) et aucune ligne
 * n'est inventée : une réponse vide donne `empty: true`. Pur.
 * @param {{deliverables?: Array}|null|undefined} result
 * @returns {{lines: Array, count: number, counter: string, empty: boolean}}
 */
export function buildDeliverableBlock(result) {
  const lines = buildDeliverableLines(result);
  return {
    lines,
    count: lines.length,
    counter: deliverableCounterLabel(lines.length),
    empty: lines.length === 0,
  };
}

/**
 * Ligne d'information affichée si la lecture des livraisons échoue. Ne lève
 * JAMAIS d'exception (`err` peut être une chaîne, un objet `Error`, `null`…) :
 * la fiche doit continuer de fonctionner. Pur.
 * @param {unknown} err
 * @returns {string}
 */
export function deliverableErrorMessage(err) {
  const detail = String((err && err.message) || err || "").trim();
  return detail ? `${DELIVERABLE_ERROR_PREFIX} : ${detail}` : DELIVERABLE_ERROR_PREFIX;
}

// ── Idée 2 (Lot A), tranche 3 : temps prévu / passé (fiche + carte) ──────────
// Les deux temps d'une tâche sont LUS EN BASE par les commandes de la tranche 2
// (`super_agent_task_time_*`). L'écran ne calcule rien et ne devine rien :
// `estimated_set` / `spent_set` (booléens) distinguent « non renseigné » de 0
// (« rien prévu » / « rien passé ») — en JavaScript, 0 est faux, donc la VALEUR
// ne doit jamais servir de test de présence. Ces fonctions PURES préparent
// l'affichage et valident la saisie, sans DOM ni invoke.

/// Noms EXACTS des trois commandes du temps (contrat avec `super_agent.rs`,
/// tranche 2.2). La lecture unitaire sert à relire la valeur après CHAQUE
/// opération, y compris la pastille des cartes.
export const TASK_TIME_GET_COMMAND = "super_agent_task_time_get";
export const TASK_TIME_SET_ESTIMATED_COMMAND = "super_agent_task_time_set_estimated";
export const TASK_TIME_ADD_SPENT_COMMAND = "super_agent_task_time_add_spent";

/// Mention affichée quand seul le temps passé est renseigné : jamais une
/// estimation déduite du passé (aucun calcul faux).
export const NO_ESTIMATE_TEXT = "pas d'estimation";

/// Texte du bloc de la fiche quand AUCUN des deux temps n'est renseigné.
export const NO_TIME_TEXT = "aucun temps renseigné";

/// Message d'erreur d'une durée inexploitable (négative, décimale, texte vide
/// pour le passé) : la saisie est REFUSÉE et rien n'est écrit.
export const INVALID_MINUTES_MESSAGE =
  "Temps refusé : entrez un nombre entier de minutes, sans valeur négative.";
export const EMPTY_SPENT_MESSAGE = "Temps passé : entrez le nombre de minutes à ajouter.";

/// Début de la ligne d'information affichée quand la lecture du temps échoue.
export const TIME_ERROR_PREFIX = "Temps indisponible";

/**
 * Lit la charge utile renvoyée par les commandes du temps (tranche 2.2) et la
 * normalise : `{ estimatedMinutes, spentMinutes, estimatedSet, spentSet }`.
 * `null` = NON RENSEIGNÉ, à distinguer de `0` : la présence est portée par
 * `estimated_set` / `spent_set` (jamais par la valeur, car `0` est faux en JS).
 * Une réponse absente ou mal formée vaut « rien de renseigné » — aucune valeur
 * n'est inventée. Pur.
 * @param {{estimated_minutes?: number|null, spent_minutes?: number|null,
 *          estimated_set?: boolean, spent_set?: boolean}|null|undefined} result
 * @returns {{estimatedMinutes: number|null, spentMinutes: number|null,
 *            estimatedSet: boolean, spentSet: boolean}}
 */
export function taskTimeState(result) {
  const r = result || {};
  const estimatedSet = !!r.estimated_set;
  const spentSet = !!r.spent_set;
  const num = (v) => (v == null ? 0 : Number(v) || 0);
  return {
    estimatedMinutes: estimatedSet ? num(r.estimated_minutes) : null,
    spentMinutes: spentSet ? num(r.spent_minutes) : null,
    estimatedSet,
    spentSet,
  };
}

/**
 * Pastille DISCRÈTE des cartes Kanban : « 45 min prévues / 70 min passées ».
 *  - AUCUN des deux temps renseigné → chaîne VIDE (les tâches actuelles gardent
 *    exactement leur apparence : pas de pastille) ;
 *  - les deux renseignés → prévu / passé ;
 *  - prévu seul → le prévu seulement ;
 *  - passé seul → « pas d'estimation · 70 min passées » (jamais un écart
 *    calculé depuis le passé) ;
 *  - un zéro SAISI s'affiche « 0 min », car la présence vient de `*_set`. Pur.
 * @param {object|null|undefined} result charge utile des commandes du temps
 * @returns {string}
 */
export function taskTimePillLabel(result) {
  const st = taskTimeState(result);
  if (!st.estimatedSet && !st.spentSet) return "";
  const est = st.estimatedSet ? `${st.estimatedMinutes} min prévue${st.estimatedMinutes === 1 ? "" : "s"}` : "";
  const spent = st.spentSet ? `${st.spentMinutes} min passée${st.spentMinutes === 1 ? "" : "s"}` : "";
  if (est && spent) return `${est} / ${spent}`;
  if (est) return est;
  return `${NO_ESTIMATE_TEXT} · ${spent}`;
}

/**
 * Texte de synthèse du bloc « Temps » de la fiche : même règle que la pastille,
 * avec une mention explicite quand l'un des deux temps manque — et `NO_TIME_TEXT`
 * quand AUCUN des deux n'est renseigné (la fiche dit alors explicitement que rien
 * n'est saisi, au lieu de rester muette et ambiguë). Pur.
 * @param {object|null|undefined} result charge utile des commandes du temps
 * @returns {string}
 */
export function taskTimeSummaryLabel(result) {
  const st = taskTimeState(result);
  if (!st.estimatedSet && !st.spentSet) return NO_TIME_TEXT;
  const est = st.estimatedSet ? `${st.estimatedMinutes} min prévue${st.estimatedMinutes === 1 ? "" : "s"}` : "";
  const spent = st.spentSet ? `${st.spentMinutes} min passée${st.spentMinutes === 1 ? "" : "s"}` : "";
  if (est && spent) return `${est} / ${spent}`;
  if (est) return `${est} (aucun temps passé)`;
  return `${NO_ESTIMATE_TEXT} · ${spent}`;
}

/**
 * Convertit une saisie de minutes en nombre ENTIER positif. Toute autre valeur
 * (négative, décimale, texte) est REFUSÉE : `{ ok: false, message }` — l'appel
 * n'est alors jamais envoyé au cœur, rien n'est écrit. Pur.
 * @param {unknown} raw
 * @returns {{ok: boolean, minutes: number|null, message: string}}
 */
function parseMinutesValue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!/^\d+$/.test(s)) return { ok: false, minutes: null, message: INVALID_MINUTES_MESSAGE };
  return { ok: true, minutes: Number(s), message: "" };
}

/**
 * Valide la saisie du temps PRÉVU : un champ VIDE remet la valeur à « non
 * renseigné » (`minutes: null`), toute autre saisie doit être un entier positif.
 * Pur.
 * @param {unknown} raw valeur du champ
 * @returns {{ok: boolean, minutes: number|null, message: string}}
 */
export function parseEstimatedMinutesInput(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: true, minutes: null, message: "" };
  return parseMinutesValue(s);
}

/**
 * Valide la saisie du temps PASSÉ à AJOUTER : un champ vide est refusé (on
 * n'ajoute pas un cumul vide), toute autre saisie doit être un entier positif.
 * Pur.
 * @param {unknown} raw valeur du champ
 * @returns {{ok: boolean, minutes: number|null, message: string}}
 */
export function parseSpentMinutesInput(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: false, minutes: null, message: EMPTY_SPENT_MESSAGE };
  return parseMinutesValue(s);
}

/**
 * Ligne d'information affichée si la lecture ou l'écriture du temps échoue (le
 * refus rendu par le cœur est montré tel quel : valeur négative, tâche
 * inconnue…). Ne lève JAMAIS d'exception : la fiche reste utilisable. Pur.
 * @param {unknown} err
 * @returns {string}
 */
export function taskTimeErrorMessage(err) {
  const detail = String((err && err.message) || err || "").trim();
  return detail ? `${TIME_ERROR_PREFIX} : ${detail}` : TIME_ERROR_PREFIX;
}
