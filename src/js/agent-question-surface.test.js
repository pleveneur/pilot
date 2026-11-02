// Tests — UNE QUESTION D'AGENT NE RESTE PLUS JAMAIS SANS RÉPONSE NI SANS FIN.
//
// Défaut protégé (docs/rapports/RAPPORT-gel-questions-sans-surface.md, point 3
// « détonateur » du diagnostic de gel) : la SEULE surface capable d'afficher une
// question d'agent était l'onglet 🧭 Assistant, dont l'écouteur de
// `pilot-agent-relay-request` naît à l'ouverture et meurt à la fermeture.
// Conséquence, onglet fermé :
//   1. la question n'était peinte NULLE PART — personne ne pouvait répondre ;
//   2. l'attente restait ouverte (le plafond de 45 min côté Rust ne faisait que
//      la BORNER), la file du projet restant réservée tout ce temps.
//
// Contrat vérifié ici :
//  - décisions PURES : qui peint (onglet prioritaire, sinon dialogue de secours,
//    sinon PERSONNE), une seule prise en charge par question, formats de réponse
//    exactement ceux qu'attend `pilot-choices.ts` ;
//  - SANS onglet 🧭 : la question est affichée sur la surface de secours et la
//    réponse repart au MÊME endroit du bus (`respondAgentRelay` →
//    `send_agent_command_to`) ;
//  - SANS aucune surface : l'attente est TERMINÉE (trace `question-sans-surface`
//    + arrêt effectif) avec un message explicite — jamais une attente infinie,
//    jamais une réponse inventée ;
//  - onglet 🧭 ouvert : UN SEUL porteur (la surface de secours ne peint rien).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import { beginRun, handleAgentEvent, setBusNotifyCallback } from "./agents-bus.js";
import { AGENT_RELAY_EVENT } from "./agent-choice-relay.js";
import {
  AGENT_QUESTION_NO_SURFACE_DETECTED,
  AGENT_QUESTION_NO_SURFACE_REASON,
  AGENT_QUESTION_SURFACE_DIALOG,
  AGENT_QUESTION_SURFACE_NONE,
  AGENT_QUESTION_SURFACE_TAB,
  agentQuestionAgentLabel,
  agentQuestionAnswer,
  agentQuestionHeadline,
  agentQuestionKey,
  agentQuestionNoSurfaceMessage,
  agentQuestionProjectName,
  agentQuestionSurfaceOf,
  agentQuestionView,
  claimAgentQuestion,
  clearPrimaryAgentQuestionSurface,
  decideAgentQuestionSurface,
  hasPrimaryAgentQuestionSurface,
  isAgentQuestionClaimed,
  normalizeAgentAnswerArgs,
  releaseAgentQuestion,
  resetAgentQuestionSurfaces,
  setPrimaryAgentQuestionSurface,
} from "./agent-question-surface.js";
import {
  handleAgentQuestionRequest,
  initAgentQuestionFallback,
  uninstallAgentQuestionFallback,
} from "./agent-question-fallback.js";

const here = dirname(fileURLToPath(import.meta.url));
// Neutralité CRLF (quality-gate § 3.4).
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");

const PROJET = "G:/p/projetQuestions";
const AGENT = "codeur";

/** `window` minimal : les écouteurs sont RÉELS (ordre d'inscription conservé). */
function fakeWindow() {
  const listeners = new Map();
  return {
    _listeners: listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const fn of [...(listeners.get(ev && ev.type) || [])]) fn(ev);
      return true;
    },
    countFor(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

/** Émet un `extension_ui_request` d'un agent de la run en cours. */
const question = (event) =>
  handleAgentEvent({
    payload: { project: PROJET, agent_id: AGENT, event: { type: "extension_ui_request", ...event } },
  });

/** Laisse tourner les promesses du relais et de la surface de secours. */
const flush = () => new Promise((r) => setTimeout(r, 10));

const appels = (cmd) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, args]) => args);

beforeEach(() => {
  resetAgentQuestionSurfaces();
  uninstallAgentQuestionFallback();
  globalThis.window = fakeWindow();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "read_file_content" ? "" : undefined,
  );
  const ctx = beginRun(PROJET);
  ctx.activeAgents.add(AGENT);
  ctx.agentProject[AGENT] = PROJET;
});

afterEach(() => {
  uninstallAgentQuestionFallback();
  resetAgentQuestionSurfaces();
  setBusNotifyCallback(null);
  delete globalThis.window;
});

