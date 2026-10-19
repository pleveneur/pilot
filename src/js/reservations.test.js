// Tests unitaires — reservations.js (fichiers réservés au codeur, mission 381)
import { describe, it, expect, vi, beforeEach } from "vitest";

// Store en mémoire pour simuler le disque via les commandes Tauri (vi.hoisted
// pour être disponible dans la factory du mock, hoistée avec les imports).
const { store } = vi.hoisted(() => ({ store: new Map() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args = {}) => {
    if (cmd === "write_file_content") {
      store.set(args.path, args.content);
      return undefined;
    }
    if (cmd === "file_exists") {
      return store.has(args.path);
    }
    if (cmd === "delete_file_or_dir") {
      store.delete(args.path);
      return undefined;
    }
    return undefined;
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  normalizeReservedPath,
  dedupeFiles,
  parsePlanFiles,
  buildReservations,
  reservationsPath,
  writeReservations,
  deleteReservations,
  clearAllReservations,
  markProjectReserved,
  unmarkProjectReserved,
  isProjectReserved,
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
      agents: ["codeur"],
    });
  });
  it("coder vide et fichiers vides tolérés (aucune réservation effective)", () => {
    expect(buildReservations("", [])).toEqual({ coder: "", files: [], agents: [] });
  });
  it("T6-fix (fuite 3) : liste TOUS les participants de la run (coder inclus, dédupliqués)", () => {
    expect(buildReservations("codeur1", ["src/a.rs"], ["codeur1", "spec1", "codeur2"])).toEqual({
      coder: "codeur1",
      files: ["src/a.rs"],
      agents: ["codeur1", "spec1", "codeur2"],
    });
  });
  it("participants absents → fallback sur le coder seul (rétro-compat)", () => {
    expect(buildReservations("codeur", ["src/a.rs"], undefined)).toEqual({
      coder: "codeur",
      files: ["src/a.rs"],
      agents: ["codeur"],
    });
  });
});

describe("reservationsPath", () => {
  it("construit le chemin .pilot/reservations.json depuis le projet", () => {
    expect(reservationsPath("/proj/")).toBe("/proj/.pilot/reservations.json");
    expect(reservationsPath("C:\\proj")).toBe("C:\\proj/.pilot/reservations.json");
  });
});

