// Tests — file-list.js : liste des chemins relatifs du projet (autocomplétion
// CodeMirror, listes de fichiers). Logique pure d'aplatissement d'arbre.
//
// Contrat vérifié : dossiers suffixés « / », chemins enfants composés avec le
// préfixe, arbre vide → liste vide, getFileList() renvoie le DERNIER résultat.

import { describe, it, expect } from "vitest";
import { getFileList, updateFileList } from "./file-list.js";

const tree = [
  { name: "README.md", is_dir: false },
  {
    name: "src",
    is_dir: true,
    children: [
      { name: "main.js", is_dir: false },
      {
        name: "css",
        is_dir: true,
        children: [{ name: "style.css", is_dir: false }],
      },
    ],
  },
];

describe("updateFileList — aplatissement de l'arbre", () => {
  it("aplatit fichiers et dossiers dans l'ordre, dossiers suffixés « / »", () => {
    expect(updateFileList(tree)).toEqual([
      "README.md",
      "src/",
      "src/main.js",
      "src/css/",
      "src/css/style.css",
    ]);
  });

  it("compose les chemins avec le préfixe fourni", () => {
    expect(updateFileList([{ name: "a.js", is_dir: false }], "proj")).toEqual(["proj/a.js"]);
  });

  it("un dossier sans `children` produit seulement son entrée suffixée", () => {
    expect(updateFileList([{ name: "vide", is_dir: true }])).toEqual(["vide/"]);
  });

  it("arbre vide → liste vide", () => {
    expect(updateFileList([])).toEqual([]);
  });

  it("getFileList() renvoie le dernier aplatissement calculé", () => {
    updateFileList(tree);
    expect(getFileList()).toEqual([
      "README.md",
      "src/",
      "src/main.js",
      "src/css/",
      "src/css/style.css",
    ]);
    updateFileList([{ name: "seul.md", is_dir: false }]);
    expect(getFileList()).toEqual(["seul.md"]);
  });
});
