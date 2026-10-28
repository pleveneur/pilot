# Rapport — chien de garde vs compilation (outil long et silencieux)

Date : 2026-10-28 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest)
Correctif : `.pilot/agent-stops.log` → 5 missions coupées, code produit bon.

---

## 1. Constat

Cinq missions d'agents ont été **libérées par le chien de garde** avec le message :

> Run libérée par le watchdog (porte : agents déclarés actifs mais plus aucun ne
> travaille (session fantôme ou inactive))

Inactivités mesurées au moment de la coupe : **5, 9, 11 et 18 minutes**. Pendant
ces fenêtres, les agents **compilaient le workspace Rust** (`desktop` +
`gds-core` + `gds-server`) : opération longue, légitime et **totalement
silencieuse** (aucun événement entre `tool_execution_start` et
`tool_execution_end`). Certaines missions ont livré et committé : **le code
n'était pas en cause**, c'est la **détection** qui se trompait de cible.

Preuve terrain (`.pilot/agent-stops.log`, projet `G:\IA_PL\pilot`, agent
`codeur`) : les 7 dernières lignes `detected=ghosts` (dont 4 le même jour entre
13:40 et 14:23). La porte fautive est bien **`ghosts`**, pas `noActive`.

## 2. Cause exacte

- Message : `src/js/agents-bus.js:223` (porte `ghosts`).
- Décision : `releaseStuckRunLockForKey`, `src/js/agents-bus.js:1029-1056`.

```js
const working = await anyActiveAgentWorking(key);
ghosts = !working && !(await projectHasWorkingSession(key));
```

La porte `ghosts` ne jugeait que sur la **sonde Rust** (`agent_activity_probe`).
Quand cette sonde ne porte pas la preuve — pas d'entrée d'anomalie pour la
session (session relancée, chemin de projet réécrit) ou entrée remise à zéro par
un événement de process — la session apparaissait « vivante mais sans preuve de
travail » : **verdict fantôme au milieu d'une compilation**.

`isAnyAgentWorking` / `isProjectWorking` (`src/js/exclusivity-queue.js`) savent
pourtant honorer `toolInProgress`… mais le bus, lui, **ne l'utilisait nulle
part** : le fait qu'il reçoive lui-même `tool_execution_start` (et toujours pas
son `tool_execution_end`) était ignoré. C'était la preuve manquante, disponible
localement, sans dépendre de la sonde.

## 3. Correction

Un **outil en cours est une activité de première classe** (aucune fenêtre de
silence à interpréter) :

- `src/js/agents-bus.js:725` : nouveau repère par run `toolInProgressByAgent`
  (agentId → instant du `tool_execution_start`), posé **avant** le retour
  anticipé des outils de lecture pure, levé par `tool_execution_end`,
  `agent_start`, `agent_end` final, `agent_settled` et la mort du process
  (`process_exit` / `process_error` / `extension_error`).
- `src/js/agents-bus.js:1029` : `toolRunning` rend **non concluantes** les deux
  portes ambiguës — `ghosts` (l.1039) et `orphanQueue` (l.1056). Une
  compilation, une suite de tests ou une installation en cours ne peuvent plus
  fonder une libération.
- `src/js/agents-bus.js:164-198` : pures exportées `TOOL_IN_PROGRESS_MAX_MS`,
  `toolOperationLost`, `isAnyToolInProgress`.

**Aucun délai rallongé au hasard, aucun chiffre inventé** : la seule borne est
celle qui existe déjà côté moteur (`anomaly::TOOL_IN_PROGRESS_MAX_SUSPEND_SECS`,
60 min, correctif `adfb20b`) — au-delà, un `tool_execution_end` perdu est réputé
perdu, sinon un marqueur coincé retiendrait un verrou à vie. Un repère sans
horodatage est traité comme perdu (fail-safe anti-blocage).

**Le chien de garde n'est pas désactivé** : une vraie session fantôme (agent
mort, processus sorti, agent au repos sans outil) est toujours coupée.

## 4. Tests

`src/js/chien-de-garde-compilation.test.js` (11 tests, aucun chiffre figé : les
durées sont recalculées depuis les constantes) :

| Exigence | Test |
|---|---|
| outil long en cours → ne pas couper | compilation en cours, sonde muette → run MAINTENUE ; lecture longue → MAINTENUE |
| agent mort sans outil en cours → couper | témoin sans outil → LIBÉRÉE ; agent mort pendant l'outil → repère levé, LIBÉRÉE |
| activité récente → ne pas couper | événement récent + plancher d'inactivité → MAINTENUE |

```
npx vitest run src/js/chien-de-garde-compilation.test.js  → PASS (11) FAIL (0)
npx vitest run (suite complète)                           → PASS (4122) FAIL (0)
```

Aucune compilation Rust n'a été lancée (interdit de la mission : c'est
précisément ce qui fait couper la mission).
