// session-persistence.js — Persistance des onglets au redémarrage
//
// Sauvegarde l'état des onglets (chemin, mode, curseur, scroll) dans
// app_data_dir/sessions/<hash>.json à chaque changement.
// Restaure les onglets au chargement d'un projet.

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

  // Multi-projets : l'onglet agent n'a pas de path et est ignoré du tableau
  // `serializable` ; on suit son état (ouvert/fermé) via un flag dédié pour le
  // restaurer au retour sur ce projet (et au démarrage).
  // `agentIndex` : position de l'onglet agent dans `tabs.tabs` (-1 si absent),
  // pour restaurer l'ordre original des onglets (ex: agent en premier) — sinon
  // l'agent était toujours rouvert en dernier.
  const agentIndex = tabs.tabs.findIndex((t) => t.mode === "agent");
  const hadAgent = agentIndex >= 0;

  const data = JSON.stringify({
    activePath,
    tabs: serializable,
    hadAgent,
    agentIndex,
  });

  await invoke("save_tab_session", { projectPath, data }).catch(() => {});
}

/**
 * Sauvegarde déclenchée par un changement (open/close/switch).
 * Appelée avec un debounce pour éviter les écritures excessives.
 * @param {import("./tabs.js").TabsManager} tabs
 * @param {string} projectPath
 */
let saveTimeout = null;

/**
 * Annule une sauvegarde debounce en attente (utilisé au début d'une bascule
 * de projet : le debounce global ne doit pas se déclencher pendant qu'on
 * change de projet, sinon il réécrit la session du projet entrant avec les
 * onglets vides de la bascule).
 */
export function cancelScheduleSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
}

export function scheduleSave(tabs, projectPath) {
  if (!projectPath) return;
  // Pendant une bascule de projet (`_closeAllTabs`), on annule tout debounce
  // en attente et on n'en programme pas de nouveau : les sessions sortantes
  // sont déjà sauvées explicitement (`saveTabSession`) avant la bascule, et le
  // projet entrant sera sauvé par les actions suivantes de l'utilisateur. Sans
  // ce garde-fou, le debounce unique se déclenchait dans la fenêtre entre le
  // changement de `window._pilotProjectPath` et `restoreTabs` (qui pose
  // `_restoring`), écrivant la session du projet entrant avec `hadAgent:false`.
  if (window._pilotSuppressSave) {
    cancelScheduleSave();
    return;
  }
  if (tabs._restoring) return; // Ne pas sauvegarder pendant une restauration
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    if (tabs._restoring) return; // restauration toujours en cours → on attend le prochain
    // Multi-projets : sauvegarder le projet ACTIF au moment du déclenchement, pas
    // le `projectPath` capturé à la planification. Ce debounce est global (un seul
    // timeout) : si l'utilisateur a changé de projet entre-temps (ex. il ouvre
    // l'onglet agent de A puis bascule sur B rapidement), l'ancien projet doit
    // garder sa session telle qu'elle a été sauvée par `saveTabSession` lors de la
    // bascule. Sans cela, on réécrivait la session de A avec les onglets de B — et
    // on écrasait son flag `hadAgent` → l'onglet agent de A disparaissait au retour.
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
  if (!session) return;

  const hasTabs = Array.isArray(session.tabs) && session.tabs.length > 0;
  const hasAgent = session.hadAgent === true;
  // Rien à restaurer : ni onglets d'édition, ni onglet agent. Il ne faut PAS
  // retourner quand `hasAgent` est vrai même si `tabs` est vide (projet qui n'a
  // QUE son onglet agent ouvert) — sinon l'onglet agent ne serait jamais rouvert
  // au retour sur ce projet.
  if (!hasTabs && !hasAgent) return;

  tabs._restoring = true;

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

  // Multi-projets : rouvrir l'onglet agent de CE projet si la session persistée en
  // avait un. L'onglet agent étant exclu de `serializable`, c'est le seul moyen de
  // le retrouver au retour (le process pi parké reprend alors la session via
  // start_agent_session → renderMessageHistory réaffiche la conversation). Sans
  // cela, un chat lancé sur un projet puis quitté n'était plus affiché au retour
  // (impression que l'agent s'est « arrêté »).
  if (hasAgent) {
    try {
      await tabs.openFile(agentDisplayLabel(), "agent");
      // Restaurer la position originale de l'onglet agent (index persisté) pour
      // conserver l'ordre des onglets (ex: agent en premier). Les sessions
      // antérieures n'ont pas d'`agentIndex` → on ignore (agent en dernier).
      const agentIdx = session.agentIndex;
      if (typeof agentIdx === "number" && agentIdx >= 0) {
        const agentTab = tabs.tabs.find((t) => t.mode === "agent");
        if (agentTab) {
          const currentIdx = tabs.tabs.indexOf(agentTab);
          if (currentIdx !== -1 && currentIdx !== agentIdx) {
            tabs._moveTabToIndex(agentTab.id, agentIdx);
          }
        }
      }
    } catch (_) {
      /* agent indisponible (gate health E4) → on ignore */
    }
  }

  tabs._restoring = false;
}

