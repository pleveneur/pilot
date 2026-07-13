// outline.js — Table des matières Markdown (Outline) avec raccourci Ctrl+Shift+O

let outlinePanel = null;
let outlineList = null;
let tabsManager = null;
let isOutlineOpen = false;
let updateTimer = null;

/**
 * Initialise le panneau Outline
 * @param {import("./tabs.js").TabsManager} tabs
 */
export function initOutline(tabs) {
  tabsManager = tabs;
  outlinePanel = document.getElementById("outline-panel");
  outlineList = document.getElementById("outline-list");

  if (!outlinePanel || !outlineList) return;

  // Raccourci Ctrl+Shift+O pour basculer l'outline
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "O") {
      e.preventDefault();
      e.stopPropagation();
      toggleOutline();
    }
  });
}

/** Bascule l'affichage de l'outline */
export function toggleOutline() {
  if (isOutlineOpen) {
    closeOutline();
  } else {
    openOutline();
  }
}

/** Ouvre l'outline et le met à jour */
export function openOutline() {
  if (!outlinePanel) return;
  isOutlineOpen = true;
  outlinePanel.classList.remove("hidden");
  updateOutline();
}

/** Ferme l'outline */
export function closeOutline() {
  if (!outlinePanel) return;
  isOutlineOpen = false;
  outlinePanel.classList.add("hidden");
}

/** Met à jour l'outline (debounce) */
export function scheduleOutlineUpdate() {
  if (!isOutlineOpen) return;
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => updateOutline(), 200);
}

/** Extrait les headings du contenu et les affiche */
function updateOutline() {
  if (!outlineList || !tabsManager) return;

  const tab = tabsManager.getActiveTab();
  if (!tab || tab.mode !== "edit" || !tab.path.endsWith(".md") || !tab.view) {
    outlineList.innerHTML = '<p class="outline-empty">Ouvrez un fichier Markdown pour voir la table des matières</p>';
    return;
  }

  const content = tab.view.state.doc.toString();
  const headings = extractHeadings(content);

  if (headings.length === 0) {
    outlineList.innerHTML = '<p class="outline-empty">Aucun titre trouvé</p>';
    return;
  }

  outlineList.innerHTML = "";
  for (const h of headings) {
    const item = document.createElement("div");
    item.className = `outline-item outline-h${h.level}`;
    item.textContent = h.text;
    item.title = h.text;
    item.addEventListener("click", () => {
      navigateToHeading(tab, h.line);
    });
    outlineList.appendChild(item);
  }
}

/**
 * Extrait les headings d'un contenu Markdown
 * @param {string} content
 * @returns {Array<{level: number, text: string, line: number}>}
 */
function extractHeadings(content) {
  const headings = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      // Nettoyer le texte du heading (retirer les liens, formatting inline)
      const text = match[2]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // liens [text](url) → text
        .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // gras/italique
        .replace(/`{1,3}[^`]+`{1,3}/g, (m) => m.slice(1, -1)) // code inline
        .replace(/~~([^~]+)~~/g, "$1") // strikethrough
        .trim();
      headings.push({ level, text, line: i + 1 });
    }
  }
  return headings;
}

/** Navigue vers une ligne dans l'éditeur */
function navigateToHeading(tab, line) {
  if (!tab || !tab.view) return;
  const lineInfo = tab.view.state.doc.line(Math.min(line, tab.view.state.doc.lines));
  tab.view.dispatch({
    selection: { anchor: lineInfo.from },
    scrollIntoView: true,
  });
  tab.view.focus();
}