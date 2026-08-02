import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Les fonctions pures testées (orchestration, review, validation) n'ont
    // aucune dépendance DOM/navigateur → environnement node, rapide et fiable.
    environment: "node",
    include: ["src/js/**/*.test.js"],
  },
});
