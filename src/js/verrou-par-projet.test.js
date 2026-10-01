// PREUVES — verrou par projet à lecteurs partagés (branche verrou-par-projet).
//
// Ces tests prouvent le comportement exigé de bout en bout, au niveau où la
// décision d'admission est réellement prise (bus d'agents + politique pure) :
//   (a) deux missions de LECTURE sur le MÊME projet tournent simultanément ;
//   (b) une mission qui MODIFIE sur un projet est refusée/mise en file tant
//       qu'une autre mission tourne sur ce projet ; une mission sur un AUTRE
//       projet n'attend pas.
//
// `beginRun(project, { readOnly })` est exactement ce qu'appelle
// `startParallelRun` après sa garde d'admission `isRunInProgress(project,
// { nature })` (elle-même utilisée par la file d'attente de super-agent.js).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// POINT G : les preuves de rejeu de la file de missions importent `super-agent.js`
// (module d'UI qui touche `window` à l'évaluation). On installe donc un `window`
// minimal AVANT son import (vi.hoisted s'exécute avant les imports), comme dans
// `super-agent-launch-verdict.test.js`.
import { vi } from "vitest";
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

// Same stub as agents-bus.test.js: aucun accès Tauri réel en environnement Node.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { beginRun, endRun, isRunInProgress, getRunState, initAgentsBus, startParallelRun, handleAgentEvent, attachMissionSink, releaseStuckRunLock } from "./agents-bus.js";
import { canSendManualCommand, MANUAL_COMMAND_NATURE, MANUAL_COMMAND_BLOCKED_MESSAGE } from "./run-policy.js";
import { armQueueReplay, replayQueuedMissionForProject, runAgentsQueueByProject, delegationState, replayDelegationQueueForProject, armDelegationQueueReplay } from "./super-agent.js";

describe("PREUVE (a) — deux missions de LECTURE tournent en parallèle sur le même projet", () => {
  it("(a) deux lectures coexistuent (clés distinctes), sans être bloquées ni s'écraser", () => {
    const p = "preuve-a";
    // Admission de la 1re lecture : rien ne tourne → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run1 = beginRun(p, { readOnly: true });

    // Admission de la 2e lecture : la 1re est une LECTURE partagée → autorisée.
    expect(isRunInProgress(p, { nature: "read" })).toBe(false);
    const run2 = beginRun(p, { readOnly: true });

    // Les deux runs vivent en même temps, avec des contextes distincts.
    expect(run1.runKey).not.toBe(run2.runKey);
    expect(run1.readonly).toBe(true);
    expect(run2.readonly).toBe(true);
    expect(run1.runKey.startsWith(`${p}#read:`)).toBe(true);
    expect(run2.runKey.startsWith(`${p}#read:`)).toBe(true);
    // Le PROJET RÉEL reste identique sur les deux contextes (routage par projet).
    expect([run1.project, run2.project]).toEqual([p, p]);

    // La fin de la 1re ne tue pas la 2de.
    endRun(p, run1.generation);
    expect(getRunState(p)).toBe("running");
    endRun(p, run2.generation);
    expect(getRunState(p)).toBe("idle");
  });
});

// POINT H — défaut « verrou par projet » (agents-bus) : une mission de LECTURE
// n'inscrivait pas son agent dans SA clé de run (`projet#read:N`) — l'agent
// atterrissait dans la clé par défaut du projet, donc TOUS ses événements
// étaient jetés : la lecture ne produisait rien, son verrou ne se libérait
// jamais, et la mission mise en file ne repartait jamais.
// Ce test ÉCHOUE avant le correctif (l'agent est absent de la clé de lecture).
describe("PREUVE (h) — deux missions, un projet : la lecture survit, se termine, puis la file repart", () => {
  const runsOf = (p) => Object.values(globalThis.__agentBusState.runs).filter((c) => c.project === p);
  const flushAsync = async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  };

  afterEach(() => {
    for (const key of Object.keys(globalThis.__agentBusState.runs)) delete globalThis.__agentBusState.runs[key];
    delete runAgentsQueueByProject["preuve-h"];
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("l'agent de lecture est inscrit dans SA clé de run, la run se termine, puis la mission en file démarre", async () => {
    const p = "preuve-h";
    // Sonde de sessions : l'agent n'est PAS encore déclaré occupé au lancement
    // (sinon la T5 le mettrait lui-même en file) ; on le déclare occupé ensuite
    // pour représenter la mission silencieuse en cours (outil long).
    let lecteurBusy = false;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agents") {
        return { agents: [{ id: "lecteur", name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false }] };
      }
      if (cmd === "get_config") return {};
      if (cmd === "list_agent_sessions") {
        return lecteurBusy
          ? { sessions: [{ agent: "lecteur", project: p, mode: "agent_process", alive: true, busy: true, lastActivity: new Date().toISOString() }] }
          : { sessions: [] };
      }
      return undefined;
    });
    await initAgentsBus({});
    await startParallelRun([{ agentId: "lecteur", project: p, brief: "lis le projet" }], "", {});

    // 1. L'agent de la mission de LECTURE est inscrit dans la run de lecture
    //    (et non dans la clé par défaut du projet).
    const readRun = runsOf(p).find((c) => c.readonly === true && [...c.activeAgents].includes("lecteur"));
    expect(
      readRun,
      "l'agent de lecture doit être inscrit dans SA clé de run: " +
        JSON.stringify(Object.values(globalThis.__agentBusState.runs).map((c) => ({ k: c.runKey, ro: c.readonly, ag: [...c.activeAgents], st: c.runState }))),
    ).toBeTruthy();
    const readKey = readRun.runKey;

    // 2. La première mission est SILENCIEUSE mais en cours ; sa sonde dit qu'elle
    //    travaille → elle SURVIT au passage du watchdog (deuxième vague).
    attachMissionSink(readKey, { onDone: () => {}, onError: () => {} });
    readRun.lastActivityAt = Date.now() - 11 * 60 * 1000;
    lecteurBusy = true;
    await releaseStuckRunLock(p);
    expect(getRunState(p), "la lecture silencieuse mais active ne doit pas être libérée").toBe("running");

    // 3. La lecture se TERMINE réellement (agent_start → agent_end).
    let done = false;
    attachMissionSink(readKey, { onDone: () => (done = true), onError: () => (done = true) });
    handleAgentEvent({ payload: { project: p, agent_id: "lecteur", event: { type: "agent_start" } } });
    handleAgentEvent({ payload: { project: p, agent_id: "lecteur", event: { type: "agent_end" } } });
    await flushAsync();
    expect(done, "la mission de lecture doit rendre son rapport et se terminer").toBe(true);
    expect(isRunInProgress(p), "le projet doit être libéré à la fin de la lecture").toBe(false);

    // 4. La seconde mission (MODIFICATION) mise en file démarre alors.
    let launched = 0;
    runAgentsQueueByProject[p] = [{ launch: () => { launched++; } }];
    const r = await replayQueuedMissionForProject(p, { isAdmissionFree: async () => !isRunInProgress(p) });
    expect(r).toEqual({ replayed: true, reason: "launched" });
    expect(launched).toBe(1);
  });
});

