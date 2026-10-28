# RAPPORT 380 — Verrou par projet qui reste fermé après la fin, l'échec, l'arrêt ou la mort d'un agent

Version inspectée : 0.4.31 (dépôt local, branche `main`).
Aucun fichier de verrou n'existe sur le disque du projet (`.pilot/` vérifié) : le
verrou est **en mémoire**, ce qui explique qu'un **redémarrage de Pilot le libère**.

---

## 1. Constat

Le blocage « ⏳ Une tâche d'agents est déjà en cours sur ce projet… » vient de
`src/js/run-policy.js` (`MANUAL_COMMAND_BLOCKED_MESSAGE`), décidé par **trois
verrous en mémoire**, sans aucun fichier sur le disque :

| # | Verrou | Où | Qui le pose | Qui le lève |
|---|---|---|---|---|
| V1 | run « running/stopping » du projet | `busState.runs[clé].runState` (`agents-bus.js`) | `beginRun` | `endRun` / `clearAllRuns` |
| V2 | activité de l'agent du projet | `agent_activity[projet].busy` (Rust `rpc.rs`) | observateur RPC sur `agent_start` | `agent_end`/`agent_settled`/`process_exit`, `reset_project_activity` |
| V3 | file d'exclusivité + drapeau local d'assistant | `ctx.exclusivityQueue`, `runAgentsInFlightByProject` | mise en file | `launchNextQueued`, `settleRun` |

Symptômes observés par le propriétaire : verrou fermé après une **fin**, un
**échec**, un **arrêt** ou la **mort** d'un agent ; aucune commande pour voir ou
lever le verrou ; **redémarrage obligatoire**.

## 2. Chemins de sortie audités (ce qui libère, et sous quelle condition)

Tous les chemins de sortie **libèrent** bien le verrou — mais chacun **à
condition qu'un événement arrive et soit encore accepté** :

| Chemin de sortie | Libération | Condition qui peut manquer |
|---|---|---|
| Fin normale | `agent_end`/`agent_settled` → `finishAgentTurn` → `endRun` | événement reçu **et** `runState === "running"` **et** agent encore dans `activeAgents` |
| Erreur | `failAgentTurn` → `endRun` | idem |
| Arrêt manuel / « tout arrêter » | `stopAgentsRun` → `settleMission("stop")` → `endRun`/`clearAllRuns` | libération **synchrone** : fiable |
| Timeout d'inactivité | `resetTimeout` → `stopAgentsRun({runKey})` | fiable |
| Mort du process (`process_exit`/`process_error`) | `failAgentTurn` → `endRun` | idem ligne 1 |
| Agent muet (arrêt auto T2) | Rust `agent-auto-stopped` → `failAgentTurn` | **écouteur filtré** (voir D1) |
| Agent figé (busy-stale) | Rust `agent-stale-busy-released` → `failAgentTurn` | **écouteur filtré** (voir D1) |
| Agent mort sans aucun événement | rien — attend un déclencheur extérieur | **aucun déclencheur automatique** (voir D1) |

Éliminés comme cause (vérifiés, pas la source du défaut) :

- les fuites de `endRun` sur les chemins normaux (fin, erreur, arrêt, timeout) :
  tous appellent bien `endRun(project, generation)` ou `clearAllRuns` ;
- la protection par **génération** (`endRun` refuse une génération périmée) et le
  nettoyage `clearAllRuns` ;
- les **réservations T6** (`.pilot/reservations.json`) : purgées à l'arrêt
  (`clearAllReservations` / `deleteReservations`) ;
- la **file d'exclusivité** : elle est drainée avant toute libération
  (`drainExclusivityQueues`) puis la libération n'a lieu que si elle est vide.

## 3. Cause réelle

### D1 — La libération dépend d'un déclencheur EXTÉRIEUR qui n'existe pas

`releaseStuckRunLock` (le chien de garde du verrou) est **excellent** mais il
n'est appelé QUE depuis : un **lancement** (nouvelle mission, `startParallelRun`),
le **rejeu de file de l'assistant** (armé seulement **s'il y a une mission en
file**, toutes les 15 s) et le **watchdog de run de l'assistant** (15 min, armé
seulement pendant une run `run_agents` suivie). **Aucun balayage périodique
indépendant** n'existe.

