/**
 * VERROU — l'onglet « Travaux » du panneau « Travail » porte bien ce nom.
 *
 * Le proprietaire a confondu l'onglet du panneau « Travail » (qui ne montre que
 * le TRAVAIL DES AGENTS : missions en cours, en demarrage, en attente) avec les
 * TACHES DE SON SUIVI (Kanban, avec checklists de livraison), qui n'y figurent
 * jamais. Decision : lever la confusion par le NOM. L'onglet s'appelle donc
 * « Travaux » — et plus « Taches ».
 *
 * Ce que ce fichier tient (il ECHOUE si l'un de ces points revient en arriere) :
 *   (a) le bouton de l'onglet dans `index.html` affiche « Travaux » et jamais
 *       « Taches » ;
 *   (b) `AGENT_PANEL_TAB_LABELS.tasks` (la source des libelles du module) vaut
 *       « Travaux » ;
 *   (c) le reglage des Parametres qui active cet onglet le nomme « Travaux »
 *       (libelle ET infobulle), plus « Taches » ;
 *   (d) ce qui ne devait PAS bouger n'a pas bouge : l'entree du panneau reste
 *       « Travail », l'ordre des trois onglets reste Agents / Travaux /
 *       Evenements, et l'onglet du suivi reste « Kanban ».
 *
 * Aucun navigateur n'est requis : lecture des sources (fins de ligne
 * normalisees, cf. quality-gate 3.4) + libelles du module.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { AGENT_PANEL_TAB_LABELS, AGENT_PANEL_TABS } from "./agent-activity.js";
// Découpage de source VÉRIFIÉ : une ancre absente doit faire ÉCHOUER le test,
// jamais rendre vraie par construction une assertion négative.
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");

/** Fragment d'un bouton (de son identifiant a sa fermeture), verifie. */
function boutonTexte(id) {
  return sliceSource(html, `id="${id}"`, "</button>", 20);
}

/** La ligne (label HTML) du reglage qui active l'onglet des missions. */
function ligneReglageOnglet() {
  // Le label vient APRES la case a cocher : on part de son attribut `for`.
  return sliceSource(html, 'for="setting-superagent-tasks-tab"', "</label>", 10);
}

describe("l'onglet des missions du panneau « Travail » s'appelle « Travaux »", () => {
  it("(a) le bouton de l'onglet affiche « Travaux », jamais « Tâches »", () => {
    const bouton = boutonTexte("agent-activity-tab-tasks");
    // Le fragment s'arrete juste AVANT « </button> » : le libelle le termine.
    expect(bouton.trimEnd().endsWith(">Travaux")).toBe(true);
    expect(bouton).not.toContain("Tâches");
    expect(bouton).not.toContain("Taches");
  });

  it("(b) la source des libelles du module dit « Travaux »", () => {
    expect(AGENT_PANEL_TAB_LABELS.tasks).toBe("Travaux");
    expect(AGENT_PANEL_TAB_LABELS.tasks).not.toContain("Tâches");
  });

  it("(c) le reglage des Parametres nomme l'onglet « Travaux », jamais « Tâches »", () => {
    const ligne = ligneReglageOnglet();
    expect(ligne).toContain("Travaux");
    expect(ligne).not.toContain("Tâches");
    // L'infobulle dit aussi de quel panneau il s'agit (elle nomme l'onglet).
    const title = /title="([^"]*)"/.exec(ligne);
    expect(title, "le reglage doit garder son infobulle").not.toBeNull();
    expect(title[1]).toContain("Travaux");
    expect(title[1]).not.toContain("Tâches");
  });

  it("(d) rien d'autre n'a ete renomme : entree « Travail », ordre des onglets, « Kanban »", () => {
    // L'entree du panneau (le bouton du haut) garde son nom : « Travail ».
    const entree = boutonTexte("agent-activity-entry");
    expect(entree).toContain(">Travail<");
    expect(entree).not.toContain("Travaux");
    // L'ordre des trois onglets est inchange.
    expect(AGENT_PANEL_TABS).toEqual(["agents", "tasks", "events"]);
    // Les deux autres libelles sont intacts.
    expect(AGENT_PANEL_TAB_LABELS.agents).toBe("Agents");
    expect(AGENT_PANEL_TAB_LABELS.events).toBe("Événements");
    // Le suivi garde son onglet « Kanban » (il n'est pas concerne).
    expect(html).toMatch(/>Kanban</);
  });
});
