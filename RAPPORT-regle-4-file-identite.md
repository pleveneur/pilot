# RÈGLE 4 — rejouer la demande mise en file avec SA PROPRE identité

**Micro-tâche** : « une demande mise en file est TOUJOURS rejouée avec SA PROPRE
demande, jamais perdue en silence ».
**Périmètre** : strictement les 3 correctifs de `RAPPORT-verification-A-B-2026-10-20.md`
§ A.3 (points 3 et 5 — sinks par missionId, compteur durable — **hors périmètre**,
non traités). JS uniquement, aucun fichier Rust, aucun seuil de temps modifié.

---

## 1. Faits constatés avant modification

| # | Cause du rapport | Fait vérifié dans le code |
|---|---|---|
| 1 | `endRun` détruit le contexte de run | `agents-bus.js` : la file d'exclusivité était `ctx.exclusivityQueue` (créée par `newRunCtx`) ; `endRun`/`clearAllRuns` supprimaient le contexte **et donc la file** → une demande en attente disparaissait avec la run qui l'avait mise en file. |
| 2 | Le rejeu ne connaît pas le propriétaire | `launchNextQueued` exécutait la tête de file dans le contexte de **la run appelante** (`callerCtx`) : `pending` décrémenté au mauvais endroit, sink étranger, rapport potentiellement livré à une autre mission. |
| 3 | Aucune identité de mission | une entrée de file ne portait que `{ launch, label }` : le compte rendu livré à l'Assistant ne nommait **ni** la demande **ni** ses agents — un rapport de A pouvait donc être lu comme celui de B. |
| 4 | Abandon muet | `super-agent.js` (watchdog) : `runAgentsQueueByProject[target].length = 0` — les demandes en attente étaient jetées **sans motif ni nom**. |
| 5/6 | (Identité absente → confusion) | mêmes causes que 3. |

Ancres exactes : `agents-bus.js` `newRunCtx` / `beginRun` / `endRun` /
`clearAllRuns` / `launchNextQueued` / `dispatchParallel` ; `super-agent.js` les
**3** sites de mise en file (`launchOrQueue`, `startRun` de `run_agents`,
`startRun` de `run_assistant_agents`), le watchdog de run et la chaîne de remise
du compte rendu (`finishRunAgentsToSuperAgent` → `injectRunAgentsResultToSuperAgent`
→ `superAgentReportGate.deliver` → `inject_session_summary`).

---

## 2. Correctifs appliqués (3, minimaux)

### 2.1 Identité de mission explicite (causes 3/5/6)

