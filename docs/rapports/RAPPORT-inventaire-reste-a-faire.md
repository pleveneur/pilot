# Inventaire — ce qui reste à finir (Pilot)

> Mission en **lecture seule** : aucun fichier de code, plan ou spec n'a été modifié.
> Seule écriture : ce rapport. Tous les chiffres ont été **recomptés sur le disque**
> le 26/10/2026 (aucun compteur de document réutilisé). État des lieux : `HEAD` =
> `de9b869`, dernier tag publié **v0.5.0**, `git rev-list --count v0.5.0..HEAD` = **45**.

**Tests lancés pendant l'inventaire** (avant de conclure) :

| Suite | Commande | Résultat |
|---|---|---|
| Frontend | `npx vitest run` | **3204 PASS / 0 FAIL** (177 fichiers `*.test.js` dans `src/js`) |
| Rust desktop | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **775 passed, 1 ignored** |
| Socle GDS | `cargo test -p gds-core` | **139 passed, 11 ignored** (les 11 exigent une base) |
| Socle GDS **avec base** | idem + `PILOT_GDS_TEST_URL` + `--include-ignored` (PostgreSQL 16 jetable) | **150 passed, 0 ignored** ✔ |
| Serveur GDS | `cargo test -p gds-server` | **34 passed** |

---

## 1. Tableau par domaine

### 1.a Pilot hors GDS

| Domaine | État | Preuve (fichier:ligne ou taille) |
|---|---|---|
| Chat agent π (RPC, streaming, outils) | **FAIT** | `src/js/agent-pi.js` (≈9 000 l.), `src-tauri/src/rpc.rs` |
| Boutons choix / confirmation / saisie + relais des questions d'un agent d'arrière-plan | **FAIT** | `src-tauri/extensions/pilot-choices.ts` (10,8 Ko), `src/js/agent-choice-relay.js:1-103` |
| Éditeur de dialogue `extension_ui_request` type `editor` | **FAIT** | `src/js/agent-pi.js:8950` → `appendExtensionEditor` |
| Export de conversation (Markdown / HTML) | **FAIT** | `src/js/conversation-export.js` (233 l.) |
| Orchestration multi-agents (bus, reviewer, snapshots, autotest, observabilité, réservations) | **FAIT** | `src/js/agents-bus.js` (3 951 l.), `orchestration-reviewer.js`, `reservations.js` |
| Quatre règles de la chaîne d'agents (boucle, lecture, trace, mission) | **FAIT** | `loop-detection.js` (1 117 l.), `agent-stop-trace.js`, `agent-stop-funnel.js`, `mission-identity.js` |
| Context Engine · Code Graph · Mémoire projet · Historique sessions | **FAIT** | `context-engine.js` (482 l.), `code-graph.js`, `project-memory.js` (111 l.), `session-history.js` (388 l.) |
| Diff Review (porte pré-écriture) | **FAIT** | `src/js/diff-view.js` (386 l.), `extensions/pilot-edit-gate.ts` (4,5 Ko) |
| Détection d'anomalies (agents bloqués) | **FAIT** | `src/js/anomaly.js` (8,7 Ko), `src-tauri/src/anomaly.rs` (120,7 Ko) |
| Lecture à voix haute + 4 voix françaises locales | **FAIT** | `read-aloud.js` (1 116 l.), `local-voice.js` (753 l.), `tts_local.rs` (903 l.), `tts_local_download.rs` |
| Laya (marches 1 à 6 : pilotage, UI, modèle, embarqué, appartenance + journal) | **FAIT** | `src-tauri/src/laya.rs` (68,8 Ko : `stop_owned`, `cleanup_stale`, `open_log`, `last_outcome`, `launch_if_needed`) |
| Prise en main à la première ouverture (niveaux 1 et 2) | **FAIT** | `src/js/onboarding.js` (692 l.), `spec_onboarding.md:109` « Rien sur ce lot » |
| Passerelle Telegram (envoi, écoute, réponses, dialogue) | **FAIT** | `spec_telegram.md:3` ✅ (lots 0, 1, 3 + canal) |
| Accès distant web v1 | **FAIT** | `spec_web_remote.md:3` 🟢 ; `src-tauri/src/web_server.rs`, `web/` |
| Conversion PDF → Markdown | **FAIT** | `src/js/pdf-to-markdown.js` (7,7 Ko), `src-tauri/src/pdf.rs` |
| MCP | **PARTIEL** | `src-tauri/src/mcp_config.rs` (2 543 l.) + `extensions/pilot-mcp-client.ts` (681,7 Ko) = **consommateur** ; H10 « Pilot fournisseur d'outils MCP » : **ABSENT** (0 fichier) |
| Dictée vocale desktop | **à vérifier à l'usage** | `agent-pi.js:848-931` branche `SpeechRecognition`, bouton masqué s'il est absent (WebView2) ; correctif `src-tauri/vendor/wry/src/webview2/mod.rs:505` |
| H4 Plan Editor visuel | **ABSENT** | `plan-editor` / « Plan Editor » : **0 occurrence** dans `src/js`, `src-tauri/src`, `index.html` |
| H6 Routing multi-modèle | **ABSENT** | `plan_dev.md:12` « reporté » ; aucun module de routage |
| Sous-projets liés (ouverture groupée) | **ABSENT** | `subproject` : **0 occurrence** dans le code ; `spec_subprojects.md:7` « aucune implémentation » |
| Composant web de discussion, issue #56 (phase D) | **ABSENT** | `spec_web_component.md:7` « aucune implémentation » ; côté serveur les **tickets** existent déjà (`gds-core/src/http.rs:168-176`) |
| Partage du suivi entre postes (`spec_assistant_sync.md`) | **ABSENT** | `spec_assistant_sync.md:3` 🟡 « Aucune implémentation » |
| Tests proprement multi-plateforme (macOS, Linux) | **à vérifier à l'usage** | `spec_rpc.md:341` toujours `[ ]` ; `.github/workflows/release.yml:40` macOS en `continue-on-error` |

