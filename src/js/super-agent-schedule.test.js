import { describe, it, expect } from "vitest";
import { shouldScheduleTick, parseScheduleEvery, parseScheduleSetEnabled, formatReminderDate, formatReminderQuietLabel } from "./super-agent-schedule.js";

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

describe("formatReminderDate (bulle de rappel : date + heure locale)", () => {
  it("formate une date valide en jj/mm à HH:MM heure locale", () => {
    expect(formatReminderDate(new Date(2026, 7, 29, 14, 30))).toBe("29/08 à 14:30");
    expect(formatReminderDate(new Date(2026, 0, 5, 3, 7))).toBe("05/01 à 03:07");
  });

  it("accepte une chaîne ISO interprétée en heure locale", () => {
    expect(formatReminderDate("2026-08-29T14:30:00")).toBe("29/08 à 14:30");
  });

  it("retourne une chaîne vide pour une date absente/invalide (jamais Invalid Date/NaN)", () => {
    for (const bad of [null, undefined, "", "pas une date", Number.NaN, new Date("pas une date")]) {
      const out = formatReminderDate(bad);
      expect(out).toBe("");
      expect(out).not.toContain("Invalid");
      expect(out).not.toContain("NaN");
    }
  });
});

describe("formatReminderQuietLabel (bulle de relance discrète : pas de prompt affiché)", () => {
  it("retourne le marqueur court avec la date quand elle est fournie", () => {
    expect(formatReminderQuietLabel("29/08 à 14:30")).toBe("⏰ relance — 29/08 à 14:30");
    expect(formatReminderQuietLabel("05/01 à 03:07")).toBe("⏰ relance — 05/01 à 03:07");
  });

  it("retourne le marqueur seul sans date (date absente/invalide)", () => {
    expect(formatReminderQuietLabel("")).toBe("⏰ relance");
    expect(formatReminderQuietLabel(undefined)).toBe("⏰ relance");
    expect(formatReminderQuietLabel(null)).toBe("⏰ relance");
  });

  it("ne contient jamais le libellé verbeux « Rappel programmé » ni de prompt", () => {
    const out = formatReminderQuietLabel("29/08 à 14:30");
    expect(out).not.toContain("Rappel programmé");
    expect(out).not.toContain(" : ");
  });
});

describe("parseScheduleSetEnabled (validation miroir de schedule_set_enabled)", () => {
  it("accepte un id entier positif et un booléen", () => {
    expect(parseScheduleSetEnabled(1, true)).toBeNull();
    expect(parseScheduleSetEnabled(42, false)).toBeNull();
  });

  it("rejette un id invalide (désactivation impossible)", () => {
    expect(parseScheduleSetEnabled(0, false)).toContain("entier positif");
    expect(parseScheduleSetEnabled(-3, false)).toContain("entier positif");
    expect(parseScheduleSetEnabled("abc", false)).toContain("entier positif");
    expect(parseScheduleSetEnabled(1.5, false)).toContain("entier positif");
    expect(parseScheduleSetEnabled(undefined, false)).toContain("entier positif");
  });

  it("rejette un enabled non booléen", () => {
    expect(parseScheduleSetEnabled(1, "true")).toContain("booléen");
    expect(parseScheduleSetEnabled(1, 1)).toContain("booléen");
    expect(parseScheduleSetEnabled(1, undefined)).toContain("booléen");
  });
});
