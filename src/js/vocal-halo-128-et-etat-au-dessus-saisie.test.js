// Tests — deux evolutions de l'ecran Vocal (28/10) : le RAYON DU HALO et la
// PLACE de la phrase d'etat. `docs/rapports/RAPPORT-halo-rayon-et-etat.md`.
//
// MISE A JOUR DU 13/11 (CONCEPTION-ecran-vocal-cercle-et-bas.md §1) : le disque
// a DOUBLE (168 -> 336 px) pour suivre la taille de la fenetre, et sa couronne
// avec lui (44 -> 88 px). Les nombres absolus ont donc change, la REGLE verifiee
// n'a pas bouge : le halo reste une couronne AUTOUR du disque, il ne le peint
// jamais, il ne fait rien defiler, et sa boite tient toujours dans la fenetre
// (desormais par la formule de hauteur, bornee 120..336 px, et non plus par une
// taille fixe).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le halo atteint un rayon de 256 px (boite de 512 px = 336 + 2 x 88),
//      extension 88 px au-dela de l'anneau de 168 px, et sa boite TIENT dans la
//      fenetre quelle que soit sa hauteur (formule unique, bornee).
//   2. Le degrade reste DOUX : continu d'un arret a l'autre (aucun palier
//      brutal), transparent jusqu'au bord du disque (il ne peint donc jamais
//      SUR l'objet lumineux, il reste autour), et sans `box-shadow` (aucune
//      ombre dure).
//   3. Le halo n'elargit rien et ne fait rien defiler : il est ABSOLU dans un
//      bloc en flex, et le plein ecran est `overflow: hidden`.
//   4. L'enveloppe reste PILOTEE PAR LA VOIX (plus la voix est forte, plus le
//      halo est large et lumineux) : les deux variables posees par
//      `super-agent.js` viennent de `envelopeFromEnergy`, et le repli CSS est
//      la MEME valeur de repos que le module (une seule verite).
//   5. La phrase d'etat a quitte le dessous du cercle : elle est AU-DESSUS de
//      la barre de saisie, en enfant direct de l'overlay (aucun noeud orphelin,
//      aucun espace residuel), elle ne recouvre ni la saisie ni le halo (elle se
//      peint APRES l'enveloppe et n'a aucun fond) et son etat ne change pas.
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (textes affiches, selecteurs CSS) sont copiees telles quelles.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage de source VERIFIE (une ancre absente leve au lieu de rendre un
// fragment vide qui rendrait l'assertion vraie par construction).
import { sliceSource } from "./source-slice.js";
import {
  ENVELOPE_MAX_PX,
  ENVELOPE_MIN_PX,
  ENVELOPE_RING_PX,
  envelopeFromEnergy,
} from "./vocal-enveloppe-aigu.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const CONF = JSON.parse(lire("src-tauri/tauri.conf.json"));

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence, verifiee). */
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 2);
}

/**
 * Disque de l'objet lumineux, en pixels : la BORNE HAUTE du jeton
 * `--vocal-orb-size` (336 px). La taille reelle suit la hauteur de la fenetre ;
 * c'est cette borne qui fixe la boite du halo, donc les nombres de ce fichier.
 */
const DISQUE_PX = 336;

/**
 * Les trois nombres de la conception `cercle et bas`, en clair : ils doivent
 * rester ceux du CSS (jetons `--vocal-crown` / `--vocal-arc`) et du module
 * d'enveloppe.
 */
const COURONNE_PX = 88; // `--vocal-crown` a la taille pleine du disque
const ARC_PX = 12; // `--vocal-arc` a la taille pleine du disque
const FORMULE_BASE_PX = 289; // place prise par le reste de l'ecran
const ORB_MIN_PX = 120;

/** Boite de l'enveloppe, deduite du disque et de l'extension pleine. */
const BOITE_HALO_PX = DISQUE_PX + 2 * ENVELOPE_MAX_PX;

