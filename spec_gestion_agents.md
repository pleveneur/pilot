# Spécification — Gestion d'agents (H2 V2)

> Onglet **🎭 Agents** : **écran de configuration** de l'équipe d'agents (registre : liste, éditeur, compétences) + affichage de l'**activité** des runs en cours. Les lancements se font depuis l'onglet 🧭 **Assistant** (délégation) et les **onglets d'agents** du projet.

<!-- HELP:agents -->
## Aide utilisateur — Agents

L'onglet **🎭 Agents** sert à **configurer l'équipe d'agents** et à **suivre** ce qu'elle fait. Pour lancer une tâche, utilisez l'onglet **🧭 Assistant** (ou la discussion d'un agent).

### L'écran
- **Colonne de gauche : l'équipe.** Chaque carte montre le nom, l'identifiant, les modèles (`π` = pi, `ℓ` = plh), et des badges : **lecture seule** et le **nombre de compétences**.
- **Colonne de droite : l'activité.** Tableau de bord des runs en cours : qui travaille, sur quel outil, la **chaîne des appels**, le **budget restant** et la **profondeur**. L'agent en cours est surligné. Le bilan reste visible après la fin de la run.
- **➕ Ajouter** crée un agent ; **✏️ Modifier** ouvre l'éditeur ; **🗑️ Supprimer** retire un agent.
- **🔄 Réinitialiser** restaure les **7 agents fournis** (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker). **Vos agents personnalisés sont conservés.**

### Créer / modifier un agent
- **ID** : identifiant machine en kebab-case, non modifiable après création. Un identifiant fourni par Pilot (ex. `codeur`) est refusé à la création : la réinitialisation écraserait cet agent.
- **Nom, icône, description, rôle** : la **description** sert au coordinateur pour router les tâches ; le **rôle** est le prompt système de l'agent.
- **Modèles** : modèle `π` (pi) et `ℓ` (plh) séparés ; « Modèle par défaut » laisse Pilot choisir.
- **Lecture seule** : consigne stricte de ne pas écrire de fichiers. **Garder le contexte** : la session n'est pas remise à zéro entre deux appels.
- **Max appels / run** et **Profondeur max** : garde-fous propres à l'agent.

### Compétences par agent
- Les compétences (skills) forment une **bibliothèque commune** dans `~/.pilot/skills/` : un dossier par compétence, contenant un fichier `SKILL.md`.
- Cochez dans l'éditeur les compétences que **cet** agent peut voir. Un agent ne voit **que** les compétences cochées (filtrage strict) — plus la compétence `quality-gate`, jamais filtrée.
- Compétence absente de la liste mais déjà cochée = dossier introuvable dans `~/.pilot/skills` : elle reste affichée pour ne pas disparaître sans que vous le sachiez.
- Pour en ajouter une : créez le dossier `<nom>/SKILL.md` dans `~/.pilot/skills`, puis rouvrez l'éditeur de l'agent.

### Suivre et arrêter
- Une tâche lancée sur un agent **peut en appeler un autre** : Pilot relaie le résultat à l'appelant, un seul agent travaille à la fois (hors sous-tâches parallèles).
- **Détection de cycle** : un agent déjà dans la chaîne ne peut pas être rappelé.
- **Timeout d'inactivité** : si un agent reste silencieux trop longtemps (5 min par défaut), la run s'arrête et un message le signale. Réglable dans **Paramètres → Agents**.
- **⏹ Arrêter** arrête tous les processus d'agents. Fermer l'onglet les arrête aussi.

### Conseils
- Donnez un modèle puissant au coordinateur : c'est lui qui route les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.
<!-- /HELP:agents -->

### Agent `plan-maker` (planificateur)

Le `plan-maker` est un agent **lecture seule** qui ne modifie jamais le code : il
analyse une demande et produit un **plan structuré en JSON** (tâches + fichiers
concernés + coût estimé en tokens + contraintes suggérées + dépendances).

- **Rôle** : découper la demande en micro-tâches (1 à 3 fichiers par tâche),
  estimer le coût en tokens de chaque tâche, et proposer des contraintes
  (ex : « ne pas modifier `lib.rs` », « budget max 2000 tokens »).
- **Format de sortie** : un JSON valide
  ```json
  {"plan": [{"id": 1, "title": "...", "description": "...",
            "files": ["..."], "estimated_tokens": 0,
            "suggested_constraints": ["..."], "depends_on": []}]}
  ```
- **Quand l'utiliser** : pour les demandes importantes nécessitant un découpage
  et une validation avant délégation au codeur.
