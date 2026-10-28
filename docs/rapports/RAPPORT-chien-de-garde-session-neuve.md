# Rapport — le chien de garde tuait les sessions NEUVES

**Date** : 2026-10-28
**Nature** : correction d'un faux positif du chien de garde (porte `ghosts`)
**Périmètre** : `src/js/exclusivity-queue.js`, `src/js/agents-bus.js` (+ tests JS)
**Aucune compilation Rust, aucun `cargo`** (consigne de la mission) : le domaine
est le front, la sonde Rust n'a pas été touchée.

---

## 1. Preuve au journal (`.pilot/agent-stops.log`, 2026-10-28)

Trois lignes datées, prises telles quelles (fichier du projet) :

```
598: 2026-10-28T14:22:42.942Z  op=auto-stop  reason=watchdog-release  detected=ghosts  agent=codeur  project=G:\IA_PL\pilot  uid=75
599: 2026-10-28T14:22:53.119Z  op=auto-stop  reason=stale-session-restart  detected=fresh-context  agent=codeur  project=G:\IA_PL\pilot  uid=none  detail=Session agent_process d'une run précédente arrêtée pour forcer un contexte vierge.
600: 2026-10-28T14:23:17.203Z  op=auto-stop  reason=watchdog-release  detected=ghosts  agent=codeur  project=G:\IA_PL\pilot  uid=76
```

Lecture : la ligne 599 est le **démarrage d'une session neuve** (redémarrage à
contexte vierge : `keep_context` n'est pas vrai pour `codeur`, donc chaque mission
repart d'une session neuve). **24 secondes plus tard** (ligne 600), la porte
`ghosts` déclare cette session neuve « fantôme » et coupe la mission.

Le même cycle se répète dans la même journée, à des durées de vie de session
toujours plus courtes :

```
594: 2026-10-28T13:52:18.617Z  reason=watchdog-release  detected=ghosts  uid=71
595: 2026-10-28T13:52:28.448Z  reason=stale-session-restart  detected=fresh-context
596: 2026-10-28T14:04:13.189Z  reason=watchdog-release  detected=ghosts  uid=72
597: 2026-10-28T14:04:24.580Z  reason=stale-session-restart  detected=fresh-context
602: 2026-10-28T14:30:03.484Z  reason=watchdog-release  detected=ghosts  uid=77
603: 2026-10-28T14:30:13.308Z  reason=stale-session-restart  detected=fresh-context
605: 2026-10-28T14:33:35.647Z  reason=watchdog-release  detected=ghosts  uid=78
606: 2026-10-28T14:33:37.874Z  reason=stale-session-restart  detected=fresh-context
```

Deuxième constat : le compteur `uid` **augmente à chaque ligne `ghosts`**
(75 → 76 → 77 → 78). Chaque session était donc bien **créée** (le bus avait un
`uid` de spawn en main) et mourait peu après. Ce n'est pas un verrou orphelin :
c'est un verrou dont la session est **jeune**.

---

## 2. Cause exacte

### 2.1 La décision « cette session travaille-t-elle ? » ignore l'âge de la session

`src/js/exclusivity-queue.js:192` — `isSessionWorking` :

- `alive !== true` → `false` (session absente/morte) ;
- `toolInProgress` → `true` ;
- `busy` → `true` (sauf busy-stale) ;
- sinon `!session.lastActivity` → **`false`** (ligne `203`), et une
  `lastActivity` plus vieille que 2 min → `false`.

Une session **qui vient d'être créée n'a encore émis aucun événement** : ni
`busy`, ni `lastActivity`. Elle tombe donc dans le dernier cas et est déclarée
« ne travaille pas ». C'est exactement l'état d'une session à `t+1 s`.

### 2.2 Trois sondes muettes ⇒ porte `ghosts`

`src/js/agents-bus.js:1039` :

```js
ghosts = !working && !toolRunning && !(await projectHasWorkingSession(key));
```

