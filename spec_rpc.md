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
| `rpc_pi_path` | string | Champ texte | Chemin vers l'exécutable pi (vide = "pi" dans PATH). Pilot en déduit aussi le répertoire de configuration du programme : stem de l'exécutable (plh.exe → `~/.plh`, pi → `~/.pi`). Sert pour `models.json`, le répertoire de sessions par défaut, et `model_supports_images`. |
| `rpc_no_session` | bool | Checkbox | Passe `--no-session` à pi (pas de persistance disque) |
| `rpc_session_dir` | string | Champ texte | Dossier personnalisé pour les sessions (vide = `~/.{stem}/agent/sessions`, dérivé de `rpc_pi_path`) |
| `show_thinking` | bool | Checkbox | Affiche les pensées (thinking) de l'agent dans le chat |

> **Résolution du config dir (programme compatible pi)** : Pilot ne code plus `~/.pi` en dur. Il déduit le répertoire de configuration du programme depuis `rpc_pi_path` : le stem de l'exécutable (ex. `plh.exe` → `~/.plh`, `pi` → `~/.pi`, vide → `~/.pi`). Cette convention est utilisée pour `models.json` (liste des modèles + support image) et le répertoire de sessions par défaut. Permet de brancher n'importe quel programme 100 % compatible pi en RPC (ex. plh) sans modifier le code. Voir `resolve_agent_home()` dans `lib.rs`.
> **Fallback hybride pour la liste des modèles** : l'onglet agent et le mode orchestration utilisent `fetchAvailableModels()` qui interroge d'abord le programme actif via RPC (`list_agent_models` → `get_available_models`), puis, si 0 modèle est retourné (programme ne supportant pas la commande ou format non reconnu), retombe sur la lecture du fichier `~/.{stem}/agent/models.json` (`get_available_models_list`). Les chaînes `provider/modelId` du fallback sont converties en objets `{ provider, id, label }` pour homogénéité. Les paramètres et l'aide intégrée utilisent directement la source fichier.

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
| `get_backend_info` | sync | Sondage `--version`+`--help` → genre (`pi`/`plh`/`unknown`) + support `--extension` (mis en cache par `rpc_pi_path`). Sert au libellé dynamique « Agent Pi »/« Agent PLh » et à la porte pré-écriture (voir `spec_diff_review.md` §2.1). |
| `extension_gate_supported` | sync | Raccourci : `get_backend_info().ext_supported` |
| `pi_health_check` | sync | Health check démarrage (E4) : `<rpc_pi_path> --version` (timeout 3s) → `{ok, kind, version, error, path}`. `error` : `""`/`no_path`/`not_executable`. Sert à la gate d'ouverture de l'onglet agent (`tabs.js`) + toast d'avertissement. |
| `git_status` | sync | Git intégré (C1) : `git -C <project> status --porcelain -uall --no-renames` → `{is_repo, entries: {relPath → "XY"}}`. `is_repo=false` si pas un repo Git (ou `git` absent) → l'UI masque les badges gracieusement. |
| `git_diff_file` | sync | C1 : diff d'un fichier → `{is_repo, tracked, before, after}`. `before` = `git show HEAD:<relpath>` (vide si non tracked / jamais commité), `after` = contenu disque. Sert à la modale diff (`openGitDiffModal`). |
| `ask_review` | async | Revue de code (H5) : récupère `git diff` (portée `working`/`last`), construit un prompt cadré et lance un process pi temporaire `--no-session` (via `help::ask_pi_caged`, cwd temp isolé du projet) → retourne la revue Markdown. `Err` si pas un repo Git / rien à reviewer / aucun modèle configuré. Historique réinjecté (pi sans mémoire). Voir [`spec_review.md`](spec_review.md). |
| `set_review_model` | sync | Persiste `config.review_model` (sélecteur de l'onglet Review). Format `provider/modelId`. |
| `index_sessions` | async | H9 : (Re)construit `.pilot/sessions.jsonl` depuis le dossier de sessions pi du projet (rétro-indexation complète, idempotente). Retourne le nb d'entrées. Préserve les tags (fichier séparé). |
| `search_sessions` | sync | H9 : recherche dans l'index. Params `{query, tag, file, kind, limit}`. Full-text (substring insensible à la casse, ou regex si `query` commence par `/`) sur prompt+summary+files, filtres tag/file/kind. Retourne `{entries, total, indexed}`. |
| `get_session_detail` | sync | H9 : détail d'une session (par id) = entrée indexée + contenu du JSONL pi (messages simplifiés role/text/tools). |
| `set_session_tags` | sync | H9 : persiste les tags d'une session dans `.pilot/sessions-tags.json` (fichier séparé, ne touche pas l'index). |
| `list_session_tags` | sync | H9 : liste tous les tags utilisés (autocomplétion UI). |
| `record_session_entry` | async | H9 : écrit/met à jour une entrée de session dans l'index (capture live, appelé par le frontend à l'agent_end). Retire l'entrée de même id puis réécrit. Tags jamais écrasés. |
| `list_agent_backends` | sync | Liste les stems de backends disponibles (scanne `~/.pi`, `~/.plh`, ... contenant `agent/models.json`). Sert au sélecteur de l'onglet Fournisseurs. |
| `read_models_config` | sync | Lit `~/.{stem}/agent/models.json` (round-trip JSON). Retourne `{}` si absent. |
| `write_models_config` | sync | Écrit `~/.{stem}/agent/models.json` (backup `.bak` + validation `providers` est un objet). |
| `read_model_aliases` | sync | Lit `~/.{stem}/agent/model-switch.json` (`{aliases, defaultModel}`). |
| `write_model_aliases` | sync | Écrit `~/.{stem}/agent/model-switch.json` (backup `.bak` + validation). |
| `test_provider_models` | async | Teste un provider : `GET {baseUrl}/models` (OpenAI-compat, ollama/llama-cpp) → `{ok, models:[ids], error}`. Timeout 5s. Bearer auth si apiKey renseignée. |

