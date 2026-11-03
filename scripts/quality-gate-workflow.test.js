// Verrou du lot B, trou C7.6 : CONTROLE AUTOMATIQUE DES PROPOSITIONS DE
// MODIFICATION ET DE LA BRANCHE PRINCIPALE
// (docs/rapports/RAPPORT-voies-de-contournement-livraison.md).
//
// Ce qui etait ouvert : aucun enchainement ne tournait sur une proposition de
// modification ni sur une poussee vers `main` (seuls `release.yml` sur etiquette
// `v*` et une image GDS manuelle existaient). Une suite rouge pouvait donc
// rester sur la branche principale jusqu'au tag — donc jusqu'aux utilisateurs
// installes.
//
// Ce fichier verifie trois choses, dans cet ordre :
//   1. le controle EXISTE et se declenche sur les propositions ET sur `main` ;
//   2. il ECHOUE quand les tests echouent (aucun `continue-on-error`, aucune
//      etape conditionnee) ;
//   3. il ne peut RIEN publier (aucune permission d'ecriture, aucun secret, et
//      la topologie de `release.yml` reste intacte).
//
// Preuve par mutation : ajouter `continue-on-error: true` dans ce fichier, ou
// retirer le declencheur `pull_request`, fait echouer ce bloc — et lui seul.
//
// La lecture normalise les fins de ligne (worktree CRLF) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
// Découpage de source VÉRIFIÉ (ancre absente = échec bruyant, jamais un
// fragment vide qui rendrait une assertion négative vraie par construction) :
// `src/js/source-slice.js`, imposé par l'inventaire de `source-slice.test.js`.
import { sliceFrom } from "../src/js/source-slice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../.github/workflows");

/** Lit un workflow en normalisant les fins de ligne (piege CRLF). */
function lire(name) {
  return readFileSync(resolve(DIR, name), "utf8").replace(/\r\n/g, "\n");
}

/** Le code sans les commentaires : la prose ne doit pas satisfaire un verrou. */
function sansCommentaires(src) {
  return src
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

const QG_FILE = "quality-gate.yml";
const QG = existsSync(resolve(DIR, QG_FILE)) ? lire(QG_FILE) : "";
const QG_CODE = sansCommentaires(QG);

describe("quality-gate.yml — le controle existe et se declenche au bon endroit", () => {
  it("le workflow existe", () => {
    expect(QG, `${QG_FILE} doit exister`).not.toBe("");
  });

  it("il tourne sur les propositions de modification", () => {
    expect(QG_CODE).toMatch(/^on:/m);
    // Forme courte (`pull_request:`) ou longue (`pull_request:` + cles).
    expect(QG_CODE).toMatch(/^\s{2}pull_request:\s*$/m);
  });

  it("il tourne sur les poussees vers la branche principale", () => {
    expect(QG_CODE).toMatch(/^\s{2}push:\s*$/m);
    expect(QG_CODE).toMatch(/^\s{4}branches:\s*$/m);
    expect(QG_CODE).toMatch(/^\s{6}-\s*main\s*$/m);
  });

  it("il lance les DEUX suites (front et Rust), pas seulement une", () => {
    // Une seule des deux suites laisserait la moitie du code sans controle.
    expect(QG_CODE).toContain("npm test");
    expect(QG_CODE).toMatch(/cargo test[^\n]*src-tauri\/Cargo\.toml[^\n]*--lib/);
  });
});

describe("quality-gate.yml — un test rouge fait echouer la proposition", () => {
  it("aucun continue-on-error, ni au job ni a une etape", () => {
    // C'est LE point du verrou : un « continue-on-error » transformerait le
    // controle en decoration verte.
    expect(QG_CODE).not.toContain("continue-on-error");
  });

  it("aucune etape de test n'est conditionnee", () => {
    const lignes = QG_CODE.split("\n");
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      if (!/^\s*run:/.test(l)) continue;
      const suite = `${l} ${lignes[i + 1] || ""}`;
      if (!/npm test|cargo test/.test(suite)) continue;
      // Remonter jusqu'a l'en-tete de l'etape et verifier qu'aucun `if:` ne
      // l'entoure (une etape conditionnee ne s'execute pas toujours).
      for (let j = i - 1; j >= 0; j--) {
        if (/^\s{6}- /.test(lignes[j]) || /^\s{6}- name:/.test(lignes[j])) break;
        expect(lignes[j], `etape conditionnee ligne ${j + 1}`).not.toMatch(/^\s+if:/);
      }
    }
  });

  it("le job de tests n'est pas rendu optionnel par un plafond de duree nul", () => {
    const m = QG_CODE.match(/timeout-minutes:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(0);
  });
});

describe("quality-gate.yml — il ne peut RIEN publier", () => {
  it("aucune permission d'ecriture", () => {
    expect(QG_CODE).toContain("permissions:");
    const bloc = sliceFrom(QG_CODE, "permissions:");
    expect(bloc).toContain("contents: read");
    expect(QG_CODE).not.toMatch(/contents:\s*write/);
  });

  it("aucun secret de publication, aucune release, aucun tag", () => {
    expect(QG_CODE).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(QG_CODE).not.toContain("secrets.");
    expect(QG_CODE).not.toMatch(/tauri-action/);
    expect(QG_CODE).not.toMatch(/gh release|create-release\.js|gen-latest-json\.js/);
    expect(QG_CODE).not.toMatch(/git tag|git push/);
  });

  it("la topologie de release.yml reste intacte", () => {
    const release = sansCommentaires(lire("release.yml"));
    // Ce nouveau fichier ne doit ni remplacer ni modifier la chaine de
    // publication : elle reste decrite a un seul endroit.
    expect(release).toContain("scripts/create-release.js");
    expect(release).toMatch(/latest-json:[\s\S]{0,400}?needs:\s*build/);
  });
});
