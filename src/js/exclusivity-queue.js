// exclusivity-queue.js — File d'attente d'exclusivité des spécialités par projet
// (orchestration multi-agents, T5). Fonctions pures, testables.
//
// L'exclusivité garantit qu'un seul agent de chaque spécialité (agent_id) tourne
// à la fois sur un même projet. En cas de conflit, la demande est mise en file
// d'attente (clé (project, agent_id)) et lancée automatiquement à la fin de la
// tâche en cours. Ce module expose la logique pure (clé, enqueue, dequeue,
// détection de conflit) ; le bus d'agents (agents-bus.js) l'utilise et gère le
// lancement effectif des runs.
//
// MISSION P3 (défaut D3) : l'identité de projet est NORMALISÉE (`project-key.js`,
// source unique). Deux écritures du même dossier (séparateur Windows, barre
// finale, casse, chemin relatif) désignent donc la MÊME file — et la même
// exclusivité — au lieu de deux files jumelles dont l'une devenait invisible.

import { projectKey, sameProject, queueKeyMatchesProject } from "./project-key.js";

/**
 * Clé de file d'attente pour (project, agent_id). Le séparateur U+001F (unit
 * separator) ne peut pas apparaître dans un chemin de projet : il garantit
 * l'absence de collision entre projets. Le projet est normalisé (identité).
 * @param {string} project
 * @param {string} agentId
 * @returns {string}
 */
export function exclusivityKey(project, agentId) {
  return `${projectKey(project)}\u{1f}${agentId}`;
}

/**
 * Clé EXISTANTE de la file qui désigne (projet, agent), quelle que soit
 * l'écriture du chemin de projet (entrée posée avec une autre écriture du même
 * dossier, y compris par une version antérieure). `null` si aucune.
 * @param {object} queue - map clé → array d'assignments
 * @param {string} agentId
 * @param {string} project
 * @returns {string|null}
 */
export function findExclusivityKey(queue, agentId, project) {
  if (!queue || typeof queue !== "object") return null;
  const agent = String(agentId == null ? "" : agentId);
  const canonical = exclusivityKey(project, agent);
  if (Object.prototype.hasOwnProperty.call(queue, canonical)) return canonical;
  for (const key of Object.keys(queue)) {
    const idx = key.indexOf("\u{1f}");
    if (idx < 0) continue;
    if (key.slice(idx + 1) !== agent) continue;
    if (queueKeyMatchesProject(key, project)) return key;
  }
  return null;
}

/**
 * Met une demande en file d'attente (clé (project, agent_id)). Mutate la map.
 * @param {object} queue - map clé → array d'assignments
 * @param {string} agentId
 * @param {string} project
 * @param {object} assignment - { agentId, brief, project }
 */
export function enqueueExclusivity(queue, agentId, project, assignment) {
  const key = findExclusivityKey(queue, agentId, project) || exclusivityKey(project, agentId);
  if (!queue[key]) queue[key] = [];
  queue[key].push(assignment);
}

/**
 * Retire et retourne la demande suivante de la file pour (project, agent_id),
 * ou null si la file est vide. Mutate la map (supprime la clé si vide).
 * @param {object} queue
 * @param {string} agentId
 * @param {string} project
 * @returns {object|null}
 */
export function dequeueExclusivity(queue, agentId, project) {
  const key = findExclusivityKey(queue, agentId, project) || exclusivityKey(project, agentId);
  const arr = queue[key];
  if (!arr || arr.length === 0) return null;
  const next = arr.shift();
  if (arr.length === 0) delete queue[key];
  return next;
}

/**
 * Indique si un agent est déjà actif sur un projet, d'après une liste de
 * sessions (mode agent_process, en train d'exécuter une tâche, même projet).
 * Fonction pure.
 * Deux agents de spécialités DIFFÉRENTES sur le même projet ne sont pas en
 * conflit (seule la même spécialité est exclusive).
 *
 * Un agent est « actif » (exclusif) s'il est `busy` (agent_start → true,
 * agent_settled → false) ET vivant ET non busy-stale. Une session busy-stale
 * (busy retenu par un process pi figé, dernière activité plus ancienne que la
 * fenêtre) n'est PAS exclusive : la demande doit pouvoir démarrer immédiatement
 * au lieu de rester en file derrière un fantôme. Une session vivante mais
 * INACTIVE (settled, run précédente terminée) n'est pas non plus exclusive :
 * elle doit pouvoir être réutilisée/redémarrée pour une nouvelle run (bug :
 * run_agents sur un agent déjà ouvert mais inactif ne démarrait pas).
 * @param {Array<{agent:string, alive:boolean, busy:boolean, mode:string, project:string}>} sessions
 * @param {string} agentId
 * @param {string} project
 * @param {number} [now]
 * @param {number} [staleWindowMs] - fenêtre busy-stale (défaut 25 min)
 * @returns {boolean}
 */
