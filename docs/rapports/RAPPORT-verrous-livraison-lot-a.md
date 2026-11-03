# Rapport — Lot A : fermer les cinq voies de contournement de livraison

Date : 2026-11-19 · Projet : `G:\IA_PL\pilot`
Base : `docs/rapports/RAPPORT-voies-de-contournement-livraison.md` (audit en lecture seule).
Demande : fermer les **cinq** trous du Lot A, chacun par un verrou qui **rougit si on
le retire**, avec preuve par **mutation** (retrait → rouge → remise → vert), puis
vérifier **les deux suites** (front-end et Rust desktop).

Le Lot B (publication, `needs:`, changelog facultatif, tag republié, retours de
tests silencieux, lint en passe-droit) n'a **pas** été touché.

---

## 0. Ce qui a été fait, en une phrase par trou

| # | Trou (audit) | Fermé ? | Où |
|---|---|---|---|
| 1 | L'Assistant écrit **directement** dans les tables de suivi via `db_execute`, contournant la porte de checklist | **oui** | `super_agent.rs` (`db_execute_scope`) |
| 2 | La liste des fichiers attendus était **facultative**, et `delegate_to_coder` n'en offrait **aucun moyen** (un test **verrouillait** cette absence) | **oui** | `deliverable-guard.js` + `super-agent.js` (3 branches) + `pilot-assistant-actions.ts` |
| 3 | Un livrable **présent mais VIDE** comptait conforme (l'existence seule) | **oui** | `deliverable-guard.js` (`empty`, `unproven`) |
| 4 | Travail disque reconnu dès qu'**un** fichier était non validé : sur un dépôt déjà sale, un agent inactif « avait travaillé » | **oui** | `agents-bus.js` (`captureWorkBaseline`, `provesWorkOnDisk`) |
| 5 | Fin de tâche : checklist **vidée** ou jugée conforme à tort ; point supprimé après clôture | **oui** | `super_agent.rs` (`checklist_emptied`, `checklist_expected`, refus de suppression) |

Aucun test n'a été **supprimé** pour faire passer la livraison : là où un test
verrouillait le trou (#2), il a été **retourné** (même fichier, même intention,
assertions inversées + une assertion nouvelle qui prouve le refus).

---

## 1. Trou #1 — `db_execute` écrivait dans les tables de suivi

**Ce qui était ouvert** : `super_agent_db_execute` exécutait n'importe quel SQL
d'écriture, y compris `UPDATE tasks SET status='terminee'` ou
`DELETE FROM task_checks`, ce qui **contournait entièrement** la porte
`guard_task_checklist` (le prompt demandait de ne pas le faire : une consigne,
pas un verrou).

**Fermé par** : une **liste blanche inversée** — une seule règle, dans le socle,
au point d'exécution (`db_execute_in` → `db_execute_scope`) : tout est autorisé
**sauf** les tables de suivi (`tasks`, `task_checks`, `deliverables`) et
`sqlite_master`/`sqlite_schema`/`sqlite_temp_master`. Le refus **nomme** l'outil
de suivi à utiliser et **n'exécute rien** (aucune écriture partielle). La lecture
(`db_query`) reste SELECT seulement. Un seul mécanisme : pas de second filtre
côté écran.

**Le verrou (test qui rougit)** — `src-tauri/src/super_agent.rs`, `mod tests` :
- `db_execute_cannot_write_tracking_tables_and_leaves_nothing_behind`
- `db_execute_scope_sees_through_comments_and_batches`
- `db_execute_scope_recognizes_write_targets_purely`

**Mutation** : `if false && DB_EXECUTE_PROTECTED_TABLES.contains(...)` →
**2 rouges** (les deux premiers tests), remise → **3 verts**.

**Non fermé (et pourquoi)** : un SQL qui passerait par une **table temporaire**
ou une vue créée par l'Assistant (`CREATE VIEW … JOIN tasks`) n'est pas
intercepté — le filtre juge le **nom** écrit, pas le graphe de dépendances. Ce
n'est pas contournable *silencieusement* pour autant : la vue ne peut pas
écrire, et `CREATE VIEW` nommant `tasks` reste bloquable plus tard sans changer
de mécanisme. Non traité ici pour ne pas ajouter un second analyseur SQL.

---

## 2. Trou #2 — déclaration des livrables facultative, et absente d'un chemin

**Ce qui était ouvert** : `expected_files` était **optionnel** : une demande
« écris `docs/x.md` » sans liste ne déclenchait **aucune** vérification en fin de
mission. Pire, `delegate_to_coder` n'avait **pas** le paramètre : ce chemin ne
pouvait donc jamais rien vérifier. Et un test **verrouillait** cette absence
(comptage d'occurrences `expected_files` figé à 2, dont l'assertion interdisait
la présence sur la délégation).

**Fermé par** : une **seule** décision nouvelle, dans le module pur déjà
responsable du sujet (`deliverable-guard.js`) :
`undeclaredWriteRefusalMessage({tool, task, expectedFiles})`. Elle réutilise **le
même** détecteur (`detectExplicitWriteRequest`, même portée d'ordre,
négations neutralisées) : **aucun second mécanisme de détection**. Règle : une
demande qui **ordonne d'écrire** un fichier et **ne déclare aucun livrable** est
**refusée au lancement** ; le refus nomme le fichier réclamé (ou dit qu'aucun nom
précis n'est donné). Branchée aux **trois** points d'entrée, à l'endroit exact où
le refus lecture seule existait déjà :

- `run_agents` (`super-agent.js`, ~9150) — refuse **avant** tout démarrage,
  libère les agents jetables déjà créés, répond `launched: false` ;
- `run_assistant_agents` (~9653) — mêmes règles, même place ;
- `delegate_to_coder` (~10254) — refuse **avant** la transmission ; le paramètre
  `expected_files` existe désormais sur l'outil
  (`pilot-assistant-actions.ts`), voyage avec la demande en file
  (`ds.queue.push({…, expectedFiles: delegationExpectedFiles})`), et l'état de
  départ du livrable est relevé au moment de la **transmission réelle**
  (`transmitDelegationToAgent`), pas à l'arrivée de la demande.

**Le verrou (test qui rougit)** — `src/js/garde-fou-livrable.test.js` :
- describe `déclaration obligatoire : une demande d'écriture sans livrable est refusée`
  (le refus nomme le fichier ; pas de nom précis quand la demande n'en donne pas ;
  **jamais** de refus quand un livrable est déclaré ; aucun faux refus sur une
  lecture ou une négation) ;
- describe `verrou de source : gardes branchées aux deux familles et à la
  délégation`, **retourné** : il verrouillait l'**absence** de déclaration sur la
  délégation, il verrouille maintenant sa **présence** (`undeclaredWriteRefusalMessage`,
  `expected_files`, `delegationExpectedFiles`) **et** le fait que le refus
  **interrompt** le lancement (`if (undeclaredRefusal) { … return; }`, et
  l'absence de neutralisation `false && …`) ;
- le comptage `expected_files` passe de **2 à 3** (l'outil de délégation le porte).

**Mutation** : `if (undeclaredRefusal) {` → `if (true || undeclaredRefusal) {` aux
**trois** branches (refus neutralisé) → **3 rouges** (`run_agents refuse AVANT tout
démarrage…`, `run_assistant_agents applique les mêmes règles`,
`delegate_to_coder refuse la même demande…`), remise → **41 verts**.

**Non fermé (et pourquoi)** : la détection reste **conservatrice** par choix
(héritage de `detectExplicitWriteRequest`) : une demande d'écriture **vague**
(« améliore la doc ») sans fichier nommé n'est pas refusée — le refus exige une
cible ou le mot « fichier » dans la portée de l'ordre. Élargir rouvrirait les
faux positifs réels déjà corrigés deux fois, et surtout rendrait le verrou
insupportable. Ce qui **n'est plus possible**, en revanche, c'est le cas
explicite : « écris `docs/x.md` » **sans** livrable déclaré ne démarre plus.

---

## 3. Trou #3 — un livrable présent mais vide comptait conforme

**Ce qui était ouvert** : `verifyExpectedFiles` ne sondait que `file_exists` :
`touch docs/rapport.md` suffisait à « livrer », et un fichier **resté d'une
session antérieure** valait preuve de production.

**Fermé par** : la sonde de fin de mission enrichit **le même** verdict (pas de
second verdict) : chaque fichier déclaré est sondé par `file_exists` +
`get_file_size` + `file_mtime`, comparé à un **état de départ** relevé **avant**
le travail des agents (`captureDeliverableState`). Trois nouveaux motifs
d'échec, dans `deliverableFailed` et dans le texte du verdict :
- `empty` — présent mais **0 octet** ⇒ « ❌ LIVRABLE VIDE » ;
- `unproven` — présent mais **inchangé depuis le lancement**, ou **aucun relevé
  de départ** ⇒ « ❌ LIVRABLE NON PROUVÉ » ;
- `missing` — inchangé.

**Fail-open assumé et borné** : un relevé de départ **impossible** (`null`,
panne de sonde) n'impute rien à l'agent ; une sonde qui **lève** n'échoue jamais
la mission. En revanche un relevé **absent** (`undefined`, chemin qui n'a pas
relevé d'état) vaut `unproven` : on ne déclare pas conforme ce qu'on n'a pas pu
prouver.

**Le verrou (test qui rougit)** — `src/js/garde-fou-livrable.test.js` :
- describe `preuve du livrable : vide et « déjà là » ne comptent plus` :
  `fileChangedSince` (mtime), `captureDeliverableState` (vide / présent / sans
  fichier / sans base), `présent + VIDE → empty`, `présent + INCHANGÉ → unproven`,
  `présent + MODIFIÉ → conforme`, `sans relevé de départ → non prouvé`,
  `relevé cassé → fail-open` ;
- le test historique « présent → présent, absent → manquant (l'existence seule
  compte) » a été **retourné** (pas supprimé) : il s'appelle maintenant
  « présent (créé pendant la mission) » et fournit explicitement un `baseline`,
  sinon la création n'est pas prouvée ;
- deux tests de bout en bout dans `fin de mission : le fichier déclaré fait foi`
  (VIDE, INCHANGÉ).

**Mutation** : `deliverableFailed` → `return ["missing"].some(...)` (les deux
motifs nouveaux retirés) → **5 rouges** (`présent + VIDE`, `présent + INCHANGÉ`,
`sans relevé de départ`, `un fichier déclaré VIDE (0 octet) n'est PAS conforme`,
`un fichier déclaré INCHANGÉ depuis le lancement est refusé`), remise →
**41 verts**.

**Non fermé (et pourquoi)** : un fichier **réécrit avec le même contenu** (mtime
changé, octets identiques) est accepté comme produit — la sonde juge la **date**,
pas une empreinte de contenu. Fermer cela demanderait de lire et hasher chaque
fichier déclaré au départ et à la fin (coût sur de gros fichiers, et le projet
n'a pas d'empreinte de livrable aujourd'hui) : hors périmètre du Lot A, écrit
noir sur blanc ici plutôt que passé sous silence.

---

## 4. Trou #4 — « quelque chose est non validé sur le disque » suffisait comme preuve de travail

**Ce qui était ouvert** : `provesWorkOnDisk` concluait « l'agent a travaillé »
dès que `git_status` rendait **un** fichier modifié/ajouté/non suivi. Sur un
dépôt **déjà sale** avant la mission, un agent qui n'avait **rien fait** était
donc réputé avoir travaillé — et l'inverse (échec annoncé à tort) devenait
impossible à distinguer.

**Fermé par** : une **base de comparaison** relevée **avant** le travail des
agents (`captureWorkBaseline` : HEAD + liste des chemins déjà sales, via la
commande Git existante `git_status_project`, fail-open `null`), puis une preuve
qui exige un **changement depuis le démarrage** (`provesWorkOnDisk(status,
startedAt, readonly, baseline)`) :
- un **commit nouveau** (HEAD ≠ base **et** dans la fenêtre) ⇒ preuve (comportement
  antérieur conservé) ;
- un **fichier sale apparu** depuis (chemin absent de la base) ⇒ preuve ;
- un fichier **déjà sale** ne prouve **rien par lui-même** : sa **date** tranche
  (`dirtyFileChangedSince`, `mtime ≥ départ − DISK_CLOCK_SLACK_MS`, sonde
  `file_mtime` bornée à `WORK_BASELINE_MAX_DATES` = 50 chemins, chaque sonde en
  try/catch) ;
- **aucun relevé de départ** ⇒ comportement antérieur (fail-open) : une panne de
  Git ne fait jamais échouer une mission.

Le relevé est posé aux **deux seuls** lancements (`startRun`, `startParallelRun`),
donc **tous** les chemins en héritent ; l'état voyage avec le contexte de run,
il n'est pas recalculé à la fin (on compare le même instant).

**Le verrou (test qui rougit)** — `src/js/agents-bus.test.js` :
- describe `preuve de travail : un changement DEPUIS le démarrage, jamais l'état
  hérité (C4)` (8 tests) : dépôt déjà sale + rien n'a changé ⇒ **aucune preuve** ;
  fichier apparu ⇒ preuve ; commit nouveau ⇒ preuve ; HEAD inchangé + mtime
  inchangé ⇒ aucune preuve ; `baseline null` ⇒ fail-open ; `dirtyPathsOf`
  (union + dédoublonnage + tri) ; `dirtyFileChangedSince` ; `captureWorkBaseline` ;
- describe `preuve de travail : l'état de départ est RELEVÉ et TRANSMIS (C4)`
  (2 tests) : le relevé de départ est fait **sur les deux** chemins de lancement
  et la décision **reçoit** cet état (une décision correcte jamais alimentée ne
  prouve rien).

**Mutations (deux, pour couvrir les deux moitiés)** :
1. décision revenue au trou d'origine (`return dirty.length > 0`) → **1 rouge**
   (`dépôt déjà sale, RIEN n'a changé → aucune preuve (l'agent n'a pas
   travaillé)`), remise → **117 verts** ;
2. relevé de départ neutralisé (`ctx.workBaseline = undefined;` aux deux
   lancements) → **1 rouge** (`chaque lancement de run relève l'état du disque
   AVANT le travail des agents`), remise → **117 verts**.

**Non fermé (et pourquoi)** : hors dépôt Git, il n'existe **aucune** base de
comparaison (pas d'état antérieur lisible sans parcourir tout l'arbre). Le
comportement y reste celui d'avant (fail-open) : c'est dit, pas caché. Fermer ce
cas demanderait un index de fichiers par projet — un mécanisme **nouveau**, que
la règle « une seule source » interdit d'ajouter à la légère dans ce lot.

---

## 5. Trou #5 — checklist vidée ou jugée conforme à tort ; point supprimé après clôture

**Ce qui était ouvert**, deux gestes distincts :
1. une tâche créée avec un **modèle** de checklist pouvait voir tous ses points
   **supprimés** : zéro point incohérent ⇒ `guard_task_checklist` n'avait plus
   rien à vérifier ⇒ clôture **conforme** sans le moindre contrôle ;
2. sur une tâche **déjà terminée**, la suppression d'un point (ou la modification
   de la liste) réécrivait l'historique de ce qui avait été validé.

**Fermé par**, dans le socle et **sans second mécanisme** :
- colonne **`checklist_expected`** (migration additive `ensure_column`) posée à
  la création quand un modèle s'applique (`super_agent_create_task` copie les
  points du modèle) ; le marqueur suit la tâche ;
- `checklist_emptied` (fonction **pure**) + `checklist_empty_message` :
  « attendue mais **VIDE** » n'est **jamais** conforme. La règle passe **avant**
  les autres dans `guard_task_checklist` et **refuse** la clôture, quel que soit
  le mode — sauf `off`, où l'utilisateur a explicitement demandé **aucun**
  contrôle (comportement conservé, et testé) ;
- `db_delete_task_check` **refuse** la suppression sur une tâche dont le statut
  est déjà clos (`classify_task_status == "done"`), avec un message actionnable
  (« sa checklist ne se modifie plus. Rouvrez la tâche… ») ; la commande
  `super_agent_task_check_delete` (chemin écran) hérite du même garde, puisqu'elle
  passe par cette fonction.

**Le verrou (test qui rougit)** — `src-tauri/src/super_agent.rs`, `mod tests` :
- `emptied_checklist_is_refused_at_closure_but_off_mode_stays_explicit`
- `emptied_checklist_rule_is_pure_and_explicit`
- `checklist_of_a_closed_task_cannot_be_modified`
- `checklist_template_points_reads_one_point_per_line`

**Mutations** :
1. règle « vidée » neutralisée (`if false && checklist_emptied(...) && mode != "off"`)
   → **1 rouge** (`emptied_checklist_is_refused_at_closure_but_off_mode_stays_explicit`),
   remise → **12 verts** (filtre `checklist`) ;
2. refus de suppression neutralisé (`if false && classify_task_status(&status) == "done"`)
   → **1 rouge** (`checklist_of_a_closed_task_cannot_be_modified`), remise →
   **12 verts**.

**Non fermé (et pourquoi)** : le **marqueur** `checklist_expected` n'est posé
qu'à la **création** par l'écran/les outils. Une tâche créée **avant** ce lot, ou
créée sans modèle puis remplie **puis** vidée, n'est pas marquée : elle peut
encore être clôturée sans point. C'est le prix de l'additivité (aucune reprise de
données, aucun marquage rétroactif décidé à la place de l'utilisateur) ; le
marquage rétroactif serait une migration de données, hors Lot A.

---

## 6. Résultat des deux suites (état final, code remis)

```
npm test                                   → Test Files 286 passed (286)
                                             Tests      5288 passed (5288)   FAIL 0
cargo test --manifest-path src-tauri/Cargo.toml --lib
                                           → 837 passed, 1 ignored (1 suite)
```

Les sept mutations ci-dessus ont toutes été **remises** avant ces deux
exécutions (fichiers restaurés depuis `.pilot/*.bak`, puis vérifiés par
`grep`/lecture : `if (undeclaredRefusal) {`, `["missing", "empty", "unproven"]`,
`ctx.workBaseline = await captureWorkBaseline(` ×2, règles de checklist actives).

Documentation mise à jour (règle du projet) :
- `spec_super_agent.md` — garde-fou du livrable réécrit en 4 points (déclaration
  obligatoire, preuve présente/non-vide/changée, preuve de travail du watchdog),
  section checklist complétée (marqueur, refus si vidée, clôture figée,
  `db_execute` hors portée), et les deux blocs d'aide utilisateur
  (`HELP:super-agent-livrable`, `HELP:super-agent-checklist`,
  `HELP:super-agent-…suivi`) ;
- `help/handbook.md` **régénéré** (`npm run build:handbook`, 47 blocs).

## 7. Ce que ce rapport ne prétend pas

- Aucun test n'a été **supprimé ni affaibli** ; deux tests ont été **retournés**
  (leur intention est conservée, leur assertion est inversée) — c'est écrit au
  § 2 et au § 3.
- Les preuves de mutation portent sur les verrous **cités** ; elles ne prétendent
  pas couvrir les trous du Lot B, ni les cas listés « non fermé » ci-dessus.
- Le nombre de tests est donné à l'instant de ce rapport, comme **résultat de
  vérification**, pas comme invariant de livraison.

DONE: Lot A fermé — les cinq voies de contournement de livraison sont verrouillées avec un test qui rougit à leur retrait, prouvé par 7 mutations (db_execute hors des tables de suivi ; déclaration de livrable obligatoire sur les trois chemins de lancement, dont `delegate_to_coder` qui n'en avait aucun et dont le test a été retourné ; livrable vide ou inchangé refusé ; preuve de travail exigeant un changement depuis le démarrage, avec base relevée avant les agents ; checklist vidée refusée et checklist d'une tâche close figée) ; suites vertes : front-end 5288 passés / 0 échec, Rust desktop 837 passés / 1 ignoré ; specs et aide utilisateur mises à jour, handbook régénéré ; cas non fermés et leurs raisons écrits dans le rapport.
