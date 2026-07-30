// agents-md.js — Génération / mise à jour d'AGENTS.md par l'IA (issue #5).
//
// AGENTS.md est le fichier d'instructions projet lu nativement par pi et plh
// (discovery + injection system prompt). Cette fonction lance un pi temporaire
// cadré (cwd = projet) qui analyse le projet et crée/met à jour AGENTS.md.
//
// Le modèle utilisé est le modèle actif du chat (state.currentModel), passé par
// l'appelant. Voir spec_agents_md.md.

import { invoke } from "@tauri-apps/api/core";

export const AGENTS_MD_FILE = "AGENTS.md";

/**
 * Lance la génération / mise à jour d'AGENTS.md à la racine du projet courant.
 *
 * @param {string} model - modèle actif du chat (format "provider/modelId")
 * @param {object} ui - hooks d'UI { onInfo(message), onError(message), onSuccess(message) }
 * @returns {Promise<string|null>} résumé de l'agent, ou null si pas de projet
 */
export async function generateAgentsMd(model, ui) {
  const projectPath = window._pilotProjectPath;
  if (!projectPath) {
    ui.onError("Ouvre d'abord un projet pour générer AGENTS.md.");
    return null;
  }
  if (!model || !model.trim()) {
    ui.onError("Aucun modèle sélectionné pour le chat. Choisis un modèle avant de générer AGENTS.md.");
    return null;
  }

  ui.onInfo("🤖 Génération / mise à jour d'AGENTS.md en cours… (l'agent analyse le projet, cela peut prendre 1–3 min)");

  // Fermer l'onglet AGENTS.md s'il est déjà ouvert : l'agent va réécrire le
  // fichier sur disque, et rouvrir un onglet frais après évite un doublon
  // (la détection de doublon par samePath peut échouer selon le contexte HMR).
  const abs = joinPath(projectPath, AGENTS_MD_FILE);
  try {
    if (window._pilotTabs) {
      window._pilotTabs.closeTabByPath(abs);
    }
  } catch (e) {
    console.warn("Fermeture onglet AGENTS.md existant:", e);
  }

  let summary;
  try {
    summary = await invoke("generate_agents_md", { model });
  } catch (e) {
    ui.onError(`Échec génération AGENTS.md : ${e}`);
    return null;
  }

  // Ouvrir AGENTS.md dans l'éditeur pour que l'utilisateur vérifie le résultat.
  try {
    if (window._pilotTabs) {
      await window._pilotTabs.openFile(abs, "edit");
    }
  } catch (e) {
    console.warn("Ouverture AGENTS.md après génération:", e);
  }

  ui.onSuccess("✅ AGENTS.md généré / mis à jour.");
  return summary;
}

/** Joint un chemin relatif à la racine projet (séparateur OS-agnostique). */
function joinPath(projectPath, rel) {
  const base = (projectPath || "").replace(/[\\/]+$/, "");
  return base + "/" + rel;
}