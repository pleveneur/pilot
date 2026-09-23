# Spécification — GDS (Gestionnaire de Sources)

> Gestionnaire de sources centralisé pour les projets de **Kalico System** :
> sources git, suivi des projets, des demandes clients et des tickets, le tout
> dans **une base unique PostgreSQL**. Prérequis au composant web (issue #56,
> voir `spec_web_component.md`).
>
> **Statut : 🟢 Phases A + B + C1 (C1.1→C1.5) + C2 (C2.1→C2.3) implémentées,
> puis refonte GDS (lots L1→L6) implémentée.** Chaque chantier passe au
> **protocole quality-gate** (`.pi/skills/quality-gate/SKILL.md`) avant
> validation.
>
> **Refonte GDS (implémentée)** : le verrou global projet est **supprimé**
> (migration `0007_drop_project_locks.sql` ; « dernier qui écrit gagne » assumé,
> conflits journalisés — §5.1) ; le serveur est **conteneurisé** (un seul
> conteneur : PostgreSQL + sshd + service `gds-server` — §1.4) ; **trois rôles**
> (`admin` / `dev` / `standard`) sont appliqués par le serveur (§2.2) ; deux
> **écrans transverses** (ouverts SANS projet) ont été ajoutés : « 🖥️ GDS
> Serveur — administration » et « ⚙️ GDS — paramétrage » (§1.4).
>
> **Serveur Linux distant (implémenté)** : GDS utilisable avec un PostgreSQL +
> dépôts bare sur une **machine distante**, sans aucune administration à
> distance. Champs rétrocompatibles `ssh_port` / `gds_server_repos`, helper pur
> `is_local_host`, mode distant (clef SSH/DB + bare manuels, existence du bare
> vérifiée en base, aucune suppression distante), ressaisie de mot de passe sans
> re-provision, UI (port SSH, racine serveur, dossier local) — contrat détaillé
> §0.4 et §4.1. Procédure serveur + protocole de test :
> `docs/gds-server-setup.md`. Le mode **localhost reste strictement inchangé**.
>
> **Évolutions UX (implémentées)** : (1) **Mémoriser les connexions par serveur**
> — map `servers` dans `~/.pilot/gds_secrets.json` (clé `user@host`, mots de
> passe jamais remontés à l'UI), commandes `gds_list_saved_servers` /
> `gds_apply_server`, sélecteur « Réutiliser un serveur » en section 1 ;
> (2) **Bouton retirer du GDS** — commande `gds_remove_project(project,
> purge_server)` (retire remote `gds` + supprime `.pilot/gds.json` ; purge du
> bare `gds_git::remove_bare` + `gds_db::delete_project_by_name` uniquement si
> `purge_server=true`, jamais par défaut), section config de l'onglet GDS ;
> (3) **Bandeau connecté fiable** — commande `gds_connection_status(project)`
> (`connected` | `error` | `not_configured`, reconnexion effective + dépôt bare
> valide + remote `gds`), sidebar « - (GDS — liaison établie) » / « - (GDS —
> liaison à vérifier) » via `gds_status.js` (fail-open, `gds_enabled` respecté ;
> l'infobulle distingue l'**inscription sur le serveur** (`on_server`) de la
> **liaison du poste** : elle n'affirme « enregistré sur le serveur » que si
> `on_server` est vrai) ;
> (4) **Redessin UX (écran-état-machine, R1–R5)** — onglet GDS réécrit : badge
> d'état (« ● Connecté » / « ● Enregistré sur le serveur — liaison à vérifier »
> / « ● Liaison à vérifier » / « ○ À configurer », `gds_connection_status`),
> **Identité GLOBALE** (email + nom git) saisie une seule fois, pré-remplie
> partout (`gds_identity_prefs` / `gds_save_identity`, `~/.pilot/gds_secrets.json`
> 0600), plus aucun champ email dans l'interface simple, plus aucun
> `window.prompt` de nom git ; étape « Connecter un serveur GDS » (réutiliser un
> serveur mémorisé OU nouveau) → « Activer GDS » (`gds_provision`, email admin =
> identité globale) ; badge « ✅ Déjà ajouté » + bouton d'ajout masqué quand
> `on_server` (`gds_connection_status → on_server`) ; état connecté compact
> (synchro, retirer avec confirmation) ; **projet DÉJÀ rattaché à un serveur**
> (config `.pilot/gds.json` présente) mais liaison non vérifiée : écran
> **MINIMAL** — nom du **serveur choisi** (fiche mémorisée correspondante, sinon
> `utilisateur@hôte`), **deux faits distincts** (« ✅ Enregistré sur le
> serveur » / « ⚠️ Liaison de ce poste : à vérifier »), boutons **« Vérifier la
> liaison »** et **« Corriger la configuration »** (seul chemin d'édition des
> valeurs techniques : rouvre le formulaire d'activation pré-rempli, avec
> « Retour »), ajout si nécessaire, retrait — **aucun champ technique** (hôte de
> base, port SSH, racine des dépôts, dossier de clonage) sur l'écran normal et
> **aucune écriture de configuration** hors de ce mode correction (valeurs lues
> de `.pilot/gds.json` par le backend) ; le formulaire complet est réservé à
> l'ACTIVATION ou à cette correction ; badge de liste
> « Enregistré sur le serveur — liaison à vérifier » (`gds-params.js`, constat 2)
> ; **bloc « ▶ Avancé » supprimé** (il ne répétait que les mêmes valeurs en
> lecture seule) ; les listes serveur « projets & dépôts » ont été retirées de
> l'onglet par projet (refonte L5.6) et vivent dans l'onglet « GDS —
> administration » et dans « ⚙️ GDS — paramétrage » → Mes projets GDS ; **auto-provisionnement background** à l'ouverture du projet
> (`gds_auto_provision` → `auto_provision_pool`, fail-open, jamais bloquant,
> n'écrase jamais un projet déjà lié) ; R5 pleine largeur + multi-colonnes
> (`gds-cols`).
>
> **Liste de serveurs GDS (5 lots, implémenté)** — la fiche serveur porte
> désormais un **nom** (obligatoire, court) et une **description** (facultative) :
> `name` / `description` / `last_test_at` / `reachable` sont ajoutés à
> `ServerCredentials` (`~/.pilot/gds_secrets.json`, **`#[serde(default)]`** : une
> fiche héritée sans nom reste lisible et s'affiche avec son ancienne
> identification `user@host:port`) ; `gds_add_saved_server` / `
> gds_update_saved_server` les acceptent, `gds_test_saved_server` **mémorise**
> la date et la joignabilité, `list_saved_servers` les remonte (jamais de mot de
> passe). « Appliquer » **conserve** le port SSH et la racine des dépôts déjà
> configurés dans le projet visé et permet de **choisir le projet cible dans une
> liste** ; « Détacher » est **explicite** (travail conservé côté serveur par
> défaut, retrait serveur proposé en option) ; l'écran d'administration propose
> un **sélecteur** de serveur mémorisé au lieu d'un pré-remplissage silencieux.
>
> **Fiche « compte GDS » (lot 1 de la refonte « mon compte remplace le compte
> technique », implémenté)** — la fiche serveur de « ⚙️ GDS — paramétrage »
> décrit désormais **votre compte GDS** : `host`, `http_port` (8080),
> `gds_email`, `gds_role`, `gds_password` et `identity` sont ajoutés à
> `ServerCredentials` (**`#[serde(default)]`** : toute fiche antérieure reste
> lisible et utilisable, **aucun secret effacé**, aucun doublon) ; `host` et
> `key_user` sont mémorisés explicitement, la clé `user@host` restant ambiguë
> pour une adresse e-mail (repli legacy sur le parsing de la clé). Le test
> s'appuie sur le **compte utilisateur** — `POST /api/gds/users/login` via la
> commande `gds_identity_login` (`gds_admin::perform_identity_login`) : **tout
> rôle est accepté** (contrairement à `open_admin_session`), le **rôle reconnu
> est affiché en langage simple** et **ni le mot de passe ni le jeton ne
> remontent à l'UI**. `gds_add_saved_server` / `gds_update_saved_server`
> prennent l'identité (ajout = clé sur l'e-mail ; modification = clé inchangée,
> mot de passe vide conservé, changement d'adresse = renommage de clé) et
> `gds_test_saved_server` reste le test PostgreSQL des fiches héritées. «
> Appliquer » est **actif dès qu'une fiche porte une identité** (lot 4 : une
> fiche « compte GDS » n'utilise plus le compte technique de la base) et reste
> **inchangé** sur les fiches héritées.
>
> **Opérations projet par le SERVICE, avec le compte de l'utilisateur (lots 2
> à 4, implémentés)** — le poste ne parle plus à la base du GDS : pour ajouter
> un projet, synchroniser et publier le suivi, il appelle l'**API du service**
> (`POST /api/gds/users/login` pour un **jeton de session**, puis les routes
> §1.5) avec l'**identité du compte GDS** du projet — le **serveur** applique
> les gardes de rôle, crée le dépôt bare dans **sa** racine de dépôts et
> rattache la clef du poste au compte du jeton. La **base du serveur est
> préparée par le serveur** à son démarrage (`entrypoint.sh` : provision +
> migrations, idempotent) : le poste n'ouvre **plus aucun pool PostgreSQL**, ne
> connaît **plus le compte technique** (utilisateur / mot de passe dédiés) et
> n'a **aucun secret de base** à saisir. Client : `src-tauri/src/gds_service.rs`
> (`resolve_service_identity` / `pick_identity` — identité choisie sur l'hôte du
> projet et l'e-mail du compte, **jamais** celle d'un autre compte ou d'un autre
> serveur, cache de jeton par couple serveur|compte) ; `gds::resolve_server_side`
> / `optional_pool` prennent la voie **Service** dès qu'une identité est
> mémorisée, **sinon** le repli **hérité** reste strictement inchangé (connexion
> base + compte technique) pour que les serveurs déjà déclarés restent
> utilisables **sans rien ressaisir**.
>
> **Implémenté (Phase A, bloc serveur + UI desktop)** : dépendances PostgreSQL (sqlx +
> tokio-postgres), migration `migrations/0001_init.sql` (users, projects,
> project_members, git_repos, audit_gds), `gds_db.rs` (pool, provision
> idempotent, migrate, CRUD), `gds.rs` (config `.pilot/gds.json`, commandes
> `gds_provision` / `gds_validate_user` / `gds_add_project` / `gds_get_config` /
> `gds_save_config` / `gds_list_projects` / `gds_list_git_repos`), `gds_git.rs`
> (repo bare par projet, validation chemins), `gds_web.rs` (routes axum de base
> + routes B/C réservées). **UI desktop** : onglet « 🌐 GDS » (`src/js/gds.js`,
> bouton `btn-gds` dans la sidebar, branchement `tabs.js` mode `gds`) —
> provision serveur, config projet, ajout projet, listes projets/dépôts.
>
> **Implémenté (refonte GDS, lots L1→L6)** : serveur **conteneurisé**
> (`gds-server/`, §1.4), socle partagé `gds-core/` (base, git, ssh, http,
> rôles), **rôles** `admin` / `dev` / `standard` (migration `0006_roles.sql`,
> `roles.rs`), **verrou projet retiré** (migration `0007_drop_project_locks.sql`
> — plus aucune commande ni route de verrou, plus de mode urgent). La
> synchronisation poste (`gds_client.rs` : clone/fetch/pull, remote `gds`) et le
> pont de suivi (`gds_sync.rs`) sont **conservés sans verrou**. **UI desktop** :
> onglet par projet « 🌐 GDS » (Synchroniser, Retirer du GDS) + deux écrans
> transverses (« 🖥️ GDS Serveur — administration », « ⚙️ GDS — paramétrage »).
>
> **Arbitrages utilisateur intégrés (11/11)** : cf. §0.2 + §0.4.
> **Décision du 29/08/2026 (non négociable)** : le GDS est **activé par
> projet** (config `.pilot/gds.json`, aucun serveur par défaut) — cf. §0.4.

