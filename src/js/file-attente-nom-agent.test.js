// FILE D'ATTENTE — « quelle demande en attente sera traitee par QUEL agent ? »
//
// Constat du proprietaire : devant la file d'un projet, une demande en attente
// ne disait pas quel agent allait la traiter. Le repere de mission existait deja
// (numero + agents vises), mais il n'etait pas MONTRÉ.
//
// Ces preuves ECHOUENT si la regle casse :
//   a. le nom de l'agent DISPARAIT de l'affichage d'une demande en attente
//      (rapport `/file` ET bloc discret de l'onglet agent) ;
//   b. un nom VIDE est affiche la ou l'agent est inconnu (la file doit dire
//      « agent non defini », jamais laisser un blanc) ;
//   c. un nom est INVENTE (aucun agent dans la demande -> aucun nom) ;
//   d. l'affichage de la tache EN COURS change de sens (elle garde le sien) ;
//   e. l'ordre de la file, les rangs et le nombre de missions changent.
//
// Aucun acces Tauri : les fonctions pures de composition et d'affichage sont
// exercees directement (le cablage reel est prouve par
// `project-queue-wiring.test.js`).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AGENT_UNKNOWN_LABEL,
  buildProjectQueueView,
  formatQueueLines,
  formatQueueReport,
  queueAgentIds,
  queueAgentLabel,
  enqueueProjectCommand,
  listProjectCommands,
  __resetProjectQueueForTest,
} from "./project-task-queue.js";

const PROJECT = "G:\\IA_PL\\pilot";

/** Vue de reference : une demande de CHAQUE famille, chacune avec son agent. */
function viewWithAgents() {
  return buildProjectQueueView({
    project: PROJECT,
    running: [{ kind: "agent", label: "codeur" }],
    manual: [{ label: "corrige le bug 12", agentId: "codeur" }],
    missions: [{ label: "écrire la documentation", agentIds: ["documenteur"] }],
    delegations: [{ label: "relire le module git", agentId: "reviewer" }],
    agents: [{ label: "tâche d'agent en file", agentId: "testeur" }],
  });
}

/** Ligne du rapport `/file` correspondant a un libelle de demande. */
function reportLine(report, label) {
  return report.split("\n").find((line) => line.includes(label)) || "";
}

beforeEach(() => {
  __resetProjectQueueForTest();
});

afterEach(() => {
  __resetProjectQueueForTest();
});

// ── a. Le nom de l'agent est la, pour CHAQUE famille de demande ───────────
describe("a. chaque demande en attente dit quel agent la traite", () => {
  it("le rapport `/file` nomme l'agent de chaque demande en attente", () => {
    const report = formatQueueReport(viewWithAgents());

    expect(reportLine(report, "corrige le bug 12"), "agent absent de la commande en attente").toContain("agent : codeur");
    expect(reportLine(report, "écrire la documentation"), "agent absent de la mission en attente").toContain(
      "agent : documenteur",
    );
    expect(reportLine(report, "relire le module git"), "agent absent de la delegation en attente").toContain(
      "agent : reviewer",
    );
    expect(reportLine(report, "tâche d'agent en file"), "agent absent de la demande d'agent").toContain(
      "agent : testeur",
    );
  });

  it("le bloc discret de l'onglet agent nomme lui aussi l'agent (meme point d'affichage)", () => {
    const lines = formatQueueLines(viewWithAgents()).join("\n");
    expect(lines).toContain("agent : codeur");
    expect(lines).toContain("agent : documenteur");
    expect(lines).toContain("agent : reviewer");
    expect(lines).toContain("agent : testeur");
  });

  it("le nom vient de la DEMANDE mise en file, pas d'une table de secours", () => {
    // Une commande manuelle reelle porte son agent des la mise en file.
    enqueueProjectCommand({ project: PROJECT, text: "corrige le bug 12", agentId: "codeur", launch: async () => true });
    const view = buildProjectQueueView({ project: PROJECT, manual: listProjectCommands(PROJECT) });
    expect(view.waiting).toHaveLength(1);
    expect(view.waiting[0].agentIds).toEqual(["codeur"]);
    expect(formatQueueReport(view)).toContain("agent : codeur");
  });

  it("plusieurs agents vises sont tous nommes, dans l'ordre de la demande", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      missions: [{ label: "mission a deux agents", agentIds: ["codeur", "testeur"] }],
    });
    expect(formatQueueReport(view)).toContain("agent : codeur, testeur");
  });
});

