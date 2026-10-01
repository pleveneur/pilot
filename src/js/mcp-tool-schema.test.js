// mcp-tool-schema.test.js — Tâche 307 : le schéma des paramètres d'un outil
// MCP doit être celui déclaré par le serveur (`tools/list` → `inputSchema`), et
// non un schéma générique qui prive l'agent des noms de paramètres et de leurs
// types. Garde-fou de source : l'extension MCP est un fichier TypeScript bundlé
// (imports typebox/SDK non résolubles dans l'environnement de test), on vérifie
// donc le contrat de code au bon endroit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src-tauri/extensions/mcp-client.src.ts"),
  "utf8"
);

describe("schéma des paramètres d'un outil MCP (tâche 307)", () => {
  it("lit le schéma déclaré par le serveur et le transmet tel quel à pi", () => {
    expect(SRC).toContain("tool.inputSchema");
    expect(SRC).toContain("Type.Unsafe(");
  });

  it("n'enregistre plus l'outil avec un schéma générique unique", () => {
    const start = SRC.indexOf("api.registerTool({");
    const end = SRC.indexOf("} as never);", start);
    expect(start, "appel api.registerTool absent").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    expect(body).toContain("parameters: toolParametersSchema(");
  });

  it("conserve un repli générique quand le serveur n'annonce aucun schéma", () => {
    const start = SRC.indexOf("function toolParametersSchema(");
    expect(start, "helper toolParametersSchema absent").toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 900);
    expect(body).toContain("Type.Record(Type.String(), Type.Unknown())");
  });
});
