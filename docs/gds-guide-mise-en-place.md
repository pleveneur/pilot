# Guide GDS — mettre en place le serveur de sources, puis s'en servir

> Document d'utilisation — décrit, en deux parties, le parcours complet du
> **GDS** (gestionnaire de sources) de Pilot : **installer le serveur** (une
> fois, sur le poste qui l'héberge), puis **s'en servir** depuis Pilot (pour
> chaque personne qui travaille sur les projets).
>
> - **Partie 1 — côté serveur** : à faire **une fois**, par le propriétaire du
>   poste serveur.
> - **Partie 2 — côté utilisateur** : à faire par **chaque personne** qui
>   travaille sur les projets.
>
> **Statut : 🟡 Branche de travail** — rédigé sur la branche `gds-refonte-l2` de
> la refonte GDS. Rien de tout cela n'est encore dans la version installée de
> Pilot : la version publiée ne contient pas encore ces nouveautés.
> Spécification fonctionnelle : `spec_gds.md` ; mode d'emploi détaillé du
> serveur : `docs/gds-server-setup.md` ; référence du dossier serveur :
> `gds-server/README.md`.

**Vocabulaire utile** (une phrase chacun) :

- **GDS** : « gestionnaire de sources » — le serveur qui garde vos projets et
  l'historique de leur suivi au même endroit.
- **Conteneur** (ou « Docker ») : une sorte de mini-machine logicielle, déjà
  toute préparée, qu'on démarre d'une seule commande.
- **Base de données PostgreSQL** : le meuble de classement où le serveur range
  les comptes, les projets et le suivi.
- **Dépôt git** : le dossier qui contient l'historique des versions d'un projet.
- **SSH** (clef) : le mot de passe « long » qui prouve votre identité pour
  publier du code, sans saisir de mot de passe à chaque fois.
- **Réseau privé Tailscale** : un tunnel chiffré qui relie **vos** appareils
  entre eux, invisible depuis Internet.
- **API HTTP** : la « porte d'entrée » technique que Pilot utilise pour parler à
  l'interface d'administration du serveur.

---

# PARTIE 1 — CÔTÉ SERVEUR (à faire une fois)

C'est la partie « je prépare la machine qui héberge tout ». Elle se fait sur
**un seul poste** : celui du propriétaire.

> ⚠️ **Toutes les manipulations de cette partie sont à faire par vous.** Pilot
> n'exécute jamais ces réglages à votre place : les commandes `docker …` agissent
> sur la machine, les commandes `tailscale …` modifient sa configuration réseau.

> **Le pas-à-pas exact vit dans `docs/gds-server-setup.md`** (document de
> référence : prérequis, commandes, premier administrateur, accès par le réseau
> privé, pièges, dépannage). Ce guide n'en recopie pas les commandes : il en
> donne le fil, les règles à ne pas enfreindre, et la suite utilisateur
> (partie 2) qui n'existe nulle part ailleurs.

**Aucun serveur PostgreSQL ni serveur SSH n'est à installer sur le poste** :
ils sont déjà à l'intérieur du conteneur tout-en-un (dossier `gds-server/` du
dépôt Pilot).

## Le fil des opérations

Toutes les commandes `docker` se lancent **depuis le dossier `gds-server/`**,
dans **PowerShell**.

| Étape | Ce qu'il faut faire | Détail |
|---|---|---|
| 1 | Rassembler Docker Desktop (démarré) et, pour l'accès depuis un autre appareil, Tailscale (connecté). | `docs/gds-server-setup.md` §1 |
| 2 | Créer `.env` (`Copy-Item .env.example .env`) et y remplir **le seul secret obligatoire** : `POSTGRES_PASSWORD`. | §2.1 → §2.2 |
| 3 | Construire et démarrer : `docker compose up -d --build`, puis attendre l'état **`healthy`** (jusqu'à deux minutes au premier démarrage). | §2.3 |
| 4 | Créer le **premier compte administrateur** (route à usage unique, ou variables dans `.env` avant le premier démarrage). | §2.4 |
| 5 | Vérifier que le serveur tourne vraiment (interface `/api/gds/health`, puis la base). | §2.5 |
| 6 | *(facultatif)* Ouvrir l'accès depuis **un autre appareil** via le réseau privé Tailscale. | §3 |