### 1.b GDS et mode réseau multi-postes

| Domaine | État | Preuve |
|---|---|---|
| Verrou global projet retiré | **FAIT** | `gds-core/migrations/0007_drop_project_locks.sql`, garde `gds-core/src/http.rs:2799` |
| Étape 1 — table + règles pures du portage | **FAIT** | `gds-core/migrations/0008_project_handover.sql` (45 l.), `gds-core/src/handover.rs` (40 Ko : `take:397`, `heartbeat:436`, `return_project:481`, `force_return:532`) |
| Étape 2 — base du portage (transaction unique) | **FAIT** (prouvé avec base) | `gds-core/src/db.rs:1947-2045` (`handover_active_row`, `_open_row_tx`, `_insert_tx`, `_renew_tx`, `_close_open_tx`) ; 6 tests base **vertes** |
| Étape 3 — routes HTTP du portage | **FAIT** (prouvé avec base) | `gds-core/src/http.rs:196` (take), `:198` (heartbeat), `:201` (return), `:202` (state), `:321` (force, zone admin) ; 5 tests base **vertes** |
| Étape 4a — `poste_id` + commandes côté poste | **FAIT** | `src-tauri/src/gds.rs:296-341`, `gds_handover.rs:1185-1241` |
| Étape 4b — présence automatique + restitution ordonnée | **FAIT** | `gds_handover.rs:759` (moniteur), `:777-913` (`PublishCode` → `PushTracking` → `Return`, `push_tracking:912`) |
| Étape 5 — interface (bandeau, prendre/rendre) + garde tenue par le socle | **FAIT** | `src/js/gds.js:278-317`, `gds-status.js`, `gds_write_guard.rs` (22 246 o) ; branché : `files.rs:89,134`, `agents.rs:222`, `rpc.rs:482`, `gds_sync.rs:1120`, `lib.rs` |
| Libération forcée par un administrateur | **FAIT** | `gds_admin.rs:1007`, `gds_handover.rs:1012` (`write_verdict`), route `http.rs:321` |
| Étape 6 — `0009_project_info.sql` (informations projet côté serveur) | **ABSENT** | `ls gds-core/migrations/` s'arrête à `0008_project_handover.sql` |
| Étape 7 — le poste pousse l'avancement via `project_info` | **ABSENT** *tel que prévu* | Aucun `project_info` ; **mais la fonction est couverte autrement** : `gds_sync.rs:1025` `force_push_tracking` (appelée par la restitution) et pont bidirectionnel `gds_sync.rs:551` `sync_tracking_inner` |
| Étape 8 — documentation (`spec_reseau.md`, contradictions, `AGENTS.md`) | **PARTIEL** | `spec_reseau.md` réécrit, `README.md:298-310` à jour, `AGENTS.md:226` dit `0008` ✔ ; **mais** `AGENTS.md:295-296` et `plan_gds.md:260,414` citent `gds_db.rs`/`gds_git.rs` **dans `src-tauri`** : ces fichiers n'y existent pas (le socle a `gds-core/src/db.rs`, `git.rs`) |
| Étape 9 — bout en bout 2 postes au niveau interface | **ABSENT** | `src/js/gds-network-e2e.test.js` **inexistant** ; `gds-server/tests/e2e.sh` (433 l.) ne mentionne **jamais** `handover` (0 occurrence) |
| Restriction des projets par membre | **ABSENT — et c'est voulu** | Décision 2026-09 : routes d'attribution supprimées, contrôle qui l'empêche de revenir (`gds-core/src/http.rs:2793-2818`) |