// ── a. Décisions pures ──────────────────────────────────────────────────────
describe("qui peint la question — décision pure, une seule par question", () => {
  const detail = (over = {}) => ({
    projectPath: PROJET,
    agentId: AGENT,
    payload: { id: "req-1", method: "select", title: "Quelle approche ?", options: ["A", "B"] },
    ...over,
  });

  it("l'onglet 🧭 est prioritaire, sinon la surface de secours, sinon PERSONNE", () => {
    expect(decideAgentQuestionSurface({ primarySurface: true, appDialogAvailable: true })).toBe(
      AGENT_QUESTION_SURFACE_TAB,
    );
    expect(decideAgentQuestionSurface({ primarySurface: false, appDialogAvailable: true })).toBe(
      AGENT_QUESTION_SURFACE_DIALOG,
    );
    // Sans aucune surface, le choix est explicite : l'appelant doit TERMINER.
    expect(decideAgentQuestionSurface({ primarySurface: false, appDialogAvailable: false })).toBe(
      AGENT_QUESTION_SURFACE_NONE,
    );
    expect(decideAgentQuestionSurface()).toBe(AGENT_QUESTION_SURFACE_NONE);
  });

  it("une question n'a qu'UN porteur : le premier arrive, les suivants sont refuses", () => {
    expect(claimAgentQuestion(detail(), AGENT_QUESTION_SURFACE_TAB)).toBe(true);
    expect(claimAgentQuestion(detail(), AGENT_QUESTION_SURFACE_TAB)).toBe(false);
    expect(claimAgentQuestion(detail(), AGENT_QUESTION_SURFACE_DIALOG)).toBe(false);
    expect(agentQuestionSurfaceOf(detail())).toBe(AGENT_QUESTION_SURFACE_TAB);
    expect(isAgentQuestionClaimed(detail())).toBe(true);
    // Libérée (répondue), elle peut de nouveau être prise (nouvelle émission).
    expect(releaseAgentQuestion(detail())).toBe(true);
    expect(isAgentQuestionClaimed(detail())).toBe(false);
  });

  it("deux questions differentes ne se bloquent pas l'une l'autre", () => {
    expect(claimAgentQuestion(detail(), AGENT_QUESTION_SURFACE_TAB)).toBe(true);
    const autre = detail({ payload: { id: "req-2", method: "select", title: "Autre ?", options: ["x"] } });
    expect(claimAgentQuestion(autre, AGENT_QUESTION_SURFACE_DIALOG)).toBe(true);
  });

  it("la cle d'une question separe projet, agent et demande", () => {
    expect(agentQuestionKey(detail())).toBe(`${PROJET}|${AGENT}|req-1`);
    // Sans agent nomme : « default », comme le registre du bus.
    expect(agentQuestionKey(detail({ agentId: "" }))).toBe(`${PROJET}|default|req-1`);
    // Sans identifiant : aucune cle (non departageable), donc jamais bloquee.
    expect(agentQuestionKey(detail({ payload: { method: "select" } }))).toBe("");
    expect(claimAgentQuestion(detail({ payload: {} }), AGENT_QUESTION_SURFACE_TAB)).toBe(true);
    expect(claimAgentQuestion(detail({ payload: {} }), AGENT_QUESTION_SURFACE_TAB)).toBe(true);
  });

  it("la surface principale se retire avec SON jeton, pas celui d'un autre onglet", () => {
    const jeton = { surface: "onglet-1" };
    setPrimaryAgentQuestionSurface(jeton);
    expect(hasPrimaryAgentQuestionSurface()).toBe(true);
    // Un onglet fermé après lui ne doit pas retirer la surface d'un autre.
    expect(clearPrimaryAgentQuestionSurface({ surface: "onglet-2" })).toBe(false);
    expect(hasPrimaryAgentQuestionSurface()).toBe(true);
    expect(clearPrimaryAgentQuestionSurface(jeton)).toBe(true);
    expect(hasPrimaryAgentQuestionSurface()).toBe(false);
  });

  it("l'en-tete dit QUI pose la question et CE QU'elle demande", () => {
    const headline = agentQuestionHeadline(detail(), agentQuestionView(detail().payload));
    expect(headline).toContain("L'agent « codeur » du projet « projetQuestions »");
    expect(headline).toContain("Quelle approche ?");
    // Projet inconnu : on ne l'invente pas.
    expect(agentQuestionProjectName("")).toBe("");
    expect(agentQuestionAgentLabel("")).toBe("par défaut");
    expect(agentQuestionAgentLabel("default")).toBe("par défaut");
    expect(agentQuestionAgentLabel("reviewer")).toBe("reviewer");
  });
});

