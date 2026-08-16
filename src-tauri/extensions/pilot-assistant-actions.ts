// Pilot Assistant Actions — actions du super-agent sur les projets (TÂCHE 2).
//
// Le super-agent (onglet 🧭) est lecture seule sur les projets : il ne modifie
// aucun fichier. Mais quand l'utilisateur discute d'un projet, il doit pouvoir :
//   1. ouvrir le projet (le rendre actif) pour le mettre en cours de traitement ;
//   2. déléguer une demande de modification de code à l'agent standard du projet
//      (pi/plh de coding), en ouvrant son onglet (le rendant visible) et en lui
//      envoyant la demande dans sa session de discussion.
//
// Ces deux actions sont des actions Pilot (pas des écritures dans les projets),
// donc compatibles avec la lecture seule stricte du super-agent. Elles sont
// déclenchées par des outils que le LLM peut appeler, et communiquent avec Pilot
// via un `ctx.ui.confirm` préfixé par un sentinel (même mécanisme que la porte
// pré-écriture pilot-edit-gate) : Pilot intercepte le sentinel, exécute l'action
// et renvoie `{ confirmed: true }` (succès) ou `{ confirmed: false }` (échec).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Sentinel préfixant le message d'un confirm d'action. Pilot le détecte dans le
// `confirm` reçu et exécute l'action au lieu d'afficher des boutons Oui/Non.
const ACTION_SENTINEL = "PILOT_ASSISTANT_ACTION::";
// Sentinel préfixant le titre d'un `input` d'outil run_agents. Pilot le détecte,
// lance la run sur les agents sélectionnés et renvoie le résultat agrégé comme
// `value` de la réponse (l'outil le retourne au LLM).
const RUN_AGENTS_SENTINEL = "PILOT_ASSISTANT_RUN_AGENTS::";
// Sentinel préfixant le titre d'un `input` d'outil project_snapshot. Pilot le
// détecte, exécute la commande Rust `project_snapshot` (lecture seule) et renvoie
// l'état structuré du projet (JSON) comme `value` de la réponse.
const PROJECT_SNAPSHOT_SENTINEL = "PILOT_ASSISTANT_PROJECT_SNAPSHOT::";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "open_project",
    label: "Open Project",
    description:
      "Ouvrir un projet (le rendre actif) pour le mettre en cours de traitement, comme si l'utilisateur l'avait ouvert manuellement. À utiliser quand l'utilisateur discute d'un projet et qu'il faut le rendre actif. Bloque jusqu'à ce que Pilot ait ouvert le projet.",
    promptSnippet: "open_project: ouvrir un projet pour le mettre en cours de traitement",
    promptGuidelines: [
      "Use open_project when the user is discussing a project and it should become the active project (as if opened manually). Call it with the absolute path of the project. If you are unsure about the path, ask the user first (ask_input / ask_choice).",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Chemin absolu du projet à ouvrir" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "open_project", path: params.path });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        return { content: [{ type: "text", text: `Le projet « ${params.path} » a été ouvert et rendu actif.` }] };
      }
      return { content: [{ type: "text", text: `Échec de l'ouverture du projet « ${params.path} ».` }] };
    },
  });

  pi.registerTool({
    name: "purge_agent_conversation",
    label: "Purge Agent Conversation",
    description:
      "Purger la conversation de l'agent du projet actif (équivalent au clic sur « + » de l'onglet agent) en préservant le modèle actif. À utiliser au DÉBUT d'une conversation avec l'agent, ou quand il faut ARRÊTER l'agent et repartir d'une conversation vierge. Ne pas appeler avant chaque délégation : la conversation de l'agent est conservée entre les demandes, sauf si vous décidez explicitement de la purger. Bloque jusqu'à ce que Pilot ait purgé la conversation.",
    promptSnippet: "purge_agent_conversation: purger la conversation de l'agent du projet actif (début de conversation ou arrêt de l'agent)",
    promptGuidelines: [
      "Use purge_agent_conversation only at the START of a conversation with the agent, or when you need to STOP the agent and start fresh from a blank conversation. Do NOT call it before every delegation — the agent's conversation is preserved between requests unless you explicitly decide to purge it.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "purge_agent_conversation" });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        return { content: [{ type: "text", text: "La conversation de l'agent a été purgée (modèle actif préservé)." }] };
      }
      return { content: [{ type: "text", text: "Échec de la purge de la conversation de l'agent." }] };
    },
  });

  pi.registerTool({
    name: "create_agent",
    label: "Create Agent",
    description:
      "Créer un agent sur mesure dans le registre global (~/.pilot/agents.json) quand les agents disponibles ne conviennent pas à la tâche. Tu définis toi-même son rôle (system prompt), son nom, son icône, sa description, ses modèles (pi/plh), sa lecture seule, son budget et sa profondeur. L'agent devient aussitôt disponible pour être sélectionné via run_agents. Bloque jusqu'à ce que Pilot ait créé l'agent.",
    promptSnippet: "create_agent: créer un agent sur mesure (rôle construit selon le besoin)",
    promptGuidelines: [
      "Use create_agent when the available agents do not fit the task and you need a custom role. Define a precise role (system prompt) describing exactly what the agent must do, its constraints, and its output format.",
      "Provide a unique kebab-case id, a display name, an optional emoji icon, a short functional description (used for routing), and the role text.",
      "Set readonly=true if the agent must never modify files. Set keep_context=true if it should keep its context between calls. Set max_calls_per_run and call_depth (1 = worker).",
      "For models, provide provider/modelId for pi and/or plh. If you omit them, Pilot will fall back to the backend default model.",
      "After creating, you can select it via run_agents.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Identifiant machine unique (kebab-case, lettres minuscules, chiffres, tirets, underscores)" }),
      name: Type.String({ description: "Nom affiché de l'agent" }),
      icon: Type.Optional(Type.String({ description: "Emoji/icône affichée (ex: 🛠️)" })),
      description: Type.String({ description: "Description fonctionnelle courte utilisée pour router les tâches" }),
      role: Type.String({ description: "Rôle / instructions système injectées en début de chaque prompt" }),
      models: Type.Optional(Type.Object({
        pi: Type.Optional(Type.String({ description: "Modèle provider/modelId pour le backend pi" })),
        plh: Type.Optional(Type.String({ description: "Modèle provider/modelId pour le backend plh" })),
      })),
      readonly: Type.Optional(Type.Boolean({ description: "true → l'agent ne doit jamais modifier de fichiers" })),
      keep_context: Type.Optional(Type.Boolean({ description: "true → conserver le contexte entre deux appels" })),
      max_calls_per_run: Type.Optional(Type.Number({ description: "Limite d'appels pour cet agent dans une run" })),
      call_depth: Type.Optional(Type.Number({ description: "Profondeur max d'appel (1 = worker)" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "create_agent", agent: params });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        return { content: [{ type: "text", text: `L'agent « ${params.name || params.id} » (${params.id}) a été créé dans le registre global.` }] };
      }
      return { content: [{ type: "text", text: `Échec de la création de l'agent « ${params.id} ».` }] };
    },
  });

  pi.registerTool({
    name: "run_agents",
    label: "Run Agents",
    description:
      "Choisir quels agents disponibles utiliser et lancer une tâche sur eux. Tu sélectionnes les agents (par leur id) qui te semblent les plus adaptés pour obtenir ce que tu veux, et tu leur confies une tâche. Pilot les lance (en parallèle si plusieurs) et te renvoie le résultat agrégé. À utiliser quand tu as besoin d'exécuter du travail sur un projet via les agents du registre. Bloque jusqu'à ce que les agents aient terminé.",
    promptSnippet: "run_agents: sélectionner des agents et lancer une tâche sur eux",
    promptGuidelines: [
      "Use run_agents when you need to execute work on a project through the registered agents. Select the agent ids that best fit the task (e.g. codeur, testeur, reviewer, or a custom agent you created).",
      "Provide a clear, atomic task description. If you select multiple agents, they run in parallel and you receive the aggregated results.",
      "Prefer selecting the most appropriate agents rather than delegating everything to the standard coder. You are the coordinator: you choose the team.",
      "If no suitable agent exists, create one first with create_agent, then run_agents.",
    ],
    parameters: Type.Object({
      agent_ids: Type.Array(Type.String({ description: "Identifiants des agents à utiliser (au moins un)" })),
      task: Type.String({ description: "La tâche à confier aux agents sélectionnés" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ agent_ids: params.agent_ids, task: params.task });
      const result = await ctx.ui.input(RUN_AGENTS_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Lancement de la tâche annulé." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "project_snapshot",
    label: "Project Snapshot",
    description:
      "Obtenir un état structuré (lecture seule) d'un projet : liste des fichiers/dossiers principaux, langages détectés, état Git (branche, derniers commits) et métriques de base (taille, lignes, fonctions, classes, TODO/FIXME). À utiliser quand tu as besoin d'une vue d'ensemble rapide d'un projet (structure, langages, santé Git) avant de répondre ou de planifier. Ne modifie aucun fichier.",
    promptSnippet: "project_snapshot: obtenir un état structuré d'un projet (fichiers, langages, Git, métriques)",
    promptGuidelines: [
      "Use project_snapshot when you need a quick structured overview of a project: main files/directories, detected languages, Git state (branch, last commits) and basic metrics (size, lines, functions, classes, TODO/FIXME). It is read-only and never modifies any file.",
      "Pass the absolute path of the project. If you are unsure about the path, ask the user first (ask_input / ask_choice).",
    ],
    parameters: Type.Object({
      project: Type.String({ description: "Chemin absolu du projet à analyser" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ project: params.project });
      const result = await ctx.ui.input(PROJECT_SNAPSHOT_SENTINEL + payload, "");
      if (result == null) {
        return { content: [{ type: "text", text: "Analyse du projet annulée." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "stop_agent",
    label: "Stop Agent",
    description:
      "Arrêter immédiatement un agent (coupe la session en cours, qu'elle soit visible, en arrière-plan / « agent invisible », ou un agent secondaire/spécialisé/spécifique lancé via run_agents). Par défaut, arrête l'agent standard du projet actif. Si vous fournissez `agentId`, arrête précisément cet agent (standard, spécialisé, secondaire ou spécifique créé à la volée). À utiliser quand l'utilisateur demande d'arrêter le travail en cours, ou quand vous détectez qu'un agent s'égare ou reste bloqué en fin de run et qu'il faut l'interrompre. Bloque jusqu'à ce que Pilot ait arrêté l'agent.",
    promptSnippet: "stop_agent: arrêter un agent (standard par défaut, ou un agentId cible)",
    promptGuidelines: [
      "Use stop_agent when the user asks to stop the current work, or when you detect an agent is going off track or is stuck at the end of a run and must be interrupted. This cuts the running agent session immediately (visible tab, invisible background agent, or a secondary/specialized/custom agent launched via run_agents).",
      "If you know the id of the specific agent to stop (e.g. a tester, a codeur-plh, or a custom agent you created and launched via run_agents), pass it in `agentId`. If you omit `agentId`, the standard agent of the active project is stopped.",
    ],
    parameters: Type.Object({
      agentId: Type.Optional(Type.String({ description: "Identifiant de l'agent à arrêter. Si omis, arrête l'agent standard du projet actif." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "stop_agent", agentId: params.agentId || null });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        const target = params.agentId ? `L'agent « ${params.agentId} »` : "L'agent du projet actif";
        return { content: [{ type: "text", text: `${target} a été arrêté.` }] };
      }
      return { content: [{ type: "text", text: "Échec de l'arrêt de l'agent." }] };
    },
  });

  pi.registerTool({
    name: "delegate_to_coder",
    label: "Delegate to Coder",
    description:
      "Déléguer une demande de modification de code à l'agent standard du projet actif (pi/plh de coding). Par défaut, ouvre son onglet (le rend visible) et lui envoie la demande dans sa session de discussion. Si `background=true`, démarre l'agent en mode invisible (en arrière-plan, sans ouvrir d'onglet). À utiliser quand l'utilisateur demande une modification de code sur le projet actif. Bloque jusqu'à ce que Pilot ait transmis la demande.",
    promptSnippet: "delegate_to_coder: déléguer une demande de code à l'agent du projet actif",
    promptGuidelines: [
      "Use delegate_to_coder when the user asks for a code modification on the active project. The request is sent to the project's coding agent (pi/plh), which opens its tab and receives the request in its discussion. Only delegate actual code work — for simple questions about how something works, answer directly.",
      "Set background=true to start the agent in invisible mode (background, without opening a tab). This is useful when you want the agent to work without disturbing the user's current view.",
    ],
    parameters: Type.Object({
      request: Type.String({ description: "La demande de code à transmettre à l'agent du projet" }),
      background: Type.Optional(Type.Boolean({ description: "true → démarrer l'agent en mode invisible (arrière-plan, sans ouvrir d'onglet). Défaut : false (onglet ouvert)." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "delegate_to_coder", request: params.request, background: params.background === true });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload);
      if (ok) {
        const mode = params.background === true ? "en arrière-plan (agent invisible)" : "(son onglet est ouvert)";
        return { content: [{ type: "text", text: `La demande a été transmise à l'agent du projet ${mode}.` }] };
      }
      return { content: [{ type: "text", text: "Échec de la transmission de la demande à l'agent du projet." }] };
    },
  });
}
