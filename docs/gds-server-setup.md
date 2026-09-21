# Installer le serveur GDS de Pilot et le rendre joignable par le réseau privé

> Document d'installation et d'exploitation — décrit, **pas à pas**, comment
> mettre en route le **serveur GDS** de Pilot (le conteneur tout-en-un de
> `gds-server/`) sur un poste **Windows**, puis comment le rendre joignable
> **depuis un autre appareil** du **réseau privé Tailscale**, **sans jamais
> l'exposer au grand public**.
>
> **Statut : 🟢 Implémenté** — micro-tâche **L2.9** du plan de refonte GDS
> (`04-plan-developpement.md`, LOT 2). Voir aussi `spec_gds.md`
> (spécification fonctionnelle) et `gds-server/README.md` (référence rapide du
> dossier serveur).
>
> ⚠️ **Ce document ne s'exécute pas tout seul.** Toutes les commandes réseau
> (`tailscale …`) sont **à lancer par le propriétaire** : elles modifient la
> configuration réseau du poste. Pilot n'exécute **jamais** ces réglages à votre
> place.

---

## 0. Ce que fait cette procédure, ce qu'elle ne fait pas

| Étape | Qui s'en charge |
|---|---|
| Construire et démarrer le conteneur | vous (une commande `docker compose`) |
| Créer la base, les tables, les dépôts, les clefs d'hôte | le conteneur, automatiquement |
| Créer le compte administrateur | vous (route d'initialisation à usage unique) |
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
  curl.exe -X POST http://127.0.0.1:8080/api/gds/setup `
    -H "Content-Type: application/json" `
    -d '{"email":"vous@exemple.com","password":"<mot de passe admin>"}'
  ```

  Attendu : `{"ok":true,"email":"…"}`. Un second appel répond ensuite
  `409` (« Un administrateur existe déjà ») : la route ne sert qu'**une fois**.
  (`curl.exe` : sous PowerShell, `curl` est un alias ; `curl.exe` force le vrai
  outil. Le mot de passe n'est ni journalisé ni renvoyé.)
- **Démarrage non interactif** : renseignez `GDS_ADMIN_EMAIL` **et**
  `GDS_ADMIN_PASSWORD` dans `.env` **avant** le tout premier démarrage ; le
  conteneur crée alors l'administrateur lui-même. Un mot de passe
  d'administration n'est **jamais** généré : c'est vous qui le choisissez.

### 2.5 Vérifier depuis le poste

```powershell
curl http://127.0.0.1:8080/api/gds/health
```

Attendu : une réponse JSON courte du type
`{"version":…,"migration_version":…,"users":…,"projects":…,"git_repos":…}`.

Vérification de la base (le détail des variantes est dans
`gds-server/README.md` §3) :

```powershell
docker exec -e PGPASSWORD="<POSTGRES_PASSWORD>" pilot-gds `
  psql -h host.docker.internal -p 5432 -U pilot -d pilot_gds -c "select 1"
```

Attendu : une ligne `1`.

---

## 3. Rendre le serveur joignable depuis un autre appareil (réseau privé)

**Ordre des opérations** : trouver l'adresse Tailscale (§3.2) → régler les
adresses d'écoute (§3.3) → publier l'interface d'administration sur le réseau
privé (§3.4) → vérifier depuis l'autre appareil (§3.5).

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

# 2) les dépôts git répondent (port 2222, adresse Tailscale du poste)
git ls-remote ssh://git@100.x.y.z:2222/mon-projet.git

# 3) la base répond (port 5432, adresse Tailscale du poste)
psql -h 100.x.y.z -p 5432 -U pilot -d pilot_gds -c "select 1"
```

Attendus : le JSON de santé pour (1), la liste des références du dépôt pour
(2), une ligne `1` pour (3). Si le dépôt n'existe pas encore, l'erreur est
attendue ; l'essentiel est que la **connexion** SSH aboutisse (pas de
« connection timed out »).

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
poste, ou la base locale que Pilot provisionne) écoute déjà sur
`127.0.0.1:5432`. Windows route alors `127.0.0.1:5432` vers ce service natif au
lieu du conteneur, et le poste parle à la **mauvaise** base — le symptôme
typique est `password authentication failed for user "pilot"` alors que le mot
de passe est **juste**.

Détecter, puis décaler **seulement le port publié** (le port interne du
conteneur ne change pas) :

```powershell
netstat -ano | findstr :5432      # Windows
ss -ltnp | grep :5432             # Linux / macOS
```

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

Pour revenir à une installation **strictement locale** (aucun accès par le
réseau privé), remettez `GDS_BIND_ADDR=127.0.0.1` et commentez le bloc §2bis de
`.env`, puis `docker compose up -d`.

---

## 8. Ce qui relève d'autres lots

- **Arrêter / redémarrer le service depuis Pilot** (sans toucher au conteneur) :
  micro-tâche **L2.10**.
- **Consolidation documentaire** : ce document remplacera à terme
  `docs/gds-linux-setup.md` (serveur Linux manuel), qui décrit une préparation
  devenue inutile avec le conteneur tout-en-un — micro-tâche **L7.3**. En
  attendant, les deux cohabitent.
