/**
 * VERROUS DU GARDE DE DÉMARRAGE (tâche 424) — les décisions PURES.
 *
 * REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° 34
 *
 * Ce que cette suite protège : le garde ne doit JAMAIS conclure « c'est bon »
 * par défaut. Une observation absente, partielle, encore en cours, ou une
 * preuve qui dit « ça n'a pas démarré » ne peuvent pas autoriser une livraison.
 * Chaque test de refus échouerait si la décision redevenait permissive.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOW_NO_STARTUP_PROOF_ENV,
  GARDE_DEMARRAGE_FRAICHEUR_MS,
  GARDE_DEMARRAGE_MARQUEUR,
  OBSERVATION_EXPRESSION,
  cheminPreuveDemarrage,
  decideDemarrage,
  parsePreuveDemarrage,
  phraseEchecDemarrage,
  phraseSuccesDemarrage,
  preuveDeDemarrage,
  verdictPreuveDemarrage,
} from "./garde-demarrage.js";

const RACINE = path.resolve(__dirname, "..", "..");

/** Observation d'un écran principal réellement ouvert. */
const ECRAN_OUVERT = {
  url: "http://tauri.localhost/",
  etat: "complete",
  pret: true,
  chargementAffiche: false,
  corpsPresent: true,
  largeur: 1280,
  hauteur: 860,
  tauri: true,
};

describe("garde de démarrage — l'écran principal est-il vraiment ouvert ?", () => {
  it("une observation absente ou illisible n'est jamais un démarrage", () => {
    for (const rien of [null, undefined, "", "ok", 1, [], true]) {
      const v = decideDemarrage(rien);
      expect(v.ok).toBe(false);
      expect(v.raison).toBeTruthy();
    }
  });

  it("une initialisation encore en cours est en cours, pas un succès", () => {
    const v = decideDemarrage({ ...ECRAN_OUVERT, pret: false, chargementAffiche: true });
    expect(v.ok).toBe(false);
    expect(v.enCours).toBe(true);
    expect(v.raison).toContain("initialisation");
  });

  it("l'écran de chargement encore affiché après la marque est un échec", () => {
    const v = decideDemarrage({ ...ECRAN_OUVERT, chargementAffiche: true });
    expect(v.ok).toBe(false);
    expect(v.enCours).toBe(false);
    expect(v.raison).toContain("écran de chargement");
  });

  it("un corps de page trop petit n'est pas un écran ouvert", () => {
    const v = decideDemarrage({ ...ECRAN_OUVERT, largeur: 12, hauteur: 8 });
    expect(v.ok).toBe(false);
    expect(v.raison).toContain("n'occupe pas l'écran");
  });

  it("une page sans API Tauri n'est pas la vraie application", () => {
    const v = decideDemarrage({ ...ECRAN_OUVERT, tauri: false });
    expect(v.ok).toBe(false);
    expect(v.raison).toContain("API Tauri");
  });

  it("un corps de page absent n'est pas un écran ouvert", () => {
    const v = decideDemarrage({ ...ECRAN_OUVERT, corpsPresent: false });
    expect(v.ok).toBe(false);
  });

  it("seule une observation complète déclare l'écran principal ouvert", () => {
    const v = decideDemarrage(ECRAN_OUVERT);
    expect(v.ok).toBe(true);
    expect(v.enCours).toBe(false);
  });

  it("l'expression d'observation et le marqueur écrit par main.js sont les mêmes", () => {
    expect(GARDE_DEMARRAGE_MARQUEUR).toBe("data-pilot-pret");
    expect(OBSERVATION_EXPRESSION).toContain("data-pilot-pret");
    expect(OBSERVATION_EXPRESSION).toContain("boot-overlay");
    expect(OBSERVATION_EXPRESSION).toContain("app-body");
    const main = readFileSync(path.join(RACINE, "src", "js", "main.js"), "utf8").replace(/\r\n/g, "\n");
    // Posé à la SEULE fin normale de l'initialisation, jamais dans le `catch`.
    expect(main).toContain('document.documentElement.setAttribute("data-pilot-pret", "1");');
  });
});

