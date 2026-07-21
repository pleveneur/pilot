// context-engine.js — Context Engine H1 (V1 heuristique)
//
// Construit un bloc de contexte projet à injecter avant le 1er prompt d'une
// session agent (chat standard). V1 heuristique : fichiers importants détectés
// par règles, dans un budget de tokens. Voir spec_context_engine.md.
//
// Fonctions pures + helpers async (readSafe). Pas de state global.

import { invoke } from "@tauri-apps/api/core";

/** Estimation grossière du nombre de tokens : ~3.5 chars/token (conservatif). */
export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(str.length / 3.5);
}

/** Tronque une chaîne à un budget de tokens donné. Ajoute un marqueur de troncature. */
export function truncateToTokens(str, budgetTokens) {
  if (!str) return "";
  const maxChars = Math.max(0, Math.floor(budgetTokens * 3.5));
  if (str.length <= maxChars) return str;
  // Tronquer sur un multiple de ligne si possible (propre)
  const cut = str.slice(0, maxChars);
  const lastNl = cut.lastIndexOf("\n");
  const head = lastNl > maxChars * 0.5 ? cut.slice(0, lastNl) : cut;
  return head + "\n…[tronqué " + Math.round((str.length - head.length) / 3.5) + " tokens]…";
}

/** Lit un fichier en sécurité (retourne null si absent/illisible). */
async function readSafe(absPath) {
  try {
    const exists = await invoke("file_exists", { path: absPath });
    if (!exists) return null;
    const text = await invoke("read_file_content", { path: absPath });
    return text == null ? null : text;
  } catch (_) {
    return null;
  }
}

/** Joint un chemin relatif à un dossier projet (séparateur OS-agnostique). */
function joinPath(projectPath, rel) {
  const base = (projectPath || "").replace(/[\\/]+$/, "");
  return base + "/" + rel;
}

/** Détecte la "langue" d'un fichier depuis son extension (pour l'extraction d'imports). */
function detectLang(path) {
  const ext = (path.match(/\.([a-zA-Z0-9]+)$/) || [, ""])[1].toLowerCase();
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) return "js";
  if (["py"].includes(ext)) return "py";
  if (["md", "markdown"].includes(ext)) return "md";
  return null;
}

/**
 * Extrait les imports relatifs d'un contenu selon la langue.
 * Retourne une liste de chemins relatifs (résolus par rapport au fichier source).
 * V1 : JS/TS/Python/Markdown. Rust/C++ en V2.
 */
export function extractImports(content, lang) {
  if (!content || !lang) return [];
  const out = new Set();
  if (lang === "js") {
    // import ... from 'relative'  /  require('relative')
    const reImport = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+)['"]([^'"]+)['"]/g;
    const reRequire = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = reImport.exec(content))) {
      if (m[1].startsWith(".") || m[1].startsWith("/")) out.add(m[1]);
    }
    while ((m = reRequire.exec(content))) {
      if (m[1].startsWith(".") || m[1].startsWith("/")) out.add(m[1]);
    }
  } else if (lang === "py") {
    // from .relative import ...  /  from .relative.x import ...
    const reFrom = /^\s*from\s+(\.+[\w.]*)\s+import/gm;
    let m;
    while ((m = reFrom.exec(content))) {
      out.add(m[1]);
    }
  } else if (lang === "md") {
    // [label](relative.md) — on garde les liens relatifs non http
    const reLink = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = reLink.exec(content))) {
      const target = m[1].split("#")[0].split("?")[0].trim();
      if (!target) continue;
      if (target.startsWith("http") || target.startsWith("mailto:") || target.startsWith("/")) continue;
      if (target.startsWith("#")) continue;
      out.add(target);
    }
  }
  return [...out];
}

/** Résout un import relatif en chemin absolu en essayant plusieurs extensions.
 *  Retourne { rel, abs } ou null. */
