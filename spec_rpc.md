# Évolution RPC — Intégration de l'agent de codage Pi dans Pilot

> Document d'analyse et de planification — Version mise à jour le 2026-05-27
>
> **Statut global : ✅ Implémenté (étapes 1–6 terminées)**

---

## 1. Objectif

Intégrer l'agent de codage **Pi** (pi.dev) dans l'éditeur Pilot, pour que l'utilisateur puisse dialoguer avec l'IA directement depuis l'interface, dans un onglet dédié (type "chat agent"), sans avoir à ouvrir un terminal externe ni à quitter Pilot.

Le mode **RPC** (Remote Procedure Call) de Pi est la voie privilégiée : il permet de piloter Pi en arrière-plan via un protocole JSON/JSONL sur stdin/stdout, sans interface graphique.

---

## 2. Fonctionnement du mode RPC (résumé)

```
┌──────────┐  stdin (commandes JSON)   ┌──────────────┐
│  Pilot   │ ─────────────────────────▶│  pi --mode   │
│ (Rust)   │◀───────────────────────── │     rpc       │
└──────────┘  stdout (événements JSON) └──────────────┘
```

- **Commandes** (Pilot → Pi) : envoyées sur stdin, une ligne JSON par commande.
- **Réponses** (Pi → Pilot) : `{"type": "response", "command": "...", "success": true/false}`
- **Événements** (Pi → Pilot) : streaming asynchrone sur stdout pendant les tours d'agent (`message_update`, `tool_execution_start`, `agent_end`, etc.)

---

## 3. Architecture implémentée

