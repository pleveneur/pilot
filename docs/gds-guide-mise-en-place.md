# Parcours de retest GDS — de la machine vierge à l'usage à plusieurs

> **Document de retest** — c'est la **liste de contrôle complète** du GDS
> (gestionnaire de sources) de Pilot : on part d'un poste **vierge** et on
> rejoue **tout** le parcours, dans l'ordre, jusqu'à l'usage normal **à
> plusieurs**.
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

---

## Comment lire ce document

Chaque étape tient en **trois lignes**, toujours dans le même ordre :

| Ligne | Ce qu'elle contient |
|---|---|
| **Vous faites** | **une seule** action : une commande à copier telle quelle, un fichier à ouvrir, ou un bouton à cliquer dans Pilot. |
| **Vous voyez** | ce qui doit apparaître. C'est le **point de contrôle** : quand c'est un message, il est cité **mot pour mot**. |
| **Si ce n'est pas ça** | le geste qui corrige, ou l'arrêt et le renvoi vers la section qui règle le problème. |

**Il n'y a rien à compléter entre chevrons.** Quand une commande a besoin d'une
valeur, elle la lit toute seule (dans le conteneur) ou le document dit **où
trouver la valeur** (quel fichier, quelle ligne, quel écran). Aucune valeur
n'est laissée à compléter.

### Où on agit : trois endroits, jamais un autre

Le document dit **toujours** où vous êtes. Il n'y a que trois lieux :

1. **Le fichier de réglages du serveur** : `gds-server/.env` (un fichier texte,
   ouvert dans le Bloc-notes ou VS Code). On n'y touche **que** quand la ligne
   commence par « Dans le fichier `.env` ».
2. **Un terminal PowerShell**, ouvert **dans le dossier `gds-server/`** du dépôt
   Pilot. Toutes les commandes `docker …` se tapent là. La ligne commence alors
   par « Dans le terminal ».
3. **L'application Pilot** — ses fenêtres et ses onglets. Tout ce qui est « dans
   Pilot » se fait **à la souris**, sans terminal.

> Les commandes données sont **PowerShell** (poste Windows). Les variantes
> `cmd.exe` / Linux / macOS sont dans `docs/gds-server-setup.md`.
>
> **🅰** = le serveur fait ce geste **tout seul** au démarrage ; l'équivalent
> **à la main** est en **partie 5**. **⚠️** = geste réseau ou sensible.
>
> Un point de contrôle qui ne passe pas → **Partie 8 (Dépannage)**, puis
> `docs/gds-server-setup.md` §6.

---

# 🚨 LE PIÈGE DU PORT — à lire AVANT tout le reste

**Ce piège a déjà coûté du temps sur ce poste.** Il donne l'illusion d'un
**mauvais mot de passe** alors que le mot de passe est **juste**.

**Ce qui se passe.** Le serveur GDS range ses comptes dans une base de données
(PostgreSQL). Cette base a besoin d'un **port** sur la machine — le port
habituel est **`5432`**. Or **un autre PostgreSQL est très souvent déjà installé
sur le poste** et occupe déjà le `5432` (c'est le cas quand une installation
PostgreSQL native est présente sur la machine).

**La conséquence.** Quand un programme **du poste** demande `127.0.0.1:5432`, la
machine l'envoie vers **ce PostgreSQL déjà installé**, pas vers celui du GDS.
Tout ce qui passe **par la machine** aboutit donc sur la **MAUVAISE base**. Cette
mauvaise base ne connaît pas le compte `pilot`, refuse le mot de passe, et on
croit s'être trompé de mot de passe. Le serveur GDS, lui, va très bien : seules
les commandes qui passent **par le conteneur** fonctionnent.

### Comment le détecter, en une commande

**Dans le terminal** (dossier `gds-server/` ; l'application Pilot peut rester
ouverte) :

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  Select-Object LocalAddress, OwningProcess,
    @{n="Programme"; e={(Get-Process -Id $_.OwningProcess).ProcessName}}
