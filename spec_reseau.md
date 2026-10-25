# Spec — Mode réseau multi-postes (portage d'un projet)

> Ce que fait le mode, comment on s'en sert, ce qui est partagé, ce qui reste
> privé, ce qui arrive en cas de panne, et **ce que le mode ne fait pas**.
> Plan d'origine et arbitrages : `PLAN-mode-reseau-multipostes.md` (§1 à §11).
>
> **Statut, à lire avant le reste** — le **portage** est implémenté de bout en
> bout (étapes 1 à 5 du plan) : règle pure, table serveur, routes, présence,
> garde d'écriture, bandeau et boutons. Le **partage de l'état d'avancement**
> (étapes 6 et 7 : table `project_info`, migration `0009`) et le **test de bout
> en bout entre deux postes** (étape 9) ne sont **pas** implémentés : rien ici ne
> les décrit comme faits. Le détail des manques est en §7.
>
> Interface et garde d'écriture déjà spécifiées finement : `spec_gds.md` §5.4
> (bandeau, boutons, libération administrateur) et §5.5 (garde tenue par le
> socle). Ce document est la vue d'ensemble : il ne les duplique pas.

---

## 1. Le principe, en une phrase

Un projet donné est travaillé **par un seul poste à la fois** : ce poste le
**tient** ; les autres peuvent l'ouvrir, le lire et le consulter, mais **n'y
écrivent rien** et **n'y lancent aucun agent**. Le porteur rend le projet quand
il a fini, et le suivant le reprend.

Ce n'est **pas** un retour du verrou global supprimé par
`0007_drop_project_locks.sql` : la prise est **par projet**, elle **expire
toute seule** au bout de 15 minutes sans présence, un administrateur peut la
libérer, et l'historique des portages est conservé.

## 2. Ce que le développeur voit et fait

| Geste | Ce qui se passe |
|---|---|
| Il ouvre un projet tenu par **un autre** poste | L'onglet « 🌐 GDS » affiche un **bandeau** : le projet est tenu par un autre développeur, **jusqu'à HH:MM**. Le projet reste lisible ; les gestes qui écrivent ne partent pas et disent pourquoi. |
| Il a du travail local à publier | Le bouton **« Prendre le projet pour publier »** apparaît quand le projet est **libre** et que des modifications locales attendent, ou quand un **autre** poste le tient (pour réessayer). Le serveur décide : accordé (il devient porteur), ou refusé avec le motif (« un autre développeur le tient encore »). |
| Il travaille | Rien à faire de particulier : la **présence** se renouvelle toute seule toutes les 3 minutes, et l'**avancement du suivi** part dès qu'il change (le pont le vérifie toutes les 30 s). |
| Il a fini | Il clique **« Rendre le projet »** — visible **seulement** s'il tient le projet. Le poste publie le code, pousse l'avancement, **puis** libère le projet. Si une étape échoue, le projet **reste tenu** par lui, rien n'est perdu, et il peut rejouer. |
| Un projet est bloqué (développeur absent) | Seul un **administrateur** peut le libérer, depuis « 🖥️ GDS Serveur — administration » → *Dépôts / projets* → **« Libérer »**, avec un **motif obligatoire** (`spec_gds.md` §5.4). |

**La prise en main n'est pas automatique.** Le plan prévoyait une prise à
l'ouverture d'un projet connecté ; l'implémentation ne la fait pas : on devient
porteur par le bouton ci-dessus, ou **silencieusement** en publiant le suivi
d'un projet encore libre (`gds_force_push_suivi` → `ensure_write_allowed`, qui
ne prend la main qu'une fois, quand le projet est libre).

## 3. Ce qui est partagé, ce qui reste privé

| Information | Partage | Pourquoi |
|---|---|---|
| Le code du projet | **Git**, comme avant | Le mode ne transporte aucun fichier de code ; il n'ajoute que la **publication** au moment où l'on rend le projet. |
| Suivi : clients, projets, tâches, décisions | **Partagé** (base serveur, pont existant `gds_sync.rs`) | C'est déjà le suivi commun du GDS. |
| Qui tient le projet, et jusqu'à quand | **Partagé** | C'est l'objet même de la coordination. |
| Lecture de ces informations par un poste non porteur | **Ouverte, tout le temps** | L'exclusivité porte sur l'**écriture** : un poste qui ne tient pas le projet lit l'avancement et peut en répondre. |
| Écriture des fichiers du projet, lancement d'agents | **Réservée au porteur** | Voir §5. Le travail local **déjà présent** sur un autre poste n'est **jamais** supprimé ni écrasé : il reste local et non publiable. |
| `PROJECT_MEMORY.md`, `AGENTS.md`, spec du projet | **Partagés par le dépôt** | Ce sont des fichiers du dépôt : ils voyagent avec le code, il n'y a rien à dupliquer en base. |
| Conversations, transcriptions, `.pilot/sessions/` | **Privé** | Échanges personnels ; seuls les résumés et décisions remontent au suivi. |
| Réglages, thème, voix, modèles, clefs d'API, `vault.json`, `gds_secrets.json` | **Privé** | Réglages et secrets de poste ; ne quittent jamais la machine. |

