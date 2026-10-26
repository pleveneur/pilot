/**
 * Verrou du LOT 3 de la presentation : LE BAS DE LA COLONNE DE GAUCHE.
 *
 * Document qui fait foi : `docs/proposition-presentation-ui.md` § 3.3 et lot 3
 * du § 6 (etape 5 du doc de navigation), etendu par les trois decisions du
 * proprietaire du 2026-10-25 (Q1, Q2, Q3) PUIS par le Lot A de
 * `RAPPORT-design-colonne-entrees.md` § 4 :
 *   - les TROIS sous-onglets « Projet / Vues / Assistant » disparaissent ;
 *   - les QUATORZE lignes deviennent des lignes de 32 px, toujours visibles,
 *     dans l'ordre fige : Brouillon · Options · Lancer l'agent · Assistant ·
 *     Dossier du projet · Terminal · Commandes du projet · Autres écrans ;
 *   - « Brouillon » (`btn-scratchpad`) et « Options » (`btn-settings`) sont les
 *     DEUX PORTES GLOBALES qui etaient en HAUT de la colonne : memes libelles,
 *     memes infobulles, memes icones, memes identifiants, meme ordre. Elles ne
 *     portent NI `project-only` NI `hidden` : le cadre reste visible SANS
 *     projet ouvert et n'affiche alors que ces deux lignes (reponse A de la
 *     question 3 du rapport) ;
 *   - « Lancer l'agent » reste la ligne mise en evidence (13 px / 600, icone
 *     accent) ; sa sortie vers le menu « Autres écrans » n'est PAS faite ici
 *     (lot C du rapport) ;
 *   - « Dossier du projet » est le bouton `btn-explorer` remonte du menu (Q2),
 *     meme identifiant, meme effet (dossier projet dans l'explorateur) ;
 *   - « Commandes du projet » (`btn-commands`) remonte aussi du menu ;
 *   - « Autres écrans » ouvre un menu VERS LE HAUT (le bloc est en bas de
 *     colonne), groupes nommes, NEUF entrees, fermeture a Echap / clic
 *     exterieur / selection.
 *
 * Hauteur : 2 + 8 x 2 + 8 x 32 + 7 x 6 = 316 px avec les HUIT lignes du Lot A.
 * DETTE CONNUE, mesuree et assumee : le plafond `max-height: 50 %` (250 px a la
 * fenetre minimale de 500 px) n'est PAS ajuste par le Lot A (mission separee
 * pour 60 %). Ce fichier verrouille donc l'etat REEL et rougira lorsque le
 * plafond changera, pour forcer la mise a jour des chiffres.
 *
 * Ce qui ne doit PAS changer : les QUATORZE identifiants et leurs fonctions
 * (`btn-explorer`, `btn-terminal`, `btn-terminal-cmd`, `btn-commands`,
 * `btn-prompt-builder`, `btn-dashboard`, `btn-code-graph`, `btn-review`,
 * `btn-history`, `btn-gds`, `btn-agents`, `btn-superagent`, `btn-superkanban`,
 * `btn-interproject`) et le cadre accent du bloc (le SEUL de l'interface).
 *
 * Ce fichier echoue si :
 *   (a) une rangee de sous-onglets revient, ou `role="tablist"` avec elle ;
 *   (b) une des quatorze entrees perd son identifiant ou son cablage, ou une
 *       des deux portes globales quitte le bloc ;
 *   (c) le bloc ne fait plus HUIT lignes de 32 px, ou l'ordre fige change, ou
 *       une ligne du bloc perd sa hauteur de 32 px / son libelle de 12 px ;
 *   (d) le menu s'ouvre vers le bas (il sortirait de la fenetre) ou ne se ferme
 *       plus a Echap ;
 *   (e) le cadre accent du bloc disparait, ou une couleur en dur y apparait
 *       (thème clair casse).
 *
 * Deux regressions precises sont surveillees en plus : remettre QUATRE lignes
 * dans le panneau (test « le panneau ne contient que HUIT lignes »), renvoyer
 * « Commandes du projet » DANS le menu (tests « les neuf entrees restees » et
 * « Commandes du projet n'est pas dans le menu »), et remettre « Brouillon » ou
 * « Options » en haut de la colonne (`lot2-colonne-haut.test.js`).
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Decoupage de source VERIFIE (garde-fou du 3e audit, point 4) : une ancre
// absente echoue au lieu de rendre une assertion negative vraie par construction.
import { sliceSource, sliceFrom } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const sidebarJs = lire("src/js/sidebar.js");
const interprojectJs = lire("src/js/interproject.js");
const projectCommandsJs = lire("src/js/project-commands.js");

/** HTML du bloc du bas de la colonne (du `#project-footer` a la fin de l'aside). */
const pied = sliceSource(html, 'id="project-footer"', "</aside>", 4000);
/** Le meme bloc SANS ses commentaires : les commentaires citent volontairement
 *  les noms disparus ("plus de rangee d'onglets", `role="tablist"`…), ils ne
 *  doivent donc pas tromper les verifications de structure. */
