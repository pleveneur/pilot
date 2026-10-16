// Tests unitaires — period-report.js (Idée 5, Lot A : bilan de période).
// Logique pure : bornes de semaine (lundi→dimanche, local) et mise en forme du
// bilan. Aucune dépendance DOM/Tauri (environnement `node`).
import { describe, it, expect } from "vitest";
import {
  isoLocalDate,
  isIsoDate,
  weekBounds,
  previousWeekBounds,
  periodBounds,
  periodKindLabel,
  formatPeriodReport,
} from "./period-report.js";

// Les dates de test sont construites en LOCAL (`new Date(y, m, d)`) : le calcul
// des bornes ne doit jamais dépendre du fuseau de la machine de test.
const localDate = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);

describe("weekBounds — semaine du lundi au dimanche (heure locale)", () => {
  it("semaine d'aujourd'hui : un mercredi tombe dans la semaine lundi→dimanche", () => {
    // 2026-10-07 est un mercredi.
    expect(weekBounds(localDate(2026, 10, 7))).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("un lundi reste le lundi de SA semaine (pas de décalage)", () => {
    expect(weekBounds(localDate(2026, 10, 5))).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("un dimanche reste dans SA semaine (pas de bascule sur la semaine suivante)", () => {
    expect(weekBounds(localDate(2026, 10, 11))).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("semaine à cheval sur deux mois (janvier → février)", () => {
    // 2026-01-29 est un jeudi : la semaine va du lundi 26/01 au dimanche 01/02.
    expect(weekBounds(localDate(2026, 1, 29))).toEqual({
      from: "2026-01-26",
      to: "2026-02-01",
    });
  });

  it("semaine à cheval sur deux mois (septembre → octobre)", () => {
    // 2026-09-29 est un mardi : du lundi 28/09 au dimanche 04/10.
    expect(weekBounds(localDate(2026, 9, 29))).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  it("isoLocalDate ne passe jamais par UTC (pas de décalage d'un jour)", () => {
    // Une date locale tardive serait datée du lendemain par toISOString() à
    // l'ouest de Greenwich ; isoLocalDate garde le jour LOCAL.
    expect(isoLocalDate(localDate(2026, 12, 31))).toBe("2026-12-31");
    expect(isoLocalDate(new Date(NaN))).toBe("");
  });
});

describe("previousWeekBounds — semaine dernière", () => {
  it("décale d'exactement 7 jours et retombe sur lundi→dimanche", () => {
    // Référence mercredi 2026-10-07 → semaine précédente 28/09 → 04/10.
    expect(previousWeekBounds(localDate(2026, 10, 7))).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  it("depuis un lundi, la semaine dernière finit le dimanche de la semaine d'avant", () => {
    // Lundi 2026-10-05 → 2026-09-28 → 2026-10-04.
    expect(previousWeekBounds(localDate(2026, 10, 5))).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });
});

describe("periodBounds — sélecteur de période", () => {
  const ref = localDate(2026, 10, 7);

  it("« this-week » = semaine en cours", () => {
    expect(periodBounds("this-week", ref)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("« last-week » = semaine dernière", () => {
    expect(periodBounds("last-week", ref)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("« custom » = période libre, bornes rendues telles quelles", () => {
    expect(periodBounds("custom", ref, { from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("« custom » inverse des bornes saisies à l'envers", () => {
    expect(periodBounds("custom", ref, { from: "2026-03-31", to: "2026-03-01" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("« custom » incomplet ou mal formé → null (jamais d'appel backend)", () => {
    expect(periodBounds("custom", ref, null)).toBeNull();
    expect(periodBounds("custom", ref, { from: "2026-03-01" })).toBeNull();
    expect(periodBounds("custom", ref, { from: "01/03/2026", to: "2026-03-31" })).toBeNull();
  });

  it("type inconnu → null et libellé vide", () => {
    expect(periodBounds("trimestre", ref)).toBeNull();
    expect(periodKindLabel("trimestre")).toBe("");
    expect(periodKindLabel("last-week")).toBe("Semaine dernière");
  });

  it("isIsoDate valide la forme stricte YYYY-MM-DD", () => {
    expect(isIsoDate("2026-10-07")).toBe(true);
    expect(isIsoDate(" 2026-10-07 ")).toBe(true);
    expect(isIsoDate("2026-1-7")).toBe(false);
    expect(isIsoDate("2026/10/07")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("formatPeriodReport — mise en forme du texte à coller", () => {
  it("période vide : toutes les sections annoncent « Aucun »", () => {
    const text = formatPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      tasks_done: [],
      decisions: [],
      milestones: [],
      blockers: [],
    });
    expect(text).toContain("Bilan de période — 2026-10-05 → 2026-10-11");
    expect(text).toContain("Tâches terminées/livrées (0)");
    expect(text).toContain("Décisions prises (0)");
    expect(text).toContain("Jalons atteints (0)");
    expect(text).toContain("Blocages rencontrés (0)");
    // 4 sections vides → 4 lignes « - Aucun ».
    expect(text.match(/- Aucun/g)).toHaveLength(4);
  });

  it("rapport complet : tâches, décisions, jalons et blocages mis en forme", () => {
    const text = formatPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      tasks_done: [
        { id: 1, title: "Corriger le bug", status: "livree", project_name: "Pilot" },
        { id: 2, title: "Rédiger la spec", status: "terminee", project_name: "Pilot" },
      ],
      decisions: [{ id: 3, summary: "On garde SQLite", project_name: "Pilot" }],
      milestones: [{ id: 4, title: "v0.5.0", due_date: "2026-10-10" }],
      blockers: [{ id: 5, title: "Attente API", blocker_reason: "Clé manquante" }],
    });
    expect(text).toContain("Tâches terminées/livrées (2)");
    expect(text).toContain("- Corriger le bug (Pilot)");
    expect(text).toContain("- On garde SQLite (Pilot)");
    expect(text).toContain("- v0.5.0 — échéance 2026-10-10");
    expect(text).toContain("- Attente API — Clé manquante");
    // Plus aucune section vide.
    expect(text).not.toContain("- Aucun");
  });

  it("rapport absent ou partiel : texte cohérent, aucune exception", () => {
    expect(() => formatPeriodReport(null)).not.toThrow();
    const text = formatPeriodReport(undefined, { title: "Bilan de la semaine" });
    expect(text).toContain("Bilan de la semaine — ? → ?");
    expect(text.match(/- Aucun/g)).toHaveLength(4);
  });
});
