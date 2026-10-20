// Tests — écritures CONCURRENTES du journal des arrêts : aucune ligne perdue.
//
// Le journal `<projet>/.pilot/agent-stops.log` est écrit par LECTURE puis
// RÉÉCRITURE (aucune commande IPC d'append). Deux traces concurrentes lisaient
// donc la même version du journal, et la seconde écriture ÉCRASAIT la ligne de
// la première : des arrêts disparaissaient du disque — exactement ce que la
// RÈGLE 3 interdit.
//
// Cas réel déclencheur : `/file vide` abandonne plusieurs familles de demandes
// (commandes, missions, délégations) et journalise une ligne PAR famille, toutes
// lancées en parallèle.
//
// Ce fichier simule un système de fichiers VIRTUEL (lecture/écriture réellement
// entrelaçables : chaque opération attend un délai pseudo-aléatoire) et vérifie
// que les N lignes demandées se retrouvent TOUTES dans le journal. Sans la
// sérialisation (`traceWriteChain`), ce test perd des lignes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Système de fichiers virtuel (IPC simulé) ─────────────────────────────────
const files = new Map();
let readCalls = 0;
let writeCalls = 0;
let delaySeq = 0;

/** Délai déterministe mais VARIABLE : entrelace lectures et écritures. */
const jitter = () => {
  delaySeq = (delaySeq * 1103515245 + 12345) % 2147483648;
  const ms = 1 + (delaySeq % 5);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args) => {
    const path = String((args && args.path) || "");
    if (cmd === "create_file") {
      return undefined;
    }
    if (cmd === "read_file_content") {
      await jitter();
      readCalls++;
      return files.has(path) ? files.get(path) : "";
    }
    if (cmd === "write_file_content") {
      await jitter();
      writeCalls++;
      files.set(path, String((args && args.content) || ""));
      return undefined;
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:\\Users\\test\\AppData\\Roaming\\com.pilot.editor"),
}));

import { traceAutomaticAgentStop, agentStopTracePath } from "./agent-stop-trace.js";
import { appendAgentStopTrace, buildAgentStopTraceLine } from "./loop-detection.js";

const P = "C:\\p\\journal-concurrent";
const LOG = agentStopTracePath(P);

/** Lignes non vides du journal virtuel. */
const logLines = () => String(files.get(LOG) || "").split("\n").filter(Boolean);

beforeEach(() => {
  files.clear();
  readCalls = 0;
  writeCalls = 0;
  delaySeq = 1;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("journal des arrêts — écritures concurrentes sérialisées", () => {
  it("5 traces lancées en parallèle → 5 lignes dans le journal (aucune écrasée)", async () => {
    const reasons = ["queue-abandoned", "queue-abandoned", "session-error", "session-restart", "watchdog-release"];
    await Promise.all(
      reasons.map((reason, i) =>
        traceAutomaticAgentStop({
          reason,
          detected: `famille-${i}`,
          agentId: `agent-${i}`,
          projectPath: P,
          detail: `demande ${i}`,
        }),
      ),
    );

    const lines = logLines();
    expect(lines, "des lignes ont été écrasées par une écriture concurrente").toHaveLength(reasons.length);
    // Chaque appel a SA ligne (agent + détecteur distincts, aucune perte).
    for (let i = 0; i < reasons.length; i++) {
      expect(lines.some((l) => l.includes(`agent=agent-${i}`)), `ligne de l'agent ${i} absente`).toBe(true);
      expect(lines.some((l) => l.includes(`detected=famille-${i}`)), `détecteur famille-${i} absent`).toBe(true);
    }
    // Les deux lignes de même motif sont bien DEUX lignes distinctes.
    expect(lines.filter((l) => l.includes("reason=queue-abandoned"))).toHaveLength(2);
  });

  it("les écritures ne se chevauchent pas (une lecture voit ce que la précédente a écrit)", async () => {
    await Promise.all([
      traceAutomaticAgentStop({ reason: "queue-abandoned", detected: "commande", projectPath: P }),
      traceAutomaticAgentStop({ reason: "queue-abandoned", detected: "mission", projectPath: P }),
      traceAutomaticAgentStop({ reason: "queue-abandoned", detected: "délégation", projectPath: P }),
    ]);
    // 3 lectures + 3 écritures, et surtout : le journal contient les 3 détecteurs,
    // donc chaque lecture a bien vu la ligne de l'écriture précédente.
    expect(readCalls).toBe(3);
    expect(writeCalls).toBe(3);
    const content = String(files.get(LOG) || "");
    for (const d of ["commande", "mission", "délégation"]) {
      expect(content).toContain(`detected=${d}`);
    }
  });

  it("un échec d'écriture ne casse pas la chaîne (les traces suivantes passent)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mocked = vi.mocked(invoke);
    // Les DEUX écritures de la 1re trace échouent (projet puis journal global) :
    // la trace est dite en échec, mais la chaîne ne doit pas rester cassée.
    let failures = 0;
    mocked.mockImplementation(async (cmd, args) => {
      const path = String((args && args.path) || "");
      if (cmd === "read_file_content") return path === LOG ? "" : files.get(path) || "";
      if (cmd === "write_file_content") {
        if (failures < 2) {
          failures++;
          throw new Error("disque plein");
        }
        files.set(path, String((args && args.content) || ""));
        return undefined;
      }
      return undefined;
    });

    const first = traceAutomaticAgentStop({ reason: "session-error", detected: "premier", projectPath: P });
    const second = traceAutomaticAgentStop({ reason: "session-error", detected: "second", projectPath: P });
    const results = await Promise.all([first, second]);
    // La première a échoué deux fois (projet puis global) → false, mais elle est DITE.
    expect(results[0]).toBe(false);
    expect(results[1], "la chaîne est restée bloquée après un échec").toBe(true);
    expect(logLines().some((l) => l.includes("detected=second"))).toBe(true);
  });

  it("la rotation (cap ~256 Ko) survit à l'écriture concurrente sans perdre la dernière ligne", async () => {
    const big = "x".repeat(1024);
    const filler = Array.from({ length: 800 }, (_, i) => buildAgentStopTraceLine({ reason: "old", agentId: `vieux-${i}`, detail: big })).join("\n");
    files.set(LOG, filler + "\n");
    expect(files.get(LOG).length).toBeGreaterThan(256 * 1024);

    await Promise.all([
      traceAutomaticAgentStop({ reason: "queue-abandoned", detected: "kept-1", projectPath: P }),
      traceAutomaticAgentStop({ reason: "queue-abandoned", detected: "kept-2", projectPath: P }),
    ]);

    const content = String(files.get(LOG) || "");
    expect(content.length, "le journal n'a pas été tronqué (rotation absente)").toBeLessThanOrEqual(256 * 1024 + 4096);
    expect(content).toContain("detected=kept-1");
    expect(content).toContain("detected=kept-2");
    // Contrôle de cohérence de la rotation : appendAgentStopTrace garde bien les
    // lignes récentes (le remplissage ancien peut disparaître).
    expect(appendAgentStopTrace(filler, buildAgentStopTraceLine({ reason: "old" })).length).toBeLessThanOrEqual(256 * 1024 + 4096);
  });
});
