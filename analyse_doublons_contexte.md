# Analyse — Doublons d'injection de contexte (RAG / AGENTS.md / PROJECT_MEMORY.md / Code Graph)

> **Statut : ✅ Corrigé (2026-08)** — les 2 recommandations ont été appliquées
> (exclusion RAG de AGENTS.md/PROJECT_MEMORY.md + déduplication boost/chunks).
> Analyse initiale conservée ci-dessous pour référence.

## 1. Vue d'ensemble des 4 mécanismes

| Mécanisme | Qui l'injecte | Contenu | Quand | Canal |
|---|---|---|---|---|
| **AGENTS.md** | **pi/plh nativement** (`resource-loader.ts` / `project_context.rs`) | instructions projet, arborescence, table de navigation | à chaque tour | system prompt |
| **Context Engine (H1)** | Pilot → `.pilot/context-inject.md` → extension `pilot-context.ts` | V1 : `.pilot/context.md`, fichier actif, imports, manifestes, specs, fichiers récents. **RAG (V2)** : boost structurel + chunks par similarité cosinus | 1×/session (flag `contextInjected`) | system prompt |
| **PROJECT_MEMORY.md (H3)** | Pilot → `buildMemoryBlock` → même handoff | conventions, pièges, décisions, dépendances (mémoire *apprise*) | 1×/session (flag `memoryInjected`) | system prompt |
| **Code Graph** | Pilot → `buildGraphBlock` → même handoff | sous-graphe compact (nœuds + arêtes, relations `EXTRACTED`/`INFERRED`) + lien wiki | 1×/session (flag `graphInjected`) | system prompt |

**Assemblage** : les blocs mémoire + contexte + graphe sont concaténés dans
`handoffBlocks`, écrits dans `.pilot/context-inject.md`, puis l'extension
`pilot-context.ts` les ajoute au `event.systemPrompt` de chaque tour. AGENTS.md,
lui, est injecté **séparément** par pi/plh.

## 2. Analyse des doublons

### 🔴 Doublon 1 — RAG vs AGENTS.md (RÉEL, à corriger)
Le RAG indexe **tous** les fichiers `.md` du projet (`INDEXED_EXT` contient
`"md"`, et `walk_project` n'exclut **ni** `AGENTS.md` **ni** `PROJECT_MEMORY.md`).
La requête cosinus (`query_index_blocking`) peut donc retourner des **chunks
d'AGENTS.md**.

Or :
- **V1** exclut explicitement AGENTS.md (commentaire dans `context-engine.js` :
  *« AGENTS.md n'est PAS inclus ici : pi et plh le découvrent et l'injectent
  nativement… Le réinjecter via Pilot créerait un doublon »*).
- **Le RAG, lui, ne l'exclut PAS.** → Incohérence : le contenu d'AGENTS.md peut
  apparaître **2 fois** (une fois via pi natif, une fois via un chunk RAG).

### 🔴 Doublon 2 — RAG vs PROJECT_MEMORY.md (RÉEL, à corriger)
Même cause : `PROJECT_MEMORY.md` est un fichier `.md` à la racine, donc **indexé
par le RAG**. Or il est déjà injecté séparément via `buildMemoryBlock`. → Le
contenu de la mémoire peut apparaître **2 fois** (bloc H3 + chunk RAG).

### 🟡 Doublon 3 — Boost structurel RAG vs chunks RAG (mineur)
En mode RAG, le préambule injecte le **boost structurel** (`.pilot/context.md` +
manifestes `package.json`, `Cargo.toml`…) **puis** les chunks RAG. Un manifeste
déjà présent dans le boost peut aussi être retourné comme chunk RAG → doublon
partiel possible. (Le V1 évite ce cas via le contrôle `sections.some(...)` ; le
RAG ne le fait pas.)

### 🟢 Doublon 4 — Code Graph vs RAG (complémentaire, pas un doublon)
Le graphe injecte de la **structure** (nœuds, arêtes, relations), **jamais le
contenu des fichiers**. Le RAG injecte des **passages de contenu**. Pas de
doublon littéral — c'est le positionnement assumé de la spec (*« RAG =
sémantique, Graphe = structurel »*).

### 🟢 Doublon 5 — AGENTS.md vs PROJECT_MEMORY.md (par conception)
Rôles distincts (règles vs mémoire apprise). Le prompt d'extraction H3 demande
explicitement de *« NE DUPLIQUE PAS ce qui est déjà dans AGENTS.md »*. Risque
faible, dépend de la discipline de l'agent.

### 🟢 Doublon 6 — RAG vs V1 (mutuellement exclusifs)
Si RAG activé + Ollama dispo → RAG ; sinon → V1. Jamais les deux. Pas de doublon.

### 🟢 Doublon 7 — Orchestration vs chat standard (séparés)
En orchestration, le handoff (`context-inject.md`) **n'est pas utilisé** (spec :
*« Chat standard uniquement »*). L'orchestration injecte `PROJECT_MEMORY.md`
(memBlock) en tête de chaque tâche + plan + arborescence + fichiers clés. Le RAG
et le graphe **ne sont pas** injectés en orchestration. → Pas de doublon entre
les deux modes. (AGENTS.md reste injecté nativement par pi dans les deux cas,
mais c'est le même fichier, pas un doublon.)

## 3. Conclusion

**2 doublons réels**, tous deux causés par la même cause racine : **le RAG indexe
`AGENTS.md` et `PROJECT_MEMORY.md`**, alors que ces deux fichiers sont déjà
injectés par d'autres canaux (pi natif pour AGENTS.md, H3 pour PROJECT_MEMORY.md).
Le V1 avait prévu l'anti-doublon pour AGENTS.md, mais le RAG (ajouté ensuite) ne
l'a pas hérité.

## 4. Recommandations (appliquées 2026-08)

1. ✅ **Exclure `AGENTS.md` et `PROJECT_MEMORY.md` de l'indexation RAG**
   (`is_excluded_from_rag` dans `walk_rec` de `src-tauri/src/context_engine.rs`),
   comme le fait déjà le V1 pour AGENTS.md. + test Rust `rag_excludes_agents_and_project_memory`.
2. ✅ **Dédupliquer les chunks RAG dont le chemin est déjà présent dans le boost
   structurel** (`filterRagChunksByPath` dans `src/js/context-engine.js`).
   + tests JS.

## 5. Fichiers concernés

| Fichier | Rôle |
|---|---|
| `src-tauri/src/context_engine.rs` | indexation RAG (`walk_project`, `is_indexed`, `INDEXED_EXT`) — à exclure AGENTS.md / PROJECT_MEMORY.md |
| `src/js/context-engine.js` | V1 (déjà anti-doublon AGENTS.md) + boost structurel RAG |
| `src/js/project-memory.js` | injection H3 (`buildMemoryBlock`) |
| `src/js/code-graph.js` | injection graphe (`buildGraphBlock`) |
| `src-tauri/extensions/pilot-context.ts` | ajout du handoff au system prompt |
| `spec_context_engine.md` | doc à mettre à jour après correction |
