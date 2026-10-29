// telegram-notify-setting.test.js — garde-fous de l'outil UNIQUE
// « me prévenir sur Telegram » (spec_telegram.md § 14).
//
// Règle du propriétaire : UN SEUL outil, qui LIT l'état (sans argument) et le
// CHANGE (avec une valeur), et qui est la SEULE source de l'état — aucune valeur
// figée dans le prompt ni dans un bloc de contexte. Ces tests échouent si :
//   (a) il existe deux outils au lieu d'un ;
//   (b) un appel SANS argument ne renvoie pas l'état ;
//   (c) un appel AVEC une valeur ne change pas l'état ;
//   (d) une valeur figée est encore injectée dans le prompt ou le contexte ;
//   (e) l'état ne survit pas à un redémarrage ;
//   (f) un message Telegram du propriétaire ne remet pas l'état à oui ;
//   (g) un message d'un inconnu change l'état ;
//   (h) un message part alors que l'état est « non » ;
//   (i) une demande AMBIGUË (« arrête » tout seul) change le réglage.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  TELEGRAM_NOTIFY_FIELD,
  isTelegramNotifyEnabled,
  readTelegramNotifyEnabled,
  setTelegramNotifyEnabled,
  telegramNotifyConfirmation,
  telegramNotifyStateAnswer,
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

/**
 * Matière du PROMPT système d'un fichier Rust : les constantes
 * `SUPER_AGENT_*_PROMPT` et la fonction qui les assemble. C'est exactement ce
 * qui part au modèle — le reste du fichier n'est pas du prompt.
 */
function promptMaterial(src) {
  const morceaux = [];
  const re = /const SUPER_AGENT_[A-Z_]*PROMPT\s*:\s*&str\s*=/g;
  let m = re.exec(src);
  while (m) {
    const debut = m.index;
    const fin = src.indexOf("\nconst ", debut + 1);
    morceaux.push(src.slice(debut, fin === -1 ? src.length : fin));
    m = re.exec(src);
  }
  const a = src.indexOf("fn assemble_super_agent_system_prompt(");
  if (a >= 0) {
    const b = src.indexOf("\n}\n", a);
    morceaux.push(src.slice(a, b === -1 ? src.length : b));
  }
  return morceaux.join("\n");
}
const actionsTs = readText("src-tauri/extensions/pilot-assistant-actions.ts");
const superAgentJs = readText("src/js/super-agent.js");
const settingsJs = readText("src/js/settings.js");
const indexHtml = readText("index.html");
const settingJs = readText("src/js/telegram-notify-setting.js");

