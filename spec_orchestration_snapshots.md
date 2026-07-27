# Spécification — Snapshots / point de restauration avant tâche (A1)

> **Statut : ✅ Implémenté (2026-07-29)** — évolution du Mode Orchestration V3.
> Dépend de **C1 (Git intégré)** — réutilise le CLI `git` et le helper `run_captured`.

## 1. Objectif

Avant chaque tâche du codeur en Mode Orchestration, Pilot capture l'état des
fichiers du projet (snapshot Git). Si une tâche casse quelque chose ou ne
satisfait pas l'utilisateur, un bouton **« ↩️ Annuler la dernière tâche »**
restaure les fichiers modifiés à leur état d'avant la tâche.

Sans A1, une tâche d'orchestration ratée n'est annulable que manuellement (Git
externe) — le codeur a déjà écrit sur disque. A1 apporte un undo par étape,
aligné sur le journal d'observabilité (E0).

## 2. Décisions retenues

| Décision | Choix |
|---|---|
| Mécanisme | **Git-based** (`git stash create -u`) — réutilise C1, zéro duplication |
| Granularité | **Par tâche** — un snapshot avant chaque tâche du codeur |
| Portée | **Fichiers modifiés par la tâche** (`changedFiles` de `applySearchReplaceBlocks`) |
| Activation | **Défaut activé** — garantie de sécurité quasi gratuite |
| UI | Bouton **↩️** dans le panneau d'orchestration + modal de confirmation |
| Non-Git | **Échec gracieux** — A1 désactivé pour le plan + message, aucune régression |

## 3. Mécanisme Git

### 3.1 Capture (avant tâche)