```

| **Vous voyez** | Ce que ça veut dire |
|---|---|
| Une seule ligne, `Programme` = `com.docker.backend` (ou `vpnkit`, ou `docker-proxy`) | Le port est tenu par le conteneur GDS : **pas de piège**. |
| **Plusieurs lignes**, dont une avec `postgres` / `pg_ctl` / `postgresql` | **C'est le piège.** Un PostgreSQL du poste occupe le port. → Correction ci-dessous. |
| Aucune ligne | Rien n'écoute : le conteneur n'est pas démarré (voir **1.4**), ou vous utilisez déjà un autre port. |

> **Constaté sur ce poste le 22/09/2026** : la commande a montré **`postgres`
> (l'installation PostgreSQL du poste) sur `127.0.0.1`** *et*
> **`com.docker.backend` (le conteneur GDS) sur `0.0.0.0`** — le piège était donc
> bien actif : tout ce qui passait par `127.0.0.1:5432` allait à la **mauvaise**
> base.

### La preuve, sans rien casser

Les mêmes données, regardées **par le conteneur** (la bonne base).

- **Dans le terminal, vous faites :**

  ```powershell
  docker exec pilot-gds sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "select 1"'
  ```

- **Vous voyez :** une ligne `1`. La base du GDS répond — et cette commande-là
  (elle passe **par le conteneur**) n'est jamais trompée par un autre
  PostgreSQL.
- **Si ce n'est pas ça :** `Error: No such container` → le conteneur n'est pas
  démarré (**1.4**) ; toute autre erreur de mot de passe → le mot de passe de la
  base a été changé après le premier démarrage (**Partie 6**).

> Le test inverse — depuis **Pilot** — est le symptôme qui a déclenché ce
> document : un écran GDS affiche **`password authentication failed for user
> "pilot"`** alors que la commande ci-dessus répond `1`. C'est **exactement** le
> piège.

### La correction, une fois pour toutes

On ne désinstalle **rien**, on ne change **aucun mot de passe** : on **décale le
port publié par le conteneur**, puis on redéclare le serveur dans Pilot.

1. **Dans le fichier `.env`** (dossier `gds-server/`) : cherchez la ligne
   `GDS_HOST_DB_PORT=5432` et remplacez `5432` par `55432`. C'est la **seule**
   modification du fichier ; le port **interne** de la base ne change pas.
2. **Dans le terminal :**

   ```powershell
   docker compose up -d
   docker compose ps
   ```

   **Vous voyez :** le service `gds` en **`healthy`**.
3. **Dans Pilot** : reportez le nouveau port `55432` partout où le port de la
   **base** a été saisi.
   - Onglet **« ⚙️ GDS — paramétrage » → Serveurs GDS** : ouvrez le serveur,
     champ **Port** → `55432`, puis **Tester la connexion**.
   - Onglet **« 🌐 GDS »** du projet : même champ **Port** → `55432`, puis
     **Enregistrer la configuration**.
   - L'écran d'administration **« 🖥️ GDS Serveur — administration »** n'est
     **pas** concerné : son champ **Port HTTP** est celui de l'interface web
     (`8080`), pas celui de la base.
4. **Vous voyez :** « Tester la connexion » répond (version, comptes, projets),
   et la commande de preuve ci-dessus répond toujours `1`.

- **Si ce n'est pas ça :** l'étape 3 a peut-être été faite dans un seul des deux
  écrans (les deux gardent **leur propre** port) ; revérifiez les **deux**.
  Détail technique : `docs/gds-server-setup.md` §5.1.

> **Non vérifié** : cette correction a été écrite à partir du comportement
> observé (« tout ce qui passe par la machine aboutit sur la mauvaise base ») ;
> elle n'a **pas** été rejouée de bout en bout sur le poste. La détection (la
> commande `Get-NetTCPConnection`) et le diagnostic, **eux**, ont été exécutés
> ici le 22/09/2026.
>
> *(Variante sans décalage de port : ne publier la base **que** sur l'adresse
> Tailscale — `GDS_DB_BIND_ADDR` renseigné avec l'adresse affichée par
> `tailscale ip -4`, voir **1.7**. Le conflit avec le PostgreSQL du poste
> disparaît alors, mais l'accès à la base devient conditionné à Tailscale.)*

---

# 🧭 REPRENDRE LÀ OÙ VOUS ÊTES

Inutile de repartir de zéro. Repérez **votre** situation, puis allez à l'étape
indiquée.

| Votre situation | Vous allez à |
|---|---|
| **Rien n'est installé** sur ce poste | **Partie 1**, étape **1.1** |
| Le conteneur tourne, mais **aucun administrateur n'a été créé** | **1.6.a** (créer le compte à la main) |
| **Le serveur est debout et l'administrateur existe**, rien d'autre n'est enregistré | **le chemin ci-dessous**, puis **2.6** |
| Le serveur est enregistré dans Pilot, mais **le projet n'est pas encore relié** | **2.6** |
| Tout est enregistré, vous voulez **tester à deux postes** | **Partie 3** |
| Vous devez **modifier le serveur** (code ou réglages) | **Partie 4** |

**Le chemin « serveur debout, administrateur créé, rien d'autre enregistré » —
geste par geste** (votre cas probable) :

1. **Dans Pilot** → onglet **« ⚙️ GDS — paramétrage » → Mon identité** :
   renseignez votre **e-mail** (celui du compte administrateur) et votre **nom
   git**, puis **Enregistrer l'identité**. *(Détail : 2.3.)*
2. **Dans Pilot** → **« ⚙️ GDS — paramétrage » → Serveurs GDS** → **Ajouter un
   serveur** : Hôte `127.0.0.1`, **Port** `5432` (ou `55432` si vous avez
   corrigé le piège du port), « Utilisateur PostgreSQL » `pilot`, « Mot de passe
   dédié » = la valeur de la ligne `POSTGRES_PASSWORD` du fichier `.env`,
   « Mot de passe admin GDS » = celui du compte administrateur → **Tester la
   connexion** → **Ajouter le serveur**. *(Détail : 2.5.)*
3. **Dans Pilot** → ouvrez (ou créez) un **projet** → onglet **« 🌐 GDS »** :
   **Connecter un serveur GDS** (choisissez le serveur mémorisé),
   **Enregistrer la configuration**, **Port SSH du serveur** = `2222`,
   **Racine des dépôts serveur** = `/srv/git/repos`, puis **Activer GDS** et
   **Ajouter ce projet au GDS**. *(Détail : 2.6.)*

Vous êtes seul sur le GDS ? Sautez l'étape **2.2** (création d'un compte
développeur) : elle ne sert qu'à faire travailler quelqu'un d'autre.

---

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
| Mot de passe PostgreSQL (`POSTGRES_PASSWORD`) | long et unique | ligne `POSTGRES_PASSWORD` du fichier `.env` **et** écran GDS de Pilot |
| Adresse e-mail de l'administrateur | `vous@exemple.com` | compte admin GDS |
| Mot de passe de l'administrateur | choisi par vous | compte admin GDS |
| Adresse e-mail + nom git d'un utilisateur | `dev@exemple.com`, « Dev Un » | identité GDS de la personne |

> ⛔ **Règles à ne jamais enfreindre** (le détail : `docs/gds-server-setup.md` §4) :
> ne **jamais** rediriger les ports `8080`, `5432`, `2222` depuis la box/le
> routeur ; ne **jamais** les publier par un tunnel public (Cloudflare Tunnel,
> ngrok, `tailscale funnel`) ; ne **jamais** les faire écouter sur une adresse
> publique. L'accès distant légitime passe par le **réseau privé Tailscale**.

### Étape 0 — Vérifier que les outils répondent

- **Dans le terminal, vous faites :**

  ```powershell
  docker compose version
  tailscale status        # seulement si vous utilisez Tailscale
  ```

- **Vous voyez :** une version de Docker Compose, et (si utilisé) la liste de
  vos appareils — jamais `Logged out`.
- **Si ce n'est pas ça :** « command not found » → **Docker Desktop** n'est pas
  démarré (menu Démarrer → Docker Desktop), ou Tailscale n'est pas connecté :
  arrêtez-vous ici et installez-les (**Partie 0**, plus haut).

---

# PARTIE 1 — LE SERVEUR (une fois, sur le poste hôte)

Toutes les commandes de cette partie se lancent **dans le terminal**, depuis le
dossier **`gds-server/`**. Pour y arriver sans taper de chemin : ouvrez le
dossier `gds-server` dans l'explorateur Windows, **clic droit dans le dossier →
« Ouvrir dans le Terminal »** (ou « Ouvrir dans PowerShell »).

### 1.1 — Créer le fichier de réglages

- **Dans le terminal, vous faites :**

  ```powershell
  Copy-Item .env.example .env      # cmd.exe : copy .env.example .env
  ```

- **Vous voyez :** `Get-ChildItem .env*` affiche **deux** fichiers : `.env` et
  `.env.example`. Le fichier `.env` est celui que vous allez remplir ; il est
  ignoré par git (il ne partira jamais dans un commit ni dans une image).
- **Si ce n'est pas ça :** « cannot find path » → vous n'êtes pas dans le bon
  dossier ; `Get-ChildItem` doit y montrer `docker-compose.yml`.

### 1.2 — Mettre le mot de passe de la base (le seul secret obligatoire)

- **Dans le fichier `.env`, vous faites :** ouvrez-le (Bloc-notes ou VS Code),
  trouvez la ligne `POSTGRES_PASSWORD=`, et tapez votre mot de passe **juste
  après le signe `=`**. Choisissez-le **long et unique** (20 caractères et plus).
  Laissez-le **sans chevrons et sans guillemets**.
- **Vous voyez :** la ligne n'est plus vide. Toutes les autres valeurs du fichier
  ont un défaut sûr : un premier démarrage ne demande **rien d'autre**.
- **Si ce n'est pas ça :** au démarrage, le service refuse et le journal dit mot
  pour mot : « Configuration du serveur incomplète : le mot de passe de la base
  de données n'est pas défini. Renseignez la variable d'environnement
  POSTGRES_PASSWORD avant de démarrer le service GDS. » → revenez ici, corrigez,
  relancez **1.4**.

> ⚠️ **Ce mot de passe est fixé au premier démarrage** : il est posé dans la
> base à sa création. Le changer plus tard **casse l'accès** (le rôle `pilot` et
> le compte `postgres` gardent l'ancien). Correction à la main : **Partie 6**.
> Notez-le dans un gestionnaire de mots de passe dès maintenant.

### 1.3 — (facultatif) Laisser le serveur créer l'administrateur tout seul

- **Dans le fichier `.env`, vous faites :** remplissez **les deux** lignes
  ci-dessous, **avant** le premier démarrage, si vous voulez **zéro commande
  manuelle**. Le **mot de passe est le vôtre** : il n'est jamais généré.
  Pour les créer **à la main**, laissez-les vides et passez à **1.6.a**.

  ```dotenv
  GDS_ADMIN_EMAIL=vous@exemple.com
  GDS_ADMIN_PASSWORD=le mot de passe de votre choix
  ```

- **Vous voyez :** les deux lignes sont soit **toutes deux** remplies, soit
  **toutes deux** vides. C'est le seul état valide.
- **Si ce n'est pas ça :** une seule des deux remplie → le journal dira
  « GDS_ADMIN_EMAIL et GDS_ADMIN_PASSWORD doivent être renseignées ENSEMBLE …
  amorçage ignoré » et **rien** ne sera créé. Remplissez les deux, ou aucune.

### 1.4 — Construire et démarrer le serveur

- **Dans le terminal, vous faites :**

  ```powershell
  docker compose up -d --build
  docker compose ps
  ```

- **Vous voyez :** la **première** construction prend quelques minutes (les
  suivantes, quelques secondes). `docker compose ps` finit par afficher le
  service `gds` avec l'état **`healthy`**, et le conteneur s'appelle
  **`pilot-gds`**. Tant que l'état est `starting`, la base s'initialise encore :
  patientez, **jusqu'à deux minutes** au premier démarrage.
- **Si ce n'est pas ça :** encore `starting` après deux minutes → regardez
  `docker compose logs gds` ; un message sur le **mot de passe** → **1.2** ;
  « docker n'est pas reconnu » → Docker Desktop n'est pas démarré (**Étape 0**).

### 1.5 — Vérifier que le serveur et la base répondent

- **Dans le terminal, vous faites** (les deux commandes l'une après l'autre) :

  ```powershell
  # 1) l'interface d'administration répond — « curl.exe » (avec .exe) est
  #    important : sous PowerShell, « curl » tout court est un alias.
  curl.exe http://127.0.0.1:8080/api/gds/health

  # 2) la base répond — la commande vise la base DANS LE CONTENEUR : elle lit le
  #    mot de passe dans le conteneur (rien à recopier, aucun secret dans
  #    l'historique du terminal) et n'est jamais trompée par un autre PostgreSQL
  #    installé sur le poste (piège en tête de ce document).
  docker exec pilot-gds sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "select 1"'
  ```

  > Si vous avez changé `GDS_HOST_HTTP_PORT` ou `GDS_HOST_DB_PORT` dans `.env`,
  > la valeur affichée dans votre fichier `.env` remplace `8080` / `5432` dans
  > les commandes ci-dessus.

- **Vous voyez :** d'abord un JSON court du type
  `{"version":…,"migration_version":…,"users":…,"projects":…,"git_repos":…}`,
  puis une ligne **`1`**.
- **Si ce n'est pas ça :**
  - erreur de connexion à l'adresse → le service n'est pas prêt (**1.4**) ;
  - vous voyez `1`, mais **un écran de Pilot** refuse le mot de passe
    (`password authentication failed for user "pilot"`) → **c'est le piège du
    port** : reprenez l'encadré en tête du document ;
  - la commande 2 échoue sur le mot de passe → il a été changé après le premier
    démarrage (**Partie 6**).

### 1.6 — Obtenir le premier compte administrateur

> Au tout premier démarrage, **aucun administrateur** n'existe. 🅰 Si vous avez
> rempli **les deux** variables en **1.3**, il a **déjà** été créé (vérifiez la
> ligne dans les journaux, **1.6.b**). Sinon, créez-le **une seule fois** avec
> **1.6.a**. Un mot de passe d'administration n'est **jamais** généré : c'est
> **vous** qui le choisissez.

**1.6.a — Création à la main (chemin normal, aucun secret écrit sur disque)**

- **Dans le terminal, vous faites** (les **trois** lignes ensemble) : remplacez
  seulement l'adresse e-mail et le mot de passe administrateur **entre les
  guillemets** — ce sont **vos** choix, pas des valeurs à retrouver ailleurs.

  ```powershell
  Set-Content -Path "$env:TEMP\gds-setup.json" -NoNewline -Encoding ascii `
    -Value '{"email":"vous@exemple.com","password":"MOT-DE-PASSE-ADMIN"}'
  curl.exe -X POST http://127.0.0.1:8080/api/gds/setup `
    -H "Content-Type: application/json" --data-binary "@$env:TEMP\gds-setup.json"
  # Le fichier temporaire contient le mot de passe en clair : on le supprime aussitôt.
  Remove-Item "$env:TEMP\gds-setup.json"
  ```

- **Vous voyez :** `{"ok":true,"email":"…"}`.
- **Si ce n'est pas ça :**
  - `409` → un administrateur **existe déjà** : c'est **bon signe**, passez à la
    suite (vous n'avez rien à créer) ;
  - « Failed to parse the request body as JSON » → vous avez lancé la commande
    `curl.exe` sans la ligne `Set-Content` : refaites les **trois** lignes
    ensemble.

**1.6.b — Vérifier le cas 🅰 (création automatique)**

- **Dans le terminal, vous faites :**

  ```powershell
  docker compose logs gds | Select-String "administrateur"
  ```

- **Vous voyez** exactement une des quatre lignes ci-dessous, selon ce que
  contient votre fichier `.env` :

  | Ce qui est dans `.env` | Ce que le journal dit | Ce qui se passe |
  |---|---|---|
  | les **deux** variables, **aucun** admin | `administrateur initial créé (vous@exemple.com)` | le compte existe |
  | les **deux** variables, **admin déjà présent** | `administrateur déjà présent — GDS_ADMIN_EMAIL/GDS_ADMIN_PASSWORD ignorées` | **rien n'est écrasé** |
  | **une seule** variable | `GDS_ADMIN_EMAIL et GDS_ADMIN_PASSWORD doivent être renseignées ENSEMBLE … amorçage ignoré` | avertissement, **rien n'est créé** |
  | les deux, mais l'e-mail est **déjà pris** par un autre compte | `création de l'administrateur initial ignorée : …` | échec journalisé, **le service démarre quand même** |
