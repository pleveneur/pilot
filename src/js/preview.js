// preview.js — Rendu Markdown et diagrammes avec markdown-it et Mermaid.js

import markdownit from "markdown-it";
import mkkatex from "@traptitech/markdown-it-katex";
import mermaid from "mermaid";
import { invoke } from "@tauri-apps/api/core";

// Disable Mermaid's auto-run before it fires (default is 'true')
mermaid.startOnLoad = false;

const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
}).use(mkkatex, { throwOnError: false, errorColor: "#cc0000" });

// --- Mermaid.js initialization ---
let mermaidInitialized = false;
let diagramIdCounter = 0;

function getMermaidTheme() {
  return document.body.classList.contains("theme-dark") ? "dark" : "default";
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: getMermaidTheme(),
    securityLevel: "loose",
    suppressErrorRendering: true,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
  });
  mermaidInitialized = true;
}

function ensureMermaid() {
  if (!mermaidInitialized) initMermaid();
}

/**
 * Rend un diagramme Mermaid en utilisant mermaid.render() qui retourne
 * le SVG en string — fonctionne même si l'élément n'est pas dans le live DOM.
 * @param {string} source - Code source Mermaid
 * @returns {Promise<{ svg: string, bindFunctions?: Function }>}
 */
async function renderMermaidDiagram(source) {
  const id = `mermaid-svg-${++diagramIdCounter}`;
  try {
    // Use mermaidAPI.render directly (bypasses the execution queue)
    const result = await mermaid.mermaidAPI.render(id, source);
    return result;
  } catch (err) {
    console.warn("Mermaid render error:", err);
    // Clean up any temporary elements left by Mermaid in the DOM
    const enclosingDiv = document.getElementById(`d${id}`);
    if (enclosingDiv) enclosingDiv.remove();
    const svgEl = document.getElementById(id);
    if (svgEl) svgEl.remove();
    return { svg: `<div class="mermaid-error">⚠️ Erreur de syntaxe Mermaid<br><small>${err.message || err}</small></div>` };
  }
}

/**
 * Traite les blocs <pre><code class="language-mermaid"> dans le conteneur
 * et les remplace par le rendu SVG Mermaid.
 * Utilise mermaid.render() (retourne du SVG string) au lieu de mermaid.run()
 * pour fonctionner même quand le conteneur n'est pas encore dans le live DOM.
 * @param {HTMLElement} container
 */
async function processMermaidBlocks(container) {
  const mermaidBlocks = container.querySelectorAll(
    "pre code.language-mermaid"
  );
  if (mermaidBlocks.length === 0) return;

  ensureMermaid();

  for (const block of mermaidBlocks) {
    const pre = block.parentElement;
    const source = block.textContent.trim(); // textContent decodes HTML entities, trim whitespace

    const div = document.createElement("div");
    div.className = "mermaid";
    div.setAttribute("data-mermaid-source", source);

    const { svg, bindFunctions } = await renderMermaidDiagram(source);
    div.innerHTML = svg;

    // Stocker bindFunctions pour l'appeler quand l'élément sera dans le live DOM
    if (bindFunctions) {
      div._mermaidBindFunctions = bindFunctions;
    }

    // Wrap in a zoom/pan container
    const zoomWrapper = document.createElement("div");
    zoomWrapper.className = "mermaid-zoom-wrapper";
    zoomWrapper.appendChild(div);

    pre.replaceWith(zoomWrapper);
  }
}

/**
 * Attache les event handlers interactifs Mermaid (tooltips, clics)
 * une fois que le conteneur est dans le live DOM.
 * @param {HTMLElement} container
 */
export function bindMermaidFunctions(container) {
  const mermaidDivs = container.querySelectorAll(".mermaid");
  for (const div of mermaidDivs) {
    if (div._mermaidBindFunctions) {
      div._mermaidBindFunctions(div);
      delete div._mermaidBindFunctions;
    }
  }
  // Activate zoom/pan on all mermaid-zoom-wrappers
  const zoomWrappers = container.querySelectorAll(".mermaid-zoom-wrapper");
  for (const wrapper of zoomWrappers) {
    if (!wrapper._zoomPanActive) initMermaidZoomPan(wrapper);
  }
}

/**
 * Re-rend tous les diagrammes Mermaid avec le thème actuel.
 * Appelé quand le thème Pilot change (dark ↔ light).
 */
export async function reRenderMermaidDiagrams() {
  mermaid.initialize({
    startOnLoad: false,
    theme: getMermaidTheme(),
    securityLevel: "loose",
    suppressErrorRendering: true,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
  });

  const wrappers = document.querySelectorAll(".preview-wrapper");
  for (const wrapper of wrappers) {
    const mermaidDivs = wrapper.querySelectorAll(".mermaid");
    if (mermaidDivs.length === 0) continue;

    for (const div of mermaidDivs) {
      const source = div.getAttribute("data-mermaid-source");
      if (!source) continue;

      const { svg, bindFunctions } = await renderMermaidDiagram(source);
      div.innerHTML = svg;
      if (bindFunctions) bindFunctions(div);

      // Reset zoom after re-render
      const zoomWrapper = div.closest(".mermaid-zoom-wrapper");
      if (zoomWrapper) resetMermaidZoom(zoomWrapper);
    }
  }
}

// --- Mermaid Zoom/Pan ---

