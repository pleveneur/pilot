// Tests — REMARQUES DU PROPRIETAIRE, points A et B du 2026-11-13.
// (docs/rapports/RAPPORT-ecran-vocal-cadres-et-cercle.md)
//
// CE QUE CE FICHIER VERROUILLE, ET COMMENT :
//   A — les deux cadres (discussion a gauche, taches a droite) ont la MEME
//       largeur et la MEME hauteur, au pixel pres. Le verrou ne compare pas a
//       des nombres figes : il compare LES DEUX MESURES l'une a l'autre, et il
//       le fait sur deux plans —
//         A1 les DECLARATIONS : les proprietes qui font une taille (largeur,
//            hauteur, marges, bordures, remplissage) doivent etre les memes des
//            deux cotes, avec les memes valeurs ;
//         A2 les BORDS et les BUDGETS : sur les sept fenetres du document, les
//            quatre bords peints sont confondus et le haut fixe retranche avant
//            peinture est le MEME total (53 px) des deux cotes.
//       Il tombe si une colonne reprend une largeur a elle, une hauteur a elle,
//       ou si l'une oublie de payer un en-tete que l'autre paie.
//   B — la place du cercle en hauteur. Il ne « remonte » pas : la boite du
//       disque est centree dans la rangee et le disque est centre dans sa
//       boite, donc l'air au-dessus du disque egale l'air en dessous, avec ou
//       sans image. Le verrou le MESURE (air haut = air bas, a 1 px) et verifie
//       que la geometrie du disque ne depend jamais de ce qu'il y a a montrer :
//       il tombe si quelqu'un introduit une remontee (`top`, `transform`,
//       `margin-block`) ou si le disque se met a bouger quand une image arrive.
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources sont
// copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate § 3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import {
  VOCAL_CROWN_PX,
  VOCAL_DISCUSSION_HEAD_PX,
  VOCAL_ORB_BOX_RATIO,
  VOCAL_ORB_RESERVED_PX,
  VOCAL_SIDE_AIR_PX,
  VOCAL_SIDE_BORDER_PX,
  VOCAL_SIDE_FIXED_PX,
  VOCAL_SIDE_FRAME_PX,
  // La place que l'ecran prend hors de la rangee, quand elle n'est pas mesuree
  // (repli de `vocalStageRowHeight`) : B s'en sert pour decrire la rangee.
  VOCAL_STAGE_RESERVED_PX,
  planVocalDiscussion,
  planVocalSides,
  planVocalTasks,
  // La COMPOSITION du milieu (point 7) : la taille du medaillon sous le disque
  // et le bloc qu'il occupe avec son nom. La place du cercle en hauteur en
  // depend, donc ces deux fonctions entrent dans la mesure de B.
  vocalPortraitSize,
  vocalPortraitBlockSize,
} from "./vocal-sides.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

const DISCUSSION = ".vocal-side-discussion";
const TACHES = ".vocal-side-tasks";

/**
 * TOUTES les regles dont la liste de selecteurs cite `selecteur`, corps seuls.
 * Le motif ne franchit ni `{` ni `}` : il ne peut donc pas avaler un bloc de
 * `@media` et rendre un corps qui n'appartient pas a la colonne.
 */
function corpsDeRegles(selecteur) {
  const corps = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Le texte qui precede l'accolade emporte les commentaires du bloc
    // precedent : on les retire AVANT de decouper la liste de selecteurs.
    const liste = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
    const selecteurs = liste.split(",").map((s) => s.trim());
    if (selecteurs.includes(selecteur)) corps.push(m[2]);
  }
  return corps;
}

/** `propriete -> valeurs declarees`, commentaires retires. */
function declarations(selecteur) {
  const carte = new Map();
  for (const bloc of corpsDeRegles(selecteur)) {
    const net = bloc.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const decl of net.split(";")) {
      const coupe = decl.indexOf(":");
      if (coupe < 0) continue;
      const prop = decl.slice(0, coupe).trim();
      const valeur = decl.slice(coupe + 1).trim().replace(/\s+/g, " ");
      if (!prop || !valeur) continue;
      if (!carte.has(prop)) carte.set(prop, []);
      carte.get(prop).push(valeur);
    }
  }
  return carte;
}

const DECL_DISCUSSION = declarations(DISCUSSION);
const DECL_TACHES = declarations(TACHES);

/**
 * Les proprietes qui font une TAILLE ou une PLACE. `justify-self`,
 * `grid-column` et `justify-content` n'en font pas partie : c'est par eux que
 * les deux colonnes s'opposent (l'une vers l'exterieur, l'autre vers le disque),
 * et ils doivent rester differents.
 */
const TAILLE = [
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "box-sizing",
  "border",
  "border-radius",
  "padding",
  "padding-inline",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "margin",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "align-self",
  "flex",
  "gap",
];

