import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldScheduleTick, parseScheduleEvery, parseScheduleSetEnabled, formatReminderDate, formatReminderQuietLabel, formatReminderNotificationLabel, planDueReminderInjections } from "./super-agent-schedule.js";

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

describe("planDueReminderInjections (réglage « points à faire à l'ouverture » + une relance par passe)", () => {
  const due = [
    { id: 987, name: "veille_des_risques", prompt: "Veille des risques…" },
    { id: 988, name: "reprise_chantiers_en_attente", prompt: "Rappel de reprise…" },
  ];
  const vide = new Set();

  it("ne lance AUCUN rappel dû au démarrage quand le réglage est désactivé et que le propriétaire n'a pas écrit", () => {
    // Promesse du réglage (index.html, case « Vérifier les points à faire à
    // l'ouverture de la session ») : « Désactivé par défaut : l'Assistant ne
    // lance pas automatiquement un rappel dû au démarrage ». Deux rappels échus
    // pendant une fermeture de 24 h partaient ensemble au premier tick →
    // l'assistant se lançait dans un travail non demandé et n'était plus
    // joignable.
    const plan = planDueReminderInjections({
      due,
      pendingIds: vide,
      backendBusy: false,
      autoCheckStartup: false,
      ownerEngaged: false,
    });
    expect(plan.toInject).toEqual([]);
    // Rien n'est perdu : les rappels restent DUS (aucun marquage, aucune
    // consommation) et représenteront à la passe suivante.
    expect(plan.held.map((d) => d.id)).toEqual([987, 988]);
  });

  it("lance le rappel dû dès que le réglage est activé (comportement voulu par le propriétaire)", () => {
    const plan = planeSansBusy({ autoCheckStartup: true, ownerEngaged: false });
    expect(plan.toInject.map((d) => d.id)).toEqual([987]);
  });

  it("lance le rappel dû dès que le propriétaire a lui-même écrit dans la session", () => {
    const plan = planeSansBusy({ autoCheckStartup: false, ownerEngaged: true });
    expect(plan.toInject.map((d) => d.id)).toEqual([987]);
  });

  it("n'injecte qu'UNE relance par passe : les autres restent dues pour la passe suivante", () => {
    // Plusieurs rappels échus ensemble ne doivent plus partir à la suite dans
    // la même passe (deux tours de génération empilés → assistant occupé et
    // messages du propriétaire refusés).
    const plan = planeSansBusy({ autoCheckStartup: true, ownerEngaged: true });
    expect(plan.toInject).toHaveLength(1);
    expect(plan.toInject[0].id).toBe(987);
    expect(plan.held.map((d) => `${d.id}`)).toEqual(["988"]);
  });

  it("respecte les gardes historiques (assistant occupé, injection déjà en vol)", () => {
    expect(
      planeSansBusy({ autoCheckStartup: true, backendBusy: true }).toInject
    ).toEqual([]);
    expect(
      planDueReminderInjections({
        due,
        pendingIds: new Set([987]),
        backendBusy: false,
        autoCheckStartup: true,
        ownerEngaged: true,
      }).toInject.map((d) => d.id)
    ).toEqual([988]);
  });

  it("tolère une réponse vide ou malformée (aucune exception)", () => {
    for (const bad of [undefined, null, {}, { due: null }, { due: [] }]) {
      const plan = planDueReminderInjections(bad);
      expect(plan.toInject).toEqual([]);
    }
  });

  function planeSansBusy({ autoCheckStartup, ownerEngaged, backendBusy = false }) {
    return planDueReminderInjections({
      due,
      pendingIds: vide,
      backendBusy,
      autoCheckStartup,
      ownerEngaged,
    });
  }
});

// VERROU DE BRANCHEMENT : la règle vit dans `planDueReminderInjections` et le
// ticker de super-agent.js ne doit PAS réinjecter la liste brute des rappels
// dus. Sans ce verrou, la décision pure resterait verte alors que le tick
// continuerait de tout lancer au démarrage.
describe("branchement du ticker des relances (super-agent.js)", () => {
  const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(racine, "js", "super-agent.js"), "utf8").replace(/\r\n/g, "\n");

  it("le tick décide avec planDueReminderInjections et le réglage du propriétaire", () => {
    expect(source).toContain("planDueReminderInjections({");
    expect(source).toContain("autoCheckStartup: configCache.super_agent_auto_check_startup === true");
  });

  it("le tick n'itère plus la liste brute `due` renvoyée par Rust", () => {
    expect(source).not.toContain("for (const d of due)");
    expect(source).toContain("for (const d of toInject)");
  });

  it("l'engagement du propriétaire est remis à zéro à l'ouverture de session et posé à son envoi", () => {
    expect(source).toContain("ownerEngagedThisSession = false;");
    expect(source).toContain("ownerEngagedThisSession = true;");
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
