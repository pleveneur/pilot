/**
 * VERROU — le texte affiché pour la tâche EN COURS (colonne de droite de l'écran
 * Vocal) doit être celui de la mission qui tourne RÉELLEMENT.
 *
 * Défaut corrigé (rapport `docs/rapports/RAPPORT-libelle-tache-en-cours-en-haut-a-droite.md`) :
 * le texte d'une mission (`prompt` / `resume`) ne vit que dans la vue d'ensemble
 * LOURDE (`get_agent_supervision`). Écrire un prompt n'émet AUCUN évènement
 * (`AgentService::send`), et une session REPRISE garde la même signature
 * `projet + agent + vivacité` : la vue n'était donc jamais relue quand le texte
 * de la mission changeait. Résultat : la mission PRÉCÉDENTE s'affichait pour la
 * mission en cours.
 *
 * Indice du propriétaire, expliqué ici et verrouillé : « quand il y avait encore
 * les 2 tâches en cours, c'était bon » — avec deux missions, le démarrage de la
 * seconde forçait (par accident) la relecture pendant la première.
 *
 * Les deux cas (1 mission / 2 missions) sont reproduits par la CHAÎNE RÉELLE
 * (`mergeProbeActivity` -> `flattenAgents` -> `buildRunningMissions`), et le
 * câblage du correctif est tenu par des ancres de source.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Aucun accès Tauri réel : le cas de la revue du 2026-11-15 (ci-dessous) rejoue
// la CHAÎNE RÉELLE du store, pas seulement ses fonctions pures.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import {
  mergeProbeActivity,
  flattenAgents,
  buildRunningMissions,
  planActivityRefresh,
  probeSessionsSignature,
} from "./agent-activity.js";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const PROJ = "G:/IA_PL/pilot";
const AGENT = "codeur";

// Deux missions RÉELLEMENT envoyées, dans l'ordre. Le texte attendu à l'écran
// est le « Tâche : » du prompt (shortMission), jamais le résumé de l'autre.
const MISSION_A = "## Objectif\nTâche : corriger la barre du bas\n";
const MISSION_B = "## Objectif\nTâche : corriger le libelle de la tache en cours\n";
const MISSION_C = "## Objectif\nTâche : verifier la file d'attente\n";

/** Supervision LOURDE telle que `get_agent_supervision` la rend à un instant donné. */
function supervision({ prompt, resume, state = "idle" }) {
  return {
    projects: [
      {
        path: PROJ,
        name: "pilot",
        agents: [
          {
            agent: AGENT,
            state,
            visible: true,
            alive: true,
            prompt,
            resume,
            toolInProgress: false,
          },
        ],
      },
    ],
  };
}

/** Sonde LÉGÈRE (`agent_activity_probe`) : elle ne porte JAMAIS prompt/résumé. */
function probe({ busy = false, toolInProgress = false } = {}) {
  return [{ project: PROJ, agent: AGENT, alive: true, busy, toolInProgress }];
}

/** La chaîne exacte de la colonne : magasin -> liste plate -> missions. */
function missionsFrom(heavy, light, queued = []) {
  return buildRunningMissions(flattenAgents(mergeProbeActivity(heavy, light)), queued);
}

/** Le texte que la colonne affiche pour la mission en cours. */
function seulTexte(missions) {
  const enCours = missions.filter((m) => m.waiting !== true);
  expect(enCours).toHaveLength(1);
  return enCours[0].mission;
}

