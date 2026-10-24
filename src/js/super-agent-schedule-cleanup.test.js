import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DAY_MS,
  CLEANUP_DISABLED_STALE_DAYS,
  CLEANUP_ONE_SHOT_GRACE_DAYS,
  CLEANUP_STERILE_RUNS,
  CLEANUP_MAX_ACTIVE,
  parseScheduleStamp,
  classifyScheduleCleanupItem,
  classifyScheduleCleanup,
  scheduleCapReached,
  formatCleanupCandidate,
  cleanupConfirmationText,
  cleanupApplyPayload,
} from "./super-agent-schedule-cleanup.js";

// Instant de référence FIXE : tous les écarts sont calculés à partir de lui, les
// tests ne dépendent donc jamais de l'heure d'exécution.
const NOW = Date.parse("2026-03-01T12:00:00Z");

/** Horodatage au format SQLite (`datetime('now')`, UTC) : « YYYY-MM-DD HH:MM:SS ». */
function stamp(msAgo) {
  return new Date(NOW - msAgo).toISOString().replace("T", " ").slice(0, 19);
}

/** Rappel périodique ACTIF par défaut, surchargé par chaque cas. */
function reminder(over) {
  return {
    id: 1,
    name: "veille",
    prompt: "recheck",
    every: 3600,
    enabled: true,
    last_run_at: stamp(DAY_MS),
    created_at: stamp(2 * DAY_MS),
    one_shot: false,
    sterile_runs: 0,
    ...over,
  };
}

describe("parseScheduleStamp (lecture des dates SQLite UTC)", () => {
  it("lit le format datetime('now') comme de l'UTC, pas de l'heure locale", () => {
    expect(parseScheduleStamp("2026-03-01 12:00:00")).toBe(NOW);
    expect(parseScheduleStamp("2026-03-01T12:00:00Z")).toBe(NOW);
    expect(parseScheduleStamp("2026-03-01T12:00:00.000Z")).toBe(NOW);
  });

  it("rend null pour une valeur absente ou illisible (jamais une date inventée)", () => {
    for (const bad of [null, undefined, "", "   ", "pas une date", {}, [], "2026-13-45 99:99:99"]) {
      expect(parseScheduleStamp(bad)).toBeNull();
    }
  });

  it("accepte un nombre de millisecondes et une Date", () => {
    expect(parseScheduleStamp(NOW)).toBe(NOW);
    expect(parseScheduleStamp(new Date(NOW))).toBe(NOW);
  });
});

describe("règle 1 — rappel désactivé et périmé (supression)", () => {
  it("SUPPRIME un rappel désactivé dont la dernière exécution a plus de 30 jours", () => {
    const s = reminder({ id: 7, name: "vieux veille", enabled: false, last_run_at: stamp((CLEANUP_DISABLED_STALE_DAYS + 5) * DAY_MS) });
    const v = classifyScheduleCleanupItem(s, NOW);
    expect(v.action).toBe("delete");
    expect(v.reason).toContain("désactivé");
  });

  it("SUPPRIME un rappel désactivé JAMAIS exécuté dont la création a plus de 30 jours", () => {
    const s = reminder({ enabled: false, last_run_at: null, created_at: stamp((CLEANUP_DISABLED_STALE_DAYS + 1) * DAY_MS) });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("delete");
  });

  it("CONSERVE un rappel désactivé récemment (garde-fou : jamais de suppression d'un rappel récent)", () => {
    const s = reminder({ enabled: false, last_run_at: stamp(5 * DAY_MS) });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("keep");
  });

  it("seuil exact : 29 jours conservé, 31 jours supprimé (aucune décision « au hasard »)", () => {
    const recent = reminder({ enabled: false, last_run_at: stamp(29 * DAY_MS) });
    const stale = reminder({ enabled: false, last_run_at: stamp(31 * DAY_MS) });
    expect(classifyScheduleCleanupItem(recent, NOW).action).toBe("keep");
    expect(classifyScheduleCleanupItem(stale, NOW).action).toBe("delete");
  });
});

