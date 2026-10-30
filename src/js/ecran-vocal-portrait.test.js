// Tests — LE PORTRAIT DU PERSONNAGE ET SON NOM, DANS LE CERCLE
// (docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md § 2.4 et
// § 2.5 ; numerotation du premier jet conservee : T9, T16, T17).
//
// CE QUE CE FICHIER VERROUILLE :
//   T9  — le portrait est au CENTRE DU CERCLE (decision du proprietaire, mission
//         « ecran Vocal ») : premier enfant de `.vocal-orb`, donc AVANT le halo
//         et le bouton de relance, au plus la moitie de l'interieur du disque,
//         centre, sans repli sur le logo. Le nom est DANS le disque, juste sous
//         l'image, sur une seule ligne — c'est le SEUL nom de l'ecran.
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
describe("T9 — le portrait est au CENTRE DU CERCLE", () => {
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

  it("il VIT dans le disque, et plus dans la colonne de droite", () => {
    // Decision du proprietaire (mission « ecran Vocal ») : le personnage est au
    // centre du cercle, la colonne de droite garde la liste des taches.
    expect(disque).toMatch(/class="vocal-portrait"/);
    expect(colonne).not.toMatch(/vocal-portrait/);
    // AUCUN nom sous l'image, sinon le seul nom de l'ecran : la pastille
    // d'autrefois ne doit pas revenir par une ligne de balisage.
    expect(build).not.toMatch(/vocal-portrait-name/);
  });

  it("il vient AVANT le halo : la lueur d'ecoute et le bouton se peignent dessus", () => {
    const image = disque.indexOf('class="vocal-portrait"');
    const halo = disque.indexOf('class="vocal-halo"');
    const relance = disque.indexOf('class="vocal-restart');
    expect(image).toBeGreaterThan(-1);
    expect(halo).toBeGreaterThan(image);
    expect(relance).toBeGreaterThan(halo);
  });

  it("le CSS le CENTRE et le borne a la moitie de l'interieur du cercle", () => {
    const portrait = sliceSource(CSS, ".vocal-portrait {", "}", 10);
    // Au plus la moitie du disque : 168 px pour 336, sans une valeur en dur.
    expect(portrait).toMatch(/width:\s*calc\(var\(--vocal-orb-size\)\s*\/\s*2\)/);
    expect(portrait).toMatch(/height:\s*calc\(var\(--vocal-orb-size\)\s*\/\s*2\)/);
    // CENTRE : pose en absolu sur le milieu du disque, ramene de sa propre
    // moitie — il ne prend aucune place dans la grille.
    expect(portrait).toMatch(/position:\s*absolute/);
    expect(portrait).toMatch(/left:\s*50%/);
    expect(portrait).toMatch(/top:\s*50%/);
    expect(portrait).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
    // Rond, garni, jamais cliquable.
    expect(portrait).toMatch(/border-radius:\s*50%/);
    expect(portrait).toMatch(/object-fit:\s*cover/);
    expect(portrait).toMatch(/pointer-events:\s*none/);
    // Le medaillon de 72 px de la colonne n'existe plus nulle part.
    expect(CSS).not.toMatch(/\.vocal-portrait\s*\{[^}]*72px/);
  });

  it("le nom est DANS le disque, juste sous l'image, sur une seule ligne", () => {
    const nom = sliceSource(CSS, ".vocal-orb-name {", "}", 10);
    // En absolu sous l'image (le portrait vaut la moitie du disque et il est
    // centre : son bas est a 50 % + 25 %), plus les 6 px d'ecart du projet.
    expect(nom).toMatch(/position:\s*absolute/);
    expect(nom).toMatch(/top:\s*calc\(75% \+ 6px\)/);
    expect(nom).toMatch(/font-size:\s*var\(--font-sm\)/);
    // Une seule ligne, jamais deux noms : coupe par des points de suspension,
    // et borne a 66 % du disque pour ne jamais toucher l'anneau.
    expect(nom).toMatch(/white-space:\s*nowrap/);
    expect(nom).toMatch(/text-overflow:\s*ellipsis/);
    expect(nom).toMatch(/max-width:\s*66%/);
    expect(nom).toMatch(/pointer-events:\s*none/);
    expect(nom).not.toMatch(/pointer-events:\s*auto/);
    // L'ancienne pastille sous le bouton-cercle n'existe plus.
    expect(CSS).not.toContain(".vocal-portrait-name");
  });

  it("le nom est cree DANS le disque, une seule fois, apres le modele", () => {
    const cree = corpsFonctionEntete("function buildVocalOrbName(");
    expect(cree).toMatch(/"vocal-orb-name"/);
    expect(cree).toMatch(/disque\.appendChild\(nom\)/);
    // Il est pose sur le disque, jamais sur la colonne ni sur l'ecran entier.
    expect(build).toMatch(/buildVocalOrbName\(ov\.querySelector\("\.vocal-orb"\)\)/);
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
    const nom = corpsFonctionEntete("function applyVocalOrbName(");
    expect(nom).toMatch(/superAgentDisplayLabel\(\)/);
    // Aucun second mecanisme de nom : pas d'appel au personnage brut.
    expect(nom).not.toMatch(/getAssistantPersonaName\(\)/);
    // Le nom n'entre jamais dans du balisage.
    expect(nom).not.toMatch(/innerHTML/);
    // Et il est ecrit meme quand il n'y a aucun personnage : le nom de
    // l'Assistant prend alors la place, il n'est jamais vide.
    expect(nom).not.toMatch(/hidden\s*=\s*true/);
    // UN seul nom a l'ecran : la classe du nom est creee a UN seul endroit
    // (`buildVocalOrbName`), et le balisage n'en porte aucune autre.
    expect((SUPER.match(/"vocal-orb-name"/g) || [])).toHaveLength(1);
    expect(SUPER).not.toMatch(/class="vocal-[a-z-]*-name"/);
  });

  it("il suit le personnage au MEME point d'application que le bouton de relance", () => {
    const ui = corpsFonctionEntete("export function applyAssistantPersonaUi(");
    expect(ui).toMatch(/applyVocalRestartLabel\(\)/);
    expect(ui).toMatch(/applyVocalOrbName\(\)/);
    expect(ui).toMatch(/applyVocalPortrait\(\)/);
    // Les appels sont dans le meme `try` que le bouton de relance : un overlay
    // absent ne casse pas la suite de la fonction.
    const relance = ui.indexOf("applyVocalRestartLabel()");
    const nom = ui.indexOf("applyVocalOrbName()");
    const portrait = ui.indexOf("applyVocalPortrait()");
    expect(nom).toBeGreaterThan(relance);
    expect(portrait).toBeGreaterThan(nom);
  });

  it("rien n'est lu du disque : la lecture du personnage reste a refreshAssistantPersona", () => {
    const aplic = corpsFonctionEntete("function applyVocalPortrait(");
    expect(aplic).not.toMatch(/invoke\(/);
    expect(aplic).not.toMatch(/refreshAssistantPersona/);
  });

  it("il est pose a l'ENTREE du mode, avant la ligne d'etat", () => {
    const entree = corps("function enterVocal()", "function exitVocal()");
    expect(entree).toMatch(/applyVocalPortrait\(vocalOverlay\)/);
    // L'ORDRE des dernieres lignes : le nom dans le disque, le portrait, puis
    // l'etat, puis la largeur des colonnes (celle-ci vient en dernier pour ne
    // jamais etre recalculee deux fois).
    expect(entree).toMatch(
      /applyVocalOrbName\(vocalOverlay\);\s*applyVocalPortrait\(vocalOverlay\);\s*[\s\S]*?applyVocalState\(\);[\s\S]*vocalSyncSides\(\);[\s\S]*addEventListener\("resize", vocalSyncSides\);/,
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