La commande à retenir :

```powershell
cd G:\IA_PL\pilot\gds-server      # remplacer par votre chemin
docker compose up -d --build      # construit et démarre ; « healthy » = prêt
```

Après **toute** modification de `.env`, réappliquez par `docker compose up -d`.

> Les données, les dépôts et les clefs **survivent** à `stop`, `start`, `down`
> et `up` : ils vivent dans des volumes séparés du conteneur. **Seul
> `docker compose down -v` les détruit.** L'image est locale : une mise à jour se
> fait par **reconstruction** (`up -d --build`), jamais par `docker compose pull`.

## Les trois portes, et la règle à ne jamais enfreindre

Le serveur publie **trois portes** sur le poste. Chacune a un usage précis :

| Porte | Numéro | À quoi elle sert | Qui peut y entrer |
|---|---|---|---|
| Interface d'administration | **8080** | connexion au serveur, gestion des comptes, dépôts, journal | **le poste uniquement** (et, à distance, via Tailscale) |
| Base de données | **5432** | les synchronisations de projet, en direct | le poste, le réseau local, le réseau privé Tailscale |
| Dépôts git (SSH) | **2222** | publier et récupérer le code (clone / push) | le poste, le réseau local, le réseau privé Tailscale |

Concrètement : **rien d'obligatoire** si vous n'utilisez le serveur que depuis
le poste ; si Windows affiche une demande du **pare-feu** pour Docker, autorisez
les **réseaux privés** uniquement (jamais « public ») ; pour l'accès depuis un
autre appareil, passez par Tailscale (`docs/gds-server-setup.md` §3).

> ⛔ **Ce qui est INTERDIT** (ce n'est pas « déconseillé », c'est interdit) :
> - **ne jamais** rediriger ces ports depuis la box / le routeur (« NAT ») ;
> - **ne jamais** les publier par un service public (Cloudflare Tunnel, ngrok,
>   « Funnel » sans réseau privé, adresse IP publique…) ;
> - **ne jamais** remplacer l'adresse d'écoute par une adresse publique.
>
> Raison : les portes **5432** (base) et **2222** (dépôts) sont publiées **en
> clair, sans chiffrement**. Les ouvrir sur Internet reviendrait à publier le
> suivi de vos projets et tout l'historique de votre code. L'accès distant
> légitime passe par le **réseau privé Tailscale** (chiffré, réservé à vos
> appareils).

> **Conséquence à connaître** (profil Tailscale) : quand la base n'écoute plus
> que sur l'adresse Tailscale du poste, le poste lui-même s'y connecte **par
> cette adresse** (`100.x.y.z` ou le nom MagicDNS), et **non** `localhost`. C'est
> cette adresse qui se saisit dans le champ « Hôte PostgreSQL » de Pilot
> (voir partie 2, §3).

---

# PARTIE 2 — CÔTÉ UTILISATEUR (à faire par chaque personne)

C'est la partie « je branche mon Pilot sur le serveur et je travaille ».

## 1. Comment obtenir un compte

Un compte ne se crée **pas tout seul** : c'est l'**administrateur** qui le crée,
depuis Pilot, dans l'écran d'administration.

1. Dans Pilot, ouvrez l'écran **« 🖥️ GDS Serveur — administration »** (bouton de
   la barre d'outils) : cet écran s'ouvre **sans avoir besoin d'un projet**.
2. Dans le bloc **Connexion serveur**, saisissez l'adresse du serveur (l'hôte),
   son port, l'adresse e-mail de l'administrateur et son mot de passe, puis
   cliquez **Tester**. Vous devez voir la version du serveur et son état.
3. Ouvrez le bloc **Comptes** et **créez le compte** : adresse e-mail, **rôle**
   (`standard`, `dev` ou `admin`) et un **mot de passe initial**. Transmettez
   l'e-mail et ce mot de passe à la personne concernée.
