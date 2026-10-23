// project-task-queue.js — File d'attente des tâches d'un PROJET (mission 385).
//
// Principe : sur un projet, UNE seule tâche tourne à la fois ; les autres
// ATTENDENT leur tour, avec leur rang, et démarrent automatiquement quand la
// place se libère. Rien ne doit jamais être perdu en silence : une demande mise
// en file reste en file (ou est abandonnée avec un décompte annoncé).
//
// Ce module a deux responsabilités, volontairement séparées :
//
//  1. PUR (testable sans Tauri, aucun import) : rangs et libellés simples en
//     français (« en cours », « en attente (2e) »), vue unifiée de la file d'un
//     projet et textes affichés (bloc discret de l'onglet agent, commande
//     `/file`).
//
//  2. ÉTAT de la file des COMMANDES MANUELLES du chat d'agent. C'est la seule
//     famille de demandes qui n'avait AUCUNE file : une commande tapée pendant
//     qu'une tâche tournait était refusée et la place était perdue. Elle est
//     désormais mise en file et démarrée automatiquement à la libération du
//     projet, par sonde périodique (aucune modification du lancement d'agent :
//     la relance réutilise le chemin d'envoi EXISTANT, à l'identique).
//
// Les autres familles (missions de l'assistant, délégations, agents en file
// d'exclusivité) gardent leurs files existantes : elles sont seulement LUES ici
// pour composer LA file visible de l'utilisateur (aucune migration de file).

// ── Réglages de la file des commandes manuelles ─────────────────────────────
/** Délai de confirmation du démarrage : au-delà, si le projet est toujours
 * libre, on considère que la commande n'a pas démarré (remise en file). */
export const QUEUE_CONFIRM_MS = 10 * 1000;
/** Cadence de la sonde de rejeu (démarrage automatique à la libération). */
export const QUEUE_TICK_MS = 5 * 1000;
/** Nombre de tentatives de démarrage avant abandon annoncé (jamais silencieux). */
export const QUEUE_MAX_ATTEMPTS = 3;
/** Plafond de la file d'un projet (garde-fou anti-emballement). */
export const QUEUE_MAX_LENGTH = 50;

// ── 1. PUR : rangs, vues et textes ──────────────────────────────────────────

/**
 * Rang lisible en français (1 → « 1er », 2 → « 2e », 11 → « 11e »).
 * @param {number} index - rang à partir de 1
 * @returns {string}
 */
export function rankLabel(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 1) return "";
  return n === 1 ? "1er" : `${Math.floor(n)}e`;
}

/**
 * Libellé court d'une demande (une ligne, bornée, jamais vide).
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function shortLabel(text, max = 70) {
  const clean = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!clean) return "(sans intitulé)";
  const limit = Number.isFinite(max) && max > 10 ? Math.floor(max) : 70;
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

/** Nom français d'une famille de demandes. */
const FAMILY_NOUNS = {
  commande: "commande",
  mission: "mission",
  delegation: "délégation",
  agent: "agent",
};

function familyNoun(kind) {
  return FAMILY_NOUNS[kind] || "tâche";
}

function normalizeEntries(entries, kind) {
  const out = [];
  for (const entry of entries || []) {
    if (!entry) continue;
    const label = typeof entry === "string" ? entry : entry.label;
    out.push({ kind, label: shortLabel(label) });
  }
  return out;
}

/**
 * Compose la vue ORDONNÉE de la file d'un projet : ce qui est en cours, puis ce
 * qui attend avec son rang (le rang 1 étant la tâche en cours, la première
 * demande en attente est donc la 2e).
 *
 * Ordre d'attente (déterministe, identique à l'ordre de démarrage observé) :
 * commandes manuelles (FIFO) → missions de l'assistant (FIFO) → délégations
 * (FIFO) → agents en file d'exclusivité (FIFO).
 * @param {{project?:string, running?:Array, manual?:Array, missions?:Array,
 *          delegations?:Array, agents?:Array}} input
 * @returns {{project:string, running:Array<{kind:string,label:string}>,
 *            waiting:Array<{rank:number,kind:string,label:string}>,
 *            waitingCount:number, isEmpty:boolean}}
 */
