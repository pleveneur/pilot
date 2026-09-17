// Tests unitaires — cause C2 du diagnostic de délégation : un agent
// EXPLICITEMENT demandé mais INTROUVABLE ne doit plus être rabattu en silence
// sur l'identifiant « codeur » puis sur l'agent « default ». Avant le
// correctif, `resolveDelegationTarget` retombait systématiquement sur ces
// replis : la demande partait donc vers le mauvais agent sans que personne ne
// le sache (détour silencieux).
//
// Contrat vérifié : la décision pure de résolution
// (`resolveDelegationTargetDecision`) renvoie une ERREUR EXPLICITE portant
// l'identifiant demandé (`ok:false` + `error`) et AUCUNE cible quand un agent
// est demandé mais introuvable ; le repli (codeur puis défaut) n'est autorisé
// que lorsqu'AUCUN agent n'est demandé.
import { describe, it, expect, vi } from "vitest";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module. On installe donc un `window` minimal AVANT son import.
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

import { resolveDelegationTargetDecision } from "./super-agent.js";

const coder = { id: "codeur", name: "Codeur du projet" };
const fallback = { id: "default", name: "Agent standard" };

describe("resolveDelegationTargetDecision — cause C2 (détour silencieux)", () => {
  it("agent demandé RÉSOLU → c'est lui la cible (aucun repli)", () => {
    const r = resolveDelegationTargetDecision({
      requestedAgentId: "reviewer",
      requested: { id: "reviewer", name: "Reviewer" },
      coder,
      fallback,
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("reviewer");
    expect(r.error).toBeNull();
  });

  it("agent demandé INTROUVABLE → erreur explicite citant l'id, AUCUNE cible", () => {
    const r = resolveDelegationTargetDecision({
      requestedAgentId: "fantome",
      requested: null,
      coder,
      fallback,
    });
    // Discriminant : avant correctif, on obtenait ici {id:"codeur"} (repli muet).
    expect(r.ok).toBe(false);
    expect(r.id).toBeNull();
    expect(r.name).toBeNull();
    expect(r.error).toContain("fantome");
    expect(r.error).toContain("introuvable");
  });

  it("AUCUN agent demandé → repli autorisé sur le codeur du projet", () => {
    const r = resolveDelegationTargetDecision({
      requestedAgentId: null,
      requested: null,
      coder,
      fallback,
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("codeur");
  });

  it("AUCUN agent demandé et pas de codeur → repli sur l'agent par défaut", () => {
    const r = resolveDelegationTargetDecision({
      requestedAgentId: null,
      requested: null,
      coder: null,
      fallback,
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("default");
  });

  it("AUCUN agent demandé et registre vide → littéral `default` (comportement inchangé)", () => {
    const r = resolveDelegationTargetDecision({
      requestedAgentId: null,
      requested: null,
      coder: null,
      fallback: null,
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe("default");
  });
});
