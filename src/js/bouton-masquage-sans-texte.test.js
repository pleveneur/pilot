// Verrou — LE BOUTON DE MASQUAGE PERD SON TEXTE (demande du proprietaire,
// 2026-11-02).
//
// « Le bouton du haut qui masque/reaffiche les listes perd son texte. L'icone
// reste ; position, taille et forme inchangees ; seule l'etiquette visible
// disparait. »
//
// Cette consigne REMPLACE explicitement la consigne anterieure (« ne pas changer
// le libelle du bouton de masquage », correctif du 2026-10-31 qui avait ajoute le
// texte parce que le proprietaire ne TROUVAIT pas le bouton). Ce qui reste, et
// qui doit suffire, est le NOM ACCESSIBLE : `title` ET `aria-label`, alimentes
// par `vocalBareLabel(etat)` — l'etat d'abord, l'action ensuite, mot pour mot.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. aucun texte visible n'est ecrit : ni dans le module (plus de constante
//      `VOCAL_BARE_TEXT_*`, plus de `vocalBareText()`), ni dans le bouton (aucun
//      noeud texte), ni par `vocalSyncBare` ;
//   2. la feuille de style ne garde pas la regle orpheline de l'etiquette
//      (`.vocal-display-toggle-label`) : un emplacement libre redevient un
//      endroit ou le texte revient ;
//   3. la TAILLE, la FORME et la POSITION ne bougent pas : 190 x 28 px, rayon
//      pastille `999px`, centre dans la barre, `z-index: 1` — la demande est
//      « inchangees », pas « adaptees » ;
//   4. l'intitule accessible suit l'ETAT REEL (masque / affiche) et vient de la
//      meme source que le reste (`vocalBareLabel`) ;
//   5. l'acquis `a0daf4e` tient : `vocalSyncChrome` RETIENT le bas allume quand
//      l'etat nu est pose, et le bloc d'effacement ne nomme jamais la zone de
//      saisie — elle reste affichee et utilisable dans les deux etats ;
//   6. le code du bouton n'ouvre ni reglage, ni stockage, ni IPC, ni reseau.
//
// Les commentaires sont en ASCII ; les libelles et selecteurs lus sont copies
// tels quels. Toute ancre absente LEVE (`sliceSource`) au lieu de rendre un
// fragment vide, qui rendrait les assertions negatives vraies par construction.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  VOCAL_DISPLAY_TOGGLE_CLASS,
  VOCAL_BARE_LABEL_VISIBLE,
  VOCAL_BARE_LABEL_HIDDEN,
  VOCAL_BARE_ICON_VISIBLE,
  VOCAL_BARE_ICON_HIDDEN,
  vocalBareLabel,
  vocalBareIcon,
  vocalBarePressed,
} from "./vocal-bare.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-bare.js");

const corpsBouton = () =>
  sliceSource(
    SUPER,
    "function buildVocalDisplayToggle(barre) {",
    "  /**\n   * L'UNIQUE ligne d'etat de l'ecran",
    200,
  );
const corpsSyncBare = () =>
  sliceSource(SUPER, "function vocalSyncBare() {", "  function vocalWakeChrome() {", 200);
const corpsSyncChrome = () =>
  sliceSource(SUPER, "function vocalSyncChrome(state) {", "  function vocalWakeChrome() {", 200);
const blocBouton = () => sliceSource(CSS, ".vocal-display-toggle {", "}", 200);
const blocEffacement = () =>
  sliceSource(
    CSS,
    ".pilot-vocal.vocal-bare .vocal-mic-fix,",
    ".pilot-vocal.vocal-bare .vocal-top {",
    200,
  );

