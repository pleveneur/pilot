# Rapport — option A appliquée : le service GDS est DEBOUT sur le port 2022

> **Date** : 18 novembre 2026 (11:23 → 11:26 UTC).
> **Mandat** : le propriétaire a **tranché l'option A** décrite au § 7 de
> `docs/rapports/RAPPORT-rechargement-conteneur-gds.md` — changer le port SSH
> publié (`2222` → `2022`) et restreindre l'écoute au poste, puis démarrer le
> service.
> **Résultat en une phrase** : **le service GDS est debout, sain et stable**, sur
> `127.0.0.1` uniquement, avec `2022` accepté par Windows, `/api/gds/health`
> répond `HTTP 200`, les données sont intactes et **aucun projet ni réglage ne
> pointait sur `2222`**.

---

## 1. Ce qui était demandé

1. lire d'abord le § 7 du rapport de rechargement et appliquer **l'option A
   telle qu'elle y est décrite** ;
2. dans `gds-server/.env` (non versionné), poser trois réglages :
   `GDS_HOST_SSH_PORT=2022`, `GDS_BIND_ADDR=127.0.0.1`,
   `GDS_PG_ALLOWED_NETWORKS=172.16.0.0/12` — sans en supprimer aucun autre et
   sans jamais afficher un secret ;
3. démarrer (`docker compose up -d`) et **vérifier en vrai** : `docker ps` (`Up`)
   **et** `curl http://127.0.0.1:8080/api/gds/health` ;
4. si le port `2022` était refusé, **s'arrêter** et le dire (option B interdite) ;
5. relever les projets provisionnés dont une adresse de dépôt ou un
   `.pilot/gds.json` pointe encore sur `2222` (lister les autres, ne rien
   toucher) ;
6. écrire ce rapport ;
7. commit local, **aucune poussée**.

Interdits respectés : aucune suppression (donnée, volume, sauvegarde, conteneur,
fichier), aucun autre conteneur / service / base touché, **aucune commande
`netsh` ni `net stop winnat`**, aucun `git push`, aucun tag, aucune publication,
aucune modification de version, **aucun code de l'application modifié**, aucun
secret affiché ni recopié.

---

## 2. État AVANT (rappel + constat)

```
$ docker ps -a --filter name=pilot-gds
pilot-gds | pilot-gds:local | Created        ← depuis le 17/11 03:45 (14 jours d'immobilité)

$ docker images pilot-gds:local
pilot-gds:local  2a53594789b2  763MB          ← image saine, construite le 17/11

$ docker volume ls | grep pilot-gds
pilot-gds_pgdata  pilot-gds_repos  pilot-gds_ssh-host-keys  pilot-gds_supervisor

$ ls gds-server/backups/
2026-11-17T03-45-47/                          ← sauvegarde datée présente, conservée
```

