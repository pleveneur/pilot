// Tests — POINT 7 DES REMARQUES DU PROPRIETAIRE : « le cercle en haut, a sa
// taille, le personnage DESSOUS, sur le MEME AXE VERTICAL, non rogne, avec une
// marge reelle. Sans image, le cercle reste au milieu. »
// Rapport : docs/rapports/RAPPORT-ecran-vocal-point7-cercle-photo.md.
//
// Ce fichier est le verrou du DEPLACEMENT lui-meme. Il ne mesure pas la taille
// du medaillon (c'est `vocal-portrait-detache.test.js`), il empeche le retour en
// arriere : que le personnage repasse au-dessus du cercle, que le cercle cesse
// d'etre centre quand il est seul, ou que la hauteur de la rangee redevienne une
// constante au lieu d'une mesure.
//
//   P1 — UNE composition, UN enfant de grille : `.vocal-center` est pose sur la
//        piste du milieu et porte le centrage vertical ; `.vocal-orb` n'a plus
//        aucun placement propre.
//   P2 — AUCUN decalage ecrit : le cercle ne bouge que par le centrage de la
//        composition (ni `top`, ni `transform`, ni marge negative, ni position
//        absolue).
//   P3 — SANS personnage, le cercle est au milieu : le portrait et son nom sont
//        masques, la composition se reduit au disque.
//   P4 — la HAUTEUR DE RANGEE est MESUREE (`grid-template-rows`, premiere piste)
//        avec un repli qui rejoue la meme constante, puis passee au plan.
//   P5 — la TAILLE du medaillon ne vient pas de la largeur : elle ne change pas
//        quand seule la largeur change.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import { planVocalSides, VOCAL_STAGE_RESERVED_PX } from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Regle CSS d'un selecteur, accolades exclues (decoupage verifie). */
function regle(selecteur, mini = 20) {
  return sliceSource(CSS, `${selecteur} {`, "}", mini);
}

const CENTRE = regle(".vocal-center");
const DISQUE = regle(".vocal-center > .vocal-orb");
const SCENE = regle(".vocal-stage", 40);

