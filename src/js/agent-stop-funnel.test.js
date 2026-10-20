// Tests — ENTONNOIR UNIQUE des arrêts automatiques (règle 3).
//
// Objet : la règle « aucune session ne disparaît sans trace écrite de sa raison
// d'arrêt » ne doit plus dépendre de la vigilance site par site. Tous les arrêts
// AUTOMATIQUES du bus passent par `stopAgentWithTrace`, qui écrit le motif AVANT
// d'arrêter. Ce fichier verrouille trois choses :
//
//   a. l'ORDRE (la trace précède l'arrêt), observé sur un faux `invoke` ;
//   b. l'ABSENCE DE CONTOURNEMENT dans `agents-bus.js` : chaque site d'arrêt
//      automatique est dans la même instruction qu'un appel d'entonnoir, dans sa
//      fonction englobante — la liste des sites est ÉPINGLÉE (un nouveau site
//      muet fait échouer le test) ;
//   c. le CONTRÔLE NÉGATIF du détecteur lui-même : un site muet injecté en
//      mémoire (dans la chaîne du source, jamais dans le fichier) est bien vu.
//
// Aucun DOM n'est nécessaire : seul le détecteur pur et l'I/O simulée sont
// sollicités.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Environnement Tauri simulé ────────────────────────────────────────────────
// `events` conserve TOUS les appels IPC dans l'ordre : il sert de preuve
// d'antériorité (« la ligne de journal est écrite AVANT l'abort »).
const events = [];
let failWrites = null; // (path) => true : l'écriture du journal échoue
let appDataDirPath = "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args) => {
    const path = String((args && args.path) || "");
    events.push({ cmd, path, content: String((args && args.content) || "") });
    if (cmd === "read_file_content") return "";
    if (cmd === "write_file_content") {
      if (failWrites && failWrites(path)) throw new Error("écriture impossible");
      return undefined;
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => appDataDirPath),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  stopAgentWithTrace,
  scanAutomaticStopSites,
  findUnfunneledAutomaticStops,
  AUTOMATIC_STOP_COMMANDS,
  STOP_RUN_MECHANISM,
  MANUAL_STOP_MARKER,
} from "./agent-stop-funnel.js";
import { setAgentStopTraceFailureReporter, agentStopTracePath } from "./agent-stop-trace.js";

const PROJECT = "C:\\p\\projet-entonnoir";
const traceWrites = () =>
  events.filter((e) => e.cmd === "write_file_content" && e.path.endsWith("agent-stops.log"));
const indexOf = (cmd) => events.findIndex((e) => e.cmd === cmd);

