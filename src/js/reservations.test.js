// Tests unitaires — reservations.js (estimation préalable T6 : fichiers réservés)
import { describe, it, expect } from "vitest";
import {
  normalizeReservedPath,
  dedupeFiles,
  parsePlanFiles,
  buildReservations,
  reservationsPath,
} from "./reservations.js";

describe("normalizeReservedPath", () => {
  it("uniformise les séparateurs Windows en '/'", () => {
    expect(normalizeReservedPath("src\\lib.rs")).toBe("src/lib.rs");
    expect(normalizeReservedPath("  src/lib.rs  ")).toBe("src/lib.rs");
    expect(normalizeReservedPath("")).toBe("");
  });
});

describe("dedupeFiles", () => {
  it("déduplique en normalisant et en conservant l'ordre", () => {
    expect(dedupeFiles(["src/a.rs", "src\\a.rs", "src/b.rs", "  "])).toEqual(["src/a.rs", "src/b.rs"]);
  });
  it("gère les entrées non-tableau et vides", () => {
    expect(dedupeFiles(null)).toEqual([]);
    expect(dedupeFiles(undefined)).toEqual([]);
  });
});

describe("parsePlanFiles", () => {
  it("extrait les fichiers d'un plan JSON simple", () => {
    const text = '{"plan":[{"files":["src/lib.rs","src/main.rs"]},{"files":["tests/test.rs"]}]}';
    expect(parsePlanFiles(text)).toEqual(["src/lib.rs", "src/main.rs", "tests/test.rs"]);
  });
  it("gère un plan enveloppé dans une fence markdown json", () => {
    const text = 'Voici le plan :\n```json\n{"plan":[{"files":["src/a.rs","src/b.rs"]}]}\n```';
    expect(parsePlanFiles(text)).toEqual(["src/a.rs", "src/b.rs"]);
  });
  it("gère le wrapper d'agrégation du bus d'agents (texte avant l'objet JSON)", () => {
    const text = '=== Résultat de plan-maker (done) ===\n{"plan":[{"files":["src/c.rs"]}]}\n=== FIN ===';
    expect(parsePlanFiles(text)).toEqual(["src/c.rs"]);
  });
  it("déduplique les fichiers entre tâches", () => {
    const text = '{"plan":[{"files":["src/a.rs"]},{"files":["src/a.rs"]}]}';
    expect(parsePlanFiles(text)).toEqual(["src/a.rs"]);
  });
  it("retourne [] pour un texte sans plan valide (fail-open)", () => {
    expect(parsePlanFiles("")).toEqual([]);
    expect(parsePlanFiles("pas de json du tout")).toEqual([]);
    expect(parsePlanFiles(null)).toEqual([]);
    expect(parsePlanFiles('{"plan":[]}')).toEqual([]);
  });
});

describe("buildReservations", () => {
  it("construit le format attendu par pilot-reserve-gate.ts (T3)", () => {
    expect(buildReservations("codeur", ["src/lib.rs", "src\\lib.rs"])).toEqual({
      coder: "codeur",
      files: ["src/lib.rs"],
    });
  });
  it("coder vide et fichiers vides tolérés (aucune réservation effective)", () => {
    expect(buildReservations("", [])).toEqual({ coder: "", files: [] });
  });
});

describe("reservationsPath", () => {
  it("construit le chemin .pilot/reservations.json depuis le projet", () => {
    expect(reservationsPath("/proj/")).toBe("/proj/.pilot/reservations.json");
    expect(reservationsPath("C:\\proj")).toBe("C:\\proj/.pilot/reservations.json");
  });
});
