// Tests unitaires — clôture EN LOT des tâches de suivi (vue Kanban, 🧭).
// Prouve le comportement attendu du propriétaire : sélection multiple, bouton
// actif seulement si ≥1 case cochée, confirmation refusée = rien ne change,
// réversibilité (annulation) et AUCUNE suppression. Les fonctions testées sont
// les décisions pures de super-agent-kanban.js ; la vue ne fait que les appeler
// et passer par la route existante `super_agent_update_task_status`.
import { describe, it, expect } from "vitest";
import {
  BULK_CLOSE_STATUS,
  columnToStatus,
  toggleSelection,
  selectionCount,
  canCloseSelection,
  bulkCloseConfirmMessage,
  buildBulkClosePlan,
  planBulkClose,
  buildBulkUndoPlan,
} from "./super-agent-kanban.js";

const TASKS = [
  { id: 1, status: "en_cours", title: "A" },
  { id: 2, status: "demande", title: "B" },
  { id: 3, status: "a_valider", title: "C" },
  { id: 4, status: "terminee", title: "D" },
];

describe("BULK_CLOSE_STATUS", () => {
  it("clôture vers le statut canonique de la colonne « Terminé » (même route unitaire)", () => {
    expect(BULK_CLOSE_STATUS).toBe("terminee");
    expect(BULK_CLOSE_STATUS).toBe(columnToStatus("done"));
  });
});

describe("toggleSelection", () => {
  it("ajoute une tâche cochée (sélection d'une ligne)", () => {
    const sel = toggleSelection(new Set(), 2, true);
    expect([...sel]).toEqual([2]);
  });

  it("retire une tâche décochée", () => {
    const sel = toggleSelection(new Set([2, 3]), 2, false);
    expect([...sel]).toEqual([3]);
  });

  it("accumule plusieurs tâches (sélection MULTIPLE)", () => {
    let sel = new Set();
    sel = toggleSelection(sel, 1, true);
    sel = toggleSelection(sel, 3, true);
    sel = toggleSelection(sel, 2, true);
    expect(selectionCount(sel)).toBe(3);
    expect([...sel].sort()).toEqual([1, 2, 3]);
  });

  it("ne modifie jamais l'ensemble d'origine (nouvel ensemble retourné)", () => {
    const before = new Set([1]);
    const after = toggleSelection(before, 2, true);
    expect([...before]).toEqual([1]);
    expect([...after]).toEqual([1, 2]);
  });

  it("tolère un ensemble absent", () => {
    expect([...toggleSelection(null, 5, true)]).toEqual([5]);
  });
});

describe("selectionCount / canCloseSelection", () => {
  it("compte 0 pour un ensemble vide ou absent", () => {
    expect(selectionCount(new Set())).toBe(0);
    expect(selectionCount(null)).toBe(0);
    expect(selectionCount(undefined)).toBe(0);
  });

  it("le bouton « Clôturer la sélection » est INACTIF sans sélection", () => {
    expect(canCloseSelection(new Set())).toBe(false);
    expect(canCloseSelection(null)).toBe(false);
  });

  it("le bouton est ACTIF dès qu'au moins une tâche est cochée", () => {
    expect(canCloseSelection(new Set([7]))).toBe(true);
    expect(canCloseSelection(new Set([7, 8]))).toBe(true);
  });
});

describe("bulkCloseConfirmMessage", () => {
  it("annonce le nombre de tâches et rappelle que c'est réversible", () => {
    const one = bulkCloseConfirmMessage(1);
    expect(one).toContain("1 tâche");
    expect(one).toMatch(/réversible/i);
    const many = bulkCloseConfirmMessage(4);
    expect(many).toContain("4 tâches");
    expect(many).toMatch(/réversible/i);
  });

  it("ne promet jamais une suppression", () => {
    const msg = bulkCloseConfirmMessage(3);
    expect(msg).toMatch(/rien n'est supprimé/i);
    expect(msg).not.toMatch(/définitivement|irréversible/i);
  });
});

describe("planBulkClose — confirmation obligatoire", () => {
  it("confirmation REFUSÉE : rien ne change (aucun changement produit)", () => {
    const decision = planBulkClose(TASKS, new Set([1, 2]), false);
    expect(decision.applied).toBe(false);
    expect(decision.changes).toEqual([]);
  });

  it("confirmation ACCEPTÉE : un changement par tâche cochée, vers « terminee »", () => {
    const decision = planBulkClose(TASKS, new Set([1, 3]), true);
    expect(decision.applied).toBe(true);
    expect(decision.changes).toEqual([
      { id: 1, from: "en_cours", to: "terminee" },
      { id: 3, from: "a_valider", to: "terminee" },
    ]);
  });

  it("ignore une tâche cochée absente de la liste (jamais inventée)", () => {
    const decision = planBulkClose(TASKS, new Set([2, 999]), true);
    expect(decision.changes.map((c) => c.id)).toEqual([2]);
  });

  it("n'inclut jamais de tâche non cochée", () => {
    const decision = planBulkClose(TASKS, new Set([4]), true);
    expect(decision.changes.map((c) => c.id)).toEqual([4]);
    expect(decision.changes.map((c) => c.id)).not.toContain(1);
  });
});

describe("buildBulkUndoPlan — réversibilité", () => {
  it("rétablit exactement le statut PRÉCÉDENT de chaque tâche clôturée", () => {
    const decision = planBulkClose(TASKS, new Set([1, 2]), true);
    const undo = buildBulkUndoPlan(decision.changes);
    expect(undo).toEqual([
      { id: 1, status: "en_cours" },
      { id: 2, status: "demande" },
    ]);
  });

  it("après clôture puis annulation, la liste retrouve son état initial", () => {
    const before = TASKS.map((t) => ({ ...t }));
    const decision = planBulkClose(TASKS, new Set([1, 2, 3]), true);
    // état après clôture (statut cible appliqué aux tâches cochées)
    const afterClose = before.map((t) => {
      const c = decision.changes.find((x) => x.id === t.id);
      return c ? { ...t, status: c.to } : { ...t };
    });
    expect(afterClose.map((t) => t.status)).toEqual([
      "terminee",
      "terminee",
      "terminee",
      "terminee",
    ]);
    // annulation : statuts précédents rétablis sur la MÊME route
    const undo = buildBulkUndoPlan(decision.changes);
    const afterUndo = afterClose.map((t) => {
      const u = undo.find((x) => x.id === t.id);
      return u ? { ...t, status: u.status } : { ...t };
    });
    expect(afterUndo).toEqual(before);
  });

  it("tolère une liste de changements vide ou absente", () => {
    expect(buildBulkUndoPlan([])).toEqual([]);
    expect(buildBulkUndoPlan(null)).toEqual([]);
  });
});

describe("aucune suppression", () => {
  it("les plans de clôture et d'annulation ne portent que des statuts", () => {
    const decision = planBulkClose(TASKS, new Set([1, 2]), true);
    for (const c of decision.changes) {
      expect(Object.keys(c).sort()).toEqual(["from", "id", "to"]);
    }
    for (const u of buildBulkUndoPlan(decision.changes)) {
      expect(Object.keys(u).sort()).toEqual(["id", "status"]);
    }
  });
});
