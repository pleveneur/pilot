// terminal.js — Terminal intégré avec xterm.js + PTY Rust

import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Compteur global d'IDs de terminaux
let terminalCounter = 0;

/**
 * Crée un terminal intégré dans un conteneur
 * @param {HTMLElement} container - Élément HTML conteneur
 * @param {string} projectPath - Chemin du projet (cwd)
 * @param {boolean} runDefault - Lancer la commande par défaut ?
 * @returns {Promise<{wrapper: HTMLElement, terminal: Terminal, terminalId: string, unlisten: Function}>}
 */
export async function createTerminal(container, projectPath, runDefault = false) {
  const terminalId = `term_${++terminalCounter}`;

  // Wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "terminal-wrapper";

  // Instance xterm.js
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 14,
    fontFamily: '"Cascadia Code", "Fira Code", "Consolas", "Courier New", monospace',
    theme: getTerminalTheme(),
    allowProposedApi: true,
    windowsMode: navigator.platform.includes("Win"),
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(wrapper);
  container.appendChild(wrapper);
  fitAddon.fit();

  // Réagir aux changements de thème
  window.addEventListener("theme-changed", (e) => {
    term.options.theme = e.detail.theme === "dark" ? darkTheme : lightTheme;
  });

  // Gestion du copier/coller — intercepté AVANT xterm.js
  term.attachCustomKeyEventHandler((event) => {
    // Ne traiter que les événements keydown (éviter les doublons keypress/paste)
    if (event.type !== "keydown") {
      return true;
    }

    // Ctrl+C (sans Shift) : copier si sélection, sinon laisser passer (SIGINT)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "c") {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
        return false; // Bloque l'envoi au PTY
      }
      return true; // Pas de sélection → SIGINT normal
    }

    // Ctrl+V (sans Shift) : bloquer le caractère \x16, le paste event natif
    // (allowProposedApi) s'occupe du collage automatiquement.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "v") {
      return false;
    }

    // Ctrl+Shift+C : copier (fallback explicite)
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "c") {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
      return false;
    }

    // Ctrl+Shift+V : coller via write_to_terminal (fallback pour les
    // environnements où le paste event natif ne fonctionne pas)
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "v") {
      navigator.clipboard.readText().then((text) => {
        const bytes = new TextEncoder().encode(text);
        invoke("write_to_terminal", {
          terminalId,
          data: Array.from(bytes),
        }).catch(() => {});
      }).catch(() => {});
      return false;
    }

    return true; // Laisser passer toutes les autres touches
  });

  // Écouter les sorties du PTY
  const unlisten = await listen("terminal-output", (event) => {
    if (event.payload.id === terminalId) {
      term.write(new Uint8Array(event.payload.data));
    }
  });

  // Envoyer les entrées clavier vers le PTY
  term.onData((data) => {
    const bytes = new TextEncoder().encode(data);
    invoke("write_to_terminal", {
      terminalId,
      data: Array.from(bytes),
    }).catch((e) => console.error("Erreur écriture terminal:", e));
  });

  // Redimensionnement automatique
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    invoke("resize_terminal", {
      terminalId,
      rows: term.rows,
      cols: term.cols,
    }).catch(() => {});
  });
  resizeObserver.observe(wrapper);

  // Stocker le resizeObserver pour le nettoyage
  wrapper._resizeObserver = resizeObserver;

  // Lancer le PTY côté Rust
  try {
    await invoke("spawn_terminal", {
      terminalId,
      runDefault,
    });
  } catch (e) {
    term.write(`\r\n❌ Erreur: ${e}\r\n`);
    console.error("Erreur spawn_terminal:", e);
  }

  return { wrapper, terminal: term, terminalId, unlisten };
}

/**
 * Tue un terminal intégré
 */
export async function killTerminal(terminalId) {
  try {
    await invoke("kill_terminal", { terminalId });
  } catch (e) {
    console.error("Erreur kill_terminal:", e);
  }
}

// ── Thèmes pour xterm.js ──

const darkTheme = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#cdd6f4",
  cursorAccent: "#1e1e2e",
  selectionBackground: "rgba(100, 140, 220, 0.3)",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#cba6f7",
  cyan: "#94e2d5",
  white: "#cdd6f4",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#cba6f7",
  brightCyan: "#94e2d5",
  brightWhite: "#ffffff",
};

const lightTheme = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#4c4f69",
  cursorAccent: "#eff1f5",
  selectionBackground: "rgba(30, 102, 245, 0.2)",
  black: "#bcc0cc",
  red: "#d20f39",
  green: "#40a02b",
  yellow: "#df8e1d",
  blue: "#1e66f5",
  magenta: "#8839ef",
  cyan: "#179299",
  white: "#4c4f69",
  brightBlack: "#9ca0b0",
  brightRed: "#d20f39",
  brightGreen: "#40a02b",
  brightYellow: "#df8e1d",
  brightBlue: "#1e66f5",
  brightMagenta: "#8839ef",
  brightCyan: "#179299",
  brightWhite: "#1e1e2e",
};

function getTerminalTheme() {
  return document.body.classList.contains("theme-light") ? lightTheme : darkTheme;
}