describe("règle 2 — rappel unique déjà consommé", () => {
  it("SUPPRIME un rappel unique dont l'échéance est dépassée de plus de 30 jours", () => {
    const s = reminder({
      id: 12,
      name: "recheck unique",
      one_shot: true,
      enabled: false,
      created_at: stamp((CLEANUP_ONE_SHOT_GRACE_DAYS + 10) * DAY_MS),
      every: 600,
      last_run_at: stamp((CLEANUP_ONE_SHOT_GRACE_DAYS + 10) * DAY_MS),
    });
    const v = classifyScheduleCleanupItem(s, NOW);
    expect(v.action).toBe("delete");
    expect(v.reason).toContain("unique");
  });

  it("CONSERVE un rappel unique à échéance FUTURE qui n'a jamais tourné (garde-fou)", () => {
    const s = reminder({ one_shot: true, created_at: stamp(0), every: 3600, last_run_at: null });
    const v = classifyScheduleCleanupItem(s, NOW);
    expect(v.action).toBe("keep");
    expect(v.reason).toContain("future");
  });

  it("CONSERVE un rappel unique en retard récent (fenêtre de grâce)", () => {
    const s = reminder({ one_shot: true, created_at: stamp(2 * DAY_MS), every: 60, last_run_at: null });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("keep");
  });
});

describe("règle 3 — rappel périodique stérile (désactivation, jamais suppression immédiate)", () => {
  it("DÉSACTIVE un rappel actif qui n'a rien détecté sur ses 20 dernières exécutions", () => {
    const s = reminder({ id: 30, name: "ronde inutile", enabled: true, sterile_runs: CLEANUP_STERILE_RUNS });
    const v = classifyScheduleCleanupItem(s, NOW);
    expect(v.action).toBe("disable");
    expect(v.reason).toContain(String(CLEANUP_STERILE_RUNS));
  });

  it("CONSERVE un rappel à 19 exécutions stériles (le seuil n'est pas approximatif)", () => {
    const s = reminder({ enabled: true, sterile_runs: CLEANUP_STERILE_RUNS - 1 });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("keep");
  });

  it("ne SUPPRIME jamais un rappel stérile : il est seulement désactivé (réactivable)", () => {
    const plan = classifyScheduleCleanup({
      schedules: [reminder({ sterile_runs: CLEANUP_STERILE_RUNS })],
      now: NOW,
    });
    expect(plan.delete).toHaveLength(0);
    expect(plan.disable).toHaveLength(1);
  });
});

describe("garde-fous (règle 6 : en cas de doute, on garde)", () => {
  it("CONSERVE un rappel actif récent", () => {
    const s = reminder({ enabled: true, last_run_at: stamp(2 * 3600 * 1000), sterile_runs: 0 });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("keep");
  });

  it("CONSERVE un rappel jamais exécuté et créé récemment", () => {
    const s = reminder({ enabled: true, last_run_at: null, created_at: stamp(3600 * 1000) });
    expect(classifyScheduleCleanupItem(s, NOW).action).toBe("keep");
  });

  it("CONSERVE un rappel inclassable (identifiant, nom, date ou fréquence inexploitables)", () => {
    const cas = [
      null,
      {},
      reminder({ id: "abc" }),
      reminder({ id: 0 }),
      reminder({ name: "   " }),
      reminder({ created_at: null }),
      reminder({ created_at: "illisible" }),
      reminder({ every: 0 }),
      reminder({ every: "souvent" }),
      reminder({ enabled: "peut-etre" }),
    ];
    for (const s of cas) {
      const v = classifyScheduleCleanupItem(s, NOW);
      expect(v.action).toBe("keep");
      expect(typeof v.reason).toBe("string");
    }
  });
});

