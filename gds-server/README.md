# Serveur GDS — conteneur tout-en-un

Ce dossier contient le **serveur GDS** de la refonte : un **conteneur unique** qui
réunit la **base de données PostgreSQL**, les **dépôts git** (accès SSH) et le
**service HTTP** (`/api/gds/*`). Un seul conteneur à démarrer, aucune
installation de PostgreSQL ou de serveur SSH sur le poste.

| Fichier | Rôle |
|---|---|
| `Dockerfile` | recette de l'image tout-en-un (PostgreSQL 16 + sshd + git + service) |
| `docker-compose.yml` | **le fichier à utiliser** : service unique, ports, volumes |
| `.env.example` | **modèle** des variables d'environnement (aucun secret dedans) |
| `entrypoint.sh` | amorçage : base, migrations, dépôts, clefs, puis supervision |
| `supervisord.conf` | surveillance des trois processus internes + socket de pilotage du service (L2.10) |
| `sshd_config` | service SSH des dépôts (clef uniquement, compte `git`) |

> L'image se construit **localement** sur le poste (`docker compose up -d --build`).
> Elle n'est tirée ni poussée vers aucun registre.

---

## 1. Première installation (Windows, Docker Desktop)

Aucun shell Unix n'est nécessaire sur le poste : tout est un champ du fichier de
composition.

1. **Créer le fichier de variables** (nom exact `.env`, à côté du modèle) :

   ```powershell
   cd G:\IA_PL\pilot\gds-server
   Copy-Item .env.example .env      # PowerShell
   # cmd.exe : copy .env.example .env
   ```

2. **Renseigner le seul secret obligatoire** dans `.env` :
   `POSTGRES_PASSWORD` (mot de passe du rôle applicatif `pilot`, long et unique).
   Le fichier `.env` n'est **jamais** versionné et n'entre **pas** dans l'image.
   Sans le fichier `.env`, Docker Compose s'arrête en le nommant ; tant que le
   fichier existe mais que `POSTGRES_PASSWORD` est vide, le service refuse de
   démarrer et l'explique dans `docker compose logs gds`.

3. **Construire et démarrer** :

   ```powershell
   docker compose up -d --build
   docker compose ps               # attendre l'état « healthy »
   ```

4. **Créer le compte administrateur** : au premier démarrage, aucun
   administrateur n'existe. Appelez **une seule fois** la route
   d'initialisation (`POST /api/gds/setup`, corps JSON
   `{"email":…,"password":…}`, puis `409`) — le détail et la commande exacte
   sont dans [`docs/gds-server-setup.md`](../docs/gds-server-setup.md) §2.4 —
   ou renseignez `GDS_ADMIN_EMAIL` + `GDS_ADMIN_PASSWORD` dans `.env` **avant**
   le tout premier démarrage pour un démarrage non interactif. Aucun mot de
   passe n'est généré.

5. **Vérifier depuis le poste** (voir §3 pour les commandes exactes) : la base
   répond et la route de santé répond.

### Remplir l'écran GDS de Pilot

| Champ de l'écran GDS | Valeur à saisir |
|---|---|
| Hôte PostgreSQL | `localhost` (ou `127.0.0.1`) |
| Port PostgreSQL | `5432` (ou `GDS_HOST_DB_PORT` si changé) |
| Utilisateur | `pilot` |
| Mot de passe | la valeur de `POSTGRES_PASSWORD` |
| Port SSH | `2222` (ou `GDS_HOST_SSH_PORT` si changé) |
| Racine des dépôts côté serveur | `/srv/git/repos` |

> **Profil réseau privé (L2.9, §5)** : si la base écoute sur l'adresse
> Tailscale (`GDS_DB_BIND_ADDR=100.x.y.z`), remplacez **Hôte PostgreSQL** par
> cette adresse (ou le nom MagicDNS du poste) — `localhost` ne répondrait plus.

---

## 2. Ports publiés et volumes (ce que fait `docker-compose.yml`)

### Ports publiés sur le poste

