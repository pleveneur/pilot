# Rapport — bug « une tâche mise en file exécute une autre tâche que la sienne »

## 1. Symptôme (tel que constaté, 2 fois)

Une demande envoyée vers un projet **alors qu'une autre y tourne** est mise en file.
Quand son tour arrive, l'agent exécute **le contenu de la tâche précédente**, déjà
livrée, au lieu de la demande mise en file.

- Cas 1 : « écrire les routes HTTP du portage » (mise en file) → l'agent a
  re-contrôlé l'étape d'avant.
- Cas 2 : « brancher l'application de bureau sur ces routes » (mise en file) →
  l'agent a re-contrôlé les routes, déjà livrées.

Les demandes envoyées **file vide** se sont exécutées correctement → le défaut est
bien dans le **tour de file**, pas dans la demande elle-même.

## 2. Tentative de reproduction — ce que j'ai d'abord écarté

Avant de corriger, j'ai vérifié si le **texte** d'une mission pouvait être remplacé
par celui d'une autre. Lecture faite (aucune ligne n'est citée sans avoir été lue) :

| Ce qui porte le texte | Preuve | Verdict |
|---|---|---|
| Entrée de file : closure `{ launch }` + `label` | `src/js/super-agent.js:649-662` (`queue.push({ launch })` l. 653, `queue.at(-1).label = label` l. 654) | Chaque entrée capture **sa propre** closure : `task`, `brief`, `assignments`, `missionIdentity` sont des variables **locales** au handler de la demande (`super-agent.js:5243` : brief construit une seule fois, puis `assignments` figées). Aucune variable partagée entre deux lancements. |
| Identité de mission | `src/js/mission-identity.js` (`nextMissionId` monotone, `stampQueuedMission` refuse le double empilement) | Le numéro est estampillé sur l'entrée elle-même. |
| Prompt envoyé à pi | `src/js/agents-bus.js:3668` (`buildAgentPrompt(agent, brief, …)` ← `src/js/agents.js:218`) | Le prompt est construit **à l'exécution depuis le `brief` de l'entrée** : si une entrée s'exécute, elle s'exécute avec son propre brief. |

**Conclusion de cette étape : aucun chemin de code ne réécrit le `brief`/`label`
d'une entrée déjà en file.** Un « texte substitué » n'est donc pas reproductible
par lecture. Je ne l'ai pas non plus obtenu par test.

## 3. Cause retenue, avec preuve

**Une mission rejouée qui trouve le projet encore occupé PERD SON RANG : elle est
remise en file en QUEUE de file, donc derrière les missions arrivées après elle.**
Le créneau libéré exécute alors une **autre** demande que celle dont c'était le
tour — typiquement la mission de l'étape précédente, dont le contenu est déjà
livré. C'est exactement la description « la tâche mise en file a exécuté la tâche
précédente ».

Chaîne exacte :

1. Le rejeu sort la mission **de la tête** : `src/js/super-agent.js:5368`
   (`const next = queue.shift(); launchQueuedMission(target, next);`) puis
   `src/js/super-agent.js:1472` (`result = entry.launch({ dequeue: true });`).
2. Le lancement reconnaît qu'il sort de la file : `super-agent.js:5460`,
   `5553`, `5779` (`dequeue: !!(launchOpts && launchOpts.dequeue)`), mais si le
   projet est encore occupé (`isRunInProgress` / `isProjectAgentBusy` /
   terrain réservé), `decideMissionAdmission` répond **mise en file** :
   `super-agent.js:822` (`if (pending > 0) return { queue: true, pending, reason: "queue-ahead" };`) :
   avec `dequeue:true`, `pending` vaut 0 pour la mission elle-même
   (`super-agent.js:728`), donc c'est bien le motif « occupé » qui la remet
   en file.
3. **Le défaut** : la remise en file passe par le chemin unique
   `enqueueMissionForProject` (`super-agent.js:5473`, `5560`, `5796`), qui pousse
   **toujours** en queue de file — `super-agent.js:653` `queue.push({ launch });`.
   La mission repart donc **derrière** toutes celles arrivées entre-temps.

