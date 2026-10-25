/**
 * Outil documentaire de l'assistant (`answer_from_documentation`) — câblage,
 * sortie honnête et plafond d'appels.
 *
 * Contexte : le bouton et l'onglet « ❓ Aide » vont disparaître ; c'est
 * l'ASSISTANT qui répondra aux questions de mode d'emploi. Ce fichier verrouille
 * le lot « l'assistant peut appeler la réponse sur la documentation » :
 *
 *  1. l'outil est DÉCLARÉ côté extensions (`pilot-assistant-doc.ts`) et ÉCRIT sur
 *     disque pour la session de l'assistant (les DEUX listes d'extensions de
 *     `agent_service.rs`) ;
 *  2. il est RELAYÉ côté interface : `super-agent.js` reconnaît le MÊME sentinel
 *     et exécute la commande du socle `ask_help_doc` (aucun second mécanisme) ;
 *  3. sa sortie est UTILE et HONNÊTE : texte de la réponse, sections de doc
 *     recoupées, et avertissement explicite quand la documentation ne dit rien ;
 *  4. le PLAFOND d'appels tient : un seul appel par tour, le deuxième est
 *     REFUSÉ avec un message clair, sans aucun appel à Pilot ; le compteur
 *     repart à zéro au début du tour suivant.
 *
 * Le point (1) + (2) échouent si l'un des deux côtés manque ou si les sentinels
 * divergent : c'est le test de câblage (rien ne sert de créer un outil que
 * l'interface n'exécute pas, ni de relayer un sentinel qu'aucun outil n'émet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `typebox` n'est pas embarqué côté front : les paramètres sont des schémas
// opaques pour ce test (même approche que les autres tests d'extensions).
vi.mock("typebox", () => {
  const anyFn = () => ({});
  return { Type: new Proxy({}, { get: () => anyFn }) };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const SUPER_AGENT_SRC = readFileSync(resolve(REPO, "src/js/super-agent.js"), "utf8").replace(/\r\n/g, "\n");
const AGENT_SERVICE_SRC = readFileSync(resolve(REPO, "src-tauri/src/agent_service.rs"), "utf8").replace(
  /\r\n/g,
  "\n",
);

const docMod = await import("../../src-tauri/extensions/pilot-assistant-doc.ts");
const {
  default: docExtension,
  DOC_SENTINEL,
  DOC_TOOL_NAME,
  DOC_MAX_CALLS_PER_TURN,
  DOC_CALL_LIMIT_MESSAGE,
  docCapDecision,
  formatDocAnswer,
  resetDocCap,
  docCallsInTurn,
} = docMod;

/** Enregistre les outils et les hooks d'une extension en interceptant les appels. */
function loadExtension(mod) {
  const tools = {};
  const hooks = {};
  mod({
    registerTool: (def) => {
      tools[def.name] = def;
    },
    on: (event, handler) => {
      (hooks[event] = hooks[event] || []).push(handler);
    },
  });
  return { tools, hooks };
}

/** Faux `ctx.ui` : renvoie immédiatement la valeur fournie et trace les appels. */
function createCtx(reply) {
  const calls = [];
  return {
    calls,
    ctx: {
      ui: {
        input: async (title, placeholder, opts) => {
          calls.push({ title, placeholder, opts });
          return typeof reply === "function" ? reply(title) : reply;
        },
      },
    },
  };
}

/** Texte rendu par un résultat d'outil pi. */
function textOf(result) {
  return (result?.content || []).map((c) => c.text || "").join("\n");
}

const ANSWER = JSON.stringify({
  answer: "Ouvre ⚙️ → Assistant pour régler la lecture des réponses.",
  cited_sections: ["Lecture des réponses"],
  insufficient: false,
  truncated: false,
});

