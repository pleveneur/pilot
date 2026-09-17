// Tests unitaires — accusé de lancement de mission (issue #87, première moitié).
//
// Défaut visé : quand l'assistant lançait une mission (outil `run_agents`) alors
// qu'une run était DÉJÀ en cours sur le projet, il renvoyait à l'utilisateur un
// accusé incohérent `{"ok":true,"launched":false,"queued":false,"preparing":
// false,"error":null}` — soit la demande était réellement mise en file (l'accusé
// mentait), soit elle était perdue sans aucune raison. Cause racine :
//  - la branche « mise en file » de `startRun` renvoyait le booléen `true` alors
//    que `computeRunLaunchVerdict` lit des CHAMPS sur un objet → tous falsy ;
//  - `computeRunLaunchVerdict` renvoyait `ok: true` en dur, sans jamais signaler
//    une demande abandonnée (aucun démarrage, aucune mise en file, aucune
//    préparation) — un refus silencieux s'affichait donc « ok ».
//
// Contrat vérifié ici : l'accusé ne dit « ok » que si la demande a réellement
// démarré, a été mise en file d'attente ou est en cours de préparation ; dans
// tous les autres cas, une raison explicite est fournie.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module (état de l'onglet, callbacks du bus). On installe donc un `window`
// minimal AVANT son import (vi.hoisted s'exécute avant les imports).
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
  globalThis.localStorage = {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
});

// Dépendances navigateur/Tauri neutralisées : seules les fonctions pures du
// module sont exercées (aucun accès DOM/Tauri à l'import).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { computeRunLaunchVerdict } from "./super-agent.js";

describe("computeRunLaunchVerdict — accusé de lancement honnête (issue #87)", () => {
  it("lancement réel → ok, launched=true", () => {
    expect(computeRunLaunchVerdict({ started: true, queued: false, preparing: false, error: null })).toEqual({
      ok: true,
      launched: true,
      queued: false,
      preparing: false,
      error: null,
    });
  });

  it("mise en file d'attente (pending) → ok, queued=true et launched=false (jamais « lancé »)", () => {
    expect(computeRunLaunchVerdict({ queued: true, started: false, preparing: false, error: null })).toEqual({
      ok: true,
      launched: false,
      queued: true,
      preparing: false,
      error: null,
    });
  });

  it("préparation en arrière-plan (estimation plan-maker) → ok, preparing=true", () => {
    const v = computeRunLaunchVerdict({ queued: false, started: false, preparing: true, error: null });
    expect(v.ok).toBe(true);
    expect(v.preparing).toBe(true);
    expect(v.launched).toBe(false);
  });

  it("refus explicite → ok=false (jamais de faux succès) et raison conservée", () => {
    const v = computeRunLaunchVerdict({ started: false, queued: false, preparing: false, error: "Une run est déjà en cours sur ce projet." });
    expect(v.ok).toBe(false);
    expect(v.error).toContain("run est déjà en cours");
  });

  it("demande ABANDONNÉE (rien ne s'est passé, aucune raison rapportée) → ok=false + raison forcée", () => {
    // C'est exactement le cas du bug : tous les champs sont falsy (un booléen a
    // été renvoyé au lieu d'un objet) → l'accusé ne doit PAS dire « ok ».
    const v = computeRunLaunchVerdict(true);
    expect(v.ok).toBe(false);
    expect(v.launched).toBe(false);
    expect(v.queued).toBe(false);
    expect(v.preparing).toBe(false);
    expect(typeof v.error).toBe("string");
    expect(v.error.length).toBeGreaterThan(0);
  });

  it("résultat absent / indéfini → ok=false avec raison (jamais « ok » vide)", () => {
    for (const input of [undefined, null, {}, false, 0, ""]) {
      const v = computeRunLaunchVerdict(input);
      expect(v.ok).toBe(false);
      expect(v.error).toBeTruthy();
    }
  });

  it("la branche « mise en file » de startRun renvoie un accusé STRUCTURÉ, plus le booléen true", () => {
    // Garde anti-régression sur la cause racine : renvoyer `true` produisait
    // l'accusé mensonger {ok:true, launched:false, queued:false, preparing:false,
    // error:null} pour une demande pourtant bien mise en file.
    const src = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8");
    const marker = "runAgentsQueueByProject[target].push({ launch: launchWithEstimate });";
    const structured = "return { queued: true, started: false, preparing: false, error: null };";
    const iMarker = src.indexOf(marker);
    expect(iMarker).toBeGreaterThan(-1);
    // Le retour structuré suit immédiatement la mise en file…
    expect(src.indexOf(structured)).toBeGreaterThan(iMarker);
    // … et la branche ne renvoie plus le booléen `true` (fenêtre réduite à ce
    // bloc : la même faute de style existe légitimement ailleurs, dans la
    // branche run_assistant_agents dont le contrat est booléen).
    expect(src.slice(iMarker, iMarker + 700)).not.toContain("return true;");
  });
});
