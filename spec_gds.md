# Spécification — GDS (Gestionnaire de Sources)

> Gestionnaire de sources centralisé pour les projets de **Kalico System** :
> sources git, suivi des projets, des demandes clients et des tickets, le tout
> dans **une base unique PostgreSQL**. Prérequis au composant web (issue #56,
> voir `spec_web_component.md`).
>
> **Statut : 🟢 Phases A + B + C1 (C1.1→C1.5) + C2 implémentées.**
> Chaque chantier (phases A→B→C) passe au **protocole quality-gate**
> (`.pi/skills/quality-gate/SKILL.md`) avant validation.
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
> **Implémenté (Phase B, synchronisation + verrous)** : migration
> `migrations/0002_project_locks.sql` (table `project_locks`, UN par projet,
> TTL/lease, urgent), `gds_client.rs` (`gds_sync_project` : clone/fetch/pull
> depuis le remote `gds` + acquisition du verrou), `gds_sync.rs` (verrou global
> exclusif, TTL + récupération des orphelins, relâchement, mode urgent réservé
> à la personne désignée, audit_gds), `gds_db.rs` (CRUD `project_locks` +
> `audit_gds`), `gds_web.rs` (routes `POST /api/gds/sync`, `POST
> /api/gds/lock/release`, `POST /api/gds/lock/urgent`, `GET /api/gds/locks`),
> commandes Tauri `gds_sync_project` / `gds_release_lock` / `gds_urgent_lock` /
> `gds_get_lock`. **UI desktop** : section 5 « Synchronisation & verrous »
> (bouton Synchroniser, état du verrou, Relâcher, Verrou urgent).
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
| 1 | **Migration suivi SQLite → PostgreSQL** | **Option A** : Postgres = source de vérité **quand connecté au GDS** ; SQLite local = vérité **sinon**. Ajout d'un **mode déconnecté** (cf. §7). Le dev **titulaire du verrou** peut **forcer la mise à jour serveur** (il a la dernière version tant qu'il n'a pas synchronisé). |
| 2 | **Transport git poste ↔ VPS** | **SSH par clef liée à l'email** du dev. |
| 3 | **Hébergement** | Démarrer par le **GDS interne sur le poste fixe via Tailscale** (pas de VPS pour l'instant). Le VPS n'est nécessaire que pour le **widget public** plus tard. **Dès le V1**, le code doit permettre de configurer un **serveur PostgreSQL distant via IP publique ou URL http/https** — l'architecture supporte **Postgres local OU distant** dès le départ. |
| 4 | **Format du widget** | **`<iframe>`** avec isolation complète (marque + sécurité). Le widget est un **petit bot par projet** développé via Pilot, qui répond aux questions de l'utilisateur (manuel + aide d'utilisation du logiciel) et assure le **suivi de ses demandes et bugs**. Les demandes utilisateur doivent être **validées par un dev** avant d'être ajoutées aux évolutions du projet. |
| 5 | **Comptes utilisateurs finaux** | **Invitation par le site client** (comptes administrés par Kalico), avec **flux d'inscription via le bot** : demande d'accès sur le site → le bot collecte les infos → **validation par code envoyé par email** → compte actif. Une fois connu, l'utilisateur pose des questions (aide) et demande corrections/évolutions. Le bot **cible bien le besoin** avant de créer une issue en base. |
| 6 | **Mode urgent** | Réservé à une **personne désignée** (admin/dev/gestionnaire). Il faut pouvoir **désigner cette personne parmi les utilisateurs connectés au GDS** (mécanisme de rôle / gestionnaire de verrous). |
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
- **Clients avec leurs propres APIs LLM / comptes Ollama** (point 8, §9.4).

### 0.4 Activation GDS par projet (décision du 29/08/2026 — non négociable)

- **Le GDS est activé par projet**, jamais globalement : l'activation est une
  décision **explicite** du dev, projet par projet.
