// Controles de la REGLE DE NOMMAGE des bulles de l'Assistant
// (decision proprietaire 2026-10-22) : une bulle qui concerne un projet porte
// le nom de ce projet, et JAMAIS un nom invente.
//
// Ordre de la regle (source de verite unique : resolveBubbleBadgeNames dans
// super-agent-badges.js) :
//   1. projets nommes dans le texte du message (ordre d'apparition) ;
//   2. projet(s) reellement concerne(s) : mission/agents lances, agent cible,
//      projet transmis a un agent, projet ouvert par l'assistant ;
//   3. DERNIER RECOURS : projet ouvert au moment de la creation de la bulle ;
//   4. sinon AUCUNE etiquette.
//
// Les controles (a) a (e) demandes par la mission vivent ici : chacun echoue
// si la regle est neutralisee (voir le rapport .pilot/rapports/).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolveBubbleBadgeNames,
  addConcernedBadge,
  badgeNameFromProjectPath,
  captureProjectBadgeNames,
} from "./super-agent-badges.js";

const PROJECTS = [
  { path: "G:/IA_PL/pilot", name: "Pilot" },
  { path: "G:/IA_PL/PLh", name: "PLh" },
  { path: "D:/Clients/Acme/site-vitrine", name: "Site Vitrine" },
];

const readSource = (rel) =>
  readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Corps d'une fonction (de sa signature a la fonction de premier niveau
 * suivante) : permet de verifier qu'un chemin de rendu n'appelle PAS les badges. */
function sliceFunction(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(export )?(async )?function /);
  return signature + (end < 0 ? rest : rest.slice(0, end));
}

describe("(a) une bulle qui concerne un projet porte TOUJOURS une etiquette", () => {
  it("projet nomme dans le texte -> etiquette", () => {
    const named = captureProjectBadgeNames("On avance sur PLh ?", null, PROJECTS);
    expect(resolveBubbleBadgeNames(null, named, [], [])).toEqual(["PLh"]);
  });

  it("aucun projet nomme mais projet reellement concerne -> etiquette", () => {
    // Cas du proprietaire : l'assistant parle de boutons et d'onglets sans
    // nommer le projet, mais une mission a ete lancee sur PLh.
    expect(resolveBubbleBadgeNames(null, [], ["PLh"], ["Autre"])).toEqual(["PLh"]);
    expect(resolveBubbleBadgeNames(null, null, ["PLh"], [])).toEqual(["PLh"]);
  });

  it("dernier recours : le projet ouvert au moment de la creation de la bulle", () => {
    expect(resolveBubbleBadgeNames(null, null, [], ["Pilot"])).toEqual(["Pilot"]);
  });

  it("badges explicites (relais d'une question d'agent) toujours prioritaires", () => {
    expect(resolveBubbleBadgeNames(["PLh"], ["Pilot"], ["Site Vitrine"], ["Autre"])).toEqual(["PLh"]);
  });

  it("le projet nomme dans le texte prime sur le projet concerne et sur le projet ouvert", () => {
    expect(resolveBubbleBadgeNames(null, ["Pilot"], ["PLh"], ["Autre"])).toEqual(["Pilot"]);
  });
});

describe("(b) deux projets nommes -> les deux, dans l'ordre du texte", () => {
  it("ordre d'apparition conserve", () => {
    const named = captureProjectBadgeNames("compare PLh et Pilot", null, PROJECTS);
    expect(named).toEqual(["PLh", "Pilot"]);
    expect(resolveBubbleBadgeNames(null, named, ["Autre"], ["Autre"])).toEqual(["PLh", "Pilot"]);
  });

  it("ordre inverse -> ordre inverse", () => {
    const named = captureProjectBadgeNames("Pilot d'abord, puis PLh", null, PROJECTS);
    expect(resolveBubbleBadgeNames(null, named, [], [])).toEqual(["Pilot", "PLh"]);
  });

  it("deux projets reellement concernes -> les deux, sans doublon", () => {
    let concerned = [];
    concerned = addConcernedBadge(concerned, "G:\\IA_PL\\PLh");
    concerned = addConcernedBadge(concerned, "G:\\IA_PL\\pilot");
    concerned = addConcernedBadge(concerned, "G:\\IA_PL\\PLh"); // doublon
    expect(resolveBubbleBadgeNames(null, null, concerned, ["Autre"])).toEqual(["PLh", "pilot"]);
  });
});

