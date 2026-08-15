// session-persistence.js — Persistance des onglets au redémarrage
//
// Sauvegarde l'état des onglets (chemin, mode, curseur, scroll) dans
// app_data_dir/sessions/<hash>.json à chaque changement.
// Restaure les onglets au chargement d'un projet.
//
// 5.2 (cahier) : la survie de l'agent n'est PLUS portée par la session JSON
// (`hadAgent`/`agentIndex`/`agents`). Elle est garantie par la table `agents` ;
// la barre d'onglets agents est reconstruite à l'identique depuis la table
// `agent_views` (vue dissociée de l'objet). Les gardes anti-course
// (`_pilotSuppressSave`, `_restoring`, `cancelScheduleSave`) sont supprimées.

import { invoke } from "@tauri-apps/api/core";
import { agentDisplayLabel } from "./backend-info.js";

/**
 * Sérialise l'état des onglets et le sauvegarde sur disque.
 * Ignore les onglets spéciaux (agent, terminal, prompt-builder).
 * @param {import("./tabs.js").TabsManager} tabs
 * @param {string} projectPath
 */
export async function saveTabSession(tabs, projectPath) {
  if (!projectPath) return;

  const serializable = [];
  for (const tab of tabs.tabs) {
    // Ignorer les onglets sans chemin (agent, terminal, prompt-builder)
    // Exception : le scratchpad est persisté via localStorage, on sauvegarde juste un marqueur
    if (!tab.path) {
      if (tab.isScratchpad) {
        serializable.push({ path: "__scratchpad__", mode: "edit", isScratchpad: true });
      }
      continue;
    }

    const entry = {
      path: tab.path,
      mode: tab.mode,
    };

    // Curseur (mode edit)
    if (tab.mode === "edit" && tab.view) {
      try {
        const pos = tab.view.state.selection.main.head;
        const doc = tab.view.state.doc;
        const line = doc.lineAt(pos);
        entry.cursorLine = line.number;
        entry.cursorCol = pos - line.from + 1;
        if (tab.view.scrollDOM) {
          entry.scrollTop = tab.view.scrollDOM.scrollTop;
          entry.scrollLeft = tab.view.scrollDOM.scrollLeft;
        }
      } catch (_) {
        entry.cursorLine = 1;
        entry.cursorCol = 1;
      }
    }

    // Scroll (mode preview)
    if (tab.mode === "preview" || tab.mode === "pdf" || tab.mode === "csv" || tab.mode === "image") {
      if (tab.wrapper) {
        entry.scrollTop = tab.wrapper.scrollTop;
        entry.scrollLeft = tab.wrapper.scrollLeft;
      }
    }

    serializable.push(entry);
  }

  // Déterminer l'onglet actif
  const activeTab = tabs.getActiveTab();
  const activePath = activeTab?.path || null;

  const data = JSON.stringify({
    activePath,
    tabs: serializable,
  });

  await invoke("save_tab_session", { projectPath, data }).catch(() => {});

  // 5.2 : persister les vues d'onglets agents (table `agent_views`) pour
  // reconstruire la barre d'onglets à l'identique. La survie de l'agent est
  // garantie par la table `agents` ; `agent_views` ne stocke que la vue
  // (position, nom renommé, onglet actif).
  const views = [];
  tabs.tabs.forEach((t, idx) => {
    if (t.mode === "agent") {
      views.push({
        agent_id: t.agentId || "default",
        project_path: projectPath,
        order_index: idx,
        name_override: t.name || null,
        active: t.id === activeTab?.id,
      });
    }
  });
  await invoke("save_agent_views", { projectPath, views }).catch(() => {});
}

/**
 * Sauvegarde déclenchée par un changement (open/close/switch).
 * Appelée avec un debounce pour éviter les écritures excessives.
 * @param {import("./tabs.js").TabsManager} tabs
 * @param {string} projectPath
 */
let saveTimeout = null;

export function scheduleSave(tabs, projectPath) {
  if (!projectPath) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    // Sauvegarder le projet ACTIF au moment du déclenchement, pas le
    // `projectPath` capturé à la planification. Ce debounce est global (un seul
    // timeout) : si l'utilisateur a changé de projet entre-temps, l'ancien projet
    // garde sa session telle qu'elle a été sauvée par `saveTabSession` lors de la
    // bascule.
    const active = window._pilotProjectPath;
    if (!active) return;
    saveTabSession(tabs, active);
  }, 300);
}