À `t+24 s` : pas d'outil encore lancé (`toolRunning` faux), la sonde d'activité
ne porte aucune preuve (`working` faux, cf. 2.1), et la sonde projet-large est
muette pour la même raison. Les trois « non » fabriquent un fantôme.

### 2.3 Le garde-fou existant ne pouvait pas voir la jeunesse de la SESSION

Deux raisons cumulatives, et c'est la deuxième qui est structurelle :

1. Le plancher d'inactivité est **optionnel** :
   `src/js/agents-bus.js:1012`
   `const requireIdleMs = Number(opts && opts.requireIdleMs) > 0 ? … : 0;`.
   Un appelant qui ne le passe pas (les appels de fin/relance de
   `super-agent.js:7457`, `8306`, `8337`) mesure donc **zéro** inactivité :
   la porte peut conclure dès la première mesure.
2. Même quand un plancher est fourni, il ne mesure que la RUN :
   `const idleSince = ctx.lastActivityAt || ctx.startedAt || 0;`
   (`agents-bus.js:1054`, `1081`, `1095`). Or **la sonde Rust ne publie aucune
   date de démarrage de session** (`src-tauri/src/agent_service.rs:4021`,
   `activity_probe_entry`) : elle ne renvoie que `project`, `agent`, `alive`,
   et — s'il y a eu de l'activité — `busy`, `toolInProgress`, `lastActivity`.
   Le front n'avait donc **aucun moyen de savoir** que la session avait 24 s.

Autrement dit : le chien de garde distinguait « session qui ne prouve rien »
de « session ancienne qui ne prouve rien », et rien d'autre. Une session de
24 s et une session de 30 min sans activité étaient **le même objet**.

### 2.4 Pourquoi ce n'est pas un simple « délai trop court »

Allonger un délai sans repère n'aurait rien réglé : le seuil qui compte n'est
pas « depuis quand la run ne parle plus » mais « depuis quand CETTE SESSION
existe ». Aucune valeur de délai ne peut compenser un repère absent.

### 2.5 Pourquoi le plancher existant (`RUN_LOCK_SWEEP_START_GRACE_MS`, 60 s) n'a pas protégé la mission tuée à 22 s

Trois explications étaient possibles ; deux sont écartées, la troisième est la
cause racine.

| Hypothèse | Verdict |
|---|---|
| « un autre chemin de libération » | **Partiellement vrai, mais non décisif.** Le balayage périodique (`sweepOrphanRunLocks`, `agents-bus.js:1277`) et les appels de `super-agent.js` (`isRunStillActive`, `agents-bus.js` via `releaseStuckRunLock`) réutilisent **tous** `releaseStuckRunLockForKey` : la porte `ghosts` est la seule autorité (`isSessionWorking` / `classifyExclusivitySession` ne sont appelés nulle part ailleurs — vérifié par recherche dans `src/js`). Aucun second décideur n'a donc été oublié. |
| « la run est plus vieille que la session » | **Vrai, et c'est structurel.** Tous les planchers existants mesurent l'âge de la **RUN** : `RUN_LOCK_SWEEP_START_GRACE_MS` compare `now - (ctx.lastActivityAt \|\| ctx.startedAt)` (`agents-bus.js:1285`), et `requireIdleMs` mesure exactement la même chose (`agents-bus.js:1106`). Une run ouverte depuis longtemps qui porte une session **neuve** (mission suivante de la file, relance, redémarrage à contexte vierge — exactement la ligne `stale-session-restart` du journal) est donc **déjà au-delà de tous les planchers** : aucun d'eux ne pouvait la protéger, quel que soit le chiffre choisi. |
| « absence de repère de démarrage de session » | **La cause racine.** La sonde Rust (`activity_probe_entry`, `agent_service.rs:4029`) ne publie aucune date de session, et le front n'en tenait aucune : un plancher, même correct, n'avait **rien à mesurer**. Un délai plus long aurait seulement déplacé la mort de 24 s à 60 s. |