- **Si ce n'est pas ça :** aucune ligne ne parle d'administrateur → c'est le cas
  « les deux variables vides » : créez le compte à la main (**1.6.a**).
- **Test à faire volontairement** (facultatif, mais c'est le cœur du lot) :
  1. partez d'un volume vierge, mettez les **deux** variables → admin créé ;
  2. **relancez** (`docker compose up -d`) en laissant les variables → journal
     « déjà présent », et **l'ancien mot de passe fonctionne toujours** ;
  3. sur un volume vierge, ne mettez **qu'** une des deux variables →
     avertissement, et la route `/api/gds/setup` répond encore (aucun admin) ;
  4. *(cas de **protection**, à forcer à la main — pas un cas normal)* placez
     dans la base un compte **non administrateur** portant l'e-mail choisi (aucun
     administrateur n'existe alors), puis mettez cet e-mail dans
     `GDS_ADMIN_EMAIL` et relancez → l'échec est journalisé (l'e-mail est déjà
     pris) et `/api/gds/health` répond toujours. Le code prévoit ce cas (l'e-mail
     est **unique** en base) ; il ne peut **pas** arriver par l'interface,
     puisque seuls l'amorçage et la route `/api/gds/setup` créent des comptes, et
     tous deux créent un administrateur.

     ```powershell
     # « $$…$$ » = texte littéral PostgreSQL (évite les guillemets simples dans
     # la commande imbriquée) ; remplacez l'e-mail par celui de votre test.
     docker exec pilot-gds sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "INSERT INTO users (email, role, status) VALUES (\$\$X@exemple.com\$\$,\$\$standard\$\$,\$\$active\$\$)"'
     ```

