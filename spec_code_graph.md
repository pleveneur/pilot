# Spec — Code Graph (graphe de connaissances projet)

> Graphe de connaissances structurel du projet, construit localement et
> gratuitement (sans LLM), inspiré de graphify. Complémentaire du RAG (H1 V2,
> sémantique) : le RAG retrouve « où », le graphe explique « comment ça se
> connecte ». Injecté à pi/plh au 1er prompt (mode A) **et** disponible comme
> wiki Markdown interrogeable par l'agent (mode B). Mise à jour incrémentale.
>
> **Statut : ✅ Implémenté** — V1 (heuristique, regex), V2 (tree-sitter) et V2.1
> (refresh auto via watcher).
> Backend sélectionné par la config `graph_extraction` (`"heuristic"` | `"treesitter"`),
> un rebuild (`build_code_graph --force`) régénère l'index avec le backend actif.
> Mise à jour au fil de l'eau : refresh incrémental à la query (auto-lazy) + refresh
> différé automatique déclenché par le watcher de fichiers (V2.1).

---

## 1. Objectif & positionnement

Pilot injecte déjà un contexte projet avant le 1er prompt d'une session agent :
- **H1 V1** (heuristique) / **H1 V2** (RAG embeddings Ollama + cosinus) — `context_engine.rs`.
- **H3** (mémoire projet `PROJECT_MEMORY.md`).

Ces approches sont **sémantiques** : elles retrouvent les *passages* pertinents.
Elles ne donnent pas la **structure** : qui appelle quoi, ce qui hérite de quoi,
ce qui serait impacté par une modification.

Le **Code Graph** apporte cette structure comme un **graphe de connaissances** :
nœuds = concepts (fichiers, fonctions, classes, imports), arêtes = relations
(`calls`, `imports`, `inherits`, `references`, `uses`), chaque arête étiquetée
`EXTRACTED` (trouvée dans le code) ou `INFERRED` (déduite).

**Complément, pas remplacement** : RAG = sémantique, Graphe = structurel. Les deux
sont activables indépendamment et se cumulent dans l'injection.

### Gains attendus (même logique que graphify)
- **Consommation de tokens réduite** pour les questions d'architecture : le LLM
  reçoit un **sous-graphe compact** au lieu de relire des fichiers entiers.
- **Requêtes `explain` / `path` / `affected`** : comprendre un nœud, tracer un lien
  A→B, et surtout **analyse d'impact** (ce qui casse si je modifie X).
- **Honnêteté** : chaque relation est `EXTRACTED`/`INFERRED` — l'agent sait ce qui
  est lu vs déduit.

---

## 2. Architecture générale

```
src-tauri/src/code_graph.rs   (nouveau module Rust — cœur)
  extract_v1(path)            V1 : heuristique regex → {nodes, edges}
  extract_v2(path)            V2 : tree-sitter → {nodes, edges}
  build_graph(projectPath)    scanne le projet, extrait, upsert dans SQLite
  incremental_refresh()       mtime/SHA diff → re-extrait les fichiers changés
  explain(node) / affected(node) / path(a,b) / query(prompt)
  Tauri commands : graph_status, build_code_graph, query_code_graph,
                   graph_explain, graph_affected, graph_path

src-tauri/src/lib.rs          — config AppConfig + enregistrement des commandes
src/js/code-graph.js          (nouveau) — construction bloc graphe + wiki, orchestration UI
src/js/agent-pi.js            — injection combinée A+B dans le handoff
src/js/settings.js + index.html — section « Code Graph » paramétrable
```

### Stockage (réutilise la SQLite existante `.pilot/context-index.db`)
Tables ajoutées (à côté de `chunks` et `meta`) :