export function buildProjectQueueView(input = {}) {
  const running = [];
  for (const entry of input.running || []) {
    if (!entry) continue;
    const kind = (entry && entry.kind) || "agent";
    const label = typeof entry === "string" ? entry : entry.label;
    running.push({ kind, label: shortLabel(label) });
  }
  const waiting = [];
  const families = [
    normalizeEntries(input.manual, "commande"),
    normalizeEntries(input.missions, "mission"),
    normalizeEntries(input.delegations, "delegation"),
    normalizeEntries(input.agents, "agent"),
  ];
  let rank = 1 + running.length;
  for (const family of families) {
    for (const entry of family) {
      waiting.push({ rank, kind: entry.kind, label: entry.label });
      rank += 1;
    }
  }
  return {
    project: input.project || ".",
    running,
    waiting,
    waitingCount: waiting.length,
    isEmpty: running.length === 0 && waiting.length === 0,
  };
}

/** Ligne « en cours » / « en attente (Ne) » d'une entrée de la file. */
function entryLine(entry, running) {
  const noun = familyNoun(entry.kind);
  const head = running ? "en cours" : `en attente (${rankLabel(entry.rank)})`;
  return `- ${head} : ${noun} « ${entry.label} »`;
}

/**
 * Texte de la commande `/file` : la file complète du projet, en clair.
 * @param {object} view - sortie de buildProjectQueueView
 * @returns {string}
 */
export function formatQueueReport(view = {}) {
  const v = view || {};
  const running = v.running || [];
  const waiting = v.waiting || [];
  if (!running.length && !waiting.length) {
    return "🧾 File d'attente du projet : vide — aucune tâche en cours, aucune tâche en attente.";
  }
  const lines = ["🧾 File d'attente du projet"];
  for (const entry of running) lines.push(entryLine(entry, true));
  if (!running.length) lines.push("- en cours : aucune tâche (la place est libre)");
  for (const entry of waiting) lines.push(entryLine(entry, false));
  if (!waiting.length) lines.push("- en attente : aucune demande");
  lines.push(
    "Une seule tâche tourne à la fois sur le projet : la première demande en attente démarre automatiquement à la libération. `/file vide` abandonne les demandes en attente (le nombre abandonné est annoncé). `/file retire <rang>` retire UNE seule mission de l'Assistant, celle de ce rang : les autres restent, dans leur ordre.",
  );
  return lines.join("\n");
}

/** Titre court du bloc discret affiché dans l'onglet de l'agent. */
export function queueBlockTitle(view = {}) {
  const running = (view.running || []).length;
  const waiting = (view.waiting || []).length;
  return `🧾 File d'attente — ${running} en cours · ${waiting} en attente`;
}

/**
 * Lignes du bloc discret de l'onglet agent (borné : jamais un mur de texte).
 * @param {object} view
 * @param {number} [maxWaiting] - nombre de demandes affichées (défaut 4)
 * @returns {Array<string>}
 */
export function formatQueueLines(view = {}, maxWaiting = 4) {
  const v = view || {};
  const running = v.running || [];
  const waiting = v.waiting || [];
  const showMax = Number.isFinite(maxWaiting) && maxWaiting > 0 ? Math.floor(maxWaiting) : 4;
  const lines = [queueBlockTitle(v)];
  for (const entry of running.slice(0, 2)) lines.push(entryLine(entry, true));
  if (!running.length) lines.push("- en cours : aucune tâche");
  for (const entry of waiting.slice(0, showMax)) lines.push(entryLine(entry, false));
  if (waiting.length > showMax) {
    lines.push(`- … et ${waiting.length - showMax} autre(s) demande(s) en attente`);
  }
  lines.push("`/file` : voir la file · `/file vide` : abandonner les demandes en attente · `/file retire <rang>` : retirer UNE seule mission");
  return lines;
}

