// mcp-server-toggle.test.js — activer / désactiver UN serveur MCP NOMMÉ depuis
// la conversation de l'Assistant (`mcp_enable_server` / `mcp_disable_server`).
//
// Décision du propriétaire : l'Assistant ne renvoie plus l'utilisateur dans les
// Paramètres pour brancher le bon serveur ; il le fait lui-même, en demandant
// confirmation, et il DIT ce qui a changé.
//
// Ces tests échouent si :
//   (a) activer un serveur n'écrit pas son état activé ;
//   (b) désactiver un serveur n'écrit pas son état désactivé ;
//   (c) un identifiant inconnu provoque une exception ou une écriture ;
//   (d) l'activation n'est pas EXCLUSIVE (les autres serveurs restent activés)
//       ou ne les nomme pas (effet de bord silencieux) ;
//   (e) un autre réglage MCP est touché (client activé, confirmation requise,
//       mode strict, contenu des serveurs, secrets) ;
//   (f) un serveur configuré est supprimé ;
//   (g) la réponse ne rappelle pas l'effet à la prochaine session d'agent ;
//   (h) la chaîne outil → sentinel → assistant → commande Rust est rompue.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MCP_GET_STATE_COMMAND,
  MCP_NEXT_SESSION_NOTE,
  MCP_NO_OTHER_SETTING_NOTE,
  MCP_SERVER_TOGGLE_SENTINEL,
  MCP_SET_SERVERS_ENABLED_COMMAND,
  applyMcpServerToggle,
  findMcpServer,
  mcpServerLabel,
  mcpToggleAnswer,
  mcpToggleSystemMessage,
  normalizeMcpServerId,
  planMcpServerToggle,
} from "./mcp-server-toggle.js";
// Découpage de source VÉRIFIÉ (une ancre absente lève une erreur, au lieu de
// rendre un fragment vide qui rendrait une assertion négative vraie par
// construction) — cf. source-slice.js et son inventaire.
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(__dirname, "../..");

/** Lit un fichier source avec fins de ligne normalisées (piège CI Windows). */
function readText(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

const source = readText("src/js/mcp-server-toggle.js");
const actionsTs = readText("src-tauri/extensions/pilot-assistant-actions.ts");
const superAgentJs = readText("src/js/super-agent.js");
const libRs = readText("src-tauri/src/lib.rs");
const mcpConfigRs = readText("src-tauri/src/mcp_config.rs");

/** Nombre d'occurrences d'un motif littéral. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Corps d'un outil de l'extension (jusqu'au `pi.registerTool` suivant). */
function toolBody(name) {
  return sliceSource(actionsTs, `name: "${name}"`, "pi.registerTool({", 300);
}

/** État MCP de référence, celui que rend `mcp_get_state`. */
function etat(serveurs) {
  return {
    enabled: true,
    confirm: true,
    servers: serveurs.map(([id, enabled, name]) => ({
      id,
      name: name === undefined ? id : name,
      enabled,
      transport: "stdio",
    })),
  };
}

/**
 * Faux `invoke` qui imite le comportement de Rust : `mcp_get_state` rend l'état
 * fourni, `mcp_set_servers_enabled` applique les états `enabled` demandés et
 * refuse un identifiant inconnu. Toute autre commande est TRACÉE (c'est ainsi
 * qu'on prouve qu'aucun autre réglage n'est touché).
 */
function fakeInvoke(state, options = {}) {
  const calls = [];
  const servers = state.servers.map((s) => ({ ...s }));
  const invokeFn = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === MCP_GET_STATE_COMMAND) {
      if (options.stateError) throw new Error(options.stateError);
      return { ...state, servers: servers.map((s) => ({ ...s })) };
    }
    if (cmd === MCP_SET_SERVERS_ENABLED_COMMAND) {
      if (options.writeError) throw new Error(options.writeError);
      if (options.refuse) {
        return { ok: false, error: options.refuse, applied: [] };
      }
      const applied = [];
      for (const change of args.changes) {
        const target = servers.find((s) => s.id === change.id);
        if (!target) throw new Error(`Serveur MCP inconnu : « ${change.id} »`);
        if (target.enabled !== change.enabled) {
          target.enabled = change.enabled;
          applied.push(target.id);
        }
      }
      return { ok: true, applied, servers };
    }
    throw new Error(`commande inattendue : ${cmd}`);
  };
  return { calls, invokeFn, etatCourant: () => servers };
}

