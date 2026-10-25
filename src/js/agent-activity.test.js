// Tests unitaires — agent-activity.js (indicateur d'activité des agents)
// Couvre les fonctions pures : flattenAgents (assistant + codeurs, états
// running/idle/paused), anyBusy (true si ≥1 running), mapping état→libellé
// travail/repos, formatLastActivity, le rendu AFFICHAGE SEUL
// renderStaticAgentList (liste déployée du résumé en mode assistant only),
// le store partagé subscribeAgentActivity (mono-source de l'indicateur et du
// résumé immersif) et le montage repliable mountCollapsibleAgentList.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  flattenAgents,
  anyBusy,
  renderCard,
  renderDropdown,
  renderStaticAgentList,
  subscribeAgentActivity,
  getAgentActivitySnapshot,
  mountCollapsibleAgentList,
  formatLastActivity,
  shortMission,
  buildRunningMissions,
  splitMissions,
  renderMissionsPanelHtml,
  MISSION_ROLE_FALLBACK,
  MISSION_RESUME_MAX_CHARS,
  normalizeMissionResume,
  resolveMissionLabel,
  MISSION_ASSISTANT_FALLBACK,
  isAgentWorking,
  isWorkingWithoutTab,
  buildBackgroundWorkMissions,
  renderBackgroundWorkersHtml,
} from "./agent-activity.js";

// Mocks Tauri : le store partagé démarre listen/poll à l'abonnement —
// pilote inhabituel ici : chaque test contrôle invoke via mockResolvedValue et
// déclenche les mises à jour via le handler push capté par listen.
let storeListenHandler = null;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

/** Flush les microtasks (chaîne listen → poll → abonnés) sans timers réels. */
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Invoque le handler push `agent-state-changed` enregistré par le store. */
function pushAgentState(payload) {
  if (!storeListenHandler) throw new Error("store jamais démarré : listen non enregistré");
  storeListenHandler({ payload });
}

/** Pose un listen mocké qui capture le handler push enregistré par le store. */
function installListenCapture() {
  vi.mocked(listen).mockImplementation((_event, handler) => {
    storeListenHandler = handler;
    return Promise.resolve(() => {});
  });
}

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
      projectPath: "__assistant__",
      state: "running",
      busy: true,
      kind: "assistant",
    });
    expect(list[1]).toMatchObject({
      agentId: "codeur",
      rawId: "codeur",
      label: "codeur",
      project: "Assistant",
      projectPath: "__assistant__",
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

  it("garde un agent délégué VIVANT au repos (agent_process, visible=false) — lancé par run_agents, pas encore d'agent_start", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: false, mode: "agent_process", alive: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rawId: "codeur", busy: false, kind: "agent" });
  });

  it("garde aussi les agents d'assistant délégués vivants (assistant_agent, visible=false)", () => {
    // L'espace des agents d'assistant (__assistant__) est déjà jamais filtré :
    // on vérifie ici qu'un délégué assistant_agent sur un VRAI projet passe.
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "transcripteur", state: "idle", visible: false, mode: "assistant_agent", alive: true }] },
    ]);
    expect(flattenAgents(sup)).toHaveLength(1);
  });

  it("filtre toujours un délégué ARRÊTÉ (alive=false) — le process est mort", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "stopped", visible: false, mode: "agent_process", alive: false }] },
    ]);
    expect(flattenAgents(sup)).toEqual([]);
  });

  it("garde un agent de mode main VIVANT sans onglet, même au repos (délégation discrète de l'assistant)", () => {
    // Le lancement discret de l'assistant crée une session de mode `main`
    // (startAgentInvisible) : entre deux tours, elle est alive mais idle et
    // sans onglet — elle doit rester listée (exigence propriétaire).
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: false, mode: "main", alive: true }, { agent: "doc", state: "paused", visible: false, mode: "main", alive: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list.map((a) => a.rawId)).toEqual(["codeur", "doc"]);
    expect(list.every((a) => a.busy === false)).toBe(true);
  });

  it("filtre un agent de mode main NON vivant (alive=false) au repos — agent terminé, pas de faux positif", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "stopped", visible: false, mode: "main", alive: false }] },
    ]);
    expect(flattenAgents(sup)).toEqual([]);
  });

  it("l'agent busy invisible ressort dans anyBusy (le cercle respire toujours)", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "running", visible: false }] },
    ]);
    expect(anyBusy(flattenAgents(sup))).toBe(true);
  });
});