---

## 2. Documents de planification qui contredisent le code réel

| Document:ligne | Ce qu'il affirme | Ce que le code montre | Verdict |
|---|---|---|---|
| **`plan_dev.md:8` et `:24`** | « Mode réseau multi-postes : plan figé, réalisation à démarrer — **rien d'implémenté** » | `gds_handover.rs` **85 615 o** (étape 4a/4b), `gds_write_guard.rs` **22 246 o** (étape 5), migration `0008` (45 l.), `handover.rs` (40 Ko), 5 routes, `gds.js:278-317`, 14 fichiers de test GDS (dont `gds-handover.test.js` 24,3 Ko) | **FAUX — c'est `plan_dev.md` qui ment.** Il a été modifié le **25/10 à 14:48** ; les étapes ont été codées **après** (`866ede0` 15:31, `67e4bb5` 16:13, `e0d95da` 26/10 00:26) |
| `spec_reseau.md:3` | « le portage est implémenté de bout en bout (étapes 1 à 5) ; les étapes 6-7 et 9 ne le sont pas » | Exactement l'état trouvé (voir §1.b) | **VRAI** |
| `PLAN-mode-reseau-multipostes.md:252` | « Aucune implémentation dans ce document : pas de migration `0008`/`0009`, aucun fichier Rust ou JS de code » | Vrai du **document**, faux du **dépôt** : `0008` existe | **PÉRIMÉ** (à dater ou à nuancer) |
| `spec_rpc.md:336,339,340` | `[ ]` modèle par défaut, `[ ]` éditeur `editor`, `[ ]` export de conversation | Modèle par défaut de l'Assistant : `settings.js:2617` (`set_super_agent_default_model`) ; éditeur : `agent-pi.js:8950` ; export : `conversation-export.js` (233 l.) | **PÉRIMÉ (3 lignes sur 4)** |
| `spec_voice_input.md:3` | bouton 🎙️ **desktop** « présent mais informatif » (micro bloqué) | Le bouton est **branché** (`agent-pi.js:848-931`) et le micro WebView2 est autorisé par le correctif `vendor/wry/src/webview2/mod.rs:505` | **PÉRIMÉ** (le code fait plus que la spec) |
| `spec_laya.md:3` | statut arrêté à « Marche 5 implémentée » (Marche 6 décrite, non datée) | Marche 6 **codée** : `laya.rs` `stop_owned`, `cleanup_stale`, `open_log`, `last_outcome` | **INCOMPLET** (sous-estime) |
| `AGENTS.md:295-296` · `plan_gds.md:260,414` | `src-tauri/gds_db.rs`, `src-tauri/gds_git.rs`, `gds_client.rs` | `src-tauri` contient `gds.rs`, `gds_admin.rs`, `gds_client.rs`, `gds_handover.rs`, `gds_service.rs`, `gds_ssh.rs`, `gds_sync.rs`, `gds_web.rs`, `gds_write_guard.rs` — **pas** `gds_db.rs`/`gds_git.rs` (dans `gds-core`) | **FAUX (arborescence)** |
| `plan_dev.md:12` | H10 « MCP extensible » reporté | `mcp_config.rs` (2 543 l.) + extension MCP bundlée : le **consommateur** est livré | **Partiellement périmé** |
| `spec_rpc.md:341` | `[ ]` tests multi-plateforme | Toujours vrai ; macOS en `continue-on-error` (`release.yml:40`) | **VRAI** |

