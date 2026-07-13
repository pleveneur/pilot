// pdf-export.js — Export PDF d'un fichier Markdown avec aperçu explicite
//
// Ouvre un overlay plein écran affichant le rendu du document, avec une barre
// d'outils (statut, bouton Imprimer / Enregistrer en PDF, bouton Fermer).
// L'utilisateur garde le contrôle : il voit l'aperçu, lance l'impression
// explicitement, et reçoit un retour visuel clair à chaque étape
// (Génération → Aperçu prêt → Export terminé).
//
// Avant : une iframe invisible lançait print() automatiquement, ce qui
// pouvait laisser penser qu'un aperçu avait été ouvert alors que non.

import { invoke } from "@tauri-apps/api/core";
import { imageToBase64 } from "./preview.js";
import { toastSuccess, toastError, toastInfo } from "./toast.js";

let overlay = null;
let iframe = null;
let printBtn = null;
let closeBtn = null;
let statusLabel = null;

/**
 * Construit (une fois) l'overlay d'aperçu PDF et ses contrôles.
 * @returns {HTMLElement} l'overlay
 */
function _buildOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "pdf-export-overlay";
  overlay.className = "pdf-export-overlay";
  overlay.innerHTML = `
    <div class="pdf-export-toolbar">
      <span class="pdf-export-title">📄 Aperçu PDF</span>
      <span class="pdf-export-name" id="pdf-export-name"></span>
      <span class="pdf-export-status" id="pdf-export-status">Génération en cours…</span>
      <div class="pdf-export-actions">
        <button class="pdf-export-btn" id="pdf-export-print" disabled>🖨️ Imprimer / Enregistrer en PDF</button>
        <button class="pdf-export-btn pdf-export-close" id="pdf-export-close">✕ Fermer</button>
      </div>
    </div>
    <div class="pdf-export-frame-wrap">
      <iframe id="pdf-export-frame" class="pdf-export-frame" title="Aperçu PDF"></iframe>
    </div>
  `;
  document.body.appendChild(overlay);

  iframe = overlay.querySelector("#pdf-export-frame");
  printBtn = overlay.querySelector("#pdf-export-print");
  closeBtn = overlay.querySelector("#pdf-export-close");
  statusLabel = overlay.querySelector("#pdf-export-status");

  printBtn.addEventListener("click", () => {
    if (!iframe.contentWindow) return;
    statusLabel.textContent = "Impression en cours…";
    printBtn.disabled = true;
    closeBtn.disabled = true;

    let notified = false;
    const onDone = () => {
      if (notified) return;
      notified = true;
      statusLabel.textContent = "✅ Export terminé";
      printBtn.disabled = false;
      closeBtn.disabled = false;
      toastSuccess("Export PDF terminé");
    };

    iframe.contentWindow.onafterprint = onDone;
    window.addEventListener("afterprint", onDone, { once: true });
    // Fallback : certaines configurations ne déclenchent pas afterprint
    setTimeout(() => {
      if (!notified) {
        onDone();
      }
    }, 8000);

    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  });

  const close = () => _hideOverlay();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return overlay;
}

/** Masque l'overlay d'aperçu PDF */
function _hideOverlay() {
  if (overlay) overlay.classList.remove("visible");
}

/** Affiche l'overlay d'aperçu PDF */
function _showOverlay() {
  _buildOverlay();
  overlay.classList.add("visible");
}

/**
 * Génère le HTML d'export d'un fichier Markdown, résout les images relatives
 * en base64, puis affiche l'aperçu explicite prêt à imprimer.
 *
 * @param {string} mdPath - chemin absolu du fichier .md à exporter
 */
export async function exportMarkdownToPdf(mdPath) {
  const fileName = mdPath.split(/[/\\]/).pop();
  _showOverlay();
  const nameEl = overlay.querySelector("#pdf-export-name");
  nameEl.textContent = fileName;
  statusLabel.textContent = "Génération du document…";
  printBtn.disabled = true;

  try {
    let html = await invoke("export_pdf", { sourcePath: mdPath });

    // Résoudre les chemins relatifs des images en base64 pour l'export
    const projectPath = window._pilotProjectPath;
    if (projectPath) {
      const base = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
      const imgRegex = /<img src="([^"]+)"/g;
      const matches = [...html.matchAll(imgRegex)];
      for (const match of matches) {
        const originalSrc = match[1];
        // Ne pas toucher aux URLs déjà absolues
        if (originalSrc.match(/^(https?:|data:|\/|[A-Za-z]:[/\\])/)) continue;
        const absPath = base + "/" + originalSrc;
        const dataUri = await imageToBase64(absPath);
        if (dataUri) {
          html = html.replace(`src="${originalSrc}"`, `src="${dataUri}"`);
        }
      }
    }

    // Charger le rendu dans l'iframe visible (aperçu)
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    statusLabel.textContent = "Aperçu prêt — cliquez sur Imprimer";
    printBtn.disabled = false;
    toastInfo("Aperçu PDF prêt");
  } catch (err) {
    statusLabel.textContent = "❌ Erreur lors de l'export";
    toastError("Erreur export PDF : " + err);
    // Fermer l'aperçu après un court délai pour laisser lire l'erreur
    setTimeout(() => _hideOverlay(), 2000);
  }
}