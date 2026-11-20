// Pilot Bash Guard — garde-fou des commandes destructrices.
//
// FAIT MESURÉ (2026-11-20) : sur un modèle LOCAL, la commande de suppression
// massive a été proposée 3 fois sur 3 SANS demander d'accord. Rien n'a été
// exécuté, mais aucune protection de Pilot ne regardait le contenu d'un outil
// de commande (`bash` / `shell`) : la porte pré-écriture ne couvre que
// `write` / `edit`, la garde de réservation ne couvre que les fichiers réservés,
// et `screen-guard` ne couvre que l'écran.
//
// Ce fichier est la PORTE : il écoute `tool_call` AVANT l'exécution et, quand la
// commande est reconnue destructrice par la SOURCE UNIQUE de la décision
// (`destructive-command.js`, embarquée à côté de lui), il demande l'accord de
// l'utilisateur. Refus → `{ block: true }` : la commande n'est PAS lancée.
//
// Le dialogue passe par `ctx.ui.confirm()`, exactement comme les autres portes :
// Pilot reconnaît la sentinelle `PILOT_BASH_GATE::` et affiche la commande, la
// raison du danger et ce qui arriverait si l'accord était donné. Ailleurs (chemin
// d'affichage générique), le filet de sécurité des sentinelles
// (`machine-sentinel.js`) retrouve une phrase française : jamais d'identifiant
// machine à l'écran.
//
// BORNE : `ctx.ui.*` sans `timeout` suspendrait la session à vie (bug « agents
// figés », verrou `src/js/extensions-ui-timeout.test.js`). Ici la borne vaut
// 5 minutes et l'absence de réponse vaut REFUS (fail-closed) : une commande
// destructrice ne s'exécute jamais faute de réponse.
//
// INDÉPENDANCE DU MODÈLE : la décision ne lit ni le modèle, ni le fournisseur,
// ni la configuration. Elle est la même pour tous les agents, y compris sur un
// petit modèle local.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  destructiveGateRefusal,
  destructiveGateSentinelMessage,
  destructiveGateTitle,
  planShellToolCall,
} from "./destructive-command.js";

/** Borne d'attente de l'accord (fail-closed au-delà). */
const PILOT_UI_OPTS = { timeout: 300000 };

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    try {
      const tool = event.toolName;
      // Seuls les outils de commande sont concernés (`bash`, `shell`).
      const plan = planShellToolCall(tool, event.input, ctx.cwd);
      if (!plan.gated) return;

      const finding = plan.finding;
      const ok = await ctx.ui.confirm(
        destructiveGateTitle(finding),
        destructiveGateSentinelMessage(finding, tool),
        PILOT_UI_OPTS,
      );
      if (!ok) {
        // Refus explicite OU absence de réponse dans le délai : rien n'est lancé.
        return { block: true, reason: destructiveGateRefusal(finding) };
      }
      // Accord donné : la commande peut partir (on ne retourne rien).
    } catch (err) {
      // FAIL-CLOSED, à l'inverse des autres portes : si l'analyse ou le dialogue
      // échoue, on ne peut pas prouver que la commande est inoffensive. On
      // refuse (le message dit pourquoi), plutôt que de laisser passer une
      // suppression massive à cause d'une exception.
      return {
        block: true,
        reason:
          "Commande NON exécutée : le garde-fou de Pilot n'a pas pu vérifier cette commande " +
          `(${String(err)}). Par précaution, aucune commande n'est lancée quand la vérification échoue.`,
      };
    }
  });
}
