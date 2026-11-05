// VERROU — « le volet Tâches du panneau Travail ne montre QUE le travail des
// agents ».
//
// Décision du propriétaire (2026-11-05, réaffirmée, sans appel) :
// docs/rapports/RAPPORT-liste-travail-sans-suivi.md. Le panneau « Travail »
// (bouton `#agent-activity` : onglets Agents / Tâches / Événements, en mode
// Détaillé COMME en mode Vocal) est le PLAN DE TRAVAIL DES AGENTS : il montre
// les missions qui tournent et celles qui attendent dans la file, jamais les
// tâches du suivi multi-projets de l'Assistant (elles ont leur onglet Kanban).
//
// Historique : un correctif antérieur avait INSÉRÉ sous les missions un groupe
// « Suivi (n) — suivi seul, aucun agent ne travaille dessus », alimenté par
// `get_super_agent_kanban`. Le propriétaire y voyait défiler ses tâches internes,
// anciennes et terminées : c'était une régression. Le groupe a donc été RETIRÉ
// du volet. Le module `taches-suivies-ecran.js` reste INTACT (aucune donnée, aucune
// fonctionnalité de suivi supprimée) et le Kanban continue de l'utiliser pour
// l'unique signal « le suivi a changé ».
//
// Ce que ces preuves interdisent désormais :
//   (i)  réinsérer le groupe « Suivi » dans le volet « Tâches » (appel, import de
//        rendu, état ou abonnement) — le test ÉCHOUE ;
//   (ii) remplacer les missions par le suivi quand le volet est vide : la seule
//        chose affichée est « Aucune mission en cours. » ;
//   (iii) casser la règle unique « ouverte ou close » du suivi, sa mémoire courte
//        ou son signal (le Kanban en dépend toujours).
//
// Les verrous de source lisent le fichier (fins de ligne normalisées — piège CI
// Windows, cf. quality-gate § 3.4).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

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
import { renderMissionsPanelHtml } from "./agent-activity.js";

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

/** Missions d'agents telles que le volet les reçoit (`buildRunningMissions`). */
const MISSIONS = [
  { agent: "codeur-1", project: "Pilot", mission: "Verifier le volet", waiting: false },
  { agent: "Assistant", project: "IA_PL", mission: "Faire le point", waiting: true },
];

