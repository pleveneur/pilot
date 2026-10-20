// Tests — TOUS les chemins d'arrêt AUTOMATIQUE d'agent laissent une trace écrite.
//
// RÈGLE 3 du projet : « une session ne peut pas disparaître sans trace écrite de
// sa raison d'arrêt ». Le journal `<projet>/.pilot/agent-stops.log` portait déjà
// les arrêts par boucle détectée ; ce fichier verrouille les DEUX garanties qui
// manquaient, et interdit la régression :
//
//   1. MATRICE DES SITES (analyse de source) — chaque site terminAL d'arrêt
//      (`abort_agent_process`, `stopAgentsRun`, `settleWatchdogRelease`,
//      `settleMission(..., "stop")`) doit être couvert par une trace de motif
//      écrite AVANT l'arrêt, avec un `reason` littéral non vide. La LISTE des
//      sites est ÉPINGLÉE : un nouveau site d'arrêt muet fait échouer le test de
//      cardinalité au lieu de passer inaperçu.
//   2. COMPORTEMENT — timeout d'inactivité, plafond de tours pi et arrêt
//      automatique émis par Rust (moniteur d'anomalie) écrivent bien une ligne,
//      et l'écriture précède l'arrêt effectif (abort).
//   3. NON-SILENCE — sans chemin de projet (ou si l'écriture échoue), la ligne
//      part dans le journal GLOBAL `<app_data_dir>/agent-stops.log` ; si même
//      cela échoue, l'échec est DIT (rapporteur/notify), jamais muet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Environnement Tauri simulé ────────────────────────────────────────────────
// `events` conserve TOUS les appels IPC dans l'ordre : il sert de preuve
// d'ordre (« la trace est écrite AVANT abort_agent_process »).
const events = [];
const listeners = {};
let config = {};
let appDataDirPath = "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor";
let failWrites = null; // (path) => true : l'écriture échoue

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args) => {
    const path = String((args && args.path) || "");
    events.push({ cmd, path, content: String((args && args.content) || "") });
    if (cmd === "get_config") return config;
    if (cmd === "list_agents") return { agents: [] };
    if (cmd === "read_file_content") return "";
    if (cmd === "write_file_content") {
      if (failWrites && failWrites(path)) throw new Error("écriture impossible");
      return undefined;
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, cb) => {
    listeners[name] = cb;
    return () => {};
  }),
}));

// Répertoire de données de l'application (journal GLOBAL de repli).
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => appDataDirPath),
}));

import { initAgentsBus, beginRun, endRun, handleAgentEvent, destroyAgentsBus } from "./agents-bus.js";
import {
  traceAutomaticAgentStop,
  setAgentStopTraceFailureReporter,
  agentStopTracePath,
  globalAgentStopTracePath,
} from "./agent-stop-trace.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Écritures du journal des arrêts (ordre d'émission). */
const traceWrites = () =>
  events.filter((e) => e.cmd === "write_file_content" && e.path.endsWith("agent-stops.log"));

/** Indices des appels IPC (ordre global) pour prouver l'antériorité. */
const indexOfTrace = () => events.findIndex((e) => e.cmd === "write_file_content" && e.path.endsWith("agent-stops.log"));
const indexOfAbort = () => events.findIndex((e) => e.cmd === "abort_agent_process");

