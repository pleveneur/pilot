# ROADMAP — GDS (Gestionnaire de Sources) + Composant web de discussion (issue #56)

> **Statut : 🟢 Phase A (bloc serveur) implémentée — B/C à venir.**
>
> Document de planification. La **Phase A (bloc serveur)** est implémentée
> (voir `spec_gds.md` §PHASE A) ; les phases B/C et le composant web restent à
> faire. Chaque chantier passe au **protocole quality-gate**
> (`.pi/skills/quality-gate/SKILL.md`).
>
> **Décision du 29/08/2026 (non négociable)** : le GDS est **activé par projet**
> — chaque projet désigne **son** serveur GDS via `.pilot/gds.json` (activation
> on/off, URL du serveur, identité) ; **ni serveur par défaut, ni config
> globale**. Détail et règles : `spec_gds.md` §0.4 (arbitrage 11). Ce document
> reste synthétique : `spec_gds.md` fait foi.
>
> **Ordre imposé** : le **GDS est un prérequis** au composant web. On ne construit
> pas le composant web avant que le GDS (sources centralisées + suivi fusionné
> dans PostgreSQL) ne soit en place et stable.

---

## 0. Synthèse

- **But final** : remplacer **GitHub** par un **équivalent interne** pour les
  projets de **Kalico System** — sources centralisées, suivi des projets, des
  demandes clients et des tickets, le tout dans **une base unique PostgreSQL**.
