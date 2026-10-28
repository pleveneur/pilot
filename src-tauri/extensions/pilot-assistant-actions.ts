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
// Sentinel préfixant le titre d'un `input` d'outil run_assistant_agents (tâche
// #140). Pilot le détecte, lance la run sur les agents d'assistant (agents SANS
// rattachement à un projet, tournant dans l'espace `~/.pilot/assistant/`) et
// renvoie le résultat agrégé comme `value` de la réponse. Découplé de run_agents
// qui reste lié aux projets.
const RUN_ASSISTANT_AGENTS_SENTINEL = "PILOT_ASSISTANT_RUN_ASSISTANT_AGENTS::";
// Sentinel préfixant le titre d'un `input` d'outil project_snapshot. Pilot le
// détecte, exécute la commande Rust `project_snapshot` (lecture seule) et renvoie
// l'état structuré du projet (JSON) comme `value` de la réponse.
const PROJECT_SNAPSHOT_SENTINEL = "PILOT_ASSISTANT_PROJECT_SNAPSHOT::";
// Sentinel préfixant le titre d'un `input` d'outil mcp_state (MCP piloté par
// l'assistant, brique C). Pilot le détecte, exécute la commande Rust
// `mcp_get_state` (lecture seule) et renvoie `{ enabled, confirm, servers }`
// comme `value` de la réponse. L'assistant lit `confirm` pour savoir s'il doit
// demander une confirmation avant qu'un agent utilise un serveur MCP.
const MCP_STATE_SENTINEL = "PILOT_ASSISTANT_MCP_STATE::";
// Sentinel préfixant le titre d'un `input` des outils mcp_enable_server /
// mcp_disable_server (MCP piloté par l'Assistant, action de réglage). Pilot le
// détecte, applique l'activation ou la désactivation du serveur NOMMÉ (commande
// Rust `mcp_set_servers_enabled`, qui ne change QUE le champ `enabled`) et
// renvoie le résultat en CLAIR comme `value` de la réponse : serveur activé ou
// désactivé, serveurs coupés par l'exclusivité, effet à la prochaine session
// d'agent, et rappel qu'aucun autre réglage MCP n'a été touché.
const MCP_SERVER_TOGGLE_SENTINEL = "PILOT_ASSISTANT_MCP_SERVER::";
// Sentinel préfixant le titre d'un `input` d'outil git_status. Pilot le détecte,
// exécute la commande Rust `git_status_project` (lecture seule) et renvoie l'état
// Git du projet (JSON) comme `value` de la réponse.
const GIT_STATUS_SENTINEL = "PILOT_ASSISTANT_GIT_STATUS::";
// Sentinel préfixant le titre d'un `input` d'outil git_log. Pilot le détecte,
// exécute la commande Rust `git_log_project` (lecture seule) et renvoie
// l'historique des commits (JSON) comme `value` de la réponse.
const GIT_LOG_SENTINEL = "PILOT_ASSISTANT_GIT_LOG::";
// Sentinel préfixant le titre d'un `input` de l'outil UNIQUE « me prévenir sur
// Telegram ». Pilot le détecte, LIT l'état (aucun argument) ou APPLIQUE la valeur
// demandée (`enabled: true/false`), et renvoie l'état en clair comme `value` de
// la réponse. UN seul sentinel, donc UN seul chemin : lire et changer passent
// par le même outil (décision du propriétaire : pas d'outil de lecture séparé,
// pas de valeur d'état injectée dans le prompt).
const TELEGRAM_NOTIFY_SENTINEL = "PILOT_ASSISTANT_TELEGRAM_NOTIFY::";
// Sentinel préfixant le titre d'un `input` de l'outil `remove_queued_mission`.
// Pilot le détecte, retire UNE seule mission en attente (celle du rang affiché par
// `/file`, ou celle du numéro de mission donné) et renvoie le résultat en clair
// comme `value` de la réponse. Un sentinel DISTINCT de l'action « vider la file »
// (`/file vide`) : les deux gestes ne passent jamais par le même chemin.
const QUEUE_REMOVE_SENTINEL = "PILOT_ASSISTANT_QUEUE_REMOVE::";

// Garde-fou anti-blocage (bug « agents figés ») : en mode RPC, un `ctx.ui.*`
// émet un `extension_ui_request` sur stdout et pi attend la réponse SANS
// limite de temps. Si Pilot ne répond pas (événement non routé, session
// occupée, réponse perdue), l'outil ne rendait JAMAIS la main : la session
// restait « occupée » et réservait la file d'attente du projet jusqu'à l'arrêt
// par le watchdog. On borne donc l'attente : au-delà, pi résout la promesse
// (undefined / false) et l'outil retourne une erreur explicite au modèle au
// lieu de bloquer indéfiniment.
const PILOT_UI_OPTS = { timeout: 120000 };