// ── Règle 6 : un agent QUI TRAVAILLE sans onglet ouvert reste VISIBLE dans la
// liste d'activité (verrou anti-régression du filtre assoupli).
// Ces tests ÉCHOUENT si on rétablit l'ancien filtre « visible=false → exclu
// quand !busy, sans regarder `alive` » : le cas d'un agent lancé en
// arrière-plan par `run_agents` (visible=false, sans onglet, au repos entre
// deux tours) disparaissait alors de la liste.
describe("flattenAgents — règle 6 : tout agent VIVANT reste listé (même sans onglet)", () => {
  it("(a) garde un agent de projet VIVANT sans onglet au repos ({ alive: true, visible: false, state: 'idle' })", () => {
    // Aucun `mode` : la règle ne dépend d'AUCUN mode de lancement (main /
    // agent_process / assistant_agent), seulement de la vivacité du process.
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: false, alive: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      agentId: "codeur|C:/proj/a",
      rawId: "codeur",
      project: "a",
      state: "idle",
      busy: false,
      kind: "agent",
    });
    // Le repos ne le fait pas « respirer » : le cercle reste éteint.
    expect(anyBusy(list)).toBe(false);
  });

  it("(b) exclut un agent NON vivant sans onglet ({ alive: false, visible: false }) — pas de faux positif", () => {
    const sup = makeSupervision([
      {
        path: "C:/proj/a",
        name: "a",
        agents: [
          { agent: "codeur", state: "idle", visible: false, alive: false },
          { agent: "docs", state: "stopped", visible: false, alive: false },
        ],
      },
    ]);
    expect(flattenAgents(sup)).toEqual([]);
  });

  it("(c) garde un agent invisible QUI TRAVAILLE, avec busy=true et toolInProgress propagé", () => {
    const sup = makeSupervision([
      {
        path: "C:/proj/a",
        name: "a",
        agents: [
          { agent: "codeur", state: "running", visible: false, alive: true, toolInProgress: true, prompt: "Corriger la recherche" },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rawId: "codeur", state: "running", busy: true, kind: "agent" });
    expect(list[0].toolInProgress).toBe(true);
    expect(list[0].prompt).toBe("Corriger la recherche");
    // Le cercle « respire » : l'agent travaille, même sans onglet.
    expect(anyBusy(list)).toBe(true);
    // Mission visible dans le panneau des missions en cours (outil long inclus).
    expect(buildRunningMissions(list).map((m) => m.mission)).toEqual(["Corriger la recherche"]);
  });

  it("(c bis) un outil long et silencieux (busy=false, toolInProgress=true) reste listé et visible", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "idle", visible: false, alive: true, toolInProgress: true }] },
    ]);
    const list = flattenAgents(sup);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ busy: false, toolInProgress: true });
  });

  it("(d) ne filtre JAMAIS un agent d'assistant (__assistant__) sans onglet, même au repos et non vivant", () => {
    const sup = makeSupervision([
      {
        path: "__assistant__",
        name: "Assistant",
        agents: [
          { agent: "analyseur", state: "idle", visible: false, alive: true },
          { agent: "transcripteur", state: "stopped", visible: false, alive: false },
        ],
      },
    ]);
    const list = flattenAgents(sup);
    expect(list.map((a) => a.rawId)).toEqual(["analyseur", "transcripteur"]);
    expect(list.every((a) => a.kind === "assistant")).toBe(true);
    expect(list.every((a) => a.projectPath === "__assistant__")).toBe(true);
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

describe("renderStaticAgentList — liste déployée du mode assistant only (identique au standard, 30/08)", () => {
  it("affiche l'état vide standard quand la liste est vide", () => {
    const html = renderStaticAgentList([]);
    // Même état vide que la liste standard (agent-activity-empty).
    expect(html).toContain("agent-activity-empty");
    expect(html).toContain("Aucun agent actif");
  });

  it("PARITÉ exacte avec le rendu de la liste standard (renderDropdown)", () => {
    // La liste déployée en mode « Assistant Only » utilise le MÊME rendu
    // d'entrées que la liste du mode normal (mêmes items : pastille + nom +
    // projet + tooltip). Aucun handler d'action n'est branché dessus en mode
    // immersif — cliquer une entrée n'affiche AUCUN détail.
    const list = [
      { agentId: "superagent", rawId: "superagent", label: "Assistant (Magnus)", project: "", busy: false, kind: "superagent" },
      { agentId: "codeur|C:/proj/Pilot", rawId: "codeur", label: "codeur", project: "Pilot", busy: true, kind: "agent" },
    ];
    expect(renderStaticAgentList(list)).toBe(renderDropdown(list));
  });

  it("réutilise les items standard : pastille breathing + style superagent de l'assistant", () => {
    const html = renderStaticAgentList([
      { agentId: "superagent", rawId: "superagent", label: "Assistant (Magnus)", project: "", busy: false, kind: "superagent" },
      { agentId: "codeur|C:/proj/Pilot", rawId: "codeur", label: "codeur", project: "Pilot", busy: true, kind: "agent" },
    ]);
    expect(html).toMatch(/agent-activity-item-dot\s*breathing/);
    expect(html).toMatch(/agent-activity-item-dot\s*superagent/);
    expect(html).toContain('data-kind="superagent"');
  });

  it("échappe le HTML du nom et du projet (rendu sûr du store partagé)", () => {
    const html = renderStaticAgentList([
      { agentId: "x", rawId: "x", label: "<b>bad</b>", project: "a\u0026'b", busy: false, kind: "agent" },
    ]);
    expect(html).not.toContain("<b>bad</b>");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).toContain("a\u0026amp;&#39;b");
  });
});

describe("store partagé — subscribeAgentActivity (mono-source, indicateur standard + affichage seul)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
    installListenCapture();
    // Fake timers : neutralise l'interval partagé du store (les mises à jour
    // sont déclenchées explicitement via pushAgentState, jamais par le temps).
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("notifie l'abonné avec la liste aplatie + busy, re-notifie au push, et stoppe après unsubscribe", async () => {
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "running", visible: false }] },
    ]));

    const cb = vi.fn();
    const unsub = subscribeAgentActivity(cb);
    await flush();

    // Premier poll : notification avec la liste aplatie (même filtrage).
    // Ici l'agent busy sans onglet est CONSERVÉ, l'assistant jamais filtré.
    expect(cb).toHaveBeenCalled();
    const [lastList, lastBusy] = cb.mock.calls[cb.mock.calls.length - 1];
    expect(lastList).toEqual(getAgentActivitySnapshot().list);
    expect(lastList).toHaveLength(2);
    expect(lastList[0]).toMatchObject({ agentId: "superagent", kind: "superagent" });
    expect(lastList[1]).toMatchObject({ rawId: "codeur", busy: true, kind: "agent" });
    expect(lastBusy).toBe(true);

    // Push agent-state-changed → rafraîchissement immédiat + notification.
    cb.mockClear();
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "idle", visible: false }] },
    ]));
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(cb).toHaveBeenCalled();
    const [pushedList, pushedBusy] = cb.mock.calls[cb.mock.calls.length - 1];
    expect(pushedList).toHaveLength(0); // agent au repos sans onglet → filtré
    expect(pushedBusy).toBe(false);

    // Après désabonnement : plus aucune notification (re-push + flush).
    unsub();
    cb.mockClear();
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it("getAgentActivitySnapshot — invariant : liste un tableau (jamais null), busy un booléen", () => {
    // Quoi qu'il arrive (store jamais alimenté ou déjà alimenté par les
    // tests précédents), le snapshot reste consommable tel quel.
    const snap = getAgentActivitySnapshot();
    expect(Array.isArray(snap.list)).toBe(true);
    expect(typeof snap.busy).toBe("boolean");
  });
});

