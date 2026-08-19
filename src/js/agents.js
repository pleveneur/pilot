// agents.js — Fonctions pures du registre d'agents et du protocole inter-agents
// (H2 V2, spec_gestion_agents.md).

import { invoke } from "@tauri-apps/api/core";
import { estimateTokens } from "./orchestration.js";

const CALL_RE = /\[\[CALL:([a-z0-9_-]+)\]\]([\s\S]*?)\[\[\/CALL\]\]/i;
const PARALLEL_RE = /\[\[PARALLEL\]\]([\s\S]*?)\[\[\/PARALLEL\]\]/i;
const DEFAULT_MAX_RESULT_TOKENS = 4000;

/** Charge le registre d'agents global (table `agents`, pilot.db). */
export async function loadAgentRegistry() {
  return await invoke("list_agents");
}

/** Sauvegarde le registre d'agents global (remplace les agents globaux en base). */
export async function saveAgentRegistry(registry) {
  const agents = Array.isArray(registry.agents) ? registry.agents : [];
  return await invoke("replace_agents", { agents });
}

/**
 * Persiste un agent (insert ou update) dans le registre global (P4).
 * Écriture atomique d'un seul agent, sans delete-all + re-insert : garantit que
 * l'agent créé est réellement écrit sur disque sans risque de perte partielle.
 */
export async function upsertAgent(agent) {
  return await invoke("upsert_agent", { agent });
}

/** Applique les valeurs par défaut manquantes sur un agent. */
export function normalizeAgent(agent) {
  if (!agent || typeof agent !== "object") return null;
  const models = agent.models || {};
  return {
    id: String(agent.id || "").trim(),
    name: String(agent.name || "").trim(),
    icon: String(agent.icon || "").trim(),
    description: String(agent.description || "").trim(),
    role: String(agent.role || "").trim(),
    models: {
      pi: String(models.pi || "").trim(),
      plh: String(models.plh || "").trim(),
    },
    capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map(String) : [],
    readonly: !!agent.readonly,
    keep_context: !!agent.keep_context,
    max_calls_per_run: typeof agent.max_calls_per_run === "number" ? agent.max_calls_per_run : 5,
    call_depth: typeof agent.call_depth === "number" ? agent.call_depth : 1,
  };
}

/** Résout le modèle d'un agent selon le backend actif. */
export function resolveAgentModel(agent, backend, fallbackModel = "") {
  if (!agent || !agent.models) return fallbackModel;
  const models = agent.models;
  const other = backend === "pi" ? "plh" : "pi";
  const picked = models[backend] || models[other] || fallbackModel;
  return picked || "";
}

/** Construit le manifeste des agents injecté dans le prompt coordinateur. */
export function buildCoordinatorManifest(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return "Aucun agent disponible.";
  const workers = agents.filter((a) => a.id !== "coordinateur");
  const lines = workers.map((a) => `- ${a.id} : ${a.description}`);
  return `Agents disponibles :\n${lines.join("\n")}`;
}

/**
 * Classe un agent : codeur (peut modifier les fichiers) vs spécialiste.
 * Un agent est codeur si ses capabilities contiennent `write` ou `edit` ET
 * qu'il n'est pas en lecture seule (readonly=false). Sinon c'est un spécialiste
 * (lecture seule ou autre rôle). Réutilisable par le bus d'agents et l'assistant
 * (orchestration multi-agents, Phase 0).
 * @param {object} agent
 * @returns {{ isCoder: boolean, isReadonly: boolean, capabilities: string[] }}
 */
export function classifyAgent(agent) {
  const capabilities = Array.isArray(agent && agent.capabilities)
    ? agent.capabilities.map(String)
    : [];
  const isReadonly = !!(agent && agent.readonly);
  const canWrite = capabilities.includes("write") || capabilities.includes("edit");
  const isCoder = canWrite && !isReadonly;
  return { isCoder, isReadonly, capabilities };
}

