# Corrections locales : lot 12

## Bilan du lot 12 : seules les clés des comptes actifs sont réécrites

Le défaut est démontré sur un vrai PostgreSQL 16 jetable, puis corrigé dans `gds-core/src/ssh.rs`. Ce fichier est le seul modifié (132 lignes ajoutées, 1 supprimée). Aucun commit ni push n'a été fait, HEAD est toujours `6d57ddd`.

### Défaut démontré
`stored_key_lines` (`gds-core/src/ssh.rs:926`) sélectionnait toutes les clés enregistrées, quel que soit le statut du propriétaire. Pendant le run ROUGE, après `set_user_status(alice, "disabled")`, la sélection contenait encore quatre lignes : Alice (désactivée), Bob (actif), Carol (`pending`) et Dave (`disabled`). La maintenance aurait donc réécrit ces clés dans `authorized_keys`.

### Correctif
J'ai ajouté `WHERE u.status = 'active'` à la requête, avec un commentaire qui indique la portée exacte du correctif. Le reste est inchangé :
- **Préservé :** le format `type base64 email`, l'ordre `ORDER BY k.id`, la déduplication de `render_authorized_keys` et l'écriture idempotente.
- **Réactivation :** les clés ne sont pas supprimées de `ssh_keys`. Repasser un compte à `active` les fait revenir.

### Test de comportement
J'ai ajouté le test `authorized_keys_exclude_keys_of_inactive_accounts`, sans `#[ignore]`.
- **Données :** une base migrée jetable via `crate::db::tests::fresh_migrated_test_db()`, avec uniquement des comptes et des clés publiques fictifs (aucune clé privée).
- **Chaîne testée :** les vraies fonctions `stored_key_lines`, `render_authorized_keys` et `write_authorized_keys`, avec un chemin temporaire explicite. Le test n'appelle jamais `regenerate_authorized_keys`, ni ssh, ni chown, ni sshd.
- **Vérifications :**
  - les deux comptes actifs sont présents au départ ;
  - après désactivation, la clé d'Alice disparaît de la sélection et du fichier, et seule celle de Bob reste ;
  - les clés `pending` et `disabled` ne sont jamais autorisées ;
  - après réactivation, la sélection vaut exactement `[Alice, Bob]`, sans doublon ;
  - un second passage n'écrit rien.
- **Garde d'environnement :**
  - sans URL ni `PILOT_GDS_TEST_REQUIRED`, le test affiche « NOT EXECUTED » et s'arrête, comme pour le CI sans base ;
  - si l'URL est présente mais inutilisable, ou si `PILOT_GDS_TEST_REQUIRED` est posé, il **échoue** (`panic!`) ;
  - le marqueur `COMP01_DB_EXECUTED` n'est émis qu'après toutes les assertions.

### Runs (helper PostgreSQL, conteneurs neufs, suppression confirmée à chaque fois)

| Run | Filtre | Résultat |
|---|---|---|
| ROUGE `20261116-135021-529355` | le nouveau test | 0 réussi / 1 échec (assertion « key of a disabled account still selected ») |
| VERT `20261116-135039-619192` | le même test | 1 réussi / 0 échec |
| Suite complète `20261116-135053-810052` | gds-core | **140 réussis, 0 échec, 11 ignorés** (la base de référence était de 139 réussis ; +1 = le nouveau test) |

**Marqueur : je n'ai pas pu le voir moi-même.** Le journal du helper est hors du dossier que j'ai le droit de lire, et le résumé JSON n'affiche pas les sorties des tests réussis. Deux éléments montrent quand même que le test a tourné sur la base :
- le run ROUGE a échoué sur des données réellement lues en base ;
- avec `REQUIRED=1`, le seul autre chemin possible est un `panic!` ; le helper indique d'ailleurs `database_skip_marker: null`.

La présence littérale de `COMP01_DB_EXECUTED` reste à confirmer par le contrôle automatique d'Hermes.

### Limites et reliquat de COMP-01 (non résolus)
- **Pas de régénération immédiate :** la route HTTP de désactivation (`http.rs:609-618`) ne relance toujours pas `regenerate_authorized_keys`. Un compte désactivé garde donc son accès SSH jusqu'à la prochaine boucle de maintenance, soit au plus environ 30 s d'après `gds-server/src/main.rs:276-278`, et plus si la maintenance échoue ou ne tourne pas. C'est hors lot.
- **Sessions SSH déjà ouvertes :** elles ne sont pas coupées.
- **Le reste n'est pas traité :** la politique de rôles et de dépôts côté SSH, les commandes forcées et `git-shell` sur le poste dev (COMP-02), ainsi que la prise en main des projets (COMP-03).
- **Non validé :** le comportement d'un vrai sshd sur le serveur GDS, et Windows/macOS.

COMP-01 n'est donc **que partiellement** traité, et les droits SSH ne sont pas résolus dans leur ensemble.

Contrôles effectués : `stored_key_lines` (la fonction corrigée) a été relue ; ses appelants (`regenerate_authorized_keys`, `sync_authorized_keys`, `http.rs`, `gds-server`, `src-tauri/gds_ssh.rs`) n'ont pas changé de signature ; le test L2.5 existant (compte actif) passe toujours ; aucun autre fichier n'est modifié.