export function isAgentActiveOnProject(sessions, agentId, project, now = Date.now(), staleWindowMs = STALE_BUSY_WINDOW_MS) {
  return (sessions || []).some(
    (s) =>
      s.agent === agentId &&
      s.busy &&
      s.alive &&
      s.mode === "agent_process" &&
      sameProject(s.project, project) &&
      !isBusyStale(s, now, staleWindowMs)
  );
}

// Chantier 6/6 (verrou fantôme) : fenêtre de grâce courte. Une session dont la
// dernière activité date de MOINS de cette durée est considérée réellement en
// activité même si busy n'est pas (encore) à true — couvre un tour qui vient de
// démarrer (agent_start pas encore propagé) et les fins de tour en vol. Au-delà,
// une session vivante mais sans travail n'est plus « une run en cours » : elle
// ne doit JAMAIS maintenir un verrou de run (faux « Une run est déjà en cours »).
export const RECENT_ACTIVITY_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

// Chantier « verrou de run fantôme » : fenêtre busy-stale. Un processus pi
// FIGÉ (vivant, ni settled ni exit) laisse `busy` à true alors qu'aucun travail
// n'avance : agent_start pose busy=true et seule agent_settled/agent_end/
// process_exit/process_error l'efface. Si la dernière activité est plus ancienne
// que cette durée, la session est considérée « busy-stale » : elle ne doit plus
// être un travail en cours (ni maintenir un verrou de run, ni bloquer
// l'exclusivité de spécialité, ni être comptée comme agent actif). Alignée sur
// le seuil d'arrêt auto / de grâce busy-stale Rust (STALE_BUSY_GRACE, défaut
// 25 min).
export const STALE_BUSY_WINDOW_MS = 25 * 60 * 1000; // 25 minutes

/**
 * Pure (testable) : indique si un agent `busy` est « busy-stale » — son `busy`
 * est vrai mais sa dernière activité est trop ancienne (au-delà de la fenêtre
 * busy-stale). Cause racine du verrou fantôme : un process pi figé (vivant, ni
 * settled ni exit) laisse busy=true alors qu'aucun travail n'avance.
 * Fail-open sûr : sans `lastActivity` exploitable, on ne peut pas PROUVER la
 * staleness → retourne false (pas stale) pour ne pas libérer un verrou d'une
 * run réellement active (risque de double run).
 * @param {{alive?:boolean, busy?:boolean, lastActivity?:string}|null} session
 * @param {number} [now] - timestamp de référence (ms)
 * @param {number} [staleWindowMs] - fenêtre busy-stale (défaut 25 min)
 * @returns {boolean}
 */
export function isBusyStale(session, now = Date.now(), staleWindowMs = STALE_BUSY_WINDOW_MS) {
  if (!session || session.alive !== true || session.busy !== true) return false;
  if (!session.lastActivity) return false;
  const ts = Date.parse(session.lastActivity);
  if (!Number.isFinite(ts)) return false;
  return now - ts > staleWindowMs;
}

/**
 * Pure (testable) : instant de démarrage CONNU d'une session (epoch ms).
 *
 * Le bus d'agents horodate lui-même le spawn de la session qu'il crée
 * (`sessionStartedAtByAgent`, agents-bus.js) : c'est le SEUL repère qui distingue
 * une session NEUVE d'une session ancienne restée muette. Accepte un nombre
 * (epoch ms) ou une chaîne ISO. Retourne 0 si le repère est absent ou illisible :
 * aucune protection n'est inventée pour une session inconnue.
 * @param {{sessionStartedAt?:number|string}|null} session
 * @returns {number} epoch ms, ou 0
 */
export function sessionStartAt(session) {
  if (!session) return 0;
  const raw = session.sessionStartedAt;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw === "string" && raw.trim()) {
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : 0;
  }
  return 0;
}

