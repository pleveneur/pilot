# Rapport — relecture et correction du plan « mode réseau multi-postes » (v2 → v3)

> Tâche : produire la **version 3** de `PLAN-mode-reseau-multipostes.md` à partir de la
> relecture indépendante qui a jugé la v2 **non prête** (5 points bloquants, 6 renvois faux,
> plusieurs formulations contradictoires). **Aucune implémentation** n'a été faite : aucun
> fichier de code, aucune migration, aucun test n'a été créé ou modifié.
>
> Fichiers touchés : `PLAN-mode-reseau-multipostes.md` (réécrit en v3) et ce rapport.
>
> **Suite (v4)** : les 7 risques de la §6 ont ensuite été **tranchés par le propriétaire** (D1→D7) et écrits dans le plan, désormais en **v4** → voir la **§8** ci-dessous. `plan_dev.md` a été mis à jour à cette occasion.
> `npm test` n'a pas été lancé : aucun code ne change, et la consigne de la tâche interdit de lancer la suite complète. Vérifié malgré tout : **aucun test ne lit ces fichiers** (`grep -rn "PLAN-mode-reseau\|RAPPORT-relecture\|plan_dev" --include=*.test.js` → aucune occurrence), donc aucun test ne peut être cassé par cette livraison. Les tests cités dans le plan ont, eux, été relus dans le source pour être certains qu'ils existent.

---

## 1. Corrections appliquées — A. Renvois faux (tous revérifiés sur le disque avant écriture)

| # | Correction | Vérification faite |
|---|---|---|
| A1 | `README.md:274-276` (trois rôles) → **`README.md:283-285`** (« Synchronisation sans verrou… »), dans la section 9 | Vérifié : 274-276 = « **Trois rôles** pour les comptes » ; 283-285 = « **Synchronisation sans verrou** : plusieurs postes peuvent travailler en même temps… ». Décalage dû à la section « Barre de fenêtre », comme annoncé. |
| A2 | `ensure_project_publisher` : 1731 → **`gds-core/src/db.rs:1748`** (§5) | Vérifié : `pub async fn ensure_project_publisher(` à la ligne 1748. |
| A3 | Table `projects` : 15 → **`gds-core/migrations/0001_init.sql:18`** (§5) | Vérifié : `CREATE TABLE IF NOT EXISTS projects (` à la ligne 18. |
| A4 | `audit_gds` : 44 → **`0001_init.sql:49`** (§5) | Vérifié : `CREATE TABLE IF NOT EXISTS audit_gds (` à la ligne 49. |
| A5 | `tasks` : 55 → **`0004_suivi.sql:29`** ; `decisions` : 68 → **`0004_suivi.sql:43`** (§4) | Vérifié. Le fichier fait bien **51 lignes** (`wc -l`) : les lignes 55 et 68 **n'existent pas**. |
| A6 | Socle partagé : le service monte **`server_router` (`gds-core/src/http.rs:212`)**, qui fusionne `gds_routes` (**`http.rs:217`**) ; côté poste la fusion réelle est **`src-tauri/src/gds_web.rs:64`** (§5) | Vérifié : 212 = `pub fn server_router`, 217 = `.merge(gds_routes::<S>())`, `gds_web.rs:64` = `.merge(gds_core::http::gds_routes::<S>())`. La v2 citait `gds_web.rs:19`, qui est bien un **commentaire** ; elle citait aussi `gds-server/src/main.rs:51`, qui est l'**import** `use gds_core::http::{server_router, ServerCtx};`, pas le montage. |
| A7 | Point d'accroche de la prise en main : **`src/js/sidebar.js:471`** → `invoke("gds_sync_project")` → **`src-tauri/src/gds_client.rs:177`** ; `gds_connect_existing` (`gds.rs:2431`) est une commande distincte qui **n'appelle pas** `gds_sync_project` (§5 et §6 b) | Vérifié par lecture : `sidebar.js:471` = `await invoke("gds_sync_project", { project: folderPath })` ; `gds_client.rs:177` = `pub async fn gds_sync_project` ; `gds.rs:2431` = `pub async fn gds_connect_existing(`. Un `grep gds_sync_project src-tauri/src/gds.rs` ne retourne **aucune** occurrence : la commande de connexion ne synchronise pas. |
| A8 | Étapes 4 et 5 du tableau complétées : **`src-tauri/src/lib.rs`** (toute commande Tauri doit être enregistrée dans `tauri::generate_handler!`, ligne 3535, entrées GDS voisines 3854-3884), **`src-tauri/src/gds_service.rs`** (`force_push_tracking` ligne 552, routes `/api/gds/tracking/*` lignes 569-596), **`src-tauri/src/gds_web.rs` lignes 43-51** si une route propre au poste est ajoutée | Vérifié : `.invoke_handler(tauri::generate_handler![` à la ligne 3535 ; bloc GDS `gds::gds_provision` … `gds_client::gds_sync_project` lignes 3854-3884 ; `pub(crate) async fn force_push_tracking(` à la ligne 552 ; les `session.post("/api/gds/tracking/…")` aux lignes 569, 578, 583, 596 ; `gds_desktop_routes` lignes 43-51. |
| A9 | §9, `spec_assistant_sync.md:15-16` : verdict reformulé — « aucune implémentation » est **exact**, c'est « **design défini** » qui est périmé (remplacé par l'exclusivité par projet) | Vérifié : le document dit textuellement « Plan validé avec l'utilisateur — design défini, aucune implémentation ». Le verdict « Faux (aucune implémentation) » de la v2 était donc mal fondé. |
| A10 | Ajouts : toute migration doit être **en LF** (test `db::tests::embedded_migrations_are_lf`, `gds-core/src/db.rs:1886-1907`) → §5, §6 a, §6 c, étapes 1 et 6 ; **`AGENTS.md`** documente « `0001_init` → `0007` » → l'étape 8 (documentation) doit le mettre à jour → ajouté aux étapes 8 et à la section 9 | Vérifié : le test `fn embedded_migrations_are_lf()` est bien aux lignes 1886-1907 (assertion `!m.sql.contains('\r')`) ; `AGENTS.md:226` = « Migrations SQL GDS partagées (`0001_init` → `0007`) ». |