---

## 3. Mode réseau multi-postes : fait, reste, et ce qu'il manque pour essayer à deux postes

**Fait (5 étapes sur 9)** : table `0008` + règles pures (1) · base transactionnelle (2) · 5 routes
(3) · poste `poste_id` + présence + restitution ordonnée (4a/4b) · interface + garde d'écriture
tenue par le socle, pas par l'écran (5). Plus la libération forcée par un administrateur (motif +
audit). **Ces cinq étapes sont prouvées** : 150/150 tests du socle verts *avec* une base
PostgreSQL 16 jetable, dont les 11 tests d'exclusivité (deux prises concurrentes → un seul
porteur, reprise après expiration, restitution qui libère pour le suivant).

**Reste** : étape 6 (`0009_project_info`) · étape 7 (poussée via `project_info`) · étape 9
(test bout en bout 2 postes) · fin de l'étape 8 (arborescence `AGENTS.md`/`plan_gds.md`).

**Manque pour essayer à deux postes**

*Côté serveur*
1. L'**image locale** est celle de v0.5.0 : `gds-core` a reçu **6 084 lignes** depuis
   (`git diff --stat v0.5.0..HEAD -- gds-core` : 13 fichiers, dont `http.rs` +1 223 et
   `handover.rs` +1 077). Sans `npm run gds:image` puis `npm run gds:reload`, le serveur ne
   connaît **pas** `/api/gds/handover/*` : le portage répond en erreur (la garde reste
   *fail-open*, donc les écritures passent — le blocage d'écriture ne protège plus rien).
2. **Deux comptes** validés sur le serveur (rôle `dev` ou `admin`) : la prise en main exige une
   identité (`docs/gds-guide-mise-en-place.md` §3.4).
3. Rien d'autre : le conteneur tout-en-un (`gds-server/Dockerfile`, `docker-compose.yml`) et la
   migration `0008` suffisent.

*Côté poste (sur chaque machine)*
4. `.pilot/gds.json` avec `enabled: true`, `server_url` renseigné et `identity_email` valide — sur
   **cette** machine : `"enabled": false`, `"server_url": ""` → le chemin réseau n'est pas actif.
5. **Même projet serveur** des deux côtés (`project_id` commun) : sinon les postes ne se
   disputent rien (piège n°1 du guide, `docs/gds-guide-mise-en-place.md:940`).
6. `poste_id` généré **une seule fois par machine** (`gds.rs:341`) : il ne doit pas être recopié
   d'un poste à l'autre, sinon l'exclusivité se croit satisfaite alors qu'un seul identifiant
   existe.
7. **La séquence complète n'a jamais été exercée** : A prend → travaille → rend (code →
   avancement → return) puis B reprend et **voit l'avancement à jour**. Aucun test ne la couvre
   (étape 9 absente) et le guide le dit lui-même : `docs/gds-guide-mise-en-place.md:1283-1284`
   « comportement **annoncé**, non essayé ici à deux postes réels ».

---

## 4. Terminé — ne plus rouvrir

1. **Prise en main par projet** (migration `0008`, règles, routes, poste, interface, garde,
   libération admin) : 150 tests du socle verts, base réelle comprise.
2. **Fin du verrou global** (`0007`) : ne pas le réintroduire (`http.rs:2799` le garde).
3. **Pas de restriction par membre** (décision 2026-09) : les routes d'attribution doivent rester
   supprimées.
4. **Garde d'écriture tenue par le socle** : ne jamais la déplacer vers l'écran ; elle est
   *fail-open* par conception (panne, prise expirée, projet libre ⇒ autorisé).
