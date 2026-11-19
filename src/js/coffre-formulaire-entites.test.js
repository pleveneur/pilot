// coffre-formulaire-entites.test.js — lot 8 (revue du 2026-11-16).
//
// The vault edit form inserts the stored description, login and password into
// `value="…"` attributes. The attribute escaper did not escape `&`, so a stored
// value that already CONTAINS a character reference (e.g. `&lt;`, `&amp;`,
// `&#34;`) was decoded by the browser's HTML parser: the field showed, and
// re-saved, a DIFFERENT value than the one stored. Hermes reproduced it in a
// real browser DOM with the escaper alone:
//   `secret&lt; &amp; &#34; fin`  ->  input.value === `secret< & " fin`.
//
// Path exercised here: the real `createVault` module, fictional entries from a
// mocked `vault_list`, the real edit button, the real form markup produced by
// `openEditor`, the real save handler, and the arguments sent to
// `vault_update` / `vault_add`. All secrets are invented.
//
// LIMITS (honest): there is no browser nor jsdom in this repository. The fake
// DOM below does NOT parse HTML. The browser step "attribute markup -> input
// .value" is MODELLED by `decodeAttr` (character references: a few named ones,
// decimal and hex numeric). It is a model, not the real HTML parser: it knows
// only a handful of named entities and ignores the legacy semicolon-less forms.
// The real-browser check is redone separately by Hermes after the fix.
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
      this.type = "";
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
    // One stable node per selector: stands in for the nodes a real browser
    // would build from the component's markup.
    querySelector(sel) {
      if (!this.bySelector.has(sel)) this.bySelector.set(sel, new FakeEl("div"));
      return this.bySelector.get(sel);
    }
    querySelectorAll() {
      return [];
    }
  }
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    addEventListener: noop,
    removeEventListener: noop,
    body: new FakeEl("body"),
  };
  return { FakeEl, created };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {} }));

import { invoke } from "@tauri-apps/api/core";
import { createVault } from "./vault.js";

const PROJECT = "/home/fictif/projet-fictif";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

// MODEL of the browser decoding character references inside an attribute
// value (single pass, so `&amp;lt;` gives `&lt;`, never `<`).
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };
function decodeAttr(raw) {
  return raw.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ref) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      return String.fromCodePoint(parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return Object.hasOwn(NAMED, ref) ? NAMED[ref] : m;
  });
}

// Raw attribute text of one form input, read from the markup the real
// component handed to innerHTML. The `">` right after the value also proves
// the value never escaped its attribute.
function rawValue(html, id) {
  const m = html.match(new RegExp(`<input id="${id}"[^>]*? value="([^"]*)">`));
  expect(m, `champ ${id} introuvable ou attribut value cassé`).toBeTruthy();
  return m[1];
}

// Mounts the real vault on an unlocked state listing `entries`.
async function mountUnlocked(entries) {
  window._pilotProjectPath = PROJECT;
  invoke.mockImplementation(async (cmd) => {
    if (cmd === "vault_status") return { initialized: true, unlocked: true };
    if (cmd === "vault_list") return entries;
    if (cmd === "vault_update" || cmd === "vault_add") return entries;
    return undefined;
  });
  const container = new H.FakeEl("div");
  createVault(container);
  await flush();
  return container;
}

// Stands in for the browser building the form inputs from the real markup.
function loadFormLikeBrowser(container, scope) {
  const html = container.querySelector("#vault-body").innerHTML;
  for (const id of ["vault-f-desc", "vault-f-login", "vault-f-pw"]) {
    container.querySelector(`#${id}`).value = decodeAttr(rawValue(html, id));
  }
  container.querySelector('input[name="vault-scope"]:checked').value = scope;
  return html;
}

function entry(over) {
  return {
    id: "id-fictif-1",
    description: "Serveur fictif",
    login: "root",
    password: "motdepasse-fictif",
    scope: "global",
    project_path: null,
    created_at: 1700000000,
    updated_at: 1700000100,
    ...over,
  };
}

beforeEach(() => {
  invoke.mockReset();
  H.created.length = 0;
});

describe("modèle de décodage (limite assumée)", () => {
  it("reproduit l'observation de Hermes en vrai navigateur sur la valeur brute non échappée", () => {
    expect(decodeAttr("secret&lt; &amp; &#34; fin")).toBe('secret< & " fin');
    expect(decodeAttr("&amp;lt; &#x3C; &copy; &inconnu;")).toBe("&lt; < © &inconnu;");
  });
});

