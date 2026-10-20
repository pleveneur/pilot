// RÈGLE 4 — « une demande mise en file ne disparaît JAMAIS en silence ».
//
// L'audit indépendant a montré un verrou FRAGILE : la file d'attente
// d'exclusivité était parcourue à travers `busState.runs` (les runs VIVANTES).
// Dès qu'une run mourait, ses demandes conservées devenaient INVISIBLES : plus
// listées (`listProjectExclusivityEntries`), donc plus jamais relancées ni
// abandonnées explicitement — et `clearAllRuns` les vidait sans autre trace
// qu'un `console.warn`.
//
// Correctif verrouillé ici :
//   • la file MODULE (`projectExclusivityQueues`) est la SOURCE DE VÉRITÉ :
//     lecture et abandon l'itèrent, même sans run vivante ;
//   • une entrée dont plus aucune run ne porte la clé est exposée comme
//     `orphan: true` (visible, donc relançable ou abandonnable) ;
//   • tout abandon journalise (`<projet>/.pilot/agent-stops.log`,
//     `reason=queue-abandoned`) et PRÉVIENT l'utilisateur (`notify`).
//
// Ces tests ÉCHOUENT si la lecture revient à « parcourir les runs vivantes »,
// si l'orphelin redevient invisible, ou si un vidage redevient muet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd) => (cmd === "file_exists" ? true : undefined)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import {
  beginRun,
  endRun,
  destroyAgentsBus,
  exclusivityQueueOfProject,
  listProjectExclusivityEntries,
  abandonProjectExclusivityQueues,
  initAgentsBus,
  stopAgentsRun,
} from "./agents-bus.js";
import { enqueueExclusivity } from "./exclusivity-queue.js";
import { agentStopTracePath } from "./agent-stop-trace.js";

const P = "C:\\p\\regle4-file";

/** Lignes du journal des arrêts effectivement écrites. */
function journalLines() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd, args]) => cmd === "write_file_content" && args && /agent-stops\.log$/.test(String(args.path)))
    .map(([, args]) => String(args.content || ""));
}
const lastJournal = () => {
  const lines = journalLines();
  return lines.length ? lines[lines.length - 1] : "";
};

/** Laisse la chaîne asynchrone du journal (fire-and-forget) se terminer. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Met une demande dans la file du projet (clé project\u001fagent). */
function queueRequest(project, agentId, brief, runKey = "") {
  const queue = exclusivityQueueOfProject(project);
  enqueueExclusivity(queue, agentId, project, { agentId, brief, project, runKey });
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  // `read_file_content` sert à relire le journal avant ajout : il doit rendre
  // une CHAÎNE (le journal peut déjà contenir des lignes).
  const ANSWERS = {
    read_file_content: "",
    list_agents: { agents: [] },
    get_config: {},
  };
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    Object.prototype.hasOwnProperty.call(ANSWERS, cmd) ? ANSWERS[cmd] : undefined,
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  destroyAgentsBus();
  endRun(P);
  vi.restoreAllMocks();
});