## 2. Corrections appliquées — B. Formulations contradictoires

| # | Correction |
|---|---|
| B11 | **Bandeau** : une seule formulation partout, « **tenu par X, jusqu'à HH:MM** ». Le « depuis HH:MM » de l'étape 1 du cycle a disparu (§2, §3, §7 étape 5, §11 décision 3). |
| B12 | **Assistant d'un poste non porteur** : partout « **répondre sur l'avancement** » (plus aucun « renseigner l'avancement ») — §1, §3 réglage 2, §4, §11 décisions 8 et 12. |
| B13 | **Frontière code / agents** écrite explicitement en nouvelle sous-section §1 « La frontière code / agents » : un projet tenu par un autre poste s'ouvre en **LECTURE SEULE** — **aucune modification de fichier du projet, aucun agent lancé sur ce projet** ; le code continue de voyager par Git mais on ne le modifie pas depuis un poste qui ne tient pas le projet. Reprise en §2 (temps 2), §3 (réglage 2), §4 (nouvelle ligne « Écriture des fichiers du projet et lancement d'agents ») et **étape 5** du tableau de réalisation. |
| B14 | **Double source mémoire / consignes** : `PROJECT_MEMORY.md` et `AGENTS.md` sont présentés comme des **FICHIERS du dépôt**, source unique, qui voyagent déjà avec le code par Git ; `project_info` ne transporte **que l'état d'avancement** (`kind = etat_avancement`). Corrigé en §4 (deux lignes du tableau), nouvelle sous-section **§4 bis** « Une seule source pour la mémoire et les consignes », §6 c (CHECK sur `kind`, note explicite) et étape 7. |
| B15 | **§8 « écritures en attente rejouées »** : remplacé par le vocabulaire juste — l'existant est un **repère de dernière synchronisation** (`gds_sync_state`, clé `last_sync_ms`, `src-tauri/src/gds_sync.rs:113` et 380-400), **pas une file** ; un envoi raté est **simplement refait au cycle suivant, sans alerte**. Ajouté aussi en §5 (« marqueur de dernière synchronisation, à ne pas confondre avec une file »). |
| B16 | **Étape 9** : précision ajoutée sous le tableau — le test simule **l'interface et les appels** (invocations, rendu du bandeau, lecture seule, séquence prendre/travailler/restituter/reprendre) et **ne prouve pas l'exclusivité réelle**, laquelle se prouve **sur la base** par le test de l'index unique de l'étape 2 (deux prises concurrentes, une seule réussit). |

