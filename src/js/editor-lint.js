// editor-lint.js — Lint diagnostics inline (B2)
//
// Extension CodeMirror 6 (`@codemirror/lint`) qui affiche les erreurs/warnings
// du linter du projet directement dans l'éditeur (gouttière + souligné + tooltip).
//
// V1 : JS/TS via eslint (`lint_file` Rust, format JSON). Les autres langages ne
// reçoivent pas l'extension (pas d'appel inutile au backend). Le lint est
// debouncé (`delay`) et échoue silencieusement (eslint absent/cassé → aucun
// diagnostic, pas de crash éditeur).

import { linter, lintGutter } from "@codemirror/lint";
import { invoke } from "@tauri-apps/api/core";

const LINTABLE_EXT = ["js", "ts", "jsx", "tsx", "mjs", "cjs", "vue"];

/** Retourne true si le fichier est lintable par le backend (JS/TS V1). */
function isLintable(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return LINTABLE_EXT.includes(ext);
}

/** Convertit (ligne 1-indexée, colonne 1-indexée) en offset CodeMirror. */
function posFor(view, line, col) {
  const doc = view.state.doc;
  const n = Math.min(Math.max(line, 1), doc.lines);
  const docLine = doc.line(n);
  return Math.min(docLine.from + Math.max(col - 1, 0), docLine.to);
}

/**
 * Construit l'extension de lint inline pour un fichier donné.
 * Retourne [] si le fichier n'est pas lintable (V1 : JS/TS uniquement).
 * @param {string} filePath
 * @returns {import("@codemirror/state").Extension[]}
 */
export function lintExtension(filePath) {
  if (!filePath || !isLintable(filePath)) return [];

  const lintFn = async (view) => {
    try {
      const diags = await invoke("lint_file", { path: filePath });
      if (!Array.isArray(diags)) return [];
      return diags.map((d) => ({
        from: posFor(view, d.from_line, d.from_col),
        to: posFor(view, d.to_line || d.from_line, d.to_col || d.from_col),
        severity: d.severity === "error" ? "error" : "warning",
        message: d.source ? `${d.message} (${d.source})` : d.message,
      }));
    } catch (_) {
      // eslint indisponible / projet non ouvert / erreur réseau → silencieux
      return [];
    }
  };

  return [
    lintGutter(),
    linter(lintFn, { delay: 1200, needsRefresh: null }),
  ];
}