// RÈGLE 4 — « une demande mise en file est TOUJOURS rejouée avec SA PROPRE
// demande, jamais perdue en silence ».
//
// Trois preuves, chacune ÉCHOUE si le correctif est retiré :
//   a. IDENTITÉ de bout en bout : deux missions (A = `codeur`, B = `testeur`)
//      mises en file pour le MÊME projet ; le rejeu de la tête exécute le brief
//      de A puis celui de B, et le compte rendu livré porte l'identité de la
//      demande rejouée (un rapport de A ne peut pas être attribué à B).
//   b. SURVIE de la file d'exclusivité : une demande mise en file au niveau du
//      BUS (dispatch parallèle, agent déjà actif sur le projet) n'est pas
//      perdue quand la run propriétaire se termine SANS `agent_end` ; elle est
//      soit rejouée avec son brief et son contexte propriétaire, soit CONSERVÉE
//      et journalisée — jamais exécutée dans un contexte étranger.
//   c. WATCHDOG : une run jugée morte avec 2 missions en file → l'abandon est
//      JOURNALISÉ avec les libellés des missions (jamais `queue.length = 0`
//      muet).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `project-queue-wiring.test.js` / `verrou-par-projet.test.js`
// (aucun DOM, aucun accès Tauri réel).
vi.hoisted(() => {
  const noop = () => {};
  const el = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    getAttribute: () => null,
    focus: noop,
    scrollIntoView: noop,
    insertAdjacentHTML: noop,
    innerHTML: "",
    textContent: "",
    value: "",
  });
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: el,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: el(),
    documentElement: el(),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  beginRun,
  endRun,
  initAgentsBus,
  startParallelRun,
  launchNextQueuedForProject,
  exclusivityQueueOfProject,
} from "./agents-bus.js";
import {
  runAgentsQueueByProject,
  replayQueuedMissionForProject,
  abandonQueuedRunAgentsMissions,
  enqueueMissionForProject,
  injectRunAgentsResultToSuperAgent,
  __superAgentQueueStateForTest,
} from "./super-agent.js";
import {
  nextMissionId,
  makeMissionIdentity,
  stampQueuedMission,
  missionQueueLabel,
  __resetMissionIdsForTest,
} from "./mission-identity.js";

const root = new URL("../../", import.meta.url);
const source = (rel) => readFileSync(new URL(rel, root), "utf8").replace(/\r\n/g, "\n");
const superAgentSrc = source("src/js/super-agent.js");
const busSrc = source("src/js/agents-bus.js");

// Journal des arrêts automatiques : la dernière ligne ÉCRITE par l'application
// (invoke `write_file_content`), quel que soit le journal (projet ou global).
function journalLines() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd, args]) => cmd === "write_file_content" && args && args.path && /agent-stops\.log$/.test(args.path))
    .map(([, args]) => String(args.content || ""));
}
const lastJournal = () => {
  const lines = journalLines();
  return lines.length ? lines[lines.length - 1] : "";
};

/** Comptes rendus remis à l'assistant (invoke `inject_session_summary`). */
function deliveredSummaries() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "inject_session_summary")
    .map(([, args]) => String((args && args.summary) || ""));
}

/** Pousse une mission dans la file de l'assistant par le CHEMIN DE PRODUCTION
 * de l'outil `run_agents` (`enqueueMissionForProject`) : push + `label` +
 * estampille d'identité, exactement comme la production. */
function queueMission(target, task, agentIds, launch) {
  // RÈGLE 4 : mise en file par le CHEMIN DE PRODUCTION.
  // Neutraliser cette fonction (ou son estampille) rend les tests de ce fichier
  // ROUGES : la fixture ne peut plus simuler un mécanisme que la production
  // n'appliquerait plus.
  const identity = makeMissionIdentity(nextMissionId(), agentIds);
  enqueueMissionForProject(target, launch, task, identity);
  return identity;
}

beforeEach(() => {
  __resetMissionIdsForTest();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of Object.keys(runAgentsQueueByProject)) delete runAgentsQueueByProject[key];
});

