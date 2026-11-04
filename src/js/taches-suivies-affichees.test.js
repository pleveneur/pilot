// VERROU — « la liste de tâches affichée reflète le suivi réel ».
//
// Défaut corrigé (docs/rapports/RAPPORT-liste-taches-affichee.md) : le volet
// « Tâches » du panneau du suivi ne lisait QUE le store d'activité des agents. Il
// ne lisait jamais la base de suivi, donc :
//   - créer / annuler / regrouper une tâche dans le suivi ne changeait rien à
//     l'écran ;
//   - le nombre affiché ne pouvait pas correspondre aux tâches ouvertes ;
//   - une tâche SEULEMENT SUIVIE était indistinguable d'un travail en cours ou en
//     attente (elle n'apparaissait nulle part).
// La règle « ouverte ou close » (`isOpenTaskStatus`) et ses filtres existaient
// déjà mais n'avaient AUCUN appelant en production — le pont manquait.
//
// Ces preuves échouent si le défaut revient : une tâche close / annulée / à
// qualifier réapparaît comme « suivie », une tâche peut apparaître deux fois, le
// volet cesse de composer le groupe « Suivi » après les missions, ou le Kanban
// cesse de signaler ses écritures / de réagir au signal.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  openTrackedTasks,
  trackedTasksSignature,
  renderTrackedTasksGroupHtml,
  loadTrackedTasks,
  resetTrackedTasksCache,
  notifyTrackedTasksChanged,
  onTrackedTasksChanged,
  TACHES_SUIVIES_GROUP_LABEL,
  TACHES_SUIVIES_MAX,
  TACHES_SUIVIES_TTL_MS,
} from "./taches-suivies-ecran.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (nom) => readFileSync(join(ICI, nom), "utf8").replace(/\r\n/g, "\n");

/** Réponse de `get_super_agent_kanban` (forme réelle : clients → tasks). */
function kanban(clients) {
  return { clients, ideas: [] };
}

const T = (id, title, status, extra = {}) => ({ id, title, status, ...extra });

const BASE = kanban([
  {
    name: "Sans client",
    tasks: [
      T(1, "Écrire le rapport", "demande", { project_name: "Pilot", project_path: "G:/pilot" }),
      T(2, "Corriger la file", "en_cours", { project_name: "Pilot", project_path: "G:/pilot" }),
      T(3, "Vieille dette", "terminee", { project_name: "Pilot", project_path: "G:/pilot" }),
      T(4, "Fausse piste", "annulee", { project_name: "Pilot", project_path: "G:/pilot" }),
      T(5, "Statut libre", "terminee - OUI, le moteur peut ecrire", {
        project_name: "Pilot",
        project_path: "G:/pilot",
      }),
      T(6, "À trier", "aqualifier", { project_name: "Pilot", project_path: "G:/pilot" }),
      T(7, "En validation", "a_valider", { project_name: "Pilot", project_path: "G:/pilot" }),
    ],
  },
  {
    name: "Client A",
    tasks: [T(8, "Autre projet", "demande", { project_name: "Autre", project_path: "G:/autre" })],
  },
]);

describe("openTrackedTasks — la règle unique « ouverte ou close »", () => {
  it("ne garde QUE les tâches qui restent à faire", () => {
    const ids = openTrackedTasks(BASE).map((t) => t.id);
    expect(ids).toEqual([1, 2, 7, 8]);
  });

  it("n'affiche jamais une tâche close, annulée ou à qualifier", () => {
    const ids = new Set(openTrackedTasks(BASE).map((t) => t.id));
    for (const clos of [3, 4, 5, 6]) expect(ids.has(clos)).toBe(false);
  });

  it("porte le libellé lisible du statut (pas le statut brut)", () => {
    const t1 = openTrackedTasks(BASE).find((t) => t.id === 1);
    expect(t1.statusLabel).toBe("À faire");
    expect(t1.statusKey).toBe("todo");
    const t2 = openTrackedTasks(BASE).find((t) => t.id === 2);
    expect(t2.statusLabel).toBe("En cours");
    expect(t2.statusKey).toBe("progress");
  });

  it("dédoublonne par IDENTIFIANT : une tâche renvoyée deux fois n'apparaît qu'une fois", () => {
    const double = kanban([
      { name: "Sans client", tasks: [T(1, "Une fois", "demande", { project_name: "Pilot" })] },
      { name: "Client A", tasks: [T(1, "Une fois", "demande", { project_name: "Pilot" })] },
    ]);
    const tasks = openTrackedTasks(double);
    expect(tasks).toHaveLength(1);
    // et le HTML ne porte qu'une seule ligne pour cette tâche
    const html = renderTrackedTasksGroupHtml(tasks);
    expect(html.split(`data-task-id="1"`).length - 1).toBe(1);
  });

  it("ignore une charge utile incomplète sans lever (fail-open)", () => {
    expect(openTrackedTasks(null)).toEqual([]);
    expect(openTrackedTasks({})).toEqual([]);
    expect(openTrackedTasks(kanban([{ name: "x", tasks: [null, { title: "sans id" }] }]))).toEqual([]);
  });
});

