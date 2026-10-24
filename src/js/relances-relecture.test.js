// relances-relecture.test.js — verrous des quatre défauts relevés par la
// relecture indépendante du correctif `d26717e` (« ne plus bloquer au démarrage
// de Pilot »), de la contradiction de documentation, puis des quatre points de
// la 2ᵉ relecture (`8e2ae1c`) : portée de l'engagement (Telegram onglet fermé),
// découpage de source réellement vérifiant, bornes du lot, règle périmée dans le
// code.
//
// Chaque test échoue si la correction correspondante est neutralisée (les
// neutralisations essayées puis restaurées sont décrites dans
// RAPPORT-relances-correction-relecture.md et RAPPORT-relances-2e-relecture.md).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  planDueReminderInjections,
  buildReminderInjection,
  buildReminderInjectionMessage,
  formatReminderGroupNotificationLabel,
  formatReminderHoldNotice,
  createReminderHoldGuard,
  isOverdueLaggard,
  parseScheduleInstant,
  REMINDER_MAX_CONSECUTIVE_FAILURES,
  REMINDER_LAGGARD_INTERVAL_FACTOR,
  REMINDER_BATCH_MAX_ITEMS,
  REMINDER_BATCH_MAX_CHARS,
  REMINDER_ITEM_MAX_CHARS,
} from "./super-agent-schedule.js";
// Découpage de source VÉRIFIÉ (2ᵉ relecture, point 2 ; puis 3ᵉ audit, point 4) :
// ancres obligatoires + taille minimale, dans un utilitaire RÉUTILISABLE et
// testé pour lui-même (`source-slice.test.js`). Un `indexOf` qui ne trouve rien
// rendait un fragment vide et l'assertion `not.toContain(…)` devenait vraie par
// construction.
import { sliceSource } from "./source-slice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const JS_SOURCE = readFileSync(resolve(HERE, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");
const TELEGRAM_SOURCE = readFileSync(resolve(HERE, "telegram-inbound.js"), "utf8").replace(/\r\n/g, "\n");
const RUST_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/super_agent.rs"), "utf8").replace(/\r\n/g, "\n");
const WEB_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/web_server.rs"), "utf8").replace(/\r\n/g, "\n");
const SPEC = readFileSync(resolve(HERE, "../../spec_super_agent.md"), "utf8").replace(/\r\n/g, "\n");
const SCHEDULE_TESTS_DOC = readFileSync(resolve(HERE, "../../tests/schedule-tests.md"), "utf8").replace(/\r\n/g, "\n");
const SCHEDULE_SOURCE = readFileSync(resolve(HERE, "super-agent-schedule.js"), "utf8").replace(/\r\n/g, "\n");
const SCHEDULE_TEST_SOURCE = readFileSync(resolve(HERE, "super-agent-schedule.test.js"), "utf8").replace(/\r\n/g, "\n");
const MAIN_SOURCE = readFileSync(resolve(HERE, "main.js"), "utf8").replace(/\r\n/g, "\n");

