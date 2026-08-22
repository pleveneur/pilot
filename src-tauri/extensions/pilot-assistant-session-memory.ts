// Pilot Assistant Session Memory — mémoire de session de l'assistant (reprise).
//
// Après un redémarrage de Pilot, la session RPC du super-agent repart de zéro
// (--no-session) : l'assistant n'a plus aucune idée d'où on en était. Cette
// extension lui fournit un outil :
//   - update_session_memory(resume) → enregistre un résumé compact et versionné
//     du sujet en cours / des chantiers en cours, persisté sur disque par Pilot.
//
// Pilot réinjecte automatiquement ce résumé au début du premier message après
// redémarrage (« Mémoire de session (reprise) »), pour que l'assistant reprenne
// naturellement là où il s'était arrêté.
//
// Mécanisme : l'outil envoie le payload via `ctx.ui.input` préfixé par un
// sentinel. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur
// stdout et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`.
// Pilot intercepte le sentinel (super-agent.js), exécute la commande Rust
// `super_agent_save_session_memory` et renvoie le résultat (JSON) comme `value`
// de la réponse. L'outil retourne ce résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil update_session_memory. Pilot
// le détecte dans le `input` reçu et enregistre la mémoire au lieu d'afficher
// un champ de saisie.
const MEMORY_SAVE_SENTINEL = "PILOT_ASSISTANT_MEMORY_SAVE::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "update_session_memory",
    label: "Update Session Memory",
    description:
      "Enregistrer ta mémoire de session (résumé compact et versionné de la discussion en cours et des chantiers en cours avec leur avancement). Pilot la réinjecte automatiquement au début de ta session après un redémarrage de Pilot, pour que tu reprennes naturellement là où tu t'étais arrêté. Utilise-la à la fin d'un chantier, à un changement de sujet, avant de reprendre une discussion importante, ou quand l'utilisateur te demande explicitement de te souvenir.",
    promptSnippet: "update_session_memory: mémoriser le sujet et les chantiers en cours",
    promptGuidelines: [
      "Use update_session_memory to persist a compact session memory (a structured JSON object string) describing where you are: the current topic of discussion, the active project, the work in progress (projects with their titles and status) and short notes. It lets you resume naturally after a Pilot restart, since your session has no memory across restarts.",
      "Call it when a milestone/work package is finished, when the discussion topic changes, when the user asks you to 'remember' / 'take it up later' ('reprendre', 'retenir'), or at the end of a substantial exchange you want to be able to resume.",
      "The `resume` parameter is a JSON object, for example: {\"current_topic\": \"...\", \"active_project\": \"...\", \"work_in_progress\": [{\"project\": \"...\", \"title\": \"...\", \"status\": \"...\"}], \"notes\": \"...\"}. Keep it compact and factual (aim for a few hundred characters); it is bounded on the Pilot side.",
    ],
    parameters: Type.Object({
      resume: Type.String({
        description:
          "Objet JSON compact et structuré : { current_topic, active_project, work_in_progress: [{project, title, status}], notes }. Résume où on en est pour reprendre la discussion après un redémarrage.",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(MEMORY_SAVE_SENTINEL + params.resume, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
