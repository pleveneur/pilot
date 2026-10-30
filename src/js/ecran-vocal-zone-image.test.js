// Tests — LA ZONE D'IMAGE DE L'ECRAN VOCAL : TROIS CAS, DANS CET ORDRE
// (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md, complement
// du 2026-10-29, § 7bis ; les trois tests sont nommes au § 7bis.10).
//
// CE QUE CE FICHIER VERROUILLE :
//   T20 « trois cas, dans cet ordre » — `planVocalSides` rend la bonne reserve et
//         la bonne hauteur de liste pour les QUATRE combinaisons du tableau
//         § 7bis.4, sur les SEPT fenetres, avec le bon nombre de lignes ; le cas 2
//         n'apparait pas sous H = 298 (il ne laisserait pas une seule tache).
//   T21 « l'avatar n'est jamais un noeud » — la zone du cas 2 ne porte aucun
//         element, aucun `img`, aucun `src`, jamais le logo ; elle ne dessine
//         rien (ni cadre, ni fond, ni ombre, ni rond).
//   T22 « la pose » — la conversion CSS -> physique ARRONDIT, `/set_position`
//         n'est demande QUE si une taille est confirmee, et UNE SEULE FOIS par
//         geste (aucune minuterie nouvelle).
//
// Les commentaires sont en ASCII ; les chaines lues dans les sources (selecteurs
// CSS, extraits de balisage) sont copiees telles quelles.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage VERIFIE (quality-gate §3.4) : une ancre absente LEVE au lieu de
// rendre un fragment vide, qui rendrait vraie toute assertion negative.
import { sliceSource } from "./source-slice.js";
import {
  planVocalSides,
  planVocalImageZone,
  planVocalAvatarPose,
  vocalAvatarPoseKey,
  planVocalAvatarPlacement,
  vocalTaskRows,
  VOCAL_AVATAR_W_PX,
  VOCAL_AVATAR_H_PX,
  VOCAL_IMAGE_GAP_PX,
  VOCAL_PORTRAIT_BLOCK_PX,
  VOCAL_TASK_PX,
  VOCAL_IMAGE_PORTRAIT,
  VOCAL_IMAGE_AVATAR,
  VOCAL_IMAGE_AVATAR_PORTRAIT,
  VOCAL_IMAGE_NONE,
} from "./vocal-sides.js";
import { buildFaceRequest } from "./face-gateway.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const SIDES = lire("src/js/vocal-sides.js");

/** Fragment de `super-agent.js` entre deux ancres (decoupage verifie). */
function corps(debut, fin) {
  return sliceSource(SUPER, debut, fin, 40);
}

/** Le corps d'une fonction de PREMIER niveau (accolade fermante en colonne 1). */
function corpsFonctionEntete(debut) {
  return corps(debut, "\n}\n");
}

// Les SEPT fenetres du tableau § 2.5, avec le disque et `H` du tableau § 3.2.
const SEPT_LIGNES = [
  [720, 520, 151.6, 231],
  [768, 576, 188.3, 287],
  [820, 620, 217.2, 331],
  [896, 672, 251.3, 383],
  [1024, 768, 314.3, 479],
  [1280, 800, 335.3, 511],
  [1440, 900, 336, 512],
];

/**
 * Le tableau § 7bis.4, ligne par ligne, recopiee telle quelle :
 * [largeur, hauteur, disque, H,
 *  cas 1 (listH, lignes), cas 2 (listH, lignes), cas 3 (listH, lignes),
 *  cas 1+2 (listH, lignes)].
 *
 * Le « — » du document (la zone n'existe pas) est ecrit ici `null` : la liste
 * garde alors EXACTEMENT la hauteur du cas 3, ce qui est verifie plus bas.
 */
const TABLE_7BIS_4 = [
  [720, 520, 151.6, 231, [61, 1], null, [159, 2], null],
  [768, 576, 188.3, 287, [117, 1], null, [215, 3], null],
  [820, 620, 217.2, 331, [161, 2], [79, 1], [259, 4], null],
  [896, 672, 251.3, 383, [213, 3], [131, 1], [311, 5], null],
  [1024, 768, 314.3, 479, [309, 5], [227, 4], [407, 7], [123, 1]],
  [1280, 800, 335.3, 511, [341, 6], [259, 4], [439, 8], [155, 2]],
  [1440, 900, 336, 512, [342, 6], [260, 4], [440, 8], [156, 2]],
];

