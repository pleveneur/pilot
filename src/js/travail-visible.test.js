// travail-visible.test.js — PREUVES que l'écran montre le travail en cours
//
// Contexte : pendant une compilation ou une suite de tests de dix minutes,
// l'utilisateur croyait que tout était arrêté (rapport
// `.pilot/rapports/rapport-diagnostic-attente-silencieuse.md`). La cause n'était
// pas la tuyauterie de données (les signaux début/progression/fin arrivent) mais
// l'AFFICHAGE, qui traitait une commande comme un événement instantané.
//
// Ces tests sont la preuve opposable de la correction. Ils doivent ÉCHOUER si :
//   1. l'écran cesse de montrer le travail en cours (volet des missions, sortie
//      en direct de l'onglet agent) ;
//   2. la durée écoulée cesse d'être affichée (compteur, fiche, mission) ;
//   3. un libellé rassurant (« Prêt », « Repos », « Réflexion… ») revient
//      pendant qu'un programme externe travaille.
//
// Le fichier vérifie deux niveaux :
//   - FONCTIONNEL : modules purs (`duree-travail.js`) et rendus (`agent-activity.js`) ;
//   - SOURCE : les branchements de `agent-pi.js` (l'onglet agent ne peut pas être
//     instancié sous Vitest : aucune API Tauri), vérifiés par lecture du source
//     comme les autres gardes du projet (`agent-scroll.test.js`, `regle-2-...`).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatElapsed,
  shortElapsed,
  formatWorkingSince,
  formatWorkingSinceShort,
  resolveAgentStatus,
  clipLiveOutput,
  toolUpdateText,
  STATUS_IDLE,
  STATUS_THINKING,
  LIVE_OUTPUT_MAX_LINES,
} from "./duree-travail.js";
import {
  flattenAgents,
  anyBusy,
  buildRunningMissions,
  renderMissionsPanelHtml,
  renderCard,
} from "./agent-activity.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Lit un fichier source avec fins de ligne normalisées (piège CRLF en CI). */
function source(rel) {
  return readFileSync(join(HERE, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Extrait le bloc compris entre deux ancres (bornes incluses). */
function sliceBetween(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  expect(start, `ancre de début introuvable : ${startAnchor}`).toBeGreaterThan(-1);
  const end = text.indexOf(endAnchor, start + startAnchor.length);
  expect(end, `ancre de fin introuvable : ${endAnchor}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

// Agent « en train de compiler depuis 3 min 12 s », tel que le produit la
// supervision (busy=false car pi attend l'outil, toolInProgress=true).
function compilingAgent(extra) {
  return Object.assign(
    {
      agentId: "codeur|C:/proj/Pilot",
      rawId: "codeur",
      label: "codeur",
      project: "Pilot",
      projectPath: "C:/proj/Pilot",
      state: "idle",
      busy: false,
      working: true,
      toolInProgress: true,
      workingSince: 1_000_000,
      prompt: "Lancer la suite de tests du projet",
      lastActivity: "10:12",
      lastActivityRelative: "il y a 4 min",
      kind: "agent",
    },
    extra || {}
  );
}

describe("formatElapsed — la durée doit être lisible et AVANCER", () => {
  it("affiche les secondes tant qu'on reste sous la minute", () => {
    expect(formatElapsed(0)).toBe("0 s");
    expect(formatElapsed(1000)).toBe("1 s");
    expect(formatElapsed(42_000)).toBe("42 s");
    expect(formatElapsed(59_900)).toBe("59 s");
  });

  it("affiche minutes ET secondes au-delà d'une minute", () => {
    expect(formatElapsed(60_000)).toBe("1 min 00 s");
    expect(formatElapsed(192_000)).toBe("3 min 12 s");
    expect(formatElapsed(600_000)).toBe("10 min 00 s");
  });

  it("affiche les heures quand un travail dure", () => {
    expect(formatElapsed(3_907_000)).toBe("1 h 05 min 07 s");
  });

  it("ne produit jamais une durée négative ou invalide", () => {
    expect(formatElapsed(-5000)).toBe("0 s");
    expect(formatElapsed(NaN)).toBe("0 s");
    expect(formatElapsed(undefined)).toBe("0 s");
  });

  it("version compacte des panneaux étroits", () => {
    expect(shortElapsed(42_000)).toBe("42 s");
    expect(shortElapsed(192_000)).toBe("3 min");
    expect(shortElapsed(3_907_000)).toBe("1 h 05 min");
  });
});

describe("formatWorkingSince — une ligne datée, jamais une durée inventée", () => {
  it("produit la phrase attendue", () => {
    expect(formatWorkingSince(1_000_000, 1_192_000)).toBe("En cours depuis 3 min 12 s");
    expect(formatWorkingSinceShort(1_000_000, 1_192_000)).toBe("depuis 3 min");
  });

  it("renvoie null quand le début est inconnu (rien à dater)", () => {
    expect(formatWorkingSince(0)).toBeNull();
    expect(formatWorkingSince(null)).toBeNull();
    expect(formatWorkingSince(undefined)).toBeNull();
    expect(formatWorkingSinceShort(0)).toBeNull();
  });
});

describe("resolveAgentStatus — le libellé dit la VÉRITÉ (preuve n° 3)", () => {
  it("pendant une commande : dit laquelle et depuis quand", () => {
    const st = resolveAgentStatus({
      toolInProgress: true,
      toolName: "bash",
      toolStartedAt: 1_000_000,
      now: 1_192_000,
    });
    expect(st.text).toContain("bash");
    expect(st.text).toContain("en cours");
    expect(st.text).toContain("3 min 12 s");
    expect(st.working).toBe(true);
    expect(st.className).toContain("agent-status-streaming");
  });

  it("ne dit JAMAIS « Prêt » pendant une commande", () => {
    const st = resolveAgentStatus({
      toolInProgress: true,
      toolName: "bash",
      toolStartedAt: 1_000_000,
      now: 1_010_000,
    });
    expect(st.text).not.toBe(STATUS_IDLE);
    expect(st.text).not.toContain("Prêt");
  });

  it("ne dit JAMAIS « Réflexion » pendant une commande (le modèle attend un programme)", () => {
    // `processing` peut rester vrai côté backend pendant l'outil : la commande
    // doit prendre le pas sur le libellé de réflexion.
    const st = resolveAgentStatus({
      processing: true,
      toolInProgress: true,
      toolName: "cargo",
      toolStartedAt: 1_000_000,
      now: 1_010_000,
    });
    expect(st.text).not.toContain("Réflexion");
    expect(st.text).toContain("cargo");
  });

  it("un compteur local suffit même si le drapeau du moteur est absent", () => {
    const st = resolveAgentStatus({
      toolInProgress: false,
      toolStartedAt: 1_000_000,
      now: 1_005_000,
    });
    expect(st.text).toContain("en cours");
    expect(st.text).toContain("5 s");
  });

  it("conserve le libellé de réflexion hors commande (contrat historique)", () => {
    expect(resolveAgentStatus({ processing: true }).text).toBe(STATUS_THINKING);
  });

  it("conserve « Prêt » au repos et le préfixe de rôle du mode Orchestration", () => {
    expect(resolveAgentStatus({}).text).toBe("Prêt");
    expect(resolveAgentStatus({}).className).toContain("agent-status-idle");
    expect(
      resolveAgentStatus({ processing: true, prefix: "🔨 Codeur — " }).text.startsWith("🔨 Codeur — ")
    ).toBe(true);
    expect(
      resolveAgentStatus({ toolInProgress: true, toolName: "bash", prefix: "🔨 Codeur — " }).text.startsWith(
        "🔨 Codeur — "
      )
    ).toBe(true);
  });
});

describe("clipLiveOutput — sortie en direct bornée et honnête", () => {
  it("garde les DERNIÈRES lignes (ce qui vient de se passer)", () => {
    const text = Array.from({ length: 30 }, (_, i) => `ligne ${i + 1}`).join("\n");
    const out = clipLiveOutput(text, 3);
    expect(out).toContain("ligne 30");
    expect(out).not.toContain("ligne 27");
    expect(out.startsWith("…")).toBe(true);
  });

  it("borne aussi en caractères, par la fin", () => {
    const text = "a".repeat(5000) + "FIN";
    const out = clipLiveOutput(text, 10, 100);
    expect(Array.from(out).length).toBeLessThanOrEqual(104);
    expect(out.endsWith("FIN")).toBe(true);
  });

  it("ne préfixe pas quand rien n'est coupé, et renvoie vide sans contenu", () => {
    expect(clipLiveOutput("compile: ok", 10)).toBe("compile: ok");
    expect(clipLiveOutput("", 10)).toBe("");
    expect(clipLiveOutput(null, 10)).toBe("");
    expect(clipLiveOutput("   \n  ", 10)).toBe("");
  });

  it("normalise les fins de ligne Windows", () => {
    expect(clipLiveOutput("a\r\nb", 10)).toBe("a\nb");
  });

  it("respecte le plafond par défaut de lignes", () => {
    const text = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    const out = clipLiveOutput(text);
    expect(out.split("\n").length).toBe(LIVE_OUTPUT_MAX_LINES + 1); // + la ligne « … »
  });
});

describe("toolUpdateText — extraction sans invention", () => {
  it("lit une chaîne, un objet output/stdout/text ou un contenu structuré", () => {
    expect(toolUpdateText({ partialResult: "ok" })).toBe("ok");
    expect(toolUpdateText({ partialResult: { output: "out" } })).toBe("out");
    expect(toolUpdateText({ partialResult: { stdout: "std" } })).toBe("std");
    expect(toolUpdateText({ partialResult: { text: "txt" } })).toBe("txt");
    expect(toolUpdateText({ partialResult: { content: [{ text: "a" }, { text: "b" }] } })).toBe("a\nb");
  });

  it("ne fabrique rien quand rien n'est exploitable", () => {
    expect(toolUpdateText({})).toBe("");
    expect(toolUpdateText(null)).toBe("");
    expect(toolUpdateText({ partialResult: {} })).toBe("");
    expect(toolUpdateText({ partialResult: { autre: 1 } })).toBe("");
  });
});

describe("flattenAgents — durée du travail en cours (preuve n° 2)", () => {
  const sup = {
    projects: [
      {
        path: "C:/proj/Pilot",
        name: "Pilot",
        agents: [
          { agent: "codeur", state: "idle", alive: true, visible: true, active: true, toolInProgress: true },
        ],
      },
    ],
  };

  it("mémorise le début du travail et le conserve tant qu'il dure", () => {
    const store = new Map();
    const first = flattenAgents(sup, new Map(), store);
    expect(first[0].workingSince).toBeGreaterThan(0);
    const again = flattenAgents(sup, new Map(), store);
    expect(again[0].workingSince).toBe(first[0].workingSince);
  });

  it("oublie la durée dès que l'agent ne travaille plus (aucune durée périmée)", () => {
    const store = new Map();
    flattenAgents(sup, new Map(), store);
    const idle = {
      projects: [
        {
          path: "C:/proj/Pilot",
          name: "Pilot",
          agents: [{ agent: "codeur", state: "idle", alive: true, visible: true, active: true }],
        },
      ],
    };
    const after = flattenAgents(idle, new Map(), store);
    expect(after[0].working).toBe(false);
    expect(after[0].workingSince).toBeNull();
    expect(store.size).toBe(0);
  });

  it("sans magasin de durées : champ null, aucun effet (contrat historique)", () => {
    const list = flattenAgents(sup);
    expect(list[0].workingSince).toBeNull();
    expect(list[0].busy).toBe(false);
    expect(list[0].working).toBe(true);
  });

  it("anyBusy compte le travail RÉEL (outil long), pas seulement `busy`", () => {
    const list = flattenAgents(sup);
    expect(list[0].busy).toBe(false);
    expect(anyBusy(list)).toBe(true);
  });

  it("recopie le relatif fourni par le moteur (il avance pendant le travail)", () => {
    const withRel = {
      projects: [
        {
          path: "C:/proj/Pilot",
          name: "Pilot",
          agents: [
            {
              agent: "codeur",
              state: "idle",
              alive: true,
              visible: true,
              active: true,
              toolInProgress: true,
              lastActivity: "2026-01-01T10:00:00Z",
              lastActivityRelative: "il y a 12 s",
            },
          ],
        },
      ],
    };
    const list = flattenAgents(withRel);
    expect(list[0].lastActivityRelative).toBe("il y a 12 s");
  });
});

describe("Panneau des missions — le travail en cours est VISIBLE (preuve n° 1)", () => {
  it("une compilation silencieuse apparaît, avec sa durée", () => {
    const missions = buildRunningMissions([compilingAgent()], []);
    expect(missions).toHaveLength(1);
    expect(missions[0].since).toBe(1_000_000);
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("En cours (1)");
    expect(html).toContain("codeur");
    expect(html).toContain("Lancer la suite de tests du projet");
    expect(html).toContain("sa-missions-dot");
    expect(html).toContain("depuis");
  });

  it("la ligne datée n'apparaît PAS quand le début est inconnu (aucune invention)", () => {
    const missions = buildRunningMissions([compilingAgent({ workingSince: null })], []);
    expect(missions[0].since).toBeUndefined();
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("en cours");
    expect(html).not.toContain("sa-task-since");
  });

  it("une mission seulement EN ATTENTE n'est jamais datée ni marquée « en cours »", () => {
    const html = renderMissionsPanelHtml(
      buildRunningMissions([compilingAgent()], [{ agent: "codeur", project: "Pilot", mission: "file" }])
    );
    const waiting = html.slice(html.indexOf("En attente"));
    expect(waiting).toContain("en attente");
    expect(waiting).not.toContain("sa-task-since");
    expect(waiting).not.toContain("sa-missions-dot");
  });
});

describe("Fiche d'agent — « En cours depuis » et dernière activité qui avance", () => {
  it("affiche la durée du travail en cours", () => {
    const since = Date.now() - 192_000;
    const html = renderCard(compilingAgent({ workingSince: since }));
    expect(html).toContain("En cours depuis");
    expect(html).toContain("3 min");
    expect(html).toContain("Travail");
  });

  it("préfère le relatif du moteur à l'heure figée", () => {
    const html = renderCard(compilingAgent({ lastActivityRelative: "il y a 12 s" }));
    expect(html).toContain("il y a 12 s");
  });

  it("n'affiche AUCUNE durée au repos et ne dit jamais « Prêt » pour un travail en cours", () => {
    const idle = renderCard(
      compilingAgent({ working: false, busy: false, toolInProgress: false, workingSince: null })
    );
    expect(idle).toContain("Repos");
    expect(idle).not.toContain("En cours depuis");
    const working = renderCard(compilingAgent());
    expect(working).not.toContain("Repos");
  });
});

describe("agent-pi.js — branchements de l'onglet agent (lecture du source)", () => {
  const src = source("agent-pi.js");

  it("n'ignore plus la progression d'une commande : la sortie en direct est écrite", () => {
    const upd = sliceBetween(src, 'case "tool_execution_update"', 'case "tool_execution_end"');
    expect(upd).toContain("writeLiveToolOutput");
    expect(upd).toContain("toolUpdateText");
    expect(upd).toContain("LIVE_OUTPUT_THROTTLE_MS");
    // Le bloc de sortie existe bien dans le DOM, sous le badge de l'outil.
    const writer = sliceBetween(src, "function writeLiveToolOutput", "function finalizeToolBlock");
    expect(writer).toContain("agent-tool-live");
    expect(writer).toContain("clipLiveOutput");
  });

  it("la sortie en direct est retirée et la durée FIGÉE à la fin de la commande", () => {
    expect(src).toContain("function finalizeToolBlock");
    const fin = sliceBetween(src, "function finalizeToolBlock", "function appendToolResult");
    expect(fin).toContain("agent-tool-live");
    expect(fin).toContain("remove()");
    expect(fin).toContain("agent-tool-elapsed");
    const endCase = sliceBetween(src, 'case "tool_execution_end"', 'case "compaction_start"');
    expect(endCase).toContain("finalizeToolBlock(state");
  });

  it("un compteur de durée bat chaque seconde sur le bloc en cours", () => {
    expect(src).toContain("statusTicker");
    const ticker = sliceBetween(src, "const statusTicker = setInterval", "const _clearStatusPoll");
    expect(ticker).toContain("agent-tool-inline.running");
    expect(ticker).toContain("agent-tool-elapsed");
    expect(ticker).toContain("formatElapsed");
  });

  it("le poll de supervision consulte l'outil en cours (plus de « Prêt » pendant une compilation)", () => {
    const poll = sliceBetween(src, "const statusPoll = setInterval", "const statusTicker");
    expect(poll).toContain("toolInProgress");
    expect(poll).toContain("applyAgentStatus");
    expect(poll).toContain("agent-tool-inline.running");
  });

  it("le libellé d'état est décidé par resolveAgentStatus et démarre à la première commande", () => {
    expect(src).toContain("const applyAgentStatus = (opts)");
    expect(src).toContain("resolveAgentStatus({");
    const start = sliceBetween(src, 'case "tool_execution_start"', 'case "tool_execution_update"');
    expect(start).toContain("state.toolStartedAt = Date.now()");
    expect(start).toContain("applyAgentStatus({ processing: true, toolInProgress: true })");
  });

  it("les blocs rendus depuis l'historique ne sont jamais marqués « en cours »", () => {
    const calls = src.match(/appendToolBlock\([^)]*\)/g) || [];
    const live = calls.filter((c) => /,\s*true\s*\)$/.test(c));
    expect(live).toHaveLength(1);
    expect(live[0]).toContain("state.currentAssistantBlock");
  });
});

describe("agent-activity.js — la durée est alimentée par le store partagé (source)", () => {
  const src = source("agent-activity.js");

  it("le rafraîchissement transmet le magasin des durées", () => {
    expect(src).toContain("flattenAgents(sup, lastActivity, workingSince)");
    expect(src).toContain("const workingSince = new Map()");
  });

  it("le rendu des fiches et des missions utilise les durées", () => {
    expect(src).toContain("formatWorkingSince(agent.workingSince)");
    expect(src).toContain("formatWorkingSinceShort(m.since)");
  });
});

describe("dashboard.rs — le moteur publie l'horodatage DÉJÀ calculé (source)", () => {
  const rs = source("../../src-tauri/src/dashboard.rs");

  it("recopie lastActivity / lastActivityRelative / isWorking dans la supervision", () => {
    expect(rs).toContain('.get("lastActivity")');
    expect(rs).toContain('.get("lastActivityRelative")');
    expect(rs).toContain('.get("isWorking")');
    expect(rs).toContain('entry["lastActivity"]');
    expect(rs).toContain('entry["lastActivityRelative"]');
    expect(rs).toContain('entry["isWorking"]');
  });

  it("ne change pas le sens de `toolInProgress` ni ne touche aux détections d'anomalie", () => {
    expect(rs).toContain('s\n            .get("toolInProgress")');
    expect(rs).toContain("agent_anomaly.lock()");
  });
});