## 4. Les règles du serveur

Module pur `gds-core/src/handover.rs`, table `project_handovers`
(`gds-core/migrations/0008_project_handover.sql`).

- **Un seul porteur actif** : garanti par l'**index unique partiel**
  `project_handovers_active_key (project_id) WHERE returned_at IS NULL` — c'est
  la base qui garantit l'exclusivité, pas seulement le code.
- **Expiration paresseuse** : `expires_at < now()` est évalué **à chaque** prise,
  présence, restitution ou lecture. **Aucun job planifié** ne balaie la table.
  Le délai est de **15 minutes** (`HANDOVER_TTL_MINUTES`), repoussé de 15 minutes
  à chaque présence.
- **La prise est idempotente** : même compte + même poste = **renouvellement**,
  pas une seconde ligne ; un autre porteur **non expiré** = refus **409** avec le
  porteur et l'échéance ; un porteur **expiré** = reprise autorisée, la même
  transaction **clôt** la ligne expirée (`returned_by = 'expiration'`, motif figé
  « portage expiré après 15 minutes sans présence ») **puis** insère la nouvelle.
- **La restitution** (`return`) n'est acceptée que du porteur actif : projet
  libre, non-porteur, ou prise déjà expirée ⇒ **409**, jamais une double clôture.
- **La libération forcée** (`force`) est réservée au rôle `admin`, exige un
  **motif non vide** (garanti aussi par la contrainte
  `project_handovers_admin_reason_check`) et laisse une trace d'audit
  (`handover.force_return`).
- **L'historique est conservé** : la ligne est **clôturée, jamais supprimée**.
- **Routes du socle partagé** (`gds-core/src/http.rs`), identiques pour le
  serveur et pour le poste : `POST /api/gds/handover/take`, `/heartbeat`,
  `/return` (authentification seule), `GET /api/gds/handover/state` (lecture) et
  `POST /api/gds/handover/force` (montée dans `admin_routes`, derrière
  `require_admin`).

## 5. Ce que fait le poste

- **Présence automatique** : un cycle toutes les **3 minutes**
  (`HEARTBEAT_INTERVAL_SECS = 180`), **un seul appel par projet tenu**, aucun
  appel pour un projet non tenu. Une panne réseau n'efface pas la prise : elle
  est signalée et rejouée au cycle suivant ; un refus métier (409) **efface** le
  repère local — le poste n'est plus porteur. L'envoi de l'**avancement** du suivi
  est distinct : il est fait par le pont, qui contrôle toutes les **30 secondes**
  s'il y a des modifications en attente.
- **Restitution ordonnée** : code publié → avancement poussé → `return`. Une
  étape en échec arrête la séquence, l'étape atteinte est mémorisée dans la
  table de synchronisation existante, le poste **reste porteur** et l'opération
  est rejouable. C'est ce qui interdit le cas « projet rendu mais code non
  publié ».
- **Garde d'écriture tenue par le socle**, pas par l'écran
  (`src-tauri/src/gds_write_guard.rs`, détail `spec_gds.md` §5.5). Elle **refuse**
  si, et seulement si, le serveur a confirmé qu'un **autre** poste tient le
  projet. **Règle cardinale : elle est fail-open** — projet absent des projets
  ouverts, GDS désactivé, `.pilot/gds.json` absent, identité de poste
  indisponible, serveur injoignable ou muet (3 s) ⇒ **écriture autorisée**,
  comportement local identique à avant.
  Sont gardés, aujourd'hui : les **six** commandes d'écriture de fichiers
  (`write_file_content`, `write_file_binary`, `create_file`, `create_folder`,
  `rename_file_or_dir`, `delete_file_or_dir`), l'ajout d'une **image** au projet
  (`copy_image_to_project`), le **lancement d'un agent** par projet
  (`start_agent_process`, `start_agent_session`) et la **publication du suivi**
  (`gds_force_push_suivi`).