/**
 * Taille du disque pour une hauteur de fenetre donnee, en pixels : la formule
 * UNIQUE du CSS (`clamp(120px, (100vh - 289px) * 21 / 32, 336px)`), recopiee ici
 * en nombres pour pouvoir la verifier sur plusieurs hauteurs. Elle n'est pas
 * dupliquee dans le code : c'est le CSS qui la porte (voir le test 1.3).
 */
function disquePourHauteur(hauteur) {
  const brut = ((hauteur - FORMULE_BASE_PX) * 21) / 32;
  return Math.min(Math.max(brut, ORB_MIN_PX), DISQUE_PX);
}

/** Boite du halo (disque + 2 couronnes) pour une hauteur de fenetre. */
function boiteHaloPourHauteur(hauteur) {
  const disque = disquePourHauteur(hauteur);
  return disque + 2 * (disque * COURONNE_PX) / DISQUE_PX;
}

/**
 * Arrets du degrade de l'enveloppe, du centre vers le bord :
 * `[{ alpha, position }, ...]`. Un arret s'ecrit `color-mix(... N%,
 * transparent) P%`. Un degrade illisible rend un tableau court : ce sont les
 * assertions qui le disent.
 */
function arretsEnveloppe() {
  const corps = bloc(CSS, ".vocal-orb::before {");
  const degrade = sliceSource(corps, "radial-gradient(", ");", 20);
  const arrets = [];
  const re = /(\d+(?:\.\d+)?)%,\s*transparent\)\s+(\d+)%/g;
  let m;
  while ((m = re.exec(degrade)) !== null) {
    arrets.push({ alpha: Number(m[1]) / 100, position: Number(m[2]) });
  }
  return arrets;
}

const ARRETS = arretsEnveloppe();

