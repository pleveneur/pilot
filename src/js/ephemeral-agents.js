// ephemeral-agents.js — AGENT JETABLE : rôle fourni à la volée, SANS écriture
// en base (décision propriétaire du 2026-10-21).
//
// Problème résolu : `run_agents` n'acceptait que des identifiants DÉJÀ présents
// dans le registre persistant ; faire écrire un rôle à la volée imposait de
// créer un agent durable (`create_agent` → `upsert_agent`), donc une ligne en
// base et une entrée permanente dans la liste des agents.
//
// Un agent jetable est une définition gardée **en mémoire seule**, aux deux
// étages :
//   - ici (JS) : magasin `ephemeralAgents`, fusionné dans `busState.agents` du
//     bus après chaque rechargement du registre (sinon la relecture disque
//     l'effacerait avant le lancement) ;
//   - côté Rust (`AgentService::register_ephemeral_agent`) : repli de
//     `get_agent`, qui empêche `start` de « seeder » une ligne en base.
//
// Durée de vie : le temps de la TÂCHE. À sa fin, la définition est purgée des
// deux étages (et l'arrêt de la session la purge aussi côté Rust). Le travail
// reste visible : messages de session, rapport de fin de run, journal d'arrêts.
//
// Module à I/O explicites : les fonctions PURES (id, normalisation, fusion)
// sont séparées des appels IPC, testables sans Tauri.

import { invoke } from "@tauri-apps/api/core";
import { normalizeAgent } from "./agents.js";
// RÈGLE 3 : la fin de vie d'un agent jetable ARRÊTE sa session — c'est un arrêt
// AUTOMATIQUE, il passe donc par l'entonnoir unique (motif écrit avant l'arrêt).
import { stopAgentWithTrace } from "./agent-stop-funnel.js";

/** Préfixe des identifiants d'agents jetables (jamais un id du registre). */
export const EPHEMERAL_AGENT_PREFIX = "eph-";

/** Préfixe de l'icône par défaut d'un agent jetable. */
export const EPHEMERAL_AGENT_ICON = "🪄";

/**
 * Vrai si l'identifiant désigne un agent jetable (préfixe réservé).
 * Purement lexical : ne consulte aucun magasin.
 * @param {string} agentId
 */
export function isEphemeralAgentId(agentId) {
  return typeof agentId === "string" && agentId.startsWith(EPHEMERAL_AGENT_PREFIX);
}

/**
 * Fabrique un identifiant d'agent jetable UNIQUE (aucun conflit possible avec
 * un identifiant du registre : le préfixe `eph-` est réservé).
 * @param {number} [now] horodatage (ms) — injectable pour les tests
 * @param {() => number} [rand] générateur 0..1 — injectable pour les tests
 */
