// Tests Vitest du cœur PUR de la passerelle Laya (laya-gateway.js).
//
// Aucun modèle, aucun réseau, aucun service : la réponse du service est
// SIMULÉE par un `fetch` injecté. Les cas couverts sont les décisions réelles
// (classement d'un message de l'Assistant, question typée, mise en forme avec
// confiance) et les pannes (service éteint, réponse illisible, question
// invalide) — jamais une exception.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYA_API_URL,
  LAYA_MIN_CONFIDENCE,
  LAYA_QUESTION_KEY,
  assistantKindFromAnswers,
  buildAssistantKindQuestion,
  buildLayaQuestion,
  formatLayaAnswer,
  layaOffMessage,
  readLayaAnswer,
  validateLayaQuestion,
  askLaya,
} from "./laya-gateway.js";

/** Faux `fetch` : renvoie une réponse HTTP fixée sans toucher au réseau. */
function fakeFetch({ status = 200, body = {}, throwError = false } = {}) {
  return async () => {
    if (throwError) throw new Error("connect ECONNREFUSED 127.0.0.1:3017");
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    };
  };
}

describe("buildAssistantKindQuestion", () => {
  it("décrit un choix dont les libellés sont exactement ceux de classifyAssistantMessage", () => {
    const q = buildAssistantKindQuestion();
    const def = q.assistant_message_kind;
    expect(def.type).toBe("choice");
    expect(typeof def.instructions).toBe("string");
    expect(Object.keys(def.criteria).sort()).toEqual([
      "alert",
      "approval",
      "intermediate",
      "question",
      "report",
    ]);
  });
});

describe("assistantKindFromAnswers", () => {
  const answers = (choice, confidence) => ({
    assistant_message_kind: {
      type: "choice",
      choice,
      probabilities: { alert: 0.9, report: 0.1 },
      confidence: 0.8,
      answer_confidence: confidence,
      action: { act_probability: 0.7 },
    },
  });

  it("rend le libellé et la confiance du service", () => {
    expect(assistantKindFromAnswers(answers("alert", 0.97))).toEqual({
      kind: "alert",
      confidence: 0.97,
    });
  });

  it("refuse une confiance trop faible (l'appelant garde son repli)", () => {
    expect(assistantKindFromAnswers(answers("alert", LAYA_MIN_CONFIDENCE - 0.01))).toBeNull();
  });

  it("refuse un libellé inconnu du moteur", () => {
    expect(assistantKindFromAnswers(answers("banana", 0.99))).toBeNull();
  });

  it("refuse une réponse absente ou vide, sans jamais lever", () => {
    expect(assistantKindFromAnswers(null)).toBeNull();
    expect(assistantKindFromAnswers({})).toBeNull();
    expect(assistantKindFromAnswers({ assistant_message_kind: "alert" })).toBeNull();
  });
});

describe("validateLayaQuestion", () => {
  it("accepte les trois types du service avec leurs options", () => {
    expect(validateLayaQuestion({ type: "choice", options: ["a", "b"] })).toBeNull();
    expect(validateLayaQuestion({ type: "score", options: ["bas", "haut"] })).toBeNull();
    expect(validateLayaQuestion({ type: "noul" })).toBeNull();
  });

  it("refuse un type inconnu et un manque de libellés", () => {
    expect(validateLayaQuestion({ type: "text" })).toMatch(/invalide/);
    expect(validateLayaQuestion({ type: "choice", options: ["seul"] })).toMatch(/deux libellés/);
    expect(validateLayaQuestion({ type: "score", options: [] })).toMatch(/deux niveaux/);
  });
});

