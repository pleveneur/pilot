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
//
// LOT A (verrous de livraison) : deux trous de plus sont fermés ici, et leurs
// verrous sont des tests RETOURNÉS (jamais supprimés) :
//   C2 — la déclaration des livrables était FACULTATIVE et la délégation directe
//        n'offrait même pas le paramètre : une demande d'écriture sans liste est
//        désormais refusée au lancement (`undeclaredWriteRefusalMessage`).
//   C3 — un fichier EXISTANT mais VIDE comptait conforme : il faut maintenant
//        exister, ne pas être vide, ET avoir changé depuis le relevé de départ
//        (`captureDeliverableState` / `fileChangedSince`).
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
  undeclaredWriteRefusalMessage,
  captureDeliverableState,
  fileChangedSince,
} from "./deliverable-guard.js";
// Découpage de source VÉRIFIÉ (ancre absente = échec, jamais un fragment vide).
import { sliceFrom } from "./source-slice.js";
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
function instrument({ existing = [], empty = [], stale = [] } = {}) {
  const spawned = [];
  const sent = [];
  // Nombre de relevés par chemin : la PREMIÈRE mesure (celle du lancement) vaut
  // 1 000 ms, les suivantes avancent de 1 000 ms. Un fichier produit pendant la
  // mission est donc VU comme modifié, de façon déterministe (aucune horloge
  // réelle, aucun test intermittent). `stale` fige la date : le fichier n'a pas
  // bougé depuis le lancement.
  const probes = new Map();
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
      return [...existing, ...empty, ...stale].some((suffix) => path.endsWith(suffix));
    }
    if (cmd === "get_file_size") {
      const path = String(args.path || "");
      // C3 : un fichier de 0 octet existe mais ne prouve rien.
      if (empty.some((suffix) => path.endsWith(suffix))) return 0;
      return 24;
    }
    if (cmd === "file_mtime") {
      const path = String(args.path || "");
      const seen = (probes.get(path) || 0) + 1;
      probes.set(path, seen);
      if (stale.some((suffix) => path.endsWith(suffix))) return 1000;
      return 1000 * seen;
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

  // LOT A (C3) : « l'existence seule compte » n'est plus vrai — ce test vérifie
  // désormais la séparation présent / manquant AVEC un relevé de départ (un
  // fichier existant mais inchangé n'est plus un livrable prouvé).
  it("présent (créé pendant la mission) → présent, absent → manquant", async () => {
    const invokeFn = vi.fn(async (cmd, args) => {
      if (cmd === "file_exists") return args.path.endsWith("present.md");
      if (cmd === "get_file_size") return 12;
      if (cmd === "file_mtime") return 1000;
      return undefined;
    });
    const check = await verifyExpectedFiles({
      declared: ["present.md", "absent.md"],
      base: "C:\\projet",
      invokeFn,
      // Relevé de départ : le fichier n'existait pas encore (il a été créé).
      baseline: { base: "C:\\projet", files: { "present.md": { exists: false, size: null, mtime: null }, "absent.md": { exists: false, size: null, mtime: null } } },
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

// ── 3 bis. TROU C3 : un livrable n'est plus prouvé par sa seule existence ───
describe("preuve du livrable : vide et « déjà là » ne comptent plus", () => {
  /** `invoke` de sonde : existence, taille et date pilotées par des tables. */
  function probe({ sizes = {}, mtimes = {} } = {}) {
    return vi.fn(async (cmd, args = {}) => {
      const path = String(args.path || "");
      const key = [...Object.keys(sizes), ...Object.keys(mtimes)].find((k) => path.endsWith(k));
      if (cmd === "file_exists") return !!key;
      if (cmd === "get_file_size") return sizes[key] !== undefined ? sizes[key] : 24;
      if (cmd === "file_mtime") return mtimes[key] !== undefined ? mtimes[key] : 1000;
      throw new Error(`commande inattendue : ${cmd}`);
    });
  }

  it("fileChangedSince : créé, modifié ou identique (pur)", () => {
    // Absent au lancement → créé pendant la mission : changé.
    expect(fileChangedSince({ exists: false }, { exists: true, size: 10, mtime: 5 })).toBe(true);
    // Relevé de départ inconnu → on ne condamne pas.
    expect(fileChangedSince({ exists: null, size: null, mtime: null }, { exists: true, size: 10, mtime: 5 })).toBe(true);
    expect(fileChangedSince(undefined, { exists: true, size: 10, mtime: 5 })).toBe(true);
    // Taille différente / date différente → changé.
    expect(fileChangedSince({ exists: true, size: 1, mtime: 5 }, { exists: true, size: 2, mtime: 5 })).toBe(true);
    expect(fileChangedSince({ exists: true, size: 1, mtime: 5 }, { exists: true, size: 1, mtime: 6 })).toBe(true);
    // Identique → PAS changé (fichier disparu non plus).
    expect(fileChangedSince({ exists: true, size: 1, mtime: 5 }, { exists: true, size: 1, mtime: 5 })).toBe(false);
    expect(fileChangedSince({ exists: true, size: 1, mtime: 5 }, { exists: false, size: null, mtime: null })).toBe(false);
    // Aucune mesure comparable → on ne condamne pas.
    expect(fileChangedSince({ exists: true, size: null, mtime: null }, { exists: true, size: null, mtime: null })).toBe(true);
  });

  it("captureDeliverableState relève l'état d'un fichier VIDE et d'un fichier plein", async () => {
    const state = await captureDeliverableState({
      declared: ["vide.md", "plein.md"],
      base: "C:\\projet",
      invokeFn: probe({ sizes: { "vide.md": 0, "plein.md": 12 }, mtimes: { "vide.md": 7, "plein.md": 7 } }),
    });
    expect(state.base).toBe("C:\\projet");
    expect(state.files["vide.md"]).toEqual({ exists: true, size: 0, mtime: 7 });
    expect(state.files["plein.md"]).toEqual({ exists: true, size: 12, mtime: 7 });
  });

  it("captureDeliverableState ne relève rien sans livrable ni dossier utilisable", async () => {
    const invokeFn = probe({ sizes: { "a.md": 1 } });
    expect(await captureDeliverableState({ declared: [], base: "C:\\projet", invokeFn })).toBeNull();
    expect(await captureDeliverableState({ declared: ["a.md"], base: "__assistant__", invokeFn })).toBeNull();
    expect(await captureDeliverableState({ declared: ["a.md"], base: "", invokeFn })).toBeNull();
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it("présent + VIDE → refusé, nommé dans `empty`", async () => {
    const invokeFn = probe({ sizes: { "vide.md": 0 }, mtimes: { "vide.md": 1 } });
    const baseline = await captureDeliverableState({ declared: ["vide.md"], base: "C:\\projet", invokeFn });
    const check = await verifyExpectedFiles({ declared: ["vide.md"], base: "C:\\projet", invokeFn, baseline });
    expect(check.present).toEqual([]);
    expect(check.empty).toEqual(["vide.md"]);
    expect(deliverableFailed(check)).toBe(true);
    expect(deliverableVerdictText(check)).toContain("LIVRABLE VIDE");
  });

  it("présent + INCHANGÉ depuis le lancement → refusé, nommé dans `unproven`", async () => {
    const invokeFn = probe({ sizes: { "a.md": 12 }, mtimes: { "a.md": 42 } });
    const baseline = await captureDeliverableState({ declared: ["a.md"], base: "C:\\projet", invokeFn });
    const check = await verifyExpectedFiles({ declared: ["a.md"], base: "C:\\projet", invokeFn, baseline });
    expect(check.unproven).toEqual(["a.md"]);
    expect(deliverableFailed(check)).toBe(true);
    expect(deliverableVerdictText(check)).toContain("LIVRABLE NON PROUVÉ");
  });

  it("présent + MODIFIÉ (date) depuis le lancement → conforme", async () => {
    let n = 0;
    const invokeFn = vi.fn(async (cmd) => {
      if (cmd === "file_exists") return true;
      if (cmd === "get_file_size") return 12;
      if (cmd === "file_mtime") return (n += 1) * 1000;
      throw new Error(cmd);
    });
    const baseline = await captureDeliverableState({ declared: ["a.md"], base: "C:\\projet", invokeFn });
    const check = await verifyExpectedFiles({ declared: ["a.md"], base: "C:\\projet", invokeFn, baseline });
    expect(check.present).toEqual(["a.md"]);
    expect(deliverableFailed(check)).toBe(false);
    expect(deliverableVerdictText(check)).toContain("Livrable vérifié");
  });

  it("sans relevé de départ, la production n'est PAS prouvée", async () => {
    const invokeFn = probe({ sizes: { "a.md": 12 }, mtimes: { "a.md": 1 } });
    const check = await verifyExpectedFiles({ declared: ["a.md"], base: "C:\\projet", invokeFn });
    expect(check.unproven).toEqual(["a.md"]);
    expect(deliverableFailed(check)).toBe(true);
  });

  it("un relevé de départ EN PANNE ne condamne pas la mission (fail-open)", async () => {
    const invokeFn = probe({ sizes: { "a.md": 12 }, mtimes: { "a.md": 1 } });
    const check = await verifyExpectedFiles({ declared: ["a.md"], base: "C:\\projet", invokeFn, baseline: null });
    expect(check.present).toEqual(["a.md"]);
    expect(deliverableFailed(check)).toBe(false);
  });
});

// ── 3 ter. TROU C2 : la déclaration du livrable est OBLIGATOIRE ─────────────
describe("déclaration obligatoire : une demande d'écriture sans livrable est refusée", () => {
  it("refuse une demande d'écriture explicite sans `expected_files`", () => {
    const msg = undeclaredWriteRefusalMessage({
      tool: "delegate_to_coder",
      task: "Écris le fichier `plan-organisation-par-defaut.md` à la racine.",
    });
    expect(msg).toBeTruthy();
    expect(msg).toContain("plan-organisation-par-defaut.md");
    expect(msg).toContain("expected_files");
  });

  it("nomme l'absence de fichier précis quand la demande n'en nomme aucun", () => {
    const msg = undeclaredWriteRefusalMessage({
      tool: "run_agents",
      task: "Crée un fichier de synthèse pour la revue.",
      expectedFiles: [],
    });
    expect(msg).toBeTruthy();
    expect(msg).toContain("sans nom de fichier précisé");
    expect(msg).toContain("expected_files");
  });

  it("ne refuse JAMAIS quand les livrables sont déclarés", () => {
    expect(
      undeclaredWriteRefusalMessage({
        tool: "run_agents",
        task: "Écris le fichier `docs/rapport.md`.",
        expectedFiles: ["docs/rapport.md"],
      })
    ).toBeNull();
    // Une liste non vide déclarée sous forme de chaîne compte aussi.
    expect(
      undeclaredWriteRefusalMessage({
        tool: "run_agents",
        task: "Écris le fichier `docs/rapport.md`.",
        expectedFiles: "docs/rapport.md",
      })
    ).toBeNull();
  });

  it("ne refuse pas les missions de LECTURE ni les négations (aucun refus indu)", () => {
    for (const task of [
      "Analyse le projet et propose un plan d'organisation.",
      "Vérifie la cohérence entre les specs et le code.",
      "Écris ta réponse dans le chat : liste les fichiers concernés.",
      "Analyse le fichier main.js sans rien modifier.",
    ]) {
      expect(
        undeclaredWriteRefusalMessage({ tool: "run_agents", task, expectedFiles: [] }),
        `refus indu : ${task}`
      ).toBeNull();
    }
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

  // TEST RETOURNÉ (trou C3) : ce test verrouillait l'inverse — « un fichier
  // existant mais VIDE est conforme ». Un fichier de 0 octet ne peut pas tenir
  // le rôle de livrable : il ne doit plus jamais produire un succès.
  it("un fichier déclaré VIDE (0 octet) n'est PAS conforme : échec explicite", async () => {
    instrument({ empty: ["vide.md"] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["vide.md"], expectedFilesBase: "C:\\projet" },
      "Fichier créé."
    );
    expect(out.done, "un livrable vide ne peut pas produire un succès").toEqual([]);
    expect(out.error.length).toBe(1);
    expect(out.delivered).toContain("LIVRABLE VIDE");
    expect(out.delivered).toContain("vide.md");
  });

  // Trou C3 (suite) : un fichier qui était DÉJÀ là au lancement et qui n'a pas
  // changé n'est pas une preuve de travail, même non vide.
  it("un fichier déclaré INCHANGÉ depuis le lancement est refusé (non prouvé)", async () => {
    instrument({ stale: ["deja-la.md"] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["deja-la.md"], expectedFilesBase: "C:\\projet" },
      "J'ai mis à jour le fichier."
    );
    expect(out.done, "un fichier inchangé ne prouve aucun travail").toEqual([]);
    expect(out.error.length).toBe(1);
    expect(out.delivered).toContain("LIVRABLE NON PROUVÉ");
    expect(out.delivered).toContain("deja-la.md");
  });

  it("un fichier CRÉÉ pendant la mission (absent au départ) est prouvé", async () => {
    instrument({ existing: ["nouveau.md"] });
    const out = await runMission(
      { agentId: "codeur", expectedFiles: ["nouveau.md"], expectedFilesBase: "C:\\projet" },
      "Fichier créé."
    );
    expect(out.error).toEqual([]);
    expect(out.delivered).toContain("Livrable vérifié");
    expect(out.delivered).toContain("nouveau.md");
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
    // TROU C2 : calculer le refus ne suffit pas — il doit INTERROMPRE le
    // lancement (message + réponse « launched: false » + retour). Sans cette
    // porte, la demande partait sans livrable déclaré et rien n'était vérifié.
    expect(body, "le refus de déclaration doit arrêter run_agents").toMatch(
      /if \(undeclaredRefusal\) \{[\s\S]{0,400}?return;/
    );
    expect(body, "un refus neutralisé ne protège rien").not.toMatch(/false\s*&&\s*undeclaredRefusal/);
  });

  it("run_assistant_agents applique les mêmes règles", () => {
    const start = superAgent.indexOf("if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL))");
    expect(start, "handler run_assistant_agents introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, start + 20000);
    expect(body, "refus au lancement absent de run_assistant_agents").toContain("readOnlyWriteRefusalMessage");
    expect(body).toContain("expectedFiles");
    // Espace de référence des agents d'assistant (aucun projet réel).
    expect(body).toContain("get_assistant_workspace");
    // TROU C2 : même exigence que `run_agents` — le refus INTERROMPT.
    expect(body, "le refus de déclaration doit arrêter run_assistant_agents").toMatch(
      /if \(undeclaredRefusal\) \{[\s\S]{0,400}?return;/
    );
    expect(body, "un refus neutralisé ne protège rien").not.toMatch(/false\s*&&\s*undeclaredRefusal/);
  });

  it("delegate_to_coder refuse la même demande vers un agent en lecture seule", () => {
    const start = superAgent.indexOf('action === "delegate_to_coder"');
    expect(start, "handler delegate_to_coder introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, start + 8000);
    expect(body).toContain("readOnlyWriteRefusalMessage");
    // TROU C2 (verrou retourné) : la délégation directe n'offrait AUCUN moyen de
    // déclarer les fichiers attendus, donc aucun livrable n'y était jamais
    // vérifié. Ce test verrouillait cette absence ; il verrouille désormais la
    // présence de la déclaration ET du refus.
    expect(body, "la délégation doit exiger la déclaration des livrables").toContain("undeclaredWriteRefusalMessage");
    expect(body).toContain("expected_files");
    expect(body, "les livrables voyagent avec la demande").toContain("delegationExpectedFiles");
    // TROU C2 : la délégation refuse AVANT de transmettre (sinon l'agent
    // travaille et la déclaration ne sert plus à rien).
    expect(body, "le refus de déclaration doit arrêter la délégation").toMatch(
      /if \(undeclaredDelegation\) \{[\s\S]{0,400}?return;/
    );
    expect(body, "un refus neutralisé ne protège rien").not.toMatch(/false\s*&&\s*undeclaredDelegation/);
  });

  it("delegate_to_coder transmet les livrables et relève leur état de départ", () => {
    expect(superAgent).toContain("expectedFiles: delegationExpectedFiles");
    const start = superAgent.indexOf("export async function transmitDelegationToAgent");
    expect(start, "transmitDelegationToAgent introuvable").toBeGreaterThan(-1);
    const body = superAgent.slice(start, start + 6000);
    expect(body).toContain("captureDeliverableState");
    expect(body).toContain("expectedFiles: declaredDeliverables");
    // La preuve de fin de délégation passe par le module unique. Découpage
    // VÉRIFIÉ (`sliceFrom`) : une ancre absente fait échouer le test au lieu de
    // donner un fragment vide (qui rendrait une assertion négative vraie par
    // construction).
    const report = sliceFrom(superAgent, "async function injectSessionSummaryToSuperAgent");
    expect(report).toContain("verifyExpectedFiles");
    expect(report).toContain("appendDeliverableVerdict");
  });

  it("le bus vérifie les fichiers déclarés et fait échouer la mission", () => {
    expect(agentsBus).toContain("verifyExpectedFiles");
    expect(agentsBus).toContain("deliverableFailed");
    // Le verdict est joint au rapport livré (jamais un succès muet).
    expect(agentsBus).toContain("appendDeliverableVerdict");
  });

  it("les outils de l'assistant exposent `expected_files` sur les TROIS voies de lancement", () => {
    const occurrences = (actions.match(/expected_files: Type\.Optional/g) || []).length;
    // TROU C2 (verrou retourné) : ce test verrouillait la valeur 2 — donc
    // l'ABSENCE de `expected_files` sur `delegate_to_coder`. La liste est
    // désormais offerte sur les trois voies : run_agents, run_assistant_agents
    // ET delegate_to_coder.
    expect(occurrences, "`expected_files` doit être déclaré sur run_agents, run_assistant_agents ET delegate_to_coder").toBe(3);
    const delegateStart = actions.indexOf('name: "delegate_to_coder"');
    expect(delegateStart, "outil delegate_to_coder introuvable").toBeGreaterThan(-1);
    const delegateBody = actions.slice(delegateStart, delegateStart + 9000);
    expect(delegateBody, "l'outil doit exposer expected_files").toContain("expected_files");
    expect(delegateBody, "l'outil doit transmettre la liste à Pilot").toContain("expectedFiles:");
  });
});
