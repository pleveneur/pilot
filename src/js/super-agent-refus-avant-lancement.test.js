// RÈGLE 1 (audit indépendant « verrous règles 1-4-2 ») — le refus d'un agent
// INCONNU arrête la mission AVANT tout lancement.
//
// Défaut visé : `unknownAgentsError(...)` était bien émis (refus explicite
// testé), mais le `return;` qui suit pouvait disparaître sans qu'AUCUN test ne
// s'en aperçoive — l'erreur s'affichait ET la mission partait quand même (sur
// des agents que l'utilisateur n'avait pas demandés). Le contrat n'était
// verrouillé que sur le TEXTE de l'erreur (`agent-demande-exact.test.js`).
//
// Preuve apportée ici, sans dupliquer la production : le garde est EXTRAIT de
// `super-agent.js` tel qu'il est écrit, puis EXÉCUTÉ avec un double de
// `respondSuperAgent` (l'IPC de réponse à l'outil) suivi d'un LANCEMENT
// SENTINELLE. Le test exige que l'erreur soit émise ET que le lancement
// sentinelle ne soit JAMAIS atteint. Si le `return;` est retiré de la
// production, le sentinelle s'exécute et le test échoue.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module (état de l'onglet, callbacks du bus). On installe donc un `window`
// minimal AVANT son import (vi.hoisted s'exécute avant les imports), comme dans
// `agent-demande-exact.test.js` / `super-agent-launch-verdict.test.js`.
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

import { unknownAgentsError } from "./super-agent.js";

// Lecture du source en neutralisant les fins de ligne (worktree CRLF en CI
// Windows : cf. AGENTS.md § Fins de ligne).
const SRC = readFileSync(new URL("./super-agent.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const GUARD_MARKER = "if (missing.length > 0) {";
const REGISTRY = { agents: [{ id: "codeur" }, { id: "plan-maker" }] };

/** Fin (index de la `}`) du bloc ouvert à `openIdx`, par comptage d'accolades. */
function matchingBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extrait TOUS les gardes « agent inconnu » présents dans la source, avec leur
 * position — il y a un garde par point d'entrée (run_agents, run_assistant_agents).
 * @returns {{block: string, start: number, end: number}[]}
 */
function guardBlocks(src) {
  const out = [];
  let idx = src.indexOf(GUARD_MARKER);
  while (idx >= 0) {
    const open = src.indexOf("{", idx);
    const close = matchingBrace(src, open);
    if (close < 0) break;
    out.push({ block: src.slice(idx, close + 1), start: idx, end: close });
    idx = src.indexOf(GUARD_MARKER, close);
  }
  return out;
}

/**
 * Exécute le garde EXTRAIT de la production, puis un lancement sentinelle.
 * Les identifiants libres du garde (`id`, `missing`, `registry`,
 * `respondSuperAgent`, `unknownAgentsError`) sont passés en paramètres ;
 * `launch` n'existe PAS dans la production : il matérialise « la suite de la
 * branche » (le lancement de la mission) pour prouver que le `return` l'empêche.
 */
async function runGuard(block, { missing }) {
  const responded = [];
  const launched = [];
  const respondSuperAgent = async (id, payload, isError) => {
    responded.push({ id, payload: String(payload), isError });
  };
  const fn = new AsyncFunction(
    "id",
    "missing",
    "registry",
    "respondSuperAgent",
    "unknownAgentsError",
    "launch",
    `${block}\n  launch("lancement de la mission");`,
  );
  await fn("req-1", missing, REGISTRY, respondSuperAgent, unknownAgentsError, (what) => launched.push(what));
  return { responded, launched };
}

const blocks = guardBlocks(SRC);

describe("règle 1 — un agent inconnu est refusé ET la mission ne part pas", () => {
  it("les DEUX points d'entrée (run_agents, run_assistant_agents) portent le garde", () => {
    expect(blocks, "un point d'entrée de lancement a perdu son garde d'agent inconnu").toHaveLength(2);
  });

  for (const [i, { block }] of blocks.entries()) {
    it(`garde ${i + 1} : l'erreur est émise puis la branche RETOURNE (aucun lancement)`, async () => {
      const { responded, launched } = await runGuard(block, { missing: ["agent-fantome"] });
      // 1. Le refus est explicite et nomme l'agent inconnu (comportement déjà couvert ailleurs).
      expect(responded).toHaveLength(1);
      expect(responded[0].payload).toContain("agent-fantome");
      expect(responded[0].isError).toBe(false);
      // 2. Et RIEN de ce qui suit le garde ne s'exécute : pas de lancement.
      expect(launched, "le refus doit interrompre la branche AVANT tout lancement").toEqual([]);
    });

    it(`garde ${i + 1} : le retour est bien la DERNIÈRE instruction du garde`, () => {
      // Vérification textuelle complémentaire : sans le `return;` final, le garde
      // n'interrompt plus rien (l'exécution ci-dessus le prouve, ceci le documente).
      expect(block.replace(/\s+/g, " ")).toMatch(/respondSuperAgent\([^;]*; return; \}$/);
    });
  }

  it("témoin : sans agent inconnu, le garde est INERTE et le lancement a bien lieu", async () => {
    // Contre-preuve indispensable : elle prouve que le harnais atteint réellement
    // le sentinelle. Sans elle, un garde vide ferait passer les tests ci-dessus.
    for (const { block } of blocks) {
      const { responded, launched } = await runGuard(block, { missing: [] });
      expect(responded).toEqual([]);
      expect(launched).toEqual(["lancement de la mission"]);
    }
  });

  it("chaque garde est placé AVANT le code de lancement de sa branche", () => {
    // Position dans la branche, pas seulement présence : un garde déplacé après
    // l'appel de lancement laisserait partir la mission avant de refuser.
    const branches = [
      {
        name: "run_agents",
        start: "if (title.startsWith(RUN_AGENTS_SENTINEL)) {",
        end: "if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {",
        launch: "const launchMission = () => launchOrQueue();",
      },
      {
        name: "run_assistant_agents",
        start: "if (title.startsWith(RUN_ASSISTANT_AGENTS_SENTINEL)) {",
        end: "if (title.startsWith(SESSIONS_SENTINEL)) {",
        launch: "const startRun = async () => {",
      },
    ];

    for (const branch of branches) {
      const from = SRC.indexOf(branch.start);
      const to = SRC.indexOf(branch.end, from);
      expect(from, `branche ${branch.name} introuvable`).toBeGreaterThan(-1);
      expect(to, `fin de la branche ${branch.name} introuvable`).toBeGreaterThan(from);

      const guard = blocks.find((b) => b.start > from && b.end < to);
      expect(guard, `la branche ${branch.name} n'a plus son garde d'agent inconnu`).toBeTruthy();

      const launchIdx = SRC.indexOf(branch.launch, from);
      expect(launchIdx, `lancement de la branche ${branch.name} introuvable`).toBeGreaterThan(from);
      expect(
        guard.start,
        `le garde de ${branch.name} doit précéder son code de lancement`,
      ).toBeLessThan(launchIdx);
    }
  });

  it("le libellé de l'erreur liste les agents disponibles (refus actionnable)", () => {
    // Le garde n'est utile que s'il dit quoi faire à la place de l'agent inconnu.
    const msg = unknownAgentsError(["agent-fantome"], REGISTRY);
    expect(msg).toContain("agent-fantome");
    expect(msg).toContain("codeur");
    expect(msg).toContain("plan-maker");
  });
});
