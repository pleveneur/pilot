// libelle-moteur-options.test.js — VERROU : le libelle du moteur affiche dans
// les Options est le VRAI moteur, pas un texte fige.
//
// Contexte : le bandeau du haut affichait deja « Moteur · Agent Pi » ou
// « Moteur · Agent PLh » selon le moteur reellement utilise (source unique :
// `agentDisplayLabel()` de `src/js/backend-info.js`). L'onglet des Options,
// lui, restait fige sur « Agent Pi » : un utilisateur de PLh y lisait un
// mensonge, et les marches a suivre de la prise en main l'y renvoyaient sous le
// meme nom faux.
//
// Ce fichier echoue si :
//   (a) le libelle de l'onglet des Options redevient un texte ecrit en dur dans
//       `index.html` (au lieu de vivre dans `#settings-tab-agent-label`) ;
//   (b) `main.js` cesse de rafraichir ce libelle depuis la source unique, dans
//       la fonction deja branchee sur `pilot-backend-changed` (donc il ne
//       suivrait plus une re-sonde pi <-> plh) ;
//   (c) les marches a suivre de la prise en main renvoient vers un onglet
//       nomme en dur « Agent Pi » (meme mensonge pour un utilisateur de PLh) ;
//   (d) le repli disparait : sans libelle fourni, la marche a suivre doit
//       rester lisible (defaut « Agent Pi », qui est le defaut de la source).
//
// Aucun navigateur n'est requis : lecture des sources (fins de ligne
// normalisees, cf. quality-gate 3.4) + fonction pure.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onboardingEngineReport } from "./onboarding.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const onboardingJs = lire("src/js/onboarding.js");

/** Le bloc du bouton d'onglet des Options (du marqueur jusqu'a sa fermeture). */
function boutonOngletAgent(source) {
  const debut = source.indexOf('data-settings-tab="agent"');
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf("</button>", debut);
  expect(fin).toBeGreaterThan(debut);
  // On remonte au debut de la balise ouvrante pour voir tout le contenu.
  const ouverture = source.lastIndexOf("<button", debut);
  return source.slice(ouverture, fin + "</button>".length);
}

describe("Options — le libelle de l'onglet nomme le moteur en cours", () => {
  it("le libelle vit dans un element dedie (donc il peut changer)", () => {
    const bouton = boutonOngletAgent(html);
    expect(bouton).toContain('id="settings-tab-agent-label"');
    // Le bouton garde son identifiant de contenu et son icone.
    expect(bouton).toContain('data-settings-tab="agent"');
    expect(bouton).toContain('data-lucide="bot"');
    // Le texte n'est PAS nu dans le bouton : il est dans le <span>.
    const sansSpan = bouton.replace(
      /<span id="settings-tab-agent-label">[^<]*<\/span>/,
      "",
    );
    expect(sansSpan).not.toContain("Agent Pi");
  });

  it("main.js le rafraichit depuis la source UNIQUE, sur re-sonde du backend", () => {
    const debut = mainJs.indexOf("const syncEngineSubtitle = () => {");
    expect(debut).toBeGreaterThan(-1);
    const branchement = mainJs.indexOf(
      'window.addEventListener("pilot-backend-changed", syncEngineSubtitle)',
      debut,
    );
    expect(branchement).toBeGreaterThan(debut);
    const corps = mainJs.slice(debut, branchement);
    // Meme source unique que le sous-titre du bandeau.
    expect(corps).toContain('document.getElementById("project-engine")');
    expect(corps).toContain('document.getElementById("settings-tab-agent-label")');
    expect(corps).toContain("agentDisplayLabel()");
  });
});

describe("Prise en main — la marche a suivre nomme le VRAI onglet", () => {
  it("aucun « Agent Pi » ecrit en dur dans les marches a suivre", () => {
    // On ignore les commentaires : seules les CHAINES affichees comptent. Le
    // seul « Agent Pi » tolere dans le code est le REPLI de la source (defaut
    // de `agentDisplayLabel()` avant la premiere sonde).
    const code = onboardingJs
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const occurrences = code.split("Agent Pi").length - 1;
    expect(occurrences).toBe(1);
  });

  it("la marche a suivre suit le libelle fourni (utilisateur de PLh)", () => {
    for (const error of ["no_path", "not_executable", "probe_failed", "autre"]) {
      const report = onboardingEngineReport({
        label: "L'agent PLh",
        optionsLabel: "Agent PLh",
        health: { ok: false, error, path: "C:/plh" },
      });
      const texte = report.lines.join(" ");
      expect(texte).toContain("Options");
      expect(texte).toContain("Agent PLh");
      expect(texte).not.toContain("Agent Pi");
    }
  });

  it("sans libelle fourni, la marche a suivre reste lisible (repli)", () => {
    const report = onboardingEngineReport({ health: { ok: false, error: "no_path" } });
    expect(report.lines.join(" ")).toContain("Agent Pi");
    expect(report.lines.join(" ")).toContain("Options");
    expect(onboardingEngineReport({}).lines.length).toBeGreaterThan(0);
  });
});
