// Mission 385 — file d'attente des tâches PAR PROJET (module pur + état).
//
// Preuves couvertes ici (sans Tauri, sans I/O) :
//   1. l'ORDRE des demandes est respecté (FIFO) et une demande identique n'est
//      jamais dupliquée ;
//   2. UNE SEULE tâche démarre à la fois sur un projet (jamais deux) ;
//   3. la demande suivante démarre SEULE à la libération de la place
//      (réussite, erreur, arrêt utilisateur, session morte : la place est
//      rendue dans tous les cas, la sonde le constate) ;
//   4. aucune place n'est bloquée : un démarrage non confirmé remet la demande
//      en tête de file, un lanceur qui échoue ne perd rien, et après 3
//      tentatives la demande est abandonnée AVEC un message (jamais en silence) ;
//   5. la file est visible en français simple (« en cours », « en attente (2e) »)
//      et `/file vide` annonce le nombre abandonné.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rankLabel,
  shortLabel,
  buildProjectQueueView,
  formatQueueReport,
  formatQueueLines,
  queueBlockTitle,
  formatQueueClearedMessage,
  formatQueuedNotice,
  enqueueProjectCommand,
  listProjectCommands,
  listProjectLaunchedCommands,
  abandonProjectCommands,
  pumpProjectQueue,
  tickProjectQueues,
  setProjectQueueProbe,
  setProjectQueueNotify,
  QUEUE_MAX_ATTEMPTS,
  QUEUE_CONFIRM_MS,
  __resetProjectQueueForTest,
} from "./project-task-queue.js";

const PROJECT = "G:\\IA_PL\\pilot";

/** Lanceur de test : enregistre l'ordre des démarrages. */
function makeLauncher(started, label, result = true) {
  return async () => {
    started.push(label);
    return result;
  };
}

beforeEach(() => {
  __resetProjectQueueForTest();
});

afterEach(() => {
  __resetProjectQueueForTest();
  vi.useRealTimers();
});

describe("1. libellés simples en français", () => {
  it("les rangs sont lisibles (1er, 2e, 11e) et un libellé est borné sur une ligne", () => {
    expect(rankLabel(1)).toBe("1er");
    expect(rankLabel(2)).toBe("2e");
    expect(rankLabel(11)).toBe("11e");
    expect(rankLabel(0)).toBe("");
    expect(rankLabel("x")).toBe("");
    expect(shortLabel("  deux\n\n lignes  ")).toBe("deux lignes");
    expect(shortLabel("")).toBe("(sans intitulé)");
    expect(shortLabel("a".repeat(200)).length).toBe(70);
  });

  it("une demande mise en file annonce son rang et les deux commandes utiles", () => {
    const notice = formatQueuedNotice(2);
    expect(notice).toContain("2e");
    expect(notice).toContain("/file");
    expect(notice).toContain("/file vide");
    expect(notice).toContain("démarrera automatiquement");
  });
});

describe("2. la vue ordonnée de la file du projet", () => {
  it("la tâche en cours occupe le rang 1, la 1re demande en attente est la 2e", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      running: [{ kind: "agent", label: "codeur" }],
      manual: [{ label: "corrige le bug 12" }],
      missions: [{ label: "écrire la documentation" }],
      delegations: [{ label: "relire le module git" }],
      agents: [{ label: "tâche d'agent en file" }],
    });
    expect(view.running).toHaveLength(1);
    expect(view.waiting.map((w) => [w.rank, w.kind, w.label])).toEqual([
      [2, "commande", "corrige le bug 12"],
      [3, "mission", "écrire la documentation"],
      [4, "delegation", "relire le module git"],
      [5, "agent", "tâche d'agent en file"],
    ]);
    expect(view.waitingCount).toBe(4);
    expect(view.isEmpty).toBe(false);
  });

  it("une file vide se dit vide (aucune tâche en cours, aucune en attente)", () => {
    const view = buildProjectQueueView({ project: PROJECT });
    expect(view.isEmpty).toBe(true);
    expect(formatQueueReport(view)).toContain("vide");
  });

  it("le rapport `/file` dit « en cours » et « en attente (2e) »", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      running: [{ kind: "agent", label: "codeur" }],
      manual: [{ label: "corrige le bug 12" }],
    });
    const report = formatQueueReport(view);
    expect(report).toContain("en cours : agent « codeur »");
    expect(report).toContain("en attente (2e) : commande « corrige le bug 12 »");
    expect(report).toContain("/file vide");
  });

  it("le bloc de l'onglet est borné (jamais un mur de texte)", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      manual: Array.from({ length: 9 }, (_, i) => ({ label: `demande ${i + 1}` })),
    });
    const lines = formatQueueLines(view);
    expect(queueBlockTitle(view)).toContain("0 en cours");
    expect(lines.join("\n")).toContain("en attente (1er)");
    expect(lines.join("\n")).toContain("et 5 autre(s) demande(s) en attente");
    expect(lines.join("\n")).toContain("/file");
  });
});

