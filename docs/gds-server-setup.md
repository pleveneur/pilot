# Installer le serveur GDS de Pilot et le rendre joignable par le réseau privé

> Document d'installation et d'exploitation — décrit, **pas à pas**, comment
> mettre en route le **serveur GDS** de Pilot (le conteneur tout-en-un de
> `gds-server/`) sur un poste **Windows**, puis comment le rendre joignable
> **depuis un autre appareil** du **réseau privé Tailscale**, **sans jamais
> l'exposer au grand public**.
>
> **Statut : 🟢 Implémenté** — micro-tâche **L2.9** du plan de refonte GDS
> (`plan_gds.md`, LOT 2), **complété par L7.3**. C'est **le** document
> d'installation retenu : il remplace `docs/gds-linux-setup.md` (préparation
> manuelle d'un serveur Linux), supprimé car devenu inutile avec le conteneur
> tout-en-un. Voir aussi `spec_gds.md` (spécification fonctionnelle),
> `gds-server/README.md` (référence rapide du dossier serveur) et
> `docs/gds-guide-mise-en-place.md` (**parcours de retest complet** serveur →
> utilisateur : liste de contrôle à cocher, du poste vierge à l'usage à
> plusieurs, avec les commandes exactes).
>
> ⚠️ **Ce document ne s'exécute pas tout seul — les manipulations du poste
> sont À LA CHARGE DU PROPRIÉTAIRE.** Les commandes `docker …` (construction,
> démarrage, inspection du conteneur) agissent sur le poste ; les commandes
> `tailscale …` modifient sa configuration réseau. Toutes sont **à lancer par le
> propriétaire**, y compris l'installation de Docker Desktop et de Tailscale
> (§1). Pilot n'exécute **jamais** ces réglages à votre place.

---

## 0. Ce que fait cette procédure, ce qu'elle ne fait pas

| Étape | Qui s'en charge |
|---|---|
| Construire et démarrer le conteneur | vous (une commande `docker compose`) |
| Créer la base, les tables, les dépôts, les clefs d'hôte | le conteneur, automatiquement |
| Créer le compte administrateur | le conteneur, automatiquement (variables `GDS_ADMIN_EMAIL` + `GDS_ADMIN_PASSWORD` dans `.env`), **ou** vous (route d'initialisation à usage unique) — §2.4 |
| Exposer l'interface d'administration sur le réseau privé | vous (`tailscale serve`) |
| Ouvrir la base et les dépôts au réseau privé | vous (réglages d'adresse d'écoute) |
| Rediriger des ports depuis la box / le routeur | **jamais** (interdit, cf. §4) |
| Exposer quoi que ce soit au grand public | **jamais** (interdit, cf. §4) |

---

## 1. Prérequis (à réunir une seule fois)

Sur le **poste qui héberge le serveur** :

- **Docker Desktop** installé et démarré (moteur Linux / WSL2) — vérification :
  `docker compose version` doit afficher une version.
- **Tailscale** installé et **connecté** — vérification :
  `tailscale status` doit lister vos appareils (et non un message
  « Logged out »).
- Le dépôt de Pilot présent sur le poste (le dossier `gds-server/` en fait
  partie).
- Une **adresse d'écoute** choisie pour la base et les dépôts : on prendra
  l'**adresse Tailscale du poste** (§3.2).

Sur l'**autre appareil** (celui depuis lequel vous voulez accéder au serveur) :

- **Tailscale** installé et connecté au **même réseau privé** (même compte /
  même tailnet).
- Un client pour ce que vous voulez faire : navigateur (interface
  d'administration), `git` (dépôts), un client PostgreSQL (base).

> Les deux appareils doivent être dans le **même tailnet**. Un appareil sans
> Tailscale ne verra **pas** le serveur : c'est voulu (§4).

---

## 2. Première mise en route sur Windows

Toutes les commandes se lancent dans **PowerShell**, depuis le dossier
`gds-server/` du dépôt. Remplacez le chemin d'exemple par le vôtre.

### 2.1 Copier le modèle de variables

Le **modèle** `.env.example` est versionné ; le **fichier réel** `.env` ne
l'est **jamais** (il est ignoré par git) et c'est lui qui portera le secret.

```powershell
cd G:\IA_PL\pilot\gds-server
Copy-Item .env.example .env      # cmd.exe : copy .env.example .env
```

### 2.2 Remplir le seul secret obligatoire

Ouvrez `.env` dans un éditeur de texte et renseignez **une seule** ligne
obligatoire :

```dotenv
POSTGRES_PASSWORD=<un mot de passe long et unique, 20 caractères et plus>
```

> Les textes entre chevrons `<…>` sont des **espaces à remplacer** : remplacez-les
> par votre valeur, **chevrons compris** (les chevrons ne font pas partie de la
> valeur).

- Ce mot de passe sert **à la fois** au conteneur (pour préparer la base) **et**
  au poste, dans l'écran **🌐 GDS** de Pilot (pour les synchronisations
  directes).
- Il n'a **pas** besoin d'être échappé (guillemets inclus) : laissez la valeur
  **sans guillemets**, ou entourez-la de guillemets si elle contient un espace.
- **Il n'apparaît jamais en clair dans le dépôt** : il n'est écrit que dans
  `.env`, un fichier local jamais versionné et exclu de l'image (vérifié, cf.
  `gds-server/README.md`).

> Toutes les autres valeurs de `.env` ont un défaut sûr. Un premier démarrage
> sur le poste ne demande **rien d'autre**.

### 2.3 Construire et démarrer

La **première** construction de l'image prend quelques minutes ; les suivantes,
quelques secondes.

```powershell
docker compose up -d --build
docker compose ps                  # attendre l'état « healthy »
```

