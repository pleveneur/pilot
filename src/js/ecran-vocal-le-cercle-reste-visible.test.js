// Tests — LE CERCLE DE L'ECRAN VOCAL RESTE VISIBLE DANS L'ETAT NU.
//
// Demande du proprietaire (2026-11-02) : « quand on desactive l'affichage, le
// cercle ne doit pas disparaitre ». L'etat attendu une fois masque, SANS
// EXCEPTION :
//   - le cercle reste visible, identique a l'etat normal (taille, place,
//     bord, enveloppe, arc, respiration) ;
//   - le portrait et son prenom restent visibles (acquis a0daf4e) ;
//   - le bouton de masquage reste visible, de forme, taille et place inchangees ;
//   - la zone de saisie reste affichee et utilisable (acquis a0daf4e) ;
//   - les cadres des panneaux disparaissent, y compris celui de droite ;
//   - le fond de scene de l'etat masque n'eteint ni n'assombrit le cercle.
//
// LA CAUSE, mesuree et non supposee. Le bloc d'effacement de l'etat nu nommait le
// disque dans sa liste de selecteurs (`.pilot-vocal.vocal-bare .vocal-orb,`) et
// lui appliquait `opacity: 0` puis `visibility: hidden` : le cercle s'eteignait
// par SA PROPRE REGLE, pas par un ancetre et pas par un calque superpose. Le
// correctif n'ajoute donc AUCUNE exception qui le rallume (`opacity: 1` aurait eu
// a gagner a la fois sur la specificite et sur la transition de `visibility`,
// retardee de 180 ms) : c'est son NOM qui est retire de la liste. Corriger le
// perimetre en amont, plutot que plaider une exception en aval.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. aucune regle de l'etat nu ne nomme le disque, SES PIECES (`.vocal-halo`,
//      dont l'enveloppe est le `::before` du disque) ni son hote `.vocal-stage` ;
//   2. aucune regle de l'etat nu ne touche sa taille, sa place, son apparence, ni
//      les jetons qui les portent (`--vocal-orb-size`, `--vocal-state`) ;
//   3. la liste d'effacement est EXACTEMENT celle attendue : cinq selecteurs, et
//      ni le disque, ni le portrait, ni la zone de saisie ;
//   4. le fond de scene ne peut ni l'eteindre ni l'assombrir : il vit sur le
//      `background-image` du calque PARENT (donc derriere ses enfants) et son
//      rayon s'arrete avant la boite du disque ; aucun voile, aucun `filter`,
//      aucune `opacity` n'est pose sur l'overlay nu ni sur ses pseudo-elements ;
//   5. le verrou n'est pas complaisant : la regle du defaut, REINTRODUITE dans la
//      source, est vue (mutation rejouee a chaque execution), et un voile pose
//      sur l'overlay l'est aussi.
//
// Les commentaires sont en ASCII ; les selecteurs et les extraits lus sont copies
// tels quels depuis les fichiers sources.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage verifie : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture). Les
// commentaires sont neutralises — celui de l'etat nu CITE la regle fautive pour
// expliquer le defaut : ce n'est pas une regle.
import { sliceSource, neutraliserSource } from "./source-slice.js";
import { VOCAL_BARE_CLASS } from "./vocal-bare.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");

// ---------------------------------------------------------------------------
// LECTURE DES REGLES — un parseur minimal, sans dependance.
//
// `([^{}]+)\{([^{}]*)\}` ne peut pas franchir une accolade : les at-rules
// (`@media (...) { … }`) ne sont donc jamais prises pour des selecteurs, seules
// les regles qu'elles contiennent le sont. Aucun CSS du projet n'imbrique une
// regle dans une autre.
// ---------------------------------------------------------------------------
function regles(source) {
  const texte = neutraliserSource(source);
  const sortie = [];
  const motif = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = motif.exec(texte)) !== null) {
    sortie.push({
      selecteurs: m[1]
        .split(",")
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean),
      corps: m[2].replace(/\s+/g, " ").trim(),
    });
  }
  return sortie;
}

// Un selecteur appartient a l'ETAT NU s'il porte la classe `vocal-bare` comme
// MOT de classe (`.vocal-bare` en prefixe d'une autre classe ne compte pas).
const EST_NU = new RegExp(`\\.${VOCAL_BARE_CLASS}(?![\\w-])`);
const reglesNues = (source) =>
  regles(source).filter((r) => r.selecteurs.some((s) => EST_NU.test(s)));

