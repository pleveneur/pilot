// Verrou — ÉTIQUETTE DE PROJET DES BULLES DE L'ASSISTANT
//
// Défaut corrigé (docs/rapports/RAPPORT-etiquette-projet-des-bulles.md) : la
// bulle de l'Assistant nommait le projet ACTIF de la fenêtre de conversation au
// lieu du projet réellement concerné par l'échange. Cas reproduit : fenêtre sur
// le projet A, l'Assistant délègue une mission sur le projet B (`project` de
// l'outil de délégation), la mission travaille bien dans B, la réponse parle de
// B — et l'étiquette affichait A.
//
// Cause : la bulle est créée au `message_start`, donc AVANT l'appel d'outil qui
// révèle le projet visé. À cet instant seul le projet ouvert est connu et il
// était figé comme « dernier recours » ; la fin de tour ne savait qu'AJOUTER des
// noms, jamais en remplacer un.
//
// Ce fichier échoue sur le code d'avant la correction (voir la preuve par
// mutation dans le rapport) : le cas 3 ci-dessous y produisait ["Pilot","PLh"],
// le projet ouvert en tête.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeProjectLabels,
  isProvenLabelSource,
  decideMessageProjectLabel,
  decideFinalBubbleProjectLabel,
  projectLabelBadgeTitles,
  PROJECT_LABEL_SOURCE,
} from "./super-agent-project-label.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSource = (name) => fs.readFileSync(path.join(HERE, name), "utf8").replace(/\r\n/g, "\n");

/** Tranche de source à partir de l'ancre (fin au prochain `\n}` de même niveau). */
function sliceFunction(src, anchor) {
  const start = src.indexOf(anchor);
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return end < 0 ? src.slice(start) : src.slice(start, end + 3);
}

describe("normalizeProjectLabels (noms d'étiquette)", () => {
  it("retire les vides, les espaces et les doublons (casse ignorée), garde l'ordre", () => {
    expect(normalizeProjectLabels([" PLh ", "", null, "plh", "Pilot ", 42])).toEqual(["PLh", "Pilot", "42"]);
  });

  it("n'invente jamais un nom : toute entrée non-liste donne une liste vide", () => {
    expect(normalizeProjectLabels(null)).toEqual([]);
    expect(normalizeProjectLabels(undefined)).toEqual([]);
    expect(normalizeProjectLabels("PLh")).toEqual([]);
  });

  it("distingue une provenance prouvée d'un simple dernier recours", () => {
    expect(isProvenLabelSource(PROJECT_LABEL_SOURCE.NAMED)).toBe(true);
    expect(isProvenLabelSource(PROJECT_LABEL_SOURCE.MISSION)).toBe(true);
    expect(isProvenLabelSource(PROJECT_LABEL_SOURCE.EXPLICIT)).toBe(true);
    expect(isProvenLabelSource(PROJECT_LABEL_SOURCE.OPEN_PROJECT)).toBe(false);
    expect(isProvenLabelSource(PROJECT_LABEL_SOURCE.NONE)).toBe(false);
  });
});

describe("decideMessageProjectLabel (à la création de la bulle)", () => {
  it("respecte l'ordre : explicite > nommé > visé > projet ouvert > rien", () => {
    expect(decideMessageProjectLabel(["Relais"], ["Nomme"], ["Vise"], ["Ouvert"]).labels).toEqual(["Relais"]);
    expect(decideMessageProjectLabel(null, ["Nomme"], ["Vise"], ["Ouvert"]).labels).toEqual(["Nomme"]);
    expect(decideMessageProjectLabel(null, null, ["Vise"], ["Ouvert"]).labels).toEqual(["Vise"]);
    expect(decideMessageProjectLabel(null, null, [], ["Ouvert"]).labels).toEqual(["Ouvert"]);
    expect(decideMessageProjectLabel(null, [], null, []).labels).toEqual([]);
  });

  it("donne la provenance du nom retenu (c'est elle qui autorise une correction)", () => {
    expect(decideMessageProjectLabel(null, ["Nomme"], [], []).source).toBe(PROJECT_LABEL_SOURCE.NAMED);
    expect(decideMessageProjectLabel(null, null, [], ["Ouvert"]).source).toBe(PROJECT_LABEL_SOURCE.OPEN_PROJECT);
    expect(decideMessageProjectLabel(null, null, [], []).source).toBe(PROJECT_LABEL_SOURCE.NONE);
  });

  it("distingue le projet principal (premier) des projets seulement signalés", () => {
    const d = decideMessageProjectLabel(null, null, ["PLh", "MakeFilm"], ["Pilot"]);
    expect(d.main).toBe("PLh");
    expect(d.others).toEqual(["MakeFilm"]);
    expect(d.labels).toEqual(["PLh", "MakeFilm"]);
  });
});

