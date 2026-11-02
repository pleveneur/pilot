// ANTI-RÉCIDIVE — « la boucle du suivi du travail n'appelle JAMAIS la sonde
// LOURDE, et deux rafraîchissements ne se chevauchent jamais ».
//
// FAIT (diagnostic du gel de session, docs/rapports/RAPPORT-gel-session-pilot.md
// § 4.1) : le store partagé d'agent-activity.js appelait `get_agent_supervision`
// toutes les 2 s ET à chaque push `agent-state-changed`, SANS garde de
// réentrance. Or cette commande est synchrone côté Rust (thread principal de
// Tauri) et lit la base PAR SESSION : quand un agent travaille ou attend une
// réponse, chaque passe pesait sur le thread qui peint l'interface, et deux
// passes pouvaient se chevaucher.
//
// CONSIGNE : la boucle périodique utilise la sonde LÉGÈRE
// (`agent_activity_probe`, lecture mémoire), et une seule sonde est en vol à la
// fois. Ces tests ÉCHOUENT si la sonde lourde revient dans la boucle, si son
// activité n'est plus appliquée, ou si la garde de réentrance disparaît.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Aucun accès Tauri réel.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const HEAVY = "get_agent_supervision";
const LIGHT = "agent_activity_probe";

/** Supervision complète type (dashboard.rs) — porteuse des champs d'affichage. */
function supervision(agents) {
  return {
    projects: [
      {
        path: "/p/A",
        name: "A",
        agents:
          agents ||
          [
            {
              agent: "default",
              state: "idle",
              alive: true,
              visible: true,
              toolInProgress: false,
            },
          ],
      },
    ],
  };
}

/** Flush les microtasks (chaîne sonde → fusion → abonnés) sans timers réels. */
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

let storeListenHandler = null;

/** Capture le handler push `agent-state-changed` enregistré par le store. */
function installListenCapture() {
  vi.mocked(listen).mockImplementation((_event, handler) => {
    storeListenHandler = handler;
    return Promise.resolve(() => {});
  });
}

function pushAgentState(payload) {
  if (!storeListenHandler) throw new Error("store jamais démarré : listen non enregistré");
  storeListenHandler({ payload });
}

/**
 * Importe une instance NEUVE du store (l'état du polling est au niveau module) et
 * compte séparément les deux sondes.
 */
