# Spécification — Mémoire de projet auto-maintenue (H3)

> `PROJECT_MEMORY.md` : fichier de mémoire projet **tenu par l'agent** (conventions,
> pièges, décisions d'architecture, dépendances clés, anti-patterns). Enrichi
> automatiquement après chaque tâche d'orchestration (extraction de 1–3 faits),
> injecté dans le contexte de l'agent avant chaque nouvelle tâche (orchestration)
> et avant le 1er prompt de chaque session (chat standard). Complément de H1
> (Context Engine = contexte *statique* du projet ; H3 = mémoire *apprise*).

## 1. Objectif

Les coding-agents souffrent d'un défaut n°1 : l'absence de mémoire persistante.
Chaque session repart de zéro, oublie les conventions et pièges déjà rencontrés.
H3 corrige cela en maintenant, **dans le projet**, un fichier vivant que l'agent
lit avant d'agir et écrit après avoir appris quelque chose.

Le fichier est **git-committable** (à la racine du projet, comme `AGENTS.md`) :
la mémoire devient institutionnelle et partagée entre collaborateurs / machines.

## 2. Fichier `PROJECT_MEMORY.md`

### 2.1 Emplacement

Racine du projet : `<projectPath>/PROJECT_MEMORY.md`.

### 2.2 Format (template initial)

```markdown
# Mémoire du projet — tenue par l'agent

> Conventions, pièges, décisions d'architecture, dépendances clés, anti-patterns.
> Ce fichier est enrichi automatiquement après chaque tâche d'orchestration et
> injecté dans le contexte de l'agent. Tu peux l'éditer manuellement.

## Conventions
- (à compléter par l'agent)

## Pièges / anti-patterns
- (à compléter par l'agent)

## Décisions d'architecture
- (à compléter par l'agent)

## Dépendances clés
- (à compléter par l'agent)
```

### 2.3 Création

