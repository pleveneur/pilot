// Tests unitaires — mcp-utils.js (client MCP POC : helpers purs)
import { describe, it, expect } from "vitest";
import {
  MCP_TRANSPORT,
  MCP_TRANSPORT_STDIO,
  MCP_TRANSPORT_HTTP,
  isRemoteTransport,
  parseArgs,
  formatArgs,
  parseEnv,
  formatEnv,
  validateServer,
  newServerId,
  testResult,
  buildServer,
} from "./mcp-utils.js";

describe("transports MCP", () => {
  it("le transport par défaut reste le local (stdio)", () => {
    expect(MCP_TRANSPORT).toBe("stdio");
    expect(MCP_TRANSPORT_STDIO).toBe("stdio");
    expect(MCP_TRANSPORT_HTTP).toBe("http");
  });

  it("isRemoteTransport distingue distant et local (valeur inconnue → local)", () => {
    expect(isRemoteTransport("http")).toBe(true);
    expect(isRemoteTransport("https")).toBe(true);
    expect(isRemoteTransport(" HTTP ")).toBe(true);
    expect(isRemoteTransport("stdio")).toBe(false);
    expect(isRemoteTransport("")).toBe(false);
    expect(isRemoteTransport(undefined)).toBe(false);
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

  it("exige une adresse pour un serveur distant", () => {
    expect(validateServer({ name: "srv", transport: "http", url: "" })).toMatch(/adresse/i);
    expect(validateServer({ name: "srv", transport: "https", url: "  " })).toMatch(/adresse/i);
    expect(validateServer({ name: "srv", transport: "http", url: "https://exemple.invalid/mcp" })).toBeNull();
  });

  it("n'exige pas de commande pour un serveur distant (et l'inverse)", () => {
    expect(validateServer({ name: "srv", transport: "http", url: "https://exemple.invalid/mcp", command: "" })).toBeNull();
    expect(validateServer({ name: "srv", transport: "stdio", command: "" })).toMatch(/commande/i);
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
  it("construit un serveur local (stdio) avec transport local par défaut", () => {
    const s = buildServer("mcp-1", { name: "Test", command: "node", argsText: "a b", enabled: true });
    expect(s).toEqual({
      id: "mcp-1",
      name: "Test",
      transport: "stdio",
      enabled: true,
      command: "node",
      args: ["a", "b"],
      env: {},
      url: "",
      secret_ref: null,
    });
  });

  it("reprend les variables d'environnement déclarées pour un serveur local", () => {
    const s = buildServer("mcp-1b", { name: "Env", command: "node", envText: "MON_JETON=abc\nAUTRE=2" });
    expect(s.env).toEqual({ MON_JETON: "abc", AUTRE: "2" });
    // Un serveur distant ne lance aucun programme : pas de variables.
    const distant = buildServer("mcp-1c", { name: "R", transport: "http", url: "https://exemple.invalid/mcp", envText: "MON_JETON=abc" });
    expect(distant.env).toEqual({});
  });

  it("construit un serveur distant : type, adresse et référence de clé, jamais de commande", () => {
    const s = buildServer("mcp-2", {
      name: "Distant",
      transport: "http",
      url: " https://exemple.invalid/mcp ",
      secretRef: " vault:mon-entree ",
      command: "node",
      argsText: "--x",
    });
    expect(s).toEqual({
      id: "mcp-2",
      name: "Distant",
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: {},
      url: "https://exemple.invalid/mcp",
      secret_ref: "vault:mon-entree",
    });
  });

  it("ne conserve la référence de clé que pour un serveur distant", () => {
    const local = buildServer("mcp-3", { name: "L", transport: "stdio", command: "node", secretRef: "vault:x" });
    expect(local.secret_ref).toBeNull();
    const remoteSansCle = buildServer("mcp-4", { name: "R", transport: "http", url: "https://exemple.invalid/mcp", secretRef: "  " });
    expect(remoteSansCle.secret_ref).toBeNull();
  });

  it("active par défaut quand le flag est absent", () => {
    const s = buildServer("mcp-5", { name: "X", command: "x" });
    expect(s.enabled).toBe(true);
  });

  it("tronque les champs au contenu non vide", () => {
    const s = buildServer("mcp-6", { name: "  N  ", command: "  c  ", argsText: " " });
    expect(s.name).toBe("N");
    expect(s.command).toBe("c");
    expect(s.args).toEqual([]);
  });
});

describe("variables d'environnement d'un serveur MCP (tâche 308)", () => {
  it("parseEnv lit une déclaration NOM=valeur par ligne", () => {
    expect(parseEnv("A=1\nB= deux ")).toEqual({ A: "1", B: "deux" });
  });

  it("parseEnv ignore les lignes vides, les commentaires et les lignes sans nom", () => {
    expect(parseEnv("\n# commentaire\n\nSANS_EGAL\n=vide\nOK=1")).toEqual({ OK: "1" });
  });

  it("parseEnv conserve les `=` de la valeur et accepte l'absence de texte", () => {
    expect(parseEnv("URL=http://exemple.invalid/a?b=c")).toEqual({
      URL: "http://exemple.invalid/a?b=c",
    });
    expect(parseEnv("")).toEqual({});
    expect(parseEnv(null)).toEqual({});
  });

  it("formatEnv sérialise en texte relu par parseEnv (aller-retour)", () => {
    const env = { A: "1", B: "deux mots" };
    expect(parseEnv(formatEnv(env))).toEqual(env);
    expect(formatEnv(undefined)).toBe("");
    expect(formatEnv({})).toBe("");
  });
});