const piedNu = pied.replace(/<!--[\s\S]*?-->/g, "");

/** Bloc de regle dont le selecteur est ecrit EXACTEMENT `selector {`. */
function blocs(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouves = [];
  let m;
  while ((m = re.exec(source)) !== null) trouves.push(m[1]);
  return trouves;
}

function bloc(source, selector) {
  const trouves = blocs(source, selector);
  expect(trouves.length, `regle CSS absente : ${selector}`).toBeGreaterThan(0);
  return trouves.join("\n");
}

const declarations = (corps) => corps.replace(/\s+/g, " ").toLowerCase();

/** Les QUATORZE entrees du bloc du bas, avec le fichier qui les cable. */
const ENTREES = [
  ["btn-explorer", mainJs],
  ["btn-terminal", mainJs],
  ["btn-terminal-cmd", mainJs],
  ["btn-commands", projectCommandsJs],
  ["btn-prompt-builder", mainJs],
  ["btn-dashboard", mainJs],
  ["btn-code-graph", mainJs],
  ["btn-review", mainJs],
  ["btn-history", mainJs],
  ["btn-gds", mainJs],
  ["btn-agents", mainJs],
  ["btn-superagent", mainJs],
  ["btn-superkanban", mainJs],
  ["btn-interproject", interprojectJs],
];

/** Les HUIT lignes du bloc, dans l'ordre impose par le document, les decisions
 *  Q1/Q2 et le Lot A (les deux portes globales passent en tete, dans l'ordre ou
 *  elles etaient cote a cote en haut : Brouillon puis Options). */
const LIGNES = [
  "btn-scratchpad",
  "btn-settings",
  "btn-terminal-cmd",
  "btn-superagent",
  "btn-explorer",
  "btn-terminal",
  "btn-commands",
  "btn-more-screens",
];

/** Les NEUF entrees qui restent DANS le menu « Autres écrans ». */
const MENU = [
  "btn-prompt-builder",
  "btn-dashboard",
  "btn-code-graph",
  "btn-history",
  "btn-review",
  "btn-agents",
  "btn-superkanban",
  "btn-interproject",
  "btn-gds",
];

