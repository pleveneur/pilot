# Rapport — les voies par lesquelles une tâche est déclarée « terminée » sans vérification

Date : 2026-11-19 · Projet : `G:\IA_PL\pilot` · Rédaction : vérificateur en **lecture seule**.
Aucun fichier de code, de test, de spec ou de configuration n'a été créé, modifié ni supprimé :
le présent rapport est le **seul** fichier écrit. Aucune suite de tests n'a été exécutée
(`cargo test` interdit, `npx vitest run` non nécessaire : aucun constat de ce rapport ne
repose sur un résultat de test vert). Tout ce qui suit vient de la lecture du dépôt.

---

## 0. Ce que veut dire « verrouillée » ici — et pourquoi ce rapport distingue trois cas

Une règle est **verrouillée** quand une seule chose est vraie : *retirer la règle du code
(ou la contourner) fait rougir un test automatique, sans intervention humaine*. Ce n'est pas
« il y a un test qui parle de cette règle », ni « la règle est écrite en majuscules ».
Trois catégories sont utilisées :

| Catégorie | Sens exact | Conséquence |
|---|---|---|
| **verrouillée** | un test rougit si la règle disparaît | la règle tient sans bonne volonté |
| **verrouillée — portée limitée** | un test tient la règle, mais **seulement sur un chemin, une cible ou un sujet** ; un autre chemin passe à côté | la règle tient en partie, l'illusion de garantie est le vrai risque |
| **écrite** | la règle n'existe qu'en prose (AGENTS.md, spec, commentaire, prompt) ou qu'en geste humain ; **aucun test ne rougit** si on la retire | la règle tient à la bonne volonté de l'agent ou de l'humain |

Cette distinction est celle qui a été demandée ; elle est tenue strictement ci-dessous.
Une règle « écrite » n'est pas une règle fausse : c'est une règle **non garantie**.

---

## 1. Tableau de synthèse — les huit exigences et leur garde réelle

| # | Exigence | Garde automatique ? | Catégorie | Preuve principale (fichier:ligne) |
|---|---|---|---|---|
| 1 | Le livrable déclaré existe sur disque | **oui, mais sur déclaration volontaire** | verrouillée — portée limitée | `src/js/agents-bus.js:3622` (sonde), `:3633` (verdict) ; pas de sonde du tout sur `delegate_to_coder` (`src/js/super-agent.js:10196`) |
| 2 | Tests verts avant de dire « terminé » | **non, sauf en mode Orchestration** | verrouillée — portée limitée + écrit | `src/js/agent-pi.js:5015` (seul appel de la porte E2) ; `run_agents`/`delegate_to_coder`/chat agent : aucune exécution de tests |
| 3 | Rapport écrit dans `docs/rapports/`, jamais à la racine | **non** | écrite | AGENTS.md § « Rapports et conceptions » ; aucune assertion sur l'emplacement d'un rapport dans `src/**/*.test.js` ni `scripts/*.test.js` |
| 4 | Documentation à jour quand le comportement change | **non, à une exception près** | écrite | un seul sujet verrouillé : `src/js/help-delai-inactivite.test.js:117-124` (fraîcheur du handbook) |
| 5 | Un test n'est jamais assoupli ni supprimé pour faire passer une livraison | **non** | écrite | aucune assertion sur `.skip`/`.only` ; aucun manifeste de tests ; aucun décompte protégé |
| 6 | Checklist qualité non ignorable avant clôture | **oui, mais supprimable et contournable** | verrouillée — portée limitée | `src-tauri/src/super_agent.rs:3438` (porte), `:3362` (0 point ⇒ autorisé), `:3268` (suppression sans garde), `:1102` (SQL brut) |
| 7 | Publication : version partout, changelog, pas de tag republié, tests verts avant | **partiellement : seuls les tests sont bloquants** | verrouillée — portée limitée (tests) / écrite (le reste) | `.github/workflows/release.yml:136-137` (`build` exige `test`), `:117` (`create-release` **sans** `needs`) ; `scripts/gen-latest-json.js:44` ; `scripts/create-release.js:40-43` |
| 8 | Un agent qui répond « terminé » sans rien produire | **oui, mais seulement dans le groupe parallèle** | verrouillée — portée limitée | `src/js/agents-bus.js:3299` (texte vide ⇒ échec), `:297-311` (`pending > 0` vaut preuve) |

Lecture rapide : **aucune** des huit exigences n'est verrouillée de bout en bout. Deux le sont
sur un chemin (1, 2, 6, 8), quatre ne le sont pas du tout (3, 4, 5, et la moitié de 7).

---

## 2. Les contournements, du plus grave au moins grave

Chaque entrée suit le même plan : **ce qui est possible**, **preuve**, **pourquoi c'est grave**,
**verrou minimal proposé**. Aucun trou n'est proposé « par principe » : chacun a été constaté
sur le disque.

