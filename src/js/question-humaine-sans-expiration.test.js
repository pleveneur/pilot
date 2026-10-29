/**
 * Défaut « une question à choix expire en silence »
 * (diagnostic : `docs/diag-question-expiree-et-texte-repete.md`).
 *
 * Rappel du défaut : `pilot-choices.ts` transmettait une échéance de 30 min
 * (`PILOT_UI_OPTS = { timeout: 1800000 }`) aux dialogues destinés à
 * l'UTILISATEUR. À l'échéance, pi détache la question (elle n'est plus attendue
 * par l'agent) et rend la main ; l'écran, lui, laissait les boutons cliquables —
 * un clic tardif partait alors dans le vide, sans un mot.
 *
 * Ce fichier tient les deux côtés de la décision, qui sont DEUX CAS DISTINCTS :
 *  1. HUMAIN — une question posée à l'utilisateur n'a AUCUNE échéance : au bout
 *     de 45 minutes simulées elle est toujours posée, et la réponse tardive est
 *     bien reçue par l'agent (l'ancienne borne est démontrée, pour que le test
 *     ne soit pas complaisant) ;
 *  2. MACHINE — un dialogue automatique / MCP garde sa borne finie et plafonnée ;
 *  3. ÉCRAN — une réponse qui ne peut plus être transmise est SIGNALÉE, jamais
 *     jetée en silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("typebox", () => {
  const anyFn = () => ({});
  return { Type: new Proxy({}, { get: () => anyFn }) };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, "../../src-tauri/extensions");

const MINUTE = 60 * 1000;
/** Ancienne borne des dialogues humains (30 min) — aujourd'hui RETIRÉE. */
const ANCIENNE_BORNE_HUMAINE_MS = 30 * MINUTE;
/** Attente simulée bien au-delà de l'ancienne borne. */
const ATTENTE_LONGUE_MS = 45 * MINUTE;
/** Plafond admis pour un dialogue de MACHINE (services de l'assistant / MCP). */
const MAX_BORNE_MACHINE_MS = 30 * MINUTE;

const choicesMod = (await import("../../src-tauri/extensions/pilot-choices.ts")).default;

function textOf(result) {
  return (result?.content || []).map((c) => c.text || "").join("\n");
}

/** Enregistre les outils/les hooks d'une extension en interceptant les appels. */
function loadExtension(mod) {
  const tools = {};
  const hooks = {};
  mod.default({
    registerTool: (def) => {
      tools[def.name] = def;
    },
    on: (event, handler) => {
      (hooks[event] = hooks[event] || []).push(handler);
    },
  });
  return { tools, hooks };
}

/**
 * Faux `ctx.ui` fidèle à pi en mode RPC (`createDialogPromise` de
 * `rpc-mode.js`) : SEULE l'option `timeout` arme une minuterie qui résout la
 * promesse avec la valeur par défaut (la question meurt) ; sans elle, la
 * question reste posée jusqu'à ce que « l'utilisateur » réponde (`answer`).
 */
function createHumanUi() {
  const requests = [];
  const resolvers = [];
  const dialog = (method, request, defaultValue) => {
    const opts = request.opts || {};
    requests.push({ method, ...request, forwardedTimeout: opts.timeout });
    return new Promise((res) => {
      if (opts.timeout) setTimeout(() => res(defaultValue), opts.timeout);
      resolvers.push(res);
    });
  };
  const ui = {
    input: (title, placeholder, opts) => dialog("input", { title, placeholder, opts }, undefined),
    select: (title, options, opts) => dialog("select", { title, options, opts }, undefined),
    confirm: (title, message, opts) => dialog("confirm", { title, message, opts }, false),
    notify: () => {},
  };
  return { ui, requests, answer: (value) => resolvers.shift()?.(value) };
}

/** Suit la résolution d'une promesse sans la consommer. */
function track(promise) {
  const state = { settled: false, value: undefined };
  const done = Promise.resolve(promise).then((value) => {
    state.settled = true;
    state.value = value;
    return value;
  });
  return { state, done };
}

