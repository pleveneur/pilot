// Tests — Lot A idée 1, tranche 1.5 : non-régression Kanban de la détection
// des tâches longues (pastille « longue », infobulle, réglage).
//
// Objet : verrouiller ce qui a été livré aux tranches 1.1 → 1.4 SANS toucher au
// code de production. Le signal `is_long_task` / `long_task_reason` est CALCULÉ
// PAR LE CŒUR RUST (`detect_long_task`) et arrive DÉJÀ PRÊT dans l'état Kanban :
// l'interface ne détecte RIEN, ne calcule AUCUN seuil et n'invente AUCUNE raison.
//
// Méthode : `super-agent-kanban.js` est un module pur (sans DOM) → `longTaskPill`
// est exercée directement. Les branchements de `super-agent-kanban-view.js`,
// `settings.js` et `index.html` sont verrouillés par LECTURE DE SOURCE (méthode
// déjà employée par les tests voisins, l'environnement de test n'ayant pas de DOM).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LONG_TASK_PILL_LABEL, longTaskPill } from "./super-agent-kanban.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) =>
  readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

const KANBAN_SRC = read("src/js/super-agent-kanban.js");
const VIEW_SRC = read("src/js/super-agent-kanban-view.js");
const SETTINGS_SRC = read("src/js/settings.js");
const INDEX_HTML = read("index.html");

const KEY = "super_agent_long_tasks_enabled";
const LABEL = "Détecter les tâches longues et proposer un agent";

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

// ── 1. Aucune détection locale dans l'interface ────────────────────────────

