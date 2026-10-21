// agents-bus.js — Bus d'exécution inter-agents (H2 V2, spec_gestion_agents.md).
// Ordonnanceur : un seul agent stream à la fois PAR PROJET. Depuis T1, l'état de
// run est INDEXÉ PAR PROJET (busState.runs[project]) : le même type d'agent peut
// tourner en parallèle sur des PROJETS DIFFÉRENTS (architecte sur A pendant
// architecte sur B), tout en conservant l'exclusivité d'un type d'agent sur le
// MÊME projet (gérée côté Rust par la clé composite session_key(project,
// agent_id) + frontend exclusivity-queue.js, clé project\u{1f}agent_id).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { backendKind } from "./backend-info.js";
import { notifyAgentDone } from "./desktop-notify.js";
// Annulation d'une run : les surfaces de rendu des agents peuvent s'interrompre
// sans signaler leur repos → remise à zéro du son différé (son suivant
// immédiat, jamais retardé par le délai de sécurité).
import { resetDeferredSound } from "./sound-deferred.js";
import { buildProjectContext } from "./context-engine.js";
import { canStartMission } from "./run-policy.js";
import { buildMemoryBlock } from "./project-memory.js";
import { buildGraphBlock } from "./code-graph.js";
// Niveaux de réflexion (T5) : socle pur de ramenage (T1), miroir Rust de T4.
import { clampThinkingLevel, pickThinkingLevel } from "./thinking-levels.js";
import {
  loadAgentRegistry,
  normalizeAgent,
  resolveAgentModel,
  resolveAgentThinking,
  buildCoordinatorManifest,
  buildAgentPrompt,
  buildResultPrompt,
  parseCallMarker,
  parseParallelMarker,
  aggregateParallelResults,
  buildDefaultCoordinator,
  classifyAgent,
} from "./agents.js";
import {
  detectRepeatedBlock,
  detectRepeatedWord,
  detectSemanticLoop,
  detectRepeatedToolCalls,
  detectRepeatedActions,
  buildToolLoopFingerprint,
  // Décision « une lecture n'est jamais un motif d'arrêt » : classifie une ligne
  // de commande shell comme CONSULTATIVE (git status/diff/log, ls, rg, sed -n…)
  // et fournit la SOURCE UNIQUE de vérité des outils de lecture pure
  // (`AGENT_READ_ONLY_TOOLS`, partagée avec agent-pi.js et super-agent.js).
  isReadOnlyAgentToolCall,
  findRepeatedTail,
  buildLoopCorrectionPrompt,
  MAX_LOOP_ESCALATION,
} from "./loop-detection.js";
// Journal disque du MOTIF des arrêts automatiques (la cause survit à la session).
// `setAgentStopTraceFailureReporter` rend VISIBLE une trace non écrite (règle 3 :
// aucune session ne disparaît sans trace, et une trace manquante se dit).
import {
  traceAutomaticAgentStop,
  setAgentStopTraceFailureReporter,
} from "./agent-stop-trace.js";
// ENTONNOIR UNIQUE des arrêts AUTOMATIQUES (règle 3) : un seul point de passage
// écrit le motif AVANT d'arrêter. Les sites d'arrêt automatique de ce fichier ne
// choisissent donc plus « trace ou pas trace » : ils décrivent leur motif et
// fournissent l'action d'arrêt (gardes `expectedUid` / portée `runKey` intactes).
import { stopAgentWithTrace } from "./agent-stop-funnel.js";
// AGENT JETABLE : agents éphémères (rôle fourni à la volée, aucune ligne en
// base). Le bus doit les AJOUTER à sa map après chaque lecture du registre
// persistant, sinon ils seraient « inconnus » au moment du lancement.
import { listEphemeralAgents } from "./ephemeral-agents.js";
import {
  enqueueExclusivity,
  dequeueExclusivity,
  exclusivityKey,
  findExclusivityKey,
  isAgentActiveOnProject as isAgentActiveOnProjectSessions,
  isAnyAgentWorking,
  isProjectWorking,
  classifyExclusivitySession,
} from "./exclusivity-queue.js";
// Identité de projet (mission P3, défaut D3) : SOURCE UNIQUE. Le bus comparait
// le projet en chaîne BRUTE (verrou de run, files d'exclusivité) : deux
// écritures du même dossier donnaient deux verrous et deux files, dont l'une
// n'était jamais rejouée. Les comparaisons passent désormais par `sameProject`.
// Le chemin RÉEL reste utilisé tel quel pour le backend (jamais la clé).
import { sameProject, projectScopedKey, deleteProjectScoped, queueKeyMatchesProject } from "./project-key.js";
import { isProjectReservedBy, deleteReservations, clearAllReservations } from "./reservations.js";

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TOTAL_BUDGET = 30;
const DEFAULT_TIMEOUT_MS = 600000; // 10 min d'inactivité (le codeur fait des outils longs)

// Issue #87 : fenêtre de grâce avant de conclure qu'un groupe parallèle dont le
// travail est encore EN FILE (pending > 0) n'a plus aucun porteur (aucun agent
// actif et aucune session ne travaillant sur le projet). Évite de couper une run
// en cours de démarrage (fenêtre entre `beginRun` et l'entrée du 1er agent dans
// `activeAgents`) tout en récupérant un verrou orphelin en ~1 min.
const QUEUED_ORPHAN_GRACE_MS = 60 * 1000;

// Plancher d'inactivité des chemins de LANCEMENT (super-agent.js, startAgentsRun,
// startParallelRun) : avant de démarrer une mission, on libère un éventuel verrou
// de run bloqué — mais JAMAIS celui d'une run récente. Sans plancher, une run
// venant de démarrer (agent déclaré actif mais session pas encore enregistrée
// côté Rust, ou `busy` momentanément faux entre deux tours) était conclue
// « fantôme » : la run EN COURS était fermée (`endRun`) et la nouvelle démarrait
// par-dessus — l'agent qui travaillait repartait de zéro. Avec le plancher, la
// porte ambiguë ne tire pas : le lancement voit la run encore occupée et met la
// demande EN FILE (mécanisme existant) au lieu de détruire le travail. Aligné sur
// la fenêtre d'activité « récente » du moteur (2 min) — au-delà, un verrou
// vraiment fantôme est libéré comme avant.
export const RUN_LAUNCH_MIN_STUCK_IDLE_MS = 2 * 60 * 1000;

// Prudence (mission « libération abusive du verrou de run ») : les portes
// AMBIGUËS (agents déclarés actifs mais silencieux, travail en file sans
// porteur) ne libèrent le verrou que si DEUX mesures espacées du même écart
// donnent le même verdict. Une mesure unique pouvait tirer pendant la fenêtre où
// l'agent n'est pas encore réellement enregistré côté Rust → libération à tort.
// L'écart reste dans la fourchette demandée (5–10 s). Mutable uniquement via le
// point d'entrée de test `__setWatchdogConfirmDelayForTest`.
let watchdogConfirmDelayMs = 7 * 1000;

/** Réservé aux TESTS : ajuste l'écart exigé entre les deux mesures du watchdog. */
export function __setWatchdogConfirmDelayForTest(ms) {
  watchdogConfirmDelayMs = typeof ms === "number" && ms >= 0 ? ms : 7 * 1000;
}

// Watchdog — instrumentation (mission « libération abusive du verrou de run ») :
// les QUATRE portes de libération (noActive, residualParallel, ghosts,
// orphanQueue) émettaient le MÊME message, ce qui rendait la cause invisible et
// empêchait de savoir pourquoi un verrou avait été libéré. Ce formateur NOMME la
// porte, les agents concernés, la durée d'inactivité réellement mesurée et le
// nombre de demandes restant en file. Fonction PURE (exportée pour les tests).
const WATCHDOG_DOOR_LABELS = {
  noActive: "aucun agent actif (run terminée sans libération)",
  residualParallel: "groupe parallèle résiduel (tous les agents ont terminé)",
  ghosts: "agents déclarés actifs mais plus aucun ne travaille (session fantôme ou inactive)",
  orphanQueue: "travail en file sans agent porteur (verrou orphelin)",
  timeGuard: "garde de temps dépassée (aucun agent actif)",
};

