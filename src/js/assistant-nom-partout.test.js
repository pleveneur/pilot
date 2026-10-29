// Tests — LE NOM DU PERSONNAGE ACTIF S'APPLIQUE PARTOUT (Présences)
//
// Défaut corrigé ici : le personnage était bien lu et bien affiché dans le
// titre de l'onglet 🧭, mais la LISTE DES AGENTS (cercle en haut à droite)
// gardait le nom de la session côté moteur — c'est-à-dire le nom RÉGLÉ
// (« Nova »). Le personnage avait un nom et un portrait, et Pilot continuait
// d'afficher l'ancien nom à côté.
//
// Ce fichier verrouille le comportement RÉEL :
//   1. la liste des agents suit la SEULE règle de priorité
//      (personnage actif → nom réglé → « Assistant »), sans la recopier ;
//   2. sans personnage, rien ne change (nom réglé, comme aujourd'hui) ;
//   3. la lecture (`nom.txt` = « Sylvie », simulée par la réponse Rust)
//      alimente la liste, sans redémarrage ;
//   4. l'identité d'un agent (identifiant) n'est jamais remplacée par un nom ;
//   5. la sonde de supervision retrouve la session de l'assistant, enregistrée
//      sous le nom RÉGLÉ, même quand le personnage affiche un autre nom ;
//   6. les deux surfaces qui relisent le personnage sur le MÊME événement ne
//      lisent le disque qu'une fois (le portrait pèse plusieurs Mo).
//
// Aucun navigateur : `super-agent.js` et `agent-activity.js` sont des modules
// d'interface, un `window` / `document` minimal est installé AVANT leur
// évaluation (même procédé que `assistant-nom-du-personnage.test.js`). La
// commande Rust est simulée : aucun test ne touche le vrai dossier
// `.pilot/portrait`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const { invokeState } = vi.hoisted(() => {
  const noop = () => {};
  const el = () => ({
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    remove: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    dataset: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: noop,
    getAttribute: () => null,
    focus: noop,
    scrollIntoView: noop,
    insertAdjacentHTML: noop,
    innerHTML: "",
    textContent: "",
    value: "",
    src: "",
  });
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: el,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: el(),
    documentElement: el(),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  return { invokeState: { impl: async () => ({}) } };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd) => invokeState.impl(cmd) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { flattenAgents } from "./agent-activity.js";
import {
  DEFAULT_ASSISTANT_NAME,
  personaDisplayName,
  refreshAssistantPersona,
  resetAssistantPersona,
  setAssistantPersona,
} from "./assistant-persona.js";
import { findAssistantSessionAgent } from "./super-agent.js";

/** Supervision telle que la rend `get_agent_supervision` (dashboard.rs). */
function supervision({ assistantLabel = "Nova", withCodeur = false } = {}) {
  const projects = [
    {
      path: "",
      name: "",
      agents: [{ agent: assistantLabel, state: "idle", alive: true, visible: true }],
    },
  ];
  if (withCodeur) {
    projects.push({
      path: "C:/proj/pilot",
      name: "pilot",
      agents: [{ agent: "default", state: "running", alive: true, visible: true }],
    });
  }
  return { projects };
}

beforeEach(() => {
  resetAssistantPersona();
  invokeState.impl = async () => ({});
});

afterEach(() => {
  resetAssistantPersona();
});