describe("C1 — une demande mise en file dans une run de LECTURE repart quand l'agent bloqueur se libère", () => {
  const runsOf = (p) => Object.values(globalThis.__agentBusState.runs).filter((c) => c.project === p);
  const flushAsync = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  };

  afterEach(() => {
    for (const key of Object.keys(globalThis.__agentBusState.runs)) delete globalThis.__agentBusState.runs[key];
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("le créneau libéré par la run A draine la file d'exclusivité de la run B (lecture)", async () => {
    const p = "preuve-c1";
    let busy = false;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agents") {
        return { agents: [{ id: "lecteur", name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false }] };
      }
      if (cmd === "get_config") return {};
      if (cmd === "list_agent_sessions") {
        return busy
          ? { sessions: [{ agent: "lecteur", project: p, mode: "agent_process", alive: true, busy: true, lastActivity: new Date().toISOString() }] }
          : { sessions: [] };
      }
      return undefined;
    });
    await initAgentsBus({});

    // Run A : lecture, l'agent « lecteur » devient actif dans SA clé de run.
    await startParallelRun([{ agentId: "lecteur", project: p, brief: "A" }], "", {});
    const runA = runsOf(p).find((c) => c.readonly && c.activeAgents.has("lecteur"));
    expect(runA).toBeTruthy();
    busy = true; // l'agent travaille → la demande suivante sera mise en file

    // Run B : seconde lecture sur le MÊME agent → affectation mise en file dans
    // le contexte propre de la run B.
    await startParallelRun([{ agentId: "lecteur", project: p, brief: "B" }], "", {});
    const runB = runsOf(p).find((c) => c !== runA);
    expect(runB, "la run de lecture B doit exister").toBeTruthy();
    const qk = `${p}\u{1f}lecteur`;
    expect(runB.exclusivityQueue[qk] && runB.exclusivityQueue[qk].length, "la demande B doit être en file").toBe(1);

    // La run A se termine réellement (agent_start → agent_end).
    handleAgentEvent({ payload: { project: p, agent_id: "lecteur", event: { type: "agent_start" } } });
    handleAgentEvent({ payload: { project: p, agent_id: "lecteur", event: { type: "agent_end" } } });
    await flushAsync();

    // La file de la run B a dû être drainée et son agent relancé.
    expect(runB.exclusivityQueue[qk], "la file de la run B doit être vidée").toBeUndefined();
    expect(runB.activeAgents.has("lecteur"), "l'agent de la run B doit être relancé").toBe(true);
  });
});

