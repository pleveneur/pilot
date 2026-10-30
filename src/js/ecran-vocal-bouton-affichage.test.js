// Tests — LE BOUTON UNIQUE DE L'ECRAN VOCAL : TOUT MASQUER SAUF LE PORTRAIT.
//
// Decision du proprietaire tranchee le 2026-10-29 (decision 9, section 6 de
// docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md) : un SEUL
// petit bouton, present dans l'ecran Vocal et LA SEULEMENT, masque tout ce que
// l'ecran affiche — sauf le portrait du personnage — puis remet tout en place du
// meme geste.
//
// CE QUE CE FICHIER VERROUILLE, dans l'ordre du document (section 6.10) :
//   1. le bouton est un enfant de la barre `.vocal-top`, et le modele de l'ecran
//      garde `<div class="vocal-top"></div>` (la liste ordonnee des classes de
//      `buildVocalOverlay` ne gagne aucune entree) ;
//   2. `aria-pressed` vaut vrai quand tout est visible, faux quand tout est masque ;
//   3. l'infobulle ET l'`aria-label` disent l'etat puis l'action, mot pour mot, et
//      changent avec l'etat ;
//   4. l'icone passe de `eye` a `eye-off` et retour ; la taille du bouton, elle,
//      ne change jamais ;
//   5. le bouton n'est JAMAIS `hidden` ni `disabled`, meme quand les colonnes ne
//      tiennent pas dans la fenetre ;
//   6. le bloc `vocal-bare` ne nomme NI `.vocal-portrait` NI `.vocal-portrait-name` ;
//   7. il nomme bien le disque, le bouton du micro, la ligne d'etat, la saisie et
//      les deux colonnes ;
//   8. il ne contient ni `display: none`, ni regle de hauteur, de marge, de
//      padding ou de position ;
//   9. `vocalSyncChrome` contient `!vocalBare &&` ;
//  10. `enterVocal()` remet le booleen a « tout visible » AVANT `vocalSyncSides()` ;
//  11. le code du bouton ne contient ni `localStorage`, ni `invoke`, ni `fetch`.
//
// S'y ajoutent les deux exigences du proprietaire pour ce lot : le masquage est un
// FONDU de 180 ms (jamais un instantane), et SANS PERSONNAGE il ne reste que le
// bouton — le disque ne demeure pas pour lui tenir compagnie.
//
// Les commentaires sont en ASCII ; les libelles, les selecteurs CSS et les
// extraits de code lus sont copies tels quels depuis les fichiers sources.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage verifie : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture).
import { sliceSource, neutraliserSource } from "./source-slice.js";
import {
  VOCAL_BARE_CLASS,
  VOCAL_DISPLAY_TOGGLE_CLASS,
  VOCAL_BARE_LABEL_VISIBLE,
  VOCAL_BARE_LABEL_HIDDEN,
  VOCAL_BARE_ICON_VISIBLE,
  VOCAL_BARE_ICON_HIDDEN,
  VOCAL_BARE_FADE_MS,
  normalizeVocalBare,
  vocalBareLabel,
  vocalBareIcon,
  vocalBarePressed,
  vocalBareClass,
  vocalBareNext,
} from "./vocal-bare.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-bare.js");

// Les corps de fonctions lus : chacun est decoupe entre deux ancres qui DOIVENT
// exister, sinon `sliceSource` leve et le test echoue bruyamment.
const corpsBouton = () =>
  sliceSource(
    SUPER,
    "function buildVocalDisplayToggle(barre) {",
    "  /**\n   * L'UNIQUE ligne d'etat de l'ecran",
    200,
  );
const corpsSyncBare = () =>
  sliceSource(SUPER, "function vocalSyncBare() {", "  function vocalWakeChrome() {", 200);
const corpsOverlay = () =>
  sliceSource(
    SUPER,
    "function buildVocalOverlay() {",
    "  /**\n   * LE BOUTON UNIQUE DE MASQUAGE",
    200,
  );
const corpsSyncChrome = () =>
  sliceSource(SUPER, "function vocalSyncChrome(state) {", "  function vocalWakeChrome() {", 200);
