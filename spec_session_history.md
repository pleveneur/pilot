# Spécification — Historique de sessions searchable (H9)

> Mémoire des **décisions** : index persistant de toutes les sessions agent,
> queryable (full-text, tags, fichiers touchés). Complément de H3 (mémoire des
> *faits*) et H1 (contexte). Transforme une session jetable en compagnon
> long-terme. Voir `idees_evolutions.md` §H9.

**Statut : ✅ Implémenté (2026-08-01)**

---

## 1. Objectif

Répondre à des questions du type :

- « Quand a-t-on décidé d'ajouter le mode Orchestration ? »
- « Quelles sessions ont touché `lib.rs` ? »
- « Quels prompts ont utilisé le modèle local ? »
- « Combien a coûté l'agent ce mois-ci sur ce projet ? »

Pour cela, Pilot indexe **toutes** les sessions pi du projet (passées via
rétro-indexation + nouvelles en live) dans `.pilot/sessions.jsonl` (append-only,
un objet JSON par ligne), avec un onglet 📜 pour rechercher/filtrer/consulter.

## 2. Décisions de conception (validées)

1. **Granularité** : une entrée par **session pi** (lien parent), plus une
   entrée par **tâche d'orchestration** quand elle existe (champ `parent` =
   id de session). Reste queryable sans exploser la taille.