```
┌─ Frontend (HTML/JS) ───────────────────────────────────────┐
│  agent-pi.js                                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Onglet "Agent Pi" (π)                               │  │
│  │  ├─ Barre d'outils : ⏹️ abort, ➕ new, 📦 compact     │  │
│  │  │   sélecteur modèle, stats tokens/coût, statut     │  │
│  │  ├─ Zone de chat scrollable                          │  │
│  │  │   ├─ Messages utilisateur (bulle bleue)           │  │
│  │  │   ├─ Réponses assistant (Markdown streaming)     │  │
│  │  │   ├─ Pensées (bloc <details> repliable)           │  │
│  │  │   └─ Outils (tool calls avec sortie)              │  │
│  │  └─ Barre de saisie (Enter/Shift+Enter)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │ Tauri events / invoke             │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌─ Backend (Rust/Tauri) ───┼──────────────────────────────────┐
│  lib.rs (15 commandes Tauri)                                │
│  ├─ start_agent_session    ├─ new_agent_session              │
│  ├─ stop_agent_session     ├─ get_agent_messages             │
│  ├─ send_agent_prompt      ├─ set_agent_model                │
│  ├─ abort_agent            ├─ list_agent_models              │
│  ├─ get_agent_state        ├─ execute_agent_bash             │
│  ├─ get_session_stats      ├─ compact_agent_context          │
│  └─ send_rpc_command (debug)                                │
│                           │                                  │
│  rpc_manager.rs           │                                  │
│  ├─ RpcSession { child, stdin, running }                    │
│  ├─ spawn_and_start(cwd, pi_path, no_session, session_dir)  │
│  ├─ send_command() / send_command_sync()                    │
│  ├─ stop_session()                                          │
│  ├─ read_jsonl_loop() (thread stdout → emit "rpc-event")    │
│  └─ Événement process_exit si crash                         │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────┐   │
│  │  Processus enfant `pi --mode rpc [--no-session] [--session-dir]` │   │
│  │  - stdin/stdout JSONL                               │   │
│  │  - cwd = dossier du projet ouvert                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Paramètres utilisateur

| Paramètre | Type | UI | Description |
|-----------|------|----|-------------|
| `rpc_agent_enabled` | bool | Checkbox | Active la gestion RPC (remplace terminal agent) |
| `rpc_pi_path` | string | Champ texte | Chemin vers l'exécutable pi (vide = "pi" dans PATH) |
| `rpc_no_session` | bool | Checkbox | Passe `--no-session` à pi (pas de persistance disque) |
| `rpc_session_dir` | string | Champ texte | Dossier personnalisé pour les sessions (vide = ~/.pi/agent/sessions) |
| `show_thinking` | bool | Checkbox | Affiche les pensées (thinking) de l'agent dans le chat |

---

## 5. Commandes Tauri implémentées

| Commande | Type | Description |
|----------|------|-------------|
| `start_agent_session` | async | Lance `pi --mode rpc [+ --no-session]` dans le cwd du projet |
| `stop_agent_session` | async | Tue le processus pi proprement |
| `send_agent_prompt` | async | Envoie un message à l'agent avec images optionnelles |
| `abort_agent` | async | Annule l'opération en cours |
| `new_agent_session` | async | Démarre une nouvelle session |
| `get_agent_state` | sync | Récupère l'état actuel (modèle, streaming, nombre de messages) |
| `get_session_stats` | sync | Récupère les stats tokens/coûts |
| `get_agent_messages` | sync | Récupère tout l'historique de conversation |
| `set_agent_model` | async | Change le modèle (provider + modelId) |
| `list_agent_models` | sync | Liste les modèles disponibles (via `get_available_models` RPC) |
| `execute_agent_bash` | sync | Exécute une commande shell dans le contexte de l'agent |
| `compact_agent_context` | async | Compacte le contexte pour réduire les tokens |
| `list_agent_commands` | sync | Liste les commandes slash disponibles (mode RPC pi) |
| `list_sessions` | sync | Liste les sessions enregistrées pour le projet courant |
| `resume_agent_session` | async | Charge/reprend une session à partir de son fichier JSONL |
| `send_rpc_command` | async | Envoie une commande JSON brute (debug) |

---

## 6. Événements RPC gérés par le frontend

| Événement | Traitement |
|-----------|------------|
| `agent_start` | Statut → "En réflexion...", streaming activé |
| `agent_end` | Statut → "Prêt", mise à jour des stats tokens/coûts |
| `message_start` / `message_update` / `message_end` | Streaming du texte de l'assistant (Markdown) |
| `thinking_start` / `thinking_delta` / `thinking_end` | Bloc `<details>` repliable pour la pensée |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Bloc outil avec nom, arguments, sortie |
| `text_start` / `text_delta` / `text_end` | Streaming du texte dans le bloc message |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | Streaming des appels d'outils |
| `compaction_start` / `compaction_end` | Message système "Compaction..." |
| `queue_update` | Non traité (log console) |
| `model_change` | Met à jour le sélecteur de modèle et les stats |
| `extension_error` | Message d'erreur dans le chat |
| `extension_ui_request` | Dialogues navigateur (prompt/confirm) pour select/confirm/input/editor |
| `auto_retry_start` / `auto_retry_end` | Non traité (log console) |
| `process_exit` | Statut → "⚠️ Déconnecté", bouton abort → reconnect 🔄 |

---

## 7. Menu contextuel (sidebar)

| Contexte | Action |
|----------|--------|
| **Fichier** | "📤 Envoyer à l'agent Pi" → ouvre onglet agent + prompt contextuel |
| **Dossier** | "📤 Analyser ce dossier" → ouvre onglet agent + prompt d'analyse |
| **Zone vide** | Pas d'option agent |

---

## 8. Fonctionnalités de l'onglet Agent Pi

| Fonctionnalité | État |
|----------------|------|
| Chat avec streaming Markdown | ✅ |
| Pensées (thinking) repliables | ✅ |
| Blocs outils (tool calls) avec sortie | ✅ |
| Saisie Entrée=envoyer / Shift+Entrée=nouvelle ligne | ✅ |
| Barre d'outils (⏹️ abort, ➕ new session, 📦 compact) | ✅ |
| Sélecteur de modèle (chargé depuis pi) | ✅ |
| Stats tokens/coûts en temps réel | ✅ |
| Indicateur de statut (Prêt / En réflexion... / ⚠️ Déconnecté) | ✅ |
| Reconnexion automatique si crash (bouton 🔄) | ✅ |
| Dialogues d'extension (via prompt/confirm navigateur) | ✅ |
| Messages système et erreurs | ✅ |
| Autocomplétion des commandes slash (/) | ✅ |
| Reprise de session (/resume) avec popup de sélection | ✅ |
| Affichage conditionnel des pensées (show_thinking) | ✅ |
| Images dans les prompts (drag & drop, Ctrl+V) | ✅ |

---

## 9. Cycle de vie

| Événement | Action |
|-----------|--------|
| Démarrage Pilot (projet auto-load + RPC activé) | Ouvre onglet Agent Pi + `start_agent_session` |
| Clic bouton π dans la barre d'actions | Ouvre/focus onglet Agent Pi |
| Fermeture onglet Agent Pi | Unlisten RPC + `stop_agent_session` |
| Fermeture projet | `stop_agent_session` |
| Crash processus pi | Événement `process_exit` → UI déconnecté + bouton reconnecter |

---

## 10. Fichiers du projet

| Fichier | Rôle |
|---------|------|
| `src-tauri/src/rpc_manager.rs` | Module Rust : spawn, JSONL parser, threads, événements |
| `src-tauri/src/lib.rs` | Commandes Tauri (15), AppConfig, AppState, cycle de vie |
| `src/js/agent-pi.js` | Module frontend complet : chat UI, streaming, reconnexion |
| `src/js/tabs.js` | Mode `agent`, `_openAgent()`, nettoyage `closeTab`/`closeTabByPath` |
| `src/js/main.js` | Conditionnement RPC (bouton π, démarrage auto) |
| `src/js/sidebar.js` | Menu contextuel agent (fichier + dossier) |
| `src/js/settings.js` | 5 champs RPC dans la modale paramètres |
| `src/css/style.css` | ~250 lignes de CSS pour le chat agent |
| `index.html` | Boutons menu contextuel, champs settings |

---

## 11. Choix techniques

| Décision | Raison |
|----------|--------|
| `std::sync::mpsc` pour réponses synchrones | Pas de dépendance tokio, simple et suffisant |
| `Box::new(stdout)` pour la boucle JSONL | ChildStdout doit être boxé pour `read_jsonl_loop` |
| Thread `std::thread::spawn` pour stdout | Pas de dépendance async pour le parsing |
| Icône π (pi) pour l'onglet agent | Préférence utilisateur (pas 🤖) |
| `markdown-it` pour le rendu | Déjà disponible dans le projet (utilisé par preview.js) |
| Split `\n` uniquement pour JSONL | Conforme au protocole Pi strict |
| Trim `\r` final toléré | Compatibilité Windows |

---

## 12. Reste à faire (futur)

- [ ] Modèle par défaut configurable dans les paramètres (sélecteur dans settings)
- [ ] Niveau de thinking configurable (low/medium/high) dans les paramètres
- [ ] Éditeur intégré pour le dialogue `extension_ui_request` type `editor` (actuellement un simple prompt)
- [ ] Export conversation (HTML/Markdown)
- [ ] Tests multi-plateforme (macOS, Linux)
- [x] Images dans les prompts (drag & drop / Ctrl+V dans la zone de chat) ✅

---

## 13. Plan de développement (historique)

### Étape 1 — Backend Rust : processus + JSONL ✅
- [x] Créer `src-tauri/src/rpc_manager.rs`
- [x] Fonction `spawn_and_start()` : lance `pi --mode rpc` avec pipes
- [x] Fonction `read_jsonl_loop()` : split buffer, parse JSON, emit Tauri events
- [x] Commande Tauri `start_agent_session(cwd, pi_path, no_session)`
- [x] Commande Tauri `stop_agent_session()`
- [x] Stocker le `RpcSession` dans le state Tauri

### Étape 2 — Backend Rust : commandes RPC ✅
- [x] `send_command()` / `send_command_sync()` : écriture stdin + corrélation réponse
- [x] Commande `send_agent_prompt(message, images?)`
- [x] Commande `abort_agent()`
- [x] Commande `get_agent_state()`
- [x] Commande `get_session_stats()`
- [x] Commande `get_agent_messages()`
- [x] Commande `set_agent_model(provider, model_id)`
- [x] Commande `list_agent_models()`
- [x] Commande `execute_agent_bash(command)`
- [x] Commande `new_agent_session()`
- [x] Commande `compact_agent_context()`
- [x] Commande `send_rpc_command(command)` (debug)

### Étape 3 — Frontend : onglet Agent Pi ✅
- [x] Créer `src/js/agent-pi.js`
- [x] Ouvrir/fermer l'onglet agent (mode `agent` dans tabs.js)
- [x] Zone de chat scrollable + saisie (Enter/Shift+Enter)
- [x] Écoute des événements `rpc-event` (13 types d'événements)
- [x] Rendu streaming des messages (Markdown, pensées, outils)
- [x] Barre d'outils (abort, new session, compact, modèle, stats, statut)

### Étape 4 — Frontend : intégration UI ✅
- [x] Bouton π dans le panneau d'actions (conditionné par `rpc_agent_enabled`)
- [x] Ouverture auto de l'onglet agent au démarrage (si projet + RPC activé)
- [x] Menu contextuel "📤 Envoyer à l'agent Pi" (fichiers)
- [x] Menu contextuel "📤 Analyser ce dossier" (dossiers)
- [x] Paramètres agent dans la modale settings (3 champs)

### Étape 5 — Robustesse et finitions ✅
- [x] Gestion erreurs processus (message explicite si pi introuvable)
- [x] Reconnexion (événement `process_exit` + bouton 🔄)
- [x] Dialogues d'extension (modales navigateur pour select/confirm/input/editor)
- [x] Affichage stats tokens/coûts dans la barre d'outils
- [x] Sélecteur de modèle intégré (liste chargée depuis pi)
- [x] Option `--no-session` configurable

### Étape 6 — Sessions, commandes slash et thinking ✅
- [x] Dossier de sessions personnalisé (`rpc_session_dir` → `--session-dir`)
- [x] Paramètre `show_thinking` pour afficher/masquer les pensées
- [x] Commande `list_agent_commands` : autocomplétion slash dans la saisie
- [x] Commande `list_sessions` : lister les sessions enregistrées du projet
- [x] Commande `resume_agent_session` : reprendre une session depuis un fichier JSONL
- [x] Commande `/resume` : listing + popup de sélection pour reprise de session
- [x] Événement `model_change` : synchronisation du sélecteur de modèle
- [x] Fusion des blocs assistant lors d'une reprise de session (affichage groupé)

---

<!-- HELP:agent-pi -->
## Agent Pi (onglet π)

L'onglet **π** intègre l'agent de codage **Pi** (pi.dev) directement dans Pilot :
dialogue avec l'IA, écriture/modification de code, sans quitter l'éditeur.

- **Démarrer** : bouton **Agent Pi** du panneau d'actions, ou onglet π. Pilot
  lance un processus `pi --mode rpc` en arrière-plan.
- **Poser une question / une tâche** : zone de saisie, `Entrée` pour envoyer
  (`Shift+Entrée` = saut de ligne).
- **Modèle** : sélecteur en haut de l'onglet (provider + modèle).
- **Nouvelle conversation** : bouton ➕ (new session). **Reprendre une session** :
  commande `/resume` liste les sessions enregistrées pour le projet courant.
- **Prompt Builder** : clic-droit sur un fichier/dossier de l'explorateur →
  « Ajouter au prompt » pour l'envoyer comme contexte à l'agent.
- **Interrompre** : bouton ⏹️. **Stats tokens/coût** affichées en haut.
- **Quality-gate** (bouton 🛡️) : active un protocole anti-régression embarqué
  (vérifie que les modifications ne cassent aucune fonctionnalité existante).

L'agent a accès aux fichiers du projet courant (lecture/écriture).
<!-- /HELP:agent-pi -->
