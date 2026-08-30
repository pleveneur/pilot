// gds-status.js — Détection « projet branché sur un GDS » (spec_gds.md)
//
// Un projet est « branché sur un GDS » quand il a une configuration GDS
// (`.pilot/gds.json` présent et activé). Réutilise la commande Tauri
// `gds_get_config` (retourne `null` si le fichier n'existe pas, sinon la
// config). Fail-open : toute erreur → non branché (jamais bloquant).

import { invoke } from "@tauri-apps/api/core";

/**
 * Retourne `true` si le projet est branché sur un GDS (config `.pilot/gds.json`
 * présente et activée), `false` sinon. Fail-open : erreur → `false`.
 * @param {string} projectPath - chemin du projet.
 * @returns {Promise<boolean>}
 */
export async function isProjectGds(projectPath) {
  if (!projectPath) return false;
  try {
    const cfg = await invoke("gds_get_config", { project: projectPath });
    return !!(cfg && cfg.enabled === true);
  } catch (_) {
    return false; // fail-open : jamais bloquant
  }
}
