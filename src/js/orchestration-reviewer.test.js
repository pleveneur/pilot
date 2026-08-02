// Tests unitaires — orchestration-reviewer.js (fonctions pures du reviewer)
import { describe, it, expect } from "vitest";
import {
  matchesGlob,
  matchesAnyCritical,
  buildReviewPrompt,
  parseReviewResult,
  buildReviewCorrectionPrompt,
} from "./orchestration-reviewer.js";

describe("matchesGlob", () => {
  it("retourne false sur entrée vide", () => {
    expect(matchesGlob("", "*.rs")).toBe(false);
    expect(matchesGlob("src/lib.rs", "")).toBe(false);
    expect(matchesGlob(null, "*.rs")).toBe(false);
  });

  it("glob simple * sans slash (ne traverse pas les /)", () => {
    // * ne matche pas les / : un pattern sans slash ne matche qu'un nom de fichier basique
    expect(matchesGlob("spec_pilot.md", "spec_*.md")).toBe(true);
    expect(matchesGlob("lib.rs", "*.rs")).toBe(true);
    // chemin avec slash non couvert par un simple *.rs
    expect(matchesGlob("src-tauri/src/lib.rs", "*.rs")).toBe(false);
    expect(matchesGlob("src/toto.txt", "*.rs")).toBe(false);
  });

  it("glob répertoire unique src-tauri/src/*.rs", () => {
    expect(matchesGlob("src-tauri/src/lib.rs", "src-tauri/src/*.rs")).toBe(true);
    expect(matchesGlob("src-tauri/src/lib.rs", "src-tauri/src/*.js")).toBe(false);
    expect(matchesGlob("src-tauri/src/sub/lib.rs", "src-tauri/src/*.rs")).toBe(false);
  });

  it("glob récursif ** traverse plusieurs niveaux", () => {
    expect(matchesGlob("src/js/orchestration.js", "src/**/*.js")).toBe(true);
    expect(matchesGlob("src/deep/nested/file.js", "src/**/*.js")).toBe(true);
  });

  it("échappe les caractères spéciaux regex", () => {
    expect(matchesGlob("Cargo.toml", "Cargo.toml")).toBe(true);
    expect(matchesGlob("CargoXtoml", "Cargo.toml")).toBe(false); // le point est littéral
  });

  it("gère le ? (un seul caractère)", () => {
    expect(matchesGlob("src/a.rs", "src/?.rs")).toBe(true);
    expect(matchesGlob("src/ab.rs", "src/?.rs")).toBe(false);
  });
});

describe("matchesAnyCritical", () => {
  it("false quand listes vides", () => {
    expect(matchesAnyCritical([], ["*.rs"])).toBe(false);
    expect(matchesAnyCritical(["a.rs"], [])).toBe(false);
    expect(matchesAnyCritical("pas-un-array", ["*.rs"])).toBe(false);
  });

  it("true si au moins un fichier matche", () => {
    const files = ["src/js/orchestration.js", "src-tauri/src/lib.rs"];
    expect(matchesAnyCritical(files, ["src-tauri/src/*.rs"])).toBe(true);
    expect(matchesAnyCritical(files, ["src-tauri/src/*.js"])).toBe(false);
  });

  it("true si un pattern parmi plusieurs matche", () => {
    const files = ["README.md"];
    expect(matchesAnyCritical(files, ["*.rs", "README.md"])).toBe(true);
  });
});