/** Construit le prompt complet envoyé à un agent cible. */
export function buildAgentPrompt(agent, brief, projectContext, backend, fallbackModel) {
  const model = resolveAgentModel(agent, backend, fallbackModel);
  const readonlyNote = agent.readonly
    ? "\n\n⚠️ Tu es en LECTURE SEULE. Tu ne modifies JAMAIS de fichiers. Tu ne demandes JAMAIS d'outils d'écriture."
    : "";
  // Le coordinateur (call_depth === 0) ne doit JAMAIS utiliser d'outils :
  // il analyse la demande et délègue par texte uniquement. Sans cette consigne,
  // le modèle explore le projet avec read/ls au lieu de produire [[CALL:...]].
  const noToolsNote = agent.call_depth === 0
    ? "\n\n🚫 N'UTILISE AUCUN OUTIL (pas de read, ls, write, bash, etc.). Tu ne fais QUE analyser la demande et déléguer par texte. Réponds directement avec [[CALL:...]] ou DONE:."
    : "";
  // Spécialité + rôle (orchestration multi-agents, Phase 0) : rappelle le role et
  // les capabilities de l'agent, et précise s'il est codeur (peut modifier les
  // fichiers) ou spécialiste (lecture seule sur les fichiers réservés au codeur).
  const { isCoder, capabilities } = classifyAgent(agent);
  const caps = capabilities.length > 0 ? capabilities.join(", ") : "(aucune)";
  const specialtyBlock = `\n\n=== SPÉCIALITÉ ===\nRôle : ${agent.role || "(non défini)"}\nCapacités : ${caps}`;
  const roleBlock = isCoder
    ? "\n\n=== RÔLE ===\nTu es le CODEUR (agent principal) de ce projet : tu es autorisé à MODIFIER les fichiers de code."
    : "\n\n=== RÔLE ===\nTu es un SPÉCIALISTE : tu peux LIRE et analyser les fichiers du projet, mais tu ne dois PAS modifier les fichiers réservés au codeur (les fichiers de code que l'agent principal modifie).";
  const ctx = projectContext ? `\n\n=== CONTEXTE PROJET ===\n${projectContext}\n=== FIN CONTEXTE ===` : "";
  const taskBlock = typeof brief === "string"
    ? brief
    : JSON.stringify(brief, null, 2);
  return `${agent.role}${specialtyBlock}${roleBlock}${readonlyNote}${noToolsNote}${ctx}\n\n=== MISSION ===\n${taskBlock}\n\n=== PROTOCOLE ===\nTermine ta réponse par EXACTEMENT l'un de ces marqueurs :\n- DONE: <résumé concis> quand tu as terminé.\n- NEED_HELP: <question> si tu es bloqué.\n\nSi tu dois déléguer une sous-tâche à un autre agent, termine ta réponse par :\n[[CALL:<agent_id>]]\n{ "task": "...", "files": [...], "context": "..." }\n[[/CALL]]`;
}

/** Formate le résultat retourné à l'agent appelant. */
export function buildResultPrompt(fromAgentId, status, text, maxTokens = DEFAULT_MAX_RESULT_TOKENS) {
  const truncated = truncateForContext(text, maxTokens);
  return `[[RESULT from ${fromAgentId} (status: ${status})]]\n${truncated}\n[[/RESULT]]`;
}

/** Extrait le dernier bloc [[CALL:...]]...[[/CALL]] d'une réponse. */
export function parseCallMarker(text) {
  if (!text || typeof text !== "string") return null;
  let last = null;
  let idx = 0;
  // Trouver tous les blocs et garder le dernier
  while (idx < text.length) {
    const m = text.slice(idx).match(CALL_RE);
    if (!m) break;
    const absoluteIdx = idx + m.index;
    const agentId = m[1].trim();
    const inner = m[2].trim();
    let payload = null;
    try {
      const jsonMatch = inner.match(/\{[\s\S]*\}/);
      if (jsonMatch) payload = JSON.parse(jsonMatch[0]);
    } catch (_) {
      payload = null;
    }
    last = {
      index: absoluteIdx,
      agentId,
      raw: inner,
      payload,
      before: text.slice(0, absoluteIdx).trim(),
    };
    idx = absoluteIdx + m[0].length;
  }
  return last;
}

/**
 * Extrait un bloc [[PARALLEL]]...[[/PARALLEL]] d'une réponse (H2 V2 parallèle).
 * Format attendu :
 *   [[PARALLEL]]
 *   agent: codeur
 *   task: <brief pour le codeur>
 *   ---
 *   agent: testeur
 *   task: <brief pour le testeur>
 *   [[/PARALLEL]]
 * Retourne { index, assignments: [{agentId, brief}], before } ou null.
 */