/** Message d'abandon (commande `/file vide`) — le décompte est toujours annoncé. */
export function formatQueueClearedMessage(counts = {}) {
  const detail = [];
  const total = ["commands", "missions", "delegations", "agents"].reduce((n, k) => {
    const v = Number(counts[k]) || 0;
    if (v > 0) detail.push(`${v} ${k === "commands" ? "commande(s)" : k === "missions" ? "mission(s)" : k === "delegations" ? "délégation(s)" : "demande(s) d'agent"}`);
    return n + v;
  }, 0);
  if (total === 0) return "🧾 Aucune demande en attente : rien à abandonner (la tâche en cours, s'il y en a une, continue).";
  return `🗑️ File d'attente vidée : ${total} demande(s) abandonnée(s) — ${detail.join(", ")}. Rien ne démarre à leur place ; renvoyez-les si nécessaire. La tâche en cours, s'il y en a une, continue.`;
}

/** Notification de mise en file (affichée dans le chat). */
export function formatQueuedNotice(rank) {
  return `⏳ Votre demande est en file d'attente du projet (${rankLabel(rank)}). Elle démarrera automatiquement dès que le projet sera libre. \`/file\` pour voir la file, \`/file vide\` pour l'abandonner.`;
}

// ── 2. ÉTAT : file des commandes manuelles du projet ────────────────────────

const state = {
  queues: new Map(), // projet → [entry]
  launched: new Map(), // projet → { entry, launchedAt }
  probe: null, // async (projet) => true si la place du projet est LIBRE
  notify: null, // (message, projet) => void
  onChange: null, // () => void (rafraîchit l'affichage)
  timer: null,
  seq: 0,
};

/**
 * Installe la sonde d'admission (la seule dépendance externe : le module reste
 * sans import Tauri). Renvoyer `true` = la place du projet est libre.
 * @param {((project:string) => Promise<boolean>)|null} fn
 */
export function setProjectQueueProbe(fn) {
  state.probe = typeof fn === "function" ? fn : null;
}

/** Installe le canal de notification (messages utilisateur). */
export function setProjectQueueNotify(fn) {
  state.notify = typeof fn === "function" ? fn : null;
}

/** Installe le rappel de rafraîchissement de l'affichage. */
export function setProjectQueueOnChange(fn) {
  state.onChange = typeof fn === "function" ? fn : null;
}

function emitChange() {
  try {
    state.onChange && state.onChange();
  } catch (_) {
    /* l'affichage ne doit jamais casser la file */
  }
  // Les onglets d'agents ouverts rafraîchissent leur bloc de file sur cet
  // événement (plusieurs onglets peuvent montrer la même file du projet).
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("pilot-queue-changed"));
    }
  } catch (_) {
    /* environnement sans window (tests Node) */
  }
}

function notify(message, project) {
  try {
    state.notify && state.notify(message, project);
  } catch (_) {
    /* idem */
  }
}

function queueOf(project) {
  let q = state.queues.get(project);
  if (!q) {
    q = [];
    state.queues.set(project, q);
  }
  return q;
}

/**
 * Met une COMMANDE MANUELLE en file d'attente pour un projet.
 *
 * La demande n'est pas perdue : elle démarre automatiquement à la libération du
 * projet (`launch` est appelé par la sonde de rejeu). Une demande identique
 * (même texte, même agent) déjà en file n'est jamais dupliquée.
 * @param {{project:string, text:string, agentId?:string, label?:string,
 *          launch:function(): (Promise<boolean>|boolean)}} demand
 * @returns {{entry:object|null, rank:number, duplicate:boolean}}
 */
