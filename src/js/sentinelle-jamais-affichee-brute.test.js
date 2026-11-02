// sentinelle-jamais-affichee-brute.test.js
//
// RÈGLE PROTÉGÉE (propriétaire, 2026-11) — « une sentinelle machine ne s'affiche
// JAMAIS brute » : les chaînes `PILOT_<FAMILLE>::<charge utile>` sont des appels
// de fonction internes entre une extension et Pilot. Affichées telles quelles,
// elles produisent une « demande de confirmation » incompréhensible avec deux
// boutons Valider / Annuler.
//
// Défaut observé (poste utilisateur) : le relais des questions d'agents peignait
// `PILOT_ASSISTANT_SCHEDULE::{"op":"list"}` venu d'un agent de l'assistant.
// Rapport : docs/rapports/RAPPORT-sentinelle-brute-confirmation.md
//
// Ces tests ÉCHOUENT si :
//   1. la traduction d'une sentinelle connue (planification) régresse ;
//   2. une sentinelle inconnue peut traverser le filet de sécurité ;
//   3. une question LÉGITIME d'agent est réécrite (aucune régression du relais) ;
//   4. un écran redevient capable de peindre un titre brut (desktop : session de
//      l'assistant, onglet chat, relais, barre des questions en attente) ;
//   5. le canal WEB DISTANT se dote d'un affichage de question d'extension sans
//      le filet de sécurité (il n'en affiche aucun aujourd'hui).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  MACHINE_SENTINEL_RE,
  isSelfAnsweredMachineRequest,
  NEUTRAL_SENTENCE,
  SCHEDULE_SENTENCES,
  SCHEDULE_SENTINEL,
  hasMachineSentinel,
  isAssistantSentinel,
  machineSentinelOf,
  readableMachineText,
  readableQuestion,
  scheduleRequestFrom,
  scheduleSentence,
} from "./machine-sentinel.js";
import { agentQuestionLabel } from "./agent-choice-relay.js";
// Découpage de source VÉRIFIÉ (3ᵉ audit, point 4) : une ancre absente LÈVE une
// erreur au lieu de produire un fragment vide qui rendrait l'assertion vraie
// par construction. Aucun `slice(indexOf(...))` à la main dans ce fichier.
import { sliceSource } from "./source-slice.js";

const ROOT = resolve(process.cwd());
// Lecture normalisée : un worktree Windows en CRLF (runner `windows-latest`,
// `core.autocrlf=true`) ne doit pas faire échouer les ancres multi-lignes.
const src = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** Corps d'une fonction (en-tête inclus), découpe VÉRIFIÉE : ancre absente ou
 *  fragment trop court ⇒ le test échoue bruyamment. */
function corpsDeFonction(code, entete, fin = "\n}\n", minLen = 80) {
  return sliceSource(code, entete, fin, minLen);
}

