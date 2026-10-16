// Tests unitaires — super-agent-context.js (contexte de suivi joint à une
// demande déléguée par l'assistant) + branchement dans super-agent.js.
//
// Le module est PUR : les tests l'exercent directement. Le branchement (les
// trois points d'appel : `run_agents`, `run_assistant_agents`,
// `delegate_to_coder`) est verrouillé par lecture de la source, comme les
// autres tests de câblage du dépôt.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_DELEGATION_CONTEXT_CHARS,
  DELEGATION_CONTEXT_TITLE,
  DELEGATION_CONTEXT_TRUNCATION_NOTICE,
  normalizeProjectPath,
  findTrackedProject,
  parseSessionMemory,
  boundDelegationContext,
  prefixDelegationContext,
  buildDelegationContext,
} from "./super-agent-context.js";

// ── Jeux de données de suivi ────────────────────────────────────────────────

const TRACKING = {
  clients: [
    {
      name: "Kalico",
      projects: [{ name: "pilot", path: "G:/IA_PL/pilot", tasks_en_cours: 2, tasks_terminees: 5 }],
      decisions_recentes: ["Choix A", "Choix B", "Choix C"],
      sessions_recentes: ["pilot: point deja regle", "autre-projet: hors sujet"],
    },
  ],
};

const MEMORY = {
  current_topic: "contexte delegue",
  active_project: "pilot",
  work_in_progress: ["chantier 1", "chantier 2"],
  notes: "blocage connu : base locale",
};

describe("normalizeProjectPath", () => {
  it("normalise séparateurs, barre finale et casse", () => {
    expect(normalizeProjectPath("G:\\IA_PL\\Pilot\\")).toBe("g:/ia_pl/pilot");
    expect(normalizeProjectPath("g:/ia_pl/pilot")).toBe("g:/ia_pl/pilot");
  });

  it("renvoie une chaîne vide pour une entrée absente", () => {
    expect(normalizeProjectPath(null)).toBe("");
    expect(normalizeProjectPath(undefined)).toBe("");
    expect(normalizeProjectPath("   ")).toBe("");
  });
});

describe("findTrackedProject", () => {
  it("retrouve le projet suivi malgré un chemin écrit différemment", () => {
    const found = findTrackedProject(TRACKING, "g:\\ia_pl\\pilot\\");
    expect(found).not.toBeNull();
    expect(found.project.name).toBe("pilot");
    expect(found.client.name).toBe("Kalico");
  });

  it("ne trouve RIEN pour un projet non suivi (aucune invention)", () => {
    expect(findTrackedProject(TRACKING, "G:/autre/projet")).toBeNull();
  });

  it("ne trouve rien sans chemin", () => {
    expect(findTrackedProject(TRACKING, null)).toBeNull();
  });

  it("tolère une structure de suivi inattendue (fail-open)", () => {
    expect(findTrackedProject(null, "G:/IA_PL/pilot")).toBeNull();
    expect(findTrackedProject({ clients: "oups" }, "G:/IA_PL/pilot")).toBeNull();
    expect(findTrackedProject({ clients: [null, { projects: null }] }, "G:/IA_PL/pilot")).toBeNull();
  });
});

describe("parseSessionMemory", () => {
  it("parse la mémoire fournie en chaîne JSON", () => {
    const m = parseSessionMemory(JSON.stringify(MEMORY));
    expect(m.current_topic).toBe("contexte delegue");
    expect(m.work_in_progress).toEqual(["chantier 1", "chantier 2"]);
    expect(m.notes).toBe("blocage connu : base locale");
  });

  it("accepte un objet déjà désérialisé", () => {
    expect(parseSessionMemory(MEMORY).current_topic).toBe("contexte delegue");
  });

  it("renvoie null pour une mémoire inexploitable (fail-open)", () => {
    expect(parseSessionMemory(null)).toBeNull();
    expect(parseSessionMemory("")).toBeNull();
    expect(parseSessionMemory("pas du json")).toBeNull();
    expect(parseSessionMemory("[1,2]")).toBeNull();
    expect(parseSessionMemory(42)).toBeNull();
  });
});

