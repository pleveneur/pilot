// languages.js — Multi-language support for CodeMirror 6
//
// Maps file extensions to CodeMirror language extensions with lazy loading.
// Also provides codeLanguages for Markdown fenced code blocks.

import { LanguageDescription } from "@codemirror/language";

// ── Registry of all supported languages ──
// LanguageDescription.matchLanguageName is used by markdown code blocks.
// Each entry is lazily loaded only when needed.

const languageDescriptions = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js", "jsx"],
    extensions: ["js", "mjs", "cjs", "jsx"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true })
      );
    },
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["typescript", "ts", "tsx"],
    extensions: ["ts", "cts", "mts", "tsx"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true, typescript: true })
      );
    },
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    extensions: ["css"],
    load() {
      return import("@codemirror/lang-css").then((m) => m.css());
    },
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    extensions: ["html", "htm"],
    load() {
      return import("@codemirror/lang-html").then((m) => m.html());
    },
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    extensions: ["json", "jsonc"],
    load() {
      return import("@codemirror/lang-json").then((m) => m.json());
    },
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["python", "py"],
    extensions: ["py", "pyw"],
    load() {
      return import("@codemirror/lang-python").then((m) => m.python());
    },
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rust", "rs"],
    extensions: ["rs"],
    load() {
      return import("@codemirror/lang-rust").then((m) => m.rust());
    },
  }),
  LanguageDescription.of({
    name: "Java",
    alias: ["java"],
    extensions: ["java"],
    load() {
      return import("@codemirror/lang-java").then((m) => m.java());
    },
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c++", "c", "objc", "objcpp", "objective-c", "objective-c++"],
    extensions: ["c", "cpp", "cxx", "cc", "cxx", "h", "hh", "hpp", "hxx", "ino"],
    load() {
      return import("@codemirror/lang-cpp").then((m) => m.cpp());
    },
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    extensions: ["sql"],
    load() {
      return import("@codemirror/lang-sql").then((m) => m.sql());
    },
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    extensions: ["yaml", "yml"],
    load() {
      return import("@codemirror/lang-yaml").then((m) => m.yaml());
    },
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["xml", "svg", "rss", "atom"],
    extensions: ["xml", "svg", "xsl", "xslt", "xsd", "tld", "dtd"],
    load() {
      return import("@codemirror/lang-xml").then((m) => m.xml());
    },
  }),
  LanguageDescription.of({
    name: "PHP",
    alias: ["php", "php3", "php4", "php5", "php7", "phtml"],
    extensions: ["php", "php3", "php4", "php5", "php7", "phtml"],
    load() {
      return import("@codemirror/lang-php").then((m) => m.php());
    },
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["markdown", "md", "mkd"],
    extensions: ["md", "mdx", "markdown", "mkd"],
    load() {
      return import("@codemirror/lang-markdown").then((m) =>
        m.markdown({ codeLanguages: codeLanguageInfo })
      );
    },
  }),
];

// ── Lookup: extension → LanguageDescription ──

const extToDescription = new Map();
for (const desc of languageDescriptions) {
  for (const ext of desc.extensions) {
    extToDescription.set(ext, desc);
  }
}

/**
 * Returns the LanguageDescription for a given file extension, or null.
 * @param {string} ext - File extension without dot (e.g. "js", "py")
 * @returns {LanguageDescription | null}
 */
export function getLanguageDescription(ext) {
  return extToDescription.get(ext) || null;
}

/**
 * Returns the CodeMirror LanguageSupport for a file path.
 * Loads the language lazily if needed.
 * @param {string} filePath - Full file path (extension used to detect language)
 * @returns {Promise<LanguageSupport | null>}
 */
export async function getLanguageForFile(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const desc = getLanguageDescription(ext);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch (err) {
    console.warn(`[languages] Failed to load language for ${ext}:`, err);
    return null;
  }
}

/**
 * Returns the list of LanguageDescription for Markdown code blocks.
 * Used as the `codeLanguages` option of `markdown()`.
 */
export function codeLanguageInfo() {
  return languageDescriptions;
}

/**
 * Returns the language name for a file extension (for the status bar).
 * @param {string} ext - File extension without dot
 * @returns {string}
 */
export function getLanguageName(ext) {
  const desc = getLanguageDescription(ext);
  if (desc) return desc.name;
  const names = {
    toml: "TOML",
    sh: "Shell",
    bash: "Shell",
    bat: "Batch",
    cmd: "Batch",
    ps1: "PowerShell",
    rb: "Ruby",
    go: "Go",
    swift: "Swift",
    kt: "Kotlin",
    dart: "Dart",
    r: "R",
    lua: "Lua",
    perl: "Perl",
    dockerfile: "Dockerfile",
    gitignore: "Git Ignore",
    env: "Env",
    txt: "Text",
    log: "Log",
    csv: "CSV",
    tsx: "TypeScript (JSX)",
  };
  return names[ext] || ext.toUpperCase();
}