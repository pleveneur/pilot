import { describe, it, expect } from "vitest";
import {
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  THINKING_LEVEL_HINT,
  thinkingLabel,
  thinkingLevelRank,
  availableThinkingLevels,
  clampThinkingLevel,
  pickThinkingLevel,
  thinkingLevelOptions,
  THINKING_UNSET_LABEL,
  THINKING_UNAVAILABLE_MESSAGE,
} from "./thinking-levels.js";

describe("libellés", () => {
  it("couvre tous les niveaux, en français et sans doublon", () => {
    expect(Object.keys(THINKING_LEVEL_LABELS).sort()).toEqual([...THINKING_LEVELS].sort());
    const labels = Object.values(THINKING_LEVEL_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
  });

  it("rend le libellé d'une clé, et un texte neutre sinon", () => {
    expect(thinkingLabel("medium")).toBe("Moyen (recommandé)");
    expect(thinkingLabel("")).toBe("Non réglé");
    expect(thinkingLabel(undefined)).toBe("Non réglé");
    expect(thinkingLabel("inconnu")).toBe("inconnu");
  });

  it("expose une aide utilisateur non vide", () => {
    expect(THINKING_LEVEL_HINT.length).toBeGreaterThan(20);
  });

  it("ordonne les niveaux du plus faible au plus fort", () => {
    expect(thinkingLevelRank("off")).toBe(0);
    expect(thinkingLevelRank("max")).toBe(THINKING_LEVELS.length - 1);
    expect(thinkingLevelRank("nope")).toBe(-1);
  });
});

// Table de cas partagée avec la version Rust (src-tauri/src/thinking.rs).
const CLAMP_CASES = [
  { requested: "high", available: ["off", "low", "medium", "high"], expected: "high" },
  { requested: "max", available: ["off", "low", "medium"], expected: "medium" },
  { requested: "xhigh", available: ["off", "low", "high", "max"], expected: "high" },
  { requested: "off", available: ["off", "low", "high"], expected: "off" },
  { requested: "high", available: ["off"], expected: "off" },
  { requested: "low", available: ["medium", "high"], expected: "medium" },
  { requested: "high", available: [], expected: null },
  { requested: "", available: ["off"], expected: null },
  { requested: "max", available: ["bidon"], expected: null },
];

describe("clampThinkingLevel", () => {
  for (const { requested, available, expected } of CLAMP_CASES) {
    it(`ramène ${JSON.stringify(requested)} sur ${JSON.stringify(available)} → ${expected}`, () => {
      expect(clampThinkingLevel(requested, available)).toBe(expected);
    });
  }

  it("ne remonte jamais au-dessus du niveau demandé", () => {
    const result = clampThinkingLevel("low", ["off", "high", "max"]);
    expect(thinkingLevelRank(result)).toBeLessThanOrEqual(thinkingLevelRank("low"));
  });
});

const STORE_CASES = [
  { entry: { reasoning: false }, expected: ["off"] },
  {
    entry: {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
    },
    expected: ["off", "high", "max"],
  },
  {
    entry: { reasoning: true, thinkingLevelMap: { low: null, medium: null, high: "high" } },
    expected: ["off", "high"],
  },
  { entry: { reasoning: true }, expected: [] },
  { entry: null, expected: [] },
  { entry: "texte", expected: [] },
];

describe("availableThinkingLevels", () => {
  for (const { entry, expected } of STORE_CASES) {
    it(`lit ${JSON.stringify(entry)} → ${JSON.stringify(expected)}`, () => {
      expect(availableThinkingLevels(entry)).toEqual(expected);
    });
  }
});

describe("pickThinkingLevel", () => {
  it("retient la première valeur non vide, dans l'ordre de priorité", () => {
    expect(pickThinkingLevel(["", "high", "low"])).toBe("high");
    expect(pickThinkingLevel([null, undefined, "medium"])).toBe("medium");
    expect(pickThinkingLevel([" high "])).toBe("high");
  });

  it("rend null quand aucun étage ne fournit de valeur", () => {
    expect(pickThinkingLevel([])).toBe(null);
    expect(pickThinkingLevel(["", "   "])).toBe(null);
    expect(pickThinkingLevel(undefined)).toBe(null);
  });
});

describe("thinkingLevelOptions — contenu d'un sélecteur (T6)", () => {
  it("modèle raisonnant : entrée « non réglé » + niveaux supportés, dans l'ordre", () => {
    const res = thinkingLevelOptions(["off", "low", "medium", "high"], { current: "medium" });
    expect(res.disabled).toBe(false);
    expect(res.message).toBe("");
    expect(res.options.map((o) => o.value)).toEqual(["", "off", "low", "medium", "high"]);
    expect(res.options[0].label).toBe(THINKING_UNSET_LABEL);
    // Les libellés sont français (jamais la clé technique seule).
    expect(res.options.find((o) => o.value === "high").label).toBe("Élevé");
  });

  it("n'invente aucun niveau : ce que dit le moteur, rien d'autre", () => {
    const res = thinkingLevelOptions(["low", "high"]);
    expect(res.options.map((o) => o.value)).toEqual(["", "low", "high"]);
  });

  it("modèle sans raisonnement : sélecteur désactivé + message nommant le fournisseur", () => {
    const res = thinkingLevelOptions(["off"], { provider: "llama-cpp" });
    expect(res.disabled).toBe(true);
    expect(res.message).toContain("llama-cpp");
    expect(res.message).toContain("ne propose pas de niveau de réflexion");
  });

  it("liste inconnue (registre illisible) : désactivé + message d'indisponibilité", () => {
    const res = thinkingLevelOptions([]);
    expect(res.disabled).toBe(true);
    expect(res.message).toBe(THINKING_UNAVAILABLE_MESSAGE);
    expect(res.options.map((o) => o.value)).toEqual([""]);
  });

  it("la valeur enregistrée est TOUJOURS sélectionnable (aucune perte au save)", () => {
    // Cas limite : « off » enregistré et « off » seul supporté → le `.value` du
    // sélecteur désactivé doit rester « off » (sinon enregistrer effacerait le
    // réglage).
    expect(thinkingLevelOptions(["off"], { current: "off" }).options.map((o) => o.value)).toEqual([
      "",
      "off",
    ]);
    // Niveau enregistré que le modèle ne supporte plus (modèle changé) : conservé
    // en tête, marqué, jamais effacé en silence.
    const res = thinkingLevelOptions(["off", "low"], { current: "xhigh" });
    expect(res.options.map((o) => o.value)).toEqual(["", "xhigh", "off", "low"]);
    expect(res.options[1].label).toContain("non supporté");
  });

  it("tolère une entrée invalide sans lever d'exception", () => {
    expect(thinkingLevelOptions(undefined).disabled).toBe(true);
    expect(thinkingLevelOptions(["niveau-inconnu", "high"]).options.map((o) => o.value)).toEqual([
      "",
      "high",
    ]);
  });
});