// ── a. Identité de mission de bout en bout ─────────────────────────────────
describe("RÈGLE 4 (a) — la demande rejouée exécute SA demande et son rapport porte SON identité", () => {
  const PROJECT = "regle4-a-projet";

  it("A (codeur) puis B (testeur) : rejeu dans l'ordre, et le rapport de A reste celui de A", async () => {
    const executed = [];
    let reportA = null;
    let reportB = null;
    const idA = queueMission(PROJECT, "mission A : corriger le parseur", ["codeur"], async () => {
      const identity = makeMissionIdentity(idA.id, idA.agentIds);
      executed.push({ id: identity.id, agents: identity.agentIds.join(",") });
      reportA = identity;
      return { started: true };
    });
    const idB = queueMission(PROJECT, "mission B : écrire les tests", ["testeur"], async () => {
      const identity = makeMissionIdentity(idB.id, idB.agentIds);
      executed.push({ id: identity.id, agents: identity.agentIds.join(",") });
      reportB = identity;
      return { started: true };
    });

    // Les deux missions portent une identité DISTINCTE et les agents de LEUR demande.
    expect(idB.id).toBeGreaterThan(idA.id);
    expect(runAgentsQueueByProject[PROJECT].map((e) => [e.id, e.agentIds])).toEqual([
      [idA.id, ["codeur"]],
      [idB.id, ["testeur"]],
    ]);

    // Rejeu de la tête : le projet est admis (sonde injectée) → A part, puis B.
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({ replayed: true });
    expect(await replayQueuedMissionForProject(PROJECT, { isAdmissionFree: async () => true })).toMatchObject({ replayed: true });

    // Le brief exécuté est celui de la mission rejouée, dans l'ordre de la file.
    expect(executed).toEqual([
      { id: idA.id, agents: "codeur" },
      { id: idB.id, agents: "testeur" },
    ]);

    // Le compte rendu LIVRÉ à l'assistant porte l'identité de la mission rejouée.
    await injectRunAgentsResultToSuperAgent("[Codeur] parseur corrigé.", PROJECT, { remember: true, identity: reportA });
    await injectRunAgentsResultToSuperAgent("[Testeur] 12 tests ajoutés.", PROJECT, { remember: true, identity: reportB });
    const summaries = deliveredSummaries();
    expect(summaries).toHaveLength(2);
    // Le rapport de A annonce la mission de A et SES agents (codeur) — jamais
    // ceux de B : une attribution croisée devient impossible.
    expect(summaries[0]).toContain(`[mission #${idA.id} · agents : codeur]`);
    expect(summaries[0]).toContain("parseur corrigé");
    expect(summaries[0]).not.toContain(`#${idB.id}`);
    expect(summaries[1]).toContain(`[mission #${idB.id} · agents : testeur]`);
    expect(summaries[1]).not.toContain("codeur");
  });

  it("le double empilement de la MÊME demande est refusé (et signalé), jamais exécuté deux fois", () => {
    const seen = { launches: 0 };
    const identity = queueMission(PROJECT, "demande unique", ["codeur"], async () => {
      seen.launches += 1;
    });
    const queue = runAgentsQueueByProject[PROJECT];
    const duplicateEntry = { launch: async () => {} };
    queue.push(duplicateEntry);
    const res = stampQueuedMission(queue, duplicateEntry, identity);
    expect(res.duplicate).toBe(true);
    expect(queue).toHaveLength(1);
    expect(queue[0].label).toBe("demande unique");
  });

  it("les 3 chemins de mise en file de super-agent.js passent par le chemin de PRODUCTION unique", () => {
    // AVANT : le test comptait 3 blocs `push({ launch: … })` + `label` et 3
    // estampilles inline. CONTRAT MODIFIÉ (fermeture des faux verrous 2-3-4) :
    // l'identité de mission est désormais posée dans UNE seule fonction de
    // production (`enqueueMissionForProject`) appelée par les TROIS chemins. Le
    // test vérifie donc : 3 appels, aucun `push` direct qui contournerait
    // l'identité, et une estampille dans cette unique fonction.
    const sites = superAgentSrc.match(/enqueueMissionForProject[(]target,/g) || [];
    expect(sites, "un chemin de mise en file ne passe plus par enqueueMissionForProject").toHaveLength(3);
    expect(superAgentSrc, "un chemin pousse encore directement dans la file").not.toContain(
      "runAgentsQueueByProject[target].push(",
    );
    const stamps = superAgentSrc.match(/stampQueuedMission[(]/g) || [];
    expect(stamps, "l'identité de mission n'est plus allouée à un seul endroit").toHaveLength(1);
  });
});

// ── b. La file d'exclusivité survit à la fin de la run propriétaire ────────
describe("RÈGLE 4 (b) — la file ne meurt pas avec la run propriétaire", () => {
  const P = "regle4-b-projet";
  const qk = `${P}lecteur`;
  const runsOf = (p) => Object.values(globalThis.__agentBusState.runs).filter((c) => c.project === p);
  const flushAsync = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agents") {
        return {
          agents: [
            { id: "codeur", name: "Codeur", readonly: false, models: { pi: "openai/gpt-4o" }, keep_context: false },
            { id: "lecteur", name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false },
          ],
        };
      }
      if (cmd === "get_config") return {};
      if (cmd === "list_agent_sessions") return { sessions: [] };
      return undefined;
    });
    await initAgentsBus({});
  });

  afterEach(() => {
    for (const key of Object.keys(globalThis.__agentBusState.runs)) delete globalThis.__agentBusState.runs[key];
  });

  it("demande en file au niveau du BUS : conservée après la fin de la run (sans agent_end), puis JOURNALISÉE au rejeu sans propriétaire — jamais exécutée dans un contexte étranger", async () => {
    // Le codeur travaille déjà (run A propriétaire de l'agent sur ce projet).
    let busy = false;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agents") {
        return {
          agents: [
            { id: "codeur", name: "Codeur", readonly: false, models: { pi: "openai/gpt-4o" }, keep_context: false },
            { id: "lecteur", name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false },
          ],
        };
      }
      if (cmd === "get_config") return {};
      if (cmd === "list_agent_sessions") {
        return busy
          ? { sessions: [{ agent: "lecteur", project: P, mode: "agent_process", alive: true, busy: true, lastActivity: new Date().toISOString() }] }
          : { sessions: [] };
      }
      return undefined;
    });

    await startParallelRun([{ agentId: "lecteur", project: P, brief: "A : travail en cours" }], "", {});
    const runA = runsOf(P).find((c) => c.readonly && c.activeAgents && c.activeAgents.has("lecteur"));
    expect(runA).toBeTruthy();
    busy = true; // l'agent travaille → la demande suivante part en file d'exclusivité
    await startParallelRun([{ agentId: "lecteur", project: P, brief: "B : demande mise en file" }], "", {});
    const runB = runsOf(P).find((c) => c !== runA);
    expect(runB, "la run de la demande B doit exister").toBeTruthy();

    // La demande B est en file, avec la run qui l'a mise en file comme PROPRIÉTAIRE.
    console.log("DBG", JSON.stringify(Object.keys(exclusivityQueueOfProject(P))), JSON.stringify(exclusivityQueueOfProject(P)).slice(0,300));
    const queue = exclusivityQueueOfProject(P);
    expect(queue[qk] && queue[qk].length, "la demande B doit être en file").toBe(1);
    expect(queue[qk][0].ownerRunKey).toBe(runB.runKey);
    expect(queue[qk][0].brief).toBe("B : demande mise en file");

    // La run propriétaire se termine SANS aucun `agent_end` (cas 1/2 du rapport).
    endRun(P, runB.generation);
    await flushAsync();

    // 1) La demande n'a PAS disparu avec la run : la file vit au niveau du PROJET
    //    (la run propriétaire n'existe plus, l'entrée subsiste).
    expect(exclusivityQueueOfProject(P)[qk], "la demande doit SURVIVRE à la fin de sa run").toHaveLength(1);
    expect(exclusivityQueueOfProject(P)[qk][0].brief).toBe("B : demande mise en file");

    // 2) Le rejeu est tenté (watchdog) : le propriétaire n'existe plus → la
    //    demande est CONSERVÉE, le motif est journalisé, l'utilisateur est averti,
    //    et RIEN n'est exécuté dans un contexte étranger.
    runB.lastActivityAt = Date.now() - 5 * 60 * 1000;
    // Rejeu déclenché (c'est ce que fait le watchdog quand il constate que la
    // file n'a plus de porteur).
    await launchNextQueuedForProject("lecteur", P);
    await flushAsync();

    expect(exclusivityQueueOfProject(P)[qk], "la demande doit être CONSERVÉE (jamais perdue)").toHaveLength(1);
    const journal = lastJournal();
    expect(journal).toContain("reason=queue-replay-no-owner");
    expect(journal).toContain("agent=lecteur");
    expect(journal).toContain("B : demande mise en file");
    // Aucune run étrangère n'a démarré pour l'exécuter.
    expect(runsOf(P).some((c) => c !== runA && c.activeAgents && c.activeAgents.has("lecteur"))).toBe(false);
  });

  it("le contexte de run ne possède plus SA propre file : il partage celle du projet", () => {
    const ctx = beginRun(P, { readOnly: false });
    expect(ctx.exclusivityQueue).toBe(exclusivityQueueOfProject(P));
    endRun(P, ctx.generation);
    // Fin de run : la file du projet n'est pas détruite avec le contexte.
    expect(exclusivityQueueOfProject(P)).toBe(ctx.exclusivityQueue);
  });
});

