// GARDE-FOU DU LIVRABLE — « l'agent rend un plan » (défaut reproductible).
//
// Défaut fermé ici (diagnostic `.pilot/rapports/rapport-diagnostic-agent-rend-un-plan.md`) :
// une demande d'ÉCRITURE confiée à un agent en LECTURE SEULE, puis Pilot annonce
// « tâche terminée » alors qu'aucun fichier n'existe.
//
// Les preuves sont de deux natures, et les deux comptent :
//  (1) EXÉCUTION, au niveau du bus d'agents (là où les missions sont livrées) :
//      fichiers déclarés absents → ÉCHEC explicite nommant le fichier ; présents
//      → succès + confirmation ; aucun fichier déclaré → comportement inchangé ;
//      agent jetable (lecture seule) → mêmes règles ;
//  (2) VERROU DE SOURCE : les gardes sont bien branchées aux DEUX familles de
//      lancement, dans la délégation directe, et exposées dans les outils de
//      l'assistant — ce test ÉCHOUE si une garde disparaît.
import { describe, it, expect, vi, afterEach } from "vitest";

if (typeof globalThis.window === "undefined") globalThis.window = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolveFs } from "node:path";

import { invoke } from "@tauri-apps/api/core";
import {
  detectExplicitWriteRequest,
  readOnlyWriteRefusalMessage,
  normalizeExpectedFiles,
  verifyExpectedFiles,
  deliverableVerdictText,
  appendDeliverableVerdict,
  deliverableFailed,
} from "./deliverable-guard.js";
import { buildEphemeralAgent, persistEphemeralAgent, disposeEphemeralAgents, resetEphemeralAgents } from "./ephemeral-agents.js";
import { initAgentsBus, destroyAgentsBus, runAgentsForAssistantAsync, handleAgentEvent } from "./agents-bus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Lit un source du dépôt en normalisant les fins de ligne (piège CI Windows). */
function readSource(relPath) {
  return readFileSync(resolveFs(HERE, relPath), "utf8").replace(/\r\n/g, "\n");
}

const PROJECT = "preuve-garde-fou-livrable";

const REGISTRY = {
  agents: [
    {
      id: "codeur",
      name: "Codeur",
      readonly: false,
      keep_context: false,
      models: { pi: "test/model", plh: "test/model" },
      capabilities: ["write"],
      max_calls_per_run: 3,
      call_depth: 1,
    },
    {
      id: "plan-maker",
      name: "Plan Maker",
      readonly: true,
      keep_context: false,
      models: { pi: "test/model", plh: "test/model" },
      capabilities: ["plan"],
      max_calls_per_run: 3,
      call_depth: 1,
    },
  ],
};

async function flushAsync(n = 20) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/**
 * `invoke` instrumenté. `existing` = liste des chemins considérés présents sur
 * disque (par suffixe de chemin), tout le reste étant ABSENT — c'est ce qui
 * permet de prouver qu'un fichier déclaré absent fait échouer la mission.
 */
function instrument({ existing = [] } = {}) {
  const spawned = [];
  const sent = [];
  vi.mocked(invoke).mockImplementation(async (cmd, args = {}) => {
    if (cmd === "get_config") return {};
    if (cmd === "list_agents") return REGISTRY;
    if (cmd === "list_agent_sessions" || cmd === "agent_activity_probe") return { sessions: [] };
    if (cmd === "register_ephemeral_agent") return args.agent;
    if (cmd === "start_agent_process") {
      spawned.push(args.agentId);
      return 1;
    }
    if (cmd === "send_agent_process_prompt") {
      sent.push({ agentId: args.agentId, message: args.message });
      return undefined;
    }
    if (cmd === "file_exists") {
      const path = String(args.path || "");
      return existing.some((suffix) => path.endsWith(suffix));
    }
    if (cmd === "git_status_project") return { is_repo: true, head_ts: 0, pending: 0 };
    return undefined;
  });
  return { spawned, sent };
}

/** Joue un tour d'agent complet (démarrage → texte → fin) dans le bus. */
function playTurn(agentId, text = "Travail terminé.") {
  const ev = (event) => ({ payload: { project: PROJECT, agent_id: agentId, event } });
  handleAgentEvent(ev({ type: "agent_start" }));
  handleAgentEvent(ev({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } }));
  handleAgentEvent(ev({ type: "agent_end", willRetry: false }));
}

