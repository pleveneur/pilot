// sidebar.js - Barre latérale : explorateur de projet + arborescence

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { updateFileList } from "./file-list.js";
import { exportMarkdownToPdf } from "./pdf-export.js";
import { convertPdfToMd } from "./pdf-to-markdown.js";
import { agentDisplayLabel, agentDisplayPhrase } from "./backend-info.js";
import { openGitDiffModal } from "./diff-view.js";
import { restoreTabs, saveTabSession } from "./session-persistence.js";
import { showLoading, hideLoading } from "./loading.js";
import { loadModelAliases } from "./agent-pi.js";
import { toastError, toastSuccess, toastInfo } from "./toast.js";

// Mapping extension → emoji for file type icons
const FILE_ICONS = {
  // Markdown & docs
  '.md': '📝', '.mdx': '📝', '.markdown': '📝',
  // Web
  '.html': '🌐', '.htm': '🌐', '.css': '🎨', '.js': '🟨', '.mjs': '🟨',
  '.ts': '🔷', '.jsx': '⚛️', '.tsx': '⚛️', '.vue': '💚', '.svelte': '🧡',
  // Data
  '.json': '📋', '.yaml': '📋', '.yml': '📋', '.toml': '⚙️', '.xml': '📋',
  '.csv': '📊', '.tsv': '📊',
  // Scripts
  '.py': '🐍', '.rb': '💎', '.php': '🐘', '.sh': '💻', '.bash': '💻',
  '.ps1': '💻', '.bat': '💻', '.cmd': '💻',
  // Rust / systems
  '.rs': '🦀', '.c': '⚙️', '.cpp': '⚙️', '.h': '⚙️', '.hpp': '⚙️',
  '.go': '🔵', '.java': '☕', '.kt': '🟪', '.swift': '🕊️',
  // Config
  '.gitignore': '⚙️', '.env': '🔒', '.dockerignore': '🐳',
  // Images
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '🖼️',
  '.webp': '🖼️', '.bmp': '🖼️', '.ico': '🖼️',
  // PDF & docs
  '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.xls': '📗', '.xlsx': '📗',
  '.ppt': '📙', '.pptx': '📙', '.txt': '📄',
  // Archives
  '.zip': '📦', '.tar': '📦', '.gz': '📦', '.rar': '📦', '.7z': '📦',
  // Others
  '.lock': '🔒', '.log': '📜',
};

/**
 * Returns the emoji icon for a given file name based on its extension.
 * @param {string} fileName
 * @returns {string}
 */
function getFileIcon(fileName) {
  const lower = fileName.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return '📄';
  const ext = lower.substring(dotIdx);
  return FILE_ICONS[ext] || '📄';
}