describe("C1 (reste) — sans événement de fin, le watchdog relance la demande en file (jamais silencieux)", () => {
  const runsOf = (p) => Object.values(globalThis.__agentBusState.runs).filter((c) => c.project === p);
  const flushAsync = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
  };

  afterEach(() => {
    for (const key of Object.keys(globalThis.__agentBusState.runs)) delete globalThis.__agentBusState.runs[key];
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("aucun agent_end : le watchdog DRAINE la file d'exclusivité au lieu de la perdre", async () => {
    const p = "preuve-c1-sans-fin";
    let busy = false;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_agents") {
        return { agents: [{ id: "lecteur", name: "Lecteur", readonly: true, models: { pi: "openai/gpt-4o" }, keep_context: false }] };
      }
      if (cmd === "get_config") return {};
      if (cmd === "list_agent_sessions") {
        return busy
          ? { sessions: [{ agent: "lecteur", project: p, mode: "agent_process", alive: true, busy: true, lastActivity: new Date().toISOString() }] }
          : { sessions: [] };
      }
      return undefined;
    });
    await initAgentsBus({});

    await startParallelRun([{ agentId: "lecteur", project: p, brief: "A" }], "", {});
    const runA = runsOf(p).find((c) => c.readonly && c.activeAgents.has("lecteur"));
    expect(runA).toBeTruthy();
    busy = true; // l'agent travaille → la demande suivante est mise en file

    await startParallelRun([{ agentId: "lecteur", project: p, brief: "B" }], "", {});
    const runB = runsOf(p).find((c) => c !== runA);
    expect(runB, "la run de lecture B doit exister").toBeTruthy();
    const qk = `${p}\u{1f}lecteur`;
    expect(runB.exclusivityQueue[qk] && runB.exclusivityQueue[qk].length, "la demande B doit être en file").toBe(1);

    // L'agent bloquant se FIGE : plus aucun travail, et AUCUN `agent_end`
    // n'arrivera (cas C1 laissé en l'état). Le watchdog est le déclencheur
    // extérieur qui doit rattraper la demande — jamais la perdre.
    // La porte « file sans porteur » ne s'arme qu'après la fenêtre de grâce
    // (~60 s sans session travailleuse) : on vieillit la dernière activité.
    busy = false;
    runB.lastActivityAt = Date.now() - 2 * 60 * 1000;
    await releaseStuckRunLock(p);
    await flushAsync();

    expect(runB.exclusivityQueue[qk], "la file doit être drainée par le watchdog").toBeUndefined();
    expect(runB.activeAgents.has("lecteur"), "la demande en file doit être RÉELLEMENT relancée").toBe(true);
  });
});

describe("PREUVE (b) — modification exclusive par projet, autres projets indépendants", () => {
  it("(b) une MODIFICATION attend toute run; une LECTURE attend une MODIFICATION; un autre projet n'attend pas", () => {
    const proj = "preuve-b";
    const autre = "preuve-b-autre";

    // 1. Une LECTURE tourne sur `proj`.
    const readRun = beginRun(proj, { readOnly: true });

    // Une modification sur `proj` est bloquée (sera mise en file par super-agent).
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    // Une autre lecture sur `proj` est autorisée (partage).
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
    // Un projet DIFFÉRENT n'attend pas (ni en écriture, ni en lecture).
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);
    expect(isRunInProgress(autre, { nature: "read" })).toBe(false);

    endRun(proj, readRun.generation);

    // 2. Une modification tourne sur `proj`.
    const writeRun = beginRun(proj);
    expect(writeRun.readonly).toBe(false);
    // Elle est exclusive : toute autre mission sur `proj` attend…
    expect(isRunInProgress(proj, { nature: "write" })).toBe(true);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(true);
    // …mais elle ne bloque pas un autre projet.
    expect(isRunInProgress(autre, { nature: "write" })).toBe(false);

    endRun(proj, writeRun.generation);
    expect(isRunInProgress(proj, { nature: "write" })).toBe(false);
    expect(isRunInProgress(proj, { nature: "read" })).toBe(false);
  });
});

// POINT B — le verrou n'est pas contournable par une commande manuelle.
// Une commande envoyée à la main (prompt tapé dans l'interface) peut modifier
// le projet : elle compte comme MODIFICATION exclusive et passe par la même
// politique d'admission que les missions. Ces tests ÉCHOUENT si l'on revient au
// comportement d'avant (garde absente du chemin manuel, ou nature « lecture »).
describe("POINT B — commande manuelle soumise à la politique d'admission", () => {
  it("la nature d'une commande manuelle est une MODIFICATION exclusive", () => {
    expect(MANUAL_COMMAND_NATURE).toBe("write");
  });

  it("refusée tant qu'une mission tourne sur le MÊME projet — jamais bloquée par un autre projet", () => {
    const proj = "point-b";
    const autre = "point-b-autre";
    // Rien ne tourne → autorisée.
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(true);
    // Même une mission de LECTURE bloque la commande manuelle (exclusive).
    const readRun = beginRun(proj, { readOnly: true });
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(false);
    expect(canSendManualCommand(autre, isRunInProgress)).toBe(true);
    endRun(proj, readRun.generation);
    // Une mission de MODIFICATION bloque aussi.
    const writeRun = beginRun(proj);
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(false);
    endRun(proj, writeRun.generation);
    expect(canSendManualCommand(proj, isRunInProgress)).toBe(true);
  });

  it("le prompt manuel (agent-pi.js) applique la garde AVANT d'envoyer le prompt", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const guardIdx = src.indexOf("!canSendManualCommand(window._pilotProjectPath");
    const sendIdx = src.indexOf('invoke("send_agent_prompt", payload)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(src).toContain("MANUAL_COMMAND_BLOCKED_MESSAGE");
    expect(sendIdx).toBeGreaterThan(-1);
    // La garde est branchée dans le chemin d'envoi, avant l'invoke.
    expect(guardIdx).toBeLessThan(sendIdx);
  });
});

