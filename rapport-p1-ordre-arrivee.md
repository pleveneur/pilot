# Rapport P1 — Ordre d'arrivée à l'admission d'une demande

**Version** 0.4.35 · **Commit local** (aucun push, aucun tag, aucune version touchée)
**Portée** : `src/js/super-agent.js` (+ 1 test nouveau, 3 tests existants réalignés,
`spec_gestion_agents.md` et `help/handbook.md`).
**Correctif P2 conservé intact** · **P3 (normalisation des chemins) non touché**.

> **MISE À JOUR — 2ᵉ passe P1 (§ 7)** : l'angle mort signalé par la relecture
> indépendante (`rapport-relecture-file.md`), la **fenêtre de course du rejeu**,
> est corrigé à son tour (réservation de créneau, `claimDequeuedMission`).
> Sections 1 à 6 = première passe (4cf5356) ; § 7 = état courant.

---

## 1. Défaut corrigé (D1 du diagnostic)

`rapport-file-attente-pertes-doublons.md` §4.1 : **à l'admission d'une demande, la
file du projet n'était jamais consultée**. Seul le verrou de run décidait. Dès que
ce verrou paraissait libre, la demande qui arrivait **démarrait devant** les
missions déjà en attente — lancements directs horodatés `08:45:07Z`, `09:15:07Z`,
`09:21:05Z`, `09:25:28Z`.

Trois points d'entrée étaient concernés, tous avec la même forme
« verrou seul, file ignorée » :

| Point d'entrée | Ancienne condition d'admission (avant) |
|---|---|
| `run_agents` → `launchOrQueue` | `if (isRunInProgress(target, { nature: missionNature }) || busyManual) {` |
| `run_agents` → `startRun` | `if (blockedByFlag || blockedByBus) {` |
| `run_assistant_agents` → `startRun` | `if (runAgentsInFlightByProject[target] || isRunInProgress(target)) {` |

## 2. Ce qui change (minimal, ciblé, sans renommage)

### 2.1 Un point de décision unique (nouveau, `super-agent.js` L552‑623)

```js
export function pendingMissionsAhead(projectPath, opts = {}) {
  if (opts && opts.dequeue) return 0;
  return (runAgentsQueueByProject[projectPath || ""] || []).length;
}

export function decideMissionAdmission(projectPath, opts = {}) {
  const pending = pendingMissionsAhead(projectPath, opts);
  if (pending > 0) return { queue: true, pending, reason: "queue-ahead" }; // ← P1
  if (opts && opts.busy) return { queue: true, pending, reason: "busy" };   // ← historique
  return { queue: false, pending, reason: "" };
}
```

Ordre de la décision : **file d'abord**, occupation ensuite, démarrage en dernier.
Une mission en attente ne peut donc plus être doublée par une demande qui arrive,
**même quand le verrou du projet paraît libre** (c'est exactement l'état qui
laissait passer le lancement direct).

### 2.2 Les trois points d'entrée passent par cette décision

Chacun conserve sa sonde d'occupation d'origine (bus, flag local, activité réelle
de l'agent, `releaseStuckRunLock` avec plancher) et n'a changé que sa **décision** :

```js
const admission = decideMissionAdmission(target, {
  busy: /* sonde d'origine, inchangée */,
  dequeue: !!(launchOpts && launchOpts.dequeue),
});
if (admission.queue) { /* … mise en file (chemin de production unique) … */ }
```

L'ancienne condition de chaque site est **supprimée** (le test de câblage
`file-attente-fifo-admission.test.js` § (d) échoue si l'une d'elles revient).

### 2.3 Décision explicite ET tracée

Nouveau cas `queue-ahead` : la demande **ne double pas** la file, et la décision
laisse une trace :

- écran : « ⏳ N demande(s) attendent déjà sur ce projet — votre demande est mise
  en file DERRIÈRE elles ; elle démarrera à son tour, dans l'ordre d'arrivée. » ;
- disque : une ligne du **point unique** `traceQueueAbandon` dans
  `<projet>/.pilot/agent-stops.log` (repli global), motif
  `reason=queue-order-respected`, détecteur `detected=admission-fifo`, **nommant
  les missions déjà en attente** ;
- console : avertissement `[super-agent] admission FIFO`.

`armQueueReplay(target)` est armé dans **tous** les cas d'empilement (déjà le cas) :
la file est drainée dans l'ordre, sans intervention.

### 2.4 Anti-boucle : le rejeu ne se compte pas comme « devant »