// ---------------------------------------------------------------------------
describe("1. le halo atteint un rayon de 256 px (et suit le disque double)", () => {
  it("l'extension retenue donne bien 168 + 88 = 256 px de rayon", () => {
    // Le disque fait 336 px de boite, donc 168 px de rayon : c'est le point de
    // depart de la couronne lumineuse.
    expect(ENVELOPE_RING_PX).toBe(DISQUE_PX / 2);
    expect(ENVELOPE_RING_PX + ENVELOPE_MAX_PX).toBe(256);
    // 88 px au-dela de l'anneau (44 px avant le doublement du disque : meme
    // proportion), et non les 32 px de l'origine.
    expect(ENVELOPE_MAX_PX).toBe(COURONNE_PX);
  });

  it("la feuille de style porte la meme couronne, en FRACTION du disque", () => {
    const corps = bloc(CSS, ".vocal-orb::before {");
    // Plus de nombre en dur : la couronne suit `--vocal-orb-size` (22 / 84 du
    // disque, soit 88 px pour 336 px). Un disque qui retrecit ne peut donc plus
    // laisser une couronne de taille fixe qui deborderait de la fenetre.
    expect(corps).toMatch(/inset:\s*calc\(var\(--vocal-crown\) \* -1\)/);
    // 336 + 2 x 88 = 512 px de boite, donc 256 px de rayon.
    expect(BOITE_HALO_PX).toBe(512);
    // Les jetons eux-memes : une seule source, sur l'overlay.
    const overlay = bloc(CSS, ".pilot-vocal {");
    expect(overlay).toMatch(
      /--vocal-crown:\s*calc\(var\(--vocal-orb-size\) \* 88 \/ 336\)/,
    );
    expect(overlay).toMatch(
      /--vocal-arc:\s*calc\(var\(--vocal-crown\) \* 12 \/ 88\)/,
    );
  });

  it("la boite du halo TIENT dans la fenetre, quelle que soit sa hauteur", () => {
    // La decision ne se tranche plus sur un nombre fixe (512 px ne tient pas
    // dans les 500 px de la fenetre minimale) mais sur la FORMULE de hauteur :
    // disque = clamp(120, (hauteur - 289) x 21/32, 336). La boite vaut alors
    // exactement `hauteur - 289`, donc elle laisse toujours 289 px au reste de
    // l'ecran (barre de 44 px, phrase d'etat, saisie, marges) : le halo n'est
    // jamais rogne, et il reste de la place pour le bas.
    const mini = CONF.app.windows[0].minHeight;
    expect(mini).toBeGreaterThan(0);
    for (const hauteur of [mini, 600, 750, 860, 1024, 1440]) {
      const boite = boiteHaloPourHauteur(hauteur);
      expect(boite, `boite du halo a ${hauteur} px`).toBeLessThanOrEqual(hauteur);
      expect(
        hauteur - boite,
        `place restante a ${hauteur} px`,
      ).toBeGreaterThanOrEqual(120);
    }
    // Le plancher de la formule : sous ~472 px de haut, le disque ne retrecit
    // plus (120 px) — le halo reste entier, il ne disparait pas.
    expect(disquePourHauteur(420)).toBe(ORB_MIN_PX);
    const boite = boiteHaloPourHauteur(420);
    expect(boite).toBeCloseTo(120 + 2 * (120 * COURONNE_PX) / DISQUE_PX, 3);
    expect(boite).toBeLessThanOrEqual(420);
    // Et le plafond : des 1 024 px de haut, le disque ne grandit plus.
    expect(disquePourHauteur(1024)).toBe(DISQUE_PX);
    expect(disquePourHauteur(1440)).toBe(DISQUE_PX);
    // Et la formule du CSS est bien celle-la (les trois jetons d'un coup).
    const overlay = bloc(CSS, ".pilot-vocal {");
    expect(overlay).toMatch(
      /--vocal-orb-size:\s*clamp\(120px, calc\(\(100vh - 289px\) \* 21 \/ 32\), 336px\)/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("2. le degrade reste doux : aucune arete, aucune ombre dure", () => {
  it("le rayon est `closest-side` : le degrade s'arrete au bord de la boite", () => {
    const corps = bloc(CSS, ".vocal-orb::before {");
    expect(corps).toMatch(/radial-gradient\(\s*closest-side/);
    expect(corps).toMatch(/border-radius:\s*50%/);
    // Aucune ombre portee : une ombre dure est exactement ce qu'on ne veut pas.
    expect(corps).not.toMatch(/box-shadow/);
    expect(corps).not.toMatch(/filter:\s*blur/);
  });

  it("le degrade est CONTINU du centre au bord : aucun saut d'opacite", () => {
    expect(ARRETS.length).toBeGreaterThanOrEqual(3);
    // Les positions montent strictement, dans l'ordre du source.
    for (let i = 1; i < ARRETS.length; i++) {
      expect(ARRETS[i].position).toBeGreaterThan(ARRETS[i - 1].position);
    }
    // Aucun saut brutal entre deux arrets voisins : le maximum observe est de
    // 14 points d'opacite sur les 20 % de couronne interieure (0 -> 8 -> 20 ->
    // 34). Un arret « dur » (0 -> 34 d'un coup) ferait une arete visible.
    for (let i = 1; i < ARRETS.length; i++) {
      expect(ARRETS[i].alpha - ARRETS[i - 1].alpha).toBeLessThanOrEqual(0.2);
    }
  });

  it("le centre est transparent jusqu'au bord du disque : la lueur ne le peint pas", () => {
    // `::before` est un ENFANT du disque : il se peint au-dessus de son fond.
    // La couronne ne doit donc commencer qu'APRES le bord du disque (168 px sur
    // 256 px = 65,6 %, arrondi a 66 %), sinon elle recouvrirait l'objet.
    const bordDisque = (ENVELOPE_RING_PX / (ENVELOPE_RING_PX + ENVELOPE_MAX_PX)) * 100;
    expect(bordDisque).toBeGreaterThan(65);
    expect(bordDisque).toBeLessThan(67);
    const transparents = ARRETS.filter((a) => a.alpha === 0);
    const dernierTransparent = transparents[transparents.length - 1];
    expect(dernierTransparent.position).toBe(66);
  });
});

// ---------------------------------------------------------------------------
describe("3. le halo reste DERRIERE l'objet, sans elargir ni faire defiler", () => {
  it("la boite est ABSOLUE : elle ne participe pas a la mise en page", () => {
    const corps = bloc(CSS, ".vocal-orb::before {");
    expect(corps).toMatch(/position:\s*absolute/);
    // L'objet lumineux est le referentiel : la boite deborde autour de lui.
    const orb = bloc(CSS, ".vocal-orb {");
    expect(orb).toMatch(/position:\s*relative/);
  });

  it("le plein ecran ne defile pas et la barre de saisie garde sa largeur", () => {
    expect(bloc(CSS, ".pilot-vocal-active {")).toMatch(/overflow:\s*hidden/);
    // Largeur et marge de la saisie : inchangees (le halo ne les touche pas).
    const saisie = bloc(CSS, ".vocal-input {");
    expect(saisie).toMatch(/width:\s*min\(720px, calc\(100vw - 32px\)\)/);
    expect(saisie).toMatch(/margin:\s*0 auto 16px/);
  });
});

// ---------------------------------------------------------------------------
describe("4. l'enveloppe reste pilotee par la voix (plus fort = plus large)", () => {
  it("l'extension et l'intensite montent avec l'energie de la voix", () => {
    let precedente = envelopeFromEnergy(0);
    for (const e of [0.2, 0.45, 0.7, 0.9, 1]) {
      const courante = envelopeFromEnergy(e);
      expect(courante.extension).toBeGreaterThanOrEqual(precedente.extension);
      expect(courante.alpha).toBeGreaterThanOrEqual(precedente.alpha);
      precedente = courante;
    }
    // Le silence ramene au repos, la voix pleine au maximum : le halo ne reste
    // jamais fige a sa taille de repos.
    expect(envelopeFromEnergy(0).extension).toBe(ENVELOPE_MIN_PX);
    expect(envelopeFromEnergy(1).extension).toBe(ENVELOPE_MAX_PX);
    expect(envelopeFromEnergy(1).extension).toBeGreaterThan(
      envelopeFromEnergy(0).extension,
    );
  });

  it("`super-agent.js` pose les deux variables lues par le CSS (une seule source)", () => {
    const corps = sliceSource(
      SUPER,
      "function vocalApplyEnvelopeEnergy",
      "function vocalStopRhythmMeter",
      200,
    );
    expect(corps).toMatch(/planSpeechEnvelope\(/);
    expect(corps).toMatch(/--vocal-envelope-scale/);
    expect(corps).toMatch(/--vocal-envelope-alpha/);
    // Une seule ecriture par variable dans tout le fichier : aucun second
    // afficheur ne peut regler l'enveloppe en parallele. Deux mentions par
    // variable : la pose (`setProperty`) et le retrait (`removeProperty`).
    for (const variable of ["--vocal-envelope-scale", "--vocal-envelope-alpha"]) {
      const js = SUPER.split(variable).length - 1;
      expect(js, `${variable} dans super-agent.js`).toBe(2);
      const css = CSS.split(variable).length - 1;
      expect(css, `${variable} dans style.css`).toBe(1);
    }
    // Les deux variables sont bien LUES par la regle qui mesure (opacite et
    // echelle), sinon la voix ne piloterait plus rien.
    const mesure = bloc(CSS, ".pilot-vocal.vocal-envelope-live.vocal-state-speaking .vocal-orb::before");
    expect(mesure).toMatch(/opacity:\s*var\(--vocal-envelope-alpha/);
    expect(mesure).toMatch(/transform:\s*scale\(var\(--vocal-envelope-scale/);
  });

  it("le repli CSS est la MEME valeur de repos que le module (aucun chiffre orphelin)", () => {
    const repos = envelopeFromEnergy(0).scale;
    const repli = bloc(CSS, ".pilot-vocal.vocal-envelope-live.vocal-state-speaking .vocal-orb::before");
    const valeur = repli.match(/scale\(var\(--vocal-envelope-scale,\s*([\d.]+)\)\)/);
    expect(valeur, "repli `scale(...)` illisible").toBeTruthy();
    // 204 / 256 = 0,7969 : la couronne fait toujours 36 px au-dela de l'anneau.
    expect(Number(valeur[1])).toBeCloseTo(repos, 4);
  });
});

// ---------------------------------------------------------------------------
describe("5. la phrase d'etat est AU-DESSUS de la barre de saisie", () => {
  const corps = sliceSource(
    SUPER,
    "function buildVocalOverlay",
    "function vocalStatusLine",
    200,
  );

  it("l'ordre du balisage est : disque, phrase, saisie", () => {
    const ordre = [...corps.matchAll(/class="(vocal-[a-z-]+)/g)].map((m) => m[1]);
    expect(ordre).toEqual([
      "vocal-top",
      "vocal-stage",
      "vocal-orb",
      "vocal-halo",
      "vocal-restart",
      "vocal-mic-fix",
      // LOT 1 : les deux colonnes laterales et le portrait de la colonne droite.
      // Revision du 2026-10-29 : le portrait est EN HAUT, AU-DESSUS de la liste
      // (l'ordre du balisage suit l'ordre de l'ecran), et le nom n'est plus une
      // pastille sous l'image : il est sous le bouton-cercle.
      "vocal-side-discussion",
      "vocal-side-tasks",
      "vocal-portrait",
      "vocal-side-body",
      "vocal-status",
      "vocal-input",
    ]);
    const phrase = ordre.indexOf("vocal-status");
    expect(phrase).toBeGreaterThan(ordre.indexOf("vocal-stage"));
    expect(phrase).toBeLessThan(ordre.indexOf("vocal-input"));
  });

  it("l'ancien emplacement est LIBERE : la scene est refermee avant la phrase", () => {
    const scene = sliceSource(
      corps,
      '<div class="vocal-stage">',
      '<div class="vocal-status"',
      20,
    );
    // Trois `</div>` : l'objet lumineux, le conteneur de liste de la colonne de
    // droite, puis la scene. Les deux colonnes sont des `<aside>`, qui se
    // ferment autrement et ne comptent donc pas.
    expect(scene.match(/<\/div>/g)?.length).toBe(3);
    expect(scene.match(/<\/aside>/g)?.length).toBe(2);
    expect(scene).not.toMatch(/vocal-status/);
  });

  it("une seule phrase, meme role et meme annonce, retrouvee par le selecteur existant", () => {
    // Elle est ecrite UNE fois, avec le role d'etat et l'annonce polie.
    const occurrences = corps.match(/vocal-status/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(corps).toMatch(
      /<div class="vocal-status" role="status" aria-live="polite">/,
    );
    // Le code qui la met a jour la cherche par son selecteur, hors de la scene.
    expect(SUPER).toMatch(/querySelector\("\.vocal-status"\)/);
    expect(SUPER).not.toMatch(/querySelector\("\.vocal-stage \.vocal-status"\)/);
  });

  it("elle ne recouvre ni la saisie ni le halo, et ne fait rien defiler", () => {
    const phrase = bloc(CSS, ".vocal-status {");
    // Place : elle est hors du bloc du disque, entre lui et la saisie.
    expect(phrase).toMatch(/margin:\s*8px auto 12px/);
    // Peinte APRES l'enveloppe (la lueur ne passe donc jamais devant le texte).
    expect(phrase).toMatch(/position:\s*relative/);
    // Aucun fond : le texte ne masque pas la lueur non plus.
    expect(phrase).not.toMatch(/background/);
    // Toujours une seule ligne de style : la couleur d'etat ne va pas au texte.
    expect(phrase).toMatch(/color:\s*var\(--text-primary\)/);
    expect(phrase).not.toMatch(/--vocal-state/);
  });
});
