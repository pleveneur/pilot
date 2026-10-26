/**
 * Verrou du LOT 1 du REPLI AU SURVOL des menus du bas de la colonne.
 *
 * Document qui fait foi : `RAPPORT-conception-repli-menus-bas.md` (§ 2.1 a § 2.5,
 * § 5, puis LOT 1 du § 6).
 *
 * Ce que ce fichier tient :
 *   (a) la HAUTEUR REPLIEE se recalcule depuis le disque — `2 bordures + 2 x
 *       padding vertical + 1 ligne` — et vaut 50 px ;
 *   (b) `justify-content: flex-end` est present dans `#project-footer {` (l'ancre
 *       est le BAS : la ligne du bas ne bouge jamais) et `overflow: visible` y
 *       reste (le menu s'ouvre VERS LE HAUT) ;
 *   (c) le rognage n'existe QUE dans la regle d'etat `#project-footer.pj-replie`,
 *       avec `overflow: clip` (jamais `hidden`, qui defile au focus) ;
 *   (d) `.pj-panel` porte `flex: 0 0 auto` (sinon il est comprime et la mesure de
 *       la hauteur depliee devient fausse) ;
 *   (e) `#project-footer` anime la HAUTEUR SEULE, avec le jeton `--transition` ;
 *   (f) les deux constantes du module sont EGALES aux jetons de duree relus dans
 *       `style.css` : `OUVERTURE_MS` = `--transition-fast`, `GRACE_MS` =
 *       `--transition-smooth` ;
 *   (g) le module est BRANCHE (`sidebar.js` : import + appel) et ses trois portes
 *       sont posees (survol 100 ms, clavier immediat, Echap qui ne double pas le
 *       menu) ;
 *   (h) le mouvement reduit reprend la convention EXISTANTE (`modal-anim.js`).
 *
 * Ce qui ne doit PAS changer : les SEPT lignes, leurs identifiants, leurs
 * libelles, la colonne de 280 px, le plafond de 60 % et les cinq chaines du verrou
 * du menu (`lot3-colonne-bas.test.js`). Aucun noeud n'est ajoute dans la page.
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne normalisees,
 * cf. quality-gate 3.4) + fonctions pures du module.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource, sliceFrom } from "./source-slice.js";
import {
  CLASSE_REPLIE,
  GRACE_MS,
  OUVERTURE_MS,
  doitResterDeplie,
  hauteurDeplieePx,
  initRepliMenusBas,
  mouvementCoupe,
} from "./sidebar-footer-fold.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");
const sidebarJs = lire("src/js/sidebar.js");
const moduleJs = lire("src/js/sidebar-footer-fold.js");

/** Bloc de regle dont le selecteur est ecrit EXACTEMENT `selector {`. */
function blocs(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouves = [];
  let m;
  while ((m = re.exec(source)) !== null) trouves.push(m[1]);
  return trouves;
}

function bloc(source, selector) {
  const trouves = blocs(source, selector);
  expect(trouves.length, `regle CSS absente : ${selector}`).toBeGreaterThan(0);
  return trouves.join("\n");
}

const declarations = (corps) => corps.replace(/\s+/g, " ").toLowerCase();

/** Duree d'un jeton de transition (`--nom: 0.1s var(--ease-spring)`) en ms. */
function dureeJeton(nom) {
  const m = css.match(new RegExp(`--${nom}:\\s*([0-9.]+)s`));
  expect(m, `jeton de duree absent : --${nom}`).not.toBeNull();
  return Math.round(Number(m[1]) * 1000);
}

/** Ouverture du cadre du bas, telle qu'ecrite dans `index.html`. */
const ouvertureCadre = () => {
  const m = html.match(/<div id="project-footer"[^>]*>/);
  expect(m, "div #project-footer introuvable").not.toBeNull();
  return m[0];
};

