// main.js — Point d'entrée de l'application Pilot

import { initTheme } from "./theme.js";
import { initTabs } from "./tabs.js";
import { initSidebar } from "./sidebar.js";
import { initSettings } from "./settings.js";
import { initSearchPanel } from "./search-panel.js";
import { initOutline, closeOutline } from "./outline.js";
import { initToasts, toastSuccess, toastError, toastWarning, toastInfo } from "./toast.js";
import { initUpdater, checkForUpdate } from "./updater.js";
import { refreshBackendInfo, agentDisplayLabel, checkPiHealth } from "./backend-info.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";

// --- Palette de commandes ---

const COMMANDS = [
  { id: "save", label: "Sauvegarder le fichier", key: "Ctrl+S", icon: "💾" },
  { id: "save-as", label: "Enregistrer sous…", key: "Ctrl+Shift+S", icon: "📋" },
  { id: "close-tab", label: "Fermer l'onglet", key: "Ctrl+W", icon: "✕" },
  { id: "toggle-split", label: "Basculer mode split", key: "Ctrl+Shift+E", icon: "◧" },
  { id: "toggle-outline", label: "Table des matières", key: "Ctrl+Shift+O", icon: "📑" },
  { id: "global-search", label: "Recherche globale", key: "Ctrl+Shift+F", icon: "🔍" },
  { id: "go-to-line", label: "Aller à la ligne…", key: "Ctrl+G", icon: "↕" },
  { id: "zen-mode", label: "Mode Zen", key: "F11", icon: "⛶" },
  { id: "focus-filter", label: "Filtrer les fichiers", key: "Ctrl+P", icon: "📁" },
  { id: "bold", label: "Gras (Markdown)", key: "Ctrl+B", icon: "B" },
  { id: "italic", label: "Italique (Markdown)", key: "Ctrl+I", icon: "I" },
  { id: "link", label: "Lien (Markdown)", key: "Ctrl+K", icon: "🔗" },
  { id: "toggle-favorite", label: "Ajouter aux favoris", key: "Ctrl+Shift+B", icon: "⭐" },
  { id: "scratchpad", label: "Ouvrir le brouillon", key: "Ctrl+Shift+N", icon: "📝" },
  { id: "toggle-word-wrap", label: "Renvoi à la ligne automatique", key: "Alt+Z", icon: "↩" },
  { id: "check-update", label: "Vérifier les mises à jour", key: "", icon: "⬆" },
];

let paletteActiveIndex = 0;
let paletteFiltered = [];

function openCommandPalette(tabs) {
  const palette = document.getElementById("command-palette");
  const input = document.getElementById("palette-input");
  const list = document.getElementById("palette-list");
  if (!palette || !input || !list) return;

  palette.classList.remove("hidden");
  input.value = "";
  paletteActiveIndex = 0;
  paletteFiltered = [...COMMANDS];
  renderPaletteList(list, tabs);
  setTimeout(() => input.focus(), 0);
}

function closeCommandPalette() {
  const palette = document.getElementById("command-palette");
  if (palette) palette.classList.add("hidden");
}

function renderPaletteList(list, tabs) {
  list.innerHTML = "";
  paletteFiltered.forEach((cmd, i) => {
    const li = document.createElement("li");
    if (i === paletteActiveIndex) li.classList.add("active");
    li.innerHTML = `<span class="palette-label">${cmd.icon} ${cmd.label}</span><span class="palette-key">${cmd.key}</span>`;
    li.addEventListener("click", () => executeCommand(cmd.id, tabs));
    list.appendChild(li);
  });
}

