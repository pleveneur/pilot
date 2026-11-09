# VÉRIFICATION 380 — verrou par projet (correctif `eb1aeae`)

**Verdict : NON CONFORME (correctif principal valide, un attendu partiellement livré).**

Revue indépendante, lecture seule. Aucun fichier de code, de test, de configuration
n'a été modifié ; aucun commit, aucun tag, aucune publication. `git status` ne montre
aucune modification de fichier suivi (le fichier non suivi `geminiReport.md` préexistait
à cette revue et n'a pas été touché).

Comptes de tests exécutés :

| Commande | Résultat |
|---|---|
| `npm test` (interface, Vitest) | **105 fichiers, 1 843 tests, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (cœur) | **637 réussis, 0 échec, 1 ignoré** |
| dont `src/js/verrou-orphelin.test.js` | 8 tests (nouveaux) |
| dont `src/js/verrou-par-projet.test.js` | 38 tests (non-régression existante) |
| dont `cargo test --lib project_busy_with_liveness` | 1 test (nouveau) |

---

## 1. Attendu par attendu

### 1.1 « Un verrou orphelin (agent mort, tâche sans porteur) est levé en 2–3 min, sans redémarrer Pilot » — **CONFIRMÉ**

- `sweepOrphanRunLocks()` est armé par `initAgentsBus` (`startRunLockSweep`, timer
  `RUN_LOCK_SWEEP_MS = 30 s`, désarmé par `destroyAgentsBus`) et réutilise
  `releaseStuckRunLockForKey` — aucune nouvelle règle de décision n'est introduite.
- Chaîne de délais vérifiée : grâce de démarrage 60 s (`RUN_LOCK_SWEEP_START_GRACE_MS`)
  → plancher d'inactivité 120 s (`RUN_LOCK_SWEEP_MIN_IDLE_MS = RUN_LAUNCH_MIN_STUCK_IDLE_MS`)
  → double mesure (+7 s) pour les portes ambiguës ⇒ libération au plus tard ≈ **2 min 37 s**,
  immédiate au-delà de 60 s pour le cas « aucun agent porteur » (porte `noActive`).
- Preuve empirique (hors dépôt, copie de `src/js` dans `%TEMP%` + jonction `node_modules`,
  script jetable non conservé) : `initAgentsBus` arme **1 timer à 30 000 ms** ; deux tirs
  de ce timer sur un verrou orphelin (agent déclaré, aucune session vivante, inactif
  3 min) font passer `isRunInProgress(projet)` de `true` à `false`.

### 1.2 « Une run qui travaille réellement n'est JAMAIS coupée » — **CONFIRMÉ**

- Le balayage ne décide rien lui-même : il passe par les mêmes portes que le chien de
  garde (`anyActiveAgentWorking` + `projectHasWorkingSession`, fail-closed sur erreur de
  sonde, `projectOfRunKey` gère les clés de lecture `projet#read:N`).
- `PREUVE 3` du nouveau fichier de tests le prouve, et cette preuve **échoue** si l'on
  remplace la décision par une libération inconditionnelle (mutation M3 ci-dessous).

### 1.3 « Deux commandes manuelles dans le chat agent : voir et lever le verrou » — **CONFIRMÉ**

- `src/js/agent-pi.js` : `/verrou` (photo du verrou : clés, état, agents actifs,
  inactivité, file, tâches attendues) et `/verrou libere` (`forceReleaseProjectRunLock`,
  rapport des runs levées, nombre de demandes en file abandonnées, purge des réservations).
- Traité **avant** tout envoi au moteur et **avant** la remise à zéro de la saisie ; les
  deux commandes commencent par `/` donc `isSlashCommand = true` et ne passent pas par la
  porte d'admission : elles restent utilisables **même quand le verrou est réellement tenu**
  (comportement souhaitable pour un diagnostic).

### 1.4 « La commande manuelle n'est refusée que si le blocage est réel » — **PARTIELLEMENT CONFIRMÉ**

- `canSendManualCommandAsync(..., releaseStaleLock)` tente bien une levée ciblée avant de
  refuser, puis **re-décide** ; le refus reste affiché si l'agent est réellement au travail
  (`PREUVE 4`, 2e cas). La mutation M2 (retour au refus immédiat) fait échouer ce test.
- **Écart constaté** : la levée ciblée n'a été injectée que dans **3 des 5** points
  d'entrée de commande manuelle. Deux chemins appellent encore
  `canSendManualCommandAsync` **sans** le 4e argument et refusent donc toujours avec
  « ⏳ Une tâche d'agents est déjà en cours… » en présence d'un verrou orphelin :
  - `src/js/prompt-builder.js:320` (« Envoyer à l'agent » du Prompt Builder) ;
  - `src/js/sidebar.js:328` (menu contextuel → « Envoyer à l'agent »).
  Ces deux chemins ne se débloquent qu'après le balayage (≤ 2–3 min), et `/verrou libere`
  n'y est pas accessible. Correction attendue : 2 lignes (passer le même callback
  `releaseOrphanRunLock`).

### 1.5 « Côté cœur, une activité occupée sans session vivante ne bloque plus le projet » — **CONFIRMÉ (avec réserve de couverture)**

- `get_project_agent_states` croise désormais l'activité avec
  `AgentService::project_has_alive_session` via la règle pure `project_busy_with_liveness` ;
  la map d'activité est relâchée avant d'interroger le registre de sessions (aucun verrou
  imbriqué), les clés sont normalisées (`normalize_project_path`), et
  `project_has_alive_session` applique exactement la même convention de vivacité que
  `session_alive_normalized` (déjà en production).
- `isProjectAgentBusy` (JS) consomme bien cette commande, donc la commande manuelle et la
  file de missions sont débloquées immédiatement après une mort silencieuse.
- **Réserve** : seul `project_busy_with_liveness` est testé (4 combinaisons booléennes).
  `project_has_alive_session` n'a **aucun** test et le câblage dans `get_project_agent_states`
  n'est couvert par aucun test d'intégration (voir 2.2).

### 1.6 « Des tests de non-régression couvrent les 5 cas » — **CONFIRMÉ**

| Cas attendu | Test | Présent |
|---|---|---|
| agent qui meurt | `verrou-orphelin.test.js` PREUVE 1 (+ passation non coupée, grâce de démarrage) | oui |
| agent qui échoue | chemin `failAgentTurn` : `verrou-par-projet.test.js` POINT I (agent sans modèle → échec déterministe, projet libre à la livraison) | oui (indirect) |
| agent arrêté par l'utilisateur | `verrou-orphelin.test.js` PREUVE 2 (`stopAgentsRun`) | oui |
| agent sain non coupé | `verrou-orphelin.test.js` PREUVE 3 | oui |
| levée à la demande | `verrou-orphelin.test.js` PREUVE 5 (lecture + écriture) | oui |

---

## 2. Ce qui n'est pas confirmé

### 2.1 L'armement automatique du balayage n'est couvert par aucun test (**angle mort**)

Les tests appellent `sweepOrphanRunLocks()` **à la main**. Mutation appliquée hors dépôt
(suppression de l'appel `startRunLockSweep()` dans `initAgentsBus`) : **les 8 tests restent
verts**. Autrement dit, la suppression accidentelle du déclencheur périodique — c'est-à-dire
exactement le défaut d'origine (« aucun balayage indépendant ») — ne serait détectée par
aucun test. L'attendu central (libération **automatique**) n'est donc pas protégé contre une
régression. Test attendu : espionner `setInterval` dans `initAgentsBus` et vérifier un timer
à `RUN_LOCK_SWEEP_MS` (et son effacement dans `destroyAgentsBus`).

### 2.2 Le rapport annonce un test Rust qui n'existe pas

`RAPPORT-380-verrou.md` § 6 annonce « `project_has_alive_session` sur un service sans
session ». `grep -rn project_has_alive_session src-tauri/src/` ne trouve **que** la
définition (`agent_service.rs:660`) et l'appel (`rpc.rs:336`) : aucun test. La ligne du
rapport doit être corrigée (ou le test ajouté).

### 2.3 Documentation — **mise à jour, pas de manque à signaler**

Contrairement à l'hypothèse de la consigne, la documentation **a** été mise à jour :
`spec_multiprojects.md` § 7 bis (correctif, garanties, non-régressions) **et** le bloc
`<!-- HELP:multiprojets -->` (aide intégrée orientée utilisateur, avec `/verrou` et
`/verrou libere`). `help/handbook.md` n'a pas été édité à la main : il est **exactement**
conforme à ce que produit `scripts/build-handbook.js` à partir des 24 sources (comparaison
octet à octet effectuée hors dépôt, 41 blocs, en-tête de date neutralisé). `npm run
build:handbook` n'est donc pas nécessaire.
Seule nuance (non bloquante) : `/verrou` n'est pas dans `list_agent_commands` (liste des
commandes `pi`), donc il n'apparaît pas dans l'autocomplétion `/` de la saisie ; il n'est
découvrable que par l'aide.

---

## 3. Non-régression vérifiée au-delà des tests

| Point | Vérification | Résultat |
|---|---|---|
| Message « ⏳ Une tâche d'agents est déjà en cours… » toujours affiché quand un agent travaille | `MANUAL_COMMAND_BLOCKED_MESSAGE` inchangé, `PREUVE 4` 2e cas (`canSendManualCommandAsync` → `false` avec session travaillante) | conforme |
| File d'exécution vidée avant toute libération | `releaseStuckRunLockForKey` draine `drainExclusivityQueues` puis conserve le verrou si `pendingExclusivityCount > 0`. Vérifié empiriquement hors dépôt : verrou orphelin **avec** une demande en file → après 2 passes de balayage, verrou **toujours pris** et demande **toujours en file** | conforme (chemin normal) |
| Générations / rejeu / réservations | `endRun(key, generation)` utilisé partout dans le nouveau code ; purge `deleteReservations` sur la levée à la demande | conforme |
| Aucun autre appel cassé | les 3 points d'entrée `agent-pi.js` (saisie, choix/reprise, sélection de prompt) passent le callback ; les 2 autres sont l'écart § 1.4 | écart |
| Interface : aucun test existant cassé | 1 843/1 843 | conforme |

---

## 4. Risques restants (non bloquants pour le défaut d'origine, à traiter)

1. **Branche `stopping` du balayage** : au-delà de la grâce de 60 s, elle libère le verrou
   **sans** drainer ni contrôler la file d'exclusivité (`pendingExclusivityCount`) — les
   demandes en file de cette run peuvent être abandonnées **silencieusement** (le chemin
   nominal, lui, les conserve ; la levée manuelle, elle, les compte et le dit). Aligner cette
   branche sur `releaseStuckRunLockForKey` (drain + refus si file non vide).
2. **Processus encore vivants au moment de la libération** : ni le balayage (`stopping`) ni
   `/verrou libere` n'arrêtent les sessions d'agents ; le verrou tombe alors qu'un
   processus peut encore écrire. Pour la commande manuelle c'est un choix explicite de
   l'utilisateur (et le message est honnête) ; pour le balayage, c'est implicite.
   Recommandation : sur la branche `stopping`, ne pas libérer tant qu'une session vivante du
   projet existe.
3. **Amplification du chien de garde existant** : le balayage applique les portes existantes
   en continu (au lieu d'un lancement) ; tout faux positif préexistant de la porte `ghosts`
   frapperait désormais **pendant** la run. Atténué par la sonde projet-large
   (`projectHasWorkingSession`), le plancher de 2 min et la double mesure, mais aucune preuve
   dédiée n'existe pour une run de **lecture** dont l'agent déclaré n'a pas de session
   correspondante.
4. **Une exception pendant une passe** interrompt le balayage des clés restantes (le
   `finally` libère le drapeau `runLockSweepInFlight`, mais la boucle n'est pas protégée par
   clé) : la passe suivante reprend, le risque est borné à un cycle de 30 s.
5. **Verrou orphelin de moins de 2 minutes** : la commande manuelle reste refusée (plancher
   d'inactivité du chien de garde), alors que le côté cœur (C5) la déclare déjà libre. Écart
   de perception de ≤ 2 min ; `/verrou libere` n'est pas concerné.

---

## 5. Méthode des mutations (preuve « le test échoue sans le correctif »)

Copies jetables **hors dépôt** (`%TEMP%\verif380`, jonction vers `node_modules`), arbre du
projet jamais modifié, dossier supprimé après usage :

| Mutation | Effet attendu | Résultat observé |
|---|---|---|
| M1 — retirer `startRunLockSweep()` de `initAgentsBus` | les tests du balayage automatique doivent échouer | **8/8 verts** ⇒ angle mort confirmé (§ 2.1) |
| M2 — `canSendManualCommandAsync` refuse sans tenter la levée (état d'avant `eb1aeae`) | PREUVE 4 doit échouer | 1 échec (`le verrou orphelin doit être levé par la tentative`) |
| M3 — le balayage libère sans consulter le chien de garde | PREUVE 3 (agent sain) doit échouer | 1 échec (`expected ['preuve-380-agent-sain'] to not include …`) |

Contrôles supplémentaires jetables (hors dépôt) : armement du timer (1 timer 30 s, deux tirs
libèrent un verrou orphelin) et préservation de la file d'exclusivité.

---

## 6. Changements demandés avant clôture

1. `src/js/prompt-builder.js:320` et `src/js/sidebar.js:328` : passer le même
   `releaseOrphanRunLock` que `agent-pi.js` (attendu 1.4 aujourd'hui partiel).
2. Ajouter un test qui prouve l'**armement** du balayage périodique (`initAgentsBus` →
   timer `RUN_LOCK_SWEEP_MS`, effacé par `destroyAgentsBus`) — sinon la régression d'origine
   (aucun déclencheur autonome) reste invisible pour la suite de tests.
3. Corriger `RAPPORT-380-verrou.md` § 6 (test `project_has_alive_session` inexistant) ou
   ajouter le test annoncé.
4. Recommandé (risque § 4.1/4.2) : aligner la branche `stopping` du balayage sur
   `releaseStuckRunLockForKey` (drain de la file + pas de libération si une session du
   projet est encore vivante).
