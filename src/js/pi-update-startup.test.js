// Tests — vérification de mise à jour du moteur AU LANCEMENT (#334).
//
// Le contrôle existait uniquement à l'ouverture de l'onglet agent (tabs.js) :
// une session Pilot qui n'ouvre jamais l'onglet agent ne voyait jamais passer
// la proposition de mise à jour de Pi. Ici on vérifie le CÂBLAGE (même approche
// que `screen-guard-wiring.test.js` : assertions de source) et les garde-fous
// d'idempotence, désormais que le contrôle a deux points d'appel.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8");

const main = read("main.js");
const tabs = read("tabs.js");
const piUpdate = read("pi-update.js");

describe("mise à jour du moteur — déclenchement au lancement (main.js)", () => {
  it("appelle checkPiUpdate au démarrage (et pas seulement à l'ouverture de l'onglet)", () => {
    expect(main).toMatch(/checkPiUpdate\(\)/);
    expect(tabs).toMatch(/window\._pilotCheckPiUpdate\?\.\(\)/);
  });

  it("attend la sonde backend avant de vérifier (sinon getBackendInfoSync est vide)", () => {
    // La sonde `get_backend_info` est asynchrone : sans enchaînement, le cache
    // synchrone est encore `null` et checkPiUpdate sort immédiatement.
    expect(main).toMatch(/refreshBackendInfo\(\)\.then\(\(\) => checkPiUpdate\(\)\)/);
  });

  it("n'alourdit pas la chaîne d'initialisation (appel différé)", () => {
    expect(main).toMatch(/setTimeout\(\(\) => \{ refreshBackendInfo\(\)\.then/);
  });
});

describe("checkPiUpdate — idempotent (lancement + ouverture d'onglet)", () => {
  it("sort si la modale de proposition est déjà affichée", () => {
    expect(piUpdate).toMatch(
      /document\.getElementById\("pi-update-modal"\);\s*\n\s*if \(shown && !shown\.classList\.contains\("hidden"\)\) return;/,
    );
  });

  it("conserve ses garde-fous (backend pi, « Ne plus demander », vérification en cours)", () => {
    expect(piUpdate).toContain("if (_checking) return;");
    expect(piUpdate).toContain('info.kind !== "pi"');
    expect(piUpdate).toContain("cfg.pi_skip_update_check");
  });
});
