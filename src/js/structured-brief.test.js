// Tests unitaires — structured-brief.js (enveloppe de brief structuré TÂCHE T1)
import { describe, it, expect } from "vitest";
import {
  qualityGateInstruction,
  hasStructuredSections,
  buildStructuredBrief,
  ensureStructuredBrief,
  applyAssistantBriefEnvelope,
} from "./structured-brief.js";

describe("qualityGateInstruction", () => {
  it("retourne la consigne quality-gate quand activée", () => {
    const out = qualityGateInstruction(true);
    expect(out).toContain("quality-gate");
    expect(out).toContain("cargo test --lib");
  });

  it("retourne une chaîne vide quand désactivée", () => {
    expect(qualityGateInstruction(false)).toBe("");
  });

  it("undefined (non fourni) → activée (consigne présente)", () => {
    expect(qualityGateInstruction()).toContain("quality-gate");
  });
});

describe("hasStructuredSections", () => {
  it("reconnaît un brief déjà structuré (>= 2 sections)", () => {
    const structured = "## Contexte\nA\n\n## Objectif\nB\n\n## Consignes\nC\n\n## Ce qu'il ne faut PAS faire\nD";
    expect(hasStructuredSections(structured)).toBe(true);
  });

  it("ne considère PAS structuré un texte sans section", () => {
    expect(hasStructuredSections("Fais X et vérifie Y.")).toBe(false);
  });

  it("une seule section n'est pas considérée comme structuré (seuil 2)", () => {
    expect(hasStructuredSections("## Contexte\nseul")).toBe(false);
  });

  it("texte vide / null → false", () => {
    expect(hasStructuredSections("")).toBe(false);
    expect(hasStructuredSections(null)).toBe(false);
  });
});

describe("buildStructuredBrief", () => {
  it("construit les 4 sections + préfixe la consigne quality-gate", () => {
    const out = buildStructuredBrief("Corriger le bug X", true);
    expect(out).toContain("## Contexte");
    expect(out).toContain("## Objectif");
    expect(out).toContain("## Consignes");
    expect(out).toContain("## Ce qu'il ne faut PAS faire");
    expect(out).toContain("Corriger le bug X");
    expect(out).toContain("cargo test --lib");
  });

  it("tâche vide → mention « (tâche non précisée) »", () => {
    expect(buildStructuredBrief("", true)).toContain("(tâche non précisée)");
  });

  it("qualityGate désactivé → pas de consigne, sections présentes", () => {
    const out = buildStructuredBrief("T", false);
    // La consigne quality-gate en tête n'est pas préfixée (la mention « cargo
    // test --lib » de la section Consignes est distincte et reste).
    expect(out).not.toContain("Respecte le protocole quality-gate");
    expect(out).toContain("## Objectif");
  });
});

describe("ensureStructuredBrief", () => {
  it("texte non structuré → enveloppe complète construite", () => {
    const out = ensureStructuredBrief("Corriger X", true);
    expect(out).toContain("## Contexte");
    expect(out).toContain("Corriger X");
  });

  it("brief déjà structuré → ne duplique PAS les sections, garde la consigne", () => {
    const structured = "## Contexte\nC\n\n## Objectif\nO\n\n## Consignes\nS\n\n## Ce qu'il ne faut PAS faire\nD";
    const out = ensureStructuredBrief(structured, true);
    expect(out).toContain("cargo test --lib"); // consigne préfixée
    expect(out).toContain("## Objectif");
    // La consigne quality-gate précède, mais on ne ré-ajoute pas une 2e fois les sections.
    expect(out.split("## Objectif").length).toBe(2); // en-tête + occurrence dans le brief original
  });
});

describe("applyAssistantBriefEnvelope", () => {
  it("forceStructured par défaut (true) → brief structuré appliqué", () => {
    const out = applyAssistantBriefEnvelope("Tâche brute");
    expect(out).toContain("## Contexte");
    expect(out).toContain("Tâche brute");
  });

  it("forceStructured=false → seule la consigne quality-gate est préfixée", () => {
    const out = applyAssistantBriefEnvelope("Tâche brute", { forceStructured: false, qualityGate: true });
    expect(out).toContain("cargo test --lib");
    expect(out).not.toContain("## Contexte");
    expect(out).toContain("Tâche brute");
  });

  it("forceStructured=false ET qualityGate=false → tâche inchangée", () => {
    const out = applyAssistantBriefEnvelope("Tâche brute", { forceStructured: false, qualityGate: false });
    expect(out).toBe("Tâche brute");
  });

  it("brief déjà structuré → pas de double section, consigne préfixée", () => {
    const structured = "## Objectif\nO\n\n## Consignes\nS\n\n## Ce qu'il ne faut PAS faire\nD\n\n## Contexte\nC";
    const out = applyAssistantBriefEnvelope(structured);
    expect(out).toContain("cargo test --lib");
    expect(out).toContain("## Objectif");
    expect(out.split("## Objectif").length - 1).toBe(1); // une seule fois
  });

  it("explicite forceStructured=true / qualityGate=true → enveloppe complète", () => {
    const out = applyAssistantBriefEnvelope("X", { forceStructured: true, qualityGate: true });
    expect(out).toContain("## Contexte");
    expect(out).toContain("cargo test --lib");
  });
});