describe("mountCollapsibleAgentList — résumé repliable du mode assistant only (point ⇆ liste)", () => {
  // Hôte factice : capture les listeners et simule un clic sur la zone.
  function makeHost() {
    const listeners = {};
    return {
      innerHTML: "",
      addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
      click() { for (const cb of listeners.click || []) cb({ stopPropagation() {} }); },
    };
  }

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
    installListenCapture();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("replié par défaut : point seul, éteint au repos, qui respire quand un agent travaille", async () => {
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "idle" }] },
    ]));

    const host = makeHost();
    const unsub = mountCollapsibleAgentList(host);

    // Replié dès le montage : point unique, aucun item de liste.
    expect(host.innerHTML).toContain("sa-immersive-dot");
    expect(host.innerHTML).not.toContain("agent-activity-item");

    // Agent au repos → point statique (pas de classe breathing).
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(host.innerHTML).toContain("sa-immersive-dot");
    expect(host.innerHTML).not.toContain("breathing");

    // L'agent démarre (running) → le point respire.
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "running" }] },
    ]));
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(host.innerHTML).toMatch(/sa-immersive-dot\s*breathing/);
    expect(host.innerHTML).not.toContain("agent-activity-item");
    unsub();
  });

  it("clic → la liste se déploie (mêmes items que la liste standard) ; re-clic → repli sur le point ; jamais de fiche", async () => {
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "running" }] },
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
    ]));

    const host = makeHost();
    const unsub = mountCollapsibleAgentList(host);
    pushAgentState({ agentId: "codeur" });
    await flush();

    // Déplier : la liste déployée réutilise le RENDU STANDARD (mêmes entrées
    // que la liste du mode normal : items agent-activity-item avec
    // data-agent-id et tooltip). SEULE différence : aucune fiche/action n'est
    // branchée (pas d'agent-activity-card jamais rendue dans le host).
    host.click();
    expect(host.innerHTML).toContain("sa-immersive-agents-drop");
    expect(host.innerHTML).toContain("agent-activity-item");
    expect(host.innerHTML).toContain('data-kind="agent"');
    expect(host.innerHTML).toContain("codeur");
    expect(host.innerHTML).toContain("Assistant (Magnus)");
    expect(host.innerHTML).toContain("data-agent-id");
    // Aucun détail au clic d'entrée : jamais de fiche, jamais un onglet.
    expect(host.innerHTML).not.toContain("agent-activity-card");
    // Retour 30/08 : le point respirant reste AFFICHÉ EN PERMANENCE à côté de
    // la liste (poignée de fermeture) — il ne disparaît jamais quand on déplie.
    expect(host.innerHTML).toContain("sa-immersive-dot");
    // L'agent déplié est running → le point continue de respirer (breathing).
    expect(host.innerHTML).toMatch(/sa-immersive-dot\s*breathing/);

    // Replier : retour au point unique.
    host.click();
    expect(host.innerHTML).toContain("sa-immersive-dot");
    expect(host.innerHTML).not.toContain("agent-activity-item");
    unsub();
  });

  it("liste DÉPLOYÉE : un agent délégué qui démarre ensuite apparaît automatiquement (raffrachat du store, sans clic) — scénario utilisateur du 29/08", async () => {
    // Au montage : aucun agent connu (l'assistant vient de lancer rien encore).
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
    ]));

    const host = makeHost();
    const unsub = mountCollapsibleAgentList(host);
    // Synchronisation initiale du store (le poll tourne déjà en continu : l'état
    // connu peut contenir des données antérieures au montage de cet onglet).
    pushAgentState({ agentId: "Assistant (Magnus)" });
    await flush();

    // L'utilisateur déplie la liste (un seul clic) : elle ne contient que
    // l'assistant — le délégué n'est pas encore démarré côté superviseur.
    host.click();
    expect(host.innerHTML).toContain("Assistant (Magnus)");
    expect(host.innerHTML).not.toContain("codeur");

    // L'assistant lance un agent via run_agents en arrière-plan : la session
    // est vivante (agent_process, pas d'onglet → visible=false), l'observateur
    // n'a pas encore vu d'agent_start (le poll remonte « idle »). La liste
    // déployée doit afficher cet agent SANS aucun clic, au prochain cycle.
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
      { path: "C:/proj/Pilot", name: "Pilot", agents: [{ agent: "codeur", state: "idle", visible: false, mode: "agent_process", alive: true }] },
    ]));
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(host.innerHTML).toContain("codeur");
    expect(host.innerHTML).toContain("Pilot");
    expect(host.innerHTML).toContain('data-kind="agent"');
    // Mêmes items que la liste standard (parité) — mais strictement
    // informatif : le rendu contient les items standard (data-agent-id comme
    // dans la référence) JAMAIS de fiche (aucun handler d'action branché).
    expect(host.innerHTML).toContain("agent-activity-item");
    expect(host.innerHTML).not.toContain("agent-activity-card");

    // L'agent s'arrête (process tué en fin de run) : il disparaît de la liste.
    vi.mocked(invoke).mockResolvedValue(makeSupervision([
      { path: "", name: "Assistant (Magnus)", agents: [{ agent: "Assistant (Magnus)", state: "idle" }] },
    ]));
    pushAgentState({ agentId: "codeur" });
    await flush();
    expect(host.innerHTML).not.toContain("codeur");
    expect(host.innerHTML).toContain("Assistant (Magnus)");
    unsub();
  });

  it("mountCollapsibleAgentList(null) reste inoffensif (désabonnement no-op)", () => {
    const unsub = mountCollapsibleAgentList(null);
    expect(() => unsub()).not.toThrow();
  });
});

