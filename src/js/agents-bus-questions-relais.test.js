// Tests — QUESTIONS D'UN AGENT LANCE PAR L'ASSISTANT : elles REMONTENT a
// l'utilisateur, elles ne sont plus repondues a sa place.
//
// Defaut protege (relecture independante) : `agents-bus.js` repondait lui-meme
// aux `extension_ui_request` des agents lances en arriere-plan
// (`confirm` -> `confirmed: true`, `select` -> `options[0]`, `input` ->
// `cancelled: true`). La question n'etait donc JAMAIS visible : personne ne
// pouvait y repondre, et une decision (approbation d'ecriture, choix
// d'approche) etait prise a la place de l'utilisateur.
//
// Regle protegee (proprietaire, 2026-10-16) : un agent PEUT poser une question ;
// elle doit remonter a l'assistant, qui la transmet a l'utilisateur. Aucune
// reponse de repli n'est inventee ; sans reponse, la demande reste en attente
// (la limite de 45 min cote Rust empeche le gel de la file).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import { beginRun, handleAgentEvent } from "./agents-bus.js";
import { AGENT_RELAY_EVENT } from "./agent-choice-relay.js";

const here = dirname(fileURLToPath(import.meta.url));
// Neutralite CRLF (quality-gate § 3.4) : un worktree Windows ne doit pas faire
// echouer une lecture d'ancre.
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");

const PROJET = "projetQuestions";
const AGENT = "codeur";

/** Evenements de relais reellement emis sur `window`. */
let relais;

beforeEach(() => {
  relais = [];
  // Aucun drapeau d'onglet : `_pilotSuperAgentOpen` et `_pilotTabs` restent
  // ABSENTS, ce qui prouve qu'aucune condition « onglet assistant actif » n'est
  // exigee pour relayer la question d'un agent de l'assistant.
  globalThis.window = {
    dispatchEvent: (ev) => {
      relais.push(ev);
      return true;
    },
  };
  vi.mocked(invoke).mockClear();
  const ctx = beginRun(PROJET);
  ctx.activeAgents.add(AGENT);
  ctx.agentProject[AGENT] = PROJET;
});

afterEach(() => {
  delete globalThis.window;
});

/** Emet un `extension_ui_request` d'un agent de la run en cours. */
const question = (event) =>
  handleAgentEvent({
    payload: { project: PROJET, agent_id: AGENT, event: { type: "extension_ui_request", ...event } },
  });

/** Commandes RPC reellement envoyees a l'agent (reponses `extension_ui_response`). */
const reponsesEnvoyees = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "send_agent_process_command")
    .map(([, args]) => args)
    .filter((args) => args && args.command && args.command.type === "extension_ui_response");

describe("question d'un agent de l'assistant — aucune reponse decidee a la place de l'utilisateur", () => {
  it("une confirmation (`confirm`) n'est plus approuvee automatiquement", () => {
    question({ id: "req-confirm-1", method: "confirm", title: "Écraser le fichier ?", message: "Le fichier existe déjà." });
    const envoyees = reponsesEnvoyees();
    expect(envoyees).toEqual([]);
    // Le champ `confirmed` (approbation implicite) ne doit apparaître nulle part.
    expect(JSON.stringify(envoyees)).not.toContain("confirmed");
  });

  it("un choix (`select`) n'est plus tranche automatiquement sur la premiere option", () => {
    question({
      id: "req-select-1",
      method: "select",
      title: "Quelle approche ?",
      options: ["Approche A", "Approche B"],
    });
    const envoyees = reponsesEnvoyees();
    expect(envoyees).toEqual([]);
    expect(JSON.stringify(envoyees)).not.toContain("Approche A");
  });

  it("une saisie (`input`) n'est plus annulee automatiquement (`cancelled`)", () => {
    question({ id: "req-input-1", method: "input", title: "Nom du module ?", placeholder: "ex: billing" });
    const envoyees = reponsesEnvoyees();
    expect(envoyees).toEqual([]);
    expect(JSON.stringify(envoyees)).not.toContain("cancelled");
  });

  it("l'attente d'une reponse ne produit AUCUNE reponse differee (pas de minuterie de repli)", async () => {
    question({ id: "req-confirm-2", method: "confirm", title: "Continuer ?", message: "" });
    await new Promise((r) => setTimeout(r, 20));
    expect(reponsesEnvoyees()).toEqual([]);
  });
});

