// agent-model-selector.js — Cause C4 du diagnostic de délégation.
//
// Plusieurs onglets agents cohabitent dans le MÊME document HTML. Les
// sélecteurs de modèle portaient des id globaux et partagés
// (`agent-model-select`, `agent-orch-model-select`, `agent-coder-model-select`).
// Or `document.getElementById(id)` renvoie toujours le PREMIER élément du
// document portant cet id : avec deux onglets agents ouverts, choisir un modèle
// dans l'agent 2 modifiait la sélection affichée (et suivie) de l'agent 1.
//
// On dérive donc des id UNIQUES du couple (chemin de projet, id d'agent), et on
// résout systématiquement les éléments à partir de ces id — jamais par un id
// partagé. Ce module reste pur (aucun accès DOM) pour être testable.

/**
 * Réduit une chaîne à un fragment d'id HTML sûr : seuls `[A-Za-z0-9_-]` sont
 * conservés, les autres caractères deviennent `_` (les id HTML ne doivent pas
 * contenir d'espace ni de `/`). Retourne `x` si le résultat est vide.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function sanitizeIdPart(value) {
  const cleaned = String(value == null ? "" : value)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "x";
}

/**
 * Empreinte courte et déterministe du chemin de projet (FNV-1a 32 bits,
 * séparateurs normalisés, slash final ignoré). Elle permet de distinguer deux
 * projets qui utiliseraient le même id d'agent (« default ») sans exposer le
 * chemin complet dans le DOM.
 * @param {string|null|undefined} projectPath
 * @returns {string} 8 caractères hexadécimaux
 */
export function projectFingerprint(projectPath) {
  const path = String(projectPath == null ? "" : projectPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Identifiants des trois sélecteurs de modèle d'un agent (projet + agent).
 * Idempotent : le même couple rend toujours les mêmes id, ce qui permet aux
 * appelants qui ne connaissent que le `state` de l'agent de les reconstruire.
 * @param {string|null|undefined} agentId
 * @param {string|null|undefined} projectPath
 * @returns {{standard: string, orchestrator: string, coder: string}}
 */
export function agentSelectorIds(agentId, projectPath) {
  const suffix = `${projectFingerprint(projectPath)}-${sanitizeIdPart(agentId || "default")}`;
  return {
    standard: `agent-model-select-${suffix}`,
    orchestrator: `agent-orch-model-select-${suffix}`,
    coder: `agent-coder-model-select-${suffix}`,
  };
}

/**
 * Résout un sélecteur de modèle (`standard` | `orchestrator` | `coder`) à
 * partir de ses id propres à l'agent.
 * @param {(id: string) => any} lookup lecteur d'élément (ex :
 *   `(id) => document.getElementById(id)`) — injectable pour les tests.
 * @param {{[k: string]: string}|null|undefined} ids
 * @param {"standard"|"orchestrator"|"coder"} [kind]
 * @returns {any|null} l'élément, ou `null` si absent.
 */
export function findModelSelect(lookup, ids, kind = "standard") {
  if (typeof lookup !== "function" || !ids) return null;
  return lookup(ids[kind]) || null;
}