`docker compose ps` doit finir par afficher un service **healthy**. Tant qu'il
affiche `starting`, la base est encore en train de s'initialiser : patientez
(le contrôle de santé laisse jusqu'à deux minutes au premier démarrage).

### 2.4 Créer le compte administrateur

Au tout premier démarrage, **aucun administrateur** n'existe. Vous avez deux
chemins, au choix :

- **Chemin normal** (aucun secret écrit sur disque) : appelez **une seule fois**
  la route d'initialisation, qui crée le compte administrateur. C'est un **POST
  JSON** (ce n'est pas une page à ouvrir dans un navigateur) :

  ```powershell
  # Le corps est écrit dans un fichier temporaire : sous Windows PowerShell,
  # les guillemets internes d'un argument passé à `curl.exe` sont supprimés
  # (le serveur répondrait alors « Failed to parse the request body as JSON »).
  Set-Content -Path "$env:TEMP\gds-setup.json" -NoNewline -Encoding ascii `
    -Value '{"email":"vous@exemple.com","password":"<mot de passe admin>"}'
  curl.exe -X POST http://127.0.0.1:8080/api/gds/setup -H "Content-Type: application/json" --data-binary "@$env:TEMP\gds-setup.json"
  # ⚠️ Ce fichier contient le mot de passe en clair : le supprimer aussitôt.
  Remove-Item "$env:TEMP\gds-setup.json"
  ```

  Attendu : `{"ok":true,"email":"…"}`. Un second appel répond ensuite
  `409` (« Un administrateur existe déjà ») : la route ne sert qu'**une fois**.
  (`curl.exe` : sous PowerShell, `curl` est un alias ; `curl.exe` force le vrai
  outil. Le mot de passe n'est ni journalisé ni renvoyé.)
- **Démarrage non interactif** : renseignez **les deux** variables
  `GDS_ADMIN_EMAIL` **et** `GDS_ADMIN_PASSWORD` dans `.env` **avant** le premier
  démarrage ; le service GDS crée alors lui-même le compte administrateur au
  démarrage. C'est le **seul** déclencheur (les deux variables non vides sont
  nécessaires). Si un administrateur existe déjà, rien n'est écrasé et le
  journal l'indique ; si **une seule** des deux variables est renseignée, le
  service avertit et continue sans rien créer ; un échec de création est
  journalisé **sans jamais empêcher le service de démarrer**. Le mot de passe
  n'est jamais journalisé ni renvoyé. Un mot de passe d'administration n'est
  **jamais** généré : c'est vous qui le choisissez.

> **Le mot de passe administrateur n'est PAS un mot de passe PostgreSQL.** Le
> rôle de la base (`pilot`) est déjà préparé par le conteneur ; ce mot de passe
> ne concerne que le **premier compte GDS** (rôle `admin`) des tables de suivi.
> Il n'est jamais affiché ni renvoyé par le serveur.
>
> Les mots de passe saisis dans l'écran **🌐 GDS** de Pilot restent **sur le
> poste** (`~/.pilot/gds_secrets.json`, droits restreints) : ils ne sont jamais
> écrits dans `.pilot/gds.json`, qui ne porte que la configuration.

### 2.5 Vérifier depuis le poste

```powershell
curl http://127.0.0.1:8080/api/gds/health
```

Attendu : une réponse JSON courte du type
`{"version":…,"migration_version":…,"users":…,"projects":…,"git_repos":…}`.

Vérification de la base (le détail est dans `gds-server/README.md` §3) :

```powershell
docker exec pilot-gds sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "select 1"'
```

La base vit **dans le conteneur** : cette commande lit `POSTGRES_PASSWORD`
**dans** le conteneur (rien à recopier, aucun secret dans l'historique du
terminal) et vise l'adresse **interne** `127.0.0.1`. Une commande passant par le
port publié du poste (`host.docker.internal`) peut aboutir sur une **autre** base
si un PostgreSQL natif occupe déjà `5432` (symptôme : mot de passe refusé alors
qu'il est juste — voir §5.1).

Attendu : une ligne `1`.

---

## 3. Rendre le serveur joignable depuis un autre appareil (réseau privé)

**Ordre des opérations** : trouver l'adresse Tailscale (§3.2) → régler les
adresses d'écoute (§3.3) → publier l'interface d'administration sur le réseau
privé (§3.4) → vérifier depuis l'autre appareil (§3.5) → laisser le service
créer le dépôt du projet (§3.6).

### 3.1 Vérifier que Tailscale est connecté

```powershell
tailscale status
```

Vous devez voir la liste des appareils de votre réseau privé (dont ce poste).
Si Tailscale affiche « Logged out », connectez-vous d'abord (application
Tailscale → « Log in »).

### 3.2 Trouver l'adresse Tailscale du poste

```powershell
tailscale ip -4
```

Elle ressemble à `100.x.y.z`. **C'est cette adresse** qui sera utilisée pour la
base et les dépôts : elle n'est joignable que par le réseau privé, jamais
depuis Internet.

### 3.3 Régler les adresses d'écoute dans `.env`

Éditez `.env` et dé-commentez/renseignez le bloc **§2bis** du modèle, en
remplaçant `100.x.y.z` par l'adresse trouvée en §3.2 :

```dotenv
GDS_HTTP_BIND_ADDR=127.0.0.1      # interface d'administration : poste uniquement
GDS_DB_BIND_ADDR=100.x.y.z        # base : réseau privé uniquement
GDS_SSH_BIND_ADDR=100.x.y.z       # dépôts git : réseau privé uniquement
```

Puis appliquez :

```powershell
docker compose up -d
docker compose ps
```

`docker compose ps` doit maintenant montrer, sur la ligne des ports, quelque
chose comme :

```
127.0.0.1:8080->8080/tcp, 100.x.y.z:2222->22/tcp, 100.x.y.z:5432->5432/tcp
```

> **Pourquoi ces trois valeurs ?**
> - `8080` sur `127.0.0.1` : l'interface d'administration n'écoute que sur le
>   poste lui-même ; l'accès distant passera par Tailscale (§3.4), jamais
>   directement.
> - `5432` et `2222` sur l'adresse Tailscale : la base et les dépôts ne sont
>   joignables **que** par le réseau privé.
> - Ce réglage est **facultatif** : sans lui, les trois ports retombent sur
>   `GDS_BIND_ADDR` (comportement L2.8). Le profil ci-dessus est celui qui « ne
>   publie que le nécessaire ».
>
> **Conséquence à connaître** : puisque la base n'écoute plus que sur
> l'adresse Tailscale, le poste lui-même s'y connecte **par cette adresse**
> (et non plus par `127.0.0.1`). Dans l'écran **🌐 GDS** de Pilot, saisissez
> **`100.x.y.z`** (ou le nom MagicDNS du poste) comme **Hôte PostgreSQL**.
>
> Dans ce même écran, renseignez aussi **Racine des dépôts côté serveur** =
> **`/srv/git/repos`** : c'est le point de montage du volume des dépôts
> (voir le tableau des volumes du `gds-server/README.md` §2). Sans cette
> valeur, « Ajouter ce projet au GDS » s'arrête sur « Racine des dépôts serveur
> non renseignée ».

### 3.4 Publier l'interface d'administration sur le réseau privé

C'est ici que l'**automatisation Tailscale de Pilot** est réutilisée, sans être
modifiée : Pilot configure `tailscale serve` avec exactement la forme
`serve --bg --https=<port> http://127.0.0.1:<port-local>`
(`src-tauri/src/tailscale.rs`). Lancez la même commande à la main pour le
serveur GDS :

```powershell
# Cas normal (le port 443 de Tailscale est libre) :
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

- `--https=443` : Tailscale présente le service en **HTTPS** sur le réseau
  privé, et gère lui-même le certificat (le conteneur, lui, ne fait aucun
  chiffrement).
- `--bg` : le proxy tourne en arrière-plan et survit à la fermeture du terminal.
- `http://127.0.0.1:8080` : la cible, qui correspond à `GDS_HTTP_BIND_ADDR` du
  §3.3.

Vérifiez ce qui a été publié :

```powershell
tailscale serve status
```

Notez l'URL affichée, du type `https://<machine>.ts.net/` (le nom MagicDNS de
votre poste).

> **Si Pilot utilise déjà le port 443** (cas d'un **accès web distant** activé
> dans les Paramètres de Pilot : son automatisation pointe alors 443 vers le
> port web de Pilot), choisissez un autre port HTTPS pour le serveur GDS :
>
> ```powershell
> tailscale serve --bg --https=8443 http://127.0.0.1:8080
> ```
>
> L'URL devient alors `https://<machine>.ts.net:8443/`. Ne remplacez **pas**
> la configuration de Pilot : les deux services vivent sur des ports HTTPS
> différents.

> ⚠️ **`tailscale serve` (réseau privé) est permis. `tailscale funnel` (grand
> public) est INTERDIT** : Funnel expose le service à toute personne
> connaissant l'adresse, ce qui va à l'encontre de l'objectif (§4).

### 3.5 Vérifier depuis l'autre appareil

Depuis l'**autre appareil** (connecté au même tailnet) :

```powershell
# 1) l'interface d'administration répond (remplacez le port si vous avez utilisé 8443)
curl https://<machine>.ts.net/api/gds/health

# 2) les dépôts git répondent (port 2222, chemin ABSOLU côté serveur)
git ls-remote ssh://git@100.x.y.z:2222/srv/git/repos/mon-projet.git

# 3) la base répond (port 5432, adresse Tailscale du poste)
psql -h 100.x.y.z -p 5432 -U pilot -d pilot_gds -c "select 1"
```

Attendus : le JSON de santé pour (1), la liste des références du dépôt pour
(2), une ligne `1` pour (3). Si le dépôt **n'existe pas encore**, l'erreur est
attendue ; l'essentiel est que la **connexion** SSH aboutisse (pas de
« connection timed out »). Le chemin de l'URL git est **absolu** (sémantique
`ssh://`) et suit la racine des dépôts : `/<racine>/<projet>.git`.

