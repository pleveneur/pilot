// noms-projets-fichiers-echappes.test.js — lot 7 (revue du 2026-11-16).
//
// Des NOMS venus du disque étaient insérés tels quels en HTML :
//  - code-graph-view.js : chemins des fichiers du projet (`graph_export`, issus
//    de `read_dir` côté Rust) dans les <option> du filtre par fichier ;
//  - code-graph-view.js : fichier en cours (`graph-build-progress`) dans la
//    ligne d'état « Construction du graphe… » ;
//  - vault.js : nom du dossier projet dans l'éditeur d'entrée.
// Un nom de fichier ou de dossier est une DONNÉE : sous Linux/macOS il peut
// contenir < > & et des guillemets. Il doit rester visible tel quel et la
// valeur filtrée/choisie doit rester identique, sans jamais devenir du HTML.
//
// Chemins réels couverts : vrais modules montés (createCodeGraphView,
// code-graph.js réel, createVault), commandes et événements Tauri simulés.
//
// LIMITE : pas de navigateur ni de jsdom (non embarqué par le dépôt). Le faux
// DOM ci-dessous ne parse pas le HTML : on lit la chaîne effectivement remise à
// `innerHTML` et les propriétés (`value`, `textContent`) des nœuds créés.
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const noop = () => {};
  const created = [];
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
      created.push(this);
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
  // force-graph stand-in: every chained call returns the same object.
  const chain = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? undefined : () => chain),
  });
  return { FakeEl, created, chain, progress: { handler: null }, renders: { n: 0 } };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, handler) => {
    H.progress.handler = handler;
    return () => {};
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {} }));
vi.mock("./toast.js", () => ({ toastInfo: () => {} }));
vi.mock("force-graph", () => ({ default: () => () => { H.renders.n++; return H.chain; } }));

import { invoke } from "@tauri-apps/api/core";
import { createCodeGraphView } from "./code-graph-view.js";
import { createVault } from "./vault.js";

// Harmless but hostile-looking file name: < > & and both kinds of quotes.
const NAME = `R&D <img id="injecte" alt='v'>"x"`;
const FILE_PATH = `src/${NAME}.js`;

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

// Bounded wait on the real condition: renderGraph awaits import("force-graph"),
// and a render still pending when the file ends would load the REAL module.
async function waitForGraphRendered(deadlineMs = 3000) {
  const end = Date.now() + deadlineMs;
  while (H.renders.n === 0) {
    if (Date.now() >= end) throw new Error("délai dépassé : premier rendu du graphe");
    await new Promise((r) => setTimeout(r, 0));
  }
  await flush();
}

beforeEach(() => {
  invoke.mockReset();
  H.created.length = 0;
  H.progress.handler = null;
  H.renders.n = 0;
});