Réglages **avant** (fichier machine `gds-server/.env`, **non versionné** :
`.gitignore:12` l'exclut) :

| Réglage | Avant | Après |
|---|---|---|
| `GDS_BIND_ADDR` | `0.0.0.0` (les 3 ports sur **toutes** les interfaces) | **`127.0.0.1`** |
| `GDS_HOST_SSH_PORT` | `2222` (refusé par Windows : plage réservée `2180–2279`) | **`2022`** |
| `GDS_PG_ALLOWED_NETWORKS` | `0.0.0.0/0` (base ouverte à tout ce qui l'atteint) | **`172.16.0.0/12`** |

Les autres réglages (`GDS_HOST_HTTP_PORT=8080`, `GDS_HOST_DB_PORT=55432`,
compte administrateur facultatif, mots de passe…) sont **inchangés**, et les
surcharges par port (`GDS_HTTP_BIND_ADDR`, `GDS_DB_BIND_ADDR`,
`GDS_SSH_BIND_ADDR`) restent **commentées** : elles retombent donc sur
`GDS_BIND_ADDR=127.0.0.1`.

Contrôle de la résolution **avant** démarrage (extrait, sans aucune valeur
secrète) :

```
$ docker compose config | grep -n "host_ip\|target\|published"
host_ip: 127.0.0.1   target: 8080   published: "8080"
host_ip: 127.0.0.1   target: 22     published: "2022"
host_ip: 127.0.0.1   target: 5432   published: "55432"
```

---

## 3. Geste exécuté

```
$ cd gds-server && docker compose up -d
 Container pilot-gds Recreate
 Container pilot-gds Recreated
 Container pilot-gds Starting
 Container pilot-gds Started
```

Aucune reconstruction d'image n'a été nécessaire (l'image du 17/11 contient déjà
la migration `0008`, cf. rapport précédent). Le conteneur `Created` a été
**recréé** sur la même image ; **les quatre volumes ont été conservés**.

---

## 4. Preuve de santé (la vraie preuve : la réponse du service)

### 4.1 Le conteneur tourne, et il est sain

```
$ docker ps --filter name=pilot-gds
pilot-gds | Up About a minute (healthy) |
  127.0.0.1:8080->8080/tcp, 127.0.0.1:2022->22/tcp, 127.0.0.1:55432->5432/tcp

$ docker inspect pilot-gds --format 'State={{.State.Status}} Restarting={{.State.Restarting}} RestartCount={{.RestartCount}} StartedAt={{.State.StartedAt}}'
State=running Restarting=false RestartCount=0 StartedAt=2026-11-18T11:23:40.479626609Z
```

**Stabilité** — deux relevés à ~90 s d'intervalle, **même** `StartedAt`,
`RestartCount=0`, aucun redémarrage, état `healthy` aux deux relevés.

### 4.2 Le service répond

```
$ curl -s -w '\nHTTP=%{http_code}\n' http://127.0.0.1:8080/api/gds/health
{"version":"0.4.16","migration_version":8,"uptime_seconds":105,"users":2,"projects":1,"git_repos":1}
HTTP=200
```

`uptime_seconds` est passé de `9` à `105` entre les deux appels : **le processus
n'a pas été relancé** entre-temps.

### 4.3 Les trois ports répondent, et seulement en boucle locale

```
$ netstat -ano | findstr "127.0.0.1:8080 127.0.0.1:2022 127.0.0.1:55432"
  TCP    127.0.0.1:2022    0.0.0.0:0   LISTENING   20660
  TCP    127.0.0.1:8080    0.0.0.0:0   LISTENING   20660
  TCP    127.0.0.1:55432   0.0.0.0:0   LISTENING   20660
```

Les trois sont liés à **`127.0.0.1`** : le service n'est **plus** exposé au
réseau local (écart de sécurité du § 6.1 du rapport précédent → **levé**).

Sonde directe (connexion TCP réelle) :

```
2022  OK banner: SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u10
8080  OK (connexion établie)
55432 OK (connexion établie)
```

`2022` **est accepté par Windows** (il n'est pas dans la plage réservée) : la
liaison a réussi pour de vrai, il n'y a donc **pas eu besoin de toucher au
réseau Windows**, et **aucune commande `netsh` n'a été exécutée**.

### 4.4 Journaux : migrations, base, sshd, superviseur

```
$ docker compose logs --tail 40 gds        (extraits)
gds-server : migrations embarquées : 0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008
gds-server : migrations appliquées jusqu'à la version 0008
gds-server : administrateur déjà initialisé (1 compte(s))
gds-server : à l'écoute sur 0.0.0.0:8080          ← à l'intérieur du conteneur (normal)
entrypoint: clef d'hôte ed25519 conservée (empreinte inchangée)
entrypoint: clef d'hôte rsa conservée (empreinte inchangée)
entrypoint: clefs autorisées : 1 clef(s) dans /home/git/.ssh/authorized_keys
gds-server : dépôts bare : 0 créé(s), 1 déjà présent(s)
Server listening on 0.0.0.0 port 22.
success: sshd entered RUNNING state / gds-server … / postgres …
```

La ligne `migration 8 … missing in the resolved migrations` (la maladie des
13 jours) **n'apparaît plus** : les migrations vont bien jusqu'à `0008`.

### 4.5 Écoute de la base : restriction réellement appliquée

`pg_hba.conf` effectif **dans le conteneur** (lignes utiles seulement, aucune
entrée `0.0.0.0/0` ne subsiste) :

```
local all all                                trust
host  all all  127.0.0.1/32                  scram-sha-256
host  all all  ::1/128                       scram-sha-256
host  all all  172.16.0.0/12                 scram-sha-256   ← réseau Docker uniquement
```

Le poste continue donc de joindre la base publiée sur `127.0.0.1:55432` (la
connexion arrive vue comme `172.18.0.1`, couverte par `172.16.0.0/12`), mais
**plus aucun autre réseau**.

### 4.6 Données : rien n'a bougé

```
$ docker run --rm -v pilot-gds_pgdata:/data:ro … cat /data/PG_VERSION
16

$ docker compose exec -T gds psql -U postgres -d pilot_gds -Atc …
2                 ← 2 comptes
10                ← 10 entrées d'audit déjà là
PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2) on x86_64-pc-linux-gnu

$ docker compose exec -T gds ls -1 /srv/git/repos
Kodali.git        ← dépôt bare conservé
```

Les volumes `pilot-gds_pgdata`, `pilot-gds_repos`, `pilot-gds_ssh-host-keys`,
`pilot-gds_supervisor` sont présents, et la sauvegarde
`gds-server/backups/2026-11-17T03-45-47/` est **intacte**. Aucune suppression.

---

## 5. Projets provisionnés : qui pointe encore sur `2222` ? — **personne**

Recherche exhaustive des fichiers de configuration GDS locaux :

```
$ find /g -maxdepth 4 -path "*/.pilot/gds.json"
/G/IA_PL/Kodali/.pilot/gds.json
/G/IA_PL/pilot/.pilot/gds.json
/G/testsnake2/.pilot/gds.json
```

| Projet | `enabled` | adresse de dépôt / base | référence à `2222` ? |
|---|---|---|---|
| `G:\IA_PL\Kodali` | oui | `ssh_host` = `127.0.0.1:22`, base `127.0.0.1:55432` | **non** |
| `G:\IA_PL\pilot` | **non** (désactivé) | `ssh_host` = `:22`, base vide | **non** |
| `G:\testsnake2` | oui | `ssh_host` = `localhost:22`, base `localhost:5432` | **non** |

Côté serveur, le seul projet provisionné en base est `Kodali`
(`projects` : 1 ligne), et son dépôt est enregistré par un **chemin local**
(`git_repos` : 1 ligne) — **aucune URL SSH avec un port** n'y figure. L'`health`
le confirme : `projects: 1`, `git_repos: 1`.

Le remote `gds` du dépôt Pilot pointe également sur un **chemin local Windows**
(`G:\IA_PL\pilot\src-tauri\laya.__probe2__\pilot-gds-absent-10988`), donc le
passage `2222 → 2022` **ne casse rien pour Pilot**.

**Conclusion** : aucun projet, aucun remote, aucune ligne en base ne référence
le port `2222`. **Rien n'a donc été modifié dans ces fichiers** — il n'y avait
rien à corriger.

---

## 6. Ce qui reste à faire (côté postes / projets — pas fait ici)

1. **Accès depuis un autre poste** : l'écoute est désormais `127.0.0.1`
   **seulement**. Un second poste du réseau ou du tailnet **ne peut pas**
   atteindre le service. Pour l'usage à plusieurs, il faudra soit
   `tailscale serve` pour l'API, soit les surcharges par port prévues par le
   dépôt (`GDS_SSH_BIND_ADDR` / `GDS_DB_BIND_ADDR` = adresse Tailscale
   `100.x.y.z`), puis `docker compose up -d`. **Décision du propriétaire**, pas
   un geste de cette mission.
2. **Documents et écrans qui nomment encore `2222`** : `docs/gds-server-setup.md`,
   `docs/gds-guide-mise-en-place.md`, `spec_gds.md` et le champ « Port SSH des
   dépôts » des écrans GDS indiquent `2222` (valeur **par défaut du dépôt**, juste
   pour une machine où `2222` est libre). Sur **ce poste**, la valeur à saisir est
   **`2022`** ; l'URL des dépôts devient
   `ssh://git@<hôte>:2022/srv/git/repos/<projet>.git`.
3. **Essai réel à deux postes** — le vrai juge de paix du GDS (prise en main d'un
   projet, présence automatique, écriture refusée au second poste) : entièrement
   à faire, parcours de `docs/gds-guide-mise-en-place.md`.
4. **Réglage du projet Kodali** : son `ssh_host` pointe sur `127.0.0.1:22`
   (SSH natif Windows), pas sur le service. À revoir **par le propriétaire**
   quand il voudra que ce projet utilise réellement les dépôts du serveur GDS.

---

## 7. Ce qui n'a pas marché

**Rien.** Le port `2022` a été accepté du premier coup, le conteneur est passé
`Created → Up (healthy)` sans redémarrage, et le service répond. Les trois ports
sont liés à la boucle locale comme demandé.

---

## 8. État final, en une table

| Élément | Avant | Après |
|---|---|---|
| Conteneur `pilot-gds` | `Created` (14 jours) | **`Up (healthy)`**, `RestartCount=0` |
| Service `/api/gds/health` | jamais atteint | **`HTTP 200`**, `version 0.4.16`, `migration_version 8` |
| Migrations | incohérence empêchant le démarrage | **`0001 … 0008` appliquées** |
| Port SSH publié | `2222` (refusé par Windows) | **`2022`** (accepté, banner OpenSSH lu) |
| Écoute | `0.0.0.0` (tout le réseau) | **`127.0.0.1`** (poste uniquement) |
| Base — réseaux autorisés | `0.0.0.0/0` | **`172.16.0.0/12`** (réseau Docker) |
| Données (base, dépôts, clefs) | volumes présents | **intacts** (`PG_VERSION=16`, 2 comptes, 1 dépôt) |
| Sauvegarde datée | présente | **intacte, conservée** |
| Projets référençant `2222` | — | **aucun** |

---

## 9. Fichiers touchés

- **Modifié** : `gds-server/.env` (fichier **machine, non versionné** —
  `.gitignore:12`) : trois réglages, aucun autre supprimé, aucun secret affiché.
  Une copie de l'état antérieur a été faite **hors du dépôt** (dossier temporaire
  du système).
- **Créé** : `docs/rapports/RAPPORT-gds-option-a-port-2022.md` (ce rapport).
- **Aucun** fichier de code, de spécification ou de documentation existante n'a
  été modifié. Aucun `git push`, aucun tag, aucune publication, aucune version
  changée, aucun conteneur / volume / sauvegarde supprimé.
