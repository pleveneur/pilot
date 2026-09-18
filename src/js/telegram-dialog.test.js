// Tests unitaires — Telegram, étape 2, LOT 3 : l'Assistant « parle » sur Telegram.
//
// Couvre, sans jamais toucher au réseau :
//   1. la CONDENSATION d'un message en une phrase simple (texte long, texte
//      technique, texte déjà court, message purement technique) ;
//   2. le FILTRAGE des messages utiles (réponse / compte rendu / alerte /
//      demande d'accord) contre les messages intermédiaires ;
//   3. l'INERTIE totale quand le bouton est désactivé ou Telegram absent ;
//   4. la VISIBILITÉ du bouton selon la configuration ;
//   5. la CONSERVATION du réglage d'une session à l'autre et la compatibilité
//      d'une configuration ancienne (champ absent = valeur par défaut) ;
//   6. l'ABSENCE de doublon d'avis SANS PERTE : en communication active, un avis
//      brut non critique est retardé puis abandonné si l'Assistant parle, envoyé
//      sinon ; les ALERTES ne sont jamais retardées ni coupées.
//
// Le comportement du moteur (inertie, nettoyage, envoi via un faux envoyeur) est
// couvert par les tests Rust de `src-tauri/src/telegram.rs` et de `lib.rs`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(async () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  TELEGRAM_DIALOG_MAX_CHARS,
  TELEGRAM_RAW_AVIS_GRACE_MS,
  condenseAssistantMessage,
  classifyAssistantMessage,
  isUsefulAssistantMessage,
  relayAssistantMessageToTelegram,
  computeTelegramDialogVisibility,
  setTelegramDialogEnabled,
  setTelegramDialogConfigured,
  isTelegramDialogActive,
  resetTelegramDialogState,
  loadTelegramDialogConfig,
  setRawAvisTimers,
  setRawAvisTurnProbe,
  flushRawTelegramAvis,
} from "./telegram-dialog.js";
import { forwardToTelegram } from "./desktop-notify.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

/** Minuteurs factices du tampon d'avis : on contrôle l'envoi différé sans attendre. */
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

/** Messages envoyés au moteur (commande telegram_notify). */
function telegramMessages() {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "telegram_notify")
    .map(([, args]) => args.text);
}

beforeEach(() => {
  invoke.mockClear();
  invoke.mockImplementation(async () => ({}));
  resetTelegramDialogState();
});

afterEach(() => {
  setRawAvisTimers(null);
  setRawAvisTurnProbe(null);
  resetTelegramDialogState();
});

describe("condensation d'un message en une phrase simple", () => {
  it("texte long → première phrase, bornée et ponctuée", () => {
    const long =
      "J'ai terminé la mise à jour du module Telegram pour l'Assistant. " +
      "Ensuite j'ai relu le code, corrigé deux détails, ajouté des tests et " +
      "vérifié que toute la suite reste verte sans aucune régression.";
    const out = condenseAssistantMessage(long);
    expect(out).toBe("J'ai terminé la mise à jour du module Telegram pour l'Assistant.");
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_DIALOG_MAX_CHARS);
    expect(/[.!?…]$/.test(out)).toBe(true);
  });

  it("texte technique → aucun code, aucun nom de fichier, aucune commande", () => {
    const tech =
      "J'ai modifié `src/js/telegram-dialog.js` et lancé `npm test`.\n\n" +
      "```js\nconst x = 1;\n```\n\n- 3 fichiers\n- 12 tests";
    const out = condenseAssistantMessage(tech);
    expect(out).toBe("J'ai modifié et lancé.");
    expect(out).not.toMatch(/`|npm|\.js|src\/|```/);
  });

  it("texte déjà court → conservé tel quel", () => {
    expect(condenseAssistantMessage("C'est fait.")).toBe("C'est fait.");
  });

  it("texte purement technique (que du code) → rien à dire", () => {
    expect(condenseAssistantMessage("```\nnpm test\n```")).toBe("");
    expect(condenseAssistantMessage("`src/a.rs` `src/b.rs`")).toBe("");
  });

  it("un texte sans ponctuation finale reçoit un point", () => {
    expect(condenseAssistantMessage("Tout est prêt")).toBe("Tout est prêt.");
  });
});