describe("garde de démarrage — la preuve autorise-t-elle la livraison ?", () => {
  const VERSION = "9.9.9";
  const maintenant = new Date("2026-11-18T12:00:00.000Z");
  const preuveValide = preuveDeDemarrage({
    ok: true,
    raison: "l'écran principal est ouvert",
    version: VERSION,
    exe: "C:/pilot/pilot.exe",
    at: new Date("2026-11-18T11:58:00.000Z"),
    dureeMs: 4200,
    observation: ECRAN_OUVERT,
  });

  it("la preuve porte la version, l'instant, la durée et l'observation", () => {
    expect(preuveValide.ok).toBe(true);
    expect(preuveValide.version).toBe(VERSION);
    expect(preuveValide.at).toBe("2026-11-18T11:58:00.000Z");
    expect(preuveValide.duree_ms).toBe(4200);
    expect(preuveValide.observation.pret).toBe(true);
  });

  it("le chemin de la preuve suit la version, à côté du changelog", () => {
    expect(cheminPreuveDemarrage(VERSION)).toBe("release-notes/demarrage-v9.9.9.json");
  });

  it("une preuve absente REFUSE la livraison (aucun succès par défaut)", () => {
    const v = verdictPreuveDemarrage({ preuve: null, version: VERSION, maintenant });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("DÉCLARÉE RATÉE");
    expect(v.raison).toContain("npm run verif:demarrage");
    expect(v.raison).toContain(ALLOW_NO_STARTUP_PROOF_ENV);
  });

  it("une preuve illisible REFUSE la livraison", () => {
    const v = verdictPreuveDemarrage({ preuve: "{ ceci n'est pas du json", version: VERSION, maintenant });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("illisible");
  });

  it("une preuve qui dit « ça n'a pas démarré » refuse MÊME avec la tolérance", () => {
    const ratee = preuveDeDemarrage({
      ok: false,
      raison: "l'initialisation de Pilot n'est pas terminée",
      version: VERSION,
      at: new Date("2026-11-18T11:58:00.000Z"),
    });
    const v = verdictPreuveDemarrage({
      preuve: ratee,
      version: VERSION,
      maintenant,
      allowMissing: true,
    });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("DÉCLARÉE RATÉE");
    expect(v.raison).toContain("initialisation");
  });

  it("la tolérance explicite ne couvre QUE l'absence de preuve", () => {
    const v = verdictPreuveDemarrage({
      preuve: null,
      version: VERSION,
      maintenant,
      allowMissing: true,
    });
    expect(v.livrer).toBe(true);
    expect(v.raison).toContain("tolérée explicitement");
  });

  it("une preuve d'une autre version refuse la livraison", () => {
    const v = verdictPreuveDemarrage({ preuve: preuveValide, version: "1.0.1", maintenant });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("pas 1.0.1");
  });

  it("une preuve périmée refuse la livraison", () => {
    const v = verdictPreuveDemarrage({
      preuve: preuveValide,
      version: VERSION,
      maintenant: new Date(maintenant.getTime() + GARDE_DEMARRAGE_FRAICHEUR_MS + 3600_000),
    });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("fraîcheur");
  });

  it("une preuve sans date lisible refuse la livraison", () => {
    const v = verdictPreuveDemarrage({
      preuve: { ...preuveValide, at: "pas une date" },
      version: VERSION,
      maintenant,
    });
    expect(v.livrer).toBe(false);
    expect(v.raison).toContain("date lisible");
  });

  it("une preuve fraîche de la bonne version autorise la livraison", () => {
    const v = verdictPreuveDemarrage({ preuve: preuveValide, version: VERSION, maintenant });
    expect(v.livrer).toBe(true);
    expect(v.raison).toContain("vue démarrer");
  });

  it("les phrases de conclusion disent toujours le verdict, sans flou", () => {
    expect(phraseEchecDemarrage({ raison: "aucun écran", dureeMs: 90_000 })).toContain(
      "DÉCLARÉE RATÉE",
    );
    expect(phraseSuccesDemarrage({ dureeMs: 4200, version: VERSION })).toContain("écran principal est ouvert");
  });

  it("la preuve se relit depuis sa forme JSON (écrite puis relue)", () => {
    const relue = parsePreuveDemarrage(JSON.stringify(preuveValide));
    expect(relue).not.toBeNull();
    expect(verdictPreuveDemarrage({ preuve: relue, version: VERSION, maintenant }).livrer).toBe(true);
  });
});