/**
 * Pure (testable) : la session a-t-elle démarré il y a MOINS que la fenêtre de
 * grâce ?
 *
 * Correctif « chien de garde / session neuve » (2026-10-28) : une session qui
 * vient d'être créée n'a encore émis AUCUN signal — ni `busy`, ni
 * `lastActivity`, ni `toolInProgress` — et était donc jugée « ne travaille pas »
 * 24 s après son démarrage : la porte `ghosts` libérait la run et tuait la
 * mission (journal `.pilot/agent-stops.log` 2026-10-28 14:22:53 → 14:23:17).
 *
 * Sans repère de démarrage connu (session d'une autre fenêtre Pilot, session
 * externe, sonde qui ne porte pas l'horodatage) → false : le comportement
 * historique est conservé à l'identique.
 * @param {{sessionStartedAt?:number|string}|null} session
 * @param {number} [now] - timestamp de référence (ms)
 * @param {number} [windowMs] - fenêtre de grâce (défaut 2 min)
 * @returns {boolean}
 */
export function isSessionRecentlyStarted(session, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS) {
  const startedAt = sessionStartAt(session);
  if (!startedAt) return false;
  return now - startedAt < windowMs;
}

/**
 * Pure (testable) : indique si UNE session d'agent représente un travail
 * RÉELLEMENT en cours. Un agent travaille réellement si :
 *  - busy === true (agent_start reçu, aucun agent_settled depuis) ET non
 *    busy-stale (une session busy VIEILLE de plus de `staleWindowMs` sans
 *    activité récente n'est plus un travail : process pi figé), OU
 *  - toolInProgress === true : un OUTIL est en cours d'exécution. Un build, des
 *    tests ou une installation longue sont SILENCIEUX (aucun événement pendant
 *    plusieurs minutes) et `busy` peut être faux (fin de tour pi, relance en
 *    attente) : sans ce signal, la sonde concluait « plus aucun agent ne
 *    travaille » et libérait la run en ÉCHEC au milieu du travail (mission 310).
 *    SANS plafond de durée (correction 1 bis) : un outil en cours est un travail
 *    qui avance, quel que soit son temps d'exécution — un build, une campagne de
 *    tests ou une installation peuvent légitimement durer des heures sans émettre
 *    le moindre événement. Le borner par la fenêtre busy-stale faisait conclure à
 *    tort qu'une session ne travaillait plus au-delà de 25 min (symptôme « outil
 *    long = agent cru figé », même famille que `should_release_stale_busy` côté
 *    Rust). Seule la MORT de la session (`alive !== true`) lève ce verrou ; le
 *    filet « processus mort » (`has_dead_agent_process`) reste le juge des cas
 *    réellement figés, OU
 *  - la session a DÉMARRÉ il y a moins de `windowMs` (session NEUVE, cf.
 *    `isSessionRecentlyStarted` : aucune preuve n'existe encore, et l'absence de
 *    preuve sur une session de quelques secondes n'est pas un fantôme), OU
 *  - sa dernière activité (lastActivity ISO) date de moins de `windowMs`.
 * Une session « vivante mais inactive » (parkée après agent_settled, oubliée)
 * ne compte PAS : un processus vivant ≠ travail en cours.
 * Fail-open anti-verrou : en cas de donnée manquante ou illisible (session
 * absente/morte, busy absent ET lastActivity absente/non parsable), retourne
 * false — jamais de verrou sur incertitude (le bug historique était un FAUX
 * verrou ; il ne faut pas créer l'inverse, un verrou oublié). Pour busy-stale,
 * le fail-open est inversé : busy SANS lastActivity exploitable → true (on ne
 * peut pas prouver la staleness, donc pas de faux verrou libéré).
 * @param {{alive?:boolean, busy?:boolean, toolInProgress?:boolean, lastActivity?:string, sessionStartedAt?:number|string}|null} session
 * @param {number} [now] - timestamp de référence (ms)
 * @param {number} [windowMs] - fenêtre de grâce (défaut 2 min)
 * @param {number} [staleWindowMs] - fenêtre busy-stale (défaut 25 min)
 * @returns {boolean}
 */
