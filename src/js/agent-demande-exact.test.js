// MISSION 381 — « l'agent lancé doit être exactement l'agent demandé ».
//
// Défaut corrigé : chaque lancement d'agent par l'assistant déclenchait une
// ESTIMATION PRÉALABLE (« devis ») qui remettait tout le texte de la mission à
// un planificateur en lecture seule (`plan-maker`). Cette session démarrait,
// prenait le créneau de run du projet et la mission réellement demandée ne
// démarrait jamais.
//
// Contrats vérifiés ici, au niveau où ils sont décidés :
//   (a) le chemin de lancement ne contient plus AUCUNE étape d'estimation ni
//       aucun agent auxiliaire ;
//   (b) `reservations.js` ne lance plus aucun agent et ne reçoit plus le texte
//       d'une mission (il ne manipule que des CHEMINS) ;
//   (c) un identifiant inconnu est REFUSÉ explicitement, avec la liste des
//       agents disponibles — jamais de routage silencieux ;
//   (d) l'accusé de lancement ne peut plus annoncer un succès sans démarrage
//       réel ni mise en file.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module (état de l'onglet, callbacks du bus). On installe donc un `window`
// minimal AVANT son import (vi.hoisted s'exécute avant les imports), comme dans
// `super-agent-launch-verdict.test.js`.
vi.hoisted(() => {
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
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { computeRunLaunchVerdict, resolveDelegationTargetDecision, unknownAgentsError } from "./super-agent.js";
import * as reservations from "./reservations.js";

// Lecture d'un source en neutralisant les fins de ligne (worktree CRLF en CI
// Windows : cf. AGENTS.md § Fins de ligne).
const source = (rel) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("(a) le chemin de lancement de l'assistant ne contient plus d'estimation préalable", () => {
  const superAgent = source("src/js/super-agent.js");

  it("n'appelle plus l'estimation préalable et ne lance plus d'agent auxiliaire", () => {
    expect(superAgent).not.toContain("estimateAndReserve");
    expect(superAgent).not.toContain("plan-maker");
    expect(superAgent).not.toContain("reportDeferredLaunch");
  });

  it("ne fabrique plus d'accusé « en préparation » : le lancement rend le verdict réel", () => {
    // Aucune branche ne peut répondre à l'outil avant le démarrage réel (ou la
    // mise en file) : plus de `preparing: true` construit par le lanceur.
    expect(superAgent).not.toContain("preparing: true");
  });

  it("lance la mission directement (aucun enchaînement « estimation puis lancement »)", () => {
    // Le lanceur transmet ses options (P1 : `dequeue` marque le lancement issu du
    // rejeu de la file, cf. `decideMissionAdmission`).
    expect(superAgent).toContain("const launchMission = (missionLaunchOpts) => launchOrQueue(missionLaunchOpts);");
    // CONTRAT MODIFIÉ (fermeture des faux verrous 2-3-4) : la mise en file passe
    // par l'unique fonction de production ; c'est ELLE qui reçoit le lanceur.
    expect(superAgent).toContain("enqueueMissionForProject(target, launchMission, task, missionIdentity)");
  });
});

describe("(b) reservations.js ne lance plus d'agent et ne reçoit plus le texte d'une mission", () => {
  it("n'exporte plus de fonction d'estimation", () => {
    expect(reservations.estimateAndReserve).toBeUndefined();
    expect(typeof reservations.writeReservations).toBe("function");
    expect(typeof reservations.deleteReservations).toBe("function");
  });

  it("ne peut pas démarrer ni arrêter une session d'agent", () => {
    const src = source("src/js/reservations.js");
    // Aucun lancement d'agent, aucun arrêt ciblé, aucun accès au bus d'agents :
    // le module ne manipule que des CHEMINS réservés.
    expect(src).not.toContain("runAgentsForAssistant");
    expect(src).not.toContain("stop_agent_process");
    expect(src).not.toContain("send_agent_process_prompt");
    expect(src).not.toContain("start_agent_process");
  });
});

describe("(c) agent inconnu : refus explicite, liste des agents disponibles, aucun lancement", () => {
  it("le message nomme les identifiants inconnus et les agents disponibles", () => {
    const msg = unknownAgentsError(["agent-qui-nexiste-pas"], {
      agents: [{ id: "default" }, { id: "codeur" }, { id: "reviewer" }],
    });
    expect(msg).toContain("agent-qui-nexiste-pas");
    expect(msg).toContain("Aucun agent n'a été lancé");
    expect(msg).toContain("default, codeur, reviewer");
    // Aucune suggestion de remplacement : le message ne propose jamais un autre
    // agent à la place de celui demandé.
    expect(msg).not.toMatch(/à la place|utiliser plutôt|je lance sur/i);
  });

  it("registre vide : le refus reste explicite (« aucun »)", () => {
    const msg = unknownAgentsError(["x"], { agents: [] });
    expect(msg).toContain("Agents disponibles : aucun");
  });

  it("les deux points d'entrée (run_agents, run_assistant_agents) utilisent ce refus", () => {
    const src = source("src/js/super-agent.js");
    const calls = src.match(/await respondSuperAgent\(id, JSON\.stringify\(\{ error: unknownAgentsError\(missing, registry\) \}\)/g) || [];
    expect(calls).toHaveLength(2);
    // L'ancien message nu (sans liste d'agents disponibles) a disparu.
    expect(src).not.toContain('`Agents inconnus : ${missing.join(", ")}.`');
  });

  it("la délégation refuse toujours un agent absent ou introuvable (aucun repli)", () => {
    expect(resolveDelegationTargetDecision({ requestedAgentId: null, requested: null }).ok).toBe(false);
    const unknown = resolveDelegationTargetDecision({ requestedAgentId: "fantome", requested: null });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("fantome");
    const ok = resolveDelegationTargetDecision({ requestedAgentId: "codeur", requested: { id: "codeur", name: "Codeur" } });
    expect(ok).toEqual({ ok: true, id: "codeur", name: "Codeur", error: null });
  });
});

describe("(d) accusé de lancement : jamais de succès sans démarrage réel ni mise en file", () => {
  it("refus explicite → ok:false avec la raison", () => {
    const v = computeRunLaunchVerdict({ started: false, queued: false, error: "Aucun modèle pour l'agent « X »" });
    expect(v.ok).toBe(false);
    expect(v.launched).toBe(false);
    expect(v.queued).toBe(false);
    expect(v.error).toContain("Aucun modèle");
  });

  it("démarrage réel ou mise en file → ok:true", () => {
    expect(computeRunLaunchVerdict({ started: true, queued: false }).ok).toBe(true);
    expect(computeRunLaunchVerdict({ started: false, queued: true }).ok).toBe(true);
  });
});