/** Formate une durée d'inactivité en clair (secondes < 2 min, minutes sinon). */
function formatDurationMs(ms) {
  if (typeof ms !== "number" || ms < 0) return "inconnue";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

/**
 * Construit le message de libération du watchdog (porte + agents + inactivité).
 * @param {{door?:string, agents?:string[], idleMs?:number|null, queued?:number}} info
 * @returns {string}
 */
export function buildWatchdogReleaseMessage(info = {}) {
  const label = WATCHDOG_DOOR_LABELS[info.door] || String(info.door || "inconnue");
  const agents = (info.agents || []).filter(Boolean);
  const parts = [`porte : ${label}`];
  parts.push(agents.length ? `agent(s) : ${agents.join(", ")}` : "aucun agent enregistré");
  if (typeof info.idleMs === "number" && info.idleMs >= 0) {
    parts.push(`inactivité mesurée : ${formatDurationMs(info.idleMs)}`);
  }
  if (info.queued) parts.push(`${info.queued} demande(s) encore en file`);
  return `Run libérée par le watchdog (${parts.join(" · ")}).`;
}

/** Nombre de demandes encore en file d'exclusivité dans un contexte de run. */
function pendingExclusivityCount(ctx) {
  const queue = (ctx && ctx.exclusivityQueue) || {};
  return Object.keys(queue).reduce((n, k) => n + ((queue[k] || []).length), 0);
}

/** Marge (ms) tolérée entre l'horodatage d'un commit (précision à la seconde)
 * et le démarrage de la run : évite de rater un commit fait dans la même
 * seconde que le démarrage. */
const DISK_CLOCK_SLACK_MS = 2000;

/**
 * Pure (testable) : le travail d'une run est-il PROUVÉ présent sur le disque ?
 * Sert à ne JAMAIS annoncer l'échec d'une mission sans vérifier les fichiers :
 * un agent peut avoir écrit et committé son travail sans qu'aucun événement ne
 * soit parvenu au frontend (build/tests longs et silencieux, événement perdu,
 * relance pi). Conclure à l'échec ferait alors relancer une mission DÉJÀ FAITE
 * (mission 310). Deux preuves suffisent :
 *  - un commit tombé PENDANT la run (HEAD committé après `startedAt`) ;
 *  - pour une mission d'ÉCRITURE (`readonly !== true`), des fichiers modifiés
 *    ou nouveaux non committés (`pending > 0`) : le travail est là, même sans
 *    commit.
 * @param {object|null} status - sortie de `git_status_project`
 * @param {number} startedAt - démarrage de la run (ms epoch)
 * @param {boolean} readonly - mission de lecture (aucune écriture attendue)
 * @returns {boolean}
 */
export function provesWorkOnDisk(status, startedAt, readonly) {
  if (!status || status.is_repo !== true) return false;
  // Mission de LECTURE (plan-maker, architecte, reviewer…) : elle n'écrit RIEN
  // sur le disque. Un commit tombé pendant la run vient donc forcément
  // d'AILLEURS (vous, un autre outil) : il ne prouve aucun travail de CETTE
  // mission. Sans cette règle, une session de planification qui s'arrête sans
  // plan était rapportée « travail présent sur le disque, pas un échec » — un
  // faux succès qui laissait l'Assistant croire que le plan existait.
  if (readonly === true) return false;
  const start = Number(startedAt) || 0;
  const headTs = Number(status.head_ts) || 0;
  if (start > 0 && headTs > 0 && headTs * 1000 >= start - DISK_CLOCK_SLACK_MS) return true;
  if (Number(status.pending) > 0) return true;
  return false;
}

/**
 * Pure (testable) : la mission d'un groupe parallèle a-t-elle ÉCHOUÉ dans son
 * ensemble (aucune part exploitable) ? Sert à ne jamais livrer comme « done »
 * une run dont tous les agents se sont terminés sans livrable (ex. le
 * plan-maker qui s'arrête sans plan). Une part peut être en échec sans que la
 * mission le soit (les autres parts ont produit leur résultat).
 * @param {Record<string, {status?: string}>} results - résultats par agent
 * @returns {boolean}
 */
export function parallelMissionFailed(results) {
  const parts = Object.entries(results || {});
  if (parts.length === 0) return false;
  return parts.every(([, r]) => !!r && r.status === "error");
}

/**
 * Vérification DISQUE avant toute conclusion d'échec (mission 310) : le verdict
 * du watchdog ne doit jamais reposer sur le seul silence des événements. Lit
 * l'état Git du projet (lecture seule) et applique `provesWorkOnDisk`.
 * Fail-safe : si la sonde échoue, on retourne false (l'échec est annoncé comme
 * avant) — jamais de « réussite » inventée sans preuve.
 * @param {object} ctx - contexte de run
 * @returns {Promise<boolean>}
 */
async function workOnDiskDuringRun(ctx) {
  const project = projectOfRunKey(ctx.project || ctx.runKey);
  if (!project) return false;
  try {
    const status = await invoke("git_status_project", { project });
    return provesWorkOnDisk(status, ctx.startedAt, ctx.readonly);
  } catch (e) {
    console.warn("[agents-bus] watchdog : vérification du disque impossible :", e);
    return false;
  }
}

/**
 * Livre la libération d'un verrou par le watchdog (message instrumenté) et
 * retourne le message émis. Si du TRAVAIL a été produit avant l'arrêt, la
 * mission reçoit un rapport « run interrompue, résultat partiel » (kind "done")
 * au lieu d'un échec mensonger ; sinon un échec honnête (kind "error").
 * Mission 310 : le travail peut aussi être prouvé PAR LE DISQUE (commit ou
 * fichiers modifiés pendant la run) quand aucun texte final n'a été reçu —
 * l'échec n'est annoncé qu'après cette vérification.
 * @param {object} ctx - contexte de run
 * @param {string} door - porte qui a tiré
 * @param {number|null} idleSince - repère d'inactivité (ms epoch)
 * @returns {Promise<string>} message instrumenté
 */
async function settleWatchdogRelease(ctx, door, idleSince) {
  // RÈGLE 3 : libérer un verrou au motif que « plus personne ne travaille » est
  // un arrêt AUTOMATIQUE de la session — le motif (et la PORTE qui a tiré) est
  // écrit AVANT l'arrêt effectif, jamais après.
  await traceAutomaticAgentStopForRun(ctx, { reason: "watchdog-release", detected: door });
  const message = buildWatchdogReleaseMessage({
    door,
    agents: Array.from(ctx.activeAgents),
    idleMs: idleSince ? Date.now() - idleSince : null,
    queued: pendingExclusivityCount(ctx),
  });
  const partial = (ctx.producedText || "").trim();
  if (partial) {
    // Message honnête : du travail a été produit → run interrompue, partiel.
    settleMission(ctx.runKey, "done", {
      text: `${message}\n\n⚠️ Run interrompue : du travail a été produit avant l'arrêt, voici le résultat partiel.\n\n${partial}`,
    });
  } else if (await workOnDiskDuringRun(ctx)) {
    // Message honnête : le travail est SUR LE DISQUE → la mission n'est pas un
    // échec, même si aucun texte final n'a été reçu.
    settleMission(ctx.runKey, "done", {
      text: `${message}\n\n⚠️ Run interrompue, mais du travail est PRÉSENT sur le disque (commit ou fichiers modifiés pendant l'exécution) : la mission n'est PAS un échec. Vérifiez le résultat produit au lieu de relancer la mission.`,
    });
  } else {
    settleMission(ctx.runKey, "error", { message: `${message} Aucun travail nouveau détecté sur le disque.` });
  }
  return message;
}

// Issue #37 : détection de boucle dans la réflexion des sous-agents.
// Escalade adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies par agent et par
// run, puis abandon (voir loop-detection.js).
const AGENT_LOOP_CHECK_INTERVAL_MS = 500; // throttle du streaming
const AGENT_LOOP_BUFFER_MIN = 200; // taille min de texte avant test

// P0-2 : les outils de LECTURE PURE (sans effet de bord) ne sont PAS enregistrés
// dans l'historique de détection de boucle (donc PAS comptés) : les répéter est
// de l'exploration légitime. La LISTE vit désormais dans le module pur
// `loop-detection.js` (`AGENT_READ_ONLY_TOOLS`, `AGENT_SHELL_TOOLS`,
// `isReadOnlyAgentToolCall`) : elle est PARTAGÉE avec l'onglet agent principal
// (agent-pi.js) et l'Assistant (super-agent.js), pour que la règle « une lecture
// n'est jamais un motif d'arrêt » soit la même sur TOUS les chemins.

/**
 * Enregistre une empreinte dans l'historique de LECTURE d'un agent (borné à 40,
 * comme l'historique principal). Cet historique sert à l'OBSERVABILITÉ : il ne
 * peut plus fonder un arrêt automatique (voir maybeDetectAgentLoop).
 * @param {string} agentId
 * @param {object} ctx - contexte de run
 * @param {string} fingerprint
 */
function pushReadOnlyToolCall(agentId, ctx, fingerprint) {
  const arr = (ctx.readOnlyToolCallsByAgent[agentId] = ctx.readOnlyToolCallsByAgent[agentId] || []);
  arr.push(fingerprint);
  if (arr.length > 40) arr.splice(0, arr.length - 40);
}

// ── T1 : contexte de run PAR PROJET ─────────────────────────────────────────
// Tout l'état mutable d'une run vit dans un `runCtx` indexé par projet dans
// `busState.runs[project]`. Deux runs sur des projets DIFFÉRENTS ont donc des
// contextes indépendants (même type d'agent autorisé en parallèle sur des
// projets distincts). `maxDepth` et `timeoutMs` restent globaux (config).
// Compteur monotone d'identifiants de run (génération). Sert à empêcher une run
// ABANDONNÉE de supprimer, à sa fin tardive, le contexte d'une run NOUVELLE
// démarrée entre-temps (protection par génération dans endRun).
let runGenerationSeq = 0;
// Compteur monotone des clés de run de LECTURE (`projet#read:<n>`). Une mission
// qui MODIFIE garde la clé par défaut (le projet lui-même). Deux missions de
// LECTURE sur un même projet ont ainsi des contextes de run distincts (elles ne
// s'écrasent plus).
let readRunSeq = 0;
// Séparateur projet ↔ clé de run de lecture : permet de retrouver, à partir
// d'un projet réel, TOUTES ses runs (par défaut + lectures parallèles).
const READ_KEY_SEP = "#read:";

/** Clé de run par défaut (mission qui MODIFIE) : le projet lui-même.
 * Le chemin RÉEL est conservé (il est transmis au backend) ; l'IDENTITÉ est
 * comparée via `sameProject` / `resolveRunKey`. */
function runKey(project) {
  return project || ".";
}

/** Projet RÉEL d'une clé de run (retire le suffixe de lecture éventuel). */
function projectOfRunKey(key) {
  const i = key.indexOf(READ_KEY_SEP);
  return i < 0 ? key : key.slice(0, i);
}

/**
 * Clé de run EXISTANTE du projet (quelle que soit l'écriture de son chemin), ou
 * la clé par défaut si aucune. Garantit qu'une même run est retrouvée même si
 * l'appelant nomme le projet avec une autre écriture du même dossier.
 * @param {string} project
 * @returns {string}
 */
function resolveRunKey(project) {
  const base = runKey(project);
  if (busState.runs[base]) return base;
  for (const k of Object.keys(busState.runs)) {
    // Les clés de LECTURE (`projet#read:<n>`) ne sont jamais la clé par défaut :
    // une mission qui MODIFIE ne doit pas réutiliser le contexte d'une lecture.
    if (k.indexOf(READ_KEY_SEP) >= 0) continue;
    if (sameProject(k, base)) return k;
  }
  return base;
}

/** Toutes les clés de run appartenant au projet donné (défaut + lectures). */
function runKeysOfProject(project) {
  const base = runKey(project);
  const keys = [];
  for (const k of Object.keys(busState.runs)) {
    if (
      k === base ||
      k.startsWith(base + READ_KEY_SEP) ||
      sameProject(projectOfRunKey(k), base)
    ) {
      keys.push(k);
    }
  }
  return keys;
}

/** Clé de run NEUVE pour une mission de LECTURE (partageable sur le projet). */
export function nextReadRunKey(project) {
  return `${runKey(project)}${READ_KEY_SEP}${++readRunSeq}`;
}

// ── RÈGLE 4 : la file d'exclusivité ne meurt plus avec la run qui l'a créée ──
// La file vivait DANS le contexte de run (`ctx.exclusivityQueue`) : `endRun`
// supprimait le contexte et, avec lui, les demandes encore en attente. Une
// demande mise en file pouvait donc disparaître en silence dès que la run qui
// l'hébergeait se terminait (fin de run, libération par le watchdog, arrêt
// ciblé). La file est désormais portée par une map MODULE indexée par PROJET
// RÉEL : tous les contextes d'un projet (clé par défaut et clés de lecture)
// partagent la MÊME file, et la fin d'une run ne l'emporte plus.
const projectExclusivityQueues = {};

// D3 — les clés de `projectExclusivityQueues` sont des IDENTITÉS de projet
// (clé normalisée, cf. `project-key.js`), jamais des chemins. Un chemin
// normalisé ne peut pas servir à écrire un fichier (le journal des arrêts vit
// DANS le projet) : la file mémorise donc le chemin RÉEL dans une propriété
// SYMBOLE (invisible pour `Object.keys`, la sérialisation et les itérations de
// clés de file), ce qui permet à toute trace d'abandon de viser le bon dossier
// sans jamais ré-introduire le chemin brut comme clé.
const QUEUE_REAL_PROJECT = Symbol("pilot.exclusivityQueue.project");

/** Chemin RÉEL mémorisé par une file d'exclusivité ("" s'il est inconnu). */
function realProjectOfExclusivityQueue(queue) {
  const p = queue && queue[QUEUE_REAL_PROJECT];
  return typeof p === "string" ? p : "";
}

/**
 * File d'exclusivité PARTAGÉE d'un projet (créée au besoin), partagée par tous
 * les contextes de run du projet. Mutable (cf. exclusivity-queue.js).
 * @param {string} project - projet réel (chemin)
 * @returns {object} map `clé (projet\u{1f}agent) → assignment[]`
 */
export function exclusivityQueueOfProject(project) {
  // Clé EXISTANTE du projet (toute écriture du même chemin) sinon canonique :
  // deux écritures du dossier ne créent jamais deux files.
  const key = projectScopedKey(projectExclusivityQueues, project || ".");
  if (!projectExclusivityQueues[key]) projectExclusivityQueues[key] = {};
  const queue = projectExclusivityQueues[key];
  // Chemin réel conservé pour les traces (jamais écrasé par une clé).
  if (!realProjectOfExclusivityQueue(queue) && project) queue[QUEUE_REAL_PROJECT] = String(project);
  return queue;
}

/**
 * Retire les entrées de file dont la CLÉ est inexploitable (sans séparateur
 * projet ↔ agent) : `drainExclusivityQueues` ne peut pas les relancer, elles
 * resteraient à vie dans la file partagée et empêcheraient le verrou d'être
 * libéré (« verrou conservé pour ne rien perdre » alors que rien ne peut
 * repartir). Signalé, jamais silencieux.
 * @param {string} project
 * @returns {number} nombre d'entrées retirées
 */
function pruneUnreplayableExclusivityEntries(project) {
  const queue = projectExclusivityQueues[projectScopedKey(projectExclusivityQueues, project || ".")];
  if (!queue) return 0;
  let removed = 0;
  for (const key of Object.keys(queue)) {
    if (key.indexOf("\u{1f}") >= 0) continue;
    removed += (queue[key] || []).length;
    delete queue[key];
  }
  if (removed > 0) {
    const message = `⚠️ ${removed} demande(s) en file d'attente portaient une clé projet/agent invalide : elles ne peuvent pas être relancées et ont été retirées de la file.`;
    console.warn("[agents-bus] file d'attente :", message);
    try {
      emit("notify", { agentId: null, message });
    } catch (_) {
      /* aucun écouteur : la console a déjà l'information */
    }
  }
  return removed;
}

/**
 * Vide la file d'exclusivité d'un projet (destruction du bus, arrêt global
 * « tout arrêter »). Une demande encore en file est alors PERDUE : on le dit.
 * @param {string} project
 * @returns {number} nombre d'entrées perdues
 */
function dropProjectExclusivityQueue(project) {
  const key = projectScopedKey(projectExclusivityQueues, project || ".");
  const queue = projectExclusivityQueues[key];
  if (!queue) return 0;
  let lost = 0;
  for (const qk of Object.keys(queue)) lost += (queue[qk] || []).length;
  delete projectExclusivityQueues[key];
  return lost;
}

/**
 * Entrées de la file d'exclusivité MODULE d'un projet (source de vérité),
 * indépendamment de l'existence d'une run vivante. C'est ce qui rend une
 * entrée ORPHELINE (plus aucune run ne la porte) à la fois visible et
 * abandonnable : sans cela, une demande conservée devenait invisible (aucun
 * `busState.runs` à parcourir) et donc inexécutable ET nonsignalée.
 * @param {string} project - projet réel (chemin)
 * @returns {Array<{agentId:string, label:string, queueKey:string}>}
 */
function exclusivityQueueEntriesOf(project) {
  const queue = projectExclusivityQueues[projectScopedKey(projectExclusivityQueues, project || ".")];
  const entries = [];
  if (!queue) return entries;
  for (const queueKey of Object.keys(queue)) {
    const idx = queueKey.indexOf("\u{1f}");
    const keyAgentId = idx < 0 ? "" : queueKey.slice(idx + 1);
    for (const assignment of queue[queueKey] || []) {
      const brief = assignment && (assignment.brief || assignment.task);
      entries.push({
        agentId: (assignment && assignment.agentId) || keyAgentId,
        label: String(brief == null ? "" : brief),
        queueKey,
      });
    }
  }
  return entries;
}

/**
 * Toutes les files d'exclusivité visibles pour un projet : la file MODULE du
 * projet (source de vérité, survit aux runs) PLUS la file de chaque contexte de
 * run du projet (un contexte peut porter une file distincte, ex. file remplacée
 * à la main ou entrée héritée d'une version antérieure). Les doublons d'objet
 * sont éliminés : aucune entrée n'est comptée deux fois.
 * @param {string} project
 * @returns {object[]} maps `clé projet\u{1f}agent → assignment[]`
 */
function exclusivityQueuesOfProject(project) {
  const realProject = runKey(project || ".");
  const queues = [];
  const seen = new Set();
  const add = (queue) => {
    if (!queue || typeof queue !== "object" || seen.has(queue)) return;
    seen.add(queue);
    queues.push(queue);
  };
  add(projectExclusivityQueues[projectScopedKey(projectExclusivityQueues, project || ".")]);
  for (const key of runKeysOfProject(project)) {
    const ctx = busState.runs[key];
    if (!ctx) continue;
    if (!sameProject(ctx.project || realProject, realProject)) continue;
    add(ctx.exclusivityQueue);
  }
  return queues;
}

/**
 * Journalise (et ANNONCE) l'abandon de demandes en file d'attente. RÈGLE 3/4 :
 * une demande qui ne peut plus être rejouée ne disparaît jamais en silence — on
 * écrit le motif au journal des arrêts du projet et on prévient l'utilisateur.
 * Fail-open : une écriture impossible ne doit pas bloquer l'abandon lui-même.
 * @param {string} project - projet des demandes abandonnées
 * @param {Array<{agentId?:string, label?:string}>} entries - demandes perdues
 * @param {object} info - `{ detected, message }`
 */
function journalQueueAbandonment(project, entries, info = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return;
  const labels = list.map((e) => String((e && (e.label || e.agentId)) || "demande sans libellé"));
  const detail = `${list.length} demande(s) en file : ${labels.join(" · ")}`.slice(0, 300);
  traceAutomaticAgentStop({
    reason: "queue-abandoned",
    detected: info.detected || "queue-abandon",
    agentId: list.length === 1 ? list[0].agentId || "" : "",
    projectPath: projectOfRunKey(project || ""),
    detail,
  }).catch(() => {});
  const message =
    info.message ||
    `⚠️ ${list.length} demande(s) en file d'attente abandonnée(s) sur ce projet (elles ne peuvent plus être relancées) : ${labels.join(" · ")}`;
  console.warn("[agents-bus] file d'attente :", message);
  try {
    emit("notify", { agentId: null, message });
  } catch (_) {
    /* aucun écouteur : la console a déjà l'information */
  }
}

function newRunCtx(key, project) {
  return {
    project,
    // Clé de la run dans `busState.runs` (et des sinks de mission). Distincte du
    // projet pour les missions de LECTURE (`projet#read:<n>`), qui peuvent
    // tourner en parallèle sur un même projet (lecture partagée).
    runKey: key,
    // Nature de la mission : true = LECTURE (partageable), false = MODIFICATION
    // (exclusive sur le projet). Alimente isRunInProgress(projet, { nature }).
    readonly: false,
    runState: "idle", // "idle" | "running" | "stopping"
    // Issue #87 : instant de (re)création du contexte de run. `beginRun`
    // recopie tous les champs du contexte neuf → l'instant est réarmé à chaque
    // démarrage de run. Sert de repère d'inactivité même quand AUCUN événement
    // d'agent n'a jamais été reçu (`lastActivityAt` restait null → la garde de
    // temps du watchdog ne s'armait pas et le verrou pouvait ne jamais être
    // libéré).
    startedAt: Date.now(),
    // Identifiant de run (posé par beginRun). endRun(project, generation) refuse
    // de libérer si la génération ne correspond pas.
    generation: 0,
    callStack: [],
    budgetTotal: DEFAULT_TOTAL_BUDGET,
    budgetByAgent: {},
    timeoutId: null,
    // Prudence watchdog : instant de la 1re mesure « verrou bloqué » (porte
    // ambiguë) + identifiant de la revérification automatique. Deux mesures
    // espacées concordantes sont exigées avant toute libération.
    watchdogStuckAt: null,
    watchdogRecheckId: null,
    // Travail réellement produit dans la run (texte final des agents) : sert à
    // rendre le message de libération HONNÊTE (travail partiel ≠ échec).
    producedText: "",
    currentAgentId: null,
    // H2 V2 parallèle : ensemble des agents en train de streamer + buffers par agent.
    activeAgents: new Set(),
    streamingTextByAgent: {},
    // Issue #10 : empreintes des derniers tool calls par agent (ex: requêtes DB
    // db_query/db_execute) pour détecter une boucle d'OUTILS identiques, même
    // sans texte streamé répété.
    toolCallsByAgent: {},
    // Issue : empreintes des derniers tool calls de LECTURE PURE par agent
    // (read/search/grep/list/glob/find). Exclus du comptage principal (P0-2,
    // faux positifs sur l'exploration légitime) mais suivis dans un historique
    // SÉPARÉ avec un seuil plus élevé pour détecter une boucle soutenue de
    // lectures/recherches identiques (ex: architecte qui relit le même fichier).
    readOnlyToolCallsByAgent: {},
    // Compteur de tours pi PAR AGENT (pas global) : en run parallèle, chaque
    // agent a son propre budget. Un agent qui enchaîne des turn_start légitimes
    // (ex: plusieurs tool calls) ne doit pas être coupé à cause des tours des
    // autres agents. La vraie boucle d'outils est détectée en amont par
    // maybeDetectAgentLoop ; ce compteur n'est qu'un filet de sécurité.
    piTurnCountByAgent: {},
    parallelGroup: null, // { assignments, pending, results, onComplete }
    pendingPromise: null,
    isCompacting: false, // true pendant une compaction (filtre les deltas du résumé)
    // Issue #37 : état de détection de boucle par agent.
    loopCorrectionPending: {}, // agentId → true (arrêt en cours, correction à l'agent_end)
    loopCorrectionCount: {}, // agentId → nb de stratégies d'escalade déjà appliquées
    loopAbandoned: {}, // agentId → true après abandon (toutes les stratégies épuisées)
    loopLastChecked: {}, // agentId → timestamp du dernier test
    loopAbortReason: {}, // agentId → cause de l'abort par boucle (propagée au résultat agrégé)
    // Restitution fiable (fin de run → assistant) : marqueur « tour déjà
    // finalisé pour cet agent » (posé par le PREMIER agent_end final ou
    // agent_settled traité) + erreur pi en attente d'arbitrage (annulée si
    // pi relance tout seul, prononcée à l'agent_end final sinon) + marqueur
    // « tour démarré dans CETTE run » (antidate les événements terminaux).
    endedByAgent: {},
    pendingErrorByAgent: {},
    // Point de suivi 344 (b) : agentId → true quand le tour a été interrompu
    // (abort du moteur) plutôt que par une vraie erreur du modèle. Le message
    // simple et complet est alors produit en fin de tour par failAgentTurn.
    interruptedRunByAgent: {},
    startedByAgent: {},
    // Ciblage de projet (run_agents) : agentId → cwd du projet (toujours égal à
    // ctx.project dans ce contexte). Utilisé pour router les commandes
    // (abort/command/prompt) vers la bonne session pendant le tour.
    agentProject: {},
    // Propriété de session : agentId → uid de la session pi lancée par CETTE
    // run (renvoyé par `start_agent_process`). Les arrêts/abandons automatiques
    // le transmettent à Rust, qui refuse d'agir si la session en place a un
    // autre uid (relance du même couple (projet, agent) par un autre chemin).
    // Sans cette garde, un minuteur périmé ou un moniteur oublié avortait la
    // session flambant neuve du même agent : « l'agent commence et s'arrête ».
    sessionUid: {},
    // Bug #9 : horodatage de la dernière activité réelle (événement agent reçu).
    // Utilisé par le watchdog releaseStuckRunLock comme garde de temps : si le
    // verrou est "running" sans activité depuis trop longtemps, on le libère.
    lastActivityAt: null,
    // T5 : file d'attente d'exclusivité des spécialités par projet, PARTAGÉE par
    // tous les contextes de run du projet réel (RÈGLE 4 : elle survit à la run
    // qui l'a créée). Clé `project\u{1f}agent_id` → assignments en attente.
    exclusivityQueue: exclusivityQueueOfProject(project),
    // Filet de sécurité par run : nombre de tours agent (détection boucle).
    turnCount: 0,
    // Modèle de secours (defaultModel du model-switch.json) résolu UNE fois par
    // run (voir ensureFallbackModel). `undefined` = non résolu, "" = résolu
    // mais vide, sinon la valeur. Reset à `undefined` par beginRun (run neuve).
    fallbackModel: undefined,
  };
}

let busState = {
  listeners: null,
  autoStopListener: null,
  staleBusyListener: null,
  registry: null,
  coordinator: null,
  agents: new Map(),
  config: null,
  callbacks: {},
  // Livraison des RAPPORTS par mission : un sink par CLÉ DE RUN. Avant, chaque
  // mission écrasait `busState.callbacks` (état global) → la seconde mission
  // écrasait la première et un rapport de fin pouvait être livré à la mauvaise
  // mission, ou perdu. Avec un sink par run, la livraison croisée est impossible.
  missionSinks: {},
  // Config dérivée, partagée entre toutes les runs (lecture seule pendant l'exécution).
  maxDepth: DEFAULT_MAX_DEPTH,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  // T1 : état de run INDEXÉ PAR PROJET. Clé = projet (cwd) de la run.
  runs: {}, // project → runCtx
};

// T1 : helpers purs d'accès à l'état de run PAR PROJET. Un appel sans projet
// (clé ".") couvre le projet actif implicite.
// Agents d'assistant (tâche #140) : projet réservé (jamais un vrai chemin de
// projet). Quand une run cible ce token, l'agent tourne dans l'espace réservé
// `~/.pilot/assistant/` : pas de contexte projet injecté, commandes IPC dédiées
// (start_assistant_agent_process / send_assistant_agent_prompt), clé de run
// distincte. Doit rester distinct de "" (super-agent) et de tout projet réel.
export const ASSISTANT_SPACE = "__assistant__";

/** Contexte de run par CLÉ DE RUN (créé au besoin). */
function getRunCtxByKey(key) {
  if (!busState.runs[key]) busState.runs[key] = newRunCtx(key, projectOfRunKey(key));
  return busState.runs[key];
}

/**
 * Retourne le contexte de run du projet (clé par défaut), en le créant s'il
 * n'existe pas.
 * @param {string} [project]
 * @returns {object} runCtx
 */
function getRunCtx(project) {
  return getRunCtxByKey(resolveRunKey(project));
}

/**
 * État de run d'un projet ("idle" par défaut). Helper pur utilisé par
 * startParallelRun (garde), isRunInProgress et le watchdog.
 * @param {string} [project]
 * @returns {string}
 */
export function getRunState(project) {
  // Une mission de LECTURE a sa propre clé de run : l'état d'un PROJET est
  // "running" dès qu'une de ses runs (défaut ou lecture) n'est pas idle.
  for (const key of runKeysOfProject(project)) {
    const ctx = busState.runs[key];
    if (ctx && ctx.runState !== "idle") return ctx.runState;
  }
  return "idle";
}

/**
 * Démarre une run sur un projet : réinitialise un contexte neuf puis le passe
 * en "running". Ne touche PAS aux contextes des autres projets.
 * @param {string} [project]
 * @returns {object} runCtx neuf en état "running"
 */
export function beginRun(project, options) {
  // Une mission de LECTURE (options.readOnly) reçoit une clé de run NEUVE, donc
  // un contexte distinct : deux lectures sur un même projet ne s'écrasent plus.
  const readOnly = !!(options && options.readOnly);
  const key = readOnly ? nextReadRunKey(project) : resolveRunKey(project);
  // Démarrage d'une run : les entrées de file à clé inexploitable (impossibles
  // à relancer) sont retirées, sinon elles bloqueraient ce verrou à vie.
  pruneUnreplayableExclusivityEntries(project);
  const fresh = newRunCtx(key, project);
  const ctx = getRunCtxByKey(key);
  for (const k of Object.keys(fresh)) if (k !== "project") ctx[k] = fresh[k];
  ctx.project = project;
  ctx.readonly = readOnly;
  ctx.budgetTotal = (busState.config && busState.config.agent_max_total_calls) || DEFAULT_TOTAL_BUDGET;
  ctx.runState = "running";
  // Génération NEUVE : les fins de run antérieures (endRun tardif portant
  // l'ancienne génération) ne pourront plus supprimer ce contexte.
  ctx.generation = ++runGenerationSeq;
  return ctx;
}

/**
 * Termine une run sur un projet : supprime uniquement son contexte (libère le
 * verrou de run projet-scopé). Ne touche PAS aux runs des autres projets.
 * @param {string} [project]
 */
export function endRun(project, generation) {
  // Protection par génération (fin de run tardive) : une run abandonnée qui se
  // termine APRÈS le démarrage d'une nouvelle run porte l'ANCIENNE génération ;
  // son endRun ne doit PAS supprimer le contexte de la nouvelle.
  // `generation` omise (appel legacy / libération forcée) → uniquement la clé
  // par défaut du projet, comportement inchangé.
  if (generation === undefined) {
    const key = resolveRunKey(project);
    const ctx = busState.runs[key];
    if (ctx) {
      if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
      if (ctx.watchdogRecheckId) clearTimeout(ctx.watchdogRecheckId);
      delete busState.runs[key];
    }
    return;
  }
  // Les missions de LECTURE ont leur propre clé : on retrouve la run par sa
  // GÉNÉRATION sur toutes les clés du projet (défaut + lectures), car les
  // appelants passent le PROJET RÉEL (`ctx.project`), pas la clé de run.
  for (const key of runKeysOfProject(project)) {
    const ctx = busState.runs[key];
    if (ctx && ctx.generation === generation) {
      if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
      if (ctx.watchdogRecheckId) clearTimeout(ctx.watchdogRecheckId);
      delete busState.runs[key];
      return;
    }
  }
}

// Réinitialise tous les contextes de run (utilisé par destroyAgentsBus et par
// stopAgentsRun en portée GLOBALE : bouton « tout arrêter » de l'utilisateur).
// Les arrêts AUTOMATIQUES passent `runKey` et libèrent leur seule run.
function clearAllRuns() {
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
    if (ctx.watchdogRecheckId) clearTimeout(ctx.watchdogRecheckId);
  }
  busState.runs = {};
  // Arrêt GLOBAL (« tout arrêter » / destruction du bus) : les files partagées
  // des projets ne peuvent plus être rejouées, on les vide.
  //
  // RÈGLE 4 : une demande en file ne doit JAMAIS disparaître en silence. On
  // collecte donc les demandes perdues AVANT de vider la file (libellés
  // compris), puis on les JOURNALISE (`.pilot/agent-stops.log`, reason
  // `queue-abandoned`) et on PRÉVIENT l'utilisateur : sans cela, une mission
  // mise en file disparaissait sans trace ni annonce (elle était seulement
  // comptée dans un `console.warn`).
  const lostByProject = [];
  for (const project of Object.keys(projectExclusivityQueues)) {
    const entries = exclusivityQueueEntriesOf(project);
    // Chemin RÉEL capturé AVANT le vidage : c'est lui (et non la clé de file)
    // qui désigne le dossier où écrire le journal des arrêts.
    const realProject = realProjectOfExclusivityQueue(projectExclusivityQueues[project]);
    const lost = dropProjectExclusivityQueue(project);
    if (lost > 0) lostByProject.push({ project, realProject, entries });
  }
  for (const { project, realProject, entries } of lostByProject) {
    journalQueueAbandonment(realProject || projectOfRunKey(project), entries, {
      detected: "clear-all-runs",
    });
  }
}

// Bug #9 : watchdog de sécurité du verrou de run, SCOpÉ au projet. Si la run
// d'un projet est marquée "running" mais qu'aucun agent n'est réellement en
// train de streamer, le verrou de CE projet est bloqué. On force sa libération
// (endRun) pour ne pas bloquer les appels suivants à run_agents sur ce projet.
// Exportée pour les tests vitest (verrou fantôme, chantier 6/6).
//
// Verrou fantôme (busy-stale) : une session peut rester « busy » chez Rust
// (process pi figé, ni settled ni exit) alors qu'aucun travail n'avance.
// isAnyAgentWorking la considère désormais comme non-travailleuse (tâche 1),
// donc le verrou est libéré — MAIS il faut AUSSI vider les files d'exclusivité
// du projet : des demandes en attente (exclusivityQueue) derrière l'agent
// fantôme resteraient coincées si l'on terminait la run sans les lancer. On
// lance donc les demandes en file AVANT de libérer le verrou (la run redevient
// alors réellement active) ; on ne libère le verrou QUE si plus rien n'est en
// file.
//
// Tâche 2 : s'assure aussi que le cas 3 remonte bien le projet (key) pour
// drainer la bonne file (les files d'exclusivité sont scopées PAR PROJET).
// `opts.requireIdleMs` : plancher d'inactivité (ms) exigé avant toute
// libération par une porte AMBIGUË (ghosts/orphanQueue). Réservé aux appelants
// OBSERVATEURS qui sondent périodiquement (rejeu de file, cadencé à 15 s) : ils
// n'ont pas à couper une run qui vient de démarrer ou qui vient d'émettre un
// événement (agent qui réfléchit, lit un gros fichier ou enchaîne des tests sans
// rien afficher). Défaut 0 = comportement historique (chemins de LANCEMENT,
// vérification explicite d'un verrou).
/**
 * @param {string} project
 * @param {{requireIdleMs?:number}} [opts]
 */
export async function releaseStuckRunLock(project, opts = {}) {
  // Toutes les runs du projet (défaut + lectures parallèles) peuvent porter un
  // verrou fantôme : le watchdog est appliqué à CHACUNE.
  for (const key of runKeysOfProject(project)) {
    await releaseStuckRunLockForKey(key, opts);
  }
}

// Mission 380bis : plancher d'inactivité de la levée ciblée d'un verrou
// ORPHELIN (voir `releaseOrphanRunLock`). Posé à part pour ne pas déguiser cet
// appel en « chemin de LANCEMENT » (les tests de plancher comptent les appels
// qui passent `requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS` en clair).
const ORPHAN_RELEASE_OPTS = { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS };

/**
 * Levée CIBLÉE d'un verrou de run ORPHELIN, tentée AVANT de refuser une
 * COMMANDE MANUELLE de l'utilisateur (mission 380).
 *
 * Définition UNIQUE, partagée par les cinq points d'entrée de commande manuelle
 * (saisie du chat, choix/reprise et sélection de prompt dans `agent-pi.js`, menu
 * contextuel « Envoyer à l'agent » de `sidebar.js`, bouton du Prompt Builder) :
 * mission 380bis, la levée n'était branchée que sur trois d'entre eux, les deux
 * autres refusant « une tâche d'agents est déjà en cours » face à un verrou
 * orphelin. Une définition unique interdit cette divergence.
 *
 * Elle réutilise le chien de garde (`releaseStuckRunLock`) avec le plancher
 * d'inactivité de LANCEMENT : rien n'est libéré tant qu'un agent travaille
 * réellement.
 * @param {string} project - projet ciblé (chemin réel)
 * @returns {Promise<void>}
 */
export function releaseOrphanRunLock(project) {
  return releaseStuckRunLock(project, ORPHAN_RELEASE_OPTS);
}

