// Pilot Assistant Prompt — auto-adaptation du prompt personnalisé de l'assistant.
//
// L'assistant (onglet 🧭) peut mettre à jour son propre prompt personnalisé au
// fil des discussions et des choix de l'utilisateur. Ce prompt est injecté à
// chaque message (dernier bloc du prompt système) : le modifier permet à
// l'assistant de prendre systématiquement en compte ce qu'il a appris
// (préférences, règles, contexte durable) sans intervention manuelle.
//
// Outil fourni :
//   - update_my_prompt(new_prompt) → remplace le prompt personnalisé (persisté
//     dans la config, pris en compte dès le prochain message, historique conservé).
//
// Mécanisme : l'outil envoie le nouveau prompt via `ctx.ui.input` préfixé par un
// sentinel. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout
// et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot
// intercepte le sentinel (super-agent.js), appelle la commande Rust
// `set_super_agent_prompt` et renvoie le résultat comme `value` de la réponse.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROMPT_SENTINEL = "PILOT_ASSISTANT_PROMPT::";

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
    name: "update_my_prompt",
    label: "Update My Prompt",
    description:
      "Mettre à jour ton propre prompt personnalisé (tes instructions durables). Utilise-le pour prendre systématiquement en compte ce que tu apprends des discussions et des choix de l'utilisateur : préférences, règles de travail, contexte durable. Le changement est persisté et pris en compte dès le prochain message.",
    promptSnippet: "update_my_prompt: adapter ton prompt à ce que tu as appris",
    promptGuidelines: [
      "Use update_my_prompt to update your persistent instructions when you learn durable preferences, rules, or context from the discussion. This makes you systematically take into account what you learn, without the user having to repeat it.",
      "Keep the prompt concise and focused on behavior, preferences, and durable rules. Do not remove critical safety instructions (you are strictly read-only on projects).",
      "For a significant rewrite, confirm with the user first (ask_confirm). For incremental updates reflecting clear user choices, you can proceed directly.",
      "The prompt is injected at every message (last block of your system prompt). Updating it changes how you behave from the next message onward.",
    ],
    parameters: Type.Object({
      new_prompt: Type.String({
        description: "Le nouveau contenu de ton prompt personnalisé (instructions durables).",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(PROMPT_SENTINEL + params.new_prompt, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Mise à jour du prompt annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
