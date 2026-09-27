// Tests unitaires — laya-utils.js (réglage Service Laya : messages utilisateur purs)
import { describe, it, expect } from "vitest";
import { LAYA_OUTCOMES, layaStatusMessage, layaOutcomeMessage, LAYA_FETCH_REASONS, layaModelStateMessage, layaModelProgressPercent } from "./laya-utils.js";

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

  it("service embarqué mais pas encore exploitable → le dit sans parler de réglage", () => {
    const r = layaStatusMessage({ configured: false, embedded: true, ready: false });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/livré avec Pilot/i);
    expect(r.text).not.toMatch(/embarque pas/i);
  });

  it("paquet SANS Laya → le dit clairement (aucun réglage ne peut l'activer)", () => {
    const r = layaStatusMessage({ configured: false, embedded: false });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/n'embarque pas le service Laya/i);
  });

  it("service embarqué et prêt → succès (même message qu'un service externe)", () => {
    const r = layaStatusMessage({ configured: true, embedded: true, reachable: true, ready: true });
    expect(r.kind).toBe("success");
  });

  it("configuré mais injoignable → service arrêté", () => {
    const r = layaStatusMessage({ configured: true, reachable: false, ready: false });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/arrêté/i);
  });

  it("injoignable AVEC une issue de démarrage → l'issue RÉELLE, jamais « arrêté »", () => {
    const r = layaStatusMessage({
      configured: true,
      reachable: false,
      ready: false,
      outcome: "launchFailed",
    });
    expect(r.kind).toBe("error");
    expect(r.text).toMatch(/échoué/i);
    expect(r.text).not.toMatch(/arrêté/i);
  });

  it("injoignable mais service en cours de chargement → le dit (issue réelle)", () => {
    const r = layaStatusMessage({ configured: true, reachable: false, outcome: "launchedNotReady" });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/charge encore/i);
  });

  it("issue inconnue dans le statut → jamais de crash ni de terme technique", () => {
    const r = layaStatusMessage({ configured: true, reachable: false, outcome: "inattendue" });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/outcome|undefined|null|exception/i);
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
      { configured: true, reachable: false, outcome: "launchFailed" },
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

describe("LAYA_FETCH_REASONS", () => {
  it("couvre exactement les 12 raisons du moteur", () => {
    expect(LAYA_FETCH_REASONS).toEqual([
      "ok",
      "networkOffline",
      "serverRefused",
      "invalidAddress",
      "diskFull",
      "integrityFailed",
      "addressMissing",
      "fetchMissing",
      "nodeMissing",
      "cancelled",
      "alreadyRunning",
      "unknown",
    ]);
  });
});

describe("layaModelProgressPercent", () => {
  it("borne à 0..100 et tolère l'inconnu", () => {
    expect(layaModelProgressPercent({ percent: 0 })).toBe(0);
    expect(layaModelProgressPercent({ percent: 42 })).toBe(42);
    expect(layaModelProgressPercent({ percent: 100 })).toBe(100);
    expect(layaModelProgressPercent({ percent: 250 })).toBe(100);
    expect(layaModelProgressPercent({ percent: -3 })).toBe(0);
    expect(layaModelProgressPercent({ percent: null })).toBe(0);
    expect(layaModelProgressPercent({})).toBe(0);
    expect(layaModelProgressPercent(null)).toBe(0);
  });
});

describe("layaModelStateMessage", () => {
  it("modèle présent → succès", () => {
    const r = layaModelStateMessage({ present: true, downloading: false, reason: null });
    expect(r.kind).toBe("success");
    expect(r.text).toMatch(/prêt/i);
  });

  it("téléchargement en cours → informatif avec pourcentage", () => {
    const r = layaModelStateMessage({ present: false, downloading: true, percent: 37 });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/37 %/);
  });

  it("téléchargement en cours sans pourcentage → pas de faux chiffre", () => {
    const r = layaModelStateMessage({ present: false, downloading: true, percent: null });
    expect(r.kind).toBe("info");
    expect(r.text).not.toMatch(/\d+ %/);
  });

  it("adresse non renseignée → état clair, jamais un crash", () => {
    const r = layaModelStateMessage({ present: false, reason: "addressMissing" });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/adresse d'hébergement/i);
  });

  it("refus du serveur → motif distinct du réseau, jamais « pas d'Internet »", () => {
    const r = layaModelStateMessage({ present: false, reason: "serverRefused" });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/refusé/i);
    expect(r.text).not.toMatch(/Internet/i);
  });

  it("interrompu → reprise annoncée", () => {
    const r = layaModelStateMessage({ present: false, reason: "cancelled" });
    expect(r.kind).toBe("info");
    expect(r.text).toMatch(/reprendra/i);
  });

  it("échec d'intégrité → erreur non technique", () => {
    const r = layaModelStateMessage({ present: false, reason: "integrityFailed" });
    expect(r.kind).toBe("error");
    expect(r.text).toMatch(/abîmé/i);
  });

  it("modèle absent sans raison → invit à télécharger", () => {
    const r = layaModelStateMessage({ present: false, downloading: false, reason: null });
    expect(r.kind).toBe("warning");
    expect(r.text).toMatch(/absent/i);
  });

  it("état indisponible (null/undefined) → jamais de crash", () => {
    expect(layaModelStateMessage(null).text.length).toBeGreaterThan(0);
    expect(layaModelStateMessage(undefined).text.length).toBeGreaterThan(0);
  });

  it("aucun message ne contient de nom de code ni de chemin technique", () => {
    for (const reason of LAYA_FETCH_REASONS) {
      const text = layaModelStateMessage({ present: false, reason }).text;
      expect(text).not.toMatch(/camelCase|undefined|null|exception|\.onnx|\.part|[A-Za-z]:\\|\/home\/|integrityFailed|networkOffline/i);
    }
  });
});