async function releaseStuckRunLockForKey(key, opts = {}) {
  const ctx = busState.runs[key];
  if (!ctx || ctx.runState !== "running") return;
  const requireIdleMs = Number(opts && opts.requireIdleMs) > 0 ? Number(opts.requireIdleMs) : 0;

  // 1. Cas nominal : aucun agent actif et aucun groupe parallèle en cours →
  //    verrou bloqué (fin normale/erreur sans libération).
  const noActive = ctx.activeAgents.size === 0;
  const noParallel = !ctx.parallelGroup || ctx.parallelGroup.pending <= 0;
  // 2. Groupe parallèle résiduel : objet non nul mais pending <= 0 (tous les
  //    agents ont terminé/échoué sans que onComplete n'ait libéré le verrou).
  const residualParallel = !!ctx.parallelGroup && ctx.parallelGroup.pending <= 0;
  // 3. Agents fantômes / inactifs : activeAgents non vide mais plus AUCUN agent
  //    réellement en activité (busy, ou dernière activité plus récente que la
  //    fenêtre de grâce / non busy-stale — isAnyAgentWorking).
  let ghosts = false;
  if (!noActive) {
    const working = await anyActiveAgentWorking(key);
    // Mission 310 : ne pas conclure « fantôme » tant qu'UNE session du projet
    // produit encore. La sonde ci-dessus est scopée aux agents DÉCLARÉS dans la
    // run : si l'agent déclaré n'a pas de session correspondante (id ou projet
    // non concordant) alors que le travail continue réellement (outil long
    // silencieux, commit en cours), la run était libérée en ÉCHEC au milieu du
    // travail. Même règle que la porte `orphanQueue` (sonde projet-large).
    ghosts = !working && !(await projectHasWorkingSession(key));
  }

  // 3 bis (issue #87) : DEMANDE EN FILE SANS PORTEUR. Groupe parallèle avec du
  //    travail encore attendu (pending > 0) mais AUCUN agent actif et AUCUNE
  //    session ne travaillant sur le projet : le créneau d'exécution n'est plus
  //    tenu par personne (agent fantôme dont le processus est mort). Sans cette
  //    détection, le verrou restait « running » indéfiniment — et si aucun
  //    événement d'agent n'avait jamais été reçu, `lastActivityAt` était null,
  //    donc la garde de temps (point 4) ne s'armait jamais — puis TOUTES les
  //    demandes suivantes étaient mises en file en silence (issue #87).
  //    La fenêtre de grâce (`startedAt`/`lastActivityAt`) évite de couper une
  //    run en cours de démarrage.
  let orphanQueue = false;
  if (noActive && !noParallel && ctx.parallelGroup.pending > 0) {
    const idleSince = ctx.lastActivityAt || ctx.startedAt || 0;
    if (idleSince && Date.now() - idleSince > QUEUED_ORPHAN_GRACE_MS) {
      orphanQueue = !(await projectHasWorkingSession(key));
    }
  }

  const stuck = (noActive && noParallel) || residualParallel || ghosts || orphanQueue;
  // Instrumentation : quelle porte a conclu « verrou bloqué » ?
  const door = noActive && noParallel
    ? "noActive"
    : residualParallel
      ? "residualParallel"
      : orphanQueue
        ? "orphanQueue"
        : "ghosts";

  // Plancher d'inactivité demandé par l'appelant (voir `releaseStuckRunLock`) :
  // les portes AMBIGUËS ne concluent pas « plus personne ne travaille » tant
  // que la run a produit un événement (ou vient de démarrer) il y a moins de
  // `requireIdleMs`. C'est le faux positif corrigé : un agent qui travaille en
  // silence était coupé au bout de quelques secondes — travail perdu. La
  // protection réelle reste entière dès que l'inactivité dépasse le plancher
  // (session fantôme, process mort, réservation abandonnée : toujours libérés).
  // Les portes NON ambiguës (noActive, residualParallel) gardent leur
  // libération immédiate : un verrou sans aucun agent porteur ne doit pas
  // attendre (issue #87).
  if (stuck && requireIdleMs > 0 && (door === "ghosts" || door === "orphanQueue")) {
    const idleSince = ctx.lastActivityAt || ctx.startedAt || 0;
    if (!idleSince || Date.now() - idleSince < requireIdleMs) return;
  }
  if (!stuck) {
    // 4. Garde de temps : verrou "running" sans activité réelle depuis trop
    //    longtemps (filet de sécurité si la sonde de vivacité est indisponible).
    //    `startedAt` sert de repère quand aucun événement d'agent n'a jamais été
    //    reçu (`lastActivityAt` null) : sans lui, le verrou n'était jamais
    //    libéré (issue #87).
    //    `noActive` est EXIGÉ : on n'entre ici que si `!stuck`, donc si la sonde
    //    de vivacité vient de répondre « un agent enregistré TRAVAILLE » — la
    //    libérer quand même coupait un agent actif (lecture longue, build,
    //    tests) simplement parce qu'il n'émettait aucun événement. Un tel agent
    //    reste couvert par les filets fantômes (25 min) et l'arrêt auto T2.
    const idleSince = ctx.lastActivityAt || ctx.startedAt;
    if (noActive && idleSince && Date.now() - idleSince > busState.timeoutMs) {
      const drained = await drainExclusivityQueues(ctx, key);
      if (drained) {
        console.warn("[agents-bus] watchdog : run inactive depuis trop longtemps mais demandes en file → relance.");
        resetTimeout(ctx);
        return;
      }
      console.warn("[agents-bus] watchdog :", await settleWatchdogRelease(ctx, "timeGuard", idleSince));
      endRun(key, ctx.generation);
    }
    return;
  }

  // Verrou bloqué : avant de libérer, drainer les files d'exclusivité du projet.
  // Des demandes en file (exclusivityQueue) derrière un agent fantôme/inactif
  // doivent RÉELLEMENT démarrer au lieu de rester coincées (tâche 2).
  // launchNextQueued réactive la run (runAgentTurn) → on conserve le verrou.
  const drained = await drainExclusivityQueues(ctx, key);
  if (drained) {
    if (ghosts) {
      console.warn("[agents-bus] watchdog : agents fantômes/inactifs mais demandes en file → relance des demandes en attente.");
    } else if (orphanQueue) {
      console.warn("[agents-bus] watchdog : travail en file sans agent porteur (verrou orphelin) → relance des demandes en attente.");
    } else if (residualParallel) {
      console.warn("[agents-bus] watchdog : groupe parallèle résiduel mais demandes en file → relance des demandes en attente.");
    } else {
      console.warn("[agents-bus] watchdog : aucun agent actif mais demandes en file → relance des demandes en attente.");
    }
    resetTimeout(ctx);
    return;
  }

  // La file ne doit JAMAIS être abandonnée : si des demandes restent en file
  // (échec de lancement, sonde indisponible), on CONSERVE le verrou au lieu de
  // libérer — une libération les perdrait avec le contexte.
  if (pendingExclusivityCount(ctx) > 0) {
    console.warn("[agents-bus] watchdog : demandes encore en file → verrou conservé (reprise garantie).");
    resetTimeout(ctx);
    return;
  }

  // Prudence : les portes AMBIGUËS exigent DEUX mesures espacées concordantes.
  // La 1re mesure arme une revérification automatique et NE libère pas ; si
  // l'état a changé entre-temps (agent finalement enregistré/en travail), le
  // second verdict n'est plus « bloqué » et le verrou est conservé.
  if (door === "ghosts" || door === "orphanQueue") {
    const now = Date.now();
    const prev = ctx.watchdogStuckAt;
    if (!prev || now - prev < watchdogConfirmDelayMs) {
      ctx.watchdogStuckAt = now;
      // Le plancher de l'appelant doit SURVIVRE à la revérification : le rejeu
      // automatique repartait sinon avec `requireIdleMs = 0` et libérait la run
      // que le plancher venait justement de protéger.
      if (requireIdleMs > 0) ctx.watchdogStuckFloorMs = requireIdleMs;
      if (!ctx.watchdogRecheckId) {
        ctx.watchdogRecheckId = setTimeout(() => {
          ctx.watchdogRecheckId = null;
          const floor = ctx.watchdogStuckFloorMs || 0;
          ctx.watchdogStuckFloorMs = 0;
          if (busState.runs[key] === ctx) {
            releaseStuckRunLockForKey(key, floor > 0 ? { requireIdleMs: floor } : undefined).catch(() => {});
          }
        }, watchdogConfirmDelayMs + 50);
      }
      console.warn(
        "[agents-bus] watchdog : verdict « %s » non confirmé (1re mesure) — revérification dans %s s.",
        door,
        Math.round(watchdogConfirmDelayMs / 1000),
      );
      return;
    }
  }
  ctx.watchdogStuckAt = null;

  // Rien en file : libérer réellement le verrou (la vraie run est terminée).
  // Livraison fiable : une run libérée par le watchdog (bloquée) doit aussi
  // résoudre SON sink, sinon la mission attendrait un rapport qui n'arrivera
  // jamais. Le message NOMME la porte qui a tiré, les agents concernés et
  // l'inactivité mesurée (instrumentation — cause enfin visible).
  console.warn(
    "[agents-bus] watchdog :",
    await settleWatchdogRelease(ctx, door, ctx.lastActivityAt || ctx.startedAt || null),
  );
  endRun(key, ctx.generation);
}

// ── Verrou orphelin : balayage périodique AUTO-RÉPARANT (mission 380) ───────
//
// FAIT (défaut) : la libération d'un verrou de run reposait entièrement sur un
// déclencheur EXTÉRIEUR — un nouveau lancement, le rejeu de file de l'assistant
// (armé seulement s'il RESTE une demande en file) ou son watchdog de run
// (15 min, seulement pendant une run suivie). Un agent MORT sans émettre
// `agent_end`/`process_exit` (ou dont l'événement terminal arrive après le
// passage de la run en `stopping`, ou après sa sortie de `activeAgents`) ne
// libérait donc jamais le verrou : « Une tâche d'agents est déjà en cours sur ce
// projet… » jusqu'au REDÉMARRAGE de Pilot.
//
// CE BALAYAGE rend la libération AUTONOME : toutes les RUN_LOCK_SWEEP_MS, on
// repasse sur les runs du bus et on applique le chien de garde existant
// (`releaseStuckRunLockForKey`), réutilisé TEL QUEL — ses portes restent la
// seule autorité (« aucun agent actif », « groupe résiduel », « agents
// fantômes », « travail en file sans porteur »), avec son plancher
// d'inactivité et sa double mesure. Rien n'est coupé sur la seule horloge : une
// run dont un agent travaille réellement est laissée intacte (sonde de
// sessions, fail-closed).
export const RUN_LOCK_SWEEP_MS = 30 * 1000;
// Grâce de DÉMARRAGE : une run plus jeune que cette fenêtre n'est jamais
// examinée (fenêtre entre `beginRun` et l'enregistrement de la 1re session).
export const RUN_LOCK_SWEEP_START_GRACE_MS = 60 * 1000;
// Plancher d'INACTIVITÉ du balayage : il ne coupe jamais une run qui vient de
// produire un événement. Il protège aussi les transitions LÉGITIMES où
// `activeAgents` est momentanément vide entre deux agents d'une même run
// (passation séquentielle) : le balayage n'agit qu'après une vraie inactivité.
// Un verrou réellement orphelin a toujours une activité ancienne : rien n'est
// perdu, on borne seulement le zèle d'un observateur périodique.
export const RUN_LOCK_SWEEP_MIN_IDLE_MS = RUN_LAUNCH_MIN_STUCK_IDLE_MS;
let runLockSweepTimer = null;
let runLockSweepInFlight = false;

/** Arme le balayage périodique des verrous orphelins (idempotent). */
function startRunLockSweep() {
  if (runLockSweepTimer) return;
  runLockSweepTimer = setInterval(() => {
    sweepOrphanRunLocks().catch(() => {});
  }, RUN_LOCK_SWEEP_MS);
  // Ne jamais maintenir l'environnement de test éveillé (Node) : sans effet
  // dans un navigateur (un identifiant numérique n'a pas de `.unref`).
  if (runLockSweepTimer && typeof runLockSweepTimer.unref === "function") {
    runLockSweepTimer.unref();
  }
}

/** Désarme le balayage (destruction du bus). */
function stopRunLockSweep() {
  if (runLockSweepTimer) clearInterval(runLockSweepTimer);
  runLockSweepTimer = null;
}

/**
 * Balaye les runs du bus et libère les verrous ORPHELINS (mission 380).
 *
 * Un verrou est orphelin quand plus rien ne le porte : aucun agent actif et
 * aucun groupe parallèle en attente, ou agents déclarés dont AUCUNE session ne
 * travaille (process mort), ou travail encore en file sans porteur. La décision
 * est celle du chien de garde existant (`releaseStuckRunLockForKey`) ; ce
 * balayage ne fait que la DÉCLENCHER sans attendre un lancement.
 *
 * Une run plus jeune que `RUN_LOCK_SWEEP_START_GRACE_MS` est ignorée : jamais de
 * coupe pendant la fenêtre de démarrage.
 *
 * Les runs en état `stopping` (arrêt demandé dont la libération ne s'est pas
 * terminée, ex: I/O bloquée) sont libérées au-delà de la même grâce : elles ne
 * portent plus aucun travail utile.
 * @param {number} [now] - instant de référence (ms epoch), injectable en test
 * @returns {Promise<string[]>} clés de run réellement libérées
 */
export async function sweepOrphanRunLocks(now = Date.now()) {
  if (runLockSweepInFlight) return [];
  runLockSweepInFlight = true;
  const released = [];
  try {
    for (const key of Object.keys(busState.runs)) {
      const ctx = busState.runs[key];
      if (!ctx) continue;
      const since = ctx.lastActivityAt || ctx.startedAt || 0;
      if (!since || now - since < RUN_LOCK_SWEEP_START_GRACE_MS) continue;
      if (ctx.runState === "stopping") {
        // Arrêt demandé mais jamais terminé (événement terminal perdu, I/O
        // bloquée) : le verrou ne porte plus de travail utile. Deux garde-fous
        // AVANT de le rendre au projet (VERIF-380 § 4.1 / 4.2) :
        //  1. une demande EN FILE n'est jamais abandonnée en silence : la run
        //     est réarmée puis drainée (même règle que
        //     releaseStuckRunLockForKey, qui CONSERVE le verrou tant que la
        //     file vit) — sinon les demandes mouraient avec le contexte ;
        //  2. une session du projet qui travaille encore conserve le verrou :
        //     le libérer laisserait une nouvelle run écrire par-dessus un
        //     processus encore actif. Borne dans le temps par la fenêtre
        //     « busy-stale » (25 min) : une session figée ne bloque pas à vie.
        if (pendingExclusivityCount(ctx) > 0) {
          ctx.runState = "running";
          const relaunched = await drainExclusivityQueues(ctx, key);
          if (relaunched || pendingExclusivityCount(ctx) > 0) {
            resetTimeout(ctx);
            console.warn(
              "[agents-bus] balayage : run restée « stopping » avec des demandes en file → relance des demandes en attente (verrou conservé).",
            );
            continue;
          }
        }
        if (await projectHasWorkingSession(key)) {
          console.warn(
            "[agents-bus] balayage : run restée « stopping » mais une session du projet travaille encore → verrou conservé (",
            key,
            ").",
          );
          continue;
        }
        const generation = ctx.generation;
        // RÈGLE 3 : la run restée « stopping » est libérée automatiquement —
        // le motif est écrit AVANT la libération (l'arrêt n'est jamais muet).
        await traceAutomaticAgentStopForRun(ctx, {
          reason: "sweep-stopping-release",
          detected: "sweep",
        });
        settleMission(ctx.runKey, "stop", {});
        endRun(key, generation);
        released.push(key);
        console.warn("[agents-bus] balayage : run restée « stopping », verrou libéré (", key, ").");
        continue;
      }
      if (ctx.runState !== "running") continue;
      const generation = ctx.generation;
      // Observateur PÉRIODIQUE : plancher d'inactivité (jamais de coupe d'une run
      // qui vient de produire un événement, ni pendant une passation d'agents).
      const idleSince = ctx.lastActivityAt || ctx.startedAt || 0;
      if (!idleSince || now - idleSince < RUN_LOCK_SWEEP_MIN_IDLE_MS) continue;
      await releaseStuckRunLockForKey(key, { requireIdleMs: RUN_LOCK_SWEEP_MIN_IDLE_MS });
      const after = busState.runs[key];
      if (!after || after.generation !== generation) released.push(key);
    }
  } finally {
    runLockSweepInFlight = false;
  }
  return released;
}

/**
 * Photo du verrou de run d'un projet (mission 380) : permet de VOIR un verrou
 * bloqué sans redémarrer Pilot (commande `/verrou`).
 * @param {string} project - projet ciblé (chemin réel)
 * @returns {{project:string, blocked:boolean, keys:Array<object>}}
 */
export function getProjectRunLockInfo(project) {
  const target = project || ".";
  const keys = runKeysOfProject(target).map((key) => {
    const ctx = busState.runs[key];
    const lastActivityAt = ctx.lastActivityAt || ctx.startedAt || null;
    return {
      key,
      runState: ctx.runState,
      readonly: ctx.readonly === true,
      agents: Array.from(ctx.activeAgents),
      startedAt: ctx.startedAt || null,
      lastActivityAt,
      idleMs: lastActivityAt ? Date.now() - lastActivityAt : null,
      queued: pendingExclusivityCount(ctx),
      pending: ctx.parallelGroup ? ctx.parallelGroup.pending : 0,
    };
  });
  return { project: target, blocked: isRunInProgress(target), keys };
}

/**
 * File d'attente d'EXCLUSIVITÉ d'un projet, dans l'ordre (mission 385) :
 * demandes d'agents mises en file derrière un agent de la même spécialité.
 * Lecture seule.
 *
 * RÈGLE 4 : la lecture porte sur la file MODULE du projet (`projectExclusivityQueues`,
 * source de vérité qui survit à la fin des runs) ET sur les files portées par les
 * contextes de run vivants. Une entrée conservée alors qu'aucune run ne la porte
 * plus (ORPHELINE) reste ainsi visible — c'est sa seule chance d'être relancée ou
 * abandonnée explicitement (`orphan: true` dans le résultat).
 * @param {string} project - projet ciblé (chemin réel)
 * @returns {Array<{agentId:string, label:string, runKey:string, orphan:boolean}>}
 */
export function listProjectExclusivityEntries(project) {
  const realProject = runKey(project || ".");
  const entries = [];
  const alive = new Set(runKeysOfProject(project).filter((k) => !!busState.runs[k]));
  for (const queue of exclusivityQueuesOfProject(project)) {
    for (const queueKey of Object.keys(queue)) {
      const idx = queueKey.indexOf('\u{1f}');
      if (idx < 0) continue;
      if (!queueKeyMatchesProject(queueKey, realProject)) continue;
      const keyAgentId = queueKey.slice(idx + 1);
      for (const assignment of queue[queueKey] || []) {
        const brief = assignment && (assignment.brief || assignment.task);
        const ownerRunKey = (assignment && assignment.runKey) || "";
        entries.push({
          agentId: (assignment && assignment.agentId) || keyAgentId,
          label: String(brief == null ? "" : brief),
          // Clé de run qui porte l'entrée ; vide pour une entrée ORPHELINE
          // (plus aucune run ne la portera jamais → elle doit être rejouée ou
          // abandonnée explicitement).
          runKey: ownerRunKey && alive.has(ownerRunKey) ? ownerRunKey : "",
          orphan: !(ownerRunKey && alive.has(ownerRunKey)),
        });
      }
    }
  }
  return entries;
}

/**
 * Abandonne les demandes d'AGENTS en file d'exclusivité d'un projet (mission 385,
 * commande `/file vide`). Chaque demande abandonnée reçoit un résultat d'erreur
 * dans son groupe parallèle et décrémente son `pending` (même règle que le
 * chemin « agent introuvable ») : la run ne reste jamais bloquée en attente d'un
 * travail qui ne sera pas fait. Le nombre abandonné est retourné (annoncé).
 * @param {string} project - projet ciblé (chemin réel)
 * @returns {number}
 */
export function abandonProjectExclusivityQueues(project, options = {}) {
  const realProject = runKey(project || ".");
  const abandoned = [];
  for (const key of runKeysOfProject(project)) {
    const ctx = busState.runs[key];
    if (!ctx) continue;
    const queue = ctx.exclusivityQueue || {};
    for (const queueKey of Object.keys(queue)) {
      const idx = queueKey.indexOf('\u{1f}');
      if (idx < 0) continue;
      if (!queueKeyMatchesProject(queueKey, realProject)) continue;
      const assignments = queue[queueKey] || [];
      for (const assignment of assignments) {
        const agentId = (assignment && assignment.agentId) || queueKey.slice(idx + 1);
        if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
          ctx.parallelGroup.results[agentId] = {
            status: "error",
            text: `Demande en file d'attente abandonnée par l'utilisateur (agent ${agentId}).`,
          };
          ctx.parallelGroup.pending--;
        }
        abandoned.push({ agentId, label: String((assignment && (assignment.brief || assignment.task)) || "") });
      }
      delete queue[queueKey];
    }
  }
  // File MODULE (source de vérité) : les entrées ORPHELINES n'appartiennent plus
  // à aucun contexte de run — elles ne doivent pas survivre à un abandon explicite.
  // (Les clés de la file module déjà vidées par la boucle ci-dessus ne sont donc
  // plus comptées : aucun doublon.)
  const moduleEntries = exclusivityQueueEntriesOf(project);
  deleteProjectScoped(projectExclusivityQueues, realProject);
  if (moduleEntries.length > 0) abandoned.push(...moduleEntries);
  const removed = abandoned.length;
  if (removed > 0 && options.journal !== false) {
    journalQueueAbandonment(project, abandoned, {
      detected: options.detected || "user-abandon",
      message: options.message,
    });
  }
  return removed;
}

/**
 * Libère À LA DEMANDE tous les verrous de run d'un projet (mission 380,
 * commande `/verrou libere`). Action EXPLICITE de l'utilisateur : elle ne
 * consulte pas les portes du chien de garde. Elle reste honnête : chaque
 * mission encore suivie reçoit son arrêt, et les réservations du projet sont
 * purgées (un `.pilot/reservations.json` résiduel bloquerait les écritures).
 * @param {string} project - projet ciblé (chemin réel)
 * @returns {Promise<{released:string[], queued:number}>}
 */
export async function forceReleaseProjectRunLock(project) {
  const target = project || ".";
  const released = [];
  let queued = 0;
  for (const key of runKeysOfProject(target)) {
    const ctx = busState.runs[key];
    if (!ctx) continue;
    queued += pendingExclusivityCount(ctx);
    // RÈGLE 3 : une libération de verrou ne fait pas disparaître une session
    // sans trace écrite — même demandée explicitement, la raison reste au
    // disque (op=auto-stop, reason=force-release, detected=user-command).
    await traceAutomaticAgentStopForRun(ctx, { reason: "force-release", detected: "user-command" });
    settleMission(ctx.runKey, "stop", {});
    endRun(key, ctx.generation);
    released.push(key);
  }
  if (released.length > 0) {
    await deleteReservations(target).catch(() => {});
    console.warn("[agents-bus] verrou de run libéré à la demande :", released.join(", "));
  }
  return { released, queued };
}