const corpsEnterVocal = () =>
  sliceSource(SUPER, "function enterVocal() {", "  function exitVocal() {", 200);

// Les blocs CSS, decoupes par leurs selecteurs (aucun selecteur ecrit deux fois).
const blocBouton = () => sliceSource(CSS, ".vocal-display-toggle {", "}", 200);
const blocEffacement = () =>
  sliceSource(
    CSS,
    ".pilot-vocal.vocal-bare .vocal-orb,",
    ".pilot-vocal.vocal-bare .vocal-input {",
    200,
  );
const blocSaisie = () =>
  sliceSource(
    CSS,
    ".pilot-vocal.vocal-bare .vocal-input {",
    ".pilot-vocal.vocal-bare .vocal-top {",
    60,
  );
const blocException = () =>
  sliceSource(
    CSS,
    ".pilot-vocal.vocal-bare .vocal-top .vocal-display-toggle {",
    "}",
    60,
  );
const blocBarre = () => sliceSource(CSS, ".pilot-vocal.vocal-bare .vocal-top {", "}", 40);
const blocReduit = () =>
  sliceSource(
    CSS,
    ".pilot-vocal.vocal-reduced.vocal-bare .vocal-side-discussion,",
    "}",
    60,
  );

describe("1. les deux libelles, mot pour mot (section 6.4)", () => {
  it("l'etat d'abord, l'action ensuite, avec le tiret cadratin", () => {
    expect(VOCAL_BARE_LABEL_VISIBLE).toBe(
      "tout est visible — cliquer pour ne garder que le portrait",
    );
    expect(VOCAL_BARE_LABEL_HIDDEN).toBe("tout est masqué — cliquer pour tout réafficher");
  });

  it("le mot est « le portrait », jamais « le personnage »", () => {
    expect(VOCAL_BARE_LABEL_VISIBLE).not.toMatch(/personnage/i);
    expect(VOCAL_BARE_LABEL_HIDDEN).not.toMatch(/personnage/i);
  });

  it("le module est la SEULE source des libelles : aucune copie dans le code", () => {
    expect(SUPER).not.toContain("cliquer pour ne garder que le portrait");
    expect(SUPER).not.toContain("cliquer pour tout réafficher");
    // Et la feuille de style n'ecrit jamais une phrase a la place du code.
    expect(CSS).not.toContain("cliquer pour ne garder que le portrait");
  });
});

describe("2. la decision pure : bascule aller-retour, sans etat memorise", () => {
  it("l'etat part de « tout visible » et rien d'autre n'est vrai", () => {
    expect(normalizeVocalBare(false)).toBe(false);
    expect(normalizeVocalBare(undefined)).toBe(false);
    expect(normalizeVocalBare(null)).toBe(false);
    expect(normalizeVocalBare(0)).toBe(false);
    expect(normalizeVocalBare("")).toBe(false);
    // Un etat illisible ne laisse JAMAIS l'ecran masque.
    expect(normalizeVocalBare("oui")).toBe(false);
    expect(normalizeVocalBare(true)).toBe(true);
  });

  it("la bascule fait l'aller ET le retour, indefiniment", () => {
    let etat = false;
    const suite = [];
    for (let i = 0; i < 4; i += 1) {
      etat = vocalBareNext(etat);
      suite.push(vocalBareLabel(etat), vocalBareIcon(etat), vocalBarePressed(etat));
    }
    expect(suite).toEqual([
      VOCAL_BARE_LABEL_HIDDEN,
      VOCAL_BARE_ICON_HIDDEN,
      false,
      VOCAL_BARE_LABEL_VISIBLE,
      VOCAL_BARE_ICON_VISIBLE,
      true,
      VOCAL_BARE_LABEL_HIDDEN,
      VOCAL_BARE_ICON_HIDDEN,
      false,
      VOCAL_BARE_LABEL_VISIBLE,
      VOCAL_BARE_ICON_VISIBLE,
      true,
    ]);
  });

  it("l'icone est la paire de tous les logiciels : eye / eye-off", () => {
    expect(VOCAL_BARE_ICON_VISIBLE).toBe("eye");
    expect(VOCAL_BARE_ICON_HIDDEN).toBe("eye-off");
    // Ce sont bien des icones du projet (Lucide) : rien a dessiner, rien a
    // installer de plus.
    expect(MODULE).not.toMatch(/from "lucide"/);
  });

  it("aria-pressed refleter l'ETAT : vrai quand tout est visible", () => {
    expect(vocalBarePressed(false)).toBe(true);
    expect(vocalBarePressed(true)).toBe(false);
  });

  it("la classe d'etat est ecrite une seule fois, et se retire par chaine vide", () => {
    expect(VOCAL_BARE_CLASS).toBe("vocal-bare");
    expect(vocalBareClass(false)).toBe("");
    expect(vocalBareClass(true)).toBe("vocal-bare");
    // Une seule declaration de cette classe dans tout le module.
    expect(MODULE.match(/"vocal-bare"/g)?.length).toBe(1);
  });

  it("aucun reglage, aucune persistance dans le module", () => {
    for (const interdit of ["localStorage", "sessionStorage", "invoke(", "fetch(", "setInterval"]) {
      expect(MODULE).not.toContain(interdit);
    }
  });
});

