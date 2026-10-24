// relances-relecture.test.js — verrous des quatre défauts relevés par la
// relecture indépendante du correctif `d26717e` (« ne plus bloquer au démarrage
// de Pilot »), plus la contradiction de documentation.
//
// Chaque test échoue si la correction correspondante est neutralisée (les
// neutralisations essayées puis restaurées sont décrites dans
// RAPPORT-relances-correction-relecture.md).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  planDueReminderInjections,
  buildReminderInjectionMessage,
  formatReminderGroupNotificationLabel,
  formatReminderHoldNotice,
  createReminderHoldGuard,
  isOverdueLaggard,
  parseScheduleInstant,
  REMINDER_MAX_CONSECUTIVE_FAILURES,
  REMINDER_LAGGARD_INTERVAL_FACTOR,
} from "./super-agent-schedule.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const JS_SOURCE = readFileSync(resolve(HERE, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");
const TELEGRAM_SOURCE = readFileSync(resolve(HERE, "telegram-inbound.js"), "utf8").replace(/\r\n/g, "\n");
const RUST_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/super_agent.rs"), "utf8").replace(/\r\n/g, "\n");
const WEB_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/web_server.rs"), "utf8").replace(/\r\n/g, "\n");
const SPEC = readFileSync(resolve(HERE, "../../spec_super_agent.md"), "utf8").replace(/\r\n/g, "\n");

// Échéance SQLite (UTC, sans fuseau) telle que la renvoie `super_agent_schedule_tick`.
function dueAt(secondsAgo, extra = {}) {
  const t = new Date(Date.now() - secondsAgo * 1000);
  const iso = t.toISOString().replace("T", " ").slice(0, 19);
  return { nextFireAt: iso, ...extra };
}

describe("défaut 1 — l'engagement du propriétaire est posé par TOUS les chemins d'écriture", () => {
  it("le signal est émis par Rust, dans do_send_super_agent_prompt (saisie directe + web distant)", () => {
    expect(RUST_SOURCE).toContain('pub const SUPERAGENT_OWNER_ENGAGED_EVENT: &str = "pilot-superagent-owner-engaged";');
    expect(RUST_SOURCE).toContain("pub(crate) fn emit_owner_engaged(app: &AppHandle)");
    // Le helper commun est bien le SEUL point d'où part le signal.
    const body = RUST_SOURCE.slice(RUST_SOURCE.indexOf("fn do_send_super_agent_prompt("));
    const fnBody = body.slice(0, body.indexOf("\n}\n"));
    expect(fnBody).toContain("emit_owner_engaged(app);");
    // …et il n'est émis qu'après un envoi réussi (un envoi raté ne prouve rien).
    expect(fnBody.indexOf("send_superagent(cmd)")).toBeLessThan(fnBody.indexOf("emit_owner_engaged(app)"));
    // Un seul site d'émission dans tout le backend.
    expect(RUST_SOURCE.split("emit_owner_engaged(app)").length - 1).toBe(1);
  });

  it("le web distant passe par ce même helper (aucun chemin parallèle)", () => {
    expect(WEB_SOURCE).toContain("do_send_super_agent_prompt");
    expect(WEB_SOURCE).not.toContain("emit_owner_engaged");
  });

  it("le frontend écoute ce signal et ne pose plus l'engagement dans send()", () => {
    expect(JS_SOURCE).toContain('listen("pilot-superagent-owner-engaged"');
    const sendBody = JS_SOURCE.slice(JS_SOURCE.indexOf("export async function send("));
    const sendFn = sendBody.slice(0, sendBody.indexOf("\n  if ("));
    expect(sendFn).not.toContain("ownerEngagedThisSession = true;");
  });

  it("Telegram marque le MÊME drapeau (un seul drapeau, pas deux)", () => {
    const start = JS_SOURCE.indexOf("export async function injectExternalMessageToSuperAgent");
    const body = JS_SOURCE.slice(start, start + 600);
    expect(body).toContain("ownerEngagedThisSession = true;");
    // Le chemin Telegram existe bien et ne passe pas par Rust pour ce marquage.
    expect(TELEGRAM_SOURCE).toContain("injectExternalMessageToSuperAgent");
    // Aucun second drapeau d'engagement n'a été introduit.
    expect(JS_SOURCE).not.toContain("ownerEngagedByTelegram");
    expect(JS_SOURCE).not.toContain("ownerEngagedThisSession2");
  });

  it("un message du web ou de Telegram débloque réellement les relances retenues", () => {
    const due = [{ id: 1, prompt: "p", every: 600 }];
    const held = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: false,
      ownerEngaged: false,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(held.toInject).toHaveLength(0);
    expect(held.waitingForOwner).toBe(1);
    // Ce que fait le drapeau une fois posé (écoute Rust / marquage Telegram).
    const freed = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: false,
      ownerEngaged: true,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(freed.toInject.map((d) => d.id)).toEqual([1]);
  });
});

