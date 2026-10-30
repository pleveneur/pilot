// Tests — LA ZONE D'IMAGE DE L'ECRAN VOCAL : TROIS CAS, DANS CET ORDRE
// (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md, § 7bis ;
// les trois tests sont nommes au § 7bis.10).
//
// CORRECTION DU 2026-10-31 (decision du proprietaire, qui ANNULE la mission
// « ecran Vocal » du 2026-10-30) : l'image est REVENUE en HAUT A DROITE de
// l'ecran, le personnage d'abord, la liste des taches DESSOUS. La zone d'image a
// donc de nouveau TROIS cas, dans cet ordre :
//   1. le PERSONNAGE (portrait) — il occupe la place, aucun trou reserve ;
//   2. la fenetre du VISAGE, si elle tourne et si sa taille est connue ;
//   3. RIEN — la liste reprend la place (`H - 51` px).
// Le DISQUE ne porte plus rien : ni image, ni nom.
//
// CE QUE CE FICHIER VERROUILLE :
//   T20 « trois cas, dans cet ordre » — `planVocalSides` rend la bonne reserve et
//         la bonne hauteur de liste pour les TROIS cas du tableau § 7bis.4, sur
//         les SEPT fenetres, avec le bon nombre de lignes ; l'avatar n'apparait
//         pas sous H = 277 (il ne laisserait pas une seule tache).
//   T21 « l'avatar n'est jamais un noeud » — la zone ne porte aucun element,
//         aucun `img`, aucun `src`, jamais le logo ; elle ne dessine rien (ni
//         cadre, ni fond, ni ombre, ni rond). Le SEUL portrait de l'ecran est
//         celui du personnage, et il est dans la COLONNE, pas dans le disque.
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
  VOCAL_SIDE_FIXED_PX,
  VOCAL_PORTRAIT_BLOCK_PX,
  VOCAL_TASK_PX,
  VOCAL_IMAGE_PORTRAIT,
  VOCAL_IMAGE_AVATAR,
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

/**
 * Le tableau § 7bis.4, dans sa version a TROIS cas (correction du 2026-10-31),
 * ligne par ligne, recopiee telle quelle :
 * [largeur, hauteur, disque, H,
 *  cas « rien » (listH, lignes), cas « personnage » (listH, lignes),
 *  cas « fenetre du visage » (listH, lignes) ou null].
 *
 * Le « — » du document (l'avatar refuse, il ne laisserait pas une tache) est
 * ecrit ici `null` : la liste garde alors EXACTEMENT la hauteur du cas sans
 * avatar, ce qui est verifie plus bas.
 */
const TABLE_7BIS_4 = [
  [720, 520, 151.6, 231, [180, 3], [82, 1], null],
  [768, 576, 188.3, 287, [236, 4], [138, 2], [56, 1]],
  [820, 620, 217.2, 331, [280, 5], [182, 3], [100, 1]],
  [896, 672, 251.3, 383, [332, 6], [234, 4], [152, 2]],
  [1024, 768, 314.3, 479, [428, 8], [330, 6], [248, 4]],
  [1280, 800, 335.3, 511, [460, 8], [362, 7], [280, 5]],
  [1440, 900, 336, 512, [461, 8], [363, 7], [281, 5]],
];

