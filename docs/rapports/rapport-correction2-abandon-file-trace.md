# CORRECTION 2 — une file d'attente vidée laisse TOUJOURS une trace

Date : session courante (après v0.4.33) · Périmètre : file d'attente de l'Assistant
(`super-agent.js`) · Aucune publication, aucun tag, aucun push.

## 1. Problème constaté (audit en lecture seule)

Deux fonctions de `src/js/super-agent.js` vidaient une file **sans rien
journaliser** :

| Fonction | Zone (avant) | Comportement avant |
|---|---|---|
| `abandonProjectMissionQueue` | l. 558 | `queue.length = 0` + `delete`, renvoie un décompte |
| `abandonProjectDelegationQueue` | l. 638 | `queue.length = 0`, renvoie un décompte |

La trace n'existait que chez leur **unique appelant** (`abandonProjectQueue` dans
`project-queue-view.js`, via `journalAbandonedFamily`). Tout nouveau chemin
d'appel (chien de garde, arrêt, vue distante) aurait donc vidé une file **en
silence** — exactement ce que la règle « une file ne se perd jamais sans trace »
interdit. Les variantes déjà traçantes existaient à côté :
`abandonQueuedRunAgentsMissions` et `abandonQueuedDelegations`.

## 2. Appelants recensés (recherche EXHAUSTIVE avant toute modification)

`grep` sur `src/`, `web/`, `*.rs`, `*.md` (hors `node_modules`, `dist`, wiki généré) :

- **Production** : `src/js/project-queue-view.js` uniquement (l. 151 et 155, dans
  `abandonProjectQueue`, appelée par `/file vide` — `agent-pi.js` l. 1285).
  **Aucun autre appelant**, ni dans l'UI web distante, ni côté Rust.
- **Tests** : `src/js/project-queue-wiring.test.js` (nouveaux tests) et les
  assertions de source de `file-attente-regle-4.test.js` / `verrou-par-projet.test.js`
  — ces deux derniers visent les variantes *tracées*, inchangées.

## 3. Solution retenue : un point d'écriture UNIQUE

Nouvelle fonction privée dans `super-agent.js` :

```js
function traceQueueAbandon({ project, family, labels, reason, detected })
```

- écrit **une ligne par famille** (`N <famille>(s) en file : libellé1 · libellé2`),
  motif nommé (`reason`, défaut `queue-abandoned`) et contexte (`detected`) ;
- **repli global** `<app_data_dir>/agent-stops.log` pour un espace réservé
  (`__assistant__`) — comportement conservé ;
- **fail-open** : un journal impossible à écrire ne bloque jamais un abandon ;
- c'est le **seul** `traceAutomaticAgentStop` d'abandon de file : les quatre
  chemins d'abandon y passent, donc plus aucune duplication ni oubli possible.

Les deux fonctions deviennent traçantes **elles-mêmes**, sans changer de
signature ni de nature (toujours synchrones, toujours un décompte `number`) :

```js
abandonProjectMissionQueue(projectPath, opts = {})      // → number
abandonProjectDelegationQueue(projectPath, opts = {})   // → number
```

Elles **nomment avant de vider** (comme les variantes tracées :
`missionQueueLabel` pour les missions, `request` borné à 120 car. pour les
délégations) puis laissent l'écriture du journal suivre en tâche de fond
(fire-and-forget) : le décompte reste immédiatement disponible pour l'affichage.