---

## 0. Synthèse

### 0.1 But final

Remplacer **GitHub** par un **équivalent interne** pour les projets de Kalico
System : sources centralisées, suivi des projets, des demandes clients et des
tickets, dans **une base unique PostgreSQL**. Le GDS est le **prérequis** au
composant web (issue #56) : on ne construit pas le composant web avant que le
GDS (sources centralisées + suivi fusionné dans PostgreSQL) ne soit en place et
stable.

### 0.2 Arbitrages utilisateur (11/11) — à respecter strictement

| # | Sujet | Décision |
|---|---|---|
| 1 | **Migration suivi SQLite → PostgreSQL** | **Option A** : Postgres = source de vérité **quand connecté au GDS** ; SQLite local = vérité **sinon**. Ajout d'un **mode déconnecté** (cf. §7). La **publication forcée** du suivi est réservée à un compte habilité (`admin`, ou `dev` attribué au projet) — cf. §6.3. |
| 2 | **Transport git poste ↔ VPS** | **SSH par clef liée à l'email** du dev. |
| 3 | **Hébergement** | Démarrer par le **GDS interne sur le poste fixe via Tailscale** (pas de VPS pour l'instant). Le VPS n'est nécessaire que pour le **widget public** plus tard. **Dès le V1**, le code doit permettre de configurer un **serveur PostgreSQL distant via IP publique ou URL http/https** — l'architecture supporte **Postgres local OU distant** dès le départ. |
| 4 | **Format du widget** | **`<iframe>`** avec isolation complète (marque + sécurité). Le widget est un **petit bot par projet** développé via Pilot, qui répond aux questions de l'utilisateur (manuel + aide d'utilisation du logiciel) et assure le **suivi de ses demandes et bugs**. Les demandes utilisateur doivent être **validées par un dev** avant d'être ajoutées aux évolutions du projet. |
| 5 | **Comptes utilisateurs finaux** | **Invitation par le site client** (comptes administrés par Kalico), avec **flux d'inscription via le bot** : demande d'accès sur le site → le bot collecte les infos → **validation par code envoyé par email** → compte actif. Une fois connu, l'utilisateur pose des questions (aide) et demande corrections/évolutions. Le bot **cible bien le besoin** avant de créer une issue en base. |
| 6 | **Mode urgent** | **Retiré** avec le verrou projet (décision 3 de la refonte). Le rôle `admin` remplace le « gestionnaire de verrous » ; personne n'a plus à passer outre un verrou. |
| 7 | **Visibilité des tickets des autres** | L'utilisateur voit **seulement ses propres tickets** + un **flux « problèmes en cours » filtré** (pas de lecture complète des tickets des autres). |
| 8 | **Assistant de groupe** | **Cloud (pi/plh)** pour l'instant, mais **moteur configurable côté serveur web** dès le départ. Plus tard : clients avec leurs propres APIs LLM ou comptes cloud Ollama (déjà utilisé par l'équipe Kalico). |
| 9 | **Sécurité remontée publique** | **Captcha** sur le formulaire de remontée + **garde-fous de base** (rate limiting + validation des contenus) **par défaut**. |
| 10 | **Sauvegardes** | Gérées par **l'utilisateur lui-même** (provision + `pg_dump` planifiés + monitoring). |
| 11 | **Activation GDS (décision 29/08/2026)** | Le GDS est **activé par projet** : chaque projet pointe vers son **propre serveur GDS**, configuré explicitement à l'activation. **Aucun serveur par défaut, aucune config globale** (cf. §0.4). |

### 0.3 Évolutions durables (hors périmètre V1 — à noter, pas à implémenter)

- **API systématique pour toute discussion base de données** (ouvrir le logiciel
  sur d'autres plateformes) — évolution future.
- **Mode déconnecté** (détaillé au point 1, §7) avec **résumés visuels au
  tableau de bord**.
- **Clients avec leurs propres APIs LLM / comptes Ollama** (point 8, §9.2).

### 0.4 Activation GDS par projet (décision du 29/08/2026 — non négociable)

- **Le GDS est activé par projet**, jamais globalement : l'activation est une
  décision **explicite** du dev, projet par projet.
- **La config GDS vit au niveau du projet**, dans **`.pilot/gds.json`** (fichier
  du projet, versionnable) : **activation on/off**, **URL du serveur GDS**,
  **identité** (email). Chaque projet pointe vers son **propre** serveur GDS ;
  deux projets peuvent viser deux serveurs différents.
- **Config simplifiée (UI)** : l'interface ne demande que l'**adresse du serveur**
  (`server_url`) et l'**email d'identité** (`identity_email`). L'hôte SSH
  (`ssh_host`, `host:<port>`) est **dérivé automatiquement** de `db_host`
  (prioritaire) ou de `server_url` à la sauvegarde (schémas `postgres://`,
  `http://`, `https://`, `ssh://`), et le dossier local de clonage
  (`gds_local_dir`) utilise le **défaut** `~/Pilot/GDS` (`C:\GDS` sous Windows).
  Le champ `ssh_host` reste présent dans `.pilot/gds.json` (compat) mais n'est
  **plus édité dans l'UI** ; le backend le **préserve** à la sauvegarde (pas de
  perte de données → réaffichage correct). Le champ historique `urgent_email`
  (ex-mode urgent) **n'existe plus** (retiré avec le verrou).
