// Tests — Lot A idée 1, tranche 1.3 : pastille « longue » et infobulle des
// cartes Kanban. Aucune règle de fond n'est décidée ici : le signal est CALCULÉ
// PAR LE CŒUR RUST (`detect_long_task`, tranches 1.1/1.2) et arrive DÉJÀ PRÊT
// dans l'état Kanban sous deux champs — `is_long_task` (booléen) et
// `long_task_reason` (raison courte, ou null).
//
// Méthode : `super-agent-kanban.js` est un module pur (sans DOM ni invoke) →
// `longTaskPill` est exercée DIRECTEMENT. `super-agent-kanban-view.js` est un
// module à DOM : son branchement est verrouillé par LECTURE DE SOURCE, méthode
// déjà employée par `super-agent-task-time.test.js` et
// `super-agent-time-tranche6.test.js`.
//
// Contrat verrouillé : la pastille vient UNIQUEMENT des données reçues du
// serveur (aucune détection ni seuil recalculés en JavaScript), une carte
// ordinaire ne reçoit AUCUNE pastille (son apparence ne change pas) et
// l'infobulle recopie la raison fournie TELLE QUELLE.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LONG_TASK_PILL_LABEL, longTaskPill } from "./super-agent-kanban.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const KANBAN_SRC = read("src/js/super-agent-kanban.js");
const VIEW_SRC = read("src/js/super-agent-kanban-view.js");

/** Tranche de source entre deux ancres (échec explicite si une ancre disparaît). */
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `ancre absente : ${from}`).toBeGreaterThan(-1);
  expect(b, `ancre absente : ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

// ── 1. Rien n'est affiché quand le signal est absent ───────────────────────

describe("longTaskPill — carte ordinaire : aucune pastille", () => {
  it("retourne null quand le signal du serveur est absent ou faux", () => {
    for (const ordinary of [
      null,
      undefined,
      {},
      { is_long_task: false },
      // Une raison présente sans signal n'affiche RIEN : c'est le booléen du
      // serveur qui décide, jamais le texte de la carte.
      { is_long_task: false, long_task_reason: "3 étapes détectées" },
      // Une description longue sans signal ne déclenche RIEN : aucune détection
      // locale, aucun seuil recalculé.
      { title: "Refonte", description: "12 fichiers cités\n1) a\n2) b\n3) c" },
    ]) {
      expect(longTaskPill(ordinary)).toBeNull();
    }
  });

  it("la pastille n'est insérée dans la carte que si le signal est présent", () => {
    const card = slice(VIEW_SRC, "function taskCardHtml(t)", "function ideaCardHtml(");
    // `${longPill ? … : ""}` : sans signal, aucune balise n'est produite.
    expect(card).toContain("const longPill = longTaskPill(t);");
    expect(card).toContain('${longPill ? `<span class="kanban-long-pill');
    expect(card).toContain('</span>` : ""}');
  });
});

// ── 2. La pastille lit bien les champs du serveur ──────────────────────────

describe("longTaskPill — lecture seule des champs du serveur", () => {
  it("affiche « longue » dès que `is_long_task` est vrai", () => {
    expect(LONG_TASK_PILL_LABEL).toBe("longue");
    expect(longTaskPill({ is_long_task: true, long_task_reason: "3 étapes détectées" })).toEqual({
      label: "longue",
      reason: "3 étapes détectées",
    });
  });

  it("recopie la raison fournie TELLE QUELLE (plusieurs signaux réunis)", () => {
    const reason = "mot-clé « refonte » · 12 fichiers cités";
    expect(longTaskPill({ is_long_task: true, long_task_reason: reason }).reason).toBe(reason);
    // Aucune reformulation : le texte reçu est rendu identique.
    expect(longTaskPill({ is_long_task: true, long_task_reason: "3 étapes détectées" }).reason).toBe(
      "3 étapes détectées"
    );
  });

  it("n'invente aucune raison : signal vrai sans raison ⇒ pastille sans infobulle", () => {
    for (const raw of [null, undefined, "", "   "]) {
      expect(longTaskPill({ is_long_task: true, long_task_reason: raw })).toEqual({
        label: "longue",
        reason: "",
      });
    }
  });

  it("ne calcule AUCUN seuil : la fonction ne lit que les deux champs du serveur", () => {
    const fn = slice(KANBAN_SRC, "export function longTaskPill(task)", "\n}\n");
    expect(fn).not.toContain("title");
    expect(fn).not.toContain("description");
    expect(fn).not.toContain("length");
    // Aucun seuil du cœur n'est recopié dans l'interface.
    for (const threshold of ["LONG_TASK_MIN_STEPS", "LONG_TASK_MIN_FILES", "LONG_TASK_MIN_CHARS"]) {
      expect(KANBAN_SRC).not.toContain(threshold);
      expect(VIEW_SRC).not.toContain(threshold);
    }
  });
});

// ── 3. L'infobulle reprend la raison fournie ───────────────────────────────

describe("carte Kanban — infobulle et discrétion", () => {
  const card = slice(VIEW_SRC, "function taskCardHtml(t)", "function ideaCardHtml(");

  it("l'infobulle porte la raison reçue, échappée comme les autres attributs", () => {
    expect(card).toContain('title="${escapeAttr(longPill.reason)}"');
    expect(card).toContain("escapeHtml(longPill.label)");
    // Pas d'infobulle inventée quand le cœur ne fournit aucune raison.
    expect(card).toContain('${longPill.reason ? ` title="${escapeAttr(longPill.reason)}"` : ""}');
  });

  it("le module est bien importé (branchement complet)", () => {
    expect(VIEW_SRC).toContain("longTaskPill,");
    expect(VIEW_SRC).toContain('} from "./super-agent-kanban.js"');
  });

  it("la pastille ne change RIEN aux informations existantes de la carte", () => {
    // Compteur de checklist, pastille de temps, bloc projet et outils : intacts.
    expect(card).toContain("const checkLabel = checklistCounterLabel(checkCounts.get(t.id));");
    expect(card).toContain('${checkLabel ? `<span class="kanban-check-counter"');
    expect(card).toContain('const timeLabel = showTime ? taskTimePillLabel(taskTimes.get(t.id)) : "";');
    expect(card).toContain("${proj ? `<div class=\"super-kanban-card-proj\">");
    expect(card).toContain('<div class="super-kanban-card-tools">');
    // La carte ne reçoit AUCUNE classe nouvelle : aspect inchangé sans signal.
    expect(card).toContain(
      'return `<div class="super-kanban-card${blocked ? " blocked" : ""}${waiting ? " waiting-dep" : ""}" draggable="true" data-task-id="${t.id}">'
    );
  });

  it("la pastille vient de l'état reçu : aucune lecture ni détection supplémentaire", () => {
    // Aucun nouvel appel au backend pour la pastille (elle est dans la réponse).
    const load = slice(VIEW_SRC, "async function loadSuperKanban()", "async function moveKanbanTask(");
    expect(load).not.toContain("long_task");
    // Aucune détection locale du signal nulle part dans l'interface : ni appel
    // ni définition en JavaScript (seule une mention en commentaire est permise).
    expect(VIEW_SRC).not.toContain("detect_long_task(");
    expect(KANBAN_SRC).not.toContain("detect_long_task(");
  });
});
