// Tests unitaires — super-agent-kanban.js (chantier « Kanban multi-projets »).
// Classement des tâches de l'Assistant (🧭) en 4 colonnes à partir du statut
// texte libre, puis structure par client. Module 100 % pur → testable sans mock.
import { describe, it, expect } from "vitest";
import {
  KANBAN_COLUMNS,
  normalizeTaskStatus,
  columnToStatus,
  buildKanbanColumns,
  countByColumn,
  buildKanbanByClient,
  isOpenTaskStatus,
  taskStatusLabel,
  filterOpenTasksByClient,
  formatTaskDeadline,
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

describe("columnToStatus", () => {
  it("mappe chaque colonne vers son statut canonique en base", () => {
    expect(columnToStatus("todo")).toBe("demande");
    expect(columnToStatus("progress")).toBe("en_cours");
    expect(columnToStatus("review")).toBe("a_valider");
    expect(columnToStatus("done")).toBe("terminee");
    expect(columnToStatus("cancelled")).toBe("annulee");
  });

  it("reste cohérent avec normalizeTaskStatus (aller-retour)", () => {
    for (const c of KANBAN_COLUMNS) {
      expect(normalizeTaskStatus(columnToStatus(c.key))).toBe(c.key);
    }
    expect(normalizeTaskStatus(columnToStatus("cancelled"))).toBe("cancelled");
  });

  it("retombe sur 'demande' pour une clé inconnue", () => {
    expect(columnToStatus("")).toBe("demande");
    expect(columnToStatus(undefined)).toBe("demande");
    expect(columnToStatus("blabla")).toBe("demande");
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

// Onglet « Tâches » du panneau cloche : seules les tâches OUVERTES sont vues
describe("isOpenTaskStatus", () => {
  it("considère ouvertes les tâches à faire, en cours et à valider", () => {
    expect(isOpenTaskStatus("demande")).toBe(true);
    expect(isOpenTaskStatus("en_cours")).toBe(true);
    expect(isOpenTaskStatus("a_valider")).toBe(true);
    expect(isOpenTaskStatus("blablabla")).toBe(true);
  });

  it("exclut les tâches terminées et annulées", () => {
    expect(isOpenTaskStatus("terminee")).toBe(false);
    expect(isOpenTaskStatus("livree")).toBe(false);
    expect(isOpenTaskStatus("annulee")).toBe(false);
    expect(isOpenTaskStatus("abandonne")).toBe(false);
  });
});

describe("taskStatusLabel", () => {
  it("rend le libellé de la colonne du statut", () => {
    expect(taskStatusLabel("en_cours")).toBe("En cours");
    expect(taskStatusLabel("a_valider")).toBe("À valider");
    expect(taskStatusLabel("terminee")).toBe("Terminé");
    expect(taskStatusLabel("demande")).toBe("À faire");
  });

  it("rend « Annulée » pour un statut annulé, « À faire » pour un statut inconnu", () => {
    expect(taskStatusLabel("annulee")).toBe("Annulée");
    expect(taskStatusLabel("blablabla")).toBe("À faire");
  });
});

describe("filterOpenTasksByClient", () => {
  it("ne garde que les tâches ouvertes et retire les clients sans tâche ouverte", () => {
    const clients = [
      {
        name: "Acme",
        tasks: [
          { id: 1, status: "en_cours" },
          { id: 2, status: "terminee" },
          { id: 3, status: "demande" },
        ],
      },
      { name: "Globex", tasks: [{ id: 4, status: "annulee" }] },
    ];
    const out = filterOpenTasksByClient(clients);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Acme");
    expect(out[0].tasks.map((t) => t.id)).toEqual([1, 3]);
  });

  it("gère une entrée vide ou null", () => {
    expect(filterOpenTasksByClient([])).toEqual([]);
    expect(filterOpenTasksByClient(null)).toEqual([]);
  });
});

describe("formatTaskDeadline", () => {
  const now = new Date(2026, 8, 30); // 30/09/2026

  it("formate une date ISO en JJ/MM/AAAA", () => {
    expect(formatTaskDeadline("2026-10-15", now)).toEqual({
      text: "15/10/2026",
      overdue: false,
      iso: "2026-10-15",
    });
  });

  it("signale un retard (échéance strictement antérieure au jour courant)", () => {
    expect(formatTaskDeadline("2026-09-29", now).overdue).toBe(true);
    expect(formatTaskDeadline("2026-09-30", now).overdue).toBe(false);
  });

  it("accepte un horodatage ISO complet", () => {
    expect(formatTaskDeadline("2026-10-15T08:00:00Z", now).text).toBe("15/10/2026");
  });

  it("renvoie null pour une échéance absente ou illisible", () => {
    expect(formatTaskDeadline(undefined, now)).toBeNull();
    expect(formatTaskDeadline("", now)).toBeNull();
    expect(formatTaskDeadline("pas une date", now)).toBeNull();
  });
});
