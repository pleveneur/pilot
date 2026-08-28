// Tests unitaires — agents-bus.js (verrou de run INDEXÉ PAR PROJET, T1-T3)
// Couvre le cloisonnement par projet du verrou de run : le MÊME type d'agent
// peut tourner en parallèle sur des PROJETS DIFFÉRENTS, tout en conservant
// l'exclusivité sur un MÊME projet. `busState.runs` est vide au chargement du
// module (env vitest Node, sans Tauri/window) → `isRunInProgress()` doit
// retourner false sans amorcer le bus.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock des commandes Tauri : stopAgentsRun doit purger les réservations (T6-fix,
// fuite 1) via deleteReservations (file_exists → delete_file_or_dir). On simule
// un fichier présent pour vérifier l'ordre complet de la purge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));

import { invoke } from "@tauri-apps/api/core";
import { getRunState, beginRun, endRun, isRunInProgress, stopAgentsRun } from "./agents-bus.js";
import {
  markProjectReserved,
  unmarkProjectReserved,
  isProjectReserved,
  reservationsPath,
} from "./reservations.js";

describe("isRunInProgress — source de vérité « run occupée ou non » (par projet)", () => {
  it("est exportée comme fonction (contrat de la source unique)", () => {
    expect(typeof isRunInProgress).toBe("function");
  });

  it("retourne false quand aucune run n'est en cours (état initial = idle)", () => {
    expect(isRunInProgress()).toBe(false);
    expect(isRunInProgress("projetA")).toBe(false);
  });
});

describe("Verrou de run INDEXÉ PAR PROJET (T1-T3)", () => {
  beforeEach(() => {
    // Nettoyer l'état entre les tests (module-level).
    endRun("projetA");
    endRun("projetB");
  });

  it("beginRun sur un projet le passe en running, l'autre reste idle (parallélisme par projet)", () => {
    beginRun("projetA");
    expect(getRunState("projetA")).toBe("running");
    // Une run sur un AUTRE projet n'est pas bloquée (état indépendant).
    expect(getRunState("projetB")).toBe("idle");
    expect(isRunInProgress("projetA")).toBe(true);
    expect(isRunInProgress("projetB")).toBe(false);
  });

  it("2 runs sur des PROJETS DIFFÉRENTS peuvent être en cours simultanément (T2 : la garde passe)", () => {
    beginRun("projetA");
    beginRun("projetB");
    expect(getRunState("projetA")).toBe("running");
    expect(getRunState("projetB")).toBe("running");
    // isRunInProgress(project) : chacune voit sa propre run.
    expect(isRunInProgress("projetA")).toBe(true);
    expect(isRunInProgress("projetB")).toBe(true);
    // Sans argument : une run est en cours sur au moins un projet (rétrocompat).
    expect(isRunInProgress()).toBe(true);
  });

  it("isRunInProgress(project) sans argument = « une run sur n'importe quel projet » (T3, rétrocompat isRunStillActive)", () => {
    beginRun("projetA");
    expect(isRunInProgress()).toBe(true);
    expect(isRunInProgress("projetB")).toBe(false);
  });

  it("endRun(project) ne libère QUE la run du projet concerné (T4 : scoping du reset)", () => {
    beginRun("projetA");
    beginRun("projetB");
    endRun("projetA");
    expect(getRunState("projetA")).toBe("idle");
    expect(getRunState("projetB")).toBe("running");
    // La run restante sur B n'est pas touchée.
    expect(isRunInProgress("projetB")).toBe(true);
    expect(isRunInProgress("projetA")).toBe(false);
  });

  it("endRun sur un projet sans run est sans effet", () => {
    endRun("projetInexistant");
    expect(getRunState("projetInexistant")).toBe("idle");
    expect(isRunInProgress()).toBe(false);
  });
});

describe("stopAgentsRun — purge des réservations (T6-fix, fuite 1)", () => {
  beforeEach(() => {
    endRun("projetA");
    endRun("projetB");
    vi.mocked(invoke).mockClear();
  });

  it("purge les réservations des runs arrêtées AVANT de vider les runs (plus de fichier résiduel)", async () => {
    // Réservations actives sur le projet d'une run en cours.
    markProjectReserved("projetA", "codeur1");
    beginRun("projetA");
    await stopAgentsRun();
    // La purge disque a été demandée (file_exists simulé présent → suppression).
    const calls = vi.mocked(invoke).mock.calls;
    const del = calls.find((c) => c[0] === "delete_file_or_dir");
    expect(del).toBeTruthy();
    expect(del[1].path).toBe(reservationsPath("projetA"));
    // La map mémoire est nettoyée et la run vidée (le chemin "stopping" ne
    // laisse ni fichier résiduel ni verrou bloqué).
    expect(isProjectReserved("projetA")).toBe(false);
    expect(getRunState("projetA")).toBe("idle");
    expect(isRunInProgress("projetA")).toBe(false);
  });

  it("purge les réservations de TOUS les projets concernés (arrêt global)", async () => {
    markProjectReserved("projetA", "codeur1");
    markProjectReserved("projetB", "codeur2");
    beginRun("projetA");
    beginRun("projetB");
    await stopAgentsRun();
    const deleted = vi.mocked(invoke).mock.calls
      .filter((c) => c[0] === "delete_file_or_dir")
      .map((c) => c[1].path);
    expect(deleted).toContain(reservationsPath("projetA"));
    expect(deleted).toContain(reservationsPath("projetB"));
    expect(isProjectReserved("projetA")).toBe(false);
    expect(isProjectReserved("projetB")).toBe(false);
  });

  it("sans run en cours : aucun abort, aucune purge (retour immédiat)", async () => {
    markProjectReserved("projetA", "codeur1");
    await stopAgentsRun();
    const cmds = vi.mocked(invoke).mock.calls.map((c) => c[0]);
    expect(cmds).not.toContain("abort_agent_process");
    expect(cmds).not.toContain("delete_file_or_dir");
    // La réservation n'est PAS purgée par stopAgentsRun sans run active : elle
    // le sera par la purge au démarrage du bus (fuite 2) ou l'estimation suivante.
    expect(isProjectReserved("projetA")).toBe(true);
    unmarkProjectReserved("projetA");
  });
});
