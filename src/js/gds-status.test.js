// Tests unitaires — gds-status.js (Évolution 3 : bandeau connecté fiable)
import { describe, it, expect, vi } from "vitest";
import { isGdsConnected, mapGdsStatus, projectGdsInfo } from "./gds-status.js";

let invokeImpl = () => Promise.resolve(null);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeImpl(...args),
}));

describe("isGdsConnected (contrat string de isProjectGds, évol 3)", () => {
  it("ne badge que 'connected'", () => {
    expect(isGdsConnected("connected")).toBe(true);
  });
  it("'error' et 'not_configured' sont truthy mais PAS connectées (régression)", () => {
    // Chaînes truthy : un simple `if (await isProjectGds(...))` badgerait tout.
    expect(Boolean("error")).toBe(true);
    expect(Boolean("not_configured")).toBe(true);
    expect(Boolean("not_published")).toBe(true);
    expect(isGdsConnected("error")).toBe(false);
    expect(isGdsConnected("not_configured")).toBe(false);
    // Dépôt du serveur VIDE : la synchro ne peut pas fonctionner → jamais
    // « connecté » (défaut de terrain : « connecté » était annoncé).
    expect(isGdsConnected("not_published")).toBe(false);
  });
  it("fail-open : statut inconnu/null/undefined → false", () => {
    expect(isGdsConnected(undefined)).toBe(false);
    expect(isGdsConnected(null)).toBe(false);
    expect(isGdsConnected("bogus")).toBe(false);
    expect(isGdsConnected("")).toBe(false);
  });
});

describe("mapGdsStatus", () => {
  it("retourne connected pour un statut connected", () => {
    expect(mapGdsStatus({ status: "connected" })).toBe("connected");
  });
  it("retourne error pour un statut error", () => {
    expect(mapGdsStatus({ status: "error" })).toBe("error");
  });
  it("retourne not_published pour un dépôt du serveur vide (jamais publié)", () => {
    // État honnête : le service répond et le dépôt existe, mais la branche n'y
    // est jamais publiée — l'écran l'annonce au lieu de « connecté ».
    expect(mapGdsStatus({ status: "not_published" })).toBe("not_published");
  });
  it("retourne not_configured pour config absente et valeurs inattendues", () => {
    expect(mapGdsStatus({ status: "not_configured" })).toBe("not_configured");
    expect(mapGdsStatus(null)).toBe("not_configured");
    expect(mapGdsStatus(undefined)).toBe("not_configured");
    expect(mapGdsStatus({})).toBe("not_configured");
    expect(mapGdsStatus({ status: "bogus" })).toBe("not_configured"); // fail-open
  });
});

describe("projectGdsInfo (deux faits : inscription sur le serveur / liaison du poste)", () => {
  it("remonte `status` ET `on_server` (un `error` peut venir d'un projet absent)", async () => {
    invokeImpl = () => Promise.resolve({ status: "error", on_server: true });
    await expect(projectGdsInfo("G:/p")).resolves.toEqual({ status: "error", onServer: true });
    invokeImpl = () => Promise.resolve({ status: "error", on_server: false });
    await expect(projectGdsInfo("G:/p")).resolves.toEqual({ status: "error", onServer: false });
  });
  it("fail-open : rejet → not_configured + onServer false", async () => {
    invokeImpl = () => Promise.reject(new Error("boom"));
    await expect(projectGdsInfo("G:/p")).resolves.toEqual({
      status: "not_configured",
      onServer: false,
    });
  });
  it("chemin vide : aucun appel, valeurs par défaut", async () => {
    await expect(projectGdsInfo("")).resolves.toEqual({
      status: "not_configured",
      onServer: false,
    });
  });
});
