La suite `gds-server` passe : 35 tests réussis, 0 échec. Seul `gds-server/src/main.rs` a été modifié, et uniquement dans les deux tests visés. HEAD est toujours `6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87`, et je n'ai rien commité, indexé ni poussé.

**Lignes modifiées (numérotation actuelle)**
- **Test `admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end`, lignes 2015-2018** : le dépôt est maintenant pré-créé au chemin réel de la route, `gds_core::git::bare_path_in_root(&repos_root_str, "projet-l45")`, au lieu de `repo_bare_path`. Une erreur arrête le test avec `.expect(...)`, car la fonction de test ne renvoie pas de `Result`. Le dossier et le fichier `HEAD` sont créés comme avant.
- **Test `any_account_reads_and_any_dev_publishes_on_real_db`** :
  - **Lignes 3050-3071** : le test a sa propre racine de dépôts jetable, `temp_dir()/pilot-l34-repos-<pid>-<nanos>`, créée au départ. `<racine>/projet-l34.git` (dossier + `HEAD`) y est pré-créé via `bare_path_in_root`, avant l'appel à `POST /api/gds/projects/create`.
  - **Ligne 3077** : le `ServerCtx` reçoit cette racine (`repos_root: repos_root.clone()`) au lieu de `std::env::temp_dir()`.
  - **Ligne 3265** : j'ai ajouté un nettoyage que vous n'aviez pas demandé : `let _ = std::fs::remove_dir_all(&repos_root);` en fin de test, pour ne pas laisser le dossier dans `/tmp`.

Aucune assertion n'a été supprimée ni affaiblie. `bare_created == false` reste une vraie vérification de l'idempotence. Je n'ai touché ni à la production, ni aux autres tests, ni à Cargo, à la CI ou aux dépendances. Les autres blocs que `git diff` montre dans ce fichier existaient déjà avant ce lot.

**Résultat de `check-rust-postgres.py --package gds-server`**
- `rust_run_id` : **20261118-111910-204059**
- **35 réussis, 0 échec**, 0 ignoré, 0 filtré, `ok: true`
- Les deux tests visés sont `... ok`.
- `COMP01_SERVER_CTX_EXECUTED` figure dans le journal (`validation-logs/20261118-111910-204059-cargo-tests.log:56`).
- `cleanup_ok: true`, `personal_data_accessed: false`

**Limites**
- Comme prévu, je n'ai pas rejoué le run rouge.
- Si le test L34 échoue en cours de route, le nettoyage final n'est pas exécuté et sa racine jetable reste sous `/tmp`.
- Le test L45 utilise toujours `repo_bare_path` pour `projet-l45-b` (ligne 2162). Je l'ai laissé tel quel, comme demandé, et le test passe.