describe("LOT 1 (a) — la hauteur repliee se recalcule depuis le disque", () => {
  it("la fente vaut 2 bordures + 2 paddings + 1 ligne, soit 50 px", () => {
    const cadreCss = declarations(bloc(css, "#project-footer"));
    // `padding: 8px 0` : seul le vertical compte.
    const pad = Number((cadreCss.match(/padding: (\d+)px 0/) || [])[1]);
    expect(pad, "padding vertical du cadre").toBe(8);
    // Hauteur d'une ligne du bloc : 32 px (verrou du lot 3, relu ici).
    const lignesCss = declarations(blocs(css, ".pj-panel button").join("\n"));
    const hauteurLigne = Number((lignesCss.match(/height: (\d+)px/) || [])[1]);
    expect(hauteurLigne, "hauteur d'une ligne du bloc").toBe(32);
    // La bordure du cadre : 1 px (relu, jamais fige dans le test).
    const bordure = Number((cadreCss.match(/border: (\d+)px solid/) || [])[1]);
    expect(bordure, "epaisseur de bordure du cadre").toBe(1);
    // Hauteur REPLIEE telle qu'ecrite dans la regle d'etat.
    const etatCss = declarations(bloc(css, "#project-footer.pj-replie"));
    const hauteurRepliee = Number((etatCss.match(/height: (\d+)px/) || [])[1]);
    expect(hauteurRepliee, "hauteur du cadre replie").toBe(
      2 * bordure + 2 * pad + hauteurLigne,
    );
    expect(hauteurRepliee).toBe(50);
    // Le plafond du deplie n'est pas touche par le repli (decision du
    // proprietaire, verrou du lot 3).
    expect(cadreCss).toContain("max-height: 60%");
  });

  it("le decompte des lignes du panneau est toujours de SEPT (aucun noeud ajoute)", () => {
    const panneau = sliceSource(html, '<div class="pj-panel">', "</aside>", 200);
    const lignes = panneau
      .split("\n")
      .filter((l) => l.startsWith("        <button") || l.includes('id="pj-more-wrap"'));
    expect(lignes).toHaveLength(7);
    // Le repli ne masque RIEN dans le DOM : aucune ligne ne recoit `hidden` en
    // plus de son etat de projet.
    expect(moduleJs).not.toContain('tabindex="-1"');
    expect(moduleJs).not.toContain("display: none");
  });

  it("index.html peint l'etat replie au premier rendu", () => {
    expect(ouvertureCadre()).toContain('class="pj-replie"');
    // Le cadre reste visible sans projet ouvert : le repli ne le rend pas
    // conditionnel.
    expect(ouvertureCadre()).not.toContain("project-only");
    expect(ouvertureCadre()).not.toContain("hidden");
  });
});

describe("LOT 1 (b) — l'ancre est le BAS, et le cadre deplie ne rogne rien", () => {
  it("`#project-footer` colle son contenu en bas", () => {
    expect(declarations(bloc(css, "#project-footer"))).toContain(
      "justify-content: flex-end",
    );
  });

  it("`overflow: visible` reste dans la regle de base (menu vers le haut)", () => {
    const d = declarations(bloc(css, "#project-footer"));
    expect(d).toContain("overflow: visible");
    // Le rognage ne doit JAMAIS entrer dans le bloc de base.
    expect(d).not.toContain("overflow: clip");
    expect(d).not.toContain("overflow: hidden");
  });

  it("la largeur de colonne n'est pas touchee par le repli", () => {
    // Le repli ne joue que sur la HAUTEUR : ni `width` ni `min-width` dans la
    // regle d'etat, et la colonne garde son plancher de 280 px.
    const etatCss = declarations(bloc(css, "#project-footer.pj-replie"));
    expect(etatCss).not.toContain("width");
    const colonne = declarations(bloc(css, "#sidebar"));
    expect(colonne).toContain("min-width: 280px");
  });
});

describe("LOT 1 (c) — le rognage n'existe que dans la regle d'etat", () => {
  it("`#project-footer.pj-replie` rogne avec `clip`, jamais `hidden`", () => {
    const d = declarations(bloc(css, "#project-footer.pj-replie"));
    expect(d).toContain("overflow: clip");
    // `hidden` est un conteneur de defilement : au focus il ajuste `scrollTop` et
    // la ligne d'ancrage disparait (§ 5.3 du document).
    expect(d).not.toContain("overflow: hidden");
  });

  it("la classe d'etat du module est celle du CSS et du HTML", () => {
    expect(CLASSE_REPLIE).toBe("pj-replie");
    expect(css).toContain(`#project-footer.${CLASSE_REPLIE} {`);
    expect(ouvertureCadre()).toContain(`class="${CLASSE_REPLIE}"`);
  });
});