describe("câblage — l'outil est déclaré ET relayé", () => {
  it("l'extension déclare bien l'outil, avec une seule entrée (la question)", () => {
    const { tools } = loadExtension(docExtension);
    const tool = tools[DOC_TOOL_NAME];
    expect(tool, `outil ${DOC_TOOL_NAME} déclaré par pilot-assistant-doc.ts`).toBeTruthy();
    // Une seule entrée, et c'est la question : aucun chemin de projet, aucun
    // fichier, aucun historique (l'inverse des outils de lecture de projet).
    const params = tool.parameters || {};
    const keys = Object.keys(params.properties || {});
    if (keys.length > 0) {
      expect(keys).toEqual(["question"]);
    }
    expect(tool.description).toMatch(/documentation/i);
    expect(tool.description).toMatch(/lecture seule/i);
    // L'outil ne nomme jamais de chemin de projet dans ses paramètres.
    expect(JSON.stringify(params)).not.toMatch(/projectPath|file|path/i);
  });

  it("les DEUX listes d'extensions de l'assistant écrivent le fichier (sinon l'outil n'existe pas)", () => {
    const needle = '("pilot-assistant-doc.ts", include_str!("../extensions/pilot-assistant-doc.ts"))';
    const occurrences = AGENT_SERVICE_SRC.split(needle).length - 1;
    expect(
      occurrences,
      "pilot-assistant-doc.ts doit être écrit dans write_assistant_extensions ET dans spawn_superagent_session",
    ).toBe(2);
  });

  it("le relais de l'interface reconnaît le MÊME sentinel et appelle la commande du socle", () => {
    // 1. Le sentinel émis par l'outil est bien celui que l'interface intercepte :
    //    on exige la DÉCLARATION EXACTE de la constante du relais (une simple
    //    occurrence du littéral ailleurs dans le fichier ne suffit pas — sans
    //    cela, deux sentinels divergents passeraient inaperçus).
    expect(
      SUPER_AGENT_SRC.includes(`const DOC_SENTINEL = "${DOC_SENTINEL}";`),
      `super-agent.js doit déclarer const DOC_SENTINEL = "${DOC_SENTINEL}" (même valeur que pilot-assistant-doc.ts)`,
    ).toBe(true);
    // 2. Le relais exécute la commande DÉJÀ LIVRÉE du socle (aucun second
    //    mécanisme : pas de lecture de fichier, pas de second prompt).
    const relay = SUPER_AGENT_SRC.match(
      /if \(title\.startsWith\(DOC_SENTINEL\)\) \{[\s\S]{0,900}?await respondSuperAgent\(id, JSON\.stringify\(answer\), false\);/,
    );
    expect(relay, "le relais du sentinel documentaire doit exister et répondre à pi").toBeTruthy();
    const block = relay[0];
    expect(block, "le relais doit appeler la commande du socle ask_help_doc").toMatch(
      /invoke\("ask_help_doc", \{ question \}\)/,
    );
    expect(block, "aucune seconde brique : le relais ne lance aucun autre prompt").not.toMatch(
      /ask_help\b(?!_doc)|read_file|filesystem/,
    );
  });
});

describe("sortie — utile et honnête", () => {
  it("rend le texte de la réponse et les sections de documentation recoupées", async () => {
    const { tools } = loadExtension(docExtension);
    resetDocCap();
    const { ctx, calls } = createCtx(ANSWER);
    const result = await tools[DOC_TOOL_NAME].execute("c1", { question: "Où régler la voix ?" }, undefined, undefined, ctx);
    const text = textOf(result);
    expect(text).toMatch(/Ouvre ⚙️ → Assistant/);
    expect(text).toMatch(/Sections de la documentation recoupées/);
    expect(text).toMatch(/Lecture des réponses/);
    // La question part seule : rien d'autre dans le titre que le sentinel + question.
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe(DOC_SENTINEL + "Où régler la voix ?");
  });

  it("dit clairement quand la documentation ne dit rien (au lieu d'inventer)", async () => {
    const { tools } = loadExtension(docExtension);
    resetDocCap();
    const { ctx } = createCtx(
      JSON.stringify({ answer: "", cited_sections: [], insufficient: true, truncated: false }),
    );
    const result = await tools[DOC_TOOL_NAME].execute("c2", { question: "Question hors doc" }, undefined, undefined, ctx);
    const text = textOf(result);
    expect(text, "le drapeau d'insuffisance doit être dit au modèle").toMatch(/LA DOCUMENTATION NE DIT RIEN/);
    expect(text).toMatch(/inventer/i);
    expect(text).toMatch(/Aucune section de la documentation n'a été recoupée/);
  });

  it("une erreur de Pilot est rendue honnêtement, jamais masquée", () => {
    const text = formatDocAnswer(JSON.stringify({ error: "Aucun modèle disponible" }));
    expect(text).toMatch(/RECHERCHE DOCUMENTAIRE IMPOSSIBLE/);
    expect(text).toMatch(/Aucun modèle disponible/);
    expect(text).toMatch(/inventer/i);
  });

  it("une sortie non-JSON (repli) n'est jamais perdue", () => {
    expect(formatDocAnswer("réponse brute")).toBe("réponse brute");
  });
});

describe("plafond — un seul appel par tour", () => {
  beforeEach(() => {
    resetDocCap();
  });

  it("décision pure : le premier appel passe, le deuxième est refusé avec un message clair", () => {
    expect(DOC_MAX_CALLS_PER_TURN).toBe(1);
    const first = docCapDecision(0);
    expect(first.allowed).toBe(true);
    const second = docCapDecision(1);
    expect(second.allowed).toBe(false);
    expect(second.message).toBe(DOC_CALL_LIMIT_MESSAGE);
    expect(second.message).toMatch(/déjà été utilisé pendant ce tour/i);
    expect(second.message).toMatch(/Un seul appel par tour/i);
    expect(second.message).toMatch(/inventer/i);
  });

  it("le deuxième appel d'outil du même tour est REFUSÉ sans aucun appel à Pilot", async () => {
    const { tools } = loadExtension(docExtension);
    const { ctx, calls } = createCtx(ANSWER);

    const first = await tools[DOC_TOOL_NAME].execute("t1", { question: "Comment exporter en PDF ?" }, undefined, undefined, ctx);
    expect(textOf(first)).toMatch(/Ouvre ⚙️ → Assistant/);
    expect(calls).toHaveLength(1);

    const second = await tools[DOC_TOOL_NAME].execute("t2", { question: "Et le terminal ?" }, undefined, undefined, ctx);
    const text = textOf(second);
    expect(text, "le deuxième appel doit être refusé avec le message du plafond").toBe(DOC_CALL_LIMIT_MESSAGE);
    // Aucun coût : rien n'a été envoyé à Pilot pour ce deuxième appel.
    expect(calls, "un appel refusé ne doit pas atteindre Pilot").toHaveLength(1);
    expect(docCallsInTurn()).toBe(1);
  });

  it("le tour suivant remet le plafond à zéro (hook before_agent_start)", async () => {
    const { tools, hooks } = loadExtension(docExtension);
    expect(hooks.before_agent_start, "le compteur doit être remis à zéro au début d'un tour").toBeTruthy();
    const { ctx, calls } = createCtx(ANSWER);

    await tools[DOC_TOOL_NAME].execute("t1", { question: "Comment exporter en PDF ?" }, undefined, undefined, ctx);
    const refused = await tools[DOC_TOOL_NAME].execute("t2", { question: "Question 2" }, undefined, undefined, ctx);
    expect(textOf(refused)).toBe(DOC_CALL_LIMIT_MESSAGE);

    // Nouveau tour : le hook remet le compteur à zéro.
    hooks.before_agent_start[0]({ type: "before_agent_start", prompt: "nouvelle demande" }, { ui: ctx.ui });
    expect(docCallsInTurn()).toBe(0);

    const third = await tools[DOC_TOOL_NAME].execute("t3", { question: "Et le terminal ?" }, undefined, undefined, ctx);
    expect(textOf(third)).toMatch(/Ouvre ⚙️ → Assistant/);
    expect(calls).toHaveLength(2);
  });

  it("une question vide ne consomme pas le tour et ne joint pas Pilot", async () => {
    const { tools } = loadExtension(docExtension);
    const { ctx, calls } = createCtx(ANSWER);
    const result = await tools[DOC_TOOL_NAME].execute("v1", { question: "   " }, undefined, undefined, ctx);
    expect(textOf(result)).toMatch(/Question vide/i);
    expect(calls).toHaveLength(0);
    expect(docCallsInTurn()).toBe(0);
    // Le tour reste disponible pour la vraie question.
    const next = await tools[DOC_TOOL_NAME].execute("v2", { question: "Vraie question" }, undefined, undefined, ctx);
    expect(textOf(next)).toMatch(/Ouvre ⚙️ → Assistant/);
    expect(calls).toHaveLength(1);
  });

  it("Pilot qui ne répond pas rend une erreur au lieu de suspendre la session", async () => {
    const { tools } = loadExtension(docExtension);
    const { ctx } = createCtx(null);
    const result = await tools[DOC_TOOL_NAME].execute("n1", { question: "Question" }, undefined, undefined, ctx);
    expect(textOf(result)).toMatch(/annulée/i);
    expect(textOf(result)).toMatch(/inventer/i);
  });
});
