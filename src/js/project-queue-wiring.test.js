// Mission 385 — CÂBLAGE de la file d'attente visible du projet.
//
// Ce fichier prouve, au niveau où la décision est réellement prise :
//   1. la file VISIBLE d'un projet compose bien les files réelles existantes
//      (missions de l'assistant, délégations, agents en file, commandes
//      manuelles) dans l'ordre de démarrage, avec la tâche en cours au rang 1 ;
//   2. `/file vide` abandonne les demandes en ATTENTE (décomptes annoncés) ;
//   3. les ancres de câblage de l'onglet agent existent (bloc discret, commande
//      `/file`, mise en file au lieu d'un refus sec, boucle de rejeu) et
//      n'interfèrent pas avec la politique d'admission existante.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Même harnais que `verrou-par-projet.test.js` : `super-agent.js` touche `window`
// à l'évaluation, et aucun accès Tauri réel ne doit avoir lieu.
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
// Journal GLOBAL de repli (trace d'une file d'ASSISTANT, hors projet).
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor"),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import {
  beginRun,
  endRun,
  isRunInProgress,
  getProjectRunLockInfo,
  listProjectExclusivityEntries,
  abandonProjectExclusivityQueues,
} from "./agents-bus.js";
import {
  runAgentsQueueByProject,
  delegationState,
  getProjectMissionQueue,
  getProjectDelegationQueue,
  abandonQueuedRunAgentsMissions,
  abandonQueuedDelegations,
  abandonProjectMissionQueue,
  abandonProjectDelegationQueue,
} from "./super-agent.js";
import { invoke } from "@tauri-apps/api/core";
import { enqueueProjectCommand, listProjectCommands, __resetProjectQueueForTest } from "./project-task-queue.js";
import { readProjectQueueView, abandonProjectQueue, formatProjectQueueReport } from "./project-queue-view.js";

const PROJECT = "G:\\IA_PL\\pilot";
const OTHER = "G:\\IA_PL\\autre";

const root = new URL("../../", import.meta.url);
const source = (rel) => readFileSync(new URL(rel, root), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  __resetProjectQueueForTest();
  delete runAgentsQueueByProject[PROJECT];
  delete runAgentsQueueByProject[OTHER];
  delegationState(PROJECT).queue.length = 0;
  vi.mocked(invoke).mockClear();
  // Libérer un éventuel verrou laissé par un test précédent.
  const info = getProjectRunLockInfo(PROJECT);
  for (const key of info.keys) endRun(PROJECT);
});

/** Laisse les écritures de journal (fire-and-forget) se terminer. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Lignes du journal des arrêts réellement écrites (`agent-stops.log`). */
function journalWrites() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd, args]) => cmd === "write_file_content" && args && /agent-stops\.log$/.test(String(args.path || "")))
    .map(([, args]) => ({ path: String(args.path), content: String(args.content || "") }));
}

