// GARDE-FOU — LE REFUS EN LECTURE SEULE DÉPEND DE LA DEMANDE, PAS DES MOTS.
//
// Défaut constaté en usage RÉEL (v0.4.39) : l'assistant confiait une mission à
// un agent marqué LECTURE SEULE et Pilot refusait de la lancer, en croyant que
// la mission demandait une écriture. Trois causes, toutes des MOTS et non des
// demandes :
//   2. un verbe d'écriture dans une phrase NÉGATIVE (« n'écrire aucun rapport ») ;
//   3. une consigne négative (« Ne modifier aucun fichier ») ;
//   4. une ÉTIQUETTE de verdict (« À CORRIGER ») et « relancer une correction ».
// (La cause 1 — un livrable réellement déclaré dans `expected_files` — est un
// refus LÉGITIME, conservé tel quel.)
//
// Les preuves ci-dessous sont de deux natures, et les deux comptent :
//  (1) ACCEPTATION : les quatre formulations réelles passent vers un agent en
//      lecture seule (aucun refus, aucun message) ;
//  (2) PROTECTION : une mission qui demande réellement d'écrire reste REFUSÉE,
//      avec le même message clair, et le module ne peut pas retomber sur un
//      simple repérage de mot (verrou de source).
import { describe, it, expect } from "vitest";

import {
  detectExplicitWriteRequest,
  readOnlyWriteRefusalMessage,
  findWriteOrder,
  splitSegments,
} from "./deliverable-guard.js";

const READ_ONLY = [{ id: "plan-maker", name: "Plan Maker", readonly: true }];

/** Refus (message) ou null pour une mission confiée au seul agent lecture seule. */
function refus(task, expectedFiles) {
  return readOnlyWriteRefusalMessage({ tool: "run_agents", agents: READ_ONLY, task, expectedFiles });
}

// Les quatre formulations RÉELLES, telles qu'elles ont été refusées à tort.
// Aucune ne déclare de livrable (la cause 1 est traitée à part).
const MISSIONS_REFUSEES_A_TORT = {
  "2. verbe d'écriture dans une phrase négative": [
    "Mission de LECTURE SEULE : relis src/js/deliverable-guard.js et dis-moi ce qui est faux.",
    "N'écrire aucun rapport sous .pilot/rapports/rapport-garde.md : ce fichier est le livrable du codeur, pas le tien.",
    "Tu rends ton avis dans la réponse, sans rien modifier.",
  ].join("\n"),
  "3. consigne négative « ne modifier aucun fichier »": [
    "Mission de LECTURE SEULE. Analyse src/js/super-agent.js et explique pourquoi le refus est faux.",
    "Ne modifier aucun fichier : ton avis suffit.",
    "Il ne faut pas écrire de rapport dans .pilot/rapports/rapport-analyse.md.",
  ].join("\n"),
  "4. étiquette de verdict « À CORRIGER »": [
    "Verdict attendu : À CORRIGER (src/js/super-agent.js).",
    "Explique le défaut constaté, sans relancer une correction toi-même.",
  ].join("\n"),
  "4 bis. libellé + « correction » dans la même phrase": [
    "Le point À CORRIGER porte sur src/js/main.js.",
    "Tu ne relances pas une correction toi-même : tu décris seulement le problème.",
  ].join("\n"),
  "apostrophe typographique (n’écrire)": [
    "Lis src/js/super-agent.js et rends ton avis.",
    "N’écrire aucun rapport dans .pilot/rapports/x.md.",
    "Ne modifier aucun fichier.",
  ].join("\n"),
};

describe("missions de LECTURE SEULE acceptées (aucun refus)", () => {
  for (const [nom, task] of Object.entries(MISSIONS_REFUSEES_A_TORT)) {
    it(`accepte : ${nom}`, () => {
      expect(detectExplicitWriteRequest(task).explicit, `refus indu : ${task}`).toBe(false);
      expect(refus(task), `refus indu : ${task}`).toBeNull();
    });
  }

  it("accepte une mission de lecture qui CITE un message de commit", () => {
    const task =
      "Lis le journal Git de src/js/main.js. Le message de commit était « ajoute le garde-fou » : explique s'il est correct.";
    expect(detectExplicitWriteRequest(task).explicit).toBe(false);
    expect(refus(task)).toBeNull();
  });

  it("accepte une mission dont le NOM DE FICHIER contient un verbe", () => {
    const task = "Lis le fichier corrige-guard.md et explique son contenu.";
    expect(detectExplicitWriteRequest(task).explicit).toBe(false);
    expect(refus(task)).toBeNull();
  });

  it("accepte une QUESTION sur une écriture future (« faut-il modifier… »)", () => {
    const task = "Dis-moi s'il faut modifier src/js/main.js pour ce défaut.";
    expect(detectExplicitWriteRequest(task).explicit).toBe(false);
    expect(refus(task)).toBeNull();
  });
});

