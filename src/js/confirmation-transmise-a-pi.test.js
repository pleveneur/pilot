/**
 * CONFIRMATION TRANSMISE À PI — verrou du champ `confirmed` À LA RACINE.
 *
 * Défaut réel constaté en vérifiant la garde des commandes destructrices : dans
 * pi 1.6.0 (`dist/modes/rpc/rpc-mode.js`), une demande `confirm` n'est résolue
 * QUE par ce champ :
 *
 *   confirm: (…) => … (r) => "cancelled" in r && r.cancelled ? false
 *                                     : "confirmed" in r ? r.confirmed : false
 *
 * `value` n'est lu que par `select` et `input`. Or les trois transports de
 * réponse de Pilot envoyaient la confirmation sous forme de `value`
 * (`{"confirmed":…}`) SANS ce champ à la racine : l'accord de l'utilisateur
 * était relu comme un REFUS. Une garde qui refuse tout, même acceptée, n'est pas
 * une garde : elle bloque l'usage courant sans rien dire.
 *
 * Ce fichier tient les deux moitiés :
 *  - la DÉCISION (pure) : `agentAnswerConfirmedRoot` ;
 *  - la LIAISON : les trois transports de réponse de Pilot posent le champ, et
 *    aucun ne code une réponse en dur.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  agentAnswerConfirmedRoot,
  agentQuestionAnswer,
  agentQuestionView,
} from "./agent-question-surface.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (nom) => readFileSync(join(ICI, nom), "utf8").replace(/\r\n/g, "\n");

/** Corps d'une fonction nommée (jusqu'à l'accolade fermante en colonne 0). */
function corpsDe(source, signature) {
  const debut = source.indexOf(signature);
  expect(debut, `fonction absente : ${signature}`).toBeGreaterThan(-1);
  const fin = source.indexOf("\n}\n", debut);
  expect(fin, `corps non délimité : ${signature}`).toBeGreaterThan(debut);
  return source.slice(debut, fin);
}

describe("décision pure : `confirmed` à la racine", () => {
  it("lit la réponse d'une confirmation, dans les deux sens", () => {
    expect(agentAnswerConfirmedRoot(JSON.stringify({ confirmed: true, note: "" }))).toBe(true);
    expect(agentAnswerConfirmedRoot(JSON.stringify({ confirmed: false, note: "non" }))).toBe(false);
  });

  it("ne touche pas les autres formes de réponse (sélection, saisie, texte)", () => {
    expect(agentAnswerConfirmedRoot(JSON.stringify({ selected: "A", note: "" }))).toBe(null);
    expect(agentAnswerConfirmedRoot(JSON.stringify({ selected: ["A"], note: "" }))).toBe(null);
    expect(agentAnswerConfirmedRoot("projet-test")).toBe(null);
    expect(agentAnswerConfirmedRoot("oui")).toBe(null);
    expect(agentAnswerConfirmedRoot("")).toBe(null);
    expect(agentAnswerConfirmedRoot("{illisible")).toBe(null);
    expect(agentAnswerConfirmedRoot("[true]")).toBe(null);
    expect(agentAnswerConfirmedRoot(JSON.stringify({ confirmed: "oui" }))).toBe(null);
    expect(agentAnswerConfirmedRoot(undefined)).toBe(null);
    expect(agentAnswerConfirmedRoot(null)).toBe(null);
    expect(agentAnswerConfirmedRoot(true)).toBe(null);
  });

  it("la réponse d'une confirmation porte la décision (bout en bout, pure)", () => {
    const vue = agentQuestionView({ method: "confirm", title: "Commande dangereuse", message: "…" });
    const accepte = agentQuestionAnswer(vue, true);
    const refuse = agentQuestionAnswer(vue, false);
    expect(agentAnswerConfirmedRoot(accepte.value)).toBe(true);
    expect(agentAnswerConfirmedRoot(refuse.value)).toBe(false);
    // Annulation : aucun `confirmed` fabriqué (le moteur lit `cancelled`).
    expect(agentQuestionAnswer(vue, null).cancelled).toBe(true);
  });
});

describe("liaison : les trois transports de réponse posent le champ", () => {
  const cas = [
    { fichier: "agent-pi.js", signature: "const respond = async (confirmed) => {", champ: "command.confirmed" },
    { fichier: "super-agent.js", signature: "async function respondSuperAgent(id, value, cancelled) {", champ: "cmd.confirmed" },
    { fichier: "super-agent.js", signature: "export async function respondAgentRelay(projectPath, agentId, id, value, cancelled) {", champ: "cmd.confirmed" },
  ];

  for (const { fichier, signature, champ } of cas) {
    it(`${fichier} — « ${signature} » transmet la décision`, () => {
      const source = lire(fichier);
      const corps = corpsDe(source, signature);
      expect(corps).toContain("agentAnswerConfirmedRoot(");
      expect(corps).toContain(champ);
      // Jamais une confirmation fabriquée : le champ vient de la décision.
      expect(corps).not.toMatch(/confirmed\s*:\s*(true|false)\b/);
    });
  }

  it("la décision vient d'un seul endroit (import, aucune recopie de la lecture)", () => {
    for (const fichier of ["agent-pi.js", "super-agent.js"]) {
      const source = lire(fichier);
      // Importée du module de décision (liste d'imports possiblement multiligne).
      expect(source).toMatch(
        /import \{[\s\S]{0,600}?\bagentAnswerConfirmedRoot\b[\s\S]{0,600}?\} from "\.\/agent-question-surface\.js";/,
      );
      // Aucune seconde lecture du JSON de confirmation ailleurs dans le fichier.
      expect(source.match(/typeof parsed\.confirmed/g) || []).toHaveLength(0);
    }
  });
});