describe("(c) une mission visant un AUTRE projet n'affiche jamais le projet ouvert", () => {
  it("le projet vise prime sur le projet ouvert a l'ecran", () => {
    // Projet ouvert : « Autre » ; mission reellement lancee sur « PLh ».
    expect(resolveBubbleBadgeNames(null, null, ["PLh"], ["Autre"])).toEqual(["PLh"]);
    expect(resolveBubbleBadgeNames(null, null, ["PLh"], ["Autre"])).not.toContain("Autre");
  });

  it("un chemin de projet ne devient jamais une etiquette (dernier segment seul)", () => {
    expect(addConcernedBadge([], "G:\\IA_PL\\PLh")).toEqual(["PLh"]);
    expect(addConcernedBadge([], "D:/Clients/Acme/site-vitrine")).toEqual(["site-vitrine"]);
    expect(badgeNameFromProjectPath("G:/IA_PL/PLh")).toBe("PLh");
    expect(badgeNameFromProjectPath("")).toBe("");
  });

  it("integration : le projet vise (regle 2) est evalue AVANT le projet ouvert (regle 3)", () => {
    const src = readSource("./super-agent.js");
    const start = src.indexOf("resolveBubbleBadgeNames(\n");
    expect(start).toBeGreaterThan(-1);
    const call = src.slice(start, src.indexOf(");", start));
    expect(call.indexOf("currentTurnProjectBadges")).toBeLessThan(call.indexOf("currentTurnConcernedBadges"));
    expect(call.indexOf("currentTurnConcernedBadges")).toBeLessThan(call.indexOf("currentOpenProjectBadges"));
  });

  it("integration : les missions/agents/outils notent bien le projet reellement concerne", () => {
    const src = readSource("./super-agent.js");
    // run_agents : projet VISE par la mission.
    expect(src).toContain("noteConcernedProject(targetProject || window._pilotProjectPath || null);");
    // delegate_to_coder : projet A QUI la demande est transmise.
    expect(src).toContain("noteConcernedProject(projectPath);");
    // open_project : projet ouvert par l'assistant.
    expect(src).toContain("noteConcernedProject(path);");
  });
});

describe("(d) aucune etiquette sur les bulles de l'utilisateur ni sur les messages systeme", () => {
  it("appendSystemMessage ne rend aucun badge projet", () => {
    const src = readSource("./super-agent.js");
    const body = sliceFunction(src, "function appendSystemMessage(");
    expect(body).not.toBe("");
    expect(body.includes("renderProjectBadgesInto")).toBe(false);
    expect(body.includes("agent-project-badges")).toBe(false);
  });

  it("la bulle de l'utilisateur ne recoit QUE les projets nommes dans son texte", () => {
    const src = readSource("./super-agent.js");
    // Le seul rendu de badges sur une bulle utilisateur part des projets NOMMES.
    expect(src).toContain("renderProjectBadgesInto(userBubble, badgeNames)");
    // Aucun repli (projet concerne / projet ouvert) sur la bulle utilisateur.
    expect(src.includes("renderProjectBadgesInto(userBubble, resolveBubbleBadgeNames")).toBe(false);
    expect(src.includes("renderProjectBadgesInto(userBubble, currentTurnConcernedBadges")).toBe(false);
    expect(src.includes("renderProjectBadgesInto(userBubble, currentOpenProjectBadges")).toBe(false);
  });
});

describe("(e) jamais de nom invente", () => {
  it("aucun projet nomme, aucun projet concerne, aucun projet ouvert -> aucune etiquette", () => {
    expect(resolveBubbleBadgeNames(null, null, null, null)).toEqual([]);
    expect(resolveBubbleBadgeNames([], [], [], [])).toEqual([]);
    expect(resolveBubbleBadgeNames(undefined, undefined, undefined, undefined)).toEqual([]);
  });

  it("un chemin vide n'invente pas de nom", () => {
    expect(badgeNameFromProjectPath(null)).toBe("");
    expect(badgeNameFromProjectPath("   ")).toBe("");
    expect(addConcernedBadge([], "")).toEqual([]);
    expect(addConcernedBadge([], null)).toEqual([]);
  });

  it("les listes sont normalisees (espaces, doublons, valeurs non-texte)", () => {
    expect(resolveBubbleBadgeNames(["  PLh  ", "plh", "", null], null, null, null)).toEqual(["PLh"]);
    expect(resolveBubbleBadgeNames([42], null, null, null)).toEqual(["42"]);
  });
});
