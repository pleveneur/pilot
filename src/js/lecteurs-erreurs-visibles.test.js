// lecteurs-erreurs-visibles.test.js — lot 11 (revue du 2026-11-16).
//
// Deux défauts des lecteurs PDF / image, prouvés sur les VRAIS modules :
//
// 1. Le PDF s'ouvre (PDF.js charge le document) puis l'affichage de la
//    première page échoue (`getPage` ou `page.render` rejette). Cette erreur
//    sort de `createPdfPreview` et remonte au repli de `TabsManager._openPdf`.
//    Son message vient de PDF.js, qui analyse des octets NON FIABLES : il doit
//    rester du texte lisible, jamais devenir du balisage.
// 2. Quand le chargement échoue, `createPdfPreview` / `createImageViewer`
//    préparent un cadre d'erreur dans leur `wrapper` mais doivent aussi le
//    rattacher au conteneur reçu : `TabsManager` ne rattache jamais
//    `tab.view` lui-même, sans quoi l'onglet reste vide.
//
// Le chemin réussi (PDF et image) est vérifié inchangé.
//
// Simulés seulement : `invoke` (Tauri), PDF.js (`pdfjs-dist`), l'URL du worker,
// Mermaid, les icônes et les plugins Tauri. Tout le reste est le code réel
// (tabs.js, pdf-preview.js, image-viewer.js, preview.js, loading.js).
//
// LIMITES : pas de navigateur ni de jsdom (non embarqués par le dépôt), pas de
// vrai PDF ni de vraie image. Le faux DOM ne parse pas le HTML et ne vide pas
// les enfants quand on affecte `innerHTML` : on lit la chaîne remise à
// `innerHTML` et la liste réelle des enfants passés à `appendChild`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  const noop = () => {};
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || "div").toUpperCase();
      this.children = [];
      this.parent = null;
      this.style = {};
      this.dataset = {};
      this.listeners = {};
      this.className = "";
      this.innerHTML = "";
      this.textContent = "";
      this.value = "";
      this.title = "";
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
      c.parent = this;
      this.children.push(c);
      return c;
    }
    remove() {}
    focus() {}
    // One stable child per selector: stands in for the nodes the real
    // browser would create from the component's static markup.
    querySelector(sel) {
      if (!this.bySelector.has(sel)) this.bySelector.set(sel, new FakeEl("div"));
      return this.bySelector.get(sel);
    }
    querySelectorAll() {
      return [];
    }
    setAttribute() {}
    getAttribute() {
      return null;
    }
    getContext() {
      return {};
    }
    getBoundingClientRect() {
      return { width: 0, height: 0 };
    }
  }
  globalThis.window = globalThis;
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  const head = new FakeEl("head");
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: new FakeEl("body"),
    documentElement: new FakeEl("html"),
    // float-tooltip (via force-graph) injects a <style> into document.head at load time.
    head,
    getElementsByTagName: () => [head],
    createTextNode: (t) => ({ nodeValue: String(t) }),
  };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = noop;
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  return { FakeEl, invoke: vi.fn(), getDocument: vi.fn() };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => H.invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));
vi.mock("./icons.js", () => ({ refreshIcons: () => {}, setIcon: () => {}, setIconText: () => {} }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a) => H.getDocument(...a),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.js" }));
vi.mock("mermaid", () => ({
  default: { initialize: () => {}, mermaidAPI: { render: async () => ({ svg: "" }) } },
}));

import { TabsManager } from "./tabs.js";
import { createPdfPreview } from "./pdf-preview.js";
import { createImageViewer } from "./image-viewer.js";

// Harmless markup standing in for untrusted text inside a PDF.js message.
const PIEGE = 'Invalid page <b id="piege">gras</b> & <i>suite</i>';
const PIEGE_ESCAPED = "Invalid page &lt;b id=&quot;piege&quot;&gt;gras&lt;/b&gt; &amp; &lt;i&gt;suite&lt;/i&gt;";

// Fake PDF.js document: `page` decides how page 1 behaves.
function fakePdf({ getPage }) {
  return { promise: Promise.resolve({ numPages: 2, getPage }) };
}
function okPage() {
  return {
    getViewport: () => ({ width: 100, height: 140 }),
    render: () => ({ promise: Promise.resolve() }),
  };
}

// Minimal TabsManager context around the REAL `_openPdf` method.
function tabsCtx() {
  return {
    tabs: [],
    container: new H.FakeEl("div"),
    _renderTabButton: () => {},
    switchTab: () => {},
  };
}

beforeEach(() => {
  H.invoke.mockReset();
  H.getDocument.mockReset();
  H.invoke.mockImplementation(async (cmd) => {
    if (cmd === "read_file_binary") return [37, 80, 68, 70]; // fake "%PDF" bytes
    return undefined;
  });
});

describe("Onglet PDF : une erreur de PDF.js après le chargement reste du texte", () => {
  it("getPage rejette : le repli de l'onglet affiche le message échappé", async () => {
    H.getDocument.mockReturnValue(fakePdf({ getPage: () => Promise.reject(new Error(PIEGE)) }));
    const ctx = tabsCtx();
    await TabsManager.prototype._openPdf.call(ctx, "/bac/faux.pdf");

    expect(H.getDocument).toHaveBeenCalledTimes(1);
    const tab = ctx.tabs[0];
    expect(tab).toBeTruthy();
    const html = tab.wrapper.innerHTML;
    // Readable: the tab frame and the message text are both there.
    expect(html).toContain("❌ Erreur:");
    expect(html).toContain(PIEGE_ESCAPED);
    // Not interpreted: no live tag from the message.
    expect(html).not.toContain('<b id="piege">');
    expect(html).not.toContain("<i>");
    // The tab is still shown.
    expect(ctx.container.children).toContain(tab.wrapper);
  });

  it("page.render rejette : le repli de l'onglet affiche le message échappé", async () => {
    H.getDocument.mockReturnValue(
      fakePdf({
        getPage: async () => ({
          getViewport: () => ({ width: 100, height: 140 }),
          render: () => ({ promise: Promise.reject(PIEGE) }), // raw string rejection
        }),
      }),
    );
    const ctx = tabsCtx();
    await TabsManager.prototype._openPdf.call(ctx, "/bac/faux.pdf");

    const html = ctx.tabs[0].wrapper.innerHTML;
    expect(html).toContain("❌ Erreur:");
    expect(html).toContain(PIEGE_ESCAPED);
    expect(html).not.toContain('<b id="piege">');
  });
});

describe("Échec de chargement : le cadre d'erreur est rattaché au conteneur reçu", () => {
  it("PDF : getDocument rejette → le wrapper (cadre .pdf-error) est dans LE conteneur, une seule fois", async () => {
    H.getDocument.mockReturnValue({ promise: Promise.reject(new Error("Invalid PDF structure")) });
    const container = new H.FakeEl("div");
    const wrapper = await createPdfPreview(container, "/bac/faux.pdf");

    expect(container.children.filter((c) => c === wrapper)).toHaveLength(1);
    expect(container.children).toHaveLength(1);
    const viewer = wrapper.children.find((c) => c.className === "pdf-viewer");
    expect(viewer.innerHTML).toContain('<div class="pdf-error">');
    expect(viewer.querySelector(".pdf-error small").textContent).toBe("Invalid PDF structure");
  });

  it("PDF via le vrai _openPdf : le cadre d'erreur est dans l'onglet affiché", async () => {
    H.invoke.mockImplementation(async () => {
      throw "Erreur lecture: fichier introuvable";
    });
    const ctx = tabsCtx();
    await TabsManager.prototype._openPdf.call(ctx, "/bac/absent.pdf");

    const tab = ctx.tabs[0];
    expect(ctx.container.children).toContain(tab.wrapper);
    expect(tab.wrapper.children).toHaveLength(1);
    expect(tab.wrapper.children[0]).toBe(tab.view);
    const viewer = tab.view.children.find((c) => c.className === "pdf-viewer");
    expect(viewer.innerHTML).toContain('<div class="pdf-error">');
    expect(viewer.querySelector(".pdf-error small").textContent).toBe("Erreur lecture: fichier introuvable");
  });

  it("Image : lecture impossible → le wrapper (cadre .pdf-error) est dans LE conteneur, une seule fois", async () => {
    H.invoke.mockRejectedValue(new Error("Erreur lecture: fichier introuvable"));
    const container = new H.FakeEl("div");
    const wrapper = await createImageViewer(container, "/bac/absent.png");

    expect(H.invoke).toHaveBeenCalledWith("read_file_binary", { path: "/bac/absent.png" });
    expect(container.children.filter((c) => c === wrapper)).toHaveLength(1);
    expect(container.children).toHaveLength(1);
    const viewer = wrapper.children.find((c) => c.className === "image-viewer");
    expect(viewer.innerHTML).toContain('<div class="pdf-error">');
    expect(viewer.innerHTML).toContain("Impossible de charger l'image");
  });
});

describe("Ouverture réussie inchangée", () => {
  it("PDF : la page 1 est rendue, wrapper rattaché une seule fois, aucun cadre d'erreur", async () => {
    const getPage = vi.fn(async () => okPage());
    H.getDocument.mockReturnValue(fakePdf({ getPage }));
    const container = new H.FakeEl("div");
    const wrapper = await createPdfPreview(container, "/bac/faux.pdf");

    expect(getPage).toHaveBeenCalledWith(1);
    expect(container.children).toEqual([wrapper]);
    const viewer = wrapper.children.find((c) => c.className === "pdf-viewer");
    expect(viewer.innerHTML).toBe("");
    const page = viewer.children.find((c) => c.className === "pdf-page");
    expect(page).toBeTruthy();
    expect(page.dataset.page).toBe(1);
    expect(page.children[0].tagName).toBe("CANVAS");
  });

  it("PDF via le vrai _openPdf : tab.view est le lecteur, aucun repli d'erreur", async () => {
    H.getDocument.mockReturnValue(fakePdf({ getPage: async () => okPage() }));
    const ctx = tabsCtx();
    await TabsManager.prototype._openPdf.call(ctx, "/bac/faux.pdf");

    const tab = ctx.tabs[0];
    expect(tab.mode).toBe("pdf");
    expect(tab.wrapper.innerHTML).toBe("");
    expect(tab.wrapper.children).toEqual([tab.view]);
    expect(tab.view.className).toBe("pdf-preview-wrapper");
    expect(ctx.container.children).toContain(tab.wrapper);
  });

  it("Image : data URI posée, wrapper rattaché une seule fois, aucun cadre d'erreur", async () => {
    H.invoke.mockResolvedValue([137, 80, 78, 71]); // fake PNG header bytes
    const container = new H.FakeEl("div");
    const wrapper = await createImageViewer(container, "/bac/faux.png");

    expect(container.children).toEqual([wrapper]);
    const viewer = wrapper.children.find((c) => c.className === "image-viewer");
    expect(viewer.innerHTML).toBe("");
    const img = viewer.children.find((c) => c.tagName === "IMG");
    expect(img.src).toBe("data:image/png;base64,iVBORw==");
    expect(typeof img.onload).toBe("function");
  });
});