/** Vrai si le texte contient encore une trace machine affichable. */
function leaksMachineText(text) {
  return (
    MACHINE_SENTINEL_RE.test(text) || // « PILOT_XXX:: »
    text.includes("::") ||
    /[{}"]/.test(text) // JSON visible
  );
}

describe("filet de sécurité des sentinelles machine — traduction", () => {
  it("la chaîne observée devient une phrase française compréhensible", () => {
    const raw = 'PILOT_ASSISTANT_SCHEDULE::{"op":"list"}';
    const clean = readableMachineText(raw);

    expect(scheduleRequestFrom(raw)).toEqual({ op: "list" });
    expect(clean).toBe(SCHEDULE_SENTENCES.list);
    expect(clean).toBe("Je vais relever la liste de mes rappels programmés. Je continue ?");
    expect(leaksMachineText(clean)).toBe(false);
  });

  it("chaque opération de planification a sa phrase, sans identifiant machine", () => {
    for (const op of ["create", "delete", "set_enabled", "autre-inconnue"]) {
      const clean = readableMachineText(`${SCHEDULE_SENTINEL}{"op":"${op}"}`);
      expect(clean.length).toBeGreaterThan(20);
      expect(clean.endsWith("Je continue ?")).toBe(true);
      expect(leaksMachineText(clean)).toBe(false);
    }
    // Les quatre phrases sont distinctes : l'utilisateur sait ce qui va se passer.
    const uniques = new Set([
      SCHEDULE_SENTENCES.create,
      SCHEDULE_SENTENCES.delete,
      SCHEDULE_SENTENCES.set_enabled,
      SCHEDULE_SENTENCES.list,
    ]);
    expect(uniques.size).toBe(4);
    expect(scheduleSentence({ op: "inconnue" })).toBe(SCHEDULE_SENTENCES.other);
    expect(scheduleSentence(null)).toBe(SCHEDULE_SENTENCES.other);
  });

  it("une sentinelle de famille INCONNUE ne fuit jamais : formulation neutre", () => {
    const clean = readableMachineText('PILOT_TOUT_NOUVEAU_MOTEUR::{"op":"x"}');
    expect(clean).toBe(NEUTRAL_SENTENCE);
    expect(leaksMachineText(clean)).toBe(false);
    // Aucune promesse fausse : c'est une question, l'utilisateur peut refuser.
    expect(clean.endsWith("Je continue ?")).toBe(true);
  });

  it("un texte légitime sans sentinelle n'est JAMAIS réécrit", () => {
    const question = "Dois-je envoyer le rapport à Sophie ou attendre lundi ?";
    expect(hasMachineSentinel(question)).toBe(false);
    expect(readableMachineText(question)).toBe(question);
    // Les questions du relais passent intactes, y compris avec des accolades.
    expect(readableMachineText("Choisir {a} ou {b} ?")).toBe("Choisir {a} ou {b} ?");
    // Entrées non-chaînes : chaîne vide, jamais « undefined » à l'écran.
    expect(readableMachineText(null)).toBe("");
    expect(readableMachineText(undefined)).toBe("");
  });

  it("le texte placé AVANT la sentinelle est conservé", () => {
    const clean = readableMachineText('Je vais faire le point.\nPILOT_ASSISTANT_SCHEDULE::{"op":"list"}');
    expect(clean.startsWith("Je vais faire le point.")).toBe(true);
    expect(clean).toContain(SCHEDULE_SENTENCES.list);
    expect(leaksMachineText(clean)).toBe(false);
  });

  it("une sentinelle de PRÉSENTATION garde la question de son auteur", () => {
    const raw = 'PILOT_CONFIRM::{"title":"Envoyer le devis ?","message":"Client Dupont"}';
    expect(readableMachineText(raw)).toBe("Envoyer le devis ?");
  });

  it("readableQuestion nettoie le couple titre + message d'une demande", () => {
    const q = readableQuestion({
      title: 'PILOT_ASSISTANT_SCHEDULE::{"op":"delete"}',
      message: 'PILOT_PROPOSAL::{"payload":1}',
    });
    expect(q.title).toBe(SCHEDULE_SENTENCES.delete);
    expect(q.message).toBe(NEUTRAL_SENTENCE);
    expect(leaksMachineText(q.title + q.message)).toBe(false);
    // Une question normale traverse intacte.
    const keep = readableQuestion({ title: "Quel modèle ?", message: "Deux choix possibles." });
    expect(keep).toEqual({ title: "Quel modèle ?", message: "Deux choix possibles." });
  });

  it("machineSentinelOf / isAssistantSentinel décrivent la sentinelle", () => {
    const found = machineSentinelOf('ok PILOT_ASSISTANT_DB_QUERY::{"sql":"x"}');
    expect(found.name).toBe("PILOT_ASSISTANT_DB_QUERY::");
    expect(found.payload).toBe('{"sql":"x"}');
    expect(machineSentinelOf("rien à signaler")).toBe(null);
    expect(isAssistantSentinel("PILOT_ASSISTANT_TOOLS::x")).toBe(true);
    expect(isAssistantSentinel("PILOT_EDIT_GATE::x")).toBe(false);
    // Un JSON illisible ne lève pas : il ne produit aucune demande.
    expect(scheduleRequestFrom(`${SCHEDULE_SENTINEL}{pas du json`)).toBe(null);
    expect(scheduleRequestFrom("PILOT_ASSISTANT_SCHEDULE")).toBe(null);
  });
});

describe("filet de sécurité des sentinelles machine — libellé d'alerte", () => {
  it("le message « l'agent attend votre réponse » ne recopie pas la sentinelle", () => {
    const label = agentQuestionLabel({
      method: "input",
      title: 'PILOT_ASSISTANT_SCHEDULE::{"op":"list"}',
    });
    expect(leaksMachineText(label)).toBe(false);
    expect(label).toBe(SCHEDULE_SENTENCES.list);
  });

  it("une action interne exécutée sans l'utilisateur ne réclame pas de réponse", () => {
    // Le message d'attente du bus ne doit pas prétendre qu'une réponse est
    // attendue quand le relais exécute l'action lui-même.
    expect(
      isSelfAnsweredMachineRequest({
        method: "input",
        title: 'PILOT_ASSISTANT_SCHEDULE::{"op":"list"}',
      }),
    ).toBe(true);
    // Une question réelle reste une question.
    expect(isSelfAnsweredMachineRequest({ method: "input", title: "Quel client ?" })).toBe(false);
    expect(
      isSelfAnsweredMachineRequest({ method: "confirm", title: "PILOT_ASSISTANT_SCHEDULE::x" }),
    ).toBe(false);
    const bus = src("src/js/agents-bus.js");
    expect(bus).toContain("isSelfAnsweredMachineRequest");
    expect(bus).toContain("aucune réponse de votre part n'est attendue");
  });

  it("une sentinelle inconnue devient neutre, une question normale reste intacte", () => {
    expect(
      agentQuestionLabel({ method: "input", title: 'PILOT_ASSISTANT_MEMORY::{"k":"v"}' }),
    ).toBe(NEUTRAL_SENTENCE);
    expect(agentQuestionLabel({ method: "input", title: "Quel nom pour le client ?" })).toBe(
      "Quel nom pour le client ?",
    );
  });
});

describe("filet de sécurité des sentinelles machine — écran desktop", () => {
  it("les trois rendus de la session Assistant nettoient ce qu'ils peignent", () => {
    const code = src("src/js/super-agent.js");
    // Chaque fonction de rendu applique le filet AVANT de peindre (titre seul,
    // ou titre + message). Ancre volontairement locale à la fonction.
    const renders = [
      ["function renderSuperAgentChoice(", 1],
      ["function renderSuperAgentConfirm(", 2],
      ["function renderSuperAgentInput(", 1],
    ];
    for (const [anchor, expected] of renders) {
      const body = corpsDeFonction(code, anchor);
      const uses = body.split("readableMachineText(").length - 1;
      expect(uses, `${anchor} doit nettoyer ${expected} texte(s)`).toBe(expected);
    }
    // Les trois barres de #pendingBar peignent `q.title` : elles appliquent le
    // filet au dernier moment (une question mise en file avant la correction
    // ne peut plus s'afficher brute).
    for (const bar of [
      "function renderChoicePendingBar(",
      "function renderConfirmPendingBar(",
      "function renderInputPendingBar(",
    ]) {
      const body = corpsDeFonction(code, bar);
      expect(body).toContain("q.title");
      expect(body).toContain("readableMachineText(");
    }
  });

  it("le relais EXÉCUTE la planification au lieu de l'afficher", () => {
    const code = src("src/js/super-agent.js");
    const body = corpsDeFonction(
      code,
      "async function relayAgentChoiceRequest(",
      "\nasync function ",
      500,
    );
    // La sentinelle de planification est traitée par le point unique d'exécution,
    // PUIS la réponse part vers la session agent — avant tout rendu.
    expect(body).toContain("SCHEDULE_SENTINEL");
    expect(body).toContain("runSuperAgentScheduleOp");
    const guardAt = body.indexOf("SCHEDULE_SENTINEL");
    const renderAt = body.indexOf("renderSuperAgentInput(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(renderAt);
    // Une autre sentinelle de l'assistant reçoit une réponse explicite en
    // français : jamais un formulaire technique, jamais un silence.
    expect(body).toContain("isAssistantSentinel");
    expect(body).toContain("ne peut pas être exécutée depuis la session d'un agent");
  });

  it("le point unique d'exécution de la planification existe et sert les deux canaux", () => {
    const code = src("src/js/super-agent.js");
    expect(code).toContain("async function runSuperAgentScheduleOp(req)");
    // Appelé par la session de l'assistant ET par le relais : un seul mécanisme.
    const calls = code.split("runSuperAgentScheduleOp(").length - 1;
    expect(calls).toBeGreaterThanOrEqual(3); // définition + 2 appels
  });

  it("l'onglet chat (agent-pi) nettoie aussi ses trois rendus", () => {
    const code = src("src/js/agent-pi.js");
    for (const anchor of [
      "function renderInlineChoice(",
      "function renderInlineConfirm(",
      "function renderInlineInput(",
    ]) {
      const body = corpsDeFonction(code, anchor);
      expect(body).toContain("readableMachineText(");
    }
  });

  it("aucun écran ne peint un titre d'extension sans passer par le filet", () => {
    // Garde structurelle : les appelants qui peignent `payload.title` le font
    // dans une fonction de rendu protégée (vérifié ci-dessus). On interdit en
    // plus toute NOUVELLE fonction de rendu de question qui l'ignorerait.
    // Seules exceptions : les rendus qui peignent un texte PRODUIT PAR PILOT
    // (jamais une demande d'extension) — aucun canal ne peut y injecter une
    // sentinelle. Toute nouvelle fonction de rendu de question doit, elle,
    // passer par le filet.
    const ALLOWED_WITHOUT_GUARD = new Set([
      "renderLocalChoice", // choix proposés par Pilot (modèle, session…)
      "renderLoopAbandonChoices", // arrêt de boucle décidé par Pilot (issue #37)
    ]);
    const files = ["src/js/super-agent.js", "src/js/agent-pi.js"];
    for (const rel of files) {
      const code = src(rel);
      const offenders = [];
      for (const m of code.matchAll(/function (render\w*(?:Choice|Confirm|Input)\w*)\(/g)) {
        if (ALLOWED_WITHOUT_GUARD.has(m[1])) continue;
        const body = corpsDeFonction(code, m[0]);
        if (!body.includes("readableMachineText(")) offenders.push(m[1]);
      }
      expect(offenders, `${rel} : rendu(s) sans filet de sécurité`).toEqual([]);
    }
  });
});

describe("filet de sécurité des sentinelles machine — canal web distant", () => {
  it("le web distant n'affiche aucune question d'extension brute (ou applique le filet)", () => {
    const webDir = join(ROOT, "web", "js");
    const webFiles = existsSync(webDir)
      ? readdirSync(webDir)
          .filter((f) => f.endsWith(".js"))
          .map((f) => `web/js/${f}`)
      : [];
    const rustFiles = ["src-tauri/src/web_server.rs", "src-tauri/src/web_commands.rs"].filter((f) =>
      existsSync(join(ROOT, f)),
    );
    const scanned = [...webFiles, ...rustFiles];
    expect(scanned.length).toBeGreaterThan(0);

    for (const rel of scanned) {
      const code = src(rel);
      // Aucun de ces fichiers ne doit PEINDRE une sentinelle : s'il se met un
      // jour à transmettre une question d'extension au navigateur, il doit
      // passer par le filet (import/mention de machine-sentinel.js).
      const handlesQuestions = /extension_ui_request|extension_ui_response/.test(code);
      if (!handlesQuestions) continue;
      expect(
        /machine-sentinel|readableMachineText|readableQuestion/.test(code),
        `${rel} transmet des questions d'extension sans le filet machine-sentinel.js`,
      ).toBe(true);
    }
  });

  it("la règle est exportée depuis un module partagé, pas recopiée dans le web", () => {
    // SOURCE UNIQUE : le fichier est servi/embarqué par le socle pour que le web
    // distant ne puisse pas en avoir une seconde copie divergente.
    expect(existsSync(join(ROOT, "src/js/machine-sentinel.js"))).toBe(true);
    const webFiles = existsSync(join(ROOT, "web", "js"))
      ? readdirSync(join(ROOT, "web", "js")).filter((f) => f.endsWith(".js"))
      : [];
    for (const f of webFiles) {
      expect(src(`web/js/${f}`)).not.toContain("PILOT_ASSISTANT_SCHEDULE::");
    }
  });
});
