// Tests — Reglages en onglet : invariants du lot A
// (docs/proposition-reglages-en-onglet.md § 7), tenus APRES la bascule du lot B.
//
// Le lot B fait des Options un ONGLET (le noeud `#settings-modal` y est
// deplace). Ces tests tiennent les invariants qui rendent la bascule sure :
//   1. le remplissage des champs n'existe qu'a UN endroit (il est reutilise,
//      jamais recopie) ;
//   2. l'apercu de theme est lie UNE seule fois (aucun ecouteur empile par
//      ouverture) ;
//   3. l'ouverture passe par UN SEUL chemin, avec le garde-fou R-B intact ;
//   4. l'onglet `settings` est declare TRANSVERSE (il survit a une bascule de
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

describe("lot B — les Options sont un ONGLET, plus une fenetre", () => {
  it("ouvrir DEPLACE le noeud dans l'onglet, puis remplit les champs", () => {
    // Le noeud n'est pas recopie : il est deplace tel quel dans le conteneur de
    // l'onglet et prend la classe qui neutralise le positionnement de fenetre.
    expect(settings).toContain("container.appendChild(modal);");
    expect(settings).toContain('modal.classList.add("modal-in-tab");');
    expect(settings).toContain("await settingsApi.open(detail);");
    // Le remplissage reste celui du lot A, appele UNE seule fois (ci-dessus).
    expect(countOf(settings, "await fillSettingsFromConfig(config);")).toBe(1);
  });

  it("un echec de lecture n'ouvre rien et ne remplit rien (reserve R-B intacte)", () => {
    // Decoupage PROTEGE : les deux ancres doivent exister (source-slice.js).
    const open = sliceSource(
      settings,
      "async function openSettingsContent(detail) {",
      "await fillSettingsFromConfig(config);",
      100,
    );
    expect(open).toContain("throw e;");
    expect(open).toContain("alert(");
  });
});

describe("lot A — le mode d'onglet « settings » est declare transverse", () => {
  it("une bascule de projet ne ferme pas l'onglet des Options", () => {
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

describe("lot A — le style de l'onglet ne touche que les Options", () => {
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
    // `.modal` reste la fenetre des AUTRES modales : le lot B ne l'a pas touchee.
    expect(css).toContain(".modal {\n  position: fixed;");
  });
});
