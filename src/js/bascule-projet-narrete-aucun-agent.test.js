// bascule-projet-narrete-aucun-agent.test.js — Garde anti-régression de la
// règle propriétaire (2026-10-21) : « un agent qui travaille continue DANS TOUS
// LES CAS — fermeture de son projet, changement de projet en cours, ouverture
// d'un autre projet. L'écran ne commande plus le travail. »
//
// Trois causes couvertes (diagnostic : .pilot/rapports/rapport-diagnostic-changement-projet-arrete-agent.md) :
//  1. PORTÉE D'ONGLET incomplète — l'onglet 🎭 (`mode "agents"`) n'était protégé
//     par aucune règle : chaque bascule/fermeture de projet le fermait.
//  2. ARRÊT GLOBAL sur un geste d'interface — fermer cet onglet émettait
//     `stop_all_agent_processes` (TOUS les agents de TOUS les projets), doublé par
//     `destroyAgentsBus()`.
//  3. ARRÊT CIBLÉ non protégé — la relance à contexte vierge arrêtait le couple
//     (projet, agent) SANS identifiant de session : un arrêt périmé tuait la
//     session neuve d'une autre exécution.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Normalisation des fins de ligne : un runner Windows (core.autocrlf=true)
// produit un worktree CRLF, les ancres multi-lignes doivent rester trouvables.
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { shouldCloseTab } from "./tab-scoping.js";
import { targetedSessionUid } from "./agents-bus.js";

const TABS_JS = read("src/js/tabs.js");
const SIDEBAR_JS = read("src/js/sidebar.js");
const BUS_JS = read("src/js/agents-bus.js");
const SERVICE_RS = read("src-tauri/src/agent_service.rs");
const LIB_RS = read("src-tauri/src/lib.rs");

/** Onglets réalistes d'une session de travail sur deux projets ouverts. */
function workspaceTabs() {
  return [
    { mode: "agent", agentId: "codeur", projectPath: "C:/proj/A" }, // chat du projet quitté
    { mode: "agent", agentId: "codeur", projectPath: "C:/proj/B" }, // chat d'un 3ᵉ projet
    { mode: "agents" }, // 🎭 agents multi-rôles (tous projets)
    { mode: "edit", path: "C:/proj/A/README.md" },
    { mode: "preview", path: "C:/proj/A/README.md" },
    { mode: "terminal" },
    { mode: "superagent" },
    { mode: "dashboard" },
  ];
}