describe("1. la file visible compose les files réelles du projet", () => {
  it("aucune demande : la file est vide", () => {
    const view = readProjectQueueView(PROJECT);
    expect(view.isEmpty).toBe(true);
    expect(formatProjectQueueReport(PROJECT)).toContain("vide");
  });

  it("missions, commandes, délégations : une seule file ordonnée, rang 1 pour la tâche en cours", () => {
    // Mission de l'assistant en file (file réelle existante).
    runAgentsQueueByProject[PROJECT] = [{ launch: async () => {}, label: "mission de l'assistant" }];
    // Demande manuelle en file (nouvelle file de cette mission).
    enqueueProjectCommand({ project: PROJECT, text: "commande manuelle", launch: async () => true });
    // Délégation en file (issue #66).
    delegationState(PROJECT).queue.push({ request: "délégation en attente", projectPath: PROJECT, agentId: "codeur" });

    const before = readProjectQueueView(PROJECT);
    // Sans tâche en cours, la première demande en attente est au rang 1.
    expect(before.running).toHaveLength(0);
    expect(before.waiting.map((w) => [w.rank, w.kind])).toEqual([
      [1, "commande"],
      [2, "mission"],
      [3, "delegation"],
    ]);

    // Une run démarre sur le projet : elle occupe le rang 1, tout descend d'un rang.
    const ctx = beginRun(PROJECT, { readOnly: false });
    expect(isRunInProgress(PROJECT)).toBe(true);
    const during = readProjectQueueView(PROJECT);
    expect(during.running.length).toBeGreaterThan(0);
    expect(during.waiting.map((w) => [w.rank, w.kind])).toEqual([
      [during.running.length + 1, "commande"],
      [during.running.length + 2, "mission"],
      [during.running.length + 3, "delegation"],
    ]);
    const report = formatProjectQueueReport(PROJECT);
    expect(report).toContain("en cours");
    expect(report).toContain("en attente (");

    endRun(PROJECT, ctx && ctx.generation);
    // La place est rendue : il ne reste que les demandes en attente.
    expect(isRunInProgress(PROJECT)).toBe(false);
    expect(readProjectQueueView(PROJECT).running).toHaveLength(0);
  });

  it("les demandes du projet voisin ne polluent pas la file", () => {
    enqueueProjectCommand({ project: OTHER, text: "autre projet", launch: async () => true });
    runAgentsQueueByProject[OTHER] = [{ launch: async () => {}, label: "mission d'un autre projet" }];
    const view = readProjectQueueView(PROJECT);
    expect(view.isEmpty).toBe(true);
    expect(listProjectCommands(OTHER)).toHaveLength(1);
  });

  it("`/file vide` abandonne les demandes en attente et annonce les décomptes", () => {
    runAgentsQueueByProject[PROJECT] = [
      { launch: async () => {}, label: "mission 1" },
      { launch: async () => {}, label: "mission 2" },
    ];
    enqueueProjectCommand({ project: PROJECT, text: "commande 1", launch: async () => true });
    delegationState(PROJECT).queue.push({ request: "délégation", projectPath: PROJECT, agentId: "codeur" });

    const counts = abandonProjectQueue(PROJECT);
    expect(counts).toEqual({ commands: 1, missions: 2, delegations: 1, agents: 0 });
    expect(readProjectQueueView(PROJECT).isEmpty).toBe(true);
    // La file de missions du projet est bien vidée (aucune relance fantôme).
    expect(getProjectMissionQueue(PROJECT)).toHaveLength(0);
    expect(getProjectDelegationQueue(PROJECT)).toHaveLength(0);
  });

  it("les demandes d'agents en file d'exclusivité sont lisibles et abandonnables sans casser la run", () => {
    const ctx = beginRun(PROJECT, { readOnly: false });
    // File d'exclusivité alimentée à la main (même structure que le bus).
    ctx.exclusivityQueue = {
      [`${PROJECT}\u{1f}codeur`]: [{ agentId: "codeur", brief: "tâche de l'agent codeur", project: PROJECT }],
    };
    const entries = listProjectExclusivityEntries(PROJECT);
    expect(entries.map((e) => e.agentId)).toEqual(["codeur"]);
    expect(readProjectQueueView(PROJECT).waiting.map((w) => w.kind)).toContain("agent");

    expect(abandonProjectExclusivityQueues(PROJECT)).toBe(1);
    expect(listProjectExclusivityEntries(PROJECT)).toHaveLength(0);
    // La run n'est pas cassée : elle est toujours en cours (seule la demande en
    // file a été abandonnée).
    expect(isRunInProgress(PROJECT)).toBe(true);
    endRun(PROJECT, ctx && ctx.generation);
  });
});

