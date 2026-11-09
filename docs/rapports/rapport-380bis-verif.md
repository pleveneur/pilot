# RAPPORT 380bis — écarts de la vérification indépendante du verrou par projet

Reprise de la mission 380 après la revue indépendante (`VERIF-380.md`). Le
correctif principal du commit `eb1aeae` est conforme ; trois **écarts de
couverture / de branchement** restaient ouverts. Aucun fichier de la mission 381
(commit `813095c`) n'a été touché, aucune version ni tag modifié, aucun `push`.

---

## 1. Écart 1 — la levée ciblée n'était branchée que sur 3 des 5 points d'entrée

**Constat** (`VERIF-380.md` § 1.4). Le 4ᵉ argument de
`canSendManualCommandAsync(project, isRunInProgress, isAgentBusy, releaseStaleLock)`
— la levée ciblée d'un verrou **orphelin** tentée avant le refus — n'était
injecté que dans `agent-pi.js`. Deux points d'entrée de **commande manuelle**
appelaient la porte **sans** ce rappel :

- `src/js/prompt-builder.js` — bouton « Envoyer à l'agent » du Prompt Builder ;
- `src/js/sidebar.js` — menu contextuel de fichier → « Envoyer à l'agent ».

Conséquence visible : ces deux chemins continuaient d'afficher « ⏳ Une tâche
d'agents est déjà en cours sur ce projet… » face à un agent **mort**, pendant
2 à 3 minutes (le temps que le balayage périodique passe), alors que la saisie
du chat était déjà débloquée.

**Correctif.** Une **définition unique** de la levée orpheline est désormais
exportée par le bus — `releaseOrphanRunLock(project)` (`src/js/agents-bus.js`),
qui encapsule `releaseStuckRunLock(project, { requireIdleMs:
RUN_LAUNCH_MIN_STUCK_IDLE_MS })` — et les **cinq** points d'entrée passent ce
même rappel :

| # | Point d'entrée | Fichier |
|---|---|---|
| 1 | saisie du chat agent | `agent-pi.js` (envoi) |
| 2 | choix / reprise du chat | `agent-pi.js` (validation d'un choix) |
| 3 | sélection de prompt du chat | `agent-pi.js` (prompt sélectionné) |
| 4 | menu contextuel « Envoyer à l'agent » | `sidebar.js` |
| 5 | bouton « Envoyer à l'agent » du Prompt Builder | `prompt-builder.js` |

Une définition unique interdit la divergence : recopier la règle dans chaque
fichier (comme dans le premier essai) laissait la porte ouverte à un oubli sur
le point d'entrée suivant. Le module `run-policy.js` reste **pur** (le rappel est
injecté, absent → comportement historique de refus).

**Comment vérifier.** `src/js/verrou-orphelin.test.js`, PREUVE 4 (la levée
`releaseOrphanRunLock` réellement exportée par le bus est celle utilisée : le
verrou orphelin tombe, l'envoi est autorisé) et PREUVE 7 (contrôle de source :
**5** sites d'appel de `canSendManualCommandAsync`, **tous** avec
`releaseOrphanRunLock`). PREUVE 7 échoue si un site repasse 3 arguments.

---

## 2. Écart 2 — l'armement automatique du balayage n'était protégé par aucun test

**Constat** (`VERIF-380.md` § 2.1). Les preuves 1 à 5 appellent
`sweepOrphanRunLocks()` **à la main**. La mutation M1 (suppression de
`startRunLockSweep()` dans `initAgentsBus`) laissait les 8 tests **verts** : la
régression d'origine (aucun déclencheur autonome) était invisible pour la suite.

**Correctif.** PREUVE 6 dans `src/js/verrou-orphelin.test.js` :

- `initAgentsBus` arme **exactement un** minuteur à `RUN_LOCK_SWEEP_MS`
  (`setInterval` espionné) — c'est l'attendu central « libération
  **automatique** » ;
- le rappel armé **est bien le balayage** : en l'invoquant deux fois sur un
  verrou orphelin, le verrou est levé (aucun minuteur factice ne peut donc
  satisfaire le test) ;
- `destroyAgentsBus` **efface** ce minuteur (`clearInterval` appelé avec le
  handle) et laisse le bus ré-armable par la `initAgentsBus` suivante.

**Comment vérifier.** Supprimer `startRunLockSweep()` de `initAgentsBus` →
PREUVE 6 échoue (`initAgentsBus doit armer le balayage périodique`) ; supprimer
`stopRunLockSweep()` de `destroyAgentsBus` → PREUVE 6 échoue
(`destroyAgentsBus doit désarmer le balayage`).

---

## 3. Écart 3 — le rapport 380 annonçait un test Rust inexistant

**Constat** (`VERIF-380.md` § 2.2). `RAPPORT-380-verrou.md` § 6 annonce
« `project_has_alive_session` sur un service sans session », alors qu'aucun test
n'existait (`grep` ne trouvait que la définition et l'appel).

**Décision : le test est AJOUTÉ** (la ligne du rapport devient vraie), plutôt que
supprimée — c'est aussi la réserve de couverture de `VERIF-380.md` § 1.5.
`src-tauri/src/agent_service.rs` (module `tests`) :