describe("boundDelegationContext (garde-fou de longueur)", () => {
  it("laisse intact un bloc sous le plafond", () => {
    const text = "court";
    expect(boundDelegationContext(text, 100)).toBe(text);
  });

  it("borne un bloc trop long et annonce la troncature", () => {
    const text = `${DELEGATION_CONTEXT_TITLE}\n${"- ligne tres longue x".repeat(200)}`;
    const out = boundDelegationContext(text, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain("tronque");
  });

  it("ne dépasse jamais le plafond, même minuscule", () => {
    const out = boundDelegationContext("abcdefghij".repeat(50), 10);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it("utilise le plafond par défaut quand il est invalide", () => {
    const text = `${DELEGATION_CONTEXT_TITLE}\n${"- x".repeat(2000)}`;
    expect(boundDelegationContext(text, 0).length).toBeLessThanOrEqual(MAX_DELEGATION_CONTEXT_CHARS);
    expect(boundDelegationContext(text, Number.NaN).length).toBeLessThanOrEqual(MAX_DELEGATION_CONTEXT_CHARS);
  });
});

describe("prefixDelegationContext", () => {
  it("préfixe le contexte et sépare nettement du brief", () => {
    const out = prefixDelegationContext("DEMANDE", "## Contexte de suivi (assistant)\n- Projet : pilot");
    expect(out.startsWith("## Contexte de suivi (assistant)")).toBe(true);
    expect(out.endsWith("DEMANDE")).toBe(true);
    expect(out).toContain("\n\nDEMANDE");
  });

  it("ne touche pas au brief quand le contexte est vide ou absent", () => {
    expect(prefixDelegationContext("DEMANDE", "")).toBe("DEMANDE");
    expect(prefixDelegationContext("DEMANDE", null)).toBe("DEMANDE");
    expect(prefixDelegationContext("DEMANDE", undefined)).toBe("DEMANDE");
    expect(prefixDelegationContext("DEMANDE", "   ")).toBe("DEMANDE");
  });
});

describe("buildDelegationContext", () => {
  it("n'ajoute RIEN quand l'assistant ne sait rien (aucune invention)", () => {
    expect(buildDelegationContext()).toBe("");
    // Un chemin seul n'est pas une connaissance : rien à dire.
    expect(buildDelegationContext({ projectPath: "G:/inconnu/projet" })).toBe("");
    // Un projet inconnu et une mémoire vide : rien non plus.
    expect(buildDelegationContext({ tracking: {}, sessionMemory: null, projectPath: "G:/x" })).toBe("");
  });

  it("compose le bloc à partir du suivi : projet, tâches, décisions, sessions", () => {
    const out = buildDelegationContext({ tracking: TRACKING, projectPath: "G:/IA_PL/pilot" });
    expect(out).toContain(DELEGATION_CONTEXT_TITLE);
    expect(out).toContain("- Projet : pilot");
    expect(out).toContain("2 en cours, 5 terminees");
    expect(out).toContain("Choix A ; Choix B");
    // Décisions bornées (2 max).
    expect(out).not.toContain("Choix C");
    // Seules les sessions DU projet sont reprises, sans le préfixe du nom.
    expect(out).toContain("point deja regle");
    expect(out).not.toContain("hors sujet");
  });

  it("joint la mémoire de session (sujet, chantiers, notes) et l'objectif", () => {
    const out = buildDelegationContext({
      sessionMemory: JSON.stringify(MEMORY),
      projectPath: "G:/IA_PL/pilot",
      task: "Ajoute un test",
    });
    expect(out).toContain("- Sujet en cours : contexte delegue");
    expect(out).toContain("- Chantiers en cours : chantier 1 ; chantier 2");
    expect(out).toContain("- Notes de suivi : blocage connu : base locale");
    expect(out).toContain("- Objectif de la demande : Ajoute un test");
  });

  it("hors projet (`run_assistant_agents`) : mémoire seule, aucun projet inventé", () => {
    const out = buildDelegationContext({ sessionMemory: MEMORY, projectPath: null, task: "range mes notes" });
    expect(out).toContain("- Sujet en cours : contexte delegue");
    expect(out).not.toContain("- Projet :");
  });

  it("nomme le projet d'après le chemin quand le suivi ne le connaît pas", () => {
    const out = buildDelegationContext({ sessionMemory: MEMORY, projectPath: "G:\\travaux\\mon-projet" });
    expect(out).toContain("- Projet : mon-projet");
  });

  it("signale les décisions comme celles du CLIENT quand il suit plusieurs projets", () => {
    const tracking = {
      clients: [
        {
          name: "Kalico",
          projects: [
            { name: "pilot", path: "G:/IA_PL/pilot", tasks_en_cours: 1, tasks_terminees: 0 },
            { name: "autre", path: "G:/IA_PL/autre", tasks_en_cours: 0, tasks_terminees: 1 },
          ],
          decisions_recentes: ["Decision transverse"],
          sessions_recentes: ["autre: rien a voir"],
        },
      ],
    };
    const out = buildDelegationContext({ tracking, projectPath: "G:/IA_PL/pilot" });
    expect(out).toContain("- Decisions recentes (client Kalico)");
    expect(out).not.toContain("rien a voir");
  });

  it("respecte le plafond même avec des données de suivi volumineuses", () => {
    const tracking = {
      clients: [
        {
          name: "Kalico",
          projects: [{ name: "pilot", path: "G:/IA_PL/pilot", tasks_en_cours: 3, tasks_terminees: 4 }],
          decisions_recentes: ["x".repeat(500), "y".repeat(500)],
          sessions_recentes: [`pilot: ${"z".repeat(500)}`],
        },
      ],
    };
    const out = buildDelegationContext({
      tracking,
      sessionMemory: JSON.stringify({ ...MEMORY, notes: "n".repeat(500) }),
      projectPath: "G:/IA_PL/pilot",
      task: "t".repeat(500),
    });
    expect(out.length).toBeLessThanOrEqual(MAX_DELEGATION_CONTEXT_CHARS);
    expect(out).toContain(DELEGATION_CONTEXT_TITLE);
    expect(out).toContain(DELEGATION_CONTEXT_TRUNCATION_NOTICE.trim());
  });

  it("un plafond personnalisé est respecté", () => {
    const out = buildDelegationContext({
      tracking: TRACKING,
      sessionMemory: MEMORY,
      projectPath: "G:/IA_PL/pilot",
      task: "Ajoute un test",
      maxChars: 120,
    });
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.startsWith(DELEGATION_CONTEXT_TITLE)).toBe(true);
  });
});

// ── Branchement : les trois points d'appel de la délégation ─────────────────

const SUPER_AGENT_SRC = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");

function normalizedSource() {
  return SUPER_AGENT_SRC.replace(/\s+/g, " ");
}

function branchWindow(startMarker, endMarker) {
  const start = SUPER_AGENT_SRC.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = SUPER_AGENT_SRC.indexOf(endMarker, start + 1);
  expect(end).toBeGreaterThan(start);
  return SUPER_AGENT_SRC.slice(start, end).replace(/\s+/g, " ");
}

describe("branchement dans super-agent.js", () => {
  it("importe le module pur de contexte de suivi", () => {
    expect(normalizedSource()).toContain(
      'from "./super-agent-context.js"'
    );
    expect(normalizedSource()).toContain("buildDelegationContext");
    expect(normalizedSource()).toContain("prefixDelegationContext");
  });

  it("joint le contexte sur l'agent du PROJET (run_agents, projet cible)", () => {
    const win = branchWindow(
      "if (title.startsWith(RUN_AGENTS_SENTINEL)) {",
      "if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {"
    );
    expect(win).toContain("attachDelegationContext(messagesEl, applyAssistantBriefEnvelope(task, {");
    expect(win).toContain("targetProject || window._pilotProjectPath || null, task)");
  });

  it("joint le contexte sur l'agent HORS projet (run_assistant_agents, sans projet)", () => {
    const win = branchWindow(
      "if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {",
      "if (title.startsWith(SESSIONS_SENTINEL)) {"
    );
    expect(win).toContain("attachDelegationContext(messagesEl, applyAssistantBriefEnvelope(task, {");
    expect(win).toContain("}), null, task)");
  });

  it("joint le contexte sur la délégation directe (delegate_to_coder)", () => {
    const win = branchWindow(
      '} else if (action === "delegate_to_coder") {',
      '} else if (action === "purge_agent_conversation") {'
    );
    expect(win).toContain("attachDelegationContext(messagesEl, applyAssistantBriefEnvelope(info.request, {");
    expect(win).toContain("projectPath");
  });

  it("le contexte est lu depuis le suivi ET la mémoire de session, en fail-open", () => {
    const win = branchWindow(
      "async function loadDelegationContext(projectPath, task) {",
      "async function attachDelegationContext("
    );
    expect(win).toContain('invoke("get_super_agent_tracking")');
    expect(win).toContain('invoke("super_agent_load_session_memory")');
    expect(win).toContain("catch");
  });
});
