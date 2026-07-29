// agents.js — Fonctions pures du registre d'agents et du protocole inter-agents
// (H2 V2, spec_gestion_agents.md).

import { invoke } from "@tauri-apps/api/core";
import { estimateTokens } from "./orchestration.js";

const CALL_RE = /\[\[CALL:([a-z0-9_-]+)\]\]([\s\S]*?)\[\[\/CALL\]\]/i;
const DEFAULT_MAX_RESULT_TOKENS = 4000;

/** Charge le registre d'agents global (~/.pilot/agents.json). */
export async function loadAgentRegistry() {
  return await invoke("load_agent_registry");
}

/** Sauvegarde le registre d'agents global. */
export async function saveAgentRegistry(registry) {
  return await invoke("save_agent_registry", { registry });
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
  const ctx = projectContext ? `\n\n=== CONTEXTE PROJET ===\n${projectContext}\n=== FIN CONTEXTE ===` : "";
  const taskBlock = typeof brief === "string"
    ? brief
    : JSON.stringify(brief, null, 2);
  return `${agent.role}${readonlyNote}${noToolsNote}${ctx}\n\n=== MISSION ===\n${taskBlock}\n\n=== PROTOCOLE ===\nTermine ta réponse par EXACTEMENT l'un de ces marqueurs :\n- DONE: <résumé concis> quand tu as terminé.\n- NEED_HELP: <question> si tu es bloqué.\n\nSi tu dois déléguer une sous-tâche à un autre agent, termine ta réponse par :\n[[CALL:<agent_id>]]\n{ "task": "...", "files": [...], "context": "..." }\n[[/CALL]]`;
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

Règles :
- Un seul [[CALL]] par réponse en V1.
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
