// telegram-comme-vocal.test.js — UNE DEMANDE VENUE DE TELEGRAM EST TRAITÉE
// COMME UNE DEMANDE DE L'ÉCRAN VOCAL.
//
// Décision du propriétaire (2026-11) : le mode vocal est « parfait » (vraie
// discussion, réponses courtes et essentielles, conversation qui continue).
// Il veut EXACTEMENT le même comportement quand il écrit à son bot Telegram.
//
// Ce fichier verrouille les deux moitiés de cette décision, et échoue si l'une
// des deux est perdue :
//   1. BRIÈVETÉ — la demande Telegram reçoit la MÊME consigne que le mode Vocal,
//      au MÊME niveau réglé, construite par la MÊME source (`vocal-brevity.js`).
//      Une seconde consigne « Telegram » recopiée quelque part ferait échouer
//      ces tests ;
//   2. CONTINUITÉ — le message est remis comme un TOUR DE CONVERSATION
//      (`OWNER_MESSAGE_KIND`), jamais comme un compte rendu à classer : Rust ne
//      le recadre pas en « [Résumé de session] », et la nature survit au rejeu
//      d'une remise différée.
//
// Le module `super-agent.js` est importé pour de vrai (harnais DOM minimal,
// transport Tauri simulé) : on vérifie le comportement, pas une copie du code.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// `super-agent.js` est un module d'UI : il touche `window` à l'évaluation du
// module. On installe donc un `window` minimal AVANT son import.
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

/** Configuration lue par le chemin Telegram (niveau réglé). */
const NIVEAU_REGLE = "moyenne";

const invocations = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd, args) => {
    invocations.push([cmd, args]);
    if (cmd === "get_config") return { vocal_brevity_level: NIVEAU_REGLE };
    if (cmd === "inject_session_summary") return { status: "delivered", detail: "ok" };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));

import { injectExternalMessageToSuperAgent } from "./super-agent.js";
import {
  VOCAL_BREVITY_DEFAULT_LEVEL,
  VOCAL_BREVITY_ORIGIN_TELEGRAM,
  VOCAL_BREVITY_ORIGIN_VOCAL,
  composeTelegramPrompt,
  composeVocalPrompt,
  normalizeVocalBrevityLevel,
  vocalBrevityInstruction,
} from "./vocal-brevity.js";
import { OWNER_MESSAGE_KIND } from "./telegram-messages.js";

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/** Dernier argument envoyé à `inject_session_summary`. */
function remiseInjection() {
  const call = [...invocations].reverse().find(([cmd]) => cmd === "inject_session_summary");
  return call ? call[1] : null;
}

beforeEach(() => {
  invocations.length = 0;
});