// Tâche 2 (verrou fantôme) : lance les demandes en file d'exclusivité du projet
// (exclusivityQueue) qui attendaient derrière un agent fantôme/inactif. Retourne
// true si au moins une demande a été réellement lancée (la run redevient active)
// ; false si la file est vide (rien à drainer → le verrou peut être libéré).
// S'appuie sur launchNextQueued (getRunCtx(project)) qui démarre le tour de la
// demande suivante et conserve le groupe parallèle (pending préservé).
async function drainExclusivityQueues(ctx, runKeyValue) {
  // Les files d'exclusivité sont indexées par PROJET RÉEL : pour une mission de
  // LECTURE (clé `projet#read:<n>`), on draine la file du projet avec le
  // contexte de CETTE run.
  const project = ctx.project || runKeyValue;
  const queue = ctx.exclusivityQueue || {};
  const keys = Object.keys(queue);
  if (keys.length === 0) return false;
  let launched = false;
  for (const key of keys) {
    const idx = key.indexOf('\u{1f}');
    if (idx < 0) continue;
    const agentId = key.slice(idx + 1);
    if (!agentId) continue;
    if ((queue[key] || []).length > 0) {
      await launchNextQueued(agentId, project, runKeyValue);
      launched = true;
    }
  }
  return launched;
}

// Sonde « une run est-elle VRAIMENT en activité ? » : retourne true si au moins
// un agent actif de la run du projet est réellement au travail — busy = true,
// ou dernière activité plus récente que la fenêtre de grâce (2 min,
// exclusivity-queue.js). Une session vivante mais INACTIVE (parkée après
// agent_settled, oubliée, sans dernière activité exploitable) ne compte PAS :
// c'est elle qui maintenait à tort le verrou fantôme « Une run est déjà en
// cours sur ce projet ». Utilisée par releaseStuckRunLock pour distinguer une
// session fantôme/inactive d'un agent qui travaille encore.
// Fail-CLOSED (mission « libération abusive ») : en cas d'erreur de sonde, on
// retourne true → le watchdog CONSERVE le verrou (jamais de libération sur
// incertitude). Les données manquantes (session vivante sans busy ni dernière
// activité) restent, elles, traitées comme non-travailleuses (filet du verrou
// fantôme conservé).
async function anyActiveAgentWorking(project) {
  const key = resolveRunKey(project);
  const ctx = busState.runs[key];
  if (!ctx) return false;
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    return isAnyAgentWorking(sessions, Array.from(ctx.activeAgents), (id) => ctx.agentProject[id] || null, Date.now());
  } catch (e) {
    return true;
  }
}

// Issue #87 : une session du PROJET travaille-t-elle réellement ? Contrairement
// à `anyActiveAgentWorking` (scopé aux agents ACTIFS du contexte de run), cette
// sonde est scopée PROJET : elle détecte qu'un agent extérieur au contexte (run
// précédente abandonnée) travaille encore — auquel cas une demande en file
// d'attente doit continuer d'attendre au lieu d'être relancée par-dessus.
// Fail-safe (sens anti-double-run) : en cas d'erreur de sonde, on retourne true
// → le verrou est CONSERVÉ (jamais de libération sur une sonde indisponible).
async function projectHasWorkingSession(project) {
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    // `project` peut être une CLÉ DE RUN (`projet#read:N`) : on compare à la
    // session par son PROJET RÉEL, sinon la comparaison était toujours fausse et
    // une lecture légitime et active pouvait être libérée de force.
    return isProjectWorking(sessions, projectOfRunKey(project));
  } catch (_) {
    return true;
  }
}

function emit(event, data) {
  const cb = busState.callbacks[event];
  if (cb) cb(data);
}

/**
 * RÈGLE 3 (aucun arrêt automatique sans trace écrite) : journalise le motif pour
 * TOUS les agents de la run, AVANT l'arrêt effectif. Une ligne par agent actif ;
 * si la run n'a plus d'agent actif (verrou orphelin, run fantôme), une ligne
 * `agent=none` garde la raison de l'arrêt de la run elle-même. Le repli global
 * (`<app_data_dir>/agent-stops.log`) est assuré par `traceAutomaticAgentStop`
 * quand le projet est inconnu.
 * @param {object} ctx - contexte de run
 * @param {{reason:string, detected?:string}} entry - motif (reason LITTÉRAL au site)
 * @returns {Promise<void>}
 */
async function traceAutomaticAgentStopForRun(ctx, entry = {}) {
  const ids = Array.from((ctx && ctx.activeAgents) || []);
  const targets = ids.length > 0 ? ids : [null];
  for (const agentId of targets) {
    const projectPath =
      (agentId && ctx && ctx.agentProject && ctx.agentProject[agentId]) || (ctx && ctx.project) || "";
    await traceAutomaticAgentStop({
      reason: entry.reason,
      detected: entry.detected,
      agentId: agentId || "",
      projectPath,
      uid: agentId ? expectedSessionUid(ctx, agentId) : null,
    }).catch(() => {});
  }
}

/**
 * Objectif 5 (mission « libération abusive du verrou de run ») : à la fin
 * NORMALE d'une mission, l'état logique de l'agent restait « Running » en base
 * — l'observateur d'anomalie ne remettait à zéro que la map d'activité en
 * mémoire, jamais `proc_state` → l'agent était affiché « en cours » alors que
 * son processus ne travaillait plus. On repose l'état au repos (session
 * chargée : `Paused`), exactement comme l'arrêt manuel. Fail-open : un échec
 * d'écriture d'état ne doit JAMAIS casser la fin d'une run.
 * @param {string[]} agentIds - agents dont la mission vient de se terminer
 * @param {string} project - projet réel (une clé de run `projet#read:N` est
 *   ramenée à son projet).
 */
async function resetAgentsProcState(agentIds, project) {
  const realProject = projectOfRunKey(project);
  if (!realProject) return;
  for (const agentId of agentIds || []) {
    if (!agentId) continue;
    try {
      await invoke("set_agent_state", {
        agentId,
        projectPath: realProject,
        loaded: true,
        busy: false,
        procState: "Paused",
      });
    } catch (_) {
      // fail-open : jamais de régression sur la fin de run.
    }
  }
}

// ── Livraison du rapport PAR MISSION ───────────────────────────────────────
// Un sink est enregistré sous la clé de run de SA mission ; la fin de la run
// résout ce sink. Deux missions parallèles ne partagent donc plus aucune
// variable de rappel : chacune reçoit son propre rapport. Exporté pour les
// tests vitest (livraison des rapports).
/**
 * @param {string} key - clé de run (ctx.runKey)
 * @param {{onDone:function(string):void, onError:function(Error):void}} handlers
 */
export function attachMissionSink(key, handlers) {
  if (!key || !handlers) return;
  busState.missionSinks[key] = {
    onDone: handlers.onDone,
    onError: handlers.onError,
    settled: false,
  };
}

/**
 * Résout (une seule fois) le sink de la mission `key`. No-op s'il n'y a pas de
 * sink (run lancée hors assistant) ou s'il a déjà été résolu.
 * @param {string} key - clé de run (ctx.runKey)
 * @param {"done"|"error"|"stop"} kind
 * @param {{text?:string, message?:string}} [payload]
 * @returns {boolean} true si le sink vient d'être résolu
 */
export function settleMission(key, kind, payload) {
  const sink = key ? busState.missionSinks[key] : null;
  if (!sink || sink.settled) return false;
  sink.settled = true;
  delete busState.missionSinks[key];
  try {
    if (kind === "done") {
      sink.onDone((payload && payload.text) || "");
    } else if (typeof sink.onError === "function") {
      const msg =
        kind === "stop"
          ? "Run agents arrêtée."
          : (payload && payload.message) || "Erreur de la run agents.";
      sink.onError(new Error(msg));
    }
  } catch (_) {
    // fail-open : un consommateur défaillant ne doit pas casser le bus.
  }
  return true;
}

/**
 * Bug #152 : sonde l'état de la session d'un agent (pour la garde
 * d'exclusivité). Interroge `list_agent_sessions` et retourne la session
 * vivante pour cet agent — même (agent, projet) en priorité, sinon n'importe
 * quel projet par prudence (même politique de matching que
 * anyActiveAgentWorking).
 * Retourne `null` si aucune session vivante, `undefined` en cas d'erreur de
 * sonde (l'appelant applique alors la prudence : ne rien libérer).
 * @param {string} agentId
 * @param {object} ctx - contexte de run du projet
 * @returns {Promise<object|null|undefined>}
 */
async function findAgentSession(agentId, ctx) {
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    const proj = ctx.agentProject[agentId] || ctx.project || null;
    const byProject = sessions.find((s) => s.agent === agentId && s.alive && (proj === null || sameProject(s.project, proj)));
    if (byProject) return byProject;
    return sessions.find((s) => s.agent === agentId && s.alive) || null;
  } catch (e) {
    return undefined; // sonde indisponible → prudence (pas de purge)
  }
}

/**
 * Bug #152 : purge un tour fantôme — l'agent est marqué actif dans la run
 * (activeAgents) mais son processus est déjà mort (aucun agent_end ni
 * process_exit traité), OU vivant mais au repos (verrou périmé). On le retire
 * des agents actifs et on enregistre une erreur dans le groupe parallèle
 * (sinon `pending` ne descend jamais et la run reste bloquée). Ne lance PAS la
 * file d'attente ici : la demande courante démarre immédiatement
 * (isAgentActiveOnProject retourne false) et la file sera vidée à la fin de son
 * tour (launchNextQueued), ce qui évite deux runs concurrentes sur le même
 * créneau d'exclusivité.
 * @param {string} agentId
 * @param {object} ctx - contexte de run du projet
 * @param {string} [reason] - message d'erreur du groupe parallèle (défaut : mort)
 */
function purgeGhostTurn(agentId, ctx, reason) {
  ctx.activeAgents.delete(agentId);
  delete ctx.agentProject[agentId];
  if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    ctx.parallelGroup.results[agentId] = {
      status: "error",
      text: reason || `Processus de l'agent ${agentId} mort (tour fantôme purgé).`,
    };
    ctx.parallelGroup.pending--;
    // Le cas pending<=0 est géré par dispatchParallel après la boucle de lancement.
  }
}

/**
 * T5 : indique si un agent multi-rôles H2 V2 est déjà actif sur un projet donné.
 * Vérifie d'abord l'état local (agents des runs en cours), puis les sessions
 * vivantes via `list_agent_sessions` (agents de runs précédentes encore actifs).
 * Fail-open : en cas d'erreur de sonde, on ne bloque pas (prudence).
 *
 * Bug #152 : un agent « actif » localement doit TRAVAILLER RÉELLEMENT, pas
 * seulement avoir un processus vivant. S'il est fantôme (processus mort sans
 * agent_end/process_exit traité) OU vivant mais au repos (busy périmé), son tour
 * est purgé (purgeGhostTurn) et la demande courante est lancée immédiatement au
 * lieu d'être empilée derrière un agent qui ne finira jamais (faux « lancé »).
 * @param {string} agentId
 * @param {string} project
 * @returns {Promise<boolean>}
 */
async function isAgentActiveOnProject(agentId, project) {
  // 1. Local : agent déjà actif dans une run en cours sur ce projet.
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.activeAgents.has(agentId) && sameProject(ctx.project, project)) {
      const session = await findAgentSession(agentId, ctx);
      const status = classifyExclusivitySession(session);
      // Sonde indisponible : prudence, on ne libère pas (pas de double run).
      if (status === "unknown") return true;
      if (status === "ghost") {
        console.warn("[agents-bus] exclusivité : processus de l'agent", agentId, "mort → purge du tour fantôme.");
        emit("notify", { agentId, message: `⚠️ L'agent ${agentId} était bloqué (processus terminé sans retour d'état). Le créneau a été libéré et la demande démarre immédiatement.` });
        purgeGhostTurn(agentId, ctx);
        return false;
      }
      if (status === "stale") {
        console.warn("[agents-bus] exclusivité : agent", agentId, "vivant mais au repos → verrou périmé libéré.");
        emit("notify", { agentId, message: `♻️ L'agent ${agentId} était marqué actif mais ne travaillait plus (session au repos) : le créneau a été libéré et la demande démarre immédiatement.` });
        purgeGhostTurn(agentId, ctx, `L'agent ${agentId} était marqué actif mais au repos (verrou périmé libéré).`);
        return false;
      }
      return true;
    }
  }
  // 2. Sessions vivantes (agents de runs précédentes encore actifs).
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    return isAgentActiveOnProjectSessions(sessions, agentId, project);
  } catch (e) {
    return false;
  }
}

/**
 * T5 : permet au frontend (super-agent.js) d'enregistrer un callback de
 * notification pour informer l'assistant des événements de file d'attente
 * (demande en attente / démarrage). Conservé par `_runAgentsForAssistant`
 * (spread de prevCallbacks).
 * @param {function} fn - ({ agentId, message }) => void
 */
export function setBusNotifyCallback(fn) {
  busState.callbacks.notify = fn;
}

/**
 * T5 : libère le créneau (project, agent_id) quand un agent termine (ou échoue)
 * son tour. S'il y a une demande en file d'attente pour ce couple, on la lance
 * immédiatement (même agent, même projet). Elle reste dans le groupe parallèle
 * courant : `dispatchParallel` a conservé son `pending` au moment de la mise en
 * file, donc la run ne se termine pas avant que la demande en attente ne se soit
 * réellement exécutée.
 */
/**
 * C1 (relecture verrou-par-projet) : après libération du créneau
 * (project, agentId), lance AU PLUS UNE demande en file, en cherchant dans
 * TOUTES les runs du projet — pas seulement celle qui vient de finir. Sans ce
 * balayage, une demande mise en file dans une run de LECTURE (clé
 * `projet#read:<n>`) restait coincée, `launchNextQueued(agentId, project,
 * ctx.runKey)` ne regardant que la file de la run appelante.
 * `ownRunKey` (la run qui vient de libérer son tour) est essayé en premier ;
 * une seule demande est lancée pour préserver l'exclusivité du couple.
 * Reste volontairement en l'état (comportement assumé, jamais silencieux) :
 * lorsque l'agent bloquant n'émet ni `agent_end` ni `agent_settled`, la reprise
 * est RATTRAPÉE par un déclencheur extérieur — `releaseStuckRunLock` (watchdog :
 * rappelé à chaque nouvelle run et toutes les 5 min par le watchdog d'assistant) :
 * la porte « file sans porteur » (`orphanQueue`, ~60 s sans session travailleuse)
 * ou la garde de temps (`agent_timeout_ms`) DRAINE la file d'exclusivité du
 * projet au lieu de la perdre (log + notify). Preuve : `verrou-par-projet.test.js`,
 * « C1 (reste) — sans événement de fin, le watchdog relance la demande en file ».
 */
// Exporté pour les PREUVES de la RÈGLE 4 (`file-attente-regle-4.test.js`) : le
// rejeu d'une demande en file doit être déclenchable de façon déterministe.
export async function launchNextQueuedForProject(agentId, project, ownRunKey) {
  const keys = [];
  if (ownRunKey) keys.push(ownRunKey);
  for (const k of runKeysOfProject(project)) if (!keys.includes(k)) keys.push(k);
  for (const key of keys) {
    const c = busState.runs[key];
    if (!c || !c.exclusivityQueue) continue;
    const existingKey = findExclusivityKey(c.exclusivityQueue, agentId, project);
    const q = existingKey ? c.exclusivityQueue[existingKey] : null;
    if (q && q.length > 0) {
      await launchNextQueued(agentId, project, key);
      return;
    }
  }
}

async function launchNextQueued(agentId, project, runKeyOverride) {
  // `project` = projet RÉEL (clé de la file d'exclusivité) ; `runKeyOverride` =
  // clé de run appelante (celle qui vient de libérer son tour).
  const callerKey = runKeyOverride || resolveRunKey(project);
  const callerCtx = busState.runs[callerKey] || null;
  // File réellement inspectée par l'appelant (partagée dans tous les cas
  // normaux ; un contexte dont la file a été remplacée garde SA file).
  const queue = (callerCtx && callerCtx.exclusivityQueue) || exclusivityQueueOfProject(project);
  const qk = exclusivityKey(project, agentId);
  const head = (queue[qk] || [])[0];
  if (!head) return;
  // RÈGLE 4 : une entrée porte la clé de la run QUI L'A MISE EN FILE
  // (`ownerRunKey`). Sans propriétaire identifié (entrée héritée), c'est la run
  // appelante qui l'a mise en file.
  const ownerKey = head.ownerRunKey || callerKey;
  const ownerCtx = busState.runs[ownerKey];
  if (!ownerCtx) {
    // Le contexte propriétaire n'existe plus. Lancer la demande dans un AUTRE
    // contexte la ferait exécuter POUR UNE AUTRE MISSION (rapport livré à la
    // mauvaise mission, `pending` décrémenté au mauvais endroit, sink absent) :
    // c'est exactement la perte silencieuse interdite. On CONSERVE l'entrée en
    // file, on écrit le motif au journal des arrêts et on le DIT à l'utilisateur.
    if (!head.ownerMissingReported) {
      head.ownerMissingReported = true;
      const message = `⏸️ Une demande en file d'attente (agent ${agentId}) ne peut pas être relancée : la run qui l'avait mise en file n'existe plus. Elle est CONSERVÉE en file (jamais exécutée pour une autre mission).`;
      console.warn("[agents-bus] file d'attente :", message);
      traceAutomaticAgentStop({
        reason: "queue-replay-no-owner",
        detected: "queue-owner-gone",
        agentId,
        projectPath: projectOfRunKey(project),
        detail: String((head && (head.brief || head.task)) || "").slice(0, 300),
      }).catch(() => {});
      try {
        emit("notify", { agentId, message });
      } catch (_) {
        /* aucun écouteur : la console a déjà l'information */
      }
    }
    return;
  }
  const next = dequeueExclusivity(queue, agentId, project);
  if (!next) return;
  const id = next.agentId || agentId;
  const agent = busState.agents.get(id);
  if (!agent) {
    // Agent introuvable : enregistrer un résultat d'erreur dans le groupe
    // parallèle afin que la run ne reste pas bloquée (pending conservé).
    if (ownerCtx.parallelGroup && ownerCtx.parallelGroup.assignments.some((a) => a.agentId === id)) {
      ownerCtx.parallelGroup.results[id] = { status: "error", text: `Agent "${id}" introuvable.` };
      ownerCtx.parallelGroup.pending--;
    }
    return;
  }
  emit("notify", { agentId: id, message: `▶️ L'agent ${id} démarre sa tâche en file d'attente sur ce projet.` });
  // Le tour est exécuté dans le contexte PROPRIÉTAIRE de la file (celui de la
  // mission qui a mis la demande en attente) : son sink, son groupe parallèle
  // et sa génération restent les siens.
  await runAgentTurn(agent, next.brief, "", next.project || project, undefined, next.mcp_server || null, ownerCtx);
}

function resetTimeout(ctx) {
  ctx.lastActivityAt = Date.now();
  if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
  if (ctx.runState !== "running") return;
  ctx.timeoutId = setTimeout(async () => {
    // Timeout d'inactivité : on signale l'erreur puis on arrête la run SANS
    // émettre l'événement "stop" (sinon l'UI afficherait « Run arrêtée par
    // l'utilisateur. » alors que l'utilisateur n'a rien fait — issue #10).
    const agentId = ctx.currentAgentId;
    const msg = `Timeout d'inactivité pour ${agentId}. Augmentez le timeout dans Paramètres (agent_timeout_ms).`;
    emit("error", { message: msg });
    // Livraison du rapport : la mission qui a lancé la run doit recevoir cette
    // erreur, même si la relance ensuite par stopAgentsRun. Mission 310 : avant
    // d'annoncer l'échec, vérifier le DISQUE — un agent peut avoir écrit son
    // travail sans émettre d'événement pendant `agent_timeout_ms` (outil long
    // silencieux) ; l'annoncer en échec ferait relancer une mission réalisée.
    if (await workOnDiskDuringRun(ctx)) {
      settleMission(ctx.runKey, "done", {
        text: `${msg}\n\n⚠️ Run interrompue, mais du travail est PRÉSENT sur le disque (commit ou fichiers modifiés pendant l'exécution) : la mission n'est PAS un échec. Vérifiez le résultat produit au lieu de relancer la mission.`,
      });
    } else {
      settleMission(ctx.runKey, "error", { message: `${msg} Aucun travail nouveau détecté sur le disque.` });
    }
    // P7 : notification desktop à l'arrêt auto (réutilise desktop-notify.js).
    notifyAgentDone({
      title: "Pilot — Agent en timeout",
      body: `⏱️ L'agent ${agentId} est resté inactif (${Math.round(busState.timeoutMs / 1000)} s). La run a été arrêtée automatiquement.`,
    }).catch(() => {});
    // Portée CIBLÉE : le timeout d'inactivité de CETTE run ne doit jamais
    // arrêter les agents d'une autre run (autre projet, autre mission).
    // RÈGLE 3 : le motif (idle-timeout / aucune activité) est journalisé par
    // l'ENTONNOIR UNIQUE AVANT l'arrêt effectif de la run.
    stopAgentWithTrace({
      reason: "idle-timeout",
      detected: "no-event",
      agentId: agentId || "",
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
      stop: () => stopAgentsRun({ silent: true, runKey: ctx.runKey }),
    }).catch(() => {});
  }, busState.timeoutMs);
}

function ensureBudget(agentId, ctx) {
  if (ctx.budgetTotal <= 0) {
    return { ok: false, message: "Budget total d'appels épuisé." };
  }
  const agent = busState.agents.get(agentId);
  const max = agent ? agent.max_calls_per_run : 5;
  const used = ctx.budgetByAgent[agentId] || 0;
  if (used >= max) {
    return { ok: false, message: `Budget d'appels épuisé pour ${agentId}.` };
  }
  return { ok: true };
}

function consumeBudget(agentId, ctx) {
  ctx.budgetTotal -= 1;
  ctx.budgetByAgent[agentId] = (ctx.budgetByAgent[agentId] || 0) + 1;
}

function detectCycle(agentId, ctx) {
  return ctx.callStack.some((entry) => entry.agentId === agentId);
}