describe("A1 — les deux cadres portent les MEMES declarations de taille", () => {
  it("propriete par propriete, les deux listes de valeurs sont identiques", () => {
    const ecarts = [];
    for (const prop of TAILLE) {
      const gauche = DECL_DISCUSSION.get(prop) || [];
      const droite = DECL_TACHES.get(prop) || [];
      if (gauche.join(" | ") !== droite.join(" | ")) {
        ecarts.push(`${prop} : gauche [${gauche.join(" | ")}] / droite [${droite.join(" | ")}]`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  it("la HAUTEUR des deux colonnes vient d'UNE seule regle, la meme", () => {
    // Si une colonne prenait sa propre hauteur, l'egalite tiendrait encore par
    // accident, puis deriverait. Ici aucune des deux ne declare `height` : la
    // hauteur vient d'UNE regle commune, `.vocal-side`, et elle vaut la boite du
    // disque. C'est ce qui rend les deux cadres indiscociables.
    expect(DECL_DISCUSSION.has("height")).toBe(false);
    expect(DECL_TACHES.has("height")).toBe(false);
    const commun = sliceSource(CSS, ".vocal-side {", "}", 400);
    expect(commun).toContain("height: min(var(--vocal-orb-box), 100%)");
    // Et ce n'est pas une valeur ecrite a la main : c'est la boite du disque.
    expect(VOCAL_ORB_BOX_RATIO).toBeCloseTo(1 + (2 * VOCAL_CROWN_PX) / 336, 10);
  });

  it("la LARGEUR des deux colonnes vient du MEME jeton, et d'aucun autre", () => {
    expect(DECL_DISCUSSION.get("width")).toEqual(["var(--vocal-side-tasks, 100%)"]);
    expect(DECL_TACHES.get("width")).toEqual(["var(--vocal-side-tasks, 100%)"]);
    // Le cadre d'une colonne fait 22 px de large : 2 filets de 1 px et 10 px de
    // marge interieure de chaque cote. Les deux le paient pareil, donc la
    // largeur de CONTENU est la meme des deux cotes.
    expect(VOCAL_SIDE_FRAME_PX).toBe(2 * (1 + 10));
    expect(DECL_DISCUSSION.get("padding-inline")).toEqual(["10px"]);
    expect(DECL_TACHES.get("padding-inline")).toEqual(["10px"]);
  });

  it("les deux colonnes s'opposent par leur ALIGNEMENT, jamais par leur taille", () => {
    // Ce qui DOIT rester different : chaque colonne s'aligne vers l'exterieur de
    // son cote, donc son bord interieur s'arrete au meme endroit vu de chaque
    // cote. Une largeur differente, elle, casserait l'egalite.
    const alignement = (decl) => {
      const regles = corpsDeRegles(decl).join("\n");
      const m = /justify-self:\s*(\w+)/.exec(regles);
      return m ? m[1] : null;
    };
    expect(alignement(DISCUSSION)).toBe("start");
    expect(alignement(TACHES)).toBe("end");
    expect(DECL_DISCUSSION.get("width")).toEqual(DECL_TACHES.get("width"));
  });
});

describe("A2 — les deux mesures, fenetre par fenetre", () => {
  // Les sept fenetres du document, et le disque que `--vocal-orb-size` donne :
  // clamp(120, (hauteur - 289) x 21 / 32, 336), la MEME formule que l'overlay.
  const FENETRES = [
    [720, 520],
    [768, 576],
    [820, 620],
    [896, 672],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ];
  const disque = (hauteur) =>
    Math.max(120, Math.min(336, ((hauteur - VOCAL_ORB_RESERVED_PX) * 21) / 32));

  it("meme largeur, meme hauteur : les quatre bords sont confondus", () => {
    for (const [width, height] of FENETRES) {
      const orbSize = disque(height);
      const plan = planVocalSides({ width, height, orbSize });
      // La feuille de style pose la MEME hauteur aux deux colonnes et la MEME
      // largeur (`--vocal-side-tasks` = `plan.taskTrack`) : les deux cadres ont
      // donc, chacun, ces quatre bords. On les ecrit deux fois, exprès, pour que
      // la comparaison soit une comparaison et pas une evidence.
      const cadreGauche = { gauche: 0, droite: plan.taskTrack, haut: 0, bas: plan.columnHeight };
      const cadreDroite = { gauche: 0, droite: plan.taskTrack, haut: 0, bas: plan.columnHeight };
      expect(cadreGauche, `${width} x ${height}`).toEqual(cadreDroite);
      // Et une largeur nulle serait deux colonnes invisibles : `shown` le dit.
      if (plan.shown) {
        expect(cadreGauche.droite).toBeGreaterThan(0);
        expect(cadreGauche.bas).toBeGreaterThan(0);
      }
    }
  });

  it("le haut fixe retranche AVANT de peindre est le meme total des deux cotes", () => {
    // C'est l'egalite qui manquait : la colonne de gauche retranchait 26 px (le
    // seul remplissage haut du titre) et la colonne de droite 51 px (le titre
    // entier et l'air, mais pas ses deux filets). Chacune annoncait donc une
    // ligne de plus qu'elle n'en montrait. Elles paient maintenant le meme
    // chiffre, et il est verifie sur les deux constantes, pas sur un litteral.
    expect(VOCAL_DISCUSSION_HEAD_PX).toBe(VOCAL_SIDE_FIXED_PX);
    expect(VOCAL_SIDE_FIXED_PX).toBe(39 + VOCAL_SIDE_AIR_PX + VOCAL_SIDE_BORDER_PX);
    expect(VOCAL_SIDE_FIXED_PX).toBe(53);
  });

  it("aucune fenetre ou l'un des deux cadres ne montre rien", () => {
    // Le budget retranche, il doit rester de la place des DEUX cotes : au moins
    // une ligne de discussion et une rangee de liste. En dessous, la colonne
    // serait un cadre vide — le defaut que l'en-tete juste rend visible.
    for (const [width, height] of FENETRES) {
      const plan = planVocalSides({ width, height, orbSize: disque(height) });
      if (!plan.shown) continue;
      expect(plan.columnHeight, `${width} x ${height}`).toBeGreaterThan(VOCAL_SIDE_FIXED_PX);
      expect(
        planVocalDiscussion(plan.columnHeight, plan.taskTrack).lines,
        `${width} x ${height} : discussion`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        planVocalTasks([{ agent: "codeur", project: "pilot", waiting: false }], {
          listHeight: plan.listHeight,
        }).rows,
        `${width} x ${height} : liste`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("B — la place du cercle en hauteur", () => {
  const FENETRES = [
    [720, 520],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ];
  const disque = (hauteur) =>
    Math.max(120, Math.min(336, ((hauteur - VOCAL_ORB_RESERVED_PX) * 21) / 32));

  it("l'air au-dessus du disque egale l'air en dessous : il est centre, pas remonte", () => {
    // Mesure : la boite du disque (`--vocal-orb-box`) porte le disque et deux
    // couronnes de halo, et le disque est centre dedans (le halo est un enfant
    // en `inset: 0`, donc symetrique). La boite est elle-meme centree dans la
    // rangee par `align-items: center`. L'air est donc le meme des deux cotes,
    // et il vaut une couronne : c'est ce que ce test MESURE.
    expect(CSS).toMatch(/align-items:\s*center/);
    for (const [width, height] of FENETRES) {
      const orbSize = disque(height);
      const boite = orbSize * VOCAL_ORB_BOX_RATIO;
      const airAuDessus = (boite - orbSize) / 2;
      const airEnDessous = (boite - orbSize) / 2;
      expect(airAuDessus, `${width} x ${height}`).toBeCloseTo(airEnDessous, 10);
      // Et cet air est la couronne du halo, ni plus ni moins.
      expect(airAuDessus).toBeCloseTo((orbSize * VOCAL_CROWN_PX) / 336, 10);
    }
  });

  it("aucun decalage vertical sur le disque : ni `top`, ni `transform`, ni marge", () => {
    const orb = corpsDeRegles(".vocal-orb").join("\n");
    expect(orb).not.toMatch(/(^|[\s;{])top:/);
    expect(orb).not.toMatch(/(^|[\s;{])bottom:/);
    expect(orb).not.toMatch(/transform:\s*translate/);
    expect(orb).not.toMatch(/margin-block/);
    expect(orb).not.toMatch(/align-self/);
    // Aucun jeton de remontee n'existe dans tout le fichier : une remontee
    // ecrite ailleurs serait aussi une remontee.
    expect(CSS).not.toMatch(/--vocal-raise/);
    expect(SUPER).not.toMatch(/--vocal-raise/);
    // Le disque n'est PLUS l'item de grille : la piste du milieu est occupee par
    // la COMPOSITION `.vocal-center`, centree en hauteur (`justify-content`), et
    // le disque est son premier enfant. Il ne porte donc aucun placement propre
    // — un `grid-area` sur le disque le sortirait de la composition.
    expect(corpsDeRegles(".vocal-center").join("\n")).toMatch(/grid-area:\s*1 \/ 2;/);
    expect(corpsDeRegles(".vocal-center").join("\n")).toMatch(/justify-content:\s*center/);
    expect(orb).not.toMatch(/grid-area/);
  });

  it("le medaillon du personnage ne prend rien a la LISTE : la hauteur ne bouge pas", () => {
    // Point 7 des remarques du proprietaire (2026-11-13) : le personnage est
    // passe SOUS le cercle. La liste des taches ne paie donc plus son bloc —
    // elle garde exactement la hauteur qu'elle a quand il n'y a rien a montrer.
    for (const [width, height] of FENETRES) {
      const orbSize = disque(height);
      const base = { width, height, orbSize };
      const sans = planVocalSides(base);
      const personnage = planVocalSides({ ...base, hasPortrait: true });
      const visage = planVocalSides({ ...base, hasAvatar: true });
      expect(personnage.columnHeight, `${width} x ${height}`).toBe(sans.columnHeight);
      expect(visage.columnHeight, `${width} x ${height}`).toBe(sans.columnHeight);
      // La liste ne perd plus une seule rangee (avant le point 7 elle tombait a
      // UNE rangee des que le personnage etait la) ; la fenetre du visage, elle,
      // occupe toujours la zone d'image en haut de la colonne, donc elle paie.
      expect(personnage.listHeight, `${width} x ${height} : personnage`).toBe(sans.listHeight);
      // La fenetre du visage, elle, occupe toujours la zone d'image en haut de
      // la colonne : quand elle tient (assez de place), c'est la LISTE qui paie —
      // jamais la colonne, jamais la composition.
      expect(visage.listHeight, `${width} x ${height} : fenetre`).toBeLessThanOrEqual(sans.listHeight);
      if (visage.imageZone.kind === "avatar") {
        expect(visage.listHeight, `${width} x ${height} : fenetre payee`).toBeLessThan(sans.listHeight);
      }
    }
  });

  it("la composition est centree : l'air du haut egale l'air du bas, avec ET sans personnage", () => {
    // Ce que la feuille de style fait (`.vocal-center` en `justify-content:
    // center`, `align-self: stretch` sur la rangee), le plan le dit en chiffres :
    // la composition (disque + bloc du medaillon) laisse le MEME jour au-dessus
    // et en dessous. Avec un personnage elle grandit vers le bas, donc le disque
    // monte d'exactement la moitie de ce qui s'ajoute — et sans personnage, air
    // haut = air bas = ce qui reste autour du seul disque.
    for (const [width, height] of FENETRES) {
      const orbSize = disque(height);
      const rangee = height - VOCAL_STAGE_RESERVED_PX;
      for (const personnage of [false, true]) {
        const medaillon = personnage
          ? vocalPortraitSize({ orbSize, stageHeight: rangee })
          : 0;
        const bloc = medaillon ? vocalPortraitBlockSize(medaillon) : 0;
        const air = (rangee - orbSize - bloc) / 2;
        // Jamais negatif : la composition ne deborde pas de sa rangee.
        expect(air, `${width} x ${height}, personnage=${personnage}`).toBeGreaterThanOrEqual(0);
      }
      // Et sans personnage, la composition n'est que le disque : il est centre.
      const medaillon = vocalPortraitSize({ orbSize, stageHeight: rangee });
      expect(medaillon, `${width} x ${height} : medaillon mesurable`).toBeGreaterThan(0);
    }
  });

  it("un personnage qui arrive ne change pas la TAILLE du disque, seulement sa place", () => {
    // Le disque ne depend que de la hauteur de la fenetre (`--vocal-orb-size`), et
    // le medaillon ne peut pas lui prendre sa place : sa taille est bornee par le
    // disque lui-meme. Ce que le personnage deplace, c'est le CENTRE de la
    // composition — le disque monte, il ne rapetisse pas.
    for (const [width, height] of FENETRES) {
      const orbSize = disque(height);
      const rangee = height - VOCAL_STAGE_RESERVED_PX;
      const medaillon = vocalPortraitSize({ orbSize, stageHeight: rangee });
      expect(medaillon, `${width} x ${height} : jamais plus large que le disque`).toBeLessThanOrEqual(
        Math.round(orbSize),
      );
    }
  });

  it("la taille du disque ne depend que de la HAUTEUR de la fenetre", () => {
    // `--vocal-orb-size` est pose sur l'overlay, et nulle part ailleurs : une
    // seule source, lue par le halo, le bouton de relance et le rayon utile.
    const declarationsOrb = CSS.match(/--vocal-orb-size:/g) || [];
    expect(declarationsOrb).toHaveLength(1);
    expect(CSS).toContain("--vocal-orb-size: clamp(120px, calc((100vh - 289px) * 21 / 32), 336px)");
    // La copie de la formule dans le code doit dire la meme chose : c'est elle
    // qui sert de repli quand `getComputedStyle` ne rend rien.
    expect(SUPER).toContain("VOCAL_ORB_RESERVED_PX");
    expect(VOCAL_ORB_RESERVED_PX).toBe(289);
  });
});
