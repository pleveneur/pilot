// Pilot Assistant Tools — outils de suivi multi-projets de l'assistant (Phase 2).
//
// L'assistant (onglet 🧭) suit l'avancement des projets qu'il supervise : tâches,
// décisions, jalons, échéances, blocages, timeline, handoff inter-projets, lecture
// de fichiers projet, recherche, vue d'ensemble, santé et recherche de sessions.
// Cette extension expose ces capacités comme outils, en s'appuyant sur les
// commandes Rust déjà implémentées (super_agent_*).
//
// Mécanisme : chaque outil envoie un payload via `ctx.ui.input` préfixé par un
// sentinel commun. En mode RPC, `ctx.ui.input` émet un `extension_ui_request` sur
// stdout et BLOQUE pi jusqu'à ce que Pilot renvoie un `extension_ui_response`.
// Pilot intercepte le sentinel (super-agent.js), exécute la commande Rust
// correspondante et renvoie le résultat (JSON) comme `value` de la réponse.
// L'outil retourne ce résultat au LLM.
//
// Format du titre : PILOT_ASSISTANT_TOOLS::<toolName>::<JSON payload>

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel commun préfixant le titre d'un `input` d'outil. Pilot le détecte dans
// le `input` reçu, parse le nom d'outil et le payload JSON, exécute la commande
// Rust correspondante et renvoie le résultat au lieu d'afficher un champ de saisie.
const TOOLS_SENTINEL = "PILOT_ASSISTANT_TOOLS::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "create_task",
    label: "Create Task",
    description:
      "Créer une tâche de suivi dans un projet. Retourne { ok, task_id }. Utilise-la pour enregistrer une tâche à suivre pour un projet.",
    promptSnippet: "create_task: créer une tâche de suivi dans un projet",
    promptGuidelines: [
      "Use create_task to record a task to track for a project. Provide the absolute project path and a title. Optionally add a description and a deadline (ISO date).",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      title: Type.String({ description: "Titre de la tâche" }),
      description: Type.Optional(Type.String({ description: "Description de la tâche" })),
      deadline: Type.Optional(Type.String({ description: "Échéance (date ISO)" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "create_task::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "update_task_status",
    label: "Update Task Status",
    description:
      "Mettre à jour le statut d'une tâche de suivi (ex: en_cours, terminee, livree, annulee). Retourne { ok, task_id, status }. Utilise-la pour refléter l'avancement d'une tâche.",
    promptSnippet: "update_task_status: mettre à jour le statut d'une tâche",
    promptGuidelines: [
      "Use update_task_status to change the status of a tracked task (e.g. en_cours, terminee, livree, annulee). Provide the task id and the new status.",
    ],
    parameters: Type.Object({
      taskId: Type.Number({ description: "Identifiant de la tâche" }),
      status: Type.String({ description: "Nouveau statut de la tâche" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "update_task_status::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "add_decision",
    label: "Add Decision",
    description:
      "Ajouter une décision prise pour un projet (optionnellement liée à une tâche). Retourne { ok, decision_id }. Utilise-la pour consigner les décisions importantes.",
    promptSnippet: "add_decision: consigner une décision pour un projet",
    promptGuidelines: [
      "Use add_decision to record an important decision made for a project. Provide the absolute project path and a summary. Optionally link it to a task id.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      summary: Type.String({ description: "Résumé de la décision" }),
      taskId: Type.Optional(Type.Number({ description: "Identifiant de la tâche liée (optionnel)" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "add_decision::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "add_milestone",
    label: "Add Milestone",
    description:
      "Ajouter un jalon à un projet. Retourne { ok, milestone_id }. Utilise-la pour marquer une étape clé à atteindre.",
    promptSnippet: "add_milestone: ajouter un jalon à un projet",
    promptGuidelines: [
      "Use add_milestone to add a milestone to a project. Provide the absolute project path and a title. Optionally add a due date (ISO date).",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      title: Type.String({ description: "Titre du jalon" }),
      dueDate: Type.Optional(Type.String({ description: "Date d'échéance (ISO)" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "add_milestone::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "set_deadline",
    label: "Set Deadline",
    description:
      "Fixe (ou efface) l'échéance d'une tâche. Retourne { ok, task_id, deadline }. Utilise-la pour planifier ou repousser une échéance.",
    promptSnippet: "set_deadline: fixer l'échéance d'une tâche",
    promptGuidelines: [
      "Use set_deadline to set (or clear) the deadline of a task. Provide the task id and an ISO date, or omit the deadline to clear it.",
    ],
    parameters: Type.Object({
      taskId: Type.Number({ description: "Identifiant de la tâche" }),
      deadline: Type.Optional(Type.String({ description: "Échéance (date ISO), omettre pour effacer" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "set_deadline::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "flag_blocker",
    label: "Flag Blocker",
    description:
      "Marquer une tâche comme bloquée avec une raison. Retourne { ok, task_id }. Utilise-la pour signaler un blocage qui empêche l'avancement.",
    promptSnippet: "flag_blocker: signaler un blocage sur une tâche",
    promptGuidelines: [
      "Use flag_blocker to mark a task as blocked with a reason. Provide the task id and a reason explaining the blocker.",
    ],
    parameters: Type.Object({
      taskId: Type.Number({ description: "Identifiant de la tâche" }),
      reason: Type.String({ description: "Raison du blocage" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "flag_blocker::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "get_project_timeline",
    label: "Get Project Timeline",
    description:
      "Retourner la timeline d'un projet : jalons + tâches avec échéances (avec indicateur overdue). Utilise-la pour visualiser l'avancement et les échéances d'un projet.",
    promptSnippet: "get_project_timeline: visualiser la timeline d'un projet",
    promptGuidelines: [
      "Use get_project_timeline to get the timeline of a project: milestones and tasks with deadlines, including overdue flags. Provide the absolute project path.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "get_project_timeline::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "handoff_to_project",
    label: "Handoff To Project",
    description:
      "Créer une tâche dans le projet cible en référençant une tâche source (handoff inter-projets). Retourne { ok, task_id, source_task_id }. Utilise-la pour transférer une tâche d'un projet à un autre.",
    promptSnippet: "handoff_to_project: transférer une tâche vers un autre projet",
    promptGuidelines: [
      "Use handoff_to_project to create a task in the target project referencing a source task (inter-project handoff). Provide the source and target absolute paths and the source task id.",
    ],
    parameters: Type.Object({
      sourcePath: Type.String({ description: "Chemin absolu du projet source" }),
      targetPath: Type.String({ description: "Chemin absolu du projet cible" }),
      taskId: Type.Number({ description: "Identifiant de la tâche source" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "handoff_to_project::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "read_project_file",
    label: "Read Project File",
    description:
      "Lire un fichier d'un projet en lecture seule (chemin relatif, refus des chemins hors projet). Retourne { path, content }. Utilise-la pour consulter un fichier du projet.",
    promptSnippet: "read_project_file: lire un fichier d'un projet (lecture seule)",
    promptGuidelines: [
      "Use read_project_file to read a file of a project in read-only mode. Provide the absolute project path and a relative file path. Paths outside the project are refused.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      relPath: Type.String({ description: "Chemin relatif du fichier à lire" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "read_project_file::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "search_project",
    label: "Search Project",
    description:
      "Rechercher un motif dans les fichiers d'un projet (lecture seule). Retourne les résultats de recherche. Utilise-la pour trouver du code ou du texte dans un projet.",
    promptSnippet: "search_project: rechercher un motif dans un projet",
    promptGuidelines: [
      "Use search_project to search a pattern in a project's files (read-only). Provide the absolute project path and a query. Optionally set useRegex (default false), extensions (comma-separated, e.g. 'rs,js') and maxResults.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      query: Type.String({ description: "Motif à rechercher" }),
      useRegex: Type.Optional(Type.Boolean({ description: "Interpréter la requête comme une regex (défaut false)" })),
      extensions: Type.Optional(Type.String({ description: "Extensions à filtrer, séparées par des virgules (ex: 'rs,js')" })),
      maxResults: Type.Optional(Type.Number({ description: "Nombre maximal de résultats" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "search_project::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "project_overview",
    label: "Project Overview",
    description:
      "Vue d'ensemble multi-projets agrégée par client : nombre de projets, tâches ouvertes/terminées, décisions récentes, sessions récentes et jalons à venir. Utilise-la pour avoir une vision globale du suivi.",
    promptSnippet: "project_overview: vue d'ensemble multi-projets du suivi",
    promptGuidelines: [
      "Use project_overview to get an aggregated multi-project overview grouped by client: number of projects, open/done tasks, recent decisions, recent sessions and upcoming milestones.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "project_overview::{}", "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "check_project_health",
    label: "Check Project Health",
    description:
      "Vérifier la santé d'un projet : tâches bloquées, tâches en retard et jalons dépassés. Utilise-la pour détecter les problèmes d'un projet.",
    promptSnippet: "check_project_health: vérifier la santé d'un projet",
    promptGuidelines: [
      "Use check_project_health to check a project's health: blocked tasks, overdue tasks and missed milestones. Provide the absolute project path.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "check_project_health::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "search_sessions",
    label: "Search Sessions",
    description:
      "Rechercher dans l'index de sessions d'un projet (lecture seule). Retourne les sessions correspondantes. Utilise-la pour retrouver des échanges passés d'un projet.",
    promptSnippet: "search_sessions: rechercher dans les sessions d'un projet",
    promptGuidelines: [
      "Use search_sessions to search a project's session index (read-only). Provide the absolute project path and a params object (query, tags, etc.) as accepted by the session search.",
    ],
    parameters: Type.Object({
      projectPath: Type.String({ description: "Chemin absolu du projet" }),
      params: Type.Any({ description: "Paramètres de recherche de sessions (objet JSON)" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(TOOLS_SENTINEL + "search_sessions::" + JSON.stringify(params), "");
      if (result == null) {
        return { content: [{ type: "text", text: "Requête annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });
}