export async function initAgentsBus(options = {}) {
  busState.callbacks = options;
  // RÈGLE 3 : une trace d'arrêt automatique qui n'a PAS pu être écrite doit être
  // DITE (jamais de fail-open silencieux) — le rapporteur branche l'événement de
  // notification de l'interface sur le module de trace.
  setAgentStopTraceFailureReporter((message) => emit("notify", { message }));
  busState.config = await invoke("get_config").catch(() => ({}));

  busState.registry = await loadAgentRegistry();
  const rawAgents = Array.isArray(busState.registry.agents) ? busState.registry.agents : [];

  // Normaliser et indexer les agents du registre
  busState.agents = new Map();
  for (const raw of rawAgents) {
    const a = normalizeAgent(raw);
    if (a && a.id) busState.agents.set(a.id, a);
  }
  // AGENT JETABLE : les agents éphémères (rôle fourni à la volée, aucune ligne
  // en base) sont AJOUTÉS à la map après la lecture du registre persistant.
  mergeEphemeralAgentsIntoBus();

  // Coordinateur : utiliser celui du registre s'il existe, sinon le défaut
  const regCoord = busState.agents.get("coordinateur");
  if (regCoord) {
    busState.coordinator = regCoord;
  } else {
    const fallback = resolveCoordinatorFallback();
    busState.coordinator = buildDefaultCoordinator({ pi: fallback, plh: fallback });
    busState.agents.set("coordinateur", busState.coordinator);
  }

  // Charger les garde-fous depuis la config (partagés entre toutes les runs)
  busState.maxDepth = busState.config.agent_max_call_depth || DEFAULT_MAX_DEPTH;
  busState.timeoutMs = busState.config.agent_timeout_ms || DEFAULT_TIMEOUT_MS;

  // Écouter le canal unifié des agents
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  busState.listeners = await listen("rpc-event-agents", handleAgentEvent);
  // Mission 380 : balayage périodique des verrous ORPHELINS. Un agent mort sans
  // événement terminal (ou un événement ignoré parce que la run est passée en
  // `stopping` / que l'agent a quitté `activeAgents`) ne doit plus bloquer le
  // projet jusqu'au redémarrage de Pilot : le chien de garde est désormais
  // déclenché aussi sans attendre un lancement.
  startRunLockSweep();

  // T2 : écouter l'arrêt AUTOMATIQUE d'un agent délégué bloqué (émis par le
  // moniteur Rust). `stop_session` supprime l'émission `process_exit` → sans
  // cet événement, le créneau d'exclusivité (file d'attente, launchNextQueued)
  // ne serait jamais libéré. On termine le tour de l'agent via failAgentTurn
  // pour libérer le créneau et laisser un agent en attente prendre le relais.
  if (busState.autoStopListener) {
    busState.autoStopListener();
    busState.autoStopListener = null;
  }
  busState.autoStopListener = await listen("agent-auto-stopped", async (ev) => {
    const p = ev.payload || {};
    const agentId = p.agent;
    if (!agentId) return;
    // Router vers le contexte de run du projet concerné.
    let ctx = null;
    for (const key of Object.keys(busState.runs)) {
      if (busState.runs[key].activeAgents.has(agentId)) { ctx = busState.runs[key]; break; }
    }
    if (!ctx || ctx.runState !== "running") {
      // RÈGLE 3 : même quand la run n'est plus retrouvée (ctx introuvable ou run
      // déjà arrêtée), l'arrêt AUTOMATIQUE ne disparaît pas en silence : sa
      // raison est écrite au disque (repli global si le projet est inconnu).
      console.warn("[agents-bus] arrêt automatique hors run active :", agentId, p.reason || "");
      traceAutomaticAgentStop({
        reason: "auto-stop-rust",
        detected: "anomaly-monitor",
        agentId,
        projectPath: p.project || "",
        uid: null,
      }).catch(() => {});
      return;
    }
    const reason = p.reason || "arrêt automatique (bloqué sans progression)";
    console.warn("[agents-bus] arrêt automatique de l'agent", agentId, reason);
    // RÈGLE 3 : la raison de l'arrêt automatique est écrite AVANT l'arrêt
    // effectif (failAgentTurn libère le créneau).
    await traceAutomaticAgentStop({
      reason: "auto-stop-rust",
      detected: "anomaly-monitor",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
    }).catch(() => {});
    emit("notify", {
      agentId,
      message: `⏱️ L'agent ${agentId} a été arrêté automatiquement : ${reason}. Un agent en file d'attente peut prendre le relais.`,
    });
    // Restitution fiable : la cause (bloqué sans progression / timeout) est
    // propagée au résultat agrégé visible de l'utilisateur et de l'assistant.
    failAgentTurn(agentId, `Agent arrêté automatiquement : ${reason}`, ctx);
  });

  // Tâche 4 (verrou fantôme) : écouter la libération busy-stale côté Rust.
  // `agent-stale-busy-released` est émis par le moniteur d'anomalie quand une
  // session reste busy (process pi figé) sans progression depuis STALE_BUSY_GRACE
  // — même quand l'arrêt auto est désactivé. Le process n'est PAS tué (kill = T2) :
  // on termine juste le tour (failAgentTurn) pour libérer le créneau
  // d'exclusivité + la file (launchNextQueued).
  if (busState.staleBusyListener) {
    busState.staleBusyListener();
    busState.staleBusyListener = null;
  }
  busState.staleBusyListener = await listen("agent-stale-busy-released", async (ev) => {
    const p = ev.payload || {};
    const agentId = p.agent;
    if (!agentId) return;
    let ctx = null;
    for (const key of Object.keys(busState.runs)) {
      if (busState.runs[key].activeAgents.has(agentId)) { ctx = busState.runs[key]; break; }
    }
    if (!ctx || ctx.runState !== "running") {
      // RÈGLE 3 : libération busy-stale hors run active → le motif reste au
      // disque (aucun arrêt automatique ne disparaît sans trace).
      console.warn("[agents-bus] busy-stale hors run active pour l'agent", agentId);
      traceAutomaticAgentStop({
        reason: "busy-stale-release",
        detected: "stale-busy",
        agentId,
        projectPath: p.project || "",
        uid: null,
      }).catch(() => {});
      return;
    }
    console.warn("[agents-bus] busy-stale libéré pour l'agent", agentId);
    // RÈGLE 3 : le motif est écrit AVANT la libération effective du créneau.
    await traceAutomaticAgentStop({
      reason: "busy-stale-release",
      detected: "stale-busy",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
    }).catch(() => {});
    emit("notify", {
      agentId,
      message: `🧹 L'agent ${agentId} était marqué actif sans progression (process figé). Le créneau et les demandes en file ont été libérés.`,
    });
    failAgentTurn(agentId, "Agent marqué actif sans progression (busy-stale), créneau libéré.", ctx);
  });

  // T6-fix (fuite 2) : les réservations sont suivies en MÉMOIRE seule
  // (reservedProjects) → après un rechargement de la webview, plus aucun
  // nettoyage n'est possible et le fichier .pilot/reservations.json résiduel
  // bloquerait silencieusement les écritures. À l'init du bus, purger le
  // résiduel éventuel du projet actif — SAUF si une run est en cours sur ce
  // projet (ses réservations sont actives, pas résiduelles). Fire-and-forget,
  // fail-open : ne jamais bloquer l'init.
  try {
    const activeProject = (typeof window !== "undefined" && window._pilotProjectPath) || "";
    if (activeProject && !isRunInProgress(activeProject)) {
      deleteReservations(activeProject).catch(() => {});
    }
  } catch (_) {
    // fail-open : la purge au démarrage ne doit jamais casser l'init
  }
}

/**
 * AGENT JETABLE : ajoute les agents éphémères vivants à `busState.agents`.
 *
 * Appelée après CHAQUE lecture du registre persistant (init et rechargement) :
 * sans elle, l'agent jetable enregistré pour la mission en cours disparaîtrait
 * de la map et le bus le déclarerait « inconnu » avant même de le lancer.
 * Les identifiants du registre ne sont jamais écrasés (préfixe `eph-` réservé).
 */
function mergeEphemeralAgentsIntoBus() {
  const ephemeral = listEphemeralAgents();
  if (!ephemeral.length || !busState.agents) return;
  for (const raw of ephemeral) {
    const a = normalizeAgent(raw);
    if (a && a.id && !busState.agents.has(a.id)) {
      busState.agents.set(a.id, { ...a, ephemeral: true, visible: false });
    }
  }
}

/**
 * Recharge la map des agents depuis le registre persistant (P4).
 * Le bus ne charge le registre qu'à l'init ; un agent créé entre-temps (ex:
 * create_agent de l'assistant) ne serait pas visible dans run_agents. On
 * re-synchronise donc la map (et le coordinateur) avant chaque run.
 */
async function reloadAgentsRegistry() {
  busState.registry = await loadAgentRegistry();
  const rawAgents = Array.isArray(busState.registry.agents) ? busState.registry.agents : [];
  busState.agents = new Map();
  for (const raw of rawAgents) {
    const a = normalizeAgent(raw);
    if (a && a.id) busState.agents.set(a.id, a);
  }
  // AGENT JETABLE : une relecture du registre PERSISTANT ne doit pas faire
  // disparaître un agent éphémère déjà enregistré pour la mission en cours
  // (sinon `run_agents` le déclarerait « inconnu » juste avant de le lancer).
  mergeEphemeralAgentsIntoBus();
  const regCoord = busState.agents.get("coordinateur");
  if (regCoord) {
    busState.coordinator = regCoord;
  } else {
    const fallback = resolveCoordinatorFallback();
    busState.coordinator = buildDefaultCoordinator({ pi: fallback, plh: fallback });
    busState.agents.set("coordinateur", busState.coordinator);
  }
}

function resolveCoordinatorFallback() {
  // Le modèle du coordinateur se règle uniquement via l'éditeur d'agents (onglet 🎭).
  // En cas de coordinateur absent du registre (chemin défensif), on retourne "".
  // ⚠️ pi n'utilise PAS le defaultModel du model-switch.json en mode RPC : sans
  // set_model explicite, pi retombe sur son modèle interne par défaut (ex:
  // huggingface/Kimi-K2.6) qui peut renvoyer 402 « credits depleted ». C'est le
  // bus (runAgentTurn) qui doit appliquer le defaultModel comme fallback quand
  // un agent n'a pas de modèle configuré (voir resolveEffectiveModel +
  // ensureFallbackModel ci-dessous).
  return "";
}

/**
 * Pure (testable) : résout le modèle EFFECTIF d'un agent pour le backend actif.
 * D'abord le modèle configuré de l'agent (resolveAgentModel) ; s'il est vide,
 * on retombe sur `fallbackModel` (ex: defaultModel lu du model-switch.json).
 * Retourne "" si aucun modèle n'est disponible — le caller doit alors faire
 * échouer le tour explicitement (voir runAgentTurn).
 * @param {object} agent - agent normalisé (avec .models.{pi,plh})
 * @param {string} backend - "pi" | "plh" | "unknown"
 * @param {string} fallbackModel - defaultModel du model-switch.json ("" si aucun)
 * @returns {string} "provider/modelId" ou ""
 */
export function resolveEffectiveModel(agent, backend, fallbackModel) {
  const resolved = resolveAgentModel(agent, backend, "");
  if (resolved) return resolved;
  return (typeof fallbackModel === "string" ? fallbackModel : "").trim();
}

/**
 * Point de suivi 331 — décrit le REPLI de modèle d'un tour d'agent pour le
 * rendre VISIBLE (message utilisateur + journal) au lieu de le subir en
 * silence. Le repli se produit quand l'agent n'a aucun modèle réglé pour le
 * backend actif : Pilot emploie alors le modèle réglé pour l'autre moteur
 * (repli croisé), sinon le `defaultModel` du registre de modèles.
 *
 * PURE (testable) : aucun accès IPC.
 * @param {object} agent - agent normalisé (avec .models.{pi,plh})
 * @param {string} backend - "pi" | "plh" | "unknown"
 * @param {string} fallbackModel - defaultModel du model-switch.json ("" si aucun)
 * @returns {{model: string, fallback: boolean, source: "agent"|"cross"|"default"|"none", message: string}}
 */
export function describeModelFallback(agent, backend, fallbackModel) {
  const models = agent && agent.models && typeof agent.models === "object" ? agent.models : {};
  const own = typeof models[backend] === "string" ? models[backend].trim() : "";
  const other = backend === "pi" ? "plh" : "pi";
  const cross = typeof models[other] === "string" ? models[other].trim() : "";
  const model = resolveEffectiveModel(agent, backend, fallbackModel);
  const name = agent && agent.id ? agent.id : "?";
  if (!model) return { model: "", fallback: false, source: "none", message: "" };
  if (own && own === model) return { model, fallback: false, source: "agent", message: "" };
  if (cross && cross === model) {
    return {
      model,
      fallback: true,
      source: "cross",
      message: `⚠️ Modèle : l'agent « ${name} » n'a pas de modèle pour ce moteur — repli sur « ${model} » (modèle de l'autre moteur).`,
    };
  }
  return {
    model,
    fallback: true,
    source: "default",
    message: `⚠️ Modèle : l'agent « ${name} » n'a aucun modèle réglé — repli sur le modèle par défaut « ${model} ».`,
  };
}

/**
 * T5 — niveau de réflexion voulu d'un agent, chaîne de priorité du plan :
 *   1. niveau de l'agent du registre pour le backend actif (repli croisé pi ↔ plh) ;
 *   2. réglage général de Pilot (`default_thinking_level`, T6) ;
 *   3. "" → les étages suivants (défaut par modèle / défaut moteur de pi) ne sont
 *      pas gérés par Pilot : on n'envoie rien et pi garde son défaut.
 * PURE (testable) : aucun accès IPC.
 * @returns {string} clé de niveau ou "" si aucun réglage.
 */
export function resolveWantedThinkingLevel(agent, backend, generalLevel) {
  return (
    pickThinkingLevel([
      resolveAgentThinking(agent, backend),
      typeof generalLevel === "string" ? generalLevel.trim() : "",
    ]) || ""
  );
}

/**
 * T5 — applique le niveau de réflexion après le `set_model` d'un spawn (même
 * séquence que côté Rust, T4 : get_available_thinking_levels → ramenage →
 * set_thinking_level).
 *
 * La **session vivante est l'autorité** sur les niveaux supportés : la liste est
 * toujours demandée au moteur, jamais codée en dur. Le réglage enregistré n'est
 * jamais réécrit par un ramenage (§5.3 du plan) : seul le niveau *effectif* de la
 * session change ; revenir à un modèle plus capable restitue le niveau voulu.
 *
 * Fail-open : toute erreur (backend sans la commande RPC, timeout, refus) est
 * tracée et n'empêche jamais la suite du run.
 * @returns {Promise<{requested: string, level: string|null, available: string[], error?: string}>}
 */
export async function applyAgentThinkingLevel(agent, backend, project, generalLevel = "", ctx = null) {
  const requested = resolveWantedThinkingLevel(agent, backend, generalLevel);
  const outcome = { requested, level: null, available: [] };
  // Aucun réglage : ne rien envoyer (pi garde son propre défaut) — zéro régression.
  if (!requested) return outcome;
  let available;
  try {
    available = await invoke("get_agent_process_thinking_levels", { agentId: agent.id, project });
  } catch (e) {
    console.warn(`[agents-bus] niveaux de réflexion indisponibles pour ${agent.id} :`, e);
    outcome.error = String(e);
    return outcome;
  }
  outcome.available = Array.isArray(available) ? available : [];
  const level = clampThinkingLevel(requested, outcome.available);
  if (!level) {
    console.warn(
      `[agents-bus] aucun niveau applicable pour ${agent.id} (voulu : « ${requested} ») — le moteur garde son défaut.`,
    );
    outcome.error = "aucun niveau applicable";
    return outcome;
  }
  try {
    await invoke("set_agent_process_thinking_level", { agentId: agent.id, level, project });
    outcome.level = level;
  } catch (e) {
    console.warn(`[agents-bus] set_thinking_level refusé pour ${agent.id} :`, e);
    outcome.error = String(e);
    return outcome;
  }
  // Mémoire de session (affichage + comparaison au prochain changement de modèle).
  if (ctx && typeof ctx === "object") {
    ctx.thinkingLevel = outcome.level;
    ctx.thinkingLevelRequested = requested;
  }
  // Le ramenage est signalé à l'utilisateur : sans message, un niveau abaissé
  // serait invisible donc incompréhensible (§5.4 du plan).
  if (outcome.level !== requested) {
    console.warn(
      `[agents-bus] niveau de réflexion ajusté : « ${requested} » → « ${outcome.level} » (maximum du modèle ${agent.id}).`,
    );
  }
  return outcome;
}

/**
 * Lit le `defaultModel` du model-switch.json du backend actif, puis de l'autre
 * backend en fallback. Fail-open : en cas d'erreur de lecture IPC, retourne "".
 * @returns {Promise<string>}
 */
async function readDefaultModel() {
  const backend = backendKind();
  const stems = [];
  if (backend && backend !== "unknown") stems.push(backend);
  stems.push(backend === "pi" ? "plh" : "pi");
  for (const stem of stems) {
    try {
      const cfg = await invoke("read_model_aliases", { stem });
      const dm = cfg && typeof cfg.defaultModel === "string" ? cfg.defaultModel.trim() : "";
      if (dm) return dm;
    } catch (e) {
      console.warn("[agents-bus] read_model_aliases échoué pour", stem, e);
    }
  }
  return "";
}

/**
 * Résout (et cache) le modèle de secours pour la run : une seule lecture du
 * model-switch.json par run (coût d'un appel IPC), partagée entre tous les
 * agents de la même run. `ctx.fallbackModel` : `undefined` = non résolu,
 * `""` = résolu mais vide, sinon la valeur du defaultModel.
 * @param {object} ctx - contexte de run du projet
 * @returns {Promise<string>}
 */
async function ensureFallbackModel(ctx) {
  if (ctx.fallbackModel !== undefined) return ctx.fallbackModel;
  ctx.fallbackModel = await readDefaultModel();
  return ctx.fallbackModel;
}

export function destroyAgentsBus() {
  // Mission 380 : le balayage périodique ne doit pas survivre au bus (protégé
  // par `verrou-orphelin.test.js` PREUVE 6).
  stopRunLockSweep();
  for (const key of Object.keys(busState.runs)) {
    const ctx = busState.runs[key];
    if (ctx.timeoutId) clearTimeout(ctx.timeoutId);
  }
  if (busState.listeners) {
    busState.listeners();
    busState.listeners = null;
  }
  if (busState.autoStopListener) {
    busState.autoStopListener();
    busState.autoStopListener = null;
  }
  if (busState.staleBusyListener) {
    busState.staleBusyListener();
    busState.staleBusyListener = null;
  }
  stopAllAgentProcesses();
  clearAllRuns();
}

// Filet de sécurité par agent (en dernier recours) : la vraie boucle d'outils
// est détectée en amont par maybeDetectAgentLoop. Ce compteur laisse de la
// marge aux agents qui font beaucoup de tool calls légitimes sans les couper à
// tort (le compteur global partagé les coupait dès 40 en run parallèle).
// Valeur par défaut 200 tours pi par agent (paramétrable via la config
// `agent_max_turns` dans les réglages).
const DEFAULT_MAX_PI_TURNS_PER_AGENT = 200;
const MAX_TURNS = 50;

/**
 * Issue #37 : détecte une boucle dans la réflexion d'un sous-agent et, le cas
 * échéant, arrête son processus (abort) pour renvoyer ensuite une demande de
 * correction à l'agent_end. Appelé sur chaque text_delta (throttlé).
 * @param {string} agentId
 * @param {object} ctx - contexte de run du projet
 */
