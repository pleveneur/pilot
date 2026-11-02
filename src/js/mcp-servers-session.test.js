// mcp-servers-session.test.js — QUELLE LISTE DE SERVEURS MCP UNE SESSION CHARGE.
//
// Décision du propriétaire (2026-11-02) : la conversation de l'Assistant ne se
// limite plus à « un serveur MCP à la fois ». Elle charge TOUS les serveurs
// ACTIVÉS ensemble et c'est l'Assistant qui choisit, en raisonnant, lequel lui
// faut. Un serveur DÉSACTIVÉ n'est JAMAIS chargé.
//
// Ces tests échouent si :
//   (1) l'Assistant perd l'accès aux outils d'un serveur activé (un seul serveur
//       chargé, ou un serveur activé oublié en route) ;
//   (2) un serveur DÉSACTIVÉ est chargé (ou ses outils exécutables) ;
//   (3) activer un serveur désactive un autre (exclusivité revenue par la porte
//       de la configuration) ;
//   (4) deux serveurs masquent en silence les outils de l'autre (même identifiant
//       ou même nom d'outil enregistré) ;
//   (5) la chaîne Rust → variables d'environnement → extension est rompue (une
//       clé unique au lieu d'une clé PAR serveur, ou l'extension revenue à « un
//       seul serveur »).
//
// Chaque cas est commenté pour nommer la règle protégée.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MCP_SESSION_ALL,
  MCP_SESSION_NONE,
  MCP_SESSION_TARGET,
  mcpAmbiguousIdNotice,
  mcpAmbiguousServerIds,
  mcpEnabledServers,
  mcpNoServerNotice,
  mcpServerFingerprint,
  mcpServerStillEnabled,
  mcpServerUnavailableNotice,
  mcpToolUnavailableMessage,
  planMcpRefresh,
  planMcpSessionServers,
} from "./mcp-servers-session.js";
import {
  crossServerToolClashMessage,
  registeredToolName,
  resolveToolNames,
} from "./mcp-tool-names.js";
import {
  MCP_SECRETS_VAR,
  MCP_SECRET_BLOCKS_VAR,
  MCP_SECRET_VAR,
  parseSecretMap,
  scopeMcpSecretForServer,
  serverSecretKeyCandidates,
} from "./mcp-secret-scope.js";
import { planMcpServerToggle } from "./mcp-server-toggle.js";

const ROOT = resolve(__dirname, "../..");