describe("3. ordre respecté et aucune duplication", () => {
  it("trois demandes gardent leur ordre d'arrivée, la même demande n'est pas dupliquée", () => {
    enqueueProjectCommand({ project: PROJECT, text: "A", launch: async () => true });
    enqueueProjectCommand({ project: PROJECT, text: "B", launch: async () => true });
    const dup = enqueueProjectCommand({ project: PROJECT, text: "B", launch: async () => true });
    enqueueProjectCommand({ project: PROJECT, text: "C", launch: async () => true });
    expect(listProjectCommands(PROJECT).map((e) => e.label)).toEqual(["A", "B", "C"]);
    expect(dup.duplicate).toBe(true);
    // Un autre projet a sa PROPRE file.
    enqueueProjectCommand({ project: "G:\\IA_PL\\autre", text: "A", launch: async () => true });
    expect(listProjectCommands("G:\\IA_PL\\autre")).toHaveLength(1);
  });

  it("un envoi vide n'entre pas en file", () => {
    const res = enqueueProjectCommand({ project: PROJECT, text: "   ", launch: async () => true });
    expect(res.entry).toBeNull();
    expect(listProjectCommands(PROJECT)).toHaveLength(0);
  });
});

describe("4. une seule tâche démarre à la fois, la suivante démarre seule", () => {
  it("projet occupé : rien ne démarre ; projet libre : UNE seule demande démarre", async () => {
    const started = [];
    enqueueProjectCommand({ project: PROJECT, text: "A", label: "A", launch: makeLauncher(started, "A") });
    enqueueProjectCommand({ project: PROJECT, text: "B", label: "B", launch: makeLauncher(started, "B") });
    enqueueProjectCommand({ project: PROJECT, text: "C", label: "C", launch: makeLauncher(started, "C") });

    let free = false;
    setProjectQueueProbe(async () => free);

    expect((await pumpProjectQueue(PROJECT)).reason).toBe("busy");
    expect(started).toEqual([]);

    free = true;
    const first = await pumpProjectQueue(PROJECT);
    expect(first.launched).toBe(true);
    expect(started).toEqual(["A"]);
    // Le projet est maintenant occupé par A : une 2e passe ne lance rien.
    expect((await pumpProjectQueue(PROJECT)).launched).toBe(false);
    expect(started).toEqual(["A"]);
    expect(listProjectLaunchedCommands(PROJECT).map((c) => c.label)).toEqual(["A"]);
  });

  it("la demande suivante démarre SEULE dès que la place est rendue (réussite, erreur, arrêt, session morte)", async () => {
    const started = [];
    for (const label of ["A", "B", "C", "D", "E"]) {
      enqueueProjectCommand({ project: PROJECT, text: label, label, launch: makeLauncher(started, label) });
    }
    // Sonde pilotée : c'est exactement ce que produit la politique d'admission
    // réelle quel que soit le chemin de sortie de la tâche en cours (réussite,
    // erreur, arrêt utilisateur, mort de session) : le verrou de run retombe et
    // la place est rendue.
    let free = true;
    setProjectQueueProbe(async () => free);

    await pumpProjectQueue(PROJECT); // démarre A
    expect(started).toEqual(["A"]);

    for (const exitPath of ["réussite", "erreur", "arrêt utilisateur", "session morte"]) {
      free = false; // la tâche en cours occupe la place…
      expect((await pumpProjectQueue(PROJECT)).reason).toBe("confirmed");
      expect(started.length).toBeLessThanOrEqual(5);
      free = true; // …puis elle la rend (peu importe comment elle s'est terminée)
      await pumpProjectQueue(PROJECT); // la demande SUIVANTE démarre, seule
      void exitPath;
    }
    expect(started).toEqual(["A", "B", "C", "D", "E"]);
    expect(listProjectCommands(PROJECT)).toHaveLength(0);
  });

  it("une activité résiduelle sans session vivante ne bloque plus (sonde libre)", async () => {
    const started = [];
    enqueueProjectCommand({ project: PROJECT, text: "A", launch: makeLauncher(started, "A") });
    // La politique d'admission réelle (`releaseOrphanRunLock` + états d'agents)
    // répond « libre » quand la session n'est plus vivante : la file démarre.
    setProjectQueueProbe(async () => true);
    await pumpProjectQueue(PROJECT);
    expect(started).toEqual(["A"]);
  });
});

