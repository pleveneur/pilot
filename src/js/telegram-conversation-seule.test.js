// telegram-conversation-seule.test.js — LE CANAL TELEGRAM NE PORTE QUE LA
// CONVERSATION.
//
// Décision du propriétaire (2026-11) : « sur Telegram, je veux UNIQUEMENT la
// conversation question/réponse entre moi et l'assistant, exactement comme en
// mode Vocal. Tout message qui annonce un ÉVÉNEMENT doit cesser. »
//
// Ce fichier est la garde de cette décision. Il échoue si :
//   1. un message d'ÉVÉNEMENT repart un jour sur Telegram — début de mission,
//      fin de mission, changement d'état, démarrage d'agent, rapport automatique,
//      alerte technique, résumé de tâche, message de service (chaque point
//      d'avis de l'interface est essayé, dans les pires conditions : dialogue
//      actif, heures calmes, moteur en échec) ;
//   2. quoi que ce soit reste EN ATTENTE (un avis retardé repartirait plus tard) ;
//   3. la CONVERSATION se casse : une demande écrite sur Telegram doit toujours
//      être déposée dans la conversation, et sa réponse doit toujours partir.
//
// Le test porte sur le comportement (modules réels, transport Tauri simulé) et
// non sur une copie du code.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// `telegram-inbound.js` tire `super-agent.js`, module d'UI qui touche `window` à
// l'évaluation : harnais DOM minimal installé AVANT les imports.
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
    get length() {
      return 0;
    },
    key: () => null,
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop,
  });
});

// ── Doublures : aucun réseau, aucune notification native réelle ──
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(async () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  forwardToTelegram,
  notifyTaskStarted,
  notifyAgentDone,
  notifyAgentDoneFromRemote,
  notifySuperAgentDone,
  notifyAnomaly,
} from "./desktop-notify.js";
import {
  TELEGRAM_CHANNEL_CONVERSATION_ONLY,
  isTelegramEventMessageAllowed,
  deliverRawTelegramAvis,
  flushRawTelegramAvis,
  relayAssistantMessageToTelegram,
  setRawAvisTimers,
  setTelegramDialogEnabled,
  setTelegramDialogConfigured,
  resetTelegramDialogState,
} from "./telegram-dialog.js";
import { resetTelegramGate, setTelegramGateDeps } from "./telegram-messages.js";
import {
  askTelegramQuestion,
  consumeTelegramQuestionAnswer,
  clearTelegramQuestion,
} from "./telegram-questions.js";
import { createTelegramInbound } from "./telegram-inbound.js";

// Horloge FIXE (12 h, hors heures calmes 23 h → 7 h) : la suite ne dépend jamais
// de l'heure à laquelle elle tourne.
const HEURE_PLEINE = Date.parse("2026-05-05T12:00:00");
const NUIT = Date.parse("2026-05-05T02:00:00");
const PROJET = "G:/IA_PL/pilot";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

/** Messages effectivement transmis au moteur Telegram. */
function telegramMessages() {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "telegram_notify")
    .map(([, args]) => args.text);
}

