// Tests unitaires — exclusivity-queue.js (file d'attente d'exclusivité T5)
import { describe, it, expect } from "vitest";
import {
  exclusivityKey,
  enqueueExclusivity,
  dequeueExclusivity,
  isAgentActiveOnProject,
  RECENT_ACTIVITY_WINDOW_MS,
  isSessionWorking,
  isAnyAgentWorking,
} from "./exclusivity-queue.js";

describe("exclusivityKey", () => {
  it("clé composite (project, agent_id) unique", () => {
    expect(exclusivityKey("/p/A", "codeur")).toBe("/p/A\u{1f}codeur");
    // Deux projets différents avec le même agent → clés différentes.
    expect(exclusivityKey("/p/A", "codeur")).not.toBe(exclusivityKey("/p/B", "codeur"));
    // Deux agents du même projet → clés différentes.
    expect(exclusivityKey("/p/A", "codeur")).not.toBe(exclusivityKey("/p/A", "reviewer"));
  });
});

describe("enqueueExclusivity / dequeueExclusivity", () => {
  it("met en file puis retire dans l'ordre (FIFO)", () => {
    const queue = {};
    const a1 = { agentId: "codeur", brief: "tâche 1", project: "/p/A" };
    const a2 = { agentId: "codeur", brief: "tâche 2", project: "/p/A" };
    enqueueExclusivity(queue, "codeur", "/p/A", a1);
    enqueueExclusivity(queue, "codeur", "/p/A", a2);
    expect(dequeueExclusivity(queue, "codeur", "/p/A")).toBe(a1);
    expect(dequeueExclusivity(queue, "codeur", "/p/A")).toBe(a2);
    // File vide → null, et la clé est supprimée.
    expect(dequeueExclusivity(queue, "codeur", "/p/A")).toBeNull();
    expect(queue).toEqual({});
  });

  it("les files sont isolées par (project, agent_id)", () => {
    const queue = {};
    enqueueExclusivity(queue, "codeur", "/p/A", { agentId: "codeur", brief: "A", project: "/p/A" });
    enqueueExclusivity(queue, "codeur", "/p/B", { agentId: "codeur", brief: "B", project: "/p/B" });
    enqueueExclusivity(queue, "reviewer", "/p/A", { agentId: "reviewer", brief: "R", project: "/p/A" });
    // Retirer la file de /p/A codeur ne touche pas les autres.
    expect(dequeueExclusivity(queue, "codeur", "/p/A").brief).toBe("A");
    expect(dequeueExclusivity(queue, "codeur", "/p/B").brief).toBe("B");
    expect(dequeueExclusivity(queue, "reviewer", "/p/A").brief).toBe("R");
    expect(queue).toEqual({});
  });

  it("dequeue sur une clé absente → null sans erreur", () => {
    expect(dequeueExclusivity({}, "codeur", "/p/A")).toBeNull();
  });
});