- **Serveur distant (chantier « serveur Linux distant »)** : deux champs
  **optionnels et rétrocompatibles** ont été ajoutés à `.pilot/gds.json` :
  - `ssh_port` (`u16`, absent ⇒ **22**) : port SSH du serveur GDS, utilisé pour
    construire l'URL du remote (`ssh://git@hôte:<ssh_port>/…`). `0` en entrée =
    « non fourni » ⇒ la valeur existante est **préservée** (idem pour les autres
    champs non envoyés par l'UI) ;
  - `gds_server_repos` (`Option<String>`, absent ⇒ `None`) : **racine absolue des
    dépôts bare CÔTÉ SERVEUR** (ex. `/home/git/repos`), utilisée uniquement pour
    un serveur **distant**.
  Un `.pilot/gds.json` écrit avant ce chantier se charge sans erreur (défauts
  serde) ⇒ port SSH 22 et aucune racine → **comportement historique inchangé**.
- **Serveur local vs distant** : `is_local_host(host)` (helper pur) décide du
  mode à partir de `db_host` (sinon de l'hôte de `server_url`) : `localhost`,
  `127.0.0.0/8`, `::1`, `0.0.0.0`, le **nom de la machine** (+ `.local`) et la
  valeur vide ⇒ **LOCAL** ; toute autre valeur ⇒ **DISTANT**. Le mode LOCAL garde
  un comportement **strictement inchangé** (voir §4.1).
- **Ressaisie de mot de passe sans re-provision** : `gds_save_config` accepte
  désormais deux arguments optionnels `db_password` / `admin_password`
  (`Option<String>`). Un mot de passe non vide est écrit **hors projet** dans
  `~/.pilot/gds_secrets.json` (0600) — **jamais** dans `.pilot/gds.json` ni dans
  un log ; un champ vide **préserve** le secret existant. L'UI expose un bouton
  « Enregistrer les mots de passe » : plus besoin de refaire « Activer GDS »
  (la base n'est jamais recréée). Les mots de passe ne **remontent jamais** à
  l'UI (seulement des booléens `gds_secrets_status`).
- **Aucun serveur GDS par défaut** et **aucune config GDS globale** de Pilot
  (pas de champ `gds_*` dans la config applicative). Sans activation, le projet
  reste 100 % local (cf. §7.1).
- **Aide intégrée** : l'aide sur le GDS est **générale à Pilot** (bloc
  `HELP:gds` de `help/overview.md` → handbook) — **pas** d'aide spécifique
  par projet.

---

## 1. Architecture

### 1.1 Vue d'ensemble

```
   Poste fixe (dev) — GDS interne via Tailscale (V1)
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   ┌───────────────┐   ┌───────────────────────────────┐      │
   │   │  PostgreSQL    │   │  Pilot (instance serveur,     │      │
   │   │  (BASE UNIQUE) │   │  mode serveur / keep-alive)   │      │
   │   │  · gds         │   │  · GDS modules (Rust)        │      │
   │   │  · suivi       │   │  · Assistant de groupe       │      │
   │   │  · tickets     │   │  · web_server.rs (axum)      │      │
   │   │  · git metadata│   │  · API REST + WS             │      │
   │   └───────▲────────┘   └──────────────┬────────────────┘      │
   │           │                           │                        │
   │   ┌───────┴───────────────────────────▼────────────────┐      │
   │   │           Dépôts git (1 repo par projet)           │      │
   │   │   <gds_repos_dir>/<projet>.git  (bare repos)       │      │
   │   │   accès : SSH (clefs liées à l'email)              │      │
   │   └────────────────────────────────────────────────────┘      │
   └────────────────────────────────────────────────────────────────┘
              ▲                           ▲
   réseau dev (postes Pilot)     (plus tard) navigateurs clients finaux
                                 (widget marque blanche, VPS public)
```

- **V1** : le GDS tourne dans **un seul conteneur** (§1.4) sur le **poste
  fixe**, accessible aux autres postes de dev via **Tailscale**. Pas de VPS.
- **Activation par projet** (§0.4) : chaque projet déclare **son** serveur GDS
  dans `.pilot/gds.json` à l'activation — aucun serveur par défaut, aucune
  config globale.
- **Plus tard** : le **VPS OVH tout-en-un** (PostgreSQL + instance Pilot serveur +
  repos git bare) n'est nécessaire que pour le **widget public** (issue #56).
- **Postgres local OU distant dès le départ** : la config GDS accepte une
  **IP publique** ou une **URL http/https** pour le serveur PostgreSQL. Le même
  code provisionne et pilote un Postgres local (sur le poste fixe) ou distant
  (sur le VPS).

### 1.2 Briques à réutiliser vs à créer

**Réutilisées (aucune régression attendue) :**

| Brique existante | Fichiers | Rôle dans GDS |
|---|---|---|
| Serveur web axum + WS | `web_server.rs` | Socle HTTP/WebSocket, fan-out événements, routes `/api/*` |
| Auth web | `web_auth.rs` | Mot de passe argon2 + token opaque révocable, sessions en mémoire |
| Rate limiting | `web_rate.rs` | Garde-fous login/prompt/WS (à étendre aux endpoints GDS/tickets) |
| Audit log | `web_audit.rs` | Journal des actions sensibles (à étendre : sync, tickets) |
| Git CLI | `git.rs` | Wrapper `git` (status/diff/snapshot) — à étendre pour clone/fetch/push/bare |
| RPC agents pi/plh | `rpc_manager.rs` / `rpc.rs` | Lancer l'assistant de groupe (session RPC dédiée) |
| Super-agent | `super_agent.rs` | Socle du suivi multi-projets / base SQLite → à migrer/augmenter vers Postgres |
| Multi-projets | `spec_multiprojects.md`, `AppState` | Modèle de collection de projets (à généraliser pour GDS) |
| Tableau de bord | `dashboard.rs` | Résumés visuels du mode déconnecté (cf. §7.4) |

**À créer :**

| Module Rust | Rôle |
|---|---|
| `gds.rs` | Config GDS **par projet** (`.pilot/gds.json`), auto-provisioning, enregistrement de projet, états (source de vérité côté serveur) |
| `gds_db.rs` | Accès **PostgreSQL** (pool sqlx), schéma, migrations |
| `gds_git.rs` | Gestion des dépôts git serveur (bare), création par projet, autorisations clefs SSH |
| `gds_sync.rs` | **Pont bidirectionnel SQLite↔Postgres** (suivi fusionné) + journal des conflits (« dernier qui écrit gagne »), **sans verrou** |
| `gds_web.rs` | Routes GDS ajoutées à `web_server.rs` (ou module axum dédié) |
| `gds_client.rs` | Côté **poste de dev** : clone/fetch/pull/push (remote `gds`), dossier GDS paramétrable |
| `gds_ssh.rs` | **Clefs SSH serveur** (Phase A3) : clef du poste dev, utilisateur `git`, `authorized_keys` liées aux emails, validation/formatage |
| `group_assistant.rs` | **Assistant de groupe** (lecture seule) : questions sur projets + ajout de demandes au suivi — basé sur `super_agent.rs` |
| `tickets.rs` | Modèle de demandes/tickets, statuts, commentaires, visibilité |
| `gds-core/` / `gds-server/` | Socle serveur **partagé** (base, git, ssh, http, rôles, service) + binaire serveur **headless** du conteneur — sans dépendance Tauri (§1.4) |

### 1.3 Schéma des couches (logique, côté serveur)

```
Postes dev (Pilot desktop) ─────► GDS API (gds_web.rs) ──► PostgreSQL (gds_db.rs)
Clients finaux (widget) ───────► Composant web API (web_component.rs) ──► PostgreSQL
Pilot serveur ─────────────────► GDS modules ──► dépôts git (gds_git.rs)
Pilot serveur (assistant de groupe) ─► group_assistant.rs (session RPC pi/plh) ─► PostgreSQL
```

- **Une seule base** : Postgres est la source de vérité **quand connecté au
  GDS** (GDS + suivi + tickets + git metadata). SQLite n'est plus la source de
  vérité côté serveur.
- Le **desktop** continue d'utiliser sa base SQLite locale pour le suivi *local*
  (mode déconnecté), synchronisée avec Postgres via le **pont bidirectionnel**
  (Option A, §6).

### 1.4 Serveur conteneurisé (refonte — implémenté)

Le serveur est livré comme **un seul conteneur** (dossier `gds-server/` :
`Dockerfile`, `docker-compose.yml`, `.env.example`, `entrypoint.sh`,
`supervisord.conf`, `sshd_config`) qui réunit **trois processus supervisés**
(`supervisord`) :

| Processus | Port (hôte → interne) | Volume nommé | Rôle |
|---|---|---|---|
| `postgres` | `5432` → `5432` | `pgdata` | base unique `pilot_gds` (cluster initialisé si le volume est vide) |
| `sshd` | `2222` → `22` | `repos` | accès git par clef (compte `git` ; `authorized_keys` régénéré depuis la table `ssh_keys`) |
| `gds-server` | `8080` → `8080` | — | API HTTP `/api/gds/*` (binaire headless, socle `gds-core`) |

- **Binaire serveur** : `gds-server/` ne dépend que de `gds-core`, `axum`,
  `sqlx` et `tokio` — **aucune** dépendance à Tauri.
- **Amorçage** (`entrypoint.sh`) : initialise le cluster PostgreSQL s'il est
  vide, applique les migrations, prépare le compte `git` + `authorized_keys`,
  puis passe la main à `supervisord` (`sshd` + `gds-server` ; les dépôts bare
  annoncés en base sont matérialisés par `gds-server` à son démarrage).
- **Compte administrateur** : aucun mot de passe **généré** automatiquement —
  **formulaire de première initialisation** `POST /api/gds/setup` (route
  publique, `409` si un admin existe déjà), ou variables `GDS_ADMIN_EMAIL` /
  `GDS_ADMIN_PASSWORD` (les deux, non vides) : le service crée alors le compte
  lui-même à son démarrage ; un administrateur déjà présent n'est **jamais**
  écrasé, et aucun échec de création n'empêche le service de démarrer.
- **Contrôle du service** : `gds-core/src/service_control.rs` pilote le
  superviseur interne (`supervisorctl`) pour **redémarrer/arrêter le service**
  sans toucher `postgres` ni `sshd` ; l'arrêt du **conteneur** entier reste une
  commande hôte (`docker compose`).
- **Écrans transverses** (ouverts SANS projet, contrairement à l'onglet
  « 🌐 GDS » qui est par projet) :
  - « 🖥️ GDS Serveur — administration » (`src/js/gds-admin.js`) : connexion
    serveur (**sélecteur** des serveurs d'administration mémorisés, ou saisie
    manuelle), comptes, dépôts/projets, espace utilisé + journal, contrôle du
    service ;
  - « ⚙️ GDS — paramétrage » (`src/js/gds-params.js`) : serveurs mémorisés
    (**nom** obligatoire + **description** optionnelle, état **joignable /
    injoignable / jamais testé** avec date du dernier test, application à un
    **projet choisi**), identité, clés SSH, « Mes projets GDS » (état,
    synchroniser, ajouter, ouvrir, **détacher** — travail conservé côté serveur
    par défaut).

### 1.5 API du service — opérations projet (compte GDS, lots 2 à 4)

Routes ajoutées au routeur **partagé** `gds_core::http::gds_routes` (servi par
`gds-server`). L'identité est **prouvée par le jeton de session** (aucun rôle
dans le corps) ; tout passe par le **corps JSON** (le socle dépend d'axum 0.7 :
un paramètre de chemin serait un piège de syntaxe).

| Route | Méthode | Garde de rôle | Corps → Réponse |
|---|---|---|---|
| `/api/gds/projects/create` | POST | écriture (`roles::can_write`) — `standard` **403** | `{name, description?}` → `{ok, project_id, name, repo_name, bare_path, bare_created}` |
| `/api/gds/projects/repo-exists` | POST | lecture (tout jeton authentifié) | `{name}` → `{name, exists, in_db, on_disk, path}` |
| `/api/gds/ssh-keys` | POST | compte **avec identité** (tout rôle) ; `user_id == 0` → **403** | `{public_key}` → `{ok, id, created, fingerprint, authorized_keys_rewritten}` |

- **Idempotence** : `projects.name` UNIQUE + `git_repos.project_id` UNIQUE +
  `ensure_bare` → second appel = même `project_id`, `bare_created: false` ;
  `ssh_keys.public_key` UNIQUE + `ON CONFLICT DO NOTHING` → `created: false`.
  Le refus d'une clef sans propriétaire (`user_id == 0`) est **journalisé**.
- **Aucune migration** : les tables (`users`, `projects`, `git_repos`,
  `ssh_keys`) existent depuis `0001`/`0003` ; la dernière reste
  `0007_drop_project_locks.sql`.
- `exists` = dépôt présent **en base ET** sur le disque (un dépôt non
  matérialisé n'est pas encore joignable en SSH).

---

## 2. PostgreSQL

### 2.1 Rôle

**Base unique** qui **fusionne** : gestionnaire de sources (projets, repos,
membres), suivi interne (clients, projets, tâches, décisions — déjà
modélisés en SQLite par le super-agent), et **demandes clients / tickets**
(issue #56).

### 2.2 Schéma proposé (V1)

```
users(id, email UNIQUE, name, password_hash, role, created_at, updated_at)
clients(id, name, notes, created_at, updated_at)
projects(
  id, name, repo_name, repo_url, path_on_server,
  client_id FK, status, description,
  created_at, updated_at
)
project_members(project_id FK, user_id FK, role, created_at)   -- attribution des droits
ssh_keys(id, user_id FK, public_key UNIQUE, created_at)        -- clefs SSH liées aux emails
tickets(
  id, project_id FK, client_id FK,
  reporter_user_id FK (NULL si visiteur anonyme),
  title, description, status(ouvert/en cours/en correction/fermé),
  priority, source('web'|'interne'|'assistant'),
  created_at, updated_at, resolved_at
)
ticket_comments(id, ticket_id FK, user_id FK NULL, body, author_label, created_at)
ticket_events(id, ticket_id FK, actor, action, detail, created_at)   -- audit visibilité
git_repos(id, project_id FK UNIQUE, path_on_server, bare_path, created_at)
audit_gds(ts, ip, subject, action, detail, ok)    -- étend web_audit
```

- V1 : **pas de granularité par fichier** (et **plus de verrou** depuis la
  refonte) — la concurrence est en « dernier qui écrit gagne » + journal des
  conflits (§5.1, §6.2).
- **Lecture** ouverte aux comptes actifs ; l'**écriture** est régie par les
  rôles et l'attribution (`project_members`).
- **Rôles** : `users.role` ∈ {`admin`, `dev`, `standard`} et `users.status` ∈
  {`pending`, `active`, `disabled`}, **contraints en base** (migration
  `0006_roles.sql`). V1 : le premier user provisionné est `admin`. Matrice
  appliquée par `gds-core/src/roles.rs` (module pur, source unique) :
  - `admin` : gérer **comptes** et **dépôts** (`can_manage_accounts`,
    `can_manage_repos`) ;
  - `dev` : publier / forcer un projet **attribué** (`can_publish_project`,
    `can_force_publish` avec `project_members`) ;
  - `standard` : **lecture seule** (écriture refusée, `can_write`) ;
  - **session historique** du poste (rôle vide = `Legacy`) : droits d'écriture
    conservés (compatibilité des installations existantes) ; rôle hors
    vocabulaire = `Unknown`, **toujours refusé**. **Gestion des comptes
  côté serveur** (routes d'administration, rôle `admin` exigé) :
  `GET /api/gds/admin/users` (liste : id, email, nom, rôle, statut — **jamais**
  d'empreinte de mot de passe), `POST /api/gds/admin/users` (création d'un
  compte directement `active`), `POST .../users/role`, `POST .../users/status`
  (réutilise `set_user_status` ; la désactivation du **dernier administrateur
  actif** est refusée en `409`) et `POST .../users/password`
  (réinitialisation, empreinte Argon2id écrite, mot de passe jamais renvoyé).

### 2.3 Migrations

- Outil : **sqlx** (compile-time checked, pool natif, migrations embarquées
  `migrations/`) — cohérent avec un pool async sur axum/tokio.
- Le serveur provisionne PostgreSQL : `CREATE DATABASE pilot_gds` + un
  utilisateur dédié (pas `postgres` superuser) avec des droits limités au
  schéma applicatif.
- Migrations versionnées et appliquées **au démarrage du serveur GDS** (ou via
  une commande `gds_migrate`).
- **Empreintes stables — octets figés en LF (`.gitattributes`)** : sqlx 0.8
  compare une empreinte **SHA-384 du contenu** des fichiers de migration avec
  celle stockée dans `_sqlx_migrations`. Le dépôt a `core.autocrlf=true`
  (Windows) : sans `.gitattributes`, un même `.sql` serait embarqué en LF dans
  les builds de dev et en **CRLF** dans la build installée/release, changeant
  l'empreinte → `MigrateError::VersionMismatch(1)` (« migration 1 was previously
  applied but has been modified ») et connexion GDS impossible. La racine du
  dépôt contient donc `.gitattributes` (`*.sql text eol=lf`) et une garde CI
  (`release.yml`) échoue si une migration n'est pas en `i/lf w/lf`. **Toute
  future migration doit rester en LF.**
- **Auto-réparation limitée aux fins de ligne** (`gds_db.rs::migrate`) : si un
  `VersionMismatch` provient UNIQUEMENT d'un écart LF ↔ CRLF (comparaison
  bidirectionnelle des empreintes), l'empreinte de `_sqlx_migrations` est
  réalignée puis la migration est retentée **une seule fois** — **aucun SQL de
  migration n'est rejoué** (pas de `DELETE` du registre, donc pas de dépendance
  à l'idempotence ni de risque de perte de données). Une divergence de contenu
  réel continue de remonter en erreur. **Règle : toute migration doit néanmoins
  rester idempotente** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  index idempotents), comme les migrations existantes.
- **Sérialisation & démarrages concurrents** : la réparation (lecture puis
  `UPDATE` du registre) s'exécute **sous le verrou consultatif PostgreSQL**
  (`pg_advisory_lock`) laissé posé par la tentative échouée — il n'est **pas**
  relâché entre la classification et l'écriture. Deux instances démarrant en
  parallèle ne peuvent donc **jamais** réparer en même temps (les valeurs
  écrites restent déterministes et idempotentes). Si une autre instance a déjà
  réaligné le registre (ou le fait entre-temps), la liste des empreintes à
  réparer est **vide** : le code **relit de façon autoritaire** (`run_direct`)
  au lieu de renvoyer l'erreur d'origine, et ne signale `VersionMismatch` que si
  la divergence **persiste réellement** (aucun faux négatif sur une base saine).

### 2.4 Postgres local OU distant (arbitrage 3)

- La config GDS contient une **adresse de connexion PostgreSQL** qui peut être :
  - **locale** : `localhost` / socket Unix (GDS interne sur le poste fixe) ;
  - **distante** : **IP publique** ou **URL http/https** (VPS, widget public).
- Le **même code** (`gds_db.rs`) construit le pool sqlx à partir de cette
  adresse, provisionne la base et applique les migrations, que le serveur soit
  local ou distant.
- **Dès le V1**, l'adresse PostgreSQL (locale ou distante) est saisie au niveau
  du projet (panneau **« 🌐 GDS »**, config `.pilot/gds.json`, §0.4) et la
  connexion est testée **avant activation**.

---

## 3. Auto-provisioning & identité

### 3.1 Auto-provisioning du serveur du projet

- **Objectif** : à **l'activation du GDS pour un projet** (→ écriture de
  `.pilot/gds.json` : URL du serveur GDS, identité email, §0.4), Pilot
  **configure le serveur visé** (adresse PostgreSQL, dossier des repos). Si ce
  serveur GDS n'existe pas encore, **la base se crée automatiquement**
  (provision PostgreSQL + migrations + repos). Aucune autre config n'existe :
  chaque projet fait son provisionment sur **son** serveur, explicitement.

  **Évolution UX (chantier GDS) — saisie unique & secrets hors projet** :
  l'adresse PostgreSQL se saisit en **champs séparés** (`db_host`, `db_port`,
  `db_user`) au lieu d'une URL `postgres://user:pass@host`. Les **mots de passe**
  (dédié + admin) sont stockés **hors du projet** dans `~/.pilot/gds_secrets.json`
  (0600, jamais dans `.pilot/gds.json`) ; une URL à mot de passe n'est ni
  affichée ni ressaisie après la première configuration (`gds_secrets_status`
  ne remonte que des booléens). Au démarrage, Pilot **reconnecte** le pool en
  arrière-plan depuis la config + les secrets (`gds_restore_pool` /
  `restore_pool_for_project`, fail-open) — plus besoin de re-provision. Les
  anciennes configs restent lues via `normalize()` (dérive `db_*` depuis
  `server_url`, et re-écrit `server_url` SANS mot de passe) ; `gds_save_config`
  préserve les champs non envoyés par l'UI.