// Une classe, comme MOT de classe : `.vocal-orb` ne doit pas matcher
// `.vocal-orb-name`, qui n'existe plus mais qui reviendrait un jour.
const nommeurs = (source, classe) => {
  const motif = new RegExp(`\\.${classe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
  return reglesNues(source).flatMap((r) => r.selecteurs.filter((s) => motif.test(s)));
};

// Les selecteurs de l'etat nu qui atteignent le DISQUE : lui, ses pieces, son
// hote (le clic du bouton « Réveiller » vient de `.vocal-stage`, qui est l'un des
// six hotes de l'ecran — issue #381).
const coupablesDuDisque = (source) =>
  [
    ...nommeurs(source, "vocal-orb"),
    ...nommeurs(source, "vocal-halo"),
    ...nommeurs(source, "vocal-stage"),
  ].sort();

// Le bloc d'effacement principal : la seule regle de l'etat nu qui pose le
// fondu (`opacity: 0` + `visibility: hidden` + `pointer-events: none`).
const blocEffacement = () =>
  regles(CSS)
    .filter((r) => r.selecteurs.some((s) => EST_NU.test(s)))
    .filter((r) => /opacity: 0/.test(r.corps) && /visibility: hidden/.test(r.corps))[0];

describe("1. ce que l'etat nu eteint — et le cercle, qui n'en est pas", () => {
  it("la liste d'effacement est exactement celle-la, et le disque n'y est pas", () => {
    const bloc = blocEffacement();
    expect(bloc, "le bloc d'effacement de l'etat nu est introuvable").toBeTruthy();
    expect(bloc.selecteurs).toEqual([
      ".pilot-vocal.vocal-bare .vocal-mic-fix",
      ".pilot-vocal.vocal-bare .vocal-status",
      ".pilot-vocal.vocal-bare .vocal-side-discussion",
      ".pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-tasks-title",
      ".pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-side-body",
    ]);
    // Le sens de la liste est une decision, pas un detail : ce sont les
    // panneaux, la ligne d'etat et le bouton de depannage du micro. Le DISQUE
    // n'y est pas, le PORTRAIT non plus, la ZONE DE SAISIE non plus.
    for (const survit of [".vocal-orb", ".vocal-portrait", ".vocal-input"]) {
      expect(bloc.selecteurs.join(" ")).not.toContain(survit);
    }
  });

  it("aucune regle de l'etat nu ne nomme le disque, ses pieces ou son hote", () => {
    expect(
      coupablesDuDisque(CSS),
      "ces selecteurs de l'etat nu eteignent le cercle (ou l'un de ses ancetres)",
    ).toEqual([]);
  });

  it("aucune regle ne retouche sa taille, sa place ou son apparence", () => {
    // Une regle qui nommerait le disque pour le redimensionner, le deplacer ou
    // changer son bord serait deja refusee ci-dessus. Restent les JETONS : les
    // redefinir sur l'overlay nu changerait le cercle sans le nommer.
    for (const jeton of ["--vocal-orb-size", "--vocal-state", "--vocal-crown"]) {
      const regles = reglesNues(CSS).filter((r) => r.corps.includes(jeton));
      expect(
        regles.flatMap((r) => r.selecteurs),
        `${jeton} ne doit pas etre redefini par l'etat nu`,
      ).toEqual([]);
    }
  });

  it("la regle de base du disque est intacte : meme taille, meme bord, meme lumiere", () => {
    // Le contrat « identique a l'etat normal » se lit ici : le correctif ne doit
    // pas avoir ete obtenu en affaiblissant le disque lui-meme.
    const base = sliceSource(CSS, "\n.vocal-orb {", "}", 400);
    expect(base).toContain("width: var(--vocal-orb-size)");
    expect(base).toContain("height: var(--vocal-orb-size)");
    expect(base).toContain("border: 2px solid var(--vocal-state");
    expect(base).toMatch(/border-radius:\s*50%/);
    expect(base).toContain("radial-gradient(");
  });
});

