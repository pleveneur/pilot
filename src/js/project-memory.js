// project-memory.js — Mémoire de projet auto-maintenue (H3)
//
// `PROJECT_MEMORY.md` : fichier de mémoire projet tenu par l'agent (conventions,
// pièges, décisions d'architecture, dépendances clés). Lu et injecté dans le
// contexte de l'agent avant chaque tâche (orchestration) / 1er prompt (chat).
// Enrichi par l'agent après chaque tâche d'orchestration (extraction opt-in).
//
// Fonctions pures + helpers async (read). Pas de state global. Voir
// spec_project_memory.md.

import { invoke } from "@tauri-apps/api/core";

export const MEMORY_FILE = "PROJECT_MEMORY.md";

export const MEMORY_TEMPLATE = `# Mémoire du projet — tenue par l'agent

> Conventions, pièges, décisions d'architecture, dépendances clés, anti-patterns.
> Ce fichier est enrichi automatiquement après chaque tâche d'orchestration et
> injecté dans le contexte de l'agent. Tu peux l'éditer manuellement.

## Conventions
- (à compléter par l'agent)

## Pièges / anti-patterns
- (à compléter par l'agent)

## Décisions d'architecture
- (à compléter par l'agent)

## Dépendances clés
- (à compléter par l'agent)
`;

/** Joint un chemin relatif à la racine projet (séparateur OS-agnostique). */
function joinPath(projectPath, rel) {
  const base = (projectPath || "").replace(/[\\/]+$/, "");
  return base + "/" + rel;
}

/** Chemin absolu du fichier mémoire pour un projet donné. */
export function memoryAbsPath(projectPath) {
  return joinPath(projectPath, MEMORY_FILE);
}

/** Lit le contenu de PROJECT_MEMORY.md (null si absent/illisible). */
export async function readProjectMemory(projectPath) {
  if (!projectPath) return null;
  const abs = memoryAbsPath(projectPath);
  try {
    const exists = await invoke("file_exists", { path: abs });
    if (!exists) return null;
    const text = await invoke("read_file_content", { path: abs });
    return text == null ? null : text;
  } catch (_) {
    return null;
  }
}

/**
 * Construit le bloc mémoire formaté à injecter dans un prompt.
 * Retourne "" si la mémoire est absente ou vide.
 */
export async function buildMemoryBlock(projectPath) {
  const content = await readProjectMemory(projectPath);
  if (!content || content.trim().length === 0) return "";
  return `=== MÉMOIRE DU PROJET (tenue par l'agent — conventions, pièges, décisions) ===\n${content}\n=== FIN MÉMOIRE ===\n\n`;
}

/**
 * Crée PROJECT_MEMORY.md avec le template s'il n'existe pas encore.
 * Retourne le chemin absolu (créé ou existant). Idempotent.
 */
export async function initProjectMemory(projectPath) {
  if (!projectPath) return null;
  const abs = memoryAbsPath(projectPath);
  try {
    const exists = await invoke("file_exists", { path: abs });
    if (!exists) {
      await invoke("write_file_content", { path: abs, content: MEMORY_TEMPLATE });
    }
  } catch (e) {
    console.warn("initProjectMemory: échec création:", e);
  }
  return abs;
}

/**
 * Construit le prompt d'extraction de faits post-tâche (orchestration).
 * Demande à l'agent d'ajouter 1–3 faits appris à PROJECT_MEMORY.md via
 * SEARCH/REPLACE / CREATE, ou de répondre NO_NEW_MEMORY si rien de nouveau.
 *
 * @param {object} task - tâche normalisée (doit avoir .title)
 * @param {string} taskSummary - résumé DONE de la tâche (texte de la réponse)
 * @returns {string} prompt d'extraction
 */
export function buildMemoryExtractPrompt(task, taskSummary) {
  const title = (task && task.title) || "(sans titre)";
  const summary = (taskSummary || "").slice(0, 1500);
  return `Tu viens de terminer la tâche « ${title} ».
Avant de passer à la suite, extrais 1 à 3 faits utiles appris pendant cette tâche (convention de code, piège rencontré, décision d'architecture, dépendance clé découverte, anti-pattern à éviter). Place chaque fait dans la section appropriée de PROJECT_MEMORY.md (Conventions / Pièges / Décisions / Dépendances) via un bloc SEARCH/REPLACE (ou CREATE si le fichier n'existe pas).

Règles strictes :
- 1 ligne par fait, impérativement concis.
- N'ajoute QUE du nouveau ; ne répète pas ce qui est déjà dans le fichier. Si besoin, lis d'abord PROJECT_MEMORY.md avec read_file.
- Si rien de nouveau n'a été appris, réponds EXACTEMENT : NO_NEW_MEMORY
- Ne modifie aucun autre fichier que PROJECT_MEMORY.md.

Tâche terminée : ${title}
Résumé de la tâche :
${summary}`;
}