describe("decideFinalBubbleProjectLabel — la mission remplace le dernier recours", () => {
  it("VERROU : bulle ouverte sur « Pilot », mission réellement lancée sur « PLh » → « PLh » seul", () => {
    // À la création : rien de nommé, aucun projet visé connu → dernier recours
    // = projet ouvert « Pilot ».
    const created = decideMessageProjectLabel(null, [], [], ["Pilot"]);
    expect(created.labels).toEqual(["Pilot"]);
    expect(created.source).toBe(PROJECT_LABEL_SOURCE.OPEN_PROJECT);
    // À la fin du tour, la délégation a révélé le projet visé : « PLh ».
    const final = decideFinalBubbleProjectLabel(created.labels, created.source, ["PLh"], []);
    expect(final.labels).toEqual(["PLh"]);
    expect(final.main).toBe("PLh");
    expect(final.source).toBe(PROJECT_LABEL_SOURCE.MISSION);
    // Le projet de la fenêtre n'est plus nommé : il n'était pas concerné.
    expect(final.labels).not.toContain("Pilot");
  });

  it("plusieurs projets visés : le premier est la mission principale, les autres sont signalés", () => {
    const final = decideFinalBubbleProjectLabel(["Pilot"], PROJECT_LABEL_SOURCE.OPEN_PROJECT, ["PLh", "MakeFilm"], []);
    expect(final.main).toBe("PLh");
    expect(final.others).toEqual(["MakeFilm"]);
    expect(final.labels).not.toContain("Pilot");
  });

  it("un nom PROUVÉ ne recule jamais : le projet visé passe devant, le nom cité reste", () => {
    const final = decideFinalBubbleProjectLabel(["Pilot"], PROJECT_LABEL_SOURCE.NAMED, ["PLh"], []);
    expect(final.labels).toEqual(["PLh", "Pilot"]);
    expect(final.main).toBe("PLh");
  });

  it("la réponse peut citer un autre projet sans effacer un nom déjà prouvé", () => {
    const final = decideFinalBubbleProjectLabel(["PLh"], PROJECT_LABEL_SOURCE.MISSION, [], ["MakeFilm"]);
    expect(final.labels).toEqual(["PLh", "MakeFilm"]);
  });

  it("sans mission, un projet cité par la réponse efface un simple dernier recours", () => {
    const final = decideFinalBubbleProjectLabel(["Pilot"], PROJECT_LABEL_SOURCE.OPEN_PROJECT, [], ["MakeFilm"]);
    expect(final.labels).toEqual(["MakeFilm"]);
    expect(final.labels).not.toContain("Pilot");
  });

  it("réponse qui nomme un projet, bulle sans aucun badge : le projet cité s'affiche (#15 conservé)", () => {
    const final = decideFinalBubbleProjectLabel([], PROJECT_LABEL_SOURCE.NONE, [], ["MakeFilm"]);
    expect(final.labels).toEqual(["MakeFilm"]);
    expect(final.source).toBe(PROJECT_LABEL_SOURCE.NAMED);
  });

  it("cas 3 de la demande : message purement conversationnel → projet actif (dernier recours)", () => {
    const final = decideFinalBubbleProjectLabel(["Pilot"], PROJECT_LABEL_SOURCE.OPEN_PROJECT, [], []);
    expect(final.labels).toEqual(["Pilot"]);
    expect(final.main).toBe("Pilot");
  });

  it("cas 3 bis : aucun projet ouvert → aucune étiquette (jamais de nom inventé)", () => {
    const final = decideFinalBubbleProjectLabel([], PROJECT_LABEL_SOURCE.NONE, [], []);
    expect(final.labels).toEqual([]);
    expect(final.main).toBe("");
    expect(final.source).toBe(PROJECT_LABEL_SOURCE.NONE);
  });

  it("tolère une provenance inconnue d'une bulle ancienne sans perdre le nom affiché", () => {
    const final = decideFinalBubbleProjectLabel(["Pilot"], null, [], []);
    expect(final.labels).toEqual(["Pilot"]);
    expect(final.source).toBe(PROJECT_LABEL_SOURCE.OPEN_PROJECT);
  });

  it("fail-open : arguments invalides → aucune exception, aucune étiquette inventée", () => {
    expect(decideFinalBubbleProjectLabel().labels).toEqual([]);
    expect(decideFinalBubbleProjectLabel(null, "x", "PLh", 3).labels).toEqual([]);
  });
});