describe("vue d'une question — rien de technique n'est peint", () => {
  it("select / confirm / input sont reconnus", () => {
    expect(agentQuestionView({ method: "select", title: "Approche", options: ["A"] }).kind).toBe("select");
    expect(agentQuestionView({ method: "confirm", title: "Continuer ?" }).kind).toBe("confirm");
    expect(agentQuestionView({ method: "input", title: "Nom ?" }).kind).toBe("input");
  });

  it("les sentinelles de presentation sont DEBALLEES (choix multiple, confirmation)", () => {
    const multi = agentQuestionView({
      method: "select",
      title: "PILOT_MULTI_CHOICE::Quels modules ?",
      options: ["api", "ui"],
    });
    expect(multi.kind).toBe("multi");
    expect(multi.title).toBe("Quels modules ?");

    const confirm = agentQuestionView({
      method: "select",
      title: 'PILOT_CONFIRM::{"title":"Écraser ?","message":"Le fichier existe."}',
    });
    expect(confirm.kind).toBe("confirm");
    expect(confirm.title).toBe("Écraser ?");
    expect(confirm.message).toBe("Le fichier existe.");
  });

  it("une sentinelle MACHINE n'est jamais peinte : reponse explicite au moteur", () => {
    const view = agentQuestionView({ method: "input", title: "PILOT_ASSISTANT_SCHEDULE::{\"op\":\"x\"}" });
    expect(view.kind).toBe("machine");
    expect(view.title).toBe("");
    expect(view.options).toEqual([]);
    const reponse = JSON.parse(view.answer);
    expect(reponse.error).toContain("ne peut pas être exécutée depuis la session d'un agent");
  });

  it("une methode sans question n'est ni peinte ni silencieuse", () => {
    expect(agentQuestionView({ method: "notify", title: "info" }).kind).toBe("unsupported");
  });
});

describe("reponse d'une question — format EXACT attendu par pilot-choices.ts", () => {
  const view = (kind) => ({ kind });

  it("confirmation → {confirmed}, choix → {selected}, saisie → texte brut", () => {
    expect(agentQuestionAnswer(view("confirm"), true)).toEqual({
      cancelled: false,
      value: '{"confirmed":true,"note":""}',
    });
    expect(agentQuestionAnswer(view("confirm"), false).value).toBe('{"confirmed":false,"note":""}');
    expect(agentQuestionAnswer(view("select"), "Approche B").value).toBe(
      '{"selected":"Approche B","note":""}',
    );
    expect(agentQuestionAnswer(view("multi"), ["api", "ui"]).value).toBe(
      '{"selected":["api","ui"],"note":""}',
    );
    expect(agentQuestionAnswer(view("input"), "billing")).toEqual({ cancelled: false, value: "billing" });
  });

  it("annulation → {cancelled:true}, jamais une reponse inventee", () => {
    expect(agentQuestionAnswer(view("select"), null)).toEqual({ cancelled: true, value: undefined });
    expect(agentQuestionAnswer(view("confirm"), undefined).cancelled).toBe(true);
  });

  it("les arguments d'un responder sont NORMALISES (2 ou 3 arguments)", () => {
    // Barre des questions : `responder(id, value, cancelled)`.
    expect(normalizeAgentAnswerArgs("id-1", ["id-1", "v", false])).toEqual({
      id: "id-1",
      value: "v",
      cancelled: false,
    });
    // Reponse directe (demande interne) : `responder(value, cancelled)`.
    expect(normalizeAgentAnswerArgs("id-2", ["v2", true])).toEqual({
      id: "id-2",
      value: "v2",
      cancelled: true,
    });
    // Le cas qui perdait le choix : un troisieme argument truthy non booleen.
    expect(normalizeAgentAnswerArgs("id-3", ["id-3", "v3", false]).cancelled).toBe(false);
  });
});