describe("nom du personnage : la liste des agents (haut droite)", () => {
  it("avec « Sylvie » sur le disque, c'est Sylvie qui s'affiche — pas le nom réglé", () => {
    setAssistantPersona({ name: "Sylvie", portrait: null });

    const list = flattenAgents(supervision({ assistantLabel: "Nova" }));

    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("Sylvie");
    // L'IDENTITÉ ne change pas : c'est elle qui alimente les actions.
    expect(list[0].agentId).toBe("superagent");
    expect(list[0].rawId).toBe("superagent");
    expect(list[0].kind).toBe("superagent");
  });

  it("sans personnage, rien ne change : le nom réglé reste affiché", () => {
    const list = flattenAgents(supervision({ assistantLabel: "Nova" }));
    expect(list[0].label).toBe("Nova");
  });

  it("le nom d'un agent de projet n'est JAMAIS remplacé par celui du personnage", () => {
    setAssistantPersona({ name: "Sylvie", portrait: null });

    const list = flattenAgents(supervision({ assistantLabel: "Nova", withCodeur: true }));
    const codeur = list.find((a) => a.kind === "agent");

    expect(codeur.label).toBe("default");
    expect(codeur.agentId).toBe("default|C:/proj/pilot");
    expect(list.find((a) => a.kind === "superagent").label).toBe("Sylvie");
  });

  it("la lecture du fichier alimente la liste, et sa disparition la ramène au nom réglé", async () => {
    // `nom.txt` présent (réponse de la commande Rust) : « Sylvie ».
    invokeState.impl = async (cmd) => {
      expect(cmd).toBe("read_assistant_persona");
      return { name: "Sylvie", portrait: null };
    };
    await refreshAssistantPersona();
    expect(flattenAgents(supervision({ assistantLabel: "Nova" }))[0].label).toBe("Sylvie");

    // Le fichier disparaît : aucune exception, retour au nom réglé.
    invokeState.impl = async () => ({});
    await refreshAssistantPersona();
    expect(flattenAgents(supervision({ assistantLabel: "Nova" }))[0].label).toBe("Nova");
  });

  it("les deux surfaces ne lisent le disque qu'une fois sur le même événement", async () => {
    let appels = 0;
    invokeState.impl = async () => {
      appels += 1;
      await new Promise((r) => setTimeout(r, 0));
      return { name: "Sylvie", portrait: null };
    };

    const [a, b] = await Promise.all([refreshAssistantPersona(), refreshAssistantPersona()]);

    expect(appels).toBe(1);
    expect(a.name).toBe("Sylvie");
    expect(b.name).toBe("Sylvie");
  });
});

describe("sonde de supervision : la session reste trouvée sous le nom réglé", () => {
  it("le personnage affiché ne fait pas perdre la session enregistrée sous le nom réglé", () => {
    const sessions = [
      { agent: "Nova", alive: true, state: "idle" },
      { agent: "Magnus", alive: false, state: "stopped" },
    ];

    // Nom affiché « Sylvie » (personnage) + nom réglé « Nova » : on trouve la
    // session réelle, vivante — sinon l'assistant serait dit « Déconnecté ».
    expect(findAssistantSessionAgent(sessions, "Sylvie", "Nova")).toEqual({
      agent: "Nova",
      alive: true,
      state: "idle",
    });
    // Le libellé exact reste prioritaire quand il est le bon.
    expect(findAssistantSessionAgent(sessions, "Nova", "Nova").agent).toBe("Nova");
    // Repli historique conservé.
    expect(findAssistantSessionAgent(sessions, "Inconnu", "Autre").agent).toBe("Magnus");
  });
});

describe("règle unique : aucune copie de la priorité dans la liste", () => {
  it("agent-activity.js applique personaDisplayName (la règle de assistant-persona.js)", () => {
    const src = readFileSync(new URL("./agent-activity.js", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n",
    );

    expect(src).toContain(
      'import { getAssistantPersonaName, personaDisplayName } from "./assistant-persona.js";',
    );
    // Le libellé de l'assistant passe par la règle unique...
    expect(src).toContain("personaDisplayName(getAssistantPersonaName(), a.name || a.agent || \"\")");
    // ... et aucune seconde priorité n'est réécrite ici : l'ancien libellé
    // (nom de session brut) ne doit pas revenir par la bande.
    expect(src).not.toContain('const label = a.name || a.agent || "";');
    // La fonction pure reste conforme au contrat.
    expect(personaDisplayName("Sylvie", "Nova")).toBe("Sylvie");
    expect(personaDisplayName("", "Nova")).toBe("Nova");
    expect(personaDisplayName("", "")).toBe(DEFAULT_ASSISTANT_NAME);
  });
});
