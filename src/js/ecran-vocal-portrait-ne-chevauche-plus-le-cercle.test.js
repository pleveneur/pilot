/**
 * Verrou GEOMETRIQUE du constat du proprietaire (2026-11-14) : « son portrait
 * s'affiche bien, mais il chevauche le cercle situe au-dessus ».
 *
 * CE N'EST PAS UN TEST DE CLASSE CSS. Il pose des rectangles et verifie une
 * INEGALITE de geometrie, la seule qui compte a l'ecran :
 *
 *     haut(medaillon)  >=  bas(disque) + couronne de la lueur
 *
 * c'est-a-dire, en clair : le personnage commence la ou la LUEUR du cercle
 * finit. La lueur n'est pas un decor abstrait : `.vocal-orb::before` est un
 * disque qui deborde du cercle de `--vocal-crown` (`88 / 336` du disque) sur
 * TOUS les cotes, donc de `crown` px SOUS l'anneau. Avec l'ancien ecart fixe de
 * 12 px, elle recouvrait le haut du portrait sur 17,58 px au repos — et jusqu'a
 * ~60 px en pleine voix (mesure du banc, disque de 276 px, fenetre 1424 x 905).
 *
 * MESURES DU BANC (Chrome headless, `style.css` du projet, viewport 1424 x 905) :
 *   AVANT : orb 146..422 | medaillon 434..710 | ecart 12 px | lueur jusqu'a 494,29
 *           -> recouvrement de la lueur sur le portrait : 17,58 px
 *   APRES : orb 115,86..391,86 | medaillon 464,14..740,14 | ecart 72,28 px
 *           -> degagement de 42,71 px (la lueur s'arrete a 421,44)
 *
 * Ce fichier echoue si :
 *  1. l'ecart peint redevient inferieur a la couronne de la lueur (le portrait
 *     chevauche de nouveau le cercle) ;
 *  2. l'ecart redevient la constante de 12 px qui a cause le defaut ;
 *  3. le budget du medaillon et la feuille de style ne lisent plus le MEME
 *     chiffre (deux ecarts differents = la composition deborde de sa rangee) ;
 *  4. le cercle n'est plus exactement centre quand il n'y a pas d'image.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_PORTRAIT_AIR_TOP_PX,
  VOCAL_PORTRAIT_CROWN_RATIO,
  VOCAL_PORTRAIT_FRAME_PX,
  VOCAL_PORTRAIT_NAME_PX,
  VOCAL_PORTRAIT_PX,
  VOCAL_STAGE_AIR_PX,
  planVocalSides,
  vocalPortraitAirTopPx,
  vocalPortraitSize,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** La couronne de la lueur, telle que la feuille de style la calcule. */
const couronne = (disque) => (disque * 88) / 336;

/**
 * Les disques REELLEMENT vus a l'ecran : le disque de la conception (336), le
 * disque reel depuis la rectification du 2026-11-14 (276), ceux des sept fenetres
 * du tableau de la conception, et les bornes du `clamp` (100 px).
 */
const DISQUES = [336, 276, 217.2, 314.3, 251.3, 335.3, 188.3, 151.6, 100];

