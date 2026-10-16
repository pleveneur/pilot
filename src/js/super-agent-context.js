// super-agent-context.js — Bloc de contexte court joint automatiquement a la
// demande deleguee par l'assistant a un agent.
//
// Probleme vise : l'assistant envoyait la demande SEULE. L'agent ne savait donc
// pas ce qui avait deja ete fait, decide ou regle sur le projet, et pouvait
// refaire ou contredire l'existant (allers-retours inutiles).
//
// Module PUR / testable : il transforme les donnees de SUIVI de l'assistant
// (base de suivi `get_super_agent_tracking` : projets, taches, decisions,
// sessions ; memoire de session `super_agent_load_session_memory` : sujet en
// cours, chantiers en cours) en un bloc BREF et BORNE. Il ne renvoie RIEN
// quand l'assistant ne sait rien (aucune invention). super-agent.js le prefixe
// a la demande sur les deux familles de delegation (`run_agents` = agents d'un
// projet, `run_assistant_agents` = agents hors projet) et sur la delegation
// directe (`delegate_to_coder`). Le bloc est donc VISIBLE dans la conversation
// de l'agent, separe de la demande elle-meme (elle suit le bloc).

/** Plafond du bloc de contexte joint a une demande deleguee (caracteres). */
export const MAX_DELEGATION_CONTEXT_CHARS = 700;

/** Titre du bloc : il rend le contexte reperable dans la conversation de l'agent. */
export const DELEGATION_CONTEXT_TITLE = "## Contexte de suivi (assistant)";

/** Avis de troncature, compte dans le plafond (le plafond n'est jamais depasse). */
export const DELEGATION_CONTEXT_TRUNCATION_NOTICE =
  "\n- [...contexte de suivi tronque : la demande complete suit.]";

/** Longueur maximale d'une valeur textuelle d'une ligne du bloc. */
const MAX_VALUE_CHARS = 160;

/**
 * Normalise un chemin de projet pour comparer deux ecritures du meme chemin
 * (separateurs Windows/Unix, casse, barre oblique finale) : le chemin stocke
 * dans la base de suivi et celui fourni par la delegation peuvent differer.
 * @param {string} path
 * @returns {string}
 */
