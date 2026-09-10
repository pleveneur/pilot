// Pilot Group Assistant — assistant de groupe (GDS Phase C2), lecture seule sur le code.
//
// L'assistant de groupe (canal `rpc-event-group`) répond aux questions sur les
// projets du groupe en lisant le SUIVI FUSIONNÉ (clients, projets, tâches,
// décisions) centralisé dans Postgres via le GDS. Il est STRICTEMENT en lecture
// seule sur le code : il ne modifie jamais les fichiers des projets. En revanche,
// il peut AJOUTER des demandes (bugs/évolutions) au suivi sous forme de tickets.
//
// Cette extension fournit quatre outils :
//   - group_tracking_query(scope) → lit le suivi fusionné (clients, projets,
//     tâches, décisions) sous forme de JSON, filtré par `scope` ("all" par
//     défaut, ou "clients" / "projects" / "tasks" / "decisions").
//   - ticket_create(...) → ajoute une demande/bug/évolution au suivi (tickets).
//     Écriture autorisée sur le suivi, jamais sur le code.
//   - ticket_search(...) → recherche des tickets existants (par texte, statut,
//     projet ou client).
//   - project_query(scope) → interroge les projets du groupe (lecture du suivi
//     fusionné, alias de group_tracking_query orienté projets).
//
// Mécanisme : les outils envoient la demande via `ctx.ui.input` préfixé par un
// sentinel. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout
// et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot
// intercepte le sentinel, exécute l'opération via une commande Rust et renvoie le
// résultat (JSON) comme `value` de la réponse. L'outil retourne ce résultat au LLM.
//
// Respect de `gds_enabled` : les commandes Rust refusent toute opération si le GDS
// est désactivé globalement (aucune lecture/écriture du suivi fusionné possible).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinels préfixant le titre d'un `input` d'outil. Pilot les détecte dans le
// `input` reçu et exécute l'opération au lieu d'afficher un champ de saisie.
const TRACKING_QUERY_SENTINEL = "PILOT_GROUP_TRACKING_QUERY::";
const TICKET_CREATE_SENTINEL = "PILOT_GROUP_TICKET_CREATE::";
const TICKET_SEARCH_SENTINEL = "PILOT_GROUP_TICKET_SEARCH::";
const PROJECT_QUERY_SENTINEL = "PILOT_GROUP_PROJECT_QUERY::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "group_tracking_query",
    label: "Group Tracking Query",
    description:
      "Lire le suivi fusionné des projets du groupe (clients, projets, tâches, décisions) centralisé dans le GDS. Retourne les données sous forme de JSON. Lecture seule stricte : ne modifie jamais le code ni le suivi. Utilise-la pour répondre aux questions sur l'état des projets du groupe.",
    promptSnippet: "group_tracking_query: lire le suivi fusionné des projets du groupe",
    promptGuidelines: [
      "Use group_tracking_query to read the merged group tracking (clients, projects, tasks, decisions) from the GDS. It returns JSON. Use it to answer questions about the state of group projects.",
      "You are strictly read-only on project code: never modify project files. You may only add demands to the tracking as tickets (ticket_create).",
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

  pi.registerTool({
    name: "ticket_create",
    label: "Ticket Create",
    description:
      "Ajouter une demande (bug, évolution, remarque) au suivi des projets du groupe sous forme de ticket. Écriture autorisée UNIQUEMENT sur le suivi (tickets) — jamais sur le code des projets. Utilise-la quand un utilisateur ou une discussion remonte une demande à traiter par l'équipe.",
    promptSnippet: "ticket_create: ajouter une demande au suivi (ticket)",
    promptGuidelines: [
      "Use ticket_create to add a demand (bug, evolution, remark) to the group tracking as a ticket. This is the ONLY write operation you are allowed to perform: it writes to the tracking (tickets), never to project code.",
      "You are strictly read-only on project code: never modify project files. Only add tickets to the tracking.",
      "Provide a clear title and description. Optionally specify project_id, client_id, priority ('low'|'medium'|'high'), and type ('bug'|'evolution'|'remark').",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Titre court et clair de la demande" }),
      description: Type.String({ description: "Description détaillée de la demande (contexte, comportement attendu, étapes de reproduction si bug)" }),
      project_id: Type.Optional(Type.String({ description: "Identifiant du projet concerné (si connu)" })),
      client_id: Type.Optional(Type.String({ description: "Identifiant du client concerné (si connu)" })),
      priority: Type.Optional(Type.String({ description: "Priorité : 'low', 'medium' ou 'high' (défaut 'medium')" })),
      type: Type.Optional(Type.String({ description: "Type de demande : 'bug', 'evolution' ou 'remark' (défaut 'evolution')" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        title: params.title,
        description: params.description,
        project_id: params.project_id || null,
        client_id: params.client_id || null,
        priority: params.priority || "medium",
        type: params.type || "evolution",
      });
      const result = await ctx.ui.input(TICKET_CREATE_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Création de ticket annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "ticket_search",
    label: "Ticket Search",
    description:
      "Rechercher des tickets existants dans le suivi des projets du groupe. Filtre par texte libre, statut, projet ou client. Retourne les tickets correspondants sous forme de JSON. Lecture seule : ne modifie jamais le code ni le suivi.",
    promptSnippet: "ticket_search: rechercher des tickets existants",
    promptGuidelines: [
      "Use ticket_search to find existing tickets in the group tracking. You can filter by free text (query), status ('ouvert'|'en cours'|'en correction'|'fermé'), project_id, or client_id.",
      "You are strictly read-only on project code: never modify project files. Only read tickets.",
      "If no filter is provided, returns the most recent tickets.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Texte libre à chercher dans le titre/description des tickets" })),
      status: Type.Optional(Type.String({ description: "Statut : 'ouvert', 'en cours', 'en correction' ou 'fermé'" })),
      project_id: Type.Optional(Type.String({ description: "Filtrer par identifiant de projet" })),
      client_id: Type.Optional(Type.String({ description: "Filtrer par identifiant de client" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        query: params.query || "",
        status: params.status || "",
        project_id: params.project_id || "",
        client_id: params.client_id || "",
      });
      const result = await ctx.ui.input(TICKET_SEARCH_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Recherche de tickets annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "project_query",
    label: "Project Query",
    description:
      "Interroger les projets du groupe (lecture du suivi fusionné centralisé dans le GDS). Retourne les projets (et éventuellement clients, tâches, décisions) sous forme de JSON. Lecture seule stricte : ne modifie jamais le code ni le suivi. Utilise-la pour répondre aux questions sur les projets du groupe.",
    promptSnippet: "project_query: interroger les projets du groupe",
    promptGuidelines: [
      "Use project_query to read the group projects from the merged tracking (GDS). It returns JSON. Use it to answer questions about the group's projects.",
      "You are strictly read-only on project code: never modify project files. You may only add demands to the tracking as tickets (ticket_create).",
      "scope can be 'projects' (default), 'all', 'clients', 'tasks', or 'decisions'.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(
        Type.String({
          description: "Portée de la lecture : 'projects' (défaut), 'all', 'clients', 'tasks' ou 'decisions'",
        })
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = params.scope || "projects";
      const result = await ctx.ui.input(PROJECT_QUERY_SENTINEL + scope, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Lecture annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