- **Modules** : `gds.rs` (lit `.pilot/gds.json`), `gds_db.rs`, commande desktop
  `gds_provision(...)` (paramètres issus de la config projet).
- **Critère de fin** : `npm run tauri dev` → panneau « 🌐 GDS » du projet →
  « Activer / Provisionner » → base PostgreSQL créée + migrations appliquées +
  dossier des repos prêt, en une commande **idempotente**.

### 3.2 Activation GDS d'un projet + enregistrement du projet

- **Objectif** : panneau **« 🌐 GDS »** **du projet** dans Pilot desktop :
  activation on/off du GDS pour ce projet, URL de **son** serveur GDS (Postgres
  local ou distant), identité (email), dossier local de clonage. Le tout est
  écrit dans **`.pilot/gds.json`** (§0.4) — **aucune** config globale,
  **aucun** serveur par défaut.
- **Ajout du projet** : à l'activation, Pilot crée le dépôt **bare** côté
  serveur (`gds_git.rs`), l'enregistre dans `projects` (Postgres), et fait le
  `git remote add`/push initial.
- **Modules** : `gds.rs`, `gds_git.rs`, `gds_client.rs`, UI desktop (`src/js/gds-ui.js`).
- **Critère de fin** : activer le GDS sur un projet depuis le desktop → dépôt
  bare visible côté serveur, projet listé dans la base, remote configuré sur le
  poste, `.pilot/gds.json` créé ; désactiver → le projet redevient 100 % local
  (`.pilot/gds.json` conserve l'URL mais le flag est **off**).

### 3.3 Identité & accès par email (arbitrage 2)

- **Objectif** : chaque dev est identifié par son **email** (identité du repo
  git + utilisateur de la base). V1 : les inscrits (ayant les codes d'accès
  serveur) accèdent à **tous** les projets.
- **Inscription** : premier user provisionné à l'auto-provisioning (rôle
  `admin`) ; les suivants via l'admin desktop (invitation par email, mot de
  passe initial) ou auto-ajout par clef SSH fournie.