// ── c. Watchdog : abandon explicite et JOURNALISÉ ──────────────────────────
describe("RÈGLE 4 (c) — le watchdog ne vide jamais une file en silence", () => {
  const PROJECT = "regle4-c-projet";

  it("2 missions en file abandonnées : libellés nommés, motif journalisé, file vidée", async () => {
    queueMission(PROJECT, "corriger le parseur", ["codeur"], async () => {});
    queueMission(PROJECT, "écrire les tests", ["testeur"], async () => {});
    expect(runAgentsQueueByProject[PROJECT]).toHaveLength(2);

    const res = await abandonQueuedRunAgentsMissions(PROJECT);
    expect(res.count).toBe(2);
    expect(res.labels).toEqual(["#1 « corriger le parseur »", "#2 « écrire les tests »"]);

    // Le journal porte le motif ET les deux missions nommées.
    const journal = lastJournal();
    expect(journal).toContain("reason=queue-abandoned");
    expect(journal).toContain("corriger le parseur");
    expect(journal).toContain("écrire les tests");
    expect(journal).toContain("detected=watchdog");

    // La file est réellement vidée, et l'utilisateur est averti (notification).
    expect(runAgentsQueueByProject[PROJECT]).toBeUndefined();
    expect(__superAgentQueueStateForTest(PROJECT).queueLength).toBe(0);
  });

  it("le watchdog de run appelle l'abandon TRACÉ (aucun `queue.length = 0` muet)", () => {
    expect(superAgentSrc).toContain("await abandonQueuedRunAgentsMissions(target)");
    expect(superAgentSrc).not.toMatch(/if \(runAgentsQueueByProject\[target\]\) \{ runAgentsQueueByProject\[target\]\.length = 0;/);
  });

  it("le libellé d'une mission nomme son numéro et sa demande", () => {
    expect(missionQueueLabel({ id: 7, label: "corriger le parseur" })).toBe("#7 « corriger le parseur »");
    expect(missionQueueLabel({ label: "sans identité" })).toBe("sans identité");
  });
});

// ── Le module d'identité et le journal ne cassent rien d'existant ──────────
describe("RÈGLE 4 — invariants de câblage", () => {
  it("agents-bus.js expose la file partagée par projet et le garde-fou de propriétaire", () => {
    expect(busSrc).toContain("const projectExclusivityQueues = {}");
    expect(busSrc).toContain("entry.ownerRunKey = ctx.runKey");
    expect(busSrc).toContain("queue-replay-no-owner");
    // Le contexte de run utilise la file PARTAGÉE du projet (pas une file locale
    // qui mourrait avec la run).
    expect(busSrc).toContain("exclusivityQueue: exclusivityQueueOfProject(project)");
  });

  it("super-agent.js joint l'identité au compte rendu de fin de run", () => {
    expect(superAgentSrc).toContain("finishRunAgentsToSuperAgent(result, projectPath, ok, missionIdentity)");
    expect(superAgentSrc).toContain("annotateMissionReport(buildRunAgentsSummary(result), opts.identity)");
  });
});