/** Minuteurs factices : on prouve qu'AUCUN avis n'est mis en attente. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => scheduled.delete(id),
    advance: (ms) => {
      now += ms;
      for (const [id, entry] of [...scheduled]) {
        if (entry.at <= now) {
          scheduled.delete(id);
          entry.fn();
        }
      }
    },
    count: () => scheduled.size,
  };
}

beforeEach(() => {
  invoke.mockClear();
  invoke.mockImplementation(async () => ({}));
  resetTelegramDialogState();
  resetTelegramGate();
  setTelegramGateDeps({ now: () => HEURE_PLEINE });
  clearTelegramQuestion();
});

afterEach(() => {
  setRawAvisTimers(null);
  clearTelegramQuestion();
  resetTelegramDialogState();
  resetTelegramGate();
  setTelegramGateDeps({ now: () => Date.now() });
});

describe("la politique du canal est écrite noir sur blanc", () => {
  it("le canal ne porte QUE la conversation, et le couperet refuse les événements", () => {
    expect(TELEGRAM_CHANNEL_CONVERSATION_ONLY).toBe(true);
    expect(isTelegramEventMessageAllowed()).toBe(false);
  });

  it("le couperet est appliqué au SEUL point de passage des avis d'événements", () => {
    const src = read("src/js/telegram-dialog.js");
    // Un seul endroit décide : la livraison des avis bruts.
    expect(src).toContain("export function isTelegramEventMessageAllowed()");
    const start = src.indexOf("export function deliverRawTelegramAvis");
    expect(start).toBeGreaterThan(-1);
    const funnel = src.slice(start, start + 1200);
    expect(funnel).toContain("if (!isTelegramEventMessageAllowed()) return;");
    // desktop-notify ne parle au moteur QUE par ce point de passage : aucun
    // second chemin ne pourrait contourner le couperet.
    const notify = read("src/js/desktop-notify.js");
    expect(notify).toContain('invoke("telegram_notify"');
    expect(notify.match(/telegram_notify/g).length).toBe(1);
    expect(notify).toContain("deliverRawTelegramAvis(");
  });
});

describe("aucun message d'ÉVÉNEMENT ne part sur Telegram", () => {
  // Chaque point d'avis de l'interface, essayé tel quel.
  const scenarios = [
    ["début de mission (tâche lancée)", () => notifyTaskStarted({ project: PROJET, action: "correction de l'autotest" })],
    ["fin de mission à distance", () => notifyAgentDoneFromRemote({ project: PROJET })],
    ["fin de mission avec suite à tester", () =>
      notifyAgentDone({ project: PROJET, result: "le correctif est en place", testable: "ouvrir un fichier" })],
    ["changement d'état de l'assistant", () =>
      notifySuperAgentDone({ project: PROJET, ok: true, result: "tâche déléguée terminée" })],
    ["alerte technique (anomalie)", () =>
      notifyAnomaly({
        project: PROJET,
        problem: "un agent est resté bloqué, il a été arrêté",
        decision: "le relancer ou vérifier ce qu'il faisait",
      })],
    ["avis historique brut (fin de mission)", () =>
      forwardToTelegram("Pilot — Agent terminé", "✅ terminé", { project: PROJET, result: "terminé" })],
  ];

  for (const [nom, envoyer] of scenarios) {
    it(`${nom} → rien ne part`, async () => {
      await envoyer();
      expect(telegramMessages()).toEqual([]);
    });
  }

  it("rien ne part non plus quand le dialogue Telegram est ACTIF", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    for (const [, envoyer] of scenarios) await envoyer();
    expect(telegramMessages()).toEqual([]);
  });

  it("rien ne part pendant les heures calmes (aucun report pour plus tard)", async () => {
    // Les heures calmes ne servent plus à rien sur ce canal : un avis n'y est
    // même pas mis de côté, donc rien ne peut repartir au petit matin.
    setTelegramGateDeps({ now: () => NUIT });
    for (const [, envoyer] of scenarios) await envoyer();
    expect(telegramMessages()).toEqual([]);
  });

  it("rien n'est mis EN ATTENTE : aucun minuteur, aucun envoi différé", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const timers = manualTimers();
    setRawAvisTimers(timers);
    for (const [, envoyer] of scenarios) await envoyer();
    expect(timers.count()).toBe(0);
    timers.advance(60_000);
    flushRawTelegramAvis();
    expect(telegramMessages()).toEqual([]);
  });

  it("une alerte CRITIQUE est coupée comme les autres (le canal ne l'annonce plus)", () => {
    const envois = [];
    deliverRawTelegramAvis(
      "⚠️ pilot : agent bloqué — à décider : le relancer",
      { critical: true },
      { send: (text) => envois.push(text), isActive: () => true }
    );
    expect(envois).toEqual([]);
  });

  it("le moteur Telegram en ÉCHEC ne change rien (aucune erreur, aucun envoi)", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "get_config") throw new Error("config indisponible");
      return {};
    });
    for (const [, envoyer] of scenarios) await envoyer();
    expect(telegramMessages()).toEqual([]);
  });
});

describe("la conversation, elle, reste entière", () => {
  it("une demande écrite sur Telegram est déposée dans la conversation, puis sa réponse part", async () => {
    const remis = [];
    const inbound = createTelegramInbound({
      invokeFn: async (cmd) => {
        if (cmd === "telegram_poll_inbound") {
          return {
            messages: [{ updateId: 7, text: "Où en est le projet ?" }],
            nextOffset: 8,
            inert: null,
          };
        }
        return {};
      },
      deliver: async (text) => {
        remis.push(text);
      },
      warn: () => {},
    });

    // 1. La DEMANDE du propriétaire entre dans la conversation (inchangé).
    expect(await inbound.pollOnce()).toBe(1);
    expect(remis).toHaveLength(1);
    expect(remis[0]).toContain("Où en est le projet ?");

    // 2. Aucun message d'événement n'est parti au passage.
    expect(telegramMessages()).toEqual([]);

    // 3. La RÉPONSE de l'assistant part sur le canal (c'est la conversation).
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const envoye = relayAssistantMessageToTelegram("✅ La passerelle est en place.", {
      send: (text) => invoke("telegram_notify", { text }),
    });
    expect(envoye).toBe(true);
    expect(telegramMessages()).toEqual(["Assistant : ✅ La passerelle est en place."]);
  });

  it("une question de l'assistant part, et la réponse du propriétaire est bien consommée", async () => {
    let reponse = null;
    askTelegramQuestion("question-1", { title: "Quel fichier ?", options: ["a.md", "b.md"] }, (v) => {
      reponse = v;
    });
    // Laisse partir l'envoi (boutons indisponibles hors Tauri → repli texte).
    await new Promise((r) => setTimeout(r, 0));
    expect(telegramMessages()).toHaveLength(1);
    expect(telegramMessages()[0]).toContain("Quel fichier ?");

    // La réponse tapée sur Telegram est consommée comme réponse à la question
    // (elle n'est donc PAS déposée comme un nouveau message de conversation).
    expect(consumeTelegramQuestionAnswer("2")).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(reponse).toMatchObject({ value: "b.md" });
  });
});
