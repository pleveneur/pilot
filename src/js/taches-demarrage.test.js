// ════════════════════════════════════════════════════════════════════════════
// Groupe « Démarrage » de la liste des tâches (POINT B / B1 — front seul)
//
// Défaut corrigé : `docs/rapports/RAPPORT-taches-invisibles.md` § 3 cas (c).
// Une mission ACCEPTÉE mais pas encore DÉMARRÉE n'apparaissait dans AUCUN groupe
// pendant le spawn de la session + la sonde du backend (jusqu'à 2 × 5 s à froid)
// plus 2 s de poll : le volet restait vide alors que la mission était partie.
//
// Correction : `docs/rapports/RAPPORT-taches-demarrage-b1.md`.
//
// Ce fichier verrouille, dans l'ordre :
//  1. la famille existe et son libellé est explicite ;
//  2. une mission acceptée non démarrée est RÉELLEMENT affichée (le test échoue
//     sans la correction) ;
//  3. le dédoublonnage STRICT au passage à `running` (une seule ligne, bon
//     groupe) ;
//  4. la borne d'expiration se comporte comme annoncé (ni trop tôt, ni sans fin) ;
//  5. la cohérence compteur « Travail » ↔ liste dans le cas « démarrage » ;
//  6. le branchement (une seule source de calcul, un seul rendu) et la
//     compatibilité de `flattenAgents` sans mémoire de suivi.
//
// Les lectures de source normalisent les fins de ligne : sous Windows CI
// (`core.autocrlf=true`) un `\n` littéral ne correspondrait pas (piège
// quality-gate § 3.4).
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  flattenAgents,
  buildRunningMissions,
  buildStartingMissions,
  splitMissions,
  renderMissionsPanelHtml,
  trackMissionStarting,
  missionStartSignature,
  isAgentWorking,
  MISSION_START_MAX_MS,
  MISSION_START_GROUP_LABEL,
  agentTaskCounterText,
} from "./agent-activity.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const srcAgentActivity = read("./agent-activity.js");
const srcSuperAgent = read("./super-agent.js");

/** Bloc de source entre deux ancres (lecture de source robuste aux CRLF). */
function bloc(src, start, end) {
  const i = src.indexOf(start);
  expect(i, `ancre introuvable : ${start}`).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j, `fin d'ancre introuvable : ${end}`).toBeGreaterThan(i);
  return src.slice(i, j + end.length);
}

// ── Une supervision qui reproduit EXACTEMENT le cas (c) ─────────────────────
// Le prompt est publié (le cœur l'a enregistré à l'envoi) mais l'état est encore
// `idle` : c'est l'état réel pendant le spawn de la session.
const PROMPT = "Objectif : corriger la liste des taches invisibles";
const supIdle = {
  projects: [
    {
      path: "C:/projets/pilot",
      name: "pilot",
      agents: [
        { agent: "codeur", state: "idle", visible: false, alive: true, prompt: PROMPT },
      ],
    },
  ],
};
const supRunning = {
  projects: [
    {
      path: "C:/projets/pilot",
      name: "pilot",
      agents: [
        { agent: "codeur", state: "running", busy: true, visible: false, alive: true, prompt: PROMPT },
      ],
    },
  ],
};

/** Liste aplatie de la supervision, avec une mémoire de suivi neuve. */
function listOf(sup, map, now) {
  if (now === undefined) return flattenAgents(sup, new Map(), new Map(), map);
  vi.setSystemTime(now);
  return flattenAgents(sup, new Map(), new Map(), map);
}

/** Missions telles que le volet les reçoit (famille 5 comprise). */
function missionsOf(sup, map, now) {
  const list = listOf(sup, map, now);
  return { list, missions: buildRunningMissions(list, buildStartingMissions(list)) };
}

/** Nombre d'occurrences d'une sous-chaîne (preuve du dédoublonnage). */
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

afterEach(() => {
  vi.useRealTimers();
});

