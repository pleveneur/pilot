// Tests unitaires — laya-utils.js (réglage Service Laya : messages utilisateur purs)
import { describe, it, expect } from "vitest";
import { LAYA_OUTCOMES, layaStatusMessage, layaOutcomeMessage } from "./laya-utils.js";

describe("LAYA_OUTCOMES", () => {
  it("couvre exactement les 6 issues renvoyées par le moteur", () => {
    expect(LAYA_OUTCOMES).toEqual([
      "disabled",
      "invalidPath",
      "alreadyRunning",
      "launched",
      "launchedNotReady",
      "launchFailed",
    ]);
  });
});

describe("layaStatusMessage", () => {
  it("réglages incomplets (configured=false) → avertissement", () => {
    const r = layaStatusMessage({ configured: false, reachable: false, ready: false });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/non configuré/i);
  });

  it("configuré mais injoignable → service arrêté", () => {
    const r = layaStatusMessage({ configured: true, reachable: false, ready: false });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/arrêté/i);
  });

  it("joignable mais modèle non chargé → en cours de chargement", () => {
    const r = layaStatusMessage({ configured: true, reachable: true, ready: false });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/chargement/i);
  });

  it("joignable et prêt → succès", () => {
    const r = layaStatusMessage({ configured: true, reachable: true, ready: true });
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/prêt/i);
  });

  it("état inconnu (null) → message générique (jamais de crash)", () => {
    const r = layaStatusMessage(null);
    expect(r.kind).toBe("warning");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("état inconnu (objet vide / undefined) → jamais de crash", () => {
    expect(layaStatusMessage(undefined).text.length).toBeGreaterThan(0);
    expect(layaStatusMessage({}).text.length).toBeGreaterThan(0);
  });

  it("aucun message d'état ne contient de nom de code technique", () => {
    const states = [
      { configured: false },
      { configured: true, reachable: false },
      { configured: true, reachable: true, ready: false },
      { configured: true, reachable: true, ready: true },
    ];
    for (const s of states) {
      expect(layaStatusMessage(s).text).not.toMatch(/outcome|camelCase|undefined|null|exception|reachable|configured/i);
    }
  });
});

describe("layaOutcomeMessage", () => {
  it("désactivé → informatif", () => {
    const r = layaOutcomeMessage("disabled");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/désactivé/i);
  });

  it("chemin invalide → avertissement", () => {
    const r = layaOutcomeMessage("invalidPath");
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/introuvable/i);
  });

  it("déjà lancé → informatif", () => {
    const r = layaOutcomeMessage("alreadyRunning");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/déjà lancé/i);
  });

  it("lancé → succès", () => {
    const r = layaOutcomeMessage("launched");
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/vient d'être lancé/i);
  });

  it("lancé mais pas prêt → informatif", () => {
    const r = layaOutcomeMessage("launchedNotReady");
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/charge encore/i);
  });

  it("échec du lancement → erreur non technique", () => {
    const r = layaOutcomeMessage("launchFailed");
    expect(r.kind).toBe("error");
    expect(r.text).toMatch(/échoué/i);
  });

  it("issue inconnue → message générique (jamais de crash)", () => {
    for (const bad of ["somethingElse", null, undefined, ""]) {
      const r = layaOutcomeMessage(bad);
      expect(r.kind).toBe("warning");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it("aucun message d'issue ne contient de nom de code technique", () => {
    for (const outcome of LAYA_OUTCOMES) {
      expect(layaOutcomeMessage(outcome).text).not.toMatch(/outcome|camelCase|undefined|null|exception/i);
    }
  });
});
