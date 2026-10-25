// Pilot Assistant Doc — répondre à partir de la documentation intégrée de Pilot.
//
// L'écran « ❓ Aide » disparaîtra : c'est l'assistant (onglet 🧭) qui répondra
// aux questions de mode d'emploi. Cette extension lui fournit UN outil :
//   - answer_from_documentation(question) → réponse tirée de la documentation
//     intégrée (handbook embarqué à la compilation), avec les sections de doc
//     qui recoupent la réponse et le drapeau « la documentation ne dit rien ».
//
// L'outil est LECTURE SEULE et n'a AUCUNE notion de projet : une seule entrée
// (la question). Aucun chemin de projet, aucun fichier, aucun historique — c'est
// l'inverse des outils de lecture de projet. Il ne refait aucun travail : Pilot
// exécute la commande déjà livrée `ask_help_doc` (socle `help::answer_from_handbook`).
//
// PLAFOND D'APPELS : UN SEUL appel par tour. Chaque appel renvoie toute la
// documentation au modèle (coût) : passé le premier, l'outil REFUSE avec un
// message clair, sans rien appeler, et l'assistant répond avec ce qu'il a. Le
// compteur est remis à zéro au début de chaque tour (`before_agent_start`).
//
// Mécanisme : l'outil envoie la question via `ctx.ui.input` préfixé par un
// sentinel. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur
// stdout et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`.
// Pilot intercepte le sentinel (super-agent.js), exécute la commande Rust
// `ask_help_doc` et renvoie le résultat structuré (JSON) comme `value` de la
// réponse. L'outil met ce résultat en forme pour le modèle.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le titre d'un `input` d'outil answer_from_documentation.
// Pilot le détecte dans le `input` reçu et exécute la commande au lieu
// d'afficher un champ de saisie. Le relais doit reconnaître EXACTEMENT cette
// valeur (test de câblage : assistant-outil-doc.test.js).
export const DOC_SENTINEL = "PILOT_ASSISTANT_DOC::";

/** Nom de l'outil, partagé avec le test de câblage. */
export const DOC_TOOL_NAME = "answer_from_documentation";

/** Plafond : un seul appel de l'outil par tour. */
export const DOC_MAX_CALLS_PER_TURN = 1;

// Garde-fou anti-blocage (bug « agents figés ») : en mode RPC, un `ctx.ui.*`
// émet un `extension_ui_request` sur stdout et pi attend la réponse SANS
// limite de temps. Si Pilot ne répond pas (événement non routé, session
// occupée, réponse perdue), l'outil ne rendrait JAMAIS la main : la session
// resterait « occupée » et réserverait la file d'attente du projet. On borne
// donc l'attente. La brique documentaire a son propre plafond de 120 s côté
// Rust : la borne de l'interface est placée AU-DESSUS, pour que le modèle voie
// l'erreur réelle de Pilot (modèle absent, panne) et non un silence.
const PILOT_UI_OPTS = { timeout: 180000 };

/**
 * Message de refus quand le plafond d'appels du tour est atteint. Il dit
 * POURQUOI (coût), QUOI FAIRE, et interdit d'inventer.
 */
export const DOC_CALL_LIMIT_MESSAGE =
  "REFUS : l'outil answer_from_documentation a déjà été utilisé pendant ce tour. " +
  "Un seul appel par tour est autorisé, car chaque appel renvoie toute la documentation " +
  "intégrée au modèle (le coût ne doit pas se multiplier). " +
  "Réponds maintenant avec la documentation déjà obtenue : si elle ne dit rien sur le " +
  "point demandé, dis-le clairement à l'utilisateur au lieu d'inventer, et propose de " +
  "préciser la question au prochain tour si besoin.";

/** Nombre d'appels déjà effectués pendant le tour en cours. */
let docCallsThisTurn = 0;

/**
 * Décision PURE du plafond (aucun effet de bord, testable seule) : autorise
 * tant que moins de `DOC_MAX_CALLS_PER_TURN` appels ont eu lieu dans le tour.
 * @param {number} callsAlreadyDone - appels déjà effectués pendant ce tour.
 */
export function docCapDecision(callsAlreadyDone: number): { allowed: boolean; message: string } {
  const done = Number.isFinite(callsAlreadyDone) ? Math.max(0, Math.floor(callsAlreadyDone)) : 0;
  if (done < DOC_MAX_CALLS_PER_TURN) return { allowed: true, message: "" };
  return { allowed: false, message: DOC_CALL_LIMIT_MESSAGE };
}

/** Remet le compteur du plafond à zéro (début d'un nouveau tour). */
export function resetDocCap(): void {
  docCallsThisTurn = 0;
}

/** Nombre d'appels effectués dans le tour en cours (lecture, pour les tests). */
export function docCallsInTurn(): number {
  return docCallsThisTurn;
}

/**
 * Met en forme la réponse de Pilot pour le modèle. **Fonction pure** :
 * - le texte de la réponse ;
 * - les sections de doc qui recoupent la réponse (recoupement approximatif) ;
 * - le drapeau « la documentation ne dit rien » quand c'est le cas, avec la
 *   consigne de le DIRE au lieu d'inventer ;
 * - la mention de coupure au plafond.
 * Un JSON illisible ou une erreur de Pilot est rendu honnêtement, jamais masqué.
 */
