// Tests unitaires — CHIEN DE GARDE vs SESSION NEUVE (2026-10-28).
//
// Preuve au journal (`.pilot/agent-stops.log`, projet pilot, 2026-10-28) :
//   14:22:53.119  reason=stale-session-restart  detected=fresh-context   (session NEUVE)
//   14:23:17.203  reason=watchdog-release       detected=ghosts  uid=76  (24 s plus tard)
// Puis à nouveau à 13:52, 14:04, 14:30, 14:33 : chaque fois que le chien de
// garde voyait une session créée par le bus, mais encore MUETTE (aucun `busy`,
// aucune `lastActivity`, aucun outil), il concluait « session fantôme » et
// coupait la mission.
//
// Règles vérifiées ici :
//  1. une session RÉCEMMENT DÉMARRÉE n'est JAMAIS jugée fantôme : la porte
//     `ghosts` laisse passer au moins `RECENT_ACTIVITY_WINDOW_MS` après le
//     démarrage de la session, quel que soit le plancher demandé par l'appelant ;
//  2. une session SANS aucun signal d'activité est distinguée d'un VRAI fantôme :
//     ancienne (repère de démarrage périmé) → coupée, neuve → protégée ;
//  3. un OUTIL EN COURS protège toujours la run ;
//  4. une ACTIVITÉ RÉCENTE protège toujours la run ;
//  5. une session MORTE reste coupée, même très récente (la mort est éliminatoire).
//
// Aucun chiffre attendu n'est figé en dur : toutes les durées sont RECALCULÉES
// depuis `RECENT_ACTIVITY_WINDOW_MS` (exclusivity-queue.js).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

// Aucun backend Tauri en environnement Node : mock minimal des commandes.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import {
  beginRun,
  endRun,
  getRunState,
  handleAgentEvent,
  releaseStuckRunLock,
  markSessionStarted,
  latestSessionStartAt,
  startGraceOpen,
  annotateSessionStartTimes,
  __setWatchdogConfirmDelayForTest,
} from "./agents-bus.js";
import {
  RECENT_ACTIVITY_WINDOW_MS,
  sessionStartAt,
  isSessionRecentlyStarted,
  isSessionWorking,
} from "./exclusivity-queue.js";

const PROJECT = "projet-session-neuve";
const AGENT = "codeur";

/** Run en cours avec l'agent « codeur » déclaré actif sur le projet. */
function beginRunWithAgent() {
  const ctx = beginRun(PROJECT);
  ctx.activeAgents.add(AGENT);
  ctx.agentProject[AGENT] = PROJECT;
  return ctx;
}

/** Sonde Rust `agent_activity_probe` : sessions fournies telles quelles. */
function mockProbe(sessions) {
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "list_agent_sessions" || cmd === "agent_activity_probe" ? { sessions } : undefined
  );
}

/** Session vivante SANS aucun signal (ni busy, ni outil, ni dernière activité). */
function bareSession(extra = {}) {
  return { agent: AGENT, project: PROJECT, mode: "agent_process", alive: true, ...extra };
}

/** Protocole de prudence du chien de garde : DEUX mesures concordantes. */
async function mesureTwice(opts) {
  await releaseStuckRunLock(PROJECT, opts);
  await releaseStuckRunLock(PROJECT, opts);
}

beforeEach(() => {
  __setWatchdogConfirmDelayForTest(0);
  endRun(PROJECT);
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  __setWatchdogConfirmDelayForTest();
  endRun(PROJECT);
  vi.mocked(invoke).mockReset();
});