/**
 * Initialise le zoom/pan sur un wrapper de diagramme Mermaid.
 * - Molette : zoom in/out
 * - Clic + glisser : pan
 * - Double-clic : reset
 * - Bouton ↺ : reset
 * @param {HTMLElement} wrapper - élément .mermaid-zoom-wrapper
 */
function initMermaidZoomPan(wrapper) {
  wrapper._zoomPanActive = true;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  const mermaidDiv = wrapper.querySelector(".mermaid");

  // Reset button
  const resetBtn = document.createElement("button");
  resetBtn.className = "mermaid-zoom-reset";
  resetBtn.title = "Réinitialiser le zoom";
  resetBtn.textContent = "↺";
  resetBtn.addEventListener("click", () => resetZoom());
  wrapper.appendChild(resetBtn);

  function applyTransform() {
    if (mermaidDiv) {
      mermaidDiv.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      mermaidDiv.style.transformOrigin = "0 0";
    }
    // Show/hide reset button
    resetBtn.style.opacity = (scale !== 1 || translateX !== 0 || translateY !== 0) ? "1" : "0";
  }

  function resetZoom() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform();
  }

  // Wheel zoom (zoom toward cursor)
  wrapper.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.2, Math.min(5, scale + delta));

    // Zoom toward cursor position
    const rect = wrapper.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const ratio = newScale / scale;
    translateX = cursorX - ratio * (cursorX - translateX);
    translateY = cursorY - ratio * (cursorY - translateY);

    scale = newScale;
    applyTransform();
  }, { passive: false });

  // Pan (drag)
  wrapper.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    // Don't start drag on the reset button
    if (e.target === resetBtn) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    wrapper.style.cursor = "grabbing";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      wrapper.style.cursor = "grab";
    }
  });

  // Double-click to reset
  wrapper.addEventListener("dblclick", () => resetZoom());

  // Initial cursor style
  wrapper.style.cursor = "grab";
  applyTransform();
}

/**
 * Reset le zoom/pan d'un wrapper Mermaid
 */
function resetMermaidZoom(wrapper) {
  const mermaidDiv = wrapper.querySelector(".mermaid");
  if (mermaidDiv) {
    mermaidDiv.style.transform = "";
    mermaidDiv.style.transformOrigin = "";
  }
  const resetBtn = wrapper.querySelector(".mermaid-zoom-reset");
  if (resetBtn) resetBtn.style.opacity = "0";
}

// Listen for theme changes to re-render Mermaid diagrams
window.addEventListener("theme-changed", () => {
  reRenderMermaidDiagrams();
});

/**
 * Table de correspondance extension → type MIME (exportée)
 */
export const MIME_MAP = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tiff: "image/tiff",
  tif: "image/tiff",
  avif: "image/avif",
};

/**
 * Convertit un chemin absolu d'image en data URI base64
 * @param {string} absPath - Chemin absolu du fichier image
 * @returns {Promise<string|null>} data URI ou null si échec
 */
export async function imageToBase64(absPath) {
  try {
    const data = await invoke("read_file_binary", { path: absPath });
    const ext = absPath.split(".").pop()?.toLowerCase() || "png";
    const mime = MIME_MAP[ext] || "image/png";
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch (_) {
    return null;
  }
}

/**
 * Convertit du Markdown en HTML
 * @param {string} markdownContent
 * @returns {string}
 */
export function renderMarkdown(markdownContent) {
  return md.render(markdownContent);
}

/**
 * Résout les chemins relatifs des images en base64
 * pour que la WebView puisse les afficher sans permissions supplémentaires.
 * @param {HTMLElement} container - Élément contenant le HTML
 * @param {string|null} projectPath - Chemin absolu du projet
 */
async function resolveImagePaths(container, projectPath) {
  if (!projectPath) return;
  const images = container.querySelectorAll("img");
  for (const img of images) {
    const src = img.getAttribute("src") || "";
    // Ne pas toucher aux URLs déjà absolues
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:")
    )
      continue;

    let absPath;
    if (src.match(/^[A-Za-z]:[/\\]/) || src.startsWith("/")) {
      absPath = src;
    } else {
      const base = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
      absPath = base + "/" + src;
    }

    const dataUri = await imageToBase64(absPath);
    if (dataUri) {
      img.src = dataUri;
    }
  }
}

/**
 * Crée un conteneur de prévisualisation
 * @param {HTMLElement} container
 * @param {string} markdownContent
 * @param {string|null} projectPath - Chemin absolu du projet (pour résoudre les images)
 * @returns {Promise<HTMLElement>}
 */
export async function createPreview(container, markdownContent, projectPath = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "preview-wrapper";
  wrapper.innerHTML = renderMarkdown(markdownContent);
  await resolveImagePaths(wrapper, projectPath);
  container.appendChild(wrapper);
  await processMermaidBlocks(wrapper);
  return wrapper;
}

/**
 * Met à jour le contenu d'une prévisualisation
 * @param {HTMLElement} wrapper
 * @param {string} markdownContent
 * @param {string|null} projectPath - Chemin absolu du projet (pour résoudre les images)
 */
export async function updatePreview(wrapper, markdownContent, projectPath = null) {
  wrapper.innerHTML = renderMarkdown(markdownContent);
  await resolveImagePaths(wrapper, projectPath);
  await processMermaidBlocks(wrapper);
}
