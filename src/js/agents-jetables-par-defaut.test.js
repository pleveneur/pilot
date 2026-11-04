// Tests — RÈGLE « AGENT JETABLE PAR DÉFAUT » (décision du propriétaire).
//
// Ce que ce fichier verrouille, et qui doit FAIRE ÉCHOUER la suite si l'un de
// ces points disparaît :
//   1. la règle existe EN CLAIR, à UN SEUL endroit
//      (`src/js/agent-lifespan-rule.js`) : besoin ponctuel → agent JETABLE
//      (`agents` de `run_agents` / `run_assistant_agents`, aucune écriture en
//      base) ; `create_agent` RÉSERVÉ aux rôles DURABLES ; l'Assistant ne peut
//      pas supprimer une entrée du registre, donc jamais de création dans le
//      doute ;
//   2. la décision « jetable / permanent » est PURE et testable
//      (`decideAgentKind`) : le doute joue toujours en faveur du jetable ;
//   3. l'extension pi (`pilot-assistant-actions.ts`) CITE la source unique — elle
//      ne recopie pas une seconde formulation, et ne pousse plus à créer un
//      agent permanent (« Use create_agent when the available agents do not fit
//      the task » a disparu) ;
//   4. le PROMPT SYSTÈME de l'Assistant l'injecte réellement (`super_agent.rs`) :
//      source embarquée par `include_str!`, bloc poussé dans l'assemblage, et
//      aucune autre phrase du prompt ne pousse à créer un agent permanent ;
//   5. le module est écrit SUR DISQUE à côté des extensions
//      (`agent_service.rs`), sans quoi `pilot-assistant-actions.ts` ne se
//      chargerait plus (import `./agent-lifespan-rule.js`).
//   6. la consigne ne peut pas REDEVENIR AMBIGUË : `findAmbiguousLifespanWording`
//      (pure, dans la source unique) refuse les formulations qui laissent croire
//      qu'un agent permanent est acceptable par défaut — et ce refus est
//      lui-même éprouvé sur des variantes fautives (test de mutation).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_LIFESPAN_RULE,
  AGENT_LIFESPAN_RULE_GUIDELINE,
  AGENT_LIFESPAN_RULE_SNIPPET,
  AMBIGUOUS_LIFESPAN_MARKERS,
  decideAgentKind,
  findAmbiguousLifespanWording,
} from "./agent-lifespan-rule.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fin de lignes normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

const SOURCE = read("src/js/agent-lifespan-rule.js");
const EXTENSION = read("src-tauri/extensions/pilot-assistant-actions.ts");
const PROMPT = read("src-tauri/src/super_agent.rs");
const AGENT_SERVICE = read("src-tauri/src/agent_service.rs");

/** Le bloc « Outils d'agents » du prompt système (une seule ligne du source). */
const TOOLS_PROMPT =
  PROMPT.split("\n").find((line) => line.includes("## Outils d'agents")) || "";

/**
 * Le passage du mode coordinateur qui parle de la création d'agents : c'est LÀ
 * que l'ancienne consigne poussait à créer un agent permanent.
 */
const COORDINATOR_PROMPT =
  PROMPT.split("\n").find((line) => line.includes("applique la règle des agents")) ||
  "";

