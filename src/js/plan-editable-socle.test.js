// Tests — socle de données du plan éditable (H4, lot L1)
//
// Ce que ce fichier verrouille (chaque test rougit si la fondation disparaît) :
//   1. `normalizePlan` transporte `state`, `constraints`, `edited_by_user`
//      (10 clés par tâche, et non 7) SANS écraser une retouche existante ;
//   2. le vocabulaire des états (`todo` / `dropped` / `deferred`) est fermé ;
//   3. les contraintes sont bornées et sûres (chemins, remarque 200 car., `limits` réservé) ;
//   4. `executableTasks` écarte `dropped` et `deferred`, et rien d'autre ;
//   5. `planCounts` compte gardées / écartées / plus tard / contraintes ;
//   6. la trace d'approbation naît `pending` et n'écrase jamais un accord donné ;
//   7. `summarizePlan` calcule sur les tâches ENGAGÉES (et reste identique
//      quand rien n'est écarté) ;
//   8. les sous-tâches d'une subdivision portent la même forme (10 clés).
import { describe, it, expect } from "vitest";
import {
  normalizePlan,
  normalizeTaskState,
  normalizeTaskConstraints,
  defaultTaskConstraints,
  taskHasConstraints,
  executableTasks,
  planCounts,
  pendingApproval,
  ensureApproval,
  engagedTaskCount,
  summarizePlan,
  replaceTaskWithSubtasks,
  TASK_STATES,
  APPROVAL_MODES,
} from "./orchestration.js";

const TASK_KEYS = [
  "id",
  "title",
  "description",
  "files",
  "context",
  "depends_on",
  "subtask",
  "state",
  "constraints",
  "edited_by_user",
];

describe("normalizePlan — socle du plan éditable (L1)", () => {
  it("porte exactement les 10 clés attendues (7 → 10)", () => {
    const [task] = normalizePlan([{ id: 1, title: "A", files: ["a.js"] }]);
    expect(Object.keys(task).sort()).toEqual([...TASK_KEYS].sort());
  });

  it("pose les valeurs par défaut : todo, contraintes vierges, non éditée", () => {
    const [task] = normalizePlan([{ id: 1, title: "A" }]);
    expect(task.state).toBe(TASK_STATES.TODO);
    expect(task.constraints).toEqual({ forbidden_files: [], note: "", limits: {} });
    expect(task.edited_by_user).toBe(false);
  });

  it("conserve un état, des contraintes et une marque d'édition existants", () => {
    const [task] = normalizePlan([
      {
        id: 1,
        title: "A",
        state: "deferred",
        constraints: { forbidden_files: ["src/secret.js"], note: "ne pas toucher", limits: {} },
        edited_by_user: true,
      },
    ]);
    expect(task.state).toBe(TASK_STATES.DEFERRED);
    expect(task.constraints.forbidden_files).toEqual(["src/secret.js"]);
    expect(task.constraints.note).toBe("ne pas toucher");
    expect(task.edited_by_user).toBe(true);
  });

  it("n'efface pas les retouches à la renormalisation (piège § 4.1)", () => {
    const once = normalizePlan([
      { id: 1, title: "A", state: "dropped", edited_by_user: true, constraints: { forbidden_files: ["a.js"] } },
    ]);
    const twice = normalizePlan(once);
    expect(twice).toEqual(once);
  });

  it("retombe sur todo pour un état inconnu", () => {
    const [task] = normalizePlan([{ id: 1, title: "A", state: "peut-etre" }]);
    expect(task.state).toBe(TASK_STATES.TODO);
  });
});

describe("vocabulaire des états (L1)", () => {
  it("expose les trois états et rien d'autre", () => {
    expect(Object.values(TASK_STATES)).toEqual(["todo", "dropped", "deferred"]);
  });

  it("normalise toute valeur inconnue vers todo", () => {
    expect(normalizeTaskState("dropped")).toBe("dropped");
    expect(normalizeTaskState("deferred")).toBe("deferred");
    expect(normalizeTaskState(undefined)).toBe("todo");
    expect(normalizeTaskState(null)).toBe("todo");
    expect(normalizeTaskState(42)).toBe("todo");
    expect(normalizeTaskState("DROPPED")).toBe("todo");
  });
});