/**
 * Charge l'état des onglets depuis le disque.
 * @param {string} projectPath
 * @returns {Promise<object|null>} null si aucune session ou erreur
 */
export async function loadTabSession(projectPath) {
  if (!projectPath) return null;
  try {
    const raw = await invoke("load_tab_session", { projectPath });
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Restaure les onglets depuis la session sauvegardée.
 * @param {import("./tabs.js").TabsManager} tabs
 * @param {string} projectPath
 * @param {Function} [onProgress] callback facultatif après chaque onglet
 */
export async function restoreTabs(tabs, projectPath, onProgress) {
  const session = await loadTabSession(projectPath);
  const hasTabs = session && Array.isArray(session.tabs) && session.tabs.length > 0;

  // 5.2 : reconstruire la barre d'onglets agents depuis la table `agent_views`
  // (la survie de l'agent est garantie par la table `agents`). Lue AVANT le
  // early return pour couvrir le cas où la session ne contient aucun onglet
  // d'édition mais des vues agents existent.
  const views = await invoke("list_agent_views", { projectPath }).catch(() => []);
  const hasViews = views.length > 0;

  // Rien à restaurer : ni onglets d'édition, ni vue agent.
  if (!hasTabs && !hasViews) return;

  const restoredTabs = [];
  if (hasTabs) {
    for (const entry of session.tabs) {
      if (!entry.path) continue;
      // Scratchpad : onglet spécial sans fichier
      if (entry.path === "__scratchpad__" || entry.isScratchpad) {
        try {
          await tabs._openScratchpad();
        } catch (_) {}
        if (onProgress) onProgress();
        continue;
      }
      try {
        await tabs.openFile(entry.path, entry.mode || "edit");
        const opened = tabs.tabs.find(t => t.path === entry.path && t.mode === (entry.mode || "edit"));
        if (opened) {
          restoredTabs.push({ tab: opened, entry });
        }
      } catch (_) {
        // Fichier supprimé ou inaccessible → ignorer
      }
      if (onProgress) onProgress();
    }

    // Restaurer l'onglet actif
    if (session.activePath === "__scratchpad__") {
      const active = tabs.tabs.find(t => t.isScratchpad);
      if (active) tabs.switchTab(active.id);
    } else if (session.activePath) {
      const activeEntry = session.tabs.find(e => e.path === session.activePath);
      if (activeEntry) {
        const active = tabs.tabs.find(t => t.path === session.activePath && t.mode === activeEntry.mode);
        if (active) {
          tabs.switchTab(active.id);
        }
      }
    }

    // Restaurer curseur et scroll (delay pour laisser le DOM se stabiliser)
    setTimeout(() => {
      for (const { tab, entry } of restoredTabs) {
        if (tab.mode === "edit" && tab.view && entry.cursorLine) {
          try {
            const line = tab.view.state.doc.line(entry.cursorLine);
            const pos = line.from + (entry.cursorCol || 1) - 1;
            tab.view.dispatch({
              selection: { anchor: Math.min(pos, tab.view.state.doc.length) },
              scrollIntoView: true,
            });
          } catch (_) {}
        }
        if (entry.scrollTop != null && tab.wrapper) {
          tab.wrapper.scrollTop = entry.scrollTop;
        }
        if (entry.scrollLeft != null && tab.wrapper) {
          tab.wrapper.scrollLeft = entry.scrollLeft;
        }
      }
    }, 200);
  } // fin hasTabs

  // 5.2 : reconstruire la barre d'onglets agents depuis `agent_views` (vue
  // dissociée de l'objet). Chaque onglet démarre/reprent sa propre session.
  for (const v of views) {
    try {
      await tabs._openAgent(v.name_override || agentDisplayLabel(), v.agent_id);
    } catch (_) { /* agent indisponible (gate health E4) → on ignore */ }
  }
  // Restaurer l'ordre des onglets agents (positions persistées).
  for (const v of views) {
    if (typeof v.order_index === "number" && v.order_index >= 0) {
      const t = tabs.tabs.find((tb) => tb.mode === "agent" && (tb.agentId || "default") === v.agent_id);
      if (t) {
        const cur = tabs.tabs.indexOf(t);
        if (cur !== -1 && cur !== v.order_index) tabs._moveTabToIndex(t.id, v.order_index);
      }
    }
  }
}
