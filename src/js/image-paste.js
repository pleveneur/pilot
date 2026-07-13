// image-paste.js — Drag & drop / Ctrl+V d'images dans l'éditeur markdown

import { invoke } from "@tauri-apps/api/core";

/**
 * Copie un fichier image dans le projet (dossier images/) et insère ![](path)
 * @param {File} file - Fichier image (issu du drag & drop ou du presse-papiers)
 * @param {EditorView} view - Instance CodeMirror
 */
export async function handleImageFile(file, view) {
  try {
    const buffer = await file.arrayBuffer();
    const data = Array.from(new Uint8Array(buffer));

    const relativePath = await invoke("copy_image_to_project", {
      fileName: file.name || "image.png",
      data: data,
    });

    insertImageMarkdown(view, file.name, relativePath);
  } catch (err) {
    console.error("Erreur insertion image:", err);
  }
}

/**
 * Insère ![alt](path) à la position du curseur dans l'éditeur
 */
function insertImageMarkdown(view, fileName, relativePath) {
  // Texte alternatif : nom du fichier sans extension
  const alt = fileName.replace(/\.[^.]+$/, "");
  const { from, to } = view.state.selection.main;
  const mdText = `![${alt}](${relativePath})`;

  view.dispatch({
    changes: { from, to, insert: mdText },
    selection: { anchor: from + mdText.length },
  });
}

/**
 * Vérifie si un événement paste contient une image dans le presse-papiers
 * @param {ClipboardEvent} event
 * @returns {boolean}
 */
export function hasImageInClipboard(event) {
  const items = event.clipboardData?.items;
  if (!items) return false;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return true;
    }
  }
  return false;
}

/**
 * Extrait le blob image d'un événement paste
 * @param {ClipboardEvent} event
 * @returns {File|null}
 */
export function getImageFromClipboard(event) {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Vérifie si un fichier est une image (par type MIME ou extension)
 * @param {File} file
 * @returns {boolean}
 */
export function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  // Fallback : vérifier l'extension (nécessaire sur Tauri/Windows où le type MIME est souvent vide)
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif'].includes(ext);
}

/**
 * Vérifie si un dataTransfer contient des fichiers image
 * @param {DataTransfer} dataTransfer
 * @returns {boolean}
 */
export function hasImageFiles(dataTransfer) {
  if (!dataTransfer || !dataTransfer.types) return false;
  if (!dataTransfer.types.includes("Files")) return false;
  for (const file of dataTransfer.files) {
    if (isImageFile(file)) return true;
  }
  return false;
}

/**
 * Génère un nom de fichier à partir du type MIME (pour les images collées)
 * @param {string} mimeType - ex: "image/png"
 * @returns {string}
 */
export function fileNameFromMime(mimeType) {
  const ext = (mimeType && mimeType.includes('/')) ? mimeType.split("/")[1] : null;
  const safeExt = ext || "png";
  return `collage.${safeExt}`;
}