function maybeDetectAgentLoop(agentId, ctx) {
  if (ctx.runState !== "running") return;
  if (ctx.loopCorrectionPending[agentId]) return; // déjà en cours
  if (ctx.loopAbandoned[agentId]) return; // déjà abandonné

  const now = Date.now();
  if (now - (ctx.loopLastChecked[agentId] || 0) < AGENT_LOOP_CHECK_INTERVAL_MS) return;
  ctx.loopLastChecked[agentId] = now;

  // Issue #10 : la détection d'une boucle d'OUTILS (detectRepeatedToolCalls) est
  // indépendante de la longueur du buffer texte. Un agent qui répète la même
  // requête DB (db_query/db_execute) sans streamer de texte ne remplit pas
  // forcément AGENT_LOOP_BUFFER_MIN → on vérifie les tool calls AVANT le garde
  // de longueur du buffer texte, sinon la boucle d'outils n'est jamais détectée.
  // Issue #35 : on combine detectRepeatedToolCalls (3 appels IDENTIQUES
  // CONSÉCUTIFS) et detectRepeatedActions (fenêtre glissante : une même action
  // répétée, pas besoin de consécutivité) pour couvrir les deux formes de boucle
  // d'outils. Un agent qui enchaîne la même commande bash MUTATRICE est arrêté
  // dès 5 occurrences dans les 20 dernières actions.
  //
  // DÉCISION « une lecture n'est JAMAIS un motif d'arrêt automatique » :
  // l'historique de LECTURE (`ctx.readOnlyToolCallsByAgent` — lectures
  // d'outils read/search/grep… ET commandes shell consultatives) n'est plus
  // examiné ici. Il reste alimenté pour l'observabilité, mais aucune répétition
  // de lecture ne peut plus arrêter un agent : deux runs de codeur ont été tuées
  // par ce seuil alors qu'elles relançaient `git status --short` / `git diff`
  // entre deux corrections légitimes. Seules les actions qui MODIFIENT
  // (edit/write/patch, bash mutateur, outil inconnu) fondent encore un arrêt.
  if (
    detectRepeatedToolCalls(ctx.toolCallsByAgent[agentId]) ||
    detectRepeatedActions(ctx.toolCallsByAgent[agentId])
  ) {
    ctx.loopCorrectionPending[agentId] = true;
    ctx.loopCorrectionCount[agentId] = (ctx.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle d'outils détectée", agentId);
    // Bug : propager la cause réelle (boucle d'outils) au résultat agrégé —
    // l'abort qui suit tue le process et le process_exit serait muet sinon.
    ctx.loopAbortReason[agentId] = "boucle d'outils détectée (appels identiques répétés)";
    // Motif journalisé sur disque (fail-open) : la cause de l'arrêt automatique
    // ne reste plus en mémoire seulement.
    emit("notify", { agentId, message: `Boucle d'outils détectée pour l'agent ${agentId} (appels identiques répétés). Correction automatique…` });
    // ENTONNOIR UNIQUE : le motif est journalisé AVANT l'arrêt (même garde
    // `expectedUid` que l'arrêt historique, portée identique).
    stopAgentWithTrace({
      reason: "loop-detection",
      detected: "tool-calls",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
      stop: () => invoke("abort_agent_process", { agentId, project: ctx.agentProject[agentId] || ctx.project || null, expectedUid: expectedSessionUid(ctx, agentId) }),
    }).catch(() => {});
    return;
  }

  const text = ctx.streamingTextByAgent[agentId] || "";
  if (text.length < AGENT_LOOP_BUFFER_MIN) return;

  if (
    detectRepeatedBlock(text) ||
    detectRepeatedWord(text) ||
    detectSemanticLoop(text)
  ) {
    ctx.loopCorrectionPending[agentId] = true;
    ctx.loopCorrectionCount[agentId] = (ctx.loopCorrectionCount[agentId] || 0) + 1;
    console.warn("[agents-bus] boucle détectée", agentId);
    // Bug : propager la cause réelle (boucle de réflexion) au résultat agrégé.
    ctx.loopAbortReason[agentId] = "boucle de réflexion détectée (texte répété)";
    emit("notify", { agentId, message: `Boucle détectée dans la réflexion de l'agent ${agentId}. Correction automatique…` });
    // ENTONNOIR UNIQUE : motif journalisé AVANT l'arrêt (règle 3).
    stopAgentWithTrace({
      reason: "loop-detection",
      detected: "text",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
      stop: () => invoke("abort_agent_process", { agentId, project: ctx.agentProject[agentId] || ctx.project || null, expectedUid: expectedSessionUid(ctx, agentId) }),
    }).catch(() => {});
  }
}

/**
 * Erreurs pi non silencieuses (bug : agents sans modèle → 402 credits depleted
 * en silence). pi peut émettre un message (event "message" ou "message_end")
 * avec `stopReason === "error"` + `errorMessage`. On émet une notification + une
 * erreur visibles (nom de l'agent + message parlant) puis on fait échouer le
 * tour de CET agent via failAgentTurn (libère le créneau d'exclusivité et
 * décrémente le groupe parallèle) SANS arrêter la run : les autres agents
 * actifs continuent. Retourne true si une erreur a été traitée.
 * @param {string} agentId
 * @param {object} msg - event.message (peut être null/undefined)
 * @param {object} ctx - contexte de run du projet
 * @returns {boolean}
 */
function handleAgentMessageError(agentId, msg, ctx) {
  if (!msg || msg.stopReason !== "error" || !msg.errorMessage) return false;
  const raw = String(msg.errorMessage);
  // Point de suivi 344 (b) : une INTERRUPTION (abort du moteur) n'est pas une
  // erreur du modèle. On n'affiche jamais le texte technique du moteur
  // (« This operation was aborted ») : le message simple et complet (ce qui
  // s'est passé + devenir du travail déjà fait) est produit en fin de tour par
  // failAgentTurn, après vérification du disque.
  const interrupted = /abort/i.test(raw);
  if (interrupted) ctx.interruptedRunByAgent[agentId] = true;
  const friendly = interrupted
    ? null
    : raw === "Connection error."
      ? "erreur de connexion, vérifiez votre connexion à l'API"
      : raw;
  const message = interrupted
    ? `L'agent ${agentId} a été interrompu avant la fin de son travail.`
    : `L'agent ${agentId} : le modèle a répondu une erreur — ${friendly}`;
  console.error("[agents-bus] message error", agentId, raw);
  emit("notify", { agentId, message });
  // Restitution fiable : on NE fait PAS échouer le tour immédiatement. pi se
  // relance automatiquement sur une erreur transitoire (402/429/réseau) —
  // l'agent_end qui suit porte alors willRetry=true et le vrai travail est
  // produit après la relance. On garde l'erreur en attente : annulée si une
  // relance suit (auto_retry_start), prononcée à l'agent_end final sinon
  // (comportement historique préservé, différé de quelques ms).
  ctx.pendingErrorByAgent[agentId] = message;
  return true;
}

// Résout le contexte de run d'un événement agent. Le payload porte désormais le
// projet (rpc_manager.rs) → on route vers busState.runs[project]. Fallback :
// on cherche le contexte dont l'agent est actif (rétrocompat).
function runCtxForEvent(payload) {
  const project = payload && payload.project;
  const agentId = payload && payload.agent_id;
  if (!agentId) return null;
  // 1. Contexte où CET agent est actif sur le projet de l'événement : une
  //    mission de LECTURE a une clé de run distincte de la clé par défaut du
  //    projet, donc `runs[payload.project]` ne suffit plus.
  if (project) {
    for (const key of runKeysOfProject(project)) {
      const ctx = busState.runs[key];
      if (ctx && ctx.activeAgents.has(agentId)) return ctx;
    }
  }
  // 2. Rétrocompat : n'importe quelle run où l'agent est actif.
  for (const key of Object.keys(busState.runs)) {
    if (busState.runs[key].activeAgents.has(agentId)) return busState.runs[key];
  }
  return null;
}

/**
 * Traite un événement RPC d'agent (payload pi : { project, agent_id, event }).
 * Exporté pour les tests vitest (restitution fiable fin-de-run : willRetry,
 * agent_settled, erreurs différées) et pour la sonde de diagnostic.
 */
export function handleAgentEvent(ev) {
  const payload = ev.payload || {};
  const agentId = payload.agent_id;
  const event = payload.event || {};
  if (!agentId) return;

  // Router vers le contexte de run du bon projet (T1) : le même agent_id peut
  // tourner en parallèle sur des projets différents.
  const ctx = runCtxForEvent(payload);
  // Ignorer les événements d'agents qui ne sont pas actifs (séquentiel : un seul
  // agent actif ; parallèle : plusieurs agents actifs simultanément).
  if (!ctx || !ctx.activeAgents.has(agentId)) return;
  if (ctx.runState !== "running") return;

  const type = event.type;
  resetTimeout(ctx);

  if (type === "turn_start") {
    // Compteur de tours pi PAR AGENT (pas global) : en run parallèle, chaque
    // agent a son propre budget. Un agent qui enchaîne des turn_start légitimes
    // (ex: plusieurs tool calls) ne doit pas être coupé à cause des tours des
    // autres agents. La vraie boucle d'outils est détectée en amont par
    // maybeDetectAgentLoop (detectRepeatedToolCalls / detectRepeatedActions) ;
    // ce compteur n'est qu'un filet de sécurité en dernier recours.
    const count = (ctx.piTurnCountByAgent[agentId] || 0) + 1;
    ctx.piTurnCountByAgent[agentId] = count;
    const maxTurns = busState.config.agent_max_turns || DEFAULT_MAX_PI_TURNS_PER_AGENT;
    if (count > maxTurns) {
      console.error("[agents-bus] MAX_PI_TURNS exceeded", agentId, count, "max", maxTurns);
      emit("error", { message: `L'agent ${agentId} a fait ${count} tours pi sans terminer (max ${maxTurns}). Arrêt forcé.` });
      // RÈGLE 3 : motif tracé par l'ENTONNOIR UNIQUE (plafond de tours pi,
      // détecté par le compteur de tours) AVANT l'arrêt effectif.
      stopAgentWithTrace({
        reason: "turn-cap",
        detected: "pi-turns",
        agentId,
        projectPath: ctx.agentProject[agentId] || ctx.project || "",
        uid: expectedSessionUid(ctx, agentId),
        stop: () => stopAgentsRun({ silent: true, runKey: ctx.runKey }),
      }).catch(() => {});
      return;
    }
  }

  if (type === "agent_start") {
    // Restitution fiable : le tour de CET agent démarre réellement DANS cette run
    // (les événements terminaux qui suivent nous concernent). Un agent_end /
    // agent_settled reçu AVANT tout agent_start pour cet agent est un événement
    // PÉRIMÉ de la run précédente (session processus réutilisée, cross-talk) :
    // settleAgentTurn le rejettera grâce à ce marqueur.
    ctx.startedByAgent[agentId] = true;
    return;
  }

  // Log minimal : seulement les événements clés (pas chaque delta)
  if (type !== "message_update" && type !== "tool_execution_update") {
    console.log("[agents-bus] event", type, "agent=" + agentId, "turn=" + ctx.turnCount);
  }

  if (type === "message_update") {
    const delta = event.assistantMessageEvent || {};
    console.log("[agents-bus] delta type=" + delta.type, agentId, delta.type === "text_delta" ? ("len=" + (delta.delta||"").length) : "");
    // Filtre anti-pollution (§3.4) : pendant une compaction, plh stream le
    // résumé en text_delta. Ce texte n'est PAS la réponse de l'agent — il ne
    // doit pas être accumulé dans streamingText (utilisé pour parser `[[CALL]]`
    // via parseCallMarker) ni affiché comme une réponse. On ignore donc tous
    // les deltas pendant isCompacting (même logique qu'agent-pi.js).
    if (ctx.isCompacting) {
      // deltas ignorés (résumé de compaction)
    } else if (delta.type === "text_delta" && typeof delta.delta === "string") {
      ctx.streamingTextByAgent[agentId] = (ctx.streamingTextByAgent[agentId] || "") + delta.delta;
      emit("delta", { agentId, text: delta.delta });
      // Issue #37 : détection de boucle dans la réflexion du sous-agent.
      maybeDetectAgentLoop(agentId, ctx);
    }
  } else if (type === "message" || type === "message_end") {
    // L'event "message" (non streamé) ou "message_end" (streamé) apporte le
    // message assistant COMPLET (role, stopReason, content). Le texte utile est
    // déjà streamé via message_update/text_delta ci-dessus et accumulé dans
    // streamingText ; on ne le réaccumule pas ici (doublerait le rendu).
    // ⚠️ Erreurs pi non silencieuses : pi peut émettre un message avec
    // stopReason === "error" + errorMessage (ex: 402 « credits depleted » quand
    // l'agent retombe sur le modèle interne par défaut). Sans cette branche, le
    // tour échouait en silence (agent_end sans travail, résultat vide) et la run
    // restait bloquée. On émet une notification visible (nom de l'agent +
    // message) et on garde l'erreur EN ATTENTE : si pi se relance tout seul
    // (auto_retry_start), elle est annulée et la run continue ; sinon elle est
    // prononcée à l'agent_end final (settleAgentTurn → failAgentTurn).
    if (handleAgentMessageError(agentId, event.message, ctx)) return;
  } else if (type === "compaction_start") {
    // Activer le filtre des deltas : pendant la compaction, le résumé est
    // streamé en text_delta (plh). On le signale à l'UI mais on n'accumule pas.
    console.log("[agents-bus] compaction_start", agentId, "reason=" + (event.reason || "?"));
    ctx.isCompacting = true;
  } else if (type === "compaction_end" || type === "compaction") {
    // Désactiver le filtre et reset streamingText : la compaction est terminée,
    // la vraie réponse de l'agent (post-compaction) doit repartir proprement.
    // On n'accumule pas le résumé pour ne pas polluer parseCallMarker.
    console.log("[agents-bus] compaction_end", agentId);
    ctx.isCompacting = false;
    ctx.streamingTextByAgent[agentId] = "";
    ctx.toolCallsByAgent[agentId] = [];
    ctx.readOnlyToolCallsByAgent[agentId] = [];
  } else if (type === "tool_execution_start") {
    const toolName = event.toolName || event.tool || "outil";
    console.log("[agents-bus] tool:", toolName, "agent=" + agentId);
    emit("toolStart", { agentId, toolName });
    // Issue #10 : accumuler une empreinte du tool call (ex: requête DB) pour
    // détecter une boucle d'OUTILS identiques, même sans texte streamé répété.
    // P0-2 / RÈGLE 2 : un appel de LECTURE (outil de lecture pure, ou commande
    // shell PROUVÉE consultative — git status/diff/log, ls, cat, rg, sed -n…) ne
    // peut JAMAIS fonder un arrêt : il rejoint l'historique de lecture
    // (observabilité seule). Seules les actions qui MODIFIENT sont comptées.
    const toolArgs = event.args || event.arguments || {};
    if (isReadOnlyAgentToolCall(toolName, toolArgs)) {
      pushReadOnlyToolCall(agentId, ctx, buildToolLoopFingerprint(toolName, toolArgs));
      maybeDetectAgentLoop(agentId, ctx);
      return;
    }
    const fp = buildToolLoopFingerprint(toolName, toolArgs);
    const arr = (ctx.toolCallsByAgent[agentId] = ctx.toolCallsByAgent[agentId] || []);
    // Issue #35 : on accumule CHAQUE empreinte (pas de déduplication des
    // consécutives identiques). L'ancienne déduplication effondrait une séquence
    // de N commandes bash identiques en UNE seule entrée → detectRepeatedToolCalls
    // (3 consécutives) et detectRepeatedActions (5 dans une fenêtre) ne pouvaient
    // JAMAIS se déclencher, laissant un agent enchaîner ~46 tours sans détection
    // ni arrêt (incidents #4/#8/#9, issue #35). On borne la fenêtre pour éviter
    // une croissance illimitée.
    arr.push(fp);
    if (arr.length > 40) arr.splice(0, arr.length - 40);
    maybeDetectAgentLoop(agentId, ctx);
  } else if (type === "extension_ui_request") {
    handleExtensionUiRequest(agentId, event, ctx);
  } else if (type === "agent_end") {
    // Issue #37 : si cet agent a été arrêté pour boucle, on le relance avec une
    // demande de correction au lieu de terminer son tour (reste actif). Escalade
    // adaptative : jusqu'à MAX_LOOP_ESCALATION stratégies, puis abandon.
    if (ctx.loopCorrectionPending[agentId]) {
      ctx.loopCorrectionPending[agentId] = false;
      // La correction est envoyée (l'agent continue) : la cause de boucle ne
      // doit plus être propagée à un éventuel process_exit ultérieur (genuine).
      delete ctx.loopAbortReason[agentId];
      const streamed = ctx.streamingTextByAgent[agentId] || "";
      ctx.streamingTextByAgent[agentId] = "";
      ctx.toolCallsByAgent[agentId] = [];
      ctx.readOnlyToolCallsByAgent[agentId] = [];
      ctx.piTurnCountByAgent[agentId] = 0; // c'est une continuation du tour, pas un nouveau tour
      resetTimeout(ctx);
      const count = ctx.loopCorrectionCount[agentId] || 0;
      if (count < MAX_LOOP_ESCALATION) {
        const level = count; // 1..MAX_LOOP_ESCALATION (déjà incrémenté à la détection)
        const repeatedTail = findRepeatedTail(streamed);
        const correction = buildLoopCorrectionPrompt(level, { repeatedTail });
        sendPromptToAgent(agentId, correction, ctx).catch((e) => {
          console.error("[agents-bus] erreur envoi correction boucle", agentId, e);
          // RÈGLE 3 : une session qui s'éteint sur cette erreur laisse une trace
          // de son motif (avant l'échec prononcé, jamais après).
          traceAutomaticAgentStop({
            reason: "session-error",
            detected: "correction-send-error",
            agentId,
            projectPath: ctx.agentProject[agentId] || ctx.project || "",
            uid: expectedSessionUid(ctx, agentId),
          }).catch(() => {});
          failAgentTurn(agentId, String(e), ctx);
        });
      } else {
        ctx.loopAbandoned[agentId] = true;
        emit("notify", { agentId, message: `⚠️ L'agent ${agentId} a tourné en boucle plusieurs fois. Tâche abandonnée.` });
        traceAutomaticAgentStop({
          reason: "loop-detection",
          detected: "text-escalation-exhausted",
          agentId,
          projectPath: ctx.agentProject[agentId] || ctx.project || "",
          uid: expectedSessionUid(ctx, agentId),
        }).catch(() => {});
        failAgentTurn(agentId, "Boucle de réflexion persistante (toutes les stratégies d'escalade épuisées).", ctx);
      }
      return;
    }
    ctx.turnCount++;
    ctx.piTurnCountByAgent[agentId] = 0;
    console.log("[agents-bus] agent_end turn=" + ctx.turnCount, agentId);
    if (ctx.turnCount > MAX_TURNS) {
      emit("error", { message: `Boucle détectée : ${ctx.turnCount} tours (max ${MAX_TURNS}). Arrêt forcé.` });
      // ENTONNOIR UNIQUE : une seule ligne (motif + arrêt de la run), jamais de
      // double trace (l'ancienne trace locale est remplacée par celle-ci).
      stopAgentWithTrace({
        reason: "loop-detection",
        detected: "turn-cap",
        agentId,
        projectPath: ctx.agentProject[agentId] || ctx.project || "",
        uid: expectedSessionUid(ctx, agentId),
        stop: () => stopAgentsRun({ silent: true, runKey: ctx.runKey }),
      }).catch(() => {});
      return;
    }
    // Restitution fiable : `agent_end` est un événement PAR RUN BAS NIVEAU —
    // pi peut émettre un agent_end avec `willRetry: true` suivie d'une relance
    // automatique (erreur transitoire 402/429/réseau), d'une compaction ou
    // d'une continuation en file. Terminer le tour ICI fermait la run pendant
    // que l'agent continuait de travailler : le résultat réel ne parvenait
    // JAMAIS à l'assistant (personne n'écoutait plus, fin observée seulement
    // à l'agent_settled). On ne finalise que si pi n'a PAS de relance automatique
    // prévue ; sinon on réarme les buffers de l'agent et on attend le prochain
    // agent_end / agent_settled (filet ci-dessous).
    if (event.willRetry === true) {
      console.warn("[agents-bus] agent_end willRetry=true (relance automatique pi)", agentId);
      emit("notify", { agentId, message: `⏳ L'agent ${agentId} : relance automatique en cours (erreur transitoire)…` });
      ctx.streamingTextByAgent[agentId] = "";
      ctx.toolCallsByAgent[agentId] = [];
      ctx.readOnlyToolCallsByAgent[agentId] = [];
      ctx.piTurnCountByAgent[agentId] = 0; // continuation du même tour logique
      resetTimeout(ctx);
      return;
    }
    settleAgentTurn(agentId, ctx);
  } else if (type === "auto_retry_start") {
    // pi se relance tout seul sur une erreur transitoire : l'erreur en attente
    // est annulée (la run continue, pas d'échec) et on informe l'UI.
    const hadPending = !!ctx.pendingErrorByAgent[agentId];
    ctx.pendingErrorByAgent[agentId] = undefined;
    delete ctx.interruptedRunByAgent[agentId];
    console.warn("[agents-bus] auto_retry_start (relance automatique pi)", agentId);
    if (hadPending) {
      emit("notify", { agentId, message: `⏳ L'agent ${agentId} est relancé automatiquement après l'erreur du fournisseur.` });
    }
  } else if (type === "agent_settled") {
    // Filet « zéro perte » : agent_settled = la run est TOTALEMENT terminée
    // (pas de retry, compaction ni continuation en attente). Si l'agent_end
    // final a été raté (canal occupé, ctx routé tard, événement ignoré), la
    // finalisation ET l'agrégat vers l'assistant (inject_session_summary)
    // sont déclenchés ICI au lieu d'être perdus. Idempotent : un agent déjà
    // finalisé (agent_end) ou non actif est ignoré.
    settleAgentTurn(agentId, ctx);
  } else if (type === "process_exit" || type === "process_error" || type === "extension_error") {
    // Bug : un abort déclenché par la détection de boucle (maybeDetectAgentLoop)
    // tue le process → process_exit arrive avec un reason muet (« processus
    // arrêté »). On propage la cause réelle (boucle détectée) au résultat agrégé
    // visible de l'utilisateur et de l'assistant, au lieu d'un arrêt muet.
    const loopReason = ctx.loopAbortReason[agentId];
    if (loopReason) {
      delete ctx.loopAbortReason[agentId];
      console.warn("[agents-bus] process exit après boucle", agentId, loopReason);
      // RÈGLE 3 : la session meurt ICI (processus tué par l'arrêt de boucle) —
      // le motif de fin de session est journalisé, distinct de la détection.
      traceAutomaticAgentStop({
        reason: "session-error",
        detected: "loop-process-exit",
        agentId,
        projectPath: ctx.agentProject[agentId] || ctx.project || "",
        uid: expectedSessionUid(ctx, agentId),
      }).catch(() => {});
      failAgentTurn(agentId, loopReason, ctx);
      return;
    }
    const reason = event.reason || event.message || event.error || "processus arrêté";
    console.log("[agents-bus] process error/exit", agentId, reason);
    // RÈGLE 3 : fin de session sur processus mort — motif écrit AVANT l'échec.
    traceAutomaticAgentStop({
      reason: "session-error",
      detected: "process-exit",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
    }).catch(() => {});
    failAgentTurn(agentId, reason, ctx);
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text || "")
      .join("");
  }
  return "";
}

/**
 * Gère les extension_ui_request des agents : auto-répond car les agents tournent
 * de manière autonome (pas d'interaction UI manuelle possible pendant une run).
 * - notify  → affiche le message dans l'UI, pas de réponse attendue
 * - confirm → auto-approuve (l'utilisateur a explicitement demandé la tâche)
 * - select  → sélectionne la première option
 * - input   → annule (pas de saisie utilisateur possible en mode autonome)
 * - editor  → ignore (pas d'éditeur intégré pour les agents)
 */
async function handleExtensionUiRequest(agentId, event, ctx) {
  const { id, method } = event;
  console.log("[agents-bus] ext_ui_req", agentId, "method=" + method, "id=" + id, JSON.stringify(event).slice(0, 300));
  if (!id || !method) {
    console.warn("[agents-bus] ext_ui_req: missing id or method", { id, method });
    return;
  }

  if (method === "notify") {
    const msg = event.message || "";
    if (msg) emit("notify", { agentId, message: msg, notifyType: event.notifyType || "info" });
    return; // notify ne nécessite pas de réponse
  }

  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
    return; // fire-and-forget
  }

  let command;
  if (method === "confirm") {
    command = { type: "extension_ui_response", id, confirmed: true, cancelled: false };
  } else if (method === "select") {
    const options = event.options || [];
    command = options.length > 0
      ? { type: "extension_ui_response", id, value: options[0] }
      : { type: "extension_ui_response", id, cancelled: true };
  } else if (method === "input") {
    command = { type: "extension_ui_response", id, cancelled: true };
  } else if (method === "editor") {
    command = { type: "extension_ui_response", id, cancelled: true };
  } else {
    command = { type: "extension_ui_response", id, cancelled: true };
  }

  try {
    await invoke("send_agent_process_command", { agentId, command, project: ctx.agentProject[agentId] || ctx.project || null });
    console.log("[agents-bus] ext_ui_response sent", agentId, "method=" + method, "id=" + id);
  } catch (err) {
    console.error("[agents-bus] extension_ui_response error", agentId, err);
  }
}

// T6 : nettoie les réservations du projet quand le CODEUR termine son tour
// (finishAgentTurn) ou échoue (failAgentTurn), et à l'arrêt/annulation. Seul
// le codeur QUI A RÉSERVÉ libère les réservations écrites par l'estimation
// préalable : les spécialistes restent bloqués en écriture sur les fichiers
// réservés tant que le codeur travaille. Sans effet si le projet n'a pas de
// réservations actives ou si l'agent n'est pas le codeur propriétaire.
async function cleanupReservationsForAgent(agentId, project) {
  if (!project) return;
  const agent = busState.agents.get(agentId);
  const { isCoder } = classifyAgent(agent);
  if (!isCoder) return; // seuls les codeurs libèrent les réservations
  if (!isProjectReservedBy(project, agentId)) return; // pas son projet réservé
  await deleteReservations(project);
}

