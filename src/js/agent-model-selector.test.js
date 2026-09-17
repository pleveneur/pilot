// Tests unitaires — cause C4 du diagnostic de délégation : le sélecteur de
// modèle était PARTAGÉ entre les onglets agents.
//
// Symptôme : avec plusieurs onglets agents ouverts, `document.getElementById(
// "agent-model-select")` renvoie toujours le PREMIER onglet du document →
// choisir un modèle dans l'agent 2 modifiait la sélection de l'agent 1.
//
// Ce test est DISCRIMINANT : il simule la sémantique réelle de
// `document.getElementById` (premier élément portant l'id). Avec l'ancien id
// partagé, les deux agents résolvent le même élément → test rouge. Avec des id
// propres au couple (projet, agent), chaque agent résout le sien → test vert.
import { describe, it, expect } from "vitest";
import {
  agentSelectorIds,
  findModelSelect,
  projectFingerprint,
  sanitizeIdPart,
} from "./agent-model-selector.js";

/**
 * Faux document : `getElementById` renvoie le PREMIER élément ajouté portant
 * cet id, exactement comme le DOM réel (c'est la cause du bug C4).
 */
function fakeDocument() {
  const nodes = [];
  return {
    add(id) {
      const node = { id, value: "" };
      nodes.push(node);
      return node;
    },
    getElementById(id) {
      return nodes.find((n) => n.id === id) || null;
    },
  };
}

describe("agentSelectorIds — identifiants propres au couple (projet, agent)", () => {
  it("deux agents du même projet ont des sélecteurs DIFFÉRENTS (standard/orch/codeur)", () => {
    const a = agentSelectorIds("default", "C:/projA");
    const b = agentSelectorIds("agent-1", "C:/projA");
    expect(a.standard).not.toBe(b.standard);
    expect(a.orchestrator).not.toBe(b.orchestrator);
    expect(a.coder).not.toBe(b.coder);
  });

  it("le même agent sur deux projets a des sélecteurs DIFFÉRENTS", () => {
    const a = agentSelectorIds("default", "C:/projA");
    const b = agentSelectorIds("default", "C:/projB");
    expect(a.standard).not.toBe(b.standard);
  });

  it("est idempotent : le même couple rend toujours les mêmes id (reconstructibles)", () => {
    expect(agentSelectorIds("default", "C:/projA")).toEqual(agentSelectorIds("default", "C:/projA"));
  });

  it("ne se laisse pas tromper par les séparateurs Windows/POSIX ni le slash final", () => {
    expect(projectFingerprint("C:\\projA\\")).toBe(projectFingerprint("C:/projA"));
    expect(agentSelectorIds("default", "C:\\projA\\")).toEqual(agentSelectorIds("default", "C:/projA"));
  });

  it("produit des id HTML valides (pas d'espace, de / ni de \\\\)", () => {
    const ids = agentSelectorIds("agent 1", "C:\\Mes Projets\\proj A\\");
    for (const id of Object.values(ids)) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(ids.standard).toContain("agent_1");
    expect(sanitizeIdPart("")).toBe("x");
    expect(sanitizeIdPart(null)).toBe("x");
  });
});

describe("deux onglets agents ouverts ne partagent PAS le même sélecteur (C4)", () => {
  it("chaque agent résout SON sélecteur, même sémantique de premier match du DOM", () => {
    const idsA = agentSelectorIds("default", "C:/projA");
    const idsB = agentSelectorIds("agent-1", "C:/projA");

    // Les deux onglets construisent leurs <select> dans le même document.
    const doc = fakeDocument();
    const selA = doc.add(idsA.standard);
    doc.add(idsA.orchestrator);
    doc.add(idsA.coder);
    const selB = doc.add(idsB.standard);
    doc.add(idsB.orchestrator);
    doc.add(idsB.coder);

    const lookup = (id) => doc.getElementById(id);
    const selectOfA = findModelSelect(lookup, idsA);
    const selectOfB = findModelSelect(lookup, idsB);

    expect(selectOfA).toBe(selA);
    expect(selectOfB).toBe(selB);
    // Discriminant : avec l'ancien id partagé, selectOfB === selectOfA.
    expect(selectOfA).not.toBe(selectOfB);
    // Idem pour les sélecteurs du mode Orchestration.
    expect(findModelSelect(lookup, idsA, "coder")).not.toBe(findModelSelect(lookup, idsB, "coder"));
    expect(findModelSelect(lookup, idsA, "orchestrator")).not.toBe(
      findModelSelect(lookup, idsB, "orchestrator")
    );
  });

  it("le même agent sur deux projets ouverts ne partage pas non plus son sélecteur", () => {
    const idsA = agentSelectorIds("default", "C:/projA");
    const idsB = agentSelectorIds("default", "C:/projB");
    const doc = fakeDocument();
    const selA = doc.add(idsA.standard);
    const selB = doc.add(idsB.standard);

    const lookup = (id) => doc.getElementById(id);
    expect(findModelSelect(lookup, idsA)).toBe(selA);
    expect(findModelSelect(lookup, idsB)).toBe(selB);
    expect(selA).not.toBe(selB);
  });

  it("sans id ou sans lookup, la résolution est sûre (null, pas d'exception)", () => {
    expect(findModelSelect((id) => ({ id }), null)).toBeNull();
    expect(findModelSelect(null, agentSelectorIds("default", "C:/projA"))).toBeNull();
    expect(findModelSelect((id) => null, agentSelectorIds("default", "C:/projA"))).toBeNull();
  });
});