describe("LOT 3 (a) — les sous-onglets du bas ont disparu", () => {
  it("plus aucune rangee `pj-tabs` ni aucun `role=\"tablist\"` dans le bloc", () => {
    expect(piedNu).not.toContain("pj-tabs");
    expect(piedNu).not.toMatch(/class="[^"]*pj-tab[ "']/);
    expect(piedNu).not.toContain('role="tablist"');
    expect(piedNu).not.toContain("data-panel");
  });

  it("la bascule des sous-onglets n'est plus appelee (code mort supprime)", () => {
    expect(sidebarJs).not.toMatch(/_initProjectTabs\s*\(\s*\)\s*\{/);
    expect(sidebarJs).not.toContain("this._initProjectTabs()");
    expect(sidebarJs).toContain("this._initProjectFooterMenu();");
  });
});

describe("LOT 3 (b) — les quatorze identifiants et leurs fonctions sont conserves", () => {
  it("chaque entree existe une seule fois dans la page", () => {
    for (const [id] of ENTREES) {
      const n = (html.match(new RegExp(`id="${id}"`, "g")) || []).length;
      expect(n, `${id} : ${n} occurrence(s)`).toBe(1);
    }
  });

  it("chaque entree garde son gestionnaire de clic (aucun ecran perdu)", () => {
    for (const [id, source] of ENTREES) {
      const cablage = new RegExp(
        `getElementById\\("${id}"\\)\\??\\.addEventListener`,
      );
      expect(source, `cablage absent pour ${id}`).toMatch(cablage);
    }
  });

  it("les neuf entrees restees sont bien DANS le menu (pas seulement presentes)", () => {
    const menu = sliceFrom(pied, 'id="pj-more-menu"', 500);
    for (const id of MENU) {
      expect(menu, `${id} hors du menu`).toContain(`id="${id}"`);
    }
    // Exactement NEUF lignes de menu : aucune ligne oubliee, aucune en trop.
    const lignes = menu.match(/class="pj-more-item"/g) || [];
    expect(lignes, "nombre d'entrees du menu").toHaveLength(9);
  });

  it("« Dossier du projet » et « Commandes du projet » ne sont PLUS dans le menu", () => {
    const menu = sliceFrom(pied, 'id="pj-more-menu"', 500);
    // Ils sont remontes dans le bloc du bas : les renvoyer dans le menu doit
    // faire echouer ce test (et le test d'ordre des six lignes).
    expect(menu).not.toContain('id="btn-commands"');
    expect(menu).not.toContain('id="btn-explorer"');
    // Et ils sont bien des lignes du bloc, entre #project-footer et le menu.
    const blocLignes = sliceSource(pied, 'id="project-footer"', 'id="pj-more-wrap"', 500);
    expect(blocLignes).toContain('id="btn-commands"');
    expect(blocLignes).toContain('id="btn-explorer"');
  });

  it("le menu est groupe et nomme (5 groupes, libelles ecrits en clair)", () => {
    const groupes = pied.match(/pj-more-group-label/g) || [];
    expect(groupes).toHaveLength(5);
    for (const libelle of [
      "Mon projet",
      "Comprendre",
      "Vérifier",
      "Collaborer",
      "Sources",
    ]) {
      expect(pied).toContain(`>${libelle}</div>`);
    }
  });
});

describe("LOT 3 (c) — huit lignes de 32 px, 316 px de haut (dette de plafond connue)", () => {
  it("le panneau ne contient que HUIT lignes, dans l'ordre fige", () => {
    const panneau = html.match(/\n      <div class="pj-panel">\n([\s\S]*?)\n      <\/div>/);
    expect(panneau, "conteneur .pj-panel introuvable").not.toBeNull();
    const lignes = panneau[1]
      .split("\n")
      .filter((l) => l.startsWith("        <button") || l.includes('id="pj-more-wrap"'));
    // Si QUATRE lignes reviennent (retour a l'etat du lot 3 d'origine), la
    // longueur comme l'ordre ci-dessous echouent.
    expect(lignes).toHaveLength(8);
    // La 8e ligne est le conteneur du menu : son declencheur est la ligne.
    const ordre = lignes.map((l) =>
      l.includes('id="pj-more-wrap"')
        ? "btn-more-screens"
        : (l.match(/id="(btn-[a-z-]+)"/) || [])[1],
    );
    expect(ordre).toEqual(LIGNES);
  });

  it("les deux portes globales sont DANS le bloc, sans condition de projet", () => {
    // Lot A : elles ne portent ni `project-only` (sinon elles disparaitraient
    // sans projet ouvert) ni `hidden` ni la mise en evidence `pj-row-main`.
    for (const id of ["btn-scratchpad", "btn-settings"]) {
      const m = piedNu.match(new RegExp(`<button id="${id}"[^>]*>`));
      expect(m, `ligne ${id} introuvable dans le bloc du bas`).not.toBeNull();
      expect(m[0], `${id} ne doit pas porter project-only`).not.toContain(
        "project-only",
      );
      expect(m[0], `${id} ne doit pas porter hidden`).not.toContain("hidden");
      expect(m[0], `${id} ne doit pas etre mis en evidence`).not.toContain(
        "pj-row-main",
      );
    }
  });

  it("le cadre du bloc reste visible sans projet ouvert (reponse A de la Q3)", () => {
    const ouverture = html.match(/<div id="project-footer"[^>]*>/);
    expect(ouverture, "div #project-footer introuvable").not.toBeNull();
    expect(ouverture[0], "le cadre redevient conditionnel a un projet ouvert")
      .not.toContain("project-only");
    expect(ouverture[0]).not.toContain("hidden");
  });

  it("les libelles sont ecrits en clair, jamais raccourcis", () => {
    expect(pied).toContain(">Brouillon</span>");
    expect(pied).toContain(">Options</span>");
    expect(pied).toContain(">Lancer l'agent</span>");
    expect(pied).toContain(">Assistant</span>");
    expect(pied).toContain(">Dossier du projet</span>");
    expect(pied).toContain(">Terminal</span>");
    expect(pied).toContain(">Commandes du projet</span>");
    expect(pied).toContain(">Autres écrans</span>");
    // L'ancien libelle du bouton remonte ne doit plus s'afficher.
    expect(pied).not.toContain(">Ouvrir le dossier</span>");
  });

  it("la hauteur calculee du bloc est bien 316 px (plafond pas encore ajuste)", () => {
    const piedCss = declarations(bloc(css, "#project-footer"));
    const panneauCss = declarations(bloc(css, ".pj-panel"));
    const ligne = declarations(bloc(css, ".pj-panel button"));
    // padding vertical du cadre
    const pad = Number((piedCss.match(/padding: (\d+)px 0/) || [])[1]);
    expect(pad, "padding vertical du cadre").toBe(8);
    // 8 lignes de 32 px
    expect(ligne).toContain("height: 32px");
    const gap = Number((panneauCss.match(/gap: (\d+)px/) || [])[1]);
    expect(gap, "espace entre les lignes").toBe(6);
    const hauteur = 2 + pad * 2 + 8 * 32 + 7 * gap;
    expect(hauteur).toBe(316);
    // DETTE CONNUE : le Lot A n'ajuste pas le plafond (mission separee). Il vaut
    // toujours 50 % = 250 px a la fenetre minimale (500 px), alors que le bloc
    // fait 316 px. Rendre ce plafond a 60 % sans mettre a jour ce test le fait
    // rougir : c'est voulu, la mise a jour est explicite dans la mission.
    expect(piedCss).toContain("max-height: 50%");
    expect(hauteur).toBeGreaterThan(250);
  });

  it("« Lancer l'agent » reste la ligne mise en evidence (13 px / 600, accent)", () => {
    expect(pied).toContain('id="btn-terminal-cmd" class="project-only hidden pj-row-main"');
    expect(pied).toContain(">Lancer l'agent</span>");
    const d = declarations(bloc(css, ".pj-panel button.pj-row-main"));
    expect(d).toContain("font-size: var(--font-base)");
    expect(d).toContain("font-weight: var(--fw-semibold)");
    const icone = declarations(bloc(css, ".pj-panel button.pj-row-main .icon"));
    expect(icone).toContain("color: var(--accent-text)");
    // Les SEPT autres lignes restent a 12 px (dont les deux portes du Lot A).
    expect(declarations(bloc(css, ".pj-panel button"))).toContain(
      "font-size: var(--font-sm)",
    );
  });
});

describe("LOT 3 (d) — le menu s'ouvre vers le haut et se ferme", () => {
  it("le declencheur annonce son menu", () => {
    const m = pied.match(/<button id="btn-more-screens"[^>]*>/);
    expect(m, "declencheur #btn-more-screens introuvable").not.toBeNull();
    expect(m[0]).toContain('aria-haspopup="menu"');
    expect(m[0]).toContain('aria-expanded="false"');
    expect(m[0]).toContain('aria-controls="pj-more-menu"');
    expect(pied).toContain('id="pj-more-menu" class="pj-more-menu hidden"');
  });

  it("le panneau s'ouvre AU-DESSUS du bloc, largeur du cadre, defilable", () => {
    const d = declarations(bloc(css, ".pj-more-menu"));
    expect(d).toContain("bottom: calc(100% + 4px)");
    expect(d).toContain("max-height: 60vh");
    expect(d).toContain("overflow-y: auto");
    expect(d).toContain("left: 0");
    expect(d).toContain("right: 0");
    // Le cadre ne rogne pas le menu qui sort par le haut.
    expect(declarations(bloc(css, "#project-footer"))).toContain("overflow: visible");
  });

  it("lignes de 28 px, icone secondaire, en-tete de groupe accentue", () => {
    const d = declarations(bloc(css, ".pj-more-menu .pj-more-item"));
    expect(d).toContain("height: 28px");
    expect(d).toContain("padding: 0 8px");
    expect(d).toContain("gap: 8px");
    expect(d).toContain("font-size: var(--font-sm)");
    expect(d).toContain("color: var(--text-primary)");
    const g = declarations(bloc(css, ".pj-more-group-label"));
    expect(g).toContain("font-size: var(--font-xs)");
    expect(g).toContain("font-weight: var(--fw-semibold)");
    // Le TITRE de rubrique se distingue du texte courant : meme regle de
    // couleur que les titres de blocs des Parametres (`--accent-text`, jeton
    // du theme pour l'accent en TEXTE). Etait `--text-secondary` avant la
    // demande du proprietaire (2026-10-25). La taille, la graisse, la casse et
    // l'espacement restent ceux du lot 3 : seule la couleur change.
    expect(g).toContain("color: var(--accent-text)");
    expect(g).not.toContain("--text-muted");
  });

  it("fermeture : Echap, clic exterieur, selection d'une ligne", () => {
    expect(sidebarJs).toContain('e.key !== "Escape"');
    expect(sidebarJs).toContain('menu.classList.toggle("hidden", !ouvert)');
    expect(sidebarJs).toContain('setAttribute("aria-expanded", ouvert ? "true" : "false")');
    expect(sidebarJs).toContain('if (e.target.closest(".pj-more-item")) fermer();');
    // Clic exterieur en phase de capture : ne bloque aucun autre clic.
    expect(sidebarJs).toContain("true\n    );");
  });
});

describe("LOT 3 (e) — le cadre accent reste, sans couleur en dur", () => {
  it("le bloc du bas garde le SEUL cadre accentue de l'interface", () => {
    const d = declarations(bloc(css, "#project-footer"));
    expect(d).toContain("border: 1px solid var(--accent)");
    expect(d).toContain("color-mix(in srgb, var(--accent) 16%");
    expect(d).toContain("border-radius: var(--radius-lg)");
  });

  it("aucune couleur ecrite en dur dans le bloc, le menu et ses lignes", () => {
    const enDur = [];
    for (const sel of [
      "#project-footer",
      ".pj-panel",
      ".pj-panel button",
      ".pj-panel button.pj-row-main",
      ".pj-panel button.pj-row-main .icon",
      ".pj-more-wrap",
      ".pj-more-chevron",
      ".pj-more-menu",
      ".pj-more-group-label",
      ".pj-more-menu .pj-more-item",
      ".pj-more-menu .pj-more-item:hover",
    ]) {
      for (const corps of blocs(css, sel)) {
        for (const m of corps.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)) {
          enDur.push(`${sel} -> ${m[0]}`);
        }
      }
    }
    expect(enDur).toEqual([]);
  });
});
