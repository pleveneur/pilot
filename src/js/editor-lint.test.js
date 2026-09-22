// Tests — editor-lint.js : gate du lint inline (B2).
//
// Contrat vérifié : seul JS/TS/Vue reçoit l'extension de lint (V1 — pas d'appel
// backend inutile), tout le reste (y compris chemin vide ou sans extension)
// reçoit un tableau vide. Régression visée : un langage lintable qui perdrait
// son lint (ou l'inverse, un appel eslint sur du Python).

import { describe, it, expect } from "vitest";
import { lintExtension } from "./editor-lint.js";

describe("lintExtension — gate par extension", () => {
  it("retourne l'extension (gouttière + linter) pour JS/TS/Vue", () => {
    for (const p of ["a.js", "A.JS", "b.ts", "c.jsx", "d.tsx", "e.mjs", "f.cjs", "g.vue"]) {
      const ext = lintExtension(p);
      expect(Array.isArray(ext)).toBe(true);
      expect(ext.length).toBe(2);
    }
  });

  it("retourne [] pour les langages non lintables (V1)", () => {
    for (const p of ["a.py", "b.rs", "c.md", "d.json", "e.html", "f.css"]) {
      expect(lintExtension(p)).toEqual([]);
    }
  });

  it("retourne [] pour un chemin vide, null ou sans extension", () => {
    expect(lintExtension("")).toEqual([]);
    expect(lintExtension(null)).toEqual([]);
    expect(lintExtension(undefined)).toEqual([]);
    expect(lintExtension("Makefile")).toEqual([]);
  });
});