class Sidebar {
  constructor(tabsManager) {
    this.tabs = tabsManager;
    this.treeContainer = document.getElementById("file-tree");
    this.projectName = document.getElementById("project-name");
    this.btnOpen = document.getElementById("btn-open-project");
    this.dropdown = document.getElementById("projects-dropdown");
    this.ddNewProject = document.getElementById("dd-new-project");
    this.ddRecentList = document.getElementById("dd-recent-list");
    this.ddCloseProject = document.getElementById("dd-close-project");
    this.ddCloseSeparator = document.getElementById("dd-close-separator");
    this.contextMenu = document.getElementById("context-menu");
    this.ctxPreview = document.getElementById("ctx-preview");
    this.ctxPreviewCsv = document.getElementById("ctx-preview-csv");
    this.ctxExportPdf = document.getElementById("ctx-export-pdf");
    this.ctxOpenBrowser = document.getElementById("ctx-open-browser");
    this.ctxSendAgent = document.getElementById("ctx-send-agent");
    this.ctxAddPromptBuilder = document.getElementById("ctx-add-prompt-builder");
    this.ctxCreateFile = document.getElementById("ctx-create-file");
    this.ctxRename = document.getElementById("ctx-rename");
    this.ctxDelete = document.getElementById("ctx-delete");
    this.ctxCreateFolder = document.getElementById("ctx-create-folder");
    this.ctxCreateMd = document.getElementById("ctx-create-md");
    this.ctxGitDiff = document.getElementById("ctx-git-diff");
    this.contextMenuPath = null;
    this.contextMenuIsDir = false;
    this.treeData = null; // FileNode racine
    this.filterInput = document.getElementById("tree-filter");
    this.filterWrapper = document.getElementById("tree-filter-wrapper");
    this.filterQuery = "";
    this.unlistenFileChange = null;
    this._forceExpandPaths = new Set();
    this._rebuildTimer = null; // Timer de debounce pour _rebuildTree
    this._rebuildPending = false; // Un rebuild est-il déjà en cours ?
    this.favoritesSection = document.getElementById("favorites-section");
    this.favorites = [];
    // ── Git intégré (C1) : statut par fichier + dossiers « dirty » ──
    this.gitStatus = null; // { is_repo, entries }
    this.gitByAbs = new Map(); // absPath -> { letter, cls, code }
    this.gitDirtyDirs = new Set(); // absPath de dossiers contenant un fichier modifié


    // Filtre de l'arborescence
    this.filterInput.addEventListener("input", () => {
      this.filterQuery = this.filterInput.value.trim();
      this._renderTree();
    });

    // Raccourci Ctrl+P pour focus le filtre
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && !this.filterWrapper.classList.contains("hidden")) {
        e.preventDefault();
        this.filterInput.focus();
        this.filterInput.select();
      }
    });
  }

  async init() {
    // Séparateur sidebar draggable + persistance
    this._initSidebarResize();

    // Bouton Projets → toggle dropdown
    this.btnOpen.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggleProjectsDropdown();
    });

    // Dropdown : Nouveau projet
    this.ddNewProject.addEventListener("click", () => {
      this._hideProjectsDropdown();
      this.openProject();
    });

    // Dropdown : Fermer le projet
    this.ddCloseProject.addEventListener("click", () => {
      this._hideProjectsDropdown();
      this.closeProject();
    });

    // Fermer le dropdown au clic extérieur
    document.addEventListener("click", (e) => {
      if (!this.dropdown.classList.contains("hidden")) {
        this._hideProjectsDropdown();
      }
      this.hideContextMenu();
    });

    // Menu contextuel
    this.ctxPreviewCsv.addEventListener("click", () => {
      if (this.contextMenuPath && !this.contextMenuIsDir) {
        this.tabs.openFile(this.contextMenuPath, "csv");
      }
      this.hideContextMenu();
    });

    this.ctxPreview.addEventListener("click", () => {
      if (this.contextMenuPath && !this.contextMenuIsDir) {
        this.tabs.openFile(this.contextMenuPath, "preview");
      }
      this.hideContextMenu();
    });

    this.ctxExportPdf.addEventListener("click", async () => {
      if (!this.contextMenuPath || this.contextMenuIsDir) return;
      const mdPath = this.contextMenuPath;
      this.hideContextMenu();
      await exportMarkdownToPdf(mdPath);
    });

    this.ctxOpenBrowser.addEventListener("click", async () => {
      if (!this.contextMenuPath || this.contextMenuIsDir) return;
      try {
        await invoke("open_in_browser", { path: this.contextMenuPath });
      } catch (err) {
        toastError("Erreur : " + err);
      }
      this.hideContextMenu();
    });

    this.ctxSendAgent.addEventListener("click", async () => {
      if (!this.contextMenuPath || this.contextMenuIsDir) return;
      const targetPath = this.contextMenuPath;
      const isDir = this.contextMenuIsDir;
      this.hideContextMenu();
      try {
        await this.tabs.openFile(agentDisplayLabel(), "agent");
        await new Promise((resolve) => setTimeout(resolve, 500));
        const message = isDir
          ? `Analyse le contenu du dossier \`${targetPath}\` et donne-moi un résumé.`
          : `Regarde le fichier \`${targetPath}\` et dis-moi ce que tu en penses.`;
        await invoke("send_agent_prompt", { message });
      } catch (err) {
        toastError(`Erreur ${agentDisplayPhrase()} : ` + err);
      }
    });

    this.ctxAddPromptBuilder.addEventListener("click", async () => {
      if (!this.contextMenuPath || this.contextMenuIsDir) return;
      const path = this.contextMenuPath;
      this.hideContextMenu();

      // Ouvrir le Prompt Builder s'il n'est pas déjà ouvert
      if (window._pilotTabs) {
        const existing = window._pilotTabs.tabs.find(t => t.mode === "prompt-builder");
        if (!existing) {
          await window._pilotTabs.openFile("Prompt Builder", "prompt-builder");
          // Attendre l'initialisation pour que l'écouteur d'événement soit en place
          await new Promise(r => setTimeout(r, 300));
        } else {
          window._pilotTabs.switchTab(existing.id);
        }
      }

      // Émettre un événement pour que le Prompt Builder ajoute ce fichier
      document.dispatchEvent(new CustomEvent("prompt-builder-add-file", { detail: { path } }));
    });

    this.ctxRename.addEventListener("click", () => {
      this._handleRename();
      this.hideContextMenu();
    });

    this.ctxCreateFile.addEventListener("click", () => {
      this._handleCreateFile();
      this.hideContextMenu();
    });

    this.ctxDelete.addEventListener("click", () => {
      this._handleDelete();
      this.hideContextMenu();
    });

    this.ctxCreateFolder.addEventListener("click", () => {
      this._handleCreateFolder();
      this.hideContextMenu();
    });

    this.ctxCreateMd.addEventListener("click", async () => {
      if (!this.contextMenuPath || this.contextMenuIsDir) return;
      const pdfPath = this.contextMenuPath;
      this.hideContextMenu();
      try {
        const mdPath = await convertPdfToMd(pdfPath);
        // Le watcher détectera la création du fichier et rafraîchira l'arbre
      } catch (err) {
        toastError("Erreur conversion PDF \u2192 Markdown : " + err);
      }
    });

    this.ctxFavorite = document.getElementById("ctx-favorite");
    this.ctxFavorite.addEventListener("click", () => {
      if (this.contextMenuPath) {
        this.toggleFavorite(this.contextMenuPath);
      }
      this.hideContextMenu();
    });

    // Git diff (C1) : ouvre la modale de diff visuel vs version commitée.
    if (this.ctxGitDiff) {
      this.ctxGitDiff.addEventListener("click", async () => {
        const path = this.contextMenuPath;
        this.hideContextMenu();
        if (!path) return;
        try {
          const res = await invoke("git_diff_file", { path });
          const name = path.replace(/\\/g, "/").split("/").pop() || path;
          openGitDiffModal({
            before: res.before,
            after: res.after,
            title: name,
            subtitle: res.tracked ? "vs HEAD" : "fichier non suivi (nouveau)",
          });
        } catch (e) {
          toastError("Diff Git indisponible : " + e);
        }
      });
    }

    document.addEventListener("click", () => this.hideContextMenu());

    // Écouter les changements de fichiers
    this.unlistenFileChange = await listen("file-change", (event) => {
      this._handleFileChange(event.payload);
    });
  }

  async openProjectByPath(folderPath) {
    // Fermer tous les onglets du projet précédent (sans confirmation pour l'agent)
    const hadAgentTab = this._closeAllTabs();

    // Stocker le chemin du projet pour la résolution des images
    window._pilotProjectPath = folderPath;

    // Recharger les alias de modèles (model-switch.json)
    loadModelAliases();

    showLoading("Chargement du projet…");
    try {
      const [tree, gitStatus] = await Promise.all([
        invoke("open_project_path", { path: folderPath }),
        invoke("git_status").catch(() => null),
      ]);
      this.treeData = tree;
      this.gitStatus = gitStatus || { is_repo: false, entries: {} };
      this._rebuildGitMaps();
      const name = folderPath.replace(/\\/g, "/").split("/").pop() || folderPath;
      this.projectName.textContent = name;
      this._renderTree();
      this._loadFavorites();
      this._showProjectButtons();
      invoke("set_window_title", { title: `Pilot ${folderPath}` }).catch(() => {});

      // Restaurer les onglets de la session précédente
      restoreTabs(this.tabs, folderPath);

      // Rouvrir l'agent si on avait un onglet agent ouvert
      if (hadAgentTab) {
        await this.tabs.openFile(agentDisplayLabel(), "agent");
      }
      toastSuccess("Projet ouvert : " + name);
    } catch (e) {
      toastError("Erreur ouverture projet : " + e);
    } finally {
      hideLoading();
    }
  }

  /// Resync visuel suite à un changement de projet initié à distance (web). Le
  /// backend a déjà mis à jour project_path + watcher et (depuis le web) redémarré
  /// pi sur le nouveau cwd ; on recharge l'UI (arborescence, titre, favoris, alias
  /// modèles) sans rappeler open_project_path (réemmettrait project_changed →
  /// boucle) et sans toucher à pi ni aux onglets.
  async resyncProjectFromRemote(path) {
    window._pilotProjectPath = path;
    try {
      const [tree, gitStatus] = await Promise.all([
        invoke("refresh_tree"),
        invoke("git_status").catch(() => null),
      ]);
      this.treeData = tree;
      this.gitStatus = gitStatus || { is_repo: false, entries: {} };
      this._rebuildGitMaps();
      const name = path.replace(/\\/g, "/").split("/").pop() || path;
      this.projectName.textContent = name;
      this._renderTree();
      this._loadFavorites();
      this._showProjectButtons();
      loadModelAliases();
      invoke("set_window_title", { title: "Pilot " + path }).catch(() => {});
    } catch (e) {
      console.warn("[remote] resync projet distant échoué :", e);
    }
  }

  async openProject() {
    try {
      const folder = await open({ directory: true, multiple: false });
      if (!folder) return; // Annulé
      await this.openProjectByPath(folder);
    } catch (e) {
      console.error("Erreur ouverture projet:", e);
    }
  }

  // ── Git intégré (C1) ──
  // Charge le statut Git du projet (CLI `git status --porcelain`). Résultat mis
  // en cache dans `this.gitStatus` ; les maps `gitByAbs`/`gitDirtyDirs` sont
  // reconstruites pour le rendu. À appeler après chaque rebuild de l'arbre.
  async _loadGitStatus() {
    try {
      this.gitStatus = await invoke("git_status");
    } catch (e) {
      this.gitStatus = { is_repo: false, entries: {} };
    }
    this._rebuildGitMaps();
  }

  // Reconstruit `gitByAbs` (absPath -> badge) et `gitDirtyDirs` (Set absPath
  // dossier) depuis `this.gitStatus.entries` (chemins relatifs au cwd projet).
  _rebuildGitMaps() {
    this.gitByAbs = new Map();
    this.gitDirtyDirs = new Set();
    const root = this.treeData ? this.treeData.path : window._pilotProjectPath;
    if (!this.gitStatus || !this.gitStatus.is_repo || !root) return;
    const entries = this.gitStatus.entries || {};
    const normSep = (p) => p.replace(/\\/g, "/");
    const joinNorm = (base, rel) => {
      const r = normSep(rel);
      // Le relPath Git utilise '/'. On reconstitue l'absolu via le root.
      let abs = normSep(base) + "/" + r;
      // Nettoyer les doubles slash éventuels.
      abs = abs.replace(/\/+/g, "/");
      return abs;
    };
    for (const [relPath, code] of Object.entries(entries)) {
      const abs = joinNorm(root, relPath);
      this.gitByAbs.set(abs, this._gitBadgeFor(code));
      // Marquer chaque dossier ancêtre comme « dirty ».
      const parts = normSep(relPath).split("/");
      parts.pop(); // retirer le nom de fichier
      let acc = normSep(root);
      for (const seg of parts) {
        acc = acc + "/" + seg;
        this.gitDirtyDirs.add(acc.replace(/\/+/g, "/"));
      }
    }
  }

  // Déduit le badge (lettre + classe CSS) depuis un code porcelain v1 `XY`.
  _gitBadgeFor(code) {
    if (!code || code === "??") return { letter: "?", cls: "git-badge-untracked", code };
    const x = code[0];
    const y = code[1];
    if (x === "D" || y === "D") return { letter: "D", cls: "git-badge-deleted", code };
    if (x === "A") return { letter: "A", cls: "git-badge-staged", code };
    if (x === "R" || x === "C") return { letter: x, cls: "git-badge-staged", code };
    if (x !== " " && x !== "?") return { letter: "M", cls: "git-badge-staged", code };
    return { letter: "M", cls: "git-badge-modified", code };
  }

  _renderTree() {
    this.treeContainer.innerHTML = "";
    if (!this.treeData) return;

    // Afficher le filtre
    this.filterWrapper.classList.remove("hidden");

    // Filtrer l'arbre si une query est active
    let children = this.treeData.children || [];
    if (this.filterQuery) {
      children = children
        .map(c => this._filterNode(c, this.filterQuery.toLowerCase()))
        .filter(c => c !== null);
    }

    if (children.length > 0) {
      for (const child of children) {
        this._renderNode(this.treeContainer, child, 0);
      }
    } else if (this.filterQuery) {
      this.treeContainer.innerHTML = '<p class="empty-message">Aucun résultat</p>';
    } else {
      this.treeContainer.innerHTML = '<p class="empty-message">Dossier vide</p>';
    }

    // Clic droit sur la zone vide de l'arbre → créer à la racine du projet
    this.treeContainer.addEventListener("contextmenu", (e) => {
      // Ne pas interférer avec le contextmenu des rows (fichiers/dossiers)
      if (e.target.closest(".tree-row")) return;
      e.preventDefault();
      // Utiliser le chemin du projet comme parent
      const rootPath = this.treeData ? this.treeData.path : null;
      this._showContextMenu(e.clientX, e.clientY, null, false);
    });

    // Mettre à jour la liste des fichiers pour l'auto-complétion
    updateFileList(this.treeData.children || []);
  }

  _renderNode(container, node, level) {
    const nodeDiv = document.createElement("div");
    nodeDiv.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = 8 + level * 16 + "px";
    row.dataset.path = node.path;
    row.dataset.isDir = String(node.is_dir);

    if (node.is_dir) {
      const hasChildren = node.children && node.children.length > 0;
      const arrow = hasChildren ? "▶" : "";
      const dirDirty = this.gitDirtyDirs.has(node.path.replace(/\\/g, "/"));
      const dirBadge = dirDirty ? ` <span class="git-badge git-badge-dir" title="Contient des modifications Git">•</span>` : "";
      row.innerHTML = `<span class="arrow">${arrow}</span><span class="icon">📁</span><span class="name">${this._esc(node.name)}</span>${dirBadge}`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!hasChildren) return;
        const children = nodeDiv.querySelector(":scope > .tree-children");
        if (children) {
          children.classList.toggle("expanded");
          const icon = row.querySelector(".icon");
          icon.textContent = children.classList.contains("expanded")
            ? "📂"
            : "📁";
          const arrowEl = row.querySelector(".arrow");
          arrowEl.textContent = children.classList.contains("expanded")
            ? "▼"
            : "▶";
        }
      });
      // Clic droit sur un dossier → "Créer un fichier"
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showContextMenu(e.clientX, e.clientY, node.path, true);
      });
    } else {
      const icon = getFileIcon(node.name);
      const gitBadge = this.gitByAbs.get(node.path.replace(/\\/g, "/"));
      const badgeHtml = gitBadge ? ` <span class="git-badge ${gitBadge.cls}" title="Git ${gitBadge.code}">${gitBadge.letter}</span>` : "";
      row.innerHTML = `<span class="icon">${icon}</span><span class="name">${this._esc(node.name)}</span>${badgeHtml}`;

      row.addEventListener("click", () => {
        this.tabs.openFile(node.path, "edit");
      });

      // Clic droit sur tous les fichiers → "Supprimer" (+ "Prévisualiser" si .md)
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showContextMenu(e.clientX, e.clientY, node.path, false);
      });
    }

    nodeDiv.appendChild(row);

    if (node.is_dir && node.children && node.children.length > 0) {
      const childrenDiv = document.createElement("div");
      childrenDiv.className = "tree-children";
      for (const child of node.children) {
        this._renderNode(childrenDiv, child, level + 1);
      }
      nodeDiv.appendChild(childrenDiv);
    }

    container.appendChild(nodeDiv);
  }

  /**
   * Filtre récursivement un nœud de l'arborescence.
   * Retourne le nœud filtré (avec enfants filtrés) ou null si aucun match.
   */
  _filterNode(node, query) {
    // Si c'est un dossier, filtrer récursivement les enfants
    if (node.is_dir && node.children && node.children.length > 0) {
      const filteredChildren = node.children
        .map(c => this._filterNode(c, query))
        .filter(c => c !== null);
      // On garde le dossier s'il a au moins un enfant qui match, ou si son nom contient la query
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }
    // Pour un fichier, on garde si le nom contient la query
    if (node.name.toLowerCase().includes(query)) {
      return node;
    }
    return null;
  }

  async _handleCreateFolder() {
    let parentDir = this.contextMenuPath || this.treeData?.path;
    if (!parentDir) return;
    if (!this.contextMenuIsDir && this.contextMenuPath) {
      const parts = parentDir.replace(/\\/g, "/").split("/");
      parts.pop();
      parentDir = parts.join("/") || parentDir;
    }

    const name = prompt("Nom du dossier à créer :");
    if (!name || !name.trim()) return;

    const sep = parentDir.includes("\\") ? "\\" : "/";
    const folderPath = parentDir + sep + name.trim();

    try {
      this._forceExpandPaths.add(parentDir);
      await invoke("create_folder", { path: folderPath });
      toastSuccess("Dossier créé");
    } catch (e) {
      toastError("Erreur : " + e);
    }
  }

  async _handleRename() {
    const target = this.contextMenuPath;
    if (!target) return;
    const oldName = target.replace(/\\/g, "/").split("/").pop();
    const newName = prompt(`Renommer "${oldName}" en :`, oldName);
    if (!newName || newName.trim() === "" || newName.trim() === oldName) return;

    try {
      const newPath = await invoke("rename_file_or_dir", {
        sourcePath: target,
        newName: newName.trim(),
      });
      // Mettre à jour les onglets ouverts correspondants
      if (this.contextMenuIsDir) {
        this.tabs.renameFolderTabs(target, newPath);
      } else {
        this.tabs.renameTabPath(target, newPath);
      }
      // Rafraîchir l'arbre
      await this._rebuildTree();
      toastSuccess("Renommé en " + newName.trim());
    } catch (e) {
      toastError("Erreur : " + e);
    }
  }

  async _handleDelete() {
    const target = this.contextMenuPath;
    if (!target) return;
    const name = target.replace(/\\/g, "/").split("/").pop();
    const isDir = this.contextMenuIsDir;
    const msg = isDir
      ? `Supprimer le dossier "${name}" et tout son contenu ?`
      : `Supprimer le fichier "${name}" ?`;
    if (!await confirm(msg, { title: "Pilot", kind: "warning" })) return;

    try {
      await invoke("delete_file_or_dir", { path: target });
      // Fermer les onglets concernés (le fichier lui-même + tous les fichiers du dossier)
      if (isDir) {
        const prefix = target.replace(/\\/g, "/").replace(/\/?$/, "/");
        for (const tab of [...this.tabs.tabs]) {
          if (tab.path.replace(/\\/g, "/").startsWith(prefix)) {
            this.tabs.closeTabByPath(tab.path);
          }
        }
      } else {
        this.tabs.closeTabByPath(target);
      }
      // Rafraîchir l'arbre
      await this._rebuildTree();
      toastSuccess(isDir ? "Dossier supprimé" : "Fichier supprimé");
    } catch (e) {
      toastError("Erreur : " + e);
    }
  }

  async _handleCreateFile() {
    // Déterminer le dossier parent
    let parentDir = this.contextMenuPath || this.treeData?.path;
    if (!parentDir) return;
    if (!this.contextMenuIsDir && this.contextMenuPath) {
      // Si on a fait clic droit sur un fichier, utiliser son dossier parent
      const parts = parentDir.replace(/\\/g, "/").split("/");
      parts.pop();
      parentDir = parts.join("/") || parentDir;
    }

    const name = prompt("Nom du fichier à créer :");
    if (!name || !name.trim()) return;

    const sep = parentDir.includes("\\") ? "\\" : "/";
    const filePath = parentDir + sep + name.trim();

    try {
      this._forceExpandPaths.add(parentDir);
      await invoke("create_file", { path: filePath });
      // Le watcher va détecter la création et rafraîchir l'arbre.
      // On ouvre le fichier directement dans l'éditeur.
      this.tabs.openFile(filePath, "edit");
      toastSuccess("Fichier créé");
    } catch (e) {
      toastError("Erreur : " + e);
    }
  }

  _showContextMenu(x, y, path, isDir = false) {
    this.contextMenuPath = path;
    this.contextMenuIsDir = isDir;

    // Afficher/masquer les boutons selon le contexte
    if (isDir) {
      // Dossier → "Créer un fichier" + "Créer un dossier" + "Renommer" + "Supprimer"
      this.ctxPreview.style.display = "none";
      this.ctxPreviewCsv.style.display = "none";
      this.ctxExportPdf.style.display = "none";
      this.ctxOpenBrowser.style.display = "none";
      this.ctxSendAgent.style.display = "";
      this.ctxSendAgent.textContent = "📤 Analyser ce dossier";
      this.ctxAddPromptBuilder.style.display = "none";
      this.ctxCreateFile.style.display = "";
      this.ctxCreateFolder.style.display = "";
      this.ctxRename.style.display = "";
      this.ctxDelete.style.display = "";
      this.ctxCreateMd.style.display = "none";
      this.ctxFavorite.style.display = "";
      this.ctxFavorite.textContent = this.isFavorite(path) ? "⭐ Retirer des favoris" : "⭐ Ajouter aux favoris";
      if (this.ctxGitDiff) this.ctxGitDiff.style.display = "none";
    } else if (!path) {
      // Zone vide → "Créer un fichier" + "Créer un dossier"
      this.ctxPreview.style.display = "none";
      this.ctxPreviewCsv.style.display = "none";
      this.ctxExportPdf.style.display = "none";
      this.ctxOpenBrowser.style.display = "none";
      this.ctxSendAgent.style.display = "none";
      this.ctxAddPromptBuilder.style.display = "none";
      this.ctxCreateFile.style.display = "";
      this.ctxCreateFolder.style.display = "";
      this.ctxRename.style.display = "none";
      this.ctxDelete.style.display = "none";
      this.ctxCreateMd.style.display = "none";
      this.ctxFavorite.style.display = "none";
      if (this.ctxGitDiff) this.ctxGitDiff.style.display = "none";
    } else {
      // Fichier → "Prévisualiser" (.md/.pdf) + "Prévisualiser le CSV" (.csv) + "PDF" (si .md) + "🌐" (si .html) + "📤 Agent Pi" + "Renommer" + "Supprimer"
      const isMd = path.endsWith(".md");
      const isPdf = path.endsWith(".pdf");
      const isCsv = path.endsWith(".csv");
      const isHtml = path.endsWith(".html") || path.endsWith(".htm");
      this.ctxPreview.style.display = (isMd || isPdf) ? "" : "none";
      this.ctxPreviewCsv.style.display = isCsv ? "" : "none";
      if (isPdf) {
        this.ctxPreview.textContent = "📕 Prévisualiser le PDF";
      } else {
        this.ctxPreview.textContent = "👁️ Prévisualiser";
      }
      this.ctxExportPdf.style.display = isMd ? "" : "none";
      this.ctxOpenBrowser.style.display = isHtml ? "" : "none";
      this.ctxSendAgent.style.display = "";
      this.ctxSendAgent.textContent = `📤 Envoyer à ${agentDisplayPhrase()}`;
      this.ctxAddPromptBuilder.style.display = "";
      this.ctxCreateFile.style.display = "none";
      this.ctxCreateFolder.style.display = "none";
      this.ctxRename.style.display = "";
      this.ctxDelete.style.display = "";
      this.ctxCreateMd.style.display = isPdf ? "" : "none";
      this.ctxFavorite.style.display = "";
      this.ctxFavorite.textContent = this.isFavorite(path) ? "⭐ Retirer des favoris" : "⭐ Ajouter aux favoris";
      // Git diff (C1) : visible seulement si le projet est un repo Git et que le
      // fichier a un statut (modifié/staged/non suivi). Sinon masqué.
      const gitBadge = this.gitStatus && this.gitStatus.is_repo ? this.gitByAbs.get(path.replace(/\\/g, "/")) : null;
      if (this.ctxGitDiff) this.ctxGitDiff.style.display = gitBadge ? "" : "none";
    }

    this.contextMenu.classList.remove("hidden");
    this.contextMenu.style.left = x + "px";
    this.contextMenu.style.top = y + "px";
  }

  /**
   * Sauvegarde les dossiers actuellement dépliés dans l'arbre
   */
  _saveExpandedState() {
    const expanded = new Set();
    this.treeContainer.querySelectorAll(".tree-children.expanded").forEach((el) => {
      const row = el.previousElementSibling;
      if (row && row.dataset.path) {
        expanded.add(row.dataset.path);
      }
    });
    return expanded;
  }

  /**
   * Restaure l'état d'expansion après un rebuild
   */
  _restoreExpandedState(expandedPaths) {
    if (!expandedPaths || expandedPaths.size === 0) return;
    this.treeContainer.querySelectorAll(".tree-row").forEach((row) => {
      if (expandedPaths.has(row.dataset.path)) {
        const nodeDiv = row.parentElement;
        if (!nodeDiv) return;
        const children = nodeDiv.querySelector(":scope > .tree-children");
        if (children) {
          children.classList.add("expanded");
          const icon = row.querySelector(".icon");
          if (icon) icon.textContent = "📂";
          const arrowEl = row.querySelector(".arrow");
          if (arrowEl) arrowEl.textContent = "▼";
        }
      }
    });
  }



  hideContextMenu() {
    this.contextMenu.classList.add("hidden");
    this.contextMenuPath = null;
  }

  _handleFileChange(payload) {
    // On ignore les événements si aucun projet n'est ouvert
    if (!this.treeData) return;

    const path = payload.path;
    const kind = payload.kind;

    // Recharger le fichier dans l'onglet si ouvert
    if (kind === "modify") {
      this.tabs.refreshFile(path);
    }

    // Debounce : attendre 500ms d'inactivité avant de reconstruire l'arbre.
    // Cela évite de lancer 50 rebuilds quand un agent IA modifie 50 fichiers.
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTree();
    }, 500);
  }

  async _rebuildTree() {
    // Éviter les rebuilds concurrents : si un rebuild est déjà en cours,
    // on planifie un nouveau rebuild après la fin du précédent.
    if (this._rebuildPending) {
      // Reprogrammer pour dans 300ms
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => this._rebuildTree(), 300);
      return;
    }
    this._rebuildPending = true;

    try {
      // Sauvegarder l'état d'expansion avant rebuild
      const expanded = this._saveExpandedState();
      // Ajouter les chemins à forcer
      for (const p of this._forceExpandPaths) {
        expanded.add(p);
      }
      // Ne pas vider immédiatement : une création déclenche plusieurs
      // événements watcher (fichier + dossier parent), tous doivent
      // bénéficier des mêmes chemins forcés.
      if (this._forceExpandTimer) clearTimeout(this._forceExpandTimer);
      this._forceExpandTimer = setTimeout(() => {
        this._forceExpandPaths.clear();
      }, 3000);

      const [tree, gitStatus] = await Promise.all([
        invoke("refresh_tree"),
        invoke("git_status").catch(() => null),
      ]);
      if (tree) {
        this.treeData = tree;
        this.gitStatus = gitStatus || { is_repo: false, entries: {} };
        this._rebuildGitMaps();
        this._renderTree();
        // Restaurer l'état d'expansion
        this._restoreExpandedState(expanded);
      }
    } catch (_) {
      // Pas grave si la commande n'existe pas encore
    } finally {
      this._rebuildPending = false;
    }
  }

  _esc(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Favoris / Bookmarks ──

  async _loadFavorites() {
    try {
      const config = await invoke("get_config");
      this.favorites = config.favorites || [];
    } catch (_) {
      this.favorites = [];
    }
    this._renderFavorites();
  }

  _renderFavorites() {
    const section = this.favoritesSection;
    if (!section) return;

    const projectPath = window._pilotProjectPath;
    if (!projectPath || this.favorites.length === 0) {
      section.classList.add("hidden");
      section.innerHTML = "";
      return;
    }

    // Filter favorites for current project
    const prefix = projectPath.replace(/\\/g, "/").replace(/\/?$/, "/");
    const projectFavorites = this.favorites.filter(f => {
      const normalized = f.replace(/\\/g, "/");
      return normalized.startsWith(prefix);
    });

    if (projectFavorites.length === 0) {
      section.classList.add("hidden");
      section.innerHTML = "";
      return;
    }

    section.classList.remove("hidden");

    let html = `<div class="favorites-header" data-expanded="true">
      <span class="favorites-arrow">▼</span>
      <span class="favorites-icon">⭐</span>
      <span class="favorites-title">Favoris</span>
      <span class="favorites-count">${projectFavorites.length}</span>
    </div>`;
    html += '<div class="favorites-list">';

    for (const favPath of projectFavorites) {
      const fileName = favPath.replace(/\\/g, "/").split("/").pop();
      const icon = getFileIcon(fileName);
      const relPath = favPath.replace(/\\/g, "/").substring(prefix.length);
      html += `<div class="favorite-row" data-path="${this._esc(favPath)}" title="${this._esc(relPath)}">
        <span class="icon">${icon}</span>
        <span class="name">${this._esc(fileName)}</span>
      </div>`;
    }

    html += '</div>';
    section.innerHTML = html;

    // Click handlers for favorite rows
    section.querySelectorAll(".favorite-row").forEach(row => {
      row.addEventListener("click", () => {
        this.tabs.openFile(row.dataset.path, "edit");
      });
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const path = row.dataset.path;
        // Determine if directory by checking the tree
        const isDir = this._isDirectoryInTree(path) === true;
        this._showContextMenu(e.clientX, e.clientY, path, isDir);
      });
    });

    // Toggle collapse for favorites header
    const header = section.querySelector(".favorites-header");
    if (header) {
      header.addEventListener("click", () => {
        const list = section.querySelector(".favorites-list");
        const isExpanded = header.dataset.expanded === "true";
        if (isExpanded) {
          list.style.display = "none";
          header.querySelector(".favorites-arrow").textContent = "▶";
          header.dataset.expanded = "false";
        } else {
          list.style.display = "";
          header.querySelector(".favorites-arrow").textContent = "▼";
          header.dataset.expanded = "true";
        }
      });
    }
  }

  async toggleFavorite(path) {
    if (this.isFavorite(path)) {
      try {
        await invoke("remove_favorite", { path });
        this.favorites = this.favorites.filter(f => f !== path);
        toastInfo("Retiré des favoris");
      } catch (err) {
        toastError("Erreur : " + err);
      }
    } else {
      try {
        await invoke("add_favorite", { path });
        this.favorites.push(path);
        toastSuccess("Ajouté aux favoris");
      } catch (err) {
        toastError("Erreur : " + err);
      }
    }
    this._renderFavorites();
  }

  isFavorite(path) {
    return this.favorites.includes(path);
  }

  _isDirectoryInTree(path, node) {
    if (!node) {
      node = this.treeData;
    }
    if (!node) return null;
    if (node.path === path) return node.is_dir;
    if (node.children) {
      for (const child of node.children) {
        const result = this._isDirectoryInTree(path, child);
        if (result !== null) return result;
      }
    }
    return null;
  }

  // ── Dropdown Projets ──

  async _toggleProjectsDropdown() {
    if (this.dropdown.classList.contains("hidden")) {
      await this._loadRecentProjects();
      this.dropdown.classList.remove("hidden");
    } else {
      this._hideProjectsDropdown();
    }
  }

  _hideProjectsDropdown() {
    this.dropdown.classList.add("hidden");
  }

  async _loadRecentProjects() {
    try {
      const projects = await invoke("get_recent_projects");
      this.ddRecentList.innerHTML = "";
      if (projects.length === 0) {
        this.ddRecentList.innerHTML =
          '<div class="dd-empty">Aucun projet récent</div>';
        return;
      }
      for (const p of projects) {
        const name = p.replace(/\\/g, "/").split("/").pop();
        const btn = document.createElement("button");
        btn.className = "dd-recent-item";
        btn.innerHTML = `<span class="dd-recent-icon">📂</span><span class="dd-recent-name">${this._esc(name)}</span><span class="dd-recent-path">${this._esc(p)}</span>`;
        btn.addEventListener("click", () => {
          this._hideProjectsDropdown();
          this.openProjectByPath(p);
        });
        this.ddRecentList.appendChild(btn);
      }
    } catch (_) {
      // Ignorer
    }
  }

  _showProjectButtons() {
    document.querySelectorAll(".project-only").forEach((b) =>
      b.classList.remove("hidden")
    );
    this.ddCloseProject.classList.remove("hidden");
    this.ddCloseSeparator.classList.remove("hidden");
  }

  /**
   * Ferme tous les onglets ouverts (utilisé lors du changement/fermeture de projet).
   * Retourne true si un onglet agent était ouvert (pour le rouvrir ensuite).
   */
  _closeAllTabs() {
    const hadAgentTab = this.tabs.tabs.some((t) => t.mode === "agent");
    for (const tab of [...this.tabs.tabs]) {
      this.tabs.closeTab(tab.id, { skipConfirm: true });
    }
    return hadAgentTab;
  }

  /**
   * Gère le drop de fichiers sur l'arborescence : copie les fichiers dans le projet
   * @param {string[]} paths - Chemins absolus des fichiers dropés
   * @param {{x:number,y:number}|null} position - Position du curseur
   */
  async handleDropOnTree(paths, position) {
    const projectPath = window._pilotProjectPath;
    if (!projectPath || !paths || paths.length === 0) return;

    // Déterminer le dossier cible (racine du projet par défaut)
    let targetDir = projectPath;
    if (position) {
      const el = document.elementFromPoint(position.x, position.y);
      if (el) {
        const row = el.closest('.tree-row[data-is-dir="true"]');
        if (row && row.dataset.path) {
          targetDir = row.dataset.path;
        }
      }
    }

    const sep = targetDir.includes('\\') ? '\\' : '/';

    for (const filePath of paths) {
      const fileName = filePath.split(/[/\\]/).pop();
      let destPath = targetDir + sep + fileName;

      // Gérer les doublons : suffixe _1, _2, etc.
      let counter = 1;
      while (await invoke("file_exists", { path: destPath })) {
        const dotIndex = fileName.lastIndexOf('.');
        if (dotIndex > 0) {
          const stem = fileName.substring(0, dotIndex);
          const ext = fileName.substring(dotIndex);
          destPath = targetDir + sep + stem + '_' + counter + ext;
        } else {
          destPath = targetDir + sep + fileName + '_' + counter;
        }
        counter++;
      }

      try {
        const data = await invoke("read_file_binary", { path: filePath });
        await invoke("write_file_binary", { path: destPath, data });
      } catch (err) {
        toastError("Erreur copie fichier : " + (err.message || err));
      }
    }
    // L'arborescence se rafraîchit automatiquement via le file watcher
  }

  async closeProject() {
    // Sauvegarder la session avant de fermer
    const currentPath = window._pilotProjectPath;
    if (currentPath) {
      // Forcer une sauvegarde immédiate (annule le debounce)
      await saveTabSession(this.tabs, currentPath);
    }
    try {
      await invoke("close_project");
    } catch (_) {}
    this.treeData = null;
    this.filterQuery = "";
    this.filterInput.value = "";
    this.filterWrapper.classList.add("hidden");
    this.favorites = [];
    this.gitStatus = null;
    this.gitByAbs = new Map();
    this.gitDirtyDirs = new Set();
    this._renderFavorites();
    this.treeContainer.innerHTML = '<p class="empty-message">Aucun projet ouvert</p>';
    this.projectName.textContent = "";
    document.querySelectorAll(".project-only").forEach((b) =>
      b.classList.add("hidden")
    );
    this.ddCloseProject.classList.add("hidden");
    this.ddCloseSeparator.classList.add("hidden");
    // Fermer tous les onglets ouverts
    this._closeAllTabs();
    // Réinitialiser le chemin du projet
    window._pilotProjectPath = null;
    // Vider les alias de modèles (loadModelAliases détecte l'absence de projet)
    loadModelAliases();
  }

  destroy() {
    if (this.unlistenFileChange) {
      this.unlistenFileChange();
    }
  }

  /** Initialise le drag du séparateur sidebar avec persistance */
  _initSidebarResize() {
    const sidebar = document.getElementById("sidebar");
    const sep = document.getElementById("sidebar-separator");
    if (!sidebar || !sep) return;

    // Restaurer la largeur sauvegardée
    invoke("get_config").then((config) => {
      if (config.sidebar_width && config.sidebar_width >= 280) {
        sidebar.style.width = config.sidebar_width + "px";
      }
    }).catch(() => {});

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;
    let saveTimer = null;

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      sep.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(280, Math.min(600, startWidth + delta));
      sidebar.style.width = newWidth + "px";
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      sep.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Sauvegarder la largeur (debounce)
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        invoke("set_sidebar_width", { width: sidebar.offsetWidth }).catch(() => {});
      }, 500);
    };

    sep.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Double-clic = revenir à la largeur par défaut (280px)
    sep.addEventListener("dblclick", () => {
      sidebar.style.width = "280px";
      invoke("set_sidebar_width", { width: 280 }).catch(() => {});
    });
  }
}

let instance = null;

export function initSidebar(tabsManager) {
  instance = new Sidebar(tabsManager);
  window._pilotGetSidebar = getSidebar;
  return instance;
}

export function getSidebar() {
  return instance;
}