describe("3. le bouton existe dans l'ecran Vocal, et LA SEULEMENT", () => {
  it("le modele de la barre est inchange : `<div class=\"vocal-top\"></div>`", () => {
    // La liste ordonnee des classes de `buildVocalOverlay` ne gagne aucune
    // entree : le bouton est AJOUTE APRES le modele.
    const overlay = corpsOverlay();
    expect(overlay).toContain('<div class="vocal-top"></div>');
    const classes = [...overlay.matchAll(/class="(vocal-[a-z-]+)/g)].map((m) => m[1]);
    expect(classes).not.toContain(VOCAL_DISPLAY_TOGGLE_CLASS);
  });

  it("il est pose dans la barre, par le seul appel de `buildVocalOverlay`", () => {
    const overlay = corpsOverlay();
    expect(overlay).toContain('buildVocalDisplayToggle(ov.querySelector(".vocal-top"))');
    // Une definition et UN appel (le commentaire d'import nomme la fonction sans
    // parentheses) : aucun second point de pose dans le fichier.
    expect(SUPER.match(/buildVocalDisplayToggle\(/g)?.length).toBe(2);
  });

  it("il n'existe pas dans « Assistant seul » ni ailleurs", () => {
    const immersif = sliceSource(
      SUPER,
      "function buildImmersiveOverlay() {",
      "  function enterImmersive() {",
      200,
    );
    expect(immersif).not.toContain("buildVocalDisplayToggle");
    expect(immersif).not.toContain(VOCAL_DISPLAY_TOGGLE_CLASS);
    // Le nom de la classe du bouton n'est ecrit qu'a UN endroit du code : dans
    // le module pur, pas recopie dans l'ecran.
    expect(SUPER).not.toContain('"vocal-display-toggle"');
  });

  it("il n'est jamais `hidden` ni `disabled` (il commande une chose toujours la)", () => {
    const bouton = corpsBouton();
    expect(bouton).not.toContain("disabled");
    expect(bouton).not.toContain("hidden");
    expect(bouton).not.toContain(".hidden");
    // Et aucune regle CSS de la feuille ne l'eteint par ces deux etats.
    expect(CSS).not.toMatch(/vocal-display-toggle\.hidden/);
    expect(CSS).not.toMatch(/vocal-display-toggle\[hidden\]/);
  });

  it("il ne porte pas d'`aria-controls` : il commande l'ecran, pas un noeud nomme", () => {
    expect(corpsBouton()).not.toContain("aria-controls");
  });

  it("il n'ajoute aucun hote cliquable : le clic vient de la barre, par heritage", () => {
    // `pointer-events` est une propriete HERITEE et `.vocal-top` est l'un des six
    // hotes (issue #381). Declarer `pointer-events: auto` sur le bouton en ferait
    // un septieme hote aux yeux du verrou `vocal-aucun-calque-ne-capte-les-clics`.
    // Les commentaires sont neutralises : c'est la REGLE qui compte, pas la phrase
    // qui explique pourquoi il n'y en a pas.
    expect(neutraliserSource(blocBouton())).not.toMatch(/pointer-events\s*:/);
    expect(neutraliserSource(blocException())).not.toMatch(/pointer-events\s*:/);
    // La barre, elle, garde bien le clic.
    expect(CSS).toMatch(/\.pilot-vocal \.vocal-top,[\s\S]{0,400}?pointer-events:\s*auto/);
  });
});

describe("4. les trois etats du bouton : libelle, icone, aria-pressed", () => {
  it("a la construction : tout est visible, l'oeil est ouvert", () => {
    const bouton = corpsBouton();
    expect(bouton).toContain("vocalBareLabel(false)");
    expect(bouton).toContain("vocalBarePressed(false)");
    expect(bouton).toContain("vocalBareIcon(false)");
    expect(bouton).toContain("setIcon(bouton, vocalBareIcon(false), { size: \"icon-sm\" })");
    // Le `title` ET l'`aria-label` portent la MEME phrase.
    expect(bouton).toContain('bouton.setAttribute("title", vocalBareLabel(false))');
    expect(bouton).toContain('bouton.setAttribute("aria-label", vocalBareLabel(false))');
  });

  it("au clic : la bascule pure, puis le seul point d'ecriture", () => {
    const bouton = corpsBouton();
    expect(bouton).toContain("vocalBare = vocalBareNext(vocalBare);");
    expect(bouton).toContain("vocalSyncBare();");
    // Aucun second mecanisme : pas de minuteur, pas d'ecouteur hors du clic.
    expect(bouton).not.toContain("setInterval");
    expect(bouton).not.toContain("setTimeout");
    // Le clic est pose UNE fois, sur le bouton lui-meme.
    expect(bouton.match(/addEventListener/g)?.length).toBe(1);
    expect(bouton).toContain('bouton.addEventListener("click"');
  });

  it("`vocalSyncBare` suit l'etat : libelle, aria-pressed, icone, classe", () => {
    const sync = corpsSyncBare();
    expect(sync).toContain("vocalBareLabel(vocalBare)");
    expect(sync).toContain("vocalBarePressed(vocalBare)");
    expect(sync).toContain("vocalBareIcon(vocalBare)");
    expect(sync).toContain("vocalBareClass(vocalBare)");
    // La classe est posee sur l'OVERLAY, pas sur le bouton.
    expect(sync).toContain("vocalOverlay.classList.toggle(VOCAL_BARE_CLASS");
    // Et l'ecriture n'a lieu que si la valeur change : pas de clignotement au tic
    // de 900 ms qui repasse a cote.
    expect(sync).toContain('bouton.getAttribute("title") !== libelle');
    expect(sync).toContain('bouton.getAttribute("aria-pressed") !== presse');
    expect(sync).toContain("bouton.dataset.vocalBareIcon !== icone");
  });

  it("`vocalSyncBare` rend la main au point d'ecriture du bas", () => {
    const sync = corpsSyncBare();
    expect(sync).toContain("vocalSyncChrome();");
    // Un seul appel, et il vient APRES l'ecriture de la classe.
    expect(sync.indexOf("classList.toggle")).toBeLessThan(sync.lastIndexOf("vocalSyncChrome();"));
  });

  it("le code du bouton n'ouvre ni reglage, ni stockage, ni IPC, ni reseau", () => {
    const code = corpsBouton() + corpsSyncBare();
    for (const interdit of ["localStorage", "sessionStorage", "invoke(", "fetch("]) {
      expect(code).not.toContain(interdit);
    }
  });
});

describe("5. la taille du bouton ne change pas d'un etat a l'autre", () => {
  it("28 x 24 px, icone seule de 14 px (`icon-sm`), rayon pastille", () => {
    const bouton = blocBouton();
    expect(bouton).toMatch(/width:\s*28px/);
    expect(bouton).toMatch(/height:\s*24px/);
    expect(bouton).toMatch(/border-radius:\s*999px/);
    expect(blocException()).not.toMatch(/(^|[;\s])width\s*:/);
    expect(blocException()).not.toMatch(/(^|[;\s])height\s*:/);
    expect(blocException()).not.toMatch(/(^|[;\s])padding\s*:/);
  });

  it("il ne prend JAMAIS une couleur d'etat `--vocal-*` : ce n'est pas la voix", () => {
    expect(blocBouton()).not.toContain("--vocal-state");
    expect(blocBouton()).not.toMatch(/--vocal-(rest|listen|think|speak)/);
    expect(blocException()).not.toContain("--vocal-state");
    // Sous le logo (2) : si les deux se touchaient, la sortie gagne.
    expect(blocBouton()).toMatch(/z-index:\s*1/);
  });

  it("il est centre dans la bande de 44 px, sans la remplir", () => {
    const bouton = blocBouton();
    expect(bouton).toMatch(/margin-inline:\s*auto/);
    // La barre, elle, garde ses 44 px : le bouton flotte dedans.
    expect(sliceSource(CSS, ".vocal-top {", "}", 100)).toMatch(/height:\s*44px/);
  });
});

describe("6. l'etat masque : une seule classe, un seul ecrivain", () => {
  it("la classe est posee sur l'overlay par `vocalSyncBare`, nulle part ailleurs", () => {
    // `VOCAL_BARE_CLASS` n'est utilise qu'a un endroit de l'ecran.
    expect(SUPER.match(/VOCAL_BARE_CLASS/g)?.length).toBe(2); // import + usage
    // Et aucune autre fonction n'ecrit la classe en clair.
    expect(SUPER).not.toContain('classList.add("vocal-bare")');
    expect(SUPER).not.toContain('classList.remove("vocal-bare")');
  });

  it("aucune minuterie ni aucun ecouteur propre a l'etat nu", () => {
    const sync = corpsSyncBare();
    expect(sync).not.toContain("setInterval");
    expect(sync).not.toContain("setTimeout");
    expect(sync).not.toContain("addEventListener");
    expect(sync).not.toContain("requestAnimationFrame");
  });

  it("`vocalSyncChrome` tient compte de l'etat nu : `!vocalBare &&`", () => {
    const chrome = corpsSyncChrome();
    expect(chrome).toContain("!vocalBare &&");
    // C'est bien la condition de VISIBILITE du bas qui est gardee.
    expect(chrome).toContain("const visible = !vocalBare &&");
  });

  it("on entre TOUJOURS avec tout visible, et rien ne survit a la sortie", () => {
    const entree = corpsEnterVocal();
    expect(entree).toContain("vocalBare = normalizeVocalBare(false);");
    expect(entree).toContain("vocalSyncBare();");
    // Ordre exige : la remise a lieu AVANT la peinture des colonnes.
    expect(entree.indexOf("vocalBare = normalizeVocalBare(false);")).toBeLessThan(
      entree.indexOf("vocalSyncSides();"),
    );
    // Et la sortie remet le booleen a zero (aucune memorisation).
    const sortie = sliceSource(SUPER, "function exitVocal() {", "  function autoReadVocalReply() {", 2000);
    expect(sortie).toContain("vocalBare = normalizeVocalBare(false);");
  });

  it("aucun reglage nouveau : rien a enregistrer, rien a relire", () => {
    // Le code AJOUTE n'ouvre aucun rangement : ni dans l'ecran, ni dans la feuille
    // de style. (Le reste de `super-agent.js` a ses propres usages, hors sujet.)
    const code = corpsBouton() + corpsSyncBare() + corpsEnterVocal();
    for (const interdit of ["localStorage", "sessionStorage"]) {
      expect(code).not.toContain(interdit);
    }
    expect(CSS).not.toContain("localStorage");
    // Aucun nom de reglage n'a ete invente pour l'occasion.
    for (const interdit of ["pilot_vocal_bare", "vocal_bare_"]) {
      expect(SUPER).not.toContain(interdit);
      expect(CSS).not.toContain(interdit);
    }
  });
});

describe("7. ce qui se masque — et ce qui ne se masque JAMAIS", () => {
  it("le bloc nomme le disque, le micro, la ligne d'etat, la saisie, les deux colonnes", () => {
    const effacement = blocEffacement();
    for (const noeud of [
      ".vocal-orb",
      ".vocal-mic-fix",
      ".vocal-status",
      ".vocal-side-discussion",
      ".vocal-side-tasks",
    ]) {
      expect(effacement).toContain(noeud);
    }
    // La saisie est ecrite A PART (une regle a elle) : son clic et son curseur
    // sont deja coupes par l'effacement du bas.
    expect(blocSaisie()).toMatch(/opacity:\s*0/);
    expect(blocSaisie()).toMatch(/visibility:\s*hidden/);
    // La colonne des taches se vide de son CONTENU (titre, liste, activite) :
    // elle ne peut pas etre eteinte en bloc, le portrait vit dedans.
    expect(effacement).toContain(".vocal-side-tasks > .vocal-tasks-title");
    expect(effacement).toContain(".vocal-side-tasks > .vocal-side-body");
    expect(effacement).toContain(".vocal-side-tasks > .vocal-now");
  });

  it("le clic sur la saisie n'est coupe que par l'effacement du bas (verrou #381)", () => {
    // `pointer-events: none` est deja pose sur `.vocal-input` par
    // `.vocal-chrome-hidden`, dont la condition contient desormais `!vocalBare` :
    // l'etat nu n'a pas besoin d'une SECONDE regle, et n'en ajoute pas.
    const regles = CSS.match(/[^{}]+\{[^}]*pointer-events:\s*none[^}]*\}/g) || [];
    const surSaisie = regles.filter((r) => r.split("{")[0].includes(".vocal-input"));
    expect(surSaisie).toHaveLength(1);
    expect(surSaisie[0]).toContain("vocal-chrome-hidden");
    expect(blocSaisie()).not.toMatch(/pointer-events\s*:/);
  });

  it("il ne nomme NI le portrait NI sa pastille : la seule exception du document", () => {
    for (const bloc of [blocEffacement(), blocSaisie(), blocException(), blocBarre(), blocReduit()]) {
      expect(bloc).not.toContain("portrait");
    }
    // Et le bloc entier de l'etat nu, du premier selecteur au bloc suivant.
    const tout = sliceSource(
      CSS,
      ".pilot-vocal.vocal-bare .vocal-orb,",
      "/* --- §4.2/§4.3 Mouvement reduit",
      500,
    );
    expect(tout).not.toContain(".vocal-portrait");
  });

  it("il n'eteint jamais une SORTIE ni l'acces au travail", () => {
    const tout = sliceSource(
      CSS,
      ".pilot-vocal.vocal-bare .vocal-orb,",
      "/* --- §4.2/§4.3 Mouvement reduit",
      500,
    );
    expect(tout).not.toContain("#mode-logo");
    expect(tout).not.toContain("#agent-activity");
  });

  it("SANS PERSONNAGE il ne reste que le bouton : le disque ne reste pas", () => {
    // Le disque est nomme SANS condition : aucune variante « si le portrait
    // existe », aucun `:has()`, aucun `[hidden]`. Un disque laisse seul
    // contredirait « tout masquer » et ferait un etat nu a deux vitesses.
    const effacement = blocEffacement();
    expect(effacement).not.toContain(":has(");
    expect(effacement).not.toContain("[hidden]");
    expect(effacement).not.toContain(":not(");
    // Le portrait absent est deja `hidden` dans le modele (il ne remplit donc pas
    // la colonne) ; le bloc ne lui redonne aucune place, il ne le nomme pas du tout.
    expect(corpsOverlay()).toContain('<img class="vocal-portrait" alt="" hidden />');
  });
});

describe("8. la forme du masquage : un fondu de 180 ms, jamais un instantane", () => {
  it("opacite 0, visibilite retardee, clics rendus inoffensifs", () => {
    const effacement = blocEffacement();
    expect(effacement).toMatch(/opacity:\s*0/);
    expect(effacement).toMatch(/visibility:\s*hidden/);
    expect(effacement).toMatch(/pointer-events:\s*none/);
    // Le retard de la visibilite est celui du fondu : sans lui, le noeud
    // disparaitrait d'un coup et le fondu ne se verrait pas.
    expect(effacement).toMatch(/visibility 0s linear 180ms/);
    expect(VOCAL_BARE_FADE_MS).toBe(180);
  });

  it("la saisie garde elle aussi le fondu de 180 ms", () => {
    const saisie = blocSaisie();
    expect(saisie).toMatch(/opacity var\(--transition\)/);
    expect(saisie).toMatch(/visibility 0s linear 180ms/);
    expect(VOCAL_BARE_FADE_MS).toBe(180);
  });

  it("le fondu dure `--transition` (0,18 s), et aucune translation", () => {
    const effacement = blocEffacement();
    expect(effacement).toMatch(/opacity var\(--transition\)/);
    expect(effacement).not.toContain("transform");
    expect(effacement).not.toContain("translateY");
  });

  it("jamais d'instantane : pas de `transition: none` dans le bloc d'effacement", () => {
    expect(blocEffacement()).not.toContain("transition: none");
    // Et le fondu est bien declare, pas seulement l'opacite.
    expect(blocEffacement()).toMatch(/transition:/);
  });

  it("en mouvement reduit, l'extinction est instantanee (et elle seule)", () => {
    const reduit = blocReduit();
    expect(reduit).toMatch(/transition:\s*none/);
    // Les nœuds qui ont deja leur regle de mouvement reduit n'ont pas besoin
    // d'une seconde regle : le disque, la ligne d'etat, la saisie et le bouton
    // du micro y sont deja.
    const general = sliceSource(
      CSS,
      ".pilot-vocal.vocal-reduced,\n.pilot-vocal.vocal-reduced .vocal-orb,",
      "}",
      200,
    );
    expect(general).toContain(".pilot-vocal.vocal-reduced .vocal-orb");
    expect(general).toMatch(/transition:\s*none/);
  });
});

describe("9. la place est conservee : rien ne saute, ni le portrait ni le disque", () => {
  it("aucune forme interdite : pas de `display: none`, de hauteur, de marge, de padding, de position", () => {
    const effacement = neutraliserSource(blocEffacement());
    expect(effacement).not.toContain("display");
    expect(effacement).not.toMatch(/(^|[;\s{])height\s*:/m);
    expect(effacement).not.toMatch(/(^|[;\s{])margin[a-z-]*\s*:/m);
    expect(effacement).not.toMatch(/(^|[;\s{])padding[a-z-]*\s*:/m);
    expect(effacement).not.toMatch(/(^|[;\s{])position\s*:/m);
  });

  it("la barre garde sa place et perd seulement son fond et son filet", () => {
    const barre = blocBarre();
    expect(barre).toMatch(/background:\s*transparent/);
    expect(barre).toMatch(/border-color:\s*transparent/);
    expect(barre).not.toContain("display");
    expect(barre).not.toMatch(/(^|[;\s{])height\s*:/m);
  });

  it("le bouton reste la seule chose de la bande : il se voit et se trouve", () => {
    const exception = blocException();
    expect(exception).toMatch(/opacity:\s*1/);
    expect(exception).toMatch(/visibility:\s*visible/);
    // Fond plein et ombre discrete : trouvable sans crier.
    expect(exception).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(exception).toMatch(/box-shadow:\s*var\(--shadow-sm\)/);
  });

  it("l'espace du portrait est reserve : le bloc n'ecrit aucune regle de flux", () => {
    // La colonne des taches garde ses `padding-block-end` et ses hauteurs
    // ecrites ailleurs ; l'etat nu n'y touche pas.
    expect(blocEffacement()).not.toContain(".vocal-side-tasks {");
    expect(blocEffacement()).not.toContain("justify-content");
    expect(blocEffacement()).not.toContain("flex");
  });
});