### 1.7 — ⚠️ (facultatif) Ouvrir l'accès depuis un autre appareil

> Sautez cette étape si vous n'utilisez le GDS que depuis le poste serveur.
> Aucune commande réseau n'est lancée par Pilot : **c'est vous qui les lancez**.

- **Dans le terminal, vous faites :**

  ```powershell
  tailscale ip -4                   # affiche l'adresse 100.x.y.z du poste
  ```

  **Vous voyez :** une adresse qui commence par **`100.`**. C'est la seule
  valeur à recopier ensuite (elle est affichée, pas à deviner) : elle remplacera
  `100.x.y.z` dans le bloc du fichier `.env`.

- **Dans le fichier `.env`, vous faites :** dé-commentez (retirez le `#` en tête)
  le bloc « profil L2.9 » et mettez **l'adresse affichée** sur les deux lignes
  `GDS_DB_BIND_ADDR` et `GDS_SSH_BIND_ADDR` ; laissez
  `GDS_HTTP_BIND_ADDR=127.0.0.1` tel quel :

  ```dotenv
  GDS_HTTP_BIND_ADDR=127.0.0.1      # admin : poste uniquement (+ Tailscale Serve)
  GDS_DB_BIND_ADDR=100.x.y.z        # base : réseau privé uniquement
  GDS_SSH_BIND_ADDR=100.x.y.z       # dépôts git : réseau privé uniquement
  ```

