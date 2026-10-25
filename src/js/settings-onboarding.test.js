// settings-onboarding.test.js — Socle de la prise en main à la première
// ouverture (spec_onboarding.md). Ce lot ne montre RIEN à l'écran : les écrans
// viennent aux lots suivants. Les tests ci-dessous verrouillent le CÂBLAGE
// invisible — c'est-à-dire les deux endroits où le socle se perdrait
// silencieusement :
//   1. `save_config` réécrit TOUTE la configuration : si l'objet config
//      construit par settings.js n'expose pas le champ « déjà vu », il repasse à
//      faux à chaque enregistrement des Paramètres et la prise en main
//      réapparaîtrait (même famille de bug que settings-tracabilite.test.js) ;
//   2. le critère d'affichage doit rester CUMULATIF (fichier de configuration
//      absent ET jamais vu) : un simple drapeau ferait voir la modale à une
//      installation existante, forcément dépourvue du champ.
//
// Même méthode que les tests de câblage voisins : lecture des sources réelles
// (aucun DOM), ROUGE avant le branchement, VERT après.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sliceSource, sliceFrom } from "./source-slice.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Fins de ligne normalisées (worktree CRLF sous Windows) — qualité-gate § 3.4.
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const KEY = "onboarding_seen";

// Entrée `clé: …` de l'objet config envoyé à save_config (valeur possiblement
// ternaire sur plusieurs lignes) : on capture jusqu'à la clé suivante ou `}`.
const entry = (js, key) => {
  const m = js.match(new RegExp(`^\\s*${key}\\s*:\\s*([\\s\\S]*?)\\n\\s*(?:[a-z_]+:|\\})`, "m"));
  return m ? m[1] : null;
};

describe("socle de la prise en main — configuration", () => {
  it("côté Rust le champ existe, avec un défaut « pas encore vu »", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(new RegExp(`#\\[serde\\(default\\)\\]\\n\\s*${KEY}: bool`));
    expect(rust).toMatch(new RegExp(`\\n\\s*${KEY}: false,`));
  });

  it("le champ « déjà vu » fait partie de la décision « configuration par défaut »", () => {
    // Sans cette condition, une config dont SEUL ce champ est posé serait jugée
    // « par défaut » et écrasée par le chargement paresseux : la prise en main
    // réapparaîtrait après un redémarrage.
    const rust = read("src-tauri/src/lib.rs");
    const body = sliceSource(
      rust,
      "fn config_is_default(",
      "\n}\n",
      200,
    );
    expect(body).toContain(`config.${KEY} == default.${KEY}`);
  });

  it("settings.js PRÉSERVE la clé dans l'objet config de save_config", () => {
    const js = read("src/js/settings.js");
    const value = entry(js, KEY);
    expect(value, `clé ${KEY} absente de l'objet config de settings.js`).toBeTruthy();
    // Préservation de la valeur COURANTE, jamais une valeur recalculée : un
    // enregistrement des Paramètres ne doit pas « oublier » que l'utilisateur a
    // déjà vu la prise en main.
    expect(value).toMatch(/currentConfig\?\.onboarding_seen\s*===\s*true/);
  });
});

describe("socle de la prise en main — critère d'affichage verrouillé", () => {
  it("la décision reste une fonction PURE à deux faits, cumulative", () => {
    const rust = read("src-tauri/src/lib.rs");
    const m = rust.match(/fn onboarding_should_show\(config_file_exists: bool, onboarding_seen: bool\) -> bool \{\n\s*([^\n]+)\n\}/);
    expect(m, "déclaration de onboarding_should_show introuvable").toBeTruthy();
    // Les DEUX faits sont nécessaires : le drapeau seul ne suffit jamais.
    expect(m[1]).toContain("!config_file_exists");
    expect(m[1]).toContain("!onboarding_seen");
  });

  it("la commande de lecture seule est enregistrée (aucune écriture)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(/#\[tauri::command\]\nfn get_onboarding_state\(/);
    const handler = rust.match(/tauri::generate_handler!\[([\s\S]*?)\n\s*\]\)/);
    expect(handler, "liste des commandes introuvable").toBeTruthy();
    expect(handler[1]).toMatch(/^\s*get_onboarding_state,\s*$/m);
    // Lecture seule : la commande ne doit JAMAIS écrire la configuration.
    const body = sliceFrom(rust, "fn get_onboarding_state(");
    const cmd = sliceSource(body, "fn get_onboarding_state(", "\n}\n", 200);
    expect(cmd).not.toContain("save_config_disk");
    expect(cmd).not.toContain("save_config");
  });
});
