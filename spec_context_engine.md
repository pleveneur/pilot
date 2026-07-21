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
- Une seule fois par session agent (flag `state.contextInjected`).
- Injecté **en préambule** du 1er prompt utilisateur (chat standard uniquement ;
  le mode Orchestration construit déjà son propre contexte via `buildPlanPrompt`).
- Format :

```
=== CONTEXTE PROJET (auto-injecté par Pilot — ne pas répondre à cette section) ===
### <chemin relatif>
<contenu tronqué>
### <chemin relatif>
<contenu tronqué>
=== FIN CONTEXTE ===

<texte utilisateur>
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
| 1 | `AGENTS.md` | toujours si présent | 40 % |
| 2 | `.pilot/context.md` | contexte curé par l'utilisateur | 20 % |
| 3 | Fichier actif dans l'éditeur | onglet édition courant (non-vide) | 20 % |
| 4 | Imports du fichier actif | regex JS/TS/Python/Markdown, résolution relative | 15 % |
| 5 | Manifestes | `package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `tsconfig.json` | 10 % |
| 6 | Specs référencées dans AGENTS.md | parsing de la table de navigation `\| Tâche \| Fichier(s) à lire \|` | reste |
| 7 | Fichiers récemment édités | top 5 (historique session-persistence) | 5 % |

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
- V2 : embeddings locaux via pi, graphe de dépendances, scoring par similarité
  au prompt, budget dynamique selon le modèle (fenêtre de contexte).
- V1 ne couvre pas Rust/C++ pour les imports (modules/CRATE complexes).

<!-- HELP:context-engine -->
## Context Engine (auto-contexte agent)

Pilot injecte **automatiquement** un contexte projet avant le 1er prompt de chaque
session agent (chat standard) : `AGENTS.md`, fichier actif, imports, manifestes,
specs référencées, fichiers récemment édités — dans un budget de tokens configurable.

- **Activation** : Paramètres → section « Context Engine ». Désactivable.
- **Budget** : par défaut 8000 tokens (réglable 1000–32000).
- **Bouton 📑 Contexte** (toolbar agent) : force la ré-injection au prochain
  envoi (utile après avoir changé de fichier actif ou édité `AGENTS.md`).
- **Une fois par session** : le contexte est réinjecté automatiquement après un
  nouveau chat (➕), une compaction (📦), une reconnexion (🔄) ou un changement
  de projet.
- **`.pilot/context.md`** : déposez un fichier contextuel à la racine du projet
  pour ajouter vos propres instructions permanentes (conventions, pièges à
  éviter) — il est injecté en priorité juste après `AGENTS.md`.
<!-- /HELP:context-engine -->