// ── 1. La MÊME consigne de brièveté que le mode vocal ────────────────────
describe("un message Telegram reçoit la consigne de brièveté du mode vocal", () => {
  it("le message remis porte la MÊME consigne, au MÊME niveau réglé", async () => {
    const demande = "Où en est le projet ?";
    await injectExternalMessageToSuperAgent(demande);

    const remise = remiseInjection();
    expect(remise, "le message doit être remis à l'assistant").not.toBeNull();

    // La consigne attendue est celle du mode vocal, canal Telegram.
    const attendu = composeTelegramPrompt(demande, {
      niveau: normalizeVocalBrevityLevel(NIVEAU_REGLE),
    });
    expect(remise.summary).toBe(attendu);
    // Et elle CONTIENT la consigne réelle du niveau réglé (pas le défaut).
    expect(remise.summary).toContain(
      vocalBrevityInstruction(NIVEAU_REGLE, VOCAL_BREVITY_ORIGIN_TELEGRAM)
    );
    // La demande reste INTACTE en tête du message.
    expect(remise.summary.startsWith(demande)).toBe(true);
    // Le niveau réglé est bien celui lu, jamais une valeur écrite en dur.
    expect(NIVEAU_REGLE).not.toBe(VOCAL_BREVITY_DEFAULT_LEVEL);
    expect(remise.summary).not.toBe(
      composeTelegramPrompt(demande, { niveau: VOCAL_BREVITY_DEFAULT_LEVEL })
    );
  });

  it("les règles de longueur sont IDENTIQUES à celles du mode vocal", () => {
    // Même consigne mot pour mot : seul l'en-tête dit la vérité du canal. Si
    // quelqu'un recopiait une consigne « Telegram » séparée, ces égalités
    // tomberaient.
    for (const niveau of ["tres-courte", "courtes", "moyenne", "detaillees"]) {
      const vocal = vocalBrevityInstruction(niveau, VOCAL_BREVITY_ORIGIN_VOCAL);
      const telegram = vocalBrevityInstruction(niveau, VOCAL_BREVITY_ORIGIN_TELEGRAM);
      // Les règles (à partir de la 3e ligne) sont identiques, ainsi que la
      // clause de développement et les exceptions.
      expect(telegram.split("\n").slice(2)).toEqual(vocal.split("\n").slice(2));
      // Et la consigne demande bien la brièveté demandée par le propriétaire.
      expect(telegram).toMatch(/PHRASES? AU PLUS|phrase/i);
    }
  });

  it("hors mode vocal ET hors Telegram, la demande reste INCHANGÉE", () => {
    // Aucun autre écran ne change de comportement.
    expect(composeVocalPrompt("Bonjour", { modeVocal: false })).toBe("Bonjour");
    expect(composeVocalPrompt("Bonjour", {})).toBe("Bonjour");
    // Le mode vocal, lui, reçoit toujours SA consigne.
    expect(composeVocalPrompt("Bonjour", { modeVocal: true, niveau: "courtes" })).toContain(
      vocalBrevityInstruction("courtes", VOCAL_BREVITY_ORIGIN_VOCAL)
    );
  });

  it("aucun niveau ni aucune consigne n'est recopié ailleurs (une seule source)", () => {
    const brevity = lire("./vocal-brevity.js");
    expect((brevity.match(/export function vocalBrevityInstruction\(/g) || [])).toHaveLength(1);
    // L'en-tête Telegram existe UNE fois, dans vocal-brevity.js, et nulle part
    // ailleurs (pas de seconde consigne divergente).
    for (const nom of ["super-agent.js", "telegram-inbound.js", "telegram-dialog.js"]) {
      const src = lire(`./${nom}`);
      expect(src, nom).not.toContain("## Conversation Telegram — répondre court");
    }
    // Le chemin Telegram n'écrit jamais un niveau en dur.
    const superSrc = lire("./super-agent.js");
    expect(superSrc).not.toContain('"tres-courte"');
    expect(superSrc).not.toContain('"detaillees"');
  });
});

// ── 2. La continuité de conversation ─────────────────────────────────────
describe("le message Telegram est un TOUR DE CONVERSATION, pas un compte rendu", () => {
  it("la remise porte la nature « message du propriétaire »", async () => {
    await injectExternalMessageToSuperAgent("Tu te souviens de notre discussion ?");
    const remise = remiseInjection();
    expect(remise.kind).toBe(OWNER_MESSAGE_KIND);
    // Aucun projet : le message reste dans LA conversation de l'assistant
    // (un projet n'est pas ouvert par un message entrant).
    expect(remise.projectPath).toBeNull();
    // Le texte remis n'est pas emballé dans le gabarit « résumé de session ».
    expect(remise.summary).not.toContain("[Résumé de session]");
    expect(remise.summary).not.toContain("Intègre ces informations dans ton suivi");
  });

  it("Rust ne recadre PAS un message du propriétaire (il le verse tel quel)", () => {
    const rust = lire("../../src-tauri/src/super_agent.rs");
    const debut = rust.indexOf(
      "fn build_injection_message(project_path: Option<&str>, summary: &str, kind: &str) -> String {"
    );
    expect(debut, "le cadrage doit exister").toBeGreaterThan(-1);
    const corps = rust.slice(debut, debut + 900);
    // Le tour de conversation sort AVANT le gabarit de résumé.
    expect(corps).toContain("if kind == OWNER_MESSAGE_KIND {");
    expect(corps).toContain("return summary.to_string();");
    // Le gabarit historique du compte rendu est toujours là (aucune régression).
    expect(corps).toContain("[Résumé de session] Projet:");
    // La valeur de la nature est UNE constante, partagée avec l'interface.
    expect(rust).toContain('pub(crate) const OWNER_MESSAGE_KIND: &str = "owner-message";');
    expect(lire("./telegram-messages.js")).toContain('export const OWNER_MESSAGE_KIND = "owner-message";');
  });

  it("la nature est relue dans la boîte durable : un rejeu ne dénature pas le message", () => {
    const rust = lire("../../src-tauri/src/super_agent.rs");
    // Le rejeu passe par `deliver_one_summary`, qui relit la nature de la ligne.
    expect(rust).toContain("let kind = session_summary_kind(conn, id);");
    expect(rust).toContain("build_capped_injection_message(project_path.as_deref(), summary, &kind)");
    // La colonne est une migration ADDITIVE et idempotente (aucune perte).
    expect(rust).toMatch(/ensure_column\(\s*conn,\s*"session_summaries",\s*"kind",/);
    // Une nature inconnue retombe sur le compte rendu (aucune invention).
    expect(rust).toContain("fn normalize_summary_kind(kind: Option<&str>) -> &'static str {");
  });

  it("le message part par la MÊME porte durable que les comptes rendus", () => {
    const src = lire("./super-agent.js");
    const debut = src.indexOf("export async function injectExternalMessageToSuperAgent(text) {");
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, debut + 2000);
    expect(corps).toContain("await superAgentReportGate.deliver({");
    // La nature et le texte affiché accompagnent la remise (la consigne est
    // pour l'agent, pas pour l'humain).
    expect(corps).toContain("kind: OWNER_MESSAGE_KIND,");
    expect(corps).toContain("displaySummary: demande,");
    // Aucun second chemin d'envoi : jamais d'invoke direct dans ce corps.
    expect(corps).not.toContain('invoke("inject_session_summary"');
  });
});

// ── 3. Les exceptions se disent ENTIÈREMENT ───────────────────────────────
describe("une panne, un refus, une erreur, une demande de confirmation se disent en entier", () => {
  it("la consigne du niveau réglé excepte ces cas de la brièveté", () => {
    for (const niveau of ["tres-courte", "courtes", "moyenne", "detaillees"]) {
      const consigne = vocalBrevityInstruction(niveau, VOCAL_BREVITY_ORIGIN_TELEGRAM);
      expect(consigne).toMatch(/panne|refus|erreur|confirmation/i);
      expect(consigne).toMatch(/entier|en entier|entière|complète/i);
    }
  });

  it("côté envoi, une alerte n'est plus coupée à 150 caractères", () => {
    // Une panne dite en entier : la borne d'un message d'alerte laisse la place
    // à la cause ET à la décision attendue.
    const messages = lire("./telegram-messages.js");
    expect(messages).toMatch(/export const MAX_ALERT_CHARS = 300;/);
    // La phrase de l'Assistant n'est plus bornée à 200 caractères : une réponse
    // brève du mode vocal arrive entière (le découpage ne sert qu'à la limite).
    expect(messages).toContain("export const MAX_ASSISTANT_CHARS = TELEGRAM_PART_CHARS;");
    expect(messages).toMatch(/export const TELEGRAM_PART_CHARS = 3000;/);
  });
});

// ── 4. La brièveté est LEVÉE sur demande explicite ─────────────────────────
//
// Précision du propriétaire (2026-11) : la brièveté est le DÉFAUT, mais elle ne
// vaut QUE tant qu'il ne demande pas le détail. Dès qu'il demande explicitement
// plus de détails (« détaille », « explique », « pourquoi », « comment »,
// « donne-moi le détail »), la règle de longueur NE S'APPLIQUE PLUS et Pilot
// développe AUTANT QU'IL FAUT — et cela vaut DES DEUX CÔTÉS, Telegram comme mode
// vocal. Ces tests échouent si la consigne commune perd cette levée, ou si un
// seul canal la perdait.
describe("la brièveté ne vaut plus quand le propriétaire demande le détail", () => {
  const NIVEAUX = ["tres-courte", "courtes", "moyenne", "detaillees"];
  const ORIGINES = [VOCAL_BREVITY_ORIGIN_VOCAL, VOCAL_BREVITY_ORIGIN_TELEGRAM];

  /** La clause de développement d'une consigne (celle qui porte la levée). */
  const clauseDeveloppement = (consigne) =>
    consigne.split("\n").find((l) => l.includes("demande explicitement de développer"));

  it("les deux canaux la portent, pour les quatre niveaux", () => {
    for (const origine of ORIGINES) {
      for (const niveau of NIVEAUX) {
        const consigne = vocalBrevityInstruction(niveau, origine);
        const clause = clauseDeveloppement(consigne);
        expect(clause, `${origine}/${niveau} : la levée doit exister`).toBeTruthy();
        // Les mots que le propriétaire peut employer sont cités, y compris
        // « donne-moi le détail » (précision explicite de la mission).
        for (const mot of ["détaille", "explique", "pourquoi", "comment", "donne-moi le détail"]) {
          expect(clause, `${origine}/${niveau}/${mot}`).toContain(mot);
        }
        // La levée est NOMMÉE, et la longueur n'est plus bornée.
        expect(clause, `${origine}/${niveau}`).toMatch(/NE S'APPLIQUE PLUS/);
        expect(clause, `${origine}/${niveau}`).toMatch(/autant qu'il faut/);
        // Le développement reste une réponse PARLÉE (jamais un tableau, du code).
        expect(clause, `${origine}/${niveau}`).toMatch(/compréhensible à l'oreille/);
      }
    }
  });

  it("c'est la MÊME levée, mot pour mot, des deux côtés", () => {
    for (const niveau of NIVEAUX) {
      const vocal = vocalBrevityInstruction(niveau, VOCAL_BREVITY_ORIGIN_VOCAL);
      const telegram = vocalBrevityInstruction(niveau, VOCAL_BREVITY_ORIGIN_TELEGRAM);
      // Une seule formulation, aucune seconde consigne « Telegram » : si l'une
      // des deux la perdait, cette égalité tomberait.
      expect(clauseDeveloppement(telegram)).toBe(clauseDeveloppement(vocal));
    }
  });

  it("elle n'est JAMAIS dans l'en-tête : un canal ne peut pas la perdre seul", () => {
    for (const origine of ORIGINES) {
      const consigne = vocalBrevityInstruction(VOCAL_BREVITY_DEFAULT_LEVEL, origine);
      const entete = consigne.split("\n").slice(0, 2).join("\n");
      // Les deux premières lignes ne disent que le canal ; la levée vit dans le
      // corps commun (règles de longueur + développement + exceptions).
      expect(entete).not.toMatch(/NE S'APPLIQUE PLUS|demande explicitement de développer/);
    }
  });

  it("une demande qui demande le détail part AVEC la levée", () => {
    const demande = "Explique-moi en détail où en est le projet et pourquoi.";
    const vocal = composeVocalPrompt(demande, { modeVocal: true, niveau: "courtes" });
    const telegram = composeTelegramPrompt(demande, { niveau: "courtes" });
    for (const [canal, message] of [
      ["vocal", vocal],
      ["telegram", telegram],
    ]) {
      // La demande reste intacte en tête, et la consigne qui la suit lève la
      // brièveté : le modèle reçoit l'autorisation de développer.
      expect(message.startsWith(demande), canal).toBe(true);
      expect(message, canal).toContain(clauseDeveloppement(message));
      expect(message, canal).toMatch(/NE S'APPLIQUE PLUS/);
      expect(message, canal).toMatch(/autant qu'il faut/);
    }
  });

  it("la levée n'existe qu'UNE fois dans le source (aucune copie qui divergerait)", () => {
    const brevity = lire("./vocal-brevity.js").replace(/\r\n/g, "\n");
    // La clause EXACTE (prise dans la consigne réellement produite) n'apparaît
    // qu'une fois : c'est le texte unique de `DEVELOPPEMENT`. Deux occurrences =
    // deux formulations possibles, donc un canal qui peut perdre la levée sans
    // que l'autre s'en aperçoive.
    const clause = clauseDeveloppement(
      vocalBrevityInstruction(VOCAL_BREVITY_DEFAULT_LEVEL, VOCAL_BREVITY_ORIGIN_VOCAL)
    );
    expect(clause).toBeTruthy();
    expect(brevity.split(clause)).toHaveLength(2);
    // Aucun autre module ne recopie la levée (ni son début, ni sa portée).
    for (const nom of ["super-agent.js", "telegram-inbound.js", "telegram-dialog.js"]) {
      const src = lire(`./${nom}`).replace(/\r\n/g, "\n");
      expect(src, nom).not.toContain("demande explicitement de développer");
      expect(src, nom).not.toContain("autant qu'il faut");
    }
  });
});