- **Deux chantiers imbriqués** :
  1. **GDS** (idée 1) : gestionnaire de sources centralisé sur un **VPS OVH**
     tout-en-un (serveur GDS + PostgreSQL + instance Pilot qui pilote le GDS).
  2. **Composant web** (issue #56) : widget **marque blanche** intégré aux sites
     clients, combinant aide en ligne + remontée de bugs/évolutions + suivi des
     demandes + visibilité des demandes des autres utilisateurs.
- **Dépendance forte** : le composant web s'appuie sur les **tickets** et le
  **suivi** stockés dans PostgreSQL (créés par le GDS). Le GDS doit donc être
  livré d'abord.
- **Activation par projet (décision 29/08/2026)** : chaque projet active le
  GDS lui-même et désigne **son** serveur (`.pilot/gds.json`) — voir
  `spec_gds.md` §0.4.

---

## 1. Architecture cible

### 1.1 Vue d'ensemble (VPS OVH tout-en-un)

```
                        VPS OVH (tout-en-un)
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   ┌───────────────┐   ┌───────────────────────────────┐      │
   │   │  PostgreSQL    │   │  Pilot (instance VPS, mode   │      │
   │   │  (BASE UNIQUE) │   │  serveur / keep-alive)       │      │
   │   │  · gds         │   │  · GDS modules (Rust)        │      │
   │   │  · suivi       │   │  · Assistant de groupe       │      │
   │   │  · tickets     │   │  · web_server.rs (axum)      │      │
   │   │  · git metadata│   │  · API REST + WS             │      │
   │   └───────▲────────┘   └──────────────┬────────────────┘      │
   │           │                           │                        │
   │   ┌───────┴───────────────────────────▼────────────────┐      │
   │   │           Dépôts git (1 repo par projet)           │      │
   │   │   /srv/gds/repos/<projet>.git  (bare repos)        │      │
   │   │   accès : SSH (clefs/email) ou HTTPS (token)       │      │
   │   └────────────────────────────────────────────────────┘      │
   └────────────────────────────────────────────────────────────────┘
              ▲                           ▲
   réseau dev / web clients     navigateurs clients finaux
   (postes dev Pilot)           (widget marque blanche)
```

- **Une seule machine** porte : PostgreSQL + l'instance Pilot (qui joue le rôle
  de « serveur GDS » + héberge l'API web) + les dépôts git.
- Les **postes de dev** (Pilot desktop sur chaque poste) se connectent au VPS
  pour : configurer le GDS, ajouter des projets, **synchroniser** un projet
  (clone/fetch dans un dossier local paramétrable), **verrouiller/déverrouiller**,
  **pousser** leurs commits, et piloter l'**assistant de groupe**.
- Les **clients finaux** accèdent au composant web (widget) via l'API du VPS.

### 1.2 Briques à réutiliser (déjà en place) vs à créer

**Réutilisées (aucune régression attendue) :**

| Brique existante | Fichiers | Rôle dans GDS / composant web |
|---|---|---|
| Serveur web axum + WS | `web_server.rs` | Socle HTTP/WebSocket, fan-out événements, routes `/api/*` |
| Auth web | `web_auth.rs` | Mot de passe argon2 + token opaque révocable, sessions en mémoire |
| Rate limiting | `web_rate.rs` | Garde-fous login/prompt/WS (à étendre aux endpoints GDS/tickets) |
| Audit log | `web_audit.rs` | Journal des actions sensibles (à étendre : sync, verrou, tickets) |
| Git CLI | `git.rs` | Wrapper `git` (status/diff/snapshot) — à étendre pour clone/fetch/push/bare |
| RPC agents pi/plh | `rpc_manager.rs` / `rpc.rs` | Lancer l'assistant de groupe (session RPC dédiée) |
| Super-agent | `super_agent.rs` | Socle du suivi multi-projets / base SQLite → à migrer/augmenter vers Postgres |
| Assistant minimaliste web | `web/` + mode assistant | Pattern d'UI « chat seul » réutilisable pour le composant web |
| Tailscale / serveur distant | `tailscale.rs` | Déploiement réseau VPS (accès admin, optionnel) |
| Multi-projets | `spec_multiprojects.md`, `AppState` | Modèle de collection de projets (à généraliser pour GDS) |

**À créer :**

| Module Rust | Rôle |
|---|---|
| `gds.rs` | Config GDS, auto-provisioning, enregistrement de projet, états (source de vérité côté VPS) |
| `gds_db.rs` | Accès **PostgreSQL** (pool sqlx), schéma, migrations |
| `gds_git.rs` | Gestion des dépôts git serveur (bare), création par projet, hooks (optionnel) |
| `gds_sync.rs` | Synchronisation poste, **verrou global projet** + **mode urgent**, détection de lock obsolète (TTL) |
| `gds_web.rs` | Routes GDS ajoutées à `web_server.rs` (ou module axum dédié) |
| `gds_client.rs` | Côté **poste de dev** : commandes de sync/verrou/push, dossier GDS paramétrable |
| `group_assistant.rs` | **Assistant de groupe** (lecture seule) : questions sur projets + ajout de demandes au suivi — basé sur `super_agent.rs` |
| `tickets.rs` | Modèle de demandes/tickets, statuts, commentaires, visibilité |
| `web_component.rs` | API serveur dédiée au widget marque blanche (issue #56) |

### 1.3 Schéma des couches (logique, côté VPS)

```
Postes dev (Pilot desktop) ─────► GDS API (gds_web.rs) ──► PostgreSQL (gds_db.rs)
Clients finaux (widget) ───────► Composant web API (web_component.rs) ──► PostgreSQL
Pilot VPS (serveur) ───────────► GDS modules ──► dépôts git (gds_git.rs)
Pilot VPS (assistant de groupe) ─► group_assistant.rs (session RPC pi/plh) ─► PostgreSQL
```

- **Une seule base** : Postgres est la source de vérité unique (GDS + suivi +
  tickets + git metadata). SQLite n'est plus la source de vérité côté VPS.
- Le **desktop** continue d'utiliser sa base SQLite locale pour le suivi *local*,
  synchronisée avec Postgres (décision à trancher — §6).

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
session_tracking / audit_gds(ts, ip, subject, action, detail, ok)    -- étendre web_audit
```

- V1 : **pas de granularité par fichier** — le verrou est **par projet**.
- V1 : tous les inscrits (ayant les codes d'accès serveur) ont accès à **tous**
  les projets (`project_members` est rempli « tout le monde » par défaut ; la
  table est prête pour une restriction V2).

### 2.3 Migrations

- Outil : **sqlx** (compile-time checked, pool natif, migrations embarquées
  `migrations/`) — cohérent avec un pool async sur axum/tokio.
- Le VPS provisionne PostgreSQL : `CREATE DATABASE pilot_gds` + un utilisateur
  dédié (pas `postgres` superuser) avec des droits limités au schéma applicatif.
- Migrations versionnées et appliquées **au démarrage du serveur GDS** (ou via
  une commande `gds_migrate`).

### 2.4 Stratégie SQLite → PostgreSQL (cohabitation vs migration)

**Contexte** : le super-agent desktop gère aujourd'hui `~/.pilot/super-agent.db`
(SQLite) : `clients`, `projects`, `tasks`, `decisions`, `session_summaries`,
accessibles via les outils `db_query` / `db_execute`.

**Options à trancher (§6) :**
- **Option A — Postgres source de vérité, SQLite = cache local du desktop.**
  Le desktop continue d'utiliser son SQLite pour le travail local, et **synchrone**
  vers Postgres (projets, tâches, décisions). Le VPS/assistant de groupe lit Postgres.
  → Avantage : aucun impact sur l'assistant local existant. Risque : divergence
  temporaire entre SQLite et Postgres (résolution par un « dernier écrit gagne » /
  clé `updated_at`).
- **Option B — Migration complète vers Postgres.** L'assistant (desktop ET VPS)
  écrit dans Postgres. Plus propre, mais refonte de l'accès base du super-agent
  (remplacer rusqlite par sqlx, `db_query`/`db_execute` branchés sur Postgres) et
  migration des données existantes.
- **Recommandation (à confirmer)** : **Option A en V1** (progression douce,
  zéro régression du super-agent desktop), avec un **pont de synchronisation
  bidirectionnel** (module `gds_sync.rs`) ; **Option B** en V2 si la divergence
  devient gênante.

---

## 3. Fonctionnalités GDS (idée 1)

Chaque fonctionnalité : objectif, modules, critère de fin.

### 3.1 Auto-provisioning du serveur
- **Objectif** : depuis Pilot desktop, un dev **configure le GDS** (adresse VPS,
  accès PostgreSQL, dossier des repos). Si le serveur GDS n'existe pas encore,
  **la base se crée automatiquement** (provision PostgreSQL + migrations + repos).
- **Modules** : `gds.rs`, `gds_db.rs`, commande desktop `gds_provision(server, db, user)`.
- **Critère de fin** : `npm run tauri dev` → onglet « GDS » → « Provisionner » →
  base PostgreSQL créée + migrations appliquées + dossier `/srv/gds/repos` prêt,
  en une commande idempotente.

### 3.2 Configuration GDS depuis Pilot + ajout de projet
- **Objectif** : panneau **« 🌐 GDS »** **du projet** dans Pilot desktop :
  activation on/off, URL du serveur GDS de ce projet, identité (email), dossier
  local de clonage.
- **Activation par projet (décision 29/08/2026)** : la config vit **dans le
  projet** (`.pilot/gds.json` : activation, URL du serveur GDS de ce projet,
  identité) — pas de config globale ni de serveur par défaut. Voir
  `spec_gds.md` §0.4 et §3.2.
- **Ajout de projet** : le dev sélectionne un projet local → Pilot crée le dépôt
  **bare** côté serveur (`gds_git.rs`), l'enregistre dans `projects` (Postgres),
  et fait le `git remote add`/push initial.
- **Modules** : `gds.rs`, `gds_git.rs`, `gds_client.rs`, UI desktop (`src/js/gds-ui.js`).
- **Critère de fin** : ajouter un projet depuis le desktop → dépôt bare visible
  côté serveur, projet listé dans la base, remote configuré sur le poste.

### 3.3 Dépôt git par projet (centralisé)
- **Objectif** : un repo git **bare** par projet sur le VPS (`/srv/gds/repos/<projet>.git`).
- **Transport** : **SSH (clef liée à l'email du dev)** ou **HTTPS (token)** — à
  trancher (§6). Gestion via `gds_git.rs` (création bare, hooks optionnels
  `post-receive` pour déclencher des notifications/CI).
- **Critère de fin** : clone/fetch/push fonctionnel entre poste et serveur.

### 3.4 Accès par adresse email
- **Objectif** : chaque dev est identifié par son **email** (identité du repo git
  + utilisateur de la base). V1 : les inscrits (ayant les codes d'accès serveur)
  accèdent à **tous** les projets.
- **Inscription** : premier user provisionné à l'auto-provisioning ; les suivants
  via l'admin desktop (invitation par email, mot de passe initial) ou auto-ajout
  par clef SSH fournie.
- **Modules** : `gds.rs`, `gds_db.rs` (table `users`), `gds_git.rs` (autorisations clefs).
- **Critère de fin** : deux devs avec deux emails se connectent et voient le même
  ensemble de projets.

### 3.5 Synchronisation poste + verrou global projet + mode urgent
- **Objectif** : un dev qui veut **modifier** un projet → **synchronise** sur son
  poste (dossier des projets GDS **paramétrable**, champ config `gds_local_dir`),
  le projet est **bloqué côté GDS** pour les autres devs.
- **Verrou global** : `project_locks` (UN par projet). Posé à la sync de
  modification, relâché au push/à la fin. **TTL/lease** (`expires_at`) pour
  nettoyer les verrous orphelins (crash du dev) avec renouvellement périodique.
- **Mode urgent** : permet à un second dev de **passer outre** le verrou (le
  projet devient « en conflit potentiel » — log événement + avertissement des
  deux parties). V1 : tout utilisateur peut passer en urgent (à confirmer §6).
- **Modules** : `gds_sync.rs`, `gds_web.rs`, `gds_client.rs`, commandes desktop
  `gds_sync_project` / `gds_release_lock` / `gds_urgent_lock`.
- **Critère de fin** : dev A sync → dev B voit le projet **verrouillé** et ne
  peut pas le modifier ; dev B urgent → avertissement + déblocage forcé ; verrou
  expiré → récupéré automatiquement.

### 3.6 Dossier des projets GDS paramétrable
- **Objectif** : le dossier local où les projets GDS sont clonés est configurable
  (`gds_local_dir`, défaut `~/Pilot/GDS`), validé dans la config.
- **Critère de fin** : changer le dossier → les futures sync utilisent le nouveau.

### 3.7 Branchement de l'assistant
- **Objectif** : une fois le projet synchronisé sur le poste, l'**assistant Pilot
  du dev** a accès au nouveau projet (ouvrable, discutable, modifiable par délégation
  à l'agent du projet). Sur le VPS, l'**assistant de groupe** le suit et répond.
- **Modules** : réutilisation `super_agent.rs` / `group_assistant.rs` ; le projet
  GDS est enregistré comme « projet connu » (liste injectée à chaque tour).
- **Critère de fin** : sur le poste, le projet GDS apparaît dans les projets connus
  de l'assistant ; sur le VPS, l'assistant de groupe parle de ce projet.

---

## 4. Composant web de discussion (issue #56)

### 4.1 Objectif
Un **widget marque blanche** intégré aux sites web des clients finaux. Pour
l'utilisateur final : c'est l'**aide en ligne** + le **système de remontée de
problèmes** de son logiciel. **Aucune mention Pilot/Kalico visible.**

### 4.2 Architecture du widget
- **Intégration** : un **composant** servé par le VPS (`GET /widget.js` + CSS),
  injecté dans la page client via une balise `<script>` (ou `<iframe>`, à trancher
  §6). Le widget est **transparent** : thème neutre, copie personnalisée par
  projet/client (titre du produit, logo), **pas** de branding Pilot.
- **Confidentialité** : tout passe par l'API du VPS ; le widget ne contient
  **aucune** logique serveur, seulement du rendu + WS.
- **Modules** : `web_component.rs` (API + statiques), `web/js/widget.js` (front
  marque blanche), `web/css/widget.css`.

### 4.3 API serveur (nouvelles routes `web_component.rs`)
| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/widget/bootstrap` | Infos d'initialisation pour le widget (projet, client, libellés produits, thème) |
| `POST` | `/widget/login` | Login de l'utilisateur final (email + mot de passe propre au site) |
| `GET` | `/widget/help/search?q=` | Recherche dans la base d'aide (articles par projet/client) |
| `GET` | `/widget/help/:id` | Contenu d'un article d'aide |
| `GET` | `/widget/tickets` | Tickets visibles par l'utilisateur (les siens + ceux du client, §4.6) |
| `POST` | `/widget/tickets` | Remonte un bug / propose une évolution |
| `POST` | `/widget/tickets/:id/comments` | Commente un ticket |
| `GET` | `/widget/tickets/:id` | Détail d'un ticket + suivi |
| `WS` | `/widget/ws` | Mise à jour temps réel des tickets (nouveaux, changement de statut) |

### 4.4 Identification projet / client / utilisateur
- Le projet fournit au widget (au chargement) : `{ project_id, client_id, api_key }`
  → le widget s'authentifie et obtient le **contexte** (libellés, aide, tickets).
- **Utilisateur final** : identifié par **login** (email + mot de passe) propre à
  chaque site ; plusieurs utilisateurs, **demandes propres à chacun** (table
  `users` étendue ou `widget_users` par client).
- **Sécurité** : clef API par projet/client pour isoler les contextes (un site ne
  voit que ses projets/clients) ; tokens de session du widget révocables
  (réutilise le modèle `web_auth.rs`).

### 4.5 Assistant de groupe (lecture seule)
- Le VPS héberge un **assistant de groupe** (moteur pi/plh local, comme le
  desktop) qui : répond aux **questions sur les projets gérés**, **ajoute les
  demandes** (bugs/évolutions) au **suivi (tickets)**, permet le **suivi**.
- **Lecture seule stricte** (réutilise le modèle du super-agent : session RPC
  dédiée, extension de lecture seule) — il **ne modifie pas le code**.
- **Modules** : `group_assistant.rs` (dérivé de `super_agent.rs`), extension
  `pilot-group-assistant.ts` (outils `ticket_create`, `ticket_search`,
  `project_query`), canal d'événements dédié (`__channel: group`).

### 4.6 Gestion des demandes (tickets) + suivi utilisateur
- Une demande (bug/évolution) du widget → **ticket** dans Postgres (`tickets`),
  traité par l'équipe interne **via Pilot** (les devs voient les tickets dans le
  desktop / dans le suivi GDS, les traitent, changent le statut).
- L'utilisateur final suit sa demande : statut (`ouvert`/`en cours`/`en
  correction`/`fermé`), commentaires, **mises à jour temps réel** via WS.
- **Visibilité des autres** : l'utilisateur peut voir les **problèmes remontés
  par d'autres utilisateurs** de son client et en cours de correction (filtre par
  statut ouvert/en cours ; les détails d'un ticket non lié à lui peuvent être
  en lecture seule — à trancher §6).

### 4.7 Critère de fin (MVP complet)
- Le widget s'affiche dans un site client (marque blanche), aide consultable,
  remontée de bug/évolution fonctionnelle, suivi de la demande par l'utilisateur,
  **et** visibilité des demandes des autres — le tout sans aucune mention Pilot/Kalico.

---

## 5. Découpage en phases/étapes ordonné

> Chaque étape : **objectif** · **modules** · **dépendances** · **tests** ·
> **critère de fin**. Chaque étape passe au **quality-gate** avant validation.

### PHASE A — GDS : fondations serveur (prérequis, à faire en premier)

> ✅ **Implémentée (bloc serveur)** — `cargo test --lib` vert. Reste l'UI desktop
> et la gestion des clefs SSH serveur (A3).

**A1. Provisionnement PostgreSQL + socle GDS** ✅
- Objectif : auto-provisioning de la base + connecteur Postgres côté Rust.
- Modules : `gds_db.rs`, `gds.rs` (provision), migration sqlx, config projet `.pilot/gds.json`
  (aucune config globale — décision 29/08, `spec_gds.md` §0.4).
- Dépendances : néant (socle). Tests : unitaires pool/CRUD, migration appliquée.
- Critère de fin : `gds_provision` crée la base + tables depuis un VPS vide.

**A2. Identité & accès par email** ✅
- Objectif : users (email/password_hash), provision premier user, auth réutilisée.
- Modules : `gds_db.rs` (table users), extension de `web_auth.rs`/`web_audit.rs`.
- Tests : login, récupération, révocabilité. Critère : dev identifié par email.

**A3. Dépôt git par projet (serveur)** ✅ (bloc serveur)
- Objectif : création d'un repo bare par projet + remote.
- Modules : `gds_git.rs`, `gds.rs` (add project), `git.rs` (étendu).
- Dépendances : A1, A2. Tests : création bare, clone/push/pull entre deux clones.
- Critère : un projet ajouté → repo bare centralisé + push initial OK.
- **Reste** : gestion des clefs SSH serveur (`authorized_keys` liées à un email).

### PHASE B — GDS : synchronisation & verrous

**B1. Dossier GDS paramétrable + clone/fetch/pull**
- Modules : `gds_client.rs`, config `gds_local_dir`, `git.rs`. Dépendance : A3.
- Critère : sync d'un projet dans le dossier paramétré.

**B2. Verrou global projet + TTL + mode urgent**
- Modules : `gds_sync.rs`, `project_locks`, commandes desktop, UI. Dépendance : B1.
- Tests : verrou exclusif, TTL récupère un verrou orphelin, urgent passe outre,
  avertissement des deux parties. Critère : §3.5 complet.

### PHASE C — GDS : suivi fusionné + assistant de groupe

**C1. Migrer/synchroniser le suivi (SQLite → Postgres)**
- Modules : `gds_sync.rs` (pont bidirectionnel), `gds_db.rs` (clients/projects/tasks/decisions).
- Dépendance : A1, B2. Tests : synchro SQLite↔Postgres, divergence résolue.
- Critère : le suivi desktop apparaît dans Postgres (décision §6.1).

**C2. Assistant de groupe (lecture seule)**
- Modules : `group_assistant.rs` (dérivé de `super_agent.rs`), extension
  `pilot-group-assistant.ts`, canal `__channel: group`.
- Dépendance : C1. Tests : session RPC, questions sur projets, lecture seule
  stricte. Critère : assistant de groupe répond + lit le suivi sans modifier le code.

### PHASE D — Composant web (issue #56) — UNIQUEMENT après A/B/C stables

**D1. API tickets & contexte widget**
- Modules : `web_component.rs` (routes §4.3), `tickets.rs`, `gds_db.rs` (tickets/
  ticket_comments/ticket_events), `web_rate.rs`/`web_audit.rs` étendus.
- Dépendance : A1, A2, C1. Tests : création ticket, statuts, pagination, isolation client.
- Critère : API complète + isolation par clef projet/client.

**D2. Widget marque blanche (front)**
- Modules : `web/js/widget.js`, `web/css/widget.css`, endpoint `/widget/*`.
- Dépendance : D1. Tests : rendu dans une page tierce, login utilisateur final,
  aide, remontée, suivi, visibilité des autres. Critère : §4.7 MVP complet.

**D3. Assistant de groupe → remontée dans le suivi**
- Objectif : l'assistant de groupe **ajoute les demandes** au suivi (tickets) et
  répond aux questions des utilisateurs du widget.
- Modules : `group_assistant.rs` (outils ticket_create/search), `tickets.rs`.
- Dépendance : C2, D1. Critère : une demande posée au widget → ticket visible
  côté interne + suivi utilisateur à jour.

---

## 6. Décisions ouvertes — à trancher avec l'utilisateur

1. **Migration SQLite → PostgreSQL du suivi existant** : Option A (Postgres source
   de vérité, SQLite = cache local du desktop, pont de sync) vs Option B (migration
   complète de l'assistant vers Postgres). → *Recommandé : A en V1, B en V2.*
2. **Transport git entre poste et VPS** : SSH par clef liée à l'email vs HTTPS avec
   token (généré par le GDS) vs les deux. → *Impacte `gds_git.rs` et l'inscription.*
3. **Accès réseau au VPS** : public avec **reverse proxy Caddy/Nginx + TLS auto**
   (Let's Encrypt) pour le widget et l'API, vs **Tailscale** seul pour l'admin GDS.
   → *Le widget DOIT être accessible depuis le web public (marque blanche) ; l'admin
   GDS peut rester sur réseau privé/Tailscale.*
4. **Format du widget** : `<script>` injecté (SPA légère dans la page client) vs
   `<iframe>` (isolation complète, plus simple mais plus lourd visuellement). → *Recommandé :
   iframe pour l'isolation de marque + sécurité, script pour un rendu natif. À trancher.*
5. **Identité / login utilisateur final** : email + mot de passe par site (table
   `widget_users` par client) ; qui crée les comptes (auto-inscription, invitation
   par le site, ou comptes administrés par Kalico) ?
6. **Mode urgent** : qui peut passer outre le verrou ? (tout utilisateur / seul
   l'admin / un quota) → *V1 proposé : tout utilisateur, avec journal + avertissement.*
7. **Visibilité des tickets des autres** : un utilisateur voit-il tous les tickets
   du client, ou seulement les siens + un flux « problèmes en cours » filtré ? → *V1
   proposé : voir tous les tickets du client en lecture, détail complet seulement si
   le ticket est le sien (ou admin).*
8. **Assistant de groupe : modèle** : pi/plh **local au VPS** (clé API cloud) vs
   modèle Ollama/local ; réutilise-t-il la session super-agent ou une session dédiée
   `group` ? → *Recommandé : session dédiée `__channel: group`, moteur configurable.*
9. **Sécurité des tickets/remontée publique** : anti-spam (rate limit widget login/
   tickets), validation des contenus, quotas par utilisateur, modération avant
   publication ?
10. **Hébergement VPS** : dimensionnement OVH (RAM/CPU/disque), sauvegardes
    PostgreSQL (pg_dump planifié), monitoring. Qui gère l'OS/VPS ?

---

## 7. Risques & prérequis techniques

- **Sécurité réseau VPS** : pare-feu (ufw), pas de port inutile exposé, SSH
  configuré (clefs, pas de root direct), fail2ban. Le widget étant **public**, la
  surface d'attaque augmente → isolation stricte des contextes client par clef API.
- **HTTPS/accès** : TLS obligatoire pour le widget (Caddy/Nginx auto-cert) ; cookies
  Secure/HttpOnly ; CORS restreint aux domaines clients autorisés (liste blanche).
- **Git serveur** : repos bare centralisés, droits par utilisateur (V1 : tous), hooks
  `post-receive` optionnels (notification, déclencheur d'assistant), gestion des
  gros fichiers (Git LFS si besoin).
- **Verrous / concurrence** : consistance du verrou global (UNIQUE sur
  `project_locks.project_id`), TTL/lease avec renouvellement, récupération après
  crash, avertissement en mode urgent.
- **PostgreSQL** : sauvegardes planifiées (pg_dump), migrations versionnées (sqlx),
  pool configuré (max_connections), index sur `tickets.status` / `tickets.client_id`.
- **Assistant de groupe** : coût/ressources du moteur pi/plh sur le VPS (clé API
  cloud vs local), isolation de la session, garantie **lecture seule stricte**.
- **Cohabitation SQLite/Postgres (si Option A)** : divergence temporaire, résolution
  par clé `updated_at` + log des conflits.
- **Opérations** : documentation de déploiement VPS, secrets (clef de signature,
  mot de passe DB, clef API) hors du code (env vars / `.env` non versionné),
  `cargo audit` sur les nouvelles dépendances (sqlx, postgres driver).

---

## 8. Points nécessitant un arbitrage utilisateur (à valider AVANT de lancer)

En plus de la **validation globale de ce document**, je te demande un arbitrage
sur les points suivants :

1. **Ordre & périmètre V1 du GDS** : valides-tu le découpage A→B→C (fondations →
   sync/verrous → suivi/assistant) avec **verrou par projet** (pas par fichier) en V1 ?
2. **Migration SQLite → Postgres** : Option A (cohabitation + pont de sync) ou
   Option B (migration complète) pour le suivi du super-agent ?
3. **Transport git poste↔VPS** : SSH par clef (email) ou HTTPS avec token ?
4. **Accès réseau** : le widget est-il **public** (reverse proxy + TLS auto) et
   l'admin GDS sur **réseau privé/Tailscale** ?
5. **Format du widget** : `<iframe>` ou `<script>` injecté ?
6. **Comptes utilisateurs finaux** : qui crée les comptes du widget (auto /
   invitation / administrés) ?
7. **Mode urgent** : qui peut passer outre le verrou projet ?
8. **Visibilité des tickets des autres utilisateurs** : niveau de lecture autorisé.
9. **Assistant de groupe** : moteur (cloud vs local) et session dédiée `group`.
10. **Dimensionnement / sauvegardes du VPS OVH** : qui provisionne et maintient l'OS ?

---

*Voir aussi : `spec_web_remote.md` (web-server/axum existant), `spec_super_agent.md`
(suivi multi-projets + base SQLite), `spec_multiprojects.md` (collection de projets),
`git.rs` (wrapper git CLI), `AGENTS.md` (architecture & conventions).*