async function freshStore(probeResult) {
  vi.resetModules();
  storeListenHandler = null;
  const mod = await import("./agent-activity.js");
  const calls = { light: 0, heavy: 0 };
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === LIGHT) {
      calls.light += 1;
      return probeResult();
    }
    if (cmd === HEAVY) {
      calls.heavy += 1;
      return supervision();
    }
    return undefined;
  });
  return { mod, calls };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  installListenCapture();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("store du suivi du travail — sonde légère dans la boucle", () => {
  it("le poll de 2 s n'appelle QUE `agent_activity_probe` (jamais la sonde lourde)", async () => {
    vi.useFakeTimers();
    const { mod, calls } = await freshStore(() => ({
      sessions: [{ project: "/p/A", agent: "default", alive: true, toolInProgress: true }],
    }));

    const received = [];
    mod.subscribeAgentActivity((list, busy) => received.push({ list, busy }));
    await flush();

    // Première passe : la supervision COMPLÈTE est demandée (champs d'affichage).
    expect(calls.heavy).toBe(1);
    expect(calls.light).toBe(1);

    // Trois tours de la boucle de 2 s : la sonde lourde ne doit PLUS être payée.
    const lightBefore = calls.light;
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(2000);
      await flush();
    }
    expect(calls.light).toBe(lightBefore + 3);
    expect(calls.heavy).toBe(1);
  });

  it("l'activité vue par la sonde légère est appliquée entre deux supervisions", async () => {
    vi.useFakeTimers();
    // La supervision dit « au repos » ; la sonde légère dit « outil en cours ».
    const { mod, calls } = await freshStore(() => ({
      sessions: [{ project: "/p/A", agent: "default", alive: true, toolInProgress: true }],
    }));

    const received = [];
    mod.subscribeAgentActivity((list, busy) => received.push({ list, busy }));
    await flush();
    // Au premier tour, la fusion porte déjà l'activité de la sonde légère.
    expect(received.at(-1).list[0].working).toBe(true);

    // La sonde légère bascule sur « plus d'outil » : le 2 s suivant doit le voir,
    // SANS redemander la supervision complète.
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === LIGHT) {
        calls.light += 1;
        return { sessions: [{ project: "/p/A", agent: "default", alive: true }] };
      }
      if (cmd === HEAVY) {
        calls.heavy += 1;
        return supervision();
      }
      return undefined;
    });
    vi.advanceTimersByTime(2000);
    await flush();

    expect(calls.heavy).toBe(1);
    expect(received.at(-1).list[0].working).toBe(false);
    expect(received.at(-1).busy).toBe(false);
  });

  it("un CHANGEMENT D'ENSEMBLE des sessions redemande la supervision complète", async () => {
    vi.useFakeTimers();
    let sessions = [{ project: "/p/A", agent: "default", alive: true }];
    const { mod, calls } = await freshStore(() => ({ sessions }));

    mod.subscribeAgentActivity(() => {});
    await flush();
    expect(calls.heavy).toBe(1);

    // Un second agent démarre : ses champs d'affichage (nom, état) manquent.
    sessions = [
      { project: "/p/A", agent: "default", alive: true },
      { project: "/p/A", agent: "reviewer", alive: true },
    ];
    vi.advanceTimersByTime(2000);
    await flush();
    expect(calls.heavy).toBe(2);
  });

  it("GARDE DE RÉENTRANCE : un seul rafraîchissement en vol, jamais deux", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    storeListenHandler = null;
    const mod = await import("./agent-activity.js");
    let releaseProbe = null;
    let gate = null;
    let lightCalls = 0;
    let heavyCalls = 0;
    const sessions = [{ project: "/p/A", agent: "default", alive: true }];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === LIGHT) {
        lightCalls += 1;
        // À partir du 2ᵉ appel, la sonde ne répond plus tout de suite.
        return gate ? gate : { sessions };
      }
      if (cmd === HEAVY) {
        heavyCalls += 1;
        return supervision();
      }
      return undefined;
    });

    mod.subscribeAgentActivity(() => {});
    await flush();
    // Première passe complète : sonde légère + supervision d'affichage.
    expect(lightCalls).toBe(1);
    expect(heavyCalls).toBe(1);

    // La sonde suivante reste EN VOL (promesse non résolue).
    gate = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(lightCalls).toBe(2);

    // Trois demandes pendant que la sonde est en vol (push d'état + tour de poll).
    pushAgentState({ agentId: "default" });
    pushAgentState({ agentId: "default" });
    vi.advanceTimersByTime(2000);
    await flush();

    // Aucune seconde sonde concurrente n'a été lancée (garde de réentrance).
    expect(lightCalls).toBe(2);
    expect(heavyCalls).toBe(1);

    // À la libération : la passe en vol se termine SANS sonde lourde (ensemble
    // des sessions inchangé), puis la demande coalescée est rejouée UNE seule
    // fois — et elle exigera la supervision complète (push d'état reçu).
    gate = null;
    releaseProbe({ sessions });
    await flush();
    expect(lightCalls).toBe(3);
    expect(heavyCalls).toBe(2);
  });

  it("sonde légère indisponible : la dernière supervision connue est conservée", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    storeListenHandler = null;
    const mod = await import("./agent-activity.js");
    let fail = false;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === LIGHT) {
        if (fail) throw new Error("sonde indisponible");
        return { sessions: [{ project: "/p/A", agent: "default", alive: true }] };
      }
      if (cmd === HEAVY) return supervision();
      return undefined;
    });

    const received = [];
    mod.subscribeAgentActivity((list, busy) => received.push({ list, busy }));
    await flush();
    const notified = received.length;
    expect(notified).toBeGreaterThan(0);

    fail = true;
    vi.advanceTimersByTime(2000);
    await flush();
    // Aucune mise à jour inventée : l'affichage connu est repris tel quel.
    expect(received.at(-1).list[0].state).toBe("idle");
  });
});

