# CORRECTION 4 — contrôle négatif étendu aux deux derniers fichiers d'agents

Date : 2026-10-20 (relance de la mise en file)
Périmètre : `src/js/agent-stop-trace-paths.test.js` (seul fichier modifié).
Production d'arrêt : **non touchée** (aucun chemin d'arrêt modifié, aucun IPC).
Détecteur de production (`agent-stop-funnel.js`) : **non modifié**.

## 0. État à la reprise

La mise en file précédente était annoncée comme perdue. Vérification faite sur
le disque : le gros du travail était **déjà présent et committé** (`cadb9d2`,
« test(règle 3): contrôle négatif étendu aux sites muets dans un bloc déjà
tracé (agent-pi, super-agent) »), et le rapport existait déjà. Rien n'a été
refait à l'identique : cette reprise (a) **vérifie indépendamment** que le
contrôle livré est bien porteur (mutation, hors projet), (b) **comble le trou de
preuve restant** — le contrôle livré ne démontrait nulle part que la règle
resserrée est *ce qui* le fait rougir — et (c) met le présent rapport à jour.

## 1. Constat de départ (audit)

La matrice « aucun arrêt automatique sans trace » lit trois fichiers
(`agents-bus.js`, `agent-pi.js`, `super-agent.js`), mais son **contrôle négatif**
n'injectait un site terminal muet que dans `agents-bus.js`, et **toujours avant
un en-tête de fonction** : le site injecté tombait dans une fonction NEUVE, sans
aucune trace. Pour `agent-pi.js` et `super-agent.js`, la non-vacuité reposait
uniquement sur des **comptes** de sites épinglés.

Le cas **réellement dangereux** — un site d'arrêt muet ajouté **à l'intérieur
d'un bloc qui contient déjà une trace** (deux arrêts partageant une seule
trace) — n'était éprouvé nulle part.

## 2. Ce que le contrôle a révélé (résultat utile)

Les tests écrits **sans** toucher au détecteur ont rougi :

```
AssertionError: le détecteur doit voir le site muet injecté DANS un bloc déjà
tracé (agent-pi.js / abort_agent): expected [] to deeply equal [ 301400 ]
AssertionError: ... (super-agent.js / abort_super_agent): expected [] to deeply equal [ 171967 ]
```

Le détecteur de précédence (`precedences` + `enclosingFunctionBlock`) **ne
voyait aucun des deux sites injectés** : sa règle était « une trace existe
quelque part avant le site, dans la même fonction ». Une trace unique
« blanchissait » donc **tous** les arrêts suivants du même bloc.

## 3. Correction minimale du détecteur (dans le test, uniquement)

`precedences` exige qu'une trace ne couvre **qu'UN SEUL arrêt** : celui qui la
suit **immédiatement** dans le bloc (aucun autre arrêt de la même famille entre
les deux).

```js
const previousSite = i > 0 ? sites[i - 1] : -1;
const owners = before.filter((t) => t > previousSite);
```

Aucun autre changement : portée de bloc (`enclosingFunctionBlock`), fenêtre
`maxDistance`, exceptions nommées (`R3-EXCEPTION-MANUEL`) inchangées.

Effet de bord **bénéfique** sur `agents-bus.js` : l'arrêt **manuel** « tout
arrêter » n'est plus compté comme « tracé » par simple proximité avec la trace
de l'arrêt automatique du même bloc ; il est classé en **exception nommée**. Le
contrôle négatif existant est passé de « 4 tracés » à « 3 tracés + 1 exception »,
et le **compte d'exceptions y est désormais épinglé** : le contrôle est
resserré, pas affaibli.

## 4. Tests ajoutés (`src/js/agent-stop-trace-paths.test.js`)

1. `contrôle négatif étendu : un site muet injecté DANS un bloc déjà tracé est
   vu (agent-pi)` — après la trace de boucle de réflexion (`detected: "text"`)
   → `invoke("abort_agent")` muet ; après la trace `quality-gate-toggle` →
   `invoke("stop_agent_session")` muet.
2. `contrôle négatif étendu : un site muet injecté DANS un bloc déjà tracé est
   vu (super-agent)` — après `detected: "tool-calls"` et après `detected: "text"`
   + `agentId: "assistant"`.
3. `contrôle négatif inverse : sur les sources RÉELLES, aucun site n'est accusé
   à tort` — 5 vérifications (agent-pi × 2 familles, super-agent × 2 familles,
   agents-bus) : cardinalité, tracés, exceptions nommées, `untraced === []`.
4. **(ajouté à la reprise)** `non-vacuité : sans la règle « une trace ne couvre
   qu'un arrêt », les sites muets injectés passeraient inaperçus` — rejoue les
   **quatre** sources injectées avec la variante HISTORIQUE du détecteur
   (`naiveCoverage: true`, option interne réservée à ce test) puis avec la règle
   actuelle :
   - historique : `untraced === []` (aveugle) ;
   - actuelle : `untraced === [position injectée]` (exactement le site muet).
   Ce test est la **preuve directe** que la règle resserrée est ce qui fait
   rougir la matrice pour ces deux fichiers : si elle était retirée, le test
   échoue (mutation vérifiée, § 6).

Chaque injection :

- se fait dans une **copie en mémoire** (`src.slice(...)`), jamais écrite sur
  disque — aucun fichier temporaire n'est créé dans le projet ;
- vérifie que l'ancre existe **et est unique** (`split(marker).length - 1 === 1`,
  ajouté à la reprise : le rapport précédent l'annonçait sans le faire) ;
- **prouve** que le site injecté est dans un bloc qui contient **déjà** une trace ;
- exige que le **seul** site signalé soit le site injecté (égalité stricte de
  position), donc qu'aucun site réel ne soit accusé à tort ;
- épingle `sites = réels + 1`, `traced` et le nombre d'exceptions réels.

## 5. Vérifications (reprise)

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/agent-stop-trace-paths.test.js` | **23 tests passés**, 0 échec (22 avant la reprise) |
| `npm test` (suite complète) | **120 fichiers / 2056 tests passés**, 0 échec |
| `npm run build` | build OK, **aucun nouvel avertissement** (seuls les avertissements préexistants de découpage de chunks / imports dynamiques) |
| Sources lues en `\n` normalisé (`.replace(/\r\n/g, "\n")`) | contrôle valable sur un worktree CRLF (CI Windows) |

## 6. Preuve de non-vacuité (mutation, hors projet)

Mutation appliquée : `owners = opts.naiveCoverage ? … : before.filter(…)` →
`owners = before` (règle « une trace ne couvre qu'un arrêt » retirée).

```
Test Files  1 failed (1)
Tests       5 failed | 18 passed (23)
```

Les 5 tests qui rougissent sont exactement les contrôles du cas « site muet dans
un bloc déjà tracé » : les deux injections `agent-pi`, les deux injections
`super-agent` et le test de non-vacuité. La règle est donc **portée** par les
tests, et non décorative. Fichier restauré immédiatement après la mesure
(vérifié : suite de nouveau verte, diff conforme).

## 7. Fichiers touchés

- `src/js/agent-stop-trace-paths.test.js` (+52 / −2 sur cette reprise :
  option `naiveCoverage` documentée, unicité de l'ancre, test de non-vacuité).

Rien d'autre : ni `agent-pi.js`, ni `super-agent.js`, ni `agents-bus.js`, ni
`agent-stop-funnel.js`, ni `agent-stop-trace.js`. Aucune publication, aucun tag,
aucun `git push`.
