// Tests — ISSUE #381 : L'ECRAN VOCAL NE CAPTE PLUS TOUS LES CLICS.
//
// Ce qui s'etait passe (version publiee v0.6.4) : a l'entree dans l'ecran
// Vocal, plus AUCUN clic ne repondait — le logo (qui EST le bouton des trois
// modes), la touche Echap et la croix de l'onglet etaient muets, et il fallait
// tuer le processus. La cause : `.pilot-vocal` est un calque
// `position: fixed; inset: 0; z-index: 99990` qui, sans `pointer-events`,
// capte le clic sur TOUT le viewport et le consomme (il n'a aucun gestionnaire
// a lui : le clic ne va nulle part).
//
// CE QUE CE FICHIER VERROUILLE :
//   1. Le calque ne capte pas le clic (`pointer-events: none` sur
//      `.pilot-vocal`), donc un clic dans le vide retombe sur ce qu'il y a
//      derriere — jamais sur un decor.
//   2. Le clic est rendu a SIX hotes, pas plus : les quatre zones de l'ecran
//      plus les deux noeuds deplaces (`#mode-logo`, `#agent-activity`). La
//      liste est EXHAUSTIVE : tout selecteur qui reclame `pointer-events: auto`
//      ailleurs dans la section fait echouer le test.
//   3. Aucun calque DECORATIF n'est cliquable : le halo, la lueur du disque et
//      son arc gardent `pointer-events: none` (leurs pseudo-elements debordent
//      du disque : sans cela ils voleraient les clics dans la couronne).
//   4. Les TROIS voies de sortie appellent `exitVocal` : le logo (mode applique,
//      `onScreenModeApply`), Echap (`onVocalKeydown`, garde de modale conservee)
//      et la fermeture de l'onglet 🧭.
//   5. La sortie ne depend pas du succes du demontage : `exitVocal` enferme le
//      nettoyage dans un `try`, et le retrait de l'overlay comme la restitution
//      des trois noeuds sont ECRITS APRES le `catch` (donc toujours atteints).
//
// Les commentaires sont en ASCII ; les selecteurs CSS et les extraits de code
// lus sont copies tels quels depuis les fichiers sources.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Decoupage verifie : une ancre absente LEVE au lieu de rendre un fragment vide
// (quality-gate §3.4 : la source est normalisee en LF avant lecture).
import { sliceSource, neutraliserSource } from "./source-slice.js";
import { SCREEN_MODE_BUTTON_ID } from "./screen-mode.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");

// La section « ecran Vocal » de la feuille de style : de l'ouverture du calque
// jusqu'aux images cles (premiere ancre stable apres le dernier bloc de
// l'ecran). Toute lecture de `pointer-events` y est bornee.
const SECTION = sliceSource(CSS, ".pilot-vocal {", "@keyframes vocal-fade-in", 15000);

// Les SIX hotes qui recoivent le clic. Toute autre cible fait echouer le test.
const HOTES = [
  ".vocal-top",
  ".vocal-stage",
  ".vocal-status",
  ".vocal-input",
  "#mode-logo",
  "#agent-activity",
];

/**
 * Toutes les regles de `css` qui declarent `pointer-events: auto`, rendues sous
 * forme de listes de selecteurs. Les commentaires et les chaines sont
 * neutralises d'abord : un selecteur cite dans un commentaire n'est pas une
 * regle.
 */
function reglesQuiCaptentLEntier(css) {
  const texte = neutraliserSource(css);
  const regles = [];
  const rx = /([^{}]+)\{([^{}]*)\}/g;
  let m = rx.exec(texte);
  while (m !== null) {
    if (/pointer-events\s*:\s*auto/.test(m[2])) {
      regles.push(
        m[1]
          .split(",")
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      );
    }
    m = rx.exec(texte);
  }
  return regles;
}

describe("1. le calque plein ecran ne capte pas le clic (cause du #381)", () => {
  const calque = sliceSource(CSS, ".pilot-vocal {", "}", 200);

  it("il couvre bien le viewport (c'est pour cela qu'il avalait tout)", () => {
    expect(calque).toMatch(/position:\s*fixed/);
    expect(calque).toMatch(/inset:\s*0/);
    expect(calque).toMatch(/z-index:\s*99990/);
  });

  it("et il est TRAVERSANT : aucun clic ne s'arrete sur lui", () => {
    expect(calque).toMatch(/pointer-events:\s*none/);
  });
});

