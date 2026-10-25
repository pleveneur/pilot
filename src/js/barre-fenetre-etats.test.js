// barre-fenetre-etats.test.js — Verrou des boutons de fenetre et de leurs gestes.
//
// Depuis la suppression de la bande de 32 px (decision du proprietaire, Q1 ;
// docs/proposition-barre-fenetre.md §2), les trois boutons vivent au BOUT de la
// rangee d'onglets (#tab-row) : ce fichier verrouille donc la nouvelle
// structure, et continue de verrouiller ce qui ne change pas.
//
// Ce que ce fichier garantit :
//   1. les CINQ etats d'un bouton sont ecrits avec les jetons prescrits
//      (survol, appui, focus clavier, survol de Fermer, et jamais de desactive) ;
//   2. les CONTRASTES reels de ces etats, calcules depuis style.css, en theme
//      sombre ET en theme clair, atteignent les seuils WCAG (4.5:1 pour une
//      icone lue, 3:1 pour un anneau ou un repere non textuel) ;
//   3. le survol de Fermer n'utilise JAMAIS un fond rouge plein (croix blanche
//      sur --danger = 2.77:1 en sombre : illisible) ;
//   4. les trois boutons sont de vrais <button>, nommes (title + aria-label),
//      dans l'ordre du DOM Reduire → Agrandir → Fermer, sans tabindex, et
//      places en DERNIER enfant de la rangee d'onglets ;
//   5. l'icone « Agrandir / Restaurer » est synchronisee dans les DEUX sens :
//      etat lu au demarrage, relu a chaque redimensionnement, et le libelle suit
//      la meme valeur que l'icone ;
//   6. Fermer appelle close() — jamais destroy() ;
//   7. la bande de 32 px a bien DISPARU (ni HTML, ni CSS, ni variable) et les
//      gestes sont reportes sur les zones restantes, sans toucher aux elements
//      cliquables.
//
// Tous les decoupages passent par sliceSource / sliceFrom (source-slice.js) :
// une ancre absente fait ECHOUER le test au lieu de rendre une assertion
// negative vraie par construction.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource, sliceFrom } from "./source-slice.js";
import {
  WINDOW_LABELS,
  WINDOW_DRAG_ZONE_IDS,
  WINDOW_GESTURE_BLOCKLIST,
  isWindowGestureTarget,
  maxButtonIcon,
  maxButtonLabel,
} from "./window-controls.js";

const ici = dirname(fileURLToPath(import.meta.url));
// Lecture normalisee : un worktree en CRLF ne doit pas faire echouer les ancres.
const lire = (rel) => readFileSync(join(ici, rel), "utf8").replace(/\r\n/g, "\n");
const css = lire("../css/style.css");
const html = lire("../../index.html");
const js = lire("./window-controls.js");

// --- Outils de contraste (WCAG 2.1) ---------------------------------------
const luminance = (hex) => {
  const canaux = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * canaux[0] + 0.7152 * canaux[1] + 0.0722 * canaux[2];
};
const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Bloc CSS d'un theme de base, jusqu'a l'accolade fermante en debut de ligne. */
function blocTheme(nom) {
  return sliceSource(css, "." + nom + " {", "\n}", 200);
}
/** Valeur brute d'un jeton dans un bloc de theme. */
function jeton(bloc, nom) {
  const m = bloc.match(new RegExp("--" + nom + ":\\s*([^;]+);"));
  expect(m, "jeton --" + nom + " introuvable").not.toBeNull();
  return m[1].trim();
}

const sombre = blocTheme("theme-dark");
const clair = blocTheme("theme-light");
const palettes = [
  ["sombre", { bg: jeton(sombre, "bg-app"), s3: jeton(sombre, "surface-3"), tp: jeton(sombre, "text-primary"), ts: jeton(sombre, "text-secondary"), accent: jeton(sombre, "accent"), danger: jeton(sombre, "danger") }],
  ["clair", { bg: jeton(clair, "bg-app"), s3: jeton(clair, "surface-3"), tp: jeton(clair, "text-primary"), ts: jeton(clair, "text-secondary"), accent: jeton(clair, "accent"), danger: jeton(clair, "danger") }],
];

/** Regle CSS complete d'un selecteur (de son debut a l'accolade fermante). */
const regle = (selecteur) => sliceSource(css, selecteur, "}", 20);

// Toute la section des boutons de fenetre (du titre de section aux jetons).
const sectionBande = sliceSource(css, "BOUTONS DE FENETRE PILOT", "/* --- Design Tokens", 400);
const reglesBoutons = sliceFrom(sectionBande, "#window-controls {", 100);

