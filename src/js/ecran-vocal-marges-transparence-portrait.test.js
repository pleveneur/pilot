/**
 * Tests — LES TROIS REMARQUES DU PROPRIETAIRE DU 2026-11-02 SUR L'ECRAN VOCAL.
 *
 * Trois phrases, trois defauts, et un seul endroit pour chacun :
 *
 *   1. « le contenu touche le cadre » — le dernier message de la colonne de
 *      gauche et la derniere tache de la colonne de droite s'arretaient PILE sur
 *      le filet, et le medaillon du personnage touchait le haut du cadre. L'air
 *      est desormais pose (`padding-block-end` sur les deux colonnes,
 *      `margin-block-start` sur le portrait), et il est COMPTE dans le budget
 *      (`VOCAL_SIDE_AIR_PX`, `VOCAL_PORTRAIT_AIR_TOP_PX`) pour qu'aucune ligne
 *      promise ne soit rognee.
 *
 *   2. « la transparence ne se voit pas » — les deux colonnes n'avaient AUCUN
 *      fond : un filet de 1 px devant un `--bg-app` uni ne laisse rien voir a
 *      travers. Elles portent maintenant une surface de VERRE, teintee par le
 *      theme actif (`--vocal-glass`, un melange de `--glass-tint`) et floutee,
 *      avec les deux lavis du calque derriere. DEUXIEME PASSE du meme jour : le
 *      lavis etait fait de `--surface-floating`, la MEME famille que la teinte
 *      du panneau — les deux se compensaient et le verre se lisait comme le
 *      fond. Il vient desormais du TEXTE du theme (voir
 *      `ecran-vocal-transparence-visible.test.js`, qui mesure au pixel que la
 *      lumiere traverse reellement le panneau).
 *
 *   3. « le portrait doit etre environ trois fois plus grand » — le medaillon
 *      n'est plus fige a 96 px : `vocalPortraitSize` le MESURE (la place dans le
 *      cadre, la hauteur qui laisse deux rangees et leurs deux en-tetes a la
 *      liste, la cible de trois fois le plancher) et `vocalSyncSides` ecrit le
 *      resultat dans `--vocal-portrait-size`. Un seul chiffre, lu par la feuille
 *      de style et par le budget.
 *
 * Plus la consequence des trois : DANS L'ETAT NU, le cadre et la surface de la
 * colonne de droite s'effacent aussi (il ne restait qu'un rectangle de verre vide
 * autour du personnage) — sans jamais masquer le portrait, son nom, ni la zone de
 * saisie.
 *
 * Aucun navigateur n'est requis : lecture des sources (fins de ligne
 * normalisees, cf. quality-gate § 3.4) et appels des modules reels sur des
 * valeurs pures.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import { GLASS_SURFACE_SELECTOR } from "./glass-theme.js";
import {
  VOCAL_PORTRAIT_AIR_PX,
  VOCAL_PORTRAIT_AIR_TOP_PX,
  VOCAL_PORTRAIT_BLOCK_PX,
  VOCAL_PORTRAIT_EDGE_PX,
  VOCAL_PORTRAIT_GAP_PX,
  VOCAL_PORTRAIT_MIN_LIST_PX,
  VOCAL_PORTRAIT_NAME_PX,
  VOCAL_PORTRAIT_PX,
  VOCAL_PORTRAIT_TARGET_PX,
  VOCAL_SIDE_AIR_PX,
  VOCAL_SIDE_FRAME_PX,
  VOCAL_SIDE_FIXED_PX,
  VOCAL_SIDE_BORDER_PX,
  planVocalDiscussion,
  planVocalSides,
  vocalPortraitBlockSize,
  vocalPortraitSize,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

/** Les commentaires CSS d'un bloc, neutralises (ils NOMMENT ce qu'on ne touche pas). */
const sansCommentaires = (texte) => texte.replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps d'une regle CSS, accolades exclues (decoupage verifie). */
const regle = (selecteur, mini = 10) => sliceSource(CSS, `${selecteur} {`, "}", mini);

/** Corps d'une fonction de PREMIER niveau de `super-agent.js` (accolade en colonne 1). */
const corps = (debut) => sliceSource(SUPER, debut, "\n}\n", 40);

