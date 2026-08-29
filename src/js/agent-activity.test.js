// Tests unitaires — agent-activity.js (indicateur d'activité des agents)
// Couvre les fonctions pures : flattenAgents (assistant + codeurs, états
// running/idle/paused), anyBusy (true si ≥1 running), mapping état→libellé
// travail/repos, et formatLastActivity.
import { describe, it, expect } from "vitest";
import { flattenAgents, anyBusy, renderCard, renderDropdown, formatLastActivity } from "./agent-activity.js";

// Supervision type retournée par get_agent_supervision (dashboard.rs).
function makeSupervision(projects) {
  return { projects };
}

describe("flattenAgents — aplatit la supervision en liste plate", () => {
  it("retourne une liste vide sans projets", () => {
    expect(flattenAgents(null)).toEqual([]);
    expect(flattenAgents({})).toEqual([]);
    expect(flattenAgents({ projects: [] })).toEqual([]);
  });

  it("aplatit l'assistant (projet pseudo-global '') avec kind superagent", () => {
    const sup = makeSupervision([
      {
        path: "",
        name: "Assistant (Magnus)",
        agents: [{ agent: "Assistant (Magnus)", state: "idle", alive: true }],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      agentId: "superagent",
      rawId: "superagent",
      label: "Assistant (Magnus)",
      project: "",
      projectPath: "",
      state: "idle",
      busy: false,
      kind: "superagent",
    });
  });

  it("aplatit les codeurs avec leur projet et kind agent", () => {
    const sup = makeSupervision([
      {
        path: "C:/proj/a",
        name: "a",
        agents: [
          { agent: "default", state: "running", alive: true },
          { agent: "reviewer", state: "paused", alive: true },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      agentId: "default|C:/proj/a", rawId: "default", project: "a", projectPath: "C:/proj/a",
      state: "running", busy: true, kind: "agent",
    });
    expect(list[1]).toMatchObject({
      agentId: "reviewer|C:/proj/a", rawId: "reviewer", project: "a", projectPath: "C:/proj/a",
      state: "paused", busy: false, kind: "agent",
    });
  });

  it("aplatit les agents d'assistant (espace __assistant__) avec kind assistant et étiquette Assistant", () => {
    const sup = makeSupervision([
      {
        path: "__assistant__",
        name: "Assistant",
        agents: [
          { agent: "analyseur", state: "running", alive: true },
          { agent: "codeur", state: "idle", alive: true },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      agentId: "analyseur",
      rawId: "analyseur",
      label: "analyseur",
      project: "Assistant",
      projectPath: "",
      state: "running",
      busy: true,
      kind: "assistant",
    });
    expect(list[1]).toMatchObject({
      agentId: "codeur",
      rawId: "codeur",
      label: "codeur",
      project: "Assistant",
      projectPath: "",
      state: "idle",
      busy: false,
      kind: "assistant",
    });
  });

  it("considère running et compacting comme busy, idle/paused/stopped comme repos", () => {
    const sup = makeSupervision([
      {
        path: "P",
        name: "P",
        agents: [
          { agent: "a", state: "running" },
          { agent: "b", state: "compacting" },
          { agent: "c", state: "idle" },
          { agent: "d", state: "paused" },
          { agent: "e", state: "stopped" },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    // Clé par rawId (id brut), indépendant de l'agentId composite.
    const busy = Object.fromEntries(list.map((a) => [a.rawId, a.busy]));
    expect(busy).toEqual({ a: true, b: true, c: false, d: false, e: false });
  });

  it("remplit lastActivity depuis la map de timestamps", () => {
    const sup = makeSupervision([
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
    ]);
    const map = new Map([["superagent", new Date(2020, 0, 1, 12, 30).getTime()]]);
    const list = flattenAgents(sup, map);
    expect(list[0].lastActivity).toBe("12:30");
  });

  it("rend l'agentId unique quand deux projets portent un agent du même nom", () => {
    const sup = makeSupervision([
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "running" }] },
      { path: "C:/proj/ExtractDoc", name: "ExtractDoc", agents: [{ agent: "codeur", state: "idle" }] },
    ]);
    const list = flattenAgents(sup);
    const ids = list.map((a) => a.agentId);
    // Deux ids distincts malgré le même label (nom court).
    expect(new Set(ids).size).toBe(2);
    expect(list[0].agentId).toBe("codeur|C:/proj/Pilot");
    expect(list[1].agentId).toBe("codeur|C:/proj/ExtractDoc");
    // L'affichage reste lisible : nom court + projet séparé.
    expect(list[0].label).toBe("codeur");
    expect(list[0].project).toBe("Pilot");
    expect(list[1].project).toBe("ExtractDoc");
  });
});

describe("flattenAgents — filtrage des agents de projet sans onglet (visible=false)", () => {
  it("exclut un agent de projet sans onglet (visible=false) au repos", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: false }] },
    ]);
    expect(flattenAgents(sup)).toEqual([]);
  });

  it("garde un agent sans onglet (visible=false) qui travaille (running/compacting)", () => {
    const sup = makeSupervision([
      {
        path: "C:/proj/a",
        name: "a",
        agents: [
          { agent: "codeur", state: "running", visible: false },
          { agent: "docs", state: "compacting", visible: false },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ rawId: "codeur", busy: true, kind: "agent" });
    expect(list[1]).toMatchObject({ rawId: "docs", busy: true, kind: "agent" });
  });

  it("garde un agent avec onglet ouvert (visible=true) même au repos", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0].rawId).toBe("codeur");
  });

  it("ne filtre JAMAIS l'assistant (superagent, projet '') ni les agents d'assistant (__assistant__)", () => {
    const sup = makeSupervision([
      {
        path: "",
        name: "Assistant (Magnus)",
        agents: [{ agent: "Assistant (Magnus)", state: "idle", visible: false }],
      },
      {
        path: "__assistant__",
        name: "Assistant",
        agents: [{ agent: "analyseur", state: "idle", visible: false }],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.kind).sort()).toEqual(["assistant", "superagent"]);
  });

  it("ne filtre PAS quand visible est absent (undefined, backend ancien)", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", alive: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0].rawId).toBe("codeur");
  });

  it("l'agent busy invisible ressort dans anyBusy (le cercle respire toujours)", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "running", visible: false }] },
    ]);
    expect(anyBusy(flattenAgents(sup))).toBe(true);
  });
});

