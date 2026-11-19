La purge supprime maintenant bien le dépôt créé par `POST /api/gds/projects/create`, et les trois vérifications sont vertes. Je n'ai fait aucun commit, stage, push ni PR, et HEAD est toujours 6d57ddd.

## Modifications

1. **`gds-core/src/git.rs:543-566`** : nouvelle fonction `remove_bare_in_root(bare_root, project_name)`, placée juste après `bare_path_in_root`.
   - Elle valide le nom avec `validate_project_name`, puis calcule le chemin avec `bare_path_in_root`, soit `<racine>/<nom>.git`.
   - Elle refuse tout chemin qui sort de `bare_root` ou qui serait la racine elle-même.
   - Elle supprime le dossier avec `remove_dir_all` s'il existe. Si le dossier est absent, elle répond Ok.
   - `remove_bare` et son contrat `<dir>/repos/...` ne changent pas. Ses appelants dans `src-tauri/src/gds.rs` ne sont pas touchés.
2. **`gds-core/src/http.rs:1201`** : dans `gds_admin_project_remove`, seule la ligne de la purge change : `crate::git::remove_bare` devient `crate::git::remove_bare_in_root`. La lecture du nom en base, la 404, la suppression en base et la réponse restent identiques.
3. **`gds-core/src/git.rs:965-990`** : nouveau test `remove_bare_in_root_deletes_only_the_root_repo`. Il crée `<root>/proj.git` et vérifie que ce chemin est celui de `bare_path_in_root`. Il le supprime et contrôle qu'il a disparu, que la racine est toujours là et qu'un second appel répond Ok. Enfin, il vérifie que `../outside` est refusé et que les dossiers voisins `outside` et `outside.git` restent en place.

Le `git diff --stat` de `http.rs` affiche +325 lignes, mais ce sont des modifications d'un lot précédent qui n'étaient pas encore commitées. Ma part se limite à cette ligne.

## Vérifications

| Commande | run_id | Résultat |
|---|---|---|
| `check-rust-postgres.py --package gds-server` | 20261118-113615-779495 | **35 réussis / 0 échec**, marqueur `COMP01_SERVER_CTX_EXECUTED` présent (log, l.57). `admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end` réussit (il échouait au run 20261118-113212-980444). |
| `check-rust-postgres.py --package gds-core` | 20261118-113641-679675 | **142 réussis / 0 échec / 11 ignorés**, aucun saut lié à la base (`database_skip_marker: null`). Le nouveau test et `remove_bare_never_leaves_repos_dir_and_is_idempotent` réussissent. |
| `check-rust-compat.py` (workspace) | 20261118-113652-959112 | **1164 réussis / 0 échec / 14 ignorés** |

## Limites

- Le commentaire de doc de `gds_admin_project_remove` (`http.rs:1173`) cite encore `git::remove_bare` et « le dossier `repos` du serveur ». Il est désormais inexact. Je ne l'ai pas corrigé, puisque la consigne interdisait tout autre changement dans cette fonction. Il suffit de remplacer ce nom par `remove_bare_in_root` et de parler de la racine des dépôts.
- Je n'ai pas vérifié le cas où `repos_root()` vaut `None`. La purge n'y fait alors rien et la route répond quand même `purged: true`. Ce comportement existait déjà et n'est pas couvert par cette correction.