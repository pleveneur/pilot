// pdf-to-markdown.js — Conversion PDF → Markdown (Phase 1 : extraction + heuristiques)

import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Extrait le texte d'un PDF et le convertit en Markdown structuré.
 *
 * Heuristiques appliquées :
 * - Détection des titres (police > moyenne + 30%, ligne courte)
 * - Regroupement en paragraphes (lignes consécutives à même indentation)
 * - Sauts de page marqués par `---`
 * - Détection basique des listes (•, -, *, numérotées)
 * - Conservation des liens URL
 *
 * @param {string} filePath - Chemin local du PDF
 * @returns {Promise<string>} Contenu Markdown
 */
export async function pdfToMarkdown(filePath) {
  // Charger le PDF en binaire via Tauri
  const data = await invoke("read_file_binary", { path: filePath });
  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;

  const totalPages = pdfDoc.numPages;
  const pages = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    // Extraire les items avec métadonnées de position
    const items = textContent.items
      .filter((item) => item.str.trim().length > 0)
      .map((item) => ({
        text: item.str,
        x: Math.round(item.transform[4]),
        y: Math.round(viewport.height - item.transform[5]), // inverser Y (PDF = bottom-up)
        fontSize: Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 10,
        fontName: item.fontName || "",
        width: item.width || 0,
      }));

    if (items.length === 0) continue;

    // Calculer la taille moyenne des polices
    const avgFontSize = items.reduce((sum, it) => sum + it.fontSize, 0) / items.length;
    const titleThreshold = avgFontSize * 1.3;

    // Grouper les items par ligne (même Y, tolérance de 3px)
    const lines = groupByLine(items);

    // Analyser les marges pour détecter les paragraphes
    const mdLines = [];
    let prevLineY = null;
    let inList = false;

    for (const line of lines) {
      const text = line.items.map((it) => it.text).join("").trim();
      if (!text) continue;

      // Détection de saut de paragraphe (grand saut vertical)
      const verticalGap = prevLineY !== null ? prevLineY - line.y : 0;
      const isParagraphBreak = verticalGap > avgFontSize * 1.5;

      // Détection de liste
      const listMatch = text.match(/^(\s*)([•●○◆▪▸►\-–—]\s*|\*\s+|\d+[.)]\s+)/);

      // Détection de titre
      const maxFontSize = Math.max(...line.items.map((it) => it.fontSize));
      const isTitle = maxFontSize >= titleThreshold && text.length < 120;

      if (isParagraphBreak && mdLines.length > 0 && !inList) {
        mdLines.push("");
      }

      if (isTitle) {
        // Déterminer le niveau du titre selon la taille relative
        const ratio = maxFontSize / avgFontSize;
        let level;
        if (ratio >= 2.0 || (maxFontSize >= 24 && text.length < 60)) {
          level = 1;
        } else if (ratio >= 1.6 || maxFontSize >= 18) {
          level = 2;
        } else {
          level = 3;
        }
        mdLines.push("");
        mdLines.push(`${"#".repeat(level)} ${text}`);
        mdLines.push("");
      } else if (listMatch) {
        const indent = listMatch[1].length;
        const bullet = listMatch[2];
        const content = text.slice(listMatch[0].length);
        // Normaliser les puces
        if (/^\d+[.)]/.test(bullet)) {
          mdLines.push(`${"  ".repeat(Math.floor(indent / 20))}${bullet.replace(/[.)]$/, ".")}  ${content}`);
        } else {
          mdLines.push(`${"  ".repeat(Math.floor(indent / 20))}- ${content}`);
        }
        inList = true;
      } else {
        // Texte normal — on le garde tel quel
        // Nettoyage : espaces multiples, espaces avant ponctuation
        const cleaned = text.replace(/\s{2,}/g, " ").trim();
        mdLines.push(cleaned);
        inList = false;
      }

      prevLineY = line.y;
    }

    pages.push({
      pageNumber: i,
      markdown: mdLines.join("\n").trim(),
    });
  }

  // Assembler toutes les pages
  const parts = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (pages.length > 1) {
      parts.push(`---\n*Page ${page.pageNumber}*\n`);
    }
    if (page.markdown) {
      parts.push(page.markdown);
    }
  }

  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Groupe les items texte en lignes (même coordonnée Y, tolérance 3px)
 */
function groupByLine(items) {
  if (items.length === 0) return [];

  // Trier par Y puis par X
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  let currentLine = { y: sorted[0].y, items: [sorted[0]] };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentLine.y) <= 3) {
      currentLine.items.push(item);
    } else {
      lines.push(currentLine);
      currentLine = { y: item.y, items: [item] };
    }
  }
  lines.push(currentLine);

  // Trier les items dans chaque ligne par X
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  return lines;
}

/**
 * Convertit un PDF en Markdown et écrit le fichier à côté du PDF.
 *
 * @param {string} pdfPath - Chemin du PDF source
 * @param {object} [options] - Options de conversion
 * @param {boolean} [options.openAfterCreate=true] - Ouvrir le fichier .md après création
 * @returns {Promise<string>} Chemin du fichier Markdown créé
 */
export async function convertPdfToMd(pdfPath, options = {}) {
  const { openAfterCreate = true } = options;

  // Construire le chemin du fichier .md (même dossier, même nom, extension .md)
  const mdPath = pdfPath.replace(/\.pdf$/i, ".md");

  // Vérifier si le fichier existe déjà
  const exists = await invoke("file_exists", { path: mdPath });
  if (exists) {
    // Ajouter un suffixe numérique
    let counter = 1;
    let candidatePath;
    do {
      candidatePath = pdfPath.replace(/\.pdf$/i, `-${counter}.md`);
      const candidateExists = await invoke("file_exists", { path: candidatePath });
      if (!candidateExists) break;
      counter++;
    } while (counter < 100);

    return convertPdfToMdWithOutput(pdfPath, candidatePath, { openAfterCreate });
  }

  return convertPdfToMdWithOutput(pdfPath, mdPath, { openAfterCreate });
}

/**
 * Effectue la conversion et écrit le fichier.
 * Si un modèle IA est configuré dans les paramètres, utilise l'IA pour restructurer le Markdown.
 */
async function convertPdfToMdWithOutput(pdfPath, mdPath, options) {
  const { openAfterCreate = true } = options;

  // Extraire le Markdown brut (Phase 1)
  let markdown = await pdfToMarkdown(pdfPath);

  // Tenter la conversion IA si un modèle est configuré
  try {
    const config = await invoke("get_config");
    const model = config.pdf_md_model || "";
    if (model.trim()) {
      const aiResult = await invoke("convert_pdf_to_md_ai", { text: markdown });
      if (aiResult && aiResult.trim()) {
        markdown = aiResult;
      }
    }
  } catch (err) {
    // Si la conversion IA échoue, on garde le résultat Phase 1
    console.warn("Conversion IA échouée, utilisation du résultat heuristique :", err);
  }

  // Écrire le fichier
  await invoke("write_file_content", { path: mdPath, content: markdown });

  // Ouvrir le fichier dans l'éditeur
  if (openAfterCreate && window._pilotTabs) {
    await window._pilotTabs.openFile(mdPath, "edit");
  }

  return mdPath;
}