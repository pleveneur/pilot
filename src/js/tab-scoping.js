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
//
// `agents` (onglet 🎭 des agents multi-rôles) est TRANSVERSE, comme 🧭 et 📊 :
// il pilote des agents de TOUS les projets (registre global, clé
// (projet, agent)). Le fermer pendant une bascule déclenchait son nettoyage —
// un arrêt GLOBAL de tous les processus d'agents — et tuait donc les agents du
// projet quitté, du projet ouvert ET d'un troisième projet (diagnostic du
// 2026-10-21). Règle propriétaire : l'écran ne commande plus le travail, un
// changement/une fermeture de projet ne ferme plus cet onglet.
//
// `settings` (Reglages) rejoint cette liste en PREPARATION (lot A de
// docs/proposition-reglages-en-onglet.md) : les Reglages deviennent un onglet
// transverse le jour ou ils quittent leur fenetre (lot B). Tant qu'aucun onglet
// de ce mode n'existe, l'ajout est sans effet.
const GLOBAL_TAB_MODES = new Set(["superagent", "dashboard", "gds-admin", "gds-params", "agents", "settings"]);

/**
 * T2 : détermine si un onglet doit être fermé lors d'un changement de projet.
 * `keepAgents=true` conserve les onglets agents (scopés par projet) ; seuls les
 * onglets edit/preview/terminal sont fermés. Les onglets transverses/globaux
 * (superagent, dashboard, gds-admin, gds-params, agents, settings) ne sont
 * jamais fermés ici : ils persistent à travers les bascules et les fermetures
 * de projets (ouverts sans projet).
 */
export function shouldCloseTab(tab, keepAgents) {
  if (GLOBAL_TAB_MODES.has(tab.mode)) return false;
  if (keepAgents && tab.mode === "agent") return false;
  return true;
}
