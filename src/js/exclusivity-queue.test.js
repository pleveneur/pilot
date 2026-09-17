// Tests unitaires — exclusivity-queue.js (file d'attente d'exclusivité T5)
import { describe, it, expect } from "vitest";
import {
  exclusivityKey,
  enqueueExclusivity,
  dequeueExclusivity,
  isAgentActiveOnProject,
  RECENT_ACTIVITY_WINDOW_MS,
  STALE_BUSY_WINDOW_MS,
  isBusyStale,
  isSessionWorking,
  isAnyAgentWorking,
  classifyExclusivitySession,
  isProjectWorking,
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

  it("une session busy-stale (busy retenu, activité très ancienne) n'est PAS exclusive", () => {
    // Process pi figé : busy reste true sans progression. La demande à la MÊME
    // spécialité sur le même projet ne doit pas rester en file derrière le fantôme
    // → elle démarre immédiatement (exclusivité libérée).
    const stale = [{
      agent: "codeur", alive: true, busy: true, mode: "agent_process", project: "/p/A",
      lastActivity: new Date(Date.now() - STALE_BUSY_WINDOW_MS - 60_000).toISOString(),
    }];
    expect(isAgentActiveOnProject(stale, "codeur", "/p/A")).toBe(false);
    // Une session busy FRAÎCHE sur le même couple reste exclusive.
    const fresh = [{
      agent: "codeur", alive: true, busy: true, mode: "agent_process", project: "/p/A",
      lastActivity: new Date(Date.now() - 30_000).toISOString(),
    }];
    expect(isAgentActiveOnProject(fresh, "codeur", "/p/A")).toBe(true);
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

  it("busy-stale (busy=true retenu, MAIS dernière activité très ancienne > fenêtre) → PAS de verrou", () => {
    // Process pi figé (vivant, ni settled ni exit) : busy reste true alors qu'aucun
    // travail n'avance. Une session busy-stale n'est plus « un travail en cours ».
    const stale = { alive: true, busy: true, lastActivity: iso(STALE_BUSY_WINDOW_MS + 60_000) };
    expect(isSessionWorking(stale, NOW)).toBe(false);
  });

  it("busy récent (activité rafraîchie dans la fenêtre busy-stale) → verrou (vraiment actif)", () => {
    const active = { alive: true, busy: true, lastActivity: iso(60_000) }; // il y a 1 min
    expect(isSessionWorking(active, NOW)).toBe(true);
  });

  it("busy-stale : fail-open — busy SANS lastActivity exploitable → verrou (on ne peut pas prouver la staleness)", () => {
    // busy sans lastActivity → pas de preuve de staleness → vrai travail (fail-open).
    expect(isSessionWorking({ alive: true, busy: true }, NOW)).toBe(true);
    // lastActivity illisible → pas de preuve → vrai travail.
    expect(isSessionWorking({ alive: true, busy: true, lastActivity: "bozo" }, NOW)).toBe(true);
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

describe("isBusyStale — un busy VIEUX n'est plus un travail (verrou fantôme)", () => {
  const NOW = 1700000000000;
  const iso = (msBeforeNow) => new Date(NOW - msBeforeNow).toISOString();

  it("busy + activité au-delà de la fenêtre → stale", () => {
    expect(isBusyStale({ alive: true, busy: true, lastActivity: iso(STALE_BUSY_WINDOW_MS + 1) }, NOW)).toBe(true);
  });

  it("busy + activité dans la fenêtre → pas stale", () => {
    expect(isBusyStale({ alive: true, busy: true, lastActivity: iso(STALE_BUSY_WINDOW_MS - 1) }, NOW)).toBe(false);
    expect(isBusyStale({ alive: true, busy: true, lastActivity: iso(0) }, NOW)).toBe(false);
  });

  it("fail-open : sans preuve exploitable → jamais stale", () => {
    expect(isBusyStale({ alive: true, busy: true }, NOW)).toBe(false); // pas de lastActivity
    expect(isBusyStale({ alive: true, busy: true, lastActivity: "bozo" }, NOW)).toBe(false); // illisible
    expect(isBusyStale({ alive: false, busy: true, lastActivity: iso(STALE_BUSY_WINDOW_MS + 1) }, NOW)).toBe(false); // mort
    expect(isBusyStale({ alive: true, busy: false, lastActivity: iso(STALE_BUSY_WINDOW_MS + 1) }, NOW)).toBe(false); // pas busy
    expect(isBusyStale(null, NOW)).toBe(false);
  });
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

describe("classifyExclusivitySession — verrou local : travail réel vs simple vivacité", () => {
  const NOW = 1700000000000;
  const oldIso = new Date(NOW - 30 * 60 * 1000).toISOString(); // 30 min (> fenêtre busy-stale 25 min)

  it("sonde indisponible (undefined) → \"unknown\" (prudence, on ne libère pas)", () => {
    expect(classifyExclusivitySession(undefined, NOW)).toBe("unknown");
  });

  it("session absente (null) → \"ghost\" (tour fantôme à purger)", () => {
    expect(classifyExclusivitySession(null, NOW)).toBe("ghost");
  });

  it("processus VIVANT mais au repos (busy=false, activité ancienne) → \"stale\" (verrou périmé)", () => {
    // Cœur du bug : un process vivant n'est PAS un travail en cours.
    expect(
      classifyExclusivitySession({ alive: true, busy: false, lastActivity: oldIso }, NOW)
    ).toBe("stale");
  });

  it("busy périmé (inactif depuis > 25 min) → \"stale\"", () => {
    expect(
      classifyExclusivitySession({ alive: true, busy: true, lastActivity: oldIso }, NOW)
    ).toBe("stale");
  });

  it("agent réellement occupé (busy frais) → \"working\" (mise en file légitime)", () => {
    expect(
      classifyExclusivitySession(
        { alive: true, busy: true, lastActivity: new Date(NOW - 5_000).toISOString() },
        NOW
      )
    ).toBe("working");
  });

  it("activité très récente même sans busy → \"working\" (fenêtre de grâce)", () => {
    expect(
      classifyExclusivitySession(
        { alive: true, busy: false, lastActivity: new Date(NOW - 30_000).toISOString() },
        NOW
      )
    ).toBe("working");
  });
});

describe("isProjectWorking — garde de fin de run (travail réel, pas vivacité)", () => {
  const NOW = 1700000000000;
  const oldIso = new Date(NOW - 30 * 60 * 1000).toISOString();

  it("aucune session / liste nulle → pas de run active", () => {
    expect(isProjectWorking([], "/p/A", NOW)).toBe(false);
    expect(isProjectWorking(null, "/p/A", NOW)).toBe(false);
  });

  it("agent du projet VIVANT mais au repos → run non active (verrou libéré, pas de faux « lancé »)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: false, lastActivity: oldIso },
    ];
    expect(isProjectWorking(sessions, "/p/A", NOW)).toBe(false);
  });

  it("agent du projet vraiment occupé → run active (on ne coupe pas une tâche saine)", () => {
    const sessions = [
      { agent: "magnus", project: "/p/A", mode: "agent_process", alive: true, busy: true, lastActivity: new Date(NOW - 1_000).toISOString() },
    ];
    expect(isProjectWorking(sessions, "/p/A", NOW)).toBe(true);
  });

  it("agent occupé d'un AUTRE projet → ne rend pas ce projet actif", () => {
    const sessions = [
      { agent: "magnus", project: "/p/B", mode: "agent_process", alive: true, busy: true, lastActivity: new Date(NOW - 1_000).toISOString() },
    ];
    expect(isProjectWorking(sessions, "/p/A", NOW)).toBe(false);
  });
});

// Défaut B (garde de non-régression) — la mise en file ne doit plus se
// déclencher « pour rien » après l'arrêt d'une session.
//
// Cause racine côté Rust : `AgentService::stop` ne purgeait pas la marque
// d'occupation `busy` du couple (projet, agent) dans la map d'anomalie (un
// arrêt volontaire n'émet pas `process_exit`). La sonde `list_agent_sessions`
// renvoyait donc `busy: true` avec un `lastActivity` récent APRÈS l'arrêt →
// la garde ci-dessous considérait la session « déjà active » et mettait la
// demande en file d'attente (résultat `queued`, jamais démarré) tout en
// maintenant le faux verrou « Une run est déjà en cours sur ce projet ».
//
// Ces assertions verrouillent le contrat JS : seul un `busy` NON purgé est
// exclusif. Le correctif Rust (`stop` → busy=false) garantit l'entrée.
describe("défaut B — une session arrêtée n'est plus mise en file", () => {
  it("busy purgé à l'arrêt → la demande démarre (plus d'exclusivité)", () => {
    const project = "/p/A";
    const agentId = "codeur";
    const recentIso = new Date().toISOString();
    // État AVANT purge (comportement fautif) : busy=true + activité récente.
    const beforeStop = [
      { agent: agentId, project, mode: "agent_process", alive: true, busy: true, lastActivity: recentIso },
    ];
    expect(isAgentActiveOnProject(beforeStop, agentId, project)).toBe(true);
    // État APRÈS arrêt (correctif) : busy purgé à false.
    const afterStop = [
      { agent: agentId, project, mode: "agent_process", alive: true, busy: false, lastActivity: recentIso },
    ];
    expect(isAgentActiveOnProject(afterStop, agentId, project)).toBe(false);
  });
});
