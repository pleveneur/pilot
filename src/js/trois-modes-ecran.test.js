// trois-modes-ecran.test.js — Verrou du LOT 1 « trois modes d'ecran »
// (RAPPORT-trois-modes-ecran-vocal.md §1 et §5 « Lot 1 »).
//
// Ce qui est verrouille ici :
//   - TROIS modes, dans cet ordre de cycle : Detaille -> Assistant seul -> Vocal ;
//   - UNE SEULE cle de memoire du poste (`pilot_screen_mode`) et la migration de
//     l'ancien reglage BINAIRE (`pilot_superagent_immersive`), valeur conservee ;
//   - UN SEUL bouton, un seul noeud dans tout le document, place entre l'entree
//     « Travail » et les trois boutons systeme (aucune creation, aucune copie) ;
//   - les libelles, les infobulles et les icones EXACTS du rapport ;
//   - « Vocal » demande un PLEIN ECRAN comme « Assistant seul » ; depuis le
//     lot 2 il a son propre ecran (verrouille par ecran-vocal-lot2.test.js),
//     ce fichier ne verrouille que le bouton et la cle de memoire.
//
// Aucun navigateur n'est requis (lecture des fichiers, fins de ligne
// normalisees, cf. quality-gate 3.4).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCREEN_MODE_KEY,
  LEGACY_IMMERSIVE_KEY,
  SCREEN_MODE_BUTTON_ID,
  SCREEN_MODE_APPLY_EVENT,
  SCREEN_MODES,
  normalizeScreenMode,
  screenModeInfo,
  nextScreenMode,
  isImmersiveScreenMode,
  screenModeTitle,
  readScreenMode,
  writeScreenMode,
} from "./screen-mode.js";
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");
const superAgent = lire("src/js/super-agent.js");
const main = lire("src/js/main.js");

/** Faux localStorage : les pures restent testables hors navigateur. */
function fauxStockage(initial = {}) {
  const donnees = new Map(Object.entries(initial));
  return {
    getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
    setItem: (k, v) => {
      donnees.set(k, String(v));
    },
    removeItem: (k) => {
      donnees.delete(k);
    },
    donnees,
  };
}

/** Bloc CSS d'un selecteur (jusqu'a l'accolade fermante en debut de ligne). */
function bloc(selecteur) {
  const debut = css.indexOf("\n" + selecteur + " {\n");
  expect(debut, `bloc CSS « ${selecteur} » introuvable`).toBeGreaterThanOrEqual(0);
  const fin = css.indexOf("\n}", debut);
  return css.slice(debut, fin);
}

describe("1. les trois modes, dans l'ordre du cycle (§1.2)", () => {
  it("trois modes exactement, nommes et ordonnes", () => {
    expect(SCREEN_MODES.map((m) => m.id)).toEqual(["detailed", "assistant", "vocal"]);
    expect(SCREEN_MODES.map((m) => m.label)).toEqual(["Détaillé", "Assistant seul", "Vocal"]);
  });

  it("les trois icones Lucide sont celles du rapport", () => {
    expect(SCREEN_MODES.map((m) => m.icon)).toEqual([
      "panels-top-left",
      "message-circle",
      "audio-lines",
    ]);
  });

  it("le cycle fait le tour complet puis revient au depart", () => {
    expect(nextScreenMode("detailed")).toBe("assistant");
    expect(nextScreenMode("assistant")).toBe("vocal");
    expect(nextScreenMode("vocal")).toBe("detailed");
    // Trois clics ramenent au point de depart, quel que soit le depart.
    let mode = "detailed";
    for (let i = 0; i < 3; i += 1) mode = nextScreenMode(mode);
    expect(mode).toBe("detailed");
  });

  it("une valeur absente ou inconnue retombe sur « Detaille », jamais sur une exception", () => {
    expect(normalizeScreenMode(undefined)).toBe("detailed");
    expect(normalizeScreenMode(null)).toBe("detailed");
    expect(normalizeScreenMode("")).toBe("detailed");
    expect(normalizeScreenMode("Vocal")).toBe("detailed");
    expect(normalizeScreenMode("immersive")).toBe("detailed");
    expect(normalizeScreenMode(" assistant ")).toBe("detailed");
    expect(screenModeInfo("inconnu").id).toBe("detailed");
  });

  it("l'infobulle dit le mode COURANT puis annonce le SUIVANT", () => {
    expect(screenModeTitle("detailed")).toBe(
      "Mode d'écran : Détaillé. Passer à « Assistant seul ».",
    );
    expect(screenModeTitle("assistant")).toBe("Mode d'écran : Assistant seul. Passer à « Vocal ».");
    expect(screenModeTitle("vocal")).toBe("Mode d'écran : Vocal. Passer à « Détaillé ».");
  });

  it("« Vocal » demande un plein ecran (son propre ecran depuis le lot 2)", () => {
    expect(isImmersiveScreenMode("detailed")).toBe(false);
    expect(isImmersiveScreenMode("assistant")).toBe(true);
    expect(isImmersiveScreenMode("vocal")).toBe(true);
  });
});

