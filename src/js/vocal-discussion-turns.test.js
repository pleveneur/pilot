// Tests — LE FILTRE DE LA COLONNE DE GAUCHE DE L'ECRAN VOCAL (defaut signale :
// « la discussion est vide et ne s'actualise pas »).
//
// CE QUE CE FICHIER VERROUILLE, sur le module PUR (aucun DOM) :
//   F1 — une demande du proprietaire et la reponse de l'assistant SONT des tours
//        de parole : ils paraissent, dans l'ordre ou ils ont ete dits, et la
//        colonne n'est donc JAMAIS vide quand la conversation existe.
//   F2 — un message d'outil, un resultat d'outil, une reflexion, un message
//        systeme, une trace, un diff ou un journal n'est PAS un tour de parole :
//        il n'entre pas, meme quand son role ressemble a celui d'une reponse.
//   F3 — la famille (`kind`) est une seconde barriere : un message qui se
//        declare « reflexion » ou « outil » est ecarte quelle que soit sa forme.
//   F4 — un message vide, un role inconnu, un objet qui n'en est pas un : rien
//        ne paraît (aucun trou dans la colonne).
//   F5 — la lecture ne modifie pas son entree (le chat n'est jamais touche).
//
// Les chaines sont en ASCII dans les commentaires ; les libelles testes sont
// ceux du code.

import { describe, it, expect } from "vitest";
import {
  VOCAL_TURN_OWNER,
  VOCAL_TURN_ASSISTANT,
  VOCAL_SPEECH_ROLES,
  VOCAL_SILENT_KINDS,
  VOCAL_SPEECH_KINDS,
  normalizeVocalTurnRole,
  isVocalSpeechTurn,
  vocalSpeechTurns,
} from "./vocal-discussion-turns.js";
import { vocalDiscussionView } from "./vocal-sides.js";

const COLONNE = { columnHeight: 512, track: 320 };

describe("F1 — ce qui a ete DIT paraît dans la colonne", () => {
  it("une demande et sa reponse sont deux tours de parole, dans l'ordre", () => {
    const turns = vocalSpeechTurns([
      { role: "user", text: "range les fichiers du projet" },
      { role: "assistant", text: "C'est fait, il n'en reste aucun." },
    ]);
    expect(turns).toEqual([
      { role: VOCAL_TURN_OWNER, text: "range les fichiers du projet" },
      { role: VOCAL_TURN_ASSISTANT, text: "C'est fait, il n'en reste aucun." },
    ]);
    // Le contrat complet : lus, filtres, peints — la colonne montre les deux.
    const vue = vocalDiscussionView(turns, COLONNE);
    expect(vue.items).toHaveLength(2);
    expect(vue.items.map((m) => m.role)).toEqual([VOCAL_TURN_OWNER, VOCAL_TURN_ASSISTANT]);
    expect(vue.items[1].text).toContain("C'est fait");
    // Aucun excedent : la colonne n'annonce pas de messages qu'elle ne montre pas.
    expect(vue.hidden).toBe(0);
  });

  it("une conversation de plusieurs echanges reste lisible de bout en bout", () => {
    const lus = [
      { role: "user", text: "premier" },
      { role: "assistant", text: "reponse un" },
      { role: "user", text: "deuxieme" },
      { role: "assistant", text: "reponse deux" },
    ];
    const turns = vocalSpeechTurns(lus);
    expect(turns).toHaveLength(4);
    const vue = vocalDiscussionView(turns, COLONNE);
    // Le plus recent est en bas : c'est la derniere chose dite.
    expect(vue.items[vue.items.length - 1].text).toBe("reponse deux");
    expect(vue.items[0].text).toBe("premier");
  });

  it("les deux seuls roles de la conversation parlee sont ceux-la", () => {
    expect(VOCAL_SPEECH_ROLES).toEqual(["user", "assistant"]);
    expect(normalizeVocalTurnRole("user")).toBe(VOCAL_TURN_OWNER);
    expect(normalizeVocalTurnRole("assistant")).toBe(VOCAL_TURN_ASSISTANT);
    // Ecritures tolerees (les memes rôles, autrement nommes).
    expect(normalizeVocalTurnRole("  User ")).toBe(VOCAL_TURN_OWNER);
    expect(normalizeVocalTurnRole("owner")).toBe(VOCAL_TURN_OWNER);
    expect(normalizeVocalTurnRole("Pilot")).toBe(VOCAL_TURN_ASSISTANT);
    expect(normalizeVocalTurnRole("agent")).toBe(VOCAL_TURN_ASSISTANT);
    // Tout le reste n'est pas un role de parole.
    expect(normalizeVocalTurnRole("system")).toBe("");
    expect(normalizeVocalTurnRole("tool")).toBe("");
    expect(normalizeVocalTurnRole("")).toBe("");
    expect(normalizeVocalTurnRole(null)).toBe("");
    expect(normalizeVocalTurnRole(42)).toBe("");
  });
});

