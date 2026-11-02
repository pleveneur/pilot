# Vérification — la partie Git du serveur GDS reste-t-elle inchangée ?

Audit en lecture seule (2026-10-25). Aucun fichier de code modifié. Sources : le code d'aujourd'hui + `PLAN-mode-reseau-multipostes.md` (cité `PLAN:NN`).

## 1. Où vit la partie Git du serveur

- `gds-core/src/git.rs` — un dépôt bare par projet : chemin (`git.rs:30`), validation anti-traversée (`git.rs:42`), création (`git.rs:149`, `git.rs:176`), matérialisation des dépôts annoncés en base (`git.rs:637`), suppression (`git.rs:64`).
- `gds-core/src/git_cmd.rs` — la seule commande `git init --bare` (`git_cmd.rs:11`).
- `gds-core/src/ssh.rs` — le SSH des dépôts : compte `git` (`ssh.rs:325`), `authorized_keys` régénéré depuis la base (`ssh.rs:994`), coquille `git-shell` seule acceptée (`ssh.rs:691`).
- `gds-server/sshd_config` — le démon : compte `git` seul, clef seule (`sshd_config:53-57`).
- `gds-server/src/main.rs` — job de maintenance : clefs + bares, en boucle (`main.rs:276-298`).
- Base : `git_repos` (`0001_init.sql:40-46`), `project_members` (`0001_init.sql:32-38`), `ssh_keys` (`0003_ssh_keys.sql:8-13`). Les références Git ne sont pas en base : elles vivent dans le dépôt bare sur disque (aucune table de références dans `0001`…`0007`).

## 2. La conception les touche-t-elle ? Non, fichier par fichier

- `gds-core/src/git.rs`, `gds-core/src/git_cmd.rs`, `gds-core/src/ssh.rs`, `gds-server/sshd_config`, `gds-server/src/main.rs` : **absents** de la liste des fichiers à modifier du plan (`PLAN:96-110`).
- `gds-core/src/lib.rs` : le plan y ajoute UNE ligne `pub mod handover;` (`PLAN:98`) ; elle ne retire ni ne modifie `pub mod git;` / `pub mod git_cmd;` (`lib.rs:15-16`) ni `pub mod ssh;` (`lib.rs:28`).
- Deux fichiers sont communs : `gds-core/src/db.rs` (contient `git_repos`, `db.rs:752`) et `gds-core/src/http.rs` (contient les routes Git, `http.rs:132`). Le plan y **ajoute** fonctions et routes ; il ne demande aucune modification de l'existant (`PLAN:103`). C'est le seul point de recouvrement — et il est traité aux §4 et §5.

## 3. Migrations : non, rien ne touche les tables du Git

Tables Git et migration qui les crée : `git_repos` → `0001_init.sql:40-46` ; `project_members` → `0001_init.sql:32-38` ; `ssh_keys` → `0003_ssh_keys.sql:8-13`. Aucune migration suivante ne les modifie (`0007` ne supprime que `project_locks`, `0007_drop_project_locks.sql:12`). Les deux migrations prévues n'existent pas encore (aucun `0008`/`0009` sur disque) et ne créent, d'après le plan, que deux tables neuves : `project_handovers` (`PLAN:72-80`) et `project_info` (`PLAN:88`). Le seul lien de `project_handovers` est `project_id → projects(id)` (`PLAN:74`) : jamais `git_repos`. **Réponse : non.**

## 4. Routes Git existantes — et nouvelles routes

Serveur (`gds-core/src/http.rs`) : `GET /api/gds/git-repos` (`http.rs:132`), `POST /api/gds/projects/create` (`http.rs:183`), `POST /api/gds/projects/repo-exists` (`http.rs:184-187`), `POST /api/gds/ssh-keys` (`http.rs:188`), `POST /api/gds/admin/projects/remove` (`http.rs:279-282`), `POST /api/gds/admin/ssh-keys/refresh` (`http.rs:254-257`), `GET /api/gds/admin/ssh-keys` (`http.rs:285`), `POST /api/gds/admin/ssh-keys/revoke` (`http.rs:286-289`). Poste (`src-tauri/src/gds_web.rs`) : `POST /api/gds/projects` (`gds_web.rs:46`), `POST /api/gds/sync` (`gds_web.rs:48`).

