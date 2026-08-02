// Tests unitaires — orchestration.js (fonctions pures du Mode Orchestration)
import { describe, it, expect } from "vitest";
import {
  normalizePlan,
  parsePlanResponse,
  detectCoderMarker,
  detectReflectionOnly,
  pickNextTask,
  isPlanBlocked,
  mergeRevisedPlan,
  getAdaptiveGranularity,
  estimateTokens,
  compactTaskPrompt,
  resolvePath,
  extractMentionedFiles,
  truncateTestOutput,
  buildTreeString,
  extractTaskSummary,
} from "./orchestration.js";

// ── normalizePlan ──────────────────────────────────────────────────────
describe("normalizePlan", () => {
  it("retourne [] si ce n'est pas un tableau", () => {
    expect(normalizePlan(null)).toEqual([]);
    expect(normalizePlan("plan")).toEqual([]);
    expect(normalizePlan({})).toEqual([]);
  });

  it("normalise des tâches bien formées", () => {
    const plan = normalizePlan([
      { id: 1, title: "A", description: "d", files: ["a.js"], depends_on: [] },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 1, title: "A", description: "d", files: ["a.js"], depends_on: [] });
    expect(plan[0].subtask).toBe(false);
  });

  it("gère les id string et les dépendances invalides", () => {
    const plan = normalizePlan([
      { id: "2", title: "B", depends_on: [1, 999, "x"] },
    ]);
    expect(plan[0].id).toBe(2);
    expect(plan[0].depends_on).toEqual([]); // 999 et "x" absents du plan → filtrés
  });

  it("filtre les tâches sans id valide", () => {
    const plan = normalizePlan([
      { id: null, title: "sans id" },
      { id: "abc", title: "id non numérique" },
      { id: 5, title: "valide" },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe(5);
  });

  it("filtre les fichiers non-string", () => {
    const plan = normalizePlan([{ id: 1, title: "A", files: ["a.js", 42, null, "b.rs"] }]);
    expect(plan[0].files).toEqual(["a.js", "b.rs"]);
  });

  it("préserve le flag subtask", () => {
    const plan = normalizePlan([{ id: 1, title: "A", subtask: true }]);
    expect(plan[0].subtask).toBe(true);
  });

  it("donne un titre par défaut quand absent", () => {
    const plan = normalizePlan([{ id: 7 }]);
    expect(plan[0].title).toBe("Tâche 7");
  });

  it("garde uniquement les dépendances entre tâches existantes", () => {
    const plan = normalizePlan([
      { id: 1, title: "A", depends_on: [2] },
      { id: 2, title: "B", depends_on: [] },
    ]);
    expect(plan[0].depends_on).toEqual([2]);
  });
});

// ── parsePlanResponse ──────────────────────────────────────────────────
describe("parsePlanResponse", () => {
  it("retourne plan null sur texte vide", () => {
    expect(parsePlanResponse("")).toEqual({ plan: null, globalDirective: null });
    expect(parsePlanResponse(null)).toEqual({ plan: null, globalDirective: null });
  });

  it("parse un bloc markdown ```json", () => {
    const r = parsePlanResponse('Voici le plan :\n```json\n{"plan":[{"id":1,"title":"T1","files":["a.js"]}],"global_directive":"objectif"}\n```');
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0].id).toBe(1);
    expect(r.globalDirective).toBe("objectif");
  });

  it("parse un objet JSON direct", () => {
    const r = parsePlanResponse('{"plan":[{"id":2,"title":"T2"}],"global_directive":""}');
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0].title).toBe("T2");
  });
});

// ── detectCoderMarker ──────────────────────────────────────────────────
describe("detectCoderMarker", () => {
  it("détecte DONE avec payload", () => {
    expect(detectCoderMarker("Travail fait\nDONE: terminé le module")).toEqual({
      marker: "DONE",
      payload: "terminé le module",
    });
  });

  it("détecte SELF_FIX", () => {
    const r = detectCoderMarker("Problème vu\nSELF_FIX: je corrige\npuis j'ajuste");
    expect(r.marker).toBe("SELF_FIX");
    expect(r.payload).toContain("je corrige");
  });

  it("détecte NEED_HELP", () => {
    expect(detectCoderMarker("Je bloque\nNEED_HELP: erreur de compilation").marker).toBe("NEED_HELP");
  });

  it("retourne null marker si aucun marqueur", () => {
    expect(detectCoderMarker("juste du texte")).toEqual({ marker: null, payload: null });
  });

  it("prend le dernier marqueur quand plusieurs", () => {
    const r = detectCoderMarker("DONE: premier\nSELF_FIX: correctif");
    expect(r.marker).toBe("SELF_FIX");
  });

  it("gère entrée invalide", () => {
    expect(detectCoderMarker(null)).toEqual({ marker: null, payload: null });
  });
});

