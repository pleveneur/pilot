// Tests — vérification de mise à jour du moteur AU LANCEMENT (#334).
//
// Le contrôle existait uniquement à l'ouverture de l'onglet agent (tabs.js) :
// une session Pilot qui n'ouvre jamais l'onglet agent ne voyait jamais passer
// la proposition de mise à jour de Pi. Ici on vérifie le CÂBLAGE (même approche
// que `screen-guard-wiring.test.js` : assertions de source) et les garde-fous
// d'idempotence, désormais que le contrôle a deux points d'appel ET qu'il est la
// PREMIÈRE chose faite au démarrage (voir `demarrage-verification-pi.test.js`
// pour la règle complète : terrain réservé, jamais de blocage définitif).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");

const main = read("main.js");
const tabs = read("tabs.js");
const piUpdate = read("pi-update.js");

describe("mise à jour du moteur — déclenchement au lancement (main.js)", () => {
  it("démarre la vérification au lancement (et pas seulement à l'ouverture de l'onglet)", () => {
    expect(main).toMatch(/runPiStartupCheck\(\)/);
    expect(tabs).toMatch(/window\._pilotCheckPiUpdate\?\.\(\)/);
  });

  it("la vérification est la PREMIÈRE chose faite (avant l'init des onglets)", () => {
    // Règle du propriétaire : rien ne démarre avant la fin de la vérification.
    expect(main.indexOf("runPiStartupCheck()")).toBeLessThan(main.indexOf("initTabs("));
  });

  it("attend la sonde backend avant de vérifier (sinon getBackendInfoSync est vide)", () => {
    // La sonde `get_backend_info` est asynchrone : sans enchaînement, le cache
    // synchrone est encore `null` et checkPiUpdate sortirait immédiatement.
    const body = piUpdate.slice(piUpdate.indexOf("export async function runPiStartupCheck"));
    expect(body).toMatch(/await probe\(\);\s*\n\s*return await check\(\);/);
  });

  it("ne bloque pas la chaîne d'initialisation (promesse non attendue)", () => {
    expect(main).toMatch(/\n\s*runPiStartupCheck\(\);\n/);
    expect(main).not.toMatch(/await runPiStartupCheck\(\)/);
  });
});

describe("checkPiUpdate — idempotent (lancement + ouverture d'onglet)", () => {
  it("sort si la modale de proposition est déjà affichée", () => {
    expect(piUpdate).toMatch(/pi-update-modal/);
    expect(piUpdate).toContain('shown && !shown.classList.contains("hidden")');
  });

  it("conserve ses garde-fous (backend pi, « Ne plus demander », vérification en cours)", () => {
    expect(piUpdate).toContain('info.kind !== "pi"');
    expect(piUpdate).toContain("cfg.pi_skip_update_check");
    // Vérification déjà en vol : on rend la MÊME promesse (aucun second appel).
    expect(piUpdate).toContain("if (_inflight) return _inflight;");
  });
});
