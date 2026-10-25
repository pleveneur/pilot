/**
 * Verrou — LE RETRAIT DE L'ECRAN « ❓ AIDE » (spec_help.md §9).
 *
 * Decision du proprietaire : le point d'entree « Aide » disparait de l'ecran,
 * puisque l'Assistant sait desormais repondre sur la documentation de Pilot
 * (outil `answer_from_documentation`, lot precedent : `spec_help.md` §4.5).
 * L'ordre etait : l'outil d'abord, le retrait ensuite.
 *
 * Ce fichier echoue si :
 *   (a) le bouton « Aide » revient dans le haut de la colonne de gauche (le
 *       haut doit garder exactement DEUX boutons nommes : Brouillon, Reglages) ;
 *   (b) un cablage vers l'onglet Aide revient dans `main.js` ;
 *   (c) le mode d'onglet `help` revient dans `tabs.js` (branche d'ouverture,
 *       methode `_openHelp`, nettoyage, table des modes speciaux) ;
 *   (d) le module d'ecran `src/js/help.js` reapparait sans etre branche ;
 *   (e) les styles partages `.help-*` sont supprimes alors que la Revue de code
 *       et l'Historique des sessions s'en servent encore ;
 *   (f) le socle documentaire ou son outil est retire par megarde
 *       (`ask_help_doc`, extension `pilot-assistant-doc.ts`).
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const tabsJs = lire("src/js/tabs.js");
const css = lire("src/css/style.css");
const reviewJs = lire("src/js/review.js");
const historyJs = lire("src/js/session-history.js");

describe("Retrait de l'ecran Aide (a) — plus aucune porte dans la colonne", () => {
  it("le bouton #btn-help n'existe plus dans index.html", () => {
    expect(html).not.toContain('id="btn-help"');
    // Le libelle seul peut rester dans un commentaire ; c'est l'element qui
    // compte : aucun <button> ne doit porter « Aide » dans #global-actions.
    const blocActions = html.match(
      /<div id="global-actions">([\s\S]*?)\n    <\/div>/,
    );
    expect(blocActions, "conteneur #global-actions introuvable").not.toBeNull();
    expect(blocActions[1]).not.toMatch(/>\s*Aide\s*</);
  });

  it("le haut de la colonne garde exactement deux boutons nommes", () => {
    const blocActions = html.match(
      /<div id="global-actions">([\s\S]*?)\n    <\/div>/,
    );
    const boutons = blocActions[1].match(/<button /g) || [];
    // S'il revient, ce compte passe a 3 et ce test rougit.
    expect(boutons).toHaveLength(2);
    expect(blocActions[1]).toContain("Brouillon");
    expect(blocActions[1]).toContain("Options");
  });

  it("aucune place vide n'est reservee a la place du bouton retire", () => {
    // La rangee est en flex-wrap : elle se resserre, aucune largeur fixe n'est
    // posee sur un troisieme emplacement.
    const regle = (css.match(/(?:^|\n)#global-actions \{([^}]*)\}/) || [])[1] || "";
    expect(regle.replace(/\s+/g, " ")).toContain("flex-wrap: wrap");
    expect(regle).not.toMatch(/min-height:\s*\d+px/);
  });
});

describe("Retrait de l'ecran Aide (b) — plus de cablage dans main.js", () => {
  it("plus aucune reference au bouton ni a l'ouverture de l'aide", () => {
    expect(mainJs).not.toContain('"btn-help"');
    expect(mainJs).not.toContain("btn-help");
    expect(mainJs).not.toMatch(/openFile\(\s*["']Aide["']\s*,\s*["']help["']/);
  });

  it("les autres portes du haut restent cablees (aucune regression)", () => {
    expect(mainJs).toContain('document.getElementById("btn-scratchpad")');
    expect(mainJs).toContain('document.getElementById("btn-settings")');
  });
});

describe("Retrait de l'ecran Aide (c) — plus de mode d'onglet `help`", () => {
  it("tabs.js ne connait plus le mode `help`", () => {
    expect(tabsJs).not.toContain("_openHelp");
    expect(tabsJs).not.toContain("unlistenHelp");
    expect(tabsJs).not.toContain('createHelp');
    expect(tabsJs).not.toMatch(/mode === "help"/);
    expect(tabsJs).not.toMatch(/["']help["']\s*,\s*["']review["']/);
    expect(tabsJs).not.toMatch(/["']help["'],\s*["']review["']/);
    expect(tabsJs).not.toContain('["help"');
  });

  it("les autres onglets transverses sont intacts", () => {
    for (const mode of ["review", "history", "feedback", "settings", "dashboard"]) {
      expect(tabsJs, `mode d'onglet perdu : ${mode}`).toContain(`"${mode}"`);
    }
    // La classe partagee `.help-wrapper` du conteneur de la Revue reste : c'est
    // l'enveloppe commune des ecrans de chat, pas l'onglet Aide.
    expect(tabsJs).toContain("review-wrapper help-wrapper");
  });
});

describe("Retrait de l'ecran Aide (d) — le module d'ecran a disparu", () => {
  it("src/js/help.js n'existe plus", () => {
    expect(existsSync(resolve(ROOT, "src/js/help.js"))).toBe(false);
  });
});

describe("Retrait de l'ecran Aide (e) — les styles partages sont conserves", () => {
  const CLASSES = [
    ".help-chat",
    ".help-header",
    ".help-title",
    ".help-subtitle",
    ".help-msg",
    ".help-msg-body",
    ".help-input-area",
    ".help-input",
    ".help-send",
    ".help-title-row",
  ];

  it("aucune classe partagee n'a ete supprimee du CSS", () => {
    for (const c of CLASSES) {
      expect(css, `classe de style perdue : ${c}`).toContain(c);
    }
  });

  it("elles servent encore a la Revue de code et a l'Historique des sessions", () => {
    expect(reviewJs).toContain("help-chat review-chat");
    expect(reviewJs).toContain("help-title-row");
    expect(historyJs).toContain("help-chat history-chat");
  });
});

describe("Retrait de l'ecran Aide (f) — le socle documentaire reste en place", () => {
  it("la commande du socle et son emballage sont toujours enregistres", () => {
    const lib = lire("src-tauri/src/lib.rs");
    expect(lib).toContain("help::ask_help_doc");
    // `ask_help` reste enregistre : il n'a plus d'appelant dans l'ecran, mais
    // c'est une commande du socle (signale au proprietaire, pas supprimee).
    expect(lib).toContain("help::ask_help");
    // Le reglage du modele d'aide reste : c'est aussi le repli de la Revue.
    expect(lib).toContain("fn set_help_model");
  });

  it("l'outil de l'Assistant et son relais sont intacts", () => {
    expect(existsSync(resolve(ROOT, "src-tauri/extensions/pilot-assistant-doc.ts"))).toBe(
      true,
    );
    const agentService = lire("src-tauri/src/agent_service.rs");
    const declarations =
      agentService.match(/include_str!\("\.\.\/extensions\/pilot-assistant-doc\.ts"\)/g) || [];
    expect(declarations.length, "extension declaree dans une seule liste").toBe(2);
    expect(lire("src/js/super-agent.js")).toContain("ask_help_doc");
  });
});
