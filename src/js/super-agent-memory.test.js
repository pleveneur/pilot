import { describe, it, expect } from "vitest";
import {
  parseMemoryRemovePayload,
  parseMemoryRestorePayload,
  parseMemoryTrashListPayload,
  formatMemoryTrashList,
} from "./super-agent-memory.js";

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

describe("parseMemoryTrashListPayload (charge utile du sentinel list_session_memory_trash)", () => {
  it("accepte une charge utile vide ou un objet vide", () => {
    expect(parseMemoryTrashListPayload("")).toEqual({});
    expect(parseMemoryTrashListPayload("{}")).toEqual({});
    expect(parseMemoryTrashListPayload(undefined)).toEqual({});
  });

  it("refuse une charge utile illisible ou non-objet", () => {
    expect(parseMemoryTrashListPayload("{pas du json").error).toBeTruthy();
    expect(parseMemoryTrashListPayload("[1,2,3]").error).toBeTruthy();
  });
});

describe("formatMemoryTrashList (réponse du parcours de la corbeille)", () => {
  const payload = {
    count: 2,
    entries: [
      { id: "m2", kind: "field", removed_at: "2026-01-02T10:00:00+01:00", preview: "note X" },
      { id: "m1", kind: "work_in_progress", removed_at: "2026-01-01T09:00:00+01:00", preview: "/p/a — Alpha" },
    ],
  };

  it("conserve l'ordre (plus récent d'abord) et le contenu", () => {
    const r = formatMemoryTrashList(payload);
    expect(r.count).toBe(2);
    expect(r.entries.map((e) => e.id)).toEqual(["m2", "m1"]);
    expect(r.entries[0].preview).toBe("note X");
  });

  it("produit un texte lisible, dans l'ordre de la corbeille", () => {
    const r = formatMemoryTrashList(payload);
    expect(r.text).toContain("1. id=m2");
    expect(r.text).toContain("note X");
    expect(r.text.indexOf("id=m2")).toBeLessThan(r.text.indexOf("id=m1"));
    expect(r.text).toContain("2026-01-02T10:00:00+01:00");
  });

  it("accepte une réponse JSON textuelle et tolère les entrées abîmées", () => {
    expect(formatMemoryTrashList(JSON.stringify(payload)).count).toBe(2);
    const empty = formatMemoryTrashList({ count: 0, entries: [] });
    expect(empty.count).toBe(0);
    expect(empty.text).toContain("vide");
    expect(formatMemoryTrashList(null).count).toBe(0);
    expect(formatMemoryTrashList("{pas du json").count).toBe(0);
    const broken = formatMemoryTrashList({ entries: [{}] });
    expect(broken.count).toBe(1);
    expect(broken.entries[0].id).toBe("");
    expect(broken.text).toContain("date inconnue");
  });
});