export function normalizeProjectPath(path) {
  return String(path == null ? "" : path)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Retrouve le projet SUIVI correspondant a un chemin de projet. Retourne
 * `{ client, project }` (le client porte les decisions et sessions recentes)
 * ou `null` si le projet n'est pas suivi. Fail-open : une structure de suivi
 * inattendue ne fait pas planter l'appel.
 * @param {object|null} tracking - resultat de `get_super_agent_tracking`.
 * @param {string|null} projectPath
 * @returns {{client: object, project: object}|null}
 */
export function findTrackedProject(tracking, projectPath) {
  const key = normalizeProjectPath(projectPath);
  if (!key) return null;
  const clients = tracking && Array.isArray(tracking.clients) ? tracking.clients : [];
  for (const client of clients) {
    if (!client) continue;
    const projects = Array.isArray(client.projects) ? client.projects : [];
    for (const project of projects) {
      if (project && normalizeProjectPath(project.path) === key) {
        return { client, project };
      }
    }
  }
  return null;
}

/**
 * Parse la memoire de session de l'assistant (objet JSON ou chaine JSON).
 * Retourne un objet normalise, ou `null` si elle est inexploitable (fail-open :
 * jamais de crash, jamais de contexte invente).
 * @param {string|object|null} resume
 * @returns {{current_topic: string, active_project: string, work_in_progress: string[], notes: string}|null}
 */
export function parseSessionMemory(resume) {
  if (resume == null || resume === "") return null;
  let raw = resume;
  if (typeof resume === "string") {
    try {
      raw = JSON.parse(resume);
    } catch (_) {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const wip = Array.isArray(raw.work_in_progress)
    ? raw.work_in_progress.map((x) => String(x == null ? "" : x).trim()).filter(Boolean)
    : [];
  return {
    current_topic: raw.current_topic ? String(raw.current_topic) : "",
    active_project: raw.active_project ? String(raw.active_project) : "",
    work_in_progress: wip,
    notes: raw.notes ? String(raw.notes) : "",
  };
}

/**
 * Applique le plafond au bloc de contexte, en annoncant honnetement la
 * troncature (coupe sur une fin de ligne quand c'est possible). Le resultat ne
 * depasse JAMAIS le plafond.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
export function boundDelegationContext(text, maxChars = MAX_DELEGATION_CONTEXT_CHARS) {
  const t = String(text == null ? "" : text);
  const max = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : MAX_DELEGATION_CONTEXT_CHARS;
  if (t.length <= max) return t;
  const notice = DELEGATION_CONTEXT_TRUNCATION_NOTICE;
  if (max <= notice.length) return t.slice(0, max);
  const budget = max - notice.length;
  let cut = t.slice(0, budget);
  const lastNewline = cut.lastIndexOf("\n");
  if (lastNewline > 0) cut = cut.slice(0, lastNewline);
  return cut.replace(/[ \t]+$/, "") + notice;
}

/**
 * Prefixe le bloc de contexte au brief envoye a l'agent. No-op (brief inchange)
 * quand le bloc est vide : l'absence de suivi ne doit rien ajouter.
 * @param {string} brief
 * @param {string} context
 * @returns {string}
 */
export function prefixDelegationContext(brief, context) {
  const b = String(brief == null ? "" : brief);
  const c = String(context == null ? "" : context).trim();
  if (!c) return b;
  if (!b) return c;
  return `${c}\n\n${b}`;
}

/** Tronque une valeur textuelle d'une ligne (une ligne = une information breve). */
function clampValue(text, max = MAX_VALUE_CHARS) {
  const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

/** Joint quelques elements d'une liste, bornes et separes par « ; ». */
function joinList(items, maxItems = 2) {
  const list = Array.isArray(items) ? items : [];
  return list
    .slice(0, maxItems)
    .map((x) => clampValue(x))
    .filter(Boolean)
    .join(" ; ");
}

/** Nom de dossier terminal d'un chemin (nom de projet de repli, jamais invente). */
function projectNameFromPath(path) {
  const p = String(path == null ? "" : path).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!p) return "";
  const parts = p.split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Construit le bloc de contexte court joint a une demande deleguee : projet
 * concerne, ce que l'assistant sait deja (taches suivies, decisions et
 * sessions recentes, sujet et chantiers en cours) et objectif de la demande.
 * Retourne une chaine VIDE quand l'assistant ne sait rien (aucune invention) :
 * la demande part alors inchangee.
 * @param {object} [input]
 * @param {object|null} [input.tracking] - resultat de `get_super_agent_tracking`.
 * @param {string|object|null} [input.sessionMemory] - memoire de session.
 * @param {string|null} [input.projectPath] - projet cible (null = hors projet).
 * @param {string} [input.task] - demande deleguee (pour la ligne « Objectif »).
 * @param {number} [input.maxChars] - plafond du bloc.
 * @returns {string}
 */
export function buildDelegationContext({
  tracking = null,
  sessionMemory = null,
  projectPath = null,
  task = "",
  maxChars = MAX_DELEGATION_CONTEXT_CHARS,
} = {}) {
  const tracked = findTrackedProject(tracking, projectPath);
  const memory = parseSessionMemory(sessionMemory);

  const trackedName = tracked && tracked.project ? String(tracked.project.name || "").trim() : "";

  // Taches du projet suivies (compteurs de la base de suivi).
  const openTasks = tracked ? Number(tracked.project.tasks_en_cours) || 0 : 0;
  const doneTasks = tracked ? Number(tracked.project.tasks_terminees) || 0 : 0;
  const tasksLine = openTasks + doneTasks > 0
    ? `- Taches suivies : ${openTasks} en cours, ${doneTasks} terminees`
    : "";

  // Decisions recentes. La base de suivi les expose par CLIENT : on le dit
  // explicitement quand le client suit plusieurs projets, pour ne pas faire
  // passer une decision d'un autre projet pour une decision de celui-ci.
  const clientProjects = tracked && Array.isArray(tracked.client.projects) ? tracked.client.projects : [];
  const clientName = tracked ? String(tracked.client.name || "").trim() : "";
  const decisions = tracked && Array.isArray(tracked.client.decisions_recentes) ? tracked.client.decisions_recentes : [];
  const decisionsLabel = clientProjects.length > 1 && clientName
    ? `- Decisions recentes (client ${clampValue(clientName, 40)})`
    : "- Decisions recentes";
  const decisionsLine = decisions.length ? `${decisionsLabel} : ${joinList(decisions, 2)}` : "";

  // Sessions recentes : elles sont prefixees du nom du projet, on ne garde donc
  // que celles DU projet cible (points deja regles).
  const allSessions = tracked && Array.isArray(tracked.client.sessions_recentes) ? tracked.client.sessions_recentes : [];
  const projectSessions = trackedName
    ? allSessions
        .filter((s) => String(s == null ? "" : s).startsWith(`${trackedName}: `))
        .map((s) => String(s).slice(trackedName.length + 2))
    : allSessions;
  const sessionsLine = projectSessions.length ? `- Deja traite (sessions) : ${joinList(projectSessions, 1)}` : "";

  // Memoire de session de l'assistant : sujet en cours, chantiers, notes.
  const memoryLines = [];
  if (memory) {
    if (memory.current_topic) memoryLines.push(`- Sujet en cours : ${clampValue(memory.current_topic)}`);
    if (memory.work_in_progress.length) {
      memoryLines.push(`- Chantiers en cours : ${joinList(memory.work_in_progress, 3)}`);
    }
    if (memory.notes) memoryLines.push(`- Notes de suivi : ${clampValue(memory.notes)}`);
  }

  const knowledgeLines = [tasksLine, decisionsLine, sessionsLine, ...memoryLines].filter(Boolean);
  // Rien de su sur ce projet ni dans la memoire : on n'ajoute RIEN.
  if (knowledgeLines.length === 0) return "";

  const lines = [];
  const projectLabel = trackedName || projectNameFromPath(projectPath);
  if (projectLabel) lines.push(`- Projet : ${clampValue(projectLabel)}`);
  lines.push(...knowledgeLines);
  const objective = clampValue(task, 300);
  if (objective) lines.push(`- Objectif de la demande : ${objective}`);

  return boundDelegationContext(`${DELEGATION_CONTEXT_TITLE}\n${lines.join("\n")}`, maxChars);
}
