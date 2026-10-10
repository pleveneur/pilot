// thinking-levels-wiring.test.js — T7 : les sélecteurs de niveau de réflexion
// doivent rester branchés de bout en bout (présent à l'écran → alimenté par le
// socle pur → enregistré). Comme settings-defaults.test.js, ce test lit les
// sources réelles (aucun DOM) pour empêcher une dérive silencieuse : un réglage
// du cœur présent mais plus exposé, ou exposé mais plus persisté.
//
// Rappel de l'invariant : aucune liste de niveaux n'est inventée côté UI. Le
// contenu vient de `available_thinking_levels_for_model` (lecture disque) ou de
// la session vivante, puis du socle pur `thinkingLevelOptions`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describeAgentThinking } from "./agents.js";
import { thinkingLevelOptions, THINKING_LEVEL_LABELS } from "./thinking-levels.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

describe("T7 — réglage général de Pilot (⚙️ → Agent Pi)", () => {
  it("le sélecteur existe dans index.html avec l'option de repli", () => {
    const html = read("index.html");
    const m = html.match(/<select id="setting-default-thinking-level">([\s\S]*?)<\/select>/);
    expect(m, "select #setting-default-thinking-level introuvable").toBeTruthy();
    expect(m[1]).toMatch(/<option value="">Non réglé \(défaut du moteur\)<\/option>/);
    expect(html).toContain('for="setting-default-thinking-level"');
    // Message d'indisponibilité (modèle non raisonnant) : même patron que l'Assistant.
    expect(html).toContain('id="setting-default-thinking-level-note"');
  });

  it("settings.js lit, peuple et sauvegarde le champ du cœur", () => {
    const js = read("src/js/settings.js");
    expect(js).toContain('document.getElementById("setting-default-thinking-level")');
    expect(js).toMatch(/currentConfig\.default_thinking_level\s*\|\|\s*""/);
    expect(js).toMatch(/default_thinking_level:\s*selectDefaultThinkingLevel/);
    // Peuplement via le socle pur + liste réelle des niveaux (jamais codée en dur).
    expect(js).toContain("thinkingLevelOptions(levels");
    expect(js).toContain('invoke("available_thinking_levels_for_model"');
  });

  it("AppConfig expose le champ avec un défaut vide (comportement inchangé)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(/default_thinking_level:\s*String/);
    expect(rust).toMatch(/default_thinking_level:\s*String::new\(\)/);
  });
});

describe("T7 — éditeur d'agent 🎭 (niveaux π / ℓ)", () => {
  const js = read("src/js/agents-ui.js");

  it("les deux sélecteurs et leurs messages existent", () => {
    for (const id of ["ae-thinking-pi", "ae-thinking-plh"]) {
      expect(js).toContain(`id="${id}"`);
      expect(js).toContain(`id="${id}-note"`);
    }
    expect(js).toContain("Non réglé (suit le réglage général)");
    expect(js).toContain("THINKING_LEVEL_HINT");
  });

  it("le contenu vient de la liste réelle du modèle, jamais d'une liste en dur", () => {
    expect(js).toContain('invoke("available_thinking_levels_for_model"');
    expect(js).toContain("thinkingLevelOptions(levels");
    // Modèle non renseigné → repli sur le modèle par défaut du backend.
    expect(js).toContain('invoke("read_model_aliases"');
  });

  it("l'enregistrement transmet thinking.{pi,plh} (jamais effacé)", () => {
    expect(js).toMatch(/thinking:\s*\{\s*pi:\s*modal\.querySelector\("#ae-thinking-pi"\)\.value,\s*plh:\s*modal\.querySelector\("#ae-thinking-plh"\)\.value,/);
  });
});

describe("T7 — carte d'agent : niveau demandé", () => {
  it("describeAgentThinking n'affiche rien quand aucun niveau n'est réglé", () => {
    expect(describeAgentThinking({ thinking: { pi: "", plh: "" } })).toBeNull();
    expect(describeAgentThinking({})).toBeNull();
    expect(describeAgentThinking(null)).toBeNull();
  });

  it("affiche les deux libellés français et avertit que le niveau est ajusté", () => {
    const d = describeAgentThinking({ thinking: { pi: "high", plh: "" } });
    expect(d.text).toContain(THINKING_LEVEL_LABELS.high);
    expect(d.text).toContain("ℓ");
    expect(d.title).toMatch(/ramené aux capacités du modèle/);
  });

  it("agents-ui.js affiche la ligne sur la carte", () => {
    const ui = read("src/js/agents-ui.js");
    expect(ui).toContain("describeAgentThinking");
    expect(ui).toMatch(/thinking\s*\?\s*`<div class="agent-card-models/);
  });
});

describe("T7 — modèle non raisonnant : sélecteur désactivé, valeur conservée", () => {
  it("le socle pur garde toujours la valeur enregistrée sélectionnable", () => {
    const res = thinkingLevelOptions(["off"], { current: "high", provider: "llama-cpp" });
    expect(res.disabled).toBe(true);
    expect(res.message).toContain("llama-cpp");
    const values = res.options.map((o) => o.value);
    expect(values).toContain("high");
  });
});
