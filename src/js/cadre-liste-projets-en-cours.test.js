/**
 * Verrou du CADRE de la liste « Projets en cours ».
 *
 * Demande du proprietaire (2026-11-02) : « Est-il possible d'encadrer la liste
 * des projets en cours, avec le meme cadre que les options en bas a gauche (en
 * dessous de la liste des fichiers) ? »
 *
 * REGLE PROTEGEE — le cadre accent est ecrit UNE SEULE FOIS, dans la regle
 * partagee `#project-footer, #open-projects-bar { ... }` de `src/css/style.css` :
 *   - `#project-footer` : les sept lignes du bas de la colonne (Brouillon,
 *     Options, Assistant, Dossier du projet, Terminal, Commandes, Outils) ;
 *   - `#open-projects-bar` : la liste « Projets en cours » (`sidebar.js`,
 *     `_renderOpenProjectsBar`).
 * Les deux blocs doivent donc porter EXACTEMENT le meme cadre : bordure accent,
 * fond leger et rayon, tous pris aux jetons de theme (aucune couleur en dur, le
 * rendu est identique en theme clair et en theme sombre).
 *
 * Ce fichier echoue si :
 *   (a) la regle partagee disparait, ou si un des deux blocs n'y figure plus ;
 *   (b) un des deux blocs se remet a ecrire son propre cadre (cadre duplique :
 *       deux definitions qui divergeront tot ou tard) ;
 *   (c) une SECONDE regle de cadre accentue est reintroduite ailleurs dans la
 *       feuille (une seule regle porte le couple bordure accent + fond a 16 %) ;
 *   (d) un `border-bottom` de separation revient sur la liste (double trait dans
 *       le rayon du cadre) ;
 *   (e) le cadre perd les jetons de theme au profit d'une couleur en dur ;
 *   (f) un des deux conteneurs disparait de `index.html` (regle orpheline).
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (chemin) =>
  readFileSync(resolve(ICI, chemin), "utf8").replace(/\r\n/g, "\n");

const css = lire("../css/style.css");
const html = lire("../../index.html");

const FOOTER = "#project-footer";
const LISTE = "#open-projects-bar";

/** Toutes les regles de la feuille : { selecteurs: [..], corps: "..." }. */
function regles() {
  const re = /(?:^|\n)([^\n{}]+) \{([^}]*)\}/g;
  const sortie = [];
  let m;
  while ((m = re.exec(css)) !== null) {
    sortie.push({
      selecteurs: m[1].split(",").map((s) => s.trim()),
      // Les commentaires sont retires : ils citent les anciennes declarations
      // (« border-bottom: … ») et ne sont pas du style applique.
      corps: m[2]
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase(),
    });
  }
  return sortie;
}

const TOUTES = regles();

/** Corps des regles ou le selecteur figure (seul ou dans une liste). */
const corpsDe = (selecteur) =>
  TOUTES.filter((r) => r.selecteurs.includes(selecteur))
    .map((r) => r.corps)
    .join("\n");
const selecteursDe = (selecteur) =>
  TOUTES.filter((r) => r.selecteurs.includes(selecteur)).map((r) => r.selecteurs);

/** Les trois declarations du cadre, telles qu'elles doivent apparaitre. */
const CADRE = [
  "background: color-mix(in srgb, var(--accent) 16%, transparent)",
  "border: 1px solid var(--accent)",
  "border-radius: var(--radius-lg)",
];

describe("Cadre de la liste « Projets en cours » — meme cadre que les options du bas", () => {
  it("une regle PARTAGEE porte le cadre des deux blocs", () => {
    const partagees = TOUTES.filter(
      (r) => r.selecteurs.includes(FOOTER) && r.selecteurs.includes(LISTE),
    );
    expect(
      partagees,
      "aucune regle ne porte le meme cadre pour la liste des projets et le bloc du bas",
    ).toHaveLength(1);
    for (const declaration of CADRE) {
      expect(
        partagees[0].corps,
        `le cadre partage n'a plus « ${declaration} »`,
      ).toContain(declaration);
    }
  });

  it("la regle partagee est bien atteinte par les DEUX selecteurs", () => {
    expect(selecteursDe(FOOTER)).toContainEqual([FOOTER, LISTE]);
    expect(selecteursDe(LISTE)).toContainEqual([FOOTER, LISTE]);
  });

  it("aucun des deux blocs n'ecrit son propre cadre (aucun doublon)", () => {
    // On retire la regle partagee : ce qui reste ne doit plus contenir le cadre.
    const reste = (selecteur) =>
      TOUTES.filter(
        (r) =>
          r.selecteurs.includes(selecteur) &&
          !(r.selecteurs.includes(FOOTER) && r.selecteurs.includes(LISTE)),
      )
        .map((r) => r.corps)
        .join("\n");
    for (const [nom, selecteur] of [
      ["le bloc du bas", FOOTER],
      ["la liste des projets", LISTE],
    ]) {
      const d = reste(selecteur);
      expect(d, `${nom} redeclare la bordure du cadre`).not.toContain(
        "border: 1px solid var(--accent)",
      );
      expect(d, `${nom} redeclare le fond du cadre`).not.toContain(
        "color-mix(in srgb, var(--accent) 16%",
      );
      expect(d, `${nom} redeclare le rayon du cadre`).not.toContain(
        "border-radius: var(--radius-lg)",
      );
    }
  });

  it("une seule regle de cadre accentue dans toute la feuille", () => {
    // Le couple « bordure accent + fond a 16 % » est la signature du cadre : s'il
    // apparait dans deux regles, un cadre a ete redouble quelque part.
    const cadres = TOUTES.filter(
      (r) =>
        r.corps.includes("border: 1px solid var(--accent)") &&
        r.corps.includes("color-mix(in srgb, var(--accent) 16%"),
    );
    expect(
      cadres.map((r) => r.selecteurs.join(", ")),
      "une seconde regle de cadre accentue a ete introduite",
    ).toEqual([`${FOOTER}, ${LISTE}`]);
  });

  it("la liste n'a plus de filet bas de separation (le cadre fait le tour)", () => {
    expect(corpsDe(LISTE)).not.toContain("border-bottom");
  });

  it("le cadre ne contient aucune couleur en dur (themes clair et sombre)", () => {
    const partagee = TOUTES.find(
      (r) => r.selecteurs.includes(FOOTER) && r.selecteurs.includes(LISTE),
    );
    expect(partagee).toBeDefined();
    // Aucun hexadecimal, aucun rgb()/hsl() : uniquement des jetons et color-mix.
    expect(partagee.corps).not.toMatch(/#[0-9a-f]{3,8}\b/);
    expect(partagee.corps).not.toMatch(/\brgba?\(/);
    expect(partagee.corps).not.toMatch(/\bhsla?\(/);
  });

  it("les deux conteneurs existent toujours dans index.html", () => {
    expect(html).toContain(`id="${FOOTER.slice(1)}"`);
    expect(html).toContain(`id="${LISTE.slice(1)}"`);
    // Le cadre ne remplace aucune fonctionnalite : la liste est toujours vide au
    // premier rendu (elle est remplie par `_renderOpenProjectsBar`), donc masquee
    // par sa classe habituelle.
    const m = html.match(/<div id="open-projects-bar"[^>]*>/);
    expect(m, "conteneur #open-projects-bar introuvable").not.toBeNull();
    expect(m[0]).toContain('class="hidden"');
  });
});
