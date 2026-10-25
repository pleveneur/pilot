# PLAN — Mode réseau multi-postes de Pilot (v4.1)

> **v4.1 — les deux points restés ouverts en fin de mission sont tranchés et écrits** (A1, A2), sans rouvrir aucune décision. **A1 — où tournent les tests de portage** : la base de test est fournie par le job `tests` du workflow **manuel** de l'image serveur (`.github/workflows/gds-server-image.yml`, service **PostgreSQL 16 jetable**) et par une **commande locale documentée** (`docs/gds-server-setup.md` §11, variable `PILOT_GDS_TEST_URL`) ; **`release.yml` n'est pas concerné** — il ne lance pas les tests du socle — et n'est **pas** modifié ; **un test de portage ne doit JAMAIS passer sans base**. **A2 — cas symétrique de D4** : publication du code réussie puis mort du poste **avant** `return` → le projet reste tenu jusqu'à l'expiration (15 minutes au plus), le code publié **n'est pas perdu**, **rien n'est supprimé localement**, **aucune intervention n'est nécessaire**. Les **12 décisions fermes** (§11) et les **5 réglages validés** (§3) sont **intacts au mot près**.
>
> **v4 — les 7 risques de la relecture sont tranchés** (arbitrages du propriétaire, D1→D7) : ce que veut dire « transmis au seul serveur GDS du projet » pour `poste_id`, `poste_id` par **machine** et non par projet, garde **strict** des tests base obligatoires, **ordre de la restitution** (le code est publié AVANT que le projet soit libéré), glossaire « agent du projet » / « assistant de suivi », sort du **travail local d'un poste non porteur**, portée réelle de `GET /api/gds/handover/state`. Rien d'autre ne change : les **12 décisions fermes** (§11) et les **5 réglages validés** (§3) sont intacts. Détail des arbitrages : `RAPPORT-relecture-plan-reseau.md` §8.
>
> **Ce qui change par rapport à la v2** (relecture indépendante ; rien n'est implémenté ici) : les **dix renvois `fichier:ligne` faux sont corrigés** et revérifiés un par un sur le disque ; les **formulations contradictoires sont alignées** (« tenu par X, jusqu'à HH:MM » partout, « répondre sur l'avancement », lecture seule stricte d'un projet tenu par un autre poste, mémoire et consignes qui restent des fichiers du dépôt) ; et les **cinq points bloquants reçoivent leur solution écrite** (reprise dans la même transaction, `poste_id` UUID stable, expiration paresseuse sans job planifié, restitution scindée socle/poste, routes et schémas nommés, tests de routes obligatoires sur base). Les **12 décisions fermes** (§11) et les **5 réglages validés** (§3) sont conservés tels quels : ils appartiennent au propriétaire. Les points restés en désaccord sont signalés, pas corrigés — voir `RAPPORT-relecture-plan-reseau.md`.

> Rédigé à partir du cahier des charges du propriétaire, qui fait foi. Les informations projet partent au fil de l'eau, toutes les 3 minutes, **pendant** le travail ; la restitution est le moment où l'on pousse l'état d'avancement final, où l'on libère le projet et où l'on vérifie que tout est à jour.

## 1. Le principe, en une phrase

