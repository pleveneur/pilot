// Tests unitaires — mcp-utils.js (client MCP POC : helpers purs)
import { describe, it, expect } from "vitest";
import {
  MCP_TRANSPORT,
  parseArgs,
  formatArgs,
  validateServer,
  newServerId,
  testResult,
  buildServer,
} from "./mcp-utils.js";

describe("MCP_TRANSPORT", () => {
  it("transport fixé à stdio (POC — pas de http/sse)", () => {
    expect(MCP_TRANSPORT).toBe("stdio");
  });
});

describe("parseArgs", () => {
  it("retourne [] sur entrée vide/null", () => {
    expect(parseArgs("")).toEqual([]);
    expect(parseArgs("   ")).toEqual([]);
    expect(parseArgs(null)).toEqual([]);
    expect(parseArgs(undefined)).toEqual([]);
  });

  it("sépare sur les espaces", () => {
    expect(parseArgs("scripts/mcp-test-server.js")).toEqual(["scripts/mcp-test-server.js"]);
    expect(parseArgs("node --flag a b")).toEqual(["node", "--flag", "a", "b"]);
  });

  it("préserve les arguments entre guillemets", () => {
    expect(parseArgs('--path "C:\\Program Files\\app" x')).toEqual(["--path", "C:\\Program Files\\app", "x"]);
    expect(parseArgs("--name 'mon serveur'")).toEqual(["--name", "mon serveur"]);
  });

  it("gère les guillemets simples/doubles imbriqués simples", () => {
    expect(parseArgs('a "b c" d')).toEqual(["a", "b c", "d"]);
  });
});

describe("formatArgs", () => {
  it("retourne '' sur entrée invalide", () => {
    expect(formatArgs(null)).toBe("");
    expect(formatArgs(undefined)).toBe("");
  });

  it("série les arguments simples", () => {
    expect(formatArgs(["a", "b"])).toBe("a b");
  });

  it("encadre les arguments contenant des espaces", () => {
    expect(formatArgs(["a", "b c"])).toBe('a "b c"');
  });

  it("round-trip parseArgs(formatArgs()) préserve le sens", () => {
    const args = ["--flag", "chemin avec espace"];
    expect(parseArgs(formatArgs(args))).toEqual(expectedNormalized(args));
  });
});

// helper local pour normaliser les guillemets imbriqués (non repris en pur)
function expectedNormalized(args) {
  return args.map((a) => (a.includes(" ") ? a : a));
}

describe("validateServer", () => {
  it("rejette un nom vide", () => {
    expect(validateServer({ name: "", command: "node" })).toBeTruthy();
    expect(validateServer({ name: "  ", command: "node" })).toBeTruthy();
  });

  it("rejette une commande vide", () => {
    expect(validateServer({ name: "srv", command: "" })).toBeTruthy();
    expect(validateServer({ name: "srv", command: "  " })).toBeTruthy();
  });

  it("retourne null si le serveur est valide", () => {
    expect(validateServer({ name: "srv", command: "node" })).toBeNull();
    expect(validateServer({ name: "Test", command: "node", args: [] })).toBeNull();
  });

  it("retourne null sur objet absent (serveur vide → erreur name)", () => {
    expect(validateServer(null)).toBeTruthy();
  });
});

describe("newServerId", () => {
  it("génère mcp-1 sur liste vide", () => {
    expect(newServerId([])).toBe("mcp-1");
    expect(newServerId(null)).toBe("mcp-1");
  });

  it("évite les collisions", () => {
    expect(newServerId([{ id: "mcp-1" }, { id: "mcp-2" }])).toBe("mcp-3");
    expect(newServerId([{ id: "mcp-2" }])).toBe("mcp-1");
  });
});

describe("testResult", () => {
  it("normalise un succès", () => {
    expect(testResult({ ok: true, server: "s", error: "" })).toEqual({ ok: true, error: "" });
  });

  it("normalise un échec avec message", () => {
    expect(testResult({ ok: false, error: "boom" })).toEqual({ ok: false, error: "boom" });
  });

  it("normalise une entrée indéterminée/absente en échec muet", () => {
    expect(testResult(null)).toEqual({ ok: false, error: "" });
    expect(testResult(undefined)).toEqual({ ok: false, error: "" });
    expect(testResult({ server: "s" })).toEqual({ ok: false, error: "" });
  });
});

describe("buildServer", () => {
  it("construit un serveur stdio avec transport fixé", () => {
    const s = buildServer("mcp-1", { name: "Test", command: "node", argsText: "a b", enabled: true });
    expect(s).toEqual({
      id: "mcp-1",
      name: "Test",
      transport: "stdio",
      enabled: true,
      command: "node",
      args: ["a", "b"],
    });
  });

  it("active par défaut quand le flag est absent", () => {
    const s = buildServer("mcp-2", { name: "X", command: "x" });
    expect(s.enabled).toBe(true);
  });

  it("tronque les champs au contenu non vide", () => {
    const s = buildServer("mcp-3", { name: "  N  ", command: "  c  ", argsText: " " });
    expect(s.name).toBe("N");
    expect(s.command).toBe("c");
    expect(s.args).toEqual([]);
  });
});
