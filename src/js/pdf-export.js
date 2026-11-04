// pdf-export.js — Export Markdown → PDF SANS AUCUNE FENÊTRE D'IMPRESSION.
//
// DÉFAUT CORRIGÉ (rapport : docs/rapports/RAPPORT-pdf-sans-impression.md) :
// l'export passait par un aperçu dans une iframe puis
// `iframe.contentWindow.print()`, c'est-à-dire la fenêtre d'impression du
// système. Résultat observé : le bouton « mouline » en permanence, l'application
// se fige, et rien ne garantit qu'un fichier a été écrit.
//
// NOUVEAU CHEMIN, UN SEUL POUR TOUS LES APPELANTS :
//   le geste de l'utilisateur (clic droit → « Exporter en PDF ») et l'outil
//   d'agent `export_markdown_pdf` (sentinelle `PILOT_PDF_EXPORT::`) passent tous
//   les deux par `runPdfExportRequest`, qui appelle la commande Rust
//   `markdown_to_pdf` — moteur PDF embarqué, exécuté HORS du fil d'affichage
//   (`spawn_blocking`), qui écrit un vrai fichier puis le RELIT sur le disque
//   pour vérifier la signature `%PDF`.
//
// Ce que ce module ne fait jamais :
//   - aucune impression, aucune iframe, aucun `print()` ;
//   - le bouton « Fermer » n'est jamais désactivé (aucune attente bloquante) ;
//   - un échec n'est jamais silencieux : il est nommé, source par source.

import { invoke } from "@tauri-apps/api/core";
import { toastSuccess, toastError, toastWarning } from "./toast.js";
import {
  PDF_NO_ANSWER_MESSAGE,
  pdfReportCounts,
  pdfReportLines,
  pdfReportStatus,
  pdfRequestFrom,
  pdfToolAnswer,
  pdfToolErrorAnswer,
  normalizePdfRequest,
} from "./pdf-gateway.js";

let overlay = null;
let closeBtn = null;
let statusLabel = null;
let reportEl = null;
let nameEl = null;

/**
 * Construit (une fois) le panneau d'export PDF. Ce panneau ne montre AUCUN
 * aperçu à imprimer : il dit ce qui a été écrit sur le disque, et il se ferme
 * d'un clic (ou avec Échap) — même pendant une conversion.
 * @returns {HTMLElement}
 */
function _buildOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "pdf-export-overlay";
  // La classe est conservée : `.pdf-export-overlay` fait partie des voiles
  // translucides suivis par `panneaux-translucides-theme.test.js`.
  overlay.className = "pdf-export-overlay";
  overlay.innerHTML = `
    <div class="pdf-export-toolbar">
      <span class="pdf-export-title">📄 Export PDF</span>
      <span class="pdf-export-name" id="pdf-export-name"></span>
      <span class="pdf-export-status" id="pdf-export-status">Conversion en cours…</span>
      <div class="pdf-export-actions">
        <button class="pdf-export-btn pdf-export-close" id="pdf-export-close">✕ Fermer</button>
      </div>
    </div>
    <div class="pdf-export-report" id="pdf-export-report" role="status" aria-live="polite"></div>
  `;
  document.body.appendChild(overlay);

  closeBtn = overlay.querySelector("#pdf-export-close");
  statusLabel = overlay.querySelector("#pdf-export-status");
  reportEl = overlay.querySelector("#pdf-export-report");
  nameEl = overlay.querySelector("#pdf-export-name");

  // Le bouton Fermer n'est JAMAIS désactivé : l'utilisateur garde toujours la
  // main, y compris pendant une conversion.
  closeBtn.addEventListener("click", () => _hideOverlay());
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") _hideOverlay();
  });

  return overlay;
}

/** Masque le panneau d'export PDF (jamais bloquant). */
function _hideOverlay() {
  if (overlay) overlay.classList.remove("visible");
}

/** Affiche le panneau d'export PDF. */
function _showOverlay() {
  _buildOverlay();
  overlay.classList.add("visible");
}

/** Peint le rapport dans le panneau : une ligne par document. */
function _renderReport(report) {
  if (!reportEl) return;
  reportEl.textContent = "";
  const counts = pdfReportCounts(report);
  if (report && typeof report.error === "string" && report.error && counts.total === 0) {
    const line = document.createElement("div");
    line.className = "pdf-export-line pdf-export-line-fail";
    line.textContent = report.error;
    reportEl.appendChild(line);
    return;
  }
  for (const text of pdfReportLines(report)) {
    const line = document.createElement("div");
    const failed = text.startsWith("- ÉCHEC");
    const ok = text.startsWith("- OK");
    line.className = ok
      ? "pdf-export-line pdf-export-line-ok"
      : failed
        ? "pdf-export-line pdf-export-line-fail"
        : "pdf-export-line pdf-export-line-head";
    line.textContent = text;
    reportEl.appendChild(line);
  }
}

