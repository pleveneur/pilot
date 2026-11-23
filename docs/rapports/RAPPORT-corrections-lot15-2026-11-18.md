# Corrections locales : lot 15 (hygiène et documentation)

Le correcteur a atteint `error_max_turns` après avoir appliqué les trois changements ; les
vérifications ci-dessous ont été exécutées par le coordinateur sur l'état final.

- `gds-server/src/main.rs` : `admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end` et
  `any_account_reads_and_any_dev_publishes_on_real_db` utilisent `GitHomeSandbox` (restauration de
  `PILOT_GIT_USER_HOME` au `Drop`, verrou conservé).
- `gds-server/src/main.rs` : `projet-l45-b` est créé via `bare_path_in_root` (chemin réel de la
  route) ; l'assertion de purge devient effective.
- `spec_super_agent.md` § « Lecture seule — garantie » : la promesse de « lecture seule stricte » et
  de garantie technique absolue est remplacée par un texte factuel (outils de fichier filtrés,
  commandes shell non filtrées) ; `help/handbook.md` régénéré : True.

## Vérifications réelles
| Run | Résultat |
|---|---|
| Rust workspace | {"passed": 1163, "failed": 0, "ignored": 14, "measured": 0, "filtered_out": 0} |
| gds-server PostgreSQL | {"passed": 34, "failed": 1, "ignored": 0, "measured": 0, "filtered_out": 0}, marqueurs ['COMP01_SERVER_CTX_EXECUTED'], cleanup True, skip None |
| JS + build | {"numTotalTests": 6048, "numPassedTests": 6047, "numFailedTests": 0, "numPendingTests": 1, "numTodoTests": 0} |

Verdict coordinateur : ROUGE. Aucun commit ; HEAD 6d57ddd119fbb173bf962eb2f7400e7e6ea6ca87.
