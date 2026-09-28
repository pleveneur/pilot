// Tests unitaires — run-policy.js : décision d'admission des missions d'agents
// (lecture partagée / modification exclusive), pure et sans I/O.
import { describe, it, expect } from "vitest";
import { missionNature, canStartMission, canSendManualCommandAsync, MANUAL_COMMAND_NATURE } from "./run-policy.js";

describe("missionNature", () => {
  it("readonly=true → mission de LECTURE", () => {
    expect(missionNature(true)).toBe("read");
  });

  it("readonly=false ou absent → mission qui MODIFIE", () => {
    expect(missionNature(false)).toBe("write");
    expect(missionNature(undefined)).toBe("write");
  });
});

describe("canStartMission — lecture partagée / modification exclusive", () => {
  it("rien ne tourne sur le projet → tout démarre", () => {
    expect(canStartMission("read", [])).toBe(true);
    expect(canStartMission("write", [])).toBe(true);
    expect(canStartMission("read", undefined)).toBe(true);
  });

  it("lecture + lecture = autorisé (missions de lecture partagées)", () => {
    expect(canStartMission("read", ["read"])).toBe(true);
    expect(canStartMission("read", ["read", "read"])).toBe(true);
  });

  it("une modification ne démarre pas tant que quelque chose tourne", () => {
    expect(canStartMission("write", ["read"])).toBe(false);
    expect(canStartMission("write", ["write"])).toBe(false);
    expect(canStartMission("write", ["read", "read"])).toBe(false);
  });

  it("une lecture ne démarre pas pendant une modification (exclusive)", () => {
    expect(canStartMission("read", ["write"])).toBe(false);
    expect(canStartMission("read", ["read", "write"])).toBe(false);
  });
});

// POINT D — deux commandes MANUELLES concurrentes sur le même projet : elles
// n'inscrivent aucune run dans le bus, donc la sonde du bus ne les voit pas.
// `canSendManualCommandAsync` ajoute la sonde d'ACTIVITÉ réelle de l'agent du
// projet. Ces tests ÉCHOUENT si l'on revient à la seule sonde du bus.
describe("canSendManualCommandAsync — sonde d'activité en plus du verrou du bus", () => {
  it("refuse quand l'agent du projet travaille déjà (commande manuelle concurrente)", async () => {
    const isRunInProgress = () => false; // le bus ne voit pas les commandes manuelles
    const isAgentBusy = async (p) => p === "proj-occupe";
    expect(await canSendManualCommandAsync("proj-occupe", isRunInProgress, isAgentBusy)).toBe(false);
    // …et ne bloque jamais un AUTRE projet (verrou PAR PROJET).
    expect(await canSendManualCommandAsync("proj-libre", isRunInProgress, isAgentBusy)).toBe(true);
  });

  it("le verrou du bus reste prioritaire et la sonde est optionnelle", async () => {
    const isRunInProgress = (p) => p === "proj-run";
    expect(await canSendManualCommandAsync("proj-run", isRunInProgress)).toBe(false);
    expect(await canSendManualCommandAsync("proj-libre", isRunInProgress)).toBe(true);
    // Sonde en échec → fail-open borné (on ne bloque pas l'utilisateur).
    const boom = async () => { throw new Error("sonde HS"); };
    expect(await canSendManualCommandAsync("proj-libre", () => false, boom)).toBe(true);
  });

  it("la nature reste une MODIFICATION exclusive", () => {
    expect(MANUAL_COMMAND_NATURE).toBe("write");
  });
});
