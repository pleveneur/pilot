/**
 * Bug « agents figés » — garde-fou : AUCUN dialogue d'extension (`ctx.ui.*`) ne
 * doit pouvoir suspendre pi indéfiniment.
 *
 * En mode RPC, `ctx.ui.input/confirm/select` émet un `extension_ui_request` sur
 * stdout puis attend un `extension_ui_response`. La promesse n'est résolue par
 * pi QUE si une option `timeout` est fournie — cf. `createDialogPromise()` dans
 * `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js` :
 *
 *     if (opts?.timeout) { timeoutId = setTimeout(() => resolve(defaultValue), opts.timeout) }
 *
 * Sans borne, un `extension_ui_request` non routé (session déjà occupée, réponse
 * perdue, session tuée avant la réponse) laissait l'appel d'outil suspendu À VIE :
 * la session restait « occupée », le verrou de run et la file d'attente du projet
 * n'étaient jamais libérés sans un arrêt manuel (cf. rapports
 * `pilot-bug-agents-bloques-diagnostic.md` / `-correctif.md`).
 *
 * Ce fichier verrouille les trois niveaux du correctif :
 *  1. `list_agent_sessions` (sentinel `PILOT_ASSISTANT_SESSIONS::`) rend la main
 *     dans le délai imparti avec une ERREUR claire quand Pilot ne répond pas ;
 *  2. démonstration de la cause : le MÊME appel, sans borne, ne rend jamais la
 *     main (le test n'est donc pas complaisant) ;
 *  3. la porte pré-écriture (`pilot-edit-gate`, chemin de démarrage d'un agent)
 *     refuse la modification (fail-closed) au lieu de suspendre la session ;
 *  4. garde-fou statique : TOUS les appels `await ctx.ui.*` des extensions
 *     passent une borne `timeout` (aucune régression possible, y compris dans
 *     une extension future).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("typebox", () => {
  const anyFn = () => ({});
  return { Type: new Proxy({}, { get: () => anyFn }) };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, "../../src-tauri/extensions");

/** Borne maximale admise pour un appel d'outil de service (assistant/agents). */
const MAX_SERVICE_TIMEOUT_MS = 5 * 60 * 1000;
/** Borne maximale admise pour une question posée à un humain. */
const MAX_HUMAN_TIMEOUT_MS = 30 * 60 * 1000;
/** Extensions qui posent une question à l'utilisateur (attente longue tolérée). */
const HUMAN_FACING = new Set(["pilot-choices.ts", "pilot-edit-gate.ts", "mcp-client.src.ts"]);
/** Extension GÉNÉRÉE (gitignorée) : sa source `mcp-client.src.ts` est vérifiée. */
const GENERATED = new Set(["pilot-mcp-client.ts"]);

/**
 * Simule `createExtensionUIContext()` de pi en mode RPC (fidèle à
 * `rpc-mode.js:47-86`) : chaque dialogue émet une requête et n'est résolu que
 * par la réponse de Pilot… ou par l'option `timeout`. `answer` renvoie la
 * réponse de « Pilot » (valeur brute), ou `undefined`/absent = Pilot ne répond
 * JAMAIS (extension_ui_request perdu : cas du bug).
 */
function createPiUi({ answer } = {}) {
  const requests = [];
  const dialog = (method, request, defaultValue) => {
    const opts = request.opts || {};
    requests.push({ method, ...request, forwardedTimeout: opts.timeout });
    return new Promise((res) => {
      // pi : borne demandée par l'extension → résolution avec la valeur par défaut.
      if (opts.timeout) setTimeout(() => res(defaultValue), opts.timeout);
      // Pilot : réponse (normalement immédiate, une fois le sentinel intercepté).
      if (answer) {
        const value = answer({ method, ...request });
        if (value !== undefined) setTimeout(() => res(value), 5);
      }
    });
  };
  const ui = {
    input: (title, placeholder, opts) =>
      dialog("input", { title, placeholder, opts }, undefined),
    select: (title, options, opts) => dialog("select", { title, options, opts }, undefined),
    confirm: (title, message, opts) => dialog("confirm", { title, message, opts }, false),
    notify: () => {},
  };
  return { ui, requests };
}

