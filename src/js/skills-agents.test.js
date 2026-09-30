// Tests unitaires — compétences par agent (cahier D1–D6, lots 2 et 3).
//
// 1. `normalizeAgent` doit PRÉSERVER le champ `skills` : sans ça, tout
//    aller-retour registre → UI → registre écrasait la liste par [] (lot 3).
// 2. `filterSkillsForAgent` (extension pilot-skills.ts) doit retirer les
//    compétences non listées et TOUJOURS garder le quality-gate (lot 2, D6).
import { describe, it, expect } from "vitest";
import { normalizeAgent, registryAfterReset } from "./agents.js";
import { filterSkillsForAgent } from "../../src-tauri/extensions/pilot-skills.ts";

describe("normalizeAgent — compétences", () => {
  it("préserve la liste de compétences d'un agent", () => {
    const a = normalizeAgent({
      id: "codeur",
      name: "Codeur",
      skills: ["rust-pilot", "tests-pilot"],
    });
    expect(a.skills).toEqual(["rust-pilot", "tests-pilot"]);
  });

  it("normalise une liste absente ou invalide en tableau vide", () => {
    expect(normalizeAgent({ id: "a", name: "A" }).skills).toEqual([]);
    expect(normalizeAgent({ id: "a", name: "A", skills: "oops" }).skills).toEqual([]);
    expect(normalizeAgent({ id: "a", name: "A", skills: [1, "x"] }).skills).toEqual(["1", "x"]);
  });
});

describe("registryAfterReset — survie des agents personnalisés (D5)", () => {
  it("affiche le registre réel, pas le retour de reset (7 fournis seulement)", () => {
    const resetResult = { version: 1, agents: [{ id: "codeur" }] };
    const reelle = { version: 1, agents: [{ id: "codeur" }, { id: "mon-agent" }] };
    const shown = registryAfterReset(resetResult, reelle);
    // La liste affichée (donc le prochain enregistrement) garde l'agent perso.
    expect(shown.agents.map((a) => a.id)).toEqual(["codeur", "mon-agent"]);
  });

  it("tolère un registre réel illisible (retombe sur le retour de reset)", () => {
    const resetResult = { version: 1, agents: [{ id: "codeur" }] };
    expect(registryAfterReset(resetResult, null).agents.map((a) => a.id)).toEqual(["codeur"]);
  });
});

describe("filterSkillsForAgent — filtrage strict (D6)", () => {
  const skills = [
    { name: "rust-pilot", baseDir: "/home/u/.pilot/skills/rust-pilot" },
    { name: "quality-gate", baseDir: "/app/skills/quality-gate" },
    { name: "auto-decouverte", baseDir: "/projet/.pi/skills/auto-decouverte" },
  ];

  it("sans PILOT_AGENT_SKILLS : aucun filtrage (fail-open)", () => {
    expect(filterSkillsForAgent(skills, undefined)).toEqual(skills);
  });

  it("ne garde que les compétences listées, plus le quality-gate", () => {
    const kept = filterSkillsForAgent(skills, '["rust-pilot"]');
    expect(kept.map((s) => s.name)).toEqual(["rust-pilot", "quality-gate"]);
  });

  it("liste vide : seule la compétence quality-gate reste", () => {
    expect(filterSkillsForAgent(skills, "[]").map((s) => s.name)).toEqual(["quality-gate"]);
  });

  it("matche aussi le nom du dossier quand le frontmatter diffère", () => {
    const kept = filterSkillsForAgent(
      [{ name: "Titre lisible", baseDir: "/home/u/.pilot/skills/rust-pilot" }],
      '["rust-pilot"]',
    );
    expect(kept).toHaveLength(1);
  });

  it("env illisible : fail-open (rien n'est retiré)", () => {
    expect(filterSkillsForAgent(skills, "pas du json")).toEqual(skills);
  });
});