describe("filtrage des messages utiles", () => {
  it("compte rendu / fin de mission → utile", () => {
    expect(isUsefulAssistantMessage("J'ai terminé la mission, tout est vérifié. ✅")).toBe(true);
  });

  it("alerte → utile", () => {
    expect(isUsefulAssistantMessage("⚠️ L'agent est bloqué, impossible de continuer.")).toBe(true);
    expect(classifyAssistantMessage("❌ L'envoi a échoué.")).toBe("alert");
  });

  it("demande d'accord / question au propriétaire → utile", () => {
    expect(isUsefulAssistantMessage("Voulez-vous que je continue sur ce projet ?")).toBe(true);
    expect(classifyAssistantMessage("Voulez-vous que je continue ?")).toBe("approval");
  });

  it("étape de travail → écartée", () => {
    expect(isUsefulAssistantMessage("Je vais maintenant vérifier les tests.")).toBe(false);
    expect(classifyAssistantMessage("Je vais maintenant vérifier les tests.")).toBe("intermediate");
  });

  it("bavardage technique court → écarté", () => {
    expect(isUsefulAssistantMessage("Compris.")).toBe(false);
    expect(isUsefulAssistantMessage("OK")).toBe(false);
  });

  it("message vide ou purement technique → écarté", () => {
    expect(isUsefulAssistantMessage("")).toBe(false);
    expect(classifyAssistantMessage("`npm test`")).toBe("empty");
  });
});