describe("le texte de la tâche en cours est celui de la mission réelle", () => {
  it("CAS 1 mission — reproduit le défaut : la vue relue AVANT l'envoi donne la mission précédente", () => {
    // Vue LOURDE telle qu'elle est relue au démarrage de la session (le bus
    // n'a pas encore envoyé le prompt de B : prompt/résumé valent encore A),
    // puis sonde légère pendant que la mission B travaille (un outil tourne).
    const heavy = supervision({ prompt: MISSION_A, resume: "" });
    const missions = missionsFrom(heavy, probe({ toolInProgress: true }));
    // La mission B tourne pourtant réellement (le bus a envoyé MISSION_B).
    expect(seulTexte(missions)).toContain("barre du bas");
    expect(seulTexte(missions)).not.toContain("libelle de la tache");
  });

  it("CAS 1 mission — la relecture APRÈS l'envoi donne le bon texte", () => {
    const heavy = supervision({ prompt: MISSION_B, resume: "" });
    const missions = missionsFrom(heavy, probe({ toolInProgress: true }));
    expect(seulTexte(missions)).toContain("libelle de la tache en cours");
  });

  it("CAS 2 missions — l'indice du propriétaire : le démarrage de la seconde force la relecture de la première", () => {
    // La vue LOURDE a été relue APRÈS l'envoi de A (parce que B démarre et que
    // l'évènement de B tombe pendant A) : la ligne de A est alors juste.
    const heavy = supervision({ prompt: MISSION_A, resume: "" });
    const missions = missionsFrom(heavy, probe({ toolInProgress: true }), [
      { agent: AGENT, project: "pilot", mission: MISSION_B, resume: "" },
    ]);
    const enCours = missions.filter((m) => m.waiting !== true);
    const attente = missions.filter((m) => m.waiting === true);
    expect(enCours).toHaveLength(1);
    expect(attente).toHaveLength(1);
    expect(enCours[0].mission).toContain("barre du bas");
    expect(attente[0].mission).toContain("libelle de la tache en cours");
  });

  it("la boucle de 2 s reste LÉGÈRE : un ensemble de sessions inchangé ne relit jamais les champs d'affichage", () => {
    // C'est la cause : la seule source du texte est la sonde LOURDE, et la
    // boucle périodique ne la paie pas. Ce comportement du correctif « gel de
    // session » (commit 551c944) NE DOIT PAS changer : le correctif ne
    // réintroduit pas la sonde lourde dans le tic.
    const sessions = probe({ busy: true, toolInProgress: true });
    const signature = probeSessionsSignature(sessions);
    expect(
      planActivityRefresh({
        hasSupervision: true,
        cachedSignature: signature,
        signature,
        available: true,
        force: false,
      })
    ).toEqual({ fetchSupervision: false });
    // …et une demande FORCÉE (le point d'entrée du correctif) la redemande.
    expect(
      planActivityRefresh({
        hasSupervision: true,
        cachedSignature: signature,
        signature,
        available: true,
        force: true,
      })
    ).toEqual({ fetchSupervision: true });
  });
});

describe("le correctif est branché au seul moment où le texte change", () => {
  const ACTIVITY = read("src/js/agent-activity.js");
  const BUS = read("src/js/agents-bus.js");
  const SUPER = read("src/js/super-agent.js");

  it("point d'entrée UNIQUE : `refreshAgentMissionDisplay` demande la relecture lourde EXISTANTE", () => {
    const start = ACTIVITY.indexOf("export function refreshAgentMissionDisplay()");
    expect(start).toBeGreaterThan(-1);
    const body = ACTIVITY.slice(start, start + 400);
    expect(body).toContain("activityRefresh(true)");
    expect(body).toContain("catch");
    // Aucune seconde sonde : le module n'appelle que les deux commandes connues.
    expect(ACTIVITY).toContain('invoke("agent_activity_probe")');
    expect(ACTIVITY).toContain('invoke("get_agent_supervision")');
  });

  it("missions déléguées : relecture demandée juste après l'envoi du prompt, dans le tour de l'agent", () => {
    const debutTour = BUS.indexOf("async function runAgentTurn(");
    expect(debutTour).toBeGreaterThan(-1);
    const envoi = BUS.indexOf("await sendPromptToAgent(agent.id, prompt, ctx, resume);", debutTour);
    expect(envoi).toBeGreaterThan(debutTour);
    const relecture = BUS.indexOf("refreshAgentMissionDisplay();", envoi);
    expect(relecture).toBeGreaterThan(envoi);
    // Même bloc, juste après l'envoi : aucune fenêtre où le texte reste faux.
    expect(relecture - envoi).toBeLessThan(900);
    // Un seul point de demande dans tout le fichier (aucun second mécanisme).
    expect((BUS.match(/refreshAgentMissionDisplay\(\)/g) || []).length).toBe(1);
    // `void` : un rejet de la relecture ne doit pas remonter dans le `try` du
    // tour (il ferait conclure « runAgentTurn error » et pourrait arrêter un
    // process fraîchement lancé).
    expect(BUS).toContain("void refreshAgentMissionDisplay();");
  });

  it("Assistant : relecture demandée juste après l'envoi de sa demande", () => {
    const envoi = SUPER.indexOf('await invoke("send_super_agent_prompt", { message: messageAgent });');
    expect(envoi).toBeGreaterThan(-1);
    const apres = SUPER.slice(envoi, envoi + 900);
    expect(apres).toContain("refreshAgentMissionDisplay();");
    expect(apres).toContain("void refreshAgentMissionDisplay();");
    expect((SUPER.match(/refreshAgentMissionDisplay\(\)/g) || []).length).toBe(1);
  });

  it("aucun second mécanisme de file : le correctif ne touche ni la composition ni le rang", () => {
    for (const mod of ["src/js/project-queue-view.js", "src/js/project-task-queue.js"]) {
      const src = read(mod);
      expect(src).not.toContain("refreshAgentMissionDisplay");
    }
    // La demande de relecture ne crée aucune entrée de file : elle ne fait que
    // faire relire la vue d'ensemble.
    expect(ACTIVITY).not.toContain("enqueueMissionForProject");
  });
});

