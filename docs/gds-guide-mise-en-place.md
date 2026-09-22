# Parcours de retest GDS — de la machine vierge à l'usage à plusieurs

> **Document de retest** — c'est la **liste de contrôle complète** du GDS
> (gestionnaire de sources) de Pilot : on part d'un poste **vierge** et on
> rejoue **tout** le parcours, dans l'ordre, jusqu'à l'usage normal **à
> plusieurs**. Chaque étape dit ce que vous faites, le résultat attendu et le
> point de contrôle qui prouve que c'est bon.
>
> **Statut : 🟡 Branche de travail** — rédigé sur la branche `gds-refonte-l2` de
> la refonte GDS. Rien de tout cela n'est encore dans la version installée de
> Pilot.
>
> - Mode d'emploi **technique** d'installation (commandes, pièges, dépannage) :
>   `docs/gds-server-setup.md`.
> - Référence du dossier serveur (volumes, variables, service) :
>   `gds-server/README.md`.
> - Spécification fonctionnelle : `spec_gds.md`.

**Comment s'en servir**

- Déroulez les parties **1 → 2 → 3 dans l'ordre**. Ne sautez aucune case :
  chaque partie suppose la précédente terminée.
- Chaque étape a trois lignes : **Vous faites** (le geste à exécuter),
  **Résultat attendu** (ce qui doit se produire), **Point de contrôle** (la
  preuve mesurable, à regarder soi-même).
- **🅰** = le serveur fait ce geste **tout seul** au démarrage ; l'équivalent
  **à la main** est en **partie 5**. **⚠️** = geste réseau ou sensible.
- Un point de contrôle qui ne passe pas → **§8 Dépannage**, puis
  `docs/gds-server-setup.md` §6.
- Les commandes sont données **PowerShell** (poste serveur Windows) ; les
  variantes `cmd.exe`/Linux sont dans `docs/gds-server-setup.md`.

**Vocabulaire utile** (une phrase chacun)

- **GDS** : « gestionnaire de sources » — le serveur qui garde vos projets et
  l'historique de leur suivi au même endroit.
- **Conteneur** (ou « Docker ») : une sorte de mini-machine logicielle, déjà
  toute préparée, qu'on démarre d'une seule commande.
- **Base de données PostgreSQL** : le meuble de classement où le serveur range
  les comptes, les projets et le suivi.
- **Dépôt git** (« bare ») : le dossier qui contient l'historique des versions
  d'un projet.
- **SSH** (clef) : le mot de passe « long » qui prouve votre identité pour
  publier du code, sans saisir de mot de passe à chaque fois.
- **Réseau privé Tailscale** : un tunnel chiffré qui relie **vos** appareils
  entre eux, invisible depuis Internet.
- **Service** : les deux processus internes `gds-server` (API HTTP) et `sshd`
  (accès aux dépôts). **PostgreSQL n'en fait pas partie** : la base tourne
  toujours.

---

# PARTIE 0 — À avoir sous la main AVANT de commencer

Sur le **poste qui hébergera le serveur** :

- [ ] **Docker Desktop** installé et **démarré** (moteur Linux / WSL2).
- [ ] Le **dépôt de Pilot** présent sur le poste (le dossier `gds-server/` en
      fait partie).