async function finishAgentTurn(agentId, ctx) {
  const text = ctx.streamingTextByAgent[agentId] || "";
  // Travail réellement produit : alimente le message HONNÊTE du watchdog
  // (« run interrompue, travail partiel » ≠ « échec »). Borné pour ne pas
  // gonfler la mémoire d'une run longue.
  if (text && text.trim()) {
    ctx.producedText = ((ctx.producedText || "") + "\n\n" + text).slice(-8000);
  }
  ctx.pendingErrorByAgent[agentId] = undefined;
  ctx.streamingTextByAgent[agentId] = "";
  ctx.toolCallsByAgent[agentId] = [];
  ctx.readOnlyToolCallsByAgent[agentId] = [];
  const project = ctx.agentProject[agentId] || ctx.project;
  // T6 : libérer les réservations du projet à la fin du tour du codeur.
  await cleanupReservationsForAgent(agentId, project);
  ctx.activeAgents.delete(agentId);
  delete ctx.agentProject[agentId];
  // T5 : le créneau (project, agent_id) est libéré → lancer la demande suivante
  // de la file d'attente, s'il y en a une. C1 : balayage de TOUTES les runs du
  // projet (une file portée par une run de LECTURE doit aussi repartir).
  if (project) await launchNextQueuedForProject(agentId, project, ctx.runKey);

  // ── H2 V2 parallèle : si cet agent fait partie d'un groupe parallèle, on
  // enregistre son résultat et on agrège quand tous les agents ont terminé.
  if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    // Chantier « faux échec des runs silencieuses » : une part SANS texte
    // devenait « (aucun texte) » dans le rapport agrégé (agents.js) → l'assistant
    // concluait à l'échec et relançait la mission. Même preuve DISQUE que le
    // watchdog (mission 310) avant d'enregistrer la part.
    let partText = text;
    let partStatus = "done";
    if (!partText.trim()) {
      if (await workOnDiskDuringRun(ctx)) {
        partText = `Travail PRÉSENT sur le disque (commit ou fichiers modifiés pendant l'exécution) : la mission n'est PAS un échec, même si l'agent n'a produit aucun texte final. Vérifiez le résultat produit au lieu de la relancer.`;
      } else {
        // Aucun livrable ET aucune preuve disque : la part est un ÉCHEC
        // explicite. Avant, elle restait « done » avec un texte vide, agrégé en
        // « (aucun texte) » : l'Assistant recevait un SUCCÈS alors que rien
        // n'avait été produit (cas du plan-maker qui « s'arrête en quelques
        // secondes » sans plan). Une mission de lecture ne peut rien prouver par
        // le disque (voir `provesWorkOnDisk`), donc son silence EST un échec.
        partStatus = "error";
        partText = ctx.readonly === true
          ? `L'agent ${agentId} a terminé sans produire de livrable (aucun texte final) et une mission de lecture ne modifie rien sur le disque : la demande n'a donc PAS été exécutée. Relancez-la en précisant le livrable attendu.`
          : `L'agent ${agentId} a terminé sans produire de livrable (aucun texte final) et aucun travail n'a été détecté sur le disque : la demande n'a donc PAS été exécutée. Relancez-la en reformulant la tâche.`;
      }
    }
    ctx.parallelGroup.results[agentId] = { status: partStatus, text: partText };
    ctx.parallelGroup.pending--;
    if (ctx.parallelGroup.pending <= 0) {
      const group = ctx.parallelGroup;
      ctx.parallelGroup = null;
      await group.onComplete(group.results);
    }
    return;
  }

  // ── H2 V2 parallèle : le coordinateur (ou un agent) délègue à N agents en
  // parallèle via [[PARALLEL]]. On lance les N agents simultanément, puis on
  // renvoie le résultat agrégé à l'appelant via onComplete (pas de push sur la
  // pile : l'appelant est rappelé directement, sinon il se considérerait comme
  // son propre appelant à la fin → boucle infinie).
  const parallel = parseParallelMarker(text);
  if (parallel) {
    emit("parallelStart", { from: agentId, assignments: parallel.assignments });
    await dispatchParallel(parallel.assignments, async (results) => {
      const aggregated = aggregateParallelResults(results);
      const result = buildResultPrompt("parallel", "done", aggregated, busState.config.agent_max_result_tokens);
      emit("parallelDone", { results });
      await runAgentTurn(busState.agents.get(agentId), result, "", null, undefined, null, ctx);
    }, undefined, project, ctx);
    return;
  }

  const call = parseCallMarker(text);

  if (call) {
    // L'agent actif a décidé de déléguer
    const { agentId: targetId, payload: brief } = call;
    emit("transition", { from: agentId, to: targetId });

    // Garde-fous
    if (ctx.callStack.length >= busState.maxDepth) {
      const result = buildResultPrompt(targetId, "error", `Profondeur max (${busState.maxDepth}) atteinte.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    const budgetCheck = ensureBudget(targetId, ctx);
    if (!budgetCheck.ok) {
      const result = buildResultPrompt(targetId, "error", budgetCheck.message, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    if (detectCycle(targetId, ctx)) {
      const result = buildResultPrompt(targetId, "error", `Cycle détecté : ${targetId} est déjà dans la pile.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }
    const targetAgent = busState.agents.get(targetId);
    if (!targetAgent) {
      const result = buildResultPrompt(targetId, "error", `Agent "${targetId}" inconnu.`, busState.config.agent_max_result_tokens);
      await sendPromptToAgent(agentId, result, ctx);
      return;
    }

    consumeBudget(targetId, ctx);
    ctx.callStack.push({ agentId, textBeforeCall: call.before });

    // Lancer / réinitialiser l'agent cible et lui envoyer le brief
    await runAgentTurn(targetAgent, brief, "", null, undefined, null, ctx);
    return;
  }

  // L'agent a terminé son tour : renvoyer le résultat à l'appelant, ou finir la run
  if (ctx.callStack.length > 0) {
    const caller = ctx.callStack.pop();
    const result = buildResultPrompt(agentId, "done", text, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result, "", null, undefined, null, ctx);
  } else {
    // Fin de la run : coordinateur a répondu. endRun (projet-scopé) ne libère
    // QUE la run de ce projet, sans toucher aux runs d'autres projets (T4).
    // Objectif 5 : la mission de cet agent est terminée → statut au repos.
    await resetAgentsProcState([agentId], ctx.project);
    if (!text || !text.trim()) {
      // Chantier « faux échec des runs silencieuses » : un agent peut réussir sa
      // mission (fichiers écrits, tests lancés) puis s'arrêter SANS phrase de
      // conclusion. La run était déclarée en échec (« aucune réponse
      // textuelle ») et l'assistant relançait une mission déjà réalisée. Avant
      // de conclure, on exige la même preuve DISQUE que le watchdog
      // (mission 310) : commit tombé pendant la run ou fichiers modifiés.
      // Note : `toolCallsByAgent` a déjà été vidé plus haut — il ne peut PAS
      // servir de preuve ici.
      if (await workOnDiskDuringRun(ctx)) {
        emit("done", {
          agentId,
          text: `L'agent ${agentId} a terminé sans texte final, mais du travail est PRÉSENT sur le disque (commit ou fichiers modifiés pendant l'exécution) : la mission n'est PAS un échec. Vérifiez le résultat produit au lieu de la relancer.`,
        });
        endRun(ctx.project, ctx.generation);
        return;
      }
      emit("error", { message: `L'agent ${agentId} n'a produit aucune réponse textuelle et aucun travail n'a été détecté sur le disque. Il a peut-être utilisé des outils sans générer de texte final. Réessayez en reformulant votre demande.` });
      endRun(ctx.project, ctx.generation);
      return;
    }
    emit("done", { agentId, text });
    endRun(ctx.project, ctx.generation);
  }
}

/**
 * Restitution fiable : finalise le tour d'un agent UNE SEULE FOIS, que la
 * fin arrive par `agent_end` (finale) ou par le filet `agent_settled`. Si une
 * erreur pi est restée en attente (aucune relance automatique ne l'a annulée),
 * l'échec est prononcé ici (comportement historique) ; sinon l'agent se
 * termine normalement (agrégat + restitution à l'assistant). L'appel est
 * idempotent : les événements suivants pour le même agent sont ignorés.
 */
function settleAgentTurn(agentId, ctx) {
  // Événement terminal PÉRIMÉ (run précédente, session processus réutilisée) :
  // aucun agent_start n'a été vu pour cet agent dans cette run → il ne nous
  // concerne pas (cross-talk, on l'ignore au lieu de tuer la run en cours).
  if (!ctx.startedByAgent[agentId]) return;
  if (ctx.endedByAgent[agentId]) return;
  if (!ctx.activeAgents.has(agentId)) return;
  ctx.endedByAgent[agentId] = true;
  if (ctx.pendingErrorByAgent[agentId]) {
    const pendingError = String(ctx.pendingErrorByAgent[agentId]);
    ctx.pendingErrorByAgent[agentId] = undefined;
    // RÈGLE 3 : erreur reçue en cours de tour (ex. message_end en erreur) — la
    // session se termine ici, le motif est journalisé avant l'échec.
    traceAutomaticAgentStop({
      reason: "session-error",
      detected: "message-error",
      agentId,
      projectPath: ctx.agentProject[agentId] || ctx.project || "",
      uid: expectedSessionUid(ctx, agentId),
      detail: pendingError.slice(0, 160),
    }).catch(() => {});
    failAgentTurn(agentId, pendingError, ctx);
    return;
  }
  finishAgentTurn(agentId, ctx);
}

/**
 * Point de suivi 344 (volet b) : phrase simple en français pour une run
 * interrompue. Le moteur renvoie un texte technique incompréhensible (« This
 * operation was aborted ») ; on le remplace par ce qui s'est passé ET ce que
 * devient le travail déjà fait (vérifié sur le disque, comme au watchdog).
 * @param {object} ctx - contexte de run
 * @returns {Promise<string>}
 */
async function describeInterruptedRun(ctx) {
  const kept = await workOnDiskDuringRun(ctx);
  return kept
    ? "L'exécution de l'agent a été interrompue avant la fin. Le travail qu'il avait déjà écrit sur le disque a été conservé : vérifiez les fichiers modifiés avant de relancer."
    : "L'exécution de l'agent a été interrompue avant la fin. Rien n'a été écrit sur le disque : aucun travail à récupérer, vous pouvez relancer la tâche.";
}

async function failAgentTurn(agentId, reason, ctx) {
  ctx.endedByAgent[agentId] = true; // marqueur anti double-finalisation
  ctx.pendingErrorByAgent[agentId] = undefined;
  ctx.streamingTextByAgent[agentId] = "";
  ctx.toolCallsByAgent[agentId] = [];
  ctx.readOnlyToolCallsByAgent[agentId] = [];
  // Point de suivi 344 (b) : message compréhensible quand la run est
  // interrompue (le texte technique du moteur n'est jamais montré).
  if (ctx.interruptedRunByAgent[agentId] || /abort/i.test(String(reason))) {
    delete ctx.interruptedRunByAgent[agentId];
    reason = await describeInterruptedRun(ctx);
  }
  const project = ctx.agentProject[agentId] || ctx.project;
  // T6 : libérer les réservations du projet à l'échec du tour du codeur.
  await cleanupReservationsForAgent(agentId, project);
  ctx.activeAgents.delete(agentId);
  delete ctx.agentProject[agentId];
  // T5 : le créneau (project, agent_id) est libéré → lancer la demande suivante
  // de la file d'attente, s'il y en a une (C1 : balayage de toutes les runs).
  if (project) await launchNextQueuedForProject(agentId, project, ctx.runKey);
  // H2 V2 parallèle : si l'agent fait partie d'un groupe parallèle, on enregistre
  // l'erreur et on agrège quand tous les agents ont terminé (ou échoué).
  if (ctx.parallelGroup && ctx.parallelGroup.assignments.some((a) => a.agentId === agentId)) {
    ctx.parallelGroup.results[agentId] = { status: "error", text: reason };
    ctx.parallelGroup.pending--;
    if (ctx.parallelGroup.pending <= 0) {
      const group = ctx.parallelGroup;
      ctx.parallelGroup = null;
      await group.onComplete(group.results);
    }
    return;
  }
  if (ctx.callStack.length > 0) {
    const caller = ctx.callStack.pop();
    const result = buildResultPrompt(agentId, "error", `Erreur de l'agent ${agentId} : ${reason}`, busState.config.agent_max_result_tokens);
    emit("result", { from: agentId, to: caller.agentId, text: result });
    await runAgentTurn(busState.agents.get(caller.agentId), result, "", null, undefined, null, ctx);
  } else {
    emit("error", { message: `Erreur de l'agent ${agentId} : ${reason}` });
    settleMission(ctx.runKey, "error", { message: `Erreur de l'agent ${agentId} : ${reason}` });
    // Fin de mission : l'agent ne travaille plus, son statut ne doit pas rester
    // « Running » (objectif 5, même en cas d'échec).
    await resetAgentsProcState([agentId], ctx.project);
    endRun(ctx.project, ctx.generation);
  }
}

export async function startAgentsRun(userPrompt, projectContext = "") {
  const runProject = window._pilotProjectPath || ".";
  // Plancher : ne jamais fermer la run d'un agent qui travaille (cf.
  // RUN_LAUNCH_MIN_STUCK_IDLE_MS).
  await releaseStuckRunLock(runProject, { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
  if (getRunState(runProject) === "running") {
    throw new Error("Une run est déjà en cours sur ce projet.");
  }
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }

  const ctx = beginRun(runProject);
  ctx.currentAgentId = busState.coordinator.id;
  ctx.callStack = [];
  ctx.turnCount = 0;

  const manifest = buildCoordinatorManifest(Array.from(busState.agents.values()));
  const brief = `${userPrompt}\n\n${manifest}`;

  emit("start", { agentId: busState.coordinator.id, prompt: userPrompt });
  await runAgentTurn(busState.coordinator, brief, projectContext);
}

/**
 * H2 V2 parallèle : lance N agents simultanément sur des briefs distincts
 * (mode piloté par l'utilisateur, sans coordinateur). Quand tous ont terminé,
 * émet `parallelDone` puis `done` avec le résultat agrégé.
 * `assignments` : [{ agentId, brief }].
 */
export async function startParallelRun(assignments, projectContext = "", options) {
  // T2 : la run est scopée au PROJET cible (assignments[0].project, sinon projet
  // actif). Deux runs sur des projets DIFFÉRENTS peuvent tourner en parallèle.
  const runProject = (assignments && assignments[0] && assignments[0].project) || window._pilotProjectPath || ".";
  // Plancher : ne jamais fermer la run d'un agent qui travaille (cf.
  // RUN_LAUNCH_MIN_STUCK_IDLE_MS).
  await releaseStuckRunLock(runProject, { requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS });
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  // Nature de la mission : LECTURE seulement si TOUS les agents assignés le sont
  // (registre des agents, champ `readonly`). Sinon MODIFICATION exclusive.
  const readOnly =
    Array.isArray(assignments) &&
    assignments.length > 0 &&
    assignments.every((a) => {
      const ag = busState.agents.get(a.agentId);
      return !!(ag && ag.readonly === true);
    });
  const nature = readOnly ? "read" : "write";
  // T2 : garde projet-scopée — une run sur un AUTRE projet ne bloque pas.
  // Lecture partagée : une mission de LECTURE cohabite avec d'autres lectures.
  if (isRunInProgress(runProject, { nature })) {
    throw new Error("Une run est déjà en cours sur ce projet.");
  }

  const ctx = beginRun(runProject, { readOnly });
  ctx.callStack = [];
  ctx.turnCount = 0;
  // Signal « la run a réellement démarré » (défaut « faux succès de lancement ») :
  // appelé APRÈS la garde de verrou et beginRun, donc uniquement quand une run
  // est effectivement marquée « running ». Permet à l'appelant (assistant) de
  // rapporter un lancement réel au lieu d'un succès optimiste.
  if (options && typeof options.onStart === "function") {
    try {
      options.onStart(runProject, ctx);
    } catch (_) {
      // fail-open : un hook défaillant ne doit pas casser la run.
    }
  }

  emit("start", { agentId: "parallel", prompt: assignments.map((a) => a.agentId).join(", ") });
  try {
    await dispatchParallel(assignments, async (results) => {
      const aggregated = aggregateParallelResults(results);
      // Statut de la MISSION : une run dont AUCUNE part n'a produit de livrable
      // est un ÉCHEC, pas un succès avec du texte vide. C'est la voie par
      // laquelle le plan-maker « qui s'arrête sans plan » était rapporté comme
      // réussi à l'Assistant (mission 384).
      const missionFailed = parallelMissionFailed(results);
      emit("parallelDone", { results });
      emit("done", { agentId: "parallel", text: aggregated });
      // Objectif 5 : les agents lancés (run_agents) ont fini leur mission —
      // remettre leur statut au repos (sinon « Running » à vie).
      await resetAgentsProcState(assignments.map((a) => a.agentId), runProject);
      // Bug #9 + T4 : libérer le verrou de run de CE PROJET à la fin normale (ou
      // erreur agrégée) de la run parallèle, sans toucher aux autres projets.
      // Protection par génération : un onComplete TARDIF (run abandonnée) ne
      // supprime pas le contexte d'une run plus récente (ctx.generation).
      endRun(runProject, ctx.generation);
      // Livraison du rapport à LA mission qui a lancé cette run (sink par run),
      // APRÈS la libération du verrou. Le sink vit dans `missionSinks` (clé de
      // run) : il survit à endRun, qui ne supprime que `busState.runs[key]`.
      // Ordre CRITIQUE (détour de routage) : livrer le résultat AVANT endRun
      // réveillait l'appelant alors que la run de LECTURE était encore
      // « running ». Sa mission suivante (nommant un agent précis) était alors
      // refusée par la garde d'admission `isRunInProgress(projet,
      // {nature:"write"})` et mise en file — tandis que l'agent de l'estimation
      // (le planificateur, JAMAIS nommé pour cette mission) en avait exécuté le
      // texte à sa place : aucun fichier, aucun commit.
      if (missionFailed) {
        settleMission(ctx.runKey, "error", { message: aggregated });
      } else {
        settleMission(ctx.runKey, "done", { text: aggregated });
      }
    }, options, runProject, ctx);
  } catch (e) {
    // Sécurité : si dispatchParallel échoue de façon synchrone, libérer le verrou
    // AVANT de livrer l'échec à la mission (même ordre que le chemin normal,
    // sinon une mission suivante nommant un agent est mise en file à tort).
    endRun(runProject, ctx.generation);
    settleMission(ctx.runKey, "error", { message: e && e.message ? e.message : String(e) });
    throw e;
  }
}

// Lance la run d'agents et route le résultat vers `onDone` / `onError`.
// Cœur commun des deux variantes (bloquante et non bloquante).
// `options.purge` : si vrai, purge la conversation de chaque agent avant la
// run (contexte vierge, comme le mode manuel) — utilisé par `run_agents`.
function _runAgentsForAssistant(assignments, onDone, onError, options) {
  // Livraison du rapport PAR MISSION : le sink est enregistré sous la clé de run
  // réelle (fournie par onStart), jamais dans l'état global `busState.callbacks`
  // — c'était la cause de la livraison croisée entre missions parallèles.
  const callerOnStart = options && typeof options.onStart === "function" ? options.onStart : null;
  let settled = false;
  const done = (text) => {
    if (settled) return;
    settled = true;
    onDone(text);
  };
  const failed = (e) => {
    if (settled) return;
    settled = true;
    onError(e instanceof Error ? e : new Error(String(e)));
  };
  const opts = {
    ...options,
    onStart: (project, ctx) => {
      attachMissionSink((ctx && ctx.runKey) || runKey(project), { onDone: done, onError: failed });
      if (callerOnStart) {
        try {
          callerOnStart(project, ctx);
        } catch (_) {
          // fail-open : un hook défaillant ne doit pas casser la run.
        }
      }
    },
  };
  startParallelRun(assignments, "", opts).catch((e) => failed(e));
}

/**
 * Lance une run sur des agents sélectionnés (coordinateur assistant) et retourne
 * une Promise résolue avec le résultat agrégé (texte) ou rejetée en cas d'erreur.
 * Utilisé par l'outil `run_agents` de l'assistant (spec_super_agent.md) :
 * l'assistant choisit quels agents utiliser et reçoit le résultat pour continuer
 * son raisonnement. Les agents sélectionnés tournent en parallèle (feuilles).
 * @param {Array<{agentId:string, brief:string}>} assignments
 * @returns {Promise<string>}
 */
export async function runAgentsForAssistant(assignments, options) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  // P4 : re-synchroniser la map des agents depuis le registre persistant pour
  // qu'un agent créé entre-temps (create_agent) soit visible/sélectionnable.
  await reloadAgentsRegistry();
  return new Promise((resolve, reject) => {
    _runAgentsForAssistant(assignments, resolve, reject, options);
  });
}

/**
 * Variante NON bloquante de `runAgentsForAssistant` : lance la run en
 * arrière-plan et retourne immédiatement. Le résultat est délivré via les
 * callbacks `onDone(text)` / `onError(err)` à la fin de la run. Utilisée par
 * l'assistant (outil `run_agents`) pour ne pas bloquer son tour (et donc
 * l'input utilisateur) pendant que les agents travaillent.
 */
export async function runAgentsForAssistantAsync(assignments, onDone, onError, options) {
  if (!busState.coordinator) {
    await initAgentsBus(busState.callbacks);
  }
  await reloadAgentsRegistry();
  _runAgentsForAssistant(assignments, onDone, onError, options);
}

/**
 * Source de vérité « une run est occupée ou non » (par projet). Retourne `true`
 * si une run est en cours sur le projet donné. Sans argument (ou projet vide),
 * retourne `true` si une run est en cours sur N'IMPORTE QUEL projet (rétrocompat
 * pour isRunStillActive / watchdog global de l'assistant).
 *
 * Utilisée par l'assistant (super-agent.js, outil `run_agents`) en plus de son
 * flag local `runAgentsInFlightByProject` pour détecter TOUTES les runs en
 * cours, y compris celles lancées hors de sa file (mode manuel, run directe,
 * bus resté bloqué en "running"). Sans cette garde, une demande arrivant
 * pendant une run dont le flag local est faux passait la file puis échouait
 * brutalement avec « Une run est déjà en cours » (levé par startParallelRun).
 * @param {string} [project]
 * @returns {boolean}
 */
export function isRunInProgress(project, options) {
  const nature = options && options.nature;
  // Projet : toutes ses clés de run (défaut + lectures) — une run sur un AUTRE
  // projet ne bloque jamais.
  const keys = project ? runKeysOfProject(project) : Object.keys(busState.runs);
  // Nature de chaque run en cours sur le périmètre.
  const runningNatures = [];
  for (const k of keys) {
    const ctx = busState.runs[k];
    if (ctx && (ctx.runState === "running" || ctx.runState === "stopping")) {
      runningNatures.push(ctx.readonly === true ? "read" : "write");
    }
  }
  // Sans nature demandée : rétrocompat strict ("une run tourne-t-elle ?").
  if (!nature) return runningNatures.length > 0;
  // Sinon, la politique PURE d'admission (lecture partagée / modification
  // exclusive) tranche — source unique de vérité (run-policy.js).
  return !canStartMission(nature, runningNatures);
}

/**
 * uid de session à exiger pour un arrêt/abandon ciblé (pure).
 *
 * Retourne l'uid mémorisé par la run pour cet agent, ou `null` quand la run ne
 * le connaît pas (chemin historique : Rust applique alors son comportement par
 * défaut, sans contrôle de propriété). Un uid absent, non numérique ou nul
 * n'est jamais transmis.
 * @param {object} ctx - contexte de run
 * @param {string} agentId
 * @returns {number|null}
 */
export function expectedSessionUid(ctx, agentId) {
  const uid = ctx && ctx.sessionUid ? ctx.sessionUid[agentId] : null;
  return typeof uid === "number" && uid > 0 ? uid : null;
}

