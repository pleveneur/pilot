// Tests unitaires — Passerelle Telegram : LE CANAL NE PORTE QUE LA CONVERSATION.
//
// Décision du propriétaire (2026-11) : « sur Telegram, je veux UNIQUEMENT la
// conversation question/réponse, exactement comme en mode Vocal. Tout message
// qui annonce un ÉVÉNEMENT doit cesser. » Ces tests tiennent cette règle :
//   1. chaque avis existant de l'interface (fin de tâche d'un agent, événement de
//      l'assistant, alerte d'anomalie / arrêt automatique, début de mission,
//      avis historique) est un message d'ÉVÉNEMENT : il ne transmet PLUS RIEN au
//      moteur Telegram — et ne laisse rien en attente ;
//   2. la CONFIGURATION : les champs existent des deux côtés (HTML/moteur) avec
//      un défaut DÉSACTIVÉ, et un enregistrement des Paramètres ne les perd pas.
//
// Que ces avis ne partent pas ne les rend pas muets ailleurs : la notification
// desktop est indépendante (permission refusée dans ces doublures, et pourtant
// aucune erreur n'est remontée).
//
// Le comportement du moteur (inertie si désactivé/mal configuré, nettoyage du
// texte, envoi via un faux envoyeur) est couvert par les tests Rust de
// `src-tauri/src/telegram.rs`, qui n'atteignent eux non plus jamais le réseau.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── Doublures : aucun appel réseau, aucune notification native réelle ──
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  // Permission refusée : prouve que Telegram est indépendant du canal desktop.
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(async () => {}),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  forwardToTelegram,
  notifyAgentDone,
  notifyAgentDoneFromRemote,
  notifySuperAgentDone,
  notifyAnomaly,
} from "./desktop-notify.js";
import {
  resetTelegramDialogState,
  setTelegramDialogConfigured,
  setTelegramDialogEnabled,
} from "./telegram-dialog.js";
import { resetTelegramGate, setTelegramGateDeps } from "./telegram-messages.js";

// Horloge FIXE (12 h, hors heures calmes 23 h → 7 h) : les tests ne dépendent
// jamais de l'heure à laquelle la suite tourne.
const HEURE_PLEINE = Date.parse("2026-05-05T12:00:00");
// Un seul projet par message : on fournit toujours le projet concerné.
const PROJET = "G:/IA_PL/pilot";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

/** Messages effectivement transmis au moteur (commande telegram_notify). */
function telegramMessages() {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "telegram_notify")
    .map(([, args]) => args.text);
}

beforeEach(() => {
  invoke.mockClear(); // les appels get_config n'ont pas d'implémentation réelle
  invoke.mockImplementation(async () => ({}));
  // État Telegram du dialogue remis à zéro : ces tests portent sur l'étape 1
  // (communication du dialogue coupée), sauf le test d'alerte explicite.
  resetTelegramDialogState();
  // Porte unique des messages : état vierge + horloge fixe hors heures calmes.
  resetTelegramGate();
  setTelegramGateDeps({ now: () => HEURE_PLEINE });
});

