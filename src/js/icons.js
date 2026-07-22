// icons.js — Icônes Lucide (SVG inline).
//
// Remplace les balises <i data-lucide="name" class="icon ..."> présentes dans le
// DOM par des <svg> Lucide. La couleur suit `currentColor` (stroke) et la taille
// est contrôlée par les classes CSS `.icon` / `.icon-sm` / `.icon-lg` (style.css).
//
// IMPORTANT : createIcons() REQUIERT l'objet `icons` (map PascalCase → IconNode)
// passé en option ; sans lui, elle lève une erreur et ne rend aucune icône.
//
// API :
//   - refreshIcons(root?) : remplace tous les <i data-lucide> du document (ou du
//     sous-arbre `root` si fourni) par des <svg>. Idempotent. À appeler après
//     toute injection de HTML contenant des <i data-lucide>.
//   - setIcon(el, name, { size }) : remplace le contenu de `el` par une seule
//     icône Lucide. Utile pour les boutons qui changent d'icône selon l'état
//     (ex: abort/reconnect).

import { createIcons, icons } from "lucide";

// Petite utilité d'échappement HTML pour les libellés injectés via innerHTML.
// On n'échappe que les caractères significatifs pour le rendu HTML.
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Remplace tous les <i data-lucide="..."> du document (ou de `root`) par des SVG.
 * Idempotent : les éléments déjà remplacés (devenus <svg>) sont réécrits à
 * l'identique — sans effet visible, léger coût de re-scan.
 * @param {ParentNode} [root=document] — sous-arbre à scanner (ex: un popup).
 */
export function refreshIcons(root) {
  try {
    createIcons({ icons, ...(root ? { root } : {}) });
  } catch (e) {
    console.warn("[icons] createIcons a échoué :", e);
  }
}

/**
 * Remplace le contenu de `el` par une icône Lucide unique.
 * @param {HTMLElement} el — élément dont on remplace le contenu.
 * @param {string} name — nom kebab-case de l'icône (ex: "square", "rotate-cw").
 * @param {{size?: string}} [opts] — classe de taille (défaut "icon-sm").
 */
export function setIcon(el, name, { size = "icon-sm" } = {}) {
  if (!el) return;
  el.innerHTML = `<i data-lucide="${name}" class="${size}"></i>`;
  try {
    createIcons({ icons, root: el });
  } catch (e) {
    console.warn("[icons] setIcon a échoué :", e);
  }
}

/**
 * Remplace le contenu de `el` par une icône Lucide suivie d'un libellé textuel.
 * Le libellé est échappé HTML (sûr pour du texte utilisateur).
 * @param {HTMLElement} el — élément (ex: item de menu contextuel).
 * @param {string} name — nom kebab-case de l'icône.
 * @param {string} text — libellé affiché après l'icône.
 * @param {{size?: string}} [opts] — classe de taille (défaut "icon-sm").
 */
export function setIconText(el, name, text, { size = "icon-sm" } = {}) {
  if (!el) return;
  el.innerHTML = `<i data-lucide="${name}" class="${size}"></i> ${esc(text)}`;
  try {
    createIcons({ icons, root: el });
  } catch (e) {
    console.warn("[icons] setIconText a échoué :", e);
  }
}