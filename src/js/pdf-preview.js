// pdf-preview.js — Prévisualisation PDF avec PDF.js

import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Crée un panneau de prévisualisation PDF
 * @param {HTMLElement} container
 * @param {string} filePath - chemin local du PDF
 * @returns {Promise<HTMLElement>}
 */
export async function createPdfPreview(container, filePath) {

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-preview-wrapper";

  // Barre d'outils
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-toolbar";
  toolbar.innerHTML = `
    <button class="pdf-btn" data-action="prev" title="Page précédente">◀</button>
    <span class="pdf-page-info">Page <input type="number" class="pdf-page-num" value="1" min="1"> / <span class="pdf-page-count">?</span></span>
    <button class="pdf-btn" data-action="next" title="Page suivante">▶</button>
    <span class="pdf-sep">|</span>
    <button class="pdf-btn" data-action="zoom-out" title="Zoom arrière">−</button>
    <span class="pdf-zoom-level">100%</span>
    <button class="pdf-btn" data-action="zoom-in" title="Zoom avant">+</button>
  `;
  wrapper.appendChild(toolbar);

  // Conteneur des pages
  const viewer = document.createElement("div");
  viewer.className = "pdf-viewer";
  wrapper.appendChild(viewer);

  // État
  let pdfDoc = null;
  let currentPage = 1;
  let scale = 1.0;
  let renderedPages = new Map();

  // Charger le PDF en binaire (via Tauri invoke, évite les problèmes de scope asset)
  try {
    const data = await invoke("read_file_binary", { path: filePath });
    pdfDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(data),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    }).promise;
  } catch (err) {
    viewer.innerHTML = `<div class="pdf-error">❌ Erreur : impossible de charger le PDF<br><small>${err.message || err}</small></div>`;
    return wrapper;
  }

  const totalPages = pdfDoc.numPages;
  toolbar.querySelector(".pdf-page-count").textContent = totalPages;
  const pageNumInput = toolbar.querySelector(".pdf-page-num");
  pageNumInput.max = totalPages;

  /**
   * Rend une page
   */
  async function renderPage(pageNum) {
    if (renderedPages.has(pageNum)) {
      const cached = renderedPages.get(pageNum);
      cached.style.display = "";
      return cached;
    }

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const pageContainer = document.createElement("div");
    pageContainer.className = "pdf-page";
    pageContainer.dataset.page = pageNum;

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    pageContainer.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    viewer.appendChild(pageContainer);
    renderedPages.set(pageNum, pageContainer);
    return pageContainer;
  }

  /**
   * Affiche la page demandée et cache les autres
   */
  async function showPage(pageNum) {
    currentPage = pageNum;
    pageNumInput.value = pageNum;
    for (const [num, el] of renderedPages) {
      el.style.display = num === pageNum ? "" : "none";
    }
    await renderPage(pageNum);
    viewer.scrollTop = 0;
  }

  /**
   * Re-rend tout (changement de zoom)
   */
  async function reRenderAll() {
    for (const el of renderedPages.values()) el.remove();
    renderedPages.clear();
    await showPage(currentPage);
  }

  // Événements toolbar
  toolbar.addEventListener("click", async (e) => {
    const btn = e.target.closest(".pdf-btn");
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case "prev":
        if (currentPage > 1) await showPage(currentPage - 1);
        break;
      case "next":
        if (currentPage < totalPages) await showPage(currentPage + 1);
        break;
      case "zoom-out":
        scale = Math.max(0.25, scale - 0.25);
        toolbar.querySelector(".pdf-zoom-level").textContent = Math.round(scale * 100) + "%";
        await reRenderAll();
        break;
      case "zoom-in":
        scale = Math.min(4, scale + 0.25);
        toolbar.querySelector(".pdf-zoom-level").textContent = Math.round(scale * 100) + "%";
        await reRenderAll();
        break;
    }
  });

  pageNumInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      let num = parseInt(pageNumInput.value, 10);
      if (isNaN(num) || num < 1) num = 1;
      if (num > totalPages) num = totalPages;
      await showPage(num);
    }
  });

  // Raccourcis clavier
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      toolbar.querySelector('[data-action="prev"]').click();
    } else if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      toolbar.querySelector('[data-action="next"]').click();
    }
  });

  container.appendChild(wrapper);

  // Affiche la première page
  await showPage(1);

  return wrapper;
}
