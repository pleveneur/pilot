// Pilot Assistant Files — espace d'écriture restreint du super-agent.
//
// Le super-agent (onglet 🧭) est lecture seule sur les projets. Il dispose d'un
// espace d'écriture dédié `~/.pilot/assistant/` pour ses fichiers de suivi
// (notes, analyses, exports), organisé par client puis par projet.
//
// Cette extension intercepte les outils `write`/`edit` et :
//   - autorise l'écriture UNIQUEMENT sous `~/.pilot/assistant/` (création
//     automatique des dossiers parents, y compris l'arborescence client/projet) ;
//   - bloque toute écriture ailleurs (projets, etc.) → garantie lecture seule
//     stricte sur les projets, indépendamment de la consigne système.
//
// Les outils de question (ask_choice, ask_input, ask_confirm, ask_multi_choice)
// sont fournis par l'extension pilot-choices, chargée séparément.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { mkdirSync } from "node:fs";

// Racine de l'espace d'écriture de l'assistant : ~/.pilot/assistant/
const ASSISTANT_ROOT = join(homedir(), ".pilot", "assistant");

/** Vrai si `absPath` est sous la racine de l'assistant (ou égal). */
function isUnderRoot(absPath: string): boolean {
  const root = resolve(ASSISTANT_ROOT);
  const p = resolve(absPath);
  return p === root || p.startsWith(root + sep);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    let tool: string;
    try {
      tool = event.toolName;
      if (tool !== "write" && tool !== "edit") return;

      const input = event.input as { path?: string } | undefined;
      const rawPath = input?.path;
      if (typeof rawPath !== "string" || !rawPath.trim()) return;

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

      // Hors de l'espace assistant → bloquer (lecture seule stricte sur les projets).
      if (!isUnderRoot(absPath)) {
        return {
          block: true,
          reason: `Écriture refusée : le super-agent est lecture seule sur les projets. Seul l'espace ${ASSISTANT_ROOT} est autorisé pour ses fichiers de suivi.`,
        };
      }

      // Créer les dossiers parents (arborescence client/projet) au besoin.
      try {
        mkdirSync(join(absPath, ".."), { recursive: true });
      } catch {
        // fail-open : si la création échoue, laisser l'outil tenter l'écriture.
      }
      // Autoriser l'outil (return nothing).
    } catch (err) {
      // Ne jamais faire planter pi : en cas d'erreur, autoriser (fail-open).
      ctx.ui.notify(`Pilot assistant files: erreur (${String(err)}) — outil autorisé par défaut`, "warning");
    }
  });
}