- **La config GDS vit au niveau du projet**, dans **`.pilot/gds.json`** (fichier
  du projet, versionnable) : **activation on/off**, **URL du serveur GDS**,
  **identité** (email). Chaque projet pointe vers son **propre** serveur GDS ;
  deux projets peuvent viser deux serveurs différents.
- **Config simplifiée (UI)** : l'interface ne demande que l'**adresse du serveur**
  (`server_url`) et l'**email d'identité** (`identity_email`). L'hôte SSH
  (`ssh_host`, `host:22`) est **dérivé automatiquement** de `server_url` à la
  sauvegarde (schémas `postgres://`, `http://`, `https://`, `ssh://`), et le
  dossier local de clonage (`gds_local_dir`) utilise le **défaut** `~/Pilot/GDS`.
  Les champs `ssh_host` / `gds_local_dir` / `urgent_email` restent présents dans
  `.pilot/gds.json` (compat) mais ne sont **plus édités dans l'UI** ; le backend
  les **préserve** à la sauvegarde (pas de perte de données → réaffichage correct).
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

- **V1** : le GDS tourne sur le **poste fixe** (Pilot desktop, mode serveur /
  keep-alive), accessible aux autres postes de dev via **Tailscale**. Pas de VPS.
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
| Audit log | `web_audit.rs` | Journal des actions sensibles (à étendre : sync, verrou, tickets) |
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
| `gds_sync.rs` | Synchronisation poste, **verrou global projet** + **mode urgent**, détection de lock obsolète (TTL), **pont bidirectionnel SQLite↔Postgres** |
| `gds_web.rs` | Routes GDS ajoutées à `web_server.rs` (ou module axum dédié) |
| `gds_client.rs` | Côté **poste de dev** : commandes de sync/verrou/push, dossier GDS paramétrable |
| `gds_ssh.rs` | **Clefs SSH serveur** (Phase A3) : clef du poste dev, utilisateur `git`, `authorized_keys` liées aux emails, validation/formatage |
| `group_assistant.rs` | **Assistant de groupe** (lecture seule) : questions sur projets + ajout de demandes au suivi — basé sur `super_agent.rs` |
| `tickets.rs` | Modèle de demandes/tickets, statuts, commentaires, visibilité |

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

---

## 2. PostgreSQL

### 2.1 Rôle

