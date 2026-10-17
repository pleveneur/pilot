// Tests unitaires — temps prévu / passé par tâche (Lot A, idée 2, tranche 3).
// Deux volets, comme les tranches 3.x de la checklist et 4.4 du livrable :
//   1. les fonctions PURES de `super-agent-kanban.js` qui normalisent la charge
//      utile des commandes de temps (`super_agent_task_time_*`) et valident la
//      saisie — la présence d'un temps vient TOUJOURS des booléens
//      `estimated_set` / `spent_set`, jamais de la valeur (0 est faux en JS) ;
//   2. le BRANCHEMENT de l'écran (`super-agent-kanban-view.js`, module à DOM,
//      environnement vitest `node` sans jsdom) : vérifié par LECTURE DE SOURCE,
//      méthode déjà employée par `super-agent-checklist.test.js` et
//      `super-agent-deliverables.test.js`.
// Aucune règle métier n'est réimplémentée ici : on verrouille le contrat
// d'appel (noms exacts des trois commandes), la pastille des cartes, les
// champs de la fiche, la relecture EN BASE après chaque opération, les refus
// SANS écriture, et l'ABSENCE de tout chemin d'écriture de statut.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TASK_TIME_GET_COMMAND,
  TASK_TIME_SET_ESTIMATED_COMMAND,
  TASK_TIME_ADD_SPENT_COMMAND,
  NO_ESTIMATE_TEXT,
  NO_TIME_TEXT,
  INVALID_MINUTES_MESSAGE,
  EMPTY_SPENT_MESSAGE,
  TIME_ERROR_PREFIX,
  taskTimeState,
  taskTimePillLabel,
  taskTimeSummaryLabel,
  parseEstimatedMinutesInput,
  parseSpentMinutesInput,
  taskTimeErrorMessage,
} from "./super-agent-kanban.js";

// ── 1. Fonctions pures de préparation de l'affichage ────────────────────────

describe("noms EXACTS des trois commandes de temps", () => {
  it("expose les trois commandes du cœur (contrat avec super_agent.rs, tranche 2.2)", () => {
    expect(TASK_TIME_GET_COMMAND).toBe("super_agent_task_time_get");
    expect(TASK_TIME_SET_ESTIMATED_COMMAND).toBe("super_agent_task_time_set_estimated");
    expect(TASK_TIME_ADD_SPENT_COMMAND).toBe("super_agent_task_time_add_spent");
  });

  it("les noms sont bien ceux enregistrés côté cœur (#[tauri::command] + handler)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../..");
    const coreSrc = readFileSync(resolve(root, "src-tauri/src/super_agent.rs"), "utf8");
    const libSrc = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    for (const cmd of [TASK_TIME_GET_COMMAND, TASK_TIME_SET_ESTIMATED_COMMAND, TASK_TIME_ADD_SPENT_COMMAND]) {
      expect(coreSrc).toContain(`pub fn ${cmd}(`);
      expect(libSrc).toContain(`super_agent::${cmd},`);
    }
  });
});

describe("taskTimeState — la présence vient de `*_set`, jamais de la valeur", () => {
  it("lit la charge utile des commandes et distingue « non renseigné » de 0", () => {
    expect(
      taskTimeState({ estimated_minutes: 120, spent_minutes: 75, estimated_set: true, spent_set: true })
    ).toEqual({ estimatedMinutes: 120, spentMinutes: 75, estimatedSet: true, spentSet: true });
    // Zéro SAISI : renseigné (0 = « rien prévu » / « rien passé »), pas absent.
    expect(taskTimeState({ estimated_minutes: 0, spent_minutes: 0, estimated_set: true, spent_set: true })).toEqual({
      estimatedMinutes: 0,
      spentMinutes: 0,
      estimatedSet: true,
      spentSet: true,
    });
    // `null` + `*_set = false` : NON renseigné (jamais un 0 par défaut).
    expect(taskTimeState({ estimated_minutes: null, spent_minutes: null, estimated_set: false, spent_set: false })).toEqual(
      { estimatedMinutes: null, spentMinutes: null, estimatedSet: false, spentSet: false }
    );
  });

  it("ne DÉDUIT jamais la présence de la valeur (le piège du 0 faux en JS est fermé)", () => {
    // Une réponse sans booléens reste « non renseigné », même avec une valeur.
    const st = taskTimeState({ estimated_minutes: 45, spent_minutes: 30 });
    expect(st.estimatedSet).toBe(false);
    expect(st.spentSet).toBe(false);
    expect(st.estimatedMinutes).toBeNull();
    expect(st.spentMinutes).toBeNull();
  });

  it("tolère une réponse absente ou mal formée : rien n'est inventé", () => {
    for (const bad of [null, undefined, ""]) {
      expect(taskTimeState(bad)).toEqual({
        estimatedMinutes: null,
        spentMinutes: null,
        estimatedSet: false,
        spentSet: false,
      });
    }
  });
});