Les variantes asynchrones (`abandonQueuedRunAgentsMissions`,
`abandonQueuedDelegations`) réutilisent le même point d'écriture — elles gardent
leur `await` (donc l'ordre « trace avant retour/arrêt » est préservé) et leur
notification utilisateur, inchangées.

## 4. Absence de double écriture

- `project-queue-view.js` ne journalise plus que la famille **commandes**
  (`journalAbandonedFamily(target, "commande", …)`) ; les appels
  `journalAbandonedFamily(…, "mission", …)` et `…, "délégation", …` sont
  **supprimés**, ainsi que les pré-lectures devenues inutiles
  (`pendingMissions`, `pendingDelegations`).
- Les deux appels passent leur contexte : `{ detected: "file-vide" }`. Le journal
  de `/file vide` est donc **identique à l'octet près** à ce qu'il était
  (`reason=queue-abandoned`, `detected=file-vide`, `1 <famille>(s) en file : …`).
- Décomptes et libellés affichés dans le panneau de file : **inchangés**.
- Preuve par test : `1 ter. … "aucune DOUBLE écriture : une seule ligne par
  famille abandonnée"` (une famille peuplée → **1** ligne exactement, puis file
  vide → **0** ligne).

## 5. Tests ajoutés (`src/js/project-queue-wiring.test.js`, bloc « 1 ter »)

Appels **DIRECTS**, sans passer par l'appelant habituel :

1. mission orpheline → `abandonProjectMissionQueue(PROJECT)` renvoie `1`, la file
   est vidée, et **une** ligne est écrite dans le journal du projet, contenant
   `reason=queue-abandoned` et le libellé `mission orpheline` ;
2. délégation orpheline → idem avec `abandonProjectDelegationQueue` et le
   libellé `délégation orpheline` ;
3. anti-double-écriture (comptage exact des écritures, cf. § 4).

Test existant « trace par fichier épinglée » (`agent-stop-trace-paths.test.js`) :
la cardinalité des points de trace de `super-agent.js` passe de **5 à 4**
(3 arrêts automatiques + **1** point unique d'abandon de file) — c'est la
conséquence directe de la factorisation, commentée sur place. Les 4 appels
`stopAgentWithTrace`/`traceAutomaticAgentStop` restants sont intacts.

## 6. Anti-vacuité (production neutralisée puis restaurée)

Neutralisation temporaire de `traceQueueAbandon` (`return undefined;` en tête de
fonction, fichier restauré ensuite — vérifié : 0 occurrence du marqueur) :

```
PASS (12) FAIL (7)
  AssertionError: file de missions vidée SANS trace (l'appelant n'est plus le garant): expected [] to have a length of 1 but got +0
  AssertionError: un vidage muet du journal (familles perdues sans trace): expected [ … ] to have a length of 3 but got 1
  AssertionError: expected '' to contain 'detected=stop-agent'
```

Les trois nouveaux tests **rougissent**, ainsi que les tests de file existants :
la couverture est réelle.

## 7. Vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/project-queue-wiring.test.js` | PASS (19) — après restauration |
| `npx vitest run project-queue-wiring + agent-stop-trace-paths + file-attente-regle-4` | PASS (48) FAIL (0) |
| `npm test` (suite complète) | **120 fichiers / 2052 tests — 0 échec** |
| `npm run build` | OK (warnings préexistants : imports dynamiques, taille de chunk) |

Quality-gate : fichiers relus en entier (`super-agent.js` zones modifiées,
`project-queue-view.js` entier, tests), points de connexion vérifiés (imports,
exports, appelants, aucun renommage de fonction publique, aucune commande Rust
touchée), fins de ligne LF préservées, aucune référence externe à mettre à jour
(l'aide intégrée promettait déjà cette trace : la promesse est désormais
structurelle, rien à changer côté utilisateur).

## 8. Fichiers modifiés

- `src/js/super-agent.js` — point unique `traceQueueAbandon` + les deux fonctions
  d'abandon qui journalisent elles-mêmes (+ variantes tracées branchées dessus).
- `src/js/project-queue-view.js` — suppression de la journalisation des familles
  missions/délégations (anti-double-écriture), contexte `detected: "file-vide"`.
- `src/js/project-queue-wiring.test.js` — bloc « 1 ter » (3 tests).
- `src/js/agent-stop-trace-paths.test.js` — cardinalité de trace épinglée 5 → 4
  (commentée).

Hors périmètre volontairement : marqueurs d'arrêt de l'onglet agent et matrice de
vérification (autres missions de l'audit).