describe("règle 5 — ménage au plus une fois par jour (automatique)", () => {
  const list = [
    reminder({ id: 1, enabled: false, last_run_at: stamp(60 * DAY_MS) }),
    reminder({ id: 2, enabled: false, last_run_at: stamp(60 * DAY_MS) }),
  ];

  it("ne fait rien si le dernier ménage date de moins de 24 h", () => {
    const plan = classifyScheduleCleanup({
      schedules: list,
      now: NOW,
      lastCleanupAt: stamp(3600 * 1000),
      enforceDailyGuard: true,
    });
    expect(plan.run).toBe(false);
    expect(plan.skippedReason).toContain("aujourd'hui");
    expect(plan.delete).toHaveLength(0);
    expect(plan.disable).toHaveLength(0);
  });

  it("agit dès que le dernier ménage a plus de 24 h", () => {
    const plan = classifyScheduleCleanup({
      schedules: list,
      now: NOW,
      lastCleanupAt: stamp(DAY_MS + 60 * 1000),
      enforceDailyGuard: true,
    });
    expect(plan.run).toBe(true);
    expect(plan.delete).toHaveLength(2);
  });

  it("agit aussi au tout premier ménage (aucune date connue)", () => {
    const plan = classifyScheduleCleanup({ schedules: list, now: NOW, lastCleanupAt: null, enforceDailyGuard: true });
    expect(plan.run).toBe(true);
  });

  it("le geste MANUEL n'attend pas 24 h (mêmes règles de contenu, sans la limite de fréquence)", () => {
    const plan = classifyScheduleCleanup({
      schedules: list,
      now: NOW,
      lastCleanupAt: stamp(60 * 1000),
      enforceDailyGuard: false,
    });
    expect(plan.run).toBe(true);
    expect(plan.delete).toHaveLength(2);
  });
});

describe("règle 4 — plafond de 20 rappels actifs", () => {
  it("détecte le plafond atteint et le non-atteint (désactivés non comptés)", () => {
    const actifs = Array.from({ length: CLEANUP_MAX_ACTIVE }, (_, i) => reminder({ id: i + 1, enabled: true }));
    expect(scheduleCapReached(actifs)).toBe(true);
    expect(scheduleCapReached(actifs.slice(0, CLEANUP_MAX_ACTIVE - 1))).toBe(false);
    const avecDesactives = [...actifs.slice(0, CLEANUP_MAX_ACTIVE - 1), reminder({ id: 99, enabled: false })];
    expect(scheduleCapReached(avecDesactives)).toBe(false);
  });

  it("la constante est bien 20 (miroir de SCHEDULE_MAX côté Rust)", () => {
    const ici = dirname(fileURLToPath(import.meta.url));
    const rust = readFileSync(resolve(ici, "../../src-tauri/src/super_agent.rs"), "utf8");
    expect(rust).toContain("pub(crate) const SCHEDULE_MAX: i64 = 20;");
    expect(CLEANUP_MAX_ACTIVE).toBe(20);
  });
});

describe("ordre et libellés (du plus ancien au plus récent)", () => {
  it("ordonne les suppressions du plus ancien au plus récent", () => {
    const plan = classifyScheduleCleanup({
      schedules: [
        reminder({ id: 10, name: "récent", enabled: false, last_run_at: stamp(35 * DAY_MS) }),
        reminder({ id: 11, name: "très ancien", enabled: false, last_run_at: stamp(300 * DAY_MS) }),
        reminder({ id: 12, name: "ancien", enabled: false, last_run_at: stamp(90 * DAY_MS) }),
      ],
      now: NOW,
    });
    expect(plan.delete.map((x) => x.name)).toEqual(["très ancien", "ancien", "récent"]);
  });

  it("formate un candidat en une ligne lisible", () => {
    expect(formatCleanupCandidate({ id: 3, name: "veille", reason: "motif" })).toBe("— veille : motif");
    expect(formatCleanupCandidate({ id: 3, name: "", reason: "" })).toBe("— rappel 3");
  });
});

