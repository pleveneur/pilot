# Rapport — l'indicateur de travail ne lit plus la fenetre de 2 minutes

> Correction cote INTERFACE uniquement. Aucun fichier Rust touche
> (`agent_service.rs`, `dashboard.rs`, `anomaly.rs` inchanges).

## Cause (en une phrase)

`agent_service.rs` publie `isWorking = vrai` pendant 120 s apres la fin d'un
tour (`WORKING_RECENT_WINDOW_SECS`) alors que le meme etat publie deja
`state: "idle"` : l'interface prenait `isWorking` comme verite du travail et
faisait donc « respirer » la barre de saisie de l'assistant et les pastilles
pendant 2 minutes sans aucun travail.

## Fichiers touches

| Fichier | Nature |
|---|---|
| `src/js/agent-activity.js` | code : la fenetre de 2 min sort de la verite d'affichage |
| `src/js/agent-activity.test.js` | tests : 2 cas ajoutes + 1 assertion corrigee |
| `spec_dashboard.md` | doc : la regle d'affichage decrite est mise a jour |

Aucun autre fichier. `help/handbook.md` a ete regenere puis **remis a l'identique**
(seul l'horodatage de generation changeait) : il n'est pas dans le commit.

## Modifications exactes

### `src/js/agent-activity.js`

1. `flattenAgents` — avant (l. 142-143) :

```js
      const isWorkingFlag = a.isWorking === true;
      const working = busy || toolInProgress || isWorkingFlag;
```

apres (l. 146-147) :

```js
      const toolInProgress = a.toolInProgress === true;
      const working = busy || toolInProgress;
```

2. `isAgentWorking` — avant (l. 254-263) :

```js
    agent.working === true ||
    agent.busy === true ||
    agent.toolInProgress === true ||
    agent.isWorking === true
```

apres (l. 259-264) :

```js
    agent.working === true ||
    agent.busy === true ||
    agent.toolInProgress === true
```

(`agent.working` reste : c'est le resultat deja calcule par `flattenAgents`,
donc la meme regle, sans fenetre de temps.)

3. Commentaires : celui de `flattenAgents` (l. 136-145) et la doc de
`isAgentWorking` (l. 245-256) decrivent desormais la regle reelle — le travail
se lit sur l'ACTIVITE REELLE (`busy` / `toolInProgress`), jamais sur une fenetre
de temps — et expliquent pourquoi `isWorking` est volontairement ignore (il
reste publie pour les sondes).

### `src/js/agent-activity.test.js`

- Assertion devenue fausse corrigee (elle verrouillait l'ancien comportement) :
  `expect(isAgentWorking({ busy: false, isWorking: true })).toBe(true)` est
  **supprimee** — ce cas est desormais couvert, en negatif, par le nouveau test.
  Ce test etait faux au regard de la nouvelle regle : il affirmait qu'une
  session au repos dont la seule activite date de moins de 2 min « travaille ».
- Nouveau test `la fenetre « actif recemment » (isWorking) n'est PAS du travail` :
  etat `{ state: "idle", alive: true, busy: false, toolInProgress: false,
  isWorking: true }` → `isAgentWorking` **faux**, `anyBusy` **faux**, et sur la
  liste aplatie : `working === false`, `workingSince === null`,
  `isWorkingWithoutTab === false`.
- Nouveau test `un agent REELLEMENT au travail s'allume toujours` :
  `busy: true` → `isAgentWorking` / `working` / `anyBusy` **vrais**, puis
  `busy: false` + `toolInProgress: true` (outil long silencieux) → toujours
  **vrais** (l'indicateur utile n'est pas eteint).

Preuve du rouge avant correction : l'ancienne logique a ete reintroduite
temporairement dans `agent-activity.js` (2 lignes), le fichier de test a ete
relance → **1 failed | 100 passed**, puis le fichier corrige a ete restaure
(octet pour octet) → **101 passed**. Aucune commande Git de nettoyage ou de
reinitialisation n'a ete utilisee (copie de fichier + `git show HEAD:... >` pour
la spec).

## Resultats exacts des tests

| Commande | Resultat |
|---|---|
| `npx vitest run src/js/agent-activity.test.js` | **PASS (101) FAIL (0)** |
| `npx vitest run` (suite complete) | **PASS (2815) FAIL (0)**, code de sortie **0** |

Aucun test existant ne s'est mis a echouer a cause du changement : la seule
assertion qui s'appuyait sur la fenetre de 2 min est celle citee ci-dessus, et
elle a ete corrigee en connaissance de cause.

## Appelants verifies (aucun ne s'appuie sur l'ancien comportement)

`isAgentWorking` / `anyBusy` / la liste aplatie dans `src/js/` :

| Appelant | Usage | Verdict |
|---|---|---|
| `agent-activity.js:234` `anyBusy` | `list.some(isAgentWorking)` | regle unique, OK |
| `agent-activity.js:613` `buildRunningMissions` | volet « Taches » (missions en cours) | OK : un agent au repos n'a plus de mission fantome |
| `agent-activity.js:728-729` `activityRefresh` | `currentActivityBusy = anyBusy(list)` (store partage) | OK |
| `agent-activity.js:858` `renderDropdown` | pastille `breathing` | OK |
| `agent-activity.js:868` `renderCard` | libelle « Travail »/« Repos » + « En cours depuis » | OK |
| `agent-activity.js:272` `isWorkingWithoutTab` | badge « travail sans onglet » | OK |
| `agent-activity.js:835-842`, `:952-...` | montage du panneau / poignee immersive | OK |
| `super-agent.js:3099` (via `subscribeAgentActivity`) | `agentsWorkingActive` → `superagent-input-reflecting` (barre de saisie) | OK : c'est le defaut corrige |
| `super-agent.js:2535`, `:2499` | volet « Taches » du panneau (`buildRunningMissions`) | OK |
| `agents-ui.js:189` | panneau « Activite » de l'onglet Agents (`buildBackgroundWorkMissions`) | OK |
| `main.js:281`, `:301`, `:317` | sonde de la fenetre de mise a jour (blocage + reexamen + « qui bloque ») | OK : ne bloque plus sur une fenetre de 2 min |

**Consommateur qui, lui, a reellement besoin de « actif recemment » et qui n'a
PAS ete touche** : `src/js/exclusivity-queue.js:192` `isSessionWorking`
(fenetre `RECENT_ACTIVITY_WINDOW_MS` = 2 min) — sonde de la file d'exclusivite
des runs. C'est une autre fonction, independante de `isAgentWorking`, et la
mission interdisait de toucher la logique de file d'attente : elle est laissee
telle quelle. `spec_super_agent.md:2540` decrit `isWorking` cote backend comme
« meme regle que `isSessionWorking` » : cette phrase reste exacte (Rust
inchange).

## Documentation

- `spec_dashboard.md` (§ Supervision des agents P8) decrivait la regle
  d'affichage comme `busy` OU `toolInProgress` OU `isWorking` : c'etait
  exactement la regle « actif dans les 2 dernieres minutes » appliquee a
  l'affichage. **Mise a jour** : la verite est `busy` OU `toolInProgress`,
  `isWorking` est explicitement exclu de l'affichage et reste publie pour les
  sondes.
- Aucune autre spec ne decrit cette fenetre comme comportement attendu
  (`grep` sur « 2 min », « 120 s », « 120 secondes », « isWorking », « derniere
  activite » dans les `.md` de la racine et `docs/`). Les occurrences restantes
  concernent d'autres sujets (timeout d'inactivite du codeur, balayage de
  verrous, delai de notification) ou le backend Rust (inchange).
