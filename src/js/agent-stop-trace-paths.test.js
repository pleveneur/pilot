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
// Détecteur pur de l'ENTONNOIR UNIQUE : il vérifie, site par site, qu'aucun
// arrêt automatique n'invoque les commandes d'arrêt hors d'un appel
// `stopAgentWithTrace` (même instruction, même fonction englobante).
import { scanAutomaticStopSites } from "./agent-stop-funnel.js";

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
  // ENTONNOIR UNIQUE (`agent-stop-funnel.js`) : la trace et l'arrêt sont désormais
  // la MÊME instruction — `stopAgentWithTrace({ reason: "…", stop: () => invoke(…) })`.
  // Un appel d'entonnoir à motif littéral est donc une preuve de trace, au même
  // titre qu'un `traceAutomaticAgentStop` posé juste avant l'arrêt.
  const FUNNEL_LITERAL = /stopAgentWithTrace\(\{[\s\S]{0,600}?reason:\s*"[^"]+"/;
  const MANUAL_MARKER = "R3-EXCEPTION-MANUEL";

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
    // 4 = 2 détections de boucle + l'arrêt automatique de run (dans
    // `stopAgentsRun`, via l'entonnoir) + l'arrêt MANUEL du même mécanisme
    // (bouton « tout arrêter », exception déclarée, non journalisée).
    expect(abortSites).toHaveLength(4);
    expect(stopRunSites).toHaveLength(3);
    expect(watchdogSites).toHaveLength(2);
    expect(settleStopSites).toHaveLength(3);

    const stopRunStart = SRC.indexOf("export async function stopAgentsRun");
    const insideStopRun = (i) => i > stopRunStart;
    const watchdogTracesInsideCallee = TRACE_LITERAL.test(watchdogBody);
    expect(watchdogTracesInsideCallee, "le watchdog ne trace pas son motif").toBe(true);

    const check = (site, kind) => {
      // Arrêt VOLONTAIRE déclaré (bouton Stop) : hors du périmètre de la règle 3.
      if (SRC.slice(Math.max(0, site - 400), site).includes(MANUAL_MARKER)) return;
      const window = SRC.slice(Math.max(0, site - 1600), site);
      const call = SRC.slice(site, site + 220);
      const literalTrace = TRACE_LITERAL.test(window);
      const funnelTrace = FUNNEL_LITERAL.test(window);
      const callerReason = CALL_LITERAL_REASON.test(call) && stopRunBody.includes("await traceAutomaticAgentStop");
      const internalTrace =
        insideStopRun(site) && TRACE_ANY.test(window) && stopRunBody.includes("await traceAutomaticAgentStopForRun");
      const calleeTrace = kind === "settleWatchdogRelease" && watchdogTracesInsideCallee;
      expect(
        literalTrace || funnelTrace || callerReason || internalTrace || calleeTrace,
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
    // Détecteurs attendus pour les deux chemins automatiques explicites (le
    // motif est désormais porté par l'ENTONNOIR : même paire, autre forme).
    expect(SRC).toMatch(/reason: "idle-timeout",\s*\n\s*detected: "no-event"/);
    expect(SRC).toMatch(/reason: "turn-cap",\s*\n\s*detected: "pi-turns"/);
    // Aucun site d'arrêt automatique ne doit plus invoquer un IPC d'arrêt HORS
    // entonnoir : le détecteur de l'entonnoir le prouve (liste épinglée).
    const funnelScan = scanAutomaticStopSites(SRC);
    expect(funnelScan.untraced.map((s) => `${s.kind}@${s.line}`)).toEqual([]);
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
  // Les arrêts passent désormais par l'ENTONNOIR UNIQUE : `stopAgentWithTrace({…})`
  // est un point de trace à part entière (il écrit AVANT d'appeler l'arrêt).
  const TRACE_SRC = "(?:traceAutomaticAgentStop[A-Za-z]*|stopAgentWithTrace)[(]";

  /** Positions d'un motif dans une source. */
  const positionsIn = (src, re) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) out.push(m.index);
    return out;
  };

  /**
   * Paires d'accolades ouvrantes/fermantes de la source (`[[open, close], …]`).
   * Sert à délimiter un bloc LEXICALEMENT (comptage d'accolades), au lieu de
   * raisonner en distance dans le fichier.
   * @param {string} src
   * @returns {Array<[number, number]>}
   */
  function bracePairs(src) {
    const stack = [];
    const pairs = [];
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "{") stack.push(i);
      else if (src[i] === "}") {
        const open = stack.pop();
        if (open !== undefined) pairs.push([open, i]);
      }
    }
    return pairs;
  }

  const FUNCTION_HEADER_RE = /^[ \t]*(?:export\s+)?(?:async\s+)?function[ \t]+[A-Za-z0-9_$]+/m;

  /**
   * L'accolade ouvrante `open` appartient-elle à un EN-TÊTE DE FONCTION ?
   * Trois formes : en-tête sur une ligne (`function f(…) {`), fonction fléchée
   * affectée (`const f = async (…) => {`), et signature sur PLUSIEURS lignes
   * (l'accolade est seule sur sa ligne : on remonte chercher l'en-tête, sans
   * `{`, `}` ni `;` entre les deux).
   * @param {string} src
   * @param {number} open
   * @returns {boolean}
   */
  function isFunctionHeader(src, open) {
    const lineStart = src.lastIndexOf("\n", open) + 1;
    const header = src.slice(lineStart, open + 1).trim();
    if (/^(?:export\s+)?(?:async\s+)?function\b/.test(header)) return true;
    if (/=>\s*\{$/.test(header)) return true;
    if (header === "{" || header === "") {
      const back = src.slice(Math.max(0, open - 2000), open);
      const idx = back.search(FUNCTION_HEADER_RE);
      if (idx >= 0 && !/[;{}]/.test(back.slice(idx))) return true;
    }
    return false;
  }

  /**
   * BLOC LEXICAL ENGLOBANT d'un site : la fonction (la plus interne) qui contient
   * le site, délimitée en comptant les accolades depuis son en-tête — même
   * technique que `extractStatement` dans `regle-2-lectures-jamais-arret.test.js`.
   * @param {string} src
   * @param {Array<[number, number]>} pairs
   * @param {number} site
   * @returns {{start:number, end:number}|null}
   */
  function enclosingFunctionBlock(src, pairs, site) {
    const candidates = pairs
      .filter(([open, close]) => open < site && site < close && isFunctionHeader(src, open))
      .sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
    if (!candidates.length) return null;
    return { start: candidates[0][0], end: candidates[0][1] };
  }

  // Marqueur explicite des arrêts MANUELS (bouton Stop, action `stop_agent`) :
  // ce ne sont pas des arrêts automatiques, ils n'ont donc pas de ligne de
  // journal — et le test les déclare en exception NOMMÉE, jamais en silence.
  const EXCEPTION_MARKER = "R3-EXCEPTION-MANUEL";
  const isDeclaredException = (src, site) =>
    src.slice(Math.max(0, site - 700), site).includes(EXCEPTION_MARKER);

  /**
   * Vérifie la PRÉCÉDENCE À PORTÉE DE BLOC LEXICALE : pour chaque site terminal,
   * une trace de motif doit exister DANS LA FONCTION ENGLOBANTE, avant le site
   * (optionnellement à moins de `maxDistance` caractères).
   *
   * L'ancienne version comparait le site au site PRÉCÉDENT DU MÊME TYPE : une
   * trace lointaine suffisait, et un site muet injecté dans une fonction ne
   * contenant aucune trace passait pour tracé.
   * @param {string} src
   * @param {RegExp} siteRe
   * @param {string} label
   * @param {{maxDistance?:number}} [opts]
   * @returns {{sites:number, traced:number, untraced:number[], exceptions:number[], label:string}}
   */
  function precedences(src, siteRe, label, opts = {}) {
    const sites = positionsIn(src, siteRe);
    const traces = positionsIn(src, new RegExp(TRACE_SRC, "g"));
    const pairs = bracePairs(src);
    const max = typeof opts.maxDistance === "number" ? opts.maxDistance : Infinity;
    const untraced = [];
    const exceptions = [];
    let traced = 0;
    for (const site of sites) {
      const block = enclosingFunctionBlock(src, pairs, site);
      const before = block
        ? traces.filter((t) => t > block.start && t < site && site - t <= max)
        : [];
      if (before.length > 0) traced++;
      else if (isDeclaredException(src, site)) exceptions.push(site);
      else untraced.push(site);
    }
    return { sites: sites.length, traced, untraced, exceptions, label };
  }

  it("agents-bus.js : TOUS les sites terminaux sont tracés dans leur bloc", () => {
    const kinds = [
      // 2 boucles + 1 arrêt automatique de run (entonnoir) + 1 arrêt MANUEL
      // déclaré (R3-EXCEPTION-MANUEL : bouton « tout arrêter »).
      [/invoke\("abort_agent_process"/g, "abort_agent_process", 4],
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

  it("agents-bus.js : chaque FIN DE SESSION par erreur est tracée (les 5 `failAgentTurn`)", () => {
    // `failAgentTurn` prononce la fin de la session d'un agent : un site qui
    // l'appelle sans avoir rien écrit est une session qui s'éteint sans motif
    // (auparavant : erreur d'envoi de correction, processus mort, erreur de
    // message, modèle absent, exception du tour).
    const res = precedences(SRC_BUS, /^[ \t]*(?:await )?failAgentTurn\(/gm, "failAgentTurn", {
      // Le bloc est celui de `handleAgentEvent`/`runAgentTurn` (grand bloc) : la
      // trace doit être CELLE du chemin, pas une trace lointaine du même bloc.
      maxDistance: 800,
    });
    expect(res.sites, "un appel `failAgentTurn` a été ajouté/retiré").toBe(9);
    expect(res.untraced, "fin de session par erreur restée MUETTE").toEqual([]);
    expect(res.traced).toBe(9);
    // Les quatre motifs de fin par erreur sont explicites (jamais un texte vide).
    for (const motif of ["session-error", "spawn-failed", "model-missing", "run-exception"]) {
      expect(SRC_BUS, `motif de fin de session absent : ${motif}`).toContain(`"${motif}"`);
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
    // Le 3e arrêt est le bouton Stop (arrêt MANUEL) : déclaré en exception nommée.
    const manual = precedences(SRC_SA, /invoke\("abort_super_agent"\)/g, "abort_super_agent");
    expect(manual.exceptions, "l'arrêt manuel doit être déclaré en exception nommée").toHaveLength(1);
    expect(manual.untraced).toEqual([]);
  });

  it("`stop_agent_session` : chaque destruction de SESSION laisse une trace (ou est une exception nommée)", () => {
    // `stop_agent_session` détruit la session d'un agent. Les 3 sites de l'onglet
    // agent principal (bascule quality-gate, reconnexion, redémarrage après
    // changement de configuration) et le site de l'Assistant (arrêt automatique
    // d'un agent invisible) doivent être tracés ; l'arrêt MANUEL demandé par
    // l'Assistant est une exception explicite (marqueur R3-EXCEPTION-MANUEL).
    const pi = precedences(SRC_PI, /invoke\("stop_agent_session"/g, "stop_agent_session (pi)");
    expect(pi.sites, "sites `stop_agent_session` de l'onglet agent : cardinalité changée").toBe(3);
    expect(pi.untraced, "destruction de session MUETTE dans l'onglet agent").toEqual([]);
    expect(pi.traced).toBe(3);

    const sa = precedences(SRC_SA, /invoke\("stop_agent_session"/g, "stop_agent_session (sa)");
    expect(sa.sites, "sites `stop_agent_session` de l'Assistant : cardinalité changée").toBe(2);
    expect(sa.untraced, "destruction de session muette dans l'Assistant (hors exception nommée)").toEqual([]);
    expect(sa.traced).toBe(1);
    expect(sa.exceptions, "l'arrêt `stop_agent` (manuel) doit être déclaré en exception").toHaveLength(1);
  });

  it("le nombre de traces par fichier est épinglé (dérive = rouge)", () => {
    const traceRe = () => new RegExp(TRACE_SRC, "g");
    const counts = {
      bus: positionsIn(SRC_BUS, traceRe()).length,
      pi: positionsIn(SRC_PI, traceRe()).length,
      sa: positionsIn(SRC_SA, traceRe()).length,
    };
    // 2 arrêts sur boucle + 3 destructions de session (quality-gate, reconnexion,
    // redémarrage après changement de configuration).
    expect(counts.pi, "l'onglet agent doit tracer ses arrêts automatiques ET ses destructions de session").toBe(5);
    // 3 arrêts automatiques restants (boucle outils, boucle texte, …) + le
    // point UNIQUE d'écriture des abandons de file (`traceQueueAbandon`, règle
    // 4) : les QUATRE chemins d'abandon de file (missions/délégations, variante
    // synchrone / variante tracée) y passent, donc un nouveau chemin d'abandon
    // ne peut ni oublier la trace ni journaliser en double.
    expect(counts.sa, "traces de l'assistant").toBe(4);
    // 18 traces existantes + 5 fins de session par erreur du bus = 23, MOINS les
    // 5 traces absorbées par l'ENTONNOIR UNIQUE (2 boucles, 1 plafond MAX_TURNS,
    // 1 session périmée, 1 nettoyage post-spawn) = 18, PLUS 1 ajoutée depuis
    // (arrêt auto de run devenu tracé dans le mécanisme) = 19 traces explicites.
    expect(positionsIn(SRC_BUS, /traceAutomaticAgentStop[A-Za-z]*[(]/g).length, "traces explicites du bus").toBe(19);
    // Points de trace de l'entonnoir : 2 boucles + 1 timeout + 1 plafond pi +
    // 1 plafond MAX_TURNS + 1 arrêt auto de run + 1 session périmée + 1 nettoyage.
    expect(positionsIn(SRC_BUS, /stopAgentWithTrace[(]/g).length, "appels d'entonnoir du bus").toBe(8);
    // Total des points de trace du bus (traces explicites + entonnoir) : épinglé.
    expect(counts.bus, "points de trace du bus").toBe(27);
  });

  it("un site terminal ajouté sans trace fait échouer la matrice (preuve du contrôle)", () => {
    // Contrôle NÉGATIF du test lui-même : on injecte un site terminal MUET dans
    // une COPIE de la source, à QUATRE positions différentes (dont une où une
    // trace existe ailleurs dans le fichier, mais pas dans le bloc). Si ce test
    // passe au vert avec un site muet injecté, la matrice ne prouve plus rien.
    const silentStop =
      'async function fakeSilentStop() { await invoke("abort_agent_process", { agentId: "x" }); }\n';
    for (const anchor of [
      "async function runAgentTurn",
      "export async function startAgentsRun",
      "async function failAgentTurn",
      "async function forceStaleAgentProcessRestartIfNeeded",
    ]) {
      const fake = SRC_BUS.replace(anchor, silentStop + anchor);
      expect(fake, `injection impossible : ancre introuvable (${anchor})`).not.toBe(SRC_BUS);
      const res = precedences(fake, /invoke\("abort_agent_process"/g, `fake@${anchor}`);
      expect(res.sites, `le site injecté avant ${anchor} n'est pas vu`).toBe(5);
      expect(res.untraced.length, `la matrice doit voir le site muet injecté avant ${anchor}`).toBe(1);
      expect(res.traced, `les 4 vrais sites doivent rester tracés (${anchor})`).toBe(4);
    }
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