// ── Missions en cours (onglet « En cours » du panneau de la cloche) ──
// Règle du propriétaire : seules les missions RÉELLEMENT en cours s'affichent ;
// un agent au repos est masqué ; un agent occupé — même silencieux (outil long) —
// ne disparaît jamais ; une mission en file est marquée « en attente ».
describe("shortMission — texte de mission court et lisible", () => {
  it("garde un texte court tel quel", () => {
    expect(shortMission("Corriger la recherche globale")).toBe("Corriger la recherche globale");
  });

  it("tronque un texte long à 120 caractères avec « … »", () => {
    const long = "x".repeat(200);
    const got = shortMission(long);
    expect(got).toBe("x".repeat(120) + "…");
    expect(Array.from(got).length).toBe(121);
  });

  it("coupe PROPREMENT sur un mot (jamais au milieu) et signale la coupe", () => {
    const long =
      "Corriger la recherche globale dans tous les fichiers du projet sans rien casser et sans perdre la selection courante de l'utilisateur";
    const got = shortMission(long);
    expect(got.endsWith("…")).toBe(true);
    expect(Array.from(got).length).toBeLessThanOrEqual(121);
    // Aucun mot tronqué : le texte conservé est un préfixe complet du texte.
    const kept = got.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });

  it("extrait le titre d'une ligne « Tâche : » (orchestration, y compris retries)", () => {
    const text = [
      "Tu es un codeur. Contexte : projet Pilot.",
      "",
      "Tâche : Corriger la recherche globale par dossier",
      "",
      "Fichiers : src/js/search.js",
    ].join("\n");
    expect(shortMission(text)).toBe("Corriger la recherche globale par dossier");
  });

  it("extrait aussi le titre d'une ligne « Tâche : » en gras markdown", () => {
    expect(shortMission("**Tâche :** Réparer le diff inline")).toBe("Réparer le diff inline");
  });

  it("ignore les en-têtes MÉCANIQUES et prend la phrase de la section « Objectif »", () => {
    const text = [
      "## Contexte",
      "Pilot est un editeur de texte pour agents IA.",
      "",
      "## Objectif",
      "Corriger la cloche.",
    ].join("\n");
    // Ni « Contexte » (titre de structure) ni son contenu : la TÂCHE demandée.
    expect(shortMission(text)).toBe("Corriger la cloche.");
  });

  it("ignore aussi les en-têtes mécaniques en GRAS (## Contexte / **Objectif**)", () => {
    const text = [
      "**## Contexte**",
      "Reprendre le panneau de la cloche.",
      "",
      "**Objectif**",
      "Afficher la tache en cours.",
      "",
      "## Consignes",
      "Ne pas toucher au CSS.",
      "",
      "## Ce qu'il ne faut PAS faire",
      "Tout casser.",
    ].join("\n");
    expect(shortMission(text)).toBe("Afficher la tache en cours.");
  });

  it("garde « Tâche : » PRIORITAIRE même après des en-têtes mécaniques", () => {
    const text = [
      "## Contexte",
      "On reprend le panneau de la cloche.",
      "Tâche : Afficher la tache en cours sous l'agent",
    ].join("\n");
    expect(shortMission(text)).toBe("Afficher la tache en cours sous l'agent");
  });

  it("n'affiche JAMAIS le RÔLE d'un agent sans tâche : repli honnête « mission non communiquée »", () => {
    const role =
      "Tu es un planificateur logiciel. Tu recois une demande de modification et tu produis un PLAN STRUCTURE en JSON.";
    // Plus jamais « en préparation » (libellé qui ne dit rien de la tâche).
    expect(shortMission(role)).toBe("mission non communiquée");
    expect(shortMission("Vous etes une equipe de testeurs.")).toBe("mission non communiquée");
    expect(MISSION_ROLE_FALLBACK).not.toBe("en préparation");
  });

  it("sur un VRAI prompt de délégation, affiche la phrase de l'OBJECTIF (pas le rôle, pas « en préparation »)", () => {
    // Forme EXACTE produite par `buildAgentPrompt` (agents.js) : rôle, bloc de
    // spécialité, bloc de rôle, contexte projet, puis `=== MISSION ===` avec les
    // sections `## Contexte` / `## Objectif` / `## Consignes`. Le texte est la
    // fenêtre de 600 caractères conservée par le cœur (agent_service.rs).
    const real = [
      "Tu es un développeur. Tu exécutes la micro-tâche reçue. Tu lis les fichiers avec les outils à ta disposition. Tu modifies UNIQUEMENT les fichiers nécessaires. Termine par DONE: <résumé>.",
      "",
      "=== SPÉCIALITÉ ===",
      "Rôle : Tu es un développeur. Tu exécutes la micro-tâche reçue. Tu lis les fichiers…",
      "Capacités : write, edit",
      "",
      "=== RÔLE ===",
      "Tu es le CODEUR (agent principal) de ce projet : tu es autorisé à MODIFIER les fichiers de code.",
      "",
      "=== MISSION ===",
      "## Contexte de suivi (assistant)",
      "- Projet : G:\\IA_PL\\pilot",
      "- Taches suivies : 23 en cours, 247 terminees",
      "",
      "## Contexte",
      "Le texte d'indication du panneau est faux dans la plupart des cas.",
      "",
      "## Objectif",
      "Contexte : version en cours 0.4.37.",
      "Objectif : faire que la ligne d indication dise en UNE PHRASE COURTE la tache reelle.",
      "",
      "## Consignes",
      "1. Ecris d abord un rapport court sur disque.",
    ].join("\n");
    const got = shortMission(real);
    expect(got).toBe("faire que la ligne d indication dise en UNE PHRASE COURTE la tache reelle.");
    expect(got).not.toContain("Tu es");
    expect(got).not.toBe("en préparation");
    expect(got).not.toBe("mission non communiquée");
  });

  it("après un préambule de rôle et des bandeaux, prend la première ligne de tâche réelle", () => {
    expect(
      shortMission("Tu es un codeur.\n\n=== RÔLE ===\nTu es le CODEUR.\n\nCorriger la cloche")
    ).toBe("Corriger la cloche");
  });

  it("prend la première ligne significative en sautant fences et markdown", () => {
    const text = ["```", "code ignoré", "```", "", "# Corriger le zoom", "suite"].join("\n");
    expect(shortMission(text)).toBe("Corriger le zoom");
    expect(shortMission("- Corriger le zoom")).toBe("Corriger le zoom");
    expect(shortMission("> Corriger le zoom")).toBe("Corriger le zoom");
  });

  it("replie sur « (demande non précisée) » pour un texte vide ou inconnu", () => {
    expect(shortMission("")).toBe("(demande non précisée)");
    expect(shortMission("   \n  \n")).toBe("(demande non précisée)");
    expect(shortMission(null)).toBe("(demande non précisée)");
    expect(shortMission(undefined)).toBe("(demande non précisée)");
  });
});