- **Dans le terminal, vous faites :**

  ```powershell
  docker compose up -d
  docker compose ps
  tailscale serve --bg --https=443 http://127.0.0.1:8080   # 8443 si Pilot utilise déjà 443
  tailscale serve status
  ```

- **Vous voyez :** `docker compose ps` affiche l'état des ports sous la forme
  `127.0.0.1:8080->8080/tcp` et `100.x.y.z:2222->22/tcp`,
  `100.x.y.z:5432->5432/tcp` ; `tailscale serve status` affiche une adresse
  `https://…ts.net/`.
- **Si ce n'est pas ça :** une adresse d'écoute en `0.0.0.0` → le bloc n'a pas
  été pris en compte (vérifiez qu'il n'est plus commenté) ; `tailscale funnel`
  est **interdit**, ne l'utilisez pas.
- **Conséquence à retenir :** la base n'écoute plus que sur l'adresse Tailscale,
  donc **le poste lui-même** s'y connecte par cette adresse : dans Pilot, le
  champ **Hôte PostgreSQL** devient l'adresse affichée par `tailscale ip -4`
  (ou le nom MagicDNS), **pas** `localhost`.

### 1.8 — Vérifier depuis l'autre appareil

- **Sur l'autre appareil, vous faites :** trois commandes. Elles utilisent deux
  valeurs : l'adresse Tailscale du poste (affichée **sur le poste** par
  `tailscale ip -4`) et le nom du poste (affiché par `tailscale serve status`,
  sur le poste également).

  ```powershell
  curl https://NOM-DU-POSTE.ts.net/api/gds/health
  git ls-remote ssh://git@ADRESSE-TAILSCALE:2222/srv/git/repos/mon-projet.git
  psql -h ADRESSE-TAILSCALE -p 5432 -U pilot -d pilot_gds -c "select 1"
  ```

- **Vous voyez :** le JSON de santé ; la liste des références du dépôt (si le
  dépôt n'existe pas encore, l'erreur « repository not found » est **normale**) ;
  la ligne `1`.
- **Si ce n'est pas ça :** « connection timed out » → mauvais tailnet, ou ports
  restés sur `GDS_BIND_ADDR` : revoyez **1.7** (`tailscale status` doit lister
  les deux appareils).

### 1.9 — Le dépôt d'un projet se crée tout seul 🅰

- **Vous faites :** rien côté serveur. Le dépôt est créé par le service après
  « Ajouter ce projet au GDS » (**Partie 2, étape 2.6**).
- **Vous voyez :** il apparaît **dans les 30 secondes**.
- **Pour le vérifier, dans le terminal, vous faites :**

  ```powershell
  docker compose logs gds | Select-String "bare"
  docker exec pilot-gds ls /srv/git/repos
  ```

  **Vous voyez :** la ligne `gds-server : dépôts bare créés : NOM-DU-PROJET.git`,
  puis le dossier `NOM-DU-PROJET.git`.
- **Si ce n'est pas ça :** rien encore → « Ajouter ce projet au GDS » n'a pas
  abouti (**2.6**).

**Fin de la partie 1 — point de contrôle global :**

- [ ] le service est **healthy**, `/api/gds/health` répond, un administrateur
      existe, et (si demandé) l'accès distant répond depuis l'autre appareil.

---

# PARTIE 2 — L'USAGE (dans Pilot, par chaque personne)

> **Toute cette partie se fait dans l'application Pilot**, à la souris. Les
> trois onglets utilisés sont ceux de la barre d'outils : **« 🌐 GDS »** (rattaché
> au projet ouvert), **« 🖥️ GDS Serveur — administration »** et
> **« ⚙️ GDS — paramétrage »** (indépendants du projet).

### 2.1 — Ouvrir l'écran d'administration et se connecter

- **Dans Pilot, vous faites :** cliquez sur le bouton **« GDS Serveur »** de la
  barre d'outils (l'onglet **« 🖥️ GDS Serveur — administration »** s'ouvre, même
  sans projet). Bloc **« Connexion serveur »**, remplissez **Adresse du
  serveur** = `127.0.0.1`, **Port HTTP** = `8080`, **Email administrateur** et
  **Mot de passe administrateur**, puis **Tester la connexion**.
- **Vous voyez :** la version du serveur et son état s'affichent : **Connecté**,
  avec la version, les migrations, le nombre de comptes, de projets et de dépôts.
- **Si ce n'est pas ça :** un mot de passe faux est **refusé** (message
  d'erreur) ; et si vous lisez `password authentication failed for user "pilot"`,
  **ce n'est pas le mot de passe** : c'est le **piège du port** (encadré en tête
  du document).

### 2.2 — Créer un compte développeur et lui attribuer un projet

> Pour une personne **autre que vous**. Si vous êtes seul, sautez cette étape.

- **Dans Pilot, vous faites :** dans l'écran d'administration, bloc
  **« Comptes »** → créez un compte : **adresse e-mail**, rôle **Développeur**
  (`dev`) ou **Standard**, **mot de passe initial**. Puis bloc
  **« Dépôts / projets »** → associez le projet à ce développeur.
- **Vous voyez :** le compte apparaît dans la liste, état **Actif** par défaut ;
  le projet est attribué. Transmettez à la personne son e-mail et son mot de
  passe initial.
- **Si ce n'est pas ça :** le développeur ne voit pas le projet dans
  **« ⚙️ GDS — paramétrage » → Mes projets GDS** → l'association n'a pas été
  faite : refaites la seconde moitié de l'étape.
- **Test à faire :** désactivez le compte → la connexion est refusée ; réactivez
  → elle remarche. Le **dernier administrateur actif** ne peut **pas** être
  désactivé (le serveur refuse) : vérifiez le refus.

### 2.3 — Renseigner son identité (une seule fois)

- **Dans Pilot, vous faites :** onglet **« ⚙️ GDS — paramétrage » → Mon
  identité** : renseignez votre **Email (identité globale)** et votre **Nom
  git**, puis **Enregistrer l'identité**.
- **Vous voyez :** les champs sont mémorisés ; les écrans suivants ne les
  redemandent plus (ils sont pré-remplis).
