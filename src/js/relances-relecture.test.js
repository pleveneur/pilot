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
} from "./super-agent-schedule.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const JS_SOURCE = readFileSync(resolve(HERE, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");
const TELEGRAM_SOURCE = readFileSync(resolve(HERE, "telegram-inbound.js"), "utf8").replace(/\r\n/g, "\n");
const RUST_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/super_agent.rs"), "utf8").replace(/\r\n/g, "\n");
const WEB_SOURCE = readFileSync(resolve(HERE, "../../src-tauri/src/web_server.rs"), "utf8").replace(/\r\n/g, "\n");
const SPEC = readFileSync(resolve(HERE, "../../spec_super_agent.md"), "utf8").replace(/\r\n/g, "\n");
const SCHEDULE_TESTS_DOC = readFileSync(resolve(HERE, "../../tests/schedule-tests.md"), "utf8").replace(/\r\n/g, "\n");

// Découpage de source VÉRIFIÉ (2ᵉ relecture, point 2) : chaque ancre doit
// EXISTER et le fragment doit être assez long. Sans ces deux gardes, un
// `indexOf` qui ne trouve rien renvoie −1, `slice` rend une chaîne vide et
// l'assertion (`not.toContain(…)`) devient vraie par construction : c'est
// exactement le défaut relevé (« remettre la pose du drapeau dans `send()`
// laissait 20/20 verts »).
function sliceSource(src, startAnchor, endAnchor, minLen = 200) {
  const start = src.indexOf(startAnchor);
  expect(start, `ancre de début absente : ${startAnchor}`).toBeGreaterThan(-1);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  expect(end, `ancre de fin absente : ${endAnchor}`).toBeGreaterThan(start);
  const fragment = src.slice(start, end);
  expect(fragment.length, `fragment trop court (${fragment.length})`).toBeGreaterThanOrEqual(minLen);
  return fragment;
}

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
    const body = RUST_SOURCE.slice(RUST_SOURCE.indexOf("fn do_send_super_agent_prompt("));
    const fnBody = body.slice(0, body.indexOf("\n}\n"));
    expect(fnBody.length).toBeGreaterThan(500);
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
    const table = RUST_SOURCE.slice(RUST_SOURCE.indexOf("CREATE TABLE IF NOT EXISTS assistant_schedules"));
    expect(table.length).toBeGreaterThan(100);
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
    expect(TICK_FN()).toContain("items.length === 1");
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

  it("le message du lot est BORNÉ en longueur, et la troncature est DITE", () => {
    // Même plafond que le reste des injections automatiques côté Rust.
    expect(REMINDER_BATCH_MAX_CHARS).toBe(4000);
    const items = Array.from({ length: REMINDER_BATCH_MAX_ITEMS }, (_, i) => ({
      id: i + 1,
      prompt: `relance ${i + 1}\n` + "x".repeat(3000),
    }));
    const message = buildReminderInjectionMessage(items);
    expect(message.length).toBeLessThanOrEqual(REMINDER_BATCH_MAX_CHARS);
    expect(message).toMatch(/lot tronqué : \d+ caractère/);
    // Un message de taille normale n'est jamais touché.
    const short = buildReminderInjectionMessage([{ prompt: "a" }, { prompt: "b" }]);
    expect(short).not.toContain("tronqué");
    expect(short.length).toBeLessThan(REMINDER_BATCH_MAX_CHARS);
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
    // Un seul site de marquage, et il boucle sur `items` (= le lot envoyé), dans
    // le `try` qui suit l'envoi réussi.
    const marks = JS_SOURCE.split("super_agent_schedule_mark_done").length - 1;
    expect(marks).toBe(2); // 1 en commentaire, 1 en appel
    const body = TICK_FN();
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

  it("plus aucune règle périmée « 1 exécution/fire par tick » dans le code et les notes de test", () => {
    // 2ᵉ relecture, point 4 : la règle remplacée traînait encore ici et là.
    // L'ancienne formulation ne peut plus apparaître comme règle appliquée ;
    // elle n'est tolérée que CITÉE pour expliquer son remplacement (« et non … »).
    for (const phrase of [
      "1 exécution max par planification et par tick",
      "1 exécution (fire) max par planification et par tick",
      "1 fire/tick",
    ]) {
      for (const [nom, texte] of [
        ["super_agent.rs", RUST_SOURCE],
        ["tests/schedule-tests.md", SCHEDULE_TESTS_DOC],
      ]) {
        let idx = texte.indexOf(phrase);
        while (idx !== -1) {
          const avant = texte.slice(0, idx).trimEnd();
          expect(
            /et non «( |\n|\n\s*)?$/.test(avant),
            `${nom} : règle périmée posée comme appliquée → « ${phrase} »`,
          ).toBe(true);
          idx = texte.indexOf(phrase, idx + 1);
        }
      }
    }
    expect(RUST_SOURCE).toMatch(/un seul envoi par passe/i);
    expect(SCHEDULE_TESTS_DOC).toMatch(/un seul envoi par passe/i);
  });
});