describe("verrou — le volet « Tâches » ne compose QUE les missions d'agents", () => {
  it("le volet peint les missions, et RIEN d'autre (une seule expression)", () => {
    const src = lire("super-agent.js");
    // La composition réelle du volet : `renderMissionsPanelHtml(missions)`, seule.
    expect(src).toContain("superTasksList.innerHTML = renderMissionsPanelHtml(missions);");
    // Aucun ajout après les missions (c'est là que le groupe de suivi était
    // concaténé : `renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml()`).
    expect(src).not.toContain("renderMissionsPanelHtml(missions) +");
  });

  it("AUCUNE trace du groupe de suivi dans l'écran du volet (appel, état, abonnement)", () => {
    const src = lire("super-agent.js");
    for (const interdit of [
      "renderTrackedTasksGroupHtml",
      "renderSuperTrackedTasksHtml",
      "refreshSuperTrackedTasks",
      "loadTrackedTasks",
      "onTrackedTasksChanged",
      "superTrackedTasks",
      "superTrackedHtml",
      "superTrackedUnsub",
      // la phrase du groupe : si elle réapparaît dans l'écran, le groupe est revenu
      "aucun agent ne travaille dessus",
    ]) {
      expect(src, `« ${interdit} » est revenu dans le volet « Tâches »`).not.toContain(interdit);
    }
  });

  it("le module de suivi reste INTACT (aucune donnée, aucune fonction retirée)", () => {
    // Le retrait est celui de l'INSERTION à l'écran, pas du module : la règle
    // « ouverte ou close » et le rendu du groupe existent toujours.
    expect(openTrackedTasks(BASE).map((t) => t.id)).toEqual([1, 2, 7, 8]);
    const groupe = renderTrackedTasksGroupHtml(openTrackedTasks(BASE));
    expect(groupe).toContain(`${TACHES_SUIVIES_GROUP_LABEL} (4)`);
    expect(groupe).toContain("Écrire le rapport");
    expect(groupe).toContain("aucun agent ne travaille dessus");
  });

  it("une tâche du suivi n'apparaît JAMAIS dans le HTML du volet, même ouverte", () => {
    // Composition identique à celle de `renderSuperMissions` (missions seules).
    const volet = renderMissionsPanelHtml(MISSIONS);
    // les missions, elles, sont bien là (avec leur rang)
    expect(volet).toContain("En cours (1)");
    expect(volet).toContain("Verifier le volet");
    expect(volet).toContain("En attente (1)");
    // et AUCUNE tâche du suivi n'y figure — alors que le groupe, s'il était
    // concaténé, les afficherait (preuve que l'absence est bien un choix).
    const groupe = renderTrackedTasksGroupHtml(openTrackedTasks(BASE));
    for (const titre of ["Écrire le rapport", "Corriger la file", "En validation", "Autre projet"]) {
      expect(groupe).toContain(titre);
      expect(volet).not.toContain(titre);
    }
    // ni l'en-tête du groupe, ni sa mention rassurante
    expect(volet).not.toContain(TACHES_SUIVIES_GROUP_LABEL);
    expect(volet).not.toContain("aucun agent ne travaille dessus");
    expect(volet).not.toContain("data-task-id");
  });

  it("sans aucune mission, le volet dit « Aucune mission en cours. » (jamais le suivi en remplacement)", () => {
    const volet = renderMissionsPanelHtml([]);
    expect(volet).toContain("Aucune mission en cours.");
    // jamais une liste vide muette
    expect(volet.trim()).not.toBe("");
    // et surtout jamais les tâches du suivi pour « remplir »
    expect(volet).not.toContain("Écrire le rapport");
    expect(volet).not.toContain(TACHES_SUIVIES_GROUP_LABEL);
  });

  it("le compteur « Travail » continue de compter les missions (jamais les tâches du suivi)", () => {
    const src = lire("super-agent.js");
    // une seule source de calcul pour le bouton et le volet
    expect(src).toContain("buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions())");
    expect(src).not.toContain('invoke("get_super_agent_kanban")');
    expect(src).not.toContain("TACHES_SUIVIES_MAX");
  });
});

describe("le suivi garde son écran (Kanban) : le signal reste branché", () => {
  it("l'Assistant signale la fin de son tour, le Kanban signale ses écritures et écoute", () => {
    const superSrc = lire("super-agent.js");
    expect(superSrc).toContain("from \"./taches-suivies-ecran.js\"");
    expect(superSrc).toContain("notifyTrackedTasksChanged();");

    const kanbanSrc = lire("super-agent-kanban-view.js");
    expect(kanbanSrc).toContain("from \"./taches-suivies-ecran.js\"");
    expect(kanbanSrc).toContain("function reloadAfterTrackingWrite()");
    expect(kanbanSrc).toContain("notifyTrackedTasksChanged();");
    expect(kanbanSrc).toContain("onTrackedTasksChanged(() =>");
    // TOUTES les écritures passent par le même point (aucune n'oublie le signal) :
    // plus aucun `loadSuperKanban()` sec après une écriture.
    expect(kanbanSrc.split("reloadAfterTrackingWrite();").length - 1).toBe(5);
    expect(kanbanSrc.split("loadSuperKanban();").length - 1).toBe(3);
    // et l'abonnement est retiré avec l'onglet
    expect(kanbanSrc).toContain("unlistenTracking();");
  });
});

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

describe("renderTrackedTasksGroupHtml — le groupe du suivi (onglet Kanban)", () => {
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

describe("trackedTasksSignature", () => {
  it("change dès qu'un statut change (une suppression / un regroupement se voit)", () => {
    const a = openTrackedTasks(BASE);
    const b = a.map((t) => (t.id === 1 ? { ...t, status: "en_cours" } : t));
    expect(trackedTasksSignature(a)).not.toBe(trackedTasksSignature(b));
    expect(trackedTasksSignature(a)).toBe(trackedTasksSignature(openTrackedTasks(BASE)));
  });
});
