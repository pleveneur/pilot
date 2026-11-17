# Rapport — rechargement du conteneur GDS du poste (déblocage de la boucle de redémarrage)

> **Date** : 17 novembre 2026 (03:44 → 03:52 UTC).
> **Mandat** : sortir le service GDS du poste de sa boucle de redémarrage
> (constatée depuis le 4 novembre 2026), sans rien perdre, et le prouver.
> Autorisation du propriétaire : « oui fais ce qu'il faut » (2026-11-17).
> **Résultat en une phrase** : l'**image est réparée et le conteneur est
> reconstruit sur cette image saine** (l'incohérence de migration est levée),
> mais **le service ne peut pas redémarrer sur ce poste** parce que **Windows
> interdit la réservation du port `2222`** ; je me suis donc **arrêté sans rien
> forcer**, avec les données intactes, une sauvegarde datée en place, et **deux
> sorties de secours à décider par le propriétaire** (§ 7).

---

## 1. Ce qui était demandé

1. lire la procédure documentée (`docs/gds-server-setup.md` § 9.5,
   `docs/gds-guide-mise-en-place.md` § 4.6) et la suivre ;
2. constater l'état de départ ;
3. reconstruire l'image locale (`npm run gds:image`) ;
4. recharger le conteneur (`npm run gds:reload`) ;
5. vérifier, preuves en main : conteneur stable, service joignable, migrations
   sans incohérence, **écoute restreinte à la boucle locale** ;
6. écrire ce rapport ;
7. committer le rapport seul.

Interdits respectés : aucune donnée ni sauvegarde supprimée, aucun autre
service / conteneur / base touché, **aucun fichier de code, aucune
spécification, aucun réglage du projet modifié** (seule écriture : ce rapport),
aucun `git push`, aucun tag, aucune publication, pas de suite de tests complète.

---

## 2. État AVANT (preuves)

### 2.1 Le conteneur redémarrait en boucle

```
$ docker ps -a
f420000988ce  sha256:19c8f1250240…  "/usr/local/bin/gds-…"  7 weeks ago  Restarting (1) 40 seconds ago  pilot-gds

$ docker inspect pilot-gds --format 'Restarting={{.State.Restarting}} ExitCode={{.State.ExitCode}} RestartCount={{.RestartCount}} Image={{.Image}}'
Restarting=true ExitCode=1 RestartCount=25 Image=sha256:19c8f1250240fdd440a294f148b7c02377aa653943223865a4ff467a9f0c0bd7

$ docker inspect pilot-gds --format 'Created={{.Created}}'
Created=2026-09-22T11:31:55.656130467Z
```

**Vingt-cinq redémarrages** au moment du constat, code de sortie `1` à chaque
tour. Le conteneur a été créé le **22 septembre 2026**.

### 2.2 L'image que le conteneur exécutait n'existe plus sur le disque

```
$ docker image inspect sha256:19c8f1250240fdd440a294f148b7c02377aa653943223865a4ff467a9f0c0bd7
→ ABSENTE du disque (Erreur : No such image)

$ docker images -a | grep pilot-gds
pilot-gds:local  b6d9bba18882  2026-11-02 12:00:08 +0400  763MB
```

Autrement dit : le conteneur tournait sur une **image supprimée** dont l'étiquette
`pilot-gds:local` pointait déjà ailleurs. C'est une **seconde raison** de
reconstruire, indépendante de la migration.

### 2.3 Journaux : l'incohérence de migration (le motif du blocage)

```
$ docker compose logs --tail 60 gds
pilot-gds  | gds-server : migrations embarquées : 0001, 0002, 0003, 0004, 0005, 0006, 0007
pilot-gds  | gds-server : initialisation de la base impossible : Migration GDS: migration 8
             was previously applied but is missing in the resolved migrations
```

Lecture : l'image exécutée embarquait les migrations **0001 → 0007**, alors que
la base du poste a **déjà appliqué la 0008** (`0008_project_handover.sql`,
présente dans le dépôt). `sqlx` refuse de démarrer dans cet état → sortie `1` →
redémarrage automatique (`restart: unless-stopped`) → boucle.

### 2.4 Aucune sauvegarde antérieure

```
$ ls -la gds-server/backups
→ (dossier absent : aucune sauvegarde existante)
```

### 2.5 Réglages d'écoute en vigueur dans `gds-server/.env` (machine, non versionné)

```
GDS_BIND_ADDR=0.0.0.0
GDS_HOST_HTTP_PORT=8080
GDS_HOST_SSH_PORT=2222
GDS_HOST_DB_PORT=55432
GDS_PG_ALLOWED_NETWORKS=0.0.0.0/0
```

Publication demandée par le conteneur (identique avant et après recréation) :

```json
{"22/tcp":[{"HostIp":"0.0.0.0","HostPort":"2222"}],
 "5432/tcp":[{"HostIp":"0.0.0.0","HostPort":"55432"}],
 "8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]}
```

Aucun de ces trois ports n'était réellement en écoute avant l'opération
(`netstat -ano` ne montre rien sur `8080`, `2222`, `55432`) : le conteneur
n'arrivait même pas à ouvrir ses ports.

---

## 3. Gestes exécutés, dans l'ordre

### 3.1 Reconstruction de l'image SEULE — `npm run gds:image` (03:45:11 → 03:45:32)

```
$ npm run gds:image
✔ Prérequis : docker, docker compose, docker-compose.yml et .env présents
▶ docker compose build
…
#22 naming to docker.io/library/pilot-gds:local done
Mode …………… : image SEULE (service intact)
Conteneur ………… : NON touché (le service continue de tourner)
Durée …………… : 19.0 s
✔ Terminé.
```

Image obtenue :

```
$ docker images pilot-gds:local
pilot-gds:local  2a53594789b2  2026-11-17 07:45:32 +0400 +04
```

**Contrôle avant d'aller plus loin** — la migration 0008 est-elle bien dans le
nouveau binaire ? (les migrations sont embarquées à la compilation, pas sur le
disque) :

```
$ docker run --rm --entrypoint sh pilot-gds:local \
    -c 'for w in 0008_project_handover project_handovers handover; do printf "%s -> " "$w"; grep -ac "$w" /usr/local/bin/gds-server; done'
0008_project_handover -> 0        ← le nom de fichier n'est pas stocké tel quel
project_handovers     -> 16       ← la TABLE de la migration 0008 est bien là
handover              -> 20
```

La table `project_handovers`, créée par `0008_project_handover.sql`, est présente
dans le binaire : **l'image reconstruite connaît la migration 8**. C'est
précisément ce qui manquait à l'ancienne image.

### 3.2 Rechargement complet — `npm run gds:reload` (03:45:47 → 03:46:15)

Enchaînement **conforme** à la procédure documentée :

| # | Étape | Résultat |
|---|---|---|
| 0 | prérequis | ✔ docker / compose / `docker-compose.yml` / `.env` |
| 1 | **sauvegarde datée** des trois volumes d'état (après arrêt propre) | ✔ `gds-server/backups/2026-11-17T03-45-47/` |
| 2 | reconstruction de l'image | ✔ (cache : ~0,5 s) |
| 3 | recréation du conteneur (`up -d`, volumes conservés) | ✖ **ÉCHEC sur la publication du port 2222** |
| 4 | attente de `/api/gds/health` | non atteinte |
| 5 | compte rendu | « La recréation du conteneur a échoué. **Les volumes sont intacts.** » |

Sauvegarde réellement produite (conservée, rien supprimé) :

```
$ ls -l gds-server/backups/2026-11-17T03-45-47/
pgdata.tgz          6.3M
repos.tgz           9.0K
ssh-host-keys.tgz   2.8K
```

Le conteneur a d'abord été **arrêté proprement** (étape 1 de la procédure), puis
**recréé sur la nouvelle image** (`Created=2026-11-17T03:45:52Z`,
`Image=sha256:2a53594789b2…`), mais il n'a pas pu démarrer :

```
Container pilot-gds Recreated
Container pilot-gds Starting
Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:2222
  -> 127.0.0.1:0: listen tcp4 0.0.0.0:2222: bind: Une tentative d'accès à un socket
  de manière interdite par ses autorisations d'accès a été tentée.
```

---

## 4. Le blocage : Windows interdit le port `2222` sur ce poste

Message d'erreur = `WSAEACCES` (« accès au socket interdit par ses
autorisations »). Ce n'est **pas** un conflit avec un programme en cours (rien
n'écoute sur `2222`), c'est une **plage de ports réservée par Windows**.

