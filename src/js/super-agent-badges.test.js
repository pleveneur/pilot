// Tests unitaires — super-agent-badges.js (chantier « badge projet par bulle »).
// Snapshot des badges projet des bulles de l'Assistant : capturé à l'envoi de
// la demande (projet actif + projets explicitement nommés), hérité par la
// bulle de réponse, JAMAIS recalculé. Détection sans IA : correspondance
// insensible à la casse sur le nom affiché OU la fin du chemin, avec
// frontières de mots. Module 100 % pur → testable sans mock.
import { describe, it, expect } from "vitest";
import {
  findNamedProjects,
  captureProjectBadgeNames,
  extendBadgesWithText,
  pathTailName,
  pathSearchSuffixes,
} from "./super-agent-badges.js";

// Projets « connus/ouverts » côté UI (mêmes formes que les invokes réels :
// list_open_projects → chemins ; list_super_agent_projects → {path, name}).
const PROJECTS = [
  { path: "G:/IA_PL/pilot", name: "Pilot" },
  { path: "G:/IA_PL/PLh", name: "PLh" },
  { path: "D:/Clients/Acme/site-vitrine", name: "Site Vitrine" },
];

// Projets suivis EN BASE (list_super_agent_projects) mais non ouverts : leur
// `name` est le chemin complet. Cas réel du défaut corrigé (étiquette de bulle
// = projet dont la conversation parle).
const TRACKED_FULLPATH = [
  { path: "G:\\IA_PL\\PLh", name: "G:\\IA_PL\\PLh" },
  { path: "G:/IA_PL/ExtractDoc", name: "G:/IA_PL/ExtractDoc" },
  { path: "G:\\IA_PL\\PLface", name: "G:\\IA_PL\\PLface" },
  { path: "D:\\Clients\\Acme\\MakeFilm", name: "D:\\Clients\\Acme\\MakeFilm" },
];

describe("pathTailName", () => {
  it("retourne le dernier segment", () => {
    expect(pathTailName("G:/IA_PL/PLh")).toBe("PLh");
  });
  it("normalise les antislash Windows", () => {
    expect(pathTailName("G:\\IA_PL\\PLh")).toBe("PLh");
  });
  it("gère un chemin vide", () => {
    expect(pathTailName("")).toBe("");
    expect(pathTailName(null)).toBe("");
  });
});

describe("pathSearchSuffixes", () => {
  it("2-3 derniers segments seulement (casse préservée)", () => {
    expect(pathSearchSuffixes("D:/Clients/Acme/site-vitrine")).toEqual([
      "Clients/Acme/site-vitrine",
      "Acme/site-vitrine",
    ]);
  });
  it("chemin à 2 segments → suffixe à 2 segments (drive inclus)", () => {
    expect(pathSearchSuffixes("G:/pilot")).toEqual(["G:/pilot"]);
  });
  it("segment unique → vide (couvert par le nom)", () => {
    expect(pathSearchSuffixes("pilot")).toEqual([]);
  });
});

describe("findNamedProjects (détection sans IA)", () => {
  it("aucun match → liste vide", () => {
    expect(findNamedProjects("Rien à signaler aujourd'hui.", PROJECTS)).toEqual([]);
  });
  it("nom exact du projet", () => {
    expect(findNamedProjects("On avance sur Pilot ?", PROJECTS)).toEqual(["Pilot"]);
  });
  it("insensible à la casse (plh / PLH / PlH)", () => {
    expect(findNamedProjects("que fait plh sur ce point", PROJECTS)).toEqual(["PLh"]);
    expect(findNamedProjects("PLH est bloqué", PROJECTS)).toEqual(["PLh"]);
  });
  it("fin de chemin (suffixe 2 segments) dans une citation de chemin", () => {
    expect(findNamedProjects("regarde G:\\IA_PL\\PLh stp", PROJECTS)).toEqual(["PLh"]);
    expect(findNamedProjects("le dossier ia_pl/plh", PROJECTS)).toEqual(["PLh"]);
  });
  it("frontière de mot : ne matche PAS au milieu d'un mot", () => {
    // « pilotage » ne doit pas matcher « Pilot » ; « amplifier » non plus.
    expect(findNamedProjects("le pilotage du projet", PROJECTS)).toEqual([]);
    expect(findNamedProjects("il faut amplifier", PROJECTS)).toEqual([]);
    // « Pilon » : pil- non, mais 'pilon' ne contient pas 'pilot'. OK.
    // Et « pilot » en début/fin de phrase matche bien.
    expect(findNamedProjects("Pilot", PROJECTS)).toEqual(["Pilot"]);
    expect(findNamedProjects("(Pilot)", PROJECTS)).toEqual(["Pilot"]);
  });
  it("plusieurs matchs → dans l'ordre de la liste, dédupliqués", () => {
    expect(findNamedProjects("compare PLh et Pilot", PROJECTS)).toEqual([
      "Pilot",
      "PLh",
    ]);
  });
  it("deux mentions du même projet → un seul badge", () => {
    expect(findNamedProjects("PLh puis encore PLH", PROJECTS)).toEqual(["PLh"]);
  });
  it("fail-open : texte/projets invalides → vide, pas d'exception", () => {
    expect(findNamedProjects(null, PROJECTS)).toEqual([]);
    expect(findNamedProjects("", null)).toEqual([]);
    expect(findNamedProjects("Pilot", null)).toEqual([]);
    expect(findNamedProjects("Pilot", [null, "x", 42])).toEqual([]);
  });
  it("projet sans name → tombe sur le dernier segment du chemin", () => {
    const list = [{ path: "G:/Travail/Compta" }];
    expect(findNamedProjects("voir avec compta", list)).toEqual(["Compta"]);
  });
  it("casse différente entre deux projets → un seul badge (dédup)", () => {
    const list = [
      { path: "G:/a/pilot", name: "Pilot" },
      { path: "G:/b/pilot", name: "PILOT" },
    ];
    expect(findNamedProjects("pilot et pilot", list)).toEqual(["Pilot"]);
  });
  it("nom court cité seul (projet suivi non ouvert) → reconnu", () => {
    expect(findNamedProjects("ou en est PLh ?", TRACKED_FULLPATH)).toEqual(["PLh"]);
  });
  it("chemin Windows en fin de phrase → nom court", () => {
    expect(findNamedProjects("regarde G:\\IA_PL\\PLh", TRACKED_FULLPATH)).toEqual(["PLh"]);
  });
  it("chemin slash en fin de phrase → nom court", () => {
    expect(findNamedProjects("regarde G:/IA_PL/ExtractDoc", TRACKED_FULLPATH)).toEqual(["ExtractDoc"]);
  });
  it("chemin entre guillemets → nom court", () => {
    expect(findNamedProjects('le dossier "G:\\IA_PL\\PLface" avance', TRACKED_FULLPATH)).toEqual(["PLface"]);
  });
  it("chemin inconnu → aucun badge", () => {
    expect(findNamedProjects("dossier G:\\IA_PL\\Inconnu", TRACKED_FULLPATH)).toEqual([]);
  });
  it("le badge n'est JAMAIS un chemin", () => {
    expect(findNamedProjects("le dossier IA_PL/PLh", TRACKED_FULLPATH).every((n) => !/[\\/]/.test(n))).toBe(true);
  });
});

