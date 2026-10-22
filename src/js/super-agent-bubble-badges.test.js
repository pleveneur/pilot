// Tests unitaires — badges projet des bulles de l'onglet 🧭 Assistant.
//
// REGLE DE NOMMAGE (decision proprietaire 2026-10-22) verifiee ici : une bulle
// qui concerne un projet porte son nom. Priorite : (1) badges explicites de
// l'appelant, (2) projets nommes dans le texte du tour, (3) projet(s)
// reellement concerne(s), (4) DERNIER RECOURS : projet ouvert au moment de la
// creation de la bulle (snapshot fige, jamais recalcule). Aucun projet connu ni
// ouvert → AUCUN badge (jamais de nom invente).
//
// ANCIENNE REGLE (remplacee) : aucune etiquette si le texte ne nommait aucun
// projet — le proprietaire ne voyait plus aucun nom de projet sur les bulles.
// La surete est conservee : un projet vise par l'echange (regle 3) n'est jamais
// remplace par le projet simplement affiche a l'ecran (voir le controle (c)
// dans super-agent-badges-nom-projet.test.js).
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
  it("dernier recours : projet ouvert fige a la creation de la bulle", () => {
    // Aucun badge explicite, aucun projet nomme, aucun projet concerne : la
    // bulle porte le projet OUVERT au moment de sa creation (regle 4).
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl);
    expect(badgeNamesOf(block)).toEqual(["AutreProjet"]);
  });

  it("badges explicites (relais d'une question d'agent) → projet de CET agent", () => {
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl, ["PLh"]);
    expect(badgeNamesOf(block)).toEqual(["PLh"]);
    // Le projet affiché à l'écran n'est jamais utilisé à la place.
    expect(badgeNamesOf(block)).not.toContain("AutreProjet");
  });

  it("badges explicites vides → dernier recours (projet ouvert au moment de la creation)", () => {
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl, []);
    expect(badgeNamesOf(block)).toEqual(["AutreProjet"]);
  });

  it("aucun projet ouvert ET aucun projet connu → AUCUN badge (jamais invente)", () => {
    const previous = globalThis._pilotProjectPath;
    globalThis._pilotProjectPath = "";
    try {
      const messagesEl = globalThis.document.createElement("div");
      const block = createSuperAgentBlock(messagesEl);
      expect(badgeNamesOf(block)).toEqual([]);
    } finally {
      globalThis._pilotProjectPath = previous;
    }
  });

  it("l'etiquette d'une bulle deja creee ne change pas quand le projet ouvert change", () => {
    const messagesEl = globalThis.document.createElement("div");
    const block = createSuperAgentBlock(messagesEl, ["PLh"]);
    const previous = globalThis._pilotProjectPath;
    globalThis._pilotProjectPath = "C:/Travail/EncoreAutre";
    try {
      expect(badgeNamesOf(block)).toEqual(["PLh"]);
    } finally {
      globalThis._pilotProjectPath = previous;
    }
  });
});
