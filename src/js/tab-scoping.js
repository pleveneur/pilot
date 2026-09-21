// tab-scoping.js — Logique pure de scoping des onglets agents par projet (T1/T2).
//
// Extraite de tabs.js / sidebar.js pour être testable unitairement (vitest).
// Multi-projets : les onglets agents sont scopés par projet — deux projets
// peuvent avoir chacun leur onglet agent du même id, et un changement de projet
// ne ferme plus les onglets agents (keepAgents).

/** Normalise un chemin (séparateurs \ vs /) pour comparaison. */
export function normPath(p) {
  return p ? String(p).replace(/\\/g, "/") : p;
}

/** Compare deux chemins de projet sans tenir compte des séparateurs. */
export function sameProjectPath(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return normPath(a) === normPath(b);
}

/**
 * T1 : retrouve l'onglet agent existant pour (projectPath, agentId).
 * L'onglet agent est scopé par projet : deux projets peuvent avoir chacun leur
 * onglet agent du même id. Retourne undefined si aucun onglet ne correspond.
 */
export function findAgentTab(tabs, agentId, projectPath) {
  return (tabs || []).find(
    (t) => t.mode === "agent" && t.agentId === agentId && sameProjectPath(t.projectPath, projectPath)
  );
}

// Onglets TRANSVERSES : indépendants du projet actif, jamais fermés lors d'un
// changement/fermeture de projet. `gds-params` (L5.1) rejoint cette liste comme
// `gds-admin` (L4.1).
const GLOBAL_TAB_MODES = new Set(["superagent", "dashboard", "gds-admin", "gds-params"]);

/**
 * T2 : détermine si un onglet doit être fermé lors d'un changement de projet.
 * `keepAgents=true` conserve les onglets agents (scopés par projet) ; seuls les
 * onglets edit/preview/terminal sont fermés. Les onglets transverses/globaux
 * (superagent, dashboard, gds-admin, gds-params) ne sont jamais fermés ici : ils
 * persistent à travers les bascules et les fermetures de projets (ouverts sans
 * projet).
 */
export function shouldCloseTab(tab, keepAgents) {
  if (GLOBAL_TAB_MODES.has(tab.mode)) return false;
  if (keepAgents && tab.mode === "agent") return false;
  return true;
}
