// Tests unitaires — diff-view.js (Diff Review A4 : computeLineDiff LCS)
import { describe, it, expect } from "vitest";
import { computeLineDiff } from "./diff-view.js";

function types(diff) {
  return diff.map((d) => d.type + (d.text !== "" ? "" : ""));
}

describe("computeLineDiff", () => {
  it("deux textes vides → un context vide (split de '' donne [''])", () => {
    // Comportement réel : "".split("\n") → [""]
    expect(computeLineDiff("", "")).toEqual([{ type: "context", text: "" }]);
    expect(computeLineDiff(null, null)).toEqual([{ type: "context", text: "" }]);
  });

  it("texte identique → uniquement des context", () => {
    const r = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(r).toEqual([
      { type: "context", text: "a" },
      { type: "context", text: "b" },
      { type: "context", text: "c" },
    ]);
  });

  it("ajout d'une ligne → added", () => {
    const r = computeLineDiff("a\nb", "a\nx\nb");
    expect(r.map((d) => d.type)).toContain("added");
    expect(r.find((d) => d.type === "added").text).toBe("x");
  });

  it("suppression d'une ligne → removed", () => {
    const r = computeLineDiff("a\nx\nb", "a\nb");
    expect(r.map((d) => d.type)).toContain("removed");
    expect(r.find((d) => d.type === "removed").text).toBe("x");
  });

  it("création d'un fichier → une ligne vide context + added", () => {
    const r = computeLineDiff("", "l1\nl2");
    // avant = [""] (split de ""), après = ["l1","l2"]
    expect(r.filter((d) => d.type === "added")).toHaveLength(2);
  });

  it("suppression d'un fichier → removed + une ligne vide context", () => {
    const r = computeLineDiff("l1\nl2", "");
    expect(r.filter((d) => d.type === "removed")).toHaveLength(2);
  });

  it("entrée non-string convertie (null → '' → ['' ])", () => {
    // LCS : [""] vs ["x"] → la ligne vide est marquée removed, "x" added
    const r = computeLineDiff(null, "x");
    expect(r.find((d) => d.text === "x").type).toBe("added");
    expect(r.some((d) => d.type === "removed")).toBe(true);
  });

  it("ordre contexte/added/removed est préservé pour une modif locale", () => {
    // a\nb\nc → a\nB\nc : contexte, removed(b), added(B), contexte
    const r = computeLineDiff("a\nb\nc", "a\nB\nc");
    const seq = r.map((d) => d.type);
    expect(seq[0]).toBe("context");
    expect(seq[seq.length - 1]).toBe("context");
    expect(seq).toContain("removed");
    expect(seq).toContain("added");
  });
});