describe("1 bis. `/file vide` ne perd RIEN en silence (règle 4)", () => {
  it("chaque famille abandonnée écrit une ligne NOMMÉE dans agent-stops.log", async () => {
    runAgentsQueueByProject[PROJECT] = [{ launch: async () => {}, label: "mission perdue ?" }];
    enqueueProjectCommand({ project: PROJECT, text: "commande à ne pas oublier", launch: async () => true });
    delegationState(PROJECT).queue.push({ request: "délégation à nommer", projectPath: PROJECT, agentId: "codeur" });

    const counts = abandonProjectQueue(PROJECT);
    expect(counts).toEqual({ commands: 1, missions: 1, delegations: 1, agents: 0 });
    await flush();

    const writes = journalWrites();
    expect(writes, "un vidage muet du journal (familles perdues sans trace)").toHaveLength(3);
    // Le journal du PROJET est visé (pas le repli global) et chaque ligne porte
    // le motif d'abandon ET les libellés des demandes abandonnées.
    expect(writes.every((w) => w.path.startsWith(PROJECT))).toBe(true);
    const content = writes.map((w) => w.content).join("\n");
    expect(content).toContain("reason=queue-abandoned");
    expect(content).toContain("detected=file-vide");
    for (const label of ["commande à ne pas oublier", "mission perdue ?", "délégation à nommer"]) {
      expect(content, `libellé non consigné : ${label}`).toContain(label);
    }
    // Une ligne par FAMILLE (le motif dit de quelle file il s'agit).
    for (const family of ["commande", "mission", "délégation"]) {
      expect(content).toContain(`1 ${family}(s) en file`);
    }
  });

  it("`/file vide` sur une file déjà VIDE n'écrit aucune ligne parasite", async () => {
    expect(abandonProjectQueue(PROJECT)).toEqual({ commands: 0, missions: 0, delegations: 0, agents: 0 });
    await flush();
    expect(journalWrites()).toHaveLength(0);
  });

  it("l'abandon d'une file de DÉLÉGATIONS nomme et journalise (plus de vidage muet)", async () => {
    delegationState(PROJECT).queue.push(
      { request: "première demande", projectPath: PROJECT, agentId: "codeur" },
      { request: "deuxième demande", projectPath: PROJECT, agentId: "testeur" },
    );
    const res = await abandonQueuedDelegations(PROJECT, { detected: "stop-agent" });
    expect(res.count).toBe(2);
    expect(res.labels).toEqual(["première demande", "deuxième demande"]);
    expect(delegationState(PROJECT).queue).toHaveLength(0);
    const content = journalWrites().map((w) => w.content).join("\n");
    expect(content).toContain("reason=queue-abandoned");
    expect(content).toContain("detected=stop-agent");
    expect(content).toContain("première demande");
    expect(content).toContain("deuxième demande");
  });

  it("l'abandon d'une file de MISSIONS nomme et journalise, et coupe le rejeu", async () => {
    runAgentsQueueByProject[PROJECT] = [
      { launch: async () => {}, label: "mission 1" },
      { launch: async () => {}, label: "mission 2" },
    ];
    const res = await abandonQueuedRunAgentsMissions(PROJECT, { detected: "stop-agent" });
    expect(res.count).toBe(2);
    expect(res.labels).toEqual(["mission 1", "mission 2"]);
    expect(runAgentsQueueByProject[PROJECT]).toBeUndefined();
    const content = journalWrites().map((w) => w.content).join("\n");
    expect(content).toContain("detected=stop-agent");
    expect(content).toContain("mission 1");
  });

  it("une file d'ASSISTANT (hors projet) part au journal GLOBAL, jamais dans un projet", async () => {
    // `stop_agent` d'une mission d'assistant : la clé n'est pas un chemin.
    runAgentsQueueByProject["__assistant__"] = [{ launch: async () => {}, label: "mission assistant" }];
    await abandonQueuedRunAgentsMissions("__assistant__", { detected: "stop-agent" });
    const writes = journalWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].path, "le journal d'un projet ne doit pas recevoir une trace d'assistant").not.toContain("__assistant__");
    expect(writes[0].path).toMatch(/agent-stops\.log$/);
    expect(writes[0].content).toContain("mission assistant");
  });
});

describe("1 ter. une file vidée laisse sa trace SANS son appelant habituel (règle 4)", () => {
  it("une MISSION orpheline abandonnée directement est nommée dans le journal", async () => {
    // Aucun appelant de la vue de file : on appelle l'abandon comme le ferait
    // un futur chemin (chien de garde, arrêt, vue distante).
    runAgentsQueueByProject[PROJECT] = [{ launch: async () => {}, label: "mission orpheline" }];
    expect(abandonProjectMissionQueue(PROJECT)).toBe(1);
    expect(runAgentsQueueByProject[PROJECT], "la file doit être vidée immédiatement").toBeUndefined();
    await flush();

    const writes = journalWrites();
    expect(writes, "file de missions vidée SANS trace (l'appelant n'est plus le garant)").toHaveLength(1);
    expect(writes[0].path.startsWith(PROJECT)).toBe(true);
    expect(writes[0].content).toContain("reason=queue-abandoned");
    // Le libellé de la demande abandonnée est consigné (rien d'anonyme).
    expect(writes[0].content).toContain("mission orpheline");
  });

  it("une DÉLÉGATION orpheline abandonnée directement est nommée dans le journal", async () => {
    delegationState(PROJECT).queue.push({ request: "délégation orpheline", projectPath: PROJECT, agentId: "codeur" });
    expect(abandonProjectDelegationQueue(PROJECT)).toBe(1);
    expect(delegationState(PROJECT).queue, "la file doit être vidée immédiatement").toHaveLength(0);
    await flush();

    const writes = journalWrites();
    expect(writes, "file de délégations vidée SANS trace").toHaveLength(1);
    expect(writes[0].path.startsWith(PROJECT)).toBe(true);
    expect(writes[0].content).toContain("reason=queue-abandoned");
    expect(writes[0].content).toContain("délégation orpheline");
  });

  it("aucune DOUBLE écriture : une seule ligne par famille abandonnée", async () => {
    // Une seule famille peuplée : si l'appelant journalisait encore EN PLUS de
    // la fonction, on compterait 2 lignes au lieu de 1.
    runAgentsQueueByProject[PROJECT] = [{ launch: async () => {}, label: "mission unique" }];
    abandonProjectQueue(PROJECT);
    await flush();
    expect(journalWrites(), "double écriture de la trace d'abandon").toHaveLength(1);

    // Et une famille sans demande n'écrit rien (pas de ligne parasite).
    vi.mocked(invoke).mockClear();
    abandonProjectQueue(PROJECT);
    await flush();
    expect(journalWrites()).toHaveLength(0);
  });
});

