# Corrections locales : deuxième lot, écritures résistantes aux interruptions

# Lot 2 : écritures du coffre et de `mcp.json` sans troncature

Les deux défauts sont confirmés, puis corrigés chacun par un cycle ROUGE/VERT. Si une écriture échoue avant le remplacement, le coffre et `mcp.json` gardent maintenant leur version précédente intacte. Rien n'a été commité, HEAD est toujours `6d57ddd`, et les fichiers du lot 1 n'ont pas été touchés.

## Constats

| ID | Statut | Détail |
|---|---|---|
| **VLT-01** | **Confirmé et corrigé** | Deux chemins d'écriture : `write_entries` (appelé par les commandes `vault_add`, `vault_update` et `vault_delete`) et `vault_set_master_password`. Tous deux appelaient `std::fs::write` directement sur `vault.json`, ce qui vide le fichier puis le réécrit sur place. |
| **COMP-13** | **Confirmé et corrigé** | `write_mcp_config`, appelé par `mcp_save_servers` et `mcp_set_servers_enabled`, copiait le `.bak` puis appelait `std::fs::write` directement sur `mcp.json`. |
| VLT-01, sauvegarde `vault.json.bak` proposée | **Reportée** | La politique de rétention n'est pas décidée par ce lot. Aucune copie du coffre n'est créée. |
| VLT-01, absence de verrou lecture-modification-écriture (point P3) | **Hors lot, non traité** | |
| VLT-01, écriture de la configuration (`lib.rs:1595`) et de l'édition web (`web_server.rs:825`) | **Hors périmètre, non traité** | |

## Ce qui a été fait

**Nouvelle fonction commune** `write_replacing(chemin, octets)` dans `src-tauri/src/atomic_file.rs`. Elle procède ainsi :
1. Elle crée un fichier temporaire dans le **même dossier**, nommé `.<nom>.<uuid>.tmp`. La création est exclusive : un fichier existant n'est jamais rouvert, donc deux écritures simultanées ne partagent jamais le même temporaire.
2. Sous Unix, ce temporaire est créé avec les droits `0600` (lisible par le seul propriétaire).
3. Elle écrit tout le contenu, force son passage sur le disque (`sync_all`) et ferme le fichier.
4. Elle renomme le temporaire par-dessus le fichier cible. L'ancien fichier n'est jamais supprimé d'abord.
5. Si une erreur survient avant le renommage, elle supprime le temporaire et remonte l'erreur ; le fichier cible n'a pas bougé.
6. Après un renommage réussi, elle synchronise le dossier sous Unix, sans que cette étape puisse faire échouer l'appel. Ainsi, un remplacement réellement fait sur disque n'est jamais annoncé comme un échec.
7. Si le chemin est un lien symbolique, c'est le fichier pointé qui est remplacé, comme avec l'ancien `std::fs::write`.

**Injection d'échec réservée aux tests.** Deux échecs peuvent être simulés : une écriture coupée à moitié, ou une erreur juste avant le renommage. Ce mécanisme n'est compilé qu'en mode test ; dans l'application livrée, la vérification vaut toujours « pas d'échec ». Ce sont des **erreurs d'entrée/sortie simulées, pas une vraie coupure de courant**.

**Branchements :**
- Le coffre utilise la nouvelle fonction dans `write_entries` et dans une fonction extraite, `set_master_password_at`. La commande `vault_set_master_password` ne remplace la clé en mémoire **qu'après** un renommage réussi, donc la clé reste cohérente avec le fichier sur disque.
- `mcp.json` passe par une fonction extraite, `write_mcp_config_at`. La copie `.bak` existante est conservée telle quelle.

## Méthode TDD

