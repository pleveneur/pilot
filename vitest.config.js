import { defineConfig } from "vitest/config";

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
  test: {
    // Les fonctions pures testées (orchestration, review, validation) n'ont
    // aucune dépendance DOM/navigateur → environnement node, rapide et fiable.
    environment: "node",
    // `scripts/**` : scripts Node du projet (logique pure, ex. rechargement GDS).
    include: ["src/js/**/*.test.js", "scripts/**/*.test.js"],
  },
});