describe("F2 — rien de technique n'entre dans la colonne", () => {
  it("un message d'outil ou un resultat d'outil ne paraît jamais", () => {
    const lus = [
      { role: "user", text: "range les fichiers" },
      { role: "tool", text: "write src/js/tabs.js" },
      { role: "tool-call", text: "read_file_content({path})" },
      { role: "tool-result", text: "ok 128 octets" },
      { role: "system", text: "tache #22 terminee" },
      { role: "trace", text: "agent-stops.log: ligne 12" },
      { role: "diff", text: "- ancien\n+ nouveau" },
      { role: "assistant", text: "J'ai range les fichiers." },
    ];
    const turns = vocalSpeechTurns(lus);
    expect(turns.map((t) => t.text)).toEqual(["range les fichiers", "J'ai range les fichiers."]);
    // Aucune trace d'outil, de chemin ou de diff dans ce que la colonne peint.
    const peint = vocalDiscussionView(turns, COLONNE)
      .items.map((m) => m.text)
      .join("\n");
    expect(peint).not.toMatch(/src\/js|read_file_content|ok 128|agent-stops|^\+ nouveau/m);
  });

  it("les familles techniques sont nommees une par une, et toutes ecartees", () => {
    expect(VOCAL_SILENT_KINDS.length).toBeGreaterThan(8);
    for (const kind of VOCAL_SILENT_KINDS) {
      const message = { role: "assistant", kind, text: "un texte qui ressemble a une reponse" };
      expect(isVocalSpeechTurn(message)).toBe(false);
      expect(vocalSpeechTurns([message])).toEqual([]);
    }
  });

  it("un role de parole qui se declare « reflexion » ou « outil » est ecarte", () => {
    // La seconde barriere : le role ne suffit pas, la famille doit en etre une.
    for (const kind of ["thinking", "tool", "tool-result", "system", "diff"]) {
      expect(isVocalSpeechTurn({ role: "assistant", kind, text: "quelque chose" })).toBe(false);
    }
    // Une famille de parole, elle, passe.
    for (const kind of VOCAL_SPEECH_KINDS) {
      expect(isVocalSpeechTurn({ role: "assistant", kind, text: "quelque chose" })).toBe(true);
    }
    // Famille illisible : on n'invente pas, on ecarte.
    expect(isVocalSpeechTurn({ role: "assistant", kind: 12, text: "x" })).toBe(false);
    // Famille absente : c'est le cas normal du chat, il passe.
    expect(isVocalSpeechTurn({ role: "assistant", text: "x" })).toBe(true);
  });
});

describe("F3 — un message vide ne fait pas un trou dans la colonne", () => {
  it("texte vide, blanc, absent ou d'un autre type : rien ne paraît", () => {
    expect(isVocalSpeechTurn({ role: "user", text: "" })).toBe(false);
    expect(isVocalSpeechTurn({ role: "user", text: "   \n\t " })).toBe(false);
    expect(isVocalSpeechTurn({ role: "assistant" })).toBe(false);
    expect(isVocalSpeechTurn({ role: "assistant", text: 42 })).toBe(false);
    expect(isVocalSpeechTurn({ role: "assistant", text: null })).toBe(false);
    expect(isVocalSpeechTurn(null)).toBe(false);
    expect(isVocalSpeechTurn(undefined)).toBe(false);
    expect(isVocalSpeechTurn("user: bonjour")).toBe(false);
    expect(vocalSpeechTurns([{}, { role: "user", text: "   " }])).toEqual([]);
    // Une liste absente n'est pas une erreur : la colonne est simplement vide.
    expect(vocalSpeechTurns(undefined)).toEqual([]);
    expect(vocalSpeechTurns(null)).toEqual([]);
  });
});

describe("F4 — la lecture ne modifie jamais son entree", () => {
  it("la liste lue et ses messages sortent intacts", () => {
    const lus = [
      Object.freeze({ role: "user", text: "une demande", extra: "conserve" }),
      Object.freeze({ role: "tool", text: "un outil" }),
    ];
    const copie = JSON.parse(JSON.stringify(lus));
    const turns = vocalSpeechTurns(lus);
    expect(turns).toHaveLength(1);
    // Les messages lus n'ont pas bouge d'un caractere.
    expect(lus).toEqual(copie);
    // Le tour rendu ne porte que ce que la colonne peint.
    expect(Object.keys(turns[0]).sort()).toEqual(["role", "text"]);
  });
});
