// PREUVES — verrou par projet à lecteurs partagés (branche verrou-par-projet).
//
// Ces tests prouvent le comportement exigé de bout en bout, au niveau où la
// décision d'admission est réellement prise (bus d'agents + politique pure) :
//   (a) deux missions de LECTURE sur le MÊME projet tournent simultanément ;
//   (b) une mission qui MODIFIE sur un projet est refusée/mise en file tant
//       qu'une autre mission tourne sur ce projet ; une mission sur un AUTRE
//       projet n'attend pas.
//
// `beginRun(project, { readOnly })` est exactement ce qu'appelle
// `startParallelRun` après sa garde d'admission `isRunInProgress(project,
// { nature })` (elle-même utilisée par la file d'attente de super-agent.js).
import { describe, it, expect } from "vitest";

// Same stub as agents-bus.test.js: aucun accès Tauri réel en environnement Node.
import { vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import { beginRun, endRun, isRunInProgress, getRunState } from "./agents-bus.js";

describe("PREUVE (a) — deux missions de LECTURE tournent en parallèle sur le même projet", () => {
  it("(a) deux lectures coexistuent (clés distinctes), sans être bloquées ni s'écraser", () => {
    const p = "preuve-a";
    // Admission de la 1re lecture : rien ne tourne → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run1 = beginRun(p, { readOnly: true });

    // Admission de la 2e lecture : la 1re est une LECTURE partagée → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run2 = beginRun(p, { readOnly: true });

    // Les deux runs vivent en même temps, avec des contextes distincts.
    expect(run1.runKey).not.toBe(run2.runKey);
    expect(run1.readonly).toBe(true);
    expect(run2.readonly).toBe(true);
    expect(run1.runKey.startsWith(`${p}#read:`)).toBe(true);
    expect(run2.runKey.startsWith(`${p}#read:`)).toBe(true);
    // Le PROJET RÉEL reste identique sur les deux contextes (routage par projet).
    expect([run1.project, run2.project]).toEqual([p, p]);

    // La fin de la 1re ne tue pas la 2de.
    endRun(p, run1.generation);
    expect(getRunState(p)).toBe("running");
    endRun(p, run2.generation);
    expect(getRunState(p)).toBe("idle");
  });
});

describe("PREUVE (b) — modification exclusive par projet, autres projets indépendants", () => {
  it("(b) une MODIFICATION attend toute run; une LECTURE attend une MODIFICATION; un autre projet n'attend pas", () => {
    const proj = "preuve-b";
    const autre = "preuve-b-autre";

    // 1. Une LECTURE tourne sur `proj`.
    const readRun = beginRun(proj, { readOnly: true });

    // Une modification sur `proj` est bloquée (sera mise en file par super-agent).
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    // Une autre lecture sur `proj` est autorisée (partage).
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
    // Un projet DIFFÉRENT n'attend pas (ni en écriture, ni en lecture).
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);
    expect(isRunInProgress(autre, { nature: "read" })).toBe(false);

    endRun(proj, readRun.generation);

    // 2. Une modification tourne sur `proj`.
    const writeRun = beginRun(proj);
    expect(writeRun.readonly).toBe(false);
    // Elle est exclusive : toute autre mission sur `proj` attend…
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(true);
    // …mais elle ne bloque pas un autre projet.
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);

    endRun(proj, writeRun.generation);
    expect(isRunInProgress(proj, { nature: "write" })).toBe(false);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
  });
});
