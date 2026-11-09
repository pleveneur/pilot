# Rapport P2 — une file d'attente non vide survit à un arrêt d'agent

- Date : **2026-10-21**
- Version sur disque au moment de la correction : `0.4.35` (HEAD `8aa8f0d`)
- Périmètre : **un seul défaut**, le **D2** du diagnostic
  (`rapport-file-attente-pertes-doublons.md`, §4.2) — « un arrêt d'agent détruit
  une file non vide sur la foi d'un verrou de run périmé ».
- **P1** (ordre d'arrivée à l'admission) et **P3** (normalisation de la clé de
  projet) **ne sont pas touchés** : missions séparées.
- Aucun push, aucun tag, aucune modification de version, aucune note de release.
  Commit **local** uniquement.

---

## 1. Cause (prouvée)

L'action `stop_agent` de l'assistant décidait « le projet est libre » à partir du
**seul verrou de run du bus** (`isRunInProgress`), qui ne lit que les contextes de
run du bus — pas les processus/sessions vivants. Un verrou périmé (run terminée
sans libération, relance `stale-session-restart`, agent parqué, verrou libéré par
`releaseStuckRunLock`) rendait donc « projet libre » alors que des agents
travaillaient encore. La file de missions du projet était alors **vidée**
(`abandonQueuedRunAgentsMissions`) : les missions en attente étaient
**définitivement perdues**.

Preuves :

| Preuve | Emplacement (avant correctif) |
|---|---|
| Code fautif — branche projet | `src/js/super-agent.js:5280-5298` (v0.4.35), `isRunInProgress(queueKey)` puis `abandonQueuedRunAgentsMissions(queueKey, { detected: "stop-agent" })` |
| Code fautif — branche espace assistant | `src/js/super-agent.js:5309-5321` (même schéma sur `ASSISTANT_SPACE`) |
| Verrou de run non probant | `isRunInProgress` = `src/js/agents-bus.js` (contextes de run uniquement) ; la sonde consciente des sessions est `isRunStillActive` = `src/js/super-agent.js:802` |
| Trace horodatée du défaut | `2026-10-20T09:25:10.347Z op=auto-stop reason=queue-abandoned detected=stop-agent detail=#14 « ARBITRAGE RENDU : OUI, corrige… »` — mission **#14 perdue** alors que la session `codeur` n°13, lancée à `09:21:05.828Z`, n'a été arrêtée qu'à `09:25:27.480Z` (17 s plus tard) |

---

## 2. Correctif (minimal, un seul comportement)

### 2.1 Nouveau point de production unique : `keepQueuedRunAgentsMissions`

`src/js/super-agent.js:673-724` — conserver au lieu de détruire :