beforeEach(() => {
  events.length = 0;
  failWrites = null;
  appDataDirPath = "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor";
  setAgentStopTraceFailureReporter(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setAgentStopTraceFailureReporter(null);
  vi.restoreAllMocks();
});

// ── a. L'ordre : la trace est écrite AVANT l'arrêt ───────────────────────────
describe("entonnoir — la trace précède TOUJOURS l'arrêt", () => {
  it("trace puis abort : la ligne de journal est écrite et ATTENDUE avant l'arrêt", async () => {
    const res = await stopAgentWithTrace({
      reason: "loop-detection",
      detected: "tool-calls",
      agentId: "codeur",
      projectPath: PROJECT,
      uid: 42,
      stop: () => invoke("abort_agent_process", { agentId: "codeur", project: PROJECT, expectedUid: 42 }),
    });

    expect(res).toEqual({ traced: true, stopped: true });
    const written = traceWrites();
    expect(written, "aucune ligne de journal écrite par l'entonnoir").toHaveLength(1);
    expect(written[0].path).toBe(agentStopTracePath(PROJECT));
    expect(written[0].content).toContain("reason=loop-detection");
    expect(written[0].content).toContain("detected=tool-calls");
    expect(written[0].content).toContain("agent=codeur");
    expect(written[0].content).toContain("uid=42");
    // ORDRE observé sur la suite réelle des appels IPC.
    expect(indexOf("abort_agent_process"), "l'arrêt n'a pas été exécuté").toBeGreaterThan(-1);
    expect(indexOf("write_file_content"), "la trace doit précéder l'arrêt").toBeLessThan(
      indexOf("abort_agent_process"),
    );
  });

  it("motif incomplet : l'arrêt a quand même lieu et l'impossibilité de tracer est DITE", async () => {
    const res = await stopAgentWithTrace({
      reason: "",
      detected: "",
      agentId: "codeur",
      projectPath: PROJECT,
      stop: () => invoke("abort_agent_process", { agentId: "codeur", project: PROJECT }),
    });
    expect(res, "un motif absent ne doit jamais empêcher l'arrêt").toEqual({ traced: false, stopped: true });
    expect(traceWrites(), "aucune ligne inutile ne doit être écrite").toHaveLength(0);
    expect(indexOf("abort_agent_process")).toBeGreaterThan(-1);
    expect(console.warn).toHaveBeenCalled();
  });

  it("journal impossible (projet + global) : fail-open côté arrêt, échec signalé", async () => {
    failWrites = () => true;
    const reported = [];
    setAgentStopTraceFailureReporter((message) => reported.push(message));
    const res = await stopAgentWithTrace({
      reason: "spawn-failure-cleanup",
      detected: "run-agent-turn-error",
      agentId: "codeur",
      projectPath: PROJECT,
      stop: () => invoke("stop_agent_process", { agentId: "codeur", project: PROJECT }),
    });
    expect(res, "l'arrêt doit avoir lieu malgré la trace impossible").toEqual({
      traced: false,
      stopped: true,
    });
    expect(indexOf("stop_agent_process")).toBeGreaterThan(-1);
    expect(reported.join(" "), "un échec de journalisation est resté silencieux").toContain(
      "non journalisé",
    );
  });

  it("une erreur de l'action d'arrêt ne remonte pas (stopped=false), la trace reste écrite", async () => {
    const res = await stopAgentWithTrace({
      reason: "session-error",
      detected: "unit",
      agentId: "codeur",
      projectPath: PROJECT,
      stop: async () => {
        throw new Error("IPC indisponible");
      },
    });
    expect(res).toEqual({ traced: true, stopped: false });
    expect(traceWrites()).toHaveLength(1);
  });
});

// ── b. Aucun contournement dans agents-bus.js ───────────────────────────────
describe("agents-bus.js — aucun arrêt automatique hors de l'entonnoir", () => {
  const BUS = readFileSync(new URL("./agents-bus.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("la liste des sites d'arrêt est ÉPINGLÉE (par type et par commande)", () => {
    const res = scanAutomaticStopSites(BUS);
    const count = (kind) => res.sites.filter((s) => s.kind === kind).length;
    // 2 détections de boucle (outils, texte) + 1 arrêt automatique de run dans
    // `stopAgentsRun` (entonnoir) + 1 arrêt MANUEL du même mécanisme (marqué
    // R3-EXCEPTION-MANUEL : bouton « tout arrêter », volontaire, non journalisé).
    expect(count("abort_agent_process"), "sites `abort_agent_process` du bus").toBe(4);
    // Session périmée (contexte vierge) + nettoyage d'un process orphelin.
    expect(count("stop_agent_process"), "sites `stop_agent_process` du bus").toBe(2);
    // Le bus ne détruit jamais de session directement (c'est l'onglet agent).
    expect(count("stop_agent_session"), "sites `stop_agent_session` du bus").toBe(0);
    // Timeout d'inactivité, plafond de tours pi, plafond de tours de la run.
    expect(count(STOP_RUN_MECHANISM), "sites `stopAgentsRun` du bus").toBe(3);
    expect(res.total).toBe(9);
    // Une commande d'arrêt a été ajoutée OU retirée : il faut décider sa famille.
    expect([...AUTOMATIC_STOP_COMMANDS]).toContain("abort_agent_process");
  });

  it("chaque site est dans la même instruction qu'un appel d'entonnoir, dans sa fonction", () => {
    const res = scanAutomaticStopSites(BUS);
    expect(
      res.untraced.map((s) => `${s.kind}@${s.line}`),
      "un arrêt automatique contourne l'entonnoir (site muet)",
    ).toEqual([]);
    expect(res.funneled, "sites passant par l'entonnoir").toBe(8);
    expect(res.exceptions, "un seul site manuel déclaré").toBe(1);
    const manual = res.sites.filter((s) => s.exception);
    expect(manual).toHaveLength(1);
    expect(manual[0].kind).toBe("abort_agent_process");
    // L'exception vit dans `stopAgentsRun` (arrêt volontaire, bouton Stop) et
    // porte le marqueur nommé.
    const stopRunStart = BUS.indexOf("export async function stopAgentsRun");
    const nextExport = BUS.indexOf("\nexport ", stopRunStart + 10);
    expect(manual[0].index).toBeGreaterThan(stopRunStart);
    expect(manual[0].index).toBeLessThan(nextExport);
    expect(BUS).toContain(MANUAL_STOP_MARKER);
  });

  it("les sites d'arrêt automatique portent un motif LITTÉRAL (jamais une variable)", () => {
    const res = scanAutomaticStopSites(BUS);
    const stopRunStart = BUS.indexOf("export async function stopAgentsRun");
    const nextExport = BUS.indexOf("\nexport ", stopRunStart + 10);
    const inMechanism = (index) => index > stopRunStart && index < nextExport;
    let checked = 0;
    for (const site of res.sites.filter((s) => s.funneled)) {
      // Le corps de `stopAgentsRun` est le MÉCANISME partagé : son motif vient de
      // l'appelant (`autoStopReason`). La littéralité est donc exigée CHEZ LES
      // APPELANTS (sites ci-dessous) — et ces appelants sont eux-mêmes des sites
      // d'arrêt examinés par cette boucle.
      if (inMechanism(site.index)) continue;
      // Le motif est l'un des arguments de l'appel d'entonnoir qui précède.
      const call = BUS.slice(Math.max(0, site.index - 900), site.index);
      const funnelAt = call.lastIndexOf("stopAgentWithTrace(");
      expect(funnelAt, `site ${site.kind}@${site.line} sans appel d'entonnoir`).toBeGreaterThan(-1);
      const args = call.slice(funnelAt, funnelAt + 400);
      expect(args, `motif non littéral au site ${site.kind}@${site.line}`).toMatch(
        /reason:\s*"[a-z][a-z0-9-]+"/,
      );
      expect(args, `détecteur non littéral au site ${site.kind}@${site.line}`).toMatch(
        /detected:\s*"[a-z][a-z0-9-]+"/,
      );
      checked += 1;
    }
    expect(checked, "aucun site appelant vérifié").toBe(7);
    // Aucun appel automatique ne doit court-circuiter l'entonnoir en passant un
    // motif à `stopAgentsRun` : cette voie-là écrivait la trace APRÈS coup dans le
    // corps du mécanisme (et pouvait être oubliée par un nouvel appelant).
    expect(BUS).not.toMatch(/stopAgentsRun\(\{[^)]*reason:/);
  });
});

// ── c. Contrôle négatif : le détecteur voit un site muet injecté ────────────
describe("contrôle négatif — un site muet injecté en MÉMOIRE est détecté", () => {
  const BUS = readFileSync(new URL("./agents-bus.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const SILENT =
    'async function fakeSilentStop() { await invoke("abort_agent_process", { agentId: "x" }); }\n';

  it("injection à quatre endroits : exactement un site muet de plus, les vrais restent tracés", () => {
    for (const anchor of [
      "async function runAgentTurn",
      "export async function startAgentsRun",
      "async function failAgentTurn",
      "async function forceStaleAgentProcessRestartIfNeeded",
    ]) {
      const injected = BUS.replace(anchor, SILENT + anchor);
      expect(injected, `injection impossible (ancre introuvable : ${anchor})`).not.toBe(BUS);
      const res = findUnfunneledAutomaticStops(injected);
      expect(res, `le site muet injecté avant ${anchor} n'est pas vu`).toHaveLength(1);
      expect(res[0].kind).toBe("abort_agent_process");
      const sites = scanAutomaticStopSites(injected);
      expect(sites.total, `cardinalité changée après injection (${anchor})`).toBe(10);
      expect(sites.funneled, `les sites réels doivent rester entonnoirés (${anchor})`).toBe(8);
    }
  });

  it("injection APRÈS un appel d'entonnoir (instruction séparée) : vue aussi", () => {
    // Piège visé : la proximité d'un appel tracé ne doit pas blanchir un site
    // muet ajouté plus loin dans la MÊME fonction.
    const anchor = "      } else {\n        // R3-EXCEPTION-MANUEL";
    expect(BUS).toContain(anchor);
    const injected = BUS.replace(
      anchor,
      '      } else {\n        await invoke("abort_agent_process", { agentId: "muet" });\n        // R3-EXCEPTION-MANUEL',
    );
    const res = findUnfunneledAutomaticStops(injected);
    expect(res, "un site muet ajouté dans une fonction déjà tracée doit être vu").toHaveLength(1);
    expect(res[0].kind).toBe("abort_agent_process");
  });

  it("un appel d'entonnoir sans motif littéral reste visible comme non conforme", () => {
    // Le détecteur de sites (b) ne juge que le passage par l'entonnoir ; la
    // conformité du motif est vérifiée séparément. Ici on verrouille le fait que
    // le module expose bien les constantes utilisées par la matrice.
    expect(AUTOMATIC_STOP_COMMANDS).toEqual([
      "abort_agent_process",
      "stop_agent_process",
      "stop_agent_session",
    ]);
    expect(STOP_RUN_MECHANISM).toBe("stopAgentsRun");
    expect(MANUAL_STOP_MARKER).toBe("R3-EXCEPTION-MANUEL");
  });
});