- **Transport git** : **SSH par clef liée à l'email** du dev. La clef publique
  est enregistrée dans `gds_git.rs` (autorisations clefs) et associée à
  l'utilisateur de la base.
- **Modules** : `gds.rs`, `gds_db.rs` (table `users`), `gds_git.rs` (autorisations clefs).
- **Critère de fin** : deux devs avec deux emails se connectent et voient le
  même ensemble de projets.

### 3.4 Ajouter un projet depuis le GDS (menu projet)

- **Objectif** : enrichir le menu d'ajout de projet — l'entrée « Nouveau projet »
  devient « Ajouter ou créer un projet », et une nouvelle entrée
  « Ajouter un projet depuis le GDS » ouvre une **modale listant les dépôts** du
  serveur (`gds_list_git_repos`, enrichi : `name` lisible, `email`, `local_exists`,
  `local_path`, `work_exists`, `work_path`).
- **Action a — Ouvrir un nouveau projet en local** : `gds_clone_repo(project,
  repo_name)` clone le dépôt dans `<gds_local_dir>/<repo_name>`, puis connecte le
  clone au GDS via le helper partagé (`connect_dir_to_gds` : écrit le `.pilot/gds.json`
  local (même serveur/identité, `gds_remote_url`), `ensure_poste_key`, l'enregistre
  auprès du serveur via `add_project_to_gds` idempotent, fail-open — ne supprime
  **jamais** le bare serveur ni un worktree existant), puis ouvre le projet.
- **Refonte « un seul dossier local par projet » (gds-menu.js)** : chaque projet GDS
  correspond à **UN SEUL dossier local** (aucune copie séparée type `C:\GDS\<name>`
  dupliquant un dossier de travail existant). La liaison dossier ↔ projet GDS se
  fait à l'action « Ajouter au GDS ». Actions **MUTUELLEMENT EXCLUSIVES** selon
  `local_exists` + `work_exists` :
  - **a)** si un **projet de travail** existe (`work_exists`) → « **Connecter ce
    dossier au GDS** » (`gds_connect_existing` sur `work_path`) : (a) écrit le
    `.pilot/gds.json` du dossier cible depuis la config du projet de référence,
    (b) initialise le repo git si absent (`ensure_git_repo_with_identity`),
    (c) connecte via `connect_dir_to_gds` (remote `gds` + clef SSH + add). Jamais de
    clone d'un doublon. Si un clone GDS **redondant** existe en parallèle
    (`local_exists`), un second bouton « Supprimer la copie redondante » mène à
    `gds_remove_dup_worktree` : **simulation (dry-run) présentée d'abord**, puis
    confirmation utilisateur avant la **suppression réelle** (`confirm=true`).
  - **b)** sinon, un clone GDS **unique** existe (`local_exists` sans travail) →
    « **Synchroniser** » ce clone (ouvrir le worktree local puis `gds_sync_project`
    sans écrasement).
  - **c)** sinon → « **Ramener en local** » (clone = dossier unique).
  Jamais de clone par-dessus un worktree existant, jamais d'écrasement, aucune
  suppression destructive automatique (`confirm=true` requis).
- **`gds_sync_project` (gds_client.rs)** : quand le dossier local (`project`) est
  DÉJÀ connecté au GDS (`.pilot/gds.json` présent) et ne se situe pas sous
  `<gds_local_dir>/<name>`, la synchro se fait **directement sur CE dossier**
  (fetch/pull via le remote `gds`) au lieu de re-cloner un
  doublon. Un dossier de travail **non connecté** (pas encore de `gds.json`) est
  orienté vers « Connecter ce dossier au GDS » au lieu d'un échec « Lecture gds.json ».
  L'onboarding auto existant (bare absent → `add_project_to_gds`) est conservé.
- **`gds_remove_dup_worktree(project, dup_dir, connected_dir, confirm)`** : supprime
  UNIQUEMENT le worktree dupliqué `<gds_local_dir>/<name>` — jamais le dossier
  connecté (`connected_dir`), jamais le projet actuellement ouvert, jamais dans
  `<local_dir>/repos/` (protection du bare). `confirm=false` → dry-run (removed=false
  + chemin prévu) ; `confirm=true` → suppression réelle. Retourne `{ removed, path }`.
- **Action b — Ouvrir normalement un déjà en local** : si `local_exists` est vrai
  (et sans projet de travail en parallèle), ouvre le clonage local (`local_path`)
  puis **propose une synchronisation** automatique (`gds_sync_project`).
