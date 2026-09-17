// settings-superagent-default-model.test.js — Issue #88 (lot 2) : le sélecteur
// « Modèle par défaut de l'Assistant » de l'écran Paramètres doit rester branché
// de bout en bout :
//   - présent dans index.html (onglet Modèles IA), option vide « Modèle par
//     défaut » = repli sur le modèle par défaut global des agents ;
//   - préservé dans l'objet config envoyé par settings.js (sinon un
//     enregistrement des Paramètres réécrit toute la config et réinitialise le
//     réglage à vide) ;
//   - envoyé au cœur par la commande Tauri dédiée `set_super_agent_default_model`
//     (déclarée dans super_agent.rs et enregistrée dans lib.rs).
//
// Comme le voisin settings-defaults.test.js, ce test lit les sources réelles
// (aucun DOM) pour empêcher une dérive silencieuse (réglage du cœur présent mais
// plus exposé, ou exposé mais plus persisté).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SELECT_ID = "setting-superagent-default-model";
const FIELD = "super_agent_default_model";

describe("issue #88 — réglage du cœur", () => {
  it("AppConfig expose le champ dédié (défaut vide = comportement inchangé)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(new RegExp(`${FIELD}\\s*:\\s*String`));
    // Valeur par défaut vide dans le constructeur par défaut de la config.
    expect(rust).toMatch(new RegExp(`${FIELD}\\s*:\\s*String::new\\(\\)`));
  });

  it("la commande Tauri d'écriture existe et est enregistrée", () => {
    const rust = read("src-tauri/src/super_agent.rs");
    expect(rust).toMatch(
      new RegExp(`#\\[tauri::command\\][\\s\\S]{0,40}pub fn set_super_agent_default_model\\(`)
    );
    const lib = read("src-tauri/src/lib.rs");
    expect(lib).toContain("super_agent::set_super_agent_default_model");
  });
});

describe("issue #88 — sélecteur dans les Paramètres", () => {
  it("le champ est présent dans index.html avec l'option de repli", () => {
    const html = read("index.html");
    const m = html.match(new RegExp(`<select id="${SELECT_ID}">([\\s\\S]*?)</select>`));
    expect(m, `select #${SELECT_ID} introuvable dans index.html`).toBeTruthy();
    // L'option vide vaut « Modèle par défaut » (= repli sur le défaut global).
    expect(m[1]).toMatch(/<option value="">Modèle par défaut<\/option>/);
    // Un libellé traduit associé (comme les autres lignes de l'écran).
    expect(html).toContain(`for="${SELECT_ID}"`);
  });

  it("settings.js lit, peuple et sauvegarde le réglage", () => {
    const js = read("src/js/settings.js");
    // Référence DOM + chargement de la valeur courante.
    expect(js).toContain(`document.getElementById("${SELECT_ID}")`);
    expect(js).toMatch(new RegExp(`currentConfig\\.${FIELD}\\s*\\|\\|\\s*""`));
    // Peuplement du select (même composant que les autres sélecteurs de modèles).
    expect(js).toMatch(/populateModelSelect\(\s*inputSuperAgentDefaultModel\s*,/);
    // Champ envoyé au cœur lors de l'enregistrement des Paramètres.
    expect(js).toMatch(new RegExp(`${FIELD}\\s*:`));
  });

  it("le changement de modèle est envoyé au cœur immédiatement", () => {
    const js = read("src/js/settings.js");
    expect(js).toContain('invoke("set_super_agent_default_model"');
    // Champ vide = effacement du réglage (repli sur le défaut global).
    expect(js).toMatch(/provider \|\| "", modelId: modelId \|\| ""/);
  });
});
