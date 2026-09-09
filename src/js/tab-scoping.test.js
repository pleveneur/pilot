// tab-scoping.test.js — Tests unitaires du scoping des onglets agents par projet
// (T1 : findAgentTab, T2 : shouldCloseTab). Logique pure extraite de tabs.js /
// sidebar.js pour le chantier « Changer de projet ne doit pas fermer les agents ».

import { describe, it, expect } from "vitest";
import { findAgentTab, shouldCloseTab, sameProjectPath, normPath } from "./tab-scoping.js";

const agentTab = (agentId, projectPath) => ({ mode: "agent", agentId, projectPath });
const editTab = (path) => ({ mode: "edit", path });

describe("sameProjectPath / normPath", () => {
  it("normalise les séparateurs Windows vs POSIX", () => {
    expect(normPath("C:\\proj\\a")).toBe("C:/proj/a");
    expect(sameProjectPath("C:\\proj\\a", "C:/proj/a")).toBe(true);
  });
  it("retourne false si un chemin est absent", () => {
    expect(sameProjectPath(null, "C:/proj/a")).toBe(false);
    expect(sameProjectPath("C:/proj/a", undefined)).toBe(false);
  });
});

describe("findAgentTab (T1 — scoping par projet)", () => {
  const tabs = [
    agentTab("default", "C:/projA"),
    agentTab("default", "C:/projB"),
    agentTab("agent-1", "C:/projA"),
    editTab("C:/projA/readme.md"),
  ];

  it("retrouve l'onglet agent du bon projet (même id sur deux projets)", () => {
    expect(findAgentTab(tabs, "default", "C:/projA")).toBe(tabs[0]);
    expect(findAgentTab(tabs, "default", "C:/projB")).toBe(tabs[1]);
  });
  it("retrouve l'onglet agent par (projectPath, agentId) combiné", () => {
    expect(findAgentTab(tabs, "agent-1", "C:/projA")).toBe(tabs[2]);
  });
  it("retourne undefined si l'agent n'existe pas sur ce projet", () => {
    expect(findAgentTab(tabs, "agent-1", "C:/projB")).toBeUndefined();
    expect(findAgentTab(tabs, "default", "C:/projC")).toBeUndefined();
  });
  it("ignore les onglets non-agent", () => {
    expect(findAgentTab(tabs, "default", "C:/projA")).not.toBe(tabs[3]);
  });
  it("tolère les séparateurs Windows dans le projectPath", () => {
    expect(findAgentTab(tabs, "default", "C:\\projA")).toBe(tabs[0]);
  });
  it("gère une liste vide / null", () => {
    expect(findAgentTab([], "default", "C:/projA")).toBeUndefined();
    expect(findAgentTab(null, "default", "C:/projA")).toBeUndefined();
  });
});

describe("shouldCloseTab (T2 — keepAgents)", () => {
  it("ferme les onglets edit/preview/terminal par défaut", () => {
    expect(shouldCloseTab(editTab("a.md"), false)).toBe(true);
    expect(shouldCloseTab({ mode: "preview" }, false)).toBe(true);
    expect(shouldCloseTab({ mode: "terminal" }, false)).toBe(true);
  });
  it("ferme les onglets agents quand keepAgents=false (close_project)", () => {
    expect(shouldCloseTab(agentTab("default", "C:/projA"), false)).toBe(true);
  });
  it("conserve les onglets agents quand keepAgents=true (changement de projet)", () => {
    expect(shouldCloseTab(agentTab("default", "C:/projA"), true)).toBe(false);
  });
  it("conserve les onglets globaux (superagent, dashboard) dans tous les cas", () => {
    expect(shouldCloseTab({ mode: "superagent" }, false)).toBe(false);
    expect(shouldCloseTab({ mode: "superagent" }, true)).toBe(false);
    expect(shouldCloseTab({ mode: "dashboard" }, false)).toBe(false);
    expect(shouldCloseTab({ mode: "dashboard" }, true)).toBe(false);
  });
  it("ferme toujours les onglets edit même avec keepAgents=true", () => {
    expect(shouldCloseTab(editTab("a.md"), true)).toBe(true);
  });
});
