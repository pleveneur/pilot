// editor.js — Intégration CodeMirror 6

import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, indentOnInput, bracketMatching, foldKeymap } from "@codemirror/language";
import { codeLanguageInfo, getLanguageForFile } from "./languages.js";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, highlightSelectionMatches, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { autocompletion } from "@codemirror/autocomplete";
import {
  handleImageFile,
  hasImageInClipboard,
  getImageFromClipboard,
  hasImageFiles,
  isImageFile,
  fileNameFromMime,
} from "./image-paste.js";
import { inlineCompletionExtension, rejectCompletion as rejectInlineCompletion } from "./inline-complete.js";

// Compartment pour le word wrap (permet de le toggle dynamiquement)
const wrapCompartment = new Compartment();

/**
 * Crée une instance CodeMirror 6
 * @param {HTMLElement} parent - Élément conteneur
 * @param {string} initialContent - Contenu initial
 * @param {Function} onChange - Callback appelé quand le document change (reçoit boolean dirty)
 * @returns {EditorView}
 */
export async function createEditor(parent, initialContent = "", onChange, onCursorMove, markdownShortcuts = false, fileListProvider = null, filePath = "") {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) {
      onChange(true);
    }
  });

  // Raccourcis markdown (gérés globalement dans main.js)
  const mdKeymap = markdownShortcuts ? [] : [];

  // Intercepter Ctrl+I au niveau CodeMirror (avant que la WebView ne touche la sélection)
  const mdDomHandlers = markdownShortcuts ? EditorView.domEventHandlers({
    keydown: (event, view) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "i") {
        event.preventDefault();
        wrapItalic(view);
        return true;
      }
      return false;
    }
  }) : [];

  // Déterminer le langage en fonction de l'extension du fichier
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const isMd = filePath.endsWith(".md");

  // Charger le langage correspondant (lazy)
  const languageSupport = await getLanguageForFile(filePath);

  // Auto-complétion markdown
  const autoComplete = fileListProvider
    ? autocompletion({ override: [mdPathCompletion(fileListProvider)] })
    : [];

  // Build language extensions based on file type
  const languageExtensions = [];
  if (languageSupport) {
    languageExtensions.push(languageSupport);
    // Pour Markdown, on configure les blocs de code avec coloration multi-langages
    // (déjà intégré dans languages.js via codeLanguageInfo)
  } else if (isMd) {
    // Fallback : markdown sans blocs de code colorés (ne devrait pas arriver car codeLanguageInfo est défini)
    languageExtensions.push(markdown({ base: markdownLanguage }));
  }

  // Code folding + bracket matching (pour tous les langages)
  const foldingExtensions = languageSupport
    ? [foldGutter(), indentOnInput(), bracketMatching(), keymap.of(foldKeymap)]
    : [];

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, ...searchKeymap,
        ...mdKeymap,
        { key: "Mod-d", run: selectNextOccurrence },
      ]),
      ...languageExtensions,
      ...foldingExtensions,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      search({ top: true }),
      highlightSelectionMatches(),
      autoComplete,
      mdDomHandlers,
      oneDark,
      placeholder("Commencez à écrire..."),
      updateListener,
      // Écouter la position du curseur
      onCursorMove ? EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          onCursorMove(update.view);
        }
      }) : [],
      // Re-apply theme when it changes
      EditorView.theme({}, { dark: document.body.classList.contains("theme-dark") }),
      // Inline AI completion
      inlineCompletionExtension(filePath),
      // Word wrap (compartment pour toggle dynamique)
      wrapCompartment.of([]),
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  // Intercepter Ctrl+I et Ctrl+V (paste image) en phase de capture (avant contentEditable)
  if (markdownShortcuts) {
    parent.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        e.stopPropagation();
        wrapItalic(view);
      }
    }, true);

    // Drag & drop d'images dans l'éditeur
    parent.addEventListener("dragover", (e) => {
      if (hasImageFiles(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }
    });

    parent.addEventListener("drop", async (e) => {
      if (!hasImageFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      for (const file of e.dataTransfer.files) {
        if (isImageFile(file)) {
          await handleImageFile(file, view);
        }
      }
    });

    // Ctrl+V : coller une image depuis le presse-papiers
    parent.addEventListener("paste", (e) => {
      if (hasImageInClipboard(e)) {
        e.preventDefault();
        e.stopPropagation();
        const file = getImageFromClipboard(e);
        if (file) {
          // Donner un nom basé sur le type MIME
          const namedFile = new File([file], fileNameFromMime(file.type), { type: file.type });
          handleImageFile(namedFile, view);
        }
      }
    }, true); // phase capture pour court-circuiter CodeMirror avant qu'il ne traite le paste
  }

  // Réagir aux changements de thème globaux
  window.addEventListener("theme-changed", (e) => {
    const isDark = e.detail.theme === "dark";
    view.dispatch({
      effects: view.state.field(EditorView.darkTheme).reconfigure(
        isDark ? oneDark : []
      ),
    });
  });

  return view;
}

