// image-viewer.js — Prévisualisation d'image dans un onglet

import { imageToBase64 } from "./preview.js";

/**
 * Crée un panneau de prévisualisation d'image
 * @param {HTMLElement} container
 * @param {string} filePath - chemin absolu du fichier image
 * @returns {Promise<HTMLElement>}
 */
export async function createImageViewer(container, filePath) {
  const wrapper = document.createElement("div");
  wrapper.className = "image-viewer-wrapper";

  // Barre d'outils
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-toolbar";
  toolbar.innerHTML = `
    <button class="pdf-btn" data-action="zoom-out" title="Zoom arrière">−</button>
    <span class="pdf-zoom-level">100%</span>
    <button class="pdf-btn" data-action="zoom-in" title="Zoom avant">+</button>
    <span class="pdf-sep">|</span>
    <button class="pdf-btn" data-action="fit" title="Ajuster à la fenêtre">⊡</button>
  `;
  wrapper.appendChild(toolbar);

  // Conteneur de l'image
  const viewer = document.createElement("div");
  viewer.className = "image-viewer";
  wrapper.appendChild(viewer);

  const img = document.createElement("img");
  viewer.appendChild(img);

  // État
  let scale = 1.0;

  // Charger l'image en base64
  try {
    const dataUri = await imageToBase64(filePath);
    if (!dataUri) throw new Error("Impossible de charger l'image");
    img.src = dataUri;
  } catch (err) {
    viewer.innerHTML = `<div class="pdf-error">❌ Erreur : impossible de charger l'image<br><small>${err.message || err}</small></div>`;
    return wrapper;
  }

  function updateZoom() {
    img.style.transform = `scale(${scale})`;
    img.style.transformOrigin = "top left";
    toolbar.querySelector(".pdf-zoom-level").textContent = Math.round(scale * 100) + "%";
  }

  function fitToWindow() {
    const containerRect = viewer.getBoundingClientRect();
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    if (naturalWidth && naturalHeight && containerRect.width && containerRect.height) {
      const scaleX = (containerRect.width - 24) / naturalWidth;
      const scaleY = (containerRect.height - 24) / naturalHeight;
      scale = Math.min(scaleX, scaleY, 1);
      updateZoom();
    }
  }

  // Événements toolbar
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".pdf-btn");
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case "zoom-out":
        scale = Math.max(0.1, scale - 0.25);
        updateZoom();
        break;
      case "zoom-in":
        scale = Math.min(5, scale + 0.25);
        updateZoom();
        break;
      case "fit":
        fitToWindow();
        break;
    }
  });

  // Raccourcis clavier
  wrapper.addEventListener("keydown", (e) => {
    if (e.key === "0" && e.ctrlKey) {
      e.preventDefault();
      fitToWindow();
    }
  });

  container.appendChild(wrapper);

  // Ajuster à la fenêtre au chargement
  img.onload = () => fitToWindow();

  return wrapper;
}
