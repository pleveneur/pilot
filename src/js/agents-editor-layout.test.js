// agents-editor-layout.test.js — Structure de la fiche (editeur) d'agent 🎭.
//
// Objectif : empecher une derive silencieuse de la mise en page en DEUX COLONNES
// de l'editeur d'agent et garantir qu'AUCUN champ existant ne disparait. Le test
// lit les sources reelles (agents-ui.js + style.css), comme les autres tests de
// cablage : ce qui est present a l'ecran et ce qui est lu a l'enregistrement
// doivent rester alignes.
//
// Invariant : les identifiants #ae-* ne changent pas (l'enregistrement les lit
// tels quels, aucune perte de valeur).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const JS = read("src/js/agents-ui.js");
const CSS = read("src/css/style.css");

// Repartition attendue, par sens : colonne gauche = identite + modeles ;
// colonne droite = role, competences, options et limites.
const LEFT_FIELDS = [
  "ae-id",
  "ae-name",
  "ae-icon",
  "ae-description",
  "ae-model-pi",
  "ae-thinking-pi",
  "ae-thinking-pi-note",
  "ae-model-plh",
  "ae-thinking-plh",
  "ae-thinking-plh-note",
];
const RIGHT_FIELDS = [
  "ae-role",
  "ae-skills",
  "ae-readonly",
  "ae-keep",
  "ae-max-calls",
  "ae-depth",
];
const ALL_FIELDS = [...LEFT_FIELDS, ...RIGHT_FIELDS];

/** Contenu HTML du formulaire (entre .agent-form-cols et les actions). */
function formHtml() {
  const start = JS.indexOf('class="agent-form-cols"');
  expect(start, "bloc .agent-form-cols introuvable dans openEditor").toBeGreaterThan(-1);
  const end = JS.indexOf('<div class="modal-actions">', start);
  expect(end, "fin du formulaire (.modal-actions) introuvable").toBeGreaterThan(start);
  return JS.slice(start, end);
}

/** Decoupe le formulaire aux deux colonnes .agent-form-col. */
function columns(html) {
  const first = html.indexOf('class="agent-form-col"');
  expect(first, "premiere .agent-form-col introuvable").toBeGreaterThan(-1);
  const second = html.indexOf('class="agent-form-col"', first + 1);
  expect(second, "seconde .agent-form-col introuvable").toBeGreaterThan(first);
  return { left: html.slice(first, second), right: html.slice(second) };
}

/** Bloc CSS d'un selecteur simple (premiere occurrence). */
function cssRule(selector) {
  const i = CSS.indexOf(`${selector} {`);
  expect(i, `regle CSS « ${selector} » introuvable`).toBeGreaterThan(-1);
  const j = CSS.indexOf("}", i);
  return CSS.slice(i, j);
}

describe("Editeur d'agent — mise en page deux colonnes (agents-ui.js)", () => {
  it("le formulaire est structure en deux colonnes", () => {
    const html = formHtml();
    expect(html).toContain('class="agent-form-cols"');
    // Exactement deux colonnes de champs.
    expect(html.split('class="agent-form-col"').length - 1).toBe(2);
  });

  it("chaque champ attendu est present, dans la bonne colonne et dans l'ordre", () => {
    const { left, right } = columns(formHtml());

    for (const id of ALL_FIELDS) {
      expect(JS, `champ #${id} absent de l'editeur`).toContain(`id="${id}"`);
    }
    for (const id of LEFT_FIELDS) {
      expect(left, `#${id} devrait etre dans la colonne gauche`).toContain(`id="${id}"`);
    }
    for (const id of RIGHT_FIELDS) {
      expect(right, `#${id} devrait etre dans la colonne droite`).toContain(`id="${id}"`);
    }

    // Ordre de tabulation logique : la colonne gauche d'abord, puis la droite.
    const posLeft = LEFT_FIELDS.map((id) => left.indexOf(`id="${id}"`));
    expect(posLeft).toEqual([...posLeft].sort((a, b) => a - b));
    const posRight = RIGHT_FIELDS.map((id) => right.indexOf(`id="${id}"`));
    expect(posRight).toEqual([...posRight].sort((a, b) => a - b));
  });

  it("la zone Rôle est un textarea haut et redimensionnable verticalement", () => {
    const html = formHtml();
    const m = html.match(/id="ae-role"\s+rows="(\d+)"/);
    expect(m, "textarea #ae-role (avec rows) introuvable").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(6);
  });

  it("l'enregistrement lit toujours exactement les memes identifiants", () => {
    // Aucun champ ne doit etre perdu a la sauvegarde : chaque id est relu.
    for (const id of ALL_FIELDS) {
      expect(JS, `#${id} n'est jamais relu a l'enregistrement`).toContain(`#${id}`);
    }
    // Les competences restent lues via la liste des cases cochees.
    expect(JS).toContain('querySelectorAll("#ae-skills input:checked")');
  });
});

describe("Editeur d'agent — styles deux colonnes (style.css)", () => {
  it("la modale est large (880-960 px) et plafonnee a 92 vw", () => {
    const rule = cssRule(".modal-content.agent-editor-content");
    const m = rule.match(/width:\s*(\d+)px/);
    expect(m, "largeur de la modale introuvable").toBeTruthy();
    const width = Number(m[1]);
    expect(width).toBeGreaterThanOrEqual(880);
    expect(width).toBeLessThanOrEqual(960);
    expect(rule).toMatch(/max-width:\s*92vw/);
    // Le defilement vertical est conserve quand la hauteur manque.
    expect(rule).toMatch(/max-height:\s*\d+vh/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it(".agent-form-cols est une grille a deux colonnes de largeur utile", () => {
    const rule = cssRule(".agent-form-cols");
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*[\d.]+fr\)/);
  });

  it(".agent-form-col ne deborde pas (min-width: 0)", () => {
    const rule = cssRule(".agent-form-col");
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it("#ae-role est redimensionnable verticalement et haut", () => {
    const rule = cssRule("#ae-role");
    expect(rule).toMatch(/resize:\s*vertical/);
    expect(rule).not.toMatch(/resize:\s*(horizontal|both)/);
    const m = rule.match(/min-height:\s*(\d+)px/);
    expect(m, "min-height de #ae-role introuvable").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(180);
  });

  it("une media query replie le formulaire en UNE seule colonne", () => {
    const media = CSS.match(/@media\s*\(max-width:\s*\d+px\)\s*\{[\s\S]*?\.agent-form-cols\s*\{[^}]*\}/);
    expect(media, "media query repliant .agent-form-cols introuvable").toBeTruthy();
    expect(media[0]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    // Une seule piste : pas de seconde colonne.
    expect(media[0].match(/minmax\(/g).length).toBe(1);
  });
});
