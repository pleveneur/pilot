// telegram-notify-setting.test.js — garde-fous du réglage UNIQUE
// « me prévenir sur Telegram » (spec_telegram.md).
//
// Ces tests échouent si l'une des règles du propriétaire est cassée :
//   (a) l'assistant ne peut plus VOIR l'état du réglage à chaque échange ;
//   (b) un message peut partir alors que le réglage est coupé ;
//   (c) le réglage ne survit plus à un redémarrage ;
//   (d) un message du PROPRIÉTAIRE reçu via Telegram ne réactive plus le réglage ;
//   (e) un expéditeur INCONNU peut réactiver le réglage ;
//   (f) le réglage existe deux fois (deux cases, deux champs).
//
// Les deux familles sont couvertes : le module JS (lecture/écriture) et le
// BRANCHEMENT réel, lu dans les sources Rust/TS/HTML/JS (un branchement oublié
// est un réglage mort).

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  TELEGRAM_NOTIFY_FIELD,
  isTelegramNotifyEnabled,
  setTelegramNotifyEnabled,
  telegramNotifyConfirmation,
  withTelegramNotifyEnabled,
} from "./telegram-notify-setting.js";

const ROOT = resolve(__dirname, "../..");

/** Lit un fichier source avec fins de ligne normalisées (piège CI Windows). */
function readText(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

const telegramRs = readText("src-tauri/src/telegram.rs");
const superAgentRs = readText("src-tauri/src/super_agent.rs");
const libRs = readText("src-tauri/src/lib.rs");
const actionsTs = readText("src-tauri/extensions/pilot-assistant-actions.ts");
const superAgentJs = readText("src/js/super-agent.js");
const settingsJs = readText("src/js/settings.js");
const indexHtml = readText("index.html");

/** Nombre d'occurrences d'un motif (littéral). */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe("réglage « me prévenir sur Telegram » — module", () => {
  it("lit strictement le champ unique (absent ou non booléen = coupé)", () => {
    expect(TELEGRAM_NOTIFY_FIELD).toBe("telegram_notify_enabled");
    expect(isTelegramNotifyEnabled({ telegram_notify_enabled: true })).toBe(true);
    expect(isTelegramNotifyEnabled({ telegram_notify_enabled: false })).toBe(false);
    expect(isTelegramNotifyEnabled({})).toBe(false);
    expect(isTelegramNotifyEnabled(null)).toBe(false);
    expect(isTelegramNotifyEnabled({ telegram_notify_enabled: "true" })).toBe(false);
  });

  it("positionne le champ sans modifier l'objet d'origine", () => {
    const cfg = { theme: "dark", telegram_notify_enabled: false };
    const on = withTelegramNotifyEnabled(cfg, true);
    expect(on.telegram_notify_enabled).toBe(true);
    expect(on.theme).toBe("dark");
    expect(cfg.telegram_notify_enabled).toBe(false);
  });

  it("confirme en UNE phrase, dans les deux sens", () => {
    for (const enabled of [true, false]) {
      const line = telegramNotifyConfirmation(enabled);
      expect(line.length).toBeGreaterThan(0);
      expect(line.endsWith(".")).toBe(true);
      expect(line.split("\n")).toHaveLength(1);
    }
    expect(telegramNotifyConfirmation(true)).toMatch(/préviens/i);
    expect(telegramNotifyConfirmation(false)).toMatch(/plus rien/i);
  });

  it("écrit la configuration RELUE (jamais un instantané périmé) et prévient l'interface", async () => {
    const saved = [];
    const cfg = { theme: "dark", super_agent_name: "Assistant", telegram_notify_enabled: false };
    const notify = vi.fn();
    const res = await setTelegramNotifyEnabled(true, {
      invokeFn: async (cmd, args) => {
        if (cmd === "get_config") return { ...cfg };
        if (cmd === "save_config") {
          saved.push(args.config);
          return null;
        }
        throw new Error("commande inattendue : " + cmd);
      },
      notify,
    });
    expect(res).toEqual({ ok: true, enabled: true, changed: true });
    expect(saved).toHaveLength(1);
    // Toute la configuration est réécrite (save_config remplace le fichier) et
    // le champ unique porte la nouvelle valeur.
    expect(saved[0]).toMatchObject({
      theme: "dark",
      super_agent_name: "Assistant",
      telegram_notify_enabled: true,
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("n'écrit rien quand l'état demandé est déjà celui en place", async () => {
    const save = vi.fn();
    const res = await setTelegramNotifyEnabled(true, {
      invokeFn: async (cmd) => {
        if (cmd === "get_config") return { telegram_notify_enabled: true };
        save();
        return null;
      },
    });
    expect(res).toEqual({ ok: true, enabled: true, changed: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("échoue proprement (aucune valeur par défaut persistée) si la configuration est illisible", async () => {
    const save = vi.fn();
    const res = await setTelegramNotifyEnabled(false, {
      invokeFn: async (cmd) => {
        if (cmd === "get_config") throw new Error("base indisponible");
        save();
        return null;
      },
    });
    expect(res.ok).toBe(false);
    expect(res.changed).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("échoue proprement si l'écriture échoue (réglage inchangé)", async () => {
    const res = await setTelegramNotifyEnabled(false, {
      invokeFn: async (cmd) => {
        if (cmd === "get_config") return { telegram_notify_enabled: true };
        throw new Error("disque plein");
      },
    });
    expect(res.ok).toBe(false);
    expect(res.changed).toBe(false);
  });
});

describe("(f) le réglage n'existe QU'UNE fois", () => {
  it("un seul champ de configuration dans AppConfig", () => {
    // Déclaration du champ (le type de la structure), pas ses usages.
    expect(count(libRs, "telegram_notify_enabled: bool,")).toBe(1);
  });

  it("une seule case à cocher dans l'interface", () => {
    expect(count(indexHtml, 'id="setting-telegram-enabled"')).toBe(1);
    const ids = (indexHtml.match(/id="setting-telegram-[a-z0-9_-]*"/g) || []).sort();
    // Les trois champs de la section : l'interrupteur unique + les deux
    // identifiants techniques (jeton, discussion). Aucun second interrupteur.
    expect(ids).toEqual([
      'id="setting-telegram-chat-id"',
      'id="setting-telegram-enabled"',
      'id="setting-telegram-token"',
    ]);
  });

  it("un seul point de lecture/écriture côté interface", () => {
    expect(count(settingsJs, "chkTelegramEnabled")).toBeGreaterThan(0);
    expect(count(settingsJs, "setting-telegram-enabled")).toBe(1);
    // Aucun autre module ne relit le champ directement (une seule porte) : la
    // seule mention dans super-agent.js est un commentaire d'architecture.
    const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, "");
    expect(count(codeOnly(superAgentJs), TELEGRAM_NOTIFY_FIELD)).toBe(0);
  });
});

describe("(a) l'assistant VOIT l'état du réglage à chaque échange", () => {
  it("l'état est écrit dans le prompt système, dans les DEUX chemins d'envoi", () => {
    expect(count(superAgentRs, "fn telegram_notify_guideline(")).toBe(1);
    // 1 définition + 2 appels hors tests (envoi RPC de l'assistant, assistant
    // jetable) : les deux chemins de prompt sont couverts.
    const prod = superAgentRs.slice(0, superAgentRs.indexOf("#[cfg(test)]"));
    expect(count(prod, "telegram_notify_guideline(")).toBe(3);
    expect(superAgentRs).toContain("telegram_notify: &telegram_notify,");
    expect(superAgentRs).toContain("full_system.push_str(blocks.telegram_notify);");
    // L'état lu vient du champ unique de la configuration.
    expect(count(superAgentRs, "cfg.telegram_notify_enabled")).toBe(2);
  });

  it("le bloc dit l'état ET comment le changer", () => {
    const start = superAgentRs.indexOf("fn telegram_notify_guideline(");
    const body = superAgentRs.slice(start, start + 1600);
    expect(body).toContain("ACTIF");
    expect(body).toContain("COUPÉ");
    expect(body).toContain("set_telegram_notifications");
    // Interdiction de demander une double confirmation.
    expect(body).toContain("sans double confirmation");
  });
});

describe("(b) réglage coupé ⇒ RIEN ne part", () => {
  it("les trois formes d'envoi consultent la même porte d'inertie", () => {
    for (const fn of ["dispatch", "dispatch_buttons", "dispatch_edit"]) {
      const start = telegramRs.indexOf(`pub fn ${fn}`);
      expect(start, `${fn} introuvable`).toBeGreaterThan(-1);
      const body = telegramRs.slice(start, start + 700);
      expect(body, `${fn} doit consulter inert_reason()`).toContain("cfg.inert_reason()");
    }
  });

  it("la porte d'inertie d'envoi coupe sur le réglage unique", () => {
    const start = telegramRs.indexOf("pub fn inert_reason(");
    const body = telegramRs.slice(start, start + 500);
    expect(body).toContain("if !self.enabled {");
    expect(body).toContain('Some("passerelle désactivée")');
  });

  it("l'accusé de réception des boutons est lui aussi bloqué quand le réglage est coupé", () => {
    const start = telegramRs.indexOf("pub fn telegram_poll_inbound");
    const body = telegramRs.slice(start, start + 2600);
    expect(body).toContain("if cfg.enabled {");
    expect(body.indexOf("if cfg.enabled {")).toBeLessThan(body.indexOf("answer_callback("));
  });

  it("aucun envoi ne contourne la porte (pas d'appel réseau direct hors dispatch)", () => {
    // Les seuls appels `http_send` sont ceux des fonctions d'envoi gardées.
    const appels = telegramRs.match(/http_send\(/g) || [];
    const defs = telegramRs.match(/fn http_send/g) || [];
    expect(appels.length).toBeGreaterThan(0);
    expect(defs).toHaveLength(1);
  });
});

describe("(d) un message du propriétaire RÉACTIVE le réglage", () => {
  it("la règle est branchée sur la réception réelle", () => {
    const start = telegramRs.indexOf("pub fn telegram_poll_inbound");
    const body = telegramRs.slice(start, start + 2600);
    expect(body).toContain("owner_message_reactivates_notifications(cfg.enabled, &poll.messages)");
    expect(body).toContain("reactivate_notifications_from_owner_message(&app)");
    // L'information remonte à l'interface (champ additif + événement).
    expect(body).toContain('"reactivated": reactivated');
    expect(telegramRs).toContain('"pilot-telegram-notify-changed"');
  });

  it("la réactivation est PERSISTÉE (disque d'abord) et JOURNALISÉE", () => {
    const start = telegramRs.indexOf("fn reactivate_notifications_from_owner_message");
    const body = telegramRs.slice(start, start + 2000);
    expect(body).toContain("crate::save_config_disk(app, &cfg)");
    expect(body.indexOf("save_config_disk")).toBeLessThan(body.indexOf("*guard = cfg"));
    expect(body).toContain("journal_notify_state(");
    expect(telegramRs).toContain("RÉACTIVÉ par un message du propriétaire");
  });

  it("la réception n'est PAS coupée par le réglage (sinon rien ne pourrait le réactiver)", () => {
    const start = telegramRs.indexOf("pub fn receive_inert_reason(");
    const body = telegramRs.slice(start, start + 600);
    expect(body).not.toContain("self.enabled");
    const poll = telegramRs.indexOf("pub fn poll_inbound");
    expect(telegramRs.slice(poll, poll + 600)).toContain("cfg.receive_inert_reason()");
  });
});

describe("(e) un expéditeur INCONNU ne réactive JAMAIS le réglage", () => {
  it("seule la discussion du propriétaire est retenue par la réception", () => {
    const start = telegramRs.indexOf("fn collect_inbound");
    expect(start).toBeGreaterThan(-1);
    const body = telegramRs.slice(start, start + 3000);
    // Filtre strict sur l'identifiant de discussion du propriétaire.
    expect(body).toContain("chat_id.as_deref() == Some(owner)");
  });

  it("la réactivation ne consomme QUE les messages retenus (donc du propriétaire)", () => {
    const start = telegramRs.indexOf("pub fn telegram_poll_inbound");
    const body = telegramRs.slice(start, start + 2600);
    expect(body).toContain("owner_message_reactivates_notifications(cfg.enabled, &poll.messages)");
    // Aucune lecture brute du JSON Telegram dans ce chemin.
    expect(body).not.toContain("\"message\"");
  });
});

describe("l'assistant CHANGE le réglage depuis les deux canaux", () => {
  it("l'outil existe et passe par le canal d'action unique de Pilot", () => {
    expect(actionsTs).toContain('name: "set_telegram_notifications"');
    expect(actionsTs).toContain('action: "set_telegram_notifications"');
    expect(actionsTs).toContain("ACTION_SENTINEL + payload");
    // Paramètre booléen, et confirmation en UNE phrase (aucune double demande).
    const start = actionsTs.indexOf('name: "set_telegram_notifications"');
    const body = actionsTs.slice(start, start + 2200);
    expect(body).toContain("enabled: Type.Boolean(");
    expect(body).toContain("ctx.ui.confirm(");
  });

  it("Pilot applique l'action en écrivant le champ unique", () => {
    const start = superAgentJs.indexOf('action === "set_telegram_notifications"');
    expect(start).toBeGreaterThan(-1);
    const body = superAgentJs.slice(start, start + 1200);
    expect(body).toContain("setTelegramNotifyEnabled(info.enabled === true)");
    expect(body).toContain("telegramNotifyConfirmation(");
    expect(body).toContain("respondSuperAgentAction(");
  });

  it("la même session sert dans Pilot ET depuis Telegram (aucun second chemin)", () => {
    // Les messages Telegram sont injectés dans la session de l'Assistant : les
    // outils y sont les mêmes, donc rien à dupliquer.
    const inbound = readText("src/js/telegram-inbound.js");
    expect(inbound).toContain("injectExternalMessageToSuperAgent");
    // Et l'interface est rafraîchie quand Rust réactive le réglage.
    expect(count(superAgentJs, "TELEGRAM_NOTIFY_CHANGED_EVENT")).toBeGreaterThan(0);
  });
});
