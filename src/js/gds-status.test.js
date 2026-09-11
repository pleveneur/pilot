// Tests unitaires — gds-status.js (Évolution 3 : bandeau connecté fiable)
import { describe, it, expect } from "vitest";
import { mapGdsStatus } from "./gds-status.js";

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