describe("2. une seule cle de memoire, et la migration de l'ancien reglage (§1.3)", () => {
  it("les noms de cles sont ceux du rapport", () => {
    expect(SCREEN_MODE_KEY).toBe("pilot_screen_mode");
    expect(LEGACY_IMMERSIVE_KEY).toBe("pilot_superagent_immersive");
  });

  it("sans memoire : « Detaille »", () => {
    expect(readScreenMode(fauxStockage())).toBe("detailed");
  });

  it("migration : ancien reglage « 1 » et cle absente -> « assistant », ecrit une fois", () => {
    const st = fauxStockage({ [LEGACY_IMMERSIVE_KEY]: "1" });
    expect(readScreenMode(st)).toBe("assistant");
    expect(st.donnees.get(SCREEN_MODE_KEY)).toBe("assistant");
    // L'ANCIENNE VALEUR EST CONSERVEE : retour arriere possible vers une
    // version anterieure, qui ne lit qu'elle.
    expect(st.donnees.get(LEGACY_IMMERSIVE_KEY)).toBe("1");
  });

  it("migration : ancien reglage « 0 » -> « Detaille », rien d'autre n'est ecrit", () => {
    const st = fauxStockage({ [LEGACY_IMMERSIVE_KEY]: "0" });
    expect(readScreenMode(st)).toBe("detailed");
    expect(st.donnees.has(SCREEN_MODE_KEY)).toBe(false);
  });

  it("la nouvelle cle est PRIORITAIRE sur l'ancienne", () => {
    const st = fauxStockage({
      [SCREEN_MODE_KEY]: "detailed",
      [LEGACY_IMMERSIVE_KEY]: "1",
    });
    expect(readScreenMode(st)).toBe("detailed");
  });

  it("une valeur memorisee inconnue ne fait pas perdre la migration", () => {
    const st = fauxStockage({
      [SCREEN_MODE_KEY]: "brouillon",
      [LEGACY_IMMERSIVE_KEY]: "1",
    });
    // La cle existe : la migration ne s'applique pas (elle est reservee au cas
    // « cle absente »), le mode retombe proprement sur « Detaille ».
    expect(readScreenMode(st)).toBe("detailed");
  });

  it("aller-retour d'ecriture pour les trois modes (une seule cle ecrite)", () => {
    for (const mode of ["assistant", "vocal", "detailed"]) {
      const st = fauxStockage({});
      expect(writeScreenMode(mode, st)).toBe(mode);
      expect(st.donnees.get(SCREEN_MODE_KEY)).toBe(mode);
      expect(st.donnees.size).toBe(1);
      expect(readScreenMode(st)).toBe(mode);
    }
  });

  it("aucun stockage disponible (ou refuse) : « Detaille », jamais d'exception", () => {
    expect(readScreenMode(null)).toBe("detailed");
    expect(writeScreenMode("vocal", null)).toBe("vocal");
    const casse = {
      getItem() {
        throw new Error("refus");
      },
      setItem() {
        throw new Error("refus");
      },
    };
    expect(readScreenMode(casse)).toBe("detailed");
    expect(writeScreenMode("vocal", casse)).toBe("vocal");
  });
});