describe("2. câblage dans l'onglet agent (agent-pi.js)", () => {
  const agentPi = () => source("src/js/agent-pi.js");

  it("le bloc discret de la file existe et est rafraîchi par les événements de la file", () => {
    const code = agentPi();
    expect(code).toContain('"agent-queue-block hidden"');
    expect(code).toContain("refreshQueueBlock");
    expect(code).toContain("readProjectQueueView");
    expect(code).toContain("formatQueueLines");
    expect(code).toContain('onGlobal(window, "pilot-queue-changed", refreshQueueBlock)');
  });

  it("la boucle de rejeu et la sonde d'admission sont installées (démarrage automatique)", () => {
    const code = agentPi();
    expect(code).toContain("startProjectQueueLoop()");
    expect(code).toContain("setProjectQueueProbe(");
    // La sonde reste la politique d'admission EXISTANTE (aucune règle nouvelle).
    expect(code).toContain("canSendManualCommandAsync(queueProject, isRunInProgress, isProjectAgentBusy, releaseOrphanRunLock)");
  });

  it("une commande refusée est MISE EN FILE au lieu d'être perdue (les deux gardes)", () => {
    const code = agentPi();
    const start = code.indexOf("const sendPrompt = async () => {");
    expect(start).toBeGreaterThan(0);
    const end = code.indexOf("if (voiceActive) stopVoiceInput();", start);
    const body = code.slice(start, end);
    // Les deux gardes (bus puis activité réelle de l'agent) mettent en file.
    const guards = body.split("queueRefusedCommand(text)").length - 1;
    expect(guards).toBe(2);
    // La garde de la politique d'admission est toujours APPLIQUÉE (inchangée).
    expect(body).toContain("canSendManualCommand(window._pilotProjectPath");
    expect(body).toContain("canSendManualCommandAsync(window._pilotProjectPath");
    // La relance réutilise le chemin d'envoi existant (aucun lancement parallèle).
    expect(code).toContain("const sent = await sendPrompt();");
    // Le texte saisi reste dans la zone de saisie en cas de file pleine.
    expect(body).toContain("appendSystemMessage(messagesEl, MANUAL_COMMAND_BLOCKED_MESSAGE)");
  });

  it("`/file` et `/file vide` sont traités LOCALEMENT, avant tout envoi au moteur", () => {
    const code = agentPi();
    const fileCmd = code.indexOf('if (text === "/file" || text === "/file vide")');
    const send = code.indexOf("if (voiceActive) stopVoiceInput();");
    expect(fileCmd).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(fileCmd);
    const block = code.slice(fileCmd, send);
    expect(block).toContain("formatProjectQueueReport(queueProject)");
    expect(block).toContain("abandonProjectQueue(queueProject)");
    expect(block).toContain("formatQueueClearedMessage(counts)");
    expect(block).toContain("return;");
  });

  it("le bloc de la file a un style discret dédié", () => {
    const css = source("src/css/style.css");
    expect(css).toContain(".agent-queue-block {");
    expect(css).toContain(".agent-queue-block .agent-queue-title");
  });

  it("le module de vue ne fait que lire et abandonner (aucun lancement)", () => {
    const view = source("src/js/project-queue-view.js");
    expect(view).not.toContain("beginRun");
    expect(view).not.toContain("startParallelRun");
    expect(view).not.toContain("startAgentsRun");
    expect(view).not.toContain("invoke(");
  });
});
