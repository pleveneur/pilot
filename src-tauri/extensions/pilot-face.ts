// Pilot Face — pilotage du VISAGE (PLface) par l'assistant, sans dépendance.
//
// La passerelle MCP d'origine (projet PLface/mcp/plface-mcp.js) exigeait Node et
// un CHEMIN FIXE vers le projet du visage : inutilisable sur un poste sans ces
// éléments. Cette extension embarque la MÊME passerelle DANS Pilot : elle
// enregistre les mêmes outils (set_expression, get_status, set_position, reset)
// et parle directement à l'API locale du visage (http://127.0.0.1:3000), sans
// processus externe, sans Node, sans chemin de projet.
//
// Le cœur (traduction outil → HTTP, messages d'erreur) vit dans
// `face-gateway.js`, écrit à côté de cette extension et importé ci-dessous :
//   - une seule copie logique, testée par Vitest (src/js/face-gateway.test.js) ;
//   - `fetch` et `AbortController` sont fournis par le runtime de pi.
//
// Fail-open : si le visage est éteint ou injoignable, l'outil renvoie un message
// clair — jamais d'exception, jamais de plantage de la session.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_FACE_API_URL, runFaceTool } from "./face-gateway.js";

type FaceResult = { ok: boolean; text: string; error: string };

/** Formate un résultat d'outil pour pi (texte + indicateur d'erreur). */
function toToolResult(res: FaceResult) {
  return {
    content: [{ type: "text" as const, text: res.ok ? res.text : res.error }],
    isError: !res.ok,
  };
}

export default function (pi: ExtensionAPI) {
  // URL de l'API locale du visage (surchargeable via l'environnement).
  const baseUrl = process.env.PILOT_FACE_API_URL || DEFAULT_FACE_API_URL;

  pi.registerTool({
    name: "set_expression",
    label: "Set Expression",
    description:
      "Applique une expression faciale au visage PLface. Émotions acceptées " +
      "(insensibles à la casse) : smile (happy, content), wink (blink), " +
      "nod (yes, oui), shake (no, non), angry (anger, colere, colère), " +
      "sad (triste), surprised (surprise), neutral (reset).",
    promptSnippet: "set_expression: appliquer une expression au visage (smile, wink, angry…)",
    promptGuidelines: [
      "Use set_expression to apply a facial emotion to the PLface avatar. Pass `emotion` as a name like smile, wink, nod, shake, angry, sad, surprised or neutral (aliases allowed, case-insensitive).",
    ],
    parameters: Type.Object({
      emotion: Type.String({
        description: "Nom de l'émotion (ex. smile, angry, nod, neutral…).",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const res = await runFaceTool("set_expression", params, { baseUrl });
      return toToolResult(res);
    },
  });

  pi.registerTool({
    name: "get_status",
    label: "Get Face Status",
    description:
      "Vérifie que le visage PLface répond et renvoie l'état de son API locale.",
    promptSnippet: "get_status: vérifier que le visage répond",
    promptGuidelines: [
      "Use get_status to check that the PLface avatar is running and reachable.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      const res = await runFaceTool("get_status", {}, { baseUrl });
      return toToolResult(res);
    },
  });

  pi.registerTool({
    name: "set_position",
    label: "Set Face Position",
    description:
      "Déplace la fenêtre du visage sur l'écran, en pixels (coin supérieur " +
      "gauche de l'écran = 0,0).",
    promptSnippet: "set_position: déplacer la fenêtre du visage (x, y)",
    promptGuidelines: [
      "Use set_position to move the PLface window on screen. Pass integer `x` and `y` in pixels.",
    ],
    parameters: Type.Object({
      x: Type.Number({ description: "Position horizontale en pixels." }),
      y: Type.Number({ description: "Position verticale en pixels." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const res = await runFaceTool("set_position", params, { baseUrl });
      return toToolResult(res);
    },
  });

  pi.registerTool({
    name: "reset",
    label: "Reset Face",
    description: "Remet le visage au repos (annule l'expression en cours).",
    promptSnippet: "reset: remettre le visage au repos",
    promptGuidelines: ["Use reset to return the PLface avatar to its neutral state."],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute() {
      const res = await runFaceTool("reset", {}, { baseUrl });
      return toToolResult(res);
    },
  });
}