---

### C1 — L'assistant peut écrire la table des tâches en SQL brut, sans passer par aucune porte

**Ce qui est possible.** L'assistant 🧭 dispose de l'outil `db_execute`, qui accepte **n'importe
quel** SQL non-`SELECT` sur sa base de suivi (`~/.pilot/super-agent.db`). Rien n'interdit
`UPDATE tasks SET status='terminee' WHERE id=42`. La seule restriction est un refus si la
requête **commence** par `SELECT`.

**Preuve.**

- `src-tauri/src/super_agent.rs:1100-1109` — `super_agent_db_execute(app, sql)` : refus si
  `upper.starts_with("SELECT")` (`:1105`), puis `conn.execute_batch(&sql)` (`:1108`). Aucun
  filtrage de table, aucune trace, aucune invocation de `guard_task_checklist`.
- `src-tauri/extensions/pilot-assistant-db.ts:63-77` — l'outil `db_execute` est **exposé** à
  l'assistant, avec la description « CREATE TABLE, INSERT, UPDATE, DELETE, ALTER, DROP, PRAGMA ».
- `src-tauri/extensions/pilot-assistant-db.ts:71` — la consigne au modèle est **écrite**, et
  seulement écrite : « The core tables (clients, projects, tasks, decisions, session_summaries)
  are managed by Pilot — avoid modifying them directly ». `avoid` n'est pas `cannot`.
- La porte existe pourtant, et elle est correcte : `guard_task_checklist`
  (`src-tauri/src/super_agent.rs:3438`) n'est appelée que par les deux commandes de statut
  (`:5043-5047` pour `super_agent_update_task`, `:5150-5154` pour
  `super_agent_update_task_status`). L'outil dédié `update_task_status`
  (`src-tauri/extensions/pilot-assistant-tools.ts:91-105`) passe bien par la porte.
- Aucun test ne couvre `super_agent_db_execute` autrement que par des assertions sur la **vue**
  ou sur le **prompt** : `src/js/super-agent-data-analysis.test.js:80` vérifie une phrase du
  prompt ; `src/js/super-agent-deliverables.test.js:376` et
  `src/js/super-agent-time-tranche6.test.js:185` vérifient l'interface. Retirer
  `super_agent_db_execute` ne ferait rougir personne.

**Pourquoi c'est le plus grave.** Toutes les autres gardes de ce rapport protègent une
déclaration *faite par un agent*. Celle-ci donne à l'entité contrôlée un accès direct en
écriture à la base qui porte la vérité (statuts, checklist, livrables, décisions). Elle rend
C5 (checklist) et le contrôle des statuts purement décoratifs : il suffit de ne pas utiliser
l'outil gardé. C'est aussi la seule voie qui permet d'écrire un statut **sans laisser de trace
applicative**.

**Verrou minimal proposé.** Une règle de portée, dans le socle, et un test pur :

1. ajouter une fonction **pure** `db_execute_scope(sql) -> Result<(), String>` qui refuse toute
   instruction dont la cible est `tasks`, `task_checks` ou `deliverables` (« ces tables
   s'écrivent par les commandes de suivi, pas par SQL ») et laisse passer le reste
   (`CREATE TABLE assistant_notes…`) ;
2. `super_agent_db_execute` appelle cette fonction avant `execute_batch` ;
3. test unitaire Rust (aucun `AppHandle` requis) : `UPDATE tasks SET status='terminee'` ⇒ `Err`,
   `DELETE FROM task_checks` ⇒ `Err`, `CREATE TABLE assistant_notes(x TEXT)` ⇒ `Ok`.

Coût : une fonction pure + une ligne d'appel + trois cas de test. Aucune table, aucune
commande, aucun réglage modifié.

---

### C2 — La preuve du livrable n'existe que si l'entité contrôlée veut bien la déclarer, et pas du tout sur `delegate_to_coder`

**Ce qui est possible.** Le garde-fou « livrable » ne se déclenche que si l'assistant remplit
l'argument **facultatif** `expected_files`. S'il l'omet, ou s'il déclare un fichier déjà
présent, ou s'il utilise `delegate_to_coder` (qui n'a **pas** cet argument), la mission peut
être rapportée « terminée » sans qu'aucun fichier n'ait été vérifié.

**Preuve.**

- `src/js/agents-bus.js:3622` — la sonde `verifyExpectedFiles({ declared, base, invokeFn })`
  n'est appelée que si `expectedFiles` a été transmis avec l'assignation
  (`src/js/super-agent.js:9100-9112`, `:9533-9540`).
