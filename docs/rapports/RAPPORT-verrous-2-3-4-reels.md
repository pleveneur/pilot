# Rapport — fermeture des faux verrous des règles 2, 3 et 4

> Source : audit indépendant
> `~/.pilot/assistant/AUDIT-final-regles-2-3-4-2026-10-20.md`, verdicts
> **FRAGILE** sur les trois règles. Ce rapport dit, point par point, ce qui
> n'était **pas** garanti, ce qui a été corrigé, la **preuve de contrôle**
> (test rendu rouge quand on neutralise le correctif), les tests existants
> **adaptés** (et pourquoi leur contrat changeait), et les **limites qui
> restent**.

---

## A) RÈGLE 2 — « une lecture ne déclenche JAMAIS un arrêt d'agent »

### Ce qui n'était pas garanti

Le classifieur `isReadOnlyShellCommand` (consultations shell) existait et était
branché **uniquement dans le bus d'agents** (`agents-bus.js`). Les deux autres
chemins d'arrêt automatique comptaient encore les consultations comme des
actions :

| Chemin | Comportement constaté |
|---|---|
| `agent-pi.js` (onglet agent principal, **le plus utilisé**) | `bash` était dans la liste des outils **mutateurs** → ~15 consultations identiques (`git status --short`) déclenchaient l'arrêt de la run et une relance corrective. Deux runs `codeur` ont réellement été tuées ainsi. |
| `super-agent.js` (Assistant) | arrêt après **3** consultations identiques (seuil d'appels d'outils), sans distinction lecture / écriture. |
| `agents-bus.js` | correct pour `bash`, mais via une **liste locale** de noms d'outils dupliquée (`READ_ONLY_TOOLS`), donc divergence possible entre les trois chemins. |

### Correctif

Un **classifieur unique** est désormais partagé par les trois chemins
(`loop-detection.js`) :

- `AGENT_READ_ONLY_TOOLS` — `read`, `search`, `grep`, `glob`, `list`, `ls`,
  `find`, `read_project_file`, `search_project` ;
- `AGENT_SHELL_TOOLS` — `bash`, `shell` ;
- `toolCallCommand(args)` — extraction de la commande d'un appel shell ;
- `isReadOnlyAgentToolCall(toolName, args)` — **une seule** décision :
  outil explicitement consultatif, ou commande shell **prouvée** consultative
  via `isReadOnlyShellCommand` (prudence par défaut : mutateur en cas de doute).

Branchements :

- `agent-pi.js` : `tool_execution_start` n'enregistre un appel dans le détecteur
  d'actions que si `!isReadOnlyAgentToolCall(...)` (la constante locale
  `READ_ONLY_TOOLS` a été supprimée) ;
- `super-agent.js` : le push dans `superLoopToolCalls` est enveloppé de la même
  condition ;
- `agents-bus.js` : sortie anticipée `if (isReadOnlyAgentToolCall(...))` →
  l'appel part dans `readOnlyToolCallsByAgent` (diagnostic) et **ne compte
  jamais** dans `toolCallsByAgent`.

**Aucun seuil mutateur n'a été changé** (fenêtre 40 / répétition 15 pour les
actions, 3 pour l'Assistant, plafonds de tours inchangés) : seule la **nature**
de l'appel décide.

### Preuve de contrôle

Nouveau fichier `src/js/regle-2-lectures-jamais-arret.test.js` (13 tests) : il
**extrait les gardes de production** des trois sources et les **exécute** avec le
vrai classifieur et le vrai constructeur d'empreinte (aucune mécanique
reproduite à la main).