export function formatDocAnswer(raw: string): string {
  const text = String(raw ?? "");
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    // Pas du JSON (repli, message inattendu) : on ne cache rien.
    return text;
  }
  if (!payload || typeof payload !== "object") return text;
  if (payload.error) {
    return (
      "RECHERCHE DOCUMENTAIRE IMPOSSIBLE : " +
      String(payload.error) +
      "\nDis-le à l'utilisateur (réglage de modèle à vérifier) au lieu d'inventer une réponse."
    );
  }
  const answer = String(payload.answer ?? "").trim();
  const sections: string[] = Array.isArray(payload.cited_sections)
    ? payload.cited_sections.map((s: any) => String(s)).filter(Boolean)
    : [];
  const out: string[] = [];
  out.push(
    "Réponse tirée de la documentation INTÉGRÉE de Pilot (elle ne contient que ce qu'elle contient).",
  );
  if (payload.insufficient) {
    out.push(
      "⚠️ LA DOCUMENTATION NE DIT RIEN sur ce point. Dis-le clairement à l'utilisateur au lieu " +
        "d'inventer : n'affirme rien que la documentation ne contient pas, et propose de préciser " +
        "la question ou de vérifier directement dans l'application.",
    );
  }
  out.push(answer ? answer : "(la documentation n'a produit aucun texte de réponse)");
  if (sections.length > 0) {
    out.push(
      "Sections de la documentation recoupées (recoupement approximatif par titre, pas une citation exacte) : " +
        sections.join(" · "),
    );
  } else {
    out.push(
      "Aucune section de la documentation n'a été recoupée : la réponse ne s'appuie sur aucun titre identifié.",
    );
  }
  if (payload.truncated) {
    out.push(
      "Réponse coupée au plafond de la documentation : si l'utilisateur veut la suite, demande-lui " +
        "une précision (nouveau tour ⇒ nouvel appel autorisé).",
    );
  }
  return out.join("\n\n");
}

export default function (pi: ExtensionAPI) {
  // Nouveau tour (message de l'utilisateur, ou message injecté qui déclenche un
  // tour) ⇒ le plafond d'appels repart de zéro. Un seul point de remise à zéro.
  pi.on("before_agent_start", () => {
    resetDocCap();
  });

  pi.registerTool({
    name: DOC_TOOL_NAME,
    label: "Answer From Documentation",
    description:
      "Répondre à une question de MODE D'EMPLOI de Pilot en s'appuyant sur la documentation intégrée (handbook embarqué) : une seule entrée, la question. Lecture seule : ne lit aucun fichier du projet, n'impose aucun projet, n'écrit rien. Retourne le texte de la réponse, les sections de documentation qui recoupent la réponse, et le drapeau « la documentation ne dit rien » (insufficient). UN SEUL APPEL PAR TOUR : un deuxième appel est refusé. À utiliser quand l'utilisateur demande comment se sert ou se règle Pilot (pas pour du code du projet).",
    promptSnippet:
      "answer_from_documentation: répondre sur le mode d'emploi de Pilot (documentation intégrée, 1 appel par tour)",
    promptGuidelines: [
      "Use answer_from_documentation when the user asks HOW TO USE OR CONFIGURE Pilot (a feature, a setting, where a button is, how something works). Pass only the question: no project path, no file, no history.",
      "This is the ONLY source for user-facing help: never invent a Pilot feature, setting or button that the answer does not contain. If the result carries insufficient: true, tell the user plainly that the built-in documentation says nothing about it, and offer to refine the question.",
      "ONE CALL PER TURN. A second call in the same turn is refused on purpose (each call sends the whole documentation to the model). Accept the refusal: answer with what you already have, or say what is missing and ask the user to refine the question in the next turn.",
      "The cited_sections field is an approximate title match inside the documentation, never an exact quote or a guaranteed source: do not present it as a precise reference.",
      "Do not use it for questions about the project's own code or files: for that, use the project's agents or your project tools.",
    ],
    parameters: Type.Object({
      question: Type.String({
        description:
          "La question de l'utilisateur sur le mode d'emploi / le paramétrage de Pilot (texte libre).",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Plafond AVANT tout appel : passé le premier, l'outil refuse et n'appelle
      // rien (aucun coût, aucun accès à Pilot).
      const verdict = docCapDecision(docCallsThisTurn);
      if (!verdict.allowed) {
        return { content: [{ type: "text", text: verdict.message }] };
      }
      const question = String(params?.question ?? "").trim();
      if (!question) {
        return {
          content: [
            {
              type: "text",
              text: "Question vide : donne la question de l'utilisateur sur le mode d'emploi de Pilot.",
            },
          ],
        };
      }
      docCallsThisTurn += 1;
      const result = await ctx.ui.input(DOC_SENTINEL + question, "", PILOT_UI_OPTS);
      if (result == null) {
        return {
          content: [
            {
              type: "text",
              text: "Recherche documentaire annulée. Aucune réponse de Pilot (délai dépassé ou annulation) : dis à l'utilisateur que la documentation n'a pas pu être consultée, au lieu d'inventer.",
            },
          ],
        };
      }
      return { content: [{ type: "text", text: formatDocAnswer(result) }] };
    },
  });
}
