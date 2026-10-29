// Tests — deux evolutions de l'ecran Vocal (28/10) : le RAYON DU HALO et la
// PLACE de la phrase d'etat. `docs/rapports/RAPPORT-halo-rayon-et-etat.md`.
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le halo de la voix atteint un RAYON DE 128 px (boite de 256 px,
//      `inset: -44px`), et c'est la decision retenue : la boite tient dans la
//      hauteur MINIMALE de la fenetre, donc le repli a 64 px n'a pas lieu.
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

/** Disque de l'objet lumineux, en pixels (mesure de la feuille de style). */
const DISQUE_PX = 168;

/** Boite de l'enveloppe, deduite du disque et de l'extension pleine. */
const BOITE_HALO_PX = DISQUE_PX + 2 * ENVELOPE_MAX_PX;

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
describe("1. le halo atteint un rayon de 128 px (et non 64)", () => {
  it("l'extension retenue donne bien 84 + 44 = 128 px de rayon", () => {
    // Le disque fait 168 px de boite, donc 84 px de rayon : c'est le point de
    // depart de la couronne lumineuse.
    expect(ENVELOPE_RING_PX).toBe(DISQUE_PX / 2);
    expect(ENVELOPE_RING_PX + ENVELOPE_MAX_PX).toBe(128);
    // 44 px au-dela de l'anneau, et non les 32 px d'avant (ni 64 px de rayon
    // total : le repli n'a pas lieu, cf. le test suivant).
    expect(ENVELOPE_MAX_PX).toBe(44);
  });

  it("la feuille de style porte la meme boite : 256 px, `inset: -44px`", () => {
    const corps = bloc(CSS, ".vocal-orb::before {");
    expect(corps).toMatch(/inset:\s*-44px/);
    // 168 + 2 x 44 = 256 px de boite, donc 128 px de rayon.
    expect(BOITE_HALO_PX).toBe(256);
  });

  it("128 px tient dans la hauteur MINIMALE de la fenetre (pas de repli a 64)", () => {
    // La decision se tranche sur ce seul critere mesurable : la boite du halo
    // doit tenir dans la plus petite fenetre autorisee, sinon elle ecraserait
    // le reste et c'est 64 px de rayon qu'il faudrait retenir.
    const mini = CONF.app.windows[0].minHeight;
    expect(mini).toBeGreaterThan(0);
    expect(BOITE_HALO_PX).toBeLessThanOrEqual(mini);
    // Et il reste de la place pour la barre haute, la phrase et la saisie.
    expect(mini - BOITE_HALO_PX).toBeGreaterThanOrEqual(120);
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
    // La couronne ne doit donc commencer qu'APRES le bord du disque (84 px sur
    // 128 px = 65,6 %, arrondi a 66 %), sinon elle recouvrirait l'objet.
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
    // 102 / 128 = 0,7969 : la couronne fait toujours 18 px au-dela de l'anneau.
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
    // Deux `</div>` : l'objet lumineux, puis la scene. La phrase n'est donc
    // plus l'enfant du bloc du disque — aucun noeud orphelin, aucun espace
    // reserve (le `gap` ne sert plus qu'au bouton de depannage, masque).
    expect(scene.match(/<\/div>/g)?.length).toBe(2);
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
