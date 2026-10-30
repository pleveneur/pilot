// Tests — LE PORTRAIT DU PERSONNAGE ET SON NOM, EN HAUT A DROITE DE L'ECRAN
// (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md § 2.4, § 2.5
// et § 7bis ; numerotation du premier jet conservee : T9, T16, T17).
//
// CORRECTION DU 2026-10-31 (decision du proprietaire, qui ANNULE la mission
// « ecran Vocal » du 2026-10-30) : l'image QUITTE le centre du cercle et revient
// EN HAUT A DROITE de l'ecran, dans la colonne de droite, avec la liste des
// taches DESSOUS. Le disque ne porte plus RIEN : ni image, ni nom.
//
// CE QUE CE FICHIER VERROUILLE :
//   T9  — le portrait est en HAUT A DROITE (premier contenu de la colonne de
//         droite, au-dessus de la liste), le disque reste vide, et le nom est
//         SOUS l'image, sur une seule ligne — c'est le SEUL nom de l'ecran.
//   T16 — le lot n'ecrit RIEN : ni fichier, ni `localStorage`, ni config. L'etat
//         des colonnes ne survit pas a la sortie de l'ecran.
//   T17 — la sortie de l'ecran reste cliquable : les colonnes ne captent aucun
//         clic, ne contiennent aucun noeud focusable, les six hotes de l'issue
//         #381 sont exactement six, et Echap est toujours gere.
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

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const SIDES = lire("src/js/vocal-sides.js");

/**
 * Fragment de `super-agent.js` entre deux ancres, par le decoupage VERIFIE : une
 * ancre absente LEVE au lieu de rendre un fragment vide (quality-gate §3.4). Le
 * fragment inclut toujours du contexte (40 caracteres au moins), pour qu aucune
 * assertion negative ne puisse etre vraie par construction.
 */
function corps(debut, fin) {
  return sliceSource(SUPER, debut, fin, 40);
}

/** Le corps d une fonction de PREMIER niveau (accolade fermante en colonne 1). */
function corpsFonctionEntete(debut) {
  return corps(debut, "\n}\n");
}