Conséquence : si un agent meurt sans émettre `agent_end`/`process_exit`, ou si son
événement terminal arrive **après** que la run est passée en `stopping` ou après
que l'agent a quitté `activeAgents`, les écouteurs sont **filtrés** :

- `handleAgentEvent` : `if (!ctx || !ctx.activeAgents.has(agentId)) return;` et
  `if (ctx.runState !== "running") return;`
  (`src/js/agents-bus.js`) ;
- `agent-auto-stopped` / `agent-stale-busy-released` : même filtre
  (`ctx.activeAgents.has(agentId)` **et** `runState === "running"`).

Le verrou V1 reste donc `running` **sans porteur et sans observateur** : plus rien
ne le libère avant un redémarrage. C'est exactement le symptôme rapporté
(« après la fin / l'échec / l'arrêt / la mort d'un agent »).

### D2 — L'activité Rust n'est jamais confrontée à la vivacité

`get_project_agent_states` (`src-tauri/src/rpc.rs`) calcule
`project_activity_is_busy` sur la seule carte `agent_activity` : `busy` reste vrai
jusqu'à la borne **busy-stale (25 min)** même si **plus aucun processus de ce
projet n'existe**. Le moniteur d'anomalie purge bien les **états d'exécution
fantômes** du registre de sessions et de la carte d'anomalie
(`purge_ghost_running_states_app`), mais **pas** `agent_activity`. Or c'est cette
sonde qui refuse la **commande manuelle** (`isProjectAgentBusy` →
`canSendManualCommandAsync`) : un agent mort peut bloquer la saisie jusqu'à 25 min.

### Corollaire — Aucune commande de diagnostic

Rien ne permettait de **voir** ni de **lever** un verrou bloqué sans redémarrer
Pilot (aucune UI, aucun journal exposé au propriétaire).

## 4. Correctif

| Réf. | Fichier | Correctif |
|---|---|---|
| C1 | `src/js/agents-bus.js` | **Balayage périodique auto-réparant** : `sweepOrphanRunLocks()` toutes les 30 s (`RUN_LOCK_SWEEP_MS`), armé à l'init du bus, désarmé à sa destruction. Pour chaque run `running`/`stopping` plus vieille que la grâce de démarrage (60 s),
il réutilise les **portes prouvées** de `releaseStuckRunLockForKey` (sonde de
sessions réelle + plancher d'inactivité 2 min + double mesure pour les portes
ambiguës). Un verrou orphelin (agent mort, tâche sans porteur) est donc **levé
automatiquement en 2 à 3 minutes, sans redémarrer l'application** — et une run
réellement en train de travailler n'est **jamais** coupée. |
| C2 | `src/js/agents-bus.js` | `getProjectRunLockInfo(project)` (photo du verrou : clés de run, état, agents actifs, inactivité, demandes en file) et `forceReleaseProjectRunLock(project)` (levée **à la demande**, avec rapport honnête de la mission et purge des réservations du projet). |
| C3 | `src/js/agent-pi.js` | **Commandes manuelles** dans le chat agent : `/verrou` (voir l'état du verrou du projet) et `/verrou libere` (le lever). Elles ne sont **jamais** envoyées au moteur (`pi`). |
| C4 | `src/js/run-policy.js` | `canSendManualCommandAsync(project, isRunInProgress, isAgentBusy, releaseStaleLock)` : **avant de refuser** la commande manuelle, tentative de levée d'un verrou orphelin (`releaseStaleLock`, injecté — le module reste pur), puis **re-décision**. Le message « déjà en cours » n'apparaît plus que si le blocage est réel. |
| C5 | `src-tauri/src/rpc.rs` + `agent_service.rs` | `get_project_agent_states` croise `busy` avec la **vivacité** (`AgentService::project_has_alive_session`, règle pure `project_busy_with_liveness`) : une activité marquée occupée **sans aucune session vivante** est un orphelin → projet libre. Débloque immédiatement la commande manuelle après une mort silencieuse. |

Garanties conservées (aucune régression) :

- une run qui **travaille** n'est jamais libérée : la sonde de sessions du
  watchdog (`anyActiveAgentWorking`, `projectHasWorkingSession`) et le plancher
  d'inactivité restent la seule autorité ; en cas d'erreur de sonde, la
  libération est **refusée** (fail-closed) ;
- la file d'exclusivité reste **drainée avant toute libération** et n'est
  **jamais** abandonnée (`pendingExclusivityCount > 0` → verrou conservé) ;
- une mission interrompue reçoit toujours un **rapport honnête** (travail sur le
  disque ⇒ « pas un échec »), y compris quand le verrou est levé par le balayage
  ou à la demande.

## 5. Détournement d'agent (demande « codeur » exécutée par un planificateur)

**Cause identifiée — ce n'est pas un mauvais routage d'identifiant** : c'est le
chemin d'**estimation préalable T6** (`src/js/reservations.js`,
`estimateAndReserve`). Quand une mission nomme un **codeur**, l'assistant lance
d'abord l'agent **`plan-maker`** en lui donnant **le texte de la tâche** (pour
estimer les fichiers à toucher), puis écrit `.pilot/reservations.json` **au nom du
codeur**. Autrement dit :

1. la demande destinée au « codeur » est d'abord **lue et exécutée par un
   planificateur** (lecture seule → **0 fichier, 0 commit** : exactement l'effet
   « elle a tourné puis disparu sans écrire ») ;
2. le fichier de réservation mentionne bien « codeur » — cohérent avec le constat,
   donc **pas** un signe de détournement d'id ;
3. si le verrou de la run d'estimation survit (défaut **D1**), la mission du
   codeur reste **en file** et « ne produit rien ».

Ce qui a déjà été corrigé sur ce chemin : `startParallelRun` libère le verrou
**avant** de livrer le résultat (`endRun` puis `settleMission`, preuve
`verrou-par-projet.test.js` § « POINT I »), et le défaut **D1** traité ici lève
automatiquement la run d'estimation orpheline (≤ ~3 min : balayage 30 s, plancher
d'inactivité 2 min et double mesure).

**Pistes restantes (documentées, non implémentées — hors périmètre du verrou)** :

- rendre l'estimation **explicite** pour l'utilisateur (elle est annoncée par
  « 🧠 J'estime d'abord les fichiers… », mais rien n'indique que le
  planificateur reçoit **toute** la tâche) ;
- garantir la libération de la run de lecture d'estimation dans un `finally`
  (`estimateAndReserve` → `forceEndRun` sur toute clé de run du projet) ;
- permettre de **désactiver** l'estimation préalable dans les Paramètres.

> **Suivi (mission 381, commit `813095c`)** : le chemin d'estimation préalable a
> été **supprimé** (`estimateAndReserve` / `stopAbandonedEstimation` retirés de
> `reservations.js`, plus de session `plan-maker` de « devis »). Les lancements
> `run_agents` / `run_assistant_agents` démarrent **directement** l'agent
> demandé ; un agent inconnu est refusé explicitement. Les trois pistes ci-dessus
> sont donc closes par suppression du mécanisme, pas par ajustement.

## 5 bis. Reprise après vérification indépendante (mission 380bis)

La revue indépendante (`VERIF-380.md`) a relevé trois écarts. Ils sont corrigés
et **prouvés par des tests qui échouent sans le correctif** (mutations vérifiées
hors du correctif final) :

| Écart | Correctif | Preuve |
|---|---|---|
| **E1** — la levée ciblée d'un verrou orphelin n'était branchée que sur **3 des 5** points d'entrée de commande manuelle (le Prompt Builder et le menu contextuel de la barre latérale refusaient encore) | définition **unique** `releaseOrphanRunLock(project)` exportée par `agents-bus.js`, utilisée par **les cinq** points d'entrée (`agent-pi.js` ×3, `sidebar.js`, `prompt-builder.js`) — aucune copie locale possible | PREUVE 4 (comportement) + PREUVE 7 (contrôle de source : 5 sites, tous avec la levée, import unique). Retirer l'argument d'un seul site → PREUVE 7 échoue |
| **E2** — le **déclencheur autonome** (le balayage périodique) n'était couvert par aucun test : supprimer son armement laissait la suite verte | PREUVE 6 espionne `setInterval`/`clearInterval` : `initAgentsBus` arme **un** minuteur à `RUN_LOCK_SWEEP_MS`, **son rappel est bien le balayage** (deux tirs lèvent un verrou orphelin) et `destroyAgentsBus` le désarme | PREUVE 6. Désarmer l'armement → PREUVE 6 échoue |
| **E3** — le rapport annonçait un test Rust de `project_has_alive_session` qui n'existait pas | les tests sont **ajoutés** (`src-tauri/src/agent_service.rs`, module `tests`) sur de vrais processus enfants : aucune session → libre ; session **morte** (cœur de la mission) → libre ; session **vivante** → occupée, y compris sous une autre forme du même chemin | 3 tests Rust. Forcer la vivacité à `true` → 3 échecs ; à `false` → l'échec du cas vivant |

**Risque résiduel de la revue (§ 4.1 / 4.2) également traité** : la branche
`stopping` du balayage libérait le verrou **sans drainer la file d'exclusivité**
(demandes perdues en silence) ni regarder si une session du projet travaillait
encore (libération au-dessus d'un processus actif). Elle applique désormais les
deux garde-fous : demandes en file → la run est **réarmée et drainée** (verrou
conservé tant que la file vit) ; session du projet encore au travail → verrou
conservé (borné par la fenêtre « busy-stale » de 25 min, donc aucun blocage à
vie). Preuves : PREUVE 8 (3 cas).

## 5 ter. Complément après relecture (mission 380, second passage)

Cette reprise demandait de traiter les **4 manques** de `VERIF-380.md`. Constat
de ce second passage : **les quatre sont déjà fermés dans l'arbre** par la
mission 380bis (commits `76e03f1` et `5bc3e51`, section 5 bis ci-dessus). Ce
complément n'a donc **ajouté aucun correctif de code** : il re-vérifie chaque
point sur le code réel, refait les mutations (hors dépôt) et consigne les
comptes exacts. Le rapport reste la source de vérité — rien n'est annoncé ici
qui ne soit démontré.

| Manque relevé par la revue | Où c'est corrigé (code réel) | Preuve exécutée dans ce complément |
|---|---|---|
| **1. § 1.4** — la levée ciblée manquait sur `prompt-builder.js` et `sidebar.js` (3 points d'entrée sur 5) | `src/js/prompt-builder.js:323` et `src/js/sidebar.js:330` passent bien `isProjectAgentBusy, releaseOrphanRunLock` ; définition **unique** `releaseOrphanRunLock(project)` dans `agents-bus.js:618` (aucune copie locale) | **6 appels gardés sur 3 fichiers** (`agent-pi.js` ×4, `sidebar.js` ×1, `prompt-builder.js` ×1) → PREUVE 7 (contrôle de source « 1 appel = 1 levée » + import unique). Mutation : retirer l'argument dans `prompt-builder.js` → PREUVE 7 **échoue** (`prompt-builder.js : chaque envoi manuel doit tenter la levée… expected +0 to be 1`) |
| **2. § 2.1** — l'armement du balayage n'était couvert par aucun test (mutation M1 de la revue : 8/8 verts) | `initAgentsBus` appelle `startRunLockSweep()` (`agents-bus.js:1472`) : un minuteur `RUN_LOCK_SWEEP_MS` (**30 000 ms**), désarmé par `destroyAgentsBus` (`stopRunLockSweep`) | PREUVE 6 : `setInterval` espionné → **exactement 1** minuteur à 30 000 ms, **son rappel lève réellement** le verrou orphelin (deux tirs), `clearInterval` reçoit bien son handle à la destruction. Mutation : retirer `startRunLockSweep()` de `initAgentsBus` → **1 échec / 12 réussis** (le défaut d'origine redevient visible) |
| **3. § 2.2** — le rapport annonçait un test Rust `project_has_alive_session` inexistant | les tests sont **écrits** (`src-tauri/src/agent_service.rs:4074`, `:4083`, `:4106`), sur de vrais processus enfants : aucune session → libre, session **morte** → libre, session **vivante** → occupée, y compris sous une autre forme du même chemin (`\`, casse, slash final) | `cargo test --lib project_has_alive_session` → **3 réussis** ; `cargo test --lib project_busy_with_liveness` → **1 réussi**. La ligne du § 6 est donc exacte aujourd'hui |
| **4. § 4.1 / 4.2** — la branche `stopping` du balayage libérait sans drainer la file ni regarder une session vivante | même règle que `releaseStuckRunLockForKey` : **file non vide** → run réarmée (`runState = "running"`) + `drainExclusivityQueues`, verrou **conservé** tant que la file vit ; puis `projectHasWorkingSession(key)` → verrou **conservé** (borné par la fenêtre « busy-stale » de 25 min) | PREUVE 8 (3 cas : session vivante → conservé, demande en file → relancée, rien à porter → libéré). Mutation : revenir à la libération sèche → **2 échecs** (`preuve-380-stopping-vivant`, `preuve-380-stopping-file`) |

**Comptes réels mesurés lors de ce complément** (arbre de travail, aucun
échec) :

| Commande | Résultat |
|---|---|
| `npm test` (Vitest) | **110 fichiers, 1 893 tests, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **641 réussis, 0 échec, 1 ignoré** |
| dont `src/js/verrou-orphelin.test.js` | **13 tests** (8 à l'origine → 13 après 380bis) |
| dont Rust `project_has_alive_session` / `project_busy_with_liveness` | **3 / 1** |

**Le message de blocage reste affiché quand un agent travaille vraiment** :
`MANUAL_COMMAND_BLOCKED_MESSAGE` (`src/js/run-policy.js`) est inchangé, et
PREUVE 4 (2e cas) vérifie qu'un blocage **réel** — session vivante au travail —
continue de renvoyer `false`, donc « ⏳ Une tâche d'agents est déjà en cours sur
ce projet… » s'affiche toujours. Aucun test de la suite ne contredit ce point
(1 893/1 893).

Mutations exécutées sur des copies **hors dépôt** (`%TEMP%\v380`, jonction vers
`node_modules`, dossier supprimé après usage) : l'arbre du projet n'a été modifié
par aucune mutation. Depuis la mission 385, la sonde de file d'attente du projet
(`setProjectQueueProbe`, `agent-pi.js`) applique la **même** politique : le
compte des points gardés est passé de 5 à **6** (voir § 6, point 7).

## 6. Comment vérifier

```bash
# Cœur (frontend, Vitest) — dont les nouveaux tests de non-régression
npm test

# Rust — desktop (workspace)
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Tests de non-régression ajoutés (`src/js/verrou-orphelin.test.js`) :

1. **agent qui meurt** : run marquée `running`, aucun agent, aucune session
   vivante → `sweepOrphanRunLocks()` libère le verrou, la mission reçoit un
   rapport, `isRunInProgress(projet)` devient `false` et une nouvelle mission
   démarre ;
2. **agent qui échoue / est arrêté par l'utilisateur** : après
   `stopAgentsRun({ runKey })`, le projet est libre pour la mission suivante ;
3. **agent sain** : une run dont l'agent travaille réellement n'est **pas**
   libérée par le balayage ;
4. **commande manuelle** : verrou resté fermé → `canSendManualCommandAsync` tente
   la levée puis **autorise** l'envoi ;
5. **levée à la demande** : `forceReleaseProjectRunLock` libère les clés de run
   (lecture et écriture) et rapporte ce qui a été levé ;
6. **armement autonome** (PREUVE 6) : `initAgentsBus` arme le balayage
   périodique à `RUN_LOCK_SWEEP_MS`, son rappel lève réellement un verrou
   orphelin, `destroyAgentsBus` le désarme ;
7. **tous les points d'entrée** (PREUVE 7) : les **6** points d'entrée — les 5
   sites d'envoi manuel (`agent-pi.js` ×3, `sidebar.js`, `prompt-builder.js`) et
   la sonde de la file d'attente du projet (`setProjectQueueProbe`, mission 385,
   `agent-pi.js`) — passent la levée ciblée (`releaseOrphanRunLock`) ; aucun ne
   peut être oublié ;
8. **arrêt jamais terminé** (PREUVE 8) : une run `stopping` dont une session
   travaille encore garde son verrou, ses demandes en file sont **relancées**
   (jamais abandonnées), et elle est bien libérée quand plus rien ne la porte ;
9. Rust : `project_busy_with_liveness` (occupé **et** session vivante) et les
   trois cas de `AgentService::project_has_alive_session` — service sans session,
   session **morte**, session **vivante** — sur de vrais processus enfants.

Vérification manuelle dans Pilot :

1. provoquer/observer un blocage, puis taper **`/verrou`** dans le chat agent :
   l'état du verrou (clés de run, agents actifs, inactivité, demandes en file)
   s'affiche ;
2. taper **`/verrou libere`** : le verrou est levé et la prochaine mission part
   sans redémarrer Pilot ;
3. sans rien faire, un verrou orphelin se lève seul en 2 à 3 minutes (balayage) :
   le message « ⏳ Une tâche d'agents est déjà en cours » ne revient plus.

Rappel : le verrou est **en mémoire**, aucun fichier de verrou n'existe sur le
disque du projet (c'est pourquoi un redémarrage de Pilot le libérait).