describe("code-graph-view.js — les noms de fichiers du graphe restent du texte", () => {
  function graphInvoke(extra = {}) {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "graph_status") return { exists: true, ready: true, nodes: 2, edges: 1, built_at: "2026-11-16 10:00" };
      if (cmd === "graph_export") {
        return {
          nodes: [
            { id: "file:a", label: `${NAME}.js`, kind: "file", path: FILE_PATH, line: 0 },
            { id: "file:b", label: "ok.js", kind: "file", path: "src/ok.js", line: 0 },
          ],
          edges: [{ source: "file:a", target: "file:b", relation: "imports", confidence: "EXTRACTED", path: FILE_PATH }],
        };
      }
      if (cmd in extra) return extra[cmd]();
      return undefined;
    });
  }
  function mountGraph() {
    window._pilotProjectPath = "/home/fictif/projet";
    const wrapper = new H.FakeEl("div");
    createCodeGraphView(wrapper);
    return wrapper;
  }

  it("filtre par fichier : libellé et valeur identiques au nom, aucun balisage injecté, filtrage intact", async () => {
    graphInvoke();
    const wrapper = mountGraph();
    await flush();
    const fileEl = wrapper.querySelector("#cg-file-filter");
    // Not interpreted: no file name reaches the select as markup.
    expect(fileEl.innerHTML).not.toContain("<img");
    expect(fileEl.innerHTML).toContain("Tous les fichiers");
    // Readable and selectable: one option per file, value and label verbatim.
    const opts = fileEl.children.filter((c) => c.tagName === "OPTION");
    expect(opts.map((o) => o.value)).toEqual([FILE_PATH, "src/ok.js"]);
    expect(opts.map((o) => o.textContent)).toEqual([FILE_PATH, "src/ok.js"]);
    // Filtering still matches the exact path once that option is selected.
    fileEl.value = opts[0].value;
    fileEl.listeners.change[0]();
    expect(wrapper.querySelector("#cg-count").textContent).toBe("1 nœuds · 1 arêtes");
    await waitForGraphRendered();
  });

  it("construction en cours : le fichier reçu par graph-build-progress s'affiche tel quel, sans balisage", async () => {
    let finishBuild;
    graphInvoke({
      build_code_graph: () => new Promise((r) => { finishBuild = r; }),
    });
    const wrapper = mountGraph();
    await flush();
    const pending = wrapper.querySelector("#cg-rebuild").onclick();
    await flush();
    expect(H.progress.handler).toBeTypeOf("function");
    H.progress.handler({ payload: { done: 10, total: 20, file: FILE_PATH } });
    const html = wrapper.querySelector("#cg-status").innerHTML;
    // Same frame as before: spinner, label, counter, file span.
    expect(html).toContain('<span class="cg-spinner"></span> Construction du graphe… · 10/20 fichiers');
    // Not interpreted: the file name never reaches the status as a live tag.
    expect(html).not.toContain("<img");
    // Readable: the span text decodes back to the exact original path.
    const m = html.match(/<span class="cg-file">([^<]*)<\/span>/);
    expect(m).toBeTruthy();
    expect(decodeEntities(m[1])).toBe(FILE_PATH);
    finishBuild({ nodes: 2, edges: 1, files: 2, elapsed_ms: 100 });
    await pending;
    await waitForGraphRendered();
  });
});

describe("vault.js — le nom du dossier projet de l'éditeur reste du texte", () => {
  it("éditeur d'entrée : nom affiché tel quel, aucun balisage, portée projet et chemin envoyés inchangés", async () => {
    // Fictional project folder; a folder name holds no path separator.
    const projectPath = `/home/fictif/${NAME}`;
    window._pilotProjectPath = projectPath;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "vault_status") return { initialized: true, unlocked: true };
      if (cmd === "vault_list") return [];
      if (cmd === "vault_add") return [];
      return undefined;
    });
    const container = new H.FakeEl("div");
    createVault(container);
    await flush();
    container.querySelector("#vault-add-btn").listeners.click[0]();
    const html = container.querySelector("#vault-body").innerHTML;
    // Form frame unchanged: both scope radios are still there.
    expect(html).toContain('<input type="radio" name="vault-scope" value="global" checked> 🌐 Global (tous les projets)</label>');
    expect(html).toContain('<input type="radio" name="vault-scope" value="project" > 📁 Projet : ');
    // Not interpreted: the folder name never reaches the form as a live tag.
    expect(html).not.toContain("<img");
    // Readable: the label text decodes back to the exact folder name.
    const m = html.match(/📁 Projet : ([^<]*)<\/label>/);
    expect(m).toBeTruthy();
    expect(decodeEntities(m[1])).toBe(NAME);
    // Choosing the project scope still sends the untouched project path.
    container.querySelector("#vault-f-desc").value = "Serveur fictif";
    container.querySelector('input[name="vault-scope"]:checked').value = "project";
    await container.querySelector("#vault-save-btn").listeners.click[0]();
    expect(invoke).toHaveBeenCalledWith("vault_add", {
      entry: expect.objectContaining({ scope: "project", projectPath, description: "Serveur fictif" }),
    });
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
