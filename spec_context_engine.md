# Spec — Context Engine (H1)

> Moteur de contexte intelligent : injection automatique du meilleur contexte
> projet avant chaque session agent. V1 heuristique (sans embeddings).

## 1. Objectif

La qualité n°1 d'un coding-agent est le **contexte** qu'on lui donne. Actuellement,
en chat standard, Pilot envoie le prompt utilisateur **brut**, sans aucune
connaissance du projet (sauf ce que l'agent relit lui-même via ses outils). Le
Context Engine construit automatiquement un préambule de contexte projet et
l'injecte une fois par session, dans un budget de tokens configurable.

V1 = **heuristique** (fichiers importants détectés par règles). V2 (plus tard) =
RAG local via embeddings pi.

## 2. Comportement

### Injection
- Une seule fois par session agent (flag `state.contextInjected`), puis **persisté**
  dans le system prompt tant que la session dure (ré-injecté à chaque tour).
- **Mécanisme** : le protocole RPC de pi n'envoie que des messages `user` — pas de
  system prompt par prompt. Pilot écrit donc le bloc dans un fichier de handoff
  `.pilot/context-inject.md` ; l'extension pi **`pilot-context`** (`before_agent_start`)
  le lit et l'ajoute au `event.systemPrompt` du tour. Le contexte reste visible du
  LLM (comme AGENTS.md) mais **n'apparaît pas dans la discussion stockée** :
  `/resume` et l'historique (H9) n'affichent que la vraie saisie utilisateur.
- Le fichier de handoff est supprimé aux frontières de session (voir Reset) puis
  réécrit au prochain prompt. `.pilot/` est git-ignoré.
- Chat standard uniquement ; le mode Orchestration construit déjà son propre
  contexte via `buildPlanPrompt`.
- Format du bloc injecté (dans le system prompt) :

```
=== CONTEXTE PROJET (auto-injecté par Pilot — ne pas répondre à cette section) ===
### <chemin relatif>
<contenu tronqué>
### <chemin relatif>
<contenu tronqué>
=== FIN CONTEXTE ===
```

### Reset du flag `contextInjected`
Le contexte est ré-injecté au prochain prompt si l'un de ces événements survient :
- `new_agent_session` (bouton ➕)
- `compact_agent_context` (bouton 📦)
- Reconnexion (bouton 🔄)
- Redémarrage à chaud depuis les Paramètres (`pilot-agent-restart-needed`)
- (changement de projet → l'onglet agent est fermé/rouvert → factory recréée → flag reset)

### Bouton toolbar « 📑 Contexte »
- Force la ré-injection au prochain prompt (`state.contextRefreshRequested = true`).
- Toast de confirmation : « 📑 Contexte projet rafraîchi au prochain envoi ».
- Indique visuellement qu'un refresh est en attente (classe `active`).

## 3. Sources priorisées (V1)

Remplissage dans l'ordre, dans la limite du budget tokens (`context_budget_tokens`, défaut 8000) :

| Rang | Source | Règle | Part max |
|------|--------|-------|----------|
| 1 | `.pilot/context.md` | contexte curé par l'utilisateur | 40 % |
| 2 | Fichier actif dans l'éditeur | onglet édition courant (non-vide) | 20 % |
| 3 | Imports du fichier actif | regex JS/TS/Python/Markdown, résolution relative | 15 % |
| 4 | Manifestes | `package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `tsconfig.json` | 10 % |
| 5 | Specs référencées dans AGENTS.md | parsing de la table de navigation `\| Tâche \| Fichier(s) à lire \|` (AGENTS.md lui-même n'est PAS injecté — discovery native pi/plh) | reste |
| 6 | Fichiers récemment édités | top 5 (historique session-persistence) | 5 % |

> **Note AGENTS.md** : pi et plh découvrent et injectent nativement `AGENTS.md`
> dans le system prompt (cf. `resource-loader.ts` / `project_context.rs`). Pilot
> ne le réinjecte pas (anti-doublon). Le Context Engine lit seulement `AGENTS.md`
> pour parser sa table de navigation et charger les specs qu'il référence.

Estimation tokens : **~3.5 chars/token** (heuristique conservative).

### Extraction des imports (V1)
- **JS/TS** : `import ... from 'relative'`, `require('relative')`
- **Python** : `from .relative import`, `import .relative`
- **Markdown** : `[label](relative.md)`, liens vers `.md`/fichiers
- **Rust/C++** : V2 (complexité modules/crates)

Résolution : chemin relatif au fichier actif → essai d'extensions `.js/.ts/.mjs/.py/.md` et index.

### Parsing de la table AGENTS.md
La table `| Tâche | Fichier(s) à lire |` d'AGENTS.md liste les specs du projet.
V1 : on extrait les chemins de la 2e colonne, on lit ceux qui existent (tronqués).

## 4. Config (AppConfig)

| Champ | Type | Défaut | UI |
|-------|------|--------|----|
| `context_engine_enabled` | bool | `true` | checkbox |
| `context_budget_tokens` | u32 | `8000` | number (min 1000, max 32000) |
| `context_include_imports` | bool | `true` | checkbox |
| `context_include_specs` | bool | `true` | checkbox |
| `context_include_recents` | bool | `true` | checkbox |

## 5. Architecture

```
src/js/context-engine.js   (nouveau) — fonctions pures
  buildProjectContext(projectPath, activeTab, recents, opts) -> string
  estimateTokens(str)
  truncateToTokens(str, budget)
  extractImports(content, lang)
  parseAgentsNavTable(agentsContent)
  readSafe(path)  // wrapper invoke read_file_content + file_exists

src/js/agent-pi.js          — état + branchement
  state.contextInjected = false
  state.contextRefreshRequested = false
  bouton toolbar data-action="context"
  injection avant invoke("send_agent_prompt") sur le chemin chat standard
  reset sur new-session / compact / reconnect / restart-needed

src-tauri/src/lib.rs        — 4 champs AppConfig + défauts
src/js/settings.js          — load/save 4 champs
index.html                  — section Paramètres « Context Engine »
```

Aucune nouvelle commande Rust lourde en V1 : on réutilise `read_file_content`,
`file_exists`, `refresh_tree`. Les fichiers récents viennent de l'historique JS
(session-persistence / tabs).

## 6. Limites V1 / V2

- V1 : heuristique, pas de scoring sémantique, pas de RAG.
- V2 : embeddings locaux via Ollama, graphe de dépendances, scoring par similarité
  au prompt, budget dynamique selon le modèle (fenêtre de contexte).
- V1 ne couvre pas Rust/C++ pour les imports (modules/CRATE complexes).
- **Garde de taille (anti-gel)** : les fichiers de plus de **512 Ko** sont ignorés
  par le Context Engine (V1 et V2). `read_file_content` n'a pas de limite de
  taille ; sur un gros projet (ex: bundle minifié, fichier de données), lire un
  tel fichier en entier bloquerait le thread principal et gèlerait l'UI. La garde
  est appliquée côté JS (`MAX_CONTEXT_FILE_SIZE` dans `context-engine.js`) et côté
  Rust (`MAX_FILE_BYTES` dans `context_engine.rs`). 512 Ko ≈ 128k tokens, bien
  au-delà du budget de contexte (8k par défaut) — inutile de les lire.

---

## 7. V2 — RAG local (embeddings Ollama)

> Extension optionnelle du Context Engine : au lieu des règles heuristiques V1,
> on encode le projet en vecteurs via un modèle d'embeddings local (Ollama) et
> on sélectionne les chunks les plus pertinents par similarité cosinus au prompt.

### 7.1 Principe

1. **Build** : découpe le projet en chunks (≈60 lignes, overlap 10), encode chaque
   chunk via Ollama (`/api/embeddings`), stocke les vecteurs dans SQLite
   (`.pilot/context-index.db`).
2. **Query** (au 1er prompt d'une session) : encode le prompt, recherche cosinus
   sur l'index, top-K chunks dans le budget dynamique, injecte en préambule.
3. **Incrémental lazy** : à chaque query, compare les mtime des fichiers indexés
   vs disque → re-indexe uniquement les fichiers modifiés/supprimés/ajoutés. Pas
   de watcher dédié (self-healing à la query).

### 7.2 Configuration (AppConfig)

| Champ | Type | Défaut | UI |
|-------|------|--------|----|
| `context_rag_enabled` | bool | `false` | checkbox « Activer le RAG (embeddings) » |
| `context_rag_endpoint` | String | `http://127.0.0.1:11434` | texte « Adresse Ollama » |
| `context_rag_model` | String | `nomic-embed-text` | texte « Modèle d'embeddings » |

`context_engine_enabled` (V1) reste le master switch. Si `context_rag_enabled`
est vrai **et** l'endpoint répond, on utilise le RAG ; sinon on retombe sur V1.

### 7.3 Chunking

- **Code** : blocs de 60 lignes, overlap 10 lignes (langage-agnostique).
- **Markdown** : découpe par section (heading `#`/`##`…), fallback blocs 60 lignes.
- Filtre : `node_modules/`, `target/`, `.git/`, `dist/`, binaires, images.
- Extensions indexées : `.js .ts .mjs .jsx .tsx .py .md .rs .json .toml .css .html .go .java .c .cpp .h .yaml .yml .txt`.
- Chaque chunk stocke : `path` (relatif), `start_line`, `end_line`, `content`, `file_hash` (SHA-256 du fichier), `mtime` (epoch).

### 7.4 Stockage SQLite

Base `.pilot/context-index.db` (un par projet), via `rusqlite` feature `bundled`
(zéro dépendance système). Schéma :

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,        -- chemin relatif projet
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  file_hash TEXT NOT NULL,   -- SHA-256 du fichier source
  mtime INTEGER NOT NULL,    -- mtime du fichier à l'indexation
  embedding BLOB NOT NULL    -- vecteur f32[] sérialisé little-endian
);
CREATE INDEX idx_chunks_path ON chunks(path);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- model, dim, built_at
```

Recherche : lecture de tous les `embedding` (BLOB → `Vec<f32>`), cosinus contre le
vecteur du prompt, tri décroissant, top-K. Pour < 50k chunks : < 20ms.

### 7.5 Build / Query (commandes Rust)

```
context_index_status(projectPath) -> { exists, chunks, model, built_at, ready }
build_context_index(projectPath) -> { chunks, files, elapsed_ms }   // async, progress via event "context-index-progress"
query_context_index(projectPath, prompt, budgetTokens) -> { context: string, chunks_used, source: "rag"|"v1-fallback" }
```

- `build_context_index` : scanne le projet (filtres), chunk + embed (batch
  Ollama), insère en transaction. Envoie l'événement `context-index-progress`
  `{ done, total }` pour la barre de progression frontend.
- `query_context_index` : si index absent → V1 fallback. Sinon : **embed le
  prompt d'abord** (timeout court) → si Ollama indisponible → retourne
  `source: "v1-fallback"` immédiatement SANS refresh. Si Ollama répond →
  refresh incrémental **limité** (au plus 20 fichiers récents) → query cosinus
  → formatage préambule.
- **Anti-gel (timeouts)** : le chemin critique du prompt utilise un client
  HTTP à `connect_timeout` 2s et `timeout` 8s (`http_fast_client`). Le refresh
  et le build utilisent `http_client` (connect 3s / 30s). Le 1er prompt ne
  dépend donc jamais d'Ollama pour partir.
- **Fallback** : si Ollama injoignable ou erreur → retourne `source: "v1-fallback"`
  et le frontend utilise `buildProjectContext` V1.

### 7.6 Budget dynamique

Le frontend calcule le budget passé à `query_context_index` :
`budget = floor(coderContextWindow * 0.15)` (défaut 8000 si fenêtre inconnue),
borné [2000, 16000]. Le boost structurel (`.pilot/context.md`, manifestes,
`.pilot/context.md`) reste : ces fichiers sont toujours inclus en tête du
préambule avant les chunks RAG.

### 7.7 Flux au 1er prompt

```
1er prompt d'une session (RAG activé + Ollama dispo) :
  1. invoke query_context_index(projectPath, promptText, budget)
  2. si index absent → build en arrière-plan ; ce prompt → V1 heuristique
  3. si index prêt → préambule RAG (boost structurel + top-K chunks)
  4. injection === CONTEXTE PROJET (RAG) ===
```

Bouton 📑 « Contexte » : force un **rebuild complet** (supprime l'index puis
`build_context_index`) si RAG activé ; sinon refresh V1.

### 7.7bis Ceinture-bretelles frontend (anti-gel)

Dans `agent-pi.js`, l'appel `buildProjectContext(...)` est borné par un
**`Promise.race` avec un timeout de 8 s**. Si le contexte n'est pas prêt à
temps (Ollama lent, commande bloquée), le prompt part **sans** contexte
(fallback silencieux, warning console) plutôt que de figer le chat. Double
protection avec les timeouts backend du §7.5.

### 7.8 Architecture

```
src-tauri/src/context_engine.rs  (nouveau) :
  chunk_file(path, content) -> Vec<Chunk>
  embed_batch(endpoint, model, texts) -> Result<Vec<Vec<f32>>>   // reqwest
  build_index(projectPath, endpoint, model) -> index SQLite
  query_index(projectPath, prompt, budget) -> string
  incremental_refresh(projectPath, endpoint, model) -> mtime diff
  Tauri commands : context_index_status, build_context_index, query_context_index, context_rag_probe

src-tauri/src/lib.rs            — 3 champs AppConfig + defaults + .manage(AppState) + register commands
src/js/context-engine.js         — buildProjectContext V2 : si rag activé → invoke query_context_index
src/js/agent-pi.js               — bouton 📑 → rebuild (RAG) ou refresh (V1)
src/js/settings.js + index.html  — section « Context Engine V2 (RAG) »
```

Dépendances Rust ajoutées : `rusqlite = { version = "0.31", features = ["bundled"] }`,
`reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }`.

<!-- HELP:context-engine -->
## Context Engine (auto-contexte agent)

Pilot injecte **automatiquement** un contexte projet avant le 1er prompt de chaque
session agent (chat standard) : `.pilot/context.md`, fichier actif, imports, manifestes,
specs référencées dans AGENTS.md, fichiers récemment édités — dans un budget de tokens configurable.

> `AGENTS.md` lui-même n'est pas réinjecté par Pilot : pi et plh le découvrent
> nativement. Le Context Engine l'utilise seulement comme index pour charger les
> specs qu'il référence.

- **Activation** : Paramètres → section « Context Engine ». Désactivable.
- **Budget** : par défaut 8000 tokens (réglable 1000–32000).
- **Bouton 📑 Contexte** (toolbar agent) : force la ré-injection au prochain
  envoi (utile après avoir changé de fichier actif ou édité `AGENTS.md`).
- **Une fois par session** : le contexte est réinjecté automatiquement après un
  nouveau chat (➕), une compaction (📦), une reconnexion (🔄) ou un changement
  de projet.
- **`.pilot/context.md`** : déposez un fichier contextuel à la racine du projet
  pour ajouter vos propres instructions permanentes (conventions, pièges à
  éviter) — il est injecté en priorité juste après `.pilot/context.md`.
- **RAG local (V2, optionnel)** : section **Paramètres → RAG (Context Engine V2)**
  — activez le RAG, saisissez l'**adresse Ollama** (`http://127.0.0.1:11434`) et
  le **modèle d'embedding** (`nomic-embed-text`), puis « Tester la connexion ».
  Pilot indexe alors le projet en vecteurs et sélectionne les passages les plus
  pertinents par similarité sémantique au prompt (plus précis que l'heuristique
  V1). L'index SQLite est stocké dans `.pilot/context-index.db` et se met à jour
  incrémentalement. Le bouton 📑 force un rebuild complet. Sans Ollama, Pilot
  retombe automatiquement sur V1. Le chat ne fige jamais si Ollama est
  éteint ou lent : des timeouts bornent l'attente et le prompt part sans
  contexte au besoin.
<!-- /HELP:context-engine -->