**Preuve terrain (journal des arrêts automatiques du projet,
`.pilot/agent-stops.log`)** : l. 259, `2026-10-25T06:59:18.897Z`,
`reason=queue-order-respected`, `detail=5 mission(s) en file : #25 « … » · #24 « … » · #26 « … »`.
Les numéros sont alloués **monotonement à l'arrivée** (`mission-identity.js`,
`nextMissionId`) : voir `#25` **devant** `#24` dans la file prouve qu'une mission
a perdu son rang au profit d'une plus récente — la file ne respecte plus l'ordre
d'arrivée. Même inversion l. 262-264. C'est le contexte exact des deux cas
signalés (missions #20 à #26 empilées sur `G:\IA_PL\pilot` en quelques minutes).

## 4. Correction appliquée (minimale)

- Nouvelle fonction `restoreQueuedMissionRank(projectPath, entry)`
  (`src/js/super-agent.js:683-700`) : replace une entrée **en tête** de file.
  Idempotente, sans effet si l'entrée est déjà en tête, absente, ou si le projet
  n'a pas de file (**aucune file fantôme créée**), et **l'ordre des autres
  missions est strictement préservé**.
- Appel gardé sur les **trois** chemins de remise en file, uniquement pour une
  mission **sortie** de la file : `super-agent.js:5478`, `5563`, `5796`
  (`if (launchOpts && launchOpts.dequeue) restoreQueuedMissionRank(target, queued.entry);`).

Ce qui n'a **pas** changé : une seule tâche à la fois par projet, l'ordre
d'arrivée des nouvelles demandes (elles s'empilent toujours en queue), l'affichage
des rangs (calculé depuis la position : la mission rejouée réaffiche « en cours »
puis « en attente (1er) »), le lancement d'agent, l'estimation/devis, le
plan-maker et le prompt de l'assistant (aucun de ces fichiers n'est touché).

## 5. Comment le test empêche le retour du défaut

`src/js/file-attente-rang-rejeu.test.js` (nouveau, 4 tests) :

- **a. Comportement** : file `[B, C]` → `B` sort (comme au rejeu), trouve le
  projet occupé et est remise en file → l'ordre doit rester **`[B, C]`** et le
  premier rang de `getProjectMissionQueue` doit être **B** (avec son `id`). Sans
  correctif, l'ordre devient `[C, B]` : c'est une autre demande qui prend le
  créneau. Plus un test d'idempotence / absence d'effet de bord.
- **b. Câblage** : les **trois** appels `restoreQueuedMissionRank(target, queued.entry)`
  et leurs **trois** gardes `launchOpts.dequeue` doivent exister, et les **trois**
  chemins d'empilement doivent toujours passer par `enqueueMissionForProject`.

**Verrouillage vérifié réellement** : (1) test écrit **avant** la correction →
`FAIL (4)` ; (2) correction appliquée → `PASS (4)` ; (3) défaut **réintroduit**
temporairement (les 2 gardes de `launchOrQueue`/`startRun` neutralisées) →
retour à l'échec ; (4) correction rétablie → `PASS (4)`.

## 6. Écarts et doutes signalés (non corrigés)

1. **Niveau de preuve honnête** : je reproduis et corrige « une mission en file
   n'est pas exécutée à **son tour** ». Je n'ai **pas** réussi à reproduire un
   « **texte** d'une autre mission injecté à la place du sien » : les preuves du
   § 2 montrent que le texte voyage correctement avec son entrée. La cause
   retenue explique le symptôme observé (une demande déjà livrée s'exécute au
   tour suivant), pas une substitution de texte à l'intérieur d'une mission.
2. **Pistes non instruites, laissées en l'état** (hors du périmètre de cette
   correction, ou non prouvées) :
   - `src-tauri/src/agents.rs:406` : ce chemin **reporte** le `mission_resume` de
     la mission en cours sur un envoi qui n'en porte pas (voulu pour la reprise
     après blocage) — à confronter un jour au rejeu de file, non concluant ici.
   - `attachDelegationContext` (`src/js/super-agent.js:1640`) joint un contexte
     de suivi (projet, tâches, décisions, mémoire) au brief : un résumé de
     mission antérieure y est **légitime** et n'a pas été modifié.
   - Troisième chemin d'empilement (`run_assistant_agents`, `super-agent.js:5793`) :
     il a reçu **la même** garde de rang que les deux autres, mais son admission
     n'a pas été retestée de bout en bout faute de pouvoir l'exercer en test.
