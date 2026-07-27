// html-export.js — Export Markdown → HTML autonome (F1)
//
// Génère un fichier `.html` autonome (CSS inline + images en base64) réutilisable
// sans Pilot : on réutilise la commande Rust `export_pdf` (qui produit le HTML
// complet avec styles), on résout les images relatives en data-URI, puis on
// demande à l'utilisateur un chemin de sauvegarde (dialogue natif) et on écrit
// le fichier sur disque.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { imageToBase64 } from "./preview.js";
import { toastSuccess, toastError } from "./toast.js";

/**
 * Exporte un fichier Markdown en un fichier HTML autonome.
 * @param {string} mdPath - chemin absolu du fichier .md source
 */
export async function exportMarkdownToHtml(mdPath) {
  if (!mdPath || !mdPath.endsWith(".md")) {
    toastError("L'export HTML n'est disponible que pour les fichiers Markdown");
    return;
  }

  const baseName = mdPath.split(/[/\\]/).pop().replace(/\.md$/i, "");

  try {
    let html = await invoke("export_pdf", { sourcePath: mdPath });

    // Résoudre les chemins d'images relatifs en base64
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

    // Demander le chemin de sauvegarde
    const outPath = await save({
      defaultPath: baseName + ".html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!outPath) return; // Annulé par l'utilisateur

    await invoke("write_file_content", { path: outPath, content: html });
    toastSuccess("HTML exporté : " + outPath.split(/[/\\]/).pop());
  } catch (err) {
    toastError("Erreur export HTML : " + err);
  }
}