Les nouvelles routes (`handover`, `info`) ne peuvent ni les atteindre ni les court-circuiter : axum 0.7 monte des chemins **exacts**, et `http.rs` ne déclare aucun joker ni `fallback` (aucune occurrence `/*` ni `fallback` dans `http.rs`). Une route ajoutée est une ligne de plus (`PLAN:100`), la couche d'authentification reste la même pour tout le monde (`http.rs:215-219`).

## 5. Gardes d'écriture : la garde ne peut pas bloquer un envoi de code

Un `git push` ne passe par **aucune** route HTTP : le poste pousse en local vers le remote SSH (`src-tauri/src/git.rs:185-190`, appel `gds.rs:1718`), et le serveur ne voit que `git-shell` / `git-receive-pack` (`sshd_config:53-57`, `ssh.rs:691`). `http.rs` ne contient aucun appel `git push`. Une garde posée dans les handlers HTTP ne peut donc pas refuser un push, un fetch ou une lecture. Le précédent est net : `ensure_project_publisher` (`db.rs:1748`) n'est appelé que par la poussée du **suivi** (`gds_sync.rs:1013`) et jamais par `git.rs` (seule mention : un commentaire, `git.rs:85`). **Verdict : la garde ne s'applique pas au Git.** Le risque réel serait de la placer dans un code partagé avec `git.rs` — par exemple autour de `create_project_in_root` (`git.rs:176`) : c'est ce qu'il faudra vérifier à l'écriture (`PLAN:92` parle de « toute route d'écriture de projet »).

## 6. Le pont du poste

Concernés par le mode réseau : `src-tauri/src/gds_sync.rs` (pont suivi SQLite↔Postgres, `gds_sync.rs:3-8`), `src-tauri/src/gds_service.rs` (client HTTP du service : `/projects/create` `gds_service.rs:440`, `/tracking/*` `gds_service.rs:569-596`), `src-tauri/src/gds.rs` (connexion/ajout, `gds.rs:1690-1721`). Non concernés : `src-tauri/src/gds_ssh.rs` (clefs SSH). Côté Git : `src-tauri/src/git.rs` (`git_push` `git.rs:185`) et `src-tauri/src/gds_client.rs` (clone/fetch/pull, `gds_client.rs:115` et `gds_client.rs:142-143`).

La synchro de fond de 3 minutes n'existe pas encore. Le seul mécanisme de fond existant est la boucle de 30 s (`gds_sync.rs:848-901`) qui n'appelle que `sync_tracking_auto` (`gds_sync.rs:893`) : **aucune opération Git**. Le plan fixe la même règle pour la future boucle de 3 min : elle ne transporte aucun fichier de code (`PLAN:22`, `PLAN:39`). Réponse : non aujourd'hui ; la garantie devra être tenue par la nouvelle boucle quand elle sera écrite.

## 7. Conclusion

(a) **La partie Git du serveur GDS ne change pas** : aucun module Git, aucune table Git, aucune route Git, aucun accès SSH n'est dans le périmètre du plan.
(b) Ce qui protège d'une dérive : les tests de montage déjà en place — `shared_routes_merge_with_same_path_other_method` (`http.rs:2256`), `desktop_route_is_mounted` / `unknown_route_is_not_mounted` (`gds_web.rs:383`, `gds_web.rs:393`) — plus une règle écrite à ajouter : « aucune modification de `git.rs`, `git_cmd.rs`, `ssh.rs`, `sshd_config` sans audit dédié ».
(c) Deux points à surveiller : la place exacte de la garde d'écriture (`PLAN:92`) par rapport à `create_project_in_root` (`git.rs:176`), et la future boucle de fond, qui ne doit appeler que les informations projet.