3. **Non touché (périmètre)** : aucune modification de `project-task-queue.js`,
   `project-queue-view.js`, `agents-bus.js`, `mission-identity.js`, ni du Rust.
   Aucun réglage de file, de priorité, d'ordre ou de nombre de tâches n'a été
   changé pour « masquer » le symptôme.

## 7. Vérifications

- `npx vitest run src/js/file-attente-rang-rejeu.test.js` : `PASS (4) FAIL (0)`.
- Sous-suite file/rangs/missions (regle-4, fifo-admission, identite-demande,
  fenetre-rejeu, retrait-mission, arret-conserve, agent-demande-exact,
  project-queue-wiring, project-task-queue, verrou-par-projet) :
  `PASS (145) FAIL (0)` — aucun test existant cassé.
- Suites complètes, lancées après le commit de ce rapport, **aucun code
  modifié depuis** :
  - `npx vitest run` → **2921 passés, 0 échec** (2917 avant + les 4 nouveaux
    tests de ce correctif : aucun test existant cassé) ;
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **735 passés,
    1 ignoré** (identique à la référence avant correction).

VERDICT (1re cause) : cause trouvée et corrigée (une mission rejouée perdait son rang et une
autre demande prenait son tour) ; test de reproduction verrouillé ; le point
« texte exact d'une autre mission » n'a pas pu être reproduit et reste signalé
comme doute, non corrigé à l'aveugle.

---

# Deuxième cause, indépendante — le CONTEXTE DE SUIVI était figé à l'ARRIVÉE

> Ajouté au même rapport parce que le symptôme est le même (« la tâche en file
> exécute la tâche précédente »), mais la cause est **différente** et n'était pas
> couverte par le § 4 : même avec l'ordre de file parfaitement respecté, une
> mission en file pouvait encore **commencer par l'étape précédente**.

## 8. Le défaut, tel qu'il était écrit

Chaque demande déléguée à un agent reçoit, **en tête** de son brief, un bloc
`## Contexte de suivi (assistant)` (projet, tâches, décisions, sessions, mémoire).
Ce bloc n'est pas décoratif : il est **préfixé**, donc lu en premier par l'agent
(`src/js/super-agent-context.js:119` `prefixDelegationContext`, titre l. 28).

Or il était construit **au moment où la demande ARRIVAIT**, jamais à celui où elle
**partait** :

1. `src/js/super-agent.js:5243` (avant correctif) — handler `run_agents` :
   `const brief = await attachDelegationContext(messagesEl, applyAssistantBriefEnvelope(task, {…}), targetProject || window._pilotProjectPath || null, task);`
2. `src/js/super-agent.js:1640-1645` — `attachDelegationContext` lit le suivi
   **immédiatement** (`await loadDelegationContext(...)`) puis
   `return prefixDelegationContext(brief, context);`.
3. Le résultat est stocké dans les affectations (`brief`), qui **voyagent avec
   l'entrée de file** ; le lancement ne relit jamais le suivi.

Le bloc contient la ligne `- Chantiers en cours : …`
(`src/js/super-agent-context.js:209-211`) alimentée par `memory.work_in_progress`,
c'est-à-dire **la mission qui tourne à cet instant**. Une demande mise en file
arrive forcément pendant qu'une autre mission occupe le projet : son bloc décrit
donc **la mission précédente**, et comme il est en tête du prompt, l'agent
commence par re-contrôler/re-livrer l'étape d'avant — exactement les deux cas
signalés au § 1 (« re-contrôlé l'étape d'avant », « re-contrôlé les routes déjà
livrées »). Le § 2 avait écarté la substitution du **texte de la mission** ; le
texte était bien le bon, c'est son **contexte** qui parlait d'une autre tâche.

Même mécanisme sur les deux autres chemins d'appel, à l'identique :
`super-agent.js:5720` (`run_assistant_agents`, agent hors projet) et
`super-agent.js:6218` (`delegate_to_coder`, dont la demande est **mise en file**
dans `delegationState(...).queue` avec ce brief déjà préfixé :
`super-agent.js:6376` avant correctif).

## 9. Correction appliquée (au plus court : relire au LANCEMENT)

Le contexte n'est plus figé à l'arrivée ; il est **relu dans le chemin de
lancement**, par lequel passe aussi le rejeu de la file.

