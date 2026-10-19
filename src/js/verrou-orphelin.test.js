// PREUVES — verrou par projet JAMAIS laissé fermé après la mort, l'échec ou
// l'arrêt d'un agent (mission 380).
//
// FAIT (défaut) : la libération du verrou de run (busState.runs[clé].runState)
// reposait ENTIÈREMENT sur un déclencheur EXTÉRIEUR — un nouveau lancement, le
// rejeu de file de l'assistant (armé seulement s'il RESTE une demande en file) ou
// son watchdog de run (15 min, seulement pendant une run suivie). Un agent mort
// sans émettre `agent_end`/`process_exit` (ou dont l'événement terminal arrive
// après le passage de la run en `stopping`, ou après sa sortie d'`activeAgents`)
// ne libérait donc jamais le verrou : « ⏳ Une tâche d'agents est déjà en cours
// sur ce projet… » jusqu'au REDÉMARRAGE de Pilot.
//
// INVARIANTS EXIGÉS (et prouvés ici) :
//   1. un agent MORT (aucune session vivante) ne bloque plus le projet : le
//      balayage périodique (`sweepOrphanRunLocks`) lève le verrou orphelin ;
//   2. un agent ARRÊTÉ par l'utilisateur libère le projet pour la mission
//      suivante ;
//   3. une run dont l'agent TRAVAILLE réellement n'est JAMAIS libérée ;
//   4. un verrou resté fermé ne condamne plus la commande manuelle : la levée
//      ciblée est tentée AVANT le refus puis l'envoi est autorisé ;
//   5. l'utilisateur peut VOIR et LEVER le verrou sans redémarrer Pilot.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Même harnais minimal que `verrou-par-projet.test.js` (aucun accès Tauri réel).
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
  initAgentsBus,
  beginRun,
  endRun,
  isRunInProgress,
  attachMissionSink,
  startParallelRun,
  stopAgentsRun,
  releaseStuckRunLock,
  sweepOrphanRunLocks,
  getProjectRunLockInfo,
  forceReleaseProjectRunLock,
  RUN_LOCK_SWEEP_START_GRACE_MS,
  __setWatchdogConfirmDelayForTest,
} from "./agents-bus.js";
import { canSendManualCommandAsync } from "./run-policy.js";

/** Laisse tourner les micro-tâches (invoke simulé + portes asynchrones). */
const flushAsync = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

const runs = () => globalThis.__agentBusState.runs;

/** Installe une sonde `list_agent_sessions` qui ne voit AUCUNE session. */
function mockNoSession() {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "list_agent_sessions") return { sessions: [] };
    if (cmd === "git_status_project") return { pending: 0, head_ts: 0 };
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return { agents: [] };
    return undefined;
  });
}

/** Installe une sonde `list_agent_sessions` qui voit l'agent TRAVAILLER. */
function mockWorkingSession(project, agentId) {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "list_agent_sessions") {
      return {
        sessions: [
          {
            agent: agentId,
            project,
            mode: "agent_process",
            alive: true,
            busy: true,
            lastActivity: new Date().toISOString(),
          },
        ],
      };
    }
    if (cmd === "git_status_project") return { pending: 0, head_ts: 0 };
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return { agents: [] };
    return undefined;
  });
}

/** Pose un verrou de run « écriture » porté par `agentId`, inactif depuis 3 min. */
function seedStuckRun(project, agentId, { readOnly = false, idleMs = 3 * 60 * 1000 } = {}) {
  const ctx = beginRun(project, { readOnly });
  ctx.activeAgents.add(agentId);
  ctx.agentProject[agentId] = project;
  ctx.lastActivityAt = Date.now() - idleMs;
  ctx.startedAt = Date.now() - idleMs;
  return ctx;
}

beforeEach(() => {
  // Double mesure du watchdog sans attente réelle (comme les autres preuves).
  __setWatchdogConfirmDelayForTest(0);
});

afterEach(() => {
  for (const key of Object.keys(runs())) delete runs()[key];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  __setWatchdogConfirmDelayForTest(7 * 1000);
});