Conclusion opérationnelle : allonger `RUN_LOCK_SWEEP_START_GRACE_MS` aurait été
un faux correctif (il ne voit que la run) ; la seule référence juste est
l'instant de **démarrage de la session**, connu du bus au moment où il demande
le spawn. C'est ce repère qui est posé (§ 3) et qui protège **tous** les chemins
de libération, y compris le balayage (§ 6.1).

---

## 3. Correction

Principe : **le bus sait quand il a démarré une session** (c'est lui qui
appelle `start_agent_process` / `start_assistant_agent_process`, et il reçoit
l'`uid` de spawn). Il horodate ce démarrage et le transmet aux décideurs purs.
Aucune modification Rust, aucun appel supplémentaire.

### 3.1 `src/js/exclusivity-queue.js` — la règle pure

- Nouvelle fonction pure `sessionStartAt(session)` : instant de démarrage d'une
  session (nombre d'epoch ms **ou** chaîne ISO), `0` si inconnu/illisible.
- Nouvelle fonction pure `isSessionRecentlyStarted(session, now, windowMs)` :
  `true` si le démarrage connu date de **strictement moins** que la fenêtre de
  grâce (`RECENT_ACTIVITY_WINDOW_MS`, 2 min — constante existante, pas de
  nouveau chiffre).
- `isSessionWorking` : après la garde `alive` et le signal `toolInProgress`,
  **une session démarrée il y a moins de la fenêtre de grâce est un travail en
  cours** (commentaire explicite : c'est la correction, pas une tolérance).

La distinction demandée est ainsi nette :

| Session | Démarrage connu | Signaux | Verdict |
|---|---|---|---|
| neuve, sans aucun signal | oui, < 2 min | aucun | **travaille** (protégée) |
| ancienne, sans aucun signal | non / > 2 min | aucun | **ne travaille pas** (coupée) |
| outil en cours | — | `toolInProgress` | travaille |
| activité récente | — | `lastActivity` < 2 min | travaille |

Sans horodatage de démarrage (session d'une autre fenêtre Pilot, session
héritée d'une version antérieure, session externe), le comportement est
**exactement celui d'avant** : aucune protection n'est inventée.

### 3.2 `src/js/agents-bus.js` — le repère et la porte

1. `newRunCtx` : nouveau champ `sessionStartedAtByAgent: {}` (remis à zéro à
   chaque run, comme `sessionUid`).
2. Horodatage **au spawn réel**, sur les deux chemins :
   - agents de run (`runAgentTurn`, juste après `ctx.sessionUid[agent.id] = …`) ;
   - agents de l'assistant (`start_assistant_agent_process`).
   Un redémarrage de session en cours de run (contexte vierge) rafraîchit donc
   le repère : la protection vaut pour la session **réellement lancée**.
3. `annotateSessionStartTimes(sessions)` : recopie l'horodatage connu du bus sur
   les entrées de la sonde **quand elles n'en portent pas** (jamais d'écrasement
   d'une valeur venue d'ailleurs). Appliqué dans les deux sondes qui nourrissent
   le chien de garde : `anyActiveAgentWorking` et `projectHasWorkingSession`.
4. `latestSessionStartAt(ctx)` + `startGraceOpen(ctx, now, windowMs)` : pures et
   exportées (testables). `startGraceOpen` est **la** garde de la porte
   `ghosts` : si une session de la run a démarré il y a moins de 2 min, la porte
   `ghosts` **ne peut pas se déclencher**, quel que soit le plancher demandé par
   l'appelant (y compris `requireIdleMs = 0`). Motif journalisé en `console.warn`
   (la porte reste visible dans l'instrumentation existante).
5. Nuance indispensable : `anyDeclaredAgentSessionDead(key)` — la grâce ne
   s'applique PAS si la sonde montre qu'un agent **déclaré** de la run a une
   session **morte** (`alive !== true`). Une session morte n'est pas une session
   muette : c'est un vrai fantôme, libéré immédiatement, sans attendre 2 min.
   Sonde indisponible → la grâce s'applique (on ne coupe pas sur incertitude).

C'est la formulation exacte de l'exigence : *le chien de garde laisse passer au
minimum la fenêtre de grâce après le démarrage d'une session avant de pouvoir
libérer la run*, et cette garde ne dépend plus du bon vouloir de l'appelant.

---

## 4. Ce qui n'est PAS changé (et pourquoi)

- **Le chien de garde n'est pas désactivé** : aucune porte n'est supprimée
  (`noActive`, `residualParallel`, `ghosts`, `orphanQueue`), aucun seuil
  existant n'est rallongé (`RECENT_ACTIVITY_WINDOW_MS` reste 2 min,
  `STALE_BUSY_WINDOW_MS` 25 min, `TOOL_IN_PROGRESS_MAX_MS` inchangé,
  `RUN_LAUNCH_MIN_STUCK_IDLE_MS` 2 min, balayage 60 s).
- **Le vrai fantôme reste coupé** : session d'une run ancienne, sans aucun
  signal, ou session **morte** ⇒ libération comme avant (tests existants
  conservés, aucun n'a été affaibli).
- **La porte `noActive`** (verrou sans aucun agent porteur, issue #87) garde sa
  libération immédiate : aucun agent déclaré ⇒ aucune session neuve à protéger.
- **La porte `orphanQueue`** et ses gardes (fenêtre `QUEUED_ORPHAN_GRACE_MS`,
  drainage de la file, « une demande en file n'est jamais abandonnée ») sont
  intactes.
- **La double mesure** de la porte `ghosts` (`watchdogConfirmDelayMs`) et le
  plancher `requireIdleMs` des appelants sont intacts : la nouvelle garde
  s'ajoute, elle ne remplace rien.
- **Rust non touché** : `agent_activity_probe` / `activity_probe_entry` restent
  tels quels. La consigne « aucune compilation Rust » est respectée, et la
  sonde légère (interdiction de `list_agent_sessions` en boucle, verrouillée par
  `sonde-rejeu-sans-liste-sessions.test.js`) reste la seule sonde employée.
- **`isRunStillActive` (`super-agent.js`)** : inchangé. Il appelle déjà
  `releaseStuckRunLock` avec un plancher puis s'arrête sur `isRunInProgress` :
  verrou conservé ⇒ aucune conséquence.

---

## 5. Décision prise sans poser de question (consigne)

- **Fenêtre de grâce = `RECENT_ACTIVITY_WINDOW_MS` (2 min)**, constante
  existante et déjà alignée sur le moteur : aucune nouvelle constante, aucun
  chiffre inventé.
- **Repère = démarrage de SESSION, pris côté front** (le bus est le seul à
  savoir qu'il vient de créer la session) plutôt qu'un champ ajouté à la sonde
  Rust : aucune compilation Rust demandée par la mission, aucune API modifiée,
  et la protection vaut pour les deux familles de sessions (agents de run et
  agents de l'assistant).
- **Comparaison stricte** (`< windowMs`) : à l'instant exact du seuil, la
  protection est levée (comportement historique rétabli).
- **Pas de protection inventée** : sans horodatage de démarrage connu,
  `isSessionRecentlyStarted` répond `false` — le défaut d'origine ne peut pas
  renaître sous une autre forme.
- **Aucun plancher existant n'est rallongé** : `RUN_LOCK_SWEEP_START_GRACE_MS`
  (60 s) mesure la **RUN**, pas la session ; l'allonger n'aurait fait que
  déplacer la mort (24 s → 60 s) sans jamais voir la jeunesse de la session. La
  grâce ajoutée est **indépendante de tout plancher d'appelant** et s'applique
  sur les deux chemins de libération (watchdog direct et balayage périodique).

---

## 6. Vérification

Nouveau fichier de tests (résultats mesurés, aucun chiffre figé en dur : toutes
les durées sont recalculées depuis `RECENT_ACTIVITY_WINDOW_MS`) :
`src/js/chien-de-garde-session-neuve.test.js`.

| Cas | Attendu |
|---|---|
| session démarrée à l'instant, **aucun** signal | run **MAINTENUE** (la porte `ghosts` ne se déclenche pas) |
| session **ancienne** sans aucune activité | run **libérée** (vrai fantôme) |
| session avec **outil en cours** | run **MAINTENUE** |
| session avec **activité récente** | run **MAINTENUE** |
| session neuve + `requireIdleMs = 0` (appelant sans plancher, cas du journal) | run **MAINTENUE** |
| session **morte** même très récente | run **libérée** (la mort est éliminatoire) |
| session **neuve** dans une run **ANCIENNE** (balayage périodique) | run **MAINTENUE** |
| session **ancienne** dans une run ancienne (balayage) | run **libérée** après la double mesure |
| plancher d'inactivité de l'appelant **dépassé** (il mesure la RUN) + session neuve | run **MAINTENUE** |
| même plancher dépassé + session ancienne | run **libérée** (la protection ne bloque pas le vrai fantôme) |

### 6.1 Deuxième chemin de libération vérifié : le balayage périodique

Le balayage (`sweepOrphanRunLocks`) a ses **propres** planchers, tous mesurés sur
la RUN (`RUN_LOCK_SWEEP_START_GRACE_MS`, `RUN_LOCK_SWEEP_MIN_IDLE_MS`). Une run
ancienne portant une session neuve les franchit donc tous les deux : c'est
précisément le scénario du journal (run ouverte depuis longtemps, session de
24 s). Quatre tests le verrouillent désormais **sans écrire aucune durée en dur**
(tout est recalculé depuis les constantes) :

- session neuve dans une run ancienne → `sweepOrphanRunLocks()` ne libère rien ;
- session ancienne dans une run ancienne → le balayage libère (après sa double
  mesure, attendue par `vi.waitFor`) : le vrai fantôme reste coupé ;
- plancher d'inactivité de l'appelant largement dépassé (il mesure la RUN) mais
  session neuve → run maintenue, et `startGraceOpen` prouve que c'est bien le
  repère de SESSION qui protège ;
- même plancher, session ancienne → libération.

**Aucun code n'a eu à changer sur ce chemin** : le balayage délègue à la porte
`ghosts`, qui consulte la grâce de démarrage. C'est la preuve que le correctif
est posé au bon endroit (le seul décideur) et non dupliqué par chemin.

Tests existants : `agents-bus.test.js`, `chien-de-garde-compilation.test.js`,
`verrou-orphelin.test.js`, `verrou-par-projet.test.js`,
`exclusivity-queue.test.js`, `sonde-rejeu-sans-liste-sessions.test.js` restent
verts **sans modification de leurs attentes** (les nouveaux tests sont le seul
fichier ajouté ; les fixtures existantes représentent des sessions dont le bus
n'a jamais horodaté le démarrage, donc leur verdict est inchangé).

Résultats mesurés (2026-10-28, `npx vitest run`) :

- `src/js/chien-de-garde-session-neuve.test.js` → **25 tests, 0 échec** (dont les 4 du balayage, § 6.1) ;
- suites voisines (`agents-bus`, `exclusivity-queue`,
  `chien-de-garde-compilation`, `verrou-orphelin`, `verrou-par-projet`,
  `sonde-rejeu-sans-liste-sessions`) → **226 tests, 0 échec** ;
- suite front complète (`npm test`) → **223 fichiers, 4147 tests, 0 échec**.

Aucune compilation Rust n'a été lancée (consigne) : la modification est
entièrement côté front et aucun test Rust n'est concerné par ces fichiers.

---

## 7. Ce qui reste ouvert (hors périmètre de cette mission)

Les lignes `uid=77` (≈ 6 min) et `uid=78` (≈ 3 min) du journal montrent des
sessions mortes par la porte `ghosts` **au-delà** de la fenêtre de grâce de
2 min, alors qu'elles travaillaient probablement en silence (compilation /
réflexion longue). Ce n'est pas un problème de session neuve : c'est la question
« le silence est-il une preuve ? », traitée (et à traiter encore) du côté des
signaux d'outil et du busy-stale. La présente correction **ne prétend pas** la
résoudre et ne rallonge aucun délai pour la masquer.
