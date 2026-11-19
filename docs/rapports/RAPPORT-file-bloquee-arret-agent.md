# Rapport — la file d'un projet restait bloquée après l'arrêt d'un agent

## En cinq lignes (lecture non technique)

Chaque projet garde une file d'attente pour ses agents. Quand on arrêtait un agent en cours de
travail, la demande qui attendait derrière lui devenait impossible à relancer — mais elle restait
dans la file, à la première place. Toutes les demandes suivantes se rangeaient derrière elle et
n'étaient plus jamais lancées : la même demande partait tout de suite sur un autre projet, ici elle
restait « en attente » à vie. La correction fait simplement passer les demandes qui attendent
derrière une demande morte ; la demande morte, elle, reste conservée et signalée, jamais exécutée
pour une autre mission.

## 1. Le symptôme, tel qu'il a été vécu

Sur un projet donné, après avoir **arrêté** l'agent qui y travaillait :

- aucune session n'apparaissait plus en train de travailler sur ce projet ;
- la file du projet semblait vide ;
- toute nouvelle demande sur **ce** projet restait « en attente » et ne démarrait jamais ;
- la **même** demande lancée sur un **autre** projet démarrait immédiatement ;
- seul un redémarrage de Pilot semblait rendre le projet utilisable.

Constat reproduit deux fois par le propriétaire sur sa machine. Ce constat (règle 1) fait foi.

## 2. La reproduction automatique (avant correction : le test échouait)

Fichier : `src/js/file-bloquee-par-tete-sans-proprietaire.test.js` (nouveau, deux cas).

Le test n'imite pas la logique : il passe par le **vrai** bus (`agents-bus.js`), avec le harnais
déjà utilisé par `file-attente-regle-4.test.js` et `verrou-de-run-bloque-la-file.test.js`.

Scénario rejoué, dans l'ordre :

1. une demande **A** démarre sur le projet (agent `lecteur`) ;
2. l'agent étant déclaré occupé, une demande **B** est mise **en file** avec pour propriétaire la
   run qui l'a mise en file (`ownerRunKey`) ;
3. **arrêt de l'agent** : la run propriétaire est terminée (`endRun`) — la file, elle, vit au
   niveau du **projet** et survit (c'est la RÈGLE 4 : une demande ne disparaît jamais en silence) ;
4. une nouvelle demande **C** arrive ; l'agent étant toujours déclaré occupé sur ce projet, elle est
   empilée **derrière** B ;
5. le rejeu de file est déclenché (`launchNextQueuedForProject`).

Résultat **avant** correction : `reason = "owner-gone"`. La demande C — dont le propriétaire est
**vivant** — n'était jamais lancée, ne serait-ce qu'une fois, et restait en file sans aucun
message. C'est exactement le symptôme rapporté. Le second cas du test vérifie que la demande morte
reste en file, n'est signalée qu'une fois et n'est **jamais** exécutée hors de son contexte.

## 3. La cause exacte

Fichier : `src/js/agents-bus.js`, fonction `launchNextQueued(agentId, project, runKeyOverride)`
(appelée par `launchNextQueuedForProject`, le drain `drainExclusivityQueues` et la fin de tour).

Le code d'origine ne regardait **que la tête** de la file :

```js
const head = (queue[qk] || [])[0];
if (!head) return { launched: false, reason: "no-demand" };
const ownerCtx = busState.runs[head.ownerRunKey || callerKey];
const placement = decideQueuedDemandPlacement({ ownerKey: head.ownerRunKey || "", ownerAlive: !!ownerCtx });
if (placement.placement !== "launch" || !ownerCtx) {
  // … on signale, on CONSERVE l'entrée…
  return { launched: false, reason: QUEUE_REFUSED_OWNER_GONE };
}
const next = dequeueExclusivity(queue, agentId, project); // ← toujours la TÊTE
```

Trois faits se combinent :

1. la file d'exclusivité est indexée par **projet** (`exclusivityQueueOfProject`), donc elle
   **survit** à la destruction du contexte de run (voulu : RÈGLE 4) ;
2. après un arrêt, `busState.runs[head.ownerRunKey]` n'existe plus : la tête est **inexécutable par
   construction** (la lancer dans un autre contexte livrerait le rapport à la mauvaise mission) ;
3. `launchNextQueued` **s'arrêtait là**. Elle ne parcourait jamais les entrées suivantes, et
   `dequeueExclusivity` ne sait retirer que la tête.

Conséquence : une seule entrée morte en tête rendait le couple **(projet, agent)** définitivement
inutilisable. Chaque nouvelle demande du même couple venait se ranger derrière elle, à chaque
passage le rejeu refusait sur cette même tête, et rien ne le disait à l'utilisateur. Les autres
projets n'ont pas cette entrée morte → ils démarrent normalement, ce qui explique le contraste
observé.

À noter : le verrou de run, lui, était bien libéré (correctifs antérieurs, invariants A/B de
`verrou-de-run.js`). Le blocage n'était donc **pas** un verrou de run, mais **la file elle-même** —
ce qui explique aussi pourquoi le projet paraissait libre et la file « vide » à l'écran.

## 4. La correction (minimale, à la cause)

- `src/js/exclusivity-queue.js` : nouvelle fonction pure `dequeueExclusivityEntry(queue, agentId,
  project, entry)` — retire une entrée **précise**, sans supposer qu'elle est en tête (mutate,
  supprime la clé si la file devient vide).
