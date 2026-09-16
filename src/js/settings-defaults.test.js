// settings-defaults.test.js — Cohérence des valeurs par défaut affichées dans
// les Paramètres avec la valeur par défaut du moteur (Rust).
//
// Régression corrigée (lot 2 des petits restes) : le plafond de tours affiché
// restait à 60 alors que le moteur utilise 200 (`default_agent_max_turns()`),
// incohérence d'affichage uniquement. Ce test lit les sources réelles pour
// empêcher toute nouvelle dérive entre la valeur moteur et l'affichage UI.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

describe("agent_max_turns — cohérence moteur / affichage", () => {
  it("le défaut moteur (Rust) vaut 200", () => {
    const rust = read("src-tauri/src/lib.rs");
    const m = rust.match(/fn default_agent_max_turns\(\)\s*->\s*u32\s*\{\s*(\d+)\s*\}/);
    expect(m, "default_agent_max_turns introuvable dans lib.rs").toBeTruthy();
    expect(m[1]).toBe("200");
  });

  it("le champ HTML affiche la même valeur par défaut", () => {
    const html = read("index.html");
    const m = html.match(/id="setting-agent-max-turns"[^>]*value="(\d+)"/);
    expect(m, "champ setting-agent-max-turns introuvable dans index.html").toBeTruthy();
    expect(m[1]).toBe("200");
  });

  it("les replis JS des Paramètres utilisent la même valeur", () => {
    const js = read("src/js/settings.js");
    const values = [...js.matchAll(/agent_max_turns[^,\n]*\|\|\s*(\d+)/g)].map((x) => x[1]);
    expect(values.length, "aucun repli agent_max_turns trouvé dans settings.js").toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toBe("200");
    }
  });
});
