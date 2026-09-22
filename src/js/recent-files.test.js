// Tests — recent-files.js : historique des fichiers récents (popover Ctrl+Alt+R).
//
// Contrat vérifié : liste PAR PROJET (clé localStorage dédiée), insertion en
// tête, dédoublonnage insensible au sens des séparateurs, bornage à 20,
// tolérance au JSON corrompu, refus d'un chemin vide.

import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map();

vi.hoisted(() => {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = {};
});

import { recordRecentFile, getRecentFiles } from "./recent-files.js";

const PROJ = "C:/proj/A";

beforeEach(() => {
  store.clear();
  window._pilotProjectPath = PROJ;
});

describe("recent-files — enregistrement et lecture", () => {
  it("insère le fichier en tête et le relit", () => {
    recordRecentFile("C:/proj/A/a.md");
    recordRecentFile("C:/proj/A/b.md");
    expect(getRecentFiles()).toEqual(["C:/proj/A/b.md", "C:/proj/A/a.md"]);
  });

  it("dédoublonne en remontant en tête, insensible au sens des séparateurs", () => {
    recordRecentFile("C:/proj/A/a.md");
    recordRecentFile("C:/proj/A/b.md");
    recordRecentFile("C:\\proj\\A\\a.md"); // même fichier, séparateurs Windows

    const list = getRecentFiles();
    expect(list).toEqual(["C:\\proj\\A\\a.md", "C:/proj/A/b.md"]);
    expect(list.length).toBe(2);
  });

  it("ignore un chemin vide ou absent", () => {
    recordRecentFile("");
    recordRecentFile(null);
    recordRecentFile(undefined);
    expect(getRecentFiles()).toEqual([]);
  });

  it("borne la liste aux 20 derniers fichiers", () => {
    for (let i = 1; i <= 25; i++) recordRecentFile(`C:/proj/A/f${i}.md`);
    const list = getRecentFiles();
    expect(list.length).toBe(20);
    expect(list[0]).toBe("C:/proj/A/f25.md");
    expect(list).not.toContain("C:/proj/A/f5.md"); // évincé
    expect(list).toContain("C:/proj/A/f6.md");
  });

  it("isole les listes par projet (clé localStorage distincte)", () => {
    recordRecentFile("C:/proj/A/a.md");
    window._pilotProjectPath = "C:/proj/B";
    recordRecentFile("C:/proj/B/b.md");
    expect(getRecentFiles()).toEqual(["C:/proj/B/b.md"]);

    window._pilotProjectPath = PROJ;
    expect(getRecentFiles()).toEqual(["C:/proj/A/a.md"]);
  });

  it("tolère un JSON corrompu sans lever (liste vide)", () => {
    localStorage.setItem("pilot:recents:" + PROJ, "{ pas du json");
    expect(getRecentFiles()).toEqual([]);

    // et un enregistrement sur un stockage corrompu repart proprement
    recordRecentFile("C:/proj/A/a.md");
    expect(getRecentFiles()).toEqual(["C:/proj/A/a.md"]);
  });

  it("un JSON non-tableau est traité comme une liste vide", () => {
    localStorage.setItem("pilot:recents:" + PROJ, JSON.stringify({ oops: 1 }));
    expect(getRecentFiles()).toEqual([]);
  });

  it("sans projet actif, utilise la clé _global", () => {
    delete window._pilotProjectPath;
    recordRecentFile("C:/ailleurs/x.md");
    expect(localStorage.getItem("pilot:recents:_global")).toBeTruthy();
    expect(getRecentFiles()).toEqual(["C:/ailleurs/x.md"]);
  });
});