describe("buildReviewPrompt", () => {
  it("contient le titre, l'ID et les fichiers fournis", () => {
    const prompt = buildReviewPrompt(
      { id: 3, title: "Ajouter le module git", description: "Extraire le domaine git" },
      [{ path: "src-tauri/src/git.rs", content: "pub fn git_status" }],
      null,
      null,
    );
    expect(prompt).toContain("**ID :** 3");
    expect(prompt).toContain("Ajouter le module git");
    expect(prompt).toContain("Extraire le domaine git");
    expect(prompt).toContain("FICHIER : src-tauri/src/git.rs");
    expect(prompt).toContain("APPROVED: <résumé court");
    expect(prompt).toContain("CHANGES_REQUESTED:");
  });

  it("inclut mémoire projet et directive quand fournies", () => {
    const prompt = buildReviewPrompt(
      { id: 1, title: "T", description: "D" },
      [{ path: "a.rs", content: "x" }],
      "Ne jamais utiliser unwrap",
      "Directive globale",
    );
    expect(prompt).toContain("PROJECT_MEMORY.md");
    expect(prompt).toContain("Ne jamais utiliser unwrap");
    expect(prompt).toContain("Directive globale du plan");
    expect(prompt).toContain("Directive globale");
  });

  it("gère l'absence de fichiers (placeholder)", () => {
    const prompt = buildReviewPrompt({ id: 2, title: "T2", description: "" }, [], null, null);
    expect(prompt).toContain("(aucun fichier fourni)");
  });

  it("gère un fichier vide (contenu vide)", () => {
    const prompt = buildReviewPrompt(
      { id: 9, title: "T", description: "" },
      [{ path: "empty.txt", content: "" }],
      null,
      null,
    );
    expect(prompt).toContain("(fichier vide)");
  });
});

describe("parseReviewResult", () => {
  it("retourne défaut quand aucun marqueur", () => {
    expect(parseReviewResult("juste du texte")).toEqual({
      approved: false,
      summary: "",
      changes: null,
    });
    expect(parseReviewResult(null)).toEqual({ approved: false, summary: "", changes: null });
    expect(parseReviewResult("")).toEqual({ approved: false, summary: "", changes: null });
  });

  it("détecte APPROVED", () => {
    const r = parseReviewResult("Le code est bon.\nAPPROVED: tout est correct");
    expect(r.approved).toBe(true);
    expect(r.summary).toBe("tout est correct");
    expect(r.changes).toBeNull();
  });

  it("détecte CHANGES_REQUESTED", () => {
    const r = parseReviewResult("Problème trouvé.\nCHANGES_REQUESTED: 1. gérer null");
    expect(r.approved).toBe(false);
    expect(r.changes).toContain("gérer null");
  });

  it("prend le DERNIER marqueur quand les deux présents", () => {
    // APPROVED après CHANGES_REQUESTED → on garde APPROVED
    const r = parseReviewResult("CHANGES_REQUESTED: x\nPuis relecture APPROVED: ok final");
    expect(r.approved).toBe(true);
    // CHANGES_REQUESTED après APPROVED → on garde CHANGES_REQUESTED
    const r2 = parseReviewResult("APPROVED: ok\nMais finalement CHANGES_REQUESTED: y");
    expect(r2.approved).toBe(false);
    expect(r2.changes).toBe("y");
  });

  it("insensible à la casse du marqueur", () => {
    const r = parseReviewResult("approved: parfait");
    expect(r.approved).toBe(true);
  });

  it("gère APPROVED sans deux-points", () => {
    const r = parseReviewResult("APPROVED ok");
    expect(r.approved).toBe(true);
    expect(r.summary).toBe("ok");
  });

  it("CHANGES_REQUESTED sans contenu → libellé par défaut", () => {
    const r = parseReviewResult("CHANGES_REQUESTED");
    expect(r.approved).toBe(false);
    expect(r.changes).toBe("défauts non précisés");
  });
});

describe("buildReviewCorrectionPrompt", () => {
  it("contient le titre et les défauts", () => {
    const p = buildReviewCorrectionPrompt({ id: 5, title: "Fix X" }, "1. bug", "dir");
    expect(p).toContain("Fix X");
    expect(p).toContain("1. bug");
    expect(p).toContain("dir");
    expect(p).toContain("SEARCH/REPLACE");
    expect(p).toContain("DONE");
  });

  it("ne met pas de directive si absente", () => {
    const p = buildReviewCorrectionPrompt({ id: 5, title: "Fix X" }, "1. bug", null);
    expect(p).toContain("Fix X");
  });
});
