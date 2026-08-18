// Pilot Assistant Sessions — vue d'ensemble des sessions d'agents (P2).
//
// L'assistant (onglet 🧭) doit pouvoir superviser l'état de toutes les sessions
// d'agents pour coordonner le travail. Cette extension lui fournit un outil :
//   - list_agent_sessions() → retourne la liste des sessions avec, pour chacune :
//       project, agent, mode (main/agent_process), state (active/parked), alive,
//       visible, active (pointeur du chat principal) et, si une activité a été
//       enregistrée, lastActivity (timestamp ISO), lastActivityRelative
//       (« il y a X min ») et lastEvent (type du dernier événement RPC).
//
// Mécanisme : l'outil envoie un `ctx.ui.input` préfixé par un sentinel. En mode
// RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout et BLOQUE pi
// jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot intercepte le
// sentinel (super-agent.js), exécute la commande Rust `list_agent_sessions` et
// renvoie le résultat (JSON) comme `value` de la réponse. L'outil retourne ce
// résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil list_agent_sessions. Pilot le
// détecte dans le `input` reçu et exécute la commande au lieu d'afficher un champ
// de saisie.
const SESSIONS_SENTINEL = "PILOT_ASSISTANT_SESSIONS::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "list_agent_sessions",
    label: "List Agent Sessions",
    description:
      "Lister l'état de toutes les sessions d'agents (projet, agent, mode, état, vivacité, visibilité, actif) et leur dernière activité (lastActivity ISO, lastActivityRelative « il y a X min », lastEvent). Retourne une liste JSON. Utilise-la pour superviser quels agents tournent, sont en arrière-plan (parked) ou arrêtés, et pour juger si un agent progresse réellement (dernière activité récente) avant de décider d'une délégation ou d'un arrêt.",
    promptSnippet: "list_agent_sessions: superviser l'état et la dernière activité de toutes les sessions d'agents",
    promptGuidelines: [
      "Use list_agent_sessions to get an overview of all agent sessions before delegating work or deciding to stop an agent. It returns for each session: project, agent, mode (main/agent_process), state (active/parked), alive (process running), visible (tab open), active (current chat pointer), and — when activity was recorded — lastActivity (ISO timestamp), lastActivityRelative (e.g. 'il y a 2 min') and lastEvent (type of the last RPC event).",
      "Use lastActivity / lastActivityRelative to judge whether an agent is actually progressing before stopping it: an agent with a recent lastActivity is still working, even if it has not streamed visible output for a while. Only consider stopping an agent that is truly idle (no activity for a long time).",
      "Use it to check whether an agent is already running (active) or parked in the background before launching a new run or stopping one.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(SESSIONS_SENTINEL, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
