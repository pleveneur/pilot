// Pilot Assistant Sessions — vue d'ensemble des sessions d'agents (P2).
//
// L'assistant (onglet 🧭) doit pouvoir superviser l'état de toutes les sessions
// d'agents pour coordonner le travail. Cette extension lui fournit un outil :
//   - list_agent_sessions() → retourne la liste des sessions avec, pour chacune :
//       project, agent, mode (main/agent_process), state (active/parked), alive,
//       visible, active (pointeur du chat principal) et, si une activité a été
//       enregistrée, lastActivity (timestamp ISO), lastActivityRelative
//       (« il y a X min ») et lastEvent (type du dernier événement RPC).
//       Restitution (chantier fin-de-run) : pour les sessions vivantes, la
//       sessionId de la session pi est aussi exposée — l'assistant peut la
//       passer à get_delegation_result pour lire le résultat d'une délégation.
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

// Garde-fou anti-blocage (bug « agents figés ») : en mode RPC, un `ctx.ui.*`
// émet un `extension_ui_request` sur stdout et pi attend la réponse SANS
// limite de temps. Si Pilot ne répond pas (événement non routé, session
// occupée, réponse perdue), l'outil ne rendait JAMAIS la main : la session
// restait « occupée » et réservait la file d'attente du projet jusqu'à l'arrêt
// par le watchdog. On borne donc l'attente : au-delà, pi résout la promesse
// (undefined / false) et l'outil retourne une erreur explicite au modèle au
// lieu de bloquer indéfiniment.
const PILOT_UI_OPTS = { timeout: 120000 };

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "list_agent_sessions",
    label: "List Agent Sessions",
    description:
      "Lister l'état des sessions d'agents (projet, agent, mode, état, vivacité, visibilité, actif) et leur dernière activité (lastActivity ISO, lastActivityRelative, lastEvent). Pour les sessions vivantes, expose aussi sessionId (à passer à get_delegation_result). ATTENTION : cet outil n'est PAS un outil de surveillance. Ne l'appelle JAMAIS pour suivre un agent que tu viens de lancer, ni dans une boucle, ni à intervalle régulier (y compris depuis une tâche planifiée) : cela fige ta propre session, occupe la file de travail et bloque les agents. Ne l'appelle que si l'UTILISATEUR te demande explicitement l'état des sessions. `state: \"parked\"` ne signifie PAS « arrêté » : c'est une session conservée en arrière-plan, et `active: false` signifie seulement que le pointeur du chat principal est ailleurs. Le lancement d'une tâche est déjà asynchrone : son résultat t'est transmis automatiquement, sans aucune surveillance de ta part.",
    promptSnippet: "list_agent_sessions: état des sessions d'agents (usage EXCEPTIONNEL, jamais pour surveiller un agent lancé)",
    promptGuidelines: [
      "NEVER call list_agent_sessions to monitor an agent you have just launched, in a loop, or on a schedule. Doing so freezes your own session and blocks the work queue. The launch is asynchronous: the result is delivered to you automatically, so no supervision is needed.",
      "Call it ONLY when the user explicitly asks about the state of the agent sessions.",
      "`state: \"parked\"` does NOT mean stopped: it is a session kept in the background. `active: false` only means the main chat pointer is elsewhere. Do not conclude that an agent died from these fields, and never relaunch a task because of them.",
      "When the user does ask: each line gives project, agent, mode (main/agent_process), state (active/parked), alive (process running), visible (tab open), active, and — when recorded — lastActivity, lastActivityRelative and lastEvent.",
      "For each alive session, the `sessionId` field (when present) is the pi session identifier: pass it to get_delegation_result to read the exact outcome of a delegated task (fall back to `agent_id` if missing).",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(SESSIONS_SENTINEL, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
