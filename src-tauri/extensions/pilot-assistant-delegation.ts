// Pilot Assistant Delegation — récupération du résultat d'une délégation (P5).
//
// L'assistant (onglet 🧭) délègue des tâches aux agents des projets et doit
// pouvoir récupérer le résultat de ces délégations pour son suivi. Cette
// extension lui fournit un outil :
//   - get_delegation_result(project, session_id?, agent_id?) → retourne le
//     dernier message de type « résultat de délégation » de la session
//     (marqueur `[Tâche déléguée terminée]`, sinon le dernier message de
//     l'agent) + les N derniers messages (N=20). Objet JSON : { project,
//     session_id, agent_id, source, result, history }.
//
// Restitution fiable (chantier fin-de-run → assistant) : la résolution est
// ROBUSTE — `session_id` (exposé par list_agent_sessions) vise le jsonl exact ;
// à défaut, `agent_id` permet de lire la session vivante (get_messages en
// mémoire : agents `--no-session`/orchestration sans jsonl) puis le jsonl le
// plus récent de l'agent. Lecture seule, idempotent, jamais bloquant.
//
// Mécanisme : l'outil envoie un `ctx.ui.input` préfixé par un sentinel. En mode
// RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout et BLOQUE pi
// jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot intercepte le
// sentinel (super-agent.js), exécute la commande Rust `get_delegation_result`
// et renvoie le résultat (JSON) comme `value` de la réponse. L'outil retourne ce
// résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil get_delegation_result. Pilot
// le détecte dans le `input` reçu et exécute la commande au lieu d'afficher un
// champ de saisie.
const DELEGATION_SENTINEL = "PILOT_ASSISTANT_DELEGATION::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_delegation_result",
    label: "Get Delegation Result",
    description:
      "Récupérer le résultat d'une délégation pour un agent d'un projet. Retourne le dernier message de type « résultat de délégation » (marqueur [Tâche déléguée terminée], sinon le dernier message de l'agent) plus les 20 derniers messages. Objet JSON : { project, session_id, agent_id, source, result, history }. Passer `session_id` (sessionId exposé par list_agent_sessions) OU à défaut `agent_id` (ex: 'coder') — la résolution est robuste : fichier de session exact → session vivante (get_messages, agents sans session persistée) → jsonl le plus récent de l'agent.",
    promptSnippet: "get_delegation_result: récupérer le résultat d'une délégation d'agent",
    promptGuidelines: [
      "Use get_delegation_result to check the outcome of a task you delegated to an agent. Pass the project path and either `session_id` (from list_agent_sessions) or the agent's `agent_id` (e.g. 'coder'). Resolution order: exact session file by session_id → live agent session (get_messages, covers agents with no persisted session) → most recent session file of the agent. Safe to retry: read-only.",
      "Use it after delegating work to confirm whether the task completed, and to read the final result for your tracking. If `source` is `none` the delegation has no recorded output yet — check again later or ask the agent directly.",
    ],
    parameters: Type.Object({
      project: Type.String({
        description: "Chemin du projet dont la session d'agent doit être lue.",
      }),
      session_id: Type.Optional(
        Type.String({
          description:
            "Identifiant de la session (sessionId, exposé par list_agent_sessions). Cible exacte du fichier de session. Optionnel si `agent_id` est fourni.",
        }),
      ),
      agent_id: Type.Optional(
        Type.String({
          description:
            "Identifiant de l'agent (ex: 'coder', 'architect'). Utilisé si aucune session exacte n'est connue : relit la session vivante (get_messages) ou le jsonl le plus récent de l'agent. Indispensable pour les agents d'orchestration sans session persistante.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        project: params.project,
        session_id: params.session_id ?? "",
        agent_id: params.agent_id ?? "",
      });
      const result = await ctx.ui.input(DELEGATION_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
