// trois-modes-ecran.test.js — Verrou du LOT 1 « trois modes d'ecran »
// (RAPPORT-trois-modes-ecran-vocal.md §1 et §5 « Lot 1 »).
//
// Ce qui est verrouille ici :
//   - TROIS modes, dans cet ordre de cycle : Detaille -> Assistant seul -> Vocal ;
//   - UNE SEULE cle de memoire du poste (`pilot_screen_mode`) et la migration de
//     l'ancien reglage BINAIRE (`pilot_superagent_immersive`), valeur conservee ;
//   - UN SEUL bouton, un seul noeud dans tout le document : depuis les lots 1 a 3
//     du document de conception du logo-bouton, c'est le LOGO de Pilot, place
//     dans le bandeau du nom de projet (#project-selector), avant ce nom
//     (aucune creation, aucune copie, aucun second bouton dedie) ;
//   - les infobulles EXACTES du rapport (le bouton ne porte plus de libelle
//     visible ni de pastille : il n'affiche que le logo) ;
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

/**
 * La regle COMMUNE aux deux pleins ecrans : un seul bloc CSS pour deux
 * selecteurs, donc une seule place. `bloc()` ne sait pas lire une liste ; cette
 * fonction exige la liste EXACTE, ce qui verrouille les deux selecteurs a la
 * fois.
 */