/**
 * EXÉCUTION UNIQUE d'une demande d'export : normalise la demande, appelle la
 * commande Rust `markdown_to_pdf` (hors fil d'affichage, un fichier après
 * l'autre) et rend le rapport. Ne lève jamais : une panne devient un rapport
 * avec la raison, pour que l'échec soit VISIBLE.
 *
 * @param {{sources?:unknown, out_dir?:unknown, outDir?:unknown}|null|undefined} request
 * @returns {Promise<{results:Array<object>, produced:number, failed:number, error?:string}>}
 */
export async function runPdfExportRequest(request) {
  const norm = normalizePdfRequest(request);
  if (norm.error) {
    return { results: [], produced: 0, failed: 0, error: norm.error };
  }
  try {
    const report = await invoke("markdown_to_pdf", {
      sources: norm.sources,
      outDir: norm.out_dir === null ? null : norm.out_dir,
    });
    if (!report || typeof report !== "object") {
      // Réponse inattendue : on ne prétend RIEN.
      return {
        results: norm.sources.map((source) => ({
          source,
          output: null,
          ok: false,
          bytes: 0,
          pages: 0,
          error: "réponse inattendue du moteur PDF (aucun fichier confirmé)",
        })),
        produced: 0,
        failed: norm.sources.length,
        error: "Réponse inattendue du moteur PDF : aucun PDF n'est confirmé.",
      };
    }
    return report;
  } catch (err) {
    // Échec de la commande : chaque source est NOMMÉE avec la raison. Aucun
    // succès inventé, aucun échec avalé.
    const reason = err && typeof err === "object" && err.message ? err.message : String(err);
    console.error("[pdf] conversion impossible :", err);
    return {
      results: norm.sources.map((source) => ({
        source,
        output: null,
        ok: false,
        bytes: 0,
        pages: 0,
        error: reason,
      })),
      produced: 0,
      failed: norm.sources.length,
      error: reason,
    };
  }
}

/**
 * POINT UNIQUE d'exécution d'une demande venue d'un AGENT (sentinelle
 * `PILOT_PDF_EXPORT::<JSON>`), pour les trois canaux : session de l'assistant,
 * relais des questions d'agents, chat du projet. La réponse est le rapport JSON
 * attendu par l'extension `pilot-pdf.ts` — jamais un texte libre à parser.
 *
 * @param {unknown} title - titre de la demande d'extension (sentinelle incluse)
 * @returns {Promise<string>} réponse JSON (`{produced, failed, results}` ou `{error}`)
 */
export async function runPdfSentinelRequest(title) {
  const request = pdfRequestFrom(title);
  if (!request) {
    return pdfToolErrorAnswer(
      "Cette demande ne porte pas de conversion PDF : rien n'a été fait.",
    );
  }
  if (request.error) return pdfToolErrorAnswer(request.error);
  const report = await runPdfExportRequest(request);
  if (report && typeof report.error === "string" && report.error && (report.results || []).length === 0) {
    return pdfToolErrorAnswer(report.error);
  }
  return pdfToolAnswer(report);
}

/**
 * GESTE UTILISATEUR : clic droit sur un fichier Markdown → « Exporter en PDF ».
 * Ouvre le panneau, lance la conversion (sans impression), affiche le rapport
 * et laisse le bouton Fermer actif à tout instant.
 *
 * @param {string|string[]} input - chemin(s) absolu(s) de fichiers .md
 * @param {{outDir?:string}} [options]
 * @returns {Promise<object>} le rapport produit
 */
export async function exportMarkdownToPdf(input, options = {}) {
  const sources = Array.isArray(input) ? input : [input];
  _showOverlay();
  nameEl.textContent =
    sources.length === 1
      ? String(sources[0]).split(/[/\\]/).pop()
      : `${sources.length} fichiers`;
  statusLabel.textContent = "Conversion en cours…";
  reportEl.textContent = "";

  const report = await runPdfExportRequest({
    sources,
    out_dir: options && options.outDir ? options.outDir : null,
  });

  const counts = pdfReportCounts(report);
  _renderReport(report);
  statusLabel.textContent = pdfReportStatus(report);

  if (counts.produced > 0 && counts.failed === 0) {
    toastSuccess(
      counts.produced === 1 ? "PDF produit" : `${counts.produced} PDF produits`,
    );
  } else if (counts.produced === 0) {
    const reason =
      (report && typeof report.error === "string" && report.error) ||
      "aucun PDF n'a pu être écrit";
    toastError(`Export PDF impossible : ${reason}`);
  } else {
    toastWarning(`${counts.produced} PDF produit(s), ${counts.failed} échec(s) — voir le détail`);
  }
  return report;
}

/** Ferme le panneau d'export PDF s'il est ouvert (utilisé par les tests). */
export function closePdfExportOverlay() {
  _hideOverlay();
}

/** Message renvoyé à un agent quand aucune réponse n'a pu être produite. */
export const PDF_EXPORT_NO_ANSWER = PDF_NO_ANSWER_MESSAGE;