5. **`spec_reseau.md`** : seule description à jour du mode réseau ; `plan_dev.md` ne doit plus
   être la référence.
6. **Refonte serveur GDS** (conteneur tout-en-un, socle `gds-core`, trois rôles) et **phases A, B,
   C1, C2.1→C2.3**, **lots L1→L6** : livrés, ne pas refaire.
7. **Chaîne d'agents** (bus, boucle, trace, entonnoir, identité de mission) et **les trois
   chemins d'arrêt automatique** partageant le même classifieur.
8. **Orchestration** (reviewer, snapshots, autotest, observabilité), **Context Engine**,
   **Code Graph**, **Mémoire projet**, **Historique de sessions**, **Diff Review**, **Anomalies**.
9. **Lecture à voix haute + 4 voix Piper locales** (téléchargement sur geste, repli visible).
10. **Laya marches 1→6**, **Telegram lots 0/1/3 + dialogue**, **dictée vocale web**, **accès
    distant web v1**, **prise en main 1-2**, **PDF → MD**, **tableau de bord**, **coffre**,
    **feedback**.
11. **Export de conversation**, **éditeur `editor`**, **modèle par défaut de l'Assistant** :
    livrés (les `[ ]` de `spec_rpc.md` sont périmés, pas le code).

---

## 5. Points bloquants pour publier la version actuelle (v0.5.0 + 45 commits)

1. **Image du serveur GDS périmée** — `gds-core` a changé de 6 084 lignes depuis v0.5.0 ; publier
   une app qui appelle `/api/gds/handover/*` sans reconstruire l'image (`npm run gds:image`) laisse
   le portage en erreur chez tous ceux qui ont déjà un serveur. **À faire avant l'annonce.**
   Preuve : `git diff --stat v0.5.0..HEAD -- gds-core` = 13 fichiers, 6 084 insertions.
2. **Aucune preuve « deux postes »** — étape 9 absente (`src/js/gds-network-e2e.test.js`
   inexistant) et `gds-server/tests/e2e.sh` (433 l.) ne cite jamais `handover`. Ce qui est publié
   est donc une exclusive **prouvée en base**, mais **jamais exercée de bout en bout** (interface
   seulement simulée : `gds-handover.test.js`).
3. **La preuve d'exclusivité n'est pas dans la chaîne de publication** — `release.yml` ne lance que
   `cargo test --manifest-path src-tauri/Cargo.toml --lib` + `npm test` (`release.yml:107,109`) ;
   les 11 tests du portage sont `#[ignore]` et **refusent de passer sans base** (`gds-core/src/db.rs:3718`
   `strict_handover_test_db`, panic volontaire). Verts ce soir via la commande documentée
   (`PILOT_GDS_TEST_URL` + `--include-ignored` : 150/150), mais **rien ne l'impose** avant un tag.
4. **`plan_dev.md` faux part en publication** — il affirme encore « rien d'implémenté » pour le
   mode réseau (lignes 8 et 24) : la roadmap livrée contredirait le produit. Correction = 2 lignes.
5. **Aucune note de version pour les 45 commits** — `release-notes/v0.5.1.md` n'existe pas (dernier
   fichier : `v0.5.0.md`) ; publier exige le changelog + le bump des **4** fichiers de version
   (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `Cargo.lock` — paquet
   `pilot` uniquement).

*Non bloquant mais à savoir* : le projet n'est **pas** basculé sur le GDS (`.pilot/gds.json`
`enabled: false`) → la publication GitHub reste autorisée ; macOS est en `continue-on-error`
(`release.yml:40`), donc une régression macOS-only passerait inaperçue.

DONE: inventaire terminé — 5 étapes sur 9 du mode réseau sont faites et prouvées (150/150 tests du socle avec PostgreSQL jetable), les étapes 6-7 (0009/project_info) et 9 (test 2 postes) sont absentes ; le document qui ment est `plan_dev.md` (lignes 8 et 24), périmé de 10 heures par rapport aux commits `866ede0`/`67e4bb5`/`e0d95da` ; aucune correction n'a été faite hors ce rapport.