describe("serveur MCP nommé — décision pure (aucune I/O)", () => {
  it("normalise l'identifiant et rend un libellé lisible", () => {
    expect(normalizeMcpServerId("  mcp-1 ")).toBe("mcp-1");
    expect(normalizeMcpServerId(undefined)).toBe("");
    expect(normalizeMcpServerId(42)).toBe("");
    expect(mcpServerLabel({ id: "mcp-1", name: "Presence" })).toBe("« Presence » (mcp-1)");
    expect(mcpServerLabel({ id: "test", name: "" })).toBe("« test »");
  });

  it("retrouve un serveur par identifiant, casse et espaces ignorés", () => {
    const state = etat([["mcp-1", true], ["test", false]]);
    expect(findMcpServer(state, "mcp-1").index).toBe(0);
    expect(findMcpServer(state, " TEST ").server.id).toBe("test");
    expect(findMcpServer(state, "absent")).toBeNull();
    expect(findMcpServer(state, "")).toBeNull();
    expect(findMcpServer({}, "mcp-1")).toBeNull();
  });

  it("ACTIVE un serveur désactivé : un seul état à écrire, rien d'autre coupé", () => {
    // (a) — ici aucun AUTRE serveur n'est activé : l'exclusivité n'a rien à couper.
    const plan = planMcpServerToggle(etat([["mcp-1", false], ["test", false]]), {
      server: "test",
      enabled: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.changed).toBe(true);
    expect(plan.id).toBe("test");
    expect(plan.changes).toEqual([{ id: "test", enabled: true }]);
    expect(plan.disabledOthers).toEqual([]);
    expect(plan.wasEnabled).toBe(false);
  });

  it("DÉSACTIVE un serveur activé : un seul état à écrire, aucun activé d'office", () => {
    // (b)
    const plan = planMcpServerToggle(etat([["mcp-1", true], ["test", false]]), {
      server: "mcp-1",
      enabled: false,
    });
    expect(plan.ok).toBe(true);
    expect(plan.changes).toEqual([{ id: "mcp-1", enabled: false }]);
    // Aucune ligne n'active `test` : désactiver ne promeut personne.
    expect(plan.changes.some((c) => c.enabled === true)).toBe(false);
    expect(plan.disabledOthers).toEqual([]);
  });

  it("REFUSE un identifiant inconnu avec un message clair, sans rien changer", () => {
    // (c)
    const plan = planMcpServerToggle(etat([["mcp-1", true]]), {
      server: "serveur-fantome",
      enabled: true,
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("unknown-server");
    expect(plan.changes).toBeUndefined();
    expect(plan.message).toContain("serveur-fantome");
    expect(plan.message).toContain("mcp-1"); // les serveurs connus sont nommés
    expect(plan.message).toContain("Rien n'a été modifié");
    expect(plan.knownServers).toEqual(["mcp-1"]);
  });

  it("REFUSE une demande sans identifiant (jamais une exception)", () => {
    const plan = planMcpServerToggle(etat([["mcp-1", true]]), { enabled: true });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("missing-server");
    expect(plan.message).toContain("rien n'a été modifié");
  });

  it("ACTIVATION EXCLUSIVE : les autres serveurs activés sont coupés ET nommés", () => {
    // (d) — `context7` est DÉJÀ activé : il n'y a donc rien à écrire pour lui, ce
    // sont les AUTRES qui sont coupés.
    const plan = planMcpServerToggle(
      etat([["mcp-1", true, "Presence"], ["test", true, "Test"], ["context7", true], ["off", false]]),
      { server: "context7", enabled: true },
    );
    expect(plan.ok).toBe(true);
    expect(plan.wasEnabled).toBe(true);
    expect(plan.disabledOthers).toEqual(["« Presence » (mcp-1)", "« Test » (test)"]);
    // Le serveur déjà désactivé n'est pas touché : une écriture pour rien n'a
    // pas lieu d'être.
    expect(plan.changes).toEqual([
      { id: "mcp-1", enabled: false },
      { id: "test", enabled: false },
    ]);
    expect(plan.changes.some((c) => c.id === "off")).toBe(false);
    // Et après application, il ne reste qu'UN serveur activé.
    const restants = etat([["mcp-1", true], ["test", true], ["context7", true], ["off", false]]).servers
      .map((s) => (plan.changes.find((c) => c.id === s.id) ? { ...s, enabled: false } : s))
      .filter((s) => s.enabled)
      .map((s) => s.id);
    expect(restants).toEqual(["context7"]);
  });

  it("un serveur DÉJÀ activé seul n'écrit rien et le dit", () => {
    const plan = planMcpServerToggle(etat([["mcp-1", true]]), {
      server: "mcp-1",
      enabled: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.changed).toBe(false);
    expect(plan.changes).toEqual([]);
    const answer = mcpToggleAnswer(plan);
    expect(answer).toContain("DÉJÀ activé");
    expect(answer).toContain("rien à changer");
  });

  it("la réponse dit l'exclusivité, la prochaine session et la portée de l'écriture", () => {
    // (d) + (g)
    const plan = planMcpServerToggle(etat([["mcp-1", true, "Presence"], ["test", false]]), {
      server: "test",
      enabled: true,
    });
    const answer = mcpToggleAnswer(plan);
    expect(answer).toContain("ACTIVÉ");
    expect(answer).toContain("« Presence » (mcp-1)"); // le serveur coupé est nommé
    expect(answer).toContain(MCP_NEXT_SESSION_NOTE);
    expect(answer).toContain(MCP_NO_OTHER_SETTING_NOTE);
    expect(answer.split("\n")).toHaveLength(1);

    const off = mcpToggleAnswer(
      planMcpServerToggle(etat([["mcp-1", true]]), { server: "mcp-1", enabled: false }),
    );
    expect(off).toContain("DÉSACTIVÉ");
    expect(off).toContain("aucun serveur n'est activé d'office");
    expect(off).toContain(MCP_NEXT_SESSION_NOTE);
  });

  it("le message système rend le changement VISIBLE en une ligne", () => {
    const actif = planMcpServerToggle(etat([["mcp-1", true, "Presence"], ["test", false]]), {
      server: "test",
      enabled: true,
    });
    const ligne = mcpToggleSystemMessage(actif);
    expect(ligne).toContain("Serveur MCP");
    expect(ligne).toContain("test");
    expect(ligne).toContain("Presence"); // le serveur coupé est visible
    expect(ligne.split("\n")).toHaveLength(1);
    const off = mcpToggleSystemMessage(
      planMcpServerToggle(etat([["test", true]]), { server: "test", enabled: false }),
    );
    expect(off).toContain("désactivé");
  });
});

describe("serveur MCP nommé — application (commande Rust, écriture NARROW)", () => {
  it("ACTIVE : lit l'état puis n'écrit QUE l'état du serveur nommé", async () => {
    // (a) + (e) — aucun autre serveur n'est activé : aucune coupure annexe.
    const fake = fakeInvoke(etat([["mcp-1", false], ["test", false]]));
    const plan = await applyMcpServerToggle(
      { server: "test", enabled: true },
      { invokeFn: fake.invokeFn },
    );
    expect(plan.ok).toBe(true);
    expect(plan.written).toEqual(["test"]);
    expect(fake.calls.map((c) => c.cmd)).toEqual([
      MCP_GET_STATE_COMMAND,
      MCP_SET_SERVERS_ENABLED_COMMAND,
    ]);
    // La charge écrite ne porte QUE des couples {id, enabled} : aucun autre
    // réglage (client MCP, confirmation, mode strict, secrets) ne peut partir.
    const payload = fake.calls[1].args;
    expect(Object.keys(payload)).toEqual(["changes"]);
    for (const change of payload.changes) {
      expect(Object.keys(change).sort()).toEqual(["enabled", "id"]);
      expect(typeof change.enabled).toBe("boolean");
    }
    // Aucun serveur supprimé, tous toujours présents.
    expect(fake.etatCourant().map((s) => s.id)).toEqual(["mcp-1", "test"]);
  });

  it("DÉSACTIVE : écrit uniquement l'état du serveur nommé", async () => {
    // (b)
    const fake = fakeInvoke(etat([["mcp-1", true], ["test", true]]));
    const plan = await applyMcpServerToggle(
      { server: "test", enabled: false },
      { invokeFn: fake.invokeFn },
    );
    expect(plan.ok).toBe(true);
    expect(plan.written).toEqual(["test"]);
    expect(fake.etatCourant()).toEqual([
      { id: "mcp-1", name: "mcp-1", enabled: true, transport: "stdio" },
      { id: "test", name: "test", enabled: false, transport: "stdio" },
    ]);
  });

  it("ACTIVATION EXCLUSIVE : après écriture, un seul serveur reste activé", async () => {
    // (d)
    const fake = fakeInvoke(
      etat([["mcp-1", true, "Presence"], ["test", true, "Test"], ["context7", false]]),
    );
    const plan = await applyMcpServerToggle(
      { server: "context7", enabled: true },
      { invokeFn: fake.invokeFn },
    );
    expect(plan.ok).toBe(true);
    const actifs = fake.etatCourant().filter((s) => s.enabled).map((s) => s.id);
    expect(actifs).toEqual(["context7"]);
    expect(plan.disabledOthers).toHaveLength(2);
  });

  it("IDENTIFIANT INCONNU : aucune écriture, message clair, aucune exception", async () => {
    // (c) + (f)
    const fake = fakeInvoke(etat([["mcp-1", true]]));
    const plan = await applyMcpServerToggle(
      { server: "inconnu", enabled: true },
      { invokeFn: fake.invokeFn },
    );
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("unknown-server");
    expect(fake.calls.map((c) => c.cmd)).toEqual([MCP_GET_STATE_COMMAND]);
    expect(fake.etatCourant()).toEqual([
      { id: "mcp-1", name: "mcp-1", enabled: true, transport: "stdio" },
    ]);
    expect(mcpToggleAnswer(plan)).toContain("inconnu");
  });

  it("état illisible ou écriture en échec : rien n'est modifié, message clair", async () => {
    const lecture = fakeInvoke(etat([["mcp-1", true]]), { stateError: "disque indisponible" });
    const p1 = await applyMcpServerToggle({ server: "mcp-1", enabled: false }, { invokeFn: lecture.invokeFn });
    expect(p1.ok).toBe(false);
    expect(p1.reason).toBe("state-unavailable");
    expect(lecture.calls).toHaveLength(1);

    const refus = fakeInvoke(etat([["mcp-1", true]]), { refuse: "configuration en lecture seule" });
    const p2 = await applyMcpServerToggle({ server: "mcp-1", enabled: false }, { invokeFn: refus.invokeFn });
    expect(p2.ok).toBe(false);
    expect(p2.reason).toBe("write-refused");
    expect(p2.message).toContain("Rien n'a été modifié");

    const panne = fakeInvoke(etat([["mcp-1", true]]), { writeError: "disque plein" });
    const p3 = await applyMcpServerToggle({ server: "mcp-1", enabled: false }, { invokeFn: panne.invokeFn });
    expect(p3.ok).toBe(false);
    expect(p3.reason).toBe("write-failed");
    expect(panne.etatCourant()[0].enabled).toBe(true);
  });

  it("état déjà atteint : aucune écriture du tout", async () => {
    const fake = fakeInvoke(etat([["mcp-1", true]]));
    const plan = await applyMcpServerToggle(
      { server: "mcp-1", enabled: true },
      { invokeFn: fake.invokeFn },
    );
    expect(plan.ok).toBe(true);
    expect(plan.written).toEqual([]);
    expect(fake.calls.map((c) => c.cmd)).toEqual([MCP_GET_STATE_COMMAND]);
  });

  it("ne touche JAMAIS au contenu des serveurs ni aux secrets", () => {
    // (e) + (f) lecture du module : une seule commande d'écriture, aucun champ
    // de contenu de serveur n'est construit ici.
    expect(count(source, `"${MCP_SET_SERVERS_ENABLED_COMMAND}"`)).toBe(1);
    for (const interdit of [
      "mcp_save_servers",
      "mcp_set_enabled",
      "mcp_set_agent_confirm",
      "mcp_set_secret_strict",
      "mcp_set_screen_guard",
      "secret_ref",
      "vault_",
    ]) {
      expect(source.includes(interdit), `le module ne doit pas citer ${interdit}`).toBe(false);
    }
  });
});

describe("serveur MCP nommé — chaîne complète outil → sentinel → assistant → Rust", () => {
  it("les DEUX outils existent, une seule fois chacun", () => {
    // (h)
    expect(count(actionsTs, 'name: "mcp_enable_server"')).toBe(1);
    expect(count(actionsTs, 'name: "mcp_disable_server"')).toBe(1);
    expect(count(actionsTs, "PILOT_ASSISTANT_MCP_SERVER::")).toBe(1);
  });

  it("chaque outil passe par le sentinel avec { server, enabled } et UN seul paramètre", () => {
    const actif = toolBody("mcp_enable_server");
    const inactif = toolBody("mcp_disable_server");
    for (const [corps, enabled] of [
      [actif, true],
      [inactif, false],
    ]) {
      expect(corps).toContain("MCP_SERVER_TOGGLE_SENTINEL");
      expect(corps).toContain(`enabled: ${enabled}`);
      expect(corps).toContain("ctx.ui.input");
      // Un seul paramètre : l'identifiant du serveur (aucun secret, aucun
      // contenu de serveur ne peut être transmis par cet outil).
      expect(corps).toContain("server: Type.String");
      expect(count(corps, "Type.Object({")).toBe(1);
      expect(corps).not.toContain("Type.Optional(");
      expect(corps).not.toContain("ACTION_SENTINEL");
      expect(corps).not.toContain("RUN_AGENTS_SENTINEL");
    }
  });

  it("les descriptions portent les garde-fous (connu, exclusivité, session, portée)", () => {
    const actif = toolBody("mcp_enable_server");
    expect(actif).toContain("EXCLUSIVE");
    expect(actif).toContain("DÉSACTIVE les autres");
    expect(actif).toContain("PROCHAINE session");
    expect(actif).toContain("ne supprime aucun serveur");
    // (e) la portée est dite dans les deux sens
    for (const mot of ["client MCP", "confirmation requise", "secrets"]) {
      expect(actif).toContain(mot);
      expect(toolBody("mcp_disable_server")).toContain(mot);
    }
    // Règle de confirmation : c'est l'ASSISTANT qui demande, l'outil applique.
    for (const corps of [actif, toolBody("mcp_disable_server")]) {
      expect(corps).toContain("ask_confirm");
      expect(corps).toContain("l'outil applique");
    }
  });

  it("l'assistant 🧭 intercepte le sentinel et répond en clair", () => {
    expect(superAgentJs).toContain('const MCP_SERVER_TOGGLE_SENTINEL = "PILOT_ASSISTANT_MCP_SERVER::"');
    expect(superAgentJs).toContain("title.startsWith(MCP_SERVER_TOGGLE_SENTINEL)");
    const start = superAgentJs.indexOf("title.startsWith(MCP_SERVER_TOGGLE_SENTINEL)");
    const branche = superAgentJs.slice(start, start + 2000);
    expect(branche).toContain("applyMcpServerToggle");
    expect(branche).toContain("respondSuperAgent");
    expect(branche).toContain("mcpToggleAnswer");
    // Le changement est visible dans la conversation (jamais silencieux).
    expect(branche).toContain("appendSystemMessage");
    // Une exception éventuelle ne remonte jamais : elle devient un message.
    expect(branche).toContain("catch");
    expect(superAgentJs).toContain('from "./mcp-server-toggle.js"');
  });

  it("la commande Rust est enregistrée et n'écrit que le champ activé", () => {
    expect(count(libRs, "mcp_config::mcp_set_servers_enabled,")).toBe(1);
    expect(mcpConfigRs).toContain("pub fn mcp_set_servers_enabled(");
    expect(mcpConfigRs).toContain("pub fn apply_server_enable_changes(");
    // La commande n'appelle QUE la lecture et l'écriture du mcp.json : aucun
    // autre réglage de configuration n'est enregistré par ce chemin.
    const corps = sliceSource(
      mcpConfigRs,
      "pub fn mcp_set_servers_enabled(",
      "// ── Test de connexion",
      300,
    );
    expect(corps).toContain("read_mcp_config(&app)");
    expect(corps).toContain("apply_server_enable_changes");
    expect(corps).toContain("write_mcp_config(&app, &cfg)");
    for (const interdit of [
      "save_config_disk",
      "mcp_agent_confirm",
      "mcp_enabled",
      "mcp_secret_strict",
      "screen_control",
    ]) {
      expect(corps.includes(interdit), `la commande ne doit pas toucher ${interdit}`).toBe(false);
    }
    // La fonction pure ne réécrit que `enabled` : une seule affectation.
    const corpsPur = sliceSource(
      mcpConfigRs,
      "pub fn apply_server_enable_changes(",
      "/// Normalise une référence de coffre",
      800,
    );
    expect(corpsPur).toContain("server.enabled = enabled;");
    expect(count(corpsPur, "server.enabled = enabled;")).toBe(1);
  });
});
