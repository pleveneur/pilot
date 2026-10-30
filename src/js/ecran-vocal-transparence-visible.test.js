/**
 * Tests — « LA TRANSPARENCE NE SE VOIT PAS » (remarque du proprietaire,
 * 2026-11-02), mesuree AU PIXEL sur les DIX palettes.
 *
 * CE QUE CE FICHIER VERROUILLE, ET POURQUOI IL FALLAIT UN CALCUL.
 * La premiere reponse a la remarque avait pose une surface de verre et deux
 * lavis — et la transparence ne se voyait toujours pas. La cause n'etait pas
 * « pas assez de flou » : le lavis etait fait de `--surface-floating`, la MEME
 * famille de couleur que la teinte du panneau (`--glass-tint`, qui derive elle
 * aussi de `--surface-floating`). Le verre etait donc eclaire par sa propre
 * couleur : les deux se compensaient, et le panneau se lisait exactement comme
 * le fond de l'application. Un test qui cherche des mots (`color-mix`,
 * `transparent`, `var(--glass-tint)`) ne pouvait pas le voir — tous les mots
 * etaient la. Ce fichier-ci ne lit donc pas des mots : il RESOUT les jetons des
 * dix palettes et compose les couches comme le compositeur le fait, puis il
 * mesure trois choses.
 *
 *   1. LA LUMIERE TRAVERSE (c'est la definition de la transparence) : entre le
 *      panneau pose sur le lavis et le MEME panneau pose a nu, l'ecart doit
 *      valoir au moins 6 niveaux (sur 255). Ancien jeu de jetons : 1,1 a 1,6
 *      niveau partout — invisible, panneau opaque. Nouveau : voir le tableau du
 *      rapport.
 *   2. LE PANNEAU A UN BORD (sinon la transparence « ne se voit » toujours pas) :
 *      l'ecart entre le panneau et ce qu'il y a juste derriere lui vaut au moins
 *      4 niveaux — sinon il n'y a pas de panneau du tout.
 *   3. LE TEXTE RESTE LISIBLE, et la lisibilite GAGNE sur la transparence :
 *      contraste WCAG du texte courant sur le panneau, >= 4,5:1 sur les neuf
 *      palettes qui l'atteignent sur leur propre fond, et jamais sous la mesure
 *      de `solarized` (dont la palette plafonne a 4,13:1 sur son fond : le
 *      panneau ne fait que passer devant une lumiere, et il ne peut pas faire
 *      mieux que sa palette — c'est dit, pas corrige en silence).
 *
 * Aucun navigateur : lecture des sources (fins de ligne normalisees,
 * quality-gate § 3.4) et un modele de composition a quatre couches, sans
 * dependance.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(ICI, "..", "..", "src", "css", "style.css"), "utf8").replace(
  /\r\n/g,
  "\n",
);

// ---------------------------------------------------------------------------
// 1. LIRE LES JETONS DE LA FEUILLE DE STYLE (aucune valeur recopiee ici).

/** Corps d'un bloc CSS par son selecteur d'ouverture (decoupage verifie). */
const bloc = (selecteur) => sliceSource(CSS, `${selecteur} {`, "\n}", 60);

/** Declarations du calque, lues une fois. */
const CALQUE = bloc(".pilot-vocal");

/** Le jeton `--nom` d'un corps de bloc, ou `null`. */
function jeton(corps, nom) {
  const trouve = corps.match(new RegExp(`--${nom}:\\s*([^;]+);`));
  return trouve ? trouve[1].trim() : null;
}

/** Le pourcentage d'un `color-mix(... N%, transparent)`. */
function pourcent(declaration, ou) {
  const trouve = String(declaration || "").match(/(\d+(?:\.\d+)?)%/g);
  if (!trouve) throw new Error(`aucun pourcentage dans ${ou} : ${declaration}`);
  return Number(trouve[0].replace("%", "")) / 100;
}