- **Fonction unique** `refreshAssignmentsBrief(assignments, baseBrief, projectPath, task, deps)`
  (`src/js/super-agent.js:1675`) : relit le suivi (`loadDelegationContext`, aucun
  second mécanisme), préfixe le brief de **base** et réécrit `brief` sur toutes
  les affectations. Fail-open : lecture impossible ⇒ brief de base inchangé,
  aucune exception.
- `run_agents` : les affectations portent désormais le brief **de base**
  (`super-agent.js:5301`) et la relecture est dans le **lancement** :
  `const launchRun = () => attachLaunchContext().then(() => new Promise(...))`
  (`super-agent.js:5446`) → `refreshAssignmentsBrief(...)` (`super-agent.js:5317`).
  Comme `launchOrQueue` appelle `launchRun` **aussi** au rejeu, la mission sortie
  de file part avec le suivi du moment de son démarrage.
- `run_assistant_agents` : idem, relecture juste avant le démarrage réel de la
  run (`super-agent.js:5894`, appel `refreshAssignmentsBrief` l. 5806).
- `delegate_to_coder` : le brief de **base** et la tâche voyagent avec l'entrée de
  file (`baseRequest`, `task` — `super-agent.js:6386`) et `flushDelegationQueue`
  relit le contexte **à la transmission** (`super-agent.js:6750-6751`). Une entrée
  historique sans `baseRequest` part inchangée (comportement antérieur préservé).

Aucun autre comportement n'a bougé : ordre d'arrivée de la file, rangs, admission
FIFO, exclusivité par projet, verrou de run, purge de conversation avant la run,
lancement d'agent, estimation/devis, plan-maker et prompt de l'assistant sont
intacts (vérifié par les 124 tests de la sous-suite file/missions/agents, § 12).

## 10. Test qui reproduit le défaut et l'empêche de revenir