beforeEach(() => {
  events.length = 0;
  for (const k of Object.keys(listeners)) delete listeners[k];
  config = {};
  failWrites = null;
  appDataDirPath = "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor";
  setAgentStopTraceFailureReporter(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  destroyAgentsBus();
  for (const key of ["projet-timeout", "projet-turncap", "projet-auto-stop", "projet-ko"]) {
    endRun("C:\\p\\" + key);
    endRun("C:\\p\\" + key);
  }
  setAgentStopTraceFailureReporter(null);
  vi.restoreAllMocks();
});

/** Pose une run en cours avec un agent actif et courant. */
function beginSingleAgentRun(project, agentId) {
  const ctx = beginRun(project);
  ctx.activeAgents.add(agentId);
  ctx.agentProject[agentId] = project;
  ctx.currentAgentId = agentId;
  return ctx;
}

// ── 1. Matrice des sites terminaux (analyse de source) ────────────────────────
describe("matrice des sites d'arrêt — aucun chemin automatique muet", () => {
  const SRC = readFileSync(new URL("./agents-bus.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  // Marqueurs acceptés comme preuve qu'une trace de motif est écrite AVANT le
  // site terminal. Trois formes, toutes avec un `reason` NON VIDE :
  //  - littéral au site : `traceAutomaticAgentStop({ reason: "…" })` /
  //    `traceAutomaticAgentStopForRun(ctx, { reason: "…" })` ;
  //  - motif transmis à l'appel : `stopAgentsRun({ …, reason: "…" })` — la
  //    mécanique d'arrêt attend la trace avant de couper (vérifié plus bas) ;
  //  - trace interne au callee (watchdog / stopAgentsRun), vérifié par corps.
  const TRACE_LITERAL = /traceAutomaticAgentStop[A-Za-z]*\(\s*(?:ctx,\s*)?\{[^}]{0,400}?reason:\s*"[^"]+"/;
  const TRACE_ANY = /traceAutomaticAgentStop[A-Za-z]*\(\s*(?:ctx,\s*)?\{[^}]{0,400}?reason:\s*[A-Za-z_$][\w$.]*/;
  const CALL_LITERAL_REASON = /reason:\s*"[a-z][a-z0-9-]+"/;

  /** Toutes les positions d'un motif dans la source (définitions exclues). */
  const positions = (re, definitionMarker) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(SRC))) {
      if (definitionMarker) {
        // Le marqueur commence AVANT le motif : on regarde autour de la position.
        const around = SRC.slice(Math.max(0, m.index - 60), m.index + 40);
        if (around.includes(definitionMarker)) continue;
      }
      out.push(m.index);
    }
    return out;
  };

  /** Corps d'une fonction (définition → bloc suivant), pour les traces internes. */
  const bodyOf = (defText) => {
    const start = SRC.indexOf(defText);
    if (start < 0) return "";
    const next = SRC.indexOf("\nexport ", start + defText.length);
    return SRC.slice(start, next < 0 ? SRC.length : next);
  };

  const stopRunBody = bodyOf("export async function stopAgentsRun");
  const watchdogBody = bodyOf("async function settleWatchdogRelease(");

  it("stopAgentsRun trace (et attend la trace) AVANT de régler/abort la run", () => {
    const iTrace = stopRunBody.indexOf("await traceAutomaticAgentStopForRun(ctx, { reason: autoStopReason");
    const iSettle = stopRunBody.indexOf('settleMission(ctx.runKey, "stop"');
    const iAbort = stopRunBody.indexOf('invoke("abort_agent_process"');
    expect(iTrace, "trace absente de stopAgentsRun").toBeGreaterThan(-1);
    expect(iSettle).toBeGreaterThan(-1);
    expect(iAbort).toBeGreaterThan(-1);
    // Antériorité STRICTE : la ligne est écrite (await) avant l'arrêt effectif.
    expect(iTrace).toBeLessThan(iSettle);
    expect(iTrace).toBeLessThan(iAbort);
    // Le détecteur par défaut du mécanisme d'arrêt reste « stop-run ».
    expect(stopRunBody).toContain("detected: autoStopDetected");
    expect(stopRunBody).toContain(': "stop-run";');
  });

  it("le watchdog trace son motif (avec la PORTE) AVANT de libérer le verrou", () => {
    const iTrace = watchdogBody.indexOf('reason: "watchdog-release"');
    const iSettle = watchdogBody.indexOf('settleMission(ctx.runKey, "done"');
    expect(iTrace, "trace absente du watchdog").toBeGreaterThan(-1);
    expect(iSettle).toBeGreaterThan(-1);
    expect(iTrace).toBeLessThan(iSettle);
    // La porte qui a tiré (timeGuard, …) est journalisée comme détecteur.
    expect(watchdogBody).toContain("detected: door");
  });

  it("chaque site terminal est couvert par une trace de motif (liste épinglée)", () => {
    const abortSites = positions(/invoke\("abort_agent_process"/g);
    const stopRunSites = positions(/stopAgentsRun\(/g, "async function stopAgentsRun");
    const watchdogSites = positions(/settleWatchdogRelease\(/g, "async function settleWatchdogRelease");
    const settleStopSites = positions(/settleMission\(ctx\.runKey, "stop"/g);

    // Cardinalité ÉPINGLÉE : un nouveau site d'arrêt (donc potentiellement muet)
    // fait échouer ce test — il faut alors lui ajouter sa trace et mettre à jour
    // ces nombres, jamais ajouter un arrêt silencieux.
    expect(abortSites).toHaveLength(3);
    expect(stopRunSites).toHaveLength(3);
    expect(watchdogSites).toHaveLength(2);
    expect(settleStopSites).toHaveLength(3);

    const stopRunStart = SRC.indexOf("export async function stopAgentsRun");
    const insideStopRun = (i) => i > stopRunStart;
    const watchdogTracesInsideCallee = TRACE_LITERAL.test(watchdogBody);
    expect(watchdogTracesInsideCallee, "le watchdog ne trace pas son motif").toBe(true);

    const check = (site, kind) => {
      const window = SRC.slice(Math.max(0, site - 1600), site);
      const call = SRC.slice(site, site + 220);
      const literalTrace = TRACE_LITERAL.test(window);
      const callerReason = CALL_LITERAL_REASON.test(call) && stopRunBody.includes("await traceAutomaticAgentStop");
      const internalTrace =
        insideStopRun(site) && TRACE_ANY.test(window) && stopRunBody.includes("await traceAutomaticAgentStopForRun");
      const calleeTrace = kind === "settleWatchdogRelease" && watchdogTracesInsideCallee;
      expect(
        literalTrace || callerReason || internalTrace || calleeTrace,
        `${kind} muet à la position ${site} : aucune trace de motif avant l'arrêt`,
      ).toBe(true);
    };

    for (const site of abortSites) check(site, "abort_agent_process");
    for (const site of stopRunSites) check(site, "stopAgentsRun");
    for (const site of watchdogSites) check(site, "settleWatchdogRelease");
    for (const site of settleStopSites) check(site, 'settleMission(..., "stop")');
  });

  it("les motifs sont des LITTÉRAUX non vides (une ligne par chemin)", () => {
    // Une trace doit toujours dire POURQUOI. Un `reason` vide/absent ne
    // journalise rien d'exploitable : chaque chemin a son motif littéral.
    const expected = {
      "idle-timeout": 1,
      "turn-cap": 1,
      "loop-detection": 4,
      "auto-stop-rust": 2,
      "busy-stale-release": 2,
      "watchdog-release": 1,
      "sweep-stopping-release": 1,
      "force-release": 1,
    };
    for (const [reason, count] of Object.entries(expected)) {
      const found = (SRC.match(new RegExp(`reason: "${reason}"`, "g")) || []).length;
      expect(found, `motif "${reason}" attendu ${count} fois, trouvé ${found}`).toBe(count);
    }
    // Détecteurs attendus pour les deux chemins automatiques explicites.
    expect(SRC).toContain('reason: "idle-timeout", detected: "no-event"');
    expect(SRC).toContain('reason: "turn-cap", detected: "pi-turns"');
  });

  it("le module de trace ne renonce plus en silence quand le chemin est vide", () => {
    const trace = readFileSync(new URL("./agent-stop-trace.js", import.meta.url), "utf8");
    // Repli global présent (journal `<app_data_dir>/agent-stops.log`).
    expect(trace).toContain("globalAgentStopTracePath");
    expect(trace).toContain("appDataDir");
    // L'échec est signalé (jamais un simple `return` muet).
    expect(trace).toContain("reportAgentStopTraceFailure");
  });
});

// ── 1 bis. Matrice ÉTENDUE aux TROIS fichiers d'arrêt automatique ───────────
// L'audit indépendant a montré que la matrice d'origine n'inspectait QU'UN
// fichier (`agents-bus.js`) : un arrêt automatique muet ajouté dans l'onglet
// agent principal (`agent-pi.js`) ou dans l'Assistant (`super-agent.js`)
// passait inaperçu. Cette matrice lit les TROIS sources, avec :
//   • une cardinalité ÉPINGLÉE par fichier et par type de site (un nouveau site,
//     muet ou non, fait échouer le test) ;
//   • la PRÉCÉDENCE À PORTÉE DE BLOC : la trace du motif doit précéder le site
//     terminal SANS qu'un autre arrêt du même type s'intercale (donc dans le
//     même bloc, pas « quelque part avant dans le fichier ») ;
//   • la liste EXPLICITE des sites hors famille (arrêts de TOUR : orchestration,
//     reprise après compaction, arrêt manuel, test de modèle) — ils ne terminent
//     pas la session et n'ont donc pas de ligne de journal.
describe("matrice étendue — les trois fichiers d'arrêt automatique", () => {
  const SRC_PI = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const SRC_SA = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const SRC_BUS = readFileSync(new URL("./agents-bus.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  /** Motif d'appel de trace (forme littérale ET forme transmise à la run). */
  const TRACE_SRC = "traceAutomaticAgentStop[A-Za-z]*[(]";

  /** Positions d'un motif dans une source. */
  const positionsIn = (src, re) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) out.push(m.index);
    return out;
  };

  /**
   * Vérifie la PRÉCÉDENCE À PORTÉE DE BLOC : pour chaque site terminal, une trace
   * de motif doit exister ENTRE le site précédent (même type) et ce site. Une
   * trace placée « ailleurs dans le fichier » ne compte pas.
   * @param {string} src
   * @param {RegExp} siteRe
   * @param {string} label
   * @returns {{sites:number, traced:number, untraced:number[]}}
   */
  function precedences(src, siteRe, label) {
    const sites = positionsIn(src, siteRe);
    const traces = positionsIn(src, new RegExp(TRACE_SRC, "g"));
    const untraced = [];
    let traced = 0;
    sites.forEach((site, i) => {
      const from = i === 0 ? 0 : sites[i - 1];
      if (traces.some((t) => t > from && t < site)) traced++;
      else untraced.push(site);
    });
    return { sites: sites.length, traced, untraced, label };
  }

  it("agents-bus.js : TOUS les sites terminaux sont tracés dans leur bloc", () => {
    const kinds = [
      [/invoke\("abort_agent_process"/g, "abort_agent_process", 3],
      // Les deux arrêts de processus ajoutés par la fermeture des faux verrous
      // (session périmée → redémarrage ; échec de lancement → nettoyage).
      [/invoke\("stop_agent_process"/g, "stop_agent_process", 2],
      [/settleMission\(ctx\.runKey, "stop"/g, 'settleMission(..., "stop")', 3],
    ];
    for (const [re, label, expected] of kinds) {
      const res = precedences(SRC_BUS, re, label);
      expect(res.sites, `${label} : cardinalité changée`).toBe(expected);
      expect(res.untraced, `${label} : site terminal MUET (aucune trace dans son bloc)`).toEqual([]);
    }
  });

  it("agent-pi.js : les arrêts de SESSION sont tracés, les arrêts de TOUR sont comptés", () => {
    // Famille « session » = les deux arrêts sur boucle détectée (réflexion et
    // actions). Ce sont les seuls sites de ce fichier qui terminent la run sans
    // action de l'utilisateur.
    const loopText = SRC_PI.indexOf('detected: "text"');
    const loopActions = SRC_PI.indexOf('detected: "actions"');
    expect(loopText, "trace de la boucle de réflexion absente de l'onglet agent").toBeGreaterThan(-1);
    expect(loopActions, "trace de la boucle d'actions absente de l'onglet agent").toBeGreaterThan(-1);
    expect(SRC_PI).toContain('reason: "loop-detection",');
    // Chaque trace est SUIVIE de l'arrêt effectif, dans le même bloc.
    const aborts = positionsIn(SRC_PI, /invoke\("abort_agent"\)/g);
    for (const traceAt of [loopText, loopActions]) {
      const next = aborts.find((a) => a > traceAt);
      expect(next, "trace de boucle sans arrêt effectif après elle").toBeDefined();
      expect(next - traceAt, "l'arrêt doit suivre immédiatement sa trace").toBeLessThan(400);
    }
    // Cardinalité ÉPINGLÉE : 2 arrêts de SESSION tracés + 11 arrêts de TOUR ou
    // manuels (orchestration : timeouts, subdivisions, reprise après compaction,
    // erreur de connexion ; arrêt manuel ; test de modèle). Un NOUVEL arrêt
    // change ce nombre → il faut décider sa famille et le tracer s'il termine
    // une session.
    expect(aborts, "un arrêt a été ajouté/retiré dans l'onglet agent sans décision de famille").toHaveLength(13);
  });

  it("super-agent.js : les deux arrêts sur boucle sont tracés (outils ET texte)", () => {
    const aborts = positionsIn(SRC_SA, /invoke\("abort_super_agent"\)/g);
    expect(aborts, "cardinalité des arrêts de l'Assistant changée").toHaveLength(3);
    const traces = positionsIn(SRC_SA, new RegExp(TRACE_SRC, "g"));
    const traced = aborts.filter((a) => traces.some((t) => t < a && a - t < 1500));
    expect(traced, "les deux arrêts automatiques de l'Assistant doivent être tracés").toHaveLength(2);
    // Les deux motifs sont DISTINCTS (boucle d'outils vs boucle de texte).
    expect(SRC_SA).toContain('detected: "tool-calls"');
    expect(SRC_SA).toContain('detected: "text"');
  });

  it("le nombre de traces par fichier est épinglé (dérive = rouge)", () => {
    const traceRe = () => new RegExp(TRACE_SRC, "g");
    const counts = {
      bus: positionsIn(SRC_BUS, traceRe()).length,
      pi: positionsIn(SRC_PI, traceRe()).length,
      sa: positionsIn(SRC_SA, traceRe()).length,
    };
    expect(counts.pi, "l'onglet agent doit tracer ses deux arrêts automatiques").toBe(2);
    expect(counts.sa, "traces de l'assistant").toBe(4);
    expect(counts.bus, "traces du bus").toBeGreaterThanOrEqual(18);
  });

  it("un site terminal ajouté sans trace fait échouer la matrice (preuve du contrôle)", () => {
    // Contrôle NÉGATIF du test lui-même : on injecte un site terminal MUET dans
    // une COPIE de la source et on vérifie que la détection le voit. Si ce test
    // passe au vert avec un site muet injecté, la matrice ne prouve plus rien.
    const fake = SRC_BUS.replace(
      "async function forceStaleAgentProcessRestartIfNeeded",
      'async function fakeSilentStop() { await invoke("abort_agent_process", { agentId: "x" }); }\nasync function forceStaleAgentProcessRestartIfNeeded',
    );
    expect(fake, "injection impossible : ancre introuvable").not.toBe(SRC_BUS);
    const res = precedences(fake, /invoke\("abort_agent_process"/g, "fake");
    expect(res.sites, "le site injecté n'est pas vu").toBe(4);
    expect(res.untraced.length, "la matrice doit voir le site muet injecté").toBe(1);
  });
});

// ── 2. Comportement : la ligne est écrite AVANT l'arrêt effectif ─────────────
describe("chemins d'arrêt automatique — une ligne par arrêt, écrite AVANT l'arrêt", () => {
  it("timeout d'inactivité → reason=idle-timeout / detected=no-event AVANT l'abort", async () => {
    config = { agent_timeout_ms: 40 };
    await initAgentsBus({});
    const P = "C:\\p\\projet-timeout";
    beginSingleAgentRun(P, "codeur");
    events.length = 0;

    handleAgentEvent({ payload: { project: P, agent_id: "codeur", event: { type: "agent_start" } } });
    await sleep(300);

    const written = traceWrites();
    expect(written, "aucune trace écrite pour le timeout d'inactivité").toHaveLength(1);
    expect(written[0].path).toBe(agentStopTracePath(P));
    expect(written[0].content).toContain("reason=idle-timeout");
    expect(written[0].content).toContain("detected=no-event");
    expect(written[0].content).toContain("agent=codeur");
    // Antériorité : la trace précède l'arrêt effectif.
    expect(indexOfTrace()).toBeGreaterThan(-1);
    expect(indexOfAbort(), "l'agent n'a pas été arrêté").toBeGreaterThan(-1);
    expect(indexOfTrace()).toBeLessThan(indexOfAbort());
  });

  it("plafond de tours pi → reason=turn-cap / detected=pi-turns AVANT l'abort", async () => {
    config = { agent_timeout_ms: 60000, agent_max_turns: 1 };
    await initAgentsBus({});
    const P = "C:\\p\\projet-turncap";
    beginSingleAgentRun(P, "codeur");
    events.length = 0;

    handleAgentEvent({ payload: { project: P, agent_id: "codeur", event: { type: "turn_start" } } });
    handleAgentEvent({ payload: { project: P, agent_id: "codeur", event: { type: "turn_start" } } });
    await sleep(80);

    const written = traceWrites();
    expect(written, "aucune trace écrite pour le plafond de tours").toHaveLength(1);
    expect(written[0].content).toContain("reason=turn-cap");
    expect(written[0].content).toContain("detected=pi-turns");
    expect(indexOfAbort()).toBeGreaterThan(-1);
    expect(indexOfTrace()).toBeLessThan(indexOfAbort());
  });

  it("arrêt automatique émis par Rust (moniteur) → reason=auto-stop-rust", async () => {
    config = { agent_timeout_ms: 60000 };
    await initAgentsBus({});
    const P = "C:\\p\\projet-auto-stop";
    beginSingleAgentRun(P, "codeur");
    events.length = 0;

    const onAutoStop = listeners["agent-auto-stopped"];
    expect(typeof onAutoStop, "écouteur agent-auto-stopped non branché").toBe("function");
    await onAutoStop({ payload: { project: P, agent: "codeur", reason: "aucune progression" } });
    await sleep(20);

    const written = traceWrites();
    expect(written, "aucune trace écrite pour l'arrêt automatique Rust").toHaveLength(1);
    expect(written[0].content).toContain("reason=auto-stop-rust");
    expect(written[0].content).toContain("agent=codeur");
  });

  it("arrêt automatique Rust dont le ctx est introuvable → trace quand même (plus de `return` muet)", async () => {
    config = { agent_timeout_ms: 60000 };
    await initAgentsBus({});
    const P = "C:\\p\\projet-fantome"; // aucune run vivante pour cet agent
    events.length = 0;

    const onAutoStop = listeners["agent-auto-stopped"];
    await onAutoStop({ payload: { project: P, agent: "agent-inconnu", reason: "figé" } });
    await sleep(20);

    const written = traceWrites();
    expect(written, "un arrêt automatique orphelin est resté muet").toHaveLength(1);
    expect(written[0].content).toContain("reason=auto-stop-rust");
    expect(written[0].content).toContain("agent=agent-inconnu");
    expect(written[0].path).toBe(agentStopTracePath(P));
  });
});

// ── 3. Non-silence : sans projet, la trace va au journal GLOBAL ─────────────
describe("journal GLOBAL de repli — une trace perdue est impossible en silence", () => {
  it("projectPath vide → ligne écrite dans <app_data_dir>/agent-stops.log", async () => {
    events.length = 0;
    const ok = await traceAutomaticAgentStop({
      reason: "no-project",
      detected: "unit",
      agentId: "orphelin",
      projectPath: "",
    });
    expect(ok, "la trace a été perdue au lieu de partir au journal global").toBe(true);
    const written = traceWrites();
    expect(written).toHaveLength(1);
    expect(written[0].path).toBe(globalAgentStopTracePath(appDataDirPath));
    expect(written[0].content).toContain("reason=no-project");
    expect(written[0].content).toContain("agent=orphelin");
  });

  it("écriture dans le projet impossible → repli sur le journal GLOBAL (aucune perte)", async () => {
    failWrites = (path) => path.includes("projet-ko");
    events.length = 0;
    const ok = await traceAutomaticAgentStop({ reason: "project-write-ko", projectPath: "C:\\p\\projet-ko" });
    expect(ok).toBe(true);
    // La tentative sur le projet a échoué ; la ligne vit dans le journal GLOBAL.
    const globalPath = globalAgentStopTracePath(appDataDirPath);
    const written = traceWrites().filter((w) => w.path === globalPath);
    expect(written, "aucune ligne dans le journal global de repli").toHaveLength(1);
    expect(written[0].content).toContain("reason=project-write-ko");
  });

  it("toutes les écritures impossibles → l'échec est DIT (rapporteur branché sur notify)", async () => {
    failWrites = () => true;
    const reported = [];
    setAgentStopTraceFailureReporter((message) => reported.push(message));
    events.length = 0;
    const ok = await traceAutomaticAgentStop({ reason: "all-writes-ko", projectPath: "" });
    expect(ok).toBe(false);
    expect(reported, "un échec de journalisation est resté SILENCIEUX").toHaveLength(1);
    expect(reported[0]).toContain("non journalisé");
    expect(reported[0]).toContain("all-writes-ko");
  });
});