`launchQueuedMission` lance désormais `entry.launch({ dequeue: true })` (`super-agent.js`
L1037). Sans ce marquage, la tête de file — sortie de la file puis relancée —
se compterait comme « une mission devant elle-même » et se remettrait en file
**indéfiniment**. Les trois lanceurs (`launchMission`, `startRun` ×2) transmettent
ce drapeau ; aucune autre signature publique n'est modifiée.

### 2.5 Aucun écrasement silencieux

Rien n'est retiré de la file par ce correctif : la demande arrivée **s'ajoute**
(`enqueueMissionForProject`, libellé + numéro de mission + refus du doublon). Le
refus de double empilement reste celui de P2/règle 4.

## 3. Ce qui n'a PAS changé

- **P2 intact** : `keepQueuedRunAgentsMissions` / `abandonQueuedRunAgentsMissions`,
  la conservation de file à l'arrêt d'agent et `runAgentsQueueReplayByProject` sont
  inchangés ; `file-attente-arret-conserve.test.js` et `file-attente-regle-4.test.js`
  passent sans modification.
- **P3 non touché** : aucune normalisation de la clé de projet n'est introduite
  (`runAgentsQueueByProject[projectPath || ""]` reste la clé d'origine).
- Pas de refonte du rejeu, du watchdog, des files de commandes/délégations, ni de
  l'affichage : `project-queue-view.js` et `project-task-queue.js` sont **intacts**
  et continuent d'afficher « ce qui tourne » et « ce qui attend, avec son rang ».

## 4. Preuves (test de non-régression)

Nouveau fichier : **`src/js/file-attente-fifo-admission.test.js`** — 8 tests.

| Bloc | Ce qui est prouvé |
|---|---|
| (a) | file vide + projet libre → démarre ; **mission en attente + verrou libre → mise en file** ; projet occupé → mise en file (historique) ; le rejeu n'est pas compté « devant » |
| (b) | ordre d'exécution **réel** : A (mise en file d'abord) démarre en premier, B (arrivée après) ne démarre qu'à son tour — aucune des deux n'est perdue |
| (c) | la décision est **tracée** (`reason=queue-order-respected`, `detected=admission-fifo`, missions devant nommées) et **rien** n'est tracé quand il n'y a personne devant |
| (d) | les **3** points d'entrée décident par le même point, les 3 anciennes conditions (verrou seul) sont absentes, `entry.launch({ dequeue: true })` présent, file consultée **avant** l'occupation ; l'écran sait montrer la file (rangs `en attente (1er)`, `(2e)`) |

### 4.1 Le test échoue bien sans le correctif (non-vacuité)

```
$ git stash push -- src/js/super-agent.js && npx vitest run src/js/file-attente-fifo-admission.test.js
PASS (1) FAIL (7)
  #1..#4  TypeError: decideMissionAdmission / pendingMissionsAhead is not a function
  #5      TypeError: traceMissionQueuedBehindPending is not a function
  #6      AssertionError: un point d'entrée ne consulte plus la file avant de démarrer:
          expected [] to have a length of 3
```

Mutation ciblée (le point unique redevient aveugle à la file :
`if (pending > 0 && false)`) :
`AssertionError: expected { queue: false, … } to deeply equal { queue: true, pending: 1, … }`
→ les preuves (a) et (b) tombent. Mutation rétablie ensuite (`diff` identique).

### 4.2 Tests existants exécutés (résultat exact)

```
$ npm test
Test Files  123 passed (123)
     Tests  2085 passed (2085)

$ npm run build        # vite : OK (avertissements de découpage préexistants)
$ npm run build:handbook   # 42 blocs, handbook.md régénéré
```

`file-attente-regle-4.test.js`, `file-attente-arret-conserve.test.js`,
`file-attente-identite-demande.test.js`, `planificateur-plan-complet.test.js`,
`exclusivity-queue.test.js`, `agents-bus.test.js`, `agent-stop-*.test.js` :
**tous verts sans modification**.

### 4.3 Trois tests existants réalignés (ancres de source uniquement)

Ces tests vérifiaient le **code source** par ancre textuelle ; les ancres ont suivi
la nouvelle signature, **l'intention et la force des assertions sont conservées**
(aucune assertion retirée, deux assertions rendues plus précises) :