/** La description de l'outil `create_agent` (jusqu'au `registerTool` suivant). */
function extensionToolBlock(name) {
  const start = EXTENSION.indexOf(`name: "${name}"`);
  if (start < 0) return "";
  const rest = EXTENSION.slice(start);
  const next = rest.indexOf("pi.registerTool(", 1);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("règle « agent jetable par défaut » — la source unique", () => {
  it("dit les trois règles en clair : jetable, durable, jamais dans le doute", () => {
    // (1) besoin ponctuel → agent jetable décrit dans la demande.
    expect(AGENT_LIFESPAN_RULE).toContain("PONCTUEL");
    expect(AGENT_LIFESPAN_RULE).toContain("AGENT JETABLE");
    expect(AGENT_LIFESPAN_RULE).toContain("Rien n'est écrit dans le registre");
    // (2) create_agent réservé aux rôles durables.
    expect(AGENT_LIFESPAN_RULE).toContain(
      "create_agent est RÉSERVÉ aux rôles DURABLES",
    );
    expect(AGENT_LIFESPAN_RULE).toContain(
      "n'est PAS une raison suffisante pour créer un agent permanent",
    );
    // (3) l'Assistant ne supprime jamais une entrée : donc rien dans le doute.
    expect(AGENT_LIFESPAN_RULE).toContain(
      "tu ne peux jamais supprimer une entrée du registre",
    );
    expect(AGENT_LIFESPAN_RULE).toContain("ne crée RIEN");
  });

  it("reste extractible par Rust : une seule déclaration, aucun accent grave ni ${", () => {
    // Contrat avec `super_agent.rs` (AGENT_LIFESPAN_RULE_OPEN / _CLOSE) : le
    // texte vit dans un gabarit de chaîne, donc il ne peut contenir ni accent
    // grave ni interpolation. Deux déclarations rendraient l'extraction
    // ambiguë.
    const declarations = SOURCE.split("export const AGENT_LIFESPAN_RULE = `").length - 1;
    expect(declarations).toBe(1);
    expect(AGENT_LIFESPAN_RULE).not.toContain("`");
    expect(AGENT_LIFESPAN_RULE).not.toContain("${");
    // Fermeture du gabarit présente (l'ancre de fin de l'extraction Rust).
    expect(SOURCE).toContain("`;");
  });

  it("donne une consigne d'outil et un résumé non vides (citations du même module)", () => {
    expect(AGENT_LIFESPAN_RULE_GUIDELINE).toContain("THROWAWAY AGENT");
    expect(AGENT_LIFESPAN_RULE_GUIDELINE).toContain("DURABLE");
    expect(AGENT_LIFESPAN_RULE_SNIPPET).toContain("jetable par défaut");
  });
});

describe("règle « agent jetable par défaut » — la décision est pure", () => {
  it("le doute joue TOUJOURS en faveur du jetable", () => {
    expect(decideAgentKind()).toBe("throwaway");
    expect(decideAgentKind({})).toBe("throwaway");
    expect(decideAgentKind({ durable: false })).toBe("throwaway");
    expect(decideAgentKind({ durable: "oui" })).toBe("throwaway");
    expect(decideAgentKind(null)).toBe("throwaway");
  });

  it("seul un besoin explicitement durable autorise une entrée permanente", () => {
    expect(decideAgentKind({ durable: true })).toBe("create_agent");
  });
});

describe("règle « agent jetable par défaut » — l'extension pi la CITE", () => {
  it("importe le module partagé (aucune seconde formulation)", () => {
    expect(EXTENSION).toContain('from "./agent-lifespan-rule.js"');
    expect(EXTENSION).toContain("AGENT_LIFESPAN_RULE_GUIDELINE");
  });

  it("ne recopie pas le texte de la règle (source unique respectée)", () => {
    expect(EXTENSION).not.toContain(
      "create_agent est RÉSERVÉ aux rôles DURABLES",
    );
    expect(EXTENSION).not.toContain("tu ne peux jamais supprimer");
  });

  it("réserve create_agent aux rôles durables et nomme l'agent jetable", () => {
    expect(EXTENSION).toContain("Créer un agent DURABLE");
    expect(EXTENSION).toContain("agent JETABLE via `agents`");
    // L'ancienne consigne poussait explicitement à créer un agent permanent.
    expect(EXTENSION).not.toContain(
      "Use create_agent when the available agents do not fit the task",
    );
    expect(EXTENSION).not.toContain(
      "quand les agents disponibles ne conviennent pas à la tâche",
    );
  });
});

describe("règle « agent jetable par défaut » — le prompt système l'injecte", () => {
  it("embarque la source unique et pousse son bloc dans l'assemblage", () => {
    expect(PROMPT).toContain(
      'include_str!("../../src/js/agent-lifespan-rule.js")',
    );
    expect(PROMPT).toContain("fn extract_agent_lifespan_rule");
    expect(PROMPT).toContain("full_system.push_str(&agent_lifespan_rule_prompt());");
    // Le bloc est mesuré par le garde-fou anti-regonflement et par le test qui
    // exige que le prompt soit EXACTEMENT la somme de ses textes fixes.
    const mesures = PROMPT.split("agent_lifespan_rule_prompt()").length - 1;
    expect(mesures).toBeGreaterThanOrEqual(4);
  });

  it("ne laisse AUCUN texte pousser à créer un agent permanent dans le doute", () => {
    expect(PROMPT).not.toContain("crée-le d'abord avec `create_agent`");
    expect(PROMPT).not.toContain("agent sur mesure si nécessaire");
    expect(PROMPT).toContain("RÉSERVÉ aux rôles DURABLES");
    // Le mode coordinateur renvoie à la règle, il ne crée plus d'agent.
    expect(PROMPT).toContain("applique la règle des agents");
  });

  it("écrit le module sur disque à côté des extensions (sinon l'import casse)", () => {
    expect(AGENT_SERVICE).toContain("fn write_agent_lifespan_rule");
    expect(AGENT_SERVICE).toContain('dir.join("agent-lifespan-rule.js")');
    // Les DEUX chemins d'écriture des extensions de l'Assistant (agents
    // d'assistant et session de l'Assistant) doivent l'écrire.
    const ecritures = AGENT_SERVICE.split("Self::write_agent_lifespan_rule(&dir)").length - 1;
    expect(ecritures).toBeGreaterThanOrEqual(2);
  });
});

describe("règle « agent jetable par défaut » — le verrou a des dents", () => {
  it("reconnaît une formulation qui rend le permanent acceptable par défaut", () => {
    // Ces variantes sont EXACTEMENT celles qui ont produit l'incident (un agent
    // permanent créé pour un diagnostic ponctuel).
    const fautes = [
      "Tu disposes aussi de create_agent (agent sur mesure si nécessaire).",
      "Si aucun agent ne convient, crée-le d'abord avec create_agent.",
      "Utilise create_agent quand les agents disponibles ne conviennent pas.",
      "Use create_agent when the available agents do not fit the task.",
      "Crée un agent au besoin.",
      "Create an agent if needed.",
    ];
    for (const faute of fautes) {
      expect(findAmbiguousLifespanWording(faute)).not.toEqual([]);
    }
  });

  it("n'est pas trompé par la casse, les accents ni les espaces", () => {
    expect(findAmbiguousLifespanWording("AGENT SUR MESURE SI NÉCESSAIRE")).not.toEqual(
      [],
    );
    expect(findAmbiguousLifespanWording("si   necessaire")).not.toEqual([]);
  });

  it("ne signale PAS une consigne qui déconseille la création", () => {
    // Les formulations correctes citent le permanent pour l'ÉCARTER : elles ne
    // doivent jamais être prises pour une ambiguïté (sinon le verrou serait
    // inutilisable et on le désactiverait).
    expect(
      findAmbiguousLifespanWording(
        "« Aucun agent du registre ne convient » n'est PAS une raison suffisante pour créer un agent permanent.",
      ),
    ).toEqual([]);
    expect(
      findAmbiguousLifespanWording(
        "Dans le doute, ne crée RIEN : tu ne peux jamais supprimer une entrée du registre.",
      ),
    ).toEqual([]);
    expect(findAmbiguousLifespanWording("")).toEqual([]);
  });

  it("laisse les textes RÉELS du dépôt sans ambiguïté", () => {
    // Si l'un de ces contrôles casse, c'est la consigne qui est redevenue
    // ambiguë : la règle dit « un besoin ponctuel → un agent jetable » sans
    // jamais présenter le permanent comme le réflexe par défaut.
    expect(AMBIGUOUS_LIFESPAN_MARKERS.length).toBeGreaterThan(5);
    expect(findAmbiguousLifespanWording(AGENT_LIFESPAN_RULE)).toEqual([]);
    expect(findAmbiguousLifespanWording(AGENT_LIFESPAN_RULE_GUIDELINE)).toEqual([]);
    expect(findAmbiguousLifespanWording(AGENT_LIFESPAN_RULE_SNIPPET)).toEqual([]);
    expect(findAmbiguousLifespanWording(extensionToolBlock("create_agent"))).toEqual(
      [],
    );
    expect(findAmbiguousLifespanWording(extensionToolBlock("run_agents"))).toEqual([]);
    expect(
      findAmbiguousLifespanWording(extensionToolBlock("run_assistant_agents")),
    ).toEqual([]);
    expect(findAmbiguousLifespanWording(TOOLS_PROMPT)).toEqual([]);
    expect(findAmbiguousLifespanWording(COORDINATOR_PROMPT)).toEqual([]);
    // Les blocs réellement contrôlés ne sont pas vides (sinon on ne testerait
    // rien).
    expect(extensionToolBlock("create_agent")).toContain("create_agent");
    expect(TOOLS_PROMPT).toContain("Outils d'agents");
    expect(COORDINATOR_PROMPT).toContain("règle des agents");
  });

  it("dit qu'un agent jetable naît à la volée et n'est JAMAIS dans la liste", () => {
    expect(AGENT_LIFESPAN_RULE).toContain("créé à la volée");
    expect(AGENT_LIFESPAN_RULE).toContain("pour la seule durée de la tâche");
    expect(AGENT_LIFESPAN_RULE).toContain(
      "l'agent n'apparaît PAS dans la liste des agents du propriétaire",
    );
    // La consigne d'outil dit la même chose (une seule formulation, citée).
    expect(AGENT_LIFESPAN_RULE_GUIDELINE).toContain("DEFAULT IS A THROWAWAY AGENT");
    expect(AGENT_LIFESPAN_RULE_GUIDELINE).toContain(
      "it never appears in the owner's agent list",
    );
    expect(AGENT_LIFESPAN_RULE_GUIDELINE).toContain("ONLY for a DURABLE role");
  });
});