- `src/js/agents-bus.js`, `launchNextQueued` : la fonction **parcourt** la file dans l'ordre et
  choisit la **première entrée exécutable** (propriétaire vivant). Les entrées mortes sont
  signalées **une seule fois** (journal des arrêts `queue-replay-no-owner` + notification, comme
  avant) et **restent en file** ; elles ne barrent plus la suite. S'il n'existe **aucune** entrée
  exécutable, le verdict est le même qu'avant : `owner-gone`, refus rendu à l'appelant, verrou non
  conservé, entrées conservées.

Rien d'autre n'est touché : ni la décision de placement (`decideQueuedDemandPlacement`), ni le sort
du verrou de run (`decideRunLockAfterDrain`), ni l'ordre d'arrivée, ni les demandes mortes.

Cycle normal vérifié : demande → agent démarre → le tour se termine → la demande suivante démarre
(les tests de file d'attente et de verrou existants restent verts, voir § 5).

## 5. Preuve par les tests

| État | Tests front | Résultat |
|---|---|---|
| Code d'origine, sans le nouveau test | 6 128 | 0 échec |
| Code d'origine **avec** le test de reproduction | 6 129 | **1 échec** (`expected 'owner-gone' not to be 'owner-gone'`) |
| Code corrigé, avec le test | **6 130** | **0 échec** |

Commandes :

```bash
npx vitest run src/js/file-bloquee-par-tete-sans-proprietaire.test.js   # 2/2 après correction
npx vitest run --exclude="**/file-bloquee-par-tete-sans-proprietaire.test.js"  # 6128, 0 échec
npx vitest run                                                            # 6130, 0 échec
```

Aucun test existant n'a été modifié ni desserré. Aucun fichier Rust n'a été touché : la suite Rust
n'est pas concernée par ce correctif (non exécutée pour cette raison).

## 6. Ce qui n'est pas établi

- **Non établi** : que ce mécanisme soit la cause des **deux** occurrences sur la machine du
  propriétaire. C'est la seule cause de blocage « à vie » que le code permette de démontrer de
  bout en bout, et elle reproduit exactement le symptôme — mais aucune trace de sa machine (état
  de la file au moment du blocage) n'a été relevée.
- **Non établi** : pourquoi un redémarrage de Pilot était nécessaire plutôt qu'une reprise
  spontanée. Le rejeu existe (fin de tour, balayage toutes les 30 s avec une grâce de 60 s et un
  plancher d'inactivité de 2 min), et il aurait dû finir par repasser. Il repassait bien, mais sur
  la tête morte : il refusait. Le redémarrage vidait la mémoire, donc la file. Une autre cause
  (rejeu jamais déclenché) n'est pas exclue.
- **Non mesuré** : le délai réel entre l'arrêt de l'agent et la reprise de la file sur la machine
  du propriétaire (aucune instrumentation en place).
- **Non mesuré** : le cas où la nouvelle demande n'est **pas** mise en file (aucune session de
  l'agent déclarée sur ce projet). Dans ce cas elle démarre directement et le défaut ne se
  manifeste pas : s'il se manifestait quand même, la cause serait ailleurs.

## 7. Fichiers touchés

- `src/js/agents-bus.js` — parcours de la file dans `launchNextQueued` (+ commentaire de défaut).
- `src/js/exclusivity-queue.js` — `dequeueExclusivityEntry` (retrait ciblé, pur).
- `src/js/file-bloquee-par-tete-sans-proprietaire.test.js` — reproduction + non-régression de la
  RÈGLE 4.
