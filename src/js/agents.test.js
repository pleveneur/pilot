// Tests unitaires — agents.js (classification codeur/spécialiste + prompt enrichi)
import { describe, it, expect } from "vitest";
import { classifyAgent, buildAgentPrompt } from "./agents.js";

describe("classifyAgent", () => {
  it("codeur : write + readonly=false", () => {
    const a = { id: "codeur", capabilities: ["write", "edit"], readonly: false };
    expect(classifyAgent(a)).toEqual({ isCoder: true, isReadonly: false, capabilities: ["write", "edit"] });
  });

  it("codeur : edit seul + readonly=false", () => {
    const a = { id: "codeur", capabilities: ["edit"], readonly: false };
    expect(classifyAgent(a).isCoder).toBe(true);
  });

  it("spécialiste : readonly=true même avec write", () => {
    const a = { id: "plan-maker", capabilities: ["write", "plan"], readonly: true };
    expect(classifyAgent(a)).toEqual({ isCoder: false, isReadonly: true, capabilities: ["write", "plan"] });
  });

  it("spécialiste : capabilities sans write/edit", () => {
    const a = { id: "reviewer", capabilities: ["review"], readonly: false };
    expect(classifyAgent(a).isCoder).toBe(false);
    expect(classifyAgent(a).isReadonly).toBe(false);
  });

  it("spécialiste : capabilities absentes", () => {
    const a = { id: "doc", readonly: false };
    expect(classifyAgent(a)).toEqual({ isCoder: false, isReadonly: false, capabilities: [] });
  });

  it("agent null/undefined → spécialiste sans capabilities", () => {
    expect(classifyAgent(null)).toEqual({ isCoder: false, isReadonly: false, capabilities: [] });
    expect(classifyAgent(undefined)).toEqual({ isCoder: false, isReadonly: false, capabilities: [] });
  });
});

describe("buildAgentPrompt — enrichissement SPÉCIALITÉ / RÔLE", () => {
  const base = { id: "codeur", role: "Tu es le codeur.", capabilities: ["write"], readonly: false };

  it("injecte le bloc SPÉCIALITÉ avec role et capabilities", () => {
    const p = buildAgentPrompt(base, "Fais X", "", "pi", "");
    expect(p).toContain("=== SPÉCIALITÉ ===");
    expect(p).toContain("Rôle : Tu es le codeur.");
    expect(p).toContain("Capacités : write");
  });

  it("injecte le bloc RÔLE codeur pour un codeur", () => {
    const p = buildAgentPrompt(base, "Fais X", "", "pi", "");
    expect(p).toContain("=== RÔLE ===");
    expect(p).toContain("CODEUR (agent principal)");
  });

  it("injecte le bloc RÔLE spécialiste pour un spécialiste", () => {
    const spec = { id: "reviewer", role: "Tu es le reviewer.", capabilities: ["review"], readonly: true };
    const p = buildAgentPrompt(spec, "Relis", "", "pi", "");
    expect(p).toContain("SPÉCIALISTE");
    expect(p).toContain("fichiers réservés au codeur");
  });

  it("le prompt reste complet et autonome (MISSION + PROTOCOLE présents)", () => {
    const p = buildAgentPrompt(base, "Fais X", "contexte", "pi", "");
    expect(p).toContain("=== MISSION ===");
    expect(p).toContain("=== PROTOCOLE ===");
    expect(p).toContain("=== CONTEXTE PROJET ===");
    expect(p).toContain("DONE:");
  });

  it("le coordinateur (call_depth 0) garde la consigne no-tools", () => {
    const coord = { id: "coordinateur", role: "Tu es le coordinateur.", capabilities: ["delegate"], readonly: false, call_depth: 0 };
    const p = buildAgentPrompt(coord, "Délègue", "", "pi", "");
    expect(p).toContain("N'UTILISE AUCUN OUTIL");
  });
});
