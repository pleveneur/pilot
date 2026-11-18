/**
 * VERROU DE CHAÎNE — la preuve de démarrage est-elle réellement EXIGÉE avant
 * qu'une version soit fabriquée ? (tâche 424, décision #536 du 17/11/2026,
 * endroit 2 : « aucune fabrication de version sans ce même contrôle »).
 *
 * `create-release.js` est la PREMIÈRE étape de la publication : c'est là que la
 * porte doit refuser, avant que la Release existe et avant les trois
 * fabrications. Ce fichier vérifie la BRANCHE réelle, pas une intention :
 *   - l'import de la décision unique (`src/js/garde-demarrage.js`) ;
 *   - l'application de `verdictPreuveDemarrage` AVANT tout appel réseau
 *     (`fetch(.../releases)`) : un refus ne laisse donc rien derrière lui ;
 *   - le refus net (code 2) par la fonction `refuse` existante ;
 *   - la sortie de secours explicite nommée dans la décision (elle ne tolère
 *     que l'ABSENCE de preuve) ;
 *   - la commande du poste qui fabrique la preuve (`npm run verif:demarrage`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(__dirname, "..");
const lire = (rel) => readFileSync(path.join(RACINE, rel), "utf8").replace(/\r\n/g, "\n");

describe("chaîne de livraison — la preuve de démarrage est exigée avant toute fabrication", () => {
  const source = lire("scripts/create-release.js");

  it("create-release.js importe la décision unique du garde de démarrage", () => {
    expect(source).toContain('from "../src/js/garde-demarrage.js"');
    expect(source).toContain("verdictPreuveDemarrage");
    expect(source).toContain("cheminPreuveDemarrage");
    expect(source).toContain("ALLOW_NO_STARTUP_PROOF_ENV");
  });

  it("la porte du démarrage passe AVANT la création de la Release", () => {
    const porte = source.indexOf("verdictPreuveDemarrage({");
    const reseau = source.indexOf("https://api.github.com/repos/${REPO}/releases");
    expect(porte).toBeGreaterThan(-1);
    expect(reseau).toBeGreaterThan(-1);
    expect(porte).toBeLessThan(reseau);
    // Un refus est net : il sort par `refuse` (code 2), jamais en silence.
    expect(source).toContain("if (!demarrageDecision.livrer) refuse(demarrageDecision.raison);");
  });

  it("la preuve est lue dans le dossier des livrables de la version (pas inventée)", () => {
    expect(source).toContain("lirePreuveDemarrage(versionDuTag)");
    expect(source).toContain('const versionDuTag = TAG.replace(/^v/, "");');
  });

  it("la sortie de secours ne peut tolérer qu'une preuve ABSENTE", () => {
    // La tolérance est lue dans l'environnement, et la décision pure garantit
    // qu'une preuve ratée refuse malgré elle (verrou : garde-demarrage.test.js).
    expect(source).toContain("allowMissing: flagEnabled(process.env[ALLOW_NO_STARTUP_PROOF_ENV])");
  });

  it("le poste sait fabriquer la preuve par une commande nommée", () => {
    const pkg = JSON.parse(lire("package.json"));
    expect(pkg.scripts["verif:demarrage"]).toBe("node scripts/verifier-demarrage.js");
    expect(lire("src/js/garde-demarrage.js")).toContain("npm run verif:demarrage");
  });

  it("la preuve attendue voyage avec le tag (dossier versionné, pas un dossier ignoré)", () => {
    const dossier = lire("src/js/garde-demarrage.js").match(
      /export const GARDE_DEMARRAGE_PREUVE_DIR = "([^"]+)";/,
    );
    expect(dossier).not.toBeNull();
    expect(dossier[1]).toBe("release-notes");
    const gitignore = lire(".gitignore");
    const lignes = gitignore.split("\n").map((l) => l.trim());
    expect(lignes).not.toContain("release-notes/");
    expect(lignes).not.toContain("release-notes");
  });
});
