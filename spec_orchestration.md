# Mode Orchestration — Spécifications

> **Statut : ✅ Implémenté** — Phases 1-4 terminées le 2026-06-18. **Mode Orchestration V2** ajouté le 2026-06-26.
>
> Architecture « Architecte + Ouvrier » : un modèle cloud intelligent planifie, un modèle local économique exécute.

---

## 1. Concept

L'utilisateur active le **Mode Orchestration** dans l'onglet Agent Pi. Une seule session RPC est utilisée, et on bascule de modèle selon qui doit parler :

```
┌──────────────────────────────────────────────────────────────┐
│  Utilisateur                                                 │
│  "Crée une API REST pour gérer des tâches"                   │
│                         │                                    │
│                         ▼  set_model(orchestrator)            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  🧠 ORCHESTRATEUR (cloud, ex: DeepSeek V4)           │   │
│  │  → Analyse la demande                                 │   │
│  │  → Produit un plan détaillé en micro-tâches           │   │
│  │  → Pour chaque tâche : titre, description, fichiers   │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│                         ▼  (plan affiché dans le chat)       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  📋 PLAN (liste de tâches avec cases à cocher)        │   │
│  │  ☐ Tâche 1 : Créer le modèle de données               │   │
│  │  ☐ Tâche 2 : Implémenter le contrôleur GET /tasks     │   │
│  │  ☐ Tâche 3 : Implémenter POST /tasks                  │   │
│  │  ☐ Tâche 4 : Ajouter la validation                    │   │
│  │  ☐ Tâche 5 : Écrire les tests                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│                         ▼  set_model(coder)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  🔨 CODEUR (local, ex: Qwen via llama-cpp)            │   │
│  │  → Reçoit la tâche N avec le contexte nécessaire       │   │
│  │  → Lit/écrit les fichiers du projet                   │   │
│  │  → Succès → tâche suivante                            │   │
│  │  → Échec ×2 → set_model(orchestrator) → escalade      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  🔑 Clé : UNE SEULE SESSION — même historique, même chat     │
│     On bascule de modèle avec set_model() selon les besoins │
└──────────────────────────────────────────────────────────────┘
```

### Principe fondamental

- **Une seule session `pi --mode rpc`** — pas de deuxième processus.
- **On bascule de modèle** via la commande existante `set_model(provider, modelId)`.
- **Même historique** — l'orchestrateur et le codeur partagent la conversation. Le codeur voit les messages précédents et le plan.
- **Tout est visible** dans le même chat : l'utilisateur contrôle et comprend tout.

---

## 2. Architecture technique

### 2.1 Session unique — bascule de modèle

| Action | Modèle | Commande RPC |
|---|---|---|
| Planification | Orchestrateur (cloud) | `set_model(orchestrator_provider, orchestrator_model_id)` puis `prompt(message)` |
| Exécution tâche | Codeur (local) | `set_model(coder_provider, coder_model_id)` puis `prompt(taskMessage)` |
| Escalade (échec codeur) | Orchestrateur (cloud) | `set_model(orchestrator_provider, orchestrator_model_id)` puis `prompt(escaladeMessage)` |

Aucune modification de `rpc_manager.rs`. Aucun nouveau processus. On utilise uniquement la commande `set_model` qui existe déjà.

### 2.2 Aucune modification du backend Rust

Les commandes Tauri existantes suffisent :

| Commande | Rôle dans le workflow |
|---|---|
| `start_agent_session` | Lancer la session RPC (inchangé) |
| `send_agent_prompt` | Envoyer un prompt (inchangé) |
| `set_agent_model` | Basculer entre orchestrateur et codeur |
| `abort_agent` | Annuler la tâche en cours |
| `get_agent_state` | Vérifier l'état (streaming ou non) |
| `list_agent_models` | Lister les modèles disponibles |

**Seul ajout backend** : les 5 champs de config dans `AppConfig` (voir §2.3) et la commande `set_orchestration_model` qui enchaîne `set_model` + log.

### 2.3 Configuration (`AppConfig`)

Nouveaux champs uniquement :

```rust
#[serde(default)]
orchestration_enabled: bool,        // Mode orchestration activé par défaut ?
#[serde(default)]
orchestrator_provider: String,      // Provider du modèle intelligent (ex: "deepseek")
#[serde(default)]
orchestrator_model_id: String,      // Modèle intelligent (ex: "deepseek-chat")
#[serde(default)]
coder_provider: String,             // Provider du modèle codeur (ex: "llamacpp")
#[serde(default)]
coder_model_id: String,             // Modèle codeur (ex: "qwen2.5-coder-7b")
#[serde(default = "default_orchestration_idle_timeout")]
orchestration_idle_timeout_ms: u32, // Timeout d'inactivité du codeur (ms, défaut 120000)
#[serde(default = "default_orchestration_revision_interval")]
orchestration_revision_interval: u32, // Révision mid-plan toutes les N tâches (défaut 5, 0 = désactivé)
```

Ces champs sont utilisés uniquement par le frontend pour savoir quel modèle appeler via `set_agent_model`.

### 2.4 Flux d'événements

Tout passe par le même canal `rpc-event` existant. Le frontend gère la logique de bascule.

**Clé : chaque tour d'orchestration démarre avec un contexte vierge** via `new_session`.
Le codeur et l'orchestrateur ne voient que le prompt qu'on leur envoie,
pas l'historique complet de la conversation.

```
┌──────────┐  new_session              ┌──────────┐
│ Frontend │ ─────────────────────────▶│ Pi RPC   │
│ (JS)     │  set_model(orchestrator)  │ (1 seule  │
│          │ ─────────────────────────▶│  session) │
│          │  prompt(planRequest)      │           │
│          │ ─────────────────────────▶│           │
│          │◀─────────────────────────│           │
│          │  [plan JSON reçu]         │           │
│          │                           │           │
│          │  new_session               │           │
│          │ ─────────────────────────▶│           │
│          │  set_model(coder)         │           │
│          │ ─────────────────────────▶│           │
│          │  prompt(tâche 1)          │           │
│          │ ─────────────────────────▶│           │
│          │◀─────────────────────────│           │
│          │  [réponse codeur reçue]  │           │
│          │                           │           │
│          │  new_session               │           │
│          │ ─────────────────────────▶│           │
│          │  set_model(coder)         │           │
│          │ ─────────────────────────▶│           │
│          │  prompt(tâche 2)          │           │
│          │ ─────────────────────────▶│           │
│          │  ...                      │           │
└──────────┘                           └──────────┘
```

Cela signifie :
- Le codeur ne voit que le prompt de la tâche (avec fichiers + résumés injectés)
- L'orchestrateur en escalade ne voit que le prompt d'escalade
- Pas de contamination par l'historique accumulé
- Économie significative de tokens

---

## 3. Format du plan

L'orchestrateur doit produire un **plan structuré en JSON**. Le prompt système inclura cette contrainte de format.

### 3.1 Structure

```json
{
  "plan": [
    {
      "id": 1,
      "title": "Créer le modèle de données Task",
      "description": "Créer la classe Task avec id, title, done, created_at",
      "files": ["src/models/task.py"],
      "context": "Utilise dataclasses, le projet est en Python 3.10+",
      "depends_on": []
    },
    {
      "id": 2,
      "title": "Implémenter GET /tasks",
      "description": "Route Flask retournant la liste des tâches en JSON",
      "files": ["src/app.py", "src/models/task.py"],
      "context": "Flask est déjà installé, utiliser le modèle Task créé à l'étape 1",
      "depends_on": [1]
    }
  ]
}
```

### 3.2 Champs

