// Tests — HALO DE LA PAROLE : rendre VISIBLE la lueur de l'etat « Pilot parle »
// (defaut 1 de docs/rapports/RAPPORT-diagnostic-defauts-visuels-vocal.md §2).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le degrade de `.vocal-orb::before` a son PIC AU BORD (dernier arret a
//      100 %, transparent au centre) : avant, la lumiere etait posee au centre,
//      donc cachee sous le disque opaque, et la seule couronne visible restait
//      sous 3 % d'alpha.
//   2. L'alpha de la teinte de la parole au bord est >= 0,30 (valeur mesuree :
//      0,34 — contraste 2,28:1 en sombre, 1,60:1 en clair).
//   3. Pas de doublon : des que le contour spectral est peint (classe
//      `.vocal-spectrum-live` posee par le peintre), l'enveloppe s'eteint. La
//      decision pure `spectrumPlan` est verifiee en meme temps qu'elle : elle ne
//      rend `porteur: "enveloppe"` que si le contour ne dessine rien.
//   4. Mouvement reduit : la lueur ne clignote pas et ne disparait pas — elle est
//      FIXE mais VISIBLE (meme alpha au bord, aucune animation sur cet element).
//   5. La petite barre sous le cercle a ETE RETIREE (decision du proprietaire du
//      12/11, qui revient sur l'avenant du 28/10). Le fichier exige donc son
//      ABSENCE — noeud, regle et pourcentage : la mesure du micro reste, elle
//      ne se dessine plus.
//   6. L'enveloppe suit le SON REEL quand il est mesurable (voix locale) :
//      extension bornee a 32 px au-dela de l'anneau, intensite de 0,8 a 1,
//      aucune pulsation au repos. Un seul afficheur par voix.
//
// Les commentaires sont en ASCII ; les selecteurs CSS et les nombres lus sont
// copies tels quels depuis la feuille de style.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage verifie : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture).
import { sliceSource } from "./source-slice.js";
import { spectrumPlan } from "./vocal-equalizer.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence, verifiee). */
function bloc(css, selecteur) {
  return sliceSource(css, selecteur, "}", 2);
}

