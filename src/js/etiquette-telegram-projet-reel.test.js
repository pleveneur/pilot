// Verrou — ÉTIQUETTE DU PROJET EN TÊTE DES MESSAGES TELEGRAM DE L'ASSISTANT
//
// Défaut corrigé (docs/rapports/RAPPORT-etiquette-telegram-projet-reel.md) :
// `assistantTelegramProject()` (super-agent.js) ne lisait QUE
// `window._pilotProjectPath` — le projet OUVERT dans la fenêtre. Le propriétaire
// (2026-11-11) a constaté que, la conversation portant sur Pilot, les messages
// Telegram de l'Assistant étaient préfixés « MakeFilm », parce que MakeFilm
// était le projet ouvert. Les bulles de l'interface, elles, appliquaient déjà la
// bonne règle (`super-agent-badges.js` → `super-agent-project-label.js`).
//
// Règle vérifiée ici, et elle n'est PAS réécrite : le libellé est celui que rend
// la décision UNIQUE des étiquettes de bulle (`decideFinalBubbleProjectLabel`) —
// projet réellement concerné par l'échange d'abord, projet ouvert en DERNIER
// RECOURS seulement, « Assistant » si rien n'est identifiable. Un message
// Telegram = UN projet : c'est le PREMIER nom de l'ordre de priorité
// (`decision.main`).
//
// Ce fichier ÉCHOUE sur le code d'avant (vérifié par mutation, voir le rapport) :
// la fonction n'acceptait aucun projet concerné et lisait le seul projet ouvert.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sliceSource } from "./source-slice.js";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module. On installe donc un `window` minimal AVANT son import, avec MakeFilm
// comme projet OUVERT (la situation exacte du défaut constaté).
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
    children: [],
  });
  globalThis.window = globalThis;
  // PROJET OUVERT = MakeFilm (le défaut : ce n'est pas le projet de la mission).
  globalThis._pilotProjectPath = "G:\\IA_PL\\MakeFilm";
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
    get length() {
      return 0;
    },
    key: () => null,
  };
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
vi.mock("markdown-it", () => ({
  default: vi.fn(() => ({
    use() {
      return this;
    },
    render: () => "",
  })),
}));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./desktop-notify.js", () => ({
  notifySuperAgentDone: vi.fn(),
  playAssistantSound: vi.fn(),
  toastInfo: vi.fn(),
}));

const { assistantTelegramProject } = await import("./super-agent.js");
const { relayAssistantMessageToTelegram, setTelegramDialogConfigured, setTelegramDialogEnabled } =
  await import("./telegram-dialog.js");