describe("isAgentActiveOnProject", () => {
  const sessions = [
    { agent: "codeur", alive: true, busy: true, mode: "agent_process", project: "/p/A" },
    { agent: "reviewer", alive: true, busy: true, mode: "agent_process", project: "/p/A" },
    { agent: "codeur", alive: true, busy: true, mode: "agent_process", project: "/p/B" },
    { agent: "default", alive: true, busy: true, mode: "main", project: "/p/A" },
  ];

  it("détecte un agent actif sur le même projet (même spécialité)", () => {
    expect(isAgentActiveOnProject(sessions, "codeur", "/p/A")).toBe(true);
  });

  it("deux spécialités différentes sur le même projet ne sont pas en conflit", () => {
    expect(isAgentActiveOnProject(sessions, "reviewer", "/p/A")).toBe(true);
    // codeur actif sur /p/A, mais reviewer demandé sur /p/A → pas le même agent_id.
    expect(isAgentActiveOnProject(sessions, "testeur", "/p/A")).toBe(false);
  });

  it("même agent sur un AUTRE projet n'est pas en conflit", () => {
    // codeur actif sur /p/A et /p/B → conflit sur les deux.
    expect(isAgentActiveOnProject(sessions, "codeur", "/p/B")).toBe(true);
    // codeur actif sur /p/A, mais demandé sur /p/C → pas de conflit.
    expect(isAgentActiveOnProject(sessions, "codeur", "/p/C")).toBe(false);
  });

  it("une session main (mode main) n'est pas comptée (exclusivité H2 V2)", () => {
    expect(isAgentActiveOnProject(sessions, "default", "/p/A")).toBe(false);
  });

  it("une session morte (alive=false) n'est pas comptée", () => {
    const dead = [{ agent: "codeur", alive: false, busy: true, mode: "agent_process", project: "/p/A" }];
    expect(isAgentActiveOnProject(dead, "codeur", "/p/A")).toBe(false);
  });

  it("une session vivante mais inactive (settled, busy=false) n'est PAS exclusive", () => {
    // Bug : après une run terminée, la session reste vivante mais n'exécute plus
    // de tâche (busy=false). Elle doit être réutilisable pour une nouvelle run,
    // pas mise en file d'attente (sinon la demande reste bloquée).
    const idle = [{ agent: "codeur", alive: true, busy: false, mode: "agent_process", project: "/p/A" }];
    expect(isAgentActiveOnProject(idle, "codeur", "/p/A")).toBe(false);
  });

  it("liste vide ou null → pas de conflit", () => {
    expect(isAgentActiveOnProject([], "codeur", "/p/A")).toBe(false);
    expect(isAgentActiveOnProject(null, "codeur", "/p/A")).toBe(false);
  });
});

// ── Chantier 6/6 : verrou fantôme ────────────────────────────────────────────
// Une session d'agent peut rester « vivante » chez Rust sans AUCUN travail en
// cours (parkée après agent_settled, oubliée). Elle ne doit JAMAIS maintenir un
// verrou de run (faux « Une run est déjà en cours sur ce projet », incident du
// 29/08). La logique de décision est isolée dans des fonctions pures.

describe("isSessionWorking — « vraiment en activité » (chantier 6/6)", () => {
  const NOW = 1700000000000;
  const iso = (msBeforeNow) => new Date(NOW - msBeforeNow).toISOString();

  it("l'agent est busy → verrou (travail réellement en cours)", () => {
    expect(isSessionWorking({ alive: true, busy: true }, NOW)).toBe(true);
    // busy sans aucune donnée d'activité → vrai travail quand même.
    expect(isSessionWorking({ agent: "magnus", alive: true, busy: true, mode: "agent_process" }, NOW)).toBe(true);
  });

  it("l'agent est vivant mais inactif (busy=false, activité ancienne) → PAS de verrou", () => {
    const parked = { alive: true, busy: false, lastActivity: iso(RECENT_ACTIVITY_WINDOW_MS + 60_000) };
    expect(isSessionWorking(parked, NOW)).toBe(false);
  });

  it("l'agent a une activité très récente (< fenêtre de grâce) → verrou (fenêtre de grâce)", () => {
    const recent = { alive: true, busy: false, lastActivity: iso(10_000) };
    expect(isSessionWorking(recent, NOW)).toBe(true);
  });

  it("frontière de la fenêtre de grâce (2 min)", () => {
    // Juste sous la fenêtre → en activité ; à la fenêtre exacte et au-delà → non.
    const justUnder = { alive: true, busy: false, lastActivity: iso(RECENT_ACTIVITY_WINDOW_MS - 1) };
    const atLimit = { alive: true, busy: false, lastActivity: iso(RECENT_ACTIVITY_WINDOW_MS) };
    expect(isSessionWorking(justUnder, NOW)).toBe(true);
    expect(isSessionWorking(atLimit, NOW)).toBe(false);
  });

  it("données manquantes → JAMAIS de verrou (fail-open)", () => {
    // Session vivante sans busy ni lastActivity (aucune donnée d'anomalie).
    expect(isSessionWorking({ alive: true }, NOW)).toBe(false);
    // busy absent mais lastActivity absente aussi → fail-open.
    expect(isSessionWorking({ agent: "magnus", alive: true, project: "/p/A" }, NOW)).toBe(false);
    // Session nulle / undefined.
    expect(isSessionWorking(null, NOW)).toBe(false);
    expect(isSessionWorking(undefined, NOW)).toBe(false);
  });

  it("session morte (alive=false ou absent) → jamais de verrou, même si busy résiduel", () => {
    expect(isSessionWorking({ alive: false, busy: true }, NOW)).toBe(false);
    expect(isSessionWorking({ alive: false, busy: true, lastActivity: iso(0) }, NOW)).toBe(false);
  });

  it("lastActivity illisible (non parsable) → fail-open (pas de verrou)", () => {
    expect(isSessionWorking({ alive: true, busy: false, lastActivity: "bozo" }, NOW)).toBe(false);
  });
});