- `project_has_alive_session_false_sans_session` : service neuf, aucune session
  → `false` (le cas annoncé par le rapport) ;
- `project_has_alive_session_false_pour_session_morte` : session enregistrée dont
  le processus est **terminé** → `false` — c'est le **cœur** de la mission 380
  (une activité « busy » sans session vivante est un orphelin qui ne doit plus
  bloquer le projet) ;
- `project_has_alive_session_vraie_pour_session_vivante` : session dont le
  processus **tourne** → `true` — garantit qu'un agent réellement vivant
  conserve l'occupation du projet (aucune régression pour du travail réel).

Les deux derniers cas créent un **vrai** processus enfant (`cmd /C …` sous
Windows, `sh -c …` ailleurs), tué et récolté en fin de test : aucune dépendance
externe, aucune attente longue.

---

## 4. Ce qui n'est PAS traité ici (hors périmètre des trois écarts)

`VERIF-380.md` § 4 recommande en plus d'aligner la branche `stopping` du balayage
sur `releaseStuckRunLockForKey` (drain de la file + pas de libération si une
session du projet est encore vivante). Ce point n'est **pas** dans les trois
écarts demandés : il reste documenté comme risque ouvert (§ 4 de `VERIF-380.md`),
non implémenté ici pour ne pas élargir le périmètre.

---

## 5. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npm test` (Vitest) | **0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **0 échec** |
| `npm run build:handbook` | aide intégrée régénérée |

Vérification manuelle conseillée dans Pilot :

1. laisser un agent mourir sans fin signalée sur un projet ;
2. **sans attendre** les 2–3 minutes du balayage, utiliser le **menu contextuel
   de la barre latérale** → « Envoyer à l'agent » : la commande part (au lieu de
   « ⏳ Une tâche d'agents est déjà en cours… ») ;
3. même essai avec le bouton « Envoyer à l'agent » du **Prompt Builder** ;
4. si le blocage persiste, `/verrou` puis `/verrou libere` dans le chat.

---

## 6. Re-vérification (nouvelle exécution de la mission 380bis)

Le correctif des trois écarts était **déjà commité** (`76e03f1`, après la mission
381 `813095c`). Cette exécution n'a donc **rien eu à corriger** : elle a vérifié,
un par un, que les trois écarts sont bien fermés dans l'arbre, puis a **prouvé
que les nouveaux tests ne sont pas complaisants** en les faisant échouer par
mutation (copie jetable hors dépôt pour l'interface, `git checkout` immédiat
pour le cœur ; arbre laissé propre, seul `geminiReport.md` non suivi préexiste
et n'a pas été touché).

### 6.1 État vérifié des trois écarts

| Écart | Vérification | Résultat |
|---|---|---|
| 1 — levée ciblée sur les 5 points d'entrée | `grep` : `agent-pi.js` ×3, `sidebar.js:330`, `prompt-builder.js:323` passent tous `isProjectAgentBusy, releaseOrphanRunLock` ; import unique depuis `agents-bus.js` (`releaseOrphanRunLock` y est la seule définition, `agents-bus.js:618`) | **fermé** |
| 2 — armement automatique du balayage protégé | PREUVE 6 (`verrou-orphelin.test.js:352`) : `setInterval` espionné, **1** minuteur à `RUN_LOCK_SWEEP_MS`, son rappel lève réellement un verrou orphelin, `destroyAgentsBus` l'efface | **fermé** |
| 3 — test Rust annoncé dans le rapport 380 | les **trois** tests existent (`agent_service.rs` : sans session, session morte, session vivante) et passent ; `RAPPORT-380-verrou.md` § 6 les cite désormais correctement | **fermé** (test **ajouté**, ligne du rapport rendue vraie) |

### 6.2 Preuve que les tests attrapent réellement la régression (mutations)

| Mutation appliquée | Effet observé |
|---|---|
| **M1** — `startRunLockSweep();` retiré de `initAgentsBus` (défaut d'origine : aucun déclencheur autonome) | PREUVE 6 **échoue** (« initAgentsBus doit armer le balayage périodique: expected +0 to be 1 ») |
| **M3** — `stopRunLockSweep();` retiré de `destroyAgentsBus` | PREUVE 6 **échoue** (minuteur orphelin non désarmé) |
| **M2** — 4ᵉ argument retiré sur **un seul** site (`sidebar.js`, état d'avant `76e03f1`) | PREUVE 7 **échoue** (le compte des sites gardés passe sous le nombre d'appels) |
| **M4** — `project_has_alive_session` forcée à `true` | les **3** tests Rust **échouent** (dont le cas « session morte ») |

Sans ces mutations, le défaut d'origine (`VERIF-380.md` § 2.1) resterait
invisible : les tests appelaient le balayage à la main.

### 6.3 Comptes de tests de cette exécution

| Commande | Résultat |
|---|---|
| `npm test` (Vitest, interface) | **1 864 réussis, 0 échec** (dont `verrou-orphelin.test.js` : 13) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (cœur) | **641 réussis, 0 échec, 1 ignoré** |
| `npm run build:handbook` | aucun changement : `help/handbook.md` déjà à jour |
| `git status` après vérifications | propre (hors `geminiReport.md` préexistant, non enregistré) |