// ── detectReflectionOnly ──────────────────────────────────────────────
describe("detectReflectionOnly", () => {
  it("true si réflexion sans bloc de modification", () => {
    expect(detectReflectionOnly("REFLEXION_DONE\nJ'ai réfléchi à la solution")).toBe(true);
  });

  it("false si il y a un bloc de modification", () => {
    expect(detectReflectionOnly("REFLEXION_DONE\nSEARCH/REPLACE: mon bloc")).toBe(false);
  });

  it("false si marqueur d'action présent", () => {
    expect(detectReflectionOnly("REFLEXION_DONE\nDONE: fini")).toBe(false);
  });

  it("false si pas de signal de réflexion", () => {
    expect(detectReflectionOnly("DONE: directement")).toBe(false);
  });
});

// ── pickNextTask / isPlanBlocked ──────────────────────────────────────
describe("pickNextTask", () => {
  const tasks = [
    { id: 1, depends_on: [] },
    { id: 2, depends_on: [1] },
    { id: 3, depends_on: [1, 2] },
  ];

  it("choisit la première tâche sans dépendance", () => {
    expect(pickNextTask(tasks, new Set()).id).toBe(1);
  });

  it("choisit une tâche dont les dépendances sont terminées", () => {
    expect(pickNextTask(tasks, new Set([1])).id).toBe(2);
  });

  it("retourne null si tout est bloqué", () => {
    expect(pickNextTask(tasks, new Set())).not.toBeNull();
    // tâche 1 dépend de 2 qui dépend de 1 → cycle
    expect(pickNextTask([{ id: 1, depends_on: [2] }, { id: 2, depends_on: [1] }], new Set())).toBeNull();
  });
});

describe("isPlanBlocked", () => {
  it("false si aucune tâche restante", () => {
    expect(isPlanBlocked([{ id: 1, depends_on: [] }], new Set([1]))).toBe(false);
  });

  it("true si tâches restantes mais dépendances bloquées (cycle)", () => {
    expect(
      isPlanBlocked(
        [{ id: 1, depends_on: [2] }, { id: 2, depends_on: [1] }],
        new Set(),
      ),
    ).toBe(true);
  });

  it("false si une tâche est exécutable", () => {
    expect(isPlanBlocked([{ id: 1, depends_on: [] }], new Set())).toBe(false);
  });
});

// ── mergeRevisedPlan ──────────────────────────────────────────────────
describe("mergeRevisedPlan", () => {
  const current = {
    plan: [
      { id: 1, title: "terminée", files: [] },
      { id: 2, title: "à revoir", files: [] },
    ],
    progress: { completed: [1], escalated: [], task_attempts: { "1": 1, "2": 2 } },
  };

  it("conserve les tâches terminées et remplace les restantes", () => {
    const r = mergeRevisedPlan(current, [{ id: 3, title: "nouvelle", files: [] }]);
    expect(r.plan.map((t) => t.id)).toEqual([1, 3]);
  });

  it("nettoie task_attempts des tâches supprimées", () => {
    const r = mergeRevisedPlan(current, [{ id: 3, title: "nouvelle", files: [] }]);
    // id 2 supprimé → son attempt disparaît ; id 3 révisé absent des attempts
    expect(Object.keys(r.progress.task_attempts)).toEqual(["1"]);
  });

  it("réinitialise current_task", () => {
    const r = mergeRevisedPlan(current, []);
    expect(r.progress.current_task).toBe(0);
  });
});

// ── getAdaptiveGranularity ────────────────────────────────────────────
describe("getAdaptiveGranularity", () => {
  it("retourne la base si aucun attempt", () => {
    expect(getAdaptiveGranularity("medium", { task_attempts: {} })).toBe("medium");
  });

  it("descend en granularité si beaucoup d'échecs", () => {
    const r = getAdaptiveGranularity("medium", { task_attempts: { 1: 2, 2: 2 } });
    expect(r).toBe("fine");
  });

  it("monte en granularité si tout va bien", () => {
    const r = getAdaptiveGranularity("medium", { task_attempts: { 1: 0 } });
    expect(r).toBe("large");
  });

  it("ne dépasse pas les bornes atomic/large", () => {
    expect(getAdaptiveGranularity("atomic", { task_attempts: { 1: 2, 2: 2 } })).toBe("atomic");
    expect(getAdaptiveGranularity("large", { task_attempts: { 1: 0 } })).toBe("large");
  });
});

// ── estimateTokens / compactTaskPrompt ────────────────────────────────
describe("estimateTokens", () => {
  it("approximation 4 caractères / token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens(null)).toBe(0);
  });
});