| Port poste | Port conteneur | Usage | Pourquoi publié |
|---|---|---|---|
| `8080` | `8080` | API HTTP `/api/gds/*` (santé, écrans d'administration) | décision 9/10 |
| `2222` | `22` | accès SSH aux dépôts git (clone / fetch / push) | décision 5 |
| `5432` | `5432` | PostgreSQL, **accès direct du poste** | décision « le poste parle en direct à la base » : les synchronisations de projet ne passent pas par l'API |

Les hôtes et les ports publiés sont réglables dans `.env`
(`GDS_BIND_ADDR` = défaut commun, puis par port `GDS_HTTP_BIND_ADDR`,
`GDS_SSH_BIND_ADDR`, `GDS_DB_BIND_ADDR`, §2bis du modèle — L2.9) ainsi que les
ports `GDS_HOST_HTTP_PORT`, `GDS_HOST_SSH_PORT`, `GDS_HOST_DB_PORT` ; les valeurs
par défaut sont celles du tableau.

> ⚠️ **Port `5432` déjà occupé par un autre PostgreSQL** (cas fréquent :
> PostgreSQL installé sur le poste, ou base locale provisionnée par Pilot
> lui-même). Le port publié par le conteneur n'est alors **pas** joignable en
> boucle locale : Windows route `127.0.0.1:5432` vers le service natif, et le
> poste parle à la **mauvaise** base — symptôme typique : mot de passe refusé
> alors qu'il est juste (`password authentication failed for user "pilot"`).
> Vérifier, puis **déplacer le port publié** (le port interne du conteneur ne
> change pas) :
>
> ```powershell
> netstat -ano | findstr :5432      # Windows
> ss -ltnp | grep :5432             # Linux / macOS
> ```
>
> puis `GDS_HOST_DB_PORT=55432` (port libre) dans `.env` et
> `docker compose up -d`.

### Accès direct à la base (mot de passe)

PostgreSQL n'ouvre par défaut que la **boucle locale**. Or une connexion qui
arrive par le port publié est vue comme venant de la **passerelle du réseau
Docker** (`172.18.0.1`), jamais de `127.0.0.1` : sans ouverture explicite, elle
est refusée (`no pg_hba.conf entry for host …`). Le conteneur ouvre donc l'accès
**par mot de passe** (méthode `scram-sha-256`, jamais `trust`) aux réseaux
listés dans `GDS_PG_ALLOWED_NETWORKS` — `0.0.0.0/0` par défaut, c'est-à-dire
« tout ce qui atteint le port publié ».

La restriction **réelle** reste la publication des ports (`GDS_BIND_ADDR`, cf.
§5) ; pour restreindre davantage, donner une liste de plages CIDR séparées par
des virgules (ex. `192.168.1.0/24,100.64.0.0/10` sous Linux, où PostgreSQL voit
l'adresse réelle du client). Détail dans `.env.example`.

### Volumes nommés

Le conteneur **démarre** sans volume (base vierge créée au premier démarrage),
mais il ne **conserve** rien sans eux. Ils sont nommés — jamais des dossiers
Windows `C:\…` : les dépôts bare et le cluster PostgreSQL dépendent des
permissions POSIX, qu'un montage NTFS ne conserve pas.

| Volume (`docker volume ls`) | Point de montage | Contenu | Perdu si absent |
|---|---|---|---|
| `pilot-gds_pgdata` | `/var/lib/postgresql/data` | cluster PostgreSQL (base + suivi) | oui — base perdue |
| `pilot-gds_repos` | `/srv/git/repos` | dépôts bare | oui — historique perdu |
| `pilot-gds_ssh-host-keys` | `/etc/ssh/host_keys` | clefs d'hôte sshd | oui — chaque poste doit ré-autoriser le serveur |
| `pilot-gds_supervisor` | `/var/log/supervisor` | journal du superviseur interne **+ journal d'audit du service** (`web_audit.jsonl`) | non — confort (redémarrages, états FATAL) |

Les journaux exploitables restent dans `docker logs` : les trois processus
écrivent sur la sortie standard. Le volume `supervisor` garde en plus le journal
propre du superviseur, qui survit à `docker compose down` / `up`.

---

## 3. Vérification (les deux constats exigés)

Depuis le poste, une fois `docker compose ps` à l'état **healthy** :

```powershell
# 1) la route de santé répond
curl http://127.0.0.1:8080/api/gds/health

# 2) la base répond
#    a. si le poste possède un client PostgreSQL :
psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "select 1"
#    b. sinon — et SANS rien installer ni télécharger — le client PostgreSQL
#       déjà présent dans l'image, qui emprunte le port publié du poste (donc
#       le même chemin que Pilot, à travers la passerelle Docker) :
docker exec -e PGPASSWORD="<POSTGRES_PASSWORD>" pilot-gds `
  psql -h host.docker.internal -p 5432 -U pilot -d pilot_gds -c "select 1"
```

Si `GDS_HOST_DB_PORT` a été changé (cf. l'avertissement du §2), remplacer `5432`
par sa valeur dans les deux commandes `psql`.

Attendu : `{"version":…,"migration_version":…,"users":…,"projects":…,"git_repos":…}`
pour la route de santé, et une ligne `1` pour la base.

Si le poste n'a ni client PostgreSQL ni Docker utilisable, l'équivalent **sans
rien installer** est un échange PostgreSQL minimal en `node` (présent sur le
poste) : connexion TCP sur le port publié, message de démarrage, réponse
d'authentification `SCRAM-SHA-256`, puis `select 1`.

---

## 4. Utilisation courante

```powershell
docker compose ps                 # état du service (healthy / unhealthy)
docker compose logs -f gds        # journaux des trois processus
docker compose stop               # arrête le conteneur (volumes CONSERVÉS)
docker compose start              # redémarre
docker compose down               # supprime le conteneur (volumes CONSERVÉS)
docker compose down -v            # ⚠️ supprime AUSSI les volumes = données perdues
docker compose up -d --build      # reconstruit l'image puis démarre
```

Les données, les dépôts et les empreintes de clefs **survivent** à
`docker compose down` et `up` : ce sont les volumes qui les portent.
Seul `down -v` les détruit.

L'arrêt et le redémarrage **du service** depuis Pilot (sans toucher au
conteneur) sont décrits au §4bis.

---

## 4bis. Arrêter et redémarrer le SERVICE depuis Pilot (L2.10)

« Le service » désigne les deux processus qui composent l'accès :
`gds-server` (l'API HTTP `/api/gds/*`) et `sshd` (l'accès aux dépôts git par
clef). **PostgreSQL n'en fait pas partie** : la base reste en marche, donc les
données et le suivi sont intacts. L'arrêt du **conteneur** entier (base comprise)
reste un choix du propriétaire, sur le poste : `docker compose stop`.

L'écran d'administration de Pilot (onglet **GDS**, encadré « Contrôle du
serveur ») propose deux boutons, réservés au rôle `admin` :

| Bouton | Route appelée | Effet |
|---|---|---|
| **Redémarrer le service** | `POST /api/gds/admin/service/restart` | redémarre `gds-server` et `sshd` |
| **Arrêter le service** | `POST /api/gds/admin/service/stop` | arrête `gds-server` et `sshd` |

L'état courant (PID du service, état de chaque programme) est lisible par
`GET /api/gds/admin/service`.

Ce qui se passe, dans l'ordre :

1. le service **vérifie d'abord** que le superviseur interne répond
   (`supervisorctl status` sur le socket Unix, `/run/supervisor.sock`) ; la route
   s'arrête en erreur si ce n'est pas le cas — jamais de faux « c'est fait » ;
2. il **répond à Pilot** (l'écran affiche « redémarrage demandé ») ;
3. quelques centièmes de seconde plus tard (`GDS_SERVICE_ACTION_DELAY_MS`,
   défaut `750`), un processus détaché exécute l'ordre auprès du superviseur :
   `supervisorctl restart gds-server sshd` ou `… stop gds-server sshd`.

Le délai est **nécessaire** : le processus qui répond à la requête est celui qui
va être coupé, donc l'ordre doit partir après la réponse. L'écran suit ensuite
l'état réel (il interroge la route de santé et `GET …/service`) : un redémarrage
est constaté par un **nouveau PID**, un arrêt par l'absence de réponse.

### Après un arrêt

Un arrêt est un **état stable** : `autorestart` ne redémarre pas un processus
arrêté volontairement. Restaurer le service (le conteneur, lui, tourne
toujours) :

```powershell
docker compose restart gds                    # le plus simple
docker exec pilot-gds supervisorctl -c /etc/gds/supervisord.conf start gds-server sshd
```

`sshd` arrêté signifie que les clones / `fetch` / `push` des projets échouent
(les synchronisations de suivi, elles, continuent : elles passent par la base,
restée en marche). `gds-server` arrêté signifie que les écrans de
l'administration ne répondent plus — ils se rouvrent au redémarrage.

### Trace des actions

Chaque action **acceptée** écrit une entrée dans le journal d'audit du service
(`service_restart` / `service_stop`, avec le demandeur et son adresse) ; une
action **refusée** (superviseur injoignable) y écrit aussi, avec `ok = false`.
Le journal est **persistant** (`GDS_AUDIT_FILE`, défaut
`/var/log/supervisor/web_audit.jsonl`, sur le volume `pilot-gds_supervisor`) :
la trace d'un redémarrage survit donc au redémarrage lui-même, et à la
recréation du conteneur. Ces actions apparaissent dans l'onglet
« 🔐 Journal » de l'écran GDS de Pilot.

---

## 5. Accès depuis un autre appareil (réseau privé Tailscale)

Pour joindre le serveur depuis un autre appareil **sans jamais l'exposer au
grand public**, l'accès passe par le **réseau privé Tailscale** :

| Élément | Port poste | Comment y accéder à distance |
|---|---|---|
| Interface d'administration (`/api/gds/*`) | `8080` | `tailscale serve` (HTTPS sur le tailnet) → `https://<machine>.ts.net/` |
| Base PostgreSQL | `5432` | réseau privé uniquement (IP Tailscale du poste) |
| Dépôts git (SSH) | `2222` | réseau privé uniquement (IP Tailscale du poste) |

Aucune commande réseau n'est exécutée par ce dossier : **c'est le propriétaire
qui les lance** (elles modifient la configuration réseau du poste).

> **Procédure complète, pas à pas, commandes exactes** (installation Windows,
> `tailscale ip -4`, `tailscale serve`, vérifications, dépannage) :
> [`docs/gds-server-setup.md`](../docs/gds-server-setup.md).

En résumé, du côté du poste serveur :

1. régler le profil L2.9 dans `.env` (§2bis du modèle) :
   `GDS_HTTP_BIND_ADDR=127.0.0.1`, `GDS_DB_BIND_ADDR=<IP Tailscale>`,
   `GDS_SSH_BIND_ADDR=<IP Tailscale>` ;
2. `docker compose up -d` ;
3. `tailscale serve --bg --https=443 http://127.0.0.1:8080` (443 libre) — ou
   `--https=8443` si Pilot utilise déjà 443 pour son accès web distant ;
4. vérifier depuis un appareil du tailnet :
   `curl https://<machine>.ts.net/api/gds/health`.

`tailscale funnel` (exposition au **grand public**) est **interdit** ici.

---

## 6. ⚠️ Sécurité — ce qui est INTERDIT

Les trois ports sont faits pour **le poste**, **le réseau local** et le
**réseau privé Tailscale** :

- ne **JAMAIS** rediriger ces ports depuis une box ou un routeur (NAT) ;
- ne **JAMAIS** les publier par un tunnel ou un service public (Cloudflare
  Tunnel, ngrok, Funnel sans tailnet, adresse IP publique…) ;
- ne **JAMAIS** remplacer `GDS_BIND_ADDR` par une adresse publique.

`5432` (base) et `2222` (dépôts git) sont publiés **en clair**, sans TLS : joints
depuis Internet, ils exposent la base de suivi et l'historique git. Le conteneur
ne fait aucun certificat — le TLS, quand il y en a, est terminé en amont
(Tailscale Serve, ou proxy inverse de l'hôte).

Le fonctionnement interne est par ailleurs fermé par construction : sshd
n'accepte que le compte `git`, **par clef uniquement**, et `authorized_keys` est
régénéré depuis la base ; le socket du moteur Docker n'est jamais monté dans le
conteneur ; aucun mot de passe n'est écrit dans le fichier de composition ni
dans l'image.

L'accès direct à la base est ouvert **par mot de passe** aux réseaux de
`GDS_PG_ALLOWED_NETWORKS` (méthode `scram-sha-256`, jamais `trust`) : ne jamais
y mettre une plage plus large que ce que la publication autorise déjà (poste,
LAN, réseau privé Tailscale).

Pour un poste qui ne doit être joignable que par lui-même, mettre
`GDS_BIND_ADDR=127.0.0.1` dans `.env`.
