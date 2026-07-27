// orchestration-reviewer.js — Fonctions pures du reviewer indépendant (H2 V1)
// Voir spec_orchestration_reviewer.md. Importé par agent-pi.js.

/**
 * Matching simple de glob (supporte `*` et `**`, pas de classes `[...]`).
 * Convertit le glob en RegExp. `**` = n'importe quelle profondeur, `*` =
 * n'importe quelle séquence sans `/`. Utilisé pour `reviewer_critical_patterns`.
 * @param {string} filePath - chemin relatif (ex: "src-tauri/src/lib.rs")
 * @param {string} pattern  - glob (ex. 'src-tauri/src/*.rs', 'spec_*.md')
 * @returns {boolean}
 */
export function matchesGlob(filePath, pattern) {
  if (!filePath || !pattern) return false;
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i += 1;
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  try {
    return new RegExp("^(?:" + re + ")$").test(filePath);
  } catch (_) {
    return false;
  }
}

/**
 * Vérifie si au moins un fichier correspond aux patterns critiques (mode "critical").
 * @param {string[]} changedFiles - chemins relatifs des fichiers modifiés
 * @param {string[]} patterns    - globs critiques
 * @returns {boolean}
 */
export function matchesAnyCritical(changedFiles, patterns) {
  if (!Array.isArray(changedFiles) || !Array.isArray(patterns) || patterns.length === 0) return false;
  for (const f of changedFiles) {
    for (const p of patterns) {
      if (matchesGlob(f, p)) return true;
    }
  }
  return false;
}

/**
 * Construit le prompt du reviewer indépendant. Le reviewer reçoit le contenu
 * final des fichiers modifiés (pas un diff brut) + la description de la tâche +
 * les conventions projet. Il doit répondre APPROVED ou CHANGES_REQUESTED.
 * @param {object} task        - tâche (id, title, description)
 * @param {Array<{path, content}>} fileContents - fichiers modifiés (contenu final)
 * @param {string|null} projectMemory - contenu PROJECT_MEMORY.md (ou null)
 * @param {string|null} globalDirective - directive globale du plan (ou null)
 * @returns {string}
 */
export function buildReviewPrompt(task, fileContents, projectMemory, globalDirective) {
  const title = (task && task.title) || (task && task.id) || "?";
  const desc = (task && task.description) || "";
  const filesBlock = (fileContents || []).map((f) => {
    const header = "════════════════════════════════════════════════════════════\nFICHIER : " + f.path + "\n════════════════════════════════════════════════════════════";
    return header + "\n```\n" + (f.content || "(fichier vide)") + "\n```\n";
  }).join("\n");
  const memBlock = projectMemory ? "\n## Conventions du projet (PROJECT_MEMORY.md)\n" + projectMemory + "\n" : "";
  const directiveBlock = globalDirective ? "\n## Directive globale du plan\n" + globalDirective + "\n" : "";
  return [
    "Tu es un **reviewer indépendant**. Tu ne modifies rien (lecture seule, aucun outil d'écriture). Tu relis le code produit pour une tâche d'orchestration et tu juges s'il la réalise correctement, sans régression.",
    "",
    "## Tâche à valider",
    "**ID :** " + (task && task.id),
    "**Titre :** " + title,
    "**Description :**",
    desc,
    directiveBlock,
    memBlock,
    "## Fichiers modifiés par le codeur (état final)",
    filesBlock || "(aucun fichier fourni)",
    "",
    "## Ta mission",
    "Relis chaque fichier ci-dessus et vérifie :",
    "1. La tâche est **réellement** réalisée (pas seulement entamée).",
    "2. Pas de **régression** évidente (fonctionnalité cassée, import manquant, syntaxe invalide).",
    "3. Cohérence avec les conventions du projet (si fournies ci-dessus).",
    "4. Pas de **bug** évident (edge case non géré, condition inversée, etc.).",
    "",
    "## Format de sortie OBLIGATOIRE",
    "Termine ta réponse par **exactement** une de ces deux lignes (rien après) :",
    "- `APPROVED: <résumé court en une phrase>`  si tout est correct,",
    "- `CHANGES_REQUESTED: <liste numérotée et concrète des défauts à corriger>`  sinon.",
    "",
    "Ne donne pas d'avis général : sois factuel et précis sur ce qui doit changer.",
  ].join("\n");
}

/**
 * Parse la réponse du reviewer. Détecte le DERNIER marqueur (APPROVED ou
 * CHANGES_REQUESTED) par position dans le texte (même logique que detectCoderMarker).
 * @param {string} text - réponse brute du reviewer
 * @returns {{approved: boolean, summary: string, changes: string|null}}
 */
export function parseReviewResult(text) {
  if (!text || typeof text !== "string") return { approved: false, summary: "", changes: null };
  let approvedIdx = -1;
  let changesIdx = -1;
  const ap = text.search(/\bAPPROVED\b/i);
  if (ap !== -1) approvedIdx = ap;
  const ch = text.search(/\bCHANGES_REQUESTED\b/i);
  if (ch !== -1) changesIdx = ch;
  if (approvedIdx === -1 && changesIdx === -1) {
    return { approved: false, summary: "", changes: null };
  }
  if (approvedIdx > changesIdx) {
    const after = text.slice(approvedIdx).replace(/^\s*APPROVED\s*:?\s*/i, "").trim();
    return { approved: true, summary: (after.split("\n")[0] || "approuvé"), changes: null };
  }
  const after = text.slice(changesIdx).replace(/^\s*CHANGES_REQUESTED\s*:?\s*/i, "").trim();
  return { approved: false, summary: "", changes: after || "défauts non précisés" };
}

/**
 * Prompt court renvoyé au codeur quand le reviewer a demandé des corrections.
 * @param {object} task - tâche
 * @param {string} changes - liste des défauts du reviewer
 * @param {string|null} globalDirective
 * @returns {string}
 */
export function buildReviewCorrectionPrompt(task, changes, globalDirective) {
  const title = (task && task.title) || (task && task.id) || "?";
  const dir = globalDirective ? "\n" + globalDirective + "\n" : "";
  return "Le reviewer indépendant a relevé les défauts suivants sur la tâche \"" + title + "\" :\n\n" + changes + dir + "\nCorrige ces défauts avec le format SEARCH/REPLACE ou CREATE, relis les fichiers modifiés, puis termine par DONE: <résumé>.\n\nN'escalade pas. Corrige et renvoie DONE.";
}