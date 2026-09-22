import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Les fonctions pures testées (orchestration, review, validation) n'ont
    // aucune dépendance DOM/navigateur → environnement node, rapide et fiable.
    environment: "node",
    // `scripts/**` : scripts Node du projet (logique pure, ex. rechargement GDS).
    include: ["src/js/**/*.test.js", "scripts/**/*.test.js"],
  },
});