describe("2. le clic est rendu a SIX hotes, pas un de plus", () => {
  const regles = reglesQuiCaptentLEntier(SECTION);

  it("la section ne contient qu'une seule regle de reactivation", () => {
    expect(regles.length).toBe(1);
  });

  it("et elle nomme exactement les six hotes de l'ecran", () => {
    const attendus = HOTES.map((h) => `.pilot-vocal ${h}`).sort();
    expect([...regles[0]].sort()).toEqual(attendus);
  });

  it("le bouton des trois modes est bien celui de screen-mode.js", () => {
    // `#mode-logo` est ecrit dans la feuille de style : il doit rester
    // l'identifiant publie par screen-mode.js (source unique du bouton).
    expect(HOTES).toContain(`#${SCREEN_MODE_BUTTON_ID}`);
    expect(regles[0]).toContain(`.pilot-vocal #${SCREEN_MODE_BUTTON_ID}`);
  });
});

describe("3. aucun calque DECORATIF n'est cliquable", () => {
  const DECOR = [".vocal-halo {", ".vocal-orb::before {", ".vocal-orb::after {"];

  for (const selecteur of DECOR) {
    it(`${selecteur.replace(" {", "")} laisse passer le clic`, () => {
      const bloc = sliceSource(CSS, selecteur, "}", 20);
      expect(bloc).toMatch(/pointer-events:\s*none/);
    });
  }

  it("et aucun decor n'apparait dans la regle de reactivation", () => {
    const regles = reglesQuiCaptentLEntier(SECTION);
    const joint = regles.flat().join(" ");
    expect(joint).not.toMatch(/halo|orb|envelope|spectrum|crown|arc/);
  });
});

describe("4. les TROIS voies de sortie appellent exitVocal", () => {
  it("le LOGO : appliquer un autre mode sort de l'ecran", () => {
    const applique = sliceSource(
      SUPER,
      "const onScreenModeApply = (e) => {",
      "window.addEventListener(SCREEN_MODE_APPLY_EVENT, onScreenModeApply);",
      200,
    );
    expect(applique).toMatch(/if \(vocalOverlay\) exitVocal\(\);/);
  });

  it("ECHAP ferme l'ecran, sans voler Echap a une modale ouverte", () => {
    const touche = sliceSource(
      SUPER,
      "const onVocalKeydown = (e) => {",
      'document.addEventListener("keydown", onVocalKeydown);',
      100,
    );
    expect(touche).toMatch(/e\.key !== "Escape"/);
    expect(touche).toContain("exitVocal();");
    // L'ORDRE compte : la modale ouverte garde Echap pour elle.
    const garde = touche.indexOf('.modal:not(.hidden)');
    const sortie = touche.indexOf("exitVocal();");
    expect(garde).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(sortie);
  });

  it("la CROIX de l'onglet Assistant quitte aussi le mode", () => {
    const fermeture = sliceSource(
      SUPER,
      "if (vocalOverlay) {\n        stopReading();",
      "if (immersiveOverlay) exitImmersive();",
      40,
    );
    expect(fermeture).toContain("exitVocal();");
  });
});

describe("5. la sortie ne depend pas du succes du demontage", () => {
  const sortie = sliceSource(
    SUPER,
    "  function exitVocal() {",
    "  function autoReadVocalReply() {",
    2000,
  );

  it("le demontage est enferme dans un try dont le catch ne propage rien", () => {
    const debutTry = sortie.indexOf("try {");
    const debutCatch = sortie.indexOf("} catch (err) {");
    expect(debutTry).toBeGreaterThan(-1);
    expect(debutCatch).toBeGreaterThan(debutTry);
    // Le nettoyage (lecture, micro, dictee) est DANS le try.
    for (const appel of ["stopReading();", "vocalMic.fermer();", "stopVoiceInput();"]) {
      const position = sortie.indexOf(appel);
      expect(position).toBeGreaterThan(debutTry);
      expect(position).toBeLessThan(debutCatch);
    }
  });

  it("le retrait de l'overlay et la restitution des noeuds sont APRES le catch", () => {
    const debutCatch = sortie.indexOf("} catch (err) {");
    const retrait = sortie.indexOf("vocalOverlay.remove();");
    expect(retrait).toBeGreaterThan(debutCatch);
    // Les trois noeuds deplaces sortent de l'overlay avant son retrait, sinon
    // ils seraient detruits avec lui : logo, « Travail » et barre de saisie.
    for (const retour of ['getElementById("agent-activity")', "SCREEN_MODE_BUTTON_ID", "insertBefore(inputBar,"]) {
      const position = sortie.indexOf(retour);
      expect(position).toBeGreaterThan(debutCatch);
      expect(position).toBeLessThan(retrait);
    }
  });
});