describe("buildRunningMissions — missions réellement en cours", () => {
  const agent = (over) => ({
    agentId: "codeur|/p/pilot",
    label: "codeur",
    project: "pilot",
    busy: false,
    toolInProgress: false,
    prompt: "",
    ...over,
  });

  it("masque un agent AU REPOS (idle/paused/stopped)", () => {
    expect(buildRunningMissions([agent({ busy: false, state: "idle" })])).toEqual([]);
    expect(buildRunningMissions([agent({ busy: false, state: "paused" })])).toEqual([]);
  });

  it("affiche un agent OCCUPÉ avec sa mission", () => {
    const got = buildRunningMissions([agent({ busy: true, prompt: "Corriger la recherche globale" })]);
    expect(got).toEqual([
      { agent: "codeur", project: "pilot", mission: "Corriger la recherche globale", waiting: false },
    ]);
  });

  it("n'affiche JAMAIS vide : repli explicite si la mission est introuvable", () => {
    const got = buildRunningMissions([agent({ busy: true, prompt: "" })]);
    expect(got[0].mission).toBe("(demande non précisée)");
  });

  it("garde un agent occupé SILENCIEUX (outil long : compilation, tests)", () => {
    const got = buildRunningMissions([
      agent({ busy: false, toolInProgress: true, prompt: "Lancer les tests" }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].mission).toBe("Lancer les tests");
  });

  it("affiche l'Assistant en travail, avec le projet « Assistant » par défaut", () => {
    const got = buildRunningMissions([
      { label: "Magnus", project: "", busy: true, toolInProgress: false, prompt: "Faire le point" },
    ]);
    expect(got).toEqual([
      { agent: "Magnus", project: "Assistant", mission: "Faire le point", waiting: false },
    ]);
  });

  it("ajoute les missions EN ATTENTE avec waiting=true", () => {
    const got = buildRunningMissions(
      [agent({ busy: true, prompt: "Tâche A" })],
      [{ project: "pilot", mission: "Tâche B (en file)" }]
    );
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({
      agent: "",
      project: "pilot",
      mission: "Tâche B (en file)",
      waiting: true,
    });
  });

  it("tolère une liste absente ou vide", () => {
    expect(buildRunningMissions(null, null)).toEqual([]);
    expect(buildRunningMissions([], [])).toEqual([]);
  });
});

// ── Panneau (bas à droite) : deux groupes explicites et numérotés ──
// Règle du propriétaire : voir d'un coup d'œil ce qui est EN COURS et ce qui est
// EN ATTENTE, dans l'ordre de la file, avec l'agent et le projet de chacune.
describe("renderMissionsPanelHtml — en cours et en attente, séparés et numérotés", () => {
  const running = { agent: "codeur", project: "pilot", mission: "Corriger la cloche", waiting: false };
  const queuedA = { agent: "testeur", project: "pilot", mission: "Lancer les tests", waiting: true };
  const queuedB = { agent: "reviewer", project: "gds", mission: "Relire le diff", waiting: true };

  it("sépare les deux groupes et les numérote", () => {
    expect(splitMissions([running, queuedA, queuedB])).toEqual({
      running: [running],
      waiting: [queuedA, queuedB],
    });
    const html = renderMissionsPanelHtml([running, queuedA, queuedB]);
    // Deux titres de groupe EXPLICITES, avec leur compte.
    expect(html).toContain("En cours (1)");
    expect(html).toContain("En attente (2)");
    // Ordre de la file rendu par les rangs. L'AGENT et le PROJET restent sur la
    // ligne principale (disposition d'origine conservée) ; le texte
    // d'indication de la tâche vient EN DESSOUS, sur la ligne secondaire.
    expect(html).toContain('<span class="sa-missions-rank">1.</span>testeur — pilot');
    expect(html).toContain('<span class="sa-missions-rank">2.</span>reviewer — gds');
    expect(html).toContain('<div class="sa-task-meta">Lancer les tests</div>');
    expect(html).toContain('<div class="sa-task-meta">Relire le diff</div>');
    // Groupe « en cours » AVANT le groupe « en attente ».
    expect(html.indexOf("En cours (1)")).toBeLessThan(html.indexOf("En attente (2)"));
    // Chaque ligne dit la mission, l'agent et le projet.
    expect(html).toContain("codeur — pilot");
    expect(html).toContain("Corriger la cloche");
    expect(html).toContain("en attente");
  });

  // POSITION FIGÉE (décision du propriétaire, disposition d'origine) : l'agent
  // et le projet d'abord, le texte d'indication de la tâche EN DESSOUS. Un futur
  // changement qui remettrait le résumé au-dessus doit faire rougir ces tests.
  it("garde l'agent et le projet AU-DESSUS, le texte de mission EN DESSOUS", () => {
    const html = renderMissionsPanelHtml([running]);
    // L'agent et le projet apparaissent AVANT la mission dans le document.
    expect(html.indexOf("codeur — pilot")).toBeLessThan(html.indexOf("Corriger la cloche"));
    // L'agent et le projet sont dans le TITRE de la ligne…
    expect(html).toContain('<span class="sa-task-title"><span class="sa-missions-rank">1.</span>codeur — pilot</span>');
    // …et la mission dans la MÉTA, c'est-à-dire la ligne du dessous.
    expect(html).toContain('<div class="sa-task-meta">Corriger la cloche</div>');
    // Le titre (agent/projet) précède la méta (mission) dans le balisage.
    expect(html.indexOf('class="sa-task-title"')).toBeLessThan(html.indexOf('class="sa-task-meta"'));
  });

  it("affiche seulement le groupe qui a du contenu", () => {
    const onlyWaiting = renderMissionsPanelHtml([queuedA]);
    expect(onlyWaiting).toContain("En attente (1)");
    expect(onlyWaiting).not.toContain("En cours (");
    const onlyRunning = renderMissionsPanelHtml([running]);
    expect(onlyRunning).toContain("En cours (1)");
    expect(onlyRunning).not.toContain("En attente (");
  });

  it("message explicite quand il n'y a aucune mission (jamais une liste vide)", () => {
    expect(renderMissionsPanelHtml([])).toContain("Aucune mission en cours");
    expect(renderMissionsPanelHtml(null)).toContain("Aucune mission en cours");
  });

  it("affiche la mission réelle d'un agent (phrase de l'objectif), jamais « en préparation »", () => {
    const missions = buildRunningMissions([
      {
        label: "codeur",
        project: "pilot",
        busy: true,
        toolInProgress: false,
        prompt:
          "Tu es un développeur. Tu exécutes la micro-tâche reçue.\n\n=== SPÉCIALITÉ ===\nRôle : Tu es un développeur.\nCapacités : write, edit\n\n=== RÔLE ===\nTu es le CODEUR.\n\n=== MISSION ===\n## Objectif\nObjectif : afficher la tâche réelle dans le panneau.",
      },
    ]);
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("afficher la tâche réelle dans le panneau.");
    expect(html).not.toContain("en préparation");
    expect(html).not.toContain("Tu es");
  });
});

// ── RÉSUMÉ COURT FOURNI AVEC LA DEMANDE (`resume`) ──
// Le remède à « le panneau affiche une phrase déduite du prompt » : la demande
// porte elle-même son résumé court. Ordre de repli STRICT (jamais inventé) :
// resume fourni → objectif extrait du prompt → libellé honnête.
describe("normalizeMissionResume / resolveMissionLabel — résumé fourni", () => {
  it("rend le résumé FOURNI tel quel (seulement nettoyé)", () => {
    expect(normalizeMissionResume("  Corriger l'affichage   du panneau  ")).toBe(
      "Corriger l'affichage du panneau"
    );
    expect(normalizeMissionResume("Ligne 1\nLigne 2\ttab")).toBe("Ligne 1 Ligne 2 tab");
    // Un résumé fourni est affiché TEL QUEL, sans réécriture ni extraction.
    expect(resolveMissionLabel("Corriger la cloche", "## Objectif\nObjectif : autre chose"))
      .toBe("Corriger la cloche");
  });

  it("tronque proprement un résumé trop long (plafond 120, coupe sur un mot)", () => {
    const long = "Mot " .repeat(60).trim(); // 239 caractères
    const out = normalizeMissionResume(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(MISSION_RESUME_MAX_CHARS + 1); // « … »
    expect(out.endsWith("…")).toBe(true);
    expect(out.endsWith("Mo…")).toBe(false); // jamais au milieu d'un mot
    expect(out.startsWith("Mot Mot")).toBe(true);
    // Un texte pile à la limite n'est PAS coupé.
    const exact = "a".repeat(MISSION_RESUME_MAX_CHARS);
    expect(normalizeMissionResume(exact)).toBe(exact);
  });

  it("résumé absent → repli sur l'objectif extrait du prompt", () => {
    expect(resolveMissionLabel("", "## Objectif\nObjectif : afficher la tâche réelle.")).toBe(
      "afficher la tâche réelle."
    );
    expect(resolveMissionLabel(null, "## Objectif\nObjectif : afficher la tâche réelle.")).toBe(
      "afficher la tâche réelle."
    );
    expect(resolveMissionLabel("   ", "## Objectif\nObjectif : afficher la tâche réelle.")).toBe(
      "afficher la tâche réelle."
    );
  });

  it("résumé absent ET objectif introuvable → libellé HONNÊTE", () => {
    expect(resolveMissionLabel("", "Tu es le CODEUR.\nRôle : Tu es un développeur.")).toBe(
      MISSION_ROLE_FALLBACK
    );
    expect(resolveMissionLabel("", "")).toBe("(demande non précisée)");
  });

  it("n'invente JAMAIS de résumé (aucune valeur par défaut, aucun texte généré)", () => {
    expect(normalizeMissionResume(undefined)).toBe("");
    expect(normalizeMissionResume(null)).toBe("");
    expect(normalizeMissionResume(42)).toBe("");
    expect(normalizeMissionResume({})).toBe("");
    // Un repli qui ne trouve rien reste un libellé HONNÊTE (« mission non
    // communiquée » ou « (demande non précisée) »), jamais une phrase fabriquée
    // à partir du rôle.
    expect([MISSION_ROLE_FALLBACK, "(demande non précisée)"]).toContain(
      resolveMissionLabel(42, "Rôle : Tu es un développeur.")
    );
    expect(resolveMissionLabel(42, "")).toBe("(demande non précisée)");
  });

  it("le panneau affiche le résumé fourni, en cours comme EN ATTENTE", () => {
    const missions = buildRunningMissions(
      [
        {
          label: "codeur",
          project: "pilot",
          busy: true,
          resume: "Corriger la cloche",
          prompt: "## Objectif\nObjectif : texte technique long à ne pas afficher.",
        },
      ],
      [{ project: "pilot", mission: "libellé de file", resume: "Relancer les tests" }]
    );
    expect(missions[0].mission).toBe("Corriger la cloche");
    expect(missions[1].mission).toBe("Relancer les tests");
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("Corriger la cloche");
    expect(html).toContain("Relancer les tests");
    expect(html).not.toContain("texte technique long");
    // Le résumé fourni est le texte d'indication, PLACÉ SOUS l'agent et le
    // projet (position historique, décision du propriétaire).
    expect(html.indexOf("codeur — pilot")).toBeLessThan(html.indexOf("Corriger la cloche"));
    expect(html).toContain('<div class="sa-task-meta">Corriger la cloche</div>');
    expect(html).toContain('<div class="sa-task-meta">Relancer les tests</div>');
  });

  it("garde le résumé SOUS l'agent et le projet, dans les DEUX groupes", () => {
    // File de deux missions : une en cours, une en attente. Dans les deux cas,
    // la ligne principale porte l'agent et le projet, le résumé vient dessous.
    const missions = buildRunningMissions(
      [
        {
          label: "codeur",
          project: "pilot",
          busy: true,
          resume: "Corriger la cloche",
          prompt: "## Objectif\nObjectif : texte technique long à ne pas afficher.",
        },
      ],
      [{ agent: "testeur", project: "gds", mission: "libellé de file", resume: "Relancer les tests" }]
    );
    const html = renderMissionsPanelHtml(missions);
    // Groupe « en cours » : agent d'abord, résumé ensuite.
    expect(html.indexOf("codeur — pilot")).toBeLessThan(html.indexOf("Corriger la cloche"));
    // Groupe « en attente » : agent d'abord, résumé ensuite.
    expect(html.indexOf("testeur — gds")).toBeLessThan(html.indexOf("Relancer les tests"));
    // Les deux résumés sont dans la ligne secondaire, jamais dans le titre.
    expect(html).toContain('<div class="sa-task-meta">Corriger la cloche</div>');
    expect(html).toContain('<div class="sa-task-meta">Relancer les tests</div>');
    expect(html).not.toContain('<span class="sa-task-title"><span class="sa-missions-rank">1.</span>Corriger la cloche');
  });

  it("sans résumé, la mission en attente reprend son libellé (comportement inchangé)", () => {
    const missions = buildRunningMissions([], [{ project: "gds", mission: "Objectif : relire le diff" }]);
    // Aucun résumé inventé : le libellé de la file est seulement raccourci comme
    // avant (préfixe « Objectif : » retiré par shortMission).
    expect(missions[0].mission).toBe("relire le diff");
  });
});

// ── Panneau des tâches : l'ASSISTANT n'affiche jamais un fragment de ses règles ──
// Son `prompt` n'est pas une demande : c'est TOUT son prompt système (rôle +
// règles figées + contexte) suivi de la demande. Le lire faisait afficher
// « Si une tâche déléguée ou une action échoue… » (règle de résilience) au lieu
// d'une phrase disant ce qu'il fait. La mission est donc fournie à part
// (`resume`, cf. `super_agent_mission_resume` côté Rust) ; sans elle, l'affichage
// se replie sur une phrase neutre et vraie, jamais sur les règles.
const ASSISTANT_PROMPT_SYSTEME =
  "Tu es « Magnus », l'assistant de suivi multi-projets de Pilot. Tu es strictement en lecture seule : " +
  "tu ne modifies jamais les fichiers des projets.\n\n" +
  "## Résilience et anti-boucle — `run_agents`\n" +
  "Construis toujours une demande STRUCTURÉE et COMPLÈTE. L'enveloppe " +
  "« ## Contexte/## Objectif/## Consignes/## Ce qu'il ne faut PAS faire » est ajoutée " +
  "MÉCANIQUEMENT par Pilot : n'insère que le contenu de la tâche.\n\n" +
  "Si une tâche déléguée ou une action échoue (échec EXPLICITE : compte-rendu reçu — le silence " +
  "n'est JAMAIS un échec), relance AU MOINS UNE FOIS en changeant d'approche.";

describe("panneau des tâches — l'assistant n'affiche JAMAIS ses règles", () => {
  it("affiche la DEMANDE portée par l'assistant (résumé fourni)", () => {
    const got = buildRunningMissions([
      {
        label: "Magnus",
        project: "",
        kind: "superagent",
        busy: true,
        resume: "Faire le point sur les tâches du projet GDS",
        prompt: ASSISTANT_PROMPT_SYSTEME,
      },
    ]);
    expect(got).toEqual([
      {
        agent: "Magnus",
        project: "Assistant",
        mission: "Faire le point sur les tâches du projet GDS",
        waiting: false,
      },
    ]);
  });

  it("sans résumé : repli NEUTRE et VRAI, jamais un extrait des règles", () => {
    const got = buildRunningMissions([
      { label: "Magnus", project: "", kind: "superagent", busy: true, prompt: ASSISTANT_PROMPT_SYSTEME },
    ]);
    expect(got[0].mission).toBe(MISSION_ASSISTANT_FALLBACK);
    for (const fragment of [
      "Si une tâche déléguée",
      "relance AU MOINS UNE FOIS",
      "##",
      "lecture seule",
      "Résilience",
      "MÉCANIQUEMENT",
    ]) {
      expect(got[0].mission).not.toContain(fragment);
    }
    // Le panneau rendu ne laisse RIEN passer des règles non plus.
    const html = renderMissionsPanelHtml(got);
    expect(html).toContain(`<div class="sa-task-meta">${MISSION_ASSISTANT_FALLBACK}</div>`);
    expect(html).not.toContain("Si une tâche déléguée");
    expect(html).not.toContain("## Objectif");
  });

  it("ne change RIEN pour un agent de projet (extraction de l'objectif inchangée)", () => {
    // Prompt de la MÊME FORME que `buildAgentPrompt` : un vrai titre « ## Objectif ».
    const prompt =
      "Tu es un développeur. Tu exécutes la micro-tâche reçue.\n\n=== MISSION ===\n" +
      "## Contexte\nPilot est un éditeur de texte pour agents IA.\n\n" +
      "## Objectif\nObjectif : afficher la tâche réelle des agents dans le panneau.";
    const withKind = buildRunningMissions([
      { label: "codeur", project: "pilot", kind: "agent", busy: true, prompt },
    ]);
    const historical = buildRunningMissions([{ label: "codeur", project: "pilot", busy: true, prompt }]);
    expect(withKind[0].mission).toBe("afficher la tâche réelle des agents dans le panneau.");
    // Comportement STRICTEMENT inchangé par rapport à l'appel historique (sans kind).
    expect(withKind).toEqual(historical);
    // L'extraction directe reste la même (aucun découpage ajouté).
    expect(resolveMissionLabel("", prompt, "agent")).toBe(shortMission(prompt));
  });
});

// ── Regle 1/2 : « travaille sans onglet » visible dans la LISTE DES AGENTS ──
// Un agent qui travaille sans onglet ouvert (lance en arriere-plan, ou dont
// l'onglet a ete ferme) doit apparaitre dans la liste, et l'entree doit DIRE
// qu'il travaille en arriere-plan. La verite est « il travaille », jamais
// « un onglet est ouvert ».

/** Session de projet telle que flattenAgents la recoit (supervision). */
function session(over) {
  return { path: "C:/proj/pilot", name: "pilot", agents: [{ agent: "codeur", alive: true, ...over }] };
}

describe("isAgentWorking / isWorkingWithoutTab — travail effectif", () => {
  it("un agent qui produit, ou dont un outil est en cours, travaille", () => {
    expect(isAgentWorking({ busy: true })).toBe(true);
    expect(isAgentWorking({ busy: false, toolInProgress: true })).toBe(true);
    expect(isAgentWorking({ working: true })).toBe(true);
  });

  // Fenetre backend de 2 minutes (`isWorking`, WORKING_RECENT_WINDOW_SECS =
  // 120 dans agent_service.rs) : elle reste vraie 120 s apres la fin d'un tour,
  // alors que `state` publie deja « idle ». L'interface ne doit PAS la lire :
  // c'est elle qui faisait « respirer » la barre de saisie de l'assistant et
  // les pastilles alors que plus rien ne tournait.
  it("la fenetre « actif recemment » (isWorking) n'est PAS du travail : idle + isWorking = repos", () => {
    const agentRecemmentActif = {
      state: "idle",
      alive: true,
      busy: false,
      toolInProgress: false,
      isWorking: true,
    };
    // 1. La fonction pure de verite ne le compte pas comme travaillant.
    expect(isAgentWorking(agentRecemmentActif)).toBe(false);
    expect(anyBusy([agentRecemmentActif])).toBe(false);
    // 2. La liste aplatie non plus (c'est elle que consomme super-agent.js
    //    pour la classe `superagent-input-reflecting` et les pastilles).
    const list = flattenAgents(makeSupervision([session(agentRecemmentActif)]));
    expect(list).toHaveLength(1);
    expect(list[0].working).toBe(false);
    expect(list[0].workingSince).toBeNull();
    expect(isAgentWorking(list[0])).toBe(false);
    expect(anyBusy(list)).toBe(false);
    expect(isWorkingWithoutTab(list[0])).toBe(false);
  });

  it("un agent REELLEMENT au travail s'allume toujours (busy, puis outil long)", () => {
    const enProduction = { state: "running", alive: true, busy: true, toolInProgress: false, isWorking: true };
    expect(isAgentWorking(enProduction)).toBe(true);
    const listProd = flattenAgents(makeSupervision([session(enProduction)]));
    expect(listProd[0].working).toBe(true);
    expect(anyBusy(listProd)).toBe(true);
    // Outil long et silencieux : `busy` faux mais un outil tourne reellement.
    const outilLong = { state: "idle", alive: true, busy: false, toolInProgress: true, isWorking: true };
    expect(isAgentWorking(outilLong)).toBe(true);
    const listOutil = flattenAgents(makeSupervision([session(outilLong)]));
    expect(listOutil[0].working).toBe(true);
    expect(anyBusy(listOutil)).toBe(true);
  });

  it("un agent vivant AU REPOS ne travaille pas", () => {
    expect(isAgentWorking({ busy: false, state: "idle", alive: true, visible: true })).toBe(false);
    expect(isAgentWorking(null)).toBe(false);
    expect(isAgentWorking(undefined)).toBe(false);
  });

  it("« travaille sans onglet » exige un travail effectif ET aucun onglet", () => {
    expect(isWorkingWithoutTab({ busy: true, visible: false })).toBe(true);
    expect(isWorkingWithoutTab({ busy: true, visible: true })).toBe(false);
    expect(isWorkingWithoutTab({ busy: false, visible: false })).toBe(false);
    // Visibilite inconnue (backend ancien) : on n'affirme rien.
    expect(isWorkingWithoutTab({ busy: true })).toBe(false);
  });
});

describe("flattenAgents — travail effectif et visibilite d'onglet propages", () => {
  it("propage working / visible pour une session qui travaille sans onglet", () => {
    const list = flattenAgents(makeSupervision([session({ state: "running", visible: false, alive: true })]));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ working: true, visible: false, busy: true });
    expect(isWorkingWithoutTab(list[0])).toBe(true);
  });

  it("un outil long silencieux reste du TRAVAIL, meme sans onglet", () => {
    const list = flattenAgents(
      makeSupervision([session({ state: "idle", visible: false, alive: true, toolInProgress: true })])
    );
    expect(list).toHaveLength(1);
    expect(list[0].working).toBe(true);
    expect(isWorkingWithoutTab(list[0])).toBe(true);
  });

  it("une session qui TRAVAILLE est listee meme si `alive` est momentanement faux (demarrage)", () => {
    // Discriminant : outil long en cours, `busy` faux et processus pas encore
    // vu vivant. L'ancienne regle (filtre sur `busy` puis sur `alive`) ecartait
    // cette session alors qu'elle travaille.
    const list = flattenAgents(
      makeSupervision([session({ state: "idle", visible: false, alive: false, toolInProgress: true })])
    );
    expect(list).toHaveLength(1);
    expect(list[0].working).toBe(true);
  });

  it("une session VIVANTE mais AU REPOS n'est pas presentee comme travaillante", () => {
    const list = flattenAgents(makeSupervision([session({ state: "idle", visible: false, alive: true })]));
    expect(list).toHaveLength(1);
    expect(list[0].working).toBe(false);
    expect(anyBusy(list)).toBe(false);
    expect(isWorkingWithoutTab(list[0])).toBe(false);
  });

  it("une session MORTE sans onglet ne laisse aucune entree fantome", () => {
    const list = flattenAgents(makeSupervision([session({ state: "stopped", visible: false, alive: false })]));
    expect(list).toEqual([]);
    expect(buildBackgroundWorkMissions(list)).toEqual([]);
  });
});

