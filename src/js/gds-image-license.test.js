/**
 * Garde-fou de licence de l'image serveur (GDS).
 *
 * Le projet est publié sous licence MIT : l'avis de copyright doit accompagner
 * toute copie, image comprise. Ces tests lisent les fichiers de la recette et
 * verrouillent deux choses qu'une modification distraite casserait en silence :
 *   - la notice est bien COPIÉE dans l'image finale (et vérifiée à la
 *     construction) ;
 *   - le filtre du contexte de construction ne l'exclut pas — sans quoi
 *     `docker build` échouerait… ou pire, l'image partirait sans sa notice.
 * Aucun Docker n'est requis : ce sont des lectures de fichiers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const DOCKERFILE = lire("gds-server/Dockerfile");
const IGNORE = lire(".dockerignore");
const LICENSE = lire("LICENSE");
const COMPOSE = lire("gds-server/docker-compose.yml");

/** Motifs actifs de `.dockerignore` (commentaires et lignes vides retirés). */
const motifsActifs = (contenu) =>
  contenu
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

const DESTINATION = "/usr/share/doc/pilot-gds/LICENSE";

describe("image serveur GDS — notice de licence", () => {
  it("copie la notice dans l'image finale, depuis le contexte", () => {
    expect(DOCKERFILE).toContain(`COPY LICENSE ${DESTINATION}`);
    // La notice vient du contexte de construction, pas de l'étage builder (elle
    // n'a rien à voir avec la compilation).
    expect(DOCKERFILE).not.toMatch(new RegExp(`COPY --from=\\w+ .*${DESTINATION}`));
  });

  it("échoue à la construction si la notice manque ou change de licence", () => {
    expect(DOCKERFILE).toContain(`test -s ${DESTINATION}`);
    expect(DOCKERFILE).toContain(`grep -q "MIT License" ${DESTINATION}`);
    // Le contrôle de la recette ne vaut que si le fichier porte bien cette
    // licence : les deux sont vérifiés ensemble.
    expect(LICENSE).toContain("MIT License");
  });

  it("n'exclut pas la notice du contexte de construction", () => {
    const motifs = motifsActifs(IGNORE);
    expect(motifs.length).toBeGreaterThan(0);
    for (const motif of motifs) {
      expect(motif, `« ${motif} » exclurait la notice`).not.toMatch(/license/i);
    }
    // Un motif « tout exclure » emporterait aussi la notice (et le Dockerfile).
    for (const motif of motifs) {
      expect(["*", "**", "/*"], `« ${motif} » exclut tout le contexte`).not.toContain(motif);
    }
  });

  it("construit depuis la racine du dépôt (là où vit la notice)", () => {
    // La recette copie des chemins relatifs à la RACINE (`LICENSE`,
    // `gds-server/…`) : un contexte déplacé casserait la copie de la notice.
    expect(COMPOSE).toMatch(/context:\s*\.\./);
  });
});