- `src-tauri/extensions/pilot-assistant-actions.ts` — `expected_files` est déclaré **deux fois**
  seulement : sur `run_agents` et sur `run_assistant_agents`. `delegate_to_coder`
  (`src/js/super-agent.js:10136` et suivantes) ne reçoit que le refus en lecture seule
  (`:10196`), **jamais** de vérification de fichiers en fin de mission.
- Le test **fixe ce trou** : `src/js/garde-fou-livrable.test.js:415-417` exige
  `expect(occurrences).toBe(2)` (« déclaré sur run_agents ET run_assistant_agents »), et
  `:399-404` ne demande à `delegate_to_coder` que `readOnlyWriteRefusalMessage`. Ajouter la
  garde à `delegate_to_coder` **ferait rougir un test** : ici le verrou protège l'absence de
  garde.
- Le garde-fou d'entrée, lui, est réel : `readOnlyWriteRefusalMessage`
  (`src/js/deliverable-guard.js:626`) refuse une demande d'écriture explicite vers un agent en
  lecture seule. Mais il ne dit rien d'un agent en **écriture** qui ne produit rien.

**Pourquoi c'est grave.** La garantie est **volontaire**. Un contrôle qui ne s'active que sur
déclaration de la partie contrôlée n'est pas un contrôle, c'est une politesse. Et
`delegate_to_coder` est précisément la voie courte utilisée pour « confie ça au codeur ».

**Verrou minimal proposé.**

1. inverser le test `:415-417` : `expected_files` obligatoire sur les **trois** outils ;
2. sur `delegate_to_coder`, exiger `expected_files` dès que la demande contient une cible de
   fichier et un verbe d'écriture — la détection existe déjà et est pure
   (`detectExplicitWriteRequest`, `stripFileTargets`, `src/js/deliverable-guard.js:567` et
   `:151`) : il suffit de réutiliser `readOnlyWriteRefusalMessage` en y ajoutant la règle
   « écriture demandée + `expected_files` vide ⇒ refus au lancement, en nommant ce qui manque » ;
3. test pur sur cette nouvelle branche (aucune I/O, aucune UI) : `delegate_to_coder` +
   « crée `docs/plan.md` » + `expected_files` absent ⇒ refus nommant `docs/plan.md`.

---

### C3 — « Le livrable existe » ne prouve rien : l'existence seule est vérifiée, pas la production

**Ce qui est possible.** Le fichier déclaré peut **déjà exister avant la mission**, ou être
**vide** : le verdict sera « ✅ Livrable vérifié sur le disque ». La sonde ne compare ni date,
ni empreinte, ni appartenance à la run.

**Preuve.**

- `src/js/deliverable-guard.js:735-765` — `verifyExpectedFiles` n'appelle que
  `invokeFn("file_exists", { path: abs })` (`:759`) ; le résultat est `present` ou `missing`.
- `src/js/deliverable-guard.js:729-730` — le code **l'écrit lui-même** : « L'existence est le
  seul critère : un fichier déclaré EXISTANT mais vide est conforme. »
- `src/js/deliverable-guard.js:776-778` — `deliverableFailed` ne regarde que `missing`.
- Le module sait pourtant produire la matière nécessaire : `deliverableVerdictText` distingue
  déjà `present`, `missing`, `unreadable` (`:683-710`) ; la structure de verdict est extensible
  sans changer les appelants.

**Pourquoi c'est grave.** C'est la combinaison avec C2 qui est toxique : l'assistant peut
déclarer un fichier préexistant (`README.md`, `spec_pilot.md`, un rapport déjà là) et la
mission est « vérifiée ». Le garde-fou devient une formalité qui **rassure à tort**.

**Verrou minimal proposé.**

1. relever `mtime` (ou empreinte) de chaque fichier déclaré **au lancement** de la mission,
   puis exiger un changement à la fin — la commande `file_exists` existe déjà, un
   `read_file_meta` équivalent est le seul ajout technique ;
2. nouveau champ `unproven` dans le verdict ; `deliverableFailed` échoue sur `unproven`
   seulement pour une mission d'écriture (les missions de lecture restent inchangées) ;
3. test **pur** sur `verifyExpectedFiles` avec un `invokeFn` bouchonné : fichier présent mais
   inchangé ⇒ `unproven` ⇒ `deliverableFailed === true`.

---

### C4 — « Travail présent sur le disque » accepte des modifications qui existaient AVANT la run

**Ce qui est possible.** Quand un agent se termine sans texte final, la part est sauvée du
statut d'échec si `provesWorkOnDisk` répond vrai. Or cette fonction répond vrai dès que le
projet a **au moins une modification non committée** — sans aucune comparaison avec l'instant
de départ. Un projet déjà « sale » (cas courant ici) transforme donc « aucun texte, aucun
travail » en « travail présent, pas un échec ».

**Preuve.**

