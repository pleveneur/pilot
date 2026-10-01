// Tests unitaires — badges projet des bulles de l'onglet 🧭 Assistant.
//
// DÉFAUT CORRIGÉ : `createSuperAgentBlock` retombait sur le nom du projet
// ACTUELLEMENT SÉLECTIONNÉ dans l'interface (`getSuperActiveProjectName`)
// quand la bulle n'était pas créée par un envoi de l'utilisateur. Une bulle
// hors tour (relais d'une question d'agent, réponse à un compte rendu injecté…)
// pouvait donc afficher un projet SANS RAPPORT avec l'échange → l'utilisateur
// croyait à un travail sur le mauvais projet.
//
// Règle vérifiée ici : la bulle porte les badges explicites fournis par son
// appelant (qui connaît le projet) OU le snapshot du tour en cours ; sinon
// AUCUN badge. Jamais le projet simplement affiché à l'écran.
//
// NB : super-agent.js importe de nombreuses dépendances (Tauri, CodeMirror via
// agent-pi, markdown-it…). On les mocke et on fournit un DOM minimal pour
// pouvoir charger le module et appeler `createSuperAgentBlock` en vitest.
import { describe, it, expect, vi } from "vitest";

// DOM minimal : chaque élément retient ses enfants (on inspecte l'arbre créé).
vi.hoisted(() => {
  const noop = () => {};
  function makeEl(tag) {
    const el = {
      tagName: tag,
      className: "",
      textContent: "",
      innerHTML: "",
      style: {},
      dataset: {},
      children: [],
      appendChild(c) { el.children.push(c); return c; },
      insertBefore(c) { el.children.unshift(c); return c; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      removeEventListener: noop,
      setAttribute: noop,
      getAttribute: () => null,
      remove: noop,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      get firstChild() { return el.children[0] || null; },
    };
    return el;
  }
  globalThis.window = globalThis;
  globalThis._pilotProjectPath = "C:/Travail/AutreProjet";
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: makeEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    body: makeEl("body"),
    documentElement: makeEl("html"),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({ default: vi.fn(() => ({ render: () => "" })) }));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn(), purgeAgentTabView: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(), detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(), detectSemanticLoop: vi.fn(),
  buildToolLoopFingerprint: vi.fn(),
}));
vi.mock("./desktop-notify.js", () => ({ notifySuperAgentDone: vi.fn(), playAssistantSound: vi.fn(), toastInfo: vi.fn() }));
vi.mock("./agents.js", () => ({
  loadAgentRegistry: vi.fn(), upsertAgent: vi.fn(), normalizeAgent: vi.fn(),
  validateAgentId: vi.fn(), classifyAgent: vi.fn(),
}));
vi.mock("./agents-bus.js", () => ({
  runAgentsForAssistant: vi.fn(), runAgentsForAssistantAsync: vi.fn(), setBusNotifyCallback: vi.fn(),
}));
vi.mock("./reservations.js", () => ({ estimateAndReserve: vi.fn() }));
vi.mock("./structured-brief.js", () => ({ applyAssistantBriefEnvelope: vi.fn() }));
vi.mock("./super-agent-schedule.js", () => ({ shouldScheduleTick: vi.fn(), parseScheduleEvery: vi.fn() }));

const { createSuperAgentBlock } = await import("./super-agent.js");

/** Noms des badges rendus dans la bulle (rangée `.agent-project-badges`), ou []. */
function badgeNamesOf(block) {
  const bubble = block.children[0];
  const row = bubble.children.find((c) => c.className === "agent-project-badges");
  if (!row) return [];
  return row.children.map((b) => b.textContent.replace("📁 ", ""));
}

describe("createSuperAgentBlock — badges projet de la bulle", () => {
  it("n'invente AUCUN nom : bulle hors tour sans badge explicite → aucun badge", () => {
    // Le projet affiché dans l'interface est « AutreProjet » : il ne doit PAS
    // apparaître (ancien comportement = bulle badgée « AutreProjet », donc un
    // nom faux pour un échange qui ne le concernait pas).
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl);
    expect(badgeNamesOf(block)).toEqual([]);
  });

  it("badges explicites (relais d'une question d'agent) → projet de CET agent", () => {
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl, ["PLh"]);
    expect(badgeNamesOf(block)).toEqual(["PLh"]);
    // Le projet affiché à l'écran n'est jamais utilisé à la place.
    expect(badgeNamesOf(block)).not.toContain("AutreProjet");
  });

  it("liste explicite vide → aucun badge (pas de repli sur le projet affiché)", () => {
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl, []);
    expect(badgeNamesOf(block)).toEqual([]);
  });
});
