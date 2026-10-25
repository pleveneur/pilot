// Tests — LOT 4 de la presentation : bande de contexte + entree « Travail ».
//
// Reference : docs/proposition-presentation-ui.md §3.4 (structure de la zone de
// travail) et §6 lot 4. Ce que ce fichier verrouille :
//   (a) la bande de contexte fait 26 px, vit DANS #main-area, s'empile SOUS la
//       bande de fenetre et AVANT la barre d'onglets ;
//   (b) le fil d'Ariane affiche « Projet > <projet> > <onglet> » : nom de projet
//       deduit du chemin (Windows ou POSIX), libelle d'onglet sans icone,
//       troncature par ellipse en fenetre etroite ;
//   (c) l'entree « Travail » est NOMMEE, sans position fixe : plus aucun
//       chevauchement possible avec la barre d'onglets ;
//   (d) `#agent-activity-dot` et `#agent-activity-badge` sont CONSERVES comme
//       CONTENU du bouton (identifiants et attributs d'accessibilite inchanges),
//       avec un SEUL ecouteur de clic (aucun double basculement) ;
//   (e) rien d'autre n'a bouge : ordre des trois onglets du panneau, memoire de
//       l'onglet actif, respiration de la pastille.
//
// Aucun navigateur : fonctions pures + lecture des sources (fins de ligne
// normalisees, cf. quality-gate 3.4) et des découpages PROTÉGÉS (`sliceSource`).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTEXT_BAR_DEFAULT_PROJECT_LABEL,
  CONTEXT_BAR_DEFAULT_TAB_LABEL,
  CONTEXT_BAR_TAB_ICONS,
  contextBarModel,
  projectLabelFromPath,
  tabLabelFromText,
} from "./context-bar.js";
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const html = lire("index.html");
const css = lire("src/css/style.css");
const mainJs = lire("src/js/main.js");
const activityJs = lire("src/js/agent-activity.js");

/** Corps d'une regle CSS (premiere occurrence du selecteur exact). */
const regle = (selecteur) =>
  sliceSource(css, `${selecteur} {`, "}", 40);