> Si le dépôt n'a pas encore été créé côté serveur, voir §3.6 : c'est le
> conteneur qui s'en charge, sans aucune commande `git init`.

---

### 3.6 Le dépôt d'un projet se crée tout seul

Il n'y a **aucun** `git init --bare` à lancer (l'ancien document le demandait
pour un serveur préparé à la main). Le conteneur **matérialise** lui-même les
dépôts bare annoncés en base : un cycle de maintenance du service — premier
passage au démarrage, puis toutes les **30 secondes** — crée le dépôt manquant
sous `/srv/git/repos/<projet>.git` et régénère `authorized_keys` depuis la base.
C'est ce qui permet d'enregistrer une clef ou d'ajouter un projet **sans
redémarrer** le conteneur.

Après « Ajouter ce projet au GDS » dans Pilot :

1. le projet est écrit **en base** (immédiat) ;
2. le dépôt bare apparaît **dans les 30 secondes** ;
3. le `push` initial part **tout de suite** : s'il tombe dans cette petite
   fenêtre, il échoue — **relancez simplement « Ajouter ce projet au GDS »**
   (l'opération est idempotente).

Vérifier côté conteneur :

```powershell
# le motif « bare » évite tout problème d'accentuation dans la console
docker compose logs gds | Select-String "bare"
docker exec pilot-gds ls /srv/git/repos
```

Attendu : la ligne `gds-server : dépôts bare créés : <projet>.git` dans les
journaux, puis le dossier `<projet>.git` dans le conteneur.

Le dépôt créé **appartient au compte `git`**, celui qui reçoit les poussées par
SSH : c'est indispensable, sinon git refuse de servir le dépôt (« detected
dubious ownership ») et **tout `push` échoue**. Le service s'en charge à chaque
création, et **reprend au démarrage** les dépôts d'une installation antérieure
dont le propriétaire ne serait pas `git`.

---

## 4. Ce qui n'est PAS exposé au grand public, et pourquoi

| Élément | Port | Sur le poste | Sur le réseau privé | Sur Internet |
|---|---|---|---|---|
| Interface d'administration | `8080` | ✅ (`127.0.0.1`) | ✅ via `tailscale serve` | ❌ |
| Base PostgreSQL | `5432` | ✅ (adresse Tailscale) | ✅ (adresse Tailscale) | ❌ |
| Dépôts git (SSH) | `2222` | ✅ (adresse Tailscale) | ✅ (adresse Tailscale) | ❌ |