// ---------------------------------------------------------------------------
describe("T9 — le portrait est en HAUT A DROITE, le disque reste vide", () => {
  const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
  // La colonne de droite, du debut de son balisage a sa fermeture.
  const colonne = sliceSource(
    build,
    '<aside class="vocal-side-tasks vocal-side">',
    "</aside>",
    20,
  );
  // Le disque : de son ouverture au bouton de depannage du micro, qui le suit.
  const disque = sliceSource(
    build,
    '<div class="vocal-orb">',
    '<button type="button" class="vocal-mic-fix',
    20,
  );

  it("il VIT dans la colonne de droite, et plus dans le disque", () => {
    // Decision du proprietaire (2026-10-31) : le personnage est en haut a droite
    // de l'ecran, la liste des taches vient dessous. Le cercle ne porte RIEN.
    expect(colonne).toMatch(/class="vocal-portrait"/);
    expect(disque).not.toMatch(/vocal-portrait/);
    // Et aucun nom dans le disque : la seule legende de l'ecran est celle de
    // l'image, creee a l'execution sous elle (`buildVocalPortraitName`).
    expect(disque).not.toMatch(/vocal-orb-name/);
    expect(disque).not.toMatch(/-name/);
  });

  it("il vient AVANT la liste des taches, qui commence SOUS lui", () => {
    const image = colonne.indexOf('class="vocal-portrait"');
    const liste = colonne.indexOf('class="vocal-side-body"');
    expect(image).toBeGreaterThan(-1);
    expect(liste).toBeGreaterThan(-1);
    // Le portrait est le PREMIER contenu de la colonne : la liste vient apres,
    // donc dessous. (Le titre des taches, lui, est cree a l'execution en tete de
    // la colonne par `vocalRenderColumn` : il est au-dessus de l'image.)
    expect(image).toBeLessThan(liste);
    // Le disque, lui, garde son ordre interne : halo puis bouton de relance.
    const halo = disque.indexOf('class="vocal-halo"');
    const relance = disque.indexOf('class="vocal-restart');
    expect(halo).toBeGreaterThan(-1);
    expect(relance).toBeGreaterThan(halo);
  });

  it("le CSS le pose en medaillon de 72 px dans la colonne, jamais sur le disque", () => {
    const portrait = sliceSource(CSS, ".vocal-portrait {", "}", 10);
    expect(portrait).toMatch(/width:\s*72px/);
    expect(portrait).toMatch(/height:\s*72px/);
    // Rond, garni, centre dans sa colonne, jamais cliquable.
    expect(portrait).toMatch(/border-radius:\s*50%/);
    expect(portrait).toMatch(/object-fit:\s*cover/);
    expect(portrait).toMatch(/align-self:\s*center/);
    expect(portrait).toMatch(/pointer-events:\s*none/);
    // La pose du disque a DISPARU : plus de position absolue, plus de moitie du
    // disque, plus de translation de centrage.
    expect(portrait).not.toMatch(/position:\s*absolute/);
    expect(portrait).not.toMatch(/--vocal-orb-size/);
    expect(portrait).not.toMatch(/translate\(/);
  });

  it("le nom est SOUS l'image, dans la colonne, sur une seule ligne", () => {
    const nom = sliceSource(CSS, ".vocal-portrait-name {", "}", 10);
    // Sous l'image : 6 px d'ecart, 20 px de haut — le bloc du personnage vaut
    // donc 72 + 6 + 20 = 98 px, exactement ce que compte `vocal-sides.js`.
    expect(nom).toMatch(/margin-block:\s*6px 0/);
    expect(nom).toMatch(/height:\s*20px/);
    expect(nom).toMatch(/font-size:\s*var\(--font-sm\)/);
    // Une seule ligne, jamais deux noms : coupe par des points de suspension.
    expect(nom).toMatch(/white-space:\s*nowrap/);
    expect(nom).toMatch(/text-overflow:\s*ellipsis/);
    expect(nom).toMatch(/pointer-events:\s*none/);
    expect(nom).not.toMatch(/pointer-events:\s*auto/);
    // Plus rien dans le disque : l'ancienne legende du cercle n'existe plus.
    expect(CSS).not.toContain(".vocal-orb-name");
    // Et la regle du medaillon ne porte plus aucune borne liee au disque.
    expect(CSS).not.toMatch(/\.vocal-orb-name\s*\{/);
  });

  it("le nom est cree SOUS le portrait, une seule fois, apres le modele", () => {
    const cree = corpsFonctionEntete("function buildVocalPortraitName(");
    expect(cree).toMatch(/"vocal-portrait-name"/);
    // Pose JUSTE APRES l'image (`afterend`), donc sous elle dans la colonne.
    expect(cree).toMatch(/insertAdjacentElement\("afterend"/);
    // Il est pose sur le portrait de la COLONNE, jamais sur le disque.
    expect(build).toMatch(
      /buildVocalPortraitName\(ov\.querySelector\("\.vocal-side-tasks \.vocal-portrait"\)\)/,
    );
    // UN seul nom a l'ecran : la classe du nom est creee a UN seul endroit, et le
    // balisage statique n'en porte aucune.
    expect(SUPER.match(/"vocal-portrait-name"/g) || []).toHaveLength(1);
    expect(SUPER).not.toMatch(/class="vocal-[a-z-]*-name"/);
  });

  it("la source du portrait est getAssistantPortrait(), SANS repli sur le logo", () => {
    const aplic = corpsFonctionEntete("function applyVocalPortrait(");
    expect(aplic).toMatch(/getAssistantPortrait\(\)/);
    expect(aplic).not.toMatch(/logo_pilot_vector\.svg/);
    // L'image est cachee quand il n'y a pas de personnage : hidden, pas une
    // image de remplacement.
    expect(aplic).toMatch(/img\.hidden = false/);
    expect(aplic).toMatch(/img\.hidden = true/);
  });

  it("`src` n'est ecrit que s'il change (reafficher ne recharge pas)", () => {
    const aplic = corpsFonctionEntete("function applyVocalPortrait(");
    expect(aplic).toMatch(/img\.getAttribute\("src"\) !== source/);
    expect(aplic).toMatch(/img\.src = source/);
  });

  it("le nom est ecrit par la SEULE regle de nom : superAgentDisplayLabel()", () => {
    const aplic = corpsFonctionEntete("function applyVocalPortrait(");
    expect(aplic).toMatch(/superAgentDisplayLabel\(\)/);
    // Aucun second mecanisme de nom : pas d'appel au personnage brut.
    expect(aplic).not.toMatch(/getAssistantPersonaName\(\)/);
    // Le nom n'entre jamais dans du balisage (il vient d'un fichier externe).
    expect(aplic).not.toMatch(/innerHTML/);
    expect(aplic).toMatch(/textContent/);
    // Le nom suit la VISIBILITE de l'image : une legende sans image ne reste pas
    // orpheline au-dessus des taches.
    expect(aplic).toMatch(/legende\.hidden = !source/);
  });

  it("il suit le personnage au MEME point d'application que le bouton de relance", () => {
    const ui = corpsFonctionEntete("export function applyAssistantPersonaUi(");
    expect(ui).toMatch(/applyVocalRestartLabel\(\)/);
    expect(ui).toMatch(/applyVocalPortrait\(\)/);
    // Plus aucun nom dans le disque : le seul nom est celui du portrait.
    expect(ui).not.toMatch(/applyVocalOrbName/);
    expect(SUPER).not.toMatch(/applyVocalOrbName|buildVocalOrbName/);
    // Les appels sont dans le meme `try` que le bouton de relance : un overlay
    // absent ne casse pas la suite de la fonction.
    const relance = ui.indexOf("applyVocalRestartLabel()");
    const portrait = ui.indexOf("applyVocalPortrait()");
    expect(portrait).toBeGreaterThan(relance);
  });

  it("rien n'est lu du disque : la lecture du personnage reste a refreshAssistantPersona", () => {
    const aplic = corpsFonctionEntete("function applyVocalPortrait(");
    expect(aplic).not.toMatch(/invoke\(/);
    expect(aplic).not.toMatch(/refreshAssistantPersona/);
  });

  it("il est pose a l'ENTREE du mode, avant la ligne d'etat", () => {
    const entree = corps("function enterVocal()", "function exitVocal()");
    expect(entree).toMatch(/applyVocalPortrait\(vocalOverlay\)/);
    // L'ORDRE des dernieres lignes : le portrait (et son nom avec lui), puis
    // l'etat, puis la largeur des colonnes (celle-ci vient en dernier pour ne
    // jamais etre recalculee deux fois).
    expect(entree).toMatch(
      /applyVocalPortrait\(vocalOverlay\);[\s\S]*?applyVocalState\(\);[\s\S]*vocalSyncSides\(\);[\s\S]*addEventListener\("resize", vocalSyncSides\);/,
    );
  });
});

// ---------------------------------------------------------------------------
describe("T16 — aucune ecriture, aucune trace", () => {
  it("le calcul des colonnes est PUR : ni Tauri, ni stockage, ni reseau", () => {
    for (const interdit of ["invoke", "localStorage", "sessionStorage", "fetch", "indexedDB"]) {
      expect(SIDES, `vocal-sides.js ecrit ou lit ${interdit}`).not.toContain(interdit);
    }
    // Aucun import du tout : il ne peut donc rien atteindre.
    expect(SIDES).not.toMatch(/^\s*import\s/m);
  });

  it("l'etat des colonnes n'est ecrit NULLE PART en dehors de l'overlay", () => {
    const sync = corpsFonctionEntete("function vocalSyncSides(");
    expect(sync).not.toMatch(/invoke\(/);
    expect(sync).not.toMatch(/localStorage/);
    expect(sync).not.toMatch(/fetch\(/);
    // Deux ecritures, et ce sont les seules attendues : la largeur et la classe.
    expect(sync).toMatch(/setProperty\("--vocal-side"/);
    expect(sync).toMatch(/classList\.toggle\("vocal-sides-off"/);
    // Aucune config, aucun reglage, aucun journal.
    expect(SUPER).not.toMatch(/localStorage\.setItem\(\s*["']pilot_vocal_side/);
  });

  it("la sortie ne laisse aucun ecouteur derriere l'ecran", () => {
    const entree = corps("function enterVocal()", "function exitVocal()");
    const sortie = corps("function exitVocal()", "function autoReadVocalReply");
    expect(entree).toMatch(/window\.addEventListener\("resize", vocalSyncSides\)/);
    expect(sortie).toMatch(/window\.removeEventListener\("resize", vocalSyncSides\)/);
  });
});

// ---------------------------------------------------------------------------
describe("T17 — la sortie de l'ecran reste cliquable", () => {
  const build = corps("function buildVocalOverlay()", "function vocalStatusLine");
  const HOTES = [
    ".vocal-top",
    ".vocal-stage",
    ".vocal-status",
    ".vocal-input",
    "#mode-logo",
    "#agent-activity",
  ];

  it("les colonnes laissent passer le clic et ne portent aucun noeud focusable", () => {
    const colonnes = sliceSource(CSS, ".vocal-side {", "}", 10);
    expect(colonnes).toMatch(/pointer-events:\s*none/);
    const droite = sliceSource(
      build,
      '<aside class="vocal-side-tasks vocal-side">',
      "</aside>",
      20,
    );
    const gauche = sliceSource(
      build,
      '<aside class="vocal-side-discussion vocal-side">',
      "</aside>",
      20,
    );
    for (const [nom, colonne] of [
      ["droite", droite],
      ["gauche", gauche],
    ]) {
      expect(colonne, `la colonne de ${nom} porte un bouton`).not.toMatch(/<button/);
      expect(colonne, `la colonne de ${nom} porte un lien`).not.toMatch(/<a[\s>]/);
      expect(colonne, `la colonne de ${nom} est focusable`).not.toMatch(/tabindex/);
    }
  });

  it("les six hotes de l'ecran sont EXACTEMENT six, et captent le clic", () => {
    // La seule regle de reactivation de la section (« CE QUI RESTE CLIQUABLE »),
    // lue du premier selecteur jusqu'a son accolade fermante ; la liste de ses
    // selecteurs est lue jusqu'a l'ouvrante (deux decoupages VERIFIES).
    const regle = sliceSource(CSS, ".pilot-vocal .vocal-top", "}", 20);
    const liste = sliceSource(CSS, ".pilot-vocal .vocal-top", "{", 20);
    expect(regle).toMatch(/pointer-events:\s*auto/);
    const selecteurs = liste
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    expect(selecteurs.length).toBe(6);
    for (const hote of HOTES) {
      expect(selecteurs, `hote manquant : ${hote}`).toContain(`.pilot-vocal ${hote}`);
    }
  });

  it("ECHAP ferme toujours l'ecran, sans voler Echap a une modale ouverte", () => {
    const touche = corps(
      "const onVocalKeydown = (e) => {",
      'document.addEventListener("keydown", onVocalKeydown);',
    );
    expect(touche).toMatch(/e\.key !== "Escape"/);
    expect(touche).toContain("exitVocal();");
    // L'ORDRE compte : une modale ouverte garde Echap pour elle.
    expect(touche.indexOf(".modal:not(.hidden)")).toBeGreaterThan(-1);
    expect(touche.indexOf(".modal:not(.hidden)")).toBeLessThan(
      touche.indexOf("exitVocal();"),
    );
  });
});