describe("2. le fond de scene ne peut ni l'eteindre ni l'assombrir", () => {
  it("le fond vit sur le calque PARENT : il est peint derriere ses enfants", () => {
    const overlay = sliceSource(CSS, ".pilot-vocal {", "}", 400);
    expect(overlay).toContain("background: var(--bg-app)");
    // Les deux lavis de l'etat masque sont un `background-image` du calque, donc
    // derriere le disque — jamais un noeud pose devant lui.
    expect(overlay).toContain("background-image:");
    expect(overlay).toContain("--vocal-wash-w");
    expect(overlay).toContain("var(--vocal-wash)");
  });

  it("le rayon des lavis s'arrete AVANT la boite du disque", () => {
    // `--vocal-wash-w` retranche la demi-boite du disque et son jour : le lavis ne
    // touche pas le cercle, et ne peut donc pas en changer la teinte.
    const jeton = sliceSource(CSS, "--vocal-wash-w:", ";", 20);
    expect(jeton).toContain("var(--vocal-orb-box)");
    expect(jeton).toMatch(/\/ 2 - 24px|24px/);
  });

  it("aucun voile, filtre ni opacite n'est pose sur l'overlay nu", () => {
    // L'overlay et ses pseudo-elements ne sont JAMAIS nommes par l'etat nu : un
    // `::before` en `inset: 0` passerait DEVANT le disque et le ternirait, une
    // `opacity` l'eteindrait d'un coup avec tout son contenu.
    const coupables = reglesNues(CSS)
      .flatMap((r) => r.selecteurs)
      .filter((s) => /^\.pilot-vocal\.vocal-bare(::?(before|after))?$/.test(s));
    expect(coupables).toEqual([]);
  });
});

describe("3. ce qui survit a l'etat nu", () => {
  it("le cercle, le portrait, son nom et la zone de saisie ne sont jamais nommes", () => {
    const survit = ["vocal-orb", "vocal-halo", "vocal-portrait", "vocal-portrait-name", "vocal-input"];
    for (const classe of survit) {
      expect(nommeurs(CSS, classe), `.${classe} ne doit pas etre nomme par l'etat nu`).toEqual([]);
    }
  });

  it("le bouton de masquage, lui, est nomme — pour etre RALLUME, pas eteint", () => {
    const exception = reglesNues(CSS).filter((r) =>
      r.selecteurs.some((s) => s === ".pilot-vocal.vocal-bare .vocal-top .vocal-display-toggle"),
    );
    expect(exception).toHaveLength(1);
    expect(exception[0].corps).toMatch(/opacity: 1/);
    expect(exception[0].corps).toMatch(/visibility: visible/);
    // Aucune dimension, aucune position, aucune apparence : sa forme, sa taille
    // et sa place ne dependent pas de l'etat.
    for (const interdit of ["width", "height", "padding", "margin", "position", "transform", "display"]) {
      expect(exception[0].corps).not.toMatch(new RegExp(`(^|;)\\s*${interdit}`));
    }
  });
});

describe("4. le verrou n'est pas complaisant : la mutation est rejouee", () => {
  it("la regle du defaut, reintroduite, est immediatement vue", () => {
    // C'est la ligne exacte retiree du bloc d'effacement. On la remet dans une
    // COPIE de la source : la mesure doit la designer. Sans ce test, une erreur
    // de lecture (liste vide) ferait passer tous les autres pour rien.
    const mute = CSS.replace(
      ".pilot-vocal.vocal-bare .vocal-mic-fix,",
      ".pilot-vocal.vocal-bare .vocal-orb,\n.pilot-vocal.vocal-bare .vocal-mic-fix,",
    );
    expect(mute, "la mutation n'a pas pris : l'ancre du bloc d'effacement a change").not.toBe(CSS);
    expect(coupablesDuDisque(mute)).toEqual([".pilot-vocal.vocal-bare .vocal-orb"]);
    // Et le bloc mesure, mute, contient bien l'extinction (le defaut est reel :
    // ce n'est pas qu'un selecteur en trop).
    const blocMute = regles(mute)
      .filter((r) => r.selecteurs.some((s) => EST_NU.test(s)))
      .filter((r) => /opacity: 0/.test(r.corps) && /visibility: hidden/.test(r.corps))[0];
    expect(blocMute.selecteurs).toContain(".pilot-vocal.vocal-bare .vocal-orb");
  });

  it("un voile pose devant le disque est vu lui aussi", () => {
    // Le second chemin par lequel le cercle pourrait s'eteindre : un calque
    // opaque sur l'overlay, qui passerait devant tous ses enfants.
    const mute =
      CSS +
      '\n.pilot-vocal.vocal-bare::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background: var(--bg-app);\n}\n';
    const voiles = reglesNues(mute)
      .flatMap((r) => r.selecteurs)
      .filter((s) => /^\.pilot-vocal\.vocal-bare(::?(before|after))?$/.test(s));
    expect(voiles).toEqual([".pilot-vocal.vocal-bare::before"]);
  });

  it("un ancetre eteint est vu : `.vocal-stage` emporterait le disque", () => {
    const mute =
      CSS +
      "\n.pilot-vocal.vocal-bare .vocal-stage {\n  opacity: 0.4;\n}\n";
    expect(coupablesDuDisque(mute)).toEqual([".pilot-vocal.vocal-bare .vocal-stage"]);
  });
});