D'abord, la nouvelle fonction a reproduit exactement l'ancien comportement (vider le fichier puis écrire, soit l'équivalent de `std::fs::write`), avec le point d'injection en place. Les tests ont donc pu échouer sur la vraie troncature. Ensuite, l'écriture atomique a été mise en place.

| Étape | Run | Résultat observé |
|---|---|---|
| ROUGE coffre (`vault::tests`) | `20261116-084249-921961` | 8 réussis, **2 échecs** : `l'ancien coffre ne se déchiffre plus : Erreur format coffre: EOF while parsing a string` (aussi bien pour l'ajout d'entrées que pour le changement de mot de passe) |
| VERT coffre (`vault::tests`) | identifiant non relevé dans ma sortie (ma commande ne l'a pas extrait) | 10 réussis, 0 échec |
| Fonction commune (`atomic_file`) | `20261116-084421-139447` | 2 réussis, 0 échec |
| ROUGE MCP | `20261116-084513-951797` | **1 échec** : `DuringWrite : configuration perdue` |
| VERT MCP (`mcp_config`) | `20261116-084538-608820` | 43 réussis, 0 échec |
| **Suite `pilot --lib` complète** (filtre `::`) | `20261116-084648-733332` | **977 réussis, 0 échec, 3 ignorés, 0 filtré** |
| **JS + build** (`check.py`) | `20261116-084738-874525` | **6000 réussis, 0 échec, 1 en attente, build OK** |

Sur la baseline Rust : le helper lancé avec `--filter` n'exécute que les tests unitaires du paquet `pilot`. Le chiffre de 1144 / 14 ignorés n'est donc pas comparable directement. D'après les totaux du run ROUGE, ce périmètre comptait avant le lot 974 tests (971 réussis et 3 ignorés, chiffre déduit) ; il en compte maintenant 980, soit les 6 nouveaux tests. `gds-core` et `gds-server` n'ont pas été modifiés ni relancés.

## Nouveaux tests

Tous sont réellement exécutés : aucun n'est ignoré ni ne s'arrête avant ses assertions.

- **Dans `vault::tests` :**
  - `ecriture_interrompue_des_entrees_garde_l_ancien_coffre_dechiffrable` : couvre les deux échecs simulés et vérifie qu'il ne reste aucun temporaire.
  - `changement_de_mot_de_passe_interrompu_garde_l_ancien_coffre` : l'ancienne clé ouvre toujours le coffre.
  - `ecritures_reussies_du_coffre_restent_identiques` : même sel, nouvelle clé valide, refus si le coffre est verrouillé, droits `0600` sous Unix.
- **Dans `mcp_config::tests` :** `ecriture_interrompue_de_mcp_json_garde_l_ancienne_configuration`. Il vérifie l'ancienne configuration, le rôle du `.bak` et l'absence de résidu, avec une configuration et une référence de coffre fictives.
- **Dans `atomic_file::tests` :**
  - un fichier `data.json.tmp` étranger au mécanisme n'est jamais touché ;
  - avec 8 écritures simultanées, il reste une seule version complète et aucun résidu.

Les tests sur la fonction commune ne font que compléter les tests du coffre et de MCP ; ce ne sont pas eux qui prouvent les défauts.

## Fichiers modifiés

- `src-tauri/src/atomic_file.rs` (nouveau)
- `src-tauri/src/lib.rs` (déclaration du module)
- `src-tauri/src/vault.rs`
- `src-tauri/src/mcp_config.rs`
- `spec_vault.md` (section Règles)
- `spec_pilot.md` (ligne MCP, hors bloc HELP, donc pas d'aide à régénérer)

## Comportement préservé

- Formats JSON du coffre et de `mcp.json` inchangés.
- Chiffrement inchangé : AES-256-GCM, Argon2id, sel conservé lors d'une mise à jour des entrées, nouveau sel lors d'un changement de mot de passe.
- Messages d'erreur, API des commandes Tauri, minimum de 4 caractères pour le mot de passe maître, refus si le coffre existe et est verrouillé : inchangés.
- Références de secrets MCP et copie `.bak` de `mcp.json` inchangées.
- Aucune dépendance ajoutée : `uuid` était déjà présent.

## Limites et décisions

- **Windows non validé.** Selon sa documentation, `std::fs::rename` remplace une destination existante (via `MoveFileExW` ou `SetFileInformationByHandle`). Si la cible est verrouillée par un autre programme ou en lecture seule, l'écriture échoue : l'erreur est remontée et l'ancien fichier est conservé. Je n'ai volontairement **pas** ajouté de solution de repli qui supprimerait l'ancien fichier avant de renommer. Le test d'écritures simultanées tolère donc des refus sous Windows.
- **Coupure brutale réelle non simulable ici.** Elle peut laisser un fichier `.vault.json.<uuid>.tmp` (chiffré, droits `0600`). Aucun nettoyage automatique n'est prévu : c'est une décision de politique, non tranchée.
- **Droits des fichiers.** Sous Unix, `vault.json` et `mcp.json` deviennent `0600` après réécriture. L'assertion `0600` passait déjà avant la correction (probablement à cause du `umask` de l'environnement isolé) : elle ne constitue donc pas une preuve. Sous Windows, le fichier hérite des droits du dossier.
- **Lien symbolique cassé.** C'est un cas rare : l'écriture renvoie maintenant une erreur, alors que l'ancien `std::fs::write` créait le fichier pointé. Aucune donnée n'est perdue dans ce cas.
- **Restes à traiter.** La copie `.bak` de MCP n'est pas atomique (comportement existant, laissé tel quel ; l'erreur de copie reste ignorée). Le verrou du coffre (point P3) et l'écriture de la configuration générale restent à faire.
- **`AGENTS.md`** n'a pas été modifié. Ajouter une ligne pour `atomic_file.rs` dans son arborescence partielle reste à décider.

Ce lot ne termine pas l'audit global.