// ── b. Jamais de nom VIDE la ou l'agent est inconnu ───────────────────────
describe("b. un agent inconnu est DIT, jamais laisse vide", () => {
  it("sans agent dans la demande, le libelle est « agent non defini »", () => {
    expect(AGENT_UNKNOWN_LABEL).toBe("agent non défini");
    expect(queueAgentLabel({})).toBe(AGENT_UNKNOWN_LABEL);
    expect(queueAgentLabel({ agentId: "" })).toBe(AGENT_UNKNOWN_LABEL);
    expect(queueAgentLabel({ agentIds: [] })).toBe(AGENT_UNKNOWN_LABEL);
    expect(queueAgentLabel(null)).toBe(AGENT_UNKNOWN_LABEL);
  });

  it("aucune ligne de demande en attente n'affiche « agent : » suivi de rien", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      manual: [{ label: "demande sans agent" }],
      missions: [{ label: "mission sans agent" }],
      delegations: [{ label: "delegation sans agent" }],
      agents: [{ label: "agent sans identifiant" }],
    });
    const lines = formatQueueLines(view).concat(formatQueueReport(view).split("\n"));
    const waitingLines = lines.filter((line) => line.startsWith("- en attente ("));
    expect(waitingLines).toHaveLength(8); // 4 demandes x (bloc de l'onglet + rapport `/file`)
    for (const line of waitingLines) {
      const after = line.split("agent : ")[1];
      expect(after, `nom d'agent vide : ${line}`).toBeTruthy();
      expect((after || "").trim(), `nom d'agent vide : ${line}`).not.toBe("");
      expect(line, `l'inconnu doit etre dit : ${line}`).toContain(AGENT_UNKNOWN_LABEL);
    }
  });
});

// ── c. Aucun nom invente ──────────────────────────────────────────────────
describe("c. aucun nom d'agent n'est invente", () => {
  it("seuls les agents reellement portes par la demande sont nommes", () => {
    expect(queueAgentIds({ agentIds: ["codeur", "", "codeur"], agentId: "reviewer" })).toEqual(["codeur", "reviewer"]);
    expect(queueAgentIds({ label: "une demande sans agent" })).toEqual([]);
    expect(queueAgentIds("une demande sous forme de texte")).toEqual([]);
    expect(queueAgentLabel({ agentIds: ["codeur"] })).toBe("codeur");
  });
});

// ── d. La tache EN COURS garde son affichage ──────────────────────────────
describe("d. la tache en cours garde son affichage (sens inchange)", () => {
  it("la ligne « en cours » ne recoit pas de suffixe d'agent", () => {
    const report = formatQueueReport(viewWithAgents());
    const runningLine = report.split("\n").find((line) => line.includes("en cours : agent « codeur »")) || "";
    expect(runningLine, "la ligne de la tache en cours a disparu").not.toBe("");
    expect(runningLine.toLowerCase()).not.toContain("agent :");
  });

  it("le bloc de l'onglet garde lui aussi la ligne « en cours » telle quelle", () => {
    const lines = formatQueueLines(viewWithAgents());
    expect(lines).toContain("- en cours : agent « codeur »");
  });
});

// ── e. Ordre, rangs et nombre de demandes inchanges ───────────────────────
describe("e. l'ordre, les rangs et le nombre de demandes sont inchanges", () => {
  it("les rangs restent 2, 3, 4, 5 et l'ordre des familles est le meme", () => {
    const view = viewWithAgents();
    expect(view.waiting.map((w) => [w.rank, w.kind, w.label])).toEqual([
      [2, "commande", "corrige le bug 12"],
      [3, "mission", "écrire la documentation"],
      [4, "delegation", "relire le module git"],
      [5, "agent", "tâche d'agent en file"],
    ]);
    expect(view.waitingCount).toBe(4);
    // Chaque demande garde son agent apres la mise en forme (aucun decalage).
    expect(view.waiting.map((w) => w.agentIds)).toEqual([["codeur"], ["documenteur"], ["reviewer"], ["testeur"]]);
  });

  it("sans tache en cours, la premiere demande en attente reste au rang 1", () => {
    const view = buildProjectQueueView({
      project: PROJECT,
      manual: [{ label: "corrige le bug 12", agentId: "codeur" }],
    });
    expect(view.waiting.map((w) => w.rank)).toEqual([1]);
    expect(formatQueueReport(view)).toContain("en attente (1er) : commande « corrige le bug 12 » · agent : codeur");
  });

  it("la file vide reste vide et le dit", () => {
    const view = buildProjectQueueView({ project: PROJECT });
    expect(view.isEmpty).toBe(true);
    expect(formatQueueReport(view)).toContain("vide");
    expect(formatQueueLines(view).join("\n")).not.toContain("agent :");
  });
});
