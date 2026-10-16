// Tests unitaires — checklist de livraison VUE DE L'ÉCRAN (Lot A, idée 3, 3.4).
// Ces fonctions pures ne portent AUCUNE règle de mode : elles comptent les
// points relus en base (compteur de carte) et LISENT le verdict rendu par le
// cœur Rust (`guard_task_checklist`) pour savoir s'il faut confirmer (mode
// « rappel », clôture forçable) ou afficher un refus tel quel (mode bloquant).
import { describe, it, expect } from "vitest";
import {
  CHECKLIST_GATE_PREFIX,
  CHECKLIST_FORCE_HINT,
  checklistProgress,
  checklistCounterLabel,
  parseChecklistGate,
  DEFAULT_CHECKLIST_TEMPLATE,
  DEFAULT_CHECKLIST_TEMPLATE_LINES,
  CHECKLIST_MODES,
  normalizeChecklistMode,
  normalizeChecklistTemplate,
  parseChecklistTemplate,
  shouldOfferTemplatePoints,
} from "./super-agent-kanban.js";

describe("checklistProgress", () => {
  it("compte les points cochés / restants", () => {
    const checks = [
      { id: 1, label: "a", done: true },
      { id: 2, label: "b", done: false },
      { id: 3, label: "c", done: true },
    ];
    expect(checklistProgress(checks)).toEqual({ total: 3, done: 2, remaining: 1 });
  });

  it("renvoie 0/0/0 pour une tâche sans point (aucune régression d'apparence)", () => {
    expect(checklistProgress([])).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress(null)).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress(undefined)).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(checklistProgress("pas une liste")).toEqual({ total: 0, done: 0, remaining: 0 });
  });

  it("ignore les entrées nulles et tolère un champ `done` numérique", () => {
    const checks = [null, { done: 1 }, { done: 0 }, undefined];
    expect(checklistProgress(checks)).toEqual({ total: 2, done: 1, remaining: 1 });
    expect(checklistCounterLabel(checks)).toBe("1/2");
    expect(checklistProgress([null, undefined])).toEqual({ total: 0, done: 0, remaining: 0 });
  });
});

describe("checklistCounterLabel", () => {
  it("formate le compteur « coché/total » d'une carte", () => {
    expect(checklistCounterLabel([{ done: true }, { done: false }, { done: false }])).toBe("1/3");
    expect(checklistCounterLabel([{ done: true }, { done: true }])).toBe("2/2");
  });

  it("n'affiche RIEN (chaîne vide) quand la tâche n'a aucun point", () => {
    expect(checklistCounterLabel([])).toBe("");
    expect(checklistCounterLabel(null)).toBe("");
    expect(checklistCounterLabel(undefined)).toBe("");
    // Les tâches existantes (aucun point) gardent donc exactement leur apparence.
  });
});

describe("parseChecklistGate — lecture du verdict du cœur", () => {
  // Messages produits par `checklist_gate_message` (super_agent.rs).
  const WARN_MESSAGE =
    "Checklist de livraison : 2 point(s) restent à cocher avant de terminer la tâche : " +
    "tests passés, doc mise à jour. Relance avec force = true pour conclure malgré tout.";
  const BLOCK_MESSAGE =
    "Checklist de livraison : 1 point(s) restent à cocher avant de terminer la tâche : tests passés.";

  it("mode « rappel » → confirmation requise (relance forçable une fois)", () => {
    const verdict = parseChecklistGate(WARN_MESSAGE);
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(true);
    expect(verdict.refused).toBe(false);
    expect(verdict.remaining).toBe(2);
    expect(verdict.message).toBe(WARN_MESSAGE);
  });

  it("mode « bloquant » → refus sec, sans phrase de forçage (aucune relance)", () => {
    const verdict = parseChecklistGate(BLOCK_MESSAGE);
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(false);
    expect(verdict.refused).toBe(true);
    expect(verdict.remaining).toBe(1);
  });

  it("lit le nombre de points restants même avec « … et N autre(s) »", () => {
    const verdict = parseChecklistGate(
      "Checklist de livraison : 8 point(s) restent à cocher avant de terminer la tâche : " +
        "a, b, c, d, e. Relance avec force = true pour conclure malgré tout."
    );
    expect(verdict.remaining).toBe(8);
    expect(verdict.needsConfirmation).toBe(true);
  });

  it("reconnaît une erreur du cœur transmise comme objet Error", () => {
    const verdict = parseChecklistGate(new Error(WARN_MESSAGE));
    expect(verdict.gate).toBe(true);
    expect(verdict.needsConfirmation).toBe(true);
  });

  it("garde `gate: false` pour une erreur étrangère (message journalisé tel quel)", () => {
    for (const err of ["Tâche 12 introuvable", null, undefined, "", new Error("Erreur de base")]) {
      const verdict = parseChecklistGate(err);
      expect(verdict.gate).toBe(false);
      expect(verdict.needsConfirmation).toBe(false);
      expect(verdict.refused).toBe(false);
      expect(verdict.remaining).toBe(0);
    }
  });

  it("expose des marqueurs alignés sur le message du cœur (miroir Rust)", () => {
    expect(WARN_MESSAGE.includes(CHECKLIST_GATE_PREFIX)).toBe(true);
    expect(WARN_MESSAGE.includes(CHECKLIST_FORCE_HINT)).toBe(true);
    expect(BLOCK_MESSAGE.includes(CHECKLIST_GATE_PREFIX)).toBe(true);
    expect(BLOCK_MESSAGE.includes(CHECKLIST_FORCE_HINT)).toBe(false);
  });
});