async function executeCommand(id, tabs) {
  closeCommandPalette();
  const tab = tabs.getActiveTab();
  switch (id) {
    case "save":
      if (tab && tab.isScratchpad) {
        tabs._saveScratchpad(tab);
        const { toastSuccess } = await import("./toast.js");
        toastSuccess("Brouillon sauvegardé localement");
      } else if (tab && tab.mode === "edit" && tab.view) {
        const { getContent } = await import("./editor.js");
        const content = getContent(tab.view);
        try {
          await invoke("write_file_content", { path: tab.path, content });
          tab.dirty = false;
          tab.savedContent = content;
          const { toastSuccess } = await import("./toast.js");
          toastSuccess("Fichier sauvegardé");
        } catch (_) {}
      }
      break;
    case "save-as": {
      if (tab && tab.isScratchpad) {
        await tabs._exportScratchpad(tab);
      } else if (tab && tab.mode === "edit" && tab.view) {
        const { getContent } = await import("./editor.js");
        const content = getContent(tab.view);
        const { save } = await import("@tauri-apps/plugin-dialog");
        const filePath = await save({ defaultPath: tab.path, filters: [{ name: "Tous les fichiers", extensions: ["*"] }] });
        if (filePath) {
          try {
            await invoke("write_file_content", { path: filePath, content });
            // Mettre à jour le chemin de l'onglet
            tab.path = filePath;
            tab.name = filePath.split(/[\\/]/).pop();
            tab.savedContent = content;
            tab.dirty = false;
            const btn = document.getElementById("tab-bar").querySelector(`[data-tab-id="${tab.id}"]`);
            if (btn) {
              const nameSpan = btn.querySelector(".tab-name");
              if (nameSpan) nameSpan.textContent = tab.name;
              const dirty = btn.querySelector(".tab-dirty");
              if (dirty) dirty.remove();
            }
            const { toastSuccess } = await import("./toast.js");
            toastSuccess("Fichier enregistré sous " + tab.name);
          } catch (err) {
            const { toastError } = await import("./toast.js");
            toastError("Erreur enregistrement : " + err);
          }
        }
      }
      break;
    }
    case "close-tab":
      if (tab) tabs.closeTab(tab.id);
      break;
    case "toggle-split":
      tabs.toggleSplitMode();
      break;
    case "toggle-outline": {
      const { toggleOutline } = await import("./outline.js");
      toggleOutline();
      break;
    }
    case "global-search": {
      const { toggleSearchPanel } = await import("./search-panel.js");
      toggleSearchPanel();
      break;
    }
    case "go-to-line":
      if (tab && tab.mode === "edit" && tab.view) {
        const lineStr = prompt("Aller à la ligne :");
        if (lineStr) {
          const lineNum = parseInt(lineStr, 10);
          if (!isNaN(lineNum) && lineNum > 0) {
            const line = tab.view.state.doc.line(Math.min(lineNum, tab.view.state.doc.lines));
            tab.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
            tab.view.focus();
          }
        }
      }
      break;
    case "zen-mode":
      document.body.classList.toggle("zen-mode");
      break;
    case "focus-filter": {
      const filterInput = document.getElementById("tree-filter");
      if (filterInput) { filterInput.focus(); filterInput.select(); }
      break;
    }
    case "bold":
      if (tab && tab.mode === "edit" && tab.view) {
        const { wrapBold } = await import("./editor.js");
        wrapBold(tab.view);
      }
      break;
    case "italic":
      if (tab && tab.mode === "edit" && tab.view) {
        const { wrapItalic } = await import("./editor.js");
        wrapItalic(tab.view);
      }
      break;
    case "link":
      if (tab && tab.mode === "edit" && tab.view) {
        const { wrapLink } = await import("./editor.js");
        wrapLink(tab.view);
      }
      break;
    case "toggle-favorite":
      if (tab && tab.path) {
        const sidebar = window._pilotGetSidebar ? window._pilotGetSidebar() : null;
        if (sidebar) {
          sidebar.toggleFavorite(tab.path);
        }
      }
      break;
    case "scratchpad":
      tabs._openScratchpad();
      break;
    case "toggle-word-wrap": {
      const currentConfig = await invoke("get_config");
      const newWrap = !currentConfig.word_wrap;
      const updatedConfig = { ...currentConfig, word_wrap: newWrap };
      await invoke("save_config", { config: updatedConfig });
      window.dispatchEvent(new CustomEvent("pilot-config-changed", { detail: updatedConfig }));
      const { toastInfo } = await import("./toast.js");
      toastInfo(newWrap ? "Renvoi à la ligne activé" : "Renvoi à la ligne désactivé");
      break;
    }
    case "check-update":
      await checkForUpdate(false);
      break;
  }
}

