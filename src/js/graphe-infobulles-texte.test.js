// graphe-infobulles-texte.test.js — lot 9 (revue du 2026-11-16).
//
// Info-bulles de l'onglet Graphe (code-graph-view.js). force-graph remet le
// résultat des callbacks `nodeLabel` / `linkLabel` à float-tooltip, qui insère
// une CHAÎNE comme du HTML (`tooltipEl.html(content)`, float-tooltip 1.7.5,
// source lue par Hermes). Les noms, chemins, types, relations et confiances
// viennent de `graph_export`, c'est-à-dire de `.pilot/context-index.db` DANS le
// dossier du projet : ce sont des DONNÉES. Elles doivent s'afficher telles
// quelles (libellé, type, compteur, chemin, ligne) sans jamais devenir du HTML.
//
// Chemin couvert : vrai module createCodeGraphView monté, commandes Tauri
// simulées ; force-graph est remplacé par un enregistreur qui capture les
// callbacks RÉELS que le module lui passe, puis on les appelle sur les nœuds et
// liens réellement remis à `graphData`.
//
// LIMITE : ni navigateur, ni jsdom, ni vraie bibliothèque force-graph montée
// (elle exige un vrai DOM/canvas). Le survol réel n'est PAS testé ici : on
// vérifie la chaîne que le callback de production renvoie. `decodeEntities`
// tient lieu d'analyseur HTML du navigateur pour retrouver le texte affiché.
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const noop = () => {};
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || "div").toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.listeners = {};
      this.className = "";
      this.innerHTML = "";
      this.textContent = "";
      this.value = "";
      this.title = "";
      this.checked = false;
      this.bySelector = new Map();
      const classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: noop,
        contains: (c) => classes.has(c),
      };
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener() {}
    appendChild(c) {
      this.children.push(c);
      return c;
    }
    prepend(c) {
      this.children.unshift(c);
    }
    // One stable child per selector: stands in for the nodes the real
    // browser would create from the component's static markup.
    querySelector(sel) {
      if (!this.bySelector.has(sel)) this.bySelector.set(sel, new FakeEl("div"));
      return this.bySelector.get(sel);
    }
    querySelectorAll() {
      return [];
    }
  }
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  const head = new FakeEl("head");
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    addEventListener: noop,
    removeEventListener: noop,
    body: new FakeEl("body"),
    // float-tooltip (via force-graph) injects a <style> into document.head at load time.
    head,
    getElementsByTagName: () => [head],
    createTextNode: (t) => ({ nodeValue: String(t) }),
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  // force-graph stand-in: records the arguments of every chained call and
  // returns itself, so the production callbacks can be fetched afterwards.
  const calls = new Map();
  const recorder = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === "then") return undefined;
      return (...args) => {
        if (!calls.has(k)) calls.set(k, []);
        calls.get(k).push(args);
        return recorder;
      };
    },
  });
  return { FakeEl, calls, recorder };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./toast.js", () => ({ toastInfo: () => {} }));
vi.mock("force-graph", () => ({ default: () => () => H.recorder }));

import { invoke } from "@tauri-apps/api/core";
import { createCodeGraphView } from "./code-graph-view.js";

// Harmless but hostile-looking names: < > &, both kinds of quotes, and an
// already-escaped sequence that must stay literal.
const NAME = `R&D <img id="injecte" alt='v'>"x"`;
const FILE_PATH = `src/${NAME}.js`;
const FN_LABEL = `fn&lt;T&gt; <b>"gras"</b>`;
// Relation/confidence read back from the project's own database file.
const RELATION = `calls<i id="rel">"r"</i>&`;
const CONFIDENCE = `INFERRED <u>'c'</u>`;

// Bounded wait on the real condition (renderGraph awaits import("force-graph"),
// so a fixed number of timer ticks is not guaranteed to be enough).
async function waitFor(predicate, what, deadlineMs = 3000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`délai dépassé : ${what}`);
}

function lastArgs(method) {
  const list = H.calls.get(method);
  return list ? list[list.length - 1] : undefined;
}