describe("compactTaskPrompt", () => {
  it("retourne le prompt inchangé si sous le seuil", () => {
    const p = "court";
    expect(compactTaskPrompt(p, 100)).toBe(p);
  });

  it("tronque l'arborescence si trop grand", () => {
    const p =
      "=== ARBORESCENCE DU PROJET ===\n" + "x".repeat(500) +
      "\n=== FORMAT OBLIGATOIRE ===\ncontenu";
    const r = compactTaskPrompt(p, 50);
    expect(r).toContain("arborescense tronquée");
  });
});

// ── resolvePath ───────────────────────────────────────────────────────
describe("resolvePath", () => {
  it("laisse les chemins absolus intacts", () => {
    expect(resolvePath("/abs/path", "/proj")).toBe("/abs/path");
    expect(resolvePath("C:\\win\\path", "/proj")).toBe("C:\\win\\path");
  });

  it("résout un chemin relatif dans le projet", () => {
    expect(resolvePath("src/a.js", "/home/user/proj")).toBe("/home/user/proj/src/a.js");
  });

  it("gère les slashs de fin de projet", () => {
    expect(resolvePath("src/a.js", "/home/user/proj/")).toBe("/home/user/proj/src/a.js");
    expect(resolvePath("src/a.js", "/home/user/proj\\")).toBe("/home/user/proj/src/a.js");
  });

  it("traite un chemin commençant par / comme absolu", () => {
    // Le code considère tout chemin débutant par / comme déjà absolu
    expect(resolvePath("/src/a.js", "/home/user/proj")).toBe("/src/a.js");
  });

  it("retourne le path si pas de projectPath", () => {
    expect(resolvePath("rel", null)).toBe("rel");
  });
});

// ── extractMentionedFiles ─────────────────────────────────────────────
describe("extractMentionedFiles", () => {
  it("extrait les fichiers avec extension de code (1 niveau de répertoire)", () => {
    const files = extractMentionedFiles("modifié src/main.js");
    expect(files).toContain("src/main.js");
    expect(extractMentionedFiles("src-tauri/src/lib.rs")).toContain("src-tauri/src/lib.rs");
  });

  it("ne capture pas le mot précédent (regex \\s correctement échappé)", () => {
    // Avant correctif : le backslash de \\s était perdu → "fichier main.js" capturé en bloc.
    expect(extractMentionedFiles("fichier main.js")).toEqual(["main.js"]);
    expect(extractMentionedFiles("dans src/main.js" )).toContain("src/main.js");
  });

  it("extrait plusieurs fichiers dans la même phrase", () => {
    const files = extractMentionedFiles("modifié src/main.js et src-tauri/src/lib.rs");
    expect(files).toContain("src/main.js");
    expect(files).toContain("src-tauri/src/lib.rs");
    expect(files).toHaveLength(2);
  });

  it("extrait les marqueurs explicites CREATE: et NO_CHANGE:", () => {
    const files = extractMentionedFiles("CREATE: src/nouveau.js\nNO_CHANGE: src/inchange.rs");
    expect(files).toContain("src/nouveau.js");
    expect(files).toContain("src/inchange.rs");
  });

  it("ignore les versions numériques et URLs", () => {
    const files = extractMentionedFiles("v1.2.3 du package https://ex.com/a.js");
    expect(files.some((f) => f.startsWith("1.2"))).toBe(false);
    expect(files.some((f) => f.startsWith("http"))).toBe(false);
  });

  it("retourne [] sur entrée vide", () => {
    expect(extractMentionedFiles("")).toEqual([]);
    expect(extractMentionedFiles(null)).toEqual([]);
  });
});

// ── truncateTestOutput ────────────────────────────────────────────────
describe("truncateTestOutput", () => {
  it("retourne le texte si court", () => {
    expect(truncateTestOutput("court")).toBe("court");
  });

  it("tronque et signale si long", () => {
    const long = "x".repeat(5000);
    const r = truncateTestOutput(long, 100);
    expect(r.length).toBeLessThan(5000);
    expect(r).toContain("tronqué");
  });
});

// ── buildTreeString / extractTaskSummary ──────────────────────────────
describe("buildTreeString", () => {
  it("génère une représentation de l'arbre", () => {
    const r = buildTreeString({ path: "proj", type: "dir", children: [] });
    expect(typeof r).toBe("string");
  });
});

describe("extractTaskSummary", () => {
  it("retourne une valeur même si vide", () => {
    // fonctionnellement : retourne le résumé trouvé ou un fallback
    expect(typeof extractTaskSummary("", 1)).toBe("string");
  });
});
