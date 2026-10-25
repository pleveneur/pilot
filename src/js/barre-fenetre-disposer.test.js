// barre-fenetre-disposer.test.js — Verrou du LOT 0.5 de la barre de fenetre.
//
// Ce que ce fichier garantit (docs/proposition-barre-fenetre.md §8.2, lot 0.5) :
//   1. le menu « Disposer » a EXACTEMENT trois entrees, dans l'ordre gauche,
//      droite, plein ecran, et chacune est nommee ;
//   2. le calcul de la cible est juste : deux moities de largeur egale (sans
//      trou ni recouvrement, largeur impaire comprise), dans la ZONE UTILE de
//      l'ecran (barre des taches exclue), y compris sur un ecran secondaire ;
//   3. le menu ne s'ouvre QU'AU CLIC DROIT : le clic gauche sur « Agrandir »
//      garde son geste d'origine (agrandir / restaurer) ;
//   4. Echap ferme le menu, et un appui hors du menu le ferme aussi ;
//   5. la fenetre est REELLEMENT placee : restauration si elle est agrandie,
//      puis position et taille de la cible (plein ecran = agrandissement) ;
//   6. le menu vit AU-DESSUS de la bande de fenetre (jamais dessous) et suit
//      les jetons de surface, donc le theme sombre comme le theme clair.
//
// Tous les decoupages passent par sliceSource (source-slice.js) : une ancre
// absente fait ECHOUER le test au lieu de rendre une assertion negative vraie
// par construction.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  DISPOSE_MENU_ID,
  DISPOSE_ZONES,
  DISPOSE_LABELS,
  DISPOSE_HINTS,
  computeDisposeTarget,
  isDisposeMenuOpen,
} from "./window-controls.js";

const ici = dirname(fileURLToPath(import.meta.url));
// Lecture normalisee : un worktree en CRLF ne doit pas faire echouer les ancres.
const lire = (rel) => readFileSync(join(ici, rel), "utf8").replace(/\r\n/g, "\n");
const css = lire("../css/style.css");
const js = lire("./window-controls.js");

// --- 1. Les trois entrees --------------------------------------------------
describe("1. trois entrees, nommees, dans l'ordre gauche / droite / plein ecran", () => {
  it("l'ordre et les libelles sont exactement ceux demandes", () => {
    expect(DISPOSE_ZONES).toEqual(["left", "right", "full"]);
    expect(DISPOSE_ZONES.map((z) => DISPOSE_LABELS[z])).toEqual([
      "Moitié gauche de l'écran",
      "Moitié droite de l'écran",
      "Plein écran",
    ]);
  });

  it("chaque entree porte une infobulle qui dit le geste exact", () => {
    for (const zone of DISPOSE_ZONES) {
      expect(DISPOSE_HINTS[zone], zone).toBeTruthy();
      expect(DISPOSE_HINTS[zone].length, zone).toBeGreaterThan(20);
    }
  });

  it("le menu est construit a partir de la liste des zones (aucune entree en dur)", () => {
    const construction = sliceSource(js, "function ensureDisposeMenu(win) {", "document.body.appendChild(menu);", 200);
    expect(construction).toContain("for (const zone of DISPOSE_ZONES)");
    expect(construction).toContain("entree.textContent = DISPOSE_LABELS[zone]");
    expect(construction).toContain("entree.title = DISPOSE_HINTS[zone]");
    // Un seul menu dans le document, et il n'est pas dans un bouton.
    expect(construction).toContain("menu.id = DISPOSE_MENU_ID");
    expect(DISPOSE_MENU_ID).toBe("dispose-menu");
  });
});

