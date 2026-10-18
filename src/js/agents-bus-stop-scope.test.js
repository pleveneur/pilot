// Tests unitaires — agents-bus.js : PORTÉE des arrêts automatiques
// (symptôme « l'agent commence et s'arrête aussitôt »).
//
// Cause couverte : `stopAgentsRun()` était GLOBAL. Le timeout d'inactivité, le
// plafond de tours ou la détection de boucle d'UNE run abortaient donc les
// agents de TOUTES les runs du même processus (autre projet, autre mission) :
// une run voisine qui se terminait ou expirait coupait l'agent qui venait de
// démarrer. Les arrêts automatiques passent désormais `runKey` (leur propre
// run), et chaque abandon transmet l'uid de session (`expectedUid`) pour que
// Rust refuse d'agir sur une session relancée entre-temps.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  beginRun,
  endRun,
  getRunState,
  isRunInProgress,
  stopAgentsRun,
  expectedSessionUid,
} from "./agents-bus.js";
import {
  markProjectReserved,
  unmarkProjectReserved,
  isProjectReserved,
  reservationsPath,
} from "./reservations.js";

/** Prépare une run avec un agent actif (et, en option, un uid de session). */
function armRun(project, agentId, uid) {
  const ctx = beginRun(project);
  ctx.activeAgents.add(agentId);
  ctx.agentProject[agentId] = project;
  ctx.sessionUid[agentId] = uid ?? null;
  return ctx;
}

/** Arguments des `abort_agent_process` émis. */
function aborts() {
  return vi
    .mocked(invoke)
    .mock.calls.filter((c) => c[0] === "abort_agent_process")
    .map((c) => c[1]);
}

describe("expectedSessionUid — uid transmis aux arrêts ciblés (pure)", () => {
  it("retourne l'uid numérique mémorisé par la run", () => {
    expect(expectedSessionUid({ sessionUid: { codeur: 12 } }, "codeur")).toBe(12);
  });

  it("retourne null quand l'uid est absent, nul ou non numérique", () => {
    expect(expectedSessionUid({ sessionUid: {} }, "codeur")).toBeNull();
    expect(expectedSessionUid({ sessionUid: { codeur: null } }, "codeur")).toBeNull();
    expect(expectedSessionUid({ sessionUid: { codeur: 0 } }, "codeur")).toBeNull();
    expect(expectedSessionUid({ sessionUid: { codeur: "12" } }, "codeur")).toBeNull();
    expect(expectedSessionUid(null, "codeur")).toBeNull();
    expect(expectedSessionUid(undefined, "codeur")).toBeNull();
  });
});

describe("stopAgentsRun — portée CIBLÉE (arrêt automatique d'une seule run)", () => {
  beforeEach(() => {
    // Réinstalle l'implémentation (mockReset la retire) : les appels doivent
    // renvoyer une promesse pour que les `.catch()` du bus s'appliquent.
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "file_exists" ? true : undefined));
    vi.mocked(invoke).mockClear();
    endRun("projetA");
    endRun("projetB");
  });
  afterEach(() => {
    endRun("projetA");
    endRun("projetB");
    unmarkProjectReserved("projetA");
    unmarkProjectReserved("projetB");
    vi.mocked(invoke).mockClear();
  });

  it("n'aborte QUE les agents de la run désignée (l'autre run reste intacte)", async () => {
    const ctxA = armRun("projetA", "codeur", 7);
    const ctxB = armRun("projetB", "codeur", 8);
    await stopAgentsRun({ silent: true, runKey: ctxA.runKey });
    expect(aborts()).toEqual([{ agentId: "codeur", project: "projetA", expectedUid: 7 }]);
    // L'autre run n'a pas été touchée : ni abort, ni verrou libéré.
    expect(getRunState("projetB")).toBe("running");
    expect(isRunInProgress("projetB")).toBe(true);
    expect(getRunState("projetA")).toBe("idle");
    expect(ctxB.runState).toBe("running");
  });

  it("transmet l'uid de session de la run (jamais celui d'une relance)", async () => {
    const ctx = armRun("projetA", "codeur", null);
    await stopAgentsRun({ silent: true, runKey: ctx.runKey });
    // Uid inconnu de la run → null explicite (Rust applique son défaut).
    expect(aborts()).toEqual([{ agentId: "codeur", project: "projetA", expectedUid: null }]);
  });

  it("ne purge QUE les réservations du projet arrêté", async () => {
    markProjectReserved("projetA", "codeur");
    markProjectReserved("projetB", "codeur");
    const ctxA = armRun("projetA", "codeur", 1);
    armRun("projetB", "codeur", 2);
    await stopAgentsRun({ silent: true, runKey: ctxA.runKey });
    const deleted = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === "delete_file_or_dir")
      .map((c) => c[1].path);
    expect(deleted).toContain(reservationsPath("projetA"));
    expect(deleted).not.toContain(reservationsPath("projetB"));
    expect(isProjectReserved("projetA")).toBe(false);
    expect(isProjectReserved("projetB")).toBe(true);
  });

  it("portée ciblée sans run correspondante : aucun effet (retour immédiat)", async () => {
    armRun("projetA", "codeur", 3);
    await stopAgentsRun({ silent: true, runKey: "cle-inexistante" });
    expect(aborts()).toEqual([]);
    expect(getRunState("projetA")).toBe("running");
  });
});

describe("stopAgentsRun — portée GLOBALE conservée (bouton « tout arrêter »)", () => {
  beforeEach(() => {
    // Réinstalle l'implémentation (mockReset la retire) : les appels doivent
    // renvoyer une promesse pour que les `.catch()` du bus s'appliquent.
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "file_exists" ? true : undefined));
    vi.mocked(invoke).mockClear();
    endRun("projetA");
    endRun("projetB");
  });
  afterEach(() => {
    endRun("projetA");
    endRun("projetB");
    unmarkProjectReserved("projetA");
    unmarkProjectReserved("projetB");
    vi.mocked(invoke).mockClear();
  });

  it("sans runKey : arrête toutes les runs et purge toutes les réservations", async () => {
    markProjectReserved("projetA", "codeur");
    markProjectReserved("projetB", "codeur");
    armRun("projetA", "codeur", 1);
    armRun("projetB", "plan-maker", 2);
    await stopAgentsRun();
    const ids = aborts().map((a) => `${a.project}:${a.agentId}:${a.expectedUid}`);
    expect(ids).toContain("projetA:codeur:1");
    expect(ids).toContain("projetB:plan-maker:2");
    expect(isProjectReserved("projetA")).toBe(false);
    expect(isProjectReserved("projetB")).toBe(false);
    expect(getRunState("projetA")).toBe("idle");
    expect(getRunState("projetB")).toBe("idle");
  });
});