describe("taskTimePillLabel — pastille discrète des cartes", () => {
  it("n'affiche AUCUNE pastille quand les deux temps sont non renseignés", () => {
    expect(taskTimePillLabel(null)).toBe("");
    expect(taskTimePillLabel(undefined)).toBe("");
    expect(taskTimePillLabel({})).toBe("");
    expect(taskTimePillLabel({ estimated_minutes: null, spent_minutes: null, estimated_set: false, spent_set: false })).toBe("");
    // La pastille n'est alors jamais insérée : la carte garde son apparence.
  });

  it("affiche prévu / passé quand les deux sont renseignés", () => {
    expect(taskTimePillLabel({ estimated_minutes: 45, spent_minutes: 70, estimated_set: true, spent_set: true })).toBe(
      "45 min prévues / 70 min passées"
    );
  });

  it("affiche le seul prévu, sans rien inventer", () => {
    expect(taskTimePillLabel({ estimated_minutes: 45, estimated_set: true })).toBe("45 min prévues");
    expect(taskTimePillLabel({ estimated_minutes: 1, estimated_set: true })).toBe("1 min prévue");
  });

  it("quand SEUL le passé est renseigné : « pas d'estimation », jamais un écart calculé", () => {
    expect(taskTimePillLabel({ spent_minutes: 70, spent_set: true })).toBe("pas d'estimation · 70 min passées");
    expect(NO_ESTIMATE_TEXT).toBe("pas d'estimation");
  });

  it("un zéro SAISI s'affiche « 0 min », pas rien", () => {
    expect(taskTimePillLabel({ estimated_minutes: 0, estimated_set: true })).toBe("0 min prévues");
    expect(taskTimePillLabel({ estimated_minutes: 0, spent_minutes: 0, estimated_set: true, spent_set: true })).toBe(
      "0 min prévues / 0 min passées"
    );
  });
});

describe("taskTimeSummaryLabel — résumé du bloc « Temps » de la fiche", () => {
  it("dit explicitement quand aucun temps n'est renseigné", () => {
    expect(taskTimeSummaryLabel(null)).toBe(NO_TIME_TEXT);
    expect(NO_TIME_TEXT).toBe("aucun temps renseigné");
  });

  it("reprend la règle de la pastille, avec la mention du temps manquant", () => {
    expect(taskTimeSummaryLabel({ estimated_minutes: 45, spent_minutes: 70, estimated_set: true, spent_set: true })).toBe(
      "45 min prévues / 70 min passées"
    );
    expect(taskTimeSummaryLabel({ estimated_minutes: 45, estimated_set: true })).toBe("45 min prévues (aucun temps passé)");
    expect(taskTimeSummaryLabel({ spent_minutes: 70, spent_set: true })).toBe("pas d'estimation · 70 min passées");
  });
});

describe("validation de la saisie — un refus n'écrit rien", () => {
  it("le temps PRÉVU : champ vide = effacer (non renseigné), entier positif sinon", () => {
    expect(parseEstimatedMinutesInput("")).toEqual({ ok: true, minutes: null, message: "" });
    expect(parseEstimatedMinutesInput("   ")).toEqual({ ok: true, minutes: null, message: "" });
    expect(parseEstimatedMinutesInput("45")).toEqual({ ok: true, minutes: 45, message: "" });
    expect(parseEstimatedMinutesInput(" 0 ")).toEqual({ ok: true, minutes: 0, message: "" });
    expect(parseEstimatedMinutesInput("  12 ")).toEqual({ ok: true, minutes: 12, message: "" });
  });

  it("refuse une valeur négative, décimale ou non numérique (rien n'est envoyé au cœur)", () => {
    for (const bad of ["-1", "1.5", "abc", "12min", "-0.5", "1e3"]) {
      expect(parseEstimatedMinutesInput(bad).ok, `accepté à tort : ${bad}`).toBe(false);
      expect(parseEstimatedMinutesInput(bad).minutes).toBeNull();
      expect(parseEstimatedMinutesInput(bad).message).toBe(INVALID_MINUTES_MESSAGE);
      expect(parseSpentMinutesInput(bad).ok, `accepté à tort : ${bad}`).toBe(false);
    }
  });

  it("le temps PASSÉ : un champ vide est refusé (on n'ajoute pas un cumul vide)", () => {
    expect(parseSpentMinutesInput("")).toEqual({ ok: false, minutes: null, message: EMPTY_SPENT_MESSAGE });
    expect(parseSpentMinutesInput("  ")).toEqual({ ok: false, minutes: null, message: EMPTY_SPENT_MESSAGE });
    expect(parseSpentMinutesInput("30")).toEqual({ ok: true, minutes: 30, message: "" });
    expect(parseSpentMinutesInput("0")).toEqual({ ok: true, minutes: 0, message: "" });
  });
});

