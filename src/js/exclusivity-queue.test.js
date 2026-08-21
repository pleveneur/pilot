// Tests unitaires — exclusivity-queue.js (file d'attente d'exclusivité T5)
import { describe, it, expect } from "vitest";
import {
  exclusivityKey,
  enqueueExclusivity,
  dequeueExclusivity,
  isAgentActiveOnProject,
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