// ---------------------------------------------------------------------------
describe("T20 — trois cas, dans cet ordre : le personnage, la fenetre du visage, sinon rien", () => {
  it("les trois cas portent les hauteurs du document, et rien d'autre", () => {
    // Les hauteurs du bloc d'image, en une seule lecture : 0 px quand le
    // personnage occupe la place (son medaillon est un vrai noeud, il n'y a rien
    // a reserver), 0 px quand rien ne s'affiche, 180 px quand la fenetre du
    // visage est posee.
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
    // 180 px n'est pas un chiffre choisi : c'est le plancher de la fenetre de
    // PLface (`minWidth: 160`, `minHeight: 180`), la plus petite place possible.
    expect(VOCAL_AVATAR_W_PX).toBe(160);
    expect(VOCAL_AVATAR_H_PX).toBe(180);
    // Le bloc du personnage, lui, est un vrai bloc : 72 px de medaillon, 6 px
    // d'ecart, 20 px de nom — il se lit dans le haut fixe de la colonne, pas
    // dans la zone d'image (qui reste alors a 0 px).
    expect(VOCAL_SIDE_FIXED_PX).toBe(39 + 12);
    expect(VOCAL_PORTRAIT_BLOCK_PX).toBe(72 + 6 + 20);
  });

  it("le personnage l'emporte TOUJOURS sur la fenetre du visage", () => {
    // Les deux disponibles : c'est le personnage qui occupe la zone, et l'avatar
    // n'ajoute rien. Le disque, lui, n'entre pas dans la decision.
    const cas = { width: 1440, height: 900, orbSize: 336 };
    const portrait = planVocalSides({ ...cas, hasPortrait: true });
    const deux = planVocalSides({ ...cas, hasPortrait: true, hasAvatar: true });
    expect(portrait.imageZone.kind).toBe(VOCAL_IMAGE_PORTRAIT);
    expect(deux).toEqual(portrait);
    // L'avatar ne pese donc jamais sur la hauteur de liste quand un personnage
    // est la : 512 - 51 - 98 = 363 px, avec ou sans visage.
    expect(deux.listHeight).toBe(363);
    // Une entree absente n'est pas « vrai » : sans personnage, l'avatar decide.
    expect(planVocalSides({ ...cas, hasAvatar: true }).imageZone.kind).toBe(
      VOCAL_IMAGE_AVATAR,
    );
    expect(planVocalSides(cas).imageZone.kind).toBe(VOCAL_IMAGE_NONE);
  });

  it("le tableau § 7bis.4, les SEPT fenetres et les TROIS cas, au pixel pres", () => {
    for (const [largeur, hauteur, disque, H, casRien, casPortrait, casAvatar] of TABLE_7BIS_4) {
      const base = { width: largeur, height: hauteur, orbSize: disque };
      const lireCas = (entrees) => {
        const plan = planVocalSides({ ...base, ...entrees });
        expect(plan.columnHeight, `${largeur} : H`).toBe(H);
        return [plan.listHeight, vocalTaskRows(plan.listHeight).rows];
      };
      const rien = lireCas({});
      const portrait = lireCas({ hasPortrait: true });
      const avatar = lireCas({ hasAvatar: true });
      expect(rien, `${largeur} x ${hauteur} : sans image`).toEqual(casRien);
      expect(portrait, `${largeur} x ${hauteur} : personnage`).toEqual(casPortrait);
      // « — » : la zone n'existe pas, et la liste garde la hauteur du cas sans
      // avatar — aucun trou, aucune place perdue.
      if (casAvatar === null) {
        expect(avatar, `${largeur} x ${hauteur} : avatar refuse`).toEqual(casRien);
      } else {
        expect(avatar, `${largeur} x ${hauteur} : fenetre du visage`).toEqual(casAvatar);
      }
    }
  });

  it("la fenetre du visage n'apparait pas sous H = 277 : elle mangerait la derniere tache", () => {
    // `H - 51 - 180 >= 46`, le seuil de « une colonne n'est jamais un trou »
    // (§ 2.6). 51 + 180 + 46 = 277.
    expect(VOCAL_TASK_PX).toBe(46);
    expect(VOCAL_SIDE_FIXED_PX + VOCAL_AVATAR_H_PX + VOCAL_TASK_PX).toBe(277);
    expect(planVocalImageZone({ hasAvatar: true, columnHeight: 276 }).avatar).toBe(false);
    expect(planVocalImageZone({ hasAvatar: true, columnHeight: 277 }).avatar).toBe(true);
    // 820 x 620 : 331 px de colonne, donc le seuil est franchi (100 px de liste).
    expect(planVocalImageZone({ hasAvatar: true, columnHeight: 331 }).height).toBe(180);
    // Et un avatar refuse ne deplace rien : `hasAvatar` du plan dit la VERITE.
    const refuse = planVocalSides({ width: 720, height: 520, orbSize: 151.6, hasAvatar: true });
    expect(refuse.hasAvatar).toBe(false);
    expect(refuse.imageZone.kind).toBe(VOCAL_IMAGE_NONE);
    expect(refuse.listHeight).toBe(231 - 51);
  });

  it("le plan porte la zone : la repeinture n'a pas a la recalculer", () => {
    const plan = planVocalSides({ width: 1440, height: 900, orbSize: 336, hasAvatar: true });
    expect(Object.keys(plan.imageZone).sort()).toEqual([
      "avatar",
      "height",
      "kind",
      "portrait",
    ]);
    expect(plan.imageZone).toEqual({
      kind: VOCAL_IMAGE_AVATAR,
      height: VOCAL_AVATAR_H_PX,
      avatar: true,
      portrait: false,
    });
    expect(plan.hasAvatar).toBe(true);
    // Aucune entree ne vient d'ailleurs : les seules choses lues sont
    // `hasPortrait` et `hasAvatar`.
    expect(
      planVocalSides({ width: 1440, height: 900, orbSize: 336, hasAvatar: false }).imageZone,
    ).toEqual({ kind: VOCAL_IMAGE_NONE, height: 0, avatar: false, portrait: false });
    // Le portrait, lui, se lit aussi dans le plan — et il prend sa place sur le
    // haut fixe, pas dans la zone.
    const avecPortrait = planVocalSides({
      width: 1440,
      height: 900,
      orbSize: 336,
      hasPortrait: true,
    });
    expect(avecPortrait.hasPortrait).toBe(true);
    expect(avecPortrait.imageZone).toEqual({
      kind: VOCAL_IMAGE_PORTRAIT,
      height: 0,
      avatar: false,
      portrait: true,
    });
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
    // titre et la liste, qui sont d'autres noeuds.)
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
    // Le SEUL portrait de l'ecran est celui du personnage — et il est dans la
    // COLONNE de droite (en haut), pas dans le disque, pas dans une zone qui ne
    // dessine rien.
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

  it("elle n'est demandee que dans le SEUL cas ou la zone porte la fenetre", () => {
    const commun = {
      rect: { left: 0, top: 0, width: 320 },
      windowOrigin: { x: 0, y: 0, scaleFactor: 1 },
      avatar: { width: 160, height: 180 },
    };
    const aucun = planVocalAvatarPlacement({ ...commun, imageZone: { kind: VOCAL_IMAGE_NONE, height: 0 } });
    expect(aucun.send).toBe(false);
    expect(aucun.pose).toBeNull();
    const pose = planVocalAvatarPlacement({
      ...commun,
      imageZone: { kind: VOCAL_IMAGE_AVATAR, height: VOCAL_AVATAR_H_PX },
    });
    expect(pose.send).toBe(true);
    // Centre dans une colonne de 320 px : 80 px de chaque cote.
    expect(pose.key).toBe("80,0,160,180");
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
