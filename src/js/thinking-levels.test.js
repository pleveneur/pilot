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