describe("décisions pures du rafraîchissement", () => {
  it("planActivityRefresh : la boucle ne paie la sonde lourde que si nécessaire", async () => {
    const { mod } = await freshStore(() => ({ sessions: [] }));

    expect(mod.planActivityRefresh({ hasSupervision: false }).fetchSupervision).toBe(true);
    expect(
      mod.planActivityRefresh({ hasSupervision: true, cachedSignature: "a", signature: "a" })
        .fetchSupervision
    ).toBe(false);
    // Un push d'état est un vrai changement : sonde lourde demandée.
    expect(
      mod.planActivityRefresh({
        hasSupervision: true,
        cachedSignature: "a",
        signature: "a",
        force: true,
      }).fetchSupervision
    ).toBe(true);
    // Changement d'ensemble des sessions (démarrage / arrêt / mort).
    expect(
      mod.planActivityRefresh({ hasSupervision: true, cachedSignature: "a", signature: "b" })
        .fetchSupervision
    ).toBe(true);
    // Ensemble vide après un ensemble non vide : c'est un vrai changement.
    expect(
      mod.planActivityRefresh({ hasSupervision: true, cachedSignature: "a", signature: "" })
        .fetchSupervision
    ).toBe(true);
    // Sonde indisponible : rien à décider, on garde l'affichage connu.
    expect(
      mod.planActivityRefresh({
        hasSupervision: true,
        cachedSignature: "a",
        signature: "",
        available: false,
      }).fetchSupervision
    ).toBe(false);
  });

  it("mergeProbeActivity : reprend l'activité, laisse l'affichage, ne mute rien", async () => {
    const { mod } = await freshStore(() => ({ sessions: [] }));
    const sup = supervision();
    const snapshot = JSON.stringify(sup);
    const merged = mod.mergeProbeActivity(sup, [
      {
        project: "/p/A",
        agent: "default",
        alive: false,
        toolInProgress: true,
        lastActivity: "2026-11-15T10:00:00.000Z",
      },
    ]);

    expect(JSON.stringify(sup)).toBe(snapshot); // entrée jamais mutée
    const entry = merged.projects[0].agents[0];
    expect(entry).toMatchObject({
      agent: "default",
      state: "idle", // champ d'affichage : inchangé
      visible: true, // champ d'affichage : inchangé
      alive: false, // vivacité : reprise de la sonde
      toolInProgress: true, // activité : reprise de la sonde
      lastActivity: "2026-11-15T10:00:00.000Z",
    });
    // Session non listée par la sonde : valeur connue conservée, rien d'inventé.
    const untouched = mod.mergeProbeActivity(sup, [
      { project: "/p/B", agent: "autre", alive: true, toolInProgress: true },
    ]);
    expect(untouched.projects[0].agents[0].toolInProgress).toBe(false);
  });

  it("probeSessionsSignature : stable et indépendante de l'ordre", async () => {
    const { mod } = await freshStore(() => ({ sessions: [] }));
    const a = { project: "/p/A", agent: "default", alive: true };
    const b = { project: "/p/B", agent: "codeur", alive: false };
    const sig = mod.probeSessionsSignature([a, b]);
    expect(mod.probeSessionsSignature([b, a])).toBe(sig);
    expect(mod.probeSessionsSignature([a])).not.toBe(sig);
    expect(mod.probeSessionsSignature([])).toBe("");
    expect(mod.probeSessionsSignature(null)).toBe("");
  });
});