export function parseParallelMarker(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(PARALLEL_RE);
  if (!m) return null;
  const inner = m[1].trim();
  const blocks = inner.split(/\n---\s*\n|\n---\n/);
  const assignments = [];
  for (const block of blocks) {
    const agentMatch = block.match(/^\s*agent:\s*([a-z0-9_-]+)\s*$/im);
    if (!agentMatch) continue;
    const agentId = agentMatch[1].trim();
    const taskMatch = block.match(/^\s*task:\s*([\s\S]*)$/im);
    const brief = taskMatch ? taskMatch[1].trim() : "";
    assignments.push({ agentId, brief });
  }
  if (assignments.length === 0) return null;
  return {
    index: m.index,
    assignments,
    before: text.slice(0, m.index).trim(),
  };
}

/**
 * Agrège les résultats d'un groupe parallèle en un texte unique, prêt à être
 * renvoyé à l'agent appelant (coordinateur) via buildResultPrompt.
 */
export function aggregateParallelResults(results) {
  const parts = [];
  for (const [agentId, r] of Object.entries(results)) {
    const status = r && r.status ? r.status : "done";
    const text = r && r.text ? r.text : "(aucun texte)";
    parts.push(`=== Résultat de ${agentId} (${status}) ===\n${text}`);
  }
  return parts.join("\n\n");
}

/** Tronque un texte pour tenir dans le contexte du coordinateur. */
export function truncateForContext(text, maxTokens = DEFAULT_MAX_RESULT_TOKENS) {
  if (!text || typeof text !== "string") return "";
  if (estimateTokens(text) <= maxTokens) return text;
  let low = 0;
  let high = text.length;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return text.slice(0, low) + "\n\n... (tronqué pour le contexte)";
}

/** Valide un identifiant d'agent (kebab-case, unique). */
export function validateAgentId(id, existingIds = []) {
  const s = String(id || "").trim();
  if (!s) return { ok: false, error: "L'identifiant est vide." };
  if (!/^[a-z0-9_-]+$/.test(s)) return { ok: false, error: "L'identifiant ne doit contenir que lettres minuscules, chiffres, tirets et underscores." };
  if (existingIds.includes(s)) return { ok: false, error: "Cet identifiant est déjà utilisé." };
  return { ok: true };
}

/** Génère un objet coordinateur par défaut. */
export function buildDefaultCoordinator(models = { pi: "", plh: "" }) {
  return normalizeAgent({
    id: "coordinateur",
    name: "Coordinateur",
    icon: "🧠",
    description: "Pilote l'équipe d'agents, comprend la demande utilisateur et route les tâches.",
    role: `Tu es le chef d'orchestre d'une équipe d'agents de codage. Tu ne codes pas toi-même.

Ton rôle :
1. Comprends la demande utilisateur.
2. Découpe-la en sous-tâches atomiques.
3. Pour chaque sous-tâche, délègue à l'agent spécialisé adapté en terminant ta réponse par EXACTEMENT :
[[CALL:<agent_id>]]
{ "task": "description précise et atomique", "files": ["chemin/relatif/optionnel"], "context": "tout contexte utile" }
[[/CALL]]
4. Quand un agent te retourne un résultat, décide de la suite : délègue à un autre agent ou réponds à l'utilisateur.
5. Quand la demande est entièrement traitée, réponds directement à l'utilisateur avec DONE: <résumé final>.

Délégation PARALLÈLE :
- Si plusieurs sous-tâches sont INDÉPENDANTES (aucune dépendance entre elles), lance-les en parallèle pour gagner du temps, en terminant ta réponse par EXACTEMENT :
[[PARALLEL]]
agent: <agent_id>
task: <brief pour cet agent>
---
agent: <agent_id>
task: <brief pour cet agent>
[[/PARALLEL]]
- Chaque bloc "agent:" + "task:" est une sous-tâche confiée à un agent distinct, exécutée simultanément.
- Les agents parallèles sont des agents "feuille" : ils exécutent leur brief et retournent leur résultat (pas de délégation imbriquée).
- Tu reçois ensuite les résultats agrégés de tous les agents et tu synthétises.

Règles :
- Un seul [[CALL]] ou [[PARALLEL]] par réponse.
- Ne fais pas le travail toi-même ; délègue toujours.
- Sois concis dans tes synthèses.`,
    models,
    capabilities: ["delegate", "synthesize"],
    readonly: false,
    keep_context: true,
    max_calls_per_run: 20,
    call_depth: 0,
  });
}
