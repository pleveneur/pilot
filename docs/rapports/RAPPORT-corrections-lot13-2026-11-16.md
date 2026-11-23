# Corrections locales : lot 13

J'ai branché le déclenchement dans le handler, mais **la régénération en production n'est pas branchée** : `ServerCtx` garde le comportement par défaut, qui n'écrit rien. Le serveur dépend donc toujours de la boucle de maintenance. C'est un arbitrage que je te remonte (point 3) plutôt que de le trancher seul.

## 1. Défaut confirmé
`gds_admin_user_status` (`gds-core/src/http.rs`, ancien bloc 609-621) change le statut en base, révoque les jetons web et écrit l'audit, mais ne demande aucune mise à jour du fichier SSH. Le run ROUGE le montre : après une désactivation acceptée, le mécanisme SSH a été appelé 0 fois au lieu d'une.

## 2. Ce qui est corrigé (seul fichier modifié : `gds-core/src/http.rs`, +311/−3)
- **Point d'injection** : `GdsCtx` a une nouvelle méthode `refresh_authorized_keys(&pool)`. Par défaut, elle répond « ce contexte ne gère pas SSH » sans rien écrire. Le poste (`WebCtx`), les contextes de test et `NullCtx` en héritent sans modification. Aucun code n'utilise `dyn GdsCtx`, et la structure `ServerCtx` est inchangée.
- **Handler** : la méthode est appelée juste après le changement en base et la révocation des jetons.
  - En cas de succès : réponse 200 comme avant, avec un champ en plus, `authorized_keys_rewritten` (`null` si le contexte ne gère pas SSH). Audit `user_status` réussi.
  - En cas d'échec : erreur 500 par le mécanisme existant, avec le message « Résultat partiel : … l'accès SSH n'est PAS confirmé à jour ». Audit `user_status` en échec, avec le détail `email (status=…, authorized_keys refresh failed)`. Le statut et la révocation des jetons sont conservés : rien n'est annulé ni réactivé.
- **Inchangés** : validation du statut, réponse 404 pour un email inconnu, garde du dernier administrateur actif, `require_admin`, les autres routes, la politique SSH. Les sessions SSH déjà ouvertes ne sont pas coupées.

## 3. Point reporté : le branchement de `ServerCtx` exige de modifier un autre fichier
Le test opt-in `accounts_create_list_disable_then_login_refused` (`gds-server/src/main.rs:1338-1619`, actif avec `PILOT_GDS_HTTP_TEST_URL`) construit un vrai `ServerCtx` sans rediriger `PILOT_GIT_USER_HOME`, puis désactive un compte par cette route (ligne 1581).

Si `ServerCtx` appelait `regenerate_authorized_keys`, ce test lancerait `getent passwd git`, chown et l'écriture du vrai `~git/.ssh/authorized_keys`. Ce fichier serait vidé, puisque le test n'enregistre aucune clé : sur une machine qui a un compte git, c'est une coupure de tous les accès SSH. Rien ne permet d'éviter ce risque en restant dans `http.rs`.

Je n'ai donc pas branché la production. Il faut un lot qui touche `gds-server/src/main.rs` :
1. ce test prend `GIT_HOME_ENV_LOCK` et pointe `PILOT_GIT_USER_HOME` vers un bac à sable, comme les tests de `main.rs:1738` et `main.rs:2208` ;
2. ensuite, `impl GdsCtx for ServerCtx` redéfinit la méthode avec `crate::ssh::regenerate_authorized_keys(pool).await.map(Some)`.

Le test de non-régression de ce branchement reste à faire dans ce même lot.

## 4. Test et runs
Le test `comp01_status_route_refreshes_authorized_keys_immediately` passe par le vrai routeur (`server_router`, authentification puis `require_admin`) sur une base PostgreSQL jetable. Il n'a pas de `#[ignore]` et suit la même garde d'environnement que le lot 12.

Le contexte de test écrit dans un fichier explicitement temporaire avec les vraies fonctions du lot 12 : `stored_key_lines`, `render_authorized_keys` et `write_authorized_keys`. Il n'appelle jamais `regenerate_authorized_keys` et ne modifie aucune variable globale.

Ce qu'il vérifie :
- **Refus** : un non-admin (403), le dernier admin actif (409), un statut inconnu (400) et un email inconnu (404) ne déclenchent rien. Aucun appel SSH, fichier, base et sessions intacts.
- **Désactivation** : un appel SSH pendant la requête elle-même, sans attente. La clé d'Alice disparaît, celles de Bob et Carol restent, la session web d'Alice est révoquée et celle de Bob est conservée.
- **Échec d'écriture** : provoqué par la vraie `write_authorized_keys`, dont le dossier parent est un fichier ordinaire. Réponse 500 au lieu de `ok`, le compte reste désactivé, la session est révoquée, l'audit est en échec.
- Le marqueur `COMP01_HTTP_DB_EXECUTED` n'est émis qu'après toutes les assertions.

| Run | Résultat |
|---|---|
| ROUGE `20261116-140454-469965` | 0/1, `left: 0, right: 1`, « the status route must refresh authorized_keys immediately » |
| VERT `20261116-140517-880051` | 1/1 |
| Suite gds-core `20261116-140536-974257` | **141 réussis, 0 échec, 11 ignorés** (baseline 140, +1) ; marqueur d'absence de base (`database_skip_marker`) à `null`, nettoyage OK |

Je n'ai pas vu le marqueur moi-même : les journaux du helper sont hors de ma zone de lecture. Le contrôle d'Hermes doit le confirmer.

## 5. Limites et reliquats
- **gds-server et le poste ne sont pas compilés par moi**, faute de commande autorisée. Ils ne devraient pas casser, puisque la méthode a une implémentation par défaut, mais la suite Rust automatique doit le confirmer.
- **`POST /api/gds/users/validate`** (compte en attente qui devient actif) ne déclenche toujours aucune mise à jour SSH. Hors périmètre.
- Le commentaire de `stored_key_lines` dans `ssh.rs` (« pas de régénération au changement de statut ») reste exact en production tant que le point 3 n'est pas fait.
- Non validés : la GUI, un vrai sshd ou serveur GDS, Windows/macOS, et la coupure des sessions SSH ouvertes.
- COMP-01 reste **partiel**. Aucun commit ni push ; HEAD est toujours `6d57ddd`.