// POINT C — arrêter un agent libère aussi la place du PROJET.
// La file des MISSIONS (`runAgentsQueueByProject`, indexée par projet) n'était
// pas vidée à l'arrêt : une mission en attente ne démarrait jamais puis était
// perdue par le watchdog. Ce test ÉCHOUE si la branche `stop_agent` cesse de
// libérer le créneau / la file du projet, ou cesse de le signaler.
// POINT B1/B2/B3 — plus aucun chemin manuel n'appelle `send_agent_prompt` en
// direct : chacun passe par la politique d'admission (`canSendManualCommandAsync`)
// AVANT l'envoi, avec un refus visible. Ces tests ÉCHOUENT si l'un des trois
// chemins revient à un `invoke("send_agent_prompt")` non gardé.
function assertGuardBeforeSend(src, label) {
  const guardIdx = src.indexOf("canSendManualCommandAsync(");
  const sendIdx = src.indexOf('invoke("send_agent_prompt", {');
  const refuseIdx = src.indexOf("MANUAL_COMMAND_BLOCKED_MESSAGE");
  expect(guardIdx, `${label} : garde absente`).toBeGreaterThan(-1);
  expect(refuseIdx, `${label} : refus non visible`).toBeGreaterThan(-1);
  expect(sendIdx, `${label} : envoi absent`).toBeGreaterThan(-1);
  expect(guardIdx, `${label} : la garde doit précéder l'envoi`).toBeLessThan(sendIdx);
}

describe("POINT B1 — menu contextuel de la barre latérale (sidebar.js)", () => {
  it("B1 — le garde précède l'envoi direct, refus visible", () => {
    const src = readFileSync(new URL("./sidebar.js", import.meta.url), "utf8");
    const handlerIdx = src.indexOf("ctxSendAgent.addEventListener(");
    const endIdx = src.indexOf("ctxAddPromptBuilder.addEventListener(", handlerIdx);
    expect(handlerIdx).toBeGreaterThan(-1);
    assertGuardBeforeSend(src.slice(handlerIdx, endIdx), "sidebar.js ctxSendAgent");
  });
});

describe("POINT B2 — bouton « Envoyer à l'agent » du constructeur de prompts", () => {
  it("B2 — le garde précède l'envoi direct, refus visible", () => {
    const src = readFileSync(new URL("./prompt-builder.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("async function sendToAgent()");
    expect(fnIdx).toBeGreaterThan(-1);
    assertGuardBeforeSend(src.slice(fnIdx), "prompt-builder.js sendToAgent");
  });
});

// POINT B3 — la commande /prompt (popup de templates) etait explicitement
// EXCLUE du garde au motif qu'elle est une « slash-command ». Or elle ENVOIE
// reellement un prompt a un agent : elle doit donc passer par la politique,
// sans casser les commandes de l'interface qui ne lancent aucun travail (elles
// restent hors du garde). Le refus est visible et la saisie est conservee.
describe("POINT B3 — popup de prompt /prompt (agent-pi.js applyPromptSelection)", () => {
  it("B3 — le garde precede l'envoi ET tout effacement de la saisie", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("async function applyPromptSelection()");
    const nextIdx = src.indexOf("\nfunction ", fnIdx + 1);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, nextIdx > fnIdx ? nextIdx : undefined);
    assertGuardBeforeSend(body, "agent-pi.js applyPromptSelection");
    // La garde est posee AVANT tout effacement de la saisie (texte conserve).
    const clearIdx = body.indexOf('acInputEl.value = ""');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(body.indexOf("canSendManualCommandAsync(")).toBeLessThan(clearIdx);
    // Les commandes qui ne lancent pas de travail restent hors du garde : la
    // condition d'exclusion du chat (`!isSlashCommand`) est intacte.
    expect(src).toContain('invoke("send_agent_prompt", payload)');
    expect(src).toContain("!isSlashCommand && !canSendManualCommand(window._pilotProjectPath");
  });

  // POINT G (réserve cosmétique) : la garde était évaluée AVANT le test
  // « template vide », donc un template vide pendant qu'un travail tourne
  // affichait « commande bloquée » au lieu de « aucun contenu ». Le test
  // « vide » doit précéder la garde.
  it("B3/G — le test « template vide » precede la garde (pas de faux refus)", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("async function applyPromptSelection()");
    const nextIdx = src.indexOf("\nfunction ", fnIdx + 1);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, nextIdx > fnIdx ? nextIdx : undefined);
    const emptyIdx = body.indexOf("Aucun contenu à envoyer");
    const guardIdx = body.indexOf("canSendManualCommandAsync(");
    expect(emptyIdx, "test « vide » absent").toBeGreaterThan(-1);
    expect(guardIdx, "garde absente").toBeGreaterThan(-1);
    expect(emptyIdx, "le test « vide » doit précéder la garde").toBeLessThan(guardIdx);
  });
});

// POINT D — sens inverse : une mission d'ÉCRITURE (`run_agents`) doit voir une
// commande manuelle en cours (le bus ne la voit pas) et être MISE EN FILE, au
// lieu de démarrer en parallèle. Même garde pour deux commandes manuelles
// concurrentes sur le même projet (deux onglets d'agent). Ces tests ÉCHOUENT si
// l'on revient à la seule sonde du bus.
describe("POINT D — le sens inverse : commande manuelle vs mission d'écriture", () => {
  it("run_agents sonde l'activité du projet en écriture et met en file", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("const launchOrQueue = async () => {");
    const endIdx = src.indexOf("const reportDeferredLaunch", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, endIdx);
    expect(body).toContain("isProjectAgentBusy(target)");
    expect(body).toContain('missionNature === "write"');
    // Mise en file réelle (même file que les autres missions), pas un refus sec.
    expect(body).toContain("runAgentsQueueByProject[target].push(");
  });

  it("deux commandes manuelles concurrentes : le chat sonde aussi l'activité", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("const sendPrompt = async () => {");
    const endIdx = src.indexOf("if (voiceActive) stopVoiceInput();", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, endIdx);
    expect(body).toContain("canSendManualCommandAsync(window._pilotProjectPath");
    expect(body).toContain("isProjectAgentBusy");
    expect(body).toContain("MANUAL_COMMAND_BLOCKED_MESSAGE");
  });
});