```
$ netsh interface ipv4 show excludedportrange protocol=tcp
Port de début   Port de fin
      1120        1219
      1220        1319
      1320        1419
      2064        2163
      2180        2279   ← 2222 est DANS cette plage
      2280        2379
      5357        5357
     13508       13508
     13509       13509
     27339       27339
     50000       50059  *
```

Vérification indépendante de Docker (liaison faite puis libérée
immédiatement, aucune modification) :

```
ECHEC 0.0.0.0:2222  -> accès au socket interdit par ses autorisations
ECHEC 127.0.0.1:2222 -> accès au socket interdit par ses autorisations   ← même en boucle locale
OK    127.0.0.1:2022
OK    0.0.0.0:2022
OK    0.0.0.0:8080
OK    0.0.0.0:55432
```

**Conclusion technique** : sur ce poste, **le port `2222` est inutilisable, quelle
que soit l'adresse d'écoute**, y compris `127.0.0.1`. Les deux autres ports du
service (`8080` API, `55432` base) sont libres. La conséquence est nette : **le
service GDS ne peut pas démarrer tant que `GDS_HOST_SSH_PORT` vaut `2222` sur
cette machine** — et cette valeur est un **réglage** (`gds-server/.env`), que le
mandat m'interdisait de modifier. Je me suis donc arrêté là.