// ── Tranche 3.5 : réglages (mode + modèle de points) ────────────────────────

describe("normalizeChecklistMode — lecture du mode de contrôle", () => {
  it("reconnaît les trois modes, quel que soit la casse ou les espaces", () => {
    expect(normalizeChecklistMode("off")).toBe("off");
    expect(normalizeChecklistMode("  OFF ")).toBe("off");
    expect(normalizeChecklistMode("warn")).toBe("warn");
    expect(normalizeChecklistMode("Block")).toBe("block");
  });

  it("retombe sur « rappel simple » (défaut) pour un mode absent ou inconnu", () => {
    // Même repli que `checklist_mode_from_config` (super_agent.rs) : jamais
    // bloquant par surprise, jamais silencieusement désactivé.
    for (const raw of [undefined, null, "", "   ", "strict", "true", 0, {}]) {
      expect(normalizeChecklistMode(raw)).toBe("warn");
    }
    expect(CHECKLIST_MODES).toEqual(["off", "warn", "block"]);
  });
});

describe("normalizeChecklistTemplate / parseChecklistTemplate — modèle de points", () => {
  it("fournit le modèle par défaut quand le champ est absent ou vide", () => {
    expect(DEFAULT_CHECKLIST_TEMPLATE_LINES).toEqual([
      "Tests passés",
      "Documentation à jour",
      "Rien de non commité",
    ]);
    for (const raw of [undefined, null, "", "   ", "\n\n"]) {
      expect(normalizeChecklistTemplate(raw)).toBe(DEFAULT_CHECKLIST_TEMPLATE);
      expect(parseChecklistTemplate(raw)).toEqual(DEFAULT_CHECKLIST_TEMPLATE_LINES);
    }
  });

  it("garde le modèle saisi (espaces de bord retirés) sans le remplacer", () => {
    expect(normalizeChecklistTemplate("  Un point\nDeux  ")).toBe("Un point\nDeux");
  });

  it("découpe une ligne non vide par point, tolère les blancs et \\r\\n", () => {
    expect(parseChecklistTemplate("Tests passés\n\n  Documentation à jour  \r\nRien de non commité\n")).toEqual([
      "Tests passés",
      "Documentation à jour",
      "Rien de non commité",
    ]);
    expect(parseChecklistTemplate("seul")).toEqual(["seul"]);
  });
});

describe("shouldOfferTemplatePoints — proposition JAMAIS imposée", () => {
  it("propose les points du modèle sur une tâche sans point, sauf si désactivé", () => {
    expect(shouldOfferTemplatePoints([], "warn")).toBe(true);
    expect(shouldOfferTemplatePoints([], "block")).toBe(true);
    expect(shouldOfferTemplatePoints([], undefined)).toBe(true); // mode absent → défaut « rappel »
    expect(shouldOfferTemplatePoints([], "off")).toBe(false);
    expect(shouldOfferTemplatePoints(null, "warn")).toBe(true);
  });

  it("ne propose RIEN quand la tâche a déjà des points (aucun changement)", () => {
    for (const mode of CHECKLIST_MODES) {
      expect(shouldOfferTemplatePoints([{ done: false }], mode)).toBe(false);
      expect(shouldOfferTemplatePoints([{ done: true }], mode)).toBe(false);
    }
  });
});