describe("renderTrackedTasksGroupHtml — le groupe « Suivi » du volet", () => {
  it("ne rend RIEN quand il n'y a aucune tâche suivie (aucun en-tête vide)", () => {
    expect(renderTrackedTasksGroupHtml([])).toBe("");
    expect(renderTrackedTasksGroupHtml(null)).toBe("");
    expect(renderTrackedTasksGroupHtml(openTrackedTasks(kanban([{ name: "x", tasks: [] }])))).toBe("");
  });

  it("annonce le nombre et dit que ces tâches ne sont PAS en travail", () => {
    const html = renderTrackedTasksGroupHtml(openTrackedTasks(BASE));
    expect(html).toContain(`${TACHES_SUIVIES_GROUP_LABEL} (4)`);
    expect(html).toContain("aucun agent ne travaille dessus");
  });

  it("donne le statut de chaque tâche suivie (donc distinguable d'un travail en cours)", () => {
    const html = renderTrackedTasksGroupHtml(openTrackedTasks(BASE));
    expect(html).toContain("Écrire le rapport");
    expect(html).toContain("À faire");
    expect(html).toContain("En cours");
    expect(html).toContain("À valider");
    // aucune tâche close dans le groupe
    expect(html).not.toContain("Vieille dette");
    expect(html).not.toContain("Fausse piste");
  });

  it("tronque proprement au-delà du plafond, en renvoyant vers le Kanban", () => {
    const trop = Array.from({ length: TACHES_SUIVIES_MAX + 3 }, (_, i) =>
      T(i + 1, `Tâche ${i + 1}`, "demande", { project_name: "Pilot" })
    );
    const tasks = openTrackedTasks(kanban([{ name: "x", tasks: trop }]));
    const max = tasks.length - 1;
    const html = renderTrackedTasksGroupHtml(tasks, { max });
    expect(html).toContain(`${TACHES_SUIVIES_GROUP_LABEL} (${TACHES_SUIVIES_MAX + 3})`);
    expect(html).toContain("et 1 autre tâche suivie");
    expect(html).toContain("onglet Kanban");
    expect(html.split("data-task-id=").length - 1).toBe(max);
  });

  it("échappe le texte des tâches (titre et projet viennent de la base)", () => {
    const html = renderTrackedTasksGroupHtml([
      { id: 9, title: "<img src=x onerror=alert(1)>", status: "demande", statusKey: "todo", statusLabel: "À faire", project: "a<b", client: "" },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("loadTrackedTasks — une seule requête, jamais d'écran vidé", () => {
  beforeEach(() => resetTrackedTasksCache());

  it("réutilise la liste lue pendant la mémoire courte", async () => {
    let appels = 0;
    const fetch = async () => {
      appels += 1;
      return BASE;
    };
    await loadTrackedTasks({ fetch, now: 1000 });
    await loadTrackedTasks({ fetch, now: 1000 + TACHES_SUIVIES_TTL_MS - 1 });
    expect(appels).toBe(1);
  });

  it("relit la base quand la mémoire courte est expirée ou sur force", async () => {
    let appels = 0;
    const fetch = async () => {
      appels += 1;
      return BASE;
    };
    await loadTrackedTasks({ fetch, now: 1000 });
    await loadTrackedTasks({ fetch, now: 1000 + TACHES_SUIVIES_TTL_MS + 1 });
    await loadTrackedTasks({ fetch, now: 1000 + TACHES_SUIVIES_TTL_MS + 2, force: true });
    expect(appels).toBe(3);
  });

  it("ne lance qu'UNE requête à la fois (aucun doublon en vol)", async () => {
    let appels = 0;
    let liberer;
    const fetch = () => {
      appels += 1;
      return new Promise((resolve) => {
        liberer = () => resolve(BASE);
      });
    };
    const a = loadTrackedTasks({ fetch, now: 1000 });
    const b = loadTrackedTasks({ fetch, now: 1000 });
    liberer();
    await Promise.all([a, b]);
    expect(appels).toBe(1);
  });

  it("une lecture impossible conserve la dernière liste connue (aucune exception)", async () => {
    await loadTrackedTasks({ fetch: async () => BASE, now: 1000 });
    const apres = await loadTrackedTasks({
      fetch: async () => {
        throw new Error("backend absent");
      },
      now: 999999,
      force: true,
    });
    expect(apres.map((t) => t.id)).toEqual([1, 2, 7, 8]);
  });
});

describe("le signal « le suivi a changé »", () => {
  beforeEach(() => resetTrackedTasksCache());

  it("prévient les abonnés et périme la mémoire courte", async () => {
    let recu = 0;
    const off = onTrackedTasksChanged(() => {
      recu += 1;
    });
    let appels = 0;
    const fetch = async () => {
      appels += 1;
      return BASE;
    };
    await loadTrackedTasks({ fetch, now: 1000 });
    notifyTrackedTasksChanged();
    await loadTrackedTasks({ fetch, now: 1001 }); // la photo a été oubliée
    expect(recu).toBe(1);
    expect(appels).toBe(2);
    off();
    notifyTrackedTasksChanged();
    expect(recu).toBe(1);
  });

  it("un abonné fautif n'empêche pas les autres d'être prévenus", () => {
    let recu = 0;
    const off1 = onTrackedTasksChanged(() => {
      throw new Error("abonné cassé");
    });
    const off2 = onTrackedTasksChanged(() => {
      recu += 1;
    });
    notifyTrackedTasksChanged();
    expect(recu).toBe(1);
    off1();
    off2();
  });
});

describe("branchement à l'écran (aucune photo périmée)", () => {
  it("le volet « Tâches » compose les MISSIONS puis le SUIVI", () => {
    const src = lire("super-agent.js");
    expect(src).toContain("from \"./taches-suivies-ecran.js\"");
    expect(src).toContain(
      "renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml()"
    );
    // le groupe suit la même règle que la liste qu'il complète
    expect(src).toContain("renderTrackedTasksGroupHtml(superTrackedTasks)");
    // l'abonnement au signal est posé dans la surveillance permanente
    expect(src).toContain("onTrackedTasksChanged(() => refreshSuperTrackedTasks({ force: true }))");
    // la fin de tour de l'Assistant (qui a pu écrire dans le suivi) signale
    expect(src).toContain("notifyTrackedTasksChanged();");
  });

  it("le Kanban signale ses écritures et relit la base sur signal venu d'ailleurs", () => {
    const src = lire("super-agent-kanban-view.js");
    expect(src).toContain("from \"./taches-suivies-ecran.js\"");
    expect(src).toContain("function reloadAfterTrackingWrite()");
    expect(src).toContain("notifyTrackedTasksChanged();");
    expect(src).toContain("onTrackedTasksChanged(() =>");
    // TOUTES les écritures passent par le même point (aucune n'oublie le signal) :
    // plus aucun `loadSuperKanban()` sec après une écriture.
    expect(src.split("reloadAfterTrackingWrite();").length - 1).toBe(5);
    expect(src.split("loadSuperKanban();").length - 1).toBe(3);
    // et l'abonnement est retiré avec l'onglet
    expect(src).toContain("unlistenTracking();");
  });
});

describe("trackedTasksSignature", () => {
  it("change dès qu'un statut change (une suppression / un regroupement se voit)", () => {
    const a = openTrackedTasks(BASE);
    const b = a.map((t) => (t.id === 1 ? { ...t, status: "en_cours" } : t));
    expect(trackedTasksSignature(a)).not.toBe(trackedTasksSignature(b));
    expect(trackedTasksSignature(a)).toBe(trackedTasksSignature(openTrackedTasks(BASE)));
  });
});