/** Couleur nommee ou hexadecimal -> [r, g, b] (0-255). */
function couleur(valeur) {
  const v = String(valeur).trim();
  const m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    const paires =
      h.length === 3
        ? h.split("").map((c) => c + c)
        : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return paires.map((p) => parseInt(p, 16));
  }
  const r = v.match(/^rgba?\(([^)]+)\)$/i);
  if (r) return r[1].split(",").slice(0, 3).map((n) => Number(n.trim()));
  throw new Error(`couleur illisible : ${valeur}`);
}

/** Composition « source alpha sur fond » (alpha = opacite de la source). */
const dessus = (source, fond, alpha) =>
  source.map((v, i) => v * alpha + fond[i] * (1 - alpha));

/** Luminance relative WCAG 2.1. */
function luminance(rgb) {
  const s = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

/** Rapport de contraste WCAG entre deux couleurs opaques. */
function contraste(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Le plus grand ecart, en niveaux, entre deux couleurs (mesure de perception). */
const ecart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// ---------------------------------------------------------------------------
// 2. LES DIX PALETTES, lues dans les blocs de la feuille de style.

const THEMES = [
  [".theme-dark", ".theme-dark"],
  [".theme-light", ".theme-light"],
  ["body.theme-dark.theme-one-dark", "one-dark"],
  ["body.theme-dark.theme-dracula", "dracula"],
  ["body.theme-dark.theme-nord", "nord"],
  ["body.theme-dark.theme-tokyo-night", "tokyo-night"],
  ["body.theme-light.theme-github", "github"],
  ["body.theme-light.theme-one-light", "one-light"],
  ["body.theme-light.theme-solarized", "solarized"],
  ["body.theme-light.theme-tokyo-day", "tokyo-day"],
];

/** Lit un jeton d'une palette, en heritant du theme de base du meme mode. */
function palette(selecteur) {
  const base = selecteur.startsWith("body.theme-light") ? ".theme-light" : ".theme-dark";
  const lire = (nom, repli) => {
    const propre = jeton(bloc(selecteur), nom);
    if (propre !== null) return couleur(propre);
    if (repli) return repli;
    const herite = jeton(bloc(base), nom);
    if (herite === null) throw new Error(`jeton --${nom} introuvable (${selecteur})`);
    return couleur(herite);
  };
  return {
    fond: lire("bg-app"),
    surface: lire("surface-floating"),
    texte: lire("text-primary"),
    secondaire: lire("text-secondary"),
  };
}

// ---------------------------------------------------------------------------
// 3. LES COUCHES, telles que la feuille de style les empile.

/** Le lavis de fond du calque : `--vocal-wash` (taux et source lus au CSS). */
const LAVIS = {
  declaration: jeton(CALQUE, "vocal-wash") || "",
  taux: pourcent(jeton(CALQUE, "vocal-wash"), "--vocal-wash"),
};
/** La surface des colonnes : `--vocal-glass`, melange de `--glass-tint`. */
const VERRE = {
  declaration: jeton(CALQUE, "vocal-glass") || "",
  taux: pourcent(jeton(CALQUE, "vocal-glass"), "--vocal-glass"),
};
/** `--glass-tint` : la teinte de verre du theme, melange de `--surface-floating`. */
const TEINTE = {
  declaration: jeton(bloc(".theme-dark"), "glass-tint") || "",
  taux: pourcent(jeton(bloc(".theme-dark"), "glass-tint"), "--glass-tint"),
};

const ALPHA_VERRE = VERRE.taux * TEINTE.taux;

/** La couleur SOURCE du lavis, lue dans sa declaration (jamais supposee). */
function sourceDuLavis(p) {
  const nom = (LAVIS.declaration.match(/var\((--[a-z-]+)\)/) || [])[1];
  if (nom === "--text-primary") return p.texte;
  if (nom === "--surface-floating") return p.surface;
  if (nom === "--bg-app") return p.fond;
  throw new Error(`source de lavis inattendue : ${nom} (${LAVIS.declaration})`);
}

/** Le fond du calque, eclaire par le lavis (plein, au bord des colonnes). */
const avecLavis = (p) => dessus(sourceDuLavis(p), p.fond, LAVIS.taux);
/** Ce qu'il y a derriere le panneau : le lavis, ou le fond nu. */
const sansLavis = (p) => p.fond;

/** Le panneau pose sur `arriere`. */
const panneau = (p, arriere) =>
  dessus(dessus(p.surface, arriere, TEINTE.taux), arriere, VERRE.taux);

/** Les quatre compositions utiles, nommees une fois. */
const MESURES = THEMES.map(([selecteur, nom]) => {
  const p = palette(selecteur);
  const arriere = avecLavis(p);
  const verre = panneau(p, arriere);
  const nu = panneau(p, sansLavis(p));
  return {
    nom,
    p,
    arriere,
    verre,
    nu,
    traverse: ecart(verre, nu),
    bord: ecart(verre, arriere),
    contrasteTexte: contraste(p.texte, verre),
    contrasteSecondaire: contraste(p.secondaire, verre),
    contrasteSurFond: contraste(p.texte, p.fond),
  };
});

// ---------------------------------------------------------------------------

describe("T1 — les jetons mesures sont bien ceux du theme ACTIF", () => {
  it("les deux jetons du calque sont des MELANGES de jetons du theme, sans aucune couleur en dur", () => {
    for (const [nom, declaration] of [
      ["--vocal-wash", LAVIS.declaration],
      ["--vocal-glass", VERRE.declaration],
    ]) {
      expect(declaration, `${nom} absent du calque .pilot-vocal`).toContain("color-mix(");
      expect(declaration, nom).toContain("transparent");
      expect(declaration, `${nom} ecrit une couleur en dur`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/,
      );
      expect(declaration, `${nom} ne lit aucun jeton du theme`).toMatch(/var\(--[a-z-]+\)/);
    }
    // La surface des colonnes vient du verre des panneaux flottants, donc du
    // theme, donc des dix palettes : rien n'est recopie.
    expect(VERRE.declaration).toContain("var(--glass-tint)");
    expect(TEINTE.declaration).toContain("var(--surface-floating)");
    // Et le lavis ne vient PAS de la meme famille que la surface : c'est la
    // cause du defaut precedent (les deux se compensaient).
    expect(LAVIS.declaration).toContain("var(--text-primary)");
    expect(LAVIS.declaration).not.toContain("var(--surface-floating)");
  });

  it("une plage utile : la teinte reste entre 92 et 95 %, le verre sous les deux tiers", () => {
    // La plage de `--glass-tint` est documentee sous `.theme-dark` (92 a 95 %).
    expect(TEINTE.taux).toBeGreaterThanOrEqual(0.92);
    expect(TEINTE.taux).toBeLessThanOrEqual(0.95);
    // Le verre laisse donc passer au moins un tiers de ce qu'il y a derriere.
    expect(ALPHA_VERRE).toBeLessThanOrEqual(2 / 3);
    expect(ALPHA_VERRE).toBeGreaterThan(0);
  });
});

describe("T2 — la lumiere TRAVERSE le verre (sinon il n'y a pas de transparence)", () => {
  it("au moins 6 niveaux d'ecart entre le panneau eclaire et le meme panneau a nu", () => {
    // C'est la mesure du defaut precedent : avec un lavis de `--surface-floating`,
    // l'ecart tombait a 1,1-1,6 niveau sur les dix palettes, et le panneau se
    // lisait comme le fond. Le seuil de 6 est BAS a dessein : il ne juge pas une
    // esthetique, il constate qu'il y a quelque chose a voir au travers.
    for (const m of MESURES) {
      expect(m.traverse, `${m.nom} : la lumiere ne traverse pas`).toBeGreaterThanOrEqual(6);
    }
  });

  it("le verre se voit : au moins 4 niveaux entre le panneau et ce qu'il recouvre", () => {
    for (const m of MESURES) {
      expect(m.bord, `${m.nom} : aucun bord, donc aucun panneau`).toBeGreaterThanOrEqual(4);
    }
  });

  it("c'est bien un MELANGE : le panneau n'est ni le fond nu, ni la surface pleine", () => {
    for (const m of MESURES) {
      // Ni opaque (il ne serait plus du verre)...
      expect(ecart(m.verre, m.p.surface), `${m.nom} : opaque`).toBeGreaterThan(0.5);
      // ... ni identique au fond (il n'y aurait pas de panneau)...
      expect(ecart(m.verre, m.arriere), `${m.nom} : invisible`).toBeGreaterThan(0.5);
      // ... mais ENTRE les deux, canal par canal : une composition, pas un choix.
      for (let c = 0; c < 3; c++) {
        const bas = Math.min(m.arriere[c], m.p.surface[c]) - 0.001;
        const haut = Math.max(m.arriere[c], m.p.surface[c]) + 0.001;
        expect(m.verre[c], `${m.nom} : canal ${c} hors du melange`).toBeGreaterThanOrEqual(bas);
        expect(m.verre[c], `${m.nom} : canal ${c} hors du melange`).toBeLessThanOrEqual(haut);
      }
    }
  });
});

describe("T3 — la LISIBILITE gagne sur la transparence, sur les dix palettes", () => {
  it("le texte courant reste au-dessus de 4,5:1 partout ou la palette y arrive deja", () => {
    // `solarized` est traitee a part, juste apres : sa palette ne donne que
    // 4,13:1 sur son PROPRE fond. Aucune transparence ne peut rendre un texte
    // plus lisible que la palette qui le porte ; on refuse donc de degrader, on
    // ne pretend pas corriger.
    for (const m of MESURES.filter((x) => x.nom !== "solarized")) {
      expect(m.contrasteSurFond, `${m.nom} : la palette elle-meme`).toBeGreaterThanOrEqual(4.5);
      expect(m.contrasteTexte, `${m.nom} : texte sur le panneau`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("`solarized` : la palette plafonne a 4,13:1, le panneau ne fait que passer devant", () => {
    const m = MESURES.find((x) => x.nom === "solarized");
    expect(m.contrasteSurFond).toBeLessThan(4.5); // constat, pas une excuse
    expect(m.contrasteTexte).toBeGreaterThanOrEqual(3.8);
    // Et on ne descend pas plus bas : c'est cette borne qui interdit d'augmenter
    // le lavis ou la teinte « pour que ca se voie mieux ». La lisibilite gagne.
    expect(m.contrasteTexte).toBeLessThan(m.contrasteSurFond + 0.5);
  });

  it("les TITRES des colonnes (secondaire) restent au-dessus de 3:1, le seuil du texte gras", () => {
    // Les titres sont en 11 px, gras, en majuscules : le seuil AA du texte
    // « grand » (3:1) s'applique, pas celui du texte courant.
    for (const m of MESURES) {
      expect(m.contrasteSecondaire, `${m.nom} : titres`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("T4 — le changement de theme s'applique sans redemarrage", () => {
  it("les deux jetons sont des VARIABLES : aucun cache, aucun redemarrage", () => {
    // Une variable CSS se recalcule des que le theme change ; c'est la seule
    // raison pour laquelle la remarque « ca ne suit pas le theme » ne peut pas
    // revenir. Un `background-color` ecrit en dur, lui, ne suivrait pas.
    for (const nom of ["--vocal-wash", "--vocal-glass"]) {
      expect(CALQUE).toContain(`${nom}:`);
    }
    // Et le flou est recompose a chaud, comme celui des panneaux flottants.
    for (const colonne of [".vocal-side-discussion", ".vocal-side-tasks"]) {
      expect(CSS).toContain(`body.glass-refresh ${colonne}`);
    }
  });

  it("les dix palettes donnent DIX panneaux differents : le theme est vraiment lu", () => {
    const signatures = new Set(MESURES.map((m) => m.verre.map((v) => Math.round(v)).join(",")));
    expect(signatures.size).toBe(MESURES.length);
  });
});
