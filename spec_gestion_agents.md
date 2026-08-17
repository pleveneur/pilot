# Spécification — Gestion d'agents (H2 V2)

> Onglet **🎭 Agents** : équipe d'agents nommés, rôlés, qui s'appellent séquentiellement sous le pilotage de Pilot.

<!-- HELP:agents -->
## Aide utilisateur — Mode Agents

L'onglet **🎭 Agents** permet de lancer une équipe d'agents spécialisés (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker) sur une demande.

### Comment ça marche
1. Cliquez sur **🎭 Agents** dans le panneau d'actions (bouton visible dès qu'un projet est ouvert).
2. Saisissez votre demande dans le chat ; le **coordinateur** la reçoit.
3. Le coordinateur délègue chaque sous-tâche à l'agent adapté via `[[CALL:agent_id]]`.
4. Pilot orchestre les appels : un seul agent travaille à la fois, les résultats sont renvoyés à l'appelant.
5. Le coordinateur synthétise la réponse finale.

### Mode parallèle
- Cliquez sur le bouton **⚡ Mode parallèle** (icône `layers`) à côté du champ de saisie.
- Sélectionnez plusieurs agents, puis envoyez votre tâche : elle est lancée **simultanément** sur tous les agents sélectionnés (sans coordinateur).
- Chaque agent travaille dans sa propre bulle de réflexion ; les résultats sont affichés agrégés à la fin.
- Le coordinateur peut aussi lancer des sous-tâches indépendantes en parallèle via `[[PARALLEL]]` (blocs `agent:`/`task:` séparés par `---`).

### Suivre une run
- Le panneau **Activité** (à droite) affiche un tableau de bord de l'équipe :
  **ce que fait chaque agent** en temps réel (réfléchit, utilise un outil,
  appelle un collègue, a terminé), avec le rappel de son rôle.
- **L'agent actif est mis en avant** (carte surlignée en vert) pour savoir
  qui travaille en ce moment.
- Au centre, une **bulle « réflexion »** affiche en direct la pensée de l'agent
  courant (son texte qui se construit) et les outils qu'il utilise.
- La **chaîne des appels** (« qui appelle qui »), le **budget restant** et la
  **profondeur** atteinte sont affichés.
- Le bilan reste visible après la fin de la run pour relire qui a fait quoi.
- **Timeout d'inactivité** : si un agent reste silencieux plus de 5 minutes, la run s'arrête
  et un message le signale clairement (sans le « Run arrêtée par l'utilisateur »). Vous pouvez
  ajuster la durée dans **Paramètres → Agents → Timeout d'inactivité (ms)**.

### Gérer les agents
- Les agents sont stockés dans `~/.pilot/agents.json` (partagés entre tous les projets).
- Vous pouvez modifier leurs noms, icônes, descriptions, rôles et modèles (`pi` et `plh` séparément).
- Le bouton **Réinitialiser** recrée les 7 agents par défaut.

### Garde-fous
- Profondeur max d'appel, budget total et par agent, détection de cycle, timeout d'inactivité, bouton **⏹ Arrêter**.
- Les agents marqués **lecture seule** ont une consigne stricte dans leur rôle ; ils ne doivent pas modifier de fichiers.

### Conseils
- Le modèle du coordinateur doit être puissant (cloud) pour bien router les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.
- Si une run dérape, cliquez sur **Arrêter** : tous les processus agents seront stoppés.
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

- Définir des agents nommés dans un registre global `~/.pilot/agents.json`.
- Chaque agent a un rôle (system prompt) et un modèle par backend (`pi` / `plh`).
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

### `~/.pilot/agents.json`

```json
{
  "version": 1,
  "updated_at": "2026-08-10T12:00:00Z",
  "agents": [
    {
      "id": "coordinateur",
      "name": "Coordinateur",
      "icon": "🧠",
      "description": "Pilote l'équipe d'agents.",
      "role": "Tu es le chef d'orchestre...",
      "models": { "pi": "deepseek/deepseek-chat", "plh": "deepseek/deepseek-chat" },
      "capabilities": ["delegate", "synthesize"],
      "readonly": false,
      "keep_context": true,
      "max_calls_per_run": 20,
      "call_depth": 0
    }
  ]
}
```

### Champs

| Champ | Description |
|---|---|
| `id` | Identifiant machine unique (kebab-case). |
| `name` | Nom affiché. |
| `icon` | Emoji/icône. |
| `description` | Description fonctionnelle utilisée par le coordinateur pour router. |
| `role` | Instructions système injectées en début de chaque prompt. |
| `models.pi` / `models.plh` | Modèle selon le backend actif. |
| `readonly` | `true` → agent qui ne doit pas écrire. |
| `keep_context` | `true` → ne pas faire `new_session` entre deux appels. |
| `max_calls_per_run` | Limite d'appels pour cet agent dans une run. |
| `call_depth` | Profondeur max à laquelle cet agent peut être appelé (0 = coordinateur). |

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

### Mode parallèle piloté par l'utilisateur

Dans l'onglet 🎭 Agents, le bouton **⚡ Mode parallèle** (icône `layers`) permet
à l'utilisateur de sélectionner plusieurs agents et d'envoyer une même tâche à
tous **simultanément**, sans coordinateur. Chaque agent stream dans sa propre
bulle de réflexion ; les résultats sont affichés agrégés à la fin.

### L'Assistant comme coordinateur (spec_super_agent.md)

L'**Assistant** (onglet 🧭) est le **coordinateur de la redistribution des
tâches** entre les agents du registre. Via les outils `create_agent` et
`run_agents` (extension `pilot-assistant-actions`), il peut :

1. **Créer un agent sur mesure** dans `~/.pilot/agents.json` s'il estime que les
   agents disponibles ne conviennent pas (rôle construit selon son besoin).
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
- `load_agent_registry()`
- `save_agent_registry(registry)`

### Dossier global

`~/.pilot/` résolu cross-platform via `dirs::home_dir()` (ou équivalent Tauri).

## 6. Frontend

### Modules

| Fichier | Rôle |
|---|---|
| `src/js/agents.js` | Fonctions pures : registre, modèles, prompts, parsing (`[[CALL]]`, `[[PARALLEL]]`), agrégation, garde-fous. |
| `src/js/agents-bus.js` | Bus d'exécution : pile, timeouts, envois/réceptions, dispatch parallèle (`dispatchParallel`, `startParallelRun`), buffers par agent. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents (bulles de réflexion multiples, mode parallèle). |

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

---

*Voir aussi : `plan_gestion_agents.md` (plan d'implémentation détaillé).*