async function resolveImport(projectPath, sourceRel, importPath) {
  // Normaliser l'import vers un chemin relatif au projet
  let rel = importPath;
  // Depuis un sous-dossier : remonter les ../
  const sourceDir = sourceRel.includes("/") ? sourceRel.replace(/\/[^/]*$/, "") : "";
  const parts = (sourceDir ? sourceDir.split("/") : []);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg === "." || seg === "") continue;
    else parts.push(seg);
  }
  rel = parts.join("/");
  // Si l'import a déjà une extension, on l'essaie tel quel
  const candidates = [];
  if (/\.[a-zA-Z0-9]+$/.test(rel)) {
    candidates.push(rel);
  } else {
    // Essayer des extensions puis index.* selon la langue du fichier source
    const lang = detectLang(sourceRel);
    if (lang === "py") {
      candidates.push(rel + ".py", rel + "/__init__.py");
    } else if (lang === "md") {
      candidates.push(rel + ".md", rel + "/index.md", rel + "/README.md");
    } else {
      candidates.push(rel + ".js", rel + ".ts", rel + ".mjs", rel + ".jsx", rel + ".tsx", rel + "/index.js", rel + "/index.ts");
    }
  }
  for (const c of candidates) {
    const abs = joinPath(projectPath, c);
    try {
      if (await invoke("file_exists", { path: abs })) return { rel: c, abs };
    } catch (_) { /* ignore */ }
  }
  return null;
}

/** Parse la table de navigation d'AGENTS.md et retourne la liste des fichiers de spec.
 *  Reconnaît la table "| Tâche | Fichier(s) à lire |" et extrait les chemins de la
 *  2e colonne (cellules contenant des liens/chemins .md). */
