# Plan — Gestion d'agents dans Pilot

> Réflexion d'architecture et plan d'implémentation détaillé.  
> Statut : planification · non implémenté.  
> Cible : fournir à un agent de codage un guide complet, tâche par tâche.

---

## 1. Objectifs et périmètre

### 1.1 Besoins exprimés

- **Créer des agents** : l'utilisateur peut définir des agents nommés dans Pilot.
- **Leur donner des rôles** : chaque agent dispose d'un "system prompt" / d'une description de rôle qui guide son comportement.
- **S'appeler entre eux** : un agent qui détecte qu'une sous-tâche nécessite une compétence différente peut déclencher un autre agent, lui envoyer un brief, récupérer son résultat et continuer son propre raisonnement.
- **Pilotage par Pilot** : le "bus" d'agents est Pilot lui-même (frontend + backend Tauri). Pilot orchestre les sessions, les appels et les réponses.

### 1.2 Périmètre V1 (première livraison)

- Gestionnaire d'agents embarqué (fichier **global** `~/.pilot/agents.json`, dossier utilisateur Pilot — ex. `C:\Users\pldistance\.pilot\agents.json`). Les agents sont partagés entre tous les projets.
- Onglet dédié **"🎭 Agents"**.
- Protocole d'appel inter-agents **séquentiel** (un seul agent parle à la fois).
- Agent **coordinateur** qui reçoit la demande utilisateur et route vers les agents spécialisés.
- Agents prédéfinis livrés avec le projet (architecte, codeur, reviewer, testeur, documenteur).
- Garde-fous simples : profondeur d'appel max, budget d'appels, timeout, détection de cycle, bouton stop global.

### 1.3 Hors V1 (reportés)

- Exécution parallèle de sous-agents (appels multiples simultanés).
- Agents distants (mode web) pilotés depuis le serveur axum.
- Marketplace / partage d'agents entre projets.
- Override d'agents au niveau projet (reporté : V1 = global uniquement).
- Modification de l'orchestration existante pour utiliser le registre d'agents (trop risqué/régressif en V1).

---

## 2. Analyse de l'existant

### 2.1 Architecture RPC déjà en place

| Composant | Rôle | Fichier |
|---|---|---|
| `RpcSession` | Process enfant `pi --mode rpc` + stdin/stdout JSONL | `src-tauri/src/rpc_manager.rs` |
| `spawn_and_start` | Lance pi, démarre les threads stdout/stderr, émet sur un canal Tauri | `src-tauri/src/rpc_manager.rs` |
| `AppState.rpc_state` | Session RPC principale (chat agent + orchestration) | `src-tauri/src/lib.rs` |
| `AppState.rpc_reviewer` | **Session reviewer dédiée** (H2 V1) : 2e processus pi `--no-session` | `src-tauri/src/lib.rs` |
| Canal `rpc-event` | Événements session principale | frontend `agent-pi.js` |
| Canal `rpc-event-reviewer` | Événements session reviewer (pattern multi-sessions déjà posé) | frontend `agent-pi.js` |

Le reviewer H2 V1 est la preuve que le projet supporte déjà **plusieurs processus pi en parallèle**. Il suffit de généraliser ce pattern.

### 2.2 Mode Orchestration déjà très mature

Le mode orchestration (`spec_orchestration.md`) utilise **une seule session** et bascule entre deux modèles (orchestrateur cloud ↔ codeur local). Il gère déjà :

- planification JSON,
- découpage en micro-tâches,
- validation post-tâche,
- escalade,
- reviewer,
- auto-tests,
- snapshots,
- linting-in-the-loop.

Ce mode est **volontairement séquentiel** et mono-session. Il ne répond pas au besoin "agents qui s'appellent entre eux avec des rôles persistants", mais il fournit un trésor de fonctions pures réutilisables dans `src/js/orchestration.js` (arborescence projet, prompts structurés, parsing de marqueurs, etc.).

### 2.3 Commandes RPC disponibles

Le protocole pi RPC supporte : `new_session`, `set_model`, `prompt`, `abort`, `get_state`, `compact`, `get_available_models`, etc.