- **Nouveau module pur** `src/js/mission-identity.js` (aucune dépendance Tauri/DOM) :
  `nextMissionId()` (compteur monotone), `makeMissionIdentity(id, agentIds)`,
  `missionTag()` → `[mission #7 · agents : codeur]`, `annotateMissionReport()`,
  `stampQueuedMission()` (estampille l'entrée **et refuse le double empilement**),
  `missionQueueLabel()` → `#7 « texte de la demande »` (journal/UI).
- `super-agent.js` : chaque demande reçoit `makeMissionIdentity(nextMissionId(),
  agentIds)` **avant** toute mise en file ; les 3 sites font
  `push({ launch: … }); .at(-1).label = task;` **puis** `stampQueuedMission(...)`
  (la forme exigée par `file-attente-identite-demande.test.js` est conservée à
  l'identique). Un doublon éventuel est **annoncé** au lieu d'être tu.
- Propagation : `settleRun` transmet l'identité à
  `finishRunAgentsToSuperAgent(result, projectPath, ok, missionIdentity)`, qui la
  remet à `injectRunAgentsResultToSuperAgent(..., { remember: true, identity })` ;
  le compte rendu livré est préfixé par `annotateMissionReport(...)`.
- Aucune migration SQL : l'identité vit dans la **charge JS** (file + compte
  rendu), conformément à la préférence de la mission.

### 2.2 La file ne meurt plus avec la run (causes 1/2)

- `agents-bus.js` : file **module-level par projet** (`projectExclusivityQueues`,
  clé = chemin réel) exposée par `exclusivityQueueOfProject(project)`. Tous les
  contextes de run d'un projet partagent **la même** file ; `ctx.exclusivityQueue`
  en est une **référence** (les assertions existantes `ctx.exclusivityQueue[...]`
  restent valides).
- `endRun` ne détruit plus les demandes ; `clearAllRuns` **signale** ce qu'il perd
  (`console.warn` + nombre d'entrées) au lieu de le taire. `beginRun` **élague**
  les clés non rejouables (sans séparateur `\u{1f}`) avec avertissement : elles
  bloqueraient le verrou pour toujours.
- Chaque entrée mise en file par `dispatchParallel` porte `ownerRunKey =
  ctx.runKey`. Au rejeu, `launchNextQueued` résout `ownerCtx =
  busState.runs[head.ownerRunKey]` :
  - propriétaire **présent** → exécution via `runAgentTurn(..., ownerCtx)` (son
    sink, son groupe parallèle, sa génération) ;
  - propriétaire **absent** → **jamais** d'exécution dans un contexte étranger :
    l'entrée **reste en file**, `console.warn`, **notify** visible et journal
    disque via `traceAutomaticAgentStop` avec le motif `queue-replay-no-owner`
    (champ `detail` = brief de la demande).

### 2.3 Une file n'est jamais vidée en silence (cause 4)

- `agents-bus.js`/`super-agent.js` : `loop-detection.js::buildAgentStopTraceLine`
  accepte un champ optionnel `detail=` (les lignes sans `detail` gardent **le
  format historique octet pour octet**) ; `agent-stop-trace.js` est réutilisé tel
  quel (journal `<projet>/.pilot/agent-stops.log`, repli global
  `<app_data_dir>/agent-stops.log`).
- Nouvelle fonction **exportée** `abandonQueuedRunAgentsMissions(target)` dans
  `super-agent.js` : nomme chaque mission abandonnée (`missionQueueLabel`),
  désarme le rejeu, écrit `reason=queue-abandoned` (+ libellés) dans le journal,
  `console.warn` et **notification desktop**. Le watchdog l'appelle et affiche
  les libellés dans le message : plus aucun `queue.length = 0` muet.

---

## 3. Preuves (Vitest, sans DOM) — `src/js/file-attente-regle-4.test.js`

| Preuve | Ce qu'elle vérifie | Échoue si le correctif est retiré (mutation rejouée) |
|---|---|---|
| **a. Identité de bout en bout** | mission A (`codeur`) puis B (`testeur`) en file sur le même projet ; rejeu de la tête → briefs exécutés **A puis B** ; comptes rendus livrés (`inject_session_summary`) étiquetés `[mission #1 · agents : codeur]` / `[mission #2 · agents : testeur]`, le rapport de A **ne contient pas** l'identité de B. | Mutation « `annotateMissionReport(...)` → `buildRunAgentsSummary(result)` » → **FAIL** : `expected '[Tâche run_agents terminée] …' to contain '[mission #1 · agents : codeur]'`. |
| **b. Survie de la file** | demande mise en file au niveau du **bus** (`startParallelRun`, agent actif) ; fin de la run propriétaire **sans** `agent_end` → l'entrée **survit** (`exclusivityQueueOfProject`), garde son `brief` et son `ownerRunKey` ; rejeu tenté → **conservée**, journal `queue-replay-no-owner` + `agent=lecteur` + brief, **aucune** exécution dans un contexte étranger. | Mutation « file locale (`exclusivityQueue: {}`) » → **FAIL** (`la demande B doit être en file: expected undefined to be 1`). Mutation « `ownerCtx = callerCtx` » → **FAIL** (`la demande doit être CONSERVÉE (jamais perdue)`). |
| **c. Watchdog** | 2 missions en file → `abandonQueuedRunAgentsMissions` retourne `count: 2` et les libellés `#1 « corriger le parseur »`, `#2 « écrire les tests »`, journal `reason=queue-abandoned` + `detected=watchdog` + libellés, file vidée ; ancre : le watchdog appelle l'abandon tracé et plus aucun `length = 0`. | Mutation « journal retiré de l'abandon » → **FAIL** (`expected '' to contain 'reason=queue-abandoned'`). |

**Contrainte forte respectée** : aucune adaptation des tests existants.
`exclusivity-queue.test.js`, `project-task-queue.test.js`,
`project-queue-wiring.test.js`, `agents-bus.test.js`, `verrou-par-projet.test.js`,
`verrou-orphelin.test.js`, `file-attente-identite-demande.test.js` restent verts
**sans modification** (271 tests ciblés, puis suite complète).

Suite complète : `npm test` → **115 fichiers, 1963 tests, 0 échec**.

---

## 4. Limites connues (assumées, hors périmètre)

1. **Sinks par missionId** (point 3 du rapport) : non traités. L'identité sert
   d'étiquette et de garde de propriétaire ; les résultats du groupe parallèle
   restent indexés par `agentId` (deux missions sur le **même** agent restent
   distinguées par le contexte propriétaire, pas par le sink).
2. **Compteur durable** (point 5) : `nextMissionId()` est monotone **en session**
   (remis à zéro au redémarrage). Aucune persistance disque demandée : un numéro
   n'est pas un identifiant de corrélation inter-sessions.
3. **Rejeu sans propriétaire** : la demande est conservée **indéfiniment** en
   file (visible + journalisée) ; sa reprise exige qu'une run propriétaire
   revienne ou qu'un humain la relance. Choix assumé : mieux vaut une demande
   visiblement bloquée qu'une demande exécutée pour une autre mission.
4. **Numéros consommés** : une demande refusée après allocation (agent inconnu)
   laisse un trou dans la numérotation (aucun effet fonctionnel).
5. Le champ `detail=` du journal n'existe que pour les nouveaux motifs ; le
   format des lignes historiques est inchangé (test
   `loop-detection-content.test.js` vert).

---

## 5. Livrables

- `src/js/mission-identity.js` (nouveau, pur, testé indirectement par les
  preuves a/b/c).
- `src/js/agents-bus.js` : file par projet, `ownerRunKey`, prune, abandon
  observable, `launchNextQueuedForProject` exporté (déclenchement déterministe).
- `src/js/super-agent.js` : identité aux 3 sites de mise en file, propagation au
  compte rendu, `abandonQueuedRunAgentsMissions` (+ watchdog), `getProjectMissionQueue`
  expose `id`/`agentIds`.
- `src/js/loop-detection.js` : champ optionnel `detail=` du journal.
- `src/js/file-attente-regle-4.test.js` (nouveau) : preuves a/b/c + invariants.
- Docs : `spec_super_agent.md` (règle 4 + bloc `<!-- HELP:file-attente-identite-mission -->`),
  `AGENTS.md` (nouveau module + motifs de file), `help/handbook.md` régénéré.

**Commandes** : `npm test` puis `npm run build:handbook` (déjà exécuté).