describe("projectLabelBadgeTitles (le principal est dit, les autres sont signalés)", () => {
  it("une infobulle par badge, alignée sur les noms", () => {
    const d = decideFinalBubbleProjectLabel(["Pilot"], PROJECT_LABEL_SOURCE.OPEN_PROJECT, ["PLh", "MakeFilm"], []);
    const titles = projectLabelBadgeTitles(d);
    expect(titles).toHaveLength(d.labels.length);
    expect(titles[0]).toContain("principal");
    expect(titles[1]).toContain("Autre projet");
  });

  it("un badge de simple dernier recours ne prétend rien", () => {
    const d = decideMessageProjectLabel(null, [], [], ["Pilot"]);
    expect(projectLabelBadgeTitles(d)).toEqual([""]);
  });

  it("aucune infobulle quand il n'y a aucun badge", () => {
    expect(projectLabelBadgeTitles({ labels: [], source: PROJECT_LABEL_SOURCE.NONE })).toEqual([]);
    expect(projectLabelBadgeTitles(null)).toEqual([]);
  });
});

describe("branchement dans l'écran (une seule décision, un seul point d'écriture)", () => {
  const src = readSource("super-agent.js");

  it("la création de la bulle utilise la décision unique du module dédié", () => {
    const block = sliceFunction(src, "export function createSuperAgentBlock");
    expect(block).toContain("decideMessageProjectLabel(\n");
    // La provenance est figée AVEC la bulle : sans elle, aucune correction n'est
    // possible en fin de tour.
    expect(block).toContain("bubbleBadgeSources.set(");
    expect(block).toContain("bubbleBadgeSnapshots.set(");
  });

  it("la fin de tour corrige l'étiquette avec les projets réellement visés", () => {
    const fn = sliceFunction(src, "async function extendResponseBubbleBadges");
    expect(fn).toContain("decideFinalBubbleProjectLabel(");
    // La provenance figée est transmise : c'est elle qui distingue un nom prouvé
    // d'un simple dernier recours.
    expect(fn).toContain("baseSource");
  });

  it("les projets visés par le tour sont capturés AVANT la remise à zéro de fin de tour", () => {
    const at = src.indexOf("const respConcerned =");
    expect(at).toBeGreaterThan(-1);
    const end = src.indexOf("onEnd();", at);
    expect(end).toBeGreaterThan(at);
    // L'appel de correction reçoit bien ces projets.
    const call = src.slice(at, end + 400);
    expect(call).toContain("extendResponseBubbleBadges(");
    expect(call).toContain("respConcerned");
  });

  it("une seule rangée de badges est créée dans tout l'écran (point d'écriture unique)", () => {
    const occurrences = src.match(/className = "agent-project-badges"/g) || [];
    expect(occurrences).toHaveLength(1);
  });
});

describe("module des badges : la règle de priorité n'y est plus réécrite", () => {
  const badges = readSource("super-agent-badges.js");

  it("resolveBubbleBadgeNames délègue à la décision unique", () => {
    const fn = sliceFunction(badges, "export function resolveBubbleBadgeNames");
    expect(fn).toContain("decideMessageProjectLabel(");
  });
});
