// VERROU — « UNE SEULE VÉRITÉ DU TRAVAIL DE L'ASSISTANT, ET UN REPOS OBSERVÉ
// EFFACE L'OCCUPATION FANTÔME ».
//
// DÉFAUT SIGNALÉ PAR LE PROPRIÉTAIRE : « Je t'avais posé une question et on me
// disait que tu travaillais déjà, mais je ne te voyais pas en haut à droite en
// train de travailler. Donc pas logique. » — et, derrière : la demande mise en
// file ne partait JAMAIS (aucune réponse, aucun message).
//
// CAUSE (rapport `docs/rapports/RAPPORT-assistant-occupe-fantome.md`) : deux
// observateurs distincts de « l'Assistant travaille », jamais réconciliés —
//   1. le cercle de la liste des agents (`agent-activity.js`), alimenté par la
//      sonde LÉGÈRE de 2 s (vérité affichée, correcte : « au repos ») ;
//   2. l'état propre de l'onglet 🧭 (`super-agent.js`), qui interrogeait la
//      sonde LOURDE `get_agent_supervision` dans sa propre boucle de 2 s — en
//      violation de la règle de `spec_pilot.md` § 2 (« Aucune attente de `pi`
//      sur le thread principal ») — et dont les drapeaux
//      `isStreaming` / `backendBusy` n'étaient JAMAIS effacés par une
//      observation. Un « occupé » fantôme bloquait la demande suivante, et la
//      file n'était vidée que si la sonde avait VU le moteur travailler
//      (`tourEnCoursVu`), ce qui n'arrive jamais quand il est au repos : le
//      texte restait en file pour toujours.
//
// CE QUE CE FICHIER VERROUILLE :
//   1. l'onglet 🧭 lit le MÊME store partagé que le cercle (aucune sonde
//      lourde dans une boucle) ;
//   2. une observation « au repos » efface `backendBusy` ET `isStreaming` et
//      déclenche le vidage de la file, par le SEUL chemin d'envoi ;
//   3. une observation « en démarrage » (`starting`) ou « travaillante » ne
//      déclenche RIEN : aucune seconde demande ne part par-dessus la première
//      pendant la latence qui suit un envoi ;
//   4. la demande mise en file pendant que le moteur est au repos part au
//      prochain repos observé — le cas exact du propriétaire.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";

// Aucun accès Tauri réel : le store est importé pour ses fonctions PURES.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import {
  mergeProbeActivity,
  flattenAgents,
  assistantWorkState,
  isAgentWorking,
} from "./agent-activity.js";
import { prendreDemandeEnAttente } from "./demande-pendant-le-tour.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
// Le source peut arriver en CRLF (runner Windows) : `lire` normalise AVANT toute
// recherche d'ancre multi-lignes (quality-gate § 3.4).
const SUPER = lire("src/js/super-agent.js");
const ACTIVITE = lire("src/js/agent-activity.js");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 60);
}

/**
 * Blocs `setInterval(...)` du source, parenthèses appariées.
 * Sert à prouver qu'AUCUNE boucle ne paie la sonde lourde.
 */
function blocsSetInterval(src) {
  const blocs = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf("setInterval(", from);
    if (i === -1) break;
    let depth = 0;
    let j = i + "setInterval".length;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    blocs.push(src.slice(i, j));
    from = j;
  }
  return blocs;
}

// ── La chaîne RÉELLE : supervision → sonde légère → liste plate → décision ──
/** Vue LOURDE telle que `get_agent_supervision` la rend (photo figée). */
function supervision({ state = "running", prompt = "", resume = "", alive = true } = {}) {
  return {
    projects: [
      {
        path: "",
        name: "",
        agents: [
          {
            id: "superagent",
            agent: "Assistant",
            state,
            visible: true,
            alive,
            prompt,
            resume,
            toolInProgress: false,
          },
        ],
      },
    ],
  };
}

/** Sonde LÉGÈRE (`agent_activity_probe`), relue toutes les 2 s. */
function probe({ working, alive = true } = {}) {
  const entry = { project: "", agent: "superagent", alive, toolInProgress: false };
  if (typeof working === "boolean") entry.working = working;
  return [entry];
}

/** Observation telle que l'onglet 🧭 la reçoit : store partagé, rien d'autre. */
function observation({ heavy, sessions, missionStartMap = new Map() }) {
  const merged = mergeProbeActivity(heavy, sessions);
  const list = flattenAgents(merged, new Map(), new Map(), missionStartMap);
  return { list, obs: assistantWorkState(list) };
}

/** Ce que l'onglet fait d'une file, dans l'ordre (premier arrivé, premier servi). */
function vidage(file, obs) {
  return prendreDemandeEnAttente(file, obs.auRepos !== true);
}