describe("une vraie demande d'écriture est TOUJOURS refusée (garde-fou intact)", () => {
  const ORDRES = [
    "Modifie src/js/deliverable-guard.js pour appliquer le correctif.",
    "Écris le fichier docs/rapport.md.",
    "Corrige src/js/main.js puis relance les tests.",
    "- modifier src/js/main.js",
    "Il faut écrire le rapport docs/rapport.md.",
    "Merci de créer le fichier docs/rapport.md.",
    "N'oublie pas de créer docs/rapport.md.",
    "Write the file report.md at the root.",
  ];

  for (const task of ORDRES) {
    it(`refuse : ${task}`, () => {
      const detection = detectExplicitWriteRequest(task);
      expect(detection.explicit, `ordre non reconnu : ${task}`).toBe(true);
      expect(detection.verb).toBeTruthy();
      const msg = refus(task);
      expect(msg, `ordre non refusé : ${task}`).toBeTruthy();
      expect(msg).toContain("n'a PAS été lancée"); // rien n'a démarré
    });
  }

  it("refuse le livrable DÉCLARÉ (cause 1, comportement conservé tel quel)", () => {
    const msg = refus("Fais le nécessaire.", ["docs/rapport.md"]);
    expect(msg).toBeTruthy();
    expect(msg).toContain("docs/rapport.md");
    expect(detectExplicitWriteRequest("Fais le nécessaire.", { expectedFiles: ["docs/rapport.md"] }).via).toBe(
      "expected_files"
    );
  });

  it("le message de refus reste clair : agent, raison, sortie", () => {
    const msg = refus("Modifie src/js/main.js.");
    expect(msg).toContain("Plan Maker"); // quel agent
    expect(msg).toContain("LECTURE SEULE"); // pourquoi
    expect(msg).toContain("aucun fichier"); // ce que le rôle fait
    expect(msg).toContain("agent qui écrit"); // quoi faire
    expect(msg).toContain("reformulez la demande comme une tâche de lecture"); // sortie
  });

  it("n'est jamais permissif sur une demande mixte de lecture ET d'écriture", () => {
    const task = "Relis src/js/main.js et ne modifie pas le code, puis écris le fichier docs/rapport.md.";
    const detection = detectExplicitWriteRequest(task);
    expect(detection.explicit).toBe(true);
    expect(detection.target).toContain("docs/rapport.md");
    expect(refus(task)).toBeTruthy();
  });

  it("n'empêche jamais une mission mixte (un agent qui écrit est présent)", () => {
    const msg = readOnlyWriteRefusalMessage({
      tool: "run_agents",
      agents: [...READ_ONLY, { id: "codeur", name: "Codeur", readonly: false }],
      task: "Modifie src/js/main.js.",
    });
    expect(msg).toBeNull();
  });
});

describe("analyse : ce qui fait un ORDRE (et ce qui n'en fait pas)", () => {
  it("findWriteOrder ne retient que les formes d'ordre", () => {
    expect(findWriteOrder("modifie src/js/main")).toBe("modifie");
    expect(findWriteOrder("il faut modifier src/js/main")).toBe("modifier");
    expect(findWriteOrder("modifier src/js/main")).toBe("modifier"); // tête de proposition
    expect(findWriteOrder("a corriger")).toBeNull(); // étiquette
    expect(findWriteOrder("une correction a ete relancee")).toBeNull(); // nom
    expect(findWriteOrder("le fichier a été modifié")).toBeNull(); // participe
    expect(findWriteOrder("il modifie src/js/main")).toBeNull(); // description
  });

  it("l'ordre et sa cible doivent être dans la MÊME proposition", () => {
    const segments = splitSegments("Verdict : à corriger. Le fichier est docs/rapport.md.");
    expect(segments.length).toBe(2);
    // Verbe dans une proposition, cible dans une autre : ce n'est pas une demande.
    expect(detectExplicitWriteRequest("Le fichier est docs/rapport.md.\nUne correction a ete relancee.").explicit).toBe(
      false
    );
  });

  it("un chemin de fichier n'est pas coupé par le point de l'extension", () => {
    expect(splitSegments("Modifie src/js/main.js pour corriger.")).toHaveLength(1);
    expect(detectExplicitWriteRequest("Modifie src/js/main.js.").target).toBe("src/js/main.js");
  });

  it("un ordre d'écriture SANS cible de fichier reste ambigu → pas de refus", () => {
    const detection = detectExplicitWriteRequest("Écris un plan d'organisation en trois étapes.");
    expect(detection.explicit).toBe(false);
    expect(detection.verb).toBe("écris");
  });
});

describe("verrou de source : le refus ne peut pas retomber sur un simple mot", () => {
  it("la décision passe par findWriteOrder (aucune décision sur un verbe isolé)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    // Fins de ligne normalisées (piège CI Windows, cf. quality-gate § 3.4).
    const source = readFileSync(resolve(here, "deliverable-guard.js"), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("export function detectExplicitWriteRequest");
    expect(start, "détection introuvable").toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("export function readOnlyWriteRefusalMessage", start));
    expect(body).toContain("findWriteOrder(");
    expect(body).toContain("stripNegations(");
    expect(body).toContain("stripLabels(");
    // Le simple repérage de mot (WRITE_VERB_RE) ne sert QUE de trace, jamais de décision :
    // un `if (WRITE_VERB_RE...)` ou un `.match(WRITE_VERB_RE)` retourné serait un retour au défaut.
    expect(body).not.toContain("if (WRITE_VERB_RE");
    expect(body).not.toContain("return { explicit: true, verb: any");
  });
});
