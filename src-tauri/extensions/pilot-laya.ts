// Pilot Laya — l'agent classe un texte AVEC le service Laya local, sans modèle
// de langage et sans charger aucun modèle dans sa propre session.
//
// Le service Laya est UNIQUE et lancé/surveillé par Pilot (patron `laya.rs`) :
// il garde le modèle de classification (≈ 1,6 Gio) en mémoire pour toute
// l'application. Cette extension ne parle QUE par appel local HTTP
// (http://127.0.0.1:3017) : elle ne charge jamais de modèle, ne démarre jamais
// de service, n'installe rien. Deux sessions d'agent qui utilisent l'outil
// partagent donc le MÊME processus et la MÊME mémoire.
//
// Le cœur (question typée → question du service, appel HTTP, mise en forme de
// la réponse avec sa confiance, messages de panne) vit dans `laya-gateway.js`,
// écrit à côté de cette extension et importé ci-dessous :
//   - une seule copie logique, testée par Vitest (src/js/laya-gateway.test.js) ;
//   - `fetch` et `AbortController` sont fournis par le runtime de pi.
//
// Fail-open : service éteint ou modèle non prêt, l'outil renvoie un message
// clair — jamais d'exception, jamais de plantage de la session.
//
// Le modèle ne produit AUCUN texte : il choisit parmi les libellés fournis,
// note sur l'échelle fournie, ou répond oui/non.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULT_LAYA_API_URL,
  askLaya,
  buildLayaQuestion,
  formatLayaAnswer,
  readLayaAnswer,
  validateLayaQuestion,
} from "./laya-gateway.js";

/** Formate un résultat pour pi (texte + indicateur d'erreur). */
function toolResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

export default function (pi: ExtensionAPI) {
  // URL du service local (surchargeable via l'environnement, comme le visage).
  const baseUrl = process.env.PILOT_LAYA_API_URL || DEFAULT_LAYA_API_URL;

  pi.registerTool({
    name: "laya_classify",
    label: "Laya Classify",
    description:
      "Classe un texte en choisissant parmi les libellés fournis, en le notant " +
      "sur l'échelle fournie, ou en répondant oui/non, et renvoie la réponse " +
      "avec sa confiance (answer_confidence) — un classement local instantané qui " +
      "ne produit aucun texte : à utiliser pour toute décision fermée et bon " +
      "marché (trier, modérer, juger une urgence, estimer une difficulté) avant " +
      "de mobiliser un modèle de langage, jamais pour résumer, expliquer ou rédiger.",
    promptSnippet:
      "laya_classify: classer un texte (choix parmi des libellés, note sur une échelle, oui/non) et obtenir la réponse avec sa confiance",
    promptGuidelines: [
      "Use laya_classify when you need a cheap, closed decision on a text: pick a label among options (type \"choice\"), rate it on a scale (type \"score\"), or answer yes/no (type \"noul\"). It returns the label/score/yes-no with `answer_confidence`.",
      "Use laya_classify BEFORE spending a language model on a simple judgement (triage, routing, moderation, urgency, difficulty). It never writes text: do not ask it to summarise, explain or paraphrase — ask a language model for that.",
      "In `instructions`, name the text you want judged with the backticked placeholder `body` (the service binds the text to `body`), e.g. \"Which team should handle `body`?\".",
      "Pass `options` with at least two entries for type \"choice\" (the possible labels) and \"score\" (the levels, from lowest to highest); \"noul\" needs no options.",
    ],
    parameters: Type.Object({
      text: Type.String({
        description: "Le texte à classer (le message, la demande, le texte à juger).",
      }),
      type: Type.String({
        enum: ["choice", "score", "noul"],
        description:
          "Type de question : \"choice\" (choisir parmi les libellés fournis), \"score\" (noter sur l'échelle fournie), \"noul\" (oui/non).",
      }),
      instructions: Type.String({
        description:
          "La question posée au classement, en langage clair, en désignant le texte par `body` (ex. « Quel domaine couvre `body` ? »).",
      }),
      options: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Libellés possibles (type \"choice\", au moins deux) ou niveaux de l'échelle du plus bas au plus haut (type \"score\", au moins deux). Inutile pour \"noul\".",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const question = {
        type: params.type,
        instructions: params.instructions,
        options: params.options,
      };
      const invalid = validateLayaQuestion(question);
      if (invalid) return toolResult(invalid, true);

      const res = await askLaya({
        baseUrl,
        text: params.text,
        questions: buildLayaQuestion(question),
      });
      if (!res.ok) return toolResult(res.error, true);

      const answer = readLayaAnswer(res.answers);
      const ms = res.ms === null ? "" : ` en ${res.ms} ms`;
      return toolResult(`Laya : ${formatLayaAnswer(answer)}${ms}`);
    },
  });
}