- A signaler : `RAPPORT-diag-indicateur-travail.md` (ancien rapport de
  diagnostic, non une spec) affirme en §E que la semantique
  `anyBusy = busy || toolInProgress || isWorking` est « voulue… ne pas la
  corriger ». Cette position est **remplacee** par la decision du proprietaire
  qui fonde cette tache. Le fichier n'a pas ete modifie (hors perimetre), mais
  il est desormais contredit par le code : a archiver ou annoter si souhaite.

## Ce qui reste a faire

- Verification visuelle en application (`npm run tauri dev`) : lancer une
  demande a l'assistant, attendre la fin du tour, verifier que la barre de
  saisie et la pastille s'eteignent **immediatement** (au lieu de 2 min), puis
  relancer une tache longue (`cargo test`) et verifier qu'elles restent
  allumees pendant l'outil.
- Decision eventuelle (hors perimetre) : supprimer cote Rust la fenetre
  `WORKING_RECENT_WINDOW_SECS` si plus aucune sonde ne l'utilise, ou la garder
  comme information d'affichage « derniere activite ».
- Relecture du sort de `RAPPORT-diag-indicateur-travail.md` §E (contredit).

## VERDICT

**Corrige.** `state: idle` + `isWorking: true` = repos pour toute l'interface
(barre de saisie de l'assistant, pastilles, missions en cours, sonde de mise a
jour), tandis qu'un agent reellement au travail (reponse en cours ou outil long)
allume toujours l'indicateur. 2815 tests verts, 0 echec.
