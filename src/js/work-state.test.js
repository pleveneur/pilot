// Tests — instantané d'état de travail avant la coupe de l'historique.
// Garantie : l'instantané contient la tâche / la demande / la dernière réponse,
// porte une phrase de fraîcheur DATÉE, est borné en taille, et reste vide quand
// aucun champ n'est exploitable (rien n'est alors écrit sur disque, donc rien
// n'est injecté après la compaction).

import { describe, it, expect } from "vitest";
import { buildWorkStateSnapshot, WORK_STATE_MAX_CHARS } from "./work-state.js";

const NOW = new Date("2026-03-14T09:30:00Z");

describe("buildWorkStateSnapshot — instantané d'état de travail", () => {
  it("reprend la tâche, la demande et la dernière réponse", () => {
    const out = buildWorkStateSnapshot({
      userPrompt: "Ajoute le filtre de mémorisation des échanges",
      assistantText: "J'ai ajouté shouldRememberExchange et branché le filtre dans agent-pi.js.",
      orchestrationTask: "#3 Brancher le filtre",
      now: NOW,
    });
    expect(out).toContain("- Tâche en cours : #3 Brancher le filtre");
    expect(out).toContain("- Dernière demande : Ajoute le filtre de mémorisation des échanges");
    expect(out).toContain("J'ai ajouté shouldRememberExchange");
  });

  it("porte une phrase de fraîcheur datée", () => {
    const out = buildWorkStateSnapshot({ userPrompt: "où en est-on ?", now: NOW });
    expect(out).toContain("Enregistré le 2026-03-14");
    expect(out).toMatch(/vérifie le disque avant d'agir/);
  });

  it("ne dépasse jamais la borne de taille, même avec des entrées énormes", () => {
    const out = buildWorkStateSnapshot({
      userPrompt: "d".repeat(5000),
      assistantText: "r".repeat(5000),
      orchestrationTask: "t".repeat(5000),
      now: NOW,
    });
    expect(out.length).toBeLessThanOrEqual(WORK_STATE_MAX_CHARS);
    // La troncature est signalée.
    expect(out).toContain("…");
  });

  it("reste vide quand aucun champ exploitable n'est fourni", () => {
    expect(buildWorkStateSnapshot()).toBe("");
    expect(buildWorkStateSnapshot({ userPrompt: "   ", assistantText: null, orchestrationTask: undefined })).toBe("");
    expect(buildWorkStateSnapshot({ userPrompt: "\n\t " })).toBe("");
  });

  it("tolère un champ manquant (hors orchestration, réponse absente)", () => {
    const out = buildWorkStateSnapshot({ userPrompt: "explique le watcher", now: NOW });
    expect(out).toContain("- Dernière demande : explique le watcher");
    expect(out).not.toContain("- Tâche en cours");
    expect(out).not.toContain("- Dernière réponse");
  });

  it("compacte les espaces/retours à la ligne des champs", () => {
    const out = buildWorkStateSnapshot({
      userPrompt: "ligne 1\n\n  ligne 2\t",
      now: NOW,
    });
    expect(out).toContain("- Dernière demande : ligne 1 ligne 2");
  });
});