- `src/js/agents-bus.js:297-311` — `provesWorkOnDisk(status, startedAt, readonly)` :
  `if (Number(status.pending) > 0) return true;` (`:309`). Seul `head_ts` est comparé à
  `startedAt` (`:308`) ; `pending` ne l'est pas.
- `src/js/agents-bus.js:3289-3293` — l'appelant en tire un texte de **succès** :
  « Travail PRÉSENT sur le disque (commit ou fichiers modifiés pendant l'exécution) : la
  mission n'est PAS un échec ».
- La même sonde sert au watchdog (`src/js/agents-bus.js:337-347`) : un arrêt par inactivité sur
  un projet déjà modifié est donc rapporté « run interrompue, résultat partiel » au lieu d'un
  échec.
- Le garde-fou correctif existe bien pour les missions de **lecture** (`readonly === true`,
  `:305`) — c'est la preuve que le raisonnement « le disque ne prouve pas cette mission » a
  déjà été compris, mais s'arrête à mi-chemin.

**Pourquoi c'est grave.** C'est le mensonge le plus fréquent en pratique : sur un dépôt qui
porte des modifications non committées, **tout** agent silencieux devient un succès. L'assistant
ne relance pas, l'utilisateur croit que c'est fait.

**Verrou minimal proposé.** Prendre un relevé **avant** la run (`pendingBefore`), puis :

1. `provesWorkOnDisk(status, startedAt, readonly, pendingBefore)` :
   `pending - pendingBefore > 0` ⇒ preuve ; sinon non ;
2. test pur (aucune I/O, aucun DOM) : `{ is_repo: true, head_ts: 0, pending: 5 }` avec
   `pendingBefore = 5` ⇒ `false` ; avec `pendingBefore = 2` ⇒ `true` ; `readonly` ⇒ `false`
   dans tous les cas.

---

### C5 — La checklist qualité est supprimable, et une tâche sans point n'a aucun contrôle

**Ce qui est possible.** Trois chemins ferment une tâche « terminée » sans qu'un seul point de
checklist n'ait été examiné :
1. la tâche n'a **aucun point** — c'est le cas par défaut, le modèle de checklist est
   seulement **proposé** à la création ;
2. les points sont **supprimés** avant la clôture (`super_agent_task_check_delete` n'a aucune
   garde) ;
3. C1 (SQL brut de l'assistant) écrit le statut sans passer par la porte.

**Preuve.**

- `src-tauri/src/super_agent.rs:3361-3363` — `evaluate_checklist_gate` : `if unchecked == 0
  { return GateVerdict::Allowed; }`. Une tâche sans point est donc **toujours** close.
- `src-tauri/src/super_agent.rs:3438-3456` — `guard_task_checklist` n'agit que si
  `classify_task_status(new_status) == "done"` (comportement correct) et ne lit que les points
  **restants** : supprimer les points suffit à faire passer la porte.
- `src-tauri/src/super_agent.rs:3266-3273` — `super_agent_task_check_delete` :
  `db_delete_task_check(&conn, check_id)?` puis `Ok`. Aucun contrôle d'état de la tâche, aucune
  trace. (Côté humain : `src/js/super-agent-kanban-view.js:1078`.)
- Le modèle par défaut existe (`default_super_agent_checklist_template`,
  `src-tauri/src/lib.rs:1016` ; vue `src/js/super-agent-kanban.js:685-707` ;
  `shouldOfferTemplatePoints`) mais n'est **pas appliqué** à la création : c'est une offre.
- Les tests purs de la porte sont bons et complets (`src-tauri/src/super_agent.rs` — cas
  `unchecked = 0`, `off`, `warn`, `block`, mode inconnu, avec et sans `force`) : **la décision
  est verrouillée, l'intégration ne l'est pas.** Les tests d'intégration **rejouent** la
  séquence dans un helper (`apply_status_change_like_the_commands`,
  `src-tauri/src/super_agent.rs:9484`) au lieu d'appeler les commandes : une divergence du code
  de production ne ferait pas rougir le test.

**Pourquoi c'est grave.** « Checklist non ignorable » est faux dans le cas le plus courant
(tâche créée sans point) et faux sur un geste (supprimer les points). Le contrôle protège la
bonne volonté, pas la clôture.

**Verrou minimal proposé.**

1. `db_delete_task_check` refuse (ou journalise) la suppression d'un point d'une tâche déjà
   `done` — test pur sur `&Connection` en base mémoire, comme les tests existants ;
2. `super_agent_add_task` applique le modèle configuré par défaut (points créés avec la tâche)
   sauf demande explicite « sans point » — test pur : tâche créée avec modèle configuré ⇒
   `db_list_task_checks` non vide ; test de non-régression : modèle vide ⇒ aucun point, aucune
   erreur ;
3. remplacer, pour au moins un cas, le helper de rejeu `:9484` par un test qui appelle la
   commande réelle (les commandes gardées n'ont besoin que d'un `AppHandle` de test déjà
   présent dans les tests voisins).

---

### C6 — Hors mode Orchestration, « terminé » ne suppose jamais des tests verts ; même en Orchestration la porte est fail-open

**Ce qui est possible.** Sur les trois voies qui déclarent un livrable de code (`run_agents`,
`delegate_to_coder`, chat agent π hors orchestration), **aucun test n'est exécuté** avant de
conclure. En mode Orchestration, la porte E2 existe, mais elle échoue « ouverte » dans au moins
six situations, sans que la tâche en soit informée.

**Preuve.**

- Une seule porte de tests existe : `runTestGate` (`src/js/agent-pi.js:4244`) appelée une seule
  fois, dans la boucle d'orchestration (`src/js/agent-pi.js:5015`). Le bus d'agents
  (`src/js/agents-bus.js`) n'appelle jamais `run_project_tests` : la seule occurrence de cette
  commande est dans `agent-pi.js` (`:4211`, `:4270`).
- Retours **silencieux** de la porte, tous en `{ ran: false }` : E2 désactivé (`:4245`), pas de
  projet (`:4247`), baseline indisponible (`:4251-4253`), aucun runner (`:4254`), commande non
  dérivable (`:4266`), exception d'invocation (`:4274-4277` — commentaire : « Ne pas bloquer la
  tâche sur une erreur d'exécution »).
- Lint : `src/js/agent-pi.js:4130-4136` — en cas d'erreur du linter, `return { ok: true,
  hadChecker: false }`. Commentaire assumé : « on ne bloque pas la tâche ».
- Le garde-fou de sortie, quand la porte tourne, est **réel** : échec persistant après le budget
  ⇒ `handleTaskFailure` (`src/js/agent-pi.js:5056-5060`).
- Sur la publication, `npm test` et `cargo test --lib` sont bien bloquants
  (`.github/workflows/release.yml:107-109`, et `build` exige `test` en `:136-137`). Mais
  **aucun workflow ne s'exécute sur un push ou une pull request** : seuls `release.yml` (tag) et
  `gds-server-image.yml` existent. Une suite rouge peut donc vivre sur `main` jusqu'au tag.

**Pourquoi c'est grave.** L'exigence « tests verts » se transforme en « tests verts **si** on a
pensé à activer l'auto-test **et** si le runner est détectable **et** si la baseline a répondu ».
Silencieusement, une livraison cassée est annoncée terminée.

**Verrou minimal proposé.**

1. `runTestGate` : rendre l'échec **visible** dans les `{ ran: false }` qui résultent d'une
   panne (baseline indisponible, exception) — une ligne dans le rapport de mission, jamais un
   silence ; test pur sur le constructeur du libellé (`ran:false, cause` ⇒ phrase) ;
2. même traitement pour `runLintCheck` (`ok: true` silencieux ⇒ `ok: true, announced: true` +
   message) ; test pur qui rougit si le retour redevient muet ;
3. pour `run_agents` : un verdict de mission **pur** `missionVerdict({ readonly, expectedFiles,
   testGate })` qui dit explicitement « aucun test n'a été exécuté » quand c'est le cas ;
   test pur (aucune I/O) — c'est la garde la moins chère pour la voie la plus utilisée.

---

### C7 — Publication : les tests bloquent, mais la Release est créée avant leur verdict, et trois règles voisines ne sont pas gardées

**Ce qui est possible.**
1. **Release publiée avant le verdict des tests.** `create-release` n'a **aucun** `needs:` : il
   démarre en même temps que `test`. Un tag dont les tests échouent produit donc une Release
   GitHub **publiée** (`draft: false`), sans artefacts, pendant que `build` est bloqué.
2. **Version incohérente acceptée.** `latest.json` porte la version du **tag**
   (`VERSION = TAG.replace(/^v/, "")`, `scripts/gen-latest-json.js:44`), jamais celle des
   manifestes. Bumper `tauri.conf.json` en 0.7.0 et taguer `v0.6.99` passe : l'app installée
   reçoit une mise à jour « 0.6.99 » contenant du 0.7.0. Rien ne compare, nulle part, les quatre
   fichiers que la règle exige (`AGENTS.md` § Publication) — la seule mention est un
   **commentaire** (`.github/workflows/release.yml:4-6`).
3. **Changelog facultatif.** `notes = changelogBody.trim() || "Pilot " + VERSION`
   (`scripts/gen-latest-json.js:367`) : l'absence de `release-notes/vX.Y.Z.md` donne une note
   d'une ligne, sans échec.
4. **Livraison incomplète publiée quand même.** Une cible sans artefact signé produit un
   `console.warn` et une annotation, puis `latest.json` est publié en l'état
   (`scripts/gen-latest-json.js:347-358`) — les utilisateurs de cette plateforme ne reçoivent
   simplement jamais la mise à jour.
5. **Tag republié.** `scripts/create-release.js:40-43` : si la release existe déjà, le script
   **retourne silencieusement** (« rien à créer ») puis les builds réécrivent les assets du même
   tag. « Ne jamais republier un tag déjà existant » (AGENTS.md) n'a aucune garde.

**Preuve.** `awk '/^  [a-z-]+:/'` sur `.github/workflows/release.yml` : `test` (24),
`create-release` (117, **sans `needs`**), `build` (136, `needs: [create-release, test]`),
`build-linux` (307), `latest-json` (434), `latest-json-linux` (483). Et
`scripts/release-workflow.test.js` — qui verrouille déjà la topologie Linux, le cache npm et le
budget — **ne contient aucune assertion** sur `create-release` ni sur les versions.

**Pourquoi c'est grave.** C'est la seule exigence qui touche des utilisateurs installés. Une
Release publiée sans artefacts et une version incohérente ne se voient pas en local : elles se
voient chez tout le monde, une fois.

**Verrou minimal proposé.**

1. `.github/workflows/release.yml` : `create-release` reçoit `needs: test` (un mot), et
   `scripts/release-workflow.test.js` (déjà en place) gagne une assertion dessus — rouge
   aujourd'hui, verte après ;
2. `scripts/release-version.test.js` (nouveau, sans réseau) : `tauri.conf.json` =
   `package.json` = `Cargo.toml` = la ligne `version` du paquet `pilot` de `Cargo.lock` ; et, si
   `GITHUB_REF_NAME` est défini, égalité avec le tag ;
3. `scripts/gen-latest-json.js` : une plateforme manquante **ou** un changelog absent deviennent
   des sorties non nulles (`process.exit(2)`), avec une variable d'environnement explicite pour
   l'acceptation délibérée ; la logique de décision passe dans une fonction **pure** de
   `scripts/latest-json-platforms.js` (déjà testé) ;
4. `scripts/create-release.js` : transforme le retour silencieux (`:40-43`) en `exit 1` sauf
   `ALLOW_EXISTING_RELEASE=1`, décidé par un prédicat pur testable.

---

### C8 — L'emplacement du rapport n'est qu'une règle écrite, et elle est déjà violée à trois endroits

**Ce qui est possible.** Rien n'empêche d'écrire un rapport à la racine, ou dans un troisième
dossier. Aucun test ne vérifie l'emplacement d'un `.md` de rapport.

**Preuve.**

- Règle : `AGENTS.md` § « Rapports et conceptions » — « les rapports de mission
  (`RAPPORT-*.md`) vont dans `docs/rapports/` … Rien de tout cela à la racine ».
- Constat sur disque : de nombreux fichiers `rapport-*.md` sont **à la racine** du dépôt
  (par exemple `rapport-publication-0.4.36.md`, `rapport-file-attente-pertes-doublons.md`,
  `rapport-resume-tache-fourni.md`, `VERIF-380.md`), et `.pilot/rapports/` contient une
  **seconde** collection de rapports de mission (c'est d'ailleurs le chemin que citent le code
  et les tests : `src/js/deliverable-guard.js:3`, `src/js/garde-fou-livrable.test.js:3`,
  `src/js/super-agent.js:9112`).
- Aucune assertion d'emplacement : les recherches sur `docs/rapports` dans `src/**/*.test.js`
  et `scripts/*.test.js` ne renvoient que des **commentaires** citant un rapport.

**Pourquoi c'est moyen-grave.** Ce n'est pas un mensonge sur le travail, c'est une perte de
traçabilité : trois emplacements pour la même catégorie de document rendent l'audit suivant plus
cher, et un rapport « introuvable » revient à un rapport absent.

**Verrou minimal proposé.** Un test unique, sans dépendance, dans `src/js/` (le projet emploie
déjà ce style de verrou de source) : parcourir la racine du dépôt et échouer si un fichier
correspond à `/^(RAPPORT|CONCEPTION)-/i` ou `/^rapport-/i` hors de `docs/rapports/` et
`docs/conceptions/` — avec une liste d'exceptions **datée** pour les fichiers déjà présents, à
réduire au fil de l'eau. (Le test doit lister, pas compter : aucun chiffre figé.)

---

### C9 — « Documentation à jour » n'est verrouillée que sur un seul sujet

**Ce qui est possible.** Modifier un comportement et ne toucher aucune spec, ou toucher une spec
sans régénérer `help/handbook.md`, sans qu'aucun test ne rougisse — sauf sur le sujet de la
fraîcheur du handbook pour le délai d'inactivité.

**Preuve.**

- Mécanisme existant : `help/handbook.md` est **engendré** depuis les blocs `<!-- HELP:* -->`
  (`scripts/build-handbook.js`, câblé dans `beforeBuildCommand`/`beforeDevCommand`,
  `src-tauri/tauri.conf.json:33-34`) et embarqué par `include_str!`
  (`src-tauri/src/help.rs:44`). Le fichier est **versionné** : une régénération oubliée reste
  donc en place.
- Une seule garde de fraîcheur existe : `src/js/help-delai-inactivite.test.js:117-124`
  (« l'aide intégrée générée est à jour ») compare **une ligne** du handbook à **une ligne** de
  sa spec. Les autres tests qui lisent `help/handbook.md`
  (`src/js/libelle-options-ecran.test.js:56`, `src/js/reglage-voix-onglet-assistant.test.js:327`,
  `src/js/super-agent-schedule.test.js:127`, `src/js/vocal-delai-envoi-reglable.test.js:60`,
  `src/js/vocal-longueur-reglable.test.js:63`, `src/js/vocal-reponses-courtes.test.js:44`) y
  cherchent un **contenu**, pas une **synchronisation** avec les sources.

**Pourquoi c'est moyen.** Une doc qui ment coûte un aller-retour à chaque fois qu'on s'y fie —
et c'est exactement le coût que ce projet cherche à éviter.

**Verrou minimal proposé.** Généraliser la seule garde qui marche : un test qui **rejoue**
`scripts/build-handbook.js` en mémoire (le script est déjà un module Node) et compare le texte
produit à `help/handbook.md` ; toute divergence ⇒ échec avec la liste des blocs concernés. Coût :
un test, aucune modification du script. (La règle « la spec dit la vérité sur le comportement »
reste, elle, hors de portée d'un test — c'est dit en § 4.)

---

### C10 — « Ne jamais assouplir ni supprimer un test » n'a aucune garde

**Ce qui est possible.** Retirer une assertion, transformer une égalité en `toContain`, ajouter
`.skip`, supprimer un fichier de test : rien ne rougit, puisque le test qui aurait dû rougir est
justement celui qu'on modifie.

**Preuve.**

- Aucune occurrence de `.skip`/`.only` aujourd'hui dans `src/**/*.test.js` ni `scripts/*.test.js`
  — mais **aucune** assertion ne l'interdit, et aucun manifeste de fichiers de test n'existe.
- La règle n'existe qu'en prose : `AGENTS.md` (protocole quality-gate, § « anti-régression »),
  `.pi/skills/quality-gate/SKILL.md` — dont les cinq phases sont **entièrement procédurales**
  (lire, cartographier, relire, annoncer) : aucune contrainte exécutable, aucun test.
- Le contraste est instructif : les rapports du dépôt insistent, un par un, sur « aucun test
  assoupli » (`docs/rapports/RAPPORT-bouton-tout-masquer.md:143`,
  `docs/rapports/correctif-faux-refus-lecture-seule.md:122`,
  `docs/rapports/RAPPORT-au-repos-ce-n-est-pas-du-travail.md:192`…). C'est donc une règle
  **respectée** et **non garantie**.

**Pourquoi c'est le moins grave des dix — et le plus structurant.** Un agent honnête la respecte.
Mais c'est la règle qui protège toutes les autres : la retirer revient à supprimer les verrous
des neuf autres points.

**Verrou minimal proposé.** Deux tests courts, sans chiffre figé :

1. balayer `src/**/*.test.js` et `scripts/*.test.js` et échouer sur `it.skip`, `describe.skip`,
   `test.skip`, `it.only`, `describe.only` (liste explicite des exceptions justifiées, vide
   aujourd'hui) ;
2. pour les verrous nommés comme tels (ils se reconnaissent à leur en-tête « Verrou »), exiger
   qu'ils contiennent au moins une assertion `toBe`/`toEqual` stricte — c'est ce qui distingue
   un verrou d'un commentaire.

Limite honnête : un test peut être **affaibli** sans `.skip` (`toBe` → `toBeTruthy`) ; aucun test
ne peut l'interdire de façon générique. Le point 1 ferme la suppression, pas l'affaiblissement —
c'est dit en § 4.

---

## 3. Ce qui n'a pas pu être vérifié

Dit sans détour, pour que ce rapport ne soit pas lu comme plus complet qu'il ne l'est.

1. **Aucune exécution.** Ni `cargo test` (interdit), ni `npx vitest run`, ni `npm test`. Tous
   les constats sont statiques (lecture, `grep`, `sed`). Je n'ai donc **pas** vérifié qu'un test
   rougit effectivement là où je dis qu'il rougirait : j'ai vérifié **ce que le test contient**.
2. **La porte checklist n'a pas été vue tourner.** Les commandes Tauri exigent un `AppHandle` ;
   les tests d'intégration existants contournent cela par un helper de rejeu
   (`src-tauri/src/super_agent.rs:9484`). Je n'ai pas pu établir si un appel réel aux commandes
   donnerait le même verdict que le rejeu — c'est précisément la fragilité signalée en C5.
3. **L'état réel de la base de suivi n'a pas été lu.** `~/.pilot/super-agent.db` n'a pas été
   ouverte : je ne peux pas dire si l'assistant a **déjà** utilisé `db_execute` pour clore une
   tâche sans checklist. Le trou est prouvé dans le code, pas dans l'usage.
4. **Le câblage d'exécution de `db_execute` n'a pas été observé.** J'ai lu l'outil
   (`src-tauri/extensions/pilot-assistant-db.ts:63-77`) et la commande
   (`src-tauri/src/super_agent.rs:1100`), pas la chaîne sentinelle complète
   (`DB_EXEC_SENTINEL` côté `super-agent.js`) en fonctionnement.
5. **Rien de ce qui touche GitHub n'a été vérifié en réel** : ni qu'un tag a déjà été republié,
   ni qu'une Release a déjà été créée sans artefacts. L'accès réseau n'a pas été utilisé. Les
   constats C7 viennent de la lecture du workflow et des scripts.
6. **La porte E2 n'a pas été exercée** sur un projet réellement en échec (il faudrait un projet
   avec runner) : le comportement bloquant est lu (`src/js/agent-pi.js:5056-5060`), pas observé.
7. **Un piège de lecture à signaler au prochain auditeur** : `.pilot/_goldtmp/src/js/` contient
   une **copie ancienne** des sources (par exemple `orchestration.js` avec un « assouplissement »
   qui n'existe plus dans `src/js/`). Toute recherche globale sans exclusion de `.pilot/` rapporte
   du code qui n'est plus celui de l'application. `src/js/source-slice.test.js:185` exclut déjà
   `.pilot`, ce qui montre que le piège est connu.
8. **Non vérifié par choix de périmètre** : la règle « la spec dit la vérité sur le comportement »
   (C9 au-delà de la fraîcheur du handbook) n'est pas testable mécaniquement — je ne propose donc
   aucun verrou pour elle, plutôt qu'un verrou décoratif.

---

## 4. Périmètre de cette intervention

- **Écrit** : `docs/rapports/RAPPORT-voies-de-contournement-livraison.md` (ce fichier), et rien
  d'autre.
- **Lu** (sans modification) : `src/js/agents-bus.js`, `src/js/deliverable-guard.js`,
  `src/js/super-agent.js`, `src/js/agent-pi.js`, `src/js/garde-fou-livrable.test.js`,
  `src/js/super-agent-checklist.test.js`, `src/js/help-delai-inactivite.test.js`,
  `src-tauri/src/super_agent.rs`, `src-tauri/src/help.rs`, `src-tauri/src/code_check.rs`,
  `src-tauri/extensions/pilot-assistant-db.ts`, `src-tauri/extensions/pilot-assistant-tools.ts`,
  `src-tauri/extensions/pilot-assistant-actions.ts`, `scripts/create-release.js`,
  `scripts/gen-latest-json.js`, `scripts/build-handbook.js`, `scripts/release-workflow.test.js`,
  `.github/workflows/release.yml`, `.pi/skills/quality-gate/SKILL.md`, `AGENTS.md`.
- **Aucun** outil de suivi de sessions appelé (interdit). **Aucune** refonte proposée : les dix
  verrous de la § 2 sont tous des ajouts locaux (une fonction pure, un test, un `needs:`).
- **Aucun chiffre figé** : ni nombre de tests, ni nombre de fichiers, ni pourcentage — les
  dénombrements exacts ne sont pas des invariants du dépôt et ne doivent pas être verrouillés.

DONE: inventaire des 8 exigences produit (tableau § 1) + dix contournements constatés et ordonnés
par gravité (§ 2), chacun avec preuve `fichier:ligne` et verrou minimal proposé ; les huit
« non vérifiés » sont listés en § 3. Le trou le plus grave est `super_agent_db_execute`
(`src-tauri/src/super_agent.rs:1100-1109`, exposé à l'assistant par
`src-tauri/extensions/pilot-assistant-db.ts:63-77`) : il écrit la table `tasks` en SQL brut sans
passer par `guard_task_checklist`, ce qui rend C5 et le contrôle des statuts décoratifs. Les
quatre exigences sans aucune garde automatique sont : l'emplacement du rapport (3), la
documentation à jour (4), l'interdiction d'assouplir un test (5) et la moitié de la publication (7 —
version reportée partout, changelog, refus de republier un tag). Aucun fichier autre que ce
rapport n'a été écrit ; aucun test n'a été exécuté.
