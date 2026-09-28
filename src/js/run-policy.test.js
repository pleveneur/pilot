// Tests unitaires — run-policy.js : décision d'admission des missions d'agents
// (lecture partagée / modification exclusive), pure et sans I/O.
import { describe, it, expect } from "vitest";
import { missionNature, canStartMission } from "./run-policy.js";

describe("missionNature", () => {
  it("readonly=true → mission de LECTURE", () => {
    expect(missionNature(true)).toBe("read");
  });

  it("readonly=false ou absent → mission qui MODIFIE", () => {
    expect(missionNature(false)).toBe("write");
    expect(missionNature(undefined)).toBe("write");
  });
});

describe("canStartMission — lecture partagée / modification exclusive", () => {
  it("rien ne tourne sur le projet → tout démarre", () => {
    expect(canStartMission("read", [])).toBe(true);
    expect(canStartMission("write", [])).toBe(true);
    expect(canStartMission("read", undefined)).toBe(true);
  });

  it("lecture + lecture = autorisé (missions de lecture partagées)", () => {
    expect(canStartMission("read", ["read"])).toBe(true);
    expect(canStartMission("read", ["read", "read"])).toBe(true);
  });

  it("une modification ne démarre pas tant que quelque chose tourne", () => {
    expect(canStartMission("write", ["read"])).toBe(false);
    expect(canStartMission("write", ["write"])).toBe(false);
    expect(canStartMission("write", ["read", "read"])).toBe(false);
  });

  it("une lecture ne démarre pas pendant une modification (exclusive)", () => {
    expect(canStartMission("read", ["write"])).toBe(false);
    expect(canStartMission("read", ["read", "write"])).toBe(false);
  });
});