describe("taskTimeErrorMessage — ligne d'information, jamais d'exception", () => {
  it("rend un message clair, préfixé, à partir du refus du cœur", () => {
    // Messages réels des helpers Rust : tâche inconnue, valeur négative.
    expect(taskTimeErrorMessage(new Error("Tache 9999 introuvable"))).toBe(
      `${TIME_ERROR_PREFIX} : Tache 9999 introuvable`
    );
    expect(taskTimeErrorMessage("Temps estime refuse : -1 minute(s) negative(s)")).toBe(
      `${TIME_ERROR_PREFIX} : Temps estime refuse : -1 minute(s) negative(s)`
    );
  });

  it("retombe sur le seul préfixe sans lever d'exception, quel que soit l'entrant", () => {
    expect(TIME_ERROR_PREFIX).toBe("Temps indisponible");
    for (const err of [null, undefined, "", "   ", 0, {}, new Error("")]) {
      const msg = taskTimeErrorMessage(err);
      expect(msg.startsWith(TIME_ERROR_PREFIX)).toBe(true);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ── 2. Branchement de l'écran (lecture de source) ───────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const viewSrc = readFileSync(resolve(root, "src/js/super-agent-kanban-view.js"), "utf8");

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

const count = (s, needle) => s.split(needle).length - 1;

describe("cartes Kanban — la pastille de temps est RELUE EN BASE", () => {
  const card = slice(viewSrc, "function taskCardHtml(t)", "function ideaCardHtml(");

  it("la pastille lit le cache relu en base et n'apparaît QUE s'il y a un temps", () => {
    // Tranche 5 : la pastille est en plus conditionnée au réglage d'affichage
    // du suivi du temps (`super_agent_show_time`, défaut désactivé).
    expect(card).toContain('const timeLabel = showTime ? taskTimePillLabel(taskTimes.get(t.id)) : "";');
    expect(card).toContain('${timeLabel ? `<span class="kanban-time-pill');
    // Chaîne vide (les deux temps non renseignés) ⇒ aucun `<span>` : la carte
    // existante garde exactement son apparence.
    expect(card).toContain('title="${escapeAttr(timeLabel)}">${escapeHtml(timeLabel)}</span>` : ""}');
  });

  it("le compteur de checklist « 2/3 » (idée 3) cohabite sans être modifié", () => {
    expect(card).toContain("const checkLabel = checklistCounterLabel(checkCounts.get(t.id));");
    expect(card).toContain('${checkLabel ? `<span class="kanban-check-counter"');
  });

  it("la lecture est faite par tâche avec l'identifiant, sans littéral recopié", () => {
    const refresh = slice(viewSrc, "async function refreshTaskTimes(", "function applyTimePills()");
    expect(refresh).toContain("invoke(TASK_TIME_GET_COMMAND, { taskId: t.id })");
    expect(refresh).not.toContain('"super_agent_task_time_get"');
    // Une lecture impossible laisse la carte SANS pastille (fail-open), et un
    // chargement plus récent annule le précédent.
    expect(refresh).toContain("catch (_err)");
    expect(refresh).not.toContain("throw");
    expect(refresh).toContain("if (token !== timeFetchToken) return;");
  });

  it("une pastille vide n'est jamais laissée sur une carte déjà rendue", () => {
    const apply = slice(viewSrc, "function applyTimePills()", "/**\n   * Lit les DEUX réglages de checklist");
    expect(apply).toContain("if (!label) {");
    expect(apply).toContain("el.remove();");
    expect(apply).toContain("el.textContent = label;");
  });
});

describe("chargement de la vue — la pastille suit le Kanban", () => {
  it("les temps sont relus en base juste après le rendu, comme les compteurs", () => {
    const load = slice(viewSrc, "async function loadSuperKanban(", "// ── Pilotage CRUD");
    expect(load).toContain("refreshCheckCounts();");
    expect(load).toContain("refreshTaskTimes();");
  });

  it("un re-rendu (changement de filtre) ne perd ni ne relit les pastilles", () => {
    const renderKanban = slice(viewSrc, "function renderKanban()", "async function confirmAndCloseSelection(");
    expect(renderKanban).toContain("applyCheckCounters();");
    expect(renderKanban).toContain("applyTimePills();");
  });

  it("la fermeture de la fiche reporte la pastille sur la carte, sans rechargement", () => {
    const close = slice(viewSrc, "const close = () => {", 'overlay.addEventListener("click"');
    expect(close).toContain("applyCheckCounters();");
    expect(close).toContain("applyTimePills();");
  });
});

describe("fiche de tâche — bloc « Temps » (champs de saisie)", () => {
  const markup = slice(
    viewSrc,
    '${isEdit && showTime ? `<div class="kanban-field kanban-checklist kanban-task-time">',
    '${isEdit ? `<div class="kanban-field kanban-checklist kanban-deliverables">'
  );

  it("n'apparaît que sur une tâche EXISTANTE et offre les deux saisies + leurs boutons", () => {
    // Tranche 5 : en plus de « tâche existante », le bloc exige le réglage
    // d'affichage du suivi du temps (`super_agent_show_time`).
    expect(markup.startsWith('${isEdit && showTime ? `')).toBe(true);
    expect(count(markup, '<div class="kanban-field kanban-checklist kanban-task-time">')).toBe(1);
    expect(markup).toContain('class="kanban-checklist-input kanban-time-estimated-input"');
    expect(markup).toContain('class="kanban-checklist-input kanban-time-spent-input"');
    expect(markup).toContain('class="btn kanban-checklist-add-btn kanban-time-set-btn"');
    expect(markup).toContain('class="btn kanban-checklist-add-btn kanban-time-add-btn"');
    expect(markup).toContain('class="kanban-time-summary kanban-checklist-count dash-muted"');
    expect(markup).toContain('class="dash-error kanban-time-error" hidden');
  });

  it("aucun champ ne porte de `name` : les champs du formulaire de la fiche restent intacts", () => {
    expect(markup).not.toContain("name=");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<textarea");
  });

  it("la fiche relit le temps à l'ouverture ET après chaque opération réussie", () => {
    const sheet = slice(viewSrc, "    if (isEdit) {\n      const block", "const first = overlay.querySelector");
    expect(count(sheet, "renderTaskTime(timeBlock, task.id);")).toBe(3); // ouverture + 2 opérations
    expect(count(sheet, "await renderTaskTime(timeBlock, task.id);")).toBe(2);
  });

  it("la lecture du temps remplace TOUJOURS le résumé, jamais un état deviné", () => {
    const render = slice(viewSrc, "async function renderTaskTime(", "  /**\n   * Idée 4 (Lot A), tranche 4.4");
    expect(count(render, "invoke(")).toBe(1);
    expect(render).toContain("invoke(TASK_TIME_GET_COMMAND, { taskId })");
    expect(render).toContain("taskTimes.set(taskId, res || {})");
    expect(render).toContain("taskTimeState(res)");
    expect(render).toContain("summary.textContent = taskTimeSummaryLabel(res)");
    // La pastille de la carte suit la relecture (même valeur que la fiche).
    expect(render).toContain("applyTimePills();");
    // Échec de lecture : ligne d'information, aucune exception remontée.
    expect(render).toContain("taskTimeErrorMessage(err)");
    expect(render).not.toContain("throw");
  });
});

describe("fiche de tâche — écritures de temps : refus sans écriture, relecture après", () => {
  const sheet = slice(viewSrc, "    if (isEdit) {\n      const block", "const first = overlay.querySelector");
  const setEstimated = slice(sheet, "const setEstimated = async () => {", "const addSpent = async () => {");
  const addSpent = slice(sheet, "const addSpent = async () => {", 'timeBlock.addEventListener("click"');

  it("le prévu est écrit en valeur ABSOLUE par la commande exacte, une seule fois", () => {
    expect(count(setEstimated, "invoke(")).toBe(1);
    expect(setEstimated).toContain("invoke(TASK_TIME_SET_ESTIMATED_COMMAND, { taskId: task.id, minutes: parsed.minutes })");
    expect(setEstimated).toContain("parseEstimatedMinutesInput(");
  });

  it("le passé est AJOUTÉ (cumul) par la commande exacte, une seule fois", () => {
    expect(count(addSpent, "invoke(")).toBe(1);
    expect(addSpent).toContain("invoke(TASK_TIME_ADD_SPENT_COMMAND, { taskId: task.id, minutes: parsed.minutes })");
    expect(addSpent).toContain("parseSpentMinutesInput(");
    // Le passé est un cumul : le champ repart vide, il n'est jamais écrasé.
    expect(addSpent).toContain('input.value = "";');
  });

  it("une saisie refusée s'affiche SANS aucune écriture (le contrôle précède l'appel)", () => {
    for (const op of [setEstimated, addSpent]) {
      const guard = op.indexOf("if (!parsed.ok) {");
      const message = op.indexOf("setTimeError(parsed.message);");
      const invoke = op.indexOf("invoke(TASK_TIME_");
      expect(guard).toBeGreaterThan(-1);
      expect(message).toBeGreaterThan(guard);
      expect(invoke).toBeGreaterThan(message);
    }
  });

  it("un refus du cœur (valeur négative, tâche inconnue) s'affiche sans relance", () => {
    for (const op of [setEstimated, addSpent]) {
      expect(op).toContain("setTimeError(taskTimeErrorMessage(err));");
      expect(count(op, "await renderTaskTime(timeBlock, task.id);")).toBe(1);
      // Le message de refus est affiché PUIS on sort : rien n'est réécrit.
      const refuse = op.indexOf("setTimeError(taskTimeErrorMessage(err));");
      const reload = op.indexOf("await renderTaskTime(timeBlock, task.id);");
      expect(refuse).toBeLessThan(reload);
    }
  });

  it("chaque opération RÉUSSIE relit la base APRÈS l'écriture (jamais d'état optimiste)", () => {
    for (const op of [setEstimated, addSpent]) {
      const written = op.indexOf("await invoke(TASK_TIME_");
      const reload = op.indexOf("await renderTaskTime(timeBlock, task.id);");
      expect(written).toBeGreaterThan(-1);
      expect(reload).toBeGreaterThan(written);
    }
  });

  it("les deux boutons sont bien branchés, et Entrée ne soumet pas le formulaire", () => {
    const click = slice(sheet, 'timeBlock.addEventListener("click"', 'timeBlock.addEventListener("keydown"');
    expect(click).toContain('e.target.closest(".kanban-time-set-btn")');
    expect(click).toContain('e.target.closest(".kanban-time-add-btn")');
    const keydown = slice(sheet, 'timeBlock.addEventListener("keydown"', "      renderTaskTime(timeBlock, task.id);");
    expect(keydown).toContain('e.key !== "Enter"');
    expect(keydown).toContain("e.preventDefault();");
  });
});

describe("fiche de tâche — aucun chemin n'écrit de STATUT depuis le bloc Temps", () => {
  const wiring = slice(
    viewSrc,
    'const timeBlock = overlay.querySelector(".kanban-task-time");',
    "      renderTaskTime(timeBlock, task.id);"
  );

  it("le bloc Temps n'appelle aucune commande de statut ni de tâche", () => {
    expect(wiring).not.toContain("super_agent_update_task");
    expect(wiring).not.toContain("super_agent_update_task_status");
    expect(wiring).not.toContain("super_agent_create_task");
    expect(wiring).not.toContain("super_agent_delete_task");
    expect(wiring).not.toContain("status:");
    // Aucune écriture hors des deux commandes de temps de la tranche 2.2.
    expect(count(wiring, "await invoke(TASK_TIME_")).toBe(2);
  });

  it("la checklist « 2/3 » et le bloc « Livrable » restent intacts sur la même fiche", () => {
    expect(viewSrc).toContain('class="kanban-field kanban-checklist kanban-deliverables"');
    expect(viewSrc).toContain('class="kanban-checklist-list kanban-deliverables-list"');
    expect(viewSrc).toContain("<div class=\"kanban-checklist-list\">");
    expect(viewSrc).toContain("kanban-checklist-add-btn");
    expect(viewSrc).toContain("kanban-check-del");
    expect(viewSrc).toContain("kanban-check-toggle");
    expect(viewSrc).toContain("renderDeliverables(deliverableBlock, task.id)");
  });
});
