// search-panel.js — Recherche globale dans les fichiers (Ctrl+Shift+F)

import { invoke } from "@tauri-apps/api/core";
import { toastSuccess, toastError, toastWarning, toastInfo } from "./toast.js";
import { setContent } from "./editor.js";

let searchPanel = null;
let searchInput = null;
let searchRegexToggle = null;
let searchExtInput = null;
let searchResultsList = null;
let searchResultsCount = null;
let searchLoading = null;
let isSearchOpen = false;
let tabsManager = null;

// Replace (B3)
let searchReplaceToggle = null;
let searchReplaceRow = null;
let searchReplaceInput = null;
let searchReplaceAllBtn = null;
let replaceRowVisible = false;

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

  // Replace (B3)
  searchReplaceToggle = document.getElementById("search-replace-toggle");
  searchReplaceRow = document.getElementById("search-replace-row");
  searchReplaceInput = document.getElementById("search-replace-input");
  searchReplaceAllBtn = document.getElementById("search-replace-all");

  if (!searchPanel || !searchInput) return;

  // Raccourci Ctrl+Shift+F pour ouvrir/fermer
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
      e.preventDefault();
      e.stopPropagation();
      toggleSearchPanel();
    }
    // Ctrl+Shift+H : ouvrir le panneau avec la ligne de remplacement visible
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "H") {
      e.preventDefault();
      e.stopPropagation();
      openSearchPanel();
      showReplaceRow(true);
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

  // Toggle de la ligne de remplacement
  if (searchReplaceToggle) {
    searchReplaceToggle.addEventListener("click", () => {
      showReplaceRow(!replaceRowVisible);
    });
  }

  // Tout remplacer
  if (searchReplaceAllBtn) {
    searchReplaceAllBtn.addEventListener("click", () => {
      doReplaceAll();
    });
  }
  if (searchReplaceInput) {
    searchReplaceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doReplaceAll();
      }
    });
  }
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

/** Affiche ou masque la ligne de remplacement (B3). */
function showReplaceRow(show) {
  replaceRowVisible = show;
  if (searchReplaceRow) {
    searchReplaceRow.classList.toggle("hidden", !show);
  }
  if (show && searchReplaceInput) {
    setTimeout(() => searchReplaceInput.focus(), 0);
  }
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

// ── Remplacement global (B3 — Find & Replace) ──

/** Remplace toutes les occurrences dans tous les fichiers correspondants. */
async function doReplaceAll() {
  const query = searchInput.value;
  const replacement = searchReplaceInput ? searchReplaceInput.value : "";
  const useRegex = searchRegexToggle && searchRegexToggle.checked;
  const extensions = searchExtInput.value.trim();

  if (!query) {
    toastWarning("Saisir un texte à remplacer");
    return;
  }

  // D'abord compter les occurrences via une recherche (aperçu de confirmation)
  let preview = null;
  try {
    preview = await invoke("search_in_files", {
      query,
      useRegex,
      extensions,
      maxResults: 10000,
    });
  } catch (e) {
    toastError("Erreur aperçu : " + e);
    return;
  }

  const totalOccurrences = preview ? preview.length : 0;
  const totalFiles = new Set(preview ? preview.map((r) => r.path) : []).size;

  if (totalOccurrences === 0) {
    toastInfo("Aucune occurrence à remplacer");
    return;
  }

  const ok = confirm(
    `Remplacer ${totalOccurrences} occurrence${totalOccurrences > 1 ? "s" : ""} ` +
    `dans ${totalFiles} fichier${totalFiles > 1 ? "s" : ""} ?\n\n` +
    `Recherche : ${query}\nRemplacement : ${replacement || "(vide)"}`
  );
  if (!ok) return;

  try {
    const res = await invoke("replace_in_files", {
      query,
      replacement,
      useRegex,
      extensions,
    });
    toastSuccess(
      `${res.occurrences} occurrence${res.occurrences > 1 ? "s" : ""} remplacée${res.occurrences > 1 ? "s" : ""} ` +
      `dans ${res.files_modified} fichier${res.files_modified > 1 ? "s" : ""}`
    );
    // Recharger les onglets ouverts concernés pour refléter le disque
    refreshOpenTabs(res.modified || []);
    // Relancer la recherche pour mettre à jour les résultats
    doSearch();
  } catch (e) {
    toastError("Erreur remplacement : " + e);
  }
}

/** Recharge le contenu des onglets d'édition ouverts dont le fichier a été
 *  modifié par le remplacement global (évite un affichage obsolète). */
function refreshOpenTabs(modifiedRels) {
  if (!tabsManager || !modifiedRels.length) return;
  const project = (window._pilotProjectPath || "").replace(/\\/g, "/").replace(/\/$/, "");
  const set = new Set(modifiedRels.map((r) => r.replace(/\\/g, "/")));
  for (const tab of tabsManager.tabs) {
    if (!tab.path || !tab.view) continue;
    const normPath = tab.path.replace(/\\/g, "/");
    let rel = null;
    if (project && normPath.startsWith(project + "/")) {
      rel = normPath.slice(project.length + 1);
    }
    if (rel && set.has(rel)) {
      if (!tab.dirty) {
        invoke("read_file_content", { path: tab.path })
          .then((content) => {
            setContent(tab.view, content);
            tab.savedContent = content;
          })
          .catch(() => {});
      } else {
        toastWarning(`« ${tab.name} » non rechargé (modifications non sauvegardées)`);
      }
    }
  }
}