describe("LOT 1 (d) — le panneau ne se comprime pas", () => {
  it("`.pj-panel` porte `flex: 0 0 auto`", () => {
    expect(declarations(bloc(css, ".pj-panel"))).toContain("flex: 0 0 auto");
  });

  it("chaque ligne garde sa hauteur fixe de 32 px", () => {
    // Sans `flex: 0 0 auto` sur le panneau, ces lignes sortiraient du panneau des
    // que le cadre descend a 50 px.
    expect(declarations(blocs(css, ".pj-panel button").join("\n"))).toContain(
      "flex: 0 0 auto",
    );
  });
});

describe("LOT 1 (e) — seule la hauteur est animee, avec les jetons existants", () => {
  it("`transition: height var(--transition)` dans le cadre", () => {
    const d = declarations(bloc(css, "#project-footer"));
    expect(d).toContain("transition: height var(--transition)");
    // Aucune duree ecrite en dur, aucune autre propriete animee.
    expect(d).not.toMatch(/transition:[^;]*[0-9]ms/);
    expect(d).not.toMatch(/transition:[^;]*transform/);
    // Pas de `will-change` : il creerait une couche plein cadre pour un gain nul
    // (§ 5.5).
    expect(d).not.toContain("will-change");
  });

  it("la courbe est celle du projet", () => {
    expect(css).toContain("--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)");
    expect(css).toContain("--transition: 0.18s var(--ease-spring)");
  });
});

describe("LOT 1 (f) — les deux delais sont les jetons existants", () => {
  it("OUVERTURE_MS et GRACE_MS egalent --transition-fast et --transition-smooth", () => {
    expect(OUVERTURE_MS).toBe(dureeJeton("transition-fast"));
    expect(GRACE_MS).toBe(dureeJeton("transition-smooth"));
    // Valeurs du document de conception (§ 2.3) : 100 ms et 300 ms.
    expect(OUVERTURE_MS).toBe(100);
    expect(GRACE_MS).toBe(300);
    // 300 + 180 < 500 : le bloc est au repos en moins d'une demi-seconde.
    expect(GRACE_MS + 180).toBeLessThan(500);
  });

  it("le module n'utilise aucune autre duree", () => {
    // Tous les `setTimeout` du module passent par une des deux constantes.
    const minuteries = moduleJs.match(/setTimeout\([^,]+,\s*([A-Za-z0-9_]+)/g) || [];
    expect(minuteries.length).toBeGreaterThan(0);
    for (const ligne of minuteries) {
      expect(ligne).toMatch(/,\s*(OUVERTURE_MS|GRACE_MS)\)?$/);
    }
  });
});

describe("LOT 1 (g) — les trois portes et le branchement", () => {
  it("le survol ouvre apres OUVERTURE_MS, la sortie arme le sursis", () => {
    expect(moduleJs).toContain('addEventListener("pointerenter"');
    expect(moduleJs).toContain('addEventListener("pointerleave"');
    expect(moduleJs).toContain("}, OUVERTURE_MS)");
    expect(moduleJs).toContain("}, GRACE_MS)");
  });

  it("le clavier deploie sans animation et force le defilement a zero", () => {
    const focus = sliceSource(
      moduleJs,
      "const surFocus = () => {",
      "const surPerteFocus",
      80,
    );
    expect(focus).toContain("deplier({ immediat: true })");
    expect(focus).toContain("cadre.scrollTop = 0");
    // Aucun `tabindex` retire, aucune ligne sortie du parcours clavier.
    expect(moduleJs).not.toContain('tabindex="-1"');
  });

  it("Echap ne double jamais le menu (ecoute en phase de capture)", () => {
    const touche = sliceSource(
      moduleJs,
      "const surTouche = (e) => {",
      "// ── Redimensionnement",
      80,
    );
    // Le menu ouvert a la priorite : on sort AVANT de replier.
    expect(touche).toContain("if (etat.menuOuvert) return;");
    expect(moduleJs).toContain('doc.addEventListener("keydown", surTouche, true)');
    // Le repli au clavier est immediat et rend le focus a la ligne visible.
    expect(touche).toContain("replier({ immediat: true })");
    expect(touche).toContain("focusImpose = true");
  });

  it("le repli n'a lieu que si les trois conditions sont sorties", () => {
    const fermeture = sliceFrom(moduleJs, "const planifierFermeture = () => {", 80);
    expect(fermeture).toContain("if (doitResterDeplie(etat)) return;");
  });

  it("le module est branche dans Sidebar.init(), apres le menu", () => {
    expect(sidebarJs).toContain('from "./sidebar-footer-fold.js"');
    const init = sliceSource(
      sidebarJs,
      "    this._initProjectFooterMenu();",
      "// Bouton Projets → toggle dropdown",
      80,
    );
    expect(init).toContain("initRepliMenusBas({");
    expect(init).toContain("fermerMenuAutresEcrans: this._fermerMenuAutresEcrans");
  });

  it("la reference de fermeture du menu est exposee sans toucher ses cinq chaines", () => {
    expect(sidebarJs).toContain("this._fermerMenuAutresEcrans = fermer;");
    // Les cinq chaines du verrou du bas de colonne restent intactes.
    expect(sidebarJs).toContain('e.key !== "Escape"');
    expect(sidebarJs).toContain('menu.classList.toggle("hidden", !ouvert)');
    expect(sidebarJs).toContain(
      'setAttribute("aria-expanded", ouvert ? "true" : "false")',
    );
    expect(sidebarJs).toContain('if (e.target.closest(".pj-more-item")) fermer();');
    expect(sidebarJs).toContain("true\n    );");
  });
});

