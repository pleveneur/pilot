/**
 * Verrou du renommage « Reglages » -> « Options » A L'ECRAN.
 *
 * Decision du proprietaire : ce que l'utilisateur lit « Reglages » s'appelle
 * desormais « Options ». Seul le TEXTE AFFICHE change ; aucun identifiant
 * interne n'est renomme (les identifiants sont verrouilles par d'autres tests
 * et par du code Rust qui les reference) :
 *   - `#btn-settings`, `#settings-modal`, la classe `.ga-label`,
 *     `.settings-head-title`, le mode d'onglet `settings`, les cles de
 *     configuration (`read_aloud_voice`, ...) restent IDENTIQUES ;
 *   - la commande de palette garde son `id: "settings"`.
 *
 * Ce fichier echoue si :
 *   (a) le bouton `#btn-settings` perd son libelle « Options » ou reprend
 *       « Reglages » ;
 *   (b) le titre du panneau (`.settings-head-title`) reprend « Reglages » ;
 *   (c) le titre de l'onglet ou son panneau de repli reprend « Reglages » ;
 *   (d) la palette de commandes reagroupe sous « Reglages » (categorie) ou
 *       annonce « Ouvrir les Reglages » ;
 *   (e) un message destine a l'utilisateur renvoie encore vers
 *       « Reglages → ... » (message de panne du service Laya) ;
 *   (f) une occurrence AFFICHEE de « Reglages » revient dans `index.html` en
 *       dehors des FAUX AMIS listes ci-dessous ;
 *   (g) l'aide integree (source `help/overview.md` et handbook REGENERE)
 *       redit « les Reglages s'ouvrent » ou « (Reglages → Agent) ».
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { layaOffMessage } from "./laya-gateway.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const tabsJs = lire("src/js/tabs.js");
const layaJs = lire("src/js/laya-gateway.js");
const overview = lire("help/overview.md");
const handbook = lire("help/handbook.md");
const specSuperAgent = lire("spec_super_agent.md");
const readme = lire("README.md");

/**
 * Faux amis VOLONTAIREMENT laisses : le mot « Reglages » y designe autre chose
 * que le panneau d'options. Les renommer changerait le sens.
 *   - « Reglages avances » : nom du sous-bloc replie du service Laya ;
 *   - « Reglages (nom, clients, association projet → client) » : rubrique de la
 *     memoire de session a conserver (pas le panneau) ;
 *   - « Reglages Windows » : reglages du systeme d'exploitation ;
 *   - commentaires et messages de console : jamais affiches a l'utilisateur.
 */
const FAUX_AMIS_HTML = ["Réglages avancés", "Réglages (nom, clients"];

describe("(a) le bouton #btn-settings s'appelle « Options »", () => {
  it("le libelle visible est « Options »", () => {
    const m = html.match(/<button id="btn-settings"[\s\S]*?<\/button>/);
    expect(m, "bouton #btn-settings introuvable dans index.html").not.toBeNull();
    expect(m[0]).toContain('<span class="ga-label">Options</span>');
    expect(m[0], "#btn-settings reprend « Reglages »").not.toContain("Réglages");
  });

  it("l'identifiant, la classe et l'icone sont INCHANGES", () => {
    const m = html.match(/<button id="btn-settings"[\s\S]*?<\/button>/);
    // Un renommage d'identifiant casserait le cablage (main.js, tests, code Rust).
    expect(m[0]).toContain('id="btn-settings"');
    expect(m[0]).toContain('class="ga-label"');
    expect(m[0]).toContain('data-lucide="settings"');
  });
});

describe("(b) le titre du panneau s'appelle « Options »", () => {
  it("aucun « Reglages » dans l'en-tete du panneau", () => {
    const m = html.match(/<h2 class="settings-head-title">[\s\S]*?<\/h2>/);
    expect(m, "en-tete .settings-head-title introuvable").not.toBeNull();
    expect(m[0]).toContain("Options");
    expect(m[0], "le titre du panneau reprend « Reglages »").not.toContain(
      "Réglages",
    );
  });
});

describe("(c) l'onglet s'appelle « Options »", () => {
  it("le titre de l'onglet est « Options », le mode reste `settings`", () => {
    expect(tabsJs).toContain('new Tab(id, "", "Options", "settings")');
    expect(tabsJs).not.toContain('new Tab(id, "", "Réglages", "settings")');
  });

  it("le panneau de repli (erreur de chargement) s'appelle aussi « Options »", () => {
    expect(tabsJs).not.toContain(">Réglages<");
  });

  it("plus aucune chaine nue \"Reglages\" (libelle) dans tabs.js", () => {
    expect(tabsJs).not.toContain('"Réglages"');
  });
});

describe("(d) la palette de commandes dit « Options »", () => {
  it("la categorie de palette est « Options » et la commande « Ouvrir les Options »", () => {
    expect(mainJs).toContain(
      'const PALETTE_CATEGORIES = ["Édition", "Projet", "Travail", "Options"];',
    );
    expect(mainJs).toContain('label: "Ouvrir les Options"');
    expect(mainJs).not.toContain("Réglages");
  });

  it("la commande garde son identifiant `settings`", () => {
    expect(mainJs).toContain('id: "settings", label: "Ouvrir les Options"');
  });
});

describe("(e) les messages d'agent renvoient vers les Options", () => {
  it("le message de panne Laya dit « Options → Service Laya »", () => {
    expect(layaOffMessage()).toContain("Options → Service Laya");
    expect(layaOffMessage()).not.toContain("Réglages");
    expect(layaJs).not.toContain("Réglages");
  });
});

describe("(f) aucune occurrence affichee de « Reglages » ne revient dans index.html", () => {
  it("chaque ligne restante est un faux ami declare", () => {
    const lignes = html
      .split("\n")
      .map((texte, i) => ({ texte, no: i + 1 }))
      .filter(({ texte }) => texte.includes("Réglages"));
    const fautives = lignes.filter(
      ({ texte }) => !FAUX_AMIS_HTML.some((ami) => texte.includes(ami)),
    );
    expect(
      fautives.map((f) => `l.${f.no}: ${f.texte.trim()}`),
      "occurrence affichee de « Reglages » revenue dans index.html",
    ).toEqual([]);
  });
});

describe("(g) l'aide integree et le README parlent des Options", () => {
  it("la source de l'aide ne dit plus « les Reglages s'ouvrent »", () => {
    expect(overview).not.toContain("les Réglages s'ouvrent");
    expect(overview).toContain("les Options s'ouvrent");
  });

  it("le handbook REGENERE reprend la source (preuve de `npm run build:handbook`)", () => {
    expect(handbook).not.toContain("les Réglages s'ouvrent");
    expect(handbook).toContain("les Options s'ouvrent");
  });

  it("le renvoi de navigation de l'aide dit « (Options → Agent) »", () => {
    expect(specSuperAgent).not.toContain("(Réglages → Agent)");
    expect(specSuperAgent).toContain("(Options → Agent)");
    expect(handbook).not.toContain("(Réglages → Agent)");
    expect(handbook).toContain("(Options → Agent)");
  });

  it("le README utilisateur ne dit plus « Les Reglages s'ouvrent »", () => {
    expect(readme).not.toContain("Les Réglages s'ouvrent");
    expect(readme).toContain("Les Options s'ouvrent");
  });
});
