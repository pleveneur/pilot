// settings-tracabilite.test.js — Lot A idée 4, tranche 5b : le réglage
// « Enregistrer une ligne de traçabilité à chaque livraison » doit être LISIBLE
// et ÉCRIT par la modale des Paramètres (section « Assistant »), sans casser
// aucun réglage existant.
//
// Cause : `save_config` remplace TOUTE la configuration (src-tauri/src/lib.rs,
// `fn save_config`). Si l'objet config construit par settings.js n'expose pas
// `super_agent_tracabilite_enabled`, la clé est réinitialisée à son défaut à
// chaque enregistrement — et un réglage désactivé ne le resterait pas.
//
// Même méthode que les tests voisins (settings-checklist-reglages.test.js) :
// lecture des sources réelles (aucun DOM), ROUGE avant le correctif, VERT après.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const KEY = "super_agent_tracabilite_enabled";

// Entrée `clé: …` de l'objet config envoyé à save_config. La valeur peut tenir
// sur plusieurs lignes (ternaire) : on capture jusqu'à la clé suivante.
const entry = (js, key) => {
  const m = js.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\s\\S]*?)\\n\\s*(?:[a-z_]+:|\\})`, "m"));
  return m ? m[1] : null;
};

describe("tranche 5b — réglage de traçabilité dans les Paramètres", () => {
  it("index.html expose la ligne de réglage de la section « Assistant »", () => {
    const html = read("index.html");
    expect(html).toContain('id="setting-superagent-tracabilite"');
    expect(html).toContain("Enregistrer une ligne de traçabilité à chaque livraison");
    // Case NON cochée en dur : la valeur initiale vient de la configuration
    // (même forme que les réglages voisins `setting-superagent-*`).
    expect(html).toContain('id="setting-superagent-tracabilite" />');
    // Explication courte sous la ligne (pas de feuille de style ajoutée).
    expect(html).toMatch(
      /setting-superagent-tracabilite[\s\S]{0,900}?demande d'origine/
    );
  });

  it("settings.js LIT la valeur au chargement de la modale", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/getElementById\("setting-superagent-tracabilite"\)/);
    const load = js.match(/chkSuperAgentTracabilite\.checked = currentConfig\.(\w+)\s*!==\s*false/);
    expect(load, "lecture du réglage avec défaut « activé »").toBeTruthy();
    expect(load[1]).toBe(KEY);
  });

  it("settings.js ÉCRIT la clé exacte dans l'objet config de save_config", () => {
    const js = read("src/js/settings.js");
    const value = entry(js, KEY);
    expect(value, `clé ${KEY} absente de l'objet config de settings.js`).toBeTruthy();
    // Défaut « activé » quand le contrôle est absent : jamais de désactivation
    // silencieuse d'un réglage non touché.
    expect(value).toMatch(/chkSuperAgentTracabilite\.checked\s*!==\s*false/);
    expect(value).toMatch(/:\s*true\b/);
  });

  it("aucune autre clé de l'Assistant n'est perdue à la sauvegarde", () => {
    const js = read("src/js/settings.js");
    // Fréquence des rappels, compteur « n sur 20 », checklist (mode + modèle),
    // prompt, quality-gate, purge avant délégation, mémoire de projet…
    expect(js).toMatch(/^\s*super_agent_schedule_interval_secs\s*:/m);
    expect(js).toContain("refreshSuperAgentScheduleCount(superAgentScheduleCount)");
    expect(js).toMatch(/^\s*super_agent_checklist_mode\s*:/m);
    expect(js).toMatch(/^\s*super_agent_checklist_template\s*:/m);
    expect(js).toMatch(/^\s*super_agent_prompt\s*:/m);
    expect(js).toMatch(/^\s*super_agent_quality_gate\s*:/m);
    expect(js).toMatch(/^\s*super_agent_purge_before_delegate\s*:/m);
    expect(js).toMatch(/^\s*super_agent_tasks_tab_enabled\s*:/m);
    expect(js).toMatch(/^\s*project_memory_enabled\s*:/m);
    // Les rappels programmés (`assistant_schedules`) vivent en base : intacts.
    expect(js).not.toContain("assistant_schedules");
  });

  it("côté Rust la clé existe avec un défaut « activé » (champ absent = vrai)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(
      new RegExp(`#\\[serde\\(default = "default_true"\\)\\][\\s\\S]{0,80}${KEY}\\s*:\\s*bool`)
    );
    expect(rust).toMatch(new RegExp(`${KEY}: true`));
  });
});