- **Si ce n'est pas ça :** les boutons « enregistrer ma clé » et « ajouter le
  projet au GDS » restent bloqués → c'est que l'e-mail n'est pas enregistré :
  revenez ici. L'e-mail saisi doit être **celui du compte** créé en **2.2** (ou
  le vôtre si vous êtes seul).

### 2.4 — Enregistrer sa clef SSH (une seule fois par poste)

- **Dans Pilot, vous faites :** **« ⚙️ GDS — paramétrage » → Mes clés** :
  **Copier la clé publique**, puis **Enregistrer ma clé sur le serveur GDS**.
- **Vous voyez :** la confirmation d'enregistrement. Le serveur reprend la liste
  **toutes les 30 secondes** : inutile de redémarrer quoi que ce soit.
- **Si ce n'est pas ça :** après 30 secondes, une commande `git ls-remote` en SSH
  qui demande un mot de passe ou répond `Permission denied (publickey)` → la
  clef n'a pas été enregistrée, ou l'attente de 30 s n'est pas écoulée ; refaites
  l'étape.

### 2.5 — Mémoriser le serveur dans Pilot

- **Dans Pilot, vous faites :** onglet **« ⚙️ GDS — paramétrage » → Serveurs
  GDS** → **Ajouter un serveur** : **Hôte** `127.0.0.1`, **Port** `5432` (ou
  `55432` après la correction du piège du port), **Utilisateur PostgreSQL**
  `pilot`, **Mot de passe dédié** = la valeur de la ligne `POSTGRES_PASSWORD` du
  fichier `.env`, **Mot de passe admin GDS** = celui du compte administrateur →
  **Tester la connexion** → **Ajouter le serveur**.
- **Vous voyez :** le serveur apparaît dans la liste (« 1 serveur mémorisé ») et
  la connexion PostgreSQL a été testée **avant** l'enregistrement.
- **Si ce n'est pas ça :** le test refuse → « Hôte » et « Port » de la **base**
  (pas de l'interface web), mot de passe dédié = `POSTGRES_PASSWORD` ; si le
  message est `password authentication failed`, revoyez le **piège du port**.

### 2.6 — Rattacher un projet au serveur

Tout se passe dans l'onglet **« 🌐 GDS »** du projet (bouton **GDS** du panneau
**Vues**). L'en-tête affiche un badge : **« ○ À configurer »**,
**« ● En attente »** ou **« ● Connecté »** ; seuls les blocs utiles s'affichent.

- [ ] **2.6.a Connecter un serveur** : choisissez le serveur mémorisé
      (sélecteur **« Serveur mémorisé »**, bouton **« Réutiliser ce serveur »**)
      ou saisissez-le : **Hôte PostgreSQL** = `127.0.0.1`, **Port** = `5432`
      (ou `55432` si vous avez corrigé le piège du port), **Utilisateur dédié**
      (`pilot`), **Mot de passe dédié** (= la ligne `POSTGRES_PASSWORD` du
      fichier `.env`), **Mot de passe admin** (= celui du compte
      administrateur).
      **Vous voyez** les champs remplis ; les blocs suivants (2.6.b → 2.6.e)
      deviennent accessibles. **Si ce n'est pas ça :** le serveur mémorisé
      n'apparaît pas dans le sélecteur → mémorisez-le d'abord (**2.5**).
- [ ] **2.6.b Enregistrer la configuration** : mémorise **sans rien créer**.
      **Vous voyez :** le bouton confirme, et **rien** n'apparaît encore côté
      serveur. **Si ce n'est pas ça :** un message de configuration manquante →
      complétez les champs de 2.6.a puis recommencez.
- [ ] **2.6.c Renseigner** **Port SSH du serveur** = `2222`, **Racine des
      dépôts serveur** = `/srv/git/repos` et, si besoin, le **Dossier local de
      clonage**. **Vous voyez :** au clic suivant,
      « Racine des dépôts serveur non renseignée » ne doit **plus** apparaître.
- [ ] **2.6.d Activer GDS** : met le projet en relation avec le serveur (vérifie
      ou crée ce qui manque). **Vous voyez :** le badge passe à l'état attendu.
      **Si ce n'est pas ça :** un mot de passe manquant plus tard se règle par
      **« Enregistrer les mots de passe »** — **sans** refaire l'activation et
      **sans** recréer la base.
- [ ] **2.6.e Ajouter ce projet au GDS** : crée le dépôt bare sur le serveur,
      ajoute le raccourci `gds` (sans toucher à un `origin` existant, p. ex.
      GitHub) et **pousse la branche courante**.
      - **Vous voyez :** badge **« ✅ Déjà ajouté »**, bouton d'ajout masqué ; le
        dépôt apparaît côté serveur en moins de 30 s (voir **1.9**).
      - **Pour vérifier, dans le terminal :**

        ```powershell
        docker exec pilot-gds ls /srv/git/repos
        ```

        **Vous voyez** le dossier `NOM-DU-PROJET.git`. Côté projet, `git remote -v`
        montre le raccourci `gds`.
      - **Si ce n'est pas ça :** le `push` initial échoue dans la fenêtre des
        30 s → **relancez simplement « Ajouter ce projet au GDS »** (l'opération
        est idempotente, elle ne casse rien).

### 2.7 — Récupérer un projet qui n'existe pas encore chez soi 🅰

- **Dans Pilot, vous faites :** menu des **projets** → **« Ajouter un projet
  depuis le GDS »** → dans la liste, choisissez le dépôt → **« Ramener en
  local »** (le clone), ou **« Connecter ce dossier au GDS »** si le dossier
  existe déjà sur ce poste.
- **Vous voyez :** le projet local s'ouvre, **déjà connecté**.
- **Si ce n'est pas ça :** « Le GDS n'est pas connecté pour ce projet » → le
  projet courant doit d'abord être activé (**2.6**) ; « Aucun dépôt enregistré
  sur le serveur GDS » → aucun projet n'a encore été ajouté (**2.6.e**).