describe("P1 — une seule composition, un seul enfant de grille", () => {
  it("`.vocal-center` occupe la piste du milieu et centre la composition", () => {
    // La composition EST l'enfant de la grille : le disque n'est plus place par
    // la scene, il est le premier element de cette colonne flexible.
    expect(CENTRE).toMatch(/grid-area:\s*1\s*\/\s*2/);
    expect(CENTRE).toMatch(/display:\s*flex/);
    expect(CENTRE).toMatch(/flex-direction:\s*column/);
    expect(CENTRE).toMatch(/align-items:\s*center/);
    // `justify-content: center` EST le centrage : avec un personnage, la
    // composition entiere descend de la moitie de sa hauteur et le cercle
    // remonte d'autant ; sans personnage, elle se reduit au disque, qui est donc
    // exactement au milieu.
    expect(CENTRE).toMatch(/justify-content:\s*center/);
    // Elle prend toute la hauteur de la rangee, sinon elle ne pourrait pas se
    // centrer dedans.
    expect(CENTRE).toMatch(/align-self:\s*stretch/);
  });

  it("le disque n'a plus AUCUN placement propre : ni piste, ni marge, ni position", () => {
    // La seule regle qui nomme encore le disque comme enfant de la composition ne
    // dit qu'une chose : il ne se comprime ni ne s'etire.
    expect(DISQUE.trim()).toMatch(/^[^{]*\{\s*flex:\s*0 0 auto;\s*$/);
    // Et aucune regle de la feuille de style ne le replace dans la grille : s'il
    // revenait sur une piste, ce serait de nouveau lui qui serait centre, et le
    // personnage n'aurait plus de place « sous » lui.
    expect(CSS).not.toMatch(/\.vocal-orb\s*\{[^}]*grid-area/);
    expect(CSS).not.toMatch(/\.vocal-orb\s*\{[^}]*grid-column/);
    expect(CSS).not.toMatch(/\.vocal-orb\s*\{[^}]*grid-row/);
  });

  it("la scene garde ses trois pistes et son centrage vertical", () => {
    expect(SCENE).toMatch(
      /grid-template-columns:\s*var\(--vocal-side\)\s+var\(--vocal-orb-size\)\s+var\(--vocal-side\)/,
    );
    expect(SCENE).toMatch(/align-items:\s*center/);
    expect(SCENE).toMatch(/justify-items:\s*center/);
    // Deux rangees : la scene (1fr) et la ligne de depannage du micro (auto,
    // hauteur 0 quand elle est masquee).
    expect(SCENE).toMatch(/grid-template-rows:\s*1fr\s+auto/);
  });
});

describe("P2 — aucun decalage ecrit : le cercle ne bouge que par le centrage", () => {
  it("ni `top`, ni `bottom`, ni `transform`, ni marge negative dans la composition", () => {
    for (const bloc of [CENTRE, DISQUE]) {
      expect(bloc).not.toMatch(/(^|[^-])top:/);
      expect(bloc).not.toMatch(/(^|[^-])bottom:/);
      expect(bloc).not.toMatch(/transform:/);
      expect(bloc).not.toMatch(/margin[^:]*:\s*-\d/);
      expect(bloc).not.toMatch(/position:\s*absolute/);
    }
    // Aucune marge en HAUT du medaillon pour « compenser » : l'ecart de 12 px est
    // un ecart au cercle, pas un reglage de centrage.
    expect(regle(".vocal-portrait", 40)).toMatch(/margin-block-start:\s*12px/);
  });

  it("le balisage ne pose aucun style en ligne sur le disque", () => {
    const build = sliceSource(SUPER, "function buildVocalOverlay()", "function vocalStatusLine", 40);
    // Le disque est nu dans le document : c'est la feuille de style qui decide,
    // et elle ne decide rien d'autre que sa taille.
    expect(build).toContain('<div class="vocal-center">');
    expect(build).not.toMatch(/<div class="vocal-orb"[^>]*style=/);
    expect(build).not.toMatch(/<div class="vocal-center"[^>]*style=/);
    expect(build).not.toMatch(/<img class="vocal-portrait"[^>]*style=/);
  });
});

describe("P3 — sans personnage, le cercle est au milieu", () => {
  it("le portrait et son nom sont MASQUES : la composition se reduit au disque", () => {
    // L'image porte `hidden` dans le balisage : entre la construction de
    // l'overlay et la premiere lecture du personnage, elle ne pese rien.
    const build = sliceSource(SUPER, "function buildVocalOverlay()", "function vocalStatusLine", 40);
    expect(build).toMatch(/<img class="vocal-portrait"[^>]*hidden/);
    // `applyVocalPortrait` retire l'image ET la legende quand aucune source
    // n'existe : un noeud masque ne participe pas au centrage.
    const applique = sliceSource(SUPER, "function applyVocalPortrait(racine)", "function ", 40);
    expect(applique).toMatch(/img\.hidden = false/);
    expect(applique).toMatch(/img\.hidden = true/);
    expect(applique).toMatch(/legende\.hidden = !source/);
    // Et la taille du medaillon tombe a 0, donc aucune place n'est revendiquee.
    expect(planVocalSides({ width: 1280, height: 800, orbSize: 336 }).portraitSize).toBe(0);
    expect(VOCAL_STAGE_RESERVED_PX).toBe(207);
  });

  it("la composition ne peut pas deborder de la rangee : pas d'`overflow` cache ni de hauteur figee", () => {
    // Un `overflow: hidden` sur la composition aurait rogne le disque quand la
    // place manque ; une hauteur fixe l'aurait ecrase. Aucun des deux.
    expect(CENTRE).not.toMatch(/overflow/);
    expect(CENTRE).not.toMatch(/(^|[^-])height:/);
    // La largeur de la composition EST celle du disque : le medaillon ne peut
    // donc pas la rendre plus large que le cercle qu'il surmonte.
    expect(CENTRE).toMatch(/width:\s*var\(--vocal-orb-size\)/);
  });
});

describe("P4 — la hauteur de rangee est MESUREE, jamais deduite", () => {
  it("`vocalStageRowHeight` lit la PREMIERE piste de `.vocal-stage`", () => {
    const mesure = sliceSource(SUPER, "function vocalStageRowHeight()", "function vocalSyncSides", 40);
    expect(mesure).toMatch(/querySelector\("\.vocal-stage"\)/);
    expect(mesure).toMatch(/getComputedStyle\(scene\)\.gridTemplateRows/);
    expect(mesure).toMatch(/split\(\/\\s\+\/\)\[0\]/);
    // Le repli rejoue la MEME constante que le budget : aucune valeur en dur.
    expect(mesure).toContain("VOCAL_STAGE_RESERVED_PX");
    expect(mesure).toMatch(/Math\.max\(0, hauteur - VOCAL_STAGE_RESERVED_PX\)/);
    expect(mesure).toMatch(/premiere > 0/);
  });

  it("`vocalSyncSides` la passe au plan et n'ecrit la taille qu'UNE fois", () => {
    const sync = sliceSource(SUPER, "function vocalSyncSides()", "\n}\n", 40);
    expect(sync).toMatch(/stageHeight:\s*vocalStageRowHeight\(\)/);
    expect(sync).toMatch(/orbSize:\s*vocalOrbSizePx\(\)/);
    // Un seul point d'ecriture, et c'est la valeur MESUREE par le plan.
    expect((sync.match(/setProperty\("--vocal-portrait-size"/g) || []).length).toBe(1);
    expect(sync).toMatch(/setProperty\("--vocal-portrait-size", `\$\{plan\.portraitSize\}px`\)/);
    // La feuille de style lit ce jeton, avec le plancher en repli.
    expect(regle(".vocal-portrait", 60)).toMatch(
      /width:\s*var\(--vocal-portrait-size,\s*96px\)/,
    );
  });
});

describe("P5 — la taille du medaillon ne vient pas de la largeur", () => {
  it("a hauteur de rangee egale, changer la largeur ne change pas le medaillon", () => {
    const base = { orbSize: 336, stageHeight: 693, hasPortrait: true };
    const etroit = planVocalSides({ ...base, width: 1024, height: 900 });
    const large = planVocalSides({ ...base, width: 1920, height: 1080 });
    // La colonne change (plafond de largeur), le medaillon NON : il occupait
    // 183 px a 1024 et 275 a 1440 du temps ou il vivait dans la colonne.
    expect(etroit.portraitSize).toBe(288);
    expect(large.portraitSize).toBe(288);
    expect(etroit.track).toBeLessThan(large.track);
    // Et a largeur egale, c'est la HAUTEUR qui decide : deux rangees differentes,
    // deux medaillons differents.
    const court = planVocalSides({ width: 1440, height: 900, orbSize: 336, stageHeight: 465, hasPortrait: true });
    expect(court.portraitSize).toBe(65);
    expect(court.portraitSize).toBeLessThan(large.portraitSize);
  });

  it("le budget ne retranche plus le personnage a aucune colonne", () => {
    // La liste des taches ne paie plus le medaillon : c'est ce qui a rendu au
    // proprietaire les rangees qu'il voyait disparaitre. Verrou de la contrepartie
    // du deplacement (le detail chiffre est dans `vocal-portrait-detache.test.js`).
    const sans = planVocalSides({ width: 1440, height: 900, orbSize: 336, stageHeight: 693 });
    const avec = planVocalSides({
      width: 1440,
      height: 900,
      orbSize: 336,
      stageHeight: 693,
      hasPortrait: true,
    });
    expect(avec.portraitSize).toBeGreaterThan(0);
    expect(avec.listHeight).toBe(sans.listHeight);
    expect(avec.columnHeight).toBe(sans.columnHeight);
  });
});