// ════════════════════════════════════════════════════════════════════════════
// (1) La famille existe et son libellé est explicite
// ════════════════════════════════════════════════════════════════════════════
describe("(1) la famille « Démarrage » existe et se nomme clairement", () => {
  it("une seule source pour le libellé, et il est explicite", () => {
    expect(MISSION_START_GROUP_LABEL).toBe("Démarrage");
    // Le libellé du groupe n'est écrit QU'UNE fois dans le code de rendu.
    expect(occurrences(srcAgentActivity, '"Démarrage"')).toBe(1);
  });

  it("le rendu peint un troisième groupe, entre « En cours » et « En attente »", () => {
    const missions = [
      { agent: "codeur", project: "pilot", mission: "travaille", waiting: false },
      { agent: "codeur", project: "pilot", mission: "va demarrer", waiting: true, starting: true },
      { agent: "codeur", project: "pilot", mission: "attend", waiting: true },
    ];
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("En cours (1)");
    expect(html).toContain("Démarrage (1)");
    expect(html).toContain("En attente (1)");
    // ORDRE : en cours, puis démarrage, puis en attente.
    expect(html.indexOf("En cours (")).toBeLessThan(html.indexOf("Démarrage ("));
    expect(html.indexOf("Démarrage (")).toBeLessThan(html.indexOf("En attente ("));
    // Le statut de la ligne dit son état, sans inventer de preuve de vie.
    expect(html).toContain("démarrage");
    const ligneDemarrage = bloc(html, '<div class="sa-task-item starting">', "</div>");
    expect(ligneDemarrage).not.toContain("sa-missions-dot");
    expect(ligneDemarrage).not.toContain("sa-task-since");
  });

  it("la famille est branchée dans le calcul UNIQUE des missions", () => {
    // Une seule source de calcul : `collectQueuedMissions` reçoit la famille 5.
    const fn = bloc(srcSuperAgent, "function collectQueuedMissions() {", "\n}");
    expect(fn).toMatch(/buildStartingMissions\(getAgentActivitySnapshot\(\)\.list\)/);
    // Aucun second compteur ni second rendu : la publication et le rendu restent
    // ceux qui existaient, la famille entrant dans le calcul existant.
    expect(srcSuperAgent.match(/function publishSuperMissionsCount\(/g) || []).toHaveLength(1);
    expect(srcSuperAgent.match(/function renderSuperMissions\(/g) || []).toHaveLength(1);
    expect(srcAgentActivity.match(/export function renderMissionsPanelHtml\(/g) || []).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) Une mission acceptée non démarrée est AFFICHÉE
// ════════════════════════════════════════════════════════════════════════════
describe("(2) une mission acceptée, pas encore démarrée, est affichée", () => {
  it("sans la famille, la liste serait VIDE (le défaut)", () => {
    const list = listOf(supIdle, new Map());
    // Le constat du rapport : l'agent ne « travaille » pas encore…
    expect(isAgentWorking(list[0])).toBe(false);
    // …donc aucun groupe historique ne le retient : c'est le défaut corrigé.
    expect(buildRunningMissions(list, [])).toHaveLength(0);
    expect(renderMissionsPanelHtml(buildRunningMissions(list, []))).toContain("Aucune mission en cours.");
  });

  it("avec la famille, elle apparaît dans « Démarrage » et nulle part ailleurs", () => {
    const map = new Map();
    const { list, missions } = missionsOf(supIdle, map);
    expect(list[0].starting).toBe(true);

    const familles = buildStartingMissions(list);
    expect(familles).toHaveLength(1);
    expect(familles[0].project).toBeTruthy();
    expect(familles[0].starting).toBe(true);

    const { running, waiting } = splitMissions(missions);
    expect(running).toHaveLength(0);
    expect(waiting).toHaveLength(1);

    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("Démarrage (1)");
    expect(html).not.toContain("En cours (");
    expect(html).not.toContain("En attente (");
    // La phrase de la mission est bien celle que « En cours » affichera : même
    // résolution de libellé, aucun jargon, aucun texte brut de prompt.
    expect(html).toContain("corriger la liste des taches invisibles");
  });

  it("la même mission, une fois démarrée, passe dans « En cours » — jamais deux fois", () => {
    const map = new Map();
    const avant = missionsOf(supIdle, map).missions;
    const htmlAvant = renderMissionsPanelHtml(avant);
    expect(htmlAvant).toContain("Démarrage (1)");

    const apres = missionsOf(supRunning, map).missions;
    const htmlApres = renderMissionsPanelHtml(apres);
    expect(htmlApres).toContain("En cours (1)");
    expect(htmlApres).not.toContain("Démarrage (");
    // DÉDOUBLONNAGE STRICT : le texte de la mission apparaît UNE seule fois.
    expect(occurrences(htmlApres, "corriger la liste des taches invisibles")).toBe(1);
    // Et la ligne a bien changé de groupe.
    expect(occurrences(htmlApres, "sa-task-item ")).toBe(1);
  });

  it("un agent au repos SANS mission publiée ne fabrique pas de ligne", () => {
    const sup = {
      projects: [
        {
          path: "C:/projets/pilot",
          name: "pilot",
          agents: [{ agent: "codeur", state: "idle", visible: true, alive: true }],
        },
      ],
    };
    const { list, missions } = missionsOf(sup, new Map());
    expect(list[0].starting).toBeUndefined();
    expect(missions).toHaveLength(0);
    expect(renderMissionsPanelHtml(missions)).toContain("Aucune mission en cours.");
  });

  it("ne revient JAMAIS en arrière après la fin d'un tour (pas de clignotement)", () => {
    const map = new Map();
    missionsOf(supRunning, map); // la mission a démarré
    // Le tour se termine : l'état retombe à `idle`, le prompt est toujours publié.
    const apres = missionsOf(supIdle, map).missions;
    expect(apres).toHaveLength(0);
    expect(renderMissionsPanelHtml(apres)).toContain("Aucune mission en cours.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (3) Dédoublonnage : mécanique de la mémoire de suivi
// ════════════════════════════════════════════════════════════════════════════
describe("(3) dédoublonnage : la décision est exclusive", () => {
  const base = { agentId: "a", resume: "", prompt: PROMPT, state: "idle", working: false };

  it("`starting` et « travaille » ne sont jamais vrais ensemble", () => {
    const map = new Map();
    expect(trackMissionStarting(map, base, 1000)).toBe(true);
    expect(trackMissionStarting(map, { ...base, working: true, state: "running" }, 2000)).toBe(false);
    // Une fois démarrée, la même mission ne repasse jamais en démarrage.
    expect(trackMissionStarting(map, base, 3000)).toBe(false);
  });

  it("une NOUVELLE mission (signature différente) repart en démarrage", () => {
    const map = new Map();
    expect(trackMissionStarting(map, base, 1000)).toBe(true);
    expect(trackMissionStarting(map, { ...base, working: true, state: "running" }, 2000)).toBe(false);
    const autre = { ...base, prompt: "Objectif : ajouter le compteur" };
    expect(missionStartSignature(autre)).not.toBe(missionStartSignature(base));
    expect(trackMissionStarting(map, autre, 3000)).toBe(true);
  });

  it("les états `paused` / `stopped` ne sont pas des démarrages", () => {
    for (const state of ["paused", "stopped"]) {
      const map = new Map();
      expect(trackMissionStarting(map, { ...base, state }, 1000)).toBe(false);
    }
  });

  it("la forme historique des entrées est préservée quand la décision est fausse", () => {
    // Compatibilité : le champ `starting` n'existe QUE lorsqu'il est vrai (champ
    // additif) — aucun consommateur existant ne voit sa forme changer.
    const list = listOf(supRunning, new Map());
    expect(list).toHaveLength(1);
    expect(list[0].starting).toBeUndefined();
    expect(Object.keys(list[0])).not.toContain("starting");
    // …et la décision vraie est bien portée par la liste aplatie.
    const listIdle = listOf(supIdle, new Map());
    expect(Object.keys(listIdle[0])).toContain("starting");
    expect(listIdle[0].starting).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (4) Expiration : la borne annoncée est respectée
// ════════════════════════════════════════════════════════════════════════════
describe("(4) l'expiration se comporte comme annoncé", () => {
  it("la borne est une constante DITE, plus longue que la pire fenêtre du défaut", () => {
    // Pire fenêtre réelle : spawn + sonde backend (2 × 5 s) + poll (2 s) = 12 s.
    expect(MISSION_START_MAX_MS).toBeGreaterThanOrEqual(12_000);
    // Mais pas une éternité : c'est une information transitoire, pas un historique.
    expect(MISSION_START_MAX_MS).toBeLessThanOrEqual(60_000);
  });

  it("la ligne est visible AVANT la borne et disparaît APRÈS (jamais de fantôme)", () => {
    vi.useFakeTimers();
    const map = new Map();
    const t0 = new Date("2026-01-01T10:00:00Z").getTime();

    // Premier passage du front (le poll suivant l'envoi).
    expect(missionsOf(supIdle, map, t0).missions).toHaveLength(1);
    // Juste avant la borne : toujours visible.
    const justeAvant = missionsOf(supIdle, map, t0 + MISSION_START_MAX_MS - 500).missions;
    expect(justeAvant).toHaveLength(1);
    expect(renderMissionsPanelHtml(justeAvant)).toContain("Démarrage (1)");
    // Après la borne : plus rien, et le volet le dit honnêtement.
    const apres = missionsOf(supIdle, map, t0 + MISSION_START_MAX_MS + 500).missions;
    expect(apres).toHaveLength(0);
    expect(renderMissionsPanelHtml(apres)).toContain("Aucune mission en cours.");
  });

  it("la borne ne s'applique qu'aux entrées qui ne démarrent JAMAIS", () => {
    vi.useFakeTimers();
    const map = new Map();
    const t0 = new Date("2026-01-01T10:00:00Z").getTime();
    missionsOf(supIdle, map, t0); // démarrage observé
    // La mission démarre bien après la borne : elle est « En cours », datée.
    const apres = missionsOf(supRunning, map, t0 + MISSION_START_MAX_MS * 3).missions;
    expect(apres).toHaveLength(1);
    expect(apres[0].waiting).toBe(false);
    expect(renderMissionsPanelHtml(apres)).toContain("En cours (1)");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (5) Cohérence compteur « Travail » ↔ liste
// ════════════════════════════════════════════════════════════════════════════
describe("(5) le compteur et la liste disent la même chose", () => {
  it("cas « démarrage seul » : 0 en cours et 1 prévue — et surtout PAS une liste vide", () => {
    const { missions } = missionsOf(supIdle, new Map());
    const { running, waiting } = splitMissions(missions);
    // Le bouton « Travail » lit CES deux nombres (setAgentPanelTaskCount).
    expect(running).toHaveLength(0);
    expect(waiting).toHaveLength(1);
    expect(agentTaskCounterText(running.length, waiting.length)).toBe("0/1");
    const html = renderMissionsPanelHtml(missions);
    // Le total du bouton est bien celui des lignes affichées.
    expect(html).toContain("Démarrage (1)");
    expect(html).not.toContain("Aucune mission en cours.");
    // Un compteur non vide ne peut pas être devant une liste vide.
    expect(html).not.toBe('<div class="dash-muted">Aucune mission en cours.</div>');
  });

  it("sans aucune mission, le bouton est MUET et le volet le dit", () => {
    expect(agentTaskCounterText(0, 0)).toBe("");
    expect(renderMissionsPanelHtml([])).toContain("Aucune mission en cours.");
  });

  it("le total affiché par le volet égale toujours le total du compteur", () => {
    const missions = [
      { agent: "codeur", project: "pilot", mission: "travaille", waiting: false },
      { agent: "codeur", project: "pilot", mission: "va demarrer", waiting: true, starting: true },
      { agent: "archiviste", project: "pilot", mission: "attend 1", waiting: true },
      { agent: "relecteur", project: "pilot", mission: "attend 2", waiting: true },
    ];
    const { running, waiting } = splitMissions(missions);
    expect(agentTaskCounterText(running.length, waiting.length)).toBe("1/4");
    const html = renderMissionsPanelHtml(missions);
    const total = ["En cours (1)", "Démarrage (1)", "En attente (2)"].every((t) => html.includes(t));
    expect(total).toBe(true);
  });
});
