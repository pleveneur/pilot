// Pilot Persona Fiche — la SEULE écriture autorisée en « Discussion seulement
// via llama » : la propre fiche du personnage actif
// (docs/conceptions/CONCEPTION-personnage-discussion-seule-via-llama.md § 4).
//
// Cette extension n'est chargée QUE dans la session de l'assistant quand la case
// du personnage actif est cochée : le personnage n'a alors AUCUN outil de travail
// (aucun agent, aucun fichier de projet, aucune base de suivi) — seulement
// celui-ci. Un outil de travail appelé par erreur reçoit une réponse qui le lui
// dit, sans rien exécuter.
//
// Outil fourni :
//   - ecrire_ma_fiche(ce_qu_il_est?, ton_et_parler?, appel_du_proprietaire?,
//     ce_qu_il_fait?, ce_qu_il_ne_fait_jamais?, force?)
//
// Mécanisme (identique à `update_my_prompt`, éprouvé) : l'outil envoie les
// valeurs via `ctx.ui.input` préfixé par une sentinelle. Pilot intercepte,
// écrit dans `fiche.json` du personnage actif par la commande Rust
// `persona_fiche_write` (contrôles : champs de contenu seulement, passage du
// propriétaire protégé, version précédente gardée), et renvoie le compte rendu
// comme `value`. Rien n'est écrit par le modèle lui-même.
//
// Deux modes, un seul comportement d'écriture :
//   - discussion écrite : un passage du propriétaire n'est pas réécrit ; Pilot
//     répond « Ça, c'est toi qui l'as écrit. Je le change quand même ? » et le
//     personnage ne rappelle l'outil qu'après un oui franc (force: true) ;
//   - mode Vocal : aucune question n'est posée ; la modification est abandonnée
//     et une phrase le dit (§ 4.5).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Sentinelle machine : le front l'intercepte, Rust écrit, la valeur revient. */
const FICHE_SENTINEL = "PILOT_PERSONA_FICHE::";

// Garde-fou anti-blocage (même raison que `update_my_prompt`) : en mode RPC, un
// `ctx.ui.*` émet un `extension_ui_request` et pi attend la réponse sans limite
// de temps. On borne l'attente pour ne jamais figer la session.
const PILOT_UI_OPTS = { timeout: 120000 };

const CONTENT_KEYS = [
  "ce_qu_il_est",
  "ton_et_parler",
  "appel_du_proprietaire",
  "ce_qu_il_fait",
  "ce_qu_il_ne_fait_jamais",
] as const;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ecrire_ma_fiche",
    label: "Écrire dans ma fiche",
    description:
      "Écrire dans TA fiche (Présences) un passage que le propriétaire vient de te dire sur toi : ce que tu es, ton ton, comment tu l'appelles, ce que tu fais, ce que tu ne fais jamais. Donne la valeur VOULUE du champ, jamais un commentaire ni ta réflexion. Seul le passage que tu as toi-même écrit peut être réécrit ; l'ancienne version de la fiche est toujours gardée.",
    promptSnippet:
      "ecrire_ma_fiche: noter dans ta fiche ce que le propriétaire te dit de toi",
    promptGuidelines: [
      "Use ecrire_ma_fiche only for passages about YOURSELF that the owner just told you (identity, tone, how you address them, what you do, what you never do). Never write anything else: not the notebook, not the relationship tier, not the visual description, not Pilot settings, not project files.",
      "Give the WANTED VALUE of the field, in the owner's terms — never your reasoning, never a comment about what you are doing.",
      "If the tool answers that a passage was written by the owner, do not overwrite it: in written discussion ask once, plainly, and only call the tool again with force: true after a clear yes. In vocal mode, never ask: leave it as it is and say so in one short sentence.",
      "After a successful write, say what changed in one sentence and mention that the previous version is kept.",
    ],
    parameters: Type.Object({
      ce_qu_il_est: Type.Optional(Type.String({ description: "Ce que je suis." })),
      ton_et_parler: Type.Optional(Type.String({ description: "Mon ton et ma façon de parler." })),
      appel_du_proprietaire: Type.Optional(
        Type.String({ description: "Comment j'appelle le propriétaire." }),
      ),
      ce_qu_il_fait: Type.Optional(Type.String({ description: "Ce que je fais." })),
      ce_qu_il_ne_fait_jamais: Type.Optional(
        Type.String({ description: "Ce que je ne fais jamais." }),
      ),
      force: Type.Optional(
        Type.Boolean({
          description:
            "À n'utiliser qu'après un oui franc du propriétaire, quand l'outil a répondu que le passage lui appartient. Ignoré en mode Vocal.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const corps: Record<string, unknown> = {};
      for (const cle of CONTENT_KEYS) {
        const valeur = (params as Record<string, unknown>)[cle];
        if (typeof valeur === "string" && valeur.trim() !== "") corps[cle] = valeur;
      }
      if (params.force === true) corps.force = true;
      const result = await ctx.ui.input(FICHE_SENTINEL + JSON.stringify(corps), "", PILOT_UI_OPTS);
      if (result == null) {
        return {
          content: [
            {
              type: "text",
              text: "Écriture abandonnée : aucune réponse de Pilot (délai dépassé ou annulation). Ta fiche est restée telle quelle.",
            },
          ],
        };
      }
      return { content: [{ type: "text", text: String(result) }] };
    },
  });
}
