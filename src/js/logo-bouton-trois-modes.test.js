// logo-bouton-trois-modes.test.js — Verrou des regles FERMES du logo-bouton
// des trois modes d'ecran (CONCEPTION-logo-bouton-des-trois-modes.md, lot L4,
// §4.4).
//
// Ce fichier ne decrit pas le passe : il fixe ce qui doit rester vrai quand le
// code bougera encore. Ce qui est verrouille :
//   1. UN SEUL noeud de commande, et c'est le logo : `#mode-logo`, dans le
//      bandeau du nom de projet, AVANT le nom ; aucun `#screen-mode-button` ;
//   2. la chaine `screen-mode-button` a disparu du code et de la feuille de
//      style (aucun bouton dedie ne peut revenir par un reste de regle) ;
//   3. le dessin du logo est CONSERVE : `#btn-project-logo`, meme `src`, et il
//      est DANS le bouton (il n'a pas ete remplace par une icone) ;
//   4. un carre de 28 x 28 px, curseur main, jetons du projet pour le survol et
//      l'anneau clavier — ni mot, ni icone, ni pastille ;
//   5. la MEME place dans les deux pleins ecrans (13, 8), prouvee par une seule
//      regle a deux selecteurs : elle ne peut pas se dedoubler sans rougir ;
//   6. la garde de 400 ms du clic (double-clic reflexe = un seul mode), cas
//      limites compris, et son branchement AVANT l'application du mode ;
//   7. le logo est DEPLACE, jamais cree — et restitue deux fois (deux pleins
//      ecrans, deux retours chez le parent memorise) ;
//   8. le mode Zen est INCHANGE (decision D7 = A) : zero mecanisme ajoute, le
//      raccourci Ctrl+Shift+A reste le seul chemin quand le bandeau disparait ;
//   9. glisser et double-clic de fenetre restent actifs partout AILLEURS que sur
//      le logo (la garde-fou des gestes est inchangee).
//
// Aucun navigateur n'est requis (lecture des fichiers, fins de ligne
// normalisees, cf. quality-gate 3.4).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";
import {
  SCREEN_MODE_BUTTON_ID,
  MODE_CLICK_GUARD_MS,
  SCREEN_MODES,
  shouldIgnoreModeClick,
} from "./screen-mode.js";
import {
  WINDOW_DRAG_ZONE_IDS,
  WINDOW_GESTURE_BLOCKLIST,
  isWindowGestureTarget,
} from "./window-controls.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");
const superAgent = lire("src/js/super-agent.js");
const screenMode = lire("src/js/screen-mode.js");
const main = lire("src/js/main.js");
const windowControls = lire("src/js/window-controls.js");

/** Bloc CSS d'un selecteur simple (jusqu'a l'accolade fermante en debut de ligne). */
function bloc(selecteur) {
  return sliceSource(css, selecteur + " {", "\n}", 40);
}

/** Le balisage complet du bouton-logo (de son id jusqu'a sa fermeture). */
function baliseLogo() {
  return sliceSource(html, 'id="mode-logo"', "</button>", 60);
}

// ---------------------------------------------------------------------------
describe("1. un seul bouton, et c'est le logo (§4.4-1)", () => {
  it("un seul id=\"mode-logo\" dans tout le document", () => {
    expect(SCREEN_MODE_BUTTON_ID).toBe("mode-logo");
    expect(html.match(/id="mode-logo"/g) || []).toHaveLength(1);
  });

  it("il est dans #project-selector, avant #btn-project-name", () => {
    const bandeau = html.indexOf('id="project-selector"');
    const logo = html.indexOf('id="mode-logo"');
    const nom = html.indexOf('id="btn-project-name"');
    const finBandeau = html.indexOf("</div>", nom);
    expect(bandeau, "bandeau du projet introuvable").toBeGreaterThanOrEqual(0);
    expect(logo, "le logo-bouton n'est pas dans le bandeau").toBeGreaterThan(bandeau);
    expect(nom, "le nom du projet doit suivre le logo").toBeGreaterThan(logo);
    expect(finBandeau).toBeGreaterThan(nom);
  });

  it("aucun bouton dedie : ni #screen-mode-button, ni bouton dans la rangee", () => {
    expect(html).not.toContain('id="screen-mode-button"');
    const rangee = html.indexOf('id="tab-row"');
    const contenu = html.indexOf('id="main-content"');
    expect(rangee).toBeGreaterThanOrEqual(0);
    expect(contenu).toBeGreaterThan(rangee);
    expect(html.slice(rangee, contenu)).not.toContain('id="mode-logo"');
  });
});