```sql
CREATE TABLE IF NOT EXISTS graph_nodes (
  id   TEXT PRIMARY KEY,      -- chemin relatif + type + nom normalisé (canonique)
  label TEXT NOT NULL,        -- nom lisible (ex: "APIRouter", "src/main.rs")
  kind  TEXT NOT NULL,        -- file | class | function | method | import | module
  path  TEXT NOT NULL,        -- fichier source (relatif)
  line  INTEGER,              -- ligne de définition (0 si n/a)
  file_hash TEXT NOT NULL,    -- SHA-256 du fichier source (invalidité incrémentale)
  mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS graph_edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL,     -- calls | imports | inherits | references | uses
  confidence TEXT NOT NULL,   -- EXTRACTED | INFERRED
  path TEXT NOT NULL          -- fichier où la relation a été trouvée
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target);
```

> `confidence` reprend l'idée d'honnêteté de graphify. `file_hash` par nœud permet
> l'invalidation incrémentale sans re-parse complet.

---

## 3. V1 — Extractions heuristiques (regex)

Objectif : valider le pipeline et apporter une vraie valeur **sans aucune
dépendance nouvelle**. Réutilise l'expérience de l'extraction d'imports V1 du
Context Engine (déjà en place dans `context-engine.js`).

### 3.1 Nœuds extraits par fichier
- **`file`** : un nœud par fichier source reconnu.
- **`import`** : chaque import/require (résolution relative + extensions).
- **`class`** : définitions de classes.
- **`function` / `method`** : définitions de fonctions/méthodes.
- **`module`** : pour les fichiers qui exportent plusieurs symboles.