| Champ | Type | Description |
|---|---|---|
| `id` | int | Numéro de tâche (séquentiel) |
| `title` | string | Titre court (max 80 car.) |
| `description` | string | Description détaillée de ce qu'il faut faire |
| `files` | string[] | Fichiers concernés (à lire ou modifier) |
| `context` | string | Contexte technique supplémentaire |
| `depends_on` | int[] | IDs des tâches prérequises |

### 3.3 Prompt orchestrateur

Si l'orchestrateur renvoie un JSON invalide lors de la planification, le frontend
lui renvoie automatiquement (jusqu'à 2 fois) le message exact :

```
Le json renvoyé n'est pas bon, recommence
```

Le prompt envoyé à l'orchestrateur inclut désormais **l'arborescence filtrée du projet** (point C) afin qu'il liste des fichiers réels existants plutôt que des suppositions. L'arborescence est filtrée (dossiers `node_modules`, `.git`, `target`, `dist`, etc. ignorés) et limitée en profondeur (point H). Voir `buildPlanPrompt` dans `orchestration.js`.

Le prompt a été **renforcé (point O)** pour imposer un découpage réellement fin :

- Principe clé explicite : une micro-tâche = une seule petite chose, ~30-60 lignes, max 2 fichiers. Au-delà → découper.
- Fourchette conseillée : **5 à 25 tâches** selon l'ampleur (jamais une tâche géante pour un projet entier).
- Description **structurée** exigée : sous-étapes, signatures de fonctions/classes, comportements attendus, cas d'erreur. Une description d'une ligne est déclarée insuffisante.
- **Exemple positif ET négatif** intégrés au prompt (bon découpage d'API REST vs mauvais découpage vague) pour ancrer la notion de micro-tâche.

```
Tu es un architecte logiciel. Analyse la demande utilisateur et produis
un plan de développement détaillé découpé en MICRO-TÂCHES.

PRINCIPE CLÉ — une micro-tâche = UNE seule petite chose à faire, réalisable
en ~30-60 lignes... Si une tâche nécessite plus de 2 fichiers ou plus de
~60 lignes, DÉCOUPE-LA...

Règles de découpage :
- Vise 5 à 25 tâches selon l'ampleur. Ne JAMAIS une seule tâche géante.
- Chaque tâche : max 2 fichiers.
- Description STRUCTURÉE (sous-étapes, signatures, cas d'erreur).
- Contexte complet pour un codeur moins puissant.
...

EXEMPLE DE BON DÉCOUPAGE (à imiter) : ...
MAUVAIS DÉCOUPAGE (à éviter absolument) : ...

Format obligatoire :
{"plan": [{"id": 1, "title": "...", "description": "...", "files": [...],
"context": "...", "depends_on": [...]}, ...]}

Demande utilisateur : {USER_PROMPT}
```

Après parsing, le plan est soumis à une **validation de qualité (point L)** via `validatePlan` : descriptions trop courtes (<40 car.), tâches avec >3 fichiers, plan suspectement petit (<3 tâches pour une demande longue) → avertissements affichés dans le chat à l'utilisateur. L'exécution continue (la subdivision automatique au moment des échecs corrige les tâches trop grossières).

---

## 4. Workflow d'exécution

### 4.1 Diagramme de séquence

```
User → [prompt] → set_model(orchestrator) → prompt(planRequest + arborescence)
Orchestrateur → [plan JSON normalisé] → affichage dans le chat + liste de tâches
Pour chaque tâche (selon depends_on) :
  set_model(coder) → capture état fichiers → prompt(taskMessage)
  Codeur → [réponse] → validation fichiers (file_exists + file_mtime)
    si DONE + fichiers modifiés → tâche suivante
    si NEED_HELP ou timeout d'inactivité → retry (max 2)
    si 2 échecs → set_model(orchestrator) → prompt(escalade) → orchestrateur fait la tâche
Tous les N tâches terminées → set_model(orchestrator) → révision mid-plan du plan restant
Fin du plan → métriques (réussies codeur / escaladées / tentatives totales)
```

### 4.2 Algorithme (frontend `agent-pi.js` + `orchestration.js`)

Les fonctions pures (construction de prompts, parsing/normalisation du plan, filtrage d'arborescence, extraction de résumés, validation fichiers, sélection de tâche, fusion de révision, métriques) sont dans `src/js/orchestration.js`. Les fonctions runtime (bascule de modèle, boucle d'exécution, gestion UI) restent dans `agent-pi.js`.

```javascript
async function executePlan(plan) {
  while (true) {
    const doneIds = new Set([...progress.completed, ...progress.escalated]);
    // Respecte depends_on : première tâche dont toutes les deps sont terminées (point D)
    const task = pickNextTask(plan.tasks, doneIds);
    if (!task) {
      if (isPlanBlocked(plan.tasks, doneIds)) { /* pause : cycle/dépendance échouée */ break; }
      // Plan terminé — métriques finales (point K)
      appendSystemMessage(summarizePlan(progress, plan.tasks.length));
      break;
    }
    // Capturer l'état des fichiers avant exécution (validation post-tâche, point A)
    const before = await captureFileState(task, invoke);
    let attempts = 0, success = false;
    while (attempts < 2 && !success) {
      attempts++;
      await switchToCoder();
      await clearContext();
      const result = await sendTask(task, attempts); // démarre le timer d'inactivité (point B)
      if (result.status === 'DONE') {
        const v = await checkTaskFilesChanged(task, before, invoke);
        if (v.ok) { markCompleted(task); success = true; }
        else { /* échec validation */ }
      } else if (result.status === 'NEED_HELP') {
        /* échec */
      } else {
        // pas de marqueur : on valide quand même les fichiers
        const v = await checkTaskFilesChanged(task, before, invoke);
        if (v.ok) { markCompleted(task); success = true; } else { /* échec */ }
      }
    }
    if (!success) {
      // Escalade à l'orchestrateur
      await switchToOrchestrator();
      await escalate(task, result.errors);
      markEscalated(task);
    }
    // Révision mid-plan (point E) : tous les N tâches terminées
    if (++tasksSinceRevision >= revisionInterval && remaining > 0) {
      await switchToOrchestrator();
      const revised = await revisePlan(plan, projectTree);
      plan = mergeRevisedPlan(plan, revised);
      tasksSinceRevision = 0;
    }
  }
}
```

**Timeout d'inactivité (point B)** : le timer n'est pas une durée totale mais un délai d'inactivité — il est **reset à chaque `text_delta` reçu** du codeur. Un codeur qui stream pendant 5 min sans interruption ne sera donc jamais tué. Durée configurable via `orchestration_idle_timeout_ms` (défaut 120000 ms). Le timer ne s'applique pas pendant la révision mid-plan (l'orchestrateur cloud est fiable).

### 4.3 Prompt codeur

Pour chaque tâche, le prompt envoyé au codeur est enrichi avec :

1. **Le contenu des fichiers concernés** — lus automatiquement avant l'envoi
2. **Les résumés des tâches précédentes terminées** — pour que le codeur sache ce qui a déjà été fait
3. **L'arborescence du projet** (3 niveaux de profondeur)

```
Tu es un développeur qui exécute une micro-tâche précise.

Tâche : {task.title}
Description : {task.description}
Fichiers concernés : {task.files}
Contexte : {task.context}

=== TÂCHES PRÉCÉDENTES TERMINÉES ===
#1 : Créer le modèle User — Fichier app/models/user.ts créé
#2 : Ajouter les routes CRUD — Fichier app/routes/users.ts créé

=== CONTENU DES FICHIERS CONCERNÉS ===
--- src/app.ts ---
...contenu du fichier...

--- src/models/user.ts ---
...contenu du fichier...

=== ARBORESCENCE DU PROJET ===
📁 src/
  📁 models/
    📄 user.ts
  📁 routes/
    📄 users.ts
  📄 app.ts

Règles :
- Tu peux lire les fichiers du projet avec les outils à ta disposition
- Écris/modifie UNIQUEMENT les fichiers nécessaires à cette tâche
- Produis du code fonctionnel et propre
- OBJECTIF DE TAILLE : ~30-60 lignes de code pour cette tâche. Si tu te rends
  compte qu'elle est trop grosse pour cette taille, fais d'abord la partie
  principale puis signale NEED_HELP: "tâche trop grosse, demander un découpage"
  plutôt que d'essayer de tout faire d'un coup.
- Si tu as terminé, inclus DONE: <résumé> dans ta réponse
- Si tu es bloqué, inclus NEED_HELP: <question> dans ta réponse

Commence.
```

Chaque fichier est limité à 500 lignes (les fichiers plus longs sont tronqués avec une indication du nombre de lignes omises). Les résumés sont extraits automatiquement du texte après `DONE:` dans les réponses précédentes.

L'**objectif de taille explicite (point O)** dans le prompt codeur complète le renforcement du prompt planificateur : si la tâche est réellement trop grosse, le codeur est invité à s'arrêter et à demander un découpage plutôt que de générer indéfiniment (ce qui mènerait au timeout d'inactivité).

### 4.4 Gestion des réponses du codeur

| Réponse | Action |
|---|---|
| `DONE: ...` | Succès **sous réserve de validation** : on vérifie qu'au moins un fichier listé a été créé/modifié (via `file_exists` + `file_mtime`). Si OK → cocher la tâche, passer à la suite. Si KO → traité comme échec (tentative). |
| `NEED_HELP: ...` | Considéré comme échec → incrémente tentatives |
| Timeout d'inactivité (configurable) | Échec → incrémente tentatives. Le timer est **reset à chaque `text_delta` reçu**, donc c'est un timeout d'inactivité (pas une durée totale). |
| Aucun marqueur mais fichiers modifiés | Succès (le codeur a écrit le code sans mettre le marqueur) |
| Aucun marqueur ET aucun fichier modifié | Échec (le codeur n'a rien produit de concret) → tentative |
| **Erreur de connexion** (`auto_retry_start` avec `errorMessage: "Connection error."`) | **Mise en pause du plan** (si tâche en cours) ou **message d'erreur clair** (si construction du plan) avec « 🔌 Codeur/Orchestrateur injoignable (modèle) » (point Q). Les retries automatiques de pi sont stoppés via `abort_agent`. La tâche n'est PAS marquée effectuée. L'utilisateur relance le serveur puis réessaie (ou clique ▶️ pour reprendre). |

**Validation post-tâche (point A)** : avant d'envoyer une tâche au codeur, on capture l'état des fichiers listés (`{ exists, mtime }`). Au `DONE:`, on revérifie. Si aucun fichier **listé** n'a été créé ni modifié, on assouplit en examinant les **fichiers mentionnés dans la réponse DONE** (`extractMentionedFiles`) : si l'un d'eux existe sur disque (cas typique : le codeur improvise un fichier non listé, ex. « consigné dans `project.md` »), la tâche est validée avec le reason « fichier mentionné dans la réponse DONE : … ». Cela évite les escalades inutiles quand le codeur écrit dans un fichier que l'orchestrateur n'avait pas listé. Cette validation ne s'applique **qu'au codeur** ; pour l'escalade on fait confiance à l'orchestrateur (qui peut improviser des fichiers non listés).

**Résolution des chemins (critique)** : les `task.files` et les fichiers mentionnés sont **relatifs au projet ouvert**, mais les commandes Tauri `file_exists` / `file_mtime` / `read_file_content` s'exécutent dans le **cwd du process Tauri** (le dossier de lancement de l'app, qui n'est PAS le projet ouvert). Sans résolution, la validation échouait systématiquement (tout était vu « inchangé » → escalades injustifiées à chaque tâche). On résout donc chaque chemin en absolu via `resolvePath(path, window._pilotProjectPath)` avant d'invoquer. Les chemins déjà absolus (Windows `X:\`, UNC, Unix `/`) sont laissés tels quels.

### 4.5 Échec de tâche : subdivision puis escalade (point M)

Quand le codeur échoue 2 fois (NEED_HELP, timeout d'inactivité, ou validation fichiers échouée), **on n'escalade pas immédiatement**. Le workflow est désormais :

1. **Subdivision (si possible)** : si la tâche n'est pas déjà une sous-tâche et n'a pas déjà été subdivisée, on demande à l'orchestrateur de **re-découper la tâche en 2 à 4 sous-tâches** plus petites (voir `buildSubdividePrompt` + `replaceTaskWithSubtasks` dans `orchestration.js`).
   - Le prompt de subdivision inclut la tâche problématique, les erreurs cumulées du codeur, et les métriques de la dernière tentative (durée, longueur de réponse — point N).
   - L'orchestrateur retourne un mini-plan JSON. Les sous-tâches reçoivent de nouveaux IDs séquentiels (`maxId + 1`, `maxId + 2`, …), héritent des `depends_on` externes de la tâche d'origine sur la première, et s'enchaînent par `depends_on` interne (chaîne linéaire).
   - Les tâches qui dépendaient de la tâche d'origine sont **rebranchées sur la dernière sous-tâche**.
   - Les sous-tâches sont marquées `subtask: true` (non re-subdivisibles en cas d'échec — limite à 1 niveau de subdivision).
   - Les `task_attempts`/`task_summaries`/`task_metrics` de la tâche d'origine sont nettoyés ; son ID est ajouté à `progress.subdivided`.
   - L'exécution reprend sur la première sous-tâche.
2. **Escalade (fallback)** : si la tâche est une sous-tâche, a déjà été subdivisée, ou si la subdivision échoue (pas de mini-plan valide), on bascule vers l'orchestrateur avec un prompt enrichi (voir `buildEscalationPrompt`) :
   - Le contenu des fichiers concernés par la tâche
   - Les résumés des tâches précédentes terminées
   - L'erreur rencontrée
   - Les métriques de la dernière tentative codeur (durée, longueur de réponse — point N)

L'orchestrateur exécute alors la tâche directement (avec ses propres outils). **Pas de validation fichiers stricte pour l'escalade** : on fait confiance à l'orchestrateur, qui peut improviser des fichiers non listés dans la tâche.

### 4.6 Révision mid-plan (point E)

Tous les `orchestration_revision_interval` tâches terminées (défaut 5, configurable, 0 = désactivé), on bascule vers l'orchestrateur pour qu'il **revoit le plan restant** à la lumière de ce qui a été fait réellement (fichiers créés, approche adoptée, résumés des tâches terminées) **et des métriques observées** (point N). Voir `buildRevisionPrompt` + `mergeRevisedPlan` dans `orchestration.js`.

- L'orchestrateur peut réorganiser, fusionner, découper ou annuler des tâches restantes.
- Les IDs déjà terminés sont conservés (non re-créés).
- Le plan révisé remplace les tâches restantes ; les `task_attempts`/`task_summaries` des tâches supprimées sont nettoyés.
- La révision n'est pas soumise au timeout d'inactivité (l'orchestrateur cloud est fiable).
- **Métriques incluses par tâche terminée** (point N) : durée, nombre de tentatives, statut (completed/escalated), flag subdivisée.
- **Analyse automatique des métriques (point P)** : si la durée moyenne par tâche dépasse 90s, ou le nombre moyen de tentatives dépasse 1.3, ou le taux d'escalades dépasse 40%, une section « ANALYSE DES MÉTRIQUES » est ajoutée au prompt de révision pour guider l'orchestrateur à découper plus finement les tâches restantes. C'est la boucle de feedback qui permet au plan de s'auto-améliorer en cours d'exécution.

### 4.6b Vérification finale (point S)

Lorsque toutes les tâches exécutables d'un plan sont terminées, le système ne
s'arrête pas immédiatement. Il bascule une dernière fois vers l'orchestrateur,
avec un contexte vierge, et lui envoie la consigne :

```
Vérifis que tout ce qui devait être fait a été fait correctement.
```

Le prompt complet (`buildFinalReviewPrompt` dans `orchestration.js`) ajoute un
résumé des tâches terminées/échouées et l'arborescence projet pour donner le
contexte minimal nécessaire.

- Si l'orchestrateur répond avec un plan JSON contenant des tâches, le plan
  courant est **remplacé** par ce nouveau plan vierge et l'exécution reprend
  normalement au codeur.
- Si l'orchestrateur répond sans plan JSON (ou avec un plan vide), on considère
  qu'il a validé le travail : affichage du bilan final et arrêt.

Pour éviter les boucles infinies, cette vérification est limitée à **3 cycles**
maximum. Si le plan reste bloqué par des dépendances non satisfaites après 3
cycles, l'exécution s'arrête avec un message explicite.

### 4.7 Contexte vierge par tour (et non « historique partagé »)

**Important** : contrairement à une formulation antérieure de cette spec, l'historique n'est **pas** partagé entre l'orchestrateur et le codeur. Chaque tour (plan, tâche, escalade, révision) démarre avec un **contexte vierge** via `new_session` (`clearContextForOrchestration`). Le codeur ne voit **que** le prompt qu'on lui fabrique (tâche + fichiers concernés + résumés des tâches précédentes + arborescence + titres des tâches suivantes). C'est pourquoi la qualité des prompts construits dans `orchestration.js` est déterminante — tout repose dessus.

**Synchronisation du `new_session` (point R)** : `new_session` réinitialise le modèle actif au **modèle par défaut de pi**. Comme `clearContextForOrchestration` précède `switchToCoder`/`switchToOrchestrator` dans `executeNextTask`, il est crucial que le `new_session` soit **terminé** avant le `set_model` — sinon pi applique `set_model` (codeur/orchestrator) puis le `new_session` traité tardivement reset le modèle au défaut, **annulant la bascule**. C'est pourquoi `new_agent_session` (Rust) utilise `send_command_sync` (et non `send_command` fire-and-forget) : on attend la confirmation de pi avant de poursuivre. De plus, `set_agent_model` (Rust) **vérifie le champ `success`** de la réponse pi : un `set_model` qui échoue (provider/modèle introuvable) déclenche désormais une erreur explicite (`pi a refusé set_model(...) : …`) au lieu de laisser le modèle par défaut silencieusement actif. Enfin, chaque bascule est **vérifiée** via `get_agent_state` (`confirmActiveModel`) qui affiche « ✓ confirmé » ou « ⚠️ mismatch » dans le chat. Les champs orchestrateur/codeur des Paramètres sont validés au format `provider/modelId` (alerte si le `modelId` est vide, ex: « glm-5.2:cloud » saisi sans le provider `ollama` devant).

---

## 5. Interface utilisateur

### 5.1 Toggle Mode Orchestration

Dans la barre d'outils de l'onglet Agent Pi, un nouveau bouton :

```
[🧠 Orchestration ON/OFF]
```

- **ON** : active le mode. Au clic, une **popup de sélection des modèles** s'ouvre (voir §18) : l'utilisateur choisit l'orchestrateur et le codeur (pré-remplis avec les modèles configurés), puis valide. Un **test rapide** vérifie que les deux modèles répondent réellement (prompt `Réponds uniquement "OK".` + attente `agent_end` / erreur / timeout 20 s). Si les deux répondent → le mode s'active avec ces modèles et le modèle actif devient l'orchestrateur. Sinon → message d'erreur indiquant quel modèle est injoignable, le mode **reste désactivé** et le modèle d'origine est restauré. Le prochain prompt utilisateur sera envoyé à l'orchestrateur pour créer un plan.
- **OFF** : mode normal actuel (comportement inchangé, modèle d'origine restauré).

### 5.2 Affichage dans le chat

Tout se passe dans le **même chat**. Quand le mode orchestration est actif :

1. **Le plan est affiché comme un message de l'orchestrateur** dans le chat (formaté avec les tâches et cases à cocher)
2. **Chaque exécution de tâche est visible** en streaming (pensées, outils, code) — le badge du modèle en cours (🧠 ou 🔨) est affiché
3. **Les transitions de modèle sont indiquées** par un message système : `⏩ Bascule vers le modèle codeur (Qwen)` ou `⏩ Bascule vers le modèle orchestrateur (DeepSeek V4)`
4. **Le statut de réflexion est préfixé par le rôle actif** : `🧠 Orchestrateur — 🤔 Réflexion...` ou `🔨 Codeur — 🤔 Réflexion...` (champ `state.orchestrationActiveRole`, mis à jour à chaque bascule). En mode normal, le statut reste `🤔 Réflexion...` sans préfixe.

Exemple de rendu dans le chat :

```
[Utilisateur]
Crée une API REST pour gérer des tâches

[🧠 DeepSeek V4 — Planification]
📋 Plan de développement :
  ☐ 1. Créer le modèle de données Task
  ☐ 2. Implémenter GET /tasks  
  ☐ 3. Implémenter POST /tasks
  ☐ 4. Ajouter la validation
  ☐ 5. Écrire les tests

⏩ Bascule vers 🔨 Qwen (codeur)

[🔨 Qwen — Tâche 1/5 : Créer le modèle Task]
✅ Création de src/models/task.py...
DONE: Modèle Task créé avec les champs id, title, done, created_at

[🔨 Qwen — Tâche 2/5 : Implémenter GET /tasks]
...
```

### 5.3 Panneau de progression

Au-dessus de la zone de chat, un panneau compact affiche l'état du plan :

```
┌─────────────────────────────────────────────────────┐
│  📋 Plan 1/5 — Tâche en cours : GET /tasks          │
│  [████░░░░░░░░░░░░░░░░] 20%                         │
│  ⏹️ Pause   ▶️ Reprendre   🔄 Nouveau plan            │
└─────────────────────────────────────────────────────┘
```

- **⏹️ Pause** : arrête l'exécution après la tâche en cours
- **▶️ Reprendre** : reprend l'exécution du plan
- **🔄 Nouveau plan** : abandonne le plan actuel, envoie un nouveau prompt à l'orchestrateur

### 5.4 Interactions utilisateur

| Action | Comportement |
|---|---|
| Saisie d'un message pendant l'exécution | Pause le plan, le message va au modèle courant |
| Clic sur une tâche dans le plan | Affiche les détails (description, fichiers, logs) dans le chat |
| ⏹️ Pause | Arrête après la tâche en cours |
| ▶️ Reprendre | Reprend le plan là où il en était |
| 🔄 Nouveau plan | Efface le plan, redemande à l'orchestrateur |

---

## 6. Persistance du plan

### 6.1 Fichier plan

Le plan est sauvegardé dans le projet : `.pilot/plan.json`

```json
{
  "created_at": "2026-06-18T14:30:00Z",
  "user_prompt": "Crée une API REST pour gérer des tâches",
  "orchestrator": { "provider": "deepseek", "model_id": "deepseek-chat" },
  "coder": { "provider": "llamacpp", "model_id": "qwen2.5-coder-7b" },
  "plan": [ ... ],
  "progress": {
    "current_task": 2,
    "completed": [1],
    "failed": [],
    "escalated": [],
    "task_attempts": { "2": 1 }
  }
}
```

### 6.2 Chargement

Au démarrage du mode orchestration, si `.pilot/plan.json` existe :
- Le plan est chargé et affiché
- L'utilisateur peut reprendre l'exécution ou demander un nouveau plan

### 6.3 Analyse par l'orchestrateur

Quand l'utilisateur pose une nouvelle question en mode orchestration, le contenu de `.pilot/plan.json` est inclus dans le prompt à l'orchestrateur pour qu'il puisse :
- Tenir compte de l'existant
- Modifier le plan si nécessaire
- Répondre en contexte

---

## 7. Plan de développement

### Phase 1 — Configuration et backend minimal

**Fichiers modifiés :**
- `src-tauri/src/lib.rs` (uniquement `AppConfig` + commandes `save_plan` / `load_plan`)

**Tâches :**

| # | Tâche | Détail |
|---|---|---|
| 1.1 | `AppConfig` : ajouter les 5 nouveaux champs | `orchestration_enabled`, `orchestrator_provider`, `orchestrator_model_id`, `coder_provider`, `coder_model_id` |
| 1.2 | Commande Tauri `save_plan` | Sauvegarder le plan JSON dans `.pilot/plan.json` |
| 1.3 | Commande Tauri `load_plan` | Charger le plan depuis `.pilot/plan.json` |
| 1.4 | Commande Tauri `delete_plan` | Supprimer `.pilot/plan.json` |

> **Note** : Pas de modification de `rpc_manager.rs`. Pas de double session. On utilise `set_agent_model` existant.

### Phase 2 — Frontend : UI orchestration

**Fichiers modifiés :**
- `src/js/agent-pi.js`
- `src/js/settings.js`
- `src/css/style.css`
- `index.html`

**Tâches :**

| # | Tâche | Détail |
|---|---|---|
| 2.1 | Toggle "Mode Orchestration" dans la barre d'outils agent | Bouton `🧠 Orchestration` avec état ON/OFF, persistance dans la config |
| 2.2 | Vérification de la config | Si mode ON mais provider/model vides → message d'erreur |
| 2.3 | Panneau de progression | HTML/CSS pour la barre de progression, boutons Pause/Reprendre/Nouveau |
| 2.4 | Affichage du plan dans le chat | Messages formatés avec cases à cocher, badges 🧠/🔨 pour les modèles |
| 2.5 | Messages de transition | `⏩ Bascule vers 🔨 Qwen (codeur)` ou `⏩ Bascule vers 🧠 DeepSeek (orchestrateur)` |
| 2.6 | Champs dans la modale settings | 4 champs : orchestrateur provider/model, codeur provider/model |
| 2.7 | Chargement du plan au démarrage | Si mode ON et `.pilot/plan.json` existe → afficher le plan et proposition de reprendre |

### Phase 3 — Workflow orchestration

**Fichiers modifiés :**
- `src/js/agent-pi.js`

**Tâches :**

| # | Tâche | Détail |
|---|---|---|
| 3.1 | Fonction `startOrchestration(userPrompt)` | Bascule vers orchestrateur, envoie le prompt de plan, parse la réponse JSON |
| 3.2 | Parsing du plan JSON | Extraire le JSON de la réponse (nettoyer les délimiteurs markdown `\`\`\`json ... \`\`\``) |
| 3.3 | Fonction `executePlan(plan)` | Boucle séquentielle sur les tâches |
| 3.4 | Bascule de modèle | `set_agent_model(coder)` avant chaque tâche, `set_agent_model(orchestrator)` pour l'escalade |
| 3.5 | Détection fin de tâche | Événement `agent_end` → analyser la réponse du codeur |
| 3.6 | Détection DONE / NEED_HELP | Parser la réponse pour ces mots-clés |
| 3.7 | Retry (max 2 tentatives) | Compteur par tâche, réessayer avec contexte enrichi |
| 3.8 | Escalade à l'orchestrateur | Après 2 échecs, basculer vers orchestrateur avec prompt d'escalade |
| 3.9 | Mise à jour UI en temps réel | Cocher les tâches, barre de progression, statut du modèle actif |
| 3.10 | Gestion du timeout | Si le codeur ne répond pas en 2 min → échec |
| 3.11 | Pause / Reprendre | Bouton pour interrompre/reprendre l'exécution du plan |
| 3.12 | Inclusion du plan existant dans le prompt | Si `.pilot/plan.json` existe, l'ajouter au contexte de l'orchestrateur |

---

## 8. Rétrocompatibilité

Toutes les modifications préservent le comportement actuel :

- **Sans mode orchestration** : Pilot fonctionne exactement comme aujourd'hui (une session, un modèle, pas de plan)
- **`set_agent_model`** : commande existante, aucun changement
- **`rpc-event`** : même canal d'événements, pas de nouveau canal
- **UI agent** : le mode normal (chat simple) reste intact, le panneau de plan n'apparaît que si le mode est activé
- **Inline completion** : continue de fonctionner normalement

---

## 9. Fichiers impactés

| Fichier | Changement |
|---|---|
| `src-tauri/src/lib.rs` | 7 champs config + 5 commandes Tauri (`save_plan`, `load_plan`, `delete_plan`, `file_mtime`, **`check_syntax`**) |
| `src/js/orchestration.js` | Fonctions pures : prompts, parsing plan, filtrage arborescence, résumés, validation fichiers, édition chirurgicale SEARCH/REPLACE, linting, escalation intelligente |
| `src/js/agent-pi.js` | Workflow orchestration complet : toggle, bascule modèle, parsing JSON, validation post-tâche, timeout, révision mid-plan, subdivision, édition chirurgicale, linting-in-the-loop, escalade V2 |
| `src/js/settings.js` | 6 champs (orchestrateur/codeur provider+model + timeout d'inactivité + intervalle de révision) |
| `src/css/style.css` | Styles pour le panneau de progression, liste de tâches, badges |
| `index.html` | Champs settings supplémentaires |
| `spec_pilot.md` | Mise à jour specs |
| `AGENTS.md` | Référence `spec_orchestration.md` |

> **`rpc_manager.rs` n'est PAS modifié.** Aucune double session, aucune modification de l'architecture RPC.

### 9.1 Améliorations apportées (v2)

| Point | Amélioration | Localisation |
|---|---|---|
| A | Validation post-tâche (vérification que les fichiers listés ont changé) | `captureFileState` + `checkTaskFilesChanged` + `resolvePath` (orchestration.js) + `handleOrchestrationAgentEnd` |
| B | Timeout d'inactivité (reset par `text_delta`) + configurable | `resetOrchestrationIdleTimer` + setting `orchestration_idle_timeout_ms` |
| C | Arborescence filtrée injectée dans le prompt de planification | `buildPlanPrompt` (orchestration.js) |
| D | Respect de `depends_on` dans la sélection de tâche | `pickNextTask` + `isPlanBlocked` (orchestration.js) |
| E | Révision mid-plan par l'orchestrateur | `buildRevisionPrompt` + `mergeRevisedPlan` + `startPlanRevision` |
| F | Doc corrigée (suppression du « historique partagé » erroné) | §4.7 de ce document |
| G | Résumés de tâches plus robustes (filtrage du bruit) | `extractTaskSummary` (orchestration.js) |
| H | Arborescence filtrée + mémoïsée par plan | `filterTree` + `buildTreeString` + `getCachedProjectTree` |
| I | Factorisation dans un module dédié | `src/js/orchestration.js` (`buildCommonContext`) |
| J | Normalisation du plan après parsing (champs par défaut, deps valides) | `normalizePlan` (orchestration.js) |
| K | Métriques finales (taux de réussite codeur, escalades, tentatives) | `summarizePlan` (orchestration.js) |
| L | Validation de la qualité du plan après parsing (descriptions courtes, trop de fichiers, plan trop petit) | `validatePlan` (orchestration.js) + affichage warnings dans le chat |
| M | Subdivision d'une tâche échouée en 2-4 sous-tâches avant escalade | `buildSubdividePrompt` + `replaceTaskWithSubtasks` + `startPlanSubdivision` (agent-pi.js) |
| N | Métriques par tâche (durée, tentatives, longueur réponse, statut) injectées dans révision + escalade | `progress.task_metrics` + `buildRevisionPrompt` + `buildEscalationPrompt` |
| O | Prompt planificateur renforcé (principe micro-tâche, fourchette 5-25, description structurée, exemples bon/mauvais) + objectif de taille dans le prompt codeur | `buildPlanPrompt` + `buildTaskPrompt` (orchestration.js) |
| P | Analyse automatique des métriques dans la révision mid-plan (guide l'orchestrateur à découper plus fin) | `buildRevisionPrompt` (orchestration.js) |
| Q | Détection d'erreur de connexion du codeur/orchestrateur (ex: serveur llama-cpp éteint, API cloud down) → mise en pause du plan (ou message clair pendant la construction du plan) au lieu de marquer la tâche « effectuée » à tort ou d'afficher « pas de plan valide » | Capter l'événement `auto_retry_start` (Connection error) + `handleOrchestrationConnectionError` + flag `orchestrationConnectionError`/`orchestrationConnErrorSeen` + garde dans `handleOrchestrationAgentEnd` (agent-pi.js) |
| R | `new_session` synchrone + vérification de la bascule modèle (`get_agent`) pour éviter que `new_session` n'annule la bascule vers le codeur/orchestrateur | `new_agent_session` utilise `send_command_sync` (lib.rs) + `confirmActiveModel` via `get_agent_state` dans `switchToOrchestrator`/`switchToCoder` (agent-pi.js) |
| S | Vérification finale par l'orchestrateur après exécution complète du plan + re-plan vierge si manques détectés + limite 3 cycles | `buildFinalReviewPrompt` + gestion `orchestrationFinalReview`/`orchestrationFinalReviewCount` (agent-pi.js + orchestration.js) |

---

## 10. Décisions validées

| # | Question | Décision |
|---|----------|----------|
| 1 | Architecture des sessions ? | ✅ **Session unique** — même session RPC, bascule de modèle via `set_model` |
| 2 | Mode orchestration sans codeur configuré ? | ✅ **Refuser** — message d'erreur explicite, exiger la configuration |
| 3 | Un seul plan par projet ? | ✅ **Oui** — `.pilot/plan.json` à la racine du projet |
| 4 | Interaction utilisateur pendant exécution ? | ✅ **Pause** — l'utilisateur peut parler, le plan se met en pause |

---

## 11. Mode Orchestration V2 (2026-06-26)

Optimisation du couple **orchestrateur cloud** + **codeur local** pour réduire les escalades inutiles et améliorer la qualité du code généré.

### 11.1 Délégation de lecture au codeur
- Le prompt de tâche **ne contient plus le contenu des fichiers**.
- Le codeur doit obligatoirement lire les fichiers listés avec son outil `read_file` **avant toute modification**.

### 11.2 Édition chirurgicale
- Le codeur est contraint d'utiliser deux formats exclusifs :
  - `SEARCH/REPLACE: <filepath>` pour modifier un fichier existant
  - `CREATE: <filepath>` pour créer un nouveau fichier
- Le frontend (`orchestration.js` + `agent-pi.js`) parse ces blocs, applique les modifications via les commandes Tauri `read_file_content` / `write_file_content`, et **intercepte les réponses hors format** pour renvoyer une correction locale au codeur sans escalader à l'orchestrateur.

### 11.3 Linting-in-the-loop
- Avant d'accepter le marqueur `DONE`, le backend lance un vérificateur syntaxique local adapté au type de fichier :
  - JS/TS : `eslint` local ou `npx eslint`
  - Python : `python -m py_compile`
  - Rust : `cargo check`
- Si le check échoue, le codeur reçoit automatiquement l'erreur brute sous forme de `NEED_HELP: Correction syntaxique requise` et doit corriger en boucle locale (max 3 corrections avant échec de tâche).
- Si aucun linter n'est disponible, la vérification est silencieusement passée pour ne pas bloquer la tâche.

### 11.4 Boussole du contexte (Global Directive)
- Le plan produit par l'orchestrateur inclut un champ `global_directive` : un résumé immuable et très concis de l'objectif final du projet.
- Cette directive est systématiquement injectée **en haut de chaque prompt de tâche** pour ancrer le codeur dans la bonne direction architecturale.

### 11.5 Escalade intelligente
- Le prompt d'escalade propose explicitement 4 actions à l'orchestrateur :
  - `[ACTION: REDECOUPER]` — redécouper la tâche en sous-tâches
  - `[ACTION: EXECUTER]` — exécuter la tâche directement (comportement classique)
  - `[ACTION: REVISER]` — réviser le plan global des tâches restantes
  - `[ACTION: COMMANDE]` — lancer une commande système (ex: `npm install`) pour résoudre un problème environnemental
- Le frontend route chaque action :
  - `REDECOUPER` → remplace la tâche par ses sous-tâches
  - `REVISER` → merge le nouveau plan révisé
  - `COMMANDE` → exécute la commande via `execute_agent_bash` puis relance la même tâche par le codeur
  - `EXECUTER` / fallback → marque la tâche comme escaladée et passe à la suite

---

## 12. Mode Orchestration V3 — corrections de bugs (2026-06-29)

Première vague de la V3 (cf. `orchestration_V3.md` §5, étape 1) : corrections de bugs silencieux sans changement d'architecture.

### 12.1 Compression de prompt réparée (Bug 1)
`compactTaskPrompt` utilisait des libellés de section inexistants (`=== RÉSUMÉS DES TÂCHES PRÉCÉDENTES ===`, `=== TÂCHE À RÉALISER ===`) — la compression des résumés ne s'appliquait donc JAMAIS, seule celle de l'arborescence fonctionnait. Corrigé : la regex cible maintenant le vrai libellé `=== TÂCHES PRÉCÉDENTES TERMINÉES ===` avec les bornes réelles (`=== ARBORESCENCE DU PROJET ===`, `=== TÂCHES SUIVANTES PRÉVUES ===`, `=== FORMAT OBLIGATOIRE POUR LES MODIFICATIONS ===`, `=== ⚠️ RETENTATIVE`).

### 12.2 Révision mid-plan devenue conditionnelle (Bug 2)
Avant : `shouldRevise` était forcé à `true` dès que l'intervalle était atteint → révision **inconditionnelle** (gaspillage d'appels cloud, déstabilisation possible d'un plan sain). De plus, `failureRate` était déclaré `const` dans le bloc `if` puis référencé hors du bloc dans le message système → `ReferenceError` silencieuse qui empêchait la révision de réellement se lancer. Corrigé : `failureRate`/`avgAttempts` déclarés au scope externe, et `shouldRevise = failureRate > 0.30 || avgAttempts > 1.3`. La révision ne se déclenche plus que sur signaux négatifs.

### 12.3 Validation post-tâche fiabilisée (Bug 3)
Avant : la validation reposait sur la comparaison `mtime` des fichiers listés — peu fiable sous Windows (résolution ~1 s : un fichier réécrit dans la même seconde était vu « inchangé » → escalades injustifiées). Corrigé : quand des fichiers ont été écrits via `applySearchReplaceBlocks` (`changedFiles.length > 0`), c'est la **source de vérité** — on valide directement sans interroger le `mtime`. Le garde-fou `checkTaskFilesChanged` (mtime + fichiers mentionnés) reste pour les cas sans blocs (`NO_CHANGE`, réponse texte sans format, etc.).

### 12.4 Re-plan automatique pour plan trop grossier (Bug 5)
Avant : `validatePlan` ne produisait que des warnings affichés — l'exécution continuait même pour un plan manifestement insuffisant. De plus, `validatePlan` recevait par erreur la **réponse de l'orchestrateur** comme `userPrompt` (le critère « promptLen > 60 » était donc quasi toujours vrai). Corrigé :
- `validatePlan` retourne maintenant `severity: "reject"` (bloquant) quand `plan.length < 3 && userPrompt.length > 100` (demande substantielle mais plan minuscule). Les autres défauts (description < 40 car., > 3 fichiers, titre > 80 car.) restent des warnings non bloquants.
- Le handler de `agent_end` mémorise le **vrai prompt utilisateur** (`state.orchestrationLastUserPrompt`) à l'envoi du prompt de planification, et le passe à `validatePlan`.
- Si `severity === "reject"`, un **re-plan automatique** est demandé à l'orchestrateur (max 1, via `state.orchestrationPlanReplanRetries`) avec une consigne de découpage strict. Si le second plan est encore grossier, on exécute quand même (la subdivision auto corrigera les tâches trop grandes en cas d'échec).

### 12.5 Compatibilité
Aucun changement de backend Rust, aucun changement de commande Tauri, aucun changement de format de plan. Les modifications sont purement frontend (`orchestration.js` + `agent-pi.js`) et ne cassent aucune fonctionnalité existante : le mode normal, l'escalade V2, la subdivision, le linting, la vérification finale, le batch mode restent intacts.

---

## 13. Mode Orchestration V3 — triptyque Réfléchir / Faire / Contrôler (2026-06-29)

Deuxième vague de la V3 (cf. `orchestration_V3.md` §5, étapes 2 et 3). Le codeur local ne se contente plus de produire du code que le frontend valide : il **réfléchit, fait, puis contrôle lui-même** son travail, jusqu'à 3 cycles d'auto-correction dans la même session. C'est le changement de cœur de la V3.

### 13.1 Prompt codeur structuré en 3 phases
`buildTaskPrompt` (`orchestration.js`) impose désormais 3 phases explicites avec des en-têtes obligatoires :

1. **PHASE 1 — RÉFLEXION** : le codeur liste les fichiers à lire, énonce en 3-5 points ce qu'il va modifier et pourquoi, identifie les cas d'erreur. Termine par `REFLEXION_DONE`.
2. **PHASE 2 — EXECUTION** : applique les modifications via `SEARCH/REPLACE` ou `CREATE`. Termine par `MODIFS_DONE: <liste des fichiers>`.
3. **PHASE 3 — CONTRÔLES** : relit chaque fichier modifié avec `read_file`, vérifie point par point la couverture de la description et l'absence de régression. Termine par :
   - `DONE: <résumé>` si tout est bon,
   - `SELF_FIX: <défaut>` puis arrêt si un défaut est constaté (un nouveau tour sera donné pour corriger dans la même session),
   - `NEED_HELP: <question>` si la tâche est impossible ou trop grosse.

### 13.2 Boucle d'auto-correction SELF_FIX (in-session)
Quand le codeur émet `SELF_FIX`, le frontend :
1. applique d'abord les blocs `SEARCH/REPLACE`/`CREATE` faits dans ce tour (la Phase 2 du tour courant) sur disque,
2. renvoie un prompt court (`buildSelfFixPrompt`) **dans la même session RPC** (sans `new_session`) — le codeur garde son contexte et peut relire le fichier réel modifié puis corriger le défaut qu'il a lui-même constaté,
3. incrémente `state.orchestrationCurrentTaskCycles` (max 3 par tentative classique).

Au-delà de 3 cycles `SELF_FIX` sans `DONE`, la tentative est déclarée échec → `handleTaskFailure` (qui enchaîne sur subdivision/escalade selon la politique existante). Le timer d'inactivité est reset à chaque tour `SELF_FIX` (le codeur est actif).

### 13.3 Détection unifiée des marqueurs (`detectCoderMarker`)
Nouvelle fonction `detectCoderMarker(text)` dans `orchestration.js` : retourne le **dernier** marqueur émis par position dans le texte (`SELF_FIX` / `DONE` / `NEED_HELP` / `NO_CHANGE`). Gère correctement le cas où le codeur émet `SELF_FIX` puis `DONE` dans le même tour (le défaut a été résolu → `DONE` prime car il apparaît après). Le handler `handleOrchestrationAgentEnd` (`agent-pi.js`) l'utilise pour router vers la branche `NEED_HELP`, `SELF_FIX` ou l'édition chirurgicale finale (`DONE` / `NO_CHANGE` / pas de marqueur).

### 13.4 Passage à 3 tentatives classiques
`handleTaskFailure` passe de 2 à **3 tentatives** (`attempts < 3`) avant subdivision/escalade. Chaque tentative classique (avec `new_session`) peut elle-même enchaîner jusqu'à 3 cycles `SELF_FIX` in-session — en pratique le codeur converge vers `DONE` en 1-2 cycles, les 9 cycles max théoriques n'arrivent qu'en cas de blocage prolongé (l'utilisateur peut mettre en pause à tout moment).

### 13.5 Compatibilité
Aucun changement de backend Rust. Les fonctions `buildRetryTaskPrompt`, `buildEscalationPrompt`, `buildSubdividePrompt`, `buildRevisionPrompt`, `buildFinalReviewPrompt` sont inchangées. L'escalade V2 (4 actions), la subdivision proactive, le linting-in-the-loop, la vérification finale, le batch mode restent intacts. Le `DONE:` produit par le codeur reste compatible avec `extractTaskSummary` et la validation post-tâche. `NO_CHANGE` reste géré par `checkTaskFilesChanged`.

---

## 14. Vérification finale par le codeur (étape 4, 2026-06-29)

La vérification finale **n'est plus confiée à l'orchestrateur** (qui ne voit que les résumés de tâches, pas les fichiers réels). Désormais, si un codeur local est configuré, c'est lui qui relit les fichiers modifiés et juge factuellement la couverture de chaque tâche.

- Nouveaux prompts dans `orchestration.js` : `buildCoderFinalReviewPrompt` (demande au codeur de relire chaque fichier via `read_file` et de répondre) et `buildCoderFinalReviewContinuePrompt` (prompt court in-session après un `FINAL_FIX`).
- Marqueurs du codeur : `DONE_FINAL: <résumé>` (tout est correct), `FINAL_FIX: <défaut + fichier>` (défaut constaté, correction demandée dans un nouveau tour in-session), ou `{"plan":[...]}` (tâches entières manquantes → nouveau plan).
- `executeNextTask` choisit le codeur (`switchToCoder` + `buildCoderFinalReviewPrompt`) si `coderModel` est défini, sinon fallback sur l'ancien chemin orchestrateur (`switchToOrchestrator` + `buildFinalReviewPrompt`).
- Handler `handleOrchestrationAgentEnd` (branche `orchestrationFinalReview`) : traite `FINAL_FIX` (boucle in-session, max 3 cycles via `state.orchestrationFinalReviewCycles`), `DONE_FINAL` (terminé), puis le plan JSON (nouveau plan vierge). Symétrique de la boucle `SELF_FIX` mais pour la phase de vérification finale.
- Si les 3 cycles `FINAL_FIX` sont épuisés sans `DONE_FINAL`, le plan s'arrête en avertissant l'utilisateur (les fichiers restent dans leur état actuel).

## 15. Unification de la subdivision (étape 5, 2026-06-29)

Les 2 chemins de subdivision (Point M après 3 tentatives échouées, et escalade `[ACTION: REDECOUPER]`) partageaient une logique d'application dupliquée. Refactor : nouvelle fonction `applySubdivision(st, messagesEl, failedTaskId, subtasks, sourceLabel)` qui factorise le `replaceTaskWithSubtasks` + save + render + message, et renvoie `true` si appliquée. Les 2 handlers l'appellent désormais ; chaque handler garde son fallback d'échec spécifique (Point M → escalade directe ; REDECOUPER → `markEscalatedAndContinue`). Comportement inchangé, code DRY.

## 16. Contrôles utilisateur par tâche (étape 6, 2026-06-29)

Chaque tâche non terminée du panneau affiche désormais des boutons :
- **⏭️ Sauter** (`skipTask`) : marque la tâche comme sautée (ajoutée à `progress.escalated`). Interdit sur la tâche **courante** (race avec le codeur) — l'utilisateur doit d'abord mettre en pause.
- **✏️ Éditer** (`editTaskDescription`) : modifie la description via `prompt()` ; prend effet à la prochaine exécution/retry.
Interception via `data-task-action` dans le handler de clic du wrapper. CSS dédié (`.orch-task-controls`, `.orch-task-btn`).

## 17. Désactivation du batch auto + métriques temps réel (étape 7 & 8, 2026-06-29)

**Batch** : `getEffectiveBatchSize` ne renvoie plus 5 pour les codeurs locaux en mode auto (`-1`). Désormais chaque tâche obtient un **contexte frais** (`new_session`) par défaut — essentiel pour la fiabilité du triptyque Réfléchir/Faire/Contrôler (évite la contamination entre tâches). L'utilisateur peut encore forcer un batch en configurant une valeur positive explicite dans les paramètres. L'option « Auto » du sélecteur indique maintenant « désactivé — contexte frais par tâche, recommandé ».

**Métriques** : une zone `orch-metrics` s'affiche sous la barre de progression, mise à jour à chaque `renderOrchestrationPlan` : tâches réussies / échouées / sautées, taux d'échec %, et ligne « En cours » indiquant la tentative (X/3) et le cycle d'auto-contrôle (Y/3) de la tâche courante. CSS dédié (`.orch-metrics`, `.orch-metric-*`).

*Document mis à jour le 2026-06-29 — V3 (corrections de bugs + triptyque Réfléchir/Faire/Contrôler + vérification finale par le codeur + contrôles utilisateur + métriques) ajoutée (§12 à §17). Popup de sélection + test des modèles à l'activation ajoutée (§18).*

## 18. Popup de sélection + test des modèles à l'activation (2026-06-29)

Avant, le clic sur 🧠 activait le mode immédiatement après une simple vérification que les modèles étaient **configurés** (sans tester s'ils **répondaient**). Désormais, l'activation exige que les deux modèles soient réellement joignables.

### 18.1 Popup de sélection

Au clic sur 🧠 (quand le mode est désactivé), une modale s'ouvre (classes `.modal` / `.modal-content` / `.setting-row` / `.modal-actions`) avec :

- un sélecteur **🧠 Orchestrateur** (cloud, intelligent) ;
- un sélecteur **🔨 Codeur** (local, économique) ;
- les deux pré-remplis avec les modèles de la config (`orchestrator_provider/model_id` et `coder_provider/model_id`), et peuplés avec `list_agent_models` ;
- un bouton **✅ Valider et tester** et un bouton **Annuler**.

La modale se ferme aussi par clic sur l'overlay ou touche **Échap** (sauf pendant un test en cours).

### 18.2 Test rapide de réponse

Au validate (`showOrchestrationModelPicker` → `testModelResponds`) :

1. `new_agent_session` (contexte vierge).
2. `set_agent_model(provider, modelId)`.
3. `send_agent_prompt` avec `Réponds uniquement "OK".`.
4. On écoute les `rpc-event` via un listener dédié : **`agent_end`** → succès **uniquement si du texte a été reçu** (`text_delta` ou contenu texte d'un `message` assistant) — sinon échec (un `agent_end` seul peut être celui d'un abort/erreur de connexion) ; **`message`** avec `stopReason === "error"`** → échec ; **`auto_retry_start`** → échec direct « erreur de connexion (modèle injoignable) » (pi ne joignait pas le modèle) ; **`message`** avec `stopReason === "aborted"`** → échec ; **`extension_error`** → échec ; **timeout 20 s** → échec + `abort_agent`.
5. Flag `state.modelTestActive` : pendant le test, `handleRpcEvent` retourne immédiatement (anti-pollution du chat par le prompt « OK »). À la fin du test, `finish()` appelle `abort_agent` (stoppe les retries de pi) et **garde `modelTestActive=true` pendant 400 ms** pour bloquer les événements résiduels encore en vol (`auto_retry_start`, `agent_end` d'abort) avant de le remettre à `false`.

Ordre des tests : **codeur d'abord, orchestrateur ensuite** — pour que le modèle actif à la fin d'un test réussi soit l'orchestrateur.

### 18.3 Résultats

- **Les deux répondent** → `activateOrchestrationWith` : `new_session` (effacer le prompt « OK »), `switchToOrchestrator`, `orchBtn.classList.add("active")`, message d'activation, chargement d'un éventuel plan existant (`.pilot/plan.json`). Le modèle par défaut d'origine est mémorisé dans `state.defaultModel` pour restauration à la désactivation. **Le pré-chauffage du codeur (`warmupCoderIfNeeded`) est supprimé** — le test a déjà sollicité le codeur, il est donc en mémoire.
- **Un modèle ne répond pas** → message d'erreur dans le chat précisant quel modèle est injoignable et la cause ; `restoreModel` remet le modèle d'origine (`state.currentModel` avant le test) + `new_session` ; la popup réactive ses contrôles (on peut corriger le choix et re-tester). Le mode **reste désactivé**.

### 18.4 Compatibilité

Aucun changement de backend Rust, aucun changement de commande Tauri. La désactivation (branche `if (state.orchestrationEnabled)`) et tout le reste du workflow (plan, exécution, escalade, subdivision, vérification finale) sont inchangés. La fonction `warmupCoderIfNeeded` a été supprimée (plus appelée nulle part).

### 18.5 Titre du panneau enrichi du début de la demande (2026-06-29)

Quand une demande est envoyée en mode Orchestration (construction d'un nouveau plan), le titre du panneau affiche le **début de la demande** : `📋 Plan d'orchestration : <extrait>`. L'extrait est tronqué proprement (~70 caractères, coupure nette + `…`) et ne chevauche jamais les boutons à droite (CSS `flex` : `.orchestration-title` en `flex:1; min-width:0; white-space:nowrap; text-overflow:ellipsis`, `.orchestration-actions` en `flex-shrink:0`). Un tooltip (attribut `title`) donne la demande complète.

- **Source** : `state.orchestrationLastUserPrompt` (déjà mémorisé pour `validatePlan`).
- **Rendu** : `updateOrchestrationTitle(st)` (nouvelle fonction), appelée dès l'envoi de la demande (affichage pendant la construction du plan, avant que `orchestrationPlan` ne soit défini) puis à chaque `renderOrchestrationPlan`.
- **Reset** : `orchestrationLastUserPrompt` est remis à `""` à la désactivation du mode et au clic sur 🔄 (nouveau plan).
- Une seule demande à la fois possible (un travail en cours bloque l'envoi).

---

<!-- HELP:orchestration -->
## Mode Orchestration

Le **Mode Orchestration** (onglet π, activable dans les Paramètres ⚙️) fait
travailler ensemble deux IA :
- un **orchestrateur** (cloud) qui découpe la demande en micro-tâches et valide
  chaque étape,
- un **codeur** (local, agent Pi) qui exécute chaque micro-tâche sur le projet.

- Activer dans **Paramètres ⚙️ → Agent Pi → Mode Orchestration**, choisir les
  modèles orchestrateur et codeur, la granularité des tâches.
- Pose ta demande dans l'onglet π : l'orchestrateur produit un **plan** (panneau
  dédié), puis les tâches s'exécutent l'une après l'autre, avec validation et
  linting entre chaque étape.
- Idéal pour les grosses refontes : édition chirurgicale `SEARCH/REPLACE`,
  boucles de révision automatiques, directive globale.
<!-- /HELP:orchestration -->
