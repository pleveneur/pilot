// Pilot Assistant Schedule — planification de relances différées/périodiques.
//
// L'assistant (onglet 🧭) peut programmer des rappels qui reviennent dans sa
// conversation à l'échéance : relance différée (« recheck dans 10 min ») ou
// périodique (« point toutes les 5 min tant que le codeur tourne »). Trois outils :
//   - schedule_create(name, prompt, everySeconds) → crée une relance périodique
//     (everySeconds >= 60). Retourne { id, nextFireAt }.
//   - schedule_list() → liste les planifications actives.
//   - schedule_delete(id) → supprime une planification.
//   - schedule_set_enabled(id, enabled) → désactive/réactive une planification
//     sans la supprimer (pour la réactiver plus tard).
//
// Garde-fous (côté Rust, super_agent.rs) : every >= 60 s, max 20 planifications,
// 1 fire par planification et par tick, pas de tick si la session super-agent est
// morte. Le ticker frontend (super-agent.js) appelle `super_agent_schedule_tick`
// toutes les 10 s et injecte les rappels dus dans la conversation.
//
// Mécanisme : les outils envoient la requête via `ctx.ui.input` préfixé par un
// sentinel. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout
// et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot
// intercepte le sentinel (super-agent.js), exécute la commande Rust
// (super_agent_schedule_create / _list / _delete) et renvoie le résultat (JSON)
// comme `value` de la réponse. L'outil retourne ce résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil schedule. Pilot le détecte
// dans le `input` reçu et exécute la commande au lieu d'afficher un champ.
const SCHEDULE_SENTINEL = "PILOT_ASSISTANT_SCHEDULE::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "schedule_create",
    label: "Schedule Create",
    description:
      "Programmer une relance périodique qui reviendra dans ta conversation à l'échéance (everySeconds >= 60). Utile pour surveiller un codeur en cours, ou repointer un chantier plus tard. Retourne { id, nextFireAt }.",
    promptSnippet: "schedule_create: programmer une relance périodique",
    promptGuidelines: [
      "Use schedule_create to program a periodic reminder that will come back in your conversation at the due time. everySeconds must be >= 60. Give a clear name and a prompt describing what to recheck.",
      "Max 20 active schedules. Use schedule_list to see existing ones and schedule_delete to remove them.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Nom unique de la planification" }),
      prompt: Type.String({ description: "Texte injecté à l'échéance (ce qu'il faut rechecker)" }),
      everySeconds: Type.Integer({ description: "Intervalle en secondes (>= 60)" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const req = JSON.stringify({
        op: "create",
        name: params.name,
        prompt: params.prompt,
        everySeconds: params.everySeconds,
      });
      const result = await ctx.ui.input(SCHEDULE_SENTINEL + req, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Création de planification annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "schedule_list",
    label: "Schedule List",
    description:
      "Lister tes planifications actives (relances périodiques programmées). Retourne un tableau JSON [{ id, name, prompt, every, enabled, last_run_at }].",
    promptSnippet: "schedule_list: lister tes relances programmées",
    promptGuidelines: [
      "Use schedule_list to see your active schedules before creating or deleting one.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const req = JSON.stringify({ op: "list" });
      const result = await ctx.ui.input(SCHEDULE_SENTINEL + req, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Liste annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "schedule_set_enabled",
    label: "Schedule Set Enabled",
    description:
      "Désactiver ou réactiver une planification par son id (sans la supprimer). Retourne { ok, id, enabled }. À utiliser pour désactiver automatiquement un rappel devenu inutile (ne détecte plus rien, chantier terminé, condition remplie) au lieu de le supprimer, et le réactiver si le besoin revient.",
    promptSnippet: "schedule_set_enabled: désactiver/réactiver une relance sans la supprimer",
    promptGuidelines: [
      "Use schedule_set_enabled to disable a schedule that is no longer useful (nothing detected, task done, condition met) instead of deleting it, and re-enable it if the need returns. Get the id from schedule_list or schedule_create.",
    ],
    parameters: Type.Object({
      id: Type.Integer({ description: "Id de la planification à désactiver/réactiver" }),
      enabled: Type.Boolean({ description: "true pour réactiver, false pour désactiver" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const req = JSON.stringify({ op: "set_enabled", id: params.id, enabled: params.enabled });
      const result = await ctx.ui.input(SCHEDULE_SENTINEL + req, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Modification de planification annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "schedule_delete",
    label: "Schedule Delete",
    description:
      "Supprimer une planification par son id (retourné par schedule_create ou schedule_list). Retourne { ok }.",
    promptSnippet: "schedule_delete: supprimer une relance programmée",
    promptGuidelines: [
      "Use schedule_delete to remove a schedule by id. Get the id from schedule_list or schedule_create.",
    ],
    parameters: Type.Object({
      id: Type.Integer({ description: "Id de la planification à supprimer" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const req = JSON.stringify({ op: "delete", id: params.id });
      const result = await ctx.ui.input(SCHEDULE_SENTINEL + req, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Suppression annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