describe("défaut 2 — un rappel en échec n'affame plus les suivants", () => {
  const due = () => [
    { id: 10, prompt: "dix", every: 600 },
    { id: 11, prompt: "onze", every: 600 },
  ];

  it("l'échec est mémorisé en MÉMOIRE (aucune colonne ni écriture en base)", () => {
    expect(JS_SOURCE).toContain("const reminderFailureCounts = new Map();");
    expect(RUST_SOURCE).not.toMatch(/consecutive_fail/i);
    // La table des rappels n'a pas gagné de colonne d'échec.
    const table = RUST_SOURCE.slice(RUST_SOURCE.indexOf("CREATE TABLE IF NOT EXISTS assistant_schedules"));
    expect(table.slice(0, table.indexOf(");"))).not.toMatch(/fail/i);
  });

  it("le rappel qui vient d'échouer passe APRÈS celui qui n'a jamais échoué", () => {
    const plan = planDueReminderInjections({
      due: due(),
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: new Map([[10, 1]]),
      now: Date.now(),
    });
    expect(plan.toInject.map((d) => d.id)).toEqual([11]);
    expect(plan.held.map((d) => d.id)).toEqual([10]);
  });

  it("après 3 échecs consécutifs il est écarté tant qu'un autre peut partir", () => {
    const plan = planDueReminderInjections({
      due: due(),
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: { 10: REMINDER_MAX_CONSECUTIVE_FAILURES, 11: 0 },
      now: Date.now(),
    });
    expect(plan.toInject.map((d) => d.id)).toEqual([11]);
  });

  it("si tous les rappels sont écartés, ils sont retentés ENSEMBLE (aucun n'est perdu)", () => {
    const plan = planDueReminderInjections({
      due: due(),
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: new Map([
        [10, REMINDER_MAX_CONSECUTIVE_FAILURES],
        [11, REMINDER_MAX_CONSECUTIVE_FAILURES],
      ]),
      now: Date.now(),
    });
    expect(plan.toInject.map((d) => d.id)).toEqual([10, 11]);
    expect(plan.held).toHaveLength(0);
  });

  it("le ticker incrémente le compteur en cas d'échec et l'oublie en cas de succès", () => {
    expect(JS_SOURCE).toContain("reminderFailureCounts.set(d.id, (reminderFailureCounts.get(d.id) || 0) + 1);");
    expect(JS_SOURCE).toContain("reminderFailureCounts.delete(d.id);");
    expect(JS_SOURCE).toContain("reminderFailureCounts.clear();");
    // Le compteur part au plan : c'est lui qui décide de la rotation.
    expect(JS_SOURCE).toContain("failureCounts: reminderFailureCounts,");
  });
});

describe("défaut 3 — les retardataires partent groupés (un seul tour, pas N)", () => {
  it("reconnaît un retardataire au-delà de 2 × l'intervalle", () => {
    const now = Date.parse("2026-08-29T12:00:00Z");
    expect(REMINDER_LAGGARD_INTERVAL_FACTOR).toBe(2);
    // 100 s de retard pour un intervalle de 60 s → pas retardataire.
    expect(isOverdueLaggard({ every: 60, nextFireAt: "2026-08-29 11:58:20" }, now)).toBe(false);
    // 2 jours de retard pour un intervalle de 10 min → retardataire.
    expect(isOverdueLaggard({ every: 600, nextFireAt: "2026-08-27 12:00:00" }, now)).toBe(true);
    // Échéance absente ou illisible → jamais retardataire (comportement d'avant).
    expect(isOverdueLaggard({ every: 600 }, now)).toBe(false);
    expect(isOverdueLaggard({ every: 0, nextFireAt: "2026-08-27 12:00:00" }, now)).toBe(false);
  });

  it("l'échéance SQLite est lue en UTC (pas en heure locale)", () => {
    expect(parseScheduleInstant("2026-08-29 12:00:00")).toBe(Date.parse("2026-08-29T12:00:00Z"));
    expect(parseScheduleInstant("2026-08-29T12:00:00.000Z")).toBe(Date.parse("2026-08-29T12:00:00Z"));
    expect(parseScheduleInstant("")).toBeNull();
    expect(parseScheduleInstant("pas une date")).toBeNull();
  });

  it("un arriéré de relances tient dans UN SEUL envoi", () => {
    const due = [
      { id: 1, prompt: "Relire le journal", every: 600, ...dueAt(3 * 86400) },
      { id: 2, prompt: "Vérifier la file", every: 600, ...dueAt(2 * 86400) },
      { id: 3, prompt: "Faire le point", every: 600, ...dueAt(86400) },
    ];
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.mode).toBe("group");
    expect(plan.toInject.map((d) => d.id)).toEqual([1, 2, 3]);
    const message = buildReminderInjectionMessage(plan.toInject);
    expect(message).toContain("3 relances échues");
    for (const d of due) expect(message).toContain(d.prompt);
    // Le ticker n'envoie qu'UNE commande par passe, quel que soit le lot.
    const tick = JS_SOURCE.slice(JS_SOURCE.indexOf("async function scheduleTick"));
    expect(tick.slice(0, tick.indexOf("\n}\n"))).toContain("items.length === 1");
    expect(formatReminderGroupNotificationLabel(3, new Date())).toContain("3 relances");
  });

  it("une relance simplement échue part toujours seule (règle d'origine préservée)", () => {
    const due = [
      { id: 1, prompt: "a", every: 600, ...dueAt(5) },
      { id: 2, prompt: "b", every: 600, ...dueAt(5) },
    ];
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.mode).toBe("single");
    expect(plan.toInject).toHaveLength(1);
    expect(buildReminderInjectionMessage(plan.toInject)).toBe("[⏰ Rappel programmé] a");
  });

  it("Rust annonce l'échéance qui a rendu le rappel dû (`nextFireAt`)", () => {
    expect(RUST_SOURCE).toContain("next_fire_at: String,");
    expect(RUST_SOURCE).toContain('"nextFireAt": self.next_fire_at');
    expect(RUST_SOURCE).toContain(
      "+' || CAST(every AS TEXT) || ' seconds') FROM assistant_schedules",
    );
  });
});

