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
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
  });

  it("Assistant : relecture demandée juste après l'envoi de sa demande", () => {
    const envoi = SUPER.indexOf('await invoke("send_super_agent_prompt", { message: messageAgent });');
    expect(envoi).toBeGreaterThan(-1);
    const apres = SUPER.slice(envoi, envoi + 900);
    expect(apres).toContain("refreshAgentMissionDisplay();");
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