// ════════════════════════════════════════════════════════════════════════════
// (a) La bande : 26 px, dans la zone de travail, avant la barre d'onglets
// ════════════════════════════════════════════════════════════════════════════
describe("(a) bande de contexte — placee et dimensionnee", () => {
  it("elle est dans #main-area, apres la bande de fenetre et AVANT les onglets", () => {
    const fenetre = html.indexOf('id="window-bar"');
    const zone = html.indexOf('<main id="main-area">');
    const bande = html.indexOf('<div id="context-bar">');
    const onglets = html.indexOf('<div id="tab-bar">');
    expect(fenetre).toBeGreaterThan(-1);
    expect(zone).toBeGreaterThan(fenetre);
    expect(bande).toBeGreaterThan(zone);
    expect(onglets).toBeGreaterThan(bande);
  });

  it("elle fait 26 px de haut, filet bas inclus, dans le flux (jamais fixe)", () => {
    const corps = regle("#context-bar");
    expect(corps).toMatch(/height:\s*26px/);
    expect(corps).toMatch(/border-bottom:\s*1px solid var\(--border-subtle\)/);
    expect(corps).toMatch(/flex:\s*0 0 auto/);
    expect(corps).not.toMatch(/position:\s*fixed/);
    expect(corps).not.toMatch(/position:\s*absolute/);
  });

  it("rien n'est en position fixe dans le suivi du travail (plus de recouvrement)", () => {
    const conteneur = regle("#agent-activity");
    expect(conteneur).toMatch(/position:\s*relative/);
    expect(conteneur).not.toMatch(/position:\s*fixed/);
    expect(conteneur).not.toMatch(/top:\s*calc\(var\(--window-bar-height\)/);
    // Les reglages de dimensions du panneau sont INTACTS (lot 5, non touche).
    expect(conteneur).toMatch(/--agent-activity-panel-min-width:\s*320px/);
    expect(conteneur).toMatch(/--agent-activity-panel-max-width:\s*360px/);
  });

  it("l'entree « Travail » a une hauteur qui tient dans la bande", () => {
    const entree = regle("#agent-activity-entry");
    expect(entree).toMatch(/height:\s*22px/);
    expect(entree).toMatch(/display:\s*flex/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) Le fil d'Ariane
// ════════════════════════════════════════════════════════════════════════════
describe("(b) fil « Projet > projet > onglet »", () => {
  it("les trois segments et leurs deux separateurs sont dans la bande", () => {
    const fil = sliceSource(html, '<nav id="context-breadcrumb"', "</nav>", 80);
    expect(fil).toContain('id="context-breadcrumb-project"');
    expect(fil).toContain('id="context-breadcrumb-name"');
    expect(fil).toContain('id="context-breadcrumb-tab"');
    expect((fil.match(/class="context-breadcrumb-sep"/g) || []).length).toBe(2);
    // Le 1er segment est un BOUTON (il ouvre le menu « Projets »).
    expect(fil).toContain("<button");
    expect(fil).toContain('aria-haspopup="true"');
  });

  it("le nom du projet vient du chemin, quel que soit le separateur", () => {
    expect(projectLabelFromPath("G:\\IA_PL\\pilot")).toBe("pilot");
    expect(projectLabelFromPath("/home/patrick/pilot/")).toBe("pilot");
    expect(projectLabelFromPath("G:/IA_PL/Pilot")).toBe("Pilot");
    expect(projectLabelFromPath("")).toBe(CONTEXT_BAR_DEFAULT_PROJECT_LABEL);
    expect(projectLabelFromPath(null)).toBe(CONTEXT_BAR_DEFAULT_PROJECT_LABEL);
    expect(projectLabelFromPath("   ")).toBe(CONTEXT_BAR_DEFAULT_PROJECT_LABEL);
  });

  it("le libelle d'onglet perd son icone et normalise ses espaces", () => {
    expect(tabLabelFromText("👁️ README.md (aperçu)")).toBe("README.md (aperçu)");
    expect(tabLabelFromText("π  mon-agent   (RPC)")).toBe("mon-agent (RPC)");
    expect(tabLabelFromText("🖥️ Terminal")).toBe("Terminal");
    expect(tabLabelFromText("README.md")).toBe("README.md");
    expect(tabLabelFromText("")).toBe(CONTEXT_BAR_DEFAULT_TAB_LABEL);
    expect(tabLabelFromText("   ")).toBe(CONTEXT_BAR_DEFAULT_TAB_LABEL);
    expect(tabLabelFromText(null)).toBe(CONTEXT_BAR_DEFAULT_TAB_LABEL);
  });

  it("aucun prefixe d'icone de tabs.js n'est oublie (source unique)", () => {
    // Les prefixes viennent de `_renderTabButton` : s'ils changent la-bas, la
    // liste de ce module doit changer aussi (sinon le fil affiche l'icone).
    const rendu = sliceSource(
      lire("src/js/tabs.js"),
      'const icon = tab.mode === "preview" ? "👁️ " : tab.mode === "pdf" ? "📕 " : tab.mode === "image"',
      "const suffix =",
      150
    );
    for (const icone of CONTEXT_BAR_TAB_ICONS) {
      expect(rendu, `« ${icone} » absent de tabs.js`).toContain(icone);
    }
  });

  it("le modele assemble projet + onglet sans jamais lever", () => {
    expect(contextBarModel({ projectPath: "G:\\IA_PL\\pilot", activeTabText: "👁️ spec_pilot.md" }))
      .toEqual({ project: "pilot", tab: "spec_pilot.md" });
    expect(contextBarModel({})).toEqual({
      project: CONTEXT_BAR_DEFAULT_PROJECT_LABEL,
      tab: CONTEXT_BAR_DEFAULT_TAB_LABEL,
    });
    expect(contextBarModel(null)).toEqual({
      project: CONTEXT_BAR_DEFAULT_PROJECT_LABEL,
      tab: CONTEXT_BAR_DEFAULT_TAB_LABEL,
    });
  });

  it("le nom du projet est tronque par ellipse (jamais la bande qui s'elargit)", () => {
    const noms = sliceSource(
      css,
      "#context-breadcrumb-name,\n#context-breadcrumb-tab {",
      "}",
      60
    );
    expect(noms).toMatch(/text-overflow:\s*ellipsis/);
    expect(noms).toMatch(/overflow:\s*hidden/);
    expect(noms).toMatch(/white-space:\s*nowrap/);
    expect(noms).toMatch(/min-width:\s*0/);
    expect(regle("#context-breadcrumb-name")).toMatch(/max-width:\s*\d+px/);
    const fil = regle("#context-breadcrumb");
    expect(fil).toMatch(/min-width:\s*0/);
    expect(fil).toMatch(/overflow:\s*hidden/);
  });

  it("en fenetre etroite, le fil garde « Projet > onglet »", () => {
    const etroit = css.match(/@media \(max-width: 999px\) \{[\s\S]*?\n\}/);
    expect(etroit, "media query etroite de la bande introuvable").toBeTruthy();
    expect(etroit[0]).toMatch(/#context-breadcrumb-name\s*\{|#context-breadcrumb-name,/);
    expect(etroit[0]).toMatch(/display:\s*none/);
  });

  it("le dernier segment est le seul en evidence (11 px, 600, texte primaire)", () => {
    // Regle SPECIFIQUE du dernier segment (la regle groupee avec le nom du
    // projet ne porte que la troncature, jamais la mise en evidence).
    const onglet = css.match(/#context-breadcrumb-tab \{\s*max-width:[\s\S]*?\}/);
    expect(onglet, "regle specifique du dernier segment introuvable").toBeTruthy();
    expect(onglet[0]).toMatch(/font-weight:\s*600/);
    expect(onglet[0]).toMatch(/color:\s*var\(--text-primary\)/);
    const fil = regle("#context-breadcrumb");
    expect(fil).toMatch(/font-size:\s*var\(--font-xs\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (c) L'entree « Travail » : nommee, dans la bande
// ════════════════════════════════════════════════════════════════════════════
describe("(c) entree « Travail » — nommee et sans chevauchement", () => {
  it("elle porte un libelle en mot, pas seulement un cercle", () => {
    const entree = sliceSource(
      html,
      '<div id="agent-activity">',
      'id="agent-activity-dropdown"',
      120
    );
    expect(entree).toContain('id="agent-activity-entry"');
    expect(entree).toContain("agent-activity-entry-label");
    expect(entree).toContain("Travail");
    const bouton = sliceSource(html, '<button type="button" id="agent-activity-entry"', "</button>", 60);
    expect(bouton).toContain('aria-label="Suivi du travail"');
    expect(bouton).toContain('aria-haspopup="true"');
    expect(bouton).toContain('aria-expanded="false"');
  });

  it("elle est placee DANS la bande de contexte, a droite du fil", () => {
    const bande = sliceSource(html, '<div id="context-bar">', '<div id="tab-bar">', 200);
    const fil = bande.indexOf('id="context-breadcrumb"');
    const entree = bande.indexOf('id="agent-activity"');
    expect(fil).toBeGreaterThan(-1);
    expect(entree).toBeGreaterThan(fil);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (d) Identifiants conserves comme CONTENU du bouton + un seul clic
// ════════════════════════════════════════════════════════════════════════════
describe("(d) #agent-activity-dot et #agent-activity-badge conserves", () => {
  it("les deux identifiants existent une seule fois, dans le bouton", () => {
    expect((html.match(/id="agent-activity-dot"/g) || []).length).toBe(1);
    expect((html.match(/id="agent-activity-badge"/g) || []).length).toBe(1);
    const bouton = sliceSource(html, 'id="agent-activity-entry"', "</button>", 60);
    expect(bouton).toContain('id="agent-activity-dot"');
    expect(bouton).toContain('id="agent-activity-badge"');
    // Attributs d'accessibilite de la pastille : inchanges.
    expect(bouton).toContain('id="agent-activity-dot" title="Suivi du travail"');
    expect(bouton).toContain('aria-expanded="false"');
  });

  it("un SEUL ecouteur de clic : aucun double basculement", () => {
    const branchement = sliceSource(
      activityJs,
      'const entry = document.getElementById("agent-activity-entry")',
      "toggleAgentPanel();",
      80
    );
    expect(branchement).toContain("const trigger = entry || dot;");
    expect((branchement.match(/addEventListener\("click"/g) || []).length).toBe(1);
    // La pastille n'est plus un bouton : aucun ecouteur de clic propre.
    expect(activityJs).not.toContain('dot.addEventListener("click"');
  });

  it("l'etat ouvert/ferme est publie sur le bouton ET sur la pastille", () => {
    expect(activityJs).toContain('for (const id of ["agent-activity-entry", "agent-activity-dot"])');
    expect(activityJs).toMatch(/setActivityExpanded\(true\)/);
    expect(activityJs).toMatch(/setActivityExpanded\(false\)/);
  });

  it("la respiration de la pastille est intacte (couleur, opacite, animation)", () => {
    const dot = regle("#agent-activity-dot");
    expect(dot).toMatch(/opacity:\s*0\.6/);
    const respiration = sliceSource(css, "#agent-activity-dot.breathing {", "}", 40);
    expect(respiration).toMatch(/opacity:\s*1/);
    expect(respiration).toMatch(/background:\s*var\(--superagent-accent\)/);
    expect(respiration).toMatch(/animation:/);
  });

  it("la pastille est un CONTENU, plus un bouton cliquable a part", () => {
    const dot = regle("#agent-activity-dot");
    expect(dot).not.toMatch(/cursor:\s*pointer/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (e) Rien d'autre n'a bouge
// ════════════════════════════════════════════════════════════════════════════
describe("(e) les autres verrous du panneau tiennent toujours", () => {
  it("l'ordre des trois onglets du panneau est inchange", () => {
    const panneau = sliceSource(html, 'id="agent-activity-dropdown"', 'id="agent-activity-card"', 200);
    const agents = panneau.indexOf('data-agent-panel-tab="agents"');
    const tasks = panneau.indexOf('data-agent-panel-tab="tasks"');
    const events = panneau.indexOf('data-agent-panel-tab="events"');
    expect(agents).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(agents);
    expect(events).toBeGreaterThan(tasks);
  });

  it("la memoire de l'onglet actif du panneau est intacte", () => {
    expect(activityJs).toContain("AGENT_PANEL_TAB_KEY");
    expect(activityJs).toContain("localStorage");
  });

  it("la bande est branchee au demarrage", () => {
    expect(mainJs).toMatch(/import \{[^}]*initContextBar[^}]*\} from "\.\/context-bar\.js"/);
    expect(mainJs).toMatch(/initContextBar\(\)/);
  });

  it("l'onglet actif est lu dans la barre d'onglets, sans dupliquer tabs.js", () => {
    const lireBarre = sliceSource(
      lire("src/js/context-bar.js"),
      "export function refreshContextBar",
      'setText(document.getElementById("context-breadcrumb-name")',
      80
    );
    expect(lireBarre).toContain('document.querySelector("#tab-bar .tab.active .tab-name")');
    expect(lireBarre).toContain("window._pilotProjectPath");
  });
});
