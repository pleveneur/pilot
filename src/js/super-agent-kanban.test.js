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
  filterUnqualifiedTasksByClient,
  formatTaskDeadline,
  ALL_PROJECTS,
  IDEAS_GROUP_LABEL,
  listKanbanProjects,
  filterKanbanTasks,
  selectKanbanIdeas,
  isOpenIdeaStatus,
  formatCardProject,
  isBlockedTask,
  taskDependencyState,
  isWaitingDependency,
  dependencyLabel,
} from "./super-agent-kanban.js";

describe("KANBAN_COLUMNS", () => {
  it("définit les colonnes dans l'ordre attendu (dont « À qualifier »)", () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual([
      "todo",
      "progress",
      "review",
      "done",
      "unqualified",
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

  it("reste conservateur : statut inconnu ou vide → 'unqualified'", () => {
    expect(normalizeTaskStatus("blablabla")).toBe("unqualified");
    expect(normalizeTaskStatus("")).toBe("unqualified");
    expect(normalizeTaskStatus(undefined)).toBe("unqualified");
    expect(normalizeTaskStatus(null)).toBe("unqualified");
  });

  it("reconnaît un marqueur de fin suivi d'un texte libre (statuts réels de la base)", () => {
    expect(
      normalizeTaskStatus(
        "terminee - verifie par les fichiers (commits f676020, de5db3c ; rapport verdict pret)"
      )
    ).toBe("done");
    expect(normalizeTaskStatus("diagnostic terminee - cause identifiee")).toBe("done");
    expect(normalizeTaskStatus("decidee - on n embarque pas le modele")).toBe("done");
    expect(normalizeTaskStatus("livree - v0.4.11 publiee")).toBe("done");
    expect(normalizeTaskStatus("fermee_github")).toBe("done");
    expect(normalizeTaskStatus("livre_a_tester")).toBe("done");
  });
});

describe("columnToStatus", () => {
  it("mappe chaque colonne vers son statut canonique en base", () => {
    expect(columnToStatus("todo")).toBe("demande");
    expect(columnToStatus("progress")).toBe("en_cours");
    expect(columnToStatus("review")).toBe("a_valider");
    expect(columnToStatus("done")).toBe("terminee");
    expect(columnToStatus("unqualified")).toBe("a_qualifier");
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
    expect(cols.map((c) => c.key)).toEqual(["todo", "progress", "review", "done", "unqualified"]);
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
    expect(countByColumn(cols)).toEqual({ todo: 0, progress: 1, review: 0, done: 2, unqualified: 0 });
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
  });

  it("exclut les tâches terminées, annulées et à qualifier (statut inconnu)", () => {
    expect(isOpenTaskStatus("terminee")).toBe(false);
    expect(isOpenTaskStatus("livree")).toBe(false);
    expect(isOpenTaskStatus("annulee")).toBe(false);
    expect(isOpenTaskStatus("abandonne")).toBe(false);
    expect(isOpenTaskStatus("blablabla")).toBe(false);
    expect(isOpenTaskStatus("redaction_specs")).toBe(false);
  });

  // Non-régression : une tâche close par un statut en texte libre NE DOIT PAS
  // se remettre à compter comme « à faire » (libellés réels de la base Pilot).
  it("ne compte pas comme à faire les tâches closes en texte libre", () => {
    const libelles = [
      "terminee - verifie par les fichiers (commits f676020, de5db3c ; 1202 tests interface)",
      "terminee - corrige et verifie",
      "diagnostic terminee - cause identifiee (marquage livre optimiste)",
      "decidee - on n embarque pas le modele",
      "livree - v0.4.11 publiee et installateurs disponibles",
      "livre_a_tester",
      "fermee_github",
    ];
    for (const s of libelles) {
      expect(isOpenTaskStatus(s)).toBe(false);
    }
  });
});

describe("taskStatusLabel", () => {
  it("rend le libellé de la colonne du statut", () => {
    expect(taskStatusLabel("en_cours")).toBe("En cours");
    expect(taskStatusLabel("a_valider")).toBe("À valider");
    expect(taskStatusLabel("terminee")).toBe("Terminé");
    expect(taskStatusLabel("demande")).toBe("À faire");
  });

  it("rend « Annulée » pour un statut annulé, « À qualifier » pour un statut inconnu", () => {
    expect(taskStatusLabel("annulee")).toBe("Annulée");
    expect(taskStatusLabel("blablabla")).toBe("À qualifier");
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

describe("filterUnqualifiedTasksByClient", () => {
  it("isole les statuts inconnus dans une case distincte (jamais « à faire »)", () => {
    const clients = [
      {
        name: "Pilot",
        tasks: [
          { id: 1, status: "demande" },
          { id: 2, status: "terminee - verifie par les fichiers" },
          { id: 25, status: "redaction_specs" },
        ],
      },
    ];
    const out = filterUnqualifiedTasksByClient(clients);
    expect(out).toHaveLength(1);
    expect(out[0].tasks.map((t) => t.id)).toEqual([25]);
    // et il ne figure pas dans la liste « à faire »
    expect(filterOpenTasksByClient(clients)[0].tasks.map((t) => t.id)).toEqual([1]);
  });

  it("gère une entrée vide ou null", () => {
    expect(filterUnqualifiedTasksByClient([])).toEqual([]);
    expect(filterUnqualifiedTasksByClient(null)).toEqual([]);
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

// ── Kanban multi-projets : filtre de projet + sous-catégorie « Idées » ─────────
// Ces tests verrouillent le comportement attendu à l'écran : sélecteur « tous /
// un projet », nom du projet (et du client) sur les cartes, idées rangées SOUS
// les tâches « À faire » (jamais mélangées), motif de blocage détecté.
const SAMPLE_TASKS = [
  {
    name: "Client A",
    tasks: [
      { id: 1, status: "demande", project_path: "/pilot", project_name: "Pilot", client_name: "Client A" },
      { id: 2, status: "en_cours", project_path: "/autre", project_name: "Autre", client_name: "Sans client" },
    ],
  },
  { name: "Sans client", tasks: [{ id: 3, status: "terminee", project_path: "/pilot", project_name: "Pilot" }] },
];
const SAMPLE_IDEAS = [
  { id: 10, title: "Idée Pilot", status: "idee", project_path: "/pilot", project_name: "Pilot", client_name: "Client A" },
  { id: 11, title: "Idée Autre", status: "a_prevoir", project_path: "/autre", project_name: "Autre" },
  { id: 12, title: "Idée faite", status: "implementee", project_path: "/pilot", project_name: "Pilot" },
];

describe("listKanbanProjects", () => {
  it("liste les projets uniques des tâches et des idées, triés par nom", () => {
    const projects = listKanbanProjects(SAMPLE_TASKS, SAMPLE_IDEAS);
    expect(projects.map((p) => p.path)).toEqual(["/autre", "/pilot"]);
    expect(projects[0].name).toBe("Autre");
  });

  it("ignore les entrées sans chemin et gère une entrée vide ou null", () => {
    expect(listKanbanProjects([{ tasks: [{ project_path: "" }] }], [])).toEqual([]);
    expect(listKanbanProjects(null, null)).toEqual([]);
  });
});

describe("filterKanbanTasks", () => {
  it("ne filtre rien pour ALL_PROJECTS (valeur par défaut) ou une valeur vide", () => {
    expect(filterKanbanTasks(SAMPLE_TASKS, ALL_PROJECTS).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(filterKanbanTasks(SAMPLE_TASKS, "").map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("ne garde que les tâches du projet demandé", () => {
    expect(filterKanbanTasks(SAMPLE_TASKS, "/pilot").map((t) => t.id)).toEqual([1, 3]);
    expect(filterKanbanTasks(SAMPLE_TASKS, "/autre").map((t) => t.id)).toEqual([2]);
  });
});

describe("selectKanbanIdeas", () => {
  it("exclut les idées déjà implémentées et filtre par projet", () => {
    expect(selectKanbanIdeas(SAMPLE_IDEAS, ALL_PROJECTS).map((i) => i.id)).toEqual([10, 11]);
    expect(selectKanbanIdeas(SAMPLE_IDEAS, "/pilot").map((i) => i.id)).toEqual([10]);
  });

  it("gère une entrée vide ou null", () => {
    expect(selectKanbanIdeas(null, ALL_PROJECTS)).toEqual([]);
    expect(selectKanbanIdeas([], "/pilot")).toEqual([]);
  });
});

describe("isOpenIdeaStatus", () => {
  it("considère ouvertes les idées à étudier/planifier (aucune confusion avec une tâche)", () => {
    expect(isOpenIdeaStatus("idee")).toBe(true);
    expect(isOpenIdeaStatus("a_prevoir")).toBe(true);
    expect(isOpenIdeaStatus("etudiee - verdict rendu")).toBe(true);
    expect(isOpenIdeaStatus("")).toBe(true);
    expect(isOpenIdeaStatus(undefined)).toBe(true);
  });

  it("clôt les idées implémentées, réalisées, livrées, annulées ou rejetées", () => {
    expect(isOpenIdeaStatus("implémentée")).toBe(false);
    expect(isOpenIdeaStatus("realisee")).toBe(false);
    expect(isOpenIdeaStatus("livrée - v0.4.29")).toBe(false);
    expect(isOpenIdeaStatus("annulée")).toBe(false);
    expect(isOpenIdeaStatus("abandonnee")).toBe(false);
    expect(isOpenIdeaStatus("rejetee")).toBe(false);
  });
});

describe("buildKanbanColumns (idées)", () => {
  it("range les idées en SOUS-catégorie de « À faire », jamais parmi les cartes", () => {
    const cols = buildKanbanColumns([{ id: 1, status: "demande" }], SAMPLE_IDEAS);
    const todo = cols.find((c) => c.key === "todo");
    expect(todo.cards.map((t) => t.id)).toEqual([1]);
    expect(todo.ideaCards.map((i) => i.id)).toEqual([10, 11, 12]);
    expect(cols.filter((c) => c.key !== "todo").every((c) => !c.ideaCards)).toBe(true);
    expect(IDEAS_GROUP_LABEL).toBe("Idées");
  });

  it("expose ideaCards vide quand aucune idée n'est fournie (appel à un argument inchangé)", () => {
    const todo = buildKanbanColumns([]).find((c) => c.key === "todo");
    expect(todo.ideaCards).toEqual([]);
  });

  it("les idées ne polluent jamais le compteur de tâches des colonnes", () => {
    const cols = buildKanbanColumns([{ id: 1, status: "demande" }], SAMPLE_IDEAS);
    expect(countByColumn(cols)).toEqual({ todo: 1, progress: 0, review: 0, done: 0, unqualified: 0 });
  });
});

describe("formatCardProject", () => {
  it("affiche le projet et le client (s'il est renseigné)", () => {
    expect(formatCardProject({ project_name: "Pilot", client_name: "Acme" })).toBe("Pilot - Acme");
    expect(formatCardProject({ project_name: "Pilot", client_name: "Sans client" })).toBe("Pilot");
    expect(formatCardProject({ project_name: "Pilot" })).toBe("Pilot");
    expect(formatCardProject({ client_name: "Acme" })).toBe("Acme");
    expect(formatCardProject({})).toBe("");
    expect(formatCardProject(null)).toBe("");
  });
});

describe("isBlockedTask", () => {
  it("ne bloque que lorsqu'un motif de blocage est renseigné (blocker_reason)", () => {
    expect(isBlockedTask({ blocker_reason: "Attente décision client" })).toBe(true);
    expect(isBlockedTask({ blocker_reason: "   " })).toBe(false);
    expect(isBlockedTask({ blocker_reason: null })).toBe(false);
    expect(isBlockedTask({})).toBe(false);
    expect(isBlockedTask(null)).toBe(false);
  });
});

// Dépendances entre tâches (« attend la tâche X ») : l'état est calculé par le
// cœur (`dependency_state`). L'interface ne devine jamais un « en attente » et
// distingue cette attente du blocage par incident (`blocker_reason`).
describe("taskDependencyState", () => {
  it("lit l'état fourni par le cœur, sinon considère la tâche prête", () => {
    expect(taskDependencyState({ dependency_state: "waiting" })).toBe("waiting");
    expect(taskDependencyState({ dependency_state: "ready" })).toBe("ready");
    expect(taskDependencyState({ dependency_state: "unknown" })).toBe("unknown");
    // Champ absent (cœur plus ancien) : jamais un « en attente » inventé.
    expect(taskDependencyState({})).toBe("ready");
    expect(taskDependencyState(null)).toBe("ready");
    // Valeur inconnue : traité comme prête (fail-open d'affichage).
    expect(taskDependencyState({ dependency_state: "bizarre" })).toBe("ready");
  });
});

describe("isWaitingDependency", () => {
  it("ne vaut vrai que pour une dépendance non close", () => {
    expect(isWaitingDependency({ dependency_state: "waiting" })).toBe(true);
    expect(isWaitingDependency({ dependency_state: "ready" })).toBe(false);
    expect(isWaitingDependency({ dependency_state: "unknown" })).toBe(false);
    // Une tâche bloquée par incident n'attend pas forcément une tâche.
    expect(isWaitingDependency({ blocker_reason: "Panne" })).toBe(false);
    expect(isWaitingDependency(null)).toBe(false);
  });
});

describe("dependencyLabel", () => {
  it("nomme la tâche attendue, reste générique sans titre, vide sinon", () => {
    expect(dependencyLabel({ dependency_state: "waiting", depends_on_title: "Specs" })).toBe(
      "En attente de : Specs",
    );
    expect(dependencyLabel({ dependency_state: "waiting" })).toBe(
      "En attente d'une autre tache",
    );
    // Pas en attente → aucun libellé (carte normale ou blocage par incident).
    expect(dependencyLabel({ dependency_state: "ready", depends_on_title: "Specs" })).toBe("");
    expect(dependencyLabel({ blocker_reason: "Panne" })).toBe("");
    expect(dependencyLabel(null)).toBe("");
  });
});