export function enqueueProjectCommand(demand = {}) {
  const project = demand.project || ".";
  const text = String(demand.text == null ? "" : demand.text);
  if (!text.trim()) return { entry: null, rank: 0, duplicate: false };
  const agentId = demand.agentId || "default";
  const queue = queueOf(project);
  const existing = queue.findIndex((e) => e.text === text && e.agentId === agentId);
  if (existing >= 0) {
    return { entry: queue[existing], rank: existing + 1 + (state.launched.has(project) ? 1 : 0), duplicate: true };
  }
  if (queue.length >= QUEUE_MAX_LENGTH) {
    return { entry: null, rank: 0, duplicate: false, full: true };
  }
  const entry = {
    id: ++state.seq,
    project,
    text,
    agentId,
    label: shortLabel(demand.label != null ? demand.label : text),
    launch: typeof demand.launch === "function" ? demand.launch : null,
    queuedAt: Date.now(),
    attempts: 0,
  };
  queue.push(entry);
  const rank = queue.length + (state.launched.has(project) ? 1 : 0);
  emitChange();
  return { entry, rank, duplicate: false };
}

/**
 * Demandes manuelles EN ATTENTE d'un projet, dans l'ordre (lecture seule).
 * @param {string} project
 * @returns {Array<{label:string}>}
 */
export function listProjectCommands(project) {
  return (state.queues.get(project || ".") || []).map((e) => ({ id: e.id, label: e.label, agentId: e.agentId }));
}

/** Commandes manuelles DÉJÀ LANCÉES (démarrage en attente de confirmation). */
export function listProjectLaunchedCommands(project) {
  const launched = state.launched.get(project || ".");
  return launched ? [{ label: launched.entry.label }] : [];
}

/**
 * Abandonne les commandes manuelles en attente d'un projet. Le nombre abandonné
 * est retourné (l'appelant l'annonce : rien ne disparaît en silence).
 * @param {string} project
 * @returns {number}
 */
export function abandonProjectCommands(project) {
  const key = project || ".";
  const queue = state.queues.get(key) || [];
  const removed = queue.length;
  if (removed > 0) {
    queue.length = 0;
    emitChange();
  }
  return removed;
}

async function probeFree(project) {
  if (!state.probe) return null; // sonde absente : on ne lance pas (prudence)
  try {
    return (await state.probe(project)) === true;
  } catch (_) {
    return null; // sonde en échec : on ne lance pas, la demande reste en file
  }
}

function requeueAtHead(project, entry) {
  const queue = queueOf(project);
  if (!queue.includes(entry)) queue.unshift(entry);
}

/**
 * UNE passe de la file d'un projet : confirme (ou non) le démarrage en cours,
 * puis lance la tête de file si — et seulement si — la place du projet est
 * libre. Idempotent : une seule demande est lancée par passe, donc jamais deux
 * tâches en même temps sur le projet.
 * @param {string} project
 * @returns {Promise<{launched:boolean, reason:string}>}
 */