function blocPleinsEcrans() {
  return sliceSource(
    css,
    "body.superagent-immersive-active #mode-logo,\nbody.pilot-vocal-active #mode-logo {",
    "\n}",
    120,
  );
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
  it("le bouton est le LOGO, dans le bandeau du projet, avant le nom du projet", () => {
    // Adaptation L4 (document de conception §4.3) : l'ancien bouton dedie
    // `#screen-mode-button` vivait entre l'entree « Travail » et les boutons
    // systeme. Sa place a change — c'est le logo, dans le bandeau du haut — mais
    // l'INTENTION reste la meme : un seul noeud, a une place unique et verifiee,
    // et pas dans la rangee d'onglets.
    expect(SCREEN_MODE_BUTTON_ID).toBe("mode-logo");
    const occurrences = html.match(new RegExp('id="' + SCREEN_MODE_BUTTON_ID + '"', "g")) || [];
    expect(occurrences, "un seul noeud : aucune copie dans le document").toHaveLength(1);
    const bandeau = html.indexOf('id="project-selector"');
    const mode = html.indexOf('id="' + SCREEN_MODE_BUTTON_ID + '"');
    const nom = html.indexOf('id="btn-project-name"');
    expect(bandeau, "bandeau du nom de projet introuvable").toBeGreaterThanOrEqual(0);
    expect(mode, "le logo-bouton est dans le bandeau").toBeGreaterThan(bandeau);
    expect(nom, "le nom du projet suit le logo").toBeGreaterThan(mode);
    // Et PAS dans la rangee d'onglets : l'ancien emplacement ne revient pas.
    const rangee = html.indexOf('id="tab-row"');
    const contenu = html.indexOf('id="main-content"');
    expect(rangee).toBeGreaterThanOrEqual(0);
    expect(contenu).toBeGreaterThan(rangee);
    expect(html.slice(rangee, contenu)).not.toContain('id="' + SCREEN_MODE_BUTTON_ID + '"');
    // Plus aucun bouton dedie : ni dans le document, ni dans le code.
    expect(html).not.toContain('id="screen-mode-button"');
    expect(superAgent).not.toContain("screen-mode-button");
  });

  it("le bouton n'est jamais cree par du code : il est DEPLACE", () => {
    expect(superAgent).not.toMatch(/id\s*=\s*["']screen-mode-button["']/);
    expect(superAgent).not.toMatch(/id\s*=\s*["']mode-logo["']/);
    expect(superAgent).toContain("getElementById(SCREEN_MODE_BUTTON_ID)");
    // Deplacement puis restitution : les deux sens existent, et le noeud entre
    // dans l'OVERLAY (il n'est plus insere dans la barre, qui ne le porte plus).
    expect(superAgent).toContain("immersiveOverlay.appendChild(screenModeButton)");
    expect(superAgent, "l'ancienne ancre de la barre est revenue").not.toContain(
      "insertBefore(screenModeButton, agentsHost)",
    );
    expect(superAgent).toContain("immersiveModeButtonHome");
    expect(superAgent).toContain("vocalModeButtonHome");
  });

  it("le logo porte la trace du mode et l'infobulle du mode suivant", () => {
    // Etat au repos du document = mode « Detaille » (reecrit au demarrage).
    const balise = sliceSource(html, 'id="mode-logo"', "</button>", 200);
    expect(balise).toContain('data-screen-mode="detailed"');
    // L'infobulle continue de dire le mode COURANT puis le mode SUIVANT : c'est
    // la seule chose qui reste visible pour l'utilisateur (le bouton est muet).
    expect(balise).toContain("Mode d'écran : Détaillé");
    expect(balise).toContain("aria-label=");
    // Le dessin du logo est inchange et reste DANS le bouton.
    expect(balise).toContain('id="btn-project-logo"');
    expect(balise).toContain("logo_pilot_vector.svg");
    // Ni mot, ni pastille : les deux ont disparu (decision Q2 = A).
    expect(balise, "un libelle de mode est revenu").not.toContain(">Détaillé</span>");
    expect(balise).not.toContain("screen-mode-dot");
    expect(balise).not.toContain("screen-mode-label");
  });

  it("a la sortie du plein ecran, CHAQUE noeud est restitue chez son parent memorise", () => {
    // Adaptation L4 (document de conception §4.3) : l'ordre MODE avant
    // « Travail » n'a plus d'objet — le logo ne retourne pas dans la rangee
    // d'onglets mais dans le BANDEAU, chez le parent memorise a l'entree. Ce qui
    // reste a verifier, et qui est verifie : les deux noeuds deplaces rentrent
    // chez eux, AVANT le retrait de l'overlay (sinon ils disparaitraient avec).
    const sortie = sliceSource(
      superAgent,
      "function exitImmersive() {",
      "// Ajustements A19 : si l'assistant réfléchissait encore",
      400,
    );
    const iMode = sortie.indexOf("modeHome.parent.insertBefore(modeButton, next)");
    const iTravail = sortie.indexOf("home.parent.insertBefore(activity, next)");
    expect(iMode, "le logo doit etre restitue").toBeGreaterThanOrEqual(0);
    expect(iTravail, "l'entree « Travail » doit etre restituee").toBeGreaterThanOrEqual(0);
    const sortieOverlay = sortie.indexOf("immersiveOverlay.remove()");
    expect(sortieOverlay, "le retrait de l'overlay doit suivre les restitutions").toBeGreaterThan(
      iMode,
    );
    expect(sortieOverlay).toBeGreaterThan(iTravail);
    // Le parent memorise est celui du BANDEAU : jamais la rangee d'onglets.
    expect(sortie).not.toContain("tabRow.insertBefore(modeButton");
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

describe("4. apparence du logo-bouton : un carre de 28 px, muet (§1.2)", () => {
  it("28 x 28 px, marges calculees, rayon du projet, curseur main", () => {
    // Adaptation L4 (§4.3) : le bouton n'est plus un mot de 88 px mais le carre
    // qui entoure le dessin du logo (28 px, marges negatrices qui rendent au nom
    // du projet sa place exacte). Ce qui doit continuer a etre verifie : une
    // taille UNIQUE et ferme, les jetons du projet, et un curseur de bouton.
    const bouton = bloc("#mode-logo");
    expect(bouton).toMatch(/height:\s*28px/);
    expect(bouton).toMatch(/width:\s*28px/);
    expect(bouton).toMatch(/margin-left:\s*-3px/);
    expect(bouton).toMatch(/margin-right:\s*-4px/);
    expect(bouton).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(bouton).toMatch(/cursor:\s*pointer/);
    // Le logo ne parle plus : plus de largeur de 88 px, plus de jeton de texte.
    expect(bouton).not.toMatch(/width:\s*88px/);
    expect(bouton).not.toMatch(/font-size:/);
    expect(bouton).not.toMatch(/color:\s*var\(--text-secondary\)/);
    // En mode « Detaille », la place est celle du FLUX : aucune regle absolue.
    expect(bouton).not.toMatch(/position:/);
  });

  it("dans les DEUX pleins ecrans, la meme place absolue (13, 8)", () => {
    // Adaptation L4 (§4.3) : l'ancien test verifiait « largeur auto dans le plein
    // ecran ». Le logo, lui, garde sa taille partout ; ce qui doit etre verifie
    // est qu'il ne bouge PAS d'un plein ecran a l'autre : une seule regle, deux
    // selecteurs, une seule place.
    const pleins = blocPleinsEcrans();
    expect(pleins).toMatch(/position:\s*absolute/);
    expect(pleins).toMatch(/top:\s*8px/);
    expect(pleins).toMatch(/left:\s*13px/);
    expect(pleins).toMatch(/margin:\s*0/);
    expect(pleins).toMatch(/z-index:\s*2/);
    // Aucune largeur imposee : le carre de 28 px ne change pas de taille.
    expect(pleins).not.toMatch(/width:/);
  });

  it("la pastille et le mot du mode ont disparu partout", () => {
    // Adaptation L4 (§4.3) : l'ancien test verifiait la TEINTE de la pastille.
    // La pastille n'existe plus (decision Q2 = A) : ce qui doit continuer a etre
    // verifie, c'est son absence complete — CSS, rendu, balisage.
    expect(css).not.toContain(".screen-mode-dot");
    expect(css).not.toContain("#screen-mode-button");
    expect(css).not.toContain(".screen-mode-label");
    expect(superAgent).not.toContain("screen-mode-dot");
    expect(superAgent).not.toContain("screen-mode-label");
    expect(html).not.toContain("screen-mode-dot");
  });
});