4. Si le compte doit **publier du code**, attribuez-lui le projet : bloc
   **Dépôts / projets** → associer le projet au développeur. Un développeur ne
   peut publier que les projets **qui lui sont attribués**.

> Le compte est le plus souvent créé directement « actif ». L'administrateur peut
> ensuite **désactiver / réactiver**, **changer le rôle** ou **réinitialiser le
> mot de passe** d'un compte. Le **dernier administrateur actif ne peut pas être
> désactivé** (le serveur refuse) — c'est volontaire, pour ne jamais se
> retrouver enfermé dehors.

## 2. Comment se connecter

### a. Renseigner son identité (une seule fois)

Dans l'écran **« ⚙️ GDS — paramétrage »** (sans projet ouvert), section
**Mon identité** : votre **adresse e-mail** (elle identifie votre compte sur le
serveur) et votre **nom git**. Ces informations sont ensuite réutilisées partout
automatiquement — vous ne les ressaisirez plus.

### b. Enregistrer sa clef SSH (une seule fois par poste)

Toujours dans **« ⚙️ GDS — paramétrage »**, section **Mes clés** : affichez et
**copiez votre clef publique**, puis **enregistrez-la sur le serveur**. C'est
elle qui vous autorisera à publier / récupérer le code sans mot de passe.

> Le serveur reprend automatiquement la liste des clefs **toutes les 30
> secondes** : inutile de redémarrer quoi que ce soit.

### c. Mémoriser le serveur et son mot de passe

- Section **Serveurs GDS** : ajoutez le serveur (hôte, port), testez la
  connexion, et appliquez-le à un projet le moment venu.
- Les mots de passe saisis dans Pilot restent **sur votre poste**, dans un
  fichier protégé de votre utilisateur (`~/.pilot/gds_secrets.json`) : ils ne
  sont **jamais** écrits dans le projet ni envoyés ailleurs.

## 3. Comment rattacher un projet à un serveur

Tout se passe dans l'onglet **« 🌐 GDS »** du projet (bouton **GDS** du panneau
**Vues** de la barre latérale). L'en-tête affiche un badge d'état :
**« ○ À configurer »**, **« ● En attente »** ou **« ● Connecté »**.
Selon l'état, seuls les blocs utiles s'affichent.

**Si le projet est un projet existant chez vous :**

1. **Connecter un serveur GDS** : choisissez un **serveur mémorisé** (le
   sélecteur), ou renseignez un nouveau serveur — hôte, port, utilisateur dédié
   (par défaut `pilot`), **mot de passe dédié** (= le mot de passe de la base,
   `POSTGRES_PASSWORD` de la partie 1) et **mot de passe administrateur**.
2. **Enregistrer la configuration** : mémorise cette configuration **sans rien
   créer** sur le serveur. Utile pour vérifier avant d'agir.
3. Juste en dessous, renseignez **Port SSH du serveur** (`2222`), **Racine des
   dépôts serveur** (**`/srv/git/repos`**) et, si besoin, le **Dossier local de
   clonage**.
4. **Activer GDS** : met le projet en relation avec le serveur (et vérifie ou
   crée ce qui manque côté serveur). Si un mot de passe manque plus tard
   (changement de poste, secret perdu), le bouton **« Enregistrer les mots de
   passe »** suffit : **aucune nouvelle activation** n'est nécessaire, et la
   base du serveur n'est **jamais** recréée.
5. **Ajouter ce projet au GDS** : crée le dépôt du projet sur le serveur, ajoute
   un « raccourci » nommé `gds` dans votre projet local (sans toucher à un
   éventuel autre raccourci, par exemple GitHub) et **pousse la branche
   courante**. L'identité git du projet est réglée automatiquement depuis votre
   identité globale.

**Si le projet n'existe pas encore chez vous :** utilisez le menu **Projet** →
**« Ajouter un projet depuis le GDS »** : vous obtenez la **liste des dépôts du
serveur**, et vous pouvez en récupérer un (clone) puis ouvrir le projet local,
déjà connecté.

