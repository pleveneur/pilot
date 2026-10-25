// Tests — lot A « Reglages en onglet » (docs/proposition-reglages-en-onglet.md § 7).
//
// Le lot A ne change AUCUN comportement visible : la fenetre des Reglages
// s'ouvre exactement comme avant. Ces tests tiennent donc les invariants qui
// rendront la bascule (lot B) sure :
//   1. le remplissage des champs n'existe qu'a UN endroit (le lot B le reutilise,
//      il ne le recopie pas) ;
//   2. l'apercu de theme est lie UNE seule fois (aucun ecouteur empile par
//      ouverture) ;
//   3. la fenetre s'ouvre encore, apres un remplissage complet (lot A) ;
//   4. l'onglet `settings` est declare TRANSVERSE (il survivra a une bascule de
//      projet) ;
//   5. le style de l'onglet est porte par l'IDENTIFIANT seul : aucune regle
//      partagee entre modales ne peut changer de sens.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { shouldCloseTab } from "./tab-scoping.js";
import { sliceSource } from "./source-slice.js";

const ROOT = path.resolve(process.cwd());

/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Nombre d'occurrences d'une ancre (verrou des tests de source). */
function countOf(source, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * Corps d'une fonction : de son accolade ouvrante a la fermeture appariee.
 * Sert a verifier ce qui est DANS le remplissage et ce qui n'y est plus.
 */
function bodyOf(source, marker) {
  const at = source.indexOf(marker);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

const settings = readSource("src/js/settings.js");

describe("lot A — un seul remplissage des champs (aucune duplication)", () => {
  it("le remplissage est extrait UNE fois et appele UNE fois", () => {
    expect(countOf(settings, "async function fillSettingsFromConfig(config)")).toBe(1);
    expect(countOf(settings, "await fillSettingsFromConfig(config);")).toBe(1);
    // Le remplissage RECOIT la configuration : il n'en lit jamais une seconde
    // (une seule lecture, celle de l'ouverture, avec son garde-fou R-B).
    const body = bodyOf(settings, "async function fillSettingsFromConfig(config)");
    expect(body).not.toContain('invoke("get_config")');
  });

  it("le remplissage est COMPLET (il va jusqu'aux sous-themes)", () => {
    const body = bodyOf(settings, "async function fillSettingsFromConfig(config)");
    expect(body).toContain("currentConfig = config;");
    // Le premier et le dernier remplissage du formulaire sont dans le meme corps :
    // un demenagement partiel laisserait l'un des deux dehors.
    expect(body).toContain('selectTheme.value = currentConfig.theme || "dark";');
    expect(body).toContain("populateSubthemeSelect(selectSubtheme, savedTheme, savedSubtheme);");
  });
});

describe("lot A — l'apercu de theme ne s'empile plus", () => {
  it("les deux ecouteurs de theme sont lies UNE seule fois, hors du remplissage", () => {
    expect(countOf(settings, 'selectTheme.addEventListener("change"')).toBe(1);
    expect(countOf(settings, 'selectSubtheme.addEventListener("change"')).toBe(1);
    const body = bodyOf(settings, "async function fillSettingsFromConfig(config)");
    // Lies a l'ouverture, ils s'ajoutaient encore a chaque ouverture (piege 2).
    expect(body).not.toContain("selectTheme.addEventListener");
    expect(body).not.toContain("selectSubtheme.addEventListener");
  });
});

describe("lot A — la fenetre des Reglages s'ouvre comme avant", () => {
  it("ouvrir remplit d'abord, puis affiche la fenetre", () => {
    expect(settings).toContain(
      "await fillSettingsFromConfig(config);\n    modal.classList.remove(\"hidden\");\n    animateModalOpen(modal, clickX, clickY);"
    );
  });

  it("un echec de lecture n'ouvre rien et ne remplit rien (reserve R-B intacte)", () => {
    // Decoupage PROTEGE : les deux ancres doivent exister (source-slice.js).
    const open = sliceSource(
      settings,
      'btnSettings.addEventListener("click"',
      "await fillSettingsFromConfig(config);",
      100,
    );
    expect(open).toContain("return;");
    expect(open).toContain("alert(");
  });
});

describe("lot A — le mode d'onglet « settings » est declare transverse", () => {
  it("une bascule de projet ne ferme pas l'onglet des Reglages", () => {
    expect(shouldCloseTab({ mode: "settings" }, false)).toBe(false);
    expect(shouldCloseTab({ mode: "settings" }, true)).toBe(false);
    // Les onglets lies a un fichier restent fermes : rien n'est relache.
    expect(shouldCloseTab({ mode: "edit", path: "a.md" }, false)).toBe(true);
  });

  it("le mode porte la couleur des ecrans transverses, et aucune icone propre", () => {
    const tabs = readSource("src/js/tabs.js");
    expect(tabs).toContain('"gds-admin", "gds-params", "settings"].includes(tab.mode)');
  });
});

describe("lot A — le style de l'onglet ne touche que les Reglages", () => {
  const css = readSource("src/css/style.css");

  it("le conteneur d'onglet et le noeud neutralise sont prevus", () => {
    expect(css).toContain(".editor-wrapper.settings-wrapper { overflow: hidden; }");
    expect(css).toContain("#settings-modal.modal-in-tab {");
    expect(css).toContain("#settings-modal.modal-in-tab > .modal-content.settings-content {");
  });

  it("aucune regle partagee n'est reecrite (les autres modales sont intactes)", () => {
    // `modal-in-tab` n'apparait que derriere l'identifiant : jamais sur `.modal`.
    expect(countOf(css, "modal-in-tab")).toBe(2);
    expect(css).not.toContain(".modal.modal-in-tab");
    // La fenetre reste une fenetre tant que le lot B n'a pas deplace le noeud.
    expect(css).toContain(".modal {\n  position: fixed;");
  });
});
