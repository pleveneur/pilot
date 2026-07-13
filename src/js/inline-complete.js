// inline-complete.js — Auto-complétion IA inline (Copilot-like) dans CodeMirror 6

import { EditorView, Decoration, keymap, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateField, StateEffect, Prec } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";

// ── État global du module ──
const inlineState = {
  ghostText: "",
  ghostPos: -1,
  activeView: null,
  activeFilePath: "",
  requesting: false,
  debounceMs: 0,
  /** Flag anti-conflit : true pendant l'acceptation, pour bloquer rejectOnTypePlugin */
  accepting: false,
};

// Exposer globalement pour que agent-pi.js puisse router les réponses
window._pilotInlineComplete = {
  handleDelta: (text) => handleDelta(text),
  handleEnd: () => handleEnd(),
  handleError: (msg) => handleError(msg),
  isRequesting: () => inlineState.requesting,
};

// ── StateEffects ──

const setGhostText = StateEffect.define({
  map(val, mapping) {
    return { from: mapping.mapPos(val.from), text: val.text };
  },
});

const clearGhostText = StateEffect.define();

// ── Ghost text widget ──

class GhostTextWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    const escaped = this.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    span.innerHTML = escaped.replace(/\n/g, "<br>");
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

// ── Widget "Tab pour accepter" ──

class TabHintWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-tab-hint";
    span.textContent = "⮑ Tab";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

// ── StateField : suggestion en cours ──

const ghostTextField = StateField.define({
  create() {
    return { from: -1, text: "" };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostText)) {
        return { from: effect.value.from, text: effect.value.text };
      }
      if (effect.is(clearGhostText)) {
        return { from: -1, text: "" };
      }
    }
    if (value.from >= 0 && tr.docChanged) {
      return { from: tr.changes.mapPos(value.from), text: value.text };
    }
    return value;
  },
});

// ── Décorations ──

const ghostTextDecorations = EditorView.decorations.compute(
  [ghostTextField],
  (state) => {
    const ghost = state.field(ghostTextField);
    if (ghost.from < 0 || !ghost.text) return Decoration.none;

    const widgets = [
      Decoration.widget({
        widget: new GhostTextWidget(ghost.text),
        side: 1,
      }).range(ghost.from),
      Decoration.widget({
        widget: new TabHintWidget(),
        side: 1,
      }).range(ghost.from),
    ];

    return Decoration.set(widgets, true);
  }
);

// ── Plugin : vue active ──

const inlineCompletionPlugin = ViewPlugin.define((view) => {
  inlineState.activeView = view;
  return {
    destroy() {
      if (inlineState.activeView === view) {
        inlineState.activeView = null;
      }
      rejectCompletion(view);
    },
  };
});

// ── Plugin : indicateur de chargement ──