2. **Stockage** : `.pilot/sessions.jsonl` append-only (cheap, grep-friendly,
   cohérent avec l'audit log distant). Migration SQLite possible plus tard
   (si H9 + H1 V2 cohabitent), non planifiée pour V1.
3. **Rétro-indexation** : au démarrage (et via bouton « Réindexer »), Pilot lit
   tous les `.jsonl` du dossier de sessions pi du projet et (re)construit
   l'index. Permet d'être à jour sur un projet existant.
4. **Moteur de recherche** : full-text simple (substring/regex côté Rust,
   cohérent avec `search_in_files`). Le scoring sémantique via l'index RAG
   H1 V2 est une V2, pas V1.

## 3. Format de l'index `.pilot/sessions.jsonl`

Une ligne = un objet JSON :

```jsonc
{
  "id": "019f85e4-...",              // id de session pi (stem après '_')
  "timestamp": "2026-08-01T14:23:00", // mtime du fichier de session (ISO)
  "project": "G:\\IA_PL\\pilot",      // chemin projet (pour cohérence multi)
  "model": "anthropic/claude-...",   // dernier modèle utilisé (si connu)
  "prompt": "Ajoute le mode Orchestration...", // 1er message utilisateur (tronqué 500 c.)
  "summary": "Voici le plan...",      // 1er message assistant (tronqué 300 c.)
  "files": ["src/js/agent-pi.js","spec_orchestration.md"], // touchés (write/edit)
  "tags": ["architecture","orchestration"], // saisis par l'utilisateur
  "tokens": 15234,                   // total tokens (si connu, sinon null)
  "cost": 0.42,                      // coût $ (si connu, sinon null)
  "turns": 8,                        // nb de tours (messages utilisateur)
  "duration_s": null,                // non calculé en V1
  "origin": "desktop",               // "desktop" | "remote" | null
  "kind": "chat",                    // "chat" | "orchestration" | "review"
  "parent": null,                    // id de session parent (tâches orch.)
  "indexed_at": "2026-08-01T14:25:00"
}
```

Règles :
- `files` = chemins **relatifs** au projet, dédupliqués, triés. Extraits des
  `tool_use`/`tool_execution` `write`/`edit` du JSONL pi.
- `cost`/`tokens` : `null` pour les sessions rétro-indexées (non persisté par
  pi dans le JSONL). Renseignés pour les nouvelles sessions capturées en live.
- `tags` : persistés dans un fichier séparé `.pilot/sessions-tags.json`
  (`{ "<id>": ["tag1","tag2"] }`) pour éviter de réécrire l'index JSONL à
  chaque tag (append-only). Fusionné à la lecture.

## 4. Backend Rust (`lib.rs`)

Commandes Tauri :

| Commande | Type | Rôle |
|---|---|---|
| `index_sessions` | async | (Re)construit `.pilot/sessions.jsonl` depuis le dossier de sessions pi du projet. Rétro-indexation complète. Retourne le nb d'entrées. Idempotent : écrase l'index existant (sauf tags qui sont dans un fichier à part). |
| `search_sessions` | sync | Recherche dans l'index. Params : `query` (regex/substring sur prompt+summary+files), `tag` (filtre), `file` (filtre chemin relatif contenant), `kind` (chat/orchestration/review), `limit` (défaut 200). Retourne les entrées triées par timestamp décroissant. |
| `get_session_detail` | sync | Retourne le détail d'une session : l'entrée indexée + le contenu complet du JSONL pi (messages + tool calls) pour affichage. |
| `set_session_tags` | sync | Persiste les tags d'une session dans `.pilot/sessions-tags.json`. |
| `list_session_tags` | sync | Liste tous les tags utilisés (pour l'autocomplétion). |
| `record_session_entry` | async | Écrit/met à jour une entrée de session dans l'index (live, appelé par le frontend à l'`agent_end` / fermeture). Append : si une entrée avec le même `id` existe déjà, on la retire puis on réécrit (réécriture atomique du fichier). |

Réutilisation : le listing du dossier de sessions réutilise la même logique
que `list_sessions` (`resolve_agent_home` + `project_to_session_folder`).
Le parseur JSONL est partagé.

### Parseur JSONL pi (extraction)

Pour chaque fichier de session, on parcourt les lignes JSON et on collecte :
- 1er message `role:user` → `prompt` (tronqué 500 chars)
- 1er message `role:assistant` avec `content[].type:text` → `summary` (300 c.)
- tous les `content[].type:tool_use` (ou events `tool_execution_start` /
  `toolcall_start`) avec `name in [write,edit]` → `files` (input.path /
  input.file_path / input.filePath, normalisé relatif au projet)
- nb de messages `role:user` → `turns`
- coût/tokens : lus depuis les events `session_stats`/`agent_end` si présents
  (sinon null)

Défensif : tolère plusieurs schémas (pi évolue). Un fichier illisible est
ignoré (erreur non fatale).

## 5. Frontend

### 5.1 Nouveau module `src/js/session-history.js`

- `openSessionHistory()` : ouvre l'onglet 📜 (mode `history` dans `tabs.js`).
- Recherche en direct (debounce 250ms) : champ query + filtres tags/files/kind.
- Liste des entrées (date, prompt tronqué, modèle, badge kind, fichiers touchés,
  coût, tags cliquables).
- Clic sur une entrée → `get_session_detail` → panneau de détail (messages
  rendus en Markdown, tool calls repliables) — lecture seule.
- Édition des tags (chips + autocomplétion via `list_session_tags`).
- Bouton « 🔄 Réindexer » → `index_sessions` (toast + rafraîchissement).

### 5.2 Branchement `tabs.js`

- Nouveau mode `"history"` (icône 📜), `_openHistory()`, nettoyage au close.
- Bouton 📜 dans le panneau d'actions (après 🔍 Review), toujours visible
  (ne dépend pas de pi — l'index est un fichier, consultable hors-ligne).

### 5.3 Branchement `agent-pi.js` (capture live)

- À l'`agent_end` d'un tour (chat standard) : collecte prompt courant, résumé
  (dernier msg assistant), fichiers touchés (depuis `state.pendingToolCalls`
  + événements), modèle actif, stats (`get_session_stats`), origin, kind.
  → `record_session_entry` (append/maj).
- En Mode Orchestration : une entrée par tâche (`kind:"orchestration"`,
  `parent` = id de session principale) + une entrée de session globale.
- En Review (H5) : pas d'indexation (process pi temporaire cadré, lecture
  seule — pas de session persistée).

### 5.4 Settings

Aucun nouveau paramètre pour V1. L'index vit dans `.pilot/` du projet
(git-ignorable via `.gitignore` optionnel). Pas d'opt-in : l'indexation est
automatique et silencieuse (un fichier local, jamais envoyé nulle part).

## 6. Cycle de vie

| Événement | Action |
|---|---|
| Ouverture onglet 📜 | Charge `search_sessions("")`. Si l'index est absent (`indexed:false`) → `index_sessions` (rétro-index, fire-and-forget, toast discret si > 0) puis rafraîchit. Lazy : ne se déclenche qu'à l'ouverture de l'onglet, pas à l'ouverture du projet. |
| `agent_end` (chat) | `record_session_entry` (maj entrée session). |
| Fin tâche orchestration | (V1 : pas d'entrée de tâche distincte ; la session pi d'orchestration est rétro-indexable via « Réindexer ».) |
| Clic 📜 | Ouvre onglet, charge `search_sessions("")`. |
| Bouton 🔄 Réindexer | `index_sessions` puis rafraîchit la liste. |

## 7. Confidentialité

L'index reste **local au projet** (`.pilot/`), jamais envoyé au cloud ni
au web remote. Contient le texte des prompts (sensibles) → recommandé de
gitignore `.pilot/sessions.jsonl` et `.pilot/sessions-tags.json` (ajout au
`.gitignore` du projet si Pilot le gère, sinon à l'utilisateur). Aucun
impact sur le mode « Projet sensible » (H7) à venir.

## 8. Limites V1

- Pas de scoring sémantique (V2 : réutiliser l'index RAG H1 V2).
- `duration_s` non calculé.
- Pas de graphe de coût (un simple total par période suffit en V1 ; un
  dashboard « 📊 Usage » est évoqué mais reporté).
- La rétro-indexation ne remonte pas le coût/tokens (non persisté par pi).
- Purge automatique : les sessions pi plus anciennes que le délai de rétention
  configuré sont supprimées en arrière-plan (voir §9).

## 9. Purge automatique des sessions

Pour éviter l'accumulation de fichiers de session pi, Pilot purge automatiquement
les sessions plus anciennes qu'un délai de rétention paramétrable.

- **Paramètre** : `session_retention_days` dans `AppConfig` (défaut **15** jours,
  `0` = purge désactivée). Éditable dans **Paramètres ⚙️ → Agent Pi → Rétention
des sessions (jours)**.
- **Thread autonome** : `session_history::start_session_purge` démarre au `setup`
  un thread std détaché (`pilot-session-purge`) qui purge au démarrage puis
  toutes les heures. Il lit la config à chaque passe (paramètre modifiable à
  chaud, sans redémarrage).
- **Portée** : tous les projets ouverts (`config.open_projects`, sinon le projet
  actif).
- **Comportement** : `purge_old_sessions` supprime les fichiers `.jsonl` du
  dossier de sessions pi du projet dont le mtime est antérieur à
  `now - retention_days`, puis retire de l'index `.pilot/sessions.jsonl` les
  entrées dont le fichier n'existe plus et nettoie les tags correspondants dans
  `.pilot/sessions-tags.json`. Les données live (coût/tokens) des sessions
  restantes sont préservées (l'index n'est pas reconstruit en entier).
- **Sécurité** : `retention_days == 0` → aucune suppression. Une passe échouée
  est journalisée en stderr sans bloquer l'UI.

---

<!-- HELP:session-history -->
## Historique des sessions (onglet 📜)

L'onglet **📜** indexe **toutes** vos sessions agent (passées et nouvelles)
pour retrouver une décision, un prompt ou les fichiers touchés par une
session.

- **Ouvrir** : bouton 📜 du panneau d'actions. Au premier ouvrage d'un projet,
  Pilot réindexe automatiquement vos sessions pi existantes (toast discret).
- **Rechercher** : tapez dans le champ de recherche (full-text sur le prompt,
  le résumé et les fichiers touchés). Filtres : tags, fichier (chemin relatif),
  type (chat / orchestration).
- **Consulter** : cliquez une entrée pour afficher le détail complet de la
  session (messages + tool calls, lecture seule).
- **Tags** : ajoutez des tags à une session (chips + autocomplétion) pour la
  retrouver plus tard (ex: `architecture`, `bug`, `refactor`).
- **Réindexer** : bouton 🔄 pour reconstruire l'index depuis le dossier de
  sessions pi (utile après des sessions hors Pilot, ou si l'index est
  désynchronisé).
- **Confidentialité** : l'index est local (`.pilot/sessions.jsonl`), jamais
  envoyé au cloud ni au web distant. Il contient vos prompts : ajoutez
  `.pilot/sessions.jsonl` au `.gitignore` si vous ne voulez pas le committer.
- **Purge automatique** : les sessions pi plus anciennes que le délai de
  rétention configuré (défaut 15 jours) sont supprimées automatiquement en
  arrière-plan. Réglez ce délai dans **Paramètres ⚙️ → Agent Pi → Rétention
des sessions (jours)** (0 = désactivé).
<!-- /HELP:session-history -->