// ---------------------------------------------------------------------------
describe("R1 — le contenu ne touche plus le cadre", () => {
  it("les deux colonnes portent 12 px d'air en bas, la meme valeur que le budget", () => {
    expect(VOCAL_SIDE_AIR_PX).toBe(12);
    for (const colonne of [".vocal-side-discussion", ".vocal-side-tasks"]) {
      // Regle PROPRE a chaque colonne : le budget est par colonne, l'air aussi.
      const corpsColonne = sliceSource(CSS, `${colonne} {`, "\n}", 300);
      expect(corpsColonne, colonne).toMatch(/padding-block-end:\s*12px/);
      expect(corpsColonne, colonne).toContain(`${VOCAL_SIDE_AIR_PX}px`);
    }
  });

  it("l'air est COMPTE : le titre plus l'air font l'en-tete du budget", () => {
    // Le titre entier (14 + 11 + 14) + l'air du bas (12) + les deux filets du
    // cadre (2) = 53. `vocal-colonne-discussion.test.js` rejoue le tableau des
    // sept hauteurs ; ici, on tient la SOMME.
    expect(VOCAL_SIDE_FIXED_PX).toBe(39 + VOCAL_SIDE_AIR_PX + VOCAL_SIDE_BORDER_PX);
    expect(VOCAL_SIDE_FIXED_PX).toBe(53);
    // Et l'air ne mange pas une ligne promise : a 512 px, la colonne en montre 12.
    expect(planVocalDiscussion(512, 320).lines).toBe(12);
    expect(planVocalDiscussion(VOCAL_SIDE_FIXED_PX, 320).lines).toBe(0);
  });

  it("le medaillon ne touche plus le haut du cadre : 12 px d'air, comptes", () => {
    expect(VOCAL_PORTRAIT_AIR_TOP_PX).toBe(VOCAL_SIDE_AIR_PX);
    const portrait = regle(".vocal-portrait", 60);
    expect(portrait).toMatch(/margin-block-start:\s*12px/);
    expect(portrait).toContain(`${VOCAL_PORTRAIT_AIR_TOP_PX}px`);
    // Le bloc du personnage porte l'air du haut dans son total : la liste ne
    // perd pas une rangee de plus que ce qui est peint.
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(
      VOCAL_PORTRAIT_AIR_TOP_PX +
        VOCAL_PORTRAIT_PX +
        VOCAL_PORTRAIT_GAP_PX +
        VOCAL_PORTRAIT_NAME_PX +
        VOCAL_PORTRAIT_AIR_PX,
    );
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(148);
  });
});

