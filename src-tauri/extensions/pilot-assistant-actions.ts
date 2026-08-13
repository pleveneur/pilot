// Pilot Assistant Actions — actions du super-agent sur les projets (TÂCHE 2).
//
// Le super-agent (onglet 🧭) est lecture seule sur les projets : il ne modifie
// aucun fichier. Mais quand l'utilisateur discute d'un projet, il doit pouvoir :
//   1. ouvrir le projet (le rendre actif) pour le mettre en cours de traitement ;
//   2. déléguer une demande de modification de code à l'agent standard du projet
//      (pi/plh de coding), en ouvrant son onglet (le rendant visible) et en lui
//      envoyant la demande dans sa session de discussion.
//
// Ces deux actions sont des actions Pilot (pas des écritures dans les projets),
// donc compatibles avec la lecture seule stricte du super-agent. Elles sont
// déclenchées par des outils que le LLM peut appeler, et communiquent avec Pilot
// via un `ctx.ui.confirm` préfixé par un sentinel (même mécanisme que la porte
// pré-écriture pilot-edit-gate) : Pilot intercepte le sentinel, exécute l'action
// et renvoie `{ confirmed: true }` (succès) ou `{ confirmed: false }` (échec).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le message d'un confirm d'action. Pilot le détecte dans le
// `confirm` reçu et exécute l'action au lieu d'afficher des boutons Oui/Non.
const ACTION_SENTINEL = "PILOT_ASSISTANT_ACTION::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "open_project",
    label: "Open Project",
    description:
      "Ouvrir un projet (le rendre actif) pour le mettre en cours de traitement, comme si l'utilisateur l'avait ouvert manuellement. À utiliser quand l'utilisateur discute d'un projet et qu'il faut le rendre actif. Bloque jusqu'à ce que Pilot ait ouvert le projet.",
    promptSnippet: "open_project: ouvrir un projet pour le mettre en cours de traitement",
    promptGuidelines: [
      "Use open_project when the user is discussing a project and it should become the active project (as if opened manually). Call it with the absolute path of the project. If you are unsure about the path, ask the user first (ask_input / ask_choice).",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Chemin absolu du projet à ouvrir" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "open_project", path: params.path });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        return { content: [{ type: "text", text: `Le projet « ${params.path} » a été ouvert et rendu actif.` }] };
      }
      return { content: [{ type: "text", text: `Échec de l'ouverture du projet « ${params.path} ».` }] };
    },
  });

  pi.registerTool({
    name: "delegate_to_coder",
    label: "Delegate to Coder",
    description:
      "Déléguer une demande de modification de code à l'agent standard du projet actif (pi/plh de coding). Ouvre son onglet (le rend visible) et lui envoie la demande dans sa session de discussion. À utiliser quand l'utilisateur demande une modification de code sur le projet actif. Bloque jusqu'à ce que Pilot ait transmis la demande.",
    promptSnippet: "delegate_to_coder: déléguer une demande de code à l'agent du projet actif",
    promptGuidelines: [
      "Use delegate_to_coder when the user asks for a code modification on the active project. The request is sent to the project's coding agent (pi/plh), which opens its tab and receives the request in its discussion. Only delegate actual code work — for simple questions about how something works, answer directly.",
    ],
    parameters: Type.Object({
      request: Type.String({ description: "La demande de code à transmettre à l'agent du projet" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "delegate_to_coder", request: params.request });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        return { content: [{ type: "text", text: "La demande a été transmise à l'agent du projet (son onglet est ouvert)." }] };
      }
      return { content: [{ type: "text", text: "Échec de la transmission de la demande à l'agent du projet." }] };
    },
  });
}