/** Nombre d'occurrences d'un motif (littéral). */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Corps de l'outil UNIQUE dans l'extension (jusqu'au `registerTool` suivant). */
function telegramToolBody() {
  const start = actionsTs.indexOf('name: "telegram_notifications"');
  expect(start, "outil telegram_notifications introuvable").toBeGreaterThan(-1);
  const next = actionsTs.indexOf("pi.registerTool({", start);
  return actionsTs.slice(start, next === -1 ? actionsTs.length : next);
}

/** Branche de l'outil dans le routage des `ctx.ui.input` de l'onglet 🧭. */
function telegramHandlerBody() {
  const start = superAgentJs.indexOf('title.startsWith(TELEGRAM_NOTIFY_SENTINEL)');
  expect(start, "branche TELEGRAM_NOTIFY_SENTINEL introuvable").toBeGreaterThan(-1);
  return superAgentJs.slice(start, start + 2200);
}

describe("outil UNIQUE « me prévenir sur Telegram » — module", () => {
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

  it("répond « OUI » ou « NON » en clair à une demande d'état", () => {
    const on = telegramNotifyStateAnswer(true);
    const off = telegramNotifyStateAnswer(false);
    expect(on).toContain("OUI");
    expect(on).not.toContain("NON");
    expect(off).toContain("NON");
    expect(off).not.toContain("OUI");
    // Compréhensible par un non-spécialiste : pas de jargon technique.
    for (const line of [on, off]) {
      expect(line).toContain("me prévenir sur Telegram");
      expect(line).not.toContain("AppConfig");
      expect(line).not.toContain("telegram_notify_enabled");
      expect(line.split("\n")).toHaveLength(1);
    }
  });

  it("LIT l'état par la commande get_config (aucune valeur inventée)", async () => {
    let asked = [];
    const on = await readTelegramNotifyEnabled({
      invokeFn: async (cmd) => {
        asked.push(cmd);
        return { telegram_notify_enabled: true };
      },
    });
    expect(asked).toEqual(["get_config"]);
    expect(on).toEqual({ ok: true, enabled: true });
    const off = await readTelegramNotifyEnabled({
      invokeFn: async () => ({ telegram_notify_enabled: false }),
    });
    expect(off).toEqual({ ok: true, enabled: false });
  });

  it("signale une lecture impossible sans inventer d'état", async () => {
    const res = await readTelegramNotifyEnabled({
      invokeFn: async () => {
        throw new Error("base indisponible");
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("base indisponible");
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

describe("le réglage n'existe QU'UNE fois", () => {
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
    // Aucun autre module ne relit le champ directement (une seule porte) : les
    // seules mentions dans super-agent.js sont des commentaires d'architecture.
    const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, "");
    expect(count(codeOnly(superAgentJs), TELEGRAM_NOTIFY_FIELD)).toBe(0);
    // Et une seule porte d'écriture : `save_config` (aucune seconde commande).
    expect(settingJs).toContain('call("save_config"');
    expect(count(settingJs, "get_config")).toBeGreaterThanOrEqual(2);
  });
});

describe("(a) UN SEUL outil, pas deux", () => {
  it("un seul outil porte le réglage dans le registre de l'assistant", () => {
    const noms = actionsTs.match(/name: "([a-z0-9_]+)"/g) || [];
    const telegram = noms.filter((n) => n.includes("telegram"));
    expect(telegram).toEqual(['name: "telegram_notifications"']);
  });

  it("l'ancien outil d'écriture séparé a disparu (aucun doublon)", () => {
    expect(actionsTs).not.toContain("set_telegram_notifications");
    expect(superAgentJs).not.toContain('"set_telegram_notifications"');
    expect(actionsTs).not.toContain("set_telegram_notification_enabled");
  });

  it("le même outil sert à LIRE et à CHANGER (un seul sentinel, un seul chemin)", () => {
    const body = telegramToolBody();
    expect(count(actionsTs, 'PILOT_ASSISTANT_TELEGRAM_NOTIFY::"')).toBe(1);
    expect(body).toContain("TELEGRAM_NOTIFY_SENTINEL");
    // Aucun second canal : l'outil ne passe plus par le confirm d'action.
    expect(body).not.toContain("ACTION_SENTINEL");
    expect(body).not.toContain("ctx.ui.confirm(");
  });
});

describe("(b) un appel SANS argument renvoie l'état", () => {
  it("le paramètre est OPTIONNEL et l'absence signifie « lire »", () => {
    const body = telegramToolBody();
    expect(body).toContain("enabled: Type.Optional(Type.Boolean(");
    // Absence de valeur → `null` transmis à Pilot (lecture seule).
    expect(body).toContain('typeof params.enabled === "boolean" ? params.enabled : null');
    expect(body).toContain("JSON.stringify({ enabled: wanted })");
  });

  it("la branche de Pilot répond l'état en clair quand rien n'est demandé", () => {
    const body = telegramHandlerBody();
    expect(body).toContain("const wanted = typeof req.enabled === \"boolean\" ? req.enabled : null;");
    expect(body).toContain("if (wanted === null) {");
    expect(body).toContain("readTelegramNotifyEnabled()");
    expect(body).toContain("telegramNotifyStateAnswer(read.enabled)");
    // L'état est bien RENVOYÉ à l'assistant (réponse de l'outil).
    expect(body).toContain("await respondSuperAgent(");
    // Une lecture n'écrit jamais.
    expect(body.indexOf("if (wanted === null) {")).toBeLessThan(
      body.indexOf("setTelegramNotifyEnabled(wanted)"),
    );
  });

  it("la description dit comment demander l'état (compréhensible sans doc)", () => {
    const body = telegramToolBody();
    expect(body).toMatch(/SANS argument/);
    expect(body).toMatch(/OUI.*NON|NON.*OUI/);
    expect(body).toContain("label: \"Me prévenir sur Telegram\"");
  });
});

describe("(c) un appel AVEC une valeur change l'état", () => {
  it("la valeur demandée est bien appliquée (jamais devinée)", () => {
    const body = telegramHandlerBody();
    expect(body).toContain("const res = await setTelegramNotifyEnabled(wanted);");
    expect(body).toContain("telegramNotifyConfirmation(res.enabled)");
    // Le nouvel état est renvoyé à l'assistant pour qu'il confirme en une ligne.
    expect(body).toContain("telegramNotifyStateAnswer(res.enabled)");
  });

  it("la description annonce le changement ET le nouvel état renvoyé", () => {
    const body = telegramToolBody();
    expect(body).toContain("enabled: true");
    expect(body).toContain("enabled: false");
    expect(body).toMatch(/nouvel état/);
  });
});

describe("(d) AUCUNE valeur figée dans le prompt ou le contexte", () => {
  it("le bloc de contexte du réglage a été retiré du prompt système", () => {
    expect(count(superAgentRs, "telegram_notify_guideline")).toBe(0);
    expect(superAgentRs).not.toContain("blocks.telegram_notify");
    expect(superAgentRs).not.toContain("telegram_notify:");
  });

  it("le prompt système ne lit plus du tout le réglage", () => {
    expect(count(superAgentRs, "telegram_notify_enabled")).toBe(0);
    // Aucune mention du réglage dans le PROMPT : la seule source est l'outil.
    // La vérification porte sur la MATIÈRE du prompt (constantes
    // `SUPER_AGENT_*_PROMPT` + leur assemblage) : le reste du fichier a le droit
    // de parler de Telegram (la nature « message du propriétaire » d'une remise
    // Telegram, par exemple), mais jamais le prompt.
    const prompt = promptMaterial(superAgentRs);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt.toLowerCase()).not.toContain("telegram");
  });

  it("la description de l'outil ne prétend plus que l'état est dans le contexte", () => {
    const body = telegramToolBody();
    expect(body).not.toContain("t'est donné à chaque échange");
    expect(body).not.toContain("ACTIF");
    expect(body).toContain("ONLY source of truth");
  });

  it("le module JS ne construit aucun texte de prompt", () => {
    expect(settingJs).not.toContain("ACTIF");
    expect(settingJs).not.toContain("guideline");
    expect(settingJs).not.toContain("system_prompt");
  });
});

describe("(e) l'état survit à un redémarrage", () => {
  it("le champ est persisté (sérialisé) et relu, avec un défaut coupé", () => {
    // Test Rust dédié : défaut coupé, écriture disque, relecture identique.
    expect(libRs).toContain("fn telegram_notify_setting_survives_restart_and_defaults_off");
    // La lecture de l'outil passe par la configuration PERSISTÉE (get_config).
    expect(settingJs).toContain('call("get_config")');
    // L'écriture de l'outil passe par save_config (fichier, pas la mémoire seule).
    expect(settingJs).toContain('call("save_config"');
  });
});

describe("(f) un message du propriétaire RÉACTIVE le réglage", () => {
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

describe("(g) un expéditeur INCONNU ne réactive JAMAIS le réglage", () => {
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

describe("(h) réglage coupé ⇒ RIEN ne part", () => {
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

describe("le même chemin dans Pilot ET depuis Telegram", () => {
  it("les messages Telegram arrivent dans la MÊME session de l'assistant", () => {
    const inbound = readText("src/js/telegram-inbound.js");
    expect(inbound).toContain("injectExternalMessageToSuperAgent");
    // Et l'interface est rafraîchie quand Rust réactive le réglage.
    expect(count(superAgentJs, "TELEGRAM_NOTIFY_CHANGED_EVENT")).toBeGreaterThan(0);
  });
});

describe("(i) une demande AMBIGUË ne change rien", () => {
  it("la description interdit d'agir sur un « arrête » tout seul (et de lire l'ambiguïté comme un oui)", () => {
    const body = telegramToolBody();
    expect(body).toMatch(/AMBIGU/i);
    // L'exemple nu qui ne doit RIEN décider.
    expect(body).toMatch(/« arrête » tout seul/);
    // La consigne est bien « ne rien appliquer puis demander »…
    expect(body).toMatch(/AUCUNE valeur/);
    expect(body).toMatch(/demande de quoi/);
    // …et jamais « ambiguïté = oui ».
    expect(body).toMatch(/ne lis jamais une ambiguïté comme un « oui »/);
  });

  it("la règle est aussi dans les consignes données au modèle (promptGuidelines)", () => {
    const body = telegramToolBody();
    expect(body).toMatch(/NEVER change the setting on an ambiguous request/);
    expect(body).toMatch(/never read ambiguity as a yes/);
  });

  it("Pilot n'applique QUE le paramètre : aucune valeur devinée depuis le texte", () => {
    const body = telegramHandlerBody();
    // La seule source de la valeur est le paramètre booléen `enabled`.
    expect(body).toContain('typeof req.enabled === "boolean" ? req.enabled : null');
    expect(count(body, "setTelegramNotifyEnabled(")).toBe(1);
    // Aucune lecture en langage naturel dans ce chemin (pas de « arrête »,
    // pas de recherche de mot dans la conversation) : une demande ambiguë
    // n'a donc aucun moyen de changer le réglage.
    expect(body).not.toMatch(/toLowerCase\(/);
    expect(body).not.toMatch(/includes\(/);
    expect(body).not.toMatch(/arrêt|arrete/i);
  });
});
