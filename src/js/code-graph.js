// code-graph.js — Code Graph (graphe de connaissances projet)
//
// Voir spec_code_graph.md. Construit un bloc graphe à injecter à l'agent
// (mode A : sous-graphe scoré au prompt via query_code_graph) + génère le wiki
// interrogeable (mode B : build_graph_wiki) + fournit l'état / le rebuild.
// Fonctions pures + appels invoke. Pas de state global.

import { invoke } from "@tauri-apps/api/core";

/** Estimation grossière du nombre de tokens (~3.5 chars/token). */
export function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(str.length / 3.5);
}

/**
 * Construit le bloc graphe à injecter dans le handoff (.pilot/context-inject.md).
 *
 * Mode A : appelle `query_code_graph` pour obtenir un sous-graphe pertinent au
 *   prompt (borné par budget), formaté en Markdown compact.
 * Mode B : génère `.pilot/graph-wiki/` et ajoute une consigne de lecture + lien.
 *
 * @param {string} projectPath - chemin absolu du projet
 * @param {string} prompt - le prompt utilisateur courant (pour le scoring mode A)
 * @param {object} cfg - { enabled, extractMode, injectModeA, budgetTokens,
 *                        injectModeB }
 * @returns {Promise<string>} bloc Markdown (vide si désactivé / graphe indispo)
 */
export async function buildGraphBlock(projectPath, prompt, cfg) {
  if (!projectPath || !cfg || cfg.enabled === false) return "";
  let body = "";

  // ── Construction paresseuse : si le graphe n'existe pas encore, on lance un
  //    build en arrière-plan (fire-and-forget) et on retourne "" pour ce prompt.
  //    Les prompts suivants utiliseront le graphe une fois prêt. (comme le RAG)
  try {
    const status = await graphStatus(projectPath);
    if (!status || !status.exists || !status.ready) {
      invoke("build_code_graph", { projectPath }).catch((e) =>
        console.warn("[code-graph] build arrière-plan échec:", e)
      );
      return "";
    }
  } catch (e) {
    console.warn("[code-graph] status échec:", e);
    return "";
  }

  // ── Mode A : sous-graphe scoré au prompt ──
  if (cfg.injectModeA !== false) {
    try {
      const budget = cfg.budgetTokens || 4000;
      const res = await invoke("query_code_graph", {
        projectPath,
        prompt: prompt || "",
        budgetTokens: budget,
      });
      if (res && res.source === "graph" && res.context) {
        body = res.context;
      }
    } catch (e) {
      console.warn("[code-graph] query échec:", e);
    }
  }

  // ── Mode B : wiki interrogeable + consigne de lecture ──
  let wikiLink = null;
  if (cfg.injectModeB !== false) {
    try {
      const rel = await invoke("build_graph_wiki", { projectPath });
      if (rel) wikiLink = rel;
    } catch (e) {
      console.warn("[code-graph] wiki échec:", e);
    }
  }

  if (!body && !wikiLink) return "";

  let block =
    "=== GRAPHE PROJET (structure — relations lues/déduites, ne pas répondre à cette section) ===\n";
  if (body) block += body + "\n";
  if (wikiLink) {
    block +=
      "Pour une question structurelle plus profonde, consultez le wiki du graphe " +
      "(god-nodes + nœuds par fichier) AVANT de lire les fichiers sources :\n" +
      `- \`${wikiLink}/index.md\` (index + god-nodes)\n` +
      `- \`${wikiLink}/god-nodes.md\` (hubs architecturaux avec relations)\n`;
  }
  block += "=== FIN GRAPHE ===\n\n";
  return block;
}

/** Récupère l'état du graphe d'un projet (pour la modale). */
export async function graphStatus(projectPath) {
  if (!projectPath) return null;
  try {
    return await invoke("graph_status", { projectPath });
  } catch (e) {
    console.warn("[code-graph] status échec:", e);
    return null;
  }
}

/** (Re)construit le graphe d'un projet (rebuild complet). Retourne les stats. */
export async function rebuildGraph(projectPath) {
  if (!projectPath) return null;
  try {
    return await invoke("build_code_graph", { projectPath });
  } catch (e) {
    console.warn("[code-graph] build échec:", e);
    return null;
  }
}