describe("buildLayaQuestion", () => {
  it("traduit un choix en objectif {libellé: description} du service", () => {
    const q = buildLayaQuestion({
      type: "choice",
      instructions: "Quel domaine couvre `body` ?",
      options: [
        { label: "code", description: "programmation" },
        "writing",
      ],
    });
    expect(q[LAYA_QUESTION_KEY]).toEqual({
      type: "choice",
      instructions: "Quel domaine couvre `body` ?",
      criteria: { code: "programmation", writing: "writing" },
    });
  });

  it("traduit une échelle en liste ordonnée du plus bas au plus haut", () => {
    const q = buildLayaQuestion({
      type: "score",
      instructions: "Quelle est la difficulté de `body` ?",
      options: ["trivial", { label: "hard", description: "plusieurs étapes" }],
    });
    expect(q[LAYA_QUESTION_KEY].criteria).toEqual(["trivial", "plusieurs étapes"]);
  });

  it("traduit oui/non sans options", () => {
    const q = buildLayaQuestion({ type: "noul", instructions: "`body` est-il urgent ?" });
    expect(q[LAYA_QUESTION_KEY]).toEqual({
      type: "noul",
      instructions: "`body` est-il urgent ?",
    });
  });
});

describe("askLaya", () => {
  it("renvoie les réponses du service et son temps de calcul", async () => {
    const res = await askLaya({
      text: "bonjour",
      questions: { answer: { type: "noul", instructions: "`body` est-il urgent ?" } },
      fetchImpl: fakeFetch({
        body: { ok: true, answers: { answer: { type: "noul", noul: 0.12 } }, ms: 96 },
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.answers.answer.noul).toBe(0.12);
    expect(res.ms).toBe(96);
    expect(res.error).toBe("");
  });

  it("service éteint : message clair, jamais d'exception", async () => {
    const res = await askLaya({ text: "x", questions: {}, fetchImpl: fakeFetch({ throwError: true }) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(DEFAULT_LAYA_API_URL);
    expect(res.error).toContain("classification locale est indisponible");
  });

  it("question refusée par le service : l'erreur du service est remontée", async () => {
    const res = await askLaya({
      text: "x",
      questions: {},
      fetchImpl: fakeFetch({ status: 400, body: { ok: false, error: "'text' (chaîne) est requis" } }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("refusé la question");
    expect(res.error).toContain("'text' (chaîne) est requis");
  });

  it("réponse illisible : message clair, jamais d'exception", async () => {
    const res = await askLaya({ text: "x", questions: {}, fetchImpl: fakeFetch({ body: { ok: true } }) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("illisible");
  });
});

describe("formatLayaAnswer", () => {
  it("met en forme un choix avec sa confiance et ses probabilités", () => {
    const text = formatLayaAnswer({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.9972, other: 0.0028 },
      confidence: 0.9,
      answer_confidence: 0.9972,
    });
    expect(text).toContain('choice « billing »');
    expect(text).toContain("confidence 0.9 / answer_confidence 0.9972");
    expect(text).toContain("billing=0.9972");
  });

  it("met en forme une note avec son niveau et sa légende", () => {
    const text = formatLayaAnswer({
      type: "score",
      score: 1.4,
      legend: { 0: "calme", 1: "agacé" },
      confidence: 0.7,
      answer_confidence: 0.7,
    });
    expect(text).toContain("score 1.4 (niveau 1)");
    expect(text).toContain("legend");
  });

  it("met en forme un oui/non avec le seuil de 0,5", () => {
    expect(formatLayaAnswer({ type: "noul", noul: 0.8, answer_confidence: 0.8 })).toContain(
      "noul 0.8 (vrai)",
    );
    expect(formatLayaAnswer({ type: "noul", noul: 0.2, answer_confidence: 0.8 })).toContain(
      "noul 0.2 (faux)",
    );
  });

  it("ne lève jamais sur une réponse absente", () => {
    expect(formatLayaAnswer(null)).toContain("illisible");
  });
});

describe("readLayaAnswer / layaOffMessage", () => {
  it("lit une réponse par sa clé et ignore le reste", () => {
    expect(readLayaAnswer({ answer: { type: "noul" } })).toEqual({ type: "noul" });
    expect(readLayaAnswer({ answer: 3 })).toBeNull();
    expect(readLayaAnswer(null)).toBeNull();
  });

  it("indique où régler le service dans le message de panne", () => {
    expect(layaOffMessage()).toContain("Réglages → Service Laya");
  });
});