// ── b. Le bus branche réellement la surface de secours ──────────────────────
describe("question d'un agent, onglet 🧭 FERMÉ — la surface de secours répond", () => {
  it("la question est AFFICHÉE et la réponse revient au même endroit du bus", async () => {
    const vues = [];
    const reponses = [];
    initAgentQuestionFallback({
      ask: async (view) => {
        vues.push(view);
        return "Approche B";
      },
      respond: async (payload) => {
        reponses.push(payload);
      },
    });

    question({
      id: "req-sans-onglet",
      method: "select",
      title: "Quelle approche ?",
      options: ["Approche A", "Approche B"],
    });
    await flush();

    // 1. La question a été peinte (une seule fois), avec ses options.
    expect(vues).toHaveLength(1);
    expect(vues[0].kind).toBe("select");
    expect(vues[0].title).toBe("Quelle approche ?");
    expect(vues[0].options).toEqual(["Approche A", "Approche B"]);

    // 2. La réponse de l'utilisateur est repartie, à la BONNE session agent,
    //    au format qu'attend l'extension de choix.
    expect(reponses).toHaveLength(1);
    expect(reponses[0]).toMatchObject({ projectPath: PROJET, agentId: AGENT, id: "req-sans-onglet", cancelled: false });
    expect(reponses[0].value).toBe('{"selected":"Approche B","note":""}');

    // 3. Aucune attente terminée, aucun arrêt : la question a bien été servie.
    expect(appels("abort_agent_process")).toEqual([]);
    expect(isAgentQuestionClaimed({
      projectPath: PROJET,
      agentId: AGENT,
      payload: { id: "req-sans-onglet" },
    })).toBe(false);
  });

  it("un dialogue impossible REFUSE explicitement l'attente (jamais une attente infinie)", async () => {
    const reponses = [];
    initAgentQuestionFallback({
      ask: async () => {
        throw new Error("dialogue indisponible");
      },
      respond: async (payload) => {
        reponses.push(payload);
      },
    });

    question({ id: "req-dialogue-ko", method: "confirm", title: "Écraser le fichier ?", message: "" });
    await flush();

    // Refus explicite : `cancelled`, jamais une approbation décidée à sa place.
    expect(reponses).toHaveLength(1);
    expect(reponses[0].cancelled).toBe(true);
    expect(JSON.stringify(reponses[0])).not.toContain('"confirmed":true');
  });

  it("une seule surface de secours : un second init ne pose pas un second écouteur", () => {
    initAgentQuestionFallback({ ask: async () => null, respond: async () => {} });
    initAgentQuestionFallback({ ask: async () => null, respond: async () => {} });
    expect(globalThis.window.countFor(AGENT_RELAY_EVENT)).toBe(1);
    uninstallAgentQuestionFallback();
    expect(globalThis.window.countFor(AGENT_RELAY_EVENT)).toBe(0);
  });

  it("le routage par défaut est celui du relais de l'onglet (`respondAgentRelay`)", () => {
    // Même endroit du bus, aucun second mécanisme de réponse : la surface de
    // secours n'invente pas sa propre voie d'envoi.
    const src = read("agent-question-fallback.js");
    expect(src).toContain('import("./super-agent.js")');
    expect(src).toContain("respondAgentRelay(d.projectPath, d.agentId, payload.id, value, cancelled)");
    // La réponse de l'onglet 🧭 passe par la MÊME fonction.
    expect(read("super-agent.js")).toContain("export async function respondAgentRelay(");
  });
});

// ── c. Onglet 🧭 ouvert : un seul porteur ──────────────────────────────────
describe("onglet 🧭 OUVERT — un seul ecouteur traite la question", () => {
  it("la surface de secours ne peint RIEN et n'envoie RIEN (l'onglet a la priorite)", async () => {
    const vues = [];
    const reponsesSecours = [];
    initAgentQuestionFallback({
      ask: async (view) => {
        vues.push(view);
        return "A";
      },
      respond: async (payload) => {
        reponsesSecours.push(payload);
      },
    });
    // Onglet 🧭 : sa surface est enregistrée à l'ouverture de l'onglet, et son
    // écouteur prend la question (même registre, une seule prise en charge).
    setPrimaryAgentQuestionSurface({ surface: "onglet" });
    const prises = [];
    globalThis.window.addEventListener(AGENT_RELAY_EVENT, (ev) => {
      prises.push(claimAgentQuestion(ev.detail, AGENT_QUESTION_SURFACE_TAB));
    });

    question({ id: "req-onglet", method: "select", title: "Quelle approche ?", options: ["A", "B"] });
    await flush();

    // Un seul porteur : l'onglet. Aucun double affichage, aucune double réponse.
    expect(prises).toEqual([true]);
    expect(vues).toEqual([]);
    expect(reponsesSecours).toEqual([]);
    // L'émetteur a bien vu la prise en charge : il ne termine donc pas l'attente.
    expect(appels("abort_agent_process")).toEqual([]);
  });
});

