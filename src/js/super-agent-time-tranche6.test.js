// Tests de bout en bout — Lot A idée 2, tranche 6 : les règles du temps estimé /
// passé sont VERROUILLÉES côté interface. Aucun code de production n'est touché
// par cette tranche : uniquement des tests (plus le rapport).
//
// Méthode : `super-agent-kanban.js` est importable (fonctions pures exportées,
// sans DOM ni invoke) → on les exerce DIRECTEMENT. `super-agent.js`,
// `super-agent-kanban-view.js`, `dashboard.js` et le cœur Rust sont des modules
// à DOM / AppHandle : leurs branchements sont verrouillés par LECTURE DE SOURCE,
// méthode déjà employée par `super-agent-tracking-time.test.js` et
// `super-agent-task-time.test.js`. Les helpers purs de `dashboard.js` (le total
// par projet y a déménagé avec la carte de suivi multi-projets) sont en plus
// EXTRAITS puis évalués, pour les exercer réellement.
//
// Contrat verrouillé : la PRÉSENCE d'un temps se lit sur `*_set`, jamais sur la
// valeur (`0` est faux en JavaScript) ; quand le réglage d'affichage est éteint
// (défaut), ni champs, ni pastille, ni total ne s'affichent.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TASK_TIME_GET_COMMAND,
  TASK_TIME_SET_ESTIMATED_COMMAND,
  TASK_TIME_ADD_SPENT_COMMAND,
  NO_ESTIMATE_TEXT,
  taskTimePillLabel,
  taskTimeSummaryLabel,
} from "./super-agent-kanban.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const KANBAN_SRC = read("src/js/super-agent-kanban.js");
const VIEW_SRC = read("src/js/super-agent-kanban-view.js");
const DASHBOARD_SRC = read("src/js/dashboard.js");
const RUST_SRC = read("src-tauri/src/super_agent.rs");
const LIB_SRC = read("src-tauri/src/lib.rs");

// ── Extraction des helpers purs de `super-agent.js` (lecture de source) ──────

/** Extrait le texte complet d'une déclaration `function <name>(…) { … }`. */
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

const HELPERS_SRC = [
  extractFunction(DASHBOARD_SRC, "normalizeTrackingMinutes"),
  extractFunction(DASHBOARD_SRC, "formatTrackingMinutes"),
  extractFunction(DASHBOARD_SRC, "projectTrackingTimeFragment"),
].join("\n");

const { projectTrackingTimeFragment } = new Function(
  `${HELPERS_SRC}\nreturn { projectTrackingTimeFragment };`
)();

// Fenêtre de source de `loadTimeConfig` (lecture seule du réglage).
const LOAD_TIME_CONFIG_SRC = extractFunction(VIEW_SRC, "loadTimeConfig");

// ── 1. Noms EXACTS des trois commandes utilisées ────────────────────────────

describe("noms exacts des trois commandes du temps", () => {
  it("expose les trois commandes attendues par le cœur (tranche 2.2)", () => {
    expect(TASK_TIME_GET_COMMAND).toBe("super_agent_task_time_get");
    expect(TASK_TIME_SET_ESTIMATED_COMMAND).toBe("super_agent_task_time_set_estimated");
    expect(TASK_TIME_ADD_SPENT_COMMAND).toBe("super_agent_task_time_add_spent");
  });

  it("les noms sont bien enregistrés côté cœur (#[tauri::command] + handler)", () => {
    for (const cmd of [TASK_TIME_GET_COMMAND, TASK_TIME_SET_ESTIMATED_COMMAND, TASK_TIME_ADD_SPENT_COMMAND]) {
      expect(RUST_SRC).toContain(`pub fn ${cmd}(`);
      expect(LIB_SRC).toContain(`super_agent::${cmd},`);
    }
  });
});

// ── 2. Pastille : absente sans temps, jamais un chiffre inventé ─────────────

describe("pastille des cartes — aucune valeur renseignée", () => {
  it("n'affiche RIEN quand les deux temps sont non renseignés", () => {
    for (const empty of [null, undefined, {}, { estimated_minutes: null, spent_minutes: null, estimated_set: false, spent_set: false }]) {
      expect(taskTimePillLabel(empty)).toBe("");
    }
    // La pastille n'est alors jamais insérée dans la carte.
    expect(VIEW_SRC).toContain('${timeLabel ? `<span class="kanban-time-pill');
  });

  it("quand SEUL le passé est renseigné : « pas d'estimation », jamais un écart", () => {
    expect(NO_ESTIMATE_TEXT).toBe("pas d'estimation");
    expect(taskTimePillLabel({ spent_minutes: 70, spent_set: true })).toBe("pas d'estimation · 70 min passées");
    expect(taskTimeSummaryLabel({ spent_minutes: 70, spent_set: true })).toBe("pas d'estimation · 70 min passées");
  });

  it("un zéro SAISI s'affiche « 0 min » (la présence vient de `*_set`)", () => {
    expect(taskTimePillLabel({ estimated_minutes: 0, estimated_set: true })).toBe("0 min prévues");
    expect(taskTimePillLabel({ spent_minutes: 0, spent_set: true })).toBe("pas d'estimation · 0 min passées");
    expect(
      taskTimePillLabel({ estimated_minutes: 0, spent_minutes: 0, estimated_set: true, spent_set: true })
    ).toBe("0 min prévues / 0 min passées");
    // Une valeur non nulle mais NON renseignée est masquée (jamais déduite).
    expect(taskTimePillLabel({ estimated_minutes: 45, spent_minutes: 30 })).toBe("");
  });
});