const loadingIndicatorPlugin = ViewPlugin.define((view) => {
  let loadingEl = null;

  function sync() {
    if (inlineState.requesting && !loadingEl) {
      loadingEl = document.createElement("div");
      loadingEl.className = "cm-inline-loading";
      loadingEl.textContent = "✨ IA…";
      view.dom.appendChild(loadingEl);
    } else if (!inlineState.requesting && loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  sync();

  return {
    update() { sync(); },
    destroy() {
      if (loadingEl) { loadingEl.remove(); loadingEl = null; }
    },
  };
});

// ── Plugin : rejeter la suggestion si l'utilisateur tape ──
// Ne se déclenche PAS pendant l'acceptation (flag accepting)

const rejectOnTypePlugin = ViewPlugin.define(() => {
  return {
    update(vu) {
      if (!vu.docChanged) return;
      if (inlineState.accepting) return; // Ne pas interférer avec l'acceptation
      try {
        const ghost = vu.state.field(ghostTextField, false);
        if (!ghost || ghost.from < 0 || !ghost.text) return;
      } catch (_) { return; }
      // L'utilisateur a tapé → rejeter
      log("Saisie → rejet");
      vu.view.dispatch({ effects: clearGhostText.of() });
      resetState(vu.view);
    },
  };
});

// ── Raccourcis clavier ──
// Utilisé Prec.high pour primer sur TOUT autre keymap (indentWithTab, etc.)

const DEBUG = false;
function log(...args) { if (DEBUG) console.log("[InlineComplete]", ...args); }

const inlineKeymap = Prec.high(keymap.of([
  {
    key: "Tab",
    run: (view) => {
      let ghost;
      try { ghost = view.state.field(ghostTextField, false); } catch (_) { return false; }
      if (!ghost || ghost.from < 0 || !ghost.text) return false;
      log("Tab → accept");
      acceptCompletion(view);
      return true;
    },
  },
  {
    key: "Escape",
    run: (view) => {
      try {
        const ghost = view.state.field(ghostTextField, false);
        if (ghost && ghost.from >= 0 && ghost.text) {
          rejectCompletion(view);
          return true;
        }
      } catch (_) {}
      return false;
    },
  },
  {
    key: "Ctrl-Space",
    run: (view) => {
      try {
        const ghost = view.state.field(ghostTextField, false);
        if (ghost && ghost.from >= 0 && ghost.text) {
          rejectCompletion(view);
          return true;
        }
      } catch (_) {}
      requestCompletion(view);
      return true;
    },
  },
]));

// ── Export : extension CodeMirror complète ──

export function inlineCompletionExtension(filePath) {
  inlineState.activeFilePath = filePath || "";
  return [
    ghostTextField,
    ghostTextDecorations,
    inlineCompletionPlugin,
    loadingIndicatorPlugin,
    rejectOnTypePlugin,
    inlineKeymap,
  ];
}

// ── Demande de complétion ──

export async function requestCompletion(view, filePath) {
  if (inlineState.requesting) return;
  if (!view) view = inlineState.activeView;
  if (!view) {
    log("Pas de vue active");
    return;
  }

  const path = filePath || inlineState.activeFilePath;
  if (!path) {
    log("Pas de chemin fichier");
    return;
  }

  // Vérifier que l'agent RPC est actif
  try {
    const agentState = await invoke("get_agent_state");
    if (!agentState) {
      log("Pas d'état agent");
      return;
    }
  } catch (err) {
    log("Agent non disponible:", err.message);
    return;
  }

  // Rejeter l'ancienne suggestion
  rejectCompletion(view);

  // Capturer le contexte
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const line = doc.lineAt(pos);

  const startLine = Math.max(1, line.number - 50);
  let beforeText = "";
  for (let i = startLine; i <= line.number; i++) {
    const l = doc.line(i);
    if (i === line.number) {
      beforeText += l.text.slice(0, pos - l.from);
    } else {
      beforeText += l.text + "\n";
    }
  }

  const endLine = Math.min(doc.lines, line.number + 20);
  let afterText = "";
  for (let i = line.number; i <= endLine; i++) {
    const l = doc.line(i);
    if (i === line.number) {
      afterText += l.text.slice(pos - l.from);
    } else {
      afterText += l.text + (i < endLine ? "\n" : "");
    }
  }

  inlineState.requesting = true;
  inlineState.ghostText = "";
  inlineState.ghostPos = pos;

  const ext = path.split(".").pop() || "txt";
  const prompt = `You are an inline code completion assistant. Complete the code at the cursor position (marked with <|CURSOR|>). Only output the completion text — no explanations, no markdown, no code blocks. Continue naturally from the cursor position.

File: ${path}

\`\`\`${ext}
${beforeText}<|CURSOR|>
${afterText}\`\`\`

Continue from <|CURSOR|>:`;

  log("Envoi requête, pos=", pos, "file=", path);

  try {
    await invoke("send_inline_prompt", { message: prompt });
    log("Requête envoyée");
  } catch (err) {
    console.error("[InlineComplete] Erreur envoi:", err);
    resetState(view);
  }
}

// ── Réception des deltas ──

export function handleDelta(text) {
  if (!inlineState.requesting) return;
  const view = inlineState.activeView;
  if (!view) return;

  inlineState.ghostText += text;

  let cleaned = inlineState.ghostText;
  cleaned = cleaned.replace(/^```[\w]*\n?/, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");
  if (cleaned.includes("\n")) {
    const lines = cleaned.split("\n");
    const firstLine = lines[0].trim();
    if (firstLine.length > 0 && firstLine.length < 80 && /^[A-Z]/.test(firstLine)
      && !firstLine.startsWith("//") && !firstLine.startsWith("#") && !firstLine.startsWith("/*")) {
      lines.shift();
      cleaned = lines.join("\n");
    }
  }

  try {
    if (view.state.field(ghostTextField, false)) {
      view.dispatch({
        effects: setGhostText.of({ from: inlineState.ghostPos, text: cleaned }),
      });
    }
  } catch (e) {
    console.error("[InlineComplete] Erreur mise à jour ghost text:", e);
    resetState(view);
  }
}

// ── Fin de la réponse ──

export function handleEnd() {
  if (!inlineState.requesting) return;
  const view = inlineState.activeView;
  log("Fin réponse, longueur=", inlineState.ghostText.length);
  inlineState.requesting = false;
  if (view) view.requestMeasure();
  if (!inlineState.ghostText && view) {
    try {
      if (view.state.field(ghostTextField, false)) {
        view.dispatch({ effects: clearGhostText.of() });
      }
    } catch (_) {}
  }
}

// ── Erreur ──

export function handleError(msg) {
  console.error("[InlineComplete] Erreur:", msg);
  resetState(inlineState.activeView);
}

// ── Accepter (Tab) ──

export function acceptCompletion(view) {
  if (!view) view = inlineState.activeView;
  if (!view) return false;

  let ghost;
  try { ghost = view.state.field(ghostTextField, false); } catch (_) {
    console.error("[InlineComplete] acceptCompletion: ghostTextField inaccessible");
    return false;
  }
  if (!ghost || ghost.from < 0 || !ghost.text) {
    console.warn("[InlineComplete] acceptCompletion: pas de ghost, from=", ghost?.from);
    return false;
  }

  log("acceptCompletion: insertion de", ghost.text.length, "car. à pos", ghost.from);

  // Bloquer rejectOnTypePlugin pendant l'insertion
  inlineState.accepting = true;

  try {
    // 1) D'abord effacer le ghost text
    view.dispatch({
      effects: clearGhostText.of(),
    });

    // 2) Puis insérer le texte dans le document
    const cursorPos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: cursorPos, to: cursorPos, insert: ghost.text },
      selection: { anchor: cursorPos + ghost.text.length },
    });

    log("acceptCompletion: terminé ✓");
  } catch (e) {
    console.error("[InlineComplete] acceptCompletion: erreur dispatch:", e);
  } finally {
    inlineState.accepting = false;
    resetState(view);
  }
  return true;
}

// ── Rejeter (Escape / saisie) ──

export function rejectCompletion(view) {
  if (!view) view = inlineState.activeView;
  if (!view) return false;

  let ghost;
  try { ghost = view.state.field(ghostTextField, false); } catch (_) {
    resetState(view);
    return false;
  }

  if (ghost && ghost.from >= 0) {
    view.dispatch({ effects: clearGhostText.of() });
  }

  resetState(view);
  return true;
}

// ── Configuration ──

export function setDebounceMs(ms) {
  inlineState.debounceMs = ms;
}

export function setEnabled(enabled) {
  if (!enabled) rejectCompletion();
}

// ── Nettoyage interne ──

function resetState(view) {
  inlineState.requesting = false;
  inlineState.ghostText = "";
  inlineState.ghostPos = -1;
  if (view) view.requestMeasure();
}