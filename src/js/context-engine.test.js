// Tests unitaires — context-engine.js (Context Engine H1 : fonctions pures)
import { describe, it, expect } from "vitest";
import { estimateTokens, truncateToTokens, extractImports, parseAgentsNavTable, filterRagChunksByPath } from "./context-engine.js";

// ── estimateTokens ────────────────────────────────────────────────────
describe("estimateTokens", () => {
  it("retourne 0 sur entrée invalide", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens("")).toBe(0);
  });

  it("approxime ~1 token / 3.5 chars (arrondi supérieur)", () => {
    expect(estimateTokens("1234567")).toBe(2); // 7 / 3.5 = 2
    expect(estimateTokens("1234")).toBe(2); // 4 / 3.5 = 1.14 → 2
    expect(estimateTokens("x")).toBe(1); // 1 / 3.5 = 0.29 → 1
  });
});

// ── truncateToTokens ──────────────────────────────────────────────────
describe("truncateToTokens", () => {
  it("retourne '' sur entrée invalide", () => {
    expect(truncateToTokens(null, 100)).toBe("");
    expect(truncateToTokens("", 100)).toBe("");
  });

  it("retourne la chaîne inchangée si sous le budget", () => {
    const s = "bonjour";
    expect(truncateToTokens(s, 10)).toBe(s);
  });

  it("tronque et ajoute un marqueur au-delà du budget", () => {
    // budget 1 token → ~3.5 chars (le contenu utile est tronqué, mais le
    // marqueur ajoute des caractères → on vérifie le contenu tronqué + marqueur)
    const r = truncateToTokens("abcdefgh", 1);
    expect(r).toContain("[tronqué");
    expect(r).toContain("…");
    // la partie utile (avant le marqueur) est réduite
    expect(r.split("…")[0].length).toBeLessThan("abcdefgh".length);
  });

  it("ajoute le nombre de tokens tronqués dans le marqueur", () => {
    const r = truncateToTokens("abcdefgh", 1);
    // longueur restante < 8, tokens tronqués = round((8 - head.len)/3.5) > 0
    expect(r).toMatch(/\[tronqué \d+ tokens\]/);
  });
});

// ── extractImports ────────────────────────────────────────────────────
describe("extractImports JS", () => {
  it("extrait les imports relatifs ES et require", () => {
    const src = `
import { a } from "./lib/util.js";
import x from "../mod";
const y = require('./other/thing');
import z from "pkg-name"; // non relatif → ignoré
`;
    const r = extractImports(src, "js");
    expect(r).toContain("./lib/util.js");
    expect(r).toContain("../mod");
    expect(r).toContain("./other/thing");
    expect(r).not.toContain("pkg-name"); // import de package ignoré
  });

  it("retourne [] si contenu invalide ou langue inconnue", () => {
    expect(extractImports(null, "js")).toEqual([]);
    expect(extractImports("code", null)).toEqual([]);
    expect(extractImports("import './a.js';", "rust")).toEqual([]);
  });
});

describe("extractImports Python", () => {
  it("extrait les imports relatifs", () => {
    const src = `
from .models import X
from ..utils.helpers import y
import os
`;
    const r = extractImports(src, "py");
    expect(r).toContain(".models");
    expect(r).toContain("..utils.helpers");
    expect(r).not.toContain("os"); // import absolu non relatif
  });
});

describe("extractImports Markdown", () => {
  it("extrait les liens relatifs .md, ignore http et ancres", () => {
    const src = `
[spec](spec_pilot.md)
[autre](docs/guide.md#section)
[ext](https://example.com)
[mail](mailto:a@b.c)
[ancre](#top)
[img](/assets/logo.png)
`;
    const r = extractImports(src, "md");
    expect(r).toContain("spec_pilot.md");
    expect(r).toContain("docs/guide.md");
    expect(r).not.toContain("https://example.com");
    expect(r).not.toContain("mailto:a@b.c");
    expect(r).not.toContain("#top");
    expect(r).not.toContain("/assets/logo.png"); // chemin absolu ignoré
  });
});

// ── filterRagChunksByPath ────────────────────────────────────────────
describe("filterRagChunksByPath", () => {
  it("retourne le contexte inchangé si aucune exclusion", () => {
    const ctx = "### src/a.js (l. 1-10, score 0.50)\ncode\n\n### src/b.js (l. 1-5, score 0.40)\ncode2";
    expect(filterRagChunksByPath(ctx, null)).toBe(ctx);
    expect(filterRagChunksByPath(ctx, new Set())).toBe(ctx);
    expect(filterRagChunksByPath("", new Set(["package.json"]))).toBe("");
  });

  it("retire les chunks dont le chemin est dans le boost structurel", () => {
    const ctx =
      "### package.json (l. 1-20, score 0.60)\n{...}\n\n" +
      "### src/main.js (l. 1-10, score 0.55)\ncode\n\n" +
      "### Cargo.toml (l. 1-15, score 0.50)\n[deps]";
    const out = filterRagChunksByPath(ctx, new Set(["package.json", "Cargo.toml"]));
    expect(out).toContain("src/main.js");
    expect(out).not.toContain("package.json");
    expect(out).not.toContain("Cargo.toml");
  });

  it("retourne vide si tous les chunks sont exclus", () => {
    const ctx = "### package.json (l. 1-20, score 0.60)\n{...}";
    expect(filterRagChunksByPath(ctx, new Set(["package.json"]))).toBe("");
  });

  it("gère les chemins avec espaces (avant le marqueur (l. )", () => {
    const ctx = "### mon dossier/package.json (l. 1-5, score 0.50)\n{...}";
    expect(filterRagChunksByPath(ctx, new Set(["mon dossier/package.json"]))).toBe("");
  });
});
describe("parseAgentsNavTable", () => {
  it("retourne [] sur contenu vide", () => {
    expect(parseAgentsNavTable("")).toEqual([]);
    expect(parseAgentsNavTable(null)).toEqual([]);
  });

  it("extrait les liens markdown .md/.rs de la table de navigation", () => {
    const content = `
# Navigation

| Tâche | Fichier(s) à lire |
|---|---|
| Spécifications | \`spec_pilot.md\` |
| Agent Pi / RPC | [spec_rpc.md](spec_rpc.md) |
| Rust | \`src-tauri/src/lib.rs\` |
| Pas une table | texte libre |
`;
    const r = parseAgentsNavTable(content);
    expect(r).toContain("spec_pilot.md");
    expect(r).toContain("spec_rpc.md");
    expect(r).toContain("src-tauri/src/lib.rs");
  });

  it("déduplique les fichiers et ignore le contenu hors table", () => {
    const content = `
| Tâche | Fichier |
|---|---|
| A | \`spec_a.md\` |
| B | \`spec_a.md\` |
`;
    const r = parseAgentsNavTable(content);
    expect(r.filter((x) => x === "spec_a.md")).toHaveLength(1); // dédupliqué
  });
});