async function mountGraph() {
  invoke.mockImplementation(async (cmd) => {
    if (cmd === "graph_status") return { exists: true, ready: true, nodes: 3, edges: 2, built_at: "2026-11-16 10:00" };
    if (cmd === "graph_export") {
      return {
        nodes: [
          { id: "file:a", label: `${NAME}.js`, kind: "file", path: FILE_PATH, line: 0 },
          { id: "function:a", label: FN_LABEL, kind: "function", path: FILE_PATH, line: 42 },
          { id: "file:b", label: "ok.js", kind: "file", path: "src/ok.js", line: 0 },
        ],
        edges: [
          { source: "function:a", target: "file:b", relation: RELATION, confidence: CONFIDENCE, path: FILE_PATH },
          { source: "file:a", target: "file:b", relation: "imports", confidence: "EXTRACTED", path: FILE_PATH },
        ],
      };
    }
    return undefined;
  });
  window._pilotProjectPath = "/home/fictif/projet";
  const wrapper = new H.FakeEl("div");
  createCodeGraphView(wrapper);
  await waitFor(() => H.calls.has("graphData"), "premier rendu du graphe");
  return wrapper;
}

beforeEach(() => {
  invoke.mockReset();
  H.calls.clear();
});

describe("code-graph-view.js — info-bulles du graphe : texte, jamais balisage", () => {
  it("nodeLabel : libellé, type, chemin et ligne affichés tels quels, sans balise interprétable", async () => {
    await mountGraph();
    const [nodeLabel] = lastArgs("nodeLabel");
    expect(nodeLabel).toBeTypeOf("function");
    const [{ nodes }] = lastArgs("graphData");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    const fileTip = nodeLabel(byId["file:a"]);
    const fnTip = nodeLabel(byId["function:a"]);
    const okTip = nodeLabel(byId["file:b"]);
    for (const tip of [fileTip, fnTip, okTip]) {
      // A string goes through float-tooltip's html(): no raw '<' may survive.
      expect(typeof tip).toBe("string");
      expect(tip).not.toContain("<");
    }
    // Full text as displayed by the browser, unchanged.
    expect(decodeEntities(fileTip)).toBe(`${NAME}.js (file) — ${FILE_PATH}`);
    expect(decodeEntities(fnTip)).toBe(`${FN_LABEL} (function) — ${FILE_PATH} L42`);
    // Ordinary names are not altered at all.
    expect(okTip).toBe("ok.js (file) — src/ok.js");
  });

  it("nodeLabel en vue par fichier : compteur de symboles et chemin conservés, sans balisage", async () => {
    const wrapper = await mountGraph();
    const aggregateEl = wrapper.querySelector("#cg-aggregate");
    aggregateEl.checked = true;
    aggregateEl.listeners.change[0]();
    await waitFor(
      () => lastArgs("graphData")[0].nodes.some((n) => n._count !== undefined),
      "rendu du graphe agrégé par fichier",
    );
    const [nodeLabel] = lastArgs("nodeLabel");
    const [{ nodes }] = lastArgs("graphData");
    const agg = nodes.find((n) => n.path === FILE_PATH);
    expect(agg._count).toBe(2);
    const tip = nodeLabel(agg);
    expect(tip).not.toContain("<");
    expect(decodeEntities(tip)).toBe(`${NAME}.js (2 symboles) — ${FILE_PATH}`);
  });

  it("linkLabel : relation et confiance lues du projet affichées telles quelles, sans balisage", async () => {
    await mountGraph();
    const [linkLabel] = lastArgs("linkLabel");
    expect(linkLabel).toBeTypeOf("function");
    const [{ links }] = lastArgs("graphData");
    const odd = links.find((l) => l.relation === RELATION);
    const plain = links.find((l) => l.relation === "imports");
    const tip = linkLabel(odd);
    expect(tip).not.toContain("<");
    expect(decodeEntities(tip)).toBe(`${RELATION} [${CONFIDENCE}]`);
    // Ordinary relation labels are not altered at all.
    expect(linkLabel(plain)).toBe("imports [EXTRACTED]");
  });
});

// Inverse of HTML text escaping, standing in for the browser's parser.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