**Pourquoi la base et les dépôts ne sont jamais publics** : la base et l'accès
aux dépôts sont publiés **en clair**, sans chiffrement propre. Les exposer à
Internet reviendrait à publier le suivi des projets et l'historique git. Le
réseau privé Tailscale apporte de son côté un **chiffrement de bout en bout
(WireGuard)** et une **barrière d'identité** (seuls vos appareils entrent) : la
base et les dépôts ne sont donc joignables **que** par là.

**Pourquoi ne jamais rediriger depuis la box / le routeur** : une redirection
NAT rendrait ces ports visibles depuis Internet **sans** le chiffrement ni la
barrière Tailscale. C'est la seule règle à ne jamais enfreindre.

**Comment vérifier que tout va bien comme prévu** :

```powershell
# a) sur le poste : les adresses d'écoute réellement publiées
docker compose ps
#    attendu : 127.0.0.1:8080->8080/tcp, 100.x.y.z:2222->22/tcp, 100.x.y.z:5432->5432/tcp

# b) sur le poste : rien n'est publié sur une adresse publique
netstat -ano | findstr ":8080 :2222 :5432"
#    attendu : les lignes des ports 2222/5432 portent l'adresse 100.x.y.z (privée),
#    jamais l'adresse de la box ; la ligne 8080 porte 127.0.0.1

# c) sur le poste : la configuration Tailscale publiée
tailscale serve status
```

Et, depuis l'autre appareil : les trois commandes du §3.5 répondent.

---

## 5. Pièges déjà rencontrés aux étapes précédentes

### 5.1 Le port de base `5432` est souvent déjà occupé sur le poste

