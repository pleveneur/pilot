# RAPPORT — tracer TOUS les chemins d'arrêt automatique d'agent (règle 3)

Date : 2026-10-21
Périmètre : **JS seulement** (`src/js/agent-stop-trace.js`, `src/js/agents-bus.js`,
nouveau test `src/js/agent-stop-trace-paths.test.js`, specs/aide). **Aucun fichier
Rust, aucun seuil de temps modifié, aucun push, aucun tag.**

Source du diagnostic : `C:/Users/pldistance/.pilot/assistant/RAPPORT-verification-A-B-2026-10-20.md`
§ B.3 / B.4 / B.5.

---

## 1. Le défaut (constaté)

La règle 3 du projet dit : « une session ne peut pas disparaître sans une trace
écrite de sa raison d'arrêt ». Le journal `.pilot/agent-stops.log` existait déjà,
mais **seule une partie des chemins d'arrêt l'alimentait**. Quatre familles
d'arrêts AUTOMATIQUES restaient **muettes** :

| Chemin d'arrêt automatique | Trace avant ce correctif |
|---|---|
| Boucle détectée (outils / texte / épuisement d'escalade) | ✅ déjà tracée |
| **Timeout d'inactivité** (`resetTimeout`) | ❌ rien |
| **Plafond de tours pi** par agent | ❌ rien |
| **Arrêt émis par Rust** (moniteur d'anomalie) | ❌ rien (et le cas « ctx introuvable » faisait un `return` muet) |
| **Session restée « busy » sans progression** | ❌ rien |
| **Libération de verrou par le watchdog** | ❌ rien |
| **Balayage d'une run restée « stopping »** / **libération forcée** | ❌ rien |
| `stopAgentsRun` (mécanisme d'arrêt automatique) | ❌ rien |

Second défaut : **le journal lui-même pouvait perdre une ligne en silence**.
Quand le chemin de projet était vide (`projectPath === ""`, agent sans projet),
`traceAutomaticAgentStop` faisait un simple `return` ; et une erreur d'écriture
était avalée. Une session pouvait donc encore disparaître sans trace.

---

## 2. Ce qui a été fait

### 2.1 `src/js/agent-stop-trace.js` — plus de perte silencieuse

- `globalAgentStopTracePath(appDataDirPath)` (pure) → `<app_data_dir>/agent-stops.log`.
  **Même forme de ligne** que le journal projet (construite par
  `buildAgentStopTraceLine` de `loop-detection.js`, **inchangée**).
- `traceAutomaticAgentStop(entry)` :
  1. écrit dans `<projet>/.pilot/agent-stops.log` si le projet est connu ;
  2. sinon — **ou si l'écriture projet échoue** — écrit dans le journal
     **GLOBAL** `<app_data_dir>/agent-stops.log` ;
  3. si **rien** n'est possible, l'échec est **DIT** : `console.warn` +
     `reportAgentStopTraceFailure` (rapporteur injecté), à défaut événement
     global `pilot-agent-stop-trace-failed`.
  Elle retourne un booléen : `true` si une ligne a été écrite (projet **ou**
  global), `false` sinon. **Fail-open côté arrêt** (jamais de blocage de
  l'arrêt), **jamais fail-open côté information**.
- `setAgentStopTraceFailureReporter(reporter)` : le module ne connaît pas l'UI ;
  le bus y branche `emit("notify", { message })` → l'échec devient visible dans
  l'interface.
- Résolution du répertoire de données en JS pur via `appDataDir()` de
  `@tauri-apps/api/path` (donc **aucune modification Rust**). Vérifié :
  `core:default` déploie `core:path:default`, dont le jeu de permissions contient
  **`allow-resolve-directory`** (manifeste ACL généré :
  `target/debug/build/pilot-*/out/acl-manifests.json`) → l'appel est autorisé
  sans ajouter de permission.

### 2.2 `src/js/agents-bus.js` — trace sur TOUS les chemins, AVANT l'arrêt

Nouvel utilitaire interne `traceAutomaticAgentStopForRun(ctx, entry)` : écrit une
ligne **par agent actif** de la run (uid de session quand il est connu), et une
ligne `agent=none` quand la run n'a plus d'agent actif (verrou orphelin, run
fantôme) — la raison d'arrêt de la run survit donc toujours.

Sites branchés (**la ligne est écrite AVANT l'arrêt effectif, jamais après**) :

| Site | `reason` | `detected` |
|---|---|---|
| `resetTimeout` | `idle-timeout` | `no-event` |
| Plafond de tours pi | `turn-cap` | `pi-turns` |
| `stopAgentsRun` (appel automatique) | motif transmis par l'appelant | `stop-run` par défaut |
| Écouteur `agent-auto-stopped` (Rust) — **y compris le cas `ctx` introuvable**, qui journalise au lieu de `return` | `auto-stop-rust` | `anomaly-monitor` |
| Écouteur `agent-stale-busy-released` (idem cas orphelin) | `busy-stale-release` | `stale-busy` |
| `settleWatchdogRelease` | `watchdog-release` | la **porte** qui a tiré (`timeGuard`, …) |
| Balayage d'une run restée « stopping » | `sweep-stopping-release` | `sweep` |
| `forceReleaseProjectRunLock` | `force-release` | `user-command` |

- **Arrêt MANUEL** (bouton « tout arrêter ») : aucun `reason` transmis → **pas de
  ligne**. Un arrêt volontaire n'est pas présenté comme automatique (la règle 3
  vise les disparitions subies, pas les actions de l'utilisateur).
- Les deux sites historiques de boucle (`loop-detection`) sont conservés tels
  quels.

---

## 3. Verrou anti-régression : `src/js/agent-stop-trace-paths.test.js`

12 tests, **sans DOM**, trois groupes.

### a) Matrice des sites terminaux (analyse de source)
Énumération statique de `agents-bus.js` : chaque site terminal
(`invoke("abort_agent_process"`, `stopAgentsRun(`, `settleWatchdogRelease(`,
`settleMission(ctx.runKey, "stop"`) doit être couvert par une trace à motif
littéral **non vide**, écrite avant. **La liste est épinglée** :

```
abort_agent_process = 3   stopAgentsRun = 3 calls (+ définition)
settleWatchdogRelease = 2 calls (+ définition)   settleMission("stop") = 3
```

→ **un nouveau site d'arrêt muet fait échouer le test de cardinalité** au lieu de
passer inaperçu. S'y ajoutent : l'antériorité stricte dans `stopAgentsRun`
(`await trace…` **avant** `settleMission` et `abort`), la trace interne du
watchdog avec la porte, et le comptage épinglé des motifs
(`idle-timeout`, `turn-cap`, `loop-detection`, `auto-stop-rust`,
`busy-stale-release`, `watchdog-release`, `sweep-stopping-release`,
`force-release`).

### b) Comportement (IPC simulé, ordre des appels conservé)
`invoke` factice capture `write_file_content` : pour le timeout d'inactivité, le
plafond de tours pi et `agent-auto-stopped`, on vérifie **une** ligne écrite,
dans le journal du projet, avec le bon `reason` / `detected` / `agent`, **et que
son écriture précède `abort_agent_process`** (indice d'ordre IPC). Un test
supplémentaire couvre l'arrêt automatique **orphelin** (agent inconnu de toute
run) : il est journalisé, plus de `return` muet.

### c) Non-silence
- `projectPath: ""` → ligne dans **`<app_data_dir>/agent-stops.log`**.
- Écriture projet impossible → **repli global** (aucune perte).
- Toutes les écritures impossibles → **échec dit** (rapporteur appelé, message
  contenant la raison).

### Preuves d'échec (test rouge sans le code, puis restauration)
Chaque garantie a été cassée volontairement, le test observé rouge, puis le code
restauré (`cp` des sauvegardes, `git diff` vérifié) :

| Patch temporaire | Test rouge obtenu |
|---|---|
| P1 : suppression de l'`await traceAutomaticAgentStopForRun` dans `stopAgentsRun` | `trace absente de stopAgentsRun: expected -1 to be greater than -1` |
| P2 : ajout d'un site d'arrêt muet (`stopAgentsRun` sans trace) | `expected [ 70035, 70203, 98171, 106840 ] to have a length of 3 but got 4` |
| P3 : `reason`/`detected` retirés de l'arrêt `idle-timeout` | `aucune trace écrite pour le timeout d'inactivité` |
| P4 : `reason`/`detected` retirés de l'arrêt `turn-cap` | `aucune trace écrite pour le plafond de tours` |
| P5 : trace retirée de l'écouteur `agent-auto-stopped` | `aucune trace écrite pour l'arrêt automatique Rust` |
| P6 : repli global supprimé (`return false` si projet vide) | `la trace a été perdue au lieu de partir au journal global` |
| P7 : échec d'écriture redevenu muet | `un échec de journalisation est resté SILENCIEUX` |

---

## 4. Documentation et aide intégrée

- `spec_super_agent.md` : nouvelle sous-section « **Règle 3 — aucun arrêt
  automatique sans trace écrite (tous les chemins)** » — tableau des 10 chemins
  (site → `reason` → `detected`), règle de l'arrêt manuel non journalisé, cas
  `ctx` introuvable, **repli global**, **non-silence**, verrou anti-régression.
- Bloc `<!-- HELP:loop-detection-writes -->` enrichi (langage utilisateur) :
  tous les arrêts automatiques laissent une trace, repli global, et Pilot
  **signale** si même le journal global est inaccessible.
- `AGENTS.md` : ligne du module `agent-stop-trace.js` mise à jour (repli global +
  échec visible).
- `npm run build:handbook` exécuté → `help/handbook.md` régénéré (42 blocs,
  180 422 octets).

---

## 5. Anti-régression : tests

```
npm test
Test Files  114 passed (114)
     Tests  1953 passed (1953)
```

(dont les 12 nouveaux de `src/js/agent-stop-trace-paths.test.js`).
Aucun fichier Rust modifié → pas de `cargo test` nécessaire.

---

## 6. Limites assumées (hors périmètre de cette tâche)

- **Aucun seuil de temps n'a été touché** (consigne) : ce correctif ne fait que
  rendre l'arrêt existant *traçable*, il ne change pas *quand* il se produit.
- Les traces écrites par `super-agent.js` (assistant) n'ont pas été retouchées :
  elles passent simplement, elles aussi, par le nouveau repli global.
- Le journal global n'est pas indexé dans l'interface (consultation manuelle du
  fichier) — une évolution possible, non demandée ici.
