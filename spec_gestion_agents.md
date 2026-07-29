# Spécification — Gestion d'agents (H2 V2)

> Onglet **🎭 Agents** : équipe d'agents nommés, rôlés, qui s'appellent séquentiellement sous le pilotage de Pilot.

<!-- HELP:agents -->
## Aide utilisateur — Mode Agents

L'onglet **🎭 Agents** permet de lancer une équipe d'agents spécialisés (coordinateur, architecte, codeur, reviewer, testeur, documenteur) sur une demande.

### Comment ça marche
1. Cliquez sur **🎭 Agents** dans le panneau d'actions (bouton visible dès qu'un projet est ouvert).
2. Saisissez votre demande dans le chat ; le **coordinateur** la reçoit.
3. Le coordinateur délègue chaque sous-tâche à l'agent adapté via `[[CALL:agent_id]]`.
4. Pilot orchestre les appels : un seul agent travaille à la fois, les résultats sont renvoyés à l'appelant.
5. Le coordinateur synthétise la réponse finale.

### Gérer les agents
- Les agents sont stockés dans `~/.pilot/agents.json` (partagés entre tous les projets).
- Vous pouvez modifier leurs noms, icônes, descriptions, rôles et modèles (`pi` et `plh` séparément).
- Le bouton **Réinitialiser** recrée les 6 agents par défaut.

### Garde-fous
- Profondeur max d'appel, budget total et par agent, détection de cycle, timeout d'inactivité, bouton **⏹ Arrêter**.
- Les agents marqués **lecture seule** ont une consigne stricte dans leur rôle ; ils ne doivent pas modifier de fichiers.

### Conseils
- Le modèle du coordinateur doit être puissant (cloud) pour bien router les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.
- Si une run dérape, cliquez sur **Arrêter** : tous les processus agents seront stoppés.
<!-- /HELP:agents -->

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
- `rpc_state` (chat Agent Pi) et `rpc_reviewer` (reviewer orchestration) restent intacts.

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

## 5. Backend Rust

### AppState

```rust
agent_sessions: Mutex<HashMap<String, rpc_manager::RpcSession>>,
```

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
| `src/js/agents.js` | Fonctions pures : registre, modèles, prompts, parsing, garde-fous. |
| `src/js/agents-bus.js` | Bus d'exécution : pile, timeouts, envois/réceptions. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents. |

### Résolution du modèle

1. `backendKind()` → `"pi"` / `"plh"`.
2. `models.{backend}` → fallback sur l'autre backend → fallback modèle par défaut du backend → modèle courant.

### Garde-fous (configurables dans Paramètres)

- Profondeur max d'appel : 3 (défaut).
- Budget total d'appels : 30.
- Timeout d'inactivité : 120 s.
- Taille max résultat renvoyé : 4000 tokens.
- Détection de cycle : interdit de rappeler un agent déjà dans la pile.

## 7. Cycle de vie

- `stop_all_agent_processes()` à la fermeture de l'onglet Agents, au changement de projet et à la fermeture de l'application.
- Sous-agents avec `keep_context: false` reçoivent `new_session` avant chaque appel.
- Le coordinateur garde son contexte pendant toute la run.

## 8. Anti-régression

- Ne pas toucher à `rpc_state`, `rpc_reviewer`, `agent-pi.js`, `orchestration.js`.
- Utiliser un canal séparé `rpc-event-agents` pour ne pas polluer les canaux existants.
- Tous les agents sont lazy et arrêtés proprement.

---

*Voir aussi : `plan_gestion_agents.md` (plan d'implémentation détaillé).*