describe("inertie totale", () => {
  it("bouton désactivé → aucun envoi, aucune erreur", () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(false);
    const send = vi.fn();
    expect(relayAssistantMessageToTelegram("J'ai terminé la mission.", { send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("Telegram non configuré → aucun envoi, aucune erreur", () => {
    setTelegramDialogEnabled(true);
    setTelegramDialogConfigured(false);
    const send = vi.fn();
    expect(isTelegramDialogActive()).toBe(false);
    expect(relayAssistantMessageToTelegram("J'ai terminé la mission.", { send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("config illisible → état inerte (fail-closed), aucune erreur", async () => {
    const state = await loadTelegramDialogConfig(async () => {
      throw new Error("config indisponible");
    });
    expect(state).toEqual({ enabled: false, visible: false });
    expect(isTelegramDialogActive()).toBe(false);
  });

  it("message intermédiaire alors que tout est actif → rien n'est envoyé", () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const send = vi.fn();
    expect(relayAssistantMessageToTelegram("Je vais vérifier les tests.", { send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("actif + message utile → UNE phrase simple envoyée (jamais le texte brut)", () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const send = vi.fn();
    const ok = relayAssistantMessageToTelegram(
      "J'ai terminé la mission. Voici le détail : `src/a.js`, `npm test`.",
      { send }
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("J'ai terminé la mission.");
  });

  it("un échec d'envoi est avalé (jamais d'erreur visible)", () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const send = vi.fn(() => Promise.reject(new Error("réseau")));
    expect(() =>
      relayAssistantMessageToTelegram("J'ai terminé la mission.", { send })
    ).not.toThrow();
  });
});

describe("visibilité du bouton selon la configuration", () => {
  it("interrupteur principal coché + jeton ET identifiant présents → visible", () => {
    expect(
      computeTelegramDialogVisibility({
        telegram_notify_enabled: true,
        telegram_bot_token: "123:",
        telegram_chat_id: "42",
      })
    ).toBe(true);
  });

  it("interrupteur principal NON coché → invisible, même bien configuré", () => {
    // Sans l'interrupteur « Notifications Telegram », rien ne partirait jamais :
    // proposer un bouton d'activation serait trompeur.
    expect(
      computeTelegramDialogVisibility({
        telegram_notify_enabled: false,
        telegram_bot_token: "123:",
        telegram_chat_id: "42",
      })
    ).toBe(false);
  });

  it("config absente ou partielle → invisible", () => {
    expect(computeTelegramDialogVisibility(null)).toBe(false);
    expect(computeTelegramDialogVisibility({})).toBe(false);
    expect(
      computeTelegramDialogVisibility({ telegram_notify_enabled: true, telegram_bot_token: "123:" })
    ).toBe(false);
    expect(
      computeTelegramDialogVisibility({ telegram_notify_enabled: true, telegram_chat_id: "42" })
    ).toBe(false);
    expect(
      computeTelegramDialogVisibility({
        telegram_notify_enabled: true,
        telegram_bot_token: "   ",
        telegram_chat_id: "42",
      })
    ).toBe(false);
  });
});

describe("conservation du réglage et compatibilité d'une ancienne config", () => {
  it("le réglage est relu tel quel d'une session à l'autre", async () => {
    const cfg = {
      telegram_notify_enabled: true,
      telegram_bot_token: "123:abc",
      telegram_chat_id: "42",
      telegram_dialog_enabled: true,
    };
    const first = await loadTelegramDialogConfig(async () => cfg);
    expect(first).toEqual({ enabled: true, visible: true });
    expect(isTelegramDialogActive()).toBe(true);
    // « Redémarrage » : on repart d'un état vierge puis on relit la config.
    resetTelegramDialogState();
    const second = await loadTelegramDialogConfig(async () => cfg);
    expect(second).toEqual({ enabled: true, visible: true });
    expect(isTelegramDialogActive()).toBe(true);
  });

  it("une configuration ANCIENNE (champ absent) reste lisible, désactivée par défaut", async () => {
    const oldCfg = { telegram_bot_token: "123:abc", telegram_chat_id: "42" };
    const state = await loadTelegramDialogConfig(async () => oldCfg);
    // Sans l'interrupteur principal (champ absent d'une ancienne config), la
    // passerelle n'est pas opérationnelle → bouton invisible, communication off.
    expect(state).toEqual({ enabled: false, visible: false });
    expect(isTelegramDialogActive()).toBe(false);
  });

  it("le moteur déclare le champ, désactivé par défaut, tolérant au champ absent", () => {
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toContain("\n    telegram_dialog_enabled:");
    expect(rust).toMatch(/telegram_dialog_enabled:\s*false/);
    // Le champ est reconnu par la sentinelle de config « par défaut » : un
    // réglage non défaut ne peut pas être écrasé par le chargement paresseux.
    expect(rust).toMatch(
      /config\.telegram_dialog_enabled\s*==\s*default\.telegram_dialog_enabled/
    );
    // Un champ absent d'un ancien config.json reprend son défaut.
    const fieldBlock = rust.slice(
      rust.indexOf("telegram_dialog_enabled:"),
      rust.indexOf("telegram_dialog_enabled:") + 400
    );
    expect(fieldBlock.length).toBeGreaterThan(0);
    expect(rust).toMatch(/#\[serde\(default\)\]\s*\n\s*telegram_dialog_enabled:/);
  });

  it("settings.js réécrit le réglage (sinon save_config le réinitialiserait)", () => {
    const js = read("src/js/settings.js");
    expect(js).toContain("telegram_dialog_enabled:");
  });
});

describe("absence de doublon d'avis (et zéro perte)", () => {
  it("communication INACTIVE → avis brut transmis comme avant (étape 1)", async () => {
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé");
    expect(telegramMessages()).toEqual(["Pilot — Agent terminé — ✅ terminé"]);
  });

  it("communication ACTIVE → une ALERTE n'est jamais retardée ni coupée", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    await forwardToTelegram("Pilot — Anomalie détectée", "⚠️ agent bloqué", { critical: true });
    expect(telegramMessages()).toEqual(["Pilot — Anomalie détectée — ⚠️ agent bloqué"]);
  });

  it("communication ACTIVE → avis non critique RETARDÉ, puis envoyé si l'Assistant ne parle pas", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const timers = manualTimers();
    setRawAvisTimers(timers);
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé");
    // Retardé (pas encore envoyé) mais PAS perdu : il part à l'échéance.
    expect(telegramMessages()).toEqual([]);
    expect(timers.count()).toBe(1);
    timers.advance(TELEGRAM_RAW_AVIS_GRACE_MS);
    expect(telegramMessages()).toEqual(["Pilot — Agent terminé — ✅ terminé"]);
  });

  it("communication ACTIVE → avis retardé ABANDONNÉ si l'Assistant parle pendant la fenêtre", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const timers = manualTimers();
    setRawAvisTimers(timers);
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé");
    const sent = relayAssistantMessageToTelegram(
      "✅ La tâche déléguée est terminée.",
      { send: (text) => invoke("telegram_notify", { text }) }
    );
    expect(sent).toBe(true);
    timers.advance(TELEGRAM_RAW_AVIS_GRACE_MS * 3);
    // Pas de doublon : seule la phrase de l'Assistant est partie.
    expect(telegramMessages()).toEqual(["✅ La tâche déléguée est terminée."]);
  });

  it("communication ACTIVE → un tour en cours repousse l'échéance, la fin de tour sans parole déclenche l'avis", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const timers = manualTimers();
    setRawAvisTimers(timers);
    let busy = true;
    setRawAvisTurnProbe(() => busy);
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé");
    timers.advance(TELEGRAM_RAW_AVIS_GRACE_MS);
    // Le tour de l'Assistant est en cours : on attend sa fin réelle.
    expect(telegramMessages()).toEqual([]);
    busy = false;
    flushRawTelegramAvis();
    expect(telegramMessages()).toEqual(["Pilot — Agent terminé — ✅ terminé"]);
  });

  it("communication ACTIVE → l'Assistant parle à la place, en une phrase", () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    const sent = relayAssistantMessageToTelegram(
      "⚠️ Un agent semble bloqué, je l'ai arrêté et relancé.",
      { send: (text) => invoke("telegram_notify", { text }) }
    );
    expect(sent).toBe(true);
    expect(telegramMessages()).toEqual([
      "⚠️ Un agent semble bloqué, je l'ai arrêté et relancé.",
    ]);
  });
});