// ---------------------------------------------------------------------------
describe("R2 — les colonnes sont du VERRE, pas un filet devant du vide", () => {
  /** La regle groupee qui porte la SURFACE (celle du fond, pas celle du cadre). */
  const surface = () => {
    const trouvee = CSS.match(
      /\.vocal-side-discussion,\s*\n?\.vocal-side-tasks\s*\{[^}]*background-color[^}]*\}/,
    );
    expect(trouvee, "la surface des deux colonnes est introuvable").toBeTruthy();
    return sansCommentaires(trouvee[0]);
  };

  it("une teinte, un flou, et rien d'autre", () => {
    const bloc = surface();
    // Remarque du proprietaire du 2026-11-03 : la surface est la TEINTE du theme
    // (`--vocal-glass`, 46 %), une variable : aucune couleur n'est ecrite ici.
    // Le bleu de la meme remarque va aux CADRES et au TEXTE, pas a la surface :
    // essaye a 6 %, il faisait passer `solarized` sous son propre plancher
    // (3,82 -> 3,59) et a 9 % les titres tombaient a 4,37
    // (voir `vocal-panneaux-bleu-transparent.test.js`).
    expect(bloc).toMatch(/background-color:\s*var\(--vocal-glass\);/);
    expect(bloc).toMatch(/-webkit-backdrop-filter:\s*blur\(12px\)/);
    expect(bloc).toMatch(/backdrop-filter:\s*blur\(12px\)/);
    // `background-color` et non `background` : le raccourci effacerait l'image
    // de fond du calque, que les deux lavis peignent.
    expect(bloc).not.toMatch(/[^-]background\s*:/);
    // Aucune couleur ecrite en dur : la teinte vient du theme actif.
    expect(bloc).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
  });

  it("le jeton est un MELANGE du theme, et il reste translucide", () => {
    const calque = sliceSource(CSS, ".pilot-vocal {", "\n}", 400);
    const jeton = (calque.match(/--vocal-glass:\s*([^;]+);/) || [])[1];
    expect(jeton, "--vocal-glass absent du calque").toBeTruthy();
    expect(jeton).toContain("var(--glass-tint)");
    expect(jeton).toMatch(/color-mix\(/);
    expect(jeton).toMatch(/transparent/);
    expect(jeton).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
    // 46 % : assez pour lire, assez peu pour voir au travers. (Le plancher
    // mesure est verifie dans `ecran-vocal-transparence-visible.test.js` :
    // au-dela, la lumiere du fond ne traverse plus assez pour se voir.)
    // 2026-11-03 : 55 % -> 46 %, « baisse l'opacite des panneaux ». Le voile
    // cumule du panneau sur le fond passe de 0,52 a 0,43. Plus bas n'est pas
    // possible sans perdre le BORD du panneau (4,05 en `nord`, il en faut 4).
    expect(jeton).toContain("46%");
  });

  it("il y a quelque chose DERRIERE : les deux lavis du calque", () => {
    // Sans eux, le flou n'aurait rien a flouter et la teinte ne se verrait pas
    // davantage — c'etait exactement le defaut signale. Un seul jeton, deux
    // `radial-gradient` : un lavis par colonne.
    const calque = sliceSource(CSS, ".pilot-vocal {", "\n}", 400);
    expect(calque).toMatch(/--vocal-wash:/);
    const lavis = calque.match(/radial-gradient\(/g) || [];
    expect(lavis.length).toBe(2);
    // Le lavis est un melange du theme, jamais une couleur en dur — et il vient
    // du TEXTE, pas de la surface : une teinte de verre eclairee par sa propre
    // famille ne se voit pas (c'etait le defaut de la premiere passe).
    const jeton = (calque.match(/--vocal-wash:\s*([^;]+);/) || [])[1] || "";
    expect(jeton).toContain("var(--text-primary)");
    expect(jeton).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
    // Le calque lui-meme reste peint (il ne floute pas : ce sont les colonnes).
    expect(calque).toMatch(/background:/);
    expect(calque).not.toMatch(/backdrop-filter/);
  });

  it("les deux colonnes sont rafraichies au changement de theme, comme les panneaux", () => {
    // Une surface qui floute garde l'instantane de l'arriere-plan : sans ce
    // rafraichissement, elle garde la teinte PRECEDENTE jusqu'au redemarrage.
    expect(GLASS_SURFACE_SELECTOR).toContain(".vocal-side-discussion");
    expect(GLASS_SURFACE_SELECTOR).toContain(".vocal-side-tasks");
    for (const selecteur of [".vocal-side-discussion", ".vocal-side-tasks"]) {
      expect(CSS).toContain(`body.glass-refresh ${selecteur}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("R3 — le medaillon est MESURE, plus fige", () => {
  it("la cible de la remarque : trois fois le plancher de 96 px", () => {
    expect(VOCAL_PORTRAIT_PX).toBe(96);
    expect(VOCAL_PORTRAIT_TARGET_PX).toBe(3 * VOCAL_PORTRAIT_PX);
    // La feuille de style lit le jeton, avec le plancher en repli.
    const portrait = regle(".vocal-portrait", 60);
    expect(portrait).toMatch(/width:\s*var\(--vocal-portrait-size,\s*96px\)/);
    expect(portrait).toMatch(/height:\s*var\(--vocal-portrait-size,\s*96px\)/);
  });

  it("la mesure tient dans le cadre, garde deux rangees et leurs en-tetes, et ne depasse pas la cible", () => {
    // Place : la colonne moins le cadre, moins une marge de chaque cote.
    const place = 256 - VOCAL_SIDE_FRAME_PX - 2 * VOCAL_PORTRAIT_EDGE_PX;
    expect(vocalPortraitSize({ taskTrack: 256, columnHeight: 512 })).toBe(place);
    expect(place).toBe(214);
    // Hauteur : ce qui reste quand on a paye le haut fixe, les DEUX rangees et
    // leurs deux en-tetes promises a la liste, et le reste du bloc du
    // personnage.
    const parHauteur =
      512 -
      VOCAL_SIDE_FIXED_PX -
      VOCAL_PORTRAIT_MIN_LIST_PX -
      VOCAL_PORTRAIT_AIR_TOP_PX -
      VOCAL_PORTRAIT_GAP_PX -
      VOCAL_PORTRAIT_NAME_PX -
      VOCAL_PORTRAIT_AIR_PX;
    expect(parHauteur).toBe(275);
    // Une colonne large mais une fenetre basse : c'est la HAUTEUR qui decide.
    expect(vocalPortraitSize({ taskTrack: 2000, columnHeight: 512 })).toBe(parHauteur);
    // La borne haute est la cible : jamais plus de trois fois le plancher.
    expect(vocalPortraitSize({ taskTrack: 2000, columnHeight: 4000 })).toBe(
      VOCAL_PORTRAIT_TARGET_PX,
    );
    // Et jamais un medaillon dans une colonne qui n'en porte pas.
    expect(vocalPortraitSize({ taskTrack: 40, columnHeight: 512 })).toBe(0);
  });

  it("`vocalSyncSides` est le SEUL ecrivain du jeton, et il lit le plan", () => {
    const sync = corps("function vocalSyncSides()");
    expect(sync).toContain('setProperty("--vocal-portrait-size"');
    expect(sync).toContain("plan.portraitSize");
    // Un seul ecrivain dans tout le fichier.
    const ecritures = SUPER.match(/setProperty\("--vocal-portrait-size"/g) || [];
    expect(ecritures).toHaveLength(1);
  });

  it("le plan porte la taille ET le bloc : la liste en est deduite", () => {
    const avec = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasPortrait: true });
    expect(avec.portraitSize).toBe(275);
    expect(avec.portraitBlock).toBe(vocalPortraitBlockSize(avec.portraitSize));
    expect(avec.listHeight).toBe(avec.columnHeight - VOCAL_SIDE_FIXED_PX - avec.portraitBlock);
    // Sans personnage, aucune place n'est mesuree ni retiree.
    const sans = planVocalSides({ width: 1440, height: 900, orbSize: 336 });
    expect(sans.portraitSize).toBe(0);
    expect(sans.portraitBlock).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("R4 — dans l'etat nu, le panneau de droite cesse d'etre un panneau", () => {
  const blocNu = () =>
    sansCommentaires(sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-side-tasks {", "}", 60));

  it("le cadre, le fond et le flou tombent — et ce sont les seules choses touchees", () => {
    const bloc = blocNu();
    expect(bloc).toMatch(/background-color:\s*transparent/);
    expect(bloc).toMatch(/border-color:\s*transparent/);
    expect(bloc).toMatch(/-webkit-backdrop-filter:\s*none/);
    expect(bloc).toMatch(/backdrop-filter:\s*none/);
    // Le filet LUMINEUX du haut (la deuxieme passe de la transparence, voir
    // `ecran-vocal-transparence-visible.test.js`) tombe avec le reste : un
    // panneau eteint ne garde pas un lisere qui le dessinerait encore.
    expect(bloc).toMatch(/box-shadow:\s*none/);
    // Ni opacite, ni visibilite, ni flux : la colonne garde sa place et sa
    // hauteur, et le portrait qui vit dedans ne bouge pas d'un pixel.
    expect(bloc).not.toMatch(/(^|[^-])opacity\s*:/);
    expect(bloc).not.toMatch(/visibility\s*:/);
    expect(bloc).not.toMatch(/display\s*:/);
    expect(bloc).not.toMatch(/pointer-events\s*:/);
    expect(bloc).not.toMatch(/\b(width|height|padding|margin|position|top|right)\s*:/);
  });

  it("le portrait, son nom, le bouton de masquage et la saisie SURVIVENT", () => {
    // La demande du proprietaire du 2026-11-02 : « quand tout est masque, le
    // cadre du panneau de droite doit disparaitre » — le CADRE, pas le
    // personnage. On l'ecrit ici comme une liste de quatre survivants, pour que
    // le jour ou quelqu'un eteindra « aussi » le portrait, ce soit ce test qui
    // tombe, et pas l'ecran.
    const eteinte = sansCommentaires(
      sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-side-tasks {", "\n}", 60) +
        sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-mic-fix,", "\n}", 300),
    );
    for (const survivant of [
      ".vocal-portrait",
      ".vocal-portrait-name",
      ".vocal-display-toggle",
      ".vocal-input",
    ]) {
      expect(eteinte, `${survivant} est eteint par l'etat nu`).not.toContain(survivant);
    }
    // Et les deux seules regles qui rallument quelque chose dans l'etat nu sont
    // le bouton de masquage et... le bouton de masquage.
    const rallumees = CSS.match(/\.pilot-vocal\.vocal-bare[^{]*\{[^}]*opacity:\s*1/g) || [];
    expect(rallumees.length).toBeLessThanOrEqual(1);
    expect(CSS).toMatch(/\.pilot-vocal\.vocal-bare \.vocal-top \.vocal-display-toggle \{/);
  });

  it("il ne nomme NI le portrait, NI son nom, NI la zone de saisie", () => {
    // Les COMMENTAIRES sont neutralises : celui de l'etat nu NOMME le portrait et
    // son nom pour dire qu'il ne les touche pas. Ce qui compte est la REGLE.
    const section = sansCommentaires(
      blocNu() +
        sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-mic-fix,", "/* --- §4.2/§4.3", 500),
    );
    expect(section).not.toContain(".vocal-portrait");
    expect(section).not.toContain(".vocal-input");
    expect(CSS).toContain(".pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-tasks-title");
    expect(CSS).toContain(".pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-side-body");
  });
});