// MOTIFS de la règle PÉRIMÉE (« une relance par passe » / « 1 exécution-fire par
// tick »). Des MOTIFS, et non une liste de phrases figées : une reformulation
// (« au plus une relance déclenchée par passe », « 1 exécution/fire max par
// planification/tick ») doit être attrapée aussi (3ᵉ audit, point 2).
const MOTIFS_REGLE_PERIMEE = [
  // « au plus / une seule / qu'une / une … relance … par passe »
  /au plus (d'une|1)\s+relance[\s\S]{0,80}?par\s+passe/i,
  /une\s+relance[\s\S]{0,40}?par\s+passe/i,
  /une\s+seule?\s+relance[\s\S]{0,80}?par\s+passe/i,
  /qu'une\s+relance[\s\S]{0,80}?par\s+passe/i,
  /relance\s+livr[ée]e?\s+par\s+passe/i,
  // « 1 exécution (fire) max … par planification / par tick », « 1 fire/tick »
  /(1|une)\s+(ex[ée]cution|fire)\b[\s\S]{0,80}?par\s+(tick|planification)/i,
  /\b1\s*fire\s*\/\s*tick/i,
];

// Découpage de source VÉRIFIÉ : helper partagé `sliceSource` (source-slice.js).

const SEND_FN = () =>
  sliceSource(
    JS_SOURCE,
    "\n  async function send() {\n",
    "\n  // ── Bouton « Analyser et ranger mes données »",
    500,
  );
const TICK_FN = () =>
  sliceSource(JS_SOURCE, "async function scheduleTick() {", "\nfunction startScheduleTicker()", 500);
const TICKER_FN = () =>
  sliceSource(JS_SOURCE, "function startScheduleTicker() {", "\nfunction stopScheduleTicker()", 200);


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
    const fnBody = sliceSource(
      RUST_SOURCE,
      "fn do_send_super_agent_prompt(",
      "\n}\n",
      500,
    );
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
    // Découpage VÉRIFIÉ du corps de `send()` : ancres réelles + taille minimale
    // (2ᵉ relecture, point 2 : un découpage vide rendait ce verrou inopérant).
    expect(SEND_FN()).not.toContain("ownerEngagedThisSession = true;");
  });

  it("Telegram marque le MÊME drapeau (un seul drapeau, pas deux)", () => {
    const body = sliceSource(
      JS_SOURCE,
      "export async function injectExternalMessageToSuperAgent(text) {",
      "\n  await superAgentReportGate.deliver({",
      100,
    );
    expect(body).toContain("ownerEngagedThisSession = true;");
    // Le chemin Telegram existe bien et ne passe pas par Rust pour ce marquage.
    expect(TELEGRAM_SOURCE).toContain("injectExternalMessageToSuperAgent");
    // Aucun second drapeau d'engagement n'a été introduit.
    expect(JS_SOURCE).not.toContain("ownerEngagedByTelegram");
    expect(JS_SOURCE).not.toContain("ownerEngagedThisSession2");
  });

  it("parcours complet : message Telegram reçu ONGLET FERMÉ → ouverture de l'onglet → la relance part", () => {
    // 1. L'onglet de l'assistant est FERMÉ : l'écoute Telegram tourne quand
    //    même et le message est traité par `injectExternalMessageToSuperAgent`,
    //    qui marque l'engagement (source vérifiée ci-dessus).
    expect(sliceSource(
      JS_SOURCE,
      "export async function injectExternalMessageToSuperAgent(text) {",
      "\n  await superAgentReportGate.deliver({",
      100,
    )).toContain("ownerEngagedThisSession = true;");

    // 2. Il ROUVRE l'onglet : la remise à zéro de l'engagement ne doit PAS suivre
    //    l'ouverture d'un onglet (elle suit un VRAI début de session, c'est-à-dire
    //    un démarrage de Pilot). Le ticker ne touche donc plus au drapeau.
    const ticker = TICKER_FN();
    expect(ticker).toContain("reminderHoldGuard.reset();");
    expect(ticker).not.toContain("ownerEngagedThisSession");
    // …et c'est le SEUL site de remise à zéro possible en dehors de la
    // déclaration : aucune affectation `= false` ailleurs dans le fichier.
    expect(JS_SOURCE.split("ownerEngagedThisSession = false;").length - 1).toBe(1);
    expect(JS_SOURCE).toContain("let ownerEngagedThisSession = false;");

    // 3. La relance RETENUE part, sans que le propriétaire ait à réécrire.
    const due = [{ id: 7, prompt: "point hebdo", every: 600, ...dueAt(5) }];
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: false,
      ownerEngaged: true,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.toInject.map((d) => d.id)).toEqual([7]);
    expect(plan.waitingForOwner).toBe(0);
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
    const table = sliceSource(
      RUST_SOURCE,
      "CREATE TABLE IF NOT EXISTS assistant_schedules",
      ");",
      100,
    );
    expect(table).not.toMatch(/fail/i);
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
    const tick = TICK_FN();
    expect(tick.split("send_super_agent_command").length - 1).toBe(1);
    expect(formatReminderGroupNotificationLabel(3, new Date())).toContain("3 relances");
  });

  // ── 2ᵉ relecture, point 3 : le lot n'est plus sans borne ──
  it("le lot est BORNÉ en nombre : les relances en trop restent dues, jamais marquées", () => {
    expect(REMINDER_BATCH_MAX_ITEMS).toBeLessThan(20); // le plafond de planifications
    const due = Array.from({ length: REMINDER_BATCH_MAX_ITEMS + 4 }, (_, i) => ({
      id: i + 1,
      prompt: `relance ${i + 1}`,
      every: 600,
      ...dueAt(3 * 86400),
    }));
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: true,
      ownerEngaged: false,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.toInject).toHaveLength(REMINDER_BATCH_MAX_ITEMS);
    // Aucune relance n'est perdue : les 4 en trop sont RETENUES (donc dues).
    expect(plan.held).toHaveLength(4);
    expect(plan.held.map((d) => d.id)).toEqual([
      REMINDER_BATCH_MAX_ITEMS + 1,
      REMINDER_BATCH_MAX_ITEMS + 2,
      REMINDER_BATCH_MAX_ITEMS + 3,
      REMINDER_BATCH_MAX_ITEMS + 4,
    ]);
  });

  // ── 3ᵉ audit, point SÉRIEUX : la troncature du MESSAGE est rendue
  // STRUCTURELLEMENT IMPOSSIBLE (borne PAR RELANCE), et le contenu réellement
  // lisible est relié au marquage ──
  it("la troncature du message est STRUCTURELLEMENT IMPOSSIBLE : chaque relance est bornée DANS le lot", () => {
    // Cas MESURÉ par l'audit : 8 relances de 3011 caractères. Avant correctif,
    // le message faisait 4000, annonçait « 20496 caractère(s) omis » et les 8
    // relances étaient marquées envoyées alors que seules 2 étaient lisibles.
    expect(REMINDER_BATCH_MAX_CHARS).toBe(4000);
    expect(REMINDER_ITEM_MAX_CHARS).toBeLessThan(REMINDER_BATCH_MAX_CHARS / REMINDER_BATCH_MAX_ITEMS);
    const items = Array.from({ length: REMINDER_BATCH_MAX_ITEMS }, (_, i) => ({
      id: i + 1,
      prompt: `relance ${i + 1}\n` + "x".repeat(3000),
    }));
    const injection = buildReminderInjection(items);
    const message = injection.message;
    // 1. le message tient sous le plafond…
    expect(Array.from(message).length).toBeLessThanOrEqual(REMINDER_BATCH_MAX_CHARS);
    // 2. … sans JAMAIS tronquer le lot (aucun avis « lot tronqué ») :
    expect(message).not.toMatch(/lot tronqué/);
    // 3. toutes les relances sont LISIBLES (chacune commence par son texte et
    //    porte, si besoin, son PROPRE avis de troncature)…
    expect(injection.delivered.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(injection.withheld).toHaveLength(0);
    for (const d of items) {
      expect(message, `relance ${d.id} absente du message`).toContain(`relance ${d.id}`);
    }
    expect((message.match(/relance tronquée : \d+ caractère/g) || []).length).toBe(
      REMINDER_BATCH_MAX_ITEMS,
    );
    // 4. et le lot maximal (8 relances + en-tête) tient TOUJOURS.
    const maxItems = Array.from({ length: REMINDER_BATCH_MAX_ITEMS }, (_, i) => ({
      id: 100 + i,
      prompt: "y".repeat(50000),
    }));
    expect(Array.from(buildReminderInjection(maxItems).message).length).toBeLessThanOrEqual(
      REMINDER_BATCH_MAX_CHARS,
    );
    // 5. Un message de taille normale n'est jamais touché.
    const short = buildReminderInjectionMessage([{ prompt: "a" }, { prompt: "b" }]);
    expect(short).not.toContain("tronqué");
    expect(short.length).toBeLessThan(REMINDER_BATCH_MAX_CHARS);
  });

  it("le contenu RÉELLEMENT LISIBLE est relié au marquage (aucune relance marquée sans être dans le message)", () => {
    // Invariant : pour toute taille de relance, la liste livrée (`delivered`) est
    // exactement celle dont le texte figure dans le message, et une relance
    // retirée (`withheld`) n'y figure pas. Le marquage ne porte que sur
    // `delivered` (vérifié ci-dessous dans le ticker).
    for (const taille of [0, 10, 440, 450, 1000, 3011, 20000]) {
      const items = Array.from({ length: REMINDER_BATCH_MAX_ITEMS }, (_, i) => ({
        id: i + 1,
        prompt: `J${i + 1}-` + "z".repeat(taille),
      }));
      const { message, delivered, withheld } = buildReminderInjection(items);
      expect(Array.from(message).length).toBeLessThanOrEqual(REMINDER_BATCH_MAX_CHARS);
      expect(delivered.length + withheld.length).toBe(items.length);
      for (const d of delivered) {
        // Le début du texte est TOUJOURS lisible…
        expect(message).toContain(d.prompt.slice(0, 4));
        // … et s'il est coupé, la coupure est DITE pour CETTE relance.
        if (taille > REMINDER_ITEM_MAX_CHARS) {
          expect(message).toMatch(/relance tronquée : \d+ caractère/);
        }
      }
      for (const d of withheld) {
        expect(message).not.toContain(d.prompt.slice(0, 6));
      }
    }
  });

  it("le ticker marque les relances LISIBLES (`injection.delivered`), jamais la liste brute du plan", () => {
    // C'est ce lien qui rend impossible de marquer « envoyée » une relance dont
    // le texte n'a pas été remis à l'assistant (défaut sérieux du 3ᵉ audit).
    const body = TICK_FN();
    expect(body).toContain("const injection = buildReminderInjection(items);");
    expect(body).toContain("const readable = injection.delivered;");
    expect(body).toContain("message: injection.message");
    // Seules les relances RÉELLEMENT remises sont mises en vol : une relance
    // retirée faute de place n'y entre pas et reste due (elle repart à la passe
    // suivante).
    expect(body).toContain("for (const d of readable) pendingReminderIds.add(d.id);");
    expect(body).not.toMatch(/for \(const d of (items|injection\.withheld)\) pendingReminderIds\.add/);
    // La boucle de marquage ne boucle PAS sur `items` (= `plan.toInject`).
    expect(body).not.toMatch(/for \(const d of items\) \{[\s\S]{0,120}?super_agent_schedule_mark_done/);
    expect(body).toMatch(/for \(const d of readable\) \{[\s\S]{0,160}?super_agent_schedule_mark_done/);
  });

  it("un rappel multi-lignes est indenté sous son numéro (pas mélangé au lot)", () => {
    const message = buildReminderInjectionMessage([
      { prompt: "ligne 1\nligne 2\n\nligne 4" },
      { prompt: "autre rappel" },
    ]);
    expect(message).toContain("1. ligne 1\n   ligne 2\n\n   ligne 4\n2. autre rappel");
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
    // Un seul site de marquage, et il boucle sur les relances RÉELLEMENT
    // LISIBLES du lot (`injection.delivered`), dans le `try` qui suit l'envoi
    // réussi (3ᵉ audit, défaut sérieux : `items` = `plan.toInject` pouvait
    // contenir des relances dont le texte avait été coupé).
    const marks = JS_SOURCE.split("super_agent_schedule_mark_done").length - 1;
    expect(marks).toBe(2); // 1 en commentaire, 1 en appel
    const body = TICK_FN();
    expect(body).toContain("const items = plan.toInject;");
    expect(body).not.toContain("const items = due;");
    expect(body.indexOf("const items = plan.toInject;")).toBeLessThan(
      body.indexOf('invoke("super_agent_schedule_mark_done"'),
    );
    expect(body).toMatch(/for \(const d of readable\) \{[\s\S]{0,160}super_agent_schedule_mark_done/);
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

  it("la PORTÉE du « une fois par session » est écrite et dit à quoi elle correspond", () => {
    // 2ᵉ relecture, point 1 : la portée réelle est la session de CONVERSATION,
    // et la spec le dit (au lieu de laisser croire à une exécution de Pilot).
    expect(SPEC).toMatch(/session de conversation/i);
    expect(SPEC).toMatch(/ouverture de l'onglet/i);
    // Et la portée de l'ENGAGEMENT (exécution de Pilot) est écrite aussi.
    expect(SPEC).toMatch(/exécution de Pilot/);
  });

  it("la spec borne le lot de relances (nombre et longueur, troncature annoncée)", () => {
    expect(SPEC).toMatch(/lot borné|lot est borné/i);
    expect(SPEC).toMatch(/4000/);
    expect(SPEC).toMatch(/troncature (est )?annoncée|tronqué/i);
  });

  it("plus aucune règle périmée « 1 exécution/fire par tick » ou « une relance par passe »", () => {
    // 2ᵉ relecture, point 4, PUIS 3ᵉ audit, point 2 : une LISTE DE PHRASES FIGÉES
    // ne voyait pas les reformulations (« au plus une relance … par passe »,
    // « 1 exécution/fire max … par planification/tick »), et seuls deux fichiers
    // étaient regardés — la même règle traînait encore dans le titre d'un test
    // et d'un groupe de tests. On cherche donc des MOTIFS, sur un périmètre
    // élargi (le module, son test, les notes de test et le code Rust).
    //
    // Seule tolérance : la CITATION de l'ancienne règle pour expliquer son
    // remplacement (« et non « … » »).
    const PERIMETRE = [
      ["src-tauri/src/super_agent.rs", RUST_SOURCE],
      ["tests/schedule-tests.md", SCHEDULE_TESTS_DOC],
      // 3ᵉ audit, point 2 : les deux occurrences oubliées vivaient ici.
      ["src/js/super-agent-schedule.test.js", SCHEDULE_TEST_SOURCE],
      ["src/js/super-agent-schedule.js", SCHEDULE_SOURCE],
      ["spec_super_agent.md", SPEC],
    ];
    for (const [nom, texte] of PERIMETRE) {
      for (const motif of MOTIFS_REGLE_PERIMEE) {
        const global = new RegExp(motif.source, motif.flags.includes("g") ? motif.flags : `${motif.flags}g`);
        let m;
        while ((m = global.exec(texte)) !== null) {
          const avant = texte.slice(0, m.index).trimEnd();
          expect(
            /et non\s*«\s*$/.test(avant),
            `${nom} : règle périmée posée comme appliquée → « ${m[0].slice(0, 80).replace(/\s+/g, " ")} »`,
          ).toBe(true);
          global.lastIndex = m.index + 1;
        }
      }
    }
    // Et la règle RÉELLEMENT appliquée est écrite là où elle doit l'être.
    expect(RUST_SOURCE).toMatch(/un seul envoi par passe/i);
    expect(SCHEDULE_TESTS_DOC).toMatch(/un seul envoi par passe/i);
    expect(SCHEDULE_TEST_SOURCE).toMatch(/un seul ENVOI par passe/i);
    expect(SPEC).toMatch(/un seul (ENVOI|envoi) par passe/i);
  });

  it("une REFORMULATION de la règle périmée est attrapée (pas seulement les phrases figées)", () => {
    // Preuve que le verrou mord sur une formulation inédite : motifs appliqués
    // à des textes de synthèse qui n'étaient dans aucune liste.
    const reformulations = [
      "Règle : au plus une relance déclenchée par passe de tick.",
      "Règle : une seule relance envoyée par passe, pour ne pas empiler les tours.",
      "Limite : 1 fire maximum par planification, et pas davantage.",
      "Garde-fou : 1 exécution/fire max par planification/tick.",
    ];
    const MOTIFS_PERIMES = MOTIFS_REGLE_PERIMEE;
    for (const texte of reformulations) {
      expect(
        MOTIFS_PERIMES.some((m) => m.test(texte)),
        `reformulation non attrapée : « ${texte} »`,
      ).toBe(true);
    }
    // …et la règle appliquée n'est PAS attrapée (aucun faux positif).
    for (const texte of [
      "un seul ENVOI par passe, un envoi pouvant porter plusieurs relances regroupées",
      "un seul ENVOI par passe : une relance simplement échue part seule, les autres restent dues",
    ]) {
      for (const m of MOTIFS_PERIMES) {
        expect(m.test(texte), `faux positif sur « ${texte} »`).toBe(false);
      }
    }
  });
});

// ── 3ᵉ audit, point 3 : prompt par ACCÈS WEB, onglet 🧭 fermé ────────────────
describe("prompt par accès web, onglet fermé : l'engagement du propriétaire n'est pas perdu", () => {
  it("l'écoute « le propriétaire a écrit » est posée AU NIVEAU DE L'APPLICATION, pas dans la fabrique de l'onglet", () => {
    // 1. L'écoute est déclarée dans une fonction de MODULE dédiée…
    const watch = sliceSource(
      JS_SOURCE,
      "export async function initOwnerEngagementWatch()",
      "\n}\n",
      200,
    );
    expect(watch).toContain('listen("pilot-superagent-owner-engaged"');
    expect(watch).toContain("ownerEngagedThisSession = true;");
    // 2. … et le CORPS de la fabrique d'onglet ne l'enregistre PLUS : c'est cet
    //    enregistrement-là, retiré à la fermeture de l'onglet, qui perdait
    //    l'évènement (émission Rust pourtant inconditionnelle).
    const factory = sliceSource(
      JS_SOURCE,
      "export async function createSuperAgent(container) {",
      "\n// Chantier #13 : ticker des relances programmées",
      5000,
    );
    expect(factory).not.toMatch(/listen\(\s*["']pilot-superagent-owner-engaged["']/);
    expect(factory).not.toContain("unlistenOwnerEngaged");
    // 3. Elle est installée au DÉMARRAGE de Pilot, comme l'écoute Telegram
    //    (modèle suivi : aucune dépendance à l'ouverture d'un onglet).
    expect(MAIN_SOURCE).toMatch(/import \{[^}]*initOwnerEngagementWatch[^}]*\} from "\.\/super-agent\.js"/);
    expect(MAIN_SOURCE).toMatch(/^[^\S\n]*void initOwnerEngagementWatch\(\);$/m);
    expect(MAIN_SOURCE).toMatch(/^[^\S\n]*initTelegramInbound\(\);$/m);
    // 4. Toujours UN SEUL drapeau, posé à deux endroits au plus (l'écoute
    //    applicative et l'arrivée Telegram) : aucun second drapeau, aucun
    //    compteur persistant.
    const poses = (JS_SOURCE.match(/ownerEngagedThisSession = true;/g) || []).length;
    expect(poses).toBe(2);
    expect(JS_SOURCE).not.toMatch(/ownerEngagedThisSession\s*\+=\s*1/);
  });

  it("prompt web pendant que l'onglet est fermé → ouverture de l'onglet → la relance part", () => {
    // Séquence réelle : (a) l'accès web distant envoie un prompt, Rust émet le
    // signal, l'écoute APPLICATIVE pose le drapeau — aucun onglet n'existe ;
    // (b) l'utilisateur ouvre l'onglet 🧭 : `startScheduleTicker` ne remet JAMAIS
    // l'engagement à zéro ; (c) la relance échue part, au lieu d'être retenue.
    let ownerEngaged = false;
    const signalRust = () => { ownerEngaged = true; }; // = l'écoute applicative

    const ticker = TICKER_FN();
    expect(ticker).not.toMatch(/ownerEngagedThisSession\s*=\s*false/);

    signalRust();
    const due = [{ id: 7, prompt: "relance web", every: 600, ...dueAt(5) }];
    const plan = planDueReminderInjections({
      due,
      pendingIds: new Set(),
      backendBusy: false,
      autoCheckStartup: false,
      ownerEngaged,
      failureCounts: new Map(),
      now: Date.now(),
    });
    expect(plan.waitingForOwner).toBe(0);
    expect(plan.held).toHaveLength(0);
    expect(plan.toInject.map((d) => d.id)).toEqual([7]);
    // Le message remis porte bien le texte de la relance, et c'est lui qui est marqué.
    const injection = buildReminderInjection(plan.toInject);
    expect(injection.message).toContain("relance web");
    expect(injection.delivered.map((d) => d.id)).toEqual([7]);

    // Sans ce signal (onglet fermé, écoute morte comme avant le correctif), la
    // relance AURAIT été retenue : c'est la contre-épreuve du parcours.
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
    expect(held.held.map((d) => d.id)).toEqual([7]);
  });
});
