// Pilot PDF — l'agent convertit un ou plusieurs fichiers Markdown en PDF, SANS
// fenêtre d'impression, SANS dialogue bloquant, SANS figer l'application.
//
// POURQUOI CETTE EXTENSION : la seule façon d'obtenir un PDF dans Pilot passait
// par l'aperçu puis la fenêtre d'impression du système — aucun outil n'était
// exposé aux agents, donc « fais-moi un PDF » ne pouvait RIEN produire, ou
// produisait un blocage. Cet outil comble le trou avec le MÊME mécanisme que les
// autres actions internes de Pilot : le titre d'un `ctx.ui.input` porte une
// sentinelle machine (`PILOT_PDF_EXPORT::<JSON>`), la fenêtre l'intercepte,
// exécute la commande Rust `markdown_to_pdf` (moteur PDF embarqué, hors fil
// d'affichage) et renvoie le rapport JSON comme `value` de la réponse.
//
// Le cœur (sentinelle, normalisation de la demande, mise en forme du rapport et
// des erreurs) vit dans `pdf-gateway.js`, écrit à côté de cette extension et
// importé ci-dessous : une seule copie logique, testée par Vitest
// (src/js/pdf-gateway.test.js), partagée avec la fenêtre.
//
// CE QUE L'OUTIL NE FAIT JAMAIS :
//   - il n'imprime rien, n'ouvre aucune fenêtre, ne demande aucun dialogue ;
//   - il n'invente pas de succès : le rapport vient de Pilot, qui RELIT sur le
//     disque chaque fichier écrit (signature `%PDF`) ;
//   - il ne remplace pas un échec par du silence : chaque source échouée est
//     nommée avec sa raison.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PDF_EXPORT_SENTINEL,
  formatPdfToolResult,
  normalizePdfRequest,
} from "./pdf-gateway.js";

// BORNE D'ATTENTE du dialogue avec Pilot, écrite en LITTÉRAL : le garde-fou
// statique `src/js/extensions-ui-timeout.test.js` lit le source et ne peut pas
// évaluer un import — il exige une valeur numérique finie et plafonnée à
// l'endroit de l'appel. La valeur de RÉFÉRENCE reste `PDF_UI_TIMEOUT_MS`
// (pdf-gateway.js), et `src/js/pdf-gateway.test.js` vérifie que les deux sont
// ÉGALES : impossible de les faire diverger en silence.
const PILOT_UI_OPTS = { timeout: 180_000 };

/** Formate un résultat pour pi (texte + indicateur d'erreur). */
function toolResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "export_markdown_pdf",
    label: "Export Markdown PDF",
    description:
      "Convertit un ou plusieurs fichiers Markdown (.md) en de VRAIS fichiers PDF " +
      "écrits sur le disque, SANS fenêtre d'impression et SANS dialogue, et " +
      "retourne le chemin de chaque PDF produit (plus la raison de chaque échec). " +
      "La conversion se fait hors du fil d'affichage : l'application reste " +
      "utilisable pendant le travail. Les fichiers sont traités un par un : " +
      "l'échec d'un document n'annule pas les autres. À utiliser dès qu'un PDF est " +
      "demandé ou qu'un document doit être livré en PDF.",
    promptSnippet:
      "export_markdown_pdf: convertir un ou plusieurs Markdown en PDF réel sur le disque (sans fenêtre d'impression)",
    promptGuidelines: [
      "Use export_markdown_pdf when the user asks for a PDF, or when a deliverable must be produced as PDF. Pass ABSOLUTE paths of the .md files in `sources`.",
      "Pass `out_dir` (absolute directory) ONLY when a specific destination was asked for. Without it, each PDF is written next to its Markdown source with the same name and the .pdf extension.",
      "The tool writes real files and returns their paths: after calling it, tell the user the produced paths. Never claim a PDF exists without this tool's answer.",
      "A failure on one file does not cancel the others: read `results` and say exactly which file failed and why.",
      "Never ask for a print dialog or for a PDF through a confirmation dialog: this tool needs none.",
    ],
    parameters: Type.Object({
      sources: Type.Array(
        Type.String({ description: "Chemin ABSOLU d'un fichier .md à convertir" }),
        { description: "Les fichiers Markdown à convertir, un par un" },
      ),
      out_dir: Type.Optional(
        Type.String({
          description:
            "Dossier ABSOLU de destination (optionnel). Sans lui, chaque PDF est écrit à côté de son Markdown.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const request = normalizePdfRequest({
        sources: params && params.sources,
        out_dir: params && params.out_dir,
      });
      if (request.error) return toolResult(request.error, true);
      const payload = JSON.stringify({ sources: request.sources, out_dir: request.out_dir });
      let answer: unknown = null;
      try {
        answer = await ctx.ui.input(PDF_EXPORT_SENTINEL + payload, "", PILOT_UI_OPTS);
      } catch (_e) {
        answer = null;
      }
      const formatted = formatPdfToolResult(answer);
      return toolResult(formatted.text, formatted.isError);
    },
  });
}
