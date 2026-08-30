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

  it("filtre toujours un agent de mode main parké au repos (visible=false) — résidu de registre", () => {
    const sup = makeSupervision([
      { path: "C:/proj/a", name: "a", agents: [{ agent: "codeur", state: "paused", visible: false, mode: "main", alive: true }] },
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
