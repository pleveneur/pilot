// settings-long-tasks.test.js — Lot A idée 1, tranche 1.4 : le réglage
// « Détecter les tâches longues et proposer un agent » doit être LISIBLE et
// ÉCRIT par la modale des Paramètres (section « Assistant »), et l'affichage de
// la pastille « longue » doit le CONSULTER.
//
// Défaut = ACTIVÉ (mode « proposer ») : `super_agent_long_tasks_enabled` absent
// de la configuration (toutes les configs existantes) laisse la pastille et son
// infobulle exactement comme en tranche 1.3. Désactivé ⇒ l'interface redevient
// celle d'avant l'idée 1 : aucune pastille ni infobulle. Le signal reste calculé
// par le cœur et rien n'est modifié en base : ce réglage ne touche QUE
// l'affichage.
//
// Même méthode que les tests de câblage voisins (settings-tracabilite.test.js,
// settings-show-time.test.js) : lecture des sources réelles (aucun DOM).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const KEY = "super_agent_long_tasks_enabled";
const LABEL = "Détecter les tâches longues et proposer un agent";

// Entrée `clé: …` de l'objet config envoyé à save_config (valeur possiblement
// ternaire sur plusieurs lignes) : on capture jusqu'à la clé suivante ou `}`.
const entry = (js, key) => {
  const m = js.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\s\\S]*?)\\n\\s*(?:[a-z_]+:|\\})`, "m"));
  return m ? m[1] : null;
};

// Fenêtre de source d'une fonction nommée (déclaration → accolades appairées).
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `déclaration de ${name} introuvable`).toBeGreaterThan(-1);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return src.slice(start, i);
}

describe("tranche 1.4 — ligne de réglage dans les Paramètres → Assistant", () => {
  it("index.html expose la ligne et son libellé, décochée en dur", () => {
    const html = read("index.html");
    expect(html).toContain('id="setting-superagent-long-tasks"');
    expect(html).toContain(LABEL);
    // La valeur initiale vient de la configuration (jamais cochée en dur).
    expect(html).toMatch(/id="setting-superagent-long-tasks"\s*\/>/);
  });

  it("index.html porte la phrase d'explication (Pilot propose, ne lance rien)", () => {
    const html = read("index.html");
    expect(html).toMatch(
      /setting-superagent-long-tasks[\s\S]{0,1600}?Pilot signale les demandes longues et propose de les confier à un agent, sans jamais lancer d'agent tout seul\./
    );
  });

  it("settings.js LIT la valeur au chargement de la modale (défaut activé)", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/getElementById\("setting-superagent-long-tasks"\)/);
    const load = js.match(/chkSuperAgentLongTasks\.checked = currentConfig\.(\w+)\s*!==\s*false/);
    expect(load, "lecture du réglage avec défaut « activé »").toBeTruthy();
    expect(load[1]).toBe(KEY);
  });

  it("settings.js ÉCRIT la clé exacte dans l'objet config de save_config", () => {
    const js = read("src/js/settings.js");
    const value = entry(js, KEY);
    expect(value, `clé ${KEY} absente de l'objet config de settings.js`).toBeTruthy();
    // Défaut « activé » quand le contrôle est absent du DOM.
    expect(value).toMatch(/chkSuperAgentLongTasks\.checked\s*!==\s*false/);
    expect(value).toMatch(/:\s*true\b/);
  });

  it("aucune autre clé de l'Assistant n'est perdue à la sauvegarde", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/^\s*super_agent_checklist_mode\s*:/m);
    expect(js).toMatch(/^\s*super_agent_checklist_template\s*:/m);
    expect(js).toMatch(/^\s*super_agent_tracabilite_enabled\s*:/m);
    expect(js).toMatch(/^\s*super_agent_show_time\s*:/m);
    expect(js).toMatch(/^\s*super_agent_schedule_interval_secs\s*:/m);
    expect(js).toMatch(/^\s*super_agent_quality_gate\s*:/m);
    expect(js).toMatch(/^\s*super_agent_purge_before_delegate\s*:/m);
    // Le réglage existant de coordination reste intact : on n'y touche pas.
    expect(js).toMatch(/^\s*super_agent_coordinator\s*:/m);
    // Les rappels programmés (`assistant_schedules`) vivent en base : intacts.
    expect(js).not.toContain("assistant_schedules");
  });
});

describe("tranche 1.4 — l'affichage de la pastille CONSULTE le réglage", () => {
  it("le réglage est lu en configuration dans une fonction dédiée (lecture seule)", () => {
    const src = read("src/js/super-agent-kanban-view.js");
    const loader = extractFunction(src, "loadLongTasksConfig");
    expect(loader).toMatch(/invoke\("get_config"\)/);
    // Absence de la clé (ou valeur illisible) ⇒ défaut « activé ».
    expect(loader).toMatch(
      /longTasksEnabled = !\(cfg && cfg\.super_agent_long_tasks_enabled === false\)/
    );
    expect(loader).not.toContain("save");
  });

  it("la lecture est branchée AU MONTAGE, avant le rendu des cartes", () => {
    const src = read("src/js/super-agent-kanban-view.js");
    const loader = src.indexOf("await loadLongTasksConfig();");
    expect(loader, "appel de loadLongTasksConfig absent").toBeGreaterThan(-1);
    const render = src.indexOf("renderKanban();", loader);
    expect(render, "le rendu doit suivre la lecture du réglage").toBeGreaterThan(loader);
  });

  it("éteint ⇒ aucune pastille « longue » ni infobulle ; allumé ⇒ rendu inchangé", () => {
    const src = read("src/js/super-agent-kanban-view.js");
    // Le signal du serveur n'est même pas transformé en pastille quand éteint.
    expect(src).toMatch(
      /const longPill = longTasksEnabled \? longTaskPill\(t\) : null;/
    );
    // L'insertion reste conditionnée à `longPill` (donc rien quand éteint).
    expect(src).toMatch(/\$\{longPill \? `<span class="kanban-long-pill/);
    // Défaut du module : ACTIVÉ (une config illisible ne masque rien).
    expect(src).toMatch(/let longTasksEnabled = true;/);
  });

  it("côté Rust la clé existe avec un défaut « activé » (champ absent = vrai)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(
      new RegExp(`#\\[serde\\(default = "default_true"\\)\\][\\s\\S]{0,900}${KEY}\\s*:\\s*bool`)
    );
    expect(rust).toMatch(new RegExp(`${KEY}: true`));
  });
});