/** Corps d'une fonction JS (accolades équilibrées, texte normalisé). */
function functionBody(source, header) {
  const start = source.indexOf(header);
  expect(start, `fonction introuvable : ${header}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start + header.length);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`accolades non équilibrées : ${header}`);
}

describe("Changement de projet — aucun onglet d'agent n'est fermé", () => {
  it("la bascule (keepAgents=true) ne ferme aucun onglet d'agent, même d'un 3ᵉ projet", () => {
    const closed = workspaceTabs().filter((t) => shouldCloseTab(t, true));
    // Seuls edit/preview/terminal sont fermés : aucune perte de session agent.
    expect(closed.every((t) => ["edit", "preview", "terminal"].includes(t.mode))).toBe(true);
    const agentish = closed.filter((t) => t.mode === "agent" || t.mode === "agents");
    expect(agentish).toEqual([]);
  });

  it("l'onglet 🎭 (agents multi-rôles) survit à la bascule ET à la fermeture de projet", () => {
    const agentsTab = { mode: "agents" };
    expect(shouldCloseTab(agentsTab, true)).toBe(false); // changement de projet
    expect(shouldCloseTab(agentsTab, false)).toBe(false); // fermeture de projet
  });

  it("l'agent d'un troisième projet survit à la bascule (aucun arrêt global émis)", () => {
    const third = { mode: "agent", agentId: "codeur", projectPath: "C:/proj/C" };
    // `keepAgents=true` : l'onglet agent est conservé → son nettoyage (donc son
    // arrêt) n'a jamais lieu pendant la bascule.
    expect(shouldCloseTab(third, true)).toBe(false);
  });
});

describe("Aucun geste d'interface n'émet d'arrêt GLOBAL des processus d'agents", () => {
  it("les deux sites de tabs.js sont sous la garde `skipAgentStop`", () => {
    const sites = TABS_JS.match(/invoke\("stop_all_agent_processes"\)/g) || [];
    expect(sites.length).toBe(2);
    const guarded =
      TABS_JS.match(/if \(!options\.skipAgentStop\) \{\s*invoke\("stop_all_agent_processes"\)/g) || [];
    expect(guarded.length).toBe(sites.length);
  });

  it("démonter le bus d'agents (fermeture de l'onglet 🎭) ne tue plus les processus", () => {
    const body = functionBody(BUS_JS, "export function destroyAgentsBus()");
    expect(body).not.toContain("stopAllAgentProcesses(");
    expect(body).not.toContain("stop_all_agent_processes");
    // ... mais il détache bien ses abonnements (aucun abonné fantôme).
    expect(body).toContain("busState.listeners");
  });

  it("fermer un projet parke l'agent au lieu de le tuer (sidebar)", () => {
    const body = functionBody(SIDEBAR_JS, "async closeProject(");
    // `parked=true` → `skipAgentStop` : aucun arrêt émis par un geste d'UI.
    expect(body).toMatch(/_closeAllTabs\(true, false\)/);
    expect(body).not.toContain("stop_agent_session");
    expect(body).not.toContain("stop_all_agent_processes");
  });

  it("le cœur Rust ne tue plus tous les agents à la fermeture d'un projet", () => {
    const body = functionBody(LIB_RS, "fn close_project(");
    expect(body).not.toContain("do_stop_all_agent_processes(");
    // Seules les sessions OISIVES du projet sont libérées ; celles qui travaillent
    // restent vivantes.
    expect(body).toContain("stop_idle_project_sessions");
    expect(body).toContain("pause(&target");
  });
});

describe("Arrêt ciblé — toujours protégé par l'identifiant de session", () => {
  it("targetedSessionUid lit `sessionUid` et refuse les valeurs inutilisables", () => {
    expect(targetedSessionUid({ sessionUid: 42 })).toBe(42);
    expect(targetedSessionUid({ sessionUid: 0 })).toBeNull();
    expect(targetedSessionUid({ sessionUid: "7" })).toBeNull();
    expect(targetedSessionUid({})).toBeNull();
    expect(targetedSessionUid(undefined)).toBeNull();
  });

  it("la relance à contexte vierge vise la session trouvée (expectedUid)", () => {
    const body = functionBody(BUS_JS, "async function forceStaleAgentProcessRestartIfNeeded(");
    expect(body).toContain("targetedSessionUid(existing)");
    expect(body).toContain("expectedUid");
    expect(body).toMatch(/stop_agent_process/);
  });

  it("Rust expose `sessionUid` et aborte sous garde de propriété atomique", () => {
    expect(SERVICE_RS).toContain('entry["sessionUid"]');
    expect(SERVICE_RS).toContain("pub fn send_owned(");
    // L'abandon ne fait plus contrôle-puis-envoi : il passe par la garde unique.
    const agents = read("src-tauri/src/agents.rs");
    const body = functionBody(agents, "pub(crate) fn do_abort_agent_process(");
    expect(body).toContain("send_owned(");
    expect(body).not.toContain("check_session_ownership");
  });

  it("Rust : le contrôle de propriété et le retrait sont dans la même section critique", () => {
    const body = functionBody(SERVICE_RS, "pub fn stop_owned(");
    const uidsLock = body.indexOf("session_uids.lock()");
    const check = body.indexOf("session_ownership_allows");
    const remove = body.indexOf("self.sessions.lock()");
    expect(uidsLock).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(uidsLock);
    expect(remove).toBeGreaterThan(check); // retrait AVANT libération du verrou d'uid
  });
});