describe("3. un seul bouton, un seul noeud dans tout le document (§1.1)", () => {
  it("le bouton est dans index.html, entre « Travail » et les boutons systeme", () => {
    expect(SCREEN_MODE_BUTTON_ID).toBe("screen-mode-button");
    const occurrences = html.match(new RegExp('id="' + SCREEN_MODE_BUTTON_ID + '"', "g")) || [];
    expect(occurrences, "un seul noeud : aucune copie dans le document").toHaveLength(1);
    const travail = html.indexOf('id="agent-activity"');
    const mode = html.indexOf('id="' + SCREEN_MODE_BUTTON_ID + '"');
    const boutons = html.indexOf('id="window-controls"');
    expect(mode).toBeGreaterThan(travail);
    expect(boutons).toBeGreaterThan(mode);
    // Et dans la rangee d'onglets, pas ailleurs.
    const rangee = html.indexOf('id="tab-row"');
    const contenu = html.indexOf('id="main-content"');
    expect(mode).toBeGreaterThan(rangee);
    expect(mode).toBeLessThan(contenu);
  });

  it("le bouton n'est jamais cree par du code : il est DEPLACE", () => {
    expect(superAgent).not.toMatch(/id\s*=\s*["']screen-mode-button["']/);
    expect(superAgent).toContain("getElementById(SCREEN_MODE_BUTTON_ID)");
    // Deplacement puis restitution : les deux sens existent.
    expect(superAgent).toContain("insertBefore(screenModeButton, ancre)");
    expect(superAgent).toContain("immersiveModeButtonHome");
  });

  it("le bouton porte le libelle du mode courant et l'infobulle du suivant", () => {
    // Etat au repos du document = mode « Detaille » (reecrit au demarrage).
    const balise = sliceSource(html, 'id="screen-mode-button"', "</button>", 200);
    expect(balise).toContain('data-screen-mode="detailed"');
    expect(balise).toContain("Mode d'écran : Détaillé");
    expect(balise).toContain(">Détaillé</span>");
    expect(balise).toContain('class="screen-mode-dot"');
  });

  it("a la sortie du plein ecran, MODE est restitue AVANT « Travail » (§1.1)", () => {
    // Piege mesure : la place d'origine de « Travail » etant le bouton des
    // modes, et celui-ci etant lui aussi dans l'overlay, restituer « Travail »
    // en premier le rejetait en fin de rangee (apres les boutons systeme).
    const sortie = sliceSource(
      superAgent,
      "function exitImmersive() {",
      "// Ajustements A19 : si l'assistant réfléchissait encore",
      400,
    );
    const iMode = sortie.indexOf("modeHome.parent.insertBefore(modeButton, next)");
    const iTravail = sortie.indexOf("home.parent.insertBefore(activity, next)");
    expect(iMode, "le bouton des modes doit etre restitue").toBeGreaterThanOrEqual(0);
    expect(iTravail, "l'entree « Travail » doit etre restituee").toBeGreaterThanOrEqual(0);
    expect(iMode, "MODE avant « Travail » : la place d'origine redevient valide").toBeLessThan(
      iTravail,
    );
    // Les deux restitutions se font AVANT le retrait de l'overlay.
    expect(sortie.indexOf("immersiveOverlay.remove()")).toBeGreaterThan(iTravail);
  });

  it("le bouton est cable au demarrage et le mode rejoue avant le masquage", () => {
    expect(main).toContain("initScreenMode()");
    // Le mode memorise peut exiger l'onglet Assistant : il est alors ouvert.
    expect(main).toContain("isImmersiveScreenMode(getScreenMode())");
    expect(SCREEN_MODE_APPLY_EVENT).toBe("pilot-screen-mode-apply");
    // Ordre de demarrage (§1.3) : le bouton et le mode sont pretes AVANT
    // l'ouverture de l'onglet Assistant, elle-meme AVANT le masquage de
    // l'ecran de chargement — l'utilisateur ne voit jamais l'ecran « Detaille »
    // clignoter avant son ecran memorise.
    const iInit = main.indexOf("initScreenMode()");
    const iOnglet = main.indexOf("isImmersiveScreenMode(getScreenMode())");
    const iMasquage = main.indexOf('bootOverlay.classList.add("hidden")');
    expect(iInit).toBeGreaterThanOrEqual(0);
    expect(iOnglet).toBeGreaterThan(iInit);
    expect(iMasquage).toBeGreaterThan(iOnglet);
  });

  it("fermer l'onglet Assistant en plein ecran ramene a l'ecran normal (recette §5)", () => {
    // Le mode vit dans l'overlay de l'onglet : sa fermeture doit en SORTIR,
    // sans quoi le prochain demarrage rouvrirait un onglet fantome.
    const fermeture = sliceSource(superAgent, "    unlisten: async () => {", "      origUnlisten();", 200);
    expect(fermeture).toContain("if (immersiveOverlay) exitImmersive();");
    expect(superAgent).toContain("window._pilotSuperAgentOpen = false;");
  });
});

describe("4. apparence du bouton : largeur fixe puis auto (§1.2)", () => {
  it("28 px de haut, 88 px de large, rayon et jeton de texte du projet", () => {
    const bouton = bloc("#screen-mode-button");
    expect(bouton).toMatch(/height:\s*28px/);
    expect(bouton).toMatch(/width:\s*88px/);
    expect(bouton).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(bouton).toMatch(/font-size:\s*var\(--font-sm\)/);
    expect(bouton).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it("dans le plein ecran, la largeur redevient AUTO (icone + mot)", () => {
    const immersif = bloc("body.superagent-immersive-active #screen-mode-button");
    expect(immersif).toMatch(/width:\s*auto/);
    expect(immersif).not.toMatch(/width:\s*\d+px/);
  });

  it("la pastille prend la teinte du mode courant, sans couleur inventee", () => {
    expect(css).toMatch(
      /#screen-mode-button\[data-screen-mode="assistant"\] \.screen-mode-dot\s*\{[^}]*var\(--superagent-accent\)/,
    );
    expect(css).toMatch(
      /#screen-mode-button\[data-screen-mode="vocal"\] \.screen-mode-dot\s*\{[^}]*var\(--vocal-listen/,
    );
  });
});