## 3. Corrections appliquées — C. Les cinq points bloquants

| # | Décision écrite telle quelle |
|---|---|
| C17 | **Reprise après expiration** (§6 b) : la prise en main **ferme elle-même la ligne expirée dans la MÊME transaction** — `returned_at = now()`, `returned_by = 'expiration'`, `return_reason = 'portage expiré après 15 minutes sans présence'` — **puis** insère la nouvelle ligne. **Aucun balayage périodique, aucun job planifié.** Explicitement relié à la compatibilité avec l'index unique partiel. |
| C18 | **`poste_id`** (§6 a) : UUID généré **UNE fois**, conservé **côté poste dans la configuration GDS du projet**, **stable pour la machine**, **jamais transmis ailleurs** ; sert à distinguer **deux machines du même compte utilisateur**. |
| C19 | **Expiration PARESSEUSE** (§6 b et §6 d) : évaluation `expires_at < now()` **au moment de chaque lecture et de chaque écriture** ; **aucun job planifié côté serveur** ; le plan **ne cite aucun fichier de tâche périodique et n'en crée pas** (ajouté aussi en §10 « Ce que le plan ne fait pas »). |
| C20 | **Restitution scindée** (§6 b) : côté **socle partagé**, seulement les **règles pures et la clôture de la ligne avec `sync_at`**, **AUCUNE publication de code, aucun appel réseau sortant** (le serveur ne peut pas publier le code d'un poste) ; c'est **le poste** qui déclenche la synchronisation des informations et, si le projet est activé sur le GDS, la publication du code (`src-tauri/src/gds_client.rs` / `git push`), à l'**étape 4**. |
| C21 | **Preuve de l'étape 3** (§7) : tests de routes exigeant une base PostgreSQL via **`PILOT_GDS_TEST_URL`** et déclarés **OBLIGATOIRES** dans la vérification attendue — aucun test ne doit rendre « ok » sans rien tester ; les règles pures de l'étape 1 se testent **sans base** ; l'exclusivité est prouvée par un **test base sur l'index unique** (deux prises concurrentes, une seule réussit, l'autre reçoit un refus). |

## 4. Corrections appliquées — D. Zones d'ombre

| # | Correction |
|---|---|
| D22 | **Routes nommées** (§6 b, tableau) dans le socle partagé : `POST /api/gds/handover/take`, `POST /api/gds/handover/heartbeat`, `POST /api/gds/handover/return`, `GET /api/gds/handover/state` (lecture, ouverte à tout membre) et `POST /api/gds/handover/force` dans **`admin_routes`** (`gds-core/src/http.rs:214`, qui applique déjà `require_admin` à toutes ses routes). |
| D23 | **Un seul appel par cycle de 3 minutes** (§2, §6 b, §7 étape 4) : présence **+** envoi des informations projet ; la prise (`take`) **ne sert qu'à la prise en main, jamais à la présence**. |
| D24 | **Schéma `project_info` complet** (§6 c) : `id BIGSERIAL PRIMARY KEY`, `project_id BIGINT NOT NULL REFERENCES projects(id)`, `kind TEXT NOT NULL CHECK (kind IN ('etat_avancement'))`, `body TEXT NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by BIGINT REFERENCES users(id)`, plus **`UNIQUE(project_id, kind)`**. |
| D25 | **Types SQL explicites** (§6 a) : `taken_at`, `heartbeat_at`, `expires_at` en `TIMESTAMPTZ NOT NULL` ; `returned_at` et `sync_at` **NULL** tant que l'action n'a pas eu lieu ; `returned_by` parmi `self`, `expiration`, `admin` (CHECK) ; **motif obligatoire pour `admin`**. |

## 5. Ce que j'ai dû vérifier, et ce que j'ai trouvé de différent

1. **Toutes les références conservées de la v2 ont été revérifiées**, pas seulement celles des points A. Sont exactes et conservées : `http.rs:121-123` (route de connexion), `http.rs:900` (`require_admin`), `roles.rs:118` (`can_force_publish`), `http.rs:135-166` (routes du suivi), `gds-core/src/db.rs:591` / `gds-core/src/db.rs:601` / `gds-core/src/db.rs:1123`, `gds-core/src/db.rs:939` (`audit_gds`), `audit.rs:163` (`record`), `0007_drop_project_locks.sql:8-10`, `gds.rs:1783` (`gds_provision`), `gds_web.rs:48` (route `POST /api/gds/sync`), `spec_assistant_sync.md:10-13 / 15-16 / 31-35 / 50 / 60 / 104-111 / 119-128`, `spec_gds.md:13-14 / 254 / 286 / 851-859 / 891 / 908 / 919`, `plan_gds.md:169-172 / 258-272 / 318 / 345 / 412-419 / 443`.
2. **Deux renvois faux supplémentaires trouvés et corrigés** (au-delà de la liste A) :
   - `src-tauri/src/gds_sync.rs:1-10` → **`1-7`** : le commentaire d'en-tête du fichier s'arrête à la ligne 7 ; les lignes 8-10 sont vides puis `use …`. Corrigé en §6 c.
   - `gds-server/src/main.rs:51` cité par la v2 comme « montage » → c'est l'**import** ; remplacé par le montage réel (`http.rs:212`/`217` + `gds_web.rs:64`), conformément à A6.
3. **Vérifications factuelles demandées par A9 et A10** : `0004_suivi.sql` fait bien 51 lignes ; `AGENTS.md:226` mentionne bien `0001_init → 0007` ; `embedded_migrations_are_lf` est bien un `#[test]` qui assère l'absence de `\r`.
4. **Le fichier de plan était bien non suivi par Git** (`git status` : `?? PLAN-mode-reseau-multipostes.md`), comme annoncé.
5. Aucune référence `fichier:ligne` n'a été recopiée sans ouverture préalable du fichier ; aucune ligne de fichier n'existant pas (le cas des lignes 55/68 de `0004_suivi.sql`) n'a été conservée.

## 6. Désaccords et incohérences restantes — signalés, PAS corrigés (par la v3)

> **Tous les 7 points ci-dessous sont TRANCHÉS depuis (plan v4)** : le propriétaire a arbitré D1→D7 via le coordinateur. Les constats restent ci-dessous **pour mémoire** (ils restent visibles, ils ne sont pas supprimés) ; la correspondance **risque → arbitrage → endroit du plan** est en **§8** de ce rapport.

Ces points viennent des décisions arbitrées (C) ou du cahier des charges : ils ont été écrits **tels quels** dans le plan, comme demandé, mais il y a un risque réel. Au propriétaire de trancher.

1. **`poste_id` « jamais transmis ailleurs » vs colonne serveur `poste_id TEXT NOT NULL`.** *(tranché : D1)*
   Le plan écrit la décision telle quelle, mais `project_handovers` contient forcément ce `poste_id` : il **est** transmis au serveur GDS du projet — c'est même sa seule fonction (distinguer deux machines du même compte). Formulation suggérée : « jamais transmis ailleurs qu'au serveur GDS du projet ». En l'état, la phrase se contredisait avec le schéma de la §6 a — **corrigé en v4** (§6 a, « Transmission de `poste_id` »).
2. **`poste_id` stocké « dans la configuration GDS du projet » vs « stable pour la machine ».** *(tranché : D2, option a retenue)*
   Si la configuration est **par projet**, rien n'empêche la même machine de générer un UUID différent pour chaque projet — ce qui casse l'idempotence du `take` (« même `user_id` + même `poste_id` → renouvellement ») et la notion « stable pour la machine ». Deux lectures possibles : (a) un identifiant **de poste**, généré une fois pour la machine et recopié dans la config GDS de chaque projet ; (b) un identifiant **par (poste, projet)**. Le plan écrit la décision telle quelle ; **je recommande (a)** — **c'est (a) qui a été retenu en v4** (§6 a, paragraphe `poste_id`).
3. **Point 21 vs l'existant des tests base.** *(tranché : D3, garde stricte pour les seuls tests de portage)* Les tests PostgreSQL existants **s'ignorent proprement** quand `PILOT_GDS_TEST_URL` est absente (`gds-core/src/db.rs:2046-2068` : `eprintln!("PILOT_GDS_TEST_URL absente — test ignoré")` puis `return None`). La décision C21 exige au contraire des tests **obligatoires** qui ne peuvent pas rendre « ok » sans rien tester : les étapes 2 et 3 devront donc introduire un **garde qui échoue** (et non un `return None`) pour les tests de portage, ce qui diffère du style existant. Le plan écrit la décision ; la manière (nouveau helper « exigeant » vs variable d'environnement dédiée) restait à choisir à l'implémentation — **tranché en v4 : helper dédié qui ÉCHOUE** (§7, « Garde STRICTE des tests base »).
4. **Décision 10 (synchro manuelle) vs point 20 (restitution socle sans publication).** *(tranché : D4, ordre code → avancement → `return`)* Le plan concilie les deux par la scission socle/poste. Conséquence à assumer : « la synchro manuelle » **n'est pas une seule route serveur** mais une **séquence côté poste** (appel `return` + poussée des informations + `git push` éventuel). Si le poste meurt entre `return` et le `git push`, le projet est libéré **sans** que le code ait été publié : le plan ne tranche pas ce cas (il est couvert fonctionnellement par la décision 12 — « ce qui n'a pas été poussé n'existe pas » — mais pas mécaniquement) — **tranché en v4 : l'ordre impose code → avancement → `return`, donc ce cas ne peut plus se produire** (§6 b, « Ordre de la restitution » ; §8).
5. **Décision 3 (« aucun agent ne travaille sur un projet tenu par un autre poste ») vs décision 8 (le poste non porteur lit et « répond »).** *(tranché : D5, glossaire ajouté, décisions non modifiées)* Les deux sont écrites et cohérentes si l'on distingue « **agent du projet** » (interdit au non-porteur) de « **assistant de suivi du développeur** » (autorisé, en lecture seule). Le plan le dit en §1 et en §3, mais le mot « agent » reste ambigu dans les décisions 3 et 8 du propriétaire, qui ne sont pas modifiables : **une clarification du vocabulaire serait utile** (proposée, non appliquée en v3) — **appliquée en v4 : glossaire du §1**, sans modifier les décisions.
6. **Réglage 2 (« il n'est pas empêché d'ouvrir ») et lecture seule stricte.** *(tranché : D6, travail local jamais supprimé, non publiable, signalé)* Formellement compatible (ouvrir ≠ modifier), mais l'expérience utilisateur reste à définir pour un poste qui aurait **déjà** des modifications locales non poussées sur ce projet avant que le portage passe à un autre : le plan ne dit pas ce que devient ce travail local. Signalé comme trou connu — **écrit en v4** : les modifications locales ne sont **jamais supprimées ni écrasées**, elles restent locales, non publiables, et l'interface le dit (§1, D6).
7. **`GET /api/gds/handover/state` « ouverte à tout membre »** *(tranché : D7, écrit sans promesse)* : le code existant n'a **pas** de notion de « membre du projet » active pour les routes de suivi (V1 : tous les inscrits accèdent à tous les projets — commentaire de `0001_init.sql:30-31`, et la garde `ensure_project_publisher` ne dépend plus que du **rôle** depuis la décision 2026-09, `gds-core/src/roles.rs:112-123`). « Tout membre » signifie donc aujourd'hui « tout compte authentifié » : le plan écrit la décision, la restriction réelle reste à décider (et n'est pas un oubli de ma part) — **écrit tel quel en v4, la restriction par projet est notée comme évolution future, pas comme acquise** (§6 b, « Portée de lecture »).

## 7. Ce qui n'a pas été fait (volontairement)

- Aucune migration `0008`/`0009`, aucun fichier `gds-core/src/handover.rs`, aucune modification de `db.rs` / `http.rs` / `gds_client.rs` / `lib.rs` / des fichiers JS : **le plan est un document, rien n'est implémenté**.
- Les **12 décisions fermes** (§11) et les **5 réglages validés** (§3) sont **inchangés** au mot près, sauf la correction de forme B12 (« répondre sur l'avancement ») et B13 (ajout de la lecture seule), qui ne changent aucune décision mais lèvent une ambiguïté.
- Aucune suite de tests lancée (aucun code ne change).
- Aucun outil de listage de sessions d'agents appelé.

## 8. Arbitrages du propriétaire (7 points tranchés)

Les 7 risques de la §6 ont été **tranchés par le propriétaire** (via le coordinateur) et **écrits tels quels** dans `PLAN-mode-reseau-multipostes.md`, désormais en **v4**. Aucune réinterprétation, aucune décision rouverte : les **12 décisions fermes** (§11) et les **5 réglages validés** (§3) du plan sont **inchangés**. Toujours **aucune implémentation** (pas de migration, pas de fichier Rust/JS, pas de test créé).

| # | Arbitrage écrit | Où, dans le plan v4 |
|---|---|---|
| D1 | `poste_id` **est transmis au seul serveur GDS du projet, jamais à un autre service ni à un tiers** — la phrase « jamais transmis ailleurs » (contradictoire avec la colonne `poste_id` de `project_handovers`) est corrigée | §6 a, paragraphe « **Transmission de `poste_id`** » |
| D2 | `poste_id` **par machine, pas par projet** (option a) : généré **une fois** pour la machine, conservé dans la **configuration locale de l'application**, **recopié à l'identique** dans la configuration GDS de **chaque projet** → même `poste_id` sur tous les projets, donc idempotence du `take` (même `user_id` + même `poste_id` = renouvellement) valable **projet par projet** | §6 a, paragraphe « **`poste_id`** » (et rappel de l'idempotence en §6 b, règle `take`) |
| D3 | Tests base **obligatoires** avec une garde **STRICTE**, distincte du style existant : helper dédié qui **échoue** avec un message explicite si `PILOT_GDS_TEST_URL` est absente (jamais un `return None` silencieux) ; **les autres tests PostgreSQL existants gardent leur comportement** (ignorés proprement) et ne sont pas modifiés dans ce chantier | §7, étapes **2** et **3** (colonne « Test qui le prouve ») + paragraphe « **Garde STRICTE des tests base (décision D3)** » sous le tableau |
| D4 | **Ordre de la restitution** (seule séquence retenue, côté poste) : (1) si le projet est activé sur le GDS, publier le code (commit + push) ; (2) pousser l'état d'avancement ; (3) **seulement ensuite** appeler `return`. Échec en 1 ou 2 → restitution **non faite**, poste **toujours porteur**, bandeau, opération **rejouable**. **On ne libère jamais un projet avant que son code soit publié** ; filet de sécurité = expiration à **15 minutes** | §2 (synchro manuelle, séquence ordonnée), §6 b (bullet « **Ordre de la restitution** »), §7 **étape 4**, §8 (cas « la publication du code échoue à la restitution ») |
| D5 | **Glossaire** : « **agent du projet** » (travaille sur les fichiers — interdit à un poste non porteur) vs « **assistant de suivi** » (lit et répond — autorisé à tout moment, **lecture seule**). Le glossaire lève l'ambiguïté **sans toucher** au texte des 12 décisions | §1, sous-section « **Glossaire — « agent du projet » et « assistant de suivi »** » |
| D6 | **Travail local d'un poste non porteur** : les modifications déjà présentes ne sont **jamais supprimées ni écrasées** ; elles restent **locales**, **non publiables** tant que le projet n'est pas pris en main, et l'interface le dit (bandeau + action « **prendre le projet pour publier** »). **Aucune fusion automatique, aucune poussée silencieuse** | §1, sous-section « **Le travail local d'un poste non porteur n'est jamais perdu** » + §4 (ligne « Écriture des fichiers du projet et lancement d'agents ») |
| D7 | **Portée de `GET /api/gds/handover/state`** écrite **sans promesse** : en V1, « tout membre » = « **tout compte authentifié** », car le code n'a pas de notion de membre actif par projet ; la restriction réelle par projet est **une évolution future**, pas un acquis | §6 b, paragraphe « **Portée de lecture de `GET /api/gds/handover/state`** » (après le tableau des routes) |

**Ancres vérifiées avant écriture** (ouvertes sur le disque, pas recopiées de mémoire) : `gds-core/migrations/0001_init.sql:30-31` (V1 : tous les inscrits accèdent à tous les projets), `gds-core/src/db.rs:1748` (`ensure_project_publisher`), `gds-core/src/roles.rs:112-123` (`can_force_publish` ne dépend que du rôle), `gds-core/src/db.rs:2045-2051` (`fresh_migrated_test_db`, style existant « ignoré proprement »).

**Version du plan cohérente** : titre `(v4)`, en-tête « **v4 — les 7 risques de la relecture sont tranchés** », et note de fin (« les 7 risques sont désormais tranchés »). Les mentions de la **v2** qui subsistent (§4 bis, §9) sont **historiques** et restent justes.

---

**Livraison** : `PLAN-mode-reseau-multipostes.md` en **v4** (en-tête v4 conservant la ligne « ce qui change par rapport à la v2 »), ce rapport complété de la §8, et `plan_dev.md` mis à jour — le tout dans un seul commit.

## 9. Ce qui reste ouvert

> Le **troisième point ouvert** signalé en fin de mission précédente n'a **pas** été conservé dans ce rapport (rapport tronqué de ce côté) : je ne l'invente donc pas. Ce qui suit est la liste, **vérifiée sur le disque** à la date de la v4.1, des points qui restent **réellement** ouverts — une ligne par point, avec le risque concret et l'étape où il faudra trancher.

| # | Point ouvert | Risque concret | À trancher à l'étape |
|---|---|---|---|
| 1 | **Restriction par projet** de `GET /api/gds/handover/state` (D7) : « tout membre » = « tout compte authentifié » en V1 | n'importe quel compte inscrit sait qui tient un projet et jusqu'à quand ; aucune notion de membre actif par projet dans le code d'aujourd'hui | **étape 3** (routes `/api/gds/handover/*`), puis évolution future |
| 2 | **La documentation contredit encore l'exclusivité** : `README.md:283-285`, `spec_gds.md`, `spec_assistant_sync.md`, `plan_gds.md` affirment toujours « dernier qui écrit gagne » | un développeur — ou un agent qui lit la doc — peut conclure qu'écrire en parallèle sur le même projet est prévu | **étape 8** (tableau §9 du plan) |
| 3 | **Conséquence de la garde stricte sur les commandes de test** : `AGENTS.md` annonce `cargo test --workspace` ; dès l'étape 2, cette commande échouera sans base locale | l'échec sera pris pour une régression et cherché au mauvais endroit, alors qu'il suffit de démarrer la base jetable | **étape 8** (`AGENTS.md` : renvoyer à `docs/gds-server-setup.md` §11) |
| 4 | **`AGENTS.md:226`** documente encore « `0001_init` → `0007` » | référence fausse dès l'étape 1, puisque la série ira jusqu'à `0009` | **étape 8** (déjà planifié au §9 du plan) |

**Livraison v4.1** : `PLAN-mode-reseau-multipostes.md` passe en **v4.1** (titre et en-tête cohérents) avec **A1** écrit en §7 (« Où la base est fournie ») et **A2** écrit en §8 (« publication réussie, poste mort avant `return` ») ; `.github/workflows/gds-server-image.yml` fournit désormais la base au job `tests` (service PostgreSQL 16 jetable) ; `docs/gds-server-setup.md` gagne sa §11 (`PILOT_GDS_TEST_URL` + commande locale). **`release.yml` n'a pas été touché** (vérifié : `git diff --stat` ne le cite pas).