describe("LOT 1 (h) — mouvement reduit : la convention existante, pas une autre", () => {
  const fausseFenetre = (reduit, reglage) => ({
    matchMedia: (requete) => ({
      matches: requete === "(prefers-reduced-motion: reduce)" && reduit,
    }),
    _pilotModalAnimations: reglage,
  });

  it("coupe uniquement si la reduction est demandee ET le reglage desactive", () => {
    expect(mouvementCoupe(fausseFenetre(true, false))).toBe(true);
    expect(mouvementCoupe(fausseFenetre(true, true))).toBe(false);
    expect(mouvementCoupe(fausseFenetre(true, undefined))).toBe(false);
    expect(mouvementCoupe(fausseFenetre(false, false))).toBe(false);
    expect(mouvementCoupe(undefined)).toBe(false);
  });

  it("c'est bien la convention de modal-anim.js (aucun second reglage)", () => {
    const modalAnim = lire("src/js/modal-anim.js");
    expect(modalAnim).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(modalAnim).toContain("window._pilotModalAnimations === false");
    expect(moduleJs).toContain('"(prefers-reduced-motion: reduce)"');
    expect(moduleJs).toContain("_pilotModalAnimations === false");
  });

  it("les DELAIS restent actifs en mouvement reduit (Q3)", () => {
    // La reduction ne touche que la bascule : les deux minuteries sont armees
    // avant tout test de mouvement.
    const entree = sliceSource(
      moduleJs,
      "const surEntree = () => {",
      "const surSortie",
      80,
    );
    expect(entree).toContain("}, OUVERTURE_MS)");
    const fermeture = sliceFrom(moduleJs, "const planifierFermeture = () => {", 80);
    expect(fermeture).toContain("}, GRACE_MS)");
  });
});

describe("LOT 1 (i) — les fonctions pures", () => {
  it("doitResterDeplie : une seule des trois conditions suffit", () => {
    expect(doitResterDeplie({})).toBe(false);
    expect(doitResterDeplie()).toBe(false);
    expect(doitResterDeplie({ survol: true })).toBe(true);
    expect(doitResterDeplie({ focusDedans: true })).toBe(true);
    expect(doitResterDeplie({ menuOuvert: true })).toBe(true);
    expect(
      doitResterDeplie({ survol: false, focusDedans: false, menuOuvert: false }),
    ).toBe(false);
  });

  it("hauteurDeplieePx : panneau + paddings + bordures, jamais un total fige", () => {
    // Les SEPT lignes : 7 x 32 + 6 x 6 = 260 px de panneau.
    const sept = { panneau: 260, paddingTop: 8, paddingBottom: 8, borderTop: 1, borderBottom: 1 };
    expect(hauteurDeplieePx(sept)).toBe(278);
    // Sans projet : seules deux lignes, 2 x 32 + 6 = 70 px de panneau.
    expect(
      hauteurDeplieePx({ ...sept, panneau: 2 * 32 + 6 }),
    ).toBe(88);
    // Toute mesure absente ou aberrante ne rend jamais NaN.
    expect(hauteurDeplieePx({})).toBe(0);
    expect(hauteurDeplieePx({ panneau: "260", paddingTop: "8" })).toBe(268);
    expect(hauteurDeplieePx({ panneau: -20, paddingTop: Number.NaN })).toBe(0);
  });

  it("la hauteur mesuree n'est jamais ecrite en dur dans le module", () => {
    // Aucune valeur de hauteur figee : tout vient de `getComputedStyle` et du
    // panneau, seule la hauteur repliee (50 px) est dans le CSS.
    expect(moduleJs).not.toMatch(/=\s*278\b/);
    expect(moduleJs).not.toMatch(/=\s*50\b/);
    expect(moduleJs).toContain("panneau.offsetHeight");
    expect(moduleJs).toContain("getComputedStyle");
  });
});

