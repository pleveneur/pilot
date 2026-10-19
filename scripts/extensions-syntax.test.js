// extensions-syntax.test.js — Garde-fou anti-régression sur les extensions pi.
//
// Les extensions embarquées (`src-tauri/extensions/*.ts`) sont incluses dans le
// binaire via `include_str!` puis écrites sur disque et passées à `pi` avec
// `--extension`. Si UNE seule ne se parse pas, `pi` refuse de démarrer
// (`Failed to load extension … ParseError` puis sortie immédiate, code 1) :
// aucune commande RPC n'obtient de réponse et Pilot reste bloqué à l'écran de
// chargement (incident v0.4.29/0.4.30 : chaîne de caractères cassée dans
// `pilot-assistant-actions.ts` → Assistant impossible à démarrer, thread
// principal gelé).
//
// Ce test transpile chaque extension en TypeScript et échoue à la moindre
// erreur de syntaxe. Il est volontairement BÊTE (aucune résolution de types,
// aucune émotion) : il doit être rapide et ne jamais produire de faux positif.
import { describe, it, expect } from "vitest";
import * as esbuild from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionsDir = resolve(here, "..", "src-tauri", "extensions");

/** Chemins des extensions TypeScript embarquées (lues à chaque appel). */
function extensionFiles() {
  return readdirSync(extensionsDir)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

describe("syntaxe des extensions pi embarquées", () => {
  it("trouve les extensions de l'Assistant (liste non vide)", () => {
    // Sonde de cohérence : si ce test échoue, le dossier a été déplacé et le
    // garde-fou ne protégerait plus rien.
    const files = extensionFiles();
    expect(files).toContain("pilot-assistant-actions.ts");
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of extensionFiles()) {
    it(`${file} se transpile sans erreur de syntaxe`, () => {
      const code = readFileSync(join(extensionsDir, file), "utf8");
      expect(() => esbuild.transformSync(code, { loader: "ts", target: "es2022" })).not.toThrow();
    });
  }

  it("aucune chaîne de caractères ne contient de retour à la ligne brut", () => {
    // Cas réel de l'incident : `text: result + "` suivi d'une ligne vide puis
    // `" + LAUNCH_FOLLOW_UP` (un "\n\n" écrit comme de vrais sauts de ligne).
    // esbuild le détecte (« Unterminated string literal »), ce test donne un
    // message d'erreur explicite pour ce motif précis.
    const off = extensionFiles().filter((file) => {
      const lines = readFileSync(join(extensionsDir, file), "utf8").split(/\r?\n/);
      return lines.some((line) => {
        const trimmed = line.trimEnd();
        if (!trimmed.endsWith('"')) return false;
        // Nombre de guillemets non échappés : impair = chaîne laissée ouverte
        // en fin de ligne (les apostrophes françaises ne comptent pas).
        const quotes = (trimmed.match(/(?<!\\)"/g) || []).length;
        return quotes % 2 === 1;
      });
    });
    expect(off).toEqual([]);
  });
});