/** Lit un fichier source avec fins de ligne normalisées (piège CI Windows). */
function readText(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

const extensionSrc = readText("src-tauri/extensions/mcp-client.src.ts");
const agentServiceRs = readText("src-tauri/src/agent_service.rs");
const mcpConfigRs = readText("src-tauri/src/mcp_config.rs");

/** Config de travail : trois serveurs, deux activés, un désactivé. */
function config() {
  return {
    servers: [
      { id: "presence", name: "Présences", transport: "stdio", enabled: true, command: "node" },
      { id: "notes", name: "Notes", transport: "stdio", enabled: true, command: "node" },
      { id: "off", name: "Coupé", transport: "stdio", enabled: false, command: "node" },
    ],
  };
}

describe("règle 1 — l'Assistant chargé de TOUS les serveurs activés", () => {
  it("charge ensemble TOUS les serveurs activés (aucun n'est perdu)", () => {
    // (1) Sans PILOT_MCP_SERVER, la session n'a plus de « serveur courant » :
    // elle reçoit la liste ENTIÈRE des serveurs activés.
    const plan = planMcpSessionServers(config(), {});
    expect(plan.mode).toBe(MCP_SESSION_ALL);
    expect(plan.servers.map((s) => s.id)).toEqual(["presence", "notes"]);
    expect(plan.ambiguous).toEqual([]);
  });

  it("une entrée sans champ `enabled` compte comme activée (règle historique)", () => {
    // (1) `mcp.json` écrit à la main : l'absence de champ ne doit pas faire
    // disparaître un serveur des outils de l'Assistant.
    const plan = planMcpSessionServers(
      { servers: [{ id: "a", command: "node" }] },
      {},
    );
    expect(plan.mode).toBe(MCP_SESSION_ALL);
    expect(plan.servers.map((s) => s.id)).toEqual(["a"]);
  });

  it("un serveur cible (PILOT_MCP_SERVER) reste UN SEUL : agent inchangé", () => {
    // (1) + (5) : le mode « un serveur désigné » ne concerne que les agents ; il
    // ne doit pas se transformer en « tous les serveurs » par accident.
    const plan = planMcpSessionServers(config(), { target: "notes" });
    expect(plan.mode).toBe(MCP_SESSION_TARGET);
    expect(plan.servers.map((s) => s.id)).toEqual(["notes"]);
    // Cible inconnue ou désactivée → rien (l'appelant garde SON repli historique).
    expect(planMcpSessionServers(config(), { target: "off" }).servers).toEqual([]);
    expect(planMcpSessionServers(config(), { target: "fantome" }).mode).toBe(MCP_SESSION_NONE);
  });

  it("planMcpRefresh ne (re)lance QUE ce qui manque et signale ce qui est à retirer", () => {
    // (1) Un serveur déjà chargé n'est jamais reconnecté ; un serveur voulu et
    // absent est chargé — c'est ce qui fait entrer un serveur activé pendant la
    // conversation, sans redémarrer Pilot.
    const plan = planMcpSessionServers(config(), {});
    const diff = planMcpRefresh(plan, { loaded: ["presence"], loading: [] });
    expect(diff.load.map((s) => s.id)).toEqual(["notes"]);
    expect(diff.drop).toEqual([]);
    const apres = planMcpRefresh(plan, { loaded: ["presence", "notes"], loading: [] });
    expect(apres.load).toEqual([]);
    // Un serveur chargé qui n'est plus voulu (désactivé) est à retirer.
    expect(
      planMcpRefresh(plan, { loaded: ["presence", "notes", "off"], loading: [] }).drop,
    ).toEqual(["off"]);
    // Une connexion en cours n'est jamais doublée.
    expect(
      planMcpRefresh(plan, { loaded: [], loading: ["notes"] }).load.map((s) => s.id),
    ).toEqual(["presence"]);
  });
});

describe("règle 2 — un serveur DÉSACTIVÉ n'est JAMAIS chargé", () => {
  it("la liste des serveurs activés exclut les serveurs désactivés", () => {
    // (2) Le booléen est strict : `enabled: false` suffit à écarter le serveur.
    expect(mcpEnabledServers(config()).map((s) => s.id)).toEqual(["presence", "notes"]);
    const plan = planMcpSessionServers(config(), {});
    expect(plan.servers.some((s) => s.id === "off")).toBe(false);
  });

  it("un outil d'un serveur désactivé entre-temps ne s'exécute pas", () => {
    // (2) La liste du modèle peut encore contenir l'outil : l'extension relit la
    // configuration AVANT chaque appel et refuse si le serveur n'est plus activé.
    expect(mcpServerStillEnabled(config(), "presence")).toBe(true);
    expect(mcpServerStillEnabled(config(), "off")).toBe(false);
    const message = mcpToolUnavailableMessage("off", registeredToolName("off", "ecrire"));
    expect(message).toContain("mcp_off_ecrire");
    expect(message).toContain("désactivé");
    expect(message).toContain("Aucun appel n'a été envoyé");
  });

  it("config vide ou tous désactivés : aucun serveur, mais un message clair", () => {
    // (2) + (4) : la session ne charge rien, et l'utilisateur sait pourquoi.
    const vide = planMcpSessionServers({ servers: [] }, {});
    expect(vide.mode).toBe(MCP_SESSION_NONE);
    expect(vide.servers).toEqual([]);
    const tousCoupés = planMcpSessionServers(
      { servers: [{ id: "a", enabled: false }] },
      {},
    );
    expect(tousCoupés.mode).toBe(MCP_SESSION_NONE);
    expect(mcpNoServerNotice()).toContain("aucun serveur n'est activé");
  });
});

describe("règle 3 — activer un serveur n'en désactive AUCUN autre", () => {
  it("après activation, la session charge les deux serveurs", () => {
    // (3) Enchaînement complet : décision de l'outil → configuration écrite (un
    // seul couple {id, enabled}) → liste chargée par l'Assistant.
    const state = {
      servers: [
        { id: "presence", name: "Présences", enabled: true },
        { id: "notes", name: "Notes", enabled: false },
      ],
    };
    const plan = planMcpServerToggle(state, { server: "notes", enabled: true });
    expect(plan.ok).toBe(true);
    expect(plan.changes).toEqual([{ id: "notes", enabled: true }]);
    // Application littérale des changements dans la configuration.
    const appliqué = {
      servers: state.servers.map((s) => {
        const change = plan.changes.find((c) => c.id === s.id);
        return change ? { ...s, enabled: change.enabled } : s;
      }),
    };
    const session = planMcpSessionServers(appliqué, {});
    expect(session.servers.map((s) => s.id)).toEqual(["presence", "notes"]);
    expect(session.mode).toBe(MCP_SESSION_ALL);
  });
});

describe("règle 4 — deux serveurs ne se masquent jamais en silence", () => {
  it("deux identifiants identiques : AUCUN des deux n'est chargé, et c'est dit", () => {
    // (4) Mêmes noms d'outils ⇒ impossible de savoir quel serveur répondrait.
    const cfg = {
      servers: [
        { id: "dup", name: "Premier", enabled: true },
        { id: "dup", name: "Second", enabled: true },
        { id: "seul", name: "Seul", enabled: true },
      ],
    };
    const ambiguous = mcpAmbiguousServerIds(mcpEnabledServers(cfg));
    expect(ambiguous).toEqual([{ id: "dup", owners: ["Premier (dup)", "Second (dup)"] }]);
    const plan = planMcpSessionServers(cfg, {});
    expect(plan.servers.map((s) => s.id)).toEqual(["seul"]); // le tiers reste servi
    const notice = mcpAmbiguousIdNotice(ambiguous[0].id, ambiguous[0].owners);
    expect(notice).toContain("Premier (dup)");
    expect(notice).toContain("Second (dup)");
    expect(notice).toContain("AUCUN");
    expect(notice).toContain("restent disponibles");
  });

  it("deux noms d'outils qui se confondent : le premier garde, l'autre est nommé", () => {
    // (4) `mcp_a_b_c` peut venir du serveur « a » (outil « b_c ») OU du serveur
    // « a_b » (outil « c »). Un seul doit être enregistré, et l'autre doit être
    // nommé — jamais écrasé sans le dire.
    const { entries, clashes } = resolveToolNames([
      { serverId: "a", tools: [{ name: "b_c" }, { name: "propre" }] },
      { serverId: "a_b", tools: [{ name: "c" }, { name: "autre" }] },
    ]);
    expect(entries[0].tools.map((t) => t.name)).toEqual(["b_c", "propre"]);
    expect(entries[1].tools.map((t) => t.name)).toEqual(["autre"]);
    expect(clashes).toEqual([{ name: "mcp_a_b_c", owners: ["a", "a_b"] }]);
    const message = crossServerToolClashMessage(clashes[0].name, clashes[0].owners);
    expect(message).toContain("mcp_a_b_c");
    expect(message).toContain("a_b");
    expect(message).toContain("n'est PAS exposé");
  });

  it("sans collision, tous les outils de tous les serveurs sont exposés", () => {
    // (1) + (4) : la répartition ne doit rien perdre quand rien ne se dispute.
    const { entries, clashes } = resolveToolNames([
      { serverId: "presence", tools: [{ name: "activer" }] },
      { serverId: "notes", tools: [{ name: "ajouter" }] },
    ]);
    expect(clashes).toEqual([]);
    expect(entries.map((e) => e.tools.map((t) => t.name))).toEqual([["activer"], ["ajouter"]]);
    expect(registeredToolName("presence", "activer")).toBe("mcp_presence_activer");
  });
});

describe("clés du coffre — une clé PAR serveur, jamais celle d'un autre", () => {
  it("lit une table { identifiant: clé } sans jamais lever", () => {
    expect(parseSecretMap('{"a":"k1"}')).toEqual({ a: "k1" });
    expect(parseSecretMap("pas du json")).toEqual({});
    expect(parseSecretMap("")).toEqual({});
    expect(parseSecretMap('{"a":"","b":3,"c":"k"}')).toEqual({ c: "k" });
  });

  it("chaque serveur ne reçoit QUE sa clé, et les tables sont retirées", () => {
    // (5) Sans cela, le serveur « notes » pourrait lire la clé de « presence ».
    const baseEnv = {
      PILOT_MCP_CONFIG: "/tmp/mcp.json",
      [MCP_SECRETS_VAR]: '{"presence":"cle-presence","notes":"cle-notes"}',
      [MCP_SECRET_BLOCKS_VAR]: '{"casse":"vault:inconnue"}',
    };
    const secrets = { presence: "cle-presence", notes: "cle-notes" };
    const presence = scopeMcpSecretForServer(baseEnv, {
      serverId: "presence",
      server: { id: "presence", secret_ref: "vault:presence" },
      declared: true,
      strict: true,
      secrets,
    });
    expect(presence.blocked).toBe(false);
    expect(presence.secret).toBe("cle-presence");
    expect(presence.env[MCP_SECRET_VAR]).toBe("cle-presence");
    // La table des clés n'est JAMAIS transmise à un serveur.
    expect(presence.env[MCP_SECRETS_VAR]).toBeUndefined();
    expect(presence.env[MCP_SECRET_BLOCKS_VAR]).toBeUndefined();
    // Ni la clé de l'autre serveur, sous aucune forme.
    expect(JSON.stringify(presence.env)).not.toContain("cle-notes");

    const notes = scopeMcpSecretForServer(baseEnv, {
      serverId: "notes",
      server: { id: "notes", secret_ref: "vault:notes" },
      declared: true,
      strict: true,
      secrets,
    });
    expect(notes.secret).toBe("cle-notes");
    expect(JSON.stringify(notes.env)).not.toContain("cle-presence");
  });

  it("un serveur qui ne déclare rien ne reçoit aucune clé héritée (mode strict)", () => {
    // (5) + (2) : la clé d'un autre serveur ne peut pas fuir par héritage.
    const scope = scopeMcpSecretForServer(
      { [MCP_SECRET_VAR]: "cle-heritee", [MCP_SECRETS_VAR]: '{"autre":"x"}' },
      { serverId: "local", declared: false, strict: true, secrets: { autre: "x" } },
    );
    expect(scope.secret).toBe("");
    expect(scope.env[MCP_SECRET_VAR]).toBeUndefined();
    expect(scope.env[MCP_SECRETS_VAR]).toBeUndefined();
  });

  it("une référence introuvable refuse CE serveur en le nommant, les autres restent", () => {
    // (5) : le refus est porté par le serveur concerné, jamais par la session.
    const scope = scopeMcpSecretForServer({}, {
      serverId: "casse",
      server: { id: "casse", secret_ref: "vault:inconnue" },
      declared: true,
      strict: true,
      secrets: {},
      blocks: { casse: "vault:inconnue" },
    });
    expect(scope.blocked).toBe(true);
    expect(scope.reason).toContain("« casse »");
    expect(scope.reason).toContain("mode strict");
    expect(scope.secret).toBe("");
  });

  it("les clés candidates couvrent id et name, avec et sans espaces", () => {
    expect(serverSecretKeyCandidates({ id: " a ", name: "b" })).toEqual([" a ", "b", "a"]);
    expect(serverSecretKeyCandidates({})).toEqual([]);
  });
});

describe("messages de panne — un serveur lent ne bloque jamais la conversation", () => {
  it("chaque cause a sa phrase, sans adresse ni commande", () => {
    // Robustesse : le message ne nomme que l'identifiant, jamais une adresse
    // (`https://…`), une commande (`node`) ou une clé.
    for (const kind of ["timeout", "connect", "no-command", "no-url", "bad-url"]) {
      const message = mcpServerUnavailableNotice("distant", kind);
      expect(message).toContain("« distant »");
      expect(message).toContain("Les autres serveurs");
      expect(message).not.toContain("http");
      expect(message).not.toContain("node");
      expect(message.split("\n")).toHaveLength(1);
    }
    expect(mcpServerUnavailableNotice("distant", "timeout")).toContain("délai dépassé");
  });

  it("l'empreinte ne change que si la FICHE change (pas de nouvelle tentative en boucle)", () => {
    const server = { id: "a", transport: "stdio", command: "node", args: ["x.js"] };
    const empreinte = mcpServerFingerprint(server);
    expect(mcpServerFingerprint({ ...server })).toBe(empreinte);
    expect(mcpServerFingerprint({ ...server, args: ["y.js"] })).not.toBe(empreinte);
    expect(mcpServerFingerprint({ ...server, url: "https://x" })).not.toBe(empreinte);
  });
});

describe("chaîne Rust → variables d'environnement → extension", () => {
  it("l'Assistant reçoit une table de clés, pas une clé unique", () => {
    // (5) : `attach_mcp_secrets` (une entrée par serveur) est branché sur la
    // session de l'Assistant ; la clé unique reste réservée aux agents.
    expect(agentServiceRs).toContain("Self::attach_mcp_secrets_env(app, &mut vars);");
    expect(agentServiceRs).toContain("fn attach_mcp_secrets_env(");
    expect(mcpConfigRs).toContain("pub fn attach_mcp_secrets(");
    expect(mcpConfigRs).toContain('"PILOT_MCP_SECRETS"');
    // La session de l'Assistant utilise bien le chemin multi-serveurs…
    const start = agentServiceRs.indexOf("Self::attach_mcp_secrets_env(app, &mut vars);");
    expect(start).toBeGreaterThan(0);
    // …tandis qu'un agent garde son serveur cible unique.
    expect(agentServiceRs).toContain(
      "Self::attach_mcp_secret_env(app, &mut vars, mcp_server.as_deref());",
    );
  });

  it("l'extension décide par le module partagé, pas par « premier activé »", () => {
    // (1) + (2) + (4) : le point d'entrée du mode multi-serveurs ne doit pas
    // revenir à une sélection unique ni oublier la répartition des noms.
    for (const ancre of [
      "planMcpSessionServers(cfg, {})",
      "planMcpRefresh(plan,",
      "resolveToolNames(",
      "crossServerToolClashMessage(",
      "scopeMcpSecretForServer(process.env",
      "mcpServerStillEnabled(cfg, record.id)",
    ]) {
      expect(extensionSrc).toContain(ancre);
    }
    // Le repli « premier serveur activé » n'existe plus que dans la branche AGENT
    // (PILOT_MCP_SERVER), jamais dans la branche Assistant.
    const indexTarget = extensionSrc.indexOf("if (targetId) {");
    const indexAssistant = extensionSrc.indexOf("const loaded = new Map");
    expect(indexTarget).toBeGreaterThan(0);
    expect(indexAssistant).toBeGreaterThan(indexTarget);
    const brancheAgent = extensionSrc.slice(indexTarget, indexAssistant);
    expect(brancheAgent).toContain("enabledServers[0]"); // comportement historique agent
    const brancheAssistant = extensionSrc.slice(indexAssistant);
    expect(brancheAssistant).not.toContain("enabledServers[0]");
    expect(brancheAssistant).not.toContain("PILOT_MCP_SERVER");
  });
});