// ── Comportement de la machine a etats, sur un DOM factice minimal ───────────
//
// Aucun navigateur n'est installe dans ce projet : le DOM est simule ici, avec
// une horloge pilotee a la main. Ce bloc verifie donc les DELAIS et l'ORDRE des
// decisions (ouverture a 100 ms, sursis de 300 ms annule par un retour, clavier
// immediat et sans animation, Echap qui ne double pas le menu), pas le rendu.
function elementFactice(tag = "div") {
  const classes = new Set();
  const ecouteurs = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    offsetHeight: 0,
    scrollTop: 0,
    parent: null,
    enfants: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    addEventListener(type, fn) {
      if (!ecouteurs.has(type)) ecouteurs.set(type, []);
      ecouteurs.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const liste = ecouteurs.get(type) || [];
      const i = liste.indexOf(fn);
      if (i >= 0) liste.splice(i, 1);
    },
    emettre(type, ev) {
      for (const fn of [...(ecouteurs.get(type) || [])]) fn(ev || {});
    },
    contains(n) {
      if (!n || typeof n !== "object") return false;
      if (n === el) return true;
      let p = n.parent;
      while (p) {
        if (p === el) return true;
        p = p.parent;
      }
      return false;
    },
    closest(sel) {
      // Seul `.hidden` est demande par le module (ligne visible du bloc).
      const classe = sel.replace(/^\./, "");
      let p = el;
      while (p) {
        if (p.classList.contains(classe)) return p;
        p = p.parent;
      }
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(sel) {
      if (sel !== "button") return [];
      return el.enfants.filter((e) => e.tagName === "BUTTON");
    },
    focus() {
      el.document.activeElement = el;
    },
  };
  return el;
}

function domFactice({ menuOuvert = false } = {}) {
  const doc = {};
  const cadre = elementFactice("div");
  const panneau = elementFactice("div");
  const menu = elementFactice("div");
  const lignes = ["b1", "b2", "b3"].map((n) => {
    const b = elementFactice("button");
    b.id = n;
    return b;
  });
  cadre.document = doc;
  panneau.document = doc;
  menu.document = doc;
  cadre.parent = null;
  panneau.parent = cadre;
  menu.parent = panneau;
  cadre.enfants = [panneau];
  panneau.enfants = [...lignes, menu];
  for (const b of lignes) {
    b.document = doc;
    b.parent = panneau;
  }
  cadre.classList.add(CLASSE_REPLIE);
  if (!menuOuvert) menu.classList.add("hidden");

  const ecouteursDoc = new Map();
  doc.activeElement = null;
  doc.querySelector = (sel) => {
    if (sel === "#project-footer") return cadre;
    if (sel === "#pj-more-menu") return menu;
    return null;
  };
  cadre.querySelector = (sel) => (sel === ".pj-panel" ? panneau : null);
  doc.addEventListener = (type, fn) => {
    if (!ecouteursDoc.has(type)) ecouteursDoc.set(type, []);
    ecouteursDoc.get(type).push(fn);
  };
  doc.removeEventListener = () => {};
  doc.emettre = (type, ev) => {
    for (const fn of [...(ecouteursDoc.get(type) || [])]) fn(ev || {});
  };

  // Horloge pilotee : les deux delais du module sont observes a la milliseconde.
  const enAttente = [];
  let horloge = 0;
  const win = {
    setTimeout(fn, ms) {
      const t = { at: horloge + (Number(ms) || 0), fn, annule: false };
      enAttente.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.annule = true;
    },
    getComputedStyle: () => ({
      paddingTop: "8px",
      paddingBottom: "8px",
      borderTopWidth: "1px",
      borderBottomWidth: "1px",
    }),
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
  };
  // Observateur du menu : le test peut le declencher a la main (`ouvrirMenu`).
  win.MutationObserver = class {
    constructor(cb) {
      win._cbMutation = cb;
    }
    observe() {}
    disconnect() {}
  };
  win.avancer = (ms) => {
    const cible = horloge + ms;
    for (let garde = 0; garde < 100; garde += 1) {
      const du = enAttente
        .filter((t) => !t.annule && t.at <= cible)
        .sort((a, b) => a.at - b.at)[0];
      if (!du) break;
      horloge = du.at;
      du.annule = true;
      du.fn();
    }
    horloge = cible;
  };

  return {
    doc,
    win,
    cadre,
    panneau,
    menu,
    lignes,
    ouvrirMenu() {
      menu.classList.remove("hidden");
      if (win._cbMutation) win._cbMutation();
    },
    fermerMenu() {
      menu.classList.add("hidden");
      if (win._cbMutation) win._cbMutation();
    },
  };
}