export async function stopAgentsRun(options = {}) {
  // Portée : par défaut GLOBALE (bouton « tout arrêter »). Les arrêts
  // AUTOMATIQUES (timeout d'inactivité, boucle, plafond de tours) passent la clé
  // de LEUR run : ils ne doivent jamais arrêter les agents d'une autre run
  // (autre projet, autre mission), sinon une run voisine qui se termine coupe un
  // agent qui vient de démarrer — « l'agent commence et s'arrête ».
  const onlyKey = typeof options.runKey === "string" && options.runKey ? options.runKey : null;
  // RÈGLE 3 : motif de l'arrêt AUTOMATIQUE, transmis par l'appelant
  // (`options.reason`). Écrit au disque AVANT l'arrêt effectif ci-dessous. Un
  // arrêt MANUEL (raison absente — bouton « tout arrêter ») reste volontaire :
  // il n'est pas journalisé comme arrêt automatique.
  const autoStopReason = typeof options.reason === "string" ? options.reason.trim() : "";
  // Détecteur à l'origine de l'arrêt : celui de l'appelant (ex: « no-event » pour
  // le timeout d'inactivité, « pi-turns » pour le plafond de tours), sinon
  // « stop-run » (arrêt de la run demandé par le mécanisme d'arrêt lui-même).
  const autoStopDetected =
    typeof options.detected === "string" && options.detected.trim() ? options.detected.trim() : "stop-run";
  const runningKeys = Object.keys(busState.runs).filter((k) => {
    if (onlyKey && k !== onlyKey) return false;
    const s = busState.runs[k].runState;
    return s === "running" || s === "stopping";
  });
  if (runningKeys.length === 0) return;
  // Annulation réelle d'une run (bouton, timeout, boucle, trop de tours) :
  // remise à zéro du lecteur de son différé pour que les surfaces restées
  // « actives » ne retardent pas le son de la prochaine mission.
  resetDeferredSound();
  const stopped = [];
  for (const key of runningKeys) {
    const ctx = busState.runs[key];
    if (!ctx) continue;
    // RÈGLE 3 : le motif est écrit AVANT l'arrêt effectif (jamais après). Les
    // agents ACTIFS reçoivent leur ligne par l'ENTONNOIR UNIQUE (une par agent,
    // avec son uid) ; une run sans agent actif (verrou orphelin, run fantôme)
    // garde une ligne `agent=none` — l'arrêt de la run est un fait à tracer.
    if (autoStopReason && ctx.activeAgents.size === 0) {
      await traceAutomaticAgentStopForRun(ctx, { reason: autoStopReason, detected: autoStopDetected });
    }
    ctx.runState = "stopping";
    // Livraison du rapport : chaque mission arrêtée reçoit SON arrêt (et non
    // celui d'une autre mission, comme avec l'ancien état global écrasé).
    settleMission(ctx.runKey, "stop", {});
    // H2 V2 parallèle : abort tous les agents actifs (pas seulement le dernier).
    for (const agentId of ctx.activeAgents) {
      const agentProject = ctx.agentProject[agentId] || ctx.project || null;
      const agentUid = expectedSessionUid(ctx, agentId);
      if (autoStopReason) {
        // ENTONNOIR UNIQUE : motif journalisé (attendu) PUIS arrêt de l'agent,
        // avec la même garde de propriété et la même portée de run.
        await stopAgentWithTrace({
          reason: autoStopReason,
          detected: autoStopDetected,
          agentId,
          projectPath: agentProject || "",
          uid: agentUid,
          stop: () => invoke("abort_agent_process", { agentId, project: agentProject, expectedUid: agentUid }),
        });
      } else {
        // R3-EXCEPTION-MANUEL : arrêt VOLONTAIRE (bouton « tout arrêter ») — ce
        // n'est pas un arrêt automatique, il n'a donc pas de ligne de journal.
        invoke("abort_agent_process", { agentId, project: agentProject, expectedUid: agentUid }).catch(() => {});
      }
    }
    stopped.push({ project: ctx.project || key, generation: ctx.generation });
  }
  // T6-fix (fuite 1) : purger les réservations de tous les projets réservés
  // AVANT de vider les runs. En état "stopping", handleAgentEvent ignore les
  // événements agent_end (runState !== "running") → finishAgentTurn n'est
  // jamais appelé → sans cette purge, .pilot/reservations.json resterait sur
  // disque et bloquerait silencieusement les écritures des futurs agents.
  // Portée GLOBALE : toutes les runs sont vidées, on purge donc TOUTES les
  // réservations connues (couvre aussi un codeur non actif). Portée CIBLÉE : on
  // ne purge que les projets réellement arrêtés, pour ne pas lever les
  // réservations d'une autre run encore en cours.
  if (onlyKey) {
    for (const st of stopped) {
      if (st.project) await deleteReservations(st.project).catch(() => {});
    }
  } else {
    await clearAllReservations();
  }
  // `silent: true` pour les arrêts automatiques (timeout, boucle, trop de tours) :
  // le message d'erreur a déjà été émis via "error". Le message « Run arrêtée par
  // l'utilisateur. » ne doit apparaître que pour un arrêt manuel (issue #10).
  if (!options.silent) {
    emit("stop", {});
  }
  if (onlyKey) {
    // Libération de la SEULE run arrêtée (les autres runs gardent leur verrou).
    for (const st of stopped) endRun(st.project, st.generation);
  } else {
    clearAllRuns();
  }
}

export async function stopAllAgentProcesses() {
  await invoke("stop_all_agent_processes").catch(() => {});
}

/**
 * Pure (testable) : indique si un tour d'agent exige un contexte VIERGE.
 *
 * Restitution fiable (relance d'agents secondaires via `run_agents`) : un
 * contexte vierge est requis quand `options.purge` est vrai (anti-boucle,
 * contexte propre comme le mode manuel) OU quand l'agent n'est pas en
 * `keep_context`. Dans ce cas le frontend force un process pi NEUF et une
 * `new_session` plutôt que de reprendre un processus vivant d'une run
 * précédente (qui peut conserver l'ancienne conversation).
 * @param {object} agent - agent normalisé (champ `keep_context`).
 * @param {object} [options] - options du tour (`purge`).
 * @returns {boolean}
 */
export function needsFreshAgentSession(agent, options) {
  return !!(((options && options.purge) === true) || (agent && agent.keep_context !== true));
}

/**
 * Force le redémarrage propre d'une session AgentProcess de run précédente
 * quand un contexte vierge est demandé (voir `needsFreshAgentSession`).
 *
 * Problème cible : après une `run_agents`, le processus pi de l'agent reste
 * VIVANT (parké). À la relance du MÊME agent, `start_agent_process` le REPREND
 * au lieu d'en créer un neuf ; la conversation antérieure n'est pas garantie
 * d'être réellement purgée (`new_agent_process_session` peut être ignoré par un
 * process encore en streaming/delta). Résultat : l'agent soit « ne démarre pas
 * réellement », soit renvoie L'ANCIENNE session au lieu du nouveau travail.
 *
 * On arrête donc l'éventuelle session AgentProcess existante (project, agent)
 * AVANT le spawn, pour forcer un processus neuf au contexte vierge. Garde de
 * sûreté : on ne stoppe QUE les sessions en mode `agent_process` (délégations) ;
 * une session MainSession (onglet agent ouvert à la main) n'est jamais tuée.
 * Fail-open : toute erreur est ignorée — on ne bloque jamais un tour.
 * @param {object} agent - agent normalisé (`id`).
 * @param {string} project - chemin du projet.
 */
async function forceStaleAgentProcessRestartIfNeeded(agent, project) {
  try {
    const res = await invoke("list_agent_sessions");
    const sessions = (res && res.sessions) || [];
    const existing = sessions.find(
      (s) => s.agent === agent.id && sameProject(s.project, project) && s.mode === "agent_process"
    );
    if (!existing) return;
    // RÈGLE 3 : ce `stop_agent_process` est un ARRÊT AUTOMATIQUE (personne ne l'a
    // demandé : il précède un respawn à contexte vierge). Il passe donc par
    // l'ENTONNOIR UNIQUE, avec son motif propre, avant l'arrêt effectif.
    await stopAgentWithTrace({
      reason: "stale-session-restart",
      detected: "fresh-context",
      agentId: agent.id,
      projectPath: project,
      detail: "Session agent_process d'une run précédente arrêtée pour forcer un contexte vierge.",
      stop: () => invoke("stop_agent_process", { agentId: agent.id, project }),
    });
  } catch (_) {
    // fail-open : inoffensif, le spawn suivant créera de toute façon une session.
  }
}

async function runAgentTurn(agent, brief, projectContext = "", project = null, options, mcpServer = null, runCtx = null) {
  if (!agent) {
    emit("error", { message: "Agent introuvable pour ce tour." });
    return;
  }

  // Ciblage de projet (run_agents) : cwd = projet cible si fourni, sinon projet
  // actif (rétrocompatible). Mémorisé pour router les commandes (abort/command/
  // prompt) vers la bonne session pendant le tour.
  const cwd = project || (runCtx && runCtx.project) || window._pilotProjectPath || ".";
  const isAssistant = cwd === ASSISTANT_SPACE;
  // Contexte de run FOURNI par l'appelant quand il le connaît déjà : une mission
  // de LECTURE a une clé de run propre (`projet#read:N`), donc redériver ici la
  // clé par défaut du projet inscrivait l'agent dans le MAUVAIS contexte — tous
  // ses événements étaient jetés (mission inerte, verrou jamais libéré, mission
  // en file jamais rejouée).
  const ctx = runCtx || getRunCtx(cwd);
  ctx.currentAgentId = agent.id;
  ctx.activeAgents.add(agent.id);
  ctx.streamingTextByAgent[agent.id] = "";
  ctx.isCompacting = false; // par sécurité si une compaction a été interrompue sans compaction_end

  const backend = backendKind();

  // set_model OBLIGATOIRE avec fallback (bug : agents sans modèle configuré →
  // pi retombe sur son modèle interne par défaut, ex huggingface/Kimi-K2.6, qui
  // renvoie 402 « credits depleted » et échoue silencieusement au 1er tour).
  // D'abord le modèle configuré de l'agent ; s'il est vide, on retombe sur le
  // defaultModel du model-switch.json (résolu une fois par run, caché dans le
  // ctx). Sans modèle du tout, le tour échoue explicitement AVANT de lancer pi.
  //
  // Point de suivi 331 : ce repli était SILENCIEUX. Il est désormais signalé à
  // l'utilisateur (événement `notify` « ⚠️ Modèle … ») et tracé (console.warn),
  // pour qu'il sache quel modèle est réellement employé à la place du demandé.
  const ownModel = agent && agent.models && typeof agent.models[backend] === "string"
    ? agent.models[backend].trim()
    : "";
  let model = ownModel;
  let modelFallback = { fallback: false, source: "agent", message: "" };
  if (!model) {
    const fb = await ensureFallbackModel(ctx);
    modelFallback = describeModelFallback(agent, backend, fb);
    model = modelFallback.model;
  }
  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    const msg = `Aucun modèle pour l'agent « ${agent.id} » — définissez son modèle dans l'éditeur d'agents (onglet 🎭).`;
    console.error("[agents-bus]", msg);
    // RÈGLE 3 : la session n'a pas pu DÉMARRER (modèle introuvable) — motif
    // journalisé avant l'échec (auparavant mort silencieuse).
    traceAutomaticAgentStop({
      reason: "spawn-failed",
      detected: "model-missing",
      agentId: agent.id,
      projectPath: cwd,
      uid: null,
      detail: msg.slice(0, 160),
    }).catch(() => {});
    failAgentTurn(agent.id, msg, ctx);
    return;
  }

  // Point de suivi 331 : le repli de modèle n'est plus muet — trace journal +
  // message clair côté interface (bandeau d'activité des agents, et panneau
  // d'événements de l'Assistant via setBusNotifyCallback).
  if (modelFallback.fallback && modelFallback.message) {
    console.warn(`[agents-bus] repli de modèle pour l'agent ${agent.id} : ${modelFallback.message}`);
    emit("notify", { agentId: agent.id, message: modelFallback.message, notifyType: "info", model });
  }

  const prompt = buildAgentPrompt(agent, brief, projectContext, backend, model);

  ctx.agentProject[agent.id] = cwd;
  const cfg = busState.config || {};
  const piPath = cfg.rpc_pi_path || "";
  const noSession = !agent.keep_context;
  // Restitution fiable : ce tour exige-t-il un contexte vierge (purge ou agent
  // non keep_context) ? Si oui on force un process neuf (voir
  // forceStaleAgentProcessRestartIfNeeded + new_session), sinon on conserve le
  // comportement historique (reprise de la session pour les keep_context).
  const freshContext = needsFreshAgentSession(agent, options);

  console.log("[agents-bus] turn", { agentId: agent.id, model, provider, modelId, cwd });

  emit("agentStart", { agentId: agent.id, model });

  // Bug : après un échec post-spawn (set_model refusé, timeout), le process pi
  // peut rester en état Running (orphelin) → mort silencieuse. On mémorise si
  // le spawn a réussi pour tuer le process dans le catch.
  let spawned = false;
  try {
    // #21 : héritage de contexte pour les agents spécifiques de l'assistant.
    // Quand le paramètre est activé, on écrit le handoff de contexte (comme
    // l'agent standard) pour que l'extension pilot-context.ts l'injecte en
    // plus du rôle propre de l'agent cible (concaténation).
    // Tâche #140 : jamais pour les agents d'assistant (hors projet) — pas de
    // contexte de projet à injecter, et pas d'extension pilot-context dans
    // l'espace assistant.
    if (cfg.super_agent_inherit_context === true && !isAssistant) {
      try {
        const config = await invoke("get_config");
        let handoffBlocks = "";
        if (config) {
          if (config.project_memory_enabled !== false) {
            const memBlock = await buildMemoryBlock(cwd);
            if (memBlock) handoffBlocks += memBlock;
          }
          if (config.context_engine_enabled !== false) {
            const ctxOpts = {
              enabled: true,
              budgetTokens: config.context_budget_tokens || 8000,
              includeImports: config.context_include_imports !== false,
              includeSpecs: config.context_include_specs !== false,
              includeRecents: config.context_include_recents !== false,
              ragEnabled: config.context_rag_enabled === true,
              ragEndpoint: config.context_rag_endpoint || "http://127.0.0.1:11434",
              ragModel: config.context_rag_model || "nomic-embed-text",
              prompt: brief,
            };
            const ctxBlock = await Promise.race([
              buildProjectContext(cwd, null, [], ctxOpts),
              new Promise((_, reject) => setTimeout(() => reject(new Error("context-engine timeout (8s)")), 8000)),
            ]).catch((e) => { console.warn("[agents-bus] contexte abandonné:", e); return null; });
            if (ctxBlock) handoffBlocks += ctxBlock;
          }
          if (config.code_graph_enabled !== false) {
            // Timeout 8s sur le bloc graphe : si un rebuild du graphe est en
            // cours (verrou global), on abandonne le bloc graphe (null) et on
            // continue le lancement de l'agent — le graphe ne doit jamais
            // bloquer indéfiniment le démarrage d'une run.
            const graphBlock = await Promise.race([
              buildGraphBlock(cwd, brief, {
                enabled: true,
                injectModeA: config.graph_inject_mode_a !== false,
                budgetTokens: config.graph_budget_tokens || 4000,
                injectModeB: config.graph_inject_mode_b !== false,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("code-graph timeout (8s)")), 8000)),
            ]).catch((e) => { console.warn("[agents-bus] bloc graphe abandonné:", e); return null; });
            if (graphBlock) handoffBlocks += graphBlock;
          }
        }
        if (handoffBlocks) {
          await invoke("write_context_handoff", { projectPath: cwd, content: handoffBlocks });
        }
      } catch (e) {
        console.warn("[agents-bus] échec écriture handoff contexte:", e);
      }
    }

    if (isAssistant) {
      // Agent d'assistant (hors projet) : commandes IPC dédiées, session
      // réservée ASSISTANT_SPACE, processus dans l'espace ~/.pilot/assistant/.
      await invoke("start_assistant_agent_process", {
        agentId: agent.id,
        cwd,
        piPath,
        noSession,
        mcpServer: mcpServer || null,
      });
    } else {
      // Restitution fiable : contexte vierge demandé → arrêter l'éventuelle
      // session AgentProcess de la run précédente pour que le spawn qui suit
      // crée un process NEUF (au lieu de reprendre une session réutilisée).
      if (freshContext) {
        await forceStaleAgentProcessRestartIfNeeded(agent, cwd);
      }
      const spawnUid = await invoke("start_agent_process", {
        agentId: agent.id,
        cwd,
        piPath,
        noSession,
        mcpServer: mcpServer || null,
      });
      // Propriété de session : on retient l'uid renvoyé par Rust pour que les
      // arrêts/abandons AUTOMATIQUES de ce tour ne puissent viser que CETTE
      // session (jamais celle d'une relance ultérieure du même couple).
      ctx.sessionUid[agent.id] = typeof spawnUid === "number" ? spawnUid : null;
    }
    spawned = true;

    // Anti-boucle (run_agents) : si `options.purge` est vrai, on purge la
    // conversation de l'agent AVANT la tâche (contexte vierge, comme le mode
    // manuel) — indépendamment de `keep_context`. Sinon, on conserve le
    // comportement historique : nouvelle session uniquement pour les agents
    // sans `keep_context`.
    if (freshContext) {
      await invoke("new_agent_process_session", { agentId: agent.id, project: cwd });
    }

    // set_model obligatoire : provider+modelId ont été validés ci-dessus. Sans
    // set_model explicite, pi retombe sur son modèle interne par défaut (hors
    // model-switch.json) qui peut échouer en silence (402 credits depleted).
    await invoke("set_agent_process_model", {
      agentId: agent.id,
      provider,
      modelId,
      project: cwd,
    });

    // T5 : puis le niveau de réflexion (même ordre que côté Rust, T4). Fail-open
    // intégral : le niveau n'est jamais une condition de bon fonctionnement du run.
    await applyAgentThinkingLevel(agent, backend, cwd, cfg.default_thinking_level, ctx);

    if (isAssistant) {
      await sendPromptToAssistantAgent(agent.id, prompt);
    } else {
      await sendPromptToAgent(agent.id, prompt, ctx);
    }
    resetTimeout(ctx);
    console.log("[agents-bus] prompt sent to", agent.id);
  } catch (err) {
    console.error("[agents-bus] runAgentTurn error", agent.id, err);
    // Bug : après un échec post-spawn (set_model refusé, timeout), tuer le
    // process orphelin pour ne pas le laisser en état Running (mort silencieuse).
    // Uniquement pour les agents de projet (run_agents) : les agents d'assistant
    // n'ont pas de commande stop dédiée.
    if (spawned && !isAssistant) {
      // RÈGLE 3 : arrêt automatique d'un process orphelin (échec post-spawn). Le
      // motif est journalisé AVANT l'arrêt par l'ENTONNOIR UNIQUE — sans cela le
      // process disparaissait sans trace (mort silencieuse).
      await stopAgentWithTrace({
        reason: "spawn-failure-cleanup",
        detected: "run-agent-turn-error",
        agentId: agent.id,
        projectPath: cwd,
        detail: `Process orphelin arrêté après échec du tour : ${String(err).slice(0, 160)}`,
        stop: () =>
          invoke("stop_agent_process", {
            agentId: agent.id,
            project: cwd,
            expectedUid: expectedSessionUid(ctx, agent.id),
          }),
      });
    }
    // RÈGLE 3 : le tour échoue (exception non rattrapée) → la session se termine
    // en erreur, le motif est journalisé AVANT l'échec prononcé (y compris quand
    // aucun process orphelin n'a été arrêté : le cas serait sinon muet).
    await traceAutomaticAgentStop({
      reason: "run-exception",
      detected: "run-agent-turn-error",
      agentId: agent.id,
      projectPath: cwd,
      uid: expectedSessionUid(ctx, agent.id),
      detail: String(err).slice(0, 160),
    }).catch(() => {});
    failAgentTurn(agent.id, String(err), ctx);
  }
}

async function sendPromptToAgent(agentId, message, ctx) {
  await invoke("send_agent_process_prompt", { agentId, message, project: ctx.agentProject[agentId] || ctx.project || null });
}

// Envoie un prompt à un agent d'assistant (hors projet) : commande IPC dédiée,
// session résolue par le service sous la clé ASSISTANT_SPACE (aucun projet).
async function sendPromptToAssistantAgent(agentId, message) {
  await invoke("send_assistant_agent_prompt", { agentId, message });
}

/**
 * H2 V2 parallèle : lance N agents simultanément (chacun dans son propre
 * processus pi), attend que tous aient terminé, puis appelle `onComplete` avec
 * les résultats agrégés { agentId: { status, text } }.
 * Les agents parallèles sont des agents « feuille » : ils exécutent leur brief
 * et retournent leur résultat (pas de délégation [[CALL]] imbriquée en V1).
 */
async function dispatchParallel(assignments, onComplete, options, runProject, ctx) {
  ctx.parallelGroup = {
    assignments,
    pending: assignments.length,
    results: {},
    onComplete,
  };
  for (const a of assignments) {
    const agent = busState.agents.get(a.agentId);
    if (!agent) {
      ctx.parallelGroup.results[a.agentId] = { status: "error", text: `Agent "${a.agentId}" inconnu.` };
      ctx.parallelGroup.pending--;
      continue;
    }
    const budgetCheck = ensureBudget(a.agentId, ctx);
    if (!budgetCheck.ok) {
      ctx.parallelGroup.results[a.agentId] = { status: "error", text: budgetCheck.message };
      ctx.parallelGroup.pending--;
      continue;
    }
    consumeBudget(a.agentId, ctx);
    // T5 : exclusivité des spécialités par projet. Si un agent de même agent_id
    // est déjà actif sur le même projet, mettre la demande en file d'attente au
    // lieu de la lancer (elle se lancera automatiquement à la fin de la tâche en
    // cours). La demande reste dans le groupe parallèle (pending conservé) pour
    // que la run ne se termine pas avant son exécution.
    const project = a.project || window._pilotProjectPath || ".";
    if (await isAgentActiveOnProject(a.agentId, project)) {
      // RÈGLE 4 : la demande garde la trace de la run QUI L'A MISE EN FILE. Un
      // rejeu ne doit jamais l'exécuter dans un autre contexte que le sien.
      enqueueExclusivity(ctx.exclusivityQueue, a.agentId, project, a);
      const enqueued = ctx.exclusivityQueue[exclusivityKey(project, a.agentId)];
      const entry = enqueued && enqueued[enqueued.length - 1];
      if (entry) entry.ownerRunKey = ctx.runKey;
      ctx.parallelGroup.results[a.agentId] = {
        status: "queued",
        text: `⏳ Demande mise en file d'attente : l'agent ${a.agentId} est déjà actif sur ce projet. Elle se lancera automatiquement à la fin de la tâche en cours.`,
      };
      emit("notify", { agentId: a.agentId, message: `⏳ L'agent ${a.agentId} est déjà actif sur ce projet. La demande est mise en file d'attente et se lancera automatiquement à la fin de la tâche en cours.` });
      continue;
    }
    await runAgentTurn(agent, a.brief, "", a.project, options, a.mcp_server || null, ctx);
  }
  // Si tous les agents ont échoué au démarrage (inconnus / budget), on agrège
  // immédiatement sans attendre d'agent_end.
  if (ctx.parallelGroup && ctx.parallelGroup.pending <= 0) {
    const group = ctx.parallelGroup;
    ctx.parallelGroup = null;
    await group.onComplete(group.results);
  }
}

// Exposition minimale de l'état pour l'UI (lecture seule recommandée).
if (typeof window !== "undefined") {
  window.__agentBusState = busState;
}