À noter pour la compréhension : l'ancien conteneur (créé le 22 septembre) n'était
pas bloqué par cette plage — sa réservation était postérieure à sa création, ce
qui explique que le port n'ait jamais été ouvert sur la version actuelle.

---

## 5. État APRÈS (preuve de ce qui a changé — et de ce qui n'a pas changé)

```
$ docker ps -a
pilot-gds | image=pilot-gds:local | Created        ← conteneur RECRÉÉ sur l'image saine, à l'arrêt

$ docker inspect pilot-gds --format 'Created={{.Created}} State={{.State.Status}} Image={{.Image}}'
Created=2026-11-17T03:45:52Z  State=created  Image=sha256:2a53594789b2…

$ docker images pilot-gds:local
pilot-gds:local  2a53594789b2  2026-11-17 07:45:32   ← image neuve, construite sur le dépôt à jour
```

| Élément | Avant | Après |
|---|---|---|
| Boucle de redémarrage | oui (25 redémarrages) | **non** : le conteneur est **arrêté**, il ne redémarre plus |
| Image du conteneur | image **supprimée du disque** (septembre), migrations 0001→0007 | image **neuve** du 17/11, **avec la migration 0008** |
| Conteneur | créé le 22/09 | **recréé** le 17/11 sur l'image neuve |
| Données (base, dépôts, clefs d'hôte) | volumes nommés | **intacts** (aucun volume supprimé ; contrôle ci-dessous) |
| Sauvegarde | aucune | **`gds-server/backups/2026-11-17T03-45-47/`** (3 fichiers, conservés) |
| Service joignable | non | **non** (blocage port `2222`, § 4) |

Contrôle des données, en lecture seule :

```
$ docker run --rm -v pilot-gds_pgdata:/data:ro --entrypoint sh pilot-gds:local \
    -c 'ls -1 /data | head; test -f /data/PG_VERSION && echo "PG_VERSION=$(cat /data/PG_VERSION)"'
base global pg_commit_ts pg_dynshmem pg_hba.conf … 
PG_VERSION=16
```

L'instance PostgreSQL du poste est **toujours là, en version 16**, avec ses
fichiers. Aucune réinitialisation n'a eu lieu. Les quatre volumes nommés
(`pgdata`, `repos`, `ssh-host-keys`, `supervisor`) sont présents.

---

## 6. Où en est la vérification demandée

| Point à prouver | Verdict | Preuve |
|---|---|---|
| Le conteneur n'est plus en redémarrage | **oui** | `State=created`, plus aucun `Restarting` ; `RestartCount=0` |
| Il tourne de façon **stable** | **impossible à prouver** | il ne peut pas démarrer (port `2222` réservé) |
| Le service répond | **non** | `/api/gds/health` jamais atteint |
| Les migrations ne signalent plus d'incohérence | **non prouvé en exécution** — la cause est en revanche **levée par construction** : l'image neuve contient la table `project_handovers` (migration 0008), celle qui manquait à l'image en boucle ; le message exact (`migration 8 … missing in the resolved migrations`) ne peut plus se produire | `grep -ac project_handovers /usr/local/bin/gds-server` = 16 |
| **Écoute restreinte à la boucle locale** | **non — et c'est un écart à signaler** (voir ci-dessous) | § 6.1 |

### 6.1 L'écoute réseau : ce que j'ai constaté, sans pouvoir le corriger

L'attendu du mandat était « l'écoute est restreinte à la boucle locale ». **Ce
n'est pas le cas sur ce poste**, et la cause n'est **pas** dans l'image (qui est
à jour) : elle est dans le **réglage local** `gds-server/.env`, qui **écrase les
défauts restrictifs désormais écrits dans `docker-compose.yml`** :