C'est le piège le plus fréquent : un **PostgreSQL natif** (installé sur le
poste par un autre logiciel : outil de développement, ancienne installation,
serveur d'une autre application) écoute déjà sur `127.0.0.1:5432`. Windows
route alors `127.0.0.1:5432` vers ce service natif au
lieu du conteneur, et le poste parle à la **mauvaise** base — le symptôme
typique est `password authentication failed for user "pilot"` alors que le mot
de passe est **juste**. (Pilot lui-même ne provisionne **aucune** base
PostgreSQL locale : le piège vient d'un PostgreSQL déjà présent sur le poste.)

Détecter, puis décaler **seulement le port publié** (le port interne du
conteneur ne change pas) :

```powershell
netstat -ano | findstr :5432      # Windows
ss -ltnp | grep :5432             # Linux / macOS
```

Version la plus parlante sous Windows (elle **nomme** le programme qui tient le
port) : la commande `Get-NetTCPConnection -LocalPort 5432 -State Listen`
montrée — avec la marche à suivre côté **Pilot** (redéclarer le serveur dans les
deux écrans GDS) — dans l'**encadré en tête** de
`docs/gds-guide-mise-en-place.md`.

```dotenv
GDS_HOST_DB_PORT=55432            # dans .env, puis :
```

```powershell
docker compose up -d
```

> **Bonne nouvelle avec le profil L2.9 (§3.3)** : en écoutant la base sur
> l'**adresse Tailscale** (`GDS_DB_BIND_ADDR=100.x.y.z`) au lieu de
> `0.0.0.0`, le conflit avec le PostgreSQL natif sur `127.0.0.1:5432`
> disparaît : le conteneur ne se bat plus pour la même adresse.

### 5.2 Un script livré avec des fins de ligne Windows ne démarrerait pas

`gds-server/entrypoint.sh` est copié **dans** l'image et exécuté par
`/bin/sh`. Sur un poste Windows, un fichier écrit avec des fins de ligne
**CRLF** rend le shebang illisible (`#!/bin/sh\r`) et le conteneur ne démarre
plus, avec un message incompréhensible.

- **Ne réécrivez jamais** `entrypoint.sh` avec un outil qui impose les fins de
  ligne Windows (Notepad en mode par défaut, certains exports).
- Le dépôt **impose déjà** le **LF** pour les scripts d'amorçage et les recettes
  (`.gitattributes` : `*.sh text eol=lf`, `Dockerfile text eol=lf`) : un
  `git checkout` / `git stash` sur ce poste ne peut donc pas les abîmer. Si
  vous modifiez le fichier à la main, vérifiez que votre éditeur conserve le
  **LF**.

### 5.3 Le port `443` de Tailscale peut déjà appartenir à Pilot

Voir l'encadré du §3.4 : si l'**accès web distant** de Pilot est activé, il
utilise déjà 443. Publiez alors le serveur GDS sur `--https=8443` et non 443.

### 5.4 L'accès direct à la base est ouvert par mot de passe

Le conteneur ouvre l'accès direct à la base **par mot de passe**
(`scram-sha-256`, jamais `trust`) aux réseaux listés dans
`GDS_PG_ALLOWED_NETWORKS` (défaut `0.0.0.0/0` : « tout ce qui atteint le port
publié »). La restriction **réelle** reste la **publication** des ports
(`GDS_DB_BIND_ADDR`, §3.3) : ne l'élargissez jamais au-delà du réseau privé.
Sous Linux, où PostgreSQL voit l'adresse réelle du client, vous pouvez
restreindre davantage, ex. `GDS_PG_ALLOWED_NETWORKS=100.64.0.0/10`
(la plage des adresses Tailscale).

---

## 6. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| `docker compose ps` reste `starting` | première initialisation de la base | patienter jusqu'à deux minutes ; `docker compose logs gds` |
| Le service refuse de démarrer, « mot de passe de la base … non défini » | `POSTGRES_PASSWORD` vide dans `.env` | remplir `.env` (§2.2) puis `docker compose up -d` |
| `password authentication failed for user "pilot"` | collision de port `5432` avec un PostgreSQL natif | §5.1 |
| `curl https://<machine>.ts.net/…` ne répond pas | `tailscale serve` non configuré, ou mauvais HTTPS | `tailscale serve status`, refaire §3.4 |
| L'URL `https://<machine>.ts.net/…` affiche le mauvais service | le port 443 sert déjà l'accès web de Pilot | utiliser `--https=8443` (§3.4) |
| Depuis l'autre appareil : « connection timed out » sur `5432`/`2222` | appareil hors tailnet, ou ports restés sur `GDS_BIND_ADDR=0.0.0.0` | vérifier `tailscale status` sur les deux appareils ; appliquer §3.3 |
| `Permission denied (publickey)` en SSH | clef du poste non enregistrée dans le GDS | enregistrer la clef publique via l'écran GDS de Pilot |
| `push` refusé : « detected dubious ownership in repository » | le dépôt bare appartient à un compte autre que `git` (installation antérieure) | `docker compose restart gds` : le démarrage reprend le dépôt au profit de `git` (vérifier ensuite `docker exec pilot-gds ls -l /srv/git/repos`) |
| Le `push` initial échoue juste après l'ajout du projet | dépôt bare pas encore matérialisé (fenêtre < 30 s) | patienter, puis relancer « Ajouter ce projet au GDS » (§3.6) |
| `Racine des dépôts serveur non renseignée` | champ vide dans l'écran GDS de Pilot | renseigner `/srv/git/repos` (§3.3) |
| Port SSH ignoré / erreur git étrange sur un poste Windows | variante SSH de git indéfinie | définir `GIT_SSH_VARIANT=ssh` dans l'environnement du poste, puis relancer Pilot |
| Le conteneur ne démarre plus après une modification à la main | fins de ligne CRLF dans `entrypoint.sh` | §5.2 |

---

## 7. Arrêter ou retirer l'accès distant

Rien n'est définitif : ces commandes sont **réversibles**.

```powershell
# Retirer la publication HTTPS (le serveur GDS continue de tourner) :
tailscale serve reset

# Arrêter le serveur (les données, dépôts et clefs sont CONSERVÉS) :
docker compose stop
```

> ⚠️ `tailscale serve reset` retire **toutes** les publications Tailscale du
> poste — y compris l'**accès web distant de Pilot** s'il est activé. Après ce
> reset, réactivez-le depuis les Paramètres de Pilot (accès web distant) pour
> que son automatisation republie son service.

Pour revenir à une installation **strictement locale** (aucun accès par le
réseau privé), remettez `GDS_BIND_ADDR=127.0.0.1` et commentez le bloc §2bis de
`.env`, puis `docker compose up -d`.

---

## 8. Document retenu et suites

- **Parcours de retest complet (fait)** : `docs/gds-guide-mise-en-place.md` est
  la **liste de contrôle à cocher** du GDS, du poste vierge à l'usage à
  plusieurs (partie 0 « à avoir sous la main », partie 1 serveur, partie 2
  usage, partie 3 à plusieurs, partie 4 « modifier le serveur », partie 5 « tout
  refaire à la main », partie 6 gestes dangereux, partie 7 prouvé/à vérifier).
  Il **reprend volontairement les commandes exactes** de ce document : il doit
  être utilisable seul, sans aller-retour. Ce document-ci **reste la référence
  technique d'installation** (variantes, pièges, dépannage détaillé).
- **Consolidation documentaire (L7.3, faite)** : ce document est **le** mode
  d'emploi d'installation du serveur GDS. `docs/gds-linux-setup.md` a été
  **supprimé** : il décrivait la préparation manuelle d'un serveur Linux
  (compte `git`, `authorized_keys`, PostgreSQL, `git init --bare`), devenue
  inutile avec le conteneur tout-en-un.
- **Arrêter / redémarrer le service depuis Pilot** (sans toucher au conteneur) :
  micro-tâche **L2.10**, **implémentée** — voir `gds-server/README.md` §4bis.
- **Tests de bout en bout en conteneur (L7.6, fait)** : `gds-server/tests/e2e.sh`,
  lancé avec l'appui du banc **jetable** `gds-server/docker-compose.test.yml`
  (projet Compose `pilot-gds-e2e`, image `pilot-gds:e2e-local`, ports
  `18080`/`12222`/`55432`, aucun socket Docker monté, `.env` de production jamais
  lu). Sur un volume vierge, le script rejoue le parcours complet — compte
  administrateur, connexion, création d'un développeur, attribution d'un projet,
  enregistrement d'une clef SSH, `push` réel en SSH, journal d'audit,
  redémarrage du service, état de santé — puis **supprime tout** (conteneur,
  volumes, image) et vérifie qu'aucun élément préexistant n'a bougé.
  Lancement : `bash gds-server/tests/e2e.sh` (ajouter `E2E_REBUILD=1` pour
  reconstruire l'image de test).
- **Protocole de test de l'ancien document** : **non repris** — il portait sur un
  serveur préparé à la main et sur des routes de verrou qui n'existent plus.
- **Transmission à un tiers (fait)** : §10 — transmettre **l'image seule**
  (extraction/rechargement d'un fichier), ne jamais joindre `.env`, volumes ni
  sauvegardes, ce que le destinataire configure lui-même, les limites à annoncer
  (une seule architecture, ports joignables depuis le poste de travail) et le cas
  du **serveur Linux distant** (côté machine, et côté poste qui prépare la base
  à distance).
- **Rechargement sûr et répétable (L7.9, fait)** : `npm run gds:reload` (script
  `scripts/gds-reload.js`, Node, multiplateforme) enchaîne prérequis, sauvegarde
  datée, reconstruction de l'image, recréation du conteneur **sans toucher aux
  volumes**, attente de la santé et compte rendu ; `npm run gds:image` ne fait
  que la reconstruction. Détail et équivalent manuel : §9.5. Test léger sans
  Docker : `scripts/gds-reload.test.js`.

---

## 9. Modifier le serveur : ce qui change pour le conteneur

> Réponse courte : une modification du serveur demande **toujours** une
> **reconstruction de l'image** (`--build`) **et** une **recréation du
> conteneur** (`up -d`) ; les **données survivent**, parce qu'elles vivent dans
> des **volumes nommés** séparés du conteneur. **Seul `docker compose down -v`
> les détruit.**

### 9.1 Table de décision

| Ce que vous modifiez | Reconstruire l'image ? | Recréer le conteneur ? | Comptes / projets / dépôts conservés ? |
|---|---|---|---|
| **Code** du serveur (`gds-server/`, `gds-core/`) | **Oui** (`docker compose up -d --build`) | **Oui** | **Oui** |
| `Dockerfile`, `entrypoint.sh`, `sshd_config`, `supervisord.conf` | **Oui** | **Oui** | **Oui** |
| **`.env` seulement** | Non | **Oui** (`.env` décrit le conteneur) | **Oui** |
| **`docker-compose.yml` seulement** | Non | **Oui** | **Oui** |
| Rien : arrêter / redémarrer le **service** depuis Pilot (`gds-server/README.md` §4bis) | Non | **Non** | **Oui** |
| `docker compose stop` puis `start` | Non | Non (même conteneur) | **Oui** |
| `docker compose down` puis `up -d` | Non | **Oui** (supprimé puis recréé) | **Oui** |
| `docker compose down -v` | Non | Oui | ❌ **NON : tout est effacé** |

### 9.2 Preuves, fichier par fichier

| Preuve | Fichier | Ce qu'il montre |
|---|---|---|
| L'image est **locale** | `docker-compose.yml` : `image: pilot-gds:local` + bloc `build:` (aucun registre) | une modification du code **ne peut pas** arriver par `docker compose pull` : il faut **reconstruire** |
| Le conteneur est **recréé** au prochain `up -d` | `docker-compose.yml` : `env_file: - .env` | une nouvelle configuration ne s'applique pas « à chaud » |
| L'état vit **hors** du conteneur | `docker-compose.yml` : `volumes:` (`pgdata`, `repos`, `ssh-host-keys`, `supervisor`) + déclaration finale des 4 volumes nommés ; `Dockerfile` : `VOLUME ["/var/lib/postgresql/data", "/srv/git/repos", "/etc/ssh/host_keys"]` | reconstruire ou recréer **ne touche pas** aux volumes |
| Les données ne sont **jamais écrasées** au démarrage | `entrypoint.sh` : `initdb` **seulement si le datadir est vide** — sinon l'instance « est **CONSERVÉE tel quel** (aucune réinitialisation, les données du volume ne sont jamais effacées) » | démarrer/redémarrer **ne réinitialise pas** la base |
| Le bootstrap est **idempotent** | `entrypoint.sh` : `gds-server --init-db` (rôle + base créés s'ils sont absents, puis migrations embarquées) et `gds-server --init-ssh` (idempotent) | relancer mille fois donne le même état |
| Les **migrations** sont rejouées à chaque démarrage | `gds-server/src/main.rs` : « migrations appliquées jusqu'à la version … » | une nouvelle version du serveur met le schéma à jour **toute seule** |
| Les **clefs d'hôte SSH** sont stables | `entrypoint.sh` : clefs « jamais écrasées, donc empreinte stable après reconstruction » | après reconstruction, les postes ne ré-autorisent pas le serveur |
| L'**administrateur** n'est jamais écrasé | `gds-server/src/main.rs` : décision « déjà initialisé » → « GDS_ADMIN_EMAIL/GDS_ADMIN_PASSWORD ignorées » | redémarrer avec les variables ne casse **pas** le compte existant |
| L'**arrêt est propre** avant recréation | `docker-compose.yml` : `restart: unless-stopped`, `stop_grace_period: 70s` ; `supervisord.conf` : PostgreSQL arrêté en mode « fast » | le moteur laisse jusqu'à 70 s pour écrire avant de tuer |

### 9.3 Ce qui reste à vérifier en conditions réelles

- **La durée exacte de l'interruption** : les fichiers donnent un **plafond**
  (`stop_grace_period: 70s`) et un **délai de santé**
  (`healthcheck.start_period: 120s`, `interval: 20s`), **pas** la durée réelle.
  À chronométrer sur votre poste (`Measure-Command { docker compose up -d }`).
- **Le temps de reconstruction** : « quelques minutes » la première fois,
  « quelques secondes » ensuite — indication d'auteur, pas une mesure.
- **Une montée de version de l'image de base** (PostgreSQL 16) : le volume est
  réutilisé ; ce cas **n'a pas été essayé** ici.

### 9.4 Sauvegarder AVANT toute modification

On sauvegarde les **volumes** (le conteneur ne contient aucune donnée), après un
**arrêt** pour une image cohérente de la base :

```powershell
cd G:\IA_PL\pilot\gds-server
New-Item -ItemType Directory -Force G:\sauvegarde-gds | Out-Null

docker compose stop

docker run --rm -v pilot-gds_pgdata:/data:ro        -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/pgdata.tgz -C /data .
docker run --rm -v pilot-gds_repos:/data:ro         -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/repos.tgz -C /data .
docker run --rm -v pilot-gds_ssh-host-keys:/data:ro -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/ssh-host-keys.tgz -C /data .

Get-ChildItem G:\sauvegarde-gds
docker compose start
```

Attendu : les trois `.tgz` existent et ne sont pas vides ; après `start`,
`/api/gds/health` répond. *(Variante base seule, sans arrêter le service :*
`docker exec pilot-gds pg_dump -U pilot -d pilot_gds -f /tmp/pilot_gds.sql` puis
`docker cp pilot-gds:/tmp/pilot_gds.sql .` — mais elle **ne sauvegarde pas** les
dépôts git.)

### 9.5 La commande automatique (recommandée) — et son équivalent manuel

Depuis la **racine du projet** — un **script Node** : aucun shell Unix requis,
Windows / macOS / Linux identiques :

```bash
npm run gds:reload     # rechargement complet : sauvegarde → image → conteneur → santé
npm run gds:image      # reconstruction de l'IMAGE SEULE (le service n'est pas interrompu)
```

`npm run gds:reload` enchaîne, dans cet **ordre exact** :

| # | Étape automatique | Équivalent à la main |
|---|---|---|
| 0 | contrôle des **prérequis** : `docker`, `docker compose`, `docker-compose.yml`, `.env` | `docker --version` / `docker compose version` |
| 1 | **SAUVEGARDE datée** des trois volumes d'état, après un arrêt propre | §9.4 — les trois `.tgz` dans un dossier daté |
| 2 | **reconstruction** de l'image locale | `cd gds-server` puis `docker compose build` |
| 3 | **recréation** du conteneur, **volumes conservés** | `docker compose up -d` |
| 4 | **attente** de `/api/gds/health` (240 s au plus) | `curl http://127.0.0.1:8080/api/gds/health` |
| 5 | **compte rendu** : étapes, dossier de sauvegarde, service joignable ? | — |

Options : `--backup-dir <chemin>` (défaut `gds-server/backups/<horodatage>`),
`--timeout <secondes>`, `--help`, `--image-only`.

**Ce que la commande ne fait JAMAIS** : supprimer un volume, `down -v`,
`volume rm`, `prune`. Tout argument de ce genre est **refusé**, avec
l'explication du risque. **Si la sauvegarde échoue, la chaîne s'ARRÊTE** : rien
n'est reconstruit ni recréé, les volumes restent intacts. Aucun secret n'est lu
ni affiché (la seule vérification est la **présence** de `gds-server/.env`).
Un test léger (`scripts/gds-reload.test.js`, sans Docker réel) vérifie
l'enchaînement des étapes et la construction des commandes.

### 9.6 La séquence d'interruption minimale

```powershell
docker compose build      # reconstruire PENDANT que le service tourne
docker compose up -d      # basculer : seule interruption réelle
docker compose ps
curl http://127.0.0.1:8080/api/gds/health
```

Un changement de **`.env`** ne demande que la deuxième ligne. Si l'interruption
n'est pas un souci, une seule commande suffit : `docker compose up -d --build`.

### 9.7 Gestes dangereux et réparation

> Aucun des gestes ❌ ci-dessous n'existe dans `npm run gds:reload` (9.5) : le
> script les refuse, y compris s'ils lui sont passés en argument.

| ⚠️ Geste | Effet | Réversible ? |
|---|---|---|
| `docker compose down -v` | supprime les **4 volumes** : base (comptes, suivi), dépôts git, clefs d'hôte, journal du superviseur | ❌ non |
| `docker volume rm pilot-gds_pgdata` (ou `_repos`) | idem, ciblé | ❌ non, sauf sauvegarde (§9.4) |
| `rm -rf /srv/git/repos/<projet>.git` dans le conteneur | historique git du projet perdu | ❌ non |
| changer `POSTGRES_PASSWORD` après le premier démarrage | **n'est pas appliqué** à la base existante (mot de passe fixé à la création du rôle) : le service ne peut plus s'y connecter | ⚠️ oui, à la main (ci-dessous) |
| `tailscale serve reset` | retire **toutes** les publications Tailscale du poste, **y compris l'accès web distant de Pilot** | oui, à republier |
| `docker compose pull` | inutile (image **locale**, aucun registre) | — |

```powershell
# mot de passe PostgreSQL changé à tort : la connexion locale du conteneur passe
# par la SOCKET (ouverte en trust), donc aucune saisie de mot de passe n'est requise
docker exec pilot-gds psql -U postgres -c "ALTER ROLE pilot WITH PASSWORD '<nouveau mot de passe>'"
docker exec pilot-gds psql -U postgres -c "ALTER ROLE postgres WITH PASSWORD '<nouveau mot de passe>'"
docker compose up -d      # puis remettre la même valeur dans .env et dans Pilot
```

> Le parcours de retest complet (cases à cocher, du poste vierge à l'usage à
> plusieurs) est dans `docs/gds-guide-mise-en-place.md`.

---

## 10. Transmettre le serveur à un tiers (image seule)

> Objet : permettre à quelqu'un d'autre de faire tourner **le même serveur**,
> sans lui donner **vos** données. Réponse courte : on transmet **l'image**, et
> rien d'autre ; tout ce qui contient une donnée ou un secret reste chez vous
> (§10.2). Le destinataire se configure lui-même (§10.3).

### 10.1 Ce qui se transmet — et comment

**Ce qui part** : l'**image** `pilot-gds:local` — le binaire `gds-server`,
PostgreSQL 16, sshd, git, le superviseur, le script d'entrée, **et la notice de
licence MIT du projet** (`/usr/share/doc/pilot-gds/LICENSE`). Elle ne contient
**aucune** donnée : ni compte, ni projet, ni dépôt, ni mot de passe.

L'image est **locale** et aucun registre n'est renseigné (cf. l'avertissement de
`gds-server/docker-compose.yml`) : on l'extrait dans un fichier, on copie ce
fichier, on le recharge sur la machine du destinataire.

```bash
docker save pilot-gds:local -o pilot-gds-image.tar
# copiez `pilot-gds-image.tar` par le moyen habituel (support amovible,
# transfert de fichiers…), puis SUR LA MACHINE DU DESTINATAIRE :
docker load -i pilot-gds-image.tar
docker image ls pilot-gds     # l'image doit apparaître (étiquette « local »)
```

**Ce qui part avec l'image** (sans quoi rien ne démarre) : le **fichier de
composition** `gds-server/docker-compose.yml`, son **modèle de variables**
`gds-server/.env.example` (aucun secret dedans) et la **notice de licence**
`LICENSE` — trois fichiers du dépôt. **Jamais le `.env` réel** (§10.2).

**Autre voie, à la seule décision du propriétaire** : l'enchaînement
`.github/workflows/gds-server-image.yml` sait publier la même image sur le
registre GHCR, mais il ne se déclenche que **manuellement** (« Run workflow ») ;
rien ne se publie tout seul.

### 10.2 Ce qu'il ne faut JAMAIS joindre — et pourquoi

| À ne pas transmettre | Ce qu'il contient |
|---|---|
| `gds-server/.env` | **vos** mots de passe (`POSTGRES_PASSWORD`, mot de passe administrateur) : le destinataire hériterait de vos comptes et pourrait joindre votre base |
| VOLUME `pilot-gds_pgdata` | la base : **vos comptes**, vos projets attribués, vos clefs publiques, votre journal d'audit |
| VOLUME `pilot-gds_repos` | les **dépôts git de vos projets** : tout l'historique de votre travail |
| VOLUMES `pilot-gds_ssh-host-keys`, `pilot-gds_supervisor` | l'empreinte sshd de votre serveur et ses journaux |
| Sauvegardes (§9.4 : `G:\sauvegarde-gds`, ou par défaut `gds-server/backups/<horodatage>` avec `npm run gds:reload`) | une copie **complète** des trois premiers |
| Vos secrets de poste : `~/.pilot/gds_secrets.json` et la clef privée `~/.ssh/id_ed25519` | vos accès, réutilisables tels quels sur votre serveur comme sur vos projets |

Règle simple : **l'image se fabrique depuis la recette** (`docker build`, ce que
fait `npm run gds:image`), **jamais depuis le conteneur en marche** — une image
« photographiée » depuis un conteneur qui a vécu n'est plus la recette publiée.
Reprendre des **données** chez le destinataire est un autre sujet : cela passe
par l'export/import de la base, jamais par l'image.

### 10.3 Ce que le destinataire fait lui-même, dans cet ordre

1. **Déposer l'image** (§10.1), et à côté `gds-server/docker-compose.yml`,
   `gds-server/.env.example` et `LICENSE`.
2. **Créer son `.env`** : `POSTGRES_PASSWORD` (le sien) ; `GDS_ADMIN_EMAIL` +
   `GDS_ADMIN_PASSWORD` s'il veut que le service crée son compte administrateur —
   le formulaire de première initialisation (§2.4) fait la même chose sans rien
   écrire sur disque.
3. **Rendre joignables les ports du poste qui va s'en servir** : la base
   (`5432`) et les dépôts (`2222`) doivent être joignables **depuis le poste qui
   travaillera avec ce serveur** — c'est ainsi que Pilot prépare la base et
   enregistre sa clef (§10.5). Régler `GDS_DB_BIND_ADDR` / `GDS_SSH_BIND_ADDR`
   (`.env.example`, profil du §2bis) sur une adresse joignable du poste de
   travail (réseau privé Tailscale ou LAN) — **jamais** une adresse publique
   (§4).
4. **Démarrer** : `docker compose up -d` (l'image est déjà là : rien à
   reconstruire), puis `docker compose ps` et
   `curl http://127.0.0.1:8080/api/gds/health`.
5. **Se connecter depuis Pilot** : créer le compte administrateur (§2.4), puis
   activer ses projets (partie 2 de `docs/gds-guide-mise-en-place.md`).

### 10.4 Les limites à annoncer

- **Une seule architecture** : l'image publiée par l'enchaînement du dépôt est
  construite pour **`linux/amd64`** (une seule plateforme produite, cf. le
  commentaire du fichier). Sous Docker Desktop (Windows, macOS), elle tourne dans
  la machine Linux du poste ; sur une machine **ARM**, elle ne démarre pas — il
  faut alors **reconstruire l'image sur cette machine** depuis la recette
  (`docker compose up -d --build`).
- **Les ports de la base et des dépôts doivent être joignables depuis le poste
  de travail** (§10.3, point 3) : sans eux, Pilot ne peut ni préparer la base, ni
  pousser ou tirer un dépôt.
- **Pas de mise à jour automatique** : l'image est locale — une nouvelle version
  se transmet comme une **nouvelle image** (§10.1) puis `docker compose up -d`,
  jamais `docker compose pull`.
- **Aucune donnée n'est reprise** : le destinataire part d'une base vide ; ses
  dépôts se créent à l'ajout de ses projets (§3.6).

### 10.5 Serveur Linux distant : côté machine, et côté poste de travail

Cas visé : le serveur tourne sur une **autre machine** que celle où Pilot est
installé (Linux, serveur toujours allumé).

**Côté machine, une seule fois :**

- Docker (+ Compose) installé et la machine **allumée en continu** ;
- l'**image** déposée (§10.1), ou reconstruite sur la machine si son
  architecture diffère (§10.4) ;
- un `.env` avec **ses** mots de passe ;
- les **ports rendus joignables depuis le poste de travail** : base (`5432`) et
  dépôts (`2222`) au minimum ; l'interface d'administration (`8080`) seulement
  si elle doit être consultée à distance (§3.4) ;
- **rien d'autre à préparer à la main** : le script d'entrée du conteneur crée la
  base, le compte système `git`, la racine des dépôts et les clefs d'hôte, puis
  le service se maintient seul.

**Côté poste de travail (Pilot) :** c'est **Pilot** qui prépare la base **à
distance**, par une connexion PostgreSQL directe (hôte, port, utilisateur et
mot de passe saisis dans l'onglet **🌐 GDS**) : création de la base `pilot_gds`
et de son rôle, migrations, compte administrateur, projets et clefs publiques —
tout est écrit **dans la base du serveur**. L'application **ne se connecte
jamais en SSH** à la machine distante pour l'administrer : elle n'exécute
aucune commande dessus et ne crée rien sur son disque. Ce qui manque encore dans
la base est appliqué **par le conteneur lui-même** — dépôts bare et
`authorized_keys` — avec un passage toutes les **30 secondes** (cf. §3.6).

**Points de contrôle :**

- sur la machine : `curl http://127.0.0.1:8080/api/gds/health` répond ;
- dans Pilot : le bouton **Tester** de l'onglet **🌐 GDS** confirme la connexion,
  et le badge du projet passe à **● Connecté** ;
- `git ls-remote` en SSH sur un dépôt attribué **ne demande pas de mot de passe**
  (partie 1, étape 2.4 de `docs/gds-guide-mise-en-place.md`).
