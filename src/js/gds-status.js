// gds-status.js — Détection « projet branché sur un GDS » (spec_gds.md)
//
// Un projet est « branché sur un GDS » quand il a une configuration GDS
// (`.pilot/gds.json` présent et activé). Évolution 3 : l'état est rendu
// honnête via la commande Tauri `gds_connection_status` (retourne
// 'connected' | 'error' | 'not_configured'), pour que le bandeau reflète la
// réalité de la connexion (dépôt bare valide, remote `gds` présent, pool
// joignable) et pas seulement la présence du fichier de config. Fail-open :
// toute erreur → non branché (jamais bloquant).

import { invoke } from "@tauri-apps/api/core";

/**
 * Mappe la réponse du backend (commande `gds_connection_status`) sur un état
 * normalisé. Pure — testable. Toute valeur inattendue / manquante →
 * `'not_configured'` (fail-open).
 * @param {{status?: string} | null | undefined} v - réponse Tauri.
 * @returns {string} `'connected'` | `'error'` | `'not_configured'`.
 */
export function mapGdsStatus(v) {
  const s = v && v.status;
  return s === "connected" || s === "error" ? s : "not_configured";
}

/**
 * Décision de badge « connecté » : SEULE la valeur `'connected'` (évol 3)
 * justifie le suffixe GDS. `'error'` et `'not_configured'` sont des chaînes
 * TRUTHY mais ne doivent JAMAIS être traitées comme connectées (piège qui a
 * causé une régression : tous les badges assistant suffixés `- (GDS)`). Pure.
 * @param {string} status - résultat de `isProjectGds`.
 * @returns {boolean} `true` uniquement si `status === "connected"`.
 */
export function isGdsConnected(status) {
  return status === "connected";
}

/**
 * Retourne l'état de connexion GDS d'un projet : `'connected'` | `'error'` |
 * `'not_configured'`. Fail-open : erreur d'appel → `'not_configured'`. Ne
 * révèle jamais de mot de passe (le backend ne remonte que l'état).
 * @param {string} projectPath - chemin du projet.
 * @returns {Promise<string>}
 */
export async function isProjectGds(projectPath) {
  if (!projectPath) return "not_configured";
  try {
    const res = await invoke("gds_connection_status", { project: projectPath });
    return mapGdsStatus(res);
  } catch (_) {
    return "not_configured"; // fail-open : jamais bloquant
  }
}