### 2.8 — Le travail quotidien : synchroniser, publier

- **Dans Pilot, vous faites :** bouton **« Synchroniser »** (dans l'onglet
  **« 🌐 GDS »**, ou **« ⚙️ GDS — paramétrage » → Mes projets GDS**).
- **Vous voyez :** les nouveautés d'un collègue arrivent dans votre copie.
- **Point à retenir :** **Synchroniser ne publie pas** vos propres
  modifications. Pour publier, **vous** poussez votre branche vers le raccourci
  `gds` (terminal intégré de Pilot ou votre outil git habituel) : vos commits ne
  partent **jamais** tout seuls.

### 2.9 — Les rôles : vérifier les refus attendus

| Rôle | Doit pouvoir | Doit être **refusé** |
|---|---|---|
| **Administrateur** (`admin`) | gérer comptes + dépôts, publier et forcer le suivi sur **tous** les projets, redémarrer/arrêter le **service** | — |
| **Développeur** (`dev`) | publier et forcer le suivi des projets **attribués**, récupérer **tous** les projets en lecture | gérer les comptes/dépôts ; publier un projet **non attribué** |
| **Standard** (`standard`) | consulter et récupérer en lecture | publier quoi que ce soit |

- **Dans Pilot, vous faites :** connectez-vous successivement avec un compte
  `dev` non attribué à un projet, puis un compte `standard` (écran
  d'administration → **Connexion serveur**).
- **Vous voyez :** la publication est **refusée**, avec un message d'erreur.
- **Pour vérifier la trace, dans Pilot :** écran d'administration, bloc
  **« Espace utilisé + journal des connexions »**, portée **Tout le journal** —
  **vous voyez** une action avec `ok = false` (et, pour la publication forcée
  refusée, l'action `tracking.force.denied`).

### 2.10 — Le suivi partagé et les conflits (sans verrou)

- **Dans Pilot, vous faites :** depuis deux postes, modifiez le **suivi
  partagé** (un projet, une tâche, une décision) sur le **même** élément, puis
  **Synchroniser** des deux côtés.
- **Vous voyez :** personne n'est bloqué (il n'y a plus de verrou de projet). La
  règle est « **le dernier qui écrit gagne** » : la dernière écriture
  **remplace** la précédente.
- **Pour vérifier la trace, dans Pilot :** journal d'audit du serveur (bloc
  « Espace utilisé + journal des connexions », portée *Tout le journal*) —
  **vous voyez** l'action `tracking.conflict` : le conflit n'est **jamais**
  silencieux. Le **code**, lui, suit git normalement (récupérez avant de
  commencer, poussez tôt).

### 2.11 — Contrôler le service depuis Pilot (rôle `admin`)

- **Dans Pilot, vous faites :** écran d'administration → **« Contrôle du
  service »** → **« Redémarrer le service »**, puis **« Arrêter le service »**
  (double confirmation demandée).
- **Vous voyez :** les deux processus `gds-server` et `sshd` sont relancés /
  arrêtés ; **PostgreSQL continue de tourner** (données et suivi intacts) ;
  l'écran attend le retour de la santé tout seul.
- **Pour vérifier, dans le terminal** (cas « arrêt » : il faut redémarrer le
  service) :

  ```powershell
  docker compose restart gds
  # ou, sans toucher au conteneur :
  docker exec pilot-gds supervisorctl -c /etc/gds/supervisord.conf start gds-server sshd
  ```

  Après un **redémarrage**, l'écran liste les trois programmes internes
  (`postgres`, `sshd`, `gds-server`) avec un **PID neuf** pour `gds-server` ;
  après un **arrêt**, la route ne répond plus. Chaque action acceptée (ou
  refusée) laisse une trace **persistante** dans le journal d'audit
  (`service_restart` / `service_stop`).
- **Si ce n'est pas ça :** l'écran ne répond pas après un arrêt → relancez le
  service avec la commande ci-dessus.

### 2.12 — Retirer un projet du GDS

- **Dans Pilot, vous faites :** onglet **« 🌐 GDS »** → **« Retirer du GDS »**
  (confirmation). Ne cochez la **purge** côté serveur que si vous le voulez
  vraiment.
- **Vous voyez :** le projet redevient **100 % local** ; avec la purge, les
  données serveur du projet sont retirées.
- **Pour vérifier, dans le terminal :**

  ```powershell
  docker exec pilot-gds ls /srv/git/repos
  ```

  Sans la purge, le dépôt existe **toujours** ; avec la purge, il a disparu. Le
  projet local, lui, **n'est jamais** supprimé.

---

# PARTIE 3 — À PLUSIEURS (le test final)

> Deux postes, deux personnes. Sur chaque poste : Pilot ouvert sur le projet,
> onglet **« 🌐 GDS »** accessible.

### 3.1 — Deux personnes publient des commits différents

- **Dans Pilot, vous faites :** sur le poste A, modifiez un fichier et
  committez, puis poussez vers `gds` (terminal intégré de Pilot ou votre outil
  git habituel). Sur le poste B (déjà à jour), cliquez **Synchroniser** dans
  l'onglet **« 🌐 GDS »**.
- **Vous voyez :** B reçoit la modification de A.
- **Si ce n'est pas ça :** rien n'arrive → sur B, vérifiez que le badge est
  **« ● Connecté »** (sinon **2.6**) et que `git remote -v` montre le raccourci
  `gds`.

### 3.2 — Deux personnes modifient le **même** fichier

- **Dans Pilot, vous faites :** A et B modifient le **même** fichier sans se
  synchroniser, puis poussent / synchronisent.
- **Vous voyez :** le **git standard** s'applique — soit la poussée de B est
  refusée (« non fast-forward », à tirer puis fusionner), soit un conflit de
  fusion apparaît.
- **Si ce n'est pas ça :** aucune donnée n'est écrasée silencieusement ; le
  conflit est **visible** (message git) et se résout avec les gestes git
  habituels.

### 3.3 — Deux personnes modifient le **suivi** en même temps

