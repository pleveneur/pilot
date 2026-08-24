// Tests unitaires — agents-bus.js (verrou de run INDEXÉ PAR PROJET, T1-T3)
// Couvre le cloisonnement par projet du verrou de run : le MÊME type d'agent
// peut tourner en parallèle sur des PROJETS DIFFÉRENTS, tout en conservant
// l'exclusivité sur un MÊME projet. `busState.runs` est vide au chargement du
// module (env vitest Node, sans Tauri/window) → `isRunInProgress()` doit
// retourner false sans amorcer le bus.
import { describe, it, expect, beforeEach } from "vitest";
import { getRunState, beginRun, endRun, isRunInProgress } from "./agents-bus.js";

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