// ───────────────────────────────────────────────────────────────────────────
describe("PREUVE 1 — un agent MORT ne bloque plus le projet (verrou orphelin auto-levé)", () => {
  it("le balayage périodique libère le verrou et la mission suivante peut démarrer", async () => {
    const p = "preuve-380-agent-mort";
    mockNoSession();
    await initAgentsBus({});

    // Le codeur a été déclaré actif puis son processus est mort SANS émettre
    // `agent_end` ni `process_exit` : le verrou reste « running », plus aucune
    // session n'existe. C'est exactement l'état constaté (blocage jusqu'au
    // redémarrage).
    const ctx = seedStuckRun(p, "codeur");
    let reported = null;
    attachMissionSink(ctx.runKey, {
      onDone: () => {},
      onError: (e) => {
        reported = e;
      },
    });
    expect(isRunInProgress(p)).toBe(true);

    // AVANT le correctif : rien ne libère ce verrou (aucun lancement, aucune
    // demande en file, aucune run d'assistant suivie) → blocage définitif.
    // Le balayage est le déclencheur AUTONOME ; la porte « agents fantômes » du
    // chien de garde exige deux mesures espacées → deux passes.
    await sweepOrphanRunLocks();
    await flushAsync();
    await sweepOrphanRunLocks();
    await flushAsync();

    expect(runs()[ctx.runKey], "le verrou orphelin doit être levé").toBeUndefined();
    expect(isRunInProgress(p)).toBe(false);
    expect(reported, "la mission doit recevoir un rapport (jamais un silence)").toBeTruthy();

    // Et la mission suivante démarre réellement sur ce projet.
    const next = beginRun(p, { readOnly: false });
    expect(next.runState).toBe("running");
    endRun(p, next.generation);
    expect(isRunInProgress(p)).toBe(false);
  });

  it("une passation d'agents (aucun agent actif mais activité récente) n'est pas coupée", async () => {
    const p = "preuve-380-passation";
    mockNoSession();
    await initAgentsBus({});
    // `activeAgents` momentanément vide entre deux agents d'une même run : le
    // plancher d'inactivité interdit au balayage de conclure « orphelin ».
    const ctx = beginRun(p, { readOnly: false });
    ctx.startedAt = Date.now() - 10 * 60 * 1000;
    ctx.lastActivityAt = Date.now() - 5 * 1000;
    const released = await sweepOrphanRunLocks();
    await flushAsync();
    expect(released).not.toContain(ctx.runKey);
    expect(runs()[ctx.runKey]).toBeTruthy();
  });

  it("une run plus jeune que la grâce de démarrage n'est JAMAIS examinée", async () => {
    const p = "preuve-380-demarrage";
    mockNoSession();
    await initAgentsBus({});
    const ctx = beginRun(p, { readOnly: false });
    // Aucun agent encore enregistré (fenêtre de démarrage) : sans la grâce, la
    // porte « aucun agent actif » libérerait la run qui vient de commencer.
    expect(Date.now() - ctx.startedAt).toBeLessThan(RUN_LOCK_SWEEP_START_GRACE_MS);
    const released = await sweepOrphanRunLocks();
    expect(released).not.toContain(ctx.runKey);
    expect(isRunInProgress(p)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("PREUVE 2 — un agent ARRÊTÉ par l'utilisateur libère le projet", () => {
  it("après stopAgentsRun, une nouvelle mission démarre sur le même projet", async () => {
    const p = "preuve-380-arret-utilisateur";
    mockNoSession();
    await initAgentsBus({});
    const ctx = seedStuckRun(p, "codeur", { idleMs: 0 });
    let stoppe = false;
    attachMissionSink(ctx.runKey, {
      onDone: () => {},
      onError: () => {
        stoppe = true;
      },
    });

    await stopAgentsRun({ runKey: ctx.runKey });
    await flushAsync();

    expect(stoppe, "la mission arrêtée reçoit son rapport d'arrêt").toBe(true);
    expect(runs()[ctx.runKey]).toBeUndefined();
    expect(isRunInProgress(p)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("PREUVE 3 — une run dont l'agent TRAVAILLE n'est jamais coupée", () => {
  it("le balayage laisse intacte une run portée par une session vivante et active", async () => {
    const p = "preuve-380-agent-sain";
    mockWorkingSession(p, "codeur");
    await initAgentsBus({});
    const ctx = seedStuckRun(p, "codeur");

    const released = await sweepOrphanRunLocks();
    await flushAsync();

    expect(released).not.toContain(ctx.runKey);
    expect(runs()[ctx.runKey], "un agent qui travaille conserve son verrou").toBeTruthy();
    expect(isRunInProgress(p)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("PREUVE 4 — la commande manuelle n'est plus condamnée par un verrou orphelin", () => {
  it("la levée ciblée est tentée AVANT le refus, puis l'envoi est autorisé", async () => {
    const p = "preuve-380-commande-manuelle";
    mockNoSession();
    await initAgentsBus({});
    const ctx = beginRun(p, { readOnly: false });
    ctx.startedAt = Date.now() - 3 * 60 * 1000;
    ctx.lastActivityAt = Date.now() - 3 * 60 * 1000;
    // Verrou « sans aucun agent porteur » : exactement l'état qui refusait la
    // saisie de l'utilisateur alors que plus rien ne travaillait.
    expect(isRunInProgress(p, { nature: "write" })).toBe(true);

    const releaseOrphanRunLock = (project) => releaseStuckRunLock(project);

    // AVANT le correctif : `false` immédiatement (message « déjà en cours »).
    const allowed = await canSendManualCommandAsync(p, isRunInProgress, undefined, releaseOrphanRunLock);
    await flushAsync();

    expect(runs()[ctx.runKey], "le verrou orphelin doit être levé par la tentative").toBeUndefined();
    expect(allowed, "l'utilisateur doit pouvoir envoyer sa commande").toBe(true);
  });

  it("un blocage RÉEL (agent vivant qui travaille) continue de refuser", async () => {
    const p = "preuve-380-commande-refusee";
    mockWorkingSession(p, "codeur");
    await initAgentsBus({});
    seedStuckRun(p, "codeur");

    const releaseOrphanRunLock = (project) => releaseStuckRunLock(project);
    const allowed = await canSendManualCommandAsync(p, isRunInProgress, async () => true, releaseOrphanRunLock);
    expect(allowed).toBe(false);
    expect(isRunInProgress(p)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("PREUVE 5 — voir et lever un verrou bloqué sans redémarrer Pilot", () => {
  it("getProjectRunLockInfo décrit le verrou, forceReleaseProjectRunLock le lève (lecture + écriture)", async () => {
    const p = "preuve-380-voir-lever";
    mockNoSession();
    await initAgentsBus({});
    const write = seedStuckRun(p, "codeur");
    const read = beginRun(p, { readOnly: true });
    read.activeAgents.add("plan-maker");

    const info = getProjectRunLockInfo(p);
    expect(info.blocked).toBe(true);
    const keys = info.keys.map((k) => k.key);
    expect(keys).toContain(write.runKey);
    expect(keys).toContain(read.runKey);
    const writeInfo = info.keys.find((k) => k.key === write.runKey);
    expect(writeInfo.runState).toBe("running");
    expect(writeInfo.agents).toContain("codeur");
    expect(writeInfo.readonly).toBe(false);
    expect(writeInfo.idleMs).toBeGreaterThan(0);

    const r = await forceReleaseProjectRunLock(p);
    expect(r.released.length).toBe(2);
    expect(runs()[write.runKey]).toBeUndefined();
    expect(runs()[read.runKey]).toBeUndefined();
    expect(isRunInProgress(p)).toBe(false);
    expect(getProjectRunLockInfo(p).blocked).toBe(false);

    // Le projet accepte de nouveau une mission (aucun redémarrage nécessaire) :
    // la garde d'admission ne lève plus « Une run est déjà en cours ». L'agent
    // n'a pas de modèle configuré → son tour échoue, mais la mission a bien été
    // ADMISE (c'est ce que prouve l'absence de rejet).
    await expect(
      startParallelRun([{ agentId: "codeur", project: p, brief: "mission suivante" }], "", {}),
    ).resolves.toBeUndefined();
    await flushAsync();
    expect(isRunInProgress(p)).toBe(false);
  });
});