export function parseAgentsNavTable(agentsContent) {
  if (!agentsContent) return [];
  const lines = agentsContent.split(/\r?\n/);
  const files = new Set();
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) { inTable = false; continue; }
    const cells = trimmed.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length === 0) continue;
    // Ligne de séparation (|---|---|) → on est dans une table
    if (cells.every((c) => /^[-:]+$/.test(c))) { inTable = true; continue; }
    if (!inTable) continue;
    // 2e colonne = fichiers à lire. On extrait les chemins `.md` et chemins relatifs.
    // On scanne en fait toutes les cellules après la première pour attraper les liens.
    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i];
      // Liens markdown [text](path) ou backticks `path`
      const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
      let m;
      while ((m = linkRe.exec(cell))) {
        const p = m[2].split("#")[0].trim();
        if (p && (p.endsWith(".md") || p.endsWith(".rs") || p.endsWith(".js"))) files.add(p);
      }
      const tickRe = /`([^`]+)`/g;
      while ((m = tickRe.exec(cell))) {
        const p = m[1].trim();
        if (p && /\.(md|rs|js|ts|py|toml|json)$/i.test(p) && !p.includes(" ")) files.add(p);
      }
      // Chemin nu finissant par .md
      const mdRe = /\b([\w./-]+\.md)\b/g;
      while ((m = mdRe.exec(cell))) files.add(m[1]);
    }
  }
  return [...files];
}

/** Manifestes courts à inclure (seulement des sections utiles, V1 = fichier entier
 *  mais budget réduit). */
const MANIFEST_FILES = [
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "jsconfig.json",
];

const PRIORITY_FILES = ["AGENTS.md", ".pilot/context.md", "README.md"];

/** Lit les N derniers fichiers récemment édités (chemins absolus ou relatifs).
 *  `recents` = tableau de chemins (relatifs au projet ou absolus). */
function normalizeRecent(projectPath, p) {
  if (!p) return null;
  if (p.startsWith(projectPath)) return p.slice(projectPath.length).replace(/^[\\/]+/, "");
  return p;
}

/**
 * Construit le bloc de contexte projet.
 *
 * @param {string} projectPath - chemin absolu du projet (window._pilotProjectPath)
 * @param {object|null} activeTab - onglet actif { path, content? } (fichier courant)
 * @param {string[]} recents - chemins récemment édités (absolus ou relatifs)
 * @param {object} opts - { enabled, budgetTokens, includeImports, includeSpecs, includeRecents }
 * @param {function} [readFn] - injectable pour tests (async (absPath) => string|null)
 * @returns {Promise<string>} bloc formaté (vide si rien à injecter)
 */
export async function buildProjectContext(projectPath, activeTab, recents, opts, readFn) {
  const read = readFn || readSafe;
  if (!projectPath || !opts || opts.enabled === false) return "";
  const budget = Math.max(1000, opts.budgetTokens || 8000);

  const sections = []; // { label, rel, content, tokens }
  let used = 0;

  // Helper : ajoute une section si elle tient dans le budget restant alloué
  async function addFile(rel, maxShare) {
    if (!rel) return false;
    const abs = joinPath(projectPath, rel);
    const content = await read(abs);
    if (content == null || content.length === 0) return false;
    const share = Math.floor(budget * maxShare);
    const allowed = Math.max(0, share - estimateTokens("### " + rel + "\n"));
    const truncated = truncateToTokens(content, allowed);
    const t = estimateTokens(truncated);
    sections.push({ label: rel, content: truncated, tokens: t });
    used += t;
    return true;
  }

  // 1-3 : fichiers prioritaires (AGENTS.md, .pilot/context.md, fichier actif)
  for (const rel of PRIORITY_FILES) {
    if (used >= budget) break;
    await addFile(rel, 0.40);
  }
  // Fichier actif (onglet d'édition courant) — remplace README si on a un onglet
  let activeContent = null;
  let activeRel = null;
  if (activeTab && activeTab.path) {
    const abs = activeTab.path;
    activeRel = abs.startsWith(projectPath)
      ? abs.slice(projectPath.length).replace(/^[\\/]+/, "")
      : abs;
    if (activeTab.content != null) {
      activeContent = activeTab.content;
    } else {
      activeContent = await read(abs);
    }
  }
  if (activeContent && activeContent.length > 0 && used < budget) {
    // Éviter doublon si le fichier actif est déjà inclus (ex: README.md ouvert)
    if (!sections.some((s) => s.label === activeRel)) {
      const share = Math.floor(budget * 0.20);
      const allowed = Math.max(0, share - estimateTokens("### " + activeRel + "\n"));
      const truncated = truncateToTokens(activeContent, allowed);
      const t = estimateTokens(truncated);
      sections.push({ label: activeRel, content: truncated, tokens: t });
      used += t;
    }
  }

  // 4 : imports du fichier actif
  if (opts.includeImports !== false && activeContent && activeRel) {
    const lang = detectLang(activeRel);
    const imports = extractImports(activeContent, lang);
    const importBudget = Math.floor(budget * 0.15);
    let importUsed = 0;
    for (const imp of imports) {
      if (importUsed >= importBudget || used >= budget) break;
      const resolved = await resolveImport(projectPath, activeRel, imp);
      if (!resolved) continue;
      const content = await read(resolved.abs);
      if (content == null || content.length === 0) continue;
      const allowed = Math.max(0, Math.floor(importBudget / Math.max(1, imports.length)));
      const truncated = truncateToTokens(content, allowed);
      const t = estimateTokens(truncated);
      sections.push({ label: resolved.rel, content: truncated, tokens: t });
      importUsed += t;
      used += t;
    }
  }

  // 5 : manifestes
  for (const rel of MANIFEST_FILES) {
    if (used >= budget) break;
    await addFile(rel, 0.05);
  }

  // 6 : specs référencées dans AGENTS.md
  if (opts.includeSpecs !== false) {
    const agentsSection = sections.find((s) => s.label === "AGENTS.md");
    if (agentsSection) {
      const specFiles = parseAgentsNavTable(agentsSection.content);
      const specsBudget = Math.floor(budget * 0.20);
      let specsUsed = 0;
      for (const rel of specFiles) {
        if (specsUsed >= specsBudget || used >= budget) break;
        // Éviter doublon avec déjà inclus
        if (sections.some((s) => s.label === rel)) continue;
        const abs = joinPath(projectPath, rel);
        const content = await read(abs);
        if (content == null || content.length === 0) continue;
        const allowed = Math.max(0, Math.floor(specsBudget / Math.max(1, specFiles.length)));
        const truncated = truncateToTokens(content, allowed);
        const t = estimateTokens(truncated);
        sections.push({ label: rel, content: truncated, tokens: t });
        specsUsed += t;
        used += t;
      }
    }
  }

  // 7 : fichiers récemment édités
  if (opts.includeRecents !== false && Array.isArray(recents) && recents.length > 0) {
    const recBudget = Math.floor(budget * 0.05);
    let recUsed = 0;
    const seen = new Set(sections.map((s) => s.label));
    for (const r of recents.slice(0, 5)) {
      if (recUsed >= recBudget || used >= budget) break;
      const rel = normalizeRecent(projectPath, r);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const abs = joinPath(projectPath, rel);
      const content = await read(abs);
      if (content == null || content.length === 0) continue;
      const allowed = Math.max(0, Math.floor(recBudget / 5));
      const truncated = truncateToTokens(content, allowed);
      const t = estimateTokens(truncated);
      sections.push({ label: rel, content: truncated, tokens: t });
      recUsed += t;
      used += t;
    }
  }

  if (sections.length === 0) return "";

  // Format final
  const parts = sections.map((s) => `### ${s.label}\n${s.content}`).join("\n\n");
  return `=== CONTEXTE PROJET (auto-injecté par Pilot — ne pas répondre à cette section) ===\n${parts}\n=== FIN CONTEXTE ===\n\n`;
}