/**
 * Récupère le contenu actuel de l'éditeur
 * @param {EditorView} view
 * @returns {string}
 */
export function getContent(view) {
  return view.state.doc.toString();
}

/**
 * Remplace le contenu de l'éditeur
 * @param {EditorView} view
 * @param {string} content
 */
export function setContent(view, content, { preserveCursor = true } = {}) {
  if (preserveCursor) {
    // Sauvegarder la position du curseur et du scroll
    const pos = view.state.selection.main.head;
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch(
      {
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      },
      { selection: { anchor: Math.min(pos, content.length) } },
      { scrollIntoView: false }
    );
    // Restaurer le scroll après le dispatch
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = scrollTop;
    });
  } else {
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
  }
}

/**
 * Marque l'éditeur comme propre (non modifié)
 * @param {EditorView} view
 */
export function markClean(view) {
  // Marque le point d'annulation actuel comme "sauvegardé"
  // Pour la détection de dirty, on compare simplement les contenus
}

/**
 * Détruit l'instance CodeMirror
 * @param {EditorView} view
 */
export function destroyEditor(view) {
  rejectInlineCompletion(view);
  view.destroy();
}

/**
 * Active ou désactive le word wrap sur une vue existante
 * @param {EditorView} view
 * @param {boolean} enabled
 */
export function setWordWrap(view, enabled) {
  if (!view) return;
  view.dispatch({
    effects: wrapCompartment.reconfigure(enabled ? [EditorView.lineWrapping] : []),
  });
}

// ── Commandes markdown (exportées pour usage global) ──

export function wrapBold(view) {
  return wrapSelection(view, "**");
}

export function wrapItalic(view) {
  return wrapSelection(view, "*");
}

export function wrapLink(view) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = `[${selected}](url)`;
  const cursor = selected ? from + text.length - 4 : from + 1;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: cursor },
  });
  return true;
}

// ── Helper interne ──

function wrapSelection(view, before, after = before) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = selected ? before + selected + after : before + after;
  const cursor = selected ? to + before.length + after.length : from + before.length;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: cursor },
  });
  return true;
}

// ── Auto-complétion chemins markdown ──

function mdPathCompletion(fileListProvider) {
  return (context) => {
    // Vérifier qu'on est dans un lien markdown: ]( ou ![  ](
    const line = context.state.doc.lineAt(context.pos);
    const lineBefore = line.text.slice(0, context.pos - line.from);
    const linkMatch = lineBefore.match(/(?:!?\[[^\]]*\])\(([^)]*)$/);
    if (!linkMatch) return null;

    const typed = linkMatch[1];
    const files = fileListProvider();
    if (!files || files.length === 0) return null;

    const options = files
      .filter(f => f.toLowerCase().includes(typed.toLowerCase()))
      .map(f => ({
        label: f,
        type: f.endsWith('/') ? 'folder' : 'file',
        apply: f,
        detail: f.endsWith('/') ? 'Dossier' : 'Fichier',
      }));

    if (options.length === 0) return null;

    return {
      from: context.pos - typed.length,
      options,
      filter: false,
    };
  };
}
