// help-delai-inactivite.test.js — Garde-fou : la valeur annoncée du timeout
// d'inactivité des agents doit toujours être celle du code.
//
// Motif (rapport-delai-inactivite.md, racine du projet) : le passage de 5 min à
// 10 min (commit 31707a9, issue #19) a modifié le code SANS toucher les
// fichiers de documentation. L'aide intégrée a donc annoncé « 5 min par
// défaut » pendant plusieurs versions alors que le défaut réel était 10 min.
// Ce test interdit que la divergence se reproduise en silence.
//
// Il lit les sources réelles (même méthode que les autres tests de câblage du
// projet) et compare :
//   - la valeur par défaut du cœur Rust (`default_agent_timeout_ms`) — seule
//     source de vérité : AUCUNE valeur n'est codée en dur ici ;
//   - la valeur de repli du front (`DEFAULT_TIMEOUT_MS`, agents-bus.js) ;
//   - la valeur par défaut du champ de réglage (`index.html`) ;
//   - le repli appliqué à l'enregistrement (`settings.js`) ;
//   - la valeur annoncée dans le bloc HELP de `spec_gestion_agents.md` ;
//   - la valeur réellement présente dans l'aide intégrée générée
//     (`help/handbook.md`, produite par `npm run build:handbook`) : si l'on
//     oublie de régénérer l'aide, ce test rougit.
//
// Invariant DISTINCT, volontairement non vérifié ici : les 300 s de
// `src-tauri/src/agents_md.rs` (`GENERATE_TIMEOUT_SECS`) bornent la génération
// d'AGENTS.md par l'IA. C'est un autre mécanisme, non réglable, et 5 min y est
// la bonne valeur.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
// Normalisation des fins de ligne : un runner Windows (core.autocrlf=true)
// produit un worktree CRLF, les ancres multi-lignes doivent rester trouvables.
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const LIB_RS = read("src-tauri/src/lib.rs");
const BUS_JS = read("src/js/agents-bus.js");
const INDEX_HTML = read("index.html");
const SETTINGS_JS = read("src/js/settings.js");
const SPEC = read("spec_gestion_agents.md");
const HANDBOOK = read("help/handbook.md");

/** Défaut du cœur Rust — seule source de vérité de ce fichier de test. */
function defaultTimeoutMs() {
  const m = LIB_RS.match(/fn default_agent_timeout_ms\(\)\s*->\s*u32\s*\{\s*(\d+)\s*\}/);
  expect(m, "default_agent_timeout_ms() introuvable dans src-tauri/src/lib.rs").toBeTruthy();
  return Number(m[1]);
}

const TIMEOUT_MS = defaultTimeoutMs();
const TIMEOUT_MIN = TIMEOUT_MS / 60000;

/** 600000 -> "600 000" (séparateur de milliers tel qu'annoncé dans la doc). */
const groupDigits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Neutralise les espaces (dont insécables) pour comparer deux phrases. */
const normalize = (s) => String(s).replace(/[\u00A0\u202F\u2007 ]+/g, " ").trim();

/** Ligne du bloc HELP `agents` (aide intégrée) qui décrit ce réglage. */
function helpTimeoutLine() {
  const block = (SPEC.match(/<!--\s*HELP:agents\s*-->[\s\S]*?<!--\s*\/HELP:agents\s*-->/) || [""])[0];
  expect(block, "bloc HELP:agents introuvable dans spec_gestion_agents.md").not.toBe("");
  return block.split("\n").find((l) => l.includes("Timeout d'inactivité"));
}

/** Ligne de la section technique « Garde-fous » (hors aide utilisateur). */
function techTimeoutLine() {
  return SPEC.split("\n").find((l) => l.includes("Timeout d'inactivité : "));
}

describe("Délai d'inactivité des agents — valeur annoncée = valeur du code", () => {
  it("le défaut du cœur Rust est un nombre entier de minutes", () => {
    expect(TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(TIMEOUT_MIN), `${TIMEOUT_MS} ms n'est pas un nombre entier de minutes`).toBe(true);
  });

  it("le front utilise la même valeur de repli que le cœur Rust", () => {
    const m = BUS_JS.match(/const DEFAULT_TIMEOUT_MS = (\d+);/);
    expect(m, "DEFAULT_TIMEOUT_MS introuvable dans src/js/agents-bus.js").toBeTruthy();
    expect(Number(m[1])).toBe(TIMEOUT_MS);
  });

  it("le champ de réglage de l'interface affiche la même valeur par défaut", () => {
    const m = INDEX_HTML.match(/id="setting-agent-timeout-ms"[^>]*value="(\d+)"/);
    expect(m, "#setting-agent-timeout-ms (avec une valeur par défaut) introuvable dans index.html").toBeTruthy();
    expect(Number(m[1])).toBe(TIMEOUT_MS);
  });

  it("l'enregistrement applique le même repli quand le champ est vide", () => {
    const m = SETTINGS_JS.match(/agent_timeout_ms:\s*parseInt\([^)]*\)\s*\|\|\s*(\d+)/);
    expect(m, "repli d'enregistrement de agent_timeout_ms introuvable dans src/js/settings.js").toBeTruthy();
    expect(Number(m[1])).toBe(TIMEOUT_MS);
  });

  it("l'aide utilisateur annonce la valeur réelle et son caractère réglable", () => {
    const line = helpTimeoutLine();
    expect(line, "l'aide ne parle plus du timeout d'inactivité").toBeTruthy();
    // La valeur réelle, en millisecondes et en minutes, est annoncée.
    expect(normalize(line)).toContain(`${groupDigits(TIMEOUT_MS)} ms`);
    expect(normalize(line)).toContain(`${TIMEOUT_MIN} min par défaut`);
    // Le réglage est bien présenté comme modifiable.
    expect(line).toContain("Options → Agents");
    // L'ancienne valeur périmée a disparu.
    expect(line).not.toMatch(/\(\s*5 min par défaut\s*\)/);
  });

  it("la section technique des garde-fous annonce la valeur réelle", () => {
    const line = techTimeoutLine();
    expect(line, "section technique « Garde-fous » : ligne du timeout introuvable").toBeTruthy();
    expect(normalize(line)).toContain(`${groupDigits(TIMEOUT_MS)} ms`);
    expect(normalize(line)).toContain(`${TIMEOUT_MIN} min`);
    expect(line).not.toContain("300 s (5 min, défaut)");
  });

  it("l'aide intégrée générée est à jour (npm run build:handbook)", () => {
    const expected = helpTimeoutLine();
    const actual = HANDBOOK.split("\n").find(
      (l) => l.includes("Timeout d'inactivité") && l.includes("la run s'arrête"),
    );
    expect(actual, "l'aide intégrée ne parle plus du timeout d'inactivité").toBeTruthy();
    // Ligne identique à celle de la spec source : l'aide n'a pas été régénérée
    // dans un sens ni dans l'autre (doc modifiée sans rebuild du handbook).
    expect(normalize(actual)).toBe(normalize(expected));
  });

  it("aucun fichier de documentation n'annonce plus 5 min par défaut", () => {
    for (const [file, text] of [
      ["spec_gestion_agents.md", SPEC],
      ["help/handbook.md", HANDBOOK],
    ]) {
      expect(text, `${file} annonce encore « 5 min par défaut »`).not.toContain("(5 min par défaut)");
    }
  });
});