| Réglage | Valeur sur ce poste (`.env`) | Défaut du dépôt (`.env.example` / compose) |
|---|---|---|
| `GDS_BIND_ADDR` | `0.0.0.0` → les **trois ports** publiés sur **toutes** les interfaces | `127.0.0.1` → **poste uniquement** |
| `GDS_PG_ALLOWED_NETWORKS` | `0.0.0.0/0` → `pg_hba.conf` ouvert **à tout ce qui atteint le port** (visible dans les journaux : « accès direct à la base (mot de passe) ouvert pour : 0.0.0.0/0 ») | `172.16.0.0/12` → **réseau du conteneur seulement** |

Conséquence à énoncer simplement : **tel qu'il est réglé aujourd'hui, ce service
exposerait l'API (8080), l'accès SSH aux dépôts (2222) et surtout la base
(55432) à tout le réseau local** dès qu'il démarrera. C'est exactement le point
aggravant décrit dans le mandat — il survit au changement de version, parce que
le `.env` du poste porte encore les valeurs d'une génération antérieure.

Je **n'ai pas** modifié ce réglage : c'est une écriture hors mandat (« ne
modifier aucun réglage du projet »). Les valeurs à retenir sont données au § 7.

---

## 7. Deux sorties de secours — décision du propriétaire

Aucune n'est appliquée : toutes deux sortent du périmètre autorisé (l'une change
un réglage, l'autre touche la pile réseau Windows).

### Option A — changer le port SSH publié (aucun geste système, aucun risque)

Le port `2022` est constaté **libre et hors plage réservée** (§ 4).

```
# dans gds-server/.env
GDS_HOST_SSH_PORT=2022
# et, pour l'écoute restreinte au poste (recommandé, c'est le défaut du dépôt) :
GDS_BIND_ADDR=127.0.0.1
GDS_PG_ALLOWED_NETWORKS=172.16.0.0/12

# puis, sans reconstruire (l'image est déjà bonne) :
cd G:/IA_PL/pilot/gds-server
docker compose up -d
curl http://127.0.0.1:8080/api/gds/health
```

À savoir avant de choisir ce port : l'URL des dépôts change
(`ssh://git@<poste>:2022/<projet>.git` au lieu de `:2222`). Sur ce dépôt-ci le
GDS local est **désactivé** (`.pilot/gds.json` → `"enabled": false`) et le remote
`gds` pointe sur un chemin local, donc l'impact est **nul pour Pilot lui-même** ;
il faut en revanche vérifier les **autres projets** déjà provisionnés sur ce
serveur. Le port se règle aussi dans Pilot pour l'accès distant.