describe("1. LA GEOMETRIE : le medaillon commence ou la lueur finit", () => {
  it("pour chaque disque reel, haut(medaillon) >= bas(disque) + couronne de la lueur", () => {
    // REGLE PROTEGEE : le chevauchement. On pose le rectangle du disque, celui de
    // sa lueur, celui du medaillon, et on compare des NOMBRES.
    for (const disque of DISQUES) {
      const basDuDisque = 400; // origine arbitraire : seule la DIFFERENCE compte.
      const basDeLaLueur = basDuDisque + couronne(disque);
      const hautDuMedaillon = basDuDisque + vocalPortraitAirTopPx(disque, 1080);
      expect(
        hautDuMedaillon,
        `disque ${disque} px : le medaillon chevauche la lueur de ${(
          basDeLaLueur - hautDuMedaillon
        ).toFixed(2)} px`,
      ).toBeGreaterThanOrEqual(basDeLaLueur);
    }
  });

  it("l'ecart n'est plus la constante de 12 px qui a cause le defaut", () => {
    // REGLE PROTEGEE : la valeur qui chevauchait. 12 px etait un ecart FIXE,
    // insuffisant des que le disque depasse 45,8 px de couronne (45,8 x 336 / 88).
    expect(VOCAL_PORTRAIT_AIR_TOP_PX).toBe(12); // le PLANCHER, quand le disque est inconnu
    const disqueReel = 276;
    expect(vocalPortraitAirTopPx(disqueReel, 1080)).toBeGreaterThan(12);
    // Et le chiffre mesure pour le disque reel : ceil(276 x 88 / 336) = 73 px.
    expect(vocalPortraitAirTopPx(disqueReel, 1080)).toBe(73);
    expect(vocalPortraitAirTopPx(336, 1080)).toBe(88);
    expect(vocalPortraitAirTopPx(151.6, 1080)).toBe(40);
  });

  it("la couronne est lue dans la feuille de style : un seul rapport 88 / 336", () => {
    // REGLE PROTEGEE : l'unicite de la couronne. Le jeton CSS et le budget
    // portent le MEME rapport ; deux rapports differents feraient peindre une
    // lueur plus grande que l'ecart calcule.
    expect(VOCAL_PORTRAIT_CROWN_RATIO).toBeCloseTo(88 / 336, 12);
    expect(CSS).toMatch(/--vocal-crown:\s*calc\(var\(--vocal-orb-size\) \* 88 \/ 336\)/);
    // Et la lueur deborde bien de toute la couronne, vers le BAS comme ailleurs.
    const halo = sliceSource(CSS, ".vocal-orb::before", "\n}", 40);
    expect(halo).toMatch(/inset:\s*calc\(var\(--vocal-crown\) \* -1\)/);
  });

  it("l'ecart se reduit plutot que d'ecraser le personnage, jamais sous le plancher", () => {
    // REGLE PROTEGEE : la contrepartie. Dans une rangee etroite, prendre toute la
    // couronne ferait tomber le medaillon sous sa taille confortable (96 px) : dans
    // ce cas l'ECART cede, et il ne descend jamais sous 12 px. Aucune valeur
    // arbitraire : la borne est le plancher documente.
    for (const [rangee, disque] of [
      [313, 151.6],
      [369, 188.3],
      [465, 251.3],
      [561, 314.3],
      [693, 336],
      [873, 336],
    ]) {
      const air = vocalPortraitAirTopPx(disque, rangee);
      const taille = vocalPortraitSize({ orbSize: disque, stageHeight: rangee });
      expect(air, `rangee ${rangee}`).toBeGreaterThanOrEqual(VOCAL_PORTRAIT_AIR_TOP_PX);
      expect(air, `rangee ${rangee}`).toBeLessThanOrEqual(Math.ceil(couronne(disque)));
      // Si l'ecart a du ceder, c'est que la place ne portait pas la taille
      // confortable entiere : le medaillon, lui, ne descend jamais SOUS elle.
      if (air < Math.ceil(couronne(disque))) {
        expect(taille, `rangee ${rangee} : medaillon ecrase`).toBeGreaterThanOrEqual(
          VOCAL_PORTRAIT_PX,
        );
      }
      // Dans tous les cas, la composition tient dans la rangee exactement.
      expect(
        VOCAL_STAGE_AIR_PX + disque + air + taille + VOCAL_PORTRAIT_NAME_PX + 8 + 12,
        `rangee ${rangee} : la composition deborde`,
      ).toBeLessThanOrEqual(rangee + 0.5);
    }
  });
});