/** Lance une mission du bus et rend son issue (succès ou échec explicite). */
async function runMission(assignment, text) {
  await initAgentsBus({});
  const out = { done: [], error: [] };
  await runAgentsForAssistantAsync(
    [{ project: PROJECT, brief: "Mission de test.", ...assignment }],
    (t) => out.done.push(t),
    (e) => out.error.push(e)
  );
  await flushAsync();
  playTurn(assignment.agentId, text);
  await flushAsync(24);
  return {
    ...out,
    delivered: out.done.length ? String(out.done[0]) : String((out.error[0] && out.error[0].message) || ""),
  };
}

afterEach(() => {
  if (globalThis.window) globalThis.window._pilotProjectPath = "";
  destroyAgentsBus();
  resetEphemeralAgents();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

// ── 1. Détection du besoin d'écrire : explicite ou rien ─────────────────────
describe("détection d'une demande d'écriture EXPLICITE (conservatrice)", () => {
  it("reconnaît une demande claire d'écrire un fichier nommé", () => {
    for (const task of [
      "Écris le fichier `plan-organisation-par-defaut.md` à la racine.",
      "Crée un fichier de test pour le verrou.",
      "Modifie src/js/main.js pour corriger le raccourci.",
      "Génère le rapport docs/rapport.md.",
    ]) {
      const d = detectExplicitWriteRequest(task);
      expect(d.explicit, `demande non reconnue : ${task}`).toBe(true);
      expect(d.verb).toBeTruthy();
    }
  });

  it("reconnaît une demande d'écriture en anglais", () => {
    expect(detectExplicitWriteRequest("Write the file report.md at the root.").explicit).toBe(true);
  });

  it("ne refuse JAMAIS une mission de lecture (aucune demande d'écriture)", () => {
    for (const task of [
      "Analyse le projet et propose un plan d'organisation.",
      "Vérifie la cohérence entre les specs et le code.",
      "Relis les fichiers de spec et dis-moi ce qui manque.",
      "Explique comment fonctionne le verrou de run.",
    ]) {
      expect(detectExplicitWriteRequest(task).explicit, `refus indu : ${task}`).toBe(false);
    }
  });

  it("ne refuse pas une demande qui demande explicitement de NE PAS écrire", () => {
    for (const task of [
      "Analyse le fichier main.js sans rien modifier.",
      "Relis ce fichier et ne modifie pas le code.",
      "Tu ne crées aucun fichier : rends seulement ton avis.",
      "Read main.js without modifying it.",
    ]) {
      expect(detectExplicitWriteRequest(task).explicit, `refus indu (négation) : ${task}`).toBe(false);
    }
  });

  it("un verbe d'écriture SANS cible de fichier reste ambigu → pas de refus", () => {
    // Dans le doute, on lance comme avant : écrire un plan peut être une réponse.
    const d = detectExplicitWriteRequest("Écris un plan d'organisation en trois étapes.");
    expect(d.explicit).toBe(false);
    expect(d.verb).toBeTruthy();
  });

  it("un livrable DÉCLARÉ est en soi une demande d'écriture explicite", () => {
    const d = detectExplicitWriteRequest("Fais le nécessaire.", { expectedFiles: ["docs/x.md"] });
    expect(d.explicit).toBe(true);
    expect(d.via).toBe("expected_files");
  });
});

// ── 2. Refus au lancement : message clair, ou aucun refus ───────────────────
describe("refus au lancement d'une demande d'écriture vers un agent en lecture seule", () => {
  const readOnly = [{ id: "plan-maker", name: "Plan Maker", readonly: true }];
  const writer = [{ id: "codeur", name: "Codeur", readonly: false }];
  const writeTask = "Écris le fichier plan-organisation-par-defaut.md à la racine.";

  it("refuse et NOMME l'agent, la raison et la sortie", () => {
    const msg = readOnlyWriteRefusalMessage({ tool: "run_agents", agents: readOnly, task: writeTask });
    expect(msg).toBeTruthy();
    expect(msg).toContain("Plan Maker"); // quel agent refuse
    expect(msg).toContain("LECTURE SEULE");
    expect(msg).toContain("aucun fichier"); // pourquoi
    expect(msg).toContain("agent qui écrit"); // quoi faire
    expect(msg).toContain("n'a PAS été lancée"); // rien n'a démarré
  });

  it("n'empêche JAMAIS une mission de lecture sur un agent en lecture seule", () => {
    expect(
      readOnlyWriteRefusalMessage({
        tool: "run_agents",
        agents: readOnly,
        task: "Analyse le projet et propose un plan d'organisation.",
      })
    ).toBeNull();
  });

  it("ne refuse pas un agent qui écrit", () => {
    expect(readOnlyWriteRefusalMessage({ tool: "run_agents", agents: writer, task: writeTask })).toBeNull();
  });

  it("ne refuse pas une mission MIXTE (un agent qui écrit est présent)", () => {
    expect(
      readOnlyWriteRefusalMessage({ tool: "run_agents", agents: [...readOnly, ...writer], task: writeTask })
    ).toBeNull();
  });

  it("refuse aussi quand le livrable est déclaré sans verbe d'écriture", () => {
    const msg = readOnlyWriteRefusalMessage({
      tool: "run_agents",
      agents: readOnly,
      task: "Fais le nécessaire.",
      expectedFiles: ["docs/rapport.md"],
    });
    expect(msg).toBeTruthy();
    expect(msg).toContain("docs/rapport.md");
  });
});

// ── 3. Vérification du livrable (fonctions pures + I/O injectées) ───────────
describe("vérification des fichiers déclarés", () => {
  it("normalise la liste déclarée (chaîne unique, vides, doublons)", () => {
    expect(normalizeExpectedFiles(undefined)).toEqual([]);
    expect(normalizeExpectedFiles(" docs/a.md ")).toEqual(["docs/a.md"]);
    expect(normalizeExpectedFiles(["a.md", "", " a.md ", 42, "b.md"])).toEqual(["a.md", "b.md"]);
  });

  it("présent → présent, absent → manquant (l'existence seule compte)", async () => {
    const invokeFn = vi.fn(async (_cmd, args) => args.path.endsWith("present.md"));
    const check = await verifyExpectedFiles({
      declared: ["present.md", "absent.md"],
      base: "C:\\projet",
      invokeFn,
    });
    expect(check.present).toEqual(["present.md"]);
    expect(check.missing).toEqual(["absent.md"]);
    expect(deliverableFailed(check)).toBe(true);
    // Le chemin vérifié est ABSOLU (résolu dans le projet), pas relatif au cwd.
    expect(invokeFn.mock.calls[0][1].path).toContain("present.md");
    expect(invokeFn.mock.calls[0][1].path).toContain("projet");
  });

  it("sans dossier de référence, la vérification est ANNONCÉE, jamais inventée", async () => {
    const invokeFn = vi.fn();
    const check = await verifyExpectedFiles({ declared: ["a.md"], base: "__assistant__", invokeFn });
    expect(check.skipped).toBe(true);
    expect(deliverableFailed(check)).toBe(false);
    expect(invokeFn).not.toHaveBeenCalled();
    expect(deliverableVerdictText(check)).toContain("non vérifiable");
  });

  it("une sonde indisponible n'échoue jamais la tâche (fail-open)", async () => {
    const check = await verifyExpectedFiles({
      declared: ["a.md"],
      base: "C:\\projet",
      invokeFn: async () => {
        throw new Error("IPC indisponible");
      },
    });
    expect(check.unreadable).toEqual(["a.md"]);
    expect(deliverableFailed(check)).toBe(false);
  });

  it("le verdict nomme le fichier manquant et le dossier où on l'attendait", () => {
    const text = deliverableVerdictText({
      declared: ["docs/rapport.md"],
      present: [],
      missing: ["docs/rapport.md"],
      unreadable: [],
      base: "C:\\projet",
    });
    expect(text).toContain("docs/rapport.md");
    expect(text).toContain("C:\\projet");
    expect(text).toContain("PAS terminée");
    // Sans livrable déclaré, aucun texte n'est ajouté (rétrocompatibilité).
    expect(appendDeliverableVerdict("rapport", null)).toBe("rapport");
  });
});

// ── 4. EXÉCUTION : la mission échoue si le fichier déclaré n'existe pas ─────
describe("fin de mission : le fichier déclaré fait foi", () => {
  it("fichier déclaré ABSENT → ÉCHEC explicite nommant le fichier (jamais « terminé »)", async () => {
    instrument({ existing: [] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["plan-organisation-par-defaut.md"], expectedFilesBase: "C:\\projet" },
      "Voici mon plan : 1. créer le module…"
    );
    expect(out.done, "un livrable absent ne peut pas produire un succès").toEqual([]);
    expect(out.error.length, "l'absence doit être rapportée comme un échec").toBe(1);
    expect(out.delivered).toContain("plan-organisation-par-defaut.md");
    expect(out.delivered).toContain("LIVRABLE ABSENT");
  });

  it("fichier déclaré PRÉSENT → succès, avec confirmation du livrable", async () => {
    instrument({ existing: ["plan-organisation-par-defaut.md"] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["plan-organisation-par-defaut.md"], expectedFilesBase: "C:\\projet" },
      "Plan écrit dans le fichier."
    );
    expect(out.error).toEqual([]);
    expect(out.done.length).toBe(1);
    expect(out.delivered).toContain("Livrable vérifié");
    expect(out.delivered).toContain("plan-organisation-par-defaut.md");
    expect(out.delivered).toContain("Plan écrit dans le fichier.");
  });

  it("AUCUN fichier déclaré → comportement INCHANGÉ (aucune mention de livrable)", async () => {
    instrument({ existing: [] });
    const out = await runMission({ agentId: "codeur" }, "Travail terminé sans livrable déclaré.");
    expect(out.error).toEqual([]);
    expect(out.done.length).toBe(1);
    expect(out.delivered).toContain("Travail terminé");
    expect(out.delivered).not.toContain("Livrable");
  });

  it("un fichier déclaré VIDE (mais existant) est conforme : l'existence seule compte", async () => {
    instrument({ existing: ["vide.md"] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["vide.md"], expectedFilesBase: "C:\\projet" },
      "Fichier créé."
    );
    expect(out.error).toEqual([]);
    expect(out.delivered).toContain("Livrable vérifié");
  });

  it("AGENT JETABLE en lecture seule : mêmes règles (fichier absent → échec explicite)", async () => {
    instrument({ existing: [] });
    const agent = buildEphemeralAgent({
      name: "Rédacteur",
      role: "Tu rédiges la documentation.",
      model: "test/model",
      readonly: true,
    });
    await persistEphemeralAgent(agent, PROJECT);
    const out = await runMission(
      { agentId: agent.id, expectedFiles: ["docs/notice.md"], expectedFilesBase: "C:\\projet" },
      "Voici le contenu de la notice…"
    );
    expect(out.done).toEqual([]);
    expect(out.error.length).toBe(1);
    expect(out.delivered).toContain("docs/notice.md");
    await disposeEphemeralAgents([agent.id], PROJECT);
  });
});

// ── 5. VERROU DE SOURCE : les gardes sont branchées (échec si elles partent) ─
describe("verrou de source : gardes branchées aux deux familles et à la délégation", () => {
  const superAgent = readSource("super-agent.js");
  const agentsBus = readSource("agents-bus.js");
  const actions = readSource("../../src-tauri/extensions/pilot-assistant-actions.ts");

  it("run_agents refuse AVANT tout démarrage et transmet les fichiers attendus", () => {
    const start = superAgent.indexOf('if (title.startsWith(RUN_AGENTS_SENTINEL))');
    const next = superAgent.indexOf("RUN_ASSISTANT_AGENTS_SENTINEL))", start);
    expect(start, "handler run_agents introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, next > start ? next : start + 20000);
    expect(body, "refus au lancement absent de run_agents").toContain("readOnlyWriteRefusalMessage");
    expect(body).toContain("expectedFiles");
    expect(body, "les fichiers déclarés doivent être propagés à la mission").toContain("expectedFilesBase");
  });

  it("run_assistant_agents applique les mêmes règles", () => {
    const start = superAgent.indexOf("if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL))");
    expect(start, "handler run_assistant_agents introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, start + 20000);
    expect(body, "refus au lancement absent de run_assistant_agents").toContain("readOnlyWriteRefusalMessage");
    expect(body).toContain("expectedFiles");
    // Espace de référence des agents d'assistant (aucun projet réel).
    expect(body).toContain("get_assistant_workspace");
  });

  it("delegate_to_coder refuse la même demande vers un agent en lecture seule", () => {
    const start = superAgent.indexOf('action === "delegate_to_coder"');
    expect(start, "handler delegate_to_coder introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, start + 8000);
    expect(body).toContain("readOnlyWriteRefusalMessage");
  });

  it("le bus vérifie les fichiers déclarés et fait échouer la mission", () => {
    expect(agentsBus).toContain("verifyExpectedFiles");
    expect(agentsBus).toContain("deliverableFailed");
    // Le verdict est joint au rapport livré (jamais un succès muet).
    expect(agentsBus).toContain("appendDeliverableVerdict");
  });

  it("les outils de l'assistant exposent `expected_files` (les deux familles)", () => {
    const occurrences = (actions.match(/expected_files: Type\.Optional/g) || []).length;
    expect(occurrences, "`expected_files` doit être déclaré sur run_agents ET run_assistant_agents").toBe(2);
  });
});