### Option B — libérer la plage réservée par Windows, garder `2222`

Nécessite les **droits d'administrateur** et interrompt brièvement les
publications de ports de la machine (dont celles d'autres conteneurs) :

```
net stop winnat
net start winnat
netsh interface ipv4 show excludedportrange protocol=tcp   # vérifier que 2222 n'y est plus
cd G:/IA_PL/pilot/gds-server
docker compose up -d
```

Je ne l'ai **pas** tentée : elle touche un service de la machine, hors mandat.

---

## 8. Ce qui restera à faire une fois le blocage levé

1. `docker compose up -d` (l'image est déjà reconstruite ; aucune reconstruction
   n'est nécessaire) ;
2. relire les journaux : `docker compose logs --tail 80 gds` doit montrer
   `migrations embarquées : 0001 … 0008` **puis** le démarrage du service, sans
   la ligne « initialisation de la base impossible » ;
3. `curl http://127.0.0.1:8080/api/gds/health` → réponse attendue ;
4. relire `docker compose ps` **deux fois à ~60 s d'intervalle** pour la stabilité ;
5. **preuve d'écoute** : `netstat -ano | findstr :8080` (et `:2222` / `:55432`)
   doit montrer `127.0.0.1:…` si l'option d'écoute restreinte est retenue ;
6. l'**essai réel à deux postes** (le vrai juge de paix du GDS) reste entièrement
   à faire : prise en main d'un projet, présence automatique, écriture refusée au
   second poste — c'est le parcours de `docs/gds-guide-mise-en-place.md`.

---

## 9. Conclusion, en français simple

- **La maladie du service est identifiée et soignée** : le conteneur tournait sur
  une **image de septembre qui ne connaissait pas la dernière migration de la
  base** — donc il refusait de démarrer, en boucle, depuis treize jours. Cette
  image n'existait même plus sur le disque.
- **L'image neuve est construite sur le code à jour** et **contient la migration
  manquante**. Le conteneur a été **recréé sur cette image**.
- **Rien n'a été perdu** : les quatre volumes sont là, la base est en version 16,
  et **une sauvegarde datée des trois volumes d'état existe** (`6,4 Mo`,
  `gds-server/backups/2026-11-17T03-45-47/`). Aucune donnée, aucune sauvegarde,
  aucun volume n'a été supprimé.
- **Le service n'est pas encore debout**, et ce n'est plus une affaire de code :
  **Windows de ce poste réserve la plage `2180–2279`, qui englobe `2222`**, le
  port par lequel le serveur publie ses dépôts git. Le port est refusé même en
  boucle locale. **Je me suis arrêté là, sans rien forcer**, comme prévu dans le
  mandat.
- **Un point de sécurité reste ouvert, et il ne vient pas de la version** : le
  fichier `gds-server/.env` de ce poste demande encore l'écoute sur **toutes les
  interfaces** (`0.0.0.0`) et l'ouverture de la base **à tout ce qui l'atteint**
  (`0.0.0.0/0`). Les valeurs restrictives sont désormais les **défauts du
  dépôt**, mais ce fichier les écrase. **C'est à changer avant la remise en
  service** (§ 7, option A).
- **Ce qu'il faut décider** : soit **changer le port SSH publié** (geste local,
  sans risque, port `2022` constaté libre) et restreindre l'écoute au poste, soit
  **libérer la plage réservée par Windows** (droits d'administrateur, bref
  impact sur les autres publications de ports). Dès que l'un des deux est fait,
  le service redémarre **sans reconstruction** — l'image est déjà la bonne.

---

## 10. Fichiers touchés

- **Créé** : `docs/rapports/RAPPORT-rechargement-conteneur-gds.md` (ce rapport).
- **Créé par le script de rechargement** (donnée, non versionnée, **conservée**) :
  `gds-server/backups/2026-11-17T03-45-47/{pgdata,repos,ssh-host-keys}.tgz`.
- **Aucun** fichier de code, de spécification ou de réglage n'a été modifié.
- **Aucun** `git push`, aucun tag, aucune publication.