describe("renderDropdown — la liste des agents (haut droite) ne dit JAMAIS « arriere-plan »", () => {
  it("une session qui travaille sans onglet garde son entree (agent, projet, nom en gras) SANS mention « arriere-plan »", () => {
    const list = flattenAgents(makeSupervision([session({ state: "running", visible: false, alive: true, prompt: "Corriger la recherche" })]));
    const html = renderDropdown(list);
    // Le signal « travaille sans onglet » reste porte, mais SILENCIEUSEMENT :
    // classe de style + pastille respirante. Plus aucun chip, plus aucun texte.
    expect(html).toContain("working-background");
    expect(html).toContain("codeur");
    expect(html).toContain("pilot");
    // La pastille respire : la session travaille, onglet ou non.
    expect(html).toMatch(/agent-activity-item-dot\s*breathing/);
    // Le mot a disparu de la liste, chip ET infobulle comprises.
    expect(html).not.toContain("arrière-plan");
    expect(html).not.toContain("agent-activity-item-bg");
  });

  it("n'affiche AUCUNE mention « arriere-plan » pour un agent avec onglet ouvert", () => {
    const list = flattenAgents(makeSupervision([session({ state: "running", visible: true, alive: true })]));
    const html = renderDropdown(list);
    expect(html).not.toContain("agent-activity-item-bg");
    expect(html).not.toContain("working-background");
    expect(html).not.toContain("arrière-plan");
  });

  it("n'affiche AUCUNE mention « arriere-plan » pour une session vivante au repos", () => {
    const list = flattenAgents(makeSupervision([session({ state: "idle", visible: false, alive: true })]));
    const html = renderDropdown(list);
    expect(html).toContain("agent-activity-item-label");
    expect(html).not.toContain("agent-activity-item-bg");
    expect(html).not.toContain("arrière-plan");
    expect(html).not.toMatch(/agent-activity-item-dot\s*breathing/);
  });

  it("fige l'absence du mot pour TOUS les etats, y compris la liste en affichage seul (mode immersif)", () => {
    // Discriminant : le rendu de la liste est PARTAGE entre la liste deroulante
    // standard et le resume repliable du mode « Assistant Only » immersif
    // (`renderStaticAgentList`). Les deux doivent etre muets.
    const list = flattenAgents(
      makeSupervision([
        session({ state: "running", visible: false, alive: true }),
        session({ agent: "reviewer", state: "running", visible: true, alive: true }),
        session({ agent: "planificateur", state: "idle", visible: false, alive: true }),
      ])
    );
    for (const html of [renderDropdown(list), renderStaticAgentList(list)]) {
      expect(html).not.toContain("arrière-plan");
      expect(html).not.toContain("arriere-plan");
      expect(html).not.toContain("agent-activity-item-bg");
      // Aucune trace laissee par le retrait : ni separateur orphelin, ni
      // parentheses vides, ni double espace dans un libelle/infobulle, ni
      // ponctuation isolee.
      expect(html).not.toMatch(/—\s*[<|"]/);
      expect(html).not.toContain("()");
      expect(html).not.toMatch(/\s—\s*$/m);
      // Infobulle = nom, et projet s'il existe : « nom — projet », rien de plus.
      for (const title of html.match(/title="[^"]*"/g) || []) {
        expect(title).not.toMatch(/\s{2,}/);
        expect(title).not.toMatch(/—\s*"/);
      }
    }
    // Les informations affichees restent identiques : agent + projet + pastille.
    expect(renderDropdown(list)).toContain("agent-activity-item-project");
    expect(renderDropdown(list)).toMatch(/agent-activity-item-dot\s*breathing/);
  });
});

describe("renderCard — fiche d'une session qui travaille sans onglet", () => {
  it("dit « Travail (arriere-plan) » et « Onglet : Aucun »", () => {
    const html = renderCard({
      agentId: "codeur|C:/proj/pilot",
      label: "codeur",
      project: "pilot",
      busy: true,
      visible: false,
      lastActivity: "12:00",
      kind: "agent",
    });
    expect(html).toContain("Travail (arrière-plan)");
    expect(html).toContain("Aucun (arrière-plan)");
    expect(html).toContain("Afficher l'onglet"); // ouverture MANUELLE seulement
  });

  it("dit « Repos » et « Onglet : Ouvert » pour un agent au repos avec onglet", () => {
    const html = renderCard({
      agentId: "codeur|C:/proj/pilot",
      label: "codeur",
      project: "pilot",
      busy: false,
      visible: true,
      lastActivity: null,
      kind: "agent",
    });
    expect(html).toContain("Repos");
    expect(html).toContain("Ouvert");
    expect(html).not.toContain("arrière-plan");
  });
});

describe("buildBackgroundWorkMissions / renderBackgroundWorkersHtml — panneau Activite", () => {
  it("liste la session qui travaille sans onglet (agent, projet, mission)", () => {
    const list = flattenAgents(
      makeSupervision([
        {
          path: "C:/proj/pilot",
          name: "pilot",
          agents: [{ agent: "codeur", state: "running", visible: false, alive: true, prompt: "Corriger la recherche globale" }],
        },
      ])
    );
    const missions = buildBackgroundWorkMissions(list);
    expect(missions).toEqual([
      {
        agentId: "codeur|C:/proj/pilot",
        kind: "agent",
        agent: "codeur",
        project: "pilot",
        mission: "Corriger la recherche globale",
      },
    ]);
    const html = renderBackgroundWorkersHtml(missions);
    expect(html).toContain("Travail en arrière-plan");
    expect(html).toContain("codeur");
    expect(html).toContain("pilot");
    expect(html).toContain("Corriger la recherche globale");
    // Aucun bouton, aucun appel : le bloc est purement informatif.
    expect(html).not.toContain("<button");
  });

  it("ne liste NI une session vivante au repos, NI une session morte", () => {
    const repos = flattenAgents(makeSupervision([session({ state: "idle", visible: false, alive: true })]));
    const morte = flattenAgents(makeSupervision([session({ state: "stopped", visible: false, alive: false })]));
    expect(buildBackgroundWorkMissions(repos)).toEqual([]);
    expect(buildBackgroundWorkMissions(morte)).toEqual([]);
    expect(renderBackgroundWorkersHtml([])).toBe("");
    expect(renderBackgroundWorkersHtml(null)).toBe("");
  });

  it("ignore un agent qui travaille AVEC un onglet ouvert (deja visible autrement)", () => {
    const list = flattenAgents(makeSupervision([session({ state: "running", visible: true, alive: true })]));
    expect(buildBackgroundWorkMissions(list)).toEqual([]);
  });
});
