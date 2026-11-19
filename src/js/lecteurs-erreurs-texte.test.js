// lecteurs-erreurs-texte.test.js — lot 10 (revue du 2026-11-16).
//
// Les lecteurs PDF / image / CSV affichent un message d'erreur quand le
// chargement échoue. Ce message est une DONNÉE : il doit rester du texte
// lisible, jamais devenir du balisage.
//
// Chemins réels couverts (modules montés, appels simulés) :
//  - pdf-preview.js `createPdfPreview` : `read_file_binary` réussit, PDF.js
//    (`getDocument`) rejette en analysant le fichier → bloc `.pdf-error`.
//    Le message vient de PDF.js, qui analyse des octets NON FIABLES : son
//    contenu n'est pas maîtrisé par Pilot (durcissement local, pas
//    d'exploitation démontrée avec un vrai PDF).
//  - image-viewer.js `createImageViewer` + VRAI `preview.js`
//    (`imageToBase64`) : `read_file_binary` rejette avec un message balisé →
//    `imageToBase64` avale l'erreur et renvoie null → seul le message FIXE
//    « Impossible de charger l'image » atteint l'écran (preuve du rejet).
//
// LIMITE : pas de navigateur ni de jsdom (non embarqué par le dépôt). Le faux
// DOM ci-dessous ne parse pas le HTML : on lit la chaîne effectivement remise à
// `innerHTML` et le `textContent` du nœud `<small>` obtenu par `querySelector`
// (un nœud stable par sélecteur, qui tient lieu du nœud que le navigateur
// créerait à partir du balisage statique).
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => {
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || "div").toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.className = "";
      this.innerHTML = "";
      this.textContent = "";
      this.bySelector = new Map();
      this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    }
    addEventListener() {}
    removeEventListener() {}
    appendChild(c) {
      this.children.push(c);
      return c;
    }
    remove() {}
    focus() {}
    querySelector(sel) {
      if (!this.bySelector.has(sel)) this.bySelector.set(sel, new FakeEl("div"));
      return this.bySelector.get(sel);
    }
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { width: 0, height: 0 };
    }
  }
  const doc = {
    createElement: (t) => new FakeEl(t),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: new FakeEl("body"),
  };
  // float-tooltip (via force-graph) injects a <style> into document.head at load time.
  doc.head = new FakeEl("head");
  doc.getElementsByTagName = () => [doc.head];
  doc.createTextNode = (t) => ({ nodeValue: String(t) });
  globalThis.document = doc;
  globalThis.window = { addEventListener() {}, innerWidth: 1024, innerHeight: 768 };
  return {
    FakeEl,
    invoke: vi.fn(),
    getDocument: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => H.invoke(...a) }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a) => H.getDocument(...a),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.js" }));
vi.mock("mermaid", () => ({
  default: { initialize: () => {}, mermaidAPI: { render: async () => ({ svg: "" }) } },
}));

import { createPdfPreview } from "./pdf-preview.js";
import { createImageViewer } from "./image-viewer.js";

const PIEGE = 'Invalid PDF <b id="piege">gras</b> & <i>suite</i>';

beforeEach(() => {
  H.invoke.mockReset();
  H.getDocument.mockReset();
});

describe("Lecteur PDF : le message d'erreur de PDF.js reste du texte", () => {
  it("affiche le message lisible dans <small> sans l'insérer comme balisage", async () => {
    H.invoke.mockResolvedValue([37, 80, 68, 70]); // fake "%PDF" bytes
    H.getDocument.mockReturnValue({ promise: Promise.reject(new Error(PIEGE)) });

    const container = new H.FakeEl("div");
    const wrapper = await createPdfPreview(container, "/bac/faux.pdf");

    expect(H.invoke).toHaveBeenCalledWith("read_file_binary", { path: "/bac/faux.pdf" });
    expect(H.getDocument).toHaveBeenCalledTimes(1);

    const viewer = wrapper.children.find((c) => c.className === "pdf-viewer");
    expect(viewer).toBeTruthy();
    // Unchanged frame: same class and same fixed sentence.
    expect(viewer.innerHTML).toContain('<div class="pdf-error">');
    expect(viewer.innerHTML).toContain("❌ Erreur : impossible de charger le PDF<br><small>");
    // The untrusted message never reaches innerHTML (note: "<b" alone would
    // also match the static "<br>", hence the full tag)…
    expect(viewer.innerHTML).not.toContain('<b id="piege">');
    expect(viewer.innerHTML).not.toContain("<i>");
    expect(viewer.innerHTML).not.toContain("piege");
    // …and is readable as plain text.
    expect(viewer.querySelector(".pdf-error small").textContent).toBe(PIEGE);
  });

  it("un rejet sans objet Error (chaîne brute) reste aussi du texte", async () => {
    H.invoke.mockResolvedValue([]);
    H.getDocument.mockReturnValue({ promise: Promise.reject("<img src=x>brut") });

    const wrapper = await createPdfPreview(new H.FakeEl("div"), "/bac/faux.pdf");
    const viewer = wrapper.children.find((c) => c.className === "pdf-viewer");
    expect(viewer.innerHTML).not.toContain("<img");
    expect(viewer.querySelector(".pdf-error small").textContent).toBe("<img src=x>brut");
  });
});

describe("Lecteur image : aucun message externe n'atteint l'écran (rejet motivé)", () => {
  it("le vrai imageToBase64 avale l'erreur : seul le message fixe s'affiche", async () => {
    H.invoke.mockRejectedValue(new Error(PIEGE));

    const wrapper = await createImageViewer(new H.FakeEl("div"), "/bac/faux.png");
    expect(H.invoke).toHaveBeenCalledWith("read_file_binary", { path: "/bac/faux.png" });

    const viewer = wrapper.children.find((c) => c.className === "image-viewer");
    expect(viewer.innerHTML).toContain('<div class="pdf-error">');
    expect(viewer.innerHTML).toContain("Impossible de charger l'image");
    expect(viewer.innerHTML).not.toContain('<b id="piege">');
    expect(viewer.innerHTML).not.toContain("piege");
  });
});
