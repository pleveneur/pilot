# Rapport — entonnoir unique des arrêts automatiques (règle 3)

## Problème visé

La règle 3 (« aucune session ne disparaît sans trace écrite de sa raison
d'arrêt ») était tenue **site par site** : chaque chemin d'arrêt automatique
posait sa propre ligne de journal juste avant l'IPC d'arrêt. Un **nouveau** chemin
ajouté sans trace n'était donc retenu que par la vigilance et par un test
d'analyse de source qui épinglait les sites connus. La règle ne se défendait pas
par construction.

## Ce qui a été fait

### 1. Nouveau module `src/js/agent-stop-funnel.js`

- `stopAgentWithTrace({ reason, detected, agentId, projectPath, uid, detail, stop })`
  — écrit la ligne de journal (`traceAutomaticAgentStop`, même fichier
  `<projet>/.pilot/agent-stops.log`, même repli global, même mécanique
  sérialisée) **en l'attendant**, puis exécute `await stop()`. Retourne
  `{ traced, stopped }`.
  - **Ordre garanti** : la trace précède l'arrêt (observé sur un faux `invoke`).
  - **Fail-open côté arrêt** : journal impossible ou motif incomplet → l'arrêt a
    quand même lieu ; l'échec reste **dit** (rapporteur de
    `agent-stop-trace.js` → notification), jamais muet.
  - `detail` (optionnel) est transmis tel quel : aucune information de journal
    n'a été perdue lors de la migration (contexte « session périmée », message
    d'erreur post-spawn).
- Détecteur **pur** `scanAutomaticStopSites(source)` / `findUnfunneledAutomaticStops`
  — recense les sites d'arrêt (`abort_agent_process`, `stop_agent_process`,
  `stop_agent_session`, `stopAgentsRun`) et dit lesquels contournent
  l'entonnoir. Un site n'est reconnu couvert que s'il est **dans la même
  instruction** qu'un appel d'entonnoir, **dans sa fonction englobante** — la
  proximité seule ne blanchit pas un site muet ajouté quelques lignes après un
  arrêt tracé. Seul l'arrêt **volontaire** (bouton « tout arrêter ») échappe au
  journal, via le marqueur nommé `R3-EXCEPTION-MANUEL`.

### 2. `src/js/agents-bus.js` — 8 sites passés dans l'entonnoir

| Site | `reason` | `detected` |
|---|---|---|
| boucle d'outils | `loop-detection` | `tool-calls` |
| boucle de réflexion | `loop-detection` | `text` |
| timeout d'inactivité (`resetTimeout`) | `idle-timeout` | `no-event` |
| plafond de tours pi | `turn-cap` | `pi-turns` |
| plafond MAX_TURNS de la run | `loop-detection` | `turn-cap` |
| arrêt automatique de run (`stopAgentsRun`) | motif transmis | détecteur transmis |
| session périmée → contexte vierge | `stale-session-restart` | `fresh-context` |
| nettoyage post-échec de lancement | `spawn-failure-cleanup` | `run-agent-turn-error` |

Comportements **strictement identiques** : mêmes gardes `expectedUid`, même
portée `runKey`, mêmes effets (une ligne **par agent actif** dans
`stopAgentsRun`, `agent=none` seulement si la run n'a plus d'agent). Les traces
historiques des sites concernés ont été **remplacées** par celle de l'entonnoir :
aucune double ligne. L'appel `abort_agent_process` de l'arrêt **volontaire**
(bouton Stop, branche `else` de `stopAgentsRun`) reste direct et porte le
marqueur `R3-EXCEPTION-MANUEL`.

### 3. Tests

- **Nouveau** `src/js/agent-stop-funnel.test.js` (10 tests, sans DOM) :
  ordre trace→arrêt sur un faux `invoke`, motif incomplet, journal impossible
  (fail-open + échec signalé), erreur de l'action d'arrêt ; sur le **source** de
  `agents-bus.js` : liste des sites **épinglée** (4 `abort_agent_process`,
  2 `stop_agent_process`, 0 `stop_agent_session`, 3 `stopAgentsRun`), aucun site
  hors entonnoir, motifs **littéraux** (aucun `stopAgentsRun({… reason: …})` ne
  contourne plus l'entonnoir) ; **contrôle négatif** : un `invoke` muet injecté
  en mémoire à 4 endroits, puis juste après un arrêt tracé, est bien détecté.
- `agent-stop-trace-paths.test.js` adapté : `TRACE_SRC` reconnaît désormais
  l'entonnoir comme point de trace, cardinalités et comptes ré-épinglés
  (23 → 19 traces explicites + 8 points d'entonnoir = 27), contrôle négatif
  étendu (5 sites, 4 tracés, 1 muet), et vérification croisée par le détecteur
  de l'entonnoir.
- `agents-bus.test.js` : l'arrêt automatique étant désormais précédé de
  l'écriture **attendue** de la trace, trois tests synchrones observent l'abort
  après un `flush()` (les assertions ne changent pas : « aucun arrêt » /
  « arrêt » pour le projet testé) et le `beforeEach` draine les chaînes du test
  précédent pour éviter toute pollution croisée.

## Vérifications

- `npx vitest run` ciblé : `agent-stop-funnel.test.js` (10/10),
  `agent-stop-trace-paths.test.js` (18/18), `agents-bus.test.js` (107/107),
  `agents-bus-stop-scope`, `regle-2-lectures-jamais-arret`,
  `regle-4-file-jamais-perdue`, `file-attente-regle-4`,
  `agent-stop-trace-concurrency`, `verrou-par-projet`, `verrou-orphelin`,
  `mission-identity` → tous verts.
- `npm test` complet : vert (voir la sortie du run final).
- `npm run build:handbook` relancé après mise à jour du bloc
  `<!-- HELP:loop-detection-writes -->` de `spec_super_agent.md`.

## Hors périmètre (volontairement non touché)

`agent-pi.js`, `super-agent.js`, identité de mission (`mission-identity.js`),
tout le Rust, `geminiReport.md`. Le détecteur peut s'appliquer à ces fichiers
plus tard, sans changement de contrat.