describe("LOT 1 (j) — machine a etats : delais, ordre, clavier", () => {
  it("le bloc est replie au repos, et le survol ouvre apres 100 ms", () => {
    const d = domFactice();
    d.panneau.offsetHeight = 260;
    d.cadre.offsetHeight = 50;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    expect(repli.etat().replie).toBe(true);

    d.cadre.emettre("pointerenter");
    d.win.avancer(OUVERTURE_MS - 1);
    expect(repli.etat().replie, "ouvert trop tot").toBe(true);
    // Avant l'ouverture, aucune hauteur n'est posee et le rognage tient.
    expect(d.cadre.style.height || "").toBe("");
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(true);
    d.win.avancer(1);
    expect(repli.etat().replie).toBe(false);
    // Le rognage reste pendant le mouvement (`overflow: clip`), la hauteur est
    // posee en pixels : la fente monte au lieu de s'ouvrir d'un coup.
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(true);
    expect(d.cadre.style.height).toBe("278px");
    // Fin de mouvement (le test n'a pas de `transitionend`) : la classe tombe et
    // la valeur en pixels est retiree, le bloc redevient auto-ajustable.
    d.win.avancer(GRACE_MS);
    expect(d.cadre.style.height).toBe("");
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(false);
    repli.detruire();
  });

  it("la sortie arme un sursis de 300 ms, et un retour l'annule", () => {
    const d = domFactice();
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("pointerenter");
    d.win.avancer(OUVERTURE_MS);
    expect(repli.etat().replie).toBe(false);

    d.cadre.emettre("pointerleave");
    d.win.avancer(GRACE_MS - 1);
    expect(repli.etat().replie, "replie trop tot").toBe(false);
    // Retour de la souris AVANT la fin du sursis : le repli est annule.
    d.cadre.emettre("pointerenter");
    d.win.avancer(GRACE_MS * 2);
    expect(repli.etat().replie).toBe(false);

    d.cadre.emettre("pointerleave");
    d.win.avancer(GRACE_MS);
    expect(repli.etat().replie).toBe(true);
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(true);
    // La regle d'etat impose la hauteur : aucune valeur en pixels ne reste.
    expect(d.cadre.style.height).toBe("");
    repli.detruire();
  });

  it("le clavier deploie tout de suite, sans animation", () => {
    const d = domFactice();
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("focusin");
    // Aucune horloge avancee : l'anneau de focus doit etre peint tout de suite.
    expect(repli.etat().replie).toBe(false);
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(false);
    // Sans animation : aucune hauteur en pixels posee.
    expect(d.cadre.style.height).toBe("");
    expect(d.cadre.scrollTop).toBe(0);
    repli.detruire();
  });

  it("la sortie du focus arme le meme sursis" , () => {
    const d = domFactice();
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("focusin");
    d.cadre.emettre("focusout", { relatedTarget: null });
    d.win.avancer(GRACE_MS - 1);
    expect(repli.etat().replie).toBe(false);
    d.win.avancer(1);
    expect(repli.etat().replie).toBe(true);
    repli.detruire();
  });

  it("un focus qui reste DANS le bloc ne replie pas", () => {
    const d = domFactice();
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("focusin");
    d.cadre.emettre("focusout", { relatedTarget: d.lignes[0] });
    d.win.avancer(GRACE_MS * 3);
    expect(repli.etat().replie).toBe(false);
    repli.detruire();
  });

  it("un menu ouvert RETIENT le deploiement", () => {
    const d = domFactice({ menuOuvert: true });
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("pointerenter");
    d.win.avancer(OUVERTURE_MS);
    expect(repli.etat().replie).toBe(false);
    d.cadre.emettre("pointerleave");
    d.win.avancer(GRACE_MS * 2);
    // Le menu ouvert interdit le rognage : le bloc reste deplie.
    expect(repli.etat().replie).toBe(false);
    repli.detruire();
  });

  it("Echap ne double jamais le menu, et replie quand le menu est ferme", () => {
    const ouvert = domFactice({ menuOuvert: true });
    const repliOuvert = initRepliMenusBas({
      document: ouvert.doc,
      window: ouvert.win,
    });
    ouvert.cadre.emettre("focusin");
    ouvert.doc.activeElement = ouvert.lignes[2];
    ouvert.doc.emettre("keydown", { key: "Escape" });
    // Menu ouvert : le module ne fait RIEN (sidebar.js le referme).
    expect(repliOuvert.etat().replie).toBe(false);
    repliOuvert.detruire();

    const ferme = domFactice();
    const repliFerme = initRepliMenusBas({
      document: ferme.doc,
      window: ferme.win,
    });
    ferme.cadre.emettre("focusin");
    ferme.doc.activeElement = ferme.lignes[2];
    ferme.doc.emettre("keydown", { key: "Escape" });
    // Geste explicite : repli immediat, sans sursis ni animation.
    expect(repliFerme.etat().replie).toBe(true);
    expect(ferme.cadre.classList.contains(CLASSE_REPLIE)).toBe(true);
    expect(ferme.cadre.style.height).toBe("");
    // Le focus revient a la ligne visible (la derniere du bloc).
    expect(ferme.doc.activeElement).toBe(ferme.lignes[2]);
    repliFerme.detruire();
  });

  it("le repli ne rogne jamais avec le menu ouvert : la precaution existe cote module", () => {
    // L'etat interdit deja ce cas (verrou ci-dessus) ; la precaution du § 5.4 est
    // donc une DERNIERE barriere, verifiee ici sur le source et sur l'option.
    expect(moduleJs).toContain("if (menuEstOuvert() && fermerMenu) {");
    expect(moduleJs).toContain("fermerMenu();");
    // Une panne de la fermeture du menu ne doit jamais empecher le repli.
    expect(moduleJs).toContain("/* la fermeture du menu ne doit jamais empecher le repli */");
    // L'option est acceptee sans erreur et le module reste utilisable.
    const d = domFactice();
    const repli = initRepliMenusBas({
      document: d.doc,
      window: d.win,
      fermerMenuAutresEcrans: () => {},
    });
    expect(repli.etat().replie).toBe(true);
    repli.detruire();
  });

  it("un menu ouvert en pleine ouverture termine le mouvement (jamais rogne)", () => {
    const d = domFactice();
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("pointerenter");
    d.win.avancer(OUVERTURE_MS);
    // La fente monte encore : le rognage est encore pose.
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(true);
    d.ouvrirMenu();
    // Le menu ne peut pas etre coupe : le deploiement est termine sur-le-champ.
    expect(d.cadre.classList.contains(CLASSE_REPLIE)).toBe(false);
    expect(d.cadre.style.height).toBe("");
    repli.detruire();
  });

  it("en mouvement reduit la bascule est franche, mais les delais restent", () => {    const d = domFactice();
    d.win.matchMedia = () => ({ matches: true });
    d.win._pilotModalAnimations = false;
    d.panneau.offsetHeight = 260;
    const repli = initRepliMenusBas({ document: d.doc, window: d.win });
    d.cadre.emettre("pointerenter");
    d.win.avancer(OUVERTURE_MS - 1);
    expect(repli.etat().replie, "le delai de 100 ms doit rester actif").toBe(true);
    d.win.avancer(1);
    expect(repli.etat().replie).toBe(false);
    // Aucune hauteur en pixels : pas d'interpolation.
    expect(d.cadre.style.height).toBe("");
    repli.detruire();
  });
});