describe("1. une seule vérité : le store partagé, jamais une boucle de sonde lourde", () => {
  it("AUCUNE boucle (`setInterval`) de super-agent.js n'appelle `get_agent_supervision`", () => {
    const blocs = blocsSetInterval(SUPER);
    expect(blocs.length, "aucune boucle trouvée : le test ne prouverait rien").toBeGreaterThan(0);
    for (const bloc of blocs) {
      expect(bloc).not.toContain("get_agent_supervision");
    }
    // La sonde lourde n'est plus appelée PÉRIODIQUEMENT : la seule occurrence
    // restante est documentaire (aucun `invoke` périodique dans l'onglet).
    expect(SUPER).not.toMatch(/setInterval\([\s\S]{0,4000}?invoke\("get_agent_supervision"\)/);
  });

  it("le statut de l'onglet est abonné au store partagé (`subscribeAgentActivity`)", () => {
    expect(SUPER).toContain("const unsubAssistantWork = subscribeAgentActivity(");
    // La décision vient de la fonction PARTAGÉE, pas d'une lecture locale.
    expect(SUPER).toContain("assistantWorkState(");
    // Et l'abonnement est bien retiré à la fermeture de l'onglet (pas de fuite).
    expect(SUPER).toContain("unsubAssistantWork();");
    expect(SUPER).not.toContain("clearInterval(superStatusPoll)");
  });

  it("l'ancienne mécanique « tour vu » a disparu (remplacée par l'observation)", () => {
    // L'ancien drapeau exigeait d'avoir vu le moteur travailler pour autoriser
    // le vidage : c'était précisément ce qui ne partait jamais au repos.
    expect(SUPER).not.toContain("tourEn" + "CoursVu");
  });

  it("`assistantWorkState` reconnaît l'Assistant par sa FAMILLE, jamais par un libellé", () => {
    // Une session d'un projet, même nommée « Assistant », n'est pas l'Assistant.
    const list = [
      { agentId: "codeur|/p/A", rawId: "codeur", kind: "agent", label: "Assistant", working: true },
      { agentId: "superagent", rawId: "superagent", kind: "superagent", label: "Sylvie", working: false },
    ];
    const obs = assistantWorkState(list);
    expect(obs.known).toBe(true);
    expect(obs.working).toBe(false);
    // Aucune entrée de la famille : aucune preuve, donc aucune décision.
    expect(assistantWorkState([list[0]]).known).toBe(false);
    expect(assistantWorkState([]).known).toBe(false);
    expect(assistantWorkState(null).known).toBe(false);
  });

  it("la famille est celle du store : `kind === \"superagent\"`", () => {
    expect(ACTIVITE).toContain('export function assistantWorkState(');
    expect(ACTIVITE).toContain('kind === SUPERAGENT_ID');
  });
});

describe("2. un repos OBSERVÉ efface l'occupation fantôme et vide la file", () => {
  it("l'Assistant au repos est vu « au repos » (même si la photo lourde dit `running`)", () => {
    const { obs } = observation({ heavy: supervision({ state: "running" }), sessions: probe({ working: false }) });
    expect(obs.known).toBe(true);
    expect(obs.working).toBe(false);
    expect(obs.auRepos).toBe(true);
  });

  it("le vidage de la file passe par le SEUL chemin d'envoi existant", () => {
    const branche = corpsFonction(SUPER, "function viderFileAuReposObserve()");
    // L'occupation locale tombe, y compris `isStreaming` (jamais effacé par une
    // observation avant ce correctif : c'est le cœur du défaut).
    expect(branche).toContain("isStreaming = false;");
    expect(branche).toContain("flushDemandesEnAttente(true)");
    // Aucun second envoi, aucune minuterie, aucune sonde.
    expect((branche.match(/send\(\)/g) || [])).toHaveLength(0);
    expect(branche).not.toMatch(/setTimeout|setInterval/);
    expect(branche).not.toMatch(/invoke\(/);
  });

  it("le gestionnaire d'observation efface `backendBusy` ET `isStreaming` au repos", () => {
    const geste = corpsFonction(SUPER, "function appliquerObservationTravail(list)");
    expect(geste).toContain("assistantWorkState(list)");
    expect(geste).toContain("if (!obs.known) return;");
    expect(geste).toContain("backendBusy = false;");
    expect(geste).toContain("viderFileAuReposObserve();");
    // Le statut et la teinte existants sont conservés à l'identique.
    expect(geste).toContain('statusEl.textContent = "Prêt";');
    expect(geste).toContain('statusEl.className = "agent-status agent-status-idle";');
    expect(geste).toContain("setReflecting(true)");
    expect(geste).toContain("flushPendingSuperAgentReports()");
    // Le message « Connexion perdue » n'est retiré que sur une vivacité prouvée.
    expect(geste).toContain("if (obs.alive) removeSuperAgentDisconnectedEvent();");
  });

  it("une demande mise en file pendant le repos part au prochain repos observé", () => {
    // Le cas EXACT du propriétaire : moteur au repos, demande en file, aucun
    // `agent_end` à venir, et l'ancienne sonde n'avait jamais vu de travail.
    const { obs } = observation({ heavy: supervision({ state: "idle" }), sessions: probe({ working: false }) });
    const { texte, reste } = vidage(["ma question restée coincée"], obs);
    expect(texte).toBe("ma question restée coincée");
    expect(reste).toEqual([]);
    // Rien ne part tant qu'il reste quelque chose en file ? Si : une seule à la
    // fois, dans l'ordre — l'observation suivante prendra la suivante.
    const suite = vidage(["a", "b"], obs);
    expect(suite.texte).toBe("a");
    expect(suite.reste).toEqual(["b"]);
  });
});

describe("3. « en démarrage » ou « travaillant » : on attend, rien ne part", () => {
  it("une mission ACCEPTÉE mais pas encore démarrée n'est pas le repos", () => {
    // La photo lourde porte déjà le prompt (écrit par le moteur à l'envoi) et
    // la sonde dit qu'aucun travail n'a encore commencé : c'est le `starting`.
    const { list, obs } = observation({
      heavy: supervision({ state: "idle", prompt: "corriger la barre du bas" }),
      sessions: probe({ working: false }),
    });
    expect(list[0].starting).toBe(true);
    expect(obs.starting).toBe(true);
    expect(obs.auRepos).toBe(false);
    // Deux demandes ne partent jamais en même temps par-dessus la première.
    expect(vidage(["seconde demande"], obs).texte).toBeNull();
    // Et le gestionnaire ne touche ni au statut ni à la file sur cette branche.
    const geste = corpsFonction(SUPER, "function appliquerObservationTravail(list)");
    expect(geste).toContain("} else if (obs.starting) {");
    const demarrage = sliceSource(geste, "} else if (obs.starting) {", "} else {", 20);
    expect(demarrage).not.toContain("viderFileAuReposObserve");
    expect(demarrage).not.toContain("isStreaming = false");
  });

  it("un travail RÉEL ne déclenche aucun vidage non plus", () => {
    const { obs } = observation({
      heavy: supervision({ state: "idle", prompt: "mission en cours" }),
      sessions: probe({ working: true }),
    });
    expect(obs.working).toBe(true);
    expect(obs.auRepos).toBe(false);
    expect(isAgentWorking({ working: true })).toBe(true);
    expect(vidage(["demande"], obs).texte).toBeNull();
  });

  it("une session MORTE qui porte encore sa mission n'est pas « au repos »", () => {
    // Le processus est mort mais la mission reste confiée : c'est un démarrage
    // en cours du point de vue de l'écran, donc rien ne part tant que la borne
    // de `trackMissionStarting` n'est pas dépassée. Aucune seconde demande ne
    // peut s'ajouter par-dessus une mission encore portée.
    const { list, obs } = observation({
      heavy: supervision({ state: "idle", prompt: "mission perdue", alive: false }),
      sessions: probe({ working: false, alive: false }),
    });
    // L'assistant appartient TOUJOURS à la liste (règle 2 du store) : sa
    // vivacité y est donc lisible telle quelle, sans sonde lourde.
    expect(list).toHaveLength(1);
    expect(list[0].alive).toBe(false);
    expect(obs.known).toBe(true);
    expect(obs.starting).toBe(true);
    expect(obs.auRepos).toBe(false);
    expect(vidage(["demande"], obs).texte).toBeNull();
  });

  it("la vivacité est publiée telle quelle, jamais « vivant par défaut »", () => {
    const vivant = observation({ heavy: supervision({ alive: true }), sessions: probe({ working: true }) });
    expect(vivant.list[0].alive).toBe(true);
    expect(vivant.obs.alive).toBe(true);
    // Aucune information de vivacité nulle part : le champ reste ABSENT de
    // l'entrée (forme historique préservée) et vaut `false` à la lecture.
    const inconnu = observation({
      heavy: { projects: [{ path: "", name: "", agents: [{ id: "superagent", state: "idle" }] }] },
      sessions: [{ project: "", agent: "superagent", working: false }],
    });
    expect("alive" in inconnu.list[0]).toBe(false);
    expect(inconnu.obs.alive).toBe(false);
    expect(ACTIVITE).toContain('if (typeof a.alive === "boolean") entry.alive = a.alive;');
  });
});