// --- 2. Le calcul de la cible ---------------------------------------------
describe("2. chaque zone vise le bon rectangle", () => {
  const ecran = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } };

  it("moitie gauche : toute la hauteur, la moitie de la largeur", () => {
    expect(computeDisposeTarget("left", ecran)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it("moitie droite : elle commence a la moitie et va jusqu'au bord", () => {
    expect(computeDisposeTarget("right", ecran)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it("largeur impaire : aucune moitie perdue, aucun recouvrement", () => {
    const impair = { position: { x: 0, y: 0 }, size: { width: 1365, height: 768 } };
    const gauche = computeDisposeTarget("left", impair);
    const droite = computeDisposeTarget("right", impair);
    expect(gauche.width).toBe(682);
    expect(droite.x).toBe(682);
    expect(droite.width).toBe(683);
    expect(gauche.width + droite.width).toBe(1365);
  });

  it("zone utile : la barre des taches est exclue (hauteur et decalage)", () => {
    const avecBarre = { position: { x: 0, y: 40 }, size: { width: 1920, height: 1040 } };
    const cible = computeDisposeTarget("left", avecBarre);
    expect(cible).toEqual({ x: 0, y: 40, width: 960, height: 1040 });
  });

  it("ecran secondaire : la cible suit son origine, pas celle de l'ecran principal", () => {
    const second = { position: { x: 1920, y: -200 }, size: { width: 2560, height: 1440 } };
    expect(computeDisposeTarget("left", second)).toEqual({ x: 1920, y: -200, width: 1280, height: 1440 });
    expect(computeDisposeTarget("right", second)).toEqual({ x: 3200, y: -200, width: 1280, height: 1440 });
  });

  it("zone illisible : aucune exception, aucune cible", () => {
    expect(computeDisposeTarget("left", null)).toBeNull();
    expect(computeDisposeTarget("left", { position: { x: 0, y: 0 } })).toBeNull();
    expect(computeDisposeTarget("left", { position: null, size: { width: 10, height: 10 } })).toBeNull();
    expect(computeDisposeTarget("left", { position: { x: 0, y: 0 }, size: { width: 0, height: 10 } })).toBeNull();
    expect(computeDisposeTarget("left", { position: { x: Number.NaN, y: 0 }, size: { width: 10, height: 10 } })).toBeNull();
  });

  it("le plein ecran n'a pas de rectangle : il passe par l'agrandissement", () => {
    expect(computeDisposeTarget("full", ecran)).toBeNull();
    expect(computeDisposeTarget("inconnue", ecran)).toBeNull();
  });
});

// --- 3. Le clic gauche est inchange ---------------------------------------
describe("3. le menu ne s'ouvre QU'AU CLIC DROIT", () => {
  const boutonMax = sliceSource(js, "  if (btnMax) {", "  }\n\n  if (btnClose) {", 120);

  it("le clic gauche du bouton du milieu garde son geste d'origine", () => {
    expect(boutonMax).toContain('btnMax.addEventListener("click", () => toggleMaximize(win));');
    expect(boutonMax).not.toContain('btnMax.addEventListener("click", () => openDisposeMenu');
  });

  it("le menu s'ouvre sur contextmenu, a la position du clic", () => {
    expect(boutonMax).toContain('btnMax.addEventListener("contextmenu"');
    expect(boutonMax).toContain("openDisposeMenu(win, e.clientX, e.clientY)");
    // Le menu natif du WebView ne doit pas s'afficher par-dessus.
    expect(boutonMax).toContain("e.preventDefault()");
  });

  it("aucun autre element de la bande n'ouvre le menu", () => {
    const init = sliceSource(js, "export function initWindowControls()", "\n  // LOT 0.5 : fermeture du menu", 500);
    for (const ligne of init.split("\n")) {
      if (!ligne.includes("openDisposeMenu(")) continue;
      expect(ligne.trim().startsWith("openDisposeMenu"), ligne).toBe(true);
    }
  });

  it("le menu est ferme au depart (classe `hidden`, donc invisible)", () => {
    expect(js).toContain('menu.className = "context-menu hidden"');
    expect(css).toContain(".context-menu.hidden { display: none; }");
    expect(isDisposeMenuOpen()).toBe(false);
  });
});

// --- 4. Les deux fermetures ----------------------------------------------
describe("4. Echap et l'appui hors du menu ferment le menu", () => {
  it("Echap ferme le menu (et seulement s'il est ouvert)", () => {
    const bloc = sliceSource(js, 'document.addEventListener("keydown"', "\n  });", 80);
    expect(bloc).toContain('e.key !== "Escape"');
    expect(bloc).toContain("!isDisposeMenuOpen()");
    expect(bloc).toContain("closeDisposeMenu()");
  });

  it("un appui hors du menu le ferme, sans fermer le menu quand on clique dedans", () => {
    const bloc = sliceSource(js, 'document.addEventListener(\n    "mousedown",', "\n    true,", 80);
    expect(bloc).toContain("!isDisposeMenuOpen()");
    expect(bloc).toContain("!disposeMenu.contains(e.target)");
    expect(bloc).toContain("closeDisposeMenu()");
  });

  it("fermer le menu ne detruit rien : il devient simplement invisible", () => {
    const bloc = sliceSource(js, "export function closeDisposeMenu() {", "\n}", 40);
    expect(bloc).toContain('classList.add("hidden")');
    expect(bloc).not.toContain("remove()");
  });
});

// --- 5. La fenetre est reellement placee ---------------------------------
describe("5. chaque entree place la fenetre", () => {
  const placer = sliceSource(js, "export async function applyDisposeZone(win, zone) {", "\n}\n", 400);

  it("les moities passent par setPosition + setSize, en pixels physiques", () => {
    expect(placer).toContain("new PhysicalPosition(cible.x, cible.y)");
    expect(placer).toContain("new PhysicalSize(cible.width, cible.height)");
    expect(placer).toContain("win.setPosition(");
    expect(placer).toContain("win.setSize(");
  });

  it("une fenetre agrandie est RESTAUREE avant d'etre placee (sinon position ignoree)", () => {
    const moities = sliceSource(placer, "const cible = computeDisposeTarget", "await syncMaxButton(win);", 100);
    const iToggle = moities.indexOf("await toggleMaximize(win)");
    const iPosition = moities.indexOf("win.setPosition(");
    expect(iToggle).toBeGreaterThan(-1);
    expect(iPosition).toBeGreaterThan(iToggle);
  });

  it("le plein ecran agrandit, sans jamais forcer deux fois", () => {
    const bloc = sliceSource(js, 'if (zone === "full") {', "return true;\n  }", 60);
    expect(bloc).toContain("if (await readMaximized(win)) return true;");
    expect(bloc).toContain("await toggleMaximize(win)");
    expect(bloc).not.toContain("setSize");
  });

  it("la cible vient de la ZONE UTILE de l'ecran courant", () => {
    expect(placer).toContain("computeDisposeTarget(zone, await readWorkArea(win))");
    const lecture = sliceSource(js, "async function readWorkArea(win) {", "\n}\n", 150);
    expect(lecture).toContain("await win.currentMonitor()");
    expect(lecture).toContain("moniteur.workArea || moniteur");
  });

  it("aucune exception ne remonte et rien n'est detruit", () => {
    expect(placer).toContain("catch (e)");
    expect(placer).not.toContain("destroy");
  });
});

// --- 6. Le menu reste au-dessus de la bande, en sombre comme en clair ----
describe("6. placement du menu : au-dessus de la bande, jetons de surface", () => {
  it("le menu passe AU-DESSUS de la bande de fenetre (sinon il serait cache)", () => {
    const bande = sliceSource(css, "#window-bar {", "}", 100);
    const zBande = Number(bande.match(/z-index:\s*(\d+)/)[1]);
    const menu = sliceSource(css, "#dispose-menu {", "}", 20);
    const zMenu = Number(menu.match(/z-index:\s*(\d+)/)[1]);
    expect(zBande).toBe(100001);
    expect(zMenu).toBeGreaterThan(zBande);
  });

  it("le menu est garde sous la bande a l'ouverture (jamais derriere elle)", () => {
    const ouverture = sliceSource(js, "export function openDisposeMenu(win, x, y) {", "\n}\n", 200);
    expect(ouverture).toContain("bandHeight() + marge");
    expect(ouverture).toContain("Math.max(hautMini, y)");
  });

  it("l'apparence vient des menus contextuels existants : sombre ET clair", () => {
    // Le look est celui de .context-menu (jetons de surface), donc il suit les
    // 8 sous-themes sans une ligne de plus ; aucune couleur en dur n'est ajoutee.
    const contexte = sliceSource(css, ".context-menu {", "}", 100);
    expect(contexte).toContain("background: var(--surface-floating)");
    const entreeContexte = sliceSource(css, ".context-menu button {", "}", 100);
    expect(entreeContexte).toContain("color: var(--text-primary)");
    const menu = sliceSource(css, "#dispose-menu {", "}", 20);
    // Aucune couleur en dur dans la regle propre au menu : il n'ajoute que sa
    // position d'empilement et sa largeur minimale.
    expect(menu).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(menu).toContain("z-index");
    expect(js).toContain('menu.className = "context-menu hidden"');
  });
});
