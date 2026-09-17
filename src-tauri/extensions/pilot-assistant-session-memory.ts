// Pilot Assistant Session Memory — mémoire de session de l'assistant (reprise).
//
// Après un redémarrage de Pilot, la session RPC du super-agent repart de zéro
// (--no-session) : l'assistant n'a plus aucune idée d'où on en était. Cette
// extension lui fournit trois outils :
//   - update_session_memory(resume) → enregistre un résumé compact et versionné
//     du sujet en cours / des chantiers en cours, persisté sur disque par Pilot.
//   - remove_session_memory(target, field?) → retire UN fait précis du résumé
//     (une entrée de work_in_progress, par rang ou par texte, ou le contenu d'un
//     champ texte simple) sans réécrire toute la mémoire. Le fait retiré part
//     dans une corbeille bornée, donc annulable.
//   - restore_session_memory(id?) → remet en place un retrait (par son id, ou le
//     plus récent si l'id est absent).
//   - list_session_memory_trash() → liste les retraits en attente dans la
//     corbeille bornée (identifiant, type, date, aperçu court du contenu), du
//     plus récent au plus ancien.
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
// Sentinel préfixant le titre d'un `input` d'outil remove_session_memory. La
// charge utile est un JSON { target, field? } ; Pilot l'intercepte, exécute le
// retrait ciblé (commande Rust `super_agent_remove_session_memory`) et renvoie
// le résultat en JSON.
const MEMORY_REMOVE_SENTINEL = "PILOT_ASSISTANT_MEMORY_REMOVE::";
// Sentinel préfixant le titre d'un `input` d'outil restore_session_memory. La
// charge utile est un JSON { id? } ; Pilot l'intercepte, restaure le retrait
// (commande Rust `super_agent_restore_session_memory`) et renvoie le résultat
// en JSON.
const MEMORY_RESTORE_SENTINEL = "PILOT_ASSISTANT_MEMORY_RESTORE::";
// Sentinel préfixant le titre d'un `input` d'outil list_session_memory_trash.
// La charge utile est un JSON vide {} ; Pilot l'intercepte, parcourt la
// corbeille (commande Rust `super_agent_list_session_memory_trash`) et renvoie
// la liste des retraits en attente en JSON.
const MEMORY_TRASH_LIST_SENTINEL = "PILOT_ASSISTANT_MEMORY_TRASH_LIST::";

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

  pi.registerTool({
    name: "remove_session_memory",
    label: "Remove Session Memory",
    description:
      "Retirer un fait précis de ta mémoire de session sans réécrire tout le résumé (contrairement à update_session_memory) : un travail en cours (par son rang dans la liste work_in_progress, ou par le texte de son projet / de son titre) ou le contenu d'un champ texte simple (par exemple notes, current_topic, active_project). À utiliser dès qu'un fait mémorisé est devenu faux, périmé ou obsolète. Ce qui est retiré n'est pas perdu : il part dans une corbeille bornée et peut être remis en place avec restore_session_memory.",
    promptSnippet: "remove_session_memory: retirer un fait précis devenu faux ou périmé",
    promptGuidelines: [
      "Use remove_session_memory to remove ONE stale or incorrect fact from your session memory instead of rewriting the whole resume with update_session_memory.",
      "To remove a work-in-progress entry, pass `target`: either its 1-based position in the work_in_progress list (as a string, e.g. \"2\") or a text fragment of its `project` / `title` field.",
      "To empty a simple text field of the resume instead, pass `field` (\"notes\", \"current_topic\", \"active_project\"); `target` is then ignored. At least one of `target` / `field` is required.",
      "The removed fact goes to a bounded trash and can be restored with restore_session_memory, so removing is safe. The result carries `trash_id`, the identifier of the removal you just made (use it with restore_session_memory if you want to undo that specific removal).",
    ],
    parameters: Type.Object({
      target: Type.Optional(
        Type.String({
          description:
            "Rang 1-based du travail en cours à retirer (ex: \"2\") ou fragment de texte de son projet / titre. Ignoré si `field` est fourni.",
        }),
      ),
      field: Type.Optional(
        Type.String({
          description:
            "Nom d'un champ texte simple à vider (ex: notes, current_topic). Si fourni, `target` est ignoré.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        target: params.target ?? "",
        field: params.field ?? "",
      });
      const result = await ctx.ui.input(MEMORY_REMOVE_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "restore_session_memory",
    label: "Restore Session Memory",
    description:
      "Remettre en place un fait de mémoire de session précédemment retiré avec remove_session_memory. Désigne le retrait par son identifiant (`id`), ou restaure le retrait le plus récent si aucun identifiant n'est donné. À utiliser quand un fait retiré s'avère finalement encore utile ou exact.",
    promptSnippet: "restore_session_memory: remettre en place un fait de mémoire retiré",
    promptGuidelines: [
      "Use restore_session_memory to undo a previous remove_session_memory: a work-in-progress entry or an emptied text field is put back into the session memory.",
      "Pass `id` to restore a specific removal; if omitted, the most recent removal is restored.",
      "Prefer remove_session_memory + restore_session_memory over rewriting the whole memory when you only need to undo one change.",
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({
          description:
            "Identifiant du retrait à restaurer. Omis → le retrait le plus récent est remis en place.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ id: params.id ?? "" });
      const result = await ctx.ui.input(MEMORY_RESTORE_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "list_session_memory_trash",
    label: "List Session Memory Trash",
    description:
      "Lister les faits de mémoire de session que tu as retirés avec remove_session_memory et qui sont encore en attente de remise en place. Renvoie chaque retrait avec son identifiant, son type, sa date et un aperçu court de son contenu, du plus récent au plus ancien. À utiliser avant restore_session_memory quand le retrait à remettre en place n'est pas le plus récent : cela évite d'annuler un par un les retraits plus récents.",
    promptSnippet: "list_session_memory_trash: voir les retraits de mémoire encore remisables",
    promptGuidelines: [
      "Use list_session_memory_trash to see which removals are still restorable (bounded trash, most recent first), with each entry's `id`, type, date and a short preview of the removed content.",
      "Call it before restore_session_memory when the removal you want to undo is probably not the most recent one: pick the `id` of the right entry, then restore it with restore_session_memory.",
      "The trash only keeps the most recent removals (bounded), so an older removal may no longer be listed.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({});
      const result = await ctx.ui.input(MEMORY_TRASH_LIST_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
