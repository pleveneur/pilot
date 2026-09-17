import { describe, it, expect } from "vitest";
import { parseMemoryRemovePayload, parseMemoryRestorePayload } from "./super-agent-memory.js";

describe("parseMemoryRemovePayload (charge utile du sentinel remove_session_memory)", () => {
  it("lit une cible et un champ", () => {
    expect(parseMemoryRemovePayload(JSON.stringify({ target: " 2 ", field: "notes" }))).toEqual({
      target: "2",
      field: "notes",
    });
  });

  it("accepte une cible seule, ou un champ seul", () => {
    expect(parseMemoryRemovePayload(JSON.stringify({ target: "projet X" }))).toEqual({
      target: "projet X",
      field: "",
    });
    expect(parseMemoryRemovePayload(JSON.stringify({ field: "current_topic" }))).toEqual({
      target: "",
      field: "current_topic",
    });
  });

  it("refuse une charge utile sans cible ni champ", () => {
    const r = parseMemoryRemovePayload(JSON.stringify({ target: "  " }));
    expect(r.error).toBeTruthy();
  });

  it("ne plante pas sur une charge utile abîmée", () => {
    expect(parseMemoryRemovePayload("{pas du json").error).toBeTruthy();
    expect(parseMemoryRemovePayload("[1,2,3]").error).toBeTruthy();
    expect(parseMemoryRemovePayload("null").error).toBeTruthy();
    expect(parseMemoryRemovePayload(undefined).error).toBeTruthy();
  });
});

describe("parseMemoryRestorePayload (charge utile du sentinel restore_session_memory)", () => {
  it("lit un identifiant (espaces supprimés)", () => {
    expect(parseMemoryRestorePayload(JSON.stringify({ id: " abc " }))).toEqual({ id: "abc" });
  });

  it("un id absent ou vide signifie « le plus récent »", () => {
    expect(parseMemoryRestorePayload(JSON.stringify({}))).toEqual({ id: "" });
    expect(parseMemoryRestorePayload("")).toEqual({ id: "" });
    expect(parseMemoryRestorePayload(null)).toEqual({ id: "" });
  });

  it("ne plante pas sur une charge utile abîmée", () => {
    expect(parseMemoryRestorePayload("{pas du json").error).toBeTruthy();
    expect(parseMemoryRestorePayload("42").error).toBeTruthy();
    expect(parseMemoryRestorePayload("\"chaine\"").error).toBeTruthy();
  });
});