---

## 6. Événements RPC gérés par le frontend

| Événement | Traitement |
|-----------|------------|
| `agent_start` | Statut → "En réflexion...", streaming activé |
| `agent_end` | Statut → "Prêt", mise à jour des stats tokens/coûts. **Chat standard :** si le tour s'est terminé sur `stopReason:"length"` (réponse tronquée par la limite de tokens de sortie — cas typique d'un modèle local écrivant un gros fichier via un tool call `write` coupé en plein milieu), relance automatiquement le modèle (max 2, `state.lengthNudgeAttempts`) pour qu'il reprenne, au lieu de rester silencieux (« l'agent s'est arrêté pour rien »). Le compteur est remis à zéro à chaque envoi utilisateur manuel. Désactivé en mode Orchestration (géré par `detectReflectionOnly`). Cf. session pi `019f85e4`. **Chat standard + rafale de retries :** finalise le bloc « 🔄 nouvelle tentative » (retrait si une réponse est revenue, sinon bouton « Réessayer » — voir `auto_retry_start`). |
| `message_start` / `message_update` / `message_end` | Streaming du texte de l'assistant (Markdown) ; `message_end` affiche aussi explicitement les erreurs (`stopReason:"error"` + `errorMessage`, ex: serveur LLM injoignable) au lieu de rester silencieux. Mémorise `stopReason` (`state.lastStopReason`) pour la détection de troncation (voir `agent_end`) |
| `thinking_start` / `thinking_delta` / `thinking_end` | Bloc `<details>` repliable pour la pensée |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Bloc outil avec nom, arguments, sortie |
| `text_start` / `text_delta` / `text_end` | Streaming du texte dans le bloc message |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | Streaming des appels d'outils |
| `compaction_start` / `compaction_end` | Message système "Compaction..." |
| `queue_update` | Non traité (log console) |
| `model_change` | Met à jour le sélecteur de modèle et les stats |
| `extension_error` | Message d'erreur dans le chat |
| `extension_ui_request` | Dialogues navigateur (prompt/confirm) pour select/confirm/input/editor |
| `auto_retry_start` / `auto_retry_end` | **Mode Orchestration :** abort + pause/mensaje « orchestrateur injoignable ». **Chat standard :** dé-duplication des erreurs de connexion — un seul bloc « 🔄 nouvelle tentative (n) » mis à jour (au lieu d'empiler `❌ Erreur` à chaque retry) ; sur `agent_end` sans réponse, transformation en `❌ Modèle injoignable après n tentative(s)` + bouton « Réessayer » (retry 1-clic du dernier prompt via `state.lastUserPrompt` / `lastRetryImages`). Sans cela, l'agent se figeait en silence après épuisement des retries (sessions `019f4b28`, `019f891a`). |
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
| Blocs outils (tool calls) avec sortie | ✅ (les résultats d'outil en **erreur** — ex. tool call tronqué par la limite de tokens — s'affichent même si `show_tools` est désactivé) |
| Saisie Entrée=envoyer / Shift+Entrée=nouvelle ligne | ✅ |
| Barre d'outils (⏹️ abort, ➕ new session, 📦 compact) | ✅ |
| Sélecteur de modèle (chargé depuis pi) | ✅ |
| Détection au démarrage d'un modèle par défaut injoignable (TCP probe sur endpoint local) | ✅ |
| Resync du modèle au moment d'envoyer un prompt (chat standard) | ✅ |
| Sélecteurs orchestrateur + codeur affichés en mode Orchestration (sélecteur standard masqué) | ✅ |
| Stats tokens/coûts en temps réel | ✅ |
| Indicateur de statut (Prêt / En réflexion... / ⚠️ Déconnecté) | ✅ |
| Reconnexion automatique si crash (bouton 🔄) | ✅ |
| Redémarrage à chaud de l'agent si reconfig du backend (chemin/session RPC) dans les Paramètres | ✅ |
| Dialogues d'extension (via prompt/confirm navigateur) | ✅ |
| Messages système et erreurs | ✅ |
| Autocomplétion des commandes slash (/) | ✅ |
| Reprise de session (/resume) avec popup de sélection | ✅ |
| Affichage conditionnel des pensées (show_thinking) | ✅ |
| Relance auto après réponse tronquée (`stopReason:"length"`) — chat standard | ✅ |
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
| Reconfig paramètres lancement RPC (chemin pi / no-session / rép. session) | `save_config` → `settings.js` lève flag → dispatche `pilot-agent-restart-needed` → `agent-pi.js` stop+start+`new_session`+reset UI+reload modèles (si onglet ouvert) |

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

## 14. Édition des modèles IA (providers + alias)

Onglet **« Fournisseurs »** de la modale Paramètres (`src/js/models-config.js`).
Permet d'éditer le registre des modèles (`models.json`) et les alias
(`model-switch.json`) d'un backend **sans toucher aux JSON à la main**.

- **Backend cible** : sélecteur en tête d'onglet (pi / plh / ...), détecté via
  `list_agent_backends` (scanne `~/.{stem}/agent/models.json`). Le backend actif
  est pré-sélectionné via `get_backend_info`.
- **Providers** : édition de `baseUrl`, `api`, `apiKey`, et `compat`
  (`supportsTools`, `supportsDeveloperRole`, `supportsReasoningEffort`).
  Ajout / suppression / renommage d'un provider. Les clés JSON non gérées par
  l'UI sont préservées (round-trip `serde_json::Value`).
- **Modèles** : par provider, édition de `id`, `contextWindow`, `maxTokens`
  (nombre maximum de **tokens de sortie** envoyé au provider ; défaut pi `16384` ;
  vide = auto), `input` (text/image), `systemPrompt` (textarea repliable) et
  **`alias`** (nom court optionnel). Ajout / suppression.
  `maxTokens` est piloté par une case à cocher **`maxTokensEnabled`** (clé
  `maxTokensEnabled` dans `models.json`, `false` par défaut, `true` pour l'API
  Anthropic où `max_tokens` est obligatoire). Cochée → `maxTokens` écrit et
  envoyé. Décochée → `maxTokens` absent du JSON : pi envoie alors sa valeur
  par défaut (`16384`) — comportement identique pour tous les providers, Anthropic
  inclus (l'obligation du paramètre est déjà gérée nativement par pi). La valeur
  saisie est conservée dans `_maxTokensValue` (clé additionnelle ignorée par pi)
  pour restauration au recochage.
- **Alias** (`model-switch.json`) : saisis **au niveau de chaque modèle** (champ
  « alias : » de la carte modèle), plus de bloc séparé. À la sauvegarde, le dict
  `aliases: {alias: "provider/modelId"}` est reconstruit depuis les alias saisis.
  Un `defaultModel` (modèle par défaut du backend) est réglable via un select en
  tête d'onglet. Les alias sont **globaux à Pilot** (un registre par backend),
  plus liés à un projet.
- **Autocomplétion « / »** : `loadModelAliases` (agent-pi.js) lit le registre
  global `~/.{stem}/agent/model-switch.json` via `read_model_aliases(stem)` (stem
  = backend actif via `backendKind()`), au lieu de l'ancienne copie projet
  `<project>/extensions/model-switch.json`. L'agent pi/plh lit le même fichier →
  source de vérité partagée. Rechargé sur `pilot-models-changed`.
- **Modèle par défaut au démarrage** : `defaultModel` (registre global) gouverne le
  modèle sélectionné au **démarrage** et au **redémarrage** de l'agent
  (`loadModels(state, true)` → `forceDefault`), ainsi qu'au **new-session**. Il
  écrase le modèle mémorisé de la session précédente (l'agent plh étant un
  process persistant qui garde son modèle entre les ouvertures de Pilot). Un
  `set_agent_model` synchronise l'agent sur ce `defaultModel`. En cas de
  `defaultModel` absent/invalide, on retombe sur le modèle de session actif.
- **Test de connexion** : bouton par provider → `test_provider_models`
  (`GET {baseUrl}/models`, endpoint OpenAI-compatible supporté par ollama et
  llama-cpp server) → liste les modèles disponibles côté serveur. Bouton par
  modèle → vérifie que l'id est présent dans cette liste.
- **Sauvegarde** : `write_models_config` + `write_model_aliases` (backup `.bak`
  automatique + validation minimale : alias uniques, modèles avec id). Le champ
  temporaire `_alias` (attaché au modèle en mémoire) est retiré avant écriture
  du `models.json`. Émet l'évènement `pilot-models-changed` → l'onglet agent
  (`agent-pi.js` → `loadModels` + `loadModelAliases`) et les selects de modèles
  (`settings.js` : PDF→MD, orchestrateur, codeur, reviewer) se rafraîchissent.
- **Anti-régression** : `get_available_models_list` (lecture utilisée par
  l'existant) est inchangé ; aucune commande existante modifiée, seulement des
  ajouts.

---

<!-- HELP:agent-pi -->
## Agent Pi (onglet π)

L'onglet **π** intègre l'agent de codage **Pi** (pi.dev) directement dans Pilot :
dialogue avec l'IA, écriture/modification de code, sans quitter l'éditeur.

- **Démarrer** : bouton **Agent Pi** du panneau d'actions, ou onglet π. Pilot
  lance un processus `pi --mode rpc` en arrière-plan. Si vous changez le
  chemin du backend (ex: `plh` → `pi`) ou le répertoire de session dans les
  **Paramètres**, l'agent est automatiquement redémarré à chaud (si l'onglet
  est ouvert) — un message « 🔄 Agent redémarré » confirme le basculement.
- **Poser une question / une tâche** : zone de saisie, `Entrée` pour envoyer
  (`Shift+Entrée` = saut de ligne).
- **Modèle** : sélecteur en haut de l'onglet (provider + modèle). Au
  démarrage, Pilot teste la reachabilité du modèle actif : s'il s'agit d'un
  serveur local éteint (ex: llama-cpp/ollama non lancé), un avertissement
  s'affiche pour éviter qu'un prompt échoue en silence. À l'envoi d'un prompt,
  Pilot vérifie que le modèle actif correspond bien au modèle sélectionné et
  le resynchronise (avec un message) si nécessaire.
- **Mode Orchestration** : à l'activation (bouton 🧠 + modale de test), le
  sélecteur standard est masqué et remplacé par deux sélecteurs (orchestrateur
  🧠 + codeur 🔨), inactifs en affichage. À la désactivation, le sélecteur
  standard réapparaît et le modèle standard est restauré.
- **Erreurs visibles** : si un prompt échoue (serveur LLM injoignable, erreur
  API…), le message d'erreur s'affiche dans la conversation au lieu d'une
  bulle vide sans réponse. Les résultats d'outil en erreur (ex. tool call
  tronqué par la limite de tokens) s'affichent même si les outils sont masqués.
  **Modèle injoignable / retries** : quand pi ne parvient pas à joindre le
  modèle (serveur local éteint, API cloud down), il retente automatiquement
  plusieurs fois. Pilot n'affiche qu'un seul bloc « 🔄 nouvelle tentative (n)… »
  mis à jour (au lieu d'empiler les erreurs), puis, si toutes les tentatives
  échouent, un message **❌ Modèle injoignable après n tentative(s)** avec un
  bouton **🔄 Réessayer** pour relancer votre dernier prompt en un clic.
- **Réponses tronquées** : avec un modèle local qui dépasse la limite de
  tokens de sortie (`stopReason:"length"`), la réponse est coupée en plein
  milieu (souvent un `write` de gros fichier). Pilot détecte la troncation et
  relance automatiquement le modèle pour qu'il reprenne (max 2), au lieu de
  rester silencieux. Vous voyez « ✂️ Réponse tronquée… Relance automatique… ».
- **Nouvelle conversation** : bouton ➕ (new session). **Reprendre une session** :
  commande `/resume` liste les sessions enregistrées pour le projet courant.
- **Prompt Builder** : clic-droit sur un fichier/dossier de l'explorateur →
  « Ajouter au prompt » pour l'envoyer comme contexte à l'agent.
- **Interrompre** : bouton ⏹️. **Stats tokens/coût** affichées en haut.
- **Quality-gate** (bouton 🛡️) : active un protocole anti-régression embarqué
  (vérifie que les modifications ne cassent aucune fonctionnalité existante).

L'agent a accès aux fichiers du projet courant (lecture/écriture).
<!-- /HELP:agent-pi -->