describe("règle 4 — la file survit à la mort de sa run (entrée ORPHELINE VISIBLE)", () => {
  it("une demande conservée est listée comme ORPHELINE quand plus aucune run ne la porte", () => {
    const ctx = beginRun(P);
    queueRequest(P, "codeur", "B : demande mise en file", ctx.runKey);

    // Tant que la run vit, l'entrée est portée par elle.
    const alive = listProjectExclusivityEntries(P);
    expect(alive).toHaveLength(1);
    expect(alive[0]).toMatchObject({ agentId: "codeur", label: "B : demande mise en file", orphan: false });
    expect(alive[0].runKey, "la clé de la run vivante doit être exposée").toBe(ctx.runKey);

    // La run meurt : la demande ne doit PAS devenir invisible.
    endRun(P, ctx.generation);
    const orphan = listProjectExclusivityEntries(P);
    expect(orphan, "la demande conservée a disparu de la lecture").toHaveLength(1);
    expect(orphan[0]).toMatchObject({ agentId: "codeur", label: "B : demande mise en file", orphan: true });
    expect(orphan[0].runKey, "une entrée orpheline n'a plus de run porteuse").toBe("");
  });

  it("la lecture itère la file MODULE même sans AUCUNE run vivante (jamais `busState.runs`)", () => {
    // Aucune run n'a été créée : la file existe au niveau module.
    queueRequest(P, "lecteur", "demande orpheline native");
    const entries = listProjectExclusivityEntries(P);
    expect(entries).toHaveLength(1);
    expect(entries[0].orphan).toBe(true);
  });

  it("plusieurs demandes (deux spécialités) restent toutes visibles après la mort de la run", () => {
    const ctx = beginRun(P);
    queueRequest(P, "codeur", "A", ctx.runKey);
    queueRequest(P, "testeur", "B", ctx.runKey);
    endRun(P, ctx.generation);
    const entries = listProjectExclusivityEntries(P);
    expect(entries.map((e) => e.label).sort()).toEqual(["A", "B"]);
    expect(entries.every((e) => e.orphan)).toBe(true);
  });
});

describe("règle 4 — l'abandon explicite emporte les ORPHELINES et le DIT", () => {
  it("`abandonProjectExclusivityQueues` vide les entrées orphelines et journalise", async () => {
    queueRequest(P, "codeur", "demande orpheline à abandonner");
    const removed = abandonProjectExclusivityQueues(P);
    expect(removed, "l'entrée orpheline doit être abandonnable").toBe(1);
    expect(listProjectExclusivityEntries(P), "la file doit être réellement vidée").toEqual([]);
    await flush();
    const journal = lastJournal();
    expect(journal).toContain("reason=queue-abandoned");
    expect(journal).toContain("detected=user-abandon");
    expect(journal).toContain("demande orpheline à abandonner");
  });

  it("l'abandon d'orphelines PRÉVIENT l'utilisateur (notify), jamais un silence", async () => {
    const notified = [];
    await initAgentsBus({ notify: (data) => notified.push(data) });
    queueRequest(P, "codeur", "demande orpheline annoncée");
    abandonProjectExclusivityQueues(P);
    await flush();
    expect(notified, "l'abandon d'une demande en file doit être annoncé").toHaveLength(1);
    expect(String(notified[0].message)).toContain("demande orpheline annoncée");
  });

  it("`journal: false` n'écrit rien (l'appelant a déjà informé) mais l'abandon a bien lieu", () => {
    queueRequest(P, "codeur", "silence demandé");
    const removed = abandonProjectExclusivityQueues(P, { journal: false });
    expect(removed).toBe(1);
    expect(lastJournal()).toBe("");
  });
});

describe("règle 4 — « tout arrêter » ne vide plus une file en silence", () => {
  it("`stopAgentsRun` global journalise les demandes perdues (reason=queue-abandoned)", async () => {
    await initAgentsBus({});
    const ctx = beginRun(P);
    ctx.runState = "running"; // portée globale : la run doit être « running »
    queueRequest(P, "codeur", "mission perdue par tout-arrêter", ctx.runKey);
    vi.mocked(invoke).mockClear();

    await stopAgentsRun();
    await flush();

    const journal = lastJournal();
    expect(journal, "un vidage global de file est resté muet").toContain("reason=queue-abandoned");
    expect(journal).toContain("detected=clear-all-runs");
    expect(journal).toContain("mission perdue par tout-arrêter");
  });

  it("le vidage global écrit dans le journal DU PROJET concerné", async () => {
    await initAgentsBus({});
    const ctx = beginRun(P);
    ctx.runState = "running";
    queueRequest(P, "codeur", "mission du projet P", ctx.runKey);
    vi.mocked(invoke).mockClear();

    await stopAgentsRun();
    await flush();

    const written = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file_content")
      .map(([, args]) => String(args.path));
    expect(written).toContain(agentStopTracePath(P));
  });
});