describe("forwardToTelegram — un message d'ÉVÉNEMENT ne part plus sur Telegram", () => {
  it("un avis de fin de mission est COUPÉ (le canal ne porte que la conversation)", async () => {
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé", {
      project: PROJET,
      result: "terminé",
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("ne transmet rien pour un texte vide", async () => {
    await forwardToTelegram("", "   ");
    await forwardToTelegram(undefined, null);
    expect(telegramMessages()).toEqual([]);
  });

  it("ne transmet rien pour un événement sans information utile (aucun projet)", async () => {
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé");
    expect(telegramMessages()).toEqual([]);
  });

  it("avale un échec du moteur (jamais d'erreur remontée)", async () => {
    invoke.mockRejectedValueOnce(new Error("moteur indisponible"));
    await expect(
      forwardToTelegram("titre", "corps", { project: PROJET, result: "corps" })
    ).resolves.toBeUndefined();
  });

  it("avale une absence d'invoke (hors Tauri)", async () => {
    invoke.mockImplementationOnce(() => {
      throw new Error("invoke indisponible");
    });
    await expect(
      forwardToTelegram("titre", "corps", { project: PROJET, result: "corps" })
    ).resolves.toBeUndefined();
  });
});

describe("les points d'avis existants restent branchés et n'envoient RIEN sur Telegram", () => {
  // Ces avis-là (début / fin de mission, rapport, alerte) continuent d'exister
  // pour la notification desktop et le journal ; le canal Telegram, lui, ne les
  // transporte plus. Ces tests échouent si l'un d'eux repart un jour.
  it("fin de tâche d'un agent (chat local) → aucun message, même si notify_agent_done est désactivé", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { notify_agent_done: false } : {}));
    await notifyAgentDone({ local: true, project: PROJET });
    expect(telegramMessages()).toEqual([]);
  });

  it("fin de tâche à distance → aucun message", async () => {
    await notifyAgentDoneFromRemote({ project: PROJET });
    expect(telegramMessages()).toEqual([]);
  });

  it("fin de tâche avec ce qu'il reste à tester → aucun message", async () => {
    await notifyAgentDoneFromRemote({
      project: PROJET,
      result: "le correctif est en place",
      testable: "ouvrir un fichier puis le refermer",
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("événement important de l'assistant → aucun message, même si notify_super_agent_done est désactivé", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { notify_super_agent_done: false } : {}));
    await notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: "tâche déléguée terminée",
      project: PROJET,
      ok: true,
      result: "tâche déléguée terminée",
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("alerte d'anomalie / arrêt automatique → aucun message, même si la surveillance est désactivée", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { anomaly_detection_enabled: false } : {}));
    await notifyAnomaly({
      title: "Pilot — Arrêt automatique",
      body: "agent stoppé (bloqué)",
      project: PROJET,
      problem: "un agent est resté bloqué, il a été arrêté",
      decision: "le relancer ou vérifier ce qu'il faisait",
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("une alerte sans décision possible n'est pas envoyée non plus (aucun bruit)", async () => {
    await notifyAnomaly({
      title: "Pilot — Anomalie détectée",
      body: "⚠️ Un agent semble bloqué (actif sans progression).",
      project: PROJET,
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("une lecture de configuration en ÉCHEC ne fait rien partir pour autant", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "get_config") throw new Error("config indisponible");
      return {};
    });
    await notifyAnomaly({
      project: PROJET,
      problem: "Un agent semble bloqué (actif sans progression).",
      decision: "lancer le diagnostic ou arrêter l'agent",
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("communication du dialogue ACTIVE → une alerte d'anomalie ne part pas non plus", async () => {
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    await notifyAnomaly({
      title: "Pilot — Agent silencieux",
      body: "un agent ne produit plus rien",
      project: PROJET,
      problem: "un agent ne produit plus rien",
      decision: "relancer la tâche ou arrêter l'agent",
    });
    expect(telegramMessages()).toEqual([]);
    resetTelegramDialogState();
  });
});

describe("réglages Telegram — cohérence moteur / interface (anti-régression)", () => {
  it("le moteur déclare les trois champs, désactivés par défaut", () => {
    const rust = read("src-tauri/src/lib.rs");
    for (const field of ["telegram_notify_enabled", "telegram_bot_token", "telegram_chat_id"]) {
      expect(rust, `champ ${field} absent de lib.rs`).toContain(`\n    ${field}:`);
    }
    expect(rust).toMatch(/telegram_notify_enabled:\s*false/);
    expect(rust).toMatch(/telegram_bot_token:\s*String::new\(\)/);
    expect(rust).toMatch(/telegram_chat_id:\s*String::new\(\)/);
  });

  it("les champs sont exposés dans les Paramètres (interrupteur + jeton masqué)", () => {
    const html = read("index.html");
    expect(html).toContain('id="setting-telegram-enabled"');
    expect(html).toContain('id="setting-telegram-token"');
    expect(html).toContain('id="setting-telegram-chat-id"');
    // Le jeton ne doit jamais être affiché en clair.
    expect(html).toMatch(/id="setting-telegram-token"[^>]*type="password"|type="password"[^>]*id="setting-telegram-token"/);
  });

  it("settings.js relit ET réécrit les trois champs (objet AppConfig complet)", () => {
    const js = read("src/js/settings.js");
    // Lecture au chargement de la modale.
    expect(js).toContain("chkTelegramEnabled.checked = currentConfig.telegram_notify_enabled");
    expect(js).toContain("inputTelegramToken.value = currentConfig.telegram_bot_token");
    expect(js).toContain("inputTelegramChatId.value = currentConfig.telegram_chat_id");
    // Écriture : les trois clés doivent figurer dans l'objet de sauvegarde
    // (sinon `save_config` les réinitialiserait par défaut).
    for (const key of ["telegram_notify_enabled:", "telegram_bot_token:", "telegram_chat_id:"]) {
      expect(js, `clé ${key} absente de l'objet de sauvegarde`).toContain(key);
    }
  });

  it("la modale annule toujours son ouverture si get_config échoue (réserve R-B du lot 3-bis)", () => {
    const js = read("src/js/settings.js");
    expect(js).toMatch(/Configuration indisponible pour le moment/);
  });
});