- **Utilisation par l'Assistant (Magnus)** : l'Assistant peut appeler le
  `plan-maker` via `run_agents` (extension `pilot-assistant-actions`) pour
  obtenir un plan structuré, le présenter à l'utilisateur (via `ask_multi_choice`
  pour cocher les tâches à exécuter + `ask_confirm` pour valider), puis déléguer
  au codeur avec le plan approuvé et les contraintes.

---

## 1. Objectifs

- Définir des agents nommés dans un **registre global** persisté en base SQLite (`pilot.db`, tables `agents` / `agent_views`) — et non dans un fichier `~/.pilot/agents.json` (voir § 3).
- Chaque agent a un rôle (system prompt), un modèle par backend (`pi` / `plh`) et une liste de **compétences** (skills) visibles.
- Un coordinateur reçoit la demande utilisateur et déclenche les agents spécialisés.
- Protocole séquentiel `[[CALL:agent_id]]` / `[[RESULT from agent_id]]`.
- Garde-fous : profondeur, budget, cycle, timeout, stop global.

## 2. Architecture

```
Utilisateur
   │
   ▼
Coordinateur (session longue)
   │ [[CALL:architecte]]
   ▼
Agent cible (session vierge ou conservée)
   │
   ▼
Pilot renvoie le résultat à l'appelant
```

- **Une session `pi --mode rpc` par agent** (généralisation du reviewer H2 V1).
- Canal d'événements unique `rpc-event-agents` avec enveloppe `{agent_id, event}`.
- Toutes les sessions vivent dans le **registre unique de l'AgentService** (`agent_service.rs`), indexé par clé composite `(projet, agent)`. Les agents multi-rôles H2 V2 y sont stockés avec un `SpawnMode::AgentProcess` (canal `rpc-event-agents`), distincts de la session principale (`MainSession`).

## 3. Données

### Registre global (base SQLite)

Le registre global vit dans la base SQLite de l'application (`pilot.db`, dossier de configuration Pilot), tables `agents` et `agent_views` :