describe("contraintes d'une tâche (L1)", () => {
  it("rend des contraintes vierges par défaut", () => {
    expect(defaultTaskConstraints()).toEqual({ forbidden_files: [], note: "", limits: {} });
  });

  it("filtre et nettoie les chemins interdits", () => {
    const c = normalizeTaskConstraints({ forbidden_files: ["  a.js  ", "", 42, null, "b.rs"] });
    expect(c.forbidden_files).toEqual(["a.js", "b.rs"]);
  });

  it("borne la remarque à 200 caractères", () => {
    const c = normalizeTaskConstraints({ note: "x".repeat(500) });
    expect(c.note).toHaveLength(200);
  });

  it("réserve `limits` sans jamais l'inventer", () => {
    expect(normalizeTaskConstraints({}).limits).toEqual({});
    expect(normalizeTaskConstraints({ limits: { tokens: 100 } }).limits).toEqual({ tokens: 100 });
    expect(normalizeTaskConstraints({ limits: [1, 2] }).limits).toEqual({});
  });

  it("résiste à une entrée absente ou invalide", () => {
    expect(normalizeTaskConstraints(null)).toEqual({ forbidden_files: [], note: "", limits: {} });
    expect(normalizeTaskConstraints("texte")).toEqual({ forbidden_files: [], note: "", limits: {} });
  });

  it("détecte la présence d'une contrainte réelle", () => {
    expect(taskHasConstraints({ constraints: defaultTaskConstraints() })).toBe(false);
    expect(taskHasConstraints({ constraints: { forbidden_files: ["a.js"], note: "" } })).toBe(true);
    expect(taskHasConstraints({ constraints: { forbidden_files: [], note: "attention" } })).toBe(true);
    expect(taskHasConstraints({ constraints: { forbidden_files: [], note: "   " } })).toBe(false);
    expect(taskHasConstraints({})).toBe(false);
    expect(taskHasConstraints(null)).toBe(false);
  });
});

describe("executableTasks (L1)", () => {
  const plan = normalizePlan([
    { id: 1, title: "A" },
    { id: 2, title: "B", state: "dropped" },
    { id: 3, title: "C", state: "deferred" },
    { id: 4, title: "D" },
  ]);

  it("écarte les tâches écartées et « à plus tard »", () => {
    expect(executableTasks(plan).map((t) => t.id)).toEqual([1, 4]);
  });

  it("accepte le plan complet comme le tableau de tâches", () => {
    expect(executableTasks({ plan }).map((t) => t.id)).toEqual([1, 4]);
  });

  it("garde exécutable une tâche sans état (plan venu de l'agent)", () => {
    const raw = [{ id: 1, title: "A" }, { id: 2, title: "B" }];
    expect(executableTasks(raw).map((t) => t.id)).toEqual([1, 2]);
  });

  it("ne modifie pas et ne renomme rien", () => {
    const copy = JSON.parse(JSON.stringify(plan));
    executableTasks(plan);
    expect(plan).toEqual(copy);
  });

  it("rend une liste vide pour une entrée absente", () => {
    expect(executableTasks(null)).toEqual([]);
    expect(executableTasks(undefined)).toEqual([]);
    expect(executableTasks({})).toEqual([]);
  });
});

describe("planCounts (L1)", () => {
  it("compte gardées, écartées, plus tard et contraintes", () => {
    const plan = normalizePlan([
      { id: 1, title: "A" },
      { id: 2, title: "B", state: "dropped" },
      { id: 3, title: "C", state: "deferred" },
      { id: 4, title: "D", constraints: { forbidden_files: ["x.js"] } },
    ]);
    expect(planCounts(plan)).toEqual({ total: 4, kept: 2, dropped: 1, deferred: 1, constraints: 1 });
  });

  it("rend des compteurs nuls sur un plan vide", () => {
    expect(planCounts([])).toEqual({ total: 0, kept: 0, dropped: 0, deferred: 0, constraints: 0 });
    expect(planCounts(null)).toEqual({ total: 0, kept: 0, dropped: 0, deferred: 0, constraints: 0 });
  });

  it("compte « gardées » comme exactement les tâches exécutables", () => {
    const plan = normalizePlan([
      { id: 1, title: "A" },
      { id: 2, title: "B", state: "dropped" },
      { id: 3, title: "C" },
    ]);
    expect(planCounts(plan).kept).toBe(executableTasks(plan).length);
  });
});