- **Vous faites :** voir **2.10** : le dernier qui écrit gagne.
- **Vous voyez :** la ligne `tracking.conflict` dans le journal du serveur
  (**2.10**).
- **Si ce n'est pas ça :** aucune trace de conflit → les deux postes n'ont pas
  modifié le **même** élément, ou la synchronisation n'a pas été faite des deux
  côtés.

### 3.4 — Le serveur tombe : le local continue

- **Dans Pilot, vous faites :** sur un poste connecté, **arrêtez le service**
  (**2.11**) ou débranchez le serveur, puis ouvrez le projet et travaillez.
- **Vous voyez :** Pilot **n'est pas bloqué** : le local reste la référence ;
  tout ce qui a bougé se **resynchronise** au retour du serveur.
- **Si ce n'est pas ça :** au retour du service, une synchronisation fait
  converger les deux côtés (et un conflit éventuel est journalisé, cf. 2.10).

### 3.5 — Vérifier que rien n'a fui côté sécurité

- **Dans le terminal, vous faites :**

  ```powershell
  docker compose ps                    # adresses d'écoute réellement publiées
  Get-NetTCPConnection -LocalPort 8080,2222,5432 -State Listen |
    Select-Object LocalAddress, LocalPort, OwningProcess
  tailscale serve status
  ```

- **Vous voyez :** `8080` sur `127.0.0.1`, et `5432`/`2222` sur l'adresse
  privée (`100.x.y.z`) — **jamais** l'adresse de la box, **jamais** `0.0.0.0`
  si vous avez appliqué **1.7**.
- **Si ce n'est pas ça :** une porte écoute sur une adresse publique ou
  `0.0.0.0` → revenez à **1.7** (et rappelez-vous qu'aucune des trois portes ne
  doit être joignable depuis Internet ; `tailscale funnel` est **interdit**).

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
>
> **Ce tableau explique** ce que le démarrage fait à votre place : ce ne sont
> **pas** des gestes à recopier. Les rares valeurs notées `<…>` y sont des
> **noms génériques** (ce ne sont donc pas des choses à retrouver) :
>
> | Notation | Ce que c'est |
> |---|---|
> | `<POSTGRES_PASSWORD>` | la valeur de la ligne `POSTGRES_PASSWORD` du fichier `.env` |
> | `<plage>` | l'adresse affichée par `tailscale ip -4` (voir **1.7**) |
> | `<projet>` | le nom du dossier du projet (celui du dépôt bare) |
> | `<nouveau mot de passe>`, `<chemin>` | **vous** les choisissez |
> | `…` dans la ligne 8 | la commande complète est donnée en **1.6.a** |

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
| `rm -rf` du dossier d'un dépôt dans `/srv/git/repos/` (dans le conteneur) | historique git du projet perdu | ❌ non |
| changer `POSTGRES_PASSWORD` après le premier démarrage | **n'est pas appliqué** à la base existante : le service ne peut plus s'y connecter | ⚠️ oui, à la main (voir ci-dessous) |
| `tailscale serve reset` | retire **toutes** les publications Tailscale du poste, **y compris l'accès web distant de Pilot** | oui, à republier |
| `git push --force` depuis un poste | écrase l'historique du dépôt (git standard) | ⚠️ souvent non |
| `docker compose pull` | inutile (image **locale** : aucun registre) — ne « met » rien à jour | — |
| supprimer un compte `admin` « en trop » | si c'est le **dernier** admin actif, le serveur refuse | — |

**Réparer un mot de passe PostgreSQL changé à tort** (le mot de passe du rôle
est fixé à la création) :

```powershell
# Le mot de passe est lu DANS le conteneur : il vient de la ligne
# POSTGRES_PASSWORD du fichier .env (env_file du docker-compose). Rien à
# recopier, et aucun mot de passe n'apparaît dans l'historique du terminal.
docker exec pilot-gds sh -c 'echo "ALTER ROLE pilot WITH PASSWORD ''$POSTGRES_PASSWORD'';" | psql -U postgres -f -'
docker exec pilot-gds sh -c 'echo "ALTER ROLE postgres WITH PASSWORD ''$POSTGRES_PASSWORD'';" | psql -U postgres -f -'
docker compose up -d          # le .env garde la même valeur : tout est cohérent
```

> La connexion locale au sein du conteneur passe par la **socket** (ouverte en
> `trust`), donc ces commandes fonctionnent **sans** saisir le mot de passe.
> **Non vérifié** (aucune commande n'a été lancée contre la base ici) : si un
> message d'erreur apparaît, retirez les guillemets simples autour de la valeur
> (mot de passe sans caractère spécial) ou utilisez l'ancienne forme
> `docker exec pilot-gds psql -U postgres -c "ALTER ROLE pilot WITH PASSWORD …"`
> avec la valeur recopiée depuis la ligne `POSTGRES_PASSWORD` du `.env`.

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
- **Le piège du port 5432 déjà occupé** : la **détection** a été **exécutée sur
  ce poste le 22/09/2026** (commande `Get-NetTCPConnection`, encadré en tête) et
  a montré le conflit réel — `postgres` du poste sur `127.0.0.1` **et** le
  conteneur GDS sur `0.0.0.0` ; en revanche la **correction** (décaler le port
  publié puis redéclarer le serveur dans Pilot) **n'a pas** été rejouée de bout
  en bout, et dépend de ce qui tourne **sur votre poste**.

---

# PARTIE 8 — DÉPANNAGE RAPIDE

| Symptôme | Où aller |
|---|---|
| `docker compose ps` reste `starting` | patienter (jusqu'à 2 min) ; `docker compose logs gds` |
| « mot de passe de la base … non défini » | remplir `POSTGRES_PASSWORD` dans `.env` (1.2), puis `docker compose up -d` |
| `password authentication failed for user "pilot"` | **c'est le piège du port** : voir l'**encadré en tête de ce document**, puis `docs/gds-server-setup.md` §5.1 |
| plusieurs lignes sur le port `5432` (dont `postgres`) | **piège du port** : détection et correction **en tête de ce document** |
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