Le projet reste ce qu'il est déjà : des sources dans Git. Ce que le mode réseau apporte, c'est que **les informations du projet** (tâches, décisions, état d'avancement) suivent le projet d'un développeur à l'autre, par le serveur GDS déjà installé — aucun logiciel supplémentaire, aucun second serveur. Un seul développeur tient un projet donné à la fois ; il le rend quand il a fini ; celui qui le reprend trouve les informations à jour.

À un instant donné, ce qui fait foi pour tous les développeurs est ce qui est sur le serveur GDS : le code du projet, et les informations projet. Ce qui n'a pas été poussé sur le serveur n'existe pas pour les autres : ce n'est jamais compté comme fait, et le point de reprise le signale comme « à refaire ».

### La frontière code / agents (règle explicite)

- **Un projet tenu par un autre poste s'ouvre en LECTURE SEULE** : aucune modification de fichier du projet n'est possible depuis ce poste, et **aucun agent n'est lancé sur ce projet**. L'exclusivité ne couvre pas seulement les tables du suivi : elle couvre aussi l'écriture des fichiers du projet et le travail des agents.
- **Le code continue de voyager par Git**, exactement comme aujourd'hui (clone / fetch / pull / push), mais **on ne le modifie pas depuis un poste qui ne tient pas le projet**. Lire, consulter, comparer reste possible ; écrire ne l'est pas.
- Corollaire : le poste qui ne tient pas le projet **lit** les informations projet et **répond** aux questions sur l'avancement (pour son développeur comme pour son assistant), et **n'écrit jamais** : ni fichier, ni information projet.

### Glossaire — « agent du projet » et « assistant de suivi »

Le mot « agent » désigne deux choses différentes dans ce plan, et les décisions 3 et 8 ne parlent pas du même :

- **agent du projet** : un agent qui travaille sur les fichiers du projet. Il est **interdit à un poste non porteur** (décisions 3, 4 et 5).
- **assistant de suivi** : l'assistant du développeur, qui lit les informations projet et répond aux questions. Il est **autorisé à tout moment**, en **lecture seule** (décision 8), y compris sur un projet tenu par un autre poste.

Ce glossaire ne modifie aucune décision : il lève une ambiguïté de vocabulaire.

### Le travail local d'un poste non porteur n'est jamais perdu

Les modifications locales **déjà présentes** sur un poste qui ne tient pas le projet **NE SONT JAMAIS supprimées ni écrasées**. Elles **restent locales**, elles **ne peuvent pas être publiées** tant que le projet n'est pas pris en main, et l'interface l'indique clairement : le **bandeau** le dit, et une **action « prendre le projet pour publier »** est proposée. **Aucune fusion automatique, aucune poussée silencieuse.**

## 2. Le cycle, en 4 temps

| # | Temps | Ce que fait le développeur | Ce que fait Pilot | Ce que voit le serveur |
|---|---|---|---|---|
| 1 | **Prendre en main** | il ouvre le projet | il demande le projet au serveur. Libre → il le prend, le projet est marqué « tenu par X, jusqu'à HH:MM ». Tenu par un autre → il l'ouvre en **lecture seule** avec un bandeau « tenu par X, jusqu'à HH:MM ». | le projet passe à l'état « tenu », avec le porteur et l'échéance |
| 2 | **Travailler** | il modifie le code (Git, comme aujourd'hui) **et** les informations du projet (tâches, décisions, où on en est) | il travaille normalement ; les agents du projet travaillent aussi, sous la même exclusivité ; **un projet tenu par un autre poste n'est ni modifiable ni ouvert aux agents** | à chaque cycle de 3 minutes, **un seul appel** arrive : présence **et** informations projet (décision 7) ; le projet est tenu par ce poste |
| 3 | **Restituer** | il a fini, il rend le projet | **c'est le geste de clôture** : les informations du projet sont poussées une dernière fois, l'état d'avancement est mis à jour, le projet est **libéré** | les informations du projet sont à jour et le projet redevient libre |
| 4 | **Le suivant reprend** | il prend le projet en main à son tour | il **récupère** les informations à jour : décisions, où on en est | le projet passe au nouveau porteur |

Le point clé : **les informations circulent en continu, toutes les 3 minutes**, et la restitution est le moment de clôture : l'état d'avancement est à jour, le projet est libéré. Le code, lui, ne dépend pas de ce cycle : il suit Git comme avant, indépendamment.

### Les deux synchronisations

- **Synchro de fond** — automatique, toutes les 3 minutes, silencieuse et jamais bloquante (aucun verrou attendu, aucune file, aucune attente) : elle transporte uniquement les informations du projet, jamais un fichier de code. **Un cycle = un seul appel** (présence + informations) ; l'appel de prise (`take`) ne sert jamais à la présence.
- **Synchro manuelle** — le geste volontaire du développeur : elle rend le projet, pousse une dernière fois les informations du projet, et **c'est le poste qui publie le code** sur le GDS quand le projet y est activé (dans ce cas, aucune publication GitHub). Hors GDS activé, elle ne publie aucun code : celui-ci reste dans Git comme avant.
- **La synchro manuelle est une séquence ORDONNÉE côté poste** (détail en §6 b, réalisation à l'étape 4) : (1) si le projet est activé sur le GDS, publier le code (commit + push) ; (2) pousser l'état d'avancement ; (3) **seulement ensuite**, appeler `return`. **On ne libère jamais un projet avant que son code soit publié** : si l'étape 1 ou 2 échoue, la restitution n'est pas faite, le poste reste porteur, le bandeau le dit, et l'opération est rejouable.

## 3. Réglages validés par le propriétaire

| # | Réglage | Valeur retenue |
|---|---|---|
| 1 | Libération automatique d'un projet tenu mais abandonné | **15 minutes** sans nouvelle, avec un signal de présence toutes les **3 minutes** |
| 2 | Ce que voit un développeur sur un projet tenu par un autre | **lecture seule**, avec un bandeau « tenu par X, jusqu'à HH:MM » — il n'est pas empêché d'ouvrir. Les informations du projet restent **lisibles et à jour** pour ce développeur comme pour son assistant, qui peut donc **répondre sur l'avancement** du projet. En revanche il ne modifie aucun fichier du projet et ne lance aucun agent sur ce projet (§1). |
| 3 | L'exclusivité couvre-t-elle les agents ? | **oui** : aucun agent ne travaille sur un projet tenu par un autre poste |
| 4 | Qui peut libérer un projet tenu | **un administrateur seul**, avec un motif obligatoire, inscrit au journal d'audit du serveur |
| 5 | L'état d'avancement est-il poussé automatiquement à la restitution ? | **oui** : c'est ce qui permet au suivant de reprendre sans relire le projet |

## 4. Ce qui est partagé / ce qui reste privé

| Information | Partage | Pourquoi |
|---|---|---|
| Sources du projet (le code) | **Hors périmètre — Git** | Le projet reste la partie Git existante. La synchro de fond ne transporte aucun fichier de code ; seul le geste manuel de synchronisation, déclenché par le poste, publie le code sur le GDS, et uniquement quand le projet y est activé (dans ce cas, aucune publication GitHub). |
| Projets et clients du suivi | **Partagé** | Déjà en base serveur (`0004_suivi.sql`), socle du suivi commun. |
| Tâches et leur état | **Partagé** | Table `tasks` (`gds-core/migrations/0004_suivi.sql:29`). |
| Décisions | **Partagé** | Table `decisions` (`gds-core/migrations/0004_suivi.sql:43`) : « l'important » d'un projet. |
| Mémoire du projet (`PROJECT_MEMORY.md`) | **Partagé — fichier du dépôt** | Ce n'est pas une donnée à transporter : c'est un **fichier du dépôt**, source unique, qui **voyage déjà avec le code par Git**. Le serveur ne le duplique pas. |
| Consignes du projet (`AGENTS.md`, spec du projet) | **Partagé — fichiers du dépôt** | Même règle : règles du projet, utiles à tous les agents du projet, **source unique dans le dépôt**, transportées par Git. |
| État d'avancement (« où on en est ») | **Partagé — seul contenu de `project_info`** | Permet au suivant de reprendre sans relire 40 fichiers. C'est le **seul** contenu que la table serveur `project_info` transporte (`kind = etat_avancement`). |
| Qui tient le projet, et jusqu'à quand | **Partagé** | C'est l'objet même de la coordination. |
| Lecture des informations projet par un poste qui ne tient pas le projet | **Ouverte à tous, tout le temps** | L'exclusivité ne porte que sur l'écriture ; c'est ce qui permet à l'assistant de n'importe quel développeur de répondre sur l'avancement. |
| Écriture des fichiers du projet et lancement d'agents sur le projet | **Réservée au porteur** | Un projet tenu par un autre poste s'ouvre en lecture seule : aucune modification de fichier, aucun agent du projet (§1). Le travail local **déjà présent** sur un poste non porteur n'est jamais supprimé ni écrasé : il reste local, non publiable, et l'interface le dit (§1). |
| Historique de conversation (transcripts, `.pilot/sessions/`, `.pilot/sessions.jsonl`) | **Privé** | Échanges personnels ; seuls le résumé et les décisions sont extraits vers le projet. |
| Instructions / prompt de l'assistant (`~/.pilot/assistant/`) | **Privé** | Personnalisation du développeur. |
| Réglages, préférences, thème, voix | **Privé** | Réglages de poste. |
| Modèles, fournisseurs, clefs d'API | **Privé** | Appartiennent au compte du développeur. |
| Clefs GDS/SSH, `vault.json`, `gds_secrets.json` | **Privé** | Secrets ; ne quittent jamais le poste. |
| Rappels programmés, mémoire personnelle de l'assistant | **Privé** | Déjà classés « toujours locaux » (`spec_assistant_sync.md:60`). |
| Index de contexte (`.pilot/context-index.db`), wiki du graphe | **Local, reconstructible** | Dérivés des informations partagées ; inutile à transporter. |
| Projets non connectés au GDS | **Jamais** | Hors périmètre réseau. |

### 4 bis. Une seule source pour la mémoire et les consignes

`PROJECT_MEMORY.md` et `AGENTS.md` restent des **fichiers du dépôt**, source unique : ils voyagent déjà avec le code par Git, il n'y a donc **rien à en dupliquer** en base. La table `project_info` ne transporte **que l'état d'avancement** (`kind = etat_avancement`). La v2 laissait croire que mémoire et consignes seraient poussées dans `project_info` (deux sources → divergence garantie) : c'est corrigé ici.

## 5. Existant réutilisable

- **Comptes et jetons** : `gds-core/src/auth.rs`, route de connexion `gds-core/src/http.rs:121-123`.
- **Rôles** : `gds-core/src/roles.rs:118`, garde `require_admin` `gds-core/src/http.rs:900`.
- **Projets** : `get_project_by_name` (`gds-core/src/db.rs:591`), `create_project` (`gds-core/src/db.rs:601`), table `projects` (`gds-core/migrations/0001_init.sql:18`).
- **Suivi fusionné** : `0004_suivi.sql`, `list_tracking_projects` (`gds-core/src/db.rs:1123`), routes `/api/gds/tracking/*` (`http.rs:135-166`), pont `src-tauri/src/gds_sync.rs`.
- **Migrations incrémentales** : `gds-core/migrations/0001…0007` (ne jamais renuméroter — voir `0007_drop_project_locks.sql:8-10`). Toute nouvelle migration doit être écrite **en fins de ligne LF** : le test `db::tests::embedded_migrations_are_lf` (`gds-core/src/db.rs:1886-1907`) échoue sinon (une migration CRLF invalide l'empreinte SHA-384 du registre `_sqlx_migrations`).
- **Socle partagé bureau ↔ serveur** : le service monte `server_router` (`gds-core/src/http.rs:212`), qui fusionne `gds_routes` (`http.rs:217`) derrière `auth_middleware` ; côté poste, la fusion réelle de `gds_core::http::gds_routes` est `src-tauri/src/gds_web.rs:64` (la ligne 19 n'est qu'un commentaire) : une route ajoutée au socle sert aux deux.
- **Audit** : table `audit_gds` (`0001_init.sql:49`), fonction `audit_gds` (`gds-core/src/db.rs:939`), écriture du journal web `gds-core/src/audit.rs:163`.
- **Garde d'écriture déjà écrite** : `ensure_project_publisher` (`gds-core/src/db.rs:1748`) — modèle à imiter pour la garde du projet tenu.
- **Ouverture d'un projet déjà connecté (point d'accroche réel de la prise en main)** : le front appelle `invoke("gds_sync_project")` (`src/js/sidebar.js:471`), donc la commande `gds_sync_project` (`src-tauri/src/gds_client.rs:177`). `gds_connect_existing` (`src-tauri/src/gds.rs:2431`) est une **commande distincte** (connecter un dossier existant) : elle n'appelle **pas** `gds_sync_project` et n'est donc **pas** le point d'accroche. Autres commandes utiles : `gds_provision` (`gds.rs:1783`), route `POST /api/gds/sync` (`gds_web.rs:48`).
- **Voie service (client HTTP du poste)** : `src-tauri/src/gds_service.rs` — `force_push_tracking` (`gds_service.rs:552`) et les routes du suivi qu'il appelle (`/api/gds/tracking/clients|projects|tasks|decisions`, `gds_service.rs:569-596`).
- **Interface et tests GDS** : `src/js/gds.js`, `gds-admin.js`, `gds-params.js`, `gds-status.js` ; tests `gds-admin.test.js`, `gds-params.test.js`, `gds-e2e-isolation.test.js`, `gds-status.test.js`.
- **Marqueur de dernière synchronisation** (à ne pas confondre avec une file) : table `gds_sync_state` (`src-tauri/src/gds_sync.rs:113`), clé `last_sync_ms`, lue/écrite par `get_watermark` / `set_watermark` (`gds_sync.rs:380-400`).

## 6. Ce qui manque côté serveur

### 6 a) La prise en main d'un projet — migration `0008_project_handover.sql`

Nouvelle table (**pas** un retour de `project_locks`, supprimée par `0007`) :

```sql
project_handovers(
    id            BIGSERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL REFERENCES projects(id),
    user_id       BIGINT NOT NULL REFERENCES users(id),
    poste_id      TEXT   NOT NULL,
    taken_at      TIMESTAMPTZ NOT NULL,
    heartbeat_at  TIMESTAMPTZ NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    returned_at   TIMESTAMPTZ NULL,          -- NULL tant que le portage est actif
    returned_by   TEXT NULL CHECK (returned_by IN ('self', 'expiration', 'admin')),
    return_reason TEXT NULL,                 -- obligatoire quand returned_by = 'admin'
    sync_at       TIMESTAMPTZ NULL           -- NULL tant que la restitution n'a pas eu lieu
)
```

- **Types SQL explicites** : `taken_at`, `heartbeat_at`, `expires_at` en `TIMESTAMPTZ NOT NULL` ; `returned_at` et `sync_at` en `TIMESTAMPTZ` **NULL** tant que l'action correspondante n'a pas eu lieu ; `returned_by` prend une valeur parmi `self`, `expiration`, `admin`, et le **motif (`return_reason`) est obligatoire pour `admin`**.
- **Index unique partiel** `project_handovers_active_key ON project_handovers(project_id) WHERE returned_at IS NULL` : un seul porteur actif — c'est la base de données elle-même qui garantit l'exclusivité, pas seulement le code.
- **Historique conservé** : la ligne est clôturée (`returned_at`), jamais supprimée → on garde la trace de qui a tenu le projet et quand.
- Migration écrite **en LF** (sinon `embedded_migrations_are_lf`, `gds-core/src/db.rs:1886-1907`, échoue).

**`poste_id`** — un identifiant **par machine, pas par projet** : il est généré **UNE fois** pour la machine (UUID), conservé dans la **configuration locale de l'application**, puis **recopié à l'identique dans la configuration GDS de chaque projet**. La même machine présente donc **le même `poste_id` sur tous les projets**, ce qui rend l'idempotence du `take` (même `user_id` + même `poste_id` = renouvellement, pas une nouvelle prise) **valable projet par projet**. Il sert aussi à distinguer **deux machines du même compte utilisateur**.

**Transmission de `poste_id`** : « `poste_id` est transmis au seul serveur GDS du projet, jamais à un autre service ni à un tiers. »

### 6 b) Les règles du portage — `gds-core/src/handover.rs` + routes

**Expiration PARESSEUSE** : l'expiration est évaluée **au moment de chaque lecture et de chaque écriture** (`expires_at < now()`). **Aucun job planifié côté serveur** : le plan ne cite aucun fichier de tâche périodique et n'en crée pas.

- **`take`** — **répétable sans doublon** : même `user_id` + même `poste_id` → renouvellement, pas de nouvelle ligne ; autre porteur **non expiré** → refus **409** avec le porteur et l'échéance ; porteur **expiré** → reprise autorisée.
- **Reprise après expiration, dans la MÊME transaction** : la prise en main **ferme elle-même la ligne expirée** — `returned_at = now()`, `returned_by = 'expiration'`, `return_reason = 'portage expiré après 15 minutes sans présence'` — **puis** insère la nouvelle ligne. Aucun balayage périodique, aucun job planifié. C'est ce qui rend l'index unique partiel (« un seul porteur actif ») **compatible avec la reprise**.
- **`heartbeat`** — seul le porteur peut signaler sa présence ; **UN SEUL appel par cycle de 3 minutes**, qui porte **la présence ET l'envoi des informations projet**. La prise (`take`) ne sert qu'à la prise en main, **jamais à la présence**.
- **`return` (restitution) — scindée** :
  - dans le **socle partagé** (`gds-core`) : **seulement les règles pures et la clôture de la ligne avec `sync_at`**. **Aucune publication de code, aucun appel réseau sortant** — le serveur ne peut pas publier le code d'un poste.
  - c'est **le poste** qui déclenche la synchronisation des informations et, si le projet est activé sur le GDS, la publication du code (`src-tauri/src/gds_client.rs` / `git push`), à l'étape 4 du tableau de réalisation.
- **Ordre de la restitution — la seule séquence retenue (côté poste)** :
  1. si le projet est activé sur le GDS : publier le code (commit + push) ;
  2. pousser l'état d'avancement ;
  3. **seulement ensuite**, appeler `return`.

  Si l'étape 1 ou 2 échoue, **la restitution n'est pas faite** : le poste reste porteur, le bandeau le dit, et l'opération est **rejouable**. Autrement dit : **on ne libère jamais un projet avant que son code soit publié**. Le cas « `return` réussi puis `git push` échoué » ne peut donc pas se produire — l'ordre l'interdit. Le filet de sécurité reste l'**expiration à 15 minutes** (§3 réglage 1), qui couvre le poste qui meurt en cours de route.
- **`force_return`** — **réservée au rôle `admin`** (`require_admin`), **motif obligatoire**, écriture `audit_gds` action `handover.force_return` + `returned_by` / `return_reason`.
- **Moment de la prise en main** : à l'**ouverture d'un projet déjà connecté au GDS** (`src/js/sidebar.js:471` → `gds_sync_project`, `src-tauri/src/gds_client.rs:177`) — jamais à la création du projet, et pas par `gds_connect_existing` (commande distincte, `src-tauri/src/gds.rs:2431`).

**Routes concrètes, toutes dans le socle partagé** (`gds-core/src/http.rs`) :

| Route | Rôle |
|---|---|
| `POST /api/gds/handover/take` | prendre / renouveler la prise en main |
| `POST /api/gds/handover/heartbeat` | **un seul appel par cycle de 3 min** : présence + informations projet |
| `POST /api/gds/handover/return` | restitution (clôture de la ligne + `sync_at`) |
| `GET /api/gds/handover/state` | **lecture, ouverte à tout membre** : qui tient le projet, jusqu'à quand |
| `POST /api/gds/handover/force` | libération forcée — placée dans **`admin_routes`** (`gds-core/src/http.rs:214`, qui applique déjà `require_admin` à toutes ses routes) |

**Portée de lecture de `GET /api/gds/handover/state` — écrite telle quelle, sans promesse** : en **V1**, « tout membre » signifie **« tout compte authentifié »**, car le code existant n'a **pas** de notion de membre actif par projet — la V1 ouvre tous les projets à tous les inscrits (`gds-core/migrations/0001_init.sql:30-31`) et la garde d'écriture ne dépend plus que du rôle (`ensure_project_publisher`, `gds-core/src/db.rs:1748` ; `can_force_publish`, `gds-core/src/roles.rs:112-123`). La **restriction réelle par projet** est notée comme **évolution future**, pas comme acquise.

### 6 c) Le partage de l'avancement — migration `0009_project_info.sql`

Aujourd'hui `gds_sync.rs` ne traite que clients / projets / tâches / décisions (en-tête `src-tauri/src/gds_sync.rs:1-7`).

```sql
project_info(
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id),
    kind       TEXT NOT NULL CHECK (kind IN ('etat_avancement')),
    body       TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by BIGINT REFERENCES users(id)
)
-- plus : UNIQUE(project_id, kind)
```

- **`kind` est limité à `etat_avancement`** : `PROJECT_MEMORY.md` et `AGENTS.md` restent des **fichiers du dépôt**, source unique, qui voyagent déjà par Git (§4 bis). Rien à dupliquer en base.
- Routes d'écriture dans le socle, **acceptées seulement sous portage actif** ; lecture toujours autorisée pour un membre du projet (c'est ce qui permet de reprendre).
- Migration écrite **en LF** (même test qu'en 6 a).

### 6 d) La garde d'écriture

Toute route d'écriture de projet (suivi, informations, restitution) vérifie le portage actif **avant** d'écrire. Le « dernier qui écrit gagne » (`gds-core/src/db.rs`, `spec_gds.md:908`) cesse d'être le mécanisme de cohérence. **Aucun job planifié n'est ajouté** : l'expiration est paresseuse (§6 b).

## 7. Étapes de réalisation

| # | Livré | Agent | Fichiers | Test qui le prouve |
|---|---|---|---|---|
| 1 | Table + règles pures du portage (prise, présence, restitution, expiration, idempotence) | codeur Rust socle | `gds-core/migrations/0008_project_handover.sql`, `gds-core/src/handover.rs`, `gds-core/src/lib.rs` | `cargo test -p gds-core` (module `handover`) — **sans base** ; la migration est en **LF** (test `db::tests::embedded_migrations_are_lf`, `gds-core/src/db.rs:1886-1907`) |
| 2 | Base du portage (take / heartbeat / return / force_return / lecture), reprise **dans la même transaction** | codeur Rust socle | `gds-core/src/db.rs` | `cargo test -p gds-core` : **base PostgreSQL obligatoire** via `PILOT_GDS_TEST_URL`, avec la **garde STRICTE** de la §7 (helper dédié qui **échoue** avec un message explicite si la variable est absente) — **deux prises concurrentes, une seule réussit, l'autre reçoit un refus** |
| 3 | Routes partagées `/api/gds/handover/*` (+ force dans `admin_routes`) | codeur Rust socle | `gds-core/src/http.rs` | `cargo test -p gds-core` : 409 pour un 2e dev, 200 pour l'admin, 403 pour un non-admin — **base PostgreSQL obligatoire** via `PILOT_GDS_TEST_URL`, même **garde STRICTE** que l'étape 2 |
| 4 | Poste : prise en main à l'ouverture, présence périodique (1 appel/cycle), **restitution dans l'ordre du §6 b** (code publié → état d'avancement → `return`), écritures refusées hors portage | codeur Rust desktop | `src-tauri/src/gds_client.rs`, `src-tauri/src/gds.rs`, `src-tauri/src/gds_sync.rs`, `src-tauri/src/gds_service.rs` (voie service : `force_push_tracking` ligne 552, routes `/api/gds/tracking/*` lignes 569-596), `src-tauri/src/lib.rs` (**enregistrement de toute nouvelle commande dans `tauri::generate_handler!`**, ligne 3535 ; entrées GDS voisines 3854-3884), `src-tauri/src/gds_web.rs` lignes 43-51 **si** une route propre au poste est ajoutée | `cargo test --manifest-path src-tauri/Cargo.toml --lib` |
| 5 | Interface : bandeau « tenu par X, jusqu'à HH:MM », **lecture seule (aucune modification de fichier, aucun agent du projet lancé)**, **travail local non publiable signalé** avec l'action « prendre le projet pour publier » (§1), bouton de restitution, bouton admin « Libérer » tracé | codeur front | `src/js/gds.js`, `src/js/gds-status.js`, `src/js/gds-admin.js` | `npx vitest run src/js/gds-handover.test.js` |
| 6 | Informations projet côté serveur (**état d'avancement uniquement**) | codeur Rust socle | `gds-core/migrations/0009_project_info.sql`, `gds-core/src/db.rs`, `gds-core/src/http.rs` | `cargo test -p gds-core` (règles pures sans base ; accès base via `PILOT_GDS_TEST_URL` quand il y en a) + migration en **LF** |
| 7 | Poste : la restitution pousse l'**état d'avancement** et la prise en main suivante le récupère — jamais de donnée privée, **aucune duplication de `PROJECT_MEMORY.md` / `AGENTS.md`** | codeur Rust + front | `src-tauri/src/gds_sync.rs`, `src/js/project-memory.js` | `cargo test --lib` + `npx vitest run src/js/project-memory*.test.js` |
| 8 | Documentation : nouveau `spec_reseau.md` + réécriture des contradictions (§9) + **mise à jour de `AGENTS.md`** (il documente aujourd'hui « `0001_init` → `0007` », ligne 226 : il doit aller jusqu'à `0009`) | rédacteur doc | `spec_reseau.md`, `spec_assistant_sync.md`, `spec_gds.md`, `plan_gds.md`, `README.md`, `AGENTS.md` | `npm run build:handbook` + `npx vitest run` |
| 9 | Bout en bout : **2 postes simulés au niveau interface** — A prend, travaille, restitue ; B reprend et **voit les informations à jour** ; et 2 projets en parallèle sans gêne | testeur | `src/js/gds-network-e2e.test.js` | `npx vitest run src/js/gds-network-e2e.test.js` |

**Précision sur l'étape 9** : ce test **simule l'interface et les appels** (invocations, rendu du bandeau, lecture seule, séquence prendre/travailler/restituter/reprendre). Il ne prouve **pas** l'exclusivité réelle : celle-ci se prouve **sur la base**, par le test de l'index unique de l'étape 2 — **deux prises concurrentes, une seule réussit**.

**Preuve exigée pour les tests de routes (étapes 2 et 3)** : les tests de routes exigent une base PostgreSQL via `PILOT_GDS_TEST_URL` et sont **OBLIGATOIRES dans la vérification attendue** — aucun test ne doit rendre « ok » sans rien tester. Les règles pures de l'étape 1 se testent **sans base**.

**Garde STRICTE des tests base (décision D3) — différente du style existant, volontairement** : les tests de portage des **étapes 2 et 3** utilisent un **helper dédié** qui **ÉCHOUE avec un message explicite** quand `PILOT_GDS_TEST_URL` est absente — **jamais un `return None` silencieux**. Les **autres tests PostgreSQL existants gardent leur comportement actuel** (ignorés proprement quand la variable manque, ex. `fresh_migrated_test_db`, `gds-core/src/db.rs:2045-2051`) : **on ne les change pas dans ce chantier**. Conséquence pratique : sans `PILOT_GDS_TEST_URL`, la suite reste verte pour l'existant mais **échoue explicitement** sur les tests de portage — c'est voulu, l'exclusivité ne peut pas être déclarée prouvée sans base.

**Où la base est fournie (décision A1) — écrit, plus improvisé nulle part** :

- **En CI** : elle est fournie par le job `tests` de `.github/workflows/gds-server-image.yml` — le **seul** enchaînement qui lance les tests du socle. Ce job ajoute un **service PostgreSQL 16 jetable** (`services:` avec health-check, base `pilot_gds_test_ci`, aucun volume) et définit **`PILOT_GDS_TEST_URL`** dans l'environnement de l'étape `cargo test -p gds-core --lib`. **Aucun nouveau job n'est créé** ; l'enchaînement reste **manuel** (`workflow_dispatch`) et **découplé** de `release.yml`.
- **En local** : par la **commande documentée** de conteneur jetable PostgreSQL 16 (`docs/gds-server-setup.md` §11), qui exporte la même variable — aucune base n'est à préparer à la main, les tests créent et suppriment leurs propres bases `pilot_gds_test_*`.
- **`release.yml` n'est pas concerné et ne doit pas être touché** : son job `test` (Windows + macOS) ne lance que `cargo test --manifest-path src-tauri/Cargo.toml --lib` et `npm test`, donc **jamais** les tests du socle `gds-core`. C'est le chemin critique de publication : aucune modification n'y a sa place.
- **Exigence d'implémentation** : le message d'échec du helper **strict** doit **rappeler cette commande et le nom de la variable** (`docs/gds-server-setup.md` §11, `PILOT_GDS_TEST_URL`). Un échec sans mode d'emploi n'est pas une garde, c'est une impasse.
- **Un test de portage ne doit JAMAIS passer sans base** : « vert sans avoir rien testé » est l'exact contraire d'une preuve.

## 8. Cas de panne, et ce qui protège

- **Le développeur ferme Pilot proprement sans restituer** : la restitution est déclenchée d'office à la fermeture du projet, et l'état d'avancement est poussé — on ne perd pas son travail d'information.
- **Le poste meurt brutalement (coupure, plantage)** : le portage expire après 15 minutes ; le projet redevient libre et le suivant le prend (la prise en main ferme elle-même la ligne expirée, §6 b). Comme les informations projet partent au fil de l'eau (toutes les 3 minutes), on ne perd au plus que 3 minutes de travail d'information — jamais tout.
- **Le serveur tombe** : le travail continue en local **sans écrire sur le serveur**. Il n'y a **pas de file d'écritures en attente** : l'existant est un simple **repère de dernière synchronisation** (table `gds_sync_state`, clé `last_sync_ms`, `src-tauri/src/gds_sync.rs:113` et 380-400). Un envoi raté est **simplement refait au cycle suivant**, sans alerte. On préfère un projet non partagé quelques minutes à un projet bloqué.
- **Coupure en pleine écriture** : une écriture serveur = une requête transactionnelle par entité ; une coupure laisse l'entité inchangée, jamais à moitié écrite.
- **La publication du code échoue à la restitution** : l'ordre du §6 b fait passer la publication du code (commit + push) et la poussée de l'état d'avancement **avant** `return`. Un échec laisse donc le poste **porteur** : le projet n'est pas libéré, le bandeau le dit, et le développeur **rejoue** la restitution. On ne libère jamais un projet dont le code n'est pas publié ; le poste qui meurt malgré tout est couvert par l'expiration à 15 minutes.
- **La publication du code RÉUSSIT, mais le poste meurt avant d'appeler `return`** (cas **symétrique** de D4) : le code est déjà publié, mais le projet reste **marqué tenu** par ce poste **jusqu'à l'expiration** — au plus **15 minutes** (§3 réglage 1) — puis la reprise le clôt selon la règle **D17** de la v3 (la prise en main ferme elle-même la ligne expirée **dans la même transaction** : `returned_at = now()`, `returned_by = 'expiration'`, §6 b). Conséquences, écrites noir sur blanc : **le code déjà publié n'est pas perdu**, **rien n'est supprimé localement**, et **aucune intervention n'est nécessaire** — le délai maximum de blocage est **connu et borné à 15 minutes**.
- **Projet tenu par quelqu'un qui a disparu** : trois protections cumulées — expiration paresseuse (15 min), reprise en main par un administrateur (motif + journal d'audit), et affichage permanent du porteur et de l'échéance pour que le problème se voie au lieu de se deviner.
- **Le projet est bloqué : le développeur a disparu** : l'administrateur du GDS peut libérer le projet (motif obligatoire, action tracée dans l'audit). Le suivant qui le prend en main reçoit pour son assistant un point de reprise détaillé — ce qui était en cours, ce qui était prévu — construit uniquement à partir des informations projet partagées, jamais depuis la machine disparue. Le travail en cours est à refaire, mais sur sa confirmation seulement.
- **Aucune donnée privée sur le fil** : la couche de partage ne lit qu'une liste blanche de champs de projet (section 4) ; tout le reste n'est jamais sérialisé.

## 9. Contradictions à corriger dans la documentation

| Fichier:ligne | Ce qui est affirmé | Verdict |
|---|---|---|
| `spec_assistant_sync.md:15-16` | « Plan validé avec l'utilisateur — design défini, aucune implémentation » | **Partiellement périmé** : « aucune implémentation » est **exact** ; ce qui est faux, c'est « **design défini** », remplacé par l'exclusivité par projet (ce plan). → **réécrire le statut**, pas le constat d'absence d'implémentation. |
| `spec_assistant_sync.md:10-13` | « verrous supprimés… risque accepté, dernier qui écrit gagne » | Contredit l'exclusivité par projet → **réécrire**. |
| `spec_assistant_sync.md:104-111` | « aucun verrou : plusieurs postes travaillent en parallèle sur le même projet » | Contredit l'exclusivité → **réécrire**. |
| `spec_assistant_sync.md:119-128` | « concurrence ACCEPTÉE » | **À retirer**. La partie « pas de fusion automatique de conflits » **reste valable**. |
| `spec_assistant_sync.md:50` | « Historique de sessions » synchronisé | Contredit la protection des données personnelles → seul le **résumé / état d'avancement** part, jamais les transcripts. |
| `spec_assistant_sync.md:31-35` | Drapeau automatique GDS / personnel | **Reste valable** ; à compléter par la frontière information par information (§4). |
| `spec_gds.md:13-14, 851-859, 908, 919` | « verrou supprimé », « dernier écrit gagne » | **Réécrire** : le pont de suivi reste, la cohérence passe par le portage. |
| `spec_gds.md:254, 286, 891` | Mode urgent retiré, aucune route de verrou | **Reste valable** (pas de retour du mode urgent global) ; **ajouter** la libération forcée par un administrateur. |
| `plan_gds.md:169-172, 258-272, 412-419, 443` | « décision 3 : plus de verrou projet » | **Réécrire** : remplacée par « un seul porteur par projet », pas par un verrou global. |
| `README.md:283-285` | « Synchronisation sans verrou : plusieurs postes en même temps ; l'écriture la plus récente fait foi » | Contredit l'exclusivité → **réécrire**. (La v2 citait `274-276`, qui parle en réalité des **trois rôles** : décalage dû à la section « Barre de fenêtre ».) |
| `AGENTS.md:226` | « Migrations SQL GDS partagées (`0001_init` → `0007`) » | **À mettre à jour** par l'étape 8 : la série ira jusqu'à `0009`. |
| `plan_gds.md:318, 345` | Temps réel WebSocket des tickets du widget web | **Hors sujet ici** ; reste valable pour le composant web (phase D) — ne pas confondre. |

## 10. Ce que le plan ne fait pas

- **Aucune implémentation dans ce document** : pas de migration `0008`/`0009`, aucun fichier Rust ou JS de code, aucun test. Ce plan décrit seulement le travail des étapes 1 à 9.
- **Aucun job planifié, aucune tâche périodique côté serveur** : l'expiration est paresseuse (§6 b) et le plan ne cite aucun fichier de tâche périodique et n'en crée pas.
- **Aucun retour du verrou global** ni du mode urgent : `project_locks` reste supprimée (`0007`).

## 11. Décisions fermes

Le propriétaire a tranché tous les points ouverts. Le plan n'attend plus d'arbitrage.

| # | Point | Décision |
|---|---|---|
| 1 | Libération d'un projet tenu mais abandonné | 15 minutes sans nouvelle |
| 2 | Signal de présence | toutes les 3 minutes |
| 3 | Second développeur sur un projet tenu | lecture seule, avec bandeau « tenu par X, jusqu'à HH:MM » |
| 4 | L'exclusivité couvre-t-elle les agents ? | oui, aucun agent ne travaille sur un projet tenu par un autre poste |
| 5 | Qui peut libérer un projet tenu | un administrateur seul, motif obligatoire, inscrit au journal d'audit |
| 6 | État d'avancement poussé automatiquement à la restitution | oui |
| 7 | **Envoi des informations projet pendant le travail** | **au fil de l'eau, toutes les 3 minutes** — le serveur ne perd donc jamais plus de 3 minutes de travail d'information, même si le poste meurt brutalement |
| 8 | Qui peut LIRE les informations d'un projet tenu par un autre | **tout le monde, tout le temps** : l'exclusivité ne porte que sur l'écriture ; un poste qui ne tient pas le projet lit les informations à jour et peut donc répondre aux questions sur l'avancement (au pire 3 minutes de retard) |
| 9 | La synchronisation de fond peut-elle bloquer le travail | **non** : envoi silencieux toutes les 3 minutes, qui n'attend aucun verrou, ne fait patienter personne, ne crée aucune file et n'interrompt jamais le travail ; un envoi raté est retenté au cycle suivant, sans alerte |
| 10 | Les deux synchronisations | (1) fond : automatique, toutes les 3 minutes, informations du projet seulement, jamais bloquante ; (2) manuelle : rend le projet, pousse les informations, et publie le code sur le GDS quand le projet y est activé (alors aucune publication GitHub) |
| 11 | Projet bloqué | l'administrateur du GDS peut libérer le projet (motif obligatoire, action tracée) ; le suivant reçoit pour son assistant le détail de ce qui était en cours et de ce qui était prévu, tiré des informations projet partagées ; le travail en cours est à refaire, uniquement si le nouveau développeur le confirme |
| 12 | La source qui fait foi | à un instant T, la référence commune pour tous les développeurs est le serveur GDS : le code du projet et les informations projet ; ce qui n'a pas été poussé n'existe pas pour les autres, est signalé comme à refaire et n'est jamais compté comme fait |

Conséquence du point 7 : le serveur reçoit des états intermédiaires pendant le travail. Ce n'est pas un risque de conflit, puisque le portage est exclusif : personne d'autre n'écrit sur le projet à ce moment-là. L'exclusivité protège l'écriture, jamais la lecture : les autres postes, et les assistants des autres développeurs, voient l'avancement au fil de l'eau et peuvent répondre aux questions sur le projet.

---

> **Points restés en désaccord ou à confirmer** : les 7 risques signalés par la relecture sont désormais **tranchés** (D1→D7) et **écrits dans ce plan** ; le constat d'origine reste visible dans `RAPPORT-relecture-plan-reseau.md` (§6) et la correspondance risque → arbitrage → endroit du plan est en §8 du même rapport. Les **deux points laissés ouverts** en fin de mission sont eux aussi **tranchés et écrits en v4.1** : **A1** en §7 (où tournent les tests de portage, `release.yml` non concerné) et **A2** en §8 (publication réussie puis mort du poste avant `return`). Ce qui reste **réellement ouvert** est listé, point par point, en **§9 de ce rapport**.
