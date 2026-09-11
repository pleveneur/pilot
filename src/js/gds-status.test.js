// Tests unitaires — gds-status.js (Évolution 3 : bandeau connecté fiable)
import { describe, it, expect } from "vitest";
import { isGdsConnected, mapGdsStatus } from "./gds-status.js";

describe("isGdsConnected (contrat string de isProjectGds, évol 3)", () => {
  it("ne badge que 'connected'", () => {
    expect(isGdsConnected("connected")).toBe(true);
  });
  it("'error' et 'not_configured' sont truthy mais PAS connectées (régression)", () => {
    // Chaînes truthy : un simple `if (await isProjectGds(...))` badgerait tout.
    expect(Boolean("error")).toBe(true);
    expect(Boolean("not_configured")).toBe(true);
    expect(isGdsConnected("error")).toBe(false);
    expect(isGdsConnected("not_configured")).toBe(false);
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
  it("retourne not_configured pour config absente et valeurs inattendues", () => {
    expect(mapGdsStatus({ status: "not_configured" })).toBe("not_configured");
    expect(mapGdsStatus(null)).toBe("not_configured");
    expect(mapGdsStatus(undefined)).toBe("not_configured");
    expect(mapGdsStatus({})).toBe("not_configured");
    expect(mapGdsStatus({ status: "bogus" })).toBe("not_configured"); // fail-open
  });
});