// Consigne de suite jointe à l'accusé de lancement de run_agents /
// run_assistant_agents. Le lancement est ASYNCHRONE (Pilot rend la main
// immédiatement, l'agent travaille en arrière-plan et le rapport est déposé
// plus tard dans la conversation de l'assistant). Sans cette phrase, le modèle
// relançait la même délégation, ou arrêtait l'agent qu'il venait de lancer,
// parce que la description de l'outil laissait croire à une attente bloquante :
// symptôme « l'agent commence et s'arrête aussitôt ».
const LAUNCH_FOLLOW_UP =
  "Rappel Pilot : ce lancement est ASYNCHRONE. Si `ok` vaut true (launched / queued / preparing), la tâche est en cours en arrière-plan et tu n'as RIEN à attendre : ne surveille pas l'agent, ne le relance pas, ne l'arrête pas, et n'affiche pas d'état « bloqué ». Termine ton tour ; le rapport (ou l'échec) te sera transmis automatiquement. Si `ok` vaut false, rien n'a démarré : lis `error`, préviens l'utilisateur, et ne réessaie pas la même demande en boucle.";

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
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload, PILOT_UI_OPTS);
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
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload, PILOT_UI_OPTS);
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
      "Créer un agent sur mesure dans le registre global (base SQLite `pilot.db`) quand les agents disponibles ne conviennent pas à la tâche. Tu définis toi-même son rôle (system prompt), son nom, son icône, sa description, ses modèles (pi/plh), sa lecture seule, son budget et sa profondeur. L'agent devient aussitôt disponible pour être sélectionné via run_agents. Bloque jusqu'à ce que Pilot ait créé l'agent.",
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
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload, PILOT_UI_OPTS);
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
      "Choisir quels agents disponibles utiliser et lancer une tâche sur eux. Tu sélectionnes les agents (par leur id) qui te semblent les plus adaptés pour obtenir ce que tu veux, et tu leur confies une tâche. Le lancement est ASYNCHRONE : l'outil te rend la main IMMÉDIATEMENT avec un accusé (`launched` / `queued` / `preparing` + `error`). Le travail continue en arrière-plan et son résultat (rapport ou échec) t'est transmis automatiquement plus tard, déposé dans ta conversation. N'attends pas, ne surveille pas, ne relance pas et n'arrête pas l'agent : termine ton tour et laisse-le travailler.",
    promptSnippet: "run_agents: sélectionner des agents et lancer une tâche sur eux (asynchrone : ne pas attendre)",
    promptGuidelines: [
      "Use run_agents when you need to execute work on a project through the registered agents. Select the agent ids that best fit the task (e.g. codeur, testeur, reviewer, or a custom agent you created).",
      "The launch is ASYNCHRONOUS: the tool returns immediately and the agent works in the background. Do NOT wait for it, do NOT poll its state, do NOT relaunch the same task, and do NOT stop the agent after launching — the result (report or failure) is delivered to you automatically later. Answer the user and end your turn.",
      "A single launch per task is enough. Never relaunch the same delegation, and never use stop_agent on an agent you have just launched: stopping the agent kills its work.",
      "Provide a clear, atomic task description.",
      "Prefer selecting the most appropriate agents rather than delegating everything to the standard coder. You are the coordinator: you choose the team.",
      "If no suitable agent exists, prefer an AGENT JETABLE: pass `agents` (objects with `name` + `role`) instead of creating a permanent agent. A throwaway agent exists only for the duration of this task, is never written to the agents database, never appears in the user's agent list, and disappears when the task ends (its work — messages, report — stays visible). Use create_agent only when the role must be reused later.",
      "Pass the absolute path of the target project in `project` when the work must be done on a project that differs from the active one (e.g. the user is on 'pilot' but asks for changes on 'PLh'). If omitted, the active project is used.",
      "ALWAYS pass `resume`: a SHORT phrase (max 120 characters, e.g. 'Corrige l'affichage du panneau des tâches') that says what the task really does. The user reads it FIRST in Pilot's task panel, so write it for a human, in the user's language, not as a copy of the technical task text. It must never be invented or vague ('traiter la demande').",
      "If the task MUST produce a file, pass `expected_files` (paths relative to the project): Pilot checks at the end of the mission that each declared file exists, and reports an explicit FAILURE naming the missing file instead of a false 'done'. Never declare a file you are not sure is expected.",
      "Do not ask a READ-ONLY agent (plan-maker, reviewer, architect…) to write a file: Pilot refuses the launch. Pick an agent that writes (e.g. codeur) or a throwaway agent without `readonly`.",
    ],
    parameters: Type.Object({
      agent_ids: Type.Array(Type.String({ description: "Identifiants des agents à utiliser (au moins un, sauf si tu fournis `agents`)" })),
      agents: Type.Optional(Type.Array(
        Type.Object({
          name: Type.String({ description: "Nom court de l'agent jetable" }),
          role: Type.String({ description: "Rôle / instructions système de l'agent jetable (fourni à la volée, jamais enregistré)" }),
          icon: Type.Optional(Type.String({ description: "Emoji/icône (optionnel)" })),
          description: Type.Optional(Type.String({ description: "Description courte du rôle (optionnel)" })),
          readonly: Type.Optional(Type.Boolean({ description: "true → l'agent jetable ne doit jamais modifier de fichiers" })),
          keep_context: Type.Optional(Type.Boolean({ description: "true → conserver le contexte entre deux appels" })),
          model: Type.Optional(Type.String({ description: "Modèle provider/modelId à utiliser (optionnel ; défaut = modèle de l'agent standard). Raccourci : équivaut à `models.pi`." })),
        }),
        { description: "Agents JETABLES définis dans la demande (aucune écriture en base, aucune entrée dans la liste des agents, durée de vie = cette tâche). Ajoutés aux `agent_ids` pour cette mission." }
      )),
      task: Type.String({ description: "La tâche à confier aux agents sélectionnés" }),
      resume: Type.Optional(Type.String({ description: "RÉSUMÉ COURT de la tâche pour le panneau des tâches de Pilot : une phrase (≤ 120 caractères) qui dit ce que la tâche fait réellement, dans la langue de l'utilisateur. Affiché EN PREMIER, avant l'agent et le projet. Ne pas recopier la tâche technique ; ne jamais inventer." })),
      project: Type.Optional(Type.String({ description: "Chemin absolu du projet cible (optionnel, défaut = projet actif)" })),
      expected_files: Type.Optional(Type.Array(Type.String({ description: "Fichiers RÉELLEMENT attendus sur le disque à la fin de la tâche (chemins RELATIFS au projet). Pilot vérifie leur existence en fin de mission : un fichier déclaré ABSENT fait échouer la tâche avec un message qui le nomme (jamais « terminé » sans le fichier). À fournir dès que la demande exige de créer/écrire un fichier ; à omettre pour une tâche d'analyse." }))),
      mcp_server: Type.Optional(Type.String({ description: "Identifiant d'un serveur MCP à connecter pour CET agent (optionnel). À utiliser quand la tâche nécessite les outils MCP d'un serveur que tu as découvert via mcp_state. Sans lui, l'agent ne charge pas MCP, sauf à être l'agent standard." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ agent_ids: params.agent_ids, agents: params.agents || null, task: params.task, resume: params.resume || null, project: params.project || null, mcp_server: params.mcp_server || null, expected_files: params.expected_files || null });
      const result = await ctx.ui.input(RUN_AGENTS_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Lancement de la tâche annulé. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result + "\n\n" + LAUNCH_FOLLOW_UP }] };
    },
  });

  pi.registerTool({
    name: "run_assistant_agents",
    label: "Run Assistant Agents",
    description:
      "Lancer une tâche sur des agents d'assistant (agents SANS rattachement à un projet), pour un travail qui concerne l'assistant lui-même (recherche, analyse, tâches internes de coordination) plutôt qu'un projet. Tu sélectionnes les agents (par leur id) qui te semblent les plus adaptés et tu leur confies une tâche. Pilot les lance dans l'espace réservé ~/.pilot/assistant/ (pas de contexte de projet injecté) et te renvoie le résultat agrégé. À utiliser quand tu as besoin d'exécuter du travail hors de tout projet. Le lancement est ASYNCHRONE : l'outil rend la main immédiatement et le résultat t'est transmis plus tard, sans que tu aies à attendre ni à relancer.",
    promptSnippet: "run_assistant_agents: sélectionner des agents d'assistant (sans projet) et lancer une tâche",
    promptGuidelines: [
      "Use run_assistant_agents when you need to execute work that is NOT tied to a specific project: research, analysis, internal coordination tasks for the assistant itself. The agents run in the reserved assistant workspace (~/.pilot/assistant/), without any project context.",
      "Select the agent ids that best fit the task (e.g. a custom agent you created for analysis). Provide a clear, atomic task description.",
      "Do NOT use this tool for work that must happen inside a project — use run_agents (with the project path) instead.",
      "ALWAYS pass `resume`: a SHORT phrase (max 120 characters) that says what the task really does. The user reads it FIRST in Pilot's task panel: write it for a human, in the user's language. Never invent it, never just repeat the technical task text.",
      "If the task MUST produce a file in the assistant workspace, pass `expected_files` (paths relative to the workspace): Pilot verifies their existence at the end and reports an explicit FAILURE naming any missing file. Do not ask a READ-ONLY agent to write a file: Pilot refuses the launch.",
    ],
    parameters: Type.Object({
      agent_ids: Type.Array(Type.String({ description: "Identifiants des agents d'assistant à utiliser (au moins un)" })),
      task: Type.String({ description: "La tâche à confier aux agents sélectionnés" }),
      resume: Type.Optional(Type.String({ description: "RÉSUMÉ COURT de la tâche pour le panneau des tâches de Pilot : une phrase (≤ 120 caractères) qui dit ce que la tâche fait réellement, dans la langue de l'utilisateur. Affiché EN PREMIER. Ne jamais inventer." })),
      workspace: Type.Optional(Type.String({ description: "Dossier de travail assistant (optionnel, défaut ~/.pilot/assistant)" })),
      expected_files: Type.Optional(Type.Array(Type.String({ description: "Fichiers RÉELLEMENT attendus sur le disque à la fin de la tâche (chemins RELATIFS à l'espace de travail assistant). Vérifiés en fin de mission : un fichier déclaré ABSENT fait échouer la tâche avec un message qui le nomme. À omettre pour une tâche d'analyse." }))),
      mcp_server: Type.Optional(Type.String({ description: "Identifiant d'un serveur MCP à connecter pour CET agent d'assistant (optionnel), découvert via mcp_state. Sans lui, l'agent ne charge pas MCP." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ agent_ids: params.agent_ids, task: params.task, resume: params.resume || null, workspace: params.workspace || null, mcp_server: params.mcp_server || null, expected_files: params.expected_files || null });
      const result = await ctx.ui.input(RUN_ASSISTANT_AGENTS_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Lancement de la tâche d'assistant annulé. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result + "\n\n" + LAUNCH_FOLLOW_UP }] };
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
      const result = await ctx.ui.input(PROJECT_SNAPSHOT_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Analyse du projet annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "git_status",
    label: "Git Status",
    description:
      "Obtenir l'état Git (lecture seule) d'un projet : branche active, fichiers modifiés, ajoutés, supprimés, non suivis et en attente (staged). À utiliser quand tu as besoin de connaître la santé Git d'un projet (travail en cours, éléments non commités) avant de répondre ou de planifier. Ne modifie aucun fichier.",
    promptSnippet: "git_status: obtenir l'état Git d'un projet (branche, fichiers modifiés/ajoutés/supprimés, en attente)",
    promptGuidelines: [
      "Use git_status when you need the Git state of a project: active branch, modified/added/deleted/untracked files and pending (staged) items. It is read-only and never modifies any file.",
      "Pass the absolute path of the project. If you are unsure about the path, ask the user first (ask_input / ask_choice).",
    ],
    parameters: Type.Object({
      project: Type.String({ description: "Chemin absolu du projet à analyser" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ project: params.project });
      const result = await ctx.ui.input(GIT_STATUS_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Analyse Git annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "git_log",
    label: "Git Log",
    description:
      "Obtenir l'historique des commits (lecture seule) d'un projet : les 20 derniers commits avec hash court, message, auteur et date. À utiliser quand tu as besoin de comprendre l'historique récent d'un projet (évolution, jalons, derniers changements) avant de répondre ou de planifier. Ne modifie aucun fichier.",
    promptSnippet: "git_log: obtenir l'historique des commits d'un projet (20 derniers, message, auteur, date)",
    promptGuidelines: [
      "Use git_log when you need the recent commit history of a project: the last 20 commits with short hash, message, author and date. It is read-only and never modifies any file.",
      "Pass the absolute path of the project. If you are unsure about the path, ask the user first (ask_input / ask_choice).",
    ],
    parameters: Type.Object({
      project: Type.String({ description: "Chemin absolu du projet à analyser" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ project: params.project });
      const result = await ctx.ui.input(GIT_LOG_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Analyse Git annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "mcp_state",
    label: "MCP State",
    description:
      "Obtenir l'état MCP (lecture seule) : si le client MCP est activé, si la confirmation utilisateur est requise avant qu'un agent utilise un serveur (mcp_agent_confirm) et la liste des serveurs MCP configurés (id, nom, état activé/désactivé). À utiliser quand tu comptes faire utiliser un serveur MCP : 1) découvre les serveurs disponibles, 2) choisis un serveur (mcp_server) à passer à run_agents, 3) si `confirm` est vrai, demande une confirmation à l'utilisateur (ask_confirm) avant de lancer l'agent sur ce serveur.",
    promptSnippet: "mcp_state: obtenir l'état MCP (activé, confirmation requise, serveurs disponibles)",
    promptGuidelines: [
      "Use mcp_state when you plan to have an agent use an MCP server: discover the available servers, then pick one (mcp_server id) to pass to run_agents.",
      "IMPORTANT confirmation rule: if `confirm` is true (default), ALWAYS ask the user for confirmation (ask_confirm) before launching an agent on a specific MCP server. If `confirm` is false, you may choose and launch alone automatically.",
      "Only call mcp_state again when the set of servers may have changed; prefer remembering the server ids in your context.",
    ],
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await ctx.ui.input(MCP_STATE_SENTINEL + "{}", "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Interrogation de l'état MCP annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "mcp_enable_server",
    label: "MCP Enable Server",
    description:
      "Activer UN serveur MCP nommé (par son identifiant, lu avec mcp_state), directement depuis la conversation — sans passer par les Paramètres. L'activation est EXCLUSIVE : Pilot ne branche qu'un serveur par session, donc activer un serveur DÉSACTIVE les autres serveurs activés ; la réponse nomme ceux qui ont été coupés (aucun effet de bord silencieux). L'outil ne change QUE l'état activé/désactivé : il ne modifie ni le client MCP, ni la confirmation requise, ni le contenu des serveurs, ni les secrets, et ne supprime aucun serveur. Effet à la PROCHAINE session d'agent (une session en cours garde son serveur). Règle de confirmation : c'est TOI qui demandes confirmation à l'utilisateur (ask_confirm) avant d'appeler cet outil ; l'outil applique ensuite l'action.",
    promptSnippet: "mcp_enable_server: activer un serveur MCP nommé (coupe les autres)",
    promptGuidelines: [
      "Use mcp_enable_server when the user wants a specific MCP server to be the one agents use. Pass the server id discovered with mcp_state; an unknown id is reported clearly and nothing is changed.",
      "Activation is exclusive (one MCP server per agent session): the other enabled servers are switched off and named in the answer. Tell the user which ones were cut — never hide it.",
      "Always ask the user for confirmation (ask_confirm) before calling this tool. The tool applies the change; it never asks by itself.",
      "The change takes effect at the NEXT agent session; a running session keeps the server it started with. Say so to the user.",
      "Do not touch anything else: the tool only toggles the enabled flag. Never delete a configured server, never edit commands, arguments, URLs or secrets.",
    ],
    parameters: Type.Object({
      server: Type.String({ description: "Identifiant du serveur MCP à activer (ex. « mcp-1 »), tel que renvoyé par mcp_state." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ server: String(params.server || ""), enabled: true });
      const result = await ctx.ui.input(MCP_SERVER_TOGGLE_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Activation du serveur MCP annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session. Aucun réglage n'a été modifié." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "mcp_disable_server",
    label: "MCP Disable Server",
    description:
      "Désactiver UN serveur MCP nommé (par son identifiant, lu avec mcp_state), directement depuis la conversation — sans passer par les Paramètres. Pilot ne le branchera plus ; aucun autre serveur n'est activé d'office à sa place et les autres serveurs gardent leur état. L'outil ne change QUE l'état activé/désactivé : il ne modifie ni le client MCP, ni la confirmation requise, ni le contenu des serveurs, ni les secrets, et ne supprime aucun serveur (il reste configuré, prêt à être réactivé). Effet à la PROCHAINE session d'agent (une session en cours garde son serveur). Règle de confirmation : c'est TOI qui demandes confirmation à l'utilisateur (ask_confirm) avant d'appeler cet outil ; l'outil applique ensuite l'action.",
    promptSnippet: "mcp_disable_server: désactiver un serveur MCP nommé (sans rien activer d'autre)",
    promptGuidelines: [
      "Use mcp_disable_server when the user wants a specific MCP server to stop being used. Pass the server id discovered with mcp_state; an unknown id is reported clearly and nothing is changed.",
      "Disabling never enables another server on its own: tell the user plainly that no server is used until one is enabled.",
      "Always ask the user for confirmation (ask_confirm) before calling this tool. The tool applies the change; it never asks by itself.",
      "The change takes effect at the NEXT agent session; a running session keeps the server it started with. Say so to the user.",
      "Never delete a configured server: this tool only toggles the enabled flag, the server stays configured and can be re-enabled later.",
    ],
    parameters: Type.Object({
      server: Type.String({ description: "Identifiant du serveur MCP à désactiver (ex. « test »), tel que renvoyé par mcp_state." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ server: String(params.server || ""), enabled: false });
      const result = await ctx.ui.input(MCP_SERVER_TOGGLE_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Désactivation du serveur MCP annulée. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu pour ne pas bloquer la session. Aucun réglage n'a été modifié." }] };
      }
      return { content: [{ type: "text", text: result }] };
    },
  });

  pi.registerTool({
    name: "stop_agent",
    label: "Stop Agent",
    description:
      "Arrêter immédiatement un agent (coupe la session en cours, qu'elle soit visible, en arrière-plan / « agent invisible », ou un agent secondaire/spécialisé/spécifique lancé via run_agents). Par défaut, arrête l'agent standard du projet actif. Si vous fournissez `agentId`, arrête précisément cet agent (standard, spécialisé, secondaire ou spécifique créé à la volée) — l'identifiant est celui que vous avez vous-même utilisé dans run_agents (registre des agents), il n'y a rien à rechercher. À utiliser UNIQUEMENT quand l'utilisateur demande explicitement d'arrêter le travail en cours. Ne jamais arrêter un agent que vous venez de lancer pour une tâche : cela détruit son travail en cours.",
    promptSnippet: "stop_agent: arrêter un agent (standard par défaut, ou un agentId cible)",
    promptGuidelines: [
      "Use stop_agent when the user asks to stop the current work, or when you detect an agent is going off track or is stuck at the end of a run and must be interrupted. This cuts the running agent session immediately (visible tab, invisible background agent, or a secondary/specialized/custom agent launched via run_agents).",
      "If you know the id of the specific agent to stop (e.g. a tester, a codeur-plh, or a custom agent you created and launched via run_agents), pass it in `agentId`. If you omit `agentId`, the standard agent of the active project is stopped.",
      "The `agentId` is the registry id you already know (the one you passed to run_agents). Never look it up by listing sessions: that freezes the assistant session and blocks the work queue.",
      "Never call stop_agent right after launching an agent: the launch is asynchronous by design, and stopping it kills the work it just started.",
    ],
    parameters: Type.Object({
      agentId: Type.Optional(Type.String({ description: "Identifiant de l'agent à arrêter. Si omis, arrête l'agent standard du projet actif." })),
      project: Type.Optional(Type.String({ description: "Chemin absolu du projet dont l'agent doit être arrêté. Si omis, utilise le projet actif." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "stop_agent", agentId: params.agentId || null, project: params.project || null });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload, PILOT_UI_OPTS);
      if (ok) {
        const target = params.agentId ? `L'agent « ${params.agentId} »` : "L'agent du projet actif";
        return { content: [{ type: "text", text: `${target} a été arrêté.` }] };
      }
      return { content: [{ type: "text", text: "Échec de l'arrêt de l'agent." }] };
    },
  });

  pi.registerTool({
    name: "remove_queued_mission",
    label: "Remove Queued Mission",
    description:
      "Retirer UNE SEULE mission de l'assistant de la file d'attente d'un projet (les autres restent en file, dans leur ordre). À utiliser quand une demande déjà en attente est devenue sans objet, périmée ou remplacée par une autre : elle ne doit pas garder sa place et prendre le projet à son tour. La demande visée se désigne par son RANG affiché par `/file` (la tâche en cours occupe le rang 1, donc la première demande en attente est le rang 2) ou par son NUMÉRO de mission. Ce geste NE VIDE PAS la file et N'ARRÊTE PAS la tâche en cours : pour arrêter ce qui tourne, c'est `stop_agent` ; pour tout abandonner, c'est le geste « vider la file » demandé par l'utilisateur.",
    promptSnippet: "remove_queued_mission: retirer UNE seule mission en attente (par rang affiché ou numéro de mission), sans toucher aux autres ni à la tâche en cours",
    promptGuidelines: [
      "Use remove_queued_mission when ONE specific waiting request has become obsolete or superseded: it removes just that request, and the others keep their place and their order.",
      "This tool only removes WAITING missions. Never use it to stop the mission that is currently running (use stop_agent for that), and never use it to empty the whole queue.",
      "Identify the target with `rank` (the rank shown by /file: the running task is rank 1, so the first waiting request is rank 2) or with `mission_id` when the user gives a mission number. If you know neither, ask the user with ask_input instead of guessing.",
      "After the call, read the returned `ok`, `remaining` and `message`: report in ONE short sentence which request was removed and how many are still waiting. On `ok: false`, say why (nothing was removed) instead of retrying blindly.",
    ],
    parameters: Type.Object({
      rank: Type.Optional(Type.Number({ description: "Rang affiché par /file de la demande à retirer (la tâche en cours occupe le rang 1)" })),
      mission_id: Type.Optional(Type.Number({ description: "Numéro de mission de la demande à retirer (celui affiché dans les rapports : [mission #7 …])" })),
      project: Type.Optional(Type.String({ description: "Chemin absolu du projet. Si omis, utilise le projet actif." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({
        project: params.project || null,
        rank: typeof params.rank === "number" ? params.rank : null,
        mission_id: typeof params.mission_id === "number" ? params.mission_id : null,
      });
      const result = await ctx.ui.input(QUEUE_REMOVE_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Retrait annulé. Aucune réponse de Pilot (délai de 2 min dépassé ou annulation) : l'appel a été interrompu, la file d'attente est inchangée." }] };
      }
      return { content: [{ type: "text", text: String(result) }] };
    },
  });

  pi.registerTool({
    name: "telegram_notifications",
    label: "Me prévenir sur Telegram",
    description:
      "Le réglage « me prévenir sur Telegram » de l'utilisateur : ce SEUL outil sert à le LIRE et à le CHANGER. Appelle-le SANS argument (`enabled` absent) pour savoir où en est le réglage : il te répond en clair, « OUI » ou « NON ». Appelle-le AVEC `enabled: true` pour que l'utilisateur soit prévenu sur Telegram (début et fin de mission, alertes), ou AVEC `enabled: false` pour que PLUS RIEN n'y parte (aucun message de début ni de fin, aucune alerte ; les alertes restent visibles dans Pilot). Il applique le changement et te renvoie le nouvel état : confirme alors en UNE phrase, sans demander de double confirmation. Sers-t'en dès que l'utilisateur parle de ces notifications (« préviens-moi sur Telegram », « arrête de me prévenir », « coupe les notifications », « est-ce que tu me préviens sur Telegram ? »…) : ne devine jamais l'état et ne demande pas à l'utilisateur de te le rappeler. Une demande AMBIGUË ne change RIEN : un « arrête » tout seul (ou « stop », « laisse tomber ») ne dit pas quoi arrêter — n'applique alors AUCUNE valeur, demande de quoi il s'agit, et ne lis jamais une ambiguïté comme un « oui ». Seule une intention claire (arrêter, ou recevoir, CES notifications Telegram) fait changer le réglage.",
    promptSnippet: "telegram_notifications: lire (sans argument) ou changer (enabled: true/false) le réglage « me prévenir sur Telegram »",
    promptGuidelines: [
      "Call telegram_notifications with NO argument to READ the setting: the answer says OUI (yes) or NON (no) in plain words. Never guess the state and never ask the user to remind you.",
      "Call telegram_notifications with enabled: true to start notifying the user on Telegram, and enabled: false when they ask to stop being notified, to cut notifications, or to stop receiving messages there. The answer gives the new state: confirm in ONE short sentence, without a second confirmation.",
      "This tool is the ONLY source of truth for that setting: nothing about it is written in your context, so call it when you need it instead of assuming.",
      "NEVER change the setting on an ambiguous request: a bare « arrête » / « stop » / « laisse tomber » does not say WHAT must stop. Leave the setting untouched, ask the user what they mean, and never read ambiguity as a yes. Only a clear intention about these Telegram notifications (stop them, or receive them) changes it.",
    ],
    parameters: Type.Object({
      enabled: Type.Optional(Type.Boolean({ description: "true → prévenir sur Telegram ; false → ne plus rien envoyer sur Telegram ; absent → l'outil renvoie seulement l'état actuel" })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // `null` = lecture seule. Une valeur explicite = changement d'état.
      const wanted = typeof params.enabled === "boolean" ? params.enabled : null;
      const payload = JSON.stringify({ enabled: wanted });
      const result = await ctx.ui.input(TELEGRAM_NOTIFY_SENTINEL + payload, "", PILOT_UI_OPTS);
      if (result == null) {
        return { content: [{ type: "text", text: "Réglage « me prévenir sur Telegram » : aucune réponse de Pilot (délai de 2 min dépassé ou annulation), l'appel a été interrompu. L'état est inchangé : rappelle l'outil pour le connaître." }] };
      }
      return { content: [{ type: "text", text: String(result) }] };
    },
  });

  pi.registerTool({
    name: "delegate_to_coder",
    label: "Delegate to Coder",
    description:
      "Déléguer une demande de modification de code à un agent d'un projet (pi/plh de coding). L'agent cible est OBLIGATOIRE : tu DOIS le désigner via `agent_id` (l'agent que tu désignes est exactement celui qui est lancé). Sans `agent_id`, la délégation est REFUSÉE avec un message demandant de préciser l'agent — il n'y a aucun repli implicite sur un autre agent. Par défaut, délègue au projet actif et ouvre son onglet (le rend visible) en lui envoyant la demande dans sa session de discussion. Si `background=true`, démarre l'agent en mode invisible (en arrière-plan, sans ouvrir d'onglet). Si `project` est fourni, délègue à CE projet (même s'il n'est pas actif) : son agent est démarré en arrière-plan (invisible) automatiquement, sans ouvrir le projet ni l'onglet. L'agent finalement retenu est affiché dans le retour. À utiliser quand l'utilisateur demande une modification de code sur un projet. L'outil rend la main dès que Pilot a TRANSMIS la demande : le TRAVAIL de l'agent est asynchrone et son résultat (rapport ou échec) te sera déposé automatiquement dans la conversation. N'attends pas, ne surveille pas (pas de `list_agent_sessions`), ne relance pas et n'arrête pas l'agent tant que ce résultat n'est pas arrivé.",
    promptSnippet: "delegate_to_coder: déléguer une demande de code à l'agent d'un projet",
    promptGuidelines: [
      "Use delegate_to_coder when the user asks for a code modification on a project. The request is sent to a project agent (pi/plh), which opens its tab and receives the request in its discussion. Only delegate actual code work — for simple questions about how something works, answer directly.",
      "ALWAYS pass `agent_id` to designate the SPECIFIC agent that must do the work (e.g. 'codeur'). Without it, the delegation is REFUSED with a message asking to name the agent — Pilot never silently falls back to another agent.",
      "Set background=true to start the agent in invisible mode (background, without opening a tab). This is useful when you want the agent to work without disturbing the user's current view.",
      "Pass `project` (absolute path) to delegate to a specific project even if it is not the active one. Its agent is started in the background (invisible) automatically, without opening the project or its tab.",
      "The tool returns as soon as Pilot has FORWARDED the request: the agent works asynchronously and its result is delivered to you automatically later. Do not wait, do not poll (no list_agent_sessions), do not relaunch and do not stop the agent before that result arrives.",
    ],
    parameters: Type.Object({
      request: Type.String({ description: "La demande de code à transmettre à l'agent du projet" }),
      agent_id: Type.String({ description: "Identifiant de l'agent désigné pour la tâche (obligatoire, ex: 'codeur'). Sans cette désignation, la délégation est refusée : aucun repli automatique." }),
      project: Type.Optional(Type.String({ description: "Chemin absolu du projet cible. Si omis, délègue au projet actif." })),
      background: Type.Optional(Type.Boolean({ description: "true → démarrer l'agent en mode invisible (arrière-plan, sans ouvrir d'onglet). Défaut : false (onglet ouvert)." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const payload = JSON.stringify({ action: "delegate_to_coder", request: params.request, agentId: params.agent_id || null, project: params.project || null, background: params.background === true });
      const ok = await ctx.ui.confirm("Pilot — action assistant", ACTION_SENTINEL + payload, PILOT_UI_OPTS);
      if (ok) {
        const mode = params.background === true ? "en arrière-plan (agent invisible)" : "(son onglet est ouvert)";
        const target = `l'agent « ${params.agent_id} »`;
        return { content: [{ type: "text", text: `La demande a été transmise à ${target} ${mode}. L'agent finalement retenu est indiqué dans le retour de Pilot.` }] };
      }
      return { content: [{ type: "text", text: "Échec de la transmission de la demande à l'agent du projet." }] };
    },
  });
}