describe("tranche 1.5 — l'interface ne détecte RIEN elle-même", () => {
  it("aucun seuil ni liste de mots-clés de détection en JavaScript ou HTML", () => {
    // Fichiers d'interface réels (hors tests) : tous les .js de src/js + index.html.
    const files = [
      ...readdirSync(resolve(root, "src/js"))
        .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
        .map((f) => `src/js/${f}`),
      "index.html",
    ];
    // Les noms EXACTS des seuils et listes du cœur Rust ne doivent jamais être
    // recopiés côté interface, et la fonction de détection n'est jamais appelée.
    for (const p of files) {
      const src = read(p);
      for (const forbidden of [
        "LONG_TASK_MIN_STEPS",
        "LONG_TASK_MIN_FILES",
        "LONG_TASK_MIN_CHARS",
        "LONG_TASK_KEYWORDS",
        "LONG_TASK_FILE_EXTENSIONS",
        "detect_long_task(",
      ]) {
        expect(src, `${forbidden} ne doit pas exister dans ${p}`).not.toContain(forbidden);
      }
    }
  });

  it("`longTaskPill` ne lit QUE les deux champs du serveur", () => {
    const fn = slice(KANBAN_SRC, "export function longTaskPill(task)", "\n}\n");
    expect(fn).toContain("task.is_long_task");
    expect(fn).toContain("task.long_task_reason");
    // Ni titre, ni description, ni longueur : aucune détection locale possible.
    expect(fn).not.toContain("title");
    expect(fn).not.toContain("description");
    expect(fn).not.toContain("length");
    expect(fn).not.toMatch(/\.match\(|\.includes\(|\.split\(/);
  });

  it("la raison est recopiée TELLE QUELLE, jamais reformulée ni inventée", () => {
    const reason = "mot-clé « refonte » · 12 fichiers cités";
    expect(longTaskPill({ is_long_task: true, long_task_reason: reason })).toEqual({
      label: LONG_TASK_PILL_LABEL,
      reason,
    });
    // Signal vrai sans raison : aucune raison inventée (chaîne vide).
    expect(longTaskPill({ is_long_task: true }).reason).toBe("");
    // Un texte de demande long SANS signal ne déclenche RIEN : le booléen du
    // serveur seul décide.
    expect(
      longTaskPill({
        title: "Refonte",
        description: "12 fichiers cités\n1) a\n2) b\n3) c",
      })
    ).toBeNull();
  });
});

// ── 2. Aucune pastille quand le signal est absent ──────────────────────────

describe("tranche 1.5 — carte ordinaire : aucune pastille, aucun attribut", () => {
  it("`longTaskPill` retourne null pour toute carte non signalée", () => {
    for (const ordinary of [
      null,
      undefined,
      {},
      { is_long_task: false },
      { is_long_task: false, long_task_reason: "3 étapes détectées" },
      { is_long_task: 0 },
    ]) {
      expect(longTaskPill(ordinary)).toBeNull();
    }
  });

  it("la carte n'insère la balise que si `longPill` est non nul", () => {
    const card = slice(VIEW_SRC, "function taskCardHtml(t)", "function ideaCardHtml(");
    // Sans signal, l'expression vaut "" : aucune balise, rien à l'écran.
    expect(card).toContain('${longPill ? `<span class="kanban-long-pill');
    expect(card).toContain('</span>` : ""}');
  });
});

// ── 3. Réglage éteint : ni pastille ni infobulle ───────────────────────────

describe("tranche 1.5 — réglage éteint : l'interface redevient celle d'avant", () => {
  const card = slice(VIEW_SRC, "function taskCardHtml(t)", "function ideaCardHtml(");

  it("la pastille est soumise au réglage (défaut activé, mode proposer)", () => {
    expect(VIEW_SRC).toMatch(/let longTasksEnabled = true;/);
    expect(card).toContain("const longPill = longTasksEnabled ? longTaskPill(t) : null;");
    expect(VIEW_SRC).toMatch(
      /longTasksEnabled = !\(cfg && cfg\.super_agent_long_tasks_enabled === false\)/
    );
  });

  it("éteint, l'infobulle disparaît avec la pastille (une seule condition)", () => {
    // L'infobulle vit DANS le span de la pastille : pas de pastille ⇒ pas de
    // tooltip. Le titre n'est produit que si le cœur a fourni une raison.
    expect(card).toContain('${longPill.reason ? ` title="${escapeAttr(longPill.reason)}"` : ""}');
    expect(card).toContain("${escapeHtml(longPill.label)}");
  });

  it("le réglage est lu en lecture seule avant le rendu, jamais sauvegardé ici", () => {
    const loader = slice(VIEW_SRC, "async function loadLongTasksConfig()", "\n  }\n");
    expect(loader).toContain('invoke("get_config")');
    expect(loader).not.toContain("save");
  });
});

// ── 4. Libellé exact du réglage (celui du plan) ────────────────────────────

describe("tranche 1.5 — libellé exact du réglage dans les Paramètres → Assistant", () => {
  it("le libellé visible est exactement celui du plan", () => {
    expect(INDEX_HTML).toContain(
      `id="setting-superagent-long-tasks"`
    );
    expect(INDEX_HTML).toContain(`>${LABEL}</label>`);
    // La case n'est jamais cochée en dur : sa valeur vient de la configuration.
    expect(INDEX_HTML).toMatch(/id="setting-superagent-long-tasks"\s*\/>/);
  });

  it("settings.js LIT et ÉCRIT la clé exacte (les autres clés préservées)", () => {
    expect(SETTINGS_SRC).toContain('getElementById("setting-superagent-long-tasks")');
    expect(SETTINGS_SRC).toMatch(
      /chkSuperAgentLongTasks\.checked = currentConfig\.super_agent_long_tasks_enabled !== false/
    );
    expect(SETTINGS_SRC).toMatch(
      /super_agent_long_tasks_enabled: chkSuperAgentLongTasks \? chkSuperAgentLongTasks\.checked !== false : true/
    );
    // Aucun autre réglage de l'Assistant n'est perdu, et `assistant_schedules`
    // (rappels en base) reste hors de la modale.
    for (const other of [
      "super_agent_checklist_mode",
      "super_agent_tracabilite_enabled",
      "super_agent_show_time",
      "super_agent_coordinator",
    ]) {
      expect(SETTINGS_SRC).toContain(other);
    }
    expect(SETTINGS_SRC).not.toContain("assistant_schedules");
  });

  it("la clé Rust a bien un défaut « activé » (champ absent = vrai)", () => {
    const rust = read("src-tauri/src/super_agent.rs");
    expect(KEY).toBe("super_agent_long_tasks_enabled");
    expect(rust).toContain("super_agent_long_tasks_enabled");
  });
});

// ── 5. Les autres informations de la carte sont intactes ───────────────────

describe("tranche 1.5 — la pastille ne change RIEN d'autre sur la carte", () => {
  const card = slice(VIEW_SRC, "function taskCardHtml(t)", "function ideaCardHtml(");

  it("compteur de checklist, pastille de temps, projet, dépendance et outils intacts", () => {
    expect(card).toContain("const checkLabel = checklistCounterLabel(checkCounts.get(t.id));");
    expect(card).toContain("const timeLabel = showTime ? taskTimePillLabel(taskTimes.get(t.id)) : \"\";");
    expect(card).toContain("${proj ? `<div class=\"super-kanban-card-proj\">");
    expect(card).toContain("${waiting ? `<div class=\"super-kanban-card-dependency\"");
    expect(card).toContain('<div class="super-kanban-card-tools">');
    // La carte elle-même ne reçoit aucune classe nouvelle.
    expect(card).toContain(
      'return `<div class="super-kanban-card${blocked ? " blocked" : ""}${waiting ? " waiting-dep" : ""}" draggable="true" data-task-id="${t.id}">'
    );
  });
});