- [ ] Un **terminal PowerShell** ouvert dans `gds-server/`.
- [ ] *(seulement si vous voulez l'accès depuis un autre appareil)*
      **Tailscale** installé et **connecté**.
- [ ] *(facultatif)* un client PostgreSQL si vous voulez tester la base
      directement ; sinon le client déjà présent dans l'image suffit.

Sur **chaque appareil qui utilisera le GDS** :

- [ ] **Pilot** lancé (la version qui contient la refonte GDS — branche de
      travail).
- [ ] *(accès distant)* **Tailscale** connecté au **même tailnet**.
- [ ] *(publier du code)* `git` installé.

**À décider et noter maintenant** (vous les ressaisirez plus loin) :

| À choisir | Exemple | Où ça sert |
|---|---|---|
| Mot de passe PostgreSQL (`POSTGRES_PASSWORD`) | long et unique | `.env` **et** écran GDS de Pilot |
| Adresse e-mail de l'administrateur | `vous@exemple.com` | compte admin GDS |
| Mot de passe de l'administrateur | choisi par vous | compte admin GDS |
| Adresse e-mail + nom git d'un utilisateur | `dev@exemple.com`, « Dev Un » | identité GDS de la personne |

> ⛔ **Règles à ne jamais enfreindre** (le détail : `docs/gds-server-setup.md` §4) :
> ne **jamais** rediriger les ports `8080`, `5432`, `2222` depuis la box/le
> routeur ; ne **jamais** les publier par un tunnel public (Cloudflare Tunnel,
> ngrok, `tailscale funnel`) ; ne **jamais** les faire écouter sur une adresse
> publique. L'accès distant légitime passe par le **réseau privé Tailscale**.

**Point de contrôle 0 —**

```powershell
docker compose version      # doit afficher une version
tailscale status            # (si utilisé) doit lister vos appareils, pas « Logged out »
```

- [ ] Les deux commandes répondent.

---

# PARTIE 1 — LE SERVEUR (une fois, sur le poste hôte)

Toutes les commandes se lancent **depuis `gds-server/`**, dans **PowerShell**.

### 1.1 — Créer le fichier de variables

- [ ] **Vous faites :**

  ```powershell
  cd G:\IA_PL\pilot\gds-server      # remplacer par votre chemin
  Copy-Item .env.example .env      # cmd.exe : copy .env.example .env
  ```

- **Résultat attendu :** `gds-server/.env` existe, à côté du modèle.
- **Point de contrôle :** `git status --porcelain gds-server/.env` n'affiche
  **rien** (le fichier est ignoré par git ; il ne partira jamais dans un commit
  ni dans une image).

### 1.2 — Renseigner le seul secret obligatoire

- [ ] **Vous faites :** ouvrez `.env`, remplissez **une** ligne :
      `POSTGRES_PASSWORD=<votre mot de passe long et unique>` (sans guillemets).
- **Résultat attendu :** aucune autre valeur n'est nécessaire pour un premier
  démarrage sur le poste (toutes ont un défaut sûr).
- **Point de contrôle :** `POSTGRES_PASSWORD` est non vide.
- ⚠️ **Piège :** ce mot de passe est **fixé au premier démarrage** (il est posé
  dans la base à la création). Le **changer plus tard casse l'accès** : le rôle
  `pilot` et le compte `postgres` gardent l'ancien. Voir **§6** pour la
  correction à la main.

### 1.3 — (facultatif) Préparer la création automatique de l'administrateur

- [ ] **Vous faites :** si vous voulez **zéro commande manuelle**, renseignez
      **les deux** lignes ci-dessous dans `.env`, **avant** le premier
      démarrage :

  ```dotenv
  GDS_ADMIN_EMAIL=vous@exemple.com
  GDS_ADMIN_PASSWORD=<mot de passe administrateur>
  ```

- **Résultat attendu :** le service créera lui-même ce compte au démarrage
  (voir **1.6**). Si vous laissez les deux lignes vides, vous utiliserez la
  route d'initialisation manuelle en **1.6**.
- **Point de contrôle :** les deux lignes sont soit **toutes deux** remplies,
  soit **toutes deux** vides.

### 1.4 — Construire et démarrer

- [ ] **Vous faites :**

  ```powershell
  docker compose up -d --build
  docker compose ps                  # attendre l'état « healthy »
  ```

- **Résultat attendu :** la **première** construction prend quelques minutes ;
  les suivantes quelques secondes. `docker compose ps` finit par afficher un
  service **healthy** (`starting` = la base s'initialise encore : patientez,
  jusqu'à deux minutes au premier démarrage).
- **Point de contrôle :** la colonne d'état du service `gds` affiche
  **`healthy`**, et le conteneur s'appelle **`pilot-gds`**.

### 1.5 — Vérifier l'interface et la base

- [ ] **Vous faites :**

  ```powershell
  # 1) l'interface d'administration répond
  curl http://127.0.0.1:8080/api/gds/health
  # 2) la base répond (client embarqué dans l'image, rien à installer)
  docker exec -e PGPASSWORD="<POSTGRES_PASSWORD>" pilot-gds `
    psql -h host.docker.internal -p 5432 -U pilot -d pilot_gds -c "select 1"
  ```

- **Résultat attendu :** un JSON court du type
  `{"version":…,"migration_version":…,"users":…,"projects":…,"git_repos":…}`,
  puis une ligne `1`.
- **Point de contrôle :** le JSON contient `"migration_version"` et la base
  répond `1`. (Si le port `5432` est déjà pris par un PostgreSQL natif, voir
  `docs/gds-server-setup.md` §5.1 : décaler `GDS_HOST_DB_PORT`.)

### 1.6 — Obtenir le premier compte administrateur

> Au tout premier démarrage, **aucun administrateur** n'existe. 🅰 Si vous avez
> rempli **les deux** variables en **1.3**, il a **déjà** été créé au démarrage
> (vérifiez la ligne dans les journaux, **1.6.b**). Sinon, créez-le **une seule
> fois** par la route d'initialisation (**1.6.a**). Un mot de passe
> d'administration n'est **jamais généré** : c'est vous qui le choisissez.

**1.6.a — Création manuelle (chemin normal, aucun secret écrit sur disque)**

- [ ] **Vous faites :**

  ```powershell
  # Sous Windows PowerShell, les guillemets internes d'un argument passé à
  # `curl.exe` sont supprimés (le serveur répondrait « Failed to parse the
  # request body as JSON ») : le corps passe donc par un fichier temporaire.
  Set-Content -Path "$env:TEMP\gds-setup.json" -NoNewline -Encoding ascii `
    -Value '{"email":"vous@exemple.com","password":"<mot de passe admin>"}'
  curl.exe -X POST http://127.0.0.1:8080/api/gds/setup `
    -H "Content-Type: application/json" --data-binary "@$env:TEMP\gds-setup.json"
  # ⚠️ Ce fichier contient le mot de passe en clair : le supprimer aussitôt.
  Remove-Item "$env:TEMP\gds-setup.json"
  ```

- **Résultat attendu :** `{"ok":true,"email":"…"}`.
- **Point de contrôle :** un **second** appel identique répond **`409`**
  (« un administrateur existe déjà ») : la route ne sert qu'**une fois**.

**1.6.b — Vérifier le cas 🅰 (création automatique)**

- [ ] **Vous faites :** `docker compose logs gds | Select-String "administrateur"`
- **Résultat attendu (les quatre cas réels) :**

  | Ce qui est dans `.env` | Ce que le journal dit | Ce qui se passe |
  |---|---|---|
  | les **deux** variables, **aucun** admin | `administrateur initial créé (vous@exemple.com)` | le compte existe |
  | les **deux** variables, **admin déjà présent** | `administrateur déjà présent — GDS_ADMIN_EMAIL/GDS_ADMIN_PASSWORD ignorées` | **rien n'est écrasé** |
  | **une seule** variable | `GDS_ADMIN_EMAIL et GDS_ADMIN_PASSWORD doivent être renseignées ENSEMBLE … amorçage ignoré` | avertissement, **rien n'est créé** |
  | les deux, mais l'e-mail est **déjà pris** par un autre compte | `création de l'administrateur initial ignorée : …` | échec journalisé, **le service démarre quand même** |
- **Point de contrôle :** la ligne correspondant à **votre** situation apparaît,
  et **aucun mot de passe** n'apparaît dans les journaux.
- **Test à faire volontairement** (facultatif, mais c'est le cœur du lot) :
  1. partez d'un volume vierge, mettez les **deux** variables → admin créé ;
  2. **relancez** (`docker compose up -d`) en laissant les variables → journal
     « déjà présent », et **l'ancien mot de passe fonctionne toujours** ;
  3. sur un volume vierge, ne mettez **qu'** `GDS_ADMIN_EMAIL` → avertissement,
     et la route `/api/gds/setup` répond encore (aucun admin) ;
  4. *(cas de **protection**, à forcer à la main — pas un cas normal)* placez
     dans la base un compte **non administrateur** portant l'e-mail `X` (aucun
     administrateur n'existe alors) :

     ```powershell
     docker exec -e PGPASSWORD="<POSTGRES_PASSWORD>" pilot-gds `
       psql -h host.docker.internal -p 5432 -U pilot -d pilot_gds `
       -c "INSERT INTO users (email, role, status) VALUES ('X@exemple.com','standard','active')"
     ```

     puis mettez `GDS_ADMIN_EMAIL=X@exemple.com` et relancez → l'échec est
     journalisé (l'e-mail est déjà pris) et `/api/gds/health` répond toujours.
     Le code prévoit ce cas (`email` unique en base) ; il ne peut **pas** arriver
     par l'interface, puisque seuls l'amorçage et la route `/api/gds/setup`
     créent des comptes, et tous deux créent un administrateur.

### 1.7 — ⚠️ (facultatif) Ouvrir l'accès depuis un autre appareil

> Sauté si vous n'utilisez le GDS que depuis le poste serveur. Aucune commande
> réseau n'est lancée par Pilot : **c'est vous qui les lancez**.

- [ ] **Vous faites :**

  ```powershell
  tailscale ip -4                   # note l'adresse 100.x.y.z du poste
  ```

  puis, dans `.env`, dé-commentez le bloc « profil L2.9 » et remplacez
  `100.x.y.z` par cette adresse :

  ```dotenv
  GDS_HTTP_BIND_ADDR=127.0.0.1      # admin : poste uniquement (+ Tailscale Serve)
  GDS_DB_BIND_ADDR=100.x.y.z        # base : réseau privé uniquement
  GDS_SSH_BIND_ADDR=100.x.y.z       # dépôts git : réseau privé uniquement
  ```

  ```powershell
  docker compose up -d
  docker compose ps
  tailscale serve --bg --https=443 http://127.0.0.1:8080   # 8443 si Pilot utilise déjà 443
  tailscale serve status
  ```

- **Résultat attendu :** la ligne des ports montre
  `127.0.0.1:8080->8080/tcp, 100.x.y.z:2222->22/tcp, 100.x.y.z:5432->5432/tcp` ;
  `tailscale serve status` affiche `https://<machine>.ts.net/`.
- **Point de contrôle :** les trois adresses d'écoute sont **privées** ; aucune
  n'est `0.0.0.0`. Et `tailscale funnel` est **absent** (interdit).
- **Conséquence à retenir :** la base n'écoutant plus que sur l'adresse
  Tailscale, **le poste lui-même** s'y connecte par cette adresse : dans Pilot,
  le champ **Hôte PostgreSQL** devient `100.x.y.z` (ou le nom MagicDNS), **pas**
  `localhost`.

### 1.8 — Vérifier depuis l'autre appareil

- [ ] **Vous faites** (depuis l'autre appareil du tailnet) :

  ```powershell
  curl https://<machine>.ts.net/api/gds/health
  git ls-remote ssh://git@100.x.y.z:2222/srv/git/repos/mon-projet.git
  psql -h 100.x.y.z -p 5432 -U pilot -d pilot_gds -c "select 1"
  ```

- **Résultat attendu :** le JSON de santé, la liste des références du dépôt (si
  le dépôt n'existe pas encore, l'erreur « repository not found » est
  **normale**), la ligne `1`.
- **Point de contrôle :** la connexion **aboutit** (pas de « connection timed
  out »). Si ça expire : mauvais tailnet, ou ports restés sur `GDS_BIND_ADDR`
  → revoir 1.7.

### 1.9 — Le dépôt d'un projet se crée tout seul 🅰

- [ ] **Vous faites :** rien côté serveur. Le dépôt est créé par le service
      après « Ajouter ce projet au GDS » (partie 2, **2.6**).
- **Résultat attendu :** il apparaît **dans les 30 secondes**.
- **Point de contrôle :**

  ```powershell
  docker compose logs gds | Select-String "bare"
  docker exec pilot-gds ls /srv/git/repos
  ```

  Attendu : la ligne `gds-server : dépôts bare créés : <projet>.git`, puis le
  dossier `<projet>.git`.

**Fin de la partie 1 — point de contrôle global :**

- [ ] le service est **healthy**, `/api/gds/health` répond, un administrateur
      existe, et (si demandé) l'accès distant répond depuis l'autre appareil.

---

# PARTIE 2 — L'USAGE (dans Pilot, par chaque personne)

### 2.1 — Ouvrir l'écran d'administration et se connecter

- [ ] **Vous faites :** dans Pilot, bouton **« 🖥️ GDS Serveur — administration »**
      (barre d'outils ; s'ouvre **sans projet**). Bloc **Connexion serveur** :
      hôte, port, e-mail + mot de passe administrateur → **Tester**.
- **Résultat attendu :** la version du serveur et son état s'affichent.
- **Point de contrôle :** la version affichée **correspond** à celle de
  `/api/gds/health`. Un mot de passe faux est **refusé** (message d'erreur, pas
  de connexion).

### 2.2 — Créer un compte développeur et lui attribuer un projet

- [ ] **Vous faites :** bloc **Comptes** → créer un compte (**e-mail**, rôle
      `dev` ou `standard`, **mot de passe initial**). Puis bloc
      **Dépôts / projets** → associer le projet au développeur.
- **Résultat attendu :** le compte apparaît dans la liste (état **actif** par
  défaut) ; le projet est attribué.
- **Point de contrôle :** le développeur peut se connecter avec ce mot de passe
  et **voit** le projet attribué dans **« ⚙️ GDS — paramétrage » → Mes projets
  GDS**. Transmettez-lui l'e-mail et le mot de passe.
- **Test à faire :** désactiver le compte → la connexion est refusée ;
  réactiver → elle remarche. Le **dernier administrateur actif** ne peut **pas**
  être désactivé (le serveur refuse) : vérifiez le refus.

### 2.3 — Renseigner son identité (une seule fois)

- [ ] **Vous faites :** dans **« ⚙️ GDS — paramétrage » → Mon identité** :
      votre **e-mail** (il identifie votre compte) et votre **nom git**.
- **Résultat attendu :** les champs sont mémorisés.
- **Point de contrôle :** l'e-mail saisi est **celui du compte** créé en 2.2 ;
  les écrans suivants ne le redemandent plus (il est pré-rempli).

### 2.4 — Enregistrer sa clef SSH (une seule fois par poste)

- [ ] **Vous faites :** **« ⚙️ GDS — paramétrage » → Mes clés** : afficher,
      **copier** la clef publique, puis **l'enregistrer sur le serveur**.
- **Résultat attendu :** la clef apparaît côté serveur ; le serveur reprend la
  liste **toutes les 30 secondes** (inutile de redémarrer).
- **Point de contrôle :** après 30 s, une commande `git ls-remote` en SSH sur le
  dépôt attribué **ne demande pas de mot de passe** (elle aboutit ou dit
  « repository not found » pour un dépôt pas encore créé — jamais
  `Permission denied (publickey)`).

### 2.5 — Mémoriser le serveur (et son mot de passe)

- [ ] **Vous faites :** **Serveurs GDS** → ajouter le serveur (hôte, port),
      **Tester** la connexion.
- **Résultat attendu :** le serveur est mémorisé ; vous pouvez l'**appliquer à
  un projet**.
- **Point de contrôle :** les mots de passe saisis restent **sur le poste**
  (`~/.pilot/gds_secrets.json`) : ils ne figurent **jamais** dans le projet.

### 2.6 — Rattacher un projet existant au serveur

Tout se passe dans l'onglet **« 🌐 GDS »** du projet (bouton **GDS** du panneau
**Vues**). L'en-tête affiche un badge : **« ○ À configurer »**,
**« ● En attente »** ou **« ● Connecté »** ; seuls les blocs utiles s'affichent.

- [ ] **2.6.a Connecter un serveur** : choisissez un serveur mémorisé (sélecteur)
      ou un nouveau — hôte, port, utilisateur dédié (`pilot`), **mot de passe
      dédié** (= `POSTGRES_PASSWORD`), **mot de passe administrateur**.
- [ ] **2.6.b Enregistrer la configuration** : mémorise **sans rien créer**.
      Point de contrôle : le bouton confirme, et **rien** n'apparaît encore côté
      serveur.
- [ ] **2.6.c Renseigner** **Port SSH** (`2222`), **Racine des dépôts serveur**
      (`/srv/git/repos`) et, si besoin, le **Dossier local de clonage**.
      Point de contrôle : « Racine des dépôts serveur non renseignée » ne doit
      **plus** apparaître à l'étape suivante.
- [ ] **2.6.d Activer GDS** : met le projet en relation avec le serveur (vérifie
      ou crée ce qui manque). Point de contrôle : le badge passe à l'état
      attendu, et un mot de passe manquant plus tard se règle par
      **« Enregistrer les mots de passe »** — **sans** refaire l'activation et
      **sans** recréer la base.
- [ ] **2.6.e Ajouter ce projet au GDS** : crée le dépôt bare sur le serveur,
      ajoute le raccourci `gds` (sans toucher à un `origin` existant, p. ex.
      GitHub) et **pousse la branche courante**.
      - **Résultat attendu :** badge **« ✅ Déjà ajouté »**, bouton d'ajout
        masqué ; le dépôt apparaît côté serveur en moins de 30 s (voir 1.9).
      - **Point de contrôle :** `docker exec pilot-gds ls /srv/git/repos` montre
        `<projet>.git` ; le `git remote -v` du projet local montre le raccourci
        `gds`.
      - **Piège connu :** si le `push` initial tombe dans la fenêtre des 30 s, il
        échoue — **relancez simplement « Ajouter ce projet au GDS »**
        (l'opération est idempotente).

### 2.7 — Récupérer un projet qui n'existe pas encore chez soi 🅰

- [ ] **Vous faites :** menu **Projet** → **« Ajouter un projet depuis le GDS »**
      → choisir le dépôt → récupérer (clone).
- **Résultat attendu :** le projet local s'ouvre, **déjà connecté**.
- **Point de contrôle :** le badge de l'onglet **🌐 GDS** est **« ● Connecté »**
  sans avoir rien resaisi.

### 2.8 — Le travail quotidien : synchroniser, publier

- [ ] **Vous faites :** bouton **Synchroniser** (rapatrie : clone si absent,
      sinon récupération).
- **Résultat attendu :** les nouveautés d'un collègue arrivent dans votre copie.
- **Point de contrôle :** **Synchroniser ne publie pas** vos propres
  modifications. Pour publier, **vous** poussez votre branche vers le raccourci
  `gds` (terminal intégré de Pilot ou votre outil git habituel) : vos commits ne
  partent **jamais** tout seuls.

### 2.9 — Les rôles : vérifier les refus attendus

| Rôle | Doit pouvoir | Doit être **refusé** |
|---|---|---|
| **Administrateur** (`admin`) | gérer comptes + dépôts, publier et forcer le suivi sur **tous** les projets, redémarrer/arrêter le **service** | — |
| **Développeur** (`dev`) | publier et forcer le suivi des projets **attribués**, récupérer **tous** les projets en lecture | gérer les comptes/dépôts ; publier un projet **non attribué** |
| **Standard** (`standard`) | consulter et récupérer en lecture | publier quoi que ce soit |

- [ ] **Vous faites :** connectez-vous successivement avec un compte `dev` non
      attribué à un projet, puis un compte `standard`.
- **Résultat attendu :** la publication est **refusée**, et le refus est
  **journalisé**.
- **Point de contrôle :** le refus apparaît dans le **journal d'audit** —
  écran d'administration, bloc **« Espace utilisé + journal »**, portée *Tout le
  journal* : une action avec `ok = false` (et, pour la publication forcée
  refusée, l'action `tracking.force.denied`).

### 2.10 — Le suivi partagé et les conflits (sans verrou)

- [ ] **Vous faites :** depuis deux postes, modifiez le **suivi partagé** (un
      projet, une tâche, une décision) sur le **même** élément, puis
      **Synchroniser** des deux côtés.
- **Résultat attendu :** personne n'est bloqué (plus de verrou de projet). La
      règle est « **le dernier qui écrit gagne** » : la dernière écriture
      **remplace** la précédente.
- **Point de contrôle :** le conflit **détecté** est **journalisé** — action
      `tracking.conflict` dans le journal d'audit du serveur (bloc « Espace utilisé
      + journal », portée *Tout le journal*) — jamais silencieux. Le **code**, lui,
      suit git normalement (récupérez avant de commencer, poussez tôt).

### 2.11 — Contrôler le service depuis Pilot (rôle `admin`)

- [ ] **Vous faites :** écran d'administration → **Contrôle du serveur** →
      **Redémarrer le service**, puis **Arrêter le service**.
- **Résultat attendu :** les deux processus `gds-server` et `sshd` sont
      relancés / arrêtés ; **PostgreSQL continue de tourner** (données et suivi
      intacts).
- **Point de contrôle :** après un **redémarrage**, `GET /api/gds/admin/service`
      liste les trois programmes internes (`postgres`, `sshd`, `gds-server`) avec
      leurs identifiants de processus et un **PID neuf** pour `gds-server` ; après
      un **arrêt**, la route ne répond plus (`gds-server` et `sshd` sont arrêtés,
      `postgres` continue). L'écran attend le retour de la santé tout seul.
      Restauration :

  ```powershell
  docker compose restart gds
  # ou, sans toucher au conteneur :
  docker exec pilot-gds supervisorctl -c /etc/gds/supervisord.conf start gds-server sshd
  ```

  Chaque action acceptée (ou refusée) laisse une trace **persistante** dans le
  journal d'audit (`service_restart` / `service_stop`).

### 2.12 — Retirer un projet du GDS

- [ ] **Vous faites :** onglet **🌐 GDS** → **Retirer du GDS** (confirmation).
      Ne cochez la **purge** côté serveur que si vous le voulez vraiment.
- **Résultat attendu :** le projet redevient **100 % local** ; avec la purge, les
  données serveur du projet sont retirées.
- **Point de contrôle :** sans la purge, le dépôt existe **toujours** sur le
  serveur (`docker exec pilot-gds ls /srv/git/repos`) ; avec la purge, il a
  disparu. Le projet local, lui, **n'est jamais** supprimé.

---

# PARTIE 3 — À PLUSIEURS (le test final)

### 3.1 — Deux personnes publient des commits différents

- [ ] **Vous faites :** sur le poste A, modifiez un fichier, committez, poussez
      vers `gds`. Sur le poste B (déjà à jour), bouton **Synchroniser**.
- **Résultat attendu :** B reçoit la modification de A.
- **Point de contrôle :** le fichier modifié sur A est présent sur B après
      synchronisation.

### 3.2 — Deux personnes modifient le **même** fichier

- [ ] **Vous faites :** A et B modifient le **même** fichier sans se
      synchroniser, puis poussent / synchronisent.
- **Résultat attendu :** le **git standard** s'applique : soit la poussée de B
      est refusée (« non fast-forward », à tirer puis fusionner), soit un conflit
      de fusion apparaît.
- **Point de contrôle :** aucune donnée n'est écrasée silencieusement ; le
      conflit est **visible** (message git), et se résout avec les gestes git
      habituels.

### 3.3 — Deux personnes modifient le **suivi** en même temps

- [ ] **Vous faites :** voir **2.10** (dernier qui écrit gagne) et vérifier la
      ligne `tracking.conflict` dans le journal du serveur.
- **Point de contrôle :** le journal contient la trace du conflit.

### 3.4 — Le serveur tombe : le local continue

- [ ] **Vous faites :** sur un poste connecté, **arrêtez le service** (2.11) ou
      débranchez le serveur, puis ouvrez le projet et travaillez.
- **Résultat attendu :** Pilot **n'est pas bloqué** : le local reste la
      référence ; tout ce qui a bougé se **resynchronise** au retour du serveur.
- **Point de contrôle :** au retour du service, une synchronisation fait
      converger les deux côtés (et un conflit éventuel est journalisé, cf. 2.10).

### 3.5 — Vérifier que rien n'a fui côté sécurité

- [ ] **Vous faites :**

  ```powershell
  docker compose ps                    # adresses d'écoute réellement publiées
  netstat -ano | findstr ":8080 :2222 :5432"
  tailscale serve status
  ```

- **Résultat attendu :** `8080` sur `127.0.0.1`, `5432`/`2222` sur l'adresse
  privée (`100.x.y.z`) — **jamais** l'adresse de la box, **jamais** `0.0.0.0` si
  vous avez appliqué 1.7.
- **Point de contrôle :** aucune des trois portes n'est joignable depuis
  Internet ; `tailscale funnel` n'est **pas** utilisé.

---

# PARTIE 4 — MODIFIER LE SERVEUR : CE QUI CHANGE POUR LE CONTENEUR

> Question : après avoir modifié quelque chose **côté serveur**, faut-il
> reconstruire l'image, faut-il recréer le conteneur, mes données
> (comptes, projets, dépôts) survivent-elles, et combien de temps ça coupe ?

## 4.1 — La réponse, en une table

| Ce que vous modifiez | Reconstruire l'image ? | Recréer le conteneur ? | Comptes / projets / dépôts conservés ? | Interruption |
|---|---|---|---|---|
| **Code** du serveur (`gds-server/`, `gds-core/`) | **Oui** — `docker compose up -d --build` | **Oui** (l'image change) | **Oui** (volumes nommés) | le temps du redémarrage |
| `Dockerfile`, `entrypoint.sh`, `sshd_config`, `supervisord.conf` | **Oui** | **Oui** | **Oui** | le temps du redémarrage |
| **`.env` seulement** (mot de passe, adresses, variables admin) | Non | **Oui** (`.env` décrit le conteneur) | **Oui** | le temps du redémarrage |
| **`docker-compose.yml` seulement** (ports, volumes) | Non | **Oui** | **Oui** | le temps du redémarrage |
| Rien : arrêter/redémarrer le **service** depuis Pilot | Non | **Non** (conteneur intact) | **Oui** | quelques secondes |
| `docker compose stop` puis `start` | Non | Non (même conteneur) | **Oui** | le temps de l'arrêt/démarrage |
| `docker compose down` puis `up -d` | Non | **Oui** (supprimé puis recréé) | **Oui** — les volumes ne sont pas supprimés | le temps du redémarrage |
| `docker compose down -v` | Non | Oui | ❌ **NON : tout est effacé** | — |

**En une phrase :** une modification du serveur demande **toujours** une
**reconstruction de l'image** (`--build`) **et** une **recréation du
conteneur** (`up -d`) ; les **données survivent** parce qu'elles vivent dans des
**volumes nommés** séparés du conteneur — **seul `down -v` les détruit**.

## 4.2 — Les preuves, lues dans les fichiers

| Preuve | Fichier (lu) | Ce qu'il montre |
|---|---|---|
| L'image est **locale** : ni tirée, ni poussée | `gds-server/docker-compose.yml` — `image: pilot-gds:local` + bloc `build:` (aucun registre) | une modification du code **ne peut pas** arriver par `docker compose pull` : il faut **reconstruire** |
| Le conteneur est **recréé** au prochain `up -d` | `docker-compose.yml` — `env_file: - .env` (toute modification de `.env` change la configuration du conteneur) | on ne peut pas appliquer une nouvelle configuration « à chaud » |
| L'état vit **hors** du conteneur | `docker-compose.yml` — `volumes:` (`pgdata`, `repos`, `ssh-host-keys`, `supervisor`) + déclaration finale des 4 volumes nommés ; `Dockerfile` — `VOLUME ["/var/lib/postgresql/data", "/srv/git/repos", "/etc/ssh/host_keys"]` | reconstruire ou recréer **ne touche pas** aux volumes |
| **Les données ne sont jamais écrasées au démarrage** | `entrypoint.sh` — « création de l'INSTANCE PostgreSQL sur le volume si le datadir est VIDE — un datadir déjà initialisé est **CONSERVÉ tel quel (aucune réinitialisation, les données du volume ne sont jamais effacées)** » | démarrer/redémarrer **ne réinitialise pas** la base |
| Le bootstrap est **idempotent** | `entrypoint.sh` — `gds-server --init-db` (rôle et base créés s'ils sont absents, puis migrations embarquées — idempotent) ; `--init-ssh` (idempotent : un fichier conforme n'est pas réécrit) | relancer mille fois donne le même état |
| Les **migrations** sont rejouées à chaque démarrage | `gds-server/src/main.rs` — au démarrage : « migrations appliquées jusqu'à la version … » | une nouvelle version du serveur met le schéma à jour **toute seule**, au redémarrage |
| Les **clefs d'hôte SSH** sont stables | `entrypoint.sh` — clefs « générées … si elles manquent — **jamais écrasées**, donc empreinte stable après reconstruction » | après reconstruction, les postes ne ré-autorisent pas le serveur |
| L'**administrateur** n'est jamais écrasé | `gds-server/src/main.rs` — `BootstrapAdminDecision::AlreadyInitialized` → « administrateur déjà présent — GDS_ADMIN_EMAIL/GDS_ADMIN_PASSWORD ignorées » | redémarrer avec les variables ne casse **pas** le compte existant |
| L'**arrêt est propre** avant recréation | `docker-compose.yml` — `restart: unless-stopped`, `stop_grace_period: 70s` ; `supervisord.conf` — PostgreSQL arrêté en mode « fast » | le moteur laisse jusqu'à 70 s pour écrire avant de tuer |

## 4.3 — Ce qui reste à vérifier **en conditions réelles**

- **La durée exacte de l'interruption** : les fichiers donnent un **plafond**
  (`stop_grace_period: 70s`) et un **délai de santé** (`healthcheck.start_period:
  120s`, `interval: 20s`), mais **pas** la durée réelle. À chronométrer sur
  votre poste (`Measure-Command { docker compose up -d }`).
- **Le temps de reconstruction** : la première construction « quelques minutes »,
  les suivantes « quelques secondes » (dixit `README.md` §1) : c'est une
  **indication d'auteur**, pas une mesure.
- **Le cas « montée de version »** : reconstruire sur une nouvelle version de
  l'image de base (PostgreSQL 16) **réutilise le même volume** ; le
  comportement exact (réutilisation sans migration de cluster) n'a **pas** été
  essayé ici.
- **Le comportement du `healthcheck` pendant une recréation** (fenêtre où
  `docker compose ps` n'affiche rien) : non mesuré.

## 4.4 — Sauvegarder AVANT toute modification du serveur

> On sauvegarde les **volumes**, pas le conteneur : le conteneur ne contient
> aucune donnée (elle est dans les volumes). On **arrête** le service le temps de
> la copie, pour une image cohérente de la base.

```powershell
# 0. se placer dans gds-server/ et préparer un dossier de sauvegarde
cd G:\IA_PL\pilot\gds-server
New-Item -ItemType Directory -Force G:\sauvegarde-gds | Out-Null

# 1. arrêter proprement (les volumes sont CONSERVÉS)
docker compose stop

# 2. copier les trois volumes qui portent de l'état (image locale : rien à
#    télécharger ; l'écriture se fait par tar, jamais par une redirection
#    PowerShell qui corromprait le binaire)
docker run --rm -v pilot-gds_pgdata:/data:ro        -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/pgdata.tgz -C /data .
docker run --rm -v pilot-gds_repos:/data:ro         -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/repos.tgz -C /data .
docker run --rm -v pilot-gds_ssh-host-keys:/data:ro -v G:\sauvegarde-gds:/backup pilot-gds:local tar czf /backup/ssh-host-keys.tgz -C /data .

# 3. vérifier les tailles, puis relancer
Get-ChildItem G:\sauvegarde-gds
docker compose start
```

- **Point de contrôle :** les trois fichiers `.tgz` existent et ne sont pas
  vides ; après `start`, `/api/gds/health` répond et le compteur d'utilisateurs
  du JSON est **inchangé**.
- *(Variante base seule, sans arrêter le service :)*
  `docker exec pilot-gds pg_dump -U pilot -d pilot_gds -f /tmp/pilot_gds.sql`
  puis `docker cp pilot-gds:/tmp/pilot_gds.sql .` — mais elle **ne sauvegarde
  pas** les dépôts git.

## 4.5 — La bonne séquence pour une modification (interruption minimale)

```powershell
# 1. reconstruire PENDANT que le service tourne (le service n'est pas coupé)
docker compose build
# 2. basculer : recréation, seule interruption réelle
docker compose up -d
# 3. vérifier
docker compose ps
curl http://127.0.0.1:8080/api/gds/health
```

- Un changement de **`.env`** ne demande que l'étape 2 (`docker compose up -d`).
- Une seule ligne de commande suffit si l'interruption n'est pas un souci :
  `docker compose up -d --build`.

## 4.6 — La commande automatique (et l'équivalent manuel, geste par geste)

> Un **script Node** de la racine du projet fait les 4.4 et 4.5 **dans le bon
> ordre**, sur Windows, macOS et Linux. C'est la même chose que les commandes
> ci-dessus — rien de plus : vous pouvez tout refaire à la main (colonne de
> droite), le script n'invente aucune étape.

**Vous faites** (depuis la racine du projet : `G:\IA_PL\pilot`) :

```bash
npm run gds:reload     # rechargement complet
npm run gds:image      # reconstruction de l'image SEULE (le service continue de tourner)
```

| # | Ce que le script fait | L'équivalent à la main |
|---|---|---|
| 0 | vérifie que `docker`, `docker compose`, `docker-compose.yml` et `.env` sont là ; sinon il s'arrête | `docker --version` puis `docker compose version` ; regarder `gds-server/` |
| 1 | **sauvegarde datée** des trois volumes (base, dépôts, clefs d'hôte) dans `gds-server/backups/<horodatage>/`, après un arrêt propre | **4.4** (les trois `.tgz`) |
| 2 | **reconstruit l'image** locale | `cd gds-server` puis `docker compose build` |
| 3 | **recrée le conteneur**, **volumes conservés** | `docker compose up -d` |
| 4 | attend que le service **réponde** (240 s au plus) | `curl http://127.0.0.1:8080/api/gds/health` |
| 5 | affiche le compte rendu : étapes, dossier de sauvegarde, service répond ? | — |

- **Résultat attendu :** le service répond de nouveau, et le dossier de sauvegarde
  contient `pgdata.tgz`, `repos.tgz` et `ssh-host-keys.tgz` non vides.
- **Point de contrôle :** le compte rendu affiche `Service … : RÉPOND` ; les
  comptes, projets et dépôts sont **toujours là** (les volumes n'ont pas bougé).
- **Options :** `--backup-dir <chemin>` (défaut `gds-server/backups/<horodatage>`),
  `--timeout <secondes>`, `--help`, `--image-only`.
- **Garde-fous :** le script **refuse** tout argument qui supprimerait des
  volumes (`-v`, `--volumes`, `down -v`, `volume rm`, `prune`, `rm -rf`) et
  **s'arrête sans rien reconstruire** si la sauvegarde échoue. Aucun secret n'est
  lu ni affiché (il vérifie seulement que `.env` **existe**).

---

# PARTIE 5 — TOUT REFAIRE À LA MAIN (ce que le conteneur fait tout seul)

> Chaque automatisme ci-dessous est **refaisable à la main**, dans cet **ordre**.
> Les commandes s'exécutent depuis le poste, sur un conteneur **démarré**
> (`docker exec …`). ⚠️ = efface ou modifie de l'état.

| # | Ce que le conteneur fait 🅰 | Équivalent à la main | Ordre |
|---|---|---|---|
| 1 | crée l'instance PostgreSQL sur un volume **vide** (`initdb`), le mot de passe du superutilisateur passant par un **fichier** (jamais en argument de commande, donc jamais visible dans `ps`) | `docker exec -u postgres pilot-gds sh -c "umask 077; printf '%s\n' '<POSTGRES_PASSWORD>' > /tmp/pw; initdb -D /var/lib/postgresql/data --username=postgres --pwfile=/tmp/pw --auth-local=trust --auth-host=scram-sha-256; rm -f /tmp/pw"` | 1er, **volume vierge uniquement** |
| 2 | démarre l'instance PostgreSQL | `docker exec -u postgres pilot-gds pg_ctl -D /var/lib/postgresql/data -l /var/lib/postgresql/data/postgresql.log start` | 2e |
| 3 | ouvre l'accès direct par mot de passe (`pg_hba.conf`) | éditer `/var/lib/postgresql/data/pg_hba.conf` et y ajouter `host all all <plage> scram-sha-256` | 3e |
| 4 | prépare rôle + base + migrations (`--init-db`) | `docker exec pilot-gds gds-server --init-db` | 4e |
| 5 | prépare le compte `git`, `authorized_keys`, les dépôts bare (`--init-ssh`) | `docker exec pilot-gds gds-server --init-ssh` | 5e |
| 6 | génère les clefs d'hôte sshd (si absentes) | `docker exec pilot-gds ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/host_keys/ssh_host_ed25519_key` (idem `rsa`) | 6e |
| 7 | rend `sshd_config` (port interne) et le valide | `docker exec pilot-gds sh -c "sed \"s/__GDS_SSH_PORT__/22/g\" /etc/gds/sshd_config > /etc/ssh/sshd_config.gds && sshd -t -f /etc/ssh/sshd_config.gds"` | 7e |
| 8 | crée le **premier administrateur** (ou route `/api/gds/setup`) | `Set-Content` + `curl.exe -X POST http://127.0.0.1:8080/api/gds/setup …` (voir **1.6.a**) | 8e |
| 9 | matérialise le dépôt bare d'un projet (< 30 s) | `docker exec pilot-gds git init --bare /srv/git/repos/<projet>.git && docker exec pilot-gds chown -R git:git /srv/git/repos/<projet>.git` | quand un projet est annoncé en base |
| 10 | régénère `authorized_keys` depuis la base (< 30 s) | `docker exec pilot-gds gds-server --init-ssh` | après chaque ajout/révocation de clef |
| 11 | supervise les trois processus (redémarrage automatique) | `docker exec pilot-gds supervisorctl -c /etc/gds/supervisord.conf status` / `restart gds-server sshd` | à tout moment |

**Deux précisions lues dans les fichiers :** les programmes surveillés portent
exactement les noms `postgres`, `sshd`, `gds-server` (`supervisord.conf`) ; et le
script d'entrée **arrête l'instance de « bootstrap »** avant de confier
PostgreSQL au superviseur (sans quoi deux postmasters se disputeraient le port).

**Ce qu'aucune commande manuelle ne remplace :** le **suivi fusionné** (la
synchronisation des projets/tâches/décisions entre PostgreSQL et chaque poste)
est fait par **Pilot** ; il n'y a pas de commande unique « tout synchroniser » à
taper à la main — passez par le bouton **Synchroniser**.

---

# PARTIE 6 — GESTES DANGEREUX (ce qui efface ou casse des données)

| ⚠️ Geste | Effet | Réversible ? |
|---|---|---|
| `docker compose down -v` | supprime les **4 volumes** : base (comptes, suivi), dépôts git, clefs d'hôte, journal d'audit | ❌ **non** |
| `docker volume rm pilot-gds_pgdata` (ou `_repos`) | idem, ciblé | ❌ non — sauf sauvegarde (4.4) |
| `rm -rf /srv/git/repos/<projet>.git` (dans le conteneur) | historique git du projet perdu | ❌ non |
| changer `POSTGRES_PASSWORD` après le premier démarrage | **n'est pas appliqué** à la base existante : le service ne peut plus s'y connecter | ⚠️ oui, à la main (voir ci-dessous) |
| `tailscale serve reset` | retire **toutes** les publications Tailscale du poste, **y compris l'accès web distant de Pilot** | oui, à republier |
| `git push --force` depuis un poste | écrase l'historique du dépôt (git standard) | ⚠️ souvent non |
| `docker compose pull` | inutile (image **locale** : aucun registre) — ne « met » rien à jour | — |
| supprimer un compte `admin` « en trop » | si c'est le **dernier** admin actif, le serveur refuse | — |

**Réparer un mot de passe PostgreSQL changé à tort** (le mot de passe du rôle
est fixé à la création) :

```powershell
docker exec pilot-gds psql -U postgres -c "ALTER ROLE pilot WITH PASSWORD '<nouveau mot de passe>'"
docker exec pilot-gds psql -U postgres -c "ALTER ROLE postgres WITH PASSWORD '<nouveau mot de passe>'"
docker compose up -d          # puis remettre la même valeur dans .env et dans Pilot
```

> La connexion locale au sein du conteneur passe par la **socket** (ouverte en
> `trust`), donc ces commandes fonctionnent **sans** saisir le mot de passe.

> **Aucun** des gestes ❌ ci-dessus n'est exécuté par `npm run gds:reload`
> (4.6) : le script refuse les arguments de ce genre (`-v`, `--volumes`,
> `down -v`, `volume rm`, `prune`) et ne supprime jamais de volume.

**Retirer / arrêter sans rien perdre :**

```powershell
tailscale serve reset     # ⚠️ retire TOUTES les publications (y compris Pilot)
docker compose stop       # arrête le conteneur — volumes CONSERVÉS
docker compose start      # redémarre
docker compose down       # supprime le conteneur — volumes CONSERVÉS
```

---

# PARTIE 7 — CE QUI EST PROUVÉ / CE QUI RESTE À VÉRIFIER

## ✅ Prouvé par les fichiers et les tests du projet

- Le serveur **se construit et se lance** sur un volume vide (base, migrations,
  dépôts, clefs d'hôte, supervision) : couvert par le banc d'essai
  `gds-server/tests/e2e.sh` sur un environnement **jetable**.
- Les **commandes, ports, volumes, variables** de la partie 1 sont ceux réellement
  écrits dans `gds-server/docker-compose.yml`, `gds-server/.env.example`,
  `gds-server/Dockerfile`, `gds-server/entrypoint.sh` et `gds-server/README.md`.
- Les **trois cas usuels de l'administrateur automatique** (les deux variables /
  déjà présent / une seule) sont décidés par une fonction **pure** testée sans
  base (`gds-core/src/config.rs`, `plan_bootstrap_admin`) ; le 4e cas (échec
  journalisé **sans bloquer le démarrage**) est écrit dans `gds-server/src/main.rs`
  — il suppose qu'un compte **non administrateur** porte déjà l'e-mail demandé
  (`email` unique en base), état qui ne s'obtient **pas** par l'interface :
  détaillé en **1.6.b**.
- Les **trois rôles** et la règle « dernier qui écrit gagne + conflits
  journalisés » sont appliqués **côté serveur** (tests unitaires du socle).
- La **séquence de conteneur** de la partie 4 : chaque affirmation est adossée
  au fichier qui la porte (tableau 4.2).
- La **commande de rechargement** (4.6) : son enchaînement d'étapes et les
  commandes qu'elle construit sont vérifiés **sans Docker réel** par
  `scripts/gds-reload.test.js` (`npm test`) — y compris le **refus** de tout
  argument destructeur et l'absence de `down -v` dans la chaîne.

## ⚠️ Reste à vérifier en conditions réelles (par vous)

- **La branche n'est pas publiée** : ces nouveautés **ne sont pas** dans la
  version installée de Pilot.
- **Ce document n'a pas été exécuté de bout en bout par son rédacteur** : il a
  été écrit à partir du code et des documents du projet, **sans** démarrer le
  conteneur, **sans** lancer Pilot. Le parcours « depuis zéro, sur un poste
  vierge » **reste à dérouler par vous**, case à case.
- **`npm run gds:reload` n'a pas été exécuté contre un serveur réel** (ni la
  reconstruction d'image, ni la sauvegarde, ni la recréation) : le script est
  livré **testé sans Docker**. La **première** exécution réelle sera la **vôtre** :
  les durées affichées dans le compte rendu sont celles du poste, pas une mesure
  du rédacteur.
- **La partie utilisateur n'a pas de test automatique** : les tests portent sur
  les morceaux testables des écrans et sur le serveur, **pas** sur un parcours
  « écran → serveur → dépôt git » piloté depuis l'interface.
- **La durée d'interruption** d'une reconstruction/recréation : non mesurée
  (voir 4.3).
- **L'usage à deux postes simultanés** (partie 3) : comportement **annoncé**, non
  essayé ici à deux postes réels.
- **Docker Desktop et Tailscale** : seul leur présence est exigée ici ; ni l'un
  ni l'autre n'a été installé/vérifié par le rédacteur.
- **Le piège du port 5432 déjà occupé** dépend de ce qui tourne **sur votre
  poste**.

---

# PARTIE 8 — DÉPANNAGE RAPIDE

| Symptôme | Où aller |
|---|---|
| `docker compose ps` reste `starting` | patienter (jusqu'à 2 min) ; `docker compose logs gds` |
| « mot de passe de la base … non défini » | remplir `POSTGRES_PASSWORD` dans `.env` (1.2), puis `docker compose up -d` |
| `password authentication failed for user "pilot"` | collision de port `5432` — `docs/gds-server-setup.md` §5.1 |
| `Failed to parse the request body as JSON` | la commande `curl.exe` de 1.6.a est passée sans fichier — refaire avec `Set-Content` + `--data-binary` |
| `Permission denied (publickey)` en SSH | clef du poste non enregistrée (2.4), ou pas encore reprise (attendre 30 s) |
| `push` refusé : « detected dubious ownership » | `docker compose restart gds` (le démarrage reprend les dépôts au profit de `git`) |
| le `push` initial échoue juste après l'ajout | fenêtre < 30 s : **relancer « Ajouter ce projet au GDS »** (2.6.e) |
| `Racine des dépôts serveur non renseignée` | renseigner `/srv/git/repos` (2.6.c) |
| l'URL Tailscale affiche le mauvais service | le port 443 sert déjà Pilot : utiliser `--https=8443` |
| « connection timed out » depuis l'autre appareil | appareil hors tailnet, ou ports restés sur `GDS_BIND_ADDR` |
| détection de conflit / verrou | le verrou n'existe **plus** : « dernier qui écrit gagne », conflits **journalisés** |

Voir aussi le **dépannage complet** : `docs/gds-server-setup.md` §6.

---

# Documents liés

| Document | Ce qu'on y trouve |
|---|---|
| `docs/gds-server-setup.md` | Mode d'emploi pas à pas du serveur (installation, accès réseau privé, pièges, dépannage, **modifier le serveur** §9). |
| `gds-server/README.md` | Référence rapide du dossier serveur (volumes, variables, service, banc d'essai). |
| `spec_gds.md` | Spécification fonctionnelle du GDS (rôles, synchronisation, écrans). |
| `help/overview.md` (§ `HELP:gds`) | L'aide intégrée de Pilot (onglet « ❓ Aide ») : résumé de ce parcours. |