describe("question d'un agent de l'assistant — elle REMONTE par le relais existant", () => {
  it("l'evenement de relais de l'assistant part reellement, avec le payload, l'agent et le projet", () => {
    question({ id: "req-select-2", method: "select", title: "Quelle approche ?", options: ["A", "B"] });
    const evenements = relais.filter((ev) => ev && ev.type === AGENT_RELAY_EVENT);
    expect(evenements).toHaveLength(1);
    const detail = evenements[0].detail;
    // Meme contrat que le chemin de l'onglet chat (agent-pi.js) : la reponse de
    // l'utilisateur pourra etre routee vers LA bonne session agent.
    expect(detail).toMatchObject({ agentId: AGENT, projectPath: PROJET });
    expect(detail.payload).toMatchObject({ id: "req-select-2", method: "select", options: ["A", "B"] });
  });

  it("le relais ne depend NI de l'onglet 🧭 ouvert NI de l'onglet actif (agent en arriere-plan)", () => {
    // Aucun de ces drapeaux n'existe dans cet environnement : si le bus exigeait
    // « onglet assistant ouvert/actif », la question ne remonterait jamais.
    expect(globalThis.window._pilotSuperAgentOpen).toBeUndefined();
    expect(globalThis.window._pilotTabs).toBeUndefined();
    question({ id: "req-confirm-3", method: "confirm", title: "Confirmer ?", message: "" });
    expect(relais.filter((ev) => ev && ev.type === AGENT_RELAY_EVENT)).toHaveLength(1);
  });

  it("la question est aussi SIGNALEE quand la conversation de l'assistant n'est pas ouverte", () => {
    let notifie = null;
    // Le callback de notification du bus alimente la conversation de l'assistant
    // (T5) : il doit porter la question, sans jamais y repondre.
    const ctxRun = beginRun(PROJET);
    ctxRun.activeAgents.add(AGENT);
    ctxRun.agentProject[AGENT] = PROJET;
    // (re)pose le callback via le chemin public du bus
    return import("./agents-bus.js").then(({ setBusNotifyCallback }) => {
      setBusNotifyCallback((d) => {
        if (d && typeof d.message === "string" && d.message.includes("attend votre réponse")) notifie = d;
      });
      question({ id: "req-input-2", method: "input", title: "Quel nom ?" });
      expect(notifie).toBeTruthy();
      expect(notifie.message).toContain(AGENT);
      expect(reponsesEnvoyees()).toEqual([]);
    });
  });

  it("une porte interne (controle de l'ecran) n'est NI relayee NI approuvee", () => {
    question({
      id: "req-screen-1",
      method: "confirm",
      title: "PILOT_SCREEN_GATE::action",
      message: "PILOT_SCREEN_GATE::{\"tool\":\"screen_click\"}",
    });
    expect(relais.filter((ev) => ev && ev.type === AGENT_RELAY_EVENT)).toHaveLength(0);
    expect(reponsesEnvoyees()).toEqual([]);
  });
});

describe("garde de source — les reponses automatiques ne reviennent pas dans le bus", () => {
  it("agents-bus.js ne contient plus aucune reponse decidee sans utilisateur", () => {
    const src = read("agents-bus.js");
    expect(src).not.toContain("confirmed: true, cancelled: false");
    expect(src).not.toContain("value: options[0]");
    expect(src).not.toMatch(/extension_ui_response[^\n]*cancelled: true/);
    // ... et le relais utilise bien la source unique de l'evenement.
    expect(src).toContain("AGENT_RELAY_EVENT");
    expect(src).toContain("relayAgentQuestion(agentId, event, ctx);");
  });
});