> Le dépôt côté serveur est créé **automatiquement** par le serveur dans les
> **30 secondes** qui suivent l'ajout : il n'y a **aucune** commande git à taper
> sur le serveur.

## 4. Les rôles, et ce que chacun a le droit de faire

| Rôle | Ce qu'il peut faire | Ce qu'il ne peut pas faire |
|---|---|---|
| **Administrateur** (`admin`) | gérer les **comptes** (créer, désactiver, changer le rôle, réinitialiser un mot de passe) et les **dépôts** ; publier et forcer le suivi sur **tous** les projets ; redémarrer ou arrêter le **service** du serveur | — |
| **Développeur** (`dev`) | publier et forcer le suivi des projets **qui lui sont attribués** ; récupérer (clone / mise à jour) tous les projets en lecture | gérer les comptes ou les dépôts ; publier un projet qui ne lui est **pas** attribué |
| **Standard** (`standard`) | **consulter** les projets et les récupérer en lecture | publier quoi que ce soit ; publier du suivi |

En clair : **administrateur** = le chef de la maison, **développeur** = publie
sur ses projets, **standard** = regarde sans modifier.

## 5. Ce qui se passe si deux personnes modifient la même chose

Le mécanisme de « verrou » qui empêchait deux personnes de travailler en même
temps sur un projet a été **supprimé** — c'était une décision assumée.

- **Deux personnes peuvent donc travailler en même temps** sur le même projet :
  personne n'est bloqué, personne n'est « mis à la porte » du projet.
- La règle est « **le dernier qui écrit gagne** » : la modification enregistrée
  en dernier **remplace** la précédente. Il n'y a **pas** de fusion automatique
  des deux versions.
- Les conflits **détectés** sur le suivi partagé ne sont jamais silencieux : ils
  sont **consignés dans le journal** du serveur (visibles par
  l'administrateur), sous l'action `tracking.conflict`.
- **Conséquence pratique** : pour le **code**, utilisez le réflexe git habituel —
  récupérez (`Synchroniser`) avant de commencer, et poussez tôt. Deux commits
  concurrents sur les **mêmes lignes** se disputent toujours le fichier : c'est
  le git standard qui s'applique.
- Un **développeur attribué** au projet (ou un administrateur) peut **forcer** la
  mise à jour du suivi côté serveur : sa version écrase alors l'état serveur.
  Un compte `standard` n'en a pas le droit (le refus est journalisé).

## 6. Ce que l'utilisateur doit faire lui-même après une modification

Voici le partage des rôles entre Pilot et vous, une fois le projet connecté :

| Après… | Qui s'en charge |
|---|---|
| la **création** du projet sur le serveur | Pilot : dépôt créé et branche poussée automatiquement lors de « Ajouter ce projet au GDS » |
| vos **propres modifications de code** | **vous** : vos commits ne partent **pas** tout seuls. Poussez votre branche vers le raccourci `gds` (depuis le terminal intégré de Pilot, ou votre outil git habituel) |
| la modification de code d'**un collègue** | **vous** : le bouton **Synchroniser** ne fait que **rapatrier** les nouveautés (récupérer) ; il ne publie pas vos travaux |
| le **suivi partagé** (projets, tâches, décisions) | Pilot : il est poussé / rapatrié lors d'une synchronisation, en « dernier qui écrit gagne » |
| l'ouverture d'un projet connecté | Pilot : une synchronisation est lancée automatiquement, sans blocage (si le serveur est injoignable, vous continuez à travailler localement) |
| le **serveur injoignable** | **vous** continuez à travailler : le local reste la référence, et tout ce qui a bougé se resynchronise au retour du serveur |
| **retirer** un projet du GDS | **vous** : bouton **Retirer du GDS** (avec confirmation). Le retrait peut aussi **purger** le côté serveur — à ne cocher que si c'est bien voulu |
| **redémarrer / arrêter le service** du serveur | l'**administrateur** : boutons dédiés dans l'écran « 🖥️ GDS Serveur — administration » (la base, elle, continue de tourner) |

> En résumé : **Pilot s'occupe du suivi et des opérations liées au serveur ;
> publier votre code reste votre geste** (pousser vos commits), exactement comme
> avec n'importe quel autre dépôt git.

---

# ENCADRÉ FINAL — ce qui est vérifié / ce qui n'a pas été testé

## ✅ Ce qui est vérifié

- **Le serveur se construit et se lance** : `docker compose up -d --build` sur un
  volume vide donne un serveur utilisable, avec la base, les migrations et les
  trois processus supervisés. C'est couvert par un **banc d'essai de bout en
  bout** livré avec le serveur (`gds-server/tests/e2e.sh`), qui rejoue le
  parcours complet sur un environnement **jetable** (compte administrateur,
  connexion, création d'un développeur, attribution d'un projet, enregistrement
  d'une clef SSH, `push` réel en SSH, journal, redémarrage du service, état de
  santé) puis supprime tout.
- **Les commandes, noms de ports, de volumes et de variables** de la partie 1
  sont ceux réellement écrits dans `gds-server/docker-compose.yml`,
  `gds-server/.env.example` et `gds-server/README.md`.
- **Les trois rôles** et la règle « dernier qui écrit gagne + conflits
  journalisés » sont **appliqués côté serveur** (contrôlés par des tests
  unitaires du socle partagé).
- **Les deux écrans transverses** et l'onglet par projet existent dans le code de
  Pilot (`gds-admin.js`, `gds-params.js`, `gds.js`) et ont leurs tests unitaires.
- **La procédure d'accès distant** (adresses d'écoute + `tailscale serve`) est
  décrite à l'identique dans `docs/gds-server-setup.md` et
  `gds-server/README.md`.