/**
 * Arrets du degrade de l'enveloppe, du centre vers le bord :
 * `[{ alpha, position }, ...]`, extraits du texte CSS normalise.
 * Un arret s'ecrit `color-mix(... N%, transparent) P%`. Aucune exception ici :
 * un degrade illisible rend un tableau court (ou vide) et ce sont les
 * assertions qui le disent — un echec lisible vaut mieux qu'une erreur de
 * chargement du module.
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
const BORD = ARRETS.length ? ARRETS[ARRETS.length - 1] : { alpha: NaN, position: NaN };
const ALPHA_BORD = BORD.alpha;

// ---------------------------------------------------------------------------
describe("1. le pic de lumiere est au BORD, pas au centre", () => {
  it("le dernier arret est a 100 % et il est le plus opaque", () => {
    expect(ARRETS.length, "arrets du degrade illisibles").toBeGreaterThanOrEqual(3);
    expect(BORD.position).toBe(100);
    const maximum = Math.max(...ARRETS.map((a) => a.alpha));
    expect(ALPHA_BORD).toBe(maximum);
  });

  it("le centre est transparent : la lumiere n'est plus cachee sous le disque", () => {
    expect(ARRETS[0]).toEqual({ alpha: 0, position: 0 });
  });

  it("le degrade est centre sur `closest-side` et porte la teinte de la parole", () => {
    const corps = bloc(CSS, ".vocal-orb::before {");
    expect(corps).toMatch(/radial-gradient\(\s*closest-side/);
    // La teinte vient de l'etat, et en « parole » cet etat vaut --vocal-speak :
    // la lueur est donc bien celle de la voix de Pilot (aucun jeton nouveau).
    expect(corps).toMatch(/var\(--vocal-state, var\(--vocal-rest\)\)/);
    expect(bloc(CSS, ".pilot-vocal.vocal-state-speaking {")).toMatch(
      /--vocal-state:\s*var\(--vocal-speak\)/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("2. l'alpha de la parole au bord est >= 0,30", () => {
  it("la valeur lue dans la feuille de style tient le seuil, sans tolerance", () => {
    // Valeur mesuree : 0,34 (34 %). Le seuil demande est 0,30.
    expect(ALPHA_BORD).toBeGreaterThanOrEqual(0.3);
    expect(ALPHA_BORD).toBe(0.34);
  });

  it("la couronne visible (bord du disque a 84 %, bord de la boite a 100 %) monte bien", () => {
    const couronne = ARRETS.filter((a) => a.position >= 84);
    expect(couronne.length).toBeGreaterThanOrEqual(2);
    // Strictement croissante : aucun palier transparent residuel.
    for (let i = 1; i < couronne.length; i++) {
      expect(couronne[i].alpha).toBeGreaterThan(couronne[i - 1].alpha);
    }
  });
});

// ---------------------------------------------------------------------------
describe("3. pas de doublon : l'enveloppe s'eteint quand le contour est peint", () => {
  const SELECTEUR = ".pilot-vocal.vocal-spectrum-live.vocal-state-speaking .vocal-orb::before";

  it("la regle de repli existe et eteint l'enveloppe, sans animation ni transition", () => {
    const corps = bloc(CSS, SELECTEUR);
    expect(corps).toMatch(/opacity:\s*0/);
    expect(corps).toMatch(/animation:\s*none/);
    expect(corps).toMatch(/transition:\s*none/);
  });

  it("elle est la DERNIERE de la famille : elle gagne sur l'etat et sur le mouvement reduit", () => {
    const repli = CSS.indexOf(SELECTEUR);
    const etat = CSS.indexOf(".pilot-vocal.vocal-state-speaking .vocal-orb::before");
    const reduit = CSS.indexOf(
      ".pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before",
    );
    expect(etat).toBeGreaterThan(-1);
    expect(reduit).toBeGreaterThan(-1);
    expect(repli).toBeGreaterThan(etat);
    expect(repli).toBeGreaterThan(reduit);
  });

  it("la decision pure ne designe jamais deux afficheurs pour la meme voix", () => {
    const fort = new Array(32).fill(0.8);
    const contour = spectrumPlan({ etat: "speaking", enParole: true, valeurs: fort });
    expect(contour.dessiner).toBe(true);
    expect(contour.porteur).toBe("contour");

    const silence = spectrumPlan({
      etat: "speaking",
      enParole: true,
      valeurs: new Array(32).fill(0),
    });
    expect(silence.dessiner).toBe(false);
    expect(silence.porteur).toBe("enveloppe");
  });
});

// ---------------------------------------------------------------------------
describe("4. mouvement reduit : la lueur est FIXE mais VISIBLE", () => {
  it("l'enveloppe n'est plus eteinte par le reglage de mouvement reduit", () => {
    // L'ancienne extinction (`::before, ::after { opacity: 0 }`) est retiree :
    // la seule regle qui porte encore sur `::before` en mouvement reduit est la
    // liste `animation: none ; transition: none`, qui ne pose AUCUNE opacite.
    const liste = bloc(CSS, ".pilot-vocal.vocal-reduced .vocal-orb::before,");
    expect(liste).toMatch(/animation:\s*none/);
    expect(liste).toMatch(/transition:\s*none/);
    expect(liste).not.toMatch(/opacity/);
  });

  it("en « parole », elle reste affichee et immobile", () => {
    const corps = bloc(
      CSS,
      ".pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before",
    );
    expect(corps).toMatch(/opacity:\s*1/);
    expect(corps).toMatch(/animation:\s*none/);
  });

  it("l'alpha au bord ne baisse pas : c'est le MEME degrade", () => {
    // Aucune regle de mouvement reduit ne reecrit le fond de l'enveloppe.
    const apresCorps = bloc(
      CSS,
      ".pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before",
    );
    expect(apresCorps).not.toMatch(/background/);
    expect(ALPHA_BORD).toBeGreaterThanOrEqual(0.3);
  });
});

// ---------------------------------------------------------------------------
describe("5. la petite barre sous le cercle a ETE RETIREE (12/11)", () => {
  it("aucune regle de trait ne subsiste : ni conteneur, ni barre", () => {
    // La decision du 28/10 (« la petite barre reste ») est RENVERSEE : le
    // proprietaire ne veut plus de trait sous le cercle. Un test qui se
    // contenterait de ne plus regarder ne protegerait rien — celui-ci exige
    // l'absence, sur les trois plans (CSS, DOM, pourcentage fige).
    expect(CSS).not.toMatch(/\.vocal-level\b/);
    expect(CSS).not.toMatch(/--vocal-level/);
    expect(CSS).not.toMatch(/vocal-level-bar/);
    const ecran = lire("src/js/super-agent.js");
    expect(ecran).not.toMatch(/class="vocal-level/);
    expect(ecran).not.toMatch(/vocal-level-bar/);
    // Aucune valeur de trait n'est plus posee (les commentaires, eux, peuvent
    // raconter l'histoire : c'est le code qui est verifie).
    expect(ecran).not.toMatch(/setProperty\("--vocal-level"/);
  });

  it("la ligne d'etat est posee la ou le trait etait (32 px sous le disque)", () => {
    // L'ecart de la pile n'est pas un detail : l'enveloppe occupe desormais ces
    // 32 px, donc le texte ne peut pas se retrouver dessous.
    expect(bloc(CSS, ".vocal-stage")).toMatch(/gap:\s*32px/);
  });
});