// POINT E — `run_assistant_agents` : plus de « mise en file » mensongère. Si
// c'est occupé, la demande est RÉELLEMENT mise dans la file du projet (rejouée
// par settleRun), donc jamais perdue en silence.
describe("POINT E — run_assistant_agents : file réelle, jamais un faux « queued »", () => {
  it("la branche occupée pousse dans la file et settleRun la rejoue", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const startIdx = src.indexOf("const target = ASSISTANT_SPACE;");
    const endIdx = src.indexOf("if (title.startsWith(SESSIONS_SENTINEL))", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const branch = src.slice(startIdx, endIdx);
    // La branche occupée pousse réellement dans la file partagée…
    expect(branch).toContain("runAgentsQueueByProject[target].push(");
    // …et settleRun vide la file (rejeu automatique, comme run_agents).
    const settleIdx = branch.indexOf("const settleRun = (ok, result) => {");
    const startRunIdx = branch.indexOf("const startRun = async () => {");
    const settleBody = branch.slice(settleIdx, startRunIdx);
    expect(settleBody).toContain("runAgentsQueueByProject[target] || []");
    expect(settleBody).toContain("next.launch()");
    // L'accusé rapporte le lancement RÉEL (plus de « queued » sans file).
    expect(branch).toContain("JSON.stringify({ ok: true, launched: launchedNow, queued: !launchedNow })");
  });
});

// POINT F — l'arrêt d'un agent ne doit plus laisser une mission D'ASSISTANT en
// attente sans suite. La file des missions d'assistant
// (`runAgentsQueueByProject[ASSISTANT_SPACE]`, alimentée par
// `run_assistant_agents`) n'était vidée par aucun chemin d'arrêt : la mission
// mise en file derrière une run d'assistant arrêtée ne se rejouait jamais et
// disparaissait en silence. Ce test ÉCHOUE si la branche `stop_agent` cesse de
// traiter cette file (ou cesse de le signaler), ou si elle se met à purger
// globalement les files.
describe("POINT F — l'arrêt d'un agent ne perd plus une mission d'ASSISTANT en attente", () => {
  it("la branche stop_agent traite la file d'assistant (même file) avec un message visible", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const stopIdx = src.indexOf('action === "stop_agent"');
    const nextIdx = src.indexOf('action === "create_agent"', stopIdx);
    expect(stopIdx).toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(stopIdx);
    const branch = src.slice(stopIdx, nextIdx);
    // Même file et même principe que le point C : clé ASSISTANT_SPACE.
    const assistantKeyIdx = branch.indexOf("const assistantKey = ASSISTANT_SPACE;");
    expect(assistantKeyIdx).toBeGreaterThan(-1);
    expect(branch).toContain("runAgentsQueueByProject[assistantKey]");
    expect(branch).toContain("delete runAgentsQueueByProject[assistantKey];");
    expect(branch).toContain("isRunInProgress(assistantKey)");
    // Traitement APRÈS celui du projet, et sur SA seule clé (pas de mélange).
    expect(assistantKeyIdx).toBeGreaterThan(branch.indexOf("const queueKey ="));
    // Rien ne disparaît en silence : un message visible dans les DEUX cas.
    expect(branch).toContain("mission(s) d'assistant en attente annulée(s)");
    expect(branch).toContain("mission(s) d'assistant toujours en attente");
    // Aucune purge globale des files (les projets restent intacts).
    expect(branch).not.toContain("runAgentsQueueByProject = {}");
  });
});

describe("POINT C — l'arrêt d'un agent libère la file de missions du projet", () => {
  it("la branche stop_agent libère le créneau et vide la file de missions (avec message)", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const stopIdx = src.indexOf('action === "stop_agent"');
    const nextIdx = src.indexOf('action === "create_agent"', stopIdx);
    expect(stopIdx).toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(stopIdx);
    const branch = src.slice(stopIdx, nextIdx);
    expect(branch).toContain("releaseStuckRunLock(queueKey)");
    expect(branch).toContain("runAgentsInFlightByProject[queueKey]");
    expect(branch).toContain("runAgentsQueueByProject[queueKey]");
    // La suite n'est jamais perdue en silence : un message est émis.
    expect(branch).toContain("mission(s) en attente annulée(s)");
  });
});