describe("1. les cinq etats du bouton (§4.1)", () => {
  it("le groupe de boutons est au-dessus du chargement, des dialogues et du mode immersif", () => {
    const groupe = regle("#window-controls {");
    // z 100001 > 99999 (chargement), 100000 (dialogues), 99990 (immersif).
    expect(groupe).toMatch(/z-index:\s*100001/);
    expect(groupe).toMatch(/position:\s*relative/);
    // Il ne se comprime jamais : c'est lui qui reserve sa place dans la rangee.
    expect(groupe).toMatch(/flex:\s*0 0 auto/);
    expect(groupe).toMatch(/align-self:\s*stretch/);
  });

  it("la bande de 32 px a disparu : ni HTML, ni CSS, ni variable de hauteur", () => {
    expect(html).not.toContain('id="window-bar"');
    expect(css).not.toMatch(/#window-bar\s*\{/);
    expect(css).not.toMatch(/--window-bar-height\s*:/);
  });

  it("un bouton fait 46 px de large et la hauteur de la LIGNE des onglets", () => {
    const bouton = regle("#window-controls > button {");
    expect(bouton).toMatch(/width:\s*46px/);
    // La hauteur n'est plus 32 px, et ce n'est plus non plus toute la hauteur
    // de la rangee (36 px) : le groupe prend 4 px d'air en haut et en bas, donc
    // les boutons prennent la hauteur de la LIGNE des onglets. `height: 100%`
    // resout sur la boite de contenu du groupe, qui vaut rangee - 2 x air.
    expect(bouton).toMatch(/height:\s*100%/);
    expect(bouton).toMatch(/border:\s*0/);
    expect(bouton).toMatch(/padding:\s*0/);
    expect(bouton).toMatch(/border-radius:\s*var\(--radius-xs\)/);
    expect(bouton).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it("la rangee qui les porte garde sa hauteur de 36 px (aucune hauteur nouvelle)", () => {
    const rangee = regle("#tab-row {");
    expect(rangee).toMatch(/min-height:\s*36px/);
  });

  it("le groupe prend 4 px d'air en haut, a droite et en bas (coin haut droit)", () => {
    // L'air est porte par le REMPLISSAGE du groupe, seule source : si on le
    // retire, les boutons reprennent 36 px et retouchent les bords haut et
    // droit — les deux assertions ci-dessous echouent.
    const groupe = regle("#window-controls {");
    const rem = groupe.match(/padding:\s*([^;]+);/);
    expect(rem, "remplissage du groupe introuvable").not.toBeNull();
    const [haut, droite, bas, gauche] = rem[1].trim().split(/\s+/);
    expect(haut).toBe("4px");
    expect(droite).toBe("4px");
    expect(bas).toBe("4px");
    // Aucun air a gauche : la place des onglets n'est pas rognee plus que les
    // 4 px de droite (l'entree « Travail » a deja sa marge).
    expect(gauche).toBe("0");
    // Largeur totale = 3 boutons + l'air de droite (recompte depuis le disque).
    const largeur = Number(regle("#window-controls > button {").match(/width:\s*(\d+)px/)[1]);
    const air = Number(droite.replace("px", ""));
    expect(largeur * 3 + air).toBe(142);
    // La rangee ne bouge pas : 36 px de contenu, filet bas compris a part.
    const rangee = regle("#tab-row {");
    expect(rangee).toMatch(/min-height:\s*36px/);
    // Les boutons prennent la hauteur de la ligne des onglets : 36 - 2 x 4 = 28.
    const hauteurRangee = Number(rangee.match(/min-height:\s*(\d+)px/)[1]);
    expect(hauteurRangee - 2 * Number(haut.replace("px", ""))).toBe(28);
  });

  it("survol et appui : fond --surface-3, icone --text-primary", () => {
    const survol = regle("#window-controls > button:hover,");
    expect(survol).toMatch(/background:\s*var\(--surface-3\)/);
    expect(survol).toMatch(/color:\s*var\(--text-primary\)/);
    // Regle d'appui reperee par le commentaire qui la precede (le selecteur
    // :active figure aussi dans la regle combinee du survol).
    const appui = sliceSource(css, "Appui : meme fond que le survol", "}", 60);
    expect(appui).toMatch(/box-shadow:\s*inset 0 1px 3px rgba\(0, 0, 0, 0\.35\)/);
  });

  it("focus CLAVIER : anneau accent 2 px, decale de -2 px, invisible au clic souris", () => {
    const reset = regle("#window-controls > button:focus {");
    expect(reset).toMatch(/outline:\s*none/);
    const anneau = regle("#window-controls > button:focus-visible {");
    expect(anneau).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(anneau).toMatch(/outline-offset:\s*-2px/);
  });

  it("survol de Fermer : fond --surface-3 + croix --danger, jamais de fond rouge plein", () => {
    const fermer = regle("#window-controls > #win-close:hover,");
    expect(fermer).toMatch(/color:\s*var\(--danger\)/);
    expect(fermer).not.toMatch(/background:\s*var\(--danger\)/);
    // Aucune regle ne peint le fond du bouton Fermer en --danger.
    expect(css).not.toMatch(/#win-close[^{}]*\{[^}]*background:\s*var\(--danger\)/);
  });

  it("aucun etat desactive n'est ecrit : les trois boutons ne peuvent pas l'etre", () => {
    expect(sectionBande).not.toMatch(/#window-controls[^{]*:disabled/);
    expect(html).not.toMatch(/id="win-(min|max|close)"[^>]*\sdisabled/);
  });
});

describe("2. contrastes reels des cinq etats (§4.1)", () => {
  it("repos, survol, anneau de focus et survol de Fermer tiennent les seuils", () => {
    for (const [nom, p] of palettes) {
      // Repos : icone --text-secondary sur --bg-app (texte lisible, seuil 4.5).
      expect(contraste(p.ts, p.bg), `${nom} repos`).toBeGreaterThanOrEqual(4.5);
      // Survol / appui : icone --text-primary sur --surface-3 (seuil 4.5).
      expect(contraste(p.tp, p.s3), `${nom} survol`).toBeGreaterThanOrEqual(4.5);
      // Anneau de focus : --accent sur --bg-app et sur --surface-3 (seuil 3).
      expect(contraste(p.accent, p.bg), `${nom} anneau sur fond`).toBeGreaterThanOrEqual(3);
      expect(contraste(p.accent, p.s3), `${nom} anneau sur survol`).toBeGreaterThanOrEqual(3);
      // Survol de Fermer : croix --danger sur --surface-3 (seuil 3).
      expect(contraste(p.danger, p.s3), `${nom} fermer`).toBeGreaterThanOrEqual(3);
    }
  });

  it("le fond rouge plein est bien ecarte : croix blanche sur --danger < 3:1 en sombre", () => {
    expect(contraste("#ffffff", palettes[0][1].danger)).toBeLessThan(3);
  });
});

describe("3. les trois boutons : ordre, noms, clavier (§3.2)", () => {
  it("les boutons sont en DERNIER enfant de la rangee d'onglets", () => {
    const rangee = html.indexOf('id="tab-row"');
    const barre = html.indexOf('id="tab-bar"');
    const travail = html.indexOf('id="agent-activity"');
    const boutons = html.indexOf('id="window-controls"');
    const contenu = html.indexOf('id="main-content"');
    expect(rangee).toBeGreaterThan(-1);
    expect(barre).toBeGreaterThan(rangee);
    // Ordre du DOM : rangee -> barre d'onglets -> entree « Travail » -> boutons.
    expect(travail).toBeGreaterThan(barre);
    expect(boutons).toBeGreaterThan(travail);
    // ... et tout cela reste DANS la rangee (avant le contenu de l'editeur).
    expect(contenu).toBeGreaterThan(boutons);
    // La fenetre n'a plus de bande : #app-body est le premier bloc du corps.
    expect(html).not.toContain('id="window-bar"');
  });

  it("les trois boutons existent dans l'ordre Reduire, Agrandir, Fermer", () => {
    const iMin = html.indexOf('id="win-min"');
    const iMax = html.indexOf('id="win-max"');
    const iClose = html.indexOf('id="win-close"');
    expect(iMin).toBeGreaterThan(-1);
    expect(iMax).toBeGreaterThan(iMin);
    expect(iClose).toBeGreaterThan(iMax);
  });

  it("chacun est nomme pour la lecture d'ecran (title ET aria-label identiques)", () => {
    for (const id of ["win-min", "win-max", "win-close"]) {
      const bouton = sliceSource(html, 'id="' + id + '"', "</button>", 20);
      const titre = bouton.match(/title="([^"]+)"/);
      const aria = bouton.match(/aria-label="([^"]+)"/);
      expect(titre, id + " sans title").not.toBeNull();
      expect(aria, id + " sans aria-label").not.toBeNull();
      expect(aria[1]).toBe(titre[1]);
    }
    // Les libelles du HTML sont EXACTEMENT ceux du code (une seule verite).
    expect(html).toContain('title="' + WINDOW_LABELS.minimize + '"');
    expect(html).toContain('title="' + WINDOW_LABELS.maximize + '"');
    expect(html).toContain('title="' + WINDOW_LABELS.close + '"');
  });

  it("les trois boutons sont atteignables au clavier : vrais <button>, sans tabindex", () => {
    const bloc = sliceSource(html, '<div id="window-controls">', 'id="main-content"', 100);
    expect(bloc.match(/<button /g)).toHaveLength(3);
    expect(bloc).not.toMatch(/tabindex/);
    expect(bloc).not.toMatch(/disabled/);
    // Aucune regle ne retire les boutons du focus.
    expect(reglesBoutons).not.toMatch(/visibility:\s*hidden/);
    expect(reglesBoutons).not.toMatch(/display:\s*none/);
  });
});

describe("4. icone « Agrandir / Restaurer » synchronisee dans les deux sens (§4.2)", () => {
  it("l'icone et le libelle suivent le meme etat", () => {
    expect(maxButtonIcon(false)).toBe("square");
    expect(maxButtonIcon(true)).toBe("copy");
    expect(maxButtonLabel(false)).toBe(WINDOW_LABELS.maximize);
    expect(maxButtonLabel(true)).toBe(WINDOW_LABELS.restore);
  });

  it("l'etat est lu au demarrage (la fenetre demarre agrandie)", () => {
    expect(js).toMatch(/isMaximized\(\)/);
    const init = sliceFrom(js, "export function initWindowControls", 100);
    expect(init).toMatch(/syncMaxButton\(win\)/);
  });

  it("l'etat est relu a chaque redimensionnement", () => {
    const suivi = sliceSource(js, "onResized(", "startDragging", 40);
    expect(suivi).toMatch(/syncMaxButton\(win\)/);
  });

  it("l'icone, le title et l'aria-label sont poses ensemble", () => {
    const bloc = sliceSource(js, "export function applyMaximizedState", "async function readMaximized", 100);
    expect(bloc).toMatch(/setIcon\(btn, maxButtonIcon\(maximized\)/);
    expect(bloc).toMatch(/btn\.title = label/);
    expect(bloc).toMatch(/setAttribute\("aria-label", label\)/);
  });

  it("apres un basculement, l'etat est relu immediatement", () => {
    const bascule = sliceSource(js, "async function toggleMaximize", "let initialized", 100);
    expect(bascule).toMatch(/await win\.toggleMaximize\(\)/);
    expect(bascule).toMatch(/await syncMaxButton\(win\)/);
  });
});

describe("5. gestes et fermeture (§3.3)", () => {
  it("glisser et double-clic sont cables sur les zones restantes, pas sur une bande", () => {
    // Zones restantes : bandeau du nom de projet + vide de la rangee d'onglets.
    expect(WINDOW_DRAG_ZONE_IDS).toEqual(["project-selector", "tab-row"]);
    // Les gestes sont poses en boucle sur ces zones, une seule fois chacune.
    const init = sliceFrom(js, "export function initWindowControls", 100);
    expect(init).toMatch(/for \(const id of WINDOW_DRAG_ZONE_IDS\)/);
    expect(init).toMatch(/zone\.addEventListener\("mousedown"/);
    expect(init).toMatch(/zone\.addEventListener\("dblclick"/);
    expect(init).toMatch(/win\.startDragging\(\)/);
    expect(js).toMatch(/startDragging\(\)/);
    expect(js).toMatch(/dblclick/);
    // Aucune reference a l'ancienne bande.
    expect(js).not.toContain('"window-bar"');
  });

  it("aucun geste ne part d'un element cliquable (garde-fou unique)", () => {
    // Le garde-fou est ecrit UNE fois et couvre les deux gestes.
    expect(WINDOW_GESTURE_BLOCKLIST).toContain("button");
    expect(WINDOW_GESTURE_BLOCKLIST).toContain(".tab");
    expect(WINDOW_GESTURE_BLOCKLIST).toContain("#window-controls");
    expect(WINDOW_GESTURE_BLOCKLIST).toContain("#agent-activity");
    expect(WINDOW_GESTURE_BLOCKLIST).toContain(".projects-dropdown");
    // Comportement de la fonction pure, sur de faux noeuds (aucun DOM requis).
    const noeud = (bloque) => ({ closest: () => (bloque ? {} : null) });
    expect(isWindowGestureTarget(noeud(false))).toBe(true);
    expect(isWindowGestureTarget(noeud(true))).toBe(false);
    expect(isWindowGestureTarget(null)).toBe(false);
    expect(isWindowGestureTarget({})).toBe(false);
    // Les deux gestionnaires l'appellent (glisser et double-clic).
    const init = sliceFrom(js, "export function initWindowControls", 100);
    expect(init.match(/isWindowGestureTarget\(e\.target\)/g)).toHaveLength(2);
  });

  it("Fermer appelle close() et jamais destroy()", () => {
    const fermeture = sliceFrom(js, "if (btnClose)", 50);
    expect(fermeture).toMatch(/win\.close\(\)/);
    // Aucun appel de destruction de la fenetre dans tout le module.
    expect(js).not.toMatch(/\.destroy\(/);
  });
});
