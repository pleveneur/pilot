# Rapport P3 — clé de projet unique (correction du défaut D3)

Mission : **P3 — correction de code bornée** (défaut D3 du rapport
`rapport-file-attente-pertes-doublons.md`). Aucune autre correction, aucun
changement de comportement visible pour l'utilisateur.

## 1. Le défaut, tel qu'il se produisait

La clé d'un projet — l'index de **toutes** les files et de **tous** les verrous —
était le **chemin brut** à plusieurs endroits, alors que `super-agent-context.js`
normalisait déjà ce chemin de son côté (`normalizeProjectPath`).

Conséquence : deux écritures du **même** dossier

```
G:\IA_PL\pilot        vs        g:/ia_pl/pilot/
```

désignaient **deux projets distincts**. Selon l'écriture reçue par l'appelant
(chemin de l'onglet, chemin mémorisé dans une session, chemin reçu d'un agent,
chemin d'une vue distante…) on obtenait :

- deux **files de missions** / de **délégations** : l'une traitée, l'autre
  jamais rejouée ni abandonnée nommément — donc **invisible** ;
- deux **verrous de run** : le projet pouvait être lancé deux fois en parallèle
  (ou rester bloqué par un verrou que personne ne relisait) ;
- deux **files d'exclusivité** : une demande en attente devenait orpheline ;
- deux **réservations de fichiers** : deux codeurs pouvaient réserver le même
  dossier sans se voir.

## 2. La correction (une seule source, changement ciblé)

### 2.1 Nouveau module — source unique de l'identité

`src/js/project-key.js` (**pur**, aucune I/O, **ne renvoie jamais un chemin
utilisable**) :

| Export | Rôle |
|---|---|
| `normalizeProjectPath` | normalise : espaces de bord, `\` → `/`, barres répétées, barre finale, préfixe `./`, casse |
| `projectKey` | clé canonique d'un projet |
| `sameProject(a, b)` | deux écritures désignent-elles le même dossier ? |
| `scopedProjectOfKey(key)` | projet d'une clé `projet\u{1f}agent` |
| `queueKeyMatchesProject(key, project)` | la clé concerne-t-elle ce projet (quelle que soit l'écriture) ? |
| `findProjectScopedKey(map, project)` | clé **existante** du projet dans une map (sinon `null`) |
| `projectScopedKey(record, project)` | clé existante si elle existe, sinon clé canonique — **aucune migration** |
| `deleteProjectScoped(record, project)` | supprime l'entrée du projet, quelle que soit son écriture |

Sentinelles préservées : `""` (espace assistant) et `"."` (projet implicite) ne
se confondent jamais avec un chemin.

### 2.2 Sites convertis

| Fichier | Ce qui a changé |
|---|---|
| `src/js/super-agent-context.js` | sa copie locale de `normalizeProjectPath` **supprimée** ; import + ré-export depuis `project-key.js` (compatibilité) |
| `src/js/exclusivity-queue.js` | `exclusivityKey` = `projectKey(project) + "\u{1f}" + agentId` ; nouveau `findExclusivityKey` (retrouve une entrée posée avec une autre écriture) utilisé par `enqueueExclusivity` / `dequeueExclusivity` ; comparaisons `s.project === project` → `sameProject(...)` |
| `src/js/agents-bus.js` | nouveau `resolveRunKey(project)` (clé de run existante du projet, en **ignorant** les clés de lecture `#read:`) ; `getRunCtx` / `beginRun` / `endRun`, `projectExclusivityQueues` et toutes ses lectures, `anyActiveAgentWorking`, recherches de sessions : `sameProject` / `projectScopedKey` / `queueKeyMatchesProject` |
| `src/js/super-agent.js` | `delegationState` indexé par `projectKey` ; clés internes uniques `missionQueueKey` (**exportée** pour les tests), `inFlightKey`, `missionReplayKey`, `watchdogKey`, `delegationReplayKey` ; **58 accès** aux 5 maps indexées par projet passés par ces helpers ; comparaisons `ctx.project === project` / `s.project === project` → `sameProject` |
| `src/js/reservations.js` | `reservedProjects` indexée par `projectKey` → `{ coderId, project: <chemin réel> }` (le chemin réel est conservé pour l'I/O disque) ; `markProjectReserved`, `unmarkProjectReserved`, `isProjectReserved`, `isProjectReservedBy`, battements de cœur et purge finale utilisent la clé |

### 2.3 Point de vigilance traité : la trace d'un abandon

Un arrêt automatique écrit une ligne dans `<projet>/.pilot/agent-stops.log`.
Basculer les clés en chemins normalisés risquait d'écrire le journal **au mauvais
endroit** (`g:/ia_pl/pilot/.pilot/…` au lieu de `G:\IA_PL\pilot\.pilot\…`).

- `traceQueueAbandon` reçoit désormais le **chemin réel** (jamais la clé) pour
  les trois familles de file (`abandonProjectMissionQueue`,
  `abandonQueuedRunAgentsMissions`, `keepQueuedRunAgentsMissions`,
  `abandonProjectDelegationQueue`, `abandonQueuedDelegations`).
- La file d'exclusivité mémorise le chemin réel dans une propriété **symbole**,
  invisible pour `Object.keys`, la sérialisation et les itérations de clés :
  l'arrêt global (« tout arrêter ») vise donc le bon dossier.

## 3. Preuve de non-régression (le test échoue si le défaut revient)

Nouveau fichier `src/js/project-cle-unicite.test.js` — **4 écritures du même
dossier** (`G:\IA_PL\pilot`, `g:/ia_pl/pilot`, `G:/IA_PL/Pilot/`,
` G:\IA_PL\pilot\\ `) :

| Vérification | Échoue si… |
|---|---|
| `projectKey` / `sameProject` | la normalisation est retirée ou diverge |
| `exclusivityKey` | la clé repart du chemin brut (le séparateur `\u{1f}` est conservé) |
| `enqueueExclusivity` + `dequeueExclusivity` avec deux écritures | deux files sont créées, ou l'ordre n'est pas celui des demandes |
| `missionQueueKey` / `enqueueMissionForProject` / `getProjectMissionQueue` / `__superAgentQueueStateForTest` / `abandonProjectMissionQueue` | la file de missions recomparait le chemin brut (deux files, abandon laissant une file orpheline) |
| `exclusivityQueueOfProject` | la file d'exclusivité du bus n'est plus partagée entre écritures |
| `markProjectReserved` + `isProjectReserved(B)` + `isProjectReservedBy` | les réservations recomparaent le chemin brut |

**Mutations vérifiées à la main** (correctif retiré, test relancé, correctif
remis) :

| Mutation | Résultat |
|---|---|
| `exclusivityKey` repasse au chemin brut | **2 tests rouges** (`clés d'exclusivité distinctes : … expected 4 to be 1`, file du bus non partagée) |
| `missionQueueKey` repasse au chemin brut | **1 test rouge** (file de missions) |
| `isProjectReserved` repasse au chemin brut | **1 test rouge** (réservations) |

## 4. Tests exécutés (résultats exacts)

```
npx vitest run src/js/project-cle-unicite.test.js src/js/exclusivity-queue.test.js \
  src/js/project-queue-wiring.test.js src/js/agents-bus.test.js \
  src/js/reservations.test.js src/js/verrou-par-projet.test.js \
  src/js/verrou-orphelin.test.js src/js/regle-4-file-jamais-perdue.test.js \
  src/js/file-attente-arret-conserve.test.js src/js/file-attente-identite-demande.test.js \
  src/js/super-agent-context.test.js src/js/agents-bus-stop-scope.test.js
→ PASS (308) FAIL (0)
```

```
npx vitest run            # suite complète
→ Test Files  123 passed (123)
  Tests       2091 passed (2091)
→ PASS (2091) FAIL (0)
```

```
npm run build             # vérification de compilation du bundle
→ OK (avertissements de découpage de chunks préexistants, sans rapport)
```

État de départ, pour mémoire : la suite complète était à `PASS (2083) FAIL (2)`
en cours de conversion (les 2 échecs étaient des tests indexant la file par le
chemin brut) ; elle est désormais **entièrement verte**, avec 6 tests
supplémentaires.

## 5. Ce qui n'a pas été fait (volontairement)

- **Aucune migration de données** : les entrées existantes (fichiers de file,
  réservations, sessions) ne sont pas réécrites ; elles sont **retrouvées** par
  `findExclusivityKey` / `findProjectScopedKey`.
- **Aucun chemin réel remplacé par une clé** : les appels au backend Rust, aux
  processus d'agents et les écritures disque reçoivent toujours le chemin
  d'origine.
- Les comparaisons restantes de `src/js` (`agent-pi.js`, `tabs.js`,
  `session-persistence.js`, `super-agent-kanban.js`) portent sur des
  **sentinelles** (`ASSISTANT_SPACE`, `ALL_PROJECTS`) ou l'appariement d'**onglets**
  d'UI : ce ne sont ni des files ni des verrous, elles sortent du périmètre D3.
- Les correctifs **P1** (admission FIFO, identité de mission, règle 4) et **P2**
  (file conservée à l'arrêt, verrous) ne sont ni modifiés ni contournés : leurs
  tests restent verts (`file-attente-*`, `verrou-*`, `regle-4-*`).

## 6. Documentation

`spec_super_agent.md` : ajout du paragraphe **« D3 — une seule identité de
projet pour toutes les files et tous les verrous (corrigé) »** (source unique,
clé ≠ chemin, absence de migration, test de preuve). Aucun bloc `<!-- HELP:* -->`
modifié : le comportement visible pour l'utilisateur est inchangé (les pertes
silencieuses qu'il corrige étaient un défaut, pas une fonctionnalité décrite).

## 7. Commandes à relancer

```bash
npm test                 # suite frontend complète (attendu : 2091 tests verts)
npm run tauri dev        # vérification manuelle : deux écritures d'un même projet
                         # ne doivent produire qu'une seule file d'attente
```

---

## 8. Re-vérification (mission P3 rejouée après livraison)

_Cette section a été ajoutée lors du **rejeu** de la mission P3 : le correctif
était déjà committé (`275eb04`, relu indépendamment dans
`rapport-relecture-finale.md`, verdict **PUBLIABLE**). Conformément à la
consigne « si P3 est déjà fait, ne réécris rien : vérifie, mesure, consigne »,
**aucune ligne de code n'a été modifiée** — seules des mesures ont été refaites
sur l'état réel du dépôt._

### 8.1 État constaté sur le disque (pas sur la foi du rapport)

| Point de contrôle | Constat |
|---|---|
| Module unique `src/js/project-key.js` | présent, pur, exporte `normalizeProjectPath` / `projectKey` / `sameProject` / `projectScopedKey` / `findProjectScopedKey` / `queueKeyMatchesProject` |
| `super-agent.js` | importe `projectKey, projectScopedKey, deleteProjectScoped, sameProject` (l. 63) |
| `agents-bus.js` | importe `sameProject, projectScopedKey, deleteProjectScoped, queueKeyMatchesProject` (l. 80) ; verrou de run résolu par `resolveRunKey` (l. 348) qui compare via `sameProject` |
| `exclusivity-queue.js` | `exclusivityKey` = `${projectKey(project)}\u{1f}${agentId}` (l. 26) ; import du module (l. 16) |
| `reservations.js` | importe `projectKey` (l. 31), index par clé, chemin réel conservé pour l'I/O |
| `super-agent-context.js` | plus de copie locale : import + ré-export (l. 18) |
| `help/handbook.md` | le bloc D3 y est désormais **présent** (l. 1772) : la réserve R-C de la relecture est levée |

Les emplacements cités par la mission (`super-agent.js` 4276/4328/5228,
`agents-bus.js` 322, `exclusivity-queue.js` 19/247) ont bougé depuis le
diagnostic — ils ne contiennent plus de comparaison de chemin brut ; ce sont
les mêmes zones, désormais servies par la clé normalisée.

### 8.2 Mesures refaites (chiffres exacts)

```
npx vitest run                       # suite frontend COMPLÈTE (src/js/** + scripts/**)
→ PASS (2091) FAIL (0)
```

```
npx vitest run src/js/project-cle-unicite.test.js
→ PASS (6) FAIL (0)
```

(Le projet utilise un résumé de sortie `PASS (n) FAIL (n)` ; les 2091 tests
portent sur les 120 fichiers `src/js/*.test.js` plus les tests de `scripts/`.)

### 8.3 Preuve de non-vacuité — rejouée à la main

Mutation appliquée temporairement (sauvegarde puis restauration intégrale ;
`git diff` vide après coup, dépôt intact) :

| Mutation | Résultat mesuré |
|---|---|
| `exclusivityKey` repasse au chemin brut (`return \`${project}\u{1f}${agentId}\``) | **FAIL (2)** sur `project-cle-unicite.test.js` — « `exclusivityQueueOfProject` renvoie le MÊME objet pour deux écritures » et la lecture croisée par l'autre écriture renvoie `undefined` |
| Correctif restauré | **PASS (6) FAIL (0)** |

Le test de non-régression **échoue donc bien** si deux écritures du même dossier
redonnent deux files différentes : il n'est pas complaisant.

### 8.4 Limite connue, non corrigée dans cette mission (à traiter séparément)

**R-B — la file des commandes manuelles (`/file`) n'utilise pas encore la clé
normalisée.** `src/js/project-task-queue.js` indexe `state.queues`,
`state.launched` et `queueOf(project)` par le **chemin brut** (l. 209-210,
262-268, 282-289, 315-341), et ce module est bien la file visible de `/file`
(importé par `agent-pi.js` et `project-queue-view.js`). Deux écritures du même
dossier y créent donc encore deux files de commandes manuelles.

Pourquoi elle n'a pas été touchée ici :

- **Hors du périmètre relevé par le diagnostic D3**, qui nomme les files de
  missions et de délégations de l'assistant, le verrou de run du bus, la file
  d'exclusivité et les réservations — et le paragraphe D3 de
  `spec_super_agent.md` énumère exactement ces familles ;
- elle est classée **Moyenne-faible** (aucune perte de code, aucune donnée
touchée) par la relecture indépendante, qui la renvoie explicitement à un
  correctif **ultérieur** ;
- la consigne de cette mission rejouée est de **ne rien réécrire** quand P3 est
  déjà livré. La traiter ici reviendrait à élargir une correction bornée,
  contre la consigne explicite.

Elle est donc **consignée, pas contournée** : le défaut résiduel est nommé,
localisé et reproductible, à traiter dans une mission dédiée. Elle est déjà
décrite côté spécifications sous **`spec_super_agent.md` § L2** (« La file des
**commandes manuelles** reste indexée par chemin brut », l. 2308-2325), avec le
correctif connu et non appliqué : faire passer `project-task-queue.js` par
`projectKey` avec repli sur les clés existantes (aucune migration).

**R-D (cosmétique) — libellé du volet Missions.** `missionProjectLabel`
(`super-agent.js` l. 2143-2146) dérive le libellé du **nom de dossier** de la
clé normalisée : un dossier écrit en majuscules peut s'afficher en minuscules.
C'est un affichage, pas une comparaison ; aucune file ni aucun verrou n'est
concerné. Non corrigé ici (même raison de périmètre borné).

### 8.5 P1 et P2

Non modifiés, non contournés. Leurs tests restent verts dans la suite complète
(`file-attente-*`, `verrou-*`, `regle-4-*`). Aucun commit n'a été produit par
cette re-vérification : `git status` ne montre **aucun** fichier de code
modifié, seulement ce rapport.