// ---------------------------------------------------------------------------
describe("T20 — trois cas, dans cet ordre : le personnage, sinon l'avatar, sinon rien", () => {
  it("les trois cas portent les hauteurs du document, et rien d'autre", () => {
    // Les hauteurs du bloc d'image, en une seule lecture : 0 px (cas 3), le
    // medaillon n'est pas une place reservee (cas 1), 180 px (cas 2), et la
    // fenetre du visage plus son ecart au-dessus du medaillon (cas 1 + 2).
    const H = 512;
    expect(planVocalImageZone({ hasPortrait: false, hasAvatar: false, columnHeight: H })).toEqual({
      kind: VOCAL_IMAGE_NONE,
      height: 0,
      avatar: false,
      portrait: false,
    });
    expect(planVocalImageZone({ hasPortrait: true, hasAvatar: false, columnHeight: H })).toEqual({
      kind: VOCAL_IMAGE_PORTRAIT,
      height: 0,
      avatar: false,
      portrait: true,
    });
    expect(planVocalImageZone({ hasPortrait: false, hasAvatar: true, columnHeight: H })).toEqual({
      kind: VOCAL_IMAGE_AVATAR,
      height: VOCAL_AVATAR_H_PX,
      avatar: true,
      portrait: false,
    });
    expect(planVocalImageZone({ hasPortrait: true, hasAvatar: true, columnHeight: H })).toEqual({
      kind: VOCAL_IMAGE_AVATAR_PORTRAIT,
      height: VOCAL_AVATAR_H_PX + VOCAL_IMAGE_GAP_PX,
      avatar: true,
      portrait: true,
    });
    // 180 px n'est pas un chiffre choisi : c'est le plancher de la fenetre de
    // PLface (`minWidth: 160`, `minHeight: 180`), la plus petite place possible.
    expect(VOCAL_AVATAR_W_PX).toBe(160);
    expect(VOCAL_AVATAR_H_PX).toBe(180);
    // Le bloc du personnage, lui, n'a pas bouge : 72 + 6 + 20 (aucun nom sous
    // l'image — decision du proprietaire du 2026-10-29).
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(98);
  });

  it("le personnage l'emporte TOUJOURS sur l'avatar (l'ordre des trois cas)", () => {
    // Un personnage et un avatar disponibles : c'est le personnage qui decide des
    // quatre premieres valeurs, l'avatar n'ajoute que sa place.
    const cas = { width: 1440, height: 900, orbSize: 336 };
    const avec = planVocalSides({ ...cas, hasPortrait: true, hasAvatar: true });
    expect(avec.hasPortrait).toBe(true);
    expect(avec.imageZone.kind).toBe(VOCAL_IMAGE_AVATAR_PORTRAIT);
    expect(avec.imageZone.portrait).toBe(true);
    // Sans avatar, les quatre premieres valeurs ne changent pas d'un pixel.
    const sans = planVocalSides({ ...cas, hasPortrait: true, hasAvatar: false });
    expect([sans.track, sans.columnHeight]).toEqual([avec.track, avec.columnHeight]);
  });

  it("le tableau § 7bis.4, les SEPT fenetres et les QUATRE colonnes, au pixel pres", () => {
    for (const [largeur, hauteur, disque, H, cas1, cas2, cas3, cas12] of TABLE_7BIS_4) {
      const base = { width: largeur, height: hauteur, orbSize: disque };
      const lireCas = (hasPortrait, hasAvatar) => {
        const plan = planVocalSides({ ...base, hasPortrait, hasAvatar });
        expect(plan.columnHeight, `${largeur} : H`).toBe(H);
        const lignes = vocalTaskRows(plan.listHeight, plan.hasPortrait).rows;
        return [plan.listHeight, lignes];
      };
      const c1 = lireCas(true, false);
      const c2 = lireCas(false, true);
      const c3 = lireCas(false, false);
      const c12 = lireCas(true, true);

      expect(c1, `${largeur} x ${hauteur} : cas 1`).toEqual(cas1);
      expect(c3, `${largeur} x ${hauteur} : cas 3`).toEqual(cas3);
      // « — » : la zone n'existe pas, et la liste garde la hauteur du cas 3.
      if (cas2 === null) {
        expect(c2, `${largeur} x ${hauteur} : cas 2 refuse`).toEqual(c3);
      } else {
        expect(c2, `${largeur} x ${hauteur} : cas 2`).toEqual(cas2);
      }
      if (cas12 === null) {
        expect(c12, `${largeur} x ${hauteur} : cas 1 + 2 refuse`).toEqual(c1);
      } else {
        expect(c12, `${largeur} x ${hauteur} : cas 1 + 2`).toEqual(cas12);
      }
    }
  });

  it("le cas 2 n'apparait pas sous H = 298 : il ne laisserait pas UNE tache", () => {
    // `H - 252 >= 46`, le seuil de « une colonne n'est jamais un trou » (§ 2.6).
    expect(VOCAL_TASK_PX).toBe(46);
    expect(
      planVocalImageZone({ hasPortrait: false, hasAvatar: true, columnHeight: 297 }).avatar,
    ).toBe(false);
    expect(
      planVocalImageZone({ hasPortrait: false, hasAvatar: true, columnHeight: 298 }).avatar,
    ).toBe(true);
    // 820 x 620 : 331 px de colonne, donc le seuil est franchi (79 px de liste).
    expect(
      planVocalImageZone({ hasPortrait: false, hasAvatar: true, columnHeight: 331 }).height,
    ).toBe(180);
    // Et un avatar refuse ne deplace rien : `hasAvatar` du plan dit la VERITE.
    const refuse = planVocalSides({ width: 768, height: 576, orbSize: 188.3, hasAvatar: true });
    expect(refuse.hasAvatar).toBe(false);
    expect(refuse.imageZone.kind).toBe(VOCAL_IMAGE_NONE);
    expect(refuse.listHeight).toBe(287 - 72);
  });

  it("le plan porte la zone : la repeinture n'a pas a relire le personnage", () => {
    const plan = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasPortrait: true });
    expect(Object.keys(plan.imageZone).sort()).toEqual(["avatar", "height", "kind", "portrait"]);
    expect(plan.imageZone).toEqual({
      kind: VOCAL_IMAGE_PORTRAIT,
      height: 0,
      avatar: false,
      portrait: true,
    });
    // Aucune entree ne vient d'ailleurs : la seule chose lue est `hasPortrait`.
    expect(plan.hasAvatar).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("T21 — l'avatar n'est jamais un noeud : Pilot ne dessine rien", () => {
  it("la zone ne porte ni image, ni source, ni logo, ni texte", () => {
    const zone = corpsFonctionEntete("function vocalImageZoneNode(");
    // Un `div` nu, cree a l'execution, insere sous le titre.
    expect(zone).toMatch(/createElement\("div"\)/);
    expect(zone).toMatch(/"vocal-image-zone"/);
    // AUCUN contenu : ni element, ni image, ni source, ni texte, ni balisage.
    for (const interdit of ["<img", "<canvas", "<picture", "<video", "src", "innerHTML", "textContent", "logo_pilot_vector"]) {
      expect(zone, `la zone dessine ${interdit}`).not.toContain(interdit);
    }
  });

  it("la repeinture ne fait que lui donner une HAUTEUR, ou la retirer", () => {
    const rendu = corpsFonctionEntete("function vocalRenderColumn(plan)");
    expect(rendu).toMatch(/plan\.imageZone/);
    // La hauteur est ecrite, et `hidden` quand elle ne reserve rien.
    expect(rendu).toMatch(/zone\.style\.height = valeur/);
    expect(rendu).toMatch(/zone\.hidden = hauteur <= 0/);
    // Aucun contenu, jamais : la zone est une PLACE, pas un element a remplir.
    // (Le fragment est borne aux lignes de la zone : la meme fonction ecrit le
    // titre, la liste et la ligne d'activite, qui sont d'autres noeuds.)
    const zoneSeule = sliceSource(rendu, "const zone = vocalImageZoneNode", "const liste =", 20);
    expect(zoneSeule).toContain("plan.imageZone.height");
    for (const interdit of ["innerHTML", "<img", "logo_pilot_vector", "appendChild", "textContent"]) {
      expect(zoneSeule, `la repeinture remplit la zone avec ${interdit}`).not.toContain(interdit);
    }
  });

  it("la zone ne dessine AUCUNE forme : ni cadre, ni fond, ni ombre, ni rond", () => {
    const regle = sliceSource(CSS, ".vocal-image-zone {", "}", 10);
    expect(regle).toMatch(/pointer-events:\s*none/);
    for (const interdit of ["border", "background", "box-shadow", "border-radius", "outline"]) {
      expect(regle, `la zone dessine ${interdit}`).not.toContain(interdit);
    }
  });

  it("ni le balisage statique ni la feuille de style ne portent d'image de remplacement", () => {
    const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
    // Le seul portrait est celui du personnage, dans la colonne de droite.
    expect(build.match(/<img /g) || []).toHaveLength(1);
    expect(build).not.toMatch(/logo_pilot_vector\.svg/);
    // Aucune image de l'avatar : Pilot n'a pas de moteur 3D, et n'en aura pas
    // (§ 7bis.6, option B refusee).
    expect(CSS).not.toContain(".vocal-image-zone img");
    expect(SIDES).not.toContain("logo_pilot_vector");
  });
});

// ---------------------------------------------------------------------------
describe("T22 — la pose : arrondir, une taille confirmee, un seul appel par geste", () => {
  it("la conversion CSS -> physique ARRONDIT et centre l'avatar dans la colonne", () => {
    const pose = planVocalAvatarPose({
      rect: { left: 100.4, top: 200.6, width: 320 },
      windowOrigin: { x: 10, y: 20, scaleFactor: 1.5 },
      avatar: { width: 160, height: 180 },
    });
    // x = 10 + (100,4 + (320 - 160) / 2) x 1,5 = 280,6 -> 281
    // y = 20 + 200,6 x 1,5 = 320,9 -> 321
    expect(pose).toEqual({ x: 281, y: 321, width: 160, height: 180 });
    // Le visage n'accepte que des entiers (`i32`) : aucune valeur fractionnaire
    // ne doit pouvoir sortir d'ici.
    for (const valeur of Object.values(pose)) expect(Number.isInteger(valeur)).toBe(true);
  });

  it("SANS taille confirmee, aucune pose n'est demandee", () => {
    const rect = { left: 0, top: 0, width: 320 };
    const windowOrigin = { x: 0, y: 0, scaleFactor: 1 };
    expect(planVocalAvatarPose({ rect, windowOrigin })).toBeNull();
    expect(planVocalAvatarPose({ rect, windowOrigin, avatar: { width: 0, height: 180 } })).toBeNull();
    expect(planVocalAvatarPose({ rect, windowOrigin, avatar: { width: 160 } })).toBeNull();
  });

  it("elle n'est demandee que dans les deux cas ou la zone porte l'avatar", () => {
    const commun = {
      rect: { left: 0, top: 0, width: 320 },
      windowOrigin: { x: 0, y: 0, scaleFactor: 1 },
      avatar: { width: 160, height: 180 },
    };
    for (const kind of [VOCAL_IMAGE_NONE, VOCAL_IMAGE_PORTRAIT]) {
      const placement = planVocalAvatarPlacement({ ...commun, imageZone: { kind, height: 0 } });
      expect(placement.send, `cas ${kind}`).toBe(false);
      expect(placement.pose).toBeNull();
    }
    for (const kind of [VOCAL_IMAGE_AVATAR, VOCAL_IMAGE_AVATAR_PORTRAIT]) {
      const placement = planVocalAvatarPlacement({
        ...commun,
        imageZone: { kind, height: VOCAL_AVATAR_H_PX },
      });
      expect(placement.send, `cas ${kind}`).toBe(true);
      // Centre dans une colonne de 320 px : 80 px de chaque cote.
      expect(placement.key).toBe("80,0,160,180");
    }
  });

  it("UNE SEULE FOIS par geste : une pose identique n'est pas redemandee", () => {
    const entrees = {
      rect: { left: 40, top: 60, width: 320 },
      windowOrigin: { x: 0, y: 0, scaleFactor: 1 },
      avatar: { width: 160, height: 180 },
      imageZone: { kind: VOCAL_IMAGE_AVATAR, height: 180 },
    };
    const premier = planVocalAvatarPlacement(entrees);
    expect(premier.send).toBe(true);
    // Le tic de 900 ms repasse : la place n'a pas bouge, donc rien ne part.
    const second = planVocalAvatarPlacement({ ...entrees, lastKey: premier.key });
    expect(second.send).toBe(false);
    expect(second.pose).toEqual(premier.pose);
    // Une nouvelle place, elle, se demande.
    const bouge = planVocalAvatarPlacement({
      ...entrees,
      rect: { left: 41, top: 60, width: 320 },
      lastKey: premier.key,
    });
    expect(bouge.send).toBe(true);
    expect(vocalAvatarPoseKey(bouge.pose)).not.toBe(premier.key);
    // Pas de pose, pas de cle : la comparaison ne peut pas confondre les deux.
    expect(vocalAvatarPoseKey(null)).toBe("");
  });

  it("le seul envoi passe par la passerelle du visage, avec la taille", () => {
    const pose = corpsFonctionEntete("function vocalPlaceAvatar(plan)");
    expect(pose).toMatch(/runFaceTool\("set_position"/);
    // La taille est TOUJOURS transmise : sans elle, PLface ne peut pas se poser.
    expect(pose).toMatch(/w: placement\.pose\.width/);
    expect(pose).toMatch(/h: placement\.pose\.height/);
    // La decision est celle du module pur, et rien d'autre.
    expect(pose).toMatch(/placement\.send/);
    expect(pose).toMatch(/planVocalAvatarPlacement\(/);
    // Aucune minuterie nouvelle : le tic de 900 ms suffit, et il ne redemande
    // que ce qui a change.
    for (const interdit of ["setInterval", "setTimeout", "requestAnimationFrame"]) {
      expect(pose, `la pose installe ${interdit}`).not.toContain(interdit);
    }
    // Un visage eteint ne leve rien et n'ecrit aucun message : c'est un decor.
    expect(pose).toMatch(/\.catch\(\(\) =>/);
    expect(pose).not.toMatch(/notify|alert\(/);
  });

  it("la passerelle envoie `w` et `h` quand ils existent, et rien de plus sinon", () => {
    // La forme d'AVANT reste byte pour byte identique : les appelants existants
    // (l'extension du visage) n'envoient que `x` et `y`.
    const avant = buildFaceRequest("set_position", { x: 12, y: 34 });
    expect(avant.pathname).toBe("/set_position");
    expect(avant.params).toEqual({ x: 12, y: 34 });
    const apres = buildFaceRequest("set_position", { x: 12, y: 34, w: 160, h: 180 });
    expect(apres.params).toEqual({ x: 12, y: 34, w: 160, h: 180 });
    // `null` n'est pas transmis : la passerelle saute les valeurs absentes.
    const nulle = buildFaceRequest("set_position", { x: 12, y: 34, w: null, h: undefined });
    expect(nulle.params).toEqual({ x: 12, y: 34 });
  });

  it("aucun reglage, aucun rangement : la place est decidee a chaque affichage", () => {
    for (const interdit of ["localStorage", "sessionStorage", "invoke", "fetch(", "indexedDB"]) {
      expect(SIDES, `vocal-sides.js touche a ${interdit}`).not.toContain(interdit);
    }
    // Et le seul ecrivain de l'ecran reste `vocalSyncSides`, un seul point.
    const sync = corpsFonctionEntete("function vocalSyncSides(");
    expect(sync).toMatch(/vocalPlaceAvatar\(plan\)/);
    expect(sync.match(/vocalPlaceAvatar\(/g) || []).toHaveLength(1);
  });
});