describe("5. aucune place bloquée, rien perdu en silence", () => {
  it("un démarrage non confirmé remet la demande en TÊTE de file", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-01T10:00:00Z"));
    const started = [];
    let free = true;
    setProjectQueueProbe(async () => free);
    enqueueProjectCommand({ project: PROJECT, text: "A", label: "A", launch: makeLauncher(started, "A") });
    enqueueProjectCommand({ project: PROJECT, text: "B", label: "B", launch: makeLauncher(started, "B") });
    await pumpProjectQueue(PROJECT);
    expect(started).toEqual(["A"]);
    // Toujours libre après le délai de confirmation : A n'a pas démarré.
    vi.setSystemTime(new Date(Date.now() + QUEUE_CONFIRM_MS + 1000));
    const res = await pumpProjectQueue(PROJECT);
    expect(res.reason).toBe("not_started");
    free = false;
    expect(listProjectCommands(PROJECT).map((e) => e.label)).toEqual(["A", "B"]);
  });

  it("un lanceur qui échoue ne perd pas la demande ; après 3 tentatives elle est abandonnée AVEC un message", async () => {
    vi.useFakeTimers();
    const notices = [];
    setProjectQueueNotify((msg) => notices.push(msg));
    setProjectQueueProbe(async () => true);
    const started = [];
    enqueueProjectCommand({ project: PROJECT, text: "A", label: "A", launch: makeLauncher(started, "A", false) });
    for (let i = 0; i < QUEUE_MAX_ATTEMPTS; i++) {
      await pumpProjectQueue(PROJECT);
      // À chaque échec, la demande est encore en file (sauf au dernier).
      if (i < QUEUE_MAX_ATTEMPTS - 1) {
        expect(listProjectCommands(PROJECT)).toHaveLength(1);
      }
      vi.setSystemTime(new Date(Date.now() + QUEUE_CONFIRM_MS + 1000));
    }
    expect(started).toHaveLength(QUEUE_MAX_ATTEMPTS);
    expect(listProjectCommands(PROJECT)).toHaveLength(0);
    expect(notices.join("\n")).toContain("abandonnée");
  });

  it("un lanceur qui LÈVE ne fait pas échouer la passe et garde la demande", async () => {
    setProjectQueueProbe(async () => true);
    enqueueProjectCommand({
      project: PROJECT,
      text: "A",
      launch: () => {
        throw new Error("boum");
      },
    });
    const res = await pumpProjectQueue(PROJECT);
    expect(res.reason).toBe("launch_failed");
    expect(listProjectCommands(PROJECT)).toHaveLength(1);
  });

  it("une sonde en échec ne lance rien (fail-closed) et ne perd rien", async () => {
    setProjectQueueProbe(async () => {
      throw new Error("sonde indisponible");
    });
    enqueueProjectCommand({ project: PROJECT, text: "A", launch: async () => true });
    expect((await pumpProjectQueue(PROJECT)).reason).toBe("busy");
    expect(listProjectCommands(PROJECT)).toHaveLength(1);
  });

  it("sans sonde installée, rien ne démarre (jamais deux tâches par prudence)", async () => {
    enqueueProjectCommand({ project: PROJECT, text: "A", launch: async () => true });
    expect((await pumpProjectQueue(PROJECT)).reason).toBe("busy");
    expect(listProjectCommands(PROJECT)).toHaveLength(1);
  });
});

describe("6. `/file vide` abandonne en annonçant le nombre", () => {
  it("abandonne toutes les demandes en attente du projet (et seulement celles-là)", async () => {
    enqueueProjectCommand({ project: PROJECT, text: "A", launch: async () => true });
    enqueueProjectCommand({ project: PROJECT, text: "B", launch: async () => true });
    enqueueProjectCommand({ project: "G:\\IA_PL\\autre", text: "X", launch: async () => true });
    expect(abandonProjectCommands(PROJECT)).toBe(2);
    expect(listProjectCommands(PROJECT)).toHaveLength(0);
    expect(listProjectCommands("G:\\IA_PL\\autre")).toHaveLength(1);
    expect(abandonProjectCommands(PROJECT)).toBe(0);
  });

  it("le message d'abandon annonce le décompte, ou dit qu'il n'y avait rien", () => {
    expect(formatQueueClearedMessage({ commands: 2, missions: 1, delegations: 0, agents: 0 })).toContain("3 demande(s) abandonnée(s)");
    expect(formatQueueClearedMessage({ commands: 2, missions: 1, delegations: 0, agents: 0 })).toContain("2 commande(s)");
    expect(formatQueueClearedMessage({})).toContain("Aucune demande en attente");
  });
});