## ⚠️ Ce qui n'a pas été testé

- **La branche de travail n'est pas publiée** : ces nouveautés **ne sont pas**
  dans la version installée de Pilot. Il faut travailler sur la branche de la
  refonte GDS pour les voir.
- **Ce document n'a pas été exécuté de bout en bout par son rédacteur** : il a
  été écrit à partir du code et des documents du projet, **sans** démarrer le
  conteneur, **sans** lancer Pilot et **sans** lancer l'application. Les
  commandes sont celles du code, mais le parcours complet « depuis zéro, sur un
  poste vierge » **reste à dérouler par vous**.
- **La partie utilisateur n'est pas couverte par un test automatique** : les
  tests unitaires portent sur les morceaux testables des écrans et sur le
  serveur, **pas** sur un parcours complet « écran → serveur → dépôt git » piloté
  depuis l'interface graphique. Le « cliquer partout » reste manuel.
- **Le geste « pousser son code » (§6)** est déduit du code (Pilot ne pousse la
  branche qu'au moment de « Ajouter ce projet au GDS » ; le bouton Synchroniser
  ne fait que rapatrier). Il n'a pas été vérifié par un essai réel
  modification → push → reprise par un second poste.
- **Les cas « plusieurs personnes en même temps »** sont le comportement
  **annoncé** : la concurrence est assumée, mais aucun essai à deux postes
  simultanés n'a été réalisé ici.
- **Docker Desktop et Tailscale sur le poste** : ni l'un ni l'autre n'a été
  installé/vérifié par le rédacteur ; seule leur présence est exigée (partie 1).
- **Le piège du port 5432 déjà occupé** est un cas réel documenté dans le projet,
  mais il dépend de ce qui tourne **sur votre poste** : à vérifier chez vous.

---

# Documents liés

| Document | Ce qu'on y trouve |
|---|---|
| `docs/gds-server-setup.md` | **Le** mode d'emploi pas à pas du serveur (installation, accès réseau privé, pièges, dépannage). |
| `gds-server/README.md` | Référence rapide du dossier serveur (volumes, variables, service, banc d'essai). |
| `spec_gds.md` | Spécification fonctionnelle du GDS (rôles, synchronisation, écrans). |
| `help/overview.md` (§ `HELP:gds`) | L'aide intégrée de Pilot (résumé de ce guide dans l'onglet « ❓ Aide »). |
