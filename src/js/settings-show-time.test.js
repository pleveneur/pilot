// settings-show-time.test.js — Lot A idée 2, tranche 5 : le réglage
// « Afficher le suivi du temps estimé / passé » doit être LISIBLE et ÉCRIT par
// la modale des Paramètres (section « Suivi »), et l'affichage du temps doit le
// CONSULTER partout (fiche, cartes, carte de suivi du Tableau de bord).
//
// Défaut = DÉSACTIVÉ : `super_agent_show_time` absent de la configuration (toutes
// les configs existantes) masque entièrement le suivi du temps — ni champs dans
// la fiche, ni pastille sur les cartes, ni total par projet — exactement comme
// avant l'introduction de l'idée 2. Aucune donnée de la base n'est modifiée ni
// masquée : ce réglage ne touche QUE l'affichage.
//
// Même méthode que les tests de câblage voisins (settings-tracabilite.test.js) :
// lecture des sources réelles (aucun DOM), ROUGE avant le branchement, VERT après.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const KEY = "super_agent_show_time";
const LABEL = "Afficher le suivi du temps estimé / passé";

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

describe("tranche 5 — ligne de réglage dans les Paramètres", () => {
  it("index.html expose la ligne et son libellé, décochée en dur", () => {
    const html = read("index.html");
    expect(html).toContain('id="setting-superagent-show-time"');
    expect(html).toContain(LABEL);
    // La valeur initiale vient de la configuration (jamais cochée en dur) :
    // même forme que les réglages voisins `setting-superagent-*`.
    expect(html).toMatch(/id="setting-superagent-show-time"\s*\/>/);
    // Phrase d'explication : le réglage ne change QUE l'affichage.
    expect(html).toMatch(/setting-superagent-show-time[\s\S]{0,1200}?aucune donnée n'est perdue/);
  });

  it("settings.js LIT la valeur au chargement de la modale (défaut désactivé)", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/getElementById\("setting-superagent-show-time"\)/);
    const load = js.match(/chkSuperAgentShowTime\.checked = currentConfig\.(\w+)\s*===\s*true/);
    expect(load, "lecture du réglage avec défaut « désactivé »").toBeTruthy();
    expect(load[1]).toBe(KEY);
  });

  it("settings.js ÉCRIT la clé exacte dans l'objet config de save_config", () => {
    const js = read("src/js/settings.js");
    const value = entry(js, KEY);
    expect(value, `clé ${KEY} absente de l'objet config de settings.js`).toBeTruthy();
    // Défaut « désactivé » quand le contrôle est absent : le suivi du temps
    // reste masqué tant qu'il n'est pas explicitement demandé.
    expect(value).toMatch(/chkSuperAgentShowTime\.checked\s*===\s*true/);
    expect(value).toMatch(/:\s*false\b/);
  });

  it("aucune autre clé de l'Assistant n'est perdue à la sauvegarde", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/^\s*super_agent_checklist_mode\s*:/m);
    expect(js).toMatch(/^\s*super_agent_checklist_template\s*:/m);
    expect(js).toMatch(/^\s*super_agent_tracabilite_enabled\s*:/m);
    expect(js).toMatch(/^\s*super_agent_schedule_interval_secs\s*:/m);
    expect(js).toMatch(/^\s*super_agent_quality_gate\s*:/m);
    expect(js).toMatch(/^\s*super_agent_purge_before_delegate\s*:/m);
    // Les rappels programmés (`assistant_schedules`) vivent en base : intacts.
    expect(js).not.toContain("assistant_schedules");
  });
});

describe("tranche 5 — l'affichage du suivi du temps CONSULTE le réglage", () => {
  it("la carte de suivi du Tableau de bord ne pose le fragment de temps que si le réglage est actif", () => {
    // La vue d'ensemble du suivi a quitté l'onglet Assistant 🧭 pour la carte
    // « Suivi multi-projets » du Tableau de bord 📊 : c'est donc là que se lit
    // désormais le réglage, avec la MÊME clé de configuration.
    const js = read("src/js/dashboard.js");
    expect(js).toMatch(/const showTime = \(cfg \|\| \{\}\)\.super_agent_show_time === true;/);
    // Branchement : le fragment par projet n'est produit que si activé.
    expect(js).toMatch(/const time = showTime \? projectTrackingTimeFragment\(tracked\) : "";/);
  });

  it("les cartes du Kanban ne posent une pastille que si le réglage est actif", () => {
    const src = read("src/js/super-agent-kanban-view.js");
    // Le réglage est lu en configuration dans une fonction dédiée.
    const loader = extractFunction(src, "loadTimeConfig");
    expect(loader).toMatch(/invoke\("get_config"\)/);
    expect(loader).toMatch(/showTime = !!\(cfg && cfg\.super_agent_show_time === true\)/);
    // Il est branché AU MONTAGE (avant le rendu) et à CHAQUE ouverture de fiche.
    const calls = src.match(/await loadTimeConfig\(\);/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/await loadTimeConfig\(\);\s*\n\s*renderKanban\(\);/);
    // La pastille de carte et sa lecture en base sont conditionnées.
    expect(src).toMatch(/const timeLabel = showTime \? taskTimePillLabel\(taskTimes\.get\(t\.id\)\) : "";/);
    expect(src).toMatch(/if \(!showTime\) \{\s*\n\s*applyTimePills\(\);\s*\n\s*return;/);
    // La fiche ne rend le bloc « Temps » que si le réglage est actif.
    expect(src).toMatch(/\$\{isEdit && showTime \? `<div class="kanban-field kanban-checklist kanban-task-time">/);
  });

  it("côté Rust la clé existe avec un défaut « désactivé » (champ absent = faux)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(new RegExp(`#\\[serde\\(default\\)\\][\\s\\S]{0,120}${KEY}\\s*:\\s*bool`));
    expect(rust).toMatch(new RegExp(`${KEY}: false`));
    // Le réglage est exposé à l'interface par la config de l'Assistant.
    const sa = read("src-tauri/src/super_agent.rs");
    expect(sa).toMatch(new RegExp(`"show_time":\\s*cfg\\.${KEY}`));
  });
});