/**
 * Attend la résolution de `promise` en faisant avancer les timers simulés de
 * `ms` millisecondes. Renvoie `{ hung: true }` si la promesse n'a jamais été
 * résolue (le bug : l'appel d'outil ne rend pas la main).
 */
async function settleWithin(promise, ms) {
  let settled = false;
  const tracked = Promise.resolve(promise).then((value) => {
    settled = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(ms);
  if (!settled) return { hung: true, value: undefined };
  return { hung: false, value: await tracked };
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

function textOf(result) {
  return (result?.content || []).map((c) => c.text || "").join("\n");
}

const sessionsMod = (await import("../../src-tauri/extensions/pilot-assistant-sessions.ts")).default;
const editGateMod = (await import("../../src-tauri/extensions/pilot-edit-gate.ts")).default;

describe("bug « agents figés » : les dialogues d'extension sont bornés", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("list_agent_sessions rend une ERREUR claire au lieu de suspendre la session", async () => {
    const { tools } = loadExtension({ default: sessionsMod });
    expect(tools.list_agent_sessions, "outil list_agent_sessions enregistré").toBeTruthy();
    // Pilot ne répond JAMAIS (extension_ui_request perdu : session occupée,
    // sentinel non intercepté, réponse perdue…).
    const { ui, requests } = createPiUi();

    const call = tools.list_agent_sessions.execute("call-1", {}, undefined, undefined, { ui });
    const { hung, value } = await settleWithin(call, MAX_SERVICE_TIMEOUT_MS + 1000);

    expect(hung, "l'appel d'outil est resté suspendu : la session resterait « occupée »").toBe(false);
    const text = textOf(value);
    expect(text, "l'outil doit rendre une erreur explicite").toMatch(/annul/i);
    expect(text, "l'erreur doit dire que le délai est dépassé").toMatch(/délai/i);
    // Le mécanisme du correctif : la borne est bien transmise à pi (qui, seul,
    // peut résoudre la promesse). C'est elle qui empêche le blocage définitif.
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("input");
    expect(requests[0].title).toMatch(/^PILOT_ASSISTANT_SESSIONS::/);
    expect(requests[0].forwardedTimeout).toBeGreaterThan(0);
    expect(requests[0].forwardedTimeout).toBeLessThanOrEqual(MAX_SERVICE_TIMEOUT_MS);
  });

  it("démonstration de la cause : le MÊME appel sans borne ne rend jamais la main", async () => {
    // Réplique du code d'avant correctif : `ctx.ui.input(SENTINEL, "")`, sans
    // option `timeout` → pi n'a aucun moyen de résoudre la promesse.
    const { ui } = createPiUi();
    const call = ui.input("PILOT_ASSISTANT_SESSIONS::", "");
    const { hung } = await settleWithin(call, 24 * 60 * 60 * 1000); // 24 h simulées
    expect(hung, "sans borne, l'appel reste suspendu à vie (c'est le bug reproduit)").toBe(true);
  });

  it("Pilot qui répond normalement : l'outil rend le résultat attendu", async () => {
    const { tools } = loadExtension({ default: sessionsMod });
    const payload = '{"sessions":[{"project":"p","agent":"codeur","alive":true}]}';
    const { ui } = createPiUi({ answer: () => payload });

    const call = tools.list_agent_sessions.execute("call-2", {}, undefined, undefined, { ui });
    const { hung, value } = await settleWithin(call, 1000);

    expect(hung).toBe(false);
    expect(textOf(value)).toBe(payload);
  });

  it("porte pré-écriture (démarrage/écriture d'un agent) : refus fail-closed, jamais de suspension", async () => {
    const { hooks } = loadExtension({ default: editGateMod });
    const handlers = hooks.tool_call || [];
    expect(handlers.length, "hook tool_call enregistré").toBe(1);
    // Pilot ne répond JAMAIS au dialogue de confirmation.
    const { ui, requests } = createPiUi();

    const call = handlers[0](
      { toolName: "write", input: { path: "fichier-de-test.txt", content: "contenu" } },
      { cwd: resolve(HERE), ui }
    );
    const { hung, value } = await settleWithin(call, 11 * 60 * 1000);

    expect(hung, "la porte pré-écriture ne doit jamais suspendre la session").toBe(false);
    expect(value?.block, "absence de réponse → refus (fail-closed)").toBe(true);
    expect(String(value?.reason || "")).toMatch(/refus/i);
    expect(requests[0].forwardedTimeout).toBeGreaterThan(0);
    expect(requests[0].forwardedTimeout).toBeLessThanOrEqual(MAX_HUMAN_TIMEOUT_MS);
  });
});

// ── Garde-fou statique ────────────────────────────────────────────────────────
// Évite la régression, y compris dans une extension ajoutée plus tard : tout
// `await ctx.ui.input/confirm/select(...)` doit passer une borne `timeout`.

/** Découpe les arguments de chaque `await ctx.ui.x(...)` (parenthèses équilibrées). */
function dialogCallSites(source) {
  const sites = [];
  const callRe = /await ctx\.ui\.(input|confirm|select)\(/g;
  let match;
  while ((match = callRe.exec(source))) {
    let i = callRe.lastIndex;
    let depth = 1;
    let quote = null;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "/" && source[i + 1] === "/") {
        const nl = source.indexOf("\n", i);
        i = nl < 0 ? source.length : nl;
      } else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    const args = source.slice(callRe.lastIndex, i - 1);
    sites.push({ method: match[1], args, line: source.slice(0, match.index).split("\n").length });
  }
  return sites;
}

describe("garde-fou statique : aucun dialogue d'extension non borné", () => {
  const files = readdirSync(EXT_DIR)
    .filter((f) => f.endsWith(".ts") && !GENERATED.has(f))
    .sort();

  it("chaque `await ctx.ui.*` passe une option `timeout` finie et plafonnée", () => {
    let checked = 0;
    const problems = [];

    for (const file of files) {
      const source = readFileSync(join(EXT_DIR, file), "utf8");
      const constMatch = source.match(/const PILOT_UI_OPTS\s*=\s*\{\s*timeout:\s*([\d_]+)\s*\}/);
      const constValue = constMatch ? Number(constMatch[1].replace(/_/g, "")) : null;
      const cap = HUMAN_FACING.has(file) ? MAX_HUMAN_TIMEOUT_MS : MAX_SERVICE_TIMEOUT_MS;

      for (const site of dialogCallSites(source)) {
        checked++;
        const where = `${file}:${site.line} (ctx.ui.${site.method})`;
        let timeout = null;
        if (/\bPILOT_UI_OPTS\b/.test(site.args)) {
          if (constValue == null) {
            problems.push(`${where} : utilise PILOT_UI_OPTS mais la constante est absente`);
            continue;
          }
          timeout = constValue;
        } else {
          const inline = site.args.match(/timeout:\s*([\d_]+)/);
          if (!inline) {
            problems.push(`${where} : AUCUNE borne « timeout » — pi attendrait à vie (bug « agents figés »)`);
            continue;
          }
          timeout = Number(inline[1].replace(/_/g, ""));
        }
        if (!(timeout > 0)) problems.push(`${where} : borne invalide (${timeout} ms)`);
        else if (timeout > cap) problems.push(`${where} : borne trop longue (${timeout} ms > ${cap} ms)`);
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);
    // 48 appels bornés au moment du correctif : si ce nombre change, c'est que
    // des dialogues ont été ajoutés/retirés — vérifier qu'ils sont bien bornés.
    expect(checked).toBeGreaterThanOrEqual(48);
  });
});