// ───────────────────────────────────────────────────────────────────────────
describe("sessionStartAt / isSessionRecentlyStarted — fonctions pures", () => {
  it("sans repère exploitable : 0 et false (aucune protection inventée)", () => {
    for (const s of [null, undefined, {}, { sessionStartedAt: 0 }, { sessionStartedAt: "" },
      { sessionStartedAt: "pas une date" }, { sessionStartedAt: -5 }]) {
      expect(sessionStartAt(s)).toBe(0);
      expect(isSessionRecentlyStarted(s, Date.now())).toBe(false);
    }
  });

  it("un repère récent protège ; le seuil est STRICT (à la fenêtre exacte, plus de grâce)", () => {
    const now = 1_700_000_000_000;
    const frais = now - Math.floor(RECENT_ACTIVITY_WINDOW_MS / 2);
    expect(sessionStartAt({ sessionStartedAt: frais })).toBe(frais);
    expect(isSessionRecentlyStarted({ sessionStartedAt: frais }, now)).toBe(true);
    // Exactement à la fenêtre : la protection est levée (comportement historique).
    expect(isSessionRecentlyStarted({ sessionStartedAt: now - RECENT_ACTIVITY_WINDOW_MS }, now)).toBe(false);
    expect(isSessionRecentlyStarted({ sessionStartedAt: now - RECENT_ACTIVITY_WINDOW_MS - 1 }, now)).toBe(false);
  });

  it("accepte une chaîne ISO (sonde/annotation sérialisée)", () => {
    const now = 1_700_000_000_000;
    const iso = new Date(now - Math.floor(RECENT_ACTIVITY_WINDOW_MS / 4)).toISOString();
    expect(sessionStartAt({ sessionStartedAt: iso })).toBe(Date.parse(iso));
    expect(isSessionRecentlyStarted({ sessionStartedAt: iso }, now)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("isSessionWorking — une session NEUVE ne prouve pas l'inactivité", () => {
  const now = 1_700_000_000_000;

  it("démarrée il y a peu et SANS aucun signal → elle travaille (cause du défaut)", () => {
    const neuve = { alive: true, sessionStartedAt: now - Math.floor(RECENT_ACTIVITY_WINDOW_MS / 10) };
    expect(isSessionWorking(neuve, now)).toBe(true);
  });

  it("ANCIENNE et sans aucune activité → elle ne travaille pas (vrai fantôme toujours coupé)", () => {
    const vieille = { alive: true, sessionStartedAt: now - RECENT_ACTIVITY_WINDOW_MS - 60_000 };
    expect(isSessionWorking(vieille, now)).toBe(false);
    // Sans repère de démarrage du tout : comportement historique inchangé.
    expect(isSessionWorking({ alive: true }, now)).toBe(false);
  });

  it("morte : le repère de démarrage ne protège jamais un mort", () => {
    expect(isSessionWorking({ alive: false, sessionStartedAt: now }, now)).toBe(false);
  });

  it("les signaux existants gardent leur priorité (outil en cours, activité récente)", () => {
    expect(isSessionWorking({ alive: true, toolInProgress: true }, now)).toBe(true);
    expect(
      isSessionWorking({ alive: true, lastActivity: new Date(now - 30_000).toISOString() }, now),
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("startGraceOpen — repère de démarrage porté par le bus", () => {
  it("sans repère, la grâce est fermée (aucun comportement nouveau inventé)", () => {
    expect(latestSessionStartAt(null)).toBe(0);
    expect(latestSessionStartAt({})).toBe(0);
    expect(startGraceOpen(null)).toBe(false);
    expect(startGraceOpen({ sessionStartedAtByAgent: {} })).toBe(false);
  });

  it("un démarrage horodaté ouvre la grâce, puis elle se referme à la fenêtre", () => {
    const ctx = beginRunWithAgent();
    const at = Date.now();
    expect(markSessionStarted(ctx, AGENT, at)).toBe(at);
    expect(latestSessionStartAt(ctx)).toBe(at);
    expect(startGraceOpen(ctx, at)).toBe(true);
    expect(startGraceOpen(ctx, at + RECENT_ACTIVITY_WINDOW_MS - 1)).toBe(true);
    expect(startGraceOpen(ctx, at + RECENT_ACTIVITY_WINDOW_MS)).toBe(false);
  });

  it("un redémarrage de session en cours de run RAFRAÎCHIT le repère (le plus récent gagne)", () => {
    const ctx = beginRunWithAgent();
    const now = Date.now();
    markSessionStarted(ctx, AGENT, now - 10 * RECENT_ACTIVITY_WINDOW_MS);
    expect(startGraceOpen(ctx, now)).toBe(false);
    const other = "reviewer";
    markSessionStarted(ctx, other, now); // session neuve d'un autre agent de la run
    expect(latestSessionStartAt(ctx)).toBe(now);
    expect(startGraceOpen(ctx, now)).toBe(true);
  });

  it("markSessionStarted est tolérant (contexte absent, agent vide)", () => {
    expect(markSessionStarted(null, AGENT)).toBe(0);
    expect(markSessionStarted({}, "")).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("annotateSessionStartTimes — la sonde muette reçoit le repère du bus", () => {
  it("une session déclarée sans horodatage reçoit celui du bus (même projet, autre écriture)", () => {
    const ctx = beginRunWithAgent();
    const at = Date.now();
    markSessionStarted(ctx, AGENT, at);
    const [annoncee, etrangere, deja] = annotateSessionStartTimes([
      { agent: AGENT, project: PROJECT, alive: true },
      { agent: "autre", project: PROJECT, alive: true },
      { agent: AGENT, project: PROJECT, alive: true, sessionStartedAt: 1 },
    ]);
    expect(annoncee.sessionStartedAt).toBe(at);
    expect(etrangere.sessionStartedAt).toBeUndefined();
    // Une valeur déjà portée par la sonde n'est JAMAIS écrasée.
    expect(deja.sessionStartedAt).toBe(1);
  });

  it("sans run connue, la liste est rendue telle quelle (aucune invention)", () => {
    const liste = [{ agent: AGENT, project: PROJECT, alive: true }];
    expect(annotateSessionStartTimes(liste)).toEqual(liste);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("releaseStuckRunLock — la porte `ghosts` ne tue plus une session neuve", () => {
  it("session NEUVE sans aucun signal, appelant SANS plancher → run MAINTENUE (cas du journal)", async () => {
    const ctx = beginRunWithAgent();
    // Le bus vient de créer la session : il le sait, la sonde ne porte rien.
    markSessionStarted(ctx, AGENT);
    mockProbe([bareSession()]);
    // Aucune option : c'est l'appel qui libérait immédiatement (`requireIdleMs = 0`).
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("running");
  });

  it("session ANCIENNE sans aucune activité → run LIBÉRÉE (le vrai fantôme reste coupé)", async () => {
    const ctx = beginRunWithAgent();
    markSessionStarted(ctx, AGENT, Date.now() - RECENT_ACTIVITY_WINDOW_MS - 60_000);
    mockProbe([bareSession()]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });

  it("session avec un OUTIL EN COURS → run MAINTENUE (même ancienne)", async () => {
    const ctx = beginRunWithAgent();
    markSessionStarted(ctx, AGENT, Date.now() - RECENT_ACTIVITY_WINDOW_MS - 60_000);
    mockProbe([bareSession({ toolInProgress: true })]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("running");
  });

  it("session avec une ACTIVITÉ RÉCENTE → run MAINTENUE (même sans repère de démarrage)", async () => {
    beginRunWithAgent();
    mockProbe([bareSession({ lastActivity: new Date(Date.now() - 30_000).toISOString() })]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("running");
  });

  it("session NEUVE mais MORTE → run LIBÉRÉE (la mort est éliminatoire, pas une grâce)", async () => {
    const ctx = beginRunWithAgent();
    markSessionStarted(ctx, AGENT);
    mockProbe([bareSession({ alive: false })]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });

  it("le témoin historique reste vrai : plus aucune session → run LIBÉRÉE", async () => {
    beginRunWithAgent();
    mockProbe([]);
    await mesureTwice();
    expect(getRunState(PROJECT)).toBe("idle");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("branchement — l'horodatage est posé au SPAWN, pas ailleurs", () => {
  const src = readFileSync(new URL("./agents-bus.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("le spawn d'agent appelle markSessionStarted(ctx, agent.id)", () => {
    const spawn = src.indexOf('invoke("start_agent_process"');
    expect(spawn).toBeGreaterThan(-1);
    const apres = src.slice(spawn, spawn + 1200);
    expect(apres).toContain("markSessionStarted(ctx, agent.id)");
  });

  it("la porte `ghosts` consulte startGraceOpen AVANT de conclure", () => {
    const porte = src.indexOf("ghosts = !working && !toolRunning");
    expect(porte).toBeGreaterThan(-1);
    const apres = src.slice(porte, porte + 900);
    expect(apres).toContain("startGraceOpen(ctx)");
    // La porte existe toujours (le chien de garde n'est pas désactivé).
    expect(src).toContain("releaseStuckRunLockForKey");
    expect(src).toContain("endRun(key, ctx.generation)");
  });
});