describe("anyBusy — true si au moins un agent travaille", () => {
  it("retourne false pour une liste vide", () => {
    expect(anyBusy([])).toBe(false);
  });

  it("retourne true si au moins un agent est busy (y compris l'assistant)", () => {
    expect(anyBusy([{ busy: false }, { busy: true }])).toBe(true);
    expect(anyBusy([{ busy: true }])).toBe(true);
  });

  it("retourne false si aucun agent n'est busy", () => {
    expect(anyBusy([{ busy: false }, { busy: false }])).toBe(false);
  });
});

describe("renderCard — mapping état → libellé travail/repos", () => {
  it("affiche « Travail » quand l'agent est busy", () => {
    const html = renderCard({ label: "default", project: "a", busy: true, lastActivity: "12:00", kind: "agent", agentId: "default" });
    expect(html).toContain("Travail");
    expect(html).toContain("Afficher l'onglet");
    expect(html).toContain("breathing");
  });

  it("affiche « Repos » quand l'agent est au repos", () => {
    const html = renderCard({ label: "default", project: "a", busy: false, lastActivity: null, kind: "agent", agentId: "default" });
    expect(html).toContain("Repos");
    expect(html).not.toContain("breathing");
  });

  it("ajoute la classe superagent au rond de l'assistant", () => {
    const html = renderCard({ label: "Assistant (Magnus)", project: "", busy: false, lastActivity: null, kind: "superagent", agentId: "superagent" });
    expect(html).toMatch(/agent-activity-item-dot\s+superagent/);
  });

  it("n'ajoute pas la classe superagent pour un agent standard", () => {
    const html = renderCard({ label: "default", project: "a", busy: false, lastActivity: null, kind: "agent", agentId: "default" });
    expect(html).toContain("agent-activity-item-dot");
    expect(html).not.toContain("superagent");
  });
});

describe("renderDropdown — rond par agent dans la liste déroulante", () => {
  it("ajoute la classe superagent au rond de l'assistant", () => {
    const html = renderDropdown([
      { agentId: "superagent", label: "Assistant (Magnus)", project: "", busy: false, kind: "superagent" },
      { agentId: "default", label: "default", project: "a", busy: false, kind: "agent" },
    ]);
    expect(html).toMatch(/agent-activity-item-dot\s+superagent/);
    expect(html).toContain("agent-activity-item-dot");
  });

  it("n'ajoute pas la classe superagent pour un agent standard", () => {
    const html = renderDropdown([{ agentId: "default", label: "default", project: "a", busy: false, kind: "agent" }]);
    expect(html).toContain("agent-activity-item-dot");
    expect(html).not.toContain("superagent");
  });

  it("affiche le nom de l'agent à côté de la pastille", () => {
    const html = renderDropdown([
      { agentId: "superagent", label: "Assistant (Magnus)", project: "", busy: false, kind: "superagent" },
      { agentId: "default", label: "default", project: "projet-a", busy: false, kind: "agent" },
    ]);
    expect(html).toContain("agent-activity-item-label");
    expect(html).toContain("Assistant (Magnus)");
    expect(html).toContain("default");
  });

  it("affiche le projet de l'agent s'il est présent, sinon rien", () => {
    const html = renderDropdown([
      { agentId: "default", label: "default", project: "projet-a", busy: false, kind: "agent" },
      { agentId: "superagent", label: "Assistant (Magnus)", project: "", busy: false, kind: "superagent" },
    ]);
    expect(html).toContain("agent-activity-item-project");
    expect(html).toContain("projet-a");
    // L'assistant (sans projet) ne doit pas générer de span projet.
    const superagentItem = html.match(/data-agent-id="superagent"[\s\S]*?<\/button>/);
    expect(superagentItem[0]).not.toContain("agent-activity-item-project");
  });
});

describe("formatLastActivity", () => {
  it("retourne null sans timestamp", () => {
    expect(formatLastActivity(null)).toBeNull();
    expect(formatLastActivity(undefined)).toBeNull();
    expect(formatLastActivity(0)).toBeNull();
  });

  it("formate un timestamp en heure locale", () => {
    const ts = new Date(2020, 0, 1, 9, 5).getTime();
    expect(formatLastActivity(ts)).toBe("09:05");
  });
});
