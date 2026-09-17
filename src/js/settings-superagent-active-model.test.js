// settings-superagent-active-model.test.js — Issue #88 (lot 2) : le MODÈLE ACTIF
// de l'Assistant (clé `super_agent_model`) doit survivre à un enregistrement des
// Paramètres. Il est DISTINCT du modèle PAR DÉFAUT dédié (`super_agent_default_model`,
// réglage durable exposé dans Paramètres → Modèles IA).
//
// Cause : `save_config` remplace TOUTE la configuration (src-tauri/src/lib.rs,
// `fn save_config`). Si l'objet config construit par settings.js n'expose pas
// `super_agent_model`, la clé persistée par `set_super_agent_model`
// (src-tauri/src/super_agent.rs) est réinitialisée à vide à chaque
// enregistrement, et l'Assistant repart sur son modèle par défaut au prochain
// démarrage de session.
//
// Comme les tests voisins (settings-defaults.test.js,
// settings-superagent-default-model.test.js), ce test lit les sources réelles
// (aucun DOM) : il est ROUGE avant le correctif et VERT après.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const ACTIVE = "super_agent_model";
const DEFAULT = "super_agent_default_model";

// Entrée `super_agent_model: …` de l'objet config envoyé à save_config.
// `^` multiligne après `\s*` : ne peut PAS matcher `super_agent_default_model:`.
const activeEntry = (js) => js.match(/^\s*super_agent_model\s*:\s*([^\n]*)/m);

describe("issue #88 (lot 2) — le modèle ACTIF survit à l'enregistrement des Paramètres", () => {
  it("settings.js préserve le modèle actif dans l'objet config sauvegardé", () => {
    const js = read("src/js/settings.js");
    const m = activeEntry(js);
    expect(m, "clé `super_agent_model` absente de l'objet config de settings.js").toBeTruthy();
    // La valeur vient de la config COURANTE (réglage sans UI, comme les autres).
    expect(m[1]).toMatch(/currentConfig\?\.super_agent_model/);
  });

  it("le modèle actif n'est pas confondu avec le modèle par défaut", () => {
    const js = read("src/js/settings.js");
    const m = activeEntry(js);
    expect(m[1]).not.toMatch(/inputSuperAgentDefaultModel/);
    // Les deux clés coexistent : le réglage durable reste exposé séparément.
    expect(js).toMatch(new RegExp(`^\\s*${DEFAULT}\\s*:`, "m"));
    expect(js).toContain('invoke("set_super_agent_model"');
    expect(js).toContain('invoke("set_super_agent_default_model"');
  });

  it("côté Rust la clé du modèle actif existe avec un défaut (configs anciennes)", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(
      new RegExp(`#\\[serde\\(default\\)\\][\\s\\S]{0,80}${ACTIVE}\\s*:\\s*String`)
    );
    // La commande qui écrit le modèle actif persiste bien la clé.
    const sa = read("src-tauri/src/super_agent.rs");
    expect(sa).toMatch(new RegExp(`cfg\\.${ACTIVE}\\s*=`));
  });
});