describe("une question posée à un HUMAIN n'expire jamais", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Les QUATRE dialogues humains de pilot-choices (questions à choix, choix
  // multiple, confirmation, saisie libre).
  const CAS = [
    {
      tool: "ask_choice",
      method: "select",
      params: { title: "Quelle approche ?", options: ["A", "B"] },
      reponse: JSON.stringify({ selected: "B", note: "préféré" }),
      attendu: /B/,
      detail: "préféré",
    },
    {
      tool: "ask_multi_choice",
      method: "select",
      params: { title: "Lesquels ?", options: ["A", "B", "C"] },
      reponse: JSON.stringify({ selected: ["A", "C"], note: "" }),
      attendu: /A, C/,
    },
    {
      tool: "ask_confirm",
      method: "select",
      params: { title: "Confirmer ?", message: "Action importante" },
      reponse: JSON.stringify({ confirmed: true, note: "" }),
      attendu: /confirmé/i,
    },
    {
      tool: "ask_input",
      method: "input",
      params: { title: "Quel nom ?", placeholder: "" },
      reponse: "projet-test",
      attendu: /projet-test/,
    },
  ];

  for (const cas of CAS) {
    it(`${cas.tool} : aucune échéance transmise, toujours posée après 45 min, réponse tardive reçue`, async () => {
      const { tools } = loadExtension({ default: choicesMod });
      const { ui, requests, answer } = createHumanUi();
      const { state, done } = track(
        tools[cas.tool].execute("call-x", cas.params, undefined, undefined, { ui })
      );

      await vi.advanceTimersByTimeAsync(ATTENTE_LONGUE_MS);

      expect(requests, `ctx.ui.${cas.method} doit avoir été appelé une fois`).toHaveLength(1);
      expect(requests[0].method).toBe(cas.method);
      expect(
        requests[0].forwardedTimeout,
        "aucune échéance ne doit être transmise à pi (exception nommée « dialogue humain sans échéance »)"
      ).toBeUndefined();
      expect(state.settled, "une question humaine ne doit JAMAIS expirer d'elle-même").toBe(false);

      // L'utilisateur répond (très) tard : la réponse compte.
      answer(cas.reponse);
      await vi.advanceTimersByTimeAsync(10);

      expect(state.settled, "la réponse tardive doit être reçue et rendue à l'agent").toBe(true);
      const text = textOf(await done);
      expect(text).toMatch(cas.attendu);
      if (cas.detail) expect(text).toContain(cas.detail);
      expect(text, "aucune mention d'une échéance qui n'existe plus").not.toMatch(/30 min/);
    });
  }

  it("démonstration de la cause : avec l'ancienne borne de 30 min, la MÊME question mourait", async () => {
    // Réplique du comportement d'avant correctif : la question reçoit
    // `{ timeout: 1800000 }` → à l'échéance pi résout SANS réponse (undefined)
    // et l'agent reçoit « l'utilisateur n'a pas répondu », alors que l'écran
    // laisse toujours les boutons cliquables. C'est exactement le défaut.
    const { ui } = createHumanUi();
    const { state } = track(
      ui.select("Quelle approche ?", ["A", "B"], { timeout: ANCIENNE_BORNE_HUMAINE_MS })
    );

    await vi.advanceTimersByTimeAsync(ANCIENNE_BORNE_HUMAINE_MS - 1000);
    expect(state.settled, "avant l'échéance, la question est encore posée").toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(state.settled, "à l'échéance, la question meurt d'elle-même (le défaut)").toBe(true);
    expect(state.value, "pi rend la main SANS réponse : le clic tardif sera jeté").toBeUndefined();
  });
});

describe("un dialogue de MACHINE garde sa borne (deux cas distincts, jamais mélangés)", () => {
  it("pilot-choices.ts (questions humaines) ne porte plus aucune échéance chiffrée", () => {
    const source = readFileSync(join(EXT_DIR, "pilot-choices.ts"), "utf8");
    expect(source, "l'exception nommée doit être déclarée").toMatch(
      /const HUMAN_DIALOG_NO_DEADLINE\s*=\s*Object\.freeze\(\{\s*\}\)/
    );
    expect(source, "plus aucune échéance chiffrée dans les dialogues humains").not.toMatch(
      /timeout\s*:\s*\d/
    );
    expect(source, "l'ancienne constante bornée ne doit plus exister").not.toMatch(
      /const PILOT_UI_OPTS\s*=\s*\{\s*timeout/
    );
    // Les 4 dialogues passent l'exception nommée (aucun oubli de branchement).
    const usages = source.match(/HUMAN_DIALOG_NO_DEADLINE\s*[,)]/g) || [];
    expect(usages, "4 dialogues humains sans échéance (choix, multi, confirmation, saisie)").toHaveLength(4);
  });

  it("mcp-client.src.ts (dialogue automatique) garde une borne finie et plafonnée", () => {
    const source = readFileSync(join(EXT_DIR, "mcp-client.src.ts"), "utf8");
    const declared = source.match(/const PILOT_UI_OPTS\s*=\s*\{\s*timeout:\s*([\d_]+)\s*\}/);
    expect(declared, "le dialogue automatique/MCP doit déclarer une borne").toBeTruthy();
    const ms = Number(declared[1].replace(/_/g, ""));
    expect(ms).toBeGreaterThan(0);
    expect(ms, "borne de service finie et plafonnée : la machine ne doit jamais attendre à vie").toBeLessThanOrEqual(MAX_BORNE_MACHINE_MS);
    expect(source, "la borne est bien transmise à pi").toMatch(/PILOT_UI_OPTS\)/);
    expect(source, "l'exception des dialogues humains reste hors de ce fichier").not.toMatch(
      /HUMAN_DIALOG_NO_DEADLINE/
    );
  });
});

describe("écran : une réponse non transmissible est DITE, jamais jetée en silence", () => {
  const src = readFileSync(join(HERE, "super-agent.js"), "utf8").replace(/\r\n/g, "\n");

  it("la question qui n'est plus active produit un message honnête", () => {
    expect(src, "le texte honnête doit exister").toContain("const PENDING_QUESTION_INACTIVE_NOTICE");
    expect(src).toMatch(/plus active/);
    expect(src).toMatch(/n'a pas été transmise/);
  });

  it("le refus d'application de la réponse passe par ce signalement", () => {
    const start = src.indexOf("async function finishPendingQuestion(");
    expect(start, "finishPendingQuestion doit exister").toBeGreaterThan(-1);
    const end = src.indexOf("/** Signale honnêtement", start);
    expect(end, "le signalement doit suivre la fonction").toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body, "le refus d'application est bien détecté").toContain("outcome.applied === false");
    expect(body, "le refus est SIGNALÉ (plus de retour silencieux)").toMatch(
      /outcome\.applied === false\) \{\s*notifyPendingQuestionInactive\(\);/
    );
    // Le signalement réutilise le chemin EXISTANT des messages système.
    expect(src).toMatch(
      /function notifyPendingQuestionInactive\([\s\S]{0,220}?appendSystemMessage\(messagesEl, PENDING_QUESTION_INACTIVE_NOTICE\)/
    );
  });
});