describe("2. LE MEME CHIFFRE des deux cotes : budget et feuille de style", () => {
  it("le plan publie l'ecart peint, et `vocalSyncSides` l'ecrit dans le jeton", () => {
    // REGLE PROTEGEE : une seule verite. Si le plan calculait l'ecart et que la
    // feuille de style en peignait un autre, la composition deborderait de sa
    // rangee sans qu'aucun test de nombre ne s'en apercoive.
    const plan = planVocalSides({
      width: 1440,
      height: 900,
      orbSize: 336,
      stageHeight: 693,
      hasPortrait: true,
    });
    expect(plan.portraitAir).toBe(vocalPortraitAirTopPx(336, 693));
    expect(plan.portraitAir).toBe(88);
    const sync = sliceSource(SUPER, 'setProperty("--vocal-portrait-gap"', ";", 20);
    expect(sync).toContain("${plan.portraitAir}px");
    // Et la feuille de style LIT ce jeton, avec la couronne en repli (overlay
    // statique, JavaScript absent) : dans les deux cas le portrait ne chevauche
    // pas, puisque la couronne est le maximum.
    const portrait = sliceSource(CSS, ".vocal-portrait {", "\n}", 60);
    expect(portrait).toMatch(
      /margin-block-start:\s*var\(--vocal-portrait-gap,\s*var\(--vocal-crown\)\)/,
    );
    // La composition est celle que le budget compte : couronne + medaillon + 8 px
    // + nom + air du bas.
    expect(VOCAL_PORTRAIT_FRAME_PX).toBe(
      12 + 8 + VOCAL_PORTRAIT_NAME_PX + 12 + VOCAL_STAGE_AIR_PX,
    );
  });

  it("le bloc du personnage porte l'ecart REEL, pas le plancher", () => {
    // REGLE PROTEGEE : le bloc peint. Un bloc au plancher alors que l'ecart peint
    // vaut 88 px laisserait 76 px de la rangee hors du budget.
    const plan = planVocalSides({
      width: 1440,
      height: 900,
      orbSize: 336,
      stageHeight: 693,
      hasPortrait: true,
    });
    expect(plan.portraitBlock).toBe(
      plan.portraitAir + plan.portraitSize + 8 + VOCAL_PORTRAIT_NAME_PX + 12,
    );
  });
});

describe("3. LE CERCLE SANS IMAGE reste EXACTEMENT centre", () => {
  it("sans personnage, l'air du haut egale celui du bas, et l'ecart n'existe pas", () => {
    // REGLE PROTEGEE : le centrage du cercle. L'ecart ajoute ne doit pas pousser
    // le disque vers le haut quand personne ne s'affiche dessous : la composition
    // se reduit au disque, et ses deux airs restent egaux.
    for (const [largeur, hauteur, disque, rangee] of [
      [1440, 900, 276, 693],
      [1280, 800, 275, 593],
      [720, 520, 151.6, 313],
    ]) {
      for (const hasPortrait of [false, true]) {
        const plan = planVocalSides({
          width: largeur,
          height: hauteur,
          orbSize: disque,
          stageHeight: rangee,
          hasPortrait,
        });
        // La composition centree par la grille, dans les deux cas : le disque,
        // puis le bloc du personnage (0 s'il n'y en a pas). L'ecart au cercle ne
        // pese donc PAS sur le centrage du disque quand personne n'est dessous.
        const composition = disque + plan.portraitBlock;
        expect(
          composition,
          `${largeur} x ${hauteur} : la composition deborde de sa rangee`,
        ).toBeLessThanOrEqual(rangee);
        if (!hasPortrait) {
          expect(plan.portraitSize).toBe(0);
          expect(plan.portraitBlock).toBe(0);
          // Aucune place payee pour un personnage absent : ni bloc, ni ecart.
          expect(plan.portraitAir).toBe(0);
        }
      }
    }
  });

  it("le disque nu est centre par la grille : aucune marge en haut du disque", () => {
    // REGLE PROTEGEE : le centrage ne vient pas d'un decalage ecrit. Le cercle
    // n'a ni `top`, ni `margin-top`, ni marge negative — c'est la grille qui le
    // centre (verrou du point 7, repris ici pour que ce fichier se suffise).
    const disque = sliceSource(CSS, ".vocal-orb {", "\n}", 60);
    expect(disque).not.toMatch(/(^|[^-])top:/);
    expect(disque).not.toMatch(/margin-top:/);
    expect(disque).not.toMatch(/transform:/);
  });
});