describe("annonce du NOMBRE avant suppression (bouton)", () => {
  it("annonce 0 quand il n'y a rien à faire", () => {
    const txt = cleanupConfirmationText({ delete: [], disable: [] });
    expect(txt).toContain("Aucun rappel inutile");
  });

  it("annonce le nombre de rappels supprimés ET de rappels désactivés", () => {
    const plan = classifyScheduleCleanup({
      schedules: [
        reminder({ id: 1, name: "a", enabled: false, last_run_at: stamp(60 * DAY_MS) }),
        reminder({ id: 2, name: "b", enabled: false, last_run_at: stamp(70 * DAY_MS) }),
        reminder({ id: 3, name: "c", enabled: true, sterile_runs: CLEANUP_STERILE_RUNS }),
      ],
      now: NOW,
    });
    const txt = cleanupConfirmationText(plan);
    expect(txt).toContain("2 rappels seront supprimés");
    expect(txt).toContain("1 rappel devenu inutile sera désactivé");
    expect(txt).toContain("— a");
    expect(txt).toContain("— c");
  });

  it("la charge utile d'application ne transporte que id/nom/motif (aucune autre décision)", () => {
    const plan = classifyScheduleCleanup({
      schedules: [reminder({ id: 5, name: "veille", enabled: false, last_run_at: stamp(60 * DAY_MS) })],
      now: NOW,
    });
    const payload = cleanupApplyPayload(plan);
    expect(payload.deletions).toHaveLength(1);
    expect(Object.keys(payload.deletions[0]).sort()).toEqual(["id", "name", "reason"]);
    expect(payload.disables).toEqual([]);
  });
});

describe("branchements verrouillés (aucune décision ailleurs)", () => {
  const ici = dirname(fileURLToPath(import.meta.url));
  const lire = (rel) => readFileSync(resolve(ici, rel), "utf8").replace(/\r\n/g, "\n");

  it("le ménage automatique de l'Assistant utilise la décision unique et note l'utilité des exécutions", () => {
    const js = lire("./super-agent.js");
    expect(js).toContain('from "./super-agent-schedule-cleanup.js"');
    expect(js).toContain("classifyScheduleCleanup(");
    expect(js).toContain('invoke("super_agent_schedule_cleanup_state")');
    expect(js).toContain('invoke("super_agent_schedule_cleanup_apply"');
    expect(js).toContain('invoke("super_agent_schedule_note_run"');
    // Règle 5 : le ménage automatique passe par la garde journalière.
    expect(js).toContain("enforceDailyGuard: true");
  });

  it("le bouton des Paramètres utilise la même décision et annonce le nombre", () => {
    const js = lire("./settings.js");
    expect(js).toContain("classifyScheduleCleanup(");
    expect(js).toContain("cleanupConfirmationText(");
    expect(js).toContain('invoke("super_agent_schedule_cleanup_apply"');
    expect(js).toContain("const SCHEDULE_MAX_ACTIVE = CLEANUP_MAX_ACTIVE;");
    // Le bouton reste un geste manuel : pas de garde journalière.
    expect(js).toContain("enforceDailyGuard: false");
  });

  it("le bouton existe dans l'écran des rappels (Paramètres → Assistant)", () => {
    const html = lire("../../index.html");
    expect(html).toContain('id="setting-superagent-schedule-cleanup"');
    expect(html).toContain("Supprimer les rappels inutiles");
  });

  it("le backend journalise chaque rappel traité dans le journal EXISTANT (injection_logs)", () => {
    const rust = readFileSync(resolve(ici, "../../src-tauri/src/super_agent.rs"), "utf8").replace(/\r\n/g, "\n");
    expect(rust).toContain("SCHEDULE_CLEANUP_LOG_STATUS");
    expect(rust).toContain("log_injection(");
    // Un seul journal : aucune table de journal parallèle n'est créée.
    expect(rust).not.toContain("schedule_cleanup_log");
    // Les trois commandes sont enregistrées dans le routeur Tauri.
    const lib = readFileSync(resolve(ici, "../../src-tauri/src/lib.rs"), "utf8").replace(/\r\n/g, "\n");
    expect(lib).toContain("super_agent::super_agent_schedule_cleanup_state,");
    expect(lib).toContain("super_agent::super_agent_schedule_cleanup_apply,");
    expect(lib).toContain("super_agent::super_agent_schedule_note_run,");
  });
});