// ---------------------------------------------------------------------------
describe("2. le bouton dedie a disparu du code et du style (§4.4-2)", () => {
  it("plus la moindre chaine « screen-mode-button »", () => {
    expect(superAgent).not.toContain("screen-mode-button");
    expect(css).not.toContain("screen-mode-button");
    expect(html).not.toContain("screen-mode-button");
    expect(main).not.toContain("screen-mode-button");
  });

  it("l'identifiant du bouton est declare UNE fois, et vaut « mode-logo »", () => {
    expect(screenMode).toContain('export const SCREEN_MODE_BUTTON_ID = "mode-logo";');
    expect(screenMode.match(/SCREEN_MODE_BUTTON_ID =/g) || []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("3. le dessin du logo est conserve (§4.4-3)", () => {
  it("#btn-project-logo garde son id et son fichier, et il est DANS le bouton", () => {
    expect(html).toContain('<button type="button" id="mode-logo"');
    const balise = baliseLogo();
    expect(balise).toContain('id="btn-project-logo"');
    expect(balise).toContain('src="/logo_pilot_vector.svg"');
  });

  it("l'image ne change pas de taille : 24 px, comme avant", () => {
    const image = bloc("#btn-project-logo");
    expect(image).toMatch(/height:\s*24px/);
    // Aucune regle ne la redimensionne pour un plein ecran.
    expect(css).not.toMatch(/pilot-vocal-active #btn-project-logo/);
    expect(css).not.toMatch(/superagent-immersive-active #btn-project-logo/);
  });
});

// ---------------------------------------------------------------------------
describe("4. un carre de 28 px, muet (§4.4-4)", () => {
  it("28 x 28 px, curseur main, rayon du projet, aucun jeton de texte", () => {
    const bouton = bloc("#mode-logo");
    expect(bouton).toMatch(/width:\s*28px/);
    expect(bouton).toMatch(/height:\s*28px/);
    expect(bouton).toMatch(/cursor:\s*pointer/);
    expect(bouton).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(bouton).not.toMatch(/font-size:/);
    expect(bouton).not.toMatch(/^\s*color:/m);
  });

  it("survol avec --surface-2, anneau clavier avec --accent", () => {
    expect(bloc("#mode-logo:hover")).toMatch(/background:\s*var\(--surface-2\)/);
    expect(bloc("#mode-logo:focus-visible")).toMatch(/outline:\s*2px solid var\(--accent\)/);
    // Le focus clavier n'ajoute pas d'anneau au clic souris (regle d'une ligne).
    expect(sliceSource(css, "#mode-logo:focus {", "}", 10)).toMatch(/outline:\s*none/);
  });

  it("ni mot, ni icone, ni pastille de mode, nulle part", () => {
    expect(baliseLogo()).not.toContain("screen-mode-dot");
    expect(baliseLogo()).not.toContain("screen-mode-label");
    expect(css).not.toContain(".screen-mode-dot");
    expect(css).not.toContain(".screen-mode-label");
    expect(css).not.toContain(".screen-mode-icon");
    expect(superAgent).not.toContain("screen-mode-dot");
  });
});

// ---------------------------------------------------------------------------
describe("5. la meme place dans les trois modes (§4.4-5)", () => {
  it("en « Detaille », le logo reste dans le flux : aucune regle absolue", () => {
    const bouton = bloc("#mode-logo");
    expect(bouton).not.toMatch(/position:/);
    expect(bouton).not.toMatch(/^\s*top:/m);
    expect(bouton).not.toMatch(/^\s*left:/m);
  });

  it("les DEUX pleins ecrans partagent UNE seule regle : meme top, meme left", () => {
    const regle = sliceSource(
      css,
      "body.superagent-immersive-active #mode-logo,",
      "\n}",
      120,
    );
    // Les deux selecteurs sont bien dans la meme regle (aucun oubli de l'un).
    expect(regle).toContain("body.superagent-immersive-active #mode-logo,");
    expect(regle).toContain("body.pilot-vocal-active #mode-logo {");
    // Donc UNE seule declaration de chaque cote : impossible de les separer.
    expect(regle.match(/\btop:/g) || []).toHaveLength(1);
    expect(regle.match(/\bleft:/g) || []).toHaveLength(1);
    expect(regle).toMatch(/position:\s*absolute/);
    expect(regle).toMatch(/top:\s*8px/);
    expect(regle).toMatch(/left:\s*13px/);
    expect(regle).toMatch(/margin:\s*0/);
  });

  it("le logo sort du flux : il ne pousse ni la barre de 58 px ni celle de 44 px", () => {
    // Les deux barres gardent leur hauteur, quel que soit le contenu deplace.
    expect(bloc(".sa-immersive-top")).toMatch(/height:\s*58px/);
    expect(bloc(".vocal-top")).toMatch(/height:\s*44px/);
    // Et le logo n'est le dernier enfant d'aucune des deux barres.
    expect(superAgent).not.toContain("immersiveTop.appendChild(screenModeButton)");
    expect(superAgent).not.toContain("barre.appendChild(modeButton)");
  });
});

// ---------------------------------------------------------------------------
describe("6. la garde de 400 ms du clic (§4.4-6)", () => {
  it("la garde vaut 400 ms, sous le seuil systeme du double-clic", () => {
    expect(MODE_CLICK_GUARD_MS).toBe(400);
    // Sous les 500 ms de reconnaissance systeme : les deux clics d'un
    // double-clic reflexe tombent dans la garde.
    expect(MODE_CLICK_GUARD_MS).toBeLessThan(500);
  });

  it("premier clic : jamais ignore", () => {
    expect(shouldIgnoreModeClick(1000, -Infinity)).toBe(false);
  });

  it("399 ms apres le clic pris en compte : ignore", () => {
    expect(shouldIgnoreModeClick(1400, 1001)).toBe(true);
    expect(shouldIgnoreModeClick(1000, 999)).toBe(true);
  });

  it("exactement 400 ms : pris en compte (deux clics volontaires)", () => {
    expect(shouldIgnoreModeClick(1400, 1000)).toBe(false);
    expect(shouldIgnoreModeClick(1400, 999)).toBe(false);
  });

  it("valeurs non numeriques : la garde ne bloque jamais", () => {
    expect(shouldIgnoreModeClick(NaN, 1000)).toBe(false);
    expect(shouldIgnoreModeClick(1000, NaN)).toBe(false);
    expect(shouldIgnoreModeClick(undefined, undefined)).toBe(false);
    expect(shouldIgnoreModeClick("1000", "990")).toBe(false);
  });

  it("la garde est branchee AVANT l'application du mode", () => {
    const cable = sliceSource(screenMode, "btn.addEventListener(\"click\"", "});", 40);
    const iGarde = cable.indexOf("if (shouldIgnoreModeClick(maintenant, dernierClicMode)) return;");
    const iMode = cable.indexOf("applyScreenMode(nextScreenMode(getScreenMode()))");
    expect(iGarde, "la garde n'est plus posee sur le clic du logo").toBeGreaterThanOrEqual(0);
    expect(iMode, "le clic n'applique plus le mode suivant").toBeGreaterThan(iGarde);
    // L'horodatage n'avance que sur un clic PRIS EN COMPTE.
    const iMemo = cable.indexOf("dernierClicMode = maintenant;");
    expect(iMemo).toBeGreaterThan(iGarde);
    expect(iMemo).toBeLessThan(iMode);
  });

  it("le cycle reste celui des trois modes, dans l'ordre", () => {
    expect(SCREEN_MODES.map((m) => m.id)).toEqual(["detailed", "assistant", "vocal"]);
  });
});

// ---------------------------------------------------------------------------
describe("7. deplace, jamais cree (§4.4-7)", () => {
  it("le noeud est lu, pas fabrique", () => {
    expect(superAgent).toContain("getElementById(SCREEN_MODE_BUTTON_ID)");
    expect(superAgent).not.toMatch(/id\s*=\s*["']mode-logo["']/);
    expect(screenMode).not.toMatch(/createElement\(["']button["']\)[\s\S]{0,200}mode-logo/);
    expect(html.match(/id="mode-logo"/g) || []).toHaveLength(1);
  });

  it("il entre dans les DEUX overlays et revient DEUX fois chez son parent", () => {
    expect(superAgent).toContain("immersiveOverlay.appendChild(screenModeButton)");
    expect(superAgent).toContain("vocalOverlay.appendChild(modeButton)");
    // Deux pleins ecrans, deux retours : le meme motif, a l'identique.
    expect(superAgent.match(/modeHome\.parent\.insertBefore\(modeButton, next\)/g) || []).toHaveLength(2);
    // Chaque deplacement memorise la place d'origine (parent + voisin), et
    // chaque sortie l'oublie : aucun etat ne survit d'un plein ecran a l'autre.
    expect(superAgent.match(/(?:immersive|vocal)ModeButtonHome = \{/g) || []).toHaveLength(2);
    expect(superAgent.match(/(?<!let )(?:immersive|vocal)ModeButtonHome = null;/g) || []).toHaveLength(
      2,
    );
  });
});

// ---------------------------------------------------------------------------
describe("8. le mode Zen est inchange (D7 = A)", () => {
  it("le Zen masque toujours la colonne de gauche, donc le logo, sans exception", () => {
    const zen = sliceSource(css, "body.zen-mode #sidebar,", "\n}", 40);
    expect(zen).toContain("body.zen-mode #project-footer {");
    expect(zen).toMatch(/display:\s*none/);
    // Aucune regle speciale pour le logo en Zen : il disparait comme le reste.
    expect(css).not.toMatch(/zen-mode[^{]*mode-logo/);
    expect(css).not.toMatch(/zen-mode[^{]*btn-project-logo/);
    expect(superAgent).not.toMatch(/zen-mode/);
  });

  it("les deux bascules du Zen sont inchangees", () => {
    expect(main.match(/document\.body\.classList\.toggle\("zen-mode"\)/g) || []).toHaveLength(2);
    expect(main).toContain('if (e.key === "F11")');
  });

  it("Ctrl+Shift+A reste le chemin quand le bandeau a disparu", () => {
    const raccourci = sliceSource(superAgent, "const onImmersiveKeydown = (e) => {", "\n  };", 100);
    expect(raccourci).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.shiftKey/);
    expect(raccourci).toMatch(/e\.key === "A" \|\| e\.key === "a"/);
    expect(raccourci).toContain("else enterImmersive();");
  });
});

// ---------------------------------------------------------------------------
describe("9. glisser et double-clic restent actifs ailleurs que sur le logo", () => {
  it("la garde-fou des gestes est inchangee : un bouton ne glisse pas", () => {
    expect(WINDOW_GESTURE_BLOCKLIST).toContain("button");
    // Un element DANS un bouton (le logo, ou son image) bloque le geste...
    const dansUnBouton = { closest: (selecteur) => (selecteur.includes("button") ? {} : null) };
    expect(isWindowGestureTarget(dansUnBouton)).toBe(false);
    // ...alors que le vide du bandeau et de la rangee reste glissable.
    const zoneVide = { closest: () => null };
    expect(isWindowGestureTarget(zoneVide)).toBe(true);
  });

  it("les deux zones de glissement n'ont pas bouge", () => {
    expect(WINDOW_DRAG_ZONE_IDS).toEqual(["project-selector", "tab-row"]);
    expect(windowControls).not.toContain("mode-logo");
    expect(windowControls).not.toContain("screen-mode");
  });
});