**Point clé** : il n'existe **pas** de commande `set_system_prompt` en RPC. Le rôle d'un agent doit donc être injecté dans **chaque prompt** envoyé (comme c'est déjà fait pour le codeur et le reviewer).

### 2.4 Stockage des modèles et rôles

- Le registre des modèles est dans `~/.{stem}/agent/models.json` ; chaque modèle a un champ `systemPrompt` optionnel (éditable via l'onglet Fournisseurs).
- Les alias/modèles par défaut sont dans `~/.{stem}/agent/model-switch.json`.
- La config Pilot (modèles orchestrateur/codeur/reviewer) est dans `AppConfig` (`src-tauri/src/lib.rs`) et lue/écrite via `settings.js`.
- Le registre d'agents doit être stocké dans un **dossier utilisateur Pilot** (`~/.pilot/`) afin d'être partagé entre projets. Ce dossier est distinct des dossiers backend `~/.pi` et `~/.plh`.
- Chaque agent référence un modèle au format `provider/modelId`. Comme Pilot peut fonctionner avec **deux backends** (`pi` et `plh`), chaque agent doit pouvoir décliner son modèle selon le backend actif.

**Conséquence** : un agent n'est pas un modèle (trop rigide). C'est une définition globale qui référence un modèle **par backend** (`models.pi` et `models.plh`) et qui préfixe chaque prompt avec son propre rôle. Au moment de l'appel, le bus choisit la clé correspondant à `backendKind()` (déjà présent dans `src/js/backend-info.js`).

### 2.5 Onglets spéciaux existants

`tabs.js` gère déjà des onglets non-fichiers : `agent`, `help`, `review`, `history`, `feedback`, `prompt-builder`, `terminal`. Le pattern est stable : un mode spécial + un module JS dédié + un bouton dans le panneau d'actions.

### 2.6 Cycle de vie et arrêt

- `stop_session` arrête proprement un processus pi.
- L'application arrête la session principale à la fermeture de l'onglet ou du projet.
- Le reviewer est lazy : démarré au 1er besoin, recyclé via `new_session`.

**Conséquence** : il faudra un arrêt global de tous les agents (`stop_all_agent_processes`) au changement/fermeture de projet ou à la fermeture de l'onglet Agents.

### 2.7 Porte pré-écriture (agents lecture-seule)

L'extension `pilot-edit-gate.ts` (cf. `spec_diff_review.md`) bloque les `write`/`edit` côté Pilot via `ctx.ui.confirm`. Pour des agents "lecture seule" (reviewer/doc), on peut soit s'en remettre au prompt, soit charger l'extension avec une politique "deny" automatique côté client RPC. Cette dernière option est une **V2**.

---

## 3. Architecture proposée

### 3.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│  Utilisateur — onglet 🎭 Agents                                         │
│  "Ajoute une API de recherche full-text à ce projet"                  │
└─────────────────────┬────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  COORDINATEUR (session longue, modèle puissant / orchestrateur)       │
│  Rôle : comprendre la demande, router, synthétiser.                 │
│  Contexte conservé pendant toute la run.                             │
└─────────────────────┬────────────────────────────────────────────────┘
                      │ [[CALL:architecte]] { task: "propose l'architecture" }
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  AGENT ARCHITECTE (session vierge à chaque appel)                     │
│  Rôle : produire une architecture / un plan technique.                │
│  Répond avec DONE: ... ou un autre [[CALL:...]]                      │
└─────────────────────┬────────────────────────────────────────────────┘
                      │ [[RESULT from architecte]] ...
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  COORDINATEUR reçoit le résultat, décide de la suite                 │
│  [[CALL:codeur]] { task: "implémente la route /search" }             │
└─────────────────────┬────────────────────────────────────────────────┘
                      ▼
              ... codeur → coordinateur → reviewer → coordinateur ...
```

### 3.2 Principes directeurs

1. **Une session pi par agent** (généralisation du reviewer). Contextes séparés, pas de contamination.
2. **Coordinateur en session longue**, sous-agents en contexte vierge à chaque appel. Cela évite l'accumulation de bruit dans les agents spécialisés.
3. **Bus frontend** : Pilot (JS) est l'ordonnanceur. Il parse les marqueurs d'appel, route les briefs et renvoie les résultats.
4. **Protocole texte structuré** : marqueurs `[[CALL:agent_id]]` + JSON, réponse `[[RESULT from agent_id]]`. Même philosophie que `DONE:` / `NEED_HELP:` / `APPROVED:`.
5. **Séquentiel en V1** : un seul agent stream à la fois. Simplifie drastiquement la gestion des erreurs, des outils et de l'UI.
6. **Réutilisation maximale** de `orchestration.js` pour les prompts, l'arborescence projet, le parsing de marqueurs, etc.

### 3.3 Alternative écartée : mono-session + bascule de modèle

On pourrait imaginer réutiliser le mode orchestration existant et créer des "rôles" comme des modèles. Cette option est écartée car :

- un seul contexte partagé → contamination entre rôles ;
- impossible d'avoir un coordinateur avec mémoire de la run et des sous-agents avec contexte vierge ;
- pas de véritable parallélisme possible plus tard.

---

## 4. Format des données

### 4.1 Définition d'un agent — `~/.pilot/agents.json`

Fichier versionné au niveau **global** (dossier utilisateur Pilot). Exemple sous Windows : `C:\Users\pldistance\.pilot\agents.json`. Exemple Unix : `~/.pilot/agents.json`. Les agents définis ici sont disponibles dans **tous** les projets ouverts avec Pilot.

```json
{
  "version": 1,
  "updated_at": "2026-08-10T12:00:00Z",
  "agents": [
    {
      "id": "coordinateur",
      "name": "Coordinateur",
      "icon": "🧠",
      "description": "Pilote l'équipe d'agents, comprend la demande utilisateur et route les tâches.",
      "role": "Tu es le chef d'orchestre d'une équipe d'agents de codage. Tu ne codes pas toi-même. Tu délègues chaque sous-tâche à l'agent spécialisé adapté via [[CALL:agent_id]] ... Tu synthétises les résultats et réponds à l'utilisateur.",
      "models": {
        "pi": "deepseek/deepseek-chat",
        "plh": "deepseek/deepseek-chat"
      },
      "capabilities": ["delegate", "synthesize"],
      "readonly": false,
      "keep_context": true,
      "max_calls_per_run": 20,
      "call_depth": 0
    },
    {
      "id": "architecte",
      "name": "Architecte",
      "icon": "🏗️",
      "description": "Conçoit l'architecture et découpe le travail en petites tâches techniques.",
      "role": "Tu es un architecte logiciel. Tu proposes une architecture concise, des fichiers concernés et un découpage. Tu ne modifies jamais le code. Tu réponds uniquement par DONE: ...",
      "models": {
        "pi": "deepseek/deepseek-chat",
        "plh": "openrouter/anthropic/claude-sonnet-4"
      },
      "capabilities": ["design"],
      "readonly": true,
      "keep_context": false,
      "max_calls_per_run": 5,
      "call_depth": 1
    },
    {
      "id": "codeur",
      "name": "Codeur",
      "icon": "🔨",
      "description": "Écrit et modifie le code du projet.",
      "role": "Tu es un développeur. Tu exécutes la micro-tâche reçue. Tu lis les fichiers avec les outils à ta disposition. Tu modifies UNIQUEMENT les fichiers nécessaires. Termine par DONE: <résumé>.",
      "models": {
        "pi": "llamacpp/qwen2.5-coder-7b",
        "plh": "ollama/qwen2.5-coder:7b"
      },
      "capabilities": ["write", "edit"],
      "readonly": false,
      "keep_context": false,
      "max_calls_per_run": 10,
      "call_depth": 1
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "icon": "🔍",
      "description": "Relit les modifications pour détecter régressions et bugs.",
      "role": "Tu es un reviewer indépendant. Tu ne modifies rien. Tu relis le code et réponds APPROVED: ... ou CHANGES_REQUESTED: ...",
      "models": {
        "pi": "deepseek/deepseek-chat",
        "plh": "openrouter/anthropic/claude-sonnet-4"
      },
      "capabilities": ["review"],
      "readonly": true,
      "keep_context": false,
      "max_calls_per_run": 5,
      "call_depth": 1
    },
    {
      "id": "testeur",
      "name": "Testeur",
      "icon": "🧪",
      "description": "Écrit et exécute les tests.",
      "role": "Tu écris des tests couvrant la fonctionnalité demandée. Tu utilises le runner du projet. Tu ne modifies pas le code métier. Termine par DONE: ... ou NEED_HELP: ...",
      "models": {
        "pi": "llamacpp/qwen2.5-coder-7b",
        "plh": "ollama/qwen2.5-coder:7b"
      },
      "capabilities": ["test"],
      "readonly": false,
      "keep_context": false,
      "max_calls_per_run": 5,
      "call_depth": 1
    },
    {
      "id": "documenteur",
      "name": "Documenteur",
      "icon": "📝",
      "description": "Rédige la documentation et les commentaires.",
      "role": "Tu rédiges la documentation utilisateur ou technique demandée. Tu ne modifies pas le code fonctionnel. Termine par DONE: ...",
      "models": {
        "pi": "llamacpp/qwen2.5-coder-7b",
        "plh": "ollama/qwen2.5-coder:7b"
      },
      "capabilities": ["doc"],
      "readonly": true,
      "keep_context": false,
      "max_calls_per_run": 5,
      "call_depth": 1
    }
  ]
}
```

### 4.2 Champs

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | string | oui | Identifiant machine (kebab-case, unique). |
| `name` | string | oui | Nom affiché. |
| `icon` | string | non | Emoji/icône affichée dans l'UI. |
| `description` | string | oui | Description fonctionnelle utilisée par le coordinateur pour router. |
| `role` | string | oui | Instructions système / rôle injecté en début de chaque prompt. |
| `models` | object | oui | `{ "pi": "provider/modelId", "plh": "provider/modelId" }`. Le backend actif détermine quelle clé est utilisée. |
| `models.pi` | string | non | Modèle à utiliser quand le backend actif est `pi`. Si vide, fallback sur `models.plh` puis sur le modèle par défaut du backend. |
| `models.plh` | string | non | Modèle à utiliser quand le backend actif est `plh`. Si vide, fallback sur `models.pi` puis sur le modèle par défaut du backend. |
| `capabilities` | string[] | non | Tags internes (lecture/écriture/design/etc.). |
| `readonly` | bool | non | `true` → agent qui ne doit pas écrire (prompt + mécanisme futur). |
| `keep_context` | bool | non | `true` → ne pas faire `new_session` entre deux appels du même agent. |
| `max_calls_per_run` | int | non | Limite d'appels pour cet agent dans une run. |
| `call_depth` | int | non | Profondeur max à laquelle cet agent peut être appelé (0 = coordinateur, 1 = worker). |

### 4.3 Manifeste injecté dans le coordinateur

Pour que le coordinateur sache quels agents existent, Pilot construit un manifeste à partir du JSON :

```
Agents disponibles :
- architecte : Conçoit l'architecture et découpe le travail en petites tâches techniques.
- codeur : Écrit et modifie le code du projet.
- reviewer : Relit les modifications pour détecter régressions et bugs.
- testeur : Écrit et exécute les tests.
- documenteur : Rédige la documentation et les commentaires.

Pour appeler un agent, termine ta réponse par exactement :
[[CALL:agent_id]]
{
  "task": "description précise et atomique",
  "files": ["chemin/relatif/optionnel"],
  "context": "tout contexte utile"
}
[[/CALL]]
```

### 4.4 Protocole d'appel inter-agents

#### 4.4.1 Appel sortant (dans la réponse d'un agent)

```text
Voici mon analyse. Je vais maintenant demander au codeur d'implémenter la route.

[[CALL:codeur]]
{
  "task": "Crée la route GET /api/search dans src/routes/search.js. Elle accepte q, offset, limit et renvoie un JSON {results, total}.",
  "files": ["src/routes/search.js", "src/models/index.js"],
  "context": "Utilise Express. Le modèle Index est supposé déjà créé par l'architecte."
}
[[/CALL]]
```

Règles du parsing :
- prendre le **dernier** bloc `[[CALL:...]]` de la réponse (comme pour `DONE:`) ;
- agent_id validé contre le registre ;
- JSON optionnel ; s'il est invalide, le brief reste le texte entre `[[CALL]]` et `[[/CALL]]` ;
- un seul appel par réponse en V1.

#### 4.4.2 Résultat renvoyé à l'appelant

Après exécution de l'agent cible, Pilot envoie un nouveau prompt à l'appelant :

```text
[[RESULT from codeur (status: done)]]
DONE: Route GET /api/search créée dans src/routes/search.js avec validation des paramètres.
[[/RESULT]]
```

- `status` : `done`, `need_help`, `timeout`, `error`.
- Le contenu est tronqué si nécessaire (budget tokens configurable, ex. 4000 tokens).
- L'appelant reçoit ce résultat comme un message utilisateur dans sa session.

### 4.5 Journal de run — `.pilot/agents-run.jsonl` (optionnel V1)

Pour permettre la reprise après crash :

```json
{"ts":"2026-08-10T12:01:00Z","type":"call","from":"coordinateur","to":"architecte","task":"..."}
{"ts":"...","type":"result","from":"architecte","to":"coordinateur","summary":"..."}
```

V1 : simple log append-only. La reprise complète est une **V2**.

---

## 5. Décisions techniques détaillées

### 5.1 Backend : gestionnaire multi-sessions

Généraliser `rpc_reviewer` en un `HashMap<String, RpcSession>` :

```rust
// Dans AppState
agent_sessions: Mutex<HashMap<String, rpc_manager::RpcSession>>,
```

`rpc_state` (session principale) et `rpc_reviewer` (reviewer de l'orchestration) restent **intacts** pour ne pas régresser.

Canal d'événements : utiliser **un seul canal** `rpc-event-agents` avec une enveloppe `{agent_id, event}` plutôt que N canaux dynamiques. Cela simplifie le frontend et évite de multiplier les listeners Tauri.

#### Dossier global du registre

Le registre d'agents est stocké dans le **dossier utilisateur Pilot** :

- Windows : `%USERPROFILE%\.pilot\` (ex. `C:\Users\pldistance\.pilot\`)
- macOS / Linux : `~/.pilot/`

Ce dossier est **distinct** de `~/.pi` et `~/.plh` (config des backends).  
Une fonction Rust cross-platform calcule ce chemin (ex. via `dirs::home_dir()` + `.pilot`, ou l'équivalent Tauri). Les commandes `load_agent_registry` / `save_agent_registry` n'ont pas besoin de recevoir un `project_path` : elles résolvent le chemin globalement.

### 5.2 Commandes Tauri à ajouter

Toutes en `snake_case` comme les commandes existantes.

| Commande | Description |
|---|---|
| `start_agent_process(agent_id, cwd, pi_path, no_session)` | Démarre un processus pi pour l'agent s'il n'existe pas. |
| `stop_agent_process(agent_id)` | Arrête le processus d'un agent. |
| `stop_all_agent_processes()` | Arrête tous les agents (fermeture onglet / projet). |
| `send_agent_process_prompt(agent_id, message)` | Envoie un prompt à l'agent. |
| `new_agent_process_session(agent_id)` | `new_session` pour l'agent cible. |
| `set_agent_process_model(agent_id, provider, model_id)` | Bascule le modèle d'un agent. |
| `abort_agent_process(agent_id)` | Annule le tour en cours d'un agent. |
| `get_agent_process_state(agent_id)` | État streaming/modèle d'un agent. |
| `load_agent_registry()` | Lit `~/.pilot/agents.json`. Crée le dossier et le fichier par défaut s'ils n'existent pas. |
| `save_agent_registry(registry)` | Écrit `~/.pilot/agents.json` (backup `.bak`). |

### 5.3 Frontend : modules

| Fichier | Rôle |
|---|---|
| `src/js/agents.js` | Fonctions pures : chargement du registre, construction du manifeste, parsing des marqueurs `[[CALL]]` / `[[RESULT]]`, prompts, troncature, garde-fous. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents : liste, formulaire d'édition, chat, panneau d'activité. |
| `src/js/agents-bus.js` | **Bus d'exécution** : orchestre les appels, la pile, les timeouts, les envois/réceptions, la gestion des erreurs. Dépend de `agents.js` et des commandes Tauri. |
| `src/js/agents.css` ou styles dans `style.css` | Badges, couleurs d'agent, panneau d'activité. |

### 5.4 Coordinateur implicite

Pas besoin de définir un agent "coordinateur" dans le JSON si l'utilisateur ne le souhaite pas. Pilot fournit un **agent coordinateur par défaut** (non modifiable en V1) qui :

- décline son modèle selon le backend actif (`models.pi` et `models.plh`) — fallback sur le modèle par défaut du backend si les deux sont vides ;
- a un rôle système fixe listant les agents disponibles et le protocole `[[CALL]]` ;
- garde le contexte pendant toute la run.

L'utilisateur peut aussi créer son propre coordinateur dans `~/.pilot/agents.json` pour le personnaliser.

### 5.5 Gestion des modèles par backend

La résolution d'un modèle d'agent se fait en deux étapes :

1. **Détection du backend actif** via `backendKind()` déjà présent dans `src/js/backend-info.js` (renvoie `"pi"`, `"plh"` ou `"unknown"`).
2. **Sélection du modèle** :
   - utilise `models.{backend}` s'il est renseigné ;
   - sinon fallback sur l'autre backend (`models.pi` ↔ `models.plh`) ;
   - sinon fallback sur le modèle par défaut du backend courant (`defaultModel` de `model-switch.json`) ;
   - sinon modèle actuellement sélectionné dans l'onglet Agent Pi.

La commande `set_agent_process_model` reçoit alors le `provider/modelId` résolu. Si `set_model` échoue (modèle invalide/injoignable), la run s'arrête avec un message explicite.

L'UI d'édition d'un agent affiche **deux selecteurs de modèle** côte à côte : un pour `pi`, un pour `plh`, pré-remplis avec les alias disponibles pour le backend correspondant.

### 5.6 Agents prédéfinis

À la première ouverture de l'onglet Agents, si `~/.pilot/agents.json` n'existe pas, Pilot crée le dossier `~/.pilot/` et le fichier avec les 6 agents prédéfinis. Les modèles sont pré-remplis avec :

- `models.pi` : ceux déjà configurés dans Pilot (orchestrateur pour architecte/reviewer, codeur pour codeur/testeur/documenteur, coordinateur).
- `models.plh` : copiés depuis `models.pi` par défaut (l'utilisateur les ajustera ensuite).

### 5.7 Garde-fous

| Garde-fou | Valeur / Comportement |
|---|---|
| Profondeur max d'appel | 3 par défaut (configurable). Empêche A→B→C→D. |
| Budget d'appels total | 30 par run par défaut. |
| Budget par agent | `max_calls_per_run` de l'agent. |
| Timeout d'inactivité | 120 s par défaut, reset à chaque `text_delta` (même logique que l'orchestration). |
| Détection de cycle | Interdit de rappeler un agent déjà dans la pile (A→B→A). |
| Stop global | Bouton "⏹ Arrêter" tue tous les tours en cours et vide la pile. |
| Permission d'appel | Le coordinateur ne peut appeler que des agents avec `call_depth >= current_depth + 1`. |

### 5.8 Contexte et mémoire

- **Coordinateur** : contexte conservé (peut compacter automatiquement comme le chat classique).
- **Sous-agents** : `new_session` avant chaque appel, sauf si `keep_context: true`.
- **Résultats renvoyés** : tronqués pour rester dans le contexte du coordinateur (utiliser `estimateTokens` d'`orchestration.js`).

### 5.9 Agents lecture-seule

V1 : la propriété `readonly` est injectée dans le rôle ("Tu ne modifies jamais le code.") et affichée dans l'UI. V2 : charger l'extension `pilot-edit-gate` avec politique "deny" pour bloquer physiquement les writes.

---

## 6. Interface utilisateur

### 6.1 Bouton dans le panneau d'actions

Ajouter à côté du bouton Agent Pi / Prompt Builder un bouton **"🎭 Agents"** dans `index.html` + écouteur dans `main.js`.

### 6.2 Onglet "🎭 Agents"

Layout en trois colonnes (desktop) / empilé (mobile) :

```
┌─────────────────┬──────────────────────────────┬────────────────────┐
│ Liste d'agents  │  Zone de chat multi-agents   │ Panneau d'activité │
│ + formulaire    │  (badges colorés par agent)  │ (pile, statut,     │
│ d'édition       │                              │  budgets, stop)     │
└─────────────────┴──────────────────────────────┴────────────────────┘
```

#### Colonne gauche — Registre

- Carte par agent (icône, nom, modèles pi/plh, badge lecture-seule).
- Bouton "Ajouter un agent".
- Formulaire d'édition inline :
  - nom, id, description, rôle (textarea) ;
  - **deux selecteurs de modèle** : un pour `pi`, un pour `plh` ;
  - lecture-seule, contexte conservé.
- Bouton "Réinitialiser les agents par défaut" (réécrit `~/.pilot/agents.json`).

#### Colonne centrale — Chat

- Messages utilisateur en bulle bleue.
- Messages agents en bulles distinctes avec en-tête `🧠 Coordinateur`, `🔨 Codeur`, etc.
- Transitions "🧠 Coordinateur → 🔨 Codeur" affichées comme messages système.
- Zone de saisie en bas.

#### Colonne droite — Activité

- Pile d'appels actuelle.
- Nombre d'appels consommés / restants.
- Profondeur actuelle.
- Boutons : ⏹ Arrêter, 🔄 Relancer la dernière demande.

### 6.3 Paramètres

Nouveau bloc "Agents" dans la modale Paramètres (`settings.js` + `index.html`) :

- Modèle par défaut du coordinateur (fallback si non défini dans `~/.pilot/agents.json`).
- Profondeur max d'appel.
- Budget total d'appels par run.
- Timeout d'inactivité.
- Taille max du résultat renvoyé (en tokens).
- Checkbox "Activer le mode Agents" (conditionne l'affichage du bouton et de l'onglet).

### 6.4 Feedback visuel

- Badge "En réflexion..." sur l'agent actif.
- Barre de progression si une longue séquence est en cours.
- Message système si un garde-fou déclenche une interruption.

---

## 7. Plan d'implémentation

### Phase 0 — Spécifications et maquette

- [ ] **0.1** Valider ce plan avec l'utilisateur (si applicable).
- [ ] **0.2** Créer `spec_gestion_agents.md` avec les détails fonctionnels, le protocole `[[CALL]]`, les garde-fous et la compatibilité (source de vérité long terme).
- [ ] **0.3** Mettre à jour `plan_dev.md` : ajouter "Gestion d'agents (H2 V2)" dans la roadmap.
- [ ] **0.4** Mettre à jour `AGENTS.md` : ajouter `spec_gestion_agents.md` dans la table de navigation rapide.
- [ ] **0.5** Ajouter / mettre à jour le bloc `<!-- HELP:agents -->` dans `spec_gestion_agents.md` puis regénérer `help/handbook.md` via `npm run build:handbook`.

### Phase 1 — Backend : socle multi-sessions

- [ ] **1.1** Modifier `src-tauri/src/lib.rs` :
  - [ ] Ajouter `agent_sessions: Mutex<HashMap<String, rpc_manager::RpcSession>>` dans `AppState`.
  - [ ] Conserver `rpc_state` et `rpc_reviewer` intacts.
  - [ ] Ajouter les champs `AppConfig` nécessaires au mode Agents (coordinateur par défaut, profondeur max, budget, timeout, max result tokens, agents_enabled).
- [ ] **1.2** Généraliser `rpc_manager.rs` si besoin :
  - [ ] Vérifier que `spawn_and_start` accepte déjà un canal personnalisé (oui) ; sinon le rendre paramétrable.
  - [ ] Ajouter un helper `emit_agent_event(agent_id, event)` si on choisit l'enveloppe unique.
- [ ] **1.3** Implémenter les commandes Tauri :
  - [ ] `start_agent_process`
  - [ ] `stop_agent_process`
  - [ ] `stop_all_agent_processes`
  - [ ] `send_agent_process_prompt`
  - [ ] `new_agent_process_session`
  - [ ] `set_agent_process_model`
  - [ ] `abort_agent_process`
  - [ ] `get_agent_process_state`
- [ ] **1.4** Implémenter les commandes de registre :
  - [ ] `load_agent_registry`
  - [ ] `save_agent_registry`
- [ ] **1.5** Arrêt propre :
  - [ ] Appeler `stop_all_agent_processes` à la fermeture de l'onglet Agents.
  - [ ] Appeler `stop_all_agent_processes` au changement/fermeture de projet.
  - [ ] S'assurer que `stop_all_agent_processes` est aussi appelé à la fermeture de l'application.
- [ ] **1.6** Enregistrer les nouvelles commandes dans `generate_handler!` de `main.rs` / `lib.rs`.

### Phase 2 — Registre d'agents et modèles

- [ ] **2.1** Créer `src/js/agents.js` (fonctions pures) :
  - [ ] `loadAgentRegistry()` : appelle `load_agent_registry`, valide le JSON, fallback vers agents par défaut. Le chemin global est résolu côté Rust.
  - [ ] `saveAgentRegistry(registry)`.
  - [ ] `normalizeAgent(agent)` : valeurs par défaut, notamment `models = { pi: "", plh: "" }` si absent.
  - [ ] `resolveAgentModel(agent, backendKind, fallbackModel)` : choisit `models.{backend}`, fallback croisé, fallback modèle par défaut.
  - [ ] `buildCoordinatorManifest(agents)` : liste des agents avec descriptions pour le prompt coordinateur.
  - [ ] `buildAgentPrompt(agent, taskBrief, projectContext, backendKind)` : préfixe le rôle + injecte le brief.
  - [ ] `buildResultPrompt(fromAgentId, status, text, maxTokens)` : formate `[[RESULT]]`.
  - [ ] `parseCallMarker(text)` : extrait le dernier `[[CALL:...]]...[[/CALL]]`.
  - [ ] `parseResultMarker(text)` : parsing inverse (utile pour debug).
  - [ ] `getDefaultAgents(orchestratorPiModel, orchestratorPlhModel, coderPiModel, coderPlhModel)` : génère les 6 agents par défaut avec des blocs `models` pour les deux backends.
  - [ ] `truncateForContext(text, maxTokens)` : réutilise `estimateTokens` de `orchestration.js`.
- [ ] **2.2** Créer les agents par défaut avec des rôles solides et des exemples d'appels.
- [ ] **2.3** Charger les alias/modèles disponibles pour **les deux backends** (`pi` et `plh`) afin de peupler les deux selecteurs de modèle dans l'UI. Utiliser `read_model_aliases(stem)` / `list_agent_backends` existants.
- [ ] **2.4** Valider le format de chaque modèle (`provider/modelId`) à la sauvegarde (même logique que `settings.js`).

### Phase 3 — Bus d'exécution inter-agents

- [ ] **3.1** Créer `src/js/agents-bus.js` :
  - [ ] État de la run : `callStack`, `callBudget`, `timeouts`, `abortController`, `runState`.
  - [ ] `startRun(userPrompt, coordinatorAgent, registry)` : lance le coordinateur avec le manifeste.
  - [ ] `dispatchCall(fromAgentId, callPayload)` : démarre/reset l'agent cible, envoie le brief, attend `agent_end`.
  - [ ] `returnResult(toAgentId, result)` : envoie le résultat à l'appelant.
  - [ ] Garde-fous intégrés : profondeur, budget, cycle, timeout.
  - [ ] `stopRun()` : vide la pile, abort tous les tours.
- [ ] **3.2** Gérer les événements `rpc-event-agents` : router vers l'agent actif pour streaming et `agent_end`.
- [ ] **3.3** Gérer les erreurs de connexion d'un agent (même logique que `auto_retry_start` dans `agent-pi.js`).
- [ ] **3.4** Compaction : filtrer les deltas pendant `compaction_start`/`compaction_end` (réutiliser le fix de `agent-pi.js`).
  - [x] **Fait (2026-08)** : `agents-bus.js` — `isCompacting` activé sur `compaction_start`, reset + vidage de `streamingText` sur `compaction_end`/`compaction` ; deltas ignorés pendant la compaction (même logique qu'`agent-pi.js`) pour ne pas polluer `parseCallMarker` (`[[CALL]]`). Reset de sécurité `isCompacting` au début de chaque tour (`runAgentTurn`).

### Phase 4 — Interface de l'onglet Agents

- [ ] **4.1** Ajouter le bouton "🎭 Agents" dans `index.html` (panneau d'actions).
- [ ] **4.2** Brancher le bouton dans `main.js` : `tabs.openFile("Agents", "agents")`.
- [ ] **4.3** Étendre `tabs.js` :
  - [ ] Reconnaître `mode === "agents"`.
  - [ ] Implémenter `_openAgents(name)` qui charge `agents-ui.js` et gère le cycle de vie (start/stop listener).
- [ ] **4.4** Créer `src/js/agents-ui.js` :
  - [ ] `createAgentsContainer(container)` : layout 3 colonnes.
  - [ ] Rendu de la liste des agents (lecture/édition/ajout/suppression).
  - [ ] Zone de chat avec streaming et badges par agent.
  - [ ] Panneau d'activité (pile, budgets, stop).
  - [ ] Bouton "Relancer".
- [ ] **4.5** Ajouter les styles CSS dans `src/css/style.css` (badges, couleurs, panneau).
- [ ] **4.6** Ajouter le bloc de paramètres Agents dans `index.html`.
- [ ] **4.7** Brancher la lecture/écriture des nouveaux champs dans `settings.js`.

### Phase 5 — Intégration Coordinateur / Sous-agents

- [ ] **5.1** Implémenter l'agent coordinateur par défaut (implicite) avec un rôle robuste.
- [ ] **5.2** Permettre à l'utilisateur de désigner un agent du registre comme coordinateur.
- [ ] **5.3** Implémenter la logique "agent appelant reçoit le résultat et continue" : boucle jusqu'à réponse finale à l'utilisateur (pas de `[[CALL]]` dans la réponse).
- [ ] **5.4** Afficher les transitions dans le chat : "🧠 Coordinateur appelle 🔨 Codeur".
- [ ] **5.5** Afficher les résultats retournés sous forme de messages système repliables.

### Phase 6 — Garde-fous, robustesse, lifecycle

- [ ] **6.1** Profondeur max : bloquer et afficher un message si dépassée.
- [ ] **6.2** Budget d'appels : compteurs par run + par agent.
- [ ] **6.3** Détection de cycle : refuser un appel si l'agent cible est déjà dans la pile.
- [ ] **6.4** Timeout d'inactivité par agent (reset sur `text_delta`).
- [ ] **6.5** Bouton "⏹ Arrêter" accessible en permanence.
- [ ] **6.6** Nettoyage des processus à la fermeture de l'onglet / projet / application.
- [ ] **6.7** Gestion du crash d'un process agent : fallback message d'erreur + arrêt de la run.

### Phase 7 — Vérifications et documentation

- [ ] **7.1** Relire tous les fichiers modifiés en entier (protocole quality-gate).
- [ ] **7.2** Vérifier les points de connexion : imports, commandes Tauri enregistrées, listeners, boutons, paramètres.
- [ ] **7.3** Lancer `npm run build:handbook`.
- [ ] **7.4** Lancer `npm run tauri dev` et tester :
  - [ ] Création des agents par défaut.
  - [ ] Édition d'un agent.
  - [ ] Demande simple au coordinateur.
  - [ ] Appel codeur + retour au coordinateur.
  - [ ] Appel reviewer.
  - [ ] Stop global.
  - [ ] Fermeture/re-ouverture de l'onglet.
- [ ] **7.5** S'assurer que l'onglet Agent Pi / Mode Orchestration / Reviewer existants fonctionnent toujours (anti-régression).

---

## 8. Fichiers impactés

### Nouveaux fichiers

| Fichier | Rôle |
|---|---|
| `spec_gestion_agents.md` | Spécifications fonctionnelles détaillées. |
| `plan_gestion_agents.md` | Ce plan (déjà créé). |
| `src/js/agents.js` | Fonctions pures du registre et du protocole. |
| `src/js/agents-bus.js` | Bus d'exécution inter-agents. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents. |

### Fichiers modifiés

| Fichier | Changements |
|---|---|
| `src-tauri/src/lib.rs` | `AppState.agent_sessions`, nouveaux champs `AppConfig`, commandes Tauri agents, helper `pilot_user_dir()` pour `~/.pilot`. |
| `src-tauri/src/main.rs` | Enregistrement des nouvelles commandes dans `generate_handler!`. |
| `src-tauri/src/rpc_manager.rs` | Éventuel helper d'émission multi-agents (si enveloppe unique). |
| `src/js/tabs.js` | Mode `agents` + `_openAgents`. |
| `src/js/main.js` | Écouteur bouton "🎭 Agents" + démarrage conditionnel. |
| `src/js/settings.js` | Champs mode Agents. |
| `src/css/style.css` | Styles de l'onglet Agents. |
| `index.html` | Bouton Agents + champs settings. |
| `plan_dev.md` | Mise à jour roadmap. |
| `AGENTS.md` | Navigation rapide + référence. |
| `help/handbook.md` | Regénéré via `npm run build:handbook`. |

### Fichiers à ne PAS toucher en V1

- `src/js/agent-pi.js` (chat / orchestration) : gardé intact.
- `src/js/orchestration.js` : réutilisé en lecture seule.
- `src/js/orchestration-reviewer.js` : intact.
- `src-tauri/src/review.rs` : intact.

---

## 9. Anti-régression et points d'attention

### 9.1 Risques principaux

| Risque | Mitigation |
|---|---|
| Multiplication des processus pi → RAM/CPU | Agents lazy + `stop_all_agent_processes` à la fermeture. V1 séquentiel. |
| Contamination des canaux d'événements | Canal `rpc-event-agents` avec enveloppe `agent_id`. Pas d'interférence avec `rpc-event` ni `rpc-event-reviewer`. |
| Boucle infinie d'appels | Profondeur max, budget, détection de cycle, timeout, stop global. |
| Régression orchestration existante | Ne pas toucher à `rpc_state`, `agent-pi.js`, `orchestration.js`. Les nouveaux modules sont parallèles. |
| Modèle invalide d'un agent | Vérification `set_agent_model` + message explicite + arrêt run. |
| Fuite de processus | `stop_all_agent_processes` appelé dans tous les cas de fermeture. |
| Dossier `~/.pilot` inaccessible ou mal résolu | Utiliser une bibliothèque cross-platform (Tauri `home_dir` / `dirs`) + fallback message d'erreur. Ne jamais coder de chemin en dur. |

### 9.2 Checklist quality-gate (à suivre par l'agent de codage)

- [ ] Avant modification : lire intégralement les fichiers du composant.
- [ ] Avant modification : cartographier imports, exports, appels, événements.
- [ ] Avant modification : lister ce qui doit continuer à fonctionner (RPC principal, orchestration, reviewer, help, review, history, feedback).
- [ ] Après modification : relire chaque fichier modifié en entier.
- [ ] Après modification : vérifier chaque point de connexion.
- [ ] Après modification : vérifier les branchements des nouveaux composants (création, import, enregistrement commandes, écouteurs, boutons, paramètres, docs).
- [ ] Après modification : annoncer explicitement les vérifications effectuées.

---

## 10. Commandes à exécuter

```bash
# Développement / test après implémentation
npm run tauri dev

# Regénérer l'aide intégrée après mise à jour des blocs HELP
npm run build:handbook

# Build production (après validation manuelle)
npm run tauri build
```

---

## 11. Livrables attendus

À la fin de l'implémentation, le projet doit permettre :

1. D'ouvrir l'onglet **🎭 Agents** depuis le panneau d'actions.
2. De visualiser/éditer/créer des agents dans **`~/.pilot/agents.json`** (dossier utilisateur Pilot, partagé entre les projets).
3. D'envoyer une demande à l'agent coordinateur.
4. De voir le coordinateur appeler des agents spécialisés (`🔨 Codeur`, `🔍 Reviewer`, etc.).
5. De voir les agents retourner leurs résultats au coordinateur.
6. D'obtenir une réponse finale synthétisée à l'utilisateur.
7. D'arrêter proprement une run en cours.
8. De ne pas avoir cassé l'Agent Pi, le Mode Orchestration, le Reviewer, l'Aide, l'Historique ni le Feedback.
9. De constater que le bon modèle (`pi` vs `plh`) est automatiquement sélectionné selon le backend actif.

---

## 12. Notes pour l'agent de codage

- **Langue** : code et commentaires en anglais ; communication avec l'utilisateur en français.
- **Conventions de nommage** :
  - Commandes Rust : `snake_case` (`start_agent_process`).
  - Fonctions JS : `camelCase` (`startAgentRun`).
  - Fichiers JS : `kebab-case` (`agents-bus.js`).
- **Ne pas implémenter le parallélisme en V1** : c'est explicitement reporté.
- **Réutiliser** `estimateTokens`, `filterTree`, `buildTreeString` de `orchestration.js` au lieu de les réimplémenter.
- **Tester avec des modèles réels** dès que possible ; les marqueurs `[[CALL]]` doivent être suffisamment contraignants dans le prompt pour que les LLMs les respectent.
- **Version** : ne pas bumper la version dans ce plan (la publication est une décision utilisateur explicite selon `AGENTS.md`).

---

*Dernière mise à jour : analyse effectuée sur la base du code existant de Pilot (Tauri v2 + JS + orchestration V3 + reviewer H2 V1).*