- **Refus lisible** : un refus dit qui tient le projet, jusqu'à quand, et qu'il
  faut le prendre en main. Un état **invérifiable** ne bloque pas le geste — le
  serveur reste seul juge.

## 6. En cas de panne

| Situation | Ce qui arrive | Ce qui protège |
|---|---|---|
| Le développeur ferme Pilot sans rendre le projet | Le projet reste tenu un moment, puis expire | Expiration à 15 minutes ; le suivant le reprend. |
| Le poste meurt brutalement | Idem | Au plus 15 minutes de blocage ; le suivi déjà poussé n'est pas perdu. |
| Le serveur ne répond pas | On continue à travailler localement | Garde d'écriture **fail-open** ; l'envoi raté est refait au cycle suivant ; aucun écran ne se bloque. |
| La publication du code échoue à la restitution | Le projet **n'est pas** libéré | L'ordre de la restitution (§5) : on ne rend jamais un projet dont le code n'est pas publié. |
| Le code est publié mais le poste meurt avant `return` | Le projet reste marqué tenu jusqu'à l'expiration | Rien n'est perdu ni supprimé ; le blocage est **borné à 15 minutes**. |
| Un projet est bloqué par un développeur absent | L'administrateur le libère | Motif obligatoire, trace d'audit, aucune donnée supprimée. |

## 7. Ce que le mode ne fait pas

- **Il ne partage pas l'état d'avancement** (`project_info`, migration `0009`) :
  aujourd'hui, l'avancement partagé est celui du **suivi** existant (tâches,
  décisions). Les étapes 6 et 7 du plan sont **à faire**.
- **Il ne prend pas le projet automatiquement à l'ouverture** (voir §2).
- **Il ne nomme jamais le porteur** : le serveur ne connaît qu'un compte et un
  identifiant de poste (UUID de machine), et l'interface écrit « un autre
  développeur ». L'écran d'administration ne montre pas non plus qui tient le
  projet : il faut savoir quel projet est bloqué pour le libérer.
- **Il ne prend pas le projet à la première écriture de fichier** : la garde
  d'écriture constate l'état (lecture seule) et laisse écrire dans un projet
  **libre** sans le prendre. Tant que personne n'a pris le projet, deux postes
  peuvent donc encore éditer chacun de leur côté ; la prise est **explicite**
  (bouton) ou faite par la **publication du suivi**.
- **Il ne garde pas le terminal ni les commandes git** : la garde couvre les six
  commandes d'écriture de fichiers, l'ajout d'image, le lancement d'agents et la
  publication du suivi — pas une commande tapée dans le terminal intégré, ni une
  opération git.
- **Il ne garde pas l'écriture du bloc de contexte** (`write_context_handoff`,
  fichier interne `.pilot/context-inject.md`) : elle n'est pas branchée sur la
  garde. C'est un fichier de Pilot, pas du travail de l'utilisateur.
- **Il ne restreint pas les projets par membre (V1)** : « membre » signifie
  aujourd'hui « tout compte authentifié du serveur ».
- **Il n'a aucune file d'écritures en attente** : un envoi raté est simplement
  refait au cycle suivant, sans rejeu différé ni alerte.
- **Il ne fusionne rien automatiquement** : aucune fusion champ par champ,
  aucune poussée silencieuse. Le pont du suivi garde sa règle « le plus récent
  gagne » **comme filet de sécurité**, la cohérence venant désormais du portage.
- **Il ne prouve pas l'exclusivité par un test d'interface** : elle se prouve sur
  la base, avec deux prises concurrentes dont une seule réussit (tests des
  étapes 2 et 3, qui exigent `PILOT_GDS_TEST_URL`).

## 8. Preuves

- Règles pures : `cargo test -p gds-core` (module `handover`) — sans base.
- Base et routes : `cargo test -p gds-core` **avec** `PILOT_GDS_TEST_URL`
  (deux prises concurrentes : une seule réussit ; 409 pour un second
  développeur ; 200 pour l'administrateur ; 403 pour un non-administrateur).
- Poste : `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  (`gds_write_guard`, `gds_handover`).
- Interface : `npx vitest run src/js/gds-handover.test.js` et
  `src/js/gds-garde-ecriture.test.js`.

**Voir aussi** : `spec_gds.md` (§5.4 interface, §5.5 garde d'écriture, §6 suivi
fusionné), `spec_assistant_sync.md` (ce qui voyage dans le contexte de
l'assistant), `spec_super_agent.md` (assistant de suivi),
`docs/gds-server-setup.md` (serveur) et `docs/gds-guide-mise-en-place.md`
(parcours de mise en place).
