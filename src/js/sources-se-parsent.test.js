// sources-se-parsent.test.js — Garde-fou : TOUT module du front se PARSE.
//
// Pourquoi ce test existe (incident constate le 2026-10-29, lot 1 de l'ecran
// Vocal) : un simple backtick ecrit dans un commentaire HTML a l'interieur d'un
// template literal (`... 'applyVocalPortrait'. `alt` vide : ...`) a coupe la
// chaine en deux. `super-agent.js` ne se parsait plus — donc l'application ne
// demairait plus — alors que la quasi-totalite des tests continuait de « passer » :
// ils LISENT ce fichier comme du texte (readFileSync + motifs), ils ne le
// CHARGENT pas. Seuls les fichiers de tests qui l'importent tombaient, et leur
// echec se lisait comme « Expected ';', '}' or <eof> », un message qui ne dit
// pas quel fichier est casse ni a quelle ligne.
//
// Ce garde-fou est volontairement bete : il ne resout rien, il PARSE. Il doit
// rester rapide et ne jamais produire de faux positif (aucune analyse de
// types, aucun bundle).
import { describe, it, expect } from "vitest";
import * as esbuild from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = resolve(here);
const webJsDir = resolve(here, "..", "..", "web", "js");

/** Les modules du front (hors tests) d'un dossier donne. */
function modules(dossier) {
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .sort();
}

describe("syntaxe des modules du front", () => {
  it("trouve bien les modules (sonde de coherence)", () => {
    // Si cette sonde echoue, le dossier a bouge et le garde-fou ne protege plus rien.
    const fichiers = modules(jsDir);
    expect(fichiers).toContain("super-agent.js");
    expect(fichiers).toContain("vocal-conversation.js");
    expect(fichiers.length).toBeGreaterThanOrEqual(100);
  });

  for (const dossier of [jsDir, webJsDir]) {
    for (const fichier of modules(dossier)) {
      it(`${dossier === jsDir ? "src/js" : "web/js"}/${fichier} se parse`, () => {
        const code = readFileSync(join(dossier, fichier), "utf8");
        expect(() =>
          esbuild.transformSync(code, { loader: "js", target: "es2022" })
        ).not.toThrow();
      });
    }
  }

  it("aucun backtick dans un commentaire HTML (il vit dans un template literal)", () => {
    // Motif exact de l'incident : un commentaire `<!-- ... -->` ecrit DANS le
    // template literal de l'ecran. Un backtick n'importe ou dans ce commentaire
    // ferme la chaine et le module ne se parse plus. Les commentaires sont
    // lus en BLOC (ils tiennent sur plusieurs lignes) : c'est la deuxieme ligne
    // du bloc qui portait le backtick coupable.
    const source = readFileSync(join(jsDir, "super-agent.js"), "utf8");
    const blocs = source.match(/<!--[\s\S]*?-->/g) || [];
    const coupables = blocs.filter((bloc) => bloc.includes("`"));
    expect(blocs.length).toBeGreaterThanOrEqual(5);
    expect(coupables).toEqual([]);
  });
});