const { setTelegramGateDeps, resetTelegramGate } = await import("./telegram-messages.js");
const { PROJECT_LABEL_SOURCE } = await import("./super-agent-project-label.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSource = (name) =>
  fs.readFileSync(path.join(HERE, name), "utf8").replace(/\r\n/g, "\n");

beforeEach(() => {
  // Projet ouvert = MakeFilm à chaque test (un autre test du fichier peut l'avoir changé).
  globalThis._pilotProjectPath = "G:\\IA_PL\\MakeFilm";
  // Horloge fixée en pleine journée (14 h) : les heures calmes (23 h → 7 h) ne
  // peuvent pas faire varier le résultat selon l'heure d'exécution des tests.
  setTelegramGateDeps({ now: () => new Date(2026, 0, 15, 14, 0, 0).getTime() });
  resetTelegramGate();
  setTelegramDialogConfigured(true);
  setTelegramDialogEnabled(true);
});

describe("assistantTelegramProject — le projet de l'échange, jamais le seul projet ouvert", () => {
  it("VERROU : MakeFilm ouvert, travail réel sur Pilot → « pilot », jamais « MakeFilm »", () => {
    // Projet ouvert = MakeFilm (voir le shim). Le tour a réellement visé « pilot ».
    expect(assistantTelegramProject({ concerned: ["pilot"] })).toBe("pilot");
    expect(assistantTelegramProject({ concerned: ["pilot"] })).not.toBe("MakeFilm");
  });

  it("le message Telegram réellement produit est préfixé du projet concerné", () => {
    const send = vi.fn();
    const ok = relayAssistantMessageToTelegram("J'ai terminé la mission sur Pilot, tout fonctionne.", {
      project: assistantTelegramProject({
        // Badge figé de la bulle : dernier recours (projet ouvert) + provenance.
        concerned: ["pilot"],
        frozen: ["MakeFilm"],
        frozenSource: PROJECT_LABEL_SOURCE.OPEN_PROJECT,
      }),
      send,
    });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message).toMatch(/^pilot : /i);
    expect(message).not.toMatch(/makefilm/i);
  });

  it("aucun projet concerné → DERNIER RECOURS : le projet ouvert (comportement d'avant conservé)", () => {
    expect(assistantTelegramProject({ concerned: [] })).toBe("MakeFilm");
    expect(
      assistantTelegramProject({ concerned: [], frozen: [], frozenSource: null })
    ).toBe("MakeFilm");
  });

  it("un nom PROUVÉ (badge figé) passe avant le projet ouvert, même sans projet concerné", () => {
    expect(
      assistantTelegramProject({
        concerned: [],
        frozen: ["pilot"],
        frozenSource: PROJECT_LABEL_SOURCE.NAMED,
      })
    ).toBe("pilot");
  });

  it("aucun projet identifiable → « Assistant » (repli inchangé)", () => {
    globalThis._pilotProjectPath = "";
    expect(assistantTelegramProject({ concerned: [] })).toBe("Assistant");
  });

  it("plusieurs projets concernés → UN SEUL : le premier de l'ordre de priorité", () => {
    // Un message Telegram ne porte qu'un projet (règle de `telegram-messages.js`) ;
    // `decision.main` est le premier nom de l'ordre déjà appliqué.
    expect(assistantTelegramProject({ concerned: ["pilot", "MakeFilm"] })).toBe("pilot");
  });

  it("le libellé reste un NOM COURT : jamais un chemin", () => {
    expect(assistantTelegramProject({ concerned: ["G:\\IA_PL\\pilot"] })).toBe("pilot");
  });
});

describe("branchement dans l'écran (la règle n'est pas recopiée, l'information circule)", () => {
  const src = readSource("super-agent.js");

  it("l'étiquette Telegram DÉLÈGUE à la décision unique des étiquettes de bulle", () => {
    const fn = sliceSource(
      src,
      "export function assistantTelegramProject(",
      "const SUPERAGENT_CHANNEL",
      200
    );
    expect(fn).toContain("decideFinalBubbleProjectLabel(");
    // Un message = un projet : le premier de l'ordre de priorité déjà appliqué.
    expect(fn).toContain("decision.main");
    // Le défaut : plus AUCUNE lecture directe du seul projet ouvert.
    expect(fn).not.toContain("_pilotProjectPath");
  });

  it("la réponse finale transmet les projets réellement visés ET le badge figé de la bulle", () => {
    const call = sliceSource(
      src,
      "const spokenToTelegram = relayAssistantMessageToTelegram(",
      "onEnd();",
      80
    );
    expect(call).toContain("assistantTelegramProject({");
    expect(call).toContain("concerned: respConcerned");
    expect(call).toContain("frozen: respBase");
    expect(call).toContain("frozenSource: respBaseSource");
  });

  it("une alerte transmise porte les projets du tour, COPIÉS avant l'attente du classement", () => {
    // `classifyAssistantMessageWithLaya` est asynchrone : relire l'état du tour
    // dans le `.then` donnerait une liste déjà remise à zéro par `onEnd()`.
    const fn = sliceSource(
      src,
      "function appendSystemMessage(",
      "\n}\n",
      200
    );
    expect(fn).toContain("const concernedForAlert = [...currentTurnConcernedBadges];");
    expect(fn).toContain("assistantTelegramProject({ concerned: concernedForAlert })");
  });
});