// --- App initialization ---

/** Avertit l'utilisateur que l'agent (pi/plh) est indisponible au démarrage.
 *  Silencieux pour `no_path` (cas « pas encore configuré » normal — la gate
 *  d'ouverture de l'onglet agent gère ce cas gracieusement avec un écran guidé). */
function warnPiUnavailable(h) {
  if (!h || h.ok || h.error === "no_path") return;
  const reason = h.error === "not_executable" ? `exécutable introuvable ou injoignable : « ${h.path} »`
    : h.error === "probe_failed" ? "sonde du backend échouée"
    : h.error || "raison inconnue";
  toastWarning(`Agent indisponible — ${reason}. Ouvre les ⚙️ Paramètres pour corriger le chemin.`);
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Pilot: DOMContentLoaded");

  try {
  // 1. Initialiser le thème
  initTheme();

  // 2. Initialiser le gestionnaire d'onglets
  const tabs = initTabs();

  // 3. Initialiser la barre latérale
  const sidebar = initSidebar(tabs);
  await sidebar.init();

  // 3b. Initialiser le panneau de recherche globale
  initSearchPanel(tabs);

  // 3c. Initialiser le panneau Outline
  initOutline(tabs);

  // 3d. Initialiser les toasts
  initToasts();

  // 3d-bis. Vérification automatique des mises à jour (Tauri updater)
  initUpdater();

  // 3d-quater. Sondage du backend (pi vs plh) pour l'affichage dynamique du nom
  // de l'agent. Async : met à jour le cache puis émet `pilot-backend-changed`
  // pour renommer les onglets/labels déjà affichés. Re-sondé sur changement de
  // chemin pi (event `pilot-config-changed`).
  refreshBackendInfo();
  window.addEventListener("pilot-config-changed", () => {
    refreshBackendInfo();
    // Re-sonde aussi la santé de l'agent (chemin pi peut avoir changé).
    checkPiHealth().then((h) => { if (h && !h.ok) warnPiUnavailable(h); });
  });

  // 3d-quinquies. Health check de l'agent au démarrage (E4) : si l'exécutable
  // configuré (pi/plh) est absent ou ne répond pas à `--version`, avertir
  // l'utilisateur via un toast. La gate d'ouverture de l'onglet agent
  // (tabs.js _openAgent) affiche alors un écran guidé au lieu de planter.
  checkPiHealth().then((h) => { if (h && !h.ok) warnPiUnavailable(h); });

  // 3d-ter. Afficher la version de l'app dans la barre de statut
  try {
    const ver = await getVersion();
    const el = document.getElementById("status-version");
    if (el) el.textContent = `v${ver}`;
  } catch (e) {
    console.warn("Version non disponible:", e);
  }

  // 3e0. Menu contextuel système : supprimer les options natives du clic droit
  // (Reload, Inspect, Save as, etc.) partout sauf dans l'éditeur CodeMirror
  // et les champs de saisie (input/textarea) où copier/coller reste utile.
  // Les menus contextuels propres à Pilot (sidebar, onglets) sont gérés
  // séparément et continuent de fonctionner car ce sont des éléments DOM
  // personnalisés affichés par nos handlers, non le menu natif.
  document.addEventListener("contextmenu", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    // Autoriser le menu natif dans l'éditeur CodeMirror et les champs de saisie
    if (t.closest(".cm-editor, .cm-content, input, textarea")) return;
    e.preventDefault();
  });

  // 3e. Event listeners pour la palette de commandes
  const paletteEl = document.getElementById("command-palette");
  const paletteInput = document.getElementById("palette-input");
  const paletteListEl = document.getElementById("palette-list");

  // Fermer la palette en cliquant sur le backdrop
  paletteEl.querySelector(".palette-backdrop").addEventListener("click", closeCommandPalette);

  // Filtrer les commandes en temps réel
  paletteInput.addEventListener("input", () => {
    const q = paletteInput.value.toLowerCase().trim();
    paletteFiltered = COMMANDS.filter((cmd) =>
      cmd.label.toLowerCase().includes(q) || cmd.key.toLowerCase().includes(q)
    );
    paletteActiveIndex = 0;
    renderPaletteList(paletteListEl, tabs);
  });

  // Navigation clavier dans la palette
  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteActiveIndex = Math.min(paletteActiveIndex + 1, paletteFiltered.length - 1);
      renderPaletteList(paletteListEl, tabs);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteActiveIndex = Math.max(paletteActiveIndex - 1, 0);
      renderPaletteList(paletteListEl, tabs);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (paletteFiltered[paletteActiveIndex]) {
        executeCommand(paletteFiltered[paletteActiveIndex].id, tabs);
      }
    }
  });

  // Exposer les références globales pour les cross-module
  window._pilotTabs = tabs;

  // 4. Initialiser les paramètres (charge et applique le thème/config)
  await initSettings();

  // 5. Boutons du panneau d'actions
  document.getElementById("btn-terminal").addEventListener("click", async () => {
    try {
      const config = await invoke("get_config");
      if (config.integrated_terminal) {
        tabs.openFile("Terminal", "terminal");
      } else {
        await invoke("open_terminal", { runDefault: false });
      }
    } catch (e) {
      console.error("Erreur terminal:", e);
    }
  });

  document.getElementById("btn-explorer").addEventListener("click", async () => {
    try {
      await invoke("open_explorer");
    } catch (e) {
      console.error("Erreur explorateur:", e);
    }
  });

  // ❓ Aide : onglet d'aide sur Pilot (LLM sur le handbook) — spec_help.md.
  document.getElementById("btn-help").addEventListener("click", () => {
    tabs.openFile("Aide", "help");
  });

  // 🔍 Review : onglet de revue de code assistée sur le diff Git — spec_review.md (H5).
  document.getElementById("btn-review").addEventListener("click", () => {
    tabs.openFile("Review", "review");
  });

  document.getElementById("btn-terminal-cmd").addEventListener("click", async () => {
    try {
      const config = await invoke("get_config");
      if (config.rpc_agent_enabled) {
        tabs.openFile(agentDisplayLabel(), "agent");
      } else if (config.integrated_terminal) {
        tabs.openFile("Agent", "terminal", true);
      } else {
        await invoke("open_terminal", { runDefault: true });
      }
    } catch (e) {
      console.error("Erreur terminal commande:", e);
    }
  });

  document.getElementById("btn-prompt-builder").addEventListener("click", () => {
    tabs.openFile("Prompt Builder", "prompt-builder");
  });

  document.getElementById("btn-scratchpad").addEventListener("click", () => {
    tabs._openScratchpad();
  });

  // 6. Raccourcis clavier globaux
  document.addEventListener("keydown", async (e) => {
    // Ne pas intercepter les raccourcis éditeur quand le focus est dans le terminal
    if (e.target.closest(".terminal-wrapper")) {
      return;
    }
    // Ctrl+B : gras markdown
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      const tab = tabs.getActiveTab();
      if (tab && tab.mode === "edit" && tab.view && tab.path.endsWith(".md")) {
        e.preventDefault();
        const { wrapBold } = await import("./editor.js");
        wrapBold(tab.view);
        return;
      }
    }

    // Ctrl+I : italique markdown
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      const tab = tabs.getActiveTab();
      if (tab && tab.mode === "edit" && tab.view && tab.path.endsWith(".md")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const { wrapItalic } = await import("./editor.js");
        wrapItalic(tab.view);
        return;
      }
    }

    // Ctrl+K : lien markdown
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      const tab = tabs.getActiveTab();
      if (tab && tab.mode === "edit" && tab.view && tab.path.endsWith(".md")) {
        e.preventDefault();
        const { wrapLink } = await import("./editor.js");
        wrapLink(tab.view);
        return;
      }
    }

    // Ctrl+S : sauvegarder le fichier actif (même si non marqué dirty)
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      const tab = tabs.getActiveTab();
      if (tab && tab.mode === "edit" && tab.view) {
        if (tab.isScratchpad) {
          // Scratchpad : sauvegarde localStorage
          tabs._saveScratchpad(tab);
          const btn = document.getElementById("tab-bar").querySelector(`[data-tab-id="${tab.id}"]`);
          if (btn) { const dirty = btn.querySelector(".tab-dirty"); if (dirty) dirty.remove(); }
          toastSuccess("Brouillon sauvegardé localement");
        } else {
          const { getContent } = await import("./editor.js");
          const content = getContent(tab.view);
          try {
            await invoke("write_file_content", { path: tab.path, content });
            tab.dirty = false;
            tab.savedContent = content;
            const btn = document
              .getElementById("tab-bar")
              .querySelector(`[data-tab-id="${tab.id}"]`);
            if (btn) {
              const dirty = btn.querySelector(".tab-dirty");
              if (dirty) dirty.remove();
            }
            toastSuccess("Fichier sauvegardé");
          } catch (err) {
            toastError("Erreur sauvegarde : " + err);
          }
        }
      }
      return;
    }

    // Ctrl+W : fermer l'onglet actif
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      const tab = tabs.getActiveTab();
      if (tab) {
        tabs.closeTab(tab.id);
      }
      return;
    }

    // Ctrl+Shift+E : basculer en mode split (éditeur + prévisualisation)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "E") {
      e.preventDefault();
      tabs.toggleSplitMode();
      return;
    }

    // F11 : Mode Zen (plein écran sans barre latérale)
    if (e.key === "F11") {
      e.preventDefault();
      document.body.classList.toggle("zen-mode");
      return;
    }

    // Ctrl+G : Go to Line
    if ((e.ctrlKey || e.metaKey) && e.key === "g") {
      e.preventDefault();
      const tab = tabs.getActiveTab();
      if (tab && tab.mode === "edit" && tab.view) {
        const lineStr = prompt("Aller à la ligne :");
        if (lineStr) {
          const lineNum = parseInt(lineStr, 10);
          if (!isNaN(lineNum) && lineNum > 0) {
            const line = tab.view.state.doc.line(Math.min(lineNum, tab.view.state.doc.lines));
            tab.view.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            tab.view.focus();
          }
        }
      }
      return;
    }

    // Ctrl+Shift+P : Palette de commandes
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
      e.preventDefault();
      openCommandPalette(tabs);
      return;
    }

    // Ctrl+Shift+B : Ajouter/Retirer des favoris
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
      e.preventDefault();
      const tab = tabs.getActiveTab();
      if (tab && tab.path) {
        sidebar.toggleFavorite(tab.path);
      }
      return;
    }

    // Ctrl+Shift+N : Ouvrir le brouillon
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "N") {
      e.preventDefault();
      tabs._openScratchpad();
      return;
    }

    // Alt+Z : Toggle word wrap
    if (e.altKey && e.key === "z") {
      e.preventDefault();
      try {
        const currentConfig = await invoke("get_config");
        const newWrap = !currentConfig.word_wrap;
        const updatedConfig = { ...currentConfig, word_wrap: newWrap };
        await invoke("save_config", { config: updatedConfig });
        window.dispatchEvent(new CustomEvent("pilot-config-changed", { detail: updatedConfig }));
        const { toastInfo } = await import("./toast.js");
        toastInfo(newWrap ? "Renvoi à la ligne activé" : "Renvoi à la ligne désactivé");
      } catch (_) {}
      return;
    }

    // Ctrl+Shift+S : Enregistrer sous
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
      e.preventDefault();
      const tab = tabs.getActiveTab();
      if (tab && tab.isScratchpad) {
        // Scratchpad : exporter
        await tabs._exportScratchpad(tab);
      } else if (tab && tab.mode === "edit" && tab.view) {
        const { getContent } = await import("./editor.js");
        const content = getContent(tab.view);
        const { save } = await import("@tauri-apps/plugin-dialog");
        const filePath = await save({
          defaultPath: tab.path,
          filters: [{ name: "Tous les fichiers", extensions: ["*"] }],
        });
        if (filePath) {
          try {
            await invoke("write_file_content", { path: filePath, content });
            // Mettre à jour le chemin de l'onglet
            tab.path = filePath;
            tab.name = filePath.split(/[\\/]/).pop();
            tab.savedContent = content;
            tab.dirty = false;
            // Mettre à jour le bouton d'onglet
            const btn = document.getElementById("tab-bar").querySelector(`[data-tab-id="${tab.id}"]`);
            if (btn) {
              const nameSpan = btn.querySelector(".tab-name");
              if (nameSpan) nameSpan.textContent = tab.name;
              const dirty = btn.querySelector(".tab-dirty");
              if (dirty) dirty.remove();
            }
            toastSuccess("Fichier enregistré sous " + tab.name);
          } catch (err) {
            toastError("Erreur enregistrement : " + err);
          }
        }
      }
      return;
    }

    // Ctrl+Tab / Ctrl+Shift+Tab : onglet suivant / précédent
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      const idx = tabs.tabs.findIndex((t) => t.id === tabs.activeTabId);
      if (idx !== -1) {
        if (e.shiftKey) {
          // Onglet précédent
          const prev = idx > 0 ? idx - 1 : tabs.tabs.length - 1;
          tabs.switchTab(tabs.tabs[prev].id);
        } else {
          // Onglet suivant
          const next = idx < tabs.tabs.length - 1 ? idx + 1 : 0;
          tabs.switchTab(tabs.tabs[next].id);
        }
      }
      return;
    }
  });

  // 7. Charger le dernier projet automatiquement si l'option est activée
  try {
    const config = await invoke("get_config");
    if (config.auto_load_last_project && config.recent_projects && config.recent_projects.length > 0) {
      await sidebar.openProjectByPath(config.recent_projects[0]);
    }
    // Si RPC activé, ouvrir systématiquement l'onglet Agent Pi
    // (on ignore integrated_terminal et auto_run_command pour l'agent)
    if (config.rpc_agent_enabled && config.auto_load_last_project && config.recent_projects && config.recent_projects.length > 0) {
      tabs.openFile(agentDisplayLabel(), "agent");
    } else if (config.auto_load_last_project && config.auto_run_command && config.default_command && config.recent_projects && config.recent_projects.length > 0) {
      // Lancer l'agent automatiquement si les deux options sont activées
      // et qu'un projet a bien été chargé
      if (config.integrated_terminal) {
        tabs.openFile("Agent", "terminal", true);
      } else {
        await invoke("open_terminal", { runDefault: true });
      }
    }
  } catch (_) {
    // Pas grave
  }

  // 8. Écouter le drag & drop natif Tauri (images dans l'éditeur + fichiers dans l'arborescence)
  const unlistenDragDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
    const payload = event.payload || {};

    // Ignorer les événements de survol (over/leave)
    if (payload.type !== "drop" && payload.type !== undefined) return;

    const paths = payload.paths || [];
    if (paths.length === 0) return;

    // Déterminer la zone de drop via la position du curseur
    const position = payload.position;
    let isSidebar = false;
    if (position) {
      const sidebarEl = document.getElementById("sidebar");
      if (sidebarEl) {
        const rect = sidebarEl.getBoundingClientRect();
        isSidebar = position.x >= rect.left && position.x <= rect.right
                 && position.y >= rect.top && position.y <= rect.bottom;
      }
    }

    if (isSidebar) {
      // Drop sur l'arborescence → copier les fichiers dans le projet
      await sidebar.handleDropOnTree(paths, position || null);
    } else {
      // Drop sur l'éditeur → insertion d'image markdown
      const tab = tabs.getActiveTab();
      if (!tab || tab.mode !== "edit" || !tab.path.endsWith(".md") || !tab.view) return;

      for (const filePath of paths) {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif'].includes(ext)) continue;

        try {
          const data = await invoke("read_file_binary", { path: filePath });
          const fileName = filePath.split(/[/\\]/).pop();
          const relativePath = await invoke("copy_image_to_project", { fileName, data });

          // Insérer le markdown à la position du curseur
          const alt = fileName.replace(/\.[^.]+$/, "");
          const { from, to } = tab.view.state.selection.main;
          const mdText = `![${alt}](${relativePath})`;
          tab.view.dispatch({
            changes: { from, to, insert: mdText },
            selection: { anchor: from + mdText.length },
          });
        } catch (err) {
          console.error("Erreur insertion image (drag & drop):", err);
        }
      }
    }
  });

  // Stocker l'unlisten pour le nettoyage éventuel
  window._pilotUnlistenDragDrop = unlistenDragDrop;

  // 9. Redonner le focus au terminal quand la fenêtre revient au premier plan
  const unlistenFocus = await getCurrentWindow().listen("focus", () => {
    const tab = tabs.getActiveTab();
    if (tab && tab.mode === "terminal" && tab.terminal) {
      setTimeout(() => tab.terminal.focus(), 50);
    }
  });
  window._pilotUnlistenFocus = unlistenFocus;

  // 9b. Resync visuel quand un changement de projet est initié à distance (web).
  // Le backend a déjà mis à jour project_path + watcher et redémarré pi ; on
  // recharge la sidebar/titre sans rappeler open_project_path (boucle) et sans
  // toucher à pi ni aux onglets. Ignoré si le changement vient du desktop lui-même
  // (window._pilotProjectPath déjà à jour → pas de double resync).
  const unlistenProjectChanged = await listen("project_changed", (event) => {
    const path = event.payload && event.payload.path;
    if (!path || path === window._pilotProjectPath) return;
    const sb = window._pilotGetSidebar ? window._pilotGetSidebar() : null;
    if (sb) {
      sb.resyncProjectFromRemote(path).catch((e) => console.warn("[remote] resync:", e));
      const name = path.replace(/\\/g, "/").split("/").pop() || path;
      toastInfo("📁 Projet changé à distance : " + name);
    }
  });
  window._pilotUnlistenProjectChanged = unlistenProjectChanged;

  // 10. Modale des raccourcis clavier
  const shortcutsModal = document.getElementById("shortcuts-modal");
  const btnShortcuts = document.getElementById("btn-shortcuts");
  const btnCloseShortcuts = document.getElementById("btn-close-shortcuts");

  if (btnShortcuts && shortcutsModal) {
    btnShortcuts.addEventListener("click", () => {
      shortcutsModal.classList.remove("hidden");
    });
  }
  if (btnCloseShortcuts && shortcutsModal) {
    btnCloseShortcuts.addEventListener("click", () => {
      shortcutsModal.classList.add("hidden");
    });
  }
  if (shortcutsModal) {
    shortcutsModal.addEventListener("click", (e) => {
      if (e.target === shortcutsModal) {
        shortcutsModal.classList.add("hidden");
      }
    });
  }

  // 11. Bouton fermer le panneau de recherche
  const searchCloseBtn = document.getElementById("search-close-btn");
  if (searchCloseBtn) {
    searchCloseBtn.addEventListener("click", () => {
      document.getElementById("search-panel").classList.add("hidden");
    });
  }

  // 12. Bouton fermer le panneau Outline
  const outlineCloseBtn = document.getElementById("outline-close-btn");
  if (outlineCloseBtn) {
    outlineCloseBtn.addEventListener("click", () => {
      closeOutline();
    });
  }

  console.log("🚀 Pilot prêt.");

  } catch (err) {
    console.error("💥 Erreur initialisation Pilot:", err);
  }
});