| Neutralisation temporaire | Résultat |
|---|---|
| `isReadOnlyAgentToolCall` → `return false` | **7 échecs** |
| garde de `agent-pi.js` remplacée par `if (toolName) {` | **3 échecs** (« la garde de l'onglet agent a disparu du source ») |

Restaurations faites ; la suite est verte.

### Limites assumées

- Les outils de **suivi de l'Assistant** (`db_query`, …) gardent leur protection
  d'origine : une requête identique répétée y est une vraie boucle, et l'arrêt
  reste **tracé et annoncé**. La règle 2 vise les consultations **du projet**.
- Les autres filets restent en place et inchangés : inactivité, plafond de tours
  pi, plafond de tours de run, moniteur d'anomalie Rust.

---

## B) RÈGLE 3 — « aucun arrêt automatique sans trace écrite », sur TOUS les chemins

### Ce qui n'était pas garanti

1. **Deux arrêts muets** dans `agents-bus.js` :
   - `forceStaleAgentProcessRestartIfNeeded` tuait le processus d'une session
     périmée sans ligne de journal ;
   - le `catch` de `runAgentTurn` nettoyait un processus orphelin sans ligne.
2. **L'onglet agent principal ne traçait rien** : ses deux arrêts sur boucle
   (réflexion et actions) appelaient `abort_agent` sans écrire de motif.
3. **La matrice anti-régression ne lisait QU'UN fichier** (`agents-bus.js`) : un
   arrêt muet ajouté dans `agent-pi.js` ou `super-agent.js` passait inaperçu.

### Correctif

Traces ajoutées (motif littéral, écrit **avant** l'arrêt effectif) :

| Fichier | Site | `reason` | `detected` |
|---|---|---|---|
| `agent-pi.js` | boucle de réflexion | `loop-detection` | `text` |
| `agent-pi.js` | boucle d'actions | `loop-detection` | `actions` |
| `agents-bus.js` | redémarrage de session périmée | `stale-session-restart` | `fresh-context` |
| `agents-bus.js` | nettoyage après échec de lancement | `spawn-failure-cleanup` | `run-agent-turn-error` |

Matrice étendue (`agent-stop-trace-paths.test.js`, +5 tests) — elle lit
désormais **les trois sources** :

- **cardinalité épinglée** par fichier et par type de site (`abort_agent_process`
  = 3, `stop_agent_process` = 2, `settleMission(..., "stop")` = 3,
  `abort_agent` = 13 dont 2 tracés, `abort_super_agent` = 3 dont 2 tracés,
  nombre de traces par fichier épinglé) : **tout nouveau site** — muet ou non —
  rend le test rouge et force une décision de famille ;
- **précédence à portée de bloc** : la trace doit précéder le site terminal
  **sans qu'un autre arrêt du même type s'intercale** (donc dans le même bloc,
  pas « quelque part avant dans le fichier ») ;
- **familles explicitées** : les arrêts de **TOUR** de `agent-pi.js`
  (orchestration : timeouts, subdivisions, reprise après compaction, erreur de
  connexion ; arrêt manuel ; test de modèle) sont **comptés et documentés** mais
  ne sont pas tracés — ils n'interrompent pas la session, la run reprend
  immédiatement (contrairement aux deux arrêts de session, tracés) ;
- **contrôle négatif intégré** : le test injecte un site terminal muet dans une
  **copie** de la source et vérifie que la détection le voit. Si la matrice
  cessait de voir un site muet, ce test tomberait.

### Preuve de contrôle

Injection d'un vrai site muet (`abort_agent_process` sans trace) dans
`agents-bus.js` → **3 échecs** (dont « site terminal MUET » et la cardinalité),
puis retrait et vérification de la restauration. La matrice d'origine et la
matrice étendue ont **toutes deux** réagi.

### Limites assumées

- Le **moniteur d'anomalie Rust** (`src-tauri/src/anomaly.rs`) garde son propre
  chemin d'arrêt : il est **hors périmètre** de cette livraison (aucune
  modification Rust), et reste couvert par la ligne `auto-stop-rust`
  (`detected=anomaly-monitor`) déjà émise côté bus.
- Les arrêts de **tour** listés ci-dessus restent sans ligne de journal : c'est
  un choix documenté (ce ne sont pas des fins de session), et la cardinalité
  épinglée empêche d'en ajouter un nouveau sans y penser.

---

## C) RÈGLE 4 — « une demande mise en file ne disparaît jamais en silence »

### Ce qui n'était pas garanti

1. **La vérité de la file était l'état des runs vivantes** : `busState.runs`.
   Quand une run mourait, ses demandes conservées devenaient **invisibles** —
   ni listées, ni relançables, ni abandonnables explicitement. Elles
   n'existaient plus que « dans un objet » que plus personne ne parcourait.
2. **Le vidage global** (`clearAllRuns`, via « tout arrêter » ou la destruction
   du bus) supprimait les files de tous les projets avec un simple
   `console.warn` : **aucune trace disque, aucune annonce**.
3. **Le test de la règle 4 ne dépendait pas de la production** : il rejouait la
   mécanique d'empilement à la main (`runAgentsQueueByProject[...].push(...)`),
   donc il restait vert même si la production cessait de tamponner l'identité
   de mission.

### Correctif

- **`projectExclusivityQueues` est la source de vérité** : la lecture
  (`listProjectExclusivityEntries`) et l'abandon
  (`abandonProjectExclusivityQueues`) **itèrent la file module** (plus les files
  portées par les runs vivantes, sans double comptage).
- Une entrée dont plus aucune run ne porte la clé est exposée comme
  **`orphan: true`** (avec `runKey: ""`) : elle est **visible**, donc
  relançable ou abandonnable explicitement.
- **`journalQueueAbandonment`** : tout abandon de demandes écrit une ligne
  (`reason=queue-abandoned`, libellés des demandes dans `detail`) **et**
  prévient l'utilisateur (`notify`) ; fail-open (une écriture impossible ne
  bloque pas l'abandon), l'échec d'écriture étant lui-même signalé par le
  rapporteur du module de trace.
- **`clearAllRuns`** collecte les demandes perdues **avant** de vider les files,
  puis les journalise (`detected=clear-all-runs`) et les annonce.
- **Un seul chemin d'empilement en production** : `enqueueMissionForProject`
  (`super-agent.js`) crée la file si besoin, pousse, pose le libellé **après**
  le push (invariant historique), puis `stampQueuedMission` attribue
  l'identité de mission et **refuse le double empilement**. Les trois sites
  d'empilement (lancement, `startRun`/`run_agents`, `run_assistant_agents`)
  passent par lui.

### Tests

- Nouveau `src/js/regle-4-file-jamais-perdue.test.js` (8 tests) : entrée
  orpheline visible, lecture sans aucune run vivante, deux spécialités après
  mort de la run, abandon d'orphelines journalisé (`reason=queue-abandoned`,
  `detected=user-abandon`, libellé), `notify` émis, `journal: false` silencieux
  **mais** abandon effectif, « tout arrêter » journalisé
  (`detected=clear-all-runs`), écriture dans le journal **du projet concerné**.
