// Tests unitaires — plface-utils.js (réglage PLface : messages utilisateur purs)
import { describe, it, expect } from "vitest";
import {
  PLFACE_OUTCOMES,
  PLFACE_STOP_OUTCOMES,
  plfaceOutcomeMessage,
  plfaceStopMessage,
  plfaceStateMessage,
} from "./plface-utils.js";

describe("PLFACE_OUTCOMES", () => {
  it("couvre exactement les 5 états renvoyés par le moteur", () => {
    expect(PLFACE_OUTCOMES).toEqual([
      "alreadyRunning",
      "launched",
      "executableNotFound",
      "disabled",
      "launchFailed",
    ]);
  });
});

describe("PLFACE_STOP_OUTCOMES", () => {
  it("couvre exactement les 3 états d'arrêt renvoyés par le moteur", () => {
    expect(PLFACE_STOP_OUTCOMES).toEqual(["closed", "notRunning", "failed"]);
  });
});

describe("plfaceOutcomeMessage", () => {
  it("déjà lancé → message informatif", () => {
    const r = plfaceOutcomeMessage("alreadyRunning");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/déjà lancé/i);
  });

  it("lancé → message de succès", () => {
    const r = plfaceOutcomeMessage("launched");
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/vient d'être lancé/i);
  });

  it("exécutable introuvable → avertissement clair", () => {
    const r = plfaceOutcomeMessage("executableNotFound");
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/introuvable/i);
  });

  it("désactivé → message informatif", () => {
    const r = plfaceOutcomeMessage("disabled");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/désactivé/i);
  });

  it("échec du lancement → message d'erreur non technique", () => {
    const r = plfaceOutcomeMessage("launchFailed");
    expect(r.kind).toBe("error");
    expect(r.text).toMatch(/échoué/i);
  });

  it("état inconnu → message générique (jamais de crash)", () => {
    const r = plfaceOutcomeMessage("somethingElse");
    expect(r.kind).toBe("warning");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("aucun message ne contient de nom de code technique", () => {
    for (const outcome of PLFACE_OUTCOMES) {
      const { text } = plfaceOutcomeMessage(outcome);
      expect(text).not.toMatch(/plface|outcome|camelCase|error|exception|undefined/i);
    }
  });
});

describe("plfaceStopMessage", () => {
  it("fermé proprement → succès", () => {
    const r = plfaceStopMessage("closed");
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/fermé/i);
  });

  it("pas lancé → information discrète (pas d'erreur)", () => {
    const r = plfaceStopMessage("notRunning");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/pas lancé/i);
  });

  it("échec → avertissement, jamais angoissant", () => {
    const r = plfaceStopMessage("failed");
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/n'a pas pu se fermer/i);
  });

  it("état inconnu → message générique (jamais de crash)", () => {
    const r = plfaceStopMessage("somethingElse");
    expect(r.kind).toBe("warning");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("aucun message d'arrêt ne contient de nom de code technique", () => {
    for (const outcome of PLFACE_STOP_OUTCOMES) {
      const { text } = plfaceStopMessage(outcome);
      expect(text).not.toMatch(/plface|outcome|camelCase|error|exception|undefined/i);
    }
  });
});

describe("plfaceStateMessage", () => {
  it("lancé → état lisible de succès", () => {
    const r = plfaceStateMessage(true);
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/lancé/i);
  });

  it("arrêté → état lisible informatif", () => {
    const r = plfaceStateMessage(false);
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/arrêté/i);
  });
});
