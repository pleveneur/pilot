// build-handbook.test.js — Le handbook généré ne doit plus salir le dépôt.
//
// Défaut constaté : l'en-tête de `help/handbook.md` portait la date du jour
// (`<!-- PILOT-HELP generated=AAAA-MM-JJ topics=... -->`). Chaque génération
// réécrivait donc le fichier suivi alors que le CONTENU des sources était
// identique : le worktree était sale en permanence et les revues de diff
// illisibles.
//
// Ce fichier tient deux choses, et refuse de les mélanger :
//   1. la COMPOSITION est pure (`composeHandbook`) : à sources égales, texte
//      STRICTEMENT identique, même si l'horloge change entre deux générations ;
//   2. l'ÉCRITURE est paresseuse (`writeIfChanged`) : un contenu identique ne
//      touche pas le fichier (ni son contenu, ni sa date de modification).
//
// Preuve par mutation attendue : remettre une date dans l'en-tête de
// `composeHandbook` fait échouer le premier test (deux horloges différentes →
// deux textes différents) et seulement lui.
//
// La lecture normalise les fins de ligne (worktree CRLF) :
// cf. `.pi/skills/quality-gate/SKILL.md` § 3.4.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { composeHandbook, writeIfChanged } from "./build-handbook.js";

const BLOCS = [
  { topic: "overview", body: "Généralités.\n\nDeuxième paragraphe.", source: "help/overview.md" },
  { topic: "agent-pi", body: "Le chat agent.", source: "spec_rpc.md" },
];

const dossiers = [];

function dossierTemporaire() {
  const d = mkdtempSync(join(tmpdir(), "pilot-handbook-"));
  dossiers.push(d);
  return d;
}

afterEach(() => {
  vi.useRealTimers();
  while (dossiers.length) {
    const d = dossiers.pop();
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* nettoyage best-effort */
    }
  }
});

describe("composeHandbook — la composition ne dépend pas de l'horloge", () => {
  it("deux générations identiques à des dates DIFFÉRENTES produisent le même texte", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T08:00:00Z"));
    const premier = composeHandbook(BLOCS);
    vi.setSystemTime(new Date("2027-03-01T23:59:00Z"));
    const second = composeHandbook(BLOCS);

    expect(second).toBe(premier);
  });

  it("l'en-tête ne porte aucune date ni horodatage", () => {
    const entete = composeHandbook(BLOCS).split("\n")[0];
    expect(entete).toContain("PILOT-HELP");
    expect(entete).toContain("topics=overview,agent-pi");
    // Aucune date (AAAA-MM-JJ), aucune heure, aucun `generated=`.
    expect(entete).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(entete).not.toMatch(/\d{2}:\d{2}/);
    expect(entete).not.toContain("generated=");
  });

  it("le contenu des sources est conservé mot pour mot, dans l'ordre des sources", () => {
    const texte = composeHandbook(BLOCS);
    expect(texte).toContain("<!-- HELP-TOPIC:overview -->\nGénéralités.");
    expect(texte).toContain("<!-- HELP-TOPIC:agent-pi -->\nLe chat agent.");
    expect(texte.indexOf("HELP-TOPIC:overview")).toBeLessThan(texte.indexOf("HELP-TOPIC:agent-pi"));
  });
});

describe("writeIfChanged — une génération sans changement ne touche pas le fichier", () => {
  it("n'écrit rien quand le contenu est identique (date de modification inchangée)", () => {
    const d = dossierTemporaire();
    const fichier = join(d, "handbook.md");
    const contenu = composeHandbook(BLOCS);

    expect(writeIfChanged(fichier, contenu)).toBe(true);
    const avant = statSync(fichier).mtimeMs;

    expect(writeIfChanged(fichier, contenu)).toBe(false);
    expect(statSync(fichier).mtimeMs).toBe(avant);
    expect(readFileSync(fichier, "utf8")).toBe(contenu);
  });

  it("écrit quand le contenu change réellement", () => {
    const d = dossierTemporaire();
    const fichier = join(d, "handbook.md");
    writeIfChanged(fichier, composeHandbook(BLOCS));

    const modifie = composeHandbook([...BLOCS, { topic: "pdf", body: "Export PDF.", source: "spec_pdf2md.md" }]);
    expect(writeIfChanged(fichier, modifie)).toBe(true);
    expect(readFileSync(fichier, "utf8")).toContain("Export PDF.");
  });

  it("ne réécrit pas un fichier identique aux fins de ligne près (worktree CRLF)", () => {
    const d = dossierTemporaire();
    const fichier = join(d, "handbook.md");
    const contenu = composeHandbook(BLOCS);
    writeFileSync(fichier, contenu.replace(/\n/g, "\r\n"), "utf8");

    expect(writeIfChanged(fichier, contenu)).toBe(false);
    expect(readFileSync(fichier, "utf8")).toContain("\r\n");
  });
});
