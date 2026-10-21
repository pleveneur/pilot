# Rapport P1 — Ordre d'arrivée à l'admission d'une demande

**Version** 0.4.35 · **Commit local** (aucun push, aucun tag, aucune version touchée)
**Portée** : `src/js/super-agent.js` (+ 1 test nouveau, 3 tests existants réalignés,
`spec_gestion_agents.md` et `help/handbook.md`).
**Correctif P2 conservé intact** · **P3 (normalisation des chemins) non touché**.

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