describe("trace d'approbation (L1)", () => {
  it("naît en attente, avec tous les compteurs à zéro", () => {
    expect(pendingApproval()).toEqual({
      mode: APPROVAL_MODES.PENDING,
      at: null,
      edited: false,
      edits: 0,
      dropped: 0,
      deferred: 0,
      constraints: 0,
      via: null,
    });
  });

  it("équipe un plan sans trace d'une approbation en attente", () => {
    const plan = { plan: normalizePlan([{ id: 1, title: "A" }]), progress: {} };
    const withApproval = ensureApproval(plan);
    expect(withApproval.approval.mode).toBe("pending");
    expect(withApproval.plan).toBe(plan.plan); // aucune copie des tâches
    expect(plan.approval).toBeUndefined(); // entrée non modifiée
  });

  it("n'écrase JAMAIS un accord déjà donné", () => {
    const approved = ensureApproval({ approval: { mode: "human", at: "2026-11-05T12:00:00Z", via: "panneau" } });
    expect(approved.approval.mode).toBe("human");
    expect(approved.approval.at).toBe("2026-11-05T12:00:00Z");
    expect(approved.approval.via).toBe("panneau");
    expect(approved.approval.edits).toBe(0); // champ manquant complété
  });

  it("garde une passe automatique en `auto`", () => {
    expect(ensureApproval({ approval: { mode: "auto" } }).approval.mode).toBe("auto");
  });

  it("refuse de considérer approuvé un mode inconnu", () => {
    expect(ensureApproval({ approval: { mode: "peut-etre" } }).approval.mode).toBe("pending");
    expect(ensureApproval({ approval: "human" }).approval.mode).toBe("pending");
    expect(ensureApproval(null).approval.mode).toBe("pending");
  });
});

describe("engagedTaskCount / summarizePlan — total engagé (L1)", () => {
  it("déduit les écartées et les « plus tard » du total", () => {
    expect(engagedTaskCount({ dropped: [2], deferred: [3] }, 5)).toBe(3);
    expect(engagedTaskCount({}, 5)).toBe(5);
    expect(engagedTaskCount(null, 5)).toBe(5);
  });

  it("ne descend jamais sous zéro", () => {
    expect(engagedTaskCount({ dropped: [1, 2, 3] }, 2)).toBe(0);
  });

  it("laisse le bilan RIGOUREUSEMENT identique quand rien n'est écarté", () => {
    const progress = { completed: [1, 2], escalated: [3], task_attempts: { "1": 2, "2": 1 } };
    expect(summarizePlan(progress, 4)).toBe(
      "📊 Bilan du plan : 2/4 tâches réussies par le codeur, 1 escaladée(s) à l'orchestrateur. 3 tentative(s) au total. Taux de réussite codeur : 50%."
    );
    expect(summarizePlan({ ...progress, dropped: [], deferred: [] }, 4)).toBe(summarizePlan(progress, 4));
  });

  it("ne compte pas une tâche écartée comme un échec", () => {
    const r = summarizePlan({ completed: [1, 2], escalated: [], task_attempts: {}, dropped: [3] }, 3);
    expect(r).toContain("2/2 tâches réussies");
    expect(r).toContain("100%");
  });

  it("garde « 0/0 » sans division par zéro", () => {
    expect(summarizePlan({ completed: [], escalated: [], task_attempts: {} }, 0)).toContain("0/0");
    expect(summarizePlan({ completed: [], escalated: [], task_attempts: {}, dropped: [1] }, 1)).toContain("0/0");
  });
});

describe("replaceTaskWithSubtasks — même forme de tâche (L1)", () => {
  it("donne aux sous-tâches les 10 clés, état todo, sans contrainte inventée", () => {
    const current = {
      plan: [{ id: 1, title: "A", files: ["a.js"], depends_on: [] }],
      progress: {},
    };
    const merged = replaceTaskWithSubtasks(current, 1, [{ title: "s1" }, { title: "s2" }]);
    expect(merged.plan).toHaveLength(2);
    for (const t of merged.plan) {
      expect(Object.keys(t).sort()).toEqual([...TASK_KEYS].sort());
      expect(t.state).toBe(TASK_STATES.TODO);
      expect(t.constraints).toEqual({ forbidden_files: [], note: "", limits: {} });
      expect(t.edited_by_user).toBe(false);
    }
    // Les sous-tâches restent exécutables et comptées.
    expect(planCounts(merged.plan).kept).toBe(2);
  });
});