// POINT G — une mission mise en file a TOUJOURS un déclencheur de rejeu.
// Défaut : la file de missions n'était rejouée que par `settleRun` (fin de run du
// BUS). Une mission mise en file derrière une commande MANUELLE (qui n'inscrit
// aucune run dans le bus) restait donc bloquée pour toujours, alors que le
// message promettait un démarrage automatique. Ces tests ÉCHOUENT si le rejeu
// périodique disparaît, si l'admission n'est plus sondée, ou si un chemin de mise
// en file cesse d'armer le déclencheur.
describe("POINT G — rejeu garanti de la file de missions", () => {
  it("le contrôle de rejeu attend tant que le projet est occupé, puis lance la tête de file", async () => {
    const p = "point-g-rejeu";
    let launched = 0;
    runAgentsQueueByProject[p] = [{ launch: () => { launched++; } }];
    try {
      // Occupé (ex: une commande manuelle que le bus ne voit pas) → rien ne part.
      let free = false;
      let r = await replayQueuedMissionForProject(p, { isAdmissionFree: async () => free });
      expect(r).toEqual({ replayed: false, reason: "busy" });
      expect(launched).toBe(0);
      expect(runAgentsQueueByProject[p]).toHaveLength(1);
      // Libéré → la mission en file démarre RÉELLEMENT.
      free = true;
      r = await replayQueuedMissionForProject(p, { isAdmissionFree: async () => free });
      expect(r).toEqual({ replayed: true, reason: "launched" });
      expect(launched).toBe(1);
      expect(runAgentsQueueByProject[p] || []).toHaveLength(0);
    } finally {
      delete runAgentsQueueByProject[p];
    }
  });

  it("une sonde d'admission en échec ne perd pas la mission (fail-closed, on réessaie)", async () => {
    const p = "point-g-sonde-ko";
    let launched = 0;
    runAgentsQueueByProject[p] = [{ launch: () => { launched++; } }];
    try {
      const r = await replayQueuedMissionForProject(p, { isAdmissionFree: async () => { throw new Error("sonde HS"); } });
      expect(r.replayed).toBe(false);
      expect(launched).toBe(0);
      expect(runAgentsQueueByProject[p]).toHaveLength(1); // toujours en file
    } finally {
      delete runAgentsQueueByProject[p];
    }
  });

  // Preuve déterministe (horloge simulée) du scénario de la mission : une mission
  // mise en file derrière une COMMANDE MANUELLE (session busy, invisible du bus)
  // FINIT par démarrer dès que l'admission se libère.
  it("le déclencheur périodique rejoue la mission derrière une commande manuelle dès libération", async () => {
    vi.useFakeTimers();
    const p = "point-g-commande-manuelle";
    let launched = 0;
    runAgentsQueueByProject[p] = [{ launch: () => { launched++; } }];
    try {
      // Commande manuelle en cours sur ce projet : sa session est busy → le bus
      // ne la voit pas, mais la sonde d'activité réelle (`isRunStillActive`) oui.
      invoke.mockResolvedValue({
        sessions: [{ project: p, alive: true, busy: true, lastActivity: new Date().toISOString() }],
      });
      armQueueReplay(p);
      await vi.advanceTimersByTimeAsync(16000);
      expect(launched, "occupé : la mission ne doit PAS démarrer").toBe(0);
      expect(runAgentsQueueByProject[p]).toHaveLength(1);
      // Commande manuelle terminée → admission libre : le rejeu démarre la file.
      invoke.mockResolvedValue({ sessions: [] });
      await vi.advanceTimersByTimeAsync(16000);
      expect(launched, "libéré : la mission en file doit démarrer").toBe(1);
    } finally {
      vi.useRealTimers();
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      delete runAgentsQueueByProject[p];
    }
  });

  it("les trois chemins de mise en file arment le rejeu, et plus aucun message ne promet un faux délai", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    // 1. run_agents — filet d'attente du lancement différé (launchOrQueue).
    const loq = src.slice(src.indexOf("const launchOrQueue = async () => {"), src.indexOf("const reportDeferredLaunch"));
    expect(loq).toContain("runAgentsQueueByProject[target].push(");
    expect(loq).toContain("armQueueReplay(target)");
    // 2. run_agents — garde de démarrage (startRun).
    const srIdx = src.indexOf("const startRun = async () => {");
    const sr = src.slice(srIdx, src.indexOf("const launchResult = await startRun();", srIdx));
    expect(sr).toContain("runAgentsQueueByProject[target].push(");
    expect(sr).toContain("armQueueReplay(target)");
    // 3. run_assistant_agents — même déclencheur (aucun watchdog d'assistant).
    const aIdx = src.indexOf("const target = ASSISTANT_SPACE;");
    const aSrIdx = src.indexOf("const startRun = async () => {", aIdx);
    const aSr = src.slice(aSrIdx, src.indexOf("const launchedNow = await startRun();", aSrIdx));
    expect(aSr).toContain("runAgentsQueueByProject[target].push(");
    expect(aSr).toContain("armQueueReplay(target)");
    // Plus de promesse de délai intenable (« à la fin de la tâche en cours »).
    expect(src).not.toContain("je la mets en file d'attente et la lancerai dès la fin de la tâche en cours");
    expect(src).not.toContain("la demande est mise en file et se lancera automatiquement");
    expect(src).not.toContain("La demande est mise en file d'attente et se lancera automatiquement");
  });

  // R1 (relecture indépendante) : une passe RÉUSSIE ne retire qu'UNE mission de
  // la file. Avant le correctif, le déclencheur ne se réarmait qu'en cas
  // d'ÉCHEC (`!r.replayed`) : avec deux missions en file, la seconde perdait
  // TOUT déclencheur dès que la première était lancée. Ce test ÉCHOUE si l'on
  // revient à `if (!r.replayed && ...)`, ou si le réarmement disparaît.
  it("R1 : une passe réussie sur deux missions laisse un déclencheur armé pour la seconde", async () => {
    vi.useFakeTimers();
    const p = "r1-file-missions";
    let launched = 0;
    runAgentsQueueByProject[p] = [
      { launch: () => { launched++; } },
      { launch: () => { launched++; } },
    ];
    try {
      invoke.mockResolvedValue({ sessions: [] }); // admission libre
      armQueueReplay(p);
      await vi.advanceTimersByTimeAsync(16000);
      expect(launched, "1re mission lancée par la passe").toBe(1);
      expect(runAgentsQueueByProject[p]).toHaveLength(1);
      // La passe a RÉUSSI : le déclencheur doit malgré tout s'être réarmé.
      await vi.advanceTimersByTimeAsync(16000);
      expect(launched, "2e mission lancée par le déclencheur réarmé").toBe(2);
      expect(runAgentsQueueByProject[p] || []).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      delete runAgentsQueueByProject[p];
    }
  });
});