export function isSessionWorking(session, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS, staleWindowMs = STALE_BUSY_WINDOW_MS) {
  if (!session || session.alive !== true) return false;
  // CORRECTION 1 bis : un OUTIL EN COURS est un travail qui avance, SANS plafond
  // de durée (cf. docstring). Le borner par la fenêtre busy-stale — comme le fait
  // le `busy` ci-dessous — traitait un build silencieux de 26 min comme une
  // session au repos : verrou de run libéré et tour mis en échec au milieu du
  // travail. La mort de la session reste éliminatoire (garde `alive` ci-dessus).
  if (session.toolInProgress === true) return true;
  // CORRECTION « session neuve » (2026-10-28) : une session RÉCEMMENT DÉMARRÉE
  // est en cours de travail, même sans aucun signal. Pendant ses premières
  // secondes elle n'a rien émis (agent_start pas encore propagé, aucune
  // lastActivity) : elle tombait dans le `return false` final et le chien de
  // garde coupait la mission 24 s après son démarrage. Le repère vient du bus,
  // seul à savoir qu'il vient de créer la session.
  if (isSessionRecentlyStarted(session, now, windowMs)) return true;
  if (session.busy === true) {
    // busy-stale : un busy VIEUX de plus de la fenêtre n'est plus un travail.
    // Fail-open : sans lastActivity exploitable, on ne peut pas prouver la
    // staleness → on retombe sur l'historique (busy === vrai travail).
    if (isBusyStale({ ...session, busy: true }, now, staleWindowMs)) return false;
    return true;
  }
  if (!session.lastActivity) return false;
  const ts = Date.parse(session.lastActivity);
  if (!Number.isFinite(ts)) return false;
  return now - ts < windowMs;
}

/**
 * Pure (testable) : indique si au moins UN des agents donnés a une session
 * VRAIMENT en activité (voir isSessionWorking). Priorité à la session
 * (agent, projet mappé) ; sinon n'importe quelle session vivante de cet agent
 * (même politique de matching que la sonde historique). Sans donnée exploitable
 * → false (fail-open) : aucun agent prouvé en activité = aucun verrou.
 * @param {Array<object>} sessions - liste des sessions (list_agent_sessions)
 * @param {Iterable<string>} agentIds - agents participants à la run
 * @param {(agentId: string) => string|null} [getAgentProject] - projet mappé
 *   d'un agent (agentProject du contexte de run) ; null si inconnu
 * @param {number} [now]
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function isAnyAgentWorking(sessions, agentIds, getAgentProject, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS) {
  const alive = (sessions || []).filter((s) => s && s.alive === true);
  for (const agentId of agentIds || []) {
    const proj = getAgentProject ? getAgentProject(agentId) : null;
    // Priorité (agent, projet) : si une session dédiée existe, c'est elle qui
    // tranche seule. Sinon (projet inconnu ou sans session dédiée), on regarde
    // n'importe quelle session vivante de l'agent (prudence, pratique historique).
    const byProject = proj ? alive.find((s) => s.agent === agentId && sameProject(s.project, proj)) : null;
    const candidates = byProject ? [byProject] : alive.filter((s) => s.agent === agentId);
    if (candidates.some((s) => isSessionWorking(s, now, windowMs))) return true;
  }
  return false;
}

/**
 * Pure : décision de la garde d'exclusivité pour la session d'un agent mappé
 * localement (résultat de la sonde côté agents-bus.js).
 *
 * Point clé : un processus simplement VIVANT mais au repos (session settled /
 * ancienne, busy périmé) ne constitue PAS un travail en cours. L'exiger évite
 * les verrous périmés qui bloquent indéfiniment un projet.
 *
 * Retourne :
 *  - `"working"` : la session travaille RÉELLEMENT (busy non périmé, ou
 *    activité récente) → le créneau est occupé, la mise en file est légitime ;
 *  - `"stale"`   : session vivante mais au repos → verrou périmé à libérer ;
 *  - `"ghost"`   : session morte/absente → tour fantôme à purger ;
 *  - `"unknown"` : sonde indisponible (`undefined`) → prudence, on ne libère pas
 *    (jamais de double run sur incertitude).
 * @param {object|null|undefined} session
 * @param {number} [now]
 * @returns {"working"|"stale"|"ghost"|"unknown"}
 */
export function classifyExclusivitySession(session, now = Date.now()) {
  if (session === undefined) return "unknown";
  if (!session) return "ghost";
  return isSessionWorking(session, now) ? "working" : "stale";
}

/**
 * Pure : au moins une session du projet donné travaille réellement
 * (`isSessionWorking`) ? Utilisé pour la garde de fin de run : un process
 * simplement vivant mais au repos ne doit pas être considéré comme une run
 * encore active (sinon le verrou de run ne se libère jamais).
 * @param {Array} sessions - sortie `list_agent_sessions`
 * @param {string} project
 * @param {number} [now]
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function isProjectWorking(sessions, project, now = Date.now(), windowMs = RECENT_ACTIVITY_WINDOW_MS) {
  return (sessions || []).some((s) => s && sameProject(s.project, project) && isSessionWorking(s, now, windowMs));
}

