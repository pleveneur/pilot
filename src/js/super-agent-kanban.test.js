// Tests unitaires — super-agent-kanban.js (chantier « Kanban multi-projets »).
// Classement des tâches de l'Assistant (🧭) en 4 colonnes à partir du statut
// texte libre, puis structure par client. Module 100 % pur → testable sans mock.
import { describe, it, expect } from "vitest";
import {
  KANBAN_COLUMNS,
  normalizeTaskStatus,
  buildKanbanColumns,
  countByColumn,
  buildKanbanByClient,
} from "./super-agent-kanban.js";

describe("KANBAN_COLUMNS", () => {
  it("définit exactement les 4 colonnes dans l'ordre attendu", () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual([
      "todo",
      "progress",
      "review",
      "done",
    ]);
  });
});

describe("normalizeTaskStatus", () => {
  it("classe les statuts attendus dans la bonne colonne", () => {
    expect(normalizeTaskStatus("demande")).toBe("todo");
    expect(normalizeTaskStatus("planifié")).toBe("todo");
    expect(normalizeTaskStatus("en cours")).toBe("progress");
    expect(normalizeTaskStatus("actif")).toBe("progress");
    expect(normalizeTaskStatus("à valider")).toBe("review");
    expect(normalizeTaskStatus("waiting")).toBe("review");
    expect(normalizeTaskStatus("terminée")).toBe("done");
    expect(normalizeTaskStatus("livré")).toBe("done");
  });

  it("est insensible à la casse et aux accents", () => {
    expect(normalizeTaskStatus("DEMANDE")).toBe("todo");
    expect(normalizeTaskStatus("À VALIDER")).toBe("review");
    expect(normalizeTaskStatus("Terminée")).toBe("done");
  });

  it("renvoie 'cancelled' pour les statuts annulés/abandonnés", () => {
    expect(normalizeTaskStatus("annulée")).toBe("cancelled");
    expect(normalizeTaskStatus("abandonné")).toBe("cancelled");
    expect(normalizeTaskStatus("cancelled")).toBe("cancelled");
  });

  it("reste conservateur : statut inconnu ou vide → 'todo'", () => {
    expect(normalizeTaskStatus("blablabla")).toBe("todo");
    expect(normalizeTaskStatus("")).toBe("todo");
    expect(normalizeTaskStatus(undefined)).toBe("todo");
    expect(normalizeTaskStatus(null)).toBe("todo");
  });
});

describe("buildKanbanColumns", () => {
  it("répartit les tâches dans les 4 colonnes dans l'ordre stable", () => {
    const tasks = [
      { id: 1, status: "en_cours" },
      { id: 2, status: "terminee" },
      { id: 3, status: "demande" },
      { id: 4, status: "a_valider" },
      { id: 5, status: "terminee" },
    ];
    const cols = buildKanbanColumns(tasks);
    expect(cols.map((c) => c.key)).toEqual(["todo", "progress", "review", "done"]);
    expect(cols.find((c) => c.key === "todo").cards.map((t) => t.id)).toEqual([3]);
    expect(cols.find((c) => c.key === "progress").cards.map((t) => t.id)).toEqual([1]);
    expect(cols.find((c) => c.key === "review").cards.map((t) => t.id)).toEqual([4]);
    expect(cols.find((c) => c.key === "done").cards.map((t) => t.id)).toEqual([2, 5]);
  });

  it("exclut les tâches annulées (hors tableau)", () => {
    const cols = buildKanbanColumns([{ id: 1, status: "annulee" }]);
    expect(cols.every((c) => c.cards.length === 0)).toBe(true);
  });

  it("ne plante pas sur une liste vide ou null", () => {
    expect(buildKanbanColumns([]).every((c) => c.cards.length === 0)).toBe(true);
    expect(buildKanbanColumns(null).every((c) => c.cards.length === 0)).toBe(true);
  });

  it("chaque carte conserve ses champs bruts", () => {
    const cols = buildKanbanColumns([{ id: 9, status: "done", title: "X" }]);
    expect(cols.find((c) => c.key === "done").cards[0].title).toBe("X");
  });
});

describe("countByColumn", () => {
  it("compte les cartes par colonne", () => {
    const cols = buildKanbanColumns([
      { id: 1, status: "done" },
      { id: 2, status: "done" },
      { id: 3, status: "progress" },
    ]);
    expect(countByColumn(cols)).toEqual({ todo: 0, progress: 1, review: 0, done: 2 });
  });
});

describe("buildKanbanByClient", () => {
  it("projette chaque client sur { name, columns }", () => {
    const clients = [
      {
        name: "Acme",
        tasks: [
          { id: 1, status: "en_cours" },
          { id: 2, status: "terminee" },
        ],
      },
      { name: "Globex", tasks: [{ id: 3, status: "demande" }] },
    ];
    const byClient = buildKanbanByClient(clients);
    expect(byClient).toHaveLength(2);
    expect(byClient[0].name).toBe("Acme");
    expect(byClient[0].columns.find((c) => c.key === "progress").cards).toHaveLength(1);
    expect(byClient[0].columns.find((c) => c.key === "done").cards).toHaveLength(1);
    expect(byClient[1].name).toBe("Globex");
    expect(byClient[1].columns.find((c) => c.key === "todo").cards).toHaveLength(1);
  });

  it("traite un client sans nom comme 'Sans client'", () => {
    const byClient = buildKanbanByClient([{ tasks: [{ id: 1, status: "done" }] }]);
    expect(byClient[0].name).toBe("Sans client");
  });

  it("gère une entrée vide ou null", () => {
    expect(buildKanbanByClient([])).toEqual([]);
    expect(buildKanbanByClient(null)).toEqual([]);
    expect(buildKanbanByClient([null])).toEqual([
      { name: "Sans client", columns: buildKanbanColumns([]) },
    ]);
  });
});