describe("POINT C — rejeu garanti de la file de DÉLÉGATIONS (issue #66)", () => {
  const P = "point-c-delegations";
  const resetDs = () => {
    const ds = delegationState(P);
    ds.queue.length = 0;
    ds.busy = false;
    ds.pending = null;
  };
  afterEach(resetDs);

  it("ne transmet PAS tant que l'agent cible travaille, puis transmet dès qu'il est libre", async () => {
    const ds = delegationState(P);
    ds.queue.push({ request: "r", projectPath: P, agentId: "a" });
    let free = false;
    let flushed = 0;
    const flush = () => { flushed++; ds.queue.length = 0; };
    let r = await replayDelegationQueueForProject(P, { isAgentFree: async () => free, flush });
    expect(r).toEqual({ replayed: false, reason: "busy" });
    expect(flushed, "occupé : la demande ne doit PAS partir").toBe(0);
    expect(ds.queue, "la demande reste en file").toHaveLength(1);
    free = true;
    r = await replayDelegationQueueForProject(P, { isAgentFree: async () => free, flush });
    expect(r).toEqual({ replayed: true, reason: "flushed" });
    expect(flushed, "libéré : la demande en file est transmise").toBe(1);
  });

  it("une sonde en échec ne perd pas la demande (fail-closed)", async () => {
    const ds = delegationState(P);
    ds.queue.push({ request: "r", projectPath: P, agentId: "a" });
    let flushed = 0;
    const r = await replayDelegationQueueForProject(P, {
      isAgentFree: async () => { throw new Error("sonde HS"); },
      flush: () => { flushed++; ds.queue.length = 0; },
    });
    expect(r.replayed).toBe(false);
    expect(flushed).toBe(0);
    expect(ds.queue, "toujours en file").toHaveLength(1);
  });

  it("le chemin de mise en file de delegate_to_coder arme le rejeu (jamais de blocage silencieux)", () => {
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const idx = src.indexOf("ds.queue.push({ request, projectPath, agentId");
    expect(idx, "la mise en file de délégation doit exister").toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 600)).toContain("armDelegationQueueReplay(projectPath)");
  });

  it("le chemin distant (agent_prompt) ne court-circuite pas ce rejeu (pas de send_agent_command_to)", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/web_server.rs", import.meta.url), "utf8");
    const start = rust.indexOf("async fn agent_prompt(");
    const end = rust.indexOf("async fn superagent_prompt(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const route = rust.slice(start, end);
    // Le distant écrit dans la session principale, jamais dans la file de
    // délégations : c'est la sonde périodique ci-dessus qui relance la file.
    expect(route).toContain("do_send_agent_prompt");
    expect(route).not.toContain("send_agent_command_to");
  });

  // Verrou par projet côté DISTANT : le client web ne charge pas le bus
  // d'agents du desktop (`agents-bus.js`), donc la route `agent_prompt` doit
  // refuser un prompt arrivant sur un projet déjà occupé, AVANT d'écrire dans la
  // session, et avec le MÊME mécanisme que le dépôt inter-projets
  // (`project_has_working_agent`) — jamais un second verrou parallèle. Ce test
  // ÉCHOUE si la garde disparaît ou passe après l'envoi.
  it("le prompt distant passe par la porte du verrou par projet avant l'envoi", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/web_server.rs", import.meta.url), "utf8");
    const start = rust.indexOf("async fn agent_prompt(");
    const end = rust.indexOf("async fn superagent_prompt(", start);
    const route = rust.slice(start, end);
    const guardIdx = route.indexOf("ensure_web_project_not_busy(st.inner())");
    const sendIdx = route.indexOf("do_send_agent_prompt(st.inner(), message, images)");
    expect(guardIdx, "garde du verrou par projet absente de la route distante").toBeGreaterThan(-1);
    expect(sendIdx, "envoi distant absent").toBeGreaterThan(-1);
    expect(guardIdx, "la garde doit précéder l'envoi").toBeLessThan(sendIdx);
    // MÊME mécanisme que les autres chemins (pas un second verrou parallèle).
    const helperIdx = rust.indexOf("fn ensure_web_project_not_busy(");
    expect(helperIdx, "porte du verrou absente").toBeGreaterThan(-1);
    const helper = rust.slice(helperIdx, rust.indexOf("async fn superagent_prompt(", helperIdx));
    expect(helper).toContain("project_has_working_agent");
  });

  // R1 : même garantie de réarmement que la file de missions, sur la file de
  // délégations. Le gestionnaire d'onglets est volontairement absent : `flush`
  // ne peut pas vider la file, donc la passe « réussit » sans rien consommer —
  // un déclencheur doit rester armé après elle. Ce test ÉCHOUE si l'on revient
  // à `if (!r.replayed && ...)` (aucun timer réarmé).
  it("R1 : une passe réussie laisse un déclencheur armé tant qu'il reste des demandes", async () => {
    vi.useFakeTimers();
    const ds = delegationState(P);
    const prevTabs = window._pilotTabs;
    window._pilotTabs = undefined; // pas de gestionnaire d'onglets
    ds.queue.push({ request: "r1-a", projectPath: P, agentId: "a" });
    ds.queue.push({ request: "r1-b", projectPath: P, agentId: "a" });
    try {
      invoke.mockResolvedValue({ sessions: [] }); // agent libre
      armDelegationQueueReplay(P);
      await vi.advanceTimersByTimeAsync(16000);
      expect(ds.queue, "demandes toujours en file").toHaveLength(2);
      expect(vi.getTimerCount(), "un declencheur doit rester arme").toBeGreaterThan(0);
    } finally {
      window._pilotTabs = prevTabs;
      vi.useRealTimers();
      invoke.mockReset();
      invoke.mockResolvedValue(undefined);
      resetDs();
    }
  });

  // R10 : si le gestionnaire d'onglets est indisponible, l'élément de tête ne
  // doit PAS être consommé puis perdu (seul chemin qui perdait une demande).
  // Ce test ÉCHOUE si `flushDelegationQueue` fait `shift()` avant de tester
  // `tabs` : la demande aurait disparu de la file.
  it("R10 : onglets indisponibles → la demande reste en file (jamais perdue)", async () => {
    const ds = delegationState(P);
    const prevTabs = window._pilotTabs;
    window._pilotTabs = undefined;
    ds.queue.push({ request: "r10", projectPath: P, agentId: "a", agentTabOpen: true });
    try {
      const r = await replayDelegationQueueForProject(P, { isAgentFree: async () => true });
      expect(r.replayed).toBe(true);
      expect(ds.queue, "la demande reste en file").toHaveLength(1);
    } finally {
      window._pilotTabs = prevTabs;
      resetDs();
    }
  });
});