describe("isAnyAgentWorking — au moins un agent réellement en activité ?", () => {
  const NOW = 1700000000000;
  const proj = { magnus: "/p/A" };
  const getProj = (id) => proj[id] || null;

  it("aucun agent actif dans les données (sessions vides/null) → pas de verrou", () => {
    expect(isAnyAgentWorking([], ["magnus"], getProj, NOW)).toBe(false);
    expect(isAnyAgentWorking(null, ["magnus"], getProj, NOW)).toBe(false);
  });

  it("session vivante mais parkée (busy=false, activité ancienne) → PAS de verrou (scénario du bug)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: false,
        lastActivity: new Date(NOW - 10 * 60 * 1000).toISOString() },
    ];
    expect(isAnyAgentWorking(sessions, ["magnus"], getProj, NOW)).toBe(false);
  });

  it("un seul agent busy sur le projet → verrou (les autres peuvent être inactifs)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: false },
      { agent: "codeur", project: "/p/A", mode: "agent_process", alive: true, busy: true },
    ];
    expect(isAnyAgentWorking(sessions, ["magnus", "codeur"], getProj, NOW)).toBe(true);
  });

  it("activité très récente (< 2 min) → verrou (fenêtre de grâce)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: false,
        lastActivity: new Date(NOW - 30_000).toISOString() },
    ];
    expect(isAnyAgentWorking(sessions, ["magnus"], getProj, NOW)).toBe(true);
  });

  it("priorité (agent, projet) : session parkée du bon projet ne masque pas… elle tranche seule", () => {
    // Session (magnus, /p/A) vivante mais inactive ; pas d'autre session de
    // magnus → décision portée par la session du bon projet : pas de verrou.
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: false },
      { agent: "magnus", project: "/p/B", mode: "agent_process", alive: true, busy: true },
    ];
    // byProject (parkée) est retenue en priorité → non travailleuse → false.
    expect(isAnyAgentWorking(sessions, ["magnus"], getProj, NOW)).toBe(false);
    // Sur un projet sans session dédiée, le match tombe sur n'importe quelle
    // session vivante de l'agent : elle est busy → true (prudence).
    expect(isAnyAgentWorking(sessions, ["magnus"], () => null, NOW)).toBe(true);
  });

  it("agent absent des sessions → pas de verrou", () => {
    const sessions = [
      { agent: "autre", project: "/p/A", mode: "agent_process", alive: true, busy: true },
    ];
    expect(isAnyAgentWorking(sessions, ["magnus"], getProj, NOW)).toBe(false);
  });

  it("données incomplètes (sans busy ni lastActivity) → jamais de verrou (fail-open)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true },
    ];
    expect(isAnyAgentWorking(sessions, ["magnus"], getProj, NOW)).toBe(false);
  });
});