**Base unique** qui **fusionne** : gestionnaire de sources (projets, repos,
verrous, membres), suivi interne (clients, projets, tâches, décisions — déjà
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
project_members(project_id FK, user_id FK, role, created_at)   -- V1 : tous accès, table pour V2
project_locks(                                -- verrou global projet (UN par projet actif)
  id, project_id UNIQUE, user_id FK, email,
  locked_at, expires_at, urgent BOOL, reason, created_at
)
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

- V1 : **pas de granularité par fichier** — le verrou est **par projet**.
- V1 : tous les inscrits (ayant les codes d'accès serveur) ont accès à **tous**
  les projets (`project_members` est rempli « tout le monde » par défaut ; la
  table est prête pour une restriction V2).
- **Rôles** : `users.role` supporte au minimum `admin` (peut désigner la
  personne autorisée au mode urgent, §5.4) et `dev`. V1 : le premier user
  provisionné est `admin`.

### 2.3 Migrations

- Outil : **sqlx** (compile-time checked, pool natif, migrations embarquées
  `migrations/`) — cohérent avec un pool async sur axum/tokio.
- Le serveur provisionne PostgreSQL : `CREATE DATABASE pilot_gds` + un
  utilisateur dédié (pas `postgres` superuser) avec des droits limités au
  schéma applicatif.
- Migrations versionnées et appliquées **au démarrage du serveur GDS** (ou via
  une commande `gds_migrate`).

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

---

## 4. Dépôt git par projet (centralisé)

- **Objectif** : un repo git **bare** par projet sur le serveur
  (`<gds_repos_dir>/<projet>.git`).
- **Transport** : **SSH (clef liée à l'email du dev)** — arbitrage 2. Gestion
  via `gds_git.rs` (création bare, hooks optionnels `post-receive` pour
  déclencher des notifications/CI).
- **Critère de fin** : clone/fetch/push fonctionnel entre poste et serveur.

---

## 5. Synchronisation, verrou global projet & mode urgent

### 5.1 Synchronisation poste + verrou global projet

- **Objectif** : un dev qui veut **modifier** un projet → **synchronise** sur son
  poste (dossier des projets GDS **paramétrable**, champ de la config projet
  `.pilot/gds.json`),
  le projet est **bloqué côté GDS** pour les autres devs.
- **Verrou global** : `project_locks` (UN par projet). Posé à la sync de
  modification, relâché au push/à la fin. **TTL/lease** (`expires_at`) pour
  nettoyer les verrous orphelins (crash du dev) avec renouvellement périodique.
- **Modules** : `gds_sync.rs`, `gds_web.rs`, `gds_client.rs`, commandes desktop
  `gds_sync_project` / `gds_release_lock` / `gds_urgent_lock`.
- **Critère de fin** : dev A sync → dev B voit le projet **verrouillé** et ne
  peut pas le modifier ; verrou expiré → récupéré automatiquement.

### 5.2 Dossier des projets GDS paramétrable

- **Objectif** : le dossier local où les projets GDS sont clonés est configurable
  (champ `gds_local_dir` de la **config projet** `.pilot/gds.json`, défaut
  `~/Pilot/GDS`), validé à l'activation (§0.4).
- **UI simplifiée** : le champ `gds_local_dir` n'est **plus édité dans l'UI**
  (config simplifiée, §0.4) — le défaut `~/Pilot/GDS` est utilisé, et une valeur
  existante est **préservée** par le backend à la sauvegarde.
- **Critère de fin** : changer le dossier → les futures sync utilisent le nouveau.

### 5.3 Mode urgent (arbitrage 6)

- **Objectif** : permettre à une **personne désignée** de **passer outre** le
  verrou (le projet devient « en conflit potentiel » — log événement +
  avertissement des deux parties).
- **Personne désignée** : le mode urgent est **réservé** à une personne
  désignée (admin/dev/gestionnaire). Un **mécanisme de rôle / gestionnaire de
  verrous** permet de **désigner cette personne parmi les utilisateurs connectés
  au GDS** (champ de la **config du serveur GDS** visé par le projet, ex:
  `gds_urgent_user_email`, contrôlé par un `admin` — pas dans la config Pilot).
- **Comportement** : seul l'utilisateur désigné peut appeler
  `gds_urgent_lock`. Tout autre utilisateur reçoit un refus. Le passage en
  urgent journalise l'événement et avertit les deux parties.
- **Critère de fin** : seul l'utilisateur désigné peut passer en urgent ;
  avertissement + déblocage forcé ; journal de l'événement.

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

### 6.3 Forçage serveur par le titulaire du verrou (arbitrage 1)

- Le dev **titulaire du verrou** (qui a pris le projet en charge) peut
  **forcer la mise à jour serveur** : il a la dernière version tant qu'il n'a
  pas synchronisé. La commande `gds_force_push_suivi` écrase l'état Postgres du
  projet avec l'état local du titulaire (journalisé dans l'audit).

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
- Le **titulaire du verrou** conserve la main : il peut forcer la mise à jour
  serveur (§6.3).

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
- **Git serveur** : repos bare centralisés, droits par utilisateur (V1 : tous),
  hooks `post-receive` optionnels, gestion des gros fichiers (Git LFS si besoin).
- **Verrous / concurrence** : consistance du verrou global (UNIQUE sur
  `project_locks.project_id`), TTL/lease avec renouvellement, récupération après
  crash, avertissement en mode urgent.
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
> Reste la gestion des clefs SSH serveur (Phase A3).

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
(provision serveur, identité, activation par projet, dépôt git bare). Elle ne
couvre **ni** la synchronisation / les verrous (Phase B), **ni** le suivi
fusionné / l'assistant de groupe (Phase C).

**Interfaces prévues pour ouvrir B et C plus tard** (réservées dès la Phase A,
sans implémentation) :
- commandes desktop `gds_sync_project` / `gds_release_lock` / `gds_urgent_lock`
  (Phase B) : noms figés dès la A, mais non disponibles/en erreur explicite
  (« disponible à la Phase B ») tant que B n'est pas livrée ;
- routes API réservées dans `gds_web.rs` (verrous, suivi fusionné, tickets —
  Phases B/C) : noms de routes figés dès la A pour éviter toute rupture d'API ;
- schéma serveur extensible : tables `project_locks` (B), suivi fusionné +
  tickets (C) ajoutées plus tard par migrations sqlx incrémentales, sans
  redécoupage de la base créée en A.

### PHASE B — GDS : synchronisation & verrous

> ✅ **Implémentée** — `cargo test --lib` vert (163 tests).

**B1. Dossier GDS paramétrable + clone/fetch/pull** ✅
- Modules : `gds_client.rs`, config projet `gds_local_dir`, `git.rs`
  (`git_fetch` ajouté). Dépendance : A3.
- Critère : sync d'un projet dans le dossier paramétré.

**B2. Verrou global projet + TTL + mode urgent** ✅
- Modules : `gds_sync.rs`, `project_locks` (migration 0002), commandes desktop
  `gds_sync_project` / `gds_release_lock` / `gds_urgent_lock` / `gds_get_lock`,
  UI. Dépendance : B1.
- Tests : verrou exclusif, TTL récupère un verrou orphelin, urgent passe outre
  (réservé à la personne désignée, arbitrage 6), avertissement des deux parties.
- Critère : §5 complet.

### PHASE C — GDS : suivi fusionné + assistant de groupe

**C1. Migrer/synchroniser le suivi (SQLite → Postgres)** ✅
- Modules : `gds_sync.rs` (pont bidirectionnel), `gds_db.rs`
  (clients/projects/tasks/decisions). Option A + mode déconnecté (arbitrage 1).
- Dépendance : A1, B2. Tests : synchro SQLite↔Postgres, divergence résolue,
  forçage serveur par le titulaire du verrou.
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
- **Branchement** : appelé par `sync_project` (gds_client.rs) après le verrou +
  commande Tauri `gds_sync_tracking` + **déclenchement automatique au démarrage**
  (setup de `lib.rs`, après reconnexion du pool GDS, fail-open).
- **Paramètre global `gds_enabled`** (AppConfig, actif par défaut, issue #75) :
  toggle global distinct de l'activation par projet (.pilot/gds.json) — quand
  désactivé, AUCUNE opération GDS (sync, verrous, suivi fusionné) n'est permise
  (court-circuit des commandes Tauri + routes web).
- Tests : `resolve_conflict`, `parse_updated_at`, `pg_to_sqlite_dt`,
  `ensure_sqlite_column` idempotent, `ensure_sqlite_schema`, mapping id,
  watermark, défaut `gds_enabled`.

**C1.3. Forçage serveur par titulaire du verrou** ✅ — `gds_sync.rs` :
- **Principe** : le membre qui détient le verrou GDS du projet peut **forcer**
  la poussée du suivi local vers Postgres, en **écrasant** les données distantes
  (au lieu du « dernier écrit gagne » du pont C1.2). Utile pour imposer l'état
  local quand le serveur a divergé.
- **Vérification du titulaire** : `force_push_tracking` lit le verrou du projet
  (`get_lock_by_project`) et refuse si le membre courant (`identity_email` de
  `.pilot/gds.json`) n'est pas le titulaire, ou si aucun verrou n'est détenu
  (message « synchronisez d'abord pour acquérir le verrou »). Refus journalisé
  dans `audit_gds` (action `tracking.force.denied`).
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