- la file est **laissée en place**, dans son ordre (aucun `shift`, aucun
  `length = 0`, aucune suppression d'entrée) ;
- chaque mission conservée est **NOMMÉE** par son libellé de file existant
  (`missionQueueLabel` → `#14 « … »`) ;
- une ligne de journal est écrite dans `<projet>/.pilot/agent-stops.log` (repli
  global) par le **point unique** déjà en place (`traceQueueAbandon`), avec
  `reason=queue-kept` et `detected=stop-agent` — donc distinct d'un abandon
  (`queue-abandoned`) ;
- l'utilisateur est **prévenu** (message console + notification assistant) :
  « 📋 N mission(s) conservée(s) en file d'attente : … Elles seront rejouées dès
  que le projet est libre » ;
- le **rejeu est armé** (`armQueueReplay`), qui réutilise la sonde d'admission
  existante `isRunStillActive` — celle qui juge sur les **sessions réellement
  vivantes** (et non sur le verrou) ; le rejeu ne démarre donc la tête de file
  qu'une fois le projet réellement libre.

### 2.2 Branche `stop_agent` — projet

`src/js/super-agent.js:5280-5302` : le vidage `abandonQueuedRunAgentsMissions`
est remplacé par `keepQueuedRunAgentsMissions`, et l'écran dit précisément ce qui
a été fait :

> `📋 N mission(s) conservée(s) en file d'attente par l'arrêt de l'agent : … — elles seront rejouées dès que le projet sera libre (motif consigné).`

Le message « ⏳ N mission(s) toujours en attente : une autre tâche tourne encore
sur ce projet. » est conservé tel quel pour le cas où le verrou est encore tenu.

### 2.3 Branche `stop_agent` — espace assistant (`ASSISTANT_SPACE`)

`src/js/super-agent.js:5309-5325` : même règle (le défaut y était identique).
Aucune purge globale : seule la clé concernée est traitée.

### 2.4 Ce qui n'a **pas** changé

- La file des **délégations** (#66) reste annulée à l'arrêt explicite : c'est une
  décision produit documentée (ne pas retransmettre automatiquement une
  délégation que l'utilisateur vient d'interrompre), tracée et nommée.
- Le **watchdog** de run (`super-agent.js:4629-4665`) continue d'abandonner une
  file — mais seulement quand `isRunStillActive` (sessions vivantes) a conclu que
  la run est **réellement morte**, au bout de 15 min. Hors D2.
- `/file vide` (action manuelle explicite) est inchangé.
- Aucun renommage, aucun reformatage, aucune refonte de la file, aucun changement
  d'ordre d'admission (P1) ni de clé de projet (P3).

---

## 3. Tests

### 3.1 Test de non-régression ajouté

`src/js/file-attente-arret-conserve.test.js` (7 tests) :

| Preuve | Ce qu'elle vérifie |
|---|---|
| (a) | une file de **2 missions** passée par le point de conservation reste **intacte** (nombre, ordre, identité `#N`), la trace porte `reason=queue-kept` + `detected=stop-agent` + **les deux libellés**, et le rejeu est **armé** ; une file vide ne trace rien et n'arme rien |
| (b) | avec une **session vivante** de l'agent sur le projet (verrou du bus libre), le rejeu **ne lance rien** et la file reste entière ; une fois la session disparue, la mission conservée est **rejouée** et la suivante reste en file |
| (c) | la branche `stop_agent` appelle la **conservation** (projet **et** espace assistant), **n'appelle plus** l'abandon, affiche un message nommant l'action, et le point de conservation ne contient **ni `length = 0` ni `shift`** |

Ces tests **échouent si le défaut revient** — vérifié par mutation (code de
production neutralisé, puis restauré) :

| Mutation appliquée à `super-agent.js` | Résultat |
|---|---|
| la conservation vide la file (`queue.length = 0; delete …`) | **2 tests en échec** (`(a)` et `(b)`) |
| la branche `stop_agent` rappelle `abandonQueuedRunAgentsMissions(queueKey…)` | **2 tests en échec** (`(c)` + POINT C) |

### 3.2 Tests existants adaptés (contrat de comportement changé)

`src/js/verrou-par-projet.test.js` — POINT C et POINT F vérifiaient l'**ancien**
comportement (« la file est vidée à l'arrêt »). Ils vérifient désormais le
nouveau, en gardant leur intention (créneau libéré, message visible, aucune purge
globale, clé par projet) :
`POINT C — l'arrêt d'un agent ne détruit plus la file de missions du projet`,
`POINT F — … conserve la file d'assistant`.

### 3.3 Résultats exacts

```
# Zone touchée (9 fichiers, dont le nouveau)
npx vitest run src/js/file-attente-arret-conserve.test.js src/js/verrou-par-projet.test.js \
  src/js/file-attente-regle-4.test.js src/js/project-queue-wiring.test.js \
  src/js/regle-4-file-jamais-perdue.test.js src/js/agent-stop-funnel.test.js \
  src/js/agent-stop-trace-paths.test.js src/js/agent-stop-trace-concurrency.test.js \
  src/js/file-attente-identite-demande.test.js
PASS (125) FAIL (0)

# Suite frontend complète
npx vitest run
PASS (2077) FAIL (0)
```

Documentation : `spec_super_agent.md` (§ RÈGLE 4 + bloc
`<!-- HELP:file-attente-identite-mission -->`) mise à jour, puis
`npm run build:handbook` relancé (42 blocs). Aucun code Rust touché (la file de
missions n'existe pas côté Rust).

---

## 4. Ce qui reste non couvert (à ne pas présenter comme réglé)

1. **P1 — ordre d'arrivée à l'admission** : une demande qui arrive pendant qu'un
   verrou paraît libre démarre toujours devant les missions déjà en file
   (`super-agent.js:4475-4560`, `:4700-4720`). Mission séparée, non traitée ici.
2. **P3 — clé de projet non normalisée** : `G:/IA_PL/pilot`, `G:\IA_PL\pilot\` et
   la même casse en majuscules désignent encore **trois** files distinctes
   (`super-agent.js:5280`, `agents-bus.js` `runKey`, `exclusivity-queue.js`).
   Mission séparée, non traitée ici.
3. **File en mémoire** : `runAgentsQueueByProject` n'est pas persistée ; un
   redémarrage de Pilot ou un rechargement de page efface les files. Un arrêt
   d'agent ne les détruit plus, mais un redémarrage, si. Hors périmètre de P2.
4. **« Tout arrêter »** (`stopAgentsRun`, `agents-bus.js`) vide encore les files
   d'exclusivité (avec trace `queue-abandoned`, `detected=clear-all-runs`) : action
   globale explicitement demandée, non modifiée.
5. **Délégations et `stop_agent`** : la file de délégations reste annulée à
   l'arrêt explicite (décision produit, tracée et nommée) — ce n'est pas une
   perte silencieuse, mais ce n'est pas une conservation.
6. **Preuve terrain manquante** : la correction est prouvée par les tests et par
   le raisonnement sur la trace du 2026-10-20 ; elle n'a **pas** encore été
   observée en conditions réelles (il faudrait provoquer un arrêt d'agent avec
   une mission en file sur un projet dont une session travaille encore). La ligne
   `reason=queue-kept` sera la signature à chercher dans `.pilot/agent-stops.log`.

---

## 5. Re-vérification indépendante (2026-10-21, après `13f7552`)

La mission P2 a été déposée en croyant qu'aucun correctif n'avait été produit :
le rapport de relecture (`rapport-relecture-file.md`) date du **2026-10-20**,
antérieur au commit. État réel vérifié sur disque, code relu, tests relancés :

| Vérification | Résultat |
|---|---|
| `stop_agent` (branche projet) appelle `keepQueuedRunAgentsMissions(queueKey…)`, plus jamais `abandonQueuedRunAgentsMissions` | `src/js/super-agent.js:5293-5295` |
| idem pour l'espace assistant (`ASSISTANT_SPACE`) | `src/js/super-agent.js:5319-5321` |
| le seul `delete runAgentsQueueByProject[queueKey]` du chemin d'arrêt est protégé par `waitingMissions === 0` | `src/js/super-agent.js:5296-5297` |
| dans la branche « verrou encore tenu », la file conserve son déclencheur de rejeu armé à l'empaquetage (POINT G), réarmé par `armQueueReplay` | `src/js/super-agent.js:4556`, `:4777`, `:916-928` |
| tests POINT C / POINT F réécrits (jamais supprimés) | `src/js/verrou-par-projet.test.js:613-628`, `:595-612` |

### 5.1 Chiffres exacts (relancés, worktree propre)

```
# Zone touchée (9 fichiers)
npx vitest run src/js/file-attente-arret-conserve.test.js src/js/verrou-par-projet.test.js \
  src/js/file-attente-regle-4.test.js src/js/project-queue-wiring.test.js \
  src/js/regle-4-file-jamais-perdue.test.js src/js/agent-stop-funnel.test.js \
  src/js/agent-stop-trace-paths.test.js src/js/agent-stop-trace-concurrency.test.js \
  src/js/file-attente-identite-demande.test.js
PASS (125) FAIL (0)

# Suite frontend complète
npx vitest run
PASS (2077) FAIL (0)
```

### 5.2 Non-vacuité du test de non-régression (mutations rejouées)

| Mutation appliquée à `src/js/super-agent.js` | Résultat |
|---|---|
| M1 : `keepQueuedRunAgentsMissions` vide la file (`queue.length = 0; delete runAgentsQueueByProject[key];`) | **2 échecs** (`file-attente-arret-conserve` + garde de corps de fonction) |
| M2 : la branche `stop_agent` rappelle `abandonQueuedRunAgentsMissions(queueKey…)` | **2 échecs** (POINT C + `P2 (c)`) |

Fichier restauré après chaque mutation (`git diff` vide), puis suites relancées :
`PASS (45) FAIL (0)` sur les deux fichiers de tests concernés.

### 5.3 Limites maintenues

Les points 1 à 6 du §4 restent vrais : **P1** (ordre d'arrivée à l'admission) et
**P3** (clé de projet non normalisée) ne sont pas traités ici, et la preuve
terrain (`reason=queue-kept`) reste à observer.