export async function pumpProjectQueue(project) {
  const key = project || ".";
  const launched = state.launched.get(key);
  if (launched) {
    const free = await probeFree(key);
    // Projet occupé : le démarrage est CONFIRMÉ, la place est prise.
    if (free === false) {
      state.launched.delete(key);
      emitChange();
      return { launched: false, reason: "confirmed" };
    }
    if (Date.now() - launched.launchedAt < QUEUE_CONFIRM_MS) {
      return { launched: false, reason: "starting" };
    }
    // Toujours libre après le délai : la demande n'a pas démarré (envoi refusé,
    // onglet fermé…). Elle retourne EN TÊTE de file : la place n'est pas perdue.
    state.launched.delete(key);
    const entry = launched.entry;
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts >= QUEUE_MAX_ATTEMPTS) {
      notify(
        `⚠️ La demande en file « ${entry.label} » n'a pas pu démarrer (${entry.attempts} tentatives). Elle est abandonnée : renvoyez-la depuis le chat si nécessaire.`,
        key,
      );
      emitChange();
      return { launched: false, reason: "abandoned" };
    }
    requeueAtHead(key, entry);
    notify(`⏳ Le démarrage de « ${entry.label} » n'a pas été confirmé : elle reste en file (tentative ${entry.attempts}/${QUEUE_MAX_ATTEMPTS}).`, key);
    emitChange();
    return { launched: false, reason: "not_started" };
  }

  const queue = state.queues.get(key) || [];
  if (queue.length === 0) return { launched: false, reason: "empty" };
  const free = await probeFree(key);
  if (free !== true) return { launched: false, reason: "busy" };

  const entry = queue.shift();
  if (!entry) return { launched: false, reason: "empty" };
  if (typeof entry.launch !== "function") {
    notify(`⚠️ La demande en file « ${entry.label} » n'a pas de lanceur : elle est abandonnée.`, key);
    emitChange();
    return { launched: false, reason: "no_launcher" };
  }
  let result;
  try {
    result = await entry.launch();
  } catch (e) {
    console.warn("[project-task-queue] démarrage d'une demande en file en échec :", e);
    result = false;
  }
  if (result === false) {
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts >= QUEUE_MAX_ATTEMPTS) {
      notify(
        `⚠️ La demande en file « ${entry.label} » n'a pas pu démarrer (${entry.attempts} tentatives). Elle est abandonnée : renvoyez-la depuis le chat si nécessaire.`,
        key,
      );
    } else {
      requeueAtHead(key, entry);
    }
    emitChange();
    return { launched: false, reason: "launch_failed" };
  }
  state.launched.set(key, { entry, launchedAt: Date.now() });
  emitChange();
  return { launched: true, reason: "launched", entry };
}

/**
 * UNE passe sur toutes les files non vides (projets avec demandes en attente ou
 * démarrage à confirmer). Appelée par la sonde périodique.
 * @returns {Promise<string[]>} projets réellement lancés
 */
export async function tickProjectQueues() {
  const projects = new Set([...state.queues.keys(), ...state.launched.keys()]);
  const started = [];
  for (const project of projects) {
    const hasWork = (state.queues.get(project) || []).length > 0 || state.launched.has(project);
    if (!hasWork) continue;
    const res = await pumpProjectQueue(project);
    if (res && res.launched) started.push(project);
    // File devenue vide et rien en cours : on ne garde pas la clé pour rien.
    if ((state.queues.get(project) || []).length === 0 && !state.launched.has(project)) {
      state.queues.delete(project);
    }
  }
  // Rafraîchissement de l'affichage (tâche en cours / rang des demandes) : le
  // bloc de l'onglet agent suit ainsi les changements survenus ailleurs
  // (mission de l'assistant, délégation, fin de tâche).
  emitChange();
  return started;
}

/**
 * Démarre la sonde périodique (une seule fois). C'est elle qui garantit le
 * « démarrage automatique à la libération, place jamais perdue », quel que soit
 * le chemin de sortie de la tâche en cours (réussite, erreur, arrêt demandé par
 * l'utilisateur, mort de session, chien de garde).
 */
export function startProjectQueueLoop() {
  if (state.timer) return;
  state.timer = setInterval(() => {
    tickProjectQueues().catch(() => {});
  }, QUEUE_TICK_MS);
  // Ne jamais maintenir l'environnement de test éveillé (Node) — sans effet
  // dans un navigateur (un identifiant numérique n'a pas de `.unref`).
  if (state.timer && typeof state.timer.unref === "function") state.timer.unref();
}

/** Arrête la sonde périodique. */
export function stopProjectQueueLoop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** Remise à zéro complète (tests uniquement). */
export function __resetProjectQueueForTest() {
  stopProjectQueueLoop();
  state.queues.clear();
  state.launched.clear();
  state.probe = null;
  state.notify = null;
  state.onChange = null;
  state.seq = 0;
}
