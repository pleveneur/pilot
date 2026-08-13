// Pilot Assistant DB — accès de l'assistant à sa base de suivi (SQLite).
//
// L'assistant (onglet 🧭) est RESPONSABLE de son suivi des projets : il construit
// et met à jour ses propres structures dans sa base SQLite (~/.pilot/super-agent.db)
// en fonction de ses besoins. Cette extension lui fournit deux outils :
//   - db_query(sql)   → requête SELECT en lecture seule, retourne les lignes (JSON)
//   - db_execute(sql) → requête d'écriture (CREATE TABLE, INSERT, UPDATE, DELETE,
//                       ALTER, DROP, PRAGMA) pour construire/mettre à jour ses
//                       structures de suivi.
//
// L'assistant ne touche JAMAIS aux fichiers des projets (garanti par l'extension
// pilot-assistant-files). Il n'accède qu'à SA base de suivi.
//
// Mécanisme : les outils envoient le SQL via `ctx.ui.input` préfixé par un sentinel.
// En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur stdout et BLOQUE pi
// jusqu'à ce que Pilot renvoie un `extension_ui_response`. Pilot intercepte le
// sentinel (super-agent.js), exécute la requête via une commande Rust
// (super_agent_db_query / super_agent_db_execute) et renvoie le résultat (JSON)
// comme `value` de la réponse. L'outil retourne ce résultat au LLM.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinels préfixant le titre d'un `input` d'outil DB. Pilot les détecte dans le
// `input` reçu et exécute la requête au lieu d'afficher un champ de saisie.
const DB_QUERY_SENTINEL = "PILOT_ASSISTANT_DB_QUERY::";
const DB_EXEC_SENTINEL = "PILOT_ASSISTANT_DB_EXEC::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "db_query",
    label: "DB Query",
    description:
      "Exécuter une requête SELECT en lecture seule sur ta base de suivi (SQLite ~/.pilot/super-agent.db). Retourne les lignes sous forme de JSON. Utilise-la pour consulter tes données (projets, tâches, décisions, ou tes propres tables de suivi).",
    promptSnippet: "db_query: interroger ta base de suivi (SELECT)",
    promptGuidelines: [
      "Use db_query to read from your tracking database (SELECT only). It returns rows as JSON. Use it to check the state of projects, tasks, decisions, or your own tracking tables before answering or updating.",
      "The core tables (clients, projects, tasks, decisions, session_summaries) are managed by Pilot — you can read them, but prefer creating your own tables for your personal tracking.",
    ],
    parameters: Type.Object({
      sql: Type.String({ description: "Requête SQL SELECT à exécuter" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(DB_QUERY_SENTINEL + params.sql, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "db_execute",
    label: "DB Execute",
    description:
      "Exécuter une requête d'écriture (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER, DROP, PRAGMA) sur ta base de suivi (SQLite ~/.pilot/super-agent.db). Utilise-la pour construire et mettre à jour tes propres structures de suivi des projets. Ne touche jamais aux fichiers des projets.",
    promptSnippet: "db_execute: créer/mettre à jour tes structures de suivi",
    promptGuidelines: [
      "Use db_execute to create and update your own tracking structures in your database (CREATE TABLE, INSERT, UPDATE, DELETE, ALTER, DROP, PRAGMA). You are responsible for keeping your project tracking up to date.",
      "You may create your own tables as your needs evolve. The core tables (clients, projects, tasks, decisions, session_summaries) are managed by Pilot — avoid modifying them directly; build your own tables instead.",
      "Never touch project source files — you are strictly read-only on projects. Only your tracking database and your personal folder (~/.pilot/assistant/) are writable by you.",
    ],
    parameters: Type.Object({
      sql: Type.String({ description: "Requête SQL d'écriture à exécuter" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(DB_EXEC_SENTINEL + params.sql, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