// POINT G (suite) — le bouton « Refaire » du dialogue de boucle renvoie un
// prompt à l'agent : il doit passer par la politique d'admission, AVANT la
// nouvelle session (sinon un refus détruirait la conversation sans rien
// relancer). Ce test ÉCHOUE si la garde disparaît ou passe après la nouvelle
// session / l'envoi.
describe("POINT G — le bouton « Refaire » (dialogue de boucle) est gardé", () => {
  it("la garde précède l'envoi ET la nouvelle session, refus visible", () => {
    const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");
    const fnIdx = src.indexOf("function renderLoopAbandonChoices(");
    const nextIdx = src.indexOf("\n/**", fnIdx);
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, nextIdx > fnIdx ? nextIdx : undefined);
    const guardIdx = body.indexOf("canSendManualCommandAsync(");
    const sendIdx = body.indexOf('invoke("send_agent_prompt", { message: prompt })');
    const newSessionIdx = body.indexOf('invoke("new_agent_session")');
    expect(guardIdx, "garde absente").toBeGreaterThan(-1);
    expect(body).toContain("MANUAL_COMMAND_BLOCKED_MESSAGE");
    expect(sendIdx, "envoi absent").toBeGreaterThan(-1);
    expect(newSessionIdx, "nouvelle session absente").toBeGreaterThan(-1);
    expect(guardIdx, "la garde doit précéder l'envoi").toBeLessThan(sendIdx);
    expect(guardIdx, "la garde doit précéder la nouvelle session").toBeLessThan(newSessionIdx);
    // Le test « aucun prompt » est AVANT la garde (message exact, pas un faux refus).
    expect(body.indexOf("Aucun prompt à relancer")).toBeLessThan(guardIdx);
  });
});

// R2 (relecture indépendante) — le dépôt inter-projets DIFFÉRÉ n'est rejoué par
// aucun mécanisme : le message doit donc dire COMMENT reprendre la tâche, et la
// spec doit le dire aussi (pas de fausse promesse de rejeu). Ce test ÉCHOUE si
// le message perd la marche à suivre, ou si la spec la retire.
describe("R2 — le dépôt inter-projets différé dit comment reprendre", () => {
  it("le message backend et la spec indiquent la reprise manuelle", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/interproject.rs", import.meta.url), "utf8");
    const i = rust.indexOf("AUCUNE exécution n'a été lancée");
    expect(i).toBeGreaterThan(-1);
    const msg = rust.slice(i, i + 500);
    expect(msg).toContain("lire le fichier déposé");
    expect(msg).toContain("relancez le dépôt");
    const spec = readFileSync(new URL("../../spec_interproject.md", import.meta.url), "utf8");
    expect(spec).toContain("reprise manuelle");
    expect(spec).toContain("aucun rejeu automatique");
  });
});