- Tests adaptés parce que leur **contrat change** (l'empilement n'est plus
  inline) — chacun documenté en tête de fichier :
  `file-attente-identite-demande.test.js` (compte désormais les appels à
  `enqueueMissionForProject` et **appelle la production** au lieu de rejouer la
  mécanique), `file-attente-regle-4.test.js`, `super-agent-launch-verdict.test.js`,
  `agent-demande-exact.test.js`, `verrou-par-projet.test.js`.

### Preuve de contrôle

Neutralisation temporaire de `enqueueMissionForProject` (empilement direct sans
`stampQueuedMission`) → **6 échecs** sur les cinq fichiers concernés, puis
restauration. Les tests dépendent donc bien de la **production**, plus d'une
mécanique rejouée.

### Limites assumées

- L'abandon d'une file de projet reste **explicite** (commande utilisateur,
  watchdog, « tout arrêter ») : Pilot ne relance jamais seul une mission
  orpheline — il la **montre** désormais.
- La détection Rust de tâches bloquées (`anomaly.rs`) n'est pas modifiée.

---

## Fichiers

Production (7) : `src/js/loop-detection.js`, `src/js/agent-pi.js`,
`src/js/agents-bus.js`, `src/js/super-agent.js` (+ `src/js/agent-stop-trace.js`
inchangé, `src/js/mission-identity.js` inchangé).

Tests : `regle-2-lectures-jamais-arret.test.js` **(nouveau)**,
`regle-4-file-jamais-perdue.test.js` **(nouveau)**,
`agent-stop-trace-paths.test.js` (matrice étendue),
`file-attente-identite-demande.test.js`, `file-attente-regle-4.test.js`,
`super-agent-launch-verdict.test.js`, `agent-demande-exact.test.js`,
`verrou-par-projet.test.js` (contrats d'empilement).

Documentation : `spec_super_agent.md` (table des motifs + aide
`loop-detection-writes`), `spec_gestion_agents.md` (aide `agents`),
`AGENTS.md` (classifieur partagé, matrice étendue), `help/handbook.md`
(régénéré).

## Vérifications

```bash
npm test                 # suite complète (frontend)
npm run build:handbook   # aide intégrée régénérée
cargo test --workspace   # inchangé : aucune modification Rust
```