- **GDS non provisionné / non connecté** : la modale s'affiche en **lecture** avec
  un message clair (orientation vers l'onglet 🌐 GDS) — jamais de crash.
- **Modules** : `gds.rs` (`gds_clone_repo`, `gds_connect_existing`,
  `gds_remove_dup_worktree`, `connect_dir_to_gds`, `gds_list_git_repos`),
  `gds_client.rs` (`sync_project`), `gds_db.rs` (`list_git_repos` + join `projects`
  pour `name`/`email`), `src/js/gds-menu.js` (modale lazy), `sidebar.js` (entrée du menu).
- **Critère de fin** : depuis le menu projet, ajouter un dépôt distant GDS en
  local (clone + connexion auto + remote `gds`) ; connecter un dossier de travail
  existant ; supprimer une copie redondante avec confirmation ; ré-ouvrir un dépôt
  déjà cloné localement avec synchro optionnelle — toujours un seul dossier local.

---

## 4. Dépôt git par projet (centralisé)

- **Objectif** : un repo git **bare** par projet sur le serveur
  (`<gds_repos_dir>/<projet>.git`).
- **Transport** : **SSH (clef liée à l'email du dev)** — arbitrage 2. Gestion
  via `gds_git.rs` (création bare, hooks optionnels `post-receive` pour
  déclencher des notifications/CI).
- **Critère de fin** : clone/fetch/push fonctionnel entre poste et serveur.

### 4.1 Serveur **distant** (Linux) vs serveur **local** — contrat

Le GDS peut viser un PostgreSQL + repos bare **sur une machine distante**
(VPS, serveur Linux). Décision structurante : **Pilot n'administre JAMAIS une
machine distante**. La séparation est pilotée par `is_local_host` (§0.4).

| Étape | Serveur LOCAL | Serveur DISTANT |
|---|---|---|
| Utilisateur système `git`, dossier de repos, `authorized_keys`, `sshd` | préparés par Pilot (`gds_ssh`) | **manuels** (procédure : `docs/gds-server-setup.md`) |
| `ensure_poste_key` / `ensure_poste_key_remote` | clef en base **+** synchro `authorized_keys` locale | clef en base **uniquement** (`manual: true`) |
| Dépôt bare du projet | créé par Pilot sous `<gds_local_dir>/repos/` | **créé manuellement** sur le serveur, sous `gds_server_repos` |
| `gds_provision` | provision + préparation serveur locale | provision DB seulement (`manual_setup: true` dans la réponse) |
| `add_project_to_gds` | `gds_git::add_project` (bare + DB) | `gds_git::add_project_remote` (DB seulement, chemin POSIX enregistré) |
| URL du remote | `ssh://git@hôte:22/<nom>.git` (**inchangée**) | `ssh://git@hôte:<ssh_port>/<gds_server_repos>/<nom>.git` (**chemin absolu**) |
| Existence du bare (`gds_connection_status`, sync) | test **fichier** (`gds_git::bare_repo_exists`) | requête **PostgreSQL** (`gds_db::project_has_git_repo`, fail-open `false`) |
| Rollback en cas d'échec push | `rollback_local_add` (projet **réellement nouveau** uniquement) : bare **+ lignes de suivi** (`projects` / `git_repos`, `gds_db::delete_project_by_name`) — un projet déjà inscrit n'est jamais annulé | **aucune suppression** (dépôt sous responsabilité manuelle) |
| `gds_remove_project(purge_server=true)` | retire le bare local + la base | retire **uniquement** les lignes en base |

- **Sémantique d'URL vérifiée** (git 2.5x, `GIT_SSH_VARIANT=ssh`) :
  `ssh://git@hôte:port/<chemin>` passe **toujours un chemin ABSOLU**
  (`git-upload-pack '/chemin'`). D'où le préfixe `/` forcé sur `gds_server_repos`
  pour un serveur distant ; un chemin relatif au `$HOME` de `git` n'est pas
  exprimable dans ce schéma. Le mode LOCAL conserve **byte-for-byte** l'URL
  historique (même si `gds_server_repos` est renseigné par erreur).
- **Nom du dépôt** : contrat partagé `gds_git::repo_name_for(name)` →
  `<nom validé (anti path traversal)>.git`, identique dans les deux modes.
- **Limite connue / assumée** : `gds_register_ssh_key` (commande « enregistrer
  une clef de dev ») n'a ni projet ni config pour décider local/distant : il
  continue de synchroniser `authorized_keys` **du poste** et n'est donc
  pertinent que pour un serveur local (mention dans l'UI et la procédure).

---

## 5. Synchronisation poste & concurrence

### 5.1 Synchronisation poste (sans verrou)

- **Objectif** : un dev qui veut **modifier** un projet **synchronise** sur son
  poste (clone/fetch/pull dans le dossier des projets GDS **paramétrable**,
  §5.2), puis pousse ses commits sur le remote `gds` (SSH).
- **Verrou supprimé (refonte, décision 3)** : la table `project_locks` et le
  **mode urgent** ont été **retirés** (migration `0007_drop_project_locks.sql`).
  Il n'existe plus aucune commande Tauri ni route `/api/gds/lock/*`. La
  concurrence est **assumée** : « **dernier qui écrit gagne** », les conflits du
  suivi étant **journalisés** (§6.2, action `tracking.conflict`).
- **Modules** : `gds_client.rs` (`sync_project` : clone/fetch/pull), `gds_sync.rs`
  (pont de suivi), `gds_web.rs` (route `POST /api/gds/sync`), `gds_git.rs`
  (dépôt bare, clefs SSH).
- **UI** : l'ouverture d'un projet GDS connecté déclenche une synchronisation
  (fail-open, non bloquante) ; l'onglet « 🌐 GDS » offre **Synchroniser** et
  **Retirer du GDS** (avec option de purge serveur).
- **Critère de fin** : deux postes synchronisent le même projet **sans être
  bloqués** ; aucun conflit n'est silencieux (journalisés dans `audit_gds`).

### 5.2 Dossier des projets GDS paramétrable

- Le dossier local de clonage (`gds_local_dir`, **éditable dans l'UI** du bloc
  « Connecter un serveur GDS »), par défaut `~/Pilot/GDS` (`C:\GDS` sous
  Windows), sert de racine aux dépôts bare **du serveur LOCAL**
  (`<gds_local_dir>/repos/<projet>.git`). Pour un serveur **distant**, ce champ
  ne désigne que le dossier de travail local et la racine serveur est
  `gds_server_repos` (voir §4.1).

- **Objectif** : le dossier local où les projets GDS sont clonés est configurable
  (champ `gds_local_dir` de la **config projet** `.pilot/gds.json`, défaut
  `~/Pilot/GDS`), validé à l'activation (§0.4).
- **UI** : le champ « Dossier local de clonage » est **éditable** dans le
  panneau « Connecter un serveur GDS » de l'onglet projet ; la valeur saisie est
  persistée dans `.pilot/gds.json` et réutilisée par les synchronisations
  suivantes (défaut `~/Pilot/GDS` sinon).
- **Critère de fin** : changer le dossier → les futures sync utilisent le nouveau.

### 5.3 Mode urgent — RETIRÉ

- Le mode urgent (ancien arbitrage 6) n'existe plus : il servait à **passer
  outre** le verrou, lui-même supprimé (décision 3 de la refonte).
- Aucun champ `gds_urgent_user_email`, aucune route `/api/gds/lock/urgent`,
  aucune commande `gds_urgent_lock` ne subsiste. La gestion des droits passe
  désormais par les **rôles** (§2.2).

---

## 6. Suivi fusionné SQLite → PostgreSQL (Option A + pont bidirectionnel)

### 6.1 Stratégie (arbitrage 1)

- **Option A** : **Postgres = source de vérité QUAND connecté au GDS** ;
  **SQLite local = vérité sinon** (mode déconnecté, §7).
- Le desktop continue d'utiliser son SQLite (`~/.pilot/super-agent.db`) pour le
  travail local, et **synchronise** vers Postgres (projets, tâches, décisions)
  via le **pont bidirectionnel** (`gds_sync.rs`). Le serveur / assistant de
  groupe lit Postgres.
- **Résolution des divergences** : « dernier écrit gagne » / clé `updated_at` +
  log des conflits.

### 6.2 Pont bidirectionnel

- **Module** : `gds_sync.rs` (pont bidirectionnel), `gds_db.rs`
  (clients/projects/tasks/decisions).
- **Direction desktop → Postgres** : à la sync, les lignes SQLite modifiées
  (clé `updated_at`) sont poussées vers Postgres.
- **Direction Postgres → desktop** : à la sync, les lignes Postgres plus
  récentes sont rapatriées dans le SQLite local.
- **Conflit** : résolu par « dernier écrit gagne » sur `updated_at` + entrée
  dans le log des conflits (audit).
- **Critère de fin** : le suivi desktop apparaît dans Postgres ; une divergence
  est résolue sans perte de données.

### 6.3 Publication forcée du suivi (arbitrage 1, rôles §2.2)

- Un compte **habilité** peut **forcer la mise à jour serveur** : la commande
  `gds_force_push_suivi` (route `POST /api/gds/tracking/force`) écrase l'état
  Postgres du projet avec l'état local, au lieu du « dernier écrit gagne » du
  pont (§6.2).
- **Habilitation** : `roles::can_force_publish` — `admin`, ou `dev` **attribué**
  au projet (`project_members`). `standard` et tout rôle hors vocabulaire sont
  refusés ; le refus est journalisé (`audit_gds`, action
  `tracking.force.denied`).
- **Plus de titulaire de verrou** : la garde ne lit aucun verrou (retiré en L6),
  elle vérifie le rôle et l'appartenance au projet
  (`gds_db::ensure_project_publisher`).

---

## 7. Mode déconnecté (arbitrage 1)

### 7.1 Principe

- **Sans activation GDS pour le projet** (flag **off** ou `.pilot/gds.json`
  absent, §0.4) : SQLite local = vérité. L'utilisateur travaille normalement,
  aucun GDS n'est impliqué — **c'est le cas par défaut de tout nouveau projet**
  (aucun serveur par défaut).
- **Projet activé et connecté au GDS** (ajouté ou chargé depuis **le serveur du
  projet**) : Postgres = vérité pour tous.
- **En cas d'indisponibilité du serveur** (ou LLM local) : l'utilisateur
  travaille **localement** et **tout ce qui a bougé se synchronise** dès que le
  serveur redevient accessible.

### 7.2 Comportement

- Pendant l'indisponibilité, les modifications locales (fichiers + suivi) sont
  accumulées (journal local des changements).
- Au retour du serveur, une **resynchronisation automatique** pousse tout ce qui
  a bougé (git push + pont SQLite→Postgres).
- Un compte **habilité** (`admin`, ou `dev` attribué au projet) peut forcer la
  mise à jour serveur (§6.3) — il n'y a plus de titulaire de verrou.

### 7.3 Résumés visuels (arbitrage 1, évolution durable)

- Des **indications visuelles de résumé** sont affichées **au tableau de bord**
  (`dashboard.rs`) : nombre d'éléments en attente de sync, éléments synchronisés
  au retour, conflits résolus, état de connexion au GDS.

### 7.4 Critère de fin

- Serveur coupé → l'utilisateur continue de travailler localement ; au retour,
  tout ce qui a bougé est synchronisé ; le tableau de bord affiche un résumé
  visuel de la sync.

---

## 8. Assistant de groupe (lecture seule)

### 8.1 Rôle

- Le serveur héberge un **assistant de groupe** (moteur pi/plh) qui : répond
  aux **questions sur les projets gérés**, **ajoute les demandes** (bugs/
  évolutions) au **suivi (tickets)**, permet le **suivi**.
- **Lecture seule stricte** (réutilise le modèle du super-agent : session RPC
  dédiée, extension de lecture seule) — il **ne modifie pas le code**.

### 8.2 Moteur configurable (arbitrage 8)

- **Cloud (pi/plh)** pour l'instant, mais **moteur configurable côté serveur GDS**
  dès le départ (champ de la **config du serveur GDS** lui-même, ex:
  `gds_group_engine` : `cloud` par défaut, extensible à `ollama` / API LLM —
  pas dans la config Pilot desktop).
- **Évolution future** : clients avec leurs propres APIs LLM ou comptes cloud
  Ollama (déjà utilisé par l'équipe Kalico).

### 8.3 Modules

- `group_assistant.rs` (dérivé de `super_agent.rs`), extension
  `pilot-group-assistant.ts` (outils `ticket_create`, `ticket_search`,
  `project_query`), canal d'événements dédié (`__channel: group`).
- **C2.2 (implémenté)** : l'extension `pilot-group-assistant.ts` expose
  `group_tracking_query(scope)` (lecture du suivi fusionné) + `ticket_create`
  (ajout d'une demande/bug/évolution au suivi — écriture autorisée sur le suivi,
  jamais sur le code), `ticket_search` (recherche de tickets par texte/statut/
  projet/client) et `project_query` (interrogation des projets du groupe).
  Lecture seule stricte sur le code, écriture limitée aux tickets. Respect de
  `gds_enabled`.
- **C2.3 (implémenté)** : modèle tickets + CRUD + routes + traitement des
  sentinels côté Rust et frontend.
  - **Migration `0005_tickets.sql`** : tables `tickets` (status/priority/source,
    `resolved_at`), `ticket_comments`, `ticket_events` (audit visibilité) +
    index sur `tickets.status` / `tickets.client_id`.
  - **CRUD `gds_db.rs`** : `ticket_create`, `ticket_search` (texte/statut/
    projet/client, tri `updated_at` DESC), `ticket_comment_add`,
    `ticket_status_update` (pose `resolved_at` à la fermeture), `list_tickets`,
    `ticket_event_add`, `get_ticket_by_id`.
  - **Routes `gds_web.rs`** (remplacent la route réservée `gds_phase_c`) :
    GET/POST `/api/gds/tickets`, POST `/api/gds/tickets/{id}/comments`,
    POST `/api/gds/tickets/{id}/status` — derrière `auth_middleware`, rate
    limiting `check_tracking`, audit `tracking_list`/`tracking_create`/
    `tracking_update`, respect de `gds_enabled` via `gds_pool`.
  - **Commandes Rust `group_assistant.rs`** (enregistrées dans `lib.rs`) :
    `send_group_assistant_command` (réponse `extension_ui_response`),
    `group_assistant_ticket_create`, `group_assistant_ticket_search`,
    `group_assistant_project_query` (lecture suivi fusionné par scope) — toutes
    refusent si le GDS est désactivé globalement.
  - **Frontend `src/js/group-assistant.js`** (initialisé dans `main.js`) :
    écoute `rpc-event-group`, traite les `extension_ui_request` `input`
    préfixés `PILOT_GROUP_*` et renvoie le résultat JSON via
    `send_group_assistant_command`.

### 8.4 Critère de fin

- L'assistant de groupe répond + lit le suivi sans modifier le code ; il ajoute
  les demandes au suivi (tickets).

---

## 9. Branchement de l'assistant & évolutions

### 9.1 Branchement de l'assistant

- **Objectif** : une fois le projet synchronisé sur le poste, l'**assistant
  Pilot du dev** a accès au nouveau projet (ouvrable, discutable, modifiable par
  délégation à l'agent du projet). Sur le serveur, l'**assistant de groupe** le
  suit et répond.
- **Modules** : réutilisation `super_agent.rs` / `group_assistant.rs` ; le projet
  GDS est enregistré comme « projet connu » (liste injectée à chaque tour).
- **Critère de fin** : sur le poste, le projet GDS apparaît dans les projets
  connus de l'assistant ; sur le serveur, l'assistant de groupe parle de ce
  projet.

### 9.2 Évolutions durables (hors V1)

- **API systématique pour toute discussion base de données** : ouvrir le
  logiciel sur d'autres plateformes — évolution future.
- **Mode déconnecté** avec résumés visuels au tableau de bord (§7).
- **Clients avec leurs propres APIs LLM / comptes Ollama** (§8.2).

---

## 10. Sécurité & sauvegardes

### 10.1 Sécurité

- **Réseau** : V1 sur Tailscale (mesh privé). Plus tard, VPS public → pare-feu
  (ufw), pas de port inutile exposé, SSH configuré (clefs, pas de root direct),
  fail2ban.
- **HTTPS/accès** : TLS obligatoire pour le widget public (Caddy/Nginx
  auto-cert) ; cookies Secure/HttpOnly ; CORS restreint aux domaines clients
  autorisés (liste blanche).
- **Git serveur** : repos bare centralisés, accès par **clef SSH liée à un
  email** (`ssh_keys`), écriture régie par les **rôles** (§2.2), hooks
  `post-receive` optionnels, gestion des gros fichiers (Git LFS si besoin).
- **Concurrence (sans verrou)** : écritures simultanées assumées en « dernier
  qui écrit gagne » (décision 3) ; conflits du suivi **journalisés** dans
  `audit_gds` (`tracking.conflict`) ; **publication forcée** réservée aux
  comptes habilités (§6.3).
- **PostgreSQL** : pool configuré (max_connections), index sur
  `tickets.status` / `tickets.client_id`.
- **Assistant de groupe** : coût/ressources du moteur pi/plh, isolation de la
  session, garantie **lecture seule stricte**.
- **Cohabitation SQLite/Postgres (Option A)** : divergence temporaire,
  résolution par clé `updated_at` + log des conflits.
- **Secrets** : clef de signature, mot de passe DB, clef API hors du code
  (env vars / `.env` non versionné), `cargo audit` sur les nouvelles
  dépendances (sqlx, postgres driver).

### 10.2 Sauvegardes (arbitrage 10)

- Gérées par **l'utilisateur lui-même** : **provision** + **`pg_dump`
  planifiés** + **monitoring**. Pilot fournit la documentation et les scripts
  de provision, mais ne gère pas les sauvegardes à la place de l'utilisateur.

---

## 11. Découpage en phases (A→B→C) avec critères de fin

> Chaque étape : **objectif** · **modules** · **dépendances** · **tests** ·
> **critère de fin**. Chaque étape passe au **quality-gate** avant validation.

### PHASE A — GDS : fondations serveur (prérequis, à faire en premier)

> ✅ **Implémentée (bloc serveur + UI desktop)** — `cargo test --lib` vert.
> La gestion des clefs SSH serveur (Phase A3) est également livrée (détaillée
> ci-dessous).

**A1. Provisionnement PostgreSQL + socle GDS** ✅
- Objectif : auto-provisioning de la base + connecteur Postgres côté Rust
  (local OU distant, arbitrage 3) + **activation du GDS par projet**
  (`.pilot/gds.json`, §0.4 : activation on/off, URL serveur, identité).
- Modules : `gds_db.rs`, `gds.rs` (provision + lecture config projet),
  migration sqlx. **Pas de champ `gds_*` dans la config globale de Pilot**
  (décision 29/08/2026 : la config GDS vit uniquement dans le projet).
- Dépendances : néant (socle). Tests : unitaires pool/CRUD, migration appliquée.
- Critère de fin : `.pilot/gds.json` actif + `gds_provision` crée la base +
  tables depuis un serveur vide (local ou distant).

**A2. Identité & accès par email** ✅
- Objectif : users (email/password_hash), provision premier user (admin),
  auth réutilisée.
- Modules : `gds_db.rs` (table users), extension de `web_auth.rs`/`web_audit.rs`.
- Tests : login, récupération, révocabilité. Critère : dev identifié par email.

**A3. Dépôt git par projet (serveur)** ✅
- Objectif : création d'un repo bare par projet + remote, transport **SSH par
  clef liée à l'email** (arbitrage 2).
- Modules : `gds_git.rs`, `gds.rs` (add project), `git.rs` (étendu),
  **`gds_ssh.rs`** (gestion des clefs SSH serveur, Phase A3).
- Dépendances : A1, A2. Tests : création bare, clone/push/pull entre deux clones.
- Critère : un projet ajouté → repo bare centralisé + push initial OK.
- **Gestion des clefs SSH serveur** ✅ : `gds_ssh.rs` gère tout automatiquement
  (GDS V1 = serveur local) :
  - **Clef du poste dev** : génération d'une paire ed25519 dans `~/.ssh/` si
    absente (idempotent, n'écrase jamais une clef existante), lecture de la clef
    publique (commande `gds_ssh_key` → `{ public_key, path, generated }`).
  - **Utilisateur système `git`** : créé à la provision s'il n'existe pas
    (`useradd`/`adduser` Linux/macOS, `net user` Windows), `~git/.ssh/` en 700
    et `authorized_keys` en 600, activation sshd (OpenSSH Server). Erreur claire
    si les droits admin manquent.
  - **Clefs liées aux emails** : table `ssh_keys` (migration `0003_ssh_keys.sql`,
    `public_key` UNIQUE, FK `users`), CRUD dans `gds_db.rs`
    (`create_ssh_key`, `get_ssh_keys_by_user`, `get_ssh_key_by_key`,
    `get_ssh_key_by_fingerprint`, `delete_ssh_key`).
  - **Synchronisation DB → authorized_keys** : pour chaque clef de `ssh_keys`
    (associée à un email), écrit la ligne `type base64 <email>` dans
    `~git/.ssh/authorized_keys` (idempotent, sans doublon). Commande
    `gds_register_ssh_key` (email + clef) : insère en base puis met à jour
    authorized_keys. Validation stricte du format de clef (anti-injection de
    ligne).
  - **Bout en bout** : à la provision, la clef du poste est générée et
    enregistrée automatiquement ; à `gds_add_project` et `gds_sync_project`, on
    s'assure que la clef du poste est présente dans authorized_keys pour que le
    remote `ssh://git@<host>:22/<projet>.git` soit utilisable.
  - **UI desktop** : section « Clefs SSH » de l'onglet GDS (`src/js/gds.js`) —
    bouton générer/afficher la clef du poste, champ email + zone de saisie pour
    enregistrer une clef de dev, affichage de l'état.

**Périmètre de la Phase A** : elle livre **uniquement les fondations**

> **Identité git automatique à l'ajout (implémenté)** : quand `gds_add_project`
> (ou l'onboarding `gds_sync_project` / la route web) détecte une identité git
> manquante (user.name/user.email, local ou global), Pilot la règle
> **localement** (`.git/config`, jamais `--global`) :
> - `user.email` = email du compte GDS connecté (paramètre `email`, aucune saisie) ;
> - `user.name` = nom fourni une seule fois par l'utilisateur (`git_name`, UI) ou
>   nom mémorisé (`gds_save_git_name`, `~/.pilot/gds_secrets.json.git_name`), sinon
>   échec clair « nom git requis » ;
> - module `git.rs` : `git_config_local_user_name/email` + helper partagé
>   `ensure_git_repo_with_identity(cwd, email, name)` (init si non-repo + identité
>   locale + premier commit), isolé en tests via `IsolatedGitConfig` (`GIT_CONFIG_GLOBAL`+
>   tmp + mutex partagé) — ni les secrets réels (~/.pilot) ni la config globale
>   utilisateur ne sont touchés en test. Commandes `gds_git_identity_prefs` (état +
>   nom pré-rempli) et `gds_save_git_name` (mémorisation).
(provision serveur, identité, activation par projet, dépôt git bare). Elle ne
couvre **ni** la synchronisation (Phase B), **ni** le suivi
fusionné / l'assistant de groupe (Phase C).

**Interfaces prévues pour ouvrir B et C plus tard** (réservées dès la Phase A,
sans implémentation à l'époque) :
- commandes desktop `gds_sync_project` (Phase B) : nom figé dès la A ;
- routes API réservées dans `gds_web.rs` (suivi fusionné, tickets — Phase C) :
  noms de routes figés dès la A pour éviter toute rupture d'API ;
- schéma serveur extensible : suivi fusionné + tickets (C) ajoutés plus tard par
  migrations sqlx incrémentales, sans redécoupage de la base créée en A.

### PHASE B — GDS : synchronisation (verrou retiré par la refonte)

> ✅ **Implémentée**, puis **révisée par la refonte GDS** : le verrou global
> projet et le mode urgent (ex-B2) ont été **retirés** (migration
> `0007_drop_project_locks.sql`, décision 3). La synchronisation poste est
> conservée **sans verrou** (§5.1).

**B1. Dossier GDS paramétrable + clone/fetch/pull** ✅
- Modules : `gds_client.rs`, config projet `gds_local_dir`, `git.rs`
  (`git_fetch` ajouté). Dépendance : A3.
- Critère : sync d'un projet dans le dossier paramétré.

**B2. ~~Verrou global projet + TTL + mode urgent~~ — RETIRÉ (refonte)**
- Supprimés par la refonte : table `project_locks`, commandes desktop de verrou,
  routes `/api/gds/lock/*`, mode urgent. Le rôle `admin` (§2.2) reprend la
  gestion des droits ; la concurrence est en « dernier qui écrit gagne »
  journalisé (§5.1, §6.2).
- Dépendance de l'ancien B2 (`project_locks` pour C1) **levée** : C1 ne dépend
  plus que de A1.

### PHASE C — GDS : suivi fusionné + assistant de groupe

**C1. Migrer/synchroniser le suivi (SQLite → Postgres)** ✅
- Modules : `gds_sync.rs` (pont bidirectionnel), `gds_db.rs`
  (clients/projects/tasks/decisions). Option A + mode déconnecté (arbitrage 1).
- Dépendance : A1. Tests : synchro SQLite↔Postgres, divergence résolue,
  publication forcée par un compte habilité (§6.3).
- Critère : le suivi desktop apparaît dans Postgres ; mode déconnecté + résumés
  visuels au tableau de bord (§7).

**C1.1. CRUD suivi (Postgres)** ✅ — tables `clients`/`projects`/`tasks`/
`decisions` (migration `0004_suivi.sql`), upserts par clé naturelle (name/path)
ou id, `get_*_modified_since`, `delete_*`, `updated_at` = clé de divergence.

**C1.2. Pont bidirectionnel SQLite↔Postgres** ✅ — `gds_sync.rs` :
- **Couche d'accès SQLite** : ouverture `~/.pilot/super-agent.db`, ajout
  idempotent de `updated_at` sur `decisions` (PRAGMA table_info, SANS toucher
  `super_agent.rs`), tables `gds_id_map` (mapping id SQLite↔Postgres pour
  tasks/decisions) et `gds_sync_state` (watermark).
- **Pont bidirectionnel** : pousse les lignes SQLite modifiées (updated_at >
  watermark) vers Postgres, rapatrie les lignes Postgres plus récentes, résout
  les divergences par « dernier écrit gagne » (`resolve_conflict`), log des
  conflits dans `audit_gds` (action `tracking.conflict`), watermark persisté.
- **Branchement** : appelé par `sync_project` (gds_client.rs) + commande Tauri
  `gds_sync_tracking` + **déclenchement automatique au démarrage**
  (setup de `lib.rs`, après reconnexion du pool GDS, fail-open).
- **Paramètre global `gds_enabled`** (AppConfig, actif par défaut, issue #75) :
  toggle global distinct de l'activation par projet (.pilot/gds.json) — quand
  désactivé, AUCUNE opération GDS (sync, suivi fusionné) n'est permise
  (court-circuit des commandes Tauri + routes web).
- Tests : `resolve_conflict`, `parse_updated_at`, `pg_to_sqlite_dt`,
  `ensure_sqlite_column` idempotent, `ensure_sqlite_schema`, mapping id,
  watermark, défaut `gds_enabled`.

**C1.3. Publication forcée du suivi (rôles)** ✅ — `gds_sync.rs` :
- **Principe** : un compte **habilité** peut **forcer** la poussée du suivi
  local vers Postgres, en **écrasant** les données distantes (au lieu du
  « dernier écrit gagne » du pont C1.2). Utile pour imposer l'état local quand le
  serveur a divergé.
- **Habilitation** : `force_push_tracking` appelle
  `gds_db::ensure_project_publisher` (socle `gds-core` partagé), qui applique
  `roles::can_force_publish` — `admin`, ou `dev` **attribué** au projet
  (`project_members`) ; `standard` et rôle hors vocabulaire refusés. **Aucun
  verrou n'est lu** (retiré en L6). Refus journalisé dans `audit_gds` (action
  `tracking.force.denied`).
- **Poussée écrasante** : lit TOUT le suivi local (since 0) et upsert chaque
  ligne vers Postgres sans tenir compte de `updated_at` distant. Succès
  journalisé (`tracking.force`).
- **Branchement** : commande Tauri `gds_force_push_suivi` + route web
  `POST /api/gds/tracking/force` (gds_web.rs). Respecte le paramètre global
  `gds_enabled` (court-circuit si désactivé).

**C1.4. Mode déconnecté + résumés visuels** ✅ — `gds_sync.rs` + `gds.js` :
- **Mode déconnecté** : quand le serveur GDS est injoignable, les modifications
  locales du suivi continuent d'être enregistrées en SQLite (accumulation
  locale, `pending_count`) sans blocage — le super-agent écrit localement quoi
  qu'il arrive. L'état de synchro est persisté dans `gds_sync_state`
  (`last_sync_ok`, `last_sync_at`, `last_sync_error`, `last_pushed`,
  `last_pulled`, `last_conflicts`, `offline`).
- **Resynchronisation automatique** : tâche de fond `start_gds_sync_monitor`
  (lib.rs, toutes les 30 s) — si le GDS est activé globalement et qu'il y a des
  éléments en attente, tente de (re)connecter le pool (`restore_pool_for_project`)
  puis synchronise via le pont C1.2 (`sync_tracking_auto`). Quand le serveur
  redevient joignable, les modifications accumulées sont poussées automatiquement.
  Fail-open : une erreur ne bloque jamais l'interface.
- **Résumés visuels** : commande Tauri `gds_sync_status` (dernière synchro,
  éléments en attente, conflits, mode hors-ligne) affichée dans l'onglet GDS
  (section 6, badges Synchronisé / Hors-ligne / En attente / conflits).
- **Respect de `gds_enabled`** : le mode déconnecté ne s'applique que si le GDS
  est activé globalement (actif par défaut) — sinon `gds_sync_status` retourne
  `{ enabled: false }` et la tâche de fond ne tourne pas.
- Tests : `pending_count`, `get_state`/`set_state`, `record_sync_result`,
  `read_sync_status` (défauts).

**C1.5. Routes API suivi fusionné + rate/audit** ✅ — `gds_web.rs` +
`web_rate.rs` + `web_audit.rs` + `gds_db.rs` :
- **Routes REST** : lecture/écriture des 4 entités du suivi derrière
  `auth_middleware` — `GET/POST /api/gds/tracking/clients` (+ `/delete`),
  `GET/POST /api/gds/tracking/projects` (+ `/delete`),
  `GET/POST /api/gds/tracking/tasks` (+ `/delete`),
  `GET/POST /api/gds/tracking/decisions` (+ `/delete`). Les POST sont des
  upserts (création si absent, mise à jour sinon) ; les `/delete` suppriment
  par clé (name/path/id).
- **Rate limiting dédié** : `WebGuard::check_tracking` (`web_rate.rs`, 60 op /
  60 s / token) appliqué à toutes les routes de suivi via `tracking_allowed`
  (429 + audit `rate_limited` si dépassé).
- **Audit étendu** : `web_audit.rs` documente les actions `tracking_create` /
  `tracking_update` / `tracking_delete` / `tracking_list` (détail
  `"<entité>:<clé>"`), journalisées par chaque handler.
- **Respect de `gds_enabled`** : toutes les routes passent par `gds_pool`
  (court-circuit si le GDS est désactivé globalement).
- **CRUD liste** : `gds_db.rs` ajoute `list_clients`, `list_tracking_projects`,
  `list_tasks`, `list_decisions` (lecture complète pour l'API).

**C2. Assistant de groupe (lecture seule)** ✅
- Modules : `group_assistant.rs` (dérivé de `super_agent.rs`), extension
  `pilot-group-assistant.ts`, canal `rpc-event-group` (`__channel: group`).
  Moteur configurable (`group_assistant_model`, arbitrage 8).
- **Implémenté** : session RPC dédiée globale (multi-projets) démarrée via
  `start_group_assistant_session` (garde-fou `gds_enabled`), prompt lecture
  seule stricte (`send_group_assistant_prompt`), modèle configurable
  (`set_group_assistant_model`), état (`get_group_assistant_state`), lecture du
  suivi fusionné (`group_assistant_tracking_query` : Postgres via le GDS quand
  le pool est disponible, sinon repli SQLite du super-agent). Extension
  `pilot-group-assistant.ts` : outil `group_tracking_query(scope)` (sentinel
  `PILOT_GROUP_TRACKING_QUERY::`), lecture seule stricte.
- Dépendance : C1. Tests : `cargo test --lib` vert (209 tests). Critère :
  assistant de groupe répond + lit le suivi sans modifier le code.

---

## 12. Anti-régression

- **Ne pas casser l'existant** : le super-agent desktop (SQLite) continue de
  fonctionner en mode déconnecté (Option A, zéro régression).
- **Ne pas modifier** les modules existants d'agents ni `ask_pi_caged_timed`.
- **Session et canal dédiés** pour l'assistant de groupe (`__channel: group`).
- **Lecture seule garantie techniquement** pour l'assistant de groupe.
- Chaque chantier passe au **protocole quality-gate**
  (`.pi/skills/quality-gate/SKILL.md`) avant validation.

---

*Voir aussi : `plan_gds.md` (roadmap), `spec_web_component.md` (issue #56),
`spec_web_remote.md` (web-server/axum existant), `spec_super_agent.md` (suivi
multi-projets + base SQLite), `spec_multiprojects.md` (collection de projets),
`git.rs` (wrapper git CLI), `AGENTS.md` (architecture & conventions).*
