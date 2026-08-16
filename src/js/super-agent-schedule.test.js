import { describe, it, expect } from "vitest";
import { shouldScheduleTick, parseScheduleEvery } from "./super-agent-schedule.js";

describe("shouldScheduleTick (garde-fou 4 : pas de tick si session morte)", () => {
  it("false si l'onglet 🧭 est fermé (session morte)", () => {
    expect(shouldScheduleTick(false)).toBe(false);
    expect(shouldScheduleTick(undefined)).toBe(false);
    expect(shouldScheduleTick(null)).toBe(false);
  });

  it("true si l'onglet 🧭 est ouvert (session vivante)", () => {
    expect(shouldScheduleTick(true)).toBe(true);
  });
});

describe("parseScheduleEvery (validation miroir de la borne Rust >= 60)", () => {
  it("rejette un intervalle < 60", () => {
    expect(parseScheduleEvery(59)).toContain(">= 60");
    expect(parseScheduleEvery(0)).toContain(">= 60");
    expect(parseScheduleEvery(-5)).toContain(">= 60");
  });

  it("accepte un intervalle >= 60", () => {
    expect(parseScheduleEvery(60)).toBeNull();
    expect(parseScheduleEvery(300)).toBeNull();
  });

  it("rejette les non-entiers / NaN", () => {
    expect(parseScheduleEvery("abc")).toContain("entier");
    expect(parseScheduleEvery(1.5)).toContain("entier");
    expect(parseScheduleEvery(NaN)).toContain("entier");
    expect(parseScheduleEvery(undefined)).toContain("entier");
  });
});