// ── 3. Total par projet : absent quand rien n'est renseigné ─────────────────

describe("total par projet — aucune mention quand rien n'est renseigné", () => {
  it("renvoie une chaîne vide si aucun des deux temps n'est renseigné", () => {
    expect(projectTrackingTimeFragment({})).toBe("");
    expect(projectTrackingTimeFragment(null)).toBe("");
    expect(
      projectTrackingTimeFragment({ estimated_minutes: null, spent_minutes: null, estimated_set: false, spent_set: false })
    ).toBe("");
    // Anciennes données : champs totalement absents → aucune mention.
    expect(projectTrackingTimeFragment({ name: "pilot", tasks_en_cours: 3 })).toBe("");
  });

  it("n'affiche que les temps réellement renseignés, sans addition", () => {
    expect(projectTrackingTimeFragment({ spent_minutes: 135, spent_set: true })).toBe("2 h 15 passées");
    expect(projectTrackingTimeFragment({ estimated_minutes: 240, estimated_set: true })).toBe("4 h prévues");
    expect(projectTrackingTimeFragment({ estimated_minutes: 0, estimated_set: true })).toBe("0 min prévues");
  });
});

// ── 4. Réglage ÉTEINT : ni champs, ni pastille, ni total ────────────────────

describe("réglage éteint (`super_agent_show_time`, défaut) — rien ne s'affiche", () => {
  // Normalisation : on ignore les espaces/retours à la ligne pour verrouiller
  // l'esprit du branchement sans dépendre de la mise en forme exacte.
  const flatView = VIEW_SRC.replace(/\s+/g, " ");
  const flatDashboard = DASHBOARD_SRC.replace(/\s+/g, " ");

  it("la pastille des cartes est conditionnée au réglage", () => {
    expect(flatView).toContain('const timeLabel = showTime ? taskTimePillLabel(taskTimes.get(t.id)) : "";');
  });

  it("ni lecture en base ni pastille quand le réglage est éteint", () => {
    // Aucune lecture (donc aucun chiffre) si le suivi est masqué…
    expect(flatView).toContain("if (!showTime) { applyTimePills(); return; }");
    // …et les pastilles déjà rendues sont RETIRÉES (aucun résidu).
    expect(flatView).toContain(
      "if (!showTime) { container.querySelectorAll(\".super-kanban-card .kanban-time-pill\").forEach((el) => el.remove()); return; }"
    );
  });

  it("le bloc « Temps » de la fiche (champs de saisie) exige le réglage", () => {
    expect(flatView).toContain(
      '${isEdit && showTime ? `<div class="kanban-field kanban-checklist kanban-task-time">'
    );
  });

  it("le total par projet de la carte de suivi du Tableau de bord exige le réglage", () => {
    // La vue d'ensemble a quitté l'onglet Assistant : c'est la carte « Suivi
    // multi-projets » du Tableau de bord qui porte ce total, et elle consulte le
    // MÊME réglage (`super_agent_show_time`, via get_config).
    expect(flatDashboard).toContain(
      'const showTime = (cfg || {}).super_agent_show_time === true;'
    );
    expect(flatDashboard).toContain('const time = showTime ? projectTrackingTimeFragment(tracked) : "";');
  });
});

// ── 5. Le réglage ne touche QUE l'affichage (aucune écriture de données) ────

describe("le réglage d'affichage n'écrit aucune donnée de temps", () => {
  it("le module d'affichage ne contient aucun chemin d'écriture des temps", () => {
    // Les DEUX seules écritures de temps de l'interface restent portées par les
    // commandes dédiées de la tranche 2.2, jamais par le réglage.
    expect(KANBAN_SRC).toContain("super_agent_task_time_set_estimated");
    expect(KANBAN_SRC).toContain("super_agent_task_time_add_spent");
    expect(VIEW_SRC).not.toContain("db_execute");
    // Le réglage lui-même n'est lu que par `get_config` (lecture seule).
    expect(LOAD_TIME_CONFIG_SRC).toContain('invoke("get_config")');
    expect(LOAD_TIME_CONFIG_SRC).not.toContain("save");
  });
});