| Fichier | Ancienne ancre | Nouvelle ancre |
|---|---|---|
| `agent-demande-exact.test.js` | `const launchMission = () => launchOrQueue();` | `const launchMission = (missionLaunchOpts) => launchOrQueue(missionLaunchOpts);` |
| `super-agent-refus-avant-lancement.test.js` | `const startRun = async () => {` | `const startRun = async (launchOpts = {}) => {` |
| `verrou-par-projet.test.js` (POINT D / POINT E / POINT G) | `const launchOrQueue = async () => {`, fin de corps `const reportDeferredLaunch` (symbole disparu), `enqueueMissionForProject(target, () => startRun()` | signature avec `launchOpts`, fin de corps `const launchMission =`, `enqueueMissionForProject(target, (missionLaunchOpts) => startRun(missionLaunchOpts)` |

## 5. Documentation mise à jour

- `spec_gestion_agents.md` : nouvelle sous-section « Ordre d'arrivée à l'admission
  (P1) » (règle, trace, anti-boucle, tests) + une puce utilisateur dans le bloc
  `<!-- HELP:agents -->`.
- `help/handbook.md` régénéré par `npm run build:handbook` (jamais édité à la main).

## 6. Limites connues / suite

1. **Latence du drain** : quand la file était déjà non vide alors que le projet
   paraissait libre, la tête démarre au plus tard au prochain tick de rejeu
   (`armQueueReplay`, 15 s) — le mécanisme de rejeu existant (P2) a été réutilisé
   tel quel plutôt que doublé par une passe immédiate concurrente (risque de
   double lancement).
2. **Ordre conservé en cas de ré-empilement** : si une mission rejouée retrouve le
   projet occupé, elle est remise **en queue** de file (comportement antérieur,
   hors périmètre P1).
3. **P3** (chemin de projet identique écrit différemment) reste à traiter : deux
   clés distinctes peuvent encore désigner le même projet ; ce correctif ne
   normalise rien.

---

## 7. Deuxième passe — l'ANGLE MORT : la fenêtre de course du rejeu

**Mission P1 (correction bornée), commit local uniquement** · aucun push, aucun
tag, aucune version touchée, aucune documentation modifiée (elle sera alignée
dans une mission suivante).

### 7.1 Défaut restant après la première passe

La première passe consultait la **file**, ce qui ne suffit pas. Le rejeu
(`replayQueuedMissionForProject`, et les deux `settleRun`) fait :

```js
const next = queue.shift();      // la tête SORT de la file
if (next) launchQueuedMission(target, next);   // … puis on lance
```

Entre le `shift` et l'**inscription réelle de la run au bus**
(`runAgentsForAssistantAsync` est asynchrone : `initAgentsBus`, registre,
réservations…), la file est **VIDE** et `isRunInProgress` est **faux**. Une
demande qui arrivait dans cet intervalle ne voyait donc **aucun occupant** :
`pending = 0`, `busy = false` → **démarrage immédiat**, devant la mission rejouée.
`launchOrQueue` ne sonde que `isRunInProgress` + l'activité manuelle : il ne
pouvait pas voir cette run-là (le drapeau `runAgentsInFlightByProject` est, lui,
posé par la demande **elle-même** avant son propre lancement — le sonder à
l'admission mettrait chaque demande en file derrière elle-même).

### 7.2 Correctif (minimal, ciblé, sans renommage ni reformatage)

Un seul mécanisme ajouté : la **réservation du créneau** d'une mission sortie de
file (`src/js/super-agent.js`).

| Élément | Rôle |
|---|---|
| `runAgentsMissionClaimByProject` | `projet (clé) → [{ label, at }]` : missions sorties de la file, pas encore inscrites au bus |
| `claimDequeuedMission(projet, label)` | pose la réservation et renvoie sa **libération idempotente** |
| `pendingMissionClaims(projet, now)` | réservations encore valides (les périmées, > `MISSION_CLAIM_MAX_MS` = 60 s, ne comptent plus) |
| `pendingMissionsAhead` | `file + réservations` — **le point unique d'admission juge donc la file ET les runs réellement en vol** |
| `pendingMissionAheadLabels` | nomme ce qui n'est pas doublé : entrées de file **puis** missions en cours de démarrage |
| `launchQueuedMission` | **seul** site de pose : réservation prise **synchronement** au retrait de la tête, libérée sur les trois issues (succès, échec traité, exception synchrone) |

Propriétés qui ferment la fenêtre :

1. **Aucun `await` entre le `shift` et la réservation** (JS mono-thread) : l'état
   « file vide + bus libre » n'est **jamais** observable par une demande qui
   arrive.
2. **Anti-boucle** : la mission rejouée porte `dequeue`, donc `pendingMissionsAhead`
   → 0 pour **elle** ; elle ne se remet jamais derrière elle-même.
3. **Pas d'attente fantôme** : libération à la conclusion du lancement (le verdict
   `onStart`/`onError` de `launchRun`), libération dans le chemin d'échec **après**
   la remise en file (la file porte alors la mission), et borne de 60 s pour une
   promesse qui ne se conclurait jamais. Le rejeu, lui, n'est **jamais** bloqué par
   une réservation : il ne consulte que l'admission réelle du projet.