export function makeEphemeralAgentId(now = Date.now(), rand = Math.random) {
  const stamp = Math.max(0, Math.floor(Number(now) || 0)).toString(36);
  const noise = Math.floor(Math.abs(Number(rand()) || 0) * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${EPHEMERAL_AGENT_PREFIX}${stamp}-${noise}`;
}

/**
 * Construit la définition NORMALISÉE d'un agent jetable à partir d'un rôle
 * fourni dans la demande. Aucune valeur n'est inventée : un rôle vide donne…
 * un rôle vide (le prompt de l'agent s'en passe), et seuls des DÉFAUTS techniques
 * sont posés (identifiant éphémère, icône, budget de tours, profondeur).
 *
 * @param {object} spec rôle + réglages facultatifs fournis par l'assistant
 * @param {object} [opts]
 * @param {string} [opts.id] identifiant imposé (tests) ; sinon généré
 * @param {string} [opts.projectPath] projet de rattachement
 * @returns {object|null} agent normalisé (`ephemeral: true`), ou null si la
 *   spécification est inutilisable (pas un objet, ni rôle ni nom)
 */
export function buildEphemeralAgent(spec, opts = {}) {
  if (!spec || typeof spec !== "object") return null;
  const name = String(spec.name || spec.role || "").trim();
  const role = String(spec.role || "").trim();
  if (!name && !role) return null;
  const id = String(opts.id || spec.id || "").trim() || makeEphemeralAgentId();
  // Un id imposé qui n'est pas préfixé « eph- » serait pris pour un agent du
  // registre : on refuse plutôt que de risquer une écriture en base.
  if (!isEphemeralAgentId(id)) return null;
  const normalized = normalizeAgent({
    id,
    // Nom court : le rôle complet est injecté séparément dans le prompt.
    name: name || id,
    icon: String(spec.icon || "").trim() || EPHEMERAL_AGENT_ICON,
    description: String(spec.description || "").trim() || role.slice(0, 160),
    role,
    models: spec.models || (spec.model ? { pi: String(spec.model) } : {}),
    thinking: spec.thinking || {},
    capabilities: spec.capabilities,
    skills: spec.skills,
    readonly: spec.readonly === true || spec.readonly === "true",
    keep_context: spec.keep_context === true,
    max_calls_per_run: spec.max_calls_per_run,
    call_depth: spec.call_depth,
  });
  if (!normalized) return null;
  return {
    ...normalized,
    // Marqueur explicite : jamais persisté, jamais listé comme agent du registre.
    ephemeral: true,
    visible: false,
    loaded: false,
    busy: false,
    project_path: opts.projectPath || spec.project_path || null,
  };
}

// ── Magasin mémoire (par processus) ──
// `null` = pas encore initialisé ; on le crée à la demande pour que le module
// reste utilisable dans les tests sans état global préalable.
let store = new Map();

/** Oublie tous les agents jetables côté JS (tests, changement de projet…). */
export function resetEphemeralAgents() {
  store = new Map();
}

/** Mémorise un agent jetable déjà normalisé. Retourne l'agent mémorisé. */
export function rememberEphemeralAgent(agent) {
  if (!agent || !isEphemeralAgentId(agent.id)) return null;
  const entry = { ...agent, ephemeral: true, visible: false };
  store.set(entry.id, entry);
  return entry;
}

/** Agent jetable mémorisé (ou `null`). */
export function getEphemeralAgent(agentId) {
  return store.get(String(agentId || "")) || null;
}

/** Vrai si l'identifiant correspond à un agent jetable VIVANT (en mémoire). */
export function hasEphemeralAgent(agentId) {
  return store.has(String(agentId || ""));
}

/** Liste des agents jetables vivants (copie). */
export function listEphemeralAgents() {
  return Array.from(store.values()).map((a) => ({ ...a }));
}

/** Oublie UN agent jetable (fin de tâche). Retourne true s'il existait. */
export function forgetEphemeralAgent(agentId) {
  return store.delete(String(agentId || ""));
}

/**
 * Fusionne les agents jetables vivants dans une liste d'agents du registre.
 *
 * Utilisée par le bus APRÈS chaque rechargement du registre persistant : sans
 * elle, `reloadAgentsRegistry` (qui relit la base) ferait disparaître l'agent
 * jetable avant son lancement. Un identifiant déjà présent (impossible en
 * pratique, préfixe réservé) n'est jamais écrasé : la version persistante gagne.
 *
 * @param {Array<object>} agents agents du registre (persistants)
 * @param {Array<object>} [ephemeral] agents jetables (défaut : magasin)
 * @returns {Array<object>} nouvelle liste (les persistants d'abord)
 */
export function mergeAgentsWithEphemeral(agents, ephemeral) {
  const base = Array.isArray(agents) ? agents : [];
  const extra = Array.isArray(ephemeral) ? ephemeral : listEphemeralAgents();
  const seen = new Set(base.map((a) => (a && a.id) || "").filter(Boolean));
  const merged = base.slice();
  for (const a of extra) {
    if (!a || !isEphemeralAgentId(a.id) || seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push({ ...a, ephemeral: true, visible: false });
  }
  return merged;
}

/**
 * Sépare des identifiants en (persistants, jetables) — utile pour ne purger QUE
 * les agents jetables d'une mission sans toucher au registre.
 * @param {Array<string>} agentIds
 */
export function splitEphemeralIds(agentIds) {
  const persistent = [];
  const ephemeral = [];
  for (const id of Array.isArray(agentIds) ? agentIds : []) {
    const key = String(id || "");
    if (!key) continue;
    if (isEphemeralAgentId(key)) ephemeral.push(key);
    else persistent.push(key);
  }
  return { persistent, ephemeral };
}

// ── I/O : enregistrement côté Rust (mémoire seule, aucun `upsert_agent`) ──

/**
 * Enregistre l'agent jetable côté cœur Rust (`AgentService`), SANS écriture en
 * base : `get_agent` le résoudra par repli mémoire, ce qui empêche `start` de
 * créer une ligne dans la table `agents`.
 *
 * Fail-open assumé ? NON : si l'enregistrement échoue, l'agent serait « seedé »
 * en base au lancement (exactement ce que la mission interdit). L'erreur est
 * donc REMONTÉE pour que l'appelant renonce au lancement.
 *
 * @param {object} agent agent normalisé (`ephemeral: true`)
 * @param {string|null} projectPath projet de rattachement
 */
export async function persistEphemeralAgent(agent, projectPath = null) {
  if (!agent || !isEphemeralAgentId(agent.id)) {
    throw new Error("Agent jetable invalide : identifiant éphémère requis.");
  }
  const stored = await invoke("register_ephemeral_agent", {
    agent,
    project: projectPath || null,
  });
  const entry = rememberEphemeralAgent(stored && stored.id ? stored : agent);
  return entry;
}

/**
 * Purge un agent jetable des DEUX étages (JS + Rust) et ARRÊTE sa session.
 *
 * L'arrêt de la session est un arrêt AUTOMATIQUE (fin de tâche) : il passe par
 * l'entonnoir `stopAgentWithTrace` (règle 3 : motif écrit AVANT l'arrêt), avec
 * la garde de propriété inchangée (aucun uid fourni ici : l'agent jetable est
 * propre à cette mission, sa session ne peut pas être « relancée » par un autre
 * chemin). Le travail produit reste visible (session indexée, rapport, journal).
 *
 * Fail-open : la purge ne doit jamais faire échouer la fin d'une tâche.
 *
 * @param {string} agentId
 * @param {string|null} [projectPath] projet de rattachement (journal local)
 * @returns {Promise<boolean>} true si l'entrée JS existait
 */
export async function disposeEphemeralAgent(agentId, projectPath = null) {
  const id = String(agentId || "");
  const existed = forgetEphemeralAgent(id);
  if (!isEphemeralAgentId(id)) return existed;
  try {
    // La session de l'agent jetable n'a plus de raison de vivre : sa tâche est
    // finie. (Un agent jetable qui n'a jamais démarré : l'IPC est inoffensif.)
    await stopAgentWithTrace({
      reason: "ephemeral-task-ended",
      detected: "ephemeral-disposal",
      agentId: id,
      projectPath: projectPath || "",
      detail: "agent jetable : fin de la tâche qui l'a créé",
      stop: () => invoke("stop_agent_process", { agentId: id, project: projectPath || null }),
    });
  } catch (_) {
    // fail-open : l'arrêt ne doit pas empêcher la purge de la définition.
  }
  try {
    await invoke("clear_ephemeral_agent", { agentId: id });
  } catch (_) {
    // fail-open : la purge Rust est aussi faite à l'arrêt de la session.
  }
  return existed;
}

/**
 * Purge TOUS les agents jetables d'une mission (fin de tâche) et retourne les
 * identifiants effectivement purgés. Les identifiants du REGISTRE présents dans
 * la liste sont ignorés : jamais d'écriture, jamais de suppression d'une entrée
 * existante du registre.
 *
 * @param {Array<string>} agentIds identifiants de la mission
 * @param {string|null} [projectPath] projet de rattachement (journal local)
 * @returns {Promise<Array<string>>} identifiants jetables purgés
 */
export async function disposeEphemeralAgents(agentIds, projectPath = null) {
  const { ephemeral } = splitEphemeralIds(agentIds);
  for (const id of ephemeral) {
    await disposeEphemeralAgent(id, projectPath);
  }
  return ephemeral;
}