describe("writeReservations / deleteReservations (I/O simulées, fail-open)", () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(invoke).mockClear();
  });

  it("écrit le fichier avec la liste de TOUS les participants (fuite 3) et marque le projet", async () => {
    const ok = await writeReservations("/proj/", "codeur1", ["src/lib.rs"], ["codeur1", "spec1"]);
    expect(ok).toBe(true);
    const payload = JSON.parse(store.get(reservationsPath("/proj/")));
    expect(payload).toEqual({
      coder: "codeur1",
      files: ["src/lib.rs"],
      agents: ["codeur1", "spec1"],
      createdAt: expect.any(String),
      renewedAt: expect.any(String),
    });
    expect(isProjectReserved("/proj/")).toBe(true);
  });

  it("battement de cœur : run détentrice DISPARUE → réservation libérée (plus de renouvellement)", async () => {
    vi.useFakeTimers();
    try {
      const isRunAlive = vi.fn(() => false);
      const path = reservationsPath("/proj/");
      await writeReservations("/proj/", "codeur1", ["src/lib.rs"], ["codeur1"], isRunAlive);
      expect(store.has(path)).toBe(true);
      const writesBefore = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_file_content").length;

      await vi.advanceTimersByTimeAsync(60000);

      // La sonde a été interrogée et le fichier a été libéré, pas renouvelé.
      expect(isRunAlive).toHaveBeenCalled();
      expect(store.has(path)).toBe(false);
      expect(isProjectReserved("/proj/")).toBe(false);
      const writesAfter = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_file_content").length;
      expect(writesAfter).toBe(writesBefore);

      // Le minuteur est bel et bien arrêté : rien ne réapparaît ensuite.
      await vi.advanceTimersByTimeAsync(300000);
      expect(store.has(path)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("battement de cœur : run VIVANTE → réservation renouvelée (protection maintenue)", async () => {
    vi.useFakeTimers();
    try {
      const isRunAlive = vi.fn(() => true);
      const path = reservationsPath("/proj/");
      await writeReservations("/proj/", "codeur1", ["src/lib.rs"], ["codeur1"], isRunAlive);
      const writesBefore = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_file_content").length;

      await vi.advanceTimersByTimeAsync(60000);

      expect(store.has(path)).toBe(true);
      expect(isProjectReserved("/proj/")).toBe(true);
      const writesAfter = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "write_file_content").length;
      expect(writesAfter).toBe(writesBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writeReservations sans sonde : renouvelle comme avant (rétro-compat)", async () => {
    vi.useFakeTimers();
    try {
      const path = reservationsPath("/proj/");
      await writeReservations("/proj/", "codeur1", ["src/lib.rs"], ["codeur1"]);
      await vi.advanceTimersByTimeAsync(60000);
      expect(store.has(path)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deleteReservations supprime le fichier et démarque le projet", async () => {
    await writeReservations("/proj/", "codeur1", ["src/lib.rs"]);
    expect(store.has(reservationsPath("/proj/"))).toBe(true);
    await deleteReservations("/proj/");
    expect(store.has(reservationsPath("/proj/"))).toBe(false);
    expect(isProjectReserved("/proj/")).toBe(false);
  });

  it("deleteReservations sans fichier existant ne fait rien (fail-open)", async () => {
    await deleteReservations("/autre-projet/");
    expect(vi.mocked(invoke).mock.calls.some((c) => c[0] === "delete_file_or_dir")).toBe(false);
  });

  it("clearAllReservations (T6-fix, fuite 1) purge TOUS les projets marqués", async () => {
    await writeReservations("/projA/", "codeur1", ["a.rs"]);
    await writeReservations("/projB/", "codeur2", ["b.rs"]);
    // Un projet non marqué ne doit PAS être purgé par clearAllReservations.
    store.set(reservationsPath("/projC/"), "{};");
    expect(isProjectReserved("/projA/")).toBe(true);
    expect(isProjectReserved("/projB/")).toBe(true);
    await clearAllReservations();
    expect(store.has(reservationsPath("/projA/"))).toBe(false);
    expect(store.has(reservationsPath("/projB/"))).toBe(false);
    expect(isProjectReserved("/projA/")).toBe(false);
    expect(isProjectReserved("/projB/")).toBe(false);
    // Le fichier orphelin d'un projet inconnu de la map reste intact (il est
    // purgé par d'autres chemins : init du bus, estimation préalable).
    expect(store.has(reservationsPath("/projC/"))).toBe(true);
  });
});

// MISSION 381 — le flux d'estimation préalable automatique (`estimateAndReserve`)
// a été supprimé : aucun agent n'est plus lancé depuis ce module et le texte
// d'une mission ne lui est jamais transmis. Le battement de cœur de réservation
// (bail conditionné à la vivacité de la run détentrice) reste couvert ici,
// puisqu'il est utilisé par le bus d'agents.
describe("battement de cœur de réservation (bail de vivacité)", () => {
  it("la sonde de vivacité est branchée sur isRunInProgress(projet, {nature:'write'}) et libère la réservation", async () => {
    vi.useFakeTimers();
    try {
      store.clear();
      vi.mocked(invoke).mockClear();
      const isRunInProgress = vi.fn(() => false);
      const path = reservationsPath("/proj/");
      await writeReservations("/proj/", "codeur1", ["src/lib.rs"], ["codeur1"], () => isRunInProgress("/proj/", { nature: "write" }));
      expect(store.has(path)).toBe(true);

      await vi.advanceTimersByTimeAsync(60000);

      expect(isRunInProgress).toHaveBeenCalledWith("/proj/", { nature: "write" });
      expect(store.has(path)).toBe(false);
    } finally {
      vi.useRealTimers();
      unmarkProjectReserved("/proj/");
    }
  });
});
