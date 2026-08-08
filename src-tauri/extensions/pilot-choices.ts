// Pilot Choices — boutons de choix / confirmation / saisie (issue #30).
//
// L'agent (LLM) écrit parfois ses questions de choix en texte libre
// (« Quel choix veux-tu ? A, B ou C ? »), ce qui oblige l'utilisateur à taper.
// Cette extension enregistre des outils que le LLM peut appeler pour demander
// une interaction à l'utilisateur via des BOUTONS rendus par Pilot :
//   - ask_choice       → ctx.ui.select()  → Pilot affiche des boutons (1 choix)
//   - ask_multi_choice → ctx.ui.select()  → Pilot affiche des cases à cocher
//                          (plusieurs choix) — titre préfixé par un sentinel
//                          que Pilot interprète comme une multi-sélection.
//   - ask_confirm      → ctx.ui.confirm() → Pilot affiche Oui / Non
//   - ask_input        → ctx.ui.input()  → Pilot affiche un champ texte
//
// En mode RPC, ctx.ui.* émet un `extension_ui_request` sur stdout et BLOQUE pi
// jusqu'à ce que Pilot renvoie un `extension_ui_response` (même mécanisme que la
// porte pré-écriture pilot-edit-gate). Le rendu des boutons est géré côté Pilot
// dans `handleExtensionUiRequest` (agent-pi.js).
//
// Les `promptSnippet` / `promptGuidelines` instruisent le LLM d'utiliser ces
// outils au lieu d'écrire la question en texte.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'une multi-sélection. Pilot le détecte dans le
// `select` reçu et rend des cases à cocher au lieu de boutons à choix unique.
// La valeur renvoyée est un JSON array de chaînes.
const MULTI_SENTINEL = "PILOT_MULTI_CHOICE::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_choice",
    label: "Ask Choice",
    description:
      "Demander à l'utilisateur de choisir UNE option parmi une liste. À utiliser quand vous avez besoin que l'utilisateur choisisse entre plusieurs options (approche, fichier, valeur...). Bloque jusqu'à ce que l'utilisateur clique sur un bouton.",
    promptSnippet: "ask_choice: demander à l'utilisateur de choisir UNE option (boutons)",
    promptGuidelines: [
      "Use ask_choice when you need the user to pick ONE option among several (approach, file, value...). Do NOT write the question as plain text — call ask_choice so Pilot renders clickable buttons.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Question / titre affiché à l'utilisateur" }),
      options: Type.Array(Type.String(), { description: "Options proposées (2 ou plus)" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const choice = await ctx.ui.select(params.title, params.options);
      if (choice == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé le choix." }] };
      }
      return { content: [{ type: "text", text: `Choix de l'utilisateur : ${choice}` }] };
    },
  });

  pi.registerTool({
    name: "ask_multi_choice",
    label: "Ask Multi Choice",
    description:
      "Demander à l'utilisateur de choisir UNE OU PLUSIEURS options (multi-sélection). À utiliser quand l'utilisateur peut sélectionner plusieurs options à la fois. Bloque jusqu'à ce que l'utilisateur valide.",
    promptSnippet: "ask_multi_choice: demander à l'utilisateur de choisir UN OU PLUSIEURS options (cases à cocher)",
    promptGuidelines: [
      "Use ask_multi_choice when the user can select SEVERAL options at once. Do NOT write the question as plain text — call ask_multi_choice so Pilot renders checkboxes.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Question / titre affiché à l'utilisateur" }),
      options: Type.Array(Type.String(), { description: "Options proposées" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Titre préfixé par le sentinel → Pilot rend une multi-sélection.
      // La valeur renvoyée est un JSON `{ selected: string[], note?: string }`
      // (note = précision optionnelle saisie par l'utilisateur).
      const choice = await ctx.ui.select(MULTI_SENTINEL + params.title, params.options);
      if (choice == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé le choix." }] };
      }
      let selected: string[] = [];
      let note = "";
      try {
        const parsed = JSON.parse(choice);
        if (Array.isArray(parsed)) {
          selected = parsed;
        } else if (parsed && typeof parsed === "object") {
          selected = Array.isArray(parsed.selected) ? parsed.selected : [];
          note = typeof parsed.note === "string" ? parsed.note : "";
        }
      } catch {
        selected = [choice];
      }
      const notePart = note ? `\nPrécision de l'utilisateur : ${note}` : "";
      return { content: [{ type: "text", text: `Choix de l'utilisateur : ${selected.join(", ")}${notePart}` }] };
    },
  });

  pi.registerTool({
    name: "ask_confirm",
    label: "Ask Confirm",
    description:
      "Demander une confirmation Oui/Non à l'utilisateur. À utiliser pour une validation avant une action importante ou potentiellement destructrice. Bloque jusqu'à ce que l'utilisateur clique sur Oui ou Non.",
    promptSnippet: "ask_confirm: demander une confirmation Oui/Non à l'utilisateur (boutons)",
    promptGuidelines: [
      "Use ask_confirm when you need a yes/no confirmation from the user before an important or destructive action. Do NOT write the question as plain text — call ask_confirm so Pilot renders Oui/Non buttons.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Titre de la confirmation" }),
      message: Type.String({ description: "Question détaillée" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ok = await ctx.ui.confirm(params.title, params.message);
      return {
        content: [{ type: "text", text: ok ? "L'utilisateur a confirmé (Oui)." : "L'utilisateur a refusé (Non)." }],
      };
    },
  });

  pi.registerTool({
    name: "ask_input",
    label: "Ask Input",
    description:
      "Demander une saisie libre (texte) à l'utilisateur. À utiliser quand vous avez besoin d'une valeur précise qui ne peut pas être un choix (nom, nombre, chemin...). Bloque jusqu'à ce que l'utilisateur valide.",
    promptSnippet: "ask_input: demander une saisie libre à l'utilisateur (champ texte)",
    promptGuidelines: [
      "Use ask_input when you need a free-form value from the user (name, number, path...) that cannot be expressed as a list of options.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Titre de la saisie" }),
      placeholder: Type.Optional(Type.String({ description: "Texte d'exemple" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const value = await ctx.ui.input(params.title, params.placeholder || "");
      if (value == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé la saisie." }] };
      }
      return { content: [{ type: "text", text: `Saisie de l'utilisateur : ${value}` }] };
    },
  });
}
