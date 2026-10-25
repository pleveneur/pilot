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

VERDICT : cause trouvée et corrigée (une mission rejouée perdait son rang et une
autre demande prenait son tour) ; test de reproduction verrouillé ; le point
« texte exact d'une autre mission » n'a pas pu être reproduit et reste signalé
comme doute, non corrigé à l'aveugle.