Au moment où `executeNextTask` sélectionne `nextTask` (après `progress.current_task
= nextTask.id`, avant l'envoi du prompt au codeur) :

1. Vérifier `git rev-parse --is-inside-work-tree` (cwd = projet).
2. Si pas un repo → `SnapshotsAvailable = false` pour le plan, message système
   une fois, on continue sans snapshot.
3. `git stash create -u` (capture tracked **+ untracked**, sans toucher au
   working tree ni à l'index). stdout = SHA d'un commit temporaire.
4. Si stdout vide (working tree propre par rapport à HEAD) → SHA = `git rev-parse HEAD`.
5. Stocker `st.orchestrationSnapshots[taskId] = { sha, files: [], ts }`.

`git stash create` ne modifie **rien** au repo : il crée juste un objet commit
dans la base d'objets (non référencé, GC-able). Aucun stash nommé, aucune
branche, aucun tag. L'utilisateur ne voit rien dans `git stash list`.

### 3.2 Association des fichiers (après tâche)

Dans `handleOrchestrationAgentEnd`, une fois `changedFiles` calculé (via
`applySearchReplaceBlocks`), on complète le snapshot :

```js
if (st.orchestrationSnapshots[currentTaskId]) {
  st.orchestrationSnapshots[currentTaskId].files = changedFiles;
}
```

Un snapshot sans `files` (tâche en cours) n'est pas encore annulable.

### 3.3 Restauration (annulation)

Commande Tauri `git_restore_snapshot(sha, files)` :

Pour chaque `file` (chemin relatif au repo) :
- `git ls-tree <sha> -- <file>` → si stdout non vide (fichier présent dans
  l'arbre du snapshot) → `git checkout <sha> -- <file>` (restaure le contenu
  pré-tâche dans le working tree **et** l'index).
- Si absent du snapshot → le fichier a été **créé** par la tâche →
  `fs::remove_file(absPath)` (suppression du disque). Ignorer l'erreur si
  déjà absent.

Après la boucle : `git reset HEAD -- <files...>` pour unstage (l'index revient
à HEAD pour ces fichiers, le working tree conserve la version restaurée).

Résultat : `{ restored: Vec<String>, deleted: Vec<String> }`.

### 3.4 Comportement post-annulation

La tâche annulée est marquée `cancelled` :
- Retirée de `progress.completed` (si elle y était).
- Ajoutée à `progress.cancelled` (nouvelle liste, purement cosmétique —
  exclue du compteur « terminé » mais pas comptée comme échec).
- `progress.current_task` remis à `null`.

L'utilisateur peut ensuite :
- éditer la description de la tâche (V3 étape 6) et relancer le plan (▶️) ;
- ajuster manuellement et relancer ;
- ignorer et continuer (la tâche reste annulée, le plan reprend à la suivante).

L'annulation **ne relance pas automatiquement** la tâche (évite une boucle si
la tâche rate à nouveau).

## 4. Sécurité & robustesse

- **Pas de shell** : `Command::new("git").args(...)` (comme C1, `run_captured`).
- **cwd forcé** au projet (le frontend ne passe jamais de chemin absolu à git).
- **Timeout** : `git stash create` 8s, `git checkout` 8s, `git reset` 5s
  (via `run_captured`). Un snapshot qui timeout est traité comme indisponible
  (message, A1 désactivé pour le plan).
- **Aucune écriture hors fichiers restaurés** : on ne touche ni aux commits
  existants, ni aux branches, ni à l'index de l'utilisateur au-delà du unstage
  des fichiers restaurés.
- **Fichiers non projet** : seuls les `changedFiles` (chemins relatifs validés
  par `applySearchReplaceBlocks`) sont restaurés. Pas de `git checkout .`
  global.
- **Concurrence** : la restauration est interdite si `st.isStreaming` (un codeur
  est en train de travailler). Le bouton est désactivé dans ce cas.

## 5. Config

Nouveau champ `AppConfig` :

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `orchestration_snapshots_enabled` | `bool` | `true` | Active/désactive A1 |

Si désactivé, aucun snapshot n'est capturé, le bouton ↩️ est masqué. Permet à
l'utilisateur de refuser les snapshots (repo avec hooks sensibles, ou
préférence personnelle).

## 6. UI

### 6.1 Bouton ↩️

Dans `orchestration-actions` (à côté de ⏸️ / ▶️ / 🔄) :

```html
<button class="agent-btn" data-action="orch-undo"
  title="Annuler la dernière tâche (restaurer les fichiers)" disabled>
  <i data-lucide="undo-2" class="icon-sm"></i>
</button>
```

Activé (`disabled = false`) si et seulement si :
- `st.orchestrationSnapshotsEnabled` est vrai ;
- `st.orchestrationSnapshotsAvailable` est vrai (repo Git détecté) ;
- il existe au moins un snapshot avec `files.length > 0` pour une tâche
  terminée non déjà annulée ;
- `!st.isStreaming` (aucun codeur en cours).

### 6.2 Handler `orch-undo`

1. Identifier la dernière tâche exécutable avec snapshot complet (parcourir
   `progress.completed` en ordre inverse, ou `st.orchestrationSnapshots`).
2. Modal de confirmation : « Annuler la tâche N « titre » ? Les fichiers
   modifiés seront restaurés à leur état d'avant la tâche. »
3. `await invoke("git_restore_snapshot", { sha, files })`.
4. Message système : « ↩️ Tâche N annulée : X fichier(s) restauré(s), Y
   supprimé(s). »
5. Marquer `cancelled`, re-render du plan, `updateOrchestrationButtons`.

### 6.3 Détection repo au démarrage du plan

Au premier appel de `git_create_snapshot` (première tâche), si `not_a_repo` →
message une fois : « ↩️ Snapshots indisponibles (le projet n'est pas un repo
Git). Annulation de tâche désactivée. » + `st.orchestrationSnapshotsAvailable
= false`. Le bouton ↩️ reste masqué pour tout le plan.

## 7. Observabilité

Le snapshot est enregistré dans le journal des tentatives (E0) via un champ
`snapshot` optionnel dans `createAttemptLog` :

```js
snapshot: { sha: "abc1234", filesCount: 3 } | null
```

Affiché dans `renderOrchestrationAttempts` comme un badge « ↩️ snapshot » sur
l'entrée DONE de la tâche (cliquable → info). Pas d'affichage du SHA complet
(bruit) — juste le compte de fichiers.

## 8. Fichiers impactés

| Fichier | Rôle |
|---|---|
| `src-tauri/src/lib.rs` | Commandes `git_create_snapshot` / `git_restore_snapshot` + champ `AppConfig.orchestration_snapshots_enabled` + `SnapshotResult` / `RestoreResult` structs |
| `src/js/agent-pi.js` | État (`orchestrationSnapshots`, `orchestrationSnapshotsEnabled`, `orchestrationSnapshotsAvailable`), capture dans `executeNextTask`, association `files` dans `handleOrchestrationAgentEnd`, bouton ↩️ + handler `orch-undo` + `updateOrchestrationButtons`, reset sur nouveau plan |
| `src/js/orchestration.js` | `createAttemptLog` étendu avec `snapshot` |
| `src/js/settings.js` + `index.html` | Checkbox « Snapshots avant tâche » dans la section Orchestration |
| `spec_orchestration.md` | §11.7 référençant cette spec |
| `spec_orchestration_observability.md` | Mention `snapshot` dans le journal |

## 9. Limites & évolutions futures

- **Snapshots éphémères** : les SHA créés par `git stash create` sont
  non-référencés → éligibles au `git gc` (disparaissent après ~2 semaines par
  défaut). A1 ne garantit pas une restauration au-delà de la session. C'est
  acceptable : l'undo sert pendant l'orchestration, pas comme archivage.
- **Pas de multi-niveau undo** : V1 n'annule que la dernière tâche exécutable
  avec snapshot. Un undo en chaîne (annuler N-1 puis N-2) est possible mais
  non exposé en UI (évite la confusion). Évolution : historique des snapshots
  navigable.
- **Conflit avec modifs manuelles** : si l'utilisateur modifie un fichier
  entre la fin de la tâche et l'annulation, la restauration écrase ses modifs
  (le modal de confirmation le prévient).
- **Évolution A1 V2** : snapshot du working tree entier (pas seulement
  `changedFiles`) via un vrai `git stash` nommé `pilot-<taskId>`, pour un undo
  « propre » même si l'utilisateur a touché d'autres fichiers entre-temps.