- `agents` : objet agent (id, nom, icône, description, rôle, modèles, **compétences**, drapeaux, limites d'appel) avec `project_path IS NULL` pour le périmètre global (les agents rattachés à un projet portent leur chemin).
- `agent_views` : vues d'onglets (ordre, nom affiché, onglet actif).
- La colonne `skills` est un tableau JSON de noms de dossiers de `~/.pilot/skills` (migration idempotente `NOT NULL DEFAULT '[]'`).
- Un ancien fichier `~/.pilot/agents.json` peut subsister sur une installation ancienne : il **n'est plus lu ni écrit**.

```jsonc
// forme sérialisée d'un agent (colonne → JSON)
{
  "id": "coordinateur",
  "name": "Coordinateur",
  "icon": "🧠",
  "description": "Pilote l'équipe d'agents.",
  "role": "Tu es le chef d'orchestre...",
  "models": { "pi": "deepseek/deepseek-chat", "plh": "deepseek/deepseek-chat" },
  "capabilities": ["delegate", "synthesize"],
  "skills": ["quality-gate"],
  "readonly": false,
  "keep_context": true,
  "max_calls_per_run": 20,
  "call_depth": 0
}
```

### Champs

| Champ | Description |
|---|---|
| `id` | Identifiant machine unique (kebab-case). Un id fourni par Pilot n'est pas créable (D4). |
| `name` | Nom affiché. |
| `icon` | Emoji/icône. |
| `description` | Description fonctionnelle utilisée par le coordinateur pour router. |
| `role` | Instructions système injectées en début de chaque prompt. |
| `models.pi` / `models.plh` | Modèle selon le backend actif. |
| `skills` | Noms de dossiers de `~/.pilot/skills` que **cet** agent voit (filtrage strict, § 3.1). |
| `readonly` | `true` → agent qui ne doit pas écrire. |
| `keep_context` | `true` → ne pas faire `new_session` entre deux appels. |
| `max_calls_per_run` | Limite d'appels pour cet agent dans une run. |
| `call_depth` | Profondeur max à laquelle cet agent peut être appelé (0 = coordinateur). |

### 3.1 Compétences par agent (skills)

- **Bibliothèque commune** : `~/.pilot/skills/<nom>/SKILL.md` (dossier utilisateur Pilot, résolu cross-platform). Un dossier sans `SKILL.md` lisible est ignoré. Aucun fichier n'est créé par Pilot (création à l'usage, par l'utilisateur).
- **Un skill n'ajoute pas d'outil** : c'est un document de consignes (frontmatter `name`, `description`, `disable-model-invocation`) chargé dans le prompt système.
- **Filtrage STRICT (D6)** : un agent ne voit que les compétences de sa liste. Pilot passe à la session pi les chemins `--skill` correspondants (`common_skill_path` refuse tout nom vide ou contenant `/`, `\`, `..`) et exporte `PILOT_AGENT_SKILLS` (JSON des noms). L'extension embarquée `pilot-skills.ts` (`filterSkillsForAgent`), chargée dans TOUTES les sessions d'agent (jamais conditionnée à un autre réglage), retire alors de `event.systemPromptOptions.skills` toute compétence auto-découverte non listée.
- **`quality-gate` n'est jamais filtré** : il reste disponible même s'il n'est pas listé (il est aussi chargé via `--skill` par les sessions concernées).
- **Fail-open** : si `PILOT_AGENT_SKILLS` est absent (session non-agent), aucun filtrage n'a lieu.
- Les agents **fournis** n'ont pas de compétence par défaut : la liste se remplit dans l'éditeur de l'onglet 🎭.

### Commandes Tauri (compétences)

- `list_common_skills() → [{ name, description }]` : inventaire de `~/.pilot/skills` pour le sélecteur de l'éditeur (lecture seule).
- `default_agent_ids() → [String]` : identifiants des 7 agents fournis (source unique, sert au garde-fou de création).

## 4. Protocole inter-agents

### Appel sortant (dans la réponse d'un agent)

```text
Voici mon analyse.

[[CALL:codeur]]
{
  "task": "Crée la route GET /api/search...",
  "files": ["src/routes/search.js"],
  "context": "Utilise Express."
}
[[/CALL]]
```

- Prendre le **dernier** bloc `[[CALL:...]]`.
- JSON optionnel ; si invalide, le brief reste le texte brut entre les marqueurs.

### Résultat renvoyé à l'appelant

```text
[[RESULT from codeur (status: done)]]
DONE: Route GET /api/search créée.
[[/RESULT]]
```

- `status` : `done`, `need_help`, `timeout`, `error`.
- Contenu tronqué selon le budget configuré.

### Délégation parallèle (H2 V2 parallèle)

Pour des sous-tâches **indépendantes**, un agent (typiquement le coordinateur) peut
lancer plusieurs agents **simultanément** via un bloc `[[PARALLEL]]` :

```text
[[PARALLEL]]
agent: codeur
task: Implémente la route GET /api/search.
---
agent: testeur
task: Écris les tests de la route GET /api/search.
---
agent: documenteur
task: Documente la nouvelle route dans le README.
[[/PARALLEL]]
```

- Chaque bloc `agent:` + `task:` est une sous-tâche confiée à un agent distinct,
  exécutée **en parallèle** (chacun dans son propre processus pi).
- Les agents parallèles sont des agents « feuille » : ils exécutent leur brief et
  retournent leur résultat (pas de délégation `[[CALL]]` imbriquée en V1).
- Quand tous ont terminé, leurs résultats sont **agrégés** et renvoyés à
  l'appelant via `[[RESULT from parallel (status: done)]]`.
- Garde-fous appliqués par agent : budget (`max_calls_per_run`), budget total,
  timeout d'inactivité. `stopAgentsRun` abort **tous** les agents actifs.

### Mode parallèle piloté par l'Assistant

Le mode parallèle de l'onglet 🎭 (sélection d'agents + envoi depuis un champ de saisie) **n'existe plus** : la colonne « discussion » a été retirée de l'écran de configuration. Les runs parallèles restent possibles via le bloc `[[PARALLEL]]` du coordinateur et via `runAgentsForAssistant(assignments)` (bus d'agents), utilisés par l'Assistant.

### L'Assistant comme coordinateur (spec_super_agent.md)

L'**Assistant** (onglet 🧭) est le **coordinateur de la redistribution des
tâches** entre les agents du registre. Via les outils `create_agent` et
`run_agents` (extension `pilot-assistant-actions`), il peut :

1. **Créer un agent sur mesure** dans le registre global (base SQLite) s'il
   estime que les agents disponibles ne conviennent pas (rôle construit selon
   son besoin).
2. **Choisir quels agents utiliser** (sélection par id) et lancer une tâche sur
   eux (en parallèle), en recevant le résultat agrégé pour continuer son
   raisonnement.

Le bus d'agents expose `runAgentsForAssistant(assignments)` (Promise résolue
avec le résultat agrégé) pour ce cas d'usage, distinct de l'UI de l'onglet 🎭.

## 5. Backend Rust

### AgentService (propriétaire unique des sessions)

Les sessions des agents multi-rôles H2 V2 vivent dans le **registre unique de
l'AgentService** (`agent_service.rs`), indexé par clé composite `(project, agent)`,
au même titre que la session principale (chat Agent Pi), le reviewer
`orch-reviewer` et le super-agent `superagent`. Elles y sont marquées
`SpawnMode::AgentProcess` (canal `rpc-event-agents`) pour être arrêtées par
`stop_all_agent_processes` et distinctes des sessions `MainSession`.

```rust
// agent_service.rs
sessions: Mutex<HashMap<String, SessionEntry>>,  // clé composite (project, agent)
active:   Mutex<Option<String>>,                 // agent_id actuellement affiché
```

Les commandes `agents.rs` (`do_start_agent_process`, …) délèguent à
`AgentService.start` / `AgentService.send` / `AgentService.stop` au lieu de
toucher une map `agent_sessions` d'`AppState` (champ retiré en phase 2).

### Commandes Tauri

- `start_agent_process(agent_id, cwd, pi_path, no_session)`
- `stop_agent_process(agent_id)`
- `stop_all_agent_processes()`
- `send_agent_process_prompt(agent_id, message)`
- `new_agent_process_session(agent_id)`
- `set_agent_process_model(agent_id, provider, model_id)`
- `abort_agent_process(agent_id)`
- `get_agent_process_state(agent_id)`
- `load_agent_registry()` / `save_agent_registry(registry)` : anciennes commandes fichier ; elles persistent désormais en base via `list_agents` / `replace_agents`.
- `list_common_skills()` : inventaire des compétences de `~/.pilot/skills`.
- `default_agent_ids()` : identifiants des agents fournis.

### Dossier global

`~/.pilot/` résolu cross-platform (dossier utilisateur Pilot). Il contient la base du registre (`pilot.db`), la bibliothèque de compétences (`skills/`) et les espaces de l'Assistant.

## 6. Frontend

### Modules

| Fichier | Rôle |
|---|---|
| `src/js/agents.js` | Fonctions pures : registre, modèles, prompts, parsing (`[[CALL]]`, `[[PARALLEL]]`), agrégation, garde-fous. |
| `src/js/agents-bus.js` | Bus d'exécution : pile, timeouts, envois/réceptions, dispatch parallèle (`dispatchParallel`, `startParallelRun`), buffers par agent. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents : **configuration** (liste + éditeur, dont le sélecteur de compétences) et panneau d'**activité** des runs. |

### Résolution du modèle

1. `backendKind()` → `"pi"` / `"plh"`.
2. `models.{backend}` → fallback sur l'autre backend → fallback modèle par défaut du backend → modèle courant.

### Garde-fous (configurables dans Paramètres)

- Profondeur max d'appel : 3 (défaut).
- Budget total d'appels : 30.
- Timeout d'inactivité : 300 s (5 min, défaut). Relevé de 120 s → 300 s pour les agents faisant des outils longs (ex: codeur/builds). À l'échéance, un message d'erreur clair est affiché et la run s'arrête SANS message « arrêtée par l'utilisateur » (issue #10).
- Taille max résultat renvoyé : 4000 tokens.
- Détection de cycle : interdit de rappeler un agent déjà dans la pile.

## 7. Cycle de vie

- `stop_all_agent_processes()` à la fermeture de l'onglet Agents, au changement de projet et à la fermeture de l'application.
- Sous-agents avec `keep_context: false` reçoivent `new_session` avant chaque appel.
- Le coordinateur garde son contexte pendant toute la run.

## 8. Anti-régression

- Ne pas toucher à `agent-pi.js`, `orchestration.js`, `agents-bus.js` (logique d'orchestration frontend).
- Toutes les sessions passent par l'AgentService (une seule indirection `send`), jamais par un accès direct à une map dans `AppState`.
- Utiliser un canal séparé `rpc-event-agents` pour ne pas polluer les canaux existants.
- Tous les agents sont lazy et arrêtés proprement.
- Les sessions d'agents reçoivent leurs `--skill` + `PILOT_AGENT_SKILLS` dans `spawn_agent_process` (agent_service.rs) : ne pas revenir à un spawn sans compétences.
- **Réinitialiser** ne doit jamais faire de `DELETE` du périmètre global (D5) : un upsert par agent fourni, sans toucher aux agents personnalisés. Le frontend doit **réafficher le registre réel relu en base** (`list_agents`), jamais le retour de `reset_agent_registry` (qui ne contient que les fournis) : sinon les agents personnalisés disparaissent à l'écran, puis en base à la sauvegarde suivante (le frontend redessine et renvoie la liste affichée).
- **D4 (création avec l'id d'un fourni) refusé aussi dans le cœur** : la commande `upsert_agent` refuse la création d'un agent GLOBAL dont l'id est celui d'un agent fourni (mise à jour d'un fourni existant et agents de projet restent autorisés). Un appel IPC direct ne doit pas pouvoir contourner la règle appliquée par l'interface.

---

*Voir aussi : `plan_gestion_agents.md` (plan d'implémentation détaillé).*
