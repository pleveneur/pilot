// rendu-markdown-contenus-non-fiables.test.js — COMP-07 (revue du 2026-11-16).
//
// La discussion en direct rend le texte de l'agent SANS HTML brut
// (`html: false`, agent-pi.js / super-agent.js). L'historique des sessions 📜
// et la revue de code 🔍 réaffichent ce même genre de texte (réponse d'agent,
// éventuellement recopiée d'un fichier ou d'une page non fiable) : ils doivent
// garder la même règle — le Markdown est rendu, le HTML brut reste du TEXTE.
// La prévisualisation d'un fichier Markdown, elle, garde son contrat
// (`renderMarkdown` sans option = HTML autorisé) : hors de ce lot (XSS-01).
//
// Méthode : on MONTE réellement les écrans (faux DOM minimal, réponses Tauri
// simulées) avec le VRAI `preview.js` / markdown-it ; seul Mermaid, étranger au
// rendu testé, est neutralisé.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {} }));
vi.mock("./toast.js", () => ({ toastInfo: () => {}, toastSuccess: () => {}, toastError: () => {} }));
vi.mock("mermaid", () => ({
  default: { initialize: () => {}, mermaidAPI: { render: async () => ({ svg: "" }) } },
}));

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.selectors = new Map();
    this.all = new Map();
    this.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} };
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  removeEventListener() {}
  focus() {}
  querySelector(sel) {
    if (!this.selectors.has(sel)) {
      const el = new FakeEl("div");
      el.parent = this;
      this.selectors.set(sel, el);
    }
    return this.selectors.get(sel);
  }
  querySelectorAll(sel) {
    return this.all.get(sel) || [];
  }
  async fire(type) {
    // Snapshot: a click may re-render and register new listeners on the same node.
    for (const f of [...(this.listeners[type] || [])]) await f({ target: this, key: "", preventDefault() {} });
  }
}

function nodes(root, acc = []) {
  acc.push(root);
  for (const c of root.children) nodes(c, acc);
  for (const c of root.selectors.values()) nodes(c, acc);
  return acc;
}
const htmlOf = (root) => nodes(root).map((n) => n.innerHTML).join("\n");
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

// Texte d'agent hostile : du HTML actif au milieu d'un Markdown légitime.
const HOSTILE =
  "**Résumé** de la session\n\n" +
  '<img src=x onerror="alert(1)">\n\n' +
  "<script>alert(2)</script>\n\n" +
  '<svg onload="alert(3)"></svg> et `code`';

function assertInert(html) {
  // Le Markdown légitime est toujours rendu…
  expect(html).toContain("<strong>Résumé</strong>");
  expect(html).toContain("<code>code</code>");
  // … le HTML brut reste visible, comme TEXTE…
  // (typographer turns the quotes into curly quotes: only the prefix is fixed)
  expect(html).toContain("&lt;img src=x onerror=");
  expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  // … et n'est jamais une balise active.
  expect(html).not.toMatch(/<img/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<svg/i);
}

beforeEach(() => {
  invokeMock.mockReset();
  globalThis.document = {
    body: new FakeEl("body"),
    createElement: (t) => new FakeEl(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

describe("COMP-07 — l'historique des sessions n'exécute pas le HTML d'un message enregistré", () => {
  it("détail d'une session : Markdown rendu, HTML brut affiché comme texte", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_session_tags") return [];
      if (cmd === "search_sessions") return { indexed: true, entries: [{ id: "s1", prompt: "p" }] };
      if (cmd === "get_session_detail")
        return { entry: { id: "s1", prompt: "p" }, messages: [{ role: "assistant", text: HOSTILE }] };
      return null;
    });
    const { createSessionHistory } = await import("./session-history.js");
    const container = new FakeEl("div");
    createSessionHistory(container);
    // La liste rendue expose une session cliquable.
    const wrapper = container.children[0];
    const item = new FakeEl("div");
    item.setAttribute("data-id", "s1");
    wrapper.querySelector(".history-list").all.set(".history-item", [item]);
    await flush();
    await item.fire("click");
    await flush();
    const msgs = wrapper.querySelector(".history-detail").querySelector(".history-detail-messages");
    expect(msgs.children.length).toBe(1);
    assertInert(htmlOf(msgs));
  });
});

describe("COMP-07 — la revue de code n'exécute pas le HTML de la réponse du relecteur", () => {
  it("réponse de revue : Markdown rendu, HTML brut affiché comme texte", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_available_models_list") return ["prov/m"];
      if (cmd === "get_config") return { review_model: "prov/m" };
      if (cmd === "ask_review") return HOSTILE;
      return null;
    });
    const { createReview } = await import("./review.js");
    const container = new FakeEl("div");
    createReview(container);
    await flush();
    const wrapper = container.children[0];
    await wrapper.querySelector(".review-launch").fire("click");
    await flush();
    const messages = wrapper.querySelector(".help-messages");
    const last = messages.children[messages.children.length - 1];
    assertInert(htmlOf(last));
  });
});