### 3.2 Arêtes
- `file →imports→ file` (import résolu).
- `class →inherits→ class` (héritage).
- `function/class →references→ function/class` (utilisation d'un symbole).
- `caller →calls→ callee` en **V1 limité aux appels explicites** détectés par
  regex (`foo(`, `this.method(`), résolus par portée simple → `INFERRED` si ambigu.

### 3.3 Langages V1
Réutilise la dispatch existante du Context Engine : **JS/TS, Python, Markdown**,
plus **Rust** (définitions `fn`/`struct`/`impl`/`use`) et **JSON/TOML** (manifests →
nœuds `module` + arêtes `depends_on`). Extensions : mêmes listes que H1.

### 3.4 Limites V1 (acceptées)
- Regex → faux positifs/négatifs possibles, surtout sur `calls` complexes.
- Pas de scoping précis (closures, surcharges) → beaucoup d'`INFERRED`.
- `calls` cross-fichiers limité (résolution par import + nom).

> Ces limites sont précisément ce que **V2 (tree-sitter)** corrige. V1 est un
> tremplin pour valider l'UX, la config, l'injection et les requêtes.

---

## 4. V2 — Tree-sitter (portage de l'idée graphify)

### 4.1 Dépendances Rust
- `tree-sitter` (bindings core) + grammaires pour les langages supportés
  (`tree-sitter-javascript`, `-typescript`, `-python`, `-rust`, `-json`,
  `-toml`, ...). Grammaires en arborescence C, compilées via `cc` au build.

### 4.2 Extraction AST
- Parser chaque fichier → arbre syntaxique.
- Walk : collecte **nœuds** (class/function/method/struct/impl/import/export) avec
  positions exactes (ligne de définition réelle).
- **Arêtes précises** :
  - `imports` : nœuds d'import/require → résolution relative (mêmes règles que H1).
  - `inherits` / `implements` : clauses de classe/interface.
  - `calls` : appels de fonctions/méthodes **résolus par portée** (receiver type,
    imports, exports) → `EXTRACTED` si cible unique, `INFERRED` sinon.
  - `references` : identifiants référencés.
- **Pass 2 de call-graph** (idée graphify) : résolution cross-fichier des appels
  par nom importé → arêtes `calls` `INFERRED`.

### 4.3 Mise à jour
- **Incremental** : `file_hash` par nœud → seuls les fichiers modifiés (mtime +
  SHA) sont re-parsés. Les nœuds/arêtes orphelins (fichier supprimé) sont purgés.
- **Watcher** (optionnel, V2.1) : le poller Rust existant (2 s) peut marquer les
  fichiers changés → rebuild différé.

### 4.4 Migration V1→V2
- La config `graph_extraction` (`"heuristic"` | `"treesitter"`) sélectionne le
  backend. Même schéma SQL → même requêtes, mêmes requêtes d'usage. Un rebuild
  complet (`build_code_graph --force`) régénère l'index avec le backend actif.

---

## 5. Requêtes (module pur Rust, testable)

Algèbre de graphe **indépendante du backend d'extraction** (V1 ou V2), portée de
l'idée graphify (`serve.py`).

| Commande | Comportement |
|---|---|
| `graph_explain(node)` | Nœud + ses voisins directs (label, relation, confidence) + source |
| `graph_affected(node, depth)` | **Traversée inverse** : nœuds dépendant de `node` (impact d'une modif). C'est l'usage le plus précieux pour pi/plh avant une édition. |
| `graph_path(a, b)` | Plus court chemin (BFS) entre deux nœuds. |
| `query_code_graph(prompt, budget)` | **Scoring par termes** (trigrammes + TF-IDF sur label/path) → seeds → BFS → sous-graphe rendu en Markdown compact. |

### 5.1 Scoring de la query (repris de graphify)
- Normalisation des termes (minuscules, accent-insensible).
- Index trigramme + IDF sur l'ensemble des nœuds → préliltre les candidats.
- Score combiné par nœud : match exact label > préfixe > token > source/path.
- `budget` tokens borne le sous-graphe rendu.

### 5.2 Format de sortie (Markdown compact, lisible par LLM)
```
### APIRouter (routing.py L2210) [function]
- →uses→ Dependant (main.py L88) [INFERRED]
- →calls→ .add_api_route() (routing.py L120) [EXTRACTED]
- ←imports← __init__.py [EXTRACTED]
```

---

## 6. Injection combinée à pi/plh (modes A + B)

Deux modes activables ensemble (décision utilisateur : « les deux combinés »).

### Mode A — sous-graphe scoré injecté au 1er prompt
- Au 1er prompt d'une session (flag `state.graphInjected`, reset parallèle aux
  autres), `query_code_graph(projectPath, prompt, budget)` renvoie le sous-graphe
  pertinent → converti en **bloc Markdown** → ajouté au `handoffBlocks`.
- Écrit dans `.pilot/context-inject.md` → l'extension `pilot-context`
  (`before_agent_start`) l'ajoute au `systemPrompt` (mécanisme H1/H3 existant,
  **aucun changement d'extension**).
- Format du bloc :
```
=== GRAPHE PROJET (structure — relations lues/déduites) ===
<bloc Markdown du sous-graphe>
=== FIN GRAPHE ===
```

### Mode B — wiki Markdown indexé (l'agent interroge à la demande)
- Génère un dossier `.pilot/graph-wiki/` (idée graphify `--wiki`) :
  - `index.md` : liste des nœuds par module + god-nodes (concepts les plus connectés).
  - un fichier par communauté/module : voisins et relations.
- Le bloc injecté (mode A) contient en tête un **lien vers `index.md`** et une
  consigne : « pour une question structurelle, consulte `<project>/.pilot/graph-wiki/`
  avant de lire les fichiers ».
- L'agent pi/plh peut alors lire le wiki via ses outils **à la demande** → coût
  zéro au 1er prompt, structure disponible tout au long de la session.

> **Budget** : le mode A borne strictement le sous-graphe injecté (budget
> `graph_budget_tokens`, défaut 4000). Le mode B ne coûte rien au prompt (seulement
> un chemin à suivre). Les deux combinés donnent à l'agent à la fois un aperçu
> pertinent **et** un accès complet à la structure.

---

## 7. Configuration (AppConfig) — paramétrable

| Champ | Type | Défaut | UI | Rôle |
|---|---|---|---|---|
| `code_graph_enabled` | bool | `true` | checkbox | Active l'extraction + injection du graphe |
| `graph_extraction` | enum | `"heuristic"` | select | `"heuristic"` (V1) ou `"treesitter"` (V2) |
| `graph_inject_mode_a` | bool | `true` | checkbox | Mode A : sous-graphe scoré au 1er prompt |
| `graph_budget_tokens` | u32 | `4000` | number | Budget du sous-graphe injecté (mode A) |
| `graph_inject_mode_b` | bool | `true` | checkbox | Mode B : générer le wiki + consigne de lecture |
| `graph_include_calls` | bool | `true` | checkbox | Extraire les arêtes `calls` |
| `graph_languages` | String | (défaut) | texte | Liste d'extensions séparées par espaces |

### Interactions
- `code_graph_enabled` est le **master switch**. Si `false` → aucune extraction,
  aucune injection, pas de wiki.
- Mode A et Mode B sont indépendants (on peut activer l'un sans l'autre).
- Le graphe ne dépend **pas** d'Ollama (contrairement au RAG H1 V2) : il marche
  hors-ligne, sans clé, sans service. C'est son atout structurel.

---

## 8. Reconstruction / maintenance du graphe

### 8.1 Bouton de (re)construction
- **Bouton 📊 « Code Graph »** dans la toolbar agent (à côté de 📑 Contexte / 📝
  Mémoire) : ouvre la modale du graphe avec état + actions.
- Bouton **« (Re)construire le graphe »** : `build_code_graph(projectPath,
  {force: true})` → purge + re-extraction complète avec le backend actif. Requis
  après changement de `graph_extraction` (V1↔V2) ou de langages.

### 8.2 Modale du graphe (état)
- `graph_status(projectPath)` → `{ exists, nodes, edges, built_at, extraction,
  incremental }`.
- Affiche : nombre de nœuds/arêtes, backend actif (heuristique/tree-sitter), date
  de construction, indicateur de fraîcheur.

### 8.3 Mise à jour incrémentale (au fil de l'eau)
- **Auto-lazy à la query** : avant d'injecter (mode A), `incremental_refresh()`
  compare mtime/SHA des fichiers au `file_hash` stocké → re-extrait uniquement les
  changés. Simple, robuste, aucune dépendance à un watcher.
- **Watcher (V2.1, ✅ implémenté)** : le poller Rust existant (2 s) détecte les
  changements sur les fichiers analysés (`is_graph_file`) → déclenche un
  `refresh_by_watcher` différé en arrière-plan (thread dédié + debounce 1,2 s,
  borné à 400 fichiers/poll). Ne construit pas le graphe s'il est absent
  (le build lazy frontend le fait au 1er prompt). Un verrou global
  (`GRAPH_DB_LOCK`) sérialise build/refresh/query → aucun « database is locked ».
- **Garde anti-gel** : comme le RAG, le build tourne en arrière-plan (thread),
  le 1er prompt ne le **jamais attendu** — si l'index est absent, le prompt part
  sans graphe (fallback silencieux), le build continue.
- **Protection anti-stack-overflow** : l'extraction V2 (tree-sitter) peut récurser
  profondément (parser C + `walk_v2`) sur les gros fichiers (ex: agent-pi.js
  ~360 Ko, 73 000 nœuds) → les threads du threadpool Tauri ont une petite pile.
  Le build/refresh/query s'exécutent donc dans un **thread à grande pile**
  (`run_on_big_stack`, 64 Mo) et `walk_v2` a une **garde de profondeur**
  (`MAX_AST_DEPTH = 512`) — corrige le stack overflow `0xc0000409`.

### 8.4 Fichiers générés
- `.pilot/context-index.db` (tables graph_nodes/graph_edges — partagée avec RAG).
- `.pilot/graph-wiki/` (mode B). `.pilot/` est git-ignoré.

---

## 9. Branchements (checklist d'intégration)

| Fichier | Action |
|---|---|
| `src-tauri/src/code_graph.rs` | **Nouveau** : extraction V1+V2, build, refresh, requêtes, commandes |
| `src-tauri/src/lib.rs` | Config AppConfig (8 champs) + `.manage` + enregistrer les commandes |
| `src-tauri/Cargo.toml` | (V2) dépendances tree-sitter + grammaires |
| `src/js/code-graph.js` | **Nouveau** : build bloc Markdown, wiki, modale, état |
| `src/js/agent-pi.js` | Injection mode A+B dans `handoffBlocks` ; flag `state.graphInjected` ; reset |
| `src/js/context-engine.js` | (réutilise la dispatch d'extensions/langages) |
| `src/js/settings.js` + `index.html` | Section « Code Graph » (6 réglages UI) — dont `graph_include_calls` |
| `AGENTS.md` | Arborescence + table de navigation |
| `spec_pilot.md` / `plan_dev.md` | Mise à jour doc |
| `spec_code_graph.md` (ce fichier) | Maintenu à jour |
| Bloc `<!-- HELP:code-graph -->` | Ajouté ici + regénérer handbook |

### Points de connexion à ne pas casser (l'existant à préserver)
- L'injection H1 (Context Engine) et H3 (mémoire) existantes — le graphe s'ajoute
  **en plus** dans le même `handoffBlocks`, ne remplace rien.
- La SQLite RAG (`chunks` / `meta`) — on **ajoute** des tables, on ne touche pas
  aux existantes.
- `pilot-context.ts` — inchangé (le bloc graphe arrive déjà dans
  `context-inject.md`).
- `project-memory.js`, `context-engine.js` — intacts.

---

## 10. Tests (qualité)

- **Rust (cargo test)** : tests unitaires sur les fonctions pures de `code_graph.rs`
  — extraction V1 (fixtures JS/Python/Rust/Markdown), build/upsert, incremental
  refresh (mtime/hash), requêtes (`explain`, `affected`, `path`, `query` scoring).
- **JS (Vitest)** : formateur Markdown du bloc graphe, construction du wiki,
  logique de config.
- **Anti-régression** : `cargo test --lib` + `npm test` avant merge.

---

## 11. Roadmap d'implémentation

1. ✅ **V1** : `code_graph.rs` extraction heuristique + SQLite + requêtes + commandes
   Tauri + config + injection mode A + wiki mode B + bouton/modale + tests.
2. ✅ **V2** : intégration tree-sitter (dépendances + `extract_v2`) + pass 2
   call-graph + switch `graph_extraction`.
3. ✅ **V2.1** : branchement watcher pour refresh différé auto
   (`refresh_by_watcher` + `is_graph_file` + verrou `GRAPH_DB_LOCK`).
4. Doc : AGENTS.md, README, bloc HELP, plan_dev.md.

---

<!-- HELP:code-graph -->
## Code Graph (graphe de connaissances projet)

Pilot construit localement un **graphe structurel** du projet (fichiers, fonctions,
classes, imports, appels) **sans LLM ni clé API**, et l'injecte à l'agent pour qu'il
réponde aux questions d'architecture **sans relire les fichiers** (économie de tokens).

- **Bouton 📊 Code Graph** (toolbar agent) : modale d'état du graphe + bouton
  « (Re)construire le graphe » (après un gros refactor ou un changement de mode).
- **Paramètres → Code Graph** :
  - *Activer le graphe* : master switch.
  - *Moteur d'extraction* : `heuristique` (rapide, sans dépendance) ou
    `tree-sitter` (plus précis, V2). Un rebuild est requis après changement.
  - *Inclure les appels de fonctions* : inclut ou non les arêtes `calls`.
    Désactiver allège le sous-graphe injecté (économie de tokens) ; un rebuild
    est requis.
  - *Injection au 1er prompt* (mode A) : un sous-graphe pertinent au prompt est
    ajouté au contexte (budget configurable).
  - *Wiki interrogeable* (mode B) : un dossier `.pilot/graph-wiki/` est généré ;
    l'agent peut le consulter à la demande via ses outils.
- **Relations honnêtes** : chaque lien est marqué `EXTRACTED` (lu dans le code) ou
  `INFERRED` (déduit).
- **Mise à jour au fil de l'eau** : le graphe se re-synchronise automatiquement sur
  les fichiers modifiés (incrémental à la requête + refresh auto via le watcher de
  fichiers). Il ne bloque jamais le chat et fonctionne sans Ollama (contrairement au RAG).
<!-- /HELP:code-graph -->