// ── d. Aucune surface : l'attente se TERMINE, tracée et dite ───────────────
describe("question d'un agent SANS aucune surface — l'attente est terminee", () => {
  it("message explicite, trace `question-sans-surface` puis arret effectif", async () => {
    const notifications = [];
    setBusNotifyCallback((d) => notifications.push(d));

    // Aucune surface installée : ni onglet 🧭, ni surface de secours.
    question({ id: "req-sans-surface", method: "select", title: "Quelle approche ?", options: ["A", "B"] });
    await flush();

    // 1. L'utilisateur est informé, en clair, de ce qui s'est passé.
    const message = notifications.map((n) => n && n.message).filter(Boolean).join("\n");
    expect(message).toContain("attend une réponse qui ne peut pas être affichée");
    expect(message).toContain("TERMINÉE");
    expect(notifications.some((n) => n && n.notifyType === "error")).toBe(true);

    // 2. La trace passe par l'entonnoir unique de la règle 3 : motif explicite
    //    écrit AVANT l'arrêt (journal .pilot/agent-stops.log du projet).
    const ecritures = appels("write_file_content");
    expect(ecritures.length).toBeGreaterThan(0);
    expect(String(ecritures[0].path)).toContain("agent-stops.log");
    expect(ecritures[0].content).toContain(`reason=${AGENT_QUESTION_NO_SURFACE_REASON}`);
    expect(ecritures[0].content).toContain(`detected=${AGENT_QUESTION_NO_SURFACE_DETECTED}`);

    // 3. L'attente n'est pas laissée ouverte : l'agent est arrêté, son créneau
    //    libéré. Aucune réponse n'a été inventée.
    const arrets = appels("abort_agent_process");
    expect(arrets).toHaveLength(1);
    expect(arrets[0].agentId).toBe(AGENT);
    expect(appels("send_agent_process_command")).toEqual([]);
  });

  it("le message ne dit jamais que la question a ete repondue", () => {
    const texte = agentQuestionNoSurfaceMessage({ agentId: AGENT, label: "Quelle approche ?" });
    expect(texte).toContain("L'agent « codeur »");
    expect(texte).toContain("Quelle approche ?");
    expect(texte).toContain("Aucune réponse n'a été décidée à votre place");
    expect(texte).toContain("agent-stops.log");
  });

  it("l'echec du dialogue ne laisse pas non plus l'attente ouverte (refus explicite)", async () => {
    const reponses = [];
    // L'échec est DIT (console.error) : on l'écoute au lieu de salir la sortie.
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleAgentQuestionRequest(
      { projectPath: PROJET, agentId: AGENT, payload: { id: "req-ko", method: "input", title: "Nom ?" } },
      async () => {
        throw new Error("pas de dialogue");
      },
      async (p) => reponses.push(p),
    );
    expect(reponses).toHaveLength(1);
    expect(reponses[0].cancelled).toBe(true);
    expect(erreur).toHaveBeenCalled();
    erreur.mockRestore();
  });
});

// ── e. Gardes de source : les branchements ne peuvent pas être oubliés ──────
describe("garde de source — la surface de secours est BRANCHÉE, pas seulement écrite", () => {
  it("main.js installe la surface de secours AVEC l'application (jamais à l'ouverture d'un onglet)", () => {
    const main = read("main.js");
    expect(main).toContain('import { initAgentQuestionFallback } from "./agent-question-fallback.js";');
    expect(main).toContain("initAgentQuestionFallback();");
    // Jamais une exception d'initialisation : la surface est un filet, pas une
    // dépendance du démarrage.
    expect(main).toMatch(/try \{\s*initAgentQuestionFallback\(\);\s*\} catch/);
  });

  it("le bus TERMINE l'attente quand aucune surface n'a pris la question", () => {
    const bus = read("agents-bus.js");
    expect(bus).toContain("if (!prise) await terminateUnanswerableQuestion(agentId, event, ctx);");
    // Règle 3 : motif et détecteur LITTÉRAUX, dans l'instruction de l'entonnoir.
    expect(bus).toContain('reason: "question-sans-surface"');
    expect(bus).toContain('detected: "relais-sans-ecouteur"');
    expect(bus).toContain("stopAgentWithTrace({");
  });

  it("l'onglet 🧭 reste le porteur prioritaire (prise en charge avant tout await)", () => {
    const superAgent = read("super-agent.js");
    expect(superAgent).toContain("if (!claimAgentQuestion(d, AGENT_QUESTION_SURFACE_TAB)) return;");
    expect(superAgent).toContain("setPrimaryAgentQuestionSurface(assistantQuestionSurfaceToken)");
    expect(superAgent).toContain("clearPrimaryAgentQuestionSurface(assistantQuestionSurfaceToken)");
  });

  it("les dialogues réutilisés existent et sont exportés (aucun nouveau dialogue)", () => {
    const agentPi = read("agent-pi.js");
    for (const nom of ["domConfirm", "domSelect", "domPrompt", "domMultiSelect"]) {
      expect(agentPi, `${nom} doit être exporté`).toContain(`export function ${nom}`);
    }
  });
});
