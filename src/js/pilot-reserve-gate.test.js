// Test de la porte pré-écriture des fichiers réservés (pilot-reserve-gate.ts).
//
// Régression visée : une réservation active doit toujours bloquer un agent hors
// run, MAIS le refus doit dire QUI détient le chemin et comment la réservation
// se libère ; et une réservation dont le détenteur n'existe plus (plus
// renouvelée, périmée) ne doit pas bloquer indéfiniment — elle est libérée avec
// une trace explicite, jamais en silence.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gate from "../../src-tauri/extensions/pilot-reserve-gate.ts";

const TTL_MS = 10 * 60 * 1000; // doit rester cohérent avec la porte (10 min)

function loadToolCallHandler() {
  const handlers = {};
  gate({
    on: (evt, h) => {
      handlers[evt] = h;
    },
  });
  return handlers.tool_call;
}

function makeCtx(cwd, notifications) {
  return { cwd, ui: { notify: (msg, level) => notifications.push({ msg, level }) } };
}

function writeReservations(project, reservations) {
  mkdirSync(join(project, ".pilot"), { recursive: true });
  writeFileSync(join(project, ".pilot", "reservations.json"), JSON.stringify(reservations), "utf8");
}

const PREVIOUS_AGENT_ID = process.env.PILOT_AGENT_ID;

describe("pilot-reserve-gate", () => {
  let project;
  const notifications = [];

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "pilot-reserve-gate-"));
    notifications.length = 0;
  });

  afterEach(() => {
    if (PREVIOUS_AGENT_ID === undefined) delete process.env.PILOT_AGENT_ID;
    else process.env.PILOT_AGENT_ID = PREVIOUS_AGENT_ID;
    rmSync(project, { recursive: true, force: true });
  });

  it("réservation active : bloque un agent hors run avec un message utile (détenteur + libération)", async () => {
    process.env.PILOT_AGENT_ID = "spec-b";
    writeReservations(project, {
      coder: "codeur-a",
      agents: ["codeur-a"],
      files: ["src/lib.rs"],
      createdAt: new Date().toISOString(),
      renewedAt: new Date().toISOString(),
    });

    const result = await loadToolCallHandler()(
      { toolName: "write", input: { path: "src/lib.rs" } },
      makeCtx(project, notifications),
    );

    expect(result && result.block).toBe(true);
    // Le refus doit nommer le détenteur et expliquer la libération.
    expect(result.reason).toContain("codeur-a");
    expect(result.reason.toLowerCase()).toContain("libère");
  });

  it("réservation périmée : libère (trace explicite) et autorise l'écriture", async () => {
    process.env.PILOT_AGENT_ID = "spec-b";
    writeReservations(project, {
      coder: "codeur-a",
      agents: ["codeur-a"],
      files: ["src/lib.rs"],
      createdAt: new Date(Date.now() - 3 * TTL_MS).toISOString(),
      renewedAt: new Date(Date.now() - 3 * TTL_MS).toISOString(),
    });

    const result = await loadToolCallHandler()(
      { toolName: "write", input: { path: "src/lib.rs" } },
      makeCtx(project, notifications),
    );

    expect(result).toBeUndefined(); // écriture autorisée
    expect(existsSync(join(project, ".pilot", "reservations.json"))).toBe(false);
    // Trace explicite : ni silence, ni suppression non documentée.
    const log = readFileSync(join(project, ".pilot", "reservations-released.log"), "utf8");
    expect(log).toContain("codeur-a");
    expect(log).toContain("src/lib.rs");
    expect(notifications.length).toBeGreaterThan(0);
  });

  it("participant de la run : jamais bloqué (réservation fraîche)", async () => {
    process.env.PILOT_AGENT_ID = "spec-b";
    writeReservations(project, {
      coder: "codeur-a",
      agents: ["codeur-a", "spec-b"],
      files: ["src/lib.rs"],
      renewedAt: new Date().toISOString(),
    });

    const result = await loadToolCallHandler()(
      { toolName: "write", input: { path: "src/lib.rs" } },
      makeCtx(project, notifications),
    );

    expect(result).toBeUndefined();
  });

  it("fichier non réservé : autorisé", async () => {
    process.env.PILOT_AGENT_ID = "spec-b";
    writeReservations(project, {
      coder: "codeur-a",
      agents: ["codeur-a"],
      files: ["src/lib.rs"],
      renewedAt: new Date().toISOString(),
    });

    const result = await loadToolCallHandler()(
      { toolName: "write", input: { path: "docs/notes.md" } },
      makeCtx(project, notifications),
    );

    expect(result).toBeUndefined();
  });
});
