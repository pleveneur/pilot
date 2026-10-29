// Pilot Choices — boutons de choix / confirmation / saisie (issue #30).
//
// L'agent (LLM) écrit parfois ses questions de choix en texte libre
// (« Quel choix veux-tu ? A, B ou C ? »), ce qui oblige l'utilisateur à taper.
// Cette extension enregistre des outils que le LLM peut appeler pour demander
// une interaction à l'utilisateur via des BOUTONS rendus par Pilot :
//   - ask_choice       → ctx.ui.select()  → Pilot affiche des boutons (1 choix)
//                          + champ de précision optionnel. La valeur renvoyée
//                          est un JSON `{ selected, note? }`.
//   - ask_multi_choice → ctx.ui.select()  → Pilot affiche des cases à cocher
//                          (plusieurs choix) — titre préfixé par un sentinel
//                          que Pilot interprète comme une multi-sélection.
//   - ask_confirm      → ctx.ui.select()  → Pilot affiche Oui / Non + champ de
//                          précision optionnel — titre préfixé par un sentinel
//                          que Pilot interprète comme une confirmation. La
//                          valeur renvoyée est un JSON `{ confirmed, note? }`.
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
// Sentinel préfixant le titre d'une confirmation Oui/Non. Pilot le détecte dans
// le `select` reçu et rend des boutons Oui/Non + un champ de précision optionnel.
// La valeur renvoyée est un JSON `{ confirmed: boolean, note?: string }`.
const CONFIRM_SENTINEL = "PILOT_CONFIRM::";

// EXCEPTION NOMMÉE — « QUESTION HUMAINE SANS ÉCHÉANCE ».
//
// En mode RPC, un `ctx.ui.*` émet un `extension_ui_request` et pi attend la
// réponse ; l'option `timeout` arme une minuterie qui, à l'échéance, DÉTACHE la
// question (`pendingExtensionRequests.delete(id)` côté pi) et rend la main à
// l'agent avec « pas de réponse ».
//
// Une échéance est légitime quand c'est une MACHINE qui attend (dialogue
// automatique, serveur MCP : cf. `PILOT_UI_OPTS` de `mcp-client.src.ts`). Elle
// ne l'est PAS quand c'est un HUMAIN qui doit répondre : passé le délai, l'agent
// abandonnait la question alors que l'écran laissait les boutons cliquables —
// un clic tardif était jeté en silence (défaut « la question expire sans
// prévenir », cf. `docs/diag-question-expiree-et-texte-repete.md`).
//
// Décision : les dialogues destinés à l'utilisateur de CE fichier n'ont AUCUNE
// échéance — ils restent valides jusqu'à sa réponse (ou son annulation).
// `HUMAN_DIALOG_NO_DEADLINE` est l'exception NOMMÉE, explicite et repérable :
// un objet d'options SANS champ d'échéance, donc pi n'arme aucune minuterie. Le
// garde-fou `src/js/extensions-ui-timeout.test.js` reconnaît ce nom et n'exige
// plus de borne pour ces appels ; il continue d'exiger une borne finie et
// plafonnée PARTOUT ailleurs.
const HUMAN_DIALOG_NO_DEADLINE = Object.freeze({});

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
      const choice = await ctx.ui.select(params.title, params.options, HUMAN_DIALOG_NO_DEADLINE);
      if (choice == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé le choix." }] };
      }
      // Pilot renvoie un JSON `{ selected: string, note?: string }`
      // (note = précision optionnelle saisie par l'utilisateur).
      let selected = "";
      let note = "";
      try {
        const parsed = JSON.parse(choice);
        if (typeof parsed === "string") {
          selected = parsed;
        } else if (parsed && typeof parsed === "object") {
          selected = typeof parsed.selected === "string" ? parsed.selected : "";
          note = typeof parsed.note === "string" ? parsed.note : "";
        }
      } catch {
        selected = choice;
      }
      const notePart = note ? `\nPrécision de l'utilisateur : ${note}` : "";
      if (!selected && note) {
        // Issue #39 : l'utilisateur a validé sans choisir d'option, avec une
        // précision libre.
        return { content: [{ type: "text", text: `Aucune option choisie par l'utilisateur.${notePart}` }] };
      }
      if (!selected) {
        return { content: [{ type: "text", text: "L'utilisateur n'a choisi aucune option." }] };
      }
      return { content: [{ type: "text", text: `Choix de l'utilisateur : ${selected}${notePart}` }] };
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
      const choice = await ctx.ui.select(MULTI_SENTINEL + params.title, params.options, HUMAN_DIALOG_NO_DEADLINE);
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
      // Titre préfixé par le sentinel + JSON {title, message} → Pilot rend des
      // boutons Oui/Non + un champ de précision optionnel. La valeur renvoyée
      // est un JSON `{ confirmed: boolean, note?: string }`.
      const choice = await ctx.ui.select(
        CONFIRM_SENTINEL + JSON.stringify({ title: params.title, message: params.message }),
        ["Oui", "Non"],
        HUMAN_DIALOG_NO_DEADLINE,
      );
      if (choice == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé la confirmation." }] };
      }
      let confirmed = false;
      let note = "";
      try {
        const parsed = JSON.parse(choice);
        if (typeof parsed === "string") {
          confirmed = parsed === "Oui";
        } else if (parsed && typeof parsed === "object") {
          confirmed = parsed.confirmed === true;
          note = typeof parsed.note === "string" ? parsed.note : "";
        }
      } catch {
        confirmed = choice === "Oui";
      }
      const notePart = note ? `\nPrécision de l'utilisateur : ${note}` : "";
      return {
        content: [{
          type: "text",
          text: confirmed
            ? `L'utilisateur a confirmé (Oui).${notePart}`
            : `L'utilisateur a refusé (Non).${notePart}`,
        }],
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
      const value = await ctx.ui.input(params.title, params.placeholder || "", HUMAN_DIALOG_NO_DEADLINE);
      if (value == null) {
        return { content: [{ type: "text", text: "L'utilisateur a annulé la saisie." }] };
      }
      return { content: [{ type: "text", text: `Saisie de l'utilisateur : ${value}` }] };
    },
  });
}
