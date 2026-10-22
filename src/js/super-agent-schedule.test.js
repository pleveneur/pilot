import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldScheduleTick, parseScheduleEvery, parseScheduleSetEnabled, formatReminderDate, formatReminderQuietLabel, formatReminderNotificationLabel } from "./super-agent-schedule.js";

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

describe("formatReminderNotificationLabel (issue #36 : libellé panneau Événements / toast)", () => {
  it("combine date et marqueur discret pour une date valide", () => {
    expect(formatReminderNotificationLabel(new Date(2026, 7, 29, 14, 30))).toBe("⏰ relance — 29/08 à 14:30");
  });

  it("retourne le marqueur seul sans date (date absente/invalide)", () => {
    expect(formatReminderNotificationLabel(null)).toBe("⏰ relance");
    expect(formatReminderNotificationLabel(undefined)).toBe("⏰ relance");
    expect(formatReminderNotificationLabel("")).toBe("⏰ relance");
    expect(formatReminderNotificationLabel("pas une date")).toBe("⏰ relance");
  });

  it("ne contient jamais le prompt ni le libellé verbeux", () => {
    const out = formatReminderNotificationLabel(new Date(2026, 7, 29, 14, 30));
    expect(out).not.toContain("Rappel programmé");
    expect(out).not.toContain(" : ");
  });

  it("affiche l'HEURE DE LIVRAISON, jamais l'échéance théorique", () => {
    // Le libellé est construit à partir de l'instant de remise effective à
    // l'assistant (`new Date()` dans super-agent.js), et NON de `nextFireAt`.
    // Quand le tick a du retard (onglet fermé, assistant occupé, rappel rejoué),
    // les deux diffèrent : c'est la livraison qui doit s'afficher, et la
    // documentation le dit désormais dans ces termes (spec_super_agent.md).
    const echeance = new Date(2026, 7, 29, 14, 30);
    const livraison = new Date(2026, 7, 29, 16, 5);
    expect(formatReminderNotificationLabel(livraison)).toBe("⏰ relance — 29/08 à 16:05");
    expect(formatReminderNotificationLabel(livraison)).not.toBe(
      `⏰ relance — ${formatReminderDate(echeance)}`
    );
  });
});

// La formulation du libellé n'est écrite qu'à UN endroit : la spec (dont le bloc
// d'aide est généré). Ce verrou l'empêche de redevenir trompeuse ("heure de
// déclenchement" alors que l'horodatage affiché est celui de la livraison).
describe("formulation du libellé de relance dans la documentation", () => {
  const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const spec = readFileSync(resolve(racine, "spec_super_agent.md"), "utf8").replace(/\r\n/g, "\n");

  it("la spec dit « heure de livraison »", () => {
    expect(spec).toContain("**heure de livraison**");
  });

  it("la spec ne dit plus « heure de déclenchement » pour cet horodatage", () => {
    expect(spec).not.toContain("date et heure de déclenchement");
  });

  it("l'aide intégrée (handbook généré) reprend la même formulation", () => {
    const handbook = readFileSync(resolve(racine, "help", "handbook.md"), "utf8").replace(
      /\r\n/g,
      "\n"
    );
    expect(handbook).toContain("**heure de livraison**");
    expect(handbook).not.toContain("date et heure de déclenchement");
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