Aucun autre comportement n'est modifié : même point de décision (`decideMissionAdmission`),
même chemin d'empilement (`enqueueMissionForProject`, règle 4), même trace
(`queue-order-respected` / `admission-fifo`), même affichage de file
(`project-queue-view.js` : rangs « en attente (1er) / (2e) »), P2 et P3 intacts.

### 7.3 Preuves (nouveau test, échoue sans le correctif)

Nouveau fichier **`src/js/file-attente-fenetre-rejeu.test.js`** — **10 tests**.

| Bloc | Ce qui est prouvé |
|---|---|
| (a) | pendant le rejeu, **file vide** : la demande qui arrive s'empile (`queue-ahead`, `pending: 1`), rien ne démarre en plus ; la trace **nomme** la mission en cours de démarrage ; **ordre d'exécution réel** `[mission rejouée, demande arrivée]` |
| (b) | la réservation est levée dès l'inscription au bus (retour à `pending: 0`) ; un lancement **en échec** conserve la mission en file **et** ne laisse aucune réservation ; une réservation **périmée** ne retient plus personne |
| (c) | `dequeue` ignore la réservation (aucune boucle de rejeu) |
| (d) | câblage : **un seul** site de pose (`launchQueuedMission`, avant `entry.launch`), **trois** libérations, 3/3 points d'entrée nomment les missions devant, aucune admission revenue « verrou seul », lancement synchrone sans réservation résiduelle |

**Non-vacuité (mutation)** — neutraliser la seule ligne qui compte la
réservation (`return queued + pendingMissionClaims(projectPath).length;` →
`return queued;`) rend **3 tests rouges** du nouveau fichier, dont la preuve
centrale :

```
AssertionError: la mission rejouée n'est plus comptée comme occupant:
  expected +0 to be 1
Tests  3 failed | 7 passed (10)
```

puis `diff` identique après rétablissement.

### 7.4 Tests exécutés (chiffres exacts)

```
$ npx vitest run src/js/file-attente-fenetre-rejeu.test.js
PASS (10) FAIL (0)

$ npx vitest run src/js/file-attente-fifo-admission.test.js \
    src/js/file-attente-arret-conserve.test.js \
    src/js/file-attente-regle-4.test.js \
    src/js/file-attente-identite-demande.test.js \
    src/js/verrou-par-projet.test.js src/js/project-cle-unicite.test.js \
    src/js/agent-demande-exact.test.js \
    src/js/super-agent-refus-avant-lancement.test.js
PASS (94) FAIL (0)

$ npm test
Test Files  125 passed (125)
     Tests  2101 passed (2101)        # 2091 avant cette passe (+10 = le nouveau fichier)

$ npm run build                      # vite : OK (avertissements de découpage préexistants)
```

Aucun test existant n'a été modifié par cette passe (les 3 réalignements de
§ 4.3 datent de la première passe).

### 7.5 Limites qui restent (non masquées)

1. **L1 — ré-empilement** : une mission rejouée qui retrouve le projet occupé est
   remise **en queue** de file (comportement antérieur, hors périmètre) : aucune
   perte ni doublon, mais inversion d'ordre possible. Inchangé.
2. **Latence du drain** : entre la libération du projet et le lancement effectif,
   il reste au plus un tick de rejeu (15 s). Inchangé.
3. **Lancement DIRECT simultané** (deux `run_agents` admis dans la même fenêtre
   d'inscription, aucun des deux ne venant de la file) : ce n'est pas cette
   fenêtre-ci et ce n'est pas une file doublée — le bus refuse la seconde run,
   qui est rapportée en **échec de lancement** (jamais annoncée « lancée »). Le
   mécanisme de réservation ne le couvre pas et ce correctif n'y touche pas.
4. **P3** (identité de projet) : mission séparée, rien de touché ici.
5. **Documentation** : non modifiée dans cette passe (consigne de la mission) ;
   `spec_gestion_agents.md` / `spec_super_agent.md` restent à aligner sur
   « réservation de créneau au rejeu » dans une mission suivante.