describe("défaut 4 — la retenue n'est plus silencieuse, mais ne parle qu'une fois", () => {
  it("le garde n'annonce qu'UNE fois par session", () => {
    const guard = createReminderHoldGuard();
    expect(guard.shouldNotify(0)).toBe(false);
    expect(guard.shouldNotify(3)).toBe(true);
    for (let i = 0; i < 20; i++) expect(guard.shouldNotify(3)).toBe(false);
    // Nouvelle session → le signal peut réapparaître.
    guard.reset();
    expect(guard.shouldNotify(1)).toBe(true);
  });

  it("le texte dit quoi faire", () => {
    expect(formatReminderHoldNotice(1)).toBe("1 relance en attente — écrivez, ou activez ⚙️ → Assistant");
    expect(formatReminderHoldNotice(4)).toContain("4 relances en attente");
    expect(formatReminderHoldNotice(0)).toBe("");
  });

  it("le ticker utilise ce garde et le remet à zéro à l'ouverture de session", () => {
    expect(JS_SOURCE).toContain("const reminderHoldGuard = createReminderHoldGuard();");
    expect(JS_SOURCE).toContain("if (reminderHoldGuard.shouldNotify(plan.waitingForOwner))");
    expect(JS_SOURCE).toContain("reminderHoldGuard.reset();");
    expect(JS_SOURCE).not.toContain("reminderHoldNotified");
  });
});

describe("un rappel retenu n'est JAMAIS marqué comme exécuté", () => {
  it("le marquage ne porte que sur les rappels effectivement envoyés", () => {
    // Un seul site de marquage, et il boucle sur `items` (= le lot envoyé), dans
    // le `try` qui suit l'envoi réussi.
    const marks = JS_SOURCE.split("super_agent_schedule_mark_done").length - 1;
    expect(marks).toBe(2); // 1 en commentaire, 1 en appel
    const tick = JS_SOURCE.slice(JS_SOURCE.indexOf("async function scheduleTick"));
    const body = tick.slice(0, tick.indexOf("\n}\n"));
    expect(body).toContain("const items = plan.toInject;");
    expect(body).not.toContain("const items = due;");
    expect(body.indexOf("const items = plan.toInject;")).toBeLessThan(
      body.indexOf('invoke("super_agent_schedule_mark_done"'),
    );
    expect(body).toMatch(/for \(const d of items\) \{[\s\S]{0,120}super_agent_schedule_mark_done/);
    // Le plan ne met JAMAIS un rappel retenu dans `toInject`.
    const due = [
      { id: 1, prompt: "a", every: 600 },
      { id: 2, prompt: "b", every: 600 },
    ];
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set([2]),
      backendBusy: true,
      autoCheckStartup: false,
      ownerEngaged: false,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.toInject).toHaveLength(0);
    expect(plan.held.map((d) => d.id)).toEqual([1, 2]);
  });
});

describe("documentation — la contradiction est levée et la règle réellement appliquée est écrite", () => {
  it("la spec ne prétend plus à la fois « 1 fire » et « UNE relance par passe »", () => {
    // Les deux formulations contradictoires de l'ancienne version ont disparu.
    expect(SPEC).not.toMatch(/1 fire/);
    expect(SPEC).not.toMatch(/UNE relance livrée par passe/);
    // La règle appliquée : un seul ENVOI (donc un seul tour) par passe, un envoi
    // pouvant porter plusieurs retardataires regroupés.
    expect(SPEC).toMatch(/un seul (ENVOI|envoi) par passe/i);
    expect(SPEC).toMatch(/regroup/i);
    // Et la retenue n'est plus muette.
    expect(SPEC).toMatch(/UNE seule fois par\s+session/);
  });
});