describe("captureProjectBadgeNames (snapshot d'un envoi)", () => {
  it("projet actif seul si aucun projet nommé", () => {
    expect(captureProjectBadgeNames("salut", "Pilot", PROJECTS)).toEqual(["Pilot"]);
  });
  it("projets nommés d'abord + projet actif ensuite (projet dont on parle en tête)", () => {
    expect(captureProjectBadgeNames("compare PLh et Pilot", "PLh", PROJECTS)).toEqual([
      "Pilot",
      "PLh",
    ]);
  });
  it("le projet dont on parle passe devant le projet actif", () => {
    expect(captureProjectBadgeNames("et MakeFilm ?", "Kodali", TRACKED_FULLPATH)).toEqual(["MakeFilm", "Kodali"]);
  });
  it("aucun projet évoqué → projet actif seul (inchangé)", () => {
    expect(captureProjectBadgeNames("salut", "Kodali", TRACKED_FULLPATH)).toEqual(["Kodali"]);
  });
  it("le projet actif n'est pas dupliqué s'il est aussi nommé", () => {
    expect(captureProjectBadgeNames("on parle de PLh", "PLh", PROJECTS)).toEqual(["PLh"]);
  });
  it("texte vide → projet actif seul", () => {
    expect(captureProjectBadgeNames("", "Pilot", PROJECTS)).toEqual(["Pilot"]);
  });
  it("aucun projet connu → vide (fail-open)", () => {
    expect(captureProjectBadgeNames("blabla", null, null)).toEqual([]);
  });
  it("texte non-string → actif seul", () => {
    expect(captureProjectBadgeNames(undefined, "Pilot", PROJECTS)).toEqual(["Pilot"]);
    expect(captureProjectBadgeNames(42, "Pilot", PROJECTS)).toEqual(["Pilot"]);
  });
  it("null retourne aussi un tableau (jamais undefined)", () => {
    const out = captureProjectBadgeNames("", null, []);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });
});

describe("extendBadgesWithText (bulle de réponse, chantier #15)", () => {
  it("réponse évoquant plusieurs projets → tous ajoutés après la base", () => {
    // Demande sans projet nommé → base = projet actif seul.
    const base = captureProjectBadgeNames("parles moi des projets que tu connais", "Pilot", PROJECTS);
    expect(base).toEqual(["Pilot"]);
    // La réponse évoque PLh et Site Vitrine → étendue.
    const extended = extendBadgesWithText(
      base,
      "Voici les projets : PLh et le site vitrine d'Acme.",
      PROJECTS
    );
    expect(extended).toEqual(["Pilot", "PLh", "Site Vitrine"]);
  });
  it("base en tête, ordre préservé, dédupliqué", () => {
    const extended = extendBadgesWithText(
      ["PLh", "Pilot"],
      "on parle de pilot et encore de plh",
      PROJECTS
    );
    expect(extended).toEqual(["PLh", "Pilot"]);
  });
  it("projet déjà dans la base → pas de doublon", () => {
    const extended = extendBadgesWithText(["Pilot"], "Pilot est en cours", PROJECTS);
    expect(extended).toEqual(["Pilot"]);
  });
  it("réponse sans projet nommé → base inchangée", () => {
    const extended = extendBadgesWithText(["Pilot"], "Rien de spécial à signaler.", PROJECTS);
    expect(extended).toEqual(["Pilot"]);
  });
  it("frontières de mots respectées dans la réponse", () => {
    const extended = extendBadgesWithText(["Pilot"], "le pilotage est complexe", PROJECTS);
    expect(extended).toEqual(["Pilot"]);
  });
  it("fail-open : base/text/projets invalides → jamais d'exception", () => {
    expect(extendBadgesWithText(null, "Pilot", PROJECTS)).toEqual(["Pilot"]);
    expect(extendBadgesWithText(["Pilot"], "", PROJECTS)).toEqual(["Pilot"]);
    expect(extendBadgesWithText(["Pilot"], "PLh", null)).toEqual(["Pilot"]);
    expect(extendBadgesWithText([], "PLh", PROJECTS)).toEqual(["PLh"]);
    expect(extendBadgesWithText(undefined, undefined, undefined)).toEqual([]);
  });
});