describe("1. le texte visible a disparu, jusqu'au module", () => {
  it("le module ne fabrique plus aucun libelle visible", () => {
    // Les constantes et la fonction sont parties : ce qui n'existe pas ne peut
    // pas revenir dans le bouton par inadvertance.
    expect(MODULE).not.toContain("VOCAL_BARE_TEXT_VISIBLE");
    expect(MODULE).not.toContain("VOCAL_BARE_TEXT_HIDDEN");
    expect(MODULE).not.toContain("vocalBareText");
    // Et le module lui-meme ne contient plus les phrases courtes qui etaient
    // ecrites dans le bouton. Les deux libelles longs, eux, restent (nom
    // accessible).
    expect(MODULE).not.toContain("Ne garder que le portrait");
    expect(MODULE).not.toContain("Tout réafficher\"");
    expect(MODULE).toContain(VOCAL_BARE_LABEL_VISIBLE);
    expect(MODULE).toContain(VOCAL_BARE_LABEL_HIDDEN);
  });

  it("le bouton n'a plus qu'un enfant : son icone", () => {
    const bouton = corpsBouton();
    // Aucun noeud de texte, d'aucune facon que ce soit.
    expect(bouton).not.toContain("vocal-display-toggle-label");
    expect(bouton).not.toContain("textContent");
    expect(bouton).not.toContain("innerText");
    expect(bouton).not.toContain("createTextNode");
    // Un seul `bouton.appendChild`, celui de l'icone : la pastille ne porte rien
    // d'autre. (`barre.appendChild(bouton)` en est un autre, et il reste.)
    expect(bouton.match(/bouton\.appendChild\(/g)?.length).toBe(1);
    expect(bouton).toContain("bouton.appendChild(icone)");
    // Et l'icone est bien posee dans SON noeud (setIcon ecrit innerHTML).
    expect(bouton).toContain('icone.className = "vocal-display-toggle-icon"');
    expect(bouton).toContain('setIcon(icone, vocalBareIcon(false), { size: "icon-sm" })');
  });

  it("`vocalSyncBare` n'ecrit aucun texte quand l'etat change", () => {
    const sync = corpsSyncBare();
    expect(sync).not.toContain("vocal-display-toggle-label");
    expect(sync).not.toContain("textContent");
    expect(sync).not.toContain("innerText");
    expect(sync).not.toContain("vocalBareText");
    // Ce qu'il ecrit encore, et qui suffit : l'intitule accessible, l'icone,
    // `aria-pressed` et la classe d'etat.
    expect(sync).toContain("vocalBareLabel(vocalBare)");
    expect(sync).toContain("vocalBareIcon(vocalBare)");
    expect(sync).toContain("vocalBarePressed(vocalBare)");
    expect(sync).toContain("vocalBareClass(vocalBare)");
  });

  it("la feuille de style ne garde pas la regle de l'etiquette", () => {
    expect(CSS).not.toContain(".vocal-display-toggle-label");
    // L'icone, elle, garde son noeud et sa regle.
    const icone = sliceSource(CSS, ".vocal-display-toggle-icon {", "}", 40);
    expect(icone).toMatch(/display:\s*inline-flex/);
    expect(icone).toMatch(/flex:\s*0 0 auto/);
  });
});

describe("2. la taille, la forme et la position ne bougent pas", () => {
  it("190 x 28 px, rayon pastille, meme place dans la barre", () => {
    const bouton = blocBouton();
    // Ce sont EXACTEMENT les valeurs du correctif du 2026-10-31 : la demande est
    // « position, taille et forme inchangees ». `min-width` n'est plus la pour
    // couvrir un texte : elle est la TAILLE du bouton, et la retirer le
    // rendrait plus petit qu'avant.
    expect(bouton).toMatch(/min-width:\s*190px/);
    expect(bouton).toMatch(/height:\s*28px/);
    expect(bouton).toMatch(/border-radius:\s*999px/);
    expect(bouton).toMatch(/margin-inline:\s*auto/);
    expect(bouton).toMatch(/justify-content:\s*center/);
    expect(bouton).toMatch(/z-index:\s*1/);
    // Aucune largeur fixe ajoutee : la pastille garde sa forme.
    expect(bouton).not.toMatch(/(^|[;\s])width\s*:/);
    // Aucun `display: none` ni etat qui retrecirait le bouton.
    const exception = sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-top .vocal-display-toggle {", "}", 40);
    expect(exception).not.toMatch(/(^|[;\s])(width|min-width|height|padding)\s*:/);
  });

  it("le bouton porte un intitule accessible, et il suit l'ETAT REEL", () => {
    const bouton = corpsBouton();
    // `title` ET `aria-label` a la construction : la meme phrase.
    expect(bouton).toContain('bouton.setAttribute("title", vocalBareLabel(false))');
    expect(bouton).toContain('bouton.setAttribute("aria-label", vocalBareLabel(false))');
    const sync = corpsSyncBare();
    // Et les deux sont remis a jour ensemble, seulement si l'un a change.
    expect(sync).toContain("const libelle = vocalBareLabel(vocalBare);");
    expect(sync).toContain('bouton.getAttribute("title") !== libelle');
    expect(sync).toContain('bouton.setAttribute("aria-label", libelle)');
  });

  it("les phrases accessibles sont celles du module, mot pour mot, dans les deux etats", () => {
    // Tout visible : l'action est de ne garder que le portrait.
    expect(vocalBareLabel(false)).toBe(VOCAL_BARE_LABEL_VISIBLE);
    expect(vocalBareLabel(false)).toBe("tout est visible — cliquer pour ne garder que le portrait");
    // Tout masque : l'action est de tout remontrer.
    expect(vocalBareLabel(true)).toBe(VOCAL_BARE_LABEL_HIDDEN);
    expect(vocalBareLabel(true)).toBe("tout est masqué — cliquer pour tout réafficher");
    // Le mot est « portrait » quand il s'agit de le garder, jamais
    // « personnage » ; et le tiret est cadratin.
    expect(vocalBareLabel(false)).toContain("portrait");
    for (const phrase of [vocalBareLabel(false), vocalBareLabel(true)]) {
      expect(phrase).not.toContain("personnage");
      expect(phrase).toContain("\u2014");
    }
    // L'icone et `aria-pressed` suivent le meme etat.
    expect(vocalBareIcon(false)).toBe(VOCAL_BARE_ICON_VISIBLE);
    expect(vocalBareIcon(true)).toBe(VOCAL_BARE_ICON_HIDDEN);
    expect(vocalBarePressed(false)).toBe(true);
    expect(vocalBarePressed(true)).toBe(false);
    // Une valeur illisible vaut « tout visible » : l'ecran ne reste jamais nu
    // par accident.
    expect(vocalBareLabel(undefined)).toBe(VOCAL_BARE_LABEL_VISIBLE);
    expect(vocalBareLabel("oui")).toBe(VOCAL_BARE_LABEL_VISIBLE);
  });

  it("la classe du bouton reste la source unique du selecteur", () => {
    expect(VOCAL_DISPLAY_TOGGLE_CLASS).toBe("vocal-display-toggle");
    expect(SUPER).toContain("bouton.className = VOCAL_DISPLAY_TOGGLE_CLASS");
    expect(CSS).toContain(".vocal-display-toggle {");
  });
});

describe("3. les acquis voisins ne sont pas casses", () => {
  it("`a0daf4e` : l'etat nu RETIENT le bas allume (la zone de saisie reste la)", () => {
    const chrome = corpsSyncChrome();
    // `vocalBare ||` est le terme qui empeche le bas de s'effacer quand tout est
    // masque : sans lui, la zone de saisie disparaissait avec le reste.
    expect(chrome).toMatch(/vocalBare\s*\|\|/);
  });

  it("le bloc d'effacement ne nomme ni la zone de saisie ni le disque", () => {
    // Les commentaires sont neutralises : c'est la REGLE qui compte, pas la
    // phrase qui explique pourquoi la zone de saisie (2026-11-01) et le disque
    // (2026-11-02) n'y figurent pas.
    const effacement = blocEffacement();
    expect(neutraliserSource(effacement)).not.toContain(".vocal-input");
    expect(neutraliserSource(effacement)).not.toContain(".vocal-orb");
    expect(effacement).not.toMatch(/display:\s*none/);
  });

  it("le code du bouton n'ouvre ni reglage, ni stockage, ni IPC, ni reseau", () => {
    const code = corpsBouton() + corpsSyncBare();
    for (const interdit of ["localStorage", "sessionStorage", "invoke(", "fetch("]) {
      expect(code).not.toContain(interdit);
    }
  });
});