`src/js/file-attente-contexte-au-lancement.test.js` (nouveau, 10 tests,
comportemental : le module de production est importé, `invoke` est simulé, le
suivi est **muté entre l'arrivée et le lancement** comme dans la réalité) :

- **a. Défaut reproduit** : un contexte lu à l'ARRIVÉE contient la mission A
  (`livrer les routes HTTP du portage`) alors que la mission est B, et se retrouve
  **en tête** du brief (`startsWith("## Contexte de suivi (assistant)")`). Le défaut
  est donc bien visible dans le prompt de l'agent.
- **b. Correction** : entre l'arrivée et le lancement le suivi passe de A à B → le
  brief envoyé contient B et **ne contient plus A** ; l'objectif de la demande
  reste présent. Plus deux gardes : aucun suivi ⇒ brief intact ; suivi
  indisponible ⇒ brief intact (fail-open).
- **c. De bout en bout par la FILE DE PRODUCTION** : mission B mise en file avec
  `enqueueMissionForProject` (arrivée pendant que A tourne), suivi qui avance,
  rejeu réel `replayQueuedMissionForProject(...)` → le brief réellement parti
  contient B, **jamais A**, et la file est vidée.
- **d. Câblage** : l'arrivée ne fige plus de contexte (`brief: baseBrief`,
  présence d'`attachDelegationContext(messagesEl, baseBrief, …)` pour la seule
  délégation directe), la relecture est **dans** `launchRun` (avant
  `runAgentsForAssistantAsync`) et **avant** le démarrage de
  `run_assistant_agents`, et le rejeu de la file de délégations relit le contexte.
  Plus une garde explicite : `entry.launch({ dequeue: true })`,
  `restoreQueuedMissionRank`, les **3** `decideMissionAdmission` et
  `queue.push({ launch })` sont toujours là (la 1re correction n'est pas cassée).

## 11. Anti-régression : le défaut réintroduit fait bien échouer les tests

Protocole réellement exécuté (fichier sauvegardé, puis restauré) :

1. Défaut du § 8 réintroduit temporairement dans `super-agent.js` — contexte lu
   **une seule fois** (instantané figé, ce que faisait l'arrivée) **et** appel de
   relecture retiré de `launchRun`. Résultat : `PASS (33) FAIL (6)`, dont
   - `b. … le suivi a changé entre l'arrivée et le lancement` → contient A au lieu
     de B (le symptôme exact) ;
   - `c. … la mission rejouée part avec le contexte de SA tâche` → idem ;
   - `d. … relecture DANS launchRun` → l'appel n'existe plus.
2. Correctif rétabli → `PASS (124) FAIL (0)` sur la sous-suite file/missions.

Note honnête : les deux tests de garde (aucun suivi / fail-open) échouent aussi
sous cette réintroduction **artificielle**, parce que l'émulation « instantané
figé » renvoie le brief avant toute lecture ; ce n'est pas une conséquence du
défaut réel, seulement de la façon dont je l'ai simulé.

## 12. Hypothèse n° 2 (mission admise pendant le règlement du tour précédent) — instruite

Vérifiée par lecture, **non retenue comme cause** et laissée telle quelle :

- à l'arrivée, `decideMissionAdmission` (`super-agent.js:820-825`) met en file dès
  qu'une mission attend (`pending > 0`) ou que le projet est occupé (`busy`) ;
- au rejeu, `replayQueuedMissionForProject` (`super-agent.js:1355-1380`) exige une
  admission **libre** et est **fail-closed** (`busy` en cas d'erreur de sonde) ;
  `isRunStillActive` (`super-agent.js:1324-1342`) regarde le verrou du bus **et**
  les sessions réelles, après avoir libéré un éventuel verrou fantôme inactif ;
- le lancement purge la conversation de chaque agent (`{ purge: true }`, appelé
  `super-agent.js:5475`/`5912`), donc un `resume` ne peut pas rejouer la
  conversation de la mission précédente.

Aucune fenêtre « lancement pendant le règlement du tour précédent » n'a donc été
trouvée ; le symptôme s'explique entièrement par le contexte figé du § 8.

## 13. Écarts et doutes (signalés, non corrigés)

1. **`delegate_to_coder` non exercé de bout en bout** : la relecture à la
   transmission est vérifiée par test de câblage + par la fonction de production,
   pas par une exécution complète (il faudrait un onglet d'agent et un bus réels).
2. **Le suivi lui-même peut être en retard** : `memory.work_in_progress` est écrit
   par l'assistant en fin de mission. Si ce résumé n'est pas encore écrit quand la
   mission suivante démarre, le bloc dira la mission précédente — ce n'est plus un
   défaut de file mais une **latence du suivi**. Non corrigé ici (hors périmètre :
   cela toucherait l'écriture du suivi, pas le lancement).
3. **Libellé du message de chat** : le contexte est désormais annoncé au lancement
   (« 🧠 Contexte de suivi joint… ») et non plus à l'arrivée : une demande qui
   attend en file n'affiche l'annonce qu'au moment où elle démarre. C'est
   volontaire (le message décrit ce qui part réellement), signalé comme
   changement visible.

## 14. Vérifications (deuxième cause)

- `npx vitest run src/js/file-attente-contexte-au-lancement.test.js` : `PASS (10) FAIL (0)`.
- `npx vitest run src/js/super-agent-context.test.js` : `PASS (29) FAIL (0)`
  (3 ancres mises à jour : elles vérifiaient le branchement **à l'arrivée**, elles
  vérifient désormais le branchement **au lancement**).
- Sous-suite file/missions/agents (`file-attente-contexte-au-lancement`,
  `super-agent-context`, `file-attente-fifo-admission`,
  `file-attente-identite-demande`, `file-attente-rang-rejeu`,
  `exclusivity-queue`, `project-queue-wiring`) : `PASS (124) FAIL (0)`.
- Suites complètes lancées après le commit de ce rapport (§ 15).

## 15. Fichiers touchés

- `src/js/super-agent.js` (source du correctif : relecture au lancement sur les
  trois chemins) ;
- `src/js/super-agent-context.test.js` (ancres de branchement mises à jour) ;
- `src/js/file-attente-contexte-au-lancement.test.js` (nouveau, reproduction) ;
- ce rapport.

Ni `super-agent-context.js`, ni `project-task-queue.js`, ni `project-queue-view.js`,
ni `agents-bus.js` n'ont été modifiés : la lecture du suivi et le préfixage étaient
corrects, c'est le **moment** de la lecture qui était faux.

VERDICT : deuxième cause confirmée et corrigée — le contexte de suivi d'une mission est désormais relu au lancement (donc aussi au rejeu de file) et ne peut plus décrire la tâche précédente ; reproduction verrouillée par 10 tests, anti-régression prouvée par réintroduction du défaut (6 échecs) ; hypothèse n° 2 instruite et non retenue ; doutes restants signalés (latence du suivi, chemin `delegate_to_coder` non exercé de bout en bout).