describe("vault.js — le formulaire d'édition préserve exactement les valeurs stockées", () => {
  const CASES = [
    {
      name: "entités nommées et numériques (cas Hermes)",
      description: "Accès &lt;prod&gt;",
      login: "user&amp;co",
      password: "secret&lt; &amp; &#34; fin",
    },
    {
      name: "caractères bruts & \" < > '",
      description: `R&D "test" <b>`,
      login: `o'brien&"x"`,
      password: `p<a>s&s"w'o"rd`,
    },
    {
      name: "références hexadécimales, doubles et nommées rares",
      description: "Copie &copy; &#xA9;",
      login: "&amp;amp;",
      password: "&#x3C;script&#x3E;&nbsp;&#39;",
    },
    {
      name: "valeurs ordinaires",
      description: "Serveur OVH",
      login: "root",
      password: "Motdepasse123!",
    },
  ];

  for (const scope of ["global", "project"]) {
    for (const c of CASES) {
      it(`${c.name} — portée ${scope} : champs relus et vault_update identiques au stockage`, async () => {
        const stored = entry({
          description: c.description,
          login: c.login,
          password: c.password,
          scope,
          project_path: scope === "project" ? PROJECT : null,
        });
        const container = await mountUnlocked([stored]);

        // Display of the list is untouched: text nodes, verbatim.
        const desc = H.created.find((el) => el.className === "vault-row-desc");
        expect(desc.textContent).toBe(c.description);

        // Real edit button of the real row.
        const editBtn = H.created.find((el) => el.title === "Modifier");
        editBtn.listeners.click[0]();
        loadFormLikeBrowser(container, scope);

        // Fields as the user sees them before any change.
        expect(container.querySelector("#vault-f-desc").value).toBe(c.description);
        expect(container.querySelector("#vault-f-login").value).toBe(c.login);
        expect(container.querySelector("#vault-f-pw").value).toBe(c.password);

        // Save without touching anything: the backend gets the stored values.
        await container.querySelector("#vault-save-btn").listeners.click[0]();
        expect(invoke).toHaveBeenCalledWith("vault_update", {
          entry: {
            id: "id-fictif-1",
            description: c.description,
            login: c.login,
            password: c.password,
            scope,
            projectPath: scope === "project" ? PROJECT : null,
            createdAt: 1700000000,
            updatedAt: 1700000100,
          },
        });
        expect(invoke).not.toHaveBeenCalledWith("vault_add", expect.anything());
      });
    }
  }

  it("valeurs ordinaires : le balisage du formulaire est inchangé", async () => {
    const container = await mountUnlocked([entry({})]);
    H.created.find((el) => el.title === "Modifier").listeners.click[0]();
    const html = container.querySelector("#vault-body").innerHTML;
    expect(html).toContain('<input id="vault-f-desc" class="vault-input" placeholder="Ex: Serveur OVH" value="Serveur fictif">');
    expect(html).toContain('<input id="vault-f-login" class="vault-input" placeholder="Ex: root" value="root">');
    expect(html).toContain('<input id="vault-f-pw" type="password" class="vault-input" placeholder="Mot de passe" value="motdepasse-fictif">');
  });

  it("nouvelle entrée : champs vides, valeurs saisies transmises telles quelles à vault_add", async () => {
    const container = await mountUnlocked([]);
    container.querySelector("#vault-add-btn").listeners.click[0]();
    const html = loadFormLikeBrowser(container, "global");
    expect(rawValue(html, "vault-f-desc")).toBe("");
    expect(rawValue(html, "vault-f-login")).toBe("");
    expect(rawValue(html, "vault-f-pw")).toBe("");
    // Typed by the user (no markup involved).
    container.querySelector("#vault-f-desc").value = "Nouveau &lt;fictif&gt;";
    container.querySelector("#vault-f-login").value = "a&amp;b";
    container.querySelector("#vault-f-pw").value = 'x&#34;y"<z';
    await container.querySelector("#vault-save-btn").listeners.click[0]();
    expect(invoke).toHaveBeenCalledWith("vault_add", {
      entry: {
        id: "",
        description: "Nouveau &lt;fictif&gt;",
        login: "a&amp;b",
        password: 'x&#34;y"<z',
        scope: "global",
        projectPath: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
  });
});
