// Pilot Assistant Delegation — récupération du résultat d'une délégation (P5).
//
// L'assistant (onglet 🧭) délègue des tâches aux agents des projets et doit
// pouvoir récupérer le résultat de ces délégations pour son suivi. Cette
// extension lui fournit un outil :
//   - get_delegation_result(project, session_id) → retourne le dernier message
//     de type « résultat de délégation » de la session (marqueur
//     `[Tâche déléguée terminée]`, sinon le dernier message de l'agent) + les
//     N derniers messages (N=20). Objet JSON : { project, session_id, result,
//     history }.
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
      "Récupérer le résultat d'une délégation pour une session d'agent donnée. Retourne le dernier message de type « résultat de délégation » (marqueur [Tâche déléguée terminée], sinon le dernier message de l'agent) plus les 20 derniers messages de la session. Objet JSON : { project, session_id, result, history }. Utilise-la pour vérifier l'issue d'une tâche que tu as déléguée à un agent.",
    promptSnippet: "get_delegation_result: récupérer le résultat d'une délégation d'agent",
    promptGuidelines: [
      "Use get_delegation_result to check the outcome of a task you delegated to an agent. Pass the project path and the session_id of the agent session. It returns the last delegation-result message (marked [Tâche déléguée terminée], or the last assistant message) plus the 20 most recent messages of the session.",
      "Use it after delegating work to confirm whether the task completed, and to read the final result for your tracking.",
    ],
    parameters: Type.Object({
      project: Type.String({
        description: "Chemin du projet dont la session d'agent doit être lue.",
      }),
      session_id: Type.String({
        description: "Identifiant de la session d'agent (session_id).",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        project: params.project,
        session_id: params.session_id,
      });
      const result = await ctx.ui.input(DELEGATION_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
