// mcp-tool-names.test.js — Tâche « collisions de noms d'outils MCP ».
//
// Ce que ce fichier tient :
//   1. le nom d'outil exposé à l'agent ne change PAS pour les cas qui
//      fonctionnent aujourd'hui (`mcp_<id>_<outil>`) — des consignes d'agents
//      s'appuient dessus ;
//   2. le cas AMBIGU (deux serveurs activés portant le même identifiant, donc
//      exactement les mêmes noms d'outils) est détecté et EXPLIQUÉ en nommant
//      les deux serveurs, au lieu d'être résolu en silence ;
//   3. un outil déclaré deux fois par un même serveur n'en remplace pas un autre
//      en silence : la première déclaration est conservée et le doublon signalé.
//
// Le test porte sur la LOGIQUE de nommage (fonctions pures) + sur le branchement
// réel de l'extension (garde-fou de source), jamais sur une capture d'écran.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_TOOL_NAME_PREFIX,
  duplicateToolNameMessage,
  duplicateToolNames,
  firstDeclarationOnly,
  mcpServerId,
  mcpServerLabel,
  registeredToolName,
  serverIdClashMessage,
  serverIdOwners,
} from "./mcp-tool-names.js";

const here = dirname(fileURLToPath(import.meta.url));
// Les fins de ligne sont normalisées (worktree CRLF sous Windows) : voir
// quality-gate § 3.4.
const EXTENSION_SRC = readFileSync(
  resolve(here, "../../src-tauri/extensions/mcp-client.src.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

const serveurA = {
  id: "mcp-1",
  name: "Serveur A",
  transport: "stdio",
  enabled: true,
  command: "node",
  args: ["a.js"],
};
const serveurB = {
  id: "mcp-2",
  name: "Serveur B",
  transport: "stdio",
  enabled: true,
  command: "node",
  args: ["b.js"],
};

describe("nom d'outil MCP — règle historique préservée", () => {
  it("garde exactement le format mcp_<serverId>_<outil> déjà en service", () => {
    expect(MCP_TOOL_NAME_PREFIX).toBe("mcp_");
    expect(registeredToolName("mcp-1", "echo")).toBe("mcp_mcp-1_echo");
    // Cas réels observés dans les configs et les consignes d'agents.
    expect(registeredToolName("test", "ping")).toBe("mcp_test_ping");
    expect(registeredToolName("distant", "search")).toBe("mcp_distant_search");
  });

  it("résout l'identifiant de serveur comme l'extension le faisait (id, sinon name, sinon mcp)", () => {
    expect(mcpServerId({ id: "mcp-1", name: "A" })).toBe("mcp-1");
    expect(mcpServerId({ name: "A" })).toBe("A");
    expect(mcpServerId({})).toBe("mcp");
    // Un id présent mais vide reste vide : le nom produit est inchangé.
    expect(mcpServerId({ id: "", name: "A" })).toBe("");
    expect(registeredToolName(mcpServerId({ id: "" }), "echo")).toBe("mcp__echo");
  });

  it("ne change pas le nom des outils quand SEUL le nom lisible du serveur change", () => {
    const avant = registeredToolName(mcpServerId({ id: "mcp-1", name: "Ancien nom" }), "echo");
    const apres = registeredToolName(mcpServerId({ id: "mcp-1", name: "Nouveau nom" }), "echo");
    expect(apres).toBe(avant);
  });

  it("rend deux outils distincts d'un même serveur forcément distincts", () => {
    const noms = ["echo", "ping", "search_files", "a_b"];
    const enregistres = noms.map((n) => registeredToolName("mcp-1", n));
    expect(new Set(enregistres).size).toBe(noms.length);
  });
});

describe("collision de noms d'outils entre deux serveurs", () => {
  it("montre le défaut : deux serveurs de même identifiant produisent le MÊME nom d'outil", () => {
    const clone = { ...serveurB, id: "mcp-1" };
    const nomA = registeredToolName(mcpServerId(serveurA), "echo");
    const nomClone = registeredToolName(mcpServerId(clone), "echo");
    expect(nomClone).toBe(nomA); // le nom ne dit plus quel serveur est appelé
  });

  it("détecte l'ambiguïté et nomme les DEUX serveurs", () => {
    const clone = { ...serveurB, id: "mcp-1" };
    const owners = serverIdOwners([serveurA, clone], "mcp-1");
    expect(owners).toHaveLength(2);
    const message = serverIdClashMessage("mcp-1", owners);
    expect(message).toContain("Serveur A");
    expect(message).toContain("Serveur B");
    expect(message).toContain("mcp-1");
    // Le message dit quoi faire : aucune correction silencieuse.
    expect(message).toContain("identifiants");
  });

  it("ne signale rien dans le cas normal (identifiants distincts)", () => {
    const owners = serverIdOwners([serveurA, serveurB], "mcp-1");
    expect(owners).toHaveLength(1);
    expect(serverIdClashMessage("mcp-1", owners)).toBeNull();
  });

  it("ne signale rien si l'autre porteur du même identifiant est DÉSACTIVÉ", () => {
    const clone = { ...serveurB, id: "mcp-1", enabled: false };
    expect(serverIdOwners([serveurA, clone], "mcp-1")).toHaveLength(1);
    expect(serverIdClashMessage("mcp-1", serverIdOwners([serveurA, clone], "mcp-1"))).toBeNull();
  });

  it("distingue deux serveurs homonymes par leur cible dans le message", () => {
    const jumeau = { ...serveurA, command: "node", args: ["autre.js"] };
    expect(mcpServerLabel(jumeau)).toContain("Serveur A");
    expect(mcpServerLabel(jumeau)).toContain("node");
  });
});

describe("outil déclaré deux fois par un même serveur", () => {
  const outils = [
    { name: "echo", description: "première" },
    { name: "ping", description: "ok" },
    { name: "echo", description: "seconde (ne doit pas écraser)" },
  ];

  it("repère les noms déclarés plusieurs fois", () => {
    expect(duplicateToolNames(outils)).toEqual(["echo"]);
    expect(duplicateToolNames([{ name: "a" }, { name: "b" }])).toEqual([]);
  });

  it("conserve la PREMIÈRE déclaration (plus de remplacement silencieux)", () => {
    const gardes = firstDeclarationOnly(outils);
    expect(gardes).toHaveLength(2);
    expect(gardes[0].description).toBe("première");
  });

  it("explique le doublon en nommant le serveur et l'outil", () => {
    const message = duplicateToolNameMessage("mcp-1", duplicateToolNames(outils));
    expect(message).toContain("mcp-1");
    expect(message).toContain("echo");
    expect(message).toContain("mcp_mcp-1_echo");
    expect(duplicateToolNameMessage("mcp-1", [])).toBeNull();
  });
});

describe("branchement réel de l'extension MCP (garde-fou de source)", () => {
  it("construit le nom d'outil avec la fonction partagée, jamais à la main", () => {
    expect(EXTENSION_SRC).toContain("registeredToolName(serverId, toolName)");
    expect(EXTENSION_SRC).not.toContain("`mcp_${serverId}_${toolName}`");
    expect(EXTENSION_SRC).toContain("const serverId = mcpServerId(server)");
  });

  it("refuse le chargement quand deux serveurs activés partagent un identifiant", () => {
    expect(EXTENSION_SRC).toContain("serverIdOwners(enabledServers, serverId)");
    expect(EXTENSION_SRC).toContain("serverIdClashMessage(serverId, sameIdServers)");
  });

  it("n'enregistre que la première déclaration d'un outil et signale le doublon", () => {
    expect(EXTENSION_SRC).toContain("duplicateToolNames(discovered)");
    expect(EXTENSION_SRC).toContain("duplicateToolNameMessage(serverId, declaredTwice)");
    expect(EXTENSION_SRC).toContain("firstDeclarationOnly(discovered)");
  });
});
