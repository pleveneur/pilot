// tableau-de-bord-noms-echappes.test.js — COMP-06 (revue du 2026-11-16).
//
// Le tableau de bord 📊 affiche des noms et chemins de fichiers DU PROJET
// (fichiers les plus lourds, derniers fichiers modifiés, éléments purgeables),
// ainsi que des noms de branche, de projet et des messages d'erreur. Ce sont des
// DONNÉES : un dépôt non fiable peut contenir un fichier nommé
// `<img src=x onerror=…>` (nom valide sous Linux et macOS). Ces données doivent
// s'afficher telles quelles, jamais devenir du HTML actif.
//
// Méthode : on MONTE réellement `createDashboard` sur un faux DOM minimal (le
// dépôt n'embarque pas de jsdom), avec des réponses Tauri simulées, puis on lit
// le HTML effectivement remis au navigateur (`innerHTML` de chaque nœud).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {} }));

// ── Faux DOM minimal ───────────────────────────────────────────────────────
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.disabled = false;
    this.checked = false;
    this.selectors = new Map();
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c) || String(this.className).split(/\s+/).includes(c),
      toggle: () => {},
    };
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c, ref) {
    c.parent = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  get firstChild() {
    return this.children[0] || null;
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
  // Un élément stable par sélecteur (suffit aux `querySelector` du module).
  querySelector(sel) {
    if (!this.selectors.has(sel)) {
      const el = new FakeEl("div");
      el.parent = this;
      this.selectors.set(sel, el);
    }
    return this.selectors.get(sel);
  }
  querySelectorAll() {
    return [];
  }
  async fire(type) {
    for (const f of this.listeners[type] || []) await f({ target: this });
  }
}

/** Tous les nœuds du sous-arbre (enfants + éléments obtenus par sélecteur). */
function nodes(root, acc = []) {
  acc.push(root);
  for (const c of root.children) nodes(c, acc);
  for (const c of root.selectors.values()) nodes(c, acc);
  return acc;
}
/** Le HTML que le module a remis au navigateur, sur tout le sous-arbre. */
const htmlOf = (root) => nodes(root).map((n) => n.innerHTML).join("\n");
const find = (root, pred) => nodes(root).find(pred);

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

// ── Données hostiles (noms de fichiers d'un dépôt non fiable) ─────────────
const HEAVY = "/p/<img src=x onerror=alert(1)>.bin";
const QUOTE = '/p/q" onmouseover="alert(2)';
const RECENT = "<img src=x onerror=alert(3)>.md";
const PURGE_NAME = "<img src=x onerror=alert(4)>";
const PURGE_PATH = "/p/<img src=x onerror=alert(5)>";
const FAIL_NAME = "<img src=x onerror=alert(6)>";
const FAIL_ERR = "<img src=x onerror=alert(7)>";

function answers(overrides = {}) {
  const base = {
    get_project_dashboard: {
      has_project: true,
      project: { name: "p", path: "/p" },
      storage: {
        heaviest: [
          { path: HEAVY, size_h: "9 Mo" },
          { path: QUOTE, size_h: "8 Mo" },
        ],
      },
      git: { is_repo: false },
      context: { recent_files: [{ path: RECENT, mtime: 0 }] },
    },
    get_project_tracking: { projects: [] },
    get_agent_supervision: { projects: [] },
    get_super_agent_tracking: { clients: [] },
    get_config: { dashboard_auto_refresh: false },
    list_purgeable_items: [
      { name: PURGE_NAME, path: PURGE_PATH, category: "cache", size: 10, size_h: "10 o" },
    ],
    purge_project_items: {
      freed: 0,
      freed_h: "0 o",
      details: [{ ok: false, name: FAIL_NAME, error: FAIL_ERR }],
    },
  };
  return { ...base, ...overrides };
}

let dash;
beforeEach(() => {
  invokeMock.mockReset();
  globalThis.document = {
    body: new FakeEl("body"),
    createElement: (t) => new FakeEl(t),
    createElementNS: (_ns, t) => new FakeEl(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.window = { _pilotProjectPath: "/p" };
});
afterEach(() => {
  if (dash) dash.unlisten();
  dash = null;
  delete globalThis.document;
  delete globalThis.window;
});

async function mount(over) {
  const a = answers(over);
  invokeMock.mockImplementation(async (cmd) => {
    const v = a[cmd];
    if (v instanceof Error || (v && v.__reject)) throw v.__reject ?? v;
    return v;
  });
  const { createDashboard } = await import("./dashboard.js");
  const container = new FakeEl("div");
  dash = createDashboard(container);
  await flush();
  return container;
}

describe("COMP-06 — les noms et chemins de fichiers du projet restent du texte", () => {
  it("fichiers lourds, derniers modifiés et éléments purgeables : aucun HTML actif", async () => {
    const container = await mount();
    const html = htmlOf(container);
    // Les noms sont toujours AFFICHÉS (aucune donnée supprimée)…
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.bin");
    expect(html).toContain("&lt;img src=x onerror=alert(3)&gt;.md");
    expect(html).toContain("&lt;img src=x onerror=alert(4)&gt;");
    // … mais jamais comme balise, ni comme sortie d'attribut.
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onmouseover="/);
  });

  it("confirmation de purge et détail des échecs : aucun HTML actif", async () => {
    const container = await mount();
    const cb = find(container, (n) => n.tagName === "INPUT");
    expect(cb, "case à cocher de purge").toBeTruthy();
    cb.checked = true;
    await cb.fire("change");
    const btn = find(container, (n) => n.tagName === "BUTTON" && n.className.includes("web-btn-danger"));
    expect(btn, "bouton « Purger la sélection »").toBeTruthy();
    const clicking = btn.fire("click");
    await flush();
    // La boîte de confirmation est posée sur document.body.
    const overlay = document.body.children[0];
    expect(overlay, "boîte de confirmation").toBeTruthy();
    const dialogHtml = htmlOf(overlay);
    expect(dialogHtml).toContain("&lt;img src=x onerror=alert(4)&gt;");
    expect(dialogHtml).not.toMatch(/<img/i);
    // Confirmer : la purge échoue, le détail d'échec s'affiche.
    const dlg = overlay.children[0];
    await dlg.querySelector('[data-act="ok"]').fire("click");
    await clicking;
    await flush();
    const feedback = find(container, (n) => n.className === "dash-purge-feedback");
    expect(feedback.innerHTML).toContain("&lt;img src=x onerror=alert(6)&gt;");
    expect(feedback.innerHTML).toContain("&lt;img src=x onerror=alert(7)&gt;");
    expect(feedback.innerHTML).not.toMatch(/<img/i);
  });
});

describe("COMP-06 — branche, projets suivis et messages d'erreur restent du texte", () => {
  it("nom de branche Git, nom et chemin de projet (suivi + supervision) : aucun HTML actif", async () => {
    const base = answers().get_project_dashboard;
    const container = await mount({
      // `<` et `>` sont permis dans un nom de branche Git.
      get_project_dashboard: { ...base, git: { is_repo: true, branch: "<img src=x onerror=alert(9)>" } },
      get_project_tracking: {
        projects: [{ name: "<img src=x onerror=alert(10)>", path: '/w/x" onmouseover="alert(11)', active: true }],
      },
      get_agent_supervision: {
        projects: [
          {
            name: "<img src=x onerror=alert(12)>",
            path: '/w/y" onmouseover="alert(13)',
            agents: [{ agent: "a", state: "running" }],
          },
        ],
      },
    });
    const html = htmlOf(container);
    expect(html).toContain("&lt;img src=x onerror=alert(9)&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(10)&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(12)&gt;");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onmouseover="/);
  });

  it("message d'erreur du chargement et de la purge : affiché, jamais interprété", async () => {
    const container = await mount({
      get_project_dashboard: { __reject: "échec sur /p/<img src=x onerror=alert(14)>" },
    });
    const html = htmlOf(container);
    expect(html).toContain("&lt;img src=x onerror=alert(14)&gt;");
    expect(html).not.toMatch(/<img/i);
    dash.unlisten();

    const c2 = await mount({ purge_project_items: { __reject: "<img src=x onerror=alert(15)>" } });
    const cb = find(c2, (n) => n.tagName === "INPUT");
    cb.checked = true;
    await cb.fire("change");
    const btn = find(c2, (n) => n.tagName === "BUTTON" && n.className.includes("web-btn-danger"));
    const clicking = btn.fire("click");
    await flush();
    const overlay = document.body.children[document.body.children.length - 1];
    await overlay.children[0].querySelector('[data-act="ok"]').fire("click");
    await clicking;
    await flush();
    const feedback = find(c2, (n) => n.className === "dash-purge-feedback");
    expect(feedback.innerHTML).toContain("&lt;img src=x onerror=alert(15)&gt;");
    expect(feedback.innerHTML).not.toMatch(/<img/i);
  });
});