/**
 * SUITE DE LA REVUE DU 2026-11-15 — POINT BLOQUANT.
 *
 * Chemin RÉEL d'une mission déléguée (`agents-bus.js`) :
 * `start_agent_process` émet `set_state(Running)` (`agent_service.rs`) → push
 * `agent-state-changed` → relecture FORCÉE dont la lecture lourde reste EN VOL,
 * PUIS `sendPromptToAgent` écrit `prompt` / `resume` (aucun évènement),
 * PUIS `refreshAgentMissionDisplay()`.
 *
 * La demande forcée tombe donc pendant une lecture qui a COMMENCÉ AVANT elle :
 * elle doit être REJOUÉE, jamais jetée. L'ancien drapeau « le vol a lu la vue
 * complète » suffisait à l'absorber — mais une lecture commencée avant
 * l'écriture du prompt ne peut pas en rapporter le texte : la colonne restait
 * sur la mission PRÉCÉDENTE pour toute la mission.
 */
describe("revue du 2026-11-15 — une demande forcée n'est jamais jetée", () => {
  const LIGHT = "agent_activity_probe";
  const HEAVY = "get_agent_supervision";
  let storeListener = null;
  let promptActuel = MISSION_A;
  let heavyCalls = 0;
  let gate = null; // promesse non résolue : la lecture lourde reste EN VOL
  let lightGate = null; // promesse non résolue : la sonde LÉGÈRE (donc la lecture lourde n'a pas commencé)
  let heavyFail = 0; // nombre de lectures lourdes qui ÉCHOUENT avant de rendre la main

  async function flush() {
    for (let i = 0; i < 80; i++) await Promise.resolve();
  }

  /** Le texte que la colonne affiche pour la mission en cours. */
  function texteEnCours(list) {
    const missions = buildRunningMissions(list || [], []);
    const enCours = missions.filter((m) => m.waiting !== true);
    expect(enCours).toHaveLength(1);
    return enCours[0].mission;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    storeListener = null;
    promptActuel = MISSION_A;
    heavyCalls = 0;
    gate = null;
    lightGate = null;
    heavyFail = 0;
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation((_event, handler) => {
      storeListener = handler;
      return Promise.resolve(() => {});
    });
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === LIGHT) {
        const light = {
          sessions: [{ project: PROJ, agent: AGENT, alive: true, toolInProgress: true }],
        };
        if (lightGate) await lightGate;
        return light;
      }
      if (cmd === HEAVY) {
        heavyCalls += 1;
        // La lecture lit la base À CET INSTANT (avant d'attendre la porte) :
        // c'est exactement ce que fait la commande Rust, et c'est ce qui rend le
        // défaut visible — le prompt de la nouvelle mission n'est pas encore écrit.
        const lu = supervision({ prompt: promptActuel, resume: "", state: "running" });
        if (gate) await gate;
        if (heavyFail > 0) {
          heavyFail -= 1;
          throw new Error("supervision illisible");
        }
        return lu;
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lecture lourde EN VOL → envoi du prompt de la nouvelle mission → la relecture rattrape le texte", async () => {
    const mod = await import("./agent-activity.js");
    const published = [];
    mod.subscribeAgentActivity((list) => published.push(list));
    await flush();

    // Première passe : la vue complète porte encore la mission A.
    expect(heavyCalls).toBe(1);
    expect(texteEnCours(published.at(-1))).toContain("barre du bas");

    // 1. Le démarrage de la mission suivante pousse `set_state(Running)` :
    //    relecture FORCÉE, dont la lecture lourde reste EN VOL.
    let release = null;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    expect(typeof storeListener).toBe("function");
    storeListener({ payload: { agentId: AGENT } });
    await flush();
    expect(heavyCalls).toBe(2); // la lecture lourde est engagée…

    // 2. …et elle est TOUJOURS en vol quand le prompt de la mission B est écrit,
    //    puis quand le tour demande la relecture de l'affichage.
    promptActuel = MISSION_B;
    const demande = mod.refreshAgentMissionDisplay();
    gate = null;
    release();
    await demande;
    await flush();

    // La demande forcée n'a pas été jetée : elle a été REJOUÉE après le vol, et
    // cette seconde lecture, elle, a vu le prompt de B.
    expect(heavyCalls).toBe(3);
    expect(texteEnCours(published.at(-1))).toContain("libelle de la tache en cours");
    expect(texteEnCours(published.at(-1))).not.toContain("barre du bas");
  });

  it("une demande SAUTÉE (la lecture commence après elle) puis une demande REJOUÉE", async () => {
    const mod = await import("./agent-activity.js");
    const published = [];
    mod.subscribeAgentActivity((list) => published.push(list));
    await flush();
    expect(heavyCalls).toBe(1);

    // ── 1. La demande arrive PENDANT un vol, mais AVANT que la lecture lourde
    //       commence (le vol en est encore à sa sonde légère). La lecture qui
    //       suit lit donc forcément le texte déjà écrit : la demande est
    //       SATISFAITE, aucun rejeu — donc aucune lecture inutile.
    let releaseLight = null;
    lightGate = new Promise((resolve) => {
      releaseLight = resolve;
    });
    storeListener({ payload: { agentId: AGENT } }); // vol FORCÉ engagé
    promptActuel = MISSION_B;
    const sautee = mod.refreshAgentMissionDisplay(); // demande pendant le vol
    releaseLight();
    await sautee;
    await flush();
    lightGate = null;
    // Une seule lecture lourde a eu lieu : celle qui a suivi la demande et qui a
    // donc vu le bon texte. Sans la règle d'ORDRE (« rejouer seulement si la
    // demande n'est pas antérieure à la lecture »), cette demande serait rejouée
    // pour rien : 3 lectures.
    expect(heavyCalls).toBe(2);
    expect(texteEnCours(published.at(-1))).toContain("libelle de la tache en cours");

    // ── 2. La même demande, mais tombant PENDANT la lecture lourde : elle est
    //       REJOUÉE, une seule fois, et la colonne prend le texte de la
    //       nouvelle mission.
    let release = null;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    storeListener({ payload: { agentId: AGENT } });
    await flush();
    expect(heavyCalls).toBe(3);
    promptActuel = MISSION_C;
    const rejouee = mod.refreshAgentMissionDisplay();
    gate = null;
    release();
    await rejouee;
    await flush();
    expect(heavyCalls).toBe(4);
    expect(texteEnCours(published.at(-1))).toContain("verifier la file d'attente");
  });

  it("une lecture lourde qui ÉCHOUE ne satisfait aucune demande : la relecture est REJOUÉE", async () => {
    const mod = await import("./agent-activity.js");
    const published = [];
    mod.subscribeAgentActivity((list) => published.push(list));
    await flush();
    expect(heavyCalls).toBe(1);
    expect(texteEnCours(published.at(-1))).toContain("barre du bas");

    // Le vol de la mission suivante : sa lecture lourde ÉCHOUE (supervision
    // illisible / moteur injoignable). La demande forcée tombe PENDANT ce vol,
    // avant le début de la lecture — avec une lecture RÉUSSIE elle serait sautée
    // (cas ci-dessus) ; comme la lecture n'a RIEN lu, elle ne peut rien
    // satisfaire et la demande doit être rejouée.
    let releaseLight = null;
    lightGate = new Promise((resolve) => {
      releaseLight = resolve;
    });
    storeListener({ payload: { agentId: AGENT } });
    promptActuel = MISSION_B;
    heavyFail = 1;
    const demande = mod.refreshAgentMissionDisplay();
    releaseLight();
    await demande;
    await flush();
    lightGate = null;

    // Lecture échouée (2) + rejeu qui lit vraiment (3) : l'échec n'a pas absorbé
    // la demande, et l'affichage connu n'a pas été écrasé par une lecture vide.
    expect(heavyCalls).toBe(3);
    expect(texteEnCours(published.at(-1))).toContain("libelle de la tache en cours");
  });
});
