// Tests unitaires — Passerelle Telegram, étape 1 (ENVOI seulement).
//
// Couvre deux étages, sans jamais toucher au réseau :
//   1. le BRANCHEMENT de l'interface : chaque avis existant (fin de tâche d'un
//      agent, événement de l'assistant, alerte d'anomalie / arrêt automatique)
//      transmet bien un message au moteur, en arrière-plan et sans erreur ;
//   2. la CONFIGURATION : les champs existent des deux côtés (HTML/moteur) avec
//      un défaut DÉSACTIVÉ, et un enregistrement des Paramètres ne les perd pas.
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

describe("forwardToTelegram — branchement de l'interface", () => {
  it("un avis historique devient un message de FIN, nom court du projet en tête", async () => {
    await forwardToTelegram("Pilot — Agent terminé", "✅ terminé", {
      project: PROJET,
      result: "terminé",
    });
    // Un message = UN projet ; aucun chemin, aucun titre d'application.
    expect(telegramMessages()).toEqual(["pilot : livré — terminé"]);
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

  it("avale un échec de la commande (jamais d'erreur remontée)", async () => {
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

describe("branchement sur les avis existants", () => {
  it("fin de tâche d'un agent (chat local) → transmis même si notify_agent_done est désactivé", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { notify_agent_done: false } : {}));
    await notifyAgentDone({ local: true, project: PROJET });
    expect(telegramMessages()).toEqual(["pilot : livré — L'agent a terminé."]);
  });

  it("fin de tâche à distance → UN SEUL envoi (pas de doublon avec notifyAgentDone)", async () => {
    await notifyAgentDoneFromRemote({ project: PROJET });
    expect(telegramMessages()).toEqual([
      "pilot : livré — la tâche lancée à distance est terminée",
    ]);
  });

  it("une fin de tâche peut dire ce qu'il reste à tester", async () => {
    await notifyAgentDoneFromRemote({
      project: PROJET,
      result: "le correctif est en place",
      testable: "ouvrir un fichier puis le refermer",
    });
    expect(telegramMessages()).toEqual([
      "pilot : livré — le correctif est en place\nÀ tester : ouvrir un fichier puis le refermer",
    ]);
  });

  it("événement important de l'assistant → transmis même si notify_super_agent_done est désactivé", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { notify_super_agent_done: false } : {}));
    await notifySuperAgentDone({
      title: "Pilot — Assistant",
      body: "tâche déléguée terminée",
      project: PROJET,
      ok: true,
      result: "tâche déléguée terminée",
    });
    expect(telegramMessages()).toEqual(["pilot : livré — tâche déléguée terminée"]);
  });

  it("alerte d'anomalie / arrêt automatique → transmise même si la surveillance est désactivée", async () => {
    invoke.mockImplementation(async (cmd) => (cmd === "get_config" ? { anomaly_detection_enabled: false } : {}));
    await notifyAnomaly({
      title: "Pilot — Arrêt automatique",
      body: "agent stoppé (bloqué)",
      project: PROJET,
      problem: "un agent est resté bloqué, il a été arrêté",
      decision: "le relancer ou vérifier ce qu'il faisait",
    });
    expect(telegramMessages()).toEqual([
      "⚠️ pilot : un agent est resté bloqué, il a été arrêté — à décider : le relancer ou vérifier ce qu'il faisait",
    ]);
  });

  it("une alerte sans décision possible n'est PAS envoyée (jamais de bruit inutile)", async () => {
    await notifyAnomaly({
      title: "Pilot — Anomalie détectée",
      body: "⚠️ Un agent semble bloqué (actif sans progression).",
      project: PROJET,
    });
    expect(telegramMessages()).toEqual([]);
  });

  it("une lecture de configuration en ÉCHEC n'empêche pas la transmission Telegram", async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "get_config") throw new Error("config indisponible");
      return {};
    });
    await notifyAnomaly({
      project: PROJET,
      problem: "Un agent semble bloqué (actif sans progression).",
      decision: "lancer le diagnostic ou arrêter l'agent",
    });
    expect(telegramMessages()).toEqual([
      "⚠️ pilot : Un agent semble bloqué (actif sans progression). — à décider : lancer le diagnostic ou arrêter l'agent",
    ]);
  });

  it("communication du dialogue ACTIVE → une alerte d'anomalie part QUAND MÊME (jamais coupée)", async () => {
    // Le pire cas du défaut : quand la communication Telegram du dialogue est
    // active, l'anti-doublon ne doit JAMAIS faire taire une alerte.
    setTelegramDialogConfigured(true);
    setTelegramDialogEnabled(true);
    await notifyAnomaly({
      title: "Pilot — Agent silencieux",
      body: "un agent ne produit plus rien",
      project: PROJET,
      problem: "un agent ne produit plus rien",
      decision: "relancer la tâche ou arrêter l'agent",
    });
    expect(telegramMessages()).toEqual([
      "⚠️ pilot : un agent ne produit plus rien — à décider : relancer la tâche ou arrêter l'agent",
    ]);
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
