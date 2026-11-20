import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Les extensions embarquées importent leur CŒUR posé À CÔTÉ d'elles au lancement
// (`agent_service.rs` : `write_pdf_extension`, `write_bash_guard_extension`…).
// Ce fichier n'existe donc pas dans l'arborescence du dépôt : sans cette
// correspondance, un test ne pourrait pas importer l'extension elle-même et la
// porte des commandes destructrices ne serait vérifiée que par lecture de texte.
// L'alias vise EXACTEMENT le spécifieur relatif utilisé par l'extension ; les
// imports du même nom côté application pointent la même source unique.
const DESTRUCTIVE_CORE = fileURLToPath(
  new URL("./src/js/destructive-command.js", import.meta.url),
);

// Vite (transformation SSR) remonte les imports en tête du module. Avec des
// fichiers en CRLF (worktree Windows), le shebang d'un script importé par un
// test se retrouve alors AU MILIEU du module → « SyntaxError: Invalid or
// unexpected token ». On neutralise le shebang avant la transformation : il ne
// sert qu'à l'exécution directe du script, jamais dans les tests.
const stripShebang = {
  name: "pilot-strip-shebang",
  enforce: "pre",
  transform(code) {
    if (!code.startsWith("#!")) return null;
    return { code: code.replace(/^#![^\n]*/, ""), map: null };
  },
};

export default defineConfig({
  plugins: [stripShebang],
  resolve: {
    alias: [{ find: "./destructive-command.js", replacement: DESTRUCTIVE_CORE }],
  },
  test: {
    // Les fonctions pures testées (orchestration, review, validation) n'ont
    // aucune dépendance DOM/navigateur → environnement node, rapide et fiable.
    environment: "node",
    // `scripts/**` : scripts Node du projet (logique pure, ex. rechargement GDS).
    include: ["src/js/**/*.test.js", "scripts/**/*.test.js"],
  },
});
