// Pilot Group Assistant — assistant de groupe (GDS Phase C2), lecture seule.
//
// L'assistant de groupe (canal `rpc-event-group`) répond aux questions sur les
// projets du groupe en lisant le SUIVI FUSIONNÉ (clients, projets, tâches,
// décisions) centralisé dans Postgres via le GDS. Il est STRICTEMENT en lecture
// seule : il ne modifie jamais le code des projets ni le suivi.
//
// Cette extension fournit un outil de lecture :
//   - group_tracking_query(scope) → renvoie le suivi fusionné (clients, projets,
//     tâches, décisions) sous forme de JSON, filtré par `scope` ("all" par
//     défaut, ou "clients" / "projects" / "tasks" / "decisions").
//
// Mécanisme : l'outil envoie la demande via `ctx.ui.input` préfixé par un sentinel.
// En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout et BLOQUE
// pi jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot intercepte le
// sentinel (group-assistant.js), exécute la lecture via une commande Rust
// (group_assistant_tracking_query) et renvoie le résultat (JSON) comme `value`
// de la réponse. L'outil retourne ce résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil de lecture du suivi. Pilot le
// détecte dans le `input` reçu et exécute la lecture au lieu d'afficher un champ.
const TRACKING_QUERY_SENTINEL = "PILOT_GROUP_TRACKING_QUERY::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "group_tracking_query",
    label: "Group Tracking Query",
    description:
      "Lire le suivi fusionné des projets du groupe (clients, projets, tâches, décisions) centralisé dans le GDS. Retourne les données sous forme de JSON. Lecture seule stricte : ne modifie jamais le code ni le suivi. Utilise-la pour répondre aux questions sur l'état des projets du groupe.",
    promptSnippet: "group_tracking_query: lire le suivi fusionné des projets du groupe",
    promptGuidelines: [
      "Use group_tracking_query to read the merged group tracking (clients, projects, tasks, decisions) from the GDS. It returns JSON. Use it to answer questions about the state of group projects.",
      "You are strictly read-only: never modify project code or the tracking data. Only read.",
      "scope can be 'all' (default), 'clients', 'projects', 'tasks', or 'decisions'.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(
        Type.String({
          description: "Portée de la lecture : 'all' (défaut), 'clients', 'projects', 'tasks' ou 'decisions'",
        })
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = params.scope || "all";
      const result = await ctx.ui.input(TRACKING_QUERY_SENTINEL + scope, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Lecture annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
