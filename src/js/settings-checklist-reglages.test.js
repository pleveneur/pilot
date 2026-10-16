// settings-checklist-reglages.test.js — Lot A idée 3, tranche 3.5 : les DEUX
// réglages de la checklist de livraison doivent être lus ET écrits par la modale
// des Paramètres (section « Assistant »), sans casser les réglages existants.
//
// Cause : `save_config` remplace TOUTE la configuration (src-tauri/src/lib.rs,
// `fn save_config`). Si l'objet config construit par settings.js n'expose pas
// `super_agent_checklist_mode` / `super_agent_checklist_template`, ces clés sont
// réinitialisées à leurs défauts à chaque enregistrement des Paramètres.
//
// Même méthode que les tests voisins (settings-superagent-active-model.test.js) :
// lecture des sources réelles (aucun DOM), ROUGE avant le correctif, VERT après.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const MODE = "super_agent_checklist_mode";
const TEMPLATE = "super_agent_checklist_template";

// Entrée `clé: …` de l'objet config envoyé à save_config. La valeur peut tenir
// sur plusieurs lignes (ternaire) : on capture jusqu'à la clé suivante.
const entry = (js, key) => {
  const m = js.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\s\\S]*?)\\n\\s*(?:[a-z_]+:|\\})`, "m"));
  return m ? m[1] : null;
};

describe("tranche 3.5 — réglages de la checklist dans les Paramètres", () => {
  it("index.html expose les deux contrôles de la section « Assistant »", () => {
    const html = read("index.html");
    expect(html).toContain('id="setting-superagent-checklist-mode"');
    expect(html).toContain('id="setting-superagent-checklist-template"');
    // Les trois choix du mode, « rappel simple » étant le défaut affiché.
    expect(html).toMatch(/<option value="off">Désactivée<\/option>/);
    expect(html).toMatch(/<option value="warn">Rappel simple \(défaut\)<\/option>/);
    expect(html).toMatch(/<option value="block">Bloquante<\/option>/);
  });

  it("settings.js LIT les deux valeurs (chargement de la modale)", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/getElementById\("setting-superagent-checklist-mode"\)/);
    expect(js).toMatch(/getElementById\("setting-superagent-checklist-template"\)/);
    expect(js).toMatch(/selectSuperAgentChecklistMode\.value = normalizeChecklistMode\(/);
    expect(js).toMatch(/taSuperAgentChecklistTemplate\.value = normalizeChecklistTemplate\(/);
  });

  it("settings.js ÉCRIT les deux clés dans l'objet config de save_config", () => {
    const js = read("src/js/settings.js");
    const mode = entry(js, MODE);
    const template = entry(js, TEMPLATE);
    expect(mode, `clé ${MODE} absente de l'objet config de settings.js`).toBeTruthy();
    expect(template, `clé ${TEMPLATE} absente de l'objet config de settings.js`).toBeTruthy();
    expect(mode).toMatch(/normalizeChecklistMode\(/);
    expect(template).toMatch(/normalizeChecklistTemplate\(/);
  });

  it("les réglages existants de l'Assistant restent présents et intacts", () => {
    const js = read("src/js/settings.js");
    // Fréquence des rappels, compteur « n sur 20 », onglet « En cours »…
    expect(js).toMatch(/^\s*super_agent_schedule_interval_secs\s*:/m);
    expect(js).toMatch(/normalizeScheduleInterval\(/);
    expect(js).toContain("refreshSuperAgentScheduleCount(superAgentScheduleCount)");
    expect(js).toMatch(/^\s*super_agent_tasks_tab_enabled\s*:/m);
    expect(js).toMatch(/^\s*super_agent_prompt\s*:/m);
    // Aucun réglage de rappels programmés n'est touché par cette tranche.
    expect(js).not.toContain("assistant_schedules");
  });

  it("côté Rust le champ du modèle existe avec une valeur par défaut", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(
      new RegExp(`#\\[serde\\(default = "default_super_agent_checklist_template"\\)\\][\\s\\S]{0,160}${TEMPLATE}\\s*:\\s*String`)
    );
    expect(rust).toMatch(/fn default_super_agent_checklist_template\(\) -> String \{/);
    // Défaut aligné sur le miroir JS : trois points, une ligne par point.
    expect(rust).toContain('["Tests passés", "Documentation à jour", "Rien de non commité"].join("\\n")');
    // Le champ a bien une valeur dans `impl Default for AppConfig`.
    expect(rust).toMatch(new RegExp(`${TEMPLATE}: default_super_agent_checklist_template\\(\\)`));
  });

  it("la fiche de tâche propose les points du modèle SANS rien imposer", () => {
    const view = read("src/js/super-agent-kanban-view.js");
    // Le bouton n'apparaît que via la décision pure (aucun point + mode actif).
    expect(view).toMatch(/shouldOfferTemplatePoints\(\[\], cfg\.mode\)/);
    expect(view).toMatch(/Ajouter les points du modèle/);
    // Il crée les points par la commande d'ajout EXISTANTE (aucune nouvelle route).
    expect(view).toMatch(/invoke\("super_agent_task_check_add", \{ taskId: task\.id, label \}\)/);
    // Les réglages sont relus à chaque ouverture de fiche (jamais mis en cache
    // d'une fiche à l'autre).
    expect(view).toMatch(/checklistCfg = null;/);
  });
});
