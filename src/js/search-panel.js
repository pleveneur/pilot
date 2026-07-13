// search-panel.js — Recherche globale dans les fichiers (Ctrl+Shift+F)

import { invoke } from "@tauri-apps/api/core";

let searchPanel = null;
let searchInput = null;
let searchRegexToggle = null;
let searchExtInput = null;
let searchResultsList = null;
let searchResultsCount = null;
let searchLoading = null;
let isSearchOpen = false;
let tabsManager = null;

/**
 * Initialise le panneau de recherche globale
 * @param {import("./tabs.js").TabsManager} tabs
 */
export function initSearchPanel(tabs) {
  tabsManager = tabs;

  searchPanel = document.getElementById("search-panel");
  searchInput = document.getElementById("search-input");
  searchRegexToggle = document.getElementById("search-regex-toggle");
  searchExtInput = document.getElementById("search-ext-input");
  searchResultsList = document.getElementById("search-results-list");
  searchResultsCount = document.getElementById("search-results-count");
  searchLoading = document.getElementById("search-loading");

  if (!searchPanel || !searchInput) return;

  // Raccourci Ctrl+Shift+F pour ouvrir/fermer
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
      e.preventDefault();
      e.stopPropagation();
      toggleSearchPanel();
    }
    // Escape pour fermer
    if (e.key === "Escape" && isSearchOpen) {
      closeSearchPanel();
    }
  });

  // Entrée pour lancer la recherche
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });
}

/** Ouvre ou ferme le panneau de recherche */
export function toggleSearchPanel() {
  if (isSearchOpen) {
    closeSearchPanel();
  } else {
    openSearchPanel();
  }
}

/** Ouvre le panneau de recherche et focus le champ */
export function openSearchPanel() {
  if (!searchPanel) return;
  isSearchOpen = true;
  searchPanel.classList.remove("hidden");
  searchInput.focus();
  searchInput.select();
}

/** Ferme le panneau de recherche */
export function closeSearchPanel() {
  if (!searchPanel) return;
  isSearchOpen = false;
  searchPanel.classList.add("hidden");
  searchResultsList.innerHTML = "";
  searchResultsCount.textContent = "";
}

/** Lance la recherche globale */
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  const useRegex = searchRegexToggle.checked;
  const extensions = searchExtInput.value.trim();

  searchLoading.classList.remove("hidden");
  searchResultsList.innerHTML = "";
  searchResultsCount.textContent = "Recherche en cours…";

  try {
    const results = await invoke("search_in_files", {
      query,
      useRegex,
      extensions,
      maxResults: 500,
    });

    renderResults(results, query);
  } catch (err) {
    searchResultsCount.textContent = "Erreur : " + err;
  } finally {
    searchLoading.classList.add("hidden");
  }
}

/** Affiche les résultats de recherche */
function renderResults(results, query) {
  searchResultsList.innerHTML = "";

  if (results.length === 0) {
    searchResultsCount.textContent = "Aucun résultat";
    return;
  }

  // Grouper par fichier
  const grouped = new Map();
  for (const r of results) {
    if (!grouped.has(r.path)) {
      grouped.set(r.path, []);
    }
    grouped.get(r.path).push(r);
  }

  const totalFiles = grouped.size;
  searchResultsCount.textContent = `${results.length} résultat${results.length > 1 ? "s" : ""} dans ${totalFiles} fichier${totalFiles > 1 ? "s" : ""}`;

  for (const [filePath, matches] of grouped) {
    // En-tête du fichier
    const fileHeader = document.createElement("div");
    fileHeader.className = "search-file-header";
    const fileName = filePath.replace(/\\/g, "/").split("/").pop();
    const relPath = getRelativePath(filePath);
    fileHeader.innerHTML = `<span class="search-file-name">${esc(fileName)}</span><span class="search-file-path">${esc(relPath)}</span><span class="search-match-count">${matches.length}</span>`;
    searchResultsList.appendChild(fileHeader);

    // Lignes de résultat
    for (const match of matches.slice(0, 20)) { // Limiter à 20 résultats par fichier
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `<span class="search-line-num">${match.line}</span><span class="search-line-text">${highlightMatch(esc(match.text), query)}</span>`;
      row.addEventListener("click", () => {
        openResultFile(match.path, match.line, match.col);
      });
      searchResultsList.appendChild(row);
    }

    if (matches.length > 20) {
      const more = document.createElement("div");
      more.className = "search-more-results";
      more.textContent = `… et ${matches.length - 20} autres résultats`;
      searchResultsList.appendChild(more);
    }
  }
}

/** Ouvre un fichier à une ligne/colonne donnée */
function openResultFile(filePath, line, col) {
  if (!tabsManager) return;
  tabsManager.openFile(filePath, "edit");
  // Attendre que l'onglet soit créé et l'éditeur prêt
  setTimeout(() => {
    const tab = tabsManager.getActiveTab();
    if (tab && tab.view && tab.path === filePath) {
      const lineInfo = tab.view.state.doc.line(Math.min(line, tab.view.state.doc.lines));
      tab.view.dispatch({
        selection: { anchor: lineInfo.from, head: lineInfo.to },
        scrollIntoView: true,
      });
      tab.view.focus();
    }
  }, 200);
}

/** Chemin relatif au projet */
function getRelativePath(absPath) {
  const projectPath = window._pilotProjectPath || "";
  if (projectPath && absPath.startsWith(projectPath)) {
    let rel = absPath.slice(projectPath.length);
    if (rel.startsWith("\\") || rel.startsWith("/")) rel = rel.slice(1);
    return rel;
  }
  return absPath;
}

/** Échapper le HTML */
function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Surligner les occurrences dans le texte */
function highlightMatch(text, query) {
  // Échapper les caractères regex pour le surlignage
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.replace(re, '<mark class="search-highlight">$1</mark>');
}