Le fichier est créé à la demande (template) :
- au clic sur le bouton **📝** de la toolbar agent (ouvre le fichier dans
  l'éditeur ; créé s'il n'existe pas) ;
- automatiquement avant la 1ère extraction auto (l'agent utilise `CREATE:` si le
  fichier est absent).

Pas de création implicite au démarrage : on évite de polluer les projets où H3
est activé mais inutilisé.

## 3. Configuration (`AppConfig`)

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `project_memory_enabled` | bool | `true` | Active l'injection de la mémoire dans le contexte (chat + orchestration) |
| `project_memory_auto_extract` | bool | `false` | Active l'extraction automatique de faits après chaque tâche d'orchestration (coût : 1 tour LLM supplémentaire par tâche). Opt-in. |

L'injection et l'extraction sont **indépendantes** : on peut injecter sans
extraire (mémoire maintenue manuellement), mais extraire sans injecter n'a
peu de sens (l'extraction est donc sous-ensemble de l'activation).

## 4. Injection dans le contexte

### 4.1 Chat standard (H1 path)

Avant le 1er prompt d'une session, Pilot construit un bloc mémoire et le prépend
au message (après le bloc Context Engine H1, avant le texte utilisateur) :

```
=== MÉMOIRE DU PROJET (tenue par l'agent — conventions, pièges, décisions) ===
<contenu de PROJECT_MEMORY.md>
=== FIN MÉMOIRE ===
```

- Gated by `project_memory_enabled` (indépendant de `context_engine_enabled`).
- Injecté **une fois par session** (flag `state.memoryInjected`), reset sur
  new-session / compact / reconnect / changement de projet (parallèle à
  `state.contextInjected`).
- Si le fichier n'existe pas → pas d'injection (silencieux).

### 4.2 Mode Orchestration

Avant chaque tâche (codeur ET escalade orchestrateur), le bloc mémoire est
prépendu au prompt de tâche (après compactage, donc préservé intact) :

```
=== MÉMOIRE DU PROJET (tenue par l'agent — conventions, pièges, décisions) ===
<contenu>
=== FIN MÉMOIRE ===

<prompt de tâche>
```

- Lu **à chaque tâche** (fichier petit, lecture cheap) → reflète les
  enrichissements faits en cours de plan.
- Gated by `project_memory_enabled`.
- Le Mode Orchestration construit son propre contexte (H1 n'interfère pas) ;
  H3 s'ajoute simplement en tête de prompt de tâche.

## 5. Extraction automatique post-tâche (opt-in)

### 5.1 Déclencheur

Après qu'une tâche d'orchestration est validée **réussie** (DONE ou fichiers
modifiés), si `project_memory_auto_extract` est activé, Pilot envoie un tour
LLM dédié au codeur (session en cours) demandant d'extraire 1–3 faits appris et
de les ajouter à `PROJECT_MEMORY.md` via `SEARCH/REPLACE` / `CREATE`.

### 5.2 Prompt d'extraction

```
Tu viens de terminer la tâche « <title> ».
Avant de passer à la suite, extrais 1 à 3 faits utiles appris pendant cette
tâche (convention de code, piège rencontré, décision d'architecture, dépendance
clé découverte, anti-pattern à éviter). Place chaque fait dans la section
appropriée de PROJECT_MEMORY.md (Conventions / Pièges / Décisions /
Dépendances) via un bloc SEARCH/REPLACE (ou CREATE si le fichier n'existe pas).

Règles :
- 1 ligne par fait, impérativement concis.
- N'ajoute QUE du nouveau ; ne répète pas ce qui est déjà dans le fichier.
- Si rien de nouveau n'a été appris, réponds exactement : NO_NEW_MEMORY.
- Ne modifie aucun autre fichier.

Tâche terminée : <title>
Résumé de la tâche : <résumé DONE>
```

### 5.3 Machine à états

- Flag `state.orchestrationExtractingMemory = <taskId>` (null sinon).
- Envoi du prompt → `return` (on ne passe pas à `executeNextTask`).
- Sur l'`agent_end` suivant, `handleOrchestrationAgentEnd` détecte le flag en
  **tête de fonction** (avant tout traitement de tâche) :
  1. Parse `parseSearchReplaceBlocks(responseText)`.
  2. Si blocs → `applySearchReplaceBlocks` (écrit `PROJECT_MEMORY.md`) ;
     message système `📝 Mémoire projet mise à jour`.
  3. Sinon (`NO_NEW_MEMORY` ou réponse libre) → `📝 Mémoire projet : rien de nouveau`.
  4. Clear le flag, `executeNextTask` (on reprend le flux normal).
- En cas d'erreur d'envoi → clear le flag, `executeNextTask` (non-bloquant).

### 5.4 Interaction avec A4 (porte pré-écriture)

En Mode Orchestration, la porte `confirm_file_edits` est **auto-approuvée** →
l'écriture de `PROJECT_MEMORY.md` par le codeur ne déclenche pas de dialogue.
Pas de conflit.

## 6. UI

### 6.1 Toolbar agent

Bouton **📝** (title « Mémoire projet : ouvrir/éditer PROJECT_MEMORY.md ») :
- au clic, crée le fichier (template) s'il n'existe pas, puis l'ouvre dans
  l'éditeur (onglet d'édition) via `window._pilotTabs.openFile(absPath, "edit")`.
- Indépendant de `project_memory_enabled` (permet de consulter/éditer même si
  l'injection est désactivée).

### 6.2 Paramètres

Dans la colonne « Agent Pi ou PLh », section Context Engine (ou juste après),
deux checkboxes :
- `☐ Mémoire de projet : injecter PROJECT_MEMORY.md dans le contexte agent`
  (`setting-project-memory-enabled`)
- `☐ Extraction auto après chaque tâche d'orchestration` (`setting-project-memory-auto-extract`)

## 7. Robustesse

- Fichier absent → pas d'injection (silencieux), pas de crash.
- Fichier illisible → `console.warn`, pas de crash.
- Extraction qui échoue (erreur envoi / réponse incohérente) → non-bloquant,
  le plan continue.
- L'agent n'est **jamais forcé** : l'extraction est un *request* ; si l'agent
  répond `NO_NEW_MEMORY`, on accepte.
- Pas de dépendance circulaire : `project-memory.js` n'importe que `@tauri-apps/api/core`.

## 8. Limites V1 / futures

- V1 : extraction uniquement en Mode Orchestration (pas en chat standard —
  un chat n'a pas de notion de « tâche terminée » nette). Un bouton manuel
  « extraire maintenant » pourrait être ajouté en V2.
- V1 : pas de plafond strict du fichier (l'agent est invité à être concis).
  Un trim automatique (ex: max 200 lignes, oldest en premier) = V2.
- V2 : embeddings/RAG (cf. H1 V2) pour scorer la pertinence de chaque fait
  avant injection (ne garder que les faits liés à la tâche courante).

<!-- HELP:project-memory -->
### 📝 Mémoire de projet (H3)

Pilot maintient un fichier `PROJECT_MEMORY.md` à la racine du projet, enrichi
par l'agent (conventions, pièges, décisions) et injecté automatiquement dans le
contexte de l'agent.

- **Bouton 📝** (toolbar agent) : ouvre/édite `PROJECT_MEMORY.md` (créé avec un
  template s'il n'existe pas). Éditable manuellement.
- **Paramètres → Agent Pi ou PLh** :
  - *Mémoire de projet* : active l'injection du fichier avant chaque tâche
    (orchestration) et avant le 1er prompt d'une session (chat).
  - *Extraction auto* : après chaque tâche d'orchestration réussie, l'agent
    extrait 1–3 faits appris et les ajoute au fichier (1 tour LLM
    supplémentaire ; opt-in).
- Le fichier est git-committable : la mémoire devient partagée entre
  collaborateurs et machines.
<!-- /HELP:project-memory -->