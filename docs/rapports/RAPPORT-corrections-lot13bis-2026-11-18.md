# Bilan LOT 13bis — COMP-01 branché en production

La correction est faite et prouvée dans les deux sens : le vrai `ServerCtx` réécrit maintenant `authorized_keys` dès qu'on change le statut d'un compte. Un point reste à signaler : la suite complète `gds-server` n'est pas verte (2 échecs sans rapport avec ce lot, détaillés plus bas).

Je n'ai rien commité, indexé ni poussé. Je n'ai pas pu lire le hash de HEAD : `git rev-parse` et `git log` ne font pas partie des commandes permises. Aucune de mes commandes ne déplace HEAD, il reste donc en principe sur 6d57ddd.

## Diagnostic confirmé
`impl GdsCtx for ServerCtx` ne redéfinissait pas `refresh_authorized_keys` et utilisait donc le défaut qui ne fait rien. Le test rouge le montre : la route répondait `"authorized_keys_rewritten": null`.

## Fichiers modifiés
- **`gds-server/src/main.rs`**
  - **Nouveau garde `GitHomeSandbox`** : il crée un dossier jetable unique (pid + nanosecondes) sous `temp_dir()` et y fait pointer `PILOT_GIT_USER_HOME`. Il garde l'ancienne valeur et la remet en place quand il est détruit (`set_var` si elle existait, sinon `remove_var`), même si une assertion échoue, puis supprime le dossier. Il est toujours créé après la prise du verrou, donc la remise en place a lieu avant que le verrou soit relâché.
  - **`accounts_create_list_disable_then_login_refused`** : le test prend maintenant `GIT_HOME_ENV_LOCK` et ouvre le bac à sable avant toute requête, puis le libère explicitement à la fin (`drop`). Aucune assertion modifiée, aucune attente ajoutée.
  - **Nouveau test `comp01_server_ctx_status_route_regenerates_authorized_keys`** : vrai `ServerCtx`, vrai `server_router`, base dédiée, clés fictives. Il vérifie :
    - à la désactivation de `victim` : réponse 200, `rewritten == true`, le fichier ne contient plus que la ligne de `keeper`, et la base indique `disabled` ;
    - à la réactivation : réponse 200, `rewritten == true`, le fichier contient de nouveau `keeper` puis `victim`, et la base indique `active`.

    Le marqueur `COMP01_SERVER_CTX_EXECUTED` n'est affiché qu'après toutes les assertions.
- **`gds-core/src/http.rs`** : `ServerCtx` redéfinit désormais `refresh_authorized_keys` et appelle `crate::ssh::regenerate_authorized_keys(pool).await.map(Some)`. Le trait, son défaut et les autres contextes n'ont pas changé.
- **`gds-core/src/ssh.rs`** : seul le commentaire de `stored_key_lines` a changé. Il indique maintenant que la route de statut régénère immédiatement et que la boucle de maintenance reste le filet périodique.
- **`spec_gds.md`** (ligne ~560, la spec décrivait déjà `users/status`) : ajout d'une phrase indiquant que le changement de statut régénère `authorized_keys` immédiatement côté serveur (COMP-01).

## Exécutions (toutes avec le helper PostgreSQL jetable)

| Étape | run_id | Filtre | Résultat |
|---|---|---|---|
| ROUGE | `20261118-105304-024202` | `comp01_server_ctx` | 0 réussi / 1 échec / 34 exclus |
| VERT | `20261118-105319-569546` | `comp01_server_ctx` | 1 / 0 / 34 |
| Test existant sécurisé | `20261118-105330-169450` | `accounts_create_list_disable` | 1 / 0 / 34 |
| Suite gds-server complète | `20261118-105338-096853` | aucun | 33 / **2** |
| Non-régression gds-core | `20261118-105426-582176` | `comp01` | 1 / 0 / 151 |

- **Échec du ROUGE :** `panicked at gds-server/src/main.rs:1804:9: ... ServerCtx doit régénérer authorized_keys : {"authorized_keys_rewritten":null,...} left: Null right: Bool(true)`.
- **Marqueur du VERT :** le journal `…105319-569546-cargo-tests.log` contient `test tests::comp01_server_ctx_status_route_regenerates_authorized_keys ... ok` (ligne 18) et `COMP01_SERVER_CTX_EXECUTED` (ligne 23).

## Limites et reliquats
1. **Suite gds-server complète : 2 échecs** sur l'assertion `bare_created == false`.
   - **Tests touchés :** `admin_screen_projects_purge_audit_and_ssh_revoke_end_to_end` (main.rs:2106) et `any_account_reads_and_any_dev_publishes_on_real_db` (main.rs:3154).
   - **Cause probable :** au moins le premier crée son faux dépôt avec `repo_bare_path`, qui ajoute un sous-dossier `repos/`, alors que la route s'appuie sur `bare_path_in_root`, qui n'en ajoute pas. Le dépôt créé n'est donc pas trouvé et la route renvoie `bare_created: true`. Je n'ai pas vérifié comment le second test crée son dépôt.
   - **Pourquoi je pense que ce n'est pas lié :** ni `git.rs` ni la route `projects/create` ne sont modifiés.
   - **Ce que je n'ai pas pu faire :** prouver que ces échecs existaient déjà avant ce lot, faute de pouvoir revenir à l'état d'origine avec les commandes permises. Je les ai laissés tels quels, comme demandé.
2. Les deux tests qui prenaient déjà le verrou (`l45` et `l2`) ne remettent toujours pas `PILOT_GIT_USER_HOME` en place après eux. Je ne les ai pas modifiés, c'était hors périmètre. Le garde `GitHomeSandbox` est prêt si on veut les y faire passer.
3. Comme prévu par le contrat du handler, les sessions SSH déjà ouvertes ne sont pas fermées par un changement de statut.
4. Sans droits root, la remise des permissions (700/600 et propriétaire `git`) échoue en silence. Le contenu du fichier est bien vérifié, mais pas son propriétaire.