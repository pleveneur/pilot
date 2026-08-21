// Tests unitaires — agent-activity.js (indicateur d'activité des agents)
// Couvre les fonctions pures : flattenAgents (assistant + codeurs, états
// running/idle/paused), anyBusy (true si ≥1 running), mapping état→libellé
// travail/repos, et formatLastActivity.
import { describe, it, expect } from "vitest";
import { flattenAgents, anyBusy, renderCard, formatLastActivity } from "./agent-activity.js";

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
      label: "Assistant (Magnus)",
      project: "",
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
    expect(list[0]).toMatchObject({ agentId: "default", project: "a", state: "running", busy: true, kind: "agent" });
    expect(list[1]).toMatchObject({ agentId: "reviewer", project: "a", state: "paused", busy: false, kind: "agent" });
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
    const busy = Object.fromEntries(list.map((a) => [